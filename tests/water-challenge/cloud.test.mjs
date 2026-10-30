/* The cloud (rev 1.38.0): the real Worker (cloud/water-cloud-worker.js) and its Durable
   Object on a SQLite stand-in for its storage, with the page's own store.js and cloud.js
   signed in to it. Codes and roles, a save that clashes and merges, live events over a
   stand-in socket, revoking, removal, backups and restore, the studio's handle, and a
   folder marked as moved. Fake people only. */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { MemDir, web } from "./lib/bridge.mjs";

globalThis.document = globalThis.document || { hidden: false };
const TOOL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../tools/water-challenge/");
const W = await import(pathToFileURL(path.join(TOOL, "cloud/water-cloud-worker.js")));
const cloud = await import(pathToFileURL(path.join(TOOL, "js/cloud.js")));
const store = web.store, M = web.model, C = web.C;

/* ---- a Durable Object on node:sqlite ---------------------------------------------- */
const sockets = new Set();
let alarmAt = null;
function sqlOf(db) {
  return { exec(q, ...b) { const rows = db.prepare(q).all(...b); return { toArray: () => rows, one: () => rows[0] }; } };
}
const ctx = {
  storage: { sql: sqlOf(new DatabaseSync(":memory:")), getAlarm: async () => alarmAt, setAlarm: async t => { alarmAt = t; } },
  acceptWebSocket(ws, tags) { ws.tags = tags; sockets.add(ws); },
  getWebSockets(tag) { return [...sockets].filter(ws => tag === undefined || ws.tags.includes(tag)); },
  setWebSocketAutoResponse() { }
};
const OWNER = "OWNR-TEST-CODE-0001", URL0 = "https://water-cloud.test.workers.dev", ORIGIN = "http://localhost:5517";
const env = { OWNER_CODE: OWNER, TIME_ZONE: "America/New_York", BACKUP_HOUR: "18", BACKUP_KEEP_DAYS: "14" };
const obj = new W.Challenge(ctx, env);
env.CHALLENGE = { idFromName: () => "main", get: () => obj };

globalThis.fetch = async (url, init = {}) =>
  W.default.fetch(new Request(url, Object.assign({}, init, { headers: Object.assign({ Origin: ORIGIN }, init.headers || {}) })), env);
const ask = async (p, code, init = {}) => {
  const r = await fetch(URL0 + p, Object.assign({}, init, { headers: Object.assign(code ? { Authorization: "Bearer " + code } : {}, init.body ? { "Content-Type": "application/json" } : {}, init.headers || {}) }));
  return { status: r.status, j: await r.json().catch(() => null) };
};
const put = (code, name, ver, body) => ask("/api/file", code, { method: "PUT", body: JSON.stringify({ name, ver, body }) });

/* A browser socket joined to the object, as the hibernation API would. */
class FakeSocket {
  constructor(url, protos) {
    this.readyState = 0;
    const code = (protos.find(p => p.startsWith("c.")) || "").slice(2);
    queueMicrotask(async () => {
      const auth = await obj.who(new Request(URL0), code);
      if (auth.error) { this.readyState = 3; if (this.onclose) this.onclose({}); return; }
      const client = this;
      this.server = { serializeAttachment(a) { this.att = a; },
                      send(m) { if (client.readyState === 1 || client.readyState === 0) queueMicrotask(() => client.onmessage && client.onmessage({ data: m })); },
                      close() { sockets.delete(this); client.readyState = 3; queueMicrotask(() => client.onclose && client.onclose({})); } };
      this.readyState = 1;
      obj.accept(this.server, auth.who);
      if (this.onopen) this.onopen();
    });
  }
  send(m) { obj.webSocketMessage(this.server, m); }
  close() { this.readyState = 3; sockets.delete(this.server); }
}
globalThis.WebSocket = FakeSocket;
after(() => cloud.stop());

const person = (name, extra = {}) => JSON.stringify(Object.assign({ name, color: "#4f8fd9", created: "2026-10-01", entries: [], pets: {}, graves: {}, dayGoals: {}, spends: [] }, extra));
const tick = () => new Promise(r => setTimeout(r, 20));

test("cloud worker: only the page's origins and a known code", async () => {
  const evil = await W.default.fetch(new Request(URL0 + "/api/hello", { headers: { Origin: "https://evil.example", Authorization: "Bearer " + OWNER } }), env);
  assert.equal(evil.status, 403);
  assert.equal((await ask("/api/hello")).status, 401, "no code");
  assert.equal((await ask("/api/hello", "AAAA-BBBB-CCCC")).status, 401, "a wrong code");
  const me = await ask("/api/hello", OWNER.toLowerCase().replace(/-/g, " "));
  assert.equal(me.status, 200, "codes are read without case, spaces or dashes");
  assert.deepEqual([me.j.me.admin, me.j.me.user], [true, "owner"]);
  for (let i = 0; i < 12; i++) await ask("/api/hello", "WRNG-CODE-" + i, { headers: { "CF-Connecting-IP": "9.9.9.9" } });
  assert.equal((await ask("/api/hello", OWNER, { headers: { "CF-Connecting-IP": "9.9.9.9" } })).status, 429, "12 wrong codes lock that address out");
  assert.equal((await ask("/api/hello", OWNER, { headers: { "CF-Connecting-IP": "8.8.8.8" } })).status, 200, "others are not locked out");
});

test("cloud worker: what a player's code may write", async () => {
  const imp = await ask("/api/import", OWNER, { method: "POST", body: JSON.stringify({ files: [
    { name: "Pat Test.json", body: person("Pat Test") }, { name: "Sam Sample.json", body: person("Sam Sample") },
    { name: "_settings.json", body: JSON.stringify({ dailyGoalOz: 100, formatRev: 22 }) },
    { name: "Bad.json", body: person("Bad", { color: "red;background:url(x)" }) }, { name: "../x.json", body: "{}" }] }) });
  assert.equal(imp.j.written, 3);
  assert.deepEqual(imp.j.skipped.map(s => s.name), ["Bad.json", "../x.json"], "a colour that is not #hex, and a path, are refused");

  const made = await ask("/api/codes/new", OWNER, { method: "POST", body: JSON.stringify({ user: "pat", glass: "Pat Test" }) });
  assert.match(made.j.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  const PAT = made.j.code;
  assert.equal((await ask("/api/codes", PAT)).status, 403, "codes are admin only");
  const st = (await ask("/api/state", PAT, { headers: { "X-Since": "0" } })).j;
  const ver = n => st.names[n], doc = n => JSON.parse(st.files.find(f => f.name === n).body);

  assert.equal((await put(PAT, "_settings.json", ver("_settings.json"), JSON.stringify({ dailyGoalOz: 1 }))).status, 403, "settings: admin only");
  assert.equal((await put(PAT, "New Person.json", 0, person("New Person"))).status, 403, "a new person: admin only");
  assert.equal((await put(PAT, "_pets.json", 0, JSON.stringify({ format: 1, pets: {} }))).status, 403, "pet art: admin or art");

  const sam = doc("Sam Sample.json");
  sam.entries.push({ eid: "m:1", ts: "2026-10-29T09:00:00", date: "2026-10-29", oz: 8, by: "sam" });
  assert.equal((await put(PAT, "Sam Sample.json", ver("Sam Sample.json"), JSON.stringify(sam))).status, 403, "a new pour under someone else's name");
  sam.entries[0].by = "pat";
  const ok = await put(PAT, "Sam Sample.json", ver("Sam Sample.json"), JSON.stringify(sam));
  assert.equal(ok.status, 200, "a pour for someone else, under your own name, is fine (as on the share)");
  sam.spends.push({ id: "s:x", at: "2026-10-29T09:01:00", kind: "plinko", cost: 1 });
  assert.equal((await put(PAT, "Sam Sample.json", ok.j.ver, JSON.stringify(sam))).status, 403, "spending from another glass");
  const pat = doc("Pat Test.json");
  pat.entries.push({ eid: "b:1", ts: "2026-10-29T09:05:00", date: "2026-10-29", oz: 5, by: "hidrate" });
  pat.spends.push({ id: "s:y", at: "2026-10-29T09:06:00", kind: "plinko", cost: 1 });
  assert.equal((await put(PAT, "Pat Test.json", ver("Pat Test.json"), JSON.stringify(pat))).status, 200, "own glass: bottle pours and spends");
  pat.name = "<b>Pat</b>";
  assert.equal((await put(PAT, "Pat Test.json", ver("Pat Test.json"), JSON.stringify(pat))).status, 409, "a stale version is a clash, not a write");
  const cur = (await ask("/api/file?name=Pat%20Test.json", PAT)).j;
  const bad = JSON.parse(cur.body); bad.entries.push({ eid: "m:2", ts: "x", date: "2026-10-29", oz: 1, by: "pat <img>" });
  assert.equal((await put(PAT, "Pat Test.json", cur.ver, JSON.stringify(bad))).status, 403, "no markup in any text");
});

test("cloud page: sign in, pour, merge after a clash, live events, revoke", async () => {
  const PAT = (await ask("/api/codes/new", OWNER, { method: "POST", body: JSON.stringify({ user: "pat", glass: "Pat Test", art: true }) })).j;
  let changes = 0, bye = "";
  const me = await cloud.start({ url: URL0, code: PAT.code }, { onChange: () => changes++, onBye: why => { bye = why; } });
  assert.deepEqual([me.user, me.glass, me.admin, me.art], ["pat", "Pat Test", false, true]);
  store.setCloud(cloud);
  assert.equal(store.dir, null, "the cloud replaces the folder");
  M.S.me = me.user; M.S.mine = me.glass; M.S.participants = [];
  await store.loadSettings();
  M.S.participants = await store.loadAll(); M.dataChanged();
  assert.deepEqual(M.S.participants.map(p => p.name), ["Pat Test", "Sam Sample"]);
  assert.equal(M.S.settings.dailyGoalOz, 100, "settings come from the cloud");
  await tick();
  assert.equal(cloud.cdiag.state, "live", "the socket is open");

  /* someone else pours for Pat, so this page's copy is one version behind */
  const st = (await ask("/api/file?name=Pat%20Test.json", OWNER)).j, other = JSON.parse(st.body);
  other.entries.push({ eid: "m:other", ts: "2026-10-29T10:00:00", date: "2026-10-29", oz: 12, by: "owner" });
  assert.equal((await put(OWNER, "Pat Test.json", st.ver, JSON.stringify(other))).status, 200);
  await tick();
  assert.ok(changes > 0, "the socket told the page about the change");

  const p = M.S.participants.find(x => x.name === "Pat Test");
  p.entries.push({ eid: "m:mine", ts: "2026-10-29T10:01:00", date: "2026-10-29", oz: 16, by: "pat" });
  const clashes = cloud.cdiag.conflicts;
  assert.ok(await store.saveParticipant(p, null), "the save lands");
  assert.equal(cloud.cdiag.conflicts, clashes + 1, "after one clash and a second merge");
  const now = JSON.parse((await ask("/api/file?name=Pat%20Test.json", OWNER)).j.body);
  assert.deepEqual(now.entries.map(e => e.eid).filter(e => e.startsWith("m:")).sort(), ["m:mine", "m:other"], "both pours are kept");
  assert.equal(now.writerRev, C.FORMAT_REV);

  /* a save refused by the Worker is reported, not retried for ever */
  const sam = M.S.participants.find(x => x.name === "Sam Sample");
  sam.spends = (sam.spends || []).concat([{ id: "s:steal", at: "2026-10-29T10:02:00", kind: "plinko", cost: 1 }]);
  assert.equal(await store.saveParticipant(sam, null), false);
  assert.match(store.diag.lastError, /own code can spend/);
  sam.spends = sam.spends.filter(s => s.id !== "s:steal");

  /* live events: this page's go to the others, theirs come in through the same tick */
  const seen = new Set();
  await store.writeLive({ type: "pour", id: "l1", at: Date.now(), name: "Pat Test", oz: 16, color: "#4f8fd9" });
  const theirs = (await ask("/api/live", OWNER)).j.events;
  assert.ok(theirs.some(e => e.id === "l1"), "sent over the socket and kept for two minutes");
  await ask("/api/live", OWNER, { method: "POST", body: JSON.stringify({ ev: { type: "drop", id: "l2", at: Date.now(), name: "Sam Sample" } }) });
  await tick();
  const got = await store.readLive(Date.now() - 60000, seen);
  assert.deepEqual(got.map(e => e.id), ["l2"], "only the other page's event");
  assert.equal((await ask("/api/live", OWNER, { method: "POST", body: JSON.stringify({ ev: { type: "drop", id: "l3", at: 1, name: "<script>" } }) })).status, 400);

  /* the evening backup is the Worker's */
  assert.equal(await store.backupIfDue("2026-10-29"), 0);

  /* revoked: the socket says bye and the page is signed out */
  await ask("/api/codes/revoke", OWNER, { method: "POST", body: JSON.stringify({ id: PAT.id }) });
  await tick();
  assert.match(bye, /revoked/);
  assert.equal((await ask("/api/hello", PAT.code)).status, 401);
  cloud.stop();
  store.setCloud(null);
});

test("cloud worker: remove and bring back, backups each evening, restore", async () => {
  assert.equal((await ask("/api/remove", OWNER, { method: "POST", body: JSON.stringify({ name: "Sam Sample.json" }) })).status, 200);
  let st = (await ask("/api/state", OWNER, { headers: { "X-Since": "0" } })).j;
  assert.ok(!("Sam Sample.json" in st.names), "off the roster");
  const gone = (await ask("/api/removed", OWNER)).j.removed;
  assert.equal(gone[0].name, "Sam Sample.json");
  assert.equal((await ask("/api/unremove", OWNER, { method: "POST", body: JSON.stringify({ name: gone[0].name, at: gone[0].at }) })).status, 200);
  st = (await ask("/api/state", OWNER, { headers: { "X-Since": "0" } })).j;
  assert.ok("Sam Sample.json" in st.names, "back on the roster");

  /* team time: 17:59 is last evening's slot, 18:00 today's */
  assert.equal(obj.local(new Date("2026-10-29T21:59:00Z")).hour, 17, "EDT is UTC-4");
  assert.equal(obj.backupIfDue(new Date("2026-10-29T21:59:00Z")) > 0, true, "a page-less morning takes the missed evening");
  assert.equal(obj.meta("lastBackup"), "2026-10-28");
  assert.equal(obj.backupIfDue(new Date("2026-10-29T21:30:00Z")), 0, "taken once");
  assert.ok(obj.backupIfDue(new Date("2026-10-29T22:00:00Z")) > 0);
  assert.equal(obj.meta("lastBackup"), "2026-10-29");

  /* a restore puts every file back as it was, after a backup of now */
  const f = (await ask("/api/file?name=Pat%20Test.json", OWNER)).j, o = JSON.parse(f.body);
  o.entries = [];
  await put(OWNER, "Pat Test.json", f.ver, JSON.stringify(o));
  const r = await ask("/api/restore", OWNER, { method: "POST", body: JSON.stringify({ day: "2026-10-29" }) });
  assert.equal(r.status, 200);
  assert.ok(JSON.parse((await ask("/api/file?name=Pat%20Test.json", OWNER)).j.body).entries.length > 0, "the pours are back");
  const days = (await ask("/api/backups", OWNER)).j.backups.map(b => b.day);
  assert.ok(days.some(d => d.endsWith("before restore")), "with a backup taken first");
});

test("cloud studio handle: pet art saves only on top of the version it read", async () => {
  const ART = (await ask("/api/codes/new", OWNER, { method: "POST", body: JSON.stringify({ user: "artie", glass: "", art: true }) })).j.code;
  const a = new cloud.CloudDir({ url: URL0, code: ART }), b = new cloud.CloudDir({ url: URL0, code: ART });
  await a.getFileHandle(C.SETTINGS_FILE);                         /* the studio takes it for a data folder */
  await assert.rejects(async () => (await a.getFileHandle(C.FOLDER_PETS_FILE)).getFile(), { name: "NotFoundError" });
  const write = async (d, text) => { const w = await (await d.getFileHandle(C.FOLDER_PETS_FILE, { create: true })).createWritable(); await w.write(text); await w.close(); };
  await (await b.getFileHandle(C.SETTINGS_FILE)).getFile();
  await assert.rejects(() => b.getFileHandle(C.FOLDER_PETS_FILE).then(h => h.getFile()), { name: "NotFoundError" });
  await write(a, JSON.stringify({ format: 1, pets: { 0: { swim: [] } } }));
  await assert.rejects(() => write(b, JSON.stringify({ format: 1, pets: {} })), /someone else saved/, "b read no file, a saved one since");
  const f = await (await b.getFileHandle(C.FOLDER_PETS_FILE)).getFile();
  assert.match(await f.text(), /"0"/);
  await write(b, JSON.stringify({ format: 1, pets: {} }));
  const lock = await b.getFileHandle(C.FOLDER_PETS_FILE + ".lock", { create: true });
  const w = await lock.createWritable(); await w.write("tok"); await w.close();
  assert.equal(await (await lock.getFile()).text(), "tok", "lock files stay in memory");
  await b.removeEntry(C.FOLDER_PETS_FILE + ".lock");
});

test("folder moved to the cloud: its pages stop writing", async () => {
  const d = new MemDir("data");
  d._f.set("Pat Test.json", { bytes: new TextEncoder().encode(person("Pat Test")), mtime: Date.now() });
  store.setDir(d);
  M.S.participants = await store.loadAll();
  assert.equal(M.S.moved, null);
  await store.markMoved(d, { to: URL0, files: 1 });
  M.S.participants = await store.loadAll();
  assert.equal(M.S.moved.to, URL0, "loadAll sees the marker; app.js then shows the gate before anything is written");
  assert.deepEqual(M.S.participants.map(p => p.name), ["Pat Test"], "the marker is not read as a person");
  assert.deepEqual((await store.folderFiles(d)).map(f => f.name), ["Pat Test.json"], "nor imported");
  store.setDir(null);
});
