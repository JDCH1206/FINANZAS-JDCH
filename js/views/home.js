// js/views/home.js
import { getState, setState } from "../state.js";
import { addTx, deleteTx, addIncome, deleteIncome, forcePersistLocal, addFuel, loadFuel, persistFuelLocal, isCloud, saveConfig, deleteFuel, updateFuel, addMaint, loadMaint, deleteMaint, updateMaint, persistMaintLocal } from "../firebase-service.js";
import { fmt, uid, todayISO, escapeHtml, ym, monthLabel, curMonth, fmtDate } from "../utils.js";
import { PALETTE, INCOME_TYPES, DEFAULT_PAY_METHODS, FUEL_TYPES, MAINT_CATEGORIES, MAINT_TIPOS } from "../config.js";
import { openModal, closeModal, toast, toastUndo, confirmDialog, submitOnce, moneyPreview } from "../components/modals.js";

let query = "";
let tabKind = "gasto";
let fMonth = "", fCat = "", fMin = "", fMax = "", fAcct = "", fPay = "", fTag = "";
let limit = 300;

// sugerencias de autocompletado para la descripción, a partir de lo YA cargado en memoria
// (recorre el arreglo en RAM: NO genera ninguna lectura adicional a Firebase). Ordena por
// frecuencia de uso y toma las 60 más usadas.
function descDatalist(id, arr) {
  const freq = {};
  for (const t of (arr || [])) { const d = (t.desc || "").trim(); if (d) freq[d] = (freq[d] || 0) + 1; }
  const opts = Object.keys(freq).sort((a, b) => freq[b] - freq[a]).slice(0, 60);
  return `<datalist id="${id}">${opts.map((d) => `<option value="${escapeHtml(d)}"></option>`).join("")}</datalist>`;
}
// etiquetas ya usadas (desde memoria) para sugerir al escribir y para el filtro
function allTags(arr) {
  const set = new Set();
  for (const t of (arr || [])) for (const g of (t.tags || [])) { const v = String(g).trim(); if (v) set.add(v); }
  return [...set].sort((a, b) => a.localeCompare(b));
}
function tagsDatalist(id, arr) {
  return `<datalist id="${id}">${allTags(arr).map((g) => `<option value="${escapeHtml(g)}"></option>`).join("")}</datalist>`;
}
// convierte el texto del campo de etiquetas en un arreglo limpio (sin duplicados ni vacíos)
function parseTags(str) {
  return [...new Set((str || "").split(",").map((x) => x.trim()).filter(Boolean))];
}

// filtros guardados: combinaciones con nombre, por dispositivo (localStorage; no toca la nube)
function getSavedFilters() {
  try { return JSON.parse(localStorage.getItem("fz_filters_" + getState().user.uid) || "[]"); } catch (e) { return []; }
}
function setSavedFilters(arr) {
  try { localStorage.setItem("fz_filters_" + getState().user.uid, JSON.stringify(arr)); } catch (e) { /* noop */ }
}

function applyFilters(arr, isGasto) {
  let f = arr;
  if (query) f = f.filter((t) => ((t.desc || "") + (t.cat || "") + (t.sub || "") + (t.type || "")).toLowerCase().includes(query.toLowerCase()));
  if (fMonth) f = f.filter((t) => ym(t.date) === fMonth);
  if (isGasto && fCat) f = f.filter((t) => t.cat === fCat);
  if (isGasto && fAcct) f = f.filter((t) => (t.acct || "") === fAcct);
  if (isGasto && fPay) f = f.filter((t) => (t.pay || "") === fPay);
  if (isGasto && fTag) f = f.filter((t) => (t.tags || []).includes(fTag));
  if (fMin !== "") f = f.filter((t) => (+t.amount || 0) >= +fMin);
  if (fMax !== "") f = f.filter((t) => (+t.amount || 0) <= +fMax);
  return f;
}

export function renderHome(root) {
  const s = getState();
  const n = tabKind === "gasto" ? s.txs.length : s.incomes.length;
  const allMonths = [...new Set([...s.txs, ...s.incomes].map((t) => ym(t.date)).filter(Boolean))].sort().reverse();
  root.innerHTML = `
    <h2 class="page-title disp">Movimientos</h2>
    <p class="page-sub">${escapeHtml(s.profile.name)}</p>
    <div class="row gap-2 mb-3">
      <button class="chip ${tabKind === "gasto" ? "on" : ""}" data-kind="gasto">Gastos</button>
      <button class="chip ${tabKind === "ingreso" ? "on" : ""}" data-kind="ingreso">Ingresos</button>
      <span class="muted small" style="margin-left:auto;align-self:center">${n} registros</span>
    </div>
    <div class="field" style="position:relative">
      <input id="q" class="input" placeholder="Buscar..." value="${escapeHtml(query)}">
    </div>
    <div class="card mb-3" style="padding:10px">
      <div class="row gap-2 wrap">
        <select id="f-month" class="input" style="flex:1;min-width:130px"><option value="">Todos los meses</option>${allMonths.map((m) => `<option value="${m}" ${m === fMonth ? "selected" : ""}>${monthLabel(m)}</option>`).join("")}</select>
        ${tabKind === "gasto" ? `<select id="f-cat" class="input" style="flex:1;min-width:130px"><option value="">Todas las categorías</option>${s.cats.map((c) => `<option ${c.name === fCat ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}</select>` : ""}
      </div>
      ${tabKind === "gasto" ? `<div class="row gap-2 wrap mt-2">
        <select id="f-acct" class="input" style="flex:1;min-width:130px"><option value="">Todas las cuentas</option>${(s.accounts || []).map((a) => `<option value="${escapeHtml(a.id)}" ${a.id === fAcct ? "selected" : ""}>${escapeHtml(a.name)}</option>`).join("")}</select>
        <select id="f-pay" class="input" style="flex:1;min-width:130px"><option value="">Todos los medios</option>${[...DEFAULT_PAY_METHODS.filter((m) => m !== "Otro"), ...(s.payMethods || []), "Otro"].map((m) => `<option ${m === fPay ? "selected" : ""}>${escapeHtml(m)}</option>`).join("")}</select>
        ${allTags(s.txs).length ? `<select id="f-tag" class="input" style="flex:1;min-width:130px"><option value="">Todas las etiquetas</option>${allTags(s.txs).map((g) => `<option ${g === fTag ? "selected" : ""}>${escapeHtml(g)}</option>`).join("")}</select>` : ""}
      </div>` : ""}
      <div class="row gap-2 wrap mt-2">
        <input id="f-min" class="input" type="number" placeholder="Monto mín" value="${fMin}" style="flex:1;min-width:90px">
        <input id="f-max" class="input" type="number" placeholder="Monto máx" value="${fMax}" style="flex:1;min-width:90px">
        <button id="f-clear" class="btn btn-ghost btn-sm">Limpiar</button>
      </div>
      ${tabKind === "gasto" ? `<div id="saved-filters" class="row gap-2 wrap mt-2"></div>` : ""}
    </div>
    <div id="rec-pending"></div>
    <div class="card" style="padding:0" id="list"></div>`;

  root.querySelectorAll("[data-kind]").forEach((b) => b.onclick = () => { tabKind = b.getAttribute("data-kind"); renderHome(root); });
  root.querySelector("#q").oninput = (e) => { query = e.target.value; limit = 300; drawList(); };
  root.querySelector("#f-month").onchange = (e) => { fMonth = e.target.value; limit = 300; drawList(); };
  const fcatSel = root.querySelector("#f-cat"); if (fcatSel) fcatSel.onchange = (e) => { fCat = e.target.value; limit = 300; drawList(); };
  const facctSel = root.querySelector("#f-acct"); if (facctSel) facctSel.onchange = (e) => { fAcct = e.target.value; limit = 300; drawList(); };
  const fpaySel = root.querySelector("#f-pay"); if (fpaySel) fpaySel.onchange = (e) => { fPay = e.target.value; limit = 300; drawList(); };
  const ftagSel = root.querySelector("#f-tag"); if (ftagSel) ftagSel.onchange = (e) => { fTag = e.target.value; limit = 300; drawList(); };
  root.querySelector("#f-min").oninput = (e) => { fMin = e.target.value; limit = 300; drawList(); };
  root.querySelector("#f-max").oninput = (e) => { fMax = e.target.value; limit = 300; drawList(); };
  root.querySelector("#f-clear").onclick = () => { query = ""; fMonth = ""; fCat = ""; fMin = ""; fMax = ""; fAcct = ""; fPay = ""; fTag = ""; renderHome(root); };
  drawSavedFilters(root);

  // FAB fuera del contenedor animado (#view), pegado a la pantalla, siempre visible
  let fab = document.getElementById("fab");
  if (!fab) {
    fab = document.createElement("button");
    fab.id = "fab"; fab.className = "fab"; fab.setAttribute("aria-label", "Agregar");
    fab.innerHTML = `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 5v14M5 12h14"/></svg>`;
    document.body.appendChild(fab);
  }
  fab.onclick = () => tabKind === "gasto" ? openTxModal() : openIncomeModal();
  drawPending(root);
  drawList();
}

// tarjeta de gastos recurrentes pendientes de registrar este mes (recomienda + confirmas)
function drawPending(root) {
  const host = root.querySelector("#rec-pending"); if (!host) return;
  const s = getState();
  const cm = curMonth(), td = +todayISO().slice(8, 10);
  const pend = tabKind === "gasto" ? (s.recurrentes || []).filter((r) => r.lastGen !== cm && (r.day || 1) <= td) : [];
  if (!pend.length) { host.innerHTML = ""; return; }
  host.innerHTML = `<div class="card mb-3" style="border:1px solid var(--gold)">
    <div class="card-title">🔁 Gastos recurrentes por registrar</div>
    ${pend.map((r) => `<div class="row gap-2" style="align-items:center;padding:7px 0;border-top:1px solid var(--line)">
      <div class="flex1" style="min-width:0"><div class="small bold ellipsis">${escapeHtml(r.desc)}</div><div class="tiny muted">día ${r.day} · ${escapeHtml(r.cat)}</div></div>
      <input class="input rec-amt" data-r="${r.id}" type="number" value="${r.amount}" style="width:104px;padding:6px 8px;font-size:13px">
      <button class="btn btn-primary btn-sm rec-go" data-r="${r.id}">Registrar</button>
      <button class="btn btn-ghost btn-sm rec-skip" data-r="${r.id}">Omitir</button>
    </div>`).join("")}</div>`;
  host.querySelectorAll(".rec-go").forEach((b) => b.onclick = () => registrarRec(root, b.getAttribute("data-r")));
  host.querySelectorAll(".rec-skip").forEach((b) => b.onclick = () => skipRec(root, b.getAttribute("data-r")));
}

async function registrarRec(root, id) {
  const s = getState();
  const r = (s.recurrentes || []).find((x) => x.id === id); if (!r) return;
  const amtInput = root.querySelector(`.rec-amt[data-r="${id}"]`);
  const amount = amtInput ? (+amtInput.value || 0) : r.amount;
  if (!amount) return toast("Monto inválido", true);
  const cm = curMonth(), [y, m] = cm.split("-").map(Number);
  const dim = new Date(y, m, 0).getDate();
  const date = `${cm}-${String(Math.min(r.day || 1, dim)).padStart(2, "0")}`;
  const tx = { id: uid(), date, desc: r.desc, amount, cat: r.cat, sub: r.sub || "", pay: r.pay || "", acct: r.acct || "" };
  setState({ txs: [tx, ...getState().txs], recurrentes: (getState().recurrentes || []).map((x) => (x.id === id ? { ...x, lastGen: cm } : x)) });
  await addTx(s.user.uid, tx);
  await saveConfig(s.user.uid, { profile: s.profile, cats: s.cats, budgets: s.budgets, recurrentes: getState().recurrentes });
  forcePersistLocal(s.user.uid);
  drawPending(root); drawList(); toast("Registrado: " + r.desc);
}

async function skipRec(root, id) {
  const s = getState();
  const cm = curMonth();
  setState({ recurrentes: (getState().recurrentes || []).map((x) => (x.id === id ? { ...x, lastGen: cm } : x)) });
  await saveConfig(s.user.uid, { profile: s.profile, cats: s.cats, budgets: s.budgets, recurrentes: getState().recurrentes });
  forcePersistLocal(s.user.uid);
  drawPending(root); toast("Omitido este mes");
}

// chips de filtros guardados + botón para guardar la combinación actual
function drawSavedFilters(root) {
  const host = root.querySelector("#saved-filters"); if (!host) return;
  const arr = getSavedFilters();
  host.innerHTML = arr.map((sf) => `<span class="chip" data-fapply="${sf.id}" style="cursor:pointer">🔖 ${escapeHtml(sf.name)} <b data-fdel="${sf.id}" style="color:var(--red);cursor:pointer;margin-left:4px">✕</b></span>`).join("")
    + `<button class="chip" id="f-save-btn" style="cursor:pointer">★ Guardar filtro actual</button>`;
  host.querySelectorAll("[data-fapply]").forEach((c) => c.onclick = (e) => {
    if (e.target.closest("[data-fdel]")) return;
    const sf = getSavedFilters().find((x) => x.id === c.getAttribute("data-fapply")); if (!sf) return;
    const f = sf.f || {};
    query = f.query || ""; fMonth = f.fMonth || ""; fCat = f.fCat || ""; fAcct = f.fAcct || ""; fPay = f.fPay || ""; fTag = f.fTag || ""; fMin = f.fMin || ""; fMax = f.fMax || "";
    limit = 300; renderHome(root);
  });
  host.querySelectorAll("[data-fdel]").forEach((b) => b.onclick = (e) => {
    e.stopPropagation();
    setSavedFilters(getSavedFilters().filter((x) => x.id !== b.getAttribute("data-fdel")));
    drawSavedFilters(root); toast("Filtro eliminado");
  });
  root.querySelector("#f-save-btn").onclick = () => {
    openModal("Guardar filtro", `
      <p class="tiny muted mb-3">Guarda la combinación actual de filtros (mes, categoría, cuenta, medio, etiqueta, montos y búsqueda) con un nombre. Se guarda en este dispositivo.</p>
      <div class="field"><label class="label">Nombre</label><input id="fs-name" class="input" placeholder="Ej: Gastos moto 2026"></div>
      <button id="fs-save" class="btn btn-primary btn-block">Guardar</button>`, {
      onMount(b) {
        submitOnce(b.querySelector("#fs-save"), async () => {
          const name = b.querySelector("#fs-name").value.trim();
          if (!name) return toast("Ponle un nombre", true);
          const sf = { id: uid(), name, f: { query, fMonth, fCat, fAcct, fPay, fTag, fMin, fMax } };
          setSavedFilters([...getSavedFilters(), sf]);
          closeModal(); drawSavedFilters(root); toast("Filtro guardado");
        });
      },
    });
  };
}

function drawList() {
  const s = getState();
  const list = document.getElementById("list");
  if (!list) return;
  if (tabKind === "gasto") {
    const f = applyFilters(s.txs, true);
    const sorted = [...f].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    const rows = sorted.slice(0, limit), more = sorted.length > limit;
    if (!rows.length) { list.innerHTML = `<div class="muted small" style="padding:20px">Sin gastos con esos filtros.</div>`; return; }
    list.innerHTML = rows.map((t) => {
      const ci = s.cats.findIndex((c) => c.name === t.cat);
      const veh = t.vehicleId ? (s.vehicles || []).find((x) => x.id === t.vehicleId) : null;
      return `<div class="tx-row" data-row="${t.id}" style="cursor:pointer">
        <span class="tx-dot" style="background:${PALETTE[(ci + 11) % PALETTE.length]}"></span>
        <div class="flex1"><div class="tx-desc ellipsis">${escapeHtml(t.desc)}${veh ? (veh.tipo === "Moto" ? " 🏍️" : " 🚗") : ""}</div>
          <div class="tx-meta">${fmtDate(t.date)} · ${escapeHtml(t.cat)} &rsaquo; ${escapeHtml(t.sub || "")}${t.pay ? " · " + escapeHtml(t.pay) : ""}${t.splitId ? ' · <span title="Parte de un gasto dividido">÷</span>' : ""}</div>
          ${(t.tags || []).length ? `<div class="tx-meta">${t.tags.map((g) => `<span class="badge" style="background:var(--panel-2);color:var(--gold);font-size:10px;padding:1px 6px;margin-right:4px">#${escapeHtml(g)}</span>`).join("")}</div>` : ""}</div>
        <div class="tx-amt">${fmt(t.amount)}</div>
        <button class="icon-btn" data-del="${t.id}" aria-label="Eliminar gasto"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2m-9 0v14h10V6"/></svg></button>
      </div>`;
    }).join("") + (more ? `<button class="btn btn-ghost btn-block" id="more-btn" style="margin:10px 0">Ver más (${sorted.length - limit} restantes)</button>` : "");
    if (more) list.querySelector("#more-btn").onclick = () => { limit += 300; drawList(); };
    list.querySelectorAll("[data-row]").forEach((r) => r.onclick = (e) => { if (e.target.closest("[data-del]")) return; openTxModal(getState().txs.find((x) => x.id === r.getAttribute("data-row"))); });
    list.querySelectorAll("[data-del]").forEach((b) => b.onclick = (e) => { e.stopPropagation();
      const id = b.getAttribute("data-del");
      const tx = getState().txs.find((x) => x.id === id);
      const doDelete = async () => {
        setState({ txs: getState().txs.filter((x) => x.id !== id) });
        await deleteTx(s.user.uid, id); forcePersistLocal(s.user.uid);
        // borrar el tanqueo vinculado (si lo hay)
        if (tx && tx.fuelId) {
          await deleteFuel(s.user.uid, tx.fuelId);
          if (!isCloud()) { const ex = await loadFuel(s.user.uid); persistFuelLocal(s.user.uid, ex.filter((x) => x.id !== tx.fuelId)); }
        }
        // borrar el mantenimiento vinculado (si lo hay)
        if (tx && tx.maintId) {
          await deleteMaint(s.user.uid, tx.maintId);
          if (!isCloud()) { const ex = await loadMaint(s.user.uid); persistMaintLocal(s.user.uid, ex.filter((x) => x.id !== tx.maintId)); }
        }
        drawList();
      };
      if (tx && (tx.fuelId || tx.maintId)) {
        // vinculado a un registro del vehículo → confirmar (el borrado es doble)
        const msg = tx.fuelId ? "Este gasto está vinculado a un <b>tanqueo</b> del vehículo: se eliminarán el gasto y el tanqueo. ¿Continuar?"
          : "Este gasto está vinculado a un <b>mantenimiento</b> del vehículo: se eliminarán el gasto y el registro de la bitácora. ¿Continuar?";
        confirmDialog(msg, async () => { await doDelete(); toast("Eliminado"); });
      } else {
        // gasto simple → eliminar de una, con opción de deshacer
        doDelete().then(() => toastUndo("Gasto eliminado", async () => {
          setState({ txs: [tx, ...getState().txs] });
          await addTx(s.user.uid, tx); forcePersistLocal(s.user.uid); drawList();
        }));
      }
    });
  } else {
    const f = applyFilters(s.incomes, false);
    const sorted = [...f].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    const rows = sorted.slice(0, limit), more = sorted.length > limit;
    if (!rows.length) { list.innerHTML = `<div class="muted small" style="padding:20px">Sin ingresos con esos filtros.</div>`; return; }
    list.innerHTML = rows.map((t) => `<div class="tx-row" data-rowi="${t.id}" style="cursor:pointer">
        <span class="tx-dot" style="background:var(--green)"></span>
        <div class="flex1"><div class="tx-desc ellipsis">${escapeHtml(t.desc)}</div>
          <div class="tx-meta">${fmtDate(t.date)} · ${escapeHtml(t.type || "")}</div></div>
        <div class="tx-amt" style="color:var(--green)">${fmt(t.amount)}</div>
        <button class="icon-btn" data-deli="${t.id}" aria-label="Eliminar ingreso"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2m-9 0v14h10V6"/></svg></button>
      </div>`).join("") + (more ? `<button class="btn btn-ghost btn-block" id="more-btni" style="margin:10px 0">Ver más (${sorted.length - limit} restantes)</button>` : "");
    if (more) list.querySelector("#more-btni").onclick = () => { limit += 300; drawList(); };
    list.querySelectorAll("[data-rowi]").forEach((r) => r.onclick = (e) => { if (e.target.closest("[data-deli]")) return; openIncomeModal(getState().incomes.find((x) => x.id === r.getAttribute("data-rowi"))); });
    list.querySelectorAll("[data-deli]").forEach((b) => b.onclick = async (e) => { e.stopPropagation();
      const id = b.getAttribute("data-deli");
      const inc = getState().incomes.find((x) => x.id === id);
      setState({ incomes: getState().incomes.filter((x) => x.id !== id) });
      await deleteIncome(s.user.uid, id); forcePersistLocal(s.user.uid); drawList();
      toastUndo("Ingreso eliminado", async () => {
        setState({ incomes: [inc, ...getState().incomes] });
        await addIncome(s.user.uid, inc); forcePersistLocal(s.user.uid); drawList();
      });
    });
  }
}

export function openTxModal(existing) {
  const s = getState();
  // si la categoría original ya no existe, conservarla como opción para no re-clasificar en silencio
  const missingCat = !!(existing && existing.cat && !s.cats.some((c) => c.name === existing.cat));
  const catOpts = (missingCat ? `<option value="${escapeHtml(existing.cat)}">⚠ ${escapeHtml(existing.cat)} (ya no existe)</option>` : "")
    + s.cats.map((c) => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`).join("");
  const payList = [...DEFAULT_PAY_METHODS.filter((m) => m !== "Otro"), ...(s.payMethods || []), "Otro"];
  const payOpts = payList.map((m) => `<option>${escapeHtml(m)}</option>`).join("");
  const acctOpts = `<option value="">— ninguna —</option>` + (s.accounts || []).map((a) => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)}</option>`).join("");
  const vehs = (!existing && s.vehiclesEnabled && (s.vehicles || []).length) ? s.vehicles : [];
  const vehBlock = vehs.length ? `
    <div id="m-veh-wrap" style="display:none">
    <div class="field"><label class="label">Asociar a vehículo (opcional)</label>
      <select id="m-veh" class="input"><option value="">— no asociar —</option>${vehs.map((v) => `<option value="${escapeHtml(v.id)}">${v.tipo === "Moto" ? "🏍️" : "🚗"} ${escapeHtml(v.alias || v.modelo)}</option>`).join("")}</select></div>
    <div id="m-veh-extra" style="display:none">
      <div class="field"><label class="label">Tipo de gasto del vehículo</label>
        <select id="m-vtype" class="input"><option value="comb">Combustible</option><option value="maint">Mantenimiento</option><option value="otro">Otro (lavado, peaje, SOAT…)</option></select></div>
      <div id="m-fuel-fields">
        <div class="field"><label class="label">Estación</label><input id="m-est" class="input" placeholder="Ej: Terpel, Texaco"></div>
        <div class="field"><label class="label">Tipo de combustible</label><select id="m-tipo" class="input">${FUEL_TYPES.map((t) => `<option>${t}</option>`).join("")}</select></div>
        <div class="field"><label class="label">Galones</label><input id="m-gal" class="input" type="number" step="0.001" placeholder="Ej: 2.5"></div>
        <div class="field"><label class="label">Odómetro (km del tablero)</label><input id="m-odo" class="input" type="number"></div>
        <div class="field"><label class="label">¿Tanque lleno?</label><select id="m-lleno" class="input"><option>Sí</option><option>No</option></select></div>
      </div>
      <div id="m-maint-fields" style="display:none">
        <div class="field"><label class="label">Categoría</label><select id="m-mcat" class="input">${MAINT_CATEGORIES.map((c) => `<option>${c}</option>`).join("")}</select></div>
        <div class="field"><label class="label">Tipo (servicio)</label><select id="m-mtipo" class="input"></select></div>
        <div class="field"><label class="label">Odómetro (km) — opcional</label><input id="m-modo" class="input" type="number" placeholder="Vacío si no aplica"></div>
        <p class="tiny muted" style="margin:-6px 0 10px">Déjalo vacío si es una <b>compra de insumos</b> (aceite, filtro, repuesto sin instalar): no afecta el kilometraje.</p>
        <div class="field"><label class="label">Taller</label><input id="m-mtaller" class="input" placeholder="Opcional"></div>
        <div class="card-title" style="margin-top:8px;font-size:13px">Próximo aviso (opcional)</div>
        <div class="field"><label class="label">Avisar a los (km)</label><input id="m-mpkm" class="input" type="number" placeholder="km absoluto, ej: 12000"></div>
        <div class="field"><label class="label">o repetir cada (km)</label><input id="m-mrkm" class="input" type="number" placeholder="ej: 5000 (aceite)"></div>
        <div class="field"><label class="label">Avisar en la fecha</label><input id="m-mpfecha" class="input" type="date"></div>
        <div class="field"><label class="label">o repetir cada (días)</label><input id="m-mrdias" class="input" type="number" placeholder="ej: 180"></div>
      </div>
      <p class="tiny muted">El gasto queda asociado a este vehículo (para separar costos por moto/carro). Si es combustible, crea un tanqueo vinculado; si es mantenimiento, crea un registro en la bitácora de Mantenimiento.</p>
    </div>
    </div>` : "";
  // Al EDITAR: permitir asociar/cambiar el vehículo (solo la etiqueta) si el gasto no está
  // vinculado a un tanqueo/mantenimiento/obligación (esos se administran desde su módulo).
  const canEditVeh = existing && s.vehiclesEnabled && (s.vehicles || []).length && !existing.fuelId && !existing.maintId && !existing.obligId;
  const linkedVeh = existing && (existing.fuelId || existing.maintId || existing.obligId);
  const vehEditBlock = canEditVeh ? `
    <div class="field" id="m-veh-edit-wrap" style="display:none"><label class="label">Asociar a vehículo</label>
      <select id="m-veh-edit" class="input"><option value="">— no asociar —</option>${s.vehicles.map((v) => `<option value="${escapeHtml(v.id)}" ${existing.vehicleId === v.id ? "selected" : ""}>${v.tipo === "Moto" ? "🏍️" : "🚗"} ${escapeHtml(v.alias || v.modelo)}</option>`).join("")}</select>
      <p class="tiny muted" style="margin-top:4px">Etiqueta este gasto a un vehículo para separar sus costos. No crea tanqueo ni mantenimiento.</p></div>`
    : (linkedVeh ? `<div class="field"><p class="tiny muted">🔗 Este gasto está vinculado a un registro del vehículo (combustible/mantenimiento/obligación). Su vehículo se administra desde ese módulo.</p></div>` : "");
  openModal(existing ? "Editar gasto" : "Nuevo gasto", `
    <div class="field"><label class="label">Fecha</label><input id="m-date" class="input" type="date" value="${existing ? existing.date : todayISO()}"></div>
    <div class="field"><label class="label">Descripción</label><input id="m-desc" class="input" list="m-desc-list" autocomplete="off" placeholder="Ej: Mercado D1" value="${existing ? escapeHtml(existing.desc) : ""}">${descDatalist("m-desc-list", s.txs)}</div>
    <div class="field"><label class="label">Monto (COP)</label><input id="m-amt" class="input" type="number" placeholder="0" value="${existing ? existing.amount : ""}"></div>
    <div class="field"><label class="label">Categoría</label><select id="m-cat" class="input">${catOpts}</select></div>
    ${missingCat ? `<p class="tiny" style="color:var(--yel);margin:-6px 0 10px">⚠ La categoría original de este gasto fue eliminada. Puedes dejarla o elegir una nueva (si la cambias, no podrás volver a la anterior).</p>` : ""}
    <div class="field"><label class="label">Subcategoría</label><select id="m-sub" class="input"></select></div>
    <div class="field"><label class="label">Medio de pago</label><select id="m-pay" class="input">${payOpts}</select></div>
    <div class="field"><label class="label">Cuenta (opcional)</label><select id="m-acct" class="input">${acctOpts}</select></div>
    <div class="field"><label class="label">Etiquetas (opcional)</label><input id="m-tags" class="input" list="m-tags-list" autocomplete="off" placeholder="Ej: viaje, regalo (separadas por coma)" value="${existing && existing.tags ? escapeHtml(existing.tags.join(", ")) : ""}">${tagsDatalist("m-tags-list", s.txs)}</div>
    ${vehBlock}${vehEditBlock}
    ${!existing ? `<button type="button" id="m-split" class="btn btn-ghost btn-block btn-sm" style="margin-bottom:8px">➗ Dividir en varias categorías</button>` : ""}
    <button id="m-save" class="btn btn-primary btn-block">${existing ? "Guardar cambios" : "Guardar"}</button>`, {
    onMount(b) {
      const splitBtn = b.querySelector("#m-split");
      if (splitBtn) splitBtn.onclick = () => openSplitModal({ date: b.querySelector("#m-date").value, desc: b.querySelector("#m-desc").value.trim() });
      const catSel = b.querySelector("#m-cat"), subSel = b.querySelector("#m-sub");
      const fillSubs = () => {
        const c = s.cats.find((x) => x.name === catSel.value);
        // si la categoría ya no existe, conservar la subcategoría original como opción
        const subs = c?.subs || (missingCat && catSel.value === existing.cat && existing.sub ? [existing.sub] : []);
        subSel.innerHTML = subs.map((x) => `<option>${escapeHtml(x)}</option>`).join("");
      };
      // el bloque de vehículo solo aparece en categorías de vehículo (Moto, Carro, Vehículo, variantes)
      const isVehCat = (n) => /moto|carro|veh[ií]culo|autom[oó]vil|\bauto\b/i.test(n || "");
      const vehWrap = b.querySelector("#m-veh-wrap"), vehSelEl = b.querySelector("#m-veh");
      const vehEditWrap = b.querySelector("#m-veh-edit-wrap"); // bloque "Asociar a vehículo" al editar
      const toggleVehWrap = () => {
        const show = isVehCat(catSel.value);
        // al editar: el selector de asociación solo aparece en categorías de vehículo (Moto, Carro…)
        if (vehEditWrap) vehEditWrap.style.display = show ? "block" : "none";
        if (!vehWrap) return;
        vehWrap.style.display = show ? "block" : "none";
        if (!show && vehSelEl) { vehSelEl.value = ""; const ex = b.querySelector("#m-veh-extra"); if (ex) ex.style.display = "none"; }
      };
      moneyPreview(b.querySelector("#m-amt"));
      if (existing) catSel.value = existing.cat;
      catSel.onchange = () => { fillSubs(); toggleVehWrap(); }; fillSubs(); toggleVehWrap();
      if (existing) { subSel.value = existing.sub || ""; b.querySelector("#m-pay").value = existing.pay || "Efectivo"; b.querySelector("#m-acct").value = existing.acct || ""; }
      const vehSel = b.querySelector("#m-veh");
      if (vehSel) {
        const vtypeSel = b.querySelector("#m-vtype");
        const mcatSel = b.querySelector("#m-mcat"), mtipoSel = b.querySelector("#m-mtipo");
        const fillMtipos = () => { mtipoSel.innerHTML = (MAINT_TIPOS[mcatSel.value] || []).map((t) => `<option>${escapeHtml(t)}</option>`).join(""); };
        mcatSel.onchange = () => {
          fillMtipos();
          // Insumos = compra sin instalar → el odómetro no aplica: se limpia solo
          if (mcatSel.value === "Insumos") b.querySelector("#m-modo").value = "";
        };
        fillMtipos();
        const toggleVtype = () => {
          b.querySelector("#m-fuel-fields").style.display = vtypeSel.value === "comb" ? "block" : "none";
          b.querySelector("#m-maint-fields").style.display = vtypeSel.value === "maint" ? "block" : "none";
        };
        vtypeSel.onchange = toggleVtype;
        vehSel.onchange = () => {
          const extra = b.querySelector("#m-veh-extra");
          extra.style.display = vehSel.value ? "block" : "none";
          const v = s.vehicles.find((x) => x.id === vehSel.value);
          const odoIn = b.querySelector("#m-odo"), modoIn = b.querySelector("#m-modo");
          if (v && odoIn && !odoIn.value) odoIn.value = v.odometro ?? "";
          if (v && modoIn && !modoIn.value) modoIn.value = v.odometro ?? "";
          const tipoIn = b.querySelector("#m-tipo");
          if (v && tipoIn && v.combustible) tipoIn.value = v.combustible;
          toggleVtype();
        };
      }
      submitOnce(b.querySelector("#m-save"), async () => {
        const tx = {
          id: existing ? existing.id : uid(), date: b.querySelector("#m-date").value, desc: b.querySelector("#m-desc").value.trim(),
          amount: +b.querySelector("#m-amt").value, cat: catSel.value, sub: subSel.value,
          pay: b.querySelector("#m-pay").value, acct: b.querySelector("#m-acct").value || "",
          tags: parseTags(b.querySelector("#m-tags").value),
        };
        if (existing) {
          const veWrap = b.querySelector("#m-veh-edit-wrap"), veSel = b.querySelector("#m-veh-edit");
          // solo se puede cambiar la asociación cuando el bloque es visible (categoría de vehículo);
          // en otras categorías se conserva la asociación existente (no se borra en silencio)
          const veVisible = veWrap && veWrap.style.display !== "none";
          tx.vehicleId = (veSel && veVisible) ? veSel.value : (existing.vehicleId || "");
          tx.fuelId = existing.fuelId || ""; tx.maintId = existing.maintId || ""; tx.obligId = existing.obligId || "";
        }
        if (!tx.date) return toast("Falta la fecha", true);
        if (!tx.desc || !tx.amount || tx.amount < 0) return toast("Falta descripción o monto válido (positivo)", true);
        if (existing) {
          setState({ txs: getState().txs.map((x) => (x.id === tx.id ? tx : x)) });
          await addTx(s.user.uid, tx); forcePersistLocal(s.user.uid);
          // sincronizar el tanqueo vinculado (valor y fecha vienen del gasto)
          if (tx.fuelId) {
            if (isCloud()) await updateFuel(s.user.uid, tx.fuelId, { costo: tx.amount, fecha: tx.date });
            else { const ex = await loadFuel(s.user.uid); const fr = ex.find((x) => x.id === tx.fuelId); if (fr) { fr.costo = tx.amount; fr.fecha = tx.date; persistFuelLocal(s.user.uid, ex); } }
          }
          // sincronizar el mantenimiento vinculado (valor y fecha vienen del gasto)
          if (tx.maintId) {
            if (isCloud()) await updateMaint(s.user.uid, tx.maintId, { costo: tx.amount, fecha: tx.date });
            else { const ex = await loadMaint(s.user.uid); const mr = ex.find((x) => x.id === tx.maintId); if (mr) { mr.costo = tx.amount; mr.fecha = tx.date; persistMaintLocal(s.user.uid, ex); } }
          }
          closeModal(); drawList(); return toast("Gasto actualizado");
        }
        // asociación opcional a vehículo
        const vehId = vehSel ? vehSel.value : "";
        if (vehId) {
          const v = s.vehicles.find((x) => x.id === vehId);
          tx.vehicleId = vehId; // etiqueta el gasto al vehículo (separa costos por moto/carro)
          const vtype = b.querySelector("#m-vtype").value;
          if (vtype === "comb") {
            const galv = +b.querySelector("#m-gal").value, odov = +b.querySelector("#m-odo").value;
            if (!galv || !odov) return toast("Para combustible, pon galones y odómetro", true);
            const frec = { id: uid(), vehicleId: vehId, fecha: tx.date, estacion: b.querySelector("#m-est").value.trim(), tipoCombustible: b.querySelector("#m-tipo").value, galones: galv, odometro: odov, costo: tx.amount, tanqueLleno: b.querySelector("#m-lleno").value, gastoId: tx.id };
            tx.fuelId = frec.id;
            if (isCloud()) { await addFuel(s.user.uid, frec); }
            else { const ex = await loadFuel(s.user.uid); ex.push(frec); persistFuelLocal(s.user.uid, ex); }
            if (odov && odov !== (v?.odometro || 0)) {
              setState({ vehicles: getState().vehicles.map((x) => (x.id === vehId ? { ...x, odometro: odov } : x)) });
              await saveConfig(s.user.uid, { profile: s.profile, cats: s.cats, budgets: s.budgets, accounts: s.accounts, payMethods: s.payMethods, vehicles: getState().vehicles, vehiclesEnabled: s.vehiclesEnabled, goals: s.goals });
            }
          } else if (vtype === "maint") {
            const num = (id) => { const x = b.querySelector("#" + id).value; return x === "" ? null : +x; };
            const odom = num("m-modo");
            const mrec = {
              id: uid(), vehicleId: vehId, categoria: b.querySelector("#m-mcat").value, tipo: b.querySelector("#m-mtipo").value,
              fecha: tx.date, odometro: odom, descripcion: tx.desc, repuesto: "", taller: b.querySelector("#m-mtaller").value.trim(),
              costo: tx.amount, proximoKm: num("m-mpkm"), recurrenteKm: num("m-mrkm"),
              proximaFecha: b.querySelector("#m-mpfecha").value || "", recurrenteDias: num("m-mrdias"), gastoId: tx.id,
            };
            tx.maintId = mrec.id;
            if (isCloud()) { await addMaint(s.user.uid, mrec); }
            else { const ex = await loadMaint(s.user.uid); ex.push(mrec); persistMaintLocal(s.user.uid, ex); }
            if (odom && odom > (v?.odometro || 0)) {
              setState({ vehicles: getState().vehicles.map((x) => (x.id === vehId ? { ...x, odometro: odom } : x)) });
              await saveConfig(s.user.uid, { profile: s.profile, cats: s.cats, budgets: s.budgets, accounts: s.accounts, payMethods: s.payMethods, vehicles: getState().vehicles, vehiclesEnabled: s.vehiclesEnabled, goals: s.goals });
            }
          }
        }
        setState({ txs: [tx, ...s.txs] });
        await addTx(s.user.uid, tx); forcePersistLocal(s.user.uid);
        closeModal(); drawList(); toast(vehId ? "Gasto agregado y registrado en el vehículo" : "Gasto agregado");
      });
    },
  });
}

// Dividir un gasto: un mismo pago repartido en varias categorías. Crea una transacción por
// parte (cada una es un gasto normal), enlazadas por un mismo splitId. Fecha/desc/pago/cuenta
// se comparten. Cada parte se puede editar o borrar por separado luego.
export function openSplitModal(prefill = {}) {
  const s = getState();
  const catOpts = s.cats.map((c) => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`).join("");
  const payList = [...DEFAULT_PAY_METHODS.filter((m) => m !== "Otro"), ...(s.payMethods || []), "Otro"];
  const payOpts = payList.map((m) => `<option>${escapeHtml(m)}</option>`).join("");
  const acctOpts = `<option value="">— ninguna —</option>` + (s.accounts || []).map((a) => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)}</option>`).join("");
  const partRow = () => `<div class="row gap-2 split-part" style="margin-bottom:6px;align-items:center">
      <select class="input sp-cat" style="flex:1;min-width:0">${catOpts}</select>
      <input class="input sp-amt" type="number" placeholder="0" style="width:110px">
      <button type="button" class="icon-btn sp-del" aria-label="Quitar parte">✕</button></div>`;
  openModal("Dividir gasto", `
    <p class="tiny muted" style="margin:-4px 0 10px">Un pago repartido en varias categorías (ej. mercado + aseo en una compra). Se crea un gasto por parte, con la misma fecha y descripción.</p>
    <div class="field"><label class="label">Fecha</label><input id="sp-date" class="input" type="date" value="${prefill.date || todayISO()}"></div>
    <div class="field"><label class="label">Descripción</label><input id="sp-desc" class="input" list="sp-desc-list" autocomplete="off" placeholder="Ej: Compra Éxito" value="${escapeHtml(prefill.desc || "")}">${descDatalist("sp-desc-list", s.txs)}</div>
    <div class="field"><label class="label">Medio de pago</label><select id="sp-pay" class="input">${payOpts}</select></div>
    <div class="field"><label class="label">Cuenta (opcional)</label><select id="sp-acct" class="input">${acctOpts}</select></div>
    <label class="label">Partes (categoría · monto)</label>
    <div id="sp-parts">${partRow()}${partRow()}</div>
    <button type="button" id="sp-add" class="btn btn-ghost btn-sm">+ Agregar parte</button>
    <div class="row between mt-2 small" style="padding-top:6px;border-top:1px solid var(--line)"><span class="muted">Total repartido</span><span id="sp-total" class="bold" style="color:var(--gold)">$0</span></div>
    <button id="sp-save" class="btn btn-primary btn-block mt-2">Guardar gasto dividido</button>`, {
    onMount(b) {
      const parts = b.querySelector("#sp-parts");
      const recalc = () => { const t = [...b.querySelectorAll(".sp-amt")].reduce((a, i) => a + (+i.value || 0), 0); b.querySelector("#sp-total").textContent = fmt(t); };
      const wire = () => {
        b.querySelectorAll(".sp-amt").forEach((i) => i.oninput = recalc);
        b.querySelectorAll(".sp-del").forEach((x) => x.onclick = () => { if (b.querySelectorAll(".split-part").length > 1) { x.closest(".split-part").remove(); recalc(); } });
      };
      wire();
      b.querySelector("#sp-add").onclick = () => { parts.insertAdjacentHTML("beforeend", partRow()); wire(); };
      submitOnce(b.querySelector("#sp-save"), async () => {
        const date = b.querySelector("#sp-date").value, desc = b.querySelector("#sp-desc").value.trim();
        const pay = b.querySelector("#sp-pay").value, acct = b.querySelector("#sp-acct").value || "";
        if (!date || !desc) return toast("Falta fecha o descripción", true);
        const partsData = [...b.querySelectorAll(".split-part")]
          .map((p) => ({ cat: p.querySelector(".sp-cat").value, amount: +p.querySelector(".sp-amt").value || 0 }))
          .filter((p) => p.amount > 0);
        if (partsData.length < 2) return toast("Necesitas al menos 2 partes con monto", true);
        const splitId = uid(), s2 = getState();
        const newTxs = partsData.map((p) => {
          const c = s2.cats.find((x) => x.name === p.cat);
          return { id: uid(), date, desc, amount: p.amount, cat: p.cat, sub: (c && c.subs && c.subs[0]) || "", pay, acct, tags: [], splitId };
        });
        setState({ txs: [...newTxs, ...s2.txs] });
        for (const t of newTxs) await addTx(s2.user.uid, t);
        forcePersistLocal(s2.user.uid);
        closeModal(); drawList(); toast(`Gasto dividido en ${newTxs.length} partes`);
      });
    },
  });
}

export function openIncomeModal(existing) {
  const s = getState();
  const typeOpts = INCOME_TYPES.map((t) => `<option>${t}</option>`).join("");
  openModal(existing ? "Editar ingreso" : "Nuevo ingreso", `
    <div class="field"><label class="label">Fecha</label><input id="i-date" class="input" type="date" value="${existing ? existing.date : todayISO()}"></div>
    <div class="field"><label class="label">Descripción</label><input id="i-desc" class="input" list="i-desc-list" autocomplete="off" placeholder="Ej: Salario" value="${existing ? escapeHtml(existing.desc) : ""}">${descDatalist("i-desc-list", s.incomes)}</div>
    <div class="field"><label class="label">Monto (COP)</label><input id="i-amt" class="input" type="number" placeholder="0" value="${existing ? existing.amount : ""}"></div>
    <div class="field"><label class="label">Tipo</label><select id="i-type" class="input">${typeOpts}</select></div>
    <button id="i-save" class="btn btn-primary btn-block">${existing ? "Guardar cambios" : "Guardar"}</button>`, {
    onMount(b) {
      moneyPreview(b.querySelector("#i-amt"));
      if (existing) b.querySelector("#i-type").value = existing.type || "Otros ingresos";
      submitOnce(b.querySelector("#i-save"), async () => {
        const inc = { id: existing ? existing.id : uid(), date: b.querySelector("#i-date").value, desc: b.querySelector("#i-desc").value.trim(), amount: +b.querySelector("#i-amt").value, type: b.querySelector("#i-type").value };
        if (!inc.date) return toast("Falta la fecha", true);
        if (!inc.desc || !inc.amount || inc.amount < 0) return toast("Falta descripción o monto válido (positivo)", true);
        setState({ incomes: existing ? getState().incomes.map((x) => (x.id === inc.id ? inc : x)) : [inc, ...getState().incomes] });
        await addIncome(s.user.uid, inc); forcePersistLocal(s.user.uid);
        closeModal(); drawList(); toast(existing ? "Ingreso actualizado" : "Ingreso agregado");
      });
    },
  });
}
