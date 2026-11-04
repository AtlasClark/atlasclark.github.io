/* Glass messages (rev 1.38.7). One short message per person, p.msg = { id, text, at }
   (at = ms). A newer one replaces the older on every merge; taking it down writes an
   empty, newer one. Others see "!" over the pet until they open it, then a dim bubble.
   Only your own glass's message can be written (the cloud Worker checks this too).
   What this browser has read is kept here only (localStorage). */

import * as C from "./config.js";
import { S } from "./model.js";

const READ_KEY = "awc-msg-read";

/* One line, no < or > (the cloud refuses them), at most MSG_MAX. */
export const cleanText = s => String(s || "").replace(/[<>]/g, "").replace(/[\u0000-\u001f\u007f]+/g, " ").slice(0, C.MSG_MAX);

/* A well-formed message (empty text = taken down), or null. */
function valid(m) {
  return m && typeof m === "object" && typeof m.id === "string" && typeof m.text === "string" && isFinite(Number(m.at)) ? m : null;
}

/* The newer of two messages; a tie keeps a. */
export function newerMsg(a, b) {
  a = valid(a); b = valid(b);
  if (!a) return b || undefined;
  if (!b) return a;
  return Number(b.at) > Number(a.at) ? b : a;
}

/* What a glass shows: a message with text, cleaned, or null. */
export function msgOf(p) {
  const m = valid(p && p.msg), text = m ? cleanText(m.text).trim() : "";
  return text ? { id: m.id, text, at: Number(m.at) } : null;
}

export const makeMsg = text => ({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8), text: cleanText(text).trim(), at: Date.now() });

/* ---- read state, this browser only ---------------------------------------------- */
let read = null;
function readMap() {
  if (!read) { try { read = JSON.parse(localStorage.getItem(READ_KEY) || "{}") || {}; } catch { read = {}; } }
  return read;
}
export function isNew(p) {
  const m = msgOf(p);
  return !!m && p.name !== S.mine && readMap()[p.name] !== m.id;
}
export function markRead(p) {
  const m = msgOf(p);
  if (!m) return;
  readMap()[p.name] = m.id;
  try { localStorage.setItem(READ_KEY, JSON.stringify(read)); } catch { }
}

/* Open bubbles, by name: shown until clicked again. */
export const openMsgs = new Set();
export function toggleMsg(p) {
  if (openMsgs.has(p.name)) openMsgs.delete(p.name);
  else { openMsgs.add(p.name); markRead(p); }
}

/* "2:15 PM" today, "Mon 2:15 PM" this week, "Oct 30 2:15 PM" before that. */
export function whenText(at) {
  const d = new Date(Number(at)), now = new Date();
  if (!isFinite(d)) return "";
  const t = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return t;
  return d.toLocaleDateString([], now - d < 6 * 864e5 ? { weekday: "short" } : { month: "short", day: "numeric" }) + " " + t;
}
