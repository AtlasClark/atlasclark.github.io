/* Shell toss (rev 1.51.0), on the Casino tab: call Shell up or Pearl up, stake 1..TOSS.max
   shells, toss. The result is drawn and saved when the shell leaves the hand (shop.js
   tossPlay); the canvas only shows the flip, and reveal.js keeps the win out of the
   balances and the activity list until it lands here. */

import * as C from "./config.js";
import { findParticipant } from "./model.js";
import * as store from "./store.js";
import { tossPlay, tossBlock, tossesOn } from "./shop.js";
import { shownShells, raceDone, hiddenIds } from "./reveal.js";
import { shopFor } from "./shopui.js";
import { render, setHtml } from "./ui.js";
import { $, esc, prettyTime, todayKey, spendsBy } from "./util.js";

let hooks = null;                  /* { settle, guard } from app.js */
const KEY = "awc-toss";
const pick = { call: "shell", bet: 5 };
try {
  const o = JSON.parse(localStorage.getItem(KEY)) || {};
  if (C.TOSS.sides.includes(o.call)) pick.call = o.call;
  if (Number.isInteger(o.bet) && o.bet >= 1 && o.bet <= C.TOSS.max) pick.bet = o.bet;
} catch { }
const keep = () => { try { localStorage.setItem(KEY, JSON.stringify(pick)); } catch { } };
const SIDE = { shell: "Shell up", pearl: "Pearl up" };

let cv = null, ctx = null, W = 0, H = 0;
let face = "shell";                /* the face up at rest */
let anim = null;                   /* { t0, from, res } while the shell is in the air */
let last = null;                   /* the last toss shown here, for the result line */

export function initToss(h) {
  hooks = h;
  cv = $("tossCanvas"); ctx = cv.getContext("2d");
  $("tossCall").addEventListener("click", e => {
    const b = e.target.closest("[data-call]");
    if (b) { pick.call = b.dataset.call; keep(); renderToss(); }
  });
  $("tossStake").addEventListener("click", e => {
    const b = e.target.closest("[data-step]");
    if (!b) return;
    const p = shopFor(), most = Math.max(1, Math.min(C.TOSS.max, p ? shownShells(p) : C.TOSS.max));
    pick.bet = b.dataset.step === "max" ? most : clamp(pick.bet + Number(b.dataset.step));
    keep(); renderToss();
  });
  $("tossBet").addEventListener("input", e => {
    const n = Math.round(Number(e.target.value));
    if (Number.isFinite(n) && n >= 1) { pick.bet = clamp(n); keep(); renderToss(); }
  });
  $("tossBet").addEventListener("change", () => renderToss());       /* a bad entry snaps back */
  $("tossGo").addEventListener("click", doToss);
  window.addEventListener("resize", () => { fit(); paint(); });
}
const clamp = n => Math.max(1, Math.min(C.TOSS.max, Math.round(n) || 1));

/* ---- the panel ------------------------------------------------------------------ */
export function renderToss() {
  const p = shopFor();
  if (!p || !cv) return;
  fit();
  for (const b of $("tossCall").querySelectorAll("[data-call]")) { const on = b.dataset.call === pick.call; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); }
  const inp = $("tossBet");
  inp.max = String(C.TOSS.max);
  if (document.activeElement !== inp) inp.value = String(pick.bet);            /* never rewrite what is being typed */
  const block = tossBlock(p, pick.bet), left = C.TOSS.perDay - tossesOn(p);
  $("tossGo").disabled = !!block || !!anim;
  setHtml("tossGo", 'Toss &middot; ' + pick.bet + ' shell' + (pick.bet === 1 ? '' : 's'));
  $("tossGo").style.setProperty("--pc", p.color);
  $("tossNote").textContent = block || left + " of " + C.TOSS.perDay + " tosses left today. You have " + shownShells(p) + " shells.";
  renderFeed(p);
  if (!anim) paint();
}

function renderFeed(p) {
  const day = todayKey(), hid = hiddenIds(p);
  const list = spendsBy(p, C.TOSS.kind).filter(s => String(s.at).slice(0, 10) === day && !hid.has(s.id)).slice(-8).reverse();
  setHtml("tossFeed", list.length ? list.map(s => {
    const won = Number(s.won) || 0;
    return '<li><span class="t">' + esc(prettyTime(s.at)) + '</span><strong>' + esc(SIDE[s.side] || "?") + '</strong> <span class="dim">&middot; called ' +
           esc(SIDE[s.call] || "?") + '</span> ' + (won ? '<span class="pill good">+' + won + '</span>' : '<span class="dim">&minus;' + (Number(s.bet) || 0) + '</span>') + '</li>';
  }).join("") : '<li class="dim">No tosses today.</li>');
}

function showResult() {
  if (!last) { setHtml("tossResult", ""); return; }
  const r = last;
  setHtml("tossResult", '<b>' + esc(SIDE[r.side]) + '!</b> ' + (r.won
    ? '<span class="pill good">+' + r.won + ' shells</span>'
    : '<span class="dim">You called ' + esc(SIDE[r.call]) + '. ' + r.bet + ' shell' + (r.bet === 1 ? '' : 's') + ' gone.</span>'));
}

/* ---- the toss ------------------------------------------------------------------- */
async function doToss() {
  if (anim || !hooks.guard()) return;
  const p = shopFor();
  if (!p) return;
  const bet = pick.bet, call = pick.call, fresh = () => findParticipant(p.name) || p;
  $("tossGo").disabled = true;
  let res = null;
  await store.serial(async () => {
    res = await tossPlay(fresh(), bet, call);
    if (!res) return;
    launch(res);                                   /* in the air before anything redraws */
    await hooks.settle();
  });
  if (!res) { renderToss(); $("tossNote").textContent = "Toss failed: " + (tossBlock(fresh(), bet) || "couldn't save") + "."; return; }
  renderToss();
}

function launch(res) {
  last = null; showResult();
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) { face = res.side; land(res); return; }
  anim = { t0: performance.now(), from: face, res };
  requestAnimationFrame(tick);
}
function land(res) {
  anim = null; face = res.side; last = res;
  raceDone.add(res.id);
  showResult();
  render();                                        /* the win shows everywhere now */
}

const easeOut = x => 1 - Math.pow(1 - x, 3);
const BOUNCE = 0.35;
function tick(now) {
  if (!anim) return;
  const t = (now - anim.t0) / 1000, T = C.TOSS.secs;
  paint(now);
  if (t < T + BOUNCE) requestAnimationFrame(tick);
  else land(anim.res);
}

/* ---- drawing -------------------------------------------------------------------- */
function fit() {
  const w = Math.min(380, $("tossWrap").clientWidth || 300), h = 170, dpr = window.devicePixelRatio || 1;
  if (w === W && h === H && cv.width === Math.round(w * dpr)) return;
  W = w; H = h;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  cv.style.width = w + "px"; cv.style.height = h + "px";
}

function paint(now = performance.now()) {
  if (!ctx || !W) return;
  const dpr = cv.width / W;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const r = 38, floor = H - 46;                  /* the hinge's ears end 0.73 r below this */
  let lift = 0, sy = 1, up = face;
  if (anim) {
    const t = (now - anim.t0) / 1000, T = C.TOSS.secs, u = Math.min(1, t / T);
    /* half-turns: an even count lands on the face it left from */
    const turns = anim.res.side === anim.from ? 10 : 11, th = easeOut(u) * Math.PI * turns;
    lift = Math.sin(Math.PI * u) * (H - 2 * r - 24);
    if (t > T) { const b = (t - T) / BOUNCE; lift = Math.abs(Math.sin(b * Math.PI)) * 10 * (1 - b); }
    const c = Math.cos(th);
    sy = Math.max(0.06, Math.abs(c));
    up = c >= 0 ? anim.from : other(anim.from);
  }
  /* shadow on the floor, smaller as the shell rises */
  const k = 1 - Math.min(1, lift / (H * 0.8));
  ctx.fillStyle = "rgba(0,0,0," + (0.22 * k + 0.05) + ")";
  ctx.beginPath(); ctx.ellipse(W / 2, floor + r * 0.78,r * (0.55 + 0.45 * k), r * 0.16 * (0.5 + 0.5 * k), 0, 0, Math.PI * 2); ctx.fill();
  ctx.save();
  ctx.translate(W / 2, floor - lift);
  ctx.scale(1, sy);
  drawFace(up, r, sy);
  ctx.restore();
}
const other = s => s === "shell" ? "pearl" : "shell";

/* The scallop: a ribbed fan from a hinge with two ears, in units of r (hinge at the bottom). */
const HY = 0.56, RAD = 1.12, A0 = Math.PI + 0.42, A1 = 2 * Math.PI - 0.42, RIBS = 9;
const fan = a => [RAD * Math.cos(a), HY + RAD * Math.sin(a)];
function outline(r) {
  ctx.beginPath();
  let [x, y] = fan(A0);
  ctx.moveTo(x * r, y * r);
  for (let i = 0; i < RIBS; i++) {
    const a = A0 + (A1 - A0) * (i + 1) / RIBS, m = A0 + (A1 - A0) * (i + 0.5) / RIBS;
    const cx = RAD * 1.09 * Math.cos(m), cy = HY + RAD * 1.09 * Math.sin(m);
    [x, y] = fan(a);
    ctx.quadraticCurveTo(cx * r, cy * r, x * r, y * r);
  }
  for (const [px, py] of [[0.22, HY], [0.44, HY - 0.03], [0.44, HY + 0.17], [-0.44, HY + 0.17], [-0.44, HY - 0.03], [-0.22, HY]]) ctx.lineTo(px * r, py * r);
  ctx.closePath();
}
function drawFace(side, r, sy) {
  outline(r);
  const g = side === "shell" ? ctx.createLinearGradient(0, -0.6 * r, 0, 0.75 * r) : ctx.createRadialGradient(0, 0.1 * r, 0.05 * r, 0, 0.1 * r, 1.1 * r);
  if (side === "shell") { g.addColorStop(0, "#ffd0b5"); g.addColorStop(1, "#ec8160"); }
  else { g.addColorStop(0, "#fff6f1"); g.addColorStop(1, "#f2bfa8"); }
  ctx.fillStyle = g; ctx.fill();
  ctx.lineWidth = 2 / Math.max(sy, 0.3); ctx.strokeStyle = "rgba(122,48,24,.65)"; ctx.stroke();
  ctx.save(); outline(r); ctx.clip();
  ctx.lineWidth = r * (side === "shell" ? 0.06 : 0.035);
  ctx.strokeStyle = side === "shell" ? "rgba(150,58,30,.35)" : "rgba(214,150,125,.45)";
  for (let i = 1; i < RIBS; i++) {                 /* ribs run from the hinge to each notch */
    const [x, y] = fan(A0 + (A1 - A0) * i / RIBS);
    ctx.beginPath(); ctx.moveTo(0, HY * r); ctx.lineTo(x * r * 0.97, y * r * 0.97 + (1 - 0.97) * HY * r); ctx.stroke();
  }
  ctx.restore();
  if (side === "pearl") {
    const py = 0.02 * r, pr = 0.3 * r, pg = ctx.createRadialGradient(-0.1 * r, py - 0.1 * r, 0.02 * r, 0, py, pr);
    pg.addColorStop(0, "#ffffff"); pg.addColorStop(0.6, "#efeaf5"); pg.addColorStop(1, "#c9c0d8");
    ctx.fillStyle = pg; ctx.beginPath(); ctx.arc(0, py, pr, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 1 / Math.max(sy, 0.3); ctx.strokeStyle = "rgba(90,80,110,.4)"; ctx.stroke();
  }
}
