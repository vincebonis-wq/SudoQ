/* =========================================================================
 * SudoQ — Temps réel via streaming Firebase (Server-Sent Events).
 *
 * Firebase Realtime Database sait « pousser » les changements en direct sur
 * une simple requête GET .json quand le client demande text/event-stream —
 * ce que fait automatiquement EventSource. On reçoit alors des évènements
 * `put` / `patch` dès que la donnée change, sans interroger en boucle.
 *
 * Cette brique est PUREMENT ADDITIVE : chaque jeu garde son polling comme
 * filet de sécurité. Le stream sert de notification « ça a changé, va
 * chercher » — on ne reconstruit pas l'état à partir des deltas, on relit via
 * le chemin déjà éprouvé du jeu. Si EventSource est absent, bloqué (CORS,
 * proxy, réseau) ou muet, on retombe simplement sur le polling habituel.
 *
 *   const sub = Realtime.subscribe(url, {
 *     onOpen,                    // connexion établie
 *     onChange(payload),         // {path, data} d'un put/patch (payload peut être null)
 *     onError(err),              // stream fermé / annulé : repli conseillé
 *   });
 *   sub.close();
 * ========================================================================= */
(function () {
  "use strict";

  function subscribe(url, cb) {
    cb = cb || {};
    if (typeof EventSource === "undefined") {
      if (cb.onError) cb.onError(new Error("no-eventsource"));
      return { close: function () {} };
    }
    var es, closed = false;
    try {
      es = new EventSource(url);
    } catch (e) {
      if (cb.onError) cb.onError(e);
      return { close: function () {} };
    }
    function change(ev) {
      if (closed) return;
      var payload = null;
      try { payload = JSON.parse(ev.data); } catch (e) {}
      if (cb.onChange) cb.onChange(payload);
    }
    es.addEventListener("put", change);
    es.addEventListener("patch", change);
    es.addEventListener("keep-alive", function () {}); // heartbeat : rien à faire
    es.addEventListener("cancel", function () { if (cb.onError) cb.onError(new Error("cancel")); });
    es.addEventListener("auth_revoked", function () { if (cb.onError) cb.onError(new Error("auth_revoked")); });
    es.onopen = function () { if (!closed && cb.onOpen) cb.onOpen(); };
    es.onerror = function () {
      // EventSource se reconnecte seul tant qu'il n'est pas CLOSED (2).
      if (es.readyState === 2 && cb.onError) cb.onError(new Error("closed"));
    };
    return {
      close: function () { closed = true; try { es.close(); } catch (e) {} },
    };
  }

  window.Realtime = { subscribe: subscribe };
})();
