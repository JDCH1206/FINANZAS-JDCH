// js/views/budget.js
import { getState, setState } from "../state.js";
import { saveConfig, forcePersistLocal } from "../firebase-service.js";
import { fmt, ym, curMonth, monthLabel, debounce, sum, escapeHtml } from "../utils.js";
import { budgetBars } from "../components/charts.js";
import { toast, confirmDialog } from "../components/modals.js";
import { RULE_503020 } from "../config.js";

let mes = null, mode = "valor";
const expanded = new Set(); // categorías con subcategorías desplegadas
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
  const realMap = {}, realSub = {};
  s.txs.filter((t) => ym(t.date) === mes).forEach((t) => {
    realMap[t.cat] = (realMap[t.cat] || 0) + (+t.amount || 0);
    const sk = t.cat + "›" + (t.sub || "");
    realSub[sk] = (realSub[sk] || 0) + (+t.amount || 0);
  });
  const applied = (c) => mode === "pct" ? ((+b[c.name + "__pct"] || 0) / 100) * (s.profile.income || 0) : (+b[c.name] || 0);
  const totBud = sum(s.cats, applied);
  const totReal = sum(Object.values(realMap));
  const over = s.cats.map((c) => ({ name: c.name, ap: applied(c), rl: realMap[c.name] || 0 })).filter((o) => o.ap > 0 && o.rl > o.ap);

  root.innerHTML = `
    <h2 class="page-title disp">Presupuesto</h2>
    <p class="page-sub">Define el presupuesto de cada mes. Se guarda automáticamente.</p>

    ${over.length ? `<div class="card mb-3" style="border:1px solid var(--red)">
      <div class="card-title" style="color:var(--red)">⚠ Te pasaste del presupuesto (${monthLabel(mes)})</div>
      ${over.map((o) => `<div class="row between small" style="padding:4px 0"><span>${escapeHtml(o.name)}</span><span style="color:var(--red)">${fmt(o.rl)} / ${fmt(o.ap)} · ${((o.rl / o.ap) * 100).toFixed(0)}%</span></div>`).join("")}
    </div>` : ""}

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
      <button id="b-auto" class="btn btn-ghost btn-sm mt-3">⚡ Calcular automático (según tu historial)</button>
      <p class="tiny muted mt-2">Reparte tu ingreso mensual (${fmt(s.profile.income || 0)}) con la regla 50/30/20, pesando cada categoría según <b>lo que realmente gastas</b> (últimos 12 meses): las que casi no mueves reciben poco o nada. Luego ajusta lo que quieras.</p>
    </div>

    <div class="card mb-3">
      <div class="row between mb-3">
        <div class="card-title" style="margin:0">${monthLabel(mes)}</div>
        <div class="small muted">Presup. <b style="color:var(--ink)">${fmt(totBud)}</b> · Real <b style="color:${totReal > totBud ? "var(--red)" : "var(--green)"}">${fmt(totReal)}</b></div>
      </div>
      <div id="b-rows"></div>
      <div style="padding:9px 4px 2px;border-top:2px solid var(--line)">
        <div class="row between" style="font-weight:700"><span>TOTAL</span>
          <span class="badge" style="background:${totBud ? ((totReal / totBud) * 100 <= 100 ? "var(--green)" : (totReal / totBud) * 100 <= 110 ? "var(--yel)" : "var(--red)") : "var(--sub)"};color:#10171a">${totBud ? ((totReal / totBud) * 100).toFixed(0) + "%" : "—"}</span></div>
        <div class="row between tiny" style="margin-top:2px"><span class="muted">Presup ${fmt(totBud)} · Real ${fmt(totReal)}</span><span style="color:${totBud - totReal >= 0 ? "var(--green)" : "var(--red)"}">Dif ${fmt(totBud - totReal)}</span></div>
      </div>
      <div class="tiny muted mt-3" style="line-height:1.9">Semáforo % ejecución: <span style="color:var(--green)">■ ≤100% ok</span> · <span style="color:var(--yel)">■ 100–110% leve</span> · <span style="color:var(--red)">■ >110% alto</span><br>💾 Guardado al instante. El % compara real vs. presupuesto.</div>
    </div>

    <div class="card"><div class="card-title">Historial: presupuesto vs. real</div><div class="chart-box"><canvas id="ch-bud"></canvas></div></div>`;

  root.querySelector("#b-mes").onchange = (e) => { mes = e.target.value; renderBudget(root); };
  root.querySelector("#b-mode").onchange = (e) => { mode = e.target.value; renderBudget(root); };
  root.querySelector("#b-auto").onclick = () => {
    const income = s.profile.income || 0;
    if (!income) return toast("Define tu ingreso mensual en Resumen/Ajustes primero", true);
    confirmDialog(`¿Calcular el presupuesto de ${monthLabel(mes)} con tu ingreso (${fmt(income)}) y tu historial? Reemplaza los valores de este mes; luego puedes ajustarlos.`, () => {
      // gasto promedio mensual por categoría (últimos 12 meses) → categorías que casi no usas pesan poco
      const meses = [...new Set(s.txs.map((t) => ym(t.date)).filter(Boolean))].sort().slice(-12);
      const set12 = new Set(meses), nM = meses.length || 1;
      const catAvg = {}; s.cats.forEach((c) => (catAvg[c.name] = 0));
      s.txs.forEach((t) => { if (set12.has(ym(t.date)) && catAvg[t.cat] != null) catAvg[t.cat] += (+t.amount || 0); });
      Object.keys(catAvg).forEach((k) => (catAvg[k] = catAvg[k] / nM));

      const nb = {};
      ["Necesidad", "Deseo", "Deuda"].forEach((type) => {
        const cot = s.cats.filter((c) => c.type === type);
        let weights = cot.map((c) => catAvg[c.name] || 0);            // peso = histórico real
        if (weights.reduce((a, b) => a + b, 0) <= 0) weights = cot.map((c) => c.dane || 5); // sin historial → DANE
        const totalW = weights.reduce((a, b) => a + b, 0) || 1;
        const bucket = income * ((RULE_503020[type] || 0) / 100);
        cot.forEach((c, i) => { nb[c.name] = Math.round(bucket * (weights[i] / totalW) / 1000) * 1000; });
      });
      // conserva los topes por subcategoría que el usuario ya tenía este mes
      const prev = getState().budgets[mes] || {};
      Object.keys(prev).forEach((k) => { if (k.includes("›")) nb[k] = prev[k]; });
      mode = "valor";
      setState({ budgets: { ...getState().budgets, [mes]: nb } });
      saveBudgets(); renderBudget(root); toast("Presupuesto calculado según tu historial · ajústalo");
    }, { yesLabel: "Calcular", danger: false });
  };
  if (mode === "pct") root.querySelector("#b-inc").onchange = (e) => { setState({ profile: { ...s.profile, income: +e.target.value } }); saveBudgets(); renderBudget(root); };

  // rows
  const income = s.profile.income || 0;
  const cellInput = (key) => mode === "pct"
    ? `<div class="bud-pct"><input data-pct="${escapeHtml(key)}" class="input" style="padding:7px 22px 7px 10px;font-size:13px" type="number" value="${b[key + "__pct"] || ""}" placeholder="0"><span class="pct-sign">%</span></div>`
    : `<input data-val="${escapeHtml(key)}" class="input" style="padding:7px 10px;font-size:13px" type="number" value="${b[key] || ""}" placeholder="0">`;
  root.querySelector("#b-rows").innerHTML = s.cats.map((c) => {
    const ap = applied(c), rl = realMap[c.name] || 0, ej = ap ? rl / ap : 0, dif = ap - rl;
    const col = ej > 1.1 ? "var(--red)" : ej > 1 ? "var(--yel)" : ej > 0 ? "var(--green)" : "var(--sub)";
    const hasSubs = (c.subs || []).length > 0, open = expanded.has(c.name);
    const caret = hasSubs
      ? `<button data-exp="${escapeHtml(c.name)}" title="Ver subcategorías" style="background:none;border:none;color:var(--gold);cursor:pointer;padding:0 5px 0 0;font-size:12px">${open ? "▾" : "▸"}</button>`
      : `<span style="display:inline-block;width:14px"></span>`;
    let html = `<div class="bud-row"><span class="name">${caret}${escapeHtml(c.name)}</span>${cellInput(c.name)}<span class="ej" style="color:${col}">${ap ? (ej * 100).toFixed(0) + "%" : "—"}</span></div>`;
    if (ap || rl) html += `<div class="row between tiny" style="padding:0 4px 6px 20px"><span class="muted">Real ${fmt(rl)}</span><span style="color:${dif >= 0 ? "var(--green)" : "var(--red)"}">Dif ${fmt(dif)}</span></div>`;
    if (open && hasSubs) {
      html += c.subs.map((sub) => {
        const sk = c.name + "›" + sub;
        const sap = mode === "pct" ? ((+b[sk + "__pct"] || 0) / 100) * income : (+b[sk] || 0);
        const srl = realSub[sk] || 0, sej = sap ? srl / sap : 0;
        const scol = sej > 1.1 ? "var(--red)" : sej > 1 ? "var(--yel)" : sej > 0 ? "var(--green)" : "var(--sub)";
        const right = sap ? (sej * 100).toFixed(0) + "%" : (srl ? fmt(srl) : "—");
        return `<div class="bud-row" style="padding-left:20px"><span class="name" style="font-size:13px;opacity:.85">${escapeHtml(sub)}</span>${cellInput(sk)}<span class="ej" style="color:${scol};font-size:12px">${right}</span></div>`;
      }).join("");
    }
    return html;
  }).join("");

  const upd = (key, val) => {
    const nb = { ...(s.budgets[mes] || {}), [key]: val };
    setState({ budgets: { ...s.budgets, [mes]: nb } });
    saveBudgets();
  };
  root.querySelectorAll("[data-val]").forEach((inp) => inp.onchange = (e) => { upd(e.target.getAttribute("data-val"), +e.target.value); renderBudget(root); });
  root.querySelectorAll("[data-pct]").forEach((inp) => inp.onchange = (e) => { upd(e.target.getAttribute("data-pct") + "__pct", +e.target.value); renderBudget(root); });
  root.querySelectorAll("[data-exp]").forEach((btn) => btn.onclick = () => { const n = btn.getAttribute("data-exp"); expanded.has(n) ? expanded.delete(n) : expanded.add(n); renderBudget(root); });

  // historial chart
  const hist = allMonths.map((k) => {
    const bb = s.budgets[k] || {};
    const bud = sum(s.cats, (c) => +bb[c.name] || 0);
    const rl = sum(s.txs.filter((t) => ym(t.date) === k), (t) => t.amount);
    return { k, bud, rl };
  }).filter((x) => x.bud > 0 || x.rl > 0).reverse();
  if (hist.length) budgetBars("ch-bud", hist.map((x) => monthLabel(x.k)), hist.map((x) => Math.round(x.bud)), hist.map((x) => Math.round(x.rl)));
}
