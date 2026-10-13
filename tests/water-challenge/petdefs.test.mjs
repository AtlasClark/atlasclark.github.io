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
  assert.equal(Object.keys(P.defs).length, 0);
});

test("pets.json: the committed file is valid", () => {
  const obj = JSON.parse(fs.readFileSync(path.join(ROOT, "tools/water-challenge/pets/pets.json"), "utf8"));
  const took = P.applyDefs(obj);
  assert.equal(took.length, Object.keys(obj.pets).length, "every pet in the file is usable");
  P.applyDefs({ format: 1, pets: {} });
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

test("studio import: every built-in pet draws the same from its shapes",
     { skip: fs.existsSync(IMPORTER) ? false : "Pet Studio not present" }, async () => {
  const I = await import(pathToFileURL(IMPORTER));
  const r = 100, same = (draw, def, k, what) => {
    const before = rec(draw);
    P.defs[k] = def;
    const after = rec(draw);
    delete P.defs[k];
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

test("studio import: the crown and jester hat draw the same from their shapes",
     { skip: fs.existsSync(IMPORTER) ? false : "Pet Studio not present" }, async () => {
  const I = await import(pathToFileURL(IMPORTER));
  for (const key of P.HAT_KEYS) {
    const hat = I.importHat(key);
    assert.ok(Object.values(hat.pal).every(c => !c.hue), key + ": fixed colours only");
    for (const k of [0, 11, 26]) {
      const draw = c => A.drawCritter(c, 5, 7, 100, -0.2, true, false, k, 140, key === "jester");
      const before = rec(draw);
      P.hats[key] = hat;
      const after = rec(draw);
      delete P.hats[key];
      assert.equal(sameDrawing(before, after, 1e-3), "", key + " on " + C.PET_NAMES[k]);
    }
  }
});

test("hats: the page's icons use a redrawn hat, and drop it again", () => {
  const built = A.crownSvg(26, 17, "crown");
  P.applyDefs({ format: 1, pets: {}, hats: { crown: { pal: { gold: { c: "#f0b429" } },
    shapes: [{ t: "path", d: [["M", -0.3, 0], ["L", 0, -0.4], ["L", 0.3, 0], ["Z"]], fill: "gold" },
             { t: "ell", x: 0, y: -0.4, rx: 0.06, ry: 0.06, a0: 3.1416, a1: 6.2832, chord: true, fill: "gold" }] } } });
  const svg = A.crownSvg(26, 17, "crown");
  assert.notEqual(svg, built);
  assert.match(svg, /^<svg class="crown" width="26" height="17" viewBox="[-\d. ]+"/);
  assert.match(svg, /<path d="M-0.3 0L0 -0.4L0.3 0Z" fill="#f0b429"\/>/);
  assert.match(svg, /A0.06 0.06 0 0 1 /, "a part arc becomes an SVG arc");
  assert.equal(A.jesterSvg(26, 17, "crown").includes("#d9434e"), true, "the jester stays built-in");
  P.applyDefs({ format: 1, pets: {} });
  assert.equal(A.crownSvg(26, 17, "crown"), built);
});
