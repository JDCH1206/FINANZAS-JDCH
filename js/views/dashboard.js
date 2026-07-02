// js/views/dashboard.js
import { getState } from "../state.js";
import { RULE_503020, PALETTE } from "../config.js";
import { fmt, ym, monthLabel, sum, curMonth, todayISO, escapeHtml } from "../utils.js";
import { donut, lineTrend, lineTrendPct, categoryBars, groupedBars } from "../components/charts.js";
import { openModal } from "../components/modals.js";

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
let subCat = null; // categoría seleccionada para el desglose por subcategoría
let dashTab = "resumen";       // "resumen" | "detalle"
let detScope = "mes";          // "mes" | "año" en la vista Detalle
let detMonth = null;           // mes elegido (scope mes)
let detYear = null;            // año elegido (scope año)
const detExpanded = new Set(); // categorías desplegadas en Detalle

export function renderDashboard(root) {
  const s = getState();
  if (!s.txs.length && !s.incomes.length) {
    root.innerHTML = `<div class="empty"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" style="opacity:.4"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18"/></svg><p>Aún no hay datos. Importa tu Excel en Ajustes o agrega movimientos.</p></div>`;
    return;
  }
  const months = [...new Set(s.txs.map((t) => ym(t.date)).filter(Boolean))].sort().reverse();
  const detMonths = [...new Set([...s.txs, ...s.incomes].map((t) => ym(t.date)).filter(Boolean))].sort().reverse();
  const tabs = `
    <h2 class="page-title disp">Tablero</h2>
    <div class="row gap-2 mb-3" id="dash-tabs">
      <button class="chip ${dashTab === "resumen" ? "on" : ""}" data-tab="resumen">Resumen</button>
      <button class="chip ${dashTab === "detalle" ? "on" : ""}" data-tab="detalle">Detalle por mes</button>
    </div>`;
  if (dashTab === "detalle") { renderDetalle(root, tabs, detMonths); return; }

  root.innerHTML = `
    ${tabs}
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
      <div class="card col-span"><div class="card-title">Recomendación de gasto según tu salario</div><div id="reco"></div>
        <p class="tiny muted mt-2">Basada solo en tu <b>salario</b> (excluye primas y pagos extra). Referencia: regla <b>50/30/20</b> (50% necesidades · 30% deseos · 20% ahorro), ampliamente usada por asesores financieros; estructura de categorías según canasta <b>DANE</b>. Guía general, <b>no asesoría financiera personalizada</b>.</p>
      </div>
      <div class="card"><div class="card-title">Distribución por categoría</div><div class="chart-box"><canvas id="ch-donut"></canvas></div><div id="leg" class="row wrap gap-2 mt-2"></div></div>
      <div class="card col-span"><div class="row between mb-2" style="align-items:center"><div class="card-title" style="margin:0">Gasto por subcategoría</div><select id="sub-cat" class="input" style="width:auto"></select></div><div class="chart-box"><canvas id="ch-sub"></canvas></div><div id="sub-leg"></div></div>
      <div class="card"><div class="card-title">Regla 50/30/20</div><div id="rule"></div><p class="tiny muted mt-2">La línea marca el objetivo. Verde = en rango (±6%).</p></div>
      <div class="card col-span"><div class="card-title">Tendencia mensual (últimos 12)</div><div class="chart-box"><canvas id="ch-trend"></canvas></div></div>
      <div class="card col-span"><div class="card-title">Evolución de la tasa de ahorro (12 meses)</div><div class="chart-box"><canvas id="ch-saverate"></canvas></div><p class="tiny muted mt-2">% del ingreso que te queda cada mes: (ingresos − gastos) ÷ ingresos.</p></div>
      <div class="card col-span"><div class="card-title">Categorías: mes actual vs promedio 12m</div><div class="chart-box"><canvas id="ch-catcmp"></canvas></div><p class="tiny muted mt-2" id="catcmp-cap"></p></div>
      <div class="card col-span"><div class="card-title">Gasto por día de la semana</div><div class="chart-box"><canvas id="ch-dow"></canvas></div><p class="tiny muted mt-2">Suma del gasto del periodo por día. Revela en qué días gastas más.</p></div>
      <div class="card col-span"><div class="card-title">Balance acumulado en el tiempo</div><div class="chart-box"><canvas id="ch-acum"></canvas></div><p class="tiny muted mt-2">Suma corrida de (ingresos − gastos) mes a mes. Tu colchón de flujo creciendo (o no).</p></div>
      <div class="card col-span"><div class="card-title">Tu % vs. canasta DANE</div><div id="dane"></div></div>
    </div>`;

  root.querySelectorAll("[data-tab]").forEach((b) => b.onclick = () => { dashTab = b.getAttribute("data-tab"); renderDashboard(root); });
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
  const runway = avg ? disponible / avg : 0;                   // meses que cubren tus cuentas

  // gasto diario promedio (sobre el lapso de fechas del periodo) y gasto hormiga
  const fdates = filtered.map((t) => t.date).filter(Boolean).sort();
  const daysSpan = fdates.length ? Math.max(1, Math.round((new Date(fdates[fdates.length - 1]) - new Date(fdates[0])) / 86400000) + 1) : 1;
  const avgDaily = total / daysSpan;
  const hormiga = sum(filtered.filter((t) => (+t.amount || 0) < 20000), (t) => t.amount);

  // proyección fin de mes (mes calendario actual, ritmo de gasto)
  const cmKey = curMonth();
  const spentCM = sum(s.txs.filter((t) => ym(t.date) === cmKey), (t) => t.amount);
  const domDay = +todayISO().slice(8, 10);
  const daysInMonth = new Date(+cmKey.slice(0, 4), +cmKey.slice(5, 7), 0).getDate();
  const projection = domDay ? (spentCM / domDay) * daysInMonth : 0;
  // mayor gasto del periodo
  const maxTx = filtered.reduce((m, t) => ((+t.amount || 0) > (m ? +m.amount : 0) ? t : m), null);

  // gasto mensual promedio de lo indispensable (categorías tipo "Necesidad")
  const typeMap = Object.fromEntries(s.cats.map((c) => [c.name, c.type]));
  const essMap = {};
  s.txs.forEach((t) => { if (typeMap[t.cat] === "Necesidad") { const k = ym(t.date); if (k) essMap[k] = (essMap[k] || 0) + (+t.amount || 0); } });
  const essKeys = Object.keys(essMap).sort().slice(-12);
  const essAvg = essKeys.length ? sum(essKeys.map((k) => essMap[k])) / essKeys.length : 0;

  // ingreso mensual promedio (12m) y gasto recomendado según regla 50/30/20
  const incMap = {};
  s.incomes.forEach((t) => { const k = ym(t.date); if (k) incMap[k] = (incMap[k] || 0) + (+t.amount || 0); });
  // base de la recomendación: SOLO salario (ingreso fijo), excluye primas/pagos grandes
  const salMap = {};
  s.incomes.forEach((t) => { if (t.type === "Salario") { const k = ym(t.date); if (k) salMap[k] = (salMap[k] || 0) + (+t.amount || 0); } });
  const salKeys = Object.keys(salMap).sort().slice(-12);
  const salAvg = salKeys.length ? sum(salKeys.map((k) => salMap[k])) / salKeys.length : 0;
  const recSpend = salAvg * 0.80; // 50% necesidades + 30% deseos

  root.querySelector("#kpis").innerHTML = `
    ${kpi("Ingresos", fmt(totalInc))}
    ${kpi("Gastos", fmt(total))}
    ${kpi("Ahorro (cuentas)", fmt(disponible))}
    ${kpi("Tasa de ahorro", (totalInc ? tasa.toFixed(0) : "—") + "%")}
    ${kpi("Gasto diario prom.", fmt(avgDaily))}
    ${kpi("Indispensable/mes", fmt(essAvg))}
    <div class="kpi" id="kpi-hormiga" style="cursor:pointer" title="Ver el detalle de estos gastos">
      <div class="k-label">Gasto hormiga 🔎</div><div class="k-val">${fmt(hormiga)}</div></div>
    ${kpi("Proyección fin de mes", fmt(projection), true)}
    ${kpi("Mayor gasto", fmt(maxTx ? maxTx.amount : 0), true)}
    ${kpi("Colchón (meses)", (disponible && avg ? runway.toFixed(1) : "—") + " meses", true)}
    ${kpi("Gasto recomendado/mes", salAvg ? fmt(recSpend) : "—", true)}
    ${kpi("Movimientos", filtered.length)}
    ${kpi("Categoría top", byCat[0]?.name || "—", true)}`;

  // recomendación de gasto (50/30/20) según ingreso mensual promedio
  const recoEl = root.querySelector("#reco");
  if (recoEl) {
    const row = (k, v, c) => `<div class="row between" style="padding:6px 0;border-top:1px solid var(--line)"><span class="small muted">${k}</span><span class="small bold"${c ? ` style="color:${c}"` : ""}>${v}</span></div>`;
    if (!salAvg) {
      recoEl.innerHTML = `<div class="muted small">Registra ingresos de tipo "Salario" para ver tu recomendación de gasto.</div>`;
    } else {
      const pctReal = (avg / salAvg) * 100, ok = avg <= recSpend;
      recoEl.innerHTML =
        row("Salario mensual promedio (12m)", fmt(salAvg)) +
        row("Gasto recomendado (≤ 80%)", fmt(recSpend), "var(--gold)") +
        row("· Necesidades sugeridas (≤ 50%)", fmt(salAvg * 0.5)) +
        row("· Deseos sugeridos (≤ 30%)", fmt(salAvg * 0.3)) +
        row("· Ahorro objetivo (≥ 20%)", fmt(salAvg * 0.2), "var(--green)") +
        row("Tu gasto real promedio", `${fmt(avg)} · ${pctReal.toFixed(0)}% del salario`, ok ? "var(--green)" : "var(--red)") +
        `<div class="small" style="margin-top:8px;color:${ok ? "var(--green)" : "var(--red)"}">${ok
          ? `✓ Vas bien: gastas el ${pctReal.toFixed(0)}% de tu salario (objetivo ≤ 80%), te queda margen para ahorrar.`
          : `⚠ Gastas el ${pctReal.toFixed(0)}% de tu salario (recomendado ≤ 80%). Tus primas/extras ayudan, pero conviene que el gasto recurrente quepa en el salario.`}</div>`;
    }
  }

  // clic en "Gasto hormiga" → listado de los movimientos que suman ese total
  const hbtn = root.querySelector("#kpi-hormiga");
  if (hbtn) hbtn.onclick = () => {
    const list = filtered.filter((t) => (+t.amount || 0) < 20000).sort((a, b) => (+b.amount) - (+a.amount));
    const rows = list.map((t) => `<div class="row between" style="padding:6px 0;border-top:1px solid var(--line)">
      <span class="small muted">${escapeHtml(t.date || "")} · ${escapeHtml(t.desc || "")}</span>
      <span class="small bold">${fmt(t.amount)}</span></div>`).join("");
    openModal(`Gasto hormiga · ${list.length} movimientos`,
      `<p class="small muted mb-2">Gastos menores a $20.000. Suman <b>${fmt(hormiga)}</b>.</p>
       <div style="max-height:55vh;overflow:auto">${rows || '<div class="muted small">Sin gastos hormiga en este periodo</div>'}</div>`);
  };

  // Donut
  donut("ch-donut", byCat.map((x) => x.name), byCat.map((x) => x.value));
  root.querySelector("#leg").innerHTML = byCat.slice(0, 6).map((e, i) =>
    `<span class="tiny muted row gap-1"><span style="width:9px;height:9px;border-radius:3px;background:${PALETTE[i % PALETTE.length]}"></span>${e.name} ${((e.value / total) * 100).toFixed(0)}%</span>`).join("");

  // ---- Desglose por subcategoría (de la categoría elegida) ----
  // categorías con gasto en el periodo (priorizamos las que tienen subcategorías)
  const subSel = root.querySelector("#sub-cat");
  if (subSel) {
    const opciones = byCat.map((x) => x.name); // ya vienen ordenadas por gasto, value>0
    if (!subCat || !opciones.includes(subCat)) subCat = opciones[0] || null;
    subSel.innerHTML = opciones.map((n) => `<option ${n === subCat ? "selected" : ""}>${escapeHtml(n)}</option>`).join("");
    subSel.onchange = (e) => { subCat = e.target.value; renderDashboard(root); };
    const subMap = {};
    filtered.filter((t) => t.cat === subCat).forEach((t) => { const k = t.sub || "(sin subcategoría)"; subMap[k] = (subMap[k] || 0) + (+t.amount || 0); });
    const subE = Object.entries(subMap).sort((a, b) => b[1] - a[1]);
    const subTot = sum(subE.map((e) => e[1]));
    if (subE.length) {
      donut("ch-sub", subE.map((e) => e[0]), subE.map((e) => e[1]));
      root.querySelector("#sub-leg").innerHTML = subE.map((e, i) =>
        `<div class="dane-row"><span class="muted"><span style="display:inline-block;width:9px;height:9px;border-radius:3px;background:${PALETTE[i % PALETTE.length]};margin-right:5px"></span>${escapeHtml(e[0])}</span>
         <div class="bar" style="height:7px"><span style="width:${subTot ? Math.min((e[1] / subTot) * 100, 100) : 0}%;background:${PALETTE[i % PALETTE.length]}"></span></div>
         <span style="text-align:right">${fmt(e[1])} <span class="muted">${subTot ? ((e[1] / subTot) * 100).toFixed(0) : 0}%</span></span></div>`).join("");
    } else {
      root.querySelector("#sub-leg").innerHTML = `<div class="muted small">Sin gasto en esta categoría para el periodo.</div>`;
    }
  }

  // 50/30/20
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

  // ---- Gasto por día de la semana (del periodo seleccionado) ----
  const dowSum = [0, 0, 0, 0, 0, 0, 0];
  filtered.forEach((t) => { const p = (t.date || "").split("-").map(Number); if (p.length === 3 && p[0]) { const wd = new Date(p[0], p[1] - 1, p[2]).getDay(); dowSum[wd] += (+t.amount || 0); } });
  categoryBars("ch-dow", ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"], [dowSum[1], dowSum[2], dowSum[3], dowSum[4], dowSum[5], dowSum[6], dowSum[0]]);

  // ---- Balance acumulado en el tiempo (ingresos − gastos, suma corrida) ----
  const allMb = [...new Set([...Object.keys(trendMap), ...Object.keys(incMap)])].sort();
  let acc = 0;
  const acumData = allMb.map((k) => { acc += (incMap[k] || 0) - (trendMap[k] || 0); return Math.round(acc); });
  lineTrend("ch-acum", allMb.map((k) => monthLabel(k)), acumData);

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

/* ===================== DETALLE POR MES (tabla dinámica) ===================== */
function renderDetalle(root, tabs, months) {
  const s = getState();
  const years = [...new Set([...s.txs, ...s.incomes].map((t) => (t.date || "").slice(0, 4)).filter(Boolean))].sort().reverse();
  if (detScope === "año") { if (!detYear || !years.includes(detYear)) detYear = years[0] || String(new Date().getFullYear()); }
  else { if (!detMonth || !months.includes(detMonth)) detMonth = months[0] || curMonth(); }
  const inScope = (d) => detScope === "año" ? (d || "").slice(0, 4) === detYear : ym(d) === detMonth;
  const label = detScope === "año" ? detYear : monthLabel(detMonth);
  const periods = detScope === "año" ? years : months;
  const selVal = detScope === "año" ? detYear : detMonth;
  const txM = s.txs.filter((t) => inScope(t.date));
  const incM = s.incomes.filter((t) => inScope(t.date));
  const gastos = sum(txM, (t) => t.amount);
  const ingresos = sum(incM, (t) => t.amount);
  const balance = ingresos - gastos;
  const pct = ingresos ? (balance / ingresos) * 100 : (balance < 0 ? -100 : 0);
  const balCol = balance >= 0 ? "var(--green)" : "var(--red)";

  const byCat = {};
  txM.forEach((t) => { byCat[t.cat] = (byCat[t.cat] || 0) + (+t.amount || 0); });
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);

  const catRows = cats.map(([name, val], i) => {
    const pc = gastos ? (val / gastos) * 100 : 0;
    const open = detExpanded.has(name);
    let subs = "";
    if (open) {
      const sm = {};
      txM.filter((t) => t.cat === name).forEach((t) => { const k = t.sub || "(sin subcategoría)"; sm[k] = (sm[k] || 0) + (+t.amount || 0); });
      const se = Object.entries(sm).sort((a, b) => b[1] - a[1]);
      subs = se.map(([sn, sv]) => `<div class="row between" style="padding:5px 12px 5px 40px;border-top:1px solid var(--line);background:var(--panel-2)">
          <span class="small muted">${escapeHtml(sn)}</span>
          <span class="small">${fmt(sv)} <span class="muted tiny">${val ? ((sv / val) * 100).toFixed(0) : 0}%</span></span></div>`).join("");
    }
    return `<div class="tx-row cat-row" data-cat="${escapeHtml(name)}" style="cursor:pointer;align-items:center">
        <span style="width:14px;color:var(--sub)">${open ? "▾" : "▸"}</span>
        <span class="tx-dot" style="background:${PALETTE[i % PALETTE.length]}"></span>
        <div class="flex1" style="min-width:0"><div class="tx-desc">${escapeHtml(name)}</div>
          <div class="bar" style="height:6px;margin-top:4px"><span style="width:${Math.min(pc, 100)}%;background:${PALETTE[i % PALETTE.length]}"></span></div></div>
        <div class="tx-amt" style="text-align:right">${fmt(val)}<div class="tiny muted">${pc.toFixed(0)}%</div></div>
      </div>${subs}`;
  }).join("");

  root.innerHTML = tabs + `
    <div class="card mb-3">
      <div class="row gap-2 mb-2">
        <button class="chip ${detScope === "mes" ? "on" : ""}" data-scope="mes">Por mes</button>
        <button class="chip ${detScope === "año" ? "on" : ""}" data-scope="año">Por año</button>
      </div>
      <label class="label">${detScope === "año" ? "Año" : "Mes"}</label>
      <select id="det-mes" class="input" style="width:auto">${periods.map((p) => `<option value="${p}" ${p === selVal ? "selected" : ""}>${detScope === "año" ? p : monthLabel(p)}</option>`).join("")}</select>
    </div>
    <div class="grid-kpi mb-3">
      <div class="kpi"><div class="k-label">Ingresos</div><div class="k-val sm" style="color:var(--green)">${fmt(ingresos)}</div></div>
      <div class="kpi"><div class="k-label">Gastos</div><div class="k-val sm">${fmt(gastos)}</div></div>
      <div class="kpi"><div class="k-label">Balance</div><div class="k-val sm" style="color:${balCol}">${fmt(balance)}</div></div>
      <div class="kpi"><div class="k-label">Balance %</div><div class="k-val sm" style="color:${balCol}">${ingresos ? (balance >= 0 ? "+" : "") + pct.toFixed(0) + "%" : "—"}</div></div>
    </div>
    <div class="card" style="padding:0">
      <div class="row between" style="padding:10px 12px;border-bottom:1px solid var(--line)">
        <span class="card-title" style="margin:0">Gasto por categoría · ${label}</span>
        <span class="tiny muted">toca para ver subcategorías</span></div>
      ${cats.length ? catRows : `<div class="muted small" style="padding:16px">Sin gastos en ${label}.</div>`}
      ${cats.length ? `<div class="row between" style="padding:11px 12px;border-top:2px solid var(--line);font-weight:700"><span>Total gastos</span><span>${fmt(gastos)}</span></div>` : ""}
    </div>`;

  root.querySelectorAll("[data-tab]").forEach((b) => b.onclick = () => { dashTab = b.getAttribute("data-tab"); renderDashboard(root); });
  root.querySelectorAll("[data-scope]").forEach((b) => b.onclick = () => { detScope = b.getAttribute("data-scope"); detExpanded.clear(); renderDashboard(root); });
  root.querySelector("#det-mes").onchange = (e) => { if (detScope === "año") detYear = e.target.value; else detMonth = e.target.value; renderDashboard(root); };
  root.querySelectorAll(".cat-row").forEach((rw) => rw.onclick = () => {
    const c = rw.getAttribute("data-cat");
    if (detExpanded.has(c)) detExpanded.delete(c); else detExpanded.add(c);
    renderDashboard(root);
  });
}
