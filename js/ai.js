// js/ai.js — Inteligencia artificial con Firebase AI Logic (Gemini Developer API).
// La clave de Gemini NUNCA está en la app: la guarda Firebase. Las consultas se protegen
// con App Check (Fraud Defense / reCAPTCHA Enterprise, o v3; obligatorio para AI Logic desde nov-2026).
// Cada tarea tiene una CADENA de modelos: si uno agota su cupo gratis, no existe o está
// saturado, se salta al siguiente. Respuestas con formato fijo (JSON) que la app valida.
// La IA solo PROPONE: todo lo leído se muestra en el formulario para revisarlo antes de guardar.
import { getState } from "./state.js";
import { FIREBASE_READY } from "../firebase-config.js";
import { getFirebaseApp, FB_VER } from "./firebase-service.js";
import { MAINT_CATEGORIES, MAINT_TIPOS } from "./config.js";

const cdn = (m) => `https://www.gstatic.com/firebasejs/${FB_VER}/firebase-${m}.js`;

// Cadenas por defecto (se pueden cambiar en Ajustes → IA). Los nombres siguen el formato de
// Google ("gemini-3.8-flash"); verificados con el proyecto el 2-oct-2026. Si alguno deja de
// existir, se salta solo.
export const DEFAULT_CHAINS = {
  vision: ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-3-flash-preview", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"],
  texto: ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.8-flash", "gemini-3.7-flash", "gemini-3-flash-preview"],
  analisis: ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-3-flash-preview", "gemini-3.5-flash-lite"],
};
export const esLocal = () => /^(localhost|127\.0\.0\.1)$/.test(location.hostname);

export function aiCfg() {
  const p = ((getState().profile || {}).ai) || {};
  const chains = { ...DEFAULT_CHAINS };
  for (const k of Object.keys(DEFAULT_CHAINS)) if (Array.isArray(p.chains && p.chains[k]) && p.chains[k].length) chains[k] = p.chains[k];
  // proveedor de App Check: "enterprise" = Fraud Defense (antes reCAPTCHA Enterprise, el que hoy ofrece
  // la consola de Firebase) o "v3" = reCAPTCHA v3 clásico
  return { enabled: !!p.enabled, siteKey: (p.siteKey || "").trim(), proveedor: p.proveedor === "v3" ? "v3" : "enterprise", chains };
}
// la IA solo está disponible en modo nube y si el usuario la activó
export const aiReady = () => FIREBASE_READY && aiCfg().enabled;

/* ---------- Conexión (App Check + AI Logic) ---------- */
let ai = null, aiMod = null, appCheckOn = false, acFirma = "", acInst = null, acMod = null;
// App Check solo se puede iniciar UNA vez por carga de página: si cambian la clave o el
// proveedor después de haberlo iniciado, hay que recargar para que tome la nueva.
const firmaAC = () => { const c = aiCfg(); return `${c.proveedor}|${c.siteKey}`; };
export const requiereRecarga = () => appCheckOn && acFirma !== firmaAC();
async function conectar() {
  if (ai) return { ai, aiMod };
  if (!FIREBASE_READY) throw new Error("La IA necesita el modo nube (Firebase).");
  const app = await getFirebaseApp();
  const [m, ac] = await Promise.all([import(cdn("ai")), import(cdn("app-check"))]);
  if (!appCheckOn) {
    const { siteKey, proveedor } = aiCfg();
    // en el PC (localhost) se usa el token de depuración de App Check: aparece en la
    // consola del navegador (F12) y se registra una vez en Firebase → App Check
    if (esLocal() && !self.FIREBASE_APPCHECK_DEBUG_TOKEN) self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    if (siteKey || esLocal()) {
      const Prov = proveedor === "v3" ? ac.ReCaptchaV3Provider : ac.ReCaptchaEnterpriseProvider;
      acMod = ac;
      acInst = ac.initializeAppCheck(app, { provider: new Prov(siteKey || "token-de-depuracion-local"), isTokenAutoRefreshEnabled: true });
    }
    appCheckOn = true; acFirma = firmaAC();
  }
  aiMod = m;
  ai = m.getAI(app, { backend: new m.GoogleAIBackend() });
  return { ai, aiMod };
}

/* ---------- Uso diario por modelo (se reinicia con el día de California ≈ 2 a. m. Colombia) ---------- */
const USO_KEY = "fz_ai_uso";
const hoyPT = () => new Date(Date.now() - 8 * 3600e3).toISOString().slice(0, 10);
function leerUso() {
  try { const u = JSON.parse(localStorage.getItem(USO_KEY) || "{}"); return u.dia === hoyPT() ? u : { dia: hoyPT(), m: {} }; } catch { return { dia: hoyPT(), m: {} }; }
}
function marcar(model, cambio) {
  const u = leerUso(); u.m[model] = { n: 0, ...(u.m[model] || {}), ...cambio(u.m[model] || { n: 0 }) };
  try { localStorage.setItem(USO_KEY, JSON.stringify(u)); } catch { /* sin almacenamiento: no se lleva la cuenta */ }
}
export function usoHoy() { return leerUso().m; }
export function reiniciarUso() { try { localStorage.removeItem(USO_KEY); } catch { /* nada */ } }

// clasifica el error para decidir si se salta al siguiente modelo o se detiene
function tipoError(e) {
  const st = e && e.customErrorData && e.customErrorData.status;
  const msg = String((e && e.message) || e || "").toLowerCase();
  if (/app.?check|attestation|recaptcha/.test(msg) || st === 401) return "appcheck";
  if (/api-not-enabled|service_disabled|has not been used|is disabled/.test(msg)) return "api";
  if (st === 429 || /429|resource.?exhausted|quota|rate limit/.test(msg)) return "cupo";
  if (st === 404 || /not found|not supported|is not found|unknown model|invalid model/.test(msg)) return "modelo";
  return "otro"; // 5xx, saturado, red… → probar el siguiente
}
const conTiempo = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Tiempo de espera agotado")), ms))]);

/**
 * Ejecuta una consulta probando la cadena de modelos de la tarea.
 * @param {"vision"|"texto"} tarea
 * @param {Array} partes  texto y/o imágenes ({inlineData})
 * @param {(S)=>object} [esquema]  constructor de esquema con los helpers Schema del SDK
 * @returns {{data:any, model:string, intentos:Array}}
 */
export async function generar(tarea, partes, esquema, { pensarPoco = false } = {}) {
  if (requiereRecarga()) throw new Error("Cambiaste la clave o el proveedor: recarga la página para aplicarlos.");
  const { ai: inst, aiMod: m } = await conectar();
  const cadena = aiCfg().chains[tarea] || DEFAULT_CHAINS[tarea];
  const uso = usoHoy(), intentos = [];
  let reintentoAC = false; // un rechazo de App Check puede ser una falla momentánea de red: se reintenta 1 vez
  for (let i = 0; i < cadena.length; i++) {
    const model = cadena[i];
    const u = uso[model] || {};
    if (u.agotado || u.noExiste) { intentos.push({ model, error: u.agotado ? "cupo agotado hoy" : "no disponible" }); continue; }
    try {
      // leer documentos no necesita razonamiento largo: nivel BAJO = respuestas más rápidas.
      // Si el modelo no acepta esa opción, se reintenta el mismo modelo sin ella.
      const pedir = async (conPensar) => {
        const generationConfig = { ...(esquema ? { responseMimeType: "application/json", responseSchema: esquema(m.Schema) } : {}),
          ...(conPensar ? { thinkingConfig: { thinkingLevel: "LOW" } } : {}) };
        const gm = m.getGenerativeModel(inst, { model, generationConfig });
        return conTiempo(gm.generateContent(partes), 90000);
      };
      let res;
      try { res = await pedir(pensarPoco); }
      catch (e1) { if (pensarPoco && /thinking/i.test(String(e1 && e1.message))) res = await pedir(false); else throw e1; }
      const txt = res.response.text();
      marcar(model, (x) => ({ n: (x.n || 0) + 1 }));
      return { data: esquema ? JSON.parse(txt) : txt, model, intentos };
    } catch (e) {
      const t = tipoError(e);
      intentos.push({ model, error: t, detalle: String((e && e.message) || e).slice(0, 160) });
      if (t === "appcheck" && !reintentoAC) { reintentoAC = true; intentos.pop(); await new Promise((r) => setTimeout(r, 1500)); i--; continue; }
      if (t === "appcheck") {
        const det = String((e && e.message) || e).replace(/\s+/g, " ").slice(0, 220);
        throw new Error("App Check rechazó la consulta. " + (esLocal() ? "Registra el token de depuración (consola F12) en Firebase → App Check." : !aiCfg().siteKey ? "Falta la clave de sitio en Ajustes → IA." : "Revisa que la clave de sitio y el proveedor (Fraud Defense / v3) coincidan con los de Firebase → App Check.") + ` [${det}]`);
      }
      if (t === "api") throw new Error("Firebase AI Logic no está activado en el proyecto (consola de Firebase → AI Logic).");
      if (t === "cupo") marcar(model, () => ({ agotado: true }));
      if (t === "modelo") marcar(model, () => ({ noExiste: true }));
      // cupo, modelo inexistente u otro error → siguiente modelo de la cadena
    }
  }
  const err = new Error("IA no disponible por ahora: todos los modelos de la cadena fallaron o agotaron su cupo de hoy.");
  err.intentos = intentos;
  throw err;
}

/* ---------- Fotos: tomar o cargar, reducidas antes de enviar ---------- */
// Botones "Tomar foto" (abre la cámara en el celular) y "Cargar foto" (galería/archivos)
export function botonesFoto(id, titulo) {
  return `<div class="ai-box" style="border:1px dashed var(--gold);border-radius:12px;padding:10px;margin-bottom:12px">
    <div class="small bold mb-1">✨ ${titulo}</div>
    <div class="row gap-2">
      <label class="btn btn-ghost btn-sm" style="flex:1;cursor:pointer;text-align:center">📷 Tomar foto<input id="${id}-cam" type="file" accept="image/*" capture="environment" hidden></label>
      <label class="btn btn-ghost btn-sm" style="flex:1;cursor:pointer;text-align:center">🖼️ Cargar foto<input id="${id}-file" type="file" accept="image/*" hidden></label>
    </div>
    <div id="${id}-st" class="tiny muted mt-1">La IA propone; revisa todo antes de guardar. La foto no se guarda.</div></div>`;
}
export function enlazarFoto(b, id, alElegir) {
  [b.querySelector(`#${id}-cam`), b.querySelector(`#${id}-file`)].forEach((inp) => {
    if (inp) inp.onchange = () => { const f = inp.files && inp.files[0]; inp.value = ""; if (f) alElegir(f, b.querySelector(`#${id}-st`)); };
  });
}
// reduce la imagen (máx 1600 px, JPEG) → menos datos, más rápido, menos cupo
export async function imagenParte(file, max = 1600, calidad = 0.82) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("No se pudo leer la imagen")); i.src = url; });
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    const data = c.toDataURL("image/jpeg", calidad).split(",")[1];
    return { inlineData: { data, mimeType: "image/jpeg" } };
  } finally { URL.revokeObjectURL(url); }
}

// reparte IVA o descuento que la factura muestra solo al final, en proporción a cada línea
export function repartir(valores, monto) {
  const tot = valores.reduce((a, v) => a + v, 0);
  if (!monto || !tot) return valores;
  let acum = 0;
  return valores.map((v, i) => { if (i === valores.length - 1) return Math.round(v + monto - acum); const d = Math.round((v / tot) * monto); acum += d; return Math.round(v + d); });
}

const fechaOk = (f) => (/^\d{4}-\d{2}-\d{2}$/.test(f || "") ? f : "");
const IVA_TXT = `Valores: si las líneas YA incluyen IVA, pon "ivaAparte": 0. Si las líneas vienen SIN IVA y el IVA aparece solo al final, pon ese IVA total en "ivaAparte" (no lo sumes tú a las líneas). Igual con descuentos globales al final en "descuentoAparte" (positivo). "total" es el TOTAL A PAGAR de la factura. Montos en pesos colombianos como números enteros, sin puntos ni símbolos.`;

/* ---------- Leer recibo de compra (supermercado, tienda…) ---------- */
export async function leerRecibo(file, cats) {
  const listado = cats.map((c) => `- ${c.name}: ${(c.subs || []).join(", ")}`).join("\n");
  const prompt = `Lee este recibo de compra de Colombia. Extrae la tienda (nombre comercial corto como la gente la conoce, ej. "Éxito", "D1", "Terpel"; NO la razón social como "ALMACENES ÉXITO S.A."), la fecha (YYYY-MM-DD) y CADA producto con su cantidad y su valor total de la línea.
Para cada producto escribe un nombre corto y claro en español (ej. "Coca cola", "Arroz Diana 1kg") y asígnale una categoría y subcategoría SOLO de esta lista:
${listado}
${IVA_TXT}
Si algo no se lee, déjalo vacío o en 0. No inventes productos.`;
  const r = await generar("vision", [prompt, await imagenParte(file)], (S) => S.object({
    properties: {
      tienda: S.string(), fecha: S.string(), total: S.number(), ivaAparte: S.number(), descuentoAparte: S.number(),
      items: S.array({ items: S.object({ properties: {
        producto: S.string(), cantidad: S.number(), valor: S.number(),
        categoria: S.enumString({ enum: cats.map((c) => c.name) }), subcategoria: S.string(),
      } }) }),
    },
  }), { pensarPoco: true });
  const d = r.data || {};
  let items = (d.items || []).filter((x) => x && x.producto && +x.valor > 0)
    .map((x) => ({ producto: String(x.producto).trim(), cantidad: +x.cantidad > 0 ? +x.cantidad : 1, valor: Math.round(+x.valor), categoria: x.categoria, subcategoria: x.subcategoria }));
  const ajuste = (+d.ivaAparte || 0) - (+d.descuentoAparte || 0);
  if (ajuste && items.length) { const v = repartir(items.map((x) => x.valor), ajuste); items = items.map((x, i) => ({ ...x, valor: v[i] })); }
  return { tienda: (d.tienda || "").trim(), fecha: fechaOk(d.fecha), total: Math.round(+d.total || 0), items, ivaRepartido: Math.round(+d.ivaAparte || 0), descRepartido: Math.round(+d.descuentoAparte || 0), model: r.model, intentos: r.intentos };
}

/* ---------- Leer factura del taller (orden de trabajo) ---------- */
export async function leerFacturaTaller(file) {
  const tipos = MAINT_CATEGORIES.map((c) => `- ${c}: ${(MAINT_TIPOS[c] || []).join(", ")}`).join("\n");
  const prompt = `Lee esta factura u orden de trabajo de un taller de motos en Colombia. Extrae el nombre del taller, la fecha (YYYY-MM-DD) y CADA línea.
Clasifica cada línea como: Taller (mano de obra o servicio instalado), Rutina (mantenimiento propio) o Insumos (repuesto o producto comprado), y asígnale un "tipo" SOLO de esta lista según su clasificación:
${tipos}
Si ningún tipo corresponde usa "Otro". En "descripcion" pon el texto específico de la línea (marca, detalle). En "referencia" el código del repuesto si aparece. "valor" es el total de la línea.
${IVA_TXT}`;
  const r = await generar("vision", [prompt, await imagenParte(file)], (S) => S.object({
    properties: {
      taller: S.string(), fecha: S.string(), total: S.number(), ivaAparte: S.number(), descuentoAparte: S.number(),
      lineas: S.array({ items: S.object({ properties: {
        clasificacion: S.enumString({ enum: MAINT_CATEGORIES }), tipo: S.string(), descripcion: S.string(),
        referencia: S.string(), cantidad: S.number(), valor: S.number(),
      } }) }),
    },
  }), { pensarPoco: true });
  const d = r.data || {};
  let lineas = (d.lineas || []).filter((x) => x && +x.valor > 0).map((x) => {
    const clase = MAINT_CATEGORIES.includes(x.clasificacion) ? x.clasificacion : "Taller";
    const lista = MAINT_TIPOS[clase] || [];
    const ok = lista.includes(x.tipo);
    // tipo estricto: si la IA propone uno que no está en la lista, va como "Otro" y su texto a la descripción
    return { clase, tipo: ok ? x.tipo : (lista.includes("Otro") ? "Otro" : lista[0]), descripcion: [!ok && x.tipo ? x.tipo : "", x.descripcion || ""].filter(Boolean).join(" · "),
      referencia: x.referencia || "", cantidad: +x.cantidad > 0 ? +x.cantidad : 1, valor: Math.round(+x.valor) };
  });
  const ajuste = (+d.ivaAparte || 0) - (+d.descuentoAparte || 0);
  if (ajuste && lineas.length) { const v = repartir(lineas.map((x) => x.valor), ajuste); lineas = lineas.map((x, i) => ({ ...x, valor: v[i] })); }
  return { taller: (d.taller || "").trim(), fecha: fechaOk(d.fecha), total: Math.round(+d.total || 0), lineas, ivaRepartido: Math.round(+d.ivaAparte || 0), descRepartido: Math.round(+d.descuentoAparte || 0), model: r.model, intentos: r.intentos };
}

/* ---------- Análisis del mes para el reporte PDF ---------- */
// `datos` lo calcula la app (cifras exactas); la IA solo interpreta y redacta, sin recalcular.
export async function analizarMes(datos) {
  const prompt = `Eres un asesor de finanzas personales en Colombia: directo, concreto y amable, en español.
Analiza el mes ${datos.mes} con estos datos YA CALCULADOS por la app (pesos colombianos). NO recalcules ni inventes cifras: usa solo las que aparecen.
Compara contra el mes anterior, contra el MISMO MES DEL AÑO ANTERIOR (si hay datos) y contra el promedio de los últimos 12 meses, revisa la regla 50/30/20 (necesidades/deseos/deuda-inversión) y los gastos más grandes y repetidos.
Para el ahorro/inversión usa "ahorroEnCuentas" (aportes reales a cuentas y rendimientos): si hay aportes, el usuario SÍ está ahorrando aunque "deudaInversion" esté en 0.
Escribe: "resumen" (2-3 frases), entre 3 y 5 "hallazgos" (titulo corto + detalle de 1-2 frases con cifras; tipo "bien", "alerta" o "info") y 2-3 "recomendaciones" accionables y específicas para el próximo mes (nada genérico).
DATOS:
${JSON.stringify(datos)}`;
  const r = await generar("analisis", [prompt], (S) => S.object({
    properties: {
      resumen: S.string(),
      hallazgos: S.array({ items: S.object({ properties: { titulo: S.string(), detalle: S.string(), tipo: S.enumString({ enum: ["bien", "alerta", "info"] }) } }) }),
      recomendaciones: S.array({ items: S.string() }),
    },
  }));
  const d = r.data || {};
  return { resumen: d.resumen || "", hallazgos: (d.hallazgos || []).filter((h) => h && h.titulo), recomendaciones: (d.recomendaciones || []).filter(Boolean), model: r.model };
}

/* ---------- Movimientos desde texto o voz ---------- */
// "almuerzo 15 mil efectivo y gaseosa 4 mil" → lista de movimientos para revisar
export async function interpretarTexto(texto, { cats, pays, cuentas, hoy }) {
  const listado = cats.map((c) => `- ${c.name}: ${(c.subs || []).join(", ")}`).join("\n");
  const prompt = `Convierte lo que dijo o escribió el usuario (Colombia, pesos COP) en movimientos de dinero. HOY es ${hoy}.
Reglas: "15 mil" = 15000, "1,2 millones" o "1.2 palos" = 1200000, "ayer"/"el lunes" → fecha real YYYY-MM-DD; si no dice fecha, usa HOY.
Un texto puede traer VARIOS movimientos ("almuerzo 15 mil y gaseosa 4 mil" = 2). "tipo": "gasto" o "ingreso" (salario, pago recibido, venta…).
Descripción corta y clara en español (ej. "Almuerzo", "Gasolina extra", "Coca cola"). Para gastos elige categoría y subcategoría SOLO de esta lista:
${listado}
Medio de pago SOLO de: ${pays.join(", ")} (vacío si no lo dice). Cuenta SOLO de: ${cuentas.join(", ") || "(ninguna)"} (vacío si no lo dice).
Texto: """${texto}"""`;
  const r = await generar("texto", [prompt], (S) => S.object({ properties: { movimientos: S.array({ items: S.object({ properties: {
    tipo: S.enumString({ enum: ["gasto", "ingreso"] }), descripcion: S.string(), monto: S.number(), fecha: S.string(),
    categoria: S.enumString({ enum: cats.map((c) => c.name) }), subcategoria: S.string(), medioPago: S.string(), cuenta: S.string(),
  } }) }) } }));
  const movs = ((r.data || {}).movimientos || []).filter((m) => m && m.descripcion && +m.monto > 0)
    .map((m) => ({ ...m, monto: Math.round(+m.monto), fecha: fechaOk(m.fecha) || hoy }));
  return { movimientos: movs, model: r.model };
}

/* ---------- Extracto bancario (PDF o foto) ---------- */
async function archivoParte(file) {
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name || "")) {
    if (file.size > 15 * 1024 * 1024) throw new Error("El PDF pesa más de 15 MB; divídelo o usa un período más corto.");
    const data = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1]); fr.onerror = () => rej(new Error("No se pudo leer el archivo")); fr.readAsDataURL(file); });
    return { inlineData: { data, mimeType: "application/pdf" } };
  }
  return imagenParte(file, 2000, 0.85);
}
export async function leerExtracto(file, cats) {
  const listado = cats.map((c) => `- ${c.name}: ${(c.subs || []).join(", ")}`).join("\n");
  const prompt = `Este archivo es un extracto bancario, de tarjeta o una factura/recibo de Colombia. Extrae TODOS los movimientos (cada fila con fecha, descripción y valor).
"tipo": "gasto" para compras, pagos, débitos, retiros y cobros; "ingreso" para abonos, consignaciones, nómina, transferencias recibidas y rendimientos.
"descripcion": corta y clara (comercio o concepto, ej. "Éxito", "Netflix", "Pago nómina"). "monto" siempre positivo, entero, sin puntos.
"fecha" YYYY-MM-DD (si el extracto solo trae día/mes, usa el año del período del extracto).
"esTransferenciaPropia": true si parece un movimiento entre cuentas propias o pago de la tarjeta (no es gasto real).
Para gastos asigna categoría y subcategoría SOLO de esta lista:
${listado}
No inventes filas; no incluyas saldos, totales ni subtotales como movimientos.`;
  const r = await generar("vision", [prompt, await archivoParte(file)], (S) => S.object({ properties: {
    entidad: S.string(), periodo: S.string(),
    movimientos: S.array({ items: S.object({ properties: {
      fecha: S.string(), descripcion: S.string(), monto: S.number(), tipo: S.enumString({ enum: ["gasto", "ingreso"] }),
      categoria: S.enumString({ enum: cats.map((c) => c.name) }), subcategoria: S.string(), esTransferenciaPropia: S.boolean(),
    } }) }),
  } }), { pensarPoco: true });
  const d = r.data || {};
  const movs = (d.movimientos || []).filter((m) => m && m.descripcion && +m.monto > 0).map((m) => ({ ...m, monto: Math.round(+m.monto), fecha: fechaOk(m.fecha) }));
  return { entidad: (d.entidad || "").trim(), periodo: (d.periodo || "").trim(), movimientos: movs, model: r.model, intentos: r.intentos };
}

/* ---------- Pregúntale a tus datos (llamada a funciones) ---------- */
// La IA NO recibe los movimientos: pide cálculos a funciones de la app (`herramientas`) y redacta.
export async function preguntar(pregunta, herramientas, declaraciones, contexto) {
  if (requiereRecarga()) throw new Error("Cambiaste la clave o el proveedor: recarga la página para aplicarlos.");
  const { ai: inst, aiMod: m } = await conectar();
  const cadena = aiCfg().chains.analisis || DEFAULT_CHAINS.analisis;
  const uso = usoHoy(), intentos = [];
  const sistema = `Eres el asistente de una app de finanzas personales (Colombia, COP). Responde en español, breve y con cifras.
ALCANCE: SOLO respondes sobre los gastos, ingresos, categorías, presupuestos y cuentas del usuario en esta app, y consejos de finanzas personales basados en esos datos.
Si la pregunta no tiene que ver con sus finanzas (temas generales, opiniones, entretenimiento, tareas, programación, noticias, etc.), NO la respondas ni opines y NO llames funciones:
contesta solo "Solo puedo responder preguntas sobre tus finanzas registradas en la app. Por ejemplo: ¿cuánto gasté en mercado este mes?".
NUNCA calcules ni inventes cifras: usa SIEMPRE las funciones para obtener los datos y responde con sus resultados.
Formato: texto plano, sin markdown (sin asteriscos ni #); para listas usa líneas que empiecen con "• ". ${contexto}`;
  for (const model of cadena) {
    const u = uso[model] || {};
    if (u.agotado || u.noExiste) continue;
    try {
      const gm = m.getGenerativeModel(inst, { model, systemInstruction: sistema, tools: [{ functionDeclarations: typeof declaraciones === "function" ? declaraciones(m.Schema) : declaraciones }] });
      const chat = gm.startChat();
      let res = await conTiempo(chat.sendMessage(pregunta), 90000);
      const usadas = [];
      for (let paso = 0; paso < 5; paso++) {
        const calls = (res.response.functionCalls && res.response.functionCalls()) || [];
        if (!calls.length) break;
        const respuestas = calls.map((c) => {
          let out; try { out = herramientas[c.name] ? herramientas[c.name](c.args || {}) : { error: "función desconocida" }; } catch (e) { out = { error: String(e.message || e) }; }
          usadas.push(c.name);
          return { functionResponse: { name: c.name, response: { resultado: out } } };
        });
        res = await conTiempo(chat.sendMessage(respuestas), 90000);
      }
      marcar(model, (x) => ({ n: (x.n || 0) + 1 }));
      return { texto: res.response.text(), model, funciones: usadas, intentos };
    } catch (e) {
      const t = tipoError(e);
      intentos.push({ model, error: t, detalle: String((e && e.message) || e).slice(0, 160) });
      if (t === "appcheck" || t === "api") throw new Error(t === "api" ? "Firebase AI Logic no está activado." : "App Check rechazó la consulta.");
      if (t === "cupo") marcar(model, () => ({ agotado: true }));
      if (t === "modelo") marcar(model, () => ({ noExiste: true }));
    }
  }
  const err = new Error("IA no disponible por ahora (todos los modelos fallaron o agotaron su cupo)."); err.intentos = intentos; throw err;
}

// prueba rápida de conexión (Ajustes → IA)
export async function probarConexion() {
  // 1) primero App Check por separado: si falla aquí, el detalle dice si es la clave/dominio
  //    (reCAPTCHA / Fraud Defense) o el registro de la app en Firebase (intercambio 403/400)
  if (requiereRecarga()) throw new Error("Cambiaste la clave o el proveedor: recarga la página para aplicarlos.");
  await conectar();
  if (acInst && acMod) {
    const t = await acMod.getToken(acInst, true).catch((e) => ({ error: e }));
    // un fallo de red momentáneo no se diagnostica aquí: la consulta lo reintenta
    if (t && t.error && !/network|fetch-network/i.test(String(t.error.message || t.error))) {
      const msg = String(t.error.message || t.error);
      const pista = /recaptcha|fraud/i.test(msg) ? "Fraud Defense/reCAPTCHA no validó esta página: revisa que la clave sea de tipo sitio web (puntuación) y que el dominio jdch1206.github.io esté en la lista de la clave."
        : /403|400|invalid|permission/i.test(msg) ? "Firebase no aceptó la validación: la clave pegada en la app no es la misma registrada en Firebase → App Check → tu app web (o está registrada en otra app web del proyecto)."
        : "No se pudo obtener el token de App Check.";
      throw new Error(`App Check: ${pista} [${msg.replace(/\s+/g, " ").slice(0, 220)}]`);
    }
  }
  const r = await generar("texto", ["Responde solo con la palabra: OK"]);
  return r;
}
