// js/app.js — orquestador principal
import { getState, setState } from "./state.js";
import { onAuth, subscribeData, isCloud, loadOblig } from "./firebase-service.js";
import { todayISO } from "./utils.js";
import { OBLIG_TIPOS } from "./config.js";
import { showReminders } from "./notify.js";
import * as fbsvc from "./firebase-service.js";
import { renderLogin } from "./views/login.js";
import { renderOnboarding } from "./views/onboarding.js";
import { renderHome } from "./views/home.js";
import { renderSummary } from "./views/summary.js";
import { renderDashboard } from "./views/dashboard.js";
import { renderBudget } from "./views/budget.js";
import { renderAccounts } from "./views/accounts.js";
import { renderCategories } from "./views/categories.js";
import { renderSettings } from "./views/settings.js";
import { renderVehicles } from "./views/vehicles.js";
import { openModal, closeModal, toast } from "./components/modals.js";

const app = document.getElementById("app");

// tema (claro/oscuro) — se aplica antes de renderizar
const savedTheme = localStorage.getItem("fz_theme");
if (savedTheme) document.documentElement.setAttribute("data-theme", savedTheme);

// red de seguridad: avisa si una escritura a la nube falla (offline, permiso, cuota)
window.addEventListener("unhandledrejection", (e) => {
  const msg = String((e.reason && e.reason.message) || e.reason || "");
  if (/firestore|permission|unavailable|network|backend|deadline|quota/i.test(msg)) {
    toast("No se pudo guardar en la nube. Revisa tu conexión; se reintenta al volver.", true);
  }
});

// --- PWA: barra "Instalar app" ---
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault(); deferredPrompt = e;
  if (localStorage.getItem("fz_install_dismissed")) return;
  if (document.getElementById("install-bar")) return;
  const bar = document.createElement("div");
  bar.id = "install-bar";
  bar.style.cssText = "position:fixed;left:14px;right:14px;bottom:74px;margin:0 auto;max-width:500px;background:var(--gold);color:var(--gold-ink);padding:10px 14px;border-radius:12px;display:flex;align-items:center;gap:10px;z-index:60;box-shadow:var(--shadow)";
  bar.innerHTML = `<span style="flex:1;font-weight:600">📲 Instala Finanzas JDCH en tu dispositivo</span><button id="ib-yes" style="background:#0e1417;color:#fff;border:none;border-radius:8px;padding:6px 12px;font-weight:700;cursor:pointer">Instalar</button><button id="ib-no" style="background:transparent;border:none;color:inherit;font-size:18px;cursor:pointer">✕</button>`;
  document.body.appendChild(bar);
  bar.querySelector("#ib-yes").onclick = async () => { bar.remove(); if (deferredPrompt) { deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; } };
  bar.querySelector("#ib-no").onclick = () => { bar.remove(); localStorage.setItem("fz_install_dismissed", "1"); };
});

// --- indicador de sin conexión ---
function updateOnline() {
  let bar = document.getElementById("offline-bar");
  if (!navigator.onLine) {
    if (!bar) {
      bar = document.createElement("div"); bar.id = "offline-bar";
      bar.style.cssText = "position:fixed;top:0;left:0;right:0;background:var(--red);color:#fff;text-align:center;padding:5px;font-size:12.5px;z-index:70";
      bar.textContent = "Sin conexión — tus cambios se guardan y se sincronizan al volver";
      document.body.appendChild(bar);
    }
  } else if (bar) { bar.remove(); }
}
window.addEventListener("online", updateOnline);
window.addEventListener("offline", updateOnline);
updateOnline();

// permite que firebase-service persista el estado en modo local
fbsvc.bindLocalState(() => getState());

const NAV = [
  { id: "summary", label: "Resumen", icon: '<path d="M3 3v18h18"/><path d="M7 14l3-3 3 3 5-6"/>' },
  { id: "home", label: "Movim.", icon: '<path d="M9 11l3 3 8-8M4 12v7a1 1 0 001 1h14"/>' },
  { id: "dash", label: "Tablero", icon: '<rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>' },
  { id: "budget", label: "Presup.", icon: '<path d="M3 7h18v12H3zM3 7l3-4h12l3 4M8 12h.01M16 12a4 4 0 01-8 0"/>' },
  { id: "accounts", label: "Cuentas", icon: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>' },
  { id: "cats", label: "Categ.", icon: '<path d="M3 7l9-4 9 4-9 4-9-4zM3 12l9 4 9-4M3 17l9 4 9-4"/>' },
  { id: "settings", label: "Ajustes", icon: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 00-.1-1l2-1.6-2-3.4-2.4 1a7 7 0 00-1.7-1l-.4-2.5H9.6L9.2 5a7 7 0 00-1.7 1l-2.4-1-2 3.4 2 1.6a7 7 0 000 2l-2 1.6 2 3.4 2.4-1a7 7 0 001.7 1l.4 2.5h4.8l.4-2.5a7 7 0 001.7-1l2.4 1 2-3.4-2-1.6c.1-.3.1-.7.1-1z"/>' },
  { id: "more", label: "Más", icon: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>' },
];

// Rutas accesibles desde el menú "Más" (módulos opcionales)
function moreRoutes() {
  const s = getState();
  const items = [];
  if (s.vehiclesEnabled) items.push({ id: "vehicles", label: "Vehículos", icon: "🚗" });
  return items;
}
function openMoreMenu() {
  const items = moreRoutes();
  const body = items.length
    ? items.map((it) => `<button class="btn btn-ghost btn-block mb-2" data-go="${it.id}" style="justify-content:flex-start;gap:10px;font-size:15px">${it.icon} ${it.label}</button>`).join("")
    : `<p class="muted small">No tienes módulos extra activos. Puedes activarlos en <b>Ajustes</b> (ej. el módulo de Vehículos).</p>`;
  openModal("Más", body, {
    onMount(b) {
      b.querySelectorAll("[data-go]").forEach((x) => x.onclick = () => { closeModal(); go(x.getAttribute("data-go")); });
    },
  });
}

/* ---------- arranque ---------- */
let unsubscribeData = null; // listener de tiempo real activo
let booted = false;         // ya se montó la app para esta sesión

onAuth(async (user) => {
  if (!user) {
    stopSession();
    setState({ user: null, loading: false });
    renderLogin(app, afterLogin);
    return;
  }
  startSession(user);
});

async function afterLogin(user) { startSession(user); }

function stopSession() {
  if (unsubscribeData) { unsubscribeData(); unsubscribeData = null; }
  document.getElementById("fab")?.remove(); // quita el botón flotante de Movimientos
  booted = false;
}

function startSession(user) {
  stopSession();
  setState({ user, cloud: isCloud(), loading: true });
  showLoading();
  unsubscribeData = subscribeData(user.uid, (data) => {
    setState({
      profile: data.profile, cats: data.cats, budgets: data.budgets,
      accounts: data.accounts || [], payMethods: data.payMethods || [],
      vehicles: data.vehicles || [], vehiclesEnabled: data.vehiclesEnabled || false, goals: data.goals || [],
      txs: data.txs, incomes: data.incomes || [], loading: false,
    });
    if (!booted) {
      booted = true;
      if (data.isNew) { renderOnboarding(app, () => mountShell("summary")); }
      else { mountShell("summary"); checkBackupReminder(); checkVehicleAlerts(); }
    } else if (data.fromRemote) {
      liveRefresh();
    }
  });
}

// Refresca la vista actual cuando llega un cambio en vivo desde otro dispositivo.
// No interrumpe si hay un formulario/diálogo abierto, ni antes de montar el shell.
function liveRefresh() {
  if (document.querySelector(".modal-bg")) return;
  if (!document.getElementById("nav")) return;
  draw(getState().route);
}

/* ---------- shell + router ---------- */
function mountShell(route) {
  setState({ route });
  const s = getState();
  app.innerHTML = `
    <header class="app-header">
      <div class="inner">
        <div class="logo"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 5c-1.5 0-2.8 1.4-3 2-3.5-1.5-11-.3-11 5 0 1.8 0 3 2 4.5V20h4v-2h3v2h4v-4c1-.5 1.7-1 2-2h2v-4h-2c0-1-.5-1.5-1-2V5z"/></svg></div>
        <div><div class="title disp">Finanzas JDCH</div><div class="sub">COICOP · 50/30/20 · DANE</div></div>
        <div class="cloud-dot"><span class="d ${isCloud() ? "" : "local"}"></span>${isCloud() ? "nube" : "local"}</div>
      </div>
    </header>
    <main class="page pop" id="view"></main>
    <nav class="bottom-nav" id="nav">
      ${NAV.map((n) => `<button data-route="${n.id}" class="${route === n.id ? "on" : ""}">
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9">${n.icon}</svg>
        <span class="lbl">${n.label}</span></button>`).join("")}
    </nav>`;
  app.querySelectorAll("[data-route]").forEach((b) => b.onclick = () => {
    const r = b.getAttribute("data-route");
    if (r === "more") return openMoreMenu();
    go(r);
  });
  draw(route);
}

function go(route) {
  setState({ route });
  document.querySelectorAll("#nav button").forEach((b) => {
    const r = b.getAttribute("data-route");
    b.classList.toggle("on", r === route || (r === "more" && route === "vehicles"));
  });
  const view = document.getElementById("view");
  view.classList.remove("pop"); void view.offsetWidth; view.classList.add("pop");
  draw(route);
}

function draw(route) {
  const view = document.getElementById("view");
  if (route !== "home") document.getElementById("fab")?.remove(); // FAB solo en Movimientos
  switch (route) {
    case "summary": return renderSummary(view);
    case "home": return renderHome(view);
    case "dash": return renderDashboard(view);
    case "budget": return renderBudget(view);
    case "accounts": return renderAccounts(view);
    case "cats": return renderCategories(view);
    case "vehicles": return renderVehicles(view);
    case "settings": return renderSettings(view, () => { stopSession(); setState({ user: null }); renderLogin(app, afterLogin); });
  }
}

// recordatorio de respaldo (cada 30 días) — solo con nube no es crítico, pero útil en local
function checkBackupReminder() {
  try {
    const last = localStorage.getItem("fz_last_backup");
    const days = last ? Math.round((Date.now() - new Date(last + "T00:00:00")) / 86400000) : 999;
    if (days >= 30) setTimeout(() => toast(last ? `Hace ${days} días no descargas un respaldo. Ajustes → Descargar respaldo.` : "Tip: descarga un respaldo en Ajustes para proteger tus datos."), 1800);
  } catch (e) { /* noop */ }
}

const OBLIG_LABEL = (k) => (OBLIG_TIPOS.find((t) => t.key === k) || {}).label || k;
function addDaysISO(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}
// lista de recordatorios (obligaciones por vencer/vencidas + mantenimientos que tocan)
function computeReminders(oblig, maint, vehicles, today) {
  const out = [];
  const vmap = Object.fromEntries((vehicles || []).map((v) => [v.id, v]));
  const daysTo = (d) => Math.round((new Date(d + "T00:00:00") - new Date(today + "T00:00:00")) / 86400000);
  // obligaciones legales (tienen fecha de vencimiento)
  for (const o of oblig) {
    if (o.estado === "TRAMITE" || !o.fechaVencimiento) continue;
    const dias = daysTo(o.fechaVencimiento);
    if (dias <= (o.diasAviso || 30)) {
      const v = vmap[o.vehicleId]; const veh = v ? ` (${v.alias || v.modelo})` : "";
      out.push(`${OBLIG_LABEL(o.tipo)}${veh}: ${dias < 0 ? `vencido hace ${-dias} d` : dias === 0 ? "vence hoy" : `vence en ${dias} d`}`);
    }
  }
  // mantenimiento: solo el más reciente por (vehículo|categoría|tipo)
  const latest = {};
  for (const r of maint) { const k = r.vehicleId + "|" + r.categoria + "|" + r.tipo; if (!latest[k] || (r.fecha || "") > (latest[k].fecha || "")) latest[k] = r; }
  for (const r of Object.values(latest)) {
    const v = vmap[r.vehicleId]; if (!v) continue; const veh = ` (${v.alias || v.modelo})`;
    const nextKm = r.proximoKm || (r.recurrenteKm ? (r.odometro || 0) + r.recurrenteKm : null);
    const nextDate = r.proximaFecha || (r.recurrenteDias && r.fecha ? addDaysISO(r.fecha, r.recurrenteDias) : null);
    if (nextKm != null && (v.odometro || 0) >= nextKm) out.push(`${r.tipo}${veh}: toca (${Number(nextKm).toLocaleString("es-CO")} km)`);
    else if (nextDate) { const dias = daysTo(nextDate); if (dias <= 7) out.push(`${r.tipo}${veh}: ${dias < 0 ? "atrasado" : dias === 0 ? "hoy" : `en ${dias} d`}`); }
  }
  return out;
}

// badge en "Más" + notificación de recordatorios (una vez al día)
async function checkVehicleAlerts() {
  const s = getState();
  if (!s.vehiclesEnabled) return;
  try {
    const [obl, maint] = await Promise.all([fbsvc.loadOblig(s.user.uid), fbsvc.loadMaint(s.user.uid)]);
    const items = computeReminders(obl, maint, s.vehicles, todayISO());
    const moreBtn = document.querySelector('#nav button[data-route="more"]');
    if (moreBtn && items.length > 0 && !moreBtn.querySelector(".nav-badge")) {
      const badge = document.createElement("span");
      badge.className = "nav-badge"; badge.textContent = items.length;
      badge.style.cssText = "position:absolute;top:3px;right:14px;background:var(--red);color:#fff;border-radius:10px;font-size:10px;line-height:1;padding:2px 5px;font-weight:700";
      moreBtn.style.position = "relative";
      moreBtn.appendChild(badge);
    }
    showReminders(items, todayISO());
  } catch (e) { /* noop */ }
}

function showLoading() {
  app.innerHTML = `<div style="min-height:100vh;display:grid;place-items:center"><div class="loader spin"></div></div>`;
}

// registrar service worker (PWA) con auto-actualización
if ("serviceWorker" in navigator) {
  // cuando una versión nueva toma control, recarga una sola vez (sin DevTools)
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return; refreshing = true; location.reload();
  });
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" })
      .then((reg) => reg.update())   // busca versión nueva en cada carga
      .catch(() => {});
  });
}
