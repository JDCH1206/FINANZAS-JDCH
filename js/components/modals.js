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
