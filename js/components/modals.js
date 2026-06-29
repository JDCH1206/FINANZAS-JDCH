// js/components/modals.js
let host;
function ensureHost() {
  if (!host) { host = document.createElement("div"); document.body.appendChild(host); }
  return host;
}

export function openModal(title, bodyHtml, { onMount } = {}) {
  ensureHost();
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
    el.addEventListener("click", (e) => { if (e.target.hasAttribute("data-close")) closeModal(); }));
  if (onMount) onMount(host.querySelector("#modal-body"));
}

export function closeModal() { if (host) host.innerHTML = ""; }

export function toast(msg, isErr = false) {
  const t = document.createElement("div");
  t.className = "toast" + (isErr ? " err" : "");
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2400);
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

export function confirmDialog(msg, onYes) {
  openModal("Confirmar", `
    <p class="muted mb-4" style="font-size:14px">${msg}</p>
    <div class="row gap-2">
      <button class="btn btn-ghost flex1" data-no>Cancelar</button>
      <button class="btn btn-danger flex1" data-yes>Eliminar</button>
    </div>`, {
    onMount(b) {
      b.querySelector("[data-no]").onclick = closeModal;
      b.querySelector("[data-yes]").onclick = () => { closeModal(); onYes(); };
    },
  });
}
