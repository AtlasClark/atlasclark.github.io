/* Holiday and season themes. Holidays (Halloween, Christmas, New Year): over a holiday's days (HOLIDAY_HATS entries with a "theme", the
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

/* ---- Seasons (rev 1.37.11): each browser can turn them off (seasonsOn). A holiday's
   theme, and National Hydration Day, come first. By month: spring March to May, summer
   June to August, autumn September to November, winter December to February. -------- */
const SEASON_KEY = "awc-seasons";
export function seasonsOn() {
  try { return localStorage.getItem(SEASON_KEY) !== "off"; } catch { return true; }
}
export function setSeasonsOn(on) {
  try { localStorage.setItem(SEASON_KEY, on ? "on" : "off"); } catch { }
}
export function seasonOf(key) {
  const m = Number(String(key).slice(5, 7));
  return m >= 3 && m <= 5 ? "spring" : m >= 6 && m <= 8 ? "summer" : m >= 9 && m <= 11 ? "autumn" : "winter";
}

/* Spring: blossom petals drifting down over green hills dotted with flowers. */
function springScene() {
  const rnd = seeded(303);
  return {
    stars: Array.from({ length: 40 }, () => ({ x: rnd(), y: rnd() * 0.5, r: 0.5 + rnd(), p: rnd() * 6.28, s: 0.5 + rnd() * 1.4 })),
    petals: Array.from({ length: 46 }, () => ({ x: rnd(), y: rnd(), r: 3 + rnd() * 4, v: 0.02 + rnd() * 0.035, ph: rnd() * 6.28, sw: 10 + rnd() * 24, c: Math.floor(rnd() * 3) })),
    flowers: Array.from({ length: 26 }, () => ({ x: rnd(), dy: rnd() * 30, c: Math.floor(rnd() * 3) })),
    prev: 0
  };
}
const PETAL = ["#ffc1d9", "#ffd9e8", "#f6a6c7"], FLOWER = ["#ff8fbe", "#ffe37a", "#ffffff"];
function drawSpring(ctx, w, h, t, sc, night) {
  const dt = Math.min(0.1, Math.max(0, t - (sc.prev || t))); sc.prev = t;
  if (night) for (const s of sc.stars) {
    ctx.globalAlpha = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(t * s.s + s.p));
    ctx.fillStyle = "#f0f6ff"; ctx.beginPath(); ctx.arc(s.x * w, s.y * h, s.r, 0, 6.2832); ctx.fill();
  }
  ctx.globalAlpha = 1;
  const base = h - Math.min(80, h * 0.1);
  ctx.fillStyle = night ? "#06120a" : "rgba(120,185,110,.22)";
  ctx.beginPath(); ctx.moveTo(0, h); ctx.lineTo(0, base);
  ctx.bezierCurveTo(w * 0.3, base - 40, w * 0.6, base + 10, w, base - 18); ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
  ctx.fillStyle = night ? "#081a0f" : "rgba(110,180,100,.32)";
  ctx.beginPath(); ctx.moveTo(0, h); ctx.lineTo(0, base + 26);
  ctx.bezierCurveTo(w * 0.25, base + 4, w * 0.55, base + 40, w, base + 14); ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
  for (const f of sc.flowers) {
    const x = f.x * w, y = base + 34 + f.dy + Math.sin(f.x * 9) * 6;
    if (y > h) continue;
    ctx.globalAlpha = night ? 0.45 : 0.85; ctx.fillStyle = FLOWER[f.c];
    for (let i = 0; i < 5; i++) { const a = i * 1.2566; ctx.beginPath(); ctx.arc(x + Math.cos(a) * 2.4, y + Math.sin(a) * 2.4, 1.8, 0, 6.2832); ctx.fill(); }
    ctx.fillStyle = "#f2b234"; ctx.beginPath(); ctx.arc(x, y, 1.3, 0, 6.2832); ctx.fill();
  }
  for (const p of sc.petals) {
    p.y += p.v * dt; if (p.y > 1.03) { p.y = -0.03; p.x = Math.random(); }
    const x = p.x * w + Math.sin(t * 0.8 + p.ph) * p.sw, y = p.y * h;
    ctx.globalAlpha = night ? 0.55 : 0.85; ctx.fillStyle = PETAL[p.c];
    ctx.save(); ctx.translate(x, y); ctx.rotate(t * 0.9 + p.ph); ctx.scale(1, 0.45 + 0.35 * Math.abs(Math.sin(t * 1.4 + p.ph)));
    ctx.beginPath(); ctx.ellipse(0, 0, p.r, p.r * 0.62, 0, 0, 6.2832); ctx.fill(); ctx.restore();
  }
  ctx.globalAlpha = 1;
}

/* Summer: the sun (a moon and fireflies at night) over a sea with a sailboat. */
function summerScene() {
  const rnd = seeded(621);
  return {
    stars: Array.from({ length: 50 }, () => ({ x: rnd(), y: rnd() * 0.55, r: 0.5 + rnd(), p: rnd() * 6.28, s: 0.5 + rnd() * 1.4 })),
    flies: Array.from({ length: 18 }, () => ({ x: rnd(), y: 0.62 + rnd() * 0.25, p: rnd() * 6.28, s: 0.4 + rnd() * 0.8 }))
  };
}
function drawSummer(ctx, w, h, t, sc, night) {
  const r = Math.max(28, Math.min(58, Math.min(w, h) * 0.065)), sx = w - Math.max(80, w * 0.12), sy = Math.max(80, h * 0.14);
  if (night) {
    for (const s of sc.stars) {
      ctx.globalAlpha = 0.3 + 0.4 * (0.5 + 0.5 * Math.sin(t * s.s + s.p));
      ctx.fillStyle = "#fff4dc"; ctx.beginPath(); ctx.arc(s.x * w, s.y * h, s.r, 0, 6.2832); ctx.fill();
    }
    ctx.globalAlpha = 1; ctx.fillStyle = "#fbe7b5";
    ctx.beginPath(); ctx.arc(sx, sy, r * 0.8, 0, 6.2832); ctx.fill();
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--page-a").trim() || "#06111f";
    ctx.beginPath(); ctx.arc(sx + r * 0.36, sy - r * 0.18, r * 0.7, 0, 6.2832); ctx.fill();     /* a crescent */
  } else {
    const g = ctx.createRadialGradient(sx, sy, r * 0.6, sx, sy, r * 3.4);
    g.addColorStop(0, "rgba(255,214,120,.55)"); g.addColorStop(1, "rgba(255,214,120,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, r * 3.4, 0, 6.2832); ctx.fill();
    ctx.strokeStyle = "rgba(255,190,80,.45)"; ctx.lineWidth = 3; ctx.lineCap = "round";
    ctx.beginPath();
    for (let i = 0; i < 12; i++) { const a = i * 0.5236 + t * 0.08; ctx.moveTo(sx + Math.cos(a) * r * 1.25, sy + Math.sin(a) * r * 1.25); ctx.lineTo(sx + Math.cos(a) * r * 1.6, sy + Math.sin(a) * r * 1.6); }
    ctx.stroke();
    ctx.fillStyle = "#ffcf5a"; ctx.beginPath(); ctx.arc(sx, sy, r, 0, 6.2832); ctx.fill();
  }
  /* the sea, three bands of slow waves, and a boat on the far one */
  const sea = h - Math.min(90, h * 0.11);
  for (let b = 0; b < 3; b++) {
    const y0 = sea + b * 22, amp = 4 + b * 2, k = 0.012 - b * 0.002, sp = 0.5 + b * 0.25;
    ctx.fillStyle = night ? ["rgba(30,70,110,.55)", "rgba(24,58,96,.7)", "rgba(16,44,76,.9)"][b] : ["rgba(90,180,230,.18)", "rgba(70,165,220,.24)", "rgba(50,150,210,.32)"][b];
    ctx.beginPath(); ctx.moveTo(0, h);
    for (let x = 0; x <= w + 10; x += 10) ctx.lineTo(x, y0 + Math.sin(x * k + t * sp + b) * amp);
    ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
  }
  const bx = ((t * 6) % (w + 120)) - 60, by = sea + Math.sin(bx * 0.012 + t * 0.5) * 4 - 2;
  ctx.fillStyle = night ? "rgba(200,215,235,.35)" : "rgba(40,70,100,.4)";
  ctx.beginPath(); ctx.moveTo(bx - 14, by); ctx.lineTo(bx + 14, by); ctx.lineTo(bx + 9, by + 6); ctx.lineTo(bx - 9, by + 6); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(bx, by - 2); ctx.lineTo(bx, by - 26); ctx.lineTo(bx + 13, by - 4); ctx.closePath(); ctx.fill();
  if (night) for (const f of sc.flies) {
    const x = f.x * w + Math.sin(t * f.s + f.p) * 30, y = f.y * h + Math.cos(t * f.s * 1.3 + f.p) * 16;
    const a = Math.max(0, Math.sin(t * 1.7 + f.p * 3));
    const g = ctx.createRadialGradient(x, y, 0, x, y, 7);
    g.addColorStop(0, "rgba(255,240,140," + (0.8 * a).toFixed(2) + ")"); g.addColorStop(1, "rgba(255,240,140,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 7, 0, 6.2832); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/* Autumn: leaves tumbling down over a russet hill. */
function autumnScene() {
  const rnd = seeded(915);
  return {
    stars: Array.from({ length: 45 }, () => ({ x: rnd(), y: rnd() * 0.5, r: 0.5 + rnd(), p: rnd() * 6.28, s: 0.5 + rnd() * 1.4 })),
    leaves: Array.from({ length: 30 }, () => ({ x: rnd(), y: rnd(), s: 6 + rnd() * 6, v: 0.03 + rnd() * 0.04, ph: rnd() * 6.28, sw: 16 + rnd() * 30, c: Math.floor(rnd() * 4) })),
    prev: 0
  };
}
const LEAF = ["#d9622b", "#e8a33c", "#b8401f", "#c98a2c"];
function leaf(ctx, s) {
  ctx.beginPath(); ctx.moveTo(0, -s);
  ctx.quadraticCurveTo(s * 0.75, -s * 0.2, 0, s * 0.8);
  ctx.quadraticCurveTo(-s * 0.75, -s * 0.2, 0, -s);
  ctx.fill();
  ctx.strokeStyle = "rgba(90,40,10,.35)"; ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.moveTo(0, -s * 0.8); ctx.lineTo(0, s * 1.05); ctx.stroke();
}
function drawAutumn(ctx, w, h, t, sc, night) {
  const dt = Math.min(0.1, Math.max(0, t - (sc.prev || t))); sc.prev = t;
  if (night) for (const s of sc.stars) {
    ctx.globalAlpha = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(t * s.s + s.p));
    ctx.fillStyle = "#fff0e0"; ctx.beginPath(); ctx.arc(s.x * w, s.y * h, s.r, 0, 6.2832); ctx.fill();
  }
  ctx.globalAlpha = 1;
  const base = h - Math.min(70, h * 0.09);
  ctx.fillStyle = night ? "#0c0704" : "rgba(170,100,50,.18)";
  ctx.beginPath(); ctx.moveTo(0, h); ctx.lineTo(0, base + 10);
  ctx.bezierCurveTo(w * 0.35, base - 30, w * 0.65, base + 30, w, base - 6); ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
  for (const l of sc.leaves) {
    l.y += l.v * dt; if (l.y > 1.03) { l.y = -0.03; l.x = Math.random(); }
    const x = l.x * w + Math.sin(t * 0.7 + l.ph) * l.sw, y = l.y * h;
    ctx.globalAlpha = night ? 0.55 : 0.85; ctx.fillStyle = LEAF[l.c];
    ctx.save(); ctx.translate(x, y); ctx.rotate(Math.sin(t * 1.1 + l.ph) * 1.2 + l.ph);
    ctx.scale(0.55 + 0.45 * Math.abs(Math.cos(t * 1.3 + l.ph)), 1);
    leaf(ctx, l.s); ctx.restore();
  }
  ctx.globalAlpha = 1;
}

/* Winter: light snow over snow-capped mountains. */
function winterScene() {
  const rnd = seeded(1221);
  return {
    stars: Array.from({ length: 60 }, () => ({ x: rnd(), y: rnd() * 0.55, r: 0.5 + rnd(), p: rnd() * 6.28, s: 0.5 + rnd() * 1.4 })),
    flakes: Array.from({ length: 90 }, () => ({ x: rnd(), y: rnd(), r: 0.7 + rnd() * 1.8, v: 0.015 + rnd() * 0.03, ph: rnd() * 6.28, sw: 5 + rnd() * 10 })),
    peaks: [[0, 0.55], [0.14, 0.2], [0.3, 0.5], [0.46, 0.1], [0.62, 0.45], [0.78, 0.18], [0.92, 0.5], [1, 0.35]],
    prev: 0
  };
}
function drawWinter(ctx, w, h, t, sc, night) {
  const dt = Math.min(0.1, Math.max(0, t - (sc.prev || t))); sc.prev = t;
  if (night) for (const s of sc.stars) {
    ctx.globalAlpha = 0.3 + 0.4 * (0.5 + 0.5 * Math.sin(t * s.s + s.p));
    ctx.fillStyle = "#eaf3ff"; ctx.beginPath(); ctx.arc(s.x * w, s.y * h, s.r, 0, 6.2832); ctx.fill();
  }
  ctx.globalAlpha = 1;
  const top = h - Math.min(150, h * 0.18), H = h - top;
  /* two ranges: the far one higher and paler, the near one lower and shifted */
  [[0, 0, night ? "#0b1628" : "rgba(130,160,200,.20)"], [0.09, 0.3, night ? "#0e1c32" : "rgba(150,180,215,.26)"]].forEach(([dx, dy, col]) => {
    const pts = sc.peaks.map(([x, y]) => [(x - dx) * w * 1.1, top + (dy + y * (1 - dy)) * H]);
    ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(-10, h);
    for (const [x, y] of pts) ctx.lineTo(x, y);
    ctx.lineTo(w + 10, h); ctx.closePath(); ctx.fill();
    ctx.fillStyle = night ? "rgba(225,238,252,.45)" : "rgba(255,255,255,.85)";            /* snow caps */
    for (let i = 1; i < pts.length - 1; i++) {
      const [x, y] = pts[i], [lx, ly] = pts[i - 1], [rx, ry] = pts[i + 1];
      if (y > ly || y > ry) continue;
      const k = 0.22;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (lx - x) * k, y + (ly - y) * k); ctx.lineTo(x, y + Math.min(ly - y, ry - y) * k * 0.6);
      ctx.lineTo(x + (rx - x) * k, y + (ry - y) * k); ctx.closePath(); ctx.fill();
    }
  });
  ctx.fillStyle = "#ffffff";
  for (const f of sc.flakes) {
    f.y += f.v * dt; if (f.y > 1.02) { f.y = -0.02; f.x = Math.random(); }
    const x = f.x * w + Math.sin(t * 0.6 + f.ph) * f.sw, y = f.y * h;
    if (!night) { ctx.globalAlpha = 0.45; ctx.fillStyle = "#86a4c2"; ctx.beginPath(); ctx.arc(x + 0.6, y + 0.6, f.r, 0, 6.2832); ctx.fill(); ctx.fillStyle = "#ffffff"; }
    ctx.globalAlpha = night ? 0.8 : 0.95; ctx.beginPath(); ctx.arc(x, y, f.r, 0, 6.2832); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/* ---- Season visitors (rev 1.38.6): now and then something crosses the sky. Autumn:
   one or two ravens. By day, spring: two butterflies; summer: gulls; winter: a cardinal.
   On a dark page those three send a shooting star instead. None under reduced motion. */
const VISIT_FIRST = [20, 60], VISIT_GAP = [60, 150];   /* seconds */
const rr = (a, b) => a + Math.random() * (b - a);
const across = (v, u, pad) => v.dir > 0 ? -pad + u * (innerWidth + pad * 2) : innerWidth + pad - u * (innerWidth + pad * 2);

/* Test hook: the next frame sends a visitor. */
export function seasonVisit() { if (scene) scene.next = 0; }

function visitors(ctx, w, h, t, sc, night, launch) {
  if (reduce()) return;
  sc.vis = sc.vis || [];
  if (sc.next == null) sc.next = t + rr(...VISIT_FIRST);
  if (t > sc.next) { sc.vis.push(...launch(w, h, t, night)); sc.next = t + rr(...VISIT_GAP); }
  sc.vis = sc.vis.filter(v => {
    const u = (t - v.t0) / v.secs;
    if (u > 1) return false;
    if (u >= 0) { ctx.save(); v.draw(ctx, w, h, t, u, v, night); ctx.restore(); }
    return true;
  });
}

/* A bird side on, facing +x, about 1.4 long beak to tail. f = wing beat (-1 down .. 1 up).
   Both wings show, swept back, as if seen a little from below: the far one first. */
export const RAVEN = { body: "#1b1820", far: "#2a2630", bill: 0.22, head: 0.13, fingers: true, span: 1.2,
  tail: [[-0.34, -0.08], [-0.74, -0.17], [-0.9, 0], [-0.74, 0.17], [-0.34, 0.08]] };          /* wedge tail */
export const CARDINAL = { body: "#c8202c", wing: "#a3161f", far: "#7d1018", beak: "#f08a2c", mask: "#2a1416", bill: 0.12, head: 0.14, crest: true,
  tail: [[-0.32, -0.07], [-0.88, -0.11], [-0.9, 0.08], [-0.32, 0.09]] };
/* planform of one wing: x along the body, u = 0 at the shoulder .. 1 at the tip */
const WING = [[0.22, 0], [0.16, 0.42], [-0.02, 0.86], [-0.14, 1]];
const FINGERS = [[-0.2, 0.9], [-0.25, 0.97], [-0.3, 0.86], [-0.35, 0.9], [-0.4, 0.76], [-0.42, 0.7]];
const PLAIN = [[-0.3, 0.92], [-0.4, 0.72]];
function wing(ctx, f, L, k, dx) {
  const lift = -(0.82 * f + 0.14) * k * (L.span || 1);                 /* how far up (or down) the tip sits */
  const pts = WING.concat(L.fingers ? FINGERS : PLAIN, [[-0.36, 0.42], [-0.18, 0]]);
  ctx.beginPath();
  pts.forEach(([x, u], i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, x + dx, u * lift - 0.04));
  ctx.closePath(); ctx.fill();
}
export function drawBird(ctx, x, y, s, f, dir, L) {
  ctx.translate(x, y); ctx.scale(s * dir, s);
  ctx.fillStyle = L.far || L.wing || L.body; wing(ctx, f, L, 0.72, 0.05);
  ctx.fillStyle = L.body;
  ctx.beginPath(); for (const [a, b] of L.tail) ctx.lineTo(a, b); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.ellipse(0, 0.01, 0.44, 0.155, -0.06, 0, 6.2832); ctx.fill();
  ctx.beginPath(); ctx.arc(0.44, -0.08, L.head, 0, 6.2832); ctx.fill();
  if (L.crest) { ctx.beginPath(); ctx.moveTo(0.34, -0.14); ctx.lineTo(0.26, -0.36); ctx.lineTo(0.5, -0.17); ctx.closePath(); ctx.fill(); }
  if (L.mask) { ctx.fillStyle = L.mask; ctx.beginPath(); ctx.arc(0.52, -0.06, 0.06, 0, 6.2832); ctx.fill(); }
  ctx.fillStyle = L.beak || L.body;
  ctx.beginPath(); ctx.moveTo(0.53, -0.14); ctx.quadraticCurveTo(0.56 + L.bill * 0.6, -0.12, 0.55 + L.bill, -0.05); ctx.lineTo(0.53, 0.01); ctx.closePath(); ctx.fill();
  ctx.fillStyle = L.wing || L.body; wing(ctx, f, L, 1, 0);
}

/* The band over the page's header (title, buttons, tabs) at the top of the page, so the
   birds (ravens, gulls, the cardinal) pass behind it rather than behind the glasses. */
function headerBand(h) {
  const g = document.getElementById("glasses"), top = g ? g.getBoundingClientRect().top + scrollY - 24 : 160;
  return Math.max(70, Math.min(h * 0.4, top));
}

function ravens(w, h, t) {
  const band = headerBand(h);
  const n = Math.random() < 0.55 ? 2 : 1, dir = Math.random() < 0.5 ? 1 : -1, y0 = band * rr(0.25, 0.7), secs = rr(10, 14), s = rr(26, 34);
  return Array.from({ length: n }, (_, i) => ({ t0: t + i * rr(0.5, 1.1), secs, dir, y: Math.max(16, Math.min(band - 10, y0 + i * rr(-22, 22))), s: s * (i ? rr(0.85, 1) : 1), ph: rr(0, 9),
    draw(ctx, w, h, t, u, v, night) {
      const c = (t + v.ph) % 2.8;                                    /* four beats, then a glide */
      const f = c < 1.6 ? Math.sin(c * 15.708) : 0.18;
      const x = across(v, u, 60), y = v.y + Math.sin(u * 7 + v.ph) * 8 - f * 1.5;
      ctx.globalAlpha = night ? 0.95 : 0.85;
      ctx.save(); drawBird(ctx, x, y, v.s, f, v.dir, RAVEN); ctx.restore();
      /* warm light from the low sun on its underside: the same bird again in a gradient
         that is clear above the body line (bird units; read at fill time) */
      const g = ctx.createLinearGradient(0, -0.02, 0, 0.6), k = night ? 0.6 : 0.5;
      g.addColorStop(0, "rgba(255,140,60,0)");                       /* brightest along the belly, a hint on a lowered wing */
      g.addColorStop(0.3, "rgba(255,145,65," + k + ")");
      g.addColorStop(0.6, "rgba(255,145,65," + (k * 0.3).toFixed(2) + ")");
      g.addColorStop(1, "rgba(255,145,65," + (k * 0.12).toFixed(2) + ")");
      ctx.save(); drawBird(ctx, x, y, v.s, f, v.dir, Object.assign({}, RAVEN, { body: g, far: g, wing: g })); ctx.restore();
    } }));
}

function cardinal(w, h, t) {
  const band = headerBand(h);
  return [{ t0: t, secs: rr(9, 12), dir: Math.random() < 0.5 ? 1 : -1, y: Math.max(28, band * rr(0.4, 0.7)), s: rr(22, 27), ph: rr(0, 9),
    draw(ctx, w, h, t, u, v) {
      const c = (t + v.ph) % 0.8, flap = c < 0.4;                   /* bounding: a burst of beats, then wings shut */
      const f = flap ? Math.sin(c * 47.12) : -0.08;
      const hop = Math.sin(((t + v.ph) % 0.8) / 0.8 * Math.PI) * 9;
      drawBird(ctx, across(v, u, 40), v.y - hop + Math.sin(u * 5 + v.ph) * 16, v.s, f, v.dir, CARDINAL);
    } }];
}

const WINGS = [["#f7b733", "#c9781a"], ["#6cc4f0", "#2f7fb5"], ["#f48fb1", "#c2557e"], ["#b48cf0", "#7a52c0"]];
function butterflies(w, h, t) {
  const dir = Math.random() < 0.5 ? 1 : -1, y0 = h * rr(0.25, 0.6), secs = rr(16, 22);
  const a = Math.floor(rr(0, WINGS.length)), b = (a + 1 + Math.floor(rr(0, WINGS.length - 1))) % WINGS.length;
  return [a, b].map((c, i) => ({ t0: t + i * rr(0.6, 1.4), secs, dir, y: y0, s: rr(10, 13), ph: rr(0, 9), col: WINGS[c],
    draw(ctx, w, h, t, u, v) {
      const x = across(v, u, 30) + Math.sin(u * 9 + v.ph) * 26, y = v.y + Math.sin(u * 6 + v.ph) * 46 + Math.sin(t * 9 + v.ph) * 4;
      const open = 0.2 + 0.8 * Math.abs(Math.cos(t * 11 + v.ph)), s = v.s;
      ctx.translate(x, y); ctx.rotate(Math.sin(t * 2 + v.ph) * 0.25);
      ctx.globalAlpha = 0.9; ctx.strokeStyle = v.col[1]; ctx.lineWidth = 0.8;
      for (const side of [-1, 1]) {
        ctx.fillStyle = v.col[0];
        ctx.beginPath(); ctx.ellipse(side * s * 0.55 * open, -s * 0.28, s * 0.55 * open, s * 0.42, side * 0.5, 0, 6.2832); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.ellipse(side * s * 0.38 * open, s * 0.3, s * 0.38 * open, s * 0.3, -side * 0.4, 0, 6.2832); ctx.fill(); ctx.stroke();
      }
      ctx.fillStyle = "#3a2a1c"; ctx.beginPath(); ctx.ellipse(0, 0, s * 0.09, s * 0.55, 0, 0, 6.2832); ctx.fill();
      ctx.strokeStyle = "#3a2a1c"; ctx.beginPath(); ctx.moveTo(-1, -s * 0.5); ctx.lineTo(-s * 0.25, -s * 0.85); ctx.moveTo(1, -s * 0.5); ctx.lineTo(s * 0.25, -s * 0.85); ctx.stroke();
    } }));
}

function gulls(w, h, t) {
  const band = headerBand(h), n = 2 + (Math.random() < 0.4 ? 1 : 0), dir = Math.random() < 0.5 ? 1 : -1, y0 = band * rr(0.25, 0.65), secs = rr(14, 19);
  return Array.from({ length: n }, (_, i) => ({ t0: t + i * rr(0.4, 1.2), secs: secs * rr(0.92, 1.08), dir, y: Math.max(18, Math.min(band - 14, y0 + i * rr(-24, 24))), s: rr(13, 18), ph: rr(0, 9),
    draw(ctx, w, h, t, u, v) {
      const c = (t + v.ph) % 4, f = c < 1.2 ? Math.sin(c * 10.47) : 0.15;   /* a few slow beats, a long glide */
      const x = across(v, u, 30), y = v.y + Math.sin(u * 4 + v.ph) * 18, s = v.s, k = f * 0.35;
      ctx.strokeStyle = "rgba(55,72,92,.7)"; ctx.lineWidth = Math.max(1.6, s * 0.14); ctx.lineCap = ctx.lineJoin = "round";
      ctx.beginPath(); ctx.moveTo(x - s, y - s * (0.15 + k));
      ctx.quadraticCurveTo(x - s * 0.5, y - s * (0.5 + k * 0.6), x, y);
      ctx.quadraticCurveTo(x + s * 0.5, y - s * (0.5 + k * 0.6), x + s, y - s * (0.15 + k));
      ctx.stroke();
    } }));
}

function shootingStar(w, h, t) {
  const dir = Math.random() < 0.5 ? 1 : -1, x0 = w * (dir > 0 ? rr(0.05, 0.5) : rr(0.5, 0.95)), y0 = h * rr(0.05, 0.3);
  const ang = rr(0.35, 0.6), dx = Math.cos(ang) * dir, dy = Math.sin(ang), D = rr(260, 420), L = rr(110, 180);
  return [{ t0: t, secs: rr(0.9, 1.3), dir,
    draw(ctx, w, h, t, u) {
      const e = 1 - (1 - u) * (1 - u), hx = x0 + dx * D * e, hy = y0 + dy * D * e, len = L * Math.min(1, u * 3);
      const tx = hx - dx * len, ty = hy - dy * len, a = Math.sin(Math.PI * u);
      const g = ctx.createLinearGradient(hx, hy, tx, ty);
      g.addColorStop(0, "rgba(255,250,235," + a.toFixed(2) + ")"); g.addColorStop(1, "rgba(255,250,235,0)");
      ctx.strokeStyle = g; ctx.lineWidth = 2; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.globalAlpha = a; ctx.fillStyle = "#fffaf0"; ctx.shadowColor = "rgba(255,245,220,.9)"; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(hx, hy, 1.8, 0, 6.2832); ctx.fill();
    } }];
}

const VISITORS = {
  spring: (w, h, t, night) => night ? shootingStar(w, h, t) : butterflies(w, h, t),
  summer: (w, h, t, night) => night ? shootingStar(w, h, t) : gulls(w, h, t),
  autumn: ravens,
  winter: (w, h, t, night) => night ? shootingStar(w, h, t) : cardinal(w, h, t)
};
const withVisitors = (draw, season) => (ctx, w, h, t, sc, night) => { draw(ctx, w, h, t, sc, night); visitors(ctx, w, h, t, sc, night, VISITORS[season]); };

/* ---- bought themes (rev 1.39.0): a worn theme replaces the season; a holiday wins. ---- */
/* Atlas: the tools hub's dot grid, and now and then a band of lime light sweeping across it. */
function atlasScene() { return { gap: 22, sweep: 0 }; }
function drawAtlas(ctx, w, h, t, sc, night) {
  const g = sc.gap, period = 11, u = (t % period) / 4.2;           /* a sweep takes 4.2 s, then rests */
  const band = u <= 1 ? -h * 0.6 + u * (w + h * 1.2) : -1e9;       /* along x + y */
  const base = night ? "rgba(236,237,230,.10)" : "rgba(16,17,14,.11)";
  ctx.fillStyle = base;
  for (let y = g / 2; y < h; y += g) for (let x = g / 2; x < w; x += g) {
    const d = Math.abs(x + y * 0.6 - band);
    if (d < 70) continue;
    ctx.fillRect(x - 0.9, y - 0.9, 1.8, 1.8);
  }
  if (band > -1e8) {
    for (let y = g / 2; y < h; y += g) for (let x = g / 2; x < w; x += g) {
      const d = Math.abs(x + y * 0.6 - band);
      if (d >= 70) continue;
      const k = 1 - d / 70;
      ctx.fillStyle = "rgba(" + (night ? "208,221,43," : "140,152,0,") + (0.18 + 0.7 * k).toFixed(3) + ")";
      const r = 0.9 + 1.3 * k;
      ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
  }
}

/* Hairline: a faint isometric grid fading down the page, and one line figure over the
   header, a glass drawn in hairlines whose water slowly rises and falls. Dashed lines are
   the edges that would be hidden. */
function hairlineScene() { return {}; }
const HL_TONES = { dark: { plate: "#08090a", hi: "#fafafa", edge: "#a1a1aa", mid: "#52525b", back: "#3f3f46", grid: "39,39,42" },
                   light: { plate: "#fafafa", hi: "#09090b", edge: "#52525b", mid: "#a1a1aa", back: "#d4d4d8", grid: "212,212,216" } };
function drawHairline(ctx, w, h, t, sc, night) {
  const T = night ? HL_TONES.dark : HL_TONES.light;
  ctx.lineWidth = 0.9;
  const s = 46, fade = ctx.createLinearGradient(0, 0, 0, h);
  fade.addColorStop(0, "rgba(" + T.grid + ",.9)"); fade.addColorStop(0.55, "rgba(" + T.grid + ",.35)"); fade.addColorStop(1, "rgba(" + T.grid + ",0)");
  ctx.strokeStyle = fade;
  ctx.beginPath();
  for (let c = -h; c < w + h; c += s) {                             /* lines at +/- 26.57 degrees (2:1) */
    ctx.moveTo(c, 0); ctx.lineTo(c + h * 2, h);
    ctx.moveTo(c, 0); ctx.lineTo(c - h * 2, h);
  }
  ctx.stroke();
  /* the figure: an isometric glass, centred in the header band at the right */
  /* the figure sits right of the tabs, between the progress bar and the glasses; on a
     screen too narrow for it, it is left out */
  const tabs = document.querySelector(".tabs [role=tab]:last-child"), g = document.getElementById("glasses");
  if (!tabs || !g) return;
  const tr = tabs.getBoundingClientRect(), R = 15, ry = R / 2, Hh = 28;
  const cx = tr.right + 26 + R * 2.2, botY = g.getBoundingClientRect().top - 14 - ry, topY = botY - Hh;
  if (cx + R + 12 > w || botY < -20) return;
  const ease = x => 1 - Math.pow(1 - x, 3), ph = (t % 14) / 7, lvl = 0.25 + 0.5 * (ph < 1 ? ease(ph) : 1 - ease(ph - 1));
  const wy = botY - (botY - topY) * lvl;
  const ell = (y, from, to, dash, col) => { ctx.setLineDash(dash); ctx.strokeStyle = col; ctx.beginPath(); ctx.ellipse(cx, y, R, ry, 0, from, to); ctx.stroke(); };
  ctx.fillStyle = T.plate;                                          /* the plate: opaque, as the figure sits on it */
  ctx.beginPath(); ctx.ellipse(cx, topY, R, ry, 0, Math.PI, 0); ctx.lineTo(cx + R, botY); ctx.ellipse(cx, botY, R, ry, 0, 0, Math.PI); ctx.closePath(); ctx.fill();
  ell(botY, Math.PI, 2 * Math.PI, [2, 3], T.back);               /* the back of the base: hidden */
  ell(wy, Math.PI, 2 * Math.PI, [2, 3], T.mid);
  ell(wy, 0, Math.PI, [], T.hi);                               /* the water's near edge: lit */
  ctx.setLineDash([]); ctx.strokeStyle = T.edge;                 /* silhouette */
  ctx.beginPath(); ctx.moveTo(cx - R, topY); ctx.lineTo(cx - R, botY); ctx.moveTo(cx + R, topY); ctx.lineTo(cx + R, botY); ctx.stroke();
  ell(botY, 0, Math.PI, [], T.edge);
  ell(topY, 0, 2 * Math.PI, [], T.edge);
  ell(topY + 2.2, 0, Math.PI, [], T.mid);                       /* a dim crease just inside the rim */
  ctx.setLineDash([]);
}

/* Blueprint: a drafting sheet. A fine grid with a heavier line every five squares,
   registration marks in the corners, a title block, and a compass that slowly draws a
   construction circle beside the tabs. Dark = white on blue, light = blue on white. */
function blueprintScene() { return {}; }
function drawBlueprint(ctx, w, h, t, sc, night) {
  const ink = night ? "207,227,255" : "31,78,140", g = 14;
  ctx.lineWidth = 1;
  for (let pass = 0; pass < 2; pass++) {
    ctx.strokeStyle = "rgba(" + ink + "," + (pass ? (night ? 0.16 : 0.18) : (night ? 0.07 : 0.08)) + ")";
    ctx.beginPath();
    for (let x = 0, i = 0; x <= w; x += g, i++) if ((i % 5 === 0) === !!pass) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, h); }
    for (let y = 0, i = 0; y <= h; y += g, i++) if ((i % 5 === 0) === !!pass) { ctx.moveTo(0, y + 0.5); ctx.lineTo(w, y + 0.5); }
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(" + ink + ",.55)"; ctx.lineWidth = 0.9;
  for (const [x, y] of [[22, 22], [w - 22, 22], [22, h - 52], [w - 22, h - 52]]) {   /* registration marks */
    ctx.beginPath(); ctx.arc(x, y, 7, 0, 6.2832); ctx.moveTo(x - 12, y); ctx.lineTo(x + 12, y); ctx.moveTo(x, y - 12); ctx.lineTo(x, y + 12); ctx.stroke();
  }
  /* the title block, bottom right above the status bar */
  const bw = Math.min(232, w * 0.4), bh = 58, bx = w - bw - 40, by = h - bh - 40;
  if (bw > 150) {
    ctx.fillStyle = night ? "rgba(15,58,110,.85)" : "rgba(244,247,251,.9)"; ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = "rgba(" + ink + ",.6)"; ctx.strokeRect(bx + 0.5, by + 0.5, bw, bh);
    ctx.beginPath(); ctx.moveTo(bx, by + 30.5); ctx.lineTo(bx + bw, by + 30.5); ctx.moveTo(bx + bw * 0.5 + 0.5, by + 30); ctx.lineTo(bx + bw * 0.5 + 0.5, by + bh); ctx.stroke();
    ctx.fillStyle = "rgba(" + ink + ",.85)"; ctx.font = "600 11px 'Geist Mono', Consolas, monospace"; ctx.textBaseline = "middle";
    ctx.fillText("WATER CHALLENGE", bx + 8, by + 11);
    ctx.font = "9px 'Geist Mono', Consolas, monospace"; ctx.fillStyle = "rgba(" + ink + ",.6)";
    ctx.fillText("DWG H2O-001  ·  HYDRATION ASSY", bx + 8, by + 23);
    ctx.fillText("SCALE 1:1", bx + 8, by + 44); ctx.fillText("SHEET 1 OF 1", bx + bw * 0.5 + 8, by + 44);
  }
  /* the compass: a construction circle drawn round, held, then rubbed out */
  const tabs = document.querySelector(".tabs [role=tab]:last-child"), gl = document.getElementById("glasses");
  if (!tabs || !gl) return;
  const tr = tabs.getBoundingClientRect(), R = 16, cx = tr.right + 30 + R, cy = (tr.top + gl.getBoundingClientRect().top) / 2 + 4;
  if (cx + R + 14 > w || cy < -20) return;
  const ph = (t % 9) / 9, ease = x => 1 - Math.pow(1 - x, 3), sweep = ph < 0.55 ? ease(ph / 0.55) : 1, fade = ph < 0.8 ? 1 : 1 - (ph - 0.8) / 0.2;
  const a = -Math.PI / 2 + sweep * 2 * Math.PI;
  ctx.globalAlpha = fade;
  ctx.strokeStyle = "rgba(" + ink + ",.35)"; ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.moveTo(cx - R - 8, cy); ctx.lineTo(cx + R + 8, cy); ctx.moveTo(cx, cy - R - 8); ctx.lineTo(cx, cy + R + 8); ctx.stroke();
  ctx.setLineDash([]); ctx.strokeStyle = "rgba(" + ink + ",.9)";
  ctx.beginPath(); ctx.arc(cx, cy, R, -Math.PI / 2, a); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); ctx.stroke();   /* the compass arm */
  ctx.fillStyle = "rgba(" + ink + ",.9)"; ctx.beginPath(); ctx.arc(cx, cy, 1.6, 0, 6.2832); ctx.fill();
  ctx.globalAlpha = 1;
}

/* Synthwave: a striped sun setting on the horizon, a grid floor rolling toward you and
   stars over it; on a light page the pastel version. */
function synthScene() {
  const rnd = seeded(808);
  return { stars: Array.from({ length: 70 }, () => ({ x: rnd(), y: rnd() * 0.6, r: 0.4 + rnd() * 1.2, p: rnd() * 6.28, s: 0.6 + rnd() * 1.6 })) };
}
function drawSynth(ctx, w, h, t, sc, night) {
  const hz = h * 0.66, R = Math.max(70, Math.min(w, h) * 0.2), cx = w / 2;
  if (night) for (const s of sc.stars) {
    if (s.y * h > hz - R * 0.2) continue;
    ctx.globalAlpha = 0.3 + 0.5 * (0.5 + 0.5 * Math.sin(t * s.s + s.p));
    ctx.fillStyle = "#ffe8ff"; ctx.beginPath(); ctx.arc(s.x * w, s.y * h, s.r, 0, 6.2832); ctx.fill();
  }
  ctx.globalAlpha = 1;
  /* the sun: a gradient disc with bands cut out of its lower half, widening down */
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, w, hz); ctx.clip();
  const sg = ctx.createLinearGradient(0, hz - R, 0, hz + R * 0.2);
  if (night) { sg.addColorStop(0, "#ffd319"); sg.addColorStop(0.55, "#ff7a3d"); sg.addColorStop(1, "#ff2e88"); }
  else { sg.addColorStop(0, "#fff1a8"); sg.addColorStop(0.55, "#ffb3d9"); sg.addColorStop(1, "#c9a7ff"); }
  ctx.shadowColor = night ? "rgba(255,46,136,.6)" : "rgba(255,170,220,.6)"; ctx.shadowBlur = 40;
  ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(cx, hz, R, Math.PI, 0); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath(); ctx.arc(cx, hz, R, Math.PI, 0); ctx.closePath(); ctx.clip();   /* bands only across the disc */
  for (let i = 0; i < 6; i++) {
    const y = hz - R * 0.08 - i * R * 0.13 - ((t * 6) % (R * 0.13)), th = Math.max(1, 6 - i) * R * 0.012;
    if (y < hz - R * 0.75) continue;
    ctx.fillRect(cx - R, y, R * 2, th);
  }
  ctx.restore();
  /* the floor: lines toward a point on the horizon, crossing lines rushing in */
  const line = night ? "255,46,200" : "160,120,255";
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = "rgba(" + line + ",.55)";
  ctx.beginPath();
  for (let i = -14; i <= 14; i++) { ctx.moveTo(cx + i * 6, hz); ctx.lineTo(cx + i * w * 0.16, h); }
  const n = 12, sp = (t * 0.35) % 1;
  for (let k = 0; k < n; k++) {
    const u = (k + sp) / n, y = hz + (h - hz) * u * u;
    ctx.moveTo(0, y); ctx.lineTo(w, y);
  }
  ctx.stroke();
  const glow = ctx.createLinearGradient(0, hz - 30, 0, hz + 20);
  glow.addColorStop(0, "rgba(" + line + ",0)"); glow.addColorStop(0.6, "rgba(" + line + ",.45)"); glow.addColorStop(1, "rgba(" + line + ",0)");
  ctx.fillStyle = glow; ctx.fillRect(0, hz - 30, w, 50);                 /* the horizon glows */

  timeCar(ctx, w, h, t, sc, night);
}

/* Now and then (rarely) a flying time-car: a low steel wedge, wheels folded flat for
   flight, an underglow, and streaks of light behind it, banking along a gentle arc
   across the header. First 40-120 s after the page opens, then every 4-8 minutes; never
   under reduced motion. seasonVisit() sends it at once (sc.next). */
const CAR_FIRST = [40, 120], CAR_GAP = [240, 480], CAR_SECS = [5.5, 7.5];
function timeCar(ctx, w, h, t, sc, night) {
  if (reduce()) return;
  if (sc.next == null) sc.next = t + rr(...CAR_FIRST);
  if (!sc.car && t > sc.next) {
    const band = headerBand(h);
    sc.car = { t0: t, secs: rr(...CAR_SECS), dir: Math.random() < 0.5 ? 1 : -1, y: band * rr(0.35, 0.65), arc: rr(18, 34), s: Math.max(70, Math.min(110, w * 0.09)) };
    sc.next = t + rr(...CAR_GAP);
  }
  const c = sc.car;
  if (!c) return;
  const u = (t - c.t0) / c.secs;
  if (u > 1) { sc.car = null; return; }
  const pad = c.s * 1.6, x = c.dir > 0 ? -pad + u * (w + 2 * pad) : w + pad - u * (w + 2 * pad);
  const y = c.y - Math.sin(u * Math.PI) * c.arc, slope = -Math.cos(u * Math.PI) * Math.PI * c.arc / (w + 2 * pad);
  const bank = Math.atan(slope) * c.dir;                               /* nose follows the arc */
  /* light streaks trailing behind, fading */
  const back = -c.dir, L = c.s;
  for (const [dy, col] of [[0.02, night ? "255,46,200" : "255,120,200"], [0.09, night ? "127,243,255" : "120,200,240"]]) {
    const g = ctx.createLinearGradient(x, 0, x + back * L * 3.2, 0);
    g.addColorStop(0, "rgba(" + col + ",.85)"); g.addColorStop(1, "rgba(" + col + ",0)");
    ctx.strokeStyle = g; ctx.lineWidth = L * 0.035; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(x + back * L * 0.45, y + dy * L); ctx.lineTo(x + back * L * 3.2, y + dy * L + Math.sin(u * 9) * 2); ctx.stroke();
  }
  ctx.save();
  ctx.translate(x, y); ctx.rotate(bank); ctx.scale(L * c.dir, L);
  /* proportions after a gull-wing steel coupe seen side on: long hood rising gently, steep
     screen, short flat roof, long fastback to a squared tail, black sill and belt strip */
  const WF = 0.296, WR = -0.292, AY = 0.010, AR = 0.082;                 /* wheel arches */
  const ug = ctx.createRadialGradient(0, 0.075, 0, 0, 0.075, 0.55);
  ug.addColorStop(0, night ? "rgba(255,46,200,.55)" : "rgba(255,140,210,.45)"); ug.addColorStop(1, "rgba(255,46,200,0)");
  ctx.fillStyle = ug; ctx.beginPath(); ctx.ellipse(0, 0.075, 0.62, 0.12, 0, 0, 6.2832); ctx.fill();
  for (const wx of [WF, WR]) {                                         /* wheels folded flat for flight */
    ctx.fillStyle = "#1c1b24"; ctx.beginPath(); ctx.ellipse(wx, 0.062, 0.074, 0.022, 0, 0, 6.2832); ctx.fill();
    ctx.fillStyle = night ? "rgba(127,243,255,.95)" : "rgba(120,200,240,.95)";
    ctx.beginPath(); ctx.ellipse(wx, 0.07, 0.06, 0.012, 0, 0, 6.2832); ctx.fill();
  }
  const body = () => {
    ctx.beginPath();
    ctx.moveTo(0.497, -0.017); ctx.lineTo(0.499, -0.054); ctx.lineTo(0.451, -0.089);   /* nose */
    ctx.lineTo(0.164, -0.140);                                                           /* hood */
    ctx.lineTo(0.027, -0.198);                                                           /* screen */
    ctx.lineTo(-0.165, -0.201);                                                          /* roof */
    ctx.lineTo(-0.450, -0.140);                                                          /* fastback */
    ctx.lineTo(-0.495, -0.073); ctx.lineTo(-0.498, -0.022); ctx.lineTo(-0.478, 0.011); ctx.lineTo(-0.383, 0.022);   /* tail */
    ctx.arc(WR, AY, AR, Math.PI, 2 * Math.PI);
    ctx.lineTo(WR + AR, 0.028); ctx.lineTo(WF - AR, 0.028);                             /* sill */
    ctx.arc(WF, AY, AR, Math.PI, 2 * Math.PI);
    ctx.lineTo(0.382, 0.017); ctx.lineTo(0.458, 0.017);                                 /* front valance */
    ctx.closePath();
  };
  const steel = ctx.createLinearGradient(0, -0.2, 0, 0.03);
  steel.addColorStop(0, "#f2f3f7"); steel.addColorStop(0.35, "#c6c9d2"); steel.addColorStop(0.62, "#d9dbe2"); steel.addColorStop(1, "#8b909d");
  body(); ctx.fillStyle = steel; ctx.fill();
  ctx.save(); body(); ctx.clip();
  const dark = "#1d1c25";
  ctx.fillStyle = dark;
  ctx.fillRect(WR, 0.004, WF - WR, 0.03);                                                 /* black sill */
  ctx.beginPath(); ctx.moveTo(0.5, -0.054); ctx.lineTo(0.455, -0.054); ctx.lineTo(0.452, -0.017); ctx.lineTo(0.5, -0.017); ctx.fill();   /* bumpers */
  ctx.beginPath(); ctx.moveTo(-0.5, -0.073); ctx.lineTo(-0.47, -0.071); ctx.lineTo(-0.472, -0.022); ctx.lineTo(-0.5, -0.022); ctx.fill();
  ctx.strokeStyle = dark; ctx.lineWidth = 0.008;
  ctx.beginPath(); ctx.moveTo(0.452, -0.055); ctx.lineTo(-0.47, -0.067); ctx.stroke();  /* belt strip */
  ctx.restore();
  for (const wx of [WF, WR]) { ctx.fillStyle = "#121118"; ctx.beginPath(); ctx.arc(wx, AY, AR - 0.006, Math.PI, 2 * Math.PI); ctx.fill(); }   /* empty wheel wells */
  /* glass, lit by the neon sky */
  const glass = ctx.createLinearGradient(0, -0.2, 0, -0.12);
  glass.addColorStop(0, night ? "#241640" : "#4a3d78"); glass.addColorStop(1, night ? "#ff5fc8" : "#ff9fd8");
  ctx.fillStyle = glass;
  ctx.beginPath(); ctx.moveTo(0.158, -0.141); ctx.lineTo(0.030, -0.194); ctx.lineTo(0.020, -0.189); ctx.lineTo(0.146, -0.136); ctx.closePath(); ctx.fill();   /* screen */
  ctx.beginPath(); ctx.moveTo(0.075, -0.123); ctx.lineTo(0.025, -0.190); ctx.lineTo(-0.141, -0.190); ctx.lineTo(-0.141, -0.123); ctx.closePath(); ctx.fill();   /* door window */
  ctx.beginPath(); ctx.moveTo(-0.199, -0.184); ctx.lineTo(-0.417, -0.151); ctx.lineTo(-0.411, -0.134); ctx.lineTo(-0.21, -0.128); ctx.closePath(); ctx.fill();   /* rear quarter */
  ctx.fillStyle = dark; ctx.fillRect(-0.198, -0.197, 0.022, 0.071);                        /* pillar */
  ctx.beginPath(); ctx.moveTo(0.108, -0.138); ctx.lineTo(0.088, -0.142); ctx.lineTo(0.082, -0.128); ctx.lineTo(0.104, -0.126); ctx.fill();   /* mirror */
  ctx.strokeStyle = "rgba(29,28,37,.7)"; ctx.lineWidth = 0.006;
  for (let i = 1; i <= 4; i++) { const x0 = -0.215 - i * 0.042; ctx.beginPath(); ctx.moveTo(x0, -0.183 + i * 0.006); ctx.lineTo(x0 - 0.03, -0.172 + i * 0.006); ctx.stroke(); }   /* louvres */
  ctx.beginPath(); ctx.moveTo(0.159, -0.117); ctx.lineTo(0.131, -0.006); ctx.moveTo(-0.154, -0.117); ctx.lineTo(-0.098, -0.006); ctx.stroke();   /* door seams */
  ctx.beginPath(); ctx.moveTo(0.164, -0.14); ctx.lineTo(0.451, -0.089); ctx.strokeStyle = "rgba(255,255,255,.55)"; ctx.lineWidth = 0.006; ctx.stroke();   /* hood highlight */
  ctx.fillStyle = "#ffb347"; ctx.fillRect(0.43, -0.05, 0.022, 0.012);                    /* side markers */
  ctx.fillStyle = "#ff3b5c"; ctx.fillRect(-0.468, -0.062, 0.024, 0.012);
  ctx.fillRect(-0.503, -0.07, 0.008, 0.045);                                              /* tail light */
  body(); ctx.strokeStyle = "#2a2833"; ctx.lineWidth = 0.008; ctx.lineJoin = "round"; ctx.stroke();
  ctx.restore();
}

const THEMES = {
  spring:    { scene: springScene,    draw: withVisitors(drawSpring, "spring") },
  summer:    { scene: summerScene,    draw: withVisitors(drawSummer, "summer") },
  autumn:    { scene: autumnScene,    draw: withVisitors(drawAutumn, "autumn") },
  winter:    { scene: winterScene,    draw: withVisitors(drawWinter, "winter") },
  halloween: { scene: halloweenScene, draw: drawHalloween, goal: halloweenGoal },
  christmas: { scene: christmasScene, draw: drawChristmas, goal: christmasGoal },
  newyear:   { scene: newYearScene,   draw: drawNewYear,   goal: newYearGoal },
  atlas:     { scene: atlasScene,     draw: drawAtlas },
  hairline:  { scene: hairlineScene,  draw: drawHairline },
  blueprint: { scene: blueprintScene, draw: drawBlueprint },
  synthwave: { scene: synthScene,     draw: drawSynth }
};
