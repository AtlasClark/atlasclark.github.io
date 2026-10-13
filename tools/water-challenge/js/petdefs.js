/* Drawn pets. pets/pets.json holds the pets redrawn in the Pet Studio
   (.dev/pet-studio, local only); a pet not in it keeps its built-in drawing in art.js.

   A pet:   { name?, crown: [x, y], pal: { key: colour }, swim: [shape], portrait?: [shape] }
   Units are the pet's size r. Origin is the waterline anchor, y grows down, the pet
   faces left. "portrait" is the full-body Pets-tab icon; without it, swim is used.
   Colour:  { hue: 1, dh, s, l, a? }  the pet's own hue shifted by dh (colourable)
            { c: "#rrggbb" | "rgba(...)" }  fixed
   Shapes:  { t: "ell", x, y, rx, ry, rot, a0, a1, chord? }   ellipse or arc
            { t: "path", d: [["M",x,y], ["L",x,y], ["Q",cx,cy,x,y], ["C",x1,y1,x2,y2,x,y], ["Z"]] }
            { t: "eye", x, y, s? }   a dot, or an X when the pet is dead
   ell/path also carry fill?, stroke?, w (stroke width), cap? ("round"),
   show? ("alive" | "dead"; absent = always). */

import * as C from "./config.js";

export const PET_DEFS_FORMAT = 1;
export const defs = {};            /* kind -> pet, only the redrawn ones */
export const EYE_INK = "#2a2118";

const SHAPES = { ell: 1, path: 1, eye: 1 };
const CMDS = { M: 2, L: 2, Q: 4, C: 6, Z: 0 };
const fin = v => typeof v === "number" && isFinite(v);

function cleanColour(c) {
  if (!c || typeof c !== "object") return null;
  if (c.hue) return fin(c.s) && fin(c.l) ? { hue: 1, dh: fin(c.dh) ? c.dh : 0, s: c.s, l: c.l, a: fin(c.a) ? c.a : 1 } : null;
  return typeof c.c === "string" && /^(#[0-9a-f]{3,8}|rgba?\([\d.,\s%]+\))$/i.test(c.c) ? { c: c.c } : null;
}

function cleanShape(s, pal) {
  if (!s || !SHAPES[s.t]) return null;
  if (s.t === "eye") return fin(s.x) && fin(s.y) ? { t: "eye", x: s.x, y: s.y, s: fin(s.s) ? s.s : 1, show: s.show } : null;
  if (s.fill && !pal[s.fill]) return null;
  if (s.stroke && !pal[s.stroke]) return null;
  if (s.t === "ell" && ![s.x, s.y, s.rx, s.ry].every(fin)) return null;
  if (s.t === "path") {
    if (!Array.isArray(s.d) || !s.d.length) return null;
    for (const c of s.d) if (!Array.isArray(c) || !(c[0] in CMDS) || c.length !== CMDS[c[0]] + 1 || !c.slice(1).every(fin)) return null;
  }
  return s;
}

/* Checks a pets.json object and puts its pets in defs. Bad shapes are dropped and
   a pet with nothing left is ignored, so a broken file can never stop the page.
   Returns the kinds taken. */
export function applyDefs(obj) {
  for (const k of Object.keys(defs)) delete defs[k];
  C.PET_NAMES.splice(0, C.PET_NAMES.length, ...C.PET_BASE_NAMES);
  const took = [];
  if (!obj || typeof obj.pets !== "object" || Number(obj.format) > PET_DEFS_FORMAT) return took;
  for (const [key, p] of Object.entries(obj.pets)) {
    const k = Number(key);
    if (!Number.isInteger(k) || k < 0 || k >= C.PET_MAX || !p || typeof p !== "object") continue;
    const pal = {};
    for (const [n, c] of Object.entries(p.pal || {})) { const v = cleanColour(c); if (v) pal[n] = v; }
    const swim = (Array.isArray(p.swim) ? p.swim : []).map(s => cleanShape(s, pal)).filter(Boolean);
    if (!swim.length) continue;
    const portrait = Array.isArray(p.portrait) ? p.portrait.map(s => cleanShape(s, pal)).filter(Boolean) : null;
    const crown = Array.isArray(p.crown) && p.crown.length === 2 && p.crown.every(fin) ? p.crown : [0, -1];
    defs[k] = { pal, swim, portrait: portrait && portrait.length ? portrait : null, crown };
    if (typeof p.name === "string" && p.name.trim()) C.PET_NAMES[k] = p.name.trim().slice(0, 24);
    took.push(k);
  }
  return took;
}

/* Fetched past the cache each load (a 304 when unchanged), so a pet redrawn and
   pushed shows on the next load without a REV bump. */
export async function loadPetDefs(url = "pets/pets.json") {
  try {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) return [];
    return applyDefs(await res.json());
  } catch { return []; }
}

export function colourOf(pal, key, hue) {
  const c = pal[key];
  if (!c) return "#ff00ff";
  if (!c.hue) return c.c;
  const h = (((hue + c.dh) % 360) + 360) % 360;
  return c.a < 1 ? "hsla(" + h + "," + c.s + "%," + c.l + "%," + c.a + ")" : "hsl(" + h + "," + c.s + "%," + c.l + "%)";
}

export function tracePath(ctx, s, r) {
  ctx.beginPath();
  if (s.t === "ell") {
    ctx.ellipse(s.x * r, s.y * r, Math.abs(s.rx * r), Math.abs(s.ry * r), s.rot || 0,
                fin(s.a0) ? s.a0 : 0, fin(s.a1) ? s.a1 : 6.2832);
    if (s.chord) ctx.closePath();
    return;
  }
  for (const c of s.d) {
    if (c[0] === "M") ctx.moveTo(c[1] * r, c[2] * r);
    else if (c[0] === "L") ctx.lineTo(c[1] * r, c[2] * r);
    else if (c[0] === "Q") ctx.quadraticCurveTo(c[1] * r, c[2] * r, c[3] * r, c[4] * r);
    else if (c[0] === "C") ctx.bezierCurveTo(c[1] * r, c[2] * r, c[3] * r, c[4] * r, c[5] * r, c[6] * r);
    else ctx.closePath();
  }
}

/* The same marks as critterEye in art.js. */
function drawEye(ctx, s, r, dead) {
  const x = s.x * r, y = s.y * r, k = s.s || 1;
  ctx.beginPath();
  if (dead) {
    const e = r * 0.11 * k;
    ctx.moveTo(x - e, y - e); ctx.lineTo(x + e, y + e);
    ctx.moveTo(x + e, y - e); ctx.lineTo(x - e, y + e);
    ctx.strokeStyle = EYE_INK;
    ctx.lineWidth = Math.max(1, r * 0.07 * k);
    ctx.stroke();
  } else {
    ctx.arc(x, y, r * 0.08 * k, 0, 6.2832);
    ctx.fillStyle = EYE_INK;
    ctx.fill();
  }
}

/* Draws shapes at the current origin. */
export function drawShapes(ctx, shapes, r, hue, pal, dead) {
  for (const s of shapes) {
    if (s.show === "alive" && dead) continue;
    if (s.show === "dead" && !dead) continue;
    if (s.t === "eye") { drawEye(ctx, s, r, dead); continue; }
    tracePath(ctx, s, r);
    if (s.fill) { ctx.fillStyle = colourOf(pal, s.fill, hue); ctx.fill(); }
    if (s.stroke) {
      ctx.strokeStyle = colourOf(pal, s.stroke, hue);
      ctx.lineWidth = Math.max(1, (s.w || 0.05) * r);
      ctx.lineCap = s.cap === "round" ? "round" : "butt";
      ctx.lineJoin = s.cap === "round" ? "round" : "miter";
      ctx.stroke();
      ctx.lineCap = "butt"; ctx.lineJoin = "miter";
    }
  }
}
