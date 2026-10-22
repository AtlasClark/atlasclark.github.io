/* Built-in drawings of the Style shop's cup decorations and effect particles, in the
   Pet Studio's shape format (see petdefs.js), so each can be redrawn there.
   Cup items ("decor:<key>"): units of the glass's inside width (the glass is about
   CUP_H wide-units tall), origin at the item's anchor (CUP_PLACE): the middle of the
   glass bottom, the middle of the rim, or a point on the water surface. Fixed colours.
   Effect particles ("effect:<key>"): units of the pet's size, origin at the particle's
   centre. Their pet-colour parts take the colour the effect gives each particle. */

export const CUP_H = 1.93;                       /* inside height / inside width of a glass */

/* Where each cup item sits. at: "bottom" | "rim" | "surface" (x: share of the width
   from the left wall, dy: lift in widths); bob, wobble, spin: how it moves (px, rad). */
export const CUP_PLACE = {
  straw:     { at: "bottom" },
  spoon:     { at: "bottom" },
  lemon:     { at: "rim" },
  umbrella:  { at: "rim" },
  ice:       { at: "surface", x: 0.31, bob: 1.4, wobble: 0.12 },
  buoy:      { at: "surface", x: 0.78, bob: 1.4 },
  beachball: { at: "surface", x: 0.24, dy: -0.053, bob: 1.4, spin: 0.5 }
};

const FIX = c => ({ c });
const HUE = (dh, s, l, a = 1) => ({ hue: 1, dh, s, l, a });
const r4 = v => Math.round(v * 1e4) / 1e4;
const path = (pts, close = true) => [["M", r4(pts[0][0]), r4(pts[0][1])], ...pts.slice(1).map(p => p.length === 4 ? ["Q", r4(p[0]), r4(p[1]), r4(p[2]), r4(p[3])] : ["L", r4(p[0]), r4(p[1])]), ...(close ? [["Z"]] : [])];
const P = (pts, fill, stroke, w) => Object.assign({ t: "path", d: path(pts) }, fill ? { fill } : {}, stroke ? { stroke, w, cap: "round" } : {});
const S = (pts, stroke, w) => ({ t: "path", d: path(pts, false), stroke, w, cap: "round" });
const E = (x, y, rx, ry, fill, o = {}) => Object.assign({ t: "ell", x: r4(x), y: r4(y), rx: r4(rx), ry: r4(ry), rot: o.rot || 0, a0: r4(o.a0 ?? 0), a1: r4(o.a1 ?? 6.2832) },
  fill ? { fill } : {}, o.stroke ? { stroke: o.stroke, w: o.w } : {});

/* A pie slice from a0 to a1 (an arc made of quadratic pieces). */
function sector(cx, cy, r, a0, a1, fill) {
  const n = Math.max(1, Math.ceil((a1 - a0) / 0.5)), da = (a1 - a0) / n, pts = [[cx, cy], [cx + r * Math.cos(a0), cy + r * Math.sin(a0)]];
  for (let i = 0; i < n; i++) {
    const m = a0 + da * (i + 0.5), e = a0 + da * (i + 1), k = r / Math.cos(da / 2);
    pts.push([cx + k * Math.cos(m), cy + k * Math.sin(m), cx + r * Math.cos(e), cy + r * Math.sin(e)]);
  }
  return P(pts, fill);
}
/* A rounded square of side s, turned by ang. */
function roundSq(cx, cy, s, ang, rad, fill, stroke, w) {
  const h = s / 2, c = rad, rot = (x, y) => [cx + x * Math.cos(ang) - y * Math.sin(ang), cy + x * Math.sin(ang) + y * Math.cos(ang)];
  const pts = [rot(-h + c, -h), rot(h - c, -h), [...rot(h, -h), ...rot(h, -h + c)], rot(h, h - c), [...rot(h, h), ...rot(h - c, h)],
               rot(-h + c, h), [...rot(-h, h), ...rot(-h, h - c)], rot(-h, -h + c), [...rot(-h, -h), ...rot(-h + c, -h)]];
  return P(pts, fill, stroke, w);
}
/* Red stripes along a polyline, every step, each len long. */
function stripes(pts, step, len, col, w) {
  const out = [];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], L = Math.hypot(x1 - x0, y1 - y0);
    for (let d = carry; d < L; d += step) {
      const e = Math.min(L, d + len), f = t => [x0 + (x1 - x0) * t / L, y0 + (y1 - y0) * t / L];
      out.push({ t: "path", d: path([f(d), f(e)], false), stroke: col, w });    /* square ends, so stripes stay apart */
    }
    carry = (carry - L) % step; if (carry < 0) carry += step;
  }
  return out;
}

const STRAW = [[0.16, -0.032], [0.4, -2.03], [0.52, -2.24]];
const CANOPY = ["#ff6fa3", "#ffd23f", "#3fc1ff", "#7ee081"];
const BALL = ["#e8505b", "#f4f7f9", "#3f8fd9", "#f4f7f9", "#f7d038", "#f4f7f9"];

export const CUP_ART = {
  "decor:straw": { pal: { white: FIX("#ffffff"), red: FIX("#e8505b") }, shapes: [
    S(STRAW, "white", 0.056), ...stripes(STRAW, 0.097, 0.048, "red", 0.056) ] },

  "decor:spoon": { pal: { steel: FIX("#c6ced6"), shine: FIX("rgba(255,255,255,0.7)"), bowl: FIX("#b7c0c9") }, shapes: [
    S([[-0.2, -0.081], [-0.46, -2.2]], "steel", 0.032),
    S([[-0.208, -0.129], [-0.452, -2.168]], "shine", 0.0097),
    E(-0.176, -0.065, 0.073, 0.048, "bowl", { rot: -0.9 }) ] },

  "decor:ice": { pal: { ice: FIX("rgba(225,245,255,0.78)"), edge: FIX("rgba(255,255,255,0.95)"), glint: FIX("rgba(255,255,255,0.9)") }, shapes: [
    roundSq(-0.09, 0.016, 0.121, 0.0, 0.027, "ice", "edge", 0.01), roundSq(-0.115, -0.01, 0.026, 0.0, 0.004, "glint"),
    roundSq(0.09, 0.016, 0.097, 0.6, 0.021, "ice", "edge", 0.01), roundSq(0.075, -0.004, 0.021, 0.6, 0.003, "glint") ] },

  "decor:lemon": { pal: { rind: FIX("#f2d33f"), pith: FIX("#fff6c2"), pulp: FIX("#f7e36a") }, shapes: [
    E(0.427, 0.024, 0.121, 0.121, "rind"), E(0.427, 0.024, 0.104, 0.104, "pith"),
    ...[0, 1, 2, 3, 4, 5, 6, 7].map(i => sector(0.427, 0.024, 0.092, i * Math.PI / 4 + 0.06, (i + 1) * Math.PI / 4 - 0.06, "pulp")) ] },

  "decor:umbrella": { pal: { stick: FIX("#c79a5b"), pink: FIX(CANOPY[0]), yellow: FIX(CANOPY[1]), blue: FIX(CANOPY[2]), green: FIX(CANOPY[3]), edge: FIX("rgba(0,0,0,0.12)") }, shapes: [
    S([[-0.2, 0.81], [-0.28, -0.132]], "stick", 0.018),
    ...["pink", "yellow", "blue", "green"].map((c, i) => sector(-0.28, -0.116, 0.177, Math.PI + i * Math.PI / 4 - 0.3, Math.PI + (i + 1) * Math.PI / 4 - 0.3, c)),
    E(-0.28, -0.116, 0.177, 0.177, null, { a0: Math.PI - 0.3, a1: 2 * Math.PI - 0.3, stroke: "edge", w: 0.008 }) ] },

  "decor:buoy": { pal: { red: FIX("#e8505b"), white: FIX("#f4f7f9") }, shapes:
    [0, 1, 2, 3, 4, 5, 6, 7].map(i => E(0, 0, 0.137, 0.056, null, { a0: i * Math.PI / 4, a1: (i + 1) * Math.PI / 4 + 0.02, stroke: i % 2 ? "white" : "red", w: 0.048 })) },

  "decor:beachball": { pal: { red: FIX(BALL[0]), white: FIX(BALL[1]), blue: FIX(BALL[2]), yellow: FIX(BALL[4]), edge: FIX("rgba(0,0,0,0.15)") }, shapes: [
    ...["red", "white", "blue", "white", "yellow", "white"].map((c, i) => sector(0, 0, 0.097, i * Math.PI / 3, (i + 1) * Math.PI / 3, c)),
    E(0, 0, 0.019, 0.019, "white"), E(0, 0, 0.097, 0.097, null, { stroke: "edge", w: 0.008 }) ] }
};

/* Effect particles: one shape each, drawn many times by the effect's own motion. */
function starPts(ro, ri) {
  const pts = [];
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? ri : ro; pts.push([r * Math.cos(a), r * Math.sin(a)]); }
  return pts;
}
const hs = 0.16, ns = 0.17;
export const FX_ART = {
  "effect:sparkles": { pal: { star: FIX("#fff0aa") }, shapes: [P(starPts(0.15, 0.035), "star")] },
  "effect:hearts": { pal: { heart: HUE(0, 85, 62) }, shapes: [{ t: "path", fill: "heart", d: [
    ["M", 0, r4(0.35 * hs)], ["C", r4(-1.1 * hs), r4(-0.35 * hs), r4(-0.45 * hs), r4(-1.05 * hs), 0, r4(-0.45 * hs)],
    ["C", r4(0.45 * hs), r4(-1.05 * hs), r4(1.1 * hs), r4(-0.35 * hs), 0, r4(0.35 * hs)], ["Z"]] }] },
  "effect:notes": { pal: { note: HUE(0, 70, 62) }, shapes: [
    E(0, 0, 0.42 * ns, 0.3 * ns, "note", { rot: -0.4 }),
    S([[0.36 * ns, -0.1 * ns], [0.36 * ns, -1.3 * ns], [0.9 * ns, -1.05 * ns, 0.8 * ns, -0.6 * ns]], "note", 0.18 * ns) ] }
};
