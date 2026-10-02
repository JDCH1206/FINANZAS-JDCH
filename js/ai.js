// js/ai.js — Inteligencia artificial con Firebase AI Logic (Gemini Developer API).
// La clave de Gemini NUNCA está en la app: la guarda Firebase. Las consultas se protegen
// con App Check (reCAPTCHA v3; obligatorio para AI Logic desde nov-2026).
// Cada tarea tiene una CADENA de modelos: si uno agota su cupo gratis, no existe o está
// saturado, se salta al siguiente. Respuestas con formato fijo (JSON) que la app valida.
// La IA solo PROPONE: todo lo leído se muestra en el formulario para revisarlo antes de guardar.
import { getState } from "./state.js";
import { FIREBASE_READY } from "../firebase-config.js";
import { getFirebaseApp, FB_VER } from "./firebase-service.js";
import { MAINT_CATEGORIES, MAINT_TIPOS } from "./config.js";

const cdn = (m) => `https://www.gstatic.com/firebasejs/${FB_VER}/firebase-${m}.js`;

// Cadenas por defecto (se pueden cambiar en Ajustes → IA). Los nombres siguen el formato de
// Google ("gemini-3.8-flash"); si alguno no existe en tu cuenta, se salta solo.
export const DEFAULT_CHAINS = {
  vision: ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"],
  texto: ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.8-flash", "gemini-3.7-flash"],
};
export const esLocal = () => /^(localhost|127\.0\.0\.1)$/.test(location.hostname);

export function aiCfg() {
  const p = ((getState().profile || {}).ai) || {};
  const chains = { ...DEFAULT_CHAINS };
  for (const k of Object.keys(DEFAULT_CHAINS)) if (Array.isArray(p.chains && p.chains[k]) && p.chains[k].length) chains[k] = p.chains[k];
  return { enabled: !!p.enabled, siteKey: (p.siteKey || "").trim(), chains };
}
// la IA solo está disponible en modo nube y si el usuario la activó
export const aiReady = () => FIREBASE_READY && aiCfg().enabled;

/* ---------- Conexión (App Check + AI Logic) ---------- */
let ai = null, aiMod = null, appCheckOn = false;
async function conectar() {
  if (ai) return { ai, aiMod };
  if (!FIREBASE_READY) throw new Error("La IA necesita el modo nube (Firebase).");
  const app = await getFirebaseApp();
  const [m, ac] = await Promise.all([import(cdn("ai")), import(cdn("app-check"))]);
  if (!appCheckOn) {
    const { siteKey } = aiCfg();
    // en el PC (localhost) se usa el token de depuración de App Check: aparece en la
    // consola del navegador (F12) y se registra una vez en Firebase → App Check
    if (esLocal()) self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    if (siteKey || esLocal()) {
      ac.initializeAppCheck(app, { provider: new ac.ReCaptchaV3Provider(siteKey || "token-de-depuracion-local"), isTokenAutoRefreshEnabled: true });
    }
    appCheckOn = true;
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
export async function generar(tarea, partes, esquema) {
  const { ai: inst, aiMod: m } = await conectar();
  const cadena = aiCfg().chains[tarea] || DEFAULT_CHAINS[tarea];
  const uso = usoHoy(), intentos = [];
  for (const model of cadena) {
    const u = uso[model] || {};
    if (u.agotado || u.noExiste) { intentos.push({ model, error: u.agotado ? "cupo agotado hoy" : "no disponible" }); continue; }
    try {
      const generationConfig = esquema ? { responseMimeType: "application/json", responseSchema: esquema(m.Schema) } : undefined;
      const gm = m.getGenerativeModel(inst, { model, generationConfig });
      const res = await conTiempo(gm.generateContent(partes), 90000);
      const txt = res.response.text();
      marcar(model, (x) => ({ n: (x.n || 0) + 1 }));
      return { data: esquema ? JSON.parse(txt) : txt, model, intentos };
    } catch (e) {
      const t = tipoError(e);
      intentos.push({ model, error: t, detalle: String((e && e.message) || e).slice(0, 160) });
      if (t === "appcheck") throw new Error("App Check rechazó la consulta. " + (esLocal() ? "Registra el token de depuración (consola F12) en Firebase → App Check." : "Revisa la clave de reCAPTCHA en Ajustes → IA."));
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
  const prompt = `Lee este recibo de compra de Colombia. Extrae la tienda, la fecha (YYYY-MM-DD) y CADA producto con su cantidad y su valor total de la línea.
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
  }));
  const d = r.data || {};
  let items = (d.items || []).filter((x) => x && x.producto && +x.valor > 0)
    .map((x) => ({ producto: String(x.producto).trim(), cantidad: +x.cantidad > 0 ? +x.cantidad : 1, valor: Math.round(+x.valor), categoria: x.categoria, subcategoria: x.subcategoria }));
  const ajuste = (+d.ivaAparte || 0) - (+d.descuentoAparte || 0);
  if (ajuste && items.length) { const v = repartir(items.map((x) => x.valor), ajuste); items = items.map((x, i) => ({ ...x, valor: v[i] })); }
  return { tienda: (d.tienda || "").trim(), fecha: fechaOk(d.fecha), total: Math.round(+d.total || 0), items, ivaRepartido: Math.round(+d.ivaAparte || 0), descRepartido: Math.round(+d.descuentoAparte || 0), model: r.model };
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
  }));
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
  return { taller: (d.taller || "").trim(), fecha: fechaOk(d.fecha), total: Math.round(+d.total || 0), lineas, ivaRepartido: Math.round(+d.ivaAparte || 0), descRepartido: Math.round(+d.descuentoAparte || 0), model: r.model };
}

// prueba rápida de conexión (Ajustes → IA)
export async function probarConexion() {
  const r = await generar("texto", ["Responde solo con la palabra: OK"]);
  return r;
}
