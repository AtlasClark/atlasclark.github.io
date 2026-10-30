/* Cloud admin cards in Settings (rev 1.38.0): access codes, and the cloud's data
   (import from a folder or a backup file, backups, people taken off the roster).
   Shown only to an admin code. What a code may do is checked again by the Worker. */

import * as C from "./config.js";
import * as store from "./store.js";
import * as cloud from "./cloud.js";
import { S, knownUsers } from "./model.js";
import { ui, setMsg } from "./ui.js";
import { $, esc } from "./util.js";

let H = { askConfirm: async () => false, refreshNow: async () => { } };
const cardsOn = () => !!store.cloud && cloud.isAdmin();
const ago = ms => {
  if (!ms) return "never used";
  const m = Math.round((Date.now() - ms) / 60000);
  return m < 2 ? "used just now" : m < 90 ? "used " + m + " min ago" : m < 2880 ? "used " + Math.round(m / 60) + " h ago" : "used " + Math.round(m / 1440) + " days ago";
};
const kb = n => n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";
const fileDay = d => String(d).replace(/[^0-9A-Za-z-]+/g, "_");

/* Body classes and card visibility for who is signed in. A folder page has no roles. */
export function applyRole() {
  const c = !!store.cloud, admin = !c || cloud.isAdmin(), art = !c || cloud.canArt();
  ui.admin = admin;
  document.body.classList.toggle("cloud", c);
  document.body.classList.toggle("not-admin", !admin);
  for (const k of ["challenge", "goals"]) document.querySelector('.sp-card[data-card="' + k + '"]').hidden = !admin;
  document.querySelector('.sp-card[data-card="pets"]').hidden = !art;
  $("spFoot").hidden = !admin;
  $("codesCard").hidden = $("cloudCard").hidden = !(c && admin);
  $("studioLink").href = c ? "studio/?cloud" : "studio/";
}

/* Called when Settings opens. */
export function fillCloudCards() {
  if (!cardsOn()) return;
  const users = knownUsers().map(u => u.user);
  $("ncUsers").innerHTML = users.map(u => '<option value="' + esc(u) + '"></option>').join("");
  const keep = $("ncGlass").value;
  $("ncGlass").innerHTML = '<option value="">No glass</option>' +
    S.participants.map(p => '<option value="' + esc(p.name) + '">' + esc(p.name) + '</option>').join("");
  if ([...$("ncGlass").options].some(o => o.value === keep)) $("ncGlass").value = keep;
  if ($("codesCard").open) listCodes();
  if ($("cloudCard").open) listData();
}

async function listCodes() {
  try {
    const list = (await cloud.codes()).filter(c => !c.revoked);
    $("codesCount").textContent = list.length;
    $("codeList").innerHTML = list.length ? list.map(c =>
      '<div class="mini-row" data-id="' + esc(c.id) + '"><span class="rn" title="' + esc(c.user) + '">' + esc(c.user) +
      (c.glass ? ' <span class="dim">&middot; ' + esc(c.glass) + '</span>' : '') + '</span>' +
      (c.admin ? '<span class="pill good">admin</span>' : '') + (c.art ? '<span class="pill">art</span>' : '') +
      '<span class="rs">' + esc(ago(c.used)) + '</span>' +
      '<button type="button" class="btn small danger" data-act="revoke">Revoke</button></div>').join("")
      : '<p class="hint">No codes yet. Make one for each person, and one for yourself.</p>';
  } catch (e) { $("codeList").innerHTML = '<p class="hint">Could not list the codes: ' + esc(e.message) + '</p>'; }
}

async function listData() {
  const hour = String(C.BACKUP_HOUR).padStart(2, "0") + ":00";
  try {
    const b = await cloud.backups(), list = b.backups || [];
    $("cloudNote").textContent = "The cloud backs up every file each evening from " + hour + " (team time), " + C.BACKUP_KEEP_DAYS + " days kept." +
      (b.lastBackup ? " Last: " + b.lastBackup + "." : "");
    $("cdBackups").innerHTML = list.length ? '<h5>Backups</h5>' + list.map(x =>
      '<div class="mini-row" data-day="' + esc(x.day) + '"><span class="rn">' + esc(x.day) + '</span><span class="rs">' + x.files + ' files &middot; ' + kb(x.bytes || 0) + '</span>' +
      '<button type="button" class="btn small muted" data-act="get">Download</button>' +
      '<button type="button" class="btn small danger" data-act="restore">Restore</button></div>').join("") : "";
  } catch (e) { $("cloudNote").textContent = "Could not list the backups: " + e.message; }
  try {
    const gone = await cloud.removedList();
    $("cdRemoved").innerHTML = gone.length ? '<h5>Taken off the roster</h5>' + gone.map(r =>
      '<div class="mini-row" data-name="' + esc(r.name) + '" data-at="' + Number(r.at) + '"><span class="rn">' + esc(r.name.replace(/\.json$/, "")) + '</span>' +
      '<span class="rs">' + esc(new Date(r.at).toLocaleDateString()) + (r.by ? ' by ' + esc(r.by) : '') + '</span>' +
      '<button type="button" class="btn small muted" data-act="unremove">Bring back</button></div>').join("") : "";
  } catch { $("cdRemoved").innerHTML = ""; }
}

function download(obj, name) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 1)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function busy(btn, fn) {
  btn.disabled = true;
  try { await fn(); } catch (e) { setMsg(e.message || String(e), false); } finally { btn.disabled = false; }
}

/* ---- import --------------------------------------------------------------------- */
async function sendFiles(list, from) {
  const people = list.filter(f => !f.name.startsWith("_")).length;
  const r = await cloud.importFiles(list, n => setMsg("Importing " + from + ": " + n + " of " + list.length + " files...", true));
  setMsg("Imported " + r.written + " file" + (r.written === 1 ? "" : "s") + " (" + people + " people) from " + from + "." +
         (r.skipped.length ? " Skipped: " + r.skipped.map(s => s.name + " (" + s.why + ")").join("; ") + "." : ""), !r.skipped.length);
  await H.refreshNow();
  return r;
}

async function importFolder() {
  if (typeof window.showDirectoryPicker !== "function") { setMsg("Importing a folder needs Chrome or Edge.", false); return; }
  let h;
  try { h = await window.showDirectoryPicker({ id: "awc-data", mode: "readwrite" }); }
  catch (e) { if (e.name !== "AbortError") setMsg("Could not open the folder: " + (e.message || e), false); return; }
  h = await store.resolveDataDir(h);
  const list = (await store.folderFiles(h)).filter(f => !f.name.startsWith("_") ? f.name !== "pets.json" : [C.SETTINGS_FILE, C.FOLDER_PETS_FILE].includes(f.name));
  const people = list.filter(f => !f.name.startsWith("_")).length;
  if (!people) { setMsg("No one's file is in " + h.name + ". Pick the folder that holds _settings.json.", false); return; }
  const ok = await H.askConfirm("Import " + h.name + "?",
    people + " people and " + (list.length - people) + " other file(s). A file with the same name in the cloud is replaced. " +
    "Then " + h.name + " is marked as moved: pages on it stop writing to it and ask for an access code.", "Import");
  if (!ok) return;
  const r = await sendFiles(list, h.name);
  if (!r.written) return;
  try { await store.markMoved(h, { to: (cloud.config() || {}).url || "", files: r.written }); store.diagNote("marked " + h.name + " as moved"); }
  catch (e) { setMsg("Imported, but " + h.name + " could not be marked as moved (" + (e.message || e) + "). Tell folder users to switch.", false); }
}

async function importBundle(file) {
  let o = null;
  try { o = JSON.parse(await file.text()); } catch { o = null; }
  if (!o || o.format !== C.BUNDLE_FORMAT || !Array.isArray(o.files)) { setMsg(file.name + " is not a Water Challenge backup file.", false); return; }
  const ok = await H.askConfirm("Import " + file.name + "?", o.files.length + " files from " + (o.day || "a backup") +
    ". A file with the same name in the cloud is replaced; people not in the file stay as they are.", "Import");
  if (ok) await sendFiles(o.files.filter(f => f && typeof f.name === "string" && typeof f.body === "string"), file.name);
}

/* ---- wiring --------------------------------------------------------------------- */
export function initCloudUi(hooks) {
  H = Object.assign(H, hooks);
  $("codesCard").addEventListener("toggle", () => { if ($("codesCard").open && cardsOn()) listCodes(); });
  $("cloudCard").addEventListener("toggle", () => { if ($("cloudCard").open && cardsOn()) listData(); });

  $("ncGlass").onchange = () => {                       /* a glass suggests its usual logger */
    const g = $("ncGlass").value;
    if (!g || $("ncUser").value.trim()) return;
    const p = S.participants.find(x => x.name === g), n = {};
    for (const e of (p && p.entries) || []) if (e.by && !C.NOT_USERS.includes(String(e.by).toLowerCase())) n[e.by] = (n[e.by] || 0) + 1;
    const top = Object.keys(n).sort((a, b) => n[b] - n[a])[0];
    if (top) $("ncUser").value = top;
  };
  $("ncMake").onclick = () => busy($("ncMake"), async () => {
    const user = $("ncUser").value.trim(), glass = $("ncGlass").value;
    if (!user) { setMsg("Enter the sign-in name that goes on their pours.", false); $("ncUser").focus(); return; }
    const r = await cloud.makeCode(user, glass, $("ncAdmin").checked, $("ncArt").checked);
    $("ncCode").textContent = r.code;
    $("ncOut").hidden = false;
    $("ncCopy").onclick = async () => {
      try { await navigator.clipboard.writeText(cloud.inviteLink(r.code)); setMsg("Sign-in link for " + r.user + " copied.", true); }
      catch { setMsg("Copy did not work. The link is " + cloud.inviteLink(r.code), true); }
    };
    $("ncUser").value = ""; $("ncAdmin").checked = $("ncArt").checked = false;
    setMsg("Code made for " + r.user + (r.glass ? " (" + r.glass + ")" : "") + ". It is shown once.", true);
    listCodes();
  });
  $("codeList").onclick = e => {
    const b = e.target.closest("[data-act=revoke]"), row = e.target.closest(".mini-row");
    if (!b || !row) return;
    const name = row.querySelector(".rn").title;
    busy(b, async () => {
      if (!(await H.askConfirm("Revoke " + name + "'s code?", "Every browser signed in with it is signed out at once. Make a new code to let them back in.", "Revoke"))) return;
      await cloud.revokeCode(row.dataset.id);
      setMsg(name + "'s code is revoked.", true);
      listCodes();
    });
  };

  $("cdImportDir").onclick = () => busy($("cdImportDir"), importFolder);
  $("cdImportFile").onclick = () => $("cdFile").click();
  $("cdFile").onchange = () => {
    const f = $("cdFile").files[0];
    $("cdFile").value = "";
    if (f) busy($("cdImportFile"), () => importBundle(f));
  };
  $("cdBackupNow").onclick = () => busy($("cdBackupNow"), async () => {
    const r = await cloud.backupNow();
    setMsg("Backed up " + r.files + " files as \"" + r.day + "\".", true);
    listData();
  });
  $("cdDownload").onclick = () => busy($("cdDownload"), async () => {
    const b = await cloud.bundleNow();
    download(b, "water-challenge-backup-" + fileDay(new Date().toISOString().slice(0, 16)) + ".json");
    setMsg("Downloaded " + b.files.length + " files. Keep the file out of the repo.", true);
  });
  $("cdBackups").onclick = e => {
    const b = e.target.closest("[data-act]"), row = e.target.closest(".mini-row");
    if (!b || !row) return;
    const day = row.dataset.day;
    busy(b, async () => {
      if (b.dataset.act === "get") {
        const r = await cloud.backup(day);
        download({ format: C.BUNDLE_FORMAT, rev: C.REV, day, files: r.files }, "water-challenge-backup-" + fileDay(day) + ".json");
        return;
      }
      if (!(await H.askConfirm("Restore " + day + "?", "Every file in that backup goes back as it was then: pours and shop records since then are lost for those people. " +
                                                        "A backup of now is taken first.", "Restore"))) return;
      const r = await cloud.restore(day);
      setMsg("Restored " + r.files + " files from " + day + ".", true);
      await H.refreshNow();
      listData();
    });
  };
  $("cdRemoved").onclick = e => {
    const b = e.target.closest("[data-act=unremove]"), row = e.target.closest(".mini-row");
    if (!b || !row) return;
    busy(b, async () => {
      await cloud.unremove(row.dataset.name, Number(row.dataset.at));
      setMsg(row.dataset.name.replace(/\.json$/, "") + " is back on the roster.", true);
      await H.refreshNow();
      listData();
    });
  };
}
