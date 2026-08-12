/* =========================================================================
 * Ligue de couple — agrège les scores de tous les jeux (lecture seule).
 * Lit /spaces/<code> (records SudoQ, navale.scores, escape.score, capsules).
 * ========================================================================= */
(function () {
  "use strict";

  const DB = "https://sudoq-b7925-default-rtdb.europe-west1.firebasedatabase.app";
  const APP_VERSION = "v1";
  const $ = (s) => document.querySelector(s);
  const AV = ["#7c3aed", "#ec4899"];

  function getCouple() { try { return JSON.parse(localStorage.getItem("couple") || "{}"); } catch (e) { return {}; } }
  let couple = getCouple();

  async function fbFetch(url, opts, tries) {
    tries = tries || 3; let e;
    for (let i = 0; i < tries; i++) { try { const r = await fetch(url, opts); if (r.ok) return r; if (r.status !== 429 && r.status < 500) return r; e = new Error("HTTP " + r.status); } catch (x) { e = x; } await new Promise((res) => setTimeout(res, 350 * (i + 1))); }
    throw e || new Error("réseau");
  }
  window.__FB = { async getSpace() { const r = await fbFetch(`${DB}/spaces/${encodeURIComponent(couple.code)}.json?_=${Date.now()}`, { cache: "no-store" }); if (!r.ok) throw new Error("HTTP " + r.status); const t = await r.text(); return !t || t === "null" ? {} : JSON.parse(t); } };
  const store = () => window.__FB;

  let space = {};

  function names() { const p = (space && space.players) || couple.players; return p && p.length === 2 ? p : ["Joueur 1", "Joueur 2"]; }
  function initials(n) { return (n || "?").trim().charAt(0).toUpperCase() || "?"; }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  let toastTimer = null;
  function toast(m) { const e = $("#toast"); e.textContent = m; e.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (e.hidden = true), 2200); }
  function normScores(s) { return { 0: (s && s[0]) || 0, 1: (s && s[1]) || 0 }; }
  function recTime(records, lvl, i) { const r = records && records[lvl]; return r == null ? null : (r[i] == null ? null : r[i]); }

  /* ---------- Calcul des points ---------- */
  function compute() {
    const records = space.records || {};
    const nav = normScores(space.navale && space.navale.scores);
    const defused = (space.escape && space.escape.score && space.escape.score.defused) || 0;
    const capsCount = space.capsules ? Object.keys(space.capsules).length : 0;

    let sudoqWins = [0, 0], completed = [0, 0];
    for (let l = 0; l < 15; l++) {
      const t0 = recTime(records, l, 0), t1 = recTime(records, l, 1);
      if (t0 != null) completed[0]++;
      if (t1 != null) completed[1]++;
      if (t0 != null && t1 != null) { if (t0 < t1) sudoqWins[0]++; else if (t1 < t0) sudoqWins[1]++; else { sudoqWins[0]++; sudoqWins[1]++; } }
    }
    const sudoqPts = [sudoqWins[0] * 3 + completed[0], sudoqWins[1] * 3 + completed[1]];
    const navPts = [nav[0] * 5, nav[1] * 5];
    const escPts = defused * 3; // coopératif : les deux
    const total = [sudoqPts[0] + navPts[0] + escPts, sudoqPts[1] + navPts[1] + escPts];

    return { total, sudoqPts, navPts, escPts, sudoqWins, completed, nav, defused, capsCount, exploded: (space.escape && space.escape.score && space.escape.score.exploded) || 0 };
  }

  /* ---------- Rendu ---------- */
  function render() {
    couple = getCouple();
    if (!couple.code) { $("#gate").hidden = false; $("#main").hidden = true; return; }
    $("#gate").hidden = true; $("#main").hidden = false;
    const s = compute(), nm = names();

    // Duel
    const leader = s.total[0] === s.total[1] ? -1 : s.total[0] > s.total[1] ? 0 : 1;
    $("#duel").innerHTML =
      `<div class="player ${leader === 0 ? "leader" : ""}"><div class="crown">👑</div><div class="av" style="background:${AV[0]}">${escapeHtml(initials(nm[0]))}</div><div class="pname">${escapeHtml(nm[0])}</div><div class="ppts">${s.total[0]}</div><div class="plabel">points</div></div>` +
      `<div class="vs">VS</div>` +
      `<div class="player ${leader === 1 ? "leader" : ""}"><div class="crown">👑</div><div class="av" style="background:${AV[1]}">${escapeHtml(initials(nm[1]))}</div><div class="pname">${escapeHtml(nm[1])}</div><div class="ppts">${s.total[1]}</div><div class="plabel">points</div></div>`;
    const diff = Math.abs(s.total[0] - s.total[1]);
    $("#verdict").innerHTML = leader === -1 ? "🤝 Parfaite égalité !" : `👑 <b>${escapeHtml(nm[leader])}</b> mène de <b>${diff}</b> point${diff > 1 ? "s" : ""} !`;

    // Détail par jeu
    $("#breakdown").innerHTML =
      `<div class="brow bhead"><span class="g">Jeu</span><span class="v">${escapeHtml(nm[0])}</span><span class="v">${escapeHtml(nm[1])}</span></div>` +
      brow("🧩", "SudoQ", `${s.completed[0]}/${s.completed[1]} niveaux · ${s.sudoqWins[0]}/${s.sudoqWins[1]} duels`, s.sudoqPts[0], s.sudoqPts[1]) +
      brow("🚢", "Bataille navale", `${s.nav[0]} – ${s.nav[1]} manches`, s.navPts[0], s.navPts[1]) +
      brow("💣", "Désamorçage", `${s.defused} bombe(s) — coopératif`, s.escPts, s.escPts);

    // Niveau couple
    const xp = s.total[0] + s.total[1];
    const per = 40, lvl = Math.floor(xp / per) + 1, into = xp % per;
    $("#couple-lvl").innerHTML =
      `<div class="lv">Niveau ${lvl} 💞</div><div class="sub">${xp} points de couple cumulés</div>` +
      `<div class="bar"><i style="width:${Math.round((into / per) * 100)}%"></i></div>` +
      `<div class="bar-label">${into} / ${per} vers le niveau ${lvl + 1}</div>`;

    // Trophées
    renderTrophies(s, lvl);

    // Défi du jour
    renderDaily();
  }
  function brow(ico, name, sub, p0, p1) {
    return `<div class="brow"><span class="g">${ico} ${name}<small>${sub}</small></span><span class="v p0">${p0}</span><span class="v p1">${p1}</span></div>`;
  }

  const TROPHIES = [
    { ico: "🥇", n: "Premier point", d: "1er record SudoQ", ok: (s) => s.completed[0] + s.completed[1] >= 1 },
    { ico: "🚢", n: "Amiral", d: "1 manche navale gagnée", ok: (s) => s.nav[0] + s.nav[1] >= 1 },
    { ico: "💣", n: "Démineur", d: "1 bombe désamorçée", ok: (s) => s.defused >= 1 },
    { ico: "⚡", n: "Éclair", d: "5 records SudoQ", ok: (s) => Math.max(s.completed[0], s.completed[1]) >= 5 },
    { ico: "🔥", n: "Invaincu", d: "5 manches navale", ok: (s) => Math.max(s.nav[0], s.nav[1]) >= 5 },
    { ico: "🤝", n: "Duo de choc", d: "5 bombes désamorçées", ok: (s) => s.defused >= 5 },
    { ico: "🧩", n: "Marathonien", d: "les 15 niveaux finis", ok: (s) => Math.max(s.completed[0], s.completed[1]) >= 15 },
    { ico: "💌", n: "Sentimental", d: "1 capsule scellée", ok: (s) => s.capsCount >= 1 },
    { ico: "👑", n: "Légende", d: "niveau couple 10", ok: (s, lvl) => lvl >= 10 },
  ];
  function renderTrophies(s, lvl) {
    $("#trophies").innerHTML = TROPHIES.map((t) => {
      const on = t.ok(s, lvl);
      return `<div class="trophy ${on ? "on" : ""}"><div class="ico">${on ? t.ico : "🔒"}</div><div class="tn">${t.n}</div><div class="td">${t.d}</div></div>`;
    }).join("");
  }

  const DAILY = [
    { t: "Le perdant fait la vaisselle 🍽️", g: "Bataille navale" },
    { t: "Battez votre record commun de désamorçage 💣", g: "Désamorçage" },
    { t: "Le plus rapide sur un niveau Difficile choisit le film 🎬", g: "SudoQ" },
    { t: "Écrivez-vous une capsule à ouvrir dans 1 an 💌", g: "Capsules" },
    { t: "Best of 3 à la bataille navale — l'enjeu : un massage 💆", g: "Bataille navale" },
    { t: "Désamorcez une bombe en moins de 3 minutes ⏱️", g: "Désamorçage" },
    { t: "Duel SudoQ niveau 8 — le perdant prépare le petit-déj ☕", g: "SudoQ" },
    { t: "3 manches de bataille navale, ça se joue ce soir 🌙", g: "Bataille navale" },
  ];
  function renderDaily() {
    const d = new Date();
    const dayNum = d.getFullYear() * 372 + d.getMonth() * 31 + d.getDate();
    const c = DAILY[dayNum % DAILY.length];
    $("#daily").innerHTML = `<div class="dl">Défi du jour</div><div class="dt">${c.t}</div><div class="dgame">🎮 ${c.g}</div>`;
  }

  /* ---------- Synchro (lecture) ---------- */
  let lastErr = false;
  function setDot(x) { $("#sync-dot").className = "sync-dot " + x; }
  async function pull() {
    couple = getCouple();
    if (!couple.code) { render(); return; }
    setDot("syncing");
    try { space = await store().getSpace(); setDot("ok"); lastErr = false; render(); }
    catch (e) { setDot("error"); if (!lastErr) { toast("Synchro indisponible — réessai…"); lastErr = true; } }
  }
  let pollId = null;
  function startPolling() { if (pollId) clearInterval(pollId); pollId = setInterval(() => { if (document.visibilityState === "visible") pull(); }, 10000); }

  function applyTheme(t) { document.body.classList.toggle("light", t === "light"); $("#btn-theme").textContent = t === "light" ? "☀️" : "🌙"; $('meta[name="theme-color"]').setAttribute("content", t === "light" ? "#eef2fb" : "#0d1220"); localStorage.setItem("ligue.theme", t); }
  function initTheme() { let t = localStorage.getItem("ligue.theme"); if (!t) { try { t = JSON.parse(localStorage.getItem("sudoq.v1") || "{}").theme || "dark"; } catch (e) { t = "dark"; } } applyTheme(t); }

  function init() {
    initTheme();
    $("#app-version").textContent = "Ligue " + APP_VERSION;
    $("#btn-theme").onclick = () => applyTheme(document.body.classList.contains("light") ? "dark" : "light");
    $("#btn-sync").onclick = () => { toast("Actualisation…"); pull(); };
    render();
    if (couple.code) { pull(); startPolling(); }
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") pull(); });
  }

  window.__ligue = { compute: () => compute() };
  init();
})();
