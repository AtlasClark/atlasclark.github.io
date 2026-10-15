/* Pet Studio importer. Every pet is shapes already (pen1art.js, pen2art.js); the crown
   and jester hat are code drawings in art.js, turned into shapes here: each is drawn on
   a recording context (at r = 100, then scaled to units of r). */

import { critterCrown } from "../js/art.js";
import { hats, EYE_INK } from "../js/petdefs.js";
import { PET_MAX, PEN2_FIRST, PET_COUNT } from "../js/config.js";
import { PEN1_ART, EXTRA_ART } from "../js/pen1art.js";
import { PEN2_ART } from "../js/pen2art.js";

const R = 100, HUE_A = 0, HUE_B = 137;
const rnd = v => Math.round(v * 1e5) / 1e5;

/* ---- recording context ---------------------------------------------------- */
class Rec {
  constructor() {
    this.m = [1, 0, 0, 1, 0, 0]; this.stack = []; this.path = []; this.out = [];
    this.fillStyle = "#000"; this.strokeStyle = "#000"; this.lineWidth = 1; this.lineCap = "butt"; this.lineJoin = "miter";
    this.font = ""; this.textAlign = ""; this.globalAlpha = 1;
  }
  save() { this.stack.push({ m: this.m.slice(), fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth, lineCap: this.lineCap, lineJoin: this.lineJoin }); }
  restore() { const s = this.stack.pop(); if (s) Object.assign(this, s); }
  translate(x, y) { const m = this.m; m[4] += m[0] * x + m[2] * y; m[5] += m[1] * x + m[3] * y; }
  scale(x, y) { const m = this.m; m[0] *= x; m[1] *= x; m[2] *= y; m[3] *= y; }
  rotate(a) {
    const m = this.m, c = Math.cos(a), s = Math.sin(a), [a0, b0, c0, d0] = m;
    m[0] = a0 * c + c0 * s; m[1] = b0 * c + d0 * s; m[2] = c0 * c - a0 * s; m[3] = d0 * c - b0 * s;
  }
  pt(x, y) { const m = this.m; return [(m[0] * x + m[2] * y + m[4]) / R, (m[1] * x + m[3] * y + m[5]) / R]; }
  beginPath() { this.path = []; }
  moveTo(x, y) { this.path.push(["M", ...this.pt(x, y)]); }
  lineTo(x, y) { this.path.push(["L", ...this.pt(x, y)]); }
  quadraticCurveTo(a, b, x, y) { this.path.push(["Q", ...this.pt(a, b), ...this.pt(x, y)]); }
  bezierCurveTo(a, b, c, d, x, y) { this.path.push(["C", ...this.pt(a, b), ...this.pt(c, d), ...this.pt(x, y)]); }
  closePath() { this.path.push(["Z"]); }
  arc(x, y, r, a0, a1) {
    const m = this.m, sx = Math.hypot(m[0], m[1]), sy = Math.hypot(m[2], m[3]);
    this.path.push(["A", ...this.pt(x, y), r * sx / R, r * sy / R, Math.atan2(m[1], m[0]), a0, a1]);
  }
  fillRect(x, y, w, h) {
    const keep = this.path;
    this.path = [["M", ...this.pt(x, y)], ["L", ...this.pt(x + w, y)], ["L", ...this.pt(x + w, y + h)], ["L", ...this.pt(x, y + h)], ["Z"]];
    this.fill();
    this.path = keep;
  }
  fill() { this.out.push({ geom: this.path.slice(), fill: this.fillStyle }); }
  stroke() {
    const m = this.m, last = this.out[this.out.length - 1], w = this.lineWidth * Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) / R;
    const rec = { geom: this.path.slice(), stroke: this.strokeStyle, w, cap: this.lineCap };
    if (last && last.fill && !last.stroke && JSON.stringify(last.geom) === JSON.stringify(rec.geom)) Object.assign(last, rec);
    else this.out.push(rec);
  }
  clearRect() { } fillText() { }
}

function record(draw) {
  const ctx = new Rec();
  draw(ctx);
  return ctx.out;
}

/* ---- recorded marks to shapes -------------------------------------------- */
/* An arc as cubic curves, at most a quarter turn each. */
function arcToCurves(a, start) {
  const [, cx, cy, rx, ry, rot, a0, a1] = a, out = [];
  const P = t => { const x = rx * Math.cos(t), y = ry * Math.sin(t);
    return [cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)]; };
  const D = t => { const x = -rx * Math.sin(t), y = ry * Math.cos(t);
    return [x * Math.cos(rot) - y * Math.sin(rot), x * Math.sin(rot) + y * Math.cos(rot)]; };
  const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 2))), step = (a1 - a0) / n, k = 4 / 3 * Math.tan(step / 4);
  const p0 = P(a0);
  out.push([start ? "L" : "M", p0[0], p0[1]]);
  for (let i = 0; i < n; i++) {
    const t0 = a0 + i * step, t1 = t0 + step, q0 = P(t0), q1 = P(t1), d0 = D(t0), d1 = D(t1);
    out.push(["C", q0[0] + k * d0[0], q0[1] + k * d0[1], q1[0] - k * d1[0], q1[1] - k * d1[1], q1[0], q1[1]]);
  }
  return out;
}

function geomToShape(g) {
  const arcs = g.filter(c => c[0] === "A");
  if (arcs.length === 1 && g[0][0] === "A" && (g.length === 1 || (g.length === 2 && g[1][0] === "Z"))) {
    const [, x, y, rx, ry, rot, a0, a1] = g[0];
    const s = { t: "ell", x: rnd(x), y: rnd(y), rx: rnd(rx), ry: rnd(ry), rot: rnd(rot), a0: rnd(a0), a1: rnd(a1) };
    if (g.length === 2) s.chord = true;
    return s;
  }
  const d = [];
  for (const c of g) {
    if (c[0] === "A") d.push(...arcToCurves(c, d.length > 0));
    else d.push(c);
  }
  return { t: "path", d: d.map(c => [c[0], ...c.slice(1).map(rnd)]) };
}

const HSL = /^hsla?\(([-\d.]+),([\d.]+)%,([\d.]+)%(?:,([\d.]+))?\)$/;
function colourRole(a, b) {
  if (a === b) return { c: a };
  const pa = HSL.exec(a), pb = HSL.exec(b);
  if (!pa || !pb) return { c: a };
  let dh = Number(pa[1]) - HUE_A;
  dh = ((dh % 360) + 540) % 360 - 180;
  if (Math.abs(((HUE_B + dh) % 360 + 360) % 360 - Number(pb[1])) > 1e-6) return { c: a };
  return { hue: 1, dh, s: Number(pa[2]), l: Number(pa[3]), a: pa[4] ? Number(pa[4]) : 1 };
}

const NAMED = { "hue 0 62 58": "body", "hue 0 62 70": "light", "hue 0 55 42": "dark",
                [EYE_INK]: "ink", "#ef8a1b": "beak", "#f4f7f9": "white",
                "#ccd6de": "silver", "#7f8f9c": "edge", "#d9434e": "red", "#4f8fd9": "blue", "#4aa86b": "green",
                "#f7d038": "bell", "#f0b429": "band" };
export function basePalette() {
  return { body: { hue: 1, dh: 0, s: 62, l: 58, a: 1 }, light: { hue: 1, dh: 0, s: 62, l: 70, a: 1 },
           dark: { hue: 1, dh: 0, s: 55, l: 42, a: 1 }, ink: { c: EYE_INK }, beak: { c: "#ef8a1b" }, white: { c: "#f4f7f9" } };
}

/* Gives each distinct colour a palette key, reusing the named ones. */
function palKeeper(pal) {
  const seen = {};
  for (const [k, v] of Object.entries(pal)) seen[v.hue ? "hue " + v.dh + " " + v.s + " " + v.l + (v.a < 1 ? " " + v.a : "") : v.c] = k;
  let n = 1;
  return role => {
    const sig = role.hue ? "hue " + role.dh + " " + role.s + " " + role.l + (role.a < 1 ? " " + role.a : "") : role.c;
    if (seen[sig]) return seen[sig];
    let key = NAMED[sig];
    while (!key || pal[key]) key = (role.hue ? "tint" : "tone") + n++;
    pal[key] = role;
    seen[sig] = key;
    return key;
  };
}

function toShapes(recA, recB, keyOf) {
  if (recA.length !== recB.length) throw new Error("hue changed the drawing");
  return recA.map((a, i) => {
    const b = recB[i], s = geomToShape(a.geom);
    if (a.fill) s.fill = keyOf(colourRole(a.fill, b.fill));
    if (a.stroke) {
      s.stroke = keyOf(colourRole(a.stroke, b.stroke));
      s.w = rnd(a.w);
      if (a.cap === "round") s.cap = "round";
    }
    return s;
  });
}

/* One built-in pet as a Studio pet: every pet is shapes already (pen1art.js, pen2art.js). */
export function importBuiltin(k) {
  const art = k < PET_COUNT ? PEN1_ART[k] : k >= PEN2_FIRST && k < PEN2_FIRST + PET_COUNT ? PEN2_ART[k - PEN2_FIRST] : EXTRA_ART[k];
  const a = JSON.parse(JSON.stringify(art));
  return { crown: a.crown, pal: a.pal, swim: a.swim, portrait: null };
}

/* The built-in crown or jester hat, around the crown spot. */
export function importHat(key) {
  const keep = hats[key];
  delete hats[key];
  try {
    const rec = record(ctx => critterCrown(ctx, 0, 0, R, key === "jester"));
    const pal = {}, keyOf = palKeeper(pal);
    return { pal, shapes: toShapes(rec, rec, keyOf) };
  } finally {
    if (keep) hats[key] = keep;
  }
}

export function importAll() {
  const out = {};
  for (let k = 0; k < PET_MAX; k++) out[k] = importBuiltin(k);
  return out;
}
