/* The token shop: odds, prices, the rules for each action, the day logs it relies
   on, spend merging, and the live drop files. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import { skipReason, readDataFiles, backupDay, dayKeys, setToday, loadWeb, web } from "./lib/bridge.mjs";

const JS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../tools/water-challenge/js/");
const shop = await import(pathToFileURL(path.join(JS, "shop.js")));
const C = web.C;
const own = (p, k) => Object.prototype.hasOwnProperty.call(p.pets, String(k));

/* A connected folder on the day after the backup (a fresh day). */
async function fresh() {
  const files = readDataFiles(), day = dayKeys(backupDay(files), "2099-01-01")[1];
  setToday(day);
  const w = await loadWeb(files);
  const M = web.model;
  const rich = w.S.participants.filter(p => M.isActive(p)).sort((a, b) => shop.balance(b) - shop.balance(a))[0];
  return { ...w, day, M, rich };
}
async function pourToGoal(p, day) {
  const M = web.model, need = M.personalGoal(p, day) - M.totalOn(p, day) + 1;
  const e = { eid: "g:" + Math.random(), ts: day + "T12:00:00", date: day, oz: need, by: "test" };
  p.entries.push(e);
  await web.store.saveParticipant(p, null);
  await web.pets.reconcilePets();
  return e;
}

test("plinko: the path decides the slot, at true Galton-board odds", () => {
  const odds = shop.plinkoOdds(), chest = shop.chestOdds();
  assert.ok(Math.abs(odds.reduce((a, b) => a + b, 0) + chest - 1) < 1e-12, "odds add up to 1");
  assert.ok(Math.abs(odds[4] - 2 / 1024) < 1e-12, "??? is the two edge slots: 2 in 1024");
  assert.ok(Math.abs(chest - 252 / 1024) < 1e-12, "the centre cup is the chest: 252 in 1024");
  assert.ok(Math.abs(odds[0] - 420 / 1024) < 1e-12, "Common keeps the two cups beside it");
  const p = { name: "x", pets: {}, graves: {} }, n = 400000, hits = [0, 0, 0, 0, 0];
  let chestHits = 0;
  for (let i = 0; i < n; i++) {
    const d = shop.plinkoDrop(p);
    if (d.chest) { chestHits++; assert.equal(d.kind, C.PET_NO_PET); assert.equal(d.slot, 5); continue; }
    hits[d.bin]++;
    assert.equal(d.path.length, C.PLINKO_ROWS);
    assert.equal(d.path.reduce((a, b) => a + b, 0), d.slot, "the path ends in its slot");
    assert.equal(C.PLINKO_SLOTS[d.slot], d.bin, "the slot decides the rarity");
  }
  odds.forEach((v, i) => {
    const sd = Math.sqrt(v * (1 - v) / n);
    assert.ok(Math.abs(hits[i] / n - v) < 5 * sd + 1e-9, C.PET_BINS[i].name + " " + (hits[i] / n * 100).toFixed(3) + "% vs " + (v * 100).toFixed(3) + "%");
  });
  assert.ok(Math.abs(chestHits / n - chest) < 5 * Math.sqrt(chest * (1 - chest) / n), "chest " + (chestHits / n * 100).toFixed(2) + "%");
});

test("plinko: every bounce is a fair coin, independent of the last", () => {
  const p = { name: "x", pets: {}, graves: {} }, n = 100000;
  let rights = 0, same = 0, pairs = 0;
  for (let i = 0; i < n; i++) {
    const path = shop.plinkoDrop(p).path;
    for (let k = 0; k < path.length; k++) { rights += path[k]; if (k) { pairs++; if (path[k] === path[k - 1]) same++; } }
  }
  assert.ok(Math.abs(rights / (n * C.PLINKO_ROWS) - 0.5) < 0.003);
  assert.ok(Math.abs(same / pairs - 0.5) < 0.003);
});

test("plinko: any pet of the rarity, alive, unowned or buried; a pet already alive is a repeat", () => {
  const p = { name: "x", pets: { 0: 1, 1: 1, 2: 1, 6: 1, 7: 1, 8: 1, 9: 1 }, graves: { 10: 1 } };
  const commons = new Set();
  for (let i = 0; i < 20000; i++) {
    const d = shop.plinkoDrop(p);
    if (d.chest) continue;                                   /* the centre cup gives no pet */
    assert.ok(d.kind >= 0, "every rarity always has something to give");
    if (d.bin === 0) commons.add(d.kind);
  }
  assert.deepEqual([...commons].sort((a, b) => a - b), [...C.PET_BINS[0].kinds].sort((a, b) => a - b), "owned, buried and new alike");
});
test("shards: repeats from day logs and Plinko; combine 3 into the next rarity; 1 brings in a pet", () => {
  const T = C.PET_BINS.map(b => b.kinds[0]);                 /* one kind per rarity */
  const p = { name: "sh", pets: { [T[0]]: 1 }, graves: {}, spends: [],
              rollLog: { "2026-10-01": { k: T[0], n: 0 }, "2026-10-02": { k: T[1], n: 1 }, "2026-10-03": { k: -1, n: 0 },
                         "2026-10-04": { k: C.MYSTERY_KIND, n: 1 }, "2026-10-05": { k: T[0], n: 0 } } };
  p.spends.push({ id: "a", kind: "plinko", pet: T[0], fresh: false, bin: 0, cost: 1 },
                { id: "b", kind: "plinko", pet: T[2], fresh: true, bin: 2, cost: 1 },
                { id: "c", kind: "plinko", pet: -1, bin: C.CHEST, chest: { add: 1, won: 0 }, cost: 1 });
  assert.deepEqual(shop.shards(p), [3, 0, 0, 0, 0], "two repeat rolls and a repeat drop; new pets, undone rolls and the chest give none");
  assert.deepEqual(shop.shards(p, { ids: new Set(["a"]), roll: false }), [2, 0, 0, 0, 0], "a drop still falling is left out");
  assert.equal(shop.fuseBlock(p, 0), "");
  assert.match(shop.fuseBlock(p, 1), /Needs 3 Uncommon/);
  assert.match(shop.fuseBlock(p, C.PET_BINS.length - 1), /Nothing above/);
  p.spends.push({ id: "f", kind: "fuse", tier: 0, cost: C.SHARD_FUSE });
  assert.deepEqual(shop.shards(p), [0, 1, 0, 0, 0], "3 Common into 1 Uncommon");
  const unc = C.PET_BINS[1].kinds[0];
  assert.equal(shop.pickBlock(p, unc), "");
  assert.equal(shop.pickBlock(p, T[0]), "Already alive.");
  assert.match(shop.pickBlock(p, T[2]), /Needs a Rare shard/);
  assert.equal(shop.pickBlock(p, C.HOMUNCULUS_KIND), "Not in the pen.");
  p.spends.push({ id: "g", kind: "shard", tier: 1, pet: unc, cost: 1 });
  assert.deepEqual(shop.shards(p), [0, 0, 0, 0, 0]);
  assert.equal(shop.spentTotal(p), 3, "only the three Plinko tokens: shard spends are never tokens");
  delete p.rollLog["2026-10-05"];                            /* that roll undone */
  assert.deepEqual(shop.shards(p), [-1, 0, 0, 0, 0], "an undone repeat takes its shard back, even when spent");
});

test("shards: using one brings the pet in, worn and saved; a buried one keeps its colour", { skip: skipReason }, async () => {
  const { rich, mem } = await fresh();
  const owned = web.pets.petGridOrder().find(k => own(rich, k));
  const target = web.pets.petGridOrder().find(k => !own(rich, k) && !web.pets.isGrave(rich, k));
  if (owned === undefined || target === undefined) return;
  const t = web.pets.petBinIndex(target), tokens = shop.balance(rich);
  rich.rollLog = Object.assign({}, rich.rollLog, { "2026-01-01": { k: C.PET_BINS[t].kinds.find(k => own(rich, k)) ?? owned, n: 0 } });
  const before = shop.shards(rich)[t];
  if (before < 1) return;
  const r = await shop.pickPet(rich, target);
  assert.ok(r && own(rich, target));
  assert.equal(web.store.petKindFor(rich), rich.equippedPet);
  assert.equal(shop.shards(rich)[t], before - 1);
  assert.equal(shop.balance(rich), tokens, "no tokens spent");
  const file = JSON.parse(mem.text(web.store.participantFileName(rich.name)));
  assert.ok(file.spends.some(s => s.kind === "shard" && s.pet === target && s.tier === t));
  assert.equal(file.tokensSpent, shop.spentTotal(rich));
  /* buried: drown it, then bring it back */
  const hue = rich.pets[String(target)];
  delete rich.pets[String(target)]; rich.graves[String(target)] = hue;
  rich.rollLog["2026-01-02"] = rich.rollLog["2026-01-01"];
  await web.store.saveParticipant(rich, null, [String(target)]);
  const back = await shop.pickPet(rich, target);
  assert.ok(back && back.revived);
  assert.equal(rich.pets[String(target)], hue, "keeps the colour it had");
  assert.ok(!web.pets.isGrave(rich, target));
});

test("shards: a repeat goal roll pays one, a reroll takes it back, and a spent one blocks the reroll", { skip: skipReason }, async () => {
  const { rich, day, M } = await fresh();
  /* own the whole first pen, so today's roll must be a repeat */
  for (const k of web.pets.petGridOrder(1)) { rich.pets[String(k)] = 1; if (rich.graves) delete rich.graves[String(k)]; }
  delete rich.pets[String(C.HOMUNCULUS_KIND)]; rich.pets[String(C.HOMUNCULUS_KIND)] = 210;
  await web.store.saveParticipant(rich, null);
  const s0 = shop.shards(rich).reduce((a, b) => a + b, 0);
  await pourToGoal(rich, day);
  if (rich.petRollDay !== day || Number(rich.rollKind) === C.MYSTERY_KIND || web.pets.penOf(Number(rich.rollKind)) !== 1) return;
  assert.equal(rich.rollWasNew, false);
  const t = shop.tierOf(Number(rich.rollKind));
  assert.equal(shop.shards(rich).reduce((a, b) => a + b, 0), s0 + 1, "the repeat paid a shard");
  rich.spends.push({ id: "s:use", at: day + "T13:00:00", kind: "shard", tier: t, pet: -1, cost: 1 });
  if (shop.shards(rich)[t] < 1) assert.match(shop.rerollBlock(rich), /shard is already spent/);
  rich.spends = rich.spends.filter(s => s.id !== "s:use");
  if (shop.rerollBlock(rich)) return;
  await shop.reroll(rich);
  const r = rich.rollLog[day];
  assert.equal(shop.shards(rich).reduce((a, b) => a + b, 0), s0 + (r && r.n === 0 && Number(r.k) >= 0 && shop.tierOf(Number(r.k)) >= 0 ? 1 : 0),
               "only the reroll's own result counts");
  void M;
});
test("reroll: after today's roll, once, for a token; it sticks through undo and redo", { skip: skipReason }, async () => {
  const { rich, day, M } = await fresh();
  assert.match(shop.rerollBlock(rich), /goal first/);
  const pour = await pourToGoal(rich, day);
  assert.equal(rich.petRollDay, day);
  const first = Number(rich.rollKind), firstNew = rich.rollWasNew, before = shop.balance(rich);
  if (shop.rerollBlock(rich)) return;                    /* e.g. today's roll completed the pen */
  const r = await shop.reroll(rich);
  assert.ok(r);
  assert.equal(r.from, first);
  const rec = shop.spendsOn(rich, day).find(s => s.kind === "reroll");
  assert.equal(rec.from, first, "the reroll keeps the goal's own roll, for the activity line");
  assert.equal(rec.fromFresh, !!firstNew, "and whether it was new");
  assert.equal(shop.balance(rich), before - C.REROLL_COST);
  assert.equal(rich.rerollDay, day);
  assert.equal(rich.petRollDay, day);
  const second = Number(rich.rollKind);
  if (firstNew && second !== first) assert.ok(!own(rich, first), "the replaced new pet leaves");
  assert.equal(rich.rollLog[day].k, second);
  assert.match(shop.rerollBlock(rich), /Already rerolled/);

  /* undo below the goal, then cross it again: the rerolled pet comes back, not the first */
  rich.entries = rich.entries.filter(e => e.eid !== pour.eid);
  await web.store.saveParticipant(rich, [pour.eid]);
  await web.pets.reconcilePets();
  assert.equal(rich.petRollDay, "");
  assert.equal(rich.rollLog[day].k, -1, "the log records the take-back");
  await pourToGoal(rich, day);
  assert.equal(Number(rich.rollKind), second);
  assert.ok(M.totalOn(rich, day) > 0);
});

test("plinko play: winning a buried species brings it back", { skip: skipReason }, async () => {
  const { rich, mem } = await fresh();
  for (const k of C.PET_BINS[0].kinds) { const h = rich.pets[String(k)] ?? 7; delete rich.pets[String(k)]; rich.graves[String(k)] = h; }
  await web.store.saveParticipant(rich, null, C.PET_BINS[0].kinds.map(String));
  let r = null, guard = 0;
  while ((!r || r.bin !== 0) && guard++ < 40 && shop.balance(rich) >= 1) r = await shop.plinkoPlay(rich);
  assert.equal(r.bin, 0);
  assert.ok(r.revived && own(rich, r.kind) && !web.pets.isGrave(rich, r.kind));
  const file = JSON.parse(mem.text(web.store.participantFileName(rich.name)));
  assert.ok(!(String(r.kind) in file.graves));
});

test("plinko play: one token, the pet is awarded and logged before the ball lands", { skip: skipReason }, async () => {
  const { rich, mem } = await fresh();
  let before, r;
  do { before = shop.balance(rich); r = await shop.plinkoPlay(rich); } while (r && r.chest && shop.balance(rich) >= 1);
  assert.ok(r && !r.chest, "a pet slot within the balance");
  assert.equal(shop.balance(rich), before - C.PLINKO_COST);
  assert.ok(own(rich, r.kind));
  assert.equal(r.path.reduce((a, b) => a + b, 0), r.slot);
  const file = JSON.parse(mem.text(web.store.participantFileName(rich.name)));
  assert.ok(file.spends.some(s => s.kind === "plinko" && s.pet === r.kind && s.id === r.id));
});

test("drowning and reviving are logged per day", { skip: skipReason }, async () => {
  const { S, day, M } = await fresh();
  const p = S.participants.find(x => M.isActive(x) && Object.keys(x.pets).length);
  const e = { eid: "c:1", ts: day + "T13:00:00", date: day, oz: M.capFor(p, day) + 10, by: "test" };
  p.entries.push(e);
  await web.store.saveParticipant(p, null);
  await web.pets.reconcilePets();
  assert.ok(Number(p.graveLog[day]) >= 0, "drowning logged");
  p.entries = p.entries.filter(x => x.eid !== e.eid);
  await web.store.saveParticipant(p, [e.eid]);
  await web.pets.reconcilePets();
  assert.equal(Number(p.graveLog[day]), -1, "revival logged");
});

test("two windows spending for the same person both count", { skip: skipReason }, async () => {
  const { rich, mem } = await fresh();
  const name = web.store.participantFileName(rich.name);
  const stale = JSON.parse(JSON.stringify(rich));          /* a second window's copy */
  await shop.plinkoPlay(rich);
  stale.spends.push({ id: "s:other-window", at: "2026-10-13T09:00:00", kind: "plinko", cost: 1, pet: 0, bin: 0, fresh: false });
  await web.store.saveParticipant(stale, null);
  const file = JSON.parse(mem.text(name));
  assert.equal(file.spends.length, rich.spends.length + 1);
  assert.equal(file.tokensSpent, file.spends.reduce((a, s) => a + s.cost, 0));
});

test("live drops: written to _live, read back once, old ones cleared", { skip: skipReason }, async () => {
  await fresh();
  const now = Date.now();
  const old = { id: "old", at: now - C.LIVE_KEEP_MS - 5000, name: "a", path: [], slot: 0 };
  const ev = { id: "e1", at: now, name: "b", path: [1, 0], slot: 1 };
  await web.store.writeLive(old);
  await web.store.writeLive(ev);
  await new Promise(r => setTimeout(r, 20));
  const got = await web.store.readLive(now - 1000, new Set());
  assert.deepEqual(got.map(x => x.id), ["e1"]);
  assert.deepEqual(await web.store.readLive(now - 1000, new Set(["e1"])), []);
  const live = web.store.dir._d.get(C.LIVE_SUBDIR);
  assert.ok(![...live._f.keys()].some(n => n.includes("-old")), "stale drop file removed");
  assert.ok(![...web.store.dir._f.keys()].some(n => /^(ev|drop)-/.test(n)), "nothing in the data folder itself");
});

test("live: ids with a colon still make Windows-safe file names, and every event type round-trips", { skip: skipReason }, async () => {
  await fresh();
  const now = Date.now();
  const evs = [{ type: "drop", id: "s:abc:def", at: now, slot: 3 }, { type: "pour", id: "l:x", at: now + 1, name: "a", oz: 8 },
               { type: "unlock", id: "l:y", at: now + 2, info: { name: "a", kind: 3 } }];
  for (const ev of evs) await web.store.writeLive(ev);
  const names = [...web.store.dir._d.get(C.LIVE_SUBDIR)._f.keys()];
  assert.ok(names.every(n => !/[\\/:*?"<>|]/.test(n)), names.join(" "));
  const got = await web.store.readLive(now - 1000, new Set());
  assert.deepEqual(got.map(e => e.type), ["drop", "pour", "unlock"]);
  assert.deepEqual(got[2].info, { name: "a", kind: 3 });
  const seen = new Set(evs.map(e => web.store.liveFileId(e.id)));
  assert.deepEqual(await web.store.readLive(now - 1000, seen), [], "handled events are skipped");
});

/* ---- the full-pen reward -------------------------------------------------- */
function wholePen(p) { for (let k = 0; k < C.PET_COUNT; k++) { p.pets[String(k)] = p.pets[String(k)] ?? 100; delete p.graves[String(k)]; } }

test("full-pen reward at format 22: needs all 25 alive, goes when one drowns, comes back with it", { skip: skipReason }, async () => {
  const { S, day, M } = await fresh();
  const p = S.participants.find(x => M.isActive(x));
  wholePen(p);
  p.graves["5"] = 1; delete p.pets["5"];                                /* 24 alive, one buried */
  await web.store.saveParticipant(p, null, ["5"]);
  await web.pets.reconcilePets();
  assert.ok(!own(p, C.HOMUNCULUS_KIND), "a buried pet does not count at format 22");
  delete p.graves["5"]; p.pets["5"] = 28;                               /* bought back, say */
  await web.store.saveParticipant(p, null, null, ["5"]);
  await web.pets.reconcilePets();
  assert.ok(own(p, C.HOMUNCULUS_KIND), "all 25 alive: granted");

  p.equippedPet = C.HOMUNCULUS_KIND;                                    /* wearing it past the cap */
  const g = { eid: "c:g", ts: day + "T12:00:00", date: day, oz: M.personalGoal(p, day) + 1, by: "test" };   /* the goal, kept */
  const e = { eid: "c:h", ts: day + "T13:00:00", date: day, oz: M.capFor(p, day), by: "test" };
  p.entries.push(g, e);
  await web.store.saveParticipant(p, null);
  await web.pets.reconcilePets();
  const dead = Number(p.deadKind), pen = web.pets.penOf(dead);
  assert.ok(pen > 0, "a pen pet drowned, not the reward itself");
  assert.equal(own(p, C.HOMUNCULUS_KIND), pen !== 1, "the reward goes only with a first-pen pet");

  p.entries = p.entries.filter(x => x.eid !== e.eid);                   /* undo: the pet is revived */
  await web.store.saveParticipant(p, [e.eid]);
  await web.pets.reconcilePets();
  assert.ok(own(p, dead));
  assert.ok(own(p, C.HOMUNCULUS_KIND), "all 25 alive again: it comes back");
});

/* ---- the cap bonus ---------------------------------------------------------- */
test("cap bonus: 5 tokens a day past the cap, from the start date on, taken back on undo", { skip: skipReason }, async () => {
  const { S, day, M } = await fresh();
  assert.ok(day >= C.CAP_BONUS_SINCE);
  const p = S.participants.find(x => M.isActive(x));
  const before = M.capBonus(p);
  assert.equal(before, 0, "no back pay for days before " + C.CAP_BONUS_SINCE);
  const bal = shop.balance(p);
  const at = { eid: "b:1", ts: day + "T13:00:00", date: day, oz: M.capFor(p, day), by: "test" };
  p.entries.push(at); M.dataChanged();
  assert.equal(M.capBonus(p), 0, "reaching the cap exactly pays nothing");
  at.oz = M.capFor(p, day) + 5; M.dataChanged();
  assert.equal(M.capBonus(p), C.CAP_BONUS, "passing it pays");
  assert.equal(shop.balance(p), bal + C.CAP_BONUS + 1, "plus the goal-day token");
  p.entries = p.entries.filter(x => x !== at); M.dataChanged();
  assert.equal(M.capBonus(p), 0, "undone");
});

test("plinko: a drop stays hidden until its ball lands on this page", () => {
  const t0 = new Date("2026-10-13T12:00:00").getTime(), stamp = "2026-10-13T12:00:00";
  const p = { name: "Kirby", spends: [
    { id: "s:a", kind: "plinko", at: stamp, pet: 7, fresh: true, was: 2 },
    { id: "s:b", kind: "plinko", at: stamp, pet: 3, fresh: true, revived: true },
    { id: "s:c", kind: "plinko", at: stamp, pet: 9, fresh: false },          /* a repeat: its shard waits too */
    { id: "s:e", kind: "plinko", at: stamp, pet: -1, chest: { add: 1, won: 30 } },
    { id: "s:d", kind: "buy", at: stamp, pet: 12 } ] };
  const hold = 12000, ids = l => l.map(d => d.id);
  let h = shop.pendingDrops(p, [], new Set(), t0 + 2000, hold);
  assert.deepEqual(ids(h), ["s:a", "s:b", "s:c", "s:e"], "wins, repeats and chest drops are hidden");
  assert.equal(h[0].was, 2, "with the pet worn before");
  assert.deepEqual(ids(shop.pendingDrops(p, [], new Set(["s:a", "s:e"]), t0 + 2000, hold)), ["s:b", "s:c"], "landed here: shown");
  assert.equal(shop.pendingDrops(p, [], new Set(), t0 + hold + 1, hold).length, 0, "the wait runs out");
  const ball = { id: "s:z", name: "Kirby", kind: 15, fresh: true, was: 7 };
  assert.ok(ids(shop.pendingDrops(p, [ball], new Set(["s:a", "s:b"]), t0 + hold * 5, hold)).includes("s:z"), "a ball still falling is hidden");
  assert.equal(shop.pendingDrops({ name: "Rob" }, [ball], new Set(), t0, hold).length, 0, "someone else's ball");
});

/* Plinko with a forced path into the centre cup, then the chest roll. */
async function chestDrop(p, roll) {
  const seq = [...Array(5).fill(0.9), ...Array(5).fill(0.1), roll], real = Math.random;
  Math.random = () => seq.length ? seq.shift() : real();
  try { return await shop.plinkoPlay(p); } finally { Math.random = real; }
}

test("community chest: the token goes in; an empty chest only adds; a win takes it all", { skip: skipReason }, async () => {
  const { S, rich } = await fresh();
  for (const p of S.participants) p.spends = (p.spends || []).filter(s => !s.chest);   /* whatever the data holds: start empty */
  const other = S.participants.find(p => p !== rich && shop.balance(p) >= 2);
  assert.equal(shop.chestTotal(), 0, "starts empty");
  const b0 = shop.balance(rich);
  let r = await chestDrop(rich, 0.0);                         /* a winning roll, but the chest was empty */
  assert.ok(r.chest && r.chest.add === 1 && r.chest.won === 0, "empty: only adds");
  assert.equal(shop.chestTotal(), 1);
  assert.equal(shop.balance(rich), b0 - 1, "the token went in");
  r = await chestDrop(other, 0.9);                           /* no win */
  assert.equal(r.chest.won, 0);
  assert.equal(shop.chestTotal(), 2, "every centre landing adds, from anyone");
  const b1 = shop.balance(rich);
  r = await chestDrop(rich, 0.01);                           /* under 5%: a win */
  assert.equal(r.chest.won, 3, "the chest, this token included");
  assert.equal(shop.chestTotal(), 0, "emptied");
  assert.equal(shop.balance(rich), b1 - 1 + 3);
  assert.equal(shop.chestWinnings(rich), 3);
  assert.ok(Math.abs(C.CHEST_CHANCE - 0.05) < 1e-12);
});

test("recap: a shop day folds into counts per person", () => {
  const day = "2026-10-13", at = day + "T12:00:00", p = { name: "x", spends: [
    { id: "a", at, kind: "plinko", cost: 1, pet: 7, fresh: true },
    { id: "b", at, kind: "plinko", cost: 1, pet: 3, fresh: true, revived: true },
    { id: "c", at, kind: "plinko", cost: 1, pet: 9, fresh: false },
    { id: "d", at, kind: "plinko", cost: 1, pet: 9, fresh: false },
    { id: "e", at, kind: "plinko", cost: 1, pet: -1, chest: { add: 1, won: 0 } },
    { id: "f", at, kind: "plinko", cost: 1, pet: -1, chest: { add: 1, won: 12 } },
    { id: "g", at, kind: "plinko", cost: 0, pet: -1 },
    { id: "h", at, kind: "buy", cost: 35, pet: 4 },
    { id: "i", at, kind: "reroll", cost: 1, pet: 2, from: 0 },
    { id: "j", at: "2026-10-12T12:00:00", kind: "plinko", cost: 1, pet: 5, fresh: true } ] };
  const d = shop.shopDay(p, day);
  assert.equal(d.drops, 7);
  assert.deepEqual(d.fresh, [7]);
  assert.deepEqual(d.revived, [3]);
  assert.equal(d.repeats, 2);
  assert.equal(d.empty, 1);
  assert.equal(d.chestIn, 2); assert.equal(d.chestWon, 12);
  assert.equal(d.buys.length, 1); assert.equal(d.rerolls.length, 1);
  assert.equal(d.spent, 6 + 35 + 1, "every token that day");
});

test("second pen: opens for good once all 25 are alive; rolls, Plinko and the shop follow it", { skip: skipReason }, async () => {
  const { S, day, M, mem } = await fresh();
  const p = S.participants.find(x => M.isActive(x)), P = web.pets;
  assert.equal(P.pen2Open(p), false);
  assert.equal(shop.pickBlock(p, C.PEN2_FIRST), "Opens with the second pen.");
  wholePen(p);
  await web.store.saveParticipant(p, null);
  await web.pets.reconcilePets();
  assert.ok(P.pen2Open(p), "opened");
  assert.equal(p.pen2, day);
  const file = JSON.parse(mem.text(web.store.participantFileName(p.name)));
  assert.equal(file.pen2, day, "saved in the person's file");
  assert.equal(P.rollPen(p), 2);
  for (let i = 0; i < 300; i++) { const d = shop.plinkoDrop(p); if (!d.chest && d.kind >= 0) assert.equal(P.penOf(d.kind), 2, "Plinko gives second-pen pets"); }
  const k = P.todaysPet(p);
  assert.ok(k === C.MYSTERY_KIND || P.penOf(k) === 2, "the daily roll comes from the second pen");
  delete p.pets["3"]; p.graves["3"] = 1;                                 /* a first-pen pet drowns later */
  await web.store.saveParticipant(p, null, ["3"]);
  await web.pets.reconcilePets();
  assert.ok(P.pen2Open(p), "stays open");
  assert.equal(shop.tierOf(C.PEN2_FIRST + 21), shop.tierOf(21), "same shard rarity");
  assert.equal(P.petBinIndex(C.PEN2_FIRST + 5), P.petBinIndex(5), "the Old Boot is the second pen's ???");
});


test("cosmetics: buy once, wear and take off, recolour; the look only shows what is owned", { skip: skipReason }, async () => {
  const { rich, mem } = await fresh();
  const cos = await import(pathToFileURL(path.join(JS, "cosmetics.js")));
  const pets = web.pets, id = "decor:straw", price = cos.COSMETICS[id].price;
  const pour = d => ({ eid: "sh:" + d, ts: d + "T09:00:00", date: d, oz: 8, by: "test" });
  rich.entries = rich.entries.filter(e => e.date < web.C.SHELLS_SINCE);
  for (let i = 0; i < 20; i++) rich.entries.push(pour(web.util.shiftKey(web.C.SHELLS_SINCE, i)));   /* 1+2+3+4+5x16 = 90 shells */
  assert.equal(shop.shellBalance(rich), 90);
  const before = shop.shellBalance(rich), tokens = shop.balance(rich);
  assert.equal(shop.cosmeticBlock(rich, "decor:nope"), "Not for sale.");
  assert.ok(await shop.buyCosmetic(rich, id));
  assert.equal(shop.shellBalance(rich), before - price, "paid in shells");
  assert.equal(shop.balance(rich), tokens, "goal tokens untouched");
  assert.ok(shop.ownsCosmetic(rich, id));
  assert.equal(shop.cosmeticBlock(rich, id), "Owned.");
  assert.equal(await shop.buyCosmetic(rich, id), null, "never twice");
  assert.deepEqual(shop.lookOf(rich), { decor: "straw" }, "on straight away");
  assert.ok(await shop.wearCosmetic(rich, id, false));
  assert.deepEqual(shop.lookOf(rich), {});
  assert.ok(await shop.wearCosmetic(rich, id, true));
  rich.look.finish = "gold";                                 /* not owned: never shown */
  assert.deepEqual(shop.lookOf(rich), { decor: "straw" });
  const disk = JSON.parse(mem.text(web.store.participantFileName(rich.name)));
  assert.deepEqual(disk.look, { decor: "straw" }, "the look is saved in the person's file");
  assert.ok(disk.spends.some(s => s.kind === "cosmetic" && s.item === id));
  assert.equal(disk.tokensSpent, shop.spentTotal(rich), "tokensSpent leaves shells out");

  const k = Number(Object.keys(rich.pets).find(x => Number(x) < web.C.PET_COUNT));
  assert.ok(Number.isInteger(k));
  assert.equal(await shop.paintPet(rich, k, 400), 40, "hue wraps round");
  assert.equal(pets.hueOf(rich, k), 40, "the recolour wins over the caught hue");
  assert.match(shop.paintBlock(rich, 99), /alive/);
});

test("cosmetics: every item has a slot, a price and draws without error", async () => {
  const cos = await import(pathToFileURL(path.join(JS, "cosmetics.js")));
  const { FlatRec } = await import("./lib/canvas-rec.mjs");
  for (const it of Object.values(cos.COSMETICS)) {
    assert.ok(cos.SLOTS.some(s => s.key === it.slot), it.id);
    assert.ok(it.price > 0 && Number.isInteger(it.price), it.id);
    const c = new FlatRec();
    c.createRadialGradient = () => ({ addColorStop() {} });
    c.roundRect = c.roundRect || (() => {});
    c.setLineDash = c.setLineDash || (() => {});
    c.ellipse = c.ellipse || (() => {});
    if (it.slot === "decor") cos.drawDecor(c, it.key, { x: 4, y: 40, W: 124, H: 170 }, () => 120, 1.5);
    if (it.slot === "effect") for (const l of ["back", "front"]) cos.drawEffect(c, it.key, 60, 120, 30, 1.5, 200, l);
    if (it.slot === "finish") assert.equal(typeof cos.finishFn(it.key), "function", it.id);
  }
});

test("shells: from pour days since SHELLS_SINCE: 1, then one more each day in a row up to 5; weekends without a pour skip, weekdays restart", () => {
  const S0 = web.C.SHELLS_SINCE, day = n => web.util.shiftKey(S0, n);
  const dow = n => web.util.parseKey(day(n)).getDay();
  assert.deepEqual([0, 3, 4, 5, 7, 10, 12].map(dow), [3, 6, 0, 1, 3, 6, 1], "SHELLS_SINCE is a Wednesday");
  const pour = (d, oz = 8) => ({ eid: "sh:" + d + ":" + oz, ts: d + "T09:00:00", date: d, oz, by: "test" });
  const p = { name: "shelltest", entries: [pour(day(-3)), pour(day(-1))], spends: [] };
  assert.equal(shop.shellsEarned(p), 0, "nothing before SHELLS_SINCE");
  for (const n of [0, 1, 2]) p.entries.push(pour(day(n)), pour(day(n), 4));   /* Wed-Fri: 1 + 2 + 3, however many pours a day */
  assert.equal(shop.shellsEarned(p), 6);
  for (const n of [5, 6]) p.entries.push(pour(day(n)));                       /* no weekend pour, Mon-Tue: 4 + 5 */
  assert.equal(shop.shellsEarned(p), 15, "a weekend without a pour keeps the run");
  for (const n of [8, 9]) p.entries.push(pour(day(n)));                       /* no Wed pour, Thu-Fri: 1 + 2 */
  assert.equal(shop.shellsEarned(p), 18, "a weekday without a pour starts again at 1");
  p.entries.push(pour(day(10)));                                              /* Sat: 3 */
  assert.equal(shop.shellsEarned(p), 21, "a weekend pour still counts in the run");
  assert.equal(shop.shellRun(p, day(10)), 3);
  assert.equal(shop.shellRun(p, day(11)), 3, "before today's first pour, yesterday's run still counts");
  assert.equal(shop.shellRun(p, day(12)), 3, "Monday before the first pour: the run from before the weekend");
  assert.equal(shop.shellRun(p, day(13)), 0, "a missed Monday ends it");
  assert.ok(shop.pouredOn(p, day(10)) && !shop.pouredOn(p, day(11)));
  p.entries = p.entries.filter(e => e.date !== day(10));                       /* undo the day's only pour */
  assert.equal(shop.shellsEarned(p), 18, "an undone day pays nothing");
  assert.equal(shop.shellRun(p, day(12)), 2, "an undone Saturday: Friday's run carries to Monday");
  p.spends.push({ id: "s:x", at: day(8) + "T10:00:00", kind: "paint", cost: 1, pet: 0, hue: 10 });
  assert.equal(shop.shellBalance(p), 18 - 1);
  assert.equal(shop.spentTotal(p), 0, "shell spends never touch goal tokens");
});

test("effect spot: a pet's own fx wins; otherwise the middle of what sits above the water", async () => {
  const P = await import(pathToFileURL(path.join(JS, "petdefs.js")));
  const cos = await import(pathToFileURL(path.join(JS, "cosmetics.js")));
  assert.ok(!cos.SLOTS.some(s => s.key === "trail"), "no trails");
  for (let k = 0; k < web.C.PET_MAX; k++) {
    const s = P.fxSpot(P.defs[k]);
    assert.ok(s[1] < 0.6 && s[1] > -2.2 && Math.abs(s[0]) < 1.5, k + ": " + s);
  }
  P.applyDefs({ format: 1, pets: { "0": { fx: [0.1, -0.7], pal: { b: { c: "#123456" } }, swim: [{ t: "ell", x: 0, y: 0.2, rx: 0.5, ry: 0.4, fill: "b" }] } } });
  assert.deepEqual(P.fxSpot(P.defs[0]), [0.1, -0.7], "set in the studio");
  P.applyDefs({ format: 1, pets: { "0": { pal: { b: { c: "#123456" } }, swim: [{ t: "ell", x: 0, y: 0.3, rx: 0.5, ry: 0.3, fill: "b" }] } } });
  assert.deepEqual(P.fxSpot(P.defs[0]), [0, 0.3], "mostly under water: the middle of the whole pet");
  P.applyDefs({ format: 1, pets: {} });
});

test("hydration day: a shell per 5 oz and a token per 10 oz up to the cap, +10 shells at goal, +5 for the team splash", async () => {
  const hyd = await import(pathToFileURL(path.join(JS, "hydration.js")));
  const H = web.C.HYD_DAY, M = web.model, D = "2027-06-23";
  assert.ok(hyd.isHydrationDay(D) && !hyd.isHydrationDay("2027-06-22") && !hyd.isHydrationDay("2027-06-24"));
  assert.equal(web.C.HOLIDAY_HATS.find(h => h.m === H.m && h.d === H.d).span, 0, "droplet hats on the day only");
  const pour = (d, oz) => ({ eid: "hy:" + d + ":" + oz, ts: d + "T09:00:00", date: d, oz, by: "test" });
  const mk = name => ({ name, entries: [], spends: [], dayGoals: { [D]: 60 } });
  const a = mk("hyd-a"), b = mk("hyd-b"), keep = M.S.participants;
  M.S.participants = [a, b];
  try {
    const base = p => ({ shells: shop.shellsEarned(p) - hyd.hydrationEarned(p).shells, tokens: shop.earnedTotal(p) - hyd.hydrationEarned(p).tokens });
    a.entries.push(pour(D, 37)); M.dataChanged();
    assert.deepEqual(hyd.hydrationEarned(a), { shells: 7, tokens: 3 }, "37 oz: 7 shells, 3 tokens, no goal");
    a.entries.push(pour(D, 23)); M.dataChanged();
    assert.deepEqual(hyd.hydrationEarned(a), { shells: 12 + H.goalShells, tokens: 6 }, "60 oz: goal reached");
    a.entries.push(pour(D, 100)); M.dataChanged();
    assert.deepEqual(hyd.hydrationEarned(a), { shells: 24 + H.goalShells + H.teamShells, tokens: 12 },
      "160 oz counts only the 120 oz cap; 160 of 120 team oz meets the splash");
    assert.deepEqual(hyd.hydrationEarned(b), { shells: 0, tokens: 0 }, "the team splash pays only those who poured");
    const s = base(a);
    assert.equal(shop.shellsEarned(a), s.shells + 24 + H.goalShells + H.teamShells);
    assert.equal(shop.earnedTotal(a), s.tokens + 12);
    a.entries = []; M.dataChanged();
    assert.deepEqual(hyd.hydrationEarned(a), { shells: 0, tokens: 0 }, "undone with the water");
  } finally { M.S.participants = keep; M.dataChanged(); }
});

test("day wins: the top score with the goal met pays 10 shells, split on a tie; the medal is worn the next day", () => {
  const M = web.model, keep = M.S.participants, D = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-09", "2026-11-10"];
  setToday("2026-11-10");
  const mk = name => ({ name, entries: [], spends: [], dayGoals: Object.fromEntries(D.map(d => [d, 60])) });
  const pour = (p, d, oz) => p.entries.push({ eid: p.name + ":" + d + ":" + oz, ts: d + "T09:00:00", date: d, oz, by: "t" });
  const a = mk("win-a"), b = mk("win-b");
  M.S.participants = [a, b];
  try {
    pour(a, D[0], 70); pour(b, D[0], 50);                     /* a wins */
    pour(a, D[1], 30); pour(b, D[1], 20);                     /* a on top but under the goal: nobody */
    pour(a, D[2], 60); pour(b, D[2], 60);                     /* tied at the goal: 5 each */
    pour(b, D[3], 66);                                        /* b wins yesterday */
    M.dataChanged();
    assert.deepEqual(M.dayWinners(D[0]), ["win-a"]);
    assert.deepEqual(M.dayWinners(D[1]), [], "a top score under the goal wins nothing");
    assert.deepEqual(M.dayWinners(D[2]).sort(), ["win-a", "win-b"]);
    assert.equal(shop.winShells(a), 10 + 5);
    assert.equal(shop.winShells(b), 5 + 10);
    assert.equal(shop.winShare(3), 4, "a three-way tie rounds up");
    assert.ok(M.wearsMedal(b) && !M.wearsMedal(a), "yesterday's winner wears the medal today");
    pour(a, D[4], 99); M.dataChanged();
    assert.deepEqual(M.dayWinners(D[4]), [], "today is not over yet");
  } finally { M.S.participants = keep; M.dataChanged(); }
});
