// js/views/vehicles.js — Módulo de Vehículos (Fase 1: registro · Fase 2: combustible)
import { getState, setState } from "../state.js";
import { saveConfig, forcePersistLocal, loadFuel, addFuel, deleteFuel, bulkSetFuel, persistFuelLocal } from "../firebase-service.js";
import { VEHICLE_TYPES, FUEL_TYPES, SERVICE_TYPES, DEPARTAMENTOS, PALETTE } from "../config.js";
import { uid, escapeHtml, fmt, todayISO, ym, monthLabel, sum, curMonth } from "../utils.js";
import { openModal, closeModal, toast, confirmDialog } from "../components/modals.js";
import { donut, lineTrend, lineNum } from "../components/charts.js";

const icon = (t) => (t === "Moto" ? "🏍️" : "🚗");
let activeFuelVid = null;   // si está fijo, mostramos la bitácora de ese vehículo
let allFuel = [];           // cache de todos los tanqueos (todos los vehículos)

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
  await saveConfig(s.user.uid, { profile: s.profile, cats: s.cats, budgets: s.budgets, accounts: s.accounts, payMethods: s.payMethods, vehicles: s.vehicles, vehiclesEnabled: s.vehiclesEnabled });
  forcePersistLocal(s.user.uid);
}

export function renderVehicles(root) {
  if (activeFuelVid) return renderFuel(root, activeFuelVid);
  renderList(root);
}

/* ===================== LISTA / REGISTRO ===================== */
function renderList(root) {
  root.innerHTML = `
    <h2 class="page-title disp">Vehículos</h2>
    <p class="page-sub">Tus vehículos: moto, carro o varios</p>
    <button id="add-veh" class="btn btn-primary btn-block mb-4">+ Agregar vehículo</button>
    <div id="veh-list"></div>`;
  root.querySelector("#add-veh").onclick = () => openVehicleModal(null, root);
  drawList(root);
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
      <button class="btn btn-ghost btn-sm btn-block mt-3" data-fuel="${v.id}">⛽ Combustible</button>
    </div>`).join("");

  list.querySelectorAll("[data-edit]").forEach((b) => b.onclick = () => openVehicleModal(getState().vehicles.find((x) => x.id === b.getAttribute("data-edit")), root));
  list.querySelectorAll("[data-del]").forEach((b) => b.onclick = () => confirmDialog("¿Eliminar este vehículo?", async () => {
    setState({ vehicles: getState().vehicles.filter((x) => x.id !== b.getAttribute("data-del")) });
    await persistVehicles(); drawList(root); toast("Vehículo eliminado");
  }));
  list.querySelectorAll("[data-fuel]").forEach((b) => b.onclick = () => { activeFuelVid = b.getAttribute("data-fuel"); renderFuel(root, activeFuelVid); });
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
      b.querySelector("#v-save").onclick = async () => {
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
      };
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
  let lastOdo = null, galAcc = 0;
  const points = [];
  for (const r of sorted) {
    galAcc += +r.galones || 0;
    const lleno = r.tanqueLleno === "Sí" || r.tanqueLleno === true;
    if (lleno) {
      if (lastOdo != null && r.odometro > lastOdo && galAcc > 0) {
        const dist = r.odometro - lastOdo;
        points.push({ fecha: r.fecha, rend: dist / galAcc, dist, gal: galAcc });
      }
      lastOdo = r.odometro; galAcc = 0;
    }
  }
  const distTot = sum(points, (p) => p.dist), galTot = sum(points, (p) => p.gal);
  return { sorted, points, rendAvg: galTot ? distTot / galTot : 0, distTot };
}

function drawFuel(root, v) {
  const fuel = allFuel.filter((r) => r.vehicleId === v.id);
  const m = computeMetrics(fuel);
  const costoTot = sum(fuel, (r) => +r.costo || 0);
  const galTot = sum(fuel, (r) => +r.galones || 0);
  const costoKm = m.distTot ? costoTot / m.distTot : 0;
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
      <div><div class="page-title disp" style="font-size:21px;margin:0">⛽ Combustible</div><div class="tiny muted">${icon(v.tipo)} ${escapeHtml(v.alias || v.modelo)}</div></div>
    </div>
    <div class="row gap-2 wrap mb-3">
      <button id="add-fuel" class="btn btn-primary btn-sm">+ Tanqueo</button>
      <input id="imp-fuel" type="file" accept=".xlsx,.xls" hidden>
      <button id="imp-fuel-btn" class="btn btn-ghost btn-sm">⬆ Importar Excel</button>
      <button id="exp-xls" class="btn btn-ghost btn-sm">⬇ Excel</button>
      <button id="exp-json" class="btn btn-ghost btn-sm">⬇ JSON</button>
    </div>

    <div class="grid-kpi mb-4">
      ${kpi("Rendimiento prom.", m.rendAvg ? m.rendAvg.toFixed(1) + " km/gal" : "—")}
      ${kpi("Costo por km", m.distTot ? fmt(costoKm) : "—")}
      ${kpi("Gasto total", fmt(costoTot))}
      ${kpi("Gasto/mes prom.", mKeys.length ? fmt(gastoMes) : "—", true)}
      ${kpi("Galones total", galTot.toFixed(1))}
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
      <div class="card"><div class="card-title">Gasto por estación</div><div class="chart-box"><canvas id="ch-est"></canvas></div><div id="leg-est" class="row wrap gap-2 mt-2"></div></div>
    </div>
    <div class="card mt-3" style="padding:0" id="fuel-list"></div>`
    : `<div class="empty"><p>Sin tanqueos aún. Toca "+ Tanqueo" para registrar, o "Importar Excel" para cargar tu histórico.</p></div>`}`;

  root.querySelector("#back").onclick = () => { activeFuelVid = null; renderList(root); };
  root.querySelector("#add-fuel").onclick = () => openFuelModal(v, root);
  const imp = root.querySelector("#imp-fuel");
  root.querySelector("#imp-fuel-btn").onclick = () => imp.click();
  imp.onchange = () => importFuelXlsx(v, root, imp);
  root.querySelector("#exp-json").onclick = () => exportJson(v, fuel);
  root.querySelector("#exp-xls").onclick = () => exportXlsx(v, fuel);

  if (fuel.length) {
    lineNum("ch-rend", m.points.map((p) => p.fecha), m.points.map((p) => +p.rend.toFixed(1)), "#7fbf7f", "");
    lineTrend("ch-mes", mKeys.map((k) => monthLabel(k)), mKeys.map((k) => Math.round(months[k])));
    donut("ch-est", estE.map((e) => e[0]), estE.map((e) => e[1]));
    root.querySelector("#leg-est").innerHTML = estE.map((e, i) => `<span class="tiny muted row gap-1"><span style="width:9px;height:9px;border-radius:3px;background:${PALETTE[i % PALETTE.length]}"></span>${escapeHtml(e[0])} ${fmt(e[1])}</span>`).join("");
    drawFuelList(root, v, m.sorted);
  }
}

function drawFuelList(root, v, sorted) {
  const rows = [...sorted].reverse().slice(0, 300);
  root.querySelector("#fuel-list").innerHTML = rows.map((r) => `
    <div class="tx-row">
      <div class="flex1"><div class="tx-desc">${escapeHtml(r.fecha)} · ${escapeHtml(r.estacion || "—")}${r.tanqueLleno === "No" || r.tanqueLleno === false ? ' <span class="tiny" style="color:var(--yel)">parcial</span>' : ""}</div>
        <div class="tx-meta">${(+r.galones).toFixed(2)} gal · ${Number(r.odometro).toLocaleString("es-CO")} km${r.rendimiento ? " · " + r.rendimiento + " km/gal" : ""}</div></div>
      <div class="tx-amt">${fmt(r.costo)}</div>
      <button class="icon-btn" data-delf="${r.id}"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2m-9 0v14h10V6"/></svg></button>
    </div>`).join("");
  root.querySelectorAll("[data-delf]").forEach((b) => b.onclick = () => confirmDialog("¿Eliminar este tanqueo?", async () => {
    const id = b.getAttribute("data-delf");
    allFuel = allFuel.filter((x) => x.id !== id);
    await deleteFuel(getState().user.uid, id); persistFuelLocal(getState().user.uid, allFuel);
    drawFuel(root, v); toast("Eliminado");
  }));
}

function openFuelModal(v, root) {
  const f = (label, html) => `<div class="field"><label class="label">${label}</label>${html}</div>`;
  const fuelOpts = FUEL_TYPES.map((t) => `<option ${t === (v.combustible || "Corriente") ? "selected" : ""}>${t}</option>`).join("");
  openModal("Nuevo tanqueo", `
    ${f("Fecha", `<input id="t-fecha" class="input" type="date" value="${todayISO()}">`)}
    ${f("Estación", `<input id="t-est" class="input" placeholder="Ej: Terpel">`)}
    ${f("Tipo de combustible", `<select id="t-tipo" class="input">${fuelOpts}</select>`)}
    ${f("Galones", `<input id="t-gal" class="input" type="number" step="0.001" placeholder="Ej: 2.5">`)}
    ${f("Odómetro (km del tablero)", `<input id="t-odo" class="input" type="number" value="${v.odometro ?? ""}" placeholder="0">`)}
    ${f("Costo (COP)", `<input id="t-costo" class="input" type="number" placeholder="0">`)}
    ${f("¿Tanque lleno?", `<select id="t-lleno" class="input"><option>Sí</option><option>No</option></select>`)}
    <button id="t-save" class="btn btn-primary btn-block mt-2">Guardar tanqueo</button>`, {
    onMount(b) {
      b.querySelector("#t-save").onclick = async () => {
        const rec = {
          id: uid(), vehicleId: v.id, fecha: b.querySelector("#t-fecha").value,
          estacion: b.querySelector("#t-est").value.trim(), tipoCombustible: b.querySelector("#t-tipo").value,
          galones: +b.querySelector("#t-gal").value, odometro: +b.querySelector("#t-odo").value,
          costo: +b.querySelector("#t-costo").value || 0, tanqueLleno: b.querySelector("#t-lleno").value,
        };
        if (!rec.galones || !rec.odometro) return toast("Faltan galones u odómetro", true);
        allFuel.push(rec);
        await addFuel(getState().user.uid, rec); persistFuelLocal(getState().user.uid, allFuel);
        // avanza el odómetro del vehículo si este es mayor
        if (rec.odometro > (v.odometro || 0)) {
          const list = getState().vehicles.map((x) => (x.id === v.id ? { ...x, odometro: rec.odometro } : x));
          setState({ vehicles: list }); v.odometro = rec.odometro; await persistVehicles();
        }
        closeModal(); drawFuel(root, v); toast("Tanqueo registrado");
      };
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
      if (fecha instanceof Date) fecha = fecha.toISOString().slice(0, 10); else fecha = String(fecha).slice(0, 10);
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
    const maxOdo = Math.max(...recs.map((r) => r.odometro));
    if (maxOdo > (v.odometro || 0)) { const list = getState().vehicles.map((x) => (x.id === v.id ? { ...x, odometro: maxOdo } : x)); setState({ vehicles: list }); v.odometro = maxOdo; await persistVehicles(); }
    drawFuel(root, v); toast(recs.length + " tanqueos importados");
  } catch (e) { console.error(e); toast("Error al leer el Excel", true); }
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

function kpi(label, val, sm) { return `<div class="kpi"><div class="k-label">${label}</div><div class="k-val ${sm ? "sm" : ""}">${val}</div></div>`; }
