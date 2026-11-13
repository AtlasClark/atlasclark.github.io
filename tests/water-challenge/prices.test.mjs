/* Shop prices from Settings (rev 1.50.1): only known keys and sensible numbers are kept,
   a set price is the one charged, and a change never alters what was already paid.
   Fake people only. */

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { web, loadWeb } from "./lib/bridge.mjs";

const JS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../tools/water-challenge/js/");
const shop = await import(pathToFileURL(path.join(JS, "shop.js")));
const PR = await import(pathToFileURL(path.join(JS, "prices.js")));
const COS = await import(pathToFileURL(path.join(JS, "cosmetics.js")));
const { C, model } = web;

test("the list covers reroll, shards, recolour and every Style and Hat shop item", () => {
  const keys = PR.priceList().map(p => p.key);
  for (const k of ["reroll", "shard1", "shard2", "shard3", "paint", "hat:wizard", "finish:gold", "decor:sub", "theme:atlas"]) assert.ok(keys.includes(k), k);
  assert.equal(keys.length, new Set(keys).size);
  assert.equal(keys.length, 5 + Object.keys(COS.COSMETICS).length);
});

test("cleanPrices keeps whole numbers 1-999 for known keys that differ from the usual price", () => {
  assert.deepEqual(PR.cleanPrices({ "hat:wizard": 200, "hat:duck": 150, reroll: 0, paint: 2.5, shard2: 1000, nope: 5, "finish:gold": "60", shard1: 2 }),
                   { "hat:wizard": 200, shard1: 2 });
  assert.deepEqual(PR.cleanPrices(null), {});
});

test("a set price is charged; changing it later leaves past purchases as paid", async () => {
  const { S } = await loadWeb([]);
  const p = { name: "Price Test", color: "#60a5fa", created: "2026-11-01", away: [], pets: { 0: 10 }, graves: {}, entries: [],
              spends: [{ id: "s:gift", at: "2026-11-13T09:00:00", kind: "splinko", cost: 0, bet: 0, won: 500, bin: 4, slot: 0 },
                       { id: "s:chest", at: "2026-11-13T09:00:01", kind: "plinko", cost: 0, pet: -1, bin: C.CHEST, chest: { add: 0, won: 5 } }] };
  S.participants = [p]; model.dataChanged();
  try {
    PR.applyPrices({ "hat:wizard": 220, paint: 3, reroll: 2, shard1: 4 });
    assert.equal(COS.COSMETICS["hat:wizard"].price, 220);
    assert.equal(PR.live.paint, 3);
    assert.equal(PR.live.reroll, 2);
    assert.equal(shop.shardCost(3), 4, "a first-pen pet");
    assert.equal(shop.shardCost(C.PEN2_FIRST + 3), 2, "second pen unchanged");
    const start = shop.shellBalance(p);
    assert.ok(await shop.buyCosmetic(p, "hat:wizard"));
    assert.equal(p.spends.at(-1).cost, 220);
    assert.equal(await shop.paintPet(p, 0, 90), 90);
    assert.equal(p.spends.at(-1).cost, 3);
    assert.equal(shop.shellBalance(p), start - 223);
    PR.applyPrices({});
    assert.equal(COS.COSMETICS["hat:wizard"].price, 150, "back to the usual price");
    assert.equal(PR.live.paint, 1);
    assert.equal(shop.shardCost(3), 1);
    assert.equal(shop.shellBalance(p), start - 223, "what was paid stays paid");
  } finally { PR.applyPrices({}); }
});
