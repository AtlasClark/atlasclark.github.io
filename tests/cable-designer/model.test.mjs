/* Cable Designer: library, model (presets, conductor order, wire list, BOM,
   checks, CSV, normalize) and scene build. Fake data only ("Example Co.",
   EX- part numbers). Run: node --test "tests/cable-designer/*.test.mjs" */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ctx = vm.createContext({});
for (const f of ["lib.js", "model.js", "scene.js"]) vm.runInContext(readFileSync(new URL("../../tools/cable-designer/js/" + f, import.meta.url), "utf8"), ctx);
const CD = ctx.CD;
const plain = o => JSON.parse(JSON.stringify(o));

test("AWG to mm² follows the ASTM B258 formula", () => {
  assert.ok(Math.abs(CD.awgMm2(24) - 0.205) < 0.001);
  assert.ok(Math.abs(CD.awgMm2(18) - 0.823) < 0.001);
});

test("D-sub face: female mating face mirrors the male", () => {
  const p = CD.blankProject();
  const c = CD.newConn(p, "de9", 0, 0);
  c.gender = "male";
  const m = CD.faceLayout(c);
  c.gender = "female";
  const f = CD.faceLayout(c);
  assert.ok(m.pins[0].x < m.pins[4].x, "male pin 1 left of pin 5");
  assert.ok(f.pins[0].x > f.pins[4].x, "female pin 1 right of pin 5");
  assert.equal(Math.round(m.pins[0].x + f.pins[0].x), Math.round(m.w));
});

test("pin count change drops wire ends on removed pins and keeps even counts", () => {
  const p = CD.blankProject();
  const c = CD.newConn(p, "pitch300d", 0, 0); p.conns.push(c);
  const w = CD.newWire(p, { a: { c: c.id, p: 5 } }); p.wires.push(w);
  assert.equal(CD.setPinCount(p, c, 3), 4);
  assert.equal(c.pins.length, 4);
  assert.equal(w.a, null);
});

test("Ethernet preset connects on T568B pins in pair order", () => {
  const p = CD.blankProject();
  const a = CD.newConn(p, "rj45", 0, 0), b = CD.newConn(p, "rj45", 500, 0);
  p.conns.push(a, b);
  const cab = CD.cablePreset(p, "eth", 200, 0);
  CD.connectCable(p, cab, a.id, b.id);
  const list = CD.conductors(p, cab);
  assert.deepEqual(plain(list.map(w => w.a.p + 1)), [1, 2, 3, 6, 4, 5, 7, 8]);
  assert.deepEqual(plain(list.map(w => CD.colorText(w))), ["WH/OG", "OG", "WH/GN", "GN", "BU", "WH/BU", "WH/BN", "BN"]);
  assert.equal(cab.groups.length, 4);
});

test("twist group members are drawn next to each other", () => {
  const p = CD.blankProject();
  const cab = CD.cablePreset(p, "multi", 0, 0, 4);
  const ws = p.wires.filter(w => w.cable === cab.id);
  cab.groups.push(CD.newGroup([ws[0].id, ws[3].id]));
  assert.deepEqual(plain(CD.conductors(p, cab).map(w => w.id)), [ws[0].id, ws[3].id, ws[1].id, ws[2].id]);
  assert.equal(CD.wireRef(p, ws[3]), cab.ref + "-2");
});

test("example: wire list, BOM quantities and find numbers", () => {
  const p = CD.example();
  const rows = CD.wireRows(p);
  assert.equal(rows.length, 6);
  const r1 = rows[0].cells;
  assert.equal(r1[0], "W1-1"); assert.equal(r1[5], "P1:2"); assert.equal(r1[6], "P2:2"); assert.equal(r1[7], "A"); assert.equal(r1[8], "TW1");
  const drain = rows.find(r => r.cells[3] === "BARE");
  assert.match(drain.cells[8], /drain/);
  const B = CD.bom(p);
  const contact = B.rows.find(r => r.mpn === "EX-CT-S");
  assert.equal(contact.qty, 6, "one contact per wired cavity on P1");
  const cable = B.rows.find(r => r.mpn === "EX-CBL-2P24S");
  assert.equal(cable.qty, 36); assert.equal(cable.unit, "in");
  const label = B.rows.find(r => r.mpn === "EX-LBL-WHT");
  assert.equal(label.qty, 2, "both ends");
  const hs = B.rows.find(r => r.mpn === "EX-HS-3/8");
  assert.equal(hs.qty, 1); assert.equal(hs.unit, "in");
  const gw = B.rows.find(r => /GNYE/.test(r.desc));
  assert.equal(gw.qty, 6);
  assert.equal(B.find[p.conns[0].id], 1);
});

test("checks flag duplicate references and doubled pins", () => {
  const p = CD.example();
  assert.ok(!CD.checks(p).some(c => c.lvl === "err"));
  p.wires.push(CD.newWire(p, { len: "2", a: { c: p.conns[0].id, p: 4 }, b: { c: p.conns[2].id, p: 0 } }));
  assert.ok(CD.checks(p).some(c => /P1:5 has 2 wires/.test(c.msg)));
  p.conns[1].ref = "P1";
  assert.ok(CD.checks(p).some(c => c.lvl === "err" && /P1 is used 2 times/.test(c.msg)));
});

test("CSV quotes commas and guards formula cells", () => {
  assert.equal(CD.csvCell("a,b"), '"a,b"');
  assert.equal(CD.csvCell("+5V"), "'+5V");
  assert.equal(CD.csvCell("-12"), "-12");
  const csv = CD.wireCsv(CD.example());
  assert.ok(csv.startsWith("﻿Wire,Cable,Size"));
  assert.equal(csv.trim().split("\r\n").length, 7);
});

test("normalize round-trips a saved project and drops dangling refs", () => {
  const p = CD.example();
  const back = CD.normalize(JSON.parse(JSON.stringify(p)));
  assert.deepEqual(plain(back), plain(p));
  const broken = plain(p);
  broken.wires[0].a = { c: "gone", p: 0 };
  broken.cables[0].groups[0].wires.push("nope");
  const n = CD.normalize(broken);
  assert.equal(n.wires[0].a, null);
  assert.equal(n.cables[0].groups[0].wires.length, 2);
});

test("scene builds both sheets with title block, ports and tables", () => {
  const p = CD.example();
  const s1 = CD.scene(p, { sheet: 1 });
  const ids = s1.groups.map(g => g.id);
  for (const id of ["frame", "rev", "blk:bom", "blk:wires", "blk:notes"]) assert.ok(ids.includes(id), id);
  assert.ok(s1.ports.length > 20);
  const txt = s1.groups.flatMap(g => g.prims).filter(o => o.t === "text").map(o => o.s);
  assert.ok(txt.includes("CBL-0001"));
  assert.ok(txt.some(s => /36\.00 ±1\.00/.test(s)));
  assert.ok(txt.some(s => /^TW1, lay 1\.00/.test(s)));
  p.meta.tables = "2";
  assert.equal(CD.sheetsOf(p), 2);
  const s2 = CD.scene(p, { sheet: 2 });
  assert.ok(s2.groups.some(g => g.id === "blk:wires"));
  assert.ok(s2.groups.flatMap(g => g.prims).some(o => o.t === "text" && o.s === "2 OF 2"));
});

test("title block has no built-in branding; company text or a user logo only", () => {
  const p = CD.example();
  const prims = s => s.groups.flatMap(g => g.prims);
  const plain = prims(CD.scene(p, { sheet: 1 }));
  assert.ok(!plain.some(o => o.t === "img"));
  assert.ok(!plain.some(o => o.t === "text" && /atlas/i.test(o.s)));
  p.meta.company = "Test Company";
  assert.ok(prims(CD.scene(p, { sheet: 1 })).some(o => o.t === "text" && o.s === "Test Company"));
  const withLogo = prims(CD.scene(p, { sheet: 1, images: { logo: { data: "data:image/png;base64,", w: 400, h: 100 } } }));
  const img = withLogo.find(o => o.t === "img");
  assert.equal(img.key, "logo");
  assert.ok(Math.abs(img.w / img.h - 4) < 1e-9, "keeps the aspect ratio");
  assert.ok(!withLogo.some(o => o.t === "text" && o.s === "Test Company"), "logo replaces the company text");
});

test("face builder geometry: ring + centre pin, keyway, renumber by rings", () => {
  const ring = CD.ringPins(4, 5, 0, false, 1.5);
  assert.deepEqual(plain(ring.map(p => [Math.round(p.x), Math.round(p.y)])), [[0, -5], [5, 0], [0, 5], [-5, 0]]);
  const L = CD.normLayout({ shape: "circle", w: 16, keys: [{ kind: "notch", ang: 0, w: 2 }], pins: [{ x: 0, y: 0, d: 2 }].concat(ring) }, 5);
  assert.equal(L.pins.length, 5);
  assert.deepEqual(plain(CD.sortPinOrder(L.pins, "rings")), [1, 2, 3, 4, 0], "outer ring clockwise from top, centre last");
  const key = CD.layoutGeom(L).find(g => g.key === "notch");
  assert.ok(Math.abs(key.pts[1] + 8) < 1e-9 && key.pts[3] > -8 && key.pts[3] < -6.5, "keyway cut into the shell at the top");
  const grid = CD.gridPins(2, 3, 2.54, 2.54, "zigzag", 1);
  assert.deepEqual(plain(grid.slice(0, 3).map(p => [p.x, p.y])), [[-2.54, -1.27], [-2.54, 1.27], [0, -1.27]]);
});

test("custom face draws sized pins and mirrors only for the wire-side view", () => {
  const p = CD.blankProject();
  const c = CD.newConn(p, "custom", 0, 0);
  CD.setPinCount(p, c, 3);
  c.layout = CD.normLayout({ shape: "rect", w: 12, h: 6, pins: [{ x: -4, y: 0, d: 1 }, { x: 0, y: 0, d: 3, sq: true }, { x: 4, y: 0, d: 1 }] }, 3);
  const f = CD.faceLayout(c);
  assert.equal(f.shape, "custom");
  assert.ok(f.pins[0].x < f.pins[2].x);
  assert.ok(f.pins[1].r > f.pins[0].r * 2.5 && f.pins[1].sq);
  c.faceFrom = "rear";
  const r = CD.faceLayout(c);
  assert.ok(r.pins[0].x > r.pins[2].x, "wire side view is mirrored");
  c.gender = "female"; c.faceFrom = "mate";
  assert.ok(CD.faceLayout(c).pins[0].x < CD.faceLayout(c).pins[2].x, "custom faces are drawn as seen, not auto-mirrored");
  p.conns.push(c);
  const s = CD.scene(p, { sheet: 1 });
  assert.ok(s.groups.find(g => g.id === "c:" + c.id).prims.some(o => o.t === "rect" && Math.abs(o.w - f.pins[1].r * 2) < 1e-6));
});

test("removing and renumbering pins keeps wires on their pins", () => {
  const p = CD.blankProject();
  const c = CD.newConn(p, "custom", 0, 0); p.conns.push(c);
  CD.setPinCount(p, c, 4);
  c.layout = CD.layoutFromFace(c);
  c.pins.forEach((x, i) => { x.sig = "S" + (i + 1); });
  const w2 = CD.newWire(p, { a: { c: c.id, p: 1 } }), w3 = CD.newWire(p, { a: { c: c.id, p: 2 } }), w4 = CD.newWire(p, { a: { c: c.id, p: 3 } });
  p.wires.push(w2, w3, w4);
  CD.removePins(p, c, [2]);
  assert.equal(c.pins.length, 3); assert.equal(c.layout.pins.length, 3);
  assert.equal(w3.a, null);
  assert.equal(c.pins[w4.a.p].sig, "S4");
  CD.reorderPins(p, c, [2, 1, 0]);
  assert.equal(c.pins[w4.a.p].sig, "S4"); assert.equal(c.pins[w2.a.p].sig, "S2");
  CD.addPins(c, [{ x: 0, y: 0, d: 2 }]);
  assert.equal(c.pins[3].n, "5", "numbered after the highest pin number");
  assert.equal(c.layout.pins[3].d, 2);
});

test("My parts: save, sanitize and place a connector with its face", () => {
  const p = CD.blankProject();
  const c = CD.newConn(p, "m12a8", 0, 0);
  Object.assign(c, { mpn: "EX-M12-8", desc: "M12 8 pin, test" });
  c.layout = CD.layoutFromFace(c);
  c.pins[0].sig = "SIG";
  const part = CD.partFromConn(c, "Test M12");
  assert.equal(part.pins[0].sig, undefined, "signals stay with the drawing");
  const back = CD.normPart(JSON.parse(JSON.stringify(part)));
  assert.equal(back.name, "Test M12"); assert.equal(back.layout.pins.length, 8);
  assert.equal(CD.normPart({ name: "bad" }), null);
  const n = CD.connFromPart(p, back, 10, 20);
  assert.equal(n.mpn, "EX-M12-8"); assert.equal(n.pins.length, 8); assert.equal(n.pins[0].sig, "");
  assert.notEqual(n.id, c.id);
  assert.deepEqual(plain(n.layout), plain(c.layout));
});

test("shield ties: add, no duplicates, wire list rows, pruned with their cable", () => {
  const p = CD.example();
  const w1 = p.cables[0];
  const w2 = CD.cablePreset(p, "stp", 0, 0);
  assert.ok(CD.addTie(p, { cable: w1.id, end: "b" }, { t: "shield", cable: w2.id, end: "a" }));
  assert.equal(CD.addTie(p, { cable: w2.id, end: "a" }, { t: "shield", cable: w1.id, end: "b" }), null, "same pair the other way round");
  assert.equal(w1.shield.b, "tied"); assert.equal(w2.shield.a, "tied");
  const row = CD.wireRows(p).find(r => r.tie);
  assert.deepEqual(plain([row.cells[5], row.cells[6], row.cells[8]]), ["W1 shield B", "W2 shield A", "shield tie"]);
  assert.equal(CD.tiesOf(p, w2.id, "a").length, 1);
  const back = CD.normalize(JSON.parse(JSON.stringify(p)));
  assert.equal(back.ties.length, 1);
  p.cables = p.cables.filter(c => c !== w2); CD.pruneTies(p);
  assert.equal(p.ties.length, 0);
  assert.ok(CD.checks(p).some(c => /shield end B is set to tied, but has no tie/.test(c.msg)));
});

test("ties to a pin follow the pin when pins are removed or reordered", () => {
  const p = CD.example();
  const p1 = p.conns[0], w1 = p.cables[0];
  CD.addTie(p, { cable: w1.id, end: "a" }, { t: "pin", c: p1.id, p: 3 });
  CD.reorderPins(p, p1, [8, 7, 6, 5, 4, 3, 2, 1, 0]);
  assert.equal(p.ties[0].b.p, 5);
  CD.removePins(p, p1, [5]);
  assert.equal(p.ties.length, 0);
});

test("junction board: black box with edge pins, wires land on the pin lead", () => {
  const p = CD.blankProject();
  const b = CD.newConn(p, "board", 100, 100);
  assert.equal(b.ref, "A1");
  assert.deepEqual(plain(b.board.pins.map(x => x.side)), ["L", "L", "R", "R"]);
  b.desc = "Test board";
  p.conns.push(b);
  const s = CD.scene(p, { sheet: 1 });
  const L = s.blocks.conn[b.id];
  assert.ok(L.board);
  assert.deepEqual(plain(L.port(0)), { x: 100 - 9, y: L.pos(0).y, d: -1, v: 0 });
  b.board.pins[2] = { side: "T", t: 0.5 };
  assert.equal(CD.scene(p, { sheet: 1 }).blocks.conn[b.id].port(2).v, -1, "top-edge lead points up");
  assert.ok(s.ports.filter(q => q.c === b.id).length === 4);
  assert.equal(CD.bom(p).rows[0].desc, "Test board");
  CD.addPins(b, [{ side: "B", t: 0.25 }]);
  assert.equal(b.pins.length, 5); assert.equal(b.board.pins[4].side, "B");
});

test("insert a junction board into a shielded cable", () => {
  const p = CD.example();
  const w1 = p.cables[0], p2 = p.conns[1];
  const r = CD.insertBoard(p, w1);
  const cond = CD.conductors(p, w1), cond2 = CD.conductors(p, r.cable);
  assert.equal(r.board.pins.length, 10, "4 conductors + SH1 on the left, 4 + SH2 on the right");
  assert.ok(cond.every(w => w.b && w.b.c === r.board.id));
  assert.ok(cond2.filter(w => !CD.isDrain(w)).every(w => w.a.c === r.board.id && w.b.c === p2.id));
  assert.equal(r.cable.len, ""); assert.equal(r.cable.groups.length, 2);
  assert.equal(p.ties.length, 2);
  assert.ok(p.ties.every(t => t.b.t === "pin" && t.b.c === r.board.id));
  assert.equal(r.cable.shield.b, "float"); assert.equal(w1.shield.b, "tied"); assert.equal(r.cable.shield.a, "tied");
});

test("BOM: a cable with no length adds nothing and shows TBD", () => {
  const p = CD.example();
  const r = CD.insertBoard(p, p.cables[0]);
  const row = CD.bom(p).rows.find(x => x.mpn === "EX-CBL-2P24S");
  assert.equal(row.qty, 36); assert.ok(row.tbd);
  assert.equal(CD.bomCells(row, p.meta)[1], "36.00 + TBD");
  r.cable.len = "12";
  assert.equal(CD.bom(p).rows.find(x => x.mpn === "EX-CBL-2P24S").qty, 48);
});

test("board image: kept when valid, fitted between the pin labels, block can fit its shape", () => {
  const p = CD.blankProject();
  const b = CD.newConn(p, "board", 100, 100);
  b.pins.forEach((x, i) => { x.sig = "SIGNAL_" + i; });
  p.conns.push(b);
  const png = "data:image/png;base64,iVBORw0KGgo=";
  b.board.img = { data: png, w: 400, h: 200 };
  const back = CD.normalize(JSON.parse(JSON.stringify(p)));
  assert.equal(back.conns[0].board.img.data, png);
  const bad = JSON.parse(JSON.stringify(p));
  bad.conns[0].board.img.data = "javascript:alert(1)";
  assert.equal(CD.normalize(bad).conns[0].board.img, null, "only PNG / JPEG data is kept");
  const s = CD.scene(p, { sheet: 1 });
  const im = s.groups.find(g => g.id === "c:" + b.id).prims.find(o => o.t === "img");
  const M = CD.boardMargins(b);
  assert.equal(im.src, png);
  assert.ok(im.x >= 100 + M.l - 1e-6 && im.x + im.w <= 100 + b.board.w - M.r + 1e-6, "inside the label margins");
  assert.ok(Math.abs(im.w / im.h - 2) < 1e-9, "keeps its shape");
  const fit = CD.boardFit(b);
  Object.assign(b.board, fit);
  const im2 = CD.scene(p, { sheet: 1 }).groups.find(g => g.id === "c:" + b.id).prims.find(o => o.t === "img");
  const aw = b.board.w - M.l - M.r, ah = b.board.h - M.t - M.b;
  assert.ok(Math.abs(im2.w - aw) < 6 || Math.abs(im2.h - ah) < 6, "fills the space once fitted");
  for (let i = 0; i < 10; i++) CD.addPins(b, [{ side: "L", t: 0.5 }]);
  assert.ok(CD.boardFit(b).h >= 15 + 15 + 12 * 13, "never too short for its pins");
  const part = CD.normPart(JSON.parse(JSON.stringify(CD.partFromConn(b, "Board with picture"))));
  assert.equal(part.board.img.data, png, "My parts keep the image");
});

test("custom tables: paste parsing, saved shape, sheet 1 at its spot or flowed onto sheet 2", () => {
  assert.deepEqual(plain(CD.parseGrid("Step\tCheck\n1\tContinuity\n2\t\"Hi-pot, 500 V\"\n")), [["Step", "Check"], ["1", "Continuity"], ["2", "Hi-pot, 500 V"]]);
  assert.deepEqual(plain(CD.parseGrid('a,"b ""x""",c\r\n1,2,3')), [["a", 'b "x"', "c"], ["1", "2", "3"]]);
  const p = CD.example();
  const t = CD.newTable(300, 450, { title: "Test record", cols: [{ h: "Step", align: "center" }, { h: "Check", align: "left" }], rows: [["1", "Continuity"], ["2", "Insulation"]] });
  p.tables.push(t);
  const back = CD.normalize(JSON.parse(JSON.stringify(p)));
  assert.deepEqual(plain(back.tables[0].rows), [["1", "Continuity"], ["2", "Insulation"]]);
  assert.equal(back.tables[0].cols[0].align, "center");
  const ragged = CD.normalize({ tables: [{ cols: [{ h: "A" }, { h: "B" }], rows: [["x"], ["y", "z", "extra"]], sheet: 9 }] }).tables[0];
  assert.deepEqual(plain(ragged.rows), [["x", ""], ["y", "z"]]); assert.equal(ragged.sheet, 1);
  const s1 = CD.scene(p, { sheet: 1 });
  const g = s1.groups.find(x => x.id === "tbl:" + t.id);
  assert.equal(g.box.x, 300); assert.equal(g.box.y, 450);
  assert.ok(g.prims.some(o => o.t === "text" && o.s === "TEST RECORD"));
  assert.ok(g.prims.some(o => o.t === "text" && o.s === "Insulation"));
  assert.equal(CD.sheetsOf(p), 1);
  t.sheet = 2;
  assert.equal(CD.sheetsOf(p), 2);
  assert.ok(!CD.scene(p, { sheet: 1 }).groups.some(x => x.id === "tbl:" + t.id));
  const s2 = CD.scene(p, { sheet: 2 });
  assert.ok(s2.groups.some(x => x.id === "tbl:" + t.id));
  assert.ok(!s2.groups.some(x => x.id === "blk:wires"), "wire list stays on sheet 1");
  assert.ok(CD.scene(p, { sheet: 1 }).groups.some(x => x.id === "blk:wires"));
});

test("text and tables scale as a whole: size baseline times the handle scale", () => {
  const p = CD.example();
  const t = CD.newTable(300, 450, { title: "Scale test", cols: [{ h: "A", align: "left" }, { h: "B", align: "left" }], rows: [["one", "two"]] });
  const k = CD.newCallout(100, 500, { text: "Check twist" });
  p.tables.push(t); p.callouts.push(k);
  const grab = () => { const s = CD.scene(p, { sheet: 1 }); const g = id => s.groups.find(x => x.id === id); return { t: g("tbl:" + t.id), k: g("k:" + k.id), w: g("blk:wires"), n: g("blk:notes") }; };
  const big = o => Math.max(...o.prims.filter(q => q.t === "text").map(q => q.size));
  const a = grab();
  assert.equal(big(a.k), 7, "medium text note draws as before (7 pt)");
  t.k = 2; k.k = 2; p.blk.wires.k = 1.5; p.blk.notes.size = "l";
  const b = grab();
  assert.ok(Math.abs(b.t.box.w - a.t.box.w * 2) < 0.5 && Math.abs(b.t.box.h - a.t.box.h * 2) < 0.5, "table doubles, text included");
  assert.ok(Math.abs(big(b.t) - big(a.t) * 2) < 1e-9);
  assert.equal(big(b.k), 14);
  assert.ok(Math.abs(b.w.box.w - a.w.box.w * 1.5) < 1);
  assert.ok(Math.abs(big(b.n) - big(a.n) * 9 / 7) < 1e-9, "Large notes = 9/7 of Medium");
  t.size = "l";
  assert.ok(Math.abs(big(grab().t) - big(a.t) * 2 * 9 / 5.8) < 1e-9, "Large table text = 9/5.8 of Small, times the scale");
  const back = CD.normalize(JSON.parse(JSON.stringify(Object.assign(p, { blk: { wires: { size: "x", k: 99 } } }))));
  assert.equal(back.tables.find(x => x.id === t.id).k, 2);
  assert.equal(back.callouts.find(x => x.id === k.id).k, 2);
  assert.deepEqual(plain(back.blk.wires), { size: "s", k: 6, wrap: true, colW: 0 }, "unknown size falls back, scale is capped");
  assert.deepEqual(plain(back.blk.notes), { size: "m", k: 1 });
});

test("cable and wire profiles: cable parameters only, no labels, sleeving, lengths or ends", () => {
  const p = CD.example();
  const w1 = p.cables[0];
  w1.desc = "2 pair shielded test cable";
  const part = CD.partFromCable(p, w1, "Test 2-pair");
  assert.equal(part.type, "cable");
  assert.equal(part.conductors.length, 5);
  assert.deepEqual(plain(part.conductors.map(c => c.color)), ["WH", "BN", "GN", "YE", "BARE"]);
  assert.deepEqual(plain(part.groups.map(g => [g.wires, g.lay])), [[[0, 1], "1.00"], [[2, 3], "1.50"]]);
  assert.equal(part.cable.shield, "foil"); assert.equal(part.cable.mpn, "EX-CBL-2P24S"); assert.equal(part.cable.od, "0.22");
  const text = JSON.stringify(part);
  for (const gone of ["36.00", "1.50\",\"stripB", "P1 / P2", "EX-LBL-WHT", "EX-HS-3/8", "pigtail", "float"]) assert.ok(!text.includes(gone), "left out: " + gone);
  assert.ok(!("len" in part.cable) && !("marks" in part.cable) && !("stripA" in part.cable));
  // through a .cdparts round trip and back onto a drawing
  const back = CD.normPart(JSON.parse(text));
  const q = CD.blankProject();
  const c = CD.cableFromPart(q, back, 10, 20);
  const list = CD.conductors(q, c);
  assert.equal(list.length, 5); assert.ok(list.every(w => !w.a && !w.b && !w.ref));
  assert.equal(c.len, ""); assert.equal(c.marks.length, 0); assert.equal(c.groups.length, 2);
  assert.deepEqual(plain(c.shield), { type: "foil", a: "none", b: "none" });
  assert.equal(c.ref, "W1");
  assert.equal(CD.normPart({ type: "cable", conductors: [] }), null);
  // wire profile
  const gw = p.wires.find(w => w.color === "GNYE");
  gw.spec = "UL1015"; gw.mpn = "EX-W20-GY";
  const wp = CD.normPart(JSON.parse(JSON.stringify(CD.partFromWire(gw))));
  assert.equal(wp.type, "wire"); assert.equal(wp.name, "20 AWG GNYE PVC UL1015");
  assert.ok(!("len" in wp.wire) && !("a" in wp.wire) && !("ref" in wp.wire));
  const tgt = CD.newWire(q, { len: "12", sig: "X", ref: "9" });
  CD.applyWirePart(tgt, wp);
  assert.deepEqual([tgt.gauge, tgt.color, tgt.spec, tgt.mpn, tgt.len, tgt.sig, tgt.ref], ["20", "GNYE", "UL1015", "EX-W20-GY", "12", "X", "9"]);
  assert.equal(CD.normPart({ type: "wire", wire: { color: "<b>", gu: "x" } }).wire.color, "BK");
});

test("markings: fixed order and spacing whatever order they were added in", () => {
  const p = CD.example();
  const c = p.cables[0];
  c.marks.push(CD.newMark({ kind: "sleeve", end: "all", text: "Braided sleeve", mpn: "EX-SLV-1" }), CD.newMark({ kind: "label", end: "A", text: "P1", mpn: "EX-LBL-A" }));
  const order = CD.markRows(c.marks).map(m => m.end + ":" + m.kind);
  assert.deepEqual(plain(order), ["A:label", "both:label", "all:sleeve", "B:heatshrink"]);
  const balloons = () => CD.scene(p, { sheet: 1 }).groups.find(g => g.id === "w:" + c.id).prims.filter(o => o.t === "circle" && o.r === 6).map(o => o.cy).sort((a, b) => a - b);
  const ys = balloons();
  const gaps = ys.slice(1).map((y, i) => y - ys[i]).filter(g => g > 0.5);
  assert.ok(gaps.every(g => g >= 12), "marking balloons never overlap: " + gaps.join(", "));
  const before = JSON.stringify(balloons());
  c.marks.reverse();
  assert.equal(JSON.stringify(balloons()), before, "same layout in any order");
});

test("table text wrapping: on wraps at the set width, off keeps one line per cell", () => {
  const p = CD.blankProject();
  const long = "A long description that will not fit in a narrow column at all";
  const t = CD.newTable(100, 100, { cols: [{ h: "Step", align: "left" }, { h: "Description", align: "left" }], rows: [["1", long]] });
  p.tables.push(t);
  const g = () => CD.scene(p, { sheet: 1 }).groups.find(x => x.id === "tbl:" + t.id);
  const lines = () => g().prims.filter(o => o.t === "text" && o.s.length > 1 && long.includes(o.s)).length;
  t.colW = 80;
  const narrow = g().box.w, wrapped = lines();
  assert.ok(wrapped >= 3, "wraps at 80 pt");
  t.colW = 0;
  assert.ok(g().box.w > narrow && lines() < wrapped, "auto width wraps less");
  t.wrap = false;
  assert.equal(lines(), 1, "off: one line");
  assert.ok(g().prims.some(o => o.t === "text" && o.s === long));
  const back = CD.normalize(JSON.parse(JSON.stringify(Object.assign(p, { tables: [Object.assign({}, t, { colW: 5 })] }))));
  assert.equal(back.tables[0].wrap, false); assert.equal(back.tables[0].colW, 30, "width kept within 30-600 pt");
});

test("sleeving, heat-shrink and tape are bought by length; labels and ties by count", () => {
  const p = CD.example();
  const c = p.cables[0];   // 36.00 in long
  const row = mpn => CD.bom(p).rows.find(r => r.mpn === mpn);
  c.marks.push(CD.newMark({ kind: "sleeve", end: "all", mpn: "EX-SLV", desc: "Braided sleeve" }));
  assert.deepEqual([row("EX-SLV").qty, row("EX-SLV").unit, !!row("EX-SLV").tbd], [36, "in", false], "full length = cable length");
  c.marks.push(CD.newMark({ kind: "tape", end: "both", mpn: "EX-TAPE", desc: "Tape", len: "2", qty: "5" }));
  assert.deepEqual([row("EX-TAPE").qty, row("EX-TAPE").unit], [4, "in"], "2 in at both ends, qty ignored");
  c.marks.push(CD.newMark({ kind: "heatshrink", end: "mid", mpn: "EX-HS-MID", desc: "Heat-shrink" }));
  const hs = row("EX-HS-MID");
  assert.equal(hs.unit, "in"); assert.ok(hs.tbd); assert.equal(CD.bomCells(hs, p.meta)[1], "TBD");
  assert.ok(CD.checks(p).some(k => /W1: heat-shrink at middle has no cut length/.test(k.msg)));
  c.marks.push(CD.newMark({ kind: "tie", end: "mid", mpn: "EX-TIE", desc: "Cable tie", qty: "3", len: "9" }));
  assert.deepEqual([row("EX-TIE").qty, row("EX-TIE").unit], [3, "ea"], "ties are counted, length ignored");
  assert.deepEqual([row("EX-LBL-WHT").qty, row("EX-LBL-WHT").unit], [2, "ea"], "labels stay counted");
  c.len = "";
  assert.ok(row("EX-SLV").tbd, "full length with no cable length = TBD");
});

test("Legal sheet: 14 x 8.5 in landscape, title block says LEGAL and fits its cell", () => {
  const p = CD.example();
  p.meta.size = "Legal";
  const s = CD.scene(p, { sheet: 1 });
  assert.deepEqual([s.W, s.H], [1008, 612]);
  const t = s.groups.find(g => g.id === "frame").prims.find(o => o.t === "text" && o.s === "LEGAL");
  assert.ok(t && CD.textWidth("LEGAL", t.size, true) <= 29, "fits the 34 pt SIZE cell");
  assert.equal(CD.normalize(JSON.parse(JSON.stringify(p))).meta.size, "Legal");
});
