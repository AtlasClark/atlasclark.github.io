/* Built-in drawings of the Style shop's cup decorations and effect particles, in the
   Pet Studio's shape format (see petdefs.js), so each can be redrawn there.
   Cup items ("decor:<key>"): units of the glass's inside width (the glass is about
   CUP_H wide-units tall), origin at the item's anchor (CUP_PLACE): the middle of the
   glass bottom, the middle of the rim, or a point on the water surface. Fixed colours.
   Effect particles ("effect:<key>"): units of the pet's size, origin at the particle's
   centre. Their pet-colour parts take the colour the effect gives each particle.
   A cup item with behind: true sits behind the glass outline (in the glass); without it
   the outline is behind the item. Set per item in the Pet Studio. */

export const CUP_H = 1.93;                       /* inside height / inside width of a glass */

/* Where each cup item sits. at: "bottom" | "rim" | "surface" (x: share of the width
   from the left wall, dy: lift in widths); bob, wobble, spin: how it moves (px, rad);
   hz: wobble speed (default 0.8 rad/s); pivot: [x, y] in widths from the origin that a
   wobble turns about (default the origin); dry: never tinted by the water (outside the glass). */
export const CUP_PLACE = {
  straw:     { at: "bottom" },
  spoon:     { at: "bottom" },
  lemon:     { at: "rim" },
  umbrella:  { at: "rim" },
  ice:       { at: "surface", x: 0.31, bob: 1.4, wobble: 0.12 },
  buoy:      { at: "surface", x: 0.78, bob: 1.4 },
  beachball: { at: "surface", x: 0.24, dy: -0.053, bob: 1.4, spin: 0.5 },
  seaweed:   { at: "bottom", wobble: 0.05, hz: 0.9, pivot: [-0.2, 0] },
  castle:    { at: "bottom" },
  mint:      { at: "surface", x: 0.66, bob: 1.4, wobble: 0.1 },
  orange:    { at: "rim" },
  flag:      { at: "rim", wobble: 0.035, hz: 2.2, pivot: [0.268, 0] },
  lights:    { at: "rim", dry: true }
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

/* A seaweed frond from (x0, 0) up h, w wide at the foot, waving amp side to side. */
function frond(x0, h, w, amp, k, ph, fill) {
  const left = [], right = [];
  for (let i = 0; i <= 10; i++) {
    const v = i / 10, cx = x0 + amp * Math.sin(v * k + ph) * v, half = w * (1 - v * 0.85) / 2;
    left.push([cx - half, -h * v]); right.push([cx + half, -h * v]);
  }
  return P([...left, ...right.reverse()], fill);
}
/* A wall with merlons along its top: x0 to x1, top to bot, n merlons d deep. */
function battlement(x0, x1, top, bot, n, d) {
  const pts = [[x0, bot], [x0, top]], seg = (x1 - x0) / (2 * n - 1);
  for (let i = 0; i < 2 * n - 1; i++) {
    const xb = x0 + (i + 1) * seg;
    if (i % 2 === 0) { pts.push([xb, top]); if (i < 2 * n - 2) pts.push([xb, top + d]); }
    else { pts.push([xb, top + d], [xb, top]); }
  }
  pts.push([x1, bot]);
  return pts;
}
/* Points along a quadratic swag from a to b over control c, at t = 1/n .. (n-1)/n. */
const swag = (a, c, b, n) => [...Array(n - 1).keys()].map(i => {
  const t = (i + 1) / n, u = 1 - t;
  return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]];
});
const BULB = ["red", "gold", "green", "blue", "pink"];
const LIGHTS = [[[-0.56, 0.1], [0, 0.66], [0.56, 0.25]], [[-0.56, 0.76], [0, 1.2], [0.56, 0.62]]];

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
    E(0, 0, 0.019, 0.019, "white"), E(0, 0, 0.097, 0.097, null, { stroke: "edge", w: 0.008 }) ] },

  "decor:seaweed": { behind: true, pal: { dark: FIX("#26804a"), mid: FIX("#2f9e5b"), light: FIX("#46bd72") }, shapes: [
    frond(-0.31, 0.74, 0.075, 0.06, 6, 0, "dark"), frond(-0.2, 1.02, 0.085, 0.07, 5, 1.5, "mid"),
    frond(-0.1, 0.6, 0.065, 0.05, 7, 3, "light"), frond(-0.24, 0.42, 0.06, 0.04, 8, 2, "light") ] },

  "decor:castle": { behind: true, pal: { sand: FIX("#e6c98f"), sand2: FIX("#d6b578"), shade: FIX("rgba(150,110,50,0.22)"),
      door: FIX("#7a5a33"), pole: FIX("#6b5232"), red: FIX("#e8505b") }, shapes: [
    S([[0, -0.43], [0, -0.56]], "pole", 0.009), P([[0, -0.56], [0.075, -0.535], [0, -0.51]], "red"),
    P(battlement(-0.075, 0.075, -0.44, 0, 3, 0.035), "sand2"),
    P(battlement(-0.2, 0.2, -0.2, 0, 5, 0.03), "sand"),
    P(battlement(-0.27, -0.13, -0.34, 0, 3, 0.035), "sand"), P(battlement(0.13, 0.27, -0.34, 0, 3, 0.035), "sand"),
    P([[-0.16, 0], [-0.16, -0.305], [-0.13, -0.305], [-0.13, 0]], "shade"), P([[0.24, 0], [0.24, -0.305], [0.27, -0.305], [0.27, 0]], "shade"),
    P([[-0.045, 0], [-0.045, -0.07], [-0.045, -0.115, 0, -0.115], [0.045, -0.115, 0.045, -0.07], [0.045, 0]], "door"),
    E(-0.2, -0.24, 0.018, 0.026, "door"), E(0.2, -0.24, 0.018, 0.026, "door"),
    E(-0.1, -0.08, 0.012, 0.008, "shade"), E(0.11, -0.12, 0.01, 0.007, "shade"), E(0.06, -0.04, 0.012, 0.008, "shade") ] },

  "decor:mint": { pal: { leaf: FIX("#4cc26a"), leaf2: FIX("#38a75a"), vein: FIX("rgba(255,255,255,0.45)"), stem: FIX("#3c8f50") }, shapes: [
    S([[0, 0.03], [0.005, -0.03]], "stem", 0.014),
    E(-0.05, -0.035, 0.075, 0.033, "leaf2", { rot: -0.45 }), S([[-0.11, -0.005], [0.005, -0.06]], "vein", 0.006),
    E(0.055, -0.045, 0.078, 0.035, "leaf", { rot: 0.4 }), S([[0.115, -0.015], [0, -0.07]], "vein", 0.006),
    E(0.0, -0.095, 0.06, 0.028, "leaf", { rot: -1.45 }), S([[-0.01, -0.15], [0.006, -0.045]], "vein", 0.006) ] },

  "decor:orange": { pal: { rind: FIX("#f28c28"), pith: FIX("#ffe9c7"), pulp: FIX("#f9a23b") }, shapes: [
    sector(-0.4, 0, 0.15, Math.PI, 2 * Math.PI, "rind"), sector(-0.4, 0, 0.13, Math.PI, 2 * Math.PI, "pith"),
    ...[0, 1, 2, 3].map(i => sector(-0.4, 0, 0.118, Math.PI + i * Math.PI / 4 + 0.05, Math.PI + (i + 1) * Math.PI / 4 - 0.05, "pulp")) ] },

  "decor:flag": { pal: { wood: FIX("#8a6a45"), gold: FIX("#f2c14e"), black: FIX("#22262b"), white: FIX("#f4f7f9") }, shapes: [
    S([[0.3, 0.6], [0.25, -0.33]], "wood", 0.018), E(0.25, -0.34, 0.015, 0.015, "gold"),
    P([[0.252, -0.32], [0.33, -0.36, 0.41, -0.31], [0.47, -0.27, 0.52, -0.31], [0.51, -0.15], [0.44, -0.18, 0.37, -0.15], [0.3, -0.12, 0.249, -0.17]], "black"),
    S([[0.345, -0.195], [0.43, -0.172]], "white", 0.012), S([[0.345, -0.172], [0.43, -0.195]], "white", 0.012),
    E(0.387, -0.25, 0.032, 0.029, "white"), E(0.387, -0.223, 0.02, 0.014, "white"),
    E(0.376, -0.253, 0.007, 0.008, "black"), E(0.398, -0.253, 0.007, 0.008, "black") ] },

  "decor:lights": { pal: { wire: FIX("#2f4a3a"), cap: FIX("#56645c"),
      red: FIX("#ff5a5a"), gold: FIX("#ffd04a"), green: FIX("#4fe08a"), blue: FIX("#58b4ff"), pink: FIX("#ff7ad0"),
      gred: FIX("rgba(255,90,90,0.32)"), ggold: FIX("rgba(255,208,74,0.32)"), ggreen: FIX("rgba(79,224,138,0.32)"),
      gblue: FIX("rgba(88,180,255,0.32)"), gpink: FIX("rgba(255,122,208,0.32)") }, shapes: [
    ...LIGHTS.map(([a, c, b]) => S([a, [c[0], c[1], b[0], b[1]]], "wire", 0.01)),
    ...LIGHTS.flatMap(([a, c, b], j) => swag(a, c, b, 8).flatMap(([x, y], i) => {
      const col = BULB[(i + j * 2) % BULB.length];
      return [E(x, y + 0.03, 0.05, 0.05, "g" + col), E(x, y + 0.03, 0.019, 0.027, col), E(x, y + 0.004, 0.011, 0.007, "cap")];
    })) ] }
};

/* Effect particles: one shape each, drawn many times by the effect's own motion. */
function starPts(ro, ri) {
  const pts = [];
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? ri : ro; pts.push([r * Math.cos(a), r * Math.sin(a)]); }
  return pts;
}
const hs = 0.16, ns = 0.17;
export const FX_ART = {
  "effect:stars": { pal: { gold: FIX("#ffd55a"), edge: FIX("#e0a52a") }, shapes: [P(starPts(0.13, 0.055), "gold", "edge", 0.015)] },
  "effect:rain": { pal: { cloud: FIX("#eef3f7"), shade: FIX("#c9d6e0") }, shapes: [
    E(0, 0.075, 0.27, 0.05, "shade"), E(-0.17, 0.03, 0.15, 0.1, "cloud"), E(0.18, 0.03, 0.14, 0.1, "cloud"),
    E(0, -0.04, 0.19, 0.15, "cloud"), E(0, 0.06, 0.28, 0.06, "cloud") ] },
  "effect:sparkles": { pal: { star: FIX("#fff0aa") }, shapes: [P(starPts(0.15, 0.035), "star")] },
  "effect:hearts": { pal: { heart: HUE(0, 85, 62) }, shapes: [{ t: "path", fill: "heart", d: [
    ["M", 0, r4(0.35 * hs)], ["C", r4(-1.1 * hs), r4(-0.35 * hs), r4(-0.45 * hs), r4(-1.05 * hs), 0, r4(-0.45 * hs)],
    ["C", r4(0.45 * hs), r4(-1.05 * hs), r4(1.1 * hs), r4(-0.35 * hs), 0, r4(0.35 * hs)], ["Z"]] }] },
  "effect:notes": { pal: { note: HUE(0, 70, 62) }, shapes: [
    E(0, 0, 0.42 * ns, 0.3 * ns, "note", { rot: -0.4 }),
    S([[0.36 * ns, -0.1 * ns], [0.36 * ns, -1.3 * ns], [0.9 * ns, -1.05 * ns, 0.8 * ns, -0.6 * ns]], "note", 0.18 * ns) ] }
};
