/* The Hat shop (rev 1.50.0): twelve hats at 150 shells, each with its drawing, the
   moving ones moving, and buying / wearing like any Style shop item. Fake people only. */

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { FlatRec, sameDrawing } from "./lib/canvas-rec.mjs";
import { web, loadWeb } from "./lib/bridge.mjs";

const JS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../tools/water-challenge/js/");
const shop = await import(pathToFileURL(path.join(JS, "shop.js")));
const COS = await import(pathToFileURL(path.join(JS, "cosmetics.js")));
const P = await import(pathToFileURL(path.join(JS, "petdefs.js")));
const A = await import(pathToFileURL(path.join(JS, "art.js")));
const ART = await import(pathToFileURL(path.join(JS, "propart.js")));
const { model } = web;

const at = (key, t) => { A.hatClock.t = t; const c = new FlatRec(); A.drawCritter(c, 5, 7, 100, 0, true, false, 0, 140, key); A.hatClock.t = null; return c.out; };

test("twelve hats at 150 shells, each with a drawing in the hats registry", () => {
  const items = COS.itemsIn("hat");
  assert.equal(items.length, 12);
  for (const it of items) {
    assert.equal(it.price, 150, it.id);
    assert.ok(P.HAT_KEYS.includes(it.id) && P.hats[it.id], it.id + " is drawn");
  }
  assert.deepEqual(P.SHOP_HAT_KEYS.slice().sort(), items.map(i => i.id).sort());
});

test("moving hats move; the rest stand still; every moving part is a group in its drawing", () => {
  const moving = Object.keys(ART.HAT_MOTION);
  assert.ok(moving.length >= 6);
  for (const key of P.SHOP_HAT_KEYS) {
    const mo = ART.HAT_MOTION[key];
    if (mo) for (const g of Object.keys(mo)) assert.ok(P.hats[key].shapes.some(s => s.g === g), key + ": group " + g);
    const diff = sameDrawing(at(key, 0.3), at(key, 1.1), 1e-3);
    if (mo) assert.notEqual(diff, "", key + " moves");
    else assert.equal(diff, "", key + " stands still");
    assert.equal(sameDrawing(at(key, 0.7), at(key, 0.7), 1e-3), "", key + ": same time, same picture");
  }
  const none = new FlatRec(), known = new FlatRec();
  A.drawCritter(none, 5, 7, 100, 0, true, false, 0, 140, "hat:nothing-like-this");
  A.drawCritter(known, 5, 7, 100, 0, false, false, 0, 140, false);
  assert.equal(sameDrawing(none.out, known.out, 1e-3), "", "a hat this page doesn't know draws no hat (not the crown)");
});

test("a hat is bought with shells and worn at once; taking it off keeps it", async () => {
  const { S } = await loadWeb([]);
  const days = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"];
  const p = { name: "Hat Test", color: "#60a5fa", created: "2026-11-01", away: [], pets: {}, graves: {}, spends: [],
              entries: days.map((d, i) => ({ eid: "e" + i, ts: d + "T10:00:00", date: d, oz: 20, by: "test" })) };
  const poor = { name: "Poor Hat", color: "#60a5fa", created: "2026-11-01", away: [], pets: {}, graves: {}, spends: [], entries: [] };
  S.participants = [p, poor]; model.dataChanged();
  assert.equal(shop.cosmeticBlock(poor, "hat:wizard"), "Needs 150 shells.");
  const start = shop.shellBalance(p);
  p.spends.push({ id: "s:gift", at: "2026-11-13T09:00:00", kind: "splinko", cost: 0, bet: 0, won: 200, bin: 4, slot: 0 });
  assert.ok(await shop.buyCosmetic(p, "hat:wizard"));
  assert.equal(shop.shellBalance(p), start + 200 - 150);
  assert.equal(shop.lookOf(p).hat, "wizard", "worn straight away");
  assert.equal(shop.balance(p) >= 0, true);
  assert.ok(await shop.wearCosmetic(p, "hat:wizard", false));
  assert.equal(shop.lookOf(p).hat, undefined);
  assert.ok(shop.ownsCosmetic(p, "hat:wizard"), "still owned");
  assert.equal(shop.cosmeticBlock(p, "hat:wizard"), "Owned.");
  p.look = { hat: "duck" };
  assert.equal(shop.lookOf(p).hat, undefined, "a hat not bought is not worn");
});
