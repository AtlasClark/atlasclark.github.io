/* Holiday themes (Halloween, Christmas, New Year): over a holiday's days (HOLIDAY_HATS entries with a "theme", the
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

/* ---- Christmas: falling snow, a string of lights, snowy hills with pines ------------ */
const BULBS = ["#e8434d", "#2fb36b", "#f5c242", "#3f8ff0"];

function christmasScene() {
  const rnd = seeded(77);
  return {
    stars: Array.from({ length: 50 }, () => ({ x: rnd(), y: rnd() * 0.5, r: 0.5 + rnd(), p: rnd() * 6.28, s: 0.5 + rnd() * 1.4 })),
    flakes: Array.from({ length: 170 }, () => ({ x: rnd(), y: rnd(), r: 0.8 + rnd() * 2.4, v: 0.025 + rnd() * 0.05, ph: rnd() * 6.28, sw: 6 + rnd() * 14 })),
    pines: Array.from({ length: 9 }, () => ({ x: rnd(), h: 34 + rnd() * 40, back: rnd() < 0.5 })),
    prev: 0
  };
}

/* A pine: three stacked tiers on a short trunk, foot at (x, y). */
function pine(ctx, x, y, h) {
  const w = h * 0.5;
  ctx.fillRect(x - h * 0.04, y - h * 0.12, h * 0.08, h * 0.12);
  for (let i = 0; i < 3; i++) {
    const top = y - h + i * h * 0.24, bot = y - h * 0.1 - (2 - i) * h * 0.18, ww = w * (0.55 + i * 0.22);
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x + ww / 2, bot); ctx.lineTo(x - ww / 2, bot); ctx.closePath(); ctx.fill();
  }
}

function drawChristmas(ctx, w, h, t, sc, night) {
  const dt = Math.min(0.1, Math.max(0, t - (sc.prev || t))); sc.prev = t;
  if (night) for (const s of sc.stars) {
    ctx.globalAlpha = 0.3 + 0.4 * (0.5 + 0.5 * Math.sin(t * s.s + s.p));
    ctx.fillStyle = "#eef6ff"; ctx.beginPath(); ctx.arc(s.x * w, s.y * h, s.r, 0, 6.2832); ctx.fill();
  }
  ctx.globalAlpha = 1;

  /* snowy hills, a back row of pines behind the front hill */
  const base = h - Math.min(80, h * 0.1), px = p => 30 + p.x * (w - 60);
  ctx.fillStyle = night ? "#04120e" : "rgba(28,84,62,.32)";
  for (const p of sc.pines) if (p.back) pine(ctx, px(p), base + 14, p.h * 1.1);
  ctx.fillStyle = night ? "#dfe9f2" : "#ffffff";
  ctx.globalAlpha = night ? 0.9 : 0.95;
  ctx.beginPath(); ctx.moveTo(0, h); ctx.lineTo(0, base + 16);
  ctx.bezierCurveTo(w * 0.2, base - 14, w * 0.42, base + 26, w * 0.62, base + 8);
  ctx.bezierCurveTo(w * 0.8, base - 8, w * 0.92, base + 18, w, base + 6);
  ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = night ? "#062019" : "rgba(28,84,62,.55)";
  for (const p of sc.pines) if (!p.back) pine(ctx, px(p), base + 22 - Math.sin(px(p) / w * 6.3) * 8, p.h);

  /* a string of lights in swags along the top */
  const span = Math.max(180, Math.min(300, w / 4)), n = Math.ceil(w / span), sag = 15, top = 2;
  ctx.strokeStyle = night ? "rgba(30,60,48,.95)" : "rgba(30,70,52,.55)"; ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < n; i++) { const x0 = i * span; ctx.moveTo(x0, top); ctx.quadraticCurveTo(x0 + span / 2, top + sag * 2, x0 + span, top); }
  ctx.stroke();
  for (let i = 0, b = 0; i < n; i++) {
    for (let k = 1; k < 8; k++, b++) {
      const u = k / 8, x = i * span + u * span, y = top + 4 * sag * u * (1 - u) + 5;
      const on = 0.55 + 0.45 * Math.sin(t * 2.2 + b * 1.7);
      ctx.fillStyle = BULBS[b % 4];
      ctx.globalAlpha = (night ? 0.35 : 0.22) * on;
      ctx.beginPath(); ctx.arc(x, y + 3, 9, 0, 6.2832); ctx.fill();                       /* glow */
      ctx.globalAlpha = 0.65 + 0.35 * on;
      ctx.beginPath(); ctx.ellipse(x, y + 3, 3.2, 4.6, 0, 0, 6.2832); ctx.fill();
      ctx.globalAlpha = 1; ctx.fillStyle = night ? "#2a3a33" : "#55705f"; ctx.fillRect(x - 1.8, y - 3, 3.6, 3);
    }
  }

  /* snow (a faint shadow on light pages, so white flakes still show) */
  for (const f of sc.flakes) {
    f.y += f.v * dt; if (f.y > 1.02) { f.y = -0.02; f.x = Math.random(); }
    const x = f.x * w + Math.sin(t * 0.7 + f.ph) * f.sw, y = f.y * h;
    if (!night) { ctx.globalAlpha = 0.5; ctx.fillStyle = "#7aa0be"; ctx.beginPath(); ctx.arc(x + 0.6, y + 0.6, f.r, 0, 6.2832); ctx.fill(); }
    ctx.globalAlpha = night ? 0.85 : 0.95; ctx.fillStyle = "#ffffff";
    ctx.beginPath(); ctx.arc(x, y, f.r, 0, 6.2832); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/* A sleigh and three reindeer flying right, origin at the sleigh's runner; g = gallop phase. */
export function drawSleigh(ctx, x, y, s, g) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  ctx.lineCap = "round"; ctx.lineWidth = 2.2; ctx.strokeStyle = ctx.fillStyle;
  ctx.beginPath(); ctx.moveTo(-34, 0); ctx.lineTo(18, 0); ctx.quadraticCurveTo(30, 0, 28, -8); ctx.stroke();   /* runner */
  ctx.beginPath(); ctx.moveTo(-28, -4); ctx.lineTo(-34, -24); ctx.lineTo(-22, -24); ctx.lineTo(-16, -12);
  ctx.lineTo(12, -12); ctx.lineTo(16, -4); ctx.closePath(); ctx.fill();                                     /* body */
  ctx.beginPath(); ctx.arc(-26, -30, 9, 0, 6.2832); ctx.fill();                                              /* sack */
  ctx.beginPath(); ctx.arc(-8, -22, 7, 0, 6.2832); ctx.fill();                                               /* Santa */
  ctx.beginPath(); ctx.arc(-6, -32, 4.5, 0, 6.2832); ctx.fill();
  ctx.beginPath(); ctx.moveTo(-10, -35); ctx.lineTo(-2, -36); ctx.lineTo(-12, -44); ctx.closePath(); ctx.fill();
  ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(14, -10); ctx.lineTo(118, -26); ctx.stroke();               /* reins */
  for (let i = 0; i < 3; i++) {
    const rx = 48 + i * 36, ry = -14 - i * 5, k = Math.sin(g + i * 1.3) * 6;
    ctx.beginPath(); ctx.ellipse(rx, ry, 13, 5.5, -0.08, 0, 6.2832); ctx.fill();
    ctx.lineWidth = 2; ctx.beginPath();
    ctx.moveTo(rx - 9, ry + 3); ctx.lineTo(rx - 15 - k, ry + 12);                                           /* hind legs */
    ctx.moveTo(rx - 6, ry + 3); ctx.lineTo(rx - 10 + k, ry + 13);
    ctx.moveTo(rx + 8, ry + 3); ctx.lineTo(rx + 14 + k, ry + 11);                                           /* front legs */
    ctx.moveTo(rx + 10, ry + 2); ctx.lineTo(rx + 17 - k, ry + 9);
    ctx.moveTo(rx + 10, ry - 2); ctx.lineTo(rx + 16, ry - 11);                                              /* neck */
    ctx.stroke();
    ctx.beginPath(); ctx.ellipse(rx + 19, ry - 12, 5, 3, 0.2, 0, 6.2832); ctx.fill();
    ctx.lineWidth = 1.3; ctx.beginPath();                                                                   /* antlers */
    ctx.moveTo(rx + 16, ry - 14); ctx.lineTo(rx + 12, ry - 24); ctx.moveTo(rx + 13.5, ry - 19); ctx.lineTo(rx + 8, ry - 21);
    ctx.moveTo(rx + 18, ry - 15); ctx.lineTo(rx + 20, ry - 25); ctx.moveTo(rx + 19.2, ry - 21); ctx.lineTo(rx + 24, ry - 23);
    ctx.stroke();
    if (i === 2) { const c = ctx.fillStyle; ctx.fillStyle = "#ff3b3b"; ctx.beginPath(); ctx.arc(rx + 24, ry - 11, 2.2, 0, 6.2832); ctx.fill(); ctx.fillStyle = c; }
  }
  ctx.restore();
}

/* A goal: Santa's sleigh flies across the page, trailing gold sparkles. */
function christmasGoal(w, h) {
  const path = u => ({ x: -200 + u * (w + 400), y: h * 0.62 - Math.sin(u * Math.PI) * h * 0.38 - u * h * 0.12 });
  const sparks = Array.from({ length: 70 }, () => ({ d: Math.random() * 0.12, jx: (Math.random() - 0.5) * 30, jy: (Math.random() - 0.5) * 22, r: 1 + Math.random() * 2.2 }));
  const s = Math.max(1, Math.min(1.7, w / 900));
  return {
    secs: 3.4,
    draw(ctx, u, night) {
      ctx.fillStyle = "#ffd76a";
      for (const p of sparks) {
        const v = u - p.d - 0.02;
        if (v < 0) continue;
        const q = path(v);
        ctx.globalAlpha = Math.max(0, 1 - p.d / 0.12) * Math.min(1, (1 - u) * 5);
        ctx.beginPath(); ctx.arc(q.x - 30 * s + p.jx, q.y - 6 * s + p.jy + p.d * 120, p.r, 0, 6.2832); ctx.fill();
      }
      ctx.globalAlpha = Math.min(1, u * 8, (1 - u) * 8);
      const q = path(u);
      ctx.fillStyle = night ? "#0a1a14" : "#3a2418";
      drawSleigh(ctx, q.x, q.y, s, u * 40);
      ctx.globalAlpha = 1;
    }
  };
}

/* ---- New Year: fireworks over a city skyline, gold glitter --------------------------- */
const FIRE = ["#ff5c8a", "#ffc23d", "#4fb8ff", "#9b7bff", "#3fe0a0", "#ff8a3d"];

function newYearScene() {
  const rnd = seeded(2027), bldg = [];
  for (let x = 0; x < 1;) {
    const bw = 0.025 + rnd() * 0.05;
    bldg.push({ x, w: bw, h: 26 + rnd() * 70, spire: rnd() < 0.12, lit: Array.from({ length: 12 }, () => rnd() < 0.35) });
    x += bw + rnd() * 0.004;
  }
  return {
    stars: Array.from({ length: 70 }, () => ({ x: rnd(), y: rnd() * 0.6, r: 0.5 + rnd(), p: rnd() * 6.28, s: 0.5 + rnd() * 1.6 })),
    glitter: Array.from({ length: 60 }, () => ({ x: rnd(), y: rnd(), v: 0.012 + rnd() * 0.02, ph: rnd() * 6.28, r: 0.8 + rnd() * 1.4 })),
    bldg, shells: [], next: 0.6, prev: 0
  };
}

/* One firework a seconds after launch: a rocket up for RISE s, then a burst that spreads,
   slows and falls (worked out from a, so nothing is stepped). */
const RISE = 0.9;
function firework(ctx, f, a, h, night) {
  if (a < RISE) {
    const u = a / RISE, y = h + 10 + (f.y - h - 10) * (1 - (1 - u) * (1 - u));
    ctx.strokeStyle = f.col; ctx.globalAlpha = 0.8; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(f.x, y); ctx.lineTo(f.x, y + 14); ctx.stroke();
    return;
  }
  const b = a - RISE, life = 1.9;
  if (b > life) return;
  const k = 2.4, g = 34;
  const at = (i, tt) => { const an = i / f.n * 6.2832 + f.spin, d = f.sp * (1 - Math.exp(-k * tt)) / k;
                          return [f.x + Math.cos(an) * d, f.y + Math.sin(an) * d + 0.5 * g * tt * tt]; };
  ctx.fillStyle = f.col; ctx.strokeStyle = f.col; ctx.lineWidth = 1.6;
  ctx.globalAlpha = (1 - b / life) * (night ? 1 : 0.85);
  for (let i = 0; i < f.n; i++) {
    const [x, y] = at(i, b), [x0, y0] = at(i, Math.max(0, b - 0.12));
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x, y); ctx.stroke();
    if ((i + Math.floor(b * 20)) % 3 || b < 0.6) { ctx.beginPath(); ctx.arc(x, y, 1.6, 0, 6.2832); ctx.fill(); }   /* sparkle as it fades */
  }
  if (b < 0.18) { ctx.globalAlpha = (1 - b / 0.18) * 0.5; ctx.beginPath(); ctx.arc(f.x, f.y, 26, 0, 6.2832); ctx.fill(); }
}
const newShell = (w, h, now) => ({
  t0: now, x: w * (0.1 + Math.random() * 0.8), y: h * (0.12 + Math.random() * 0.3),
  col: FIRE[Math.floor(Math.random() * FIRE.length)], n: 36 + Math.floor(Math.random() * 22),
  sp: 120 + Math.random() * 110, spin: Math.random() * 6.28
});

function drawNewYear(ctx, w, h, t, sc, night) {
  const dt = Math.min(0.1, Math.max(0, t - (sc.prev || t))); sc.prev = t;
  if (night) for (const s of sc.stars) {
    ctx.globalAlpha = 0.3 + 0.45 * (0.5 + 0.5 * Math.sin(t * s.s + s.p));
    ctx.fillStyle = "#f2eeff"; ctx.beginPath(); ctx.arc(s.x * w, s.y * h, s.r, 0, 6.2832); ctx.fill();
  }
  ctx.globalAlpha = 1;

  /* fireworks, behind the skyline */
  if (!reduce() && t > sc.next) { sc.shells.push(newShell(w, h, t)); sc.next = t + 1.1 + Math.random() * 1.8; }
  sc.shells = sc.shells.filter(f => t - f.t0 < RISE + 2);
  for (const f of sc.shells) firework(ctx, f, t - f.t0, h, night);
  ctx.globalAlpha = 1;

  /* the skyline, with lit windows at night */
  for (const b of sc.bldg) {
    const x = b.x * w, bw = b.w * w, top = h - b.h;
    ctx.fillStyle = night ? "#05060f" : "rgba(58,47,122,.2)";
    ctx.fillRect(x, top, bw + 0.5, b.h);
    if (b.spire) { ctx.beginPath(); ctx.moveTo(x + bw / 2 - 2, top); ctx.lineTo(x + bw / 2, top - 22); ctx.lineTo(x + bw / 2 + 2, top); ctx.fill(); }
    if (night) {
      ctx.fillStyle = "rgba(255,213,106,.55)";
      const cols = Math.max(1, Math.floor(bw / 9)), rows = Math.floor(b.h / 12);
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (b.lit[(r * 5 + c * 7) % 12]) ctx.fillRect(x + 3 + c * 9, top + 5 + r * 12, 3.5, 5);
    }
  }

  /* gold glitter drifting down */
  ctx.fillStyle = night ? "#ffd56a" : "#c9951f";
  for (const g of sc.glitter) {
    g.y += g.v * dt; if (g.y > 1.02) { g.y = -0.02; g.x = Math.random(); }
    ctx.globalAlpha = (night ? 0.5 : 0.7) * (0.4 + 0.6 * Math.abs(Math.sin(t * 2.5 + g.ph)));
    ctx.beginPath(); ctx.arc(g.x * w + Math.sin(t * 0.8 + g.ph) * 10, g.y * h, g.r, 0, 6.2832); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/* A goal: confetti cannons from both bottom corners and three fireworks overhead. */
function newYearGoal(w, h) {
  const bits = Array.from({ length: 160 }, (_, i) => {
    const left = i % 2 === 0, an = left ? -1.15 + (Math.random() - 0.5) * 0.7 : -Math.PI + 1.15 + (Math.random() - 0.5) * 0.7;
    const sp = h * (0.9 + Math.random() * 0.7);
    return { x: left ? 0 : w, vx: Math.cos(an) * sp, vy: Math.sin(an) * sp, d: Math.random() * 0.15,
             col: FIRE[i % FIRE.length], s: 4 + Math.random() * 5, rot: Math.random() * 6.28, spin: 6 + Math.random() * 10 };
  });
  const secs = 3.4, shells = [0.1, 0.3, 0.5].map((at, i) => ({ ...newShell(w, h, 0), x: w * (0.25 + i * 0.25), at: at * secs }));
  return {
    secs,
    draw(ctx, u, night) {
      const t = u * secs, k = 1.6;
      for (const f of shells) if (t > f.at) firework(ctx, f, RISE + t - f.at, h, night);
      ctx.globalAlpha = Math.min(1, (1 - u) * 5);
      for (const b of bits) {
        const a = t - b.d * secs;
        if (a <= 0) continue;
        const dx = b.vx * (1 - Math.exp(-k * a)) / k, dy = b.vy * (1 - Math.exp(-k * a)) / k + 0.5 * h * 0.35 * a * a;
        const flip = Math.abs(Math.cos(a * b.spin));                /* a paper square turning over */
        ctx.fillStyle = b.col;
        ctx.save(); ctx.translate(b.x + dx + Math.sin(a * 4 + b.rot) * 8, h + dy); ctx.rotate(b.rot + a * b.spin);
        ctx.fillRect(-b.s / 2, -b.s * 0.3 * flip, b.s, b.s * 0.6 * flip + 0.6);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }
  };
}

const THEMES = {
  halloween: { scene: halloweenScene, draw: drawHalloween, goal: halloweenGoal },
  christmas: { scene: christmasScene, draw: drawChristmas, goal: christmasGoal },
  newyear:   { scene: newYearScene,   draw: drawNewYear,   goal: newYearGoal }
};
