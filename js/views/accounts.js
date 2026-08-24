// js/views/accounts.js
import { getState, setState } from "../state.js";
import { saveConfig, forcePersistLocal } from "../firebase-service.js";
import { fmt, uid, escapeHtml, debounce, sum, fmtDate, todayISO } from "../utils.js";
import { ACCOUNT_TYPES, PALETTE } from "../config.js";
import { openModal, closeModal, toast, confirmDialog, submitOnce, moneyPreview } from "../components/modals.js";
import { donut, lineTrend } from "../components/charts.js";

let savScope = "all"; // ámbito de la gráfica de evolución: "all" o id de cuenta

const persist = debounce(async () => {
  const s = getState();
  await saveConfig(s.user.uid, { profile: s.profile, cats: s.cats, budgets: s.budgets, accounts: s.accounts, payMethods: s.payMethods });
  forcePersistLocal(s.user.uid);
}, 500);

// cuentas que ganan rendimiento y conviene actualizar cada semana
const YIELD_TYPES = ["Ahorro", "Inversión", "Corriente"];
// días entre dos fechas ISO (b - a)
export function daysBetweenISO(a, b) {
  if (!a || !b) return 999;
  return Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);
}
// ¿esta cuenta necesita que registres su saldo esta semana?
export function acctNeedsUpdate(a, today) {
  if (!YIELD_TYPES.includes(a.type)) return false;
  if (!a.lastSaldoUpdate) return true;
  const d = daysBetweenISO(a.lastSaldoUpdate, today);
  const isFriday = new Date(today + "T00:00:00").getDay() === 5;
  return d >= 7 || (isFriday && d >= 5);
}
// total que ha "crecido tu dinero" en una cuenta (suma de rendimientos registrados)
const rendTotal = (a) => sum((a.movs || []).filter((m) => m.kind === "rendimiento"), (m) => m.amount);

// Reconstruye la evolución del saldo a partir de los movimientos registrados.
// Ancla al saldo actual real y va restando hacia atrás; agrupa por fecha (un punto por día con movimiento).
function savingsSeries(accts, scope) {
  const list = scope === "all" ? accts : accts.filter((a) => a.id === scope);
  const anchor = sum(list, (a) => +a.balance || 0);
  const movs = [];
  list.forEach((a) => (a.movs || []).forEach((m) => movs.push(m)));
  if (movs.length < 2) return null;
  movs.sort((a, b) => (a.date || "").localeCompare(b.date || "") || (a.id > b.id ? 1 : -1));
  const totalMov = sum(movs, (m) => +m.amount || 0);
  let running = anchor - totalMov;           // saldo antes del primer movimiento
  const byDate = new Map();
  movs.forEach((m) => { running += (+m.amount || 0); byDate.set(m.date, running); });
  const dates = [...byDate.keys()];
  if (dates.length < 2) return null;          // necesita al menos 2 fechas distintas
  return {
    labels: dates.map((d) => fmtDate(d)),
    values: dates.map((d) => Math.round(byDate.get(d))),
    rend: sum(movs.filter((m) => m.kind === "rendimiento"), (m) => m.amount),
    aportes: sum(movs.filter((m) => m.kind === "aporte"), (m) => m.amount),
  };
}

export function renderAccounts(root) {
  const s = getState();
  const accts = s.accounts || [];
  const total = sum(accts, (a) => a.balance);
  const today = todayISO();
  const pend = accts.filter((a) => acctNeedsUpdate(a, today));
  const rendGlobal = sum(accts, (a) => rendTotal(a));

  root.innerHTML = `
    <h2 class="page-title disp">Cuentas y ahorro</h2>
    <p class="page-sub">Dónde está tu dinero y cómo se distribuye</p>

    <div class="kpi mb-3" style="background:linear-gradient(135deg,#1d272c,#161e22)">
      <div class="k-label">Total disponible</div>
      <div class="k-val">${fmt(total)}</div>
      ${rendGlobal ? `<div class="tiny" style="color:var(--green);margin-top:4px">↑ ${fmt(rendGlobal)} registrado en rendimientos</div>` : ""}
    </div>

    ${pend.length ? `<div class="card mb-3" style="border:1px solid var(--gold)">
      <div class="card-title">📈 Actualiza el saldo de esta semana</div>
      <p class="tiny muted" style="margin:-4px 0 10px">Registra cuánto crecieron tus cuentas (rendimientos) y cualquier aporte extra. Se sugiere cada viernes.</p>
      ${pend.map((a) => `<div class="row between" style="align-items:center;padding:7px 0;border-top:1px solid var(--line)">
        <div class="flex1" style="min-width:0"><div class="small bold ellipsis">${escapeHtml(a.name)}</div>
          <div class="tiny muted">${a.lastSaldoUpdate ? "hace " + daysBetweenISO(a.lastSaldoUpdate, today) + " días" : "sin registrar aún"}</div></div>
        <button class="btn btn-primary btn-sm" data-upd="${a.id}">Actualizar</button></div>`).join("")}
    </div>` : ""}

    ${accts.length ? `<div class="card mb-3"><div class="card-title">Distribución por cuenta</div>
      <div class="chart-box" style="height:210px"><canvas id="ch-acct"></canvas></div>
      <div id="acct-leg" class="row wrap gap-2 mt-2"></div></div>

      <div class="card mb-3"><div class="card-title">Por tipo de cuenta</div><div id="by-type"></div></div>` : ""}

    ${accts.some((a) => (a.movs || []).length) ? `<div class="card mb-3">
      <div class="row between mb-2" style="align-items:center"><div class="card-title" style="margin:0">Así ha crecido tu dinero</div>
        <select id="sav-scope" class="input" style="width:auto"></select></div>
      <div id="sav-wrap"></div></div>` : ""}

    <div class="card mb-3">
      <div class="row between mb-3"><div class="card-title" style="margin:0">Tus cuentas</div>
        <button id="add-acct" class="btn btn-primary btn-sm">+ Cuenta</button></div>
      <div id="acct-list"></div>
    </div>`;

  root.querySelector("#add-acct").onclick = () => openAcctModal(root);
  root.querySelectorAll("[data-upd]").forEach((b) => b.onclick = () => openUpdateModal(root, b.getAttribute("data-upd")));
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

  drawSavings(root);
}

// gráfica "Así ha crecido tu dinero": evolución del saldo + rendimiento/aportes acumulados
function drawSavings(root) {
  const sel = root.querySelector("#sav-scope");
  if (!sel) return;
  const accts = getState().accounts || [];
  const withMovs = accts.filter((a) => (a.movs || []).length);
  if (savScope !== "all" && !withMovs.some((a) => a.id === savScope)) savScope = "all";
  sel.innerHTML = `<option value="all" ${savScope === "all" ? "selected" : ""}>Todas</option>` +
    withMovs.map((a) => `<option value="${a.id}" ${savScope === a.id ? "selected" : ""}>${escapeHtml(a.name)}</option>`).join("");
  sel.onchange = (e) => { savScope = e.target.value; drawSavings(root); };

  const wrap = root.querySelector("#sav-wrap");
  const ser = savingsSeries(accts, savScope);
  if (!ser) {
    wrap.innerHTML = `<div class="muted small">Registra el saldo unas semanas (con "Actualizar saldo") para ver aquí cómo crece tu dinero.</div>`;
    return;
  }
  wrap.innerHTML = `
    <div class="chart-box" style="height:200px"><canvas id="ch-sav"></canvas></div>
    <div class="row gap-2 mt-2">
      <div class="kpi flex1"><div class="k-label">Rendimientos</div><div class="k-val sm" style="color:var(--green)">↑ ${fmt(ser.rend)}</div></div>
      <div class="kpi flex1"><div class="k-label">Aportes</div><div class="k-val sm">${fmt(ser.aportes)}</div></div>
    </div>`;
  lineTrend("ch-sav", ser.labels, ser.values);
}

function drawList(root) {
  const s = getState();
  const host = root.querySelector("#acct-list");
  const accts = s.accounts || [];
  const today = todayISO();
  if (!accts.length) { host.innerHTML = `<div class="muted small">Aún no tienes cuentas. Agrega tu cuenta de ahorros, efectivo, etc.</div>`; return; }
  host.innerHTML = accts.map((a, i) => {
    const nMovs = (a.movs || []).length;
    const meta = [escapeHtml(a.type)];
    if (a.lastSaldoUpdate) meta.push("act. hace " + daysBetweenISO(a.lastSaldoUpdate, today) + "d");
    if (nMovs) meta.push(nMovs + " movim.");
    return `
    <div class="tx-row">
      <span class="tx-dot" style="background:${PALETTE[i % PALETTE.length]}"></span>
      <div class="flex1"><div class="tx-desc">${escapeHtml(a.name)}</div><div class="tx-meta">${meta.join(" · ")}</div></div>
      <div class="tx-amt">${fmt(a.balance)}</div>
      <button class="icon-btn" data-upd="${a.id}" aria-label="Actualizar saldo" title="Actualizar saldo / rendimiento"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 11-3-6.7L21 8M21 3v5h-5"/></svg></button>
      <button class="icon-btn" data-mov="${a.id}" aria-label="Movimientos de la cuenta" title="Sumar o restar"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg></button>
      <button class="icon-btn" data-edit="${a.id}" aria-label="Editar cuenta"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg></button>
      <button class="icon-btn" data-del="${a.id}" aria-label="Eliminar cuenta"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2m-9 0v14h10V6"/></svg></button>
    </div>`;
  }).join("");
  host.querySelectorAll("[data-upd]").forEach((b) => b.onclick = () => openUpdateModal(root, b.getAttribute("data-upd")));
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

// ===================== ACTUALIZAR SALDO (rendimiento semanal + aporte) =====================
// Escribes el nuevo total que ves en el banco; la app calcula el rendimiento y separa
// cualquier aporte extra. Todo queda como movimientos de la cuenta (no toca gastos/ingresos).
function openUpdateModal(root, acctId) {
  const s = getState();
  const acct = (s.accounts || []).find((a) => a.id === acctId);
  if (!acct) return;
  const anterior = +acct.balance || 0;

  openModal(`Actualizar saldo · ${escapeHtml(acct.name)}`, `
    <div class="row between" style="padding:8px 0;border-bottom:1px solid var(--line)">
      <span class="small muted">Saldo anterior</span><span class="small bold">${fmt(anterior)}</span></div>
    <div class="field mt-3"><label class="label">Nuevo saldo total (lo que ves en el banco)</label>
      <input id="u-new" class="input" type="number" inputmode="numeric" placeholder="0"></div>
    <div class="field"><label class="label">¿Agregaste dinero extra? (aporte, opcional)</label>
      <input id="u-aporte" class="input" type="number" inputmode="numeric" placeholder="0"></div>
    <div class="field"><label class="label">Nota del aporte (opcional)</label>
      <input id="u-nota" class="input" placeholder="Ej: aporte quincena, traslado"></div>
    <div class="field"><label class="label">Fecha</label><input id="u-date" class="input" type="date" value="${todayISO()}"></div>

    <div class="card mb-3" id="u-preview" style="background:var(--panel-2)">
      <div class="row between small"><span class="muted">Aporte extra</span><span id="pv-aporte" class="bold">$0</span></div>
      <div class="row between small mt-1"><span class="muted">Rendimiento (crecimiento)</span><span id="pv-rend" class="bold">$0</span></div>
    </div>
    <button id="u-save" class="btn btn-primary btn-block">Registrar</button>`, {
    onMount(b) {
      const newIn = b.querySelector("#u-new"), apIn = b.querySelector("#u-aporte");
      const pvA = b.querySelector("#pv-aporte"), pvR = b.querySelector("#pv-rend");
      const calc = () => {
        const nuevo = +newIn.value || 0, aporte = Math.max(0, +apIn.value || 0);
        const rend = nuevo - anterior - aporte;
        pvA.textContent = fmt(aporte);
        pvR.textContent = (rend >= 0 ? "+" : "−") + fmt(Math.abs(rend));
        pvR.style.color = rend >= 0 ? "var(--green)" : "var(--red)";
      };
      newIn.addEventListener("input", calc); apIn.addEventListener("input", calc); calc();

      submitOnce(b.querySelector("#u-save"), async () => {
        const nuevo = +newIn.value;
        if (!newIn.value || nuevo < 0) return toast("Escribe el nuevo saldo total", true);
        const aporte = Math.max(0, +apIn.value || 0);
        const date = b.querySelector("#u-date").value || todayISO();
        const nota = b.querySelector("#u-nota").value.trim();
        const rend = nuevo - anterior - aporte;
        const nuevosMovs = [];
        if (rend !== 0) nuevosMovs.push({ id: uid(), date, amount: rend, note: "Rendimiento", kind: "rendimiento" });
        if (aporte > 0) nuevosMovs.push({ id: uid(), date, amount: aporte, note: nota || "Aporte", kind: "aporte" });
        const st = getState();
        setState({ accounts: st.accounts.map((a) => a.id === acctId
          ? { ...a, balance: nuevo, lastSaldoUpdate: date, movs: [...nuevosMovs, ...(a.movs || [])] } : a) });
        persist(); closeModal(); renderAccounts(root);
        toast(`Saldo actualizado · rendimiento ${rend >= 0 ? "+" : "−"}${fmt(Math.abs(rend))}`);
      });
    },
  });
}

// ===================== MOVIMIENTOS MANUALES (sumar / restar con nota) =====================
// Ajustan SOLO el saldo de esta cuenta; NO son gastos ni ingresos (no tocan txs/incomes).
function movLabel(m) {
  if (m.kind === "rendimiento") return "Rendimiento";
  if (m.kind === "aporte") return m.note || "Aporte";
  return m.note || ((+m.amount || 0) >= 0 ? "Suma" : "Resta");
}
function openMovsModal(root, acctId) {
  const s = getState();
  const acct = (s.accounts || []).find((a) => a.id === acctId);
  if (!acct) return;
  const movs = (acct.movs || []).slice().sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.id > a.id ? 1 : -1));
  const rend = rendTotal(acct);

  const listHtml = movs.length
    ? movs.map((m) => {
        const pos = (+m.amount || 0) >= 0;
        const tag = m.kind === "rendimiento" ? " · rend." : m.kind === "aporte" ? " · aporte" : "";
        return `<div class="tx-row">
          <div class="flex1"><div class="tx-desc">${escapeHtml(movLabel(m))}</div><div class="tx-meta">${fmtDate(m.date)}${tag}</div></div>
          <div class="tx-amt" style="color:${pos ? "var(--green)" : "var(--red)"}">${pos ? "+" : "−"}${fmt(Math.abs(m.amount))}</div>
          <button class="icon-btn" data-delmov="${m.id}" aria-label="Eliminar movimiento"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2m-9 0v14h10V6"/></svg></button>
        </div>`;
      }).join("")
    : `<div class="muted small">Sin movimientos aún. Registra una suma o resta arriba, o usa "Actualizar saldo".</div>`;

  openModal(`Movimientos · ${escapeHtml(acct.name)}`, `
    <div class="kpi mb-3" style="background:linear-gradient(135deg,#1d272c,#161e22)">
      <div class="k-label">Saldo actual</div><div class="k-val">${fmt(acct.balance)}</div>
      ${rend ? `<div class="tiny" style="color:var(--green);margin-top:4px">↑ ${fmt(rend)} en rendimientos</div>` : ""}
    </div>
    <button id="m-updbtn" class="btn btn-primary btn-block mb-3">📈 Actualizar saldo (rendimiento / aporte)</button>
    <p class="tiny muted mb-3">O registra un ajuste manual. Nada de esto afecta tus gastos ni ingresos.</p>

    <div class="field"><label class="label">Tipo</label>
      <div class="row gap-2"><button type="button" class="chip on flex1" data-tipo="suma">Sumar (+)</button>
        <button type="button" class="chip flex1" data-tipo="resta">Restar (−)</button></div></div>
    <div class="field"><label class="label">Monto (COP)</label><input id="m-amt" class="input" type="number" inputmode="numeric" placeholder="0"></div>
    <div class="field"><label class="label">Descripción (breve)</label><input id="m-note" class="input" placeholder="Ej: ajuste de saldo, traslado"></div>
    <div class="field"><label class="label">Fecha</label><input id="m-date" class="input" type="date" value="${todayISO()}"></div>
    <button id="m-save" class="btn btn-ghost btn-block mb-3">Registrar movimiento manual</button>

    <div class="card-title" style="margin:0 0 8px">Historial</div>
    <div id="m-list">${listHtml}</div>`, {
    onMount(b) {
      let tipo = "suma";
      moneyPreview(b.querySelector("#m-amt"));
      b.querySelector("#m-updbtn").onclick = () => { closeModal(); openUpdateModal(root, acctId); };
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
        const mov = { id: uid(), date, amount: signed, note, kind: tipo };
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
