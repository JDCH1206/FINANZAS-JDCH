// js/views/summary.js
import { getState, setState } from "../state.js";
import { RULE_503020 } from "../config.js";
import { fmt, ym, monthLabel, sum, curMonth, uid, escapeHtml } from "../utils.js";
import { saveConfig, forcePersistLocal } from "../firebase-service.js";
import { openModal, closeModal, toast, confirmDialog } from "../components/modals.js";

export function renderSummary(root) {
  const s = getState();
  const hasData = s.txs.length || s.incomes.length || (s.accounts || []).length;
  if (!hasData) {
    root.innerHTML = `<div class="empty"><p>Tu resumen aparecerá aquí cuando registres ingresos, gastos o cuentas.</p></div>`;
    return;
  }

  const totalInc = sum(s.incomes, (t) => t.amount);
  const totalExp = sum(s.txs, (t) => t.amount);
  const ahorroFlujo = totalInc - totalExp;
  const tasa = totalInc ? (ahorroFlujo / totalInc) * 100 : 0;
  const disponible = sum(s.accounts || [], (a) => a.balance);
  const gap = ahorroFlujo - disponible;                       // flujo no reflejado en cuentas
  const gapPct = ahorroFlujo ? (gap / ahorroFlujo) * 100 : 0;

  // mes actual
  const cm = curMonth();
  const incMes = sum(s.incomes.filter((t) => ym(t.date) === cm), (t) => t.amount);
  const expMes = sum(s.txs.filter((t) => ym(t.date) === cm), (t) => t.amount);

  // 50/30/20
  const typeMap = Object.fromEntries(s.cats.map((c) => [c.name, c.type]));
  const buck = { Necesidad: 0, Deseo: 0, Deuda: 0 };
  s.txs.forEach((t) => { const ty = typeMap[t.cat]; if (ty) buck[ty] += (+t.amount || 0); });

  // top categorías
  const byCat = {};
  s.txs.forEach((t) => { byCat[t.cat] = (byCat[t.cat] || 0) + (+t.amount || 0); });
  const topCats = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 5);

  // estabilidad ingreso
  const natOfType = { "Salario": "Fijo", "Prima": "Variable", "Liquidación/Cesantías": "Variable", "Subsidio": "Variable", "Rendimientos": "Variable", "Préstamo recibido": "Recuperable", "Otros ingresos": "Variable" };
  const nat = { Fijo: 0, Variable: 0, Recuperable: 0 };
  s.incomes.forEach((i) => { const n = natOfType[i.type] || "Variable"; nat[n] += (+i.amount || 0); });

  // medios de pago
  const byPay = {};
  s.txs.forEach((t) => { if (t.pay) byPay[t.pay] = (byPay[t.pay] || 0) + (+t.amount || 0); });
  const topPay = Object.entries(byPay).sort((a, b) => b[1] - a[1]);

  root.innerHTML = `
    <h2 class="page-title disp">Resumen</h2>
    <p class="page-sub">Panorama consolidado de tus finanzas</p>

    <div class="grid-kpi mb-4">
      ${kpi("Total ingresos", fmt(totalInc))}
      ${kpi("Disponible (cuentas)", fmt(disponible))}
      ${kpi("Balance (ingresos − gastos)", fmt(ahorroFlujo))}
      ${kpi("Tasa de ahorro", (totalInc ? tasa.toFixed(0) : "—") + "%")}
      ${kpi("Patrimonio neto*", fmt(disponible), true)}
      ${kpi("Balance − Patrimonio †", fmt(gap), true)}
      ${kpi("Diferencia † ", (ahorroFlujo ? gapPct.toFixed(0) : "—") + "%", true)}
    </div>

    <div class="grid-cards">
      <div class="card">
        <div class="card-title">Mes actual (${monthLabel(cm)})</div>
        ${lineKV("Ingresos", fmt(incMes), "var(--green)")}
        ${lineKV("Gastos", fmt(expMes), "var(--red)")}
        ${lineKV("Balance", fmt(incMes - expMes), incMes - expMes >= 0 ? "var(--green)" : "var(--red)")}
      </div>

      <div class="card">
        <div class="card-title">Histórico total</div>
        ${lineKV("Ingresos", fmt(totalInc))}
        ${lineKV("Gastos", fmt(totalExp))}
        ${lineKV("Diferencia", fmt(ahorroFlujo), ahorroFlujo >= 0 ? "var(--green)" : "var(--red)")}
      </div>

      <div class="card">
        <div class="card-title">Regla 50/30/20</div>
        ${["Necesidad", "Deseo", "Deuda"].map((bk) => {
          const pct = totalExp ? (buck[bk] / totalExp) * 100 : 0, ref = RULE_503020[bk];
          const lbl = bk === "Necesidad" ? "Necesidades" : bk === "Deseo" ? "Deseos" : "Deuda/Inversión";
          const ok = Math.abs(pct - ref) <= 6, col = ok ? "var(--green)" : pct > ref ? "var(--red)" : "var(--yel)";
          return `<div class="mb-2"><div class="row between small mb-1"><span>${lbl}</span><span class="muted">${pct.toFixed(0)}% / ${ref}%</span></div>
            <div class="bar"><span style="width:${Math.min(pct, 100)}%;background:${col}"></span><i class="ref" style="left:${ref}%"></i></div></div>`;
        }).join("")}
      </div>

      ${(s.accounts || []).length ? `<div class="card"><div class="card-title">Distribución del ahorro</div>
        ${s.accounts.map((a) => lineKV(a.name + ` · ${a.type}`, fmt(a.balance))).join("")}
        ${lineKV("Total", fmt(disponible), "var(--gold)")}</div>` : ""}

      <div class="card">
        <div class="card-title">Top 5 categorías de gasto</div>
        ${topCats.map(([c, v]) => lineKV(c, fmt(v) + ` · ${totalExp ? ((v / totalExp) * 100).toFixed(0) : 0}%`)).join("") || `<div class="muted small">Sin gastos</div>`}
      </div>

      <div class="card col-span">
        <div class="row between mb-2"><div class="card-title" style="margin:0">Metas de ahorro</div><button id="add-goal" class="btn btn-ghost btn-sm">+ Meta</button></div>
        <div id="goals-list"></div>
      </div>

      <div class="card">
        <div class="card-title">Estabilidad del ingreso</div>
        ${["Fijo", "Variable", "Recuperable"].map((n) => nat[n] ? lineKV(n, fmt(nat[n]) + ` · ${totalInc ? ((nat[n] / totalInc) * 100).toFixed(0) : 0}%`) : "").join("") || `<div class="muted small">Sin ingresos</div>`}
      </div>

      ${topPay.length ? `<div class="card col-span"><div class="card-title">Gasto por medio de pago</div>
        ${topPay.map(([p, v]) => `<div class="dane-row"><span class="muted">${p}</span>
          <div class="bar" style="height:7px"><span style="width:${totalExp ? (v / totalExp) * 100 : 0}%;background:var(--blue)"></span></div>
          <span style="text-align:right">${fmt(v)}</span></div>`).join("")}</div>` : ""}
    </div>

    <p class="tiny muted mt-3">*Patrimonio neto = saldo en cuentas. No incluye deudas pendientes (no registradas en esta versión).<br>
    † <b>Balance − Patrimonio</b> = parte de tu flujo neto histórico que no está en las cuentas registradas (gastos en bienes, dinero prestado/regalado o cuentas sin registrar). <b>Diferencia</b> = ese monto como % del balance.</p>`;

  root.querySelector("#add-goal").onclick = () => openGoalModal(root, null);
  drawGoals(root);
}

async function saveGoals(root) {
  const s = getState();
  await saveConfig(s.user.uid, { profile: s.profile, cats: s.cats, budgets: s.budgets, accounts: s.accounts, payMethods: s.payMethods, vehicles: s.vehicles, vehiclesEnabled: s.vehiclesEnabled, goals: s.goals });
  forcePersistLocal(s.user.uid);
}
function drawGoals(root) {
  const goals = getState().goals || [];
  const el = root.querySelector("#goals-list");
  if (!el) return;
  if (!goals.length) { el.innerHTML = `<div class="muted small">Sin metas. Toca "+ Meta" para crear una (ej: Fondo de emergencia, Viaje, Moto nueva).</div>`; return; }
  el.innerHTML = goals.map((g) => {
    const pct = g.objetivo ? Math.min(100, (g.ahorrado / g.objetivo) * 100) : 0, done = pct >= 100;
    return `<div class="mb-3">
      <div class="row between small mb-1"><span>${escapeHtml(g.nombre)}${done ? " ✅" : ""}${g.fecha ? ` <span class="tiny muted">(${g.fecha})</span>` : ""}</span><span class="muted">${fmt(g.ahorrado)} / ${fmt(g.objetivo)} · ${pct.toFixed(0)}%</span></div>
      <div class="bar"><span style="width:${pct}%;background:${done ? "var(--green)" : "var(--gold)"}"></span></div>
      <div class="row gap-2 mt-1"><button class="btn btn-ghost btn-sm" data-eg="${g.id}">Editar</button><button class="btn btn-ghost btn-sm" data-dg="${g.id}">Eliminar</button></div>
    </div>`;
  }).join("");
  el.querySelectorAll("[data-eg]").forEach((b) => b.onclick = () => openGoalModal(root, getState().goals.find((x) => x.id === b.getAttribute("data-eg"))));
  el.querySelectorAll("[data-dg]").forEach((b) => b.onclick = () => confirmDialog("¿Eliminar esta meta?", async () => {
    setState({ goals: getState().goals.filter((x) => x.id !== b.getAttribute("data-dg")) });
    await saveGoals(root); drawGoals(root); toast("Meta eliminada");
  }));
}
function openGoalModal(root, existing) {
  const f = (l, h) => `<div class="field"><label class="label">${l}</label>${h}</div>`;
  openModal(existing ? "Editar meta" : "Nueva meta", `
    ${f("Nombre", `<input id="g-nom" class="input" value="${existing ? escapeHtml(existing.nombre) : ""}" placeholder="Ej: Fondo de emergencia">`)}
    ${f("Objetivo (COP)", `<input id="g-obj" class="input" type="number" value="${existing ? existing.objetivo : ""}" placeholder="0">`)}
    ${f("Ahorrado hasta hoy (COP)", `<input id="g-ah" class="input" type="number" value="${existing ? existing.ahorrado : ""}" placeholder="0">`)}
    ${f("Fecha objetivo (opcional)", `<input id="g-fecha" class="input" type="date" value="${existing ? (existing.fecha || "") : ""}">`)}
    <button id="g-save" class="btn btn-primary btn-block mt-2">${existing ? "Guardar" : "Crear meta"}</button>`, {
    onMount(b) {
      b.querySelector("#g-save").onclick = async () => {
        const g = { id: existing ? existing.id : uid(), nombre: b.querySelector("#g-nom").value.trim(), objetivo: +b.querySelector("#g-obj").value || 0, ahorrado: +b.querySelector("#g-ah").value || 0, fecha: b.querySelector("#g-fecha").value || "" };
        if (!g.nombre || !g.objetivo) return toast("Falta nombre u objetivo", true);
        const list = getState().goals || [];
        setState({ goals: existing ? list.map((x) => (x.id === g.id ? g : x)) : [...list, g] });
        await saveGoals(root); closeModal(); drawGoals(root); toast(existing ? "Meta actualizada" : "Meta creada");
      };
    },
  });
}

function kpi(label, val, sm) {
  return `<div class="kpi"><div class="k-label">${label}</div><div class="k-val ${sm ? "sm" : ""}">${val}</div></div>`;
}
function lineKV(k, v, color) {
  return `<div class="row between" style="padding:6px 0;border-top:1px solid var(--line)"><span class="small muted">${k}</span><span class="small bold" style="color:${color || "var(--ink)"}">${v}</span></div>`;
}
