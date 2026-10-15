/* Built-in drawings of the hats and props, in the Pet Studio's shape format (see
   petdefs.js), so each can be redrawn there and reset to these.
   crown, jester: units of r, origin at the pet's crown spot (the hat's bottom centre).
   grave: units of r, origin at the ground under the headstone; colours may follow the
          drowned pet's hue.
   coin:  one token seen face on, 1 unit across, origin at its centre. The bank's gold
          pile squashes it into a heap; the page's small coin icons use it as is. */

const HUE = (dh, s, l, a = 1) => ({ hue: 1, dh, s, l, a });
const FIX = c => ({ c });

function d(str) {
  const t = str.trim().split(/[\s,]+/), out = [], need = { M: 2, L: 2, Q: 4, C: 6, Z: 0 };
  for (let i = 0; i < t.length;) {
    const c = t[i++], n = need[c];
    out.push([c, ...t.slice(i, i + n).map(Number)]);
    i += n;
  }
  return out;
}
const E = (x, y, rx, ry, fill, o = {}) => Object.assign({ t: "ell", x, y, rx, ry, rot: o.rot || 0, a0: o.a0 ?? 0, a1: o.a1 ?? 6.2832 },
  fill ? { fill } : {}, o.chord ? { chord: true } : {}, o.stroke ? { stroke: o.stroke, w: o.w || 0.03 } : {});
const P = (path, fill, stroke, w) => Object.assign({ t: "path", d: d(path), fill }, stroke ? { stroke, w, cap: "round" } : {});
const S = (path, stroke, w) => ({ t: "path", d: d(path), stroke, w, cap: "round" });
const PI = 3.1416, TAU = 6.2832;

export const PROP_ART = {
  /* Silver: the crown marks the day's leader; gold stays for meeting your own goal. */
  crown: { pal: { silver: FIX("#d3dce4"), shade: FIX("#b3c0cb"), edge: FIX("#6f808e"), shine: FIX("#f4f8fb"),
                  ruby: FIX("#d9434e"), sapphire: FIX("#4f8fd9") }, shapes: [
    P("M -0.26 -0.08 L -0.31 -0.36 L -0.15 -0.21 L 0 -0.42 L 0.15 -0.21 L 0.31 -0.36 L 0.26 -0.08 Z", "silver", "edge", 0.035),
    P("M -0.04 -0.3 L 0 -0.36 L 0.04 -0.3 L 0 -0.24 Z", "sapphire"),
    S("M -0.22 -0.13 L -0.25 -0.27", "shine", 0.025),
    E(-0.31, -0.37, 0.042, 0.042, "shine", { stroke: "edge", w: 0.025 }), E(0, -0.43, 0.048, 0.048, "shine", { stroke: "edge", w: 0.025 }),
    E(0.31, -0.37, 0.042, 0.042, "shine", { stroke: "edge", w: 0.025 }),
    P("M -0.28 -0.11 L 0.28 -0.11 L 0.28 0 L -0.28 0 Z", "shade", "edge", 0.035),
    E(-0.15, -0.055, 0.032, 0.03, "ruby"), E(0, -0.055, 0.04, 0.034, "sapphire"), E(0.15, -0.055, 0.032, 0.03, "ruby") ] },

  /* Led the day, but under goal: three floppy points with bells. */
  jester: { pal: { red: FIX("#d9434e"), blue: FIX("#4f8fd9"), green: FIX("#4aa86b"), bell: FIX("#f7d038"),
                   rim: FIX("#c08f1c"), band: FIX("#f0b429"), dot: FIX("#fff3c4") }, shapes: [
    S("M -0.016 -0.02 Q -0.032 -0.39 0.135 -0.41", "blue", 0.14),
    S("M -0.05 -0.02 Q -0.29 -0.34 -0.334 -0.22", "red", 0.14),
    S("M 0.05 -0.02 Q 0.29 -0.34 0.334 -0.22", "green", 0.14),
    E(0.135, -0.41, 0.075, 0.075, "bell", { stroke: "rim", w: 0.025 }),
    E(-0.334, -0.22, 0.075, 0.075, "bell", { stroke: "rim", w: 0.025 }),
    E(0.334, -0.22, 0.075, 0.075, "bell", { stroke: "rim", w: 0.025 }),
    S("M 0.135 -0.39 L 0.135 -0.355", "rim", 0.02), S("M -0.334 -0.2 L -0.334 -0.165", "rim", 0.02), S("M 0.334 -0.2 L 0.334 -0.165", "rim", 0.02),
    P("M -0.29 -0.1 L 0.29 -0.1 Q 0.31 -0.05 0.29 0 L -0.29 0 Q -0.31 -0.05 -0.29 -0.1 Z", "band", "rim", 0.025),
    P("M -0.18 -0.085 L -0.15 -0.05 L -0.18 -0.015 L -0.21 -0.05 Z", "red"), P("M 0 -0.085 L 0.03 -0.05 L 0 -0.015 L -0.03 -0.05 Z", "blue"),
    P("M 0.18 -0.085 L 0.21 -0.05 L 0.18 -0.015 L 0.15 -0.05 Z", "green") ] },

  /* Where a drowned pet ends up: the stone takes a tint of the pet's own colour. */
  grave: { pal: { mound: FIX("rgba(110,128,120,0.5)"), grass: FIX("#6fa36b"), stone: HUE(0, 22, 66), face: HUE(0, 26, 72),
                  edge: HUE(0, 22, 44), carve: HUE(0, 20, 36), moss: FIX("rgba(104,158,98,0.75)") }, shapes: [
    E(0, 0, 0.62, 0.17, "mound", { a0: PI, a1: TAU, chord: true }),
    P("M -0.38 0 L -0.38 -0.52 Q -0.38 -0.92 0 -0.92 Q 0.38 -0.92 0.38 -0.52 L 0.38 0 Z", "stone", "edge", 0.045),
    P("M -0.28 -0.07 L -0.28 -0.52 Q -0.28 -0.82 0 -0.82 Q 0.28 -0.82 0.28 -0.52 L 0.28 -0.07 Z", "face"),
    S("M 0 -0.72 L 0 -0.3", "carve", 0.07), S("M -0.14 -0.58 L 0.14 -0.58", "carve", 0.07),
    S("M -0.14 -0.18 L 0.14 -0.18", "edge", 0.025), S("M -0.09 -0.12 L 0.09 -0.12", "edge", 0.025),
    S("M 0.27 -0.76 L 0.2 -0.66 L 0.24 -0.58", "edge", 0.018),
    E(-0.3, -0.06, 0.1, 0.05, "moss"), E(-0.36, -0.14, 0.05, 0.04, "moss"),
    S("M -0.5 -0.03 L -0.54 -0.13", "grass", 0.025), S("M -0.46 -0.04 L -0.45 -0.14", "grass", 0.025),
    S("M 0.46 -0.04 L 0.48 -0.15", "grass", 0.025), S("M 0.51 -0.03 L 0.57 -0.12", "grass", 0.025) ] },

  /* A token: gold, with a water drop struck in the middle. */
  coin: { pal: { rim: FIX("#c9951f"), face: FIX("#f6c945"), ring: FIX("#e0a92a"), emboss: FIX("#d9a22b"),
                 shine: FIX("#fff1b0") }, shapes: [
    E(0, 0, 0.5, 0.5, "rim"), E(0, 0, 0.42, 0.42, "face"),
    E(0, 0, 0.33, 0.33, null, { stroke: "ring", w: 0.035 }),
    P("M 0 -0.22 Q 0.15 -0.04 0.13 0.06 Q 0.11 0.17 0 0.17 Q -0.11 0.17 -0.13 0.06 Q -0.15 -0.04 0 -0.22 Z", "emboss"),
    E(-0.05, 0.06, 0.025, 0.05, "shine", { rot: 0.2 }),
    E(0, 0, 0.42, 0.42, null, { stroke: "shine", w: 0.05, a0: 3.5, a1: 4.4 }) ] }
};
