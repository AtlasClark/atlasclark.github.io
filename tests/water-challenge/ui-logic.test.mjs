/* Layout choice, the dive rule, pet-event times and the undo prompt. These have no
   R55 counterpart, so they are checked against what they promise. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import { skipReason, readDataFiles, backupDay, dayKeys, setToday, loadWeb, web } from "./lib/bridge.mjs";

const JS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../tools/water-challenge/js/");
const G = await import(pathToFileURL(path.join(JS, "glass.js")));
const C = web.C;

test("layout: fewest rows that keep cards comfortable, shared evenly", () => {
  const L = (n, w) => G.pickLayout(n, w);
  assert.deepEqual(L(8, 748), { cols: 4, rows: 2, card: 164 }, "8 on a mid screen: 4 + 4, not 5 + 3 thin");
  assert.equal(L(5, 748).cols, 3, "5 on a mid screen: 3 + 2 wide, not 5 thin");
  assert.equal(L(6, 1100).cols, 6, "6 on a wide screen: one row");
  assert.equal(L(8, 1364).cols, 4, "8 on the widest screen: MAX_COLS stops a single row of 8");
  assert.equal(L(8, 343).cols, 2, "phone: two across");
  for (let n = 1; n <= 16; n++) {
    for (let w = 240; w <= 1400; w += 37) {
      const lay = L(n, w);
      assert.ok(lay.cols <= C.MAX_COLS && lay.cols >= 1, n + "@" + w + " cols");
      assert.ok(lay.card <= C.CARD_MAX && lay.card >= C.CARD_MIN, n + "@" + w + " card");
      assert.equal(lay.card % C.CARD_STEP, 0, n + "@" + w + " snapped");
      assert.equal(lay.rows, Math.ceil(n / lay.cols));
      assert.ok(lay.cols * (lay.rows - 1) < n, n + "@" + w + " no empty last row");
      if (lay.card >= C.CARD_COMFORT) {
        const fewer = Math.ceil(n / (lay.rows - 1 || 1));
        if (lay.rows > 1 && fewer <= C.MAX_COLS) {
          assert.ok((w / fewer - C.CARD_GAP * 2) < C.CARD_COMFORT, n + "@" + w + " one fewer row would have fit");
        }
      }
    }
  }
});

function pet(level, target) {
  G.applyLayout(G.pickLayout(8, 748));
  const st = G.animState("t" + Math.random());
  st.duckState = 1; st.level = level; st.target = target;
  st.m.nextDive = 0; st.m.nextHop = 1e9;           /* a dive is due at once */
  return st;
}
const run = (st, secs) => { for (let i = 0; i < secs * 30; i++) G.stepMotion(st, 1); };

test("dives: only with enough water under the surface, now and where it is heading", () => {
  const need = G.petR() * C.DIVE_MIN_DEPTH_R / (G.dims.H - C.SURFACE_BAND);
  const shallow = pet(need * 0.9, need * 0.9);
  run(shallow, 120);
  assert.equal(shallow.m.dive, -1, "never dives in shallow water");

  const draining = pet(0.9, need * 0.5);              /* full now, an undo is taking it down */
  draining.m.nextDive = 0;
  G.stepMotion(draining, 1);
  assert.equal(draining.m.dive, -1, "no dive while the level is heading below the line");

  const deep = pet(need * 1.1, need * 1.1);
  G.stepMotion(deep, 1);
  assert.ok(deep.m.dive >= 0, "dives once there is room");
});

test("dives: the water dropping mid-dive turns the pet back up", () => {
  const st = pet(0.9, 0.9);
  G.stepMotion(st, 1);
  run(st, 0.5);
  assert.ok(st.m.dive > 0 && st.m.dive < 0.5, "on the way down");
  st.level = st.target = 0.02;
  G.stepMotion(st, 1);
  assert.ok(st.m.dive > 0.5, "now on the way up");
});

test("pet events carry the time of the pour that caused them; undo says what it costs", { skip: skipReason }, async () => {
  const files = readDataFiles(), day = dayKeys(backupDay(files), "2099-01-01")[1];   /* fresh day */
  setToday(day);
  const { S } = await loadWeb(files);
  const M = web.model, P = web.pets;
  const p = S.participants.find(x => M.isActive(x));
  const goal = M.personalGoal(p, day), cap = M.capFor(p, day);
  const add = async (n, oz) => {
    const e = { eid: "u:" + n, ts: day + "T1" + n + ":00:00", date: day, oz, by: "test" };
    p.entries.push(e);
    await web.store.saveParticipant(p, null);
    await P.reconcilePets();
    return e;
  };

  await add(1, goal / 2);
  const crossing = await add(2, goal / 2 + 1);
  await add(3, 4);
  assert.equal(p.petRollDay, day);
  assert.equal(M.petEventTimes(p, day).roll, crossing.ts, "roll time is the pour that crossed the goal");
  assert.match(P.undoEffect(p, crossing.eid), /goes back|roll is taken back/);
  assert.equal(P.undoEffect(p, "u:3"), "", "a pour after the goal costs nothing");

  const over = await add(4, cap);
  assert.equal(p.graveDay, day);
  assert.equal(M.petEventTimes(p, day).grave, over.ts, "drowning time is the pour that passed the cap");
  assert.match(P.undoEffect(p, over.eid), /comes back to life/);

  /* Undo it: the pet is revived and its row leaves the feed. */
  p.entries = p.entries.filter(e => e.eid !== over.eid);
  await web.store.saveParticipant(p, [over.eid]);
  await P.reconcilePets();
  assert.notEqual(p.graveDay, day);
  assert.equal(M.petEventTimes(p, day).grave, "");
});
