// js/views/home.js
import { getState, setState } from "../state.js";
import { addTx, deleteTx, addIncome, deleteIncome, forcePersistLocal, addFuel, loadFuel, persistFuelLocal, isCloud, saveConfig } from "../firebase-service.js";
import { fmt, uid, todayISO, escapeHtml } from "../utils.js";
import { PALETTE, INCOME_TYPES, DEFAULT_PAY_METHODS, FUEL_TYPES } from "../config.js";
import { openModal, closeModal, toast, confirmDialog } from "../components/modals.js";

let query = "";
let tabKind = "gasto";

export function renderHome(root) {
  const s = getState();
  const n = tabKind === "gasto" ? s.txs.length : s.incomes.length;
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
    <div class="card" style="padding:0" id="list"></div>`;

  root.querySelectorAll("[data-kind]").forEach((b) => b.onclick = () => { tabKind = b.getAttribute("data-kind"); renderHome(root); });
  root.querySelector("#q").oninput = (e) => { query = e.target.value; drawList(); };

  // FAB fuera del contenedor animado (#view), pegado a la pantalla, siempre visible
  let fab = document.getElementById("fab");
  if (!fab) {
    fab = document.createElement("button");
    fab.id = "fab"; fab.className = "fab"; fab.setAttribute("aria-label", "Agregar");
    fab.innerHTML = `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 5v14M5 12h14"/></svg>`;
    document.body.appendChild(fab);
  }
  fab.onclick = () => tabKind === "gasto" ? openTxModal() : openIncomeModal();
  drawList();
}

function drawList() {
  const s = getState();
  const list = document.getElementById("list");
  if (!list) return;
  if (tabKind === "gasto") {
    const f = query ? s.txs.filter((t) => (t.desc + t.cat + t.sub).toLowerCase().includes(query.toLowerCase())) : s.txs;
    const rows = [...f].sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 300);
    if (!rows.length) { list.innerHTML = `<div class="muted small" style="padding:20px">Sin gastos. Toca + para agregar.</div>`; return; }
    list.innerHTML = rows.map((t) => {
      const ci = s.cats.findIndex((c) => c.name === t.cat);
      return `<div class="tx-row">
        <span class="tx-dot" style="background:${PALETTE[(ci + 11) % PALETTE.length]}"></span>
        <div class="flex1"><div class="tx-desc ellipsis">${escapeHtml(t.desc)}</div>
          <div class="tx-meta">${t.date} · ${escapeHtml(t.cat)} &rsaquo; ${escapeHtml(t.sub || "")}${t.pay ? " · " + escapeHtml(t.pay) : ""}</div></div>
        <div class="tx-amt">${fmt(t.amount)}</div>
        <button class="icon-btn" data-del="${t.id}"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2m-9 0v14h10V6"/></svg></button>
      </div>`;
    }).join("");
    list.querySelectorAll("[data-del]").forEach((b) => b.onclick = () => confirmDialog("¿Eliminar este gasto?", async () => {
      const id = b.getAttribute("data-del");
      setState({ txs: getState().txs.filter((x) => x.id !== id) });
      await deleteTx(s.user.uid, id); forcePersistLocal(s.user.uid); drawList(); toast("Eliminado");
    }));
  } else {
    const f = query ? s.incomes.filter((t) => (t.desc + t.type).toLowerCase().includes(query.toLowerCase())) : s.incomes;
    const rows = [...f].sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 300);
    if (!rows.length) { list.innerHTML = `<div class="muted small" style="padding:20px">Sin ingresos. Toca + para agregar.</div>`; return; }
    list.innerHTML = rows.map((t) => `<div class="tx-row">
        <span class="tx-dot" style="background:var(--green)"></span>
        <div class="flex1"><div class="tx-desc ellipsis">${escapeHtml(t.desc)}</div>
          <div class="tx-meta">${t.date} · ${escapeHtml(t.type || "")}</div></div>
        <div class="tx-amt" style="color:var(--green)">${fmt(t.amount)}</div>
        <button class="icon-btn" data-deli="${t.id}"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2m-9 0v14h10V6"/></svg></button>
      </div>`).join("");
    list.querySelectorAll("[data-deli]").forEach((b) => b.onclick = () => confirmDialog("¿Eliminar este ingreso?", async () => {
      const id = b.getAttribute("data-deli");
      setState({ incomes: getState().incomes.filter((x) => x.id !== id) });
      await deleteIncome(s.user.uid, id); forcePersistLocal(s.user.uid); drawList(); toast("Eliminado");
    }));
  }
}

export function openTxModal() {
  const s = getState();
  const catOpts = s.cats.map((c) => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`).join("");
  const payList = [...DEFAULT_PAY_METHODS.filter((m) => m !== "Otro"), ...(s.payMethods || []), "Otro"];
  const payOpts = payList.map((m) => `<option>${escapeHtml(m)}</option>`).join("");
  const acctOpts = `<option value="">— ninguna —</option>` + (s.accounts || []).map((a) => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)}</option>`).join("");
  const vehs = (s.vehiclesEnabled && (s.vehicles || []).length) ? s.vehicles : [];
  const vehBlock = vehs.length ? `
    <div class="field"><label class="label">Asociar a vehículo (opcional)</label>
      <select id="m-veh" class="input"><option value="">— no asociar —</option>${vehs.map((v) => `<option value="${escapeHtml(v.id)}">${v.tipo === "Moto" ? "🏍️" : "🚗"} ${escapeHtml(v.alias || v.modelo)}</option>`).join("")}</select></div>
    <div id="m-veh-extra" style="display:none">
      <div class="field"><label class="label">Estación</label><input id="m-est" class="input" placeholder="Ej: Terpel, Texaco"></div>
      <div class="field"><label class="label">Tipo de combustible</label><select id="m-tipo" class="input">${FUEL_TYPES.map((t) => `<option>${t}</option>`).join("")}</select></div>
      <div class="field"><label class="label">Galones</label><input id="m-gal" class="input" type="number" step="0.001" placeholder="Ej: 2.5"></div>
      <div class="field"><label class="label">Odómetro (km del tablero)</label><input id="m-odo" class="input" type="number"></div>
      <div class="field"><label class="label">¿Tanque lleno?</label><select id="m-lleno" class="input"><option>Sí</option><option>No</option></select></div>
      <p class="tiny muted">Esto crea un tanqueo en la bitácora del vehículo, vinculado a este gasto (no se duplica la plata).</p>
    </div>` : "";
  openModal("Nuevo gasto", `
    <div class="field"><label class="label">Fecha</label><input id="m-date" class="input" type="date" value="${todayISO()}"></div>
    <div class="field"><label class="label">Descripción</label><input id="m-desc" class="input" placeholder="Ej: Mercado D1"></div>
    <div class="field"><label class="label">Monto (COP)</label><input id="m-amt" class="input" type="number" placeholder="0"></div>
    <div class="field"><label class="label">Categoría</label><select id="m-cat" class="input">${catOpts}</select></div>
    <div class="field"><label class="label">Subcategoría</label><select id="m-sub" class="input"></select></div>
    <div class="field"><label class="label">Medio de pago</label><select id="m-pay" class="input">${payOpts}</select></div>
    <div class="field"><label class="label">Cuenta (opcional)</label><select id="m-acct" class="input">${acctOpts}</select></div>
    ${vehBlock}
    <button id="m-save" class="btn btn-primary btn-block">Guardar</button>`, {
    onMount(b) {
      const catSel = b.querySelector("#m-cat"), subSel = b.querySelector("#m-sub");
      const fillSubs = () => { const c = s.cats.find((x) => x.name === catSel.value); subSel.innerHTML = (c?.subs || []).map((x) => `<option>${escapeHtml(x)}</option>`).join(""); };
      catSel.onchange = fillSubs; fillSubs();
      const vehSel = b.querySelector("#m-veh");
      if (vehSel) vehSel.onchange = () => {
        const extra = b.querySelector("#m-veh-extra");
        extra.style.display = vehSel.value ? "block" : "none";
        const v = s.vehicles.find((x) => x.id === vehSel.value);
        const odoIn = b.querySelector("#m-odo");
        if (v && odoIn && !odoIn.value) odoIn.value = v.odometro ?? "";
        const tipoIn = b.querySelector("#m-tipo");
        if (v && tipoIn && v.combustible) tipoIn.value = v.combustible;
      };
      b.querySelector("#m-save").onclick = async () => {
        const tx = {
          id: uid(), date: b.querySelector("#m-date").value, desc: b.querySelector("#m-desc").value.trim(),
          amount: +b.querySelector("#m-amt").value, cat: catSel.value, sub: subSel.value,
          pay: b.querySelector("#m-pay").value, acct: b.querySelector("#m-acct").value || "",
        };
        if (!tx.desc || !tx.amount) return toast("Falta descripción o monto", true);
        // asociación opcional a vehículo (crea tanqueo vinculado)
        const vehId = vehSel ? vehSel.value : "";
        if (vehId) {
          const v = s.vehicles.find((x) => x.id === vehId);
          const galv = +b.querySelector("#m-gal").value, odov = +b.querySelector("#m-odo").value;
          if (!galv || !odov) return toast("Para asociar al vehículo, pon galones y odómetro", true);
          const frec = { id: uid(), vehicleId: vehId, fecha: tx.date, estacion: b.querySelector("#m-est").value.trim(), tipoCombustible: b.querySelector("#m-tipo").value, galones: galv, odometro: odov, costo: tx.amount, tanqueLleno: b.querySelector("#m-lleno").value, gastoId: tx.id };
          tx.vehicleId = vehId; tx.fuelId = frec.id;
          if (isCloud()) { await addFuel(s.user.uid, frec); }
          else { const ex = await loadFuel(s.user.uid); ex.push(frec); persistFuelLocal(s.user.uid, ex); }
          if (odov > (v?.odometro || 0)) {
            setState({ vehicles: getState().vehicles.map((x) => (x.id === vehId ? { ...x, odometro: odov } : x)) });
            await saveConfig(s.user.uid, { profile: s.profile, cats: s.cats, budgets: s.budgets, accounts: s.accounts, payMethods: s.payMethods, vehicles: getState().vehicles, vehiclesEnabled: s.vehiclesEnabled });
          }
        }
        setState({ txs: [tx, ...s.txs] });
        await addTx(s.user.uid, tx); forcePersistLocal(s.user.uid);
        closeModal(); drawList(); toast(vehId ? "Gasto agregado y registrado en el vehículo" : "Gasto agregado");
      };
    },
  });
}

export function openIncomeModal() {
  const s = getState();
  const typeOpts = INCOME_TYPES.map((t) => `<option>${t}</option>`).join("");
  openModal("Nuevo ingreso", `
    <div class="field"><label class="label">Fecha</label><input id="i-date" class="input" type="date" value="${todayISO()}"></div>
    <div class="field"><label class="label">Descripción</label><input id="i-desc" class="input" placeholder="Ej: Salario"></div>
    <div class="field"><label class="label">Monto (COP)</label><input id="i-amt" class="input" type="number" placeholder="0"></div>
    <div class="field"><label class="label">Tipo</label><select id="i-type" class="input">${typeOpts}</select></div>
    <button id="i-save" class="btn btn-primary btn-block">Guardar</button>`, {
    onMount(b) {
      b.querySelector("#i-save").onclick = async () => {
        const inc = { id: uid(), date: b.querySelector("#i-date").value, desc: b.querySelector("#i-desc").value.trim(), amount: +b.querySelector("#i-amt").value, type: b.querySelector("#i-type").value };
        if (!inc.desc || !inc.amount) return toast("Falta descripción o monto", true);
        setState({ incomes: [inc, ...s.incomes] });
        await addIncome(s.user.uid, inc); forcePersistLocal(s.user.uid);
        closeModal(); drawList(); toast("Ingreso agregado");
      };
    },
  });
}
