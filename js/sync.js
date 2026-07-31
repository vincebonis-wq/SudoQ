/* =========================================================================
 * SudoQ — Synchronisation cloud (gratuite, sans compte)
 *
 * Fournisseur : jsonblob.com — stockage JSON gratuit, sans inscription,
 * conçu pour être utilisé directement depuis le navigateur (CORS activé).
 *
 * Principe : on crée un "blob" (= espace de couple). Son identifiant est le
 * "code de couple" que les deux joueurs partagent. Les records y sont stockés
 * puis fusionnés localement (on garde le meilleur temps).
 *
 * Tout est isolé ici : pour changer de fournisseur, réécrire createSpace /
 * pull / push / check (4 fonctions).
 * ========================================================================= */
(function () {
  "use strict";

  const API = "https://jsonblob.com/api/jsonBlob";

  // Extrait l'identifiant du blob depuis l'en-tête Location (URL absolue ou relative).
  function idFromLocation(loc) {
    if (!loc) return null;
    const parts = loc.split("/").filter(Boolean);
    return parts[parts.length - 1] || null;
  }

  // Crée un nouvel espace et renvoie son code (identifiant de blob).
  async function createSpace(initialDoc) {
    const res = await fetch(API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(initialDoc || { app: "SudoQ", records: {} }),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    // L'id est renvoyé dans l'en-tête Location (jsonblob expose cet en-tête en CORS).
    let id = idFromLocation(res.headers.get("Location"));
    if (!id) id = idFromLocation(res.headers.get("X-jsonblob"));
    if (!id) throw new Error("Identifiant de l'espace introuvable");
    return id;
  }

  // Récupère le document distant (ou null s'il n'existe pas / est vide).
  async function pull(code) {
    // Le paramètre _ casse tout cache éventuel (navigateur/CDN) à la lecture.
    const res = await fetch(`${API}/${encodeURIComponent(code)}?_=${Date.now()}`, {
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

  // Écrit (remplace) le document distant.
  async function push(code, doc) {
    const res = await fetch(`${API}/${encodeURIComponent(code)}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(doc),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return true;
  }

  // Vérifie qu'un code existe / est joignable (pour "Rejoindre").
  async function check(code) {
    const res = await fetch(`${API}/${encodeURIComponent(code)}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    return res.ok;
  }

  window.Sync = { createSpace, pull, push, check, provider: "jsonblob.com" };
})();
