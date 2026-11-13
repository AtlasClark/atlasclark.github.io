/* Built-in drawings of the hats and props, in the Pet Studio's shape format (see
   petdefs.js), so each can be redrawn there and reset to these.
   crown, jester: units of r, origin at the pet's crown spot (the hat's bottom centre).
   grave: units of r, origin at the ground under the headstone; colours may follow the
          drowned pet's hue.
   coin:  one token seen face on, 1 unit across, origin at its centre. The bank's gold
          pile squashes it into a heap; the page's small coin icons use it as is.
   Holiday hats (santa, elf, witch, pumpkin, partyGold, partyStripe): drawn like the crown
          and jester, which they replace around their holiday (config HOLIDAY_HATS).
   medal: the day-win medal, units of r, origin at the disc's centre (the pet's medal spot).
   Personal hats (PERSONAL_ART, config PERSONAL_HATS): drawn like the crown; pets face
          left, so the back of a hat is on the right. */

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

export const PERSONAL_ART = {
  /* A felt fedora (pinched crown, dark band, a feather) with a sun flap buttoned to the
     back of the brim, the way a safari hat keeps the neck out of the sun. */
  fedora: { pal: { felt: FIX("#b98f5a"), light: FIX("#d1ab74"), shade: FIX("#96703f"), edge: FIX("#5c4426"), band: FIX("#3e2c1b"),
                   flap: FIX("#e0cb9c"), fold: FIX("#bfa574"), feather: FIX("#2f9e8f"), quill: FIX("#f3ead2"), stud: FIX("#f2c94c") }, shapes: [
    /* the flap: hangs from the back half of the brim, a little wavy at the hem */
    P("M 0.02 -0.03 L 0.37 -0.035 C 0.41 0.06 0.43 0.17 0.4 0.27 Q 0.33 0.32 0.27 0.27 Q 0.2 0.33 0.13 0.27 Q 0.08 0.31 0.04 0.25 C 0.05 0.15 0.04 0.06 0.02 -0.03 Z", "flap", "edge", 0.022),
    S("M 0.15 0 Q 0.17 0.13 0.14 0.24", "fold", 0.02),
    S("M 0.28 0 Q 0.31 0.12 0.3 0.24", "fold", 0.02),
    /* the brim: wide, dipped a touch at the front */
    E(0, -0.035, 0.41, 0.075, "felt", { stroke: "edge", w: 0.026, rot: -0.05 }),
    E(-0.03, -0.05, 0.3, 0.035, "light", { rot: -0.05 }),
    /* the crown: front pinch, a dent along the top */
    P("M -0.205 -0.06 C -0.23 -0.2 -0.21 -0.35 -0.11 -0.385 Q -0.03 -0.4 0.01 -0.33 Q 0.06 -0.41 0.13 -0.385 C 0.22 -0.35 0.225 -0.2 0.205 -0.06 Q 0 -0.01 -0.205 -0.06 Z", "felt", "edge", 0.026),
    P("M -0.14 -0.33 Q -0.17 -0.24 -0.165 -0.16 L -0.12 -0.155 Q -0.115 -0.26 -0.09 -0.345 Z", "light"),
    S("M 0.01 -0.325 Q 0.035 -0.25 0.015 -0.17", "shade", 0.028),
    P("M 0.12 -0.36 C 0.19 -0.33 0.2 -0.22 0.19 -0.15 L 0.145 -0.15 C 0.16 -0.23 0.15 -0.3 0.12 -0.36 Z", "shade"),
    /* the band, and a feather tucked in at the back */
    P("M -0.212 -0.145 Q 0 -0.095 0.212 -0.145 L 0.205 -0.06 Q 0 -0.01 -0.205 -0.06 Z", "band"),
    P("M 0.13 -0.1 C 0.14 -0.24 0.2 -0.36 0.3 -0.42 C 0.3 -0.3 0.25 -0.17 0.17 -0.09 Z", "feather", "edge", 0.016),
    S("M 0.15 -0.1 Q 0.2 -0.27 0.29 -0.4", "quill", 0.014),
    /* two brass studs hold the flap on */
    E(0.12, -0.012, 0.02, 0.02, "stud", { stroke: "edge", w: 0.012 }),
    E(0.31, -0.022, 0.02, 0.02, "stud", { stroke: "edge", w: 0.012 }) ] },
  /* The classic dunce cap: a tall paper cone, DUNCE down the front in black, a little
     crumpled at the tip from being worn so often. */
  dunce: { pal: { paper: FIX("#f6f2e6"), shade: FIX("#d9d2bf"), edge: FIX("#4a4438"), ink: FIX("#1d1b17") }, shapes: [
    E(0, 0, 0.27, 0.05, "shade", { stroke: "edge", w: 0.022 }),
    P("M -0.265 -0.005 L -0.005 -0.88 Q 0.01 -0.93 0.04 -0.9 Q 0.025 -0.885 0.03 -0.86 L 0.265 -0.005 Q 0 0.06 -0.265 -0.005 Z", "paper", "edge", 0.024),
    P("M 0.08 -0.7 L 0.265 -0.005 Q 0.2 0.02 0.13 0.03 Q 0.12 -0.33 0.08 -0.7 Z", "shade"),
    S("M -0.18 -0.31 L -0.14 -0.45", "shade", 0.016),
    S("M -0.035 -0.598 L -0.035 -0.513 Q 0.047 -0.513 0.035 -0.555 Q 0.047 -0.598 -0.035 -0.598", "ink", 0.021),
    S("M -0.035 -0.488 L -0.035 -0.433 Q -0.035 -0.403 0 -0.403 Q 0.035 -0.403 0.035 -0.433 L 0.035 -0.488", "ink", 0.021),
    S("M -0.035 -0.293 L -0.035 -0.378 L 0.035 -0.293 L 0.035 -0.378", "ink", 0.021),
    S("M 0.035 -0.256 Q 0.015 -0.268 0 -0.268 Q -0.035 -0.268 -0.035 -0.225 Q -0.035 -0.183 0 -0.183 Q 0.015 -0.183 0.035 -0.195", "ink", 0.021),
    S("M 0.035 -0.158 L -0.035 -0.158 L -0.035 -0.073 L 0.035 -0.073 M -0.035 -0.115 L 0.023 -0.115", "ink", 0.021),
    S("M -0.255 -0.02 Q 0 0.04 0.255 -0.02", "edge", 0.018) ] }
};

/* ---- the Hat shop (rev 1.50.0) ----------------------------------------------------
   Keyed "hat:<key>" like their cosmetics (cosmetics.js ITEMS slot "hat"). Drawn like the
   crown: units of r, origin at the pet's crown spot, pets face left (the back of a hat is
   on the right). Shapes sharing a group `g` named in HAT_MOTION move together (art.js
   moveHatPart); everything else stays still. */
const rnd4 = v => Math.round(v * 1e4) / 1e4;
const G = (g, ...shapes) => shapes.map(s => Object.assign(s, { g }));
/* Five petals and a middle, all in group g. */
function flower(cx, cy, s, petal, mid, g) {
  const out = [];
  for (let i = 0; i < 5; i++) {
    const a = i * 1.2566 - 1.5708;
    out.push(E(rnd4(cx + Math.cos(a) * s * 0.55), rnd4(cy + Math.sin(a) * s * 0.55), rnd4(s * 0.42), rnd4(s * 0.26), petal, { rot: rnd4(a), stroke: "edge", w: 0.01 }));
  }
  out.push(E(cx, cy, rnd4(s * 0.28), rnd4(s * 0.28), mid));
  return G(g, ...out);
}
/* A four-point twinkle, s from its middle to a point. */
const star4 = (cx, cy, s) => {
  const k = s * 0.18, f = v => rnd4(v);
  return "M " + f(cx) + " " + f(cy - s) + " Q " + f(cx + k) + " " + f(cy - k) + " " + f(cx + s) + " " + f(cy) +
         " Q " + f(cx + k) + " " + f(cy + k) + " " + f(cx) + " " + f(cy + s) + " Q " + f(cx - k) + " " + f(cy + k) + " " + f(cx - s) + " " + f(cy) +
         " Q " + f(cx - k) + " " + f(cy - k) + " " + f(cx) + " " + f(cy - s) + " Z";
};
/* A five-point star badge. */
const star5 = (cx, cy, s) => {
  const pts = [];
  for (let i = 0; i < 10; i++) { const a = -1.5708 + i * 0.6283, d = i % 2 ? s * 0.45 : s; pts.push(rnd4(cx + Math.cos(a) * d) + " " + rnd4(cy + Math.sin(a) * d)); }
  return "M " + pts.join(" L ") + " Z";
};

export const SHOP_HAT_ART = {
  /* Propeller beanie: the blades turn (seen from the side, they flip). */
  "hat:beanie": { pal: { red: FIX("#e04a3f"), blue: FIX("#3f7fe0"), yellow: FIX("#f7c843"), green: FIX("#3fae6a"), edge: FIX("#2b2b33"),
                         stem: FIX("#8a8f99"), hub: FIX("#f7c843") }, shapes: [
    P("M -0.42 0.035 Q -0.36 -0.01 -0.18 -0.02 L -0.12 0.02 Q -0.3 0.06 -0.42 0.035 Z", "green", "edge", 0.02),
    P("M -0.26 0.005 Q -0.27 -0.3 0 -0.31 Q 0.27 -0.3 0.26 0.005 Q 0 -0.03 -0.26 0.005 Z", "red", "edge", 0.024),
    P("M -0.01 -0.305 Q -0.1 -0.16 -0.09 -0.015 Q 0 -0.025 0.09 -0.015 Q 0.1 -0.16 0.01 -0.305 Z", "yellow"),
    P("M -0.2 -0.2 Q -0.24 -0.11 -0.245 0 Q -0.2 -0.006 -0.17 -0.008 Q -0.18 -0.12 -0.15 -0.23 Z", "blue"),
    P("M 0.2 -0.2 Q 0.24 -0.11 0.245 0 Q 0.2 -0.006 0.17 -0.008 Q 0.18 -0.12 0.15 -0.23 Z", "blue"),
    S("M 0 -0.31 L 0 -0.4", "stem", 0.035),
    ...G("prop", E(-0.13, -0.41, 0.13, 0.032, "red", { stroke: "edge", w: 0.016 }), E(0.13, -0.41, 0.13, 0.032, "blue", { stroke: "edge", w: 0.016 })),
    E(0, -0.41, 0.035, 0.03, "hub", { stroke: "edge", w: 0.014 }) ] },

  "hat:cowboy": { pal: { felt: FIX("#a8743f"), dark: FIX("#7a5228"), band: FIX("#3b2a1a"), edge: FIX("#4a3018"), star: FIX("#f2c94c") }, shapes: [
    P("M -0.46 -0.1 Q -0.43 0 -0.2 0.03 Q 0 0.05 0.2 0.03 Q 0.43 0 0.46 -0.1 Q 0.4 -0.06 0.24 -0.06 L -0.24 -0.06 Q -0.4 -0.06 -0.46 -0.1 Z", "felt", "edge", 0.024),
    P("M -0.2 -0.05 C -0.23 -0.2 -0.21 -0.33 -0.12 -0.35 Q -0.05 -0.36 0 -0.3 Q 0.05 -0.36 0.12 -0.35 C 0.21 -0.33 0.23 -0.2 0.2 -0.05 Q 0 -0.02 -0.2 -0.05 Z", "felt", "edge", 0.024),
    S("M 0 -0.3 Q 0.02 -0.22 0 -0.16", "dark", 0.024),
    P("M -0.205 -0.13 Q 0 -0.1 0.205 -0.13 L 0.2 -0.05 Q 0 -0.02 -0.2 -0.05 Z", "band"),
    P(star5(-0.12, -0.09, 0.036), "star", "edge", 0.008) ] },

  "hat:viking": { pal: { steel: FIX("#a9b4bf"), shade: FIX("#7e8a96"), edge: FIX("#3f4954"), horn: FIX("#f1e6c8"), hornEdge: FIX("#9c8a62"),
                         band: FIX("#c9a24a"), rivet: FIX("#f3ead2") }, shapes: [
    P("M -0.2 -0.12 Q -0.38 -0.12 -0.43 -0.4 Q -0.32 -0.24 -0.2 -0.2 Z", "horn", "hornEdge", 0.02),
    P("M 0.2 -0.12 Q 0.38 -0.12 0.43 -0.4 Q 0.32 -0.24 0.2 -0.2 Z", "horn", "hornEdge", 0.02),
    P("M -0.25 0 Q -0.26 -0.33 0 -0.34 Q 0.26 -0.33 0.25 0 Z", "steel", "edge", 0.024),
    P("M 0.08 -0.32 Q 0.22 -0.28 0.235 -0.01 L 0.14 -0.01 Q 0.14 -0.2 0.08 -0.32 Z", "shade"),
    S("M 0 -0.335 L 0 -0.05", "band", 0.04),
    P("M -0.255 -0.06 L 0.255 -0.06 L 0.25 0.01 L -0.25 0.01 Z", "band", "edge", 0.016),
    E(-0.18, -0.025, 0.015, 0.015, "rivet"), E(-0.09, -0.025, 0.015, 0.015, "rivet"), E(0.09, -0.025, 0.015, 0.015, "rivet"), E(0.18, -0.025, 0.015, 0.015, "rivet") ] },

  "hat:chef": { pal: { white: FIX("#fbfbf8"), shade: FIX("#dfe3e8"), edge: FIX("#8b96a3") }, shapes: [
    E(-0.15, -0.27, 0.13, 0.12, "white", { stroke: "edge", w: 0.02 }),
    E(0.15, -0.27, 0.13, 0.12, "white", { stroke: "edge", w: 0.02 }),
    E(0, -0.35, 0.16, 0.14, "white", { stroke: "edge", w: 0.02 }),
    S("M 0.06 -0.4 Q 0.12 -0.36 0.11 -0.3", "shade", 0.02),
    P("M -0.19 -0.17 L 0.19 -0.17 L 0.2 0 L -0.2 0 Z", "white", "edge", 0.02),
    S("M -0.1 -0.155 L -0.1 -0.015", "shade", 0.018), S("M 0 -0.155 L 0 -0.015", "shade", 0.018), S("M 0.1 -0.155 L 0.1 -0.015", "shade", 0.018) ] },

  "hat:captain": { pal: { white: FIX("#f7f8fa"), shade: FIX("#d5dbe2"), navy: FIX("#1f2f4f"), visor: FIX("#14161b"), gold: FIX("#e8b931"), edge: FIX("#3a4250") }, shapes: [
    P("M -0.23 -0.11 Q -0.33 -0.2 -0.2 -0.27 Q 0 -0.31 0.2 -0.26 Q 0.32 -0.21 0.23 -0.11 Z", "white", "edge", 0.022),
    P("M 0.1 -0.28 Q 0.3 -0.23 0.225 -0.115 L 0.12 -0.115 Q 0.18 -0.2 0.1 -0.28 Z", "shade"),
    P("M -0.23 -0.12 L 0.23 -0.12 L 0.22 0 L -0.22 0 Z", "navy", "edge", 0.02),
    S("M -0.22 -0.105 L 0.22 -0.105", "gold", 0.02),
    P("M -0.21 -0.015 Q -0.36 0 -0.42 0.05 Q -0.3 0.07 -0.14 0.025 Z", "visor", "edge", 0.016),
    E(-0.07, -0.058, 0.045, 0.04, "gold", { stroke: "edge", w: 0.01 }),
    S("M -0.07 -0.085 L -0.07 -0.035 M -0.095 -0.055 Q -0.07 -0.025 -0.045 -0.055 M -0.085 -0.075 L -0.055 -0.075", "navy", 0.012) ] },

  /* A fishbowl: the fish swims back and forth, a bubble rises. */
  "hat:fishbowl": { pal: { glass: FIX("rgba(205,236,255,0.45)"), edge: FIX("#5f8fb3"), water: FIX("rgba(64,160,230,0.55)"), sand: FIX("#e8cf8f"),
                           fish: FIX("#f28a2e"), fin: FIX("#d9601c"), ink: FIX("#1d1b17"), shine: FIX("rgba(255,255,255,0.8)"), weed: FIX("#3fa35a"),
                           bub: FIX("rgba(255,255,255,0.9)") }, shapes: [
    E(0, -0.24, 0.25, 0.23, "glass"),
    E(0, -0.24, 0.235, 0.215, "water", { a0: -0.5, a1: 3.6416, chord: true }),
    P("M -0.17 -0.07 Q 0 -0.1 0.17 -0.07 Q 0.12 -0.025 0 -0.02 Q -0.12 -0.025 -0.17 -0.07 Z", "sand"),
    S("M 0.12 -0.07 Q 0.09 -0.13 0.12 -0.18 Q 0.15 -0.22 0.12 -0.26", "weed", 0.025),
    ...G("fish", E(-0.02, -0.21, 0.065, 0.042, "fish", { stroke: "fin", w: 0.012 }), P("M 0.035 -0.21 L 0.09 -0.25 L 0.08 -0.21 L 0.09 -0.17 Z", "fin"),
                 E(-0.05, -0.218, 0.011, 0.011, "ink")),
    ...G("bub", E(-0.1, -0.16, 0.014, 0.014, null, { stroke: "bub", w: 0.01 })),
    E(0, -0.24, 0.25, 0.23, null, { stroke: "edge", w: 0.022 }),
    E(0, -0.46, 0.12, 0.022, "glass", { stroke: "edge", w: 0.018 }),
    S("M -0.17 -0.36 Q -0.2 -0.3 -0.2 -0.24", "shine", 0.02) ] },

  /* A birthday cake with one candle; the flame flickers. */
  "hat:cake": { pal: { plate: FIX("#e9edf2"), edge: FIX("#7a5a52"), sponge: FIX("#f2b6c6"), icing: FIX("#fffaf2"), candle: FIX("#6fa8ff"),
                       stripe: FIX("#ffffff"), wick: FIX("#3b3330"), flame: FIX("#ff9a2e"), core: FIX("#ffe36b"),
                       s1: FIX("#e04a3f"), s2: FIX("#3fae6a"), s3: FIX("#3f7fe0"), s4: FIX("#f7c843") }, shapes: [
    E(0, -0.005, 0.25, 0.035, "plate", { stroke: "edge", w: 0.016 }),
    P("M -0.2 -0.17 L 0.2 -0.17 L 0.2 -0.02 Q 0 0.01 -0.2 -0.02 Z", "sponge", "edge", 0.02),
    P("M -0.21 -0.185 L 0.21 -0.185 L 0.21 -0.12 Q 0.185 -0.08 0.16 -0.12 Q 0.13 -0.07 0.1 -0.12 Q 0.07 -0.09 0.04 -0.12 Q 0.01 -0.065 -0.02 -0.12 " +
      "Q -0.05 -0.09 -0.08 -0.12 Q -0.11 -0.07 -0.14 -0.12 Q -0.17 -0.085 -0.21 -0.12 Z", "icing", "edge", 0.014),
    S("M -0.15 -0.155 L -0.12 -0.145", "s1", 0.016), S("M -0.06 -0.16 L -0.05 -0.135", "s2", 0.016), S("M 0.07 -0.15 L 0.1 -0.16", "s3", 0.016),
    S("M 0.14 -0.14 L 0.16 -0.155", "s4", 0.016), S("M 0.04 -0.135 L 0.05 -0.16", "s1", 0.016),
    P("M -0.025 -0.34 L 0.025 -0.34 L 0.025 -0.18 L -0.025 -0.18 Z", "candle", "edge", 0.012),
    S("M -0.025 -0.3 L 0.025 -0.325 M -0.025 -0.245 L 0.025 -0.27 M -0.025 -0.19 L 0.025 -0.215", "stripe", 0.014),
    S("M 0 -0.34 L 0 -0.37", "wick", 0.012),
    ...G("flame", P("M 0 -0.47 Q 0.05 -0.41 0.032 -0.375 Q 0 -0.345 -0.032 -0.375 Q -0.05 -0.41 0 -0.47 Z", "flame"), E(0, -0.388, 0.014, 0.024, "core")) ] },

  /* Head boppers: two balls on springs, wobbling out of step. */
  "hat:boppers": { pal: { band: FIX("#8a4fd1"), edge: FIX("#3b2a55"), spring: FIX("#b9c1cc"), a: FIX("#ff5fa2"), b: FIX("#4fd1c5"),
                          shine: FIX("rgba(255,255,255,0.85)") }, shapes: [
    ...G("bopL", S("M -0.11 -0.07 L -0.14 -0.12 L -0.09 -0.17 L -0.15 -0.22 L -0.1 -0.27 L -0.14 -0.31", "spring", 0.018),
                 E(-0.15, -0.36, 0.065, 0.065, "a", { stroke: "edge", w: 0.016 }), E(-0.17, -0.38, 0.018, 0.014, "shine")),
    ...G("bopR", S("M 0.11 -0.07 L 0.14 -0.12 L 0.09 -0.17 L 0.15 -0.22 L 0.1 -0.27 L 0.14 -0.31", "spring", 0.018),
                 E(0.15, -0.36, 0.065, 0.065, "b", { stroke: "edge", w: 0.016 }), E(0.13, -0.38, 0.018, 0.014, "shine")),
    S("M -0.25 0.02 Q 0 -0.13 0.25 0.02", "band", 0.05) ] },

  /* A rubber swim cap with flowers that turn gently. */
  "hat:swimcap": { pal: { cap: FIX("#44c3d6"), ridge: FIX("#2fa2b5"), edge: FIX("#1f6f7c"), p1: FIX("#ff7fb0"), p2: FIX("#ffd166"),
                          p3: FIX("#ffffff"), mid: FIX("#f6a23c") }, shapes: [
    P("M -0.27 0.025 Q -0.29 -0.3 0 -0.31 Q 0.29 -0.3 0.27 0.025 Q 0 -0.02 -0.27 0.025 Z", "cap", "edge", 0.022),
    S("M -0.2 -0.04 Q -0.22 -0.2 -0.12 -0.27", "ridge", 0.016), S("M 0.2 -0.04 Q 0.22 -0.2 0.12 -0.27", "ridge", 0.016),
    S("M -0.26 0 Q 0 -0.045 0.26 0", "ridge", 0.02),
    ...flower(-0.11, -0.22, 0.09, "p1", "mid", "f1"),
    ...flower(0.1, -0.15, 0.075, "p2", "mid", "f2"),
    ...flower(0.03, -0.3, 0.065, "p3", "mid", "f3") ] },

  /* A wizard hat; its stars twinkle. */
  "hat:wizard": { pal: { hat: FIX("#2c3e8f"), deep: FIX("#1d2a63"), edge: FIX("#a9b8ff"), star: FIX("#ffe066"), moon: FIX("#fff3b0") }, shapes: [
    E(0, -0.03, 0.38, 0.07, "deep", { stroke: "edge", w: 0.02 }),
    P("M -0.22 -0.05 L -0.05 -0.48 Q 0 -0.62 0.15 -0.62 Q 0.06 -0.54 0.06 -0.44 L 0.22 -0.05 Q 0 -0.01 -0.22 -0.05 Z", "hat", "edge", 0.022),
    P("M -0.1 -0.24 Q -0.17 -0.19 -0.13 -0.12 Q -0.08 -0.08 -0.03 -0.11 Q -0.09 -0.12 -0.1 -0.17 Q -0.105 -0.21 -0.1 -0.24 Z", "moon"),
    ...G("tw1", P(star4(0.08, -0.2, 0.045), "star")),
    ...G("tw2", P(star4(-0.01, -0.37, 0.035), "star")),
    ...G("tw3", P(star4(0.2, -0.47, 0.03), "star")) ] },

  /* A rubber duck, bobbing along on top. */
  "hat:duck": { pal: { duck: FIX("#ffd23f"), shade: FIX("#f0b51f"), edge: FIX("#9c6b12"), beak: FIX("#ff8a1f"), ink: FIX("#1d1b17"),
                       shine: FIX("#fff6c2") }, shapes: G("duck",
    P("M 0.19 -0.14 Q 0.3 -0.24 0.27 -0.1 Q 0.24 -0.04 0.18 -0.06 Z", "duck", "edge", 0.018),
    E(0.03, -0.11, 0.2, 0.11, "duck", { stroke: "edge", w: 0.02 }),
    S("M -0.02 -0.13 Q 0.07 -0.07 0.14 -0.14", "shade", 0.022),
    E(-0.12, -0.27, 0.1, 0.095, "duck", { stroke: "edge", w: 0.02 }),
    P("M -0.205 -0.28 Q -0.29 -0.285 -0.295 -0.25 Q -0.25 -0.225 -0.195 -0.245 Z", "beak", "edge", 0.014),
    E(-0.145, -0.295, 0.017, 0.02, "ink"),
    E(-0.09, -0.32, 0.03, 0.02, "shine")) },

  /* A mortarboard; the tassel swings. */
  "hat:grad": { pal: { black: FIX("#22252b"), top: FIX("#2f333b"), edge: FIX("#0f1114"), shine: FIX("#4a505b"), gold: FIX("#e8b931"),
                       goldDeep: FIX("#b98a14") }, shapes: [
    P("M -0.19 0 Q -0.21 -0.12 -0.18 -0.17 L 0.18 -0.17 Q 0.21 -0.12 0.19 0 Q 0 -0.05 -0.19 0 Z", "black", "edge", 0.018),
    P("M -0.38 -0.2 L 0 -0.28 L 0.38 -0.2 L 0 -0.12 Z", "top", "edge", 0.018),
    S("M -0.3 -0.205 L 0 -0.265", "shine", 0.014),
    S("M 0 -0.2 L 0.29 -0.185", "gold", 0.016),
    E(0, -0.2, 0.026, 0.016, "gold", { stroke: "goldDeep", w: 0.008 }),
    ...G("tassel", S("M 0.29 -0.185 L 0.29 -0.07", "gold", 0.016), P("M 0.27 -0.08 L 0.31 -0.08 L 0.33 0 L 0.25 0 Z", "gold", "goldDeep", 0.01)) ] }
};

/* How the moving parts move: group -> { type, at: pivot [x, y] in r, hz, amp, ph }.
   flip = turns about a vertical axis; sway = rocks about the pivot; bob = rises and
   settles; flicker = a flame; swim = back and forth, facing the way it goes; rise = a
   bubble going up and fading; twinkle = grows and fades. */
export const HAT_MOTION = {
  "hat:beanie": { prop: { type: "flip", at: [0, -0.41], hz: 2.2 } },
  "hat:fishbowl": { fish: { type: "swim", at: [-0.02, -0.21], hz: 0.22, amp: 0.08 }, bub: { type: "rise", at: [-0.1, -0.16], hz: 0.45, amp: 0.16 } },
  "hat:cake": { flame: { type: "flicker", at: [0, -0.37], hz: 1.6, amp: 0.12 } },
  "hat:boppers": { bopL: { type: "sway", at: [-0.11, -0.07], hz: 1.3, amp: 0.3 }, bopR: { type: "sway", at: [0.11, -0.07], hz: 1.3, amp: 0.3, ph: 1.9 } },
  "hat:swimcap": { f1: { type: "sway", at: [-0.11, -0.22], hz: 0.35, amp: 0.4 }, f2: { type: "sway", at: [0.1, -0.15], hz: 0.45, amp: 0.4, ph: 2 },
                   f3: { type: "sway", at: [0.03, -0.3], hz: 0.4, amp: 0.4, ph: 4 } },
  "hat:wizard": { tw1: { type: "twinkle", at: [0.08, -0.2], hz: 0.7 }, tw2: { type: "twinkle", at: [-0.01, -0.37], hz: 0.9, ph: 2.1 },
                  tw3: { type: "twinkle", at: [0.2, -0.47], hz: 0.8, ph: 4.2 } },
  "hat:duck": { duck: { type: "bob", at: [0.03, 0], hz: 0.75, amp: 0.03, tilt: 0.07 } },
  "hat:grad": { tassel: { type: "sway", at: [0.29, -0.185], hz: 0.8, amp: 0.25 } }
};
