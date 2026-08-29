// js/views/debts.js — módulo opcional: deudas, préstamos y tarjetas de crédito
import { getState, setState } from "../state.js";
import { saveConfig, forcePersistLocal } from "../firebase-service.js";
import { fmt, uid, escapeHtml, debounce, sum, fmtDate, todayISO } from "../utils.js";
import { openModal, closeModal, toast, confirmDialog, submitOnce, moneyPreview } from "../components/modals.js";

const persist = debounce(async () => {
  const s = getState();
  await saveConfig(s.user.uid, {
    profile: s.profile, cats: s.cats, budgets: s.budgets, accounts: s.accounts, payMethods: s.payMethods,
    vehicles: s.vehicles, vehiclesEnabled: s.vehiclesEnabled, goals: s.goals, recurrentes: s.recurrentes,
    debts: s.debts, debtsEnabled: s.debtsEnabled,
  });
  forcePersistLocal(s.user.uid);
}, 500);

const TIPOS = [
  { key: "debo", label: "Debo", emoji: "🔴" },
  { key: "me_deben", label: "Me deben", emoji: "🟢" },
  { key: "tarjeta", label: "Tarjeta de crédito", emoji: "💳" },
];
const tipoOf = (k) => TIPOS.find((t) => t.key === k) || TIPOS[0];

// días hasta la próxima ocurrencia de un día del mes (1..31)
function daysToDay(day) {
  if (!day) return null;
  const t = new Date(todayISO() + "T00:00:00");
  const y = t.getFullYear(), m = t.getMonth();
  const clamp = (yy, mm) => Math.min(day, new Date(yy, mm + 1, 0).getDate());
  let d = new Date(y, m, clamp(y, m));
  if (d < t) { const nm = new Date(y, m + 1, 1); d = new Date(nm.getFullYear(), nm.getMonth(), clamp(nm.getFullYear(), nm.getMonth())); }
  return Math.round((d - t) / 86400000);
}

function kpi(label, val, col) {
  return `<div class="kpi"><div class="k-label">${label}</div><div class="k-val sm"${col ? ` style="color:${col}"` : ""}>${val}</div></div>`;
}

export function renderDebts(root) {
  const s = getState();
  const debts = s.debts || [];
  const debo = sum(debts.filter((d) => d.tipo === "debo" || d.tipo === "tarjeta"), (d) => +d.saldo || 0);
  const meDeben = sum(debts.filter((d) => d.tipo === "me_deben"), (d) => +d.saldo || 0);
  const cupoDisp = sum(debts.filter((d) => d.tipo === "tarjeta"), (d) => Math.max(0, (+d.monto || 0) - (+d.saldo || 0)));

  root.innerHTML = `
    <h2 class="page-title disp">Deudas y préstamos</h2>
    <p class="page-sub">A quién le debes, quién te debe y tus tarjetas</p>
    <div class="grid-kpi mb-3">
      ${kpi("Debo", fmt(debo), "var(--red)")}
      ${kpi("Me deben", fmt(meDeben), "var(--green)")}
      ${kpi("Cupo disponible", fmt(cupoDisp))}
    </div>
    <button id="add-debt" class="btn btn-primary btn-block mb-3">+ Agregar</button>
    <div id="debt-list"></div>`;

  root.querySelector("#add-debt").onclick = () => openDebtModal(root, null);
  drawDebts(root);
}

function drawDebts(root) {
  const debts = getState().debts || [];
  const host = root.querySelector("#debt-list");
  if (!debts.length) { host.innerHTML = `<div class="empty"><p>Sin deudas registradas. Agrega a quién le debes, quién te debe o una tarjeta de crédito, y registra sus abonos.</p></div>`; return; }
  const order = { debo: 0, tarjeta: 1, me_deben: 2 };
  host.innerHTML = [...debts].sort((a, b) => (order[a.tipo] ?? 3) - (order[b.tipo] ?? 3)).map((d) => {
    const t = tipoOf(d.tipo), saldo = +d.saldo || 0, monto = +d.monto || 0;
    let detail = "";
    if (d.tipo === "tarjeta") {
      const disp = Math.max(0, monto - saldo), pct = monto ? Math.min(100, (saldo / monto) * 100) : 0;
      const np = d.pago ? daysToDay(d.pago) : null;
      detail = `
        <div class="row between small mt-1"><span class="muted">Usado / cupo</span><span>${fmt(saldo)} / ${fmt(monto)}</span></div>
        <div class="bar mt-1"><span style="width:${pct}%;background:${pct > 80 ? "var(--red)" : "var(--gold)"}"></span></div>
        <div class="row between tiny mt-1"><span class="muted">Disponible ${fmt(disp)}</span>${d.pago ? `<span>Pago día ${d.pago}${np != null ? ` · en ${np} d` : ""}</span>` : ""}</div>
        ${d.corte ? `<div class="tiny muted">Corte día ${d.corte}</div>` : ""}`;
    } else {
      const pagado = Math.max(0, monto - saldo), pct = monto ? Math.min(100, (pagado / monto) * 100) : 0;
      detail = `<div class="row between small mt-1"><span class="muted">Saldo pendiente</span><span class="bold">${fmt(saldo)}</span></div>
        ${monto ? `<div class="bar mt-1"><span style="width:${pct}%;background:var(--green)"></span></div>
        <div class="tiny muted mt-1">Abonado ${fmt(pagado)} de ${fmt(monto)} (${pct.toFixed(0)}%)</div>` : ""}`;
    }
    const hist = (d.abonos || []).slice().sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 6);
    return `<div class="card mb-3">
      <div class="row between" style="align-items:flex-start">
        <div style="min-width:0"><div class="card-title" style="margin:0">${t.emoji} ${escapeHtml(d.nombre)}</div>
          <div class="tiny muted">${t.label}${d.tasa ? ` · ${d.tasa}%` : ""}${d.nota ? ` · ${escapeHtml(d.nota)}` : ""}</div></div>
        <div class="tx-amt" style="color:${d.tipo === "me_deben" ? "var(--green)" : "var(--red)"}">${fmt(saldo)}</div>
      </div>
      ${detail}
      <div class="row gap-2 mt-3 wrap">
        <button class="btn btn-primary btn-sm flex1" data-ab="${d.id}">${d.tipo === "me_deben" ? "Registrar pago" : d.tipo === "tarjeta" ? "Movimiento" : "Abonar"}</button>
        <button class="btn btn-ghost btn-sm" data-ed="${d.id}">Editar</button>
        <button class="btn btn-ghost btn-sm" data-de="${d.id}">Eliminar</button>
      </div>
      ${hist.length ? `<div class="mt-2">${hist.map((ab) => `<div class="row between tiny" style="padding:4px 0;border-top:1px solid var(--line)">
        <span class="muted">${fmtDate(ab.date)}${ab.note ? " · " + escapeHtml(ab.note) : ""}</span>
        <span style="color:${ab.delta < 0 ? "var(--green)" : "var(--red)"}">${ab.delta < 0 ? "−" : "+"}${fmt(Math.abs(ab.delta))}</span></div>`).join("")}</div>` : ""}
    </div>`;
  }).join("");

  host.querySelectorAll("[data-ab]").forEach((b) => b.onclick = () => openAbonoModal(root, b.getAttribute("data-ab")));
  host.querySelectorAll("[data-ed]").forEach((b) => b.onclick = () => openDebtModal(root, (getState().debts || []).find((x) => x.id === b.getAttribute("data-ed"))));
  host.querySelectorAll("[data-de]").forEach((b) => b.onclick = () => confirmDialog("¿Eliminar esta deuda?", () => {
    setState({ debts: (getState().debts || []).filter((x) => x.id !== b.getAttribute("data-de")) }); persist(); renderDebts(root);
  }));
}

function openDebtModal(root, d) {
  const editing = !!d;
  const tipoOpts = TIPOS.map((t) => `<option value="${t.key}" ${d && d.tipo === t.key ? "selected" : ""}>${t.emoji} ${t.label}</option>`).join("");
  openModal(editing ? "Editar deuda" : "Nueva deuda", `
    <div class="field"><label class="label">Tipo</label><select id="d-tipo" class="input">${tipoOpts}</select></div>
    <div class="field"><label class="label">Nombre</label><input id="d-nom" class="input" placeholder="Ej: Felipe / Tarjeta Visa" value="${editing ? escapeHtml(d.nombre || "") : ""}"></div>
    <div class="field"><label class="label" id="d-monto-lbl">Monto total (COP)</label><input id="d-monto" class="input" type="number" value="${editing ? (d.monto ?? "") : ""}" placeholder="0"></div>
    <div class="field"><label class="label" id="d-saldo-lbl">Saldo pendiente (COP)</label><input id="d-saldo" class="input" type="number" value="${editing ? (d.saldo ?? "") : ""}" placeholder="(vacío = igual al monto)"></div>
    <div class="field"><label class="label">Tasa % (opcional)</label><input id="d-tasa" class="input" type="number" step="0.01" value="${editing ? (d.tasa ?? "") : ""}" placeholder="0"></div>
    <div id="d-card-fields" style="display:none">
      <div class="row gap-2">
        <div class="field flex1"><label class="label">Día de corte</label><input id="d-corte" class="input" type="number" min="1" max="31" value="${editing ? (d.corte ?? "") : ""}"></div>
        <div class="field flex1"><label class="label">Día de pago</label><input id="d-pago" class="input" type="number" min="1" max="31" value="${editing ? (d.pago ?? "") : ""}"></div>
      </div>
    </div>
    <div class="field"><label class="label">Nota (opcional)</label><input id="d-nota" class="input" value="${editing ? escapeHtml(d.nota || "") : ""}"></div>
    <button id="d-save" class="btn btn-primary btn-block">${editing ? "Guardar cambios" : "Crear"}</button>`, {
    onMount(b) {
      moneyPreview(b.querySelector("#d-monto")); moneyPreview(b.querySelector("#d-saldo"));
      const tipoSel = b.querySelector("#d-tipo");
      const sync = () => {
        const isCard = tipoSel.value === "tarjeta";
        b.querySelector("#d-card-fields").style.display = isCard ? "block" : "none";
        b.querySelector("#d-monto-lbl").textContent = isCard ? "Cupo total (COP)" : "Monto total (COP)";
        b.querySelector("#d-saldo-lbl").textContent = isCard ? "Saldo usado (COP)" : "Saldo pendiente (COP)";
      };
      tipoSel.onchange = sync; sync();
      submitOnce(b.querySelector("#d-save"), async () => {
        const nombre = b.querySelector("#d-nom").value.trim();
        if (!nombre) return toast("Falta el nombre", true);
        const monto = +b.querySelector("#d-monto").value || 0;
        const saldoRaw = b.querySelector("#d-saldo").value;
        const saldo = saldoRaw === "" ? monto : (+saldoRaw || 0);
        const num = (id) => { const v = b.querySelector(id).value; return v === "" ? null : +v; };
        const data = { tipo: tipoSel.value, nombre, monto, saldo, tasa: num("#d-tasa"), corte: num("#d-corte"), pago: num("#d-pago"), nota: b.querySelector("#d-nota").value.trim() };
        const st = getState();
        if (editing) setState({ debts: st.debts.map((x) => x.id === d.id ? { ...x, ...data } : x) });
        else setState({ debts: [...(st.debts || []), { id: uid(), ...data, abonos: [] }] });
        persist(); closeModal(); renderDebts(root); toast(editing ? "Deuda actualizada" : "Deuda creada");
      });
    },
  });
}

// Abono / movimiento: reduce (pago/abono) o aumenta (consumo de tarjeta) el saldo.
function openAbonoModal(root, debtId) {
  const d = (getState().debts || []).find((x) => x.id === debtId);
  if (!d) return;
  const isCard = d.tipo === "tarjeta";
  openModal(`${isCard ? "Movimiento" : "Abono"} · ${escapeHtml(d.nombre)}`, `
    <div class="row between" style="padding:8px 0;border-bottom:1px solid var(--line)"><span class="small muted">Saldo actual</span><span class="small bold">${fmt(d.saldo)}</span></div>
    ${isCard ? `<div class="field mt-3"><label class="label">Tipo</label><div class="row gap-2">
      <button type="button" class="chip on flex1" data-k="pago">Pago (−)</button>
      <button type="button" class="chip flex1" data-k="consumo">Consumo (+)</button></div></div>` : ""}
    <div class="field ${isCard ? "" : "mt-3"}"><label class="label">Monto (COP)</label><input id="ab-amt" class="input" type="number" inputmode="numeric" placeholder="0"></div>
    <div class="field"><label class="label">Nota (opcional)</label><input id="ab-note" class="input" placeholder="${isCard ? "Ej: compra, pago tarjeta" : "Ej: abono"}"></div>
    <div class="field"><label class="label">Fecha</label><input id="ab-date" class="input" type="date" value="${todayISO()}"></div>
    <button id="ab-save" class="btn btn-primary btn-block">Registrar</button>`, {
    onMount(b) {
      let kind = isCard ? "pago" : "abono";
      moneyPreview(b.querySelector("#ab-amt"));
      b.querySelectorAll("[data-k]").forEach((c) => c.onclick = () => { kind = c.getAttribute("data-k"); b.querySelectorAll("[data-k]").forEach((x) => x.classList.toggle("on", x === c)); });
      submitOnce(b.querySelector("#ab-save"), async () => {
        const amt = Math.abs(+b.querySelector("#ab-amt").value || 0);
        if (!amt) return toast("Ingresa un monto", true);
        const note = b.querySelector("#ab-note").value.trim();
        const date = b.querySelector("#ab-date").value || todayISO();
        const delta = kind === "consumo" ? amt : -amt;    // consumo suma; pago/abono resta
        const ab = { id: uid(), date, delta, note, kind };
        const st = getState();
        setState({ debts: st.debts.map((x) => x.id === debtId ? { ...x, saldo: Math.max(0, (+x.saldo || 0) + delta), abonos: [ab, ...(x.abonos || [])] } : x) });
        persist(); closeModal(); renderDebts(root); toast("Registrado");
      });
    },
  });
}
