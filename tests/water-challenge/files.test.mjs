/* The files: every write is at FORMAT_REV, whatever the file held before; fields this
   build does not know survive; a file from a newer format asks for a reload; the
   settings keep the folder's title and tagline. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { skipReason, readDataFiles, backupDay, setToday, loadWeb, web } from "./lib/bridge.mjs";

async function setup() {
  const files = readDataFiles(), day = backupDay(files);
  setToday(day);
  const w = await loadWeb(files);
  return { files, day, ...w };
}

test("files: every save writes the current format with its token fields, and reloads the same", { skip: skipReason }, async () => {
  const { S, mem } = await setup();
  for (const p of S.participants) {
    assert.ok(await web.store.saveParticipant(p, null), p.name);
    const txt = mem.text(web.store.participantFileName(p.name));
    assert.match(txt, new RegExp('"writerRev": ' + web.C.FORMAT_REV + ','), p.name);
    for (const f of ["tokensSpent", "rerollDay", "rollLog", "graveLog", "spends"]) assert.ok(txt.includes('"' + f + '":'), p.name + " " + f);
  }
  await web.store.saveSettings();
  assert.equal(JSON.parse(mem.text("_settings.json")).formatRev, web.C.FORMAT_REV);
  const before = S.participants.map(p => [p.name, p.entries.length]);
  S.participants = await web.store.loadAll();
  assert.deepEqual(S.participants.map(p => [p.name, p.entries.length]), before);
  assert.equal(S.newerRevSeen, false);
});

test("files: a file from a newer format asks for a reload", { skip: skipReason }, async () => {
  const { S, mem } = await setup();
  const p = S.participants[0], name = web.store.participantFileName(p.name);
  const disk = JSON.parse(mem.text(name));
  disk.writerRev = web.C.FORMAT_REV + 1;
  mem._f.set(name, { bytes: web.store.encodeUtf16le(JSON.stringify(disk)), mtime: Date.now() });
  S.participants = await web.store.loadAll();
  assert.equal(S.newerRevSeen, true);
});

test("files: tokensSpent and unknown fields survive saves and merges", { skip: skipReason }, async () => {
  const { S, mem } = await setup();
  const p = S.participants[0], name = web.store.participantFileName(p.name);

  /* A newer build left a field this one does not know, and another window spent 2 tokens. */
  const disk = JSON.parse(mem.text(name));
  disk.futureThing = { a: 1, b: [2, 3] };
  disk.spends = [{ id: "s:other", at: "2026-10-12T08:00:00", kind: "buy", cost: 2, pet: 0 }];
  mem._f.set(name, { bytes: web.store.encodeUtf16le(JSON.stringify(disk, null, 2)), mtime: Date.now() });

  /* This window still holds its stale copy (no futureThing, 0 spent) and saves. */
  p.entries.push({ eid: "t:x", ts: "2026-10-12T09:00:00", date: "2026-10-12", oz: 8, by: "webtest" });
  assert.ok(await web.store.saveParticipant(p, null));
  const after = JSON.parse(mem.text(name));
  assert.deepEqual(after.futureThing, { a: 1, b: [2, 3] });
  assert.equal(after.tokensSpent, 2, "tokensSpent is the sum of the merged spend log");
  assert.equal(after.spends.length, 1);
  assert.ok(after.entries.some(e => e.eid === "t:x"));

  await web.store.loadSettings();
  S.participants = await web.store.loadAll();
  const back = web.model.findParticipant(p.name);
  assert.deepEqual(back.futureThing, { a: 1, b: [2, 3] });
  assert.ok(web.store.toJson(back).includes('"futureThing": {"a":1,"b":[2,3]}'));
});

test("settings: the folder's title and tagline are saved when set, read back, and left out when cleared", { skip: skipReason }, async () => {
  const { S, mem } = await setup();
  S.settings.title = 'Acme "Hydro" Cup'; S.settings.tagline = "Sip happens.";
  await web.store.saveSettings();
  const o = JSON.parse(mem.text("_settings.json"));
  assert.equal(o.title, 'Acme "Hydro" Cup'); assert.equal(o.tagline, "Sip happens.");
  S.settings.title = S.settings.tagline = "x";
  await web.store.loadSettings();
  assert.equal(S.settings.title, 'Acme "Hydro" Cup'); assert.equal(S.settings.tagline, "Sip happens.");
  S.settings.title = S.settings.tagline = "";
  await web.store.saveSettings();
  const txt = mem.text("_settings.json");
  assert.ok(!txt.includes('"title"') && !txt.includes('"tagline"'), "unset: nothing written");
  await web.store.loadSettings();
  assert.equal(S.settings.title, ""); assert.equal(S.settings.tagline, "");
});
