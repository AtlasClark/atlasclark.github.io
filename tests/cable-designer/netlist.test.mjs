/* Cable Designer: from-to list import (parse, plan, build, layout). Fake data only.
   Run: node --test "tests/cable-designer/*.test.mjs" */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ctx = vm.createContext({});
for (const f of ["lib.js", "model.js", "scene.js", "netlist.js"]) vm.runInContext(readFileSync(new URL("../../tools/cable-designer/js/" + f, import.meta.url), "utf8"), ctx);
const CD = ctx.CD;
const plain = o => JSON.parse(JSON.stringify(o));

const LIST = [
  "Wire,From,From Pin,To,To Pin,Signal,Gauge,Colour,Length",
  "1,P1,2,P2,1,TX,24,WH/BU,36",
  "2,P1,3,P2,2,RX,24 AWG,blue,36",
  "3,P1,5,P2,3,GND,22,Black,36",
  "4,P1,9,P3,1,PWR,0.5 mm²,RD,12",
  "5,P2,4,GND1,,CHGND,18,GN/YE,6"
].join("\r\n");

test("from-to list: headings, values and references", () => {
  const n = CD.parseFromTo(LIST);
  assert.deepEqual(plain(Object.keys(n.cols).sort()), ["aPin", "aRef", "bPin", "bRef", "color", "len", "sig", "size", "wire"]);
  assert.equal(n.rows.length, 5);
  assert.deepEqual(plain(n.rows[0]).color, "WH");
  assert.equal(n.rows[0].stripe, "BU");
  assert.equal(n.rows[1].color, "BU");
  assert.deepEqual([n.rows[3].gauge, n.rows[3].gu], ["0.5", "mm2"]);
  assert.equal(n.rows[4].color, "GNYE");
  assert.deepEqual(plain(n.refs.map(r => r.ref)), ["P1", "P2", "P3", "GND1"]);
  assert.deepEqual(plain(n.refs[0].pins), ["2", "3", "5", "9"]);
  assert.equal(n.warn.length, 0);
});

test("from-to list: ref:pin in one cell, tabs, bad values and repeats", () => {
  const n = CD.parseFromTo("From\tTo\tColor\nJ1:1\tJ2-A\tpurple\nJ1:2\tJ2-B\tnope\nJ1:2\tJ2-B\t\nJ1:3\tJ1:3\t");
  assert.deepEqual(plain(n.rows[0].a), { ref: "J1", pin: "1" });
  assert.deepEqual(plain(n.rows[0].b), { ref: "J2", pin: "A" });
  assert.equal(n.rows[0].color, "VT");
  assert.equal(n.rows.length, 2);
  assert.equal(n.warn.length, 3);   // colour not read, repeat, same pin
  assert.throws(() => CD.parseFromTo("Name,Qty\nx,1"), /From and To/);
});

test("plan: one cable per connector pair, splice for 3+ pin nets, node refs stay direct", () => {
  const n = CD.parseFromTo("From,From pin,To,To pin\nP1,1,P2,1\nP1,1,P3,1\nP1,2,P2,2\nP1,4,GND,\nP3,4,GND,");
  const pl = CD.netPlan(n, { nodes: ["GND"] });
  assert.equal(pl.splices.length, 1);
  assert.equal(pl.splices[0].ends.length, 3);
  assert.deepEqual(plain(pl.cables.map(c => [c.label, c.rows.length])), [["P1 – P2", 1]]);
  assert.equal(pl.loose.length, 2);
  assert.equal(CD.netPlan(n, { nodes: ["GND"], splice: false }).splices.length, 0);
});

test("pin check: fixed library type, custom and My parts", () => {
  const p = CD.blankProject();
  assert.deepEqual(plain(CD.missingPins(p, "P1", ["1", "9", "12"], { t: "lib", key: "de9" })), ["12"]);
  assert.deepEqual(plain(CD.missingPins(p, "P1", ["1", "A", "SH"], { t: "lib", key: "custom" })), []);
  const part = CD.partFromConn(CD.newConn(p, "m12a5", 0, 0), "EX M12");
  assert.deepEqual(plain(CD.missingPins(p, "P1", ["1", "6"], { t: "part", part })), ["6"]);
});

test("build: connectors, cables, splices, signals and lengths", () => {
  const p = CD.blankProject();
  const n = CD.parseFromTo(LIST);
  const made = CD.buildFromNetlist(p, n, { map: { P1: { t: "lib", key: "de9" }, P3: { t: "lib", key: "custom" }, GND1: { t: "lib", key: "ground" } } });
  assert.deepEqual(plain(p.conns.map(c => [c.ref, c.lib, c.pins.length])), [["P1", "de9", 9], ["P2", "custom", 4], ["P3", "custom", 1], ["GND1", "ground", 1]]);
  assert.deepEqual(plain(p.cables.map(c => [c.ref, c.len, CD.conductors(p, c).length])), [["W1", "36", 3], ["W2", "12", 1]]);
  const w1 = p.cables[0], rows = CD.wireRows(p).map(r => r.cells.slice(0, 7));
  assert.deepEqual(plain(rows[0]), ["1", "W1", "24 AWG", "WH/BU", "36.00", "P1:2", "P2:1"]);
  assert.equal(p.conns[0].pins[1].sig, "TX");
  assert.equal(p.conns[1].pins[3].sig, "CHGND");
  const g = p.wires.find(w => !w.cable);
  assert.equal(CD.wireRef(p, g), "5");
  assert.equal(CD.endText(p, g.b), "GND1");
  assert.equal(made.warn.length, 0);
  assert.equal(CD.checks(p).filter(c => c.lvl === "err").length, 0);
  void w1;
});

test("build: loose choice, cable profile and missing pins", () => {
  const p = CD.blankProject();
  const n = CD.parseFromTo("From,From pin,To,To pin,Colour\nP1,1,P2,1,BN\nP1,2,P2,2,WH\nP1,3,P2,9,");
  const sp = CD.blankProject();
  const part = CD.partFromCable(sp, CD.cablePreset(sp, "stp"), "EX STP");
  const key = CD.netPlan(n).cables[0].key;
  const made = CD.buildFromNetlist(p, n, { map: { P1: { t: "lib", key: "de9" }, P2: { t: "lib", key: "m12a5" } }, cables: { [key]: { t: "part", part } } });
  const list = CD.conductors(p, p.cables[0]);
  assert.equal(list.length, 4);   // WH, BN, drain + one added
  assert.equal(list.find(w => w.color === "BN").a.p, 0);
  assert.equal(list.find(w => w.color === "WH").a.p, 1);
  assert.ok(made.warn.some(s => /too few conductors/.test(s)));
  assert.ok(made.warn.some(s => /no pin "9"/.test(s)));

  const q = CD.blankProject();
  CD.buildFromNetlist(q, n, { cables: { [key]: { t: "loose" } } });
  assert.equal(q.cables.length, 0);
  assert.deepEqual(plain(q.wires.map(w => w.ref)), ["1", "2", "3"]);
});

test("build: Cable column names the cable; a splice gets one wire per pin", () => {
  const p = CD.blankProject();
  const n = CD.parseFromTo("Cable,From,From pin,To,To pin,Signal\nW7,P1,1,P2,1,A\nW7,P1,2,P2,2,B\n,P1,3,P2,3,V\n,P1,3,P3,3,V");
  CD.buildFromNetlist(p, n, {});
  assert.deepEqual(plain(p.cables.map(c => c.ref)), ["W7"]);
  const sp = p.conns.find(c => c.lib === "splice");
  assert.equal(sp.ref, "SP1");
  assert.equal(sp.pins[0].sig, "V");
  assert.equal(p.wires.filter(w => w.b && w.b.c === sp.id).length, 3);
});

test("build into a drawing: an existing connector is used, new block avoids it", () => {
  const p = CD.example();
  const have = p.conns.find(c => c.ref === "P1");
  const n = CD.parseFromTo("From,From pin,To,To pin\nP1,4,J9,1\nP1,7,J9,2");
  const made = CD.buildFromNetlist(p, n, { map: { P1: { t: "have", id: have.id }, J9: { t: "lib", key: "custom" } } });
  assert.equal(made.conns.length, 1);
  assert.equal(p.conns.filter(c => c.ref === "P1").length, 1);
  CD.layoutNet(p, made);
  const r = CD.placeBlock(p, made);
  assert.ok(r.fits);
  const sc = CD.scene(p, { sheet: 1 });
  const mine = new Set(["c:" + made.conns[0].id, "w:" + made.cables[0].id]);
  const boxes = sc.groups.filter(g => g.box && !["wire", "tie", "frame"].includes(g.kind));
  const ov = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  boxes.filter(g => mine.has(g.id)).forEach(a => boxes.filter(g => !mine.has(g.id)).forEach(b => assert.ok(!ov(a.box, b.box), a.id + " overlaps " + b.id)));
});

test("layout: a chain runs left to right, cables between their connectors", () => {
  const p = CD.blankProject();
  p.meta.showWires = false; p.meta.showBom = false;
  const n = CD.parseFromTo("From,From pin,To,To pin\nP1,1,A1,1\nP1,2,A1,2\nA1,3,P2,1\nA1,4,P2,2");
  const made = CD.buildFromNetlist(p, n, { map: { A1: { t: "lib", key: "board" } } });
  CD.layoutNet(p, made);
  assert.ok(CD.placeBlock(p, made).fits);
  const sc = CD.scene(p, { sheet: 1 });
  const box = id => sc.groups.find(g => g.id === id).box;
  const [P1, A1, P2] = ["P1", "A1", "P2"].map(r => box("c:" + p.conns.find(c => c.ref === r).id));
  const xs = [P1, A1, P2].map(b => b.x).sort((a, b) => a - b);
  assert.ok(xs[0] < xs[1] && xs[1] < xs[2], "three columns");
  const mid = b => b.x + b.w / 2;
  p.cables.forEach(c => {
    const w = p.wires.find(x => x.cable === c.id), W = box("w:" + c.id);
    const [L, R] = [w.a.c, w.b.c].map(id => box("c:" + id)).sort((a, b) => a.x - b.x);
    assert.ok(W.x > L.x + L.w && W.x + W.w < R.x, c.ref + " sits in the gap between its connectors");
    void mid;
  });
});

test("layout: splices and grounds sit in the gaps, not in a column of their own", () => {
  const p = CD.blankProject();
  const n = CD.parseFromTo(LIST + "\r\n7,P1,1,P2,5,SENSE,24,YE,36\r\n8,P1,1,P3,3,SENSE,24,YE,18");
  const made = CD.buildFromNetlist(p, n, { map: { P1: { t: "lib", key: "de9" }, P2: { t: "lib", key: "m12a5" }, GND1: { t: "lib", key: "ground" } } });
  CD.layoutNet(p, made);
  assert.ok(CD.placeBlock(p, made).fits);
  const sc = CD.scene(p, { sheet: 1 });
  const box = c => sc.groups.find(g => g.id === "c:" + c.id).box;
  const big = p.conns.filter(c => !["splice", "ground"].includes(CD.libOf(c).kind)).map(box);
  assert.equal(new Set(big.map(b => b.x)).size, 3);
  p.conns.filter(c => ["splice", "ground"].includes(CD.libOf(c).kind)).forEach(c => {
    const b = box(c);
    big.forEach(o => assert.ok(b.x + b.w <= o.x || b.x >= o.x + o.w, c.ref + " is clear of the connector columns"));
  });
});
