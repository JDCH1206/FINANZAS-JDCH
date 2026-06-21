// js/views/budget.js
import { getState, setState } from "../state.js";
import { saveConfig, forcePersistLocal } from "../firebase-service.js";
import { fmt, ym, curMonth, monthLabel, debounce, sum } from "../utils.js";
import { budgetBars } from "../components/charts.js";

let mes = null, mode = "valor";
const saveBudgets = debounce(async () => {
  const s = getState();
  await saveConfig(s.user.uid, { profile: s.profile, cats: s.cats, budgets: s.budgets });
  forcePersistLocal(s.user.uid);
}, 700);

export function renderBudget(root) {
  const s = getState();
  const monthsData = [...new Set(s.txs.map((t) => ym(t.date)).filter(Boolean))];
  const allMonths = [...new Set([...monthsData, curMonth(), mes].filter(Boolean))].sort().reverse();
  if (!mes) mes = allMonths[0] || curMonth();

  const b = s.budgets[mes] || {};
  const realMap = {};
  s.txs.filter((t) => ym(t.date) === mes).forEach((t) => { realMap[t.cat] = (realMap[t.cat] || 0) + (+t.amount || 0); });
  const applied = (c) => mode === "pct" ? ((+b[c.name + "__pct"] || 0) / 100) * (s.profile.income || 0) : (+b[c.name] || 0);
  const totBud = sum(s.cats, applied);
  const totReal = sum(Object.values(realMap));

  root.innerHTML = `
    <h2 class="page-title disp">Presupuesto</h2>
    <p class="page-sub">Define el presupuesto de cada mes. Se guarda automáticamente.</p>

    <div class="card mb-3">
      <div class="row gap-2 wrap">
        <div><label class="label">Mes</label>
          <select id="b-mes" class="input" style="width:auto">${allMonths.map((m) => `<option value="${m}" ${m === mes ? "selected" : ""}>${monthLabel(m)}</option>`).join("")}</select></div>
        <div><label class="label">Modo</label>
          <select id="b-mode" class="input" style="width:auto">
            <option value="valor" ${mode === "valor" ? "selected" : ""}>Por valor</option>
            <option value="pct" ${mode === "pct" ? "selected" : ""}>Por % del ingreso</option>
          </select></div>
        ${mode === "pct" ? `<div><label class="label">Ingreso/mes</label><input id="b-inc" class="input" type="number" value="${s.profile.income}" style="width:140px"></div>` : ""}
      </div>
    </div>

    <div class="card mb-3">
      <div class="row between mb-3">
        <div class="card-title" style="margin:0">${monthLabel(mes)}</div>
        <div class="small muted">Presup. <b style="color:var(--ink)">${fmt(totBud)}</b> · Real <b style="color:${totReal > totBud ? "var(--red)" : "var(--green)"}">${fmt(totReal)}</b></div>
      </div>
      <div id="b-rows"></div>
      <p class="tiny muted mt-3">💾 Guardado al instante. El % compara real vs. presupuesto.</p>
    </div>

    <div class="card"><div class="card-title">Historial: presupuesto vs. real</div><div class="chart-box"><canvas id="ch-bud"></canvas></div></div>`;

  root.querySelector("#b-mes").onchange = (e) => { mes = e.target.value; renderBudget(root); };
  root.querySelector("#b-mode").onchange = (e) => { mode = e.target.value; renderBudget(root); };
  if (mode === "pct") root.querySelector("#b-inc").onchange = (e) => { setState({ profile: { ...s.profile, income: +e.target.value } }); saveBudgets(); renderBudget(root); };

  // rows
  root.querySelector("#b-rows").innerHTML = s.cats.map((c) => {
    const ap = applied(c), rl = realMap[c.name] || 0, ej = ap ? rl / ap : 0;
    const col = ej > 1.1 ? "var(--red)" : ej > 1 ? "var(--yel)" : ej > 0 ? "var(--green)" : "var(--sub)";
    const inputHtml = mode === "pct"
      ? `<div class="bud-pct"><input data-pct="${c.name}" class="input" style="padding:7px 22px 7px 10px;font-size:13px" type="number" value="${b[c.name + "__pct"] || ""}" placeholder="0"><span class="pct-sign">%</span></div>`
      : `<input data-val="${c.name}" class="input" style="padding:7px 10px;font-size:13px" type="number" value="${b[c.name] || ""}" placeholder="0">`;
    return `<div class="bud-row"><span class="name">${c.name}</span>${inputHtml}<span class="ej" style="color:${col}">${ap ? (ej * 100).toFixed(0) + "%" : "—"}</span></div>`;
  }).join("");

  const upd = (key, val) => {
    const nb = { ...(s.budgets[mes] || {}), [key]: val };
    setState({ budgets: { ...s.budgets, [mes]: nb } });
    saveBudgets();
    // recalcular totales sin redibujar todo (evita perder foco): actualizar al salir
  };
  root.querySelectorAll("[data-val]").forEach((inp) => inp.onchange = (e) => { upd(e.target.getAttribute("data-val"), +e.target.value); renderBudget(root); });
  root.querySelectorAll("[data-pct]").forEach((inp) => inp.onchange = (e) => { upd(e.target.getAttribute("data-pct") + "__pct", +e.target.value); renderBudget(root); });

  // historial chart
  const hist = allMonths.map((k) => {
    const bb = s.budgets[k] || {};
    const bud = sum(s.cats, (c) => +bb[c.name] || 0);
    const rl = sum(s.txs.filter((t) => ym(t.date) === k), (t) => t.amount);
    return { k, bud, rl };
  }).filter((x) => x.bud > 0 || x.rl > 0).reverse();
  if (hist.length) budgetBars("ch-bud", hist.map((x) => monthLabel(x.k)), hist.map((x) => Math.round(x.bud)), hist.map((x) => Math.round(x.rl)));
}
