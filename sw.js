// sw.js — service worker (cache del shell de la app)
const CACHE = "finanzas-jdch-v32";
const ASSETS = [
  "./", "./index.html", "./manifest.json",
  "./css/tokens.css", "./css/base.css", "./css/components.css", "./css/pages.css",
  "./js/app.js", "./js/config.js", "./js/state.js", "./js/utils.js",
  "./js/firebase-service.js", "./firebase-config.js",
  "./js/views/login.js", "./js/views/onboarding.js", "./js/views/home.js", "./js/views/summary.js", "./js/views/accounts.js",
  "./js/views/dashboard.js", "./js/views/budget.js", "./js/views/categories.js", "./js/views/settings.js", "./js/views/vehicles.js",
  "./js/components/charts.js", "./js/components/modals.js",
  "./icons/icon-192.png", "./icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // no cachear Firebase/CDN dinámicos: ir a la red
  if (url.origin !== location.origin) return;

  const esImagen = /\.(png|jpg|jpeg|svg|webp|ico)$/.test(url.pathname);
  if (esImagen) {
    // imágenes/íconos: caché primero (rápido, casi nunca cambian)
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      return res;
    })));
    return;
  }

  // HTML/JS/CSS: RED PRIMERO con revalidación (no-cache) → siempre código
  // actualizado si hay internet; si no hay red, responde desde la caché.
  e.respondWith(
    fetch(e.request, { cache: "no-cache" }).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(e.request).then((hit) => hit || caches.match("./index.html")))
  );
});
