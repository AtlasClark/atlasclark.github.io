/* The remote player relay: the real Worker (relay/water-relay-worker.js) on a SQLite
   stand-in for D1, and a round trip in one process. A remote page saves a pour, the
   bridge on a copy of the share writes it, and the remote page sees it confirmed.
   Fake people only. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { MemDir, web } from "./lib/bridge.mjs";

globalThis.document = globalThis.document || { hidden: false };
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../tools/water-challenge/");
const worker = (await import(pathToFileURL(path.join(ROOT, "relay/water-relay-worker.js")))).default;
const relay = await import(pathToFileURL(path.join(ROOT, "js/relay.js")));
const store = web.store, M = web.model;

/* D1's API over node:sqlite: prepare / bind / all / first / run, and batch in one transaction. */
function d1(db) {
  const stmt = (sql, args = []) => ({
    _sql: sql, _args: args,
    bind: (...a) => stmt(sql, a),
    async all() { return { results: db.prepare(sql).all(...args) }; },
    async first() { return db.prepare(sql).get(...args) ?? null; },
    async run() { db.prepare(sql).run(...args); return { meta: {} }; }
  });
  return {
    prepare: sql => stmt(sql),
    async batch(list) {
      db.exec("BEGIN");
      try { for (const s of list) db.prepare(s._sql).run(...s._args); db.exec("COMMIT"); }
      catch (e) { db.exec("ROLLBACK"); throw e; }
      return [];
    }
  };
}

const KEY = "b".repeat(48), RELAY = "https://water-relay.test.workers.dev", ORIGIN = "http://localhost:5517";
const env = { BRIDGE_KEY: KEY, DB: d1(new DatabaseSync(":memory:")) };
globalThis.fetch = async (url, init = {}) =>
  worker.fetch(new Request(url, Object.assign({}, init, { headers: Object.assign({ Origin: ORIGIN }, init.headers || {}) })), env);
const ask = (p, init = {}) => fetch(RELAY + p, init);

const person = name => JSON.stringify({ name, color: "#4f8fd9", created: "2026-10-01", entries: [], pets: {}, graves: {}, dayGoals: {}, spends: [] });
const settle = () => new Promise(r => setTimeout(r, 30));

test("relay worker: only the page's origin, the bridge key, and a player's own key and file", async () => {
  const evil = await worker.fetch(new Request(RELAY + "/ping", { headers: { Origin: "https://evil.example" } }), env);
  assert.equal(evil.status, 403);
  const ping = await (await ask("/ping")).json();
  assert.deepEqual([ping.configured, ping.keyOk], [true, false]);
  assert.equal((await ask("/ping", { headers: { "X-Relay-Key": KEY } }).then(r => r.json())).keyOk, true);
  assert.equal((await ask("/bridge", { method: "POST", body: "{}" })).status, 401);
  const rae = { "X-Player": encodeURIComponent("Remote Rae"), "X-Player-Key": await relay.playerKey(KEY, "remote rae") };
  assert.equal((await ask("/state", { headers: { ...rae, "X-Player-Key": "0".repeat(40) } })).status, 401, "a wrong key");
  assert.equal((await ask("/state", { headers: rae })).status, 200, "the page's key is the one the relay makes");
  const other = await ask("/save", { method: "POST", headers: { ...rae, "Content-Type": "application/json" },
                                     body: JSON.stringify({ id: "x1", rec: person("Office Olu"), args: {} }) });
  assert.equal(other.status, 400, "someone else's file is refused");
});

test("relay round trip: a remote pour reaches the share, undo takes it back, office changes reach the player", async () => {
  M.S.me = "relaytest";
  const share = new MemDir("data");
  share._f.set("Remote Rae.json", { bytes: new TextEncoder().encode(person("Remote Rae")), mtime: Date.now() - 60000 });
  share._f.set("Office Olu.json", { bytes: new TextEncoder().encode(person("Office Olu")), mtime: Date.now() - 60000 });
  const office = async () => { store.setRelay(null); store.setDir(share); M.S.participants = await store.loadAll(); M.dataChanged(); };

  /* the office sets up the relay and sends the share up */
  await office();
  await relay.saveBridgeCfg(RELAY, KEY);
  relay.startBridge(() => { }, false);
  await relay.relayTest.bridgeRound();
  assert.equal(relay.bridgeStatus().state, "this", "the first open page takes the lease");

  /* the remote player joins and pours */
  const remote = await relay.startRemote({ url: RELAY, name: "Remote Rae", key: await relay.playerKey(KEY, "Remote Rae") }, () => { }, true);
  const hook = store.relay;
  const asRemote = async () => { store.setDir(remote); store.setRelay(hook); M.S.participants = await store.loadAll(); M.dataChanged(); };
  await asRemote();
  assert.equal(M.S.participants.length, 2, "the whole team is there");
  const day = web.util.todayKey(), eid = "e:remote:1";
  let rae = M.findParticipant("Remote Rae");
  rae.entries.push({ eid, ts: day + "T09:00:00", date: day, oz: 12, by: "Remote Rae" });
  assert.ok(await store.saveParticipant(rae, null));
  store.writeLive({ type: "pour", id: "lv-remote-1", at: Date.now(), name: "Remote Rae", oz: 12 });
  await relay.relayTest.flush();
  await settle();
  assert.equal(relay.remoteStatus().waiting, 1, "sent, not yet on the share");
  await relay.relayTest.pull();
  assert.ok(remote.text("Remote Rae.json").includes(eid), "kept on the player's page while the office catches up");

  /* the bridge writes it to the share, then confirms */
  await office();
  await relay.relayTest.bridgeRound();
  assert.ok(share.text("Remote Rae.json").includes(eid), "on the share");
  const live = await store.readLive(0, new Set());
  assert.ok(live.some(e => e.id === "lv-remote-1"), "their live event reached the office");
  await relay.relayTest.bridgeRound();

  await asRemote();
  await relay.relayTest.pull();
  assert.equal(relay.remoteStatus().waiting, 0, "confirmed");
  assert.equal(remote.text("Remote Rae.json").split(eid).length - 1, 1, "once");

  /* undo on the remote page takes it off the share */
  rae = M.findParticipant("Remote Rae");
  rae.entries = rae.entries.filter(e => e.eid !== eid);
  assert.ok(await store.saveParticipant(rae, [eid]));
  await relay.relayTest.flush();
  await office();
  await relay.relayTest.bridgeRound();
  assert.ok(!share.text("Remote Rae.json").includes(eid), "undone on the share");

  /* an office pour reaches the remote page */
  const olu = M.findParticipant("Office Olu");
  olu.entries.push({ eid: "e:office:1", ts: day + "T10:00:00", date: day, oz: 20, by: "relaytest" });
  assert.ok(await store.saveParticipant(olu, null));
  await relay.relayTest.bridgeRound();
  await asRemote();
  await relay.relayTest.pull();
  assert.ok(remote.text("Office Olu.json").includes("e:office:1"));
  assert.ok(!remote.text("Remote Rae.json").includes(eid), "and the undo held");

  /* the remote page's saves of other people's files stay on that page */
  const other = M.findParticipant("Office Olu");
  other.entries.push({ eid: "e:sneak:1", ts: day + "T11:00:00", date: day, oz: 5, by: "Remote Rae" });
  await store.saveParticipant(other, null);
  assert.equal(relay.remoteStatus().waiting, 0, "nothing sent for someone else");
  store.setRelay(null);
});
