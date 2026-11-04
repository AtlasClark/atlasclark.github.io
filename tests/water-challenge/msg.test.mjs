/* Glass messages (rev 1.38.7): text cleaning, the newer message winning every merge
   (two PCs, a stale page, a take-down), and the cloud Worker keeping each message to
   its own glass's code. Fake people only. */

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { MemDir, web } from "./lib/bridge.mjs";

const TOOL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../tools/water-challenge/");
const M = await import(pathToFileURL(path.join(TOOL, "js/msg.js")));
const W = await import(pathToFileURL(path.join(TOOL, "cloud/water-cloud-worker.js")));
const { store, model, C } = web;

test("message text: one line, no < or >, at most MSG_MAX", () => {
  assert.equal(M.cleanText("hi <b>there</b>\nfriend"), "hi bthere/b friend");
  assert.equal(M.cleanText("x".repeat(200)).length, C.MSG_MAX);
  assert.equal(M.msgOf({ msg: { id: "a", text: "   ", at: 1 } }), null, "blank = taken down");
  assert.equal(M.msgOf({ msg: { id: "a", text: "hi" } }), null, "no time = not a message");
  assert.deepEqual(M.msgOf({ msg: { id: "a", text: " hi ", at: 5 } }), { id: "a", text: "hi", at: 5 });
  const a = { id: "a", text: "old", at: 1 }, b = { id: "b", text: "new", at: 2 };
  assert.equal(M.newerMsg(a, b), b);
  assert.equal(M.newerMsg(b, a), b);
  assert.equal(M.newerMsg(undefined, a), a);
  assert.equal(M.newerMsg({ junk: 1 }, undefined), undefined);
});

test("a folder keeps the newer message whoever writes last", async () => {
  const mem = new MemDir("data");
  store.setDir(mem);
  model.S.me = "pat"; model.S.participants = [];
  await store.loadSettings();
  const person = () => ({ name: "Pat Test", color: "#4f8fd9", created: "2026-11-01", entries: [], pets: {}, graves: {}, dayGoals: {}, away: [], spends: [] });
  assert.ok(await store.saveParticipant(person()));
  const read = async () => (await store.loadAll()).find(p => p.name === "Pat Test");

  const mine = await read(), stale = await read();               /* two pages loaded at once */
  mine.msg = { id: "m1", text: "back at 3", at: 1000 };
  assert.ok(await store.saveParticipant(mine));
  assert.deepEqual((await read()).msg, mine.msg, "written and read back");

  stale.entries.push({ eid: "m:x", ts: "2026-11-04T10:00:00", date: "2026-11-04", oz: 8, by: "sam" });
  assert.ok(await store.saveParticipant(stale));                 /* a pour from a page that never saw it */
  const after = await read();
  assert.equal(after.msg.text, "back at 3", "a stale page's pour keeps the newer message");
  assert.equal(after.entries.length, 1);
  assert.equal(stale.msg.text, "back at 3", "and the stale page takes it in");

  mine.msg = { id: "m2", text: "", at: 2000 };                   /* taken down */
  assert.ok(await store.saveParticipant(mine));
  const old = await read(); old.msg = { id: "m1", text: "back at 3", at: 1000 };
  assert.ok(await store.saveParticipant(old));
  assert.equal(M.msgOf(await read()), null, "an older message can't come back over a take-down");
});

test("cloud Worker: only the glass's own code (or an admin) changes its message", () => {
  const base = { name: "Pat Test", color: "#4f8fd9", entries: [], spends: [] };
  const old = Object.assign({}, base, { msg: { id: "m1", text: "hi", at: 1 } });
  const pat = { user: "pat", glass: "Pat Test" }, sam = { user: "sam", glass: "Sam Sample" }, admin = { user: "owner", admin: 1 };
  const posted = Object.assign({}, base, { msg: { id: "m2", text: "new one", at: 2 } });
  assert.equal(W.checkWrite(pat, "Pat Test.json", old, posted), "", "own glass");
  assert.match(W.checkWrite(sam, "Pat Test.json", old, posted), /own code can change Pat Test's message/);
  assert.equal(W.checkWrite(admin, "Pat Test.json", old, posted), "", "admin");
  const pour = Object.assign({}, old, { entries: [{ eid: "m:1", ts: "x", date: "2026-11-04", oz: 8, by: "sam" }] });
  assert.equal(W.checkWrite(sam, "Pat Test.json", old, pour), "", "a pour for someone else that keeps their message");
  assert.match(W.checkWrite(sam, "Pat Test.json", old, Object.assign({}, base)), /message/, "nor may another code remove it");
  assert.match(W.checkRecord(Object.assign({}, base, { msg: { id: "m3", text: "x".repeat(141), at: 3 } })), /short text/);
  assert.match(W.checkRecord(Object.assign({}, base, { msg: { id: "m3", text: "a <b>", at: 3 } })), /< or >/);
  assert.match(W.checkRecord(Object.assign({}, base, { msg: "hi" })), /short text/);
});
