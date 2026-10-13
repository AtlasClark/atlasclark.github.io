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

/* A connected folder at format 22 on the day after the backup (a fresh day). */
async function fresh(upgrade = true) {
  const files = readDataFiles(), day = dayKeys(backupDay(files), "2099-01-01")[1];
  setToday(day);
  const w = await loadWeb(files);
  if (upgrade) await web.store.upgradeFolder();
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

test("prices are one token per roll: 1 / chance of rolling that exact species", () => {
  const total = C.PET_BINS.reduce((a, b) => a + b.weight, 0);
  C.PET_BINS.forEach((b, i) => {
    const fair = total / (b.weight / b.kinds.length);
    assert.ok(Math.abs(C.SHOP_PRICES[i] - fair) / fair < 0.06, b.name + ": " + C.SHOP_PRICES[i] + " vs " + fair.toFixed(1));
  });
});

test("plinko: the path decides the slot, at true Galton-board odds", () => {
  const odds = shop.plinkoOdds();
  assert.ok(Math.abs(odds.reduce((a, b) => a + b, 0) - 1) < 1e-12, "odds add up to 1");
  assert.ok(Math.abs(odds[4] - 2 / 1024) < 1e-12, "??? is the two edge slots: 2 in 1024");
  const p = { name: "x", pets: {}, graves: {} }, n = 400000, hits = [0, 0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    const d = shop.plinkoDrop(p);
    hits[d.bin]++;
    assert.equal(d.path.length, C.PLINKO_ROWS);
    assert.equal(d.path.reduce((a, b) => a + b, 0), d.slot, "the path ends in its slot");
    assert.equal(C.PLINKO_SLOTS[d.slot], d.bin, "the slot decides the rarity");
  }
  odds.forEach((v, i) => {
    const sd = Math.sqrt(v * (1 - v) / n);
    assert.ok(Math.abs(hits[i] / n - v) < 5 * sd + 1e-9, C.PET_BINS[i].name + " " + (hits[i] / n * 100).toFixed(3) + "% vs " + (v * 100).toFixed(3) + "%");
  });
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

test("plinko: a pet they don't have alive first (buried ones included); duplicates only once all are alive", () => {
  const p = { name: "x", pets: { 0: 1, 1: 1, 2: 1, 6: 1, 7: 1, 8: 1, 9: 1, 3: 1, 4: 1, 11: 1, 12: 1, 13: 1, 14: 1 },
              graves: { 15: 1, 10: 1 } };
  const seenUnc = new Set();
  for (let i = 0; i < 20000; i++) {
    const d = shop.plinkoDrop(p);
    assert.ok(d.kind >= 0, "every rarity always has something to give");
    if (d.bin === 0) assert.equal(d.kind, 10, "the one Common not alive (it is buried)");
    if (d.bin === 1) seenUnc.add(d.kind);
  }
  assert.deepEqual([...seenUnc], [15], "the buried Uncommon is the only one not alive");
  const full = { name: "y", pets: Object.fromEntries(C.PET_BINS[0].kinds.map(k => [k, 1])), graves: {} };
  const commons = new Set();
  for (let i = 0; i < 5000; i++) { const d = shop.plinkoDrop(full); if (d.bin === 0) commons.add(d.kind); }
  assert.equal(commons.size, C.PET_BINS[0].kinds.length, "all alive: any Common, as a duplicate");
});

test("the shop stays shut on a format 21 folder", { skip: skipReason }, async () => {
  const { rich } = await fresh(false);
  assert.match(shop.plinkoBlock(rich), /format 22/);
  assert.match(shop.rerollBlock(rich), /format 22/);
  assert.match(shop.buyBlock(rich, 0), /format 22/);
});

test("buy: anything not alive in the pen, costs its price, is worn and logged", { skip: skipReason }, async () => {
  const { rich, mem } = await fresh();
  const owned = Object.keys(rich.pets).map(Number).find(k => k < C.PET_COUNT);
  if (owned !== undefined) assert.equal(shop.buyBlock(rich, owned), "Already owned.");
  assert.equal(shop.buyBlock(rich, C.HOMUNCULUS_KIND), "Not for sale.");
  const target = web.pets.petGridOrder().find(k => !own(rich, k) && !web.pets.isGrave(rich, k) && shop.priceOf(k) <= shop.balance(rich));
  if (target === undefined) return;
  const before = shop.balance(rich);
  const r = await shop.buy(rich, target);
  assert.ok(r);
  assert.equal(shop.balance(rich), before - shop.priceOf(target));
  assert.ok(own(rich, target));
  assert.equal(web.store.petKindFor(rich), rich.equippedPet);
  const file = JSON.parse(mem.text(web.store.participantFileName(rich.name)));
  assert.ok(file.spends.some(s => s.kind === "buy" && s.pet === target && s.cost === shop.priceOf(target)));
  assert.equal(file.tokensSpent, shop.spentTotal(rich));
  const poor = { ...rich, spends: [...rich.spends, { id: "s:big", at: "x", kind: "buy", cost: 9999 }] };
  assert.match(shop.buyBlock(poor, web.pets.petGridOrder().find(k => !own(rich, k)) ?? 0), /Needs|owned/);
});

test("buy: a buried pet comes back from the grave with its colour", { skip: skipReason }, async () => {
  const { rich, mem } = await fresh();
  const k = web.pets.petGridOrder().find(x => own(rich, x) && x < C.PET_COUNT && shop.priceOf(x) <= shop.balance(rich));
  if (k === undefined) return;
  const hue = rich.pets[String(k)];
  delete rich.pets[String(k)]; rich.graves[String(k)] = hue;          /* as if it drowned */
  await web.store.saveParticipant(rich, null, [String(k)]);
  assert.equal(shop.buyBlock(rich, k), "");
  const r = await shop.buy(rich, k);
  assert.ok(r && r.revived);
  assert.ok(own(rich, k) && !web.pets.isGrave(rich, k));
  assert.equal(rich.pets[String(k)], hue, "keeps the colour it had");
  const file = JSON.parse(mem.text(web.store.participantFileName(rich.name)));
  assert.ok(!(String(k) in file.graves), "the grave is gone from the file too");
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
  const before = shop.balance(rich), r = await shop.plinkoPlay(rich);
  assert.ok(r);
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
  const e = { eid: "c:h", ts: day + "T13:00:00", date: day, oz: M.capFor(p, day) + 10, by: "test" };
  p.entries.push(e);
  await web.store.saveParticipant(p, null);
  await web.pets.reconcilePets();
  const dead = Number(p.deadKind);
  assert.ok(dead >= 0 && dead < C.PET_COUNT, "a pen pet drowned, not the reward itself");
  assert.ok(!own(p, C.HOMUNCULUS_KIND), "and the reward went with it");

  p.entries = p.entries.filter(x => x.eid !== e.eid);                   /* undo: the pet is revived */
  await web.store.saveParticipant(p, [e.eid]);
  await web.pets.reconcilePets();
  assert.ok(own(p, dead));
  assert.ok(own(p, C.HOMUNCULUS_KIND), "all 25 alive again: it comes back");
});

test("full-pen reward at format 21 keeps R55's rule: a buried pet counts as found", { skip: skipReason }, async () => {
  const { S, M } = await fresh(false);
  const p = S.participants.find(x => M.isActive(x));
  wholePen(p);
  delete p.pets["5"]; p.graves["5"] = 1;
  assert.ok(web.pets.penComplete(p));
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
