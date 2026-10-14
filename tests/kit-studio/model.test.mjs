/* Kit Studio data model: BOM template parsing, required / shortage math, edit
   rules, parts-list lookup and the .kitproj session format. Fake data only
   (90000-series PNs, "Example" makers). Run: node --test "tests/kit-studio/*.test.mjs" */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ctx = vm.createContext({});
vm.runInContext(readFileSync(new URL("../../tools/kit-studio/js/model.js", import.meta.url), "utf8"), ctx);
const KS = ctx.KS;
const plain = o => JSON.parse(JSON.stringify(o));

// Grid as the xlsx reader returns it: header block in B/C, column row, data rows
function grid({ pcb = "90101", cols } = {}) {
  const g = [];
  g[1] = ["", "Assembly Description:", "Test Assembly"];
  g[2] = ["", "Assembly Part Number:", "90001"];
  g[3] = ["", "Assembly Revision:", "A"];
  g[4] = ["", "PCB Description:", "Test PCB"];
  g[5] = ["", "PCB Part Number:", pcb];
  g[6] = ["", "PCB Revision:", "B"];
  g[7] = ["", "BOM Created:", "Field=CreatedDate"];
  g[9] = cols || ["Item #", "Column=Atlas Part Number", "Quantity", "Designator", "Comment", "Mounting Technology", "Manufacturer", "Manufacturer Part Number"];
  g[10] = ["1", "90201", "4", "C1, C2, C3, C4", "CAP 0.1UF", "SMD", "Example Passives", "EX-CC-104"];
  g[11] = ["", "", "", "", "", "", "", ""];
  g[12] = ["2", "", "1", "U1", "", "SMD", "", "EX-MCU-48"];
  g[13] = ["3", "90203", "abc", "J1", "CONN", "THT", "Example Conn", "EX-J"];
  return Array.from(g, r => r || []);
}

test("parseBom reads the header block, maps columns and adds the bare PCB first", () => {
  const b = KS.parseBom(grid(), "TEST.xlsx");
  assert.equal(KS.displayName(b), "90001 Rev A");
  assert.equal(b.created, "");                               // "Field=" placeholder reads blank
  assert.equal(b.lines.length, 4);
  assert.deepEqual(plain(b.lines[0]), plain(KS.newLine({ item: "PCB", atlas_pn: "90101", qty_per: 1, refdes: "—", desc: "Test PCB  Rev B", mpn: "90101", is_pcb: true })));
  assert.equal(b.lines[1].mfr, "Example Passives");
  assert.equal(b.lines[2].mpn, "EX-MCU-48");
  assert.equal(b.lines[3].qty_per, 0);                       // bad quantity reads 0
});

test("parseBom: no PCB line without a PCB PN; clear errors for bad files", () => {
  assert.equal(KS.parseBom(grid({ pcb: "" }), "T.xlsx").lines[0].item, "1");
  assert.throws(() => KS.parseBom([["nothing"]], "T.xlsx"), /Item #/);
  assert.throws(() => KS.parseBom(grid({ cols: ["Item #", "Quantity"] }), "T.xlsx"), /atlas_pn, mpn/);
});

test("required = ceil(qty × build × (1 + attrition)) without float noise", () => {
  const l = KS.newLine({ qty_per: 1 });
  assert.equal(KS.required(l, 100, 10), 110);                // desktop app gave 111
  assert.equal(KS.required(KS.newLine({ qty_per: 0.5 }), 25, 5), 14);
  assert.equal(KS.required(KS.newLine({ qty_per: 0 }), 25, 5), 0);
  assert.equal(KS.required(KS.newLine({ qty_per: 4, req_override: "7" }), 25, 5), 7);
  assert.equal(KS.required(KS.newLine({ qty_per: 4, req_override: "x" }), 25, 5), 105);
});

test("shortage: blank or invalid On Hand is not counted", () => {
  const l = KS.newLine({ qty_per: 2 });
  assert.equal(KS.shortage(l, 25, 5), 0);
  l.on_hand = "20"; assert.equal(KS.shortage(l, 25, 5), 33);
  l.on_hand = "99"; assert.equal(KS.shortage(l, 25, 5), 0);
  l.on_hand = "abc"; assert.equal(KS.shortage(l, 25, 5), 0);
  assert.ok(KS.isQty("12") && KS.isQty(".5") && KS.isQty("3.") && !KS.isQty("-1") && !KS.isQty("1e3"));
});

test("parts list: guessed columns, case-insensitive MPN lookup, fills blanks only", () => {
  const rows = [["Part Number", "Manufacturer", "Manufacturer Part Number", "Description"],
    ["90202", "Example Semi", "ex-mcu-48", "MCU 48QFN"], ["90999", "X", "", "no key"]];
  const map = KS.guessPartsColumns(rows[0]);
  assert.deepEqual(plain(map), { mpn: 2, atlas_pn: 0, mfr: 1, desc: 3 });
  const recs = KS.partsFromRows(rows, map);
  assert.equal(recs.length, 1);
  const b = KS.parseBom(grid(), "T.xlsx");
  b.lines[1].desc = "";                                      // has PN + maker, not in list
  assert.equal(KS.enrichBom(b, KS.partsIndex(recs)), 1);
  assert.deepEqual([b.lines[2].atlas_pn, b.lines[2].mfr, b.lines[2].desc], ["90202", "Example Semi", "MCU 48QFN"]);
  assert.equal(b.lines[1].desc, "");
});

test("session round trip keeps the desktop keys; v2.0 files migrate; paths are dropped", () => {
  const b = KS.parseBom(grid(), "T.xlsx");
  Object.assign(b, { build_order: "BO-1", build_qty: 25, attrition: 5 });
  const s = plain(KS.toSession([b], { bo: "BO-1", qty: 25, attr: 5 }));
  assert.deepEqual(Object.keys(s).sort(), ["app", "boms", "default_attr", "default_bo", "default_qty", "saved", "version"]);
  assert.deepEqual(Object.keys(s.boms[0].lines[0]).sort(), Object.keys(KS.newLine()).sort());
  assert.deepEqual(plain(KS.fromSession(s).boms), plain([b]));

  const old = { build_order: "BO-OLD", build_qty: 4, attrition: 2.5,
    boms: [{ source_file: "D:\\Share\\B.xlsx", lines: [{ item: "1", qty_per: 2, mpn: "EX-R" }] }] };
  const r = KS.fromSession(old);
  assert.equal(r.boms[0].source_file, "B.xlsx");
  assert.deepEqual([r.boms[0].build_order, r.boms[0].build_qty, r.boms[0].attrition], ["BO-OLD", 4, 2.5]);
  assert.deepEqual(plain(r.defaults), { bo: "BO-OLD", qty: 4, attr: 2.5 });
  assert.throws(() => KS.fromSession({}), /session/);
});
