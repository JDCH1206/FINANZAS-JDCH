// js/views/ia-registro.js — registrar movimientos con IA: dictando/escribiendo o desde un
// extracto (PDF o foto). Todo pasa por una pantalla de REVISIÓN: nada se guarda sin confirmar.
import { getState, setState } from "../state.js";
import { addTx, addIncome, forcePersistLocal } from "../firebase-service.js";
import { fmt, uid, todayISO, escapeHtml } from "../utils.js";
import { INCOME_TYPES, DEFAULT_PAY_METHODS } from "../config.js";
import { openModal, closeModal, toast, submitOnce } from "../components/modals.js";
import { aiReady, interpretarTexto, leerExtracto } from "../ai.js";

const norm = (x) => String(x || "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ");
// categoría con la que el usuario suele registrar esa descripción (tiene prioridad sobre la IA)
function aprendido(txs) {
  const h = {};
  for (const t of txs) { const k = norm(t.desc); if (!k) continue; const c = `${t.cat}|${t.sub || ""}`; (h[k] = h[k] || {})[c] = (h[k][c] || 0) + 1; }
  return (d) => { const e = h[norm(d)]; if (!e) return null; const [c, sub] = Object.entries(e).sort((a, b) => b[1] - a[1])[0][0].split("|"); return { c, sub }; };
}
// tipo de ingreso: el que ya usaste con esa descripción o uno deducido del texto
function tipoIngreso(desc, incomes) {
  const k = norm(desc), prev = (incomes || []).find((i) => norm(i.desc) === k && INCOME_TYPES.includes(i.type));
  if (prev) return prev.type;
  const r = [[/nomina|salario|sueldo/, "Salario"], [/prima/, "Prima"], [/cesantia|liquidacion/, "Liquidación/Cesantías"], [/subsidio/, "Subsidio"],
    [/rendimiento|interes/, "Rendimientos"], [/prestamo|credito desembolso|desembolso/, "Préstamo recibido"]].find(([re]) => re.test(k));
  return r ? r[1] : "Otros ingresos";
}
const payList = () => [...DEFAULT_PAY_METHODS.filter((m) => m !== "Otro"), ...(getState().payMethods || []), "Otro"];
const SR = () => window.SpeechRecognition || window.webkitSpeechRecognition;

/* ---------- Barra de acceso en Movimientos ---------- */
export function iaBarHtml() {
  if (!aiReady()) return "";
  return `<div class="row gap-2 mb-3">
    <button id="ia-dictar" class="btn btn-ghost btn-sm" style="flex:1">🎤 Dictar o escribir</button>
    <button id="ia-extracto" class="btn btn-ghost btn-sm" style="flex:1">📄 Importar extracto</button></div>`;
}
export function wireIaBar(root, onDone) {
  const d = root.querySelector("#ia-dictar"), e = root.querySelector("#ia-extracto");
  if (d) d.onclick = () => openDictado(onDone);
  if (e) e.onclick = () => openExtracto(onDone);
}

/* ---------- Dictar o escribir ---------- */
export function openDictado(onDone) {
  const voz = !!SR();
  openModal("🎤 Dictar o escribir", `
    <p class="tiny muted" style="margin:-4px 0 8px">Ej.: <i>"almuerzo 15 mil en efectivo y gaseosa 4 mil"</i> · <i>"ayer gasolina extra 40 mil con débito"</i> · <i>"me pagaron 200 mil de un trabajo"</i>. Puedes decir varios a la vez.</p>
    <textarea id="dt-txt" class="input" rows="3" placeholder="Escribe o toca el micrófono…" style="resize:vertical"></textarea>
    <div class="row gap-2 mt-2">
      ${voz ? `<button type="button" id="dt-mic" class="btn btn-ghost" style="flex:1">🎤 Hablar</button>` : ""}
      <button id="dt-go" class="btn btn-primary" style="flex:1">✨ Interpretar</button></div>
    <div id="dt-st" class="tiny muted mt-2">${voz ? "" : "Tu navegador no permite dictar por voz aquí; escribe el texto (en el teclado del celular también puedes usar el micrófono)."}</div>`, {
    onMount(b) {
      const txt = b.querySelector("#dt-txt"), st = b.querySelector("#dt-st"), mic = b.querySelector("#dt-mic");
      if (mic) {
        let rec = null, base = "";
        mic.onclick = () => {
          if (rec) { rec.stop(); return; }
          const R = SR(); rec = new R(); rec.lang = "es-CO"; rec.interimResults = true; rec.continuous = false;
          base = txt.value ? txt.value.trim() + " " : "";
          rec.onresult = (ev) => { let t = ""; for (const r of ev.results) t += r[0].transcript; txt.value = base + t; };
          rec.onerror = (ev) => { st.textContent = "No se pudo usar el micrófono (" + (ev.error || "error") + "). Revisa el permiso del navegador."; };
          rec.onend = () => { rec = null; mic.textContent = "🎤 Hablar"; mic.classList.remove("btn-primary"); };
          rec.start(); mic.textContent = "⏹ Detener"; st.textContent = "Escuchando… habla y luego toca Detener.";
        };
      }
      submitOnce(b.querySelector("#dt-go"), async () => {
        const t = txt.value.trim(); if (!t) return toast("Escribe o dicta algo", true);
        st.textContent = "⏳ Interpretando…"; st.style.color = "";
        try {
          const s = getState();
          const r = await interpretarTexto(t, { cats: s.cats, pays: payList(), cuentas: (s.accounts || []).map((a) => a.name), hoy: todayISO() });
          if (!r.movimientos.length) { st.textContent = "No encontré movimientos en el texto. Incluye qué fue y el valor."; st.style.color = "var(--yel)"; return; }
          closeModal();
          openRevision(r.movimientos, { titulo: "Revisa lo que entendí", nota: `Interpretado con ${r.model}.` }, onDone);
        } catch (e) { st.textContent = "⚠ " + (e.message || e); st.style.color = "var(--red)"; }
      }, "Interpretando…");
    },
  });
}

/* ---------- Extracto bancario / factura (PDF o foto) ---------- */
export function openExtracto(onDone) {
  const s = getState();
  openModal("📄 Importar extracto", `
    <p class="tiny muted" style="margin:-4px 0 8px">Extracto del banco o de la tarjeta, factura electrónica o recibo, en <b>PDF o foto</b>. La IA lista los movimientos y tú eliges cuáles importar; los que ya tienes registrados salen marcados como posible duplicado.</p>
    <div class="field"><label class="label">Medio de pago de estos movimientos</label><select id="ex-pay" class="input"><option value="">— detectar / ninguno —</option>${payList().map((m) => `<option>${escapeHtml(m)}</option>`).join("")}</select></div>
    <div class="field"><label class="label">Cuenta (opcional)</label><select id="ex-acct" class="input"><option value="">— ninguna —</option>${(s.accounts || []).map((a) => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)}</option>`).join("")}</select></div>
    <label class="btn btn-primary btn-block" style="cursor:pointer;text-align:center">📄 Elegir PDF o foto<input id="ex-file" type="file" accept="application/pdf,image/*" hidden></label>
    <div id="ex-st" class="tiny muted mt-2">El archivo no se guarda. Un extracto largo puede tardar hasta un minuto.</div>`, {
    onMount(b) {
      const st = b.querySelector("#ex-st"), inp = b.querySelector("#ex-file");
      inp.onchange = async () => {
        const f = inp.files && inp.files[0]; inp.value = ""; if (!f) return;
        st.textContent = `⏳ Leyendo "${f.name}"…`; st.style.color = "";
        try {
          const r = await leerExtracto(f, getState().cats);
          if (!r.movimientos.length) { st.textContent = "No encontré movimientos en el archivo."; st.style.color = "var(--yel)"; return; }
          const pay = b.querySelector("#ex-pay").value, acct = b.querySelector("#ex-acct").value;
          closeModal();
          openRevision(r.movimientos, { titulo: `Movimientos de ${r.entidad || "el extracto"}${r.periodo ? " · " + r.periodo : ""}`, pay, acct, nota: `Leído con ${r.model}.` }, onDone);
        } catch (e) { st.textContent = "⚠ " + (e.message || e); st.style.color = "var(--red)"; }
      };
    },
  });
}

/* ---------- Revisión común (antes de guardar) ---------- */
function esDuplicado(m) {
  const s = getState(), lista = m.tipo === "ingreso" ? s.incomes : s.txs;
  const d0 = new Date(m.fecha + "T12:00:00").getTime();
  return lista.some((t) => Math.round(+t.amount) === m.monto && Math.abs(new Date((t.date || "") + "T12:00:00").getTime() - d0) <= 86400000 * 1.5);
}
export function openRevision(movs, opts, onDone) {
  const s = getState(), aprend = aprendido(s.txs);
  const pays = payList(), acctOf = (name) => ((s.accounts || []).find((a) => norm(a.name) === norm(name)) || {}).id || "";
  const items = movs.map((m) => {
    const l = m.tipo === "gasto" ? aprend(m.descripcion) : null;
    let cat = l && s.cats.some((c) => c.name === l.c) ? l.c : (s.cats.some((c) => c.name === m.categoria) ? m.categoria : (s.cats[0] || {}).name);
    const subs = (s.cats.find((c) => c.name === cat) || {}).subs || [];
    const sub = l && l.c === cat && subs.includes(l.sub) ? l.sub : (subs.includes(m.subcategoria) ? m.subcategoria : subs[0] || "");
    const dup = esDuplicado(m), transf = !!m.esTransferenciaPropia;
    return { ...m, cat, sub, pay: opts.pay || (pays.includes(m.medioPago) ? m.medioPago : ""), acct: opts.acct || acctOf(m.cuenta), dup, transf, ok: !dup && !transf, itype: tipoIngreso(m.descripcion, s.incomes) };
  });
  const catOpts = (sel) => s.cats.map((c) => `<option ${c.name === sel ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("");
  const subOpts = (cat, sel) => ((s.cats.find((c) => c.name === cat) || {}).subs || []).map((x) => `<option ${x === sel ? "selected" : ""}>${escapeHtml(x)}</option>`).join("");
  const fila = (m, i) => `<div class="rv" data-i="${i}" style="border:1px solid var(--line);border-radius:12px;padding:10px;margin-bottom:8px;${m.ok ? "" : "opacity:.6"}">
      <div class="row gap-2" style="align-items:center;margin-bottom:6px">
        <input type="checkbox" class="rv-ok" ${m.ok ? "checked" : ""}>
        <input class="input rv-date" type="date" value="${escapeHtml(m.fecha || todayISO())}" style="flex:1;min-width:0;padding:6px 8px">
        <select class="input rv-tipo" style="width:96px;padding:6px 8px"><option value="gasto" ${m.tipo === "gasto" ? "selected" : ""}>Gasto</option><option value="ingreso" ${m.tipo === "ingreso" ? "selected" : ""}>Ingreso</option></select></div>
      <div class="row gap-2" style="margin-bottom:6px"><input class="input rv-desc" value="${escapeHtml(m.descripcion)}" style="flex:1;min-width:0;padding:6px 8px">
        <input class="input rv-amt" type="number" inputmode="numeric" value="${m.monto}" style="width:110px;padding:6px 8px"></div>
      <div class="row gap-2 rv-g" style="display:${m.tipo === "gasto" ? "flex" : "none"}"><select class="input rv-cat" style="flex:1;min-width:0;padding:6px 8px">${catOpts(m.cat)}</select><select class="input rv-sub" style="flex:1;min-width:0;padding:6px 8px">${subOpts(m.cat, m.sub)}</select></div>
      <div class="rv-i" style="display:${m.tipo === "ingreso" ? "block" : "none"}"><select class="input rv-itype" style="padding:6px 8px">${INCOME_TYPES.map((t) => `<option ${t === m.itype ? "selected" : ""}>${escapeHtml(t)}</option>`).join("")}</select></div>
      ${m.dup ? `<div class="tiny mt-1" style="color:var(--yel)">⚠ Posible duplicado: ya tienes un movimiento de ${fmt(m.monto)} en esa fecha.</div>` : ""}
      ${m.transf ? `<div class="tiny mt-1" style="color:var(--yel)">↔ Parece una transferencia entre tus cuentas o pago de tarjeta (no es gasto real).</div>` : ""}
    </div>`;
  openModal(escapeHtml(opts.titulo || "Revisar movimientos"), `
    <p class="tiny muted" style="margin:-4px 0 8px">${escapeHtml(opts.nota || "")} Revisa y corrige; solo se guardan los marcados. La categoría con la que sueles registrar cada descripción tiene prioridad.</p>
    <div class="row gap-2 mb-2"><select id="rv-pay" class="input" style="flex:1;min-width:0;padding:6px 8px"><option value="">Medio de pago: el de cada uno</option>${pays.map((p) => `<option>${escapeHtml(p)}</option>`).join("")}</select>
      <select id="rv-acct" class="input" style="flex:1;min-width:0;padding:6px 8px"><option value="">Cuenta: la de cada uno</option>${(s.accounts || []).map((a) => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)}</option>`).join("")}</select></div>
    <div style="max-height:56vh;overflow:auto">${items.map(fila).join("")}</div>
    <div id="rv-sum" class="small bold mt-2" style="text-align:right"></div>
    <button id="rv-save" class="btn btn-primary btn-block mt-2">Guardar marcados</button>`, {
    onMount(b) {
      const filas = [...b.querySelectorAll(".rv")];
      const upd = () => {
        let n = 0, g = 0, i = 0;
        filas.forEach((f) => { if (!f.querySelector(".rv-ok").checked) { f.style.opacity = ".6"; return; } f.style.opacity = ""; n++; const v = +f.querySelector(".rv-amt").value || 0; if (f.querySelector(".rv-tipo").value === "gasto") g += v; else i += v; });
        b.querySelector("#rv-sum").textContent = `${n} marcado(s) · gastos ${fmt(g)}${i ? " · ingresos " + fmt(i) : ""}`;
      };
      filas.forEach((f) => {
        const tipo = f.querySelector(".rv-tipo"), cat = f.querySelector(".rv-cat"), sub = f.querySelector(".rv-sub");
        tipo.onchange = () => { f.querySelector(".rv-g").style.display = tipo.value === "gasto" ? "flex" : "none"; f.querySelector(".rv-i").style.display = tipo.value === "ingreso" ? "block" : "none"; upd(); };
        cat.onchange = () => { sub.innerHTML = subOpts(cat.value); };
        f.querySelector(".rv-ok").onchange = upd; f.querySelector(".rv-amt").oninput = upd;
      });
      upd();
      submitOnce(b.querySelector("#rv-save"), async () => {
        const st = getState(), payAll = b.querySelector("#rv-pay").value, acctAll = b.querySelector("#rv-acct").value;
        const txs = [], incs = [];
        for (const f of filas) {
          if (!f.querySelector(".rv-ok").checked) continue;
          const m = items[+f.dataset.i];
          const date = f.querySelector(".rv-date").value || todayISO(), desc = f.querySelector(".rv-desc").value.trim(), amount = Math.round(+f.querySelector(".rv-amt").value || 0);
          if (!desc || amount <= 0) continue;
          if (f.querySelector(".rv-tipo").value === "ingreso") incs.push({ id: uid(), date, desc, amount, type: f.querySelector(".rv-itype").value });
          else txs.push({ id: uid(), date, desc, amount, cat: f.querySelector(".rv-cat").value, sub: f.querySelector(".rv-sub").value, pay: payAll || m.pay || "", acct: acctAll || m.acct || "", tags: [] });
        }
        if (!txs.length && !incs.length) return toast("No hay movimientos marcados", true);
        setState({ txs: [...txs, ...st.txs], incomes: [...incs, ...st.incomes] });
        for (const t of txs) await addTx(st.user.uid, t);
        for (const i of incs) await addIncome(st.user.uid, i);
        forcePersistLocal(st.user.uid);
        closeModal(); toast(`Guardado: ${txs.length} gasto(s)${incs.length ? ` y ${incs.length} ingreso(s)` : ""}`);
        if (onDone) onDone();
      }, "Guardando…");
    },
  });
}
