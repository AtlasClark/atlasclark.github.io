/* Holiday themes: over a holiday's days (HOLIDAY_HATS entries with a "theme", the
   same days as its hats) the page takes the holiday's colours (app.css, html
   data-holiday) and a moving background, and someone reaching their goal sets off the
   holiday's own effect across the screen. Still frames, no goal effect, for anyone
   who prefers reduced motion. National Hydration Day has its own (hydfx.js). */

const LAYER = "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;";
const FPS = 24;

const reduce = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const dark = () => {
  const t = document.documentElement.dataset.theme;
  return t === "dark" || (t !== "light" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
};
/* Fixed pseudo-random numbers, so the stars and gravestones stay put between frames. */
const seeded = seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647;

/* ---- switching ------------------------------------------------------------------ */
let theme = "", bg = null, running = false, lastT = 0, scene = null;

export function setHolidayTheme(name) {
  name = THEMES[name] ? name : "";
  if (name === theme) return;
  theme = name;
  if (name) document.documentElement.dataset.holiday = name;
  else delete document.documentElement.dataset.holiday;
  if (bg) { bg.remove(); bg = null; }
  if (!name) return;
  bg = document.createElement("canvas");
  bg.className = "holiday-bg"; bg.setAttribute("aria-hidden", "true"); bg.style.cssText = LAYER + "z-index:-1;";
  document.body.prepend(bg);
  scene = THEMES[name].scene();
  lastT = 0;
  if (!running) { running = true; requestAnimationFrame(frame); }
}

function frame(now) {
  if (!bg) { running = false; return; }
  requestAnimationFrame(frame);
  if (document.hidden || now - lastT < 1000 / FPS) return;
  const w = innerWidth, h = innerHeight, dpr = Math.min(devicePixelRatio || 1, 2);
  const resized = bg.width !== Math.round(w * dpr) || bg.height !== Math.round(h * dpr);
  if (reduce() && lastT && !resized) return;                  /* still frames: drawn again only on a resize */
  lastT = now;
  if (resized) { bg.width = Math.round(w * dpr); bg.height = Math.round(h * dpr); }
  const ctx = bg.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  THEMES[theme].draw(ctx, w, h, now / 1000, scene, dark());
}

/* Someone reached their goal: the theme's effect over the whole page, once. */
let fxQueue = 0, fxOn = false;
export function holidayGoal() {
  if (!theme || !THEMES[theme].goal || reduce()) return;
  fxQueue++;
  if (!fxOn) nextFx();
}
function nextFx() {
  if (!fxQueue || !theme) { fxOn = false; fxQueue = 0; return; }
  fxQueue--; fxOn = true;
  const T = THEMES[theme], cv = document.createElement("canvas");
  cv.className = "holiday-fx"; cv.setAttribute("aria-hidden", "true"); cv.style.cssText = LAYER + "z-index:45;";
  document.body.append(cv);
  const dpr = Math.min(devicePixelRatio || 1, 2), w = innerWidth, h = innerHeight;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  const ctx = cv.getContext("2d"), run = T.goal(w, h), t0 = performance.now();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const step = now => {
    const u = (now - t0) / 1000 / run.secs;
    if (u >= 1) { cv.remove(); nextFx(); return; }
    ctx.clearRect(0, 0, w, h);
    run.draw(ctx, u, dark());
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ---- Halloween: a moonlit sky, drifting fog, a graveyard on the skyline, bats ------- */
/* A bat, wings spread s wide each side, f = wing beat (-1 down .. 1 up). */
export function drawBat(ctx, x, y, s, f) {
  const u = f * 0.55;
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  ctx.beginPath();
  ctx.moveTo(0.12, -0.08);
  ctx.quadraticCurveTo(0.55, -0.42 - u * 0.6, 1, -0.2 - u);              /* leading edge to the tip */
  ctx.quadraticCurveTo(0.92, 0.02 - u * 0.5, 0.74, 0.1 - u * 0.45);      /* scalloped trailing edge */
  ctx.quadraticCurveTo(0.62, -0.02 - u * 0.3, 0.46, 0.14 - u * 0.25);
  ctx.quadraticCurveTo(0.32, 0.02 - u * 0.1, 0.13, 0.16);
  ctx.quadraticCurveTo(0, 0.36, -0.13, 0.16);                            /* body */
  ctx.quadraticCurveTo(-0.32, 0.02 - u * 0.1, -0.46, 0.14 - u * 0.25);
  ctx.quadraticCurveTo(-0.62, -0.02 - u * 0.3, -0.74, 0.1 - u * 0.45);
  ctx.quadraticCurveTo(-0.92, 0.02 - u * 0.5, -1, -0.2 - u);
  ctx.quadraticCurveTo(-0.55, -0.42 - u * 0.6, -0.12, -0.08);
  ctx.lineTo(-0.11, -0.3); ctx.lineTo(-0.04, -0.19); ctx.lineTo(0.04, -0.19); ctx.lineTo(0.11, -0.3);   /* ears */
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

function puff(rgb) {                                   /* a soft round fog sprite */
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d"), r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, "rgba(" + rgb + ",1)"); r.addColorStop(0.55, "rgba(" + rgb + ",.45)"); r.addColorStop(1, "rgba(" + rgb + ",0)");
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  return c;
}

function halloweenScene() {
  const rnd = seeded(31);
  return {
    stars: Array.from({ length: 70 }, () => ({ x: rnd(), y: rnd() * 0.6, r: 0.5 + rnd() * 1.1, p: rnd() * 6.28, s: 0.6 + rnd() * 1.6 })),
    fog: Array.from({ length: 9 }, (_, i) => ({ x: rnd(), y: 0.78 + rnd() * 0.2, w: 0.35 + rnd() * 0.3, v: (0.006 + rnd() * 0.01) * (i % 2 ? 1 : -1) })),
    graves: Array.from({ length: 7 }, () => ({ x: rnd(), w: 14 + rnd() * 10, h: 18 + rnd() * 16, tilt: (rnd() - 0.5) * 0.25, cross: rnd() < 0.3 })),
    fogDark: puff("150,120,190"), fogLight: puff("255,255,255"),
    bats: [], nextBat: 3
  };
}

function drawHalloween(ctx, w, h, t, sc, night) {
  /* stars (night only) */
  if (night) for (const s of sc.stars) {
    ctx.globalAlpha = 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(t * s.s + s.p));
    ctx.fillStyle = "#f4eaff";
    ctx.beginPath(); ctx.arc(s.x * w, s.y * h, s.r, 0, 6.2832); ctx.fill();
  }
  ctx.globalAlpha = 1;

  /* the moon, top right, with a halo and a few craters */
  const mr = Math.max(30, Math.min(64, Math.min(w, h) * 0.07)), mx = w - Math.max(70, w * 0.1), my = Math.max(70, h * 0.13);
  const halo = ctx.createRadialGradient(mx, my, mr * 0.8, mx, my, mr * 3.2);
  halo.addColorStop(0, night ? "rgba(255,236,190,.22)" : "rgba(255,255,255,.55)"); halo.addColorStop(1, "rgba(255,236,190,0)");
  ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(mx, my, mr * 3.2, 0, 6.2832); ctx.fill();
  ctx.fillStyle = night ? "#fbeec8" : "rgba(255,252,240,.95)";
  ctx.beginPath(); ctx.arc(mx, my, mr, 0, 6.2832); ctx.fill();
  ctx.fillStyle = night ? "rgba(214,190,140,.45)" : "rgba(220,200,170,.35)";
  for (const [cx, cy, cr] of [[-0.35, -0.2, 0.18], [0.25, 0.28, 0.13], [0.1, -0.42, 0.08], [-0.15, 0.4, 0.07]]) {
    ctx.beginPath(); ctx.arc(mx + cx * mr, my + cy * mr, cr * mr, 0, 6.2832); ctx.fill();
  }

  /* a cobweb in the top-left corner */
  const R = Math.min(150, w * 0.16), spokes = [0, 0.24, 0.5, 0.78, 1.0].map(a => a * Math.PI / 2);
  ctx.strokeStyle = night ? "rgba(225,210,245,.2)" : "rgba(90,60,120,.18)"; ctx.lineWidth = 1;
  ctx.beginPath();
  for (const a of spokes) { ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * R, Math.sin(a) * R); }
  for (let ring = 1; ring <= 5; ring++) {
    const rr = R * ring / 5.4;
    for (let i = 0; i < spokes.length - 1; i++) {
      const a0 = spokes[i], a1 = spokes[i + 1], am = (a0 + a1) / 2, sag = rr * 0.72;
      if (i === 0) ctx.moveTo(Math.cos(a0) * rr, Math.sin(a0) * rr);
      ctx.quadraticCurveTo(Math.cos(am) * sag, Math.sin(am) * sag, Math.cos(a1) * rr, Math.sin(a1) * rr);
    }
  }
  ctx.stroke();

  /* the skyline: a low hill with gravestones and a bare tree */
  const base = h - Math.min(70, h * 0.09);
  ctx.fillStyle = night ? "#07040c" : "rgba(80,48,104,.2)";
  ctx.beginPath(); ctx.moveTo(0, h);
  ctx.lineTo(0, base + 22);
  ctx.bezierCurveTo(w * 0.25, base - 12, w * 0.55, base + 30, w * 0.78, base + 6);
  ctx.bezierCurveTo(w * 0.88, base - 4, w * 0.95, base + 8, w, base + 4);
  ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
  const hill = x => base + 22 + (x / w) * -20 + Math.sin(x / w * 5.2) * 10;        /* roughly on the hill */
  for (const g of sc.graves) {
    const gx = 40 + g.x * (w - 80), gy = hill(gx) + 6;
    ctx.save(); ctx.translate(gx, gy); ctx.rotate(g.tilt);
    ctx.beginPath();
    if (g.cross) { ctx.rect(-2.5, -g.h, 5, g.h); ctx.rect(-8, -g.h * 0.75, 16, 5); }
    else { ctx.moveTo(-g.w / 2, 0); ctx.lineTo(-g.w / 2, -g.h + g.w / 2); ctx.arc(0, -g.h + g.w / 2, g.w / 2, Math.PI, 0); ctx.lineTo(g.w / 2, 0); }
    ctx.fill(); ctx.restore();
  }
  const tx = w * 0.16, ty = hill(tx) + 4;
  ctx.strokeStyle = ctx.fillStyle; ctx.lineCap = "round";
  const branch = (x, y, a, len, wd, n) => {
    const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
    ctx.lineWidth = wd; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke();
    if (n) { branch(x2, y2, a - 0.45, len * 0.68, wd * 0.62, n - 1); branch(x2, y2, a + 0.38, len * 0.62, wd * 0.62, n - 1); }
  };
  branch(tx, ty, -Math.PI / 2 - 0.05, Math.min(60, h * 0.07), 7, 4);

  /* fog drifting along the bottom */
  const sprite = night ? sc.fogDark : sc.fogLight;
  ctx.globalAlpha = night ? 0.2 : 0.5;
  for (const f of sc.fog) {
    const fw = f.w * w, x = (((f.x + t * f.v) % 1.4 + 1.4) % 1.4 - 0.2) * w;
    ctx.drawImage(sprite, x - fw / 2, f.y * h - fw * 0.13, fw, fw * 0.26);
  }
  ctx.globalAlpha = 1;

  /* now and then a bat or two crosses the sky */
  if (!reduce() && t > sc.nextBat) {
    const n = 1 + Math.floor(Math.random() * 3), dir = Math.random() < 0.5 ? 1 : -1, y0 = h * (0.12 + Math.random() * 0.35);
    for (let i = 0; i < n; i++) sc.bats.push({ t0: t + i * 0.35, dir, y: y0 + (i - 1) * 26, s: 9 + Math.random() * 6, secs: 7 + Math.random() * 4, ph: Math.random() * 6 });
    sc.nextBat = t + 7 + Math.random() * 9;
  }
  ctx.fillStyle = night ? "#05030a" : "rgba(52,30,70,.7)";
  sc.bats = sc.bats.filter(b => {
    const u = (t - b.t0) / b.secs;
    if (u > 1) return false;
    if (u < 0) return true;
    const x = b.dir > 0 ? -40 + u * (w + 80) : w + 40 - u * (w + 80);
    drawBat(ctx, x, b.y + Math.sin(u * 14 + b.ph) * 14, b.s, Math.sin(t * 14 + b.ph));
    return true;
  });
}

/* A goal: a swarm of bats bursts out of the bottom-left and sweeps up across the page. */
function halloweenGoal(w, h) {
  const bats = Array.from({ length: 26 }, () => ({
    d: Math.random() * 0.35, y: h * (0.25 + Math.random() * 0.7), s: 10 + Math.random() * 12,
    lift: 0.15 + Math.random() * 0.35, ph: Math.random() * 6.28, sp: 1 + Math.random() * 0.4
  }));
  return {
    secs: 2.8,
    draw(ctx, u, night) {
      ctx.fillStyle = night ? "#0a0612" : "#2c1a3a";
      for (const b of bats) {
        const v = Math.min(1, Math.max(0, (u - b.d) / (1 - b.d)) * b.sp);
        if (v <= 0 || v >= 1) continue;
        ctx.globalAlpha = Math.min(1, v * 6, (1 - v) * 6);
        drawBat(ctx, -60 + v * (w + 120), b.y - v * b.lift * h + Math.sin(v * 12 + b.ph) * 18, b.s, Math.sin(u * 60 + b.ph));
      }
      ctx.globalAlpha = 1;
    }
  };
}

const THEMES = {
  halloween: { scene: halloweenScene, draw: drawHalloween, goal: halloweenGoal }
};
