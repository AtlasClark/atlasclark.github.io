/* Water animation. One state object per person, keyed by name, so a poll never
   restarts a glass. Changes from R55: canvases are sized for devicePixelRatio
   (sharp on scaled displays), and motion is time-based, so 60 fps runs at the
   same speed as the HTA's 30 fps, only smoother.
   Pet motion (turns, hops, dives, the drop-in) and the pour stream are applied
   around the drawing, never inside the pet shapes, so they survive new graphics. */

import * as C from "./config.js";
import { rnd } from "./util.js";
import { drawCritter, drawHeadstone } from "./art.js";
import { defs as petDefs } from "./petdefs.js";

export const anim = {};
const reduceMotion = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)");
export const dims = { card: 0, cols: 0, gw: 132, gh: 246, W: 124, H: 239, head: 34 };
export const stats = { errors: 0, lastError: "", fps: 0 };

let active = true;              /* false while another tab is showing */
export function setActive(on) { active = on; }

/* ---- layout ------------------------------------------------------------- */
/* Fewest rows whose cards stay at least CARD_COMFORT wide; if none does, the
   widest cards on offer. Columns are then n / rows rounded up, so rows even out. */
export function pickLayout(count, avail) {
  const n = Math.max(1, count || 0);
  let best = null;
  for (let rows = 1; rows <= n; rows++) {
    const cols = Math.ceil(n / rows);
    if (cols > C.MAX_COLS || (best && cols === best.cols)) continue;
    const fit = Math.floor((avail / cols - C.CARD_GAP * 2) / C.CARD_STEP) * C.CARD_STEP;
    const lay = { cols, rows: Math.ceil(n / cols), card: Math.max(C.CARD_MIN, Math.min(C.CARD_MAX, fit)) };
    if (fit >= C.CARD_COMFORT) return lay;
    if (!best || lay.card > best.card) best = lay;
  }
  return best;
}

export const petR = () => Math.min(dims.W * C.PET_R_SHARE, C.PET_R_MAX);

/* How far a pet's drawing reaches left and right of its anchor, in r, as drawn
   (facing left): { left, right }. Measured once per drawing on a recording context. */
const extents = {};
export function critterExtent(kind) {
  const def = petDefs[kind] || null, c = extents[kind];
  if (c && c.def === def) return c.e;
  const b = new BoundsCtx();
  try { drawCritter(b, 0, 0, 100, 0, false, false, kind, 0, false); } catch { }
  const e = b.x0 <= b.x1 ? { left: Math.max(0, -b.x0 / 100), right: Math.max(0, b.x1 / 100) } : { left: 0.6, right: 0.6 };
  extents[kind] = { def, e };
  return e;
}

/* A canvas stand-in that only tracks the box of what is filled or stroked. */
class BoundsCtx {
  constructor() {
    this.m = [1, 0, 0, 1, 0, 0]; this.st = []; this.pts = [];
    this.x0 = Infinity; this.x1 = -Infinity;
    this.lineWidth = 1; this.fillStyle = this.strokeStyle = ""; this.lineCap = this.lineJoin = this.font = this.textAlign = "";
    this.globalAlpha = 1; this.globalCompositeOperation = "";
  }
  save() { this.st.push({ m: this.m.slice(), lw: this.lineWidth }); }
  restore() { const s = this.st.pop(); if (s) { this.m = s.m; this.lineWidth = s.lw; } }
  translate(x, y) { const m = this.m; m[4] += m[0] * x + m[2] * y; m[5] += m[1] * x + m[3] * y; }
  scale(x, y) { const m = this.m; m[0] *= x; m[1] *= x; m[2] *= y; m[3] *= y; }
  rotate(a) { const m = this.m, c = Math.cos(a), s = Math.sin(a), [a0, b0, c0, d0] = m;
    m[0] = a0 * c + c0 * s; m[1] = b0 * c + d0 * s; m[2] = c0 * c - a0 * s; m[3] = d0 * c - b0 * s; }
  p(x, y) { const m = this.m; this.pts.push(m[0] * x + m[2] * y + m[4]); this.last = [x, y]; }
  beginPath() { this.pts = []; }
  moveTo(x, y) { this.p(x, y); }
  lineTo(x, y) { this.p(x, y); }
  quadraticCurveTo(a, b, x, y) { this.p(a, b); this.p(x, y); }            /* controls bound the curve */
  bezierCurveTo(a, b, c, d, x, y) { this.p(a, b); this.p(c, d); this.p(x, y); }
  arc(x, y, r, a0, a1) { this.ellipse(x, y, r, r, 0, a0, a1); }
  ellipse(x, y, rx, ry, rot, a0, a1) {
    for (let i = 0; i <= 24; i++) {
      const t = a0 + (a1 - a0) * i / 24, ex = rx * Math.cos(t), ey = ry * Math.sin(t);
      this.p(x + ex * Math.cos(rot) - ey * Math.sin(rot), y + ex * Math.sin(rot) + ey * Math.cos(rot));
    }
  }
  rect(x, y, w, h) { this.p(x, y); this.p(x + w, y + h); }
  closePath() { }
  commit(pad) { for (const x of this.pts) { this.x0 = Math.min(this.x0, x - pad); this.x1 = Math.max(this.x1, x + pad); } }
  fill() { this.commit(0); }
  stroke() { this.commit(this.lineWidth * Math.hypot(this.m[0], this.m[1]) / 2); }
  fillRect(x, y, w, h) { this.beginPath(); this.rect(x, y, w, h); this.fill(); }
  clearRect() { } fillText() { } setLineDash() { }
}

export function applyLayout(lay) {
  if (lay.card === dims.card && lay.cols === dims.cols) return false;
  dims.card = lay.card;
  dims.cols = lay.cols;
  dims.gw = Math.round(lay.card * C.GLASS_W_RATIO);
  dims.gh = Math.round(lay.card * C.GLASS_H_RATIO);
  dims.W = dims.gw - 8;                    /* glass content box, minus borders */
  dims.H = dims.gh - 7;
  /* Room above the rim for the tallest pet at the top of a jump from a full glass. */
  dims.head = Math.ceil(petR() * (C.TALLEST_PET_R + C.BREACH_R)) + 6;
  for (const k in anim) seedBubbles(anim[k]);
  return true;
}

export function bubbleCount() {
  return Math.max(3, Math.min(C.BUBBLES_PER_GLASS, Math.round(C.BUBBLES_PER_GLASS * (dims.W / 124))));
}

function seedBubbles(st) {
  st.bubbles = [];
  for (let i = 0; i < bubbleCount(); i++) {
    st.bubbles.push({ x: rnd(8, dims.W - 8), y: rnd(0, dims.H),
                      r: rnd(C.BUBBLE_MIN_R, C.BUBBLE_MAX_R),
                      v: rnd(C.BUBBLE_SPEED_MIN, C.BUBBLE_SPEED_MAX), seed: rnd(0, 6.283) });
  }
}
function resetBubble(b) {
  b.x = rnd(8, dims.W - 8); b.y = 0;
  b.r = rnd(C.BUBBLE_MIN_R, C.BUBBLE_MAX_R);
  b.v = rnd(C.BUBBLE_SPEED_MIN, C.BUBBLE_SPEED_MAX);
}

/* duckState: 0 none, 1 floating, 2 sinking, 3 on the bottom, 4 headstone */
export function animState(name) {
  if (!anim[name]) {
    anim[name] = { level: 0, target: 0, amp: C.AMBIENT_AMP, phase: Math.random() * 6.283,
                   color: "#60a5fa", bubbles: [], rings: [], drops: [], pour: null, ctx: null, dctx: null,
                   duckState: 0, duckT: 0, critterKind: 0, critterHue: 0,
                   duckCrown: false, duckJester: false,
                   m: { t: 0, face: 1, flip: 1, drift: 0, xs: 0, dive: -1, hop: -1, drop: -1, dropWait: 0,
                        nextDive: rnd(6, 30), nextHop: rnd(3, 12), splashed: 0 } };
    seedBubbles(anim[name]);
  }
  return anim[name];
}

function sizeCanvas(cv, w, h) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  cv.style.width = w + "px"; cv.style.height = h + "px";
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

export function bindCanvases(name, glassCanvas, petCanvas, gw, gh) {
  const st = animState(name);
  st.ctx = glassCanvas ? sizeCanvas(glassCanvas, dims.W, dims.H) : null;
  st.dctx = petCanvas ? sizeCanvas(petCanvas, gw, gh + dims.head) : null;
  st.dW = gw; st.dH = gh + dims.head;
}

export function unbindAll() { for (const k in anim) { anim[k].ctx = null; anim[k].dctx = null; } }

const motionOn = () => C.PET_MOTION && !(reduceMotion && reduceMotion.matches);
const depthAt = level => Math.min(Math.max(level, 0), 1) * (dims.H - C.SURFACE_BAND);
const surfaceY = st => dims.H - Math.min(Math.max(st.level, 0), 1) * (dims.H - C.SURFACE_BAND);
/* Drift across the glass, plus whatever ground a dive covered. The drift is narrowed
   for a pet whose drawing reaches far (so it turns before the wall, facing either
   way), and the drawing as it faces now is kept inside the walls. */
export function petX(st) {
  const r = petR(), m = st.m, e = critterExtent(st.critterKind || 0), gap = r * C.WALL_GAP_R;
  const reach = Math.max(e.left, e.right) * r;
  const amp = Math.max(0, Math.min(dims.W * C.SWIM_RANGE, dims.W / 2 - reach - gap));
  const x = dims.W / 2 + Math.sin(st.phase * 0.31) * amp + (m.xs || 0);
  const s = motionOn() ? m.flip : 1;
  const left = (s >= 0 ? s * e.left : -s * e.right) * r, right = (s >= 0 ? s * e.right : -s * e.left) * r;
  const lo = left + gap, hi = dims.W - right - gap;
  return lo > hi ? dims.W / 2 : Math.max(lo, Math.min(hi, x));
}

/* Enough water under the surface for a dive, now and where the level is heading. */
export function canDive(st) {
  const need = petR() * C.DIVE_MIN_DEPTH_R;
  return depthAt(st.level) >= need && depthAt(st.target) >= need;
}

function ringAt(st, x, big) {
  st.rings.push({ r: 2, a: big ? 0.45 : 0.3, x });
  st.amp = Math.max(st.amp, big ? 7 : 4);
}

export function splash(name) {
  const st = animState(name);
  st.amp = C.SPLASH_AMP;
  for (let i = 0; i < C.SPLASH_RINGS; i++) st.rings.push({ r: 1 + i * 7, a: 0.5 - i * 0.13 });
}

export function startSink(name, kind, hue) {
  const st = animState(name);
  st.critterKind = kind; st.critterHue = hue;
  st.duckState = 2; st.duckT = 0;
}

/* A stream falls into the glass, on the side away from the pet. */
export function pour(name, oz, color) {
  const st = animState(name);
  if (!motionOn()) { splash(name); return; }
  const u = Math.min(1, Math.max(0, Number(oz) / C.POUR_OZ_FULL));
  st.pour = { t: 0, dur: C.POUR_SECS_MIN + (C.POUR_SECS_MAX - C.POUR_SECS_MIN) * u,
              w: Math.max(3, Math.min(11, 3 + Math.sqrt(Number(oz) || 1) * 1.3)) * (dims.W / 124),
              color: color || st.color, x: 0, ring: 0 };
  st.pour.x = petX(st) < dims.W / 2 ? dims.W * 0.68 : dims.W * 0.32;
}

/* The pet falls in from above. holdSecs keeps it out of sight first (while the
   unlock card shows); releaseDrop lets it go early. */
export function dropIn(name, holdSecs) {
  const m = animState(name).m;
  m.drop = 0; m.dropWait = Math.min(holdSecs || 0, 12);
  m.dive = -1; m.hop = -1;
}
export function releaseDrop(name) { const m = animState(name).m; if (m.drop >= 0) m.dropWait = 0; }
export const dropping = name => !!anim[name] && anim[name].m.drop >= 0;
/* Seconds left on a pour, so the unlock card can wait for the water to land. */
export const pourLeft = name => { const p = anim[name] && anim[name].pour; return p ? (1 - p.t) * p.dur : 0; };

/* ---- the dive path ------------------------------------------------------ */
function startDive(st) {
  const m = st.m, r = petR(), g = r * C.GRAVITY_R;
  m.dive = 0; m.splashed = 0;
  m.depth = Math.min(depthAt(st.level) * 0.6, r * C.DIVE_DEPTH_R);
  const rise = Math.PI * m.depth / C.DIVE_UNDER_SECS;               /* speed at the surface */
  m.g = g;
  m.vb = Math.max(Math.sqrt(2 * g * r * C.BREACH_MIN_R),           /* a kick for a shallow dive */
                  Math.min(rise, Math.sqrt(2 * g * r * C.BREACH_R)));  /* a cap for a deep one */
  m.tb = 2 * m.vb / g;
  m.xs0 = m.xs; m.fwd = -m.face;                                    /* pets are drawn facing left */
  /* Too close to the wall ahead to cover the dive: turn round and dive the other way. */
  const x = petX(st), front = critterExtent(st.critterKind || 0).left * r + r * C.WALL_GAP_R;
  const room = fwd => (fwd < 0 ? x : dims.W - x) - front;
  if (room(m.fwd) < r * C.DIVE_FORWARD_R && room(-m.fwd) > room(m.fwd)) { m.face = -m.face; m.fwd = -m.face; }
}
const diveSecs = m => C.DIVE_UNDER_SECS + m.tb;

/* Offset from the floating anchor s seconds into a dive: y down, x forward. */
function divePath(m, s) {
  const Tu = C.DIVE_UNDER_SECS, T = diveSecs(m), F = petR() * C.DIVE_FORWARD_R;
  let y, vy;
  if (s < Tu) {
    const k = Math.PI / Tu;
    y = m.depth * Math.sin(k * s); vy = m.depth * k * Math.cos(k * s);
  } else {
    const b = s - Tu;
    y = -(m.vb * b - 0.5 * m.g * b * b); vy = -(m.vb - m.g * b);
  }
  const u = Math.min(1, s / T);
  return { x: F * u * u * (3 - 2 * u), y, vx: F * 6 * u * (1 - u) / T, vy };
}

/* ---- drawing ------------------------------------------------------------ */
const waveBuf = [];
let waveN = 0;

function waveAt(st, x) {
  return st.amp * (Math.sin(x * C.WAVE_K1 + st.phase) * 0.62 +
                   Math.sin(x * C.WAVE_K2 - st.phase * 1.35) * 0.38);
}
function buildWave(st, W, step) {
  let i = 0;
  for (let x = 0; x <= W; x += step) waveBuf[i++] = waveAt(st, x);
  waveN = i;
}

function drawGlass(st) {
  const ctx = st.ctx, W = dims.W, H = dims.H;
  ctx.clearRect(0, 0, W, H);
  const lvl = Math.min(Math.max(st.level, 0), 1);
  if (lvl <= 0.002) return;
  const top = H - lvl * (H - C.SURFACE_BAND);
  const step = W >= C.GHOST_MIN_W ? C.WAVE_STEP_BIG : C.WAVE_STEP_SMALL;
  buildWave(st, W, step);

  const surface = () => {
    ctx.lineTo(0, top + waveBuf[0]);
    for (let i = 0; i < waveN; i++) ctx.lineTo(Math.min(i * step, W), top + waveBuf[i]);
    ctx.lineTo(W, top + waveBuf[waveN - 1]);
  };

  /* body, with a soft depth gradient over the person's colour */
  ctx.beginPath();
  ctx.moveTo(0, H);
  surface();
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fillStyle = st.color;
  ctx.fill();
  const g = ctx.createLinearGradient(0, top, 0, H);
  g.addColorStop(0, "rgba(255,255,255,0.10)");
  g.addColorStop(1, "rgba(0,20,40,0.16)");
  ctx.fillStyle = g;
  ctx.fill();

  ctx.save();
  ctx.clip();
  ctx.fillStyle = "rgba(255,255,255,0.42)";
  for (const b of st.bubbles) {
    const wob = Math.sin(b.y * 0.055 + b.seed) * C.BUBBLE_WOBBLE;
    ctx.beginPath();
    ctx.arc(b.x + wob, H - b.y, b.r, 0, 6.2832);
    ctx.fill();
  }
  ctx.restore();

  ctx.beginPath();
  ctx.moveTo(0, top + waveBuf[0]);
  surface();
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = 2.5;
  ctx.stroke();

  if (W >= C.GHOST_MIN_W) {
    ctx.beginPath();
    ctx.moveTo(0, top + waveBuf[0] + 5);
    for (let i = 0; i < waveN; i++) {
      const x = Math.min(i * step, W);
      ctx.lineTo(x, top + st.amp * Math.sin(x * C.WAVE_K1 - st.phase * 0.7) * 0.5 + 6);
    }
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 4;
    ctx.stroke();
  }

  for (const r of st.rings) {
    ctx.save();
    ctx.translate(r.x === undefined ? W / 2 : r.x, top + 2);
    ctx.scale(1, 0.26);
    ctx.beginPath();
    ctx.arc(0, 0, r.r, 0, 6.2832);
    ctx.restore();
    ctx.strokeStyle = "rgba(255,255,255," + r.a.toFixed(3) + ")";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

const duckRestY = (H, r) => H - 4 - r * 1.62;

function drawSinking(ctx, st, W, H, top, offX, offY, r) {
  const t = st.duckT, restY = duckRestY(H, r);
  const dx = W / 2 + Math.sin(st.phase * 0.31) * (W * 0.21) * (1 - t);
  const surf = top + waveAt(st, dx);
  const dy = surf + (restY - surf) * (t * t);
  const ang = Math.PI * (t < 0.55 ? t / 0.55 : 1);
  drawCritter(ctx, dx + offX, dy + offY, r, ang, st.duckCrown, true, st.critterKind || 0, st.critterHue || 0, st.duckJester);
  for (let i = 0; i < 3; i++) {
    const bt = t - i * 0.12;
    if (bt <= 0) continue;
    const by = dy - bt * (dy - top) * 0.9;
    ctx.beginPath();
    ctx.arc(dx + offX + (i - 1) * r * 0.28, by + offY, r * (0.10 - i * 0.02), 0, 6.2832);
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.fill();
  }
}

function rgba(hex, a) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || "");
  return m ? "rgba(" + parseInt(m[1], 16) + "," + parseInt(m[2], 16) + "," + parseInt(m[3], 16) + "," + a + ")"
           : "rgba(96,165,250," + a + ")";
}

/* The stream runs from the top of the pet layer (above the glass) to the surface;
   its front lands first and its tail follows it down at the end. */
function drawPour(ctx, st, top, offX, offY) {
  const p = st.pour;
  if (!p) return;
  const ease = v => 1 - (1 - v) * (1 - v);
  const sx = offX + p.x, surf = offY + top + waveAt(st, p.x);
  const yEnd = surf * Math.min(1, ease(Math.min(1, p.t / C.POUR_LAND)));
  const yStart = p.t > C.POUR_TAIL ? surf * ease((p.t - C.POUR_TAIL) / (1 - C.POUR_TAIL)) : 0;
  if (yEnd - yStart > 1) {
    const g = ctx.createLinearGradient(0, 0, 0, surf);
    g.addColorStop(0, rgba(p.color, 0));
    g.addColorStop(0.22, rgba(p.color, 0.85));
    g.addColorStop(1, rgba(p.color, 0.9));
    const wob = y => Math.sin(y * 0.09 - st.m.t * 18) * 0.9;
    const half = y => p.w * (0.62 - 0.22 * (y / surf)) ;          /* narrows as it falls */
    ctx.beginPath();
    for (let y = yStart; y <= yEnd; y += 3) ctx.lineTo(sx + wob(y) - half(y), y);
    ctx.lineTo(sx + wob(yEnd) - half(yEnd), yEnd);
    for (let y = yEnd; y >= yStart; y -= 3) ctx.lineTo(sx + wob(y) + half(y), y);
    ctx.lineTo(sx + wob(yStart) + half(yStart), yStart);
    ctx.closePath();
    ctx.fillStyle = g;
    ctx.fill();
    ctx.beginPath();                                                 /* highlight */
    for (let y = yStart; y <= yEnd; y += 3) ctx.lineTo(sx + wob(y) - half(y) * 0.35, y);
    ctx.strokeStyle = "rgba(255,255,255,0.45)";
    ctx.lineWidth = Math.max(1, p.w * 0.14);
    ctx.stroke();
    if (yEnd >= surf - 1) {                                          /* foam where it lands */
      ctx.save();
      ctx.translate(sx, surf);
      ctx.scale(1, 0.32);
      ctx.beginPath();
      ctx.arc(0, 0, p.w * 1.1, 0, 6.2832);
      ctx.restore();
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.fill();
    }
  }
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  for (const d of st.drops) {
    ctx.beginPath();
    ctx.arc(offX + d.x, offY + top + d.y, d.r, 0, 6.2832);
    ctx.fill();
  }
}

function drawPetLayer(st) {
  const ctx = st.dctx, W = dims.W, H = dims.H, offX = 4, offY = dims.head + 3;
  ctx.clearRect(0, 0, st.dW, st.dH);
  const top = surfaceY(st);
  drawPour(ctx, st, top, offX, offY);
  if (!st.duckState) return;
  const r = petR();
  if (st.duckState === 4) drawHeadstone(ctx, W / 2 + offX, H - 4 + offY, r, st.critterHue);
  else if (st.duckState === 1) drawFloating(ctx, st, W, H, top, offX, offY, r);
  else if (st.duckState === 2) drawSinking(ctx, st, W, H, top, offX, offY, r);
  else if (st.duckState === 3) {
    drawCritter(ctx, W / 2 + offX, duckRestY(H, r) + offY, r, Math.PI, st.duckCrown, true,
                st.critterKind || 0, st.critterHue || 0, st.duckJester);
  }
  tintUnderwater(ctx, st, W, H, top, offX, offY);
}

function drawFloating(ctx, st, W, H, top, offX, offY, r) {
  const m = st.m, moving = motionOn(), flip = moving ? m.flip : 1;
  let dx = petX(st);
  const slope = (waveAt(st, dx + 5) - waveAt(st, dx - 5)) / 10;
  let dy = top + waveAt(st, dx), ang = Math.atan(slope) * (flip < 0 ? -1 : 1);
  if (moving && m.drop >= 0) {
    if (m.dropWait > 0) return;                                     /* still on the unlock card */
    const u = m.drop, from = -offY - r * 1.4;
    dy = from + (dy - from) * u * u;                                /* falls, accelerating */
    ang += (1 - u) * 2.4;
  } else if (moving) {
    dy += Math.sin(m.t * 2.1) * r * 0.035;                          /* a slow breath */
    if (m.dive >= 0) {
      const d = divePath(m, m.dive);
      dy += d.y;
      ang = -Math.atan2(d.vy, Math.max(d.vx, r * 0.4)) * 0.85;       /* nose follows the path */
      if (m.dive > 0.3 && m.dive < C.DIVE_UNDER_SECS - 0.3) {       /* air it lets go of */
        for (let i = 0; i < 3; i++) {
          const by = dy - r * 0.6 - ((m.t * 26 + i * 9) % (r * 1.6));
          if (by < top + 2) continue;
          ctx.beginPath();
          ctx.arc(dx + offX + (i - 1) * r * 0.22, by + offY, r * (0.07 - i * 0.012), 0, 6.2832);
          ctx.fillStyle = "rgba(255,255,255,0.55)";
          ctx.fill();
        }
      }
    } else if (m.hop >= 0) {
      dy -= r * C.HOP_R * Math.sin(Math.PI * m.hop);
      ang += 0.22 * Math.sin(2 * Math.PI * m.hop);
    }
  }
  ctx.save();
  ctx.translate(dx + offX, dy + offY);
  ctx.scale(Math.abs(flip) < 0.04 ? (flip < 0 ? -0.04 : 0.04) : flip, 1);   /* mid-turn: edge on */
  drawCritter(ctx, 0, 0, r, ang, st.duckCrown, false, st.critterKind || 0, st.critterHue || 0, st.duckJester);
  ctx.restore();
}

/* Whatever sits below the surface takes on the water's colour, so a pet reads as
   in the glass rather than pasted on it. Only touches pixels already drawn. */
function tintUnderwater(ctx, st, W, H, top, offX, offY) {
  if (!C.UNDERWATER_TINT || st.level <= 0.01) return;
  ctx.save();
  ctx.globalCompositeOperation = "source-atop";
  ctx.globalAlpha = C.UNDERWATER_TINT;
  ctx.beginPath();
  ctx.moveTo(offX, offY + H);
  for (let x = 0; x <= W; x += 4) ctx.lineTo(offX + x, offY + top + waveAt(st, x));
  ctx.lineTo(offX + W, offY + top + waveAt(st, W));
  ctx.lineTo(offX + W, offY + H);
  ctx.closePath();
  ctx.fillStyle = st.color;
  ctx.fill();
  ctx.restore();
}

/* ---- the loop ----------------------------------------------------------- */
function busy() {
  for (const k in anim) {
    const st = anim[k], m = st.m;
    if (!st.ctx) continue;
    if (Math.abs(st.target - st.level) > 0.0006 || st.rings.length || st.duckState === 2) return true;
    if (st.pour || st.drops.length || m.drop >= 0) return true;
    if (m.dive >= 0 || m.hop >= 0 || Math.abs(m.flip - m.face) > 0.02 || Math.abs(m.xs) > 0.3) return true;
  }
  return false;
}

export function stepState(st, f) {
  const dt = f / 30, p = st.pour;
  /* The level waits for a pour's stream to land, then rises with it. */
  if (!(p && p.t < C.POUR_LAND)) {
    const ease = p ? C.POUR_EASE : C.LEVEL_EASE, delta = st.target - st.level;
    st.level += delta * (1 - Math.pow(1 - ease, f));
    if (Math.abs(delta) < 0.0004) st.level = st.target;
  }
  const delta = st.target - st.level;
  st.phase += C.WAVE_SPEED * f;
  if (st.phase > 62832) st.phase = 0;
  const floorAmp = C.AMBIENT_AMP + Math.min(C.FILL_AMP, Math.abs(delta) * C.FILL_AMP * 7);
  if (st.amp > floorAmp) st.amp *= Math.pow(C.AMP_DECAY, f);
  if (st.amp < floorAmp) st.amp = floorAmp;
  if (st.duckState === 2) {
    st.duckT += f / (30 * C.DUCK_SINK_SECS);
    if (st.duckT >= 1) { st.duckState = 3; st.duckT = 0; }
  }
  if (p) stepPour(st, p, dt);
  stepMotion(st, f);
  const waterH = depthAt(st.level);
  for (const b of st.bubbles) { b.y += b.v * f; if (b.y > waterH - 3 || waterH < 10) resetBubble(b); }
  st.rings = st.rings.filter(g => {
    g.r += C.RING_GROWTH * f;
    g.a *= Math.pow(C.RING_FADE, f);
    return g.a > 0.03 && g.r < dims.W;
  });
}

function stepPour(st, p, dt) {
  p.t += dt / p.dur;
  if (p.t >= C.POUR_LAND && p.t < 1) {
    p.ring -= dt;
    if (p.ring <= 0) { ringAt(st, p.x, false); p.ring = 0.12; }
    st.amp = Math.max(st.amp, 4);
    for (let i = 0; i < 2 && st.drops.length < 40; i++) {
      st.drops.push({ x: p.x + rnd(-p.w / 2, p.w / 2), y: -1, vx: rnd(-40, 40), vy: rnd(-95, -40), r: rnd(0.9, 1.9) });
    }
  }
  if (p.t >= 1) st.pour = null;
  /* droplets thrown up at the impact, in px from the surface */
  st.drops = st.drops.filter(d => {
    d.x += d.vx * dt; d.y += d.vy * dt; d.vy += 420 * dt;
    return d.y < 0;
  });
}

/* Facing, hops, dives and the drop-in for a floating pet. */
export function stepMotion(st, f) {
  const m = st.m, dt = f / 30, r = petR();
  m.t += dt;
  if (!st.pour && st.drops.length) st.drops = st.drops.filter(d => { d.x += d.vx * dt; d.y += d.vy * dt; d.vy += 420 * dt; return d.y < 0; });
  if (st.duckState !== 1 || !motionOn()) { m.dive = -1; m.hop = -1; m.drop = -1; return; }

  if (m.drop >= 0) {
    if (m.dropWait > 0) { m.dropWait -= dt; return; }
    m.drop += dt / C.DROP_SECS;
    if (m.drop >= 1) { m.drop = -1; ringAt(st, petX(st), true); st.amp = Math.max(st.amp, 10); m.nextHop = m.t + 0.15; }
    return;
  }

  if (m.dive < 0) {
    /* Turn to face the drift at each side, except now and then. */
    const vel = Math.cos(st.phase * 0.31);
    const dir = vel > 0.05 ? -1 : vel < -0.05 ? 1 : 0;
    if (dir && !m.drift) {                              /* first sight: already facing its way */
      m.drift = m.face = m.flip = dir;
    } else if (dir && dir !== m.drift) {
      m.drift = dir;
      if (m.face !== dir && Math.random() >= C.TURN_SKIP_CHANCE) m.face = dir;
    }
    m.xs *= Math.pow(0.985, f);                         /* ease back from where a dive left it */
  }
  m.flip += (m.face - m.flip) * (1 - Math.pow(1 - C.TURN_EASE, f));

  if (m.dive >= 0) {
    const Tu = C.DIVE_UNDER_SECS;
    /* The water dropped under it (an undo): turn round and come up from here. */
    if (m.dive < Tu / 2 && depthAt(Math.min(st.level, st.target)) < r * C.SURFACE_DEPTH_R) m.dive = Tu - m.dive;
    m.dive += dt;
    m.xs = m.xs0 + m.fwd * divePath(m, Math.min(m.dive, diveSecs(m))).x;
    if (m.splashed === 0 && m.dive > 0.12) { m.splashed = 1; ringAt(st, petX(st), true); }
    if (m.splashed === 1 && m.dive >= Tu) { m.splashed = 2; ringAt(st, petX(st), true); }
    if (m.dive >= diveSecs(m)) {
      m.dive = -1;
      ringAt(st, petX(st), true);
      st.amp = Math.max(st.amp, 8);
      m.nextDive = m.t + rnd(C.DIVE_EVERY[0], C.DIVE_EVERY[1]);
    }
  } else if (m.hop >= 0) {
    m.hop += dt / C.HOP_SECS;
    if (m.hop >= 1) { m.hop = -1; ringAt(st, petX(st), false); m.nextHop = m.t + rnd(C.HOP_EVERY[0], C.HOP_EVERY[1]); }
  } else if (m.t > m.nextDive) {
    if (canDive(st)) startDive(st);
    else m.nextDive = m.t + rnd(C.DIVE_EVERY[0], C.DIVE_EVERY[1]);
  } else if (m.t > m.nextHop && st.level > 0.04) {
    m.hop = 0;
  }
}

/* For tests: where a dive puts the pet s seconds in, and how long it lasts. */
export const diveProbe = { start: startDive, path: divePath, secs: diveSecs };

let last = 0, lastDrawn = 0, frames = 0, fpsT = 0, running = false;

function frame(now) {
  requestAnimationFrame(frame);
  if (!active) { last = now; return; }
  const gap = busy() ? 1000 / C.ANIM_FPS : 1000 / (reduceMotion && reduceMotion.matches ? 8 : C.IDLE_FPS);
  if (now - lastDrawn < gap - 2) return;
  const f = Math.min(4, (now - (last || now)) / (1000 / 30)) || 1;
  last = now; lastDrawn = now;
  frames++;
  if (now - fpsT > 1000) { stats.fps = frames; frames = 0; fpsT = now; }
  for (const k in anim) {
    const st = anim[k];
    if (!st.ctx) continue;
    try {
      stepState(st, f);
      drawGlass(st);
      if (st.dctx) drawPetLayer(st);
    } catch (e) {
      stats.errors++;
      stats.lastError = k + ": " + (e.message || e);
    }
  }
}

export function startAnim() {
  if (running) return;
  running = true;
  requestAnimationFrame(frame);
}
