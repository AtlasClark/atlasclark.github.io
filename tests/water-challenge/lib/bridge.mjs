/* Test bridge: runs R55's own script (from the .hta) in a Node vm with an in-memory
   filesystem, and the web modules in this realm with an in-memory folder handle.
   Both read the same copy of the data, and both clocks can be set to any day.

   Inputs (gitignored, local only):
     AWC_HTA   default AtlasWaterTracker/Atlas_Water_Challenge_R55.hta
     AWC_DATA  default AtlasWaterTracker/data                                    */

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const HTA_PATH = process.env.AWC_HTA || path.join(ROOT, "AtlasWaterTracker/Atlas_Water_Challenge_R55.hta");
export const DATA_DIR = process.env.AWC_DATA || path.join(ROOT, "AtlasWaterTracker/data");
export const available = fs.existsSync(HTA_PATH) && fs.existsSync(DATA_DIR);
export const skipReason = available ? false : "R55 .hta or data folder not found (set AWC_HTA / AWC_DATA)";

/* ---- clock -------------------------------------------------------------- */
const RealDate = Date;
let offset = 0;
class TestDate extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + offset); }
  static now() { return RealDate.now() + offset; }
}
globalThis.Date = TestDate;

const CLOCK_SRC = `(function () {
  var Real = Date, off = 0;
  globalThis.__setOffset = function (o) { off = o; };
  globalThis.Date = class extends Real {
    constructor(...a) { if (a.length) super(...a); else super(Real.now() + off); }
    static now() { return Real.now() + off; }
  };
})();`;

let r55ctx = null;
/* Both realms read noon on the given day. */
export function setToday(key) {
  const [y, m, d] = key.split("-").map(Number);
  offset = new RealDate(y, m - 1, d, 12, 0, 0).getTime() - RealDate.now();
  if (r55ctx) r55ctx.__setOffset(offset);
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

/* ---- R55 in a vm --------------------------------------------------------- */
export function loadR55(files) {
  const html = fs.readFileSync(HTA_PATH, "utf8");
  const m = /<script type="text\/javascript">([\s\S]*?)<\/script>/.exec(html);
  if (!m) throw new Error("no script block in " + HTA_PATH);
  const disk = new Map();                       /* path -> text */
  const DIR = "D:\\data";
  for (const [n, buf] of files) disk.set(DIR + "\\" + n, decode(buf));

  class Enumerator {
    constructor(list) { this.l = list; this.i = 0; }
    atEnd() { return this.i >= this.l.length; }
    moveNext() { this.i++; }
    item() { return this.l[this.i]; }
  }
  const ctx = {
    console, window: {}, location: { href: "" }, oHTA: {}, Enumerator,
    document: { getElementById: () => null, attachEvent() {} },
    ActiveXObject: function () { throw new Error("no ActiveX in tests"); },
    confirm: () => true
  };
  vm.createContext(ctx);
  vm.runInContext(CLOCK_SRC, ctx);
  vm.runInContext(m[1], ctx, { filename: "R55.hta.js" });

  const msgs = [];
  Object.assign(ctx, {
    fso: {
      FileExists: p => disk.has(p), FolderExists: () => true, BuildPath: (a, b) => a + "\\" + b,
      GetFolder: () => ({ Files: [...disk.keys()].filter(p => p.lastIndexOf("\\") === DIR.length)
                                                 .map(p => ({ Name: p.slice(DIR.length + 1), Path: p, Size: disk.get(p).length, DateLastModified: 0 })) })
    },
    readTextFile: p => disk.get(p),
    writeTextFile: (p, t) => disk.set(p, t),
    withLock: (p, fn) => { fn(); return true; },
    currentWindowsUser: () => "r55test",
    setMsg: t => msgs.push(t), showBanner: () => {}, render: () => {}, splash: () => {},
    folderSignature: () => "sig",
    storageOK: true, dataDir: DIR
  });
  r55ctx = ctx;
  ctx.__setOffset(offset);                      /* a new sandbox starts on the current test clock */
  ctx.loadSettings();
  ctx.participants = ctx.loadAll();
  ctx.dataChanged();
  return { ctx, disk, msgs, DIR };
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

/* Collects differences rather than stopping at the first, so one run shows them all. */
export class Diff {
  constructor() { this.list = []; }
  eq(label, a, b) {
    const ja = JSON.stringify(a), jb = JSON.stringify(b);
    if (ja !== jb) this.list.push(label + "\n      R55: " + ja + "\n      web: " + jb);
  }
  report(limit = 15) {
    return this.list.length + " difference(s):\n  " + this.list.slice(0, limit).join("\n  ") +
           (this.list.length > limit ? "\n  ..." : "");
  }
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
