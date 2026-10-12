/* Rendering. Everything here reads state and writes DOM; nothing saves.
   Panels are built as strings and written only when they change (setHtml),
   so a 6-second poll with no news costs almost nothing. */

import * as C from "./config.js";
import { S, personalGoal, capFor, totalOn, metGoal, pastCap, atCap, dayScoreFor, streaks,
         standingsFor, winnerOf, orderedBy, activeParticipants, isActive, findParticipant,
         currentGoal, currentGoalFor, currentAnnualGoal, currentIdleMax, goalTunables, legacyFlat,
         challengeStart, challengeEnd, yearElapsed, teamYearTotal, yearTargets, seasonStats,
         recentDays, topOf, dayRec, dayLeaders, dayResult, wonDay, satOut, tokensEarned,
         duplicateNames, isAway, openAwaySince, goalForDate } from "./model.js";
import { petKindFor, ownsEquipped, graveEquipped, petHueFor, isGrave, gravesOf, petsOwned,
         graveLine, petLabel, petName, petRarityOf, petBinIndex, petGridOrder, penFound,
         hashHue } from "./pets.js";
import { crownSvg, jesterSvg, hatSvg, drawPortrait, drawCritter, drawHeadstone, drawGoldPile } from "./art.js";
import * as G from "./glass.js";
import { diag, dir } from "./store.js";
import { $, esc, fmt, fmtOz, fmtGal, todayKey, dateKey, prettyTime, clockStamp, has } from "./util.js";

export const ui = { tab: "today", amount: C.DEFAULT_AMOUNT, connected: false, lastSync: "" };

/* ---- DOM helpers -------------------------------------------------------- */
const htmlCache = {};
function setHtml(id, html) {
  if (htmlCache[id] === html) return false;
  const el = $(id);
  if (!el) return false;
  el.innerHTML = html;
  htmlCache[id] = html;
  return true;
}
function setEl(id, html, cls) {
  const el = $(id);
  if (!el) return;
  if (html !== null && el.innerHTML !== html) el.innerHTML = html;
  if (cls !== null && el.className !== cls) el.className = cls;
}
function setTitle(id, t) { const el = $(id); if (el && el.title !== t) el.title = t; }
function show(id, on) { const el = $(id); if (el) el.hidden = !on; }
const ja = s => esc(s);        /* attribute-safe name for data-* */

export function setMsg(text, good) {
  const el = $("msg");
  el.textContent = text;
  el.className = "status-message" + (good ? " ok" : "");
  el.classList.remove("flash");
  void el.offsetWidth;
  if (text) el.classList.add("flash");
}

export function showBanner(text) {
  const b = $("banner");
  b.textContent = text;
  b.hidden = !text;
}

/* ---- masks: past the cap, your own figure is unreadable ----------------- */
let maskEls = [];
function maskSeed(id, len) {
  let h = 5381, out = "";
  for (let i = 0; i < id.length; i++) h = ((h * 33) + id.charCodeAt(i)) % 100003;
  for (let i = 0; i < len; i++) { h = (h * 131 + 7) % 100003; out += C.MASK_POOL.charAt(h % C.MASK_POOL.length); }
  return out;
}
function maskSpan(id, real) {
  const len = Math.max(2, String(real).length);
  maskEls.push({ id, len });
  return '<span class="oz-mask' + (C.MASK_STYLE === "symbols" ? " symbols" : "") + '" id="' + id + '">' +
         maskSeed(id, len) + '</span>';
}
const maskChar = () => C.MASK_POOL.charAt(Math.floor(Math.random() * C.MASK_POOL.length));
export function tickMasks() {
  for (const m of maskEls) {
    const el = $(m.id);
    if (!el) continue;
    let chars = el.textContent.split("");
    if (chars.length !== m.len) chars = Array.from({ length: m.len }, maskChar);
    for (let j = 0; j < chars.length; j++) if (Math.random() < C.MASK_CHURN) chars[j] = maskChar();
    el.textContent = chars.join("");
  }
}

/* ---- streak pips -------------------------------------------------------- */
function streakPips(s, brief) {
  const bits = [];
  if (s.win > 0) bits.push(brief ? '<span class="pip pip-win">' + s.win + 'W</span>'
                                  : '<span class="tone-win">' + s.win + ' win streak</span>');
  if (s.goal > 0) bits.push(brief ? '<span class="pip pip-goal">' + s.goal + 'G</span>'
                                   : '<span class="tone-goal">' + s.goal + ' goal streak</span>');
  if (!bits.length) return brief ? "" : '<span class="none">no streak yet</span>';
  return bits.join(brief ? "" : "<br>");
}

/* ---- chips -------------------------------------------------------------- */
export function renderChips() {
  setHtml("chips", C.QUICK_SIZES.map(oz =>
    '<button type="button" class="chip' + (oz === ui.amount ? " active" : "") + '" data-oz="' + oz + '">' +
    fmt(oz) + '</button>').join(""));
}

/* ---- glasses ------------------------------------------------------------ */
let ordered = [], renderedSig = "";

function wrapWidth() {
  const el = $("glasses");
  const w = el ? el.clientWidth : 0;
  return Math.max(240, Math.min(C.WRAP_MAX, w || (document.body.clientWidth - C.SHELL_PAD * 2)));
}

export function relayout() {
  if (G.applyTier(G.pickTier(activeParticipants().length, wrapWidth()))) { renderedSig = ""; return true; }
  return false;
}

function buildGlasses() {
  const T = C.CARD_TIERS[Math.max(0, G.dims.tier)];
  const rTop = Math.round(T.gw * 0.106), rBot = Math.round(T.gw * 0.212);
  const radius = rTop + "px " + rTop + "px " + rBot + "px " + rBot + "px";
  const compact = T.card < C.COMPACT_UNDER;
  const h = [];
  ordered.forEach((p, i) => {
    const n = ja(p.name);
    h.push('<div class="participant-card' + (compact ? " compact" : "") + '" style="width:' + T.card + 'px" data-name="' + n + '">');
    h.push('<button type="button" class="trash-button" title="Remove ' + n + '" data-act="remove">&times;</button>');
    h.push('<div class="crown-wrap" id="cr_' + i + '">' + crownSvg(26, 17, "crown") + '</div>');
    h.push('<div class="gwrap" style="width:' + T.gw + 'px;height:' + T.gh + 'px" title="' + n + '&rsquo;s gold" data-act="bank">');
    h.push('<div class="halo" id="ha_' + i + '" style="border-radius:' + radius + '"></div>');
    h.push('<div class="glass" id="gl_' + i + '" style="width:' + T.gw + 'px;height:' + T.gh + 'px;border-radius:' + radius + '">');
    h.push('<canvas id="cv_' + i + '"></canvas>');
    h.push('<div class="overflow-glow" id="go_' + i + '" hidden></div>');
    const sk = Math.round(T.gw * 0.56);
    h.push('<img class="skull" id="sku_' + i + '" src="img/skull.png" alt="past the cap" hidden ' +
           'style="width:' + sk + 'px;height:' + sk + 'px;margin-left:-' + (sk / 2) + 'px;margin-top:-' + (sk / 2) + 'px">');
    h.push('<div class="shine"></div></div>');
    h.push('<canvas class="duckc" id="dc_' + i + '" style="top:-' + G.dims.head + 'px"></canvas>');
    h.push('</div>');
    h.push('<h2 class="pick" title="Click to change colour" data-act="swatches">' + esc(p.name) + '</h2>');
    h.push('<p class="sub" id="sb_' + i + '">&nbsp;</p>');
    h.push('<p class="streak pick" id="sk_' + i + '" title="Click for a day-by-day breakdown" data-act="audit">&nbsp;</p>');
    h.push('<div class="swatches" id="sw_' + i + '" hidden>');
    for (const col of C.PARTICIPANT_COLORS) {
      h.push('<span class="swatch' + (String(p.color).toLowerCase() === col ? " on" : "") +
             '" style="background:' + col + '" title="' + col + '" data-act="color" data-color="' + col + '"></span>');
    }
    h.push('</div></div>');
  });
  $("glasses").innerHTML = h.join("");
  G.unbindAll();
  ordered.forEach((p, i) => {
    G.bindCanvases(p.name, $("cv_" + i), $("dc_" + i), T.gw, T.gh);
    G.animState(p.name).hatIs = "";
  });
  G.startAnim();
}

function renderGlasses() {
  ordered = orderedBy(C.CARD_ORDER);
  relayout();
  if (!S.participants.length) {
    $("glasses").innerHTML = '<p class="empty-state">Add a participant to begin.</p>';
    renderedSig = "";
    return;
  }
  const sig = G.dims.tier + "\u0002" + ordered.map(p => p.name + "\u0003" + p.color).join("\u0001");
  if (sig !== renderedSig) { buildGlasses(); renderedSig = sig; }
  updateGlasses();
}

export function forceRebuild() { renderedSig = ""; }

function petVisual(p, st, danger, key) {
  let ds = st.duckState;
  if (st.shownKind !== petKindFor(p)) {
    st.shownKind = petKindFor(p);
    if (ds === 4) ds = 0;
  }
  if ((ds === 2 || ds === 3) && p.graveDay === key) return;      /* the body stays all day */
  const prev = ds;
  if (!C.EGG_ENABLED) ds = 0;
  else if (danger && p.graveDay === key && Number(p.deadKind) >= 0) {
    st.critterKind = Number(p.deadKind);
    st.critterHue = has(p.graves, p.deadKind) ? Number(p.graves[String(p.deadKind)]) : 0;
    ds = prev === 1 ? 2 : 3;                                     /* seen live: watch it go under */
    if (ds === 2) st.duckT = 0;
  } else if (ownsEquipped(p)) ds = 1;
  else if (graveEquipped(p)) ds = 4;
  else ds = 0;
  if (ds === 1 || ds === 4) { st.critterKind = petKindFor(p); st.critterHue = petHueFor(p); }
  st.duckState = ds;
}

function updateGlasses() {
  const key = todayKey();
  let best = 0;
  for (const p of ordered) best = Math.max(best, dayScoreFor(totalOn(p, key), p, key));
  ordered.forEach((p, i) => {
    const st = G.animState(p.name), total = totalOn(p, key), goal = personalGoal(p, key);
    const over = metGoal(total, goal), danger = pastCap(total, p, key);
    petVisual(p, st, danger, key);
    st.target = Math.min(Math.max(total / goal * 100, 0), 100) / 100;
    st.color = danger ? C.DANGER_COLOR : (over ? C.OVERFILL_COLOR : p.color);
    setEl("gl_" + i, null, danger ? "glass glass-danger" : (over ? "glass glass-overfill" : "glass"));
    setEl("ha_" + i, null, danger ? "halo red" : (over ? "halo gold" : "halo"));
    show("go_" + i, over || danger);
    show("sku_" + i, danger);
    st.duckCrown = best > 0 && dayScoreFor(total, p, key) >= best - C.RATIO_EPSILON;
    st.duckJester = st.duckCrown && !over;
    const hat = st.duckJester ? "j" : "c";
    if (st.hatIs !== hat) { st.hatIs = hat; setEl("cr_" + i, hatSvg(26, 17, "crown", st.duckJester), null); }
    setEl("cr_" + i, null, st.duckCrown ? "crown-wrap on" : "crown-wrap");
    setTitle("cr_" + i, st.duckJester ? "Leading, but still short of your goal" : "Leading the day, goal met");
    const real = fmt(total) + " / " + fmt(goal) + " fl oz";
    if (danger) {
      setEl("sb_" + i, maskSpan("ozm_" + i, fmt(total)) + " / " + fmt(goal) + " fl oz", "sub");
      setTitle("sb_" + i, "Past your " + fmt(capFor(p, key)) + " oz cap - " + real);
    } else {
      setEl("sb_" + i, real, "sub");
      setTitle("sb_" + i, "");
    }
    const s = streaks(p);
    setEl("sk_" + i, streakPips(s, false), (s.win || s.goal) ? "streak pick" : "streak pick none");
  });
}

export function toggleSwatches(card) {
  const el = card.querySelector(".swatches");
  if (el) el.hidden = !el.hidden;
}

/* ---- buttons, leaderboard, activity ------------------------------------- */
function renderAddButtons() {
  setHtml("addButtons", orderedBy(C.BUTTON_ORDER).map(p => {
    const n = ja(p.name);
    return '<span class="pbtn-group" style="--pc:' + p.color + '">' +
      '<button type="button" class="participant-button add" data-act="add" data-name="' + n + '">Add for ' + esc(p.name) + '</button>' +
      '<button type="button" class="participant-button undo" data-act="undo" data-name="' + n +
      '" title="Remove ' + n + '&rsquo;s most recent pour today">undo</button></span>';
  }).join(""));
}

function renderLeaderboard() {
  const key = todayKey(), rows = standingsFor(key);
  let capBest = 0;
  for (const r of rows) capBest = Math.max(capBest, r.score);
  const h = rows.map((r, i) => {
    const w = Math.min(100, (r.total / r.goal) * 50);
    const lead = capBest > 0 && r.score >= capBest - C.RATIO_EPSILON;
    const pp = findParticipant(r.name), sk = pp ? streaks(pp) : { win: 0, goal: 0 };
    const hit = metGoal(r.total, r.goal);
    const val = (pp && pastCap(r.total, pp, key))
      ? '<span class="lb-val" title="Past their ' + fmt(r.cap) + ' oz cap - ' + fmt(r.total) + ' fl oz">' +
        maskSpan("ozl_" + i, fmt(r.total)) + ' <em>/ ' + fmt(r.goal) + '</em></span>'
      : '<span class="lb-val" title="' + fmt(r.total) + ' of a ' + fmt(r.goal) + ' oz goal">' +
        Math.round(r.total / r.goal * 100) + '%<em> ' + fmt(r.total) + ' / ' + fmt(r.goal) + '</em></span>';
    return '<li><span class="rank' + (lead ? " lead" : "") + '">' + (i + 1) + '</span>' +
      (lead ? hatSvg(20, 13, "lb-crown", !hit) : "") +
      '<span class="lb-name">' + esc(r.name) + '</span>' +
      (hit ? '<span class="pip pip-goal" title="Reached their daily goal today">goal</span>' : "") +
      streakPips(sk, true) + val +
      '<div class="lb-bar"><span style="width:' + w + '%;background:' + r.color + '"></span></div></li>';
  });
  setHtml("leaderboard", h.length ? h.join("") : '<p class="empty-state">No participants yet.</p>');
  const win = winnerOf(rows);
  setEl("leaderBadge", win === "-" ? "Nobody has poured yet" : win === "Tie" ? "It is currently a tie" : esc(win) + " is leading", null);
}

function dayEndTs() { const d = new Date(); d.setHours(23, 59, 59, 0); return d.getTime(); }

function renderActivity() {
  const key = todayKey(), all = [];
  for (const p of S.participants) {
    for (const e of p.entries) {
      if (e.date === key) all.push({ ts: e.ts, at: new Date(e.ts).getTime() || 0, name: p.name, oz: e.oz, by: e.by, kind: "water" });
    }
    if (p.petRollDay === key && Number(p.rollKind) >= 0) {
      all.push({ at: dayEndTs() - 2, name: p.name, kind: "roll", pet: Number(p.rollKind), fresh: !!p.rollWasNew });
    }
    if (p.graveDay === key && Number(p.deadKind) >= 0) {
      all.push({ at: dayEndTs() - 1, name: p.name, kind: "grave", pet: Number(p.deadKind) });
    }
  }
  all.sort((a, b) => b.at - a.at);          /* pet events carry end-of-day, so they lead */
  const h = all.slice(0, C.ACTIVITY_LIMIT).map(a => {
    if (a.kind === "roll") {
      return '<li class="ev-pet"><span class="t">pet</span><strong>' + esc(a.name) + '</strong> ' +
             (a.fresh ? "unlocked the " : "rolled another ") + esc(petLabel(a.pet)) +
             ' <span class="rar">' + esc(petRarityOf(a.pet).name) + '</span></li>';
    }
    if (a.kind === "grave") {
      return '<li class="ev-grave"><span class="t">RIP</span><strong>' + esc(a.name) + '</strong> drowned ' +
             esc(petLabel(a.pet)) + '</li>';
    }
    return '<li>' + (a.by ? '<span class="by" title="who logged it">' +
             esc(a.by === C.HIDRATE_TAG ? C.HIDRATE_LABEL : a.by) + '</span>' : '') +
           '<span class="t">' + esc(prettyTime(a.ts)) + '</span><strong>' + esc(a.name) + '</strong> added ' +
           fmt(a.oz) + ' fl oz</li>';
  });
  setHtml("activity", h.length ? h.join("") : '<p class="empty-state">No entries yet today. Start drinking.</p>');
}

/* ---- team bar ----------------------------------------------------------- */
function renderTeamBar() {
  const yt = yearTargets(), total = teamYearTotal();
  const pct = yt.target > 0 ? total / yt.target * 100 : 0, diff = total - yt.expected;
  $("tbFill").style.width = Math.max(0, Math.min(100, pct)) + "%";
  $("tbPace").style.left = Math.max(0, Math.min(100, yt.target > 0 ? yt.expected / yt.target * 100 : yearElapsed() * 100)) + "%";
  const t = yt.target > 0
    ? fmtOz(total) + " of " + fmtOz(yt.target) + " fl oz (" + (Math.round(pct * 10) / 10) + "%), " + fmtGal(total) + " gal, " +
      (Math.abs(diff) < 1 ? "on pace" : diff > 0 ? fmtOz(diff) + " oz ahead of pace" : fmtOz(-diff) + " oz behind pace") +
      "   [" + challengeStart() + " to " + challengeEnd() + "]"
    : "no participants yet";
  setTitle("teamBar", t);
  $("teamBar").setAttribute("aria-label", "Team year progress: " + t);
}

/* ---- warnings ----------------------------------------------------------- */
function renderStaleWarning() {
  const el = $("staleBanner"), dup = duplicateNames();
  let html = "";
  if (dup.length) {
    html = "<b>Duplicate participant names:</b> " + esc(dup.join(", ")) + ". Two files claim the same name, so their " +
      "water is combined for streaks but scored separately in History. Rename or remove one of each pair in the data folder.";
  } else if (S.newerRevSeen) {
    html = "This page writes up to format r" + C.FORMAT_REV + " but the folder has been written in a newer format. " +
      "Reload the page to pick up the current build before logging anything else.";
  } else if (S.staleWriters.length && S.folderFormat >= C.FORMAT_REV) {
    const bits = S.staleWriters.slice(0, 4).map(w => esc(w.name) + " (" + esc(w.label) + ", " + esc(w.user) +
      (w.at ? " at " + esc(String(w.at).replace("T", " ")) : "") + ")");
    html = "<b>An HTA or an old copy wrote to this folder</b> after it moved to format " + S.folderFormat + ": " + bits.join(", ") +
      (S.staleWriters.length > 4 ? " and " + (S.staleWriters.length - 4) + " more" : "") +
      ". Older copies drop fields they do not know, such as spent tokens. Stop using them on this folder.";
  } else if (S.staleWriters.length) {
    const bits = S.staleWriters.slice(0, 4).map(w => esc(w.name) + " (" + esc(w.label) + ", " + esc(w.user) +
      (w.at ? " at " + esc(String(w.at).replace("T", " ")) : "") + ")");
    html = "Stale copies are writing to this folder: " + bits.join(", ") +
      (S.staleWriters.length > 4 ? " and " + (S.staleWriters.length - 4) + " more" : "") +
      ". Old revisions can delete entries they do not recognise - replace them with R55 or use this page.";
  }
  if (html) { if (el.innerHTML !== html) el.innerHTML = html; el.hidden = false; }
  else el.hidden = true;
}

/* ---- pets tab ----------------------------------------------------------- */
/* Icons are drawn once into a generated stylesheet; cells only carry a class,
   so the Pets tab stays a few KB of markup however big the roster gets. */
let iconsReady = false;
function iconUrl(draw) {
  try {
    const c = document.createElement("canvas");
    c.width = 120; c.height = 120;
    const ctx = c.getContext("2d");
    ctx.scale(2, 2);
    draw(ctx);
    return c.toDataURL("image/png");
  } catch { return ""; }
}
function ensureIcons() {
  if (iconsReady) return;
  iconsReady = true;
  const css = [];
  for (let k = 0; k < C.PET_COUNT; k++) {
    css.push(".pi-" + k + "{background-image:url(" + iconUrl(ctx => drawPortrait(ctx, 30, 42, 20, k, hashHue(C.PET_NAMES[k] + k))) + ")}");
  }
  css.push(".pi-grave{background-image:url(" + iconUrl(ctx => drawHeadstone(ctx, 30, 50, 26, 210)) + ")}");
  css.push(".pi-hom{background-image:url(" + iconUrl(ctx => drawCritter(ctx, 30, 50, 17, 0, false, false, C.HOMUNCULUS_KIND, 210)) + ")}");
  const el = document.createElement("style");
  el.id = "petIcons";
  el.textContent = css.join("\n");
  document.head.appendChild(el);
}

function renderPets() {
  if (!S.participants.length) { setHtml("pets", '<p class="empty-state">Nobody on the roster yet.</p>'); return; }
  ensureIcons();
  const order = petGridOrder(), h = [];
  h.push('<div class="pet-legend">');
  C.PET_BINS.forEach((b, i) => h.push('<span><i class="pl r' + i + '"></i>' + esc(b.name) + ' &middot; ' + b.weight + '%</span>'));
  h.push('<span><i class="pl grave"></i>Buried &middot; gone for good</span>');
  h.push('<span class="pl-note">Reach your goal to roll one. Click to equip, click again to put it away.</span></div>');
  h.push('<div class="pet-cards">');
  for (const p of S.participants) {
    const mine = petKindFor(p), n = ja(p.name);
    h.push('<div class="pet-card" data-name="' + n + '">');
    h.push('<div class="pet-head"><i class="dot" style="background:' + p.color + '"></i>' + esc(p.name) +
           '<span class="pet-count">' + petsOwned(p) + ' / ' + C.PET_COUNT +
           (gravesOf(p) ? '<b class="graven"> &middot; ' + gravesOf(p) + ' buried</b>' : '') + '</span></div>');
    h.push('<div class="pet-grid">');
    for (const k of order) {
      const rar = petRarityOf(k), buried = isGrave(p, k), owned = !buried && has(p.pets, k);
      const cls = "pc r" + petBinIndex(k) + (buried ? " buried" : owned ? "" : " locked") +
                  (mine === k && (owned || buried) ? " equipped" : "");
      const title = buried ? esc(C.PET_NAMES[k]) + " &middot; " + esc(graveLine(k))
                  : owned ? esc(C.PET_NAMES[k]) + " &middot; " + esc(rar.name) : "Locked &middot; " + esc(rar.name);
      h.push('<div class="' + cls + '"' + ((owned || buried) ? ' data-act="equip" data-kind="' + k + '" role="button" tabindex="0"' : '') +
             ' title="' + title + '"><i class="pi pi-' + (buried ? "grave" : k) + '"></i>' +
             '<span class="pn">' + (buried || owned ? esc(C.PET_NAMES[k]) : "???") + '</span></div>');
    }
    h.push('</div>');
    const got = has(p.pets, C.HOMUNCULUS_KIND);
    h.push('<div class="pet-reward' + (got ? ' won" data-act="equip" data-kind="' + C.HOMUNCULUS_KIND + '" role="button" tabindex="0"' : '"') +
           ' title="' + (got ? esc(C.PET_NAMES[C.HOMUNCULUS_KIND]) + ' &middot; every one of them at once'
                             : 'Account for all ' + C.PET_COUNT + ' to find out') + '">' +
           (got ? '<i class="pi pi-hom"></i>' : '<span class="q">?</span>') +
           '<span class="rl">' + (got ? esc(C.PET_NAMES[C.HOMUNCULUS_KIND]) : penFound(p) + ' / ' + C.PET_COUNT + ' found') + '</span></div>');
    h.push('</div>');
  }
  h.push('</div>');
  setHtml("pets", h.join(""));
}

/* ---- history tab -------------------------------------------------------- */
let historyKey = "";
function statTile(v, l) { return '<div class="tile"><div class="tv">' + v + '</div><div class="tl">' + l + '</div></div>'; }
function recordCard(title, st, field, unit) {
  if (!st) return '<div class="rec empty"><div class="rec-t">' + title + '</div><div class="rec-v">&mdash;</div></div>';
  return '<div class="rec"><div class="rec-t">' + title + '</div><div class="rec-v">' + fmtOz(st[field]) +
         '<span class="u">' + unit + '</span></div><div class="rec-w"><i class="dot" style="background:' + st.color +
         '"></i>' + esc(st.name) + '</div></div>';
}

function renderHistory() {
  const k = S.dataVer + "|" + todayKey();
  if (k === historyKey) return;
  historyKey = k;
  const stats = seasonStats(), days = recentDays(C.CHART_DAYS), h = [];
  if (!stats.days) { $("history").innerHTML = '<p class="empty-state">Nothing logged yet. The chart fills in as people pour.</p>'; return; }

  h.push('<div class="season-strip">');
  h.push(statTile(fmtOz(stats.totalOz) + '<span class="u">fl oz</span>', 'poured all together'));
  h.push(statTile(fmtGal(stats.totalOz) + '<span class="u">gal</span>', 'which is this many gallons'));
  h.push(statTile(String(stats.days), 'days on the board'));
  h.push(statTile(esc(stats.first) + ' <span class="u">to</span> ' + esc(stats.last), 'covering'));
  h.push('</div>');

  h.push('<div class="panel-title">Star chart<span class="sub-note"> &middot; last ' + days.length + ' logged days</span></div>');
  h.push('<div class="chart-legend"><span><i class="sw goal"></i>reached the goal</span>' +
         '<span><i class="sw crown">' + crownSvg(15, 10, "lc") + '</i>won the day</span>' +
         '<span><i class="sw crown">' + jesterSvg(15, 10, "lc") + '</i>led, but under goal</span>' +
         '<span><i class="sw cap"></i>hit the cap</span><span><i class="sw over"></i>went past it</span>' +
         '<span><i class="sw some"></i>logged something</span></div>');
  h.push('<div class="chart-scroll"><table class="star-chart"><tr><th class="who"></th>');
  for (const d of days) h.push('<th title="' + esc(d) + '">' + esc(d.substring(8)) + '</th>');
  h.push('<th class="tally">&#9733;</th><th class="tally">&#9819;</th></tr>');

  const ranked = stats.order.slice().sort((x, y) => {
    const A = stats.people[x], B = stats.people[y];
    return (B.wins - A.wins) || (B.goalDays - A.goalDays) || (x < y ? -1 : 1);
  });
  for (const name of ranked) {
    const st = stats.people[name], pp = findParticipant(name);
    h.push('<tr><th class="who"><i class="dot" style="background:' + st.color + '"></i>' + esc(st.name) + '</th>');
    for (const key of days) {
      const rec = dayRec(key), tot = rec ? (rec.by[name] || 0) : 0, won = dayLeaders(key).includes(name);
      let cls = "c", glyph = "";
      if (tot <= 0) cls += " none";
      else if (pastCap(tot, pp, key)) { cls += " over"; glyph = "&#9760;"; }
      else if (atCap(tot, pp, key)) cls += " cap";
      else if (metGoal(tot, personalGoal(pp, key))) cls += " goal";
      else cls += " some";
      if (won && tot > 0 && !pastCap(tot, pp, key)) glyph = hatSvg(15, 10, "lc", !metGoal(tot, personalGoal(pp, key)));
      h.push('<td class="' + cls + '" title="' + esc(name) + ' &middot; ' + esc(key) + ' &middot; ' + fmt(tot) + ' fl oz' +
             (won ? ' &middot; won the day' : '') + '">' + glyph + '</td>');
    }
    h.push('<td class="tally">' + st.goalDays + '</td><td class="tally">' + st.wins + '</td></tr>');
  }
  h.push('</table></div>');

  h.push('<div class="panel-title">Season standings</div><div class="chart-scroll"><table class="stats-table">');
  h.push('<tr><th></th><th class="l">Who</th><th>Days won</th><th>Goal days</th><th>Cap days</th>' +
         '<th>Longest win run</th><th>Longest goal run</th><th>Best day</th><th>Total</th><th>Avg per day</th></tr>');
  ranked.forEach((name, i) => {
    const st = stats.people[name];
    const medal = (st.wins > 0 && i < 3) ? '<span class="medal m' + (i + 1) + '">' + (i + 1) + '</span>' : '';
    h.push('<tr><td class="rankcell">' + medal + '</td><td class="l"><i class="dot" style="background:' + st.color + '"></i>' +
           esc(st.name) + '</td><td class="big">' + st.wins + '</td><td>' + st.goalDays + '</td><td>' + st.capDays +
           (st.overDays ? ' <span class="warn-mini" title="' + st.overDays + ' day(s) past the cap">&#9760;' + st.overDays + '</span>' : '') +
           '</td><td>' + st.bestWinStreak + '</td><td>' + st.bestGoalStreak + '</td><td title="' + esc(st.bestDay) + '">' +
           fmt(Math.round(st.best * 10) / 10) + '</td><td>' + fmtOz(st.total) + '</td><td>' +
           (st.logged ? fmt(Math.round(st.total / st.logged * 10) / 10) : "0") + '</td></tr>');
  });
  h.push('</table></div>');

  h.push('<div class="panel-title">Records</div><div class="records">');
  h.push(recordCard("Most days won", topOf(stats, "wins"), "wins", "days"));
  h.push(recordCard("Most goal days", topOf(stats, "goalDays"), "goalDays", "days"));
  h.push(recordCard("Longest winning run", topOf(stats, "bestWinStreak"), "bestWinStreak", "days"));
  h.push(recordCard("Longest goal run", topOf(stats, "bestGoalStreak"), "bestGoalStreak", "days"));
  const best = topOf(stats, "best");
  if (best) h.push('<div class="rec"><div class="rec-t">Biggest single day</div><div class="rec-v">' + fmt(Math.round(best.best * 10) / 10) +
                   '<span class="u">fl oz</span></div><div class="rec-w">' + esc(best.name) + ' &middot; ' + esc(best.bestDay) + '</div></div>');
  h.push(recordCard("Most poured overall", topOf(stats, "total"), "total", "fl oz"));
  h.push('</div>');
  $("history").innerHTML = h.join("");
}

/* ---- status bar --------------------------------------------------------- */
function renderStatus() {
  const pill = $("syncPill");
  if (ui.connected) { pill.className = "sync-pill"; pill.textContent = "synced " + (ui.lastSync || clockStamp()); }
  else { pill.className = "sync-pill bad"; pill.textContent = "offline"; }
  setEl("sbFolder", dir ? esc(dir.name) : "not connected", null);
  setEl("sbMe", S.me ? esc(S.me) : "set your name", null);
  const peers = S.peerWriters.length ? "HTA r55 also writing" : "";
  const drift = S.driftWriters.length ? "other builds: " + [...new Set(S.driftWriters.map(w => w.ver))].join(", ") : "";
  setEl("sbPeers", esc([peers, drift].filter(Boolean).join(" · ")), null);
}

/* ---- the whole page ----------------------------------------------------- */
export function render() {
  maskEls = [];
  G.setActive(ui.tab === "today");
  if (ui.tab === "today") {
    renderGlasses(); renderAddButtons(); renderLeaderboard(); renderActivity();
  } else if (ui.tab === "pets") renderPets();
  else renderHistory();
  renderTeamBar();
  renderStaleWarning();
  renderStatus();
}

export function setTab(name) {
  ui.tab = name;
  for (const t of ["today", "history", "pets"]) {
    $("view-" + t).hidden = t !== name;
    $("tab-" + t).setAttribute("aria-selected", String(t === name));
  }
  if (name === "pets") htmlCache.pets = "";
  render();
}

/* ---- overlays ----------------------------------------------------------- */
export function showReport(title, sub, html) {
  $("reportTitle").innerHTML = esc(title) + (sub ? '<span class="sub">' + esc(sub) + '</span>' : '');
  $("reportBody").innerHTML = html;
  $("report").hidden = false;
  $("report").querySelector(".report-x").focus();
}
export function closeOverlays() { $("report").hidden = true; $("bank").hidden = true; }

const rRow = (label, value, cls) => '<tr><td class="k">' + esc(label) + '</td><td class="' + (cls || "wrap") + '">' + value + '</td></tr>';

export function openBank(name) {
  const p = findParticipant(name);
  if (!p) return;
  const earned = tokensEarned(p), spent = Number(p.tokensSpent) || 0, bal = earned - spent;
  $("bankName").innerHTML = esc(p.name) + "&rsquo;s gold";
  $("bankCount").innerHTML = bal + ' <small>token' + (bal === 1 ? '' : 's') + '</small>';
  $("bankNote").innerHTML = "one for every goal day" + (spent ? " &middot; " + spent + " spent" : "") +
                            (bal > 160 ? "<br>the pile has stopped fitting in the dish" : "");
  $("bank").hidden = false;
  const cv = $("bankPile"), dpr = Math.min(window.devicePixelRatio || 1, 3);
  cv.width = 240 * dpr; cv.height = 150 * dpr;
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  try { drawGoldPile(ctx, 240, 150, bal); } catch { }
  $("bank").querySelector(".report-x").focus();
}

/* Day by day, exactly what the streak walks saw. Away days are skipped here too,
   the same as in the live count. */
export function auditStreak(name) {
  const p = findParticipant(name);
  if (!p) return;
  const sk = streaks(p), dup = duplicateNames(), h = [], idle = currentIdleMax(), tieRule = C.STREAK_TIE_RULE;
  let wins = 0, goals = 0, winIdle = 0, goalIdle = 0, winStop = "", goalStop = "", winLive = true, goalLive = true;
  h.push('<h4>Streaks now</h4><table class="rt">');
  h.push(rRow("Win streak", '<span class="pill' + (sk.win ? ' good' : '') + '">' + sk.win + '</span>'));
  h.push(rRow("Goal streak", '<span class="pill' + (sk.goal ? ' good' : '') + '">' + sk.goal + '</span>'));
  h.push(rRow("Today's goal", fmt(currentGoalFor(p)) + ' oz &nbsp;<span class="dim">cap ' + fmt(capFor(p, todayKey())) + ' oz</span>'));
  h.push('</table>');
  if (dup.length) {
    h.push('<h4>Warning</h4><table class="rt">' + rRow("Duplicate names", '<span class="bad">' + esc(dup.join(", ")) +
           '</span> &mdash; two files share a name, so their water is pooled for streaks but split in History.') + '</table>');
  }
  const goalMet = d => { const rec = dayRec(d); return metGoal(rec ? (rec.by[p.name] || 0) : 0, personalGoal(p, d)); };
  if (goalMet(todayKey())) {
    goals = 1;
    h.push('<h4>Today</h4><table class="rt">' + rRow("Goal", '<span class="ok">already met today &mdash; counted</span>') + '</table>');
  }
  h.push('<h4>Day by day <span class="note">newest first &middot; a win only counts once the day ends</span></h4>');
  h.push('<table class="rt"><tr><th>Date</th><th class="n">Oz</th><th class="n">Goal</th><th class="n">Score</th>' +
         '<th class="n">Best</th><th>Led by</th><th>Win</th><th>Goal</th></tr>');
  const d = new Date();
  d.setDate(d.getDate() - 1);
  for (let guard = 0; guard < 60 && (winLive || goalLive); guard++, d.setDate(d.getDate() - 1)) {
    const key = dateKey(d);
    if (p.created && key < p.created) {
      if (winLive) winStop = "joined " + p.created;
      if (goalLive) goalStop = "joined " + p.created;
      break;
    }
    if (isAway(p, key)) {
      h.push('<tr><td>' + key.slice(5) + '</td><td colspan="7" class="dim">away &mdash; skipped</td></tr>');
      continue;
    }
    const rec = dayRec(key), mine = rec ? (rec.by[p.name] || 0) : 0, goal = personalGoal(p, key);
    const score = Math.round(dayScoreFor(mine, p, key) * 100), leaders = rec ? dayLeaders(key) : [], res = dayResult(p, key);
    let wCell, gCell, rowCls = "";
    if (!winLive) wCell = '<span class="dim">&middot;</span>';
    else if (wonDay(p, key)) { wins++; winIdle = 0; wCell = '<span class="ok">' + (res === "tie" ? "tie &rarr; " : "") + 'won ' + wins + '</span>'; }
    else if (tieRule === "hold" && res === "tie") { winIdle = 0; wCell = '<span class="dim">tie, held</span>'; }
    else if (C.STREAK_SKIP_IDLE_DAYS && satOut(p, key)) {
      winIdle++;
      if (winIdle > idle) { wCell = '<span class="bad">away too long</span>'; winStop = "idle more than " + idle + " days"; winLive = false; rowCls = "stop"; }
      else wCell = '<span class="dim">sat out ' + winIdle + '/' + idle + '</span>';
    } else { wCell = '<span class="bad">' + (res === "tie" ? "tie, ends" : "lost, ends") + '</span>'; winStop = (res === "tie" ? "tied " : "beaten ") + key; winLive = false; rowCls = "stop"; }
    if (!goalLive) gCell = '<span class="dim">&middot;</span>';
    else if (mine > 0 && metGoal(mine, goal)) { goals++; goalIdle = 0; gCell = '<span class="ok">met ' + goals + '</span>'; }
    else if (C.STREAK_SKIP_IDLE_DAYS && satOut(p, key)) {
      goalIdle++;
      if (goalIdle > idle) { gCell = '<span class="bad">away too long</span>'; goalStop = "idle more than " + idle + " days"; goalLive = false; rowCls = "stop"; }
      else gCell = '<span class="dim">sat out ' + goalIdle + '/' + idle + '</span>';
    } else { gCell = '<span class="bad">short, ends</span>'; goalStop = "missed " + key; goalLive = false; rowCls = "stop"; }
    h.push('<tr' + (rowCls ? ' class="stop"' : '') + '><td>' + key.slice(5) + '</td>' +
           '<td class="n">' + (mine > 0 ? fmt(mine) : '<span class="dim">&ndash;</span>') + '</td><td class="n">' + fmt(goal) + '</td>' +
           '<td class="n">' + (mine > 0 ? score + '%' : '<span class="dim">&ndash;</span>') + '</td>' +
           '<td class="n">' + (rec ? Math.round(rec.max * 100) + '%' : '<span class="dim">&ndash;</span>') + '</td>' +
           '<td>' + (leaders.length ? esc(leaders.join(", ")) : '<span class="dim">&ndash;</span>') + '</td>' +
           '<td>' + wCell + '</td><td>' + gCell + '</td></tr>');
  }
  h.push('</table><div class="report-foot">Win streak ' + wins + (winStop ? ' &mdash; stopped: ' + esc(winStop) : '') +
         '<br>Goal streak ' + goals + (goalStop ? ' &mdash; stopped: ' + esc(goalStop) : '') +
         '<br>Ties: ' + (tieRule === "win" ? "everyone tied is credited the win" : tieRule === "hold" ? "a tie neither extends nor ends it" : "a tie ends the streak") +
         '. Up to ' + idle + ' idle days in a row are skipped; days away are not counted at all.</div>');
  showReport("Streak audit", p.name, h.join(""));
}

export function showDiag() {
  const probs = [], t = goalTunables(), L = legacyFlat(), key = todayKey(), h = [];
  if (S.staleWriters.length) probs.push(S.staleWriters.length + " file(s) in an older format");
  if (S.driftWriters.length) probs.push(S.driftWriters.length + " file(s) written by another build");
  if (duplicateNames().length) probs.push("duplicate names: " + duplicateNames().join(", "));
  if (S.loadFailed) probs.push(S.loadFailed + " unreadable file(s)");
  if (G.stats.errors) probs.push(G.stats.errors + " animation error(s)");
  if (diag.lastError) probs.push("last error: " + diag.lastError);

  h.push('<h4>Health</h4><table class="rt">');
  h.push(rRow("Status", probs.length ? '<span class="bad">' + esc(probs.join(" · ")) + '</span>' : '<span class="ok">all clear</span>'));
  h.push(rRow("Build", esc(C.REV) + ' <span class="dim">&middot; writes as "' + esc(C.APP_VERSION) + '", up to format ' + C.FORMAT_REV + '</span>'));
  h.push(rRow("Folder format", S.folderFormat + (S.folderFormat >= C.FORMAT_REV ? ' <span class="dim">web only</span>' : ' <span class="dim">shared with R55</span>')));
  h.push(rRow("Data folder", esc(dir ? dir.name : "(none)")));
  h.push(rRow("Files", S.participants.length + ' loaded' + (S.loadRecovered ? ' &middot; <span class="bad">' + S.loadRecovered + ' recovered</span>' : '')));
  if (S.peerWriters.length) {
    h.push(rRow("Shared with", 'HTA r55 &middot; ' + S.peerWriters.length + ' file(s) last written there <span class="dim">(' +
                esc([...new Set(S.peerWriters.map(w => w.user))].join(", ")) + ')</span>'));
  }
  for (const w of S.driftWriters) h.push(rRow("", '<span class="bad">' + esc(w.name) + '</span> written by ' + esc(w.user) + ' on ' + esc(w.ver)));
  h.push('</table>');

  h.push('<h4>People <span class="note">goal and cap are for today</span></h4><table class="rt"><tr><th>Name</th>' +
         '<th class="n">Goal</th><th class="n">Cap</th><th class="n">Today</th><th class="n">Pets</th><th>Wearing</th><th></th></tr>');
  for (const p of S.participants) {
    h.push('<tr><td>' + esc(p.name) + '</td><td class="n">' + fmt(currentGoalFor(p)) + '</td><td class="n">' + fmt(capFor(p, key)) +
           '</td><td class="n">' + fmt(totalOn(p, key)) + '</td><td class="n">' + petsOwned(p) + '/' + C.PET_COUNT +
           (gravesOf(p) ? ' <span class="dim">+' + gravesOf(p) + '&dagger;</span>' : '') + '</td><td>' + esc(petName(petKindFor(p))) + '</td><td>' +
           (goalForDate(p, key) === null ? '<span class="pill">default goal</span> ' : '') +
           (p.petRollDay === key ? '<span class="pill good">rolled</span> ' : '') +
           (!isActive(p) ? '<span class="pill">away</span>' : '') + '</td></tr>');
  }
  h.push('</table>');

  h.push('<h4>Goals</h4><table class="rt">');
  h.push(rRow("How goals are set", Math.round(t.factor * 100) + '% of the average of the last ' + t.window + ' days, ending yesterday'));
  h.push(rRow("Ignored", 'days under ' + t.minOz + ' oz' + (t.dropTop ? ', and the single best day' : '')));
  h.push(rRow("Needs", 'at least ' + t.minDays + ' qualifying days, otherwise the default'));
  h.push(rRow("Default", fmt(currentGoal()) + ' oz'));
  h.push(rRow("Cap", 'twice the goal &mdash; reaching it wins outright, passing it drowns a pet'));
  h.push(rRow("History", L.until ? 'frozen per day; on or before ' + esc(L.until) + ' judged at the flat ' + fmt(L.goal) + ' oz' : 'frozen per day once each day ends'));
  h.push(rRow("Yearly target", fmt(currentAnnualGoal()) + ' oz a person'));
  h.push('</table>');

  h.push('<h4>Winning and streaks</h4><table class="rt">');
  h.push(rRow("Score", 'total &divide; your own goal; everyone at their cap ties for the win'));
  h.push(rRow("Crown", 'the leader, once their goal is met &mdash; a jester until then'));
  h.push(rRow("Ties", C.STREAK_TIE_RULE === "win" ? 'everyone tied is credited the win' : C.STREAK_TIE_RULE === "hold" ? 'a tie neither extends nor ends a streak' : 'a tie ends the streak'));
  h.push(rRow("Idle days", 'up to ' + currentIdleMax() + ' in a row are skipped'));
  h.push('</table>');

  const tw = C.PET_BINS.reduce((a, b) => a + b.weight, 0);
  h.push('<h4>Pets</h4><table class="rt">');
  h.push(rRow("Pen", C.PET_COUNT + ' species &middot; one roll a day at goal, pre-decided per person'));
  h.push(rRow("Odds", C.PET_BINS.map(b => esc(b.name) + ' ' + (Math.round(b.weight / tw * 1000) / 10) + '%').join(' &middot; ')));
  h.push(rRow("Extras", 'a reward for accounting for all ' + C.PET_COUNT + ', and something rarer that is not in the pen'));
  h.push('</table>');

  h.push('<h4>Connection <span class="note">for troubleshooting</span></h4><table class="rt">');
  h.push(rRow("Browser", esc(navigator.userAgent)));
  h.push(rRow("Origin", esc(location.origin) + (window.isSecureContext ? '' : ' <span class="bad">not a secure context</span>')));
  h.push(rRow("Folder API", typeof window.showDirectoryPicker === "function" ? '<span class="ok">available</span>' : '<span class="bad">missing &mdash; use Chrome or Edge</span>'));
  h.push(rRow("Permission", esc(diag.permission || "(not checked)")));
  h.push(rRow("Signed in as", esc(S.me || "(not set)")));
  h.push(rRow("Writes", diag.writes + ' this session' + (diag.lockSteals ? ' &middot; ' + diag.lockSteals + ' stale lock(s) cleared' : '')));
  h.push(rRow("Layout", 'tier ' + (G.dims.tier + 1) + ' of ' + C.CARD_TIERS.length + ' &middot; ' + C.CARD_TIERS[Math.max(0, G.dims.tier)].card + 'px cards'));
  h.push(rRow("Animation", G.stats.fps + ' fps &middot; ' + G.bubbleCount() + ' bubbles' +
              (G.stats.errors ? ' &middot; <span class="bad">' + G.stats.errors + ' errors, last: ' + esc(G.stats.lastError) + '</span>' : '')));
  h.push('</table>');
  if (diag.trail.length) h.push('<h4>Trail</h4><pre class="trail">' + esc(diag.trail.join("\n")) + '</pre>');
  showReport("Diagnostics", C.REV, h.join(""));
}

/* ---- settings panel ----------------------------------------------------- */
export function fillSettings() {
  $("goalVal").value = currentGoal();
  $("annualVal").value = currentAnnualGoal();
  $("startVal").value = challengeStart();
  $("idleVal").value = currentIdleMax();
  const v22 = S.folderFormat >= C.FORMAT_REV;
  $("fmtNote").innerHTML = v22
    ? "Format " + S.folderFormat + " (web only)" + (S.settings.upgradedAt ? " since " + esc(S.settings.upgradedAt.replace("T", " ")) +
      (S.settings.upgradedBy ? " by " + esc(S.settings.upgradedBy) : "") : "") + ". Do not use the HTA on this folder."
    : "Format " + S.folderFormat + ", shared with the HTA (R55). Upgrade only the web-only copy of the data.";
  $("upgradeBtn").hidden = v22;
  renderRoster();
}

export function renderRoster() {
  const h = S.participants.map(p => {
    const away = !isActive(p);
    return '<div class="roster-row' + (away ? ' away' : '') + '" data-name="' + ja(p.name) + '">' +
      '<i class="dot" style="background:' + p.color + '"></i><span class="rn">' + esc(p.name) + '</span>' +
      '<span class="rs">' + (away ? 'away since ' + esc(openAwaySince(p)) : 'playing') + '</span>' +
      '<button type="button" class="btn small" data-act="away" data-away="' + (away ? "0" : "1") + '">' + (away ? 'Back' : 'Away') + '</button></div>';
  });
  $("rosterList").innerHTML = h.length ? h.join("") : '<p class="hint">Nobody on the roster yet.</p>';
}
