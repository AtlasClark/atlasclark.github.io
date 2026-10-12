/* The files. At format 21 the web build must write exactly what R55 writes. At 22 it
   must keep tokensSpent and any field it does not know, and name an HTA that writes
   to an upgraded folder. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { skipReason, readDataFiles, backupDay, setToday, loadR55, loadWeb, web } from "./lib/bridge.mjs";

const STAMP = /^\s*"(writerVersion|writerUser|writtenAt|updatedBy|updatedAt)":.*$/gm;
const strip = s => s.replace(/\r/g, "").replace(STAMP, "");

async function setup() {
  const files = readDataFiles(), day = backupDay(files);
  setToday(day);
  const r = loadR55(files);
  const w = await loadWeb(files);
  return { files, day, ...r, ...w };
}

test("format 21: every file and the settings serialise exactly as R55 writes them", { skip: skipReason }, async () => {
  const { ctx, S, disk, DIR } = await setup();
  assert.equal(S.folderFormat, 21);
  for (const rp of ctx.participants) {
    const wp = web.model.findParticipant(rp.name);
    assert.equal(strip(web.store.toJson(wp)), strip(ctx.toJson(rp)), rp.name);
  }
  ctx.saveSettings();
  await web.store.saveSettings();
  const { mem } = { mem: web.store.dir };
  assert.equal(strip(mem.text("_settings.json")), strip(disk.get(DIR + "\\_settings.json")));
});

test("format 21: extra fields are never written, even when present in memory", { skip: skipReason }, async () => {
  const { S } = await setup();
  const p = S.participants[0];
  p.tokensSpent = 3; p.futureThing = { a: 1 };
  const out = web.store.toJson(p);
  assert.ok(!out.includes("tokensSpent") && !out.includes("futureThing"));
  assert.match(out, /"writerRev": 21,/);
});

test("upgrade to 22 rewrites every file and the settings, and reloads clean", { skip: skipReason }, async () => {
  const { S, mem, files } = await setup();
  const n = await web.store.upgradeFolder();
  assert.equal(n, S.participants.length);
  for (const p of S.participants) {
    const txt = mem.text(web.store.participantFileName(p.name));
    assert.match(txt, /"writerRev": 22,/, p.name);
    assert.match(txt, /"tokensSpent": 0,/, p.name);
    assert.deepEqual(JSON.parse(txt).entries.length, p.entries.length);
  }
  const settings = JSON.parse(mem.text("_settings.json"));
  assert.equal(settings.formatRev, 22);
  assert.equal(settings.upgradedBy, "webtest");

  await web.store.loadSettings();
  S.participants = await web.store.loadAll();
  assert.equal(S.folderFormat, 22);
  assert.equal(S.staleWriters.length, 0);
  assert.equal(S.newerRevSeen, false);

  /* R55 can still read a 22 file, and warns that the folder is newer than it. */
  const upgraded = new Map([...files].map(([k, v]) => [k, mem._f.get(k) ? Buffer.from(mem._f.get(k).bytes) : v]));
  const r = loadR55(upgraded);
  assert.equal(r.ctx.participants.length, S.participants.length);
  assert.equal(r.ctx.newerRevSeen, true);
});

test("at 22, tokensSpent and unknown fields survive saves and merges", { skip: skipReason }, async () => {
  const { S, mem } = await setup();
  await web.store.upgradeFolder();
  const p = S.participants[0], name = web.store.participantFileName(p.name);

  /* A newer build left a field this one does not know, and spent 2 tokens. */
  const disk = JSON.parse(mem.text(name));
  disk.futureThing = { a: 1, b: [2, 3] };
  disk.tokensSpent = 2;
  mem._f.set(name, { bytes: web.store.encodeUtf16le(JSON.stringify(disk, null, 2)), mtime: Date.now() });

  /* This window still holds its stale copy (no futureThing, 0 spent) and saves. */
  p.entries.push({ eid: "t:x", ts: "2026-10-12T09:00:00", date: "2026-10-12", oz: 8, by: "webtest" });
  assert.ok(await web.store.saveParticipant(p, null));
  const after = JSON.parse(mem.text(name));
  assert.deepEqual(after.futureThing, { a: 1, b: [2, 3] });
  assert.equal(after.tokensSpent, 2);
  assert.ok(after.entries.some(e => e.eid === "t:x"));

  await web.store.loadSettings();
  S.participants = await web.store.loadAll();
  const back = web.model.findParticipant(p.name);
  assert.deepEqual(back.futureThing, { a: 1, b: [2, 3] });
  assert.ok(web.store.toJson(back).includes('"futureThing": {"a":1,"b":[2,3]}'));
});

test("at 22, a file written by R55 is reported with the user who wrote it", { skip: skipReason }, async () => {
  const { S, mem, ctx } = await setup();
  await web.store.upgradeFolder();
  const rp = ctx.participants[0];
  ctx.currentWindowsUser = () => "someone";
  const text = ctx.toJson(rp);                       /* R55 writing format 21 into the upgraded folder */
  mem._f.set(web.store.participantFileName(rp.name), { bytes: web.store.encodeUtf16le(text), mtime: Date.now() });

  await web.store.loadSettings();
  S.participants = await web.store.loadAll();
  assert.equal(S.folderFormat, 22);
  assert.equal(S.staleWriters.length, 1);
  assert.equal(S.staleWriters[0].name, rp.name);
  assert.equal(S.staleWriters[0].user, "someone");
});

test("at 22, settings rewritten by R55 (formatRev dropped) still read as 22", { skip: skipReason }, async () => {
  const { S, mem, ctx, disk, DIR } = await setup();
  await web.store.upgradeFolder();
  ctx.saveSettings();                                /* R55's settings writer knows no formatRev */
  const r55Settings = disk.get(DIR + "\\_settings.json");
  assert.ok(!r55Settings.includes("formatRev"));
  mem._f.set("_settings.json", { bytes: web.store.encodeUtf16le(r55Settings), mtime: Date.now() });

  await web.store.loadSettings();
  assert.equal(S.settings.formatRev, 21);
  S.participants = await web.store.loadAll();
  assert.equal(S.folderFormat, 22, "the files still say 22");
  await web.store.saveSettings();
  assert.equal(JSON.parse(mem.text("_settings.json")).formatRev, 22);
});
