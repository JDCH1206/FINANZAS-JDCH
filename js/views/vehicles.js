// js/views/vehicles.js — Módulo de Vehículos (Fase 1: registro · Fase 2: combustible)
import { getState, setState } from "../state.js";
import { saveConfig, forcePersistLocal, loadFuel, addFuel, deleteFuel, bulkSetFuel, persistFuelLocal, loadMaint, addMaint, bulkAddMaint, deleteMaint, updateMaint, persistMaintLocal, addTx, deleteTx, bulkUpdateTx, loadOblig, addOblig, bulkAddOblig, deleteOblig, persistObligLocal } from "../firebase-service.js";
import { VEHICLE_TYPES, FUEL_TYPES, SERVICE_TYPES, DEPARTAMENTOS, PALETTE, MAINT_CATEGORIES, MAINT_TIPOS, suggestMaintTipo, OBLIG_TIPOS, AVISO_DIAS, DEFAULT_PAY_METHODS } from "../config.js";
import { uid, escapeHtml, fmt, todayISO, ym, monthLabel, sum, curMonth, isoLocal } from "../utils.js";
import { openModal, closeModal, toast, confirmDialog, submitOnce, moneyPreview } from "../components/modals.js";
import { donut, lineTrend, lineNum, multiLine } from "../components/charts.js";

const icon = (t) => (t === "Moto" ? "🏍️" : "🚗");
let activeFuelVid = null;   // si está fijo, mostramos la bitácora de ese vehículo
let activeMaintVid = null;  // bitácora de mantenimiento
let activeObligVid = null;  // obligaciones legales
let allFuel = [];           // cache de todos los tanqueos (todos los vehículos)
let allMaint = [];          // cache de mantenimientos
let allOblig = [];          // cache de obligaciones

const obligLabel = (k) => (OBLIG_TIPOS.find((t) => t.key === k) || {}).label || k;
function obligStatus(o, today) {
  if (o.estado === "TRAMITE") return { st: "tramite", lbl: "trámite en curso", color: "var(--blue)", dot: "🔵" };
  if (!o.fechaVencimiento) return { st: "vigente", lbl: "sin fecha", color: "var(--sub)", dot: "⚪" };
  const dias = daysBetween(today, o.fechaVencimiento), umbral = o.diasAviso || 30;
  if (dias < 0) return { st: "vencido", lbl: `vencido hace ${-dias} días`, color: "var(--red)", dot: "🔴" };
  if (dias === 0) return { st: "vencido", lbl: "vence hoy", color: "var(--red)", dot: "🔴" };
  if (dias <= umbral) return { st: "porvencer", lbl: `vence en ${dias} días`, color: "var(--yel)", dot: "🟡" };
  return { st: "vigente", lbl: `vigente · ${dias} días`, color: "var(--green)", dot: "🟢" };
}

function addDays(iso, days) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}
function daysBetween(a, b) {
  if (!a || !b) return null;
  return Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);
}

function ymAdd(key, delta) {
  if (!key) return "";
  const [y, m] = key.split("-").map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}
function kpiDelta(label, cur, base) {
  if (!base) return kpi(label, "—", true);
  const d = ((cur - base) / base) * 100, up = d >= 0;
  return `<div class="kpi"><div class="k-label">${label}</div><div class="k-val sm" style="color:${up ? "var(--red)" : "var(--green)"}">${up ? "▲" : "▼"} ${Math.abs(d).toFixed(0)}%</div><div class="tiny muted">base ${fmt(base)}</div></div>`;
}

async function persistVehicles() {
  const s = getState();
  await saveConfig(s.user.uid, { profile: s.profile, cats: s.cats, budgets: s.budgets, accounts: s.accounts, payMethods: s.payMethods, vehicles: s.vehicles, vehiclesEnabled: s.vehiclesEnabled, goals: s.goals });
  forcePersistLocal(s.user.uid);
}

// el odómetro del vehículo = el del tanqueo MÁS RECIENTE reportado (refleja lo último que reportas)
async function syncVehicleOdo(v) {
  const fuel = allFuel.filter((r) => r.vehicleId === v.id);
  if (!fuel.length) return;
  const latest = fuel.reduce((m, r) => (!m || (r.fecha || "") > m.fecha || ((r.fecha || "") === m.fecha && (+r.odometro || 0) > (+m.odometro || 0)) ? r : m), null);
  const newOdo = +latest.odometro || 0;
  if (newOdo !== (v.odometro || 0)) {
    setState({ vehicles: getState().vehicles.map((x) => (x.id === v.id ? { ...x, odometro: newOdo } : x)) });
    v.odometro = newOdo; await persistVehicles();
  }
}

export function renderVehicles(root) {
  if (activeObligVid) return renderOblig(root, activeObligVid);
  if (activeMaintVid) return renderMaint(root, activeMaintVid);
  if (activeFuelVid) return renderFuel(root, activeFuelVid);
  renderList(root);
}

/* ===================== LISTA / REGISTRO ===================== */
async function renderList(root) {
  const s = getState();
  root.innerHTML = `
    <h2 class="page-title disp">Vehículos</h2>
    <p class="page-sub">Tus vehículos: moto, carro o varios</p>
    <div id="oblig-alert"></div>
    <button id="add-veh" class="btn btn-primary btn-block mb-4">+ Agregar vehículo</button>
    <div id="veh-list"></div>`;
  root.querySelector("#add-veh").onclick = () => openVehicleModal(null, root);
  drawList(root);
  allOblig = await loadOblig(s.user.uid);
  drawObligAlert(root);
}

function drawObligAlert(root) {
  const el = root.querySelector("#oblig-alert"); if (!el) return;
  const today = todayISO();
  const vmap = Object.fromEntries((getState().vehicles || []).map((v) => [v.id, v]));
  const pend = allOblig.map((o) => ({ o, v: vmap[o.vehicleId], st: obligStatus(o, today) })).filter((x) => x.v && (x.st.st === "vencido" || x.st.st === "porvencer"));
  pend.sort((a, b) => (a.st.st === "vencido" ? 0 : 1) - (b.st.st === "vencido" ? 0 : 1));
  if (!pend.length) { el.innerHTML = ""; return; }
  el.innerHTML = `<div class="card mb-3" style="border:1px solid var(--yel)">
    <div class="card-title">⏰ Próximos vencimientos</div>
    ${pend.map((p) => `<div class="row between" style="padding:6px 0;border-top:1px solid var(--line)">
      <span class="small">${p.st.dot} ${escapeHtml(obligLabel(p.o.tipo))} · ${escapeHtml(p.v.alias || p.v.modelo)}</span>
      <span class="small bold" style="color:${p.st.color}">${p.st.lbl}</span></div>`).join("")}</div>`;
}

function drawList(root) {
  const vs = getState().vehicles || [];
  const list = root.querySelector("#veh-list");
  if (!vs.length) {
    list.innerHTML = `<div class="empty"><p>Aún no tienes vehículos. Toca "+ Agregar vehículo" para registrar tu moto o carro.<br>Puedes empezar desde hoy: no necesitas ningún historial.</p></div>`;
    return;
  }
  list.innerHTML = vs.map((v) => `
    <div class="card mb-3">
      <div class="row between" style="align-items:flex-start">
        <div class="row gap-2" style="align-items:center">
          <span style="font-size:22px">${icon(v.tipo)}</span>
          <div><div class="card-title" style="margin:0">${escapeHtml(v.alias || v.modelo || v.tipo)}</div>
          <div class="tiny muted">${escapeHtml(v.tipo)}${v.placa ? " · " + escapeHtml(v.placa) : ""}</div></div>
        </div>
        <div class="row gap-2">
          <button class="icon-btn" data-edit="${v.id}" title="Editar"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg></button>
          <button class="icon-btn" data-del="${v.id}" title="Eliminar"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2m-9 0v14h10V6"/></svg></button>
        </div>
      </div>
      <div class="tiny muted mt-2">${[v.marca, v.modelo, v.anio].filter(Boolean).map(escapeHtml).join(" · ")}${v.cc ? " · " + escapeHtml(String(v.cc)) + "cc" : ""}${v.combustible ? " · " + escapeHtml(v.combustible) : ""}</div>
      <div class="row between mt-2" style="border-top:1px solid var(--line);padding-top:8px">
        <span class="small muted">Odómetro</span><span class="small bold">${v.odometro != null ? Number(v.odometro).toLocaleString("es-CO") + " km" : "—"}</span>
      </div>
      <div class="row between mt-1" data-bd="${v.id}" style="cursor:pointer">
        <span class="small muted">Gasto asociado a este vehículo ›</span><span class="small bold" style="color:var(--gold)">${fmt(sum(getState().txs.filter((t) => t.vehicleId === v.id), (t) => t.amount))}</span>
      </div>
      <div class="row gap-2 mt-3 wrap">
        <button class="btn btn-ghost btn-sm flex1" data-fuel="${v.id}">⛽ Combustible</button>
        <button class="btn btn-ghost btn-sm flex1" data-maint="${v.id}">🔧 Mantenimiento</button>
        <button class="btn btn-ghost btn-sm flex1" data-oblig="${v.id}">📋 Obligaciones</button>
      </div>
    </div>`).join("");

  list.querySelectorAll("[data-oblig]").forEach((b) => b.onclick = () => { activeFuelVid = null; activeMaintVid = null; activeObligVid = b.getAttribute("data-oblig"); renderOblig(root, activeObligVid); });
  list.querySelectorAll("[data-maint]").forEach((b) => b.onclick = () => { activeFuelVid = null; activeObligVid = null; activeMaintVid = b.getAttribute("data-maint"); renderMaint(root, activeMaintVid); });
  list.querySelectorAll("[data-edit]").forEach((b) => b.onclick = () => openVehicleModal(getState().vehicles.find((x) => x.id === b.getAttribute("data-edit")), root));
  list.querySelectorAll("[data-del]").forEach((b) => b.onclick = () => confirmDialog("¿Eliminar este vehículo?", async () => {
    setState({ vehicles: getState().vehicles.filter((x) => x.id !== b.getAttribute("data-del")) });
    await persistVehicles(); drawList(root); toast("Vehículo eliminado");
  }));
  list.querySelectorAll("[data-fuel]").forEach((b) => b.onclick = () => { activeMaintVid = null; activeObligVid = null; activeFuelVid = b.getAttribute("data-fuel"); renderFuel(root, activeFuelVid); });
  list.querySelectorAll("[data-bd]").forEach((b) => b.onclick = () => openVehicleBreakdown(getState().vehicles.find((x) => x.id === b.getAttribute("data-bd"))));
}

// Desglose del "gasto asociado" de un vehículo: Combustible · Mantenimiento · Lavado · Obligaciones · Otros.
// Clasifica cada gasto etiquetado a este vehículo por su vínculo (fuel/maint/oblig) o por su descripción.
function openVehicleBreakdown(v) {
  if (!v) return;
  const txs = getState().txs.filter((t) => t.vehicleId === v.id);
  const order = ["Combustible", "Mantenimiento", "Lavado", "Obligaciones", "Otros"];
  const buck = Object.fromEntries(order.map((k) => [k, 0]));
  const cnt = Object.fromEntries(order.map((k) => [k, 0]));
  txs.forEach((t) => {
    let k;
    if (t.fuelId) k = "Combustible";
    else if (t.maintId || t.visitaId) k = "Mantenimiento";
    else if (t.obligId) k = "Obligaciones";
    // criterio principal: subcategoría exacta "Lavado"; respaldo: la palabra en subcategoría/descripción
    else if (t.sub === "Lavado" || /lavad/i.test((t.sub || "") + " " + (t.desc || ""))) k = "Lavado";
    else k = "Otros";
    buck[k] += (+t.amount || 0); cnt[k]++;
  });
  const total = sum(order.map((k) => buck[k]));
  const rows = order.filter((k) => buck[k] > 0);
  const body = total ? `
    <div class="kpi mb-3" style="background:linear-gradient(135deg,#1d272c,#161e22)">
      <div class="k-label">Total asociado a ${escapeHtml(v.alias || v.modelo || v.tipo)}</div><div class="k-val">${fmt(total)}</div>
      <div class="tiny muted" style="margin-top:3px">${txs.length} movimiento${txs.length === 1 ? "" : "s"}</div></div>
    <div class="chart-box" style="height:190px"><canvas id="ch-vbd"></canvas></div>
    <div class="mt-2">${rows.map((k, i) => `
      <div class="dane-row"><span class="muted"><span style="display:inline-block;width:9px;height:9px;border-radius:3px;background:${PALETTE[i % PALETTE.length]};margin-right:5px"></span>${k} <span class="tiny muted">(${cnt[k]})</span></span>
        <div class="bar" style="height:7px"><span style="width:${(buck[k] / total) * 100}%;background:${PALETTE[i % PALETTE.length]}"></span></div>
        <span style="text-align:right">${fmt(buck[k])} <span class="muted">${((buck[k] / total) * 100).toFixed(0)}%</span></span></div>`).join("")}</div>
    <p class="tiny muted mt-3">Combustible y Mantenimiento salen de sus bitácoras; Lavado se detecta por la descripción; el resto (peajes, accesorios…) va en Otros.</p>`
    : `<div class="muted small">Aún no hay gastos asociados a este vehículo. Al registrar un gasto, asócialo al vehículo para verlo aquí.</div>`;
  openModal(`Desglose · ${escapeHtml(v.alias || v.modelo || v.tipo)}`, body, {
    onMount() { if (total) donut("ch-vbd", rows, rows.map((k) => buck[k])); },
  });
}

function openVehicleModal(v, root) {
  const sel = (id, opts, val) => `<select id="${id}" class="input">${opts.map((o) => `<option ${o === val ? "selected" : ""}>${escapeHtml(o)}</option>`).join("")}</select>`;
  const selDept = (val) => `<select id="v-dept" class="input"><option value="">— sin especificar —</option>${DEPARTAMENTOS.map((d) => `<option ${d === val ? "selected" : ""}>${escapeHtml(d)}</option>`).join("")}</select>`;
  const f = (label, html) => `<div class="field"><label class="label">${label}</label>${html}</div>`;
  const inp = (id, val = "", type = "text", ph = "") => `<input id="${id}" class="input" type="${type}" value="${val != null ? escapeHtml(String(val)) : ""}" placeholder="${ph}">`;
  openModal(v ? "Editar vehículo" : "Nuevo vehículo", `
    ${f("Tipo", sel("v-tipo", VEHICLE_TYPES, v?.tipo || "Moto"))}
    ${f("Alias / nombre *", inp("v-alias", v?.alias, "text", "Ej: Moto roja"))}
    ${f("Placa *", inp("v-placa", v?.placa, "text", "ABC123"))}
    ${f("Marca *", inp("v-marca", v?.marca, "text", "Ej: Bajaj"))}
    ${f("Modelo / línea *", inp("v-modelo", v?.modelo, "text", "Ej: Pulsar NS 200"))}
    ${f("Año *", inp("v-anio", v?.anio, "number", "2022"))}
    ${f("Odómetro actual (km) *", inp("v-odo", v?.odometro, "number", "0"))}
    ${f("Cilindraje (c.c.)", inp("v-cc", v?.cc, "number", "Ej: 250"))}
    ${f("Tipo de combustible", sel("v-comb", FUEL_TYPES, v?.combustible || "Corriente"))}
    ${f("Fecha de matrícula (opcional)", inp("v-matricula", v?.fechaMatricula, "date"))}
    ${f("Departamento de matrícula", selDept(v?.departamento))}
    ${f("Servicio", sel("v-serv", SERVICE_TYPES, v?.servicio || "Particular"))}
    ${f("Capacidad del tanque (gal)", inp("v-tanque", v?.capacidadTanque, "number", "Ej: 3"))}
    ${f("Color", inp("v-color", v?.color))}
    ${f("N° de motor / chasis (VIN)", inp("v-vin", v?.motorChasis))}
    ${f("Aseguradora", inp("v-aseg", v?.aseguradora))}
    ${f("N° de póliza", inp("v-poliza", v?.poliza))}
    ${f("URL de foto (opcional)", inp("v-foto", v?.foto, "url", "https://..."))}
    <button id="v-save" class="btn btn-primary btn-block mt-2">${v ? "Guardar cambios" : "Crear vehículo"}</button>`, {
    onMount(b) {
      submitOnce(b.querySelector("#v-save"), async () => {
        const get = (id) => b.querySelector("#" + id).value.trim();
        const num = (id) => { const x = b.querySelector("#" + id).value; return x === "" ? null : +x; };
        const data = {
          id: v?.id || uid(), tipo: b.querySelector("#v-tipo").value,
          alias: get("v-alias"), placa: get("v-placa").toUpperCase(), marca: get("v-marca"),
          modelo: get("v-modelo"), anio: num("v-anio"), odometro: num("v-odo"), cc: num("v-cc"),
          combustible: b.querySelector("#v-comb").value, fechaMatricula: b.querySelector("#v-matricula").value || "",
          departamento: b.querySelector("#v-dept").value, servicio: b.querySelector("#v-serv").value,
          capacidadTanque: num("v-tanque"), color: get("v-color"), motorChasis: get("v-vin"),
          aseguradora: get("v-aseg"), poliza: get("v-poliza"), foto: get("v-foto"),
          cruzarConGastos: v?.cruzarConGastos || false,
        };
        if (!data.alias || !data.placa || !data.marca || !data.modelo || !data.anio || data.odometro == null) return toast("Completa los campos obligatorios (*)", true);
        const list = getState().vehicles || [];
        setState({ vehicles: v ? list.map((x) => (x.id === data.id ? data : x)) : [...list, data] });
        await persistVehicles(); closeModal(); drawList(root); toast(v ? "Vehículo actualizado" : "Vehículo creado");
      });
    },
  });
}

/* ===================== COMBUSTIBLE ===================== */
async function renderFuel(root, vid) {
  const s = getState();
  const v = (s.vehicles || []).find((x) => x.id === vid);
  if (!v) { activeFuelVid = null; return renderList(root); }
  root.innerHTML = `<div style="min-height:50vh;display:grid;place-items:center"><div class="loader spin"></div></div>`;
  allFuel = await loadFuel(s.user.uid);
  drawFuel(root, v);
}

// rendimiento entre tanqueos llenos (método B): distancia / galones acumulados desde el último lleno
function computeMetrics(fuel) {
  const sorted = [...fuel].sort((a, b) => (a.odometro || 0) - (b.odometro || 0) || (a.fecha || "").localeCompare(b.fecha || ""));
  let lastOdo = null, galAcc = 0, costAcc = 0;
  const points = [], byId = {};
  for (const r of sorted) {
    galAcc += +r.galones || 0; costAcc += +r.costo || 0;
    const lleno = r.tanqueLleno === "Sí" || r.tanqueLleno === true;
    if (lleno) {
      if (lastOdo != null && r.odometro > lastOdo && galAcc > 0) {
        const dist = r.odometro - lastOdo, rend = dist / galAcc;
        points.push({ fecha: r.fecha, rend, dist, gal: galAcc });
        byId[r.id] = { rend, dist, costoKm: costAcc ? costAcc / dist : null };
      }
      lastOdo = r.odometro; galAcc = 0; costAcc = 0;
    }
  }
  const distTot = sum(points, (p) => p.dist), galTot = sum(points, (p) => p.gal);
  return { sorted, points, byId, rendAvg: galTot ? distTot / galTot : 0, distTot };
}

function drawFuel(root, v) {
  const fuel = allFuel.filter((r) => r.vehicleId === v.id);
  const m = computeMetrics(fuel);
  const costoTot = sum(fuel, (r) => +r.costo || 0);
  const galTot = sum(fuel, (r) => +r.galones || 0);
  const costoKm = m.distTot ? costoTot / m.distTot : 0;
  const valorGal = galTot ? costoTot / galTot : 0; // valor promedio por galón
  const months = {}; fuel.forEach((r) => { const k = ym(r.fecha); if (k) months[k] = (months[k] || 0) + (+r.costo || 0); });
  const mKeys = Object.keys(months).sort();
  const gastoMes = mKeys.length ? costoTot / mKeys.length : 0;
  const byEst = {}; fuel.forEach((r) => { const e = r.estacion || "—"; byEst[e] = (byEst[e] || 0) + (+r.costo || 0); });
  const estE = Object.entries(byEst).sort((a, b) => b[1] - a[1]);
  const curM = curMonth(), prevM = ymAdd(curM, -1);
  const mesActual = months[curM] || 0, mesPasado = months[prevM] || 0;
  const last12 = mKeys.slice(-12);
  const avg12 = last12.length ? sum(last12.map((k) => months[k])) / last12.length : 0;

  root.innerHTML = `
    <div class="row gap-2 mb-3" style="align-items:center">
      <button id="back" class="icon-btn" title="Volver"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg></button>
      <div><div class="page-title disp" style="font-size:21px;margin:0">⛽ Combustible</div><div class="tiny muted">${icon(v.tipo)} ${escapeHtml(v.alias || v.modelo)} · ${Number(v.odometro || 0).toLocaleString("es-CO")} km</div></div>
    </div>
    <div class="row gap-2 wrap mb-3">
      <button id="add-fuel" class="btn btn-primary btn-sm">+ Tanqueo</button>
      <input id="imp-fuel" type="file" accept=".xlsx,.xls" hidden>
      <button id="imp-fuel-btn" class="btn btn-ghost btn-sm">⬆ Importar Excel</button>
      <input id="imp-fuel-json" type="file" accept=".json,application/json" hidden>
      <button id="imp-fuel-json-btn" class="btn btn-ghost btn-sm">⬆ Importar JSON</button>
      <button id="adj-odo-btn" class="btn btn-ghost btn-sm">⚙ Odómetro real</button>
      <button id="exp-xls" class="btn btn-ghost btn-sm">⬇ Excel</button>
      <button id="exp-json" class="btn btn-ghost btn-sm">⬇ JSON</button>
    </div>

    <div class="grid-kpi mb-4">
      ${kpi("Rendimiento prom.", m.rendAvg ? m.rendAvg.toFixed(1) + " km/gal" : "—")}
      ${kpi("Costo por km", m.distTot ? fmt(costoKm) : "—")}
      ${kpi("Gasto total", fmt(costoTot))}
      ${kpi("Gasto/mes prom.", mKeys.length ? fmt(gastoMes) : "—", true)}
      ${kpi("Galones total", galTot.toFixed(1))}
      ${kpi("Valor prom./galón", galTot ? fmt(valorGal) : "—")}
      ${kpi("Tanqueos", fuel.length, true)}
    </div>

    <div class="grid-kpi mb-4">
      ${kpi("Combustible mes actual", fmt(mesActual))}
      ${kpiDelta("vs mes pasado", mesActual, mesPasado)}
      ${kpiDelta("vs prom. 12m", mesActual, avg12)}
    </div>

    ${fuel.length ? `<div class="grid-cards">
      <div class="card col-span"><div class="card-title">Rendimiento por tanqueo (km/galón)</div><div class="chart-box"><canvas id="ch-rend"></canvas></div></div>
      <div class="card col-span"><div class="card-title">Gasto mensual en combustible</div><div class="chart-box"><canvas id="ch-mes"></canvas></div></div>
      <div class="card col-span"><div class="card-title">Precio por galón en el tiempo (por tipo)</div><div class="chart-box"><canvas id="ch-pgal"></canvas></div><p class="tiny muted mt-2">Precio por galón (costo ÷ galones) promedio por mes, separado por tipo (Extra/Corriente/…).</p></div>
      <div class="card"><div class="card-title">Gasto por estación</div><div class="chart-box"><canvas id="ch-est"></canvas></div><div id="leg-est" class="row wrap gap-2 mt-2"></div></div>
    </div>
    <div class="card mt-3" style="padding:0" id="fuel-list"></div>`
    : `<div class="empty"><p>Sin tanqueos aún. Toca "+ Tanqueo" para registrar, o "Importar Excel/JSON" para cargar tu histórico.</p></div>`}`;

  root.querySelector("#back").onclick = () => { activeFuelVid = null; renderList(root); };
  root.querySelector("#add-fuel").onclick = () => openFuelModal(v, root);
  const imp = root.querySelector("#imp-fuel");
  root.querySelector("#imp-fuel-btn").onclick = () => imp.click();
  imp.onchange = () => importFuelXlsx(v, root, imp);
  const impJ = root.querySelector("#imp-fuel-json");
  root.querySelector("#imp-fuel-json-btn").onclick = () => impJ.click();
  impJ.onchange = () => importFuelJson(v, root, impJ);
  root.querySelector("#exp-json").onclick = () => exportJson(v, fuel);
  root.querySelector("#exp-xls").onclick = () => exportXlsx(v, fuel);
  root.querySelector("#adj-odo-btn").onclick = () => openAdjustOdoModal(v, root);

  if (fuel.length) {
    lineNum("ch-rend", m.points.map((p) => p.fecha), m.points.map((p) => +p.rend.toFixed(1)), "#7fbf7f", "");
    lineTrend("ch-mes", mKeys.map((k) => monthLabel(k)), mKeys.map((k) => Math.round(months[k])));
    // precio por galón por tipo de combustible, promedio mensual (últimos 24 meses)
    const byType = {};
    fuel.forEach((r) => { const g = +r.galones || 0, c = +r.costo || 0, k = ym(r.fecha); if (g <= 0 || c <= 0 || !k) return; const t = r.tipoCombustible || "—"; (byType[t] = byType[t] || {}); (byType[t][k] = byType[t][k] || []).push(c / g); });
    const pMonths = [...new Set(Object.values(byType).flatMap((o) => Object.keys(o)))].sort().slice(-24);
    const pColors = { Corriente: "#d8a657", Extra: "#5a8fb0", "Diésel": "#7fbf7f", Gas: "#c98bb9" };
    const pSeries = Object.keys(byType).map((t, i) => ({ label: t, color: pColors[t] || PALETTE[i % PALETTE.length], data: pMonths.map((k) => { const a = byType[t][k]; return a ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null; }) }));
    if (pSeries.length) multiLine("ch-pgal", pMonths.map((k) => monthLabel(k)), pSeries);
    donut("ch-est", estE.map((e) => e[0]), estE.map((e) => e[1]));
    root.querySelector("#leg-est").innerHTML = estE.map((e, i) => `<span class="tiny muted row gap-1"><span style="width:9px;height:9px;border-radius:3px;background:${PALETTE[i % PALETTE.length]}"></span>${escapeHtml(e[0])} ${fmt(e[1])}</span>`).join("");
    drawFuelList(root, v, m);
  }
}

function drawFuelList(root, v, m) {
  const rows = [...m.sorted].reverse().slice(0, 300);
  root.querySelector("#fuel-list").innerHTML = rows.map((r) => {
    const info = m.byId[r.id];
    // muestra la distancia recorrida en el tramo (desde el último tanque lleno) en vez del $/km
    const extra = info ? ` · ${info.rend.toFixed(1)} km/gal · tramo ${Number(info.dist).toLocaleString("es-CO")} km` : "";
    // valor por galón de este tanqueo (costo ÷ galones)
    const vpg = (+r.galones) ? (+r.costo) / (+r.galones) : 0;
    const vpgTxt = vpg ? ` · ${fmt(vpg)}/gal` : "";
    return `<div class="tx-row" data-rowf="${r.id}" style="cursor:pointer">
      <div class="flex1"><div class="tx-desc">${escapeHtml(r.fecha)} · ${escapeHtml(r.estacion || "—")}${r.tanqueLleno === "No" || r.tanqueLleno === false ? ' <span class="tiny" style="color:var(--yel)">parcial</span>' : ""}</div>
        <div class="tx-meta">${(+r.galones).toFixed(2)} gal${vpgTxt} · ${Number(r.odometro).toLocaleString("es-CO")} km${extra}</div></div>
      <div class="tx-amt">${fmt(r.costo)}</div>
      <button class="icon-btn" data-delf="${r.id}"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2m-9 0v14h10V6"/></svg></button>
    </div>`;
  }).join("");
  root.querySelectorAll("[data-rowf]").forEach((rw) => rw.onclick = (e) => {
    if (e.target.closest("[data-delf]")) return;
    const r = allFuel.find((x) => x.id === rw.getAttribute("data-rowf"));
    openFuelModal(v, root, r, m.byId[r.id]);
  });
  root.querySelectorAll("[data-delf]").forEach((b) => b.onclick = (e) => {
    e.stopPropagation();
    const id = b.getAttribute("data-delf");
    const rec = allFuel.find((x) => x.id === id);
    const msg = rec && rec.gastoId
      ? "Se quita este tanqueo de la bitácora del vehículo. <b>El gasto NO se borra</b>: sigue en Movimientos; solo se elimina el vínculo con el vehículo."
      : "¿Eliminar este tanqueo de la bitácora?";
    confirmDialog(msg, async () => {
      allFuel = allFuel.filter((x) => x.id !== id);
      await deleteFuel(getState().user.uid, id); persistFuelLocal(getState().user.uid, allFuel);
      await syncVehicleOdo(v);
      if (rec && rec.gastoId) await unlinkGasto(rec.gastoId, "fuelId");
      drawFuel(root, v); toast(rec && rec.gastoId ? "Tanqueo quitado (el gasto sigue en Movimientos)" : "Tanqueo eliminado");
    });
  });
}

function openFuelModal(v, root, existing, info) {
  const f = (label, html) => `<div class="field"><label class="label">${label}</label>${html}</div>`;
  const fuelOpts = FUEL_TYPES.map((t) => `<option>${t}</option>`).join("");
  // valor por galón de este tanqueo (costo ÷ galones) — se puede calcular siempre que haya datos
  const vpg = existing && +existing.galones ? (+existing.costo) / (+existing.galones) : 0;
  const summary = (vpg || info) ? `<div class="card mb-3" style="background:var(--panel-2)">
      ${vpg ? `<div class="row between" style="padding:3px 0"><span class="small muted">Valor por galón</span><span class="small bold" style="color:var(--gold)">${fmt(vpg)}/gal</span></div>` : ""}
      ${info ? `<div class="row between" style="padding:3px 0"><span class="small muted">Rendimiento de esta línea</span><span class="small bold" style="color:var(--green)">${info.rend.toFixed(1)} km/gal</span></div>
      <div class="row between" style="padding:3px 0"><span class="small muted">Pesos por km</span><span class="small bold">${info.costoKm ? fmt(info.costoKm) + "/km" : "—"}</span></div>
      <div class="row between" style="padding:3px 0"><span class="small muted">Distancia del tramo</span><span class="small bold">${Number(info.dist).toLocaleString("es-CO")} km</span></div>` : ""}
    </div>` : "";
  openModal(existing ? "Tanqueo" : "Nuevo tanqueo", `
    ${summary}
    ${f("Fecha", `<input id="t-fecha" class="input" type="date" value="${existing ? existing.fecha : todayISO()}">`)}
    ${f("Estación", `<input id="t-est" class="input" placeholder="Ej: Terpel" value="${existing ? escapeHtml(existing.estacion || "") : ""}">`)}
    ${f("Tipo de combustible", `<select id="t-tipo" class="input">${fuelOpts}</select>`)}
    ${f("Galones", `<input id="t-gal" class="input" type="number" step="0.001" placeholder="Ej: 2.5" value="${existing ? existing.galones : ""}">`)}
    ${f("Odómetro (km del tablero)", `<input id="t-odo" class="input" type="number" value="${existing ? existing.odometro : (v.odometro ?? "")}" placeholder="0">`)}
    ${f("Costo (COP)", `<input id="t-costo" class="input" type="number" placeholder="0" value="${existing ? existing.costo : ""}" ${existing && existing.gastoId ? "readonly style='opacity:.55'" : ""}>`)}
    ${existing && existing.gastoId ? `<p class="tiny muted">🔗 El valor está vinculado a un gasto en Movimientos. Para cambiarlo, edita ese gasto (allí también se sincroniza la fecha).</p>` : ""}
    ${f("¿Tanque lleno?", `<select id="t-lleno" class="input"><option>Sí</option><option>No</option></select>`)}
    <button id="t-save" class="btn btn-primary btn-block mt-2">${existing ? "Guardar cambios" : "Guardar tanqueo"}</button>`, {
    onMount(b) {
      moneyPreview(b.querySelector("#t-costo"));
      b.querySelector("#t-tipo").value = (existing ? existing.tipoCombustible : v.combustible) || "Corriente";
      if (existing) b.querySelector("#t-lleno").value = (existing.tanqueLleno === "No" || existing.tanqueLleno === false) ? "No" : "Sí";
      submitOnce(b.querySelector("#t-save"), async () => {
        const rec = {
          id: existing ? existing.id : uid(), vehicleId: v.id, fecha: b.querySelector("#t-fecha").value,
          estacion: b.querySelector("#t-est").value.trim(), tipoCombustible: b.querySelector("#t-tipo").value,
          galones: +b.querySelector("#t-gal").value, odometro: +b.querySelector("#t-odo").value,
          costo: +b.querySelector("#t-costo").value || 0, tanqueLleno: b.querySelector("#t-lleno").value,
        };
        if (existing && existing.gastoId) rec.gastoId = existing.gastoId;
        // odómetro 0 es válido (primer tanqueo de un vehículo nuevo)
        if (!rec.galones || isNaN(rec.odometro) || b.querySelector("#t-odo").value === "") return toast("Faltan galones u odómetro", true);
        allFuel = existing ? allFuel.map((x) => (x.id === rec.id ? rec : x)) : [...allFuel, rec];
        await addFuel(getState().user.uid, rec); persistFuelLocal(getState().user.uid, allFuel);
        await syncVehicleOdo(v);
        closeModal(); drawFuel(root, v); toast(existing ? "Tanqueo actualizado" : "Tanqueo registrado");
      });
    },
  });
}

// Ajusta el odómetro reconstruido al real reportado, desplazando todos los tanqueos por igual
function openAdjustOdoModal(v, root) {
  const fuel = allFuel.filter((r) => r.vehicleId === v.id);
  if (!fuel.length) return toast("No hay tanqueos para ajustar", true);
  const latest = fuel.reduce((m, r) => ((r.odometro || 0) > (m ? m.odometro : -1) ? r : m), null);
  const curMax = latest.odometro || 0;
  const minOdo = Math.min(...fuel.map((r) => r.odometro || 0));
  openModal("Ajustar odómetro real", `
    <p class="small muted mb-3">Los tanqueos importados usan un odómetro <b>reconstruido</b> (aproximado, empieza en 0). Pon el odómetro <b>real del último tanqueo</b> (${escapeHtml(latest.fecha)}, hoy en ${Number(curMax).toLocaleString("es-CO")} km reconstruidos) y la app ajusta todos los registros por igual, <b>sin cambiar los rendimientos</b>.</p>
    <div class="field"><label class="label">Odómetro real del último tanqueo (km)</label><input id="adj-odo" class="input" type="number" value="${curMax}"></div>
    <button id="adj-save" class="btn btn-primary btn-block">Ajustar</button>`, {
    onMount(b) {
      submitOnce(b.querySelector("#adj-save"), async () => {
        const real = +b.querySelector("#adj-odo").value;
        if (!real) return toast("Pon el odómetro real", true);
        const offset = real - curMax;
        if (offset === 0) { closeModal(); return; }
        if (minOdo + offset < 0) return toast("Ese valor haría odómetros negativos. Usa un número más alto.", true);
        const updated = fuel.map((r) => ({ ...r, odometro: (r.odometro || 0) + offset }));
        allFuel = allFuel.filter((x) => x.vehicleId !== v.id).concat(updated);
        await bulkSetFuel(getState().user.uid, v.id, updated);
        persistFuelLocal(getState().user.uid, allFuel);
        const newVehOdo = Math.max(...updated.map((r) => r.odometro || 0));
        setState({ vehicles: getState().vehicles.map((x) => (x.id === v.id ? { ...x, odometro: newVehOdo } : x)) });
        v.odometro = newVehOdo; await persistVehicles();
        closeModal(); drawFuel(root, v); toast("Odómetro ajustado");
      });
    },
  });
}

async function importFuelXlsx(v, root, input) {
  const file = input.files[0]; if (!file) return;
  try {
    const XLSX = await import("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm");
    const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
    const sheet = wb.Sheets["Combustible"] || wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    const recs = [];
    rows.forEach((r) => {
      const gal = +(r["Galones"] ?? r["galones"] ?? 0);
      const odo = +(r["Odometro"] ?? r["odometro"] ?? r["Odómetro"] ?? 0);
      if (!gal || !odo) return;
      let fecha = r["Fecha"] ?? r["fecha"] ?? "";
      if (fecha instanceof Date) fecha = isoLocal(fecha); else fecha = String(fecha).slice(0, 10);
      recs.push({
        id: uid(), vehicleId: v.id, fecha, estacion: String(r["Estacion"] ?? r["Estación"] ?? "").trim(),
        tipoCombustible: String(r["Tipo_combustible"] ?? r["TipoCombustible"] ?? "").trim(),
        galones: gal, odometro: odo, costo: +(r["Costo"] ?? r["costo"] ?? 0),
        tanqueLleno: String(r["Tanque_lleno"] ?? "Sí").trim() || "Sí",
      });
    });
    if (!recs.length) return toast("No se encontraron tanqueos en el Excel", true);
    toast("Importando " + recs.length + " tanqueos...");
    allFuel = allFuel.filter((x) => x.vehicleId !== v.id).concat(recs);
    await bulkSetFuel(getState().user.uid, v.id, recs); persistFuelLocal(getState().user.uid, allFuel);
    await syncVehicleOdo(v);
    drawFuel(root, v); toast(recs.length + " tanqueos importados");
  } catch (e) { console.error(e); toast("Error al leer el Excel", true); }
  input.value = "";
}

// importa tanqueos desde un JSON (acepta el exportado por la app, un arreglo, o gasolina_moto_para_app.json)
async function importFuelJson(v, root, input) {
  const file = input.files[0]; if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const arr = Array.isArray(data) ? data : (data.combustible || data.fuel || data.tanqueos || []);
    const recs = [];
    arr.forEach((r) => {
      const gal = +(r.galones ?? r.Galones ?? 0);
      const odoRaw = r.odometro ?? r.Odometro ?? r["Odómetro"];
      const odo = +odoRaw;
      // odómetro 0 es válido (vehículo nuevo en su primer tanqueo); solo se rechaza si falta
      if (!gal || odoRaw == null || odoRaw === "" || isNaN(odo)) return;
      const fecha = String(r.fecha ?? r.Fecha ?? "").slice(0, 10);
      recs.push({
        // conserva id y vínculo con el gasto si vienen en el archivo (re-importar un
        // export propio no rompe la relación gasto ↔ tanqueo de Movimientos)
        id: r.id || uid(), vehicleId: v.id, fecha,
        estacion: String(r.estacion ?? r.Estacion ?? r["Estación"] ?? "").trim(),
        tipoCombustible: String(r.tipoCombustible ?? r.tipo_combustible ?? r.Tipo_combustible ?? "").trim(),
        galones: gal, odometro: odo, costo: +(r.costo ?? r.Costo ?? 0),
        tanqueLleno: String(r.tanqueLleno ?? r.tanque_lleno ?? "Sí").trim() || "Sí",
        ...(r.gastoId ? { gastoId: r.gastoId } : {}),
      });
    });
    if (!recs.length) { toast("No se encontraron tanqueos en el JSON", true); input.value = ""; return; }
    confirmDialog(`El JSON trae ${recs.length} tanqueos. Esto <b>reemplaza</b> los tanqueos actuales de ${escapeHtml(v.alias || v.modelo)} (no afecta tus gastos en Movimientos). ¿Continuar?`, async () => {
      allFuel = allFuel.filter((x) => x.vehicleId !== v.id).concat(recs);
      await bulkSetFuel(getState().user.uid, v.id, recs); persistFuelLocal(getState().user.uid, allFuel);
      await syncVehicleOdo(v);
      drawFuel(root, v); toast(recs.length + " tanqueos importados");
    }, { yesLabel: "Importar", danger: false, busyLabel: "Importando…" });
  } catch (e) { console.error(e); toast("Error al leer el JSON", true); }
  input.value = "";
}

function exportJson(v, fuel) {
  const blob = new Blob([JSON.stringify({ vehiculo: { alias: v.alias, placa: v.placa }, combustible: fuel }, null, 2)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
  a.download = "combustible_" + (v.alias || v.placa || "vehiculo").replace(/\s+/g, "_") + ".json"; a.click(); toast("JSON exportado");
}
async function exportXlsx(v, fuel) {
  const XLSX = await import("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm");
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(fuel.map((r) => ({ Fecha: r.fecha, Estacion: r.estacion, Tipo_combustible: r.tipoCombustible, Galones: r.galones, Odometro: r.odometro, Costo: r.costo, Tanque_lleno: r.tanqueLleno })));
  XLSX.utils.book_append_sheet(wb, ws, "Combustible");
  XLSX.writeFile(wb, "combustible_" + (v.alias || v.placa || "vehiculo").replace(/\s+/g, "_") + ".xlsx"); toast("Excel exportado");
}

/* ===================== MANTENIMIENTO ===================== */
function maintStatus(rec, vehOdo, today) {
  // sin odómetro (ej: compra de insumos) no se puede proyectar por km recurrente
  const nextKm = rec.proximoKm || (rec.recurrenteKm && rec.odometro != null ? rec.odometro + rec.recurrenteKm : null);
  const nextDate = rec.proximaFecha || (rec.recurrenteDias && rec.fecha ? addDays(rec.fecha, rec.recurrenteDias) : null);
  let st = null; const lbl = [];
  if (nextKm != null) {
    const falta = nextKm - (vehOdo || 0);
    if (falta <= 0) { st = "vencido"; lbl.push(`vencido (${Number(nextKm).toLocaleString("es-CO")} km)`); }
    else if (falta <= 300) { st = st || "proximo"; lbl.push(`en ${falta} km`); }
  }
  if (nextDate) {
    const dias = daysBetween(today, nextDate);
    if (dias != null && dias <= 0) { st = "vencido"; lbl.push("vencido por fecha"); }
    else if (dias != null && dias <= 15) { st = st || "proximo"; lbl.push(`en ${dias} días`); }
  }
  return { nextKm, nextDate, st, lbl: lbl.join(" · ") };
}

async function renderMaint(root, vid) {
  const s = getState();
  const v = (s.vehicles || []).find((x) => x.id === vid);
  if (!v) { activeMaintVid = null; return renderList(root); }
  root.innerHTML = `<div style="min-height:50vh;display:grid;place-items:center"><div class="loader spin"></div></div>`;
  allMaint = await loadMaint(s.user.uid);
  drawMaint(root, v);
}

function drawMaint(root, v) {
  const items = allMaint.filter((r) => r.vehicleId === v.id).sort((a, b) => (b.fecha || "").localeCompare(a.fecha || "") || ((b.odometro || 0) - (a.odometro || 0)));
  const tallerCost = sum(items.filter((r) => r.categoria === "Taller"), (r) => +r.costo || 0);
  const totalCost = sum(items, (r) => +r.costo || 0);
  const fechas = items.map((r) => r.fecha).filter(Boolean).sort();
  const years = fechas.length ? Math.max(1, (new Date(fechas[fechas.length - 1]) - new Date(fechas[0])) / (365 * 86400000)) : 1;
  const today = todayISO();
  const latest = {};
  for (const r of items) { const k = (r.categoria || "") + "|" + (r.tipo || ""); if (!latest[k]) latest[k] = r; }
  const alerts = [];
  Object.values(latest).forEach((r) => { const st = maintStatus(r, v.odometro, today); if (st.st) alerts.push({ r, st }); });
  alerts.sort((a, b) => (a.st.st === "vencido" ? 0 : 1) - (b.st.st === "vencido" ? 0 : 1));
  const badgeCol = { Taller: "var(--blue)", Mantenimiento: "var(--blue)", Insumos: "var(--green)", Insumo: "var(--green)", Accesorio: "#c98bb9", Rutina: "var(--gold)", Otros: "#8aa0a3" };
  const badge = (c) => `<span class="badge" style="background:${badgeCol[c] || "var(--gold)"};color:#10171a">${escapeHtml(c)}</span>`;
  const maintDupes = dupeCount(items);
  const reorg = items.map((r) => ({ r, to: suggestMaintTipo(r) })).filter((x) => x.to);

  root.innerHTML = `
    <div class="row gap-2 mb-3" style="align-items:center">
      <button id="back" class="icon-btn"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg></button>
      <div><div class="page-title disp" style="font-size:21px;margin:0">🔧 Mantenimiento</div><div class="tiny muted">${icon(v.tipo)} ${escapeHtml(v.alias || v.modelo)} · ${Number(v.odometro || 0).toLocaleString("es-CO")} km</div></div>
    </div>
    <button id="add-visit" class="btn btn-primary btn-block mb-2" style="display:block;text-align:left;height:auto;padding:12px 14px;line-height:1.3">
      <div style="font-weight:700">🧾 Registrar orden de trabajo</div>
      <div style="font-size:11.5px;opacity:.85;font-weight:400;margin-top:3px">Una factura del taller con <b>varias líneas</b> (mano de obra + repuestos). El total se suma y queda <b>un solo gasto</b>. Úsalo cuando llevas la moto a servicio.</div>
    </button>
    <button id="add-maint" class="btn btn-ghost btn-block mb-2" style="display:block;text-align:left;height:auto;padding:12px 14px;line-height:1.3">
      <div style="font-weight:700">🔧 Registrar ítem individual</div>
      <div class="tiny muted" style="font-weight:400;margin-top:3px">Un <b>solo</b> servicio o repuesto (ej. lubricar cadena, revisar presión). Entra solo a la bitácora; <b>no crea gasto</b>. Útil para rutinas y chequeos sin factura.</div>
    </button>
    <button id="import-maint" class="btn btn-ghost btn-block mb-2" style="display:block;text-align:left;height:auto;padding:12px 14px;line-height:1.3">
      <div style="font-weight:700">📥 Importar desde Movimientos</div>
      <div class="tiny muted" style="font-weight:400;margin-top:3px">Vincula a esta bitácora gastos de la moto que <b>ya registraste en Movimientos</b>, sin duplicarlos.</div>
    </button>
    ${reorg.length ? `<button id="reorg-maint" class="btn btn-ghost btn-block mb-2" style="color:var(--gold)">🗂️ Reorganizar tipos (${reorg.length} sugerencia${reorg.length === 1 ? "" : "s"})</button>` : ""}
    ${maintDupes ? `<button id="dedupe-maint" class="btn btn-ghost btn-block mb-3" style="color:var(--red)">🧹 Quitar ${maintDupes} duplicado(s)</button>` : `<div class="mb-1"></div>`}
    <div class="grid-kpi mb-4">
      ${kpi("Gasto total", fmt(totalCost))}
      ${kpi("Solo Taller", fmt(tallerCost))}
      ${kpi("Gasto/año aprox.", fmt(totalCost / years), true)}
      ${kpi("Pendientes", alerts.length, true)}
    </div>
    ${alerts.length ? `<div class="card mb-3"><div class="card-title">Próximos servicios</div>
      ${alerts.map((a) => `<div class="row between" style="padding:7px 0;border-top:1px solid var(--line)">
        <span class="small">${badge(a.r.categoria)} ${escapeHtml(a.r.tipo)}</span>
        <span class="small bold" style="color:${a.st.st === "vencido" ? "var(--red)" : "var(--yel)"}">${a.st.st === "vencido" ? "⚠ " : "⏳ "}${a.st.lbl}</span></div>`).join("")}</div>` : ""}
    ${items.length ? `<div class="card" style="padding:0" id="maint-list"></div>` : `<div class="empty"><p>Sin mantenimientos aún. Registra cambios de aceite, llantas, lubricación de cadena, etc.<br>Usa "Taller" para servicios con costo y "Rutina" para inspecciones frecuentes.</p></div>`}`;

  root.querySelector("#back").onclick = () => { activeMaintVid = null; renderList(root); };
  root.querySelector("#add-visit").onclick = () => openVisitModal(v, root);
  root.querySelector("#add-maint").onclick = () => openMaintModal(v, root);
  root.querySelector("#import-maint").onclick = () => openImportMaint(v, root);
  const reorgBtn = root.querySelector("#reorg-maint");
  if (reorgBtn) reorgBtn.onclick = () => openReorgMaint(v, root, reorg);
  const dedupeBtn = root.querySelector("#dedupe-maint");
  if (dedupeBtn) dedupeBtn.onclick = () => confirmDialog(`Se encontraron ${maintDupes} registro(s) repetido(s) (mismo gasto importado varias veces). Se quitan los repetidos y se deja uno por gasto. No se borra ningún gasto de Movimientos.`, async () => {
    const { delIds, keepByGasto } = planDedupe(allMaint.filter((r) => r.vehicleId === v.id));
    allMaint = allMaint.filter((r) => !delIds.includes(r.id));
    for (const id of delIds) await deleteMaint(getState().user.uid, id);
    persistMaintLocal(getState().user.uid, allMaint);
    const changedTx = getState().txs.filter((t) => keepByGasto[t.id] && t.maintId !== keepByGasto[t.id]).map((t) => ({ ...t, maintId: keepByGasto[t.id] }));
    if (changedTx.length) { const m = Object.fromEntries(changedTx.map((t) => [t.id, t])); setState({ txs: getState().txs.map((x) => m[x.id] || x) }); await bulkUpdateTx(getState().user.uid, changedTx); forcePersistLocal(getState().user.uid); }
    drawMaint(root, v); toast(`${delIds.length} duplicado(s) eliminado(s)`);
  });
  if (items.length) {
    // agrupar por visitaId (factura con varias líneas); los sueltos quedan individuales
    const rowLine = (r) => {
      const refCant = [r.descripcion && r.descripcion !== r.tipo ? escapeHtml(r.descripcion) : "", r.referencia ? "ref " + escapeHtml(r.referencia) : "", (r.cantidad && r.cantidad !== 1) ? "x" + r.cantidad : ""].filter(Boolean).join(" · ");
      return `<div class="tx-row" data-rowm="${r.id}" style="cursor:pointer">
        <div class="flex1"><div class="tx-desc">${badge(r.categoria)} ${escapeHtml(r.tipo)}</div>
          <div class="tx-meta">${r.visitaId ? refCant || "&nbsp;" : `${escapeHtml(r.fecha)} · ${r.odometro != null ? Number(r.odometro).toLocaleString("es-CO") + " km" : "sin odómetro"}${r.taller ? " · " + escapeHtml(r.taller) : ""}`}</div></div>
        <div class="tx-amt">${r.costo ? fmt(r.costo) : "—"}</div>
        <button class="icon-btn" data-delm="${r.id}"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2m-9 0v14h10V6"/></svg></button>
      </div>`;
    };
    const groups = []; const byV = {};
    for (const r of items.slice(0, 400)) {
      if (r.visitaId) { if (!byV[r.visitaId]) { byV[r.visitaId] = { v: r.visitaId, recs: [], head: r }; groups.push(byV[r.visitaId]); } byV[r.visitaId].recs.push(r); }
      else groups.push({ single: r });
    }
    root.querySelector("#maint-list").innerHTML = groups.map((g) => {
      if (g.single) return rowLine(g.single);
      const h = g.head, tot = sum(g.recs, (r) => +r.costo || 0);
      return `<div style="border-bottom:1px solid var(--line)">
        <div class="row between" style="padding:9px 12px;background:var(--panel-2);align-items:center">
          <div style="min-width:0"><div class="small bold">🧾 Visita · ${fmt(tot)}</div>
            <div class="tiny muted">${escapeHtml(h.fecha)} · ${h.odometro != null ? Number(h.odometro).toLocaleString("es-CO") + " km" : "sin odómetro"}${h.taller ? " · " + escapeHtml(h.taller) : ""} · ${g.recs.length} ítems</div></div>
          <button class="icon-btn" data-delvisit="${g.v}" aria-label="Eliminar visita"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2m-9 0v14h10V6"/></svg></button>
        </div>
        ${g.recs.map(rowLine).join("")}</div>`;
    }).join("");

    root.querySelectorAll("[data-rowm]").forEach((rw) => rw.onclick = (e) => { if (e.target.closest("[data-delm]")) return; openMaintModal(v, root, allMaint.find((x) => x.id === rw.getAttribute("data-rowm"))); });
    root.querySelectorAll("[data-delm]").forEach((b) => b.onclick = (e) => {
      e.stopPropagation();
      const id = b.getAttribute("data-delm"); const rec = allMaint.find((x) => x.id === id);
      const msg = rec && rec.visitaId
        ? "Se quita esta línea de la visita. El total de la visita (y su gasto en Movimientos) se recalculan."
        : rec && rec.gastoId
        ? "Se quita este mantenimiento de la bitácora. <b>El gasto NO se borra</b>: sigue en Movimientos; solo se elimina el vínculo con el vehículo."
        : "¿Eliminar este mantenimiento de la bitácora?";
      confirmDialog(msg, async () => {
        allMaint = allMaint.filter((x) => x.id !== id);
        await deleteMaint(getState().user.uid, id); persistMaintLocal(getState().user.uid, allMaint);
        if (rec && rec.visitaId) await recalcVisitGasto(rec.visitaId);
        else if (rec && rec.gastoId) await unlinkGasto(rec.gastoId, "maintId");
        drawMaint(root, v); toast("Línea eliminada");
      });
    });
    root.querySelectorAll("[data-delvisit]").forEach((b) => b.onclick = (e) => {
      e.stopPropagation();
      const vid = b.getAttribute("data-delvisit");
      confirmDialog("¿Eliminar toda la visita? Se borran sus líneas de la bitácora y <b>el gasto asociado en Movimientos</b>.", async () => {
        const recs = allMaint.filter((x) => x.visitaId === vid);
        const gastoId = recs[0] && recs[0].gastoId;
        allMaint = allMaint.filter((x) => x.visitaId !== vid);
        for (const r of recs) await deleteMaint(getState().user.uid, r.id);
        persistMaintLocal(getState().user.uid, allMaint);
        if (gastoId && getState().txs.some((t) => t.id === gastoId)) {
          setState({ txs: getState().txs.filter((t) => t.id !== gastoId) });
          await deleteTx(getState().user.uid, gastoId); forcePersistLocal(getState().user.uid);
        }
        drawMaint(root, v); toast("Visita eliminada");
      });
    });
  }
}

// recalcula el total de una visita y actualiza el gasto enlazado en Movimientos
// Revisa y aplica la reorganización de Tipo/Clasificación sugerida por suggestMaintTipo
function openReorgMaint(v, root, reorg) {
  const lbl = (c, t) => `${escapeHtml(c)} · ${escapeHtml(t)}`;
  openModal("🗂️ Reorganizar tipos", `
    <p class="small muted mb-3">Se proponen tipos más específicos según la descripción de cada registro (y los nombres antiguos pasan a los actuales). Desmarca lo que no quieras cambiar (se dejará como está y no se volverá a sugerir). <b>No se modifica ningún gasto</b>, solo la bitácora.</p>
    <label class="row gap-2 small mb-2" style="align-items:center"><input type="checkbox" id="ro-all" checked> <b>Seleccionar todo</b></label>
    <div style="max-height:55vh;overflow:auto;border-top:1px solid var(--line)">
      ${reorg.map((x, i) => `<label class="row gap-2" style="align-items:flex-start;padding:8px 0;border-bottom:1px solid var(--line)">
        <input type="checkbox" class="ro-chk" data-i="${i}" checked style="margin-top:3px">
        <div style="min-width:0"><div class="small bold">${escapeHtml(x.r.descripcion || x.r.tipo || "")}</div>
          <div class="tiny muted">${escapeHtml(x.r.fecha || "")} · ${fmt(+x.r.costo || 0)}</div>
          <div class="tiny"><span class="muted" style="text-decoration:line-through">${lbl(x.r.categoria || "", x.r.tipo || "")}</span> → <b style="color:var(--gold)">${lbl(x.to.categoria, x.to.tipo)}</b></div></div></label>`).join("")}
    </div>
    <button id="ro-ok" class="btn btn-primary btn-block mt-3">Aplicar cambios</button>`, {
    onMount(b) {
      const chks = [...b.querySelectorAll(".ro-chk")];
      b.querySelector("#ro-all").onchange = (e) => chks.forEach((c) => { c.checked = e.target.checked; });
      submitOnce(b.querySelector("#ro-ok"), async () => {
        // marcados: se aplica el cambio; desmarcados: se recuerdan como revisados
        // (reorgOk) para que el botón desaparezca y no vuelva a sugerirlos
        const uidU = getState().user.uid;
        const changes = {};
        chks.forEach((c) => { const x = reorg[+c.dataset.i]; changes[x.r.id] = c.checked ? { ...x.to, reorgOk: true } : { reorgOk: true }; });
        allMaint = allMaint.map((r) => (changes[r.id] ? { ...r, ...changes[r.id] } : r));
        for (const [id, f] of Object.entries(changes)) await updateMaint(uidU, id, f);
        persistMaintLocal(uidU, allMaint);
        const n = chks.filter((c) => c.checked).length;
        closeModal(); drawMaint(root, v); toast(`${n} registro(s) reorganizado(s)`);
      }, "Aplicando…");
    },
  });
}

async function recalcVisitGasto(visitaId) {
  const recs = allMaint.filter((r) => r.visitaId === visitaId);
  const gastoId = recs[0] && recs[0].gastoId;
  if (!gastoId) return;
  const tx = getState().txs.find((t) => t.id === gastoId);
  if (!tx) return;
  const total = sum(recs, (r) => +r.costo || 0);
  if ((+tx.amount || 0) !== total) {
    const ntx = { ...tx, amount: total };
    setState({ txs: getState().txs.map((x) => (x.id === gastoId ? ntx : x)) });
    await addTx(getState().user.uid, ntx); forcePersistLocal(getState().user.uid);
  }
}

// ----- Registrar visita al taller: varias líneas (actividades + repuestos) que suman, un gasto -----
// onDone: si se da (ej. abierto desde Movimientos), se llama al terminar en vez de redibujar la bitácora.
export function openVisitModal(v, root, onDone) {
  const s = getState();
  const payList = [...DEFAULT_PAY_METHODS.filter((m) => m !== "Otro"), ...(s.payMethods || []), "Otro"];
  const payOpts = payList.map((m) => `<option>${escapeHtml(m)}</option>`).join("");
  const acctOpts = `<option value="">— ninguna —</option>` + (s.accounts || []).map((a) => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)}</option>`).join("");
  // mismas listas que el ítem individual (datos consistentes y filtrables)
  const claseOpts = (sel) => MAINT_CATEGORIES.map((c) => `<option ${c === sel ? "selected" : ""}>${c}</option>`).join("");
  const tipoOpts = (clase) => (MAINT_TIPOS[clase] || []).map((t) => `<option>${escapeHtml(t)}</option>`).join("");
  openModal("Registrar orden de trabajo", `
    <div class="field"><label class="label">Fecha</label><input id="v-fecha" type="date" class="input" value="${todayISO()}"></div>
    <div class="field"><label class="label">Odómetro (km)</label><input id="v-odo" type="number" class="input" value="${v.odometro ?? ""}" placeholder="km del tablero"></div>
    <div class="field"><label class="label">Taller</label><input id="v-taller" class="input" placeholder="Ej: Suzuki Bogotá 57"></div>
    <div class="field"><label class="label">Clasificación por defecto (las líneas nuevas la heredan)</label><select id="v-clase-def" class="input">${claseOpts("Taller")}</select></div>

    <div class="card-title" style="font-size:13px;margin-top:6px">Líneas de la orden</div>
    <p class="tiny muted" style="margin:-4px 0 8px">Cada línea: clasificación (Taller/Rutina/Insumos) + <b>tipo</b> (de la lista). Lo específico va en <b>Descripción</b>. La referencia y cantidad aparecen solo en Insumos. El valor es el <b>total de esa línea con IVA</b>.</p>
    <div id="v-list"></div>
    <button type="button" id="v-add" class="btn btn-ghost btn-sm mb-3">+ Línea</button>

    <div class="field"><label class="label">Medio de pago</label><select id="v-pay" class="input">${payOpts}</select></div>
    <div class="field"><label class="label">Cuenta (opcional)</label><select id="v-acct" class="input">${acctOpts}</select></div>
    <p class="tiny muted" style="margin:-4px 0 8px">El total crea <b>un gasto</b> en Movimientos (categoría del vehículo); el detalle queda aquí en la bitácora.</p>
    <div class="kpi mb-3" style="background:linear-gradient(135deg,#1d272c,#161e22)"><div class="k-label">Total orden</div><div class="k-val" id="v-total">$0</div></div>
    <button id="v-save" class="btn btn-primary btn-block">Registrar orden</button>`, {
    onMount(b) {
      const rowHtml = (clase) => `<div class="vl" style="border:1px solid var(--line);border-radius:12px;padding:12px;margin-bottom:10px">
        <div class="row between mb-2" style="align-items:center"><span class="tiny muted" style="font-weight:700;letter-spacing:.04em">LÍNEA</span>
          <button type="button" class="icon-btn vl-del" aria-label="Quitar">✕</button></div>
        <div class="field"><label class="label">Clasificación</label><select class="input vl-clase">${claseOpts(clase)}</select></div>
        <div class="field"><label class="label">Tipo</label><select class="input vl-tipo">${tipoOpts(clase)}</select></div>
        <div class="field"><label class="label">Descripción / detalle (opcional)</label><input class="input vl-desc" placeholder="Marca, nota o referencia escrita…"></div>
        <div class="field vl-parts" style="display:${clase === "Insumos" ? "block" : "none"}"><label class="label">Referencia y cantidad</label>
          <div class="row gap-2"><input class="input vl-ref" placeholder="Referencia (opc)" style="flex:1;min-width:0"><input class="input vl-cant" type="number" inputmode="numeric" value="1" style="width:72px" title="Cantidad"></div></div>
        <div class="field"><label class="label">Valor total de la línea (COP)</label><input class="input vl-val" type="number" inputmode="numeric" placeholder="0"></div>
        <div class="field"><label class="label">Repetir cada (km) — opcional</label><input class="input vl-km" type="number" inputmode="numeric" placeholder="ej: 3000"></div>
      </div>`;
      const vList = b.querySelector("#v-list");
      const recalc = () => { let t = 0; b.querySelectorAll("#v-list .vl-val").forEach((i) => t += (+i.value || 0)); b.querySelector("#v-total").textContent = fmt(t); };
      const wire = () => {
        b.querySelectorAll("#v-list .vl").forEach((row) => {
          row.querySelector(".vl-del").onclick = () => { row.remove(); recalc(); };
          row.querySelectorAll("input").forEach((i) => i.oninput = recalc);
          const cl = row.querySelector(".vl-clase"), tip = row.querySelector(".vl-tipo");
          cl.onchange = () => {
            tip.innerHTML = tipoOpts(cl.value);
            row.querySelector(".vl-parts").style.display = cl.value === "Insumos" ? "block" : "none";
            recalc();
          };
        });
      };
      const addRow = () => { vList.insertAdjacentHTML("beforeend", rowHtml(b.querySelector("#v-clase-def").value)); wire(); };
      addRow(); recalc();
      b.querySelector("#v-add").onclick = addRow;

      submitOnce(b.querySelector("#v-save"), async () => {
        const fecha = b.querySelector("#v-fecha").value, odo = b.querySelector("#v-odo").value;
        const taller = b.querySelector("#v-taller").value.trim();
        if (!fecha) return toast("Falta la fecha", true);
        const odometro = odo === "" ? null : +odo;
        const visitaId = uid(), gastoId = uid();
        const recs = [];
        b.querySelectorAll("#v-list .vl").forEach((row) => {
          const clase = row.querySelector(".vl-clase").value;
          const tipo = row.querySelector(".vl-tipo").value.trim();
          const desc = row.querySelector(".vl-desc").value.trim();
          const val = +row.querySelector(".vl-val").value || 0;
          if (!tipo || !val) return;
          const isIns = clase === "Insumos";
          const cant = isIns ? (+row.querySelector(".vl-cant").value || 1) : 1;
          const ref = isIns ? row.querySelector(".vl-ref").value.trim() : "";
          const km = row.querySelector(".vl-km").value;
          recs.push({ id: uid(), vehicleId: v.id, visitaId, gastoId, claseLinea: isIns ? "repuesto" : "actividad", categoria: clase, tipo, descripcion: desc || tipo, referencia: ref, cantidad: cant, valorUnit: cant ? val / cant : val, costo: val, fecha, odometro, taller, repuesto: isIns ? tipo : "", proximoKm: null, recurrenteKm: km === "" ? null : +km, proximaFecha: "", recurrenteDias: null, reorgOk: true });
        });
        if (!recs.length) return toast("Agrega al menos una línea con tipo y valor", true);
        const total = sum(recs, (r) => +r.costo || 0);
        const cats = getState().cats || [];
        const catName = (v.tipo === "Moto" && cats.some((c) => c.name === "Moto")) ? "Moto"
          : (cats.find((c) => /carro|veh[ií]culo|autom[oó]vil/i.test(c.name)) || {}).name || (cats.some((c) => c.name === "Moto") ? "Moto" : (cats[0] || {}).name || "Moto");
        const catObj = cats.find((c) => c.name === catName);
        const sub = (catObj && (catObj.subs || []).includes("Mantenimiento/reparaciones")) ? "Mantenimiento/reparaciones" : ((catObj && catObj.subs && catObj.subs[0]) || "");
        const tx = { id: gastoId, date: fecha, desc: "Taller" + (taller ? " " + taller : ""), amount: total, cat: catName, sub, pay: b.querySelector("#v-pay").value, acct: b.querySelector("#v-acct").value || "", vehicleId: v.id, visitaId, tags: [] };

        const fresh = await loadMaint(getState().user.uid);
        allMaint = [...fresh, ...recs];
        await bulkAddMaint(getState().user.uid, recs); persistMaintLocal(getState().user.uid, allMaint);
        setState({ txs: [tx, ...getState().txs] });
        await addTx(getState().user.uid, tx);
        if (odometro != null && odometro > (v.odometro || 0)) { setState({ vehicles: getState().vehicles.map((x) => (x.id === v.id ? { ...x, odometro } : x)) }); v.odometro = odometro; await persistVehicles(); }
        forcePersistLocal(getState().user.uid);
        closeModal(); toast(`Orden registrada · ${fmt(total)}`);
        if (onDone) onDone(); else drawMaint(root, v);
      });
    },
  });
}

function openMaintModal(v, root, existing) {
  const f = (label, html) => `<div class="field"><label class="label">${label}</label>${html}</div>`;
  const extraCat = (existing && existing.categoria && !MAINT_CATEGORIES.includes(existing.categoria)) ? `<option selected>${escapeHtml(existing.categoria)}</option>` : "";
  const catOpts = extraCat + MAINT_CATEGORIES.map((c) => `<option ${existing && existing.categoria === c ? "selected" : ""}>${c}</option>`).join("");
  const val = (x) => (x != null && x !== "" ? x : "");
  openModal(existing ? "Mantenimiento" : "Nuevo mantenimiento", `
    ${!existing ? `<p class="tiny muted" style="margin:-4px 0 10px">💡 Esto se guarda solo en la bitácora del vehículo. Si quieres que el costo <b>también cuente en tus gastos</b>, regístralo desde <b>Movimientos → + → asociar al vehículo → Mantenimiento</b>.</p>` : ""}
    ${f("Categoría", `<select id="ma-cat" class="input">${catOpts}</select>`)}
    ${f("Tipo", `<select id="ma-tipo" class="input"></select>`)}
    ${f("Fecha", `<input id="ma-fecha" type="date" class="input" value="${existing ? existing.fecha : todayISO()}">`)}
    ${f("Odómetro (km) — opcional", `<input id="ma-odo" type="number" class="input" value="${existing ? val(existing.odometro) : (v.odometro ?? "")}" placeholder="Vacío si no aplica">`)}
    <p class="tiny muted" style="margin:-6px 0 10px" id="ma-odo-hint">Déjalo vacío si es una <b>compra de insumos</b> (aceite, filtro, repuesto sin instalar): no afecta el kilometraje del vehículo.</p>
    ${f("Descripción", `<input id="ma-desc" class="input" value="${existing ? escapeHtml(existing.descripcion || "") : ""}" placeholder="Detalle (opcional)">`)}
    ${f("Repuesto", `<input id="ma-rep" class="input" value="${existing ? escapeHtml(existing.repuesto || "") : ""}" placeholder="Opcional">`)}
    ${f("Taller", `<input id="ma-taller" class="input" value="${existing ? escapeHtml(existing.taller || "") : ""}" placeholder="Opcional">`)}
    ${f("Costo (COP)", `<input id="ma-costo" type="number" class="input" value="${existing ? val(existing.costo) : ""}" placeholder="0" ${existing && existing.gastoId && !existing.visitaId ? "readonly style='opacity:.55'" : ""}>`)}
    ${existing && existing.gastoId && !existing.visitaId ? `<p class="tiny muted">🔗 El valor y la fecha están vinculados a un gasto en Movimientos. Para cambiarlos, edita ese gasto.</p>` : ""}
    ${existing && existing.visitaId ? `<p class="tiny muted">🧾 Línea de una visita. Al cambiar su costo, el total de la visita y su gasto se recalculan.</p>` : ""}
    <div class="card-title" style="margin-top:10px;font-size:13px">Próximo aviso (opcional)</div>
    ${f("Avisar a los (km)", `<input id="ma-pkm" type="number" class="input" value="${existing ? val(existing.proximoKm) : ""}" placeholder="km absoluto, ej: 12000">`)}
    ${f("o repetir cada (km)", `<input id="ma-rkm" type="number" class="input" value="${existing ? val(existing.recurrenteKm) : ""}" placeholder="ej: 1000 (cadena)">`)}
    ${f("Avisar en la fecha", `<input id="ma-pfecha" type="date" class="input" value="${existing ? val(existing.proximaFecha) : ""}">`)}
    ${f("o repetir cada (días)", `<input id="ma-rdias" type="number" class="input" value="${existing ? val(existing.recurrenteDias) : ""}" placeholder="ej: 180">`)}
    <button id="ma-save" class="btn btn-primary btn-block mt-2">${existing ? "Guardar cambios" : "Guardar"}</button>`, {
    onMount(b) {
      moneyPreview(b.querySelector("#ma-costo"));
      const catSel = b.querySelector("#ma-cat"), tipoSel = b.querySelector("#ma-tipo");
      const fillTipos = () => {
        const list = MAINT_TIPOS[catSel.value] || [];
        // conserva el tipo libre de una línea de visita (p. ej. "Juego pastillas del.") aunque no esté en la lista
        const arr = (existing && existing.tipo && !list.includes(existing.tipo)) ? [existing.tipo, ...list] : list;
        tipoSel.innerHTML = arr.map((t) => `<option>${escapeHtml(t)}</option>`).join("");
      };
      catSel.onchange = () => {
        fillTipos();
        // Insumos = compra sin instalar → el odómetro no aplica: se limpia solo (editable si se quiere)
        if (catSel.value === "Insumos" && !existing) b.querySelector("#ma-odo").value = "";
      };
      fillTipos();
      if (existing && existing.tipo) tipoSel.value = existing.tipo;
      submitOnce(b.querySelector("#ma-save"), async () => {
        const num = (id) => { const x = b.querySelector("#" + id).value; return x === "" ? null : +x; };
        const rec = {
          id: existing ? existing.id : uid(), vehicleId: v.id, categoria: catSel.value, tipo: tipoSel.value,
          fecha: b.querySelector("#ma-fecha").value, odometro: num("ma-odo"),
          descripcion: b.querySelector("#ma-desc").value.trim(), repuesto: b.querySelector("#ma-rep").value.trim(),
          taller: b.querySelector("#ma-taller").value.trim(), costo: num("ma-costo") || 0,
          proximoKm: num("ma-pkm"), recurrenteKm: num("ma-rkm"), proximaFecha: b.querySelector("#ma-pfecha").value || "", recurrenteDias: num("ma-rdias"),
          reorgOk: true, // tipo elegido a mano: no sugerir reorganización
        };
        if (existing && existing.gastoId) rec.gastoId = existing.gastoId; // conserva el vínculo con el gasto
        // conserva los campos propios de una línea de visita (no los pide este formulario)
        if (existing && existing.visitaId) {
          rec.visitaId = existing.visitaId; rec.claseLinea = existing.claseLinea; rec.referencia = existing.referencia || "";
          rec.cantidad = existing.cantidad || 1; rec.valorUnit = rec.cantidad ? (rec.costo / rec.cantidad) : rec.costo;
        }
        if (!rec.fecha) return toast("Falta la fecha", true);
        allMaint = existing ? allMaint.map((x) => (x.id === rec.id ? rec : x)) : [...allMaint, rec];
        await addMaint(getState().user.uid, rec); persistMaintLocal(getState().user.uid, allMaint);
        if (rec.visitaId) await recalcVisitGasto(rec.visitaId);
        if ((rec.odometro || 0) > (v.odometro || 0)) { setState({ vehicles: getState().vehicles.map((x) => (x.id === v.id ? { ...x, odometro: rec.odometro } : x)) }); v.odometro = rec.odometro; await persistVehicles(); }
        closeModal(); drawMaint(root, v); toast(existing ? "Mantenimiento actualizado" : "Mantenimiento registrado");
      });
    },
  });
}

/* ===================== OBLIGACIONES LEGALES ===================== */
async function renderOblig(root, vid) {
  const s = getState();
  const v = (s.vehicles || []).find((x) => x.id === vid);
  if (!v) { activeObligVid = null; return renderList(root); }
  root.innerHTML = `<div style="min-height:50vh;display:grid;place-items:center"><div class="loader spin"></div></div>`;
  allOblig = await loadOblig(s.user.uid);
  drawOblig(root, v);
}

function drawOblig(root, v) {
  const items = allOblig.filter((r) => r.vehicleId === v.id).sort((a, b) => (a.fechaVencimiento || "9999").localeCompare(b.fechaVencimiento || "9999"));
  const today = todayISO();
  const obligDupes = dupeCount(items);
  root.innerHTML = `
    <div class="row gap-2 mb-3" style="align-items:center">
      <button id="back" class="icon-btn"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg></button>
      <div><div class="page-title disp" style="font-size:21px;margin:0">📋 Obligaciones</div><div class="tiny muted">${icon(v.tipo)} ${escapeHtml(v.alias || v.modelo)}</div></div>
    </div>
    <button id="add-oblig" class="btn btn-primary btn-block mb-2">+ Obligación</button>
    <button id="import-oblig" class="btn btn-ghost btn-block mb-2">📥 Importar pagos (impuesto/SOAT/RTM)</button>
    ${obligDupes ? `<button id="dedupe-oblig" class="btn btn-ghost btn-block mb-3" style="color:var(--red)">🧹 Quitar ${obligDupes} duplicado(s)</button>` : ""}
    ${items.length ? `<div class="card" style="padding:0" id="oblig-list"></div>` : `<div class="empty"><p>Sin obligaciones. Registra SOAT, tecnomecánica, impuesto o licencia con su fecha de vencimiento para recibir alarmas.</p></div>`}
    <p class="tiny muted mt-3">Las reglas y fechas varían por departamento y cambian cada año. Es un recordatorio configurable, no una autoridad legal. Verifica en RUNT / Secretaría de Movilidad / Gobernación.</p>`;
  root.querySelector("#back").onclick = () => { activeObligVid = null; renderList(root); };
  root.querySelector("#add-oblig").onclick = () => openObligModal(v, root);
  root.querySelector("#import-oblig").onclick = () => openImportOblig(v, root);
  const dedupeObBtn = root.querySelector("#dedupe-oblig");
  if (dedupeObBtn) dedupeObBtn.onclick = () => confirmDialog(`Se encontraron ${obligDupes} registro(s) repetido(s) (mismo pago importado varias veces). Se quitan los repetidos y se deja uno por pago. No se borra ningún gasto de Movimientos.`, async () => {
    const { delIds, keepByGasto } = planDedupe(allOblig.filter((r) => r.vehicleId === v.id));
    allOblig = allOblig.filter((r) => !delIds.includes(r.id));
    for (const id of delIds) await deleteOblig(getState().user.uid, id);
    persistObligLocal(getState().user.uid, allOblig);
    const changedTx = getState().txs.filter((t) => keepByGasto[t.id] && t.obligId !== keepByGasto[t.id]).map((t) => ({ ...t, obligId: keepByGasto[t.id] }));
    if (changedTx.length) { const m = Object.fromEntries(changedTx.map((t) => [t.id, t])); setState({ txs: getState().txs.map((x) => m[x.id] || x) }); await bulkUpdateTx(getState().user.uid, changedTx); forcePersistLocal(getState().user.uid); }
    drawOblig(root, v); toast(`${delIds.length} duplicado(s) eliminado(s)`);
  });
  if (items.length) {
    root.querySelector("#oblig-list").innerHTML = items.map((o) => {
      const st = obligStatus(o, today);
      return `<div class="tx-row" data-rowo="${o.id}" style="cursor:pointer">
        <div class="flex1"><div class="tx-desc">${st.dot} ${escapeHtml(obligLabel(o.tipo))}</div>
          <div class="tx-meta">${o.fechaVencimiento ? "Vence " + escapeHtml(o.fechaVencimiento) : "sin fecha"}${o.entidad ? " · " + escapeHtml(o.entidad) : ""} · <span style="color:${st.color}">${st.lbl}</span></div></div>
        <div class="tx-amt">${o.costo ? fmt(o.costo) : ""}</div>
        <button class="icon-btn" data-delo="${o.id}"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2m-9 0v14h10V6"/></svg></button>
      </div>`;
    }).join("");
    root.querySelectorAll("[data-rowo]").forEach((rw) => rw.onclick = (e) => { if (e.target.closest("[data-delo]")) return; openObligModal(v, root, allOblig.find((x) => x.id === rw.getAttribute("data-rowo"))); });
    root.querySelectorAll("[data-delo]").forEach((b) => b.onclick = (e) => {
      e.stopPropagation();
      const id = b.getAttribute("data-delo"); const rec = allOblig.find((x) => x.id === id);
      const msg = rec && rec.gastoId
        ? "Se quita esta obligación del módulo. <b>El gasto NO se borra</b>: sigue en Movimientos; solo se elimina el vínculo con el vehículo."
        : "¿Eliminar esta obligación?";
      confirmDialog(msg, async () => {
        allOblig = allOblig.filter((x) => x.id !== id);
        await deleteOblig(getState().user.uid, id); persistObligLocal(getState().user.uid, allOblig);
        if (rec && rec.gastoId) await unlinkGasto(rec.gastoId, "obligId");
        drawOblig(root, v); toast(rec && rec.gastoId ? "Obligación quitada (el gasto sigue en Movimientos)" : "Obligación eliminada");
      });
    });
  }
}

function openObligModal(v, root, existing) {
  const f = (l, h) => `<div class="field"><label class="label">${l}</label>${h}</div>`;
  const tipoOpts = OBLIG_TIPOS.map((t) => `<option value="${t.key}" ${existing && existing.tipo === t.key ? "selected" : ""}>${t.label}</option>`).join("");
  const avisoOpts = AVISO_DIAS.map((d) => `<option value="${d}" ${existing && existing.diasAviso === d ? "selected" : (!existing && d === 30 ? "selected" : "")}>${d} días antes</option>`).join("");
  const val = (x) => (x != null && x !== "" ? x : "");
  openModal(existing ? "Obligación" : "Nueva obligación", `
    ${f("Tipo", `<select id="o-tipo" class="input">${tipoOpts}</select>`)}
    ${f("Fecha de vencimiento", `<input id="o-venc" type="date" class="input" value="${existing ? val(existing.fechaVencimiento) : ""}">`)}
    ${f("Fecha de expedición (opcional)", `<input id="o-exp" type="date" class="input" value="${existing ? val(existing.fechaExpedicion) : ""}">`)}
    ${f("Costo (COP)", `<input id="o-costo" type="number" class="input" value="${existing ? val(existing.costo) : ""}" placeholder="0">`)}
    ${f("Entidad", `<input id="o-ent" class="input" value="${existing ? escapeHtml(existing.entidad || "") : ""}" placeholder="Aseguradora, CDA, gobernación…">`)}
    ${f("N° / referencia", `<input id="o-num" class="input" value="${existing ? escapeHtml(existing.numero || "") : ""}" placeholder="Opcional">`)}
    ${f("Avisar con", `<select id="o-aviso" class="input">${avisoOpts}</select>`)}
    ${f("Estado", `<select id="o-estado" class="input"><option value="">Normal (según fecha)</option><option value="TRAMITE" ${existing && existing.estado === "TRAMITE" ? "selected" : ""}>Trámite en curso / pagado</option></select>`)}
    ${f("Notas", `<input id="o-notas" class="input" value="${existing ? escapeHtml(existing.notas || "") : ""}" placeholder="Opcional">`)}
    <button id="o-save" class="btn btn-primary btn-block mt-2">${existing ? "Guardar cambios" : "Guardar"}</button>`, {
    onMount(b) {
      moneyPreview(b.querySelector("#o-costo"));
      submitOnce(b.querySelector("#o-save"), async () => {
        const num = (id) => { const x = b.querySelector("#" + id).value; return x === "" ? null : +x; };
        const rec = {
          id: existing ? existing.id : uid(), vehicleId: v.id, tipo: b.querySelector("#o-tipo").value,
          fechaVencimiento: b.querySelector("#o-venc").value || "", fechaExpedicion: b.querySelector("#o-exp").value || "",
          costo: num("o-costo") || 0, entidad: b.querySelector("#o-ent").value.trim(), numero: b.querySelector("#o-num").value.trim(),
          diasAviso: +b.querySelector("#o-aviso").value || 30, estado: b.querySelector("#o-estado").value || "", notas: b.querySelector("#o-notas").value.trim(),
        };
        if (!rec.fechaVencimiento && rec.estado !== "TRAMITE") return toast("Pon la fecha de vencimiento", true);
        allOblig = existing ? allOblig.map((x) => (x.id === rec.id ? rec : x)) : [...allOblig, rec];
        await addOblig(getState().user.uid, rec); persistObligLocal(getState().user.uid, allOblig);
        closeModal(); drawOblig(root, v); toast(existing ? "Obligación actualizada" : "Obligación registrada");
      });
    },
  });
}

/* ===================== IMPORTAR GASTOS EXISTENTES ===================== */
const isVehCat = (n) => /moto|carro|veh[ií]culo|autom[oó]vil|\bauto\b/i.test(n || "");
// cuántos registros sobran por compartir el mismo gastoId (duplicados de importación)
function dupeCount(items) {
  const c = {};
  items.forEach((r) => { if (r.gastoId) c[r.gastoId] = (c[r.gastoId] || 0) + 1; });
  return Object.values(c).reduce((s, n) => s + (n > 1 ? n - 1 : 0), 0);
}
// devuelve { delIds, keepByGasto } para quitar repetidos dejando uno por gastoId
function planDedupe(items) {
  const byG = {};
  items.forEach((r) => { if (r.gastoId) (byG[r.gastoId] = byG[r.gastoId] || []).push(r); });
  const delIds = [], keepByGasto = {};
  Object.entries(byG).forEach(([g, grp]) => { if (grp.length > 1) { keepByGasto[g] = grp[0].id; grp.slice(1).forEach((r) => delIds.push(r.id)); } });
  return { delIds, keepByGasto };
}
// quita el vínculo de un gasto con el módulo (NO borra el gasto): limpia fuelId/maintId/obligId
async function unlinkGasto(gastoId, field) {
  const tx = getState().txs.find((x) => x.id === gastoId);
  if (!tx) return;
  const updated = { ...tx, [field]: "" };
  setState({ txs: getState().txs.map((x) => (x.id === gastoId ? updated : x)) });
  await bulkUpdateTx(getState().user.uid, [updated]); forcePersistLocal(getState().user.uid);
}
// palabras que delatan una obligación legal (no van a mantenimiento)
const OBLIG_RX = /impuesto|soat|tecnomec|tecno\s?mec|\brtm\b|revisi[oó]n t[eé]cnico|licencia|matr[ií]cula|matricula|p[oó]liza/i;
// adivina el tipo de mantenimiento por la descripción
function guessMaintTipo(desc) {
  const d = (desc || "").toLowerCase();
  if (/llanta|neum/.test(d)) return ["Taller", "Llantas"];
  if (/aceite/.test(d)) return ["Taller", "Cambio de aceite"];
  if (/freno|pastilla/.test(d)) return ["Taller", "Frenos (pastillas)"];
  if (/cadena|arrastre|piñon|sprocket|kit/.test(d)) return ["Taller", "Kit de arrastre"];
  if (/buj[ií]a/.test(d)) return ["Taller", "Bujía"];
  if (/bater/.test(d)) return ["Taller", "Batería"];
  if (/filtro/.test(d)) return ["Taller", "Filtro de aceite"];
  if (/sincron|v[aá]lvula|valvula/.test(d)) return ["Taller", "Sincronización / válvulas"];
  return ["Taller", "Reparación"];
}
// adivina el tipo de obligación por la descripción
function guessObligTipo(desc) {
  const d = (desc || "").toLowerCase();
  if (/soat/.test(d)) return "SOAT";
  if (/tecnomec|tecno\s?mec|\brtm\b|revisi[oó]n t[eé]cnico/.test(d)) return "RTM";
  if (/licencia|pase/.test(d)) return "LICENCIA";
  return "IMPUESTO";
}
function addYear(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y + 1, m - 1, d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

// IMPORTADOR DE MANTENIMIENTO: gastos de mantenimiento de vehículo → bitácora
function openImportMaint(v, root) {
  const s = getState();
  const linkedIds = new Set(allMaint.map((m) => m.gastoId).filter(Boolean));
  // candidatos: gasto de categoría de vehículo, subcategoría de mantenimiento/reparación,
  // sin enlace previo, que NO sea combustible ni una obligación legal
  const cands = (s.txs || []).filter((t) =>
    isVehCat(t.cat) && /mantenim|reparac/i.test(t.sub || "") &&
    !t.maintId && !t.fuelId && !linkedIds.has(t.id) && !OBLIG_RX.test(t.desc || "")
  ).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  if (!cands.length) return toast("No hay gastos de mantenimiento por importar", true);
  const tipoOptsFor = (tipo) => MAINT_TIPOS.Taller.map((t) => `<option ${t === tipo ? "selected" : ""}>${escapeHtml(t)}</option>`).join("");
  const rows = cands.map((t, i) => {
    const [, tipo] = guessMaintTipo(t.desc);
    return `<label class="tx-row" style="cursor:pointer;align-items:center;gap:8px">
      <input type="checkbox" class="imp-chk" data-i="${i}" checked style="width:18px;height:18px;flex:none">
      <div class="flex1" style="min-width:0">
        <div class="tx-desc ellipsis">${escapeHtml(t.desc || "(sin descripción)")}</div>
        <div class="tx-meta">${escapeHtml(t.date)} · ${fmt(t.amount)}</div>
        <select class="imp-tipo input" data-i="${i}" style="margin-top:4px;height:34px;font-size:13px">${tipoOptsFor(tipo)}</select>
      </div></label>`;
  }).join("");
  openModal("Importar a Mantenimiento", `
    <p class="tiny muted" style="margin:-4px 0 8px">${cands.length} gasto(s) de mantenimiento de ${escapeHtml(v.alias || v.modelo)}. Revisa el tipo, desmarca los que no quieras y confirma. Cada uno se enlaza a la bitácora sin borrar ni duplicar el gasto.</p>
    <div class="row gap-2 mb-2"><button id="imp-all" class="btn btn-ghost btn-sm">Marcar todos</button><button id="imp-none" class="btn btn-ghost btn-sm">Ninguno</button></div>
    <div class="card" style="padding:0;max-height:48vh;overflow:auto">${rows}</div>
    <button id="imp-save" class="btn btn-primary btn-block mt-3">Importar seleccionados</button>`, {
    onMount(b) {
      b.querySelector("#imp-all").onclick = () => b.querySelectorAll(".imp-chk").forEach((c) => (c.checked = true));
      b.querySelector("#imp-none").onclick = () => b.querySelectorAll(".imp-chk").forEach((c) => (c.checked = false));
      submitOnce(b.querySelector("#imp-save"), async () => {
        const chosen = [...b.querySelectorAll(".imp-chk")].filter((c) => c.checked).map((c) => +c.getAttribute("data-i"));
        if (!chosen.length) return toast("No marcaste ninguno", true);
        const newMaint = [], changedTx = [];
        for (const i of chosen) {
          const t = cands[i];
          const tipo = b.querySelector(`.imp-tipo[data-i="${i}"]`).value;
          const rec = { id: uid(), vehicleId: v.id, categoria: "Taller", tipo, fecha: t.date, odometro: null, descripcion: t.desc || "", repuesto: "", taller: "", costo: +t.amount || 0, proximoKm: null, recurrenteKm: null, proximaFecha: "", recurrenteDias: null, gastoId: t.id };
          newMaint.push(rec);
          changedTx.push({ ...t, vehicleId: v.id, maintId: rec.id });
        }
        const tmap = Object.fromEntries(changedTx.map((t) => [t.id, t]));
        setState({ txs: getState().txs.map((x) => tmap[x.id] || x) });
        allMaint = [...allMaint, ...newMaint];
        await bulkAddMaint(s.user.uid, newMaint); persistMaintLocal(s.user.uid, allMaint);
        await bulkUpdateTx(s.user.uid, changedTx); forcePersistLocal(s.user.uid);
        closeModal(); drawMaint(root, v); toast(`${newMaint.length} importado(s) a Mantenimiento`);
      }, "Importando…");
    },
  });
}

// IMPORTADOR DE OBLIGACIONES: pagos de impuesto/SOAT/RTM → módulo de Obligaciones
function openImportOblig(v, root) {
  const s = getState();
  const linkedIds = new Set(allOblig.map((o) => o.gastoId).filter(Boolean));
  const cands = (s.txs || []).filter((t) =>
    isVehCat(t.cat) && OBLIG_RX.test(t.desc || "") && !t.obligId && !linkedIds.has(t.id)
  ).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  if (!cands.length) return toast("No hay pagos (impuesto/SOAT/RTM) por importar", true);
  // por defecto marcamos solo el pago MÁS RECIENTE de cada tipo (el que da un aviso útil)
  const latestByTipo = {};
  cands.forEach((t) => { const k = guessObligTipo(t.desc); if (!latestByTipo[k] || (t.date || "") > (latestByTipo[k].date || "")) latestByTipo[k] = t; });
  const isLatest = (t) => latestByTipo[guessObligTipo(t.desc)] === t;
  const tipoOptsFor = (k) => OBLIG_TIPOS.map((o) => `<option value="${o.key}" ${o.key === k ? "selected" : ""}>${escapeHtml(o.label)}</option>`).join("");
  const rows = cands.map((t, i) => `<label class="tx-row" style="cursor:pointer;align-items:center;gap:8px">
      <input type="checkbox" class="imp-chk" data-i="${i}" ${isLatest(t) ? "checked" : ""} style="width:18px;height:18px;flex:none">
      <div class="flex1" style="min-width:0">
        <div class="tx-desc ellipsis">${escapeHtml(t.desc || "(sin descripción)")}${isLatest(t) ? ` <span class="tiny" style="color:var(--green)">· más reciente</span>` : ""}</div>
        <div class="tx-meta">${escapeHtml(t.date)} · ${fmt(t.amount)}</div>
        <select class="imp-tipo input" data-i="${i}" style="margin-top:4px;height:34px;font-size:13px">${tipoOptsFor(guessObligTipo(t.desc))}</select>
      </div></label>`).join("");
  openModal("Importar a Obligaciones", `
    <p class="tiny muted" style="margin:-4px 0 8px">${cands.length} pago(s) de ${escapeHtml(v.alias || v.modelo)}. El vencimiento se estima en <b>1 año después</b> del pago. Marqué solo el <b>más reciente</b> de cada tipo (da un aviso útil); los viejos los puedes marcar si los quieres como historial (saldrán como "vencido").</p>
    <div class="row gap-2 mb-2"><button id="imp-all" class="btn btn-ghost btn-sm">Marcar todos</button><button id="imp-none" class="btn btn-ghost btn-sm">Ninguno</button></div>
    <div class="card" style="padding:0;max-height:48vh;overflow:auto">${rows}</div>
    <button id="imp-save" class="btn btn-primary btn-block mt-3">Importar seleccionados</button>`, {
    onMount(b) {
      b.querySelector("#imp-all").onclick = () => b.querySelectorAll(".imp-chk").forEach((c) => (c.checked = true));
      b.querySelector("#imp-none").onclick = () => b.querySelectorAll(".imp-chk").forEach((c) => (c.checked = false));
      submitOnce(b.querySelector("#imp-save"), async () => {
        const chosen = [...b.querySelectorAll(".imp-chk")].filter((c) => c.checked).map((c) => +c.getAttribute("data-i"));
        if (!chosen.length) return toast("No marcaste ninguno", true);
        const newOblig = [], changedTx = [];
        for (const i of chosen) {
          const t = cands[i];
          const tipo = b.querySelector(`.imp-tipo[data-i="${i}"]`).value;
          const rec = { id: uid(), vehicleId: v.id, tipo, fechaVencimiento: addYear(t.date), fechaExpedicion: t.date, costo: +t.amount || 0, entidad: "", numero: "", diasAviso: 30, estado: "", notas: "Importado de Movimientos", gastoId: t.id };
          newOblig.push(rec);
          changedTx.push({ ...t, vehicleId: v.id, obligId: rec.id });
        }
        const tmap = Object.fromEntries(changedTx.map((t) => [t.id, t]));
        setState({ txs: getState().txs.map((x) => tmap[x.id] || x) });
        allOblig = [...allOblig, ...newOblig];
        await bulkAddOblig(s.user.uid, newOblig); persistObligLocal(s.user.uid, allOblig);
        await bulkUpdateTx(s.user.uid, changedTx); forcePersistLocal(s.user.uid);
        closeModal(); drawOblig(root, v); toast(`${newOblig.length} importado(s) a Obligaciones`);
      }, "Importando…");
    },
  });
}

function kpi(label, val, sm) { return `<div class="kpi"><div class="k-label">${label}</div><div class="k-val ${sm ? "sm" : ""}">${val}</div></div>`; }
