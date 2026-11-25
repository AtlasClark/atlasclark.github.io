/* The dragon (rev 1.53.0): how long it stays, the level and stats it brings, and its hoard.
   Fake people only. */

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { web, loadWeb } from "./lib/bridge.mjs";

const JS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../tools/water-challenge/js/");
const dragon = await import(pathToFileURL(path.join(JS, "dragon.js")));
const shop = await import(pathToFileURL(path.join(JS, "shop.js")));
const race = await import(pathToFileURL(path.join(JS, "race.js")));
const { C, model } = web;
const D = C.DRAGON;
const dow = k => new Date(k + "T12:00:00").getDay();
const weekday = k => dow(k) > 0 && dow(k) < 6;

test("it stays its first two weekdays, then leaves on a weekday about 1 in 3", () => {
  const counts = [];
  for (let i = 0; i < 3000; i++) {
    const name = "Ada" + i, came = "2026-12-0" + (1 + (i % 7));        /* every day of the week */
    const safe = dragon.dragonSafeUntil(came), left = dragon.dragonLeaveDay(name, came);
    assert.ok(weekday(safe) && weekday(left), "both weekdays");
    assert.ok(left > safe, "never inside the guaranteed days");
    assert.equal(dragon.dragonLeaveDay(name, came), left, "the same day every time");
    let n = 0;
    for (let d = new Date(safe + "T12:00:00"); ; ) { d.setDate(d.getDate() + 1); const k = d.toISOString().slice(0, 10); if (weekday(k)) n++; if (k === left) break; }
    counts.push(n);
  }
  assert.equal(dragon.dragonSafeUntil("2026-12-07"), "2026-12-08", "came Monday: Monday and Tuesday");
  assert.equal(dragon.dragonSafeUntil("2026-12-05"), "2026-12-08", "came Saturday: Monday and Tuesday");
  const firstDay = counts.filter(n => n === 1).length / counts.length, mean = counts.reduce((a, b) => a + b) / counts.length;
  assert.ok(Math.abs(firstDay - D.leave) < 0.04, "leaves on its first chance " + firstDay);
  assert.ok(Math.abs(mean - 1 / D.leave) < 0.25, "about 3 more weekdays on average: " + mean);
});

test("the day it came: its newest roll; one held from before the rules counts from DRAGON.since", () => {
  assert.equal(dragon.dragonArrival({ pets: {} }), "", "none held");
  assert.equal(dragon.dragonArrival({ pets: { 26: 0 } }), D.since, "no log");
  assert.equal(dragon.dragonArrival({ pets: { 26: 0 }, rollLog: { "2026-10-02": { k: 26, n: 1 } } }), D.since, "an older roll");
  assert.equal(dragon.dragonArrival({ pets: { 26: 0 }, rollLog: { "2026-12-01": { k: 26, n: 1 }, "2026-12-09": { k: 26, n: 1 }, "2026-12-10": { k: 3, n: 1 } } }), "2026-12-09");
});

test("it comes at level 3 to 8 with stats raised to match", () => {
  const seen = new Set();
  for (let i = 0; i < 400; i++) {
    const st = dragon.dragonStart("Ben" + i, "2026-12-01");
    seen.add(st.level);
    assert.ok(st.level >= D.lv[0] && st.level <= D.lv[1]);
    assert.equal(st.d.reduce((a, b) => a + b), (st.level - 1) * D.perLevel);
    assert.equal(race.levelOf(st.xp), st.level);
  }
  assert.equal(seen.size, D.lv[1] - D.lv[0] + 1, "every level turns up");
  const p = { name: "Cleo", pets: { 26: 0 }, rollLog: { "2026-12-01": { k: 26, n: 1 } }, spends: [
    { id: "s:old", at: "2026-11-01T10:00:00", kind: C.RACE_KIND, pet: 26, xp: 999, place: 1, d: [9, 9, 9, 9, 9] } ] };
  const start = dragon.dragonStart("Cleo", "2026-12-01"), st = race.statsOf(p, 26);
  assert.equal(st.level, start.level);
  assert.equal(st.races, 0, "an earlier visit's races don't count");
  assert.deepEqual(st.st, st.base.map((b, i) => Math.min(b + start.d[i], b + C.RACE.grow, C.RACE.statMax)));
});

test("its hoard: up to 10 tokens and 100 shells, paid once per visit, from DRAGON.since", async () => {
  for (let i = 0; i < 500; i++) {
    const h = dragon.hoardOf("Dev" + i, "2026-12-02");
    assert.ok(h.tokens >= 1 && h.tokens <= 10 && h.shells >= 10 && h.shells <= 100, JSON.stringify(h));
  }
  const { S } = await loadWeb([]);
  const p = { name: "Eli", color: "#60a5fa", created: "2026-11-01", away: [], pets: {}, graves: {}, spends: [], entries: [],
              rollLog: { "2026-10-01": { k: 26, n: 1 }, "2026-12-02": { k: 26, n: 1 }, "2026-12-03": { k: 4, n: 1 } } };
  S.participants = [p]; model.dataChanged();
  const h = dragon.hoardOf("Eli", "2026-12-02");
  assert.deepEqual(dragon.hoardTotal(p), h, "the one before DRAGON.since brings nothing");
  assert.equal(shop.balance(p), h.tokens);
  assert.equal(shop.shellBalance(p), h.shells);
  p.rollLog["2026-12-02"] = { k: -1, n: 0 };                              /* the roll was taken back */
  assert.equal(shop.balance(p), 0, "an undone roll takes its hoard with it");
});

test("while it stays, no reroll; the theme is its own", () => {
  const p = { name: "Fay", pets: { 26: 0, 3: 10 }, spends: [], petRollDay: "2026-12-02", rollKind: 26 };
  assert.match(shop.rerollBlock(p), /dragon/);
});
