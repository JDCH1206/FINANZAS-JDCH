// js/views/unificar.js — "Unificar descripciones": detecta gastos que son lo mismo escrito de
// varias formas (mayúsculas, tildes, plural, espacios) y RECOMIENDA una sola escritura.
// Nada se impone: cada grupo viene desmarcado, se puede elegir la forma (incluido el plural u
// otra escrita a mano) y "Mantener así" lo deja fuera de las sugerencias para siempre.
import { getState, setState } from "../state.js";
import { saveConfig, forcePersistLocal, bulkUpdateTx } from "../firebase-service.js";
import { escapeHtml } from "../utils.js";
import { openModal, closeModal, toast, submitOnce } from "../components/modals.js";

// clave de agrupación: sin mayúsculas, tildes, signos, plural simple ni espacios
const gkey = (x) => String(x || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9ñ ]+/g, " ").replace(/\s+/g, " ").trim()
  .split(" ").map((w) => (w.length > 3 ? w.replace(/s$/, "") : w)).join("");

// grupos con más de una escritura distinta, ordenados por cantidad de gastos
export function gruposVariantes(s) {
  const ign = new Set((s.profile && s.profile.unifIgnore) || []);
  const g = {};
  for (const t of s.txs || []) {
    const d = String(t.desc || "").trim(); if (!d) continue;
    const k = gkey(d); if (!k || ign.has(k)) continue;
    (g[k] = g[k] || {})[d] = (g[k][d] || 0) + 1;
  }
  return Object.entries(g).filter(([, v]) => Object.keys(v).length > 1)
    .map(([k, v]) => ({ k, vars: Object.entries(v).sort((a, b) => b[1] - a[1]), n: Object.values(v).reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.n - a.n);
}

export function openUnificarDescripciones(onDone) {
  const grupos = gruposVariantes(getState());
  if (!grupos.length) { toast("No hay descripciones con varias escrituras"); return; }
  const row = (G, i) => `<div class="un-g" data-i="${i}" style="padding:10px 0;border-top:1px solid var(--line)">
      <label class="row gap-2" style="align-items:flex-start">
        <input type="checkbox" class="un-chk" style="margin-top:4px">
        <div style="min-width:0;flex:1">
          <div class="tiny muted">${G.vars.map(([d, n]) => `${escapeHtml(d)} <b>(${n})</b>`).join(" · ")}</div>
          <div class="row gap-2 mt-1" style="align-items:center">
            <span class="tiny muted" style="flex:none">Dejar como</span>
            <select class="input un-sel" style="flex:1;min-width:0;padding:6px 8px">${G.vars.map(([d]) => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join("")}<option value="__otra">Otra…</option></select></div>
          <input class="input un-otra mt-1" placeholder="Escríbela como quieras" style="display:none;padding:6px 8px">
        </div></label>
      <div style="text-align:right"><button type="button" class="btn btn-ghost btn-sm un-keep" title="No volver a sugerir este grupo">Mantener así</button></div>
    </div>`;
  openModal("🧹 Unificar descripciones", `
    <p class="tiny muted" style="margin:-4px 0 8px">Gastos que parecen lo mismo escrito de varias formas (mayúsculas, tildes, plural). Es solo una <b>recomendación</b>: marca los que quieras unificar y elige cómo dejarlos (puedes elegir el plural u otra forma). <b>Mantener así</b> lo saca de las sugerencias. Solo cambia la descripción; montos y categorías no se tocan.</p>
    <label class="row gap-2 small mb-1" style="align-items:center"><input type="checkbox" id="un-all"> Marcar todos (${grupos.length})</label>
    <div id="un-list" style="max-height:58vh;overflow:auto">${grupos.map(row).join("")}</div>
    <div id="un-sum" class="tiny muted mt-2"></div>
    <button id="un-ok" class="btn btn-primary btn-block mt-2">Aplicar a los marcados</button>`, {
    onMount(b) {
      const sumEl = b.querySelector("#un-sum");
      const destino = (el) => { const sel = el.querySelector(".un-sel"); return sel.value === "__otra" ? el.querySelector(".un-otra").value.trim() : sel.value; };
      const marcados = () => [...b.querySelectorAll(".un-g")].filter((el) => el.querySelector(".un-chk").checked);
      const cambios = () => marcados().reduce((a, el) => { const G = grupos[+el.dataset.i], to = destino(el); return a + (to ? G.vars.filter(([d]) => d !== to).reduce((x, [, n]) => x + n, 0) : 0); }, 0);
      const upd = () => { const m = marcados().length; sumEl.textContent = m ? `${m} grupo(s) marcados · ${cambios()} gasto(s) cambiarán de descripción.` : "Nada marcado."; };
      b.querySelectorAll(".un-g").forEach((el) => {
        el.querySelector(".un-chk").onchange = upd;
        el.querySelector(".un-sel").onchange = (e) => { el.querySelector(".un-otra").style.display = e.target.value === "__otra" ? "block" : "none"; el.querySelector(".un-chk").checked = true; upd(); };
        el.querySelector(".un-otra").oninput = upd;
        el.querySelector(".un-keep").onclick = async () => {
          const G = grupos[+el.dataset.i], st = getState();
          const profile = { ...st.profile, unifIgnore: [...new Set([...((st.profile && st.profile.unifIgnore) || []), G.k])] };
          setState({ profile });
          el.remove(); upd(); toast("No se volverá a sugerir");
          await saveConfig(st.user.uid, { profile, cats: st.cats, budgets: st.budgets });
          forcePersistLocal(st.user.uid);
        };
      });
      b.querySelector("#un-all").onchange = (e) => { b.querySelectorAll(".un-chk").forEach((c) => { c.checked = e.target.checked; }); upd(); };
      upd();
      submitOnce(b.querySelector("#un-ok"), async () => {
        const mapa = {};
        for (const el of marcados()) {
          const G = grupos[+el.dataset.i], to = destino(el);
          if (!to) return toast("Escribe cómo dejar los grupos con \"Otra…\"", true);
          G.vars.forEach(([d]) => { if (d !== to) mapa[d] = to; });
        }
        if (!Object.keys(mapa).length) return toast("Marca al menos un grupo", true);
        const st = getState();
        const changed = st.txs.filter((t) => mapa[String(t.desc || "").trim()] !== undefined).map((t) => ({ ...t, desc: mapa[String(t.desc || "").trim()] }));
        const byId = Object.fromEntries(changed.map((t) => [t.id, t]));
        setState({ txs: st.txs.map((t) => byId[t.id] || t) });
        await bulkUpdateTx(st.user.uid, changed);
        forcePersistLocal(st.user.uid);
        closeModal(); toast(`${changed.length} gasto(s) unificados`);
        if (onDone) onDone();
      }, "Aplicando…");
    },
  });
}
