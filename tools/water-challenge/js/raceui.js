/* The Casino tab: balances and the pet races (Plinko's panel is drawn by shopui.js).
   Pick a pet, look at the field, put a stake on any racer, watch the race. The result
   is saved when the race starts (shop.js racePlay); the track replays it from its seed
   and reveal.js keeps the winnings and the stat changes out of sight until the finish. */

import * as C from "./config.js";
import { findParticipant, S } from "./model.js";
import * as store from "./store.js";
import { $, esc, has, prettyTime, spendsBy } from "./util.js";
import { raceSetup, raceBlock, racePlay, racePayFor, racesLeft, asksBy, asksFor, duelAskBlock, duelAsk, duelDrop, duelPass, duelTake, duelField, duelsNow, duelRecord } from "./shop.js";
import { statsOf, runRace, rating, FRAME_SECS, canRace } from "./race.js";
import { raceDone, racesHeld, shownBalance, shownShells } from "./reveal.js";
import { petLabel, rarityLabel, petBinIndex, penOf } from "./pets.js";
import { drawPortrait } from "./art.js";
import { lineArt } from "./petdefs.js";
import { setMsg, ensureIcons, ui, render, setHtml } from "./ui.js";
import { shopFor } from "./shopui.js";
import { emit } from "./live.js";

const R = C.RACE, RATE = R.rate;
const LANE_COL = ["#e4572e", "#f2a541", "#76b041", "#17bebb", "#4f6fd8", "#a05cc5"];
const ORD = ["1st", "2nd", "3rd", "4th", "5th", "6th"];
const KEY = "awc-race", HOUSE = C.RACE_HOUSE;

let hooks = null;
let run = null;        /* the race on the track: { id, out, setup, res, t0 } */
let shown = null;      /* the last finished race, left on the track until "Next race" */
let busy = false, cv = null, ctx = null, W = 0, H = 0, LH = 0;
let MAIN = null, STAGE = null;   /* the two tracks: { cv, wrap, lanes } (Casino panel, live 1v1 overlay) */
/* This browser's choices: the pet, what to stake, and (for the field named by key) who on. */
const pick = { pet: -1, cur: "shell", stake: R.shellBets[1], on: -1, type: "win", key: "", who: "" };
try {
  const o = JSON.parse(localStorage.getItem(KEY)) || {};
  if (Number(o.pet) >= HOUSE) pick.pet = Number(o.pet);
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
  MAIN = { cv: $("raceCanvas"), wrap: $("raceWrap"), lanes: R.lanes };
  STAGE = { cv: $("duelCanvas"), wrap: $("duelWrap"), lanes: 2 };
  cv = MAIN.cv;
  initDuels();
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
  window.addEventListener("resize", () => { if (ui.tab === "casino") paint(); if (duel) drawDuel(); });
  /* light / dark and the bought themes change the track's colours: draw it again when the
     page's theme changes, not at the next render (rev 1.49.1) */
  const again = () => requestAnimationFrame(() => { if (ui.tab === "casino") paint(); if (duel && duel.done) drawDuel(); });
  new MutationObserver(again).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-holiday"] });
  if (window.matchMedia) window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", again);
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
  const kinds = Object.keys(p.pets || {}).map(Number).filter(k => k >= 0 && k < C.PET_MAX && canRace(k)).sort((a, b) => a - b);
  const cur = live();
  if (cur) pick.pet = cur.out.kind;
  else if (pick.pet !== HOUSE && !kinds.includes(pick.pet)) { const worn = store.petKindFor(p); pick.pet = kinds.includes(worn) ? worn : kinds.length ? kinds[0] : HOUSE; }
  const k = pick.pet, house = k === HOUSE, held = new Set(racesHeld(p).map(s => s.id));
  if (run) held.add(run.id);

  setHtml("racePets", '<button type="button" class="race-pet house' + (house ? ' on' : '') + '" data-pet="' + HOUSE +
    '" title="House race: six strangers, none of them yours"><span class="flag" aria-hidden="true"></span><span class="hl">House</span></button>' + kinds.map(x => {
    const st = statsOf(p, x, held), left = racesLeft(p, x);
    return '<button type="button" class="race-pet' + (x === k ? ' on' : '') + (left ? '' : ' tired') + '" data-pet="' + x + '" title="' +
           esc(petLabel(x)) + ' &middot; level ' + st.level + ' &middot; ' + (left ? left + ' of ' + R.perPet + ' races left today' : 'tired until tomorrow') + '">' +
           '<i class="pi pi-' + x + '"></i><span class="rl">L' + st.level + '</span>' +
           '<span class="pips">' + Array.from({ length: R.perPet }, (_, i) => '<i' + (i < left ? ' class="on"' : '') + '></i>').join("") + '</span></button>';
  }).join(""));

  $("raceCard").classList.toggle("house", house);
  if (house) setHtml("raceCard", '<div class="rc-head"><span class="flag big" aria-hidden="true"></span><div class="rc-id"><b>House race</b>' +
    '<br><span class="dim">Six strangers. Your pets stay home.</span></div></div>');
  const me = house ? null : statsOf(p, k, held), tier = penOf(k) > 0 ? petBinIndex(k) : 4;
  const rec = house ? { won: 0, lost: 0 } : duelRecord(p.name, k);
  const kindOf = penOf(k) > 0 ? rarityLabel(k) : k === C.MYSTERY_KIND ? "One of a kind" : "Pen reward";
  if (!house) setHtml("raceCard", '<div class="rc-head"><i class="pi pi-' + k + '"></i><div class="rc-id"><b>' + esc(petLabel(k)) + '</b> <span class="rar r' + tier + '">' +
    esc(kindOf) + '</span><span class="rc-lv">Level ' + me.level + '</span>' +
    '<div class="xp" title="' + (me.need ? me.into + ' / ' + me.need + ' xp to level ' + (me.level + 1) : 'top level') + '"><i style="width:' +
    (me.need ? Math.round(me.into / me.need * 100) : 100) + '%"></i></div>' +
    '<span class="dim">' + me.races + ' race' + (me.races === 1 ? '' : 's') + ' &middot; ' + me.wins + ' won' +
    (rec.won + rec.lost ? ' &middot; 1v1: ' + rec.won + ' won, ' + rec.lost + ' lost' : '') + '</span></div></div>' +
    '<div class="rc-stats">' + C.RACE_STATS.map((n, i) => {
      const d = me.st[i] - me.base[i];
      return '<div class="rs"><span>' + n + '</span><div class="bar"><i style="width:' + me.st[i] + '%"></i><em style="left:' + me.base[i] + '%"></em></div><b>' + me.st[i] + '</b>' +
             '<small class="' + (d > 0 ? 'up' : d < 0 ? 'dn' : '') + '">' + (d > 0 ? '+' + d : d < 0 ? '&minus;' + -d : '') + '</small></div>';
    }).join("") + '</div>');

  renderDuelRow(p, k, house || !!run);
  const setup = cur ? cur.setup : raceSetup(p, k);
  if (!cur && pick.key !== setup.key) { pick.key = setup.key; pick.on = setup.mine >= 0 ? setup.mine : setup.odds.win.indexOf(Math.max(...setup.odds.win)); pick.type = "win"; }
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

  const why = cur ? "" : raceBlock(p, k, bet), on = setup.field[bet.on] || setup.field[Math.max(0, setup.mine)];
  $("raceGo").disabled = !!run || busy || (!shown && !!why);
  $("raceGo").style.setProperty("--pc", p.color);
  setHtml("raceGo", shown ? "Next race" : run ? "They&rsquo;re off" :
    'Race &middot; ' + money(bet.stake, bet.cur) + ' on ' + esc(racer(on)) + (bet.type === "top3" ? ' in the top 3' : ' to win'));
  $("raceNote").textContent = why;
  setHtml("raceResult", shown ? resultHtml(shown.out) : "");
  $("raceResult").hidden = !shown;

  const past = spendsBy(p, C.RACE_KIND).slice(-10).filter(s => !held.has(s.id)).slice(-8).reverse();
  setHtml("raceFeed", past.length ? past.map(s => '<li><span class="t">' + esc(prettyTime(s.at)) + '</span><strong>' +
      (s.house ? 'House race' : esc(petLabel(Number(s.pet)))) + '</strong> ' +
      (s.house ? '' : ORD[Number(s.place) - 1]) + ' <span class="dim">&middot; ' + money(Number(s.bet), s.cur) + ' on ' +
      (Number(s.on) === Number(s.pet) ? 'it' : 'the ' + esc(petLabel(Number(s.on))) + (s.house ? ' (' + ORD[Number(s.place) - 1] + ')' : '')) +
      (s.type === "top3" ? ' top 3' : ' to win') + '</span> ' +
      (Number(s.won) ? '<span class="pill good">+' + money(Number(s.won), s.cur) + '</span>' : '<span class="dim">lost</span>') + '</li>').join("")
    : '<li class="dim">No races yet.</li>');
  paint();
}

/* What a finished race gave: the place, the experience and stat changes, and the bet. */
function resultHtml(o) {
  const f = o.field[o.mine], on = o.field[o.bet.on];
  const ch = !f ? [] : o.d.map((d, i) => d ? '<span class="' + (d > 0 ? 'up' : 'dn') + '">' + C.RACE_STATS[i] + (d > 0 ? ' +' + d : ' &minus;' + -d) + '</span>' : '').filter(Boolean);
  return (f ? '<p><b>' + esc(racer(f, true)) + ' finished ' + ORD[o.place - 1] + '.</b> +' + o.xp + ' xp' +
         (o.levelUp ? ' <span class="pill good">level ' + o.level + '</span>' : '') + (ch.length ? ' &middot; ' + ch.join(' &middot; ') : '') + '</p>'
            : '<p><b>' + esc(racer(o.field[o.places.indexOf(1)], true)) + ' won.</b>' + (o.places[o.bet.on] === 1 ? '' : ' ' + esc(racer(on, true)) + ' finished ' + ORD[o.places[o.bet.on] - 1] + '.') + '</p>') +
         '<p>' + esc(racer(on, true)) + (o.bet.type === "top3" ? ' in the top 3: ' : ' to win: ') +
         (o.won ? '<span class="pill good">won ' + money(o.won, o.bet.cur) + '</span>' : 'lost ' + money(o.bet.stake, o.bet.cur) + '.') + '</p>';
}

/* ---- the track ---------------------------------------------------------------- */
/* Laid out like the old arcade derby game, set in a swimming pool (rev 1.48.0): a crowd
   and the tiled deck at the back, six lanes of water with float ropes between them, and
   the pets as big card cut-outs standing in the water, each lane's in front of the one behind it. */
let DPR = 1, BAND = 0;
function fit(t = MAIN) {
  cv = t.cv;
  const w = Math.max(280, Math.min(920, Math.floor(t.wrap.clientWidth)));
  const lh = Math.max(24, Math.min(40, Math.round(w / 19))), band = Math.round(lh * 1.7), h = band + t.lanes * lh + 10;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  W = w; H = h; LH = lh;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    cv.style.width = w + "px"; cv.style.height = h + "px";
  }
  BAND = band; DPR = dpr;
  ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
const offscreen = (w, h) => { const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(w * DPR)); c.height = Math.max(1, Math.round(h * DPR)); return c; };
const frac = v => v - Math.floor(v);
const noise = (a, b) => frac(Math.sin(a * 127.1 + b * 311.7) * 43758.5453);

/* Everything that does not move, drawn once per size and theme. */
const boards = new Map();
const CROWD = ["#e4572e", "#f2a541", "#4f6fd8", "#a05cc5", "#17bebb", "#e9e4d4", "#d9534f", "#3f8a4c", "#f7d6a8"];
const SKIN = ["#f1c9a5", "#d9a57c", "#a8744f", "#7a4f33", "#f6dcc2"];
function backdrop(dark, x0, x1, n) {
  const key = [W, H, DPR, dark, n].join("|");
  if (boards.has(key)) return boards.get(key);
  const board = offscreen(W, H);
  if (boards.size > 5) boards.clear();
  boards.set(key, board);
  const c = board.getContext("2d"), top = BAND, crowdH = BAND * 0.62;
  c.setTransform(DPR, 0, 0, DPR, 0, 0);
  c.fillStyle = dark ? "#1b2a3a" : "#cfe3f2";                                       /* the stand */
  c.fillRect(0, 0, W, top);
  for (let row = 0; row < 3; row++) {                                              /* the crowd: hats, heads and shoulders */
    const y = crowdH * (0.3 + row * 0.3), step = 11;
    for (let x = (row % 2) * 5.5 - 3; x < W + step; x += step) {
      const q = noise(x, row), body = CROWD[Math.floor(noise(x + 1, row) * CROWD.length)];
      c.fillStyle = body; c.beginPath(); c.ellipse(x, y + 7.5, 5.6, 5, 0, 0, 6.2832); c.fill();
      c.fillStyle = SKIN[Math.floor(q * SKIN.length)]; c.beginPath(); c.arc(x, y, 3.3, 0, 6.2832); c.fill();
      if (noise(x, row + 9) < 0.6) {                                               /* a hat */
        c.fillStyle = CROWD[Math.floor(noise(x + 2, row + 5) * CROWD.length)];
        c.fillRect(x - 4.6, y - 2.6, 9.2, 1.5); c.fillRect(x - 2.6, y - 5.4, 5.2, 3);
      }
    }
  }
  if (dark) { c.fillStyle = "rgba(6,18,30,.35)"; c.fillRect(0, 0, W, crowdH + 4); }
  const fy = crowdH + 1, fh = top - fy, tile = dark ? "#33475a" : "#e9e2d0", grout = dark ? "rgba(0,0,0,.3)" : "rgba(120,105,80,.28)";
  const deck = (x, y, w, h) => {                                                   /* poolside tiles */
    c.fillStyle = tile; c.fillRect(x, y, w, h);
    c.fillStyle = grout;
    for (let tx = x + 9; tx < x + w; tx += 10) c.fillRect(tx, y, 1, h);
    for (let ty = y + 9; ty < y + h; ty += 10) c.fillRect(x, ty, w, 1);
  };
  deck(0, fy, W, fh);
  for (let i = 0; i < n; i++) {                                                    /* the lanes: water, a line on the floor, light on the surface */
    const y = top + i * LH, g = c.createLinearGradient(0, y, 0, y + LH);
    g.addColorStop(0, dark ? "#125a8a" : "#3db4ea"); g.addColorStop(1, dark ? "#0c4169" : "#2496d6");
    c.fillStyle = g; c.fillRect(0, y, W, LH);
    c.fillStyle = dark ? "rgba(2,16,32,.5)" : "rgba(12,52,96,.42)";
    c.fillRect(x0 + 14, y + LH * 0.62, x1 - x0 - 28, 3);                           /* the floor line and its two T ends */
    c.fillRect(x0 + 14, y + LH * 0.62 - 4, 3, 11); c.fillRect(x1 - 17, y + LH * 0.62 - 4, 3, 11);
    c.strokeStyle = "rgba(255,255,255," + (dark ? 0.09 : 0.2) + ")"; c.lineWidth = 1.2;
    for (let k = 0; k < 2; k++) {
      c.beginPath();
      for (let x = x0; x <= x1; x += 6) c.lineTo(x, y + LH * (0.25 + k * 0.3) + Math.sin(x * 0.045 + i * 2.1 + k * 1.7) * 2.2 + Math.sin(x * 0.11 + k) * 1);
      c.stroke();
    }
  }
  for (let i = 1; i < n; i++) {                                                    /* float ropes: red by the walls, then blue and white */
    const y = top + i * LH;
    c.fillStyle = "rgba(0,0,0,.18)"; c.fillRect(x0, y + 1.5, x1 - x0, 2);
    for (let x = x0 + 5, k = 0; x < x1 - 2; x += 6.5, k++) {
      const end = x < x0 + 46 || x > x1 - 46;
      c.fillStyle = end ? "#e2483d" : k % 4 < 2 ? "#f6f8fa" : "#2b63c9";
      c.beginPath(); c.arc(x, y, 2.9, 0, 6.2832); c.fill();
    }
  }
  deck(0, top, x0 - 2, n * LH);                                                    /* the starting end, where the lane numbers sit */
  deck(0, top + n * LH, W, H - top - n * LH);
  c.fillStyle = dark ? "#cfd8dc" : "#ffffff";                                      /* the pool's white edge, all round */
  c.fillRect(0, top - 3, W, 3); c.fillRect(0, top + n * LH, W, 2.5); c.fillRect(x0 - 2, top, 4, n * LH);
  const sq = LH / 3;                                                               /* finish: two columns of checks on the far wall */
  for (let k = 0; k < 2; k++) for (let q = 0; q < n * 3; q++) {
    c.fillStyle = (k + q) % 2 ? "#f4f6f7" : "#16202a";
    c.fillRect(x1 + k * sq, top + q * sq, sq, sq);
  }
  deck(x1 + 2 * sq, top, W - x1 - 2 * sq, n * LH);
  return board;
}

/* A pet as a card cut-out: the drawing with a white border round its outline, facing
   right. Made once per pet and size. */
const cuts = new Map();
function cutout(f, pr) {
  const key = [f.kind, f.hue, pr, DPR, lineArt.on, lineArt.style, lineArt.dark].join("|");
  let s = cuts.get(key);
  if (s) return s;
  const size = Math.ceil(pr * 3.5), edge = Math.max(2, pr * 0.11);
  const pet = offscreen(size, size), pc = pet.getContext("2d");
  const draw = r => {
    pc.setTransform(1, 0, 0, 1, 0, 0); pc.clearRect(0, 0, pet.width, pet.height);
    pc.setTransform(DPR, 0, 0, DPR, 0, 0);
    pc.translate(size / 2, size / 2); pc.scale(-1, 1);                             /* pets are drawn facing left */
    drawPortrait(pc, 0, 0.6 * r, r, f.kind, f.hue);
  };
  /* the box the drawing covers, in px from the middle: { w, h, foot } */
  const box = () => {
    const d = pc.getImageData(0, 0, pet.width, pet.height).data, w = pet.width, h = pet.height;
    let x0 = w, x1 = -1, y0 = h, y1 = -1;
    for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) if (d[(y * w + x) * 4 + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return x1 < 0 ? { w: pr * 2, h: pr * 2, foot: pr } : { w: (x1 - x0) / DPR, h: (y1 - y0) / DPR, foot: y1 / DPR - size / 2 };
  };
  draw(pr);
  let b = box();
  const grow = Math.min(1.9, pr * 2.6 / Math.max(1, b.w), pr * 1.95 / Math.max(1, b.h));     /* every cut-out about the same size */
  if (Math.abs(grow - 1) > 0.04) { draw(pr * grow); b = box(); }
  const white = offscreen(size, size), wc = white.getContext("2d");
  wc.drawImage(pet, 0, 0);
  wc.globalCompositeOperation = "source-in"; wc.fillStyle = "#fbfbf7"; wc.fillRect(0, 0, white.width, white.height);
  const out = offscreen(size, size), oc = out.getContext("2d");
  for (let a = 0; a < 16; a++) oc.drawImage(white, Math.cos(a * 0.3927) * edge * DPR, Math.sin(a * 0.3927) * edge * DPR);
  oc.drawImage(white, 0, 0);
  oc.drawImage(pet, 0, 0);
  s = { img: out, size, foot: b.foot + edge };
  if (cuts.size > 48) cuts.clear();
  cuts.set(key, s);
  return s;
}

/* The still picture: the field on the start line, or the last race at the finish. */
function paint() {
  if (!cv || !$("raceWrap").clientWidth) return;
  if (run) { drawRun(performance.now()); return; }
  const p = shopFor();
  if (!p) return;
  if (shown) { drawTrack(shown, shown.res.frames.at(-1).x, null, null, shown.res.secs + 9, 0, ""); return; }
  if (pick.pet !== HOUSE && !has(p.pets, pick.pet)) return;
  const setup = raceSetup(p, pick.pet);
  drawTrack({ setup, out: { color: p.color, bet: betOf() } }, setup.field.map(() => 0), null, null, -1, 0, "");
}

/* Where everyone is at race time rt: { x, f, sp }. */
function frameAt(res, rt) {
  const fr = res.frames, at = Math.min(fr.length - 1, rt / FRAME_SECS), i = Math.floor(at), a = at - i, j = Math.min(fr.length - 1, i + 1);
  return { x: fr[i].x.map((v, n) => v + (fr[j].x[n] - v) * a), f: fr[i].f, sp: fr[i].x.map((v, n) => (fr[j].x[n] - v) / FRAME_SECS) };
}
function drawRun(now) {
  const t = (now - run.t0) / 1000 - R.countSecs, rt = Math.max(0, t) * RATE, at = frameAt(run.res, rt);
  drawTrack(run, at.x, at.f, at.sp, rt, now / 1000, t < 0 ? String(Math.ceil(-t)) : t < 0.7 ? "Go" : "");
}

/* Speed lines behind a cut-out at (px, cy): tapered streaks that are long and thin at
   speed, a few of them drawn afresh many times a second so they flicker like a comic
   panel, with spray thrown back along the water. hot = in a burst. */
function speedLines(px, cy, base, pr, v, hot, clock, lane) {
  const beat = Math.floor(clock * 14), back = px - pr * 0.95, count = hot ? 7 : 4;
  for (let j = 0; j < count; j++) {
    const q = noise(beat + j * 7.3, lane + 1), q2 = noise(beat * 1.7 + j, lane + 4);
    if (!hot && q2 < 0.25) continue;                                                /* gaps: not every line every beat */
    const y = cy + (q - 0.5) * pr * 1.5, len = pr * (0.7 + 2.1 * v * q2) * (hot ? 1.9 : 1), thick = (hot ? 2.6 : 1.7) * (0.6 + q2 * 0.6);
    const xa = back - q * pr * 0.5, g = ctx.createLinearGradient(xa - len, 0, xa, 0);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(1, hot ? "rgba(255,236,150," + (0.55 + 0.4 * v) + ")" : "rgba(255,255,255," + (0.25 + 0.5 * v) + ")");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(xa - len, y); ctx.lineTo(xa, y - thick / 2); ctx.lineTo(xa, y + thick / 2); ctx.closePath(); ctx.fill();
  }
  for (let d = 0; d < (hot ? 5 : 3); d++) {                                           /* dust: puffs that drift back, grow and fade */
    const life = frac(clock * (hot ? 2.6 : 1.9) + d / (hot ? 5 : 3) + lane * 0.37), k = 1 - life;
    ctx.fillStyle = "rgba(255,255,255," + (0.7 * k * Math.min(1, v * 1.4)) + ")";
    ctx.beginPath(); ctx.arc(px - pr * 0.5 - life * pr * (hot ? 2.4 : 1.5), base - 3 - life * pr * 0.35, 1.5 + life * pr * 0.2, 0, 6.2832); ctx.fill();
  }
}

/* r: { setup, out: { color, bet } [, res] }; x: where each lane is (0..track); f: flags;
   sp: speeds; rt: the race clock (-1 = not started); clock: seconds, for the motion. */
function drawTrack(r, x, f, sp, rt, clock, word, target) {
  fit(target);
  const field = r.setup.field, n = field.length, top = BAND, pr = LH * 0.82, x0 = 30 + pr * 1.3, x1 = W - 56, sq = LH / 3;
  const dark = getComputedStyle(document.documentElement).colorScheme === "dark";
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(backdrop(dark, x0, x1, n), 0, 0, W, H);
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (let i = 0; i < n; i++) {                                                     /* lane plates: whose lane, and the one with the money on it */
    const y = top + i * LH, cy = y + LH / 2 - 1, bet = r.out.bet && r.out.bet.on === i;
    const tint = field[i].tint || (field[i].me ? r.out.color || "#1688d4" : "");
    if (tint) { ctx.fillStyle = tint; ctx.globalAlpha = 0.32; ctx.fillRect(x0 + 2, y + 3, x1 - x0 - 2, LH - 6); ctx.globalAlpha = 1; }
    ctx.fillStyle = LANE_COL[i];
    ctx.beginPath(); ctx.arc(15, cy, Math.min(9, LH * 0.34), 0, 6.2832); ctx.fill();
    if (bet) { ctx.strokeStyle = "#f4c542"; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(15, cy, Math.min(9, LH * 0.34) + 3, 0, 6.2832); ctx.stroke(); }
    ctx.fillStyle = "#fff"; ctx.font = "700 " + Math.round(Math.min(11, LH * 0.4)) + "px system-ui, sans-serif";
    ctx.fillText(String(i + 1), 15, cy + 0.5);
  }
  for (let i = 0; i < n; i++) {                                                     /* back lane first: each cut-out stands in front of the last */
    const base = top + (i + 1) * LH - 6, cy = base - pr * 1.02;
    const moving = rt >= 0 && x[i] < R.track && x[i] > 0, flag = f ? f[i] : 0, v = sp ? Math.min(1.4, Math.max(0, sp[i]) / 6.5) : 0;
    const px = x0 + (x1 - pr * 1.15 - x0) * x[i] / R.track, cut = cutout(field[i], pr);
    if (moving && flag !== 2 && v > 0.2) speedLines(px, cy, base, pr, v, flag === 1, clock, i);
    ctx.fillStyle = "rgba(4,30,60,.28)";                                            /* its shadow in the water and a ripple ring */
    ctx.beginPath(); ctx.ellipse(px, base + 1, pr * 0.95, 2.8, 0, 0, 6.2832); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.55)"; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.ellipse(px, base + 1, pr * (1.05 + (moving ? frac(clock * 1.8 + i * 0.3) * 0.35 : 0)), 3.4, 0, 0, 6.2832); ctx.stroke();
    ctx.save();
    ctx.translate(px, base);                                                        /* a cut-out rocks about its foot */
    ctx.rotate(flag === 2 ? Math.sin(clock * 22) * 0.2 : flag === 1 ? 0.09 : moving ? Math.sin(clock * 11 + i * 1.7) * 0.035 : 0);
    ctx.drawImage(cut.img, -cut.size / 2, -cut.foot - cut.size / 2 + (moving ? Math.abs(Math.sin(clock * 11 + i * 1.7)) * -1.6 : 0), cut.size, cut.size);
    ctx.restore();
    if (flag === 2) {                                                               /* a stumble: a splash */
      for (let d = 0; d < 7; d++) {
        const life = frac(clock * 2.2 + d * 0.143), a = -0.3 - d * 0.42;
        ctx.fillStyle = "rgba(" + (d % 2 ? "190,232,255," : "255,255,255,") + (1 - life) + ")";
        ctx.beginPath(); ctx.arc(px + Math.cos(a) * life * pr * 1.7, base - 3 + Math.sin(a) * life * pr * 1.5 + life * life * pr * 1.2, 1.3 + (1 - life) * 1.5, 0, 6.2832); ctx.fill();
      }
    }
    const res = r.res;
    if (res && rt >= res.time[i]) {
      ctx.font = "800 " + Math.round(Math.min(13, LH * 0.45)) + "px system-ui, sans-serif"; ctx.textAlign = "left";
      ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,.45)"; ctx.fillStyle = res.place[i] === 1 ? "#f4c542" : "#fff";
      ctx.strokeText(ORD[res.place[i] - 1], x1 + 2 * sq + 5, top + (i + 0.5) * LH); ctx.fillText(ORD[res.place[i] - 1], x1 + 2 * sq + 5, top + (i + 0.5) * LH);
      ctx.textAlign = "center";
    }
  }
  if (word) {
    ctx.font = "900 " + Math.round(LH * 2.6) + "px system-ui, sans-serif";
    ctx.lineWidth = 7; ctx.strokeStyle = "rgba(6,34,66,.8)"; ctx.fillStyle = "#fff";
    ctx.strokeText(word, W / 2, top + n * LH / 2); ctx.fillText(word, W / 2, top + n * LH / 2);
  }
}

/* ---- live 1v1 races ------------------------------------------------------------- */
/* A challenge is a record in the challenger's file; accepting it writes the race into
   the accepter's file (shop.js). Every open page then finds that record (watchDuels runs
   after each render) and plays the race in an overlay, timed from the record's own clock
   time, so all screens show the same moment. */
let duel = null;                    /* the race in the overlay: { take, field, res, start, done, setup, out } */
const duelSeen = new Set();
const askPick = { id: "", pet: -1 };
const whoOf = f => esc(f.who) + "&rsquo;s " + esc(petLabel(f.kind));
/* On a shared folder the other pages poll every few seconds; this tells them to look now. */
const nudge = () => { if (!store.cloud) emit("duel", {}); };

function initDuels() {
  $("duelClose").addEventListener("click", closeDuel);
  $("duelRow").addEventListener("change", e => { if (e.target.id === "duelWho") { pick.who = e.target.value; renderCasino(); } });
  $("duelRow").addEventListener("click", e => {
    const b = e.target.closest("[data-act]");
    if (b) duelAct(b.dataset.act);
  });
  $("duelAsk").addEventListener("click", e => {
    const pet = e.target.closest("[data-apet]"), b = e.target.closest("[data-act]");
    if (pet) { askPick.pet = Number(pet.dataset.apet); renderAsk(); }
    else if (b) duelAct(b.dataset.act);
  });
}

/* The Casino panel's 1v1 row: challenge someone with the picked pet, or the one waiting. */
function renderDuelRow(p, k, off) {
  const others = S.participants.filter(x => x.name !== p.name), mine = asksBy(p)[0];
  $("duelRow").hidden = off || !others.length;
  if (off || !others.length) return;
  if (mine) {
    setHtml("duelRow", '<span class="tag1">1V1</span><span>Waiting for <b>' + esc(mine.to) + '</b> to race your ' + esc(petLabel(Number(mine.pet))) + '.</span>' +
      '<button type="button" class="btn muted small" data-act="drop">Take it back</button>');
    return;
  }
  if (!others.some(x => x.name === pick.who)) pick.who = others[0].name;
  setHtml("duelRow", '<span class="tag1">1V1</span><label for="duelWho">Race</label><select id="duelWho">' +
    others.map(x => '<option value="' + esc(x.name) + '"' + (x.name === pick.who ? ' selected' : '') + '>' + esc(x.name) + '</option>').join("") + '</select>' +
    '<button type="button" class="btn primary small" data-act="ask">Challenge with the ' + esc(petLabel(k)) + '</button>');
}

/* The prompt a challenged player gets, on any tab: pick a pet, race or decline. */
function renderAsk() {
  const p = shopFor(), el = $("duelAsk"), first = p && !duel ? asksFor(p.name)[0] : null;
  el.hidden = !first;
  if (!first) return;
  ensureIcons();
  const kinds = Object.keys(p.pets || {}).map(Number).filter(k => k >= 0 && k < C.PET_MAX && canRace(k)).sort((a, b) => a - b);
  if (askPick.id !== first.ask.id || !kinds.includes(askPick.pet)) {
    const worn = store.petKindFor(p);
    askPick.id = first.ask.id; askPick.pet = kinds.includes(worn) ? worn : kinds.length ? kinds[0] : -1;
  }
  const theirs = Number(first.ask.pet), st = statsOf(first.from, theirs);
  setHtml("duelAsk", '<p><i class="dot" style="background:' + first.from.color + '"></i><b>' + esc(first.from.name) + '</b> wants a race. Their ' +
    '<b>' + esc(petLabel(theirs)) + '</b> <span class="dim">level ' + st.level + ' &middot; rating ' + rating(st.st) + '</span></p>' +
    (kinds.length ? '<div class="race-pets">' + kinds.map(x => '<button type="button" class="race-pet' + (x === askPick.pet ? ' on' : '') + '" data-apet="' + x +
        '" title="' + esc(petLabel(x)) + ' &middot; rating ' + rating(statsOf(p, x).st) + '"><i class="pi pi-' + x + '"></i><span class="rl">' + rating(statsOf(p, x).st) + '</span></button>').join("") + '</div>'
      : '<p class="dim">You have no pet to race yet.</p>') +
    '<div class="acts">' + (kinds.length ? '<button type="button" class="btn primary small" data-act="take">Race with the ' + esc(petLabel(askPick.pet)) + '</button>' : '') +
    '<button type="button" class="btn muted small" data-act="pass">Decline</button></div>');
}

let duelBusy = false;
async function duelAct(act) {
  if (duelBusy || !hooks.guard()) return;
  const p = shopFor();
  if (!p) return;
  duelBusy = true;
  let ok = false, why = "";
  try {
    await store.serial(async () => {
      const q = fresh(p);
      if (act === "ask") {
        why = duelAskBlock(q, pick.who, pick.pet);
        ok = !why && !!(await duelAsk(q, pick.who, pick.pet));
      } else if (act === "drop") {
        const mine = asksBy(q)[0];
        ok = !!mine && !!(await duelDrop(q, mine.id));
      } else {
        const first = asksFor(q.name)[0];
        if (!first) return;
        ok = !!(await (act === "take" ? duelTake(q, first.from, first.ask, askPick.pet) : duelPass(q, first.ask, first.from)));
      }
      if (ok) { nudge(); await hooks.settle(); }
    });
  } finally { duelBusy = false; }
  if (!ok) setMsg(why || "That didn't save.", false);
  render();
}

/* Called after every render: starts any 1v1 race this page has not shown, and keeps
   the challenge prompt right. */
export function watchDuels() {
  if (!STAGE) return;
  const now = Date.now();
  if (!duel) for (const { take, p } of duelsNow(now)) {
    if (duelSeen.has(take.id)) continue;
    duelSeen.add(take.id);
    startDuel(take, p, now);
    break;
  }
  renderAsk();
}

function startDuel(take, p, now) {
  const field = duelField(take, p), lead = C.DUEL.lead * 1000;
  let start = Number(take.t) + lead;
  if (start - now > lead + 2000) start = now + lead;                 /* the accepter's clock runs ahead of this one */
  duel = { take, field, res: runRace(field, Number(take.seed), true), start, done: false, setup: { field }, out: {} };
  ensureIcons();
  $("duelTitle").innerHTML = '<i class="dot" style="background:' + field[0].tint + '"></i>' + whoOf(field[0]) + '<span class="vs">vs</span>' +
                             '<i class="dot" style="background:' + field[1].tint + '"></i>' + whoOf(field[1]);
  $("duelResult").textContent = "";
  $("duelStage").hidden = false;
  $("duelAsk").hidden = true;
  requestAnimationFrame(duelTick);
}

function drawDuel() {
  const t = (Date.now() - duel.start) / 1000, rt = Math.max(0, t) * RATE, at = frameAt(duel.res, rt);
  drawTrack(duel, at.x, at.f, at.sp, t < 0 ? -1 : rt, performance.now() / 1000, t < 0 ? (t > -3 ? String(Math.ceil(-t)) : "") : t < 0.7 ? "Go" : "", STAGE);
  return rt;
}

function duelTick() {
  if (!duel) return;
  const rt = drawDuel();
  if (rt < duel.res.secs) { requestAnimationFrame(duelTick); return; }
  if (duel.done) return;
  duel.done = true;
  const w = duel.field[duel.res.place[0] === 1 ? 0 : 1], id = duel.take.id;
  $("duelResult").innerHTML = whoOf(w) + " wins.";
  setMsg(w.who + "'s " + petLabel(w.kind) + " won the race.", true);
  render();                                                           /* the activity line and the records show now */
  setTimeout(() => { if (duel && duel.take.id === id) closeDuel(); }, C.DUEL.endSecs * 1000);
}

function closeDuel() {
  duel = null;
  $("duelStage").hidden = true;
  watchDuels();                                                       /* another race may be waiting, or a challenge */
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
  const who = o.kind === HOUSE ? o.name + " backed the " + petLabel(o.field[o.bet.on].kind) + ", which" : o.name + "'s " + petLabel(o.kind);
  setMsg(who + " finished " + ORD[(o.kind === HOUSE ? o.places[o.bet.on] : o.place) - 1] + (o.won ? ": +" + money(o.won, o.bet.cur) + "." : "."), !!o.won);
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
  /* the next field's odds take a moment to work out: do it under the countdown, not at "Next race" */
  setTimeout(() => { const q = shopFor(); if (q && (k === HOUSE || has(q.pets, k))) raceSetup(q, k); }, 600);
}

/* The track is sized to its column when the tab opens. */
export function casinoTabChanged(active) { if (active) paint(); }
