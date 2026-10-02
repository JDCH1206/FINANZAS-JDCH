// js/views/dashboard.js
import { getState } from "../state.js";
import { RULE_503020, PALETTE } from "../config.js";
import { fmt, fmtShort, ym, monthLabel, sum, curMonth, todayISO, escapeHtml } from "../utils.js";
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
let kpisOpen = false; // mostrar todos los indicadores o solo los principales
let dashTab = "resumen";       // "resumen" | "detalle" | "calendario"
let detPath = { year: null, month: null, cat: null }; // ruta del drill-down Año › Mes › Categoría › Subcat
let calMonth = null;           // mes del calendario/mapa de calor
let advYear = null;            // año del Sankey de flujo (pestaña Avanzado)
let advMonth = "";             // mes del Sankey ("" = todo el año; si no, "YYYY-MM")

export function renderDashboard(root) {
  const s = getState();
  if (!s.txs.length && !s.incomes.length) {
    root.innerHTML = `<div class="empty"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" style="opacity:.4"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18"/></svg><p>Aún no hay datos. Importa tu Excel en Ajustes o agrega movimientos.</p></div>`;
    return;
  }
  const months = [...new Set(s.txs.map((t) => ym(t.date)).filter(Boolean))].sort().reverse();
  const tabs = `
    <h2 class="page-title disp">Tablero</h2>
    <div class="row gap-2 mb-3 wrap" id="dash-tabs">
      <button class="chip ${dashTab === "resumen" ? "on" : ""}" data-tab="resumen">Resumen</button>
      <button class="chip ${dashTab === "detalle" ? "on" : ""}" data-tab="detalle">Detalle por mes</button>
      <button class="chip ${dashTab === "calendario" ? "on" : ""}" data-tab="calendario">Calendario</button>
      <button class="chip ${dashTab === "avanzado" ? "on" : ""}" data-tab="avanzado">Avanzado</button>
    </div>`;
  if (dashTab === "detalle") { renderDetalle(root, tabs); return; }
  if (dashTab === "calendario") { renderCalendar(root, tabs); return; }
  if (dashTab === "avanzado") { renderAvanzado(root, tabs); return; }

  root.innerHTML = `
    ${tabs}
    <p class="page-sub">Comportamiento del gasto y comparación con referentes</p>
    <div class="row gap-2 wrap mb-4" id="chips">
      <button class="chip ${period === "all" ? "on" : ""}" data-p="all">Todo</button>
      ${months.slice(0, 6).map((m) => `<button class="chip ${period === m ? "on" : ""}" data-p="${m}">${monthLabel(m)}</button>`).join("")}
    </div>
    <div class="grid-kpi mb-2" id="kpis"></div>
    <button id="kpi-more" class="btn btn-ghost btn-sm mb-4">${kpisOpen ? "Ver menos indicadores ▴" : "Ver más indicadores ▾"}</button>
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
  const disponible = sum((s.accounts || []).filter((a) => a.type !== "Por cobrar"), (a) => +a.balance || 0); // ahorro líquido (excluye "Por cobrar")
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

  // indicadores principales siempre visibles; los demás con "Ver más indicadores"
  const kpisMain = `
    ${kpi("Ingresos", fmt(totalInc))}
    ${kpi("Gastos", fmt(total))}
    ${kpi("Tasa de ahorro", (totalInc ? tasa.toFixed(0) : "—") + "%")}
    ${kpi("Ahorro (cuentas)", fmt(disponible))}
    ${kpi("Proyección fin de mes", fmt(projection), true)}
    <div class="kpi" id="kpi-hormiga" style="cursor:pointer" title="Ver el detalle de estos gastos">
      <div class="k-label">Gasto hormiga 🔎</div><div class="k-val">${fmt(hormiga)}</div></div>`;
  const kpisExtra = `
    ${kpi("Gasto diario prom.", fmt(avgDaily))}
    ${kpi("Indispensable/mes", fmt(essAvg))}
    ${kpi("Mayor gasto", fmt(maxTx ? maxTx.amount : 0), true)}
    ${kpi("Colchón (meses)", (disponible && avg ? runway.toFixed(1) : "—") + " meses", true)}
    ${kpi("Gasto recomendado/mes", salAvg ? fmt(recSpend) : "—", true)}
    ${kpi("Movimientos", filtered.length)}
    ${kpi("Categoría top", byCat[0]?.name || "—", true)}`;
  root.querySelector("#kpis").innerHTML = kpisMain + (kpisOpen ? kpisExtra : "");
  root.querySelector("#kpi-more").onclick = () => { kpisOpen = !kpisOpen; renderDashboard(root); };

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

  // ---- Comparativo de gasto (sigue el mes elegido en los chips; si es "Todo", usa el mes actual) ----
  const sumMonth = (k) => sum(s.txs.filter((t) => ym(t.date) === k), (t) => t.amount);
  const refMonth = period === "all" ? curMonth() : period;
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

/* ===================== CALENDARIO / MAPA DE CALOR ===================== */
function renderCalendar(root, tabs) {
  const s = getState();
  const months = [...new Set([...s.txs, ...s.incomes].map((t) => ym(t.date)).filter(Boolean)), curMonth()];
  const allMonths = [...new Set(months)].sort().reverse();
  if (!calMonth || !allMonths.includes(calMonth)) calMonth = allMonths[0] || curMonth();

  // total de gasto por día del mes
  const byDay = {};
  s.txs.filter((t) => ym(t.date) === calMonth).forEach((t) => { const d = +(t.date || "").slice(8, 10); if (d) byDay[d] = (byDay[d] || 0) + (+t.amount || 0); });
  const [Y, M] = calMonth.split("-").map(Number);
  const dim = new Date(Y, M, 0).getDate();
  const firstDow = (new Date(Y, M - 1, 1).getDay() + 6) % 7; // 0 = lunes
  const maxDay = Math.max(1, ...Object.values(byDay));
  const totalMes = sum(Object.values(byDay));
  const diasCon = Object.keys(byDay).length;
  const hoy = todayISO();

  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(`<div></div>`);
  for (let d = 1; d <= dim; d++) {
    const val = byDay[d] || 0;
    const inten = val / maxDay;                       // 0..1
    const alpha = val ? (0.15 + 0.65 * inten).toFixed(2) : 0;
    const iso = `${calMonth}-${String(d).padStart(2, "0")}`;
    const isHoy = iso === hoy;
    cells.push(`<button class="cal-cell" ${val ? `data-day="${d}"` : "disabled"} style="border:1px solid ${isHoy ? "var(--gold)" : "var(--line)"};background:rgba(216,166,87,${alpha});border-radius:8px;min-height:52px;padding:4px 5px;display:flex;flex-direction:column;justify-content:space-between;cursor:${val ? "pointer" : "default"};color:var(--ink);font-family:inherit;text-align:left">
      <span class="tiny" style="opacity:.8">${d}</span>
      ${val ? `<span class="tiny bold" style="font-size:10.5px">${fmtShort(val)}</span>` : ""}
    </button>`);
  }

  root.innerHTML = tabs + `
    <div class="card mb-3">
      <div class="row between mb-2" style="align-items:center">
        <div class="card-title" style="margin:0">Mapa de calor del gasto</div>
        <select id="cal-mes" class="input" style="width:auto">${allMonths.map((m) => `<option value="${m}" ${m === calMonth ? "selected" : ""}>${monthLabel(m)}</option>`).join("")}</select>
      </div>
      <div class="row between tiny muted mb-2"><span>${diasCon} días con gasto</span><span>Total ${fmt(totalMes)}</span></div>
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-bottom:6px">
        ${["L", "M", "M", "J", "V", "S", "D"].map((x) => `<div class="tiny muted center" style="text-align:center">${x}</div>`).join("")}
      </div>
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px">${cells.join("")}</div>
      <p class="tiny muted mt-3">Cada día se colorea según cuánto gastaste (más intenso = más gasto). Toca un día para ver sus movimientos.</p>
    </div>`;

  root.querySelectorAll("[data-tab]").forEach((b) => b.onclick = () => { dashTab = b.getAttribute("data-tab"); renderDashboard(root); });
  root.querySelector("#cal-mes").onchange = (e) => { calMonth = e.target.value; renderCalendar(root, tabs); };
  root.querySelectorAll("[data-day]").forEach((b) => b.onclick = () => openDayModal(calMonth, +b.getAttribute("data-day")));
}

/* ===================== ANÁLISIS AVANZADO (gasto hormiga + recurrentes) ===================== */
const _norm = (x) => (x || "").trim().toLowerCase().replace(/\s+/g, " ");
function renderAvanzado(root, tabs) {
  const s = getState();
  const txs = s.txs || [];
  // agrupar por descripción normalizada
  const g = {};
  txs.forEach((t) => {
    const k = _norm(t.desc); if (!k) return;
    const G = g[k] || (g[k] = { n: 0, tot: 0, orig: {}, months: new Set() });
    G.n++; G.tot += (+t.amount || 0); G.orig[t.desc] = (G.orig[t.desc] || 0) + 1; G.months.add((t.date || "").slice(0, 7));
  });
  const name = (G) => Object.entries(G.orig).sort((a, b) => b[1] - a[1])[0][0];
  const groups = Object.values(g);
  const nMonths = new Set(txs.map((t) => (t.date || "").slice(0, 7)).filter(Boolean)).size || 1;

  // gasto hormiga: compras repetidas (>=3 veces), ordenadas por total
  const horm = groups.filter((G) => G.n >= 3).sort((a, b) => b.tot - a.tot).slice(0, 20);
  const hormTot = sum(horm.map((G) => G.tot));

  // recurrentes detectados: aparecen en muchos meses distintos (>=5) y aún no están como recurrente
  const yaRec = new Set((s.recurrentes || []).map((r) => _norm(r.desc)));
  const recs = groups.filter((G) => G.months.size >= 5 && !yaRec.has(_norm(name(G))))
    .sort((a, b) => b.months.size - a.months.size).slice(0, 12);

  const rowH = (G) => `<div class="tx-row">
    <div class="flex1"><div class="tx-desc">${escapeHtml(name(G))}</div><div class="tx-meta">${G.n} veces · prom ${fmt(G.tot / G.n)}</div></div>
    <div class="tx-amt">${fmt(G.tot)}</div></div>`;
  const rowR = (G) => `<div class="tx-row">
    <div class="flex1"><div class="tx-desc">${escapeHtml(name(G))}</div><div class="tx-meta">en ${G.months.size} meses · ${G.n} veces</div></div>
    <div class="tx-amt">${fmt(G.tot / Math.max(1, G.months.size))}<div class="tiny muted">prom/mes</div></div></div>`;

  // --- Sankey: flujo ingreso → categorías (+ ahorro) del año elegido ---
  const years = [...new Set([...txs, ...(s.incomes || [])].map((t) => (t.date || "").slice(0, 4)).filter(Boolean))].sort().reverse();
  if (!advYear || !years.includes(advYear)) advYear = years[0] || curMonth().slice(0, 4);
  // meses del año elegido con movimientos (para ver el flujo de un solo mes)
  const months = [...new Set([...txs, ...(s.incomes || [])].map((t) => (t.date || "").slice(0, 7)).filter((m) => m.slice(0, 4) === advYear))].sort().reverse();
  if (advMonth && !months.includes(advMonth)) advMonth = "";
  const period = advMonth || advYear, inPer = (t) => (t.date || "").startsWith(period);
  const periodLbl = advMonth ? monthLabel(advMonth) : advYear;
  const inY = sum((s.incomes || []).filter(inPer), (t) => t.amount);
  const exByCat = {};
  txs.filter(inPer).forEach((t) => { exByCat[t.cat] = (exByCat[t.cat] || 0) + (+t.amount || 0); });
  const exY = sum(Object.values(exByCat));
  const sankey = buildSankey(inY, exByCat, advMonth ? "del mes" : "del año");
  const concil = buildConciliacion(s, txs, period, periodLbl);

  root.innerHTML = tabs + `
    <div class="card mb-3">
      <div class="row between mb-2" style="align-items:center;flex-wrap:wrap;gap:8px"><div class="card-title" style="margin:0">💵 Flujo del dinero</div>
        <div class="row gap-2"><select id="adv-month" class="input" style="width:auto"><option value="">Todo el año</option>${months.map((m) => `<option value="${m}" ${m === advMonth ? "selected" : ""}>${escapeHtml(monthLabel(m))}</option>`).join("")}</select>
        <select id="adv-year" class="input" style="width:auto">${years.map((y) => `<option ${y === advYear ? "selected" : ""}>${y}</option>`).join("")}</select></div></div>
      <div class="row between tiny muted mb-2"><span>Ingresos ${fmt(inY)}</span><span>Gastos ${fmt(exY)}</span><span style="color:${inY - exY >= 0 ? "var(--green)" : "var(--red)"}">${inY - exY >= 0 ? "Ahorro" : "Déficit"} ${fmt(Math.abs(inY - exY))}</span></div>
      ${sankey}
      ${inY - exY < 0 ? `<p class="tiny" style="color:var(--red)">⚠ En ${escapeHtml(periodLbl)} gastaste más de lo que ingresó.</p>` : ""}
    </div>
    ${concil}
    <div class="card mb-3">
      <div class="card-title">🐜 Compras repetidas (gasto hormiga)</div>
      <p class="tiny muted" style="margin:-4px 0 8px">Lo que compras ≥3 veces, ordenado por total. Estas ${horm.length} suman <b>${fmt(hormTot)}</b> (≈ ${fmt(hormTot / (nMonths / 12))}/año).</p>
      <div style="padding:0" id="adv-horm">${horm.map(rowH).join("") || '<div class="muted small">Sin datos</div>'}</div>
    </div>
    <div class="card mb-3">
      <div class="card-title">🔁 Posibles gastos fijos / recurrentes</div>
      <p class="tiny muted" style="margin:-4px 0 8px">Aparecen casi todos los meses. Puedes volverlos recurrentes en <b>Ajustes → Gastos recurrentes</b> para que la app te los recuerde.</p>
      <div id="adv-rec">${recs.map(rowR).join("") || '<div class="muted small">No se detectaron recurrentes nuevos</div>'}</div>
    </div>`;

  root.querySelectorAll("[data-tab]").forEach((b) => b.onclick = () => { dashTab = b.getAttribute("data-tab"); renderDashboard(root); });
  const yr = root.querySelector("#adv-year"); if (yr) yr.onchange = (e) => { advYear = e.target.value; advMonth = ""; renderDashboard(root); };
  const mo = root.querySelector("#adv-month"); if (mo) mo.onchange = (e) => { advMonth = e.target.value; renderDashboard(root); };
}

// Conciliación del ahorro: ¿lo que "debería" quedar (ingresos − gastos) es lo que realmente
// llegó a las cuentas o se usó para pagar deudas? Compara solo desde que hay registros de cuentas.
function buildConciliacion(s, txs, period, periodLbl) {
  const accts = s.accounts || [], debts = s.debts || [];
  const movs = accts.flatMap((a) => (a.movs || []).map((m) => ({ ...m, acct: a })));
  const abonos = debts.flatMap((d) => (d.abonos || []).map((x) => ({ ...x, debt: d })));
  const fechas = [...movs.filter((m) => m.kind !== "rendimiento").map((m) => m.date), ...abonos.map((x) => x.date)].filter(Boolean).sort();
  const head = `<div class="card mb-3"><div class="card-title">🔎 ¿Tu ahorro llegó a las cuentas?</div>`;
  if (!fechas.length) return `${head}<p class="small muted">Aún no hay aportes en <b>Cuentas</b> ni abonos en <b>Deudas</b> para comparar. Cuando registres aportes ("Actualizar saldo" o "Sumar"), aquí verás si coinciden con tu ahorro.</p></div>`;
  const desde = fechas[0].slice(0, 7);
  const pEnd = period.length === 4 ? period + "-12" : period;
  if (pEnd < desde) return `${head}<p class="small muted">Empezaste a registrar aportes en <b>${escapeHtml(monthLabel(desde))}</b>; para ${escapeHtml(periodLbl)} no hay con qué comparar. Elige un mes desde esa fecha.</p></div>`;
  // ventana comparable: el período elegido, recortado al mes en que empezaron los registros
  // en la vista anual se excluye el mes en curso: su ahorro normalmente aún no se ha aportado
  const cm = curMonth(), esAnual = period.length === 4;
  const sinMesActual = esAnual && cm.startsWith(period);
  const inWin = (d) => { const m = (d || "").slice(0, 7); return (d || "").startsWith(period) && m >= desde && !(sinMesActual && m === cm); };
  const recortado = esAnual && period + "-01" < desde;
  const mesEnCurso = period === cm;
  const ing = sum((s.incomes || []).filter((t) => inWin(t.date)), (t) => t.amount);
  const gas = sum(txs.filter((t) => inWin(t.date)), (t) => t.amount);
  const ahorro = ing - gas;
  const mv = movs.filter((m) => inWin(m.date));
  const aportes = sum(mv.filter((m) => m.kind !== "rendimiento" && m.kind !== "transfer" && m.acct.type !== "Por cobrar"), (m) => +m.amount || 0);
  const rend = sum(mv.filter((m) => m.kind === "rendimiento"), (m) => +m.amount || 0);
  const ab = abonos.filter((x) => inWin(x.date));
  const debe = (x) => x.debt.tipo === "debo" || x.debt.tipo === "tarjeta";
  const pagosDeuda = sum(ab.filter((x) => debe(x) && x.delta < 0), (x) => -x.delta);   // salió dinero para pagar deudas
  const nuevaDeuda = sum(ab.filter((x) => debe(x) && x.delta > 0), (x) => x.delta);    // consumos a crédito: gasto que no salió de tu bolsillo
  const cobros = sum(ab.filter((x) => x.debt.tipo === "me_deben" && x.delta < 0), (x) => -x.delta); // te pagaron: entró dinero que no es ingreso
  const destino = aportes + pagosDeuda - nuevaDeuda - cobros;
  const dif = ahorro - destino;
  const tol = Math.max(50000, Math.abs(ing) * 0.02);
  const money = (v) => (v < 0 ? "−" : "") + fmt(Math.abs(v));
  const hayDeudas = debts.some((d) => (d.abonos || []).length);
  const row = (lbl, val, sub = "", strong = false, col = "") => `<div class="row between" style="padding:7px 0;border-top:1px solid var(--line)">
      <div style="min-width:0"><div class="small ${strong ? "bold" : ""}">${lbl}</div>${sub ? `<div class="tiny muted">${sub}</div>` : ""}</div>
      <div class="small ${strong ? "bold" : ""}" style="flex:none;${col ? "color:" + col : ""}">${money(val)}</div></div>`;
  let veredicto;
  if (mesEnCurso) veredicto = `<p class="small muted">Revisa esta comparación al cerrar el mes, cuando ya hayas hecho tus aportes.</p>`;
  else if (Math.abs(dif) <= tol) veredicto = `<p class="small" style="color:var(--green)">✅ <b>Cuadra.</b> Lo que ahorraste según tus registros es prácticamente lo que llegó a tus cuentas${pagosDeuda ? " o pagó deudas" : ""}.</p>`;
  else if (dif > 0) veredicto = `<p class="small" style="color:var(--yel)">⚠ <b>Faltan ${fmt(dif)} por ubicar.</b> Según tus registros ahorraste más de lo que llegó a tus cuentas${hayDeudas ? " o a pagar deudas" : ""}. Puede estar en efectivo o en una cuenta que no registras, haber gastos sin anotar, o un ingreso registrado que aún no llega.</p>`;
  else veredicto = `<p class="small" style="color:var(--yel)">⚠ <b>Aportaste ${fmt(-dif)} más</b> de lo que tus registros dicen que ahorraste. Pudo salir de efectivo o saldo de meses anteriores, o hay un ingreso sin registrar.${esAnual ? "" : " Si un aporte de fin de mes corresponde al mes siguiente, compara por año."}</p>`;
  return `${head}
    <p class="tiny muted" style="margin:-4px 0 6px">${escapeHtml(periodLbl)}${recortado ? ` · comparando desde <b>${escapeHtml(monthLabel(desde))}</b>, cuando empezaste a registrar aportes` : ""}${sinMesActual ? ` · sin ${escapeHtml(monthLabel(cm))} (mes en curso)` : ""}.</p>
    ${mesEnCurso ? `<p class="tiny" style="color:var(--yel);margin:0 0 6px">⏳ Este mes aún no termina: es normal que el ahorro todavía no aparezca en las cuentas.</p>` : ""}
    ${row("Ahorro según tus registros", ahorro, `Ingresos ${fmt(ing)} − Gastos ${fmt(gas)}`, true)}
    ${row("Aportes netos a cuentas", aportes, "Sumas/aportes menos retiros · sin rendimientos ni transferencias entre cuentas")}
    ${pagosDeuda ? row("+ Pagos a deudas", pagosDeuda, "Abonos y pagos de tarjeta: tu ahorro se usó para bajar deuda") : ""}
    ${nuevaDeuda ? row("− Compras a crédito", -nuevaDeuda, "Consumos de tarjeta/préstamos: gastos que no salieron de tu bolsillo aún") : ""}
    ${cobros ? row("− Pagos que te hicieron", -cobros, "Dinero que te devolvieron (no es ingreso)") : ""}
    ${row("= Destino real del ahorro", destino, "", true)}
    ${row("Diferencia", dif, dif > 0 ? "Ahorro sin ubicar" : dif < 0 ? "Aportado de más" : "", true, mesEnCurso ? "" : Math.abs(dif) <= tol ? "var(--green)" : "var(--yel)")}
    ${veredicto}
    ${rend ? `<p class="tiny muted">Aparte, tus cuentas generaron ${fmt(rend)} en rendimientos (no se cuentan arriba porque no vienen de tus ingresos).</p>` : ""}
  </div>`;
}

// Diagrama Sankey (SVG inline) en 3 columnas: Ingresos → (Gastos | Ahorro) → categorías.
// El color codifica el SIGNIFICADO (dorado ingreso, gris gasto, verde ahorro, rojo déficit);
// las categorías se identifican con etiqueta directa, no con colores.
function buildSankey(inY, exByCat, perTxt = "del año") {
  const exY = sum(Object.values(exByCat));
  if (!inY && !exY) return `<div class="muted small">Sin datos para este período.</div>`;
  const TOP = 7;
  const sorted = Object.entries(exByCat).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const cats = sorted.slice(0, TOP).map(([label, value]) => ({ label, value }));
  const rest = sorted.slice(TOP);
  if (rest.length) cats.push({ label: `Otras (${rest.length})`, value: sum(rest.map((r) => r[1])), title: rest.map((r) => `${r[0]} ${fmtShort(r[1])}`).join(" · ") });
  const ahorro = Math.max(0, inY - exY), deficit = Math.max(0, exY - inY);
  const base = Math.max(inY, exY); // % sobre ingresos (o sobre gastos si hubo déficit)
  const pct = (v) => `${Math.round((v / base) * 100)}%`;

  const W = 340, NW = 10, X0 = 0, X1 = 92, X2 = 184, LX = X2 + NW + 6;
  const PLOT = 230, sc = PLOT / base, SLOT = 31, GAP = 8;
  const GRAY = "var(--sub)", C = { in: "var(--gold)", gasto: GRAY, ahorro: "var(--green)", def: "var(--red)" };
  const ribbon = (xa, ya0, xb, yb0, h, col, op, tip) => {
    const m = (xa + xb) / 2;
    return `<path class="sk-band" d="M${xa},${ya0} C${m},${ya0} ${m},${yb0} ${xb},${yb0} L${xb},${yb0 + h} C${m},${yb0 + h} ${m},${ya0 + h} ${xa},${ya0 + h} Z" fill="${col}" fill-opacity="${op}"><title>${escapeHtml(tip)}</title></path>`;
  };
  const node = (x, y, h, col, tip) => `<rect x="${x}" y="${y}" width="${NW}" height="${Math.max(2, h)}" rx="2" fill="${col}"><title>${escapeHtml(tip)}</title></rect>`;
  let svg = "";

  // columna 0: Ingresos (+ Déficit si se gastó más de lo que entró)
  const hIn = inY * sc, hDef = deficit * sc;
  svg += node(X0, 0, hIn, C.in, `Ingresos ${fmt(inY)}`);
  if (deficit) svg += node(X0, hIn + GAP, hDef, C.def, `Déficit (salió de ahorros/deuda) ${fmt(deficit)}`);
  // columna 1: Gastos y Ahorro
  const hG = exY * sc, hA = ahorro * sc, yA = hG + GAP;
  if (exY) svg += node(X1, 0, hG, C.gasto, `Gastos ${fmt(exY)} · ${pct(exY)}`);
  if (ahorro) svg += node(X1, yA, hA, C.ahorro, `Ahorro ${fmt(ahorro)} · ${pct(ahorro)}`);
  // cintas columna 0 → 1
  if (exY) svg += ribbon(X0 + NW, 0, X1, 0, Math.min(inY, exY) * sc, C.gasto, 0.28, `Ingresos → Gastos ${fmt(Math.min(inY, exY))}`);
  if (ahorro) svg += ribbon(X0 + NW, hG, X1, yA, hA, C.ahorro, 0.35, `Ingresos → Ahorro ${fmt(ahorro)}`);
  if (deficit) svg += ribbon(X0 + NW, hIn + GAP, X1, inY * sc, hDef, C.def, 0.35, `Déficit → Gastos ${fmt(deficit)}`);

  // columna 2: categorías (con espacio mínimo para su etiqueta de 2 líneas) + Ahorro al final
  let yOut = 0, y2 = 0, labels = "";
  const label = (y, h, name, val, col) => {
    const cy = y + h / 2;
    return `<text x="${LX}" y="${cy - 2}" font-size="10.5" font-weight="600" fill="var(--ink)">${escapeHtml(name)}</text>
      <text x="${LX}" y="${cy + 10}" font-size="9.5" fill="var(--sub)">${fmtShort(val)} · ${pct(val)}</text>`;
  };
  cats.forEach((c) => {
    const h = c.value * sc;
    const tip = `${c.label}: ${fmt(c.value)} · ${pct(c.value)} de los ingresos${c.title ? " — " + c.title : ""}`;
    svg += ribbon(X1 + NW, yOut, X2, y2, h, C.gasto, 0.22, tip);
    svg += node(X2, y2, h, C.gasto, tip);
    labels += label(y2, h, c.label, c.value);
    yOut += h; y2 += Math.max(h + 3, SLOT);
  });
  if (ahorro) {
    y2 += GAP;
    svg += ribbon(X1 + NW, yA, X2, y2, hA, C.ahorro, 0.35, `Ahorro ${fmt(ahorro)}`);
    svg += node(X2, y2, hA, C.ahorro, `Ahorro ${fmt(ahorro)} · ${pct(ahorro)}`);
    labels += `<text x="${LX}" y="${y2 + hA / 2 - 2}" font-size="10.5" font-weight="700" fill="var(--green)">Ahorro</text>
      <text x="${LX}" y="${y2 + hA / 2 + 10}" font-size="9.5" fill="var(--sub)">${fmtShort(ahorro)} · ${pct(ahorro)}</text>`;
    y2 += Math.max(hA, SLOT);
  }
  const H = Math.ceil(Math.max(y2, hIn + (deficit ? GAP + hDef : 0), yA + hA) + 4);
  const colHead = (x, t, anchor = "start") => `<text x="${x}" y="-6" font-size="9" fill="var(--sub)" text-anchor="${anchor}" letter-spacing=".04em">${t}</text>`;
  return `<div style="max-width:560px;margin:0 auto">
    <svg viewBox="0 -16 ${W} ${H + 16}" style="width:100%;height:auto;display:block" role="img" aria-label="Flujo del dinero: ingresos, gastos por categoría y ahorro">
      <style>.sk-band{transition:fill-opacity .15s}.sk-band:hover{fill-opacity:.55}</style>
      ${colHead(X0, "INGRESOS")}${colHead(X1, "REPARTO")}${colHead(X2, "EN QUÉ SE FUE")}
      ${svg}${labels}
    </svg>
    <p class="tiny muted" style="margin-top:6px">Porcentajes sobre tus ingresos ${perTxt}${deficit ? " (sobre los gastos, porque hubo déficit)" : ""}. Toca una banda para ver el valor exacto.</p>
  </div>`;
}

function openDayModal(mes, day) {
  const s = getState();
  const iso = `${mes}-${String(day).padStart(2, "0")}`;
  const list = s.txs.filter((t) => t.date === iso).sort((a, b) => (+b.amount || 0) - (+a.amount || 0));
  const tot = sum(list, (t) => t.amount);
  const rows = list.map((t) => `<div class="row between" style="padding:6px 0;border-top:1px solid var(--line)">
    <span class="small muted" style="min-width:0">${escapeHtml(t.desc || "")} <span class="tiny">· ${escapeHtml(t.cat || "")}</span></span>
    <span class="small bold" style="flex:none">${fmt(t.amount)}</span></div>`).join("");
  openModal(`${day} de ${monthLabel(mes)} · ${fmt(tot)}`,
    `<div style="max-height:55vh;overflow:auto">${rows || '<div class="muted small">Sin gastos ese día</div>'}</div>`);
}

/* ===================== DETALLE: drill-down por niveles (Año › Mes › Cat › Subcat) ===================== */
function renderDetalle(root, tabs) {
  const s = getState();
  const money = (arr) => sum(arr, (t) => t.amount);
  // alcance actual para los KPIs (mes si hay mes; si no, año; si no, todo)
  const scope = (d) => detPath.month ? ym(d) === detPath.month : detPath.year ? (d || "").slice(0, 4) === detPath.year : true;
  const txS = s.txs.filter((t) => scope(t.date));
  const incS = s.incomes.filter((t) => scope(t.date));
  const gastos = money(txS), ingresos = money(incS), balance = ingresos - gastos;
  const pct = ingresos ? (balance / ingresos) * 100 : (balance < 0 ? -100 : 0);
  const balCol = balance >= 0 ? "var(--green)" : "var(--red)";

  // migas de pan
  const crumbs = [{ lbl: "Todos", lvl: 0 }];
  if (detPath.year) crumbs.push({ lbl: detPath.year, lvl: 1 });
  if (detPath.month) crumbs.push({ lbl: monthLabel(detPath.month), lvl: 2 });
  if (detPath.cat) crumbs.push({ lbl: detPath.cat, lvl: 3 });
  const crumbHtml = crumbs.map((c, i) => `<span class="det-crumb" data-lvl="${c.lvl}" style="cursor:pointer;${i === crumbs.length - 1 ? "font-weight:700" : "color:var(--gold)"}">${escapeHtml(c.lbl)}</span>`).join(` <span class="muted">›</span> `);

  // construir el nivel actual
  let title, rows, leaf = false;
  if (!detPath.year) {
    title = "Selecciona un año";
    const years = [...new Set([...s.txs, ...s.incomes].map((t) => (t.date || "").slice(0, 4)).filter(Boolean))].sort().reverse();
    rows = years.map((y) => { const g = money(s.txs.filter((t) => (t.date || "").slice(0, 4) === y)), inc = money(s.incomes.filter((t) => (t.date || "").slice(0, 4) === y)); return { key: y, label: y, val: g, bal: inc - g, drill: true }; });
  } else if (!detPath.month) {
    title = `Meses de ${detPath.year}`;
    const ms = [...new Set([...s.txs, ...s.incomes].map((t) => ym(t.date)).filter((k) => k && k.slice(0, 4) === detPath.year))].sort();
    rows = ms.map((m) => { const g = money(s.txs.filter((t) => ym(t.date) === m)), inc = money(s.incomes.filter((t) => ym(t.date) === m)); return { key: m, label: monthLabel(m), val: g, bal: inc - g, drill: true }; });
  } else if (!detPath.cat) {
    title = `Categorías de ${monthLabel(detPath.month)}`;
    const byCat = {}; txS.forEach((t) => { byCat[t.cat] = (byCat[t.cat] || 0) + (+t.amount || 0); });
    rows = Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([n, v]) => ({ key: n, label: n, val: v, pc: gastos ? (v / gastos) * 100 : 0, drill: true }));
  } else {
    leaf = true;
    title = `Subcategorías de ${detPath.cat}`;
    const catTot = money(txS.filter((t) => t.cat === detPath.cat));
    const sm = {}; txS.filter((t) => t.cat === detPath.cat).forEach((t) => { const k = t.sub || "(sin subcategoría)"; sm[k] = (sm[k] || 0) + (+t.amount || 0); });
    rows = Object.entries(sm).sort((a, b) => b[1] - a[1]).map(([n, v]) => ({ key: n, label: n, val: v, pc: catTot ? (v / catTot) * 100 : 0, drill: false }));
  }

  const rowsHtml = rows.length ? rows.map((r, i) => `<div class="tx-row ${r.drill ? "det-drill" : ""}" ${r.drill ? `data-key="${escapeHtml(r.key)}"` : ""} style="${r.drill ? "cursor:pointer;" : ""}align-items:center">
      <span class="tx-dot" style="background:${PALETTE[i % PALETTE.length]}"></span>
      <div class="flex1" style="min-width:0"><div class="tx-desc">${escapeHtml(r.label)}</div>
        ${r.pc != null ? `<div class="bar" style="height:6px;margin-top:4px"><span style="width:${Math.min(r.pc, 100)}%;background:${PALETTE[i % PALETTE.length]}"></span></div>` : ""}</div>
      <div class="tx-amt" style="text-align:right">${fmt(r.val)}
        ${r.pc != null ? `<div class="tiny muted">${r.pc.toFixed(0)}%</div>` : ""}
        ${r.bal != null ? `<div class="tiny" style="color:${r.bal >= 0 ? "var(--green)" : "var(--red)"}">${r.bal >= 0 ? "+" : ""}${fmt(r.bal)}</div>` : ""}</div>
      ${r.drill ? `<span style="color:var(--sub);margin-left:6px">›</span>` : ""}
    </div>`).join("") : `<div class="muted small" style="padding:16px">Sin datos.</div>`;

  root.innerHTML = tabs + `
    <div class="card mb-3"><div class="small" style="line-height:2">${crumbHtml}</div></div>
    ${detPath.year ? `<div class="grid-kpi mb-3">
      <div class="kpi"><div class="k-label">Ingresos</div><div class="k-val sm" style="color:var(--green)">${fmt(ingresos)}</div></div>
      <div class="kpi"><div class="k-label">Gastos</div><div class="k-val sm">${fmt(gastos)}</div></div>
      <div class="kpi"><div class="k-label">Balance</div><div class="k-val sm" style="color:${balCol}">${fmt(balance)}</div></div>
      <div class="kpi"><div class="k-label">Balance %</div><div class="k-val sm" style="color:${balCol}">${ingresos ? (balance >= 0 ? "+" : "") + pct.toFixed(0) + "%" : "—"}</div></div>
    </div>` : ""}
    <div class="card" style="padding:0">
      <div class="row between" style="padding:10px 12px;border-bottom:1px solid var(--line)">
        <span class="card-title" style="margin:0">${title}</span>${!leaf ? `<span class="tiny muted">toca para ver más</span>` : ""}</div>
      ${rowsHtml}
      ${rows.length && detPath.month ? `<div class="row between" style="padding:11px 12px;border-top:2px solid var(--line);font-weight:700"><span>Total</span><span>${fmt(detPath.cat ? money(txS.filter((t) => t.cat === detPath.cat)) : gastos)}</span></div>` : ""}
    </div>`;

  root.querySelectorAll("[data-tab]").forEach((b) => b.onclick = () => { dashTab = b.getAttribute("data-tab"); renderDashboard(root); });
  root.querySelectorAll(".det-crumb").forEach((c) => c.onclick = () => {
    const lvl = +c.getAttribute("data-lvl");
    if (lvl <= 0) detPath = { year: null, month: null, cat: null };
    else if (lvl === 1) detPath = { year: detPath.year, month: null, cat: null };
    else if (lvl === 2) detPath = { year: detPath.year, month: detPath.month, cat: null };
    renderDashboard(root);
  });
  root.querySelectorAll(".det-drill").forEach((rw) => rw.onclick = () => {
    const key = rw.getAttribute("data-key");
    if (!detPath.year) detPath.year = key;
    else if (!detPath.month) detPath.month = key;
    else if (!detPath.cat) detPath.cat = key;
    renderDashboard(root);
  });
}
