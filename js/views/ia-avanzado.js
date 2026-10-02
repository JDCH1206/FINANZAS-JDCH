// js/views/ia-avanzado.js — tarjetas extra del tablero Avanzado:
//  🚨 gastos inusuales y 📈 proyección de fin de mes (cálculo local, sin IA)
//  ✨ análisis del mes y ❓ pregúntale a tus datos (con IA; las cifras las calcula la app)
import { getState } from "../state.js";
import { fmt, ym, monthLabel, sum, curMonth, todayISO, escapeHtml } from "../utils.js";
import { aiReady, analizarMes, preguntar } from "../ai.js";
import { datosMes } from "./settings.js";

const norm = (x) => String(x || "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ");
const mediana = (a) => { const b = [...a].sort((x, y) => x - y), n = b.length; return n ? (n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2) : 0; };
const diasEn = (m) => new Date(+m.slice(0, 4), +m.slice(5, 7), 0).getDate();
const mesAnt = (m, k = 1) => { const d = new Date(+m.slice(0, 4), +m.slice(5, 7) - 1 - k, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };

/* ---------- 🚨 Gastos inusuales (últimos 45 días) ---------- */
// Un gasto es inusual si cuesta mucho más de lo normal para esa misma descripción
// (≥3 compras previas) o, si es nuevo, para su subcategoría (≥5 gastos previos).
export function gastosInusuales(s, dias = 45) {
  const txs = (s.txs || []).filter((t) => t.date && +t.amount > 0);
  const desde = new Date(Date.now() - dias * 864e5).toISOString().slice(0, 10);
  const porDesc = {}, porSub = {};
  txs.forEach((t) => {
    (porDesc[norm(t.desc)] = porDesc[norm(t.desc)] || []).push(t);
    (porSub[`${t.cat}|${t.sub || ""}`] = porSub[`${t.cat}|${t.sub || ""}`] || []).push(t);
  });
  const out = [];
  txs.filter((t) => t.date >= desde && +t.amount >= 20000).forEach((t) => {
    const antes = (arr) => arr.filter((x) => x.id !== t.id && x.date < t.date).map((x) => +x.amount);
    const d = antes(porDesc[norm(t.desc)] || []);
    if (d.length >= 3) {
      const med = mediana(d);
      if (t.amount >= med * 1.8 && t.amount - med >= 15000) out.push({ t, med, x: t.amount / med, base: `normal para "${t.desc}"` });
      return;
    }
    const sb = antes(porSub[`${t.cat}|${t.sub || ""}`] || []);
    if (sb.length >= 5) {
      const med = mediana(sb);
      if (t.amount >= med * 3 && t.amount - med >= 50000) out.push({ t, med, x: t.amount / med, base: `normal en ${t.sub || t.cat}` });
    }
  });
  return out.sort((a, b) => (b.t.amount - b.med) - (a.t.amount - a.med)).slice(0, 8);
}

/* ---------- 📈 Proyección del mes en curso ---------- */
// Usa cómo se repartió el gasto en los meses anteriores (qué % ya se había gastado a este
// día) para que un arriendo pagado el día 1 no infle la proyección.
export function proyeccionMes(s) {
  const mes = curMonth(), hoy = todayISO(), dia = +hoy.slice(8, 10), D = diasEn(mes);
  const gastoHasta = (m, d) => sum((s.txs || []).filter((t) => ym(t.date) === m && +t.date.slice(8, 10) <= d), (t) => t.amount);
  const gastoMes = (m) => sum((s.txs || []).filter((t) => ym(t.date) === m), (t) => t.amount);
  const ratios = [], totales = [];
  for (let k = 1; k <= 6; k++) {
    const m = mesAnt(mes, k), tot = gastoMes(m);
    if (tot <= 0) continue;
    totales.push(tot);
    if (ratios.length < 3) ratios.push(gastoHasta(m, Math.round(dia / D * diasEn(m))) / tot);
  }
  const va = gastoHasta(mes, dia);
  const r = ratios.length ? mediana(ratios) : dia / D;
  const proy = dia >= D ? va : Math.max(va, r > 0.05 ? va / r : va / (dia / D));
  const ing = sum((s.incomes || []).filter((t) => ym(t.date) === mes), (t) => t.amount);
  const ingProm = mediana([1, 2, 3].map((k) => sum((s.incomes || []).filter((t) => ym(t.date) === mesAnt(mes, k)), (t) => t.amount)).filter((v) => v > 0));
  return { mes, dia, D, va, proy, prom: totales.length ? sum(totales) / totales.length : 0, ing: Math.max(ing, ingProm || 0), conHistoria: ratios.length > 0 };
}

export function avanzadoExtraHtml(s) {
  const inus = gastosInusuales(s), p = proyeccionMes(s);
  const pct = p.prom ? (p.proy / p.prom - 1) * 100 : 0;
  const colorP = p.ing && p.proy > p.ing ? "var(--red)" : pct > 10 ? "var(--orange, #e8890c)" : "var(--green)";
  const meses = [...new Set((s.txs || []).map((t) => ym(t.date)).filter(Boolean))].sort().reverse().slice(0, 24);
  const mesIa = meses.includes(mesAnt(curMonth())) ? mesAnt(curMonth()) : meses[0] || curMonth();
  return `
    <div class="card mb-3">
      <div class="card-title">📈 Proyección de ${escapeHtml(monthLabel(p.mes))}</div>
      <div class="row between small"><span>Llevas gastado (día ${p.dia} de ${p.D})</span><b>${fmt(p.va)}</b></div>
      <div class="row between small mt-1"><span>Si sigues a este ritmo cerrarías en</span><b style="color:${colorP}">${fmt(p.proy)}</b></div>
      ${p.prom ? `<div class="row between tiny muted mt-1"><span>Promedio de tus meses anteriores</span><span>${fmt(p.prom)} (${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%)</span></div>` : ""}
      ${p.ing ? `<div class="row between tiny muted mt-1"><span>Ingreso del mes</span><span>${fmt(p.ing)}</span></div>` : ""}
      <p class="tiny muted mt-2" style="margin-bottom:0">${p.conHistoria ? "Calculado con el ritmo de gasto de tus últimos meses a esta misma altura del mes (los pagos fijos de inicio de mes no inflan la proyección)." : "Aún no hay meses anteriores: se proyecta en línea recta."}${p.ing && p.proy > p.ing ? ` <b style="color:var(--red)">⚠ Gastarías ${fmt(p.proy - p.ing)} más de lo que ingresa.</b>` : ""}</p>
    </div>
    <div class="card mb-3">
      <div class="card-title">🚨 Gastos inusuales (últimos 45 días)</div>
      <p class="tiny muted" style="margin:-4px 0 8px">Gastos que costaron bastante más de lo normal comparado con tus compras anteriores de lo mismo.</p>
      ${inus.map((u) => `<div class="tx-row"><div class="flex1"><div class="tx-desc">${escapeHtml(u.t.desc || u.t.sub || u.t.cat)}</div>
        <div class="tx-meta">${escapeHtml(u.t.date)} · ${escapeHtml(u.base)}: ${fmt(u.med)}</div></div>
        <div class="tx-amt">${fmt(u.t.amount)}<div class="tiny" style="color:var(--red)">×${u.x.toFixed(1)}</div></div></div>`).join("") || '<div class="muted small">Nada fuera de lo normal 👍</div>'}
    </div>
    ${aiReady() ? `
    <div class="card mb-3">
      <div class="row between mb-2" style="align-items:center;gap:8px;flex-wrap:wrap"><div class="card-title" style="margin:0">✨ Análisis del mes con IA</div>
        <div class="row gap-2"><select id="iaan-mes" class="input" style="width:auto">${meses.map((m) => `<option value="${m}" ${m === mesIa ? "selected" : ""}>${escapeHtml(monthLabel(m))}</option>`).join("")}</select>
        <button id="iaan-go" class="btn btn-primary btn-sm">Analizar</button></div></div>
      <div id="iaan-out" class="small"></div>
    </div>
    <div class="card mb-3">
      <div class="card-title">❓ Pregúntale a tus datos</div>
      <p class="tiny muted" style="margin:-4px 0 8px">La IA solo decide qué consultar; las cifras las calcula la app con tus movimientos.</p>
      <div class="row gap-2"><input id="iaq-in" class="input flex1" placeholder="¿Cuánto gasté en domicilios este año?" maxlength="300"><button id="iaq-go" class="btn btn-primary btn-sm">Preguntar</button></div>
      <div class="row gap-2 mt-2" style="flex-wrap:wrap">${["¿En qué gasté más el mes pasado?", "¿Cuánto llevo en gasolina este año?", "Compara mis gastos de este mes con el anterior", "¿Cuál fue mi compra más grande del año?"].map((q) => `<button class="chip" data-iaq="${escapeHtml(q)}" style="font-size:11.5px">${escapeHtml(q)}</button>`).join("")}</div>
      <div id="iaq-out" class="small mt-2"></div>
    </div>` : ""}`;
}

/* ---------- ✨ Análisis del mes (con caché por mes) ---------- */
const CACHE_KEY = "fz_ia_analisis";
const leerCache = () => { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}"); } catch { return {}; } };
const firmaMes = (s, m) => { const t = (s.txs || []).filter((x) => ym(x.date) === m), i = (s.incomes || []).filter((x) => ym(x.date) === m); return `${t.length}:${sum(t, (x) => x.amount)}:${i.length}:${sum(i, (x) => x.amount)}`; };

function pintarAnalisis(out, a, mes, viejo) {
  out.innerHTML = `${viejo ? `<p class="tiny muted">Guardado ${escapeHtml(viejo)} · <a href="#" id="iaan-re">volver a analizar</a></p>` : ""}
    <p style="line-height:1.45">${escapeHtml(a.resumen)}</p>
    ${a.hallazgos.map((h) => `<div style="margin:6px 0;line-height:1.4"><b>${h.tipo === "bien" ? "✅" : h.tipo === "alerta" ? "⚠️" : "ℹ️"} ${escapeHtml(h.titulo)}.</b> ${escapeHtml(h.detalle || "")}</div>`).join("")}
    ${a.recomendaciones.length ? `<div class="mt-2"><b>Para ${escapeHtml(monthLabel(mesAnt(mes, -1)))}:</b><ul style="margin:4px 0 0 18px;padding:0">${a.recomendaciones.map((r) => `<li style="margin:3px 0">${escapeHtml(r)}</li>`).join("")}</ul></div>` : ""}
    <p class="tiny muted mt-2" style="margin-bottom:0">Generado con IA (${escapeHtml(a.model || "")}). Revisa antes de tomar decisiones.</p>`;
}

/* ---------- ❓ Herramientas que la IA puede llamar (todo se calcula aquí) ---------- */
function herramientas(s) {
  const rango = (a) => { const desde = a.desde || "0000-01-01", hasta = a.hasta || "9999-12-31"; return (t) => t.date >= desde && t.date <= hasta; };
  const filtro = (a) => {
    const enR = rango(a), c = norm(a.categoria), sb = norm(a.subcategoria), tx = norm(a.texto), et = norm(a.etiqueta);
    return (s.txs || []).filter((t) => enR(t) && (!c || norm(t.cat) === c) && (!sb || norm(t.sub) === sb)
      && (!tx || norm(t.desc).includes(tx)) && (!et || (t.tags || []).some((g) => norm(g).replace(/^#/, "") === et.replace(/^#/, ""))));
  };
  const corto = (t) => ({ fecha: t.date, descripcion: t.desc, valor: +t.amount, categoria: t.cat, subcategoria: t.sub || "", etiquetas: t.tags || [] });
  return {
    totalGastos: (a) => { const l = filtro(a); return { total: sum(l, (t) => t.amount), cantidad: l.length }; },
    gastosPorCategoria: (a) => {
      const o = {}; filtro(a).forEach((t) => { const k = a.porSubcategoria ? `${t.cat} › ${t.sub || "—"}` : t.cat; o[k] = (o[k] || 0) + (+t.amount || 0); });
      return Object.entries(o).sort((x, y) => y[1] - x[1]).slice(0, 25).map(([k, v]) => ({ nombre: k, total: v }));
    },
    gastosPorDescripcion: (a) => {
      const o = {}; filtro(a).forEach((t) => { const k = (t.desc || "").trim(); const g = o[k] || (o[k] = { descripcion: k, veces: 0, total: 0 }); g.veces++; g.total += +t.amount || 0; });
      return Object.values(o).sort((x, y) => y.total - x.total).slice(0, 20);
    },
    topGastos: (a) => filtro(a).sort((x, y) => y.amount - x.amount).slice(0, Math.min(+a.n || 5, 20)).map(corto),
    buscarMovimientos: (a) => { const l = filtro(a).sort((x, y) => (x.date < y.date ? 1 : -1)); return { cantidad: l.length, total: sum(l, (t) => t.amount), ultimos: l.slice(0, 15).map(corto) }; },
    totalIngresos: (a) => {
      const enR = rango(a), tp = norm(a.tipo);
      const l = (s.incomes || []).filter((i) => enR(i) && (!tp || norm(i.type) === tp));
      const o = {}; l.forEach((i) => { o[i.type || "Otro"] = (o[i.type || "Otro"] || 0) + (+i.amount || 0); });
      return { total: sum(l, (i) => i.amount), cantidad: l.length, porTipo: o };
    },
    resumenMensual: (a) => {
      const enR = rango(a), o = {};
      (s.txs || []).filter(enR).forEach((t) => { const m = ym(t.date); (o[m] = o[m] || { mes: m, gastos: 0, ingresos: 0 }).gastos += +t.amount || 0; });
      (s.incomes || []).filter(enR).forEach((t) => { const m = ym(t.date); (o[m] = o[m] || { mes: m, gastos: 0, ingresos: 0 }).ingresos += +t.amount || 0; });
      return Object.values(o).sort((x, y) => (x.mes < y.mes ? -1 : 1)).slice(-24).map((r) => ({ ...r, sobrante: r.ingresos - r.gastos }));
    },
    saldosCuentas: () => (s.accounts || []).map((c) => ({ cuenta: c.name, saldo: +c.balance || 0 })),
  };
}

function declaraciones(S) {
  const filtros = {
    desde: S.string({ description: "Fecha inicial YYYY-MM-DD (incluida)" }),
    hasta: S.string({ description: "Fecha final YYYY-MM-DD (incluida)" }),
    categoria: S.string({ description: "Nombre exacto de la categoría" }),
    subcategoria: S.string({ description: "Nombre exacto de la subcategoría" }),
    texto: S.string({ description: "Texto contenido en la descripción (ej. coca cola)" }),
    etiqueta: S.string({ description: "Etiqueta sin # (ej. viaje)" }),
  };
  const obj = (props, opt) => S.object({ properties: props, optionalProperties: opt || Object.keys(props) });
  const rango = { desde: filtros.desde, hasta: filtros.hasta };
  return [
    { name: "totalGastos", description: "Suma y cantidad de gastos con filtros opcionales.", parameters: obj(filtros) },
    { name: "gastosPorCategoria", description: "Total de gastos agrupado por categoría (o por subcategoría), de mayor a menor.", parameters: obj({ ...filtros, porSubcategoria: S.boolean() }) },
    { name: "gastosPorDescripcion", description: "Gastos agrupados por descripción (veces y total), de mayor a menor.", parameters: obj(filtros) },
    { name: "topGastos", description: "Los gastos individuales más grandes.", parameters: obj({ ...filtros, n: S.integer({ description: "Cuántos (máx 20)" }) }) },
    { name: "buscarMovimientos", description: "Busca gastos y devuelve cantidad, total y los 15 más recientes.", parameters: obj(filtros) },
    { name: "totalIngresos", description: "Suma de ingresos (con desglose por tipo).", parameters: obj({ ...rango, tipo: S.string({ description: "Tipo de ingreso" }) }) },
    { name: "resumenMensual", description: "Ingresos, gastos y sobrante por mes.", parameters: obj(rango) },
    { name: "saldosCuentas", description: "Saldo actual de cada cuenta de ahorro/inversión." },
  ];
}

export function wireAvanzadoExtra(root) {
  const go = root.querySelector("#iaan-go");
  if (go) {
    const sel = root.querySelector("#iaan-mes"), out = root.querySelector("#iaan-out");
    const mostrarCache = () => {
      const s = getState(), m = sel.value, c = leerCache()[m];
      if (c && c.firma === firmaMes(s, m)) { pintarAnalisis(out, c.a, m, c.fecha); const re = out.querySelector("#iaan-re"); if (re) re.onclick = (e) => { e.preventDefault(); correr(); }; }
      else out.innerHTML = "";
    };
    const correr = async () => {
      const s = getState(), m = sel.value;
      go.disabled = true; out.innerHTML = '<div class="muted">✨ Analizando… (puede tardar unos segundos)</div>';
      try {
        const a = await analizarMes(datosMes(s, m));
        const c = leerCache(); c[m] = { a, firma: firmaMes(s, m), fecha: new Date().toLocaleDateString("es-CO") };
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch { /* sin espacio */ }
        pintarAnalisis(out, a, m, "");
      } catch (e) { out.innerHTML = `<div style="color:var(--red)">${escapeHtml(e.message || String(e))}</div>`; }
      go.disabled = false;
    };
    sel.onchange = mostrarCache; go.onclick = correr; mostrarCache();
  }
  const qb = root.querySelector("#iaq-go");
  if (qb) {
    const inp = root.querySelector("#iaq-in"), out = root.querySelector("#iaq-out");
    const ask = async () => {
      const q = inp.value.trim(); if (!q) return;
      const s = getState();
      qb.disabled = true; out.innerHTML = '<div class="muted">🔎 Consultando tus datos…</div>';
      const meses = [...new Set((s.txs || []).map((t) => t.date).filter(Boolean))].sort();
      const ctx = `HOY es ${todayISO()} (el año va de enero a diciembre). Hay datos desde ${meses[0] || "—"} hasta ${meses[meses.length - 1] || "—"}.
Categorías y subcategorías: ${s.cats.map((c) => `${c.name} [${(c.subs || []).join(", ")}]`).join("; ")}.
Tipos de ingreso: ${[...new Set((s.incomes || []).map((i) => i.type).filter(Boolean))].join(", ")}.
Si la pregunta habla de una cosa concreta (ej. "domicilios", "gasolina") que coincide con una categoría o subcategoría, filtra por ella; si no, busca por texto en la descripción. Formatea los montos como $1.234.567.`;
      try {
        const r = await preguntar(q, herramientas(s), declaraciones, ctx);
        out.innerHTML = `<div style="white-space:pre-wrap;line-height:1.45">${escapeHtml(r.texto || "Sin respuesta")}</div>
          <p class="tiny muted mt-1" style="margin-bottom:0">Consultas: ${escapeHtml(r.funciones.join(", ") || "ninguna")} · ${escapeHtml(r.model)}</p>`;
      } catch (e) { out.innerHTML = `<div style="color:var(--red)">${escapeHtml(e.message || String(e))}</div>`; }
      qb.disabled = false;
    };
    qb.onclick = ask;
    inp.onkeydown = (e) => { if (e.key === "Enter") ask(); };
    root.querySelectorAll("[data-iaq]").forEach((b) => b.onclick = () => { inp.value = b.getAttribute("data-iaq"); ask(); });
  }
}
