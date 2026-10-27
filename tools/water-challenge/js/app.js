/* Boot, connection, actions and polling. Every write goes through serial(), so a
   poll can never interleave with a pour, and every change is followed by the same
   reconcile pass (stamp finished days, settle today's pet events) before render. */

import * as C from "./config.js";
import { S, dataChanged, findParticipant, knownUsers, matchUser, totalOn, metGoal, currentGoalFor, streaks, isActive,
         stampDayGoals, currentGoal, currentAnnualGoal, currentIdleMax, challengeStart, challengeEnd } from "./model.js";
import * as store from "./store.js";
import { reconcilePets, equipPet } from "./pets.js";
import { rollCardQueued } from "./reveal.js";
import * as G from "./glass.js";
import { startLive, onLive, emit } from "./live.js";
import { loadPetDefs, useFolderDefs, useSiteDefs } from "./petdefs.js";
import { bottleOn, bottleCfg, signedIn, loadBottle, setRelay, newRelayKey, pingRelay, signIn, signOut, fetchSips, applySips } from "./bottle.js";
import { openRadial, wireRadial } from "./radial.js";
import { initShop, renderShop, shopTabChanged } from "./shopui.js";
import { shellsEarned, earnedTotal } from "./shop.js";
import { isHydrationDay } from "./hydration.js";
import { goalWave } from "./hydfx.js";
import { ui, render, setTab, setMsg, showBanner, tickMasks, relayout, forceRebuild, resetIcons,
         toggleSwatches, openBank, auditStreak, showDiag, closeOverlays, fillSettings, renderRoster,
         renderActivityNow, showUnlock, uiHooks, htaDismiss } from "./ui.js";
import { $, esc, bus, todayKey, localStamp, fmt, fmtOz, trim, parseKey, shiftKey, clockStamp } from "./util.js";

let lastSig = "", pollTimer = 0;

/* ---- bus wiring --------------------------------------------------------- */
bus.msg = setMsg;
bus.drown = (name, kind, hue) => G.startSink(name, kind, hue);
bus.petReset = name => { const st = G.animState(name); st.duckState = 0; st.shownKind = -99; };
/* Unlock cards play here and on every other open page (through the live channel).
   One card per person, pet and day: if two machines both notice the same goal, it
   still shows once. */
const cardsShown = new Set();
function playUnlock(info) {
  const key = info.name + "|" + info.kind + "|" + (info.bought ? "buy" : "roll") + "|" + todayKey();
  if (cardsShown.has(key)) { if (info.msg) setMsg(info.msg, true); return; }
  cardsShown.add(key);
  if (!info.bought) rollCardQueued(info.name);       /* the roll stays hidden until the card closes */
  if (!info.bought && isHydrationDay()) goalWave();  /* someone reached their goal */
  if (info.equipped) G.dropIn(info.name, 12);       /* held off-screen until the card closes */
  setTimeout(() => showUnlock(info), G.pourLeft(info.name) * 1000 + 150);
}
bus.unlock = info => { const { msg, ...shared } = info; emit("unlock", { info: shared }); playUnlock(info); };
onLive("unlock", (ev, late) => { if (late < C.LIVE_SHOW_MS && ev.info) playUnlock(ev.info); pollSoon(); });
/* Someone else poured: play the stream now and fetch the new level straight away. */
onLive("pour", (ev, late) => { if (late < C.LIVE_SHOW_MS) G.pour(ev.name, ev.oz, ev.color); pollSoon(); });

/* ---- theme -------------------------------------------------------------- */
const THEMES = ["auto", "light", "dark"];
function applyTheme(t) {
  if (t === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
  $("themeBtn").title = "Theme: " + t + " (click to change)";
  $("themeBtn").dataset.mode = t;
}
function initTheme() {
  let t = "auto";
  try { t = localStorage.getItem("awc-theme") || "auto"; } catch { }
  applyTheme(THEMES.includes(t) ? t : "auto");
  $("themeBtn").onclick = () => {
    const next = THEMES[(THEMES.indexOf($("themeBtn").dataset.mode) + 1) % THEMES.length];
    applyTheme(next);
    try { localStorage.setItem("awc-theme", next); } catch { }
  };
}

/* ---- reconcile + refresh ------------------------------------------------ */
async function reconcile() {
  let wrote = false;
  for (const p of S.participants) {
    if (stampDayGoals(p) && await store.saveParticipant(p, null)) wrote = true;
  }
  if (wrote) dataChanged();
  await reconcilePets();
}

let backedUp = "";               /* the evening this page last made sure a backup exists */

/* A _pets.json in the data folder replaces the site's pet art for that folder. */
let petSig = "";
async function syncFolderPets() {
  let r;
  try { r = await store.readFolderPets(); } catch (e) { store.diagNote("pet art: " + (e.message || e)); return; }
  if (r.sig === petSig) return;
  petSig = r.sig;
  if (r.obj) { useFolderDefs(r.obj); store.diagNote("pet art from " + C.FOLDER_PETS_FILE); }
  else {
    if (r.error) store.diagNote(C.FOLDER_PETS_FILE + " is not valid JSON, so the site's art is used: " + r.error);
    useSiteDefs();
  }
  resetIcons();
  forceRebuild();
}

/* The evening backup (store.backupSlot): checked on every load and every poll, so a page
   left open past BACKUP_HOUR takes it even when nothing has changed. */
async function maybeBackup() {
  const slot = store.backupSlot();
  if (backedUp === slot) return;
  try { await store.backupIfDue(slot); backedUp = slot; }
  catch (e) { store.diagNote("backup failed: " + (e.message || e)); }
}

async function refresh() {
  await store.loadSettings();
  S.participants = await store.loadAll();
  try { await store.noteHtaWriters(); } catch (e) { store.diagNote("HTA log: " + (e.message || e)); }
  dataChanged();
  await syncFolderPets();
  await maybeBackup();
  await reconcile();
  lastSig = await store.folderSignature();
  ui.lastSync = clockStamp();
  safeRender();
}

/* A drawing bug is logged, not taken for a lost folder (the poll's catch would show
   the reconnect gate and stop polling). */
function safeRender() {
  try { render(); } catch (e) { store.diagNote("render failed: " + (e && e.message || e)); }
}

/* After a local change: settle pet events, then repaint. */
async function settle() {
  await reconcile();
  lastSig = await store.folderSignature();
  ui.lastSync = clockStamp();
  safeRender();
}

/* A live event means the files just changed: read them now instead of waiting. */
let soonWanted = false;          /* survives a refresh that was already running */
function pollSoon() {
  if (!ui.connected) return;
  soonWanted = true;
  clearTimeout(pollTimer);
  pollTimer = setTimeout(poll, 250);
}

function schedulePoll() {
  clearTimeout(pollTimer);
  const ms = soonWanted ? 250 : document.hidden ? C.POLL_HIDDEN_MS : C.POLL_MS;
  soonWanted = false;
  pollTimer = setTimeout(poll, ms);
}

async function poll() {
  if (!ui.connected) return;
  try {
    await store.serial(async () => {
      const sig = await store.folderSignature();
      if (sig !== lastSig) await refresh();
      else { await maybeBackup(); await reconcile(); ui.lastSync = clockStamp(); safeRender(); }
    });
    showBanner("");
  } catch (e) {
    store.diagNote("poll failed: " + (e.name || "") + " " + (e.message || e));
    ui.connected = false;
    render();
    showGate("lost", e);
    return;
  }
  schedulePoll();
}

/* ---- gate: choosing and reconnecting the data folder -------------------- */
function gateTrail() {
  const el = $("gateTrail");
  el.textContent = store.diag.trail.join("\n");
  $("gateDetails").hidden = !store.diag.trail.length;
}

function showGate(mode, err) {
  const g = $("gate"), name = store.dir ? store.dir.name : "data";
  g.hidden = false;
  $("gateWarn").hidden = true;
  $("gateReconnect").hidden = true;
  $("gatePick").hidden = false;
  if (mode === "noapi") {
    $("gateMsg").innerHTML = "This browser can't open shared folders. Use <b>Chrome</b> or <b>Edge</b>.";
    $("gatePick").hidden = true;
  } else if (mode === "reconnect") {
    $("gateMsg").innerHTML = "Confirm access to the <b>" + name + "</b> folder.";
    $("gateReconnect").textContent = "Reconnect to " + name;
    $("gateReconnect").hidden = false;
    $("gatePick").textContent = "Choose a different folder";
  } else if (mode === "lost") {
    $("gateMsg").innerHTML = "Lost the <b>" + name + "</b> folder. The share may be offline.";
    $("gateReconnect").textContent = "Reconnect to " + name;
    $("gateReconnect").hidden = false;
    $("gatePick").textContent = "Choose a different folder";
  } else {
    $("gateMsg").innerHTML = "Pick the challenge's <b>data</b> folder (the one with <code>_settings.json</code>).";
    $("gatePick").textContent = "Choose data folder";
  }
  if (err) { $("gateWarn").textContent = (err.name ? err.name + ": " : "") + (err.message || err); $("gateWarn").hidden = false; }
  gateTrail();
}

async function connect(h) {
  if (h !== store.dir) { backedUp = ""; lastSig = ""; petSig = ""; }   /* another folder: back it up, read it, take its art */
  store.setDir(h);
  if (window.FileSystemHandle && h instanceof window.FileSystemHandle) {
    try { await store.kvSet("dir", h); } catch (e) { store.diagNote("could not remember folder: " + e.message); }
  }
  $("gate").hidden = true;
  ui.connected = true;
  forceRebuild();
  await store.serial(refresh);
  if (!S.me || S.mine === null) await askIdentity(true);   /* asked once; the roster is loaded by now */
  store.diagNote("connected to " + h.name + " (" + S.participants.length + " files)");
  schedulePoll();
  startLive();
}

async function pickFolder() {
  const n = store.diagNote;
  n("choose clicked; API " + (typeof window.showDirectoryPicker) + ", secure " + window.isSecureContext);
  let h;
  try {
    h = await window.showDirectoryPicker({ id: "awc-data", mode: "readwrite" });
    n("picker returned \"" + h.name + "\"");
  } catch (e) {
    n("picker rejected: " + e.name + " - " + e.message);
    if (e.name === "AbortError") { gateTrail(); return; }
    if (e.name === "SecurityError") n("SecurityError usually means a company policy blocks folder access (chrome://policy).");
    showGate(store.dir ? "lost" : "pick", e);
    return;
  }
  try {
    const perm = await store.permissionOf(h, true);
    n("permission: " + perm);
    if (perm !== "granted") { showGate("pick", new Error("Write permission was not granted, so nothing can be saved.")); return; }
    h = await store.resolveDataDir(h);
  } catch (e) {
    n("permission check threw: " + e.name + " - " + e.message);
    showGate("pick", e);
    return;
  }
  await connect(h);
}

async function reconnect() {
  const h = store.dir;
  if (!h) return pickFolder();
  try {
    const perm = await store.permissionOf(h, true);      /* runs inside the click, so Chrome may prompt */
    store.diagNote("reconnect permission: " + perm);
    if (perm === "granted") { await connect(h); return; }
    showGate("reconnect", new Error("Permission was refused. Nothing can be read or written."));
  } catch (e) {
    store.diagNote("reconnect failed: " + e.name + " - " + e.message);
    showGate("reconnect", e);
  }
}

/* ---- identity ----------------------------------------------------------- */
/* Username from the ones already in the data (typed only when new, with a check
   for near-misses), and which glass is this browser's own. */
function askIdentity(first) {
  return new Promise(res => {
    const d = $("whoDialog"), inp = $("whoInput"), warn = $("whoWarn");
    const users = knownUsers();
    const mark = () => {
      for (const b of $("whoList").children) b.classList.toggle("on", b.dataset.user.toLowerCase() === trim(inp.value).toLowerCase());
      warn.hidden = true;
    };
    $("whoList").innerHTML = users.map(u => '<button type="button" class="who-user" data-user="' + esc(u.user) + '">' + esc(u.user) + '</button>').join("");
    $("whoList").onclick = e => {
      const b = e.target.closest("[data-user]");
      if (b) { inp.value = b.dataset.user; mark(); }
    };
    inp.value = S.me && S.me !== "unknown" ? S.me : "";
    inp.oninput = mark;
    mark();
    const mine = S.mine || "";
    $("whoMine").innerHTML = '<option value="">Not on the roster</option>' + S.participants.map(p =>
      '<option value="' + esc(p.name) + '"' + (p.name === mine ? " selected" : "") + '>' + esc(p.name) + '</option>').join("");
    if (S.mine === null) $("whoMine").value = "";
    $("whoCancel").hidden = !!first && !S.me;
    let warned = "";
    d.querySelector("form").onsubmit = e => {
      if (e.submitter && e.submitter.value !== "ok") return;
      const v = trim(inp.value), m = matchUser(v);
      if (m.same) { inp.value = m.same; return; }
      if (m.near && warned !== v) {                    /* stop once, so a typo can't split someone's pours */
        e.preventDefault();
        warned = v;
        warn.innerHTML = '<b>' + esc(v) + '</b> is new. Did you mean <button type="button" class="link" data-user="' + esc(m.near) + '">' +
                         esc(m.near) + '</button>? Save again to keep it.';
        warn.querySelector("button").onclick = () => { inp.value = m.near; mark(); };
        warn.hidden = false;
      }
    };
    d.returnValue = "";
    d.showModal();
    (users.length ? $("whoList").querySelector(".on") || $("whoList").firstChild : inp).focus();
    d.onclose = async () => {
      const v = trim(inp.value);
      if (d.returnValue === "ok" && v) {
        S.me = v;
        S.mine = $("whoMine").value;
        try { await store.kvSet("me", v); await store.kvSet("mine", S.mine); } catch { }
      }
      if (first && S.mine === null) { S.mine = ""; try { await store.kvSet("mine", ""); } catch { } }   /* asked once */
      if (!S.me) S.me = "unknown";
      forceRebuild();
      render();
      res();
    };
  });
}

function askConfirm(title, text, okLabel) {
  return new Promise(res => {
    const d = $("confirmDialog");
    $("confirmTitle").textContent = title;
    $("confirmText").textContent = text;
    $("confirmOk").textContent = okLabel || "OK";
    d.returnValue = "";
    d.showModal();
    d.onclose = () => res(d.returnValue === "ok");
  });
}

/* ---- actions ------------------------------------------------------------ */
/* The last amount picked is offered first next time, in this browser only. */
function rememberAmount(oz) {
  ui.amount = oz;
  try { localStorage.setItem("awc-amount", String(oz)); } catch { }
}

function openPour(name, x, y) {
  const p = findParticipant(name);
  if (!p) return;
  const key = todayKey();
  openRadial({ name: p.name, color: p.color, total: totalOn(p, key), goal: currentGoalFor(p), amount: ui.amount, x, y },
             (who, oz) => { rememberAmount(oz); addWater(who, oz); });
}

function guard() {
  if (!ui.connected) { setMsg("Not connected. Nothing saved.", false); return false; }
  return true;
}
/* The shop also waits for a reload once a newer version is out: an old page may still
   carry a fixed bug (rev 1.32.0 let two combines spend the same shards). */
function shopGuard() {
  if (!guard()) return false;
  if (ui.staleRev) { setMsg("A new version is out. Reload to use the shop.", false); return false; }
  return true;
}

async function setAwayNow(p, away) {
  if (!p.away) p.away = [];
  const t = todayKey(), open = p.away.findIndex(a => a && !a[1]);
  if (away) { if (open >= 0) return true; p.away.push([t, ""]); }
  else { if (open < 0) return true; p.away[open][1] = shiftKey(t, -1); }   /* back today: today is theirs to play */
  return store.saveParticipant(p, null);
}

async function addWater(name, oz) {
  if (!guard()) return;
  if (!(Number(oz) > 0)) { setMsg("Enter a quantity greater than zero.", false); return; }
  await store.serial(async () => {
    const p = findParticipant(name);
    if (!p) { setMsg(name + " is no longer on the roster.", false); return; }
    if (!isActive(p)) await setAwayNow(p, false);
    const key = todayKey(), before = totalOn(p, key), now = new Date(), stamp = localStamp(now);
    const shells0 = shellsEarned(p), tokens0 = earnedTotal(p);              /* what this pour earns, shown below */
    const eid = "m:" + stamp + ":" + Math.floor(Math.random() * 1000000000);
    p.entries.push({ eid, ts: stamp, date: key, oz, by: S.me || "unknown" });
    if (!(await store.saveParticipant(p, null))) {
      p.entries = p.entries.filter(e => e.eid !== eid);
      setMsg(p.name + "'s file is busy. Try again.", false);
      return;
    }
    const after = totalOn(p, key), goal = currentGoalFor(p), ds = shellsEarned(p) - shells0, dt = earnedTotal(p) - tokens0;
    const shells = (ds > 0 ? " · +" + ds + " shell" + (ds === 1 ? "" : "s") : "") + (dt > 0 ? " · +" + dt + " token" + (dt === 1 ? "" : "s") : "");
    if (!metGoal(before, goal) && metGoal(after, goal)) {
      const g = streaks(p).goal;
      setMsg(p.name + " hit the goal: " + fmt(after) + " oz" + (g > 1 ? " · " + g + "-day streak" : "") + shells, true);
    } else {
      setMsg(p.name + " +" + fmt(oz) + " oz · " + fmt(after) + " / " + fmt(goal) + " today" + shells, true);
    }
    G.pour(p.name, oz, p.color);
    emit("pour", { name: p.name, oz, color: p.color });
    await settle();
  });
}

/* First click arms a pour's undo for a few seconds; the second click removes it. */
const ARM_MS = 5000;
let armTimer = 0;
function armUndo(eid) {
  ui.armed = eid;
  clearTimeout(armTimer);
  armTimer = setTimeout(() => { ui.armed = ""; renderActivityNow(); }, ARM_MS);
  renderActivityNow();
}

async function undoEntry(name, eid) {
  if (!guard()) return;
  ui.armed = "";
  clearTimeout(armTimer);
  await store.serial(async () => {
    const p = findParticipant(name), key = todayKey();
    if (!p) { setMsg(name + " is no longer on the roster.", false); return; }
    const idx = p.entries.findIndex(e => e.eid === eid);
    if (idx < 0) { setMsg("That pour was already removed.", false); render(); return; }
    const removed = p.entries[idx];
    p.entries.splice(idx, 1);
    if (!(await store.saveParticipant(p, [removed.eid]))) {
      p.entries.splice(idx, 0, removed);
      setMsg(p.name + "'s file is busy. Try again.", false);
      return;
    }
    setMsg("Removed " + fmt(removed.oz) + " oz from " + p.name + (removed.by ? " (logged by " + removed.by + ")" : "") +
           "     today " + fmt(totalOn(p, key)) + " / " + fmt(currentGoalFor(p)) + " oz", true);
    G.splash(p.name);
    await settle();
  });
}

async function setColor(name, hex) {
  if (!guard()) return;
  await store.serial(async () => {
    const p = findParticipant(name);
    if (!p || String(p.color).toLowerCase() === hex.toLowerCase()) return;
    const old = p.color;
    p.color = hex;
    if (!(await store.saveParticipant(p, null))) { p.color = old; setMsg("Could not save " + name + "'s colour.", false); return; }
    setMsg(name + "'s colour changed.", true);
    await settle();
  });
}

async function setAway(name, away) {
  if (!guard()) return;
  await store.serial(async () => {
    const p = findParticipant(name);
    if (!p) return;
    if (!(await setAwayNow(p, away))) { setMsg("Could not save the change.", false); return; }
    setMsg(away ? p.name + " is away. Streaks paused." : p.name + " is back.", true);
    await settle();
  });
  renderRoster();
}

async function addParticipant() {
  const name = trim($("pname").value);
  if (!name) { setMsg("Enter a participant name.", false); return; }
  if (!guard()) return;
  if (findParticipant(name)) { setMsg(name + " is already on the roster.", false); return; }
  await store.serial(async () => {
    if (await store.participantExists(name)) { setMsg(name + " already has a file in the folder.", false); return; }
    const used = new Set(S.participants.map(p => String(p.color).toLowerCase()));
    const color = C.PARTICIPANT_COLORS.find(c => !used.has(c)) || C.PARTICIPANT_COLORS[S.participants.length % C.PARTICIPANT_COLORS.length];
    const p = { name, color, goal: currentGoal(), created: todayKey(), entries: [] };
    if (!(await store.saveParticipant(p, null))) { setMsg("Could not create " + name + "'s file.", false); return; }
    $("pname").value = "";
    setMsg(name + " is in.", true);
    await refresh();
  });
}

async function removeParticipant(name) {
  if (!guard()) return;
  const ok = await askConfirm("Remove " + name + "?",
    "Their file moves to " + C.REMOVED_SUBDIR + " and can be restored by hand.", "Remove");
  if (!ok) return;
  await store.serial(async () => {
    try {
      await store.moveToRemoved(name);
      setMsg(name + " was moved to " + C.REMOVED_SUBDIR + ".", true);
    } catch (e) {
      setMsg("Could not move " + name + "'s file: " + (e.message || e), false);
      return;
    }
    await refresh();
  });
}

async function applySettings() {
  if (!guard()) return;
  const g = Number($("goalVal").value), a = Number($("annualVal").value);
  const sd = trim($("startVal").value), iv = trim($("idleVal").value);
  const ti = trim($("titleVal").value).slice(0, C.TITLE_MAX), tg = trim($("taglineVal").value).slice(0, C.TAGLINE_MAX);
  if (!isFinite(g) || g <= 0) { setMsg("Default goal must be above zero.", false); return; }
  if (!isFinite(a) || a <= 0) { setMsg("Yearly goal must be above zero.", false); return; }
  if (sd && !parseKey(sd)) { setMsg("Start date must be YYYY-MM-DD.", false); return; }
  if (iv !== "" && (!isFinite(Number(iv)) || Number(iv) < 0 || Math.floor(Number(iv)) !== Number(iv))) {
    setMsg("Streak grace must be a whole number of days.", false); return;
  }
  const dailyChanged = g !== currentGoal(), annualChanged = a !== currentAnnualGoal();
  const startChanged = sd !== "" && sd !== challengeStart(), idleChanged = iv !== "" && Number(iv) !== currentIdleMax();
  const titleChanged = ti !== (S.settings.title || ""), tagChanged = tg !== (S.settings.tagline || "");
  if (!dailyChanged && !annualChanged && !startChanged && !idleChanged && !titleChanged && !tagChanged) { setMsg("Nothing changed.", true); closeSettings(); return; }
  await store.serial(async () => {
    const old = { ...S.settings };
    S.settings.annualGoalOz = a;
    if (startChanged) S.settings.startDate = sd;
    if (idleChanged) S.settings.idleSkipDays = Number(iv);
    if (dailyChanged) S.settings.dailyGoalOz = g;
    S.settings.title = ti; S.settings.tagline = tg;
    if (!(await store.saveSettings())) {
      S.settings = old;
      setMsg("Couldn't save settings. Try again.", false);
      return;
    }
    dataChanged();
    closeSettings();
    const bits = [];
    if (dailyChanged) bits.push("Default goal: " + fmt(g) + " oz.");
    if (annualChanged) bits.push("Yearly goal: " + fmtOz(a) + " oz.");
    if (startChanged) bits.push("Year: " + sd + " to " + challengeEnd() + ".");
    if (titleChanged) bits.push("Title: " + (ti || C.DEFAULT_TITLE) + ".");
    if (tagChanged) bits.push("Tagline " + (tg ? "set." : "back to the default."));
    if (idleChanged) bits.push("Streak grace: " + currentIdleMax() + " day" + (currentIdleMax() === 1 ? "" : "s") + ".");
    setMsg(bits.join("  "), true);
    await refresh();
  });
}

/* Which cards are folded is remembered in this browser. */
const SP_KEY = "awc-settings-cards";
function restoreCards() {
  let st = {};
  try { st = JSON.parse(localStorage.getItem(SP_KEY) || "{}") || {}; } catch { }
  for (const d of document.querySelectorAll("#settingsPanel .sp-card")) if (d.dataset.card in st) d.open = !!st[d.dataset.card];
}
function rememberCards() {
  const st = {};
  for (const d of document.querySelectorAll("#settingsPanel .sp-card")) st[d.dataset.card] = d.open;
  try { localStorage.setItem(SP_KEY, JSON.stringify(st)); } catch { }
}
function openSettings() {
  fillSettings(); fillBottle(); restoreCards();
  $("settingsPanel").hidden = false; $("cog").setAttribute("aria-expanded", "true");
  ($("settingsPanel").querySelector(".sp-card[open] input") || $("spClose")).focus();
}
function closeSettings() { $("settingsPanel").hidden = true; $("cog").setAttribute("aria-expanded", "false"); }

/* ---- events ------------------------------------------------------------- */
function wire() {
  $("gatePick").onclick = pickFolder;
  $("gateReconnect").onclick = reconnect;
  const tab = name => { setTab(name); shopTabChanged(name === "shop"); };
  $("tab-today").onclick = () => tab("today");
  $("tab-history").onclick = () => tab("history");
  $("tab-pets").onclick = () => tab("pets");
  $("tab-shop").onclick = () => tab("shop");
  $("bankShop").onclick = () => { closeOverlays(); tab("shop"); };
  uiHooks.renderShop = renderShop;
  uiHooks.bottle = bottleView;
  initShop({ settle, guard: shopGuard, askConfirm, pollSoon, whoAmI: () => askIdentity(false) });
  $("cog").onclick = () => $("settingsPanel").hidden ? openSettings() : closeSettings();
  $("staleBanner").addEventListener("click", e => { if (e.target.closest("[data-act=hta-ok]")) htaDismiss(); });
  $("spClose").onclick = closeSettings;
  for (const d of document.querySelectorAll("#settingsPanel .sp-card")) d.addEventListener("toggle", rememberCards);
  $("applySettings").onclick = applySettings;
  $("settingsPanel").addEventListener("keydown", e => {             /* Enter saves Challenge and Goals, not the other cards */
    if (e.key === "Enter" && e.target.tagName === "INPUT" && e.target.closest('[data-card=challenge],[data-card=goals]')) applySettings();
  });
  $("pname").addEventListener("keydown", e => { if (e.key === "Enter") addParticipant(); });
  $("addP").onclick = addParticipant;
  $("quickPour").onclick = () => { if (S.mine) addWater(S.mine, ui.amount); };
  wireBottle();
  $("sbMe").onclick = () => askIdentity(false);
  $("sbDiag").onclick = showDiag;
  $("sbFolder").onclick = () => { if (ui.connected) showGate("reconnect"); else showGate(store.dir ? "reconnect" : "pick"); $("gateClose").hidden = !ui.connected; };
  $("gateClose").onclick = () => { $("gate").hidden = true; };

  wireRadial();
  $("glasses").addEventListener("contextmenu", e => {
    const card = e.target.closest(".participant-card");
    if (!card || e.target.closest(".swatches")) return;
    e.preventDefault();
    let x = e.clientX, y = e.clientY;
    if (!x && !y) {                                   /* the context-menu key: no pointer position */
      const r = card.querySelector(".gwrap").getBoundingClientRect();
      x = r.left + r.width / 2; y = r.top + r.height / 2;
    }
    openPour(card.dataset.name, x, y);
  });
  $("glasses").addEventListener("keydown", e => {
    const g = e.target.closest(".gwrap"), card = e.target.closest(".participant-card");
    if (!g || !card || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault();
    const r = g.getBoundingClientRect();
    openPour(card.dataset.name, r.left + r.width / 2, r.top + r.height / 2);
  });
  $("activity").onclick = e => {
    const b = e.target.closest("[data-act=undo]"), row = e.target.closest("li.pour");
    if (!b || !row) return;
    if (ui.armed === row.dataset.eid) undoEntry(row.dataset.name, row.dataset.eid);
    else armUndo(row.dataset.eid);
  };
  $("glasses").onclick = e => {
    const t = e.target.closest("[data-act]"), card = e.target.closest(".participant-card");
    if (!t || !card) return;
    const name = card.dataset.name;
    switch (t.dataset.act) {
      case "remove": removeParticipant(name); break;
      case "bank": openBank(name); break;
      case "swatches": toggleSwatches(card); break;
      case "audit": auditStreak(name); break;
      case "color": setColor(name, t.dataset.color); break;
    }
  };
  const equipFrom = e => {
    const tab = e.target.closest("[data-act=pen]"), tabCard = e.target.closest(".pet-card");
    if (tab && tabCard) { ui.petPen[tabCard.dataset.name] = Number(tab.dataset.pen); render(); return; }
    const t = e.target.closest("[data-act=equip]"), card = e.target.closest(".pet-card");
    if (!t || !card || !guard()) return;
    store.serial(async () => { await equipPet(card.dataset.name, Number(t.dataset.kind)); await settle(); });
  };
  $("pets").onclick = equipFrom;
  $("pets").addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); equipFrom(e); } });
  $("rosterList").onclick = e => {
    const b = e.target.closest("[data-act=away]"), row = e.target.closest(".roster-row");
    if (b && row) setAway(row.dataset.name, b.dataset.away === "1");
  };
  for (const id of ["report", "bank"]) {
    $(id).addEventListener("click", e => { if (e.target.id === id || e.target.closest(".report-x")) closeOverlays(); });
  }
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      if (!$("unlock").hidden) $("ulCard").click();               /* the unlock card closes like a click */
      closeOverlays(); closeSettings(); if (ui.armed) { ui.armed = ""; renderActivityNow(); }
    }
  });
  document.addEventListener("click", e => {
    if (!$("settingsPanel").hidden && !e.target.closest("#settingsPanel") && !e.target.closest("#cog")) closeSettings();
  });
  let rz = 0;
  window.addEventListener("resize", () => {
    cancelAnimationFrame(rz);
    rz = requestAnimationFrame(() => { if (ui.tab === "today" && relayout()) render(); });
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    checkVersion(false);
    if (ui.connected) { clearTimeout(pollTimer); poll(); }
  });
  $("updateBtn").onclick = () => { $("updateBtn").disabled = true; freshReload(); };
  /* moved to a screen with other scaling, or zoomed: canvases are rebuilt at the new pixel ratio */
  const watchDpr = () => {
    if (!window.matchMedia) return;
    window.matchMedia("(resolution: " + window.devicePixelRatio + "dppx)").addEventListener("change", () => { forceRebuild(); render(); watchDpr(); }, { once: true });
  };
  watchDpr();
}

/* ---- bottle sync ----------------------------------------------------------- */
/* Shown only for BOTTLE_USER; see bottle.js. Sips fill "your glass" (S.mine). */
function bottleView() {
  const on = bottleOn(), cfg = bottleCfg(), mine = S.mine && findParticipant(S.mine);
  $("bottleBox").hidden = !on;
  $("bottleSync").hidden = !(on && signedIn() && mine && ui.connected);
  if (!on) return;
  $("bOut").hidden = signedIn(); $("bIn").hidden = !signedIn();
  $("bWho").textContent = signedIn() ? "Signed in as " + (cfg.email || "you") : "";
  $("bottleNote").textContent = !mine ? "Link your glass first: click your name in the status bar." :
    "Fills " + mine.name + "'s glass, on Sync now only. The relay address, relay key and Hidrate session stay in this browser.";
}

function fillBottle() {
  const cfg = bottleCfg();
  $("bRelay").value = cfg.relay || ""; $("bKey").value = cfg.key || ""; $("bKey").type = "password";
  $("bEmail").value = cfg.email || ""; $("bPass").value = "";
  bottleView();
}

async function syncBottle() {
  if (!bottleOn() || !guard()) return;
  const mine = S.mine && findParticipant(S.mine);
  if (!mine) { setMsg("Link your glass first: click your name in the status bar.", false); return; }
  for (const b of [$("bottleSync"), $("bSyncNow")]) b.disabled = true;
  try {
    const sips = await fetchSips();
    let res = null;
    await store.serial(async () => {
      const p = findParticipant(mine.name), snap = p.entries.map(e => ({ ...e }));   /* applySips grows entries in place */
      res = applySips(p, sips, todayKey());
      if (!res.added && !res.grown && !res.removed.length) return;
      if (!(await store.saveParticipant(p, res.removed))) { p.entries = snap; res.busy = true; return; }
      if (res.oz > 0) { G.pour(p.name, res.oz, p.color); emit("pour", { name: p.name, oz: res.oz, color: p.color }); }
      await settle();
    });
    setMsg(res.busy ? mine.name + "'s file is busy. Try again." :
           res.oz > 0 ? "Bottle: +" + fmt(res.oz) + " oz from " + sips.length + " sip" + (sips.length === 1 ? "" : "s") + " today." :
           sips.length ? "Bottle: up to date (" + sips.length + " sip" + (sips.length === 1 ? "" : "s") + " today)." : "Bottle: no sips yet today.", !res.busy);
  } catch (e) {
    store.diagNote("bottle sync: " + (e.message || e));
    setMsg("Bottle sync: " + (e.message || e), false);
  } finally {
    for (const b of [$("bottleSync"), $("bSyncNow")]) b.disabled = false;
    bottleView();
  }
}

function wireBottle() {
  const relayIn = () => setRelay($("bRelay").value, $("bKey").value);
  $("bNewKey").onclick = () => { $("bKey").type = "text"; $("bKey").value = newRelayKey(); $("bKey").select();
    setMsg("New relay key: copy it into the Worker's RELAY_KEY secret, then Save here.", true); };
  $("bSaveRelay").onclick = async () => {
    try { await relayIn(); $("bKey").type = "password"; setMsg("Relay saved in this browser.", true); } catch (e) { setMsg(e.message, false); }
  };
  $("bTest").onclick = async () => {
    try {
      await relayIn();
      const r = await pingRelay();
      setMsg(!r.configured ? "The relay answers, but its RELAY_KEY secret isn't set yet." :
             !r.keyOk ? "The relay answers, but the relay key doesn't match its RELAY_KEY." : "The relay answers and the key matches.", !!(r.configured && r.keyOk));
    } catch (e) { setMsg("Relay test: " + e.message, false); }
  };
  $("bSignIn").onclick = async () => {
    const pass = $("bPass").value;
    $("bPass").value = "";                                       /* never kept, not even in the field */
    try { await relayIn(); await signIn($("bEmail").value, pass); setMsg("Signed in to Hidrate.", true); }
    catch (e) { setMsg("Hidrate sign-in: " + e.message, false); }
    bottleView();
  };
  $("bPass").addEventListener("keydown", e => { if (e.key === "Enter") $("bSignIn").click(); });
  $("bSignOut").onclick = async () => { await signOut(); setMsg("Signed out of Hidrate in this browser.", true); bottleView(); };
  $("bSyncNow").onclick = syncBottle;
  $("bottleSync").onclick = syncBottle;
}

/* ---- updates ------------------------------------------------------------ */
/* The revision on the site, read past every cache. "" when it can't be read. */
async function siteRev() {
  try {
    const t = await (await fetch("js/config.js?check=" + Date.now(), { cache: "no-store" })).text();
    return (/REV\s*=\s*"([^"]+)"/.exec(t) || [])[1] || "";
  } catch { return ""; }
}

/* Re-fetch every file past the cache, then reload: a plain reload can keep cached
   modules for up to ten minutes and mix two versions. */
async function freshReload() {
  await Promise.all(C.SITE_FILES.map(f => fetch(f, { cache: "reload" }).catch(() => {})));
  location.reload();
}

async function checkVersion(atBoot) {
  const rev = await siteRev();
  if (!rev || rev === C.REV) return false;
  let tried = "";
  try { tried = sessionStorage.getItem("awc-reloaded-for") || ""; } catch { }
  if (atBoot && tried !== rev) {                 /* nothing to lose yet: update straight away */
    try { sessionStorage.setItem("awc-reloaded-for", rev); } catch { }
    await freshReload();
    return true;
  }
  $("updateRev").textContent = rev.replace("rev ", "");
  $("updateBanner").hidden = false;
  ui.staleRev = rev;
  return false;
}

/* ---- boot --------------------------------------------------------------- */
async function boot() {
  await loadPetDefs();
  await loadBottle();
  initTheme();
  wire();
  try { const a = Number(localStorage.getItem("awc-amount")); if (a > 0) ui.amount = a; } catch { }
  $("revLabel").textContent = C.REV;
  setInterval(tickMasks, C.MASK_MS);
  render();

  if (await checkVersion(true)) return;
  setInterval(() => { if (!document.hidden) checkVersion(false); }, C.VERSION_CHECK_MS);
  if (typeof window.showDirectoryPicker !== "function") { showGate("noapi"); return; }
  try { S.me = (await store.kvGet("me")) || ""; const m = await store.kvGet("mine"); S.mine = typeof m === "string" ? m : null; } catch { }
  let stored = null;
  try { stored = await store.kvGet("dir"); } catch (e) { store.diagNote("stored folder unreadable: " + e.message); }
  if (!stored) { showGate("pick"); return; }
  store.setDir(stored);
  let perm = "prompt";
  try { perm = await store.permissionOf(stored, false); } catch (e) { store.diagNote("permission query failed: " + e.message); }
  store.diagNote("stored folder \"" + stored.name + "\", permission " + perm);
  if (perm === "granted") {
    try { await connect(stored); } catch (e) { showGate("lost", e); }
  } else {
    showGate("reconnect");
  }
}

/* Dev harness hook (localhost only): connect a handle-like object without the picker. */
if (location.hostname === "localhost" || location.hostname === "127.0.0.1") window.AWC = { connect, S, store, G };

boot();
