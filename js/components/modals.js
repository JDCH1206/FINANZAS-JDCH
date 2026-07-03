// js/components/modals.js
import { fmt } from "../utils.js";

let host;
let modalOpen = false;   // hay un modal visible
let popPending = false;  // cierre programático: consumir el popstate sin re-cerrar
let initialSnap = "";    // estado inicial del formulario (para detectar cambios sin guardar)
function ensureHost() {
  if (!host) { host = document.createElement("div"); document.body.appendChild(host); }
  return host;
}

function formSnap() {
  return host ? [...host.querySelectorAll("input,select,textarea")].map((e) => (e.type === "checkbox" ? e.checked : e.value)).join("\x1f") : "";
}
function isDirty() { return modalOpen && formSnap() !== initialSnap; }
const DISCARD_MSG = "Tienes cambios sin guardar. ¿Descartarlos?";
// cierre pedido por el usuario (fondo, ✕ o Esc): si hay cambios, pregunta antes
function requestClose() {
  if (isDirty() && !window.confirm(DISCARD_MSG)) return;
  closeModal();
}

// botón "atrás" (Android) y tecla Esc cierran el modal en vez de salir de la app
window.addEventListener("popstate", () => {
  if (popPending) { popPending = false; return; }
  if (!modalOpen) return;
  if (isDirty() && !window.confirm(DISCARD_MSG)) {
    history.pushState({ fzModal: 1 }, ""); // canceló el descarte: restaurar la entrada
    return;
  }
  modalOpen = false; if (host) host.innerHTML = "";
});
window.addEventListener("keydown", (e) => { if (e.key === "Escape" && modalOpen) requestClose(); });

export function openModal(title, bodyHtml, { onMount } = {}) {
  ensureHost();
  if (!modalOpen) { modalOpen = true; history.pushState({ fzModal: 1 }, ""); }
  host.innerHTML = `
    <div class="modal-bg" data-close>
      <div class="modal">
        <div class="row between mb-3">
          <h3 style="font-size:18px">${title}</h3>
          <button class="icon-btn" data-close>✕</button>
        </div>
        <div id="modal-body">${bodyHtml}</div>
      </div>
    </div>`;
  host.querySelectorAll("[data-close]").forEach((el) =>
    el.addEventListener("click", (e) => { if (e.target === el) requestClose(); }));
  if (onMount) onMount(host.querySelector("#modal-body"));
  initialSnap = formSnap(); // ya con valores por defecto puestos por onMount
}

export function closeModal() {
  if (host) host.innerHTML = "";
  if (modalOpen) { modalOpen = false; popPending = true; history.back(); }
}

// muestra el valor en COP formateado debajo de un input numérico mientras se escribe
// (evita errores de "un cero de más/menos" en montos grandes)
export function moneyPreview(input) {
  if (!input) return;
  const hint = document.createElement("div");
  hint.className = "tiny";
  hint.style.cssText = "margin-top:4px;color:var(--gold);min-height:15px";
  input.insertAdjacentElement("afterend", hint);
  const upd = () => { const v = +input.value; hint.textContent = v ? fmt(v) : ""; };
  input.addEventListener("input", upd); upd();
}

export function toast(msg, isErr = false) {
  const t = document.createElement("div");
  t.className = "toast" + (isErr ? " err" : "");
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2400);
}

// toast con botón "Deshacer": si el usuario lo toca antes de ~6 s, ejecuta onUndo
export function toastUndo(msg, onUndo) {
  const t = document.createElement("div");
  t.className = "toast";
  t.style.cssText += ";display:flex;align-items:center;gap:14px";
  const span = document.createElement("span"); span.textContent = msg;
  const btn = document.createElement("button");
  btn.textContent = "Deshacer";
  btn.style.cssText = "background:none;border:none;color:var(--gold);font-weight:700;cursor:pointer;font-size:13px;padding:0";
  btn.onclick = () => { t.remove(); onUndo(); };
  t.append(span, btn);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 6000);
}

// Asigna un onclick que NO se puede disparar dos veces: bloquea el botón al primer
// toque (evita duplicados por doble-tap o esperas de red) y lo reactiva si hay error.
export function submitOnce(btn, asyncFn, busyLabel = "Guardando…") {
  if (!btn) return;
  btn.onclick = async () => {
    if (btn.dataset.busy === "1") return;
    btn.dataset.busy = "1"; btn.disabled = true;
    const orig = btn.textContent; btn.textContent = busyLabel;
    try {
      await asyncFn();
    } catch (e) {
      console.error(e); toast("Algo falló, intenta de nuevo", true);
    } finally {
      btn.dataset.busy = "0"; btn.disabled = false; btn.textContent = orig;
    }
  };
}

// confirmDialog(msg, onYes, opciones)
//  - yesLabel: texto del botón de confirmar (def. "Eliminar")
//  - danger: rojo si es destructivo (def. true); false = botón primario (importar/calcular…)
//  - busyLabel: si se da, el botón muestra ese texto y espera a que onYes termine antes de cerrar
export function confirmDialog(msg, onYes, { yesLabel = "Eliminar", danger = true, busyLabel } = {}) {
  openModal("Confirmar", `
    <p class="muted mb-4" style="font-size:14px">${msg}</p>
    <div class="row gap-2">
      <button class="btn btn-ghost flex1" data-no>Cancelar</button>
      <button class="btn ${danger ? "btn-danger" : "btn-primary"} flex1" data-yes>${yesLabel}</button>
    </div>`, {
    onMount(b) {
      const yes = b.querySelector("[data-yes]"), no = b.querySelector("[data-no]");
      no.onclick = closeModal;
      yes.onclick = async () => {
        if (yes.dataset.busy === "1") return;
        const ret = onYes();
        if (busyLabel && ret && typeof ret.then === "function") {
          yes.dataset.busy = "1"; yes.disabled = true; no.disabled = true; yes.textContent = busyLabel;
          try { await ret; } catch (e) { console.error(e); toast("Algo falló, intenta de nuevo", true); }
          closeModal();
        } else {
          closeModal();
        }
      };
    },
  });
}
