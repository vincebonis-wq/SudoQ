/* =========================================================================
 * SudoQ — Service Worker (PWA installable + chargement instantané).
 *
 * Stratégies :
 *   • Navigations / pages HTML : réseau d'abord (toujours à jour quand en
 *     ligne), repli sur le cache hors-ligne.
 *   • Autres ressources même origine (CSS/JS/images) : cache d'abord avec
 *     revalidation en arrière-plan (stale-while-revalidate) → affichage
 *     instantané, mise à jour silencieuse. Les URLs versionnées (?v=NN)
 *     rendent toute nouvelle version automatiquement fraîche.
 *   • Cross-origin (Firebase, Google Fonts) : jamais intercepté → le temps
 *     réel et les données passent directement au réseau.
 *
 * Bump CACHE à chaque déploiement pour purger l'ancien cache.
 * ========================================================================= */
const CACHE = "sudoq-v18";
const CORE = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./bataille-navale/index.html",
  "./escape/index.html",
  "./capsules/index.html",
  "./ligue/index.html",
];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then((c) => Promise.allSettled(CORE.map((u) => c.add(u))))
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Firebase & polices : réseau direct

  const isHTML =
    req.mode === "navigate" ||
    (req.headers.get("accept") || "").includes("text/html");

  if (isHTML) {
    // Réseau d'abord : la page est toujours à jour quand on est en ligne.
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match("./index.html")))
    );
    return;
  }

  // Ressources statiques : cache d'abord + revalidation en arrière-plan.
  e.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
