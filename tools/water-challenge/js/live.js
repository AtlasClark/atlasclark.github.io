/* Live events between open pages. There is no server: the share is the only thing
   every browser has in common, so an event is a small file in _live/ and every open
   page lists that folder once a second (LIVE_POLL_MS) while it is visible. Others see
   an event about a second after it happens; an event older than LIVE_SHOW_MS is
   handed over as "late" so its handler can skip the animation.
   Types: "drop" (Plinko), "pour" (someone logged water), "unlock" (an unlock card). */

import * as C from "./config.js";
import * as store from "./store.js";

const handlers = {};
const seen = new Set();         /* liveFileId()s already handled, ours included */
let since = 0, timer = 0;

export function onLive(type, fn) { handlers[type] = fn; }

/* An event may come from a remote player (js/relay.js) and ends up in the page, so it
   is rebuilt from known fields with their types: no markup in a colour or a number. */
const NUMS = ["at", "oz", "bin", "slot", "kind", "hue", "pot", "was", "rolled", "tier"];
const BOOLS = ["fresh", "revived", "empty", "homunculus", "equipped", "bought"];
const TEXT = ["type", "id", "name", "label", "title"];
export function cleanEvent(ev, depth = 0) {
  const out = {};
  if (!ev || typeof ev !== "object") return out;
  for (const k of TEXT) if (k in ev) out[k] = String(ev[k] === null || ev[k] === undefined ? "" : ev[k]).slice(0, 120);
  for (const k of NUMS) if (k in ev) { const n = Number(ev[k]); out[k] = isFinite(n) ? n : 0; }
  for (const k of BOOLS) if (k in ev) out[k] = !!ev[k];
  if ("color" in ev) out.color = store.safeColor(ev.color, "#60a5fa");
  if (Array.isArray(ev.path)) out.path = ev.path.slice(0, 40).map(v => (Number(v) ? 1 : 0));
  if (ev.chest && typeof ev.chest === "object") out.chest = { add: Number(ev.chest.add) || 0, won: Number(ev.chest.won) || 0 };
  if (ev.info && typeof ev.info === "object" && depth < 1) out.info = cleanEvent(ev.info, depth + 1);
  return out;
}

export function emit(type, payload) {
  const ev = Object.assign({ type, at: Date.now() }, payload);
  if (!ev.id) ev.id = "l" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  seen.add(store.liveFileId(ev.id));
  store.writeLive(ev);
  return ev;
}

async function tick() {
  if (document.hidden || !store.dir) return;
  const evs = (await store.readLive(since, seen)).map(e => cleanEvent(e));
  for (const ev of evs) {
    seen.add(store.liveFileId(ev.id));
    since = Math.max(since, ev.at - C.LIVE_SHOW_MS);
    const fn = handlers[ev.type || "drop"];
    if (fn) { try { fn(ev, Date.now() - ev.at); } catch { } }
  }
}

export function startLive() {
  if (timer) return;
  since = Date.now() - C.LIVE_KEEP_MS;      /* the shop feed picks up the last couple of minutes */
  tick();
  timer = setInterval(tick, C.LIVE_POLL_MS);
}
