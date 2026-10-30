/* Water Challenge cloud: a Cloudflare Worker with one Durable Object (rev cloud 1.0).
   Scope: holds the whole challenge online, so the page needs no shared folder. People
   sign in with an access code; the page's own merge rules stay as they were.

   What it keeps (the Durable Object's SQLite storage, nothing else):
   - files    the files the data folder had: <Name>.json per person, _settings.json, _pets.json
   - codes    access codes as SHA-256 hashes only, each with a user name and a glass
   - removed  people taken off the roster (an admin can bring them back)
   - backups  a copy of every file each evening (BACKUP_HOUR in TIME_ZONE), BACKUP_KEEP_DAYS kept
   - live     two minutes of live events (pours, Plinko drops, unlock cards)

   How pages use it (every call needs a code: "Authorization: Bearer <code>"):
   - GET  /api/hello            who the code is; the change counter (seq)
   - GET  /api/state            every file changed after change N (header X-Since: N; a header, so
                                the browser's CORS check is cached for one URL), and all names
                                with their versions
   - GET  /api/file?name=       one file (the Pet Studio)
   - PUT  /api/file             {name, ver, body}: written only when the file is still at ver
                                (0 = new), else 409 with the current copy; the page merges, retries
   - GET  /api/ws               WebSocket (code in the protocol list as "c.<code>"): "seq" after
                                every change, live events both ways, "ping" answered "pong"
   - POST /api/live, GET /api/live   live events while the socket is down (X-Since: server ms)
   - admin: /api/codes, /api/codes/new, /api/codes/revoke, /api/remove, /api/removed,
            /api/unremove, /api/import, /api/backups, /api/backup, /api/backup/now, /api/restore

   Rules, checked here whatever a page sends:
   - Answers only the challenge page's origins (ORIGINS).
   - OWNER_CODE (a secret, 12+ letters or digits) is always an admin code: for set-up and recovery.
   - Players may change any person's file (pours for others, as on the share), but a new pour
     must carry their own user name, and only the glass's own code may spend from it.
     New people, settings, codes, import, restore and removal: admin only. Pet art
     (_pets.json): admin, or a code with "art".
   - No string in any file or live event may hold < or >, colours are #hex, and sizes are
     capped, so nothing a code holder sends can put markup on other screens.
   - 12 wrong codes from one address in 10 minutes locks that address out for the rest of them.

   Set up (once; Cloudflare free plan is enough). Deploys run on GitHub, so no PC needs Wrangler:
   1. Cloudflare: My Profile > API Tokens > Create Token, template "Edit Cloudflare Workers".
   2. GitHub repo > Settings > Secrets and variables > Actions, add three secrets:
        CLOUDFLARE_API_TOKEN (step 1), CLOUDFLARE_ACCOUNT_ID (dashboard, Workers & Pages),
        WATER_OWNER_CODE (a long random code, 12+ letters and digits; keep it safe).
   3. Actions > Water cloud deploy > Run workflow (.github/workflows/water-cloud-deploy.yml). It
      tests, deploys, sets OWNER_CODE and checks the Worker; its summary shows the address.
      It runs again by itself when this folder changes on main or water-cloud.
   4. Copy the address (https://water-cloud.<you>.workers.dev) into js/config.js CLOUD_URL.
   5. Open the page, enter the owner code, then Settings > Access codes: make your own admin code,
      then one code per person. Settings > Cloud data > Import from folder copies the share in.
   Without GitHub: in this folder, npx wrangler deploy, then npx wrangler secret put OWNER_CODE.
   TIME_ZONE and BACKUP_HOUR are [vars] in wrangler.toml. */

const REV = "cloud 1.0";
const ORIGINS = ["https://atlasclark.github.io", "http://localhost:5517", "http://127.0.0.1:5517"];
const SPECIAL = ["_settings.json", "_pets.json"];
const HIDRATE_TAG = "hidrate";                 /* "by" on bottle entries (js/config.js) */
const MAX_FILE = 1500000;                      /* SQLite keeps up to 2 MB in one value */
const MAX_LIVE = 6000, LIVE_KEEP_MS = 120000, LIVE_KINDS = ["drop", "pour", "unlock"];
const MAX_PEOPLE = 80, MAX_CODES = 200, MAX_IMPORT = 120;
const FAIL_MAX = 12, FAIL_WINDOW_MS = 600000;
const USED_EVERY_MS = 300000;                  /* "last used" is written at most this often */
const CODE_ABC = "ABCDEFGHJKMNPQRSTUVWXYZ23456789", CODE_LEN = 12;
const DEF_TZ = "America/New_York", DEF_HOUR = 18, DEF_KEEP = 14;

const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS files (name TEXT PRIMARY KEY, ver INTEGER NOT NULL, body TEXT NOT NULL, at INTEGER NOT NULL, by TEXT)",
  "CREATE INDEX IF NOT EXISTS files_ver ON files (ver)",
  "CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)",
  "CREATE TABLE IF NOT EXISTS codes (id TEXT PRIMARY KEY, hash TEXT UNIQUE NOT NULL, user TEXT NOT NULL, glass TEXT NOT NULL, " +
    "admin INTEGER NOT NULL, art INTEGER NOT NULL, created INTEGER NOT NULL, used INTEGER NOT NULL, revoked INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS removed (name TEXT NOT NULL, at INTEGER NOT NULL, by TEXT, body TEXT NOT NULL, PRIMARY KEY (name, at))",
  "CREATE TABLE IF NOT EXISTS backups (day TEXT NOT NULL, name TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY (day, name))",
  "CREATE TABLE IF NOT EXISTS live (id TEXT PRIMARY KEY, at INTEGER NOT NULL, body TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS live_at ON live (at)"
];

/* ---- helpers --------------------------------------------------------------------- */
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const bad = (status, message) => Object.assign(new Error(message), { status });
const same = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
export const safeFileName = n => String(n).replace(/[\\\/:\*\?"<>\|\.]/g, "_");     /* as js/store.js */
export const normCode = c => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
export const showCode = c => c.match(/.{1,4}/g).join("-");

/* Same time whatever the input, so a code can't be guessed a letter at a time. */
function sameKey(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !b) return false;
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a.charCodeAt(i % (a.length || 1)) || 0) ^ b.charCodeAt(i);
  return diff === 0;
}
async function sha(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), b => b.toString(16).padStart(2, "0")).join("");
}
function newCode() {
  const r = crypto.getRandomValues(new Uint32Array(CODE_LEN));
  return Array.from(r, n => CODE_ABC[n % CODE_ABC.length]).join("");
}
const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), b => b.toString(16).padStart(2, "0")).join("");
const pub = w => ({ id: w.id, user: w.user, glass: w.glass, admin: !!w.admin, art: !!w.art });

/* ---- what may be written ---------------------------------------------------------- */
export function checkName(name) {
  if (typeof name !== "string" || !name.endsWith(".json") || name.length > 120) return "not a challenge file name";
  if (SPECIAL.includes(name)) return "";
  if (name.startsWith("_") || /[\\\/:\*\?"<>\|]/.test(name) || /\.\./.test(name)) return "not a challenge file name";
  return "";
}

/* Any string anywhere with < or >, or too deep: refused. */
function markup(v, depth = 0) {
  if (depth > 12) return "nested too deep";
  if (typeof v === "string") return /[<>]/.test(v) ? "text may not hold < or >" : "";
  if (Array.isArray(v)) { for (const x of v) { const e = markup(x, depth + 1); if (e) return e; } return ""; }
  if (v && typeof v === "object") {
    for (const k of Object.keys(v)) { if (/[<>]/.test(k)) return "text may not hold < or >"; const e = markup(v[k], depth + 1); if (e) return e; }
  }
  return "";
}

const NAME_RE = /^[^<>"&\u0000-\u001f]{1,60}$/, HEX_RE = /^#[0-9a-f]{3,8}$/i, DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export function checkRecord(o) {
  if (!o || typeof o !== "object" || Array.isArray(o)) return "not a person's file";
  if (typeof o.name !== "string" || !NAME_RE.test(o.name.trim())) return "the name is missing or has < > \" &";
  if (o.color !== undefined && !HEX_RE.test(String(o.color))) return "the colour must be #hex";
  if (!Array.isArray(o.entries)) return "no entries list";
  for (const e of o.entries) {
    if (!e || typeof e !== "object") return "an entry is not an object";
    if (!isFinite(Number(e.oz)) || Math.abs(Number(e.oz)) > 10000) return "an entry's ounces are not a number";
    if (e.date !== undefined && !DAY_RE.test(String(e.date))) return "an entry's date is not YYYY-MM-DD";
    for (const f of ["eid", "ts", "by", "sid"]) if (e[f] !== undefined && (typeof e[f] !== "string" || e[f].length > 120)) return "an entry's " + f + " is not short text";
  }
  if (o.spends !== undefined && !Array.isArray(o.spends)) return "spends is not a list";
  for (const s of o.spends || []) if (!s || typeof s !== "object" || typeof s.id !== "string" || s.id.length > 120) return "a spend has no id";
  for (const f of ["pets", "graves", "dayGoals"]) {
    const m = o[f];
    if (m === undefined) continue;
    if (!m || typeof m !== "object" || Array.isArray(m)) return f + " is not a map";
    for (const k of Object.keys(m)) if (!isFinite(Number(m[k]))) return f + " holds a value that is not a number";
  }
  return markup(o);
}

/* A pour is the same pour when its eid matches, or (for files written before eids) its
   day, time and logger do. Bottle entries grow in place, so the ounces are left out. */
const entryKey = e => (e && e.date) + "|" + (e && e.ts) + "|" + String((e && e.by) || "").toLowerCase();

export function checkWrite(who, name, old, o) {
  if (name === "_settings.json") {
    if (!who.admin) return "only an admin can change the challenge settings";
    return o && typeof o === "object" && !Array.isArray(o) ? markup(o) : "not a settings file";
  }
  if (name === "_pets.json") {
    if (!who.admin && !who.art) return "only an admin or a pet artist can change the pet art";
    return o && typeof o === "object" && o.pets && typeof o.pets === "object" ? markup(o) : "not a pets file";
  }
  const shape = checkRecord(o);
  if (shape) return shape;
  if (safeFileName(o.name.trim()) + ".json" !== name) return "the name inside does not match the file name";
  if (!old) return who.admin ? "" : "only an admin can add a person";
  if (who.admin) return "";
  if (!same(old.name, o.name)) return "a person's name can't be changed";
  const own = same(o.name, who.glass);
  const ids = new Set(), keys = new Set();
  for (const e of old.entries || []) { if (e && e.eid) ids.add(e.eid); keys.add(entryKey(e)); }
  for (const e of o.entries) {
    if (ids.has(e.eid) || keys.has(entryKey(e))) continue;
    if (!(same(e.by, who.user) || (own && e.by === HIDRATE_TAG))) return "a new pour must be logged under your own name (" + who.user + ")";
  }
  if (!own) {
    const had = new Set((old.spends || []).map(s => s && s.id));
    if ((o.spends || []).some(s => !had.has(s.id))) return "only " + o.name + "'s own code can spend from " + o.name + "'s glass";
  }
  return "";
}

/* ---- the Worker: origin check and CORS, then the one Durable Object ---------------- */
export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (!ORIGINS.includes(origin)) return json({ error: "origin not allowed" }, 403);
    const cors = { "Access-Control-Allow-Origin": origin, "Vary": "Origin" };
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: Object.assign({ "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Since", "Access-Control-Max-Age": "86400" }, cors) });
    }
    const url = new URL(request.url);
    let res;
    if (!url.pathname.startsWith("/api/")) res = json({ error: "not found" }, 404);
    else if (!env.CHALLENGE) res = json({ error: "the CHALLENGE Durable Object is not bound (see wrangler.toml)" }, 503);
    else res = await env.CHALLENGE.get(env.CHALLENGE.idFromName(env.ROOM || "main")).fetch(request);
    if (res.status === 101) return res;
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
    return out;
  }
};

/* ---- the challenge --------------------------------------------------------------- */
export class Challenge {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env || {}; this.sql = ctx.storage.sql;
    this.fails = new Map(); this.alarmOk = false;
    for (const q of SCHEMA) this.sql.exec(q);
    if (typeof WebSocketRequestResponsePair === "function") {          /* answered without waking the object */
      ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    }
  }

  meta(k) { const r = this.sql.exec("SELECT v FROM meta WHERE k = ?", k).toArray()[0]; return r ? r.v : ""; }
  setMeta(k, v) { this.sql.exec("INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", k, String(v)); }
  seq() { return Number(this.meta("seq")) || 0; }
  bump() { const s = this.seq() + 1; this.setMeta("seq", s); return s; }
  file(name) { return this.sql.exec("SELECT name, ver, body FROM files WHERE name = ?", name).toArray()[0] || null; }

  /* ---- who is asking ---- */
  async who(request, code) {
    const ip = request.headers.get("CF-Connecting-IP") || "local", now = Date.now();
    const f = this.fails.get(ip);
    if (f && f.n >= FAIL_MAX && now - f.at < FAIL_WINDOW_MS) return { status: 429, error: "too many wrong codes from here; wait 10 minutes" };
    const owner = normCode(this.env.OWNER_CODE);
    if (owner.length < 12) return { status: 503, error: "the Worker's OWNER_CODE secret is not set (12+ letters or digits)" };
    const c = normCode(code);
    let who = null;
    if (c && sameKey(c, owner)) who = { id: "owner", user: "owner", glass: "", admin: 1, art: 1 };
    else if (c.length >= 10) {
      const row = this.sql.exec("SELECT * FROM codes WHERE hash = ? AND revoked = 0", await sha("awc:" + c)).toArray()[0];
      if (row) {
        who = row;
        if (now - row.used > USED_EVERY_MS) this.sql.exec("UPDATE codes SET used = ? WHERE id = ?", now, row.id);
      }
    }
    if (!who) {
      const g = f && now - f.at < FAIL_WINDOW_MS ? f : { n: 0, at: now };
      g.n++; this.fails.set(ip, g);
      return { status: 401, error: "access code not accepted" };
    }
    this.fails.delete(ip);
    return { who };
  }

  async fetch(request) {
    await this.ensureAlarm();
    const url = new URL(request.url), path = url.pathname.replace(/^\/api/, "");
    let code = "";
    if (path === "/ws") {
      const c = (request.headers.get("Sec-WebSocket-Protocol") || "").split(",").map(s => s.trim()).find(p => p.startsWith("c."));
      code = c ? c.slice(2) : "";
    } else {
      const a = request.headers.get("Authorization") || "";
      code = a.startsWith("Bearer ") ? a.slice(7) : "";
    }
    const auth = await this.who(request, code);
    if (auth.error) return json({ error: auth.error }, auth.status);
    try { return await this.route(request.method, path, url, request, auth.who); }
    catch (e) { return json({ error: e.status ? e.message : "server error: " + (e.message || e) }, e.status || 500); }
  }

  async route(m, path, url, request, who) {
    const body = async () => { try { return await request.json(); } catch { throw bad(400, "the request is not JSON"); } };
    const admin = () => { if (!who.admin) throw bad(403, "admin only"); };
    switch (m + " " + path) {
      case "GET /hello": return json({ rev: REV, seq: this.seq(), me: pub(who), lastBackup: this.meta("lastBackup"), now: Date.now() });
      case "GET /state": return json(this.state(Number(request.headers.get("X-Since") || url.searchParams.get("since")) || 0));
      case "GET /file": {
        const name = url.searchParams.get("name") || "";
        if (checkName(name)) throw bad(400, checkName(name));
        const f = this.file(name);
        return json(f ? { name, ver: f.ver, body: f.body } : { name, ver: 0, body: null });
      }
      case "PUT /file": { const b = await body(); return this.write(who, b.name, Number(b.ver) || 0, b.body); }
      case "GET /ws": return this.upgrade(request, who);
      case "POST /live": {
        const b = await body(), err = this.addLive(b.ev);
        if (err) throw bad(400, err);
        this.broadcast({ t: "live", ev: b.ev });
        return json({ ok: true });
      }
      case "GET /live": {
        const since = Number(request.headers.get("X-Since") || url.searchParams.get("since")) || 0;
        return json({ events: this.sql.exec("SELECT body FROM live WHERE at > ? ORDER BY at", since).toArray().map(r => JSON.parse(r.body)), now: Date.now() });
      }
      case "GET /codes": admin(); return json({ codes: this.sql.exec("SELECT id, user, glass, admin, art, created, used, revoked FROM codes ORDER BY revoked, user").toArray() });
      case "POST /codes/new": admin(); return this.makeCode(await body());
      case "POST /codes/revoke": {
        admin();
        const b = await body();
        this.sql.exec("UPDATE codes SET revoked = 1 WHERE id = ?", String(b.id || ""));
        for (const ws of this.ctx.getWebSockets(String(b.id || ""))) { try { ws.send(JSON.stringify({ t: "bye", why: "this access code was revoked" })); ws.close(4001, "revoked"); } catch { } }
        return json({ ok: true });
      }
      case "POST /remove": {
        admin();
        const b = await body(), name = String(b.name || ""), f = this.file(name);
        if (!f || SPECIAL.includes(name)) throw bad(404, "no such person");
        this.sql.exec("INSERT INTO removed (name, at, by, body) VALUES (?, ?, ?, ?)", name, Date.now(), who.user, f.body);
        this.sql.exec("DELETE FROM files WHERE name = ?", name);
        return this.changed();
      }
      case "GET /removed": admin(); return json({ removed: this.sql.exec("SELECT name, at, by FROM removed ORDER BY at DESC").toArray() });
      case "POST /unremove": {
        admin();
        const b = await body(), r = this.sql.exec("SELECT body FROM removed WHERE name = ? AND at = ?", String(b.name || ""), Number(b.at) || 0).toArray()[0];
        if (!r) throw bad(404, "not in the removed list");
        if (this.file(String(b.name))) throw bad(409, "someone with that name is on the roster");
        const s = this.bump();
        this.sql.exec("INSERT INTO files (name, ver, body, at, by) VALUES (?, ?, ?, ?, ?)", String(b.name), s, r.body, Date.now(), who.user);
        this.sql.exec("DELETE FROM removed WHERE name = ? AND at = ?", String(b.name), Number(b.at));
        this.broadcast({ t: "seq", seq: s });
        return json({ ok: true, seq: s });
      }
      case "POST /import": admin(); return this.importFiles(who, await body());
      case "GET /backups": {
        admin();
        return json({ backups: this.sql.exec("SELECT day, COUNT(*) AS files, SUM(LENGTH(body)) AS bytes FROM backups GROUP BY day ORDER BY day DESC").toArray(),
                      lastBackup: this.meta("lastBackup") });
      }
      case "GET /backup": {
        admin();
        const day = url.searchParams.get("day") || "";
        const files = this.sql.exec("SELECT name, body FROM backups WHERE day = ? ORDER BY name", day).toArray();
        if (!files.length) throw bad(404, "no backup " + day);
        return json({ day, files });
      }
      case "POST /backup/now": {
        admin();
        const t = this.local(new Date()), day = t.day + " " + t.hm + " manual";
        return json({ day, files: this.takeBackup(day) });
      }
      case "POST /restore": {
        admin();
        const b = await body(), day = String(b.day || "");
        const files = this.sql.exec("SELECT name, body FROM backups WHERE day = ?", day).toArray();
        if (!files.length) throw bad(404, "no backup " + day);
        const t = this.local(new Date());
        this.takeBackup(t.day + " " + t.hm + " before restore");
        const s = this.bump();
        for (const f of files) {
          this.sql.exec("INSERT INTO files (name, ver, body, at, by) VALUES (?, ?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET ver = excluded.ver, body = excluded.body, at = excluded.at, by = excluded.by",
                        f.name, s, f.body, Date.now(), who.user);
        }
        this.broadcast({ t: "seq", seq: s });
        return json({ ok: true, files: files.length, seq: s });
      }
    }
    throw bad(404, "no such call: " + m + " " + path);
  }

  /* Files changed after change `since`, and every name with its version (a name gone
     from the list was removed). */
  state(since) {
    const names = {};
    for (const r of this.sql.exec("SELECT name, ver FROM files").toArray()) names[r.name] = r.ver;
    const files = this.sql.exec("SELECT name, ver, body FROM files WHERE ver > ?", since).toArray();
    return { seq: this.seq(), names, files };
  }

  changed() { const s = this.bump(); this.broadcast({ t: "seq", seq: s }); return json({ ok: true, seq: s }); }

  /* Compare and swap: a page sends the version it merged onto. */
  write(who, name, ver, body) {
    const nameErr = checkName(name);
    if (nameErr) throw bad(400, nameErr);
    if (typeof body !== "string") throw bad(400, "no file body");
    if (body.length > MAX_FILE) throw bad(413, name + " is too large");
    let o;
    try { o = JSON.parse(body); } catch { throw bad(400, name + " is not valid JSON"); }
    const cur = this.file(name);
    if ((cur ? cur.ver : 0) !== ver) return json({ conflict: true, ver: cur ? cur.ver : 0, body: cur ? cur.body : null }, 409);
    if (!cur && !SPECIAL.includes(name) && this.people() >= MAX_PEOPLE) throw bad(403, "the roster is full (" + MAX_PEOPLE + ")");
    let old = null;
    try { old = cur ? JSON.parse(cur.body) : null; } catch { old = null; }
    const why = checkWrite(who, name, old, o);
    if (why) throw bad(403, why);
    const s = this.bump();
    this.sql.exec("INSERT INTO files (name, ver, body, at, by) VALUES (?, ?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET ver = excluded.ver, body = excluded.body, at = excluded.at, by = excluded.by",
                  name, s, body, Date.now(), who.user);
    this.broadcast({ t: "seq", seq: s });
    return json({ ver: s, seq: s });
  }

  people() { return this.sql.exec("SELECT COUNT(*) AS n FROM files WHERE name NOT LIKE '\\_%' ESCAPE '\\'").toArray()[0].n; }

  async makeCode(b) {
    const user = String(b.user || "").trim(), glass = String(b.glass || "").trim();
    if (!NAME_RE.test(user)) throw bad(400, "a user name of 1-60 characters, without < > \" &, is needed");
    if (glass && !this.file(safeFileName(glass) + ".json")) throw bad(400, glass + " is not on the roster");
    if (this.sql.exec("SELECT COUNT(*) AS n FROM codes WHERE revoked = 0").toArray()[0].n >= MAX_CODES) throw bad(403, "too many codes; revoke some first");
    const code = newCode(), id = newId(), now = Date.now();
    this.sql.exec("INSERT INTO codes (id, hash, user, glass, admin, art, created, used, revoked) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0)",
                  id, await sha("awc:" + code), user, glass, b.admin ? 1 : 0, b.art ? 1 : 0, now);
    return json({ id, code: showCode(code), user, glass, admin: !!b.admin, art: !!b.art });
  }

  /* Files from a data folder or a backup bundle; same names are replaced. */
  importFiles(who, b) {
    const list = Array.isArray(b.files) ? b.files : [];
    if (list.length > MAX_IMPORT) throw bad(413, "too many files in one call (" + MAX_IMPORT + ")");
    const ok = [], skipped = [];
    const good = [];
    for (const f of list) {
      const name = f && String(f.name || ""), err = checkName(name);
      if (err) { skipped.push({ name, why: err }); continue; }
      if (typeof f.body !== "string" || f.body.length > MAX_FILE) { skipped.push({ name, why: "missing or too large" }); continue; }
      let o;
      try { o = JSON.parse(f.body); } catch { skipped.push({ name, why: "not valid JSON" }); continue; }
      const why = checkWrite(Object.assign({}, who, { admin: 1 }), name, null, o);
      if (why) { skipped.push({ name, why }); continue; }
      good.push(f);
    }
    if (!good.length) return json({ written: 0, skipped, seq: this.seq() });
    const s = this.bump();
    for (const f of good) {
      this.sql.exec("INSERT INTO files (name, ver, body, at, by) VALUES (?, ?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET ver = excluded.ver, body = excluded.body, at = excluded.at, by = excluded.by",
                    f.name, s, f.body, Date.now(), who.user);
      ok.push(f.name);
    }
    this.broadcast({ t: "seq", seq: s });
    return json({ written: ok.length, names: ok, skipped, seq: s });
  }

  /* ---- live events ---- */
  addLive(ev) {
    if (!ev || typeof ev !== "object" || Array.isArray(ev)) return "not an event";
    if (!LIVE_KINDS.includes(ev.type || "drop")) return "unknown event type";
    if (typeof ev.id !== "string" || ev.id.length > 80 || !isFinite(Number(ev.at))) return "an event needs an id and a time";
    const text = JSON.stringify(ev);
    if (text.length > MAX_LIVE) return "the event is too large";
    const m = markup(ev);
    if (m) return m;
    const now = Date.now();
    this.sql.exec("INSERT OR IGNORE INTO live (id, at, body) VALUES (?, ?, ?)", ev.id, now, text);
    this.sql.exec("DELETE FROM live WHERE at < ?", now - LIVE_KEEP_MS);
    return "";
  }

  broadcast(o, except) {
    const s = JSON.stringify(o);
    for (const ws of this.ctx.getWebSockets()) { if (ws === except) continue; try { ws.send(s); } catch { } }
  }

  /* ---- WebSocket (hibernation: the object sleeps while sockets stay open) ---- */
  upgrade(request, who) {
    if ((request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") throw bad(426, "WebSocket only");
    const pair = new WebSocketPair(), [client, server] = Object.values(pair);
    this.accept(server, who);
    return new Response(null, { status: 101, webSocket: client, headers: { "Sec-WebSocket-Protocol": "awc" } });
  }
  accept(server, who) {
    this.ctx.acceptWebSocket(server, [who.id]);
    server.serializeAttachment(pub(who));
    server.send(JSON.stringify({ t: "seq", seq: this.seq() }));
  }
  async webSocketMessage(ws, msg) {
    if (msg === "ping") { ws.send("pong"); return; }
    let o = null;
    try { o = JSON.parse(msg); } catch { return; }
    if (o && o.t === "live" && !this.addLive(o.ev)) this.broadcast({ t: "live", ev: o.ev }, ws);
  }
  async webSocketClose(ws, code) { try { ws.close([1005, 1006, 1015].includes(code) ? 1000 : code, "closed"); } catch { } }
  async webSocketError() { }

  /* ---- evening backup (hourly alarm; a missed evening is taken next morning) ---- */
  async ensureAlarm() {
    if (this.alarmOk) return;
    this.alarmOk = true;
    if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + 60000);
  }
  async alarm() {
    try { this.backupIfDue(new Date()); this.sql.exec("DELETE FROM live WHERE at < ?", Date.now() - LIVE_KEEP_MS); }
    finally { await this.ctx.storage.setAlarm(Date.now() + 3600000); }
  }
  /* Day and time in the team's time zone. */
  local(d) {
    const p = {};
    for (const x of new Intl.DateTimeFormat("en-CA", { timeZone: this.env.TIME_ZONE || DEF_TZ, year: "numeric", month: "2-digit", day: "2-digit",
                                                       hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d)) p[x.type] = x.value;
    return { day: p.year + "-" + p.month + "-" + p.day, hour: Number(p.hour), hm: p.hour + ":" + p.minute };
  }
  backupIfDue(now) {
    const t = this.local(now), hour = Number(this.env.BACKUP_HOUR) || DEF_HOUR;
    const slot = t.hour >= hour ? t.day : shiftDay(t.day, -1);
    if (this.meta("lastBackup") >= slot) return 0;
    const n = this.takeBackup(slot);
    this.setMeta("lastBackup", slot);
    return n;
  }
  takeBackup(day) {
    this.sql.exec("DELETE FROM backups WHERE day = ?", day);
    this.sql.exec("INSERT INTO backups (day, name, body) SELECT ?, name, body FROM files", day);
    const keep = Number(this.env.BACKUP_KEEP_DAYS) || DEF_KEEP;
    this.sql.exec("DELETE FROM backups WHERE day < ?", shiftDay(this.local(new Date()).day, -keep));
    return this.sql.exec("SELECT COUNT(*) AS n FROM backups WHERE day = ?", day).toArray()[0].n;
  }
}

function shiftDay(key, n) {
  const d = new Date(key + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
