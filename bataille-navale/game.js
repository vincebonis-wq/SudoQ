/* =========================================================================
 * Bataille navale — jeu à deux, temps réel via Firebase (même espace de couple)
 * Données : /spaces/<code>/navale
 * ========================================================================= */
(function () {
  "use strict";

  const DB = "https://sudoq-b7925-default-rtdb.europe-west1.firebasedatabase.app";
  const APP_VERSION = "v1";
  const FLEET = [
    { name: "Porte-avions", size: 5 },
    { name: "Croiseur", size: 4 },
    { name: "Contre-torpilleur", size: 3 },
    { name: "Sous-marin", size: 3 },
    { name: "Torpilleur", size: 2 },
  ];
  const FLEET_CELLS = FLEET.reduce((n, s) => n + s.size, 0); // 17

  const $ = (s) => document.querySelector(s);

  /* ---------- Espace de couple partagé (écrit par SudoQ) ---------- */
  function getCouple() {
    try { return JSON.parse(localStorage.getItem("couple") || "{}"); } catch (e) { return {}; }
  }
  let couple = getCouple();
  let me = localStorage.getItem("navale.me");
  me = me === null ? null : parseInt(me, 10);

  /* ---------- Accès Firebase (surchargeable pour les tests) ---------- */
  function base() {
    return `${DB}/spaces/${encodeURIComponent(couple.code)}/navale`;
  }
  async function fbFetch(url, opts, tries) {
    tries = tries || 3;
    let lastErr;
    for (let i = 0; i < tries; i++) {
      try {
        const res = await fetch(url, opts);
        if (res.ok) return res;
        if (res.status !== 429 && res.status < 500) return res;
        lastErr = new Error("HTTP " + res.status);
      } catch (e) { lastErr = e; }
      await new Promise((r) => setTimeout(r, 350 * (i + 1)));
    }
    throw lastErr || new Error("réseau");
  }
  window.__FB = {
    async get(path) {
      const res = await fbFetch(`${base()}${path}.json?_=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const t = await res.text();
      return !t || t === "null" ? null : JSON.parse(t);
    },
    async put(path, data) {
      const res = await fbFetch(`${base()}${path}.json`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
    },
    async patch(path, data) {
      const res = await fbFetch(`${base()}${path}.json`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
    },
  };
  const store = () => window.__FB;

  /* ---------- État ---------- */
  let navale = null; // état distant
  let localSetup = { ships: [], orientation: "h", active: 0 }; // placement en cours
  let endShownForRound = -1;

  /* ---------- Utils ---------- */
  const key = (r, c) => r + "," + c;
  function normScores(s) {
    const out = { 0: 0, 1: 0 };
    if (Array.isArray(s)) { out[0] = s[0] || 0; out[1] = s[1] || 0; }
    else if (s && typeof s === "object") { out[0] = s[0] || 0; out[1] = s[1] || 0; }
    return out;
  }
  function shipsOf(playerIdx) {
    const b = navale && navale.boards && navale.boards[playerIdx];
    return (b && b.ships) || [];
  }
  function shotsOf(playerIdx) {
    return (navale && navale.shots && navale.shots[playerIdx]) || {};
  }
  function names() {
    const p = couple.players && couple.players.length === 2 ? couple.players : ["Joueur 1", "Joueur 2"];
    return p;
  }
  const oppName = () => names()[1 - me];

  let toastTimer = null;
  function toast(msg, ms) {
    const el = $("#toast"); el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.hidden = true), ms || 2400);
  }

  /* ---------- Placement ---------- */
  function cellsFor(r, c, size, orient) {
    const cells = [];
    for (let i = 0; i < size; i++) {
      const rr = orient === "v" ? r + i : r;
      const cc = orient === "h" ? c + i : c;
      if (rr > 9 || cc > 9) return null;
      cells.push(key(rr, cc));
    }
    return cells;
  }
  function occupied() {
    const set = new Set();
    localSetup.ships.forEach((s) => s.cells.forEach((k) => set.add(k)));
    return set;
  }
  function canPlace(cells) {
    if (!cells) return false;
    const occ = occupied();
    return cells.every((k) => !occ.has(k));
  }
  function placeActive(r, c) {
    const ship = FLEET[localSetup.active];
    if (!ship) return;
    const cells = cellsFor(r, c, ship.size, localSetup.orientation);
    if (!canPlace(cells)) { toast("Placement impossible ici"); return; }
    localSetup.ships[localSetup.active] = { name: ship.name, cells: cells };
    // sélectionne le prochain navire non placé
    const next = FLEET.findIndex((s, i) => !localSetup.ships[i]);
    localSetup.active = next === -1 ? localSetup.active : next;
    persistSetup(); render();
  }
  function removeAt(r, c) {
    const k = key(r, c);
    const idx = localSetup.ships.findIndex((s) => s && s.cells.indexOf(k) !== -1);
    if (idx === -1) return false;
    localSetup.ships[idx] = undefined;
    localSetup.active = idx;
    persistSetup(); render();
    return true;
  }
  function randomPlace() {
    localSetup.ships = [];
    for (let i = 0; i < FLEET.length; i++) {
      let ok = false, tries = 0;
      while (!ok && tries < 500) {
        tries++;
        const orient = Math.random() < 0.5 ? "h" : "v";
        const r = Math.floor(Math.random() * 10), c = Math.floor(Math.random() * 10);
        const cells = cellsFor(r, c, FLEET[i].size, orient);
        if (canPlace(cells)) { localSetup.ships[i] = { name: FLEET[i].name, cells }; ok = true; }
      }
    }
    localSetup.active = FLEET.length; // tout placé
    persistSetup(); render();
  }
  function clearSetup() { localSetup.ships = []; localSetup.active = 0; persistSetup(); render(); }
  function allPlaced() { return localSetup.ships.filter(Boolean).length === FLEET.length; }

  function persistSetup() {
    try {
      localStorage.setItem("navale.setup", JSON.stringify({
        code: couple.code, me: me, round: (navale && navale.round) || 1, ships: localSetup.ships,
      }));
    } catch (e) {}
  }
  function restoreSetup() {
    try {
      const s = JSON.parse(localStorage.getItem("navale.setup") || "null");
      if (s && s.code === couple.code && s.me === me && s.round === ((navale && navale.round) || 1)) {
        localSetup.ships = (s.ships || []).filter(Boolean);
        localSetup.active = FLEET.findIndex((x, i) => !localSetup.ships[i]);
        if (localSetup.active === -1) localSetup.active = FLEET.length;
      }
    } catch (e) {}
  }

  /* ---------- Rendu ---------- */
  function show(id) {
    ["gate", "who", "game"].forEach((s) => { $("#" + s).hidden = s !== id; });
  }
  function phaseTitle(t) { $("#phase-title").textContent = t; }
  function turnPill(t, cls) {
    const el = $("#turn-pill"); el.textContent = t; el.className = "turn-pill " + (cls || "wait");
  }

  function renderWho() {
    const wrap = $("#who-btns"); wrap.innerHTML = "";
    names().forEach((n, i) => {
      const b = document.createElement("button");
      b.className = "btn btn-primary"; b.textContent = n;
      b.onclick = () => { me = i; localStorage.setItem("navale.me", String(i)); restoreSetup(); render(); pull(); };
      wrap.appendChild(b);
    });
  }

  function renderSerie() {
    const sc = normScores(navale && navale.scores);
    const el = $("#serie"); const nm = names();
    const lead = sc[0] === sc[1] ? -1 : sc[0] > sc[1] ? 0 : 1;
    el.innerHTML =
      `<div><div class="s-name">${escapeHtml(nm[0])}</div><div class="s-score ${lead === 0 ? "lead" : ""}">${sc[0]}</div></div>` +
      `<div class="s-mid">–</div>` +
      `<div><div class="s-name">${escapeHtml(nm[1])}</div><div class="s-score ${lead === 1 ? "lead" : ""}">${sc[1]}</div></div>`;
  }

  function renderFleet() {
    const wrap = $("#fleet"); wrap.innerHTML = "";
    FLEET.forEach((s, i) => {
      const placed = !!localSetup.ships[i];
      const chip = document.createElement("button");
      chip.className = "ship-chip" + (placed ? " placed" : "") + (i === localSetup.active ? " active" : "");
      chip.innerHTML = `${s.name} <span class="dots">${"▪".repeat(s.size)}</span>`;
      chip.onclick = () => { localSetup.active = i; render(); };
      wrap.appendChild(chip);
    });
    $("#setup-hint").textContent = allPlaced() ? "Flotte complète ✓" : `${localSetup.ships.filter(Boolean).length}/${FLEET.length} placés`;
    $("#btn-ready").disabled = !allPlaced();
    $("#btn-rotate").textContent = "↻ Orientation : " + (localSetup.orientation === "h" ? "horizontale" : "verticale");
  }

  function makeBoard(el, handler) {
    el.innerHTML = "";
    for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) {
      const cell = document.createElement("div");
      cell.className = "cell"; cell.dataset.r = r; cell.dataset.c = c;
      if (handler) cell.onclick = () => handler(r, c);
      el.appendChild(cell);
    }
  }
  function cellAt(el, r, c) { return el.children[r * 10 + c]; }

  function renderSetupBoard() {
    const el = $("#setup-board");
    makeBoard(el, (r, c) => { if (!removeAt(r, c)) placeActive(r, c); });
    const occ = occupied();
    for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) {
      if (occ.has(key(r, c))) cellAt(el, r, c).classList.add("ship");
    }
  }

  function sunkSet(defenderShips, attackerShots) {
    const set = new Set();
    defenderShips.forEach((sh) => {
      const cells = sh || [];
      if (cells.length && cells.every((k) => attackerShots[k] === "hit")) cells.forEach((k) => set.add(k));
    });
    return set;
  }

  function renderBattle(myTurn) {
    // Grille adverse : mes tirs
    const enemy = $("#enemy-board");
    makeBoard(enemy, (r, c) => fire(r, c));
    enemy.classList.toggle("disabled", !myTurn || navale.status !== "playing");
    const myShots = shotsOf(me);
    const oppShips = shipsOf(1 - me);
    const oppSunk = sunkSet(oppShips, myShots);
    let myHits = 0;
    for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) {
      const k = key(r, c), res = myShots[k], cell = cellAt(enemy, r, c);
      if (oppSunk.has(k)) cell.classList.add("sunk");
      else if (res === "hit") { cell.classList.add("hit"); }
      else if (res === "miss") cell.classList.add("miss");
      if (res === "hit") myHits++;
    }
    $("#enemy-left").textContent = `${Math.max(FLEET_CELLS - myHits, 0)} cases à couler`;

    // Ma grille : mes navires + tirs adverses
    const mine = $("#my-board"); makeBoard(mine, null);
    const myShips = shipsOf(me);
    const myOcc = new Set(); myShips.forEach((sh) => (sh || []).forEach((k) => myOcc.add(k)));
    const oppShots = shotsOf(1 - me);
    const mySunk = sunkSet(myShips, oppShots);
    let oppHits = 0;
    for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) {
      const k = key(r, c), cell = cellAt(mine, r, c);
      if (myOcc.has(k)) cell.classList.add("ship");
      if (mySunk.has(k)) cell.classList.add("sunk");
      else if (oppShots[k] === "hit") cell.classList.add("hit");
      else if (oppShots[k] === "miss") cell.classList.add("miss");
      if (oppShots[k] === "hit") oppHits++;
    }
    $("#my-left").textContent = `${Math.max(FLEET_CELLS - oppHits, 0)} cases restantes`;
  }

  function render() {
    couple = getCouple();
    if (!couple.code) { show("gate"); return; }
    if (me === null) { show("who"); renderWho(); return; }
    show("game");
    renderSerie();
    const st = (navale && navale.status) || "setup";
    const myReady = !!(navale && navale.boards && navale.boards[me] && navale.boards[me].ready);

    if (st === "setup") {
      if (myReady) {
        $("#setup").hidden = true; $("#battle").hidden = true;
        phaseTitle("En attente…"); turnPill(oppName() + " place sa flotte 🚢", "wait");
      } else {
        $("#setup").hidden = false; $("#battle").hidden = true;
        phaseTitle("Place ta flotte"); turnPill("Positionne tes 5 navires", "wait");
        renderFleet(); renderSetupBoard();
      }
    } else if (st === "playing") {
      $("#setup").hidden = true; $("#battle").hidden = false;
      phaseTitle("En bataille !");
      const myTurn = navale.turn === me;
      turnPill(myTurn ? "À toi de tirer 🎯" : "Au tour de " + oppName() + "…", myTurn ? "you" : "wait");
      renderBattle(myTurn);
    } else if (st === "finished") {
      $("#setup").hidden = true; $("#battle").hidden = false;
      renderBattle(false);
      maybeShowEnd();
    }
  }

  /* ---------- Actions réseau ---------- */
  async function ready() {
    if (!allPlaced()) return;
    const board = { ships: localSetup.ships.map((s) => s.cells), ready: true };
    if (!navale) navale = { status: "setup", turn: 0, winner: null, round: 1, scores: { 0: 0, 1: 0 }, boards: {}, shots: {} };
    navale.boards = navale.boards || {}; navale.boards[me] = board;
    render();
    try {
      await store().patch("", { status: navale.status || "setup", turn: navale.turn || 0, round: navale.round || 1 });
      await store().put("/boards/" + me, board);
      await pull();
      toast("Flotte prête ✓");
    } catch (e) { toast("Connexion en cours…"); }
  }

  async function fire(r, c) {
    if (!navale || navale.status !== "playing" || navale.turn !== me) return;
    const k = key(r, c);
    const shots = Object.assign({}, shotsOf(me));
    if (shots[k]) return;
    const oppShips = shipsOf(1 - me);
    const hit = oppShips.some((sh) => (sh || []).indexOf(k) !== -1);
    shots[k] = hit ? "hit" : "miss";
    navale.shots = navale.shots || {}; navale.shots[me] = shots;

    const totalCells = oppShips.reduce((n, sh) => n + (sh ? sh.length : 0), 0);
    const hits = Object.keys(shots).filter((x) => shots[x] === "hit").length;
    const meta = {};
    if (hit && totalCells > 0 && hits >= totalCells) {
      const sc = normScores(navale.scores); sc[me] = (sc[me] || 0) + 1;
      navale.status = "finished"; navale.winner = me; navale.scores = sc;
      meta.status = "finished"; meta.winner = me; meta.scores = sc;
      toast("💥 Coulé ! Tu as gagné !");
    } else if (hit) {
      toast("💥 Touché ! Rejoue.");
    } else {
      navale.turn = 1 - me; meta.turn = 1 - me;
      toast("💧 Manqué.");
    }
    render();
    try {
      await store().put("/shots/" + me, shots);
      if (Object.keys(meta).length) await store().patch("", meta);
      pull();
    } catch (e) { toast("Coup non transmis — nouvel essai à la synchro."); }
  }

  async function rematch() {
    // Réinitialise la partie, garde la série de scores.
    const round = ((navale && navale.round) || 1) + 1;
    const scores = normScores(navale && navale.scores);
    navale = { status: "setup", turn: 0, winner: null, round: round, scores: scores, boards: {}, shots: {} };
    localSetup = { ships: [], orientation: localSetup.orientation, active: 0 };
    persistSetup();
    $("#end-modal").hidden = true; endShownForRound = -1;
    render();
    try {
      await store().patch("", { status: "setup", turn: 0, winner: null, round: round, scores: scores, boards: null, shots: null });
      pull();
    } catch (e) { toast("Connexion…"); }
  }

  function maybeShowEnd() {
    if (endShownForRound === (navale.round || 1)) return;
    endShownForRound = navale.round || 1;
    const iWon = navale.winner === me;
    $("#end-emoji").textContent = iWon ? "🏆" : "🌊";
    $("#end-title").textContent = iWon ? "Victoire !" : "Défaite…";
    const sc = normScores(navale.scores);
    $("#end-sub").innerHTML = (iWon ? "Tu as coulé toute la flotte de " + escapeHtml(oppName()) + " !" : escapeHtml(names()[navale.winner]) + " a gagné cette manche.") +
      `<br><strong>Série : ${escapeHtml(names()[0])} ${sc[0]} – ${sc[1]} ${escapeHtml(names()[1])}</strong>`;
    if (iWon) launchConfetti();
    $("#end-modal").hidden = false;
  }
  function launchConfetti() {
    const box = $("#confetti"); box.innerHTML = "";
    const colors = ["#7c3aed", "#ec4899", "#fbbf24", "#34d399", "#60a5fa"];
    for (let i = 0; i < 36; i++) {
      const c = document.createElement("i");
      c.style.left = Math.random() * 100 + "%";
      c.style.background = colors[Math.floor(Math.random() * colors.length)];
      c.style.animationDuration = 1.4 + Math.random() * 1.4 + "s";
      c.style.animationDelay = Math.random() * 0.3 + "s";
      box.appendChild(c);
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /* ---------- Synchro ---------- */
  let lastErr = false;
  function setDot(s) { $("#sync-dot").className = "sync-dot " + s; }
  async function pull() {
    if (!couple.code || me === null) { render(); return; }
    setDot("syncing");
    try {
      const rem = await store().get("");
      navale = rem;
      // Démarrage automatique quand les deux flottes sont prêtes.
      if (navale && navale.status === "setup" && navale.boards &&
          navale.boards[0] && navale.boards[0].ready && navale.boards[1] && navale.boards[1].ready) {
        navale.status = "playing"; navale.turn = navale.turn || 0;
        await store().patch("", { status: "playing", turn: navale.turn });
      }
      setDot("ok"); lastErr = false;
      render();
    } catch (e) {
      setDot("error");
      if (!lastErr) { toast("Synchro indisponible — réessai…"); lastErr = true; }
    }
  }

  let pollId = null;
  function startPolling() {
    stopPolling();
    pollId = setInterval(() => { if (document.visibilityState === "visible") pull(); }, 2500);
  }
  function stopPolling() { if (pollId) clearInterval(pollId); pollId = null; }

  /* ---------- Thème ---------- */
  function initTheme() {
    let theme = localStorage.getItem("navale.theme");
    if (!theme) {
      try { theme = (JSON.parse(localStorage.getItem("sudoq.v1") || "{}").theme) || "dark"; } catch (e) { theme = "dark"; }
    }
    applyTheme(theme);
  }
  function applyTheme(theme) {
    document.body.classList.toggle("light", theme === "light");
    $("#btn-theme").textContent = theme === "light" ? "☀️" : "🌙";
    $('meta[name="theme-color"]').setAttribute("content", theme === "light" ? "#eef1f8" : "#0f172a");
    localStorage.setItem("navale.theme", theme);
  }

  /* ---------- Init ---------- */
  function init() {
    initTheme();
    $("#app-version").textContent = "Bataille navale " + APP_VERSION + " · synchro Firebase";
    $("#btn-theme").onclick = () => applyTheme(document.body.classList.contains("light") ? "dark" : "light");
    $("#btn-sync").onclick = () => { toast(couple.code ? "Espace : " + couple.code.slice(0, 8) + "…" : "Aucun espace de couple"); pull(); };
    $("#btn-rotate").onclick = () => { localSetup.orientation = localSetup.orientation === "h" ? "v" : "h"; render(); };
    $("#btn-random").onclick = randomPlace;
    $("#btn-clear").onclick = clearSetup;
    $("#btn-ready").onclick = ready;
    $("#btn-rematch").onclick = rematch;

    restoreSetup();
    render();
    if (couple.code && me !== null) { pull(); startPolling(); }
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") pull(); });
  }

  // Expose quelques fonctions pures pour les tests.
  window.__navale = { cellsFor, canPlaceRef: () => localSetup, FLEET, FLEET_CELLS };

  init();
})();
