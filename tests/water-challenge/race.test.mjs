/* Pet races (rev 1.46.0): baked stats, the race simulation, odds and payouts, what a
   race teaches, and the stake / winnings / daily limit in the shop. Fake people only. */

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { web, loadWeb } from "./lib/bridge.mjs";

const JS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../tools/water-challenge/js/");
const shop = await import(pathToFileURL(path.join(JS, "shop.js")));
const race = await import(pathToFileURL(path.join(JS, "race.js")));
const { C, model } = web;
const R = C.RACE, sum = a => a.reduce((x, y) => x + y, 0);

test("every kind has five baked stats; rarer pets get more points; pinned samples", () => {
  for (let k = 0; k < C.PET_MAX; k++) {
    const st = race.baseStats(k);
    assert.equal(st.length, C.RACE_STATS.length);
    assert.equal(sum(st), R.base[race.raceTier(k)] * 5, "kind " + k + " spends its rarity's points");
    assert.ok(st.every(v => v >= 18 && v <= 85), "kind " + k + " in range");
  }
  assert.equal(race.raceTier(0), 0);
  assert.equal(race.raceTier(21), 3);
  assert.equal(race.raceTier(C.PEN3_FIRST + 5), 4, "the third pen's ??? slot");
  assert.equal(race.raceTier(C.AUTOMATON_KIND), 5);
  assert.equal(race.raceTier(C.MYSTERY_KIND), 6);
  /* changing these changes every pet's racing stats */
  assert.deepEqual([...race.baseStats(0)], [50, 24, 56, 27, 43]);
  assert.deepEqual([...race.baseStats(21)], [67, 63, 31, 54, 50]);
  assert.deepEqual([...race.baseStats(77)], [56, 61, 43, 61, 69]);
});

test("a race is the same on every screen: same field and seed, same result", () => {
  const field = race.makeField({ kind: 3, hue: 10, st: [...race.baseStats(3)] }, "t|1");
  assert.equal(field.length, R.lanes);
  assert.equal(field.filter(f => f.me).length, 1);
  assert.equal(new Set(field.map(f => f.kind)).size, R.lanes, "six different pets");
  assert.deepEqual(race.makeField({ kind: 3, hue: 10, st: [...race.baseStats(3)] }, "t|1"), field, "the field comes from its seed");
  const a = race.runRace(field, 12345, true), b = race.runRace(field, 12345, true);
  assert.deepEqual(a.place, b.place);
  assert.deepEqual(a.time, b.time);
  assert.equal(a.frames.length, b.frames.length);
  assert.deepEqual([...a.place].sort(), [1, 2, 3, 4, 5, 6]);
  assert.ok(a.secs > 12 && a.secs < 30, "about 20 seconds: " + a.secs);
  assert.ok(a.frames.at(-1).x.every(x => x === R.track), "everyone ends on the line");
  assert.notDeepEqual(race.runRace(field, 54321).time, a.time);
});

test("every stat helps, and none decides the race alone", () => {
  const even = Array.from({ length: 6 }, () => ({ st: [45, 45, 45, 45, 45] }));
  for (let i = 0; i < 5; i++) {
    const f = even.map(a => ({ st: a.st.slice() }));
    f[0].st[i] += 20;
    const w = race.raceOdds(f, 7, 1500).win[0];
    assert.ok(w > 0.185 && w < 0.4, C.RACE_STATS[i] + " +20 wins " + w);
  }
});

test("payouts keep a house edge on every bet, and one win stays small", () => {
  let inS = 0, outS = 0, inT = 0, outT = 0;
  for (let i = 0; i < 40; i++) {
    const k = (i * 7) % C.PET_MAX, f = race.makeField({ kind: k, hue: 0, st: [...race.baseStats(k)] }, "pay|" + i), od = race.raceOdds(f, "o|" + i);
    for (let lane = 0; lane < R.lanes; lane++) {
      for (const bet of R.shellBets) for (const type of ["win", "top3"]) {
        const ch = (type === "win" ? od.win : od.top3)[lane], pay = race.racePay("shell", type, ch, bet);
        if (!pay) continue;
        assert.ok(pay > bet && pay <= bet * R.maxMult, "more than the stake, under the cap");
        assert.ok(pay * ch <= bet * R.edge + 1e-9, "never better than the edge");
        inS += bet; outS += pay * ch;
      }
      const t = race.racePay("token", "win", od.win[lane], 1);
      if (t) { assert.ok(t >= 2 && t <= R.tokenMax); assert.ok(t * od.win[lane] <= R.tokenEdge + 1e-9); inT++; outT += t * od.win[lane]; }
      assert.equal(race.racePay("token", "top3", od.top3[lane], 1), 0, "tokens only on the winner");
    }
  }
  assert.ok(outS / inS > 0.7 && outS / inS < 0.9, "shells return " + (outS / inS).toFixed(3));
  assert.ok(outT / inT > 0.6 && outT / inT < 0.93, "tokens return " + (outT / inT).toFixed(3));
  assert.equal(race.racePay("shell", "win", 0.95, 10), 0, "a sure thing pays nothing more, so it is not offered");
  assert.equal(R.shellBets.at(-1) * R.maxMult, 120, "the most one shell bet can win");
});

test("what a race teaches: winners gain, the last lose a point, stats stay inside their limits", () => {
  const base = [...race.baseStats(0)], info = { early: 1, mid: 2, bursts: 2, stumbles: 0 };
  const rnd = race.rng(9);
  assert.equal(sum(race.raceGrowth(base, base, info, 1, false, rnd)), 3);
  assert.equal(sum(race.raceGrowth(base, base, info, 2, false, rnd)), 2);
  assert.equal(sum(race.raceGrowth(base, base, info, 3, true, rnd)), 2, "third place plus a new level");
  assert.equal(sum(race.raceGrowth(base, base, info, 4, false, rnd)), 0);
  assert.equal(sum(race.raceGrowth(base, base, info, 6, false, rnd)), -1);
  const top = base.map(b => Math.min(R.statMax, b + R.grow)), low = base.map(b => b - R.drop);
  assert.deepEqual(race.raceGrowth(top, base, info, 1, true, rnd), [0, 0, 0, 0, 0], "nothing above the limit");
  assert.deepEqual(race.raceGrowth(low, base, info, 6, false, rnd), [0, 0, 0, 0, 0], "nothing below it");
  assert.deepEqual([race.levelOf(0), race.levelOf(49), race.levelOf(50), race.levelOf(150), race.levelOf(1e9)], [1, 1, 2, 3, R.maxLevel]);
});

test("a race takes the stake, pays a bet that comes in, and grows the pet from the spends", async () => {
  const { S } = await loadWeb([]);
  const days = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"];
  const p = { name: "Race Test", color: "#60a5fa", created: "2026-11-01", away: [], pets: { 3: 120, 7: 40 }, graves: {}, spends: [],
              entries: days.map((d, i) => ({ eid: "e" + i, ts: d + "T10:00:00", date: d, oz: 20, by: "test" })) };
  S.participants = [p]; model.dataChanged();
  const start = shop.shellBalance(p);
  assert.equal(start, 15);
  const setup = shop.raceSetup(p, 3);
  assert.equal(shop.raceSetup(p, 3), setup, "the same field until the race is run");
  assert.equal(setup.field[setup.mine].kind, 3);
  assert.equal(shop.raceBlock(p, 9, null), "Only a pet you have alive.");
  assert.equal(shop.raceBlock(p, 3, { cur: "shell", stake: 3, on: setup.mine, type: "win" }), "Pick a stake.");
  assert.equal(shop.raceBlock(p, 3, { cur: "token", stake: 1, on: setup.mine, type: "win" }), "Needs 1 token.");
  assert.equal(await shop.racePlay(p, 3, null), null, "no race without a stake");

  /* find one seed where the bet lane wins and one where it does not */
  const lane = setup.odds.win.indexOf(Math.max(...setup.odds.win));
  let winSeed = -1, loseSeed = -1;
  for (let s = 1; s < 200 && (winSeed < 0 || loseSeed < 0); s++) {
    if (race.runRace(setup.field, s).place[lane] === 1) { if (winSeed < 0) winSeed = s; } else if (loseSeed < 0) loseSeed = s;
  }
  const bet = { cur: "shell", stake: 5, on: lane, type: "win" }, pay = shop.racePayFor(setup, bet);
  assert.ok(pay > 5);
  const a = await shop.racePlay(p, 3, bet, winSeed);
  assert.ok(a, "saved");
  assert.equal(a.won, pay);
  const sp = p.spends.at(-1);
  assert.deepEqual([sp.kind, sp.cost, sp.cur, sp.bet, sp.won, sp.pet, sp.on], [C.RACE_KIND, 0, "shell", 5, pay, 3, setup.field[lane].kind]);
  assert.equal(shop.shellBalance(p), start - 5 + pay);
  assert.equal(shop.balance(p), 0, "tokens untouched");
  const st = race.statsOf(p, 3);
  assert.equal(st.races, 1);
  assert.equal(st.xp, race.raceXp(a.place));
  assert.deepEqual(st.st, st.base.map((b, i) => b + a.d[i]), "the stats are the species' own plus what its races gave");
  assert.deepEqual(race.statsOf(p, 3, new Set([sp.id])).st, [...st.base], "a race still on the track is left out");
  assert.deepEqual(race.statsOf(p, 7).st, [...race.baseStats(7)], "another pet is untouched");

  const next = shop.raceSetup(p, 3);
  assert.notEqual(next.key, setup.key, "a new field for the next race");
  const b = await shop.racePlay(p, 3, { cur: "shell", stake: 2, on: next.mine, type: "win" }, 1);
  assert.ok(b);
  const c = await shop.racePlay(p, 3, { cur: "shell", stake: 2, on: shop.raceSetup(p, 3).mine, type: "top3" }, 2);
  assert.ok(c);
  assert.equal(shop.racesLeft(p, 3), 0);
  assert.equal(shop.raceBlock(p, 3, null), "Tired. Back tomorrow.");
  assert.equal(await shop.racePlay(p, 3, { cur: "shell", stake: 2, on: 0, type: "win" }, 3), null, R.perPet + " races a day per pet");
  assert.equal(shop.racesLeft(p, 7), R.perPet, "the other pet is fresh");
  assert.equal(shop.shellBalance(p), start - 9 + a.won + b.won + c.won);
  const day = shop.shopDay(p, String(sp.at).slice(0, 10));
  assert.equal(day.races.length, 3);
  assert.equal(day.spent, 0, "no tokens spent");
  void loseSeed;
});

test("a token bet costs a token and pays whole tokens", async () => {
  const { S } = await loadWeb([]);
  const p = { name: "Token Test", color: "#60a5fa", created: "2026-11-01", away: [], pets: { 4: 10 }, graves: {}, entries: [],
              spends: [{ id: "s:chest", at: "2026-11-02T10:00:00", kind: "plinko", cost: 0, pet: -1, bin: C.CHEST, chest: { add: 0, won: 3 } }] };
  S.participants = [p]; model.dataChanged();
  assert.equal(shop.balance(p), 3);
  const setup = shop.raceSetup(p, 4), lane = setup.odds.win.findIndex((w, i) => race.racePay("token", "win", w, 1) > 0);
  assert.ok(lane >= 0, "some lane takes a token");
  const bet = { cur: "token", stake: 1, on: lane, type: "win" }, pay = shop.racePayFor(setup, bet);
  assert.equal(shop.raceBlock(p, 4, { cur: "token", stake: 1, on: lane, type: "top3" }), "No payout on that one.");
  let win = -1, lose = -1;
  for (let s = 1; s < 400 && (win < 0 || lose < 0); s++) {
    if (race.runRace(setup.field, s).place[lane] === 1) { if (win < 0) win = s; } else if (lose < 0) lose = s;
  }
  const a = await shop.racePlay(p, 4, bet, lose);
  assert.equal(a.won, 0);
  assert.equal(p.spends.at(-1).cost, 1, "the stake is the spend's cost");
  assert.equal(shop.balance(p), 2);
  assert.equal(shop.spentTotal(p), 1);
  void win; void pay;
});

test("a house race: six strangers, a stake, no pet of yours, no experience, no daily limit", async () => {
  const { S } = await loadWeb([]);
  const days = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"];
  const p = { name: "House Test", color: "#60a5fa", created: "2026-11-01", away: [], pets: {}, graves: {}, spends: [],
              entries: days.map((d, i) => ({ eid: "e" + i, ts: d + "T10:00:00", date: d, oz: 20, by: "test" })) };
  S.participants = [p]; model.dataChanged();
  const setup = shop.raceSetup(p, C.RACE_HOUSE);
  assert.equal(setup.field.length, R.lanes);
  assert.ok(setup.field.every(f => !f.me), "none of them yours");
  for (let i = 0; i < 40; i++) {
    const f = race.makeField(i % 2 ? null : { kind: C.PEN3_FIRST + 3, hue: 0, st: [...race.baseStats(C.PEN3_FIRST + 3)] }, "pen3|" + i);
    assert.ok(f.every(a => a.me || a.kind < C.PEN3_FIRST || a.kind >= C.PEN3_FIRST + C.PET_COUNT), "no stranger comes from the third pen");
  }
  assert.equal(setup.mine, -1);
  assert.equal(new Set(setup.field.map(f => f.kind)).size, R.lanes);
  assert.equal(await shop.racePlay(p, C.RACE_HOUSE, null), null, "still needs a stake");
  const start = shop.shellBalance(p);
  let won = 0;
  for (let i = 0; i < R.perPet + 2; i++) {
    const s = shop.raceSetup(p, C.RACE_HOUSE), lane = s.odds.win.indexOf(Math.min(...s.odds.win));       /* the long shot always has a payout */
    const r = await shop.racePlay(p, C.RACE_HOUSE, { cur: "shell", stake: 2, on: lane, type: "win" }, 100 + i);
    assert.ok(r, "race " + (i + 1) + " ran: no daily limit");
    assert.equal(r.xp, 0);
    won += r.won;
    const sp = p.spends.at(-1);
    assert.deepEqual([sp.pet, sp.house, sp.xp, sp.d, sp.place], [C.RACE_HOUSE, true, undefined, undefined, r.places[lane]], "the place kept is the backed racer's");
  }
  assert.equal(shop.shellBalance(p), start - 2 * (R.perPet + 2) + won);
});

test("a 1v1 race: a challenge waits in the challenger's file, the accept writes the race, nothing is paid", async () => {
  const { S } = await loadWeb([]);
  const mk = (name, pets) => ({ name, color: "#60a5fa", created: "2026-11-01", away: [], pets, graves: {}, spends: [], entries: [] });
  const a = mk("Ada Test", { 3: 10, 7: 20 }), b = mk("Ben Test", { 12: 30 }), c = mk("Cleo Test", {});
  S.participants = [a, b, c]; model.dataChanged();
  assert.equal(shop.duelAskBlock(a, "Ada Test", 3), "Pick a player.");
  assert.equal(shop.duelAskBlock(a, "Ben Test", 9), "Only a pet you have alive.");
  const ask = await shop.duelAsk(a, "Ben Test", 3);
  assert.ok(ask, "saved");
  assert.deepEqual([ask.kind, ask.cost, ask.role, ask.to, ask.pet], [C.DUEL.kind, 0, "ask", "Ben Test", 3]);
  assert.equal(shop.duelAskBlock(a, "Cleo Test", 7), "One challenge at a time.");
  assert.equal(shop.asksFor("Ben Test").length, 1);
  assert.equal(shop.asksFor("Cleo Test").length, 0);
  assert.equal(shop.asksFor("Ben Test", "2099-01-01").length, 0, "a challenge ends with its day");

  /* taken back, then asked again and declined */
  await shop.duelDrop(a, ask.id);
  assert.equal(shop.asksFor("Ben Test").length, 0);
  const ask2 = await shop.duelAsk(a, "Ben Test", 3);
  await shop.duelPass(b, ask2, a);
  assert.equal(shop.asksBy(a).length, 0, "declined");
  assert.equal(await shop.duelTake(b, a, ask2, 12), null, "a declined challenge can't be raced");

  const ask3 = await shop.duelAsk(a, "Ben Test", 7);
  assert.equal(await shop.duelTake(b, a, ask3, 99), null, "only with a pet you have");
  const take = await shop.duelTake(b, a, ask3, 12, 4242);
  assert.ok(take);
  assert.deepEqual([take.role, take.ask, take.from, take.pet, take.vs, take.cost], ["take", ask3.id, "Ada Test", 12, 7, 0]);
  assert.deepEqual(take.st, [...race.baseStats(12)]);
  assert.deepEqual(take.vst, [...race.baseStats(7)]);
  assert.equal(shop.asksBy(a).length, 0, "answered");
  const field = shop.duelField(take, b), res = race.runRace(field, take.seed);
  assert.deepEqual(field.map(f => [f.kind, f.who]), [[7, "Ada Test"], [12, "Ben Test"]], "the challenger in the first lane");
  assert.equal(take.win, res.place[1] === 1, "every page replays the same winner from the record");
  assert.equal(shop.duelsNow(take.t + 1000).length, 1, "on the track now");
  assert.equal(shop.duelsNow(shop.duelEnds(take) + 1).length, 0, "over");
  const ra = shop.duelRecord("Ada Test", 7), rb = shop.duelRecord("Ben Test", 12);
  assert.deepEqual([ra.won + ra.lost, rb.won + rb.lost, ra.won, rb.lost], [1, 1, take.win ? 0 : 1, take.win ? 0 : 1]);
  for (const p of [a, b]) {
    assert.equal(shop.balance(p), 0); assert.equal(shop.shellBalance(p), 0); assert.equal(shop.spentTotal(p), 0);
  }
  assert.deepEqual(race.statsOf(a, 7).st, [...race.baseStats(7)], "no experience from a 1v1");
  assert.equal(race.statsOf(b, 12).xp, 0);
  assert.equal(shop.racesLeft(b, 12), R.perPet, "and it uses none of the day's races");
});

test("pen rewards stay out of the races; lookups by kind follow the spends as they grow", async () => {
  const { S } = await loadWeb([]);
  const util = await import(pathToFileURL(path.join(JS, "util.js")));
  const p = { name: "Reward Test", color: "#60a5fa", created: "2026-11-01", away: [], pets: { [C.HOMUNCULUS_KIND]: 210, [C.AUTOMATON_KIND]: 195, 3: 10 }, graves: {}, spends: [], entries: [] };
  const q = { name: "Other Test", color: "#60a5fa", created: "2026-11-01", away: [], pets: { 4: 10 }, graves: {}, spends: [], entries: [] };
  S.participants = [p, q]; model.dataChanged();
  assert.equal(race.canRace(C.HOMUNCULUS_KIND), false);
  assert.equal(race.canRace(C.AUTOMATON_KIND), false);
  assert.equal(race.canRace(C.MYSTERY_KIND), true, "the dragon may race");
  assert.equal(shop.raceBlock(p, C.AUTOMATON_KIND, null), "Pen rewards sit the races out.");
  assert.equal(shop.duelAskBlock(p, "Other Test", C.HOMUNCULUS_KIND), "Pen rewards sit the races out.");
  for (let i = 0; i < 60; i++) assert.ok(race.makeField(i % 2 ? null : { kind: 3, hue: 0, st: [...race.baseStats(3)] }, "rw|" + i).every(f => race.canRace(f.kind)), "never a stranger");
  assert.deepEqual(util.spendsBy(p, C.RACE_KIND), []);
  p.spends.push({ id: "a", at: "2026-11-02T10:00:00", kind: C.RACE_KIND, pet: 3, xp: 30, place: 1, d: [1, 0, 0, 0, 0] });
  assert.equal(util.spendsBy(p, C.RACE_KIND).length, 1, "a new record is seen");
  assert.equal(race.statsOf(p, 3).xp, 30);
  p.spends = [];
  assert.equal(race.statsOf(p, 3).xp, 0, "and a replaced list too");
});
