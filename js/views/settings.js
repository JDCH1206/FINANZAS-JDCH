// js/views/settings.js
import { getState, setState, dataSnapshot } from "../state.js";
import { saveConfig, bulkSetTx, bulkSetIncomes, signOutUser, isCloud, forcePersistLocal } from "../firebase-service.js";
import { classify, classifyIncome } from "../config.js";
import { uid, normDate, escapeHtml } from "../utils.js";
import { toast, confirmDialog } from "../components/modals.js";

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
      <div class="card-title">Importar desde Excel</div>
      <p class="small muted mb-3">Lee la hoja “Gastos” (usa Cat_Nueva/Subcat_Nueva o clasifica solo) y la hoja “IngresosFechas”. Reemplaza gastos e ingresos actuales.</p>
      <input id="xls" type="file" accept=".xlsx,.xls" hidden>
      <button id="xls-btn" class="btn btn-primary btn-sm">⬆ Elegir archivo .xlsx</button>
    </div>

    <div class="card mb-3">
      <div class="card-title">Respaldo</div>
      <p class="small muted mb-3">Descarga un respaldo (JSON) para tu Drive y restáuralo en otro equipo. Útil mientras no actives la nube, o como copia de seguridad.</p>
      <div class="row gap-2 wrap">
        <button id="exp-json" class="btn btn-ghost btn-sm">⬇ Descargar respaldo</button>
        <input id="imp-json" type="file" accept=".json" hidden>
        <button id="imp-btn" class="btn btn-ghost btn-sm">⬆ Restaurar respaldo</button>
        <button id="exp-xls" class="btn btn-ghost btn-sm">⬇ Exportar a Excel</button>
      </div>
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
      <div class="card-title">Módulos opcionales</div>
      <p class="small muted mb-3">🚗 <b>Vehículos</b>: combustible, mantenimiento y obligaciones (SOAT, tecnomecánica, impuesto) con alarmas. Al activarlo aparece en el menú <b>"Más"</b> de la barra inferior.</p>
      <button id="veh-toggle" class="btn btn-sm"></button>
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

    <p class="tiny muted center">${isCloud() ? "Tus datos se sincronizan en Firebase. Ábrelos en cualquier equipo con tu correo." : "Sin Firebase: datos solo en este navegador. Configura firebase-config.js para nube + multi-dispositivo."}</p>`;

  // perfil
  root.querySelector("#p-save").onclick = async () => {
    const profile = { name: root.querySelector("#p-name").value.trim() || "Usuario", income: +root.querySelector("#p-income").value || 0 };
    setState({ profile });
    await saveConfig(s.user.uid, { profile, cats: s.cats, budgets: s.budgets }); forcePersistLocal(s.user.uid);
    toast("Perfil guardado");
  };

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

  // backup json
  root.querySelector("#exp-json").onclick = () => {
    const blob = new Blob([JSON.stringify(dataSnapshot(), null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = "finanzas_respaldo_" + new Date().toISOString().slice(0, 10) + ".json"; a.click();
    localStorage.setItem("fz_last_backup", new Date().toISOString().slice(0, 10));
    toast("Respaldo descargado");
  };
  const impJson = root.querySelector("#imp-json");
  root.querySelector("#imp-btn").onclick = () => impJson.click();
  impJson.onchange = async () => {
    const file = impJson.files[0]; if (!file) return;
    try {
      const d = JSON.parse(await file.text());
      setState({ profile: d.profile || s.profile, cats: d.cats || s.cats, budgets: d.budgets || {}, txs: d.txs || [], incomes: d.incomes || [], accounts: d.accounts || [], payMethods: d.payMethods || [], vehicles: d.vehicles || [], vehiclesEnabled: d.vehiclesEnabled || false, goals: d.goals || [] });
      await saveConfig(s.user.uid, { profile: d.profile || s.profile, cats: d.cats || s.cats, budgets: d.budgets || {}, accounts: d.accounts || [], payMethods: d.payMethods || [], vehicles: d.vehicles || [], vehiclesEnabled: d.vehiclesEnabled || false, goals: d.goals || [] });
      await bulkSetTx(s.user.uid, d.txs || []);
      await bulkSetIncomes(s.user.uid, d.incomes || []);
      forcePersistLocal(s.user.uid);
      toast("Respaldo restaurado");
    } catch (e) { toast("Archivo inválido", true); }
    impJson.value = "";
  };
  root.querySelector("#exp-xls").onclick = async () => {
    const XLSX = await import("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm");
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
    XLSX.writeFile(wb, "finanzas_export_" + new Date().toISOString().slice(0, 10) + ".xlsx");
    toast("Excel exportado");
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

  root.querySelector("#logout").onclick = () => confirmDialog("¿Cerrar sesión?", async () => { await signOutUser(); onSignOut(); });

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
