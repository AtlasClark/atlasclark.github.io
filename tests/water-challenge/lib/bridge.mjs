/* Test bridge: the web modules with an in-memory folder handle on a copy of the
   data, and a clock that can be set to any day.

   Input (gitignored, local only):
     AWC_DATA  default AtlasWaterTracker/data                                    */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const DATA_DIR = process.env.AWC_DATA || path.join(ROOT, "AtlasWaterTracker/data");
export const available = fs.existsSync(DATA_DIR);
export const skipReason = available ? false : "data folder not found (set AWC_DATA)";

/* ---- clock -------------------------------------------------------------- */
const RealDate = Date;
let offset = 0;
class TestDate extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + offset); }
  static now() { return RealDate.now() + offset; }
}
globalThis.Date = TestDate;

/* The clock reads noon on the given day. */
export function setToday(key) {
  const [y, m, d] = key.split("-").map(Number);
  offset = new RealDate(y, m - 1, d, 12, 0, 0).getTime() - RealDate.now();
}

/* ---- the data ----------------------------------------------------------- */
export function readDataFiles() {
  const out = new Map();
  for (const n of fs.readdirSync(DATA_DIR)) {
    const full = path.join(DATA_DIR, n);
    if (fs.statSync(full).isFile() && n.toLowerCase().endsWith(".json")) out.set(n, fs.readFileSync(full));
  }
  return out;
}

export function decode(buf) {
  const b = new Uint8Array(buf);
  if (b[0] === 0xFF && b[1] === 0xFE) return new TextDecoder("utf-16le").decode(b.subarray(2));
  return new TextDecoder("utf-8").decode(b);
}

/* The newest day anybody logged: the day the backup was taken. */
export function backupDay(files) {
  let max = "";
  for (const [n, buf] of files) {
    if (n.startsWith("_")) continue;
    for (const e of JSON.parse(decode(buf)).entries || []) if (e.date > max) max = e.date;
  }
  return max;
}

/* ---- the web modules ---------------------------------------------------- */
class MemFileHandle {
  constructor(dir, name) { this.kind = "file"; this.name = name; this._d = dir; }
  async getFile() {
    const r = this._d._f.get(this.name);
    if (!r) throw new DOMException(this.name, "NotFoundError");
    return new File([r.bytes], this.name, { lastModified: r.mtime });
  }
  async createWritable() {
    const parts = [], d = this._d, n = this.name;
    return {
      async write(x) { parts.push(x instanceof Uint8Array ? x : new Uint8Array(await new Blob([x]).arrayBuffer())); },
      async close() {
        const out = new Uint8Array(parts.reduce((a, b) => a + b.length, 0));
        let o = 0;
        for (const p of parts) { out.set(p, o); o += p.length; }
        d._f.set(n, { bytes: out, mtime: Date.now() });
        d.writes.push(n);
      }
    };
  }
}
export class MemDir {
  constructor(name) { this.kind = "directory"; this.name = name; this._f = new Map(); this._d = new Map(); this.writes = []; }
  async *entries() {
    for (const n of [...this._f.keys()]) yield [n, new MemFileHandle(this, n)];
    for (const [n, d] of this._d) yield [n, d];
  }
  async getFileHandle(n, o = {}) {
    if (!this._f.has(n)) {
      if (!o.create) throw new DOMException(n, "NotFoundError");
      this._f.set(n, { bytes: new Uint8Array(0), mtime: Date.now() });
    }
    return new MemFileHandle(this, n);
  }
  async getDirectoryHandle(n, o = {}) {
    if (!this._d.has(n)) { if (!o.create) throw new DOMException(n, "NotFoundError"); this._d.set(n, new MemDir(n)); }
    return this._d.get(n);
  }
  async removeEntry(n) { if (!this._f.delete(n) && !this._d.delete(n)) throw new DOMException(n, "NotFoundError"); }
  text(n) { return decode(this._f.get(n).bytes); }
}

const JS = path.join(ROOT, "tools/water-challenge/js/");
export const web = {
  C: await import(pathToFileURL(JS + "config.js")),
  model: await import(pathToFileURL(JS + "model.js")),
  store: await import(pathToFileURL(JS + "store.js")),
  pets: await import(pathToFileURL(JS + "pets.js")),
  util: await import(pathToFileURL(JS + "util.js"))
};

export async function loadWeb(files) {
  const mem = new MemDir("data");
  for (const [n, buf] of files) mem._f.set(n, { bytes: new Uint8Array(buf), mtime: Date.now() - 60000 });
  const { S, dataChanged } = web.model;
  S.me = "webtest";
  S.participants = [];
  web.store.setDir(mem);
  await web.store.loadSettings();
  S.participants = await web.store.loadAll();
  dataChanged();
  const msgs = [];
  web.util.bus.msg = t => msgs.push(t);
  web.util.bus.drown = () => {};
  web.util.bus.petReset = () => {};
  return { mem, S, msgs };
}

export const clone = o => JSON.parse(JSON.stringify(o));
export function dayKeys(from, to) {
  const out = [];
  const d = new RealDate(from + "T12:00:00"), end = new RealDate(to + "T12:00:00");
  for (; d <= end; d.setDate(d.getDate() + 1)) {
    out.push(d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"));
  }
  return out;
}
