// js/views/accounts.js
import { getState, setState } from "../state.js";
import { saveConfig, forcePersistLocal } from "../firebase-service.js";
import { fmt, uid, escapeHtml, debounce, sum } from "../utils.js";
import { ACCOUNT_TYPES, PALETTE } from "../config.js";
import { openModal, closeModal, toast, confirmDialog, submitOnce } from "../components/modals.js";
import { donut } from "../components/charts.js";

const persist = debounce(async () => {
  const s = getState();
  await saveConfig(s.user.uid, { profile: s.profile, cats: s.cats, budgets: s.budgets, accounts: s.accounts, payMethods: s.payMethods });
  forcePersistLocal(s.user.uid);
}, 500);

export function renderAccounts(root) {
  const s = getState();
  const accts = s.accounts || [];
  const total = sum(accts, (a) => a.balance);

  root.innerHTML = `
    <h2 class="page-title disp">Cuentas y ahorro</h2>
    <p class="page-sub">Dónde está tu dinero y cómo se distribuye</p>

    <div class="kpi mb-3" style="background:linear-gradient(135deg,#1d272c,#161e22)">
      <div class="k-label">Total disponible</div>
      <div class="k-val">${fmt(total)}</div>
    </div>

    ${accts.length ? `<div class="card mb-3"><div class="card-title">Distribución por cuenta</div>
      <div class="chart-box" style="height:210px"><canvas id="ch-acct"></canvas></div>
      <div id="acct-leg" class="row wrap gap-2 mt-2"></div></div>

      <div class="card mb-3"><div class="card-title">Por tipo de cuenta</div><div id="by-type"></div></div>` : ""}

    <div class="card mb-3">
      <div class="row between mb-3"><div class="card-title" style="margin:0">Tus cuentas</div>
        <button id="add-acct" class="btn btn-primary btn-sm">+ Cuenta</button></div>
      <div id="acct-list"></div>
    </div>`;

  root.querySelector("#add-acct").onclick = () => openAcctModal(root);
  drawList(root);

  if (accts.length) {
    donut("ch-acct", accts.map((a) => a.name), accts.map((a) => a.balance));
    root.querySelector("#acct-leg").innerHTML = accts.map((a, i) =>
      `<span class="tiny muted row gap-1"><span style="width:9px;height:9px;border-radius:3px;background:${PALETTE[i % PALETTE.length]}"></span>${escapeHtml(a.name)} ${total ? ((a.balance / total) * 100).toFixed(0) : 0}%</span>`).join("");

    const byType = {};
    accts.forEach((a) => { byType[a.type] = (byType[a.type] || 0) + (+a.balance || 0); });
    root.querySelector("#by-type").innerHTML = Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([t, v]) => `
      <div class="dane-row"><span class="muted">${escapeHtml(t)}</span>
        <div class="bar" style="height:7px"><span style="width:${total ? (v / total) * 100 : 0}%;background:var(--gold)"></span></div>
        <span style="text-align:right">${fmt(v)}</span></div>`).join("");
  }
}

function drawList(root) {
  const s = getState();
  const host = root.querySelector("#acct-list");
  const accts = s.accounts || [];
  if (!accts.length) { host.innerHTML = `<div class="muted small">Aún no tienes cuentas. Agrega tu cuenta de ahorros, efectivo, etc.</div>`; return; }
  host.innerHTML = accts.map((a, i) => `
    <div class="tx-row">
      <span class="tx-dot" style="background:${PALETTE[i % PALETTE.length]}"></span>
      <div class="flex1"><div class="tx-desc">${escapeHtml(a.name)}</div><div class="tx-meta">${escapeHtml(a.type)}</div></div>
      <div class="tx-amt">${fmt(a.balance)}</div>
      <button class="icon-btn" data-edit="${a.id}"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg></button>
      <button class="icon-btn" data-del="${a.id}"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2m-9 0v14h10V6"/></svg></button>
    </div>`).join("");
  host.querySelectorAll("[data-edit]").forEach((b) => b.onclick = () => openAcctModal(root, accts.find((a) => a.id === b.getAttribute("data-edit"))));
  host.querySelectorAll("[data-del]").forEach((b) => b.onclick = () => confirmDialog("¿Eliminar esta cuenta?", () => {
    setState({ accounts: s.accounts.filter((a) => a.id !== b.getAttribute("data-del")) }); persist(); renderAccounts(root);
  }));
}

function openAcctModal(root, acct) {
  const s = getState();
  const editing = !!acct;
  const typeOpts = ACCOUNT_TYPES.map((t) => `<option ${acct?.type === t ? "selected" : ""}>${t}</option>`).join("");
  openModal(editing ? "Editar cuenta" : "Nueva cuenta", `
    <div class="field"><label class="label">Nombre</label><input id="a-name" class="input" placeholder="Ej: Banco Caja Social" value="${escapeHtml(acct?.name || "")}"></div>
    <div class="field"><label class="label">Tipo</label><select id="a-type" class="input">${typeOpts}</select></div>
    <div class="field"><label class="label">Saldo actual (COP)</label><input id="a-bal" class="input" type="number" value="${acct?.balance ?? ""}" placeholder="0"></div>
    <button id="a-save" class="btn btn-primary btn-block">${editing ? "Guardar cambios" : "Crear cuenta"}</button>`, {
    onMount(b) {
      submitOnce(b.querySelector("#a-save"), async () => {
        const name = b.querySelector("#a-name").value.trim();
        if (!name) return toast("Falta el nombre", true);
        const data = { name, type: b.querySelector("#a-type").value, balance: +b.querySelector("#a-bal").value || 0 };
        if (editing) setState({ accounts: s.accounts.map((a) => a.id === acct.id ? { ...a, ...data } : a) });
        else setState({ accounts: [...s.accounts, { id: uid(), ...data }] });
        persist(); closeModal(); renderAccounts(root); toast(editing ? "Cuenta actualizada" : "Cuenta creada");
      });
    },
  });
}
