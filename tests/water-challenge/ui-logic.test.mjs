/* Layout choice, the dive rule, pet-event times and the undo prompt, checked against
   what they promise. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import { skipReason, readDataFiles, backupDay, dayKeys, setToday, loadWeb, web } from "./lib/bridge.mjs";

const JS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../tools/water-challenge/js/");
const G = await import(pathToFileURL(path.join(JS, "glass.js")));
const C = web.C;

test("layout: as many across as stay comfortable, one more column at a time", () => {
  const L = (n, w) => G.pickLayout(n, w);
  assert.deepEqual(L(8, 748), { cols: 4, rows: 2, card: 164 }, "8 on a mid screen: 4 + 4");
  assert.deepEqual(L(8, 1867), { cols: 8, rows: 1, card: 212 }, "8 on a full-HD screen: one row, bigger cards");
  assert.equal(L(9, 1867).cols, 8, "9: MAX_COLS stops a row of 9, so 8 + 1");
  assert.equal(L(8, 343).cols, 2, "phone: two across");
  assert.equal(L(1, 240).cols, 1, "one person, narrowest: one card");
  const steps = [];                                   /* 8 people, widening: 4 + 4, 5 + 3, 6 + 2, 7 + 1, 8 */
  for (let w = 700; w <= 1900; w += 4) { const c = L(8, w).cols; if (steps[steps.length - 1] !== c) steps.push(c); }
  assert.deepEqual(steps, [4, 5, 6, 7, 8], "one column at a time, never back");
  for (let n = 1; n <= 16; n++) {
    let prev = 0;
    for (let w = 240; w <= 1900; w += 37) {
      const lay = L(n, w), fit = c => (w / c - C.CARD_GAP * 2);
      assert.ok(lay.cols <= Math.min(n, C.MAX_COLS) && lay.cols >= 1, n + "@" + w + " cols");
      assert.ok(lay.cols >= prev, n + "@" + w + " a wider screen never has fewer across");
      prev = lay.cols;
      assert.ok(lay.card <= C.CARD_MAX && lay.card >= C.CARD_MIN, n + "@" + w + " card");
      assert.equal(lay.card % C.CARD_STEP, 0, n + "@" + w + " snapped");
      assert.equal(lay.rows, Math.ceil(n / lay.cols));
      assert.ok(lay.cols === 1 || fit(lay.cols) >= C.CARD_COMFORT, n + "@" + w + " comfortable");
      if (lay.cols < Math.min(n, C.MAX_COLS)) assert.ok(fit(lay.cols + 1) < C.CARD_COMFORT, n + "@" + w + " one more would have fit");
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
  const half = C.DIVE_UNDER_SECS / 2;
  assert.ok(st.m.dive > 0 && st.m.dive < half, "on the way down");
  st.level = st.target = 0.02;
  G.stepMotion(st, 1);
  assert.ok(st.m.dive > half, "now on the way up");
});

test("dives: leave the water on an arc at the speed they rose, never a dead stop", () => {
  for (const level of [0.45, 0.7, 1]) {
    const st = pet(level, level);
    G.diveProbe.start(st);
    const m = st.m, r = G.petR(), Tu = C.DIVE_UNDER_SECS, T = G.diveProbe.secs(m), eps = 1e-4;
    const at = s => G.diveProbe.path(m, s);
    assert.ok(Math.abs(at(Tu).y) < 1e-6, "surfaces at the end of the under phase");
    assert.ok(at(Tu - eps).vy < 0 && at(Tu + eps).vy < 0, "still rising as it breaks the surface");
    assert.ok(-at(Tu + eps).vy >= -at(Tu - eps).vy * 0.4, "the jump carries on the rise instead of stopping");
    let peak = 0;
    for (let s = Tu; s <= T; s += 0.005) peak = Math.max(peak, -at(s).y);
    assert.ok(peak >= r * C.BREACH_MIN_R * 0.98, "it clears the water: " + (peak / r).toFixed(2) + "r at level " + level);
    assert.ok(peak <= r * C.BREACH_R + 1e-6, "the jump is capped");
    assert.ok(Math.abs(at(T).y) < 1e-6, "lands back on the surface");
    assert.ok(at(T / 2).x > 0 && at(T).x > at(T / 2).x, "moves forward along the way");
  }
});

test("headroom: the tallest pet at the top of a jump from a full glass stays on the pet layer", () => {
  for (let card = C.CARD_MIN; card <= C.CARD_MAX; card += C.CARD_STEP) {
    G.applyLayout({ card, cols: 1 + (card % 3) });
    const r = G.petR(), anchorFromTop = G.dims.head + 3 + C.SURFACE_BAND;   /* full glass, canvas px */
    assert.ok(anchorFromTop - r * C.BREACH_R - r * C.TALLEST_PET_R >= 0, "card " + card);
  }
});

test("turns: at a side the pet turns about 90% of the time", () => {
  const st = pet(0.5, 0.5);
  st.m.nextDive = st.m.nextHop = 1e12;
  let reversals = 0, kept = 0, lastDrift = 0;
  for (let i = 0; i < 400000; i++) {
    st.phase += C.WAVE_SPEED;
    const before = st.m.face;
    G.stepMotion(st, 1);
    if (st.m.drift !== lastDrift && lastDrift !== 0) {
      reversals++;
      if (st.m.face === before && before !== st.m.drift) kept++;
    }
    lastDrift = st.m.drift;
  }
  const share = kept / reversals;
  assert.ok(reversals > 1500, reversals + " reversals");
  assert.ok(share > 0.07 && share < 0.13, "kept facing on " + (share * 100).toFixed(1) + "% of reversals");
});

test("pour: the level waits for the stream to land, then rises with it", () => {
  const st = pet(0.2, 0.2);
  G.pour(Object.keys(G.anim).find(k => G.anim[k] === st), 24, "#60a5fa");
  st.target = 0.6;
  const dur = st.pour.dur;
  for (let i = 0; i < Math.floor(dur * C.POUR_LAND * 30) - 1; i++) G.stepState(st, 1);
  assert.equal(st.level, 0.2, "held while the stream falls");
  for (let i = 0; i < 10; i++) G.stepState(st, 1);
  assert.ok(st.level > 0.2 && st.level < 0.6, "rising while it pours");
  for (let i = 0; i < 30 * 8; i++) G.stepState(st, 1);
  assert.equal(st.pour, null);
  assert.ok(Math.abs(st.level - 0.6) < 0.001, "settles on the new level");
});

test("drop-in: a held pet waits, then falls in and floats", () => {
  const st = pet(0.5, 0.5), name = Object.keys(G.anim).find(k => G.anim[k] === st);
  G.dropIn(name, 12);
  run(st, 3);
  assert.ok(G.dropping(name), "still held");
  G.releaseDrop(name);
  run(st, C.DROP_SECS + 0.2);
  assert.equal(G.dropping(name), false, "landed");
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

test("turns: a pet seen for the first time already faces its drift (no turn on load)", () => {
  for (let i = 0; i < 200; i++) {
    const st = pet(0.5, 0.5);
    st.m.nextDive = st.m.nextHop = 1e12;
    st.phase = Math.random() * 6.283;
    G.stepMotion(st, 1);
    if (st.m.drift) assert.equal(st.m.flip, st.m.face, "no turn animation on first sight");
  }
});

test("identity: usernames come from the data, and a near-miss is caught", () => {
  const M = web.model, keep = M.S.participants;
  M.S.participants = [
    { name: "A", entries: [{ by: "rclark" }, { by: "rclark" }, { by: "Hidrate" }, { by: "" }], spends: [{ by: "ajones" }] },
    { name: "B", entries: [{ by: "RClark" }, { by: "tmiller" }, { by: "unknown" }] }
  ];
  try {
    assert.deepEqual(M.knownUsers(), [{ user: "ajones", n: 1 }, { user: "rclark", n: 3 }, { user: "tmiller", n: 1 }],
                     "people only, case folded, A to Z");
    assert.deepEqual(M.matchUser("RCLARK"), { same: "rclark" });
    assert.deepEqual(M.matchUser("rclakr"), { near: "rclark" }, "a swap is two letters off");
    assert.deepEqual(M.matchUser("tmliler"), { near: "tmiller" });
    assert.deepEqual(M.matchUser("gjuan"), {}, "a new person is not flagged");
  } finally { M.S.participants = keep; }
});

test("walls: each pet's reach is measured, and its drawing stays inside the glass facing either way", async () => {
  const e = G.critterExtent(0);
  assert.ok(Math.abs(e.left - 0.88) < 0.01 && Math.abs(e.right - 0.66) < 0.01, "the duck: bill 0.88 r ahead, tail 0.66 r behind");
  assert.ok(G.critterExtent(C.MYSTERY_KIND).right > 1.4, "the dragon's tail reaches far behind");
  for (const [n, w] of [[8, 343], [8, 748], [3, 1300]]) {                /* narrowest and widest glasses */
    G.applyLayout(G.pickLayout(n, w));
    const r = G.petR(), W = G.dims.W;
    for (let k = 0; k < C.PET_MAX; k++) {
      const st = G.animState("w" + k + "-" + w), x = G.critterExtent(k);
      st.duckState = 1; st.critterKind = k;
      for (const flip of [1, -1, 0.3]) {
        st.m.flip = flip;
        for (let i = 0; i < 64; i++) {
          st.phase = i / 64 * 2 * Math.PI / 0.31;
          st.m.xs = i % 2 ? r * 1.6 : -r * 1.6;                          /* as if a dive pushed it either way */
          const px = G.petX(st);
          const left = (flip >= 0 ? flip * x.left : -flip * x.right) * r, right = (flip >= 0 ? flip * x.right : -flip * x.left) * r;
          if (left + right + 2 * r * C.WALL_GAP_R > W) { assert.equal(px, W / 2, "too wide for this glass: centred"); continue; }
          assert.ok(px - left >= -1e-9 && px + right <= W + 1e-9, C.PET_NAMES[k] + " in a " + W + "px glass, facing " + flip + ": " + (px - left).toFixed(1) + ".." + (px + right).toFixed(1));
        }
      }
    }
  }
});

test("walls: a dive near the wall turns round toward open water", () => {
  const st = pet(0.8, 0.8), r = G.petR();
  st.critterKind = 0;
  st.m.face = st.m.flip = st.m.drift = 1;                                 /* facing left */
  st.phase = 1.5 * Math.PI / 0.31;                                        /* the far left of its drift */
  run(st, 0.1);
  assert.ok(st.m.dive >= 0, "dived");
  assert.equal(st.m.fwd, 1, "heading right, away from the left wall");
});

test("walls: a pet's own swim range makes it wander less; its reach still limits it", async () => {
  const P = await import(pathToFileURL(path.join(JS, "petdefs.js")));
  G.applyLayout(G.pickLayout(8, 748));
  const W = G.dims.W, st = G.animState("range-test");
  st.duckState = 1; st.critterKind = 0; st.m.flip = 1; st.m.xs = 0;
  const swing = () => { let m = 0; for (let i = 0; i < 200; i++) { st.phase = i / 200 * 2 * Math.PI / 0.31; m = Math.max(m, Math.abs(G.petX(st) - W / 2)); } return m; };
  const small = { pal: { b: { c: "#888888" } }, swim: [{ t: "ell", x: 0, y: -0.3, rx: 0.3, ry: 0.3, fill: "b" }], crown: [0, -1] };
  P.applyDefs({ format: 1, pets: { "0": small } });
  const full = swing();
  assert.ok(Math.abs(full - W * C.SWIM_RANGE) < 0.5, "a small pet swims the normal range");
  P.applyDefs({ format: 1, pets: { "0": Object.assign({ range: 0.5 }, small) } });
  assert.ok(Math.abs(swing() - full / 2) < 0.5, "range 0.5: half as far");
  P.applyDefs({ format: 1, pets: { "0": Object.assign({ range: 7 }, small) } });
  assert.equal(P.defs[0].range, 1, "clamped to 1");
  P.applyDefs({ format: 1, pets: {} });
});

/* ---- visits between glasses ---------------------------------------------- */
function glassRow(names, cols) {
  G.applyLayout(G.pickLayout(8, 748));
  G.dims.cols = cols;
  G.setOrder(names);
  return names.map(n => {
    const st = G.animState(n);
    st.duckState = 1; st.critterKind = 0; st.level = st.target = 0.5; st.dcv = {};
    st.visit = null; st.guest = null;
    Object.assign(st.m, { dive: -1, hop: -1, drop: -1, nextVisit: 1e9 });
    return st;
  });
}
const steps = (secs) => { for (let i = 0; i < secs * 30; i++) G.stepVisits(1); };

test("visits: only the glass beside it in the same row is a neighbour", () => {
  glassRow(["n1", "n2", "n3", "n4", "n5"], 3);
  assert.deepEqual(G.neighborsOf("n1"), ["n2"]);
  assert.deepEqual(G.neighborsOf("n2"), ["n1", "n3"]);
  assert.deepEqual(G.neighborsOf("n3"), ["n2"], "the row ends at three");
  assert.deepEqual(G.neighborsOf("n4"), ["n5"], "next row");
  assert.deepEqual(G.neighborsOf("nobody"), []);
});

test("visits: leap over, play faster, leap home", () => {
  const [a, b] = glassRow(["va", "vb", "vc"], 3);
  assert.ok(G.startVisit("va", "vb"));
  assert.equal(G.visitOf("va").stage, "out");
  assert.equal(b.guest, "va", "the host is taken from the start");
  steps(C.VISIT_JUMP_SECS + 0.1);
  assert.equal(G.visitOf("va").stage, "there");
  assert.equal(b.play, C.VISIT_PLAY, "the host plays more");
  assert.equal(a.visit.sw.play, C.VISIT_PLAY, "and so does the guest");
  a.visit.until = a.m.t;                                   /* the stay is up */
  a.visit.sw.m.dive = -1; a.visit.sw.m.hop = -1;
  steps(0.1);
  assert.equal(G.visitOf("va").stage, "back");
  assert.equal(b.guest, null);
  steps(C.VISIT_JUMP_SECS + 0.1);
  assert.equal(G.visitOf("va"), null, "home");
  assert.equal(b.play, 1);
});

test("visits: a new ranking that moves the glasses apart sends the guest home", () => {
  glassRow(["ra", "rb", "rc"], 3);
  G.startVisit("ra", "rb");
  steps(C.VISIT_JUMP_SECS + 0.1);
  assert.equal(G.visitOf("ra").stage, "there");
  G.setOrder(["ra", "rc", "rb"]);                          /* rb is no longer beside ra */
  steps(0.05);
  assert.equal(G.visitOf("ra").stage, "back", "leaves at once, even mid-stay");
  steps(C.VISIT_JUMP_SECS + 0.1);
  assert.equal(G.visitOf("ra"), null);
});

test("visits: drowning, a new pet or a glass leaving the screen end a visit", () => {
  const [a, b] = glassRow(["da", "db"], 2);
  G.startVisit("da", "db");
  G.startSink("da", 0, 0);
  assert.equal(G.visitOf("da"), null, "goes under at home");
  assert.equal(b.guest, null);
  glassRow(["da", "db"], 2);
  G.startVisit("da", "db"); steps(C.VISIT_JUMP_SECS + 0.1);
  G.startSink("db", 0, 0);                                 /* the host's pet goes under */
  assert.equal(G.visitOf("da").stage, "back");
  glassRow(["da", "db"], 2);
  G.startVisit("da", "db");
  b.dcv = null;                                            /* the host's glass went off screen */
  steps(0.05);
  assert.equal(G.visitOf("da"), null);
  glassRow(["da", "db"], 2);
  G.startVisit("da", "db");
  a.critterKind = 3;                                       /* wears a different pet now */
  steps(0.05);
  assert.equal(G.visitOf("da"), null);
});

test("visits: only from a settled pet with water, to a free neighbour with water", () => {
  const real = Math.random;
  Math.random = () => 0;                                   /* every chance comes up */
  try {
    let [a, b] = glassRow(["ea", "eb"], 2);
    b.level = b.target = 0.05;                             /* almost dry */
    a.m.nextVisit = 0; steps(0.05);
    assert.equal(G.visitOf("ea"), null, "not into a dry glass");
    [a, b] = glassRow(["ea", "eb"], 2);
    a.m.dive = 0.5; a.m.nextVisit = 0;
    G.stepVisits(1);
    assert.equal(G.visitOf("ea"), null, "not mid-dive");
    [a, b] = glassRow(["ea", "eb"], 2);
    b.guest = "someone";
    a.m.nextVisit = 0; steps(0.05);
    assert.equal(G.visitOf("ea"), null, "one guest at a time");
    [a, b] = glassRow(["ea", "eb"], 2);
    a.m.nextVisit = 0; G.stepVisits(1);
    assert.equal(G.visitOf("ea").host, "eb", "otherwise it goes");
  } finally { Math.random = real; }
});

test("goal rolls: hidden until the unlock card closes, from the activity list and the Pets tab", async () => {
  const R = await import(pathToFileURL(path.join(JS, "reveal.js")));
  const { todayKey } = await import(pathToFileURL(path.join(JS, "util.js")));
  const p = { name: "rolltest", petRollDay: todayKey(), rollKind: 3, rollWasNew: true, entries: [], pets: { "3": 40 }, spends: [] };
  assert.equal(R.rollHoldLeft(p), 0, "no card and no pour time: shown");
  R.rollCardQueued(p.name);
  assert.equal(R.rollHoldLeft(p), Infinity, "card queued: hidden until it closes");
  assert.ok(R.hiddenPets(p).has(3), "a new pet stays off the Pets tab");
  R.rollCardDone(p.name);
  assert.equal(R.rollHoldLeft(p), 0, "card closed: shown");
  assert.ok(!R.hiddenPets(p).has(3));
  R.rollCardQueued(p.name);
  assert.equal(R.rollHoldLeft(p), Infinity, "a reroll's card hides the new roll again");
  R.rollCardDone(p.name);
  assert.equal(R.rollHoldLeft({ ...p, name: "other", petRollDay: "2000-01-01" }), 0, "not today: never held");
});

test("pets legend: the roll odds add up to exactly 100%, dragon included", async () => {
  const P = await import(pathToFileURL(path.join(JS, "pets.js")));
  const o = P.rollOdds(), tenths = [...o.bins, o.dragon].map(v => Math.round(v * 10));
  assert.equal(tenths.reduce((a, b) => a + b, 0), 1000);
  assert.equal(o.dragon, C.MYSTERY_CHANCE * 100);
  const total = C.PET_BINS.reduce((a, b) => a + b.weight, 0);
  C.PET_BINS.forEach((b, i) => assert.ok(Math.abs(o.bins[i] - (1 - C.MYSTERY_CHANCE) * b.weight / total * 100) <= 0.05, b.name));
});
