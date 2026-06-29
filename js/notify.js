// js/notify.js — recordatorios locales con notificaciones del navegador.
// Se muestran al abrir la app (una vez al día). El aviso real "con la app cerrada"
// requeriría un servidor de push; aquí usamos notificaciones locales del sistema.
const KEY_ENABLED = "fz_notif_enabled";
const KEY_LAST = "fz_notif_last";

export const notifSupported = () => typeof Notification !== "undefined";
export const notifEnabled = () =>
  notifSupported() && Notification.permission === "granted" && localStorage.getItem(KEY_ENABLED) === "1";

// pide permiso y activa. Devuelve "granted" | "denied" | "unsupported"
export async function enableNotif() {
  if (!notifSupported()) return "unsupported";
  let perm = Notification.permission;
  if (perm === "default") perm = await Notification.requestPermission();
  if (perm === "granted") { localStorage.setItem(KEY_ENABLED, "1"); return "granted"; }
  return perm; // "denied"
}
export function disableNotif() { localStorage.setItem(KEY_ENABLED, "0"); }

// muestra una notificación con los recordatorios; máximo una vez por día
export async function showReminders(items, todayKey) {
  if (!items.length || !notifEnabled()) return false;
  if (localStorage.getItem(KEY_LAST) === todayKey) return false;
  localStorage.setItem(KEY_LAST, todayKey);
  const title = `Finanzas JDCH — ${items.length} recordatorio${items.length > 1 ? "s" : ""}`;
  const body = items.slice(0, 5).join("\n") + (items.length > 5 ? `\n…y ${items.length - 5} más` : "");
  const opts = { body, icon: "./icons/icon-192.png", badge: "./icons/icon-192.png", tag: "fz-reminders", renotify: true };
  try {
    if (navigator.serviceWorker) { const reg = await navigator.serviceWorker.ready; await reg.showNotification(title, opts); return true; }
  } catch (e) { /* cae al fallback */ }
  try { new Notification(title, opts); return true; } catch (e) { return false; }
}
