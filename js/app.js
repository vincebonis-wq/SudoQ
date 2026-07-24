/* =========================================================================
 * SudoQ — Logique de l'application
 * ========================================================================= */
(function () {
  "use strict";

  const { LEVELS, BAND_META, getLevelPuzzle, isSafe } = window.Sudoku;
  const STORE_KEY = "sudoq.v1";

  /* ----------------- État persistant ----------------- */
  const defaultState = {
    players: ["Vince", "Ma copine"],
    currentPlayer: 0,
    unlocked: 1, // nombre de niveaux débloqués (le 1er est toujours dispo)
    theme: "dark",
    // records[levelIndex] = { "0": tempsSecondes, "1": tempsSecondes }
    records: {},
  };

  function loadState() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return { ...defaultState };
      const parsed = JSON.parse(raw);
      return { ...defaultState, ...parsed };
    } catch (e) {
      return { ...defaultState };
    }
  }
  function saveState() {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  }
  let state = loadState();

  /* ----------------- État de jeu (volatile) ----------------- */
  let game = null; // { level, puzzle, solution, values, notes, selected, ... }
  let timerId = null;

  /* ----------------- Raccourcis DOM ----------------- */
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const screens = {
    levels: $("#screen-levels"),
    game: $("#screen-game"),
    scoreboard: $("#screen-scoreboard"),
  };

  function showScreen(name) {
    Object.values(screens).forEach((s) => s.classList.remove("active"));
    screens[name].classList.add("active");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* ----------------- Utilitaires ----------------- */
  function fmt(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  function initials(name) {
    return (name || "?").trim().charAt(0).toUpperCase() || "?";
  }
  const AVATAR_COLORS = ["#7c3aed", "#ec4899"];

  let toastTimer = null;
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 2200);
  }

  /* ============================================================
   * SÉLECTEUR DE JOUEUR (barre du haut)
   * ============================================================ */
  function renderPlayerSwitch() {
    const wrap = $("#player-switch");
    wrap.innerHTML = "";
    state.players.forEach((name, i) => {
      const b = document.createElement("button");
      b.textContent = name;
      b.className = i === state.currentPlayer ? "active" : "";
      b.onclick = () => {
        state.currentPlayer = i;
        saveState();
        renderPlayerSwitch();
        renderLevels();
        toast(`À toi de jouer, ${name} !`);
      };
      wrap.appendChild(b);
    });
    const edit = document.createElement("button");
    edit.className = "edit";
    edit.textContent = "✎";
    edit.title = "Modifier les profils";
    edit.onclick = openPlayersModal;
    wrap.appendChild(edit);
  }

  /* ============================================================
   * ÉCRAN NIVEAUX
   * ============================================================ */
  function renderLevels() {
    const grid = $("#level-grid");
    grid.innerHTML = "";
    LEVELS.forEach((lvl) => {
      const meta = BAND_META[lvl.band];
      const unlocked = lvl.index < state.unlocked;
      const best = getRecord(lvl.index, state.currentPlayer);

      const card = document.createElement("button");
      card.className = "level-card" + (unlocked ? "" : " locked");
      card.style.setProperty("--band-color", meta.color);
      card.innerHTML = `
        <span class="band-strip"></span>
        ${unlocked ? "" : '<span class="lv-lock">🔒</span>'}
        <span class="lv-emoji">${meta.emoji}</span>
        <span class="lv-num">${lvl.number}</span>
        <span class="lv-band">${lvl.band}</span>
        <span class="lv-best ${best != null ? "done" : ""}">
          ${best != null ? "⏱ " + fmt(best) : "—"}
        </span>
      `;
      if (unlocked) card.onclick = () => startLevel(lvl.index);
      else card.onclick = () => toast("Termine le niveau précédent pour débloquer 🔒");
      grid.appendChild(card);
    });
  }

  function getRecord(levelIndex, playerIndex) {
    const r = state.records[levelIndex];
    if (!r) return null;
    const v = r[playerIndex];
    return v == null ? null : v;
  }
  function setRecord(levelIndex, playerIndex, seconds) {
    if (!state.records[levelIndex]) state.records[levelIndex] = {};
    const prev = state.records[levelIndex][playerIndex];
    if (prev == null || seconds < prev) {
      state.records[levelIndex][playerIndex] = seconds;
      saveState();
      return true; // nouveau record
    }
    return false;
  }

  /* ============================================================
   * DÉMARRAGE D'UN NIVEAU
   * ============================================================ */
  function startLevel(levelIndex) {
    const lvl = LEVELS[levelIndex];
    toast("Préparation de la grille…");
    // Génération éventuellement lente -> on laisse le toast s'afficher.
    setTimeout(() => {
      const { puzzle, solution } = getLevelPuzzle(levelIndex);
      game = {
        level: lvl,
        puzzle: puzzle.slice(),
        solution: solution.slice(),
        values: puzzle.slice(), // valeurs actuelles (0 = vide)
        notes: Array.from({ length: 81 }, () => new Set()),
        selected: null,
        pencil: false,
        elapsed: 0,
        paused: false,
        finished: false,
        hintsUsed: 0,
      };
      buildBoard();
      $("#game-level-chip").textContent = `Niveau ${lvl.number} · ${lvl.band}`;
      $("#pencil-state").textContent = "OFF";
      $("#btn-pencil").classList.remove("active");
      $("#board-overlay").hidden = true;
      showScreen("game");
      startTimer();
      updateNumpadCounts();
    }, 30);
  }

  /* ----------------- Construction du plateau ----------------- */
  function buildBoard() {
    const board = $("#board");
    board.innerHTML = "";
    for (let i = 0; i < 81; i++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      const row = Math.floor(i / 9);
      if (row === 2) cell.classList.add("row3");
      if (row === 5) cell.classList.add("row6");
      if (game.puzzle[i] !== 0) cell.classList.add("fixed");
      cell.dataset.i = i;
      cell.onclick = () => selectCell(i);
      board.appendChild(cell);
    }
    renderAllCells();
  }

  function renderAllCells() {
    for (let i = 0; i < 81; i++) renderCell(i);
    applyHighlights();
  }

  function renderCell(i) {
    const cell = $(`.cell[data-i="${i}"]`);
    if (!cell) return;
    const val = game.values[i];
    cell.classList.remove("error");
    if (val !== 0) {
      cell.textContent = val;
      // Erreur = en contradiction avec la solution (uniquement pour les saisies utilisateur)
      if (game.puzzle[i] === 0 && val !== game.solution[i]) {
        cell.classList.add("error");
      }
    } else {
      cell.textContent = "";
      const notes = game.notes[i];
      if (notes && notes.size) {
        const pg = document.createElement("div");
        pg.className = "pencil-grid";
        for (let n = 1; n <= 9; n++) {
          const s = document.createElement("span");
          s.textContent = notes.has(n) ? n : "";
          pg.appendChild(s);
        }
        cell.appendChild(pg);
      }
    }
  }

  /* ----------------- Sélection & surbrillance ----------------- */
  function selectCell(i) {
    if (game.paused || game.finished) return;
    game.selected = i;
    applyHighlights();
  }

  function applyHighlights() {
    const sel = game.selected;
    $$(".cell").forEach((c) => c.classList.remove("selected", "peer", "same-num"));
    if (sel == null) return;
    const selRow = Math.floor(sel / 9);
    const selCol = sel % 9;
    const selBoxR = Math.floor(selRow / 3);
    const selBoxC = Math.floor(selCol / 3);
    const selVal = game.values[sel];

    for (let i = 0; i < 81; i++) {
      const cell = $(`.cell[data-i="${i}"]`);
      const row = Math.floor(i / 9);
      const col = i % 9;
      const sameRow = row === selRow;
      const sameCol = col === selCol;
      const sameBox =
        Math.floor(row / 3) === selBoxR && Math.floor(col / 3) === selBoxC;
      if (sameRow || sameCol || sameBox) cell.classList.add("peer");
      if (selVal !== 0 && game.values[i] === selVal) cell.classList.add("same-num");
    }
    $(`.cell[data-i="${sel}"]`).classList.add("selected");
  }

  /* ----------------- Saisie d'un chiffre ----------------- */
  function inputNumber(n) {
    if (game.paused || game.finished) return;
    const i = game.selected;
    if (i == null) {
      toast("Choisis d'abord une case ✨");
      return;
    }
    if (game.puzzle[i] !== 0) return; // case fixe

    if (game.pencil) {
      // Mode notes : on bascule le candidat
      if (game.values[i] !== 0) return; // pas de note sur une case remplie
      const set = game.notes[i];
      set.has(n) ? set.delete(n) : set.add(n);
    } else {
      // Mode normal
      if (game.values[i] === n) {
        game.values[i] = 0; // re-clic = effacer
      } else {
        game.values[i] = n;
        game.notes[i].clear();
        // Nettoie les notes des cases voisines (confort)
        clearPeerNotes(i, n);
      }
    }
    renderAllCells();
    updateNumpadCounts();
    if (!game.pencil) checkSolved();
  }

  function clearPeerNotes(i, n) {
    const row = Math.floor(i / 9);
    const col = i % 9;
    const boxR = Math.floor(row / 3) * 3;
    const boxC = Math.floor(col / 3) * 3;
    for (let k = 0; k < 9; k++) {
      game.notes[row * 9 + k].delete(n);
      game.notes[k * 9 + col].delete(n);
    }
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++)
        game.notes[(boxR + r) * 9 + (boxC + c)].delete(n);
  }

  function eraseCell() {
    if (game.paused || game.finished) return;
    const i = game.selected;
    if (i == null || game.puzzle[i] !== 0) return;
    game.values[i] = 0;
    game.notes[i].clear();
    renderAllCells();
    updateNumpadCounts();
  }

  /* ----------------- Numpad : compteur restant ----------------- */
  function buildNumpad() {
    const pad = $("#numpad");
    pad.innerHTML = "";
    for (let n = 1; n <= 9; n++) {
      const b = document.createElement("button");
      b.className = "num-key";
      b.innerHTML = `${n}<span class="count" data-n="${n}"></span>`;
      b.onclick = () => inputNumber(n);
      pad.appendChild(b);
    }
  }

  function updateNumpadCounts() {
    const counts = new Array(10).fill(0);
    for (let i = 0; i < 81; i++) {
      if (game.values[i] !== 0) counts[game.values[i]]++;
    }
    for (let n = 1; n <= 9; n++) {
      const badge = $(`.count[data-n="${n}"]`);
      const remaining = 9 - counts[n];
      if (badge) badge.textContent = remaining > 0 ? remaining : "";
      const key = badge?.closest(".num-key");
      if (key) key.classList.toggle("done", remaining <= 0);
    }
    // Reflète l'état du mode crayon sur les touches
    $$(".num-key").forEach((k) => k.classList.toggle("pencil-active", game.pencil));
  }

  /* ----------------- Vérification / résolution ----------------- */
  function isComplete() {
    for (let i = 0; i < 81; i++) if (game.values[i] === 0) return false;
    return true;
  }
  function isCorrect() {
    for (let i = 0; i < 81; i++)
      if (game.values[i] !== game.solution[i]) return false;
    return true;
  }
  function checkSolved() {
    if (isComplete() && isCorrect()) finishGame();
  }

  function manualCheck() {
    if (game.paused || game.finished) return;
    let errors = 0;
    for (let i = 0; i < 81; i++) {
      if (game.puzzle[i] === 0 && game.values[i] !== 0 && game.values[i] !== game.solution[i])
        errors++;
    }
    if (errors === 0) toast(isComplete() ? "Parfait ! 🎯" : "Aucune erreur pour l'instant 👍");
    else toast(`${errors} erreur${errors > 1 ? "s" : ""} à corriger ✂️`);
  }

  function useHint() {
    if (game.paused || game.finished) return;
    let i = game.selected;
    // Si aucune case vide sélectionnée, on en prend une au hasard.
    if (i == null || game.values[i] !== 0 || game.puzzle[i] !== 0) {
      const empties = [];
      for (let k = 0; k < 81; k++)
        if (game.values[k] === 0 && game.puzzle[k] === 0) empties.push(k);
      if (!empties.length) return;
      i = empties[Math.floor(Math.random() * empties.length)];
      game.selected = i;
    }
    game.values[i] = game.solution[i];
    game.notes[i].clear();
    clearPeerNotes(i, game.values[i]);
    game.hintsUsed++;
    renderAllCells();
    applyHighlights();
    updateNumpadCounts();
    const cell = $(`.cell[data-i="${i}"]`);
    cell.classList.add("hint-pop");
    setTimeout(() => cell.classList.remove("hint-pop"), 500);
    toast("Indice utilisé 💡 (ton temps continue !)");
    checkSolved();
  }

  /* ----------------- Chronomètre ----------------- */
  function startTimer() {
    stopTimer();
    updateTimerDisplay();
    timerId = setInterval(() => {
      if (!game.paused && !game.finished) {
        game.elapsed++;
        updateTimerDisplay();
      }
    }, 1000);
  }
  function stopTimer() {
    if (timerId) clearInterval(timerId);
    timerId = null;
  }
  function updateTimerDisplay() {
    $("#timer").textContent = fmt(game.elapsed);
  }

  function togglePause() {
    if (game.finished) return;
    game.paused = !game.paused;
    $("#board-overlay").hidden = !game.paused;
    $("#overlay-text").textContent = "⏸ En pause";
    $("#btn-pause").textContent = game.paused ? "▶" : "⏸";
  }

  /* ----------------- Fin de partie ----------------- */
  function finishGame() {
    game.finished = true;
    stopTimer();
    const time = game.elapsed;
    const lvl = game.level;
    const p = state.currentPlayer;

    const prevBest = getRecord(lvl.index, p);
    const isNewRecord = setRecord(lvl.index, p, time);

    // Débloque le niveau suivant
    if (lvl.index + 1 >= state.unlocked && lvl.index + 1 < LEVELS.length) {
      state.unlocked = lvl.index + 1 + 1;
      saveState();
    }
    renderLevels();

    showWinModal(time, isNewRecord, prevBest);
  }

  function showWinModal(time, isNewRecord, prevBest) {
    const lvl = game.level;
    $("#win-time").textContent = fmt(time);
    $("#win-title").textContent = `Niveau ${lvl.number} résolu !`;

    let msg = "";
    if (game.hintsUsed > 0)
      msg = `Bravo ! (avec ${game.hintsUsed} indice${game.hintsUsed > 1 ? "s" : ""})`;
    else msg = "Sans le moindre indice, chapeau ! 🎩";
    $("#win-msg").innerHTML =
      msg +
      (isNewRecord
        ? `<div class="win-record-badge">🏅 Nouveau record perso&nbsp;!</div>`
        : prevBest != null
        ? `<br><small>Ton record reste ${fmt(prevBest)}</small>`
        : "");

    // Comparatif entre les deux joueurs sur ce niveau
    renderWinCompare(lvl.index, time);

    // Bouton niveau suivant
    const hasNext = lvl.index + 1 < LEVELS.length;
    $("#btn-next-level").style.display = hasNext ? "" : "none";

    launchConfetti();
    $("#win-modal").hidden = false;
  }

  function renderWinCompare(levelIndex, myTime) {
    const box = $("#win-compare");
    box.innerHTML = "";
    const times = [0, 1].map((pi) =>
      pi === state.currentPlayer ? myTime : getRecord(levelIndex, pi)
    );
    const valid = times.filter((t) => t != null);
    const bestTime = valid.length ? Math.min(...valid) : null;

    state.players.forEach((name, pi) => {
      const t = times[pi];
      const row = document.createElement("div");
      row.className = "row" + (t != null && t === bestTime ? " best" : "");
      row.innerHTML = `<span class="who">${
        pi === state.currentPlayer ? "👉 " : ""
      }${name}</span><span class="t">${t != null ? fmt(t) : "—"}</span>`;
      box.appendChild(row);
    });

    // Petit message de duel
    const other = 1 - state.currentPlayer;
    const otherTime = getRecord(levelIndex, other);
    const foot = document.createElement("div");
    foot.className = "row";
    foot.style.marginTop = "6px";
    foot.style.borderTop = "1px solid rgba(148,163,184,.2)";
    foot.style.paddingTop = "8px";
    if (otherTime == null) {
      foot.innerHTML = `<span class="who">${state.players[other]} n'a pas encore joué ce niveau 👀</span>`;
    } else if (myTime < otherTime) {
      foot.innerHTML = `<span class="who">🔥 Tu bats ${state.players[other]} de ${fmt(
        otherTime - myTime
      )} !</span>`;
    } else if (myTime > otherTime) {
      foot.innerHTML = `<span class="who">😬 ${state.players[other]} garde ${fmt(
        myTime - otherTime
      )} d'avance…</span>`;
    } else {
      foot.innerHTML = `<span class="who">🤝 Égalité parfaite !</span>`;
    }
    box.appendChild(foot);
  }

  function launchConfetti() {
    const box = $("#confetti");
    box.innerHTML = "";
    const colors = ["#7c3aed", "#ec4899", "#fbbf24", "#34d399", "#60a5fa"];
    for (let i = 0; i < 40; i++) {
      const c = document.createElement("i");
      c.style.left = Math.random() * 100 + "%";
      c.style.background = colors[Math.floor(Math.random() * colors.length)];
      c.style.animationDuration = 1.5 + Math.random() * 1.5 + "s";
      c.style.animationDelay = Math.random() * 0.4 + "s";
      c.style.transform = `rotate(${Math.random() * 360}deg)`;
      box.appendChild(c);
    }
  }

  /* ============================================================
   * TABLEAU DES RECORDS
   * ============================================================ */
  function renderScoreboard() {
    // Cartes joueurs + décompte des victoires
    let wins = [0, 0];
    LEVELS.forEach((lvl) => {
      const t0 = getRecord(lvl.index, 0);
      const t1 = getRecord(lvl.index, 1);
      if (t0 != null && t1 != null) {
        if (t0 < t1) wins[0]++;
        else if (t1 < t0) wins[1]++;
      }
    });

    const versus = $("#versus");
    versus.innerHTML = "";
    const leader = wins[0] === wins[1] ? -1 : wins[0] > wins[1] ? 0 : 1;
    state.players.forEach((name, pi) => {
      if (pi === 1) {
        const mid = document.createElement("div");
        mid.className = "vs-mid";
        mid.textContent = "VS";
        versus.appendChild(mid);
      }
      const card = document.createElement("div");
      card.className = "vs-card" + (leader === pi ? " leader" : "");
      card.innerHTML = `
        <div class="vs-avatar" style="background:${AVATAR_COLORS[pi]}">${initials(name)}</div>
        <div class="vs-name">${name}</div>
        <div class="vs-wins">${wins[pi]}</div>
        <div class="vs-label">niveaux gagnés</div>
      `;
      versus.appendChild(card);
    });

    // Tableau détaillé
    const table = $("#score-table");
    table.innerHTML = `
      <thead>
        <tr>
          <th>Niveau</th>
          <th>${state.players[0]}</th>
          <th>${state.players[1]}</th>
        </tr>
      </thead>
    `;
    const tbody = document.createElement("tbody");
    LEVELS.forEach((lvl) => {
      const t0 = getRecord(lvl.index, 0);
      const t1 = getRecord(lvl.index, 1);
      let c0 = "empty", c1 = "empty";
      if (t0 != null && t1 != null) {
        if (t0 < t1) c0 = "win";
        else if (t1 < t0) c1 = "win";
      }
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="lvl-cell">Niv. ${lvl.number}<small>${lvl.band}</small></td>
        <td class="time ${t0 != null ? c0 : "empty"}">${t0 != null ? fmt(t0) : "—"}</td>
        <td class="time ${t1 != null ? c1 : "empty"}">${t1 != null ? fmt(t1) : "—"}</td>
      `;
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
  }

  /* ============================================================
   * IMPORT / EXPORT (partage entre appareils / via GitHub)
   * ============================================================ */
  function exportData() {
    const data = {
      app: "SudoQ",
      exportedAt: new Date().toISOString(),
      players: state.players,
      unlocked: state.unlocked,
      records: state.records,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sudoq-scores.json";
    a.click();
    URL.revokeObjectURL(url);
    toast("Scores exportés ✓ (dépose le fichier sur GitHub pour partager)");
  }

  function importData(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data.records) throw new Error("format");
        // Fusion : on garde le meilleur temps de chaque côté.
        Object.keys(data.records).forEach((lvl) => {
          const incoming = data.records[lvl];
          if (!state.records[lvl]) state.records[lvl] = {};
          [0, 1].forEach((pi) => {
            const inc = incoming[pi];
            if (inc == null) return;
            const cur = state.records[lvl][pi];
            if (cur == null || inc < cur) state.records[lvl][pi] = inc;
          });
        });
        if (Array.isArray(data.players) && data.players.length === 2) {
          state.players = data.players;
        }
        if (typeof data.unlocked === "number")
          state.unlocked = Math.max(state.unlocked, data.unlocked);
        // Recalcule le déblocage à partir des records existants
        recomputeUnlocked();
        saveState();
        renderPlayerSwitch();
        renderLevels();
        renderScoreboard();
        toast("Scores importés et fusionnés ✓");
      } catch (e) {
        toast("Fichier invalide ✗");
      }
    };
    reader.readAsText(file);
  }

  function recomputeUnlocked() {
    let maxDone = -1;
    Object.keys(state.records).forEach((lvl) => {
      const r = state.records[lvl];
      if (r && (r[0] != null || r[1] != null)) maxDone = Math.max(maxDone, +lvl);
    });
    state.unlocked = Math.max(state.unlocked, maxDone + 2);
    state.unlocked = Math.min(state.unlocked, LEVELS.length);
  }

  /* ============================================================
   * MODALE PROFILS
   * ============================================================ */
  function openPlayersModal() {
    $("#p1-name").value = state.players[0];
    $("#p2-name").value = state.players[1];
    $("#players-modal").hidden = false;
  }
  function savePlayers() {
    const n1 = $("#p1-name").value.trim() || "Joueur 1";
    const n2 = $("#p2-name").value.trim() || "Joueur 2";
    state.players = [n1, n2];
    saveState();
    $("#players-modal").hidden = true;
    renderPlayerSwitch();
    renderLevels();
    renderScoreboard();
    toast("Profils enregistrés ✓");
  }

  /* ============================================================
   * THÈME
   * ============================================================ */
  function applyTheme() {
    document.body.classList.toggle("light", state.theme === "light");
    $("#btn-theme").textContent = state.theme === "light" ? "☀️" : "🌙";
    document
      .querySelector('meta[name="theme-color"]')
      .setAttribute("content", state.theme === "light" ? "#eef1f8" : "#0f172a");
  }
  function toggleTheme() {
    state.theme = state.theme === "light" ? "dark" : "light";
    saveState();
    applyTheme();
  }

  /* ============================================================
   * MODE CRAYON
   * ============================================================ */
  function togglePencil() {
    game.pencil = !game.pencil;
    $("#btn-pencil").classList.toggle("active", game.pencil);
    $("#pencil-state").textContent = game.pencil ? "ON" : "OFF";
    updateNumpadCounts();
    toast(game.pencil ? "Mode notes activé ✏️" : "Mode notes désactivé");
  }

  /* ============================================================
   * CLAVIER
   * ============================================================ */
  function handleKey(e) {
    if (!screens.game.classList.contains("active") || !game || game.finished) return;
    if (e.key >= "1" && e.key <= "9") {
      inputNumber(+e.key);
    } else if (e.key === "0" || e.key === "Backspace" || e.key === "Delete") {
      eraseCell();
    } else if (e.key === "n" || e.key === " ") {
      e.preventDefault();
      togglePencil();
    } else if (e.key.startsWith("Arrow") && game.selected != null) {
      e.preventDefault();
      let i = game.selected;
      const row = Math.floor(i / 9), col = i % 9;
      if (e.key === "ArrowUp" && row > 0) i -= 9;
      if (e.key === "ArrowDown" && row < 8) i += 9;
      if (e.key === "ArrowLeft" && col > 0) i -= 1;
      if (e.key === "ArrowRight" && col < 8) i += 1;
      selectCell(i);
    } else if (e.key === "h") {
      useHint();
    }
  }

  /* ============================================================
   * BRANCHEMENT DES ÉVÉNEMENTS
   * ============================================================ */
  function bindEvents() {
    $("#btn-home").onclick = () => showScreen("levels");
    $("#btn-theme").onclick = toggleTheme;
    $("#btn-scoreboard").onclick = () => {
      renderScoreboard();
      showScreen("scoreboard");
    };
    $("#btn-back-home").onclick = () => showScreen("levels");
    $("#btn-back").onclick = () => {
      stopTimer();
      showScreen("levels");
    };
    $("#btn-pause").onclick = togglePause;
    $("#btn-resume").onclick = togglePause;
    $("#btn-pencil").onclick = togglePencil;
    $("#btn-erase").onclick = eraseCell;
    $("#btn-hint").onclick = useHint;
    $("#btn-check").onclick = manualCheck;

    // Modale victoire
    $("#btn-next-level").onclick = () => {
      $("#win-modal").hidden = true;
      const next = game.level.index + 1;
      if (next < LEVELS.length) startLevel(next);
      else showScreen("levels");
    };
    $("#btn-replay").onclick = () => {
      $("#win-modal").hidden = true;
      startLevel(game.level.index);
    };
    $("#btn-to-levels").onclick = () => {
      $("#win-modal").hidden = true;
      showScreen("levels");
    };

    // Profils
    $("#btn-save-players").onclick = savePlayers;
    $("#btn-cancel-players").onclick = () => ($("#players-modal").hidden = true);

    // Données
    $("#btn-export").onclick = exportData;
    $("#import-file").onchange = (e) => {
      if (e.target.files[0]) importData(e.target.files[0]);
      e.target.value = "";
    };
    $("#btn-reset").onclick = () => {
      if (confirm("Effacer TOUS les records et la progression ? Cette action est irréversible.")) {
        state = { ...defaultState, records: {}, players: state.players, theme: state.theme };
        saveState();
        renderPlayerSwitch();
        renderLevels();
        renderScoreboard();
        toast("Tout a été réinitialisé");
      }
    };

    document.addEventListener("keydown", handleKey);
  }

  /* ============================================================
   * INITIALISATION
   * ============================================================ */
  function init() {
    applyTheme();
    buildNumpad();
    renderPlayerSwitch();
    renderLevels();
    bindEvents();
  }

  init();
})();
