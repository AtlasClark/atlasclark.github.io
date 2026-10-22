/* National Hydration Day on screen: the page background becomes a rippling water
   surface (soft moving caustics), and a wave sweeps
   across the screen whenever someone reaches their goal. Still frames only for
   anyone who prefers reduced motion. Rewards are in hydration.js. */

/* Layout set inline too, so a stale cached app.css can not push the page down. */
const LAYER = "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;";

const reduce = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const dark = () => {
  const t = document.documentElement.dataset.theme;
  return t === "dark" || (t !== "light" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
};

/* ---- the background --------------------------------------------------------- */
let bg = null, small = null, img = null, running = false, lastT = 0;
const SW = 160, SH = 96, BG_FPS = 18;

export function setHydrationDay(on) {
  document.body.classList.toggle("hyd-day", !!on);
  if (on && !bg) {
    bg = document.createElement("canvas");
    bg.className = "hyd-bg"; bg.setAttribute("aria-hidden", "true"); bg.style.cssText = LAYER + "z-index:-1;";
    document.body.prepend(bg);
    small = document.createElement("canvas"); small.width = SW; small.height = SH;
    img = small.getContext("2d").createImageData(SW, SH);
  }
  if (!on && bg) { bg.remove(); bg = null; }
  if (on && !running) { running = true; requestAnimationFrame(frame); }
}

function frame(now) {
  if (!bg) { running = false; return; }
  requestAnimationFrame(frame);
  if (document.hidden || now - lastT < 1000 / BG_FPS) return;
  if (reduce() && lastT) return;                               /* one still frame */
  lastT = now;
  const t = now / 1000, w = innerWidth, h = innerHeight, dpr = Math.min(devicePixelRatio || 1, 2);
  if (bg.width !== Math.round(w * dpr)) { bg.width = Math.round(w * dpr); bg.height = Math.round(h * dpr); }
  const ctx = bg.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  /* caustics: a sum of travelling waves, bright where they line up */
  const night = dark(), base = night ? [10, 38, 66] : [120, 196, 230], glow = night ? [70, 150, 210] : [235, 250, 255];
  const d = img.data;
  for (let y = 0; y < SH; y++) {
    for (let x = 0; x < SW; x++) {
      const v = Math.sin(x * 0.11 + t * 0.9) + Math.sin(y * 0.15 - t * 1.1) +
                Math.sin((x + y) * 0.07 + t * 0.6) + Math.sin(Math.hypot(x - SW * 0.3, y - SH * 0.6) * 0.16 - t * 1.4);
      const c = Math.pow(1 - Math.min(1, Math.abs(v) / 1.2), 3);     /* thin bright lines where v ~ 0 */
      const i = (y * SW + x) * 4, k = c * (night ? 0.55 : 0.75);
      d[i] = base[0] + (glow[0] - base[0]) * k; d[i + 1] = base[1] + (glow[1] - base[1]) * k;
      d[i + 2] = base[2] + (glow[2] - base[2]) * k; d[i + 3] = 255;
    }
  }
  small.getContext("2d").putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(small, 0, 0, w, h);

}

/* ---- the goal wave ------------------------------------------------------------ */
/* A translucent swell with a foaming crest rolls across the whole screen, left to
   right, in about WAVE_SECS. Several in a row queue up rather than overlap. */
const WAVE_SECS = 2.2;
let waveQueue = 0, waving = false;

export function goalWave() {
  if (reduce()) return;
  waveQueue++;
  if (!waving) nextWave();
}

function nextWave() {
  if (!waveQueue) { waving = false; return; }
  waveQueue--; waving = true;
  const cv = document.createElement("canvas");
  cv.className = "hyd-wave"; cv.setAttribute("aria-hidden", "true"); cv.style.cssText = LAYER + "z-index:45;";
  document.body.append(cv);
  const dpr = Math.min(devicePixelRatio || 1, 2), w = innerWidth, h = innerHeight;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const foam = makeFoam(h), t0 = performance.now();
  const step = now => {
    const u = (now - t0) / 1000 / WAVE_SECS;
    if (u >= 1) { cv.remove(); nextWave(); return; }
    ctx.clearRect(0, 0, w, h);
    drawWave(ctx, w, h, u, foam);
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export const makeFoam = h => Array.from({ length: 40 }, () => ({ y: Math.random() * h, s: 2 + Math.random() * 5, o: Math.random() * 30 }));

/* One frame of the wave at u (0..1 of its run) on a w x h screen. */
export function drawWave(ctx, w, h, u, foam) {
  const ease = 0.7 * u + 0.3 * (0.5 - 0.5 * Math.cos(Math.PI * u));   /* near steady, soft at the ends */
  const front = -0.1 * w + ease * 1.35 * w, back = front - 0.55 * w, edge = y => front + Math.sin(y * 0.011 + u * 9) * 26 + Math.sin(y * 0.03 - u * 14) * 9;
  const fade = Math.min(1, u * 5, (1 - u) * 4);
  /* the body of the swell, fading out behind */
  const g = ctx.createLinearGradient(back, 0, front, 0);
  g.addColorStop(0, "rgba(70,160,230,0)"); g.addColorStop(0.75, "rgba(70,160,230," + (0.28 * fade).toFixed(3) + ")");
  g.addColorStop(1, "rgba(150,215,250," + (0.42 * fade).toFixed(3) + ")");
  ctx.beginPath(); ctx.moveTo(back, 0);
  for (let y = 0; y <= h; y += 12) ctx.lineTo(edge(y), y);
  ctx.lineTo(back, h); ctx.closePath();
  ctx.fillStyle = g; ctx.fill();
  /* the crest */
  ctx.beginPath();
  for (let y = 0; y <= h; y += 12) (y ? ctx.lineTo : ctx.moveTo).call(ctx, edge(y), y);
  ctx.strokeStyle = "rgba(255,255,255," + (0.8 * fade).toFixed(3) + ")"; ctx.lineWidth = 5; ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255," + (0.7 * fade).toFixed(3) + ")";
  for (const f of foam) { ctx.beginPath(); ctx.arc(edge(f.y) - f.o, f.y, f.s, 0, 6.2832); ctx.fill(); }
}
