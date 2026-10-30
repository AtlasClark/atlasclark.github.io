/* Rendering. Everything here reads state and writes DOM; nothing saves.
   Panels are built as strings and written only when they change (setHtml),
   so a 6-second poll with no news costs almost nothing. */

import * as C from "./config.js";
import { S, personalGoal, capFor, totalOn, metGoal, pastCap, atCap, dayScoreFor, streaks,
         standingsFor, winnerOf, orderedBy, activeParticipants, isActive, findParticipant,
         currentGoal, currentGoalFor, currentAnnualGoal, currentIdleMax, goalTunables, legacyFlat,
         challengeStart, challengeEnd, yearElapsed, teamYearTotal, yearTargets, seasonStats,
         recentDays, topOf, dayRec, dayLeaders, dayResult, wonDay, satOut, tokensEarned,
         duplicateNames, isAway, openAwaySince, goalForDate, petEventTimes, allDateKeys, dayWinners, wearsMedal } from "./model.js";
import { petKindFor, ownsEquipped, graveEquipped, petHueFor, isGrave, gravesOf, petsOwned,
         graveLine, petLabel, petName, petRarityOf, petBinIndex, petGridOrder, penFound,
         penOf, penKinds, pen2Open, pensOf, penAlive, penBuried,
         hashHue, hueOf, rarityLabel, undoEffect, rollOdds } from "./pets.js";
import { crownSvg, jesterSvg, hatSvg, drawPortrait, drawCritter, drawHeadstone, drawGoldPile, drawCoin, hatKeyFor, drawMedal, holidayOn, EVENTS, eventRange, eventDefault, setEventRanges } from "./art.js";
import * as G from "./glass.js";
import { diag, dir } from "./store.js";
import { defs as petDefs, hats as petHats, petSource } from "./petdefs.js";
import { shownKind, hiddenPets, shownBalance, hiddenIds, rollHoldLeft, rollCardDone } from "./reveal.js";
import { balance, spentTotal, spendsOn, earnedTotal, chestWinnings, shopDay, lookOf, winShare } from "./shop.js";
import { COSMETICS, drawShell } from "./cosmetics.js";
import { isHydrationDay, teamSplash } from "./hydration.js";
import { setHydrationDay } from "./hydfx.js";
import { setHolidayTheme } from "./themefx.js";
import { $, esc, fmt, fmtOz, fmtGal, todayKey, dateKey, prettyTime, clockStamp, has, parseKey, shiftKey, aAn } from "./util.js";

/* Set by app.js: the Shop tab renders from shopui.js, which imports this module. */
export const uiHooks = { renderShop: null, bottle: null };

export const ui = { tab: "today", amount: C.DEFAULT_AMOUNT, connected: false, lastSync: "", petPen: {}, shopPen: 0,
                    armed: "" };   /* eid of the pour whose undo is waiting for a second click */

/* ---- DOM helpers -------------------------------------------------------- */
const htmlCache = {};
export function setHtml(id, html) {
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


/* "Oct 15" from a day key. */
function prettyDate(key) {
  const d = parseKey(key);
  return d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : String(key || "");
}

/* ---- glasses ------------------------------------------------------------ */
let ordered = [], renderedSig = "";

/* Measured on the section, not the grid: the grid's own width is set from the layout. */
/* The screen's width less the page padding (clientWidth leaves out the scrollbar),
   not the page column: the glasses may reach past it on a big screen. */
function wrapWidth() {
  return Math.max(240, Math.min(C.WRAP_MAX, document.documentElement.clientWidth - C.SHELL_PAD * 2));
}

export function relayout() {
  if (G.applyLayout(G.pickLayout(activeParticipants().length, wrapWidth()))) { renderedSig = ""; return true; }
  return false;
}

function buildGlasses() {
  const T = G.dims;
  const gridW = T.cols * (T.card + C.CARD_GAP * 2), grid = $("glasses");
  grid.style.width = gridW + "px";                                     /* wrap at exactly cols */
  grid.style.marginLeft = "calc(50% - " + gridW / 2 + "px)";          /* centred on the page, even when wider than its column */
  const rTop = Math.round(T.gw * 0.106), rBot = Math.round(T.gw * 0.212);
  const radius = rTop + "px " + rTop + "px " + rBot + "px " + rBot + "px";
  const compact = T.card < C.COMPACT_UNDER;
  const h = [];
  ordered.forEach((p, i) => {
    const n = ja(p.name);
    h.push('<div class="participant-card' + (compact ? " compact" : "") + '" style="width:' + T.card + 'px" data-name="' + n + '">');
    h.push('<button type="button" class="trash-button" title="Remove ' + n + '" data-act="remove">&times;</button>');
    h.push('<canvas class="decorc" id="de_' + i + '" hidden aria-hidden="true"></canvas>');      /* the cup decoration (glass.js) */
    h.push('<div class="crown-wrap" id="cr_' + i + '">' + crownSvg(26, 17, "crown") + '</div>');
    h.push('<div class="gwrap" style="width:' + T.gw + 'px;height:' + T.gh + 'px" data-act="bank" tabindex="0" role="button"' +
           ' aria-label="' + n + ': Enter to log water, click for gold" title="Right-click to log water &middot; click for ' + n + '&rsquo;s gold">');
    h.push('<div class="halo" id="ha_' + i + '" style="border-radius:' + radius + '"></div>');
    h.push('<div class="glass" id="gl_' + i + '" style="width:' + T.gw + 'px;height:' + T.gh + 'px;border-radius:' + radius + '">');
    h.push('<canvas id="cv_' + i + '"></canvas>');
    h.push('<div class="overflow-glow" id="go_' + i + '" hidden></div>');
    const sk = Math.round(T.gw * 0.56);
    h.push('<img class="skull" id="sku_' + i + '" src="img/skull.png" alt="past the cap" hidden ' +
           'style="width:' + sk + 'px;height:' + sk + 'px;margin-left:-' + (sk / 2) + 'px;margin-top:-' + (sk / 2) + 'px">');
    h.push('</div><div class="glass-edge" style="width:' + T.gw + 'px;height:' + T.gh + 'px;border-radius:' + radius + '"><div class="shine"></div></div>');
    h.push('<canvas class="duckc" id="dc_' + i + '" style="top:-' + G.dims.head + 'px"></canvas>');
    h.push('</div>');
    h.push('<h2 class="pick" title="Click to change colour" data-act="swatches">' + esc(p.name) +
           (p.name === S.mine ? '<span class="you" title="This browser&rsquo;s glass">you</span>' : '') + '</h2>');
    h.push('<p class="sub" id="sb_' + i + '">&nbsp;</p>');
    h.push('<p class="streak pick" id="sk_' + i + '" title="Click for a day-by-day breakdown" data-act="audit">&nbsp;</p>');
    h.push('<div class="swatches" id="sw_' + i + '" hidden>');
    for (const col of C.PARTICIPANT_COLORS) {
      h.push('<span class="swatch' + (String(p.color).toLowerCase() === col ? " on" : "") +
             '" style="background:' + col + '" title="' + col + '" data-act="color" data-color="' + col + '"></span>');
    }
    h.push('</div></div>');
  });
  h.push('<canvas class="flight" id="flightCv" aria-hidden="true"></canvas>');   /* pets leaping between glasses */
  $("glasses").innerHTML = h.join("");
  G.unbindAll();
  G.bindFlight($("flightCv"));
  ordered.forEach((p, i) => {
    G.bindCanvases(p.name, $("cv_" + i), $("dc_" + i), T.gw, T.gh, $("de_" + i));
    G.animState(p.name).hatIs = "";
  });
  G.startAnim();
}

function renderGlasses() {
  ordered = orderedBy(C.CARD_ORDER);
  G.setOrder(ordered.map(p => p.name));
  relayout();
  if (!S.participants.length) {
    $("glasses").innerHTML = '<p class="empty-state">Add a participant to begin.</p>';
    renderedSig = "";
    return;
  }
  const sig = G.dims.card + "x" + G.dims.cols + "\u0002" + S.mine + "\u0002" + hatKeyFor(false) + "\u0002" + ordered.map(p => p.name + "\u0003" + p.color).join("\u0001");
  if (sig !== renderedSig) { buildGlasses(); renderedSig = sig; }
  updateGlasses();
}

export function forceRebuild() { renderedSig = ""; }

function petVisual(p, st, danger, key) {
  let ds = st.duckState;
  const worn = shownKind(p);                     /* a Plinko win shows once its ball lands */
  if (st.shownKind !== worn) {
    if (st.shownKind !== undefined && worn >= 0) st.wantDrop = true;   /* not on first load */
    st.shownKind = worn;
    if (ds === 4) ds = 0;
  }
  if ((ds === 2 || ds === 3) && p.graveDay === key) return;      /* the body stays all day */
  const prev = ds;
  if (!C.EGG_ENABLED) ds = 0;
  else if (danger && p.graveDay === key && Number(p.deadKind) >= 0) {
    st.critterKind = Number(p.deadKind);
    st.critterHue = hueOf(p, Number(p.deadKind));
    ds = prev === 1 ? 2 : 3;                                     /* seen live: watch it go under */
    if (ds === 2) st.duckT = 0;
  } else if (worn >= 0 && has(p.pets, worn)) ds = 1;
  else if (worn >= 0 && isGrave(p, worn)) ds = 4;
  else ds = 0;
  if (ds === 1 || ds === 4) {
    st.critterKind = worn;
    st.critterHue = hueOf(p, worn);
  }
  st.duckState = ds;
  st.look = lookOf(p);
  if (st.wantDrop) {                                 /* a newly worn pet falls into the glass */
    st.wantDrop = false;
    if (ds === 1 && !G.dropping(p.name)) G.dropIn(p.name, 0);
  }
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
    st.duckMedal = wearsMedal(p, key);
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

/* Pet events stay pinned at the top so everyone sees who got what; each carries the
   time of the pour that caused it. Every pour below has its own undo, which asks
   for a second click and says what it does to the pets first. */
let rollTimer = 0;
function renderActivity() {
  const key = todayKey(), pets = [], pours = [], won = dayWinners(shiftKey(key, -1));
  let holdFor = Infinity;                          /* a roll held by time alone: render again when it shows */
  const atOf = ts => (ts && new Date(ts).getTime()) || 0;
  for (const p of S.participants) {
    for (const e of p.entries) if (e.date === key) pours.push({ p, e, at: atOf(e.ts) });
    if (won.includes(p.name)) pets.push({ kind: "medal", p, n: winShare(won.length), ts: "" });
    const t = petEventTimes(p, key), held = rollHoldLeft(p);
    if (held && held !== Infinity) holdFor = Math.min(holdFor, held);
    const goal = goalRollOn(p, key);
    if (goal && !(held && !goal.rerolled)) {                     /* a reroll's card never hides the goal's own roll */
      pets.push({ kind: "roll", p, pet: goal.k, fresh: goal.fresh, ts: t.roll });
    }
    if (p.graveDay === key && Number(p.deadKind) >= 0) pets.push({ kind: "grave", p, pet: Number(p.deadKind), ts: t.grave });
    /* buys and rerolls one row each; Plinko folded to one row per person (a ball
       still falling stays out until it lands) */
    const hid = hiddenIds(p), drops = [];
    for (const s of spendsOn(p, key)) {
      if (hid.has(s.id)) continue;
      if (held && s.kind === "reroll" && Number(s.pet) === Number(p.rollKind)) continue;   /* its card is still turning */
      if (s.kind === "plinko") drops.push(s); else pets.push({ kind: "spend", p, s, ts: s.at });
    }
    if (drops.length === 1) pets.push({ kind: "spend", p, s: drops[0], ts: drops[0].at });
    else if (drops.length) {
      drops.sort((a, b) => atOf(a.at) - atOf(b.at));
      pets.push({ kind: "plinko", p, drops, ts: drops[drops.length - 1].at, from: drops[0].at });
    }
  }
  clearTimeout(rollTimer);
  if (holdFor !== Infinity) rollTimer = setTimeout(render, holdFor + 50);
  pets.sort((a, b) => (a.kind === "medal") - (b.kind === "medal") || atOf(b.ts) - atOf(a.ts));   /* medals last */
  pours.sort((a, b) => b.at - a.at);
  if (ui.armed && !pours.some(x => x.e.eid === ui.armed)) ui.armed = "";

  const h = pets.map(a => {
    const when = '<span class="t">' + (a.ts ? esc(prettyTime(a.ts)) : "today") + '</span>';
    if (a.kind === "medal") return '<li class="ev-pet"><span class="tag">medal</span><i class="medalico"></i><strong>' + esc(a.p.name) +
                                   '</strong> won yesterday: +' + a.n + ' shells and a medal for today</li>';
    if (a.kind === "spend") return '<li class="ev-shop">' + spendLine(a.p, a.s, when) + '</li>';
    if (a.kind === "plinko") return '<li class="ev-shop" title="' + a.drops.length + ' drops, ' + esc(prettyTime(a.from)) + ' to ' +
                                    esc(prettyTime(a.ts)) + '">' + plinkoLine(a.p, a.drops, key, when) + '</li>';
    if (a.kind === "roll") {
      return '<li class="ev-pet">' + '<span class="tag">' + (a.fresh ? "new pet" : "pet") + '</span>' + when +
             '<strong>' + esc(a.p.name) + '</strong> ' + rollVerb(a.fresh) + esc(petLabel(a.pet)) +
             ' <span class="rar">' + esc(rarityLabel(a.pet)) + '</span></li>';
    }
    return '<li class="ev-grave"><span class="tag">RIP</span>' + (key >= C.CAP_BONUS_SINCE ? '<span class="tag bonus">+' + C.CAP_BONUS + ' tokens</span>' : '') +
           when + '<strong>' + esc(a.p.name) + '</strong> drowned the ' +
           esc(petLabel(a.pet)) + '</li>';
  });
  for (const { p, e } of pours.slice(0, C.ACTIVITY_LIMIT)) {
    const armed = ui.armed === e.eid, by = e.by === C.HIDRATE_TAG ? C.HIDRATE_LABEL : e.by;
    let note = "";
    if (armed) {
      const fx = undoEffect(p, e.eid);
      note = '<div class="undo-note">Remove ' + fmt(e.oz) + ' oz from ' + esc(p.name) + '?' + (fx ? ' ' + esc(fx[0].toUpperCase() + fx.slice(1)) + '.' : '') +
             ' Click again to confirm.</div>';
    }
    h.push('<li class="pour' + (armed ? " armed" : "") + '" data-name="' + ja(p.name) + '" data-eid="' + esc(e.eid) + '">' +
           '<button type="button" class="undo-x" data-act="undo" title="Remove this pour">' + (armed ? "remove" : "undo") + '</button>' +
           (by ? '<span class="by" title="who logged it">' + esc(by) + '</span>' : '') +
           '<span class="t">' + esc(prettyTime(e.ts)) + '</span><strong>' + esc(p.name) + '</strong> added ' +
           fmt(e.oz) + ' fl oz' + note + '</li>');
  }
  setHtml("activity", h.length ? h.join("") : '<p class="empty-state">No entries yet today. Start drinking.</p>');
}

export function renderActivityNow() { renderActivity(); }

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
/* An old HTA still open somewhere rewrites files and erases their web-only history.
   One line naming whose copy wrote, while a file is still HTA-written, until this
   browser says "Got it"; a newer write brings it back. Past sightings stay in the log
   (_alerts/hta.json), listed in Diagnostics. */
const HTA_OK = "awc-hta-ok";
const htaWrites = () => S.htaWriters;
const newestWrite = list => list.reduce((a, e) => String(e.at || e.seen || "") > a ? String(e.at || e.seen || "") : a, "");
function htaWarning() {
  const list = htaWrites();
  let dismissed = "";
  try { dismissed = localStorage.getItem(HTA_OK) || ""; } catch { }
  if (!list.length || newestWrite(list) <= dismissed) return "";
  const users = [...new Set(list.map(e => e.user))];
  return '<b>Old HTA writing to this folder:</b> ' + esc(users.join(", ")) + '. Please close all HTA windows. ' +
         '<button type="button" class="btn small" data-act="hta-ok">Got it</button>';
}
export function htaDismiss() {
  try { localStorage.setItem(HTA_OK, newestWrite(htaWrites())); } catch { }
  renderStaleWarning();
}

/* National Hydration Day: the water background and the banner with the rules and
   the team goal (hydration.js, hydfx.js). */
let evHtml = "", evTimer = 0;
function renderEventBanner() {
  const on = isHydrationDay(), el = $("eventBanner"), hol = holidayOn();
  setHydrationDay(on);
  setHolidayTheme(!on && hol ? hol.theme : "");
  if (!on) { el.hidden = true; evHtml = ""; clearInterval(evTimer); evTimer = 0; return; }
  ensureIcons();
  const H = C.HYD_DAY, t = teamSplash(), pct = t.goal ? Math.min(100, Math.round(t.total / t.goal * 100)) : 0;
  const html = '<div class="ev-head"><b><span class="ev-fav" aria-hidden="true">🎉💧</span> ' + esc(H.name) + ' <span class="ev-fav" aria-hidden="true">💧🥳</span></b>' +
    '<span class="ev-clock" id="evClock"></span><span>In celebration, every ' + H.ozPerShell + ' oz earns a <span class="shellico sm"></span>shell, every ' +
    H.ozPerToken + ' oz earns a <span class="coin sm"></span>token. Reach your goal today for an extra bonus!</span></div>' +
    '<div class="ev-team"><span>' + (t.met ? 'Team Goal reached: +' + H.teamShells + ' shells for everyone who poured today.'
      : 'Team Goal: ' + fmtOz(t.total) + ' of ' + fmtOz(t.goal) + ' oz together for +' + H.teamShells + ' shells each') + '</span>' +
    '<i class="ev-bar"><b style="width:' + pct + '%"></b></i></div>';
  if (evHtml !== html) { el.innerHTML = evHtml = html; tickEventClock(); }
  if (!evTimer) evTimer = setInterval(tickEventClock, 1000);
  el.hidden = false;
}
/* Time left in the day, to local midnight. */
function tickEventClock() {
  const el = $("evClock");
  if (!el) return;
  const now = new Date(), end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const s = Math.max(0, Math.floor((end - now) / 1000)), p = n => String(n).padStart(2, "0");
  el.textContent = "⏳ " + Math.floor(s / 3600) + "h " + p(Math.floor(s / 60) % 60) + "m " + p(s % 60) + "s left";
}

function renderStaleWarning() {
  const el = $("staleBanner"), dup = duplicateNames();
  let html = "";
  if (dup.length) {
    html = "<b>Duplicate names:</b> " + esc(dup.join(", ")) + ". Streaks will be wrong until one of each is renamed or removed.";
  } else if (S.newerRevSeen) {
    html = "The folder was written by a newer version. Reload before logging.";
  } else {
    html = htaWarning();
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
/* Pet art changed: the icon sheet is built again on next use. */
export function resetIcons() {
  iconsReady = false;
  const el = $("petIcons");
  if (el) el.remove();
  for (const k of Object.keys(htmlCache)) delete htmlCache[k];
}

export function ensureIcons() {
  if (iconsReady) return;
  iconsReady = true;
  const css = [];
  for (const k of [1, 2, 3].flatMap(penKinds)) {
    css.push(".pi-" + k + "{background-image:url(" + iconUrl(ctx => drawPortrait(ctx, 30, 42, 20, k, hashHue(C.PET_BASE_NAMES[k] + k))) + ")}");
  }
  css.push(".pi-grave{background-image:url(" + iconUrl(ctx => drawHeadstone(ctx, 30, 50, 26, 210)) + ")}");
  css.push(".pi-hom{background-image:url(" + iconUrl(ctx => drawCritter(ctx, 30, 50, 17, 0, false, false, C.HOMUNCULUS_KIND, 210)) + ")}");
  css.push(".coin{background:center/contain no-repeat url(" + iconUrl(ctx => drawCoin(ctx, 30, 30, 58)) + ");box-shadow:none}");
  css.push(".shellico{background:center/contain no-repeat url(" + iconUrl(ctx => drawShell(ctx, 30, 30, 58)) + ")}");
  css.push(".medalico{background:center/contain no-repeat url(" + iconUrl(ctx => drawMedal(ctx, 30, 42, 70)) + ")}");
  const el = document.createElement("style");
  el.id = "petIcons";
  el.textContent = css.join("\n");
  document.head.appendChild(el);
}

function renderPets() {
  if (!S.participants.length) { setHtml("pets", '<p class="empty-state">Nobody on the roster yet.</p>'); return; }
  ensureIcons();
  const h = [];
  h.push('<div class="pet-legend">');
  const odds = rollOdds();
  C.PET_BINS.forEach((b, i) => h.push('<span><i class="pl r' + i + '"></i>' + esc(b.name) + ' &middot; ' + odds.bins[i].toFixed(1) + '%</span>'));
  h.push('<span><i class="pl grave"></i>Buried &middot; bring it back with shards or win it on Plinko</span>');
  h.push('<span class="pl-note">Reach your goal to roll. Click a pet to wear it; click again to take it off.</span></div>');
  h.push('<div class="pet-cards">');
  for (const p of S.participants) {
    const mine = shownKind(p), n = ja(p.name), held = hiddenPets(p);
    /* each pen gets a tab once a second one is open; until then a card shows one pen */
    const pens = pensOf(p), open = pens.length > 1, pen = pens.includes(ui.petPen[p.name]) ? ui.petPen[p.name] : pens.at(-1), order = petGridOrder(pen);
    const inPen = k => penOf(k) === pen, heldHere = [...held.keys()].filter(inPen);
    const alive = penAlive(p, pen) - heldHere.length, buried = penBuried(p, pen) + heldHere.filter(k => held.get(k)).length;
    h.push('<div class="pet-card" data-name="' + n + '">');
    h.push('<div class="pet-head"><i class="dot" style="background:' + p.color + '"></i>' + esc(p.name) +
           '<span class="pet-count">' + alive + ' / ' + C.PET_COUNT +
           (buried ? '<b class="graven"> &middot; ' + buried + ' buried</b>' : '') + '</span></div>');
    if (open) {
      h.push('<div class="pen-tabs" role="tablist">' + pens.map(x =>
        '<button type="button" role="tab" class="pen-tab' + (x === pen ? ' on' : '') + '" aria-selected="' + (x === pen) + '" data-act="pen" data-pen="' + x + '">' +
        C.PEN_LABELS[x] + ' <b>' + penAlive(p, x) + '</b></button>').join("") + '</div>');
    }
    h.push('<div class="pet-grid">');
    for (const k of order) {
      const rar = petRarityOf(k), buried = isGrave(p, k) || held.get(k) === true, owned = !buried && has(p.pets, k) && !held.has(k);
      const cls = "pc r" + petBinIndex(k) + (buried ? " buried" : owned ? "" : " locked") +
                  (mine === k && (owned || buried) ? " equipped" : "");
      const title = buried ? esc(C.PET_NAMES[k]) + " &middot; " + esc(graveLine(k))
                  : owned ? esc(C.PET_NAMES[k]) + " &middot; " + esc(rar.name) : "Locked &middot; " + esc(rar.name);
      h.push('<div class="' + cls + '"' + ((owned || buried) ? ' data-act="equip" data-kind="' + k + '" role="button" tabindex="0"' : '') +
             ' title="' + title + '"><i class="pi pi-' + (buried ? "grave" : k) + '"></i>' +
             '<span class="pn">' + (buried || owned ? esc(C.PET_NAMES[k]) : "???") + '</span></div>');
    }
    h.push('</div>');
    if (pen > 1) {
      h.push('<p class="pen-note">Opened ' + esc(prettyDate(pen === 3 ? p.pen3 : p.pen2)) + '.' + (pen === pens.at(-1) ? ' New pets come from here now.' : '') + '</p></div>');
      continue;
    }
    const got = has(p.pets, C.HOMUNCULUS_KIND);
    h.push('<div class="pet-reward' + (got ? ' won" data-act="equip" data-kind="' + C.HOMUNCULUS_KIND + '" role="button" tabindex="0"' : '"') +
           ' title="' + (got ? esc(C.PET_NAMES[C.HOMUNCULUS_KIND]) + ' &middot; every one of them at once'
                             : 'Have all ' + C.PET_COUNT + ' alive to find out') + '">' +
           (got ? '<i class="pi pi-hom"></i>' : '<span class="q">?</span>') +
           '<span class="rl">' + (got ? esc(C.PET_NAMES[C.HOMUNCULUS_KIND]) : penFound(p) + ' / ' + C.PET_COUNT + ' alive') + '</span></div>');
    h.push('</div>');
  }
  h.push('</div>');
  setHtml("pets", h.join(""));
}

/* ---- history tab -------------------------------------------------------- */
let historyKey = "";

/* Season standings sort by any column: click a header, click again to turn it round.
   The choice is kept in this browser. */
const SEASON_COLS = [
  { key: "name", label: "Who" }, { key: "wins", label: "Days won" }, { key: "goalDays", label: "Goal days" },
  { key: "capDays", label: "Cap days" }, { key: "bestWinStreak", label: "Longest win run" },
  { key: "bestGoalStreak", label: "Longest goal run" }, { key: "best", label: "Best day" },
  { key: "total", label: "Total" }, { key: "avg", label: "Avg per day" }];
let seasonSort = { key: "wins", dir: -1 };
try { const s = JSON.parse(localStorage.getItem("awc-season-sort")); if (s && SEASON_COLS.some(c => c.key === s.key)) seasonSort = { key: s.key, dir: s.dir === 1 ? 1 : -1 }; } catch { }
const seasonVal = (st, key) => key === "avg" ? (st.logged ? st.total / st.logged : 0) : st[key];
function seasonOrder(stats) {
  const { key, dir } = seasonSort, P = stats.people;
  return stats.order.slice().sort((x, y) => {
    const A = P[x], B = P[y];
    const main = key === "name" ? (x.toLowerCase() < y.toLowerCase() ? -1 : x.toLowerCase() > y.toLowerCase() ? 1 : 0) * dir
                                : (seasonVal(A, key) - seasonVal(B, key)) * dir;
    return main || (B.wins - A.wins) || (B.goalDays - A.goalDays) || (x < y ? -1 : 1);
  });
}
function onHistoryClick(e) {
  const b = e.target.closest("[data-sort]");
  if (!b) return;
  const key = b.dataset.sort;
  seasonSort = seasonSort.key === key ? { key, dir: -seasonSort.dir } : { key, dir: key === "name" ? 1 : -1 };
  try { localStorage.setItem("awc-season-sort", JSON.stringify(seasonSort)); } catch { }
  historyKey = "";
  renderHistory();
}
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
  if (!stats.days) { $("history").innerHTML = '<p class="empty-state">Nothing logged yet.</p>'; return; }

  h.push((parseKey(todayKey()).getDay() === 1 && weekRecapHtml()) || recapHtml());   /* Mondays: the week */
  h.push('<div class="season-strip">');
  h.push(statTile(fmtOz(stats.totalOz) + '<span class="u">fl oz</span>', 'poured all together'));
  h.push(statTile(fmtGal(stats.totalOz) + '<span class="u">gal</span>', 'which is this many gallons'));
  h.push(statTile(String(stats.days), 'days on the board'));
  h.push(statTile(esc(stats.first) + ' <span class="u">to</span> ' + esc(stats.last), 'covering'));
  h.push('</div>');

  h.push('<div class="panel-title">Star chart<span class="sub-note"> &middot; last ' + days.length + ' logged days</span></div>');
  h.push('<div class="chart-legend"><span><i class="sw goal"></i>reached the goal</span>' +
         '<span><i class="sw crown">' + crownSvg(18, 12, "lc") + '</i>won the day</span>' +
         '<span><i class="sw crown">' + jesterSvg(18, 12, "lc") + '</i>led, but under goal</span>' +
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
      if (won && tot > 0 && !pastCap(tot, pp, key)) glyph = hatSvg(18, 12, "lc", !metGoal(tot, personalGoal(pp, key)));
      h.push('<td class="' + cls + '" title="' + esc(name) + ' &middot; ' + esc(key) + ' &middot; ' + fmt(tot) + ' fl oz' +
             (won ? ' &middot; won the day' : '') + '">' + glyph + '</td>');
    }
    h.push('<td class="tally">' + st.goalDays + '</td><td class="tally">' + st.wins + '</td></tr>');
  }
  h.push('</table></div>');

  h.push('<div class="panel-title">Season standings</div><div class="chart-scroll"><table class="stats-table season-table">');
  h.push('<tr><th></th>' + SEASON_COLS.map(c => {
    const on = c.key === seasonSort.key;
    return '<th' + (c.key === "name" ? ' class="l"' : '') + (on ? ' aria-sort="' + (seasonSort.dir < 0 ? "descending" : "ascending") + '"' : '') + '>' +
           '<button type="button" class="th-sort' + (on ? ' on' : '') + '" data-sort="' + c.key + '">' + c.label +
           '<i aria-hidden="true">' + (on ? (seasonSort.dir < 0 ? "&#9660;" : "&#9650;") : "&#9662;") + '</i></button></th>';
  }).join("") + '</tr>');
  const order = seasonOrder(stats), ranks = seasonSort.key !== "name" && seasonSort.dir < 0;
  order.forEach((name, i) => {
    const st = stats.people[name];
    const medal = (ranks && seasonVal(st, seasonSort.key) > 0 && i < 3) ? '<span class="medal m' + (i + 1) + '">' + (i + 1) + '</span>' : '';
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
  $("history").onclick = onHistoryClick;
}

/* ---- status bar --------------------------------------------------------- */
function renderStatus() {
  const pill = $("syncPill");
  if (ui.connected) { pill.className = "sync-pill"; pill.textContent = "synced " + (ui.lastSync || clockStamp()); }
  else { pill.className = "sync-pill bad"; pill.textContent = "offline"; }
  setEl("sbFolder", dir ? esc(dir.name) : "not connected", null);
  setEl("petArtNote", petSource.from === "folder"
    ? "This folder uses its own art (" + esc(C.FOLDER_PETS_FILE) + "). Delete that file to go back to the site&rsquo;s art."
    : "Redraw the pets, the crown and the jester hat.", null);
  setEl("sbMe", S.me ? esc(S.me) + (S.mine ? ' &middot; ' + esc(S.mine) : '') : "set your name", null);
  const mine = S.mine && findParticipant(S.mine), q = $("quickPour");
  q.hidden = !mine || !ui.connected;
  if (mine) {
    setEl("quickPour", '+ ' + fmtOz(ui.amount) + ' oz for ' + esc(mine.name), null);
    q.style.setProperty("--pc", mine.color);
  }
}

/* ---- shop lines (activity and recap) ----------------------------------- */
/* "the Crab", "the Crab and the Seal", "the Crab, the Seal and the Hippo", then "... and N more". */
function petList(ks) {
  const l = ks.map(k => "the " + esc(petLabel(k)));
  if (l.length <= 2) return l.join(" and ");
  if (l.length === 3) return l[0] + ", " + l[1] + " and " + l[2];
  return l.slice(0, 3).join(", ") + " and " + (l.length - 3) + " more";
}

/* A person's Plinko drops for the day as one line: what they won, then the rest in counts. */
function plinkoLine(p, drops, key, when) {
  const d = shopDay({ spends: drops }, key), bits = [];
  if (d.fresh.length) bits.push('won ' + petList(d.fresh));
  if (d.revived.length) bits.push('won ' + petList(d.revived) + ' back from the grave');
  if (d.chestWon) bits.push('won the Community Chest <span class="rar chest">' + d.chestWon + ' tokens</span>');
  if (d.chestIn - (d.chestWon ? 1 : 0) > 0) bits.push((d.chestIn - (d.chestWon ? 1 : 0)) + ' into the chest');
  if (d.repeats) bits.push(d.repeats + ' repeat' + (d.repeats === 1 ? '' : 's') + ' (+' + d.repeats + ' shard' + (d.repeats === 1 ? '' : 's') + ')');
  if (d.empty) bits.push(d.empty + ' returned');
  return '<span class="tag">plinko</span>' + when + '<strong>' + esc(p.name) + '</strong> dropped ' + d.drops + ' tokens' +
         (bits.length ? ': ' + bits.join(' &middot; ') : '');
}
const tierLabel = t => (C.PET_BINS[Number(t)] || { name: "?" }).name;
/* What a "shard" spend paid: "a Rare shard", "2 Rare shards". */
const shardWords = s => { const n = Number(s.cost) || 1; return n === 1 ? aAn(tierLabel(s.tier)) + " shard" : n + " " + tierLabel(s.tier) + " shards"; };
function spendLine(p, s, when) {
  const k = Number(s.pet), name = '<strong>' + esc(p.name) + '</strong> ';
  if (s.kind === "buy") return '<span class="tag">shop</span>' + when + name + 'bought the ' + esc(petLabel(k)) +
                               ' <span class="rar">' + s.cost + ' tokens</span>';
  if (s.kind === "plinko" && s.chest) return '<span class="tag">plinko</span>' + when + name +
    (s.chest.won ? 'won the Community Chest <span class="rar chest">' + s.chest.won + ' tokens</span>' : 'put a token in the Community Chest');
  if (s.kind === "plinko") return '<span class="tag">plinko</span>' + when + name + (k < 0 ? 'landed on an empty rarity' :
                                  'won ' + (s.fresh ? "the " : "another ") + esc(petLabel(k)) + (s.revived ? ' back from the grave' : '') +
                                  ' <span class="rar">' + esc(rarityLabel(k)) + '</span>' + (s.fresh ? '' : ' <span class="dim">+1 shard</span>'));
  if (s.kind === "shard") return '<span class="tag">shards</span>' + when + name + 'used ' + esc(shardWords(s)) + ' on the ' +
                                 esc(petLabel(k)) + (s.revived ? ' (back from the grave)' : '');
  if (s.kind === "fuse") return '<span class="tag">shards</span>' + when + name + 'combined ' + C.SHARD_FUSE + ' ' + esc(tierLabel(s.tier)) +
                                ' shards into 1 ' + esc(tierLabel(Number(s.tier) + 1));
  if (s.kind === "reroll") return '<span class="tag">reroll</span>' + when + name + 'rerolled the ' + esc(petLabel(Number(s.from))) +
                                  ' into ' + (k >= 0 ? (s.fresh ? "the " : "another ") + esc(petLabel(k)) : "nothing");
  if (s.kind === "cosmetic") return '<span class="tag">style</span>' + when + name + 'bought ' + esc((COSMETICS[s.item] || { name: "a look" }).name) +
                                    ' <span class="rar">' + s.cost + ' shells</span>';
  if (s.kind === "paint") return '<span class="tag">style</span>' + when + name + 'recoloured the ' + esc(petLabel(k)) +
                                 ' <i class="dot" style="background:hsl(' + Number(s.hue) + ',62%,58%)"></i>';
  return '<span class="tag">shop</span>' + when + name + 'spent ' + s.cost;
}

/* ---- the last day, in short (top of History) ---------------------------- */
/* Rolls and drownings come from the day logs (format 22). Before those existed,
   petRollDay / graveDay still name the day if nothing has replaced them since. */
/* The goal's own roll that day. A reroll replaces the day's roll in the record, but its
   spend keeps what it replaced (from, fromFresh), so the goal line stays what it was. */
function goalRollOn(p, day) {
  const rr = spendsOn(p, day).filter(s => s.kind === "reroll").sort((a, b) => String(a.at).localeCompare(String(b.at)))[0];
  if (rr) return Number(rr.from) >= 0 ? { k: Number(rr.from), fresh: rr.fromFresh, rerolled: true } : null;
  return rollOn(p, day);
}
/* fresh: true, false, or unknown (a reroll saved before fromFresh was kept) */
const rollVerb = fresh => fresh === true ? "unlocked the " : fresh === false ? "rolled another " : "rolled the ";

function rollOn(p, day) {
  const log = p.rollLog && p.rollLog[day];
  if (log) return Number(log.k) >= 0 ? { k: Number(log.k), fresh: !!log.n } : null;
  return p.petRollDay === day && Number(p.rollKind) >= 0 ? { k: Number(p.rollKind), fresh: !!p.rollWasNew } : null;
}
function graveOn(p, day) {
  if (p.graveLog && has(p.graveLog, day)) return Number(p.graveLog[day]) >= 0 ? Number(p.graveLog[day]) : null;
  return p.graveDay === day && Number(p.deadKind) >= 0 ? Number(p.deadKind) : null;
}
const dayTotal = d => { const r = dayRec(d); return r ? Object.values(r.by).reduce((a, b) => a + b, 0) : 0; };

function recapHtml() {
  const today = todayKey(), keys = allDateKeys(), day = keys.find(d => d < today);
  if (!day) return "";
  ensureIcons();
  const yest = shiftKey(today, -1) === day, rows = standingsFor(day), played = rows.filter(r => r.total > 0);
  const leaders = dayLeaders(day), team = dayTotal(day), winners = dayWinners(day);
  const before = keys.filter(d => d < day).slice(0, 7);
  const avg = before.length ? before.reduce((a, d) => a + dayTotal(d), 0) / before.length : 0;
  const goalers = played.filter(r => metGoal(r.total, r.goal));
  const satOut = rows.filter(r => r.total <= 0);
  const date = parseKey(day).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  const head = !leaders.length ? "Nobody poured"
             : leaders.length > 1 ? esc(leaders.join(" & ")) + " tied for the day" : esc(leaders[0]) + " won the day";
  const h = ['<section class="recap"><div class="recap-head"><p class="eyebrow">' + (yest ? "Yesterday" : "Last day played") +
             ' &middot; ' + esc(date) + '</p><h3>' + (leaders.length ? hatSvg(32, 21, "rc-crown", !goalers.some(g => leaders.includes(g.name))) : "") +
             head + '</h3>' + (winners.length ? '<p class="recap-prize"><i class="medalico"></i>' + esc(winners.join(" & ")) + ' ' +
             (winners.length > 1 ? 'take ' + winShare(winners.length) + ' shells each' : 'takes ' + winShare(1) + ' shells') +
             (yest ? ' and wear' + (winners.length > 1 ? '' : 's') + ' the medal today' : '') + '</p>' : '') + '<p class="recap-sub">' + played.length + ' played &middot; ' + goalers.length + ' reached their goal &middot; ' +
             fmtOz(team) + ' fl oz together' +
             (avg > 0 ? ' <span class="' + (team >= avg ? "up" : "down") + '">' + (team >= avg ? "&#9650; " : "&#9660; ") +
                        Math.abs(Math.round((team / avg - 1) * 100)) + '% on the week before</span>' : '') + '</p></div>'];

  h.push('<ol class="recap-podium">');
  played.slice(0, 3).forEach((r, i) => {
    const lead = leaders.includes(r.name), p = findParticipant(r.name), over = p && pastCap(r.total, p, day);
    h.push('<li class="pod p' + (i + 1) + '" style="--pc:' + r.color + '"><span class="medal m' + (i + 1) + '">' + (i + 1) + '</span>' +
           '<span class="pn">' + esc(r.name) + (lead ? ' ' + hatSvg(18, 12, "lc", !metGoal(r.total, r.goal)) : '') + '</span>' +
           '<span class="pv">' + (over ? '&#9760; past the cap' : Math.round(r.total / r.goal * 100) + '%') + '</span>' +
           '<span class="po">' + fmt(r.total) + ' / ' + fmt(r.goal) + ' oz</span></li>');
  });
  h.push('</ol><div class="recap-cols">');

  h.push('<div><h4>Reached the goal</h4>' + (goalers.length ? goalers.map(r => {
    const p = findParticipant(r.name), g = yest && p ? streaks(p).goal : 0;
    return '<span class="rc-chip"><i class="dot" style="background:' + r.color + '"></i>' + esc(r.name) +
           (g >= 2 ? ' <b class="pip pip-goal">' + g + 'G</b>' : '') + '</span>';
  }).join("") : '<p class="dim">Nobody this time.</p>') + '</div>');

  /* Pets: what changed in each pen. Plinko is folded to one line per person (new
     pets only); every drop is counted in the shop strip below instead. */
  const ev = [], shop = [];
  const icon = k => penOf(k) > 0 ? '<i class="pi pi-' + k + '"></i>' : '';
  const names = petList;
  for (const p of S.participants) {
    const r = goalRollOn(p, day), g = graveOn(p, day), d = shopDay(p, day), who = '<strong>' + esc(p.name) + '</strong> ';
    const line = (ic, text) => '<li>' + ic + '<span class="rc-t">' + who + text + '</span></li>';   /* name and text wrap as one */
    if (r) ev.push(line(icon(r.k), rollVerb(r.fresh) + esc(petLabel(r.k))));
    if (g !== null) ev.push(line('<i class="pi pi-grave"></i>', 'drowned the ' + esc(petLabel(g))));
    for (const s of d.rerolls) ev.push('<li class="rc-shop">' + spendLine(p, s, "") + '</li>');
    for (const s of d.buys) ev.push(line(icon(Number(s.pet)), 'bought the ' + esc(petLabel(Number(s.pet))) + (s.revived ? ' back from the grave' : '')));
    for (const s of d.picks) ev.push(line(icon(Number(s.pet)), 'used ' + esc(shardWords(s)) + ' on the ' + esc(petLabel(Number(s.pet))) +
                                          (s.revived ? ' (back from the grave)' : '')));
    if (d.fresh.length) ev.push(line(icon(d.fresh[0]), 'won ' + names(d.fresh) + ' on Plinko'));
    if (d.revived.length) ev.push(line(icon(d.revived[0]), 'won ' + names(d.revived) + ' back from the grave on Plinko'));
    if (d.drops || d.buys.length || d.picks.length || d.fuses.length || d.rerolls.length) shop.push({ p, d });
  }
  h.push('<div><h4>Pets</h4>' + (ev.length ? '<ul class="rc-pets">' + ev.join("") + '</ul>' : '<p class="dim">No pet news.</p>') + '</div>');

  h.push('<div><h4>Sat out</h4>' + (satOut.length ? satOut.map(r => '<span class="rc-chip dim"><i class="dot" style="background:' + r.color +
         '"></i>' + esc(r.name) + '</span>').join("") : '<p class="dim">Everyone played.</p>') + '</div>');
  h.push('</div>');
  if (shop.length) h.push(recapShop(shop));
  h.push('</section>');
  return h.join("");
}

/* Mondays: the week just gone, Monday to Sunday, in place of the day card. Who won
   the most days, the week's highlights, every new pet and drowning, and the shop. */
const WEEK_RARITY = k => k === C.MYSTERY_KIND ? 7 : k === C.HOMUNCULUS_KIND ? 6 : petBinIndex(k);
const shortDate = k => parseKey(k).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const weekday = k => parseKey(k).toLocaleDateString("en-US", { weekday: "long" });
const plural = (n, w) => n + " " + w + (n === 1 ? "" : "s");

export function weekStats(today = todayKey()) {
  const start = shiftKey(today, -7), days = [0, 1, 2, 3, 4, 5, 6].map(i => shiftKey(start, i));
  const prevDays = days.map(d => shiftKey(d, -7));
  const team = days.reduce((a, d) => a + dayTotal(d), 0), prevTeam = prevDays.reduce((a, d) => a + dayTotal(d), 0);
  const rows = S.participants.map(p => {
    const r = { p, name: p.name, color: p.color, total: 0, goalDays: 0, won: 0, played: 0, here: 0, avg: 0, prevAvg: 0,
                prevPlayed: 0, best: { oz: 0, day: "" }, found: [], revived: [], drowned: [], shop: null };
    let share = 0, prevShare = 0;
    for (const d of days) {
      if (isAway(p, d)) continue;
      r.here++;
      const t = totalOn(p, d), g = personalGoal(p, d);
      if (t > 0) { r.played++; r.total += t; share += Math.min(t / g, 2); }
      if (t > 0 && metGoal(t, g)) r.goalDays++;
      if (t > r.best.oz) r.best = { oz: t, day: d };
      if (dayLeaders(d).includes(p.name)) r.won++;
      const roll = goalRollOn(p, d), grave = graveOn(p, d), sd = shopDay(p, d);
      if (roll && roll.fresh === true) r.found.push(roll.k);
      for (const s of sd.rerolls) if (s.fresh && Number(s.pet) >= 0) r.found.push(Number(s.pet));
      r.found.push(...sd.fresh);
      for (const s of [...sd.buys, ...sd.picks]) (s.revived ? r.revived : r.found).push(Number(s.pet));
      r.revived.push(...sd.revived);
      if (grave !== null) r.drowned.push(grave);
      if (sd.drops || sd.buys.length || sd.picks.length || sd.fuses.length || sd.rerolls.length) {
        if (!r.shop) r.shop = { drops: 0, spent: 0, fresh: [], revived: [], repeats: 0, empty: 0, chestIn: 0, chestWon: 0, buys: [], picks: [], fuses: [], rerolls: [] };
        for (const f of ["drops", "spent", "repeats", "empty", "chestIn", "chestWon"]) r.shop[f] += sd[f];
        for (const f of ["fresh", "revived", "buys", "picks", "fuses", "rerolls"]) r.shop[f].push(...sd[f]);
      }
    }
    for (const d of prevDays) {
      const t = totalOn(p, d);
      if (t > 0 && !isAway(p, d)) { r.prevPlayed++; prevShare += Math.min(t / personalGoal(p, d), 2); }
    }
    r.avg = r.played ? share / r.played : 0;
    r.prevAvg = r.prevPlayed ? prevShare / r.prevPlayed : 0;
    return r;
  });
  rows.sort((a, b) => (b.won - a.won) || (b.goalDays - a.goalDays) || (b.total - a.total) || (a.name < b.name ? -1 : 1));
  return { start, end: days[6], days, team, prevTeam, rows };
}

/* The names that share the top value, joined: "Ann", "Ann & Bo", "Ann, Bo & Cy". */
function topBy(rows, val, min = 1e-9) {
  const best = Math.max(0, ...rows.map(val));
  if (best < min) return null;
  const who = rows.filter(r => Math.abs(val(r) - best) < 1e-9);
  const names = who.map(r => esc(r.name));
  return { best, who, label: names.length > 1 ? names.slice(0, -1).join(", ") + " &amp; " + names[names.length - 1] : names[0] };
}

function weekRecapHtml() {
  const w = weekStats();
  if (w.team <= 0) return "";
  ensureIcons();
  const played = w.rows.filter(r => r.played > 0), lead = played[0];
  const champs = played.filter(r => r.won === lead.won && r.goalDays === lead.goalDays && r.total === lead.total);
  const goalDays = played.reduce((a, r) => a + r.goalDays, 0);
  const head = champs.length > 1 ? esc(champs.map(r => r.name).join(" & ")) + " shared the week" : esc(lead.name) + " won the week";
  const h = ['<section class="recap week"><div class="recap-head"><p class="eyebrow">Last week &middot; ' + esc(shortDate(w.start)) +
             ' &ndash; ' + esc(shortDate(w.end)) + '</p><h3>' + hatSvg(32, 21, "rc-crown", false) + head +
             '</h3><p class="recap-sub">' + played.length + ' played &middot; ' + plural(goalDays, "goal day") + ' &middot; ' +
             fmtOz(w.team) + ' fl oz together' +
             (w.prevTeam > 0 ? ' <span class="' + (w.team >= w.prevTeam ? "up" : "down") + '">' + (w.team >= w.prevTeam ? "&#9650; " : "&#9660; ") +
                               Math.abs(Math.round((w.team / w.prevTeam - 1) * 100)) + '% on the week before</span>' : '') + '</p></div>'];

  h.push('<ol class="recap-podium">');
  played.slice(0, 3).forEach((r, i) => {
    h.push('<li class="pod p' + (i + 1) + '" style="--pc:' + r.color + '"><span class="medal m' + (i + 1) + '">' + (i + 1) + '</span>' +
           '<span class="pn">' + esc(r.name) + '</span><span class="pv">' + plural(r.won, "day") + ' won</span>' +
           '<span class="po">' + r.goalDays + ' of ' + r.here + ' goal days &middot; ' + fmt(r.total) + ' oz</span></li>');
  });
  h.push('</ol><div class="recap-cols">');

  /* Highlights: one line each, only when somebody earned it. */
  const hl = [], line = (k, v) => hl.push('<li><span class="k">' + k + '</span><span class="v">' + v + '</span></li>');
  const most = topBy(played, r => r.total);
  if (most) line("Most water", most.label + ' &middot; ' + fmt(most.best) + ' oz');
  const steady = topBy(played, r => r.goalDays);
  if (steady) line("Most goal days", steady.label + ' &middot; ' + plural(steady.best, "day"));
  const improved = topBy(played.filter(r => r.played >= 3 && r.prevPlayed >= 3), r => r.avg - r.prevAvg, 0.05);
  if (improved) line("Most improved", improved.label + ' &middot; +' + Math.round(improved.best * 100) + ' points of goal a day');
  const big = topBy(played, r => r.best.oz);
  if (big) line("Biggest day", big.label + ' &middot; ' + fmt(big.best) + ' oz on ' + esc(weekday(big.who[0].best.day)));
  const streak = topBy(w.rows.filter(r => isActive(r.p)), r => streaks(r.p).goal, 2);
  if (streak) line("Goal streak", streak.label + ' &middot; ' + plural(streak.best, "day") + ' and counting');
  const rare = topBy(w.rows.filter(r => r.found.length), r => Math.max(...r.found.map(WEEK_RARITY)), 0);
  if (rare) {
    const k = rare.who[0].found.reduce((a, b) => WEEK_RARITY(b) > WEEK_RARITY(a) ? b : a);
    line("Rarest find", rare.label + ' &middot; the ' + esc(petLabel(k)) + ' <span class="rar">' + esc(rarityLabel(k)) + '</span>');
  }
  const chest = topBy(w.rows.filter(r => r.shop), r => r.shop.chestWon);
  if (chest) line("Chest", chest.label + ' won ' + plural(chest.best, "token"));
  const sunk = topBy(w.rows, r => r.drowned.length);
  if (sunk) line("Most drownings", sunk.label + ' &middot; ' + plural(sunk.best, "pet"));
  h.push('<div><h4>Highlights</h4>' + (hl.length ? '<ul class="rc-hl">' + hl.join("") + '</ul>' : '<p class="dim">A quiet week.</p>') + '</div>');

  /* Pets: new finds and drownings, one line per person. */
  const ev = [], icon = k => penOf(k) > 0 ? '<i class="pi pi-' + k + '"></i>' : '';
  for (const r of w.rows) {
    const who = '<strong>' + esc(r.name) + '</strong> ', li = (ic, text) => '<li>' + ic + '<span class="rc-t">' + who + text + '</span></li>';
    const found = [...new Set(r.found)];
    if (found.length) ev.push(li(icon(found[0]), 'found ' + (found.length > 1 ? found.length + ' new: ' : '') + petList(found)));
    if (r.revived.length) ev.push(li(icon(r.revived[0]), 'brought back ' + petList([...new Set(r.revived)])));
    if (r.drowned.length) ev.push(li('<i class="pi pi-grave"></i>', 'drowned ' + petList(r.drowned)));
  }
  h.push('<div><h4>Pets</h4>' + (ev.length ? '<ul class="rc-pets">' + ev.join("") + '</ul>' : '<p class="dim">No pet news.</p>') + '</div>');

  const out = w.rows.filter(r => !r.played && r.here > 0);
  h.push('<div><h4>Sat out</h4>' + (out.length ? out.map(r => '<span class="rc-chip dim"><i class="dot" style="background:' + r.color +
         '"></i>' + esc(r.name) + '</span>').join("") : '<p class="dim">Everyone played.</p>') + '</div>');
  h.push('</div>');
  const shop = w.rows.filter(r => r.shop).map(r => ({ p: r.p, d: r.shop }));
  if (shop.length) h.push(recapShop(shop));
  h.push('</section>');
  return h.join("");
}

/* The token shop on the recap day: a total, then one line per person. */
function recapShop(shop) {
  const sum = (f) => shop.reduce((a, x) => a + f(x.d), 0);
  const drops = sum(d => d.drops), spent = sum(d => d.spent), winners = shop.filter(x => x.d.chestWon > 0);
  const h = ['<div class="recap-shop"><h4>Token shop</h4><p class="rc-shop-sum">' +
             drops + ' Plinko drop' + (drops === 1 ? '' : 's') + ' &middot; ' + spent + ' token' + (spent === 1 ? '' : 's') + ' spent' +
             (sum(d => d.chestIn) ? ' &middot; ' + sum(d => d.chestIn) + ' into the Community Chest' : '') +
             winners.map(x => ' &middot; <b class="rc-win">' + esc(x.p.name) + ' won the chest: ' + x.d.chestWon + ' tokens</b>').join("") +
             '</p><ul class="rc-shop-list">'];
  shop.sort((a, b) => b.d.spent - a.d.spent || (a.p.name < b.p.name ? -1 : 1));
  for (const { p, d } of shop) {
    const bits = [];
    if (d.drops) bits.push(d.drops + ' drop' + (d.drops === 1 ? '' : 's'));
    if (d.fresh.length + d.revived.length) bits.push((d.fresh.length + d.revived.length) + ' new');
    if (d.repeats) bits.push(d.repeats + ' repeat' + (d.repeats === 1 ? '' : 's'));
    if (d.chestIn) bits.push(d.chestIn + ' into the chest');
    if (d.empty) bits.push(d.empty + ' returned');
    if (d.buys.length) bits.push(d.buys.length + ' bought');
    if (d.picks && d.picks.length) bits.push(d.picks.length + ' from shards');
    if (d.fuses && d.fuses.length) bits.push(d.fuses.length + ' combine' + (d.fuses.length === 1 ? '' : 's'));
    if (d.rerolls.length) bits.push('rerolled');
    if (d.style && d.style.length) bits.push(d.style.length + ' style');
    h.push('<li><i class="dot" style="background:' + p.color + '"></i><strong>' + esc(p.name) + '</strong>' +
           '<span class="rc-spent"><span class="coin sm"></span>' + d.spent + '</span>' +
           '<span class="dim">' + bits.join(' &middot; ') + '</span>' +
           (d.chestWon ? '<span class="pill good">won ' + d.chestWon + '</span>' : '') + '</li>');
  }
  h.push('</ul></div>');
  return h.join("");
}

/* ---- the whole page ----------------------------------------------------- */
/* The folder's own heading, tagline and tab title. */
function renderBrand() {
  const t = S.settings.title || C.DEFAULT_TITLE, g = S.settings.tagline || C.DEFAULT_TAGLINE;
  if ($("appTitle").textContent !== t) $("appTitle").textContent = t;
  if ($("appTagline").textContent !== g) $("appTagline").textContent = g;
  if (document.title !== t) document.title = t;
}

export function render() {
  maskEls = [];
  setEventRanges(S.settings.events);
  renderBrand();
  renderEventBanner();
  G.setActive(ui.tab === "today");
  if (ui.tab === "today") {
    renderGlasses(); renderLeaderboard(); renderActivity();
  } else if (ui.tab === "pets") renderPets();
  else if (ui.tab === "shop") { if (uiHooks.renderShop) uiHooks.renderShop(); }
  else renderHistory();
  renderTeamBar();
  renderStaleWarning();
  renderStatus();
  if (uiHooks.bottle) uiHooks.bottle();
}

export function setTab(name) {
  ui.tab = name;
  for (const t of ["today", "history", "pets", "shop"]) {
    $("view-" + t).hidden = t !== name;
    $("tab-" + t).setAttribute("aria-selected", String(t === name));
  }
  if (name === "pets") htmlCache.pets = "";
  render();
}

/* ---- the unlock card ---------------------------------------------------- */
/* Shown on the machine that made the roll. The rarity chip flashes through the
   tiers, slowing, lands on the real one, and the pet appears. The pet stays out of
   its glass until the card closes, then drops in. */
const unlockQueue = [];
let unlockBusy = false;

export function showUnlock(info) {
  unlockQueue.push(info);
  if (!unlockBusy) nextUnlock();
}

async function nextUnlock() {
  const info = unlockQueue.shift();
  if (!info) { unlockBusy = false; return; }
  unlockBusy = true;
  try { await playUnlock(info); } catch { $("unlock").hidden = true; }
  G.releaseDrop(info.name);
  if (!info.bought) { rollCardDone(info.name); render(); }
  if (info.msg) setMsg(info.msg, true);
  nextUnlock();
}

function tierOf(kind) {
  if (kind === C.MYSTERY_KIND) return "rm";
  if (kind === C.HOMUNCULUS_KIND) return "rh";
  return "r" + petBinIndex(kind);
}

function drawRevealPet(info) {
  const cv = $("ulPet"), dpr = Math.min(window.devicePixelRatio || 1, 3), size = 120;
  cv.width = size * dpr; cv.height = size * dpr;
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);
  if (info.kind === C.MYSTERY_KIND) drawCritter(ctx, 66, 104, 28, 0, false, false, info.kind, 0);
  else if (info.kind === C.HOMUNCULUS_KIND) drawCritter(ctx, 60, 98, 34, 0, false, false, info.kind, info.hue);
  else drawPortrait(ctx, 60, 84, 40, info.kind, info.hue);
}

function confetti(n) {
  const cols = ["#facc15", "#38bdf8", "#f472b6", "#4ade80", "#c084fc", "#fb923c"], h = [];
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, d = 90 + Math.random() * 110;
    h.push('<i style="--dx:' + Math.round(Math.cos(a) * d) + 'px;--dy:' + Math.round(Math.sin(a) * d - 40) +
           'px;--rot:' + Math.round(Math.random() * 720 - 360) + 'deg;--c:' + cols[i % cols.length] +
           ';animation-delay:' + Math.round(Math.random() * 120) + 'ms"></i>');
  }
  return h.join("");
}

function playUnlock(info) {
  return new Promise(resolve => {
    const box = $("unlock"), card = $("ulCard"), chip = $("ulRarity");
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const tier = tierOf(info.kind), label = petLabel(info.kind);
    $("ulWho").textContent = info.title ? info.title : info.kind === C.MYSTERY_KIND ? info.name + " found something" : info.name + " reached the goal";
    $("ulName").innerHTML = "";
    $("ulBurst").innerHTML = "";
    $("ulQ").hidden = false;
    $("ulPet").getContext("2d").clearRect(0, 0, 9999, 9999);
    card.className = "ul-card spinning";
    box.hidden = false;

    let done = false, hold = 0;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(hold);
      card.classList.add("leaving");
      setTimeout(() => { box.hidden = true; resolve(); }, 320);
    };
    card.onclick = finish;

    const spins = reduce ? [] : C.REVEAL_SPIN, target = tier === "rm" || tier === "rh" ? 4 : petBinIndex(info.kind);
    let i = 0;
    const flash = () => {
      if (done) return;
      if (i < spins.length) {
        const b = ((target - (spins.length - i)) % C.PET_BINS.length + C.PET_BINS.length) % C.PET_BINS.length;
        chip.className = "ul-rarity r" + b;
        chip.textContent = C.PET_BINS[b].name;
        setTimeout(flash, spins[i++]);
        return;
      }
      chip.className = "ul-rarity " + tier;
      chip.textContent = rarityLabel(info.kind);
      $("ulQ").hidden = true;
      drawRevealPet(info);
      $("ulName").innerHTML = info.kind === C.HOMUNCULUS_KIND
        ? 'All ' + C.PET_COUNT + ' found. The pen made the <b>' + esc(label) + '</b>'
        : info.kind === C.MYSTERY_KIND
          ? '<b>' + esc(label) + '</b><small>It is not from the pen. Keep it on.</small>'
          : info.fresh ? '<span class="ul-new">New</span> <b>' + esc(label) + '</b>'
                       : 'Another <b>' + esc(label) + '</b>';
      card.className = "ul-card revealed " + tier + (info.fresh ? " fresh" : "");
      if (info.fresh && !reduce) $("ulBurst").innerHTML = confetti(30);
      hold = setTimeout(finish, C.REVEAL_HOLD_MS);
    };
    flash();
  });
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
  const spent = spentTotal(p), bal = shownBalance(p), chest = chestWinnings(p) - (balance(p) - bal);
  $("bankShop").hidden = p.name !== S.mine;        /* only your own tokens */
  $("bankShop").dataset.name = p.name;
  $("bankName").innerHTML = esc(p.name) + "&rsquo;s gold";
  $("bankCount").innerHTML = bal + ' <small>token' + (bal === 1 ? '' : 's') + '</small>';
  const bonus = earnedTotal(p) - tokensEarned(p) - chestWinnings(p);
  $("bankNote").innerHTML = "one for every goal day" + (bonus ? " &middot; " + bonus + " cap bonus" : "") +
                            (chest ? " &middot; " + chest + " from the chest" : "") +
                            (spent ? " &middot; " + spent + " spent" : "") +
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
  if (duplicateNames().length) probs.push("duplicate names: " + duplicateNames().join(", "));
  if (S.htaWriters.length) probs.push(S.htaWriters.length + " file(s) last written by an old HTA");
  if (S.loadFailed) probs.push(S.loadFailed + " unreadable file(s)");
  if (G.stats.errors) probs.push(G.stats.errors + " animation error(s)");
  if (diag.lastError) probs.push("last error: " + diag.lastError);

  h.push('<h4>Health</h4><table class="rt">');
  h.push(rRow("Status", probs.length ? '<span class="bad">' + esc(probs.join(" · ")) + '</span>' : '<span class="ok">all clear</span>'));
  h.push(rRow("Build", esc(C.REV) + ' <span class="dim">&middot; writes as "' + esc(C.APP_VERSION) + '", format ' + C.FORMAT_REV + '</span>'));
  h.push(rRow("Data folder", esc(dir ? dir.name : "(none)")));
  for (const e of S.htaLog.slice(-8).reverse()) {
    h.push(rRow("Old HTA write", '<span class="bad">' + esc(e.file) + '</span> by ' + esc(e.user) + ' (' + esc(e.ver) + ') at ' + esc(String(e.at).replace("T", " ")) +
                ' <span class="dim">&middot; seen ' + esc(String(e.seen || "").replace("T", " ")) + (e.by ? ' by ' + esc(e.by) : '') + '</span>'));
  }
  h.push(rRow("Files", S.participants.length + ' loaded' + (S.loadRecovered ? ' &middot; <span class="bad">' + S.loadRecovered + ' recovered</span>' : '')));
  h.push('</table>');

  h.push('<h4>People <span class="note">goal and cap are for today</span></h4><table class="rt"><tr><th>Name</th>' +
         '<th class="n">Goal</th><th class="n">Cap</th><th class="n">Today</th><th class="n">Pets</th><th>Wearing</th><th></th></tr>');
  for (const p of S.participants) {
    h.push('<tr><td>' + esc(p.name) + '</td><td class="n">' + fmt(currentGoalFor(p)) + '</td><td class="n">' + fmt(capFor(p, key)) +
           '</td><td class="n">' + fmt(totalOn(p, key)) + '</td><td class="n">' + pensOf(p).map(x => penAlive(p, x) + '/' + C.PET_COUNT).join(' + ') +
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
  h.push(rRow("Signed in as", esc(S.me || "(not set)") + (S.mine ? ' &middot; glass: ' + esc(S.mine) : '')));
  h.push(rRow("Writes", diag.writes + ' this session' + (diag.lockSteals ? ' &middot; ' + diag.lockSteals + ' stale lock(s) cleared' : '')));
  h.push(rRow("Backup", diag.lastBackup ? esc(C.BACKUP_SUBDIR + '/' + diag.lastBackup) + ' <span class="dim">&middot; ' + C.BACKUP_KEEP_DAYS + ' days kept</span>'
                                        : '<span class="bad">none yet this session</span>'));
  h.push(rRow("Drawn pets", Object.keys(petDefs).length + Object.keys(petHats).length ? esc([...Object.keys(petDefs).map(k => C.PET_NAMES[k]), ...Object.keys(petHats)].join(", ")) + (petSource.from === "folder" ? '' : ' <span class="dim">from pets/pets.json</span>')
                                                       : '<span class="dim">none &middot; all built-in</span>') +
    (petSource.from === "folder" ? ' <span class="bad">from this folder&rsquo;s ' + esc(C.FOLDER_PETS_FILE) + ' (test art)</span>' : ''));
  h.push(rRow("Layout", G.dims.cols + ' per row &middot; ' + G.dims.card + 'px cards &middot; ' + G.dims.gw + '&times;' + G.dims.gh + 'px glasses'));
  h.push(rRow("Animation", G.stats.fps + ' fps &middot; ' + G.bubbleCount() + ' bubbles' +
              (G.stats.errors ? ' &middot; <span class="bad">' + G.stats.errors + ' errors, last: ' + esc(G.stats.lastError) + '</span>' : '')));
  h.push('</table>');
  if (diag.trail.length) h.push('<h4>Trail</h4><pre class="trail">' + esc(diag.trail.join("\n")) + '</pre>');
  showReport("Diagnostics", C.REV, h.join(""));
}

/* ---- settings panel ----------------------------------------------------- */
export function fillSettings() {
  $("titleVal").value = S.settings.title || "";
  $("taglineVal").value = S.settings.tagline || "";
  $("goalVal").value = currentGoal();
  $("annualVal").value = currentAnnualGoal();
  $("startVal").value = challengeStart();
  $("idleVal").value = currentIdleMax();
  renderEvents();
  renderRoster();
}

/* Settings > Events: one row per themed holiday, its days as MM-DD (blank = the default). */
function renderEvents() {
  const now = holidayOn();
  $("eventList").innerHTML = EVENTS.map(h => {
    const r = eventRange(h), d = eventDefault(h), own = S.settings.events && S.settings.events[h.theme];
    return '<div class="ev-row" data-ev="' + esc(h.theme) + '">' +
      '<label class="ev-on"><input type="checkbox"' + (r.on ? ' checked' : '') + '> ' + esc(h.name) +
      (now === h ? ' <span class="ev-now">on now</span>' : '') + '</label>' +
      '<input class="txt md" type="text" maxlength="5" spellcheck="false" data-k="from" placeholder="' + d.from + '" value="' + (own ? esc(r.from) : '') + '" aria-label="' + esc(h.name) + ' from (MM-DD)">' +
      '<span class="unit">to</span>' +
      '<input class="txt md" type="text" maxlength="5" spellcheck="false" data-k="to" placeholder="' + d.to + '" value="' + (own ? esc(r.to) : '') + '" aria-label="' + esc(h.name) + ' to (MM-DD)"></div>';
  }).join("");
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
  const away = S.participants.filter(p => !isActive(p)).length;
  $("rosterCount").textContent = S.participants.length + (away ? " · " + away + " away" : "");
}
