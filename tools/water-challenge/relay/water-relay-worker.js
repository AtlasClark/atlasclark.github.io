/* Water Challenge relay: a Cloudflare Worker (rev 1.0) that lets a player with no
   access to the team's fileshare play from anywhere.

   How it works:
   - An office page on the share (the bridge) sends the share's files and live events
     up here, and takes the remote player's saves back down to the share, where the
     page's normal merge writes them.
   - The remote player's page reads the files from here and sends its own saves and
     live events (Plinko drops, pours, unlock cards).
   - Only one office page bridges at a time; any open one takes over (js/relay.js).

   Safe by design:
   - Answers only the challenge page's origin.
   - The bridge needs BRIDGE_KEY. A remote player needs their own key, made from
     BRIDGE_KEY and their name, and can only save their own file. A new BRIDGE_KEY
     cancels every invite.
   - Keeps the challenge files (names, ounces, pets, shop records), the remote player's
     unsent saves and two minutes of live events in the D1 database. Nothing else.

   Set up (Cloudflare dashboard, free plan, the account that runs the Hidrate relay):
   1. Storage & Databases > D1 SQL database > Create. Name it water-relay.
   2. Workers & Pages > Create > "Start with Hello World!". Name it water-relay > Deploy.
   3. Edit code (the </> button): replace all of the sample code with this file > Deploy.
   4. Settings > Bindings > Add > D1 database. Variable name DB, database water-relay.
   5. Settings > Variables and Secrets > Add, type Secret:
        BRIDGE_KEY   the key the challenge page made (Settings > Remote player > New key)
   6. In the page: Settings > Remote player, paste the Worker's address
      (https://water-relay.<you>.workers.dev) and the key > Save > Test.
      The tables are made on the first request. */

const RELAY = "water 1.0";
const ORIGINS = ["https://atlasclark.github.io", "http://localhost:5517", "http://127.0.0.1:5517"];
const LIVE_KEEP_MS = 120000;           /* live events older than this are cleared */
const MAX_OPS = 500;                   /* unsent saves kept per player */
const MAX_BODY = 1900000;              /* D1 keeps up to 2 MB in one field */
const MAX_LIVE = 8000;

const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS files (name TEXT PRIMARY KEY, ver INTEGER NOT NULL, body TEXT)",
  "CREATE INDEX IF NOT EXISTS files_ver ON files (ver)",
  "CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)",
  "CREATE TABLE IF NOT EXISTS ops (id TEXT PRIMARY KEY, player TEXT NOT NULL, at INTEGER NOT NULL, body TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS live (id TEXT PRIMARY KEY, at INTEGER NOT NULL, src TEXT NOT NULL, body TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS live_at ON live (at)"
];
let ready = false;

/* Same time whatever the input, so a key can't be guessed a letter at a time. */
function sameKey(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !b) return false;
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a.charCodeAt(i % (a.length || 1)) || 0) ^ b.charCodeAt(i);
  return diff === 0;
}

/* A remote player's key: HMAC-SHA256 of their name under BRIDGE_KEY (js/relay.js makes the same). */
async function playerKey(secret, name) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode("player:" + String(name).trim().toLowerCase()));
  return Array.from(new Uint8Array(sig), b => b.toString(16).padStart(2, "0")).join("").slice(0, 40);
}

async function meta(db, k) { const r = await db.prepare("SELECT v FROM meta WHERE k = ?").bind(k).first(); return r ? r.v : null; }
const setMeta = (db, k, v) => db.prepare("INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v").bind(k, String(v));

/* The bridge: { ack: [op ids written to the share], files: { name: text | null },
   reset: true when it sends every file, live: [office events], liveSince: ms }.
   Answers with the player's waiting saves and live events. */
async function bridge(db, body) {
  const now = Date.now(), files = body.files && typeof body.files === "object" ? body.files : {};
  const names = Object.keys(files).filter(n => typeof n === "string" && n.length < 200 && !n.includes("/"));
  let ver = Number(await meta(db, "ver")) || 0;
  const st = [];
  if (Array.isArray(body.ack) && body.ack.length) st.push(db.prepare("DELETE FROM ops WHERE id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(body.ack.map(String))));
  if (body.reset) st.push(db.prepare("DELETE FROM files"));
  if (names.length) {
    ver++;
    for (const n of names) {
      const t = files[n];
      if (t !== null && (typeof t !== "string" || t.length > MAX_BODY)) continue;
      st.push(db.prepare("INSERT INTO files (name, ver, body) VALUES (?, ?, ?) ON CONFLICT (name) DO UPDATE SET ver = excluded.ver, body = excluded.body").bind(n, ver, t));
    }
    st.push(setMeta(db, "ver", ver));
  }
  const live = (Array.isArray(body.live) ? body.live : []).filter(e => e && e.id && Number(e.at) > 0).map(e => JSON.stringify(e)).filter(s => s.length < MAX_LIVE);
  if (live.length) st.push(db.prepare("INSERT OR IGNORE INTO live (id, at, src, body) SELECT json_extract(value, '$.id'), json_extract(value, '$.at'), 'office', value FROM json_each(?)")
                          .bind(JSON.stringify(live.map(s => JSON.parse(s)))));
  st.push(db.prepare("DELETE FROM live WHERE at < ?").bind(now - LIVE_KEEP_MS));
  st.push(setMeta(db, "bridgeSeen", now));
  await db.batch(st);
  const ops = (await db.prepare("SELECT id, player, at, body FROM ops ORDER BY at LIMIT 40").all()).results || [];
  const pl = (await db.prepare("SELECT body FROM live WHERE src <> 'office' AND at > ? ORDER BY at").bind(Number(body.liveSince) || 0).all()).results || [];
  return { ver, ops: ops.map(o => ({ id: o.id, player: o.player, at: o.at, body: JSON.parse(o.body) })), live: pl.map(r => JSON.parse(r.body)),
           playerSeen: Number(await meta(db, "playerSeen")) || 0, now };
}

/* A remote player's view: files changed since ver, live events since liveSince, and
   which of their saves the bridge has not written yet. */
async function state(db, player, since, liveSince) {
  const now = Date.now();
  await setMeta(db, "playerSeen", now).run();
  const rows = (await db.prepare("SELECT name, body FROM files WHERE ver > ?").bind(since).all()).results || [];
  const files = {};
  for (const r of rows) if (r.body !== null || since > 0) files[r.name] = r.body;
  const live = (await db.prepare("SELECT body FROM live WHERE at > ? AND src <> ? ORDER BY at").bind(liveSince, "player:" + player.toLowerCase()).all()).results || [];
  const pending = (await db.prepare("SELECT id FROM ops WHERE player = ?").bind(player.toLowerCase()).all()).results || [];
  return { ver: Number(await meta(db, "ver")) || 0, files, live: live.map(r => JSON.parse(r.body)), pending: pending.map(r => r.id),
           bridgeSeen: Number(await meta(db, "bridgeSeen")) || 0, now };
}

async function save(db, player, body) {
  let rec = null;
  try { rec = JSON.parse(body.rec); } catch { }
  if (!body.id || !rec || String(rec.name || "").trim().toLowerCase() !== player.toLowerCase()) return { status: 400, error: "only your own file can be saved" };
  const text = JSON.stringify({ rec: body.rec, args: body.args || {} });
  if (text.length > MAX_BODY) return { status: 413, error: "save too large" };
  const n = await db.prepare("SELECT COUNT(*) AS n FROM ops WHERE player = ?").bind(player.toLowerCase()).first();
  if (n && n.n >= MAX_OPS) return { status: 429, error: "too many saves waiting for the office" };
  await db.prepare("INSERT OR IGNORE INTO ops (id, player, at, body) VALUES (?, ?, ?, ?)").bind(String(body.id).slice(0, 80), player.toLowerCase(), Date.now(), text).run();
  return { status: 200, ok: true };
}

async function live(db, player, ev) {
  const text = JSON.stringify(ev || {});
  if (!ev || !ev.id || !(Number(ev.at) > 0) || text.length > MAX_LIVE) return { status: 400, error: "bad live event" };
  await db.prepare("INSERT OR IGNORE INTO live (id, at, src, body) VALUES (?, ?, ?, ?)").bind(String(ev.id).slice(0, 80), Number(ev.at), "player:" + player.toLowerCase(), text).run();
  return { status: 200, ok: true };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (!ORIGINS.includes(origin)) return new Response('{"error":"origin not allowed"}', { status: 403, headers: { "Content-Type": "application/json" } });
    const cors = {
      "Access-Control-Allow-Origin": origin, "Vary": "Origin",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Relay-Key, X-Player, X-Player-Key",
      "Access-Control-Max-Age": "600"
    };
    const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: Object.assign({ "Content-Type": "application/json", "Cache-Control": "no-store" }, cors) });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url), db = env.DB, configured = !!(env.BRIDGE_KEY && db);
    const isBridge = configured && sameKey(request.headers.get("X-Relay-Key") || "", env.BRIDGE_KEY);
    if (url.pathname === "/ping") return reply(200, { ok: true, relay: RELAY, configured, keyOk: isBridge });
    if (!configured) return reply(500, { error: "the relay needs its DB binding and BRIDGE_KEY secret (see the set-up notes)" });
    try {
      if (!ready) { await db.batch(SCHEMA.map(s => db.prepare(s))); ready = true; }
      if (url.pathname === "/bridge" && request.method === "POST") {
        if (!isBridge) return reply(401, { error: "bridge key wrong or missing" });
        return reply(200, await bridge(db, await request.json()));
      }
      let player = "";
      try { player = decodeURIComponent(request.headers.get("X-Player") || "").trim(); } catch { }
      if (!player || player.length > 60 || !sameKey(request.headers.get("X-Player-Key") || "", await playerKey(env.BRIDGE_KEY, player))) {
        return reply(401, { error: "player key wrong or missing" });
      }
      if (url.pathname === "/state" && request.method === "GET") {
        return reply(200, await state(db, player, Number(url.searchParams.get("since")) || 0, Number(url.searchParams.get("liveSince")) || 0));
      }
      if (url.pathname === "/save" && request.method === "POST") { const r = await save(db, player, await request.json()); return reply(r.status, r); }
      if (url.pathname === "/live" && request.method === "POST") { const r = await live(db, player, await request.json()); return reply(r.status, r); }
      return reply(404, { error: "no such call" });
    } catch (e) {
      return reply(500, { error: "relay error: " + (e && e.message || e) });
    }
  }
};
