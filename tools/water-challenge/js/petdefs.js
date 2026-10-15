/* Drawn pets. Every pet starts from its built-in drawing (pen1art.js, pen2art.js);
   pets/pets.json holds the pets redrawn in the Pet Studio and replaces them.

   A pet:   { name?, crown: [x, y], pal: { key: colour }, swim: [shape], portrait?: [shape] }
   Units are the pet's size r. Origin is the waterline anchor, y grows down, the pet
   faces left. "portrait" is the full-body Pets-tab icon; without it, swim is used.
   Colour:  { hue: 1, dh, s, l, a? }  the pet's own hue shifted by dh (colourable)
            { c: "#rrggbb" | "rgba(...)" }  fixed
   Shapes:  { t: "ell", x, y, rx, ry, rot, a0, a1, chord? }   ellipse or arc
            { t: "path", d: [["M",x,y], ["L",x,y], ["Q",cx,cy,x,y], ["C",x1,y1,x2,y2,x,y], ["Z"]] }
            { t: "eye", x, y, s? }   a dot, or an X when the pet is dead
   ell/path also carry fill?, stroke?, w (stroke width), cap? ("round"),
   show? ("alive" | "dead"; absent = always).
   Hats:    "hats": { crown?: { pal, shapes }, jester?: { pal, shapes } }, in units of r with
   the origin where the pet's crown spot is (the hat's bottom centre). Fixed colours
   only. They replace the built-in crown and jester on pets and in the page's icons. */

import * as C from "./config.js";
import { PEN1_ART, EXTRA_ART } from "./pen1art.js";
import { PEN2_ART } from "./pen2art.js";

export const PET_DEFS_FORMAT = 1;
/* A pet may also carry range (0..1): its share of the normal swim range. */
export const defs = {};            /* kind -> pet, only the redrawn ones */
export const hats = {};            /* "crown" | "jester" -> { pal, shapes }, only the redrawn ones */
export const HAT_KEYS = ["crown", "jester"];
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

/* Every pet's built-in drawing (both pens, the Homunculus, the dragon) sits in defs
   from the start; pets.json can replace any of them. */
function seedPens() {
  const all = [...PEN1_ART.map((p, i) => [i, p]), ...PEN2_ART.map((p, i) => [C.PEN2_FIRST + i, p]),
               ...Object.entries(EXTRA_ART).map(([k, p]) => [Number(k), p])];
  for (const [k, p] of all) {
    const pal = {};
    for (const [n, c] of Object.entries(p.pal)) { const v = cleanColour(c); if (v) pal[n] = v; }
    const swim = p.swim.map(s => cleanShape(s, pal)).filter(Boolean);
    if (swim.length) defs[k] = { pal, swim, portrait: null, crown: p.crown, range: 1 };
  }
}

/* Checks a pets.json object and puts its pets in defs. Bad shapes are dropped and
   a pet with nothing left is ignored, so a broken file can never stop the page.
   Returns the kinds taken. */
export function applyDefs(obj) {
  for (const k of Object.keys(defs)) delete defs[k];
  for (const k of Object.keys(hats)) delete hats[k];
  C.PET_NAMES.splice(0, C.PET_NAMES.length, ...C.PET_BASE_NAMES);
  seedPens();
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
    const range = fin(p.range) ? Math.max(0, Math.min(1, p.range)) : 1;
    defs[k] = { pal, swim, portrait: portrait && portrait.length ? portrait : null, crown, range };
    if (typeof p.name === "string" && p.name.trim()) C.PET_NAMES[k] = p.name.trim().slice(0, 24);
    took.push(k);
  }
  for (const key of HAT_KEYS) {
    const h = obj.hats && obj.hats[key];
    if (!h || typeof h !== "object") continue;
    const pal = {};
    for (const [n, c] of Object.entries(h.pal || {})) { const v = cleanColour(c); if (v) pal[n] = v; }
    const shapes = (Array.isArray(h.shapes) ? h.shapes : []).map(s => cleanShape(s, pal)).filter(Boolean);
    if (shapes.length) { hats[key] = { pal, shapes }; took.push(key); }
  }
  return took;
}

/* Fetched past the cache each load (a 304 when unchanged), so a pet redrawn and
   pushed shows on the next load without a REV bump. */
export async function loadPetDefs(url = "pets/pets.json") {
  try {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) return [];
    siteObj = await res.json();
    return applyDefs(siteObj);
  } catch { return []; }
}

/* Where the art in use came from: "site" (pets/pets.json) or "folder" (the data
   folder's own file, which wins while it exists). */
let siteObj = null;
export const petSource = { from: "site", count: 0 };
export function useFolderDefs(obj) { petSource.count = applyDefs(obj).length; petSource.from = "folder"; }
export function useSiteDefs() { petSource.count = applyDefs(siteObj).length; petSource.from = "site"; }

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

/* ---- hats -------------------------------------------------------------------- */
export function drawHat(ctx, hat, cx, cy, r) {
  ctx.save();
  ctx.translate(cx, cy);
  drawShapes(ctx, hat.shapes, r, 0, hat.pal, false);
  ctx.restore();
}

const n4 = v => String(Math.round(v * 1e4) / 1e4);

function hatBounds(shapes) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y, p) => { x0 = Math.min(x0, x - p); y0 = Math.min(y0, y - p); x1 = Math.max(x1, x + p); y1 = Math.max(y1, y + p); };
  for (const s of shapes) {
    const p = s.stroke ? (s.w || 0.05) / 2 : 0;
    if (s.t === "eye") add(s.x, s.y, 0.09 * (s.s || 1));
    else if (s.t === "ell") add(s.x, s.y, Math.max(Math.abs(s.rx), Math.abs(s.ry)) + p);
    else for (const c of s.d) for (let i = 1; i < c.length; i += 2) add(c[i], c[i + 1], p);
  }
  return { x0, y0, x1, y1 };
}

/* The same hat as an inline SVG for the page's icons, sitting on the bottom of a
   w x h box like the built-in ones. */
export function hatSvgFrom(hat, w, h, cls) {
  const b = hatBounds(hat.shapes), parts = [];
  for (const s of hat.shapes) {
    if (s.show === "dead") continue;
    if (s.t === "eye") { parts.push('<circle cx="' + n4(s.x) + '" cy="' + n4(s.y) + '" r="' + n4(0.08 * (s.s || 1)) + '" fill="' + EYE_INK + '"/>'); continue; }
    const paint = ' fill="' + (s.fill ? colourOf(hat.pal, s.fill, 0) : "none") + '"' +
      (s.stroke ? ' stroke="' + colourOf(hat.pal, s.stroke, 0) + '" stroke-width="' + n4(s.w || 0.05) + '"' +
                  (s.cap === "round" ? ' stroke-linecap="round" stroke-linejoin="round"' : '') : '');
    if (s.t === "path") {
      parts.push('<path d="' + s.d.map(c => c[0] + c.slice(1).map(n4).join(" ")).join("") + '"' + paint + '/>');
      continue;
    }
    const a0 = fin(s.a0) ? s.a0 : 0, a1 = fin(s.a1) ? s.a1 : 6.2832, rot = s.rot || 0, deg = n4(rot * 180 / Math.PI);
    if (a1 - a0 >= 6.283) {
      parts.push('<ellipse cx="' + n4(s.x) + '" cy="' + n4(s.y) + '" rx="' + n4(s.rx) + '" ry="' + n4(s.ry) + '"' +
                 (rot ? ' transform="rotate(' + deg + ' ' + n4(s.x) + ' ' + n4(s.y) + ')"' : '') + paint + '/>');
      continue;
    }
    const pt = t => { const x = s.rx * Math.cos(t), y = s.ry * Math.sin(t);
      return n4(s.x + x * Math.cos(rot) - y * Math.sin(rot)) + " " + n4(s.y + x * Math.sin(rot) + y * Math.cos(rot)); };
    parts.push('<path d="M' + pt(a0) + "A" + n4(s.rx) + " " + n4(s.ry) + " " + deg + " " + (a1 - a0 > Math.PI + 1e-3 ? 1 : 0) + " 1 " + pt(a1) +
               (s.chord ? "Z" : "") + '"' + paint + '/>');
  }
  const vb = [b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0].map(n4).join(" ");
  return '<svg class="' + cls + '" width="' + w + '" height="' + h + '" viewBox="' + vb + '" preserveAspectRatio="xMidYMax meet" aria-hidden="true">' +
         parts.join("") + '</svg>';
}

applyDefs({ format: PET_DEFS_FORMAT, pets: {} });          /* the built-in pens, before any pets.json */
