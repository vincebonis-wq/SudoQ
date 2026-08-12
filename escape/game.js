/* =========================================================================
 * Désamorçage — escape game coopératif asymétrique (inspiré de "Keep Talking
 * and Nobody Explodes"). Démineur voit la bombe, Expert lit le manuel.
 * v2 : edgework (n° de série, piles, indicateur) + module Simon + sons.
 * Données : /spaces/<code>/escape  (seul le démineur écrit ce nœud)
 * ========================================================================= */
(function () {
  "use strict";

  const DB = "https://sudoq-b7925-default-rtdb.europe-west1.firebasedatabase.app";
  const APP_VERSION = "v3";
  const DURATION = 300000;
  const SYMBOLS = ["🌟", "🌀", "🔺", "🟣", "🍀", "🌸", "☢️", "⚡", "✈️", "⚓", "💀", "✂️"];
  const WIRE_COLORS = ["rouge", "bleu", "jaune", "blanc", "noir"];
  const BTN_COLORS = ["rouge", "bleu", "blanc", "jaune"];
  const BTN_LABELS = ["APPUYER", "DÉTONER", "ATTENDRE", "ABANDON"];
  const SIMON = ["rouge", "bleu", "vert", "jaune"];
  const SIMON_HEX = { rouge: "#ef4444", bleu: "#3b82f6", vert: "#22c55e", jaune: "#eab308" };
  const IND_LABELS = ["FRK", "CAR", "SND", "BOB", "CLR", "MSA"];
  const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const DICT = ["AIMER", "COEUR", "FLEUR", "PLAGE", "ROUGE", "NUAGE", "TERRE", "LIVRE", "PORTE", "TABLE", "CHIEN", "SUCRE", "ROSES", "LUNES", "MIELS"];
  const MODULES = ["wires", "button", "keypad", "simon", "password"];
  const DIFF = { facile: { count: 3, dur: 360000, label: "Facile" }, normal: { count: 4, dur: 300000, label: "Normal" }, expert: { count: 5, dur: 240000, label: "Expert" } };
  let chosenDiff = localStorage.getItem("escape.diff") || "normal";
  function activeModules() { return MODULES.slice(0, (esc && esc.count) || 4); }

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  function getCouple() { try { return JSON.parse(localStorage.getItem("couple") || "{}"); } catch (e) { return {}; } }
  let couple = getCouple();
  let role = localStorage.getItem("escape.role");

  function base() { return `${DB}/spaces/${encodeURIComponent(couple.code)}/escape`; }
  async function fbFetch(url, opts, tries) {
    tries = tries || 3; let e;
    for (let i = 0; i < tries; i++) { try { const r = await fetch(url, opts); if (r.ok) return r; if (r.status !== 429 && r.status < 500) return r; e = new Error("HTTP " + r.status); } catch (x) { e = x; } await new Promise((res) => setTimeout(res, 350 * (i + 1))); }
    throw e || new Error("réseau");
  }
  window.__FB = {
    async get() { const r = await fbFetch(`${base()}.json?_=${Date.now()}`, { cache: "no-store" }); if (!r.ok) throw new Error("HTTP " + r.status); const t = await r.text(); return !t || t === "null" ? null : JSON.parse(t); },
    async put(d) { const r = await fbFetch(`${base()}.json`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(d) }); if (!r.ok) throw new Error("HTTP " + r.status); },
  };
  const store = () => window.__FB;

  let esc = null, builtRound = -1, localProg = null, endShown = -1, simonTimer = null;

  /* ---------- Générateur déterministe ---------- */
  function mulberry32(a) { return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function shuffle(arr, rng) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }
  function genBomb(seed) {
    const rng = mulberry32(seed >>> 0), pick = (a) => a[Math.floor(rng() * a.length)];
    // edgework
    let serial = ""; for (let i = 0; i < 3; i++) serial += ALNUM[Math.floor(rng() * 36)]; serial += "0123456789"[Math.floor(rng() * 10)];
    const edge = { serial, hasVowel: /[AEIOU]/.test(serial), lastDigit: parseInt(serial[3], 10), batteries: Math.floor(rng() * 5), indicator: { label: pick(IND_LABELS), lit: rng() < 0.6 } };
    const n = 3 + Math.floor(rng() * 3);
    const wires = []; for (let i = 0; i < n; i++) wires.push(pick(WIRE_COLORS));
    const button = { color: pick(BTN_COLORS), label: pick(BTN_LABELS) };
    const idx = shuffle([...Array(SYMBOLS.length).keys()], rng).slice(0, 4);
    const keypad = shuffle(idx.slice(), rng);
    const simon = []; for (let i = 0; i < 3; i++) simon.push(pick(SIMON));
    const password = genPassword(rng);
    return { edge, wires, button, keypad, simon, password };
  }
  function genPassword(rng) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const word = DICT[Math.floor(rng() * DICT.length)];
      const cols = [];
      for (let i = 0; i < 5; i++) {
        const set = [word[i]];
        while (set.length < 6) { const ch = LETTERS[Math.floor(rng() * 26)]; if (set.indexOf(ch) === -1) set.push(ch); }
        cols.push(shuffle(set, rng));
      }
      const matches = DICT.filter((w) => w.split("").every((ch, i) => cols[i].indexOf(ch) !== -1));
      if (matches.length === 1) return { cols, word };
    }
    // repli : garantit au moins une solution (le mot cible)
    const word = DICT[0], cols = [];
    for (let i = 0; i < 5; i++) { const set = [word[i]]; while (set.length < 6) { const ch = LETTERS[Math.floor(rng() * 26)]; if (set.indexOf(ch) === -1) set.push(ch); } cols.push(shuffle(set, rng)); }
    return { cols, word };
  }

  /* ---------- Règles (le manuel doit correspondre EXACTEMENT) ---------- */
  function wireToCut(w) {
    const n = w.length, cnt = (c) => w.filter((x) => x === c).length, last = (c) => w.lastIndexOf(c), has = (c) => w.indexOf(c) !== -1;
    if (n === 3) { if (!has("rouge")) return 1; if (w[2] === "blanc") return 2; if (cnt("bleu") >= 2) return last("bleu"); return 2; }
    if (n === 4) { if (cnt("rouge") >= 2) return last("rouge"); if (w[3] === "jaune" && !has("rouge")) return 0; if (cnt("bleu") === 1) return 0; return 3; }
    if (w[4] === "noir") return 3; if (cnt("rouge") === 1 && cnt("jaune") > 1) return 0; if (!has("noir")) return 1; return 0;
  }
  function buttonAction(b, edge) {
    const lit = (l) => edge.indicator.lit && edge.indicator.label === l;
    if (edge.batteries >= 2 && b.label === "DÉTONER") return "tap";
    if (b.color === "blanc" && lit("CAR")) return "hold";
    if (edge.batteries >= 3 && lit("FRK")) return "tap";
    if (b.color === "bleu") return "hold";
    if (b.label === "ABANDON") return "hold";
    return "tap";
  }
  function keypadOrder(kp) { return kp.slice().sort((a, b) => a - b); }
  function simonMap(color, hasVowel) {
    const withV = { rouge: "bleu", bleu: "rouge", vert: "jaune", jaune: "vert" };
    const noV = { rouge: "jaune", jaune: "rouge", bleu: "vert", vert: "bleu" };
    return (hasVowel ? withV : noV)[color];
  }

  /* ---------- Sons (WebAudio, démarrés au 1er geste) ---------- */
  let actx = null;
  function audio() { if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } if (actx && actx.state === "suspended") actx.resume(); return actx; }
  function beep(freq, dur, type, vol) {
    const a = audio(); if (!a) return;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type || "sine"; o.frequency.value = freq; g.gain.value = vol || 0.08;
    o.connect(g); g.connect(a.destination); o.start();
    g.gain.setValueAtTime(g.gain.value, a.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + (dur || 0.12));
    o.stop(a.currentTime + (dur || 0.12));
  }
  const sndSolve = () => { beep(660, 0.1, "triangle"); setTimeout(() => beep(990, 0.14, "triangle"), 90); };
  const sndStrike = () => beep(120, 0.28, "sawtooth", 0.14);
  const sndTick = () => beep(1500, 0.04, "square", 0.05);
  const sndBoom = () => { beep(80, 0.5, "sawtooth", 0.18); };
  const sndWin = () => { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, 0.16, "triangle"), i * 110)); };

  /* ---------- UI utils ---------- */
  let toastTimer = null;
  function toast(msg, ms) { const el = $("#toast"); el.textContent = msg; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.hidden = true), ms || 2200); }
  function vibrate(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} }
  function show(id) { ["gate", "who", "role", "game"].forEach((s) => { $("#" + s).hidden = s !== id; }); }
  function fmtT(ms) { const s = Math.max(0, Math.ceil(ms / 1000)); return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); }
  function normScore(s) { return { defused: (s && s.defused) || 0, exploded: (s && s.exploded) || 0 }; }
  function remaining() { if (!esc || esc.status !== "armed") return (esc && esc.duration) || DURATION; return esc.startedAt + esc.duration - Date.now(); }

  /* ---------- Rendu principal ---------- */
  function render() {
    couple = getCouple();
    if (!couple.code) { show("gate"); return; }
    if (!role) { show("role"); return; }
    show("game");
    $("#role-tag").className = "role-tag " + role;
    $("#role-tag").textContent = role === "dem" ? "🧨 Démineur" : "📖 Expert";
    const sc = normScore(esc && esc.score);
    $("#serie").innerHTML = `🏆 Désamorçées : <b>${sc.defused}</b> · 💥 Explosions : <b>${sc.exploded}</b>`;
    updateHud();
    const status = (esc && esc.status) || "idle";
    if (status === "idle" || !esc) {
      stopSimon(); $("#bomb").hidden = true; $("#manual").hidden = true;
      const pre = $("#pre"); pre.hidden = false;
      pre.innerHTML = role === "dem"
        ? `<div class="wait-note"><span class="em">🧨</span>Choisis la difficulté, puis arme la bombe quand l'Expert a le manuel sous les yeux. 3 erreurs = 💥.</div>` +
          `<div class="diff-seg" id="diff-seg">` +
          Object.keys(DIFF).map((k) => `<button data-d="${k}" class="${k === chosenDiff ? "on" : ""}">${DIFF[k].label}<small>${DIFF[k].count} modules · ${fmtT(DIFF[k].dur)}</small></button>`).join("") +
          `</div><button class="btn btn-danger big-cta" id="btn-arm">💣 Armer la bombe</button>`
        : `<div class="wait-note"><span class="em">📖</span>Tu es l'Expert. Garde le manuel prêt et pose des questions au démineur (n° de série, piles, indicateur…).</div>`;
      const seg = $("#diff-seg");
      if (seg) seg.querySelectorAll("button").forEach((b) => { b.onclick = () => { chosenDiff = b.dataset.d; localStorage.setItem("escape.diff", chosenDiff); seg.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); }; });
      const arm = $("#btn-arm"); if (arm) arm.onclick = armBomb;
      return;
    }
    $("#pre").hidden = true;
    if (role === "dem") { $("#manual").hidden = true; $("#bomb").hidden = false; ensureBomb(); updateBombLocks(); }
    else { stopSimon(); $("#bomb").hidden = true; $("#manual").hidden = false; ensureManual(); updateExpStatus(); }
    if (status === "defused" || status === "exploded") maybeEnd();
  }

  function updateHud() {
    const t = $("#timer"), rem = remaining();
    t.textContent = fmtT(rem);
    t.className = "timer" + (rem <= 30000 ? " danger" : rem <= 60000 ? " warn" : "");
    const st = $("#strikes"); st.innerHTML = ""; const strikes = (esc && esc.strikes) || 0;
    for (let i = 0; i < 3; i++) { const x = document.createElement("span"); x.className = "x" + (i < strikes ? " on" : ""); x.textContent = "✖"; st.appendChild(x); }
  }

  /* ---------- Vue Démineur ---------- */
  function ensureBomb() {
    if (builtRound === esc.round && $("#bomb").children.length) return;
    stopSimon();
    builtRound = esc.round;
    localProg = { cutWires: {}, keyPressed: [], simonPressed: [], btnDown: 0 };
    const bomb = genBomb(esc.seed);
    const wrap = $("#bomb"); wrap.innerHTML = "";

    // Edgework
    const e = bomb.edge;
    const edge = document.createElement("div"); edge.className = "edgework";
    edge.innerHTML =
      `<div class="ew"><span class="ew-l">N° SÉRIE</span><span class="ew-v serial">${e.serial}</span></div>` +
      `<div class="ew"><span class="ew-l">PILES</span><span class="ew-v">${"🔋".repeat(e.batteries) || "—"}</span></div>` +
      `<div class="ew"><span class="ew-l">INDICATEUR</span><span class="ew-v ind ${e.indicator.lit ? "lit" : "off"}">● ${e.indicator.label}</span></div>`;
    wrap.appendChild(edge);

    const act = activeModules();

    if (act.indexOf("wires") !== -1) {
      const mW = moduleEl("wires", "🔌 Fils");
      const wires = document.createElement("div"); wires.className = "wires";
      bomb.wires.forEach((color, i) => { const w = document.createElement("div"); w.className = "wire"; w.dataset.i = i; w.innerHTML = `<span class="num">${i + 1}</span><span class="line w-${color}"></span><span class="scis">✂️</span>`; w.onclick = () => cutWire(i, bomb); wires.appendChild(w); });
      mW.querySelector(".m-body").appendChild(wires); wrap.appendChild(mW);
    }
    if (act.indexOf("button") !== -1) {
      const mB = moduleEl("button", "🔘 Le bouton");
      const bb = document.createElement("div"); bb.className = "big-button";
      const btn = document.createElement("button"); btn.className = "the-button b-" + bomb.button.color; btn.textContent = bomb.button.label;
      btn.onpointerdown = (ev) => { ev.preventDefault(); audio(); localProg.btnDown = Date.now(); };
      btn.onpointerup = () => pressButton(bomb);
      bb.appendChild(btn);
      const hint = document.createElement("div"); hint.className = "button-hint"; hint.textContent = "Appui bref, ou maintien (≥ 1 s) selon le manuel";
      bb.appendChild(hint); mB.querySelector(".m-body").appendChild(bb); wrap.appendChild(mB);
    }
    if (act.indexOf("keypad") !== -1) {
      const mK = moduleEl("keypad", "⌨️ Clavier");
      const kp = document.createElement("div"); kp.className = "keypad";
      bomb.keypad.forEach((si) => { const bt = document.createElement("button"); bt.className = "sym"; bt.dataset.s = si; bt.textContent = SYMBOLS[si]; bt.onclick = () => pressSym(si, bomb, bt); kp.appendChild(bt); });
      mK.querySelector(".m-body").appendChild(kp); wrap.appendChild(mK);
    }
    if (act.indexOf("simon") !== -1) {
      const mS = moduleEl("simon", "🎨 Simon");
      const sim = document.createElement("div"); sim.className = "simon";
      SIMON.forEach((col) => { const pad = document.createElement("button"); pad.className = "simon-pad"; pad.dataset.c = col; pad.style.background = SIMON_HEX[col]; pad.onclick = () => pressSimon(col, bomb, pad); sim.appendChild(pad); });
      mS.querySelector(".m-body").appendChild(sim);
      const sh = document.createElement("div"); sh.className = "button-hint"; sh.textContent = "Regarde la séquence, puis appuie sur les couleurs TRADUITES par le manuel";
      mS.querySelector(".m-body").appendChild(sh); wrap.appendChild(mS);
      startSimon(bomb);
    }
    if (act.indexOf("password") !== -1) {
      localProg.pwSel = [0, 0, 0, 0, 0];
      const mP = moduleEl("password", "🔑 Mot de passe");
      const pw = document.createElement("div"); pw.className = "password";
      bomb.password.cols.forEach((col, i) => { const colEl = document.createElement("div"); colEl.className = "pw-col"; colEl.innerHTML = `<button class="pw-up" data-i="${i}">▲</button><div class="pw-let" data-i="${i}">${col[0]}</div><button class="pw-dn" data-i="${i}">▼</button>`; pw.appendChild(colEl); });
      mP.querySelector(".m-body").appendChild(pw);
      const vb = document.createElement("button"); vb.className = "btn btn-primary pw-validate"; vb.textContent = "Valider le code ✅"; vb.onclick = () => validatePw(bomb);
      mP.querySelector(".m-body").appendChild(vb); wrap.appendChild(mP);
      pw.querySelectorAll(".pw-up").forEach((bt) => (bt.onclick = () => cyclePw(+bt.dataset.i, 1, bomb)));
      pw.querySelectorAll(".pw-dn").forEach((bt) => (bt.onclick = () => cyclePw(+bt.dataset.i, -1, bomb)));
    }
  }
  function cyclePw(i, dir, bomb) {
    if (!isArmed() || (esc.solved && esc.solved.password)) return;
    localProg.pwSel[i] = (localProg.pwSel[i] + dir + 6) % 6;
    const el = $(`#bomb .pw-let[data-i="${i}"]`); if (el) el.textContent = bomb.password.cols[i][localProg.pwSel[i]];
  }
  function validatePw(bomb) {
    if (!isArmed() || (esc.solved && esc.solved.password)) return;
    audio();
    const sel = bomb.password.cols.map((col, i) => col[localProg.pwSel[i]]).join("");
    if (DICT.indexOf(sel) !== -1) { solveModule("password"); toast("Mot de passe : ouvert ✓"); }
    else strike("Mot de passe incorrect ! 💥");
  }
  function moduleEl(id, title) { const m = document.createElement("div"); m.className = "module"; m.dataset.m = id; m.innerHTML = `<div class="m-head"><span class="m-title">${title}</span><span class="m-status"></span></div><div class="m-body"></div>`; return m; }
  function updateBombLocks() {
    activeModules().forEach((id) => {
      const m = $(`.module[data-m="${id}"]`); if (!m) return;
      const solved = esc.solved && esc.solved[id];
      m.classList.toggle("solved", !!solved);
      m.querySelector(".m-status").innerHTML = solved ? '<span class="ok">✓</span>' : "";
      m.querySelector(".m-body").style.pointerEvents = solved || esc.status !== "armed" ? "none" : "";
    });
    if (esc.solved && esc.solved.simon) stopSimon();
  }
  function isArmed() { return esc && esc.status === "armed"; }

  function startSimon(bomb) {
    stopSimon();
    const pads = $$("#bomb .simon-pad"); if (!pads.length) return;
    let k = 0;
    simonTimer = setInterval(() => {
      pads.forEach((p) => p.classList.remove("flash"));
      if (!isArmed() || (esc.solved && esc.solved.simon)) return;
      const col = bomb.simon[k % bomb.simon.length];
      const pad = $(`#bomb .simon-pad[data-c="${col}"]`); if (pad) { pad.classList.add("flash"); }
      k++;
    }, 650);
  }
  function stopSimon() { if (simonTimer) clearInterval(simonTimer); simonTimer = null; }

  function cutWire(i, bomb) {
    if (!isArmed() || (esc.solved && esc.solved.wires) || localProg.cutWires[i]) return;
    audio(); localProg.cutWires[i] = true;
    const w = $(`#bomb .wire[data-i="${i}"]`); if (w) w.classList.add("cut");
    if (i === wireToCut(bomb.wires)) { solveModule("wires"); toast("Fils : bon fil coupé ✓"); }
    else strike("Mauvais fil ! ✂️💥");
  }
  function pressButton(bomb) {
    if (!isArmed() || (esc.solved && esc.solved.button)) return;
    const dt = Date.now() - (localProg.btnDown || Date.now()); localProg.btnDown = 0;
    const action = dt >= 700 ? "hold" : "tap";
    if (action === buttonAction(bomb.button, bomb.edge)) { solveModule("button"); toast("Bouton : parfait ✓"); }
    else strike(action === "hold" ? "Il ne fallait pas maintenir ! 💥" : "Il fallait maintenir ! 💥");
  }
  function pressSym(si, bomb, el) {
    if (!isArmed() || (esc.solved && esc.solved.keypad)) return;
    audio(); const order = keypadOrder(bomb.keypad), pos = localProg.keyPressed.length;
    if (si === order[pos]) { localProg.keyPressed.push(si); el.classList.add("done"); if (localProg.keyPressed.length === 4) { solveModule("keypad"); toast("Clavier : séquence correcte ✓"); } }
    else { localProg.keyPressed = []; $$("#bomb .sym.done").forEach((s) => s.classList.remove("done")); el.classList.add("buzz"); setTimeout(() => el.classList.remove("buzz"), 300); strike("Mauvais symbole ! 💥"); }
  }
  function pressSimon(col, bomb, el) {
    if (!isArmed() || (esc.solved && esc.solved.simon)) return;
    audio(); const need = bomb.simon.map((c) => simonMap(c, bomb.edge.hasVowel)), pos = localProg.simonPressed.length;
    if (col === need[pos]) {
      localProg.simonPressed.push(col); el.classList.add("okflash"); setTimeout(() => el.classList.remove("okflash"), 250);
      if (localProg.simonPressed.length === need.length) { solveModule("simon"); toast("Simon : bien joué ✓"); }
    } else { localProg.simonPressed = []; el.classList.add("buzz"); setTimeout(() => el.classList.remove("buzz"), 300); strike("Simon : mauvaise couleur ! 💥"); }
  }

  async function solveModule(id) {
    esc.solved = esc.solved || {}; esc.solved[id] = true; vibrate(40); sndSolve(); updateBombLocks();
    if (activeModules().every((m) => esc.solved[m])) {
      esc.status = "defused"; esc.score = normScore(esc.score); esc.score.defused++; stopSimon(); sndWin();
    }
    render(); await writeEsc();
  }
  async function strike(msg) {
    esc.strikes = (esc.strikes || 0) + 1; vibrate([30, 40, 30]); sndStrike(); toast(msg, 2600);
    document.body.classList.add("shake-screen"); setTimeout(() => document.body.classList.remove("shake-screen"), 500);
    if (esc.strikes >= 3) { esc.status = "exploded"; esc.score = normScore(esc.score); esc.score.exploded++; stopSimon(); sndBoom(); }
    updateHud(); if (esc.status === "exploded") render();
    await writeEsc();
  }

  /* ---------- Vue Expert : le manuel ---------- */
  function ensureManual() {
    if (builtRound === "manual") return; builtRound = "manual";
    const legend = SYMBOLS.map((s, i) => `<div><div class="s">${s}</div><div class="n">${i + 1}</div></div>`).join("");
    $("#manual").innerHTML = `
      <div class="exp-status" id="exp-status"></div>
      <div class="man-block hi"><h3>🔎 La bombe (demande au démineur)</h3><ul>
        <li><b>N° de série</b> : 4 caractères. « Contient une voyelle ? » (A,E,I,O,U). « Dernier chiffre pair/impair ? »</li>
        <li><b>Piles</b> : combien de 🔋 ?</li>
        <li><b>Indicateur</b> : quel mot (FRK, CAR…) et est-il <b>allumé</b> ?</li>
      </ul></div>
      <div class="man-block"><h3>🔌 Fils — coupe UN fil</h3><ul>
        <li><b>3 fils :</b> aucun rouge → <b>2e</b>. Sinon dernier blanc → <b>dernier</b>. Sinon ≥2 bleus → <b>dernier bleu</b>. Sinon → <b>dernier</b>.</li>
        <li><b>4 fils :</b> ≥2 rouges → <b>dernier rouge</b>. Sinon dernier jaune sans rouge → <b>1er</b>. Sinon exactement 1 bleu → <b>1er</b>. Sinon → <b>dernier</b>.</li>
        <li><b>5 fils :</b> dernier noir → <b>4e</b>. Sinon 1 rouge et &gt;1 jaune → <b>1er</b>. Sinon aucun noir → <b>2e</b>. Sinon → <b>1er</b>.</li>
      </ul></div>
      <div class="man-block"><h3>🔘 Le bouton — appui bref / maintien (≥1 s)</h3><ul>
        <li>≥ 2 piles + « DÉTONER » → <b>appui bref</b>.</li>
        <li>Sinon blanc + indicateur <b>CAR allumé</b> → <b>maintiens</b>.</li>
        <li>Sinon ≥ 3 piles + indicateur <b>FRK allumé</b> → <b>appui bref</b>.</li>
        <li>Sinon bleu → <b>maintiens</b>.</li>
        <li>Sinon « ABANDON » → <b>maintiens</b>.</li>
        <li>Sinon → <b>appui bref</b>.</li>
      </ul></div>
      <div class="man-block"><h3>⌨️ Clavier</h3><ul><li>Appuie sur les 4 symboles dans l'<b>ordre où ils apparaissent ci-dessous</b> (1→12).</li></ul><div class="sym-legend">${legend}</div></div>
      <div class="man-block"><h3>🎨 Simon — traduis chaque couleur</h3><ul>
        <li>Le démineur lit la <b>séquence</b> de couleurs qui clignote. Traduis-la, puis il appuie dans le même ordre.</li>
        <li><b>Si le n° de série contient une voyelle :</b> rouge→<b>bleu</b>, bleu→<b>rouge</b>, vert→<b>jaune</b>, jaune→<b>vert</b>.</li>
        <li><b>Sinon (pas de voyelle) :</b> rouge→<b>jaune</b>, jaune→<b>rouge</b>, bleu→<b>vert</b>, vert→<b>bleu</b>.</li>
      </ul></div>
      <div class="man-block"><h3>🔑 Mot de passe (mode Expert)</h3><ul>
        <li>Demande au démineur les <b>6 lettres de chaque colonne</b> (1→5). Le mot de passe est le <b>seul mot de la liste</b> dont la 1ère lettre est dans la colonne 1, la 2e dans la colonne 2, etc.</li>
      </ul><div class="pw-dict">${DICT.join(" · ")}</div></div>`;
  }
  function updateExpStatus() {
    const el = $("#exp-status"); if (!el) return; const s = esc.solved || {};
    const NAMES = { wires: "🔌 Fils", button: "🔘 Bouton", keypad: "⌨️ Clavier", simon: "🎨 Simon", password: "🔑 Mot de passe" };
    const line = (ok, name) => `<div class="row"><span>${name}</span><span>${ok ? "✅ résolu" : "⏳ en cours"}</span></div>`;
    el.innerHTML = `<div style="font-weight:700;margin-bottom:6px">État de la bombe (${activeModules().length} modules)</div>` +
      activeModules().map((m) => line(s[m], NAMES[m])).join("") +
      `<div class="row" style="border-top:1px solid rgba(148,163,184,.2);margin-top:6px;padding-top:6px"><span>💥 Erreurs</span><span>${esc.strikes || 0} / 3</span></div>`;
  }

  /* ---------- Fin ---------- */
  function maybeEnd() {
    if (endShown === esc.round) return; endShown = esc.round;
    const won = esc.status === "defused", sc = normScore(esc.score);
    $("#end-emoji").textContent = won ? "🎉" : "💥";
    $("#end-title").textContent = won ? "Bombe désamorcée !" : "BOUM 💥";
    $("#end-sub").innerHTML = (won ? "Duo de choc ! Vous communiquez comme des pros. 💜" : "La bombe a explosé… c'est ça, la communication de couple 😅 On retente ?") + `<br><br><strong>🏆 ${sc.defused} · 💥 ${sc.exploded}</strong>`;
    if (won) { confetti(); vibrate([40, 60, 120]); } else { document.body.classList.add("shake-screen"); setTimeout(() => document.body.classList.remove("shake-screen"), 500); }
    $("#end-modal").hidden = false;
  }
  function confetti() { const box = $("#confetti"); box.innerHTML = ""; const cols = ["#7c3aed", "#ec4899", "#fbbf24", "#34d399", "#60a5fa"]; for (let i = 0; i < 40; i++) { const c = document.createElement("i"); c.style.left = Math.random() * 100 + "%"; c.style.background = cols[Math.floor(Math.random() * cols.length)]; c.style.animationDuration = 1.4 + Math.random() * 1.5 + "s"; c.style.animationDelay = Math.random() * .3 + "s"; box.appendChild(c); } }

  /* ---------- Réseau ---------- */
  async function armBomb() {
    audio();
    const score = normScore(esc && esc.score);
    const d = DIFF[chosenDiff] || DIFF.normal;
    const solved = {}; MODULES.slice(0, d.count).forEach((m) => (solved[m] = false));
    esc = { seed: (Math.random() * 4294967296) >>> 0, status: "armed", startedAt: Date.now(), duration: d.dur, count: d.count, strikes: 0, solved, score, round: ((esc && esc.round) || 0) + 1 };
    endShown = -1; builtRound = -1; render();
    try { await writeEsc(); toast("💣 Bombe armée — communiquez !"); } catch (e) { toast("Connexion…"); }
  }
  function rematch() { $("#end-modal").hidden = true; if (role === "dem") armBomb(); else toast("En attente que le démineur relance…"); }
  let writing = false;
  async function writeEsc() { if (!couple.code) return; writing = true; try { await store().put(esc); setDot("ok"); } catch (e) { setDot("error"); toast("Coup non transmis — réessai…"); } writing = false; }

  let lastErr = false;
  function setDot(s) { $("#sync-dot").className = "sync-dot " + s; }
  async function pull() {
    if (!couple.code || !role) { render(); return; }
    if (role === "dem" && writing) return;
    setDot("syncing");
    try {
      const rem = await store().get();
      if (role === "exp" || !esc || !isArmed() || (rem && rem.round >= (esc.round || 0))) esc = rem;
      setDot("ok"); lastErr = false; render();
    } catch (e) { setDot("error"); if (!lastErr) { toast("Synchro indisponible — réessai…"); lastErr = true; } }
  }
  let pollId = null, tickId = null, lastTickSec = -1;
  function startLoops() {
    stopLoops();
    pollId = setInterval(() => { if (document.visibilityState === "visible") pull(); }, 1500);
    tickId = setInterval(() => {
      updateHud();
      const rem = remaining();
      if (role === "dem" && isArmed()) {
        const sec = Math.ceil(rem / 1000);
        if (rem <= 10000 && rem > 0 && sec !== lastTickSec) { lastTickSec = sec; sndTick(); }
        if (rem <= 0) { esc.status = "exploded"; esc.score = normScore(esc.score); esc.score.exploded++; stopSimon(); sndBoom(); writeEsc(); render(); }
      }
    }, 250);
  }
  function stopLoops() { if (pollId) clearInterval(pollId); if (tickId) clearInterval(tickId); pollId = tickId = null; }

  function applyTheme(t) { document.body.classList.toggle("light", t === "light"); $("#btn-theme").textContent = t === "light" ? "☀️" : "🌙"; $('meta[name="theme-color"]').setAttribute("content", t === "light" ? "#eef2fb" : "#0a0e17"); localStorage.setItem("escape.theme", t); }
  function initTheme() { let t = localStorage.getItem("escape.theme"); if (!t) { try { t = JSON.parse(localStorage.getItem("sudoq.v1") || "{}").theme || "dark"; } catch (e) { t = "dark"; } } applyTheme(t); }

  function init() {
    initTheme();
    $("#app-version").textContent = "Désamorçage " + APP_VERSION + " · coopératif temps réel";
    $("#btn-theme").onclick = () => applyTheme(document.body.classList.contains("light") ? "dark" : "light");
    $("#btn-sync").onclick = () => { toast(couple.code ? "Espace : " + String(couple.code).slice(0, 8) + "…" : "Aucun espace"); pull(); };
    document.querySelectorAll("#role .pick").forEach((b) => { b.onclick = () => { audio(); role = b.dataset.role; localStorage.setItem("escape.role", role); builtRound = -1; render(); pull(); startLoops(); }; });
    $("#btn-rematch").onclick = rematch;
    render();
    if (couple.code && role) { pull(); startLoops(); }
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") pull(); });
  }

  window.__escape = { genBomb, wireToCut, buttonAction, keypadOrder, simonMap, SYMBOLS, SIMON, mulberry32 };
  init();
})();
