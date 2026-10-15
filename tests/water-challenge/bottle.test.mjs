/* Bottle sync: the R55 rules for turning sips into entries, and the Cloudflare
   Worker relay (with Hidrate stood in, so nothing goes over the network). */

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const B = await import(pathToFileURL(path.join(ROOT, "tools/water-challenge/js/bottle.js")));
const C = await import(pathToFileURL(path.join(ROOT, "tools/water-challenge/js/config.js")));
const W = (await import(pathToFileURL(path.join(ROOT, "tools/water-challenge/bottle/hidrate-worker.js")))).default;

const KEY = "2026-10-15";
const at = (h, m, s = 0) => new Date(2026, 9, 15, h, m, s).toISOString();     /* local time, as Hidrate's UTC iso */
const sip = (h, m, ml, id) => ({ objectId: id || "s" + h + m + ml, time: { __type: "Date", iso: at(h, m) }, amount: ml });

test("bottle: sips fold into 5-minute entries tagged as the bottle", () => {
  const p = { entries: [{ eid: "m:1", date: KEY, oz: 8, by: "rclark" }] };
  const r = B.applySips(p, [sip(9, 1, 100), sip(9, 4, 200), sip(9, 7, 300), sip(23, 59, 0)], KEY);
  assert.equal(r.added, 2);
  const bottle = p.entries.filter(e => e.by === C.HIDRATE_TAG);
  assert.deepEqual(bottle.map(e => e.sid), ["hid:" + KEY + ":0900", "hid:" + KEY + ":0905"]);
  assert.equal(bottle[0].oz, Math.round(300 / 29.5735 * 10) / 10, "9:01 and 9:04 share a bucket");
  assert.equal(bottle[0].eid, "h:hid:" + KEY + ":0900");
  assert.equal(bottle[0].ts, KEY + "T09:00:00", "stamped at the bucket's start");
  assert.ok(p.entries.some(e => e.eid === "m:1"), "hand-logged pours stay");
});

test("bottle: a bucket only grows, other days are ignored, old sid-less rows go", () => {
  const p = { entries: [{ eid: "old", date: KEY, oz: 3, by: C.HIDRATE_TAG }] };
  B.applySips(p, [sip(9, 1, 300)], KEY);
  assert.ok(!p.entries.some(e => e.eid === "old"), "replaced by the sid rows");
  const before = p.entries.find(e => e.sid).oz;
  let r = B.applySips(p, [sip(9, 1, 100)], KEY);                      /* a reply with fewer sips */
  assert.equal(r.grown, 0); assert.equal(p.entries.find(e => e.sid).oz, before, "never shrinks");
  r = B.applySips(p, [sip(9, 1, 300), sip(9, 3, 300)], KEY);
  assert.equal(r.grown, 1); assert.ok(r.oz > 0);
  const yesterday = { objectId: "y", time: { iso: new Date(2026, 9, 14, 22, 0).toISOString() }, amount: 500 };
  r = B.applySips(p, [yesterday], KEY);
  assert.equal(r.added + r.grown, 0, "only today's sips");
});

test("bottle: only the bottle user sees it", () => {
  assert.equal(C.BOTTLE_USER, "rclark");
});

/* ---- the Worker ------------------------------------------------------------ */
const ENV = { HIDRATE_APP_ID: "app-id", HIDRATE_CLIENT_KEY: "client-key", RELAY_KEY: "relay-secret" };
const PAGE = "https://atlasclark.github.io";
async function run(url, init = {}, env = ENV, upstream) {
  const seen = [], real = globalThis.fetch;
  globalThis.fetch = async (u, opts) => { seen.push({ url: String(u), opts }); return upstream ? upstream(u, opts) : new Response('{"results":[]}', { status: 200 }); };
  try {
    const res = await W.fetch(new Request(url, init), env);
    return { res, body: await res.text(), seen };
  } finally { globalThis.fetch = real; }
}
const H = (extra) => Object.assign({ Origin: PAGE, "X-Relay-Key": "relay-secret" }, extra);

test("relay: only the challenge page, only with the relay key", async () => {
  let r = await run("https://relay.test/parse/classes/Sip", { headers: { Origin: "https://evil.example", "X-Relay-Key": "relay-secret" } });
  assert.equal(r.res.status, 403); assert.equal(r.seen.length, 0);
  r = await run("https://relay.test/parse/classes/Sip", { headers: { Origin: PAGE, "X-Relay-Key": "nope" } });
  assert.equal(r.res.status, 401); assert.equal(r.seen.length, 0);
  r = await run("https://relay.test/parse/classes/_User", { headers: H() });
  assert.equal(r.res.status, 404, "other Hidrate data is not relayed");
  r = await run("https://relay.test/parse/login", { headers: H() });
  assert.equal(r.res.status, 404, "login only as POST");
  r = await run("https://relay.test/parse/classes/Sip", { headers: H() }, {});
  assert.equal(r.res.status, 500, "no secrets set");
});

test("relay: preflight and ping answer the page", async () => {
  let r = await run("https://relay.test/parse/classes/Sip", { method: "OPTIONS", headers: { Origin: PAGE } });
  assert.equal(r.res.status, 204);
  assert.equal(r.res.headers.get("Access-Control-Allow-Origin"), PAGE);
  assert.match(r.res.headers.get("Access-Control-Allow-Headers"), /X-Relay-Key/);
  r = await run("https://relay.test/ping", { headers: H() });
  assert.deepEqual(JSON.parse(r.body), { ok: true, relay: "1.0", configured: true, keyOk: true });
  r = await run("https://relay.test/ping", { headers: { Origin: PAGE, "X-Relay-Key": "relay-secre" } });
  assert.equal(JSON.parse(r.body).keyOk, false);
});

test("relay: adds Hidrate's client-key header and passes the answer back", async () => {
  let r = await run("https://relay.test/parse/classes/Sip?limit=5&order=-time", { headers: H({ "X-Parse-Session-Token": "r:tok" }) });
  assert.equal(r.res.status, 200);
  assert.equal(r.seen[0].url, "https://www.hidrateapp.com/parse/classes/Sip?limit=5&order=-time");
  assert.deepEqual(r.seen[0].opts.headers, { "X-Parse-Application-Id": "app-id", "X-Parse-Client-Key": "client-key", "X-Parse-Session-Token": "r:tok" });
  r = await run("https://relay.test/parse/login", { method: "POST", body: '{"username":"a","password":"b"}',
                headers: H({ "Content-Type": "application/json", "X-Parse-Revocable-Session": "1" }) },
                ENV, () => new Response('{"error":"Invalid username/password.","code":101}', { status: 404 }));
  assert.equal(r.seen[0].opts.method, "POST");
  assert.equal(r.seen[0].opts.body, '{"username":"a","password":"b"}');
  assert.equal(r.seen[0].opts.headers["X-Parse-Revocable-Session"], "1");
  assert.equal(r.res.status, 404); assert.match(r.body, /Invalid username/, "Hidrate's error comes back as is");
});
