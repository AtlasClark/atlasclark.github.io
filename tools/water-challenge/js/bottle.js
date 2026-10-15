/* Bottle sync: HidrateSpark sips into your glass, as the R55 HTA did, for
   BOTTLE_USER only. The browser can't call Hidrate itself (its API wants a header
   browsers may not send), so requests go through your Cloudflare Worker relay
   (bottle/hidrate-worker.js), which holds Hidrate's app keys. This browser keeps the
   relay address, the relay key and the Hidrate session token in IndexedDB; the
   password is used once to sign in and never kept. Sync runs only on Sync now. */

import * as C from "./config.js";
import * as store from "./store.js";
import { S } from "./model.js";
import { localStamp, dateKey } from "./util.js";

const ML_PER_FL_OZ = 29.5735;
const RELAY_RE = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.workers\.dev\/?$/i;

let cfg = {};
export const bottleOn = () => String(S.me || "").toLowerCase() === C.BOTTLE_USER;
export const bottleCfg = () => cfg;
export const signedIn = () => !!cfg.token;

export async function loadBottle() {
  try { cfg = (await store.kvGet("bottle")) || {}; } catch { cfg = {}; }
  return cfg;
}
async function saveCfg() { try { await store.kvSet("bottle", cfg); } catch { } }

/* A long random relay key to paste into the Worker's RELAY_KEY secret. */
export function newRelayKey() {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
}

export async function setRelay(relay, key) {
  relay = String(relay || "").trim();
  if (relay && !RELAY_RE.test(relay)) throw new Error("the relay address must look like https://name.you.workers.dev");
  cfg.relay = relay.replace(/\/$/, "");
  cfg.key = String(key || "").trim();
  await saveCfg();
}

async function call(path, opts = {}) {
  if (!cfg.relay) throw new Error("set the relay address first");
  const headers = { "X-Relay-Key": cfg.key || "" };
  if (opts.token) headers["X-Parse-Session-Token"] = opts.token;
  if (opts.body) { headers["Content-Type"] = "application/json"; headers["X-Parse-Revocable-Session"] = "1"; }
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), C.BOTTLE_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(cfg.relay + path, { method: opts.body ? "POST" : "GET", headers, cache: "no-store", signal: ctl.signal,
                                          body: opts.body ? JSON.stringify(opts.body) : undefined });
  } catch (e) {
    throw new Error(e.name === "AbortError" ? "the relay did not answer in time" : "could not reach the relay");
  } finally { clearTimeout(timer); }
  let data = null;
  try { data = await res.json(); } catch { }
  if (!res.ok) {
    const err = new Error((data && data.error) || "HTTP " + res.status);
    err.code = data && data.code; err.status = res.status;
    throw err;
  }
  return data;
}

/* { ok, configured, keyOk } from the relay. */
export const pingRelay = () => call("/ping");

export async function signIn(email, password) {
  const d = await call("/parse/login", { body: { username: String(email).trim(), password: String(password) } });
  if (!d || !d.sessionToken) throw new Error("Hidrate sent no session");
  cfg.token = d.sessionToken; cfg.email = String(email).trim();
  await saveCfg();
}

export async function signOut() { delete cfg.token; await saveCfg(); }

/* Today's sips, newest first. An expired session clears itself. */
export async function fetchSips(now = new Date()) {
  if (!cfg.token) throw new Error("sign in to Hidrate first");
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const where = JSON.stringify({ time: { $gte: { __type: "Date", iso: start.toISOString() }, $lte: { __type: "Date", iso: now.toISOString() } } });
  try {
    const d = await call("/parse/classes/Sip?limit=" + C.BOTTLE_SIP_LIMIT + "&order=-time&where=" + encodeURIComponent(where), { token: cfg.token });
    return (d && d.results) || [];
  } catch (e) {
    if (e.code === 209) { await signOut(); throw new Error("the Hidrate session ended: sign in again"); }
    throw e;
  }
}

/* The R55 rules. Sips are grouped into BOTTLE_BUCKET_MIN-minute buckets (one entry
   each, eid "h:<id>", sid "<id>", by HIDRATE_TAG). A bucket only ever grows: a reply
   with fewer sips never takes water away. Bottle rows from before sids existed are
   replaced. Changes p.entries; returns { added, grown, removed: [eid], oz }. */
export function applySips(p, sips, key, bucketMin = C.BOTTLE_BUCKET_MIN) {
  const pad = n => String(n).padStart(2, "0"), incoming = new Map();
  for (const s of sips || []) {
    const iso = s && s.time && s.time.iso, t = iso ? new Date(iso) : null;
    if (!t || isNaN(t) || dateKey(t) !== key) continue;
    let id, at;
    if (bucketMin > 0) {
      const mins = Math.floor((t.getHours() * 60 + t.getMinutes()) / bucketMin) * bucketMin;
      id = "hid:" + key + ":" + pad(Math.floor(mins / 60)) + pad(mins % 60);
      at = new Date(t); at.setHours(Math.floor(mins / 60), mins % 60, 0, 0);
    } else { id = "sip:" + (s.objectId || localStamp(t) + ":" + Number(s.amount)); at = t; }
    const b = incoming.get(id) || { oz: 0, at };
    b.oz += Number(s.amount || 0) / ML_PER_FL_OZ;
    incoming.set(id, b);
  }
  const out = { added: 0, grown: 0, removed: [], oz: 0 };
  if (!incoming.size) return out;
  p.entries = p.entries.filter(e => {
    if (e.date === key && e.by === C.HIDRATE_TAG && !e.sid) { out.removed.push(e.eid); return false; }
    return true;
  });
  const have = new Map(p.entries.filter(e => e.date === key && e.by === C.HIDRATE_TAG && e.sid).map(e => [e.sid, e]));
  for (const [id, b] of incoming) {
    const oz = Math.round(b.oz * 10) / 10, e = have.get(id);
    if (oz <= 0) continue;
    if (e) { if (oz > e.oz) { out.oz += oz - e.oz; e.oz = oz; out.grown++; } }
    else { p.entries.push({ eid: "h:" + id, ts: localStamp(b.at), date: key, oz, by: C.HIDRATE_TAG, sid: id }); out.oz += oz; out.added++; }
  }
  out.oz = Math.round(out.oz * 10) / 10;
  return out;
}
