/* Cosmetics: looks bought with shells (the daily check-in currency, shop.js), never
   goal tokens. Nothing here changes the game, only how a glass looks. Three slots,
   one item worn in each: a finish on the worn pet, an effect around it (centred on
   the pet's effect spot, set in the Pet Studio), and a decoration in the cup. Owning
   an item is a "cosmetic" spend (shop.js); what is worn is p.look. Drawing only. */

import { hats, drawShapes } from "./petdefs.js";
import { CUP_PLACE } from "./styleart.js";

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
   drawn before the pet, "front" after it. Sparkles, hearts and notes draw their
   particle from the studio drawing (styleart.js "effect:<key>"); aura and fireflies
   are glows, drawn here. */
function particle(ctx, key, x, y, r, scale, hue) {
  const h = hats["effect:" + key];
  if (!h) return;
  ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
  drawShapes(ctx, h.shapes, r, hue, h.pal, false);
  ctx.restore();
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
      ctx.shadowColor = "rgba(255,230,120,0.9)"; ctx.shadowBlur = r * 0.2;
      for (let i = 0; i < 5; i++) {
        const a = t * 0.9 + i * 1.2566, tw = 0.5 + 0.5 * Math.sin(t * 4 + i * 1.7);
        ctx.globalAlpha = 0.55 + 0.45 * tw;
        particle(ctx, key, x + Math.cos(a) * r * 0.95, cy + Math.sin(a) * r * 0.6, r, Math.max(2.5 / (r * 0.15), (0.1 + 0.1 * tw) / 0.15), hue);
      }
    } else if (key === "hearts" || key === "notes") {
      for (let i = 0; i < 3; i++) {
        const u = (t * 0.32 + i / 3) % 1, a = Math.sin(u * Math.PI);
        ctx.globalAlpha = a * 0.9;
        const hx = x + r * (0.35 + 0.25 * Math.sin(t * 1.3 + i * 2)) * (i % 2 ? -1 : 1), hy = cy - r * 0.35 - u * r * 1.1;
        particle(ctx, key, hx, hy, r, 1, key === "hearts" ? 345 + i * 8 : (hue + 180 + i * 40) % 360);
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
   surface at a pixel x (or the floor when empty). The drawing (styleart.js
   "decor:<key>", in units of the glass's width) goes on its anchor (CUP_PLACE). Drawn
   before the pet; the page's underwater tint then colours whatever is below the surface. */
export function cupOrigin(key, box, surf, t) {
  const pl = CUP_PLACE[key] || { at: "bottom" }, { x, y, W, H } = box;
  if (pl.at === "rim") return { x: x + W / 2, y, a: 0 };
  if (pl.at === "surface") {
    const px = x + W * pl.x, k = pl.x * 7;
    return { x: px, y: surf(px) + (pl.dy || 0) * W + Math.sin(t * 1.6 + k) * (pl.bob || 0),
             a: (pl.wobble ? pl.wobble * Math.sin(t * 0.8 + k) : 0) + (pl.spin ? t * pl.spin : 0) };
  }
  return { x: x + W / 2, y: y + H, a: 0 };
}
export function drawDecor(ctx, key, box, surf, t) {
  const h = hats["decor:" + key];
  if (!h) return;
  const o = cupOrigin(key, box, surf, t);
  ctx.save();
  ctx.translate(o.x, o.y);
  if (o.a) ctx.rotate(o.a);
  drawShapes(ctx, h.shapes, box.W, 0, h.pal, false);
  ctx.restore();
}
