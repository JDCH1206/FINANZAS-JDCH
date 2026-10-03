// js/views/settings.js
import { getState, setState, dataSnapshot } from "../state.js";
import { saveConfig, bulkSetTx, bulkSetIncomes, signOutUser, isCloud, forcePersistLocal,
  loadFuel, loadMaint, loadOblig, bulkSetAllFuel, bulkSetAllMaint, bulkSetAllOblig,
  persistFuelLocal, persistMaintLocal, persistObligLocal } from "../firebase-service.js";
import { classify, classifyIncome, DEFAULT_PAY_METHODS, RULE_503020 } from "../config.js";
import { uid, normDate, escapeHtml, fmt, ym, monthLabel, curMonth, sum, todayISO } from "../utils.js";
import { toast, confirmDialog, openModal, closeModal, submitOnce, moneyPreview } from "../components/modals.js";
import { notifSupported, notifEnabled, enableNotif, disableNotif } from "../notify.js";
import { gruposVariantes, openUnificarDescripciones } from "./unificar.js";
import { buildSankey, aportesNetos } from "./dashboard.js";
import { aiCfg, aiReady, DEFAULT_CHAINS, usoHoy, reiniciarUso, probarConexion, esLocal, analizarMes, requiereRecarga } from "../ai.js";

export function renderSettings(root, onSignOut) {
  const s = getState();
  root.innerHTML = `
    <h2 class="page-title disp">Ajustes</h2>
    <p class="page-sub">${escapeHtml(s.user.email)} · ${isCloud() ? "nube activa ☁" : "modo local"}</p>

    <div class="card mb-3">
      <div class="card-title">Perfil</div>
      <div class="field"><label class="label">Nombre</label><input id="p-name" class="input" value="${escapeHtml(s.profile.name)}"></div>
      <div class="field"><label class="label">Ingreso mensual estimado (COP)</label><input id="p-income" class="input" type="number" value="${s.profile.income}"></div>
      <button id="p-save" class="btn btn-primary btn-sm">Guardar perfil</button>
    </div>

    <div class="card mb-3">
      <div class="card-title">Importar gastos (Excel o JSON)</div>
      <p class="small muted mb-3">Excel: lee la hoja “Gastos” (usa Cat_Nueva/Subcat_Nueva o clasifica solo) y la hoja “IngresosFechas”. JSON: acepta un respaldo o un archivo con <code>txs</code>/<code>incomes</code>. Ambos <b>reemplazan</b> gastos e ingresos actuales (no tocan categorías, cuentas ni vehículos).</p>
      <div class="row gap-2 wrap">
        <input id="xls" type="file" accept=".xlsx,.xls" hidden>
        <button id="xls-btn" class="btn btn-primary btn-sm">⬆ Archivo .xlsx</button>
        <input id="gastos-json" type="file" accept=".json,application/json" hidden>
        <button id="gastos-json-btn" class="btn btn-primary btn-sm">⬆ Archivo .json</button>
      </div>
    </div>

    <div class="card mb-3">
      <div class="card-title">Respaldo</div>
      <p class="small muted mb-3">Descarga un respaldo (JSON) con <b>todos tus datos</b>: gastos, ingresos, cuentas, categorías, metas, recurrentes y también <b>combustible, mantenimiento y obligaciones</b> de tus vehículos. Restáuralo en otro equipo o guárdalo como copia de seguridad. El Excel exporta lo mismo en hojas separadas.</p>
      <div class="row gap-2 wrap">
        <button id="exp-json" class="btn btn-ghost btn-sm">⬇ Descargar respaldo</button>
        <input id="imp-json" type="file" accept=".json" hidden>
        <button id="imp-btn" class="btn btn-ghost btn-sm">⬆ Restaurar respaldo</button>
        <button id="exp-xls" class="btn btn-ghost btn-sm">⬇ Exportar a Excel</button>
      </div>
    </div>

    <div class="card mb-3">
      <div class="card-title">Limpieza de datos 🧹</div>
      <p class="small muted mb-3">Detecta gastos que son lo mismo escrito de varias formas (ej. "Almuerzo", "Almuerzos", "almuerzo") y te <b>recomienda</b> unificarlos. Tú eliges cuáles y cómo dejarlos.</p>
      <button id="unif-btn" class="btn btn-ghost btn-sm">🧹 Unificar descripciones${(() => { const n = gruposVariantes(getState()).length; return n ? ` (${n} sugerencias)` : ""; })()}</button>
    </div>

    ${isCloud() ? (() => { const c = aiCfg(); const uso = usoHoy(); const usados = Object.entries(uso);
      return `<div class="card mb-3">
      <div class="card-title">🤖 Inteligencia artificial (Gemini)</div>
      <p class="small muted mb-2">Lee <b>fotos de recibos</b> (Compra con varios productos) y <b>facturas del taller</b> (orden de trabajo) y llena los formularios para que los revises. También agrega un <b>análisis del mes</b> al reporte PDF. Usa Firebase AI Logic (plan gratis); la clave de Gemini la guarda Firebase, no la app.</p>
      <label class="row gap-2 small mb-2" style="align-items:center"><input type="checkbox" id="ai-on" ${c.enabled ? "checked" : ""}> <b>Activar IA</b></label>
      <div class="field"><label class="label">App Check: proveedor</label><select id="ai-prov" class="input">
        <option value="enterprise" ${c.proveedor === "enterprise" ? "selected" : ""}>Fraud Defense (reCAPTCHA Enterprise) — recomendado</option>
        <option value="v3" ${c.proveedor === "v3" ? "selected" : ""}>reCAPTCHA v3 (clásico)</option></select></div>
      <div class="field"><label class="label">Clave de sitio (App Check)</label><input id="ai-key" class="input" placeholder="6L…" value="${escapeHtml(c.siteKey)}">
        <div class="tiny muted mt-1">Pública (no es secreta). Protege tu cupo de IA. ${esLocal() ? "<b>Estás en el PC (localhost):</b> se usa el token de depuración; ábrelo con F12 → Consola (\"App Check debug token\") y regístralo en Firebase → App Check → tu app → Administrar tokens de depuración." : ""}</div></div>
      <details class="mb-2"><summary class="tiny muted" style="cursor:pointer">Modelos (cadena: si uno se agota, salta al siguiente)</summary>
        <div class="field mt-2"><label class="label">Fotos (recibos y facturas)</label><input id="ai-ch-vision" class="input" value="${escapeHtml(c.chains.vision.join(", "))}"></div>
        <div class="field"><label class="label">Texto</label><input id="ai-ch-texto" class="input" value="${escapeHtml(c.chains.texto.join(", "))}"></div>
        <div class="field"><label class="label">Análisis (reporte mensual)</label><input id="ai-ch-analisis" class="input" value="${escapeHtml(c.chains.analisis.join(", "))}"></div>
        <button id="ai-ch-reset" class="btn btn-ghost btn-sm">Restaurar modelos por defecto</button></details>
      <div class="row gap-2 wrap"><button id="ai-save" class="btn btn-primary btn-sm">Guardar</button><button id="ai-test" class="btn btn-ghost btn-sm">🔌 Probar conexión</button></div>
      <div id="ai-test-res" class="tiny mt-2"></div>
      <div class="tiny muted mt-2">Uso de hoy: ${usados.length ? usados.map(([m, u]) => `${escapeHtml(m)} ${u.n || 0}${u.agotado ? " (agotado)" : ""}${u.noExiste ? " (no disponible)" : ""}`).join(" · ") : "sin consultas"}${usados.length ? ` · <a href="#" id="ai-uso-reset">reiniciar contador</a>` : ""}</div>
    </div>`; })() : ""}

    <div class="card mb-3">
      <div class="card-title">Reporte mensual (PDF)</div>
      <p class="small muted mb-3">Genera el reporte de un mes (resumen, regla 50/30/20 y top categorías) listo para <b>imprimir o guardar como PDF</b> desde el diálogo de impresión del navegador.</p>
      <button id="rep-btn" class="btn btn-ghost btn-sm">🖨️ Generar reporte</button>
    </div>

    <div class="card mb-3">
      <div class="card-title">Gastos recurrentes 🔁</div>
      <p class="small muted mb-3">Tus gastos fijos (arriendo, suscripciones, servicios). Cada mes la app te los recuerda en <b>Movimientos</b> y los registras con un toque (puedes ajustar el monto antes de guardar).</p>
      <div id="rec-list" class="mb-3"></div>
      <button id="rec-add" class="btn btn-ghost btn-sm">+ Agregar gasto recurrente</button>
    </div>

    <div class="card mb-3">
      <div class="card-title">Medios de pago</div>
      <p class="small muted mb-3">Base: Efectivo, Transferencia, Tarjeta débito, Tarjeta crédito. Agrega los tuyos (ej: Nequi, Daviplata, PSE).</p>
      <div id="pay-list" class="row wrap gap-2 mb-3"></div>
      <div class="row gap-2">
        <input id="pay-new" class="input" placeholder="Nuevo medio de pago">
        <button id="pay-add" class="btn btn-ghost btn-sm">+</button>
      </div>
    </div>

    <div class="card mb-3">
      <div class="card-title">Apariencia</div>
      <button id="theme-toggle" class="btn btn-ghost btn-sm"></button>
    </div>

    <div class="card mb-3">
      <div class="card-title">Recordatorios 🔔</div>
      <p class="small muted mb-3">Avisos de vencimientos (SOAT, tecnomecánica, impuesto) y mantenimientos próximos. Aparecen al abrir la app (las notificaciones quedan en tu celular aunque la cierres).${!notifSupported() ? " <b>Tu navegador no los soporta.</b>" : ""}</p>
      <button id="notif-toggle" class="btn btn-sm"></button>
    </div>

    <div class="card mb-3">
      <div class="card-title">Ayuda</div>
      <button id="help-btn" class="btn btn-ghost btn-sm">📖 ¿Cómo funciona?</button>
    </div>

    <div class="card mb-3">
      <div class="card-title">Módulos opcionales</div>
      <p class="small muted mb-3">🚗 <b>Vehículos</b>: combustible, mantenimiento y obligaciones (SOAT, tecnomecánica, impuesto) con alarmas. Al activarlo aparece en el menú <b>"Más"</b> de la barra inferior.</p>
      <button id="veh-toggle" class="btn btn-sm"></button>
      <p class="small muted mb-3 mt-3">💳 <b>Deudas y préstamos</b>: a quién le debes, quién te debe y tarjetas de crédito (cupo, corte, pago) con abonos. También aparece en <b>"Más"</b>.</p>
      <button id="debt-toggle" class="btn btn-sm"></button>
    </div>

    <div class="card mb-3">
      <div class="card-title">Zona de peligro</div>
      <p class="small muted mb-3">Borra <b>todos</b> tus gastos e ingresos (y presupuestos) para volver a importar desde cero. Tu perfil, categorías y cuentas se conservan. No se puede deshacer.</p>
      <button id="wipe" class="btn btn-danger btn-sm btn-block">Borrar todos los movimientos</button>
    </div>

    <div class="card mb-3">
      <div class="card-title">Cuenta</div>
      <button id="logout" class="btn btn-danger btn-sm btn-block">Cerrar sesión</button>
    </div>

    <p class="tiny muted center">${isCloud() ? "Tus datos se sincronizan en Firebase. Ábrelos en cualquier equipo con tu correo." : "Sin Firebase: datos solo en este navegador. Configura firebase-config.js para nube + multi-dispositivo."}</p>
    <p class="tiny muted center" id="app-version" style="margin-top:6px">Finanzas JDCH · comprobando versión…</p>`;

  // versión activa (se lee del caché real del service worker, así siempre es exacta)
  const verEl = root.querySelector("#app-version");
  if (verEl) {
    if (window.caches && caches.keys) {
      caches.keys().then((keys) => {
        const v = (keys.find((k) => k.startsWith("finanzas-jdch-")) || "").replace("finanzas-jdch-", "");
        verEl.textContent = "Finanzas JDCH · versión " + (v || "—");
      }).catch(() => { verEl.textContent = "Finanzas JDCH"; });
    } else { verEl.textContent = "Finanzas JDCH"; }
  }

  // perfil
  root.querySelector("#p-save").onclick = async () => {
    const profile = { name: root.querySelector("#p-name").value.trim() || "Usuario", income: +root.querySelector("#p-income").value || 0 };
    setState({ profile });
    await saveConfig(s.user.uid, { profile, cats: s.cats, budgets: s.budgets }); forcePersistLocal(s.user.uid);
    toast("Perfil guardado");
  };

  // reporte mensual (PDF vía impresión del navegador)
  root.querySelector("#rep-btn").onclick = () => openReportModal();

  // import excel
  const xls = root.querySelector("#xls");
  root.querySelector("#xls-btn").onclick = () => xls.click();
  xls.onchange = async () => {
    const file = xls.files[0]; if (!file) return;
    try {
      const XLSX = await import("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { cellDates: true });
      const sheet = wb.Sheets["Gastos"] || wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
      const out = [];
      rows.forEach((r) => {
        const amount = +(r["Monto_Gasto"] ?? r["Monto"] ?? r["monto"] ?? 0);
        if (!amount) return;
        const date = normDate(r["Fecha_Gasto"] ?? r["Fecha"] ?? r["fecha"] ?? "");
        const desc = String(r["Descriciòn_Gastos"] ?? r["Descripción"] ?? r["desc"] ?? "");
        let cat = r["Cat_Nueva"], sub = r["Subcat_Nueva"];
        if (!cat) { const [c, sb] = classify(desc, r["Categoria"]); cat = c; sub = sb; }
        out.push({ id: uid(), date, desc, amount, cat: String(cat), sub: String(sub || "") });
      });
      setState({ txs: out });
      // ---- Ingresos (hoja IngresosFechas) ----
      let incOut = [];
      const incSheet = wb.Sheets["IngresosFechas"] || wb.Sheets["Ingresos"];
      if (incSheet) {
        const irows = XLSX.utils.sheet_to_json(incSheet, { defval: "" });
        irows.forEach((r) => {
          const amount = +(r["Monto_Ingreso"] ?? r["Monto"] ?? r["monto"] ?? 0);
          if (!amount) return;
          const date = normDate(r["Fecha_Ingreso"] ?? r["Fecha"] ?? r["fecha"] ?? "");
          const desc = String(r["Descripción_Ingreso"] ?? r["Descripcion_Ingreso"] ?? r["Descripción"] ?? r["desc"] ?? "");
          incOut.push({ id: uid(), date, desc, amount, type: classifyIncome(desc) });
        });
        setState({ incomes: incOut });
      }
      toast("Guardando " + out.length + " gastos y " + incOut.length + " ingresos...");
      await bulkSetTx(s.user.uid, out);
      if (incOut.length) await bulkSetIncomes(s.user.uid, incOut);
      forcePersistLocal(s.user.uid);
      toast(out.length + " gastos · " + incOut.length + " ingresos importados");
    } catch (e) { console.error(e); toast("Error al leer el Excel", true); }
    xls.value = "";
  };

  // import gastos desde JSON (respaldo o archivo con txs/incomes) — reemplaza gastos e ingresos
  const gjson = root.querySelector("#gastos-json");
  root.querySelector("#gastos-json-btn").onclick = () => gjson.click();
  gjson.onchange = async () => {
    const file = gjson.files[0]; if (!file) return;
    try {
      const d = JSON.parse(await file.text());
      const rawTx = Array.isArray(d) ? d : (d.txs || d.gastos || []);
      const rawInc = Array.isArray(d) ? [] : (d.incomes || d.ingresos || []);
      const out = [];
      rawTx.forEach((r) => {
        const amount = +(r.amount ?? r.Monto ?? r.monto ?? r.Monto_Gasto ?? 0);
        if (!amount) return;
        const date = normDate(r.date ?? r.fecha ?? r.Fecha ?? r.Fecha_Gasto ?? "");
        const desc = String(r.desc ?? r.descripcion ?? r["Descripción"] ?? r["Descriciòn_Gastos"] ?? "");
        let cat = r.cat ?? r.categoria ?? r.Categoria ?? r.Cat_Nueva;
        let sub = r.sub ?? r.subcategoria ?? r.Subcat_Nueva ?? "";
        if (!cat) { const [c, sb] = classify(desc, ""); cat = c; sub = sb; }
        out.push({ id: r.id || uid(), date, desc, amount, cat: String(cat), sub: String(sub || ""), pay: r.pay || "", acct: r.acct || "", vehicleId: r.vehicleId || "", fuelId: r.fuelId || "", maintId: r.maintId || "", obligId: r.obligId || "" });
      });
      const incOut = [];
      rawInc.forEach((r) => {
        const amount = +(r.amount ?? r.Monto ?? r.monto ?? 0);
        if (!amount) return;
        const date = normDate(r.date ?? r.fecha ?? r.Fecha ?? "");
        const desc = String(r.desc ?? r.descripcion ?? r["Descripción"] ?? "");
        incOut.push({ id: r.id || uid(), date, desc, amount, type: r.type || classifyIncome(desc) });
      });
      if (!out.length && !incOut.length) { toast("No se encontraron gastos en el JSON", true); gjson.value = ""; return; }
      confirmDialog(`El JSON trae ${out.length} gastos y ${incOut.length} ingresos. Esto <b>reemplaza</b> tus gastos e ingresos actuales (no toca categorías, cuentas ni vehículos). ¿Continuar?`, async () => {
        setState({ txs: out, incomes: incOut });
        toast("Guardando " + out.length + " gastos y " + incOut.length + " ingresos...");
        await bulkSetTx(s.user.uid, out);
        await bulkSetIncomes(s.user.uid, incOut);
        forcePersistLocal(s.user.uid);
        toast(out.length + " gastos · " + incOut.length + " ingresos importados");
      }, { yesLabel: "Importar", danger: false, busyLabel: "Importando…" });
    } catch (e) { console.error(e); toast("Error al leer el JSON", true); }
    gjson.value = "";
  };

  // backup json — incluye TODO: config, gastos, ingresos, combustible, mantenimiento y obligaciones
  // ---- Inteligencia artificial ----
  const aiSave = root.querySelector("#ai-save");
  if (aiSave) {
    const leerCadena = (id) => root.querySelector(id).value.split(",").map((x) => x.trim()).filter(Boolean);
    const guardarAI = async (extra = {}) => {
      const st = getState();
      const ai = { enabled: root.querySelector("#ai-on").checked, siteKey: root.querySelector("#ai-key").value.trim(), proveedor: root.querySelector("#ai-prov").value,
        chains: { vision: leerCadena("#ai-ch-vision"), texto: leerCadena("#ai-ch-texto"), analisis: leerCadena("#ai-ch-analisis") }, ...extra };
      const profile = { ...st.profile, ai };
      setState({ profile });
      await saveConfig(st.user.uid, { profile, cats: st.cats, budgets: st.budgets });
      forcePersistLocal(st.user.uid);
      // App Check ya se inició con la clave anterior en esta página: recargar para aplicar la nueva
      if (requiereRecarga()) { toast("Clave guardada. Recargando para aplicarla…"); setTimeout(() => location.reload(), 900); return true; }
    };
    submitOnce(aiSave, async () => { await guardarAI(); toast("IA: ajustes guardados"); renderSettings(root, onSignOut); });
    root.querySelector("#ai-ch-reset").onclick = () => { root.querySelector("#ai-ch-vision").value = DEFAULT_CHAINS.vision.join(", "); root.querySelector("#ai-ch-texto").value = DEFAULT_CHAINS.texto.join(", "); root.querySelector("#ai-ch-analisis").value = DEFAULT_CHAINS.analisis.join(", "); };
    const ur = root.querySelector("#ai-uso-reset"); if (ur) ur.onclick = (e) => { e.preventDefault(); reiniciarUso(); renderSettings(root, onSignOut); };
    submitOnce(root.querySelector("#ai-test"), async () => {
      const out = root.querySelector("#ai-test-res");
      if (await guardarAI()) return;
      out.textContent = "Probando…"; out.style.color = "";
      try {
        const r = await probarConexion();
        const saltos = r.intentos.length ? ` · se saltaron: ${r.intentos.map((x) => `${x.model} (${x.error})`).join(", ")}` : "";
        out.textContent = `✅ Conectado. Respondió ${r.model}: "${String(r.data).trim().slice(0, 40)}"${saltos}`; out.style.color = "var(--green)";
      } catch (e) {
        const det = e.intentos ? " · " + e.intentos.map((x) => `${x.model}: ${x.error}${x.detalle ? " — " + x.detalle : ""}`).join(" | ") : "";
        out.textContent = "⚠ " + (e.message || e) + det; out.style.color = "var(--red)";
      }
    }, "Probando…");
  }
  root.querySelector("#unif-btn").onclick = () => openUnificarDescripciones(() => renderSettings(root, onSignOut));
  root.querySelector("#exp-json").onclick = async () => {
    const btn = root.querySelector("#exp-json"); const orig = btn.textContent;
    btn.disabled = true; btn.textContent = "Preparando…";
    try {
      const [fuel, maintenance, obligations] = await Promise.all([
        loadFuel(s.user.uid), loadMaint(s.user.uid), loadOblig(s.user.uid),
      ]);
      const data = { ...dataSnapshot(), fuel, maintenance, obligations };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
      a.download = "finanzas_respaldo_" + new Date().toISOString().slice(0, 10) + ".json"; a.click();
      localStorage.setItem("fz_last_backup", new Date().toISOString().slice(0, 10));
      toast(`Respaldo descargado (${(data.txs || []).length} gastos · ${fuel.length} tanqueos · ${maintenance.length} mant. · ${obligations.length} oblig.)`);
    } catch (e) { console.error(e); toast("No se pudo preparar el respaldo", true); }
    btn.disabled = false; btn.textContent = orig;
  };
  const impJson = root.querySelector("#imp-json");
  root.querySelector("#imp-btn").onclick = () => impJson.click();
  impJson.onchange = async () => {
    const file = impJson.files[0]; if (!file) return;
    try {
      const d = JSON.parse(await file.text());
      setState({ profile: d.profile || s.profile, cats: d.cats || s.cats, budgets: d.budgets || {}, txs: d.txs || [], incomes: d.incomes || [], accounts: d.accounts || [], payMethods: d.payMethods || [], vehicles: d.vehicles || [], vehiclesEnabled: d.vehiclesEnabled || false, goals: d.goals || [], recurrentes: d.recurrentes || [], debts: d.debts || [], debtsEnabled: d.debtsEnabled || false, snapshots: d.snapshots || [] });
      await saveConfig(s.user.uid, { profile: d.profile || s.profile, cats: d.cats || s.cats, budgets: d.budgets || {}, accounts: d.accounts || [], payMethods: d.payMethods || [], vehicles: d.vehicles || [], vehiclesEnabled: d.vehiclesEnabled || false, goals: d.goals || [], recurrentes: d.recurrentes || [], debts: d.debts || [], debtsEnabled: d.debtsEnabled || false, snapshots: d.snapshots || [] });
      await bulkSetTx(s.user.uid, d.txs || []);
      await bulkSetIncomes(s.user.uid, d.incomes || []);
      // subcolecciones (cada helper actúa solo en su modo: bulkSetAll* en nube, persist* en local)
      await bulkSetAllFuel(s.user.uid, d.fuel || []);
      await bulkSetAllMaint(s.user.uid, d.maintenance || []);
      await bulkSetAllOblig(s.user.uid, d.obligations || []);
      persistFuelLocal(s.user.uid, d.fuel || []);
      persistMaintLocal(s.user.uid, d.maintenance || []);
      persistObligLocal(s.user.uid, d.obligations || []);
      forcePersistLocal(s.user.uid);
      toast(`Respaldo restaurado (${(d.txs || []).length} gastos · ${(d.fuel || []).length} tanqueos · ${(d.maintenance || []).length} mant. · ${(d.obligations || []).length} oblig.)`);
    } catch (e) { console.error(e); toast("Archivo inválido", true); }
    impJson.value = "";
  };
  root.querySelector("#exp-xls").onclick = async () => {
    const btn = root.querySelector("#exp-xls"); const orig = btn.textContent;
    btn.disabled = true; btn.textContent = "Preparando…";
    try {
      const XLSX = await import("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm");
      const [fuel, maintenance, obligations] = await Promise.all([
        loadFuel(s.user.uid), loadMaint(s.user.uid), loadOblig(s.user.uid),
      ]);
      const vName = (id) => (s.vehicles.find((v) => v.id === id) || {}).alias || (s.vehicles.find((v) => v.id === id) || {}).modelo || "";
      const wb = XLSX.utils.book_new();
      const wsG = XLSX.utils.json_to_sheet(s.txs.map((t) => ({ Fecha: t.date, Descripción: t.desc, Monto: t.amount, Categoría: t.cat, Subcategoría: t.sub, "Medio de pago": t.pay || "", Cuenta: (s.accounts.find((a) => a.id === t.acct) || {}).name || "" })));
      XLSX.utils.book_append_sheet(wb, wsG, "Gastos");
      if (s.incomes.length) {
        const wsI = XLSX.utils.json_to_sheet(s.incomes.map((t) => ({ Fecha: t.date, Descripción: t.desc, Monto: t.amount, Tipo: t.type })));
        XLSX.utils.book_append_sheet(wb, wsI, "Ingresos");
      }
      if (s.accounts.length) {
        const wsA = XLSX.utils.json_to_sheet(s.accounts.map((a) => ({ Cuenta: a.name, Tipo: a.type, Saldo: a.balance })));
        XLSX.utils.book_append_sheet(wb, wsA, "Cuentas");
      }
      if (fuel.length) {
        const wsF = XLSX.utils.json_to_sheet(fuel.map((r) => ({ Vehículo: vName(r.vehicleId), Fecha: r.fecha, Estación: r.estacion || "", "Tipo combustible": r.tipoCombustible || "", Galones: r.galones, "Odómetro": r.odometro, Costo: r.costo, "Tanque lleno": r.tanqueLleno })));
        XLSX.utils.book_append_sheet(wb, wsF, "Combustible");
      }
      if (maintenance.length) {
        const wsM = XLSX.utils.json_to_sheet(maintenance.map((r) => ({ Vehículo: vName(r.vehicleId), Fecha: r.fecha, Categoría: r.categoria || "", Tipo: r.tipo || "", "Odómetro": r.odometro, Descripción: r.descripcion || "", Repuesto: r.repuesto || "", Taller: r.taller || "", Costo: r.costo })));
        XLSX.utils.book_append_sheet(wb, wsM, "Mantenimiento");
      }
      if (obligations.length) {
        const wsO = XLSX.utils.json_to_sheet(obligations.map((r) => ({ Vehículo: vName(r.vehicleId), Tipo: r.tipo || "", "Fecha expedición": r.fechaExpedicion || "", "Fecha vencimiento": r.fechaVencimiento || "", Costo: r.costo, Entidad: r.entidad || "", "N°/referencia": r.numero || "", Estado: r.estado || "" })));
        XLSX.utils.book_append_sheet(wb, wsO, "Obligaciones");
      }
      XLSX.writeFile(wb, "finanzas_export_" + new Date().toISOString().slice(0, 10) + ".xlsx");
      toast("Excel exportado");
    } catch (e) { console.error(e); toast("No se pudo exportar", true); }
    btn.disabled = false; btn.textContent = orig;
  };

  root.querySelector("#wipe").onclick = () => confirmDialog("¿Borrar TODOS los gastos e ingresos? Esto no se puede deshacer.", async () => {
    const btn = root.querySelector("#wipe"); btn.disabled = true; btn.textContent = "Borrando...";
    try {
      setState({ txs: [], incomes: [], budgets: {} });
      await bulkSetTx(s.user.uid, []);
      await bulkSetIncomes(s.user.uid, []);
      await saveConfig(s.user.uid, { profile: s.profile, cats: s.cats, budgets: {}, accounts: s.accounts, payMethods: getState().payMethods });
      forcePersistLocal(s.user.uid);
      toast("Datos borrados. Ahora puedes reimportar.");
      renderSettings(root, onSignOut);
    } catch (e) {
      console.error(e); toast("Error al borrar", true);
      btn.disabled = false; btn.textContent = "Borrar todos los movimientos";
    }
  });

  // ayuda — guía rápida
  root.querySelector("#help-btn").onclick = () => openModal("Guía rápida", `
    <div style="font-size:13.5px;line-height:1.55;max-height:60vh;overflow:auto">
      <p><b>📊 Resumen</b> — tu panorama: disponible, balance, tasa de ahorro y metas de ahorro.</p>
      <p><b>🧾 Movimientos</b> — registra gastos e ingresos con el botón <b>+</b>. Toca una línea para editarla. Filtra por mes, categoría o monto.</p>
      <p><b>📈 Tablero</b> — análisis: regla 50/30/20, tendencias, comparativos y recomendación de gasto según tu salario.</p>
      <p><b>💰 Presupuesto</b> — define topes por categoría; te avisa si te pasas.</p>
      <p><b>🏦 Cuentas</b> — registra dónde tienes tu dinero (alimenta "Disponible" y "Colchón").</p>
      <p><b>🏷️ Categorías</b> — crea, renombra o elimina categorías y subcategorías.</p>
      <p><b>🚗 Más → Vehículos</b> (opcional) — combustible (rendimiento, costo/km), mantenimiento (Taller/Rutina) y obligaciones (SOAT, tecnomecánica, impuesto) con alarmas de vencimiento.</p>
      <p><b>⚙️ Ajustes</b> — respaldo, tema claro/oscuro, importar/exportar, activar el módulo de vehículos.</p>
      <p class="muted" style="margin-top:10px">💡 Tus datos se guardan en la nube y se sincronizan entre tus dispositivos en tiempo real. Funciona sin conexión: los cambios se suben al volver.</p>
    </div>`);

  // tema claro/oscuro
  const themeBtn = root.querySelector("#theme-toggle");
  const paintTheme = () => { const light = document.documentElement.getAttribute("data-theme") === "light"; themeBtn.textContent = light ? "🌙 Cambiar a tema oscuro" : "☀️ Cambiar a tema claro"; };
  paintTheme();
  themeBtn.onclick = () => {
    const next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("fz_theme", next);
    paintTheme();
  };

  // activar/desactivar módulo de Vehículos
  const vehBtn = root.querySelector("#veh-toggle");
  const paintVeh = () => {
    const on = getState().vehiclesEnabled;
    vehBtn.textContent = on ? "✓ Vehículos activado" : "Activar Vehículos";
    vehBtn.className = "btn btn-sm " + (on ? "btn-primary" : "btn-ghost");
  };
  paintVeh();
  vehBtn.onclick = async () => {
    const on = !getState().vehiclesEnabled;
    setState({ vehiclesEnabled: on });
    const s2 = getState();
    await saveConfig(s2.user.uid, { profile: s2.profile, cats: s2.cats, budgets: s2.budgets, accounts: s2.accounts, payMethods: s2.payMethods, vehicles: s2.vehicles, vehiclesEnabled: on });
    forcePersistLocal(s2.user.uid);
    paintVeh();
    toast(on ? "Módulo de Vehículos activado — míralo en 'Más'" : "Módulo de Vehículos desactivado");
  };

  // activar/desactivar módulo de Deudas
  const debtBtn = root.querySelector("#debt-toggle");
  const paintDebt = () => {
    const on = getState().debtsEnabled;
    debtBtn.textContent = on ? "✓ Deudas activado" : "Activar Deudas y préstamos";
    debtBtn.className = "btn btn-sm " + (on ? "btn-primary" : "btn-ghost");
  };
  paintDebt();
  debtBtn.onclick = async () => {
    const on = !getState().debtsEnabled;
    setState({ debtsEnabled: on });
    const s2 = getState();
    await saveConfig(s2.user.uid, { profile: s2.profile, cats: s2.cats, budgets: s2.budgets, debts: s2.debts, debtsEnabled: on });
    forcePersistLocal(s2.user.uid);
    paintDebt();
    toast(on ? "Módulo de Deudas activado — míralo en 'Más'" : "Módulo de Deudas desactivado");
  };

  root.querySelector("#logout").onclick = () => confirmDialog("¿Cerrar sesión?", async () => { await signOutUser(); onSignOut(); }, { yesLabel: "Cerrar sesión" });

  // gastos recurrentes
  drawRec(root);
  root.querySelector("#rec-add").onclick = () => openRecModal(root, null);

  // recordatorios (notificaciones)
  const notifBtn = root.querySelector("#notif-toggle");
  const paintNotif = () => {
    if (!notifSupported()) { notifBtn.textContent = "No disponible en este navegador"; notifBtn.disabled = true; notifBtn.className = "btn btn-ghost btn-sm"; return; }
    const on = notifEnabled();
    notifBtn.textContent = on ? "🔔 Activados · tocar para desactivar" : "🔕 Activar recordatorios";
    notifBtn.className = "btn btn-sm " + (on ? "btn-primary" : "btn-ghost");
  };
  paintNotif();
  notifBtn.onclick = async () => {
    if (notifEnabled()) { disableNotif(); toast("Recordatorios desactivados"); paintNotif(); return; }
    const res = await enableNotif();
    if (res === "granted") toast("Recordatorios activados");
    else if (res === "denied") toast("Permiso bloqueado. Actívalo en los ajustes del navegador.", true);
    else toast("Tu navegador no soporta notificaciones", true);
    paintNotif();
  };

  // medios de pago
  const drawPays = () => {
    const list = root.querySelector("#pay-list");
    const base = ["Efectivo", "Transferencia", "Tarjeta débito", "Tarjeta crédito"];
    const custom = getState().payMethods || [];
    list.innerHTML = base.map((p) => `<span class="badge">${escapeHtml(p)}</span>`).join("") +
      custom.map((p) => `<span class="badge" style="background:var(--panel-2);color:var(--ink)">${escapeHtml(p)} <b data-rmpay="${escapeHtml(p)}" style="cursor:pointer;color:var(--red)">✕</b></span>`).join("");
    list.querySelectorAll("[data-rmpay]").forEach((b) => b.onclick = async () => {
      const p = b.getAttribute("data-rmpay");
      setState({ payMethods: (getState().payMethods || []).filter((x) => x !== p) });
      await saveConfig(s.user.uid, { profile: s.profile, cats: s.cats, budgets: s.budgets, accounts: s.accounts, payMethods: getState().payMethods }); forcePersistLocal(s.user.uid);
      drawPays();
    });
  };
  drawPays();
  root.querySelector("#pay-add").onclick = async () => {
    const v = root.querySelector("#pay-new").value.trim();
    if (!v) return;
    const cur = getState().payMethods || [];
    if (cur.includes(v)) return toast("Ya existe", true);
    setState({ payMethods: [...cur, v] });
    await saveConfig(s.user.uid, { profile: s.profile, cats: s.cats, budgets: s.budgets, accounts: s.accounts, payMethods: getState().payMethods }); forcePersistLocal(s.user.uid);
    root.querySelector("#pay-new").value = ""; drawPays(); toast("Medio agregado");
  };
}

/* ===================== REPORTE MENSUAL (PDF) ===================== */
// Usa la impresión del navegador (Guardar como PDF). Cero dependencias.
// El reporte se imprime en un documento APARTE (iframe) que solo existe en claro: así el tema
// oscuro de la app y el "tema oscuro para sitios" de Chrome no lo oscurecen al guardar el PDF.
const REPORT_CSS = `:root{color-scheme:only light;--bg:#fff;--panel:#fff;--panel-2:#eee;--ink:#1a1a1a;--sub:#666;--gold:#9a6a1a;--green:#2f7d46;--red:#b34a30;--line:#ddd}
  html,body{margin:0;background:#fff!important;color:#1a1a1a;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .tiny{font-size:11px}.small{font-size:13px}.muted{color:#666}.bold{font-weight:700}.flex1{flex:1}
  .row{display:flex;gap:8px}.between{justify-content:space-between}.ellipsis{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  @page{margin:12mm}`;

function openReportModal() {
  const s = getState();
  const months = [...new Set(s.txs.map((t) => ym(t.date)).filter(Boolean)), curMonth()];
  const allMonths = [...new Set(months)].sort().reverse();
  openModal("Reporte mensual", `
    <div class="field"><label class="label">Mes</label>
      <select id="rep-mes" class="input">${allMonths.map((m) => `<option value="${m}">${monthLabel(m)}</option>`).join("")}</select></div>
    ${aiReady() ? `<label class="row gap-2 small mb-2" style="align-items:center"><input type="checkbox" id="rep-ai" checked> ✨ Incluir análisis del mes con IA</label>` : ""}
    <p class="tiny muted mb-3">Se abrirá el diálogo de impresión: elige <b>"Guardar como PDF"</b> como destino para archivarlo o compartirlo.</p>
    <div id="rep-st" class="tiny mb-2"></div>
    <button id="rep-go" class="btn btn-primary btn-block">Generar</button>`, {
    onMount(b) {
      submitOnce(b.querySelector("#rep-go"), async () => {
        const mes = b.querySelector("#rep-mes").value;
        const conIA = b.querySelector("#rep-ai") && b.querySelector("#rep-ai").checked;
        let analisis = null;
        if (conIA) {
          const st = b.querySelector("#rep-st");
          st.textContent = "⏳ Analizando el mes con IA… (puede tardar unos segundos)"; st.style.color = "";
          try { analisis = await analizarMes(datosMes(getState(), mes)); }
          catch (e) {
            st.innerHTML = `⚠ No se pudo generar el análisis: ${escapeHtml(e.message || String(e))}. Vuelve a tocar Generar o desmarca la IA.`;
            st.style.color = "var(--red)"; return;
          }
        }
        closeModal();
        printReport(mes, analisis);
      }, "Generando…");
    },
  });
}

export function printReport(mes, analisis) {
  const old = document.getElementById("print-frame"); if (old) old.remove();
  const fr = document.createElement("iframe"); fr.id = "print-frame";
  fr.setAttribute("aria-hidden", "true");
  fr.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(fr);
  const d = fr.contentDocument;
  d.open();
  d.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="color-scheme" content="only light">
    <title>Finanzas JDCH · Reporte ${escapeHtml(monthLabel(mes))}</title><style>${REPORT_CSS}</style></head>
    <body>${buildReportHTML(getState(), mes, analisis)}</body></html>`);
  d.close();
  const w = fr.contentWindow;
  w.onafterprint = () => setTimeout(() => fr.remove(), 500);
  // pequeña espera para que el navegador termine de pintar (diagramas y fuentes) antes de imprimir
  setTimeout(() => { w.focus(); w.print(); }, 350);
}

// Cifras del mes que se envían a la IA para el análisis (todo calculado aquí, exacto)
export function datosMes(s, mes) {
  const prev = (m) => { const [y, mo] = m.split("-").map(Number); return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`; };
  const mAnt = prev(mes);
  const ult12 = []; let k = mes; for (let i = 0; i < 12; i++) { k = prev(k); ult12.push(k); }
  const gastosDe = (m) => s.txs.filter((t) => ym(t.date) === m), ingDe = (m) => s.incomes.filter((t) => ym(t.date) === m);
  const porCat = (arr) => { const o = {}; arr.forEach((t) => { o[t.cat] = (o[t.cat] || 0) + (+t.amount || 0); }); return o; };
  const mAnio = `${+mes.slice(0, 4) - 1}-${mes.slice(5, 7)}`;
  const ex = gastosDe(mes), exAnt = gastosDe(mAnt), exAnio = gastosDe(mAnio);
  const cat = porCat(ex), catAnt = porCat(exAnt), catAnio = porCat(exAnio);
  const prom = {}; ult12.forEach((m) => { const o = porCat(gastosDe(m)); Object.entries(o).forEach(([c, v]) => { prom[c] = (prom[c] || 0) + v / 12; }); });
  const typeMap = Object.fromEntries(s.cats.map((c) => [c.name, c.type]));
  const b503 = { Necesidad: 0, Deseo: 0, Deuda: 0 }; ex.forEach((t) => { const ty = typeMap[t.cat]; if (ty) b503[ty] += +t.amount || 0; });
  const grupos = {}; ex.forEach((t) => { const d = (t.desc || "").trim(); const g = grupos[d] || (grupos[d] = { descripcion: d, veces: 0, total: 0 }); g.veces++; g.total += +t.amount || 0; });
  const ing = sum(ingDe(mes), (t) => t.amount), gas = sum(ex, (t) => t.amount);
  const r = (n) => Math.round(n || 0);
  return {
    mes: monthLabel(mes), ingresos: r(ing), gastos: r(gas), balance: r(ing - gas), tasaAhorroPct: ing ? r(((ing - gas) / ing) * 100) : null,
    mesAnterior: { mes: monthLabel(mAnt), ingresos: r(sum(ingDe(mAnt), (t) => t.amount)), gastos: r(sum(exAnt, (t) => t.amount)) },
    mismoMesAnioAnterior: { mes: monthLabel(mAnio), ingresos: r(sum(ingDe(mAnio), (t) => t.amount)), gastos: r(sum(exAnio, (t) => t.amount)), hayDatos: exAnio.length > 0 },
    promedio12MesesGastos: r(ult12.reduce((a, m) => a + sum(gastosDe(m), (t) => t.amount), 0) / 12),
    regla503020: { necesidades: r(b503.Necesidad), deseos: r(b503.Deseo), deudaInversion: r(b503.Deuda), referenciaPct: RULE_503020 },
    porCategoria: Object.keys({ ...cat, ...catAnt }).map((c) => ({ categoria: c, mes: r(cat[c]), mesAnterior: r(catAnt[c]), mismoMesAnioAnterior: r(catAnio[c]), promedio12m: r(prom[c]) })).sort((a, b) => b.mes - a.mes),
    gastosMasGrandes: [...ex].sort((a, b) => (+b.amount || 0) - (+a.amount || 0)).slice(0, 8).map((t) => ({ descripcion: t.desc, categoria: t.cat, valor: r(t.amount) })),
    masRepetidos: Object.values(grupos).filter((g) => g.veces >= 2).sort((a, b) => b.total - a.total).slice(0, 8).map((g) => ({ ...g, total: r(g.total) })),
    numeroDeGastos: ex.length,
    // el ahorro NO es gasto: va como aportes a cuentas (un aporte de los últimos 7 días del mes cuenta
    // para el mes siguiente si ese mes tiene un ingreso entre el día 1 y 3, igual que en la conciliación)
    ahorroEnCuentas: (() => {
      const mesDeAporte = (d) => {
        const [y, mo, day] = d.split("-").map(Number); const fin = new Date(y, mo, 0).getDate();
        const sig = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
        return day >= fin - 6 && s.incomes.some((t) => (t.date || "").startsWith(sig) && +(t.date || "").slice(8, 10) <= 3) ? sig : d.slice(0, 7);
      };
      const movs = (s.accounts || []).filter((a) => a.type !== "Por cobrar").flatMap((a) => a.movs || []);
      const aportes = movs.filter((m) => m.date && m.kind !== "rendimiento" && m.kind !== "transfer" && mesDeAporte(m.date) === mes);
      const rend = movs.filter((m) => m.kind === "rendimiento" && ym(m.date) === mes);
      return { aportesNetos: r(sum(aportes, (m) => m.amount)), rendimientos: r(sum(rend, (m) => m.amount)),
        nota: "Los aportes a cuentas de ahorro/inversión son el ahorro real del mes; no aparecen como gasto, por eso 'deudaInversion' de la regla 50/30/20 puede verse en 0." };
    })(),
  };
}

export function buildReportHTML(s, mes, analisis) {
  const prevMes = (m) => { const [y, mo] = m.split("-").map(Number); return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`; };
  const mAnt = prevMes(mes), mAnio = `${+mes.slice(0, 4) - 1}-${mes.slice(5, 7)}`;
  const ult12 = []; { let k = mes; for (let i = 0; i < 12; i++) { k = prevMes(k); ult12.push(k); } }
  const gastosDe = (m) => s.txs.filter((t) => ym(t.date) === m);
  const ingDe = (m) => s.incomes.filter((t) => ym(t.date) === m);
  const porCat = (arr) => { const o = {}; arr.forEach((t) => { o[t.cat] = (o[t.cat] || 0) + (+t.amount || 0); }); return o; };
  const resumen = (m) => {
    const ex = gastosDe(m), i = sum(ingDe(m), (t) => t.amount), g = sum(ex, (t) => t.amount);
    const [Y, M] = m.split("-").map(Number), dias = new Date(Y, M, 0).getDate();
    return { ing: i, gas: g, bal: i - g, tasa: i ? ((i - g) / i) * 100 : null, n: ex.length, diario: g / dias, hay: ex.length > 0 || i > 0 };
  };
  const R = resumen(mes), RA = resumen(mAnt), RY = resumen(mAnio);
  const exMes = gastosDe(mes);
  const { ing, gas, bal } = R;
  const tasa = R.tasa || 0;

  const typeMap = Object.fromEntries(s.cats.map((c) => [c.name, c.type]));
  const buck = { Necesidad: 0, Deseo: 0, Deuda: 0 };
  exMes.forEach((t) => { const ty = typeMap[t.cat]; if (ty) buck[ty] += (+t.amount || 0); });

  const byCat = porCat(exMes), catAnt = porCat(gastosDe(mAnt)), catAnio = porCat(gastosDe(mAnio));
  const prom12 = {}; ult12.forEach((m) => Object.entries(porCat(gastosDe(m))).forEach(([c, v]) => { prom12[c] = (prom12[c] || 0) + v / 12; }));
  const topCats = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 10);

  const accts = s.accounts || [];
  const liq = accts.filter((a) => a.type !== "Por cobrar");
  const disp = sum(liq, (a) => a.balance);

  const c = { ink: "#1a1a1a", sub: "#666", line: "#ddd", gold: "#9a6a1a", green: "#2f7d46", red: "#b34a30" };
  const sec = (titulo, html) => `<div style="break-inside:avoid;page-break-inside:avoid;margin-bottom:20px"><h3 style="font-size:15px;margin:0 0 6px;color:${c.gold}">${titulo}</h3>${html}</div>`;
  const row = (k, v, col) => `<tr><td style="padding:6px 0;border-top:1px solid ${c.line};color:${c.sub}">${escapeHtml(k)}</td><td style="padding:6px 0;border-top:1px solid ${c.line};text-align:right;font-weight:600;color:${col || c.ink}">${v}</td></tr>`;
  const td = (v, extra = "") => `<td style="padding:5px 4px;border-top:1px solid ${c.line};${extra}">${v}</td>`;
  const th = (v, al = "right") => `<th style="padding:5px 4px;text-align:${al};font-weight:600;color:${c.sub};font-size:11px">${v}</th>`;
  // variación porcentual; para gastos subir es malo (rojo), para ingresos/ahorro subir es bueno (verde)
  const delta = (a, b, bueno = "baja") => {
    if (!b) return `<span style="color:${c.sub}">—</span>`;
    const p = ((a - b) / Math.abs(b)) * 100;
    if (Math.abs(p) < 0.5) return `<span style="color:${c.sub}">=</span>`;
    const ok = bueno === "baja" ? p < 0 : p > 0;
    return `<span style="color:${ok ? c.green : c.red}">${p > 0 ? "▲" : "▼"} ${Math.abs(p) > 999 ? ">999" : Math.abs(p).toFixed(0)}%</span>`;
  };
  const pct = (v) => (v == null ? "—" : `${v.toFixed(0)}%`);
  const lbl503 = { Necesidad: "Necesidades", Deseo: "Deseos", Deuda: "Deuda/Inversión" };

  // ---- 1. Comparativo: este mes vs mes anterior vs mismo mes del año anterior ----
  const comp = [
    ["Ingresos", R.ing, RA.ing, RY.ing, "sube", fmt],
    ["Gastos", R.gas, RA.gas, RY.gas, "baja", fmt],
    ["Balance (sobrante)", R.bal, RA.bal, RY.bal, "sube", fmt],
    ["Tasa de ahorro", R.tasa, RA.tasa, RY.tasa, "sube", pct],
    ["N.º de gastos", R.n, RA.n, RY.n, "baja", (v) => String(v)],
    ["Gasto promedio por día", R.diario, RA.diario, RY.diario, "baja", fmt],
  ];
  const compHTML = `<table style="width:100%;border-collapse:collapse;font-size:12.5px">
    <tr>${th("", "left")}${th(escapeHtml(monthLabel(mes)))}${th(escapeHtml(monthLabel(mAnt)))}${th("Δ")}${th(escapeHtml(monthLabel(mAnio)))}${th("Δ")}</tr>
    ${comp.map(([k, a, b, y, bueno, f]) => `<tr>${td(escapeHtml(k), `color:${c.sub}`)}${td(`<b>${f(a)}</b>`, "text-align:right")}${td(RA.hay ? f(b) : "—", "text-align:right")}${td(RA.hay && a != null && b != null ? (k === "Tasa de ahorro" ? `<span style="color:${a >= b ? c.green : c.red}">${a >= b ? "▲" : "▼"} ${Math.abs(a - b).toFixed(0)} pts</span>` : delta(a, b, bueno)) : "—", "text-align:right")}${td(RY.hay ? f(y) : "—", "text-align:right")}${td(RY.hay && a != null && y != null ? (k === "Tasa de ahorro" ? `<span style="color:${a >= y ? c.green : c.red}">${a >= y ? "▲" : "▼"} ${Math.abs(a - y).toFixed(0)} pts</span>` : delta(a, y, bueno)) : "—", "text-align:right")}</tr>`).join("")}
  </table>${!RY.hay ? `<div style="font-size:11px;color:${c.sub};margin-top:4px">Sin registros de ${escapeHtml(monthLabel(mAnio))} para comparar con el año anterior.</div>` : ""}`;

  // ---- 2. Flujo del dinero (mismo diagrama de cintas del Tablero) ----
  const abono = aportesNetos(s, (t) => (t.date || "").startsWith(mes));
  const sankeyHTML = buildSankey(ing, byCat, "del mes", abono, { impreso: true });

  // ---- 3. Categorías con variaciones ----
  const catsHTML = topCats.length ? `<table style="width:100%;border-collapse:collapse;font-size:12px">
    <tr>${th("Categoría", "left")}${th(escapeHtml(monthLabel(mes)))}${th("% del gasto")}${th("vs " + escapeHtml(monthLabel(mAnt)))}${th("vs " + escapeHtml(monthLabel(mAnio)))}${th("Prom. 12m")}</tr>
    ${topCats.map(([n, v]) => `<tr>${td(escapeHtml(n))}${td(`<b>${fmt(v)}</b>`, "text-align:right")}${td(gas ? ((v / gas) * 100).toFixed(0) + "%" : "—", "text-align:right")}${td(delta(v, catAnt[n] || 0), "text-align:right")}${td(delta(v, catAnio[n] || 0), "text-align:right")}${td(fmt(prom12[n] || 0), `text-align:right;color:${c.sub}`)}</tr>`).join("")}
  </table>` : `<div style="color:${c.sub};font-size:13px">Sin gastos este mes</div>`;

  // ---- 4. Presupuesto vs real ----
  const bud = (s.budgets || {})[mes] || {};
  const tope = (n) => (+bud[n] || 0) || ((+bud[n + "__pct"] || 0) / 100) * ((s.profile && s.profile.income) || 0);
  const presu = s.cats.map((x) => ({ n: x.name, tope: tope(x.name), real: byCat[x.name] || 0 })).filter((x) => x.tope > 0).sort((a, b) => (b.real / b.tope) - (a.real / a.tope));
  const presuHTML = presu.length ? `<table style="width:100%;border-collapse:collapse;font-size:12px">
    <tr>${th("Categoría", "left")}${th("Presupuesto")}${th("Real")}${th("Ejecución", "left")}</tr>
    ${presu.map((x) => { const p = (x.real / x.tope) * 100, col = p > 110 ? c.red : p > 100 ? "#c08a1a" : c.green;
      return `<tr>${td(escapeHtml(x.n))}${td(fmt(x.tope), "text-align:right")}${td(`<b>${fmt(x.real)}</b>`, "text-align:right")}${td(`<div style="display:flex;align-items:center;gap:6px"><div style="flex:1;height:7px;background:#eee;border-radius:4px;overflow:hidden"><div style="width:${Math.min(100, p)}%;height:100%;background:${col}"></div></div><span style="color:${col};font-weight:600;min-width:38px;text-align:right">${p.toFixed(0)}%</span></div>`, "width:38%")}</tr>`; }).join("")}
    <tr>${td("<b>Total</b>")}${td(fmt(sum(presu, (x) => x.tope)), "text-align:right")}${td(`<b>${fmt(sum(presu, (x) => x.real))}</b>`, "text-align:right")}${td("")}</tr>
  </table>` : "";

  // ---- 5. Mapa de calor por día + gasto por día de la semana ----
  const [Y, M] = mes.split("-").map(Number), dim = new Date(Y, M, 0).getDate(), firstDow = (new Date(Y, M - 1, 1).getDay() + 6) % 7;
  const byDay = {}; exMes.forEach((t) => { const d = +(t.date || "").slice(8, 10); if (d) byDay[d] = (byDay[d] || 0) + (+t.amount || 0); });
  const maxDay = Math.max(1, ...Object.values(byDay));
  const celdas = [];
  for (let i = 0; i < firstDow; i++) celdas.push(`<div></div>`);
  for (let d = 1; d <= dim; d++) {
    const v = byDay[d] || 0, a = v ? (0.12 + 0.7 * (v / maxDay)).toFixed(2) : 0;
    celdas.push(`<div style="border:1px solid ${c.line};border-radius:5px;min-height:34px;padding:2px 4px;background:rgba(154,106,26,${a});font-size:9.5px;display:flex;flex-direction:column;justify-content:space-between"><span style="color:${c.sub}">${d}</span>${v ? `<b style="color:${c.ink}">${fmtShortR(v)}</b>` : ""}</div>`);
  }
  const dowNom = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"], dow = [0, 0, 0, 0, 0, 0, 0];
  Object.entries(byDay).forEach(([d, v]) => { dow[(new Date(Y, M - 1, +d).getDay() + 6) % 7] += v; });
  const maxDow = Math.max(1, ...dow);
  const diaTop = Object.entries(byDay).sort((a, b) => b[1] - a[1])[0];
  const calHTML = `<div style="display:grid;grid-template-columns:1.6fr 1fr;gap:16px;align-items:start">
    <div><div style="display:grid;grid-template-columns:repeat(7,1fr);gap:3px;margin-bottom:3px">${["L", "M", "M", "J", "V", "S", "D"].map((x) => `<div style="text-align:center;font-size:10px;color:${c.sub}">${x}</div>`).join("")}</div>
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:3px">${celdas.join("")}</div></div>
    <div style="font-size:11.5px">
      <div style="color:${c.sub};margin-bottom:4px">Gasto por día de la semana</div>
      ${dow.map((v, i) => `<div style="display:flex;align-items:center;gap:6px;margin:3px 0"><span style="width:28px;color:${c.sub}">${dowNom[i]}</span><div style="flex:1;height:8px;background:#eee;border-radius:4px;overflow:hidden"><div style="width:${(v / maxDow) * 100}%;height:100%;background:${c.gold}"></div></div><span style="min-width:58px;text-align:right">${fmtShortR(v)}</span></div>`).join("")}
      <div style="margin-top:8px;color:${c.sub}">${Object.keys(byDay).length} de ${dim} días con gasto${diaTop ? ` · día de mayor gasto: <b style="color:${c.ink}">${diaTop[0]} (${fmt(diaTop[1])})</b>` : ""}</div>
    </div></div>`;

  // ---- 6. Gastos más grandes y más repetidos ----
  const grandes = [...exMes].sort((a, b) => (+b.amount || 0) - (+a.amount || 0)).slice(0, 6);
  const grupos = {}; exMes.forEach((t) => { const d = (t.desc || "").trim(); if (!d) return; const g = grupos[d] || (grupos[d] = { d, n: 0, tot: 0 }); g.n++; g.tot += +t.amount || 0; });
  const repetidos = Object.values(grupos).filter((g) => g.n >= 2).sort((a, b) => b.tot - a.tot).slice(0, 6);
  const listaHTML = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;font-size:12px">
    <div><div style="color:${c.sub};margin-bottom:4px">Más grandes</div><table style="width:100%;border-collapse:collapse">${grandes.map((t) => `<tr>${td(`${escapeHtml(t.desc || "")}<div style="font-size:10px;color:${c.sub}">${escapeHtml(t.date || "")} · ${escapeHtml(t.cat || "")}</div>`)}${td(`<b>${fmt(t.amount)}</b>`, "text-align:right;vertical-align:top")}</tr>`).join("") || td("—")}</table></div>
    <div><div style="color:${c.sub};margin-bottom:4px">Más repetidos</div><table style="width:100%;border-collapse:collapse">${repetidos.map((g) => `<tr>${td(`${escapeHtml(g.d)}<div style="font-size:10px;color:${c.sub}">${g.n} veces · prom ${fmt(g.tot / g.n)}</div>`)}${td(`<b>${fmt(g.tot)}</b>`, "text-align:right;vertical-align:top")}</tr>`).join("") || td("—")}</table></div></div>`;

  // ---- 7. Ahorro real y patrimonio ----
  const movs = liq.flatMap((a) => a.movs || []);
  const rend = sum(movs.filter((m) => m.kind === "rendimiento" && ym(m.date) === mes), (m) => m.amount);
  const snaps = (s.snapshots || []).slice().sort((a, b) => a.ym.localeCompare(b.ym));
  const snapM = snaps.find((x) => x.ym === mes), snapA = snaps.find((x) => x.ym === mAnt);
  const ahorroHTML = `<table style="width:100%;border-collapse:collapse;font-size:13px">
    ${row("Sobrante del mes (ingresos − gastos)", fmt(bal), bal >= 0 ? c.green : c.red)}
    ${abono != null ? row("Abonado a cuentas (aportes netos)", fmt(abono), c.green) : ""}
    ${rend ? row("Rendimientos de las cuentas", fmt(rend), c.green) : ""}
    ${snapM ? row(`Patrimonio al cierre de ${monthLabel(mes)}`, fmt(snapM.patrimonio), c.gold) : ""}
    ${snapM && snapA ? row(`Cambio vs cierre de ${monthLabel(mAnt)}`, `${snapM.patrimonio - snapA.patrimonio >= 0 ? "+" : "−"}${fmt(Math.abs(snapM.patrimonio - snapA.patrimonio))}`, snapM.patrimonio >= snapA.patrimonio ? c.green : c.red) : ""}
  </table>`;

  return `<div style="max-width:760px;margin:0 auto;padding:28px 30px;font-family:Georgia,'Times New Roman',serif;color:${c.ink};background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact">
    <div style="display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid ${c.gold};padding-bottom:10px;margin-bottom:18px">
      <div><div style="font-size:22px;font-weight:700">Finanzas JDCH</div>
        <div style="color:${c.sub};font-size:13px">Reporte de ${escapeHtml(monthLabel(mes))}</div></div>
      <div style="text-align:right;color:${c.sub};font-size:12px">Generado ${escapeHtml(todayISO())}<br>${escapeHtml(s.profile.name || "")}</div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px">
      ${[["Ingresos", fmt(ing), c.green, delta(ing, RA.ing, "sube")], ["Gastos", fmt(gas), c.red, delta(gas, RA.gas, "baja")], ["Balance", fmt(bal), bal >= 0 ? c.green : c.red, delta(bal, RA.bal, "sube")], ["Tasa ahorro", (ing ? tasa.toFixed(0) : "—") + "%", c.ink, ""]]
        .map(([k, v, col, d]) => `<div style="border:1px solid ${c.line};border-radius:8px;padding:10px"><div style="font-size:11px;color:${c.sub};text-transform:uppercase;letter-spacing:.04em">${k}</div><div style="font-size:17px;font-weight:700;color:${col}">${v}</div>${d && RA.hay ? `<div style="font-size:10.5px;margin-top:2px">${d} <span style="color:${c.sub}">vs mes ant.</span></div>` : ""}</div>`).join("")}
    </div>

    ${analisis ? `<div style="border:1px solid ${c.gold};border-radius:8px;padding:12px 14px;margin-bottom:20px;break-inside:avoid;page-break-inside:avoid">
      <h3 style="font-size:15px;margin:0 0 6px;color:${c.gold}">✨ Análisis del mes</h3>
      ${analisis.resumen ? `<p style="font-size:13px;margin:0 0 8px;line-height:1.45">${escapeHtml(analisis.resumen)}</p>` : ""}
      ${analisis.hallazgos.map((h) => `<div style="font-size:12.5px;margin:6px 0;line-height:1.4"><b>${h.tipo === "bien" ? "✅" : h.tipo === "alerta" ? "⚠️" : "ℹ️"} ${escapeHtml(h.titulo)}.</b> ${escapeHtml(h.detalle || "")}</div>`).join("")}
      ${analisis.recomendaciones.length ? `<div style="font-size:12.5px;margin-top:8px"><b>Recomendaciones para el próximo mes</b><ol style="margin:4px 0 0 18px;padding:0">${analisis.recomendaciones.map((x) => `<li style="margin:3px 0">${escapeHtml(x)}</li>`).join("")}</ol></div>` : ""}
      <div style="font-size:10.5px;color:${c.sub};margin-top:8px">Redactado con IA (${escapeHtml(analisis.model)}) a partir de las cifras calculadas por la app. Revísalo; no es asesoría financiera.</div>
    </div>` : ""}

    ${sec("Comparativo", compHTML)}
    ${sec("Flujo del dinero", `<div style="max-width:520px;margin:0 auto">${sankeyHTML}</div>`)}
    ${sec("Gasto por categoría", catsHTML)}
    ${presuHTML ? sec("Presupuesto vs real", presuHTML) : ""}
    ${sec("Gasto por día", calHTML)}
    ${sec("Gastos destacados", listaHTML)}
    ${sec("Regla 50/30/20", `<table style="width:100%;border-collapse:collapse;font-size:13px">
      ${["Necesidad", "Deseo", "Deuda"].map((bk) => { const p = gas ? (buck[bk] / gas) * 100 : 0; return row(`${lbl503[bk]} (ref ${RULE_503020[bk]}%)`, `${fmt(buck[bk])} · ${p.toFixed(0)}%`); }).join("")}
    </table><div style="font-size:11px;color:${c.sub};margin-top:4px">La regla se calcula sobre los gastos; el ahorro (aportes a cuentas) se muestra abajo.</div>`)}
    ${sec("Ahorro y patrimonio", ahorroHTML)}
    ${accts.length ? sec("Cuentas (saldo actual)", `<table style="width:100%;border-collapse:collapse;font-size:13px">
      ${accts.map((a) => row(`${a.name} · ${a.type}`, fmt(a.balance))).join("")}
      ${row("Total disponible", fmt(disp), c.gold)}
    </table>`) : ""}

    <div style="margin-top:24px;color:${c.sub};font-size:11px;border-top:1px solid ${c.line};padding-top:8px">Generado por Finanzas JDCH · guía general, no asesoría financiera.</div>
  </div>`;
}
// formato corto para celdas pequeñas ($1,2M / $350k)
function fmtShortR(n) { n = +n || 0; return Math.abs(n) >= 1e6 ? "$" + (n / 1e6).toFixed(1) + "M" : Math.abs(n) >= 1e3 ? "$" + Math.round(n / 1e3) + "k" : "$" + Math.round(n); }

/* ===================== GASTOS RECURRENTES ===================== */
async function saveRec() {
  const s = getState();
  await saveConfig(s.user.uid, { profile: s.profile, cats: s.cats, budgets: s.budgets, recurrentes: getState().recurrentes });
  forcePersistLocal(s.user.uid);
}

function drawRec(root) {
  const list = root.querySelector("#rec-list"); if (!list) return;
  const recs = getState().recurrentes || [];
  if (!recs.length) { list.innerHTML = `<div class="muted small">Aún no tienes gastos recurrentes.</div>`; return; }
  list.innerHTML = recs.map((r) => `<div class="row between" style="align-items:center;padding:7px 0;border-top:1px solid var(--line)">
      <div class="flex1" style="min-width:0"><div class="small bold ellipsis">${escapeHtml(r.desc)}</div>
        <div class="tiny muted">${fmt(r.amount)} · día ${r.day} · ${escapeHtml(r.cat)}${r.sub ? " › " + escapeHtml(r.sub) : ""}</div></div>
      <button class="icon-btn" data-er="${r.id}" title="Editar">✎</button>
      <button class="icon-btn" data-dr="${r.id}" title="Eliminar">🗑</button></div>`).join("");
  list.querySelectorAll("[data-er]").forEach((b) => b.onclick = () => openRecModal(root, (getState().recurrentes || []).find((x) => x.id === b.getAttribute("data-er"))));
  list.querySelectorAll("[data-dr]").forEach((b) => b.onclick = () => confirmDialog("¿Eliminar este gasto recurrente? (no borra los gastos ya registrados)", async () => {
    setState({ recurrentes: (getState().recurrentes || []).filter((x) => x.id !== b.getAttribute("data-dr")) });
    await saveRec(); drawRec(root); toast("Eliminado");
  }));
}

function openRecModal(root, existing) {
  const s = getState();
  const f = (l, h) => `<div class="field"><label class="label">${l}</label>${h}</div>`;
  const catOpts = s.cats.map((c) => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`).join("");
  const payList = [...DEFAULT_PAY_METHODS.filter((m) => m !== "Otro"), ...(s.payMethods || []), "Otro"];
  const payOpts = payList.map((m) => `<option>${escapeHtml(m)}</option>`).join("");
  const acctOpts = `<option value="">— ninguna —</option>` + (s.accounts || []).map((a) => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)}</option>`).join("");
  openModal(existing ? "Editar recurrente" : "Nuevo gasto recurrente", `
    ${f("Descripción", `<input id="r-desc" class="input" value="${existing ? escapeHtml(existing.desc) : ""}" placeholder="Ej: Arriendo">`)}
    ${f("Monto (COP)", `<input id="r-amt" class="input" type="number" value="${existing ? existing.amount : ""}" placeholder="0">`)}
    ${f("Categoría", `<select id="r-cat" class="input">${catOpts}</select>`)}
    ${f("Subcategoría", `<select id="r-sub" class="input"></select>`)}
    ${f("Medio de pago", `<select id="r-pay" class="input">${payOpts}</select>`)}
    ${f("Cuenta (opcional)", `<select id="r-acct" class="input">${acctOpts}</select>`)}
    ${f("Día del mes (1–31)", `<input id="r-day" class="input" type="number" min="1" max="31" value="${existing ? existing.day : 1}">`)}
    <button id="r-save" class="btn btn-primary btn-block mt-2">${existing ? "Guardar" : "Crear"}</button>`, {
    onMount(b) {
      moneyPreview(b.querySelector("#r-amt"));
      const catSel = b.querySelector("#r-cat"), subSel = b.querySelector("#r-sub");
      const fillSubs = () => { const c = s.cats.find((x) => x.name === catSel.value); subSel.innerHTML = `<option value=""></option>` + (c?.subs || []).map((x) => `<option>${escapeHtml(x)}</option>`).join(""); };
      if (existing) catSel.value = existing.cat;
      catSel.onchange = fillSubs; fillSubs();
      if (existing) { subSel.value = existing.sub || ""; b.querySelector("#r-pay").value = existing.pay || "Efectivo"; b.querySelector("#r-acct").value = existing.acct || ""; }
      submitOnce(b.querySelector("#r-save"), async () => {
        const rec = {
          id: existing ? existing.id : uid(), desc: b.querySelector("#r-desc").value.trim(), amount: +b.querySelector("#r-amt").value || 0,
          cat: catSel.value, sub: subSel.value, pay: b.querySelector("#r-pay").value, acct: b.querySelector("#r-acct").value || "",
          day: Math.min(31, Math.max(1, +b.querySelector("#r-day").value || 1)), lastGen: existing ? (existing.lastGen || "") : "",
        };
        if (!rec.desc || !rec.amount) return toast("Falta descripción o monto", true);
        const list = getState().recurrentes || [];
        setState({ recurrentes: existing ? list.map((x) => (x.id === rec.id ? rec : x)) : [...list, rec] });
        await saveRec(); closeModal(); drawRec(root); toast(existing ? "Actualizado" : "Gasto recurrente creado");
      });
    },
  });
}
