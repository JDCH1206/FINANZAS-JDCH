// js/views/dashboard.js
import { getState } from "../state.js";
import { RULE_503020, PALETTE } from "../config.js";
import { fmt, ym, monthLabel, sum, curMonth, todayISO } from "../utils.js";
import { donut, lineTrend, lineTrendPct, categoryBars, groupedBars } from "../components/charts.js";

// desplaza una clave "YYYY-MM" en delta meses
function ymAdd(key, delta) {
  if (!key) return "";
  const [y, m] = key.split("-").map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}
// insignia de variación (para gasto: subir = rojo, bajar = verde)
function deltaBadge(cur, prev) {
  if (!prev) return `<span class="tiny muted">sin base previa</span>`;
  const d = ((cur - prev) / prev) * 100, up = d >= 0;
  return `<span class="tiny" style="color:${up ? "var(--red)" : "var(--green)"}">${up ? "▲" : "▼"} ${Math.abs(d).toFixed(0)}% <span class="muted">vs ${fmt(prev)}</span></span>`;
}

let period = "all";

export function renderDashboard(root) {
  const s = getState();
  if (!s.txs.length && !s.incomes.length) {
    root.innerHTML = `<div class="empty"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" style="opacity:.4"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18"/></svg><p>Aún no hay datos. Importa tu Excel en Ajustes o agrega movimientos.</p></div>`;
    return;
  }
  const months = [...new Set(s.txs.map((t) => ym(t.date)).filter(Boolean))].sort().reverse();

  root.innerHTML = `
    <h2 class="page-title disp">Tablero</h2>
    <p class="page-sub">Comportamiento del gasto y comparación con referentes</p>
    <div class="row gap-2 wrap mb-4" id="chips">
      <button class="chip ${period === "all" ? "on" : ""}" data-p="all">Todo</button>
      ${months.slice(0, 6).map((m) => `<button class="chip ${period === m ? "on" : ""}" data-p="${m}">${monthLabel(m)}</button>`).join("")}
    </div>
    <div class="grid-kpi mb-4" id="kpis"></div>
    <div class="grid-cards">
      <div class="card col-span"><div class="card-title">Comparativo de gasto</div>
        <div class="grid-kpi mb-3" id="cmp"></div>
        <div class="chart-box"><canvas id="ch-yoy"></canvas></div>
        <p class="tiny muted mt-2" id="yoy-cap"></p>
      </div>
      <div class="card"><div class="card-title">Distribución por categoría</div><div class="chart-box"><canvas id="ch-donut"></canvas></div><div id="leg" class="row wrap gap-2 mt-2"></div></div>
      <div class="card"><div class="card-title">Regla 50/30/20</div><div id="rule"></div><p class="tiny muted mt-2">La línea marca el objetivo. Verde = en rango (±6%).</p></div>
      <div class="card col-span"><div class="card-title">Tendencia mensual (últimos 12)</div><div class="chart-box"><canvas id="ch-trend"></canvas></div></div>
      <div class="card col-span"><div class="card-title">Evolución de la tasa de ahorro (12 meses)</div><div class="chart-box"><canvas id="ch-saverate"></canvas></div><p class="tiny muted mt-2">% del ingreso que te queda cada mes: (ingresos − gastos) ÷ ingresos.</p></div>
      <div class="card col-span"><div class="card-title">Categorías: mes actual vs promedio 12m</div><div class="chart-box"><canvas id="ch-catcmp"></canvas></div><p class="tiny muted mt-2" id="catcmp-cap"></p></div>
      <div class="card col-span"><div class="card-title">Tu % vs. canasta DANE</div><div id="dane"></div></div>
    </div>`;

  root.querySelectorAll("[data-p]").forEach((b) => b.onclick = () => { period = b.getAttribute("data-p"); renderDashboard(root); });

  const filtered = period === "all" ? s.txs : s.txs.filter((t) => ym(t.date) === period);
  const total = sum(filtered, (t) => t.amount);

  // KPIs
  const trendMap = {};
  s.txs.forEach((t) => { const k = ym(t.date); if (k) trendMap[k] = (trendMap[k] || 0) + (+t.amount || 0); });
  const trendKeys = Object.keys(trendMap).sort().slice(-12);
  const avg = trendKeys.length ? sum(trendKeys.map((k) => trendMap[k])) / trendKeys.length : 0;

  const byCatMap = {};
  filtered.forEach((t) => { byCatMap[t.cat] = (byCatMap[t.cat] || 0) + (+t.amount || 0); });
  const byCat = s.cats.map((c) => ({ name: c.name, value: byCatMap[c.name] || 0, dane: c.dane }))
    .filter((x) => x.value > 0).sort((a, b) => b.value - a.value);

  // ingresos del periodo y tasa de ahorro
  const incFiltered = period === "all" ? s.incomes : s.incomes.filter((t) => ym(t.date) === period);
  const totalInc = sum(incFiltered, (t) => t.amount);
  const ahorro = totalInc - total;
  const tasa = totalInc ? (ahorro / totalInc) * 100 : 0;
  const disponible = sum(s.accounts || [], (a) => a.balance); // ahorro real = plata en cuentas

  // gasto diario promedio (sobre el lapso de fechas del periodo) y gasto hormiga
  const fdates = filtered.map((t) => t.date).filter(Boolean).sort();
  const daysSpan = fdates.length ? Math.max(1, Math.round((new Date(fdates[fdates.length - 1]) - new Date(fdates[0])) / 86400000) + 1) : 1;
  const avgDaily = total / daysSpan;
  const hormiga = sum(filtered.filter((t) => (+t.amount || 0) < 20000), (t) => t.amount);

  root.querySelector("#kpis").innerHTML = `
    ${kpi("Ingresos", fmt(totalInc))}
    ${kpi("Gastos", fmt(total))}
    ${kpi("Ahorro (cuentas)", fmt(disponible))}
    ${kpi("Tasa de ahorro", (totalInc ? tasa.toFixed(0) : "—") + "%")}
    ${kpi("Gasto diario prom.", fmt(avgDaily))}
    ${kpi("Gasto hormiga (<$20k)", fmt(hormiga))}
    ${kpi("Movimientos", filtered.length)}
    ${kpi("Categoría top", byCat[0]?.name || "—", true)}`;

  // Donut
  donut("ch-donut", byCat.map((x) => x.name), byCat.map((x) => x.value));
  root.querySelector("#leg").innerHTML = byCat.slice(0, 6).map((e, i) =>
    `<span class="tiny muted row gap-1"><span style="width:9px;height:9px;border-radius:3px;background:${PALETTE[i % PALETTE.length]}"></span>${e.name} ${((e.value / total) * 100).toFixed(0)}%</span>`).join("");

  // 50/30/20
  const typeMap = Object.fromEntries(s.cats.map((c) => [c.name, c.type]));
  const buck = { Necesidad: 0, Deseo: 0, Deuda: 0 };
  filtered.forEach((t) => { const ty = typeMap[t.cat]; if (ty) buck[ty] += (+t.amount || 0); });
  root.querySelector("#rule").innerHTML = ["Necesidad", "Deseo", "Deuda"].map((bk) => {
    const pct = total ? (buck[bk] / total) * 100 : 0, ref = RULE_503020[bk], ok = Math.abs(pct - ref) <= 6;
    const lbl = bk === "Necesidad" ? "Necesidades" : bk === "Deseo" ? "Deseos" : "Deuda/Inversión";
    const col = ok ? "var(--green)" : pct > ref ? "var(--red)" : "var(--yel)";
    return `<div class="mb-3">
      <div class="row between small mb-2"><span>${lbl}</span><span class="muted">${pct.toFixed(0)}% / ref ${ref}%</span></div>
      <div class="bar"><span style="width:${Math.min(pct, 100)}%;background:${col}"></span><i class="ref" style="left:${ref}%"></i></div>
    </div>`;
  }).join("");

  // Trend
  lineTrend("ch-trend", trendKeys.map((k) => monthLabel(k)), trendKeys.map((k) => Math.round(trendMap[k])));

  // ---- Comparativo de gasto (anclado al mes/calendario actual) ----
  const sumMonth = (k) => sum(s.txs.filter((t) => ym(t.date) === k), (t) => t.amount);
  const refMonth = curMonth();
  const curM = sumMonth(refMonth), prevM = sumMonth(ymAdd(refMonth, -1)), yoyM = sumMonth(ymAdd(refMonth, -12));
  const Y = +refMonth.slice(0, 4);
  const mmdd = todayISO().slice(5); // MM-DD (hasta la misma fecha)
  const ytd = (year) => sum(s.txs.filter((t) => { const d = t.date || ""; return d.slice(0, 4) === String(year) && d.slice(5) <= mmdd; }), (t) => t.amount);
  const ytdCur = ytd(Y), ytdPrev = ytd(Y - 1);
  const cmpKpi = (label, val, badge) => `<div class="kpi"><div class="k-label">${label}</div><div class="k-val sm">${fmt(val)}</div><div class="mt-1">${badge}</div></div>`;
  const cmpEl = root.querySelector("#cmp");
  if (cmpEl) cmpEl.innerHTML =
    cmpKpi(`Este mes (${monthLabel(refMonth)})`, curM, deltaBadge(curM, prevM)) +
    cmpKpi(`Mismo mes ${Y - 1}`, yoyM, deltaBadge(curM, yoyM)) +
    cmpKpi(`Año ${Y} a la fecha`, ytdCur, deltaBadge(ytdCur, ytdPrev));

  // Gráfico año vs año (gasto mensual)
  const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  const monthlyOf = (year) => {
    const arr = Array(12).fill(0);
    s.txs.forEach((t) => { const d = t.date || ""; if (d.slice(0, 4) === String(year)) { const mi = +d.slice(5, 7) - 1; if (mi >= 0 && mi < 12) arr[mi] += (+t.amount || 0); } });
    return arr;
  };
  groupedBars("ch-yoy", MESES, monthlyOf(Y), monthlyOf(Y - 1), String(Y), String(Y - 1));
  const cap = root.querySelector("#yoy-cap");
  if (cap) cap.textContent = `Gasto mensual ${Y} vs ${Y - 1}. "Año a la fecha" compara del 1-ene a hoy en cada año.`;

  // ---- Evolución de la tasa de ahorro (12 meses) ----
  const incMap = {};
  s.incomes.forEach((t) => { const k = ym(t.date); if (k) incMap[k] = (incMap[k] || 0) + (+t.amount || 0); });
  const rateMonths = [...new Set([...Object.keys(trendMap), ...Object.keys(incMap)])].sort().slice(-12);
  const rateData = rateMonths.map((k) => { const inc = incMap[k] || 0; return inc ? Math.round(((inc - (trendMap[k] || 0)) / inc) * 100) : 0; });
  lineTrendPct("ch-saverate", rateMonths.map((k) => monthLabel(k)), rateData);

  // ---- Categorías: mes actual vs promedio mensual de 12m ----
  const last12 = []; let mk = refMonth;
  for (let i = 0; i < 12; i++) { last12.unshift(mk); mk = ymAdd(mk, -1); }
  const set12 = new Set(last12);
  const curCatMap = {}, sumCatMap = {};
  s.txs.forEach((t) => {
    const k = ym(t.date); if (!k) return;
    if (k === refMonth) curCatMap[t.cat] = (curCatMap[t.cat] || 0) + (+t.amount || 0);
    if (set12.has(k)) sumCatMap[t.cat] = (sumCatMap[t.cat] || 0) + (+t.amount || 0);
  });
  const catsRanked = Object.keys(sumCatMap).sort((a, b) => sumCatMap[b] - sumCatMap[a]).slice(0, 6);
  groupedBars("ch-catcmp", catsRanked,
    catsRanked.map((c) => Math.round(curCatMap[c] || 0)),
    catsRanked.map((c) => Math.round((sumCatMap[c] || 0) / 12)),
    monthLabel(refMonth), "Prom. 12m");
  const cc = root.querySelector("#catcmp-cap");
  if (cc) cc.textContent = `Gasto de ${monthLabel(refMonth)} por categoría vs su promedio mensual de los últimos 12 meses. Barra actual más alta = gastaste más de lo habitual.`;

  // DANE
  root.querySelector("#dane").innerHTML = byCat.map((e, i) => {
    const tu = (e.value / total) * 100;
    return `<div class="dane-row">
      <span class="muted">${e.name}</span>
      <div class="bar" style="height:7px"><span style="width:${Math.min(tu, 100)}%;background:${PALETTE[i % PALETTE.length]}"></span></div>
      <span style="text-align:right">${tu.toFixed(1)}% <span class="muted">${e.dane ? "/ " + e.dane + "%" : "/ propia"}</span></span>
    </div>`;
  }).join("");
}

function kpi(label, val, sm) {
  return `<div class="kpi"><div class="k-label">${label}</div><div class="k-val ${sm ? "sm" : ""}">${val}</div></div>`;
}
