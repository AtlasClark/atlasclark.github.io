/* The shared folder, through the File System Access API (Chrome/Edge). The folder
   handle and identity are kept in IndexedDB on this origin only; challenge data never
   leaves the share.

   File rules, for every page on the folder:
   - JSON in UTF-16 LE with BOM.
   - Sidecar "<file>.lock" files, stolen after LOCK_STALE_MS.
   - Read-merge-write inside the lock, so a stale view never paints over a pour.
   - Fields this build does not know are kept, so a newer build's data survives. */

import * as C from "./config.js";
import { S, dataChanged, currentGoalFor, currentGoal, currentAnnualGoal, currentIdleMax,
         goalTunables, legacyFlat, challengeStart, forceLegacyStamps, personalGoal,
         defaultSettings } from "./model.js";
import { todayKey, localStamp, parseKey, has, shiftKey } from "./util.js";

export let dir = null;          /* FileSystemDirectoryHandle of the data folder */
export const diag = { trail: [], lastError: "", permission: "", writes: 0, lockSteals: 0, lastBackup: "" };

export function setDir(h) { dir = h; }

function note(line) {
  diag.trail.push(new Date().toTimeString().slice(0, 8) + "  " + line);
  if (diag.trail.length > 60) diag.trail.shift();
}
export { note as diagNote };

/* ---- one write path at a time ------------------------------------------- */
let chain = Promise.resolve();
export function serial(fn) {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}

/* ---- IndexedDB key/value (handle + identity) ---------------------------- */
const DB = "atlasWaterWeb", STORE = "kv";
function openDb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
export async function kvGet(k) {
  const db = await openDb();
  return new Promise((res, rej) => {
    const q = db.transaction(STORE, "readonly").objectStore(STORE).get(k);
    q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
  });
}
export async function kvSet(k, v) {
  const db = await openDb();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(v, k);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
export async function kvDel(k) {
  const db = await openDb();
  return new Promise(res => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(k);
    tx.oncomplete = () => res(); tx.onerror = () => res();
  });
}

/* ---- encoding ----------------------------------------------------------- */
export function decodeBytes(buf) {
  const b = new Uint8Array(buf);
  if (b.length >= 2 && b[0] === 0xFF && b[1] === 0xFE) return new TextDecoder("utf-16le").decode(b.subarray(2));
  if (b.length >= 2 && b[0] === 0xFE && b[1] === 0xFF) return new TextDecoder("utf-16be").decode(b.subarray(2));
  if (b.length >= 3 && b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) return new TextDecoder("utf-8").decode(b.subarray(3));
  return new TextDecoder("utf-8").decode(b);
}
export function encodeUtf16le(str) {
  const out = new Uint8Array(2 + str.length * 2);
  out[0] = 0xFF; out[1] = 0xFE;
  const dv = new DataView(out.buffer);
  for (let i = 0; i < str.length; i++) dv.setUint16(2 + i * 2, str.charCodeAt(i), true);
  return out;
}

/* ---- raw file access ---------------------------------------------------- */
async function fileOrNull(name, d = dir) {
  try { return await d.getFileHandle(name); } catch { return null; }
}
async function readText(name) {
  const fh = await dir.getFileHandle(name);
  return decodeBytes(await (await fh.getFile()).arrayBuffer());
}
async function writeText(name, text, d = dir) {
  const fh = await d.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(encodeUtf16le(text));
  await w.close();            /* the swap file replaces the target in one move */
  diag.writes++;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* The API has no create-if-absent, so this is check, create, then read back our
   token. The merge inside the lock covers the rest. */
async function withLock(fileName, fn) {
  const lockName = fileName + ".lock";
  const token = "web " + (S.me || "?") + " " + Date.now() + " " + Math.random().toString(36).slice(2);
  let tries = 0;
  while (tries < C.LOCK_RETRIES) {
    const existing = await fileOrNull(lockName);
    if (existing) {
      let age = 0;
      try { age = Date.now() - (await existing.getFile()).lastModified; } catch { age = 0; }
      if (age > C.LOCK_STALE_MS) {
        try { await dir.removeEntry(lockName); diag.lockSteals++; note("stole stale lock " + lockName); } catch { }
        continue;
      }
      await sleep(C.LOCK_WAIT_MS); tries++; continue;
    }
    try {
      const fh = await dir.getFileHandle(lockName, { create: true });
      const w = await fh.createWritable();
      await w.write(token + "\r\n");
      await w.close();
      const back = await (await fh.getFile()).text();
      if (back.indexOf(token) === 0) break;          /* ours */
    } catch { /* lost the race; retry */ }
    await sleep(C.LOCK_WAIT_MS); tries++;
  }
  if (tries >= C.LOCK_RETRIES) { note("lock busy: " + fileName); return false; }
  try { await fn(); }
  finally { try { await dir.removeEntry(lockName); } catch { } }
  return true;
}

/* ---- names -------------------------------------------------------------- */
export function safeFileName(name) { return String(name).replace(/[\\\/:\*\?"<>\|\.]/g, "_"); }
export function participantFileName(name) { return safeFileName(name) + ".json"; }

/* ---- serialisers --------------------------------------------------------- */
const q = s => JSON.stringify(String(s === undefined || s === null ? "" : s).replace(/[\r\n]/g, " "));
function mapJson(map) {
  const out = [];
  if (map) for (const k in map) if (has(map, k)) out.push(q(k) + ": " + Number(map[k]));
  return out.join(", ");
}
function awayJson(list) {
  return (list || []).map(a => "[" + q(a[0]) + ", " + q(a[1] || "") + "]").join(", ");
}
const n1 = v => Number(v === undefined || v === null ? C.PET_NO_PET : v);

export function petKindFor(p) {
  const k = Number(p.equippedPet);
  return (isFinite(k) && k >= 0 && k < C.PET_MAX) ? k : C.PET_NO_PET;
}

/* Fields this build does not know (written by a newer build) ride along untouched. */
function extraFields(p) {
  return Object.keys(p).filter(k => !k.startsWith("_") && !C.KNOWN_FIELDS.includes(k));
}

export function toJson(p) {
  const out = [], spends = p.spends || [];
  out.push('{\n  "name": ' + q(p.name) + ',');
  out.push('\n  "color": ' + q(p.color) + ',');
  out.push('\n  "goal": ' + Number(currentGoalFor(p)) + ',');
  out.push('\n  "dayGoals": {' + mapJson(p.dayGoals) + '},');
  out.push('\n  "away": [' + awayJson(p.away) + '],');
  out.push('\n  "created": ' + q(p.created || todayKey()) + ',');
  out.push('\n  "equippedPet": ' + Number(petKindFor(p)) + ',');
  out.push('\n  "petRollDay": ' + q(p.petRollDay || "") + ',');
  out.push('\n  "pets": {' + mapJson(p.pets) + '},');
  out.push('\n  "graves": {' + mapJson(p.graves) + '},');
  out.push('\n  "graveDay": ' + q(p.graveDay || "") + ',');
  out.push('\n  "lastRoll": ' + n1(p.lastRoll) + ',');
  out.push('\n  "prevRoll": ' + n1(p.prevRoll) + ',');
  out.push('\n  "rollKind": ' + n1(p.rollKind) + ',');
  out.push('\n  "rollWasNew": ' + (p.rollWasNew ? "true" : "false") + ',');
  out.push('\n  "deadKind": ' + n1(p.deadKind) + ',');
  out.push('\n  "tokensSpent": ' + spends.reduce((a, s) => a + (Number(s.cost) || 0), 0) + ',');
  out.push('\n  "rerollDay": ' + q(p.rerollDay || "") + ',');
  out.push('\n  "rollLog": ' + JSON.stringify(p.rollLog || {}) + ',');
  out.push('\n  "graveLog": ' + JSON.stringify(p.graveLog || {}) + ',');
  out.push('\n  "spends": [' + spends.map(s => '\n    ' + JSON.stringify(s)).join(",") + (spends.length ? '\n  ' : '') + '],');
  for (const k of extraFields(p)) out.push('\n  ' + JSON.stringify(k) + ': ' + JSON.stringify(p[k]) + ',');
  out.push('\n  "writerRev": ' + C.FORMAT_REV + ',');
  out.push('\n  "writerVersion": ' + q(C.APP_VERSION) + ',');
  out.push('\n  "writerUser": ' + q(S.me) + ',');
  out.push('\n  "writtenAt": ' + q(localStamp(new Date())) + ',');
  out.push('\n  "entries": [');
  p.entries.forEach((e, i) => {
    out.push((i ? "," : "") + '\n    {"eid": ' + q(e.eid) + ', "ts": ' + q(e.ts) +
             ', "date": ' + q(e.date) + ', "oz": ' + Number(e.oz) +
             ', "by": ' + q(e.by || "") + (e.sid ? ', "sid": ' + q(e.sid) : "") + '}');
  });
  out.push('\n  ]\n}\n');
  return out.join("");
}

export function deriveEid(e, seen) {
  const base = "e:" + (e.date || "") + ":" + (e.ts || "") + ":" + Number(e.oz) + ":" + (e.by || "");
  let id = base, k = 0;
  while (seen[id]) { k++; id = base + "#" + k; }
  return id;
}

/* ---- merges ------------------------------------------------------------- */
export function mergePets(memMap, diskMap, removed) {
  const out = {}, drop = {};
  for (const r of removed || []) drop[String(r)] = true;
  if (diskMap) for (const k in diskMap) if (has(diskMap, k) && !drop[k]) out[k] = Number(diskMap[k]);
  if (memMap) for (const k in memMap) if (has(memMap, k) && !drop[k] && !has(out, k)) out[k] = Number(memMap[k]);
  return out;
}

/* Periods are keyed by start day; a closed period beats an open one. */
export function mergeAway(mem, disk) {
  const by = {}, order = [];
  for (const list of [disk || [], mem || []]) {
    for (const a of list) {
      if (!a || !a[0]) continue;
      const cur = by[a[0]];
      if (!cur) { by[a[0]] = [a[0], a[1] || ""]; order.push(a[0]); continue; }
      if (!cur[1] && a[1]) cur[1] = a[1];
      else if (cur[1] && a[1] && a[1] < cur[1]) cur[1] = a[1];
    }
  }
  order.sort();
  return order.map(k => by[k]);
}

function mergeWithDisk(p, disk, removedIds, removedPets, revivedPets, clearRoll) {
  const out = { name: p.name, color: p.color, created: p.created, equippedPet: petKindFor(p),
                petRollDay: p.petRollDay || "", graveDay: p.graveDay || "",
                lastRoll: n1(p.lastRoll), prevRoll: n1(p.prevRoll), rollKind: n1(p.rollKind),
                rollWasNew: !!p.rollWasNew, deadKind: n1(p.deadKind),
                pets: null, graves: null, dayGoals: null, away: null, entries: [] };
  const seen = {}, drop = {};
  for (const id of removedIds || []) drop[id] = true;

  out.pets = mergePets(p.pets, disk ? disk.pets : null, removedPets);
  out.dayGoals = mergePets(p.dayGoals, disk ? disk.dayGoals : null, null);
  out.away = mergeAway(p.away, disk ? disk.away : null);
  forceLegacyStamps(out.dayGoals);
  out.graves = mergePets(p.graves, disk ? disk.graves : null, revivedPets);
  /* Spends are a log keyed by id, merged like entries, so two windows spending for
     the same person at once both count. The day logs take this window's value for a
     day it changed; rerollDay only moves forward. */
  const spendSeen = {};
  out.spends = [];
  for (const s of [...(p.spends || []), ...((disk && disk.spends) || [])]) {
    if (s && s.id && !spendSeen[s.id]) { spendSeen[s.id] = true; out.spends.push(s); }
  }
  out.spends.sort((a, b) => String(a.at) < String(b.at) ? -1 : String(a.at) > String(b.at) ? 1 : 0);
  out.tokensSpent = out.spends.reduce((a, s) => a + (Number(s.cost) || 0), 0);
  out.rollLog = Object.assign({}, (disk && disk.rollLog) || {}, p.rollLog || {});
  out.graveLog = Object.assign({}, (disk && disk.graveLog) || {}, p.graveLog || {});
  out.rerollDay = [p.rerollDay || "", (disk && disk.rerollDay) || ""].sort().pop();
  for (const k of extraFields(p)) out[k] = p[k];
  if (disk) for (const k of extraFields(disk)) if (!(k in out)) out[k] = disk[k];
  if (disk && disk.graveDay > out.graveDay) out.graveDay = disk.graveDay;
  /* A roll recorded on disk today wins, unless this write is taking it back. */
  if (!clearRoll && disk && disk.petRollDay > out.petRollDay) {
    out.petRollDay = disk.petRollDay;
    out.equippedPet = Number(disk.equippedPet) || 0;
  }
  for (const e of p.entries) {
    if (!e.eid) e.eid = deriveEid(e, seen);
    if (drop[e.eid] || seen[e.eid]) continue;
    seen[e.eid] = true;
    out.entries.push(e);
  }
  if (disk && disk.entries) {
    for (const e of disk.entries) {
      if (!e.eid) e.eid = deriveEid(e, seen);
      if (drop[e.eid] || seen[e.eid]) continue;
      seen[e.eid] = true;
      out.entries.push(e);
    }
  }
  return out;
}

/* Returns true when the write landed. */
export async function saveParticipant(p, removedIds, removedPets, revivedPets, clearRoll) {
  if (!dir) return false;
  const name = participantFileName(p.name);
  try {
    return await withLock(name, async () => {
      let disk = null;
      try { if (await fileOrNull(name)) disk = JSON.parse(await readText(name)); } catch { disk = null; }
      const merged = mergeWithDisk(p, disk, removedIds, removedPets, revivedPets, clearRoll);
      await writeText(name, toJson(merged));
      p.entries = merged.entries;
      p.pets = merged.pets;
      p.graves = merged.graves;
      p.dayGoals = merged.dayGoals;
      p.away = merged.away;
      p.tokensSpent = merged.tokensSpent;
      p.spends = merged.spends;
      p.rollLog = merged.rollLog;
      p.graveLog = merged.graveLog;
      p.rerollDay = merged.rerollDay;
      dataChanged();
    });
  } catch (e) {
    diag.lastError = "save " + name + ": " + (e.name || "") + " " + (e.message || e);
    note(diag.lastError);
    return false;
  }
}

/* ---- settings ----------------------------------------------------------- */
export async function loadSettings() {
  S.settings = defaultSettings();
  if (!dir) return;
  try {
    if (!(await fileOrNull(C.SETTINGS_FILE))) return;
    const raw = await readText(C.SETTINGS_FILE);
    if (!raw) return;
    const o = JSON.parse(raw), s = S.settings;
    if (!o) return;
    if (isFinite(Number(o.dailyGoalOz)) && Number(o.dailyGoalOz) > 0) s.dailyGoalOz = Number(o.dailyGoalOz);
    if (o.goalSetAt) s.goalSetAt = String(o.goalSetAt);
    if (isFinite(Number(o.annualGoalOz)) && Number(o.annualGoalOz) > 0) s.annualGoalOz = Number(o.annualGoalOz);
    if (o.startDate && parseKey(o.startDate)) s.startDate = String(o.startDate);
    if (isFinite(Number(o.idleSkipDays)) && Number(o.idleSkipDays) >= 0) s.idleSkipDays = Math.floor(Number(o.idleSkipDays));
    if (Number(o.minGoalOz) > 0) s.minGoalOz = Number(o.minGoalOz);
    if (Number(o.goalFactor) > 0) s.goalFactor = Number(o.goalFactor);
    if (Number(o.minGoalDays) > 0) s.minGoalDays = Math.floor(Number(o.minGoalDays));
    if (o.dropTopDay !== undefined) s.dropTopDay = !!o.dropTopDay;
    if (Number(o.goalWindowDays) > 0) s.goalWindowDays = Math.floor(Number(o.goalWindowDays));
    if (o.legacyFlatUntil !== undefined) s.legacyFlatUntil = String(o.legacyFlatUntil);
    if (Number(o.legacyGoalOz) > 0) s.legacyGoalOz = Number(o.legacyGoalOz);
    if (typeof o.title === "string") s.title = o.title.trim().slice(0, C.TITLE_MAX);
    if (typeof o.tagline === "string") s.tagline = o.tagline.trim().slice(0, C.TAGLINE_MAX);
    if (o.minGoalOz === undefined || o.goalFactor === undefined || o.minGoalDays === undefined ||
        o.dropTopDay === undefined || o.goalWindowDays === undefined || o.legacyFlatUntil === undefined) {
      await saveSettings();
    }
  } catch (e) { note("settings unreadable: " + (e.message || e)); }
}

export async function saveSettings() {
  const t = goalTunables(), L = legacyFlat();
  const body = '{\n  "dailyGoalOz": ' + Number(S.settings.dailyGoalOz) +
    ',\n  "annualGoalOz": ' + Number(currentAnnualGoal()) +
    ',\n  "startDate": ' + q(challengeStart()) +
    ',\n  "idleSkipDays": ' + currentIdleMax() +
    ',\n  "minGoalOz": ' + t.minOz +
    ',\n  "goalFactor": ' + t.factor +
    ',\n  "minGoalDays": ' + t.minDays +
    ',\n  "dropTopDay": ' + (t.dropTop ? "true" : "false") +
    ',\n  "goalWindowDays": ' + t.window +
    ',\n  "legacyFlatUntil": ' + q(L.until) +
    ',\n  "legacyGoalOz": ' + Number(L.goal) +
    ',\n  "goalSetAt": ' + q(S.settings.goalSetAt || "") +
    ',\n  "formatRev": ' + C.FORMAT_REV +
    (S.settings.title ? ',\n  "title": ' + q(S.settings.title) : '') +
    (S.settings.tagline ? ',\n  "tagline": ' + q(S.settings.tagline) : '') +
    ',\n  "updatedBy": ' + q(S.me) +
    ',\n  "updatedAt": ' + q(localStamp(new Date())) + '\n}\n';
  try {
    return await withLock(C.SETTINGS_FILE, () => writeText(C.SETTINGS_FILE, body));
  } catch (e) {
    diag.lastError = "save settings: " + (e.message || e);
    note(diag.lastError);
    return false;
  }
}

/* ---- loading ------------------------------------------------------------ */
export async function loadAll() {
  const list = [], prev = {};
  S.newerRevSeen = false; S.loadRecovered = 0; S.loadFailed = 0;
  if (!dir) return list;
  /* A file caught mid-write falls back to the last good copy, so nobody drops out
     of the day index for a poll and hands their wins to second place. */
  for (const p of S.participants) prev[participantFileName(p.name)] = p;

  for await (const [name, h] of dir.entries()) {
    if (h.kind !== "file") continue;
    if (!name.toLowerCase().endsWith(".json") || name.charAt(0) === "_") continue;
    try {
      const raw = decodeBytes(await (await h.getFile()).arrayBuffer());
      if (raw === "") throw new Error("empty file");
      const o = JSON.parse(raw);
      if (!o || !o.name) throw new Error("no name field");
      if (!o.entries) o.entries = [];
      if (!o.pets || typeof o.pets !== "object") o.pets = {};
      if (!o.graves || typeof o.graves !== "object") o.graves = {};
      if (!o.dayGoals || typeof o.dayGoals !== "object") o.dayGoals = {};
      if (!o.away || !o.away.length) o.away = [];
      if (!o.petRollDay) o.petRollDay = "";
      if (!o.graveDay) o.graveDay = "";
      for (const f of ["lastRoll", "prevRoll", "rollKind", "deadKind", "equippedPet"]) {
        if (o[f] === undefined || o[f] === null) o[f] = C.PET_NO_PET;
      }
      if (o.rollWasNew === undefined) o.rollWasNew = false;
      if (!Array.isArray(o.spends)) o.spends = [];
      if (!o.rollLog || typeof o.rollLog !== "object") o.rollLog = {};
      if (!o.graveLog || typeof o.graveLog !== "object") o.graveLog = {};
      if (!o.rerollDay) o.rerollDay = "";
      if (!o.color) o.color = C.PARTICIPANT_COLORS[list.length % C.PARTICIPANT_COLORS.length];
      const seen = {};
      for (const e of o.entries) {
        if (!e.eid) e.eid = deriveEid(e, seen);
        seen[e.eid] = true;
      }
      o.goal = personalGoal(o, todayKey());
      list.push(o);
    } catch (e) {
      if (prev[name]) { list.push(prev[name]); S.loadRecovered++; }
      else { S.loadFailed++; note("unreadable " + name + ": " + (e.message || e)); }
    }
  }
  /* A file from a newer format: this page is out of date (the banner says reload). */
  S.newerRevSeen = list.some(o => Number(o.writerRev) > C.FORMAT_REV);
  list.sort((a, b) => a.name < b.name ? -1 : 1);
  return list;
}

/* Cheap change detector: name + size + mtime of every file. */
export async function folderSignature() {
  if (!dir) return "offline";
  let sig = "";
  for await (const [name, h] of dir.entries()) {
    if (h.kind !== "file") continue;
    try { const f = await h.getFile(); sig += name + "|" + f.size + "|" + f.lastModified + ";"; }
    catch { sig += name + "|?;"; }
  }
  return sig;
}

/* ---- the folder's own pet art -------------------------------------------- */
/* { sig } with obj when the folder has a readable FOLDER_PETS_FILE, error when it
   is there but not JSON. sig changes whenever the file does. */
export async function readFolderPets() {
  const h = dir && await fileOrNull(C.FOLDER_PETS_FILE);
  if (!h) return { sig: "" };
  const f = await h.getFile(), sig = f.size + "|" + f.lastModified;
  try { return { sig, obj: JSON.parse(decodeBytes(await f.arrayBuffer())) }; }
  catch (e) { return { sig, error: e.message || String(e) }; }
}

/* ---- roster files ------------------------------------------------------- */
export async function participantExists(name) {
  return !!(await fileOrNull(participantFileName(name)));
}

/* Moved, not erased: a copy goes to _removed/<name>_<date>.json, then the original
   is taken out of the data folder. */
export async function moveToRemoved(name) {
  const src = participantFileName(name);
  const sub = await dir.getDirectoryHandle(C.REMOVED_SUBDIR, { create: true });
  const destName = safeFileName(name) + "_" + todayKey() + ".json";
  const fh = await dir.getFileHandle(src);
  const bytes = new Uint8Array(await (await fh.getFile()).arrayBuffer());
  const dh = await sub.getFileHandle(destName, { create: true });
  const w = await dh.createWritable();
  await w.write(bytes);
  await w.close();
  const check = await (await dh.getFile()).arrayBuffer();
  if (check.byteLength !== bytes.length) throw new Error("copy to " + C.REMOVED_SUBDIR + " did not verify");
  await dir.removeEntry(src);
  return destName;
}

/* ---- daily backup -------------------------------------------------------- */
/* Copies every .json in the data folder, byte for byte, into _backup/<key>/, then
   writes _done. A day already marked done is skipped, so only the first page of the
   day does the work. Returns the number of files copied, or 0 when skipped. */
export async function backupIfDue(key) {
  if (!dir) return 0;
  const root = await dir.getDirectoryHandle(C.BACKUP_SUBDIR, { create: true });
  let day = null;
  try { day = await root.getDirectoryHandle(key); } catch { }
  if (day && await fileOrNull("_done", day)) { diag.lastBackup = key; return 0; }
  if (!day) day = await root.getDirectoryHandle(key, { create: true });
  let n = 0;
  for await (const [name, h] of dir.entries()) {
    if (h.kind !== "file" || !name.toLowerCase().endsWith(".json")) continue;
    const bytes = new Uint8Array(await (await h.getFile()).arrayBuffer());
    const out = await day.getFileHandle(name, { create: true });
    const w = await out.createWritable();
    await w.write(bytes);
    await w.close();
    n++;
  }
  await writeText("_done", localStamp(new Date()) + " " + (S.me || "") + " " + n + " files\r\n", day);
  const oldest = shiftKey(key, -C.BACKUP_KEEP_DAYS);
  for await (const [name, h] of root.entries()) {
    if (h.kind === "directory" && /^\d{4}-\d{2}-\d{2}$/.test(name) && name < oldest) {
      try { await root.removeEntry(name, { recursive: true }); } catch (e) { note("could not clear backup " + name + ": " + (e.message || e)); }
    }
  }
  diag.lastBackup = key;
  note("backup " + key + ": " + n + " files");
  return n;
}

/* ---- live shop events ---------------------------------------------------- */
/* Plinko drops go into _live/ as small UTF-8 files. Every open shop lists the folder
   every LIVE_POLL_MS and replays what it has not seen. The subfolder keeps these out
   of the data folder's change signature. */
async function liveDir() { return dir.getDirectoryHandle(C.LIVE_SUBDIR, { create: true }); }

export async function writeLive(ev) {
  if (!dir) return false;
  try {
    const d = await liveDir();
    const fh = await d.getFileHandle("ev-" + ev.at + "-" + liveFileId(ev.id) + ".json", { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify(ev));
    await w.close();
    pruneLive(d);
    return true;
  } catch (e) { note("live write failed: " + (e.message || e)); return false; }
}

/* Ids like "s:abc" carry a colon, which Windows does not allow in a file name. */
export const liveFileId = id => String(id).replace(/[^A-Za-z0-9_-]/g, "_");

async function pruneLive(d) {
  const now = Date.now();
  for await (const [name, h] of d.entries()) {
    const m = /^(?:ev|drop)-(\d+)-/.exec(name);
    if (h.kind === "file" && m && now - Number(m[1]) > C.LIVE_KEEP_MS) { try { await d.removeEntry(name); } catch { } }
  }
}

/* Events newer than sinceMs (writer's clock, from the file name), oldest first.
   seen holds liveFileId()s of events already handled. */
export async function readLive(sinceMs, seen) {
  if (!dir) return [];
  const out = [];
  try {
    const d = await liveDir();
    for await (const [name, h] of d.entries()) {
      const m = /^(?:ev|drop)-(\d+)-(.+)\.json$/.exec(name);
      if (h.kind !== "file" || !m || Number(m[1]) < sinceMs || (seen && seen.has(m[2]))) continue;
      try { out.push(JSON.parse(await (await h.getFile()).text())); } catch { }
    }
  } catch (e) { note("live read failed: " + (e.message || e)); }
  return out.sort((a, b) => a.at - b.at);
}

/* ---- connection --------------------------------------------------------- */
export async function permissionOf(h, ask) {
  if (!h || !h.queryPermission) return "granted";      /* dev harness handles */
  let p = await h.queryPermission({ mode: "readwrite" });
  if (p !== "granted" && ask) p = await h.requestPermission({ mode: "readwrite" });
  diag.permission = p;
  return p;
}

/* If someone picks the folder that holds data\, step into it. */
export async function resolveDataDir(h) {
  let jsons = 0, hasSettings = false, sub = null;
  for await (const [name, e] of h.entries()) {
    if (e.kind === "file" && name.toLowerCase().endsWith(".json")) { jsons++; if (name === C.SETTINGS_FILE) hasSettings = true; }
    if (e.kind === "directory" && name.toLowerCase() === "data") sub = e;
  }
  if (!hasSettings && jsons === 0 && sub) { note("stepped into data\\ under " + h.name); return sub; }
  return h;
}

