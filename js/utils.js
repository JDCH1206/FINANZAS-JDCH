// js/utils.js — utilidades

export const fmt = (n) => "$" + Math.round(+n || 0).toLocaleString("es-CO");
export const fmtShort = (n) => {
  n = +n || 0;
  if (Math.abs(n) >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M";
  if (Math.abs(n) >= 1e3) return "$" + Math.round(n / 1e3) + "k";
  return "$" + Math.round(n);
};
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const ym = (d) => (d || "").slice(0, 7);
// fecha local (no UTC) → evita el desfase de día en zonas como Colombia (UTC-5)
export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const curMonth = () => todayISO().slice(0, 7);
// formatea un Date en HORA LOCAL como YYYY-MM-DD (no UTC) → evita desfase de día
export const isoLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export const monthLabel = (k) => {
  if (!k) return "";
  const [y, m] = k.split("-");
  return `${MES[+m - 1]}-${y}`;
};

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// normaliza una fecha de Excel (Date | serial | texto) a YYYY-MM-DD
export function normDate(v) {
  if (v instanceof Date) return isoLocal(v);
  if (typeof v === "number") {
    // serial de Excel → fecha en UTC para evitar que la zona horaria mueva el día
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }
  const s = String(v || "").trim();
  // ISO (con o sin hora): 2022-06-20 o 2022-06-20T05:00:00.000Z
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // Formato US en texto: M/D/AAAA o M/D/AA  (ej. 5/27/2022)
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    let [, mo, d, y] = m;
    if (y.length === 2) y = "20" + y;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return s.slice(0, 10);
}

export const debounce = (fn, ms = 600) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

export const sum = (arr, f = (x) => x) => arr.reduce((s, x) => s + (+f(x) || 0), 0);
