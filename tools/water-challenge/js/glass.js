/* Water animation. One state object per person, keyed by name, so a poll never
   restarts a glass. Changes from R55: canvases are sized for devicePixelRatio
   (sharp on scaled displays), and motion is time-based, so 60 fps runs at the
   same speed as the HTA's 30 fps, only smoother. */

import * as C from "./config.js";
import { rnd } from "./util.js";
import { drawCritter, drawHeadstone } from "./art.js";

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

export function applyLayout(lay) {
  if (lay.card === dims.card && lay.cols === dims.cols) return false;
  dims.card = lay.card;
  dims.cols = lay.cols;
  dims.gw = Math.round(lay.card * C.GLASS_W_RATIO);
  dims.gh = Math.round(lay.card * C.GLASS_H_RATIO);
  dims.W = dims.gw - 8;                    /* glass content box, minus borders */
  dims.H = dims.gh - 7;
  dims.head = Math.round(dims.gw * 0.42);
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
                   color: "#60a5fa", bubbles: [], rings: [], ctx: null, dctx: null,
                   duckState: 0, duckT: 0, critterKind: 0, critterHue: 0,
                   duckCrown: false, duckJester: false,
                   m: { t: 0, face: 1, flip: 1, dive: -1, hop: -1, nextDive: rnd(6, 30), nextHop: rnd(3, 12), splashed: 0 } };
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
const petX = st => dims.W / 2 + Math.sin(st.phase * 0.31) * (dims.W * 0.21);
export const petR = () => Math.min(dims.W * 0.26, 30);
const depthAt = level => Math.min(Math.max(level, 0), 1) * (dims.H - C.SURFACE_BAND);

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

function drawPetLayer(st) {
  const ctx = st.dctx, W = dims.W, H = dims.H, offX = 4, offY = dims.head + 3;
  ctx.clearRect(0, 0, st.dW, st.dH);
  if (!st.duckState) return;
  const top = H - Math.min(Math.max(st.level, 0), 1) * (H - C.SURFACE_BAND);
  const r = petR();
  if (st.duckState === 4) { drawHeadstone(ctx, W / 2 + offX, H - 4 + offY, r, st.critterHue); return; }
  if (st.duckState === 1) {
    drawFloating(ctx, st, W, H, top, offX, offY, r);
  } else if (st.duckState === 2) {
    drawSinking(ctx, st, W, H, top, offX, offY, r);
  } else if (st.duckState === 3) {
    drawCritter(ctx, W / 2 + offX, duckRestY(H, r) + offY, r, Math.PI, st.duckCrown, true,
                st.critterKind || 0, st.critterHue || 0, st.duckJester);
  }
  tintUnderwater(ctx, st, W, H, top, offX, offY);
}

function drawFloating(ctx, st, W, H, top, offX, offY, r) {
  const m = st.m, moving = motionOn(), dx = petX(st), flip = moving ? m.flip : 1;
  const slope = (waveAt(st, dx + 5) - waveAt(st, dx - 5)) / 10;
  let dy = top + waveAt(st, dx), ang = Math.atan(slope) * (flip < 0 ? -1 : 1);
  if (moving) {
    dy += Math.sin(m.t * 2.1) * r * 0.035;                      /* a slow breath */
    if (m.dive >= 0) {
      const t = m.dive, depth = Math.min((H - top) * 0.6, r * 3.2);
      dy += depth * Math.sin(Math.PI * t);
      ang += -0.95 * Math.sin(2 * Math.PI * t);                 /* nose down, then up */
      for (let i = 0; i < 3 && t > 0.12 && t < 0.88; i++) {      /* air it lets go of */
        const by = dy - r * 0.6 - ((m.t * 26 + i * 9) % (r * 1.6));
        if (by < top + 2) continue;
        ctx.beginPath();
        ctx.arc(dx + offX + (i - 1) * r * 0.22, by + offY, r * (0.07 - i * 0.012), 0, 6.2832);
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        ctx.fill();
      }
    } else if (m.hop >= 0) {
      dy -= r * 0.55 * Math.sin(Math.PI * m.hop);
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
    const st = anim[k];
    if (!st.ctx) continue;
    if (Math.abs(st.target - st.level) > 0.0006 || st.rings.length || st.duckState === 2) return true;
    if (st.m.dive >= 0 || st.m.hop >= 0 || Math.abs(st.m.flip - st.m.face) > 0.02) return true;
  }
  return false;
}

function step(st, f) {
  const delta = st.target - st.level;
  st.level += delta * (1 - Math.pow(1 - C.LEVEL_EASE, f));
  if (Math.abs(delta) < 0.0004) st.level = st.target;
  st.phase += C.WAVE_SPEED * f;
  if (st.phase > 62832) st.phase = 0;
  const floorAmp = C.AMBIENT_AMP + Math.min(C.FILL_AMP, Math.abs(delta) * C.FILL_AMP * 7);
  if (st.amp > floorAmp) st.amp *= Math.pow(C.AMP_DECAY, f);
  if (st.amp < floorAmp) st.amp = floorAmp;
  if (st.duckState === 2) {
    st.duckT += f / (30 * C.DUCK_SINK_SECS);
    if (st.duckT >= 1) { st.duckState = 3; st.duckT = 0; }
  }
  stepMotion(st, f);
  const waterH = Math.min(Math.max(st.level, 0), 1) * (dims.H - C.SURFACE_BAND);
  for (const b of st.bubbles) { b.y += b.v * f; if (b.y > waterH - 3 || waterH < 10) resetBubble(b); }
  st.rings = st.rings.filter(g => {
    g.r += C.RING_GROWTH * f;
    g.a *= Math.pow(C.RING_FADE, f);
    return g.a > 0.03 && g.r < dims.W;
  });
}

/* Facing, hops and dives for a floating pet. Everything else stays still. */
export function stepMotion(st, f) {
  const m = st.m, dt = f / 30;
  m.t += dt;
  if (st.duckState !== 1 || !motionOn()) { m.dive = -1; m.hop = -1; return; }
  const vel = Math.cos(st.phase * 0.31);               /* the drift's direction */
  if (vel > 0.05) m.face = -1; else if (vel < -0.05) m.face = 1;
  m.flip += (m.face - m.flip) * (1 - Math.pow(1 - C.TURN_EASE, f));
  if (m.dive >= 0) {
    /* The water dropped under it (an undo): turn round and come up from here. */
    if (m.dive < 0.5 && depthAt(Math.min(st.level, st.target)) < petR() * C.SURFACE_DEPTH_R) m.dive = 1 - m.dive;
    m.dive += dt / C.DIVE_SECS;
    if (m.splashed === 0 && m.dive > 0.06) { m.splashed = 1; ringAt(st, petX(st), true); }
    if (m.splashed === 1 && m.dive > 0.92) { m.splashed = 2; ringAt(st, petX(st), true); }
    if (m.dive >= 1) { m.dive = -1; m.nextDive = m.t + rnd(C.DIVE_EVERY[0], C.DIVE_EVERY[1]); }
  } else if (m.hop >= 0) {
    m.hop += dt / C.HOP_SECS;
    if (m.hop >= 1) { m.hop = -1; ringAt(st, petX(st), false); m.nextHop = m.t + rnd(C.HOP_EVERY[0], C.HOP_EVERY[1]); }
  } else if (m.t > m.nextDive) {
    if (canDive(st)) { m.dive = 0; m.splashed = 0; }
    else m.nextDive = m.t + rnd(C.DIVE_EVERY[0], C.DIVE_EVERY[1]);
  } else if (m.t > m.nextHop && st.level > 0.04) {
    m.hop = 0;
  }
}

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
      step(st, f);
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
