/* =========================================================================
 * SudoQ — Synchronisation cloud (gratuite, sans compte)
 *
 * Fournisseur : jsonblob.com — stockage JSON gratuit, sans inscription,
 * utilisable directement depuis le navigateur (CORS activé).
 *
 * Requêtes avec réessais automatiques (backoff) pour lisser les ratés réseau.
 * Tout est isolé ici : pour changer de fournisseur, réécrire createSpace /
 * pull / push / check.
 * ========================================================================= */
(function () {
  "use strict";

  const API = "https://jsonblob.com/api/jsonBlob";

  // fetch avec réessais : rejoue sur erreur réseau, 429 ou 5xx (jusqu'à `tries`).
  async function fetchRetry(url, opts, tries) {
    tries = tries || 3;
    let lastErr;
    for (let i = 0; i < tries; i++) {
      try {
        const res = await fetch(url, opts);
        if (res.ok || res.status === 404) return res;
        if (res.status !== 429 && res.status < 500) return res; // 4xx définitif
        lastErr = new Error("HTTP " + res.status);
      } catch (e) {
        // "Failed to fetch" = réseau ou CORS
        lastErr = e;
      }
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
    throw lastErr || new Error("échec réseau");
  }

  function idFromLocation(loc) {
    if (!loc) return null;
    const parts = loc.split("/").filter(Boolean);
    return parts[parts.length - 1] || null;
  }

  async function createSpace(initialDoc) {
    const res = await fetchRetry(API, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(initialDoc || { app: "SudoQ", records: {} }),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    let id = idFromLocation(res.headers.get("Location"));
    if (!id) id = idFromLocation(res.headers.get("X-jsonblob"));
    if (!id) throw new Error("Identifiant de l'espace introuvable");
    return id;
  }

  async function pull(code) {
    const res = await fetchRetry(`${API}/${encodeURIComponent(code)}?_=${Date.now()}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error("HTTP " + res.status);
    const txt = await res.text();
    if (!txt) return null;
    try {
      return JSON.parse(txt);
    } catch (e) {
      return null;
    }
  }

  async function push(code, doc) {
    const res = await fetchRetry(`${API}/${encodeURIComponent(code)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(doc),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return true;
  }

  async function check(code) {
    const res = await fetchRetry(`${API}/${encodeURIComponent(code)}?_=${Date.now()}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    return res.ok || res.status === 404;
  }

  window.Sync = { createSpace, pull, push, check, provider: "jsonblob.com" };
})();
