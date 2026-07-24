/* =========================================================================
 * SudoQ — Synchronisation cloud (gratuite, sans compte)
 *
 * Fournisseur : kvdb.io — stockage clé/valeur gratuit, sans inscription,
 * utilisable directement depuis le navigateur (CORS activé).
 *
 * Principe : on crée un "bucket" (= espace de couple). Son identifiant est le
 * "code de couple" que les deux joueurs partagent. Les records y sont stockés
 * sous une clé unique, puis fusionnés localement (on garde le meilleur temps).
 *
 * Pour changer de fournisseur, il suffit de réécrire createSpace / pull / push.
 * ========================================================================= */
(function () {
  "use strict";

  const BASE = "https://kvdb.io";
  const KEY = "sudoq"; // nom de la clé dans le bucket

  // Crée un nouvel espace et renvoie son code (identifiant de bucket).
  async function createSpace() {
    const res = await fetch(BASE + "/", { method: "POST" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const id = (await res.text()).trim();
    if (!id || id.length < 6) throw new Error("Identifiant invalide");
    return id;
  }

  // Récupère le document distant (ou null s'il n'existe pas encore).
  async function pull(code) {
    const res = await fetch(`${BASE}/${encodeURIComponent(code)}/${KEY}`, {
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

  // Écrit le document distant.
  async function push(code, doc) {
    const res = await fetch(`${BASE}/${encodeURIComponent(code)}/${KEY}`, {
      method: "PUT",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(doc),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return true;
  }

  // Vérifie qu'un code existe / est joignable (pour "Rejoindre").
  async function check(code) {
    const res = await fetch(`${BASE}/${encodeURIComponent(code)}/${KEY}`, {
      cache: "no-store",
    });
    return res.ok || res.status === 404; // 404 = espace valide mais encore vide
  }

  window.Sync = { createSpace, pull, push, check, provider: "kvdb.io" };
})();
