/* Water animation. One state object per person, keyed by name, so a poll never
   restarts a glass. Canvases are sized for devicePixelRatio (sharp on scaled
   displays), and motion is time-based, so it runs at the same speed at any frame rate.
   Pet motion (turns, hops, dives, the drop-in) and the pour stream are applied
   around the drawing, never inside the pet shapes, so they survive new graphics. */

import * as C from "./config.js";
import { rnd } from "./util.js";
import { drawCritter, drawHeadstone } from "./art.js";
import { defs as petDefs, fxSpot, anchorY, zoneOf, bodyBox, restY as restAt, lineArt, syncLineArt } from "./petdefs.js";
import { drawDecor, drawEffect, decorBehind, decorDry } from "./cosmetics.js";

const clock = () => performance.now() / 1000;
const lookOf = st => st.look || {};

export const anim = {};
const reduceMotion = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)");
export const dims = { card: 0, cols: 0, gw: 132, gh: 246, W: 124, H: 239, head: 34, pad: 0 };
/* The water canvas reaches this far (px) under the glass's border on every side; the
   glass clips it at its inside edge. At 125% or 150% screen scaling the inside edge
   falls between pixels and a canvas that stopped exactly there left a pale seam. */
const BLEED = 2;
const DECOR_MARGIN = 8;                   /* the decor canvas reaches this far past each card edge */
export const stats = { errors: 0, lastError: "", fps: 0 };

let active = true;              /* false while another tab is showing */
export function setActive(on) {
  active = on;
  if (!on) for (const k in anim) endVisit(k);                   /* another tab: everyone home */
}

/* ---- layout ------------------------------------------------------------- */
/* As many across as stay at least CARD_COMFORT wide (one at the least); the rest wrap. */
export function pickLayout(count, avail) {
  const n = Math.max(1, count || 0);
  const fitFor = cols => Math.floor((avail / cols - C.CARD_GAP * 2) / C.CARD_STEP) * C.CARD_STEP;
  let cols = Math.min(n, C.MAX_COLS);
  while (cols > 1 && fitFor(cols) < C.CARD_COMFORT) cols--;            /* as many across as stay comfortable */
  return { cols, rows: Math.ceil(n / cols), card: Math.max(C.CARD_MIN, Math.min(C.CARD_MAX, fitFor(cols))) };
}

export const petR = () => Math.min(dims.W * C.PET_R_SHARE, C.PET_R_MAX);

/* ---- where a pet is: its body box and turning point ------------------------
   Every pet turns (tilts, dives, leaps, flips over when it drowns, spins as it drops in)
   round the middle of its body, not round its drawing's origin: a drawing set far below
   its waterline would otherwise swing sideways out of the glass. Walls and floor are
   kept from the box the drawing really covers (bodyBox, petdefs.js). */
const defOf = pet => petDefs[pet.critterKind || 0] || petDefs[0];

/* How far a pet's drawing reaches left and right of its anchor, in r, as drawn
   (facing left): { left, right }. */
export function critterExtent(kind) {
  const b = bodyBox(petDefs[kind] || petDefs[0]);
  return { left: Math.max(0, -b.x0), right: Math.max(0, b.x1) };
}
/* The turning point below the origin, in px: the middle of the body. */
const bodyMid = st => { const b = bodyBox(defOf(st)); return (b.top + b.bottom) / 2 * petR(); };
/* How far the drawing reaches left and right of its anchor (px, facing left) when
   turned by ang round its body middle: the turned corners of its box. */
function reachAt(st, ang) {
  const b = bodyBox(defOf(st)), r = petR();
  if (!ang) return { left: Math.max(0, -b.x0) * r, right: Math.max(0, b.x1) * r };
  const mid = (b.top + b.bottom) / 2, c = Math.cos(ang), n = Math.sin(ang);
  let lo = Infinity, hi = -Infinity;
  for (const x of [b.x0, b.x1]) for (const y of [b.top - mid, b.bottom - mid]) { const v = x * c - y * n; lo = Math.min(lo, v); hi = Math.max(hi, v); }
  return { left: Math.max(0, -lo) * r, right: Math.max(0, hi) * r };
}
/* x kept inside the walls for the drawing turned by ang and facing flip (1 left, -1 right). */
function wallX(st, x, ang, flip) {
  const e = reachAt(st, ang), gap = petR() * C.WALL_GAP_R, s = flip;
  const left = s >= 0 ? s * e.left : -s * e.right, right = s >= 0 ? s * e.right : -s * e.left;
  const lo = left + gap, hi = dims.W - right - gap;
  return lo > hi ? dims.W / 2 : Math.max(lo, Math.min(hi, x));
}
/* Draws the pet with its origin at (ox, oy) as it stands, turned by ang round its body
   middle; ctx is already mirrored for the way it faces (about x = ox). */
function drawTurned(ctx, ox, oy, mid, ang, draw) {
  ctx.save();
  ctx.translate(ox, oy + mid);
  draw(mid * Math.sin(ang), -mid * Math.cos(ang));
  ctx.restore();
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
  /* Room either side of the pet layer, so an effect, glow, hat or a turned pet that
     reaches past the rim is drawn whole above it instead of cut at the canvas edge. */
  dims.pad = Math.ceil(petR() * 1.3);
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
    anim[name] = { name, level: 0, target: 0, amp: C.AMBIENT_AMP, phase: Math.random() * 6.283,
                   color: "#60a5fa", bubbles: [], rings: [], drops: [], pour: null, ctx: null, dctx: null,
                   duckState: 0, duckT: 0, critterKind: 0, critterHue: 0,
                   duckCrown: false, duckJester: false,
                   m: { t: 0, face: 1, flip: 1, drift: 0, xs: 0, dive: -1, hop: -1, drop: -1, dropWait: 0,
                        nextDive: rnd(6, 30), nextHop: rnd(3, 12), splashed: 0 } };
    seedBubbles(anim[name]);
  }
  return anim[name];
}

/* The bitmap is rounded to whole device pixels and drawn at exactly that scale (at
   125% or 150% screen scaling w x dpr is often fractional). */
function sizeCanvas(cv, w, h) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  cv.width = Math.max(1, Math.round(w * dpr)); cv.height = Math.max(1, Math.round(h * dpr));
  cv.style.width = w + "px"; cv.style.height = h + "px";
  const ctx = cv.getContext("2d");
  ctx._sx = cv.width / w; ctx._sy = cv.height / h;
  ctx.setTransform(ctx._sx, 0, 0, ctx._sy, 0, 0);
  return ctx;
}
/* Back to the canvas's own scale (also undoes anything a failed frame left behind). */
const reset = ctx => ctx.setTransform(ctx._sx || 1, 0, 0, ctx._sy || 1, (ctx._ox || 0) * (ctx._sx || 1), (ctx._ox || 0) * (ctx._sy || 1));

export function bindCanvases(name, glassCanvas, petCanvas, gw, gh, decorCanvas) {
  const st = animState(name);
  st.ctx = glassCanvas ? sizeCanvas(glassCanvas, dims.W + 2 * BLEED, dims.H + 2 * BLEED) : null;
  if (glassCanvas) { glassCanvas.style.left = glassCanvas.style.top = -BLEED + "px"; st.ctx._ox = BLEED; }  /* drawn in the glass's own px */
  st.dctx = petCanvas ? sizeCanvas(petCanvas, gw + 2 * dims.pad, gh + dims.head) : null;
  if (petCanvas) petCanvas.style.left = -dims.pad + "px";
  st.dcv = petCanvas || null;
  st.dW = gw + 2 * dims.pad; st.dH = gh + dims.head;
  st.ecv = decorCanvas || null; st.ectx = null; st.eW = st.eH = 0;
}

export function unbindAll() { for (const k in anim) { anim[k].ctx = null; anim[k].dctx = null; anim[k].dcv = null; anim[k].ecv = null; anim[k].ectx = null; anim[k].pin = anim[k].bub = null; } }

/* Message pin and bubble (msg.js): DOM elements in the glass's wrapper, moved each frame
   to just over the pet's head (its hat included), or over the rim while it is away. */
export function bindPin(name, pin, bubble) { const st = animState(name); st.pin = pin || null; st.bub = bubble || null; }
function placePin(st) {
  const pin = st.pin;
  if (!pin || pin.hidden) return;
  const r = petR(), at = st.pinAt;
  const x = (at ? at[0] : st.dW / 2) - dims.pad, y = Math.max(-dims.head - 14, (at ? at[1] - r * 0.6 : dims.head - 4) - dims.head);
  pin.style.left = x.toFixed(1) + "px"; pin.style.top = y.toFixed(1) + "px";
  const b = st.bub;
  if (!b || b.hidden) return;
  const side = (dims.card - dims.gw) / 2, w = b.offsetWidth;
  const left = Math.max(-side + 4, Math.min(dims.gw + side - 4 - w, x - w / 2));
  b.style.left = left.toFixed(1) + "px"; b.style.top = (y - 22).toFixed(1) + "px";
  b.style.setProperty("--tx", Math.max(12, Math.min(w - 12, x - left)).toFixed(1) + "px");
}

const motionOn = () => C.PET_MOTION && !(reduceMotion && reduceMotion.matches);
const depthAt = level => Math.min(Math.max(level, 0), 1) * (dims.H - C.SURFACE_BAND);
const surfaceY = st => dims.H - Math.min(Math.max(st.level, 0), 1) * (dims.H - C.SURFACE_BAND);
const floorY = () => dims.H - C.FLOOR_GAP;
const zone = pet => zoneOf(petDefs[pet.critterKind || 0]);
/* Where pet's origin sits in water's glass: on the surface (with the wave at x, if
   given), halfway down the water, or standing on the floor (anchorY, petdefs.js). */
function homeY(pet, water, x) {
  const surf = surfaceY(water) + (x === undefined ? 0 : swellAt(water, x));
  return anchorY(petDefs[pet.critterKind || 0], petR(), surf, floorY());
}
/* Drift across the glass, plus whatever ground a dive covered. The drift is narrowed
   for a pet whose drawing reaches far (so it turns before the wall, facing either
   way), and the drawing as it faces now is kept inside the walls. */
export function petX(st, ang = 0) {
  const r = petR(), m = st.m, e = reachAt(st, 0), gap = r * C.WALL_GAP_R;
  const reach = Math.max(e.left, e.right);
  const def = defOf(st), range = def && def.range !== undefined ? def.range : 1;
  const amp = Math.max(0, Math.min(dims.W * C.SWIM_RANGE * range, dims.W / 2 - reach - gap));
  const x = dims.W / 2 + Math.sin(st.phase * 0.31) * amp + (m.xs || 0);
  return wallX(st, x, ang, motionOn() ? m.flip : 1);                 /* turned as it is now, still inside */
}

/* Enough water under the surface for a dive, now and where the level is heading. */
export function canDive(st) {
  const need = petR() * C.DIVE_MIN_DEPTH_R;
  return depthAt(st.level) >= need && depthAt(st.target) >= need;
}

/* Something broke the surface at x: a ripple sets off from there (st.rings: { x, t seconds
   since it began, a height in px }), and a big one throws up a few droplets. k scales it. */
function ringAt(st, x, big, k = 1) {
  st.rings.push({ x, t: 0, a: C.RIPPLE_AMP[big ? 1 : 0] * k * (dims.W / 124) });
  st.amp = Math.max(st.amp, big ? 7 : 4);
  if (big && motionOn()) {
    for (let i = 0; i < 5 && st.drops.length < 40; i++) {
      st.drops.push({ x: x + rnd(-4, 4), y: -1, vx: rnd(-55, 55), vy: rnd(-120, -60), r: rnd(0.9, 1.8) });
    }
  }
}

export function splash(name) {
  const st = animState(name);
  st.amp = C.SPLASH_AMP;
  for (let i = 0; i < C.SPLASH_RINGS; i++) {                          /* from the middle, one after the other */
    st.rings.push({ x: dims.W / 2, t: -i * 0.18, a: C.RIPPLE_AMP[1] * (1 - i * 0.25) * (dims.W / 124) });
  }
}

export function startSink(name, kind, hue) {
  const st = animState(name);
  endVisit(name);                                                 /* going under happens at home */
  if (st.guest) goHome(st.guest);
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
  endVisit(name);
  const m = animState(name).m;
  m.drop = 0; m.dropWait = Math.min(holdSecs || 0, 12);
  m.dive = -1; m.hop = -1; m.leap = -1;
}
export function releaseDrop(name) { const m = animState(name).m; if (m.drop >= 0) m.dropWait = 0; }
export const dropping = name => !!anim[name] && anim[name].m.drop >= 0;
/* Seconds left on a pour, so the unlock card can wait for the water to land. */
export const pourLeft = name => { const p = anim[name] && anim[name].pour; return p ? (1 - p.t) * p.dur : 0; };

/* ---- the dive path ------------------------------------------------------ */
function startDive(st, water = st) {
  const m = st.m, r = petR(), g = r * C.GRAVITY_R;
  m.dive = 0; m.splashed = 0;
  m.depth = Math.min(depthAt(water.level) * 0.6, r * C.DIVE_DEPTH_R);
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

/* ---- a middle pet's leap ------------------------------------------------- */
/* Up from its depth until the middle of its body reaches the surface, faster and
   faster; out on a gravity arc at that speed (capped like a dive's breach, so it fits
   the headroom); then down again, quick at first and settling at its depth. y is the
   offset from its anchor (negative is up). */
const topBelow = (st, water) => homeY(st, water) + bodyBox(defOf(st)).top * petR() - surfaceY(water);
function startLeap(st, water = st) {
  const m = st.m, r = petR(), g = r * C.GRAVITY_R;
  m.leap = 0; m.splashed = 0;
  m.lh = Math.max(0, homeY(st, water) + bodyMid(st) - surfaceY(water));
  m.g = g;
  m.vb = Math.max(Math.sqrt(2 * g * r * C.BREACH_MIN_R), Math.min(2 * m.lh / C.LEAP_UP_SECS, Math.sqrt(2 * g * r * C.BREACH_R)));
  m.tb = 2 * m.vb / g;
  m.xs0 = m.xs; m.fwd = -m.face;
  const x = petX(st), front = critterExtent(st.critterKind || 0).left * r + r * C.WALL_GAP_R;
  const room = fwd => (fwd < 0 ? x : dims.W - x) - front;
  if (room(m.fwd) < r * C.DIVE_FORWARD_R && room(-m.fwd) > room(m.fwd)) { m.face = -m.face; m.fwd = -m.face; }
}
const leapSecs = m => C.LEAP_UP_SECS + m.tb + C.LEAP_DOWN_SECS;
const canLeap = (st, water) => water.level > 0.02 && topBelow(st, water) >= petR() * C.LEAP_MIN_DEPTH_R;

function leapPath(m, s) {
  const Tu = C.LEAP_UP_SECS, Td = C.LEAP_DOWN_SECS, T = leapSecs(m), F = petR() * C.DIVE_FORWARD_R;
  let y, vy;
  if (s < Tu) {
    const u = s / Tu;
    y = -m.lh * u * u; vy = -2 * m.lh * u / Tu;
  } else if (s < Tu + m.tb) {
    const b = s - Tu;
    y = -m.lh - (m.vb * b - 0.5 * m.g * b * b); vy = -(m.vb - m.g * b);
  } else {
    const u = Math.min(1, (s - Tu - m.tb) / Td), k = Math.PI / 2;
    y = -m.lh * (1 - Math.sin(k * u)); vy = m.lh * k * Math.cos(k * u) / Td;
  }
  const u = Math.min(1, s / T);
  return { x: F * u * u * (3 - 2 * u), y, vx: F * 6 * u * (1 - u) / T, vy };
}

/* ---- drawing ------------------------------------------------------------ */
const waveBuf = [];
let waveN = 0;

/* The surface at x, in px below its level: the slow swell plus any ripples passing. */
function swellAt(st, x) {
  return st.amp * (Math.sin(x * C.WAVE_K1 + st.phase) * 0.62 +
                   Math.sin(x * C.WAVE_K2 - st.phase * 1.35) * 0.38);
}
const waveAt = (st, x) => st.rings.length ? swellAt(st, x) + rippleAt(st, x) : swellAt(st, x);

/* Ripples, seen from the side: where something hit, the surface dips for a moment; a
   short wave packet then runs out along the surface both ways, fading, and comes back
   weaker off each wall (a mirror source behind the wall). Nothing is drawn in the air. */
function rippleAt(st, x) {
  const W = dims.W, k = W / 124, sig = C.RIPPLE_WIDTH * k, q = 6.2832 / (C.RIPPLE_LEN * k), s2 = sig * sig, reach = 3 * sig;
  let y = 0;
  for (const g of st.rings) {
    if (g.t < 0) continue;                                            /* not set off yet */
    const fade = 1 - g.t / C.RIPPLE_LIFE;
    if (fade <= 0) continue;
    const A = g.a * fade * fade, front = C.RIPPLE_SPEED * k * g.t;
    if (g.t < 0.28) { const d = x - g.x; y += g.a * 1.1 * (1 - g.t / 0.28) * Math.exp(-d * d / (s2 * 0.6)); }   /* the dip */
    let s = Math.abs(x - g.x) - front;
    if (s > -reach && s < reach) y -= A * Math.cos(s * q) * Math.exp(-s * s / s2);
    s = x + g.x - front;                                              /* off the left wall */
    if (s > -reach && s < reach) y -= A * C.RIPPLE_ECHO * Math.cos(s * q) * Math.exp(-s * s / s2);
    s = 2 * W - g.x - x - front;                                      /* off the right wall */
    if (s > -reach && s < reach) y -= A * C.RIPPLE_ECHO * Math.cos(s * q) * Math.exp(-s * s / s2);
  }
  return y;
}
/* The surface points i0..i1 of waveBuf as one smooth curve (quadratics through the
   midpoints, so 4 px samples show no corners). Begins with a lineTo to the first point. */
function curveTo(ctx, i0, i1, top, step, W) {
  const px = i => Math.min(i * step, W);
  ctx.lineTo(px(i0), top + waveBuf[i0]);
  for (let i = i0 + 1; i < i1; i++) {
    ctx.quadraticCurveTo(px(i), top + waveBuf[i], (px(i) + px(i + 1)) / 2, top + (waveBuf[i] + waveBuf[i + 1]) / 2);
  }
  ctx.lineTo(px(i1), top + waveBuf[i1]);
}
/* A glint riding each ripple's two fronts: a short, brighter stretch of the surface line
   itself (the points of waveBuf), so it never leaves the water. */
function drawGlints(ctx, st, W, top, step, style, width) {
  const k = W / 124, sig = C.RIPPLE_WIDTH * k;
  ctx.save();
  ctx.strokeStyle = style; ctx.lineWidth = width; ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (const g of st.rings) {
    if (g.t < 0) continue;
    const fade = 1 - g.t / C.RIPPLE_LIFE, front = C.RIPPLE_SPEED * k * g.t;
    if (fade <= 0) continue;
    ctx.globalAlpha = fade * Math.min(1, g.a / (C.RIPPLE_AMP[0] * k));
    for (const dir of [-1, 1]) {
      const c = g.x + dir * front, i0 = Math.max(0, Math.ceil((c - sig * 0.7) / step)), i1 = Math.min(waveN - 1, Math.floor((c + sig * 0.7) / step));
      if (i1 <= i0) continue;                                         /* gone into the wall */
      ctx.beginPath();
      curveTo(ctx, i0, i1, top, step, W);
      ctx.stroke();
      if (front < sig) break;                                         /* still one bump at the start */
    }
  }
  ctx.restore();
}
function buildWave(st, W, step) {
  let i = 0;
  for (let x = 0; x <= W; x += step) waveBuf[i++] = waveAt(st, x);
  if ((i - 1) * step < W) waveBuf[i++] = waveAt(st, W);           /* a last point on the wall, no flat stub */
  waveN = i;
}

function drawGlass(st) {
  const ctx = st.ctx, W = dims.W, H = dims.H, B = BLEED;
  reset(ctx);
  ctx.clearRect(-B, -B, W + 2 * B, H + 2 * B);
  const lvl = Math.min(Math.max(st.level, 0), 1);
  if (lvl <= 0.002) return;
  const top = H - lvl * (H - C.SURFACE_BAND);
  const step = W >= C.GHOST_MIN_W ? C.WAVE_STEP_BIG : C.WAVE_STEP_SMALL;
  buildWave(st, W, step);

  const surface = () => {
    ctx.lineTo(-B, top + waveBuf[0]);
    curveTo(ctx, 0, waveN - 1, top, step, W);
    ctx.lineTo(W + B, top + waveBuf[waveN - 1]);
  };

  if (lineArt.on) { drawWaterLines(ctx, st, W, H, top, step, surface); return; }
  /* body, with a soft depth gradient over the person's colour, out under the border */
  ctx.beginPath();
  ctx.moveTo(-B, H + B);
  surface();
  ctx.lineTo(W + B, H + B);
  ctx.closePath();
  ctx.fillStyle = st.color;
  ctx.fill();
  const g = ctx.createLinearGradient(0, top, 0, H + B);
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
  if (st.goalFx) drawGoalFx(ctx, st, W, H, top);
  if (W >= C.GHOST_MIN_W) {                                           /* a faint second line, kept under the surface */
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
  ctx.restore();
  if (st.goalFx === "potion") drawBoil(ctx, st, W, H, top);

  ctx.beginPath();
  ctx.moveTo(-B, top + waveBuf[0]);
  surface();
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = 2.5;
  ctx.stroke();

  if (st.rings.length) drawGlints(ctx, st, W, top, step, "rgba(255,255,255,0.75)", 3);
}

/* Line art (the Hairline theme): the water is a lit surface line over faint level lines,
   its bubbles small rings; at the goal the surface turns bright, past the cap it breaks
   into dashes. No fill, no colour. */
function drawWaterLines(ctx, st, W, H, top, step, surface) {
  const B = BLEED, goal = st.color === C.OVERFILL_COLOR || !!st.goalFx, danger = st.color === C.DANGER_COLOR;
  ctx.save();
  ctx.beginPath(); ctx.moveTo(-B, H + B); surface(); ctx.lineTo(W + B, H + B); ctx.closePath(); ctx.clip();
  ctx.lineWidth = lineArt.w; ctx.strokeStyle = lineArt.lo;
  ctx.beginPath();
  if (lineArt.hatch === "diag") { for (let x = -H; x < W; x += 7) { ctx.moveTo(x, H); ctx.lineTo(x + H, 0); } }   /* section hatching */
  else for (let y = H - 6; y > top + 8; y -= 9) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
  ctx.stroke();
  ctx.strokeStyle = lineArt.mid;
  for (const b of st.bubbles) {
    const wob = Math.sin(b.y * 0.055 + b.seed) * C.BUBBLE_WOBBLE;
    ctx.beginPath(); ctx.arc(b.x + wob, H - b.y, b.r, 0, 6.2832); ctx.stroke();
  }
  ctx.restore();
  ctx.beginPath(); ctx.moveTo(-B, top + waveBuf[0]); surface();
  ctx.strokeStyle = goal || danger ? lineArt.hi : lineArt.edge; ctx.lineWidth = lineArt.w * (goal ? 1.6 : 1);
  if (danger) ctx.setLineDash([4, 3]);
  ctx.stroke(); ctx.setLineDash([]);
  if (st.rings.length) drawGlints(ctx, st, W, top, step, lineArt.hi, lineArt.w * 2);
}

/* An event day's goal glass (ui sets st.goalFx from GOAL_FX): something themed moving in
   the water, worked out from the clock, so nothing is stored. Inside the water's clip. */
function drawGoalFx(ctx, st, W, H, top) {
  const t = clock(), depth = H - top, n = Math.max(6, Math.round(W / 9));
  if (depth < 8) return;
  /* fixed per glass: seeding from st.phase (which moves every frame) made the particles jump */
  if (st.fxSeed === undefined) st.fxSeed = Math.random() * 1000;
  const rnd = i => { const x = Math.sin(i * 127.1 + st.fxSeed * 311.7) * 43758.5453; return x - Math.floor(x); };
  if (st.goalFx === "potion") {                       /* purple and pale bubbles that swell as they rise, quicker than the glass's own */
    for (let i = 0; i < n; i++) {
      const u = (t * (30 + rnd(i) * 25) / depth + rnd(i + 50)) % 1;
      const x = 6 + rnd(i + 9) * (W - 12) + Math.sin(t * 0.8 + i * 1.3) * 2.5, r = 1.4 + u * (1.6 + rnd(i + 3) * 2.4);
      ctx.globalAlpha = Math.min(1, u * 8, (1 - u) * 6);          /* in at the bottom, out just under the top */
      ctx.fillStyle = i % 3 ? "rgba(176,104,255,0.6)" : "rgba(226,255,206,0.7)";
      ctx.beginPath(); ctx.arc(x, H - u * depth, r, 0, 6.2832); ctx.fill();
    }
    ctx.globalAlpha = 1;
  } else if (st.goalFx === "globe") {                 /* flakes swirling slowly down, as in a shaken snow globe */
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    for (let i = 0; i < n * 1.6; i++) {
      const u = (t * (5 + rnd(i) * 8) / depth + rnd(i + 70)) % 1;
      const x = ((rnd(i + 20) * W + Math.sin(t * 0.9 + i * 1.7) * 8) % W + W) % W;
      ctx.beginPath(); ctx.arc(x, top + 3 + u * (depth - 3), 0.8 + rnd(i + 5) * 1.5, 0, 6.2832); ctx.fill();
    }
  } else if (st.goalFx === "fizz") {                  /* fine streams of quick bubbles, sparkles on top */
    const cols = Math.max(3, Math.round(W / 20));
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    for (let c = 0; c < cols; c++) for (let j = 0; j < 7; j++) {
      const x0 = (c + 0.5) * W / cols + (rnd(c) - 0.5) * 8, u = (t * (55 + rnd(c + 30) * 35) / depth + j / 7) % 1;
      ctx.beginPath(); ctx.arc(x0 + Math.sin(u * 9 + c) * 1.2, H - u * depth, 0.6 + u * 1.1, 0, 6.2832); ctx.fill();
    }
    for (let k = 0; k < 4; k++) {
      const a = Math.max(0, Math.sin(t * 3 + k * 2.1)), x = 8 + rnd(k + 90) * (W - 16), y = top + 4, s = 3.5 * a;
      if (s < 0.5) continue;
      ctx.strokeStyle = "rgba(255,255,255," + (0.9 * a).toFixed(2) + ")"; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(x - s, y); ctx.lineTo(x + s, y); ctx.moveTo(x, y - s); ctx.lineTo(x, y + s); ctx.stroke();
    }
  } else if (st.goalFx === "shimmer") {               /* bands of sunlight drifting through */
    ctx.fillStyle = "rgba(255,255,255,0.14)";
    for (let k = 0; k < 3; k++) {
      const x = ((t * 14 + k * W / 3) % (W + 40)) - 20;
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x + 10, top); ctx.lineTo(x - 18, H); ctx.lineTo(x - 30, H); ctx.closePath(); ctx.fill();
    }
  }
}

/* The potion boils: bubbles swell up as domes on the surface and pop with a ring and a
   fleck or two. Drawn after the water's clip, since a dome stands above the surface. */
function drawBoil(ctx, st, W, H, top) {
  if (H - top < 8) return;
  const t = clock(), m = Math.max(3, Math.round(W / 16));
  const rnd = i => { const x = Math.sin(i * 91.7 + st.fxSeed * 157.3) * 43758.5453; return x - Math.floor(x); };
  for (let i = 0; i < m; i++) {
    const per = 0.9 + rnd(i) * 0.9, c = t / per + rnd(i + 40), u = c % 1, cyc = Math.floor(c);
    const x = 5 + ((rnd(i + 7) + cyc * 0.37) % 1) * (W - 10), y = top + waveAt(st, x), R = 2.8 + rnd(i + 3) * 3.2;
    if (u < 0.7) {                                    /* swelling */
      const r = R * Math.sin(u / 0.7 * Math.PI / 2);
      ctx.fillStyle = "rgba(178,246,150,0.95)"; ctx.strokeStyle = "rgba(48,128,40,0.7)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x, y, r, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.beginPath(); ctx.arc(x - r * 0.35, y - r * 0.5, r * 0.22, 0, 6.2832); ctx.fill();
    } else {                                          /* pop */
      const v = (u - 0.7) / 0.3, a = (1 - v).toFixed(2);
      ctx.strokeStyle = "rgba(220,255,200," + a + ")"; ctx.lineWidth = 1.2;
      ctx.save(); ctx.translate(x, y); ctx.scale(1, 0.35);
      ctx.beginPath(); ctx.arc(0, 0, R * (1 + v * 1.4), 0, 6.2832); ctx.restore(); ctx.stroke();
      ctx.fillStyle = "rgba(190,140,255," + a + ")";
      for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(x + s * R * (0.6 + v), y - R * 2.2 * v * (1.4 - v), 0.9, 0, 6.2832); ctx.fill(); }
    }
  }
}

const duckRestY = (st, r) => restAt(petDefs[st.critterKind || 0], r, floorY());

/* Rolls over round its body middle as it goes down, from where it swam to the middle of
   the floor, ending as the resting pose draws it (origin at duckRestY, upside down). */
function drawSinking(ctx, st, W, H, top, offX, offY, r) {
  const t = st.duckT, mid = bodyMid(st), ang = Math.PI * (t < 0.55 ? t / 0.55 : 1);
  const x0 = W / 2 + Math.sin(st.phase * 0.31) * (W * 0.21);
  const dx = wallX(st, x0 + (W / 2 - x0) * t, ang, 1);
  const from = homeY(st, st, x0) + mid, to = duckRestY(st, r) - mid;      /* the body middle, start and end */
  const py = from + (to - from) * (t * t), dy = py;
  drawTurned(ctx, dx + offX, py - mid + offY, mid, ang, (x, y) =>
    drawCritter(ctx, x, y, r, ang, st.duckCrown, true, st.critterKind || 0, st.critterHue || 0, st.duckJester, lookOf(st).finish));
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
  if (p) drawStream(ctx, st, p, top, offX, offY);
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  for (const d of st.drops) {                                       /* until they land, after the stream ends too */
    ctx.beginPath();
    ctx.arc(offX + d.x, offY + top + d.y, d.r, 0, 6.2832);
    ctx.fill();
  }
}
function drawStream(ctx, st, p, top, offX, offY) {
  const ease = v => 1 - (1 - v) * (1 - v);
  const sx = offX + p.x, surf = offY + top + waveAt(st, p.x);
  const yEnd = surf * Math.min(1, ease(Math.min(1, p.t / C.POUR_LAND)));
  const yStart = p.t > C.POUR_TAIL ? surf * ease((p.t - C.POUR_TAIL) / (1 - C.POUR_TAIL)) : 0;
  if (yEnd - yStart > 1) {
    const g = ctx.createLinearGradient(0, 0, 0, surf);
    g.addColorStop(0, rgba(lineArt.on ? "#a1a1aa" : p.color, 0));
    g.addColorStop(0.22, rgba(lineArt.on ? "#a1a1aa" : p.color, 0.85));
    g.addColorStop(1, rgba(lineArt.on ? "#a1a1aa" : p.color, 0.9));
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
}

/* The cup's decoration, on its own canvas over the whole card and DECOR_MARGIN past it,
   so tall items are not cut at the pet layer's top. Stacked (app.css) over the glass
   and under the crown and the pet; under the glass outline when its drawing says
   "behind", over it otherwise. */
function drawDecorLayer(st) {
  const cv = st.ecv, decor = lookOf(st).decor;
  if (!decor) { if (st.ectx) { cv.hidden = true; st.ectx = null; st.eW = st.eH = 0; } return; }
  const card = cv.parentElement, gwrap = card && card.querySelector(".gwrap"), M = DECOR_MARGIN;
  if (!gwrap) return;
  const w = card.clientWidth + 2 * M, h = card.clientHeight + 2 * M;
  if (!st.ectx || w !== st.eW || h !== st.eH) {
    cv.hidden = false;
    st.ectx = sizeCanvas(cv, w, h); st.eW = w; st.eH = h;
    cv.style.left = cv.style.top = -M + "px";
  }
  cv.classList.toggle("front", !decorBehind(decor));
  const ctx = st.ectx, W = dims.W, H = dims.H, offX = M + gwrap.offsetLeft + 4, offY = M + gwrap.offsetTop + 3;
  reset(ctx);
  ctx.clearRect(0, 0, w, h);
  const top = surfaceY(st);
  const surf = x => offY + (st.level > 0.01 ? top + waveAt(st, Math.max(0, Math.min(W, x - offX))) : H - 2);
  drawDecor(ctx, decor, { x: offX, y: offY, W, H }, surf, clock());
  if (!decorDry(decor)) tintUnderwater(ctx, st, W, H, top, offX, offY);
}

function drawPetLayer(st) {
  const ctx = st.dctx, W = dims.W, H = dims.H, offX = 4 + dims.pad, offY = dims.head + 3;
  st.pinAt = null;
  reset(ctx);
  ctx.clearRect(0, 0, st.dW, st.dH);
  const top = surfaceY(st);
  drawPour(ctx, st, top, offX, offY);
  /* Above the rim anything may overhang the glass; below it, only the inside shows. */
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, st.dW, offY);
  ctx.rect(offX, offY, W, H);
  ctx.clip();
  const r = petR();
  if (st.duckState === 4) drawHeadstone(ctx, W / 2 + offX, floorY() + offY, r, st.critterHue);
  else if (st.duckState === 1 && !st.visit) drawFloating(ctx, st, st, W, H, top, offX, offY, r);
  else if (st.duckState === 1 && st.visit.pose && st.visit.pose.where === st.name && st.visit.stage !== "there") drawTrip(ctx, st, st.visit.pose, offX, offY, r);
  else if (st.duckState === 2) drawSinking(ctx, st, W, H, top, offX, offY, r);
  else if (st.duckState === 3) {
    drawCritter(ctx, W / 2 + offX, duckRestY(st, r) + offY, r, Math.PI, st.duckCrown, true,
                st.critterKind || 0, st.critterHue || 0, st.duckJester, lookOf(st).finish);
  }
  const g = st.guest && anim[st.guest], v = g && g.visit;
  if (v && v.stage === "there") drawFloating(ctx, st, v.sw, W, H, top, offX, offY, r);
  else if (v && v.pose && v.pose.where === st.name) drawTrip(ctx, g, v.pose, offX, offY, r);
  ctx.restore();
  if (st.duckState || st.guest) tintUnderwater(ctx, st, W, H, top, offX, offY);
  placePin(st);
}

/* water: whose glass it is in (waves, surface). pet: who is drawn (its motion, kind,
   hue, crown); the same object for a pet at home, a visitor's own for a guest. */
function drawFloating(ctx, water, pet, W, H, top, offX, offY, r) {
  const m = pet.m, moving = motionOn(), flip = moving ? m.flip : 1, mid = bodyMid(pet);
  const x0 = petX(pet);
  const slope = (swellAt(water, x0 + 5) - swellAt(water, x0 - 5)) / 10, z = zone(pet);
  let dy = homeY(pet, water, x0), ang = z === "surface" ? Math.atan(slope) * (flip < 0 ? -1 : 1) : 0;
  if (moving && m.drop >= 0) {
    if (m.dropWait > 0) return;                                     /* still on the unlock card */
    /* falls, accelerating, from wholly above the pet layer to its place */
    const u = m.drop, b = bodyBox(defOf(pet)), from = -offY - (b.bottom - b.top) / 2 * r - r * 0.3, home = dy + mid;
    dy = from + (home - from) * u * u - mid;
    ang += (1 - u) * 2.4;
  } else if (moving && z === "bottom") {                           /* walks the floor, level, as the Studio shows it */
    const pace = Math.abs(Math.cos(pet.phase * 0.31)), w = m.t * C.WALK_STEP_HZ * Math.PI;
    dy -= Math.abs(Math.sin(w)) * r * C.WALK_BOB_R * (0.3 + 0.7 * pace);
  } else if (moving && z === "air") {                              /* hovers over the water */
    dy += Math.sin(m.t * C.AIR_BOB_HZ * 2 * Math.PI) * r * C.AIR_BOB_R;
    ang = Math.sin(m.t * 1.1) * C.AIR_SWAY;
    if (m.skim >= 0) {                                              /* down until it just touches, and up again */
      const gap = Math.max(0, surfaceY(water) + swellAt(water, x0) - (dy + bodyBox(defOf(pet)).bottom * r));
      dy += gap * Math.sin(Math.PI * Math.min(1, m.skim));
      ang -= 0.25 * Math.sin(2 * Math.PI * Math.min(1, m.skim));
    }
  } else if (moving && z === "middle") {                           /* hangs in the water */
    dy += Math.sin(m.t * 1.3) * r * C.MID_BOB_R;
    if (m.leap >= 0) {
      const l = leapPath(m, m.leap);
      dy += l.y;
      ang = -Math.atan2(l.vy, Math.max(l.vx, r * 0.4)) * 0.85;       /* nose follows the path */
      if (m.leap > C.LEAP_UP_SECS + m.tb + 0.2) airBubbles(ctx, m, x0, dy + bodyBox(defOf(pet)).top * r, top, offX, offY, r);
    }
  } else if (moving) {
    dy += Math.sin(m.t * 2.1) * r * 0.035;                          /* a slow breath */
    if (m.dive >= 0) {
      const d = divePath(m, m.dive);
      dy += d.y;
      ang = -Math.atan2(d.vy, Math.max(d.vx, r * 0.4)) * 0.85;       /* nose follows the path */
      if (m.dive > 0.3 && m.dive < C.DIVE_UNDER_SECS - 0.3) airBubbles(ctx, m, x0, dy + bodyBox(defOf(pet)).top * r, top, offX, offY, r);
    } else if (m.hop >= 0) {
      dy -= r * C.HOP_R * Math.sin(Math.PI * m.hop);
      ang += 0.22 * Math.sin(2 * Math.PI * m.hop);
    }
  }
  const dx = moving ? wallX(pet, x0, ang, flip) : x0;                 /* turned as it is now, still inside */
  const look = lookOf(pet), t = clock(), px = dx + offX, py = dy + offY;
  const spot = look.effect ? fxSpot(defOf(pet)) : null;
  const fs = Math.abs(flip) < 0.04 ? (flip < 0 ? -0.04 : 0.04) : flip;
  let fx = 0, fy = 0;
  if (spot) {                                                         /* follows the pet's facing and turn */
    const lx = spot[0] * r, ly = spot[1] * r - mid, c = Math.cos(ang), n = Math.sin(ang);
    fx = px + fs * (lx * c - ly * n); fy = py + mid + lx * n + ly * c;
  }
  if (look.effect) drawEffect(ctx, look.effect, fx, fy, r, t, pet.critterHue || 0, "back");
  drawTurned(ctx, px, py, mid, ang, (x, y) => {
    ctx.scale(fs, 1);                                                 /* mid-turn: edge on */
    drawCritter(ctx, x, y, r, ang, pet.duckCrown, false, pet.critterKind || 0, pet.critterHue || 0, pet.duckJester, look.finish, pet.duckMedal);
  });
  if (look.effect) drawEffect(ctx, look.effect, fx, fy, r, t, pet.critterHue || 0, "front");
  if (water === pet) {                                                /* where its message pin goes: over its head */
    const b = bodyBox(defOf(pet));
    water.pinAt = [px + fs * (b.x0 + b.x1) / 2 * r, py + b.top * r];
  }
}

/* Air a pet lets go of under the water, rising from the top of its body to the surface. */
function airBubbles(ctx, m, dx, topY, top, offX, offY, r) {
  for (let i = 0; i < 3; i++) {
    const by = topY - ((m.t * 26 + i * 9) % (r * 1.6));
    if (by < top + 2) continue;
    ctx.beginPath();
    ctx.arc(dx + offX + (i - 1) * r * 0.22, by + offY, r * (0.07 - i * 0.012), 0, 6.2832);
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fill();
  }
}

/* Whatever sits below the surface takes on the water's colour, so a pet reads as
   in the glass rather than pasted on it. Only touches pixels already drawn. */
function tintUnderwater(ctx, st, W, H, top, offX, offY) {
  if (lineArt.on) return;                                             /* line art has no colour to tint with */
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
    if (m.dive >= 0 || m.hop >= 0 || m.leap >= 0 || Math.abs(m.flip - m.face) > 0.02 || Math.abs(m.xs) > 0.3) return true;
    if (st.visit || st.guest) return true;
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
  stepDrops(st, dt);
  stepMotion(st, f);
  const waterH = depthAt(st.level);
  for (const b of st.bubbles) { b.y += b.v * f; if (b.y > waterH - 3 || waterH < 10) resetBubble(b); }
  if (st.rings.length) {
    for (const g of st.rings) g.t += dt;
    if (st.rings[0].t >= C.RIPPLE_LIFE) st.rings = st.rings.filter(g => g.t < C.RIPPLE_LIFE);
  }
}

function stepPour(st, p, dt) {
  p.t += dt / p.dur;
  if (p.t >= C.POUR_LAND && p.t < 1) {
    p.ring -= dt;
    if (p.ring <= 0) { ringAt(st, p.x, false, 0.55); p.ring = 0.16; }
    st.amp = Math.max(st.amp, 4);
    for (let i = 0; i < 2 && st.drops.length < 40; i++) {
      st.drops.push({ x: p.x + rnd(-p.w / 2, p.w / 2), y: -1, vx: rnd(-40, 40), vy: rnd(-95, -40), r: rnd(0.9, 1.9) });
    }
  }
  if (p.t >= 1) st.pour = null;
}
/* Droplets thrown up at the impact, in px from the surface: once a frame, until they land. */
function stepDrops(st, dt) {
  if (st.drops.length) st.drops = st.drops.filter(d => { d.x += d.vx * dt; d.y += d.vy * dt; d.vy += 420 * dt; return d.y < 0; });
}

/* Facing, hops, dives and the drop-in for a floating pet. st is the pet (its motion,
   phase, kind); water is the glass it swims in, its own unless it is a guest. */
export function stepMotion(st, f, water = st) {
  const m = st.m, dt = f / 30, r = petR(), play = st.play || 1;
  m.t += dt;
  if (st.duckState !== 1 || !motionOn()) { m.dive = -1; m.hop = -1; m.drop = -1; m.leap = -1; m.skim = -1; return; }

  if (m.drop >= 0) {
    if (m.dropWait > 0) { m.dropWait -= dt; return; }
    m.drop += dt / C.DROP_SECS;
    if (m.drop >= 1) { m.drop = -1; ringAt(water, petX(st), true); water.amp = Math.max(water.amp, 10); m.nextHop = m.t + 0.15; }
    return;
  }

  if (m.dive < 0 && !(m.leap >= 0)) {
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
  const z = zone(st);
  if (z !== "surface") { stepDeep(st, m, z, dt, water, play); return; }

  if (m.dive >= 0) {
    const Tu = C.DIVE_UNDER_SECS;
    /* The water dropped under it (an undo): turn round and come up from here. */
    if (m.dive < Tu / 2 && depthAt(Math.min(water.level, water.target)) < r * C.SURFACE_DEPTH_R) m.dive = Tu - m.dive;
    m.dive += dt;
    m.xs = m.xs0 + m.fwd * divePath(m, Math.min(m.dive, diveSecs(m))).x;
    if (m.splashed === 0 && m.dive > 0.12) { m.splashed = 1; ringAt(water, petX(st), true); }
    if (m.splashed === 1 && m.dive >= Tu) { m.splashed = 2; ringAt(water, petX(st), true); }
    if (m.dive >= diveSecs(m)) {
      m.dive = -1;
      ringAt(water, petX(st), true);
      water.amp = Math.max(water.amp, 8);
      m.nextDive = m.t + rnd(C.DIVE_EVERY[0], C.DIVE_EVERY[1]) * play;
    }
  } else if (m.hop >= 0) {
    m.hop += dt / C.HOP_SECS;
    if (m.hop >= 1) { m.hop = -1; ringAt(water, petX(st), false); m.nextHop = m.t + rnd(C.HOP_EVERY[0], C.HOP_EVERY[1]) * play; }
  } else if (m.t > m.nextDive) {
    if (canDive(water)) startDive(st, water);
    else m.nextDive = m.t + rnd(C.DIVE_EVERY[0], C.DIVE_EVERY[1]) * play;
  } else if (m.t > m.nextHop && water.level > 0.04) {
    m.hop = 0;
  }
}

/* ---- visits ------------------------------------------------------------- */
/* Glasses left to right, row by row, as on screen; set by ui.js on every render. */
/* A middle pet's leaps; no dives, and no hops for either (rev 1.33.1: a bottom pet's
   hops looked jumpy beside the Studio preview). A hop already under way still ends.
   under the water. */
function stepDeep(st, m, z, dt, water, play) {
  const every = (a, b) => m.t + rnd(a, b) * play;
  if (m.leap >= 0) {
    const Tu = C.LEAP_UP_SECS;
    /* the water dropped while it was on the way up (an undo): stop where it is */
    if (m.leap < Tu && water.target < water.level - 0.02 && !canLeap(st, water)) { m.leap = -1; m.nextLeap = every(...C.LEAP_EVERY); return; }
    m.leap += dt;
    m.xs = m.xs0 + m.fwd * leapPath(m, Math.min(m.leap, leapSecs(m))).x;
    if (m.splashed === 0 && m.leap >= Tu) { m.splashed = 1; ringAt(water, petX(st), true); }
    if (m.splashed === 1 && m.leap >= Tu + m.tb) { m.splashed = 2; ringAt(water, petX(st), true); water.amp = Math.max(water.amp, 8); }
    if (m.leap >= leapSecs(m)) { m.leap = -1; m.nextLeap = every(...C.LEAP_EVERY); }
  } else if (m.hop >= 0) {
    m.hop += dt / C.HOP_SECS;
    if (m.hop >= 1) { m.hop = -1; m.nextHop = every(...C.HOP_EVERY); }
  } else if (m.skim >= 0) {
    m.skim += dt / C.SKIM_SECS;
    if (!m.skimRing && m.skim >= 0.5) { m.skimRing = true; if (water.level > 0.02) { ringAt(water, petX(st), false); water.amp = Math.max(water.amp, 5); } }
    if (m.skim >= 1) { m.skim = -1; m.nextSkim = every(...C.SKIM_EVERY); }
  } else if (z === "middle") {
    if (m.nextLeap === undefined) m.nextLeap = every(...C.LEAP_EVERY);
    else if (m.t > m.nextLeap) { if (canLeap(st, water)) startLeap(st, water); else m.nextLeap = every(...C.LEAP_EVERY); }
  } else if (z === "air") {
    if (m.nextSkim === undefined) m.nextSkim = every(...C.SKIM_EVERY);
    else if (m.t > m.nextSkim) { m.skim = 0; m.skimRing = false; }
  }
}

let order = [];
export function setOrder(names) { order = names.slice(); }

/* What the data says, so every screen agrees: a live pet with water can go; a glass
   with water and no dead pet can host. */
const canGo = st => !!st && st.duckState === 1 && st.target >= C.VISIT_MIN_LEVEL;
const canTake = st => !!st && (st.duckState === 0 || st.duckState === 1) && st.target >= C.VISIT_MIN_LEVEL;

/* ---- one timetable for every screen (rev 1.38.8) ----------------------------
   Time is cut into VISIT_SLOT_SECS slots. A slot's visit, if it has one (VISIT_SLOT_CHANCE),
   comes from draws seeded by the slot's number over the glasses that can go and can host
   (sorted by name), so every screen with the same data shows the same visit at the same
   moment. A screen that opens, or wakes, mid-visit skips forward to where it should be.
   Nothing is sent or saved. visitClock is for tests. */
export const visitClock = { now: () => Date.now(), on: true };
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rngOf(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const slotMs = () => C.VISIT_SLOT_SECS * 1000;
const tripSecs = stay => 4 * C.VISIT_BEAM_SECS + 2 * C.VISIT_BEAM_GAP + stay;

/* Slot k's visit, or null: { k, guest, host, start (ms), stay (s) }. */
export function planFor(k, names = order) {
  const r = rngOf(hashStr("visit|" + k));
  const go = r(), pickG = r(), pickH = r(), when = r(), long = r();
  if (go >= C.VISIT_SLOT_CHANCE) return null;
  const all = names.slice().sort(), goers = all.filter(n => canGo(anim[n]));
  if (!goers.length) return null;
  const guest = goers[Math.floor(pickG * goers.length)];
  const hosts = all.filter(n => n !== guest && canTake(anim[n]));
  if (!hosts.length) return null;
  return { k, guest, host: hosts[Math.floor(pickH * hosts.length)],
           start: k * slotMs() + when * C.VISIT_START_SPREAD * 1000,
           stay: C.VISIT_STAY[0] + long * (C.VISIT_STAY[1] - C.VISIT_STAY[0]) };
}

let doneK = -1;
function schedule(now) {
  for (const name in anim) {                                          /* catch up a visit this screen fell behind on */
    const v = anim[name].visit;
    if (v && v.start != null) { const lag = (now - v.start) / 1000 - v.age; if (lag > 0.5) fastForward(name, lag); }
  }
  const k = Math.floor(now / slotMs());
  if (doneK === k) return;
  const p = planFor(k);
  if (!p) return;                                                     /* asked again next frame: the data may not be in yet */
  const age = (now - p.start) / 1000;
  if (age < 0) return;
  doneK = k;
  if (age >= tripSecs(p.stay) - 0.5) return;                          /* over before this screen saw it */
  const g = anim[p.guest], h = anim[p.host];
  if (!g.dcv || !h.dcv || g.visit || g.guest || h.visit || h.guest) return;
  if (startVisit(p.guest, p.host, p)) fastForward(p.guest, age);
}
function fastForward(name, secs) {
  for (let n = Math.round(secs * 30); n > 0 && anim[name].visit; n--) stepVisit(name, 1);
}

/* ---- beam visits (rev 1.38.8) -------------------------------------------
   The pet beams out from where it swims: a column of light, rising sparkles, the pet
   glows white and breaks up into specks. After a short gap it beams in at its place in
   the host's glass (any glass on the page) the same way in reverse, then plays. Home
   the same way. Stages: out (in the glass it leaves), gap, in (in the glass it reaches),
   there (at the host); v.back on the way home. Each step works out v.pose, which the
   glass named in pose.where draws. */
const clamp01 = u => Math.max(0, Math.min(1, u));
const seg = (t, a, b) => clamp01((t - a) / (b - a));
const swimmerOf = (st, v) => v.back ? st : v.sw;
const homeOf = (name, v) => v.back ? name : v.host;      /* the glass it is making for */
const awayOf = (name, v) => v.back ? v.host : name;      /* the glass it is leaving */

/* Where a swimmer is now in a glass, and the way it faces. */
const spotOf = (sw, water) => { const x = petX(sw); return { x, y: homeY(sw, water, x), face: motionOn() ? sw.m.flip : 1 }; };
const hold = m => { m.dive = -1; m.hop = -1; m.leap = -1; m.skim = -1; m.nextDive = m.nextHop = m.nextLeap = m.nextSkim = m.t + 1e6; };
const wake = m => { m.nextDive = m.t + rnd(1.5, 5); m.nextHop = m.t + 0.5; m.nextLeap = m.t + rnd(4, 10); m.nextSkim = m.t + rnd(3, 8); };

function beamOut(v, at) { v.stage = "out"; v.t = 0; v.at = at; v.seed = Math.random() * 1000; }

/* Leaves for the host's glass. */
export function startVisit(name, hostName, plan) {
  const st = anim[name], h = anim[hostName];
  if (!st || !h || st.visit || h.guest || name === hostName) return false;
  const sw = { m: { t: 0, face: 1, flip: 1, drift: 0, xs: 0, dive: -1, hop: -1, drop: -1, dropWait: 0, leap: -1, skim: -1, splashed: 0 },
               off: Math.PI / 0.31, phase: h.phase + Math.PI / 0.31, play: C.VISIT_PLAY, duckState: 1,
               critterKind: st.critterKind, critterHue: st.critterHue, duckCrown: st.duckCrown, duckJester: st.duckJester, duckMedal: st.duckMedal, look: st.look };
  hold(sw.m);
  const v = st.visit = { host: hostName, back: false, sw, age: 0, start: plan ? plan.start : null,
                         untilAge: 2 * C.VISIT_BEAM_SECS + C.VISIT_BEAM_GAP + (plan ? plan.stay : rnd(C.VISIT_STAY[0], C.VISIT_STAY[1])) };
  beamOut(v, spotOf(st, st));
  h.guest = name;
  hold(st.m);
  stepPose(name, st, v);
  return true;
}

/* Beams home from wherever it is in the host's glass. */
function goHome(name) {
  const st = anim[name], v = st && st.visit;
  if (!v || v.stage !== "there") return;
  v.back = true;
  beamOut(v, spotOf(v.sw, anim[v.host]));
  hold(v.sw.m);
}

/* Home at once, wherever it was. */
function endVisit(name) {
  const st = anim[name], v = st && st.visit;
  if (!v) return;
  const h = anim[v.host];
  if (h && h.guest === name) { h.guest = null; h.play = 1; }
  st.visit = null;
  st.m.dive = -1; st.m.hop = -1; st.m.leap = -1; st.m.xs = 0;
  wake(st.m);
}

/* The beam and the pet now: glow = how white, gone = how much has broken up, beam = the
   column's strength; at = where (out: where it stood; in: its place, live). */
function stepPose(name, st, v) {
  const t = clamp01(v.t), out = v.stage === "out", inn = v.stage === "in";
  const at = inn ? spotOf(swimmerOf(st, v), anim[homeOf(name, v)]) : v.at;
  const pose = { where: inn ? homeOf(name, v) : awayOf(name, v), x: at.x, y: at.y, face: at.face, seed: v.seed, t,
                 beam: 0, glow: 0, gone: 1 };
  if (out) {
    pose.beam = seg(t, 0, 0.22) * (1 - seg(t, 0.78, 1));
    pose.glow = seg(t, 0.12, 0.5);
    pose.gone = seg(t, 0.42, 0.86);
  } else if (inn) {
    pose.beam = seg(t, 0, 0.22) * (1 - seg(t, 0.8, 1));
    pose.gone = 1 - seg(t, 0.18, 0.58);
    pose.glow = 1 - seg(t, 0.52, 0.88);
  }
  v.pose = v.stage === "gap" ? null : pose;
}

const beamSecs = v => v.stage === "gap" ? C.VISIT_BEAM_GAP : C.VISIT_BEAM_SECS;

function stepVisit(name, f) {
  const st = anim[name], v = st.visit, dt = f / 30, h = anim[v.host];
  /* a glass left the screen, or the pet changed or is going under: home at once */
  if (!h || !h.dcv || !st.dcv || st.duckState !== 1 || st.critterKind !== v.sw.critterKind || !motionOn()) { endVisit(name); return; }
  v.age += dt;
  Object.assign(v.sw, { critterHue: st.critterHue, duckCrown: st.duckCrown, duckJester: st.duckJester, duckMedal: st.duckMedal, look: st.look });
  v.sw.phase = h.phase + v.sw.off;
  if (v.stage === "there") {
    stepMotion(v.sw, f, h);
    /* the water went, or the host is going under: leave now; else when the stay is up
       and it is not mid-dive */
    const urgent = h.level < C.VISIT_MIN_LEVEL * 0.6 || h.duckState === 2 || h.duckState === 3;
    if (urgent || (v.age >= v.untilAge && v.sw.m.dive < 0 && v.sw.m.hop < 0 && !(v.sw.m.leap >= 0))) goHome(name);
    return;
  }
  if (v.stage === "in" && !v.back) stepMotion(v.sw, f, h);              /* its place drifts with the host's water */
  v.t += dt / beamSecs(v);
  if (v.t >= 1) {
    if (v.stage === "out") {
      v.stage = "gap"; v.t = 0;
      if (v.back) { h.guest = null; h.play = 1; }                         /* gone from the host's glass */
    } else if (v.stage === "gap") {
      v.stage = "in"; v.t = 0; v.seed = Math.random() * 1000;
      hold(swimmerOf(st, v).m);
    } else if (v.back) {                                                  /* home */
      endVisit(name);
      st.m.nextHop = st.m.t + 0.3;
      return;
    } else {
      v.stage = "there";
      wake(v.sw.m);
      h.play = C.VISIT_PLAY;
      if (h.m.dive < 0 && h.m.hop < 0) h.m.nextHop = h.m.t + 0.4;         /* a hello */
      return;
    }
  }
  stepPose(name, st, v);
}

export function stepVisits(f) {
  if (visitClock.on && motionOn() && active) schedule(visitClock.now());
  for (const name in anim) if (anim[name].visit) stepVisit(name, f);
}

/* A fixed scatter per beam: n points in 0..1, from a seed. */
function scatter(seed, n) {
  const out = [];
  let s = Math.floor(seed * 9301 + 49297) % 233280;
  const next = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  for (let i = 0; i < n; i++) out.push([next(), next(), next(), next()]);
  return out;
}

/* The column of light and its sparkles, over the pet's box (glass px + offsets). */
function drawBeam(ctx, cx, top, bottom, w, p, now) {
  if (p.beam <= 0.01) return;
  const a = p.beam, H = bottom - top, cy = (top + bottom) / 2;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";                           /* light added, never a grey box */
  ctx.save();                                                         /* a soft oval of light */
  ctx.translate(cx, cy); ctx.scale(w / 2, H / 2);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  g.addColorStop(0, "rgba(120,190,255," + (0.42 * a).toFixed(3) + ")");
  g.addColorStop(0.55, "rgba(90,160,240," + (0.2 * a).toFixed(3) + ")");
  g.addColorStop(1, "rgba(80,150,230,0)");
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, 1, 0, 6.2832); ctx.fill();
  ctx.restore();
  for (let i = 0; i < 5; i++) {                                       /* faint streaks that flicker */
    const x = cx + (i - 2) * w * 0.14 + Math.sin(now * 7 + i * 2.1) * 1.5;
    const fl = 0.5 + 0.5 * Math.sin(now * 19 + i * 4.7 + p.seed);
    const sg = ctx.createLinearGradient(0, top, 0, bottom);
    sg.addColorStop(0, "rgba(170,220,255,0)"); sg.addColorStop(0.5, "rgba(170,220,255," + (0.28 * a * fl).toFixed(3) + ")"); sg.addColorStop(1, "rgba(170,220,255,0)");
    ctx.strokeStyle = sg; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(x, top + H * 0.06); ctx.lineTo(x, bottom - H * 0.06); ctx.stroke();
  }
  for (const [u, k, ph, sz] of scatter(p.seed, 34)) {                 /* sparkles drift up the column and twinkle */
    const y = bottom - ((k * H + now * (18 + sz * 26)) % H);
    const x = cx + (u - 0.5) * w * 0.7 + Math.sin(now * 3 + ph * 9) * 2;
    const tw = Math.pow(Math.abs(Math.sin(now * (5 + ph * 6) + ph * 20)), 3) * a;
    if (tw < 0.05) continue;
    const r = 0.8 + sz * 1.6;
    ctx.globalAlpha = tw;
    ctx.fillStyle = sz > 0.75 ? "#fff6d6" : "#eaf6ff";
    ctx.beginPath();                                                  /* a small four-point star */
    ctx.moveTo(x, y - r * 2.2); ctx.lineTo(x + r * 0.45, y - r * 0.45); ctx.lineTo(x + r * 2.2, y); ctx.lineTo(x + r * 0.45, y + r * 0.45);
    ctx.lineTo(x, y + r * 2.2); ctx.lineTo(x - r * 0.45, y + r * 0.45); ctx.lineTo(x - r * 2.2, y); ctx.lineTo(x - r * 0.45, y - r * 0.45);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

/* The pet, whitened by glow and broken into specks by gone, drawn through a scratch
   canvas the size of the pet layer. */
let scratch = null;
function drawBeamPet(ctx, pet, p, offX, offY, r) {
  if (p.gone >= 0.995) return;
  const cv = ctx.canvas;
  if (!scratch) scratch = document.createElement("canvas");
  if (scratch.width !== cv.width || scratch.height !== cv.height) { scratch.width = cv.width; scratch.height = cv.height; }
  const sc = scratch.getContext("2d");
  sc.setTransform(1, 0, 0, 1, 0, 0);
  sc.clearRect(0, 0, scratch.width, scratch.height);
  sc.setTransform(ctx.getTransform());
  const mid = bodyMid(pet), fs = Math.abs(p.face) < 0.04 ? (p.face < 0 ? -0.04 : 0.04) : p.face;
  drawTurned(sc, p.x + offX, p.y + offY, mid, 0, (x, y) => {
    sc.scale(fs, 1);
    drawCritter(sc, x, y, r, 0, pet.duckCrown, false, pet.critterKind || 0, pet.critterHue || 0, pet.duckJester, lookOf(pet).finish, pet.duckMedal);
  });
  if (p.glow > 0.01) {                                                /* glows white, the shape kept */
    sc.globalCompositeOperation = "source-atop";
    sc.fillStyle = "rgba(236,246,255," + (0.92 * p.glow).toFixed(3) + ")";
    sc.fillRect(p.x + offX - r * 3, p.y + offY - r * 4, r * 6, r * 7);
  }
  if (p.gone > 0.01) {                                                /* breaks up into specks */
    const b = bodyBox(defOf(pet)), x0 = p.x + offX - r * Math.max(-b.x0, b.x1) - 2, y0 = p.y + offY + b.top * r - 2;
    const bw = r * (Math.max(-b.x0, b.x1) * 2) + 4, bh = (b.bottom - b.top) * r + 4;
    sc.globalCompositeOperation = "destination-out";
    sc.fillStyle = "#000";
    const n = 220, dots = scatter(p.seed + 7, n);
    for (let i = 0; i < n; i++) {
      const [u, k, rank, sz] = dots[i];
      if (rank > p.gone) continue;
      sc.beginPath(); sc.arc(x0 + u * bw, y0 + k * bh, 1.2 + sz * 2.4 + p.gone * 2.2, 0, 6.2832); sc.fill();
    }
  }
  sc.globalCompositeOperation = "source-over";
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1 - Math.max(0, p.gone - 0.6) / 0.4;
  ctx.drawImage(scratch, 0, 0);
  ctx.restore();
}

/* The travelling pet and its beam, in the glass the pose names. */
function drawTrip(ctx, pet, p, offX, offY, r) {
  const b = bodyBox(defOf(pet)), cx = p.x + offX + (b.x0 + b.x1) / 2 * r * p.face;
  const top = p.y + offY + b.top * r - r * 0.9, bottom = p.y + offY + b.bottom * r + r * 0.5;
  const w = Math.max(r * 2.4, (b.x1 - b.x0) * r + r * 0.9), now = clock();
  drawBeam(ctx, cx, top, bottom, w, p, now);
  drawBeamPet(ctx, pet, p, offX, offY, r);
  if (p.beam > 0.3) {                                                 /* a few sparkles over the pet too */
    ctx.save(); ctx.globalAlpha = 0.7;
    drawBeam(ctx, cx, top, bottom, w * 0.6, { beam: p.beam * 0.6, seed: p.seed + 3 }, now * 1.3);
    ctx.restore();
  }
}

/* For tests: a visit's stage and host, if any. */
export const visitOf = name => { const v = anim[name] && anim[name].visit; return v ? { stage: v.stage, host: v.host, t: v.t, back: v.back, where: v.pose && v.pose.where, age: v.age } : null; };

/* For tests: a middle pet's leap, and where a pet lives in a glass. */
export const leapProbe = { start: startLeap, path: leapPath, secs: leapSecs, can: canLeap, home: homeY, surface: surfaceY, floor: floorY, mid: bodyMid };

/* For tests: the turning point, the reach of a turned drawing, and x kept inside the walls. */
export const wallProbe = { mid: bodyMid, reach: reachAt, wallX };

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
  if (lineArt.on) syncLineArt();                                       /* light or dark lines, as the page is now */
  try { stepVisits(f); } catch (e) { stats.errors++; stats.lastError = "visits: " + (e.message || e); }
  for (const k in anim) {
    const st = anim[k];
    if (!st.ctx) continue;
    try {
      stepState(st, f);
      drawGlass(st);
      if (st.dctx) drawPetLayer(st);
      if (st.ecv) drawDecorLayer(st);
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
