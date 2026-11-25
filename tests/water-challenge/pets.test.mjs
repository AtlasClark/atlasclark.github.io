/* Pet events: the seeded daily roll is pinned to a recorded sample, and for every
   active person a pour to the goal, past the cap, then two undos must roll, drown,
   revive and take the roll back, leaving everyone else alone. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { skipReason, readDataFiles, backupDay, setToday, loadWeb, web, clone, dayKeys } from "./lib/bridge.mjs";

const FIELDS = ["pets", "graves", "equippedPet", "petRollDay", "rollKind", "rollWasNew", "graveDay", "deadKind"];
const petState = p => Object.fromEntries(FIELDS.map(f => [f, f === "pets" || f === "graves" ? sortKeys(p[f]) : p[f]]));
const sortKeys = o => Object.fromEntries(Object.keys(o || {}).sort((a, b) => a - b).map(k => [k, o[k]]));
const own = (p, k) => Object.prototype.hasOwnProperty.call(p.pets || {}, String(k));

/* Recorded from rev 1.22.1. Changing dayRng or
   the draw order changes everyone's pets, so these must not move. */
const DRAWS = {"Ada|2026-01-05":[286351684,889396478,217281362],"Ada|2026-10-21":[92551405,495032049,851329485],
  "Ada|2026-10-21#reroll":[175085746,223209410,849037965],"Bo|2026-01-05":[587900757,42267416,583126017],
  "Bo|2026-10-21":[394100383,305715339,658997536],"Bo|2026-10-21#reroll":[687391601,868913013,381739022],
  "Casey Long-Name|2026-01-05":[849888252,169293375,519940062],"Casey Long-Name|2026-10-21":[656087973,774928812,161061063],
  "Casey Long-Name|2026-10-21#reroll":[838573920,265199199,546466216]};
const ROLLS = [["Ada","2026-01-05",17,208],["Ada","2026-03-17",7,87],["Ada","2026-10-21",9,216],["Bo","2026-01-05",7,65],
  ["Bo","2026-03-17",8,212],["Bo","2026-10-21",8,331],["Casey Long-Name","2026-01-05",7,220],["Casey Long-Name","2026-03-17",0,331],
  ["Casey Long-Name","2026-10-21",4,324],["Dee","2026-01-05",23,288],["Dee","2026-03-17",23,205],["Dee","2026-10-21",4,150]];

test("rolls: the seeded draws and a fresh pen's rolls match the recorded sample", () => {
  for (const [k, want] of Object.entries(DRAWS)) {
    const [name, key] = k.split("|"), r = web.pets.dayRng(name, key);
    assert.deepEqual([r(), r(), r()].map(v => Math.round(v * 1e9)), want, k);
  }
  for (const [name, key, kind, hue] of ROLLS) {
    const r = web.pets.applyRoll({ name, pets: {}, entries: [] }, web.pets.dayRng(name, key), key);
    assert.deepEqual([r.kind, r.hue], [kind, hue], name + " " + key);
  }
});

test("rolls: any pet of the rarity, owned or not (a repeat pays a shard); never a buried one", () => {
  const C = web.C, owned = C.PET_BINS[0].kinds[0], buried = C.PET_BINS[0].kinds[1], seen = new Set();
  for (let i = 0; i < 4000; i++) {
    const p = { name: "r" + i, pets: { [owned]: 5 }, graves: { [buried]: 5 }, entries: [] };
    const r = web.pets.applyRoll(p, web.pets.dayRng(p.name, "2026-11-02"), "2026-11-02");
    if (web.pets.petBinIndex(r.kind) === 0 && r.kind < C.PET_COUNT) seen.add(r.kind);
    if (r.kind === owned) assert.deepEqual([r.fresh, p.rollLog["2026-11-02"].n], [false, 0], "a repeat is logged n: 0");
  }
  assert.ok(seen.has(owned), "the owned Common still comes up");
  assert.ok(!seen.has(buried), "the buried Common never does");
  assert.equal(seen.size, C.PET_BINS[0].kinds.length - 1);
});

function entry(day, n, oz) {
  return { eid: "t:" + day + ":" + n, ts: day + "T13:0" + n + ":00", date: day, oz, by: "test" };
}
async function pour(p, e) { p.entries.push(clone(e)); await web.store.saveParticipant(p, null); await web.pets.reconcilePets(); }
async function unpour(p, eid) { p.entries = p.entries.filter(x => x.eid !== eid); await web.store.saveParticipant(p, [eid]); await web.pets.reconcilePets(); }

test("drowning: the water picks any pen pet, not the one worn, rarer ones more often (rev 1.33.0)", () => {
  const P = web.pets, C = web.C, pets = {};
  for (let k = 0; k < C.PET_COUNT; k++) pets[k] = 0;
  pets[C.HOMUNCULUS_KIND] = 0;
  const tally = C.PET_BINS.map(() => 0), days = 2000;
  for (let i = 0; i < days; i++) {
    const day = new Date(Date.UTC(2026, 0, 1) + i * 864e5).toISOString().slice(0, 10);
    const k = P.pickVictim({ name: "Ada", pets, equippedPet: 0 }, day);
    assert.equal(P.pickVictim({ name: "Ada", pets, equippedPet: 7 }, day), k, "the worn pet makes no difference");
    assert.ok(P.penOf(k) > 0, "only pen pets drown");
    tally[P.petBinIndex(k)]++;
  }
  const want = C.PET_BINS.map((b, t) => b.kinds.length * C.DROWN_WEIGHTS[t]), sum = want.reduce((a, b) => a + b);
  tally.forEach((n, t) => assert.ok(Math.abs(n / days - want[t] / sum) < 0.04, C.PET_BINS[t].name + " share " + n / days));
  assert.equal(P.pickVictim({ name: "Ada", pets: { [C.HOMUNCULUS_KIND]: 0 } }, "2026-10-26"), C.PET_NO_PET, "nothing in the pens, nothing drowns");
});

test("goal, cap and undo: roll, drown, revive and take back, for every active person", { skip: skipReason }, async () => {
  const files = readDataFiles(), day = dayKeys(backupDay(files), "2099-01-01")[1];   /* a fresh day */
  setToday(day);
  const probe = await loadWeb(files), M = web.model;
  const names = probe.S.participants.filter(p => M.isActive(p)).map(p => p.name);
  assert.ok(names.length > 0);
  for (const name of names) {
    const { S } = await loadWeb(files);                                /* fresh copy per person */
    const p = M.findParticipant(name), others = () => S.participants.filter(x => x.name !== name).map(petState);
    const before = others(), start = petState(p);
    const total = () => M.totalOn(p, day);
    const dragon = web.dragon.holdsDragon(p);                          /* it guards the pen: no roll (rev 1.53.0), so take it out here */
    if (dragon) {
      delete p.pets[String(web.C.MYSTERY_KIND)];
      if (Number(p.equippedPet) === web.C.MYSTERY_KIND) p.equippedPet = -1;
      await web.store.saveParticipant(p, null, [String(web.C.MYSTERY_KIND)]);
      Object.assign(start, petState(p));
    }
    await pour(p, entry(day, 1, Math.max(0.5, Math.ceil(M.personalGoal(p, day) - total()) + 0.5)));
    assert.equal(p.petRollDay, day, name + ": the goal rolls a pet");
    const hadPet = Object.keys(p.pets).some(k => Number(k) !== web.C.HOMUNCULUS_KIND);
    await pour(p, entry(day, 2, Math.ceil(M.capFor(p, day) - total()) + 5));
    if (hadPet) assert.equal(p.graveDay, day, name + ": past the cap a pet drowns");
    const lostDragon = false;                                          /* a dragon never drowns (rev 1.53.0) */
    await unpour(p, "t:" + day + ":2");
    assert.notEqual(p.graveDay, day, name + ": back under the cap it comes back");
    await unpour(p, "t:" + day + ":1");
    assert.notEqual(p.petRollDay, day, name + ": back under the goal the roll is taken back");
    const end = petState(p);
    assert.deepEqual(end.pets, start.pets, name + ": pets as they were");
    assert.deepEqual(end.graves, start.graves, name + ": graves as they were");
    assert.deepEqual(others(), before, name + ": nobody else touched");
  }
});

test("the dragon (rev 1.53.0): stays when put away, never drowns, guards the pen, and only its owner sends it away", { skip: skipReason }, async () => {
  const files = readDataFiles(), day = dayKeys(backupDay(files), "2099-01-01")[1];
  setToday(day);
  const { S } = await loadWeb(files), M = web.model;
  const p = S.participants.find(x => M.isActive(x) && Object.keys(x.pets).some(k => k !== "26") && M.totalOn(x, day) === 0);
  p.pets["26"] = 0; p.equippedPet = 26;
  p.rollLog = Object.assign({}, p.rollLog, { [day]: { k: 26, n: 1 } });   /* it came today: safe for 2 weekdays */
  await web.store.saveParticipant(p, null);
  await web.pets.equipPet(p.name, 26);                                /* take it off */
  assert.equal(p.equippedPet, -1);
  assert.ok(own(p, 26), "still in the pen");
  await web.pets.equipPet(p.name, 26);                                /* and back on */
  assert.equal(p.equippedPet, 26);
  p.petRollDay = "";
  await pour(p, entry(day, 1, Math.ceil(M.personalGoal(p, day) - M.totalOn(p, day)) + 0.5));
  assert.equal(p.petRollDay, day, "the goal is marked");
  assert.ok(!(Number(p.rollKind) >= 0), "but no pet is rolled while it guards the pen");
  await pour(p, entry(day, 2, Math.ceil(M.capFor(p, day) - M.totalOn(p, day)) + 5));
  assert.equal(p.graveDay, day, "a pen pet drowns");
  assert.ok(own(p, 26), "the dragon does not");
  S.mine = "Somebody Else";
  assert.equal(await web.pets.dismissDragon(p.name), false, "another glass can't send it away");
  S.mine = p.name;
  assert.equal(await web.pets.dismissDragon(p.name), true);
  assert.ok(!own(p, 26), "gone");
});
