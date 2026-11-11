/* Shell Plinko (rev 1.45.0): what each cup pays (rounded up), that no stake pays back
   more than it costs on average, and that a drop takes the stake and pays the cup.
   Fake people only. */

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { web, loadWeb } from "./lib/bridge.mjs";

const JS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../tools/water-challenge/js/");
const shop = await import(pathToFileURL(path.join(JS, "shop.js")));
const { C, model } = web;

/* The chance of each slot: C(10, k) / 1024. */
function slotChances() {
  const n = C.PLINKO_ROWS, out = [];
  let c = 1;
  for (let k = 0; k <= n; k++) { out.push(c / Math.pow(2, n)); c = c * (n - k) / (k + 1); }
  return out;
}

test("cups pay the multiplier, rounded up to whole shells", () => {
  assert.equal(shop.splinkoPay(C.CHEST, 10), 3);
  assert.equal(shop.splinkoPay(C.CHEST, 2), 1, "0.6 rounds up");
  assert.equal(shop.splinkoPay(0, 5), 3, "2.5 rounds up");
  assert.equal(shop.splinkoPay(1, 5), 5);
  assert.equal(shop.splinkoPay(2, 2), 4);
  assert.equal(shop.splinkoPay(3, 10), 40);
  assert.equal(shop.splinkoPay(4, 10), 100, "the most one drop can win");
});

test("every stake keeps a house edge: the average payout is under the stake", () => {
  const ch = slotChances();
  for (const bet of C.SPLINKO_BETS) {
    const ev = ch.reduce((a, pr, slot) => a + pr * shop.splinkoPay(C.PLINKO_SLOTS[slot], bet), 0);
    assert.ok(ev < bet * 0.9 && ev > bet * 0.7, bet + " shells returns " + (ev / bet * 100).toFixed(1) + "%");
  }
  assert.ok(!C.SPLINKO_BETS.includes(1), "a 1-shell drop could never lose once rounded up");
});

test("a drop takes the stake at once and pays what the cup says; too few shells blocks it", async () => {
  const { S } = await loadWeb([]);
  const days = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"];
  const p = { name: "Shell Test", color: "#60a5fa", created: "2026-11-01", away: [], pets: {}, graves: {}, spends: [],
              entries: days.map((d, i) => ({ eid: "e" + i, ts: d + "T10:00:00", date: d, oz: 20, by: "test" })) };
  S.participants = [p]; model.dataChanged();
  const start = shop.shellBalance(p);
  assert.equal(start, 15, "1 + 2 + 3 + 4 + 5 for five pour days in a row");
  assert.equal(shop.splinkoBlock(p, 3), "Pick 2, 5, 10 shells.");
  const allRight = () => 0.9;                                           /* ten bounces right: slot 10, a ??? cup */
  const r = await shop.splinkoPlay(p, 5, allRight);
  assert.ok(r, "saved");
  assert.deepEqual(r.shell, { bet: 5, won: 50 });
  assert.equal(r.bin, 4);
  const s = p.spends.at(-1);
  assert.deepEqual([s.kind, s.cost, s.bet, s.won], [C.SPLINKO_KIND, 0, 5, 50], "cost 0: an older page counts nothing for it");
  assert.equal(shop.shellBalance(p), start - 5 + 50);
  assert.equal(shop.balance(p), 0, "tokens untouched");
  let i = 0;
  const half = () => (i++ % 2 ? 0.9 : 0.1);                             /* five right: the centre cup */
  const before = shop.shellBalance(p), c = await shop.splinkoPlay(p, 10, half);
  assert.equal(c.bin, C.CHEST);
  assert.equal(c.shell.won, 3);
  assert.equal(shop.shellBalance(p), before - 10 + 3);
  const poor = { name: "Poor Test", entries: [], spends: [] };
  assert.equal(shop.splinkoBlock(poor, 10), "Needs 10 shells.");
  assert.equal(await shop.splinkoPlay(poor, 10, half), null);
  const day = shop.shopDay(p, String(p.spends[0].at).slice(0, 10));
  assert.deepEqual([day.sDrops, day.sBet, day.sWon, day.spent], [2, 15, 53, 0]);
});
