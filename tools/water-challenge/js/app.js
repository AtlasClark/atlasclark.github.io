/* Boot, connection, actions and polling. Every write goes through serial(), so a
   poll can never interleave with a pour, and every change is followed by the same
   reconcile pass (stamp finished days, settle today's pet events) before render. */

import * as C from "./config.js";
import { S, dataChanged, findParticipant, totalOn, metGoal, currentGoalFor, streaks, isActive,
         stampDayGoals, currentGoal, currentAnnualGoal, currentIdleMax, challengeStart, challengeEnd } from "./model.js";
import * as store from "./store.js";
import { reconcilePets, equipPet } from "./pets.js";
import * as G from "./glass.js";
import { ui, render, setTab, setMsg, showBanner, renderChips, tickMasks, relayout, forceRebuild,
         toggleSwatches, openBank, auditStreak, showDiag, closeOverlays, fillSettings, renderRoster } from "./ui.js";
import { $, bus, todayKey, localStamp, fmt, fmtOz, trim, parseKey, shiftKey, clockStamp } from "./util.js";

let lastSig = "", pollTimer = 0;

/* ---- bus wiring --------------------------------------------------------- */
bus.msg = setMsg;
bus.drown = (name, kind, hue) => G.startSink(name, kind, hue);
bus.petReset = name => { const st = G.animState(name); st.duckState = 0; st.shownKind = -99; };

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

async function refresh() {
  await store.loadSettings();
  S.participants = await store.loadAll();
  dataChanged();
  await reconcile();
  lastSig = await store.folderSignature();
  ui.lastSync = clockStamp();
  render();
}

/* After a local change: settle pet events, then repaint. */
async function settle() {
  await reconcile();
  lastSig = await store.folderSignature();
  ui.lastSync = clockStamp();
  render();
}

function schedulePoll() {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(poll, document.hidden ? C.POLL_HIDDEN_MS : C.POLL_MS);
}

async function poll() {
  if (!ui.connected) return;
  try {
    await store.serial(async () => {
      const sig = await store.folderSignature();
      if (sig !== lastSig) await refresh();
      else { await reconcile(); ui.lastSync = clockStamp(); render(); }
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
    $("gateMsg").innerHTML = "This browser cannot open a shared folder. Open this page in <b>Chrome</b> or <b>Edge</b>.";
    $("gatePick").hidden = true;
  } else if (mode === "reconnect") {
    $("gateMsg").innerHTML = "The browser needs you to confirm access to the shared <b>" + name + "</b> folder again. One click.";
    $("gateReconnect").textContent = "Reconnect to " + name;
    $("gateReconnect").hidden = false;
    $("gatePick").textContent = "Choose a different folder";
  } else if (mode === "lost") {
    $("gateMsg").innerHTML = "Lost contact with the <b>" + name + "</b> folder. The share may be offline, or the browser withdrew access.";
    $("gateReconnect").textContent = "Reconnect to " + name;
    $("gateReconnect").hidden = false;
    $("gatePick").textContent = "Choose a different folder";
  } else {
    $("gateMsg").innerHTML = "Choose the challenge's shared <b>data</b> folder: the one beside the HTA that holds " +
      "<code>_settings.json</code> and everyone's <code>Name.json</code>. The page remembers it.";
    $("gatePick").textContent = "Choose data folder";
  }
  if (err) { $("gateWarn").textContent = (err.name ? err.name + ": " : "") + (err.message || err); $("gateWarn").hidden = false; }
  gateTrail();
}

async function connect(h) {
  store.setDir(h);
  if (window.FileSystemHandle && h instanceof window.FileSystemHandle) {
    try { await store.kvSet("dir", h); } catch (e) { store.diagNote("could not remember folder: " + e.message); }
  }
  $("gate").hidden = true;
  ui.connected = true;
  forceRebuild();
  if (!S.me) await askIdentity(true);
  await store.serial(refresh);
  store.diagNote("connected to " + h.name + " (" + S.participants.length + " files)");
  schedulePoll();
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
function askIdentity(first) {
  return new Promise(res => {
    const d = $("whoDialog");
    $("whoInput").value = S.me || "";
    $("whoCancel").hidden = !!first && !S.me;
    d.showModal();
    $("whoInput").focus();
    d.onclose = async () => {
      const v = trim($("whoInput").value);
      if (d.returnValue === "ok" && v) {
        S.me = v;
        try { await store.kvSet("me", v); } catch { }
      }
      if (!S.me) S.me = "unknown";
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
function commitAmount() {
  const v = Number($("amount").value);
  if (!isFinite(v) || v <= 0) { setMsg("Enter a quantity greater than zero.", false); return false; }
  ui.amount = v;
  renderChips();
  return true;
}

function guard() {
  if (!ui.connected) { setMsg("No connection to the data folder - nothing was saved.", false); return false; }
  return true;
}

async function setAwayNow(p, away) {
  if (!p.away) p.away = [];
  const t = todayKey(), open = p.away.findIndex(a => a && !a[1]);
  if (away) { if (open >= 0) return true; p.away.push([t, ""]); }
  else { if (open < 0) return true; p.away[open][1] = shiftKey(t, -1); }   /* back today: today is theirs to play */
  return store.saveParticipant(p, null);
}

async function addWater(name) {
  if (!commitAmount() || !guard()) return;
  await store.serial(async () => {
    const p = findParticipant(name);
    if (!p) { setMsg(name + " is no longer on the roster.", false); return; }
    if (!isActive(p)) await setAwayNow(p, false);
    const key = todayKey(), before = totalOn(p, key), now = new Date(), stamp = localStamp(now);
    const eid = "m:" + stamp + ":" + Math.floor(Math.random() * 1000000000);
    p.entries.push({ eid, ts: stamp, date: key, oz: ui.amount, by: S.me || "unknown" });
    if (!(await store.saveParticipant(p, null))) {
      p.entries = p.entries.filter(e => e.eid !== eid);
      setMsg("Someone else is writing to " + p.name + "'s file. Try again in a second.", false);
      return;
    }
    const after = totalOn(p, key), goal = currentGoalFor(p);
    if (!metGoal(before, goal) && metGoal(after, goal)) {
      const g = streaks(p).goal;
      setMsg(p.name + " hit the goal - " + fmt(after) + " fl oz." + (g > 0 ? "  " + g + " goal streak." : ""), true);
    } else {
      setMsg(p.name + "  +" + fmt(ui.amount) + " oz     today " + fmt(after) + " / " + fmt(goal) + " oz", true);
    }
    G.splash(p.name);
    await settle();
  });
}

async function undoLast(name) {
  if (!guard()) return;
  await store.serial(async () => {
    const p = findParticipant(name), key = todayKey();
    if (!p) { setMsg(name + " is no longer on the roster.", false); return; }
    let idx = -1;
    p.entries.forEach((e, i) => {
      if (e.date !== key || e.by === C.HIDRATE_TAG) return;
      if (idx < 0 || String(e.ts) >= String(p.entries[idx].ts)) idx = i;
    });
    if (idx < 0) { setMsg("Nothing logged for " + p.name + " today.", false); return; }
    const removed = p.entries[idx];
    p.entries.splice(idx, 1);
    if (!(await store.saveParticipant(p, [removed.eid]))) {
      p.entries.splice(idx, 0, removed);
      setMsg("Someone else is writing to " + p.name + "'s file. Try again in a second.", false);
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
    setMsg(name + "'s colour updated.", true);
    await settle();
  });
}

async function setAway(name, away) {
  if (!guard()) return;
  await store.serial(async () => {
    const p = findParticipant(name);
    if (!p) return;
    if (!(await setAwayNow(p, away))) { setMsg("Could not save the change.", false); return; }
    setMsg(away ? p.name + " is away. Their streaks are safe until they come back." : p.name + " is back.", true);
    await settle();
  });
  renderRoster();
}

async function addParticipant() {
  const name = trim($("pname").value);
  if (!name) { setMsg("Enter a participant name.", false); return; }
  if (!guard()) return;
  if (findParticipant(name)) { setMsg("That participant already exists.", false); return; }
  await store.serial(async () => {
    if (await store.participantExists(name)) { setMsg("A file for " + name + " already exists in the folder.", false); return; }
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
    "Their file is moved to the " + C.REMOVED_SUBDIR + " folder, not deleted, so this can be undone by hand.", "Remove");
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
  if (!isFinite(g) || g <= 0) { setMsg("The daily goal has to be a number above zero.", false); return; }
  if (!isFinite(a) || a <= 0) { setMsg("The yearly goal has to be a number above zero.", false); return; }
  if (sd && !parseKey(sd)) { setMsg("The start date must look like 2026-08-04.", false); return; }
  if (iv !== "" && (!isFinite(Number(iv)) || Number(iv) < 0 || Math.floor(Number(iv)) !== Number(iv))) {
    setMsg("The idle allowance has to be a whole number of days.", false); return;
  }
  const dailyChanged = g !== currentGoal(), annualChanged = a !== currentAnnualGoal();
  const startChanged = sd !== "" && sd !== challengeStart(), idleChanged = iv !== "" && Number(iv) !== currentIdleMax();
  if (!dailyChanged && !annualChanged && !startChanged && !idleChanged) { setMsg("Nothing changed.", true); closeSettings(); return; }
  await store.serial(async () => {
    const old = { ...S.settings };
    S.settings.annualGoalOz = a;
    if (startChanged) S.settings.startDate = sd;
    if (idleChanged) S.settings.idleSkipDays = Number(iv);
    if (dailyChanged) S.settings.dailyGoalOz = g;
    if (!(await store.saveSettings())) {
      S.settings = old;
      setMsg("Could not write " + C.SETTINGS_FILE + ". Someone may have it locked.", false);
      return;
    }
    dataChanged();
    closeSettings();
    const bits = [];
    if (dailyChanged) bits.push("Default goal is now " + fmt(g) + " fl oz. It applies to anyone without a personal goal this month.");
    if (annualChanged) bits.push("Yearly goal is now " + fmtOz(a) + " fl oz per person.");
    if (startChanged) bits.push("The challenge year now runs " + sd + " to " + challengeEnd() + ".");
    if (idleChanged) bits.push("Streaks now survive missing up to " + currentIdleMax() + " day" + (currentIdleMax() === 1 ? "" : "s") + " in a row.");
    setMsg(bits.join("  "), true);
    await refresh();
  });
}

function openSettings() { fillSettings(); $("settingsPanel").hidden = false; $("cog").setAttribute("aria-expanded", "true"); $("goalVal").focus(); }
function closeSettings() { $("settingsPanel").hidden = true; $("cog").setAttribute("aria-expanded", "false"); }

/* ---- events ------------------------------------------------------------- */
function wire() {
  $("gatePick").onclick = pickFolder;
  $("gateReconnect").onclick = reconnect;
  $("tab-today").onclick = () => setTab("today");
  $("tab-history").onclick = () => setTab("history");
  $("tab-pets").onclick = () => setTab("pets");
  $("cog").onclick = () => $("settingsPanel").hidden ? openSettings() : closeSettings();
  $("applySettings").onclick = applySettings;
  $("settingsPanel").addEventListener("keydown", e => { if (e.key === "Enter" && e.target.tagName === "INPUT") applySettings(); });
  $("amount").addEventListener("keydown", e => { if (e.key === "Enter" && commitAmount()) setMsg("", true); });
  $("amount").addEventListener("change", () => commitAmount());
  $("pname").addEventListener("keydown", e => { if (e.key === "Enter") addParticipant(); });
  $("addP").onclick = addParticipant;
  $("sbMe").onclick = () => askIdentity(false);
  $("sbDiag").onclick = showDiag;
  $("sbFolder").onclick = () => { if (ui.connected) showGate("reconnect"); else showGate(store.dir ? "reconnect" : "pick"); $("gateClose").hidden = !ui.connected; };
  $("gateClose").onclick = () => { $("gate").hidden = true; };

  $("chips").onclick = e => {
    const b = e.target.closest(".chip");
    if (!b) return;
    ui.amount = Number(b.dataset.oz);
    $("amount").value = ui.amount;
    renderChips();
    setMsg("", true);
  };
  $("addButtons").onclick = e => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    if (b.dataset.act === "add") addWater(b.dataset.name);
    else if (b.dataset.act === "undo") undoLast(b.dataset.name);
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
    if (e.key === "Escape") { closeOverlays(); closeSettings(); }
  });
  document.addEventListener("click", e => {
    if (!$("settingsPanel").hidden && !e.target.closest("#settingsPanel") && !e.target.closest("#cog")) closeSettings();
  });
  let rz = 0;
  window.addEventListener("resize", () => {
    cancelAnimationFrame(rz);
    rz = requestAnimationFrame(() => { if (ui.tab === "today" && relayout()) render(); });
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && ui.connected) { clearTimeout(pollTimer); poll(); } });
}

/* ---- boot --------------------------------------------------------------- */
async function boot() {
  initTheme();
  wire();
  renderChips();
  $("amount").value = C.DEFAULT_AMOUNT;
  $("revLabel").textContent = C.REV;
  setInterval(tickMasks, C.MASK_MS);
  render();

  if (typeof window.showDirectoryPicker !== "function") { showGate("noapi"); return; }
  try { S.me = (await store.kvGet("me")) || ""; } catch { }
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
if (location.hostname === "localhost" || location.hostname === "127.0.0.1") window.AWC = { connect, S, store };

boot();
