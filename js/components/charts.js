// js/components/charts.js — wrappers de Chart.js
import { PALETTE } from "../config.js";
import { fmt, fmtShort } from "../utils.js";

const registry = {};
function mount(id, config) {
  const el = document.getElementById(id);
  if (!el) return;
  if (typeof Chart === "undefined") {
    // Chart.js aún no cargó (red lenta/offline): mostrar aviso sin romper la app
    const box = el.parentElement;
    if (box) box.innerHTML = '<div class="muted small" style="display:grid;place-items:center;height:100%">Gráfico no disponible sin conexión</div>';
    return;
  }
  if (registry[id]) { registry[id].destroy(); }
  registry[id] = new Chart(el.getContext("2d"), config);
}

const AXIS = "#8aa0a3", GRID = "#26333a";
const baseScales = {
  x: { ticks: { color: AXIS, font: { size: 10 } }, grid: { display: false } },
  y: { ticks: { color: AXIS, font: { size: 10 }, callback: (v) => fmtShort(v) }, grid: { color: GRID } },
};

export function donut(id, labels, data) {
  mount(id, {
    type: "doughnut",
    data: { labels, datasets: [{ data, backgroundColor: labels.map((_, i) => PALETTE[i % PALETTE.length]), borderColor: "#161e22", borderWidth: 2 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: "58%",
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${c.label}: ${fmt(c.raw)}` } } },
    },
  });
}

export function lineTrend(id, labels, data) {
  mount(id, {
    type: "line",
    data: { labels, datasets: [{ data, borderColor: "#d8a657", backgroundColor: "rgba(216,166,87,.12)", borderWidth: 2.5, fill: true, tension: .3, pointRadius: 3, pointBackgroundColor: "#d8a657" }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => " " + fmt(c.raw) } } }, scales: baseScales },
  });
}

// línea de porcentajes (ej. evolución de la tasa de ahorro)
export function lineTrendPct(id, labels, data) {
  mount(id, {
    type: "line",
    data: { labels, datasets: [{ data, borderColor: "#7fbf7f", backgroundColor: "rgba(127,191,127,.12)", borderWidth: 2.5, fill: true, tension: .3, pointRadius: 3, pointBackgroundColor: "#7fbf7f" }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => " " + c.raw + "%" } } },
      scales: {
        x: { ticks: { color: AXIS, font: { size: 10 } }, grid: { display: false } },
        y: { ticks: { color: AXIS, font: { size: 10 }, callback: (v) => v + "%" }, grid: { color: GRID } },
      },
    },
  });
}

// línea numérica genérica (ej. rendimiento km/galón)
export function lineNum(id, labels, data, color = "#5a8fb0", suffix = "") {
  mount(id, {
    type: "line",
    data: { labels, datasets: [{ data, borderColor: color, backgroundColor: "transparent", borderWidth: 2.5, tension: .3, pointRadius: 2, pointBackgroundColor: color }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => " " + c.raw + suffix } } },
      scales: {
        x: { ticks: { color: AXIS, font: { size: 9 }, maxTicksLimit: 8 }, grid: { display: false } },
        y: { ticks: { color: AXIS, font: { size: 10 }, callback: (v) => v + suffix }, grid: { color: GRID } },
      },
    },
  });
}

export function budgetBars(id, labels, presup, real) {
  mount(id, {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "Presupuesto", data: presup, backgroundColor: "#5a8fb0", borderRadius: 4 },
        { label: "Real", data: real, backgroundColor: "#d8a657", borderRadius: 4 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: AXIS, font: { size: 11 } } }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${fmt(c.raw)}` } } },
      scales: baseScales,
    },
  });
}

// Barras agrupadas: dos series comparables (ej. este año vs anterior)
export function groupedBars(id, labels, a, b, la, lb) {
  mount(id, {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: la, data: a, backgroundColor: "#d8a657", borderRadius: 4 },
        { label: lb, data: b, backgroundColor: "#5a8fb0", borderRadius: 4 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: AXIS, font: { size: 11 } } }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${fmt(c.raw)}` } } },
      scales: baseScales,
    },
  });
}

// "treemap" simplificado: barras horizontales proporcionales por categoría
export function categoryBars(id, labels, data) {
  mount(id, {
    type: "bar",
    data: { labels, datasets: [{ data, backgroundColor: labels.map((_, i) => PALETTE[i % PALETTE.length]), borderRadius: 4 }] },
    options: {
      indexAxis: "y", responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => " " + fmt(c.raw) } } },
      scales: {
        x: { ticks: { color: AXIS, font: { size: 10 }, callback: (v) => fmtShort(v) }, grid: { color: GRID } },
        y: { ticks: { color: AXIS, font: { size: 11 } }, grid: { display: false } },
      },
    },
  });
}

export function destroyAll() { Object.values(registry).forEach((c) => c.destroy()); Object.keys(registry).forEach((k) => delete registry[k]); }
