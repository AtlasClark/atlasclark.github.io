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
