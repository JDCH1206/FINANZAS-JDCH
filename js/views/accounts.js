// js/views/accounts.js
import { getState, setState } from "../state.js";
import { saveConfig, forcePersistLocal } from "../firebase-service.js";
import { fmt, uid, escapeHtml, debounce, sum, fmtDate, todayISO } from "../utils.js";
import { ACCOUNT_TYPES, PALETTE } from "../config.js";
import { openModal, closeModal, toast, confirmDialog, submitOnce, moneyPreview } from "../components/modals.js";
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
  host.innerHTML = accts.map((a, i) => {
    const nMovs = (a.movs || []).length;
    return `
    <div class="tx-row">
      <span class="tx-dot" style="background:${PALETTE[i % PALETTE.length]}"></span>
      <div class="flex1"><div class="tx-desc">${escapeHtml(a.name)}</div><div class="tx-meta">${escapeHtml(a.type)}${nMovs ? ` · ${nMovs} movim.` : ""}</div></div>
      <div class="tx-amt">${fmt(a.balance)}</div>
      <button class="icon-btn" data-mov="${a.id}" aria-label="Movimientos de la cuenta" title="Sumar o restar"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg></button>
      <button class="icon-btn" data-edit="${a.id}" aria-label="Editar cuenta"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg></button>
      <button class="icon-btn" data-del="${a.id}" aria-label="Eliminar cuenta"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2m-9 0v14h10V6"/></svg></button>
    </div>`;
  }).join("");
  host.querySelectorAll("[data-mov]").forEach((b) => b.onclick = () => openMovsModal(root, b.getAttribute("data-mov")));
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
      moneyPreview(b.querySelector("#a-bal"));
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

// Movimientos propios de la cuenta: sumas/restas manuales con una breve nota.
// Ajustan SOLO el saldo de esta cuenta; NO son gastos ni ingresos (no tocan txs/incomes).
function openMovsModal(root, acctId) {
  const s = getState();
  const acct = (s.accounts || []).find((a) => a.id === acctId);
  if (!acct) return;
  const movs = (acct.movs || []).slice().sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.id > a.id ? 1 : -1));

  const listHtml = movs.length
    ? movs.map((m) => {
        const pos = (+m.amount || 0) >= 0;
        return `<div class="tx-row">
          <div class="flex1"><div class="tx-desc">${escapeHtml(m.note || (pos ? "Suma" : "Resta"))}</div><div class="tx-meta">${fmtDate(m.date)}</div></div>
          <div class="tx-amt" style="color:${pos ? "var(--green)" : "var(--red)"}">${pos ? "+" : "−"}${fmt(Math.abs(m.amount))}</div>
          <button class="icon-btn" data-delmov="${m.id}" aria-label="Eliminar movimiento"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2m-9 0v14h10V6"/></svg></button>
        </div>`;
      }).join("")
    : `<div class="muted small">Sin movimientos aún. Registra una suma o resta arriba.</div>`;

  openModal(`Movimientos · ${escapeHtml(acct.name)}`, `
    <div class="kpi mb-3" style="background:linear-gradient(135deg,#1d272c,#161e22)">
      <div class="k-label">Saldo actual</div><div class="k-val">${fmt(acct.balance)}</div>
    </div>
    <p class="tiny muted mb-3">Estos movimientos ajustan solo el saldo de esta cuenta. No afectan tus gastos ni ingresos.</p>

    <div class="field"><label class="label">Tipo</label>
      <div class="row gap-2"><button type="button" class="chip on flex1" data-tipo="suma">Sumar (+)</button>
        <button type="button" class="chip flex1" data-tipo="resta">Restar (−)</button></div></div>
    <div class="field"><label class="label">Monto (COP)</label><input id="m-amt" class="input" type="number" inputmode="numeric" placeholder="0"></div>
    <div class="field"><label class="label">Descripción (breve)</label><input id="m-note" class="input" placeholder="Ej: ajuste de saldo, traslado, intereses"></div>
    <div class="field"><label class="label">Fecha</label><input id="m-date" class="input" type="date" value="${todayISO()}"></div>
    <button id="m-save" class="btn btn-primary btn-block mb-3">Registrar movimiento</button>

    <div class="card-title" style="margin:0 0 8px">Historial</div>
    <div id="m-list">${listHtml}</div>`, {
    onMount(b) {
      let tipo = "suma";
      moneyPreview(b.querySelector("#m-amt"));
      b.querySelectorAll("[data-tipo]").forEach((c) => c.onclick = () => {
        tipo = c.getAttribute("data-tipo");
        b.querySelectorAll("[data-tipo]").forEach((x) => x.classList.toggle("on", x === c));
      });

      submitOnce(b.querySelector("#m-save"), async () => {
        const amt = Math.abs(+b.querySelector("#m-amt").value || 0);
        if (!amt) return toast("Ingresa un monto", true);
        const note = b.querySelector("#m-note").value.trim();
        const date = b.querySelector("#m-date").value || todayISO();
        const signed = tipo === "resta" ? -amt : amt;
        const mov = { id: uid(), date, amount: signed, note };
        const st = getState();
        setState({ accounts: st.accounts.map((a) => a.id === acctId
          ? { ...a, balance: (+a.balance || 0) + signed, movs: [mov, ...(a.movs || [])] } : a) });
        persist(); renderAccounts(root);
        toast(tipo === "resta" ? "Resta registrada" : "Suma registrada");
        openMovsModal(root, acctId); // refresca saldo e historial
      }, "Registrando…");

      b.querySelectorAll("[data-delmov]").forEach((btn) => btn.onclick = () => {
        const st = getState();
        const a = st.accounts.find((x) => x.id === acctId);
        const m = (a?.movs || []).find((x) => x.id === btn.getAttribute("data-delmov"));
        if (!m) return;
        setState({ accounts: st.accounts.map((x) => x.id === acctId
          ? { ...x, balance: (+x.balance || 0) - (+m.amount || 0), movs: (x.movs || []).filter((y) => y.id !== m.id) } : x) });
        persist(); renderAccounts(root);
        toast("Movimiento eliminado"); openMovsModal(root, acctId);
      });
    },
  });
}
