/* Monster week (rev 1.42.0): the week, the monster of the month, damage up to the cap,
   each monster's twist, the drowning debuff and the reward. Fake people only; December
   2026's week (7-13) so stamped goals are used. */

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { web } from "./lib/bridge.mjs";

const JS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../tools/water-challenge/js/");
const MO = await import(pathToFileURL(path.join(JS, "monster.js")));
const { model, C } = web;
const S = model.S;

const WEEK = ["2026-12-07", "2026-12-08", "2026-12-09", "2026-12-10", "2026-12-11", "2026-12-12", "2026-12-13"];
const person = name => ({ name, color: "#60a5fa", created: "2026-01-01", away: [], entries: [], spends: [], pets: {}, graves: {}, graveLog: {},
                          dayGoals: Object.fromEntries(WEEK.map(d => [d, 64])) });
let n = 0;
const pour = (p, day, oz, hhmm = "10:00") => p.entries.push({ eid: "m:" + (n++), ts: day + "T" + hhmm + ":" + String(n % 60).padStart(2, "0"), date: day, oz, by: "test" });
function team() {
  const a = person("Ada"), b = person("Ben");
  S.settings = model.defaultSettings(); S.participants = [a, b]; model.dataChanged();
  return [a, b];
}
const ev = key => ({ start: WEEK[0], end: WEEK[6], key, month: 0 });
const fight = (key, now = WEEK[6]) => { model.dataChanged(); return MO.fight(ev(key), now); };

test("the week: first Monday to Sunday; each block of four months brings all four monsters", () => {
  assert.equal(MO.firstMonday(2026, 11), "2026-12-07");
  assert.equal(MO.firstMonday(2027, 1), "2027-02-01", "a month starting on a Monday");
  assert.equal(MO.eventFor("2026-12-06"), null);
  assert.equal(MO.eventFor("2026-12-07").start, "2026-12-07");
  assert.equal(MO.eventFor("2026-12-13").end, "2026-12-13");
  assert.equal(MO.eventFor("2026-12-14"), null);
  assert.equal(MO.eventFor("2026-10-06"), null, "nothing before MONSTER.since");
  for (let b = 24300; b < 24340; b += 4) {
    const keys = [0, 1, 2, 3].map(i => MO.monsterOfMonth(b + i)).sort();
    assert.deepEqual(keys, ["ai", "kraken", "leviathan", "pirate"]);
  }
});

test("health is the week's goals x hpShare; damage counts only up to the cap", () => {
  const [a] = team();
  assert.equal(MO.maxHp(ev("plain")), Math.round(2 * 64 * 5 * C.MONSTER.hpShare));
  pour(a, WEEK[0], 40);
  assert.equal(fight("plain").max - fight("plain").hp, 40);
  pour(a, WEEK[0], 200);
  assert.equal(fight("plain").dealt.Ada, 128, "the cap is 2 x 64");
});

test("twists: pirate doubles the first pour, the AI halves a repeat, the leviathan doubles a day everyone made", () => {
  let [a, b] = team();
  pour(a, WEEK[0], 30, "09:00"); pour(a, WEEK[0], 30, "10:00");
  assert.equal(fight("pirate").dealt.Ada, 90);
  assert.equal(fight("ai").dealt.Ada, 45);
  pour(a, WEEK[0], 20, "11:00");
  assert.equal(fight("ai").dealt.Ada, 65, "a new size hits in full");
  [a, b] = team();
  pour(a, WEEK[0], 64); pour(b, WEEK[0], 40);
  assert.equal(fight("leviathan").dealt.Ada, 64, "Ben short: no double");
  pour(b, WEEK[0], 24, "12:00");
  assert.equal(fight("leviathan").dealt.Ada, 128);
});

test("the kraken regrows overnight unless the team made its goal", () => {
  const [a, b] = team(), max = MO.maxHp(ev("kraken"));
  pour(a, WEEK[0], 100);
  assert.equal(fight("kraken", WEEK[1]).hp, Math.min(max, max - 100 + max * C.MONSTER.regrow));
  pour(b, WEEK[0], 40);                                                  /* 140 of 128 together */
  assert.equal(fight("kraken", WEEK[1]).hp, max - 140);
});

test("drowning a pet feeds the monster and halves the drowner's damage for the rest of the week", () => {
  const [a] = team(), max = MO.maxHp(ev("plain"));
  a.graveLog[WEEK[0]] = 3;
  pour(a, WEEK[0], 100, "09:00"); pour(a, WEEK[0], 40, "10:00");         /* past the cap of 128 */
  pour(a, WEEK[1], 20, "09:00");
  const f = fight("plain");
  assert.deepEqual(f.soaked, ["Ada"]);
  assert.equal(f.hp, max - 128 + max * C.MONSTER.feed - 20 * C.MONSTER.soak);
});

test("beaten: the last hit is named and everyone who hit it gets shells and tokens", () => {
  const [a, b] = team(), c = person("Cal");
  S.participants.push(c);
  for (const d of WEEK.slice(0, 4)) { pour(a, d, 128); pour(b, d, 100); }
  const f = fight("plain");
  assert.ok(f.beaten, "beaten by Thursday");
  assert.equal(f.hp, 0);
  assert.ok(["Ada", "Ben"].includes(f.beaten.name));
  assert.deepEqual(MO.monsterEarned(a, WEEK[6]), { shells: C.MONSTER.shells, tokens: C.MONSTER.tokens });
  assert.deepEqual(MO.monsterEarned(c, WEEK[6]), { shells: 0, tokens: 0 }, "no hits, no reward");
});
