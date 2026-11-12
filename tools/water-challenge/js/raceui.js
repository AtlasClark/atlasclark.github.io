/* The Casino tab: balances and the pet races (Plinko's panel is drawn by shopui.js).
   Pick a pet, look at the field, put a stake on any racer, watch the race. The result
   is saved when the race starts (shop.js racePlay); the track replays it from its seed
   and reveal.js keeps the winnings and the stat changes out of sight until the finish. */

import * as C from "./config.js";
import { findParticipant, S } from "./model.js";
import * as store from "./store.js";
import { $, esc, has, prettyTime } from "./util.js";
import { raceSetup, raceBlock, racePlay, racePayFor, racesLeft } from "./shop.js";
import { statsOf, runRace, rating, FRAME_SECS } from "./race.js";
import { raceDone, racesHeld, shownBalance, shownShells } from "./reveal.js";
import { petLabel, rarityLabel, petBinIndex, penOf } from "./pets.js";
import { drawPortrait } from "./art.js";
import { setMsg, ensureIcons, ui, render, setHtml } from "./ui.js";
import { shopFor } from "./shopui.js";

const R = C.RACE, RATE = 1.35;                 /* the track plays a little faster than the race's own clock */
const LANE_COL = ["#e4572e", "#f2a541", "#76b041", "#17bebb", "#4f6fd8", "#a05cc5"];
const ORD = ["1st", "2nd", "3rd", "4th", "5th", "6th"];
const KEY = "awc-race";

let hooks = null;
let run = null;        /* the race on the track: { id, out, setup, res, t0 } */
let shown = null;      /* the last finished race, left on the track until "Next race" */
let busy = false, cv = null, ctx = null, W = 0, H = 0, LH = 0;
/* This browser's choices: the pet, what to stake, and (for the field named by key) who on. */
const pick = { pet: -1, cur: "shell", stake: R.shellBets[1], on: -1, type: "win", key: "" };
try {
  const o = JSON.parse(localStorage.getItem(KEY)) || {};
  if (Number(o.pet) >= 0) pick.pet = Number(o.pet);
  if (o.cur === "token") pick.cur = "token";
  if (R.shellBets.includes(o.stake)) pick.stake = o.stake;
} catch { }
const keep = () => { try { localStorage.setItem(KEY, JSON.stringify({ pet: pick.pet, cur: pick.cur, stake: pick.stake })); } catch { } };

const fresh = p => findParticipant(p.name) || p;
const betOf = () => ({ cur: pick.cur, stake: pick.cur === "token" ? R.tokenBet : pick.stake, on: pick.on, type: pick.cur === "token" ? "win" : pick.type });
const money = (n, cur) => n + " " + (cur === "token" ? "token" : "shell") + (n === 1 ? "" : "s");
const racer = (f, cap) => (f.me ? (cap ? "Your " : "your ") : (cap ? "The " : "the ")) + petLabel(f.kind);

export function initCasino(h) {
  hooks = h;
  cv = $("raceCanvas");
  $("casinoBalance").addEventListener("click", e => { if (e.target.closest("[data-act=whoami]")) hooks.whoAmI(); });
  $("racePets").addEventListener("click", e => {
    const b = e.target.closest("[data-pet]");
    if (!b || run) return;
    pick.pet = Number(b.dataset.pet); shown = null; keep(); renderCasino();
  });
  $("raceField").addEventListener("click", e => {
    const b = e.target.closest("[data-on]");
    if (!b || run || shown) return;
    pick.on = Number(b.dataset.on); pick.type = b.dataset.type === "top3" ? "top3" : "win"; renderCasino();
  });
  $("raceBet").addEventListener("click", e => {
    const c = e.target.closest("[data-cur]"), s = e.target.closest("[data-stake]");
    if (run || shown || !(c || s)) return;
    if (c) pick.cur = c.dataset.cur === "token" ? "token" : "shell"; else pick.stake = Number(s.dataset.stake);
    keep(); renderCasino();
  });
  $("raceStakes").innerHTML = R.shellBets.map(b => '<button type="button" class="seg" data-stake="' + b + '">' + b + '</button>').join("");
  $("raceGo").addEventListener("click", go);
  window.addEventListener("resize", () => { if (ui.tab === "casino") paint(); });
}

/* ---- rendering -------------------------------------------------------------- */
export function renderCasino() {
  ensureIcons();
  const p = shopFor();
  $("casinoGrid").hidden = !p;
  if (!p) {
    setHtml("casinoBalance", S.participants.length
      ? 'Set <b>your glass</b> to play. <button type="button" class="btn primary small" data-act="whoami">Pick your glass</button>'
      : "Nobody on the roster yet.");
    return;
  }
  const tok = shownBalance(p), sh = shownShells(p);
  setHtml("casinoBalance", '<span class="coin"></span><b>' + tok + '</b> token' + (tok === 1 ? '' : 's') +
    ' <span class="dim">&middot;</span> <span class="shellico"></span><b>' + sh + '</b> shell' + (sh === 1 ? '' : 's'));
  renderRace(p);
}

/* The race on the track or just finished belongs to one pet; everything follows it. */
const live = () => run || shown;

function renderRace(p) {
  const kinds = Object.keys(p.pets || {}).map(Number).filter(k => k >= 0 && k < C.PET_MAX).sort((a, b) => a - b);
  $("raceBody").hidden = !kinds.length;
  if (!kinds.length) { setHtml("racePets", '<p class="dim">No pets to race yet.</p>'); return; }
  const cur = live();
  if (cur) pick.pet = cur.out.kind;
  else if (!kinds.includes(pick.pet)) { const worn = store.petKindFor(p); pick.pet = kinds.includes(worn) ? worn : kinds[0]; }
  const k = pick.pet, held = new Set(racesHeld(p).map(s => s.id));
  if (run) held.add(run.id);

  setHtml("racePets", kinds.map(x => {
    const st = statsOf(p, x, held), left = racesLeft(p, x);
    return '<button type="button" class="race-pet' + (x === k ? ' on' : '') + (left ? '' : ' tired') + '" data-pet="' + x + '" title="' +
           esc(petLabel(x)) + ' &middot; level ' + st.level + ' &middot; ' + (left ? left + ' of ' + R.perPet + ' races left today' : 'tired until tomorrow') + '">' +
           '<i class="pi pi-' + x + '"></i><span class="rl">L' + st.level + '</span>' +
           '<span class="pips">' + Array.from({ length: R.perPet }, (_, i) => '<i' + (i < left ? ' class="on"' : '') + '></i>').join("") + '</span></button>';
  }).join(""));

  const me = statsOf(p, k, held), tier = penOf(k) > 0 ? petBinIndex(k) : 4;
  const kindOf = penOf(k) > 0 ? rarityLabel(k) : k === C.MYSTERY_KIND ? "One of a kind" : "Pen reward";
  setHtml("raceCard", '<div class="rc-head"><i class="pi pi-' + k + '"></i><div class="rc-id"><b>' + esc(petLabel(k)) + '</b> <span class="rar r' + tier + '">' +
    esc(kindOf) + '</span><span class="rc-lv">Level ' + me.level + '</span>' +
    '<div class="xp" title="' + (me.need ? me.into + ' / ' + me.need + ' xp to level ' + (me.level + 1) : 'top level') + '"><i style="width:' +
    (me.need ? Math.round(me.into / me.need * 100) : 100) + '%"></i></div>' +
    '<span class="dim">' + me.races + ' race' + (me.races === 1 ? '' : 's') + ' &middot; ' + me.wins + ' won</span></div></div>' +
    '<div class="rc-stats">' + C.RACE_STATS.map((n, i) => {
      const d = me.st[i] - me.base[i];
      return '<div class="rs"><span>' + n + '</span><div class="bar"><i style="width:' + me.st[i] + '%"></i><em style="left:' + me.base[i] + '%"></em></div><b>' + me.st[i] + '</b>' +
             '<small class="' + (d > 0 ? 'up' : d < 0 ? 'dn' : '') + '">' + (d > 0 ? '+' + d : d < 0 ? '&minus;' + -d : '') + '</small></div>';
    }).join("") + '</div>');

  const setup = cur ? cur.setup : raceSetup(p, k);
  if (!cur && pick.key !== setup.key) { pick.key = setup.key; pick.on = setup.mine; pick.type = "win"; }
  const token = pick.cur === "token", bet = cur ? cur.out.bet : betOf(), done = shown ? shown.out.places : null;
  const cell = (i, type, label) => {
    const pay = racePayFor(setup, Object.assign({}, bet, { on: i, type }));
    const on = bet.on === i && bet.type === type;
    return '<button type="button" class="rf-bet' + (on ? ' on' : '') + '" data-on="' + i + '" data-type="' + type + '"' + (pay && !cur ? '' : ' disabled') +
           ' title="' + (pay ? money(bet.stake, bet.cur) + ' pays ' + pay : 'No payout on this one') + '"><span>' + label + '</span><b>' + (pay || '&ndash;') + '</b></button>';
  };
  setHtml("raceField", '<div class="rf-head"><span></span><span></span><span>Racer</span><span title="The average of its five stats">Rating</span><span>' +
    money(bet.stake, bet.cur) + ' pays</span></div>' + setup.field.map((f, i) =>
    '<div class="rf-row' + (f.me ? ' me' : '') + (bet.on === i ? ' sel' : '') + '" title="' + C.RACE_STATS.map((n, j) => n + ' ' + f.st[j]).join(' &middot; ') + '">' +
    '<span class="rf-no" style="background:' + LANE_COL[i] + '">' + (done ? ORD[done[i] - 1] : i + 1) + '</span>' +
    '<i class="pi pi-' + f.kind + '"></i><span class="rf-name">' + esc(petLabel(f.kind)) + (f.me ? ' <span class="pill">yours</span>' : '') + '</span>' +
    '<span class="rf-ovr">' + rating(f.st) + '</span>' +
    '<span class="rf-bets">' + cell(i, "win", "Win") + (token ? '' : cell(i, "top3", "Top 3")) + '</span></div>').join(""));

  for (const b of $("raceBet").querySelectorAll("[data-cur]")) { const on = b.dataset.cur === pick.cur; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); b.disabled = !!cur; }
  for (const b of $("raceStakes").children) { const on = Number(b.dataset.stake) === pick.stake; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); b.disabled = !!cur; }
  $("raceStakes").hidden = token;

  const why = cur ? "" : raceBlock(p, k, bet), on = setup.field[bet.on] || setup.field[setup.mine];
  $("raceGo").disabled = !!run || busy || (!shown && !!why);
  $("raceGo").style.setProperty("--pc", p.color);
  setHtml("raceGo", shown ? "Next race" : run ? "They&rsquo;re off" :
    'Race &middot; ' + money(bet.stake, bet.cur) + ' on ' + esc(racer(on)) + (bet.type === "top3" ? ' in the top 3' : ' to win'));
  $("raceNote").textContent = why;
  setHtml("raceResult", shown ? resultHtml(shown.out) : "");
  $("raceResult").hidden = !shown;

  const past = (p.spends || []).filter(s => s.kind === C.RACE_KIND && !held.has(s.id)).slice(-8).reverse();
  setHtml("raceFeed", past.length ? past.map(s => '<li><span class="t">' + esc(prettyTime(s.at)) + '</span><strong>' + esc(petLabel(Number(s.pet))) + '</strong> ' +
      ORD[Number(s.place) - 1] + ' <span class="dim">&middot; ' + money(Number(s.bet), s.cur) + ' on ' +
      (Number(s.on) === Number(s.pet) ? 'it' : 'the ' + esc(petLabel(Number(s.on)))) + (s.type === "top3" ? ' top 3' : ' to win') + '</span> ' +
      (Number(s.won) ? '<span class="pill good">+' + money(Number(s.won), s.cur) + '</span>' : '<span class="dim">lost</span>') + '</li>').join("")
    : '<li class="dim">No races yet.</li>');
  paint();
}

/* What a finished race gave: the place, the experience and stat changes, and the bet. */
function resultHtml(o) {
  const f = o.field[o.mine], on = o.field[o.bet.on];
  const ch = o.d.map((d, i) => d ? '<span class="' + (d > 0 ? 'up' : 'dn') + '">' + C.RACE_STATS[i] + (d > 0 ? ' +' + d : ' &minus;' + -d) + '</span>' : '').filter(Boolean);
  return '<p><b>' + esc(racer(f, true)) + ' finished ' + ORD[o.place - 1] + '.</b> +' + o.xp + ' xp' +
         (o.levelUp ? ' <span class="pill good">level ' + o.level + '</span>' : '') + (ch.length ? ' &middot; ' + ch.join(' &middot; ') : '') + '</p>' +
         '<p>' + esc(racer(on, true)) + (o.bet.type === "top3" ? ' in the top 3: ' : ' to win: ') +
         (o.won ? '<span class="pill good">won ' + money(o.won, o.bet.cur) + '</span>' : 'lost ' + money(o.bet.stake, o.bet.cur) + '.') + '</p>';
}

/* ---- the track ---------------------------------------------------------------- */
function fit() {
  const w = Math.max(280, Math.min(920, Math.floor($("raceWrap").clientWidth)));
  const lh = Math.max(32, Math.min(58, Math.round(w / 13))), h = 12 + R.lanes * lh + 12;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  if (w !== W || h !== H || cv.width !== Math.round(w * dpr)) {
    W = w; H = h; LH = lh;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    cv.style.width = w + "px"; cv.style.height = h + "px";
  }
  ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/* The still picture: the field on the start line, or the last race at the finish. */
function paint() {
  if (!cv || !$("raceWrap").clientWidth) return;
  if (run) { drawRun(performance.now()); return; }
  const p = shopFor();
  if (!p) return;
  if (shown) { drawTrack(shown, shown.res.frames.at(-1).x, null, null, shown.res.secs + 9, 0, ""); return; }
  if (!has(p.pets, pick.pet)) return;
  const setup = raceSetup(p, pick.pet);
  drawTrack({ setup, out: { color: p.color, bet: betOf() } }, setup.field.map(() => 0), null, null, -1, 0, "");
}

function drawRun(now) {
  const t = (now - run.t0) / 1000 - R.countSecs, rt = Math.max(0, t) * RATE, fr = run.res.frames;
  const at = Math.min(fr.length - 1, rt / FRAME_SECS), i = Math.floor(at), a = at - i, j = Math.min(fr.length - 1, i + 1);
  const x = fr[i].x.map((v, n) => v + (fr[j].x[n] - v) * a), sp = fr[i].x.map((v, n) => (fr[j].x[n] - v) / FRAME_SECS);
  drawTrack(run, x, fr[i].f, sp, rt, now / 1000, t < 0 ? String(Math.ceil(-t)) : t < 0.7 ? "Go" : "");
}

/* r: { setup, out: { color, bet } [, res] }; x: where each lane is (0..track); f: flags;
   sp: speeds; rt: the race clock (-1 = not started); clock: seconds, for the bobbing. */
function drawTrack(r, x, f, sp, rt, clock, word) {
  fit();
  const field = r.setup.field, n = field.length, top = 12, pr = LH * 0.4, x0 = 36 + pr * 1.5, x1 = W - 58;
  const dark = getComputedStyle(document.documentElement).colorScheme === "dark";
  ctx.clearRect(0, 0, W, H);
  for (let i = 0; i < n; i++) {
    const y = top + i * LH;
    ctx.fillStyle = "rgba(46,150,225," + ((dark ? 0.2 : 0.14) + (i % 2) * 0.06) + ")";
    ctx.fillRect(0, y, W, LH);
    if (field[i].me) { ctx.fillStyle = r.out.color || "#1688d4"; ctx.globalAlpha = 0.2; ctx.fillRect(0, y, W, LH); ctx.globalAlpha = 1; }
  }
  ctx.strokeStyle = dark ? "rgba(255,255,255,.32)" : "rgba(255,255,255,.9)";
  ctx.lineWidth = 2; ctx.setLineDash([7, 7]);
  for (let i = 0; i <= n; i++) { ctx.beginPath(); ctx.moveTo(0, top + i * LH); ctx.lineTo(W, top + i * LH); ctx.stroke(); }
  ctx.setLineDash([]);
  ctx.fillStyle = dark ? "rgba(255,255,255,.45)" : "rgba(23,50,77,.4)";
  ctx.fillRect(x0 - 1, top, 2, n * LH);                                          /* the start line */
  const sq = LH / 4;                                                             /* the finish: two columns of checks */
  for (let c = 0; c < 2; c++) for (let q = 0; q < n * 4; q++) {
    ctx.fillStyle = (c + q) % 2 ? (dark ? "rgba(255,255,255,.75)" : "#fff") : (dark ? "rgba(0,0,0,.55)" : "rgba(23,50,77,.75)");
    ctx.fillRect(x1 + c * sq, top + q * sq, sq, sq);
  }
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (let i = 0; i < n; i++) {
    const cy = top + (i + 0.5) * LH, bet = r.out.bet && r.out.bet.on === i;
    ctx.fillStyle = LANE_COL[i];
    ctx.beginPath(); ctx.arc(18, cy, 9, 0, 6.2832); ctx.fill();
    if (bet) { ctx.strokeStyle = "#f4c542"; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(18, cy, 12, 0, 6.2832); ctx.stroke(); }
    ctx.fillStyle = "#fff"; ctx.font = "700 11px system-ui, sans-serif";
    ctx.fillText(String(i + 1), 18, cy + 0.5);

    const moving = rt >= 0 && x[i] < R.track && x[i] > 0, flag = f ? f[i] : 0, v = sp ? Math.max(0, sp[i]) / 7 : 0;
    const px = x0 + (x1 - pr * 1.2 - x0) * x[i] / R.track, bob = moving ? Math.sin(clock * 7 + i * 1.7) * 1.4 : 0;
    if (moving && v > 0.15) {                                                    /* the wake; long and bright in a burst */
      ctx.strokeStyle = "rgba(255,255,255," + (flag === 1 ? 0.95 : 0.55) + ")"; ctx.lineWidth = flag === 1 ? 2 : 1.4; ctx.lineCap = "round";
      for (let w = -1; w <= 1; w++) {
        const len = (flag === 1 ? 26 : 12) * v * (1 - Math.abs(w) * 0.3), wy = cy + w * pr * 0.55 + Math.sin(clock * 9 + w + i) * 1.2;
        ctx.beginPath(); ctx.moveTo(px - pr * 1.3, wy); ctx.lineTo(px - pr * 1.3 - len, wy); ctx.stroke();
      }
    }
    ctx.save();
    ctx.translate(px, cy + bob);
    if (flag === 2) ctx.rotate(Math.sin(clock * 24) * 0.28);
    else if (flag === 1) ctx.rotate(0.1);
    ctx.scale(-1, 1);                                                             /* pets are drawn facing left */
    drawPortrait(ctx, 0, 0.6 * pr, pr, field[i].kind, field[i].hue);
    ctx.restore();
    if (flag === 2) {                                                             /* a stumble throws up water */
      ctx.fillStyle = "rgba(255,255,255,.85)";
      for (let d = 0; d < 4; d++) { const a = clock * 9 + d * 1.6; ctx.beginPath(); ctx.arc(px + Math.cos(a) * pr * 1.2, cy - Math.abs(Math.sin(a)) * pr * 1.1, 1.6, 0, 6.2832); ctx.fill(); }
    }
    const res = r.res;
    if (res && rt >= res.time[i]) {
      ctx.font = "800 12px system-ui, sans-serif";
      ctx.fillStyle = res.place[i] === 1 ? "#f4c542" : dark ? "#d9e9f5" : "#17324d";
      ctx.textAlign = "left";
      ctx.fillText(ORD[res.place[i] - 1], x1 + 2 * sq + 6, cy + 0.5);
      ctx.textAlign = "center";
    }
  }
  if (word) {
    ctx.font = "900 " + Math.round(LH * 2.2) + "px system-ui, sans-serif";
    ctx.lineWidth = 6; ctx.strokeStyle = dark ? "rgba(6,18,30,.7)" : "rgba(255,255,255,.85)"; ctx.fillStyle = dark ? "#fff" : "#17324d";
    ctx.strokeText(word, W / 2, H / 2); ctx.fillText(word, W / 2, H / 2);
  }
}

function tick(now) {
  if (!run) return;
  drawRun(now);
  if (((now - run.t0) / 1000 - R.countSecs) * RATE >= run.res.secs + R.endSecs) finish();
  else requestAnimationFrame(tick);
}

function finish() {
  const o = run.out;
  raceDone.add(run.id);
  shown = run; run = null; busy = false;
  render();                                          /* balances, the Pets tab, the activity list */
  setMsg(o.name + "'s " + petLabel(o.kind) + " finished " + ORD[o.place - 1] + (o.won ? ": +" + money(o.won, o.bet.cur) + "." : "."), !!o.won);
}

/* ---- the race button ------------------------------------------------------------ */
async function go() {
  if (run || busy) return;
  if (shown) { shown = null; renderCasino(); return; }
  if (!hooks.guard()) return;
  const p = shopFor();
  if (!p) return;
  const k = pick.pet, bet = betOf();
  busy = true;
  $("raceGo").disabled = true;
  let out = null, why = "";
  await store.serial(async () => {
    const q = fresh(p), setup = raceSetup(q, k);
    if (setup.key !== pick.key) { why = "The field changed. Look again."; return; }    /* another page raced this pet meanwhile */
    why = raceBlock(q, k, bet);
    if (why) return;
    out = await racePlay(q, k, bet);
    if (!out) { why = "That didn't save."; return; }
    run = { id: out.id, out, setup, res: runRace(out.field, out.seed, true), t0: performance.now() };
    await hooks.settle();
  });
  if (!out) { busy = false; renderCasino(); $("raceNote").textContent = why; return; }
  renderCasino();
  requestAnimationFrame(tick);
}

/* The track is sized to its column when the tab opens. */
export function casinoTabChanged(active) { if (active) paint(); }
