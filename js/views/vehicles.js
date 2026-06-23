// js/views/vehicles.js — Módulo de Vehículos (Fase 1: registro)
import { getState, setState } from "../state.js";
import { saveConfig, forcePersistLocal } from "../firebase-service.js";
import { VEHICLE_TYPES, FUEL_TYPES, SERVICE_TYPES, DEPARTAMENTOS } from "../config.js";
import { uid, escapeHtml, fmt } from "../utils.js";
import { openModal, closeModal, toast, confirmDialog } from "../components/modals.js";

const icon = (t) => (t === "Moto" ? "🏍️" : "🚗");

async function persistVehicles() {
  const s = getState();
  await saveConfig(s.user.uid, {
    profile: s.profile, cats: s.cats, budgets: s.budgets, accounts: s.accounts,
    payMethods: s.payMethods, vehicles: s.vehicles, vehiclesEnabled: s.vehiclesEnabled,
  });
  forcePersistLocal(s.user.uid);
}

export function renderVehicles(root) {
  const s = getState();
  const vs = s.vehicles || [];
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
    list.innerHTML = `<div class="empty"><p>Aún no tienes vehículos. Toca "+ Agregar vehículo" para registrar tu moto o carro.<br>
      Puedes empezar desde hoy: no necesitas ningún historial.</p></div>`;
    return;
  }
  list.innerHTML = vs.map((v) => `
    <div class="card mb-3">
      <div class="row between" style="align-items:flex-start">
        <div class="flex1">
          <div class="row gap-2" style="align-items:center">
            <span style="font-size:22px">${icon(v.tipo)}</span>
            <div><div class="card-title" style="margin:0">${escapeHtml(v.alias || v.modelo || v.tipo)}</div>
            <div class="tiny muted">${escapeHtml(v.tipo)}${v.placa ? " · " + escapeHtml(v.placa) : ""}</div></div>
          </div>
        </div>
        <div class="row gap-2">
          <button class="icon-btn" data-edit="${v.id}" title="Editar"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg></button>
          <button class="icon-btn" data-del="${v.id}" title="Eliminar"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2m-9 0v14h10V6"/></svg></button>
        </div>
      </div>
      <div class="tiny muted mt-2">
        ${[v.marca, v.modelo, v.anio].filter(Boolean).map(escapeHtml).join(" · ")}
        ${v.cc ? " · " + escapeHtml(String(v.cc)) + "cc" : ""}
        ${v.combustible ? " · " + escapeHtml(v.combustible) : ""}
      </div>
      <div class="row between mt-2" style="border-top:1px solid var(--line);padding-top:8px">
        <span class="small muted">Odómetro</span><span class="small bold">${v.odometro != null ? Number(v.odometro).toLocaleString("es-CO") + " km" : "—"}</span>
      </div>
    </div>`).join("");

  list.querySelectorAll("[data-edit]").forEach((b) => b.onclick = () => {
    const v = getState().vehicles.find((x) => x.id === b.getAttribute("data-edit"));
    openVehicleModal(v, root);
  });
  list.querySelectorAll("[data-del]").forEach((b) => b.onclick = () => confirmDialog("¿Eliminar este vehículo?", async () => {
    const id = b.getAttribute("data-del");
    setState({ vehicles: getState().vehicles.filter((x) => x.id !== id) });
    await persistVehicles(); drawList(root); toast("Vehículo eliminado");
  }));
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
    ${f("Modelo / línea *", inp("v-modelo", v?.modelo, "text", "Ej: Boxer CT100"))}
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
          id: v?.id || uid(),
          tipo: b.querySelector("#v-tipo").value,
          alias: get("v-alias"), placa: get("v-placa").toUpperCase(), marca: get("v-marca"),
          modelo: get("v-modelo"), anio: num("v-anio"), odometro: num("v-odo"),
          cc: num("v-cc"), combustible: b.querySelector("#v-comb").value,
          fechaMatricula: b.querySelector("#v-matricula").value || "",
          departamento: b.querySelector("#v-dept").value, servicio: b.querySelector("#v-serv").value,
          capacidadTanque: num("v-tanque"), color: get("v-color"), motorChasis: get("v-vin"),
          aseguradora: get("v-aseg"), poliza: get("v-poliza"), foto: get("v-foto"),
          cruzarConGastos: v?.cruzarConGastos || false,
        };
        if (!data.alias || !data.placa || !data.marca || !data.modelo || !data.anio || data.odometro == null) {
          return toast("Completa los campos obligatorios (*)", true);
        }
        const list = getState().vehicles || [];
        setState({ vehicles: v ? list.map((x) => (x.id === data.id ? data : x)) : [...list, data] });
        await persistVehicles();
        closeModal(); drawList(root); toast(v ? "Vehículo actualizado" : "Vehículo creado");
      };
    },
  });
}
