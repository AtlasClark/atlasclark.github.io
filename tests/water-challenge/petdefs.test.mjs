/* Drawn pets: pets.json is checked before use, and every built-in pet imported by
   the Pet Studio draws exactly as before (alive, dead, crowned, portrait, any hue). */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { FlatRec, sameDrawing } from "./lib/canvas-rec.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const JS = path.join(ROOT, "tools/water-challenge/js/");
const C = await import(pathToFileURL(JS + "config.js"));
const P = await import(pathToFileURL(JS + "petdefs.js"));
const A = await import(pathToFileURL(JS + "art.js"));
const COS = await import(pathToFileURL(JS + "cosmetics.js"));
const web_C = () => C;
const IMPORTER = path.join(ROOT, "tools/water-challenge/studio/importer.js");

const rec = draw => { const c = new FlatRec(); draw(c); return c.out; };

test("pets.json: bad pets and shapes are dropped, names apply and reset", () => {
  const took = P.applyDefs({ format: 1, pets: {
    "0": { name: " Slug ", crown: [0, -1], pal: { body: { hue: 1, dh: 0, s: 60, l: 50 }, bad: { c: "url(x)" } },
           swim: [{ t: "ell", x: 0, y: 0, rx: 0.5, ry: 0.4, fill: "body" }, { t: "ell", x: 0, y: 0, rx: 1, ry: 1, fill: "bad" },
                  { t: "path", d: [["M", 0, 0], ["L", 1]] }, { t: "eye", x: 0, y: -0.5 }, { t: "blob" }] },
    "1": { swim: [] },
    "99": { swim: [{ t: "eye", x: 0, y: 0 }] },
    "x": {} } });
  assert.deepEqual(took, [0]);
  assert.equal(P.defs[0].swim.length, 2, "the ellipse and the eye survive");
  assert.equal(C.PET_NAMES[0], "Slug");
  assert.equal(C.PET_BASE_NAMES[0], "Duck");
  assert.deepEqual(P.applyDefs({ format: 2, pets: {} }), [], "a newer format is not read");
  assert.equal(C.PET_NAMES[0], "Duck", "names go back when the file no longer renames");
  const pens = Object.keys(P.defs).map(Number);
  assert.equal(pens.length, C.PET_MAX, "every pet's built-in drawing is always there");
  assert.notEqual(P.defs[0].swim.length, 2, "the duck is back to its built-in drawing");
});

test("pets.json: the committed file is valid", () => {
  const obj = JSON.parse(fs.readFileSync(path.join(ROOT, "tools/water-challenge/pets/pets.json"), "utf8"));
  try {
    const took = P.applyDefs(obj);
    assert.deepEqual(took.filter(k => typeof k === "number").map(String), Object.keys(obj.pets), "every pet in the file is usable");
    assert.deepEqual(took.filter(k => typeof k === "string").sort(), Object.keys(obj.hats || {}).sort(), "and every hat or prop");
  } finally { P.applyDefs({ format: 1, pets: {} }); }   /* back to built-in, for the tests after */
});

test("hue: a colourable part follows the pet's hue, a fixed part does not", () => {
  const pal = { a: { hue: 1, dh: 120, s: 50, l: 40, a: 1 }, b: { c: "#123456" } };
  assert.equal(P.colourOf(pal, "a", 300), "hsl(60,50%,40%)");
  assert.equal(P.colourOf(pal, "b", 300), "#123456");
});

const GEOM = path.join(ROOT, "tools/water-challenge/studio/geom.js");
test("studio geometry: loops, splits, mirrors", { skip: fs.existsSync(GEOM) ? false : "Pet Studio not present" }, async () => {
  const G = await import(pathToFileURL(GEOM));
  const loop = [];
  for (let i = 0; i <= 40; i++) { const t = i / 40 * Math.PI * 2; loop.push([Math.sin(t), Math.cos(t)]); }
  assert.ok(G.simplify(loop, 0.01).length > 8, "a closed freehand loop keeps its shape");

  const tri = { t: "path", d: [["M", 0, 0], ["L", 1, 0], ["L", 1, 1], ["Z"]] };
  const n = G.nearestOnPath(tri, 0.5, 0.01);
  assert.equal(n.ci, 1); assert.ok(Math.abs(n.t - 0.5) < 0.01, "the middle of a straight edge");
  assert.ok(G.splitAt(tri, n.ci, n.t));
  assert.deepEqual(tri.d.map(c => c[0]).join(""), "MLLLZ");
  assert.deepEqual(tri.d[1], ["L", 0.5, 0]);

  const curve = { t: "path", d: [["M", 0, 0], ["C", 0, 1, 1, 1, 1, 0]] };
  const mid = G.pathSegments(curve, 2)[0].pts[1];
  G.splitAt(curve, 1, 0.5);
  assert.deepEqual(curve.d[1].slice(-2), mid.map(v => Math.round(v * 1e5) / 1e5), "a curve splits on itself");

  const dome = { t: "ell", x: 1, y: 0, rx: 0.5, ry: 0.3, rot: 0, a0: Math.PI, a1: 2 * Math.PI, chord: true };
  const m = G.mapShape(dome, G.scaleM(0, 0, -1, 1));
  const top = s => G.ellPoint(s, (s.a0 + s.a1) / 2);
  assert.ok(Math.abs(m.x + 1) < 1e-9);
  assert.ok(Math.abs(top(m)[1] - top(dome)[1]) < 1e-6, "a mirrored dome still points up");
});

test("studio combine: shapes and strokes become one solid shape, with holes where they enclose",
     { skip: fs.existsSync(GEOM) ? false : "Pet Studio not present" }, async () => {
  const { createRequire } = await import("node:module");
  globalThis.polygonClipping = createRequire(import.meta.url)(path.join(ROOT, "tools/water-challenge/studio/vendor/polygon-clipping.umd.js"));
  const G = await import(pathToFileURL(GEOM));
  const ringArea = r => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a / 2); };
  const area = mp => mp.reduce((t, poly) => t + ringArea(poly[0]) - poly.slice(1).reduce((h, r) => h + ringArea(r), 0), 0);
  const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol * b, what + ": " + a.toFixed(4) + " vs " + b.toFixed(4));
  const circle = (x, y, r) => ({ t: "ell", x, y, rx: r, ry: r, rot: 0, a0: 0, a1: 6.2832, fill: "body" });

  /* two circles of radius 1, centres 1 apart: union = 2πr² − lens */
  const lens = 2 * Math.acos(0.5) - 0.5 * Math.sqrt(3);
  const two = G.combine([circle(0, 0, 1), circle(1, 0, 1)]);
  assert.equal(two.length, 1, "one solid piece");
  near(area(two), 2 * Math.PI - lens, 0.01, "union area");

  /* a donut: cut a small circle from a big one, then read the path back */
  const d = G.areaToPath(G.cutOut(circle(0, 0, 1), [circle(0, 0, 0.4)]));
  assert.equal(d.filter(c => c[0] === "M").length, 2, "outer ring and hole");
  near(area(G.areaOf({ t: "path", d, fill: "body" })), Math.PI * (1 - 0.16), 0.01, "the hole stays a hole when drawn");

  /* a round-capped line becomes a capsule */
  const line = { t: "path", d: [["M", 0, 0], ["L", 2, 0]], stroke: "dark", w: 0.2, cap: "round" };
  near(area(G.areaOf(line)), 2 * 0.2 + Math.PI * 0.01, 0.01, "capsule area");
  const butt = Object.assign({}, line, { cap: undefined });
  near(area(G.areaOf(butt)), 2 * 0.2, 0.001, "square ends add nothing");

  /* a freehand loop drawn as a stroke becomes a ring with a hole */
  const loop = G.smoothPath([[1, 0], [0, 1], [-1, 0], [0, -1]], true);
  const ring = G.areaOf({ t: "path", d: loop, stroke: "dark", w: 0.1, cap: "round" });
  assert.equal(ring.length, 1); assert.equal(ring[0].length, 2, "an outline with a hole");

  /* a stroke and a fill combine; eyes are left out */
  const both = G.combine([circle(0, 0, 0.5), line, { t: "eye", x: 0, y: 0 }]);
  assert.equal(both.length, 1);
  assert.ok(area(both) > Math.PI * 0.25 && area(both) < Math.PI * 0.25 + 2 * 0.2 + Math.PI * 0.01);

  /* Simplify thins a combined outline and keeps its area */
  const solid = { t: "path", d: G.areaToPath(both), fill: "body" }, n0 = G.anchorCount(solid), a0 = area(G.areaOf(solid));
  assert.ok(G.simplifyPath(solid));
  assert.ok(G.anchorCount(solid) <= n0 * 0.75, n0 + " -> " + G.anchorCount(solid));
  near(area(G.areaOf(solid)), a0, 0.02, "area kept");
  delete globalThis.polygonClipping;
});

test("studio pathfinder: each op gives the right area, in the right shape's colour",
     { skip: fs.existsSync(GEOM) ? false : "Pet Studio not present" }, async () => {
  const { createRequire } = await import("node:module");
  globalThis.polygonClipping = createRequire(import.meta.url)(path.join(ROOT, "tools/water-challenge/studio/vendor/polygon-clipping.umd.js"));
  const G = await import(pathToFileURL(GEOM));
  const ringArea = r => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a / 2); };
  const area = mp => mp.reduce((t, poly) => t + ringArea(poly[0]) - poly.slice(1).reduce((h, r) => h + ringArea(r), 0), 0);
  const circle = (x, r) => ({ t: "ell", x, y: 0, rx: r, ry: r, rot: 0, a0: 0, a1: 6.2832, fill: "body" });
  const lens = 2 * Math.acos(0.5) - 0.5 * Math.sqrt(3), disc = Math.PI, two = [circle(0, 1), circle(1, 1)];
  const want = { unite: [[0, 2 * disc - lens]], minusFront: [[0, disc - lens]], minusBack: [[1, disc - lens]], intersect: [[1, lens]],
                 exclude: [[1, 2 * disc - 2 * lens]], divide: [[0, disc - lens], [1, lens], [1, disc - lens]], trim: [[0, disc - lens], [1, disc]], crop: [[0, lens]] };
  const sorted = l => l.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  for (const op of G.PATHFINDER) {
    const got = sorted(G.pathfinder(op, two).map(p => [p.src, area(p.mp)])), exp = sorted(want[op]);
    assert.equal(got.length, exp.length, op + ": pieces");
    got.forEach((g, i) => { assert.equal(g[0], exp[i][0], op + ": colour"); assert.ok(Math.abs(g[1] - exp[i][1]) < 0.02, op + ": area " + g[1] + " vs " + exp[i][1]); });
  }
  assert.equal(G.pathfinder("intersect", [circle(0, 0.4), circle(3, 0.4)]).length, 0, "nothing in common, nothing left");
  delete globalThis.polygonClipping;
});

test("shape opacity: fo and so fade the fill and outline on the canvas and in icons", () => {
  const calls = [], ctx = new Proxy({ globalAlpha: 1 }, { set(t, k, v) { t[k] = v; if (k === "globalAlpha") calls.push(v); return true; },
                                                         get(t, k) { return k in t ? t[k] : () => { if (k === "fill" || k === "stroke") calls.push(k); }; } });
  const pal = { a: { c: "#123456" } };
  P.drawShapes(ctx, [{ t: "path", d: [["M", 0, 0], ["L", 1, 0], ["L", 0, 1], ["Z"]], fill: "a", fo: 0.4, stroke: "a", so: 0.25, w: 0.1 }], 10, 0, pal, false);
  ctx.globalAlpha = 0.5;
  P.drawShapes(ctx, [{ t: "path", d: [["M", 0, 0], ["L", 1, 0], ["Z"]], fill: "a", fo: 0.5 }], 10, 0, pal, false);
  assert.deepEqual(calls, [0.4, "fill", 0.25, "stroke", 1, 0.5, 0.25, "fill", 0.5], "each part at its own opacity, times what was set before; put back after");
  assert.equal(P.opacityOf(undefined), 1); assert.equal(P.opacityOf(2), 1); assert.equal(P.opacityOf(-1), 0);
  const svg = P.hatSvgFrom({ pal, shapes: [{ t: "ell", x: 0, y: 0, rx: 1, ry: 1, fill: "a", fo: 0.3, stroke: "a", so: 0.6, w: 0.1 }] }, 20, 20, "x");
  assert.match(svg, /fill-opacity="0.3"/); assert.match(svg, /stroke-opacity="0.6"/);
});

test("studio import: every built-in pet draws the same from its shapes",
     { skip: fs.existsSync(IMPORTER) ? false : "Pet Studio not present" }, async () => {
  const I = await import(pathToFileURL(IMPORTER));
  const r = 100, same = (draw, def, k, what) => {
    const keep = P.defs[k], before = rec(draw);
    P.defs[k] = def;
    const after = rec(draw);
    if (keep) P.defs[k] = keep; else delete P.defs[k];
    const why = sameDrawing(before, after, 1e-3);
    assert.equal(why, "", C.PET_NAMES[k] + " (" + k + ") " + what + ": " + why);
  };
  for (let k = 0; k < C.PET_MAX; k++) {
    const def = I.importBuiltin(k);
    for (const hue of [0, 77, 213]) {
      for (const dead of [false, true]) {
        for (const crowned of [false, true]) {
          same(c => A.drawCritter(c, 40, 30, r, 0.3, crowned, dead, k, hue, k % 2 === 0), def, k,
               "hue " + hue + (dead ? " dead" : "") + (crowned ? " crowned" : ""));
        }
      }
      same(c => A.drawPortrait(c, 10, 20, r, k, hue), def, k, "portrait hue " + hue);
    }
  }
});

test("studio import: each hat and prop draws the same from its studio copy",
     { skip: fs.existsSync(IMPORTER) ? false : "Pet Studio not present" }, async () => {
  const I = await import(pathToFileURL(IMPORTER));
  const uses = {
    crown: [0, 11, 26].map(k => c => A.drawCritter(c, 5, 7, 100, -0.2, true, false, k, 140, "crown")),
    jester: [0, 11, 26].map(k => c => A.drawCritter(c, 5, 7, 100, -0.2, true, false, k, 140, "jester")),
    grave: [0, 140].map(h => c => A.drawHeadstone(c, 5, 7, 100, h)),
    ...Object.fromEntries(P.HOLIDAY_KEYS.map(k => [k, [0, 11, 26].map(pk => c => A.drawCritter(c, 5, 7, 100, -0.2, true, false, pk, 140, k))])),
    ...Object.fromEntries(P.CUP_KEYS.map(k => [k, [c => COS.drawDecor(c, k.slice(6), { x: 4, y: 40, W: 124, H: 239 }, () => 120, 1.3)]])),
    ...Object.fromEntries(P.FX_KEYS.map(k => [k, [c => COS.drawEffect(c, k.slice(7), 60, 100, 30, 1.3, 200, "front")]])),
    coin: [c => A.drawCoin(c, 5, 7, 40)],
    medal: [0, 11, 26].map(k => c => A.drawCritter(c, 5, 7, 100, -0.2, false, false, k, 140, false, null, true))
  };
  for (const key of P.HAT_KEYS) {
    const hat = I.importHat(key), keep = P.hats[key];
    assert.ok(key === "grave" || key.startsWith("effect:") || Object.values(hat.pal).every(c => !c.hue), key + ": fixed colours only");
    for (const draw of uses[key]) {
      const before = rec(draw);
      P.hats[key] = hat;
      const after = rec(draw);
      P.hats[key] = keep;
      assert.equal(sameDrawing(before, after, 1e-3), "", key);
    }
  }
});

test("holiday hats: the day before to the day after, in place of the crown and jester", () => {
  const on = k => (A.holidayOn(k) || {}).name || "";
  for (const [k, want] of [["2026-10-29", ""], ["2026-10-30", "Halloween"], ["2026-10-31", "Halloween"], ["2026-11-01", "Halloween"],
                           ["2026-11-02", ""], ["2026-12-23", ""], ["2026-12-24", "Christmas"], ["2026-12-26", "Christmas"],
                           ["2026-12-27", ""], ["2026-12-30", ""], ["2026-12-31", "New Year"], ["2027-01-01", "New Year"],
                           ["2027-01-02", "New Year"], ["2027-01-03", ""], ["2026-06-15", ""]]) assert.equal(on(k), want, k);
  assert.equal(A.hatKeyFor(false, "2026-12-25"), "santa");
  assert.equal(A.hatKeyFor(true, "2026-12-25"), "elf");
  assert.equal(A.hatKeyFor(false, "2026-10-31"), "witch");
  assert.equal(A.hatKeyFor(true, "2026-10-30"), "pumpkin");
  assert.equal(A.hatKeyFor(false, "2027-01-01"), "partyGold");
  assert.equal(A.hatKeyFor(true, "2026-12-31"), "partyStripe");
  assert.equal(A.hatKeyFor(false, "2026-06-15"), "crown");
  assert.equal(A.hatKeyFor(true, "2026-06-15"), "jester");
  assert.equal(A.hatKeyFor("witch", "2026-06-15"), "witch", "a key passed in is worn as is");
  for (const h of web_C().HOLIDAY_HATS) for (const k of [h.crown, h.jester]) assert.ok(P.hats[k] && P.hats[k].shapes.length, k + " is drawn");
});

test("hats: the page's icons use a redrawn hat, and drop it again", () => {
  const built = A.crownSvg(26, 17, "crown"), jester = A.jesterSvg(26, 17, "crown"), key = A.hatKeyFor(false);   /* a holiday's hat on those days */
  P.applyDefs({ format: 1, pets: {}, hats: { [key]: { pal: { gold: { c: "#f0b429" } },
    shapes: [{ t: "path", d: [["M", -0.3, 0], ["L", 0, -0.4], ["L", 0.3, 0], ["Z"]], fill: "gold" },
             { t: "ell", x: 0, y: -0.4, rx: 0.06, ry: 0.06, a0: 3.1416, a1: 6.2832, chord: true, fill: "gold" }] } } });
  const svg = A.crownSvg(26, 17, "crown");
  assert.notEqual(svg, built);
  assert.match(svg, /^<svg class="crown" width="26" height="17" viewBox="[-\d. ]+"/);
  assert.match(svg, /<path d="M-0.3 0L0 -0.4L0.3 0Z" fill="#f0b429"\/>/);
  assert.match(svg, /A0.06 0.06 0 0 1 /, "a part arc becomes an SVG arc");
  assert.equal(A.jesterSvg(26, 17, "crown"), jester, "the jester stays built-in");
  P.applyDefs({ format: 1, pets: {} });
  assert.equal(A.crownSvg(26, 17, "crown"), built);
});

test("folder pet art: _pets.json in the data folder is read, never as a person, and replaces the site's art", async () => {
  const { MemDir, web } = await import("./lib/bridge.mjs");
  const mem = new MemDir("data"), enc = t => new TextEncoder().encode(t);
  const art = { format: 1, pets: { "0": { name: "Test Duck", pal: { b: { c: "#123456" } }, swim: [{ t: "ell", x: 0, y: -0.3, rx: 0.5, ry: 0.4, fill: "b" }] } } };
  web.store.setDir(mem);
  assert.deepEqual(await web.store.readFolderPets(), { sig: "" }, "no file: nothing to use");
  mem._f.set(C.FOLDER_PETS_FILE, { bytes: enc("﻿" + JSON.stringify(art)), mtime: 1000 });
  const r = await web.store.readFolderPets();
  assert.ok(r.sig && r.obj, "read, BOM and all");
  P.useFolderDefs(r.obj);
  assert.equal(P.petSource.from, "folder");
  assert.equal(C.PET_NAMES[0], "Test Duck");
  P.useSiteDefs();
  assert.equal(P.petSource.from, "site");
  assert.equal(C.PET_NAMES[0], "Duck", "back to the site's art (none loaded here)");
  mem._f.set(C.FOLDER_PETS_FILE, { bytes: enc("{ not json"), mtime: 2000 });
  const bad = await web.store.readFolderPets();
  assert.ok(bad.error && !bad.obj && bad.sig !== r.sig, "a broken file is reported, not used");
  const list = await web.store.loadAll();
  assert.equal(list.length, 0); assert.equal(web.model.S.loadFailed, 0, "the loader skips _pets.json");
});

test("hydration day hats: on June 23 only", () => {
  assert.equal(A.hatKeyFor(false, "2027-06-23"), "dropCrown");
  assert.equal(A.hatKeyFor(true, "2027-06-23"), "splashHat");
  for (const d of ["2027-06-22", "2027-06-24"]) {
    assert.equal(A.hatKeyFor(false, d), "crown", d);
    assert.equal(A.hatKeyFor(true, d), "jester", d);
  }
});

test("medal and crown: each pet's size and tilt apply where it wears them", () => {
  const log = [], ctx = new Proxy({}, { get: (_, k) => k === "canvas" ? {} : (...a) => log.push([k, ...a]), set: () => true });
  const def = P.defs[0], keep = { ...def };
  try {
    Object.assign(def, { medal: [0.1, -0.2], medalScale: 2, medalRot: 90, crownScale: 0.5, crownRot: -30 });
    A.drawCritter(ctx, 0, 0, 10, 0, true, false, 0, 0, false, null, true);
    const rot = log.filter(c => c[0] === "rotate").map(c => Math.round(c[1] * 180 / Math.PI));
    assert.ok(rot.includes(90) && rot.includes(-30), "medal and crown tilts: " + rot);
    assert.ok(log.some(c => c[0] === "translate" && Math.abs(c[1] - 1) < 1e-9 && Math.abs(c[2] + 2) < 1e-9), "medal at its spot");
  } finally { Object.keys(def).forEach(k => delete def[k]); Object.assign(def, keep); }
  assert.ok(P.HAT_KEYS.includes("medal") && P.hats.medal.shapes.length, "the medal is a hat the studio can redraw");
});
