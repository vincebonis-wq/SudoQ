/* =========================================================================
 * Désamorçage — escape game coopératif asymétrique, temps réel via Firebase.
 * Démineur : voit la bombe. Expert : voit le manuel. Ils doivent se parler.
 * Données : /spaces/<code>/escape   (seul le démineur écrit ce nœud)
 * ========================================================================= */
(function () {
  "use strict";

  const DB = "https://sudoq-b7925-default-rtdb.europe-west1.firebasedatabase.app";
  const APP_VERSION = "v1";
  const DURATION = 300000; // 5 minutes
  const SYMBOLS = ["🌟", "🌀", "🔺", "🟣", "🍀", "🌸", "☢️", "⚡", "✈️", "⚓", "💀", "✂️"];
  const WIRE_COLORS = ["rouge", "bleu", "jaune", "blanc", "noir"];
  const BTN_COLORS = ["rouge", "bleu", "blanc", "jaune"];
  const BTN_LABELS = ["APPUYER", "DÉTONER", "ATTENDRE", "ABANDON"];

  const $ = (s) => document.querySelector(s);

  /* ---------- Couple + rôle ---------- */
  function getCouple() { try { return JSON.parse(localStorage.getItem("couple") || "{}"); } catch (e) { return {}; } }
  let couple = getCouple();
  let role = localStorage.getItem("escape.role"); // 'dem' | 'exp'

  /* ---------- Firebase ---------- */
  function base() { return `${DB}/spaces/${encodeURIComponent(couple.code)}/escape`; }
  async function fbFetch(url, opts, tries) {
    tries = tries || 3; let e;
    for (let i = 0; i < tries; i++) {
      try { const r = await fetch(url, opts); if (r.ok) return r; if (r.status !== 429 && r.status < 500) return r; e = new Error("HTTP " + r.status); }
      catch (x) { e = x; }
      await new Promise((res) => setTimeout(res, 350 * (i + 1)));
    }
    throw e || new Error("réseau");
  }
  window.__FB = {
    async get() { const r = await fbFetch(`${base()}.json?_=${Date.now()}`, { cache: "no-store" }); if (!r.ok) throw new Error("HTTP " + r.status); const t = await r.text(); return !t || t === "null" ? null : JSON.parse(t); },
    async put(d) { const r = await fbFetch(`${base()}.json`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(d) }); if (!r.ok) throw new Error("HTTP " + r.status); },
  };
  const store = () => window.__FB;

  /* ---------- État ---------- */
  let esc = null;            // état distant (bombe)
  let builtRound = -1;       // round pour lequel la vue est construite
  let localProg = null;      // progression locale démineur (fils coupés, clavier)
  let endShown = -1;

  /* ---------- Générateur déterministe ---------- */
  function mulberry32(a) { return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function shuffle(arr, rng) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }
  function genBomb(seed) {
    const rng = mulberry32(seed >>> 0), pick = (a) => a[Math.floor(rng() * a.length)];
    const n = 3 + Math.floor(rng() * 3);
    const wires = []; for (let i = 0; i < n; i++) wires.push(pick(WIRE_COLORS));
    const button = { color: pick(BTN_COLORS), label: pick(BTN_LABELS) };
    const idx = shuffle([...Array(SYMBOLS.length).keys()], rng).slice(0, 4);
    const keypad = shuffle(idx.slice(), rng); // 4 indices, ordre d'affichage
    return { wires, button, keypad };
  }

  /* ---------- Logique de résolution (le manuel doit correspondre !) ---------- */
  function wireToCut(w) {
    const n = w.length, cnt = (c) => w.filter((x) => x === c).length, last = (c) => w.lastIndexOf(c), has = (c) => w.indexOf(c) !== -1;
    if (n === 3) {
      if (!has("rouge")) return 1;
      if (w[2] === "blanc") return 2;
      if (cnt("bleu") >= 2) return last("bleu");
      return 2;
    }
    if (n === 4) {
      if (cnt("rouge") >= 2) return last("rouge");
      if (w[3] === "jaune" && !has("rouge")) return 0;
      if (cnt("bleu") === 1) return 0;
      if (cnt("jaune") >= 2) return 3;
      return 3;
    }
    // n === 5
    if (w[4] === "noir") return 3;
    if (cnt("rouge") === 1 && cnt("jaune") > 1) return 0;
    if (!has("noir")) return 1;
    return 0;
  }
  function buttonAction(b) {
    if (b.color === "bleu" && b.label === "ABANDON") return "hold";
    if (b.label === "DÉTONER") return "tap";
    if (b.color === "blanc") return "hold";
    if (b.color === "rouge" && b.label === "ATTENDRE") return "tap";
    return "hold";
  }
  function keypadOrder(kp) { return kp.slice().sort((a, b) => a - b); }

  /* ---------- Utils UI ---------- */
  let toastTimer = null;
  function toast(msg, ms) { const el = $("#toast"); el.textContent = msg; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.hidden = true), ms || 2200); }
  function vibrate(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} }
  function show(id) { ["gate", "who", "role", "game"].forEach((s) => { $("#" + s).hidden = s !== id; }); }
  function fmtTime(ms) { const s = Math.max(0, Math.ceil(ms / 1000)); return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); }
  function normScore(s) { return { defused: (s && s.defused) || 0, exploded: (s && s.exploded) || 0 }; }
  function remaining() { if (!esc || esc.status !== "armed") return esc && esc.duration || DURATION; return (esc.startedAt + esc.duration) - Date.now(); }

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
      $("#bomb").hidden = true; $("#manual").hidden = true;
      const pre = $("#pre"); pre.hidden = false;
      if (role === "dem") pre.innerHTML = `<div class="wait-note"><span class="em">🧨</span>Prépare-toi… quand l'Expert a le manuel sous les yeux, arme la bombe.</div><button class="btn btn-danger big-cta" id="btn-arm">💣 Armer la bombe (5:00)</button>`;
      else pre.innerHTML = `<div class="wait-note"><span class="em">📖</span>Tu es l'Expert. Garde le manuel prêt — le démineur va armer la bombe.</div>`;
      const arm = $("#btn-arm"); if (arm) arm.onclick = armBomb;
      return;
    }
    $("#pre").hidden = true;
    if (role === "dem") { $("#manual").hidden = true; $("#bomb").hidden = false; ensureBomb(); updateBombLocks(); }
    else { $("#bomb").hidden = true; $("#manual").hidden = false; ensureManual(); updateExpStatus(); }
    if (status === "defused" || status === "exploded") maybeEnd();
  }

  function updateHud() {
    const t = $("#timer"), rem = remaining();
    t.textContent = fmtTime(rem);
    t.className = "timer" + (rem <= 30000 ? " danger" : rem <= 60000 ? " warn" : "");
    const st = $("#strikes"); st.innerHTML = "";
    const strikes = (esc && esc.strikes) || 0;
    for (let i = 0; i < 3; i++) { const x = document.createElement("span"); x.className = "x" + (i < strikes ? " on" : ""); x.textContent = "✖"; st.appendChild(x); }
  }

  /* ---------- Vue Démineur : la bombe ---------- */
  function ensureBomb() {
    if (builtRound === esc.round && $("#bomb").children.length) return;
    builtRound = esc.round;
    localProg = { cutWires: {}, keyPressed: [], btnDown: 0 };
    const bomb = genBomb(esc.seed);
    const wrap = $("#bomb"); wrap.innerHTML = "";

    // Module fils
    const mW = moduleEl("wires", "🔌 Fils");
    const wires = document.createElement("div"); wires.className = "wires";
    bomb.wires.forEach((color, i) => {
      const w = document.createElement("div"); w.className = "wire"; w.dataset.i = i;
      w.innerHTML = `<span class="num">${i + 1}</span><span class="line w-${color}"></span><span class="scis">✂️</span>`;
      w.onclick = () => cutWire(i, bomb);
      wires.appendChild(w);
    });
    mW.querySelector(".m-body").appendChild(wires);
    wrap.appendChild(mW);

    // Module bouton
    const mB = moduleEl("button", "🔘 Le bouton");
    const bb = document.createElement("div"); bb.className = "big-button";
    const btn = document.createElement("button");
    btn.className = "the-button b-" + bomb.button.color; btn.textContent = bomb.button.label;
    btn.onpointerdown = (e) => { e.preventDefault(); localProg.btnDown = Date.now(); };
    btn.onpointerup = () => pressButton(bomb);
    bb.appendChild(btn);
    const hint = document.createElement("div"); hint.className = "button-hint"; hint.textContent = "Appui bref, ou maintien (garde le doigt) selon le manuel";
    bb.appendChild(hint);
    mB.querySelector(".m-body").appendChild(bb);
    wrap.appendChild(mB);

    // Module clavier
    const mK = moduleEl("keypad", "⌨️ Clavier");
    const kp = document.createElement("div"); kp.className = "keypad";
    bomb.keypad.forEach((symIdx) => {
      const b = document.createElement("button"); b.className = "sym"; b.dataset.s = symIdx; b.textContent = SYMBOLS[symIdx];
      b.onclick = () => pressSym(symIdx, bomb, b);
      kp.appendChild(b);
    });
    mK.querySelector(".m-body").appendChild(kp);
    wrap.appendChild(mK);
  }
  function moduleEl(id, title) {
    const m = document.createElement("div"); m.className = "module"; m.dataset.m = id;
    m.innerHTML = `<div class="m-head"><span class="m-title">${title}</span><span class="m-status"></span></div><div class="m-body"></div>`;
    return m;
  }
  function updateBombLocks() {
    ["wires", "button", "keypad"].forEach((id) => {
      const m = $(`.module[data-m="${id}"]`); if (!m) return;
      const solved = esc.solved && esc.solved[id];
      m.classList.toggle("solved", !!solved);
      m.querySelector(".m-status").innerHTML = solved ? '<span class="ok">✓</span>' : "";
      m.querySelector(".m-body").style.pointerEvents = solved || esc.status !== "armed" ? "none" : "";
    });
  }
  function isArmed() { return esc && esc.status === "armed"; }

  function cutWire(i, bomb) {
    if (!isArmed() || (esc.solved && esc.solved.wires) || localProg.cutWires[i]) return;
    localProg.cutWires[i] = true;
    const w = $(`#bomb .wire[data-i="${i}"]`); if (w) w.classList.add("cut");
    if (i === wireToCut(bomb.wires)) { solveModule("wires"); toast("Fils : bon fil coupé ✓ 🔌"); }
    else strike("Mauvais fil ! ✂️💥");
  }
  function pressButton(bomb) {
    if (!isArmed() || (esc.solved && esc.solved.button)) return;
    const dt = Date.now() - (localProg.btnDown || Date.now()); localProg.btnDown = 0;
    const action = dt >= 700 ? "hold" : "tap";
    if (action === buttonAction(bomb.button)) { solveModule("button"); toast("Bouton : parfait ✓ 🔘"); }
    else strike(action === "hold" ? "Il ne fallait pas maintenir ! 💥" : "Il fallait maintenir ! 💥");
  }
  function pressSym(symIdx, bomb, el) {
    if (!isArmed() || (esc.solved && esc.solved.keypad)) return;
    const order = keypadOrder(bomb.keypad), pos = localProg.keyPressed.length;
    if (symIdx === order[pos]) {
      localProg.keyPressed.push(symIdx); el.classList.add("done");
      if (localProg.keyPressed.length === 4) { solveModule("keypad"); toast("Clavier : séquence correcte ✓ ⌨️"); }
    } else {
      localProg.keyPressed = []; $$(".sym.done").forEach((s) => s.classList.remove("done")); el.classList.add("buzz"); setTimeout(() => el.classList.remove("buzz"), 300);
      strike("Mauvais symbole ! ⌨️💥");
    }
  }
  const $$ = (s) => document.querySelectorAll(s);

  async function solveModule(id) {
    esc.solved = esc.solved || {}; esc.solved[id] = true; vibrate(40);
    updateBombLocks();
    if (esc.solved.wires && esc.solved.button && esc.solved.keypad) {
      esc.status = "defused"; esc.score = normScore(esc.score); esc.score.defused++;
    }
    render();
    await writeEsc();
  }
  async function strike(msg) {
    esc.strikes = (esc.strikes || 0) + 1; vibrate([30, 40, 30]); toast(msg, 2600);
    document.body.classList.add("shake-screen"); setTimeout(() => document.body.classList.remove("shake-screen"), 500);
    if (esc.strikes >= 3) { esc.status = "exploded"; esc.score = normScore(esc.score); esc.score.exploded++; }
    updateHud();
    if (esc.status === "exploded") render();
    await writeEsc();
  }

  /* ---------- Vue Expert : le manuel ---------- */
  function ensureManual() {
    if (builtRound === "manual") { return; }
    builtRound = "manual";
    const legend = SYMBOLS.map((s, i) => `<div><div class="s">${s}</div><div class="n">${i + 1}</div></div>`).join("");
    $("#manual").innerHTML = `
      <div class="exp-status" id="exp-status"></div>
      <div class="man-block"><h3>🔌 Fils — coupe UN fil</h3><ul>
        <li><b>3 fils :</b> aucun rouge → coupe le <b>2e</b>. Sinon dernier blanc → <b>dernier</b>. Sinon ≥2 bleus → <b>dernier bleu</b>. Sinon → <b>dernier</b>.</li>
        <li><b>4 fils :</b> ≥2 rouges → <b>dernier rouge</b>. Sinon dernier jaune sans aucun rouge → <b>1er</b>. Sinon exactement 1 bleu → <b>1er</b>. Sinon → <b>dernier</b>.</li>
        <li><b>5 fils :</b> dernier noir → <b>4e</b>. Sinon exactement 1 rouge et plus d'1 jaune → <b>1er</b>. Sinon aucun noir → <b>2e</b>. Sinon → <b>1er</b>.</li>
      </ul></div>
      <div class="man-block"><h3>🔘 Le bouton — appui bref ou maintien</h3><ul>
        <li>Bleu + « ABANDON » → <b>maintiens</b>.</li>
        <li>Sinon « DÉTONER » → <b>appui bref</b>.</li>
        <li>Sinon blanc → <b>maintiens</b>.</li>
        <li>Sinon rouge + « ATTENDRE » → <b>appui bref</b>.</li>
        <li>Sinon → <b>maintiens</b>.</li>
      </ul></div>
      <div class="man-block"><h3>⌨️ Clavier</h3><ul>
        <li>Appuie sur les 4 symboles dans l'<b>ordre où ils apparaissent ci-dessous</b> (de 1 à 12).</li>
      </ul><div class="sym-legend">${legend}</div></div>`;
  }
  function updateExpStatus() {
    const el = $("#exp-status"); if (!el) return;
    const s = esc.solved || {};
    const line = (ok, name) => `<div class="row"><span>${name}</span><span>${ok ? "✅ résolu" : "⏳ en cours"}</span></div>`;
    el.innerHTML = `<div style="font-weight:700;margin-bottom:6px">État de la bombe</div>` +
      line(s.wires, "🔌 Fils") + line(s.button, "🔘 Bouton") + line(s.keypad, "⌨️ Clavier") +
      `<div class="row" style="border-top:1px solid rgba(148,163,184,.2);margin-top:6px;padding-top:6px"><span>💥 Erreurs</span><span>${(esc.strikes || 0)} / 3</span></div>`;
  }

  /* ---------- Fin ---------- */
  function maybeEnd() {
    if (endShown === esc.round) return; endShown = esc.round;
    const won = esc.status === "defused", sc = normScore(esc.score);
    $("#end-emoji").textContent = won ? "🎉" : "💥";
    $("#end-title").textContent = won ? "Bombe désamorcée !" : "BOUM 💥";
    $("#end-sub").innerHTML = (won ? "Bien joué, équipe de choc ! Vous formez un duo redoutable. 💜" : "La bombe a explosé… c'est le jeu de la communication. On retente&nbsp;?") +
      `<br><br><strong>🏆 ${sc.defused} désamorçée(s) · 💥 ${sc.exploded} explosion(s)</strong>`;
    if (won) { confetti(); vibrate([40, 60, 120]); } else { document.body.classList.add("shake-screen"); setTimeout(() => document.body.classList.remove("shake-screen"), 500); }
    $("#end-modal").hidden = false;
  }
  function confetti() { const box = $("#confetti"); box.innerHTML = ""; const cols = ["#7c3aed", "#ec4899", "#fbbf24", "#34d399", "#60a5fa"]; for (let i = 0; i < 40; i++) { const c = document.createElement("i"); c.style.left = Math.random() * 100 + "%"; c.style.background = cols[Math.floor(Math.random() * cols.length)]; c.style.animationDuration = 1.4 + Math.random() * 1.5 + "s"; c.style.animationDelay = Math.random() * .3 + "s"; box.appendChild(c); } }

  /* ---------- Actions réseau ---------- */
  async function armBomb() {
    const score = normScore(esc && esc.score);
    esc = { seed: (Math.random() * 4294967296) >>> 0, status: "armed", startedAt: Date.now(), duration: DURATION, strikes: 0, solved: { wires: false, button: false, keypad: false }, score, round: ((esc && esc.round) || 0) + 1 };
    endShown = -1; builtRound = -1;
    render();
    try { await writeEsc(); toast("💣 Bombe armée — go go go !"); } catch (e) { toast("Connexion…"); }
  }
  async function rematch() {
    // même logique qu'armer, mais le démineur relance ; on garde le score
    $("#end-modal").hidden = true;
    if (role === "dem") armBomb();
    else { toast("En attente que le démineur relance…"); }
  }
  let writing = false;
  async function writeEsc() {
    if (!couple.code) return;
    writing = true;
    try { await store().put(esc); setDot("ok"); } catch (e) { setDot("error"); toast("Coup non transmis — réessai…"); }
    writing = false;
  }

  /* ---------- Synchro ---------- */
  let lastErr = false;
  function setDot(s) { $("#sync-dot").className = "sync-dot " + s; }
  async function pull() {
    if (!couple.code || !role) { render(); return; }
    if (role === "dem" && writing) return; // ne pas écraser une écriture en cours
    setDot("syncing");
    try {
      const rem = await store().get();
      // Le démineur est la source de vérité : il ne se laisse pas écraser en plein jeu.
      if (role === "exp" || !esc || !isArmed() || (rem && rem.round >= (esc.round || 0))) esc = rem;
      setDot("ok"); lastErr = false; render();
    } catch (e) { setDot("error"); if (!lastErr) { toast("Synchro indisponible — réessai…"); lastErr = true; } }
  }
  let pollId = null, tickId = null;
  function startLoops() {
    stopLoops();
    pollId = setInterval(() => { if (document.visibilityState === "visible") pull(); }, 1500);
    tickId = setInterval(() => {
      updateHud();
      if (role === "dem" && isArmed() && remaining() <= 0) {
        esc.status = "exploded"; esc.score = normScore(esc.score); esc.score.exploded++; writeEsc(); render();
      }
    }, 1000);
  }
  function stopLoops() { if (pollId) clearInterval(pollId); if (tickId) clearInterval(tickId); pollId = tickId = null; }

  /* ---------- Thème ---------- */
  function applyTheme(t) { document.body.classList.toggle("light", t === "light"); $("#btn-theme").textContent = t === "light" ? "☀️" : "🌙"; $('meta[name="theme-color"]').setAttribute("content", t === "light" ? "#eef2fb" : "#0a0e17"); localStorage.setItem("escape.theme", t); }
  function initTheme() { let t = localStorage.getItem("escape.theme"); if (!t) { try { t = JSON.parse(localStorage.getItem("sudoq.v1") || "{}").theme || "dark"; } catch (e) { t = "dark"; } } applyTheme(t); }

  /* ---------- Init ---------- */
  function init() {
    initTheme();
    $("#app-version").textContent = "Désamorçage " + APP_VERSION + " · coopératif temps réel";
    $("#btn-theme").onclick = () => applyTheme(document.body.classList.contains("light") ? "dark" : "light");
    $("#btn-sync").onclick = () => { toast(couple.code ? "Espace : " + String(couple.code).slice(0, 8) + "…" : "Aucun espace de couple"); pull(); };
    document.querySelectorAll("#role .pick").forEach((b) => { b.onclick = () => { role = b.dataset.role; localStorage.setItem("escape.role", role); builtRound = -1; render(); pull(); startLoops(); }; });
    $("#btn-rematch").onclick = rematch;
    render();
    if (couple.code && role) { pull(); startLoops(); }
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") pull(); });
  }

  window.__escape = { genBomb, wireToCut, buttonAction, keypadOrder, SYMBOLS, mulberry32 };
  init();
})();
