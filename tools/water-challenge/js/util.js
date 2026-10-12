/* Small shared helpers: dates, formatting, escaping, the message bus. */

export const $ = id => document.getElementById(id);

export function pad2(n) { return (n < 10 ? "0" : "") + n; }

export function dateKey(d) {
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}
export function todayKey() { return dateKey(new Date()); }

export function parseKey(k) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(k || ""));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

export function shiftKey(key, days) {
  const d = parseKey(key);
  if (!d) return key;
  d.setDate(d.getDate() + days);
  return dateKey(d);
}

/* Whole days from key a to key b. */
export function keyDaysBetween(a, b) {
  const x = parseKey(a), y = parseKey(b);
  if (!x || !y) return 0;
  return Math.round((y.getTime() - x.getTime()) / 86400000);
}

export function daysBetween(a, b) { return Math.floor((b.getTime() - a.getTime()) / 86400000); }

export function localStamp(d) {
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) +
         "T" + pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
}

export function clockStamp() {
  const n = new Date();
  return pad2(n.getHours()) + ":" + pad2(n.getMinutes()) + ":" + pad2(n.getSeconds());
}

export function prettyTime(ts) {
  const t = String(ts).split("T")[1];
  if (!t) return "";
  let hh = Number(t.substring(0, 2));
  const mm = t.substring(3, 5), ap = hh >= 12 ? "PM" : "AM";
  hh = hh % 12; if (hh === 0) hh = 12;
  return hh + ":" + mm + " " + ap;
}

export function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
                  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
export function trim(s) { return String(s).replace(/^\s+|\s+$/g, ""); }
export function fmt(n) { n = Number(n); return (n % 1 === 0) ? String(n) : n.toFixed(1); }
export function fmtOz(v) { return Math.round(Number(v)).toLocaleString("en-US"); }
export function fmtGal(v) { return String(Math.round(Number(v) / 128 * 10) / 10); }
export function rnd(lo, hi) { return lo + Math.random() * (hi - lo); }
export function hsl(h, s, l) { return "hsl(" + h + "," + s + "%," + l + "%)"; }
export const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, String(k));

/* Status line + other UI hooks. app.js wires the real handlers; model and pet code
   only ever talk through this, so they stay free of DOM. */
export const bus = {
  msg(text, good) { /* replaced at boot */ },
  drown(name, kind, hue) { /* replaced at boot */ },
  petReset(name) { /* replaced at boot */ }
};
