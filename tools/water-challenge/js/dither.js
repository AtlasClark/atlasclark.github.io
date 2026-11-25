/* Dithered water for the Dither theme (rev 1.53.0): the water keeps its colour, and in
   place of the smooth depth gradient it gets bands of an ordered (4 x 4 Bayer) dot
   pattern, sparse near the surface and denser toward the floor. ui.js turns it on and
   off with the theme; glass.js and the Style shop's fitting room draw it. */

export const waterDither = { on: false };
export function setWaterDither(on) { waterDither.on = !!on; }

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const CELL = 2;                                         /* one dot = 2 x 2 canvas units */
const tiles = new Map();
/* An 8 x 8 tile: dots of colour where the Bayer value is under level (of 16). */
function tile(level, color) {
  const key = level + "|" + color;
  let c = tiles.get(key);
  if (c) return c;
  c = document.createElement("canvas"); c.width = c.height = 4 * CELL;
  const g = c.getContext("2d");
  g.fillStyle = color;
  for (let i = 0; i < 16; i++) if (BAYER[i] < level) g.fillRect((i % 4) * CELL, Math.floor(i / 4) * CELL, CELL, CELL);
  tiles.set(key, c);
  return c;
}
const patterns = new WeakMap();
function pattern(ctx, level, color) {
  let m = patterns.get(ctx);
  if (!m) patterns.set(ctx, m = new Map());
  const key = level + "|" + color;
  if (!m.has(key)) m.set(key, ctx.createPattern(tile(level, color), "repeat"));
  return m.get(key);
}

const SHADE = "rgba(4,22,46,0.5)", LIGHT = "rgba(255,255,255,0.42)";
/* Over the water already clipped by the caller: x0..x1 wide, surface top to bottom. */
export function ditherWater(ctx, x0, x1, top, bottom) {
  const span = Math.max(1, bottom - top), bands = [[0.00, 3, LIGHT], [0.12, 2, SHADE], [0.36, 4, SHADE], [0.6, 6, SHADE], [0.82, 8, SHADE]];
  for (let i = 0; i < bands.length; i++) {
    const [from, level, color] = bands[i], to = i + 1 < bands.length ? bands[i + 1][0] : 1.01;
    const y0 = Math.floor(top + from * span), y1 = Math.ceil(top + to * span);
    ctx.fillStyle = pattern(ctx, level, color);
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  }
}
