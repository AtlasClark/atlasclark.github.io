/* Monster week (rev 1.42.0): how the four monsters look. Each takes the page background
   (drawn by themefx.js like the holiday themes, data-holiday "m-<key>"); monster.hp (0..1)
   changes it: a hurt monster sinks, dims and cracks, and a hit makes it flinch. The
   rules are monster.js. Localhost ?boss=<key>&hp=<0..100> previews any of them. */

const seeded = seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* Who they are and why they have to go (banner text). */
export const MONSTERS = {
  kraken: { name: "The Kraken", tag: "It's in the water cooler",
            flavor: "Facilities thinks it came up through the drain. Either way, nobody can get to the water cooler. Drink enough and it'll let go.",
            twist: "Heals overnight unless the team made its goal." },
  leviathan: { name: "The Leviathan", tag: "It's drinking the bay",
               flavor: "It's huge, it's old, and it's been drinking the bay since Sunday. It's headed this way. Drink faster than it does.",
               twist: "Tough hide. Days when everyone hits their goal hit twice as hard." },
  pirate: { name: "Captain Saltbeard", tag: "He wants your shells",
            flavor: "Captain Saltbeard parked his ship outside the break room. He's after your shells, and he'd rather you drank seawater. He can't stand the fresh stuff.",
            twist: "First pour of the day counts double." },
  ai: { name: "DRY_RUN", tag: "It filed a ticket",
        flavor: "Someone gave the office AI a body. It read that people are 60% water and opened a ticket to fix that. Let's close it.",
        twist: "It learns. Pour the same amount twice in a row and it only takes half." }
};

/* Health 0..1 the scenes draw from (set by ui.js). */
export const monster = { hp: 1, hitAt: -9 };
/* A drop in health makes the monster flinch (scenes shake for HIT_SECS). */
const HIT_SECS = 0.5;
export function setMonsterHp(v) {
  const hp = clamp(Number(v) || 0, 0, 1);
  if (monster.set && hp < monster.hp - 1e-4) monster.hitAt = performance.now() / 1000;   /* not on the first show */
  monster.hp = hp; monster.set = true;
}
const shaken = draw => (ctx, w, h, t, sc, night) => {
  const u = t - monster.hitAt;
  if (u >= 0 && u < HIT_SECS) {
    const k = (1 - u / HIT_SECS) * 9;
    ctx.save(); ctx.translate(Math.sin(u * 70) * k, Math.cos(u * 53) * k * 0.5);
    draw(ctx, w, h, t, sc, night); ctx.restore();
    ctx.fillStyle = "rgba(255,255,255," + (0.12 * (1 - u / HIT_SECS)).toFixed(3) + ")"; ctx.fillRect(0, 0, w, h);
  } else draw(ctx, w, h, t, sc, night);
};

/* ---- shared drawing ------------------------------------------------------------- */
/* A tapered limb along a curling centreline: base (x, y), angle a0, length L, curl
   (radians over its length, + = clockwise), widths w0 -> w1; sway moves it with time. */
function limb(x, y, a0, L, curl, sway, n = 34) {
  const pts = [];
  let a = a0;
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    pts.push([x, y, a, u]);
    a = a0 + curl * Math.pow(u, 1.3) + sway * u;
    x += Math.cos(a) * L / n; y += Math.sin(a) * L / n;
  }
  return pts;
}
function limbPath(ctx, pts, w0, w1) {
  const L = [], R = [];
  for (const [x, y, a, u] of pts) {
    const r = (w0 + (w1 - w0) * Math.pow(u, 0.8)) / 2, nx = -Math.sin(a), ny = Math.cos(a);
    L.push([x + nx * r, y + ny * r]); R.push([x - nx * r, y - ny * r]);
  }
  ctx.beginPath(); ctx.moveTo(L[0][0], L[0][1]);
  for (const p of L) ctx.lineTo(p[0], p[1]);
  const tip = pts[pts.length - 1];
  ctx.arc(tip[0], tip[1], Math.max(1, w1 / 2), tip[2] - Math.PI / 2, tip[2] + Math.PI / 2);
  for (let i = R.length - 1; i >= 0; i--) ctx.lineTo(R[i][0], R[i][1]);
  ctx.closePath();
  return { L, R };
}
/* Catmull-Rom through points, sampled. */
function spline(P, per = 16) {
  const out = [];
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
    for (let j = 0; j < per; j++) {
      const t = j / per, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map(k => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)));
    }
  }
  out.push(P[P.length - 1].slice());
  return out;
}
function glowDot(ctx, x, y, r, rgb, a) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, "rgba(" + rgb + "," + a + ")"); g.addColorStop(1, "rgba(" + rgb + ",0)");
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
}

/* ---- the Kraken: a crimson head peering over the glasses, its arms round the page --- */
function krakenScene() {
  const r = seeded(11);
  return {
    snow: Array.from({ length: 80 }, () => ({ x: r(), y: r(), s: 0.6 + r() * 1.8, v: 3 + r() * 9 })),
    spots: Array.from({ length: 26 }, () => ({ x: r() * 2 - 1, y: r(), s: 0.01 + r() * 0.03 })),
    /* per side, left as drawn (the right is its mirror): root offset in head widths, start
       angle, length in screen heights, curl over the length, sway phase */
    arms: [[0.36, 3.25, 0.95, 1.9, 0.0], [0.27, 2.8, 1.0, 2.3, 1.1], [0.16, 2.25, 0.8, 1.9, 2.3], [0.05, 1.75, 0.5, -0.8, 3.2]],
    blink: 0
  };
}
function drawKraken(ctx, w, h, t, sc) {
  const hp = monster.hp;
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#03111f"); bg.addColorStop(0.55, "#06263a"); bg.addColorStop(1, "#0a3346");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
  ctx.save(); ctx.globalCompositeOperation = "lighter";                  /* light from the surface */
  for (let i = 0; i < 6; i++) {
    const x0 = w * (0.05 + i * 0.19) + Math.sin(t * 0.17 + i * 1.7) * 40;
    const g = ctx.createLinearGradient(0, 0, 0, h * 0.85);
    g.addColorStop(0, "rgba(120,210,240,.09)"); g.addColorStop(1, "rgba(120,210,240,0)");
    ctx.fillStyle = g; ctx.beginPath();
    ctx.moveTo(x0, 0); ctx.lineTo(x0 + 70, 0); ctx.lineTo(x0 + 230, h * 0.85); ctx.lineTo(x0 + 90, h * 0.85); ctx.fill();
  }
  ctx.restore();

  const mw = clamp(w * 0.5, 380, 940), mh = mw, cx = w / 2;
  const top = h * (0.03 + (1 - hp) * 0.24) + Math.sin(t * 0.5) * 6, breathe = 1 + Math.sin(t * 0.7) * 0.012;
  const ARM = "#8f2d55", ARM_D = "#5e1838", SUCK = "#f3bfd0", root = top + mh * 0.8;
  /* eight arms from under the head: out to the sides, then curling up the page */
  const arm = (bx, by, a0, L, curl, ph, w0) => {
    const pts = limb(bx, by, a0, L, curl, Math.sin(t * 0.55 + ph) * 0.35);
    ctx.fillStyle = ARM; const side = limbPath(ctx, pts, w0, 4); ctx.fill();
    ctx.strokeStyle = ARM_D; ctx.lineWidth = 2; ctx.stroke();
    const inner = curl > 0 ? side.L : side.R;                             /* suckers inside the curl */
    for (let i = 4; i < inner.length - 3; i += 2) {
      const u = i / inner.length, r = (w0 * (1 - u) + 4 * u) * 0.17;
      ctx.fillStyle = SUCK; ctx.beginPath(); ctx.arc(inner[i][0], inner[i][1], r, 0, TAU); ctx.fill();
      ctx.fillStyle = "#c98aa0"; ctx.beginPath(); ctx.arc(inner[i][0], inner[i][1], r * 0.45, 0, TAU); ctx.fill();
    }
  };
  for (const [f, a0, L, curl, ph] of sc.arms) for (const sx of [-1, 1]) {
    arm(cx + sx * f * mw, root, sx < 0 ? a0 : Math.PI - a0, h * L, -sx * curl, ph + (sx > 0 ? 1.3 : 0), mw * 0.1);
  }

  /* the head: a bulb, breathing */
  ctx.save(); ctx.translate(cx, root); ctx.scale(breathe, breathe); ctx.translate(-cx, -root);
  ctx.beginPath();
  ctx.moveTo(cx, top);
  ctx.bezierCurveTo(cx + mw * 0.32, top, cx + mw * 0.52, top + mh * 0.3, cx + mw * 0.48, top + mh * 0.58);
  ctx.bezierCurveTo(cx + mw * 0.45, top + mh * 0.78, cx + mw * 0.3, top + mh * 0.9, cx, top + mh * 0.9);
  ctx.bezierCurveTo(cx - mw * 0.3, top + mh * 0.9, cx - mw * 0.45, top + mh * 0.78, cx - mw * 0.48, top + mh * 0.58);
  ctx.bezierCurveTo(cx - mw * 0.52, top + mh * 0.3, cx - mw * 0.32, top, cx, top);
  ctx.closePath();
  const mg = ctx.createRadialGradient(cx - mw * 0.14, top + mh * 0.25, mw * 0.05, cx, top + mh * 0.45, mw * 0.6);
  mg.addColorStop(0, "#c24d76"); mg.addColorStop(0.5, "#7c2249"); mg.addColorStop(1, "#3d0b26");
  ctx.fillStyle = mg; ctx.fill();
  ctx.strokeStyle = ARM_D; ctx.lineWidth = 2; ctx.stroke();
  ctx.save(); ctx.clip();
  for (const s of sc.spots) {                                              /* freckles */
    const x = cx + s.x * mw * 0.42, y = top + mh * (0.08 + s.y * 0.7);
    ctx.fillStyle = "rgba(255,170,200,.14)"; ctx.beginPath(); ctx.ellipse(x, y, mw * s.s, mw * s.s * 0.8, 0, 0, TAU); ctx.fill();
  }
  const scars = Math.floor((1 - hp) * 7);                                   /* wounds as its health falls */
  ctx.strokeStyle = "rgba(255,214,226,.55)"; ctx.lineWidth = 3; ctx.lineCap = "round";
  for (let i = 0; i < scars; i++) {
    const x = cx + (((i * 0.37) % 1) - 0.5) * mw * 0.6, y = top + mh * (0.15 + ((i * 0.53) % 1) * 0.3);
    ctx.beginPath(); ctx.moveTo(x - 26, y - 14); ctx.lineTo(x + 24, y + 12); ctx.stroke();
  }
  ctx.restore();
  /* eyes: gold, a slot pupil, a heavy brow; a blink now and then */
  const ey = top + mh * 0.62, look = Math.sin(t * 0.31) * mw * 0.016;
  if (t > sc.blink + 0.18 && Math.random() < 0.006) sc.blink = t;
  const lid = clamp(1 - Math.abs(t - sc.blink - 0.09) / 0.09, 0, 1);
  for (const sx of [-1, 1]) {
    const ex = cx + sx * mw * 0.22, rx = mw * 0.085, ry = mw * 0.062;
    ctx.fillStyle = "#2a0616"; ctx.beginPath(); ctx.ellipse(ex, ey, rx * 1.25, ry * 1.35, 0, 0, TAU); ctx.fill();
    ctx.save(); ctx.shadowColor = "rgba(255,190,60,.7)"; ctx.shadowBlur = 30 * hp + 6;
    const ig = ctx.createRadialGradient(ex - rx * 0.3, ey - ry * 0.3, 1, ex, ey, rx);
    ig.addColorStop(0, "#fff0a8"); ig.addColorStop(0.5, "#f6b62a"); ig.addColorStop(1, "#b5600c");
    ctx.fillStyle = ig; ctx.beginPath(); ctx.ellipse(ex, ey, rx, ry * (1 - lid), 0, 0, TAU); ctx.fill(); ctx.restore();
    if (lid < 0.8) {
      ctx.fillStyle = "#14030b"; ctx.beginPath(); ctx.ellipse(ex + look, ey, rx * 0.62, ry * 0.2 * (1 - lid), 0, 0, TAU); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,.75)"; ctx.beginPath(); ctx.arc(ex - rx * 0.35, ey - ry * 0.4, rx * 0.11, 0, TAU); ctx.fill();
    }
    ctx.strokeStyle = "#3d0b22"; ctx.lineWidth = mw * 0.03; ctx.lineCap = "round";        /* the brow */
    ctx.beginPath(); ctx.moveTo(ex + sx * rx * 1.35, ey - ry * 1.75); ctx.quadraticCurveTo(ex, ey - ry * 1.5, ex - sx * rx * 1.25, ey - ry * 0.95); ctx.stroke();   /* low at the middle: cross */
  }
  ctx.restore();

  /* marine snow */
  for (const s of sc.snow) {
    const y = ((s.y * h + t * s.v) % h), x = s.x * w + Math.sin(t * 0.4 + s.y * 9) * 8;
    ctx.fillStyle = "rgba(210,235,245,.35)"; ctx.beginPath(); ctx.arc(x, y, s.s, 0, TAU); ctx.fill();
  }
}

/* ---- the Leviathan: an abyssal serpent coiled under everything, one burning eye ----- */
function leviathanScene() {
  const r = seeded(29);
  return { motes: Array.from({ length: 90 }, () => ({ x: r(), y: r(), s: 0.5 + r() * 1.6, ph: r() * TAU })) };
}
function drawLeviathan(ctx, w, h, t, sc) {
  const hp = monster.hp, glow = 0.35 + hp * 0.65;
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#010409"); bg.addColorStop(0.6, "#03101b"); bg.addColorStop(1, "#061c28");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
  for (const m of sc.motes) {                                               /* glowing plankton */
    const a = 0.25 + 0.25 * Math.sin(t * 1.3 + m.ph);
    ctx.fillStyle = "rgba(90,230,255," + a.toFixed(3) + ")"; ctx.beginPath();
    ctx.arc(m.x * w + Math.sin(t * 0.2 + m.ph) * 10, (m.y * h - t * 4 + h) % h, m.s, 0, TAU); ctx.fill();
  }
  const S = Math.min(w, h * 1.4), sink = (1 - hp) * h * 0.12, sw = Math.sin(t * 0.35);
  /* the body: from the head, down the right side, then in humps across the bottom */
  const P = [[w * 0.8, h * 0.3 + sink], [w * 0.9, h * 0.48 + sink], [w * 0.86, h * 0.72], [w * 0.68, h * 0.84 + sw * 10],
             [w * 0.5, h * 0.6 + sw * 16], [w * 0.32, h * 0.8 - sw * 12], [w * 0.15, h * 0.58 + sw * 14], [-w * 0.04, h * 0.7]];
  const C = spline(P, 22), T0 = S * 0.16, T1 = S * 0.05;
  const L = [], R = [];
  C.forEach((p, i) => {
    const q = C[Math.min(C.length - 1, i + 1)], o = C[Math.max(0, i - 1)], a = Math.atan2(q[1] - o[1], q[0] - o[0]);
    const u = i / (C.length - 1), r = (T0 + (T1 - T0) * u) / 2;
    p.push(a, u, r);
    L.push([p[0] - Math.sin(a) * r, p[1] + Math.cos(a) * r]); R.push([p[0] + Math.sin(a) * r, p[1] - Math.cos(a) * r]);
  });
  /* dorsal spines on the upper edge */
  ctx.fillStyle = "#0e3640";
  for (let i = 4; i < C.length - 4; i += 5) {
    const [x, y, a, u, r] = C[i], nx = Math.sin(a), ny = -Math.cos(a), s = r * 0.9;
    ctx.beginPath(); ctx.moveTo(x + nx * r * 0.8 - Math.cos(a) * s * 0.5, y + ny * r * 0.8 - Math.sin(a) * s * 0.5);
    ctx.lineTo(x + nx * (r + s * 1.3) - Math.cos(a) * s * 0.8, y + ny * (r + s * 1.3) - Math.sin(a) * s * 0.8);
    ctx.lineTo(x + nx * r * 0.8 + Math.cos(a) * s * 0.5, y + ny * r * 0.8 + Math.sin(a) * s * 0.5); ctx.fill();
  }
  ctx.beginPath(); ctx.moveTo(L[0][0], L[0][1]);
  for (const p of L) ctx.lineTo(p[0], p[1]);
  for (let i = R.length - 1; i >= 0; i--) ctx.lineTo(R[i][0], R[i][1]);
  ctx.closePath();
  const bgr = ctx.createLinearGradient(0, h * 0.3, 0, h);
  bgr.addColorStop(0, "#123d48"); bgr.addColorStop(1, "#071a21");
  ctx.fillStyle = bgr; ctx.fill();
  ctx.save(); ctx.clip();
  ctx.strokeStyle = "rgba(110,220,235,.07)"; ctx.lineWidth = 1.5;           /* scales */
  for (let i = 0; i < C.length; i += 2) {
    const [x, y, a, u, r] = C[i];
    for (let k = -2; k <= 2; k++) {
      const ox = x + Math.sin(a) * k * r * 0.4, oy = y - Math.cos(a) * k * r * 0.4;
      ctx.beginPath(); ctx.arc(ox, oy, r * 0.22, a + 0.6, a + Math.PI - 0.6); ctx.stroke();
    }
  }
  ctx.restore();
  ctx.strokeStyle = "rgba(160,240,255,.18)"; ctx.lineWidth = 2;            /* rim light on the top edge */
  ctx.beginPath(); R.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.stroke();
  ctx.save(); ctx.globalCompositeOperation = "lighter";                     /* lights running down its flank */
  for (let i = 3; i < C.length - 2; i += 3) {
    const [x, y, a, u, r] = C[i], pulse = 0.5 + 0.5 * Math.sin(i * 0.35 - t * 2.2);
    glowDot(ctx, x + Math.sin(a) * r * 0.35, y - Math.cos(a) * r * 0.35, r * 0.28, "80,235,255", (0.15 + 0.6 * pulse) * glow);
  }
  ctx.restore();
  /* tail fin */
  const tp = C[C.length - 1];
  ctx.fillStyle = "#0b2a33";
  ctx.beginPath(); ctx.moveTo(tp[0] + 10, tp[1]); ctx.lineTo(tp[0] - S * 0.12, tp[1] - S * 0.1); ctx.lineTo(tp[0] - S * 0.06, tp[1]); ctx.lineTo(tp[0] - S * 0.12, tp[1] + S * 0.09); ctx.closePath(); ctx.fill();

  /* the head, facing left, at the top of the neck */
  const [hx, hy] = C[0], k = S * 0.0021, nod = Math.sin(t * 0.4) * 0.04;
  ctx.save(); ctx.translate(hx, hy); ctx.rotate(-0.12 + nod); ctx.scale(k, k);
  ctx.fillStyle = "#0c2e37";                                                /* frill fins behind the head */
  for (let i = 0; i < 4; i++) {
    ctx.save(); ctx.rotate(-0.9 + i * 0.32 + Math.sin(t * 0.8 + i) * 0.05);
    ctx.beginPath(); ctx.moveTo(10, -10); ctx.quadraticCurveTo(150, -40, 190, 10); ctx.quadraticCurveTo(120, 10, 30, 20); ctx.fill();
    ctx.restore();
    glowDot(ctx, Math.cos(-0.9 + i * 0.32) * 185, Math.sin(-0.9 + i * 0.32) * 185 + 10, 14, "80,235,255", 0.5 * glow);
  }
  const jaw = 0.12 + 0.06 * Math.sin(t * 0.9);                               /* jaw open a little, breathing */
  ctx.save(); ctx.rotate(jaw);
  ctx.fillStyle = "#0a252d";
  ctx.beginPath(); ctx.moveTo(30, 30); ctx.quadraticCurveTo(-120, 70, -230, 40); ctx.lineTo(-220, 22); ctx.quadraticCurveTo(-100, 30, 20, 0); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#e7f3f2";
  for (let i = 0; i < 7; i++) { const x = -200 + i * 30; ctx.beginPath(); ctx.moveTo(x, 28 - i * 0.6); ctx.lineTo(x + 9, 28 - i * 0.6); ctx.lineTo(x + 4, 8); ctx.fill(); }
  ctx.restore();
  ctx.fillStyle = "#3a0f1a"; ctx.beginPath(); ctx.moveTo(10, 8); ctx.lineTo(-215, 18); ctx.lineTo(-200, 34); ctx.closePath(); ctx.fill();   /* the throat */
  const sk = ctx.createLinearGradient(0, -90, 0, 30);
  sk.addColorStop(0, "#1c5462"); sk.addColorStop(1, "#0b2830");
  ctx.fillStyle = sk;                                                       /* skull and snout */
  ctx.beginPath(); ctx.moveTo(60, 20); ctx.quadraticCurveTo(70, -80, -20, -92); ctx.quadraticCurveTo(-110, -96, -170, -54);
  ctx.quadraticCurveTo(-230, -30, -250, 8); ctx.quadraticCurveTo(-120, 14, 0, 10); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#e7f3f2";
  for (let i = 0; i < 8; i++) { const x = -236 + i * 28; ctx.beginPath(); ctx.moveTo(x, 6); ctx.lineTo(x + 10, 6); ctx.lineTo(x + 5, 26 - (i % 2) * 6); ctx.fill(); }
  ctx.fillStyle = "#0e3640";                                                /* horns and brow ridge */
  ctx.beginPath(); ctx.moveTo(-40, -86); ctx.quadraticCurveTo(10, -170, 90, -190); ctx.quadraticCurveTo(30, -150, 0, -82); ctx.fill();
  ctx.beginPath(); ctx.moveTo(-150, -58); ctx.quadraticCurveTo(-100, -86, -50, -80); ctx.lineTo(-60, -66); ctx.quadraticCurveTo(-100, -70, -150, -50); ctx.fill();
  const ex = -92, ey = -55, open = 0.25 + 0.75 * hp;                        /* the eye narrows as it weakens */
  ctx.save(); ctx.globalCompositeOperation = "lighter";
  glowDot(ctx, ex, ey, 80, "60,230,255", 0.35 * glow);
  ctx.restore();
  ctx.fillStyle = "#bff8ff"; ctx.beginPath(); ctx.ellipse(ex, ey, 26, 16 * open, -0.15, 0, TAU); ctx.fill();
  ctx.fillStyle = "#38dcff"; ctx.beginPath(); ctx.ellipse(ex, ey, 18, 13 * open, -0.15, 0, TAU); ctx.fill();
  ctx.fillStyle = "#021015"; ctx.beginPath(); ctx.ellipse(ex - 2 + Math.sin(t * 0.3) * 3, ey, 3.5, 12 * open, -0.15, 0, TAU); ctx.fill();
  ctx.save(); ctx.globalCompositeOperation = "lighter";                     /* lights along the snout */
  for (let i = 0; i < 5; i++) glowDot(ctx, -200 + i * 34, -22 - i * 9, 8, "80,235,255", (0.3 + 0.4 * Math.sin(t * 2 + i)) * glow);
  ctx.restore();
  ctx.restore();
}

/* ---- Captain Saltbeard: a ghost galleon at anchor, its captain looming in the sky -- */
function pirateScene() {
  const r = seeded(43);
  return { stars: Array.from({ length: 110 }, () => ({ x: r(), y: r() * 0.6, s: 0.4 + r() * 1.2, ph: r() * TAU })),
           clouds: Array.from({ length: 7 }, () => ({ x: r(), y: 0.08 + r() * 0.35, s: 0.6 + r() * 0.8, v: 4 + r() * 6 })),
           shot: null, nextShot: 3 };
}
function cloud(ctx, x, y, s, col) {
  ctx.fillStyle = col; ctx.beginPath();
  for (const [dx, dy, r] of [[0, 0, 60], [60, 10, 46], [-58, 12, 42], [24, -26, 40], [-24, -18, 36], [100, 22, 30], [-96, 22, 28]]) {
    ctx.moveTo(x + dx * s + r * s, y + dy * s); ctx.arc(x + dx * s, y + dy * s, r * s, 0, TAU);
  }
  ctx.fill();
}
function drawPirate(ctx, w, h, t, sc) {
  const hp = monster.hp, hz = h * 0.74;
  const sky = ctx.createLinearGradient(0, 0, 0, hz);
  sky.addColorStop(0, "#060a1c"); sky.addColorStop(0.7, "#151a3a"); sky.addColorStop(1, "#2a2350");
  ctx.fillStyle = sky; ctx.fillRect(0, 0, w, hz);
  for (const s of sc.stars) {
    ctx.fillStyle = "rgba(230,235,255," + (0.35 + 0.35 * Math.sin(t * 1.6 + s.ph)).toFixed(3) + ")";
    ctx.fillRect(s.x * w, s.y * hz, s.s, s.s);
  }
  const mx = w * 0.07, my = h * 0.13;                                       /* the moon */
  glowDot(ctx, mx, my, 120, "200,230,255", 0.25);
  ctx.fillStyle = "#e9f1ff"; ctx.beginPath(); ctx.arc(mx, my, 34, 0, TAU); ctx.fill();
  ctx.fillStyle = "rgba(160,175,210,.35)";
  for (const [dx, dy, r] of [[-10, -8, 7], [12, 6, 5], [-4, 14, 4]]) { ctx.beginPath(); ctx.arc(mx + dx, my + dy, r, 0, TAU); ctx.fill(); }

  /* the captain, a ghost the size of the sky, fading as he weakens */
  const cx = w * 0.87, cy = h * 0.36, S = clamp(Math.min(w, h) * 0.00115, 0.5, 1.2), fade = 0.35 + 0.65 * hp;
  const bob = Math.sin(t * 0.6) * 8;
  ctx.save(); ctx.translate(cx, cy + bob); ctx.scale(S, S); ctx.globalAlpha = fade;
  const body = ctx.createLinearGradient(0, -40, 0, 330);
  body.addColorStop(0, "rgba(110,255,200,.26)"); body.addColorStop(1, "rgba(110,255,200,0)");
  ctx.fillStyle = body;                                                     /* coat and shoulders, into the mist */
  ctx.beginPath(); ctx.moveTo(-70, 40); ctx.quadraticCurveTo(-220, 70, -260, 200); ctx.lineTo(-200, 330); ctx.lineTo(200, 330); ctx.lineTo(260, 200);
  ctx.quadraticCurveTo(220, 70, 70, 40); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "rgba(240,200,90,.45)";                                    /* epaulettes */
  for (const sx of [-1, 1]) { ctx.beginPath(); ctx.ellipse(sx * 170, 92, 52, 18, sx * 0.35, 0, TAU); ctx.fill(); }
  ctx.strokeStyle = "rgba(240,200,90,.35)"; ctx.lineWidth = 3;
  for (const sx of [-1, 1]) for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.moveTo(sx * (130 + i * 16), 104); ctx.lineTo(sx * (126 + i * 17), 128 + (i % 2) * 6); ctx.stroke(); }
  const face = ctx.createRadialGradient(0, -10, 10, 0, 0, 110);
  face.addColorStop(0, "rgba(170,255,220,.42)"); face.addColorStop(1, "rgba(120,255,200,.08)");
  ctx.fillStyle = face; ctx.beginPath(); ctx.ellipse(0, 0, 82, 100, 0, 0, TAU); ctx.fill();
  ctx.lineCap = "round";                                                    /* the beard, drifting */
  for (let i = 0; i < 15; i++) {
    const x0 = -66 + i * 9.5, len = 120 + 70 * Math.sin(i * 1.7) ** 2;
    ctx.strokeStyle = "rgba(150,255,210," + (0.18 + 0.12 * (i % 3)).toFixed(2) + ")"; ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(x0, 36);
    ctx.bezierCurveTo(x0 + Math.sin(t * 1.1 + i) * 14, 36 + len * 0.4, x0 - 10 + Math.sin(t * 0.9 + i * 0.7) * 22, 36 + len * 0.75, x0 + Math.sin(t * 0.7 + i) * 26, 36 + len);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(6,12,24,.75)";                                       /* eye sockets, mouth */
  for (const sx of [-1, 1]) { ctx.beginPath(); ctx.ellipse(sx * 30, -12, 20, 15, sx * -0.2, 0, TAU); ctx.fill(); }
  ctx.beginPath(); ctx.moveTo(-34, 44); ctx.quadraticCurveTo(0, 62, 34, 44); ctx.quadraticCurveTo(0, 54, -34, 44); ctx.fill();
  ctx.save(); ctx.globalCompositeOperation = "lighter";
  for (const sx of [-1, 1]) { glowDot(ctx, sx * 30, -12, 30, "90,255,170", 0.9 * fade); }
  ctx.restore();
  ctx.fillStyle = "#d6ffe9"; for (const sx of [-1, 1]) { ctx.beginPath(); ctx.arc(sx * 30, -12, 4.5, 0, TAU); ctx.fill(); }
  ctx.globalAlpha = 0.6 + 0.4 * fade;                                        /* the hat stays dark and solid */
  ctx.fillStyle = "#101426";
  ctx.beginPath(); ctx.moveTo(-170, -64); ctx.quadraticCurveTo(-110, -78, -70, -150); ctx.quadraticCurveTo(0, -112, 70, -150);
  ctx.quadraticCurveTo(110, -78, 170, -64); ctx.quadraticCurveTo(0, -30, -170, -64); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = "#d8b24a"; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(-170, -64); ctx.quadraticCurveTo(0, -30, 170, -64); ctx.stroke();
  ctx.fillStyle = "#e9e6dc";                                                /* skull and bones on the hat */
  ctx.save(); ctx.translate(0, -84);
  ctx.strokeStyle = "#e9e6dc"; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(-24, -12); ctx.lineTo(24, 18); ctx.moveTo(24, -12); ctx.lineTo(-24, 18); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, -4, 15, 0, TAU); ctx.fill(); ctx.fillRect(-8, 6, 16, 9);
  ctx.fillStyle = "#101426"; ctx.beginPath(); ctx.arc(-6, -5, 4, 0, TAU); ctx.arc(6, -5, 4, 0, TAU); ctx.fill();
  ctx.restore();
  ctx.restore();

  for (const c of sc.clouds) {                                               /* clouds drift across him */
    const x = ((c.x * (w + 400) + t * c.v) % (w + 400)) - 200;
    cloud(ctx, x, c.y * h, c.s, "rgba(28,30,62,.55)");
  }

  /* the sea */
  const sea = ctx.createLinearGradient(0, hz, 0, h);
  sea.addColorStop(0, "#1a2448"); sea.addColorStop(1, "#070b1c");
  ctx.fillStyle = sea; ctx.fillRect(0, hz, w, h - hz);
  ctx.fillStyle = "rgba(220,235,255,.18)";                                   /* moon glint */
  for (let i = 0; i < 9; i++) ctx.fillRect(mx - 30 + Math.sin(t * 2 + i) * 14, hz + 6 + i * 11, 60 - i * 4, 2);

  /* the galleon, rocking, listing as it is hurt */
  const sx = w * 0.24, sy = hz + 4, SS = clamp(w * 0.0005, 0.4, 0.8), list = (1 - hp) * 0.12;
  ctx.save(); ctx.translate(sx, sy + Math.sin(t * 0.9) * 3); ctx.rotate(Math.sin(t * 0.7) * 0.025 + list); ctx.scale(SS, SS);
  ctx.strokeStyle = "#1b1410"; ctx.lineWidth = 7;
  for (const [x, top] of [[-150, -300], [0, -380], [140, -290]]) { ctx.beginPath(); ctx.moveTo(x, -20); ctx.lineTo(x, top); ctx.stroke(); }
  const torn = 1 - hp;
  for (const [x, top, sw, n] of [[-150, -280, 90, 2], [0, -360, 120, 3], [140, -270, 86, 2]]) {    /* ghost sails */
    for (let k = 0; k < n; k++) {
      const y0 = top + k * 95, y1 = y0 + 80, billow = 14 + Math.sin(t * 1.2 + x) * 6;
      ctx.fillStyle = "rgba(170,255,215," + (0.22 + 0.1 * k).toFixed(2) + ")";
      ctx.beginPath(); ctx.moveTo(x - sw / 2, y0); ctx.lineTo(x + sw / 2, y0);
      ctx.quadraticCurveTo(x + sw / 2 + billow, (y0 + y1) / 2, x + sw / 2, y1);
      for (let j = 0; j <= 5; j++) ctx.lineTo(x + sw / 2 - j * sw / 5, y1 - (j % 2) * (10 + torn * 26));   /* ragged hem */
      ctx.quadraticCurveTo(x - sw / 2 + billow, (y0 + y1) / 2, x - sw / 2, y0); ctx.fill();
    }
  }
  const fw = Math.sin(t * 3) * 6;                                           /* the flag */
  ctx.fillStyle = "#0b0b10"; ctx.beginPath(); ctx.moveTo(0, -380); ctx.lineTo(76, -372 + fw); ctx.lineTo(70, -330 + fw); ctx.lineTo(0, -336); ctx.fill();
  ctx.fillStyle = "#e9e6dc"; ctx.beginPath(); ctx.arc(36, -358 + fw / 2, 8, 0, TAU); ctx.fill();
  ctx.fillStyle = "#18100b";                                                 /* hull */
  ctx.beginPath(); ctx.moveTo(-250, -60); ctx.lineTo(220, -60); ctx.lineTo(260, -110); ctx.lineTo(300, -112); ctx.lineTo(250, 10);
  ctx.quadraticCurveTo(0, 40, -230, 10); ctx.lineTo(-270, -90); ctx.lineTo(-240, -92); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = "#5a3a1e"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-250, -30); ctx.lineTo(240, -30); ctx.stroke();
  for (let i = 0; i < 7; i++) { ctx.fillStyle = "#ffb04a"; ctx.fillRect(-190 + i * 58, -24, 16, 12); }   /* gun ports */
  ctx.save(); ctx.globalCompositeOperation = "lighter";
  for (const [x, y] of [[-262, -96], [292, -120]]) glowDot(ctx, x, y, 26, "255,180,80", 0.7);           /* lanterns */
  ctx.restore();
  ctx.restore();

  /* now and then a broadside: a flash, smoke, and a ball arcing away */
  if (t > sc.nextShot && !sc.shot) { sc.shot = { t0: t, port: Math.floor(Math.random() * 7) }; sc.nextShot = t + 4 + Math.random() * 4; }
  if (sc.shot) {
    const u = (t - sc.shot.t0) / 1.6, px = sx + (-190 + sc.shot.port * 58 + 8) * SS, py = sy - 18 * SS;
    if (u > 1) sc.shot = null;
    else {
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      glowDot(ctx, px, py, 50 * (1 - u), "255,200,120", 0.9 * (1 - u));
      ctx.restore();
      ctx.fillStyle = "rgba(200,205,220," + (0.4 * (1 - u)).toFixed(3) + ")";
      ctx.beginPath(); ctx.arc(px - 20 * u, py - 10 * u, 18 + 40 * u, 0, TAU); ctx.fill();
      ctx.fillStyle = "#0a0a0a"; ctx.beginPath(); ctx.arc(px - u * w * 0.35, py - Math.sin(u * Math.PI) * h * 0.18, 5, 0, TAU); ctx.fill();
    }
  }
  ctx.strokeStyle = "rgba(160,190,240,.22)"; ctx.lineWidth = 1.5;          /* waves */
  for (let row = 0; row < 6; row++) {
    const y = hz + 14 + row * row * 9 + 6, amp = 2 + row;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 12) ctx.lineTo(x, y + Math.sin(x * 0.03 + t * (0.8 + row * 0.2) + row) * amp);
    ctx.stroke();
  }
}

/* ---- DRY_RUN: a machine face over a field of circuits, scanning the team ------------- */
function aiScene() {
  const r = seeded(71), traces = [];
  for (let i = 0; i < 46; i++) {                                            /* circuit traces, in fractions of the screen */
    let x = r(), y = r();
    const pts = [[x, y]];
    for (let k = 0; k < 4; k++) {
      if (k % 2) y += (r() - 0.5) * 0.3; else x += (r() - 0.5) * 0.3;
      pts.push([x, y]);
    }
    traces.push({ pts, ph: r() * 10, v: 0.15 + r() * 0.25 });
  }
  return { traces, rain: Array.from({ length: 40 }, () => ({ x: r(), y: r(), v: 30 + r() * 80, n: 6 + Math.floor(r() * 14) })),
           next: 4, scan: null, glitch: 0 };
}
const HUD = ["DRY_RUN v9 // HYDRATION AUDIT", "SUBJECTS: 60% WATER", "TARGET: 0%", "STATUS: OPTIMIZING"];
function drawAI(ctx, w, h, t, sc) {
  const hp = monster.hp, RED = "255,52,64";
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#050509"); bg.addColorStop(1, "#110810");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
  ctx.lineWidth = 1.2; ctx.lineJoin = "round";
  for (const tr of sc.traces) {                                             /* circuits with pulses running along */
    ctx.strokeStyle = "rgba(" + RED + ",.11)"; ctx.beginPath();
    tr.pts.forEach(([x, y], i) => i ? ctx.lineTo(x * w, y * h) : ctx.moveTo(x * w, y * h)); ctx.stroke();
    const end = tr.pts[tr.pts.length - 1];
    ctx.fillStyle = "rgba(" + RED + ",.3)"; ctx.beginPath(); ctx.arc(end[0] * w, end[1] * h, 2.5, 0, TAU); ctx.fill();
    const u = ((t * tr.v + tr.ph) % 1.6) / 1.6 * (tr.pts.length - 1), i = Math.floor(u), f = u - i;
    if (i < tr.pts.length - 1) {
      const a = tr.pts[i], b = tr.pts[i + 1];
      glowDot(ctx, (a[0] + (b[0] - a[0]) * f) * w, (a[1] + (b[1] - a[1]) * f) * h, 6, RED, 0.8);
    }
  }
  ctx.font = "10px ui-monospace, Consolas, monospace";
  for (const d of sc.rain) {                                                /* data falling */
    const y0 = (d.y * h + t * d.v) % (h + 200) - 200;
    for (let k = 0; k < d.n; k++) {
      ctx.fillStyle = "rgba(" + RED + "," + (0.04 + 0.2 * (k / d.n)).toFixed(3) + ")";
      ctx.fillText(((k * 7 + Math.floor(t * 3)) % 2) ? "1" : "0", d.x * w, y0 + k * 12);
    }
  }
  /* the face */
  const S = clamp(Math.min(w * 0.42, h * 0.62), 260, 600), cx = w / 2, cy = h * (0.41 + (1 - hp) * 0.06) + 60 * S / 400;   /* the eye in the gap above the tabs */
  const gx = sc.glitch > t ? (Math.random() - 0.5) * 18 : 0;
  ctx.save(); ctx.translate(cx + gx, cy); ctx.scale(S / 400, S / 400);
  ctx.strokeStyle = "#1a1b22"; ctx.lineWidth = 14; ctx.lineCap = "round";   /* cables down to the floor */
  for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) {
    ctx.beginPath(); ctx.moveTo(sx * (120 + i * 18), 150);
    ctx.bezierCurveTo(sx * (200 + i * 40), 330, sx * (330 + i * 70), 320 + Math.sin(t + i) * 10, sx * (420 + i * 110), 700); ctx.stroke();
    ctx.strokeStyle = "rgba(" + RED + ",.25)"; ctx.lineWidth = 2; ctx.stroke(); ctx.strokeStyle = "#1a1b22"; ctx.lineWidth = 14;
  }
  const plate = ctx.createLinearGradient(0, -210, 0, 210);
  plate.addColorStop(0, "#343846"); plate.addColorStop(0.5, "#1c1e27"); plate.addColorStop(1, "#0c0d12");
  ctx.fillStyle = plate;                                                    /* the mask: brow, cheeks, narrow jaw */
  ctx.beginPath(); ctx.moveTo(-170, -150); ctx.lineTo(-60, -205); ctx.lineTo(60, -205); ctx.lineTo(170, -150); ctx.lineTo(190, -20);
  ctx.lineTo(130, 120); ctx.lineTo(50, 190); ctx.lineTo(-50, 190); ctx.lineTo(-130, 120); ctx.lineTo(-190, -20); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = "#5c6274"; ctx.lineWidth = 2.5; ctx.stroke();
  ctx.strokeStyle = "rgba(120,128,150,.35)"; ctx.lineWidth = 1.5;            /* panel seams */
  for (const [a, b, c, d] of [[-170, -150, -120, -40], [170, -150, 120, -40], [-120, -40, -60, 60], [120, -40, 60, 60], [-60, 60, 60, 60], [0, -205, 0, -120]]) {
    ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.stroke();
  }
  for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) {                    /* cheek vents */
    const on = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * 3 + i + sx));
    ctx.fillStyle = "rgba(" + RED + "," + (on * 0.7 * (0.4 + 0.6 * hp)).toFixed(3) + ")";
    ctx.fillRect(sx * 150 - (sx > 0 ? 34 : 0), -10 + i * 14, 34, 5);
  }
  ctx.fillStyle = "#0a0a0f";                                                /* mouth grille, lit when it "talks" */
  ctx.fillRect(-58, 110, 116, 46);
  const talk = Math.max(0, Math.sin(t * 1.3)) * Math.abs(Math.sin(t * 11));
  for (let i = 0; i < 7; i++) {
    ctx.fillStyle = "rgba(" + RED + "," + (0.15 + 0.7 * talk * (1 - Math.abs(i - 3) / 4)).toFixed(3) + ")";
    ctx.fillRect(-52 + i * 16, 116, 10, 34);
  }
  /* the eye: a lens of rings, turning, looking about */
  const lx = Math.sin(t * 0.37) * 16, ly = Math.sin(t * 0.23) * 6;
  ctx.fillStyle = "#07070a"; ctx.beginPath(); ctx.arc(0, -60, 92, 0, TAU); ctx.fill();
  ctx.strokeStyle = "#60667a"; ctx.lineWidth = 4; ctx.stroke();
  ctx.save(); ctx.translate(lx, -60 + ly);
  ctx.save(); ctx.globalCompositeOperation = "lighter";
  glowDot(ctx, 0, 0, 140, RED, 0.35 * (0.3 + 0.7 * hp));
  ctx.restore();
  for (const [r, n, v, wd] of [[72, 24, 0.4, 5], [56, 12, -0.7, 4], [40, 6, 1.1, 3]]) {
    ctx.strokeStyle = "rgba(" + RED + ",.75)"; ctx.lineWidth = wd;
    for (let i = 0; i < n; i++) { const a = i / n * TAU + t * v; ctx.beginPath(); ctx.arc(0, 0, r, a, a + TAU / n * 0.6); ctx.stroke(); }
  }
  const flick = hp < 0.4 && Math.sin(t * 23) > 0.6 ? 0.35 : 1;               /* a hurt eye flickers */
  const core = ctx.createRadialGradient(0, 0, 2, 0, 0, 26);
  core.addColorStop(0, "rgba(255,240,240," + flick + ")"); core.addColorStop(0.4, "rgba(255,70,80," + flick + ")"); core.addColorStop(1, "rgba(120,0,10,0)");
  ctx.fillStyle = core; ctx.beginPath(); ctx.arc(0, 0, 26, 0, TAU); ctx.fill();
  ctx.restore();
  const cracks = Math.floor((1 - hp) * 5);                                  /* damage */
  ctx.strokeStyle = "rgba(255,120,120,.55)"; ctx.lineWidth = 2;
  for (let i = 0; i < cracks; i++) {
    const x0 = [-140, 120, -40, 80, -100][i], y0 = [-120, -100, 40, 130, 80][i];
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + 22, y0 + 18); ctx.lineTo(x0 + 14, y0 + 40); ctx.lineTo(x0 + 34, y0 + 58); ctx.stroke();
  }
  ctx.restore();
  /* two hands gripping the bottom corners */
  for (const sxn of [-1, 1]) {
    const bx = sxn < 0 ? w * 0.06 : w * 0.94, by = h + 20;
    ctx.save(); ctx.translate(bx, by); ctx.scale(sxn * S / 400, S / 400);
    ctx.fillStyle = "#1c1e27"; ctx.strokeStyle = "#5c6274"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-70, 0); ctx.lineTo(-60, -120); ctx.lineTo(60, -130); ctx.lineTo(80, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
    for (let f = 0; f < 3; f++) {                                           /* fingers, curling in and out */
      const fx = -40 + f * 45, bend = 0.5 + 0.15 * Math.sin(t * 0.8 + f);
      ctx.save(); ctx.translate(fx, -125);
      for (let seg = 0; seg < 3; seg++) {
        ctx.rotate(seg ? bend : -0.2);
        ctx.fillStyle = "#23252f"; ctx.beginPath(); ctx.roundRect(-11, -58, 22, 58, 8); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "rgba(" + RED + ",.6)"; ctx.beginPath(); ctx.arc(0, 0, 4, 0, TAU); ctx.fill();
        ctx.translate(0, -56);
      }
      ctx.restore();
    }
    ctx.restore();
  }
  /* a scan sweeps the page now and then */
  if (t > sc.next && !sc.scan) { sc.scan = t; sc.next = t + 7 + Math.random() * 5; }
  if (sc.scan) {
    const u = (t - sc.scan) / 2.4;
    if (u > 1) { sc.scan = null; sc.glitch = hp < 0.6 ? t + 0.25 : 0; }
    else {
      const y = u * h, ex = cx, ey = cy - 60 * S / 400;
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      const g = ctx.createLinearGradient(0, y - 40, 0, y + 4);
      g.addColorStop(0, "rgba(" + RED + ",0)"); g.addColorStop(1, "rgba(" + RED + ",.22)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(0, y - 40); ctx.lineTo(0, y + 2); ctx.lineTo(w, y + 2); ctx.lineTo(w, y - 40); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "rgba(" + RED + ",.7)"; ctx.fillRect(0, y, w, 2);
      ctx.restore();
    }
  }
  ctx.fillStyle = "rgba(" + RED + ",.55)"; ctx.font = "11px ui-monospace, Consolas, monospace";   /* readouts */
  HUD.forEach((s, i) => { if (Math.sin(t * 2 + i * 1.3) > -0.85) ctx.fillText(s, 18, h - 70 + i * 15); });
  ctx.textAlign = "right";
  ctx.fillText("INTEGRITY " + Math.round(hp * 100) + "%", w - 18, h - 70);
  ctx.fillText(sc.scan ? "SCANNING…" : "IDLE", w - 18, h - 55);
  ctx.textAlign = "left";
}

/* Scenes as themefx.js wants them (data-holiday "m-<key>"). */
export const MONSTER_THEMES = {
  "m-kraken":    { scene: krakenScene,    draw: shaken(drawKraken) },
  "m-leviathan": { scene: leviathanScene, draw: shaken(drawLeviathan) },
  "m-pirate":    { scene: pirateScene,    draw: shaken(drawPirate) },
  "m-ai":        { scene: aiScene,        draw: shaken(drawAI) }
};

/* Dev only: ?boss=<key>&hp=<0..100> on localhost. */
export function devBoss() {
  if (typeof location === "undefined" || !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return null;
  const q = new URLSearchParams(location.search), key = q.get("boss");
  if (!MONSTERS[key]) return null;
  const hp = q.has("hp") ? clamp(Number(q.get("hp")) / 100, 0, 1) : 0.62;
  return { key, hp };
}
