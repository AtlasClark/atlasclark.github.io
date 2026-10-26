/* The third pen's built-in drawings (kinds 52-76): creatures of legend, in the Pet
   Studio's shape format (see petdefs.js), so every one can be redrawn there. Units of
   r, origin at the waterline, facing left. Index i here is kind PEN3_FIRST + i, with the
   same rarity as first-pen kind i. Colours: body / light / dark follow each catch's hue.
   zone: "air" ones are drawn above their waterline and hover at that height; "middle"
   ones are drawn below it; "bottom" ones stand on the glass floor (FLOOR). */

import { narrowCup } from "./config.js";

const FLOOR = Math.floor(narrowCup().floor * 1e4) / 1e4;   /* the floor line of a full glass, in r */

const HUE = (dh, s, l, a = 1) => ({ hue: 1, dh, s, l, a });
const FIX = c => ({ c });
const base = extra => Object.assign({ body: HUE(0, 62, 58), light: HUE(0, 62, 70), dark: HUE(0, 55, 42),
                                      ink: FIX("#2a2118"), white: FIX("#f4f7f9") }, extra || {});

/* "M x y L x y Q cx cy x y C x1 y1 x2 y2 x y Z" to the [cmd, ...nums] form; dy shifts every y. */
function d(str, dy = 0) {
  const t = str.trim().split(/[\s,]+/), out = [], need = { M: 2, L: 2, Q: 4, C: 6, Z: 0 };
  for (let i = 0; i < t.length;) {
    const c = t[i++], n = need[c];
    out.push([c, ...t.slice(i, i + n).map((v, j) => Math.round((Number(v) + (j % 2 ? dy : 0)) * 1e4) / 1e4)]);
    i += n;
  }
  return out;
}
const E = (x, y, rx, ry, fill, o = {}) => Object.assign({ t: "ell", x, y, rx, ry, rot: o.rot || 0, a0: o.a0 ?? 0, a1: o.a1 ?? 6.2832 },
  fill ? { fill } : {}, o.chord ? { chord: true } : {}, o.stroke ? { stroke: o.stroke, w: o.w || 0.03 } : {}, o.show ? { show: o.show } : {});
const P = (path, fill, dy) => ({ t: "path", d: d(path, dy), fill });
const S = (path, stroke, w, dy) => ({ t: "path", d: d(path, dy), stroke, w, cap: "round" });
/* A filled shape with a thin outline (white creatures on a pale glass). */
const PO = (path, fill, stroke, w = 0.022) => ({ t: "path", d: d(path), fill, stroke, w, cap: "round" });
const EYE = (x, y, s) => s ? { t: "eye", x, y, s } : { t: "eye", x, y };

function star(cx, cy, ro, ri, n = 5) {
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const a = -Math.PI / 2 + i * Math.PI / n, r = i % 2 ? ri : ro;
    pts.push((i ? "L " : "M ") + (cx + r * Math.cos(a)).toFixed(4) + " " + (cy + r * Math.sin(a)).toFixed(4));
  }
  return pts.join(" ") + " Z";
}
/* A row of teeth (triangles) from x0 to x1 along y, pointing down (dir 1) or up (-1). */
function teeth(x0, x1, y, n, h, dir, fill) {
  const w = (x1 - x0) / n, out = [];
  for (let i = 0; i < n; i++) {
    const a = x0 + i * w;
    out.push(P("M " + a.toFixed(4) + " " + y + " L " + (a + w).toFixed(4) + " " + y + " L " + (a + w / 2).toFixed(4) + " " + (y + dir * h).toFixed(4) + " Z", fill));
  }
  return out;
}
/* Feathers: n rounded tips along a line, for wings. */
function feathers(x0, y0, x1, y1, n, len, fill) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n, x = x0 + (x1 - x0) * u, y = y0 + (y1 - y0) * u;
    out.push(E(x, y + len * 0.5, len * 0.32, len * 0.6, fill, { rot: 0.15 }));
  }
  return out;
}

export const PEN3_ART = [
  /* 0 Kappa (Common): a river imp with a beak, a turtle shell and the dish of water on its head */
  { crown: [-0.38, -0.7], pal: base({ dish: FIX("#a9dcf2"), rim: FIX("#efe6cf"), beak: FIX("#e3a33a") }), swim: [
    E(0.08, -0.08, 0.46, 0.2, "body"),
    E(0.22, -0.2, 0.36, 0.3, "dark", { a0: 3.1416, a1: 6.2832, chord: true }),
    S("M -0.02 -0.3 Q 0.22 -0.38 0.46 -0.3", "light", 0.03), S("M 0.08 -0.42 Q 0.22 -0.46 0.36 -0.42", "light", 0.03),
    S("M 0.22 -0.5 L 0.22 -0.2", "light", 0.025),
    E(-0.1, -0.02, 0.12, 0.05, "light", { rot: 0.3 }),
    E(-0.38, -0.36, 0.22, 0.21, "body"),
    P("M -0.56 -0.4 L -0.74 -0.33 L -0.56 -0.27 Z", "beak"),
    P("M -0.6 -0.44 L -0.54 -0.6 L -0.46 -0.52 L -0.38 -0.62 L -0.3 -0.52 L -0.2 -0.6 L -0.16 -0.42 Q -0.38 -0.5 -0.6 -0.44 Z", "dark"),
    E(-0.38, -0.6, 0.15, 0.045, "rim"), E(-0.38, -0.615, 0.11, 0.028, "dish"),
    EYE(-0.47, -0.38) ] },

  /* 1 Selkie (Common): a seal whose long hair gives her away */
  { crown: [-0.4, -0.66], pal: base({ hair: HUE(30, 55, 36) }), swim: [
    P("M 0.55 -0.12 L 0.88 -0.3 L 0.8 -0.1 L 0.9 0.06 Z", "dark"),
    E(0.1, -0.15, 0.5, 0.22, "body", { rot: -0.05 }), E(0.02, -0.07, 0.36, 0.08, "light"),
    E(-0.08, -0.04, 0.15, 0.05, "dark", { rot: 0.5 }),
    P("M -0.3 -0.52 Q -0.04 -0.6 0.18 -0.42 Q 0.34 -0.3 0.5 -0.33 Q 0.36 -0.16 0.14 -0.27 Q -0.04 -0.38 -0.18 -0.34 Z", "hair"),
    E(-0.38, -0.36, 0.22, 0.2, "body"),
    P("M -0.42 -0.56 Q -0.26 -0.62 -0.16 -0.5 Q -0.26 -0.52 -0.34 -0.48 Z", "hair"),
    E(-0.5, -0.29, 0.1, 0.07, "light"),
    E(-0.58, -0.32, 0.06, 0.045, "ink"),
    S("M -0.6 -0.27 L -0.74 -0.3", "dark", 0.015), S("M -0.6 -0.25 L -0.74 -0.21", "dark", 0.015),
    EYE(-0.45, -0.4) ] },

  /* 2 Nixie (Common): a water sprite, one big drop with a fish's tail */
  { crown: [-0.08, -0.9], pal: base({ shine: FIX("rgba(255,255,255,0.55)") }), swim: [
    P("M 0.16 -0.12 Q 0.52 -0.1 0.68 -0.3 Q 0.6 -0.06 0.74 0.06 Q 0.44 0.02 0.16 0 Z", "dark"),
    P("M -0.08 -0.86 Q 0.22 -0.5 0.24 -0.26 Q 0.24 0 -0.08 0.02 Q -0.4 0 -0.4 -0.26 Q -0.38 -0.5 -0.08 -0.86 Z", "body"),
    E(-0.08, -0.16, 0.22, 0.12, "light"),
    S("M -0.36 -0.22 Q -0.5 -0.3 -0.52 -0.42", "body", 0.06),
    E(-0.18, -0.5, 0.05, 0.11, "shine", { rot: -0.45 }),
    EYE(-0.2, -0.3), EYE(0.02, -0.3),
    S("M -0.15 -0.2 Q -0.09 -0.15 -0.03 -0.2", "ink", 0.025) ] },

  /* 3 Mermaid (Uncommon): swims well below the surface; leaps out now and then */
  { crown: [-0.7, 1.74], zone: "middle", pal: base({ skin: FIX("#f2c9a5"), hair: HUE(-150, 58, 42), shell: FIX("#f7b6c8") }), swim: [
    P("M 0.62 2.02 L 0.98 1.8 L 0.92 2.08 L 1.04 2.36 L 0.7 2.18 Z", "dark"),
    P("M -0.16 1.98 Q 0.24 1.86 0.66 2.02 Q 0.74 2.08 0.66 2.16 Q 0.26 2.28 -0.16 2.2 Z", "body"),
    S("M 0.04 2.0 Q 0.1 2.08 0.04 2.16", "light", 0.025), S("M 0.22 1.98 Q 0.28 2.08 0.22 2.18", "light", 0.025),
    S("M 0.4 2.0 Q 0.46 2.08 0.4 2.16", "light", 0.025),
    E(-0.34, 2.08, 0.24, 0.14, "skin"),
    E(-0.42, 2.02, 0.065, 0.055, "shell"), E(-0.28, 2.02, 0.065, 0.055, "shell"),
    S("M -0.46 2.16 Q -0.62 2.26 -0.76 2.2", "skin", 0.05),
    P("M -0.6 1.82 Q -0.36 1.76 -0.18 1.88 Q 0.02 1.98 0.16 1.9 Q 0 2.06 -0.26 1.98 Q -0.46 1.94 -0.5 2.06 Q -0.82 1.9 -0.6 1.82 Z", "hair"),
    E(-0.68, 1.97, 0.16, 0.16, "skin"),
    P("M -0.84 1.92 Q -0.82 1.76 -0.64 1.78 Q -0.52 1.8 -0.52 1.9 Q -0.66 1.86 -0.84 1.92 Z", "hair"),
    EYE(-0.75, 1.96, 0.85) ] },

  /* 4 Hippocampus (Uncommon): a horse in front, a fish behind */
  { crown: [-0.5, -1.0], pal: base({ mane: HUE(150, 60, 45), hoof: FIX("#3b2a1d") }), swim: [
    S("M 0.24 -0.12 Q 0.62 -0.06 0.74 -0.32 Q 0.82 -0.56 0.62 -0.6 Q 0.48 -0.56 0.56 -0.44", "dark", 0.11),
    P("M 0.62 -0.6 L 0.86 -0.74 L 0.78 -0.52 Z", "dark"),
    E(0.04, -0.15, 0.36, 0.19, "body"),
    P("M -0.34 -0.2 Q -0.32 -0.6 -0.46 -0.78 L -0.2 -0.88 Q -0.04 -0.6 0.04 -0.28 Z", "body"),
    P("M -0.24 -0.92 Q -0.02 -0.76 0.0 -0.42 Q 0.04 -0.3 0.12 -0.34 Q 0.08 -0.62 -0.12 -0.96 Z", "mane"),
    E(-0.52, -0.82, 0.2, 0.12, "body", { rot: 0.38 }), E(-0.68, -0.73, 0.09, 0.08, "light"),
    P("M -0.36 -0.92 L -0.3 -1.06 L -0.24 -0.9 Z", "body"),
    P("M -0.22 -0.2 Q -0.42 -0.12 -0.5 -0.2 Q -0.56 -0.3 -0.46 -0.32 Q -0.4 -0.24 -0.22 -0.28 Z", "dark"),
    E(-0.52, -0.3, 0.05, 0.035, "hoof", { rot: 0.5 }),
    E(-0.72, -0.72, 0.02, 0.015, "ink"),
    EYE(-0.5, -0.86, 0.85) ] },

  /* 5 Mimic (???): a treasure chest on the bottom, until it smiles */
  { crown: [0, FLOOR - 1.04], zone: "bottom",
    pal: { wood: FIX("#8a5a2b"), plank: FIX("#6e4520"), band: FIX("#d4a536"), mouth: FIX("#3b1d1d"), tongue: FIX("#d9536f"), tooth: FIX("#f4f1e6"), ink: FIX("#2a2118") },
    swim: [
      P("M -0.5 -0.46 L 0.5 -0.46 L 0.5 0 L -0.5 0 Z", "wood", FLOOR),
      S("M -0.5 -0.23 L 0.5 -0.23", "plank", 0.02, FLOOR),
      P("M -0.48 -0.48 L 0.46 -0.48 L 0.4 -0.78 L -0.52 -0.74 Z", "mouth", FLOOR),
      P("M -0.18 -0.5 Q 0.0 -0.66 0.2 -0.52 Q 0.3 -0.48 0.36 -0.52 Q 0.24 -0.4 0.0 -0.47 Q -0.14 -0.47 -0.18 -0.5 Z", "tongue", FLOOR),
      ...teeth(-0.46, 0.44, FLOOR - 0.47, 7, 0.1, -1, "tooth"),
      P("M -0.56 -0.74 L 0.44 -0.8 L 0.38 -1.02 Q -0.08 -1.14 -0.58 -0.96 Z", "wood", FLOOR),
      ...teeth(-0.5, 0.4, FLOOR - 0.77, 6, 0.09, 1, "tooth"),
      S("M -0.58 -0.96 L -0.56 -0.74", "band", 0.05, FLOOR), S("M 0.38 -1.02 L 0.44 -0.8", "band", 0.05, FLOOR),
      S("M -0.5 -0.46 L -0.5 0", "band", 0.05, FLOOR), S("M 0.5 -0.46 L 0.5 0", "band", 0.05, FLOOR),
      E(-0.06, FLOOR - 0.36, 0.06, 0.07, "band"),
      EYE(-0.2, FLOOR - 0.92), EYE(0.08, FLOOR - 0.94) ] },

  /* 6 Jackalope (Common): a hare with antlers, up to its belly in the water */
  { crown: [-0.3, -0.88], pal: base({ antler: FIX("#d9c49a"), inner: FIX("#f3b6c2"), nose: FIX("#e58aa0") }), swim: [
    E(0.12, -0.22, 0.38, 0.28, "body"), E(0.48, -0.3, 0.1, 0.09, "white"),
    E(-0.16, -0.05, 0.09, 0.05, "light"),
    E(-0.18, -0.88, 0.06, 0.22, "body", { rot: 0.3 }), E(-0.18, -0.88, 0.028, 0.15, "inner", { rot: 0.3 }),
    S("M -0.4 -0.7 L -0.48 -1.04", "antler", 0.04), S("M -0.44 -0.88 L -0.58 -0.96", "antler", 0.035), S("M -0.47 -0.98 L -0.4 -1.1", "antler", 0.03),
    S("M -0.26 -0.72 L -0.25 -1.06", "antler", 0.04), S("M -0.25 -0.92 L -0.13 -1.0", "antler", 0.035),
    E(-0.32, -0.54, 0.22, 0.19, "body"), E(-0.42, -0.48, 0.1, 0.07, "light"),
    E(-0.53, -0.53, 0.035, 0.03, "nose"),
    EYE(-0.41, -0.59) ] },

  /* 7 Will-o'-Wisp (Common): a flame that floats over the water and leads you nowhere */
  { crown: [-0.04, -1.08], zone: "air", pal: base({ glow: HUE(0, 90, 72, 0.3), core: HUE(15, 95, 84), flame: HUE(0, 85, 62) }), swim: [
    E(-0.02, -0.56, 0.38, 0.34, "glow"),
    P("M 0.14 -0.42 Q 0.5 -0.34 0.72 -0.6 Q 0.58 -0.42 0.36 -0.62 Z", "flame"),
    P("M -0.04 -1.0 Q 0.06 -0.8 0.2 -0.72 Q 0.3 -0.5 0.12 -0.36 Q -0.04 -0.26 -0.2 -0.36 Q -0.34 -0.5 -0.24 -0.68 Q -0.18 -0.82 -0.04 -1.0 Z", "flame"),
    E(-0.04, -0.52, 0.15, 0.14, "core"),
    EYE(-0.1, -0.54, 0.75), EYE(0.04, -0.54, 0.75) ] },

  /* 8 Tiddalik (Common): the frog that drank all the water in the world */
  { crown: [-0.06, -0.86], pal: base({ belly: HUE(40, 50, 82), water: FIX("#8ccbee") }), swim: [
    E(-0.36, -0.02, 0.13, 0.05, "dark"), E(0.38, -0.02, 0.13, 0.05, "dark"),
    E(0.02, -0.34, 0.5, 0.38, "body"), E(-0.04, -0.26, 0.38, 0.26, "belly"),
    S("M -0.26 -0.18 Q -0.04 -0.08 0.2 -0.18", "water", 0.05), S("M -0.2 -0.28 Q -0.04 -0.2 0.12 -0.28", "water", 0.04),
    E(-0.2, -0.7, 0.12, 0.11, "body"), E(0.14, -0.7, 0.12, 0.11, "body"),
    S("M -0.46 -0.42 Q -0.22 -0.32 0.12 -0.44", "dark", 0.03),
    E(-0.42, -0.48, 0.08, 0.06, "light"),
    P("M -0.5 -0.36 Q -0.56 -0.26 -0.5 -0.22 Q -0.44 -0.26 -0.5 -0.36 Z", "water"),
    EYE(-0.22, -0.72), EYE(0.12, -0.72) ] },

  /* 9 Bunyip (Common): the billabong's shaggy dog-seal, on the bottom */
  { crown: [-0.36, FLOOR - 0.66], zone: "bottom", pal: base({ tusk: FIX("#efe6cf"), shag: HUE(0, 40, 30) }), swim: [
    S("M 0.5 -0.3 Q 0.74 -0.36 0.8 -0.18", "dark", 0.07, FLOOR),
    E(0.1, FLOOR - 0.3, 0.46, 0.28, "body"),
    ...teeth(-0.34, 0.54, FLOOR - 0.06, 8, 0.08, 1, "shag"),
    E(-0.24, FLOOR - 0.04, 0.12, 0.04, "dark"), E(0.38, FLOOR - 0.04, 0.12, 0.04, "dark"),
    E(-0.38, FLOOR - 0.42, 0.22, 0.2, "body"),
    E(-0.24, FLOOR - 0.52, 0.06, 0.13, "dark", { rot: 0.4 }),
    E(-0.56, FLOOR - 0.36, 0.11, 0.08, "light"), E(-0.64, FLOOR - 0.4, 0.035, 0.03, "ink"),
    P("M -0.52 -0.3 L -0.5 -0.16 L -0.46 -0.29 Z", "tusk", FLOOR), P("M -0.42 -0.29 L -0.4 -0.15 L -0.36 -0.28 Z", "tusk", FLOOR),
    EYE(-0.45, FLOOR - 0.48) ] },

  /* 10 Pixie (Common): a winged flicker with a wand, hovering over the water */
  { crown: [-0.1, -1.12], zone: "air", pal: base({ wing: HUE(160, 70, 86, 0.55), skin: FIX("#f6d2b6"), hair: HUE(40, 60, 40), spark: FIX("#ffe066") }), swim: [
    E(0.12, -0.74, 0.24, 0.11, "wing", { rot: -0.6 }), E(0.16, -0.56, 0.18, 0.08, "wing", { rot: 0.4 }),
    S("M -0.14 -0.34 L -0.16 -0.24", "skin", 0.035), S("M -0.04 -0.34 L -0.02 -0.24", "skin", 0.035),
    P("M -0.2 -0.64 L 0.04 -0.64 L 0.12 -0.34 Q -0.04 -0.28 -0.26 -0.34 Z", "body"),
    S("M -0.18 -0.58 L -0.34 -0.7", "skin", 0.035),
    S("M -0.34 -0.7 L -0.46 -0.82", "dark", 0.025), P(star(-0.48, -0.85, 0.075, 0.032), "spark"),
    E(-0.08, -0.8, 0.13, 0.13, "skin"),
    P("M -0.22 -0.86 Q -0.1 -1.0 0.06 -0.88 Q 0.08 -0.76 0.02 -0.72 Q 0.0 -0.86 -0.22 -0.86 Z", "hair"),
    P("M 0.02 -0.82 L 0.13 -0.9 L 0.05 -0.75 Z", "skin"),
    P("M -0.24 -0.9 L 0.06 -0.92 L -0.14 -1.08 Z", "dark"),
    EYE(-0.14, -0.8, 0.7) ] },

  /* 11 Sea-Goat (Uncommon): Capricorn, a goat in front and a fish behind */
  { crown: [-0.36, -0.92], pal: base({ horn: FIX("#d9c49a"), beard: FIX("#efe9df"), hoof: FIX("#3b2a1d") }), swim: [
    P("M 0.5 -0.12 Q 0.74 -0.1 0.82 -0.32 L 0.96 -0.44 L 0.92 -0.22 L 1.0 -0.04 L 0.82 -0.12 Q 0.7 0.0 0.5 0.0 Z", "dark"),
    E(0.18, -0.12, 0.42, 0.17, "body"),
    S("M -0.22 -0.24 L -0.28 -0.04", "body", 0.07), S("M -0.06 -0.24 L -0.08 -0.04", "body", 0.07),
    E(-0.29, -0.03, 0.045, 0.03, "hoof"), E(-0.09, -0.03, 0.045, 0.03, "hoof"),
    P("M -0.3 -0.24 Q -0.3 -0.46 -0.36 -0.5 L -0.14 -0.56 Q -0.08 -0.36 0.0 -0.22 Z", "body"),
    E(-0.36, -0.56, 0.2, 0.17, "body"), E(-0.54, -0.5, 0.1, 0.08, "light"),
    P("M -0.52 -0.42 L -0.47 -0.22 L -0.4 -0.42 Z", "beard"),
    E(-0.18, -0.62, 0.1, 0.035, "dark", { rot: 0.45 }),
    S("M -0.32 -0.7 Q -0.12 -0.98 0.04 -0.8 Q 0.1 -0.64 -0.04 -0.62", "horn", 0.06),
    EYE(-0.42, -0.59) ] },

  /* 12 Cockatrice (Uncommon): a rooster with a dragon's tail; best not to look it in the eye */
  { crown: [-0.3, -1.0], pal: base({ comb: FIX("#d93a3a"), beak: FIX("#e8a12e"), wing: HUE(-30, 50, 38) }), swim: [
    S("M 0.3 -0.2 Q 0.66 -0.1 0.78 -0.38 Q 0.84 -0.58 0.68 -0.64", "dark", 0.08),
    P("M 0.68 -0.64 L 0.56 -0.74 L 0.62 -0.56 Z", "dark"),
    E(0.06, -0.26, 0.36, 0.25, "body"),
    P("M -0.04 -0.38 Q 0.2 -0.66 0.46 -0.62 L 0.38 -0.5 L 0.46 -0.42 L 0.32 -0.36 L 0.36 -0.26 Q 0.14 -0.24 -0.04 -0.38 Z", "wing"),
    E(-0.3, -0.62, 0.16, 0.17, "body"),
    P("M -0.4 -0.76 L -0.36 -0.9 L -0.3 -0.8 L -0.24 -0.92 L -0.2 -0.8 L -0.14 -0.88 L -0.16 -0.72 Z", "comb"),
    E(-0.42, -0.48, 0.04, 0.06, "comb"),
    P("M -0.45 -0.64 L -0.6 -0.58 L -0.45 -0.54 Z", "beak"),
    EYE(-0.34, -0.66) ] },

  /* 13 Wyvern (Uncommon): a two-legged dragon that would rather hover than swim */
  { crown: [-0.42, -1.02], zone: "air", pal: base({ wing: HUE(0, 45, 34, 0.92), belly: HUE(30, 60, 74) }), swim: [
    S("M 0.28 -0.6 Q 0.6 -0.56 0.7 -0.4 Q 0.78 -0.3 0.9 -0.34", "body", 0.06),
    P("M 0.9 -0.34 L 1.02 -0.42 L 1.0 -0.26 Z", "dark"),
    P("M 0.02 -0.7 Q 0.08 -1.2 0.52 -1.34 Q 0.42 -1.16 0.5 -1.06 Q 0.36 -1.0 0.42 -0.86 Q 0.26 -0.82 0.24 -0.66 Z", "wing"),
    S("M 0.04 -0.7 L 0.5 -1.32", "dark", 0.03),
    E(0.04, -0.6, 0.3, 0.17, "body"), E(0.0, -0.53, 0.22, 0.08, "belly"),
    S("M -0.04 -0.48 L -0.08 -0.3", "dark", 0.05), S("M 0.12 -0.48 L 0.14 -0.3", "dark", 0.05),
    S("M -0.24 -0.66 Q -0.34 -0.78 -0.36 -0.86", "body", 0.1),
    E(-0.44, -0.88, 0.17, 0.1, "body", { rot: -0.2 }),
    S("M -0.36 -0.95 L -0.26 -1.06", "dark", 0.03),
    S("M -0.58 -0.84 L -0.48 -0.84", "ink", 0.015),
    EYE(-0.46, -0.91, 0.8) ] },

  /* 14 Yeti (Uncommon): out of the snow at last, having a long soak */
  { crown: [-0.06, -1.04], pal: base({ fur: FIX("#eef3f6"), shade: FIX("#c9d6de"), face: HUE(200, 35, 64) }), swim: [
    E(-0.44, -0.12, 0.15, 0.08, "fur"), E(0.42, -0.12, 0.15, 0.08, "fur"),
    E(0.0, -0.4, 0.46, 0.42, "fur"),
    ...teeth(-0.36, 0.36, -0.06, 6, 0.08, 1, "shade"),
    P("M -0.3 -0.76 L -0.22 -0.92 L -0.12 -0.8 L -0.04 -0.96 L 0.04 -0.8 L 0.14 -0.92 L 0.2 -0.74 Z", "fur"),
    E(-0.1, -0.56, 0.22, 0.19, "face"),
    S("M -0.3 -0.66 L -0.16 -0.64", "shade", 0.04), S("M -0.04 -0.64 L 0.1 -0.66", "shade", 0.04),
    S("M -0.2 -0.46 Q -0.1 -0.4 0.0 -0.46", "ink", 0.025),
    E(-0.1, -0.52, 0.04, 0.025, "ink"),
    EYE(-0.22, -0.58), EYE(0.02, -0.58) ] },

  /* 15 Umibozu (Uncommon): the bald sea giant that rises next to boats */
  { crown: [0, -1.12], pal: base({ glow: FIX("#ffe9a6"), deep: HUE(0, 30, 22), sheen: FIX("rgba(255,255,255,0.16)") }), swim: [
    E(0.0, 0.03, 0.8, 0.06, "", { stroke: "light", w: 0.03 }),
    P("M -0.52 -0.4 L 0.52 -0.4 Q 0.62 -0.06 0.72 0.05 L -0.72 0.05 Q -0.62 -0.06 -0.52 -0.4 Z", "deep"),
    E(0.0, -0.4, 0.52, 0.68, "deep", { a0: 3.1416, a1: 6.2832, chord: true }),
    E(-0.22, -0.86, 0.13, 0.06, "sheen", { rot: -0.4 }),
    E(-0.2, -0.6, 0.1, 0.065, "glow"), E(0.16, -0.6, 0.1, 0.065, "glow"),
    EYE(-0.2, -0.6, 0.6), EYE(0.16, -0.6, 0.6),
    S("M -0.12 -0.38 Q 0.0 -0.33 0.12 -0.38", "dark", 0.03) ] },

  /* 16 Griffin (Rare): eagle's head and wings, a lion behind, hovering */
  { crown: [-0.36, -1.0], zone: "air", pal: base({ feather: FIX("#f3ede0"), beak: FIX("#e8a12e"), wing: HUE(10, 45, 40), tuft: HUE(0, 50, 34) }), swim: [
    S("M 0.42 -0.56 Q 0.66 -0.6 0.72 -0.42", "body", 0.04), E(0.74, -0.38, 0.06, 0.07, "tuft"),
    S("M 0.3 -0.46 L 0.34 -0.28", "body", 0.07), S("M 0.16 -0.46 L 0.18 -0.28", "body", 0.07),
    E(0.12, -0.56, 0.36, 0.17, "body"),
    P("M -0.08 -0.66 Q 0.08 -1.22 0.6 -1.3 Q 0.5 -1.14 0.56 -1.06 Q 0.42 -1.02 0.48 -0.9 Q 0.32 -0.86 0.34 -0.74 Q 0.16 -0.7 0.12 -0.6 Z", "wing"),
    S("M 0.04 -0.86 Q 0.22 -1.08 0.48 -1.16", "feather", 0.025),
    S("M -0.18 -0.46 Q -0.26 -0.36 -0.2 -0.28", "beak", 0.04), S("M -0.06 -0.46 Q -0.12 -0.36 -0.06 -0.28", "beak", 0.04),
    E(-0.24, -0.62, 0.16, 0.14, "feather"),
    E(-0.36, -0.8, 0.17, 0.15, "feather"),
    P("M -0.2 -0.9 L -0.14 -1.02 L -0.28 -0.94 Z", "feather"),
    P("M -0.5 -0.84 Q -0.66 -0.84 -0.64 -0.7 Q -0.58 -0.76 -0.5 -0.74 Z", "beak"),
    EYE(-0.4, -0.84, 0.9) ] },

  /* 17 Pegasus (Rare): the winged horse, hooves tucked, hovering */
  { crown: [-0.5, -1.12], zone: "air", pal: base({ coat: FIX("#f6f7fb"), wing: FIX("#e6eef8"), shade: FIX("#9fb0c4"), mane: HUE(0, 65, 62), hoof: FIX("#9aa4b0") }), swim: [
    P("M 0.44 -0.6 Q 0.74 -0.62 0.82 -0.4 Q 0.66 -0.48 0.48 -0.5 Z", "mane"),
    S("M 0.3 -0.48 Q 0.38 -0.32 0.26 -0.28", "shade", 0.09), S("M -0.08 -0.48 Q -0.02 -0.32 -0.14 -0.28", "shade", 0.09),
    S("M 0.3 -0.48 Q 0.38 -0.32 0.26 -0.28", "coat", 0.055), S("M -0.08 -0.48 Q -0.02 -0.32 -0.14 -0.28", "coat", 0.055),
    E(0.25, -0.28, 0.045, 0.03, "hoof"), E(-0.15, -0.28, 0.045, 0.03, "hoof"),
    E(0.12, -0.56, 0.36, 0.17, "coat", { stroke: "shade", w: 0.022 }),
    PO("M -0.04 -0.66 Q 0.04 -1.24 0.56 -1.34 Q 0.46 -1.18 0.52 -1.08 Q 0.38 -1.04 0.44 -0.92 Q 0.28 -0.88 0.3 -0.76 Q 0.14 -0.74 0.12 -0.64 Z", "wing", "shade"),
    S("M 0.06 -0.84 Q 0.22 -1.06 0.46 -1.16", "shade", 0.022), S("M 0.12 -0.72 Q 0.26 -0.86 0.4 -0.9", "shade", 0.022),
    PO("M -0.22 -0.6 Q -0.24 -0.84 -0.38 -0.98 L -0.18 -1.06 Q -0.06 -0.84 0.02 -0.64 Z", "coat", "shade"),
    P("M -0.2 -1.08 Q 0.0 -0.96 0.02 -0.66 Q 0.08 -0.58 0.12 -0.62 Q 0.1 -0.86 -0.08 -1.1 Z", "mane"),
    E(-0.46, -1.0, 0.2, 0.11, "coat", { rot: 0.4, stroke: "shade", w: 0.022 }), E(-0.6, -0.93, 0.07, 0.06, "shade"),
    PO("M -0.3 -1.1 L -0.25 -1.22 L -0.2 -1.08 Z", "coat", "shade"),
    EYE(-0.44, -1.04, 0.85) ] },

  /* 18 Unicorn (Rare): swims with its horn held high and its mane in every colour */
  { crown: [-0.36, -1.0], pal: base({ coat: FIX("#fbf8f4"), shade: FIX("#b9b1a8"), horn: FIX("#f2d07a"), hornline: FIX("#c9a24a"),
                                       mane2: HUE(60, 70, 66), mane3: HUE(-60, 70, 66) }), swim: [
    E(0.18, -0.08, 0.42, 0.15, "coat", { stroke: "shade", w: 0.022 }),
    PO("M -0.24 -0.12 Q -0.22 -0.56 -0.38 -0.74 L -0.14 -0.84 Q 0.02 -0.56 0.1 -0.16 Z", "coat", "shade"),
    P("M -0.16 -0.88 Q 0.06 -0.72 0.1 -0.36 Q 0.16 -0.22 0.24 -0.26 Q 0.2 -0.58 0.0 -0.92 Z", "body"),
    P("M -0.06 -0.82 Q 0.14 -0.62 0.18 -0.34 Q 0.24 -0.22 0.32 -0.28 Q 0.28 -0.56 0.08 -0.84 Z", "mane2"),
    P("M 0.04 -0.74 Q 0.22 -0.56 0.26 -0.34 Q 0.32 -0.26 0.38 -0.32 Q 0.34 -0.52 0.16 -0.74 Z", "mane3"),
    E(-0.42, -0.76, 0.2, 0.11, "coat", { rot: 0.4, stroke: "shade", w: 0.022 }), E(-0.57, -0.69, 0.06, 0.05, "shade"),
    P("M -0.36 -0.86 L -0.48 -1.32 L -0.28 -0.88 Z", "horn"),
    S("M -0.42 -1.06 L -0.34 -1.02", "hornline", 0.015), S("M -0.39 -0.96 L -0.31 -0.93", "hornline", 0.015), S("M -0.45 -1.16 L -0.38 -1.13", "hornline", 0.015),
    PO("M -0.24 -0.84 L -0.2 -0.98 L -0.14 -0.84 Z", "coat", "shade"),
    E(-0.62, -0.68, 0.018, 0.014, "ink"),
    EYE(-0.4, -0.8, 0.85) ] },

  /* 19 Kitsune (Rare): a fox spirit; every tail is a hundred years */
  { crown: [-0.26, -0.84], pal: base({ tip: FIX("#f7f3ec"), inner: FIX("#f3b6a2") }), swim: [
    P("M 0.2 -0.26 Q 0.46 -0.9 0.62 -0.92 Q 0.56 -0.6 0.3 -0.2 Z", "body"), E(0.6, -0.88, 0.07, 0.07, "tip"),
    P("M 0.22 -0.24 Q 0.62 -0.74 0.8 -0.66 Q 0.66 -0.4 0.32 -0.18 Z", "body"), E(0.77, -0.65, 0.07, 0.07, "tip"),
    P("M 0.24 -0.2 Q 0.72 -0.46 0.86 -0.32 Q 0.66 -0.16 0.32 -0.12 Z", "body"), E(0.84, -0.32, 0.07, 0.07, "tip"),
    P("M 0.24 -0.16 Q 0.7 -0.12 0.8 0.0 Q 0.56 0.04 0.3 -0.08 Z", "light"), E(0.78, -0.01, 0.06, 0.05, "tip"),
    P("M 0.18 -0.3 Q 0.24 -0.96 0.38 -1.04 Q 0.4 -0.7 0.28 -0.24 Z", "light"), E(0.37, -1.0, 0.06, 0.07, "tip"),
    E(0.04, -0.24, 0.3, 0.23, "body"), E(-0.13, -0.28, 0.12, 0.16, "tip"),
    P("M -0.22 -0.7 L -0.16 -0.92 L -0.06 -0.68 Z", "body"), P("M -0.19 -0.72 L -0.16 -0.84 L -0.11 -0.71 Z", "inner"),
    P("M -0.4 -0.68 L -0.4 -0.9 L -0.26 -0.7 Z", "body"), P("M -0.38 -0.7 L -0.38 -0.82 L -0.31 -0.71 Z", "inner"),
    E(-0.26, -0.56, 0.18, 0.15, "body"),
    P("M -0.36 -0.58 L -0.62 -0.5 L -0.36 -0.44 Z", "body"), P("M -0.4 -0.5 L -0.58 -0.49 L -0.38 -0.44 Z", "tip"),
    E(-0.61, -0.505, 0.035, 0.028, "ink"),
    EYE(-0.32, -0.6, 0.85) ] },

  /* 20 Sphinx (Rare): lies on the water like it owns it, and asks riddles */
  { crown: [-0.38, -0.98], pal: base({ gold: FIX("#e2b54a"), blue: FIX("#2f5fa8"), skin: FIX("#d9a066") }), swim: [
    S("M 0.6 -0.16 Q 0.82 -0.16 0.84 -0.36", "body", 0.04), E(0.85, -0.39, 0.05, 0.06, "dark"),
    E(0.16, -0.18, 0.48, 0.19, "body"),
    E(-0.42, -0.06, 0.2, 0.06, "body"), E(-0.38, -0.12, 0.16, 0.06, "light"),
    P("M -0.6 -0.38 Q -0.58 -0.82 -0.38 -0.86 Q -0.16 -0.86 -0.14 -0.38 L -0.2 -0.22 L -0.56 -0.22 Z", "gold"),
    S("M -0.56 -0.32 L -0.2 -0.32", "blue", 0.035), S("M -0.58 -0.44 L -0.16 -0.44", "blue", 0.035),
    S("M -0.54 -0.68 Q -0.38 -0.78 -0.22 -0.68", "blue", 0.035),
    E(-0.38, -0.56, 0.14, 0.15, "skin"),
    P("M -0.42 -0.42 L -0.34 -0.42 L -0.36 -0.28 L -0.4 -0.28 Z", "blue"),
    S("M -0.44 -0.47 L -0.34 -0.47", "dark", 0.02),
    EYE(-0.44, -0.58, 0.8), EYE(-0.3, -0.58, 0.8) ] },

  /* 21 Phoenix (Epic): a bird of fire, hovering; its tail trails flame */
  { crown: [-0.28, -1.0], zone: "air", pal: base({ flame: HUE(0, 90, 55), ember: HUE(30, 95, 60), core: HUE(50, 95, 78), beak: FIX("#ffd166") }), swim: [
    P("M 0.18 -0.58 Q 0.62 -0.5 0.9 -0.28 Q 0.72 -0.32 0.62 -0.24 Q 0.5 -0.4 0.16 -0.5 Z", "flame"),
    P("M 0.18 -0.54 Q 0.5 -0.36 0.66 -0.24 Q 0.52 -0.26 0.46 -0.2 Q 0.36 -0.34 0.14 -0.46 Z", "ember"),
    P("M -0.06 -0.66 Q -0.1 -1.24 0.3 -1.58 Q 0.26 -1.36 0.36 -1.3 Q 0.42 -1.46 0.6 -1.5 Q 0.5 -1.28 0.56 -1.14 Q 0.66 -1.2 0.78 -1.16 Q 0.62 -0.96 0.6 -0.78 Q 0.3 -0.66 0.12 -0.6 Z", "flame"),
    P("M 0.0 -0.68 Q 0.02 -1.08 0.3 -1.32 Q 0.3 -1.12 0.38 -1.06 Q 0.46 -1.14 0.56 -1.12 Q 0.46 -0.94 0.46 -0.78 Q 0.22 -0.68 0.1 -0.62 Z", "ember"),
    E(0.02, -0.58, 0.24, 0.16, "flame"), E(-0.04, -0.53, 0.15, 0.08, "core"),
    E(-0.28, -0.78, 0.12, 0.11, "flame"),
    P("M -0.24 -0.88 Q -0.2 -1.04 -0.1 -1.06 Q -0.14 -0.96 -0.12 -0.88 Q -0.04 -0.98 0.02 -0.96 Q -0.06 -0.86 -0.16 -0.84 Z", "ember"),
    P("M -0.38 -0.8 L -0.52 -0.74 L -0.38 -0.71 Z", "beak"),
    EYE(-0.31, -0.81, 0.8) ] },

  /* 22 Hydra (Epic): cut one off and two grow back; three for now */
  { crown: [-0.3, -1.22], pal: base({ belly: HUE(40, 55, 70), fang: FIX("#f4f1e6") }), swim: [
    S("M 0.6 -0.1 Q 0.84 -0.04 0.9 -0.24 Q 0.94 -0.4 0.8 -0.42", "body", 0.08),
    E(0.18, -0.1, 0.5, 0.2, "body"), E(0.14, -0.03, 0.38, 0.08, "belly"),
    S("M 0.12 -0.22 Q 0.08 -0.62 0.06 -0.8", "dark", 0.13),
    S("M -0.06 -0.24 Q -0.18 -0.7 -0.28 -1.0", "body", 0.13),
    S("M -0.16 -0.2 Q -0.4 -0.3 -0.56 -0.58", "body", 0.13),
    E(0.04, -0.86, 0.15, 0.09, "dark", { rot: -0.2 }), P("M -0.1 -0.84 L -0.12 -0.76 L -0.06 -0.8 Z", "fang"),
    S("M 0.12 -0.92 L 0.2 -1.0", "dark", 0.03), EYE(0.0, -0.89, 0.7),
    E(-0.32, -1.06, 0.16, 0.1, "body", { rot: -0.15 }), P("M -0.46 -1.02 L -0.48 -0.93 L -0.42 -0.98 Z", "fang"),
    S("M -0.24 -1.14 L -0.16 -1.22", "dark", 0.03), EYE(-0.36, -1.09, 0.75),
    E(-0.62, -0.62, 0.16, 0.1, "body", { rot: -0.1 }), P("M -0.76 -0.58 L -0.78 -0.49 L -0.72 -0.54 Z", "fang"),
    S("M -0.54 -0.7 L -0.46 -0.78", "dark", 0.03), EYE(-0.66, -0.65, 0.75) ] },

  /* 23 Leviathan (Epic): the great sea serpent, coils rising out of the deep */
  { crown: [-0.56, -1.14], pal: base({ fin: HUE(160, 60, 48), belly: HUE(30, 50, 72), fang: FIX("#f4f1e6") }), swim: [
    S("M 0.66 0.04 Q 0.8 -0.34 0.98 0.04", "body", 0.15),
    S("M 0.14 0.04 Q 0.32 -0.58 0.5 0.04", "body", 0.17),
    P("M 0.2 -0.22 L 0.26 -0.44 L 0.3 -0.28 L 0.36 -0.46 L 0.42 -0.24 Z", "fin"),
    S("M -0.12 0.04 Q -0.06 -0.62 -0.46 -0.86", "body", 0.2),
    S("M -0.12 -0.02 Q -0.12 -0.46 -0.34 -0.7", "belly", 0.06),
    P("M -0.02 -0.4 L 0.14 -0.5 L 0.04 -0.6 L 0.2 -0.68 L 0.0 -0.76 L 0.08 -0.88 L -0.18 -0.86 Z", "fin"),
    E(-0.6, -0.94, 0.26, 0.15, "body", { rot: -0.15 }),
    P("M -0.84 -0.86 Q -0.72 -0.74 -0.48 -0.82 L -0.5 -0.88 Z", "dark"),
    ...teeth(-0.8, -0.56, -0.86, 4, 0.05, 1, "fang"),
    P("M -0.5 -1.06 L -0.36 -1.24 L -0.4 -1.04 Z", "fin"), P("M -0.62 -1.07 L -0.54 -1.22 L -0.52 -1.06 Z", "fin"),
    EYE(-0.64, -0.99, 0.85) ] },

  /* 24 Cerberus (Epic): three good boys guarding the deep end */
  { crown: [-0.18, -0.9], pal: base({ collar: FIX("#c0392b"), spike: FIX("#d7dde3"), tongue: FIX("#e8708a"), nose: FIX("#2a2118") }), swim: [
    E(0.34, -0.08, 0.5, 0.17, "dark"),
    E(-0.12, -0.2, 0.5, 0.24, "body"),
    E(0.22, -0.46, 0.2, 0.18, "body"), E(0.18, -0.32, 0.15, 0.045, "collar"),
    P("M 0.28 -0.6 L 0.4 -0.74 L 0.4 -0.54 Z", "dark"),
    P("M 0.04 -0.48 L -0.1 -0.43 L 0.04 -0.38 Z", "body"), E(-0.1, -0.43, 0.035, 0.028, "nose"), EYE(0.12, -0.52, 0.8),
    E(-0.58, -0.36, 0.2, 0.18, "body"), E(-0.54, -0.22, 0.15, 0.045, "collar"),
    P("M -0.48 -0.5 L -0.36 -0.64 L -0.36 -0.44 Z", "dark"),
    P("M -0.76 -0.38 L -0.9 -0.33 L -0.76 -0.28 Z", "body"), E(-0.9, -0.33, 0.035, 0.028, "nose"),
    P("M -0.78 -0.28 Q -0.82 -0.16 -0.75 -0.14 Q -0.71 -0.2 -0.73 -0.28 Z", "tongue"), EYE(-0.66, -0.41, 0.8),
    E(-0.2, -0.6, 0.22, 0.2, "body"), E(-0.16, -0.44, 0.17, 0.05, "collar"),
    ...[-0.3, -0.19, -0.08].map(x => P("M " + x + " -0.41 L " + (x + 0.025) + " -0.35 L " + (x + 0.05) + " -0.41 Z", "spike")),
    P("M -0.08 -0.76 L 0.06 -0.92 L 0.06 -0.7 Z", "dark"),
    P("M -0.4 -0.62 L -0.56 -0.57 L -0.4 -0.51 Z", "body"), E(-0.56, -0.57, 0.04, 0.032, "nose"),
    EYE(-0.3, -0.66, 0.85) ] }
];
