/* =========================================================================
 * Bataille navale — jeu à deux, temps réel via Firebase (espace de couple)
 * Règles : écart d'au moins 1 case entre les navires (diagonales comprises).
 * Placement par glisser-déposer avec prévisualisation. Animations.
 * Données : /spaces/<code>/navale
 * ========================================================================= */
(function () {
  "use strict";

  const DB = "https://sudoq-b7925-default-rtdb.europe-west1.firebasedatabase.app";
  const APP_VERSION = "v8";
  const FLEET = [
    { name: "Porte-avions", size: 5 },
    { name: "Croiseur", size: 4 },
    { name: "Contre-torpilleur", size: 3 },
    { name: "Sous-marin", size: 3 },
    { name: "Torpilleur", size: 2 },
  ];
  const FLEET_CELLS = FLEET.reduce((n, s) => n + s.size, 0); // 17
  const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];

  const $ = (s) => document.querySelector(s);

  /* ---------- Espace de couple partagé ---------- */
  function getCouple() { try { return JSON.parse(localStorage.getItem("couple") || "{}"); } catch (e) { return {}; } }
  let couple = getCouple();
  let me = localStorage.getItem("navale.me");
  me = me === null ? null : parseInt(me, 10);

  /* ---------- Firebase (surchargeable pour tests) ---------- */
  function base() { return `${DB}/spaces/${encodeURIComponent(couple.code)}/navale`; }
  async function fbFetch(url, opts, tries) {
    tries = tries || 3; let lastErr;
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
      const t = await res.text(); return !t || t === "null" ? null : JSON.parse(t);
    },
    async put(path, data) {
      const res = await fbFetch(`${base()}${path}.json`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      if (!res.ok) throw new Error("HTTP " + res.status);
    },
    async patch(path, data) {
      const res = await fbFetch(`${base()}${path}.json`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      if (!res.ok) throw new Error("HTTP " + res.status);
    },
  };
  const store = () => window.__FB;

  /* ---------- État ---------- */
  let navale = null;
  let localSetup = { ships: [], orientation: "h", active: 0 };
  let drag = null; // { shipIndex, orientation, anchor:{r,c}, cells:[], valid:bool }
  let endShownForRound = -1;
  let seenEnemy = new Set(), seenMine = new Set(), seenRound = -1;
  // Cadrage automatique de l'écran actif (mon tir / ma flotte) + attaque entrante
  let curFocus = null;      // "enemy" (je tire) | "mine" (je regarde ma flotte) | null
  let watching = false;     // je regarde une attaque adverse en cours
  let attackTimer = null;   // fin de la séquence "sous attaque"
  let holdUntil = 0;        // gèle le cadrage un instant (ex. après mon propre tir)
  // Mode entraînement hors-ligne contre l'ordinateur (rien n'est enregistré)
  let solo = false;
  let botState = { tried: new Set(), queue: [] };
  let botTimer = null;

  /* ---------- Utils ---------- */
  const key = (r, c) => r + "," + c;
  const parse = (k) => k.split(",").map(Number);
  function normScores(s) { const o = { 0: 0, 1: 0 }; if (s) { o[0] = s[0] || 0; o[1] = s[1] || 0; } return o; }
  function shipsOf(p) { const b = navale && navale.boards && navale.boards[p]; return (b && b.ships) || []; }
  function shotsOf(p) { return (navale && navale.shots && navale.shots[p]) || {}; }
  function names() {
    if (solo) { const mine = (couple.players && couple.players[0]) || "Toi"; return [mine, "Ordi 🤖"]; }
    const p = couple.players && couple.players.length === 2 ? couple.players : ["Joueur 1", "Joueur 2"]; return p;
  }
  const oppName = () => names()[1 - me];
  function shipName(size) { return size === 5 ? "Porte-avions" : size === 4 ? "Croiseur" : size === 2 ? "Torpilleur" : "navire"; }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function vibrate(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {} }

  /* ---------- Sons (WebAudio) ---------- */
  let actx = null;
  function audio() { if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } if (actx && actx.state === "suspended") actx.resume(); return actx; }
  function tone(freq, dur, type, vol, slideTo) {
    const a = audio(); if (!a) return;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type || "sine"; o.frequency.value = freq; g.gain.value = vol || 0.09;
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, a.currentTime + (dur || 0.15));
    o.connect(g); g.connect(a.destination); o.start();
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + (dur || 0.15));
    o.stop(a.currentTime + (dur || 0.15));
  }
  function noise(dur, vol) {
    const a = audio(); if (!a) return;
    const n = a.sampleRate * (dur || 0.3), buf = a.createBuffer(1, n, a.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = a.createBufferSource(); src.buffer = buf;
    const g = a.createGain(); g.gain.value = vol || 0.15; g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + (dur || 0.3));
    src.connect(g); g.connect(a.destination); src.start();
  }
  const sndFire = () => tone(420, 0.14, "square", 0.06, 120);
  const sndMiss = () => { tone(300, 0.18, "sine", 0.07, 130); setTimeout(() => noise(0.2, 0.06), 60); };
  const sndHit = () => { noise(0.35, 0.2); tone(90, 0.35, "sawtooth", 0.12); };
  const sndSink = () => { noise(0.5, 0.22); [200, 150, 100].forEach((f, i) => setTimeout(() => tone(f, 0.25, "sawtooth", 0.12), i * 120)); };
  const sndWin = () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.18, "triangle", 0.1), i * 120));
  const sndSonar = () => { tone(880, 0.16, "sine", 0.05, 1320); setTimeout(() => tone(660, 0.22, "sine", 0.04, 990), 90); };

  let toastTimer = null;
  function toast(msg, ms) { const el = $("#toast"); el.textContent = msg; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.hidden = true), ms || 2200); }

  /* ---------- Géométrie & règle d'écart ---------- */
  function cellsFor(r, c, size, orient) {
    const cells = [];
    for (let i = 0; i < size; i++) {
      const rr = orient === "v" ? r + i : r, cc = orient === "h" ? c + i : c;
      if (rr > 9 || cc > 9 || rr < 0 || cc < 0) return null;
      cells.push(key(rr, cc));
    }
    return cells;
  }
  function occupiedHalo(excludeIdx) {
    // toutes les cases occupées + leur halo (8 voisins) = zone interdite
    const halo = new Set();
    localSetup.ships.forEach((s, i) => {
      if (!s || i === excludeIdx) return;
      s.cells.forEach((k) => {
        const [r, c] = parse(k);
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr, cc = c + dc;
          if (rr >= 0 && rr < 10 && cc >= 0 && cc < 10) halo.add(key(rr, cc));
        }
      });
    });
    return halo;
  }
  function canPlace(cells, excludeIdx) {
    if (!cells) return false;
    const halo = occupiedHalo(excludeIdx);
    return cells.every((k) => !halo.has(k));
  }
  function shipOrient(cells) { return cells.length > 1 && parse(cells[0])[0] === parse(cells[1])[0] ? "h" : "v"; }
  function allPlaced() { return localSetup.ships.filter(Boolean).length === FLEET.length; }

  function randomPlace() {
    for (let attempt = 0; attempt < 40; attempt++) {
      localSetup.ships = [];
      let ok = true;
      for (let i = 0; i < FLEET.length; i++) {
        let placed = false;
        for (let t = 0; t < 400 && !placed; t++) {
          const orient = Math.random() < 0.5 ? "h" : "v";
          const r = Math.floor(Math.random() * 10), c = Math.floor(Math.random() * 10);
          const cells = cellsFor(r, c, FLEET[i].size, orient);
          if (cells && canPlace(cells, i)) { localSetup.ships[i] = { name: FLEET[i].name, cells }; placed = true; }
        }
        if (!placed) { ok = false; break; }
      }
      if (ok) break;
    }
    localSetup.active = FLEET.length;
    persistSetup(); paintSetup(true); renderFleet();
  }
  function clearSetup() { localSetup.ships = []; localSetup.active = 0; persistSetup(); paintSetup(); renderFleet(); }

  function persistSetup() {
    if (solo) return; // l'entraînement est éphémère : ne pas polluer le cache réel
    try { localStorage.setItem("navale.setup", JSON.stringify({ code: couple.code, me, round: (navale && navale.round) || 1, ships: localSetup.ships })); } catch (e) {}
  }
  function restoreSetup() {
    try {
      const s = JSON.parse(localStorage.getItem("navale.setup") || "null");
      if (s && s.code === couple.code && s.me === me && s.round === ((navale && navale.round) || 1)) {
        localSetup.ships = []; (s.ships || []).forEach((sh, i) => { if (sh) localSetup.ships[i] = sh; });
        localSetup.active = FLEET.findIndex((x, i) => !localSetup.ships[i]);
        if (localSetup.active === -1) localSetup.active = FLEET.length;
      }
    } catch (e) {}
  }

  /* ---------- Rendu commun ---------- */
  function show(id) { ["gate", "who", "game"].forEach((s) => { $("#" + s).hidden = s !== id; }); }
  function phaseTitle(t) { $("#phase-title").textContent = t; }
  function turnPill(t, cls) { const el = $("#turn-pill"); el.textContent = t; el.className = "turn-pill " + (cls || "wait"); }
  function fillLabels(colsId, rowsId) {
    const cols = $("#" + colsId), rows = $("#" + rowsId);
    if (cols && !cols.children.length) LETTERS.forEach((l) => { const s = document.createElement("span"); s.textContent = l; cols.appendChild(s); });
    if (rows && !rows.children.length) for (let i = 1; i <= 10; i++) { const s = document.createElement("span"); s.textContent = i; rows.appendChild(s); }
  }
  function hullClassesFor(cells) {
    // renvoie un map key->classes pour dessiner la coque continue
    const orient = shipOrient(cells), map = {};
    cells.forEach((k, i) => {
      const cls = ["hull", orient];
      if (i === 0) cls.push(orient + "-start");
      if (i === cells.length - 1) cls.push(orient + "-end");
      map[k] = cls;
    });
    return map;
  }

  function renderWho() {
    const wrap = $("#who-btns"); wrap.innerHTML = "";
    const emojis = ["🧑‍✈️", "👩‍✈️"];
    names().forEach((n, i) => {
      const b = document.createElement("button");
      b.className = "btn btn-primary"; b.innerHTML = `<div class="who-avatar">${emojis[i]}</div>${escapeHtml(n)}`;
      b.onclick = () => { me = i; localStorage.setItem("navale.me", String(i)); restoreSetup(); render(); pull(); startPolling(); startStream(); };
      wrap.appendChild(b);
    });
  }

  function renderSerie() {
    const sc = normScores(navale && navale.scores), nm = names();
    const lead = sc[0] === sc[1] ? -1 : sc[0] > sc[1] ? 0 : 1;
    $("#serie").innerHTML =
      `<div class="col"><div class="s-name">${escapeHtml(nm[0])}</div><div class="s-score ${lead === 0 ? "lead" : ""}">${sc[0]}</div><div class="crown">${lead === 0 ? "👑" : ""}</div></div>` +
      `<div class="s-mid">–</div>` +
      `<div class="col"><div class="s-name">${escapeHtml(nm[1])}</div><div class="s-score ${lead === 1 ? "lead" : ""}">${sc[1]}</div><div class="crown">${lead === 1 ? "👑" : ""}</div></div>`;
  }

  /* ---------- Placement (glisser-déposer + preview) ---------- */
  function renderFleet() {
    const wrap = $("#fleet"); wrap.innerHTML = "";
    FLEET.forEach((s, i) => {
      const placed = !!localSetup.ships[i];
      const chip = document.createElement("button");
      chip.className = "ship-chip" + (placed ? " placed" : "") + (i === localSetup.active ? " active" : "");
      chip.innerHTML = `<span>${s.name}</span><span class="mini">${"<i></i>".repeat(s.size)}</span>`;
      chip.onclick = () => { localSetup.active = i; renderFleet(); };
      wrap.appendChild(chip);
    });
    $("#setup-hint").innerHTML = allPlaced()
      ? "Flotte complète ✓ — <b>glisse un navire</b> pour l'ajuster."
      : `<b>Glisse</b> tes navires sur la grille (1 case d'écart mini). ${localSetup.ships.filter(Boolean).length}/${FLEET.length} placés`;
    $("#btn-ready").disabled = !allPlaced();
    $("#btn-rotate").textContent = "↻ Pivoter (" + (localSetup.orientation === "h" ? "H" : "V") + ")";
  }

  let setupBoardEl = null;
  function ensureSetupBoard() {
    fillLabels("setup-cols", "setup-rows");
    const el = $("#setup-board"); setupBoardEl = el;
    if (el.children.length) return;
    for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) {
      const cell = document.createElement("div"); cell.className = "cell"; cell.dataset.r = r; cell.dataset.c = c; el.appendChild(cell);
    }
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }
  function setupCell(r, c) { return setupBoardEl.children[r * 10 + c]; }
  function paintSetup(popAll) {
    if (!setupBoardEl) return;
    for (let i = 0; i < 100; i++) setupBoardEl.children[i].className = "cell";
    localSetup.ships.forEach((s) => {
      if (!s) return;
      const map = hullClassesFor(s.cells);
      s.cells.forEach((k) => { const [r, c] = parse(k); const cell = setupCell(r, c); cell.className = "cell " + map[k].join(" ") + (popAll ? " pop" : ""); });
    });
  }
  function shipIndexAt(r, c) {
    return localSetup.ships.findIndex((s) => s && s.cells.indexOf(key(r, c)) !== -1);
  }
  function cellFromPoint(x, y) {
    const el = document.elementFromPoint(x, y); if (!el) return null;
    const c = el.closest(".cell"); if (!c || c.parentElement !== setupBoardEl) return null;
    return { r: +c.dataset.r, c: +c.dataset.c };
  }
  function onDown(e) {
    const cel = e.target.closest(".cell"); if (!cel) return;
    e.preventDefault();
    const r = +cel.dataset.r, c = +cel.dataset.c;
    const idxHere = shipIndexAt(r, c);
    if (idxHere !== -1) {
      // ramasser un navire déjà posé
      const ship = localSetup.ships[idxHere];
      drag = { shipIndex: idxHere, orientation: shipOrient(ship.cells), anchor: { r, c } };
      localSetup.ships[idxHere] = undefined;
    } else {
      let idx = localSetup.active;
      if (idx >= FLEET.length || localSetup.ships[idx]) idx = FLEET.findIndex((s, i) => !localSetup.ships[i]);
      if (idx === -1) return;
      drag = { shipIndex: idx, orientation: localSetup.orientation, anchor: { r, c } };
    }
    localSetup.active = drag.shipIndex;
    paintSetup(); renderFleet(); previewAt(r, c);
    try { setupBoardEl.setPointerCapture(e.pointerId); } catch (x) {}
  }
  function onMove(e) {
    if (!drag) return;
    const p = cellFromPoint(e.clientX, e.clientY); if (!p) return;
    if (p.r !== drag.anchor.r || p.c !== drag.anchor.c) { drag.anchor = { r: p.r, c: p.c }; previewAt(p.r, p.c); }
  }
  function onUp() {
    if (!drag) return;
    const { r, c } = drag.anchor;
    const size = FLEET[drag.shipIndex].size;
    const cells = cellsFor(r, c, size, drag.orientation);
    if (cells && canPlace(cells, drag.shipIndex)) {
      localSetup.ships[drag.shipIndex] = { name: FLEET[drag.shipIndex].name, cells };
      const next = FLEET.findIndex((s, i) => !localSetup.ships[i]);
      localSetup.active = next === -1 ? drag.shipIndex : next;
      drag = null; persistSetup(); paintSetup();
      // animation pop sur le navire posé
      cells.forEach((k) => { const [rr, cc] = parse(k); setupCell(rr, cc).classList.add("pop"); });
      renderFleet();
    } else {
      drag = null; paintSetup(); renderFleet();
      toast("Trop près d'un autre navire ✋");
    }
  }
  function previewAt(r, c) {
    paintSetup();
    const size = FLEET[drag.shipIndex].size;
    const cells = cellsFor(r, c, size, drag.orientation);
    const ok = canPlace(cells, drag.shipIndex);
    if (!cells) return;
    cells.forEach((k) => { const [rr, cc] = parse(k); const cell = setupCell(rr, cc); cell.classList.remove("hull", "h", "v", "h-start", "h-end", "v-start", "v-end"); cell.classList.add(ok ? "prev-ok" : "prev-bad"); });
  }
  function rotate() {
    localSetup.orientation = localSetup.orientation === "h" ? "v" : "h";
    if (drag) { drag.orientation = localSetup.orientation; previewAt(drag.anchor.r, drag.anchor.c); }
    renderFleet();
  }

  /* ---------- Combat ---------- */
  function makeBoard(el, colsId, rowsId, handler) {
    fillLabels(colsId, rowsId);
    el.innerHTML = "";
    for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) {
      const cell = document.createElement("div"); cell.className = "cell"; cell.dataset.r = r; cell.dataset.c = c;
      if (handler) cell.onclick = () => handler(r, c);
      el.appendChild(cell);
    }
  }
  const at = (el, r, c) => el.children[r * 10 + c];
  function sunkSet(defShips, atkShots) {
    const set = new Set();
    defShips.forEach((sh) => { const cs = sh || []; if (cs.length && cs.every((k) => atkShots[k] === "hit")) cs.forEach((k) => set.add(k)); });
    return set;
  }
  function resetSeenIfNewRound() {
    const rd = (navale && navale.round) || 1;
    if (rd !== seenRound) { seenRound = rd; seenEnemy = new Set(); seenMine = new Set(); }
  }

  /* ---------- Effets visuels ---------- */
  let prevMyTurn = false;
  function sonarPing() {
    const area = $("#enemy-area"); if (!area) return;
    let ping = area.querySelector(".sonar-ping");
    if (!ping) { ping = document.createElement("span"); ping.className = "sonar-ping"; area.appendChild(ping); }
    ping.classList.remove("go"); void ping.offsetWidth; ping.classList.add("go");
  }
  function recoil() {
    const b = $("#enemy-board"); if (!b) return;
    b.classList.remove("recoil"); void b.offsetWidth; b.classList.add("recoil");
    setTimeout(() => { if (b) b.classList.remove("recoil"); }, 240);
  }

  /* ---------- Cadrage / transitions d'écran ---------- */
  function focusBoard(which, smooth) {
    const eA = $("#enemy-area"), mA = $("#my-area");
    if (!eA || !mA) return;
    eA.classList.toggle("active", which === "enemy");
    mA.classList.toggle("active", which === "mine");
    if (which === curFocus) return; // déjà cadré : pas de re-scroll
    curFocus = which;
    const target = which === "mine" ? mA : eA;
    try { target.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "center" }); }
    catch (e) { try { target.scrollIntoView(); } catch (_) {} }
  }
  // On me tire dessus : montrer l'impact sur ma flotte, puis revenir à mon écran.
  function triggerIncomingAttack() {
    watching = true;
    clearTimeout(attackTimer);
    focusBoard("mine", true);
    const mA = $("#my-area");
    if (mA) { mA.classList.remove("under-attack"); void mA.offsetWidth; mA.classList.add("under-attack"); }
    vibrate([25, 40, 25]);
    attackTimer = setTimeout(() => {
      watching = false;
      if (mA) mA.classList.remove("under-attack");
      const myTurn = navale && navale.status === "playing" && navale.turn === me;
      focusBoard(myTurn ? "enemy" : "mine", true);
    }, 1900);
  }

  function renderBattle(myTurn) {
    resetSeenIfNewRound();
    const enemy = $("#enemy-board");
    makeBoard(enemy, "enemy-cols", "enemy-rows", fire);
    enemy.classList.toggle("disabled", !myTurn || navale.status !== "playing");
    const myShots = shotsOf(me), oppShips = shipsOf(1 - me), oppSunk = sunkSet(oppShips, myShots);
    let myHits = 0;
    Object.keys(myShots).forEach((k) => {
      const [r, c] = parse(k), cell = at(enemy, r, c), res = myShots[k], isNew = !seenEnemy.has(k);
      if (oppSunk.has(k)) { cell.classList.add("sunk"); if (isNew) cell.classList.add("shake"); }
      else if (res === "hit") { cell.classList.add("hit"); if (isNew) cell.classList.add("new"); }
      else if (res === "miss") { cell.classList.add("miss"); if (isNew) cell.classList.add("new"); }
      if (res === "hit") myHits++;
      seenEnemy.add(k);
    });
    $("#enemy-left").textContent = `${Math.max(FLEET_CELLS - myHits, 0)} case(s) à couler`;

    const mine = $("#my-board");
    makeBoard(mine, "my-cols", "my-rows", null);
    const myShips = shipsOf(me), oppShots = shotsOf(1 - me), mySunk = sunkSet(myShips, oppShots);
    myShips.forEach((sh) => { const map = hullClassesFor(sh || []); (sh || []).forEach((k) => { const [r, c] = parse(k); at(mine, r, c).className = "cell " + map[k].join(" "); }); });
    let oppHits = 0;
    Object.keys(oppShots).forEach((k) => {
      const [r, c] = parse(k), cell = at(mine, r, c), isNew = !seenMine.has(k);
      if (mySunk.has(k)) { cell.classList.add("sunk"); if (isNew) cell.classList.add("shake"); }
      else if (oppShots[k] === "hit") { cell.classList.add("hit"); if (isNew) cell.classList.add("new"); }
      else if (oppShots[k] === "miss") { cell.classList.add("miss"); if (isNew) cell.classList.add("new"); }
      if (oppShots[k] === "hit") oppHits++;
      seenMine.add(k);
    });
    $("#my-left").textContent = `${Math.max(FLEET_CELLS - oppHits, 0)} case(s) intactes`;
  }

  /* ---------- Rendu principal ---------- */
  function render() {
    couple = getCouple();
    const bSoloTop = $("#btn-solo-top"); if (bSoloTop) bSoloTop.hidden = solo; // en solo, le bandeau « Quitter » suffit
    if (!solo && !couple.code) { show("gate"); renderSoloCtas(); return; }
    if (!solo && me === null) { show("who"); renderWho(); renderSoloCtas(); return; }
    show("game"); renderSerie();
    $("#solo-bar").hidden = !solo;
    const st = (navale && navale.status) || "setup";
    if (st !== "playing" && st !== "finished") { curFocus = null; prevMyTurn = false; } // ré-armer cadrage + ping
    const myReady = !!(navale && navale.boards && navale.boards[me] && navale.boards[me].ready);

    if (st === "setup") {
      if (myReady) {
        $("#setup").hidden = true; $("#battle").hidden = true;
        phaseTitle("En attente…"); turnPill("⏳ " + oppName() + " place sa flotte", "wait");
      } else {
        $("#setup").hidden = false; $("#battle").hidden = true;
        phaseTitle("Place ta flotte"); turnPill("🚢 Positionne tes 5 navires", "wait");
        ensureSetupBoard(); paintSetup(); renderFleet();
      }
    } else if (st === "playing") {
      $("#setup").hidden = true; $("#battle").hidden = false;
      phaseTitle("En bataille !");
      const myTurn = navale.turn === me;
      turnPill(myTurn ? "🎯 À toi de tirer !" : "⏳ Au tour de " + oppName(), myTurn ? "you" : "wait");
      renderBattle(myTurn);
      // Ping sonar + son quand je récupère la main (signal clair « à toi de tirer »).
      const justGotTurn = myTurn && !prevMyTurn;
      prevMyTurn = myTurn;
      if (justGotTurn && !watching) { sonarPing(); sndSonar(); }
      // Cadrer l'écran en cours : mon tir (flotte ennemie) quand c'est mon tour,
      // ma flotte quand j'attends/subis. Gelé juste après mon propre tir.
      if (!watching && Date.now() >= holdUntil) focusBoard(myTurn ? "enemy" : "mine", true);
    } else if (st === "finished") {
      $("#setup").hidden = true; $("#battle").hidden = false;
      renderBattle(false); maybeShowEnd();
    }
  }

  /* ---------- Actions réseau ---------- */
  async function ready() {
    if (!allPlaced()) return;
    const board = { ships: localSetup.ships.map((s) => s.cells), ready: true };
    if (!navale) navale = { status: "setup", turn: 0, winner: null, round: 1, scores: { 0: 0, 1: 0 }, boards: {}, shots: {} };
    navale.boards = navale.boards || {}; navale.boards[me] = board;
    if (solo) { navale.status = "playing"; navale.turn = 0; render(); toast("⚔️ En bataille contre l'ordinateur !"); return; }
    render();
    try {
      await store().patch("", { status: navale.status || "setup", turn: navale.turn || 0, round: navale.round || 1, scores: normScores(navale.scores) });
      await store().put("/boards/" + me, board);
      await pull(); toast("Flotte prête ⚔️");
    } catch (e) { toast("Connexion en cours…"); }
  }

  async function fire(r, c) {
    if (!navale || navale.status !== "playing" || navale.turn !== me) return;
    const k = key(r, c), shots = Object.assign({}, shotsOf(me));
    if (shots[k]) return;
    const oppShips = shipsOf(1 - me);
    const hit = oppShips.some((sh) => (sh || []).indexOf(k) !== -1);
    shots[k] = hit ? "hit" : "miss";
    navale.shots = navale.shots || {}; navale.shots[me] = shots;
    const total = oppShips.reduce((n, sh) => n + (sh ? sh.length : 0), 0);
    const hits = Object.keys(shots).filter((x) => shots[x] === "hit").length;
    // navire coulé ?
    const sunkShip = hit ? oppShips.find((sh) => (sh || []).indexOf(k) !== -1 && sh.every((c) => shots[c] === "hit")) : null;
    const meta = {};
    audio(); sndFire(); recoil();
    if (hit && total > 0 && hits >= total) {
      const sc = normScores(navale.scores); sc[me] = (sc[me] || 0) + 1;
      navale.status = "finished"; navale.winner = me; navale.scores = sc;
      meta.status = "finished"; meta.winner = me; meta.scores = sc; vibrate([40, 60, 120]);
      setTimeout(sndSink, 130); setTimeout(sndWin, 500);
    } else if (sunkShip) { setTimeout(sndSink, 130); toast("💥 Coulé — " + shipName(sunkShip.length) + " !", 2600); vibrate([50, 40, 90]); }
    else if (hit) { setTimeout(sndHit, 100); toast("💥 Touché !"); vibrate(60); }
    else { navale.turn = 1 - me; meta.turn = 1 - me; setTimeout(sndMiss, 100); toast("💧 Manqué"); vibrate(20); }
    holdUntil = Date.now() + 1400; // rester sur la flotte ennemie pour voir le résultat de mon tir
    render();
    if (solo) { if (navale.status === "playing" && navale.turn !== me) scheduleBot(); return; }
    try {
      await store().put("/shots/" + me, shots);
      if (Object.keys(meta).length) await store().patch("", meta);
      pull();
    } catch (e) { toast("Coup non transmis — nouvel essai à la synchro."); }
  }

  async function rematch() {
    const round = ((navale && navale.round) || 1) + 1;
    const scores = normScores(navale && navale.scores);
    if (solo) {
      navale = { status: "setup", turn: 0, winner: null, round, scores, boards: { 1: { ships: randomFleet() || [], ready: true } }, shots: {} };
      localSetup = { ships: [], orientation: localSetup.orientation, active: 0 };
      botReset(); seenEnemy = new Set(); seenMine = new Set();
      $("#end-modal").hidden = true; endShownForRound = -1; render();
      return;
    }
    navale = { status: "setup", turn: 0, winner: null, round, scores, boards: {}, shots: {} };
    localSetup = { ships: [], orientation: localSetup.orientation, active: 0 };
    persistSetup(); $("#end-modal").hidden = true; endShownForRound = -1;
    render();
    try { await store().patch("", { status: "setup", turn: 0, winner: null, round, scores, boards: null, shots: null }); pull(); }
    catch (e) { toast("Connexion…"); }
  }

  function maybeShowEnd() {
    const rd = navale.round || 1;
    if (endShownForRound === rd) return;
    endShownForRound = rd;
    const iWon = navale.winner === me, sc = normScores(navale.scores), nm = names();
    $("#end-emoji").textContent = iWon ? "🏆" : "🌊";
    $("#end-title").textContent = iWon ? "Victoire !" : "Défaite…";
    $("#end-sub").innerHTML = (iWon ? "Tu as coulé toute la flotte de " + escapeHtml(oppName()) + " ! 🎉" : escapeHtml(nm[navale.winner]) + " a gagné cette manche.") +
      `<br><br><strong>Série : ${escapeHtml(nm[0])} ${sc[0]} – ${sc[1]} ${escapeHtml(nm[1])}</strong>`;
    if (iWon) confetti();
    $("#end-modal").hidden = false;
  }
  function confetti() {
    const box = $("#confetti"); box.innerHTML = "";
    const cols = ["#7c3aed", "#ec4899", "#fbbf24", "#34d399", "#60a5fa"];
    for (let i = 0; i < 40; i++) { const c = document.createElement("i"); c.style.left = Math.random() * 100 + "%"; c.style.background = cols[Math.floor(Math.random() * cols.length)]; c.style.animationDuration = 1.4 + Math.random() * 1.5 + "s"; c.style.animationDelay = Math.random() * 0.3 + "s"; box.appendChild(c); }
  }

  /* ---------- Entraînement contre l'ordinateur (hors-ligne) ---------- */
  // Génère une flotte complète valide (règle d'écart d'1 case) sans dépendre
  // de localSetup — utilisée pour la flotte du bot.
  function randomFleet() {
    for (let attempt = 0; attempt < 80; attempt++) {
      const ships = [], halo = new Set(); let ok = true;
      for (let i = 0; i < FLEET.length; i++) {
        let placed = null;
        for (let t = 0; t < 400 && !placed; t++) {
          const orient = Math.random() < 0.5 ? "h" : "v";
          const r = Math.floor(Math.random() * 10), c = Math.floor(Math.random() * 10);
          const cells = cellsFor(r, c, FLEET[i].size, orient);
          if (cells && cells.every((k) => !halo.has(k))) placed = cells;
        }
        if (!placed) { ok = false; break; }
        ships.push(placed);
        placed.forEach((k) => { const [r, c] = parse(k); for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const rr = r + dr, cc = c + dc; if (rr >= 0 && rr < 10 && cc >= 0 && cc < 10) halo.add(key(rr, cc)); } });
      }
      if (ok) return ships;
    }
    return null;
  }
  function botReset() { botState = { tried: new Set(), water: new Set(), chain: [] }; }
  const inBounds = (r, c) => r >= 0 && r < 10 && c >= 0 && c < 10;
  function botFireable(k) { return !botState.tried.has(k) && !botState.water.has(k); }
  function botOrtho(k) { const [r, c] = parse(k); return [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].filter(([rr, cc]) => inBounds(rr, cc)).map(([rr, cc]) => key(rr, cc)); }
  function botDiagonals(k) { const [r, c] = parse(k); return [[r - 1, c - 1], [r - 1, c + 1], [r + 1, c - 1], [r + 1, c + 1]].filter(([rr, cc]) => inBounds(rr, cc)).map(([rr, cc]) => key(rr, cc)); }
  function botHalo(cells) { const out = new Set(); cells.forEach((k) => { const [r, c] = parse(k); for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const rr = r + dr, cc = c + dc; if (inBounds(rr, cc)) out.add(key(rr, cc)); } }); return out; }
  function renderSoloCtas() {
    const g = $("#btn-solo-gate"), w = $("#btn-solo-who"), t = $("#btn-solo-top");
    if (g) g.onclick = startSolo;
    if (w) w.onclick = startSolo;
    if (t) t.onclick = confirmSolo;
  }
  // Depuis une partie couple en cours : bascule vers le solo (la partie avec
  // Babe reste sauvegardée côté serveur et revient dès qu'on quitte le solo).
  function confirmSolo() {
    const inGame = !solo && navale && (navale.status === "playing" || navale.status === "setup" || navale.status === "finished");
    if (inGame && couple.code) {
      const ok = confirm("Passer en entraînement solo ? Ta partie avec " + oppName() + " reste sauvegardée et tu la retrouveras en quittant le solo.");
      if (!ok) return;
    }
    startSolo();
  }
  function startSolo() {
    solo = true; me = 0;
    stopPolling(); stopStream();
    if (botTimer) { clearTimeout(botTimer); botTimer = null; }
    navale = { status: "setup", turn: 0, winner: null, round: 1, scores: { 0: 0, 1: 0 }, boards: { 1: { ships: randomFleet() || [], ready: true } }, shots: {} };
    localSetup = { ships: [], orientation: localSetup.orientation || "h", active: 0 };
    botReset();
    seenEnemy = new Set(); seenMine = new Set(); seenRound = -1;
    endShownForRound = -1; curFocus = null; prevMyTurn = false; watching = false;
    $("#end-modal").hidden = true;
    render();
    toast("🤖 Entraînement — place ta flotte !", 2600);
  }
  function exitSolo() {
    solo = false;
    if (botTimer) { clearTimeout(botTimer); botTimer = null; }
    navale = null; endShownForRound = -1; $("#end-modal").hidden = true; $("#solo-bar").hidden = true;
    couple = getCouple();
    let m = localStorage.getItem("navale.me"); me = m === null ? null : parseInt(m, 10);
    if (me !== null) restoreSetup();
    render();
    if (couple.code && me !== null) { pull(); startPolling(); startStream(); }
  }
  function scheduleBot() { if (botTimer) clearTimeout(botTimer); botTimer = setTimeout(botPlay, 1500); }
  // Candidats de ciblage déduits de la chaîne de touchés en cours.
  function botTargetCandidates() {
    const chain = botState.chain;
    if (!chain.length) return [];
    if (chain.length === 1) return botOrtho(chain[0]).filter(botFireable); // orientation inconnue
    // ≥ 2 touchés alignés : on prolonge UNIQUEMENT la ligne (les cases
    // perpendiculaires sont forcément de l'eau — règle d'écart d'1 case).
    const coords = chain.map(parse);
    const horizontal = coords.every(([r]) => r === coords[0][0]);
    let cands = [];
    if (horizontal) {
      const r = coords[0][0], cs = coords.map((x) => x[1]).sort((a, b) => a - b);
      cands = [key(r, cs[0] - 1), key(r, cs[cs.length - 1] + 1)];
    } else {
      const c = coords[0][1], rs = coords.map((x) => x[0]).sort((a, b) => a - b);
      cands = [key(rs[0] - 1, c), key(rs[rs.length - 1] + 1, c)];
    }
    return cands.filter((k) => { const [r, c] = parse(k); return inBounds(r, c) && botFireable(k); });
  }
  // Met à jour la connaissance du bot après un tir (règle d'écart d'1 case).
  function botLearn(k, hit, sunkShip) {
    if (!hit) return;
    // les diagonales d'un touché sont TOUJOURS de l'eau → jamais de tir dessus
    botDiagonals(k).forEach((d) => botState.water.add(d));
    if (sunkShip) {
      // navire coulé : tout son pourtour (halo 8 voisins) est de l'eau ; retour en recherche
      botHalo(sunkShip).forEach((d) => { if ((sunkShip || []).indexOf(d) === -1) botState.water.add(d); });
      botState.chain = [];
    } else {
      botState.chain.push(k);
    }
  }
  function botPickTarget() {
    // 1) ciblage : prolonge la chaîne de touchés
    const t = botTargetCandidates();
    if (t.length) return t[Math.floor(Math.random() * t.length)];
    // 2) recherche : case en damier, jamais une case connue « eau »
    const all = [], even = [];
    for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) { const k = key(r, c); if (botFireable(k)) { all.push(k); if ((r + c) % 2 === 0) even.push(k); } }
    const pool = even.length ? even : all;
    return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
  }
  function botPlay() {
    botTimer = null;
    if (!solo || !navale || navale.status !== "playing" || navale.turn === me) return;
    const k = botPickTarget(); if (!k) return;
    const myShips = shipsOf(me); // flotte du joueur (plateau 0)
    const hit = myShips.some((sh) => (sh || []).indexOf(k) !== -1);
    const shots = Object.assign({}, shotsOf(1 - me));
    shots[k] = hit ? "hit" : "miss";
    navale.shots = navale.shots || {}; navale.shots[1 - me] = shots;
    botState.tried.add(k);
    audio(); sndFire();
    const total = myShips.reduce((n, sh) => n + (sh ? sh.length : 0), 0);
    const botHits = Object.keys(shots).filter((x) => shots[x] === "hit").length;
    const sunkShip = hit ? myShips.find((sh) => (sh || []).indexOf(k) !== -1 && sh.every((c) => shots[c] === "hit")) : null;
    botLearn(k, hit, sunkShip);
    triggerIncomingAttack(); // je vois l'impact sur ma flotte, puis retour à mon écran
    if (hit && total > 0 && botHits >= total) {
      navale.status = "finished"; navale.winner = 1 - me;
      const sc = normScores(navale.scores); sc[1 - me] = (sc[1 - me] || 0) + 1; navale.scores = sc; // série locale uniquement
      setTimeout(sndSink, 200); vibrate([40, 60, 120]); render(); return;
    }
    if (sunkShip) { setTimeout(sndSink, 200); toast("🤖 L'ordi coule ton " + shipName(sunkShip.length) + " !", 2600); vibrate([50, 40, 90]); }
    else if (hit) { setTimeout(sndHit, 200); toast("🤖 L'ordi touche !"); vibrate(60); }
    else { navale.turn = me; setTimeout(sndMiss, 200); }
    render();
    if (navale.status === "playing" && navale.turn !== me) scheduleBot(); // l'ordi rejoue après un touché
  }

  /* ---------- Synchro ---------- */
  let lastErr = false;
  function setDot(s) { $("#sync-dot").className = "sync-dot " + s; }
  async function pull() {
    if (solo) return; // l'entraînement est 100% local
    if (!couple.code || me === null) { render(); return; }
    if (drag) return; // ne pas rerender pendant un glisser
    setDot("syncing");
    const prevOpp = Object.keys(shotsOf(1 - me)).length;
    const wasPlaying = !!(navale && navale.status === "playing");
    try {
      const rem = await store().get("");
      navale = rem;
      if (navale && navale.status === "setup" && navale.boards &&
          navale.boards[0] && navale.boards[0].ready && navale.boards[1] && navale.boards[1].ready) {
        navale.status = "playing"; navale.turn = navale.turn || 0;
        await store().patch("", { status: "playing", turn: navale.turn });
      }
      setDot("ok"); lastErr = false;
      // Détecter une attaque adverse fraîche pour lancer la séquence "sous attaque"
      const newOpp = Object.keys(shotsOf(1 - me)).length;
      if (wasPlaying && navale && navale.status === "playing" && newOpp > prevOpp) triggerIncomingAttack();
      render();
    } catch (e) { setDot("error"); if (!lastErr) { toast("Synchro indisponible — réessai…"); lastErr = true; } }
  }
  let pollId = null;
  // Le stream Firebase pousse les changements en direct : quand il est actif,
  // le polling devient un simple filet de sécurité très espacé.
  function pollDelay() {
    if (streamHealthy) return 20000;
    return (navale && navale.status === "playing") ? 1200 : 2600;
  }
  function startPolling() {
    stopPolling();
    if (solo) return;
    const tick = () => {
      if (document.visibilityState === "visible" && !drag) pull();
      pollId = setTimeout(tick, pollDelay());
    };
    pollId = setTimeout(tick, pollDelay());
  }
  function stopPolling() { if (pollId) { clearTimeout(pollId); pollId = null; } }

  /* ---------- Temps réel (streaming SSE) ---------- */
  let streamSub = null, streamHealthy = false, streamRetry = null, pullTimer = null;
  function schedulePull() { if (pullTimer || drag) return; pullTimer = setTimeout(() => { pullTimer = null; pull(); }, 60); }
  function startStream() {
    stopStream();
    if (solo || !couple.code || me === null || !window.Realtime) return;
    streamSub = window.Realtime.subscribe(base() + ".json", {
      onChange: () => { streamHealthy = true; schedulePull(); },
      onError: () => {
        streamHealthy = false; // le polling reprend son rythme normal
        if (!streamRetry) streamRetry = setTimeout(() => { streamRetry = null; startStream(); }, 20000);
      },
    });
  }
  function stopStream() {
    if (streamSub) { streamSub.close(); streamSub = null; }
    if (streamRetry) { clearTimeout(streamRetry); streamRetry = null; }
    streamHealthy = false;
  }

  /* ---------- Thème ---------- */
  function applyTheme(theme) {
    document.body.classList.toggle("light", theme === "light");
    $("#btn-theme").textContent = theme === "light" ? "☀️" : "🌙";
    $('meta[name="theme-color"]').setAttribute("content", theme === "light" ? "#eaf0fb" : "#0b1220");
    localStorage.setItem("navale.theme", theme);
  }
  function initTheme() {
    let theme = localStorage.getItem("navale.theme");
    if (!theme) { try { theme = JSON.parse(localStorage.getItem("sudoq.v1") || "{}").theme || "dark"; } catch (e) { theme = "dark"; } }
    applyTheme(theme);
  }

  /* ---------- Init ---------- */
  function init() {
    initTheme();
    $("#app-version").textContent = "Bataille navale " + APP_VERSION + " · temps réel";
    $("#btn-theme").onclick = () => applyTheme(document.body.classList.contains("light") ? "dark" : "light");
    $("#btn-sync").onclick = () => { toast(couple.code ? "Espace : " + String(couple.code).slice(0, 8) + "…" : "Aucun espace de couple"); pull(); };
    $("#btn-rotate").onclick = rotate;
    $("#btn-random").onclick = randomPlace;
    $("#btn-clear").onclick = clearSetup;
    $("#btn-ready").onclick = ready;
    $("#btn-rematch").onclick = rematch;
    const exitBtn = $("#btn-exit-solo"); if (exitBtn) exitBtn.onclick = exitSolo;
    renderSoloCtas();
    restoreSetup(); render();
    if (couple.code && me !== null) { pull(); startPolling(); startStream(); }
    document.addEventListener("visibilitychange", () => {
      if (!solo && document.visibilityState === "visible") { pull(); if (!streamSub) startStream(); }
    });
  }

  // Hook de test : simule une partie complète du bot contre une flotte donnée,
  // en réutilisant l'IA réelle (ciblage + apprentissage). Renvoie des métriques.
  function simBot(playerShips) {
    const savedSolo = solo, savedNav = navale;
    solo = true; me = 0;
    navale = { status: "playing", turn: 1, winner: null, round: 1, scores: { 0: 0, 1: 0 }, boards: { 0: { ships: playerShips, ready: true } }, shots: { 0: {}, 1: {} } };
    botReset();
    const total = playerShips.reduce((n, sh) => n + sh.length, 0);
    let shots = 0, badDiagFires = 0, guard = 0;
    const shotsMap = navale.shots[1];
    while (guard++ < 300) {
      const k = botPickTarget(); if (!k) break;
      // invariant : ne jamais tirer en diagonale d'un touché déjà connu
      if (botDiagonals(k).some((d) => shotsMap[d] === "hit")) badDiagFires++;
      const hit = playerShips.some((sh) => sh.indexOf(k) !== -1);
      shotsMap[k] = hit ? "hit" : "miss"; botState.tried.add(k); shots++;
      const sunkShip = hit ? playerShips.find((sh) => sh.indexOf(k) !== -1 && sh.every((c) => shotsMap[c] === "hit")) : null;
      botLearn(k, hit, sunkShip);
      const botHits = Object.keys(shotsMap).filter((x) => shotsMap[x] === "hit").length;
      if (botHits >= total) break;
    }
    solo = savedSolo; navale = savedNav; botReset();
    return { shots, total, badDiagFires };
  }
  window.__navale = { cellsFor, canPlace, FLEET, occupiedHalo, getSetup: () => localSetup, simBot, randomFleet };
  init();
})();
