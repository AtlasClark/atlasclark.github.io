/* Safety nets: the daily backup, and the file list the update check reloads. */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { skipReason, readDataFiles, backupDay, dayKeys, setToday, loadWeb, web } from "./lib/bridge.mjs";

const TOOL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../tools/water-challenge");
const C = web.C;

test("backup: every .json copied byte for byte into _backup/<day>, once a day", { skip: skipReason }, async () => {
  const files = readDataFiles(), day = dayKeys(backupDay(files), "2099-01-01")[1];
  setToday(day);
  const { mem } = await loadWeb(files);
  const n = await web.store.backupIfDue(day);
  const json = [...files.keys()].filter(f => f.toLowerCase().endsWith(".json"));
  assert.equal(n, json.length);
  const snap = mem._d.get(C.BACKUP_SUBDIR)._d.get(day);
  for (const f of json) assert.deepEqual(snap._f.get(f).bytes, new Uint8Array(files.get(f)), f);
  assert.ok(snap._f.has("_done"));
  assert.equal(await web.store.backupIfDue(day), 0, "a day already backed up is skipped");
  assert.ok(![...mem._f.keys()].some(f => f.startsWith("_done")), "nothing extra in the data folder");
});

test("backup: days older than the keep window are cleared, newer ones stay", { skip: skipReason }, async () => {
  const files = readDataFiles(), day = dayKeys(backupDay(files), "2099-01-01")[1];
  setToday(day);
  const { mem } = await loadWeb(files);
  const root = await mem.getDirectoryHandle(C.BACKUP_SUBDIR, { create: true });
  const old = web.util.shiftKey(day, -(C.BACKUP_KEEP_DAYS + 1)), recent = web.util.shiftKey(day, -2);
  for (const d of [old, recent]) {
    const h = await root.getDirectoryHandle(d, { create: true });
    await h.getFileHandle("_done", { create: true });
  }
  await root.getDirectoryHandle("notes", { create: true });       /* not a dated folder: left alone */
  await web.store.backupIfDue(day);
  const left = [...mem._d.get(C.BACKUP_SUBDIR)._d.keys()].sort();
  assert.deepEqual(left, [recent, day, "notes"].sort());
});

test("update check: SITE_FILES lists every file the page is made of", () => {
  const js = fs.readdirSync(path.join(TOOL, "js")).filter(f => f.endsWith(".js")).map(f => "js/" + f).sort();
  const listed = C.SITE_FILES.filter(f => f.startsWith("js/")).sort();
  assert.deepEqual(listed, js, "a module missing here would stay stale after an update");
  assert.ok(C.SITE_FILES.includes("./") && C.SITE_FILES.includes("app.css"));
  const html = fs.readFileSync(path.join(TOOL, "index.html"), "utf8");
  assert.match(html, /connect-src 'self'/, "same-site fetch is allowed for the check");
  assert.match(fs.readFileSync(path.join(TOOL, "js/config.js"), "utf8"), /export const REV\s*=\s*"rev [\d.]+"/,
               "the check reads REV with this pattern");
});
