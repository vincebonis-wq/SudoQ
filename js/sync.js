/* =========================================================================
 * SudoQ — Synchronisation cloud via Firebase Realtime Database
 *
 * Fiable, gratuit, fonctionne depuis n'importe quel réseau/appareil.
 * L'URL de la base n'est pas un secret (la sécurité vient des règles Firebase :
 * accès uniquement sous /spaces/<code>, code non devinable).
 *
 * API REST Firebase :
 *   - lire    : GET  <DB>/spaces/<code>.json     (renvoie null si absent)
 *   - écrire  : PUT  <DB>/spaces/<code>.json     (remplace le contenu)
 *
 * Tout est isolé ici : pour changer de fournisseur, réécrire createSpace /
 * pull / push / check.
 * ========================================================================= */
(function () {
  "use strict";

  // Base Realtime Database (sans slash final).
  const DB = "https://sudoq-b7925-default-rtdb.europe-west1.firebasedatabase.app";

  function spaceUrl(code) {
    return `${DB}/spaces/${encodeURIComponent(code)}.json`;
  }

  // fetch avec réessais : rejoue sur erreur réseau / 429 / 5xx.
  async function fetchRetry(url, opts, tries) {
    tries = tries || 3;
    let lastErr;
    for (let i = 0; i < tries; i++) {
      try {
        const res = await fetch(url, opts);
        if (res.ok) return res;
        if (res.status !== 429 && res.status < 500) return res; // 4xx définitif
        lastErr = new Error("HTTP " + res.status);
      } catch (e) {
        lastErr = e; // "Failed to fetch" = réseau/CORS
      }
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
    throw lastErr || new Error("échec réseau");
  }

  // Génère un code d'espace unique et non devinable.
  function newCode() {
    try {
      if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    } catch (e) {}
    return (
      "s" +
      Math.random().toString(36).slice(2, 10) +
      Date.now().toString(36)
    );
  }

  // Crée un nouvel espace (écrit l'état initial) et renvoie son code.
  async function createSpace(initialDoc) {
    const code = newCode();
    const res = await fetchRetry(spaceUrl(code), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(initialDoc || { app: "SudoQ", records: {} }),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return code;
  }

  // Récupère le document distant (ou null s'il n'existe pas encore).
  async function pull(code) {
    const res = await fetchRetry(`${spaceUrl(code)}?_=${Date.now()}`, {
      cache: "no-store",
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const txt = await res.text();
    if (!txt || txt === "null") return null; // Firebase renvoie "null" si absent
    try {
      return JSON.parse(txt);
    } catch (e) {
      return null;
    }
  }

  // Met à jour le document distant par FUSION (PATCH) : ne modifie que les clés
  // de SudoQ et laisse intactes les données des autres jeux (ex. /navale) qui
  // partagent le même espace de couple.
  async function push(code, doc) {
    const res = await fetchRetry(spaceUrl(code), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(doc),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return true;
  }

  // Vérifie que l'espace est joignable (le serveur répond).
  async function check(code) {
    const res = await fetchRetry(`${spaceUrl(code)}?_=${Date.now()}`, {
      cache: "no-store",
    });
    return res.ok;
  }

  window.Sync = { createSpace, pull, push, check, provider: "firebase" };
})();
