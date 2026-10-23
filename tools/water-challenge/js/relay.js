/* Remote player relay, for a player with no access to the share
   (relay/water-relay-worker.js on Cloudflare). Two roles:

   Remote page: opened from an invite link. It runs on an in-memory copy of the data
   folder (RelayDir) that the Worker fills, so the rest of the page works as usual.
   The player's own saves and live events go to the Worker; until an office page has
   written a save to the share, it is merged onto every fresh copy of their file.

   Bridge: any page on the share. One at a time holds the lease in _relay/ (a visible
   page takes over from a hidden one). It sends the share's .json files and live
   events up, and writes the remote player's saves down through saveParticipant, so
   locks and merging work as between two office PCs. The relay address and bridge
   key are in _relay/relay.json on the share.

   Sign-in names stay in the office: before a file goes up, every "who logged it"
   name becomes that person's glass name (each office page records its own pair in
   _relay/names.json) or "office", and the real names are put back when a remote
   save is written to the share. */

import * as C from "./config.js";
import * as store from "./store.js";
import { S } from "./model.js";

const RELAY_RE = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.workers\.dev\/?$/i;
const same = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
const enc = new TextEncoder();
const newId = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/* ---- an in-memory data folder ----------------------------------------------- */
let stamp = 0;                                   /* every write gets its own mtime */
const tick = () => (stamp = Math.max(Date.now(), stamp + 1));
class RelayFile {
  constructor(d, n) { this.kind = "file"; this.name = n; this._d = d; }
  async getFile() {
    const r = this._d._f.get(this.name);
    if (!r) throw new DOMException(this.name, "NotFoundError");
    return new File([r.bytes], this.name, { lastModified: r.mtime });
  }
  async createWritable() {
    const parts = [], d = this._d, n = this.name;
    return {
      async write(x) { parts.push(x instanceof Uint8Array ? x : typeof x === "string" ? enc.encode(x) : new Uint8Array(await new Blob([x]).arrayBuffer())); },
      async close() {
        const out = new Uint8Array(parts.reduce((a, b) => a + b.length, 0));
        let o = 0;
        for (const p of parts) { out.set(p, o); o += p.length; }
        d._f.set(n, { bytes: out, mtime: tick() });
      }
    };
  }
}
export class RelayDir {
  constructor(name) { this.kind = "directory"; this.name = name; this._f = new Map(); this._d = new Map(); }
  async *entries() {
    for (const n of [...this._f.keys()]) yield [n, new RelayFile(this, n)];
    for (const [n, d] of this._d) yield [n, d];
  }
  async getFileHandle(n, o = {}) {
    if (!this._f.has(n)) {
      if (!o.create) throw new DOMException(n, "NotFoundError");
      this._f.set(n, { bytes: new Uint8Array(0), mtime: tick() });
    }
    return new RelayFile(this, n);
  }
  async getDirectoryHandle(n, o = {}) {
    if (!this._d.has(n)) { if (!o.create) throw new DOMException(n, "NotFoundError"); this._d.set(n, new RelayDir(n)); }
    return this._d.get(n);
  }
  async removeEntry(n) { if (!this._f.delete(n) && !this._d.delete(n)) throw new DOMException(n, "NotFoundError"); }
  put(n, text) { this._f.set(n, { bytes: enc.encode(text), mtime: tick() }); }
  text(n) { const r = this._f.get(n); return r ? store.decodeBytes(r.bytes) : null; }
}

async function call(url, method, path, headers, body) {
  const r = await fetch(url + path, { method, cache: "no-store", headers: Object.assign(body ? { "Content-Type": "application/json" } : {}, headers),
                                      body: body ? JSON.stringify(body) : undefined });
  let j = null;
  try { j = await r.json(); } catch { }
  if (!r.ok) throw new Error((j && j.error) || "the relay answered " + r.status);
  return j;
}

/* A remote player's key: HMAC-SHA256 of their name under the bridge key (the Worker
   makes the same). */
export async function playerKey(secret, name) {
  const k = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode("player:" + String(name).trim().toLowerCase()));
  return Array.from(new Uint8Array(sig), b => b.toString(16).padStart(2, "0")).join("").slice(0, 40);
}

const b64u = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = s => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))));

/* The link a remote player opens. The key rides after #, which no server sees. */
export async function inviteLink(cfg, name) {
  const base = location.origin + location.pathname.replace(/index\.html$/, "");
  return base + "#join=" + b64u(JSON.stringify({ u: cfg.url, n: name, k: await playerKey(cfg.key, name) }));
}

/* ==== remote page ============================================================ */
let R = null;
export const remoteOn = () => !!R;

/* An invite in the address is saved, then taken out of the address. */
export async function loadRemote() {
  const m = /[#&]join=([A-Za-z0-9_-]+)/.exec(location.hash);
  if (m) {
    try {
      const o = JSON.parse(unb64u(m[1]));
      if (RELAY_RE.test(o.u) && o.n && /^[0-9a-f]{40}$/.test(o.k)) {
        await store.kvSet("remote", { url: o.u.replace(/\/$/, ""), name: String(o.n), key: o.k });
        await store.kvDel("remote-outbox");
      }
    } catch (e) { store.diagNote("invite link unreadable: " + (e.message || e)); }
    history.replaceState(null, "", location.pathname + location.search);
  }
  try { return (await store.kvGet("remote")) || null; } catch { return null; }
}
export async function leaveRemote() {
  await store.kvDel("remote");
  await store.kvDel("remote-outbox");
}

/* Fills an in-memory folder from the relay and returns it; throws when the relay
   can't be reached. onChange runs whenever the copy changed. */
export async function startRemote(cfg, onChange, manual = false) {
  R = { manual, cfg, dir: new RelayDir("relay"), base: new Map(), ver: 0, liveSince: Date.now() - C.LIVE_KEEP_MS,
        outbox: [], sent: [], onChange, timer: 0, lastOk: 0, bridgeSeen: 0, err: "", seen: new Set() };
  try {                                          /* sent ones are dropped by the first pull once the office wrote them */
    const kept = (await store.kvGet("remote-outbox")) || {};
    R.outbox = Array.isArray(kept.outbox) ? kept.outbox : [];
    R.sent = Array.isArray(kept.sent) ? kept.sent : [];
  } catch { R.outbox = []; R.sent = []; }
  await pull();
  if (!R.base.has(store.participantFileName(cfg.name))) throw new Error(cfg.name + " is not on the challenge's roster.");
  store.setRelay({ owns: n => same(n, cfg.name), save: queueSave, live: sendLive });
  schedule();
  return R.dir;
}

export function remoteStatus() {
  return R ? { name: R.cfg.name, waiting: R.outbox.length + R.sent.length, err: R.err, lastOk: R.lastOk, bridgeSeen: R.bridgeSeen } : null;
}
export function remoteNow() { if (R && !R.manual) { clearTimeout(R.timer); R.timer = setTimeout(remoteTick, 0); } }

function schedule() { clearTimeout(R.timer); if (!R.manual) R.timer = setTimeout(remoteTick, document.hidden ? C.REMOTE_HIDDEN_MS : C.REMOTE_POLL_MS); }
async function remoteTick() {
  try { if (await pull()) R.onChange(); R.err = ""; }
  catch (e) { R.err = e.message || String(e); store.diagNote("relay: " + R.err); }
  schedule();
}

const keep = () => store.kvSet("remote-outbox", { outbox: R.outbox, sent: R.sent }).catch(() => { });
const auth = () => ({ "X-Player": encodeURIComponent(R.cfg.name), "X-Player-Key": R.cfg.key });

/* Called by saveParticipant after it wrote this player's file in the copy. */
function queueSave(text, args) {
  R.outbox.push({ id: newId("o"), rec: text, args });
  keep();
  remoteNow();
}
function sendLive(ev) {
  call(R.cfg.url, "POST", "/live", auth(), ev).catch(e => store.diagNote("relay live: " + (e.message || e)));
}

async function flush() {
  while (R.outbox.length) {
    const op = R.outbox[0];
    await call(R.cfg.url, "POST", "/save", auth(), { id: op.id, rec: op.rec, args: op.args });
    R.outbox.shift();
    R.sent.push(op);
    keep();
  }
}

/* Saves sent first, then the copy brought up to date. True when it changed. */
async function pull() {
  let flushErr = null;
  try { await flush(); } catch (e) { flushErr = e; }
  const res = await call(R.cfg.url, "GET", "/state?since=" + R.ver + "&liveSince=" + R.liveSince, auth());
  if (Number(res.ver) < R.ver) { R.ver = 0; return pull(); }      /* the relay was emptied: start over */
  let changed = false;
  await store.serial(async () => {
    const files = Object.entries(res.files || {});
    for (const [n, t] of files) {
      if (t === null) { R.base.delete(n); R.dir._f.delete(n); } else R.base.set(n, t);
    }
    const pend = new Set(res.pending || []), was = R.sent.length;
    R.sent = R.sent.filter(o => pend.has(o.id));
    if (was !== R.sent.length) keep();
    const own = store.participantFileName(R.cfg.name);
    for (const [n, t] of files) {
      if (t === null) { changed = true; continue; }
      if (n === own) continue;
      R.dir.put(n, t);
      changed = true;
    }
    /* this player's file: the relay's copy with every save the office has not written yet */
    if (R.base.has(own) && (files.some(([n]) => n === own) || was !== R.sent.length)) {
      let t = R.base.get(own);
      for (const op of [...R.sent, ...R.outbox]) { try { t = store.mergeText(t, op.rec, op.args); } catch { } }
      if (t !== R.dir.text(own)) { R.dir.put(own, t); changed = true; }
    }
    if ((res.live || []).length) {
      const d = await R.dir.getDirectoryHandle(C.LIVE_SUBDIR, { create: true });
      for (const ev of res.live) {
        R.liveSince = Math.max(R.liveSince, Number(ev.at) || 0);
        if (R.seen.has(ev.id)) continue;
        R.seen.add(ev.id);
        d.put("ev-" + ev.at + "-" + store.liveFileId(ev.id) + ".json", JSON.stringify(ev));
      }
      for (const [n] of d._f) { const m = /^ev-(\d+)-/.exec(n); if (m && Date.now() - Number(m[1]) > C.LIVE_KEEP_MS) d._f.delete(n); }
    }
  });
  R.ver = Number(res.ver) || 0;
  R.bridgeSeen = Number(res.bridgeSeen) || 0;
  R.lastOk = Date.now();
  if (flushErr) throw flushErr;
  return changed;
}

/* ==== bridge ================================================================= */
let B = null;

export async function readBridgeCfg() {
  const t = await store.readSubText(C.RELAY_SUBDIR, C.RELAY_FILE);
  try { const o = JSON.parse(t); return o && RELAY_RE.test(o.url) && o.key ? { url: o.url.replace(/\/$/, ""), key: String(o.key) } : null; }
  catch { return null; }
}
export async function saveBridgeCfg(url, key) {
  url = String(url || "").trim().replace(/\/$/, "");
  key = String(key || "").trim();
  if (!RELAY_RE.test(url)) throw new Error("the relay address must look like https://name.you.workers.dev");
  if (key.length < 24) throw new Error("the bridge key is too short: use New key");
  await store.writeSubText(C.RELAY_SUBDIR, C.RELAY_FILE, JSON.stringify({ url, key, by: S.me || "", at: new Date().toISOString() }, null, 1));
  if (B) { B.sigs.clear(); B.reset = true; bridgeSoon(); }
}
export async function pingRelay(url, key) {
  return call(String(url).trim().replace(/\/$/, ""), "GET", "/ping", { "X-Relay-Key": String(key || "").trim() });
}

export function bridgeStatus() {
  return B ? { state: B.state, holder: B.holder, playerSeen: B.playerSeen, lastOk: B.lastOk, err: B.err } : { state: "off" };
}

/* Starts the bridge loop on an office page; onApplied runs after a remote save landed.
   auto false: no timer (tests run rounds themselves). */
export function startBridge(onApplied, auto = true) {
  if (B) return;
  B = { id: newId("b"), sigs: new Map(), ver: 0, reset: true, applied: [], liveSince: Date.now() - C.LIVE_KEEP_MS,
        wrote: new Set(), seen: new Set(), timer: 0, state: "off", holder: "", playerSeen: 0, lastOk: 0, err: "", onApplied };
  if (auto) B.timer = setTimeout(bridgeLoop, 1500);
}
function bridgeSoon() { if (B) { clearTimeout(B.timer); B.timer = setTimeout(bridgeLoop, 200); } }

async function bridgeLoop() {
  let wait = C.BRIDGE_IDLE_MS;
  try { wait = await bridgeTick(); B.err = ""; }
  catch (e) { B.err = e.message || String(e); store.diagNote("bridge: " + B.err); }
  B.timer = setTimeout(bridgeLoop, wait);
}

/* One lease holder at a time; a visible page takes over from a hidden one. */
async function holdLease() {
  const now = Date.now();
  let l = null;
  try { l = JSON.parse(await store.readSubText(C.RELAY_SUBDIR, C.LEASE_FILE)); } catch { l = null; }
  if (l && l.by !== B.id && l.until > now && !(l.hidden && !document.hidden)) { B.holder = l.who || "another page"; return false; }
  await store.writeSubText(C.RELAY_SUBDIR, C.LEASE_FILE, JSON.stringify({ by: B.id, who: S.me || "", until: now + C.BRIDGE_LEASE_MS, hidden: document.hidden }));
  try { l = JSON.parse(await store.readSubText(C.RELAY_SUBDIR, C.LEASE_FILE)); } catch { l = null; }
  B.holder = l && l.by === B.id ? "" : (l && l.who) || "another page";
  return !!l && l.by === B.id;
}

/* Returns how long to wait before the next round. */
async function bridgeTick() {
  if (!store.dir || store.relay) { B.state = "off"; return C.BRIDGE_IDLE_MS; }
  const cfg = await readBridgeCfg();
  if (!cfg) { B.state = "off"; return C.BRIDGE_IDLE_MS; }
  await notePair();
  if (!(await holdLease())) { B.state = "other"; B.sigs.clear(); B.reset = true; return C.BRIDGE_IDLE_MS; }
  B.state = "this";
  const names = await readNames();

  /* the share's files that changed since the last round, a chunk at a time */
  const list = await store.rootJsonFiles(), files = {}, sent = new Map();
  let size = 0, more = false;
  for (const f of list) {
    if (B.sigs.get(f.name) === f.sig) continue;
    if (size > C.BRIDGE_CHUNK) { more = true; continue; }
    const t = masked(await store.fileText(f.file), names);
    files[f.name] = t; size += t.length; sent.set(f.name, f.sig);
  }
  for (const n of B.sigs.keys()) if (!list.some(f => f.name === n)) { files[n] = null; sent.set(n, null); }

  /* office live events, not the ones this bridge wrote for the player */
  const evs = (await store.readLive(Date.now() - C.LIVE_KEEP_MS, B.seen)).filter(e => !B.wrote.has(e.id));
  for (const e of evs) B.seen.add(store.liveFileId(e.id));

  const res = await call(cfg.url, "POST", "/bridge", { "X-Relay-Key": cfg.key },
                         { ack: B.applied, files, reset: B.reset, live: evs, liveSince: B.liveSince });
  B.applied = []; B.reset = false;
  for (const [n, s] of sent) { if (s === null) B.sigs.delete(n); else B.sigs.set(n, s); }
  if (Number(res.ver) < B.ver) { B.sigs.clear(); B.reset = true; more = true; }   /* the relay lost its copy */
  B.ver = Number(res.ver) || 0;
  B.playerSeen = Number(res.playerSeen) || 0;
  B.lastOk = Date.now();
  if (B.wrote.size > 3000) B.wrote.clear();

  for (const ev of res.live || []) {
    B.liveSince = Math.max(B.liveSince, Number(ev.at) || 0);
    if (B.wrote.has(ev.id)) continue;
    B.wrote.add(ev.id);
    await store.writeLive(ev);
  }
  let landed = 0;
  for (const op of res.ops || []) {
    const r = await applyOp(op);
    if (r !== "retry") B.applied.push(op.id);
    if (r === "ok") landed++;
  }
  if (landed) B.onApplied();
  if (B.applied.length || more) return 300;
  return Date.now() - B.playerSeen < C.PLAYER_ACTIVE_MS ? C.BRIDGE_FAST_MS : C.BRIDGE_IDLE_MS;
}

/* ---- sign-in names --------------------------------------------------------- */
/* This page's sign-in name and glass, added to _relay/names.json once a session. */
async function notePair() {
  if (B.paired || !S.me || !S.mine || !S.participants.some(p => same(p.name, S.mine))) return;
  const m = await readNames(), k = S.me.trim().toLowerCase();
  if (m[k] !== S.mine) {
    m[k] = S.mine;
    await store.writeSubText(C.RELAY_SUBDIR, C.NAMES_FILE, JSON.stringify(m, null, 1));
  }
  B.paired = true;
}
async function readNames() {
  try { const o = JSON.parse(await store.readSubText(C.RELAY_SUBDIR, C.NAMES_FILE)); return o && typeof o === "object" ? o : {}; }
  catch { return {}; }
}
/* A sign-in name as the relay may see it: a glass name, the bottle tag, or "office". */
export function shownName(user, names) {
  const u = String(user || "").trim();
  if (!u || u === C.HIDRATE_TAG) return u;
  const k = u.toLowerCase();
  if (names[k]) return names[k];
  const p = S.participants.find(x => same(x.name, u));
  return p ? p.name : "office";
}
/* A file's text with every sign-in name replaced (participants and settings). */
export function masked(text, names) {
  let o;
  try { o = JSON.parse(text); } catch { return text; }
  if (!o || typeof o !== "object") return text;
  /* ids first, from the real names, as loadAll would make them: an id made after the
     swap would differ and the pour would come back as a second one */
  if (Array.isArray(o.entries)) {
    const seen = {};
    for (const e of o.entries) { if (e && !e.eid) e.eid = store.deriveEid(e, seen); if (e) seen[e.eid] = true; }
  }
  for (const list of [o.entries, o.spends]) if (Array.isArray(list)) for (const x of list) if (x && x.by !== undefined) x.by = shownName(x.by, names);
  for (const f of ["writerUser", "updatedBy", "by"]) if (typeof o[f] === "string") o[f] = shownName(o[f], names);
  return JSON.stringify(o);
}

/* A remote save, written to the share the way the player's own page would have:
   "ok", "retry" (the file was busy) or "drop" (not a save this bridge can write). */
export async function applyOp(op) {
  const a = (op.body && op.body.args) || {};
  let rec = null;
  try { rec = JSON.parse(op.body.rec); } catch { rec = null; }
  if (!rec || !same(rec.name, op.player)) { store.diagNote("bridge: dropped a save that is not " + op.player + "'s"); return "drop"; }
  const p = S.participants.find(x => same(x.name, rec.name));
  if (!p) { store.diagNote("bridge: dropped a save for " + rec.name + ", who is not on the roster"); return "drop"; }
  rec.name = p.name;
  store.cleanRecord(rec, p.color);
  /* the share's own "who logged it" for anything it already has; the player's new ones are theirs */
  const byE = new Map(p.entries.map(e => [e.eid, e.by])), byS = new Map((p.spends || []).map(s => [s.id, s.by]));
  for (const e of rec.entries) e.by = byE.has(e.eid) ? byE.get(e.eid) : p.name;
  for (const s of rec.spends) s.by = byS.has(s.id) ? byS.get(s.id) : p.name;
  const ok = await store.serial(() => store.saveParticipant(rec, a.removedIds, a.removedPets, a.revivedPets, a.clearRoll));
  if (ok) store.diagNote("bridge: wrote a save from " + p.name);
  return ok ? "ok" : "retry";
}

/* Test hooks: one round of each side, run by hand. */
export const relayTest = { pull: () => pull(), bridgeRound: () => bridgeTick(), flush: () => flush() };
