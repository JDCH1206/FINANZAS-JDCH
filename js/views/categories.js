// js/views/categories.js
import { getState, setState } from "../state.js";
import { saveConfig, forcePersistLocal } from "../firebase-service.js";
import { uid, escapeHtml, debounce } from "../utils.js";
import { toast, confirmDialog } from "../components/modals.js";

let openId = null;
const persist = debounce(async () => {
  const s = getState();
  await saveConfig(s.user.uid, { profile: s.profile, cats: s.cats, budgets: s.budgets });
  forcePersistLocal(s.user.uid);
}, 600);

export function renderCategories(root) {
  const s = getState();
  root.innerHTML = `
    <h2 class="page-title disp">Categorías</h2>
    <p class="page-sub">Crea, renombra o elimina categorías y subcategorías</p>
    <div class="card mb-3">
      <div class="row gap-2">
        <input id="new-cat" class="input" placeholder="Nueva categoría">
        <button id="add-cat" class="btn btn-primary btn-sm">+ Crear</button>
      </div>
    </div>
    <div id="cat-list"></div>`;

  root.querySelector("#add-cat").onclick = () => {
    const v = root.querySelector("#new-cat").value.trim();
    if (!v) return;
    setState({ cats: [...s.cats, { id: uid(), name: v, type: "Deseo", dane: null, subs: [] }] });
    persist(); toast("Categoría creada"); renderCategories(root);
  };
  drawCats(root);
}

function drawCats(root) {
  const s = getState();
  const host = root.querySelector("#cat-list");
  host.innerHTML = s.cats.map((c) => {
    const open = openId === c.id;
    return `<div class="cat-item" data-cat="${c.id}">
      <div class="cat-head">
        <button class="icon-btn chev ${open ? "open" : ""}" data-toggle="${c.id}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
        </button>
        <input class="input bold flex1" data-name="${c.id}" value="${escapeHtml(c.name)}">
        <select class="input" style="width:auto;font-size:12px" data-type="${c.id}">
          ${["Necesidad", "Deseo", "Deuda"].map((t) => `<option ${c.type === t ? "selected" : ""}>${t}</option>`).join("")}
        </select>
        <button class="icon-btn" data-delcat="${c.id}" style="color:var(--red)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2m-9 0v14h10V6"/></svg>
        </button>
      </div>
      ${open ? `<div class="cat-body">
        ${c.subs.map((sb) => `<div class="sub-item"><span class="sub-dot"></span><span class="flex1">${escapeHtml(sb)}</span><button class="icon-btn" data-delsub="${c.id}|${escapeHtml(sb)}">✕</button></div>`).join("")}
        <div class="row gap-1 mt-2">
          <input class="input" style="font-size:12.5px;padding:7px 10px" placeholder="Nueva subcategoría" data-newsub="${c.id}">
          <button class="btn btn-ghost btn-sm" data-addsub="${c.id}">+</button>
        </div>
      </div>` : ""}
    </div>`;
  }).join("");

  // handlers
  host.querySelectorAll("[data-toggle]").forEach((b) => b.onclick = () => { const id = b.getAttribute("data-toggle"); openId = openId === id ? null : id; drawCats(root); });
  host.querySelectorAll("[data-name]").forEach((inp) => inp.onchange = (e) => { mutate(e.target.getAttribute("data-name"), (c) => c.name = e.target.value); });
  host.querySelectorAll("[data-type]").forEach((sel) => sel.onchange = (e) => { mutate(e.target.getAttribute("data-type"), (c) => c.type = e.target.value); });
  host.querySelectorAll("[data-delcat]").forEach((b) => b.onclick = () => {
    const id = b.getAttribute("data-delcat");
    confirmDialog("¿Eliminar la categoría y sus subcategorías?", () => {
      setState({ cats: getState().cats.filter((c) => c.id !== id) }); persist(); drawCats(root);
    });
  });
  host.querySelectorAll("[data-addsub]").forEach((b) => b.onclick = () => {
    const id = b.getAttribute("data-addsub");
    const inp = host.querySelector(`[data-newsub="${id}"]`);
    const v = inp.value.trim(); if (!v) return;
    mutate(id, (c) => c.subs = [...c.subs, v]); drawCats(root);
  });
  host.querySelectorAll("[data-delsub]").forEach((b) => b.onclick = () => {
    const [id, sb] = b.getAttribute("data-delsub").split("|");
    mutate(id, (c) => c.subs = c.subs.filter((x) => x !== sb)); drawCats(root);
  });
}

function mutate(id, fn) {
  const s = getState();
  const cats = s.cats.map((c) => { if (c.id === id) { const cp = { ...c, subs: [...c.subs] }; fn(cp); return cp; } return c; });
  setState({ cats }); persist();
}
