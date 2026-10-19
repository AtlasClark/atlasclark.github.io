/*
  Work Instructions — page controller
  Scope: document model (meta, revision history, steps), step list with
  drag-to-reorder and thumbnails, step inspector, image import (paste, drop,
  file picker), undo / redo, autosave to IndexedDB, .wiproj project files,
  document info dialog, preview, exports, theme and keyboard shortcuts.
*/
(function () {
  "use strict";
  const WI = window.WI, X = WI.exp;
  const REV = "rev 1.1.0";
  const LS_UI = "workInstr.ui";
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const plural = (n, w) => n + " " + w + (n !== 1 ? "s" : "");
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const pad2 = n => String(n).padStart(2, "0");
  const today = () => { const d = new Date(); return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); };
  const COLORS = ["#E5322D", "#F28C28", "#F5D90A", "#D0DD2B", "#2FA84F", "#2F6FED", "#C2338C", "#111111", "#FFFFFF"];
  const NOTE_KINDS = ["none", "note", "tip", "caution", "warning"];

  const ui = { theme: null, c: COLORS[0], lvl: 1, fill: false };
  try { Object.assign(ui, JSON.parse(localStorage.getItem(LS_UI) || "{}")); } catch (e) { /* defaults */ }
  const saveUi = () => { try { localStorage.setItem(LS_UI, JSON.stringify(ui)); } catch (e) { /* view prefs only */ } };

  // ---------- IndexedDB: "doc" + "img:<key>" blobs ----------
  const idb = (() => {
    let dbp = null;
    const open = () => dbp || (dbp = new Promise((res, rej) => {
      const r = indexedDB.open("work-instructions", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }));
    const run = async (mode, fn) => {
      const db = await open();
      return new Promise((res, rej) => {
        const tx = db.transaction("kv", mode), q = fn(tx.objectStore("kv"));
        tx.oncomplete = () => res(q && q.result); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error);
      });
    };
    return {
      get: k => run("readonly", s => s.get(k)),
      set: (k, v) => run("readwrite", s => s.put(v, k)),
      del: k => run("readwrite", s => s.delete(k)),
      keys: () => run("readonly", s => s.getAllKeys()),
      clear: () => run("readwrite", s => s.clear())
    };
  })();

  // ---------- model ----------
  const blankDoc = () => ({
    format: "atlas-wi", v: 1,
    meta: { title: "", docNo: "", rev: "", product: "", author: "", date: today(), purpose: "", tools: "", safety: "", page: "letter" },
    history: [], steps: []
  });
  const newStep = () => ({ id: uid(), title: "", text: "", noteKind: "none", note: "", img: null, crop: null, anns: [] });

  function normalize(d) {
    const b = blankDoc();
    const out = { format: "atlas-wi", v: 1, meta: Object.assign(b.meta, d && d.meta), history: [], steps: [] };
    if (d && Array.isArray(d.history)) out.history = d.history.map(r => ({ rev: String(r.rev || ""), date: String(r.date || ""), by: String(r.by || ""), change: String(r.change || "") }));
    if (d && Array.isArray(d.steps)) out.steps = d.steps.map(s => Object.assign(newStep(), s, {
      id: s.id || uid(), anns: Array.isArray(s.anns) ? s.anns : [],
      noteKind: NOTE_KINDS.includes(s.noteKind) ? s.noteKind : "none"
    }));
    return out;
  }

  let doc = blankDoc();
  let cur = -1;
  const blobs = new Map();     // image key → Blob (original file)
  const bitmaps = new Map();   // image key → ImageBitmap
  const thumbs = new Map();    // step id → canvas
  let storageOk = true;

  const step = () => doc.steps[cur] || null;
  const bmpOf = s => s && s.img ? bitmaps.get(s.img.key) || null : null;
  const hasContent = () => doc.steps.length > 0 || !!(doc.meta.title || doc.meta.docNo);

  // ---------- editor ----------
  const undo = [], redo = [];
  const snap = s => ({ id: s.id, anns: JSON.stringify(s.anns), crop: JSON.stringify(s.crop || null) });
  function pushUndo(s) { undo.push(snap(s)); if (undo.length > 300) undo.shift(); redo.length = 0; paintUndo(); }
  function dropUndo() { undo.pop(); paintUndo(); }
  function travel(from, to) {
    for (;;) {
      const e = from.pop();
      if (!e) break;
      const i = doc.steps.findIndex(s => s.id === e.id);
      if (i < 0) continue;
      const s = doc.steps[i];
      to.push(snap(s));
      const cropChanged = JSON.stringify(s.crop || null) !== e.crop;
      s.anns = JSON.parse(e.anns); s.crop = JSON.parse(e.crop);
      if (i !== cur) select(i);
      else { ed.clearSel(); if (cropChanged) ed.fit(); }
      touched(s, true);
      break;
    }
    paintUndo();
  }

  const ed = WI.createEditor($("stage"), {
    step, bitmap: bmpOf,
    changed: s => touched(s, true),
    pushUndo, dropUndo,
    select: o => {
      const st = ed.styleOf(o);
      if (st) { ed.adopt(st); Object.assign(ui, st); }
      paintStyle(); paintDel();
    },
    zoom: s => { $("zoomLbl").textContent = Math.round(s * 100) + "%"; },
    tool: () => paintTools()
  });
  ed.adopt({ c: ui.c, lvl: ui.lvl, fill: ui.fill });

  // ---------- change tracking / autosave ----------
  let saveTimer = 0;
  const thumbTimers = new Map();
  function touched(s, visual) {
    scheduleSave();
    paintStats();
    if (s && visual) {
      clearTimeout(thumbTimers.get(s.id));
      thumbTimers.set(s.id, setTimeout(() => { thumbTimers.delete(s.id); makeThumb(s); }, 250));
      $("uncropBtn").hidden = !(step() && step().crop);
    }
  }
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 450);
  }
  async function saveNow() {
    clearTimeout(saveTimer);
    try {
      await idb.set("doc", doc);
      storageOk = true;
      const d = new Date();
      setSaveStat("Saved in this browser · " + pad2(d.getHours()) + ":" + pad2(d.getMinutes()));
    } catch (e) {
      storageOk = false;
      setSaveStat("Browser storage unavailable — save a project file", true);
    }
  }
  function setSaveStat(t, warn) { const el = $("saveStat"); el.textContent = t; el.classList.toggle("warn", !!warn); }

  async function storeImage(blob) {
    const bmp = await createImageBitmap(blob);
    const key = uid();
    blobs.set(key, blob); bitmaps.set(key, bmp);
    try { await idb.set("img:" + key, blob); } catch (e) { storageOk = false; setSaveStat("Browser storage unavailable — save a project file", true); }
    return { key, w: bmp.width, h: bmp.height };
  }
  function releaseImage(key) {
    if (!key || doc.steps.some(s => s.img && s.img.key === key)) return;
    const b = bitmaps.get(key); if (b && b.close) b.close();
    bitmaps.delete(key); blobs.delete(key);
    idb.del("img:" + key).catch(() => {});
  }

  // ---------- steps list ----------
  function makeThumb(s) {
    const b = bmpOf(s);
    if (!b) { thumbs.delete(s.id); paintThumb(s); return; }
    thumbs.set(s.id, X.stepCanvas(s, b, 360));
    paintThumb(s);
  }
  function paintThumb(s) {
    const li = $("stepList").querySelector('[data-id="' + s.id + '"] .th');
    if (!li) return;
    li.textContent = "";
    const c = thumbs.get(s.id);
    if (c) li.appendChild(c);
    else li.innerHTML = "<span>Text only</span>";
  }

  let dragFrom = -1;
  function renderSteps() {
    const ol = $("stepList");
    ol.textContent = "";
    doc.steps.forEach((s, i) => {
      const li = document.createElement("li");
      li.className = "st-item" + (i === cur ? " on" : "");
      li.dataset.id = s.id; li.draggable = true;
      li.innerHTML = '<span class="n">' + (i + 1) + '</span><span class="t' + (s.title ? "" : " ph") + '">' + esc(s.title || "Untitled step") + '</span><div class="th"></div>';
      li.addEventListener("click", () => select(i));
      li.addEventListener("dragstart", e => { dragFrom = i; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/x-wi-step", String(i)); });
      li.addEventListener("dragend", () => { dragFrom = -1; clearDropMarks(); });
      li.addEventListener("dragover", e => {
        if (dragFrom < 0) return;
        e.preventDefault();
        const r = li.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
        clearDropMarks(); li.classList.add(after ? "drop-after" : "drop-before");
      });
      li.addEventListener("drop", e => {
        if (dragFrom < 0) return;
        e.preventDefault(); e.stopPropagation();
        const r = li.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
        let to = i + (after ? 1 : 0);
        if (dragFrom < to) to--;
        moveStepTo(dragFrom, to);
        dragFrom = -1; clearDropMarks();
      });
      ol.appendChild(li);
      if (!thumbs.has(s.id) && bmpOf(s)) thumbs.set(s.id, X.stepCanvas(s, bmpOf(s), 360));
      paintThumb(s);
    });
    $("stepTotal").textContent = doc.steps.length ? plural(doc.steps.length, "step") : "";
    const on = ol.querySelector(".on");
    if (on) on.scrollIntoView({ block: "nearest" });
  }
  const clearDropMarks = () => $("stepList").querySelectorAll(".drop-before,.drop-after").forEach(el => el.classList.remove("drop-before", "drop-after"));

  function select(i) {
    if (ed.editingText()) document.activeElement.blur();
    cur = doc.steps.length ? Math.max(0, Math.min(doc.steps.length - 1, i)) : -1;
    $("stepList").querySelectorAll(".st-item").forEach((li, j) => li.classList.toggle("on", j === cur));
    const on = $("stepList").querySelector(".on");
    if (on) on.scrollIntoView({ block: "nearest" });
    fillInspector();
    ed.refresh();
    paintEmpty(); paintTools(); paintDel();
  }

  function moveStepTo(from, to) {
    if (from === to || from < 0 || to < 0 || to >= doc.steps.length) return;
    const [s] = doc.steps.splice(from, 1);
    doc.steps.splice(to, 0, s);
    cur = to;
    renderSteps(); fillInspector(); touched();
  }

  function addStep() {
    const s = newStep();
    doc.steps.splice(cur + 1, 0, s);
    renderSteps(); select(cur + 1); touched();
    $("stTitle").focus();
  }

  function dupStep() {
    const s = step(); if (!s) return;
    const c = Object.assign(JSON.parse(JSON.stringify(s)), { id: uid() });
    doc.steps.splice(cur + 1, 0, c);
    renderSteps(); select(cur + 1); touched();
    toast("Step duplicated");
  }

  async function removeStep() {
    const s = step(); if (!s) return;
    const content = s.img || s.title || s.text.trim() || s.anns.length;
    if (content && !await confirmBox("Delete step " + (cur + 1), "<p>Delete <b>" + esc(s.title || "Step " + (cur + 1)) + "</b>" + (s.img ? " and its image" : "") + "? This can't be undone.</p>", "Delete", true)) return;
    doc.steps.splice(cur, 1);
    thumbs.delete(s.id);
    if (s.img) releaseImage(s.img.key);
    renderSteps(); select(Math.min(cur, doc.steps.length - 1)); touched();
  }

  // ---------- inspector ----------
  function fillInspector() {
    const s = step();
    $("inspEmpty").hidden = !!s; $("inspBody").hidden = !s;
    $("stepNo").textContent = s ? cur + 1 : "–";
    $("stepCnt").textContent = doc.steps.length;
    ["upBtn", "downBtn", "dupBtn", "rmBtn"].forEach(id => { $(id).disabled = !s; });
    if (!s) return;
    $("upBtn").disabled = cur === 0; $("downBtn").disabled = cur === doc.steps.length - 1;
    $("stTitle").value = s.title; $("stText").value = s.text; $("stNote").value = s.note;
    paintNote();
    paintImgInfo();
  }
  function paintNote() {
    const s = step(); if (!s) return;
    $("noteSeg").querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.k === s.noteKind)));
    $("stNote").hidden = s.noteKind === "none";
  }
  function paintImgInfo() {
    const s = step(); if (!s) return;
    const has = !!bmpOf(s);
    $("imgInfo").textContent = has
      ? s.img.w + " × " + s.img.h + " px" + (s.crop ? " · cropped to " + s.crop.w + " × " + s.crop.h : "") + " · " + plural(s.anns.length, "annotation")
      : s.img ? "Image missing from this browser — add it again" : "No image (text-only step)";
    $("setImgBtn").textContent = has ? "Replace…" : "Add image…";
    ["copyImgBtn", "pngBtn", "rmImgBtn"].forEach(id => { $(id).disabled = !has; });
    $("uncropBtn").hidden = !s.crop;
  }
  function paintEmpty() {
    const s = step();
    $("emptyTitle").textContent = !s ? "Paste a screenshot" : "This step has no image";
    $("emptyText").innerHTML = !s
      ? "Press <kbd>Ctrl</kbd>+<kbd>V</kbd> to paste, or drop image files here. Each image becomes one step."
      : "Paste (<kbd>Ctrl</kbd>+<kbd>V</kbd>) or drop an image to add it here, or keep this as a text-only step.";
  }
  function paintStats() {
    const imgs = doc.steps.filter(s => bmpOf(s)).length, anns = doc.steps.reduce((n, s) => n + s.anns.length, 0);
    $("stats").textContent = plural(doc.steps.length, "step") + " · " + plural(imgs, "image") + " · " + plural(anns, "annotation");
    if (step()) paintImgInfo();
  }

  $("stTitle").addEventListener("input", e => {
    const s = step(); if (!s) return;
    s.title = e.target.value;
    const t = $("stepList").querySelector('[data-id="' + s.id + '"] .t');
    if (t) { t.textContent = s.title || "Untitled step"; t.classList.toggle("ph", !s.title); }
    touched();
  });
  $("stText").addEventListener("input", e => { const s = step(); if (s) { s.text = e.target.value; touched(); } });
  $("stNote").addEventListener("input", e => { const s = step(); if (s) { s.note = e.target.value; touched(); } });
  $("noteSeg").addEventListener("click", e => {
    const b = e.target.closest("button"); const s = step(); if (!b || !s) return;
    s.noteKind = b.dataset.k; paintNote(); touched();
    if (s.noteKind !== "none") $("stNote").focus();
  });
  $("upBtn").addEventListener("click", () => moveStepTo(cur, cur - 1));
  $("downBtn").addEventListener("click", () => moveStepTo(cur, cur + 1));
  $("dupBtn").addEventListener("click", dupStep);
  $("rmBtn").addEventListener("click", removeStep);
  $("addStepBtn").addEventListener("click", addStep);

  // ---------- image import ----------
  // mode: "auto" (fill an empty current step, else new step after it) | "replace"
  async function addImages(files, mode) {
    const imgs = files.filter(f => f && /^image\//.test(f.type));
    if (!imgs.length) return;
    let added = 0, failed = 0;
    for (const f of imgs) {
      let img;
      try { img = await storeImage(f); } catch (e) { failed++; continue; }
      img.name = f.name && !/^image\.\w+$/.test(f.name) ? f.name : "";
      let s = step();
      if (mode === "replace" && s) {
        const old = s.img && s.img.key;
        Object.assign(s, { img, crop: null, anns: [] });
        releaseImage(old);
        mode = "auto";
      } else if (s && !s.img) {
        s.img = img;
      } else {
        s = newStep(); s.img = img;
        doc.steps.splice(cur + 1, 0, s);
        cur++;
      }
      thumbs.delete(s.id);
      added++;
    }
    undo.length = 0; redo.length = 0; paintUndo();
    renderSteps(); select(cur); touched(); paintStats();
    if (failed) toast(plural(failed, "image") + " could not be read (format not supported).", "warn");
    else if (added > 1) toast("Added " + plural(added, "image") + " as steps");
  }

  async function setImageForStep(file) {
    const s = step(); if (!s || !file) return;
    if (s.img && (s.anns.length || s.crop) && !await confirmBox("Replace image", "<p>Replace the image of step " + (cur + 1) + "? Its " + plural(s.anns.length, "annotation") + (s.crop ? " and crop" : "") + " will be removed.</p>", "Replace", true)) return;
    addImages([file], "replace");
  }

  async function removeImage() {
    const s = step(); if (!s || !s.img) return;
    if (s.anns.length && !await confirmBox("Remove image", "<p>Remove the image and its " + plural(s.anns.length, "annotation") + " from step " + (cur + 1) + "?</p>", "Remove", true)) return;
    const key = s.img.key;
    Object.assign(s, { img: null, crop: null, anns: [] });
    releaseImage(key);
    thumbs.delete(s.id);
    undo.length = 0; redo.length = 0; paintUndo();
    renderSteps(); select(cur); touched(); paintStats();
  }

  document.addEventListener("paste", e => {
    if (ed.editingText()) return;
    const files = [...((e.clipboardData && e.clipboardData.items) || [])]
      .filter(it => it.kind === "file" && /^image\//.test(it.type)).map(it => it.getAsFile()).filter(Boolean);
    if (!files.length) return;
    e.preventDefault();
    addImages(files, "auto");
  });
  $("imgFile").addEventListener("change", e => { addImages([...e.target.files], "auto"); e.target.value = ""; });
  $("oneImgFile").addEventListener("change", e => { setImageForStep(e.target.files[0]); e.target.value = ""; });
  $("addImgBtn").addEventListener("click", () => $("imgFile").click());
  $("emptyPick").addEventListener("click", () => step() ? $("oneImgFile").click() : $("imgFile").click());
  $("setImgBtn").addEventListener("click", () => $("oneImgFile").click());
  $("rmImgBtn").addEventListener("click", removeImage);
  $("copyImgBtn").addEventListener("click", copyImage);
  $("pngBtn").addEventListener("click", exportPng);

  // ---------- tools toolbar ----------
  const TOOL_KEYS = { v: "select", a: "arrow", l: "line", r: "rect", e: "ellipse", h: "hl", p: "pen", t: "text", n: "num", b: "blur", s: "spot", c: "crop" };
  $("tools").querySelectorAll("[data-tool]").forEach(b => b.addEventListener("click", () => ed.setTool(b.dataset.tool)));
  function paintTools() {
    const has = !!bmpOf(step()), t = ed.tool();
    $("tools").querySelectorAll("[data-tool]").forEach(b => { b.setAttribute("aria-pressed", String(b.dataset.tool === t)); b.disabled = !has; });
    ["zoomIn", "zoomOut"].forEach(id => { $(id).disabled = !has; });
  }

  (function buildStyleUi() {
    const sw = $("swatches");
    COLORS.forEach(c => {
      const b = document.createElement("button");
      b.className = "sw"; b.style.background = c; b.dataset.c = c; b.title = c; b.setAttribute("aria-label", "Colour " + c);
      b.addEventListener("click", () => setStyle({ c }));
      sw.appendChild(b);
    });
    const cust = document.createElement("label");
    cust.className = "sw sw-custom"; cust.title = "Custom colour";
    cust.innerHTML = '<input type="color" aria-label="Custom colour">';
    cust.querySelector("input").addEventListener("change", e => setStyle({ c: e.target.value.toUpperCase() }));
    sw.appendChild(cust);
    const seg = $("lvlSeg");
    [5, 7, 10, 13].forEach((d, i) => {
      const b = document.createElement("button");
      b.dataset.l = i; b.title = "Size " + (i + 1) + " (" + (i + 1) + ")";
      b.innerHTML = '<span class="lvl-dot" style="width:' + d + 'px;height:' + d + 'px"></span>';
      b.addEventListener("click", () => setStyle({ lvl: i }));
      seg.appendChild(b);
    });
    $("fillBtn").addEventListener("click", () => setStyle({ fill: !ui.fill }));
  })();
  function setStyle(p) {
    Object.assign(ui, p); saveUi();
    ed.setStyle(p);
    paintStyle();
  }
  function paintStyle() {
    let custom = true;
    $("swatches").querySelectorAll(".sw[data-c]").forEach(b => { const on = b.dataset.c.toUpperCase() === String(ui.c).toUpperCase(); if (on) custom = false; b.setAttribute("aria-pressed", String(on)); });
    const cust = $("swatches").querySelector(".sw-custom");
    cust.setAttribute("aria-pressed", String(custom));
    cust.style.boxShadow = custom ? "0 0 0 2px var(--text)" : "";
    cust.querySelector("input").value = /^#[0-9a-f]{6}$/i.test(ui.c) ? ui.c : "#e5322d";
    $("lvlSeg").querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.l === ui.lvl)));
    $("fillBtn").setAttribute("aria-pressed", String(!!ui.fill));
  }
  function paintUndo() { $("undoBtn").disabled = !undo.length; $("redoBtn").disabled = !redo.length; }
  function paintDel() { $("delBtn").disabled = !ed.selected(); }

  $("undoBtn").addEventListener("click", () => travel(undo, redo));
  $("redoBtn").addEventListener("click", () => travel(redo, undo));
  $("delBtn").addEventListener("click", () => { ed.deleteSel(); paintDel(); });
  $("uncropBtn").addEventListener("click", () => ed.resetCrop());
  $("zoomIn").addEventListener("click", () => ed.zoomBy(1.25));
  $("zoomOut").addEventListener("click", () => ed.zoomBy(0.8));
  $("zoomLbl").addEventListener("click", () => ed.fit());

  // ---------- doc id + info dialog ----------
  $("docTitle").addEventListener("input", e => { doc.meta.title = e.target.value; touched(); });
  $("docNo").addEventListener("input", e => { doc.meta.docNo = e.target.value; touched(); });
  function paintDocId() { $("docTitle").value = doc.meta.title; $("docNo").value = doc.meta.docNo; document.title = (doc.meta.title ? doc.meta.title + " · " : "") + "Work Instructions"; }

  function infoDialog() {
    const m = doc.meta;
    const f = (id, label, ph, val, area) => '<div class="field"><label for="m_' + id + '">' + label + "</label>" +
      (area ? '<textarea id="m_' + id + '" data-k="' + id + '" placeholder="' + esc(ph) + '">' + esc(val) + "</textarea>"
        : '<input id="m_' + id + '" data-k="' + id + '" placeholder="' + esc(ph) + '" value="' + esc(val) + '" autocomplete="off">') + "</div>";
    const histRows = () => doc.history.map((r, i) => "<tr>" + ["rev", "date", "by", "change"].map(k =>
      '<td><input data-h="' + i + '" data-hk="' + k + '" value="' + esc(r[k]) + '" placeholder="' + { rev: "A", date: today(), by: "Initials", change: "What changed" }[k] + '"></td>').join("") +
      '<td><button class="icon-btn" data-hdel="' + i + '" aria-label="Remove row">✕</button></td></tr>').join("");
    const body =
      f("title", "Title", "Untitled work instruction", m.title) +
      '<div class="field-row three">' + f("docNo", "Document number", "WI-0000", m.docNo) + f("rev", "Revision", "A", m.rev) + f("date", "Date", today(), m.date) + "</div>" +
      '<div class="field-row">' + f("product", "Product / area", "Product, line or system", m.product) + f("author", "Author", "Name", m.author) + "</div>" +
      f("purpose", "Purpose and scope", "What this instruction covers and who it is for.", m.purpose, true) +
      '<div class="field-row">' + f("tools", "Tools and materials", "- One item per line", m.tools, true) + f("safety", "Safety and PPE", "- One item per line", m.safety, true) + "</div>" +
      '<div class="field"><span class="lbl" style="font:500 10.5px var(--mono);text-transform:uppercase;letter-spacing:.08em;color:var(--text-faint)">Revision history</span>' +
      '<table class="hist-tbl"><thead><tr><th style="width:70px">Rev</th><th style="width:120px">Date</th><th style="width:110px">By</th><th>Change</th><th style="width:30px"></th></tr></thead><tbody id="histBody">' + histRows() + "</tbody></table>" +
      '<div><button class="btn btn-sm" id="histAdd">＋ Add revision</button></div></div>' +
      '<div class="field" style="max-width:220px"><label for="m_page">PDF page size</label><select id="m_page" data-k="page"><option value="letter">Letter (8.5 × 11 in)</option><option value="a4">A4 (210 × 297 mm)</option></select></div>';
    openModal("Document", body, [{ label: "Done", cls: "btn-primary", onClick: closeModal }], true);
    const mb = $("modalBody");
    $("m_page").value = m.page === "a4" ? "a4" : "letter";
    mb.addEventListener("input", e => {
      const t = e.target;
      if (t.dataset.k) { m[t.dataset.k] = t.value; paintDocId(); touched(); }
      else if (t.dataset.h) { doc.history[+t.dataset.h][t.dataset.hk] = t.value; touched(); }
    });
    mb.addEventListener("change", e => { if (e.target.id === "m_page") { m.page = e.target.value; touched(); } });
    mb.addEventListener("click", e => {
      const del = e.target.closest("[data-hdel]");
      if (del) { doc.history.splice(+del.dataset.hdel, 1); $("histBody").innerHTML = histRows(); touched(); }
      if (e.target.id === "histAdd") {
        doc.history.push({ rev: m.rev || "", date: today(), by: m.author || "", change: doc.history.length ? "" : "Initial release" });
        $("histBody").innerHTML = histRows(); touched();
        const ins = $("histBody").querySelectorAll("tr:last-child input"); if (ins.length) ins[ins.length - 1].focus();
      }
    });
  }
  $("infoBtn").addEventListener("click", infoDialog);

  // ---------- modal / toast ----------
  let modalClose = null;
  function openModal(title, bodyHtml, buttons, wide) {
    $("modalTitle").textContent = title;
    const old = $("modalBody"), fresh = old.cloneNode(false);   // drop old listeners
    old.replaceWith(fresh);
    fresh.innerHTML = bodyHtml;
    const foot = $("modalFoot"); foot.textContent = "";
    buttons.forEach(b => {
      const el = document.createElement("button");
      el.className = "btn " + (b.cls || ""); el.textContent = b.label;
      el.addEventListener("click", b.onClick);
      foot.appendChild(el);
    });
    $("modal").classList.toggle("wide", !!wide);
    $("overlay").classList.add("open");
    const first = fresh.querySelector("input,textarea,select") || foot.querySelector(".btn-primary");
    if (first) setTimeout(() => first.focus(), 30);
  }
  function closeModal() {
    if (modalClose) { const f = modalClose; modalClose = null; f(); return; }
    $("overlay").classList.remove("open");
  }
  function confirmBox(title, html, okLabel, danger) {
    return new Promise(res => {
      let done = false;
      const finish = v => { if (done) return; done = true; modalClose = null; $("overlay").classList.remove("open"); res(v); };
      openModal(title, html, [
        { label: "Cancel", onClick: () => finish(false) },
        { label: okLabel || "OK", cls: danger ? "btn-danger" : "btn-primary", onClick: () => finish(true) }
      ]);
      modalClose = () => finish(false);
    });
  }
  $("modalX").addEventListener("click", closeModal);
  $("overlay").addEventListener("mousedown", e => { if (e.target === $("overlay")) closeModal(); });

  function toast(msg, kind) {
    const t = document.createElement("div");
    t.className = "toast" + (kind ? " " + kind : ""); t.textContent = msg;
    $("toasts").appendChild(t);
    setTimeout(() => t.remove(), kind === "err" ? 7000 : 3800);
  }

  // ---------- menus ----------
  function menu(btnId, menuId, act) {
    const btn = $(btnId), m = $(menuId);
    const close = () => { m.hidden = true; btn.setAttribute("aria-expanded", "false"); };
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const open = m.hidden;
      document.querySelectorAll(".menu").forEach(x => { x.hidden = true; });
      m.hidden = !open; btn.setAttribute("aria-expanded", String(open));
      if (open) { const f = m.querySelector("button"); if (f) f.focus(); }
    });
    m.addEventListener("click", e => { const b = e.target.closest("[data-act]"); if (b) { close(); act(b.dataset.act); } });
    document.addEventListener("click", e => { if (!m.hidden && !m.contains(e.target)) close(); });
    document.addEventListener("keydown", e => { if (e.key === "Escape" && !m.hidden) { close(); btn.focus(); } });
  }
  menu("projBtn", "projMenu", a => ({ save: saveProject, open: () => $("projFile").click(), new: newDocument, keys: keysDialog })[a]());
  menu("expBtn", "expMenu", a => ({ docx: exportDocx, bundle: exportBundle, pdf: exportPdf, html: exportHtml, md: copyMarkdown, png: exportPng, copy: copyImage, pngs: exportPngs })[a]());

  // ---------- files ----------
  function baseName() {
    const s = [doc.meta.docNo, doc.meta.title].filter(x => String(x || "").trim()).join(" ");
    return (s.replace(/[\\/:*?"<>|#%]+/g, "-").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 80)) || "work-instruction";
  }
  function download(name, blob) {
    const url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  // Ask for the file first (needs the click's user activation), then build it.
  async function saveFile(name, build, desc, mime, ext) {
    let handle = null;
    if (window.showSaveFilePicker) {
      try {
        handle = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: desc, accept: { [mime]: [ext] } }] });
      } catch (e) {
        if (e && e.name === "AbortError") return false;
        handle = null;
      }
    }
    const blob = await build();
    if (handle) {
      const w = await handle.createWritable();
      await w.write(blob); await w.close();
      toast("Saved " + handle.name);
    } else {
      download(name, blob);
      toast("Downloaded " + name);
    }
    return true;
  }
  const busy = async (label, fn) => {
    setSaveStat(label + "…");
    try { return await fn(); }
    catch (e) { console.error(e); toast(label + " failed: " + (e && e.message || e), "err"); }
    finally { setSaveStat(storageOk ? "Saved in this browser" : "Browser storage unavailable — save a project file", !storageOk); }
  };

  const canvases = maxDim => doc.steps.map(s => bmpOf(s) ? X.stepCanvas(s, bmpOf(s), maxDim) : null);
  const needSteps = () => { if (!doc.steps.length) { toast("Nothing to export yet. Paste a screenshot first.", "warn"); return false; } return true; };
  const needImg = () => { if (!bmpOf(step())) { toast("This step has no image.", "warn"); return false; } return true; };

  function exportPng() {
    if (!needImg()) return;
    const s = step(), name = baseName() + "_step-" + pad2(cur + 1) + ".png";
    busy("PNG export", () => saveFile(name, () => X.toBlob(X.stepCanvas(s, bmpOf(s))), "PNG image", "image/png", ".png"));
  }
  async function copyImage() {
    if (!needImg()) return;
    if (!navigator.clipboard || !window.ClipboardItem) return toast("This browser can't copy images. Use Save PNG.", "warn");
    const s = step();
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": X.toBlob(X.stepCanvas(s, bmpOf(s))) })]);
      toast("Step " + (cur + 1) + " image copied — paste it into the wiki editor");
    } catch (e) { toast("Copy failed: " + (e.message || e), "err"); }
  }
  function exportPdf() {
    if (!needSteps()) return;
    busy("PDF export", () => saveFile(baseName() + ".pdf", async () => X.pdf(doc, canvases(2000)).output("blob"), "PDF document", "application/pdf", ".pdf"));
  }
  function exportHtml() {
    if (!needSteps()) return;
    busy("HTML export", () => saveFile(baseName() + ".html", async () => {
      const cvs = canvases();
      return new Blob([X.htmlFile(doc, (s, i) => cvs[i] ? cvs[i].toDataURL("image/png") : null)], { type: "text/html" });
    }, "HTML page", "text/html", ".html"));
  }
  async function copyMarkdown() {
    if (!needSteps()) return;
    const md = X.markdown(doc, (s, i) => bmpOf(s) ? "images/" + X.imgName(i) : null);
    try { await navigator.clipboard.writeText(md); toast("Markdown copied. Export the wiki bundle or all step images for the image files."); }
    catch (e) { toast("Copy failed: " + (e.message || e), "err"); }
  }
  const u8 = async blob => new Uint8Array(await blob.arrayBuffer());
  async function pngList(cvs) {
    const out = [];
    for (const c of cvs) out.push(c ? { data: await u8(await X.toBlob(c)), w: c.width, h: c.height } : null);
    return out;
  }
  function exportDocx() {
    if (!needSteps()) return;
    busy("Word export", () => saveFile(baseName() + ".docx", async () => X.docx(doc, await pngList(canvases())),
      "Word document", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".docx"));
  }
  async function imageFiles(cvs) {
    const out = [];
    for (let i = 0; i < cvs.length; i++) if (cvs[i]) out.push({ name: "images/" + X.imgName(i), data: await u8(await X.toBlob(cvs[i])) });
    return out;
  }
  function exportBundle() {
    if (!needSteps()) return;
    const base = baseName();
    busy("Wiki bundle", () => saveFile(base + ".zip", async () => {
      const cvs = canvases(), path = (s, i) => cvs[i] ? "images/" + X.imgName(i) : null;
      const enc = new TextEncoder();
      const files = [
        { name: base + ".md", data: enc.encode(X.markdown(doc, path)) },
        { name: base + ".html", data: enc.encode(X.htmlFile(doc, path)) },
        { name: base + ".pdf", data: new Uint8Array(X.pdf(doc, canvases(2000)).output("arraybuffer")) },
        { name: base + ".docx", data: await u8(X.docx(doc, await pngList(cvs))) }
      ].concat(await imageFiles(cvs));
      return X.zip(files);
    }, "ZIP archive", "application/zip", ".zip"));
  }
  function exportPngs() {
    if (!doc.steps.some(s => bmpOf(s))) return toast("No step has an image yet.", "warn");
    busy("Image export", () => saveFile(baseName() + "_images.zip", async () => X.zip(await imageFiles(canvases())), "ZIP archive", "application/zip", ".zip"));
  }

  // ---------- project files ----------
  const readDataUrl = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
  function dataUrlBlob(url) {
    const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(String(url));
    if (!m || !m[2]) throw new Error("Bad image data in project file");
    const bin = atob(m[3]), a = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return new Blob([a], { type: m[1] || "image/png" });
  }
  function saveProject() {
    busy("Project save", () => saveFile(baseName() + ".wiproj", async () => {
      const images = {};
      for (const s of doc.steps) if (s.img && blobs.has(s.img.key) && !images[s.img.key]) images[s.img.key] = await readDataUrl(blobs.get(s.img.key));
      return new Blob([JSON.stringify({ format: "atlas-wi-project", v: 1, savedAt: new Date().toISOString(), app: REV, doc, images })], { type: "application/json" });
    }, "Work instruction project", "application/json", ".wiproj"));
  }
  async function openProject(file) {
    let data;
    try { data = JSON.parse(await file.text()); } catch (e) { return toast("Not a project file: " + file.name, "err"); }
    if (!data || data.format !== "atlas-wi-project" || !data.doc) return toast("Not a work instruction project file: " + file.name, "err");
    if (hasContent() && !await confirmBox("Open project", "<p>Replace the document in this browser with <b>" + esc(file.name) + "</b>?</p><p>Save a project file first if you need the current one.</p>", "Open")) return;
    const bl = new Map(), bm = new Map();
    let missing = 0;
    for (const [k, url] of Object.entries(data.images || {})) {
      try { const b = dataUrlBlob(url); bm.set(k, await createImageBitmap(b)); bl.set(k, b); } catch (e) { missing++; }
    }
    await replaceDoc(normalize(data.doc), bl, bm);
    toast("Opened " + file.name + (missing ? " · " + plural(missing, "image") + " could not be read" : ""), missing ? "warn" : "");
  }
  async function replaceDoc(d, bl, bm) {
    bitmaps.forEach(b => b.close && b.close());
    blobs.clear(); bitmaps.clear(); thumbs.clear();
    bl.forEach((v, k) => blobs.set(k, v)); bm.forEach((v, k) => bitmaps.set(k, v));
    doc = d;
    undo.length = 0; redo.length = 0; paintUndo();
    try {
      await idb.clear();
      for (const [k, b] of blobs) await idb.set("img:" + k, b);
    } catch (e) { storageOk = false; }
    cur = doc.steps.length ? 0 : -1;
    paintDocId(); renderSteps(); select(cur); paintStats();
    await saveNow();
  }
  async function newDocument() {
    if (hasContent() && !await confirmBox("New document", "<p>Clear the document in this browser and start again?</p><p>Save a project file first if you need this one. This can't be undone.</p>", "Clear and start", true)) return;
    await replaceDoc(blankDoc(), new Map(), new Map());
    toast("New document");
  }
  $("projFile").addEventListener("change", e => { const f = e.target.files[0]; e.target.value = ""; if (f) openProject(f); });

  // ---------- preview ----------
  let pvUrls = [];
  async function openPreview() {
    if (!needSteps()) return;
    if (!document.getElementById("wiDocCss")) {
      const st = document.createElement("style"); st.id = "wiDocCss"; st.textContent = X.DOC_CSS; document.head.appendChild(st);
    }
    const cvs = canvases();
    pvUrls = await Promise.all(cvs.map(async c => c ? URL.createObjectURL(await X.toBlob(c)) : null));
    $("pvScroll").innerHTML = X.docHtml(doc, (s, i) => pvUrls[i]);
    $("previewOv").hidden = false;
    $("pvClose").focus();
  }
  function closePreview() {
    $("previewOv").hidden = true; $("pvScroll").textContent = "";
    pvUrls.forEach(u => u && URL.revokeObjectURL(u)); pvUrls = [];
  }
  $("previewBtn").addEventListener("click", openPreview);
  $("pvClose").addEventListener("click", closePreview);
  $("pvPdf").addEventListener("click", exportPdf);

  function keysDialog() {
    const k = (keys, what) => "<span>" + keys.map(x => "<kbd>" + x + "</kbd>").join("+") + "</span><span>" + what + "</span>";
    openModal("Keyboard shortcuts", '<div class="keys-tbl">' + [
      k(["Ctrl", "V"], "Paste screenshot"), k(["V"], "Select / move"),
      k(["A"], "Arrow"), k(["L"], "Line"), k(["R"], "Box"), k(["E"], "Ellipse"),
      k(["H"], "Highlight"), k(["P"], "Freehand"), k(["T"], "Text"), k(["N"], "Numbered callout"),
      k(["B"], "Pixelate"), k(["S"], "Spotlight"), k(["C"], "Crop"), k(["F"], "Fill on / off"),
      k(["1–4"], "Size"), k(["Shift"], "Snap 45° / square"),
      k(["Del"], "Delete annotation"), k(["←", "→"], "Nudge (Shift: 10 px)"),
      k(["["], "Send to back"), k(["]"], "Bring to front"),
      k(["Ctrl", "Z"], "Undo"), k(["Ctrl", "Y"], "Redo"),
      k(["Space"], "Hold and drag to pan"), k(["0"], "Fit to window"),
      k(["PgUp"], "Previous step"), k(["PgDn"], "Next step"),
      k(["Alt", "↑"], "Move step up"), k(["Alt", "↓"], "Move step down"),
      k(["Ctrl", "Enter"], "New empty step"), k(["Ctrl", "P"], "Preview"),
      k(["Ctrl", "E"], "Save PNG of step"), k(["Ctrl", "Shift", "C"], "Copy step image"),
      k(["Ctrl", "S"], "Save project file"), k(["Ctrl", "O"], "Open project file")
    ].join("") + "</div>", [{ label: "OK", cls: "btn-primary", onClick: closeModal }], true);
  }

  // ---------- keyboard ----------
  document.addEventListener("keydown", e => {
    if ($("overlay").classList.contains("open")) { if (e.key === "Escape") closeModal(); return; }
    if (!$("previewOv").hidden) { if (e.key === "Escape") closePreview(); return; }
    const t = e.target, inField = /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable;
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (mod && !e.altKey) {
      if (k === "s") { e.preventDefault(); saveProject(); }
      else if (k === "o") { e.preventDefault(); $("projFile").click(); }
      else if (k === "p") { e.preventDefault(); openPreview(); }
      else if (k === "e") { e.preventDefault(); exportPng(); }
      else if (k === "c" && e.shiftKey) { e.preventDefault(); copyImage(); }
      else if (k === "enter") { e.preventDefault(); addStep(); }
      else if (!inField && k === "z") { e.preventDefault(); e.shiftKey ? travel(redo, undo) : travel(undo, redo); }
      else if (!inField && k === "y") { e.preventDefault(); travel(redo, undo); }
      return;
    }
    if (inField || ed.editingText()) return;
    if (e.altKey) {
      if (e.key === "ArrowUp") { e.preventDefault(); moveStepTo(cur, cur - 1); }
      else if (e.key === "ArrowDown") { e.preventDefault(); moveStepTo(cur, cur + 1); }
      return;
    }
    if (e.key === " ") { e.preventDefault(); ed.setSpace(true); return; }
    if (e.key === "Delete" || e.key === "Backspace") { if (ed.deleteSel()) { e.preventDefault(); paintDel(); } return; }
    if (e.key === "Escape") { if (ed.tool() === "crop") ed.setTool("select"); else { ed.clearSel(); paintDel(); } return; }
    if (e.key.startsWith("Arrow")) {
      const d = e.shiftKey ? 10 : 1;
      const v = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] }[e.key];
      if (ed.nudge(v[0], v[1])) e.preventDefault();
      else if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); select(cur + (e.key === "ArrowUp" ? -1 : 1)); }
      return;
    }
    if (e.key === "PageUp") { e.preventDefault(); select(cur - 1); return; }
    if (e.key === "PageDown") { e.preventDefault(); select(cur + 1); return; }
    if (!bmpOf(step())) return;
    if (TOOL_KEYS[k] && !e.shiftKey) { ed.setTool(TOOL_KEYS[k]); return; }
    if (k === "f") setStyle({ fill: !ui.fill });
    else if (/^[1-4]$/.test(k)) setStyle({ lvl: +k - 1 });
    else if (k === "0") ed.fit();
    else if (k === "+" || k === "=") ed.zoomBy(1.25);
    else if (k === "-") ed.zoomBy(0.8);
    else if (k === "[") ed.order(-1);
    else if (k === "]") ed.order(1);
  });
  document.addEventListener("keyup", e => { if (e.key === " ") ed.setSpace(false); });
  window.addEventListener("blur", () => ed.setSpace(false));

  // ---------- drag and drop: images → steps, .wiproj → open ----------
  let dragDepth = 0;
  const hasFiles = e => e.dataTransfer && [...e.dataTransfer.types].includes("Files");
  window.addEventListener("dragenter", e => { if (hasFiles(e)) { dragDepth++; document.body.classList.add("drag"); } });
  window.addEventListener("dragleave", e => { if (hasFiles(e) && --dragDepth <= 0) { dragDepth = 0; document.body.classList.remove("drag"); } });
  window.addEventListener("dragover", e => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener("drop", e => {
    if (!hasFiles(e)) return;
    e.preventDefault(); dragDepth = 0; document.body.classList.remove("drag");
    const files = [...e.dataTransfer.files];
    const proj = files.find(f => /\.(wiproj|json)$/i.test(f.name));
    const imgs = files.filter(f => /^image\//.test(f.type));
    if (proj) openProject(proj);
    else if (imgs.length) addImages(imgs, "auto");
    else toast("Drop image files or a .wiproj project.", "warn");
  });

  window.addEventListener("beforeunload", e => {
    if (!storageOk && hasContent()) { e.preventDefault(); e.returnValue = ""; }
  });

  // ---------- theme ----------
  function applyTheme() {
    const t = ui.theme || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    document.documentElement.dataset.theme = t;
  }
  $("themeBtn").addEventListener("click", () => {
    ui.theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    saveUi(); applyTheme();
  });

  // ---------- boot ----------
  (() => {
    const im = new Image();
    im.onload = () => document.documentElement.classList.add("has-wm");
    im.src = "../../assets/brand/wordmark.png";
  })();
  applyTheme();
  $("rev").textContent = "Work Instructions · " + REV;
  paintStyle(); paintUndo(); paintDel(); paintDocId(); renderSteps(); fillInspector(); paintEmpty(); paintTools(); paintStats();
  console.log("Work Instructions — " + REV);

  (async () => {
    try {
      const saved = await idb.get("doc");
      if (saved && Array.isArray(saved.steps)) {
        const d = normalize(saved);
        let missing = 0;
        for (const s of d.steps) {
          if (!s.img || bitmaps.has(s.img.key)) continue;
          const b = await idb.get("img:" + s.img.key);
          if (!b) { missing++; continue; }
          try { bitmaps.set(s.img.key, await createImageBitmap(b)); blobs.set(s.img.key, b); } catch (e) { missing++; }
        }
        doc = d;
        cur = doc.steps.length ? 0 : -1;
        paintDocId(); renderSteps(); select(cur); paintStats();
        if (doc.steps.length) setSaveStat("Restored from this browser");
        if (missing) toast(plural(missing, "image") + " missing from browser storage.", "warn");
      }
      // Remove images no step uses.
      const used = new Set(doc.steps.filter(s => s.img).map(s => "img:" + s.img.key));
      (await idb.keys()).forEach(k => { if (String(k).startsWith("img:") && !used.has(k)) idb.del(k).catch(() => {}); });
    } catch (e) {
      storageOk = false;
      setSaveStat("Browser storage unavailable — save a project file", true);
    }
  })();
})();
