/* Pet events: for every active person, pour to the goal, past the cap, then undo
   twice, and compare the pet state after each step with what R55 does. Two cases
   where the web build deliberately differs are pinned down at the end. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { skipReason, readDataFiles, backupDay, setToday, loadR55, loadWeb, web, Diff, clone, dayKeys } from "./lib/bridge.mjs";

const FIELDS = ["pets", "graves", "equippedPet", "petRollDay", "rollKind", "rollWasNew", "lastRoll", "prevRoll", "graveDay", "deadKind"];
const petState = p => Object.fromEntries(FIELDS.map(f => [f, f === "pets" || f === "graves" ? sortKeys(p[f]) : p[f]]));
const sortKeys = o => Object.fromEntries(Object.keys(o || {}).sort((a, b) => a - b).map(k => [k, o[k]]));

/* The pet half of R55's updateGlasses, for one person, as a fresh window sees it. */
function r55Reconcile(ctx, p) {
  const key = ctx.todayKey(), total = ctx.totalOn(p, key), goal = ctx.personalGoal(p, key);
  const danger = ctx.pastCap(total, p, key);
  if (ctx.metGoal(total, goal)) ctx.maybeRollPet(p);
  if (p.graveDay === key && Number(p.deadKind) >= 0 && !danger) ctx.revivePet(p);
  if (p.petRollDay === key && Number(p.rollKind) >= 0 && !ctx.metGoal(total, goal)) ctx.undoRoll(p);
  if (danger) {
    const victim = ctx.ownsEquipped(p) ? ctx.petKindFor(p) : ctx.pickVictim(p);
    if (victim >= 0 && p.pets && Object.prototype.hasOwnProperty.call(p.pets, String(victim))) ctx.killPet(p);
  }
}

async function both(files, day) {
  setToday(day);
  const r = loadR55(files);
  const w = await loadWeb(files);
  return { ctx: r.ctx, S: w.S };
}

function entry(day, n, oz) {
  return { eid: "t:" + day + ":" + n, ts: day + "T13:0" + n + ":00", date: day, oz, by: "test" };
}

async function pour(ctx, rp, wp, e) {
  rp.entries.push(clone(e)); ctx.saveParticipant(rp, null); ctx.dataChanged();
  wp.entries.push(clone(e)); await web.store.saveParticipant(wp, null);
}
async function unpour(ctx, rp, wp, eid) {
  rp.entries = rp.entries.filter(x => x.eid !== eid); ctx.saveParticipant(rp, [eid]); ctx.dataChanged();
  wp.entries = wp.entries.filter(x => x.eid !== eid); await web.store.saveParticipant(wp, [eid]);
}

for (const shift of [0, 1]) test("roll, drown, revive and roll-back match R55 for every active person" +
                                  (shift ? " (next day, fresh rolls)" : " (backup day)"), { skip: skipReason }, async () => {
  const files = readDataFiles(), day = dayKeys(backupDay(files), "2099-01-01")[shift], d = new Diff();
  let rolls = 0;
  const { ctx: probe } = await both(files, day);
  const names = probe.participants.filter(p => probe.isActive(p)).map(p => p.name);
  assert.ok(names.length > 0);

  for (const name of names) {
    const { ctx, S } = await both(files, day);       /* fresh copy per person */
    const M = web.model, rp = ctx.findParticipant(name), wp = M.findParticipant(name);
    const others = () => S.participants.filter(p => p.name !== name).map(petState);
    const before = others();
    d.eq(name + " start", petState(rp), petState(wp));

    const step = async label => {
      r55Reconcile(ctx, rp);
      await web.pets.reconcilePets();
      d.eq(name + " " + label, petState(rp), petState(wp));
    };
    const total = () => ctx.totalOn(rp, day), goal = ctx.personalGoal(rp, day);
    const toGoal = Math.max(0.5, Math.ceil(goal - total()) + 0.5);
    await pour(ctx, rp, wp, entry(day, 1, toGoal));
    await step("at goal");
    if (wp.petRollDay === day) rolls++;
    const toCap = Math.ceil(ctx.capFor(rp, day) - total()) + 5;
    await pour(ctx, rp, wp, entry(day, 2, toCap));
    await step("past cap");
    await unpour(ctx, rp, wp, "t:" + day + ":2");
    await step("back under cap");
    await unpour(ctx, rp, wp, "t:" + day + ":1");
    await step("back under goal");
    d.eq(name + " nobody else touched", before, others());
  }
  assert.equal(d.list.length, 0, d.report());
  if (shift) assert.equal(rolls, names.length, "everyone rolls on a fresh day");
});

test("R55 keeps the dragon after it is put away; the web build lets it go", { skip: skipReason }, async () => {
  const files = readDataFiles(), day = backupDay(files);
  const { ctx } = await both(files, day);
  const holder = ctx.participants.find(p => Object.prototype.hasOwnProperty.call(p.pets, "26"));
  if (!holder) return;                                /* nobody holds it in this data */
  const wp = web.model.findParticipant(holder.name);
  holder.equippedPet = 26; wp.equippedPet = 26;

  ctx.equipPet(holder.name, 26);                     /* take it off */
  await web.pets.equipPet(holder.name, 26);
  assert.equal(holder.equippedPet, -1);
  assert.equal(wp.equippedPet, -1);
  assert.ok(Object.prototype.hasOwnProperty.call(holder.pets, "26"), "R55 restores it from disk in the merge");
  assert.ok(!Object.prototype.hasOwnProperty.call(wp.pets, "26"), "web removes it");
});

test("after a dragon drowns, the web build does not drown a second pet the same day", { skip: skipReason }, async () => {
  const files = readDataFiles(), day = backupDay(files);
  const { ctx } = await both(files, day);
  const rp = ctx.participants.find(p => ctx.isActive(p) && Object.keys(p.pets).some(k => k !== "26"));
  const wp = web.model.findParticipant(rp.name);
  for (const p of [rp, wp]) { p.pets["26"] = 0; p.equippedPet = 26; }
  ctx.saveParticipant(rp, null); await web.store.saveParticipant(wp, null);
  const oz = Math.ceil(ctx.capFor(rp, day) - ctx.totalOn(rp, day)) + 5;
  await pour(ctx, rp, wp, entry(day, 3, oz));

  r55Reconcile(ctx, rp);                             /* this window drowns the dragon */
  await web.pets.reconcilePets();
  assert.equal(rp.graveDay, day); assert.equal(wp.graveDay, day);
  assert.equal(Object.keys(rp.graves).length, Object.keys(wp.graves).length);

  const gravesBefore = Object.keys(wp.graves).length;
  r55Reconcile(ctx, rp);                             /* another window, same day */
  await web.pets.reconcilePets();
  assert.equal(Object.keys(rp.graves).length, gravesBefore + 1, "R55 drowns a second pet");
  assert.equal(Object.keys(wp.graves).length, gravesBefore, "web drowns nothing more");
});
