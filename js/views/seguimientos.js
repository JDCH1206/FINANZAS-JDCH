// js/views/seguimientos.js — seguimiento individual de productos/gastos por palabra clave
// (ej. "Coca cola", "Cerveza"). No exige cambiar cómo se registra: busca las palabras en la
// descripción de todo el historial. Distingue gasto EXACTO (el gasto es solo ese producto,
// o una parte propia de un gasto dividido) de COMPARTIDO (descripción combinada, ej.
// "Empanadas y gaseosa": cuenta la vez, pero el monto incluye otras cosas).
import { getState, setState } from "../state.js";
import { saveConfig, forcePersistLocal, bulkUpdateTx } from "../firebase-service.js";
import { fmt, sum, escapeHtml, monthLabel, curMonth, uid } from "../utils.js";
import { openModal, closeModal, toast, submitOnce, confirmDialog } from "../components/modals.js";

// texto comparable: minúsculas, sin tildes, sin plural simple, espacios normalizados
const key = (x) => String(x || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9ñ ]+/g, " ").replace(/\s+/g, " ").trim()
  .split(" ").map((w) => (w.length > 3 ? w.replace(/s$/, "") : w)).join(" ");
// texto propio del gasto: en un gasto dividido el detalle va después de "·"
const propio = (desc) => { const p = String(desc || "").split("·"); return p[p.length - 1]; };
const COMPUESTO = /\s(y|e|con|mas|más)\s|,|\+|&|\//i;

export const SEG_SUGERIDOS = [
  { nombre: "Coca cola", palabras: ["coca cola", "cocacola", "coca"] },
  { nombre: "Gaseosa", palabras: ["gaseosa", "coca cola", "cocacola", "pepsi", "postobon", "colombiana", "sprite"] },
  { nombre: "Empanadas", palabras: ["empanada"] },
  { nombre: "Cerveza", palabras: ["cerveza", "pola"] },
  { nombre: "Café", palabras: ["cafe", "tinto", "capuchino", "frappe"] },
  { nombre: "Postres", palabras: ["postre", "helado", "pastel", "ponque"] },
  { nombre: "Parqueadero", palabras: ["parqueadero"] },
];

function match(seg, txs) {
  const kws = (seg.palabras || []).map(key).filter(Boolean);
  if (!kws.length) return [];
  return txs.filter((t) => { const d = " " + key(t.desc) + " "; return kws.some((k) => d.includes(" " + k + " ")); });
}

function stats(seg, txs) {
  const m = match(seg, txs);
  const exact = m.filter((t) => !COMPUESTO.test(propio(t.desc)));
  const shared = m.filter((t) => COMPUESTO.test(propio(t.desc)));
  const meses = new Set(m.map((t) => (t.date || "").slice(0, 7)).filter(Boolean));
  const primer = [...meses].sort()[0];
  // meses del rango (desde la primera compra hasta hoy) para el promedio mensual real
  let nRango = 1;
  if (primer) { const [y1, m1] = primer.split("-").map(Number), [y2, m2] = curMonth().split("-").map(Number); nRango = Math.max(1, (y2 - y1) * 12 + (m2 - m1) + 1); }
  // precio por unidad: si el gasto tiene cantidad (compra con varios productos) se divide
  const med = (arr) => { if (!arr.length) return 0; const a = arr.map((t) => (+t.amount || 0) / (+t.qty || 1)).sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
  // precio típico (mediana de compras exactas, por unidad) por año: muestra si va subiendo
  const porAnio = {};
  exact.forEach((t) => { const y = (t.date || "").slice(0, 4); (porAnio[y] = porAnio[y] || []).push(t); });
  const precios = Object.keys(porAnio).sort().map((y) => [y, med(porAnio[y])]);
  // últimos 12 meses (monto total, exacto + compartido)
  const ult = [];
  const [cy, cmo] = curMonth().split("-").map(Number);
  for (let i = 11; i >= 0; i--) { const d = new Date(cy, cmo - 1 - i, 1); ult.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`); }
  const porMes = ult.map((k) => sum(m.filter((t) => (t.date || "").startsWith(k)), (t) => t.amount));
  const ultima = m.map((t) => t.date).filter(Boolean).sort().pop();
  return { n: m.length, nExact: exact.length, nShared: shared.length, totExact: sum(exact, (t) => t.amount), totShared: sum(shared, (t) => t.amount),
    nRango, precios, ult, porMes, ultima };
}

// HTML de la tarjeta (va en Tablero → Avanzado)
export function seguimientosCard(s) {
  const segs = (s.profile && s.profile.seguimientos) || [];
  const txs = s.txs || [];
  const body = segs.length ? segs.map((g) => {
    const st = stats(g, txs);
    const tot = st.totExact + st.totShared, max = Math.max(1, ...st.porMes);
    const bars = st.porMes.map((v, i) => `<div title="${escapeHtml(monthLabel(st.ult[i]))}: ${fmt(v)}" style="flex:1;background:var(--gold);opacity:${v ? 0.85 : 0.15};height:${Math.max(2, (v / max) * 28)}px;border-radius:2px"></div>`).join("");
    const precio = st.precios.length ? st.precios.slice(-4).map(([y, p]) => `${y}: <b>${fmt(p)}</b>`).join(" → ") : "";
    return `<div style="padding:10px 0;border-top:1px solid var(--line)">
      <div class="row between" style="align-items:baseline;gap:8px">
        <span class="small bold">${escapeHtml(g.nombre)}</span>
        <span class="row gap-1" style="align-items:center"><span class="bold">${fmt(tot)}</span>
          <button class="icon-btn" data-seg="${escapeHtml(g.id)}" aria-label="Opciones" title="Editar / unificar" style="opacity:.7">⋯</button></span></div>
      <div class="tiny muted">${st.n} veces · ≈ ${(st.n / st.nRango).toFixed(1)}/mes · ≈ ${fmt(tot / st.nRango)}/mes${st.ultima ? ` · última ${escapeHtml(st.ultima)}` : ""}</div>
      ${st.n ? `<div class="tiny" style="margin-top:3px">Exacto <b>${fmt(st.totExact)}</b> (${st.nExact}) · Compartido ${fmt(st.totShared)} (${st.nShared})</div>
      ${precio ? `<div class="tiny muted" style="margin-top:2px">Precio típico: ${precio}</div>` : ""}
      <div class="row" style="gap:2px;align-items:flex-end;height:30px;margin-top:6px">${bars}</div>
      <div class="row between tiny muted"><span>${escapeHtml(monthLabel(st.ult[0]))}</span><span>${escapeHtml(monthLabel(st.ult[11]))}</span></div>`
      : `<div class="tiny muted">Sin coincidencias. Revisa las palabras clave.</div>`}
    </div>`;
  }).join("") : `<p class="small muted">Elige productos o gastos para seguirlos de forma individual (ej. Coca cola, Cerveza, Café). Se buscan por palabras en la descripción de todo tu historial: no tienes que cambiar cómo registras.</p>`;
  return `<div class="card mb-3">
    <div class="row between" style="align-items:center"><div class="card-title" style="margin:0">🎯 Seguimientos</div>
      <button id="seg-add" class="btn btn-ghost btn-sm">+ Agregar</button></div>
    <p class="tiny muted" style="margin:4px 0 4px"><b>Exacto</b>: gastos que son solo ese producto (incluye los productos de una compra con varios productos). <b>Compartido</b>: descripción combinada (ej. "Empanadas y gaseosa"); cuenta la vez, pero el monto incluye otras cosas.</p>
    ${body}
  </div>`;
}

async function saveSegs(segs) {
  const st = getState();
  const profile = { ...st.profile, seguimientos: segs };
  setState({ profile });
  await saveConfig(st.user.uid, { profile, cats: st.cats, budgets: st.budgets });
  forcePersistLocal(st.user.uid);
}

// enlaza los botones de la tarjeta; rerender vuelve a dibujar el tablero
export function wireSeguimientos(root, rerender) {
  const add = root.querySelector("#seg-add");
  if (add) add.onclick = () => openSegModal(null, rerender);
  root.querySelectorAll("[data-seg]").forEach((b) => b.onclick = () => {
    const g = ((getState().profile || {}).seguimientos || []).find((x) => x.id === b.getAttribute("data-seg"));
    if (g) openSegModal(g, rerender);
  });
}

function openSegModal(seg, rerender) {
  const existentes = new Set((((getState().profile || {}).seguimientos) || []).map((g) => g.nombre.toLowerCase()));
  const sug = SEG_SUGERIDOS.filter((x) => !existentes.has(x.nombre.toLowerCase()));
  openModal(seg ? `Seguimiento: ${escapeHtml(seg.nombre)}` : "Nuevo seguimiento", `
    ${!seg && sug.length ? `<div class="tiny muted mb-1">Sugeridos</div><div class="row gap-1 mb-3" style="flex-wrap:wrap">${sug.map((x, i) => `<button type="button" class="chip" data-sug="${i}">${escapeHtml(x.nombre)}</button>`).join("")}</div>` : ""}
    <div class="field"><label class="label">Nombre</label><input id="sg-nombre" class="input" placeholder="Ej: Coca cola" value="${seg ? escapeHtml(seg.nombre) : ""}"></div>
    <div class="field"><label class="label">Palabras a buscar (separadas por coma)</label><input id="sg-pal" class="input" placeholder="Ej: coca cola, cocacola" value="${seg ? escapeHtml((seg.palabras || []).join(", ")) : ""}">
      <div class="tiny muted mt-1">No importan mayúsculas, tildes ni plurales.</div></div>
    <div id="sg-prev" class="tiny muted mb-2"></div>
    <button id="sg-save" class="btn btn-primary btn-block">${seg ? "Guardar cambios" : "Agregar seguimiento"}</button>
    ${seg ? `<button id="sg-unif" class="btn btn-ghost btn-block mt-2">✏️ Unificar escritura en los gastos</button>
      <button id="sg-del" class="btn btn-ghost btn-block mt-2" style="color:var(--red)">Quitar seguimiento</button>` : ""}`, {
    onMount(b) {
      const nombre = b.querySelector("#sg-nombre"), pal = b.querySelector("#sg-pal"), prev = b.querySelector("#sg-prev");
      const palabras = () => pal.value.split(",").map((x) => x.trim()).filter(Boolean);
      const preview = () => {
        const n = match({ palabras: palabras() }, getState().txs || []).length;
        prev.textContent = palabras().length ? `Coincide con ${n} gasto${n === 1 ? "" : "s"} de tu historial.` : "";
      };
      pal.oninput = preview; preview();
      b.querySelectorAll("[data-sug]").forEach((c) => c.onclick = () => {
        const x = sug[+c.getAttribute("data-sug")];
        nombre.value = x.nombre; pal.value = x.palabras.join(", "); preview();
      });
      submitOnce(b.querySelector("#sg-save"), async () => {
        const n = nombre.value.trim(), p = palabras();
        if (!n || !p.length) return toast("Escribe un nombre y al menos una palabra", true);
        const segs = [...(((getState().profile || {}).seguimientos) || [])];
        if (seg) { const i = segs.findIndex((x) => x.id === seg.id); segs[i] = { ...seg, nombre: n, palabras: p }; }
        else segs.push({ id: uid(), nombre: n, palabras: p });
        await saveSegs(segs);
        closeModal(); rerender(); toast(seg ? "Seguimiento actualizado" : "Seguimiento agregado");
      });
      const del = b.querySelector("#sg-del");
      if (del) del.onclick = () => confirmDialog(`¿Quitar el seguimiento "${seg.nombre}"? Tus gastos no se modifican.`, async () => {
        await saveSegs((((getState().profile || {}).seguimientos) || []).filter((x) => x.id !== seg.id));
        closeModal(); rerender(); toast("Seguimiento quitado");
      }, { yesLabel: "Quitar" });
      const unif = b.querySelector("#sg-unif");
      if (unif) unif.onclick = () => openUnificar(seg, rerender);
    },
  });
}

// ---------- Unificar escritura: "coca cola", "Cocacola", "Coca Cola" → "Coca cola" ----------
// patrón flexible a partir del nombre: sin distinguir mayúsculas/tildes y con espacios o guiones
// opcionales entre palabras (así "cocacola" y "coca-cola" también coinciden).
const ACC = { a: "[aáàä]", e: "[eéèë]", i: "[iíìï]", o: "[oóòö]", u: "[uúùü]", n: "[nñ]" };
function patron(nombre) {
  const words = nombre.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/\s+/).filter(Boolean);
  const w = words.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[aeioun]/g, (c) => ACC[c])).join("[\\s-]*");
  return new RegExp(`(^|[^a-záéíóúñü])(${w})(?![a-záéíóúñü])`, "gi");
}
export function unificar(desc, nombre) {
  const re = patron(nombre);
  return String(desc || "").replace(re, (m0, pre, hit, off) => {
    const alInicio = off + pre.length === 0 || /[·:]\s*$/.test(String(desc).slice(0, off + pre.length));
    return pre + (alInicio ? nombre : nombre.charAt(0).toLowerCase() + nombre.slice(1));
  });
}

function openUnificar(seg, rerender) {
  const s = getState();
  const nombre0 = seg.nombre;
  const catOpts = `<option value="">No cambiar la categoría</option>` + s.cats.flatMap((c) => (c.subs || []).map((x) => `<option value="${escapeHtml(c.name + "|" + x)}">${escapeHtml(c.name)} › ${escapeHtml(x)}</option>`)).join("");
  openModal("Unificar escritura", `
    <p class="tiny muted" style="margin:-4px 0 10px">Reescribe en tus gastos todas las formas de escribir el nombre (mayúsculas, tildes, "cocacola", "coca-cola"…) para que queden iguales. Solo cambia esa palabra dentro de la descripción.</p>
    <div class="field"><label class="label">Escribirlo siempre como</label><input id="un-nombre" class="input" value="${escapeHtml(nombre0)}"></div>
    <div class="field"><label class="label">Mover también a (solo los gastos que son exactamente ese producto)</label><select id="un-cat" class="input">${catOpts}</select></div>
    <div id="un-prev" class="small" style="max-height:40vh;overflow:auto;border-top:1px solid var(--line)"></div>
    <button id="un-ok" class="btn btn-primary btn-block mt-3">Aplicar</button>`, {
    onMount(b) {
      const inp = b.querySelector("#un-nombre"), cat = b.querySelector("#un-cat"), prev = b.querySelector("#un-prev");
      const plan = () => {
        const nombre = inp.value.trim(); if (!nombre) return [];
        const [c, sub] = cat.value ? cat.value.split("|") : [null, null];
        const exacto = (t) => key(propio(t.desc)) === key(nombre);
        return (getState().txs || []).map((t) => {
          const nd = unificar(t.desc, nombre);
          const mover = c && exacto({ desc: nd }) && (t.cat !== c || t.sub !== sub);
          return nd !== t.desc || mover ? { t, nd, mover, c, sub } : null;
        }).filter(Boolean);
      };
      const draw = () => {
        const p = plan();
        const grupos = {};
        p.forEach((x) => { const k = `${x.t.desc} → ${x.nd}${x.mover ? ` (→ ${x.c} › ${x.sub})` : ""}`; grupos[k] = (grupos[k] || 0) + 1; });
        const filas = Object.entries(grupos).sort((a, b) => b[1] - a[1]);
        prev.innerHTML = filas.length ? `<div class="tiny muted" style="padding:6px 0">${p.length} gasto(s) cambiarán:</div>` + filas.slice(0, 40).map(([k, n]) => `<div class="row between tiny" style="padding:4px 0;border-top:1px solid var(--line);gap:8px"><span style="min-width:0">${escapeHtml(k)}</span><span class="bold">×${n}</span></div>`).join("")
          : `<div class="tiny muted" style="padding:8px 0">Todo ya está escrito igual. Nada que cambiar.</div>`;
      };
      inp.oninput = draw; cat.onchange = draw; draw();
      submitOnce(b.querySelector("#un-ok"), async () => {
        const p = plan();
        if (!p.length) { closeModal(); return; }
        const st = getState();
        const changed = p.map((x) => ({ ...x.t, desc: x.nd, ...(x.mover ? { cat: x.c, sub: x.sub } : {}) }));
        const byId = Object.fromEntries(changed.map((t) => [t.id, t]));
        setState({ txs: st.txs.map((t) => byId[t.id] || t) });
        await bulkUpdateTx(st.user.uid, changed);
        forcePersistLocal(st.user.uid);
        closeModal(); rerender(); toast(`${changed.length} gasto(s) actualizado(s)`);
      }, "Aplicando…");
    },
  });
}
