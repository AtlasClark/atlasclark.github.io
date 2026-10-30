/* Cloud data (rev 1.38.0): the challenge held online by the Worker in cloud/ (one
   Durable Object) instead of a shared folder. A person signs in with an access code;
   the code also says who they are (user name), which glass is theirs and whether they
   are an admin. Nothing of the challenge is kept in this browser but a copy in memory.

   - A copy of every file is kept in memory, at the version the Worker gave it. A save
     merges onto that copy and sends the version it merged onto; when someone saved
     first, the Worker answers 409 with the newer copy and the merge runs again. This
     replaces the folder's lock files.
   - A WebSocket brings the change counter (seq) after every save, and live events
     (pours, drops, unlock cards) both ways. Without it, the page polls (POLL_MS).
   - The code, and the Worker address, are kept in IndexedDB "cloud" on this origin. */

import * as C from "./config.js";
import { kvGet, kvSet, kvDel, liveFileId } from "./store.js";

export const cdiag = { url: "", state: "off", seq: 0, calls: 0, writes: 0, conflicts: 0, lastError: "", rev: "", lastBackup: "", since: "" };

let cfg = null, me = null, hooks = {};
const files = new Map();           /* name -> { ver, body } */
let seq = 0, top = 0;              /* seq: the copy is complete up to here; top: the newest seq heard of */
let ws = null, ping = 0, retry = 0, retryTimer = 0, stopped = true;
let queue = [], lastLivePoll = 0;

export const normCode = c => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
export const showCode = c => (normCode(c).match(/.{1,4}/g) || []).join("-");
const cleanUrl = u => String(u || "").trim().replace(/\/+$/, "");
export const URL_RE = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

export const on = () => !!cfg && !stopped;
export const who = () => me;
export const isAdmin = () => !!(me && me.admin);
export const canArt = () => !!(me && (me.admin || me.art));
export const config = () => cfg;
const wsLive = () => !!ws && ws.readyState === 1;

/* ---- requests ----------------------------------------------------------------- */
async function request(c, method, path, body, allow = [], headers = {}) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), C.CLOUD_TIMEOUT_MS);
  let r;
  try {
    r = await fetch(c.url + path, { method, cache: "no-store", signal: ctl.signal, body: body ? JSON.stringify(body) : undefined,
                                    headers: Object.assign({ Authorization: "Bearer " + normCode(c.code) }, body ? { "Content-Type": "application/json" } : {}, headers) });
  } catch (e) {
    throw Object.assign(new Error(e && e.name === "AbortError" ? "the cloud did not answer in time" : "can't reach the cloud (" + (e && e.message || e) + ")"), { status: 0 });
  } finally { clearTimeout(t); }
  cdiag.calls++;
  let j = null;
  try { j = await r.json(); } catch { }
  if (r.ok || allow.includes(r.status)) return Object.assign({}, j || {}, { status: r.status });
  throw Object.assign(new Error((j && j.error) || "the cloud answered " + r.status), { status: r.status });
}
async function call(method, path, body, allow, headers) {
  try { return await request(cfg, method, path, body, allow, headers); }
  catch (e) {
    cdiag.lastError = e.message;
    if (e.status === 401 && hooks.onBye) hooks.onBye(e.message);
    throw e;
  }
}

/* ---- sign-in ------------------------------------------------------------------ */
/* The saved sign-in, or a code from an invite link (#code=...), which is taken out of the
   address at once. A code from a link is saved only once the Worker accepts it. */
export async function loadCfg() {
  let saved = null;
  try { saved = (await kvGet("cloud")) || null; } catch { saved = null; }
  const m = /[#&]code=([A-Za-z0-9-]+)/.exec(location.hash);
  if (m) {
    history.replaceState(null, "", location.pathname + location.search);
    const url = cleanUrl((saved && saved.url) || C.CLOUD_URL);
    return { url, code: normCode(m[1]), fresh: true };
  }
  return saved && saved.url && saved.code ? { url: cleanUrl(saved.url), code: normCode(saved.code) } : null;
}

/* Checks a code without starting anything: { me, rev, seq } or throws. */
export async function hello(url, code) {
  return request({ url: cleanUrl(url), code }, "GET", "/api/hello");
}

/* Signs in, fills the copy and opens the socket. hooks: onChange (a newer seq was heard,
   or the socket came back), onBye (the code stopped working). */
export async function start(c, h = {}) {
  stop();
  const url = cleanUrl(c.url), code = normCode(c.code);
  if (!URL_RE.test(url)) throw new Error("the cloud address is not set (CLOUD_URL in js/config.js)");
  const r = await hello(url, code);
  cfg = { url, code }; me = r.me; hooks = h; stopped = false;
  cdiag.url = url; cdiag.rev = r.rev || ""; cdiag.lastBackup = r.lastBackup || ""; cdiag.since = new Date().toTimeString().slice(0, 8);
  files.clear(); seq = 0; top = Number(r.seq) || 0;
  await sync(true);
  try { await kvSet("cloud", { url, code }); } catch { }
  openSocket();
  return me;
}

export function stop() {
  stopped = true;
  clearTimeout(retryTimer); clearInterval(ping);
  if (ws) { try { ws.close(1000, "bye"); } catch { } ws = null; }
  cdiag.state = "off";
}

export async function signOut() {
  stop();
  cfg = null; me = null; files.clear(); seq = top = 0; queue = [];
  try { await kvDel("cloud"); } catch { }
}

/* The page's address with a code in it: opening it signs that browser in. */
export function inviteLink(code) {
  return location.origin + location.pathname.replace(/index\.html$/, "") + "#code=" + showCode(code);
}

/* ---- the copy ------------------------------------------------------------------- */
/* Brings the copy up to the Worker's seq. Skipped when the socket is live and has heard of
   nothing newer, unless forced. Returns true when a file changed. */
export async function sync(force) {
  if (!cfg) throw new Error("not signed in");
  if (!force && wsLive() && top <= seq) return false;
  let r = await call("GET", "/api/state", null, [], { "X-Since": String(seq) });
  /* a version the copy should have but doesn't (it never should): take everything again */
  if (Object.entries(r.names || {}).some(([n, v]) => v <= seq && (!files.has(n) || files.get(n).ver !== v) && !(r.files || []).some(f => f.name === n))) {
    r = await call("GET", "/api/state", null, [], { "X-Since": "0" });
    files.clear();
  }
  for (const f of r.files || []) files.set(f.name, { ver: f.ver, body: f.body });
  for (const n of [...files.keys()]) if (!(n in (r.names || {}))) files.delete(n);
  seq = Number(r.seq) || 0;
  top = Math.max(top, seq);
  cdiag.seq = seq;
  return (r.files || []).length > 0;
}

export const entries = () => [...files].map(([n, f]) => [n, f.body]);
export const read = name => files.has(name) ? files.get(name).body : null;
export const version = name => files.has(name) ? files.get(name).ver : 0;

/* The poll's change detector. With a live socket it costs nothing; without one it asks. */
export async function signature() {
  if (!wsLive()) await sync(true);
  return "cloud " + Math.max(seq, top) + " " + files.size;
}

/* Merge and send, again on a 409 with the newer copy. build(disk) returns the text to
   write (disk is null for a new file) and may throw to stop the save. True when it
   landed, false when others kept saving first CLOUD_TRIES times. */
export async function update(name, build) {
  for (let i = 0; i < C.CLOUD_TRIES; i++) {
    const cur = files.get(name);
    let disk = null;
    if (cur) { try { disk = JSON.parse(cur.body); } catch (e) { throw new Error(name + " could not be read (" + e.message + "), so nothing was written"); } }
    const text = build(disk);
    const r = await call("PUT", "/api/file", { name, ver: cur ? cur.ver : 0, body: text }, [409]);
    if (r.status === 409) {
      cdiag.conflicts++;
      if (r.body === null || !r.ver) files.delete(name); else files.set(name, { ver: r.ver, body: r.body });
      continue;
    }
    files.set(name, { ver: r.ver, body: text });
    if (r.seq === seq + 1) { seq = r.seq; cdiag.seq = seq; }    /* nothing else changed in between: the copy is still whole */
    top = Math.max(top, r.seq);
    cdiag.writes++;
    return true;
  }
  return false;
}

export async function remove(name) {
  await call("POST", "/api/remove", { name });
  files.delete(name);
}

/* ---- live events ------------------------------------------------------------------ */
export function sendLive(ev) {
  if (wsLive()) { try { ws.send(JSON.stringify({ t: "live", ev })); return Promise.resolve(true); } catch { } }
  return call("POST", "/api/live", { ev }).then(() => true, () => false);
}

/* Events heard since the last call. Without a socket, the Worker is asked at most every
   CLOUD_LIVE_FALLBACK_MS for the last two minutes, and `seen` drops the repeats. */
export async function takeLive(sinceMs, seen) {
  if (!wsLive() && cfg && Date.now() - lastLivePoll >= C.CLOUD_LIVE_FALLBACK_MS) {
    lastLivePoll = Date.now();
    try { queue.push(...((await call("GET", "/api/live", null, [], { "X-Since": "0" })).events || [])); } catch { }
  }
  const out = queue.filter(ev => ev && Number(ev.at) >= sinceMs && !(seen && seen.has(liveFileId(ev.id))));
  queue = [];
  return out.sort((a, b) => a.at - b.at);
}

/* ---- the socket ------------------------------------------------------------------- */
function openSocket() {
  if (!cfg || stopped || ws || typeof WebSocket !== "function") return;
  let s;
  try { s = new WebSocket(cfg.url.replace(/^http/, "ws") + "/api/ws", ["awc", "c." + normCode(cfg.code)]); }
  catch { later(); return; }
  ws = s;
  cdiag.state = "connecting";
  s.onopen = () => {
    cdiag.state = "live"; retry = 0;
    clearInterval(ping);
    ping = setInterval(() => { try { s.send("ping"); } catch { } }, C.CLOUD_PING_MS);
    if (hooks.onChange) hooks.onChange();                /* anything missed while it was down */
  };
  s.onmessage = e => {
    if (e.data === "pong") return;
    let o = null;
    try { o = JSON.parse(e.data); } catch { return; }
    if (o.t === "seq") {
      top = Math.max(top, Number(o.seq) || 0);
      if (top > seq && hooks.onChange) hooks.onChange();
    } else if (o.t === "live" && o.ev) {
      queue.push(o.ev);
      if (queue.length > 200) queue.shift();
    } else if (o.t === "bye") {
      stop();
      if (hooks.onBye) hooks.onBye(o.why || "signed out by the cloud");
    }
  };
  s.onclose = () => {
    clearInterval(ping);
    if (ws === s) ws = null;
    if (!stopped) { cdiag.state = "off"; later(); }
  };
  s.onerror = () => { };
}

/* Tries again later; on the third miss in a row, checks the code still works. */
function later() {
  if (stopped) return;
  clearTimeout(retryTimer);
  const ms = C.CLOUD_RETRY_MS[Math.min(retry, C.CLOUD_RETRY_MS.length - 1)];
  if (++retry === 3) call("GET", "/api/hello").catch(() => { });
  retryTimer = setTimeout(openSocket, ms);
}

/* ---- admin -------------------------------------------------------------------------- */
export const codes = async () => (await call("GET", "/api/codes")).codes || [];
export const makeCode = (user, glass, admin, art) => call("POST", "/api/codes/new", { user, glass, admin: !!admin, art: !!art });
export const revokeCode = id => call("POST", "/api/codes/revoke", { id });
export const backups = () => call("GET", "/api/backups");
export const backup = day => call("GET", "/api/backup?day=" + encodeURIComponent(day));
export const backupNow = () => call("POST", "/api/backup/now", {});
export const restore = day => call("POST", "/api/restore", { day });
export const removedList = async () => (await call("GET", "/api/removed")).removed || [];
export const unremove = (name, at) => call("POST", "/api/unremove", { name, at });

/* Sends files ({ name, body }) in chunks of IMPORT_CHUNK or about 4 MB. */
export async function importFiles(list, progress) {
  const out = { written: 0, skipped: [] };
  let chunk = [], size = 0;
  const send = async () => {
    if (!chunk.length) return;
    const r = await call("POST", "/api/import", { files: chunk });
    out.written += r.written || 0;
    out.skipped.push(...(r.skipped || []));
    chunk = []; size = 0;
    if (progress) progress(out.written);
  };
  for (const f of list) {
    if (chunk.length >= C.IMPORT_CHUNK || size + f.body.length > 4000000) await send();
    chunk.push(f); size += f.body.length;
  }
  await send();
  return out;
}

/* Every file now, as a backup bundle (the same shape a download of a backup has). */
export async function bundleNow() {
  const r = await call("GET", "/api/state", null, [], { "X-Since": "0" });
  return { format: C.BUNDLE_FORMAT, rev: C.REV, day: "now", taken: new Date().toISOString(), files: (r.files || []).map(f => ({ name: f.name, body: f.body })) };
}

/* ---- a folder-like handle for the Pet Studio --------------------------------------- */
/* Holds _settings.json (so the studio takes it for a data folder) and _pets.json, which
   is read from the Worker on every getFile and written with the version last read, so a
   save on top of someone else's is refused (409) and the studio's next check takes theirs
   in. Lock files stay in memory: the version check does their job. */
export class CloudDir {
  constructor(c) { this.kind = "directory"; this.name = "cloud"; this.c = { url: cleanUrl(c.url), code: normCode(c.code) }; this.vers = new Map(); this.mem = new Map(); }
  async queryPermission() { return "granted"; }
  async requestPermission() { return "granted"; }
  async getFileHandle(n, o = {}) {
    const d = this;
    if (n !== C.FOLDER_PETS_FILE && n !== C.SETTINGS_FILE && !n.endsWith(".lock")) throw new DOMException(n, "NotFoundError");
    if (n.endsWith(".lock") && !d.mem.has(n) && !o.create) throw new DOMException(n, "NotFoundError");
    if (n.endsWith(".lock") && !d.mem.has(n)) d.mem.set(n, { text: "", at: Date.now() });
    return {
      kind: "file", name: n,
      async getFile() {
        if (n === C.SETTINGS_FILE) return new File(["{}"], n, { lastModified: 1 });
        if (n.endsWith(".lock")) { const m = d.mem.get(n); if (!m) throw new DOMException(n, "NotFoundError"); return new File([m.text], n, { lastModified: m.at }); }
        const r = await request(d.c, "GET", "/api/file?name=" + encodeURIComponent(n));
        d.vers.set(n, r.ver || 0);
        if (!r.ver && !o.create) throw new DOMException(n, "NotFoundError");
        return new File([r.body || ""], n, { lastModified: r.ver || 0 });
      },
      async createWritable() {
        const parts = [];
        return {
          async write(x) { parts.push(typeof x === "string" ? x : await new Blob([x]).text()); },
          async close() {
            const text = parts.join("");
            if (n.endsWith(".lock")) { d.mem.set(n, { text, at: Date.now() }); return; }
            if (n === C.SETTINGS_FILE) return;
            const r = await request(d.c, "PUT", "/api/file", { name: n, ver: d.vers.get(n) || 0, body: text }, [409]);
            if (r.status === 409) { d.vers.set(n, r.ver || 0); throw new Error("someone else saved the pet art a moment ago; their drawings are being taken in, then Save again"); }
            d.vers.set(n, r.ver);
          }
        };
      }
    };
  }
  async removeEntry(n) {
    if (!n.endsWith(".lock")) throw new DOMException(n, "NotAllowedError");
    if (!this.mem.delete(n)) throw new DOMException(n, "NotFoundError");
  }
}
