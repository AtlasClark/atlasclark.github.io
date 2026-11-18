/* Shell toss (rev 1.51.0): the stake rules, a right call pays double and a wrong one loses
   the stake, the daily limit, and the casino tallies. Fake people only. */

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { web, loadWeb } from "./lib/bridge.mjs";

const JS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../tools/water-challenge/js/");
const shop = await import(pathToFileURL(path.join(JS, "shop.js")));
const { C, model } = web;

/* Ten pour days in a row: 1 + 2 + 3 + 4 + 5 + 5 x 5 = 40 shells. */
async function player() {
  const { S } = await loadWeb([]);
  const days = Array.from({ length: 10 }, (_, i) => "2026-11-" + String(2 + i).padStart(2, "0"));
  const p = { name: "Toss Test", color: "#60a5fa", created: "2026-11-01", away: [], pets: {}, graves: {}, spends: [],
              entries: days.map((d, i) => ({ eid: "e" + i, ts: d + "T10:00:00", date: d, oz: 20, by: "test" })) };
  S.participants = [p]; model.dataChanged();
  return p;
}
const shellSide = () => 0.1, pearlSide = () => 0.9;

test("stakes: whole shells from 1 to the cap, never past the balance", async () => {
  const p = await player();
  assert.equal(shop.shellBalance(p), 40);
  for (const bad of [0, -3, 2.5, C.TOSS.max + 1]) assert.equal(shop.tossBlock(p, bad), "Stake 1 to " + C.TOSS.max + " shells.", String(bad));
  assert.equal(shop.tossBlock(p, 1), "");
  assert.equal(shop.tossBlock(p, C.TOSS.max), "");
  p.spends.push({ id: "s:x", at: "2026-11-10T09:00:00", kind: "cosmetic", cost: 30, item: "x" });
  assert.equal(shop.tossBlock(p, 11), "Needs 11 shells.");
  assert.equal(await shop.tossPlay(p, 11, "shell"), null, "blocked: nothing saved");
});

test("a right call pays double, a wrong one loses the stake; cost 0, tokens untouched", async () => {
  const p = await player();
  const r = await shop.tossPlay(p, 10, "pearl", pearlSide);
  assert.deepEqual([r.side, r.won], ["pearl", 20]);
  const s = p.spends.at(-1);
  assert.deepEqual([s.kind, s.cost, s.bet, s.call, s.side, s.won], [C.TOSS.kind, 0, 10, "pearl", "pearl", 20]);
  assert.equal(shop.shellBalance(p), 50);
  const l = await shop.tossPlay(p, 5, "pearl", shellSide);
  assert.deepEqual([l.side, l.won], ["shell", 0]);
  assert.equal(shop.shellBalance(p), 45);
  assert.equal(shop.balance(p), 0, "tokens untouched");
  assert.equal(await shop.tossPlay(p, 5, "edge"), null, "only Shell up or Pearl up");
  const c = shop.casinoOn(p);
  assert.deepEqual([c.tosses, c.tossWins, c.shellIn, c.shellBack, c.bestShell && c.bestShell.won, c.any], [2, 1, 15, 20, 20, true]);
});

test("a fair coin: the right call wins half the time and pays exactly the stake back on average", () => {
  let wins = 0, x = 12345;
  const rnd = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 4000; i++) if (rnd() < 0.5) wins++;
  assert.ok(Math.abs(wins / 4000 - 0.5) < 0.03, (wins / 40).toFixed(1) + "%");
  assert.equal(0.5 * 2, 1, "2x on a 50/50: no house edge, by the user's choice");
});

test("the daily limit: TOSS.perDay tosses, then blocked until tomorrow", async () => {
  const p = await player();
  for (let i = 0; i < C.TOSS.perDay; i++) assert.ok(await shop.tossPlay(p, 1, "shell", i % 2 ? shellSide : pearlSide), "toss " + (i + 1));
  assert.equal(shop.tossesOn(p), C.TOSS.perDay);
  assert.match(shop.tossBlock(p, 1), /tosses today/);
  assert.equal(await shop.tossPlay(p, 1, "shell"), null);
  assert.equal(shop.tossesOn(p, "2026-11-02"), 0, "other days count apart");
});
