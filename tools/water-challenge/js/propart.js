/* Built-in drawings of the hats and props, in the Pet Studio's shape format (see
   petdefs.js), so each can be redrawn there and reset to these.
   crown, jester: units of r, origin at the pet's crown spot (the hat's bottom centre).
   grave: units of r, origin at the ground under the headstone; colours may follow the
          drowned pet's hue.
   coin:  one token seen face on, 1 unit across, origin at its centre. The bank's gold
          pile squashes it into a heap; the page's small coin icons use it as is.
   Holiday hats (santa, elf, witch, pumpkin, partyGold, partyStripe): drawn like the crown
          and jester, which they replace around their holiday (config HOLIDAY_HATS).
   medal: the day-win medal, units of r, origin at the disc's centre (the pet's medal spot). */

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
  /* Worn the day after a day win, hanging at the pet's medal spot. */
  medal: { pal: { gold: FIX("#f2c14e"), edge: FIX("#a87516"), shine: FIX("#fff3c4"),
             red: FIX("#d9434e"), blue: FIX("#3d7fd6") }, shapes: [
    P("M 0.221 -0.51 L 0.085 -0.51 L -0.068 -0.136 L 0.051 -0.102 Z", "blue", "edge", 0.02),
    P("M -0.221 -0.51 L -0.085 -0.51 L 0.068 -0.136 L -0.051 -0.102 Z", "red", "edge", 0.02),
    E(0, 0, 0.187, 0.187, "gold", { stroke: "edge", w: 0.04 }),
    E(0, 0, 0.1326, 0.1326, null, { stroke: "edge", w: 0.017 }),
    P("M 0 -0.0935 L 0.024 -0.033 L 0.0889 -0.0289 L 0.0388 0.0126 L 0.0549 0.0756 L 0 0.0408 L -0.0549 0.0756 L -0.0388 0.0126 L -0.0889 -0.0289 L -0.024 -0.033 Z", "shine"),
    E(-0.085, -0.085, 0.0374, 0.0204, "shine", { rot: -0.7 }) ] },

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
/* Holiday hats, by key. Same frame as the crown: origin at the crown spot, the brim on it. */
export const HOLIDAY_ART = {
  /* Christmas, goal met */
  santa: { pal: { red: FIX("#d63a3a"), deep: FIX("#a82424"), fur: FIX("#f7f7f2"), furEdge: FIX("#c9cdd1"), shade: FIX("#e6e8e4") }, shapes: [
    P("M -0.26 -0.08 Q -0.2 -0.44 0.06 -0.52 Q 0.32 -0.58 0.42 -0.3 Q 0.3 -0.42 0.16 -0.36 Q 0.2 -0.2 0.26 -0.08 Z", "red", "deep", 0.025),
    S("M -0.12 -0.14 Q -0.06 -0.36 0.06 -0.44", "deep", 0.02),
    E(0.42, -0.28, 0.075, 0.075, "fur", { stroke: "furEdge", w: 0.018 }),
    P("M -0.31 -0.13 Q -0.33 -0.065 -0.31 0 L 0.31 0 Q 0.33 -0.065 0.31 -0.13 Z", "fur", "furEdge", 0.02),
    E(-0.18, -0.07, 0.04, 0.025, "shade"), E(0.02, -0.08, 0.05, 0.025, "shade"), E(0.2, -0.06, 0.04, 0.025, "shade") ] },

  /* Christmas, led but under goal */
  elf: { pal: { green: FIX("#2f9e57"), deep: FIX("#1f6e3c"), red: FIX("#d63a3a"), redEdge: FIX("#a82424"), bell: FIX("#f7d038"), rim: FIX("#c08f1c") }, shapes: [
    P("M -0.22 -0.08 Q -0.12 -0.5 0.1 -0.62 Q 0.3 -0.72 0.38 -0.56 Q 0.26 -0.6 0.17 -0.48 Q 0.13 -0.28 0.22 -0.08 Z", "green", "deep", 0.025),
    S("M -0.08 -0.16 Q 0.0 -0.42 0.12 -0.54", "deep", 0.02),
    E(0.39, -0.54, 0.065, 0.065, "bell", { stroke: "rim", w: 0.02 }), S("M 0.39 -0.52 L 0.39 -0.49", "rim", 0.018),
    P("M -0.29 -0.13 L 0.29 -0.13 L 0.29 -0.02 L 0.22 0.03 L 0.145 -0.02 L 0.07 0.03 L 0 -0.02 L -0.07 0.03 L -0.145 -0.02 L -0.22 0.03 L -0.29 -0.02 Z", "red", "redEdge", 0.02),
    E(-0.18, -0.075, 0.025, 0.025, "bell"), E(0.0, -0.075, 0.025, 0.025, "bell"), E(0.18, -0.075, 0.025, 0.025, "bell") ] },

  /* Halloween, goal met */
  witch: { pal: { hat: FIX("#3b2b5e"), edge: FIX("#a58be0"), band: FIX("#8b4fd1"), buckle: FIX("#f2c94c"), sheen: FIX("#5a4787") }, shapes: [
    E(0, -0.03, 0.4, 0.07, "hat", { stroke: "edge", w: 0.02 }),
    P("M -0.19 -0.06 L -0.07 -0.42 Q -0.01 -0.58 0.16 -0.66 Q 0.06 -0.52 0.09 -0.38 L 0.19 -0.06 Z", "hat", "edge", 0.022),
    S("M -0.1 -0.14 L -0.03 -0.38", "sheen", 0.025),
    P("M -0.18 -0.09 L 0.18 -0.09 L 0.16 -0.18 L -0.155 -0.18 Z", "band"),
    P("M -0.05 -0.085 L 0.05 -0.085 L 0.05 -0.185 L -0.05 -0.185 Z", null, "buckle", 0.025) ] },

  /* Halloween, led but under goal */
  pumpkin: { pal: { orange: FIX("#f08a24"), rib: FIX("#c96512"), stem: FIX("#5c7a2e"), leaf: FIX("#7aa83a"), face: FIX("#3a1d05") }, shapes: [
    P("M 0.0 -0.38 Q -0.02 -0.47 0.05 -0.5 L 0.07 -0.46 Q 0.03 -0.44 0.04 -0.38 Z", "stem"),
    P("M 0.05 -0.44 Q 0.16 -0.52 0.22 -0.44 Q 0.14 -0.4 0.05 -0.44 Z", "leaf"),
    E(-0.15, -0.19, 0.17, 0.19, "orange", { stroke: "rib", w: 0.018 }), E(0.15, -0.19, 0.17, 0.19, "orange", { stroke: "rib", w: 0.018 }),
    E(0, -0.2, 0.15, 0.2, "orange", { stroke: "rib", w: 0.018 }),
    P("M -0.13 -0.24 L -0.06 -0.24 L -0.095 -0.31 Z", "face"), P("M 0.06 -0.24 L 0.13 -0.24 L 0.095 -0.31 Z", "face"),
    P("M -0.14 -0.13 L -0.09 -0.1 L -0.05 -0.13 L 0 -0.1 L 0.05 -0.13 L 0.09 -0.1 L 0.14 -0.13 Q 0 -0.04 -0.14 -0.13 Z", "face") ] },

  /* New Year, goal met */
  partyGold: { pal: { gold: FIX("#f2c43d"), edge: FIX("#b8860b"), dot: FIX("#fff6d6"), pom: FIX("#aeb9c6"), pomEdge: FIX("#7f8f9c") }, shapes: [
    S("M -0.06 -0.6 L -0.14 -0.7", "pom", 0.035), S("M 0.0 -0.6 L 0.0 -0.73", "pom", 0.035), S("M 0.06 -0.6 L 0.14 -0.7", "pom", 0.035),
    S("M -0.04 -0.58 L -0.15 -0.6", "pom", 0.03), S("M 0.04 -0.58 L 0.15 -0.6", "pom", 0.03),
    P("M -0.23 0 L 0 -0.58 L 0.23 0 Q 0 0.04 -0.23 0 Z", "gold", "edge", 0.025),
    E(-0.09, -0.12, 0.025, 0.025, "dot"), E(0.08, -0.2, 0.025, 0.025, "dot"), E(-0.03, -0.3, 0.022, 0.022, "dot"),
    E(0.06, -0.4, 0.018, 0.018, "dot"), E(0.13, -0.07, 0.022, 0.022, "dot"),
    E(0, -0.6, 0.05, 0.05, "pom", { stroke: "pomEdge", w: 0.015 }) ] },

  /* New Year, led but under goal */
  partyStripe: { pal: { red: FIX("#e8505b"), blue: FIX("#4f8fd9"), green: FIX("#4aa86b"), yellow: FIX("#f7d038"), edge: FIX("#2f3a4a") }, shapes: [
    S("M 0 -0.56 Q -0.12 -0.66 -0.06 -0.74", "red", 0.03), S("M 0 -0.56 Q 0.1 -0.68 0.16 -0.62", "blue", 0.03),
    S("M 0 -0.56 Q 0.02 -0.7 0.08 -0.76", "green", 0.03),
    P("M -0.23 0 L 0.23 0 L 0.1807 -0.12 L -0.1807 -0.12 Z", "red"), P("M -0.1807 -0.12 L 0.1807 -0.12 L 0.1314 -0.24 L -0.1314 -0.24 Z", "blue"), P("M -0.1314 -0.24 L 0.1314 -0.24 L 0.0821 -0.36 L -0.0821 -0.36 Z", "green"), P("M -0.0821 -0.36 L 0.0821 -0.36 L 0.0329 -0.48 L -0.0329 -0.48 Z", "yellow"),
    P("M -0.23 0 L 0 -0.56 L 0.23 0 Z", null, "edge", 0.022),
    E(0, -0.57, 0.04, 0.04, "yellow") ] },

  /* National Hydration Day, goal met: a crown of water drops */
  dropCrown: { pal: { water: FIX("#5fb8f2"), light: FIX("#b8e6fd"), edge: FIX("#1f7fc0"), shine: FIX("#ffffff") }, shapes: [
    P("M -0.27 -0.08 L -0.29 -0.26 Q -0.2 -0.16 -0.14 -0.2 Q -0.07 -0.26 0 -0.3 Q 0.07 -0.26 0.14 -0.2 Q 0.2 -0.16 0.29 -0.26 L 0.27 -0.08 Z", "light", "edge", 0.03),
    P("M -0.29 -0.491 Q -0.2075 -0.392 -0.2185 -0.337 Q -0.2295 -0.2765 -0.29 -0.2765 Q -0.3505 -0.2765 -0.3615 -0.337 Q -0.3725 -0.392 -0.29 -0.491 Z", "water", "edge", 0.02), P("M 0 -0.594 Q 0.105 -0.468 0.091 -0.398 Q 0.077 -0.321 0 -0.321 Q -0.077 -0.321 -0.091 -0.398 Q -0.105 -0.468 0 -0.594 Z", "water", "edge", 0.02), P("M 0.29 -0.491 Q 0.3725 -0.392 0.3615 -0.337 Q 0.3505 -0.2765 0.29 -0.2765 Q 0.2295 -0.2765 0.2185 -0.337 Q 0.2075 -0.392 0.29 -0.491 Z", "water", "edge", 0.02),
    E(-0.03, -0.46, 0.018, 0.035, "shine", { rot: 0.3 }), E(-0.31, -0.39, 0.014, 0.028, "shine", { rot: 0.3 }), E(0.27, -0.39, 0.014, 0.028, "shine", { rot: 0.3 }),
    P("M -0.28 -0.11 L 0.28 -0.11 L 0.28 0 L -0.28 0 Z", "water", "edge", 0.03),
    S("M -0.24 -0.055 Q -0.18 -0.085 -0.12 -0.055 Q -0.06 -0.025 0 -0.055 Q 0.06 -0.085 0.12 -0.055 Q 0.18 -0.025 0.24 -0.055", "shine", 0.018) ] },

  /* National Hydration Day, led but under goal: three curls of splash with drop bells */
  splashHat: { pal: { deep: FIX("#1f7fc0"), mid: FIX("#2f9be6"), pale: FIX("#5fd0ff"), drop: FIX("#d9f3ff"), rim: FIX("#1f7fc0"), band: FIX("#8fd3f7") }, shapes: [
    S("M -0.016 -0.02 Q -0.032 -0.39 0.135 -0.41", "mid", 0.14), S("M -0.05 -0.02 Q -0.29 -0.34 -0.334 -0.22", "deep", 0.14), S("M 0.05 -0.02 Q 0.29 -0.34 0.334 -0.22", "pale", 0.14),
    P("M 0.135 -0.5324 Q 0.198 -0.4568 0.1896 -0.4148 Q 0.1812 -0.3686 0.135 -0.3686 Q 0.0888 -0.3686 0.0804 -0.4148 Q 0.072 -0.4568 0.135 -0.5324 Z", "drop", "rim", 0.02), P("M -0.334 -0.3424 Q -0.271 -0.2668 -0.2794 -0.2248 Q -0.2878 -0.1786 -0.334 -0.1786 Q -0.3802 -0.1786 -0.3886 -0.2248 Q -0.397 -0.2668 -0.334 -0.3424 Z", "drop", "rim", 0.02), P("M 0.334 -0.3424 Q 0.397 -0.2668 0.3886 -0.2248 Q 0.3802 -0.1786 0.334 -0.1786 Q 0.2878 -0.1786 0.2794 -0.2248 Q 0.271 -0.2668 0.334 -0.3424 Z", "drop", "rim", 0.02),
    P("M -0.29 -0.1 L 0.29 -0.1 Q 0.31 -0.05 0.29 0 L -0.29 0 Q -0.31 -0.05 -0.29 -0.1 Z", "band", "rim", 0.025),
    S("M -0.24 -0.05 Q -0.18 -0.08 -0.12 -0.05 Q -0.06 -0.02 0 -0.05 Q 0.06 -0.08 0.12 -0.05 Q 0.18 -0.02 0.24 -0.05", "deep", 0.016) ] }
};
