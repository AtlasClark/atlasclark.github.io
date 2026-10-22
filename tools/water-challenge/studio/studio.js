/* Pet Studio: draw the Water Challenge pets as vector shapes with colour roles and
   save them to tools/water-challenge/pets/pets.json, which the page loads at start.
   Pets not saved there keep their built-in drawing. Work in progress is kept in this
   browser (IndexedDB) until it is saved. Reference images are never exported. */

import * as C from "../js/config.js";
import { defs, hats, HAT_KEYS, HOLIDAY_KEYS, CUP_KEYS, FX_KEYS, colourOf, PET_DEFS_FORMAT, fxSpot, drawShapes } from "../js/petdefs.js";
import { COSMETICS } from "../js/cosmetics.js";
import { CUP_PLACE, CUP_H } from "../js/styleart.js";
import { drawPortrait, critterCrown, drawHeadstone, drawCoin } from "../js/art.js";
import { importAll, importHat, basePalette } from "./importer.js";
import { Editor, TOOL_HINTS } from "./editor.js";
import { Preview } from "./preview.js";
import * as G from "./geom.js";

const REV = "studio 1.14.0";
const PETS_URL = "../pets/pets.json";
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const KEY_OK = /^[A-Za-z][A-Za-z0-9_-]{0,15}$/;

/* ---- state ------------------------------------------------------------------ */
const W = {
  builtin: {},            /* kind -> imported built-in pet (never edited) */
  pets: {},               /* kind -> { def, edited } */
  kind: 0, pose: "swim", sel: new Set(), tab: "shape",
  hue: 205, dead: false, water: true, crown: false, fx: false, snap: false,
  tool: "select", brush: 0.07, lastFill: "body", lastStroke: "dark",
  refs: {},               /* kind -> { swim: ref, portrait: ref }; ref = { src, x, y, w, op } */
  hist: {}, pending: null, clip: null,
  dirty: false, savedAt: "", dirHandle: null, refDrag: false,
  target: null,           /* { file, data }: what Save writes in dirHandle */
  base: {},               /* item -> its drawing in the file as last read or written (canon JSON) */
  baseSig: null,          /* that file's lastModified:size, to spot someone else's save */
  touched: new Set(),     /* items changed here since then */
  tryOn: 0                /* the pet shown under a hat while it is edited */
};

/* Items are pet kinds and the hats and props ("crown", "jester", "grave", "coin"). A hat or
   prop has one drawing; only the hats are worn, and only the headstone takes a pet's hue. */
const HAT_NAMES = { crown: "Crown", jester: "Jester hat", grave: "Headstone", coin: "Token coin",
                    santa: "Santa hat", elf: "Elf hat", witch: "Witch hat", pumpkin: "Pumpkin hat",
                    partyGold: "Party hat (gold)", partyStripe: "Party hat (stripes)",
                    dropCrown: "Droplet crown", splashHat: "Splash hat" };
/* holiday hat key -> { holiday, role } from config */
const HOLIDAY_OF = Object.fromEntries(C.HOLIDAY_HATS.flatMap(h => [[h.crown, { h, role: "crown" }], [h.jester, { h, role: "jester" }]]));
const isHat = k => HAT_KEYS.includes(k);
const wears = k => k === "crown" || k === "jester" || HOLIDAY_KEYS.includes(k);
const isCup = k => CUP_KEYS.includes(k), isFx = k => FX_KEYS.includes(k);
const hued = k => !isHat(k) || k === "grave" || isFx(k);
for (const k of CUP_KEYS) HAT_NAMES[k] = COSMETICS[k].name;
for (const k of FX_KEYS) HAT_NAMES[k] = { "effect:sparkles": "Sparkle", "effect:hearts": "Heart", "effect:notes": "Music note" }[k];
const CUP_AT = { bottom: "the middle of the glass bottom", rim: "the middle of the rim", surface: "the water surface" };
/* The inside of the glass around a cup item's origin, in widths (surface items: water at 60%). */
function cupFrame(k) {
  const pl = CUP_PLACE[k.slice(6)] || { at: "bottom" };
  if (pl.at === "rim") return { x0: -0.5, x1: 0.5, y0: 0, y1: CUP_H };
  if (pl.at === "surface") return { x0: -pl.x, x1: 1 - pl.x, y0: -0.4 * CUP_H - (pl.dy || 0), y1: 0.6 * CUP_H - (pl.dy || 0) };
  return { x0: -0.5, x1: 0.5, y0: -CUP_H, y1: 0 };
}
const ITEMS = () => [...Array(C.PET_MAX).keys(), ...HAT_KEYS];
function baseName(k) { return isHat(k) ? HAT_NAMES[k] : C.PET_BASE_NAMES[k]; }
function itemName(k) { return isHat(k) ? HAT_NAMES[k] : C.PET_NAMES[k]; }
function hatDef(h) { return { name: "", crown: [0, 0], pal: h.pal, swim: h.shapes, portrait: null }; }
/* Items whose drawing here differs from the file's (after Open or a restored draft). */
function markTouched() {
  W.touched.clear();
  for (const k of ITEMS()) {
    const p = W.pets[k], mine = p && p.edited && p.def.swim.length ? canon(k, p.def) : undefined;
    if (mine !== W.base[k]) W.touched.add(k);
  }
}
function resetItems() {
  for (const k of ITEMS()) W.pets[k] = { def: G.clone(W.builtin[k]), edited: false };
}
function rarityOf(k) {
  if (HOLIDAY_OF[k]) return { name: HOLIDAY_OF[k].h.name + ", " + (HOLIDAY_OF[k].role === "crown" ? "goal met" : "under goal"), i: 0 };
  if (isCup(k)) return { name: "Style shop, cup", i: 0 };
  if (isFx(k)) return { name: "Style shop, effect", i: 0 };
  if (isHat(k)) return { name: { crown: "leader, goal met", jester: "leader, under goal", grave: "a drowned pet", coin: "tokens" }[k], i: 0 };
  if (k === C.HOMUNCULUS_KIND) return { name: "Full-pen reward", i: 5 };
  if (k === C.MYSTERY_KIND) return { name: "Secret", i: 6 };
  const base = k >= C.PEN2_FIRST ? k - C.PEN2_FIRST : k;
  const b = C.PET_BINS.findIndex(x => x.kinds.includes(base));
  return { name: (b >= 0 ? C.PET_BINS[b].name : "?") + (k >= C.PEN2_FIRST ? " · second pen" : ""), i: b };
}
function iconHue(k) { let h = 0; const n = baseName(k) + k; for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) % 360; return h; }

/* ---- what the editor and preview see --------------------------------------- */
const app = {
  get kind() { return W.kind; },
  get def() { return W.pets[W.kind] && W.pets[W.kind].def; },
  get shapes() { const d = this.def; return !d ? null : W.pose === "portrait" ? d.portrait : d.swim; },
  get ghost() { const d = this.def; return d && W.pose === "portrait" && !d.portrait ? d.swim : null; },
  get isHat() { return isHat(W.kind); },
  get tryOn() { const p = wears(W.kind) && W.pets[W.tryOn]; return p ? { def: p.def, kind: W.tryOn } : null; },
  get isProp() { return isHat(W.kind) && !wears(W.kind); },
  get origin() {
    if (isCup(W.kind)) return { bottom: "glass bottom", rim: "rim", surface: "water surface" }[(CUP_PLACE[W.kind.slice(6)] || {}).at] || "glass bottom";
    if (isFx(W.kind)) return "centre";
    return { grave: "ground", coin: "centre" }[W.kind] || "crown spot";
  },
  get cupFrame() { return isCup(W.kind) ? cupFrame(W.kind) : null; },
  get pose() { return W.pose; },
  get sel() { return W.sel; },
  get tool() { return W.tool; },
  get hue() { return W.hue; },
  get dead() { return W.dead; },
  get water() { return W.water; },
  get crown() { return W.crown && !isHat(W.kind); },
  get fx() { return W.fx && !isHat(W.kind); },
  get range() { const d = this.def; return d && d.range !== undefined ? d.range : 1; },
  get snap() { return W.snap; },
  get brush() { return W.brush; },
  get lastFill() { return this.def && this.def.pal[W.lastFill] ? W.lastFill : firstKey(); },
  get lastStroke() { return this.def && this.def.pal[W.lastStroke] ? W.lastStroke : firstKey(); },
  get ref() { const r = W.refs[W.kind]; return r && r[W.pose]; },
  get refDrag() { return W.refDrag; },
  begin, commit, cancel, live, add,
  selChanged() { renderPanels(); editor.redraw(); },
  coords(w) { $("coords").textContent = w ? "x " + w[0].toFixed(3) + "  y " + w[1].toFixed(3) + " r  ·  " + Math.round(editor.view.z) + " px/r" : ""; },
  toast
};
function firstKey() { return Object.keys(app.def ? app.def.pal : { body: 1 })[0]; }

/* ---- history: snapshots of the current pet ----------------------------------- */
const snap = () => JSON.stringify(W.pets[W.kind]);
function hist() { return W.hist[W.kind] || (W.hist[W.kind] = { u: [], r: [] }); }
function begin() { if (W.pending === null) W.pending = snap(); }
function cancel() { W.pending = null; }
function commit() {
  if (W.pending === null) return;
  const before = W.pending;
  W.pending = null;
  if (before === snap()) { renderPanels(); return; }
  const h = hist();
  h.u.push(before); if (h.u.length > 200) h.u.shift();
  h.r.length = 0;
  W.pets[W.kind].edited = true;
  changed();
}
/* A change made in one step. */
function change(fn) { begin(); fn(); commit(); }
/* Mid-drag: draw, but no history or panels yet. */
function live() { syncDefs(); editor.redraw(); }

function undo(redo) {
  const h = hist(), from = redo ? h.r : h.u, to = redo ? h.u : h.r;
  if (!from.length) return;
  to.push(snap());
  W.pets[W.kind] = JSON.parse(from.pop());
  W.sel.clear();
  changed();
}

function changed() {
  W.dirty = true;
  W.touched.add(W.kind);
  syncDefs();
  autosave();
  renderAll();
}

/* The page's renderer draws a pet from defs; keep it in step with the work. */
function syncDefs() {
  for (let k = 0; k < C.PET_MAX; k++) {
    const p = W.pets[k];
    if (p && p.edited && p.def.swim.length) defs[k] = p.def;
    else if (W.builtin[k]) defs[k] = W.builtin[k];                      /* no pet has a code drawing */
    else delete defs[k];
    C.PET_NAMES[k] = (p && p.edited && p.def.name) || baseName(k);
  }
  for (const key of HAT_KEYS) {
    const p = W.pets[key];
    const b = p && p.edited && p.def.swim.length ? p.def : W.builtin[key];
    if (b) hats[key] = { pal: b.pal, shapes: b.swim };
  }
}

function add(s) {
  change(() => {
    app.shapes.push(s);
    W.sel.clear(); W.sel.add(app.shapes.length - 1);
  });
}

/* ---- selection operations ---------------------------------------------------- */
const selIdx = () => [...W.sel].sort((a, b) => a - b);
function editSel(fn) {
  const list = app.shapes;
  if (!list || !W.sel.size) return;
  change(() => { for (const i of selIdx()) list[i] = fn(list[i], i) || list[i]; });
}
function deleteSel() {
  const list = app.shapes;
  if (!list || !W.sel.size) return;
  change(() => { const keep = list.filter((_, i) => !W.sel.has(i)); list.length = 0; list.push(...keep); W.sel.clear(); });
}
function duplicateSel(M) {
  const list = app.shapes;
  if (!list || !W.sel.size) return;
  change(() => {
    const copies = selIdx().map(i => G.mapShape(list[i], M || G.translateM(0.04, 0.04), false));
    W.sel.clear();
    for (const c of copies) { list.push(c); W.sel.add(list.length - 1); }
  });
}
function mirrorSel() {
  const b = G.bounds(selIdx().map(i => app.shapes[i]));
  if (b) editSel(s => G.mapShape(s, G.scaleM((b.x0 + b.x1) / 2, 0, -1, 1), false));
}
function reorder(dir) {           /* 1 forward, -1 back, 2 front, -2 back-most */
  const list = app.shapes;
  if (!list || !W.sel.size) return;
  change(() => {
    const picked = selIdx().map(i => list[i]);
    if (Math.abs(dir) === 2) {
      const rest = list.filter((_, i) => !W.sel.has(i));
      list.length = 0;
      list.push(...(dir > 0 ? [...rest, ...picked] : [...picked, ...rest]));
      W.sel = new Set(picked.map(s => list.indexOf(s)));
      return;
    }
    const idx = dir > 0 ? selIdx().reverse() : selIdx();
    for (const i of idx) {
      const j = i + dir;
      if (j < 0 || j >= list.length || W.sel.has(j)) continue;
      [list[i], list[j]] = [list[j], list[i]];
      W.sel.delete(i); W.sel.add(j);
    }
  });
}
/* Combine: the selected shapes and strokes become one solid shape in the colour of
   the lowest one. Cut out: the lowest keeps its colour and loses what the others
   cover. Eyes stay separate. */
function combineSel(cut) {
  const list = app.shapes;
  if (!list) return;
  const idx = selIdx().filter(i => list[i].t !== "eye");
  if (!idx.length) { toast("Select shapes or strokes first. Eyes stay separate."); return; }
  if (cut && idx.length < 2) { toast("Select a shape and what to cut from it. The lowest one keeps its colour."); return; }
  const base = list[idx[0]], parts = idx.map(i => list[i]);
  let d;
  try { d = G.areaToPath(cut ? G.cutOut(parts[0], parts.slice(1)) : G.combine(parts)); }
  catch (e) { toast("Could not combine: " + (e.message || e)); return; }
  const shows = new Set(parts.map(s => s.show || ""));
  change(() => {
    const out = { t: "path", d: d || [], fill: base.fill || base.stroke };
    if (shows.size === 1 && base.show) out.show = base.show;
    const keep = list.filter((_, i) => !idx.includes(i));
    const at = idx[0] - idx.filter(i => i < idx[0]).length;
    list.length = 0; list.push(...keep);
    W.sel.clear();
    if (d) { list.splice(at, 0, out); W.sel.add(at); }
  });
  if (!d) toast("Nothing was left, so the shapes were removed. Undo brings them back.");
}

function nudge(dx, dy) { editSel(s => G.mapShape(s, G.translateM(dx, dy))); }
function copySel() {
  if (!app.shapes || !W.sel.size) return;
  const shapes = selIdx().map(i => G.clone(app.shapes[i])), pal = {};
  for (const s of shapes) for (const k of [s.fill, s.stroke]) if (k) pal[k] = G.clone(app.def.pal[k]);
  W.clip = { shapes, pal, kind: W.kind, pose: W.pose };
  toast(shapes.length + " copied");
}
function paste() {
  if (!W.clip || !app.shapes) return;
  const same = W.clip.kind === W.kind && W.clip.pose === W.pose;
  change(() => {
    for (const [k, v] of Object.entries(W.clip.pal)) if (!app.def.pal[k]) app.def.pal[k] = G.clone(v);
    W.sel.clear();
    for (const s of W.clip.shapes) { app.shapes.push(same ? G.mapShape(s, G.translateM(0.04, 0.04), false) : G.clone(s)); W.sel.add(app.shapes.length - 1); }
  });
}

/* ---- persistence --------------------------------------------------------------- */
const idb = (() => {
  let db = null;
  const open = () => db || (db = new Promise((res, rej) => {
    const r = indexedDB.open("awc-pet-studio", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const run = (mode, fn) => open().then(d => new Promise((res, rej) => {
    const t = d.transaction("kv", mode), q = fn(t.objectStore("kv"));
    t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error);
  }));
  return { get: k => run("readonly", s => s.get(k)), set: (k, v) => run("readwrite", s => s.put(v, k)) };
})();

let saveTimer = 0;
function autosave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const pets = {};
    for (const [k, p] of Object.entries(W.pets)) if (p.edited) pets[k] = p.def;
    idb.set("draft", { pets, refs: W.refs, dirty: W.dirty, at: Date.now() }).catch(() => { });
  }, 500);
  renderSaveState();
}

function normalize(p) {
  const pal = p.pal && Object.keys(p.pal).length ? p.pal : basePalette();
  return { name: typeof p.name === "string" ? p.name : "", crown: Array.isArray(p.crown) ? p.crown : [0, -1], pal,
           swim: Array.isArray(p.swim) ? p.swim : [], portrait: Array.isArray(p.portrait) && p.portrait.length ? p.portrait : null,
           range: typeof p.range === "number" ? Math.max(0, Math.min(1, p.range)) : 1,
           fx: Array.isArray(p.fx) && p.fx.length === 2 && p.fx.every(Number.isFinite) ? p.fx : null };
}

function loadFileObj(obj) {
  if (!obj || typeof obj.pets !== "object") throw new Error("not a pets.json file");
  if (Number(obj.format) > PET_DEFS_FORMAT) throw new Error("made by a newer studio (format " + obj.format + ")");
  resetItems();
  for (const [key, p] of Object.entries(obj.pets)) {
    const k = Number(key);
    if (Number.isInteger(k) && k >= 0 && k < C.PET_MAX) W.pets[k] = { def: normalize(p), edited: true };
  }
  for (const key of HAT_KEYS) {
    const h = obj.hats && obj.hats[key];
    if (h && Array.isArray(h.shapes)) W.pets[key] = { def: hatDef({ pal: h.pal || {}, shapes: h.shapes }), edited: true };
  }
}

/* Save writes pets.json into the repo's pets folder (publish with a push), or
   _pets.json into a challenge data folder (the one with _settings.json): that
   folder then uses this art at once, for testing, until the file is deleted. */
const SITE_FILE = "pets.json", FOLDER_FILE = "_pets.json";
async function targetOf(h) {
  try { await h.getFileHandle("_settings.json"); return { file: FOLDER_FILE, data: true }; }
  catch { return { file: SITE_FILE, data: false }; }
}
async function readJson(h, name) {
  const f = await (await h.getFileHandle(name)).getFile();
  return JSON.parse((await f.text()).replace(/^\uFEFF/, ""));
}

async function readSaved() {
  if (W.dirHandle) {
    try {
      if (await W.dirHandle.queryPermission({ mode: "readwrite" }) === "granted") {
        W.target = await targetOf(W.dirHandle);
        const st = await fileState();
        if (st && st.f) { const obj = await readJson(W.dirHandle, W.target.file); W.baseSig = st.sig; return obj; }
        if (st) W.baseSig = st.sig;                                      /* no file yet: watch for one */
        if (W.target.data) { try { return await readJson(W.dirHandle, SITE_FILE); } catch { } }   /* saved there under the old name */
      }
    } catch { }
  }
  const res = await fetch(PETS_URL, { cache: "no-store" });
  return res.ok ? res.json() : { format: 1, pets: {} };
}

async function pickSaveFolder() {
  toast("Pick tools/water-challenge/pets in the repo to publish, or a challenge data folder to test there.");
  let h;
  try { h = await window.showDirectoryPicker({ id: "awc-pet-studio", mode: "readwrite" }); }
  catch (e) { if (e.name !== "AbortError") toast("Could not open the folder: " + (e.message || e)); return false; }
  const t = await targetOf(h);
  if (!t.data && h.name !== "pets") {
    let has = false;
    try { await h.getFileHandle(SITE_FILE); has = true; } catch { }
    if (!has && !confirm('"' + h.name + '" is neither the repo\'s pets folder nor a challenge data folder. Save pets.json there anyway?')) return false;
  }
  W.dirHandle = h; W.target = t;
  try { await idb.set("dir", h); } catch { }
  renderSaveState();
  return true;
}

const R = v => typeof v === "number" ? G.R5(v) : v;
const tidy = s => JSON.stringify(s, (k, v) => Array.isArray(v) ? v.map(R) : R(v));
function petsJson() {
  const ks = [...Array(C.PET_MAX).keys()].filter(k => W.pets[k].edited && W.pets[k].def.swim.length);
  const hs = HAT_KEYS.filter(k => W.pets[k].edited && W.pets[k].def.swim.length);
  const stamp = new Date().toISOString().slice(0, 19);
  const list = a => a.length ? "[\n" + a.map(s => "        " + tidy(s)).join(",\n") + "\n      ]" : "[]";
  const out = ["{", '  "format": ' + PET_DEFS_FORMAT + ",", '  "studio": "' + REV + '",', '  "saved": "' + stamp + '",', '  "pets": {'];
  ks.forEach((k, n) => {
    const d = W.pets[k].def, parts = [];
    parts.push('      "about": ' + JSON.stringify(baseName(k)));
    if (d.name && d.name !== baseName(k)) parts.push('      "name": ' + JSON.stringify(d.name));
    parts.push('      "crown": ' + tidy(d.crown));
    if (d.range !== undefined && d.range < 1) parts.push('      "range": ' + G.R5(d.range));
    if (d.fx) parts.push('      "fx": ' + tidy(d.fx));
    parts.push('      "pal": {\n' + Object.entries(d.pal).map(([key, c]) => "        " + JSON.stringify(key) + ": " + tidy(c)).join(",\n") + "\n      }");
    parts.push('      "swim": ' + list(d.swim));
    if (d.portrait) parts.push('      "portrait": ' + list(d.portrait));
    out.push('    "' + k + '": {\n' + parts.join(",\n") + "\n    }" + (n < ks.length - 1 ? "," : ""));
  });
  if (hs.length) {
    out.push("  },", '  "hats": {');
    hs.forEach((k, n) => {
      const d = W.pets[k].def;
      out.push('    "' + k + '": {\n      "pal": {\n' + Object.entries(d.pal).map(([key, c]) => "        " + JSON.stringify(key) + ": " + tidy(c)).join(",\n") +
               '\n      },\n      "shapes": ' + list(d.swim) + "\n    }" + (n < hs.length - 1 ? "," : ""));
    });
  }
  out.push("  }", "}", "");
  return { text: out.join("\n"), count: ks.length + hs.length };
}

async function saveToRepo() {
  try {
    if (!W.dirHandle && !(await pickSaveFolder())) return;
    if (await W.dirHandle.requestPermission({ mode: "readwrite" }) !== "granted") { toast("Permission refused. Nothing saved."); return; }
    W.target = await targetOf(W.dirHandle);
    saving = true;
    /* someone else saved since this studio last read the file: take their changes first */
    const st = await fileState();
    if (st && st.sig !== W.baseSig) {
      const r = await pullTheirs(st);
      if (r.conflicts.length && !confirm("Someone else also saved " + list3(r.conflicts) + " since you opened " + W.target.file + ".\n\n" +
                                         "OK keeps your version of " + (r.conflicts.length === 1 ? "it" : "them") + ". Cancel takes theirs.")) {
        for (const k of r.conflicts) { takeTheirs(k, r.theirs[k]); W.touched.delete(k); }
      }
      if (r.changed.length || r.conflicts.length) { syncDefs(); renderAll(); for (const k of [...r.changed, ...r.conflicts]) drawThumb(k); }
    }
    const { text, count } = petsJson();
    const fh = await W.dirHandle.getFileHandle(W.target.file, { create: true }), w = await fh.createWritable();
    await w.write(text); await w.close();
    const after = await fileState();
    W.base = itemsOf(JSON.parse(text)); W.baseSig = after ? after.sig : null; W.touched.clear();
    saving = false;
    W.dirty = false;
    W.savedAt = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    autosave();
    const n = count + " item" + (count === 1 ? "" : "s");
    if (!W.target.data) { toast("Saved " + n + " to pets/pets.json. Commit and push to put them on the site."); return; }
    toast("Saved " + n + " to " + W.dirHandle.name + "/" + FOLDER_FILE + ". Everyone on that folder sees it on their next refresh.");
    /* a pets.json in a data folder is read as a person's file and fails: offer to remove it */
    let stray = false;
    try { await W.dirHandle.getFileHandle(SITE_FILE); stray = true; } catch { }
    if (stray && confirm("This data folder also has a pets.json (an earlier save under the site's name). The challenge page tries to read it " +
                         "as a person's file. Delete it? Your art is now in " + FOLDER_FILE + ".")) {
      try { await W.dirHandle.removeEntry(SITE_FILE); toast("Removed the stray pets.json."); } catch (e) { toast("Could not remove pets.json: " + (e.message || e)); }
    }
  } catch (e) {
    if (e.name !== "AbortError") toast("Save failed: " + (e.message || e));
  } finally { saving = false; }
}

/* ---- two studios, one file ------------------------------------------------------ */
/* While a save folder is open, the file is checked every WATCH_MS. Someone else's
   save is taken in at once for every item not changed here since the last read or
   save; an item changed on both sides keeps this studio's version, and Save asks. */
const WATCH_MS = 4000;
let saving = false;
const canon = (k, def) => JSON.stringify(isHat(k) ? hatDef({ pal: def.pal || {}, shapes: def.swim || [] }) : normalize(def));
function itemsOf(obj) {
  const out = {};
  for (const [key, p] of Object.entries((obj && obj.pets) || {})) {
    const k = Number(key);
    if (Number.isInteger(k) && k >= 0 && k < C.PET_MAX && p && Array.isArray(p.swim) && p.swim.length) out[k] = canon(k, p);
  }
  for (const key of HAT_KEYS) {
    const h = obj && obj.hats && obj.hats[key];
    if (h && Array.isArray(h.shapes) && h.shapes.length) out[key] = canon(key, { pal: h.pal, swim: h.shapes });
  }
  return out;
}
async function fileState() {
  if (!W.dirHandle || !W.target) return null;
  try { if (await W.dirHandle.queryPermission({ mode: "readwrite" }) !== "granted") return null; } catch { return null; }
  try { const f = await (await W.dirHandle.getFileHandle(W.target.file)).getFile(); return { sig: f.lastModified + ":" + f.size, f }; }
  catch { return { sig: "none", f: null }; }
}
function takeTheirs(k, j) {
  W.pets[k] = j ? { def: JSON.parse(j), edited: true } : { def: G.clone(W.builtin[k]), edited: false };
  if (k === W.kind) W.sel.clear();
}
/* Their file against what this studio last read: changed (taken in) and conflicts. */
async function pullTheirs(st) {
  let obj = { pets: {} };
  if (st.f) { try { obj = JSON.parse((await st.f.text()).replace(/^\uFEFF/, "")); } catch { return { changed: [], conflicts: [], theirs: {} }; } }
  const theirs = itemsOf(obj), changed = [], conflicts = [];
  for (const key of new Set([...Object.keys(W.base), ...Object.keys(theirs)])) {
    if (W.base[key] === theirs[key]) continue;
    const k = itemKey(key);
    (W.touched.has(k) ? conflicts : changed).push(k);
  }
  for (const k of changed) takeTheirs(k, theirs[k]);
  W.base = theirs; W.baseSig = st.sig;
  return { changed, conflicts, theirs };
}
const list3 = ks => { const n = ks.map(k => itemName(k)); return n.length <= 3 ? n.join(", ") : n.slice(0, 3).join(", ") + " and " + (n.length - 3) + " more"; };
async function watchFile() {
  if (saving || document.hidden) return;
  const st = await fileState();
  if (!st || W.baseSig === null || st.sig === W.baseSig) return;
  const r = await pullTheirs(st);
  if (!r.changed.length && !r.conflicts.length) return;
  syncDefs(); renderAll();
  for (const k of [...r.changed, ...r.conflicts]) drawThumb(k);
  if (W.touched.size === 0) { W.dirty = false; renderSaveState(); }
  toast("Someone saved " + W.target.file + (r.changed.length ? ": " + list3(r.changed) + " updated here" : "") +
        (r.conflicts.length ? (r.changed.length ? ". " : ". ") + list3(r.conflicts) + " changed on both sides: yours is kept, and Save will ask." : "."));
}

function exportFile() {
  const { text } = petsJson(), a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  a.download = "pets.json"; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function openFile(file) {
  try {
    const obj = JSON.parse(await file.text());
    if (W.dirty && !confirm("Replace the unsaved work with " + file.name + "?")) return;
    loadFileObj(obj);
    W.hist = {}; W.sel.clear(); W.dirty = true;
    markTouched();
    syncDefs(); autosave(); renderAll(); editor.fit();
    toast("Loaded " + Object.values(W.pets).filter(p => p.edited).length + " drawn pets from " + file.name);
  } catch (e) { toast("Could not open it: " + (e.message || e)); }
}

/* ---- panels ---------------------------------------------------------------------- */
let thumbTimer = 0;
function renderAll() {
  renderPetList(); renderPanels(); renderTitle(); renderSaveState();
  editor.redraw();
}

function renderTitle() {
  const k = W.kind, r = rarityOf(k), d = app.def;
  $("petTitle").innerHTML = esc(itemName(k)) + (d && d.name && d.name !== baseName(k) ? ' <span class="dim">(was ' + esc(baseName(k)) + ')</span>' : '') +
    '<span class="tag r' + r.i + '">' + esc(r.name) + '</span>' +
    (W.pets[k].edited ? ' <span class="tag alive">drawn</span>' : ' <span class="tag r0">built-in</span>');
  document.title = itemName(k) + " · Pet Studio";
}

function renderSaveState() {
  const el = $("saveState"), n = Object.values(W.pets).filter(p => p.edited).length;
  el.className = "save-state" + (W.dirty ? " dirty" : "");
  el.textContent = W.dirty ? "Unsaved changes" : W.savedAt ? "Saved " + W.savedAt : "No changes";
  const t = $("saveTarget");
  t.textContent = W.dirHandle ? "\u2192 " + W.dirHandle.name + (W.target ? "/" + W.target.file : "") + (W.target && W.target.data ? " (test art)" : "") : "";
  t.title = W.target && W.target.data ? "A challenge data folder: everyone on it sees this art at once. Delete " + FOLDER_FILE + " there to go back to the site's art."
                                      : "The repo's pets folder: commit and push to publish.";
  $("saveBtn").textContent = W.target && W.target.data ? "Save to folder" : "Save to repo";
  $("editedCount").textContent = n ? n + " drawn" : "";
  $("undoBtn").disabled = !hist().u.length;
  $("redoBtn").disabled = !hist().r.length;
}

function renderPetList() {
  const order = [{ pen: "First pen" }, ...C.PET_BINS.map((b, i) => ({ name: b.name, i, kinds: b.kinds })),
                 { name: "Reward and secret", i: 5, kinds: [C.HOMUNCULUS_KIND, C.MYSTERY_KIND] },
                 { pen: "Second pen" }, ...C.PEN2_BINS.map((b, i) => ({ name: b.name, i, kinds: b.kinds })),
                 { pen: "Hats and props" }, { name: "Crown and jester", i: 0, kinds: ["crown", "jester"] },
                 { name: "Holiday hats", i: 0, kinds: HOLIDAY_KEYS },
                 { name: "Headstone and coin", i: 0, kinds: ["grave", "coin"] },
                 { pen: "Style shop" }, { name: "Cup", i: 0, kinds: CUP_KEYS },
                 { name: "Effect particles", i: 0, kinds: FX_KEYS }];
  const el = $("petList");
  if (!el.dataset.built) {
    /* one foldable section per collection; which are shut is remembered in this browser */
    const shut = shutSections(), secs = [];
    for (const g of order) {
      if (g.pen) { secs.push({ name: g.pen, groups: [] }); continue; }
      secs[secs.length - 1].groups.push(g);
    }
    el.innerHTML = secs.map(sec => {
      const n = sec.groups.reduce((a, g) => a + g.kinds.length, 0);
      return '<section class="pen-sec' + (shut.includes(sec.name) ? ' shut' : '') + '" data-sec="' + esc(sec.name) + '">' +
        '<button type="button" class="pen-head" data-sec-toggle aria-expanded="' + !shut.includes(sec.name) + '"><span>' + esc(sec.name) + '</span><b>' + n + '</b></button>' +
        '<div class="pen-body">' + sec.groups.map(g => '<div class="rar-head">' + esc(g.name) + '</div>' + g.kinds.map(k =>
          '<button type="button" class="pet-item" data-kind="' + k + '"><canvas width="80" height="80"></canvas>' +
          '<span class="nm"></span><span class="mark"></span></button>').join("")).join("") + '</div></section>';
    }).join("");
    el.dataset.built = "1";
    for (const k of ITEMS()) drawThumb(k);
  }
  const cur = el.querySelector('.pet-item[data-kind="' + W.kind + '"]'), sec = cur && cur.closest(".pen-sec");
  if (sec && sec.classList.contains("shut")) toggleSection(sec, true);   /* never hide what is open */
  for (const b of el.querySelectorAll(".pet-item")) {
    const k = itemKey(b.dataset.kind), p = W.pets[k];
    b.classList.toggle("on", k === W.kind);
    b.querySelector(".nm").innerHTML = esc(itemName(k)) + '<small>' + (isCup(k) ? 'in the glass' : isFx(k) ? 'effect particle' : isHat(k) ? (wears(k) ? 'on pets and in icons' : k === "grave" ? 'in drained glasses and icons' : 'the bank pile and icons') : '#' + k + (p.def.portrait ? ' · portrait' : '')) + '</small>';
    b.querySelector(".mark").className = "mark" + (p.edited ? " edited" : "");
    b.title = p.edited ? "Drawn in the studio" : "Built-in drawing";
  }
  clearTimeout(thumbTimer);
  thumbTimer = setTimeout(() => drawThumb(W.kind), 150);
}

const itemKey = v => isHat(v) ? v : Number(v);
const SHUT_KEY = "pet-studio-shut";
function shutSections() { try { return JSON.parse(localStorage.getItem(SHUT_KEY) || "[]") || []; } catch { return []; } }
function toggleSection(sec, open) {
  const shut = !open;
  sec.classList.toggle("shut", shut);
  sec.querySelector(".pen-head").setAttribute("aria-expanded", String(!shut));
  const list = shutSections().filter(n => n !== sec.dataset.sec);
  if (shut) list.push(sec.dataset.sec);
  try { localStorage.setItem(SHUT_KEY, JSON.stringify(list)); } catch { }
}
/* A drawing scaled to fit a 60 x 60 thumbnail. */
function drawFit(ctx, def, hue) {
  const b = G.bounds(def.swim);
  if (!b) return;
  const z = Math.min(48 / Math.max(0.01, b.x1 - b.x0), 48 / Math.max(0.01, b.y1 - b.y0));
  ctx.save(); ctx.translate(30 - (b.x0 + b.x1) / 2 * z, 30 - (b.y0 + b.y1) / 2 * z);
  drawShapes(ctx, def.swim, z, hue, def.pal, false);
  ctx.restore();
}

function drawThumb(k) {
  const c = document.querySelector('.pet-item[data-kind="' + k + '"] canvas');
  if (!c) return;
  const ctx = c.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, 80, 80);
  ctx.setTransform(80 / 60, 0, 0, 80 / 60, 0, 0);
  try {
    if (isCup(k) || isFx(k)) drawFit(ctx, W.pets[k].def, isFx(k) ? 340 : 0);
    else if (k === "grave") drawHeadstone(ctx, 30, 52, 46, 210);
    else if (k === "coin") drawCoin(ctx, 30, 30, 44);
    else if (isHat(k)) critterCrown(ctx, 30, 40, 54, k);
    else drawPortrait(ctx, 30, 42, 20, k, iconHue(k));
  } catch { }
}

function renderPanels() {
  for (const b of $("sideTabs").children) b.classList.toggle("on", b.dataset.tab === W.tab);
  for (const b of $("toolbar").querySelectorAll("[data-tool]")) b.classList.toggle("on", b.dataset.tool === W.tool);
  for (const b of $("poseSeg").children) b.classList.toggle("on", b.dataset.pose === W.pose);
  $("hint").textContent = TOOL_HINTS[W.tool] || "";
  const focus = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.focus : "";
  const body = $("tabBody");
  body.innerHTML = W.tab === "shape" ? shapeTab() : W.tab === "colours" ? coloursTab() : W.tab === "pet" ? petTab() : refTab();
  if (focus) { const el = body.querySelector('[data-focus="' + focus + '"]'); if (el) { el.focus(); if (el.select && el.type === "text") { } } }
  renderLayers();
  renderPoseNote();
  renderSaveState();
}

function palOptions(cur, none) {
  const pal = app.def.pal;
  return (none ? '<option value="">' + none + '</option>' : '') +
    Object.keys(pal).map(k => '<option value="' + esc(k) + '"' + (k === cur ? " selected" : "") + '>' + esc(k) + (pal[k].hue ? "" : " (fixed)") + '</option>').join("") +
    (cur === "mixed" ? '<option value="mixed" selected>(mixed)</option>' : "");
}
const deg = v => Math.round((v || 0) * 180 / Math.PI * 10) / 10;
const num = (f, v, step, extra) => '<input type="number" data-f="' + f + '" data-focus="' + f + '" step="' + (step || 0.01) + '" value="' + (Math.round(v * 1e4) / 1e4) + '"' + (extra || "") + '>';

function shapeTab() {
  const list = app.shapes;
  if (!list) return '<p class="note">This pet has no portrait drawing. The Pets tab uses its swim drawing.</p>';
  const sel = selIdx().map(i => list[i]);
  if (!sel.length) {
    return '<h4>Nothing selected</h4><p class="note">Pick a tool above and draw, or click a shape. Every shape takes a colour from the Colours tab; ' +
      'pet colours follow each pet&rsquo;s own hue in the game.</p>' +
      '<p class="note"><kbd>Del</kbd> delete &middot; <kbd>Ctrl D</kbd> duplicate &middot; <kbd>Ctrl E</kbd> combine into one solid shape &middot; <kbd>Ctrl C/V</kbd> copy between pets &middot; <kbd>M</kbd> mirror &middot; ' +
      '<kbd>Shift M</kbd> mirrored copy across the centre line &middot; <kbd>[ ]</kbd> order &middot; arrows nudge &middot; wheel zoom &middot; Space or right-drag pan &middot; <kbd>0</kbd> fit</p>';
  }
  const all = (f) => { const v = sel.map(s => s[f] ?? ""); return v.every(x => x === v[0]) ? v[0] : "mixed"; };
  const eyesOnly = sel.every(s => s.t === "eye"), h = [];
  if (sel.length > 1) h.push('<h4>' + sel.length + ' shapes</h4>');
  else h.push('<h4>' + ({ ell: "Ellipse", path: G.isClosed(sel[0]) ? "Shape" : "Line", eye: "Eye" })[sel[0].t] + '</h4>');
  if (!eyesOnly) {
    h.push('<div class="row"><label>Fill</label><select data-f="fill">' + palOptions(all("fill"), "none") + '</select></div>');
    h.push('<div class="row"><label>Stroke</label><select data-f="stroke">' + palOptions(all("stroke"), "none") + '</select></div>');
    const w = all("w");
    h.push('<div class="row"><label>Width</label><input type="range" data-f="w" min="0.5" max="40" step="0.5" value="' + (w === "mixed" || w === "" ? W.brush * 100 : w * 100) + '">' +
           '<span class="val">' + (w === "mixed" ? "&ndash;" : w === "" ? "&ndash;" : (w * 100).toFixed(1)) + '</span></div>');
    h.push('<div class="row"><label>Ends</label><select data-f="cap"><option value="">square</option><option value="round"' + (all("cap") === "round" ? " selected" : "") + '>round</option></select></div>');
  }
  const show = all("show");
  h.push('<div class="row"><label>Shows</label><select data-f="show"><option value="">alive and drowned</option>' +
         '<option value="alive"' + (show === "alive" ? " selected" : "") + '>alive only</option><option value="dead"' + (show === "dead" ? " selected" : "") + '>drowned only</option>' +
         (show === "mixed" ? '<option selected>(mixed)</option>' : '') + '</select></div>');
  if (sel.length === 1) {
    const s = sel[0];
    h.push('<div class="sep"></div>');
    if (s.t === "ell") {
      h.push('<div class="grid2"><div class="row"><label>X</label>' + num("x", s.x) + '</div><div class="row"><label>Y</label>' + num("y", s.y) + '</div>' +
             '<div class="row"><label>RX</label>' + num("rx", s.rx) + '</div><div class="row"><label>RY</label>' + num("ry", s.ry) + '</div></div>');
      h.push('<div class="row"><label>Turn&deg;</label>' + num("rotd", deg(s.rot), 1) + '</div>');
      h.push('<div class="grid2"><div class="row"><label>From</label>' + num("a0d", deg(s.a0 ?? 0), 1) + '</div><div class="row"><label>To</label>' + num("a1d", deg(s.a1 ?? G.TAU), 1) + '</div></div>');
      h.push('<div class="row"><label></label><label style="width:auto"><input type="checkbox" data-f="chord"' + (s.chord ? " checked" : "") + '> close a part arc with a straight edge (dome)</label></div>');
    } else if (s.t === "eye") {
      h.push('<div class="grid2"><div class="row"><label>X</label>' + num("x", s.x) + '</div><div class="row"><label>Y</label>' + num("y", s.y) + '</div></div>');
      h.push('<div class="row"><label>Size</label>' + num("s", s.s || 1, 0.05) + '</div>');
    } else {
      h.push('<div class="row"><label>Points</label><span>' + G.anchorCount(s) + '</span></div>');
      h.push('<div class="row"><label></label><label style="width:auto"><input type="checkbox" data-f="closed"' + (G.isClosed(s) ? " checked" : "") + '> closed shape</label></div>');
      h.push('<div class="btns"><button type="button" class="btn small" data-act="smooth" title="Curve through every point">Smooth</button>' +
             '<button type="button" class="btn small" data-act="straight" title="Straight lines between points">Straighten</button>' +
             '<button type="button" class="btn small" data-act="simplify" title="Remove points from straight-edged outlines, a step at a time">Simplify</button></div>' +
             (G.anchorCount(s) > 90 ? '<p class="note">Too many points to show handles. Simplify to edit points.</p>' : ''));
    }
  }
  h.push('<div class="btns">' +
    '<button type="button" class="btn small" data-act="dup">Duplicate</button>' +
    '<button type="button" class="btn small" data-act="mirror">Mirror</button>' +
    '<button type="button" class="btn small" data-act="mirrorx" title="A mirrored copy across the centre line (x = 0)">Mirror copy</button>' +
    '<button type="button" class="btn small" data-act="combine" title="Merge into one solid shape in the colour of the lowest; strokes become solid (Ctrl+E)">Combine</button>' +
    (sel.length > 1 ? '<button type="button" class="btn small" data-act="cutout" title="Cut the upper shapes out of the lowest one">Cut out</button>' : '') +
    '<button type="button" class="btn small" data-act="front">To front</button>' +
    '<button type="button" class="btn small" data-act="back">To back</button>' +
    '<button type="button" class="btn small danger" data-act="del">Delete</button></div>');
  return h.join("");
}

function setShapeField(f, v, el) {
  const list = app.shapes;
  if (!list) return;
  if (f === "fill" || f === "stroke") {
    if (v === "mixed") return;
    editSel(s => {
      if (s.t === "eye") return s;
      if (v) { s[f] = v; if (f === "stroke" && !s.w) s.w = W.brush; } else delete s[f];
      if (!s.fill && !s.stroke) s.fill = v || firstKey();
      return s;
    });
    if (v) W[f === "fill" ? "lastFill" : "lastStroke"] = v;
    return;
  }
  if (f === "cap") return editSel(s => { if (s.t === "eye") return s; if (v) s.cap = "round"; else delete s.cap; return s; });
  if (f === "show") return editSel(s => { if (v === "alive" || v === "dead") s.show = v; else delete s.show; return s; });
  if (f === "closed") return editSel(s => {
    if (s.t !== "path") return s;
    const closed = G.isClosed(s);
    if (el.checked && !closed) { s.d.push(["Z"]); if (!s.fill) s.fill = W.lastFill in app.def.pal ? W.lastFill : firstKey(); }
    if (!el.checked && closed) s.d.pop();
    return s;
  });
  if (f === "chord") return editSel(s => { if (el.checked) s.chord = true; else delete s.chord; return s; });
  const n = Number(v);
  if (!isFinite(n)) return;
  const rad = n * Math.PI / 180;
  editSel(s => {
    if (f === "x" || f === "y") { const d = n - s[f]; return G.mapShape(s, G.translateM(f === "x" ? d : 0, f === "y" ? d : 0)); }
    if (f === "rx" || f === "ry") s[f] = Math.max(0.002, n);
    if (f === "rotd") s.rot = G.R5(rad);
    if (f === "a0d") s.a0 = G.R5(rad);
    if (f === "a1d") s.a1 = G.R5(rad);
    if (f === "s") s.s = Math.max(0.1, n);
    return s;
  });
}

function coloursTab() {
  const pal = app.def.pal, use = {};
  for (const list of [app.def.swim, app.def.portrait || []]) for (const s of list) for (const k of [s.fill, s.stroke]) if (k) use[k] = (use[k] || 0) + 1;
  const h = !hued(W.kind) ? ['<p class="note">' + (wears(W.kind) ? "A hat keeps its colours on every pet." : "The coin keeps its colours everywhere.") + '</p>'] : ['<div class="row"><label>Test hue</label><input type="range" data-f="hue" min="0" max="359" value="' + W.hue + '"><span class="val">' + W.hue + '</span>' +
             '<button type="button" class="btn small" data-act="hue-rand" title="Random hue">&#127922;</button></div><div class="hue-bar"></div>' +
             '<p class="note"><b>Pet colour</b> follows the hue each catch gets in the game, shifted by the amount set. <b>Fixed</b> never changes (beaks, eyes, teeth).</p>'];
  for (const [k, c] of Object.entries(pal)) {
    const sw = colourOf(pal, k, W.hue);
    h.push('<div class="pal-item" data-pk="' + esc(k) + '"><div class="pal-top"><span class="sw" style="background:' + sw + '"></span>' +
      '<input type="text" data-pf="name" data-focus="pn-' + esc(k) + '" value="' + esc(k) + '" title="Colour name">' +
      (!hued(W.kind) ? '<span class="dim">fixed</span>' :
       '<select data-pf="kind"><option value="hue"' + (c.hue ? " selected" : "") + '>Pet colour</option><option value="fixed"' + (c.hue ? "" : " selected") + '>Fixed</option></select>') +
      '<span class="use" title="Shapes using it">' + (use[k] || 0) + '</span></div><div class="pal-body">');
    if (c.hue) {
      h.push(palRange("dh", "Shift", c.dh, -180, 180, 1) + palRange("s", "Sat", c.s, 0, 100, 1) + palRange("l", "Light", c.l, 0, 100, 1) + palRange("a", "Alpha", c.a ?? 1, 0, 1, 0.01));
    } else {
      const { hex, a } = parseFixed(c.c);
      h.push('<div class="row"><label>Colour</label><input type="color" data-pf="hex" value="' + hex + '">' + '</div>' + palRange("fa", "Alpha", a, 0, 1, 0.01));
    }
    h.push('<div class="btns"><button type="button" class="btn small" data-pact="fill" title="Fill the selected shapes">Fill</button>' +
           '<button type="button" class="btn small" data-pact="stroke" title="Stroke the selected shapes">Stroke</button>' +
           '<button type="button" class="btn small danger" data-pact="del"' + (use[k] ? ' disabled title="In use"' : '') + '>Remove</button></div></div></div>');
  }
  h.push('<div class="btns"><button type="button" class="btn small" data-act="pal-add">Add colour</button></div>');
  return h.join("");
}
function palRange(f, label, v, lo, hi, step) {
  return '<div class="row"><label>' + label + '</label><input type="range" data-pf="' + f + '" min="' + lo + '" max="' + hi + '" step="' + step + '" value="' + v + '"><span class="val">' + v + '</span></div>';
}
function parseFixed(c) {
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/i.exec(c || "");
  const hx = n => Number(n).toString(16).padStart(2, "0");
  if (m) return { hex: "#" + hx(m[1]) + hx(m[2]) + hx(m[3]), a: m[4] ? Number(m[4]) : 1 };
  let h = (c || "#000000").slice(1);
  if (h.length === 3) h = h.split("").map(x => x + x).join("");
  return { hex: "#" + h.slice(0, 6), a: h.length === 8 ? Math.round(parseInt(h.slice(6), 16) / 2.55) / 100 : 1 };
}
function fixedOf(hex, a) {
  if (a >= 1) return { c: hex };
  const n = parseInt(hex.slice(1), 16);
  return { c: "rgba(" + (n >> 16) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")" };
}

function setPalField(key, f, v, final) {
  const pal = app.def.pal, c = pal[key];
  if (!c) return;
  if (f === "name") {
    const nk = String(v).trim();
    if (nk === key) return;
    if (!KEY_OK.test(nk) || pal[nk]) { toast("Use a new name: letters, digits, - or _, up to 16."); renderPanels(); return; }
    change(() => {
      const next = {};
      for (const [k, val] of Object.entries(pal)) next[k === key ? nk : k] = val;
      app.def.pal = next;
      for (const list of [app.def.swim, app.def.portrait || []]) for (const s of list) { if (s.fill === key) s.fill = nk; if (s.stroke === key) s.stroke = nk; }
    });
    return;
  }
  if (f === "kind") {
    change(() => {
      if (v === "hue" && !c.hue) pal[key] = { hue: 1, dh: 0, s: 62, l: 58, a: 1 };
      if (v === "fixed" && c.hue) pal[key] = { c: hslHex(((W.hue + c.dh) % 360 + 360) % 360, c.s, c.l) };
    });
    return;
  }
  begin();
  if (f === "hex") pal[key] = fixedOf(v, parseFixed(c.c).a);
  else if (f === "fa") pal[key] = fixedOf(parseFixed(c.c).hex, Number(v));
  else c[f] = Number(v);
  if (final) commit(); else live();
}
function hslHex(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l), f = n => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return "#" + [f(0), f(8), f(4)].map(x => Math.round(x * 255).toString(16).padStart(2, "0")).join("");
}

function hatTab() {
  const k = W.kind, p = W.pets[k];
  const about = {
    crown: "Worn by the day&rsquo;s leader who met their goal. The origin is each pet&rsquo;s crown spot, so draw the hat sitting on it. The same drawing makes the small icons over the glasses and on the leaderboard.",
    jester: "Worn by the day&rsquo;s leader who is still under goal. The origin is each pet&rsquo;s crown spot, so draw the hat sitting on it. The same drawing makes the small icons over the glasses and on the leaderboard.",
    grave: "Stands in a drained glass where a pet drowned, and marks buried pets on the Pets tab. The origin is the ground under it, in units of the pet&rsquo;s size. Pet colours take a tint of the drowned pet&rsquo;s hue.",
    coin: "One token, face on: 1 unit across, origin at its centre. The bank&rsquo;s gold pile lays it flat in a heap; the shop and history use it as the small coin icon."
  }[k] || (HOLIDAY_OF[k] ? "Worn in place of the " + (HOLIDAY_OF[k].role === "crown" ? "crown (leader who met their goal)" : "jester hat (leader still under goal)") +
    " from the day before " + esc(HOLIDAY_OF[k].h.name) + " to the day after. The origin is each pet&rsquo;s crown spot; the same drawing makes the small hat icons."
    : isCup(k) ? "Style shop cup item. Units are the glass&rsquo;s inside width; the origin is " + CUP_AT[(CUP_PLACE[k.slice(6)] || {}).at || "bottom"] +
      ", and the dashed box is the inside of the glass. Anything past the walls is cut off on the page. Fixed colours."
    : isFx(k) ? "One particle of the " + esc(COSMETICS[k].name) + " effect, in units of the pet&rsquo;s size, centred on the origin. The effect moves and fades it; " +
      "pet colours follow the colour the effect gives each particle." : "");
  return '<h4>' + esc(HAT_NAMES[k]) + '</h4><p class="note">' + about + '</p>' +
    (wears(k) ? '<div class="row"><label>Try on</label><select data-f="tryon">' + [...Array(C.PET_MAX).keys()].map(i =>
      '<option value="' + i + '"' + (i === W.tryOn ? " selected" : "") + '>' + esc(C.PET_NAMES[i]) + '</option>').join("") + '</select></div>' : '') +
    '<div class="sep"></div><h4>Start over</h4><div class="btns">' +
    '<button type="button" class="btn small" data-act="clear">Clear drawing</button>' +
    '<button type="button" class="btn small danger" data-act="reset"' + (p.edited ? '' : ' disabled') + '>Back to built-in</button></div>';
}

function petTab() {
  if (isHat(W.kind)) return hatTab();
  const k = W.kind, d = app.def, p = W.pets[k], r = rarityOf(k);
  return '<h4>' + esc(baseName(k)) + ' <span class="dim">#' + k + ' &middot; ' + esc(r.name) + '</span></h4>' +
    '<div class="row"><label>Name</label><input type="text" data-f="name" data-focus="name" maxlength="24" placeholder="' + esc(baseName(k)) + '" value="' + esc(d.name || "") + '"></div>' +
    '<p class="note">Leave blank to keep &ldquo;' + esc(baseName(k)) + '&rdquo;. A new name shows on the site.</p>' +
    '<div class="grid2"><div class="row"><label>Crown</label>' + num("cx", d.crown[0]) + '</div><div class="row"><label>&nbsp;</label>' + num("cy", d.crown[1]) + '</div></div>' +
    '<p class="note">Turn on <b>Crown</b> above to see it; drag the gold diamond to move it.</p>' +
    '<div class="grid2"><div class="row"><label>Effect spot</label>' + num("fxx", fxSpot(d)[0]) + '</div><div class="row"><label>&nbsp;</label>' + num("fxy", fxSpot(d)[1]) + '</div></div>' +
    '<p class="note">Where shop effects (sparkles, hearts, aura...) centre. ' + (d.fx ? 'Set by hand. <button type="button" class="btn small" data-act="fx-auto">Back to auto</button>'
      : 'Auto: the middle of the part above the water.') + ' Turn on <b>Effect</b> above to see it; drag the pink ring to move it.</p>' +
    '<div class="row"><label>Swim range</label><input type="number" data-f="range" data-focus="range" min="0" max="100" step="5" value="' +
      Math.round((d.range !== undefined ? d.range : 1) * 100) + '"><span class="val">%</span></div>' +
    '<p class="note">How far it wanders, as a share of the normal range. Lower it so a big creature moves less; ' +
    'drag the dashed lines on the canvas to set it. A pet that reaches past them swims less anyway.</p>' +
    '<div class="sep"></div><h4>Portrait</h4><p class="note">' + (d.portrait ? 'This pet has its own full-body portrait.' : 'None: the Pets tab and unlock cards use the swim drawing.') + '</p>' +
    '<div class="btns">' + (d.portrait ? '<button type="button" class="btn small danger" data-act="port-del">Remove portrait</button>'
                                       : '<button type="button" class="btn small" data-act="port-copy">Copy swim to portrait</button><button type="button" class="btn small" data-act="port-blank">Blank portrait</button>') + '</div>' +
    '<div class="sep"></div><h4>Start over</h4><div class="btns">' +
    '<button type="button" class="btn small" data-act="clear">Clear ' + (W.pose === "portrait" ? "portrait" : "swim") + ' drawing</button>' +
    '<button type="button" class="btn small danger" data-act="reset"' + (p.edited ? '' : ' disabled') + ' title="Back to the built-in drawing">Back to built-in</button></div>' +
    (p.edited && !d.swim.length ? '<p class="note" style="color:var(--warn)">The swim drawing is empty, so this pet is not saved and keeps its built-in look.</p>' : '');
}

function refTab() {
  const ref = app.ref;
  const h = ['<h4>Reference image</h4><p class="note">A picture to trace over, for this pet&rsquo;s ' + W.pose + ' drawing. It stays in this browser and is never exported.</p>',
             '<div class="btns"><button type="button" class="btn small" data-act="ref-load">Load image&hellip;</button>' +
             (ref ? '<button type="button" class="btn small danger" data-act="ref-del">Remove</button>' : '') + '</div>'];
  if (ref) {
    h.push('<div class="row"><label>Opacity</label><input type="range" data-rf="op" min="0.05" max="1" step="0.05" value="' + ref.op + '"><span class="val">' + ref.op + '</span></div>');
    h.push('<div class="row"><label>Width</label><input type="range" data-rf="w" min="0.2" max="6" step="0.05" value="' + ref.w + '"><span class="val">' + ref.w + ' r</span></div>');
    h.push('<div class="grid2"><div class="row"><label>X</label><input type="number" data-rf="x" step="0.01" value="' + ref.x + '"></div><div class="row"><label>Y</label><input type="number" data-rf="y" step="0.01" value="' + ref.y + '"></div></div>');
    h.push('<div class="row"><label></label><label style="width:auto"><input type="checkbox" data-act="ref-drag"' + (W.refDrag ? " checked" : "") + '> drag the image with the Select tool</label></div>');
  }
  h.push('<input type="file" id="refFile" accept="image/*" hidden>');
  return h.join("");
}

function renderLayers() {
  const list = app.shapes, el = $("layers");
  if (!list) { el.innerHTML = '<p class="note" style="padding:6px">No portrait drawing.</p>'; return; }
  const pal = app.def.pal, h = [];
  for (let i = list.length - 1; i >= 0; i--) {
    const s = list[i];
    const label = s.t === "eye" ? "Eye" : s.t === "ell" ? ((s.a1 ?? G.TAU) - (s.a0 ?? 0) < 6.28 ? (s.chord ? "Dome" : "Arc") : Math.abs(s.rx - s.ry) < 1e-4 ? "Circle" : "Ellipse")
                : G.isClosed(s) ? "Shape · " + G.anchorCount(s) + " pts" : "Line · " + G.anchorCount(s) + " pts";
    const col = s.t === "eye" ? "#2a2118" : colourOf(pal, s.fill || s.stroke, W.hue);
    h.push('<div class="layer' + (W.sel.has(i) ? " on" : "") + '" data-i="' + i + '" draggable="true">' +
      '<span class="ix">' + (i + 1) + '</span><span class="sw' + (!s.fill && s.stroke ? " stroke" : "") + '" style="background:' + col + ';border-color:' + col + '"></span>' +
      '<span class="ln">' + label + (s.t !== "eye" ? ' <span class="dim">' + esc([s.fill, s.stroke].filter(Boolean).join(" / ")) + '</span>' : '') + '</span>' +
      (s.show ? '<span class="tag ' + s.show + '">' + (s.show === "dead" ? "drowned" : "alive") + '</span>' : '') + '</div>');
  }
  el.innerHTML = h.join("") || '<p class="note" style="padding:6px">Nothing drawn yet.</p>';
}

function renderPoseNote() {
  const n = $("poseNote");
  if (W.pose === "portrait" && !app.def.portrait) {
    n.hidden = false;
    n.innerHTML = 'No portrait: the Pets tab uses the swim drawing (shown faint). ' +
      '<button type="button" class="btn small" data-act="port-copy">Copy swim</button><button type="button" class="btn small" data-act="port-blank">Start blank</button>';
  } else n.hidden = true;
}

/* ---- actions from buttons --------------------------------------------------------- */
function act(a, el) {
  const d = app.def;
  switch (a) {
    case "dup": return duplicateSel();
    case "mirror": return mirrorSel();
    case "mirrorx": return duplicateSel(G.scaleM(0, 0, -1, 1));
    case "combine": return combineSel(false);
    case "cutout": return combineSel(true);
    case "front": return reorder(2);
    case "back": return reorder(-2);
    case "del": return deleteSel();
    case "smooth": return editSel(s => { if (s.t === "path") G.smoothAll(s); return s; });
    case "straight": return editSel(s => { if (s.t === "path") G.straightenAll(s); return s; });
    case "simplify": {
      let n = 0;
      editSel(s => { if (s.t === "path" && G.simplifyPath(s)) n++; return s; });
      if (!n) toast("Nothing more to remove without changing the shape much.");
      return;
    }
    case "hue-rand": W.hue = Math.floor(Math.random() * 360); renderPanels(); editor.redraw(); return;
    case "pal-add": return change(() => { let n = 1; while (d.pal["colour" + n]) n++; d.pal["colour" + n] = !hued(W.kind) ? { c: "#9aa5ad" } : { hue: 1, dh: 0, s: 62, l: 58, a: 1 }; });
    case "port-copy": return change(() => { d.portrait = G.clone(d.swim); W.pose = "portrait"; W.sel.clear(); });
    case "port-blank": return change(() => { d.portrait = []; W.pose = "portrait"; W.sel.clear(); });
    case "port-del": if (confirm("Remove this pet's portrait drawing?")) change(() => { d.portrait = null; W.sel.clear(); }); return;
    case "clear": if (confirm("Clear the " + W.pose + " drawing? Undo can bring it back.")) change(() => { app.shapes.length = 0; W.sel.clear(); }); return;
    case "reset":
      if (!confirm("Put the " + baseName(W.kind) + " back to its built-in drawing? Undo can bring your drawing back.")) return;
      change(() => { W.pets[W.kind].def = G.clone(W.builtin[W.kind]); W.sel.clear(); });
      W.pets[W.kind].edited = false; changed();
      return;
    case "fx-auto": return change(() => { app.def.fx = null; });
    case "ref-load": return $("refFile").click();
    case "ref-del": delete (W.refs[W.kind] || {})[W.pose]; W.refDrag = false; autosave(); renderPanels(); editor.redraw(); return;
    case "ref-drag": W.refDrag = el.checked; if (W.refDrag) setTool("select"); return;
  }
}

function setTool(t) {
  if (t !== W.tool) editor.cancelDraft();
  W.tool = t;
  renderPanels();
  editor.redraw();
}
function setKind(k) {
  if (k === W.kind) return;
  editor.cancelDraft();
  W.kind = k; W.sel.clear(); W.pending = null;
  if (isHat(k)) W.pose = "swim";
  renderAll();
  editor.fit();
}
function setPose(p) { if (isHat(W.kind) && p === "portrait") { toast("A hat or prop has one drawing."); return; } W.pose = p; W.sel.clear(); editor.cancelDraft(); renderAll(); editor.fit(); }

let toastTimer = 0;
function toast(msg) {
  let el = document.querySelector(".toast");
  if (!el) { el = document.createElement("div"); el.className = "toast"; document.body.appendChild(el); }
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3800);
}

/* ---- wiring ---------------------------------------------------------------------- */
let editor, preview;

function wire() {
  $("toolbar").addEventListener("click", e => {
    const t = e.target.closest("[data-tool]"); if (t) setTool(t.dataset.tool);
    const p = e.target.closest("[data-pose]"); if (p) setPose(p.dataset.pose);
  });
  $("sideTabs").addEventListener("click", e => { const b = e.target.closest("[data-tab]"); if (b) { W.tab = b.dataset.tab; renderPanels(); } });
  $("petList").addEventListener("click", e => {
    const t = e.target.closest("[data-sec-toggle]");
    if (t) { const sec = t.closest(".pen-sec"); toggleSection(sec, sec.classList.contains("shut")); return; }
    const b = e.target.closest("[data-kind]"); if (b) setKind(itemKey(b.dataset.kind));
  });
  $("brush").addEventListener("input", e => { W.brush = Number(e.target.value) / 100; $("brushVal").textContent = e.target.value; });
  $("brushVal").textContent = Math.round(W.brush * 100);
  for (const [id, key] of [["tWater", "water"], ["tDead", "dead"], ["tCrown", "crown"], ["tFx", "fx"], ["tSnap", "snap"]]) {
    $(id).checked = W[key];
    $(id).addEventListener("change", e => { W[key] = e.target.checked; editor.redraw(); renderLayers(); });
  }
  $("undoBtn").onclick = () => undo(false);
  $("redoBtn").onclick = () => undo(true);
  $("fitBtn").onclick = () => editor.fit();
  $("saveBtn").onclick = saveToRepo;
  $("folderBtn").onclick = () => pickSaveFolder();
  $("exportBtn").onclick = exportFile;
  $("openBtn").onclick = () => $("openFile").click();
  $("openFile").addEventListener("change", e => { if (e.target.files[0]) openFile(e.target.files[0]); e.target.value = ""; });
  $("themeBtn").onclick = () => {
    const cur = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("pet-studio-theme", next); } catch { }
    editor.redraw(); renderLayers();
  };
  $("poseNote").addEventListener("click", e => { const b = e.target.closest("[data-act]"); if (b) act(b.dataset.act, b); });

  /* side panel */
  const body = $("tabBody");
  body.addEventListener("click", e => {
    const b = e.target.closest("[data-act]");
    if (b && b.tagName === "BUTTON") return act(b.dataset.act, b);
    const pb = e.target.closest("[data-pact]");
    if (pb) {
      const key = pb.closest("[data-pk]").dataset.pk;
      if (pb.dataset.pact === "fill" || pb.dataset.pact === "stroke") { if (!W.sel.size) toast("Select shapes first."); else setShapeField(pb.dataset.pact, key); }
      else if (pb.dataset.pact === "del") change(() => { delete app.def.pal[key]; });
    }
  });
  body.addEventListener("input", e => {
    const t = e.target;
    if (t.dataset.f === "hue") { W.hue = Number(t.value); t.nextElementSibling.textContent = t.value; editor.redraw(); refreshSwatches(); return; }
    if (t.dataset.f === "w" && t.type === "range") {
      t.nextElementSibling.textContent = Number(t.value).toFixed(1);
      begin();
      for (const i of W.sel) { const s = app.shapes[i]; if (s && s.t !== "eye") { s.w = Number(t.value) / 100; if (!s.stroke) s.stroke = app.lastStroke; } }
      W.brush = Number(t.value) / 100;
      live();
      return;
    }
    if (t.dataset.pf && t.type === "range") { t.nextElementSibling.textContent = t.value; setPalField(t.closest("[data-pk]").dataset.pk, t.dataset.pf, t.value, false); refreshSwatches(); return; }
    if (t.dataset.pf === "hex") { setPalField(t.closest("[data-pk]").dataset.pk, "hex", t.value, false); refreshSwatches(); return; }
    if (t.dataset.rf && t.type === "range") { app.ref[t.dataset.rf] = Number(t.value); t.nextElementSibling.textContent = t.value + (t.dataset.rf === "w" ? " r" : ""); editor.redraw(); return; }
  });
  body.addEventListener("change", e => {
    const t = e.target;
    if (t.dataset.f === "hue") return;
    if (t.dataset.f === "w") { commit(); return; }
    if (t.dataset.f === "tryon") { W.tryOn = Number(t.value); editor.redraw(); return; }
    if (t.dataset.f === "name") { const v = t.value.trim(); change(() => { if (v && v !== baseName(W.kind)) app.def.name = v.slice(0, 24); else app.def.name = ""; }); return; }
    if (t.dataset.f === "range") { const n = Number(t.value); if (isFinite(n)) change(() => { app.def.range = Math.max(0, Math.min(1, n / 100)); }); return; }
    if (t.dataset.f === "fxx" || t.dataset.f === "fxy") {
      const n = Number(t.value);
      if (isFinite(n)) change(() => { const s = fxSpot(app.def).slice(); s[t.dataset.f === "fxx" ? 0 : 1] = n; app.def.fx = s; });
      return;
    }
    if (t.dataset.f === "cx" || t.dataset.f === "cy") { const n = Number(t.value); if (isFinite(n)) change(() => { app.def.crown[t.dataset.f === "cx" ? 0 : 1] = n; }); return; }
    if (t.dataset.f) { setShapeField(t.dataset.f, t.value, t); return; }
    if (t.dataset.pf) {
      const key = t.closest("[data-pk]").dataset.pk;
      if (t.type === "range" || t.dataset.pf === "hex") { if (W.pending !== null) commit(); return; }
      setPalField(key, t.dataset.pf, t.value, true);
      return;
    }
    if (t.dataset.rf) { app.ref[t.dataset.rf] = Number(t.value); autosave(); editor.redraw(); return; }
    if (t.dataset.act === "ref-drag") { act("ref-drag", t); return; }
    if (t.id === "refFile" && t.files[0]) {
      const fr = new FileReader();
      fr.onload = () => {
        (W.refs[W.kind] || (W.refs[W.kind] = {}))[W.pose] = { src: fr.result, x: 0, y: W.pose === "swim" ? -0.4 : 0, w: 2, op: 0.45 };
        autosave(); renderPanels(); editor.redraw();
      };
      fr.readAsDataURL(t.files[0]);
    }
  });

  /* layers: click to select, drag to reorder */
  const layers = $("layers");
  let dragFrom = -1;
  layers.addEventListener("click", e => {
    const row = e.target.closest("[data-i]"); if (!row) return;
    const i = Number(row.dataset.i);
    if (e.shiftKey || e.ctrlKey) { if (W.sel.has(i)) W.sel.delete(i); else W.sel.add(i); } else { W.sel.clear(); W.sel.add(i); }
    renderPanels(); editor.redraw();
  });
  layers.addEventListener("dragstart", e => { const row = e.target.closest("[data-i]"); dragFrom = row ? Number(row.dataset.i) : -1; });
  layers.addEventListener("dragover", e => {
    e.preventDefault();
    for (const r of layers.querySelectorAll(".drop-above")) r.classList.remove("drop-above");
    const row = e.target.closest("[data-i]"); if (row) row.classList.add("drop-above");
  });
  layers.addEventListener("drop", e => {
    e.preventDefault();
    const row = e.target.closest("[data-i]");
    if (!row || dragFrom < 0) return;
    const to = Number(row.dataset.i);
    if (to === dragFrom) { renderLayers(); return; }
    change(() => {
      const list = app.shapes, [s] = list.splice(dragFrom, 1);
      list.splice(dragFrom < to ? to : to + 1, 0, s);          /* lands just above the row it was dropped on */
      W.sel.clear(); W.sel.add(list.indexOf(s));
    });
    dragFrom = -1;
  });

  /* keys */
  window.addEventListener("keydown", e => {
    const tag = e.target.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") { if (e.key === "Escape") e.target.blur(); return; }
    const k = e.key, ctrl = e.ctrlKey || e.metaKey;
    if (k === " ") { editor.space = true; e.preventDefault(); return; }
    if (editor.key(e)) { e.preventDefault(); return; }
    if (ctrl && k.toLowerCase() === "z") { e.preventDefault(); undo(e.shiftKey); return; }
    if (ctrl && k.toLowerCase() === "y") { e.preventDefault(); undo(true); return; }
    if (ctrl && k.toLowerCase() === "s") { e.preventDefault(); saveToRepo(); return; }
    if (ctrl && k.toLowerCase() === "d") { e.preventDefault(); duplicateSel(); return; }
    if (ctrl && k.toLowerCase() === "e") { e.preventDefault(); combineSel(false); return; }
    if (ctrl && k.toLowerCase() === "c") { copySel(); return; }
    if (ctrl && k.toLowerCase() === "v") { paste(); return; }
    if (ctrl && k.toLowerCase() === "a") { e.preventDefault(); W.sel = new Set((app.shapes || []).map((_, i) => i)); renderPanels(); editor.redraw(); return; }
    if (ctrl) return;
    if (k === "Delete" || k === "Backspace") { deleteSel(); e.preventDefault(); return; }
    if (k === "Escape") { if (W.sel.size) { W.sel.clear(); renderPanels(); editor.redraw(); } else setTool("select"); return; }
    const tools = { v: "select", o: "ellipse", p: "poly", c: "pen", f: "free", l: "line", y: "eye" };
    if (tools[k.toLowerCase()]) { setTool(tools[k.toLowerCase()]); return; }
    if (k === "0") { editor.fit(); return; }
    if (k === "[" || k === "]") { reorder((k === "]" ? 1 : -1) * (e.shiftKey ? 2 : 1)); return; }
    if (k === "{" || k === "}") { reorder(k === "}" ? 2 : -2); return; }
    if (k === "m") { mirrorSel(); return; }
    if (k === "M") { duplicateSel(G.scaleM(0, 0, -1, 1)); return; }
    const step = e.shiftKey ? 0.05 : 0.01, arrows = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (arrows[k] && W.sel.size) { e.preventDefault(); nudge(...arrows[k]); }
  });
  window.addEventListener("keyup", e => { if (e.key === " ") editor.space = false; });
  window.addEventListener("beforeunload", e => { if (W.dirty) { e.preventDefault(); e.returnValue = ""; } });
}

function refreshSwatches() {
  for (const it of document.querySelectorAll(".pal-item")) it.querySelector(".sw").style.background = colourOf(app.def.pal, it.dataset.pk, W.hue);
  editor.redraw();
}

/* ---- start -------------------------------------------------------------------- */
async function start() {
  try { const t = localStorage.getItem("pet-studio-theme"); if (t) document.documentElement.dataset.theme = t; } catch { }
  $("rev").textContent = REV;
  W.builtin = importAll();
  for (const key of HAT_KEYS) W.builtin[key] = hatDef(importHat(key));
  resetItems();
  try { W.dirHandle = (await idb.get("dir")) || null; } catch { }
  let note = "";
  try { const obj = await readSaved(); loadFileObj(obj); W.base = itemsOf(obj); } catch (e) { note = "pets.json could not be read: " + (e.message || e); }
  try {
    const draft = await idb.get("draft");
    if (draft && draft.refs) W.refs = draft.refs;
    if (draft && draft.dirty) {
      resetItems();
      for (const [k, def] of Object.entries(draft.pets || {})) W.pets[k] = { def: normalize(def), edited: true };
      W.dirty = true;
      markTouched();
      note = "Unsaved work from last time is back. Save to repo when ready.";
    }
  } catch { }
  syncDefs();
  editor = new Editor($("editor"), app);
  preview = new Preview($("preview"), app);
  wire();
  renderAll();
  editor.fit();
  if (note) toast(note);
  setInterval(() => { watchFile().catch(() => { }); }, WATCH_MS);
  window.STUDIO = { W, app, editor, petsJson, syncDefs, watchFile };     /* for checks from the console */
}

start();
