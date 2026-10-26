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

export function emit(type, payload) {
  const ev = Object.assign({ type, at: Date.now() }, payload);
  if (!ev.id) ev.id = "l" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  seen.add(store.liveFileId(ev.id));
  store.writeLive(ev);
  return ev;
}

async function tick() {
  if (document.hidden || !store.dir) return;
  const evs = await store.readLive(since, seen);
  for (const ev of evs) {
    seen.add(store.liveFileId(ev.id));
    since = Date.now() - C.LIVE_KEEP_MS;              /* this PC's clock; seen stops repeats */
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
