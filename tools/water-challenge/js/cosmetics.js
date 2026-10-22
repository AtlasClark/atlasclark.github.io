/* Cosmetics: looks bought with shells (the daily check-in currency, shop.js), never
   goal tokens. Nothing here changes the game, only how a glass looks. Three slots,
   one item worn in each: a finish on the worn pet, an effect around it (centred on
   the pet's effect spot, set in the Pet Studio), and a decoration in the cup. Owning
   an item is a "cosmetic" spend (shop.js); what is worn is p.look. Drawing only. */

/* ---- the catalogue ---------------------------------------------------------- */
export const SLOTS = [
  { key: "finish", name: "Finishes", note: "A new coat for whichever pet you wear." },
  { key: "effect", name: "Effects",  note: "Something going on around your pet." },
  { key: "decor",  name: "Cup",      note: "Something in or on your glass." }
];
const ITEMS = [
  ["finish", "pastel",  "Pastel",       15, "Soft and chalky."],
  ["finish", "shadow",  "Shadow",       15, "Dark and moody."],
  ["finish", "frost",   "Frost",        20, "Icy blue, whatever it was."],
  ["finish", "ghost",   "Ghost",        30, "Pale and see-through."],
  ["finish", "neon",    "Neon",         35, "Full colour, with a glow."],
  ["finish", "gold",    "Gold",         45, "Solid gold. Probably."],
  ["finish", "rainbow", "Rainbow",      60, "Every colour, all the time."],
  ["effect", "fireflies", "Fireflies",  20, "A few lights drifting about."],
  ["effect", "hearts",    "Hearts",     25, "Somebody is loved."],
  ["effect", "notes",     "Music",      25, "Hums while it swims."],
  ["effect", "sparkles",  "Sparkles",   35, "Twinkling all round."],
  ["effect", "aura",      "Aura",       40, "A soft glow in its own colour."],
  ["decor", "straw",     "Straw",          10, "Striped and bendy."],
  ["decor", "spoon",     "Spoon",          10, "For stirring, or just because."],
  ["decor", "ice",       "Ice cubes",      12, "Two cubes, floating."],
  ["decor", "lemon",     "Lemon slice",    12, "On the rim."],
  ["decor", "umbrella",  "Cocktail umbrella", 18, "Holiday mode."],
  ["decor", "buoy",      "Life ring",      20, "Safety first."],
  ["decor", "beachball", "Beach ball",     20, "Bobs about on top."]
];
export const COSMETICS = Object.fromEntries(ITEMS.map(([slot, key, name, price, blurb]) =>
  [slot + ":" + key, { id: slot + ":" + key, slot, key, name, price, blurb }]));
export const itemsIn = slot => Object.values(COSMETICS).filter(i => i.slot === slot);
export const PAINT_COST = 1;

/* The shell icon: a scallop, d across, centred on x, y. */
export function drawShell(ctx, x, y, d) {
  const r = d * 0.46, cy = y + d * 0.18;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x - r * 0.28, cy + r * 0.5);
  for (let i = 0; i <= 6; i++) {
    const a0 = Math.PI + i * Math.PI / 6, a1 = a0 + Math.PI / 6;
    if (i < 6) ctx.quadraticCurveTo(x + Math.cos((a0 + a1) / 2) * r * 1.14, cy + Math.sin((a0 + a1) / 2) * r * 1.14, x + Math.cos(a1) * r, cy + Math.sin(a1) * r);
  }
  ctx.lineTo(x + r * 0.28, cy + r * 0.5);
  ctx.closePath();
  ctx.fillStyle = "#f6a98a"; ctx.fill();
  ctx.strokeStyle = "#d4704f"; ctx.lineWidth = Math.max(1, d * 0.06); ctx.stroke();
  ctx.lineWidth = Math.max(0.8, d * 0.045);
  for (let i = 1; i < 6; i++) {
    const a = Math.PI + i * Math.PI / 6;
    ctx.beginPath(); ctx.moveTo(x, cy + r * 0.42); ctx.lineTo(x + Math.cos(a) * r * 0.92, cy + Math.sin(a) * r * 0.92); ctx.stroke();
  }
  ctx.fillStyle = "#e88a6a";
  ctx.beginPath(); ctx.roundRect(x - r * 0.34, cy + r * 0.38, r * 0.68, r * 0.24, r * 0.08); ctx.fill();
  ctx.restore();
}

/* ---- finishes: a recolour of the pet's own-colour parts ----------------------- */
/* c: { h, s, l, a, dh } of a hue-following colour; fixed colours (eyes, beaks) stay. */
const FINISH = {
  pastel:  c => ({ h: c.h, s: c.s * 0.55, l: Math.min(90, c.l + 14), a: c.a }),
  shadow:  c => ({ h: c.h, s: c.s * 0.45, l: Math.max(10, c.l - 24), a: c.a }),
  frost:   c => ({ h: 196 + c.dh * 0.1, s: 52, l: Math.min(92, c.l + 14), a: c.a }),
  ghost:   c => ({ h: c.h, s: c.s * 0.25, l: Math.min(94, c.l + 22), a: c.a }),
  neon:    c => ({ h: c.h, s: 100, l: Math.max(50, Math.min(62, c.l)), a: c.a }),
  gold:    c => ({ h: 44 + c.dh * 0.06, s: 86, l: Math.max(38, Math.min(70, c.l)), a: c.a }),
  rainbow: c => ({ h: (c.h + (now() * 70) % 360 + 360) % 360, s: Math.max(70, c.s), l: c.l, a: c.a })
};
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;
export const finishFn = key => FINISH[key] || null;
/* Extra drawing state for a finish, around the whole pet. */
export function finishWrap(key, ctx, r, hue) {
  if (key === "ghost") ctx.globalAlpha *= 0.62;
  if (key === "neon") { ctx.shadowColor = "hsl(" + hue + ",100%,60%)"; ctx.shadowBlur = Math.max(4, r * 0.45); }
  if (key === "gold") { ctx.shadowColor = "rgba(255,214,90,0.55)"; ctx.shadowBlur = Math.max(3, r * 0.25); }
}

/* ---- effects: around the pet, in pet-layer pixels ------------------------------ */
/* x, cy: the effect's centre (the pet's effect spot); r: the pet's size. "back" is
   drawn before the pet, "front" after it. */
function star(ctx, x, y, ro, ri, fill) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? ri : ro;
    ctx.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a));
  }
  ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
}
function heart(ctx, x, y, s, fill) {
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.35);
  ctx.bezierCurveTo(x - s * 1.1, y - s * 0.35, x - s * 0.45, y - s * 1.05, x, y - s * 0.45);
  ctx.bezierCurveTo(x + s * 0.45, y - s * 1.05, x + s * 1.1, y - s * 0.35, x, y + s * 0.35);
  ctx.fillStyle = fill; ctx.fill();
}
function note(ctx, x, y, s, fill) {
  ctx.fillStyle = fill; ctx.strokeStyle = fill; ctx.lineWidth = Math.max(1, s * 0.18);
  ctx.beginPath(); ctx.ellipse(x, y, s * 0.42, s * 0.3, -0.4, 0, 6.2832); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x + s * 0.36, y - s * 0.1); ctx.lineTo(x + s * 0.36, y - s * 1.3);
  ctx.quadraticCurveTo(x + s * 0.9, y - s * 1.05, x + s * 0.8, y - s * 0.6); ctx.stroke();
}
export function drawEffect(ctx, key, x, cy, r, t, hue, layer) {
  ctx.save();
  if (key === "aura" && layer === "back") {
    const pulse = 1 + 0.08 * Math.sin(t * 2.2);
    const g = ctx.createRadialGradient(x, cy, r * 0.2, x, cy, r * 1.15 * pulse);
    g.addColorStop(0, "hsla(" + hue + ",90%,68%,0.45)");
    g.addColorStop(1, "hsla(" + hue + ",90%,68%,0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, cy, r * 1.15 * pulse, 0, 6.2832); ctx.fill();
  } else if (layer === "front") {
    if (key === "sparkles") {
      for (let i = 0; i < 5; i++) {
        const a = t * 0.9 + i * 1.2566, tw = 0.5 + 0.5 * Math.sin(t * 4 + i * 1.7);
        const sx = x + Math.cos(a) * r * 0.95, sy = cy + Math.sin(a) * r * 0.6;
        ctx.shadowColor = "rgba(255,230,120,0.9)"; ctx.shadowBlur = r * 0.2;
        star(ctx, sx, sy, Math.max(2.5, r * (0.1 + 0.1 * tw)), Math.max(1, r * 0.035), "rgba(255,240,170," + (0.55 + 0.45 * tw).toFixed(2) + ")");
      }
    } else if (key === "hearts" || key === "notes") {
      for (let i = 0; i < 3; i++) {
        const u = (t * 0.32 + i / 3) % 1, a = Math.sin(u * Math.PI);
        ctx.globalAlpha = a * 0.9;
        const hx = x + r * (0.35 + 0.25 * Math.sin(t * 1.3 + i * 2)) * (i % 2 ? -1 : 1), hy = cy - r * 0.35 - u * r * 1.1;
        if (key === "hearts") heart(ctx, hx, hy, r * 0.16, "hsl(" + (345 + i * 8) + ",85%,62%)");
        else note(ctx, hx, hy, r * 0.17, "hsl(" + ((hue + 180 + i * 40) % 360) + ",70%,62%)");
      }
    } else if (key === "fireflies") {
      for (let i = 0; i < 4; i++) {
        const fx = x + Math.sin(t * 0.7 + i * 1.9) * r * 1.0, fy = cy + Math.cos(t * 0.9 + i * 2.3) * r * 0.55;
        const glow = 0.45 + 0.55 * Math.max(0, Math.sin(t * 2.5 + i * 2.1));
        const g = ctx.createRadialGradient(fx, fy, 0, fx, fy, r * 0.16);
        g.addColorStop(0, "rgba(255,245,150," + glow.toFixed(2) + ")");
        g.addColorStop(1, "rgba(255,245,150,0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(fx, fy, r * 0.16, 0, 6.2832); ctx.fill();
      }
    }
  }
  ctx.restore();
}

/* ---- cup decorations: in pet-layer pixels ---------------------------------------- */
/* box: { x, y, W, H } is the inside of the glass (y = rim); surf(x) gives the water's
   surface at a pixel x (or the floor when empty). Drawn before the pet; the page's
   underwater tint then colours whatever is below the surface. */
function bob(t, k) { return Math.sin(t * 1.6 + k) * 1.4; }
export function drawDecor(ctx, key, box, surf, t) {
  const { x, y, W, H } = box, u = W / 124;                                   /* sizes follow the glass */
  ctx.save();
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  if (key === "straw") {
    const bx = x + W * 0.66, by = y + H - 4, kx = x + W * 0.9, ky = y - H * 0.05, tx = x + W * 1.02, ty = y - H * 0.16;
    for (const [col, dash] of [["#ffffff", []], ["#e8505b", [6 * u, 6 * u]]]) {
      ctx.strokeStyle = col; ctx.lineWidth = 7 * u; ctx.setLineDash(dash);
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(kx, ky); ctx.lineTo(tx, ty); ctx.stroke();
    }
    ctx.setLineDash([]);
  } else if (key === "spoon") {
    const bx = x + W * 0.3, by = y + H - 10 * u, tx = x + W * 0.04, ty = y - H * 0.14;
    ctx.strokeStyle = "#c6ced6"; ctx.lineWidth = 4 * u;
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(tx, ty); ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 1.2 * u;
    ctx.beginPath(); ctx.moveTo(bx - 1, by - 6 * u); ctx.lineTo(tx + 1, ty + 4 * u); ctx.stroke();
    ctx.fillStyle = "#b7c0c9";
    ctx.beginPath(); ctx.ellipse(bx + 3 * u, by + 2 * u, 9 * u, 6 * u, -0.9, 0, 6.2832); ctx.fill();
  } else if (key === "ice") {
    for (const [fx, sz, k] of [[0.22, 15, 0], [0.4, 12, 2]]) {
      const cx = x + W * fx, cy = surf(cx) + 2 * u + bob(t, k), s = sz * u;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(0.25 * Math.sin(t * 0.8 + k) + k * 0.3);
      ctx.fillStyle = "rgba(225,245,255,0.78)"; ctx.strokeStyle = "rgba(255,255,255,0.95)"; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.roundRect(-s / 2, -s / 2, s, s, s * 0.22); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.9)"; ctx.fillRect(-s * 0.3, -s * 0.3, s * 0.22, s * 0.12);
      ctx.restore();
    }
  } else if (key === "lemon") {
    const cx = x + W - 9 * u, cy = y + 3 * u, rr = 15 * u;
    ctx.fillStyle = "#f2d33f"; ctx.beginPath(); ctx.arc(cx, cy, rr, 0, 6.2832); ctx.fill();
    ctx.fillStyle = "#fff6c2"; ctx.beginPath(); ctx.arc(cx, cy, rr * 0.86, 0, 6.2832); ctx.fill();
    ctx.fillStyle = "#f7e36a";
    for (let i = 0; i < 8; i++) {
      const a0 = i * Math.PI / 4 + 0.06, a1 = a0 + Math.PI / 4 - 0.12;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, rr * 0.76, a0, a1); ctx.closePath(); ctx.fill();
    }
  } else if (key === "umbrella") {
    const sx = x + W * 0.3, sy = y + H * 0.42, tx = x + W * 0.22, ty = y - H * 0.06, cr = 22 * u, ang = -0.3;
    ctx.strokeStyle = "#c79a5b"; ctx.lineWidth = 2.2 * u;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(tx, ty - 2 * u); ctx.stroke();
    ctx.save(); ctx.translate(tx, ty); ctx.rotate(ang);
    const cols = ["#ff6fa3", "#ffd23f", "#3fc1ff", "#7ee081"];
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = cols[i];
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, cr, Math.PI + i * Math.PI / 4, Math.PI + (i + 1) * Math.PI / 4); ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = "rgba(0,0,0,0.12)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(0, 0, cr, Math.PI, 2 * Math.PI); ctx.stroke();
    ctx.restore();
  } else if (key === "buoy") {
    const cx = x + W * 0.78, cy = surf(cx) + bob(t, 1), rx = 17 * u, ry = 7 * u;
    ctx.lineWidth = 6 * u;
    for (let i = 0; i < 8; i++) {
      ctx.strokeStyle = i % 2 ? "#f4f7f9" : "#e8505b";
      ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, i * Math.PI / 4, (i + 1) * Math.PI / 4 + 0.02); ctx.stroke();
    }
  } else if (key === "beachball") {
    const rr = 12 * u, cx = x + W * 0.24, cy = surf(cx) - rr * 0.55 + bob(t, 2), spin = t * 0.5;
    const cols = ["#e8505b", "#f4f7f9", "#3f8fd9", "#f4f7f9", "#f7d038", "#f4f7f9"];
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = cols[i];
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, rr, spin + i * Math.PI / 3, spin + (i + 1) * Math.PI / 3); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = "#f4f7f9"; ctx.beginPath(); ctx.arc(cx, cy, rr * 0.2, 0, 6.2832); ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.15)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, rr, 0, 6.2832); ctx.stroke();
  }
  ctx.restore();
}
