/* Bought themes (rev 1.39.0): Atlas and Hairline in the Style shop, worn only once owned,
   and Hairline's line art drawing a pet in the line colours only. Fake people only. */

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { web } from "./lib/bridge.mjs";
import { FlatRec } from "./lib/canvas-rec.mjs";

const JS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../tools/water-challenge/js/");
const cos = await import(pathToFileURL(path.join(JS, "cosmetics.js")));
const shop = await import(pathToFileURL(path.join(JS, "shop.js")));
const P = await import(pathToFileURL(path.join(JS, "petdefs.js")));
void web;

test("themes: Atlas, Hairline, Blueprint and Synthwave sell for 50 shells in their own tab", () => {
  assert.ok(cos.SLOTS.some(s => s.key === "theme"));
  assert.deepEqual(cos.itemsIn("theme").map(i => [i.key, i.price]), [["atlas", 50], ["hairline", 50], ["blueprint", 50], ["synthwave", 50]]);
});

test("themes: worn only once bought", () => {
  const p = { name: "Theme Test", spends: [], look: { theme: "hairline" } };
  assert.equal(shop.lookOf(p).theme, undefined, "not owned: not worn");
  p.spends.push({ id: "s:t", at: "2026-11-04T10:00:00", kind: "cosmetic", item: "theme:hairline", cost: 50 });
  assert.equal(shop.lookOf(p).theme, "hairline");
});

test("line art: a pet becomes opaque plates with hairline edges, in the line colours only", () => {
  P.applyDefs({ format: 1, pets: {} });
  const def = P.defs[0], rec = new FlatRec();
  P.setLineArt(true);
  try { P.drawShapes(rec, def.swim, 20, 120, def.pal, false); }
  finally { P.setLineArt(false); }
  const L = P.lineArt, fills = new Set(rec.out.filter(o => o.op === "fill").map(o => o.style));
  const strokes = new Set(rec.out.filter(o => o.op === "stroke").map(o => o.style));
  assert.ok(rec.out.length > 3, "something was drawn");
  for (const f of fills) assert.ok([L.plate, L.hi].includes(f), "fill " + f);
  for (const s of strokes) assert.ok([L.edge, L.mid, L.hi].includes(s), "stroke " + s);
  const plain = new FlatRec();
  P.drawShapes(plain, def.swim, 20, 120, def.pal, false);
  assert.ok(plain.out.some(o => o.op === "fill" && o.style !== L.plate), "off again: colours come back");
});
