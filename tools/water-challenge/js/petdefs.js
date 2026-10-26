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
   Hats and props: "hats": { crown?, jester?, grave?, coin?, <holiday hat>?: { pal, shapes } }. Hats are in
   units of r with the origin at the pet's crown spot (the hat's bottom centre), the
   headstone in units of r from the ground under it, the coin 1 unit across about its
   centre (see propart.js). They replace the built-in ones on pets and in the page's icons.
   Only the headstone's colours may follow the pet's hue. */

import * as C from "./config.js";
import { PEN1_ART, EXTRA_ART } from "./pen1art.js";
import { PEN2_ART } from "./pen2art.js";
import { PROP_ART, HOLIDAY_ART } from "./propart.js";
import { CUP_ART, FX_ART } from "./styleart.js";

export const PET_DEFS_FORMAT = 1;
/* A pet may also carry range (0..1): its share of the normal swim range, fx [x, y]:
   the centre of a cosmetic effect around it (fxSpot gives a default when unset), and
   medal [x, y]: where the day-win medal hangs (medalSpot gives a default). crownScale /
   medalScale (1 = as drawn) and crownRot / medalRot (degrees, clockwise) size and tilt
   the crown and medal on that pet. zone ("middle" | "bottom", missing = surface) is how
   it moves; where it sits comes from the drawing itself (anchorY). */
export const defs = {};            /* kind -> pet: the built-in drawing or its replacement */
export const hats = {};            /* HAT_KEYS -> { pal, shapes }: the built-in drawing or its replacement */
export const HOLIDAY_KEYS = Object.keys(HOLIDAY_ART);
export const CUP_KEYS = Object.keys(CUP_ART);          /* "decor:<key>": Style shop cup items */
export const FX_KEYS = Object.keys(FX_ART);            /* "effect:<key>": effect particles */
export const HAT_KEYS = ["crown", "jester", "grave", "coin", "medal", ...HOLIDAY_KEYS, ...CUP_KEYS, ...FX_KEYS];
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
   from the start, and every hat and prop in hats; pets.json can replace any of them. */
function seedPens() {
  const all = [...PEN1_ART.map((p, i) => [i, p]), ...PEN2_ART.map((p, i) => [C.PEN2_FIRST + i, p]),
               ...Object.entries(EXTRA_ART).map(([k, p]) => [Number(k), p])];
  for (const [k, p] of all) {
    const pal = {};
    for (const [n, c] of Object.entries(p.pal)) { const v = cleanColour(c); if (v) pal[n] = v; }
    const swim = p.swim.map(s => cleanShape(s, pal)).filter(Boolean);
    if (swim.length) defs[k] = { pal, swim, portrait: null, crown: p.crown, range: 1 };
  }
  for (const [key, h] of Object.entries({ ...PROP_ART, ...HOLIDAY_ART, ...CUP_ART, ...FX_ART })) {
    const pal = {};
    for (const [n, c] of Object.entries(h.pal)) { const v = cleanColour(c); if (v) pal[n] = v; }
    hats[key] = { pal, shapes: h.shapes.map(s => cleanShape(s, pal)).filter(Boolean) };
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
    const fx = Array.isArray(p.fx) && p.fx.length === 2 && p.fx.every(fin) ? p.fx : null;
    const medal = Array.isArray(p.medal) && p.medal.length === 2 && p.medal.every(fin) ? p.medal : null;
    const fit = (v, d, lo, hi) => fin(v) ? Math.max(lo, Math.min(hi, v)) : d;
    defs[k] = { pal, swim, portrait: portrait && portrait.length ? portrait : null, crown, range, fx, medal,
                crownScale: fit(p.crownScale, 1, 0.2, 4), crownRot: fit(p.crownRot, 0, -180, 180),
                medalScale: fit(p.medalScale, 1, 0.2, 4), medalRot: fit(p.medalRot, 0, -180, 180),
                zone: ZONES.includes(p.zone) && p.zone !== "surface" ? p.zone : undefined };
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

/* finish: optional fn({ h, s, l, a, dh }) -> { h, s, l, a }, a cosmetic recolour of
   the pet's own-colour parts (cosmetics.js); fixed colours never change. */
export function colourOf(pal, key, hue, finish) {
  const c = pal[key];
  if (!c) return "#ff00ff";
  if (!c.hue) return c.c;
  let h = (((hue + c.dh) % 360) + 360) % 360, s = c.s, l = c.l, a = c.a;
  if (finish) ({ h, s, l, a } = finish({ h, s, l, a, dh: c.dh }));
  h = Math.round(h); s = Math.round(s); l = Math.round(l);
  return a < 1 ? "hsla(" + h + "," + s + "%," + l + "%," + a + ")" : "hsl(" + h + "," + s + "%," + l + "%)";
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
/* A shape's own opacity for its fill (fo) or outline (so), 0..1; missing = solid. */
export const opacityOf = v => fin(v) ? Math.max(0, Math.min(1, v)) : 1;

export function drawShapes(ctx, shapes, r, hue, pal, dead, finish) {
  const ga = ctx.globalAlpha;
  for (const s of shapes) {
    if (s.show === "alive" && dead) continue;
    if (s.show === "dead" && !dead) continue;
    if (s.t === "eye") { drawEye(ctx, s, r, dead); continue; }
    tracePath(ctx, s, r);
    if (s.fill) { ctx.fillStyle = colourOf(pal, s.fill, hue, finish); ctx.globalAlpha = ga * opacityOf(s.fo); ctx.fill(); }
    if (s.stroke) {
      ctx.strokeStyle = colourOf(pal, s.stroke, hue, finish);
      ctx.globalAlpha = ga * opacityOf(s.so);
      ctx.lineWidth = Math.max(1, (s.w || 0.05) * r);
      ctx.lineCap = s.cap === "round" ? "round" : "butt";
      ctx.lineJoin = s.cap === "round" ? "round" : "miter";
      ctx.stroke();
      ctx.lineCap = "butt"; ctx.lineJoin = "miter";
    }
    ctx.globalAlpha = ga;
  }
}

/* ---- hats -------------------------------------------------------------------- */
export function drawHat(ctx, hat, cx, cy, r, hue = 0) {
  ctx.save();
  ctx.translate(cx, cy);
  drawShapes(ctx, hat.shapes, r, hue, hat.pal, false);
  ctx.restore();
}

const n4 = v => String(Math.round(v * 1e4) / 1e4);

/* Where effects centre on a pet, in r: its own fx, else the middle of the part of
   its drawing above the waterline, or of the whole drawing when little of it is above. */
const fxCache = new WeakMap();                     /* swim shapes -> default spot */
export function fxSpot(def) {
  if (!def) return [0, -0.42];
  return def.fx || autoFx(def);
}
/* The medal: its own spot, else a little lower and further forward (pets face left)
   than the automatic effect spot, kept above the waterline. */
/* ---- how a pet moves, and where it sits in the glass ------------------------ */
/* zone sets the movement: surface pets float, hop and dive; middle pets bob and leap
   out; bottom pets walk the floor (glass.js). */
export const ZONES = ["surface", "middle", "bottom"];
export const zoneOf = def => def && (def.zone === "middle" || def.zone === "bottom") ? def.zone : "surface";

/* The box a drawing really covers, in r: { x0, x1, top, bottom }. Curves are walked
   along their length (their control points can lie far outside them) and part arcs
   only over their sweep; a stroke adds half its width. dead: the drowned drawing
   (shapes shown alive only left out), else the living one. fresh: measure now (the
   Studio, while the drawing changes); otherwise once per drawing. */
const boxCache = { alive: new WeakMap(), dead: new WeakMap() };
const NO_BOX = { x0: -0.6, x1: 0.6, top: -0.6, bottom: 0.4 };
export function bodyBox(def, dead, fresh) {
  if (!def || !def.swim) return NO_BOX;
  const cache = boxCache[dead ? "dead" : "alive"];
  if (!fresh && cache.has(def.swim)) return cache.get(def.swim);
  let x0 = Infinity, x1 = -Infinity, top = Infinity, bottom = -Infinity;
  const add = (x, y, h) => { x0 = Math.min(x0, x - h); x1 = Math.max(x1, x + h); top = Math.min(top, y - h); bottom = Math.max(bottom, y + h); };
  const N = 12;
  for (const sh of def.swim) {
    if (sh.show === (dead ? "alive" : "dead")) continue;
    const p = sh.stroke ? (sh.w || 0.05) / 2 : 0;
    if (sh.t === "eye") { add(sh.x, sh.y, 0.09 * (sh.s || 1)); continue; }
    if (sh.t === "ell") {
      const a0 = fin(sh.a0) ? sh.a0 : 0, a1 = fin(sh.a1) ? sh.a1 : 6.2832, c = Math.cos(sh.rot || 0), n = Math.sin(sh.rot || 0);
      if (a1 - a0 >= 6.283) {                                       /* a whole ellipse: its exact box, turned */
        const hx = Math.hypot(sh.rx * c, sh.ry * n), hy = Math.hypot(sh.rx * n, sh.ry * c);
        x0 = Math.min(x0, sh.x - hx - p); x1 = Math.max(x1, sh.x + hx + p); top = Math.min(top, sh.y - hy - p); bottom = Math.max(bottom, sh.y + hy + p);
        continue;
      }
      const steps = Math.max(8, Math.ceil(Math.abs(a1 - a0) / 6.2832 * 48));
      for (let i = 0; i <= steps; i++) {
        const t = a0 + (a1 - a0) * i / steps, ex = sh.rx * Math.cos(t), ey = sh.ry * Math.sin(t);
        add(sh.x + ex * c - ey * n, sh.y + ex * n + ey * c, p);
      }
      if (sh.chord || a1 - a0 < 6.283) add(sh.x, sh.y, 0);         /* a part arc closes through its centre or chord */
      continue;
    }
    let cx = 0, cy = 0, sx = 0, sy = 0;
    for (const cm of sh.d) {
      const k = cm[0];
      if (k === "M") { cx = sx = cm[1]; cy = sy = cm[2]; add(cx, cy, p); }
      else if (k === "L") { cx = cm[1]; cy = cm[2]; add(cx, cy, p); }
      else if (k === "Q") {
        for (let i = 1; i <= N; i++) { const t = i / N, u = 1 - t; add(u * u * cx + 2 * u * t * cm[1] + t * t * cm[3], u * u * cy + 2 * u * t * cm[2] + t * t * cm[4], p); }
        cx = cm[3]; cy = cm[4];
      } else if (k === "C") {
        for (let i = 1; i <= N; i++) {
          const t = i / N, u = 1 - t, a = u * u * u, b = 3 * u * u * t, d = 3 * u * t * t, e = t * t * t;
          add(a * cx + b * cm[1] + d * cm[3] + e * cm[5], a * cy + b * cm[2] + d * cm[4] + e * cm[6], p);
        }
        cx = cm[5]; cy = cm[6];
      } else if (k === "Z") { cx = sx; cy = sy; }
    }
  }
  const box = top <= bottom ? { x0, x1, top, bottom } : NO_BOX;
  if (!fresh) cache.set(def.swim, box);
  return box;
}
/* The living drawing's top and bottom in r. */
export function bodySpan(def, fresh) { const b = bodyBox(def, false, fresh); return { top: b.top, bottom: b.bottom }; }

/* How far down the water a drawing sits, as the Studio shows it in a full glass
   (waterline 0, floor line at narrowCup().floor): null when it crosses the waterline
   (it floats there), else 0 (top touching the surface) to 1 (bottom on the floor). */
let floorR = 0;                                    /* narrowCup().floor, worked out once */
export function depthShare(span) {
  if (span.top < 0) return null;
  const travel = (floorR || (floorR = C.narrowCup().floor)) - (span.bottom - span.top);
  return travel > 0 ? Math.min(1, span.top / travel) : 1;
}

/* Where the drawing's origin goes, in px down the glass; surface and floor in px, r the
   pet's size. A drawing that crosses the waterline keeps its waterline on the surface;
   one drawn below it keeps its share of the way from the surface to the floor at any
   fill. Both stand on the floor once the water is too shallow, never through it. */
export function anchorY(def, r, surface, floor, fresh) {
  const s = bodySpan(def, fresh), rest = floor - s.bottom * r, f = depthShare(s);
  if (f === null) return Math.min(surface, rest);
  const travel = (floor - surface) - (s.bottom - s.top) * r;
  return travel <= 0 ? rest : Math.min(rest, surface + f * travel - s.top * r);
}

/* Where a drowned pet's origin goes, upside down (turned half round its origin) on the
   floor (px): the top of its drowned drawing, now its lowest point, touches the floor.
   rev 1.35.0: every pet; before, a pet across the waterline rested at a fixed 1.62 r. */
export function restY(def, r, floor, fresh) {
  return floor + bodyBox(def, true, fresh).top * r;
}

export function medalSpot(def) {
  if (!def) return [-0.12, -0.3];
  if (def.medal) return def.medal;
  const f = autoFx(def);
  return [Math.round((f[0] - 0.12) * 100) / 100, Math.min(-0.14, Math.round((f[1] + 0.1) * 100) / 100)];
}
function autoFx(def) {
  if (fxCache.has(def.swim)) return fxCache.get(def.swim);
  const b = hatBounds(def.swim.filter(s => s.show !== "dead"));
  let spot = [0, -0.42];
  if (b.x0 <= b.x1) {
    const top = b.y0, bot = Math.min(b.y1, 0), y = bot - top >= 0.25 ? Math.min((top + bot) / 2, -0.2) : (b.y0 + b.y1) / 2;
    spot = [Math.round((b.x0 + b.x1) / 2 * 100) / 100, Math.round(y * 100) / 100];
  }
  fxCache.set(def.swim, spot);
  return spot;
}

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
    const fo = opacityOf(s.fo), so = opacityOf(s.so);
    const paint = ' fill="' + (s.fill ? colourOf(hat.pal, s.fill, 0) : "none") + '"' + (s.fill && fo < 1 ? ' fill-opacity="' + n4(fo) + '"' : '') +
      (s.stroke ? ' stroke="' + colourOf(hat.pal, s.stroke, 0) + '" stroke-width="' + n4(s.w || 0.05) + '"' + (so < 1 ? ' stroke-opacity="' + n4(so) + '"' : '') +
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
