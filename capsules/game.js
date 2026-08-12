/* =========================================================================
 * Capsules temporelles — messages scellés jusqu'à une date future.
 * Données : /spaces/<code>/capsules/<id>  (chacun peut créer/supprimer les siennes)
 * ========================================================================= */
(function () {
  "use strict";

  const DB = "https://sudoq-b7925-default-rtdb.europe-west1.firebasedatabase.app";
  const APP_VERSION = "v1";
  const $ = (s) => document.querySelector(s);

  function getCouple() { try { return JSON.parse(localStorage.getItem("couple") || "{}"); } catch (e) { return {}; } }
  let couple = getCouple();
  let me = localStorage.getItem("capsules.me");
  me = me === null ? null : parseInt(me, 10);
  let formTo = "nous";

  function base() { return `${DB}/spaces/${encodeURIComponent(couple.code)}/capsules`; }
  async function fbFetch(url, opts, tries) {
    tries = tries || 3; let e;
    for (let i = 0; i < tries; i++) {
      try { const r = await fetch(url, opts); if (r.ok) return r; if (r.status !== 429 && r.status < 500) return r; e = new Error("HTTP " + r.status); }
      catch (x) { e = x; } await new Promise((res) => setTimeout(res, 350 * (i + 1)));
    }
    throw e || new Error("réseau");
  }
  window.__FB = {
    async getAll() { const r = await fbFetch(`${base()}.json?_=${Date.now()}`, { cache: "no-store" }); if (!r.ok) throw new Error("HTTP " + r.status); const t = await r.text(); return !t || t === "null" ? {} : JSON.parse(t); },
    async put(id, cap) { const r = await fbFetch(`${base()}/${id}.json`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cap) }); if (!r.ok) throw new Error("HTTP " + r.status); },
    async del(id) { const r = await fbFetch(`${base()}/${id}.json`, { method: "DELETE" }); if (!r.ok) throw new Error("HTTP " + r.status); },
  };
  const store = () => window.__FB;

  let caps = {};
  let seenReady = new Set();

  function names() { return couple.players && couple.players.length === 2 ? couple.players : ["Joueur 1", "Joueur 2"]; }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  let toastTimer = null;
  function toast(m, ms) { const e = $("#toast"); e.textContent = m; e.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (e.hidden = true), ms || 2400); }
  function show(id) { ["gate", "who", "main"].forEach((s) => { $("#" + s).hidden = s !== id; }); }

  function fmtDate(ms) { const d = new Date(ms); return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }); }
  function untilText(ms) {
    const now = Date.now(), diff = ms - now;
    if (diff <= 0) return "";
    const days = Math.ceil(diff / 86400000);
    if (days <= 1) return "demain";
    if (days < 31) return "dans " + days + " jours";
    const months = Math.round(days / 30);
    if (months < 12) return "dans " + months + " mois";
    const years = Math.floor(days / 365);
    const remM = Math.round((days % 365) / 30);
    return "dans " + years + " an" + (years > 1 ? "s" : "") + (remM ? " et " + remM + " mois" : "");
  }

  function renderWho() {
    const wrap = $("#who-btns"); wrap.innerHTML = "";
    const em = ["🧑", "👩"];
    names().forEach((n, i) => {
      const b = document.createElement("button"); b.className = "btn btn-primary"; b.textContent = em[i] + " " + n;
      b.onclick = () => { me = i; localStorage.setItem("capsules.me", String(i)); render(); pull(); };
      wrap.appendChild(b);
    });
  }

  function render() {
    couple = getCouple();
    if (!couple.code) { show("gate"); return; }
    if (me === null) { show("who"); renderWho(); return; }
    show("main");
    renderCaps();
  }

  function renderCaps() {
    const list = Object.keys(caps || {}).map((id) => Object.assign({ id }, caps[id])).filter((c) => c && c.openAt);
    const now = Date.now();
    const ready = list.filter((c) => now >= c.openAt).sort((a, b) => b.openAt - a.openAt);
    const locked = list.filter((c) => now < c.openAt).sort((a, b) => a.openAt - b.openAt);
    const el = $("#caps"); el.innerHTML = "";
    if (!list.length) {
      el.innerHTML = `<div class="empty"><span class="em">💌</span>Aucune capsule pour l'instant.<br>Écris la première à ouvrir dans 1 mois, 1 an… ou le jour de votre anniversaire !</div>`;
      return;
    }
    locked.forEach((c) => el.appendChild(capCard(c, false)));
    ready.forEach((c) => el.appendChild(capCard(c, true)));
  }

  function capCard(c, isReady) {
    const nm = names()[c.from] || "?";
    const toTxt = c.to === "other" ? "💌 pour " + (names()[1 - c.from] || "l'autre") : "💞 pour vous deux";
    const div = document.createElement("div");
    div.className = "cap " + (isReady ? "ready" : "locked");
    if (isReady) {
      div.innerHTML =
        `<div class="cap-top"><span class="cap-lock">🔓</span><span class="cap-meta">de <b>${escapeHtml(nm)}</b> · ${toTxt}</span></div>` +
        (c.title ? `<div class="cap-title">${escapeHtml(c.title)}</div>` : "") +
        `<div class="cap-msg">${escapeHtml(c.msg || "")}</div>` +
        `<div class="cap-foot"><span class="cap-meta">Scellée le ${fmtDate(c.createdAt)}</span>${c.from === me ? '<button class="cap-del" title="Supprimer">🗑</button>' : ""}</div>`;
    } else {
      div.innerHTML =
        `<div class="cap-top"><span class="cap-lock">🔒</span><span class="cap-meta">de <b>${escapeHtml(nm)}</b> · ${toTxt}</span></div>` +
        `<div class="cap-when">S'ouvre le <b>${fmtDate(c.openAt)}</b> · ${untilText(c.openAt)}</div>` +
        (c.from === me ? `<div class="cap-foot"><span class="cap-meta">Scellée (tu ne peux plus la lire avant l'heure 😇)</span><button class="cap-del" title="Supprimer">🗑</button></div>` : `<div class="cap-foot"><span class="cap-meta">Surprise en approche… 👀</span></div>`);
    }
    const del = div.querySelector(".cap-del");
    if (del) del.onclick = () => removeCap(c.id);
    return div;
  }

  async function sealCapsule() {
    const title = $("#c-title").value.trim();
    const msg = $("#c-msg").value.trim();
    const dateVal = $("#c-date").value;
    if (!msg) { toast("Écris un petit message 💌"); return; }
    if (!dateVal) { toast("Choisis une date d'ouverture"); return; }
    const openAt = new Date(dateVal + "T00:00:00").getTime();
    if (openAt <= Date.now()) { toast("Choisis une date dans le futur ⏳"); return; }
    const id = "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const cap = { from: me, to: formTo, title, msg, createdAt: Date.now(), openAt };
    caps[id] = cap; renderCaps();
    $("#form").hidden = true; $("#c-title").value = ""; $("#c-msg").value = "";
    try { await store().put(id, cap); toast("Capsule scellée 🔒 rendez-vous le " + fmtDate(openAt)); } catch (e) { toast("Connexion… (gardée localement)"); }
    pull();
  }
  async function removeCap(id) {
    if (!confirm("Supprimer définitivement cette capsule ?")) return;
    delete caps[id]; renderCaps();
    try { await store().del(id); toast("Capsule supprimée"); } catch (e) { toast("Connexion…"); }
  }

  /* Synchro */
  let lastErr = false;
  function setDot(s) { $("#sync-dot").className = "sync-dot " + s; }
  async function pull() {
    if (!couple.code || me === null) { render(); return; }
    setDot("syncing");
    try {
      const now = Date.now();
      // détecter les nouvelles ouvertures
      const before = new Set(Object.keys(caps || {}).filter((id) => caps[id] && now >= caps[id].openAt));
      caps = await store().getAll();
      const after = Object.keys(caps || {}).filter((id) => caps[id] && now >= caps[id].openAt);
      after.forEach((id) => { if (!before.has(id) && !seenReady.has(id)) { seenReady.add(id); if (before.size || seenReady.size > 1) toast("💌 Une capsule vient de s'ouvrir !", 3500); } });
      after.forEach((id) => seenReady.add(id));
      setDot("ok"); lastErr = false; render();
    } catch (e) { setDot("error"); if (!lastErr) { toast("Synchro indisponible — réessai…"); lastErr = true; } }
  }
  let pollId = null;
  function startPolling() { if (pollId) clearInterval(pollId); pollId = setInterval(() => { if (document.visibilityState === "visible") pull(); }, 6000); }

  function applyTheme(t) { document.body.classList.toggle("light", t === "light"); $("#btn-theme").textContent = t === "light" ? "☀️" : "🌙"; $('meta[name="theme-color"]').setAttribute("content", t === "light" ? "#fdf2f8" : "#140a1f"); localStorage.setItem("capsules.theme", t); }
  function initTheme() { let t = localStorage.getItem("capsules.theme"); if (!t) { try { t = JSON.parse(localStorage.getItem("sudoq.v1") || "{}").theme || "dark"; } catch (e) { t = "dark"; } } applyTheme(t); }

  function init() {
    initTheme();
    $("#app-version").textContent = "Capsules " + APP_VERSION;
    $("#btn-theme").onclick = () => applyTheme(document.body.classList.contains("light") ? "dark" : "light");
    $("#btn-sync").onclick = () => { toast(couple.code ? "Espace : " + String(couple.code).slice(0, 8) + "…" : "Aucun espace"); pull(); };
    $("#btn-new").onclick = () => { const f = $("#form"); f.hidden = !f.hidden; if (!f.hidden) { const d = new Date(Date.now() + 86400000); $("#c-date").min = d.toISOString().slice(0, 10); } };
    $("#btn-cancel").onclick = () => { $("#form").hidden = true; };
    $("#btn-seal").onclick = sealCapsule;
    document.querySelectorAll("#seg-to button").forEach((b) => { b.onclick = () => { formTo = b.dataset.to; document.querySelectorAll("#seg-to button").forEach((x) => x.classList.toggle("on", x === b)); }; });
    render();
    if (couple.code && me !== null) { pull(); startPolling(); }
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") pull(); });
  }

  window.__caps = { untilText };
  init();
})();
