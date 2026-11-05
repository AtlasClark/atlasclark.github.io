/*
  Quick Cable — page logic
  Scope: connector images (pick, paste, drop; rotate / flip), auto layout,
  select / move / pan / zoom, label tools (length, text, callout, balloon),
  notes, inspector, title-block dialog, undo, autosave to IndexedDB,
  .qcable project files, PDF / PNG / SVG export, theme.
*/
(function () {
  "use strict";
  const REV = "rev 1.1.0";
  const QC = window.QC;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const LS_UI = "quickCable.ui";
  const ui = { theme: null };
  try { Object.assign(ui, JSON.parse(localStorage.getItem(LS_UI) || "{}")); } catch (e) { /* defaults */ }
  const saveUi = () => { try { localStorage.setItem(LS_UI, JSON.stringify(ui)); } catch (e) { /* view prefs only */ } };

  // ---------- IndexedDB ----------
  const idb = (() => {
    let dbp = null;
    const open = () => dbp || (dbp = new Promise((res, rej) => {
      const r = indexedDB.open("quick-cable", 1);
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
    return { get: k => run("readonly", s => s.get(k)), set: (k, v) => run("readwrite", s => s.put(v, k)), del: k => run("readwrite", s => s.delete(k)) };
  })();

  // ---------- state ----------
  let p = QC.blank();
  let imgs = {};               // image key -> {data, w, h}: originals, saved with the project
  const baked = new Map();     // "key|rot|flip" -> {key, data, w, h}
  const baking = new Set();
  let logo = null;             // title-block logo: this browser only
  let sel = null;              // end:<id> det:<id> dim:<id> lbl:<id> hub cable notes
  let tool = "select";
  let sc = null;
  let storageOk = true;
  const view = { x: 0, y: 0, s: 1 };
  const kindOf = id => id ? id.split(":")[0] : null;
  const idOf = id => id ? id.split(":")[1] : null;
  const endById = id => p.ends.find(e => e.id === id);
  const dimById = id => p.dims.find(d => d.id === id);
  const lblById = id => p.labels.find(l => l.id === id);
  const selEnd = () => (kindOf(sel) === "end" || kindOf(sel) === "det") ? endById(idOf(sel)) : null;

  // ---------- undo ----------
  let undoStack = [], redoStack = [], lastKey = null, lastT = 0;
  function pushUndo(key) {
    const now = Date.now();
    if (key && key === lastKey && now - lastT < 1500) { lastT = now; return; }
    lastKey = key || null; lastT = now;
    undoStack.push(JSON.stringify(p));
    if (undoStack.length > 120) undoStack.shift();
    redoStack = [];
    paintUndo();
  }
  function undo(back) {
    const from = back ? redoStack : undoStack, to = back ? undoStack : redoStack;
    if (!from.length) return;
    to.push(JSON.stringify(p));
    p = JSON.parse(from.pop());
    lastKey = null;
    if (sel && !groupExists(sel)) sel = null;
    changed();
  }
  const groupExists = id => {
    const k = kindOf(id), i = idOf(id);
    return k === "end" || k === "det" ? !!endById(i) : k === "dim" ? !!dimById(i) : k === "lbl" ? !!lblById(i) : k === "hub" ? p.ends.length > 2 : k === "notes" ? p.notes.length > 0 : k === "cable" ? p.ends.length > 0 : false;
  };
  function paintUndo() { $("undoBtn").disabled = !undoStack.length; $("redoBtn").disabled = !redoStack.length; }

  // ---------- images ----------
  const readUrl = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(f); });
  const loadImg = src => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error("Image did not load")); im.src = src; });
  async function importImage(file, maxSide) {
    maxSide = maxSide || 1600;
    const isSvg = file.type === "image/svg+xml" || /\.svg$/i.test(file.name || "");
    let data = await readUrl(file);
    if (isSvg && !/^data:image\/svg\+xml/.test(data)) data = "data:image/svg+xml;base64," + data.split(",")[1];
    const im = await loadImg(data);
    let w = im.naturalWidth || 800, h = im.naturalHeight || 600;
    const keep = /^data:image\/(png|jpeg)/.test(data) && Math.max(w, h) <= maxSide;
    if (!keep) {   // SVG, WebP, GIF, BMP or a big picture: redraw as PNG / JPEG
      const k = isSvg ? Math.min(4, 1400 / Math.max(w, h)) : Math.min(1, maxSide / Math.max(w, h));
      const cv = document.createElement("canvas");
      cv.width = Math.max(1, Math.round(w * k)); cv.height = Math.max(1, Math.round(h * k));
      cv.getContext("2d").drawImage(im, 0, 0, cv.width, cv.height);
      const jpeg = /jpe?g/i.test(file.type);
      data = cv.toDataURL(jpeg ? "image/jpeg" : "image/png", 0.9);
      w = cv.width; h = cv.height;
    }
    return { data, w, h };
  }
  const picKey = e => e.img + "|" + e.rot + "|" + (e.flip ? 1 : 0);
  async function bake(e) {
    const k = picKey(e), src = imgs[e.img];
    if (!src || baked.has(k) || baking.has(k)) return;
    baking.add(k);
    try {
      const im = await loadImg(src.data), sw = im.naturalWidth, sh = im.naturalHeight, swap = e.rot % 180 !== 0;
      const cv = document.createElement("canvas");
      cv.width = swap ? sh : sw; cv.height = swap ? sw : sh;
      const g = cv.getContext("2d");
      g.translate(cv.width / 2, cv.height / 2);
      if (e.flip) g.scale(-1, 1);
      g.rotate(e.rot * Math.PI / 180);
      g.drawImage(im, -sw / 2, -sh / 2);
      const jpeg = /^data:image\/jpeg/.test(src.data);
      baked.set(k, { key: k, data: cv.toDataURL(jpeg ? "image/jpeg" : "image/png", 0.92), w: cv.width, h: cv.height });
    } catch (err) { console.warn(err); }
    baking.delete(k);
    render(); renderSide();
    if (selEnd() === e && !$("inspBody").contains(document.activeElement)) renderInspector();
  }
  function getPics() {
    const out = {};
    p.ends.forEach(e => {
      const src = e.img && imgs[e.img];
      if (!src) return;
      if (!e.rot && !e.flip) { out[e.id] = { key: e.img, data: src.data, w: src.w, h: src.h }; return; }
      const b = baked.get(picKey(e));
      if (b) out[e.id] = b;
      else { bake(e); out[e.id] = { key: e.img, data: src.data, w: src.w, h: src.h }; }   // original until the turned copy is ready
    });
    return out;
  }
  async function readyPics() {
    await Promise.all(p.ends.filter(e => e.img && imgs[e.img] && (e.rot || e.flip)).map(bake));
    for (let i = 0; i < 50 && baking.size; i++) await new Promise(r => setTimeout(r, 40));
  }
  const imageFiles = list => Array.from(list || []).filter(f => /^image\//.test(f.type) || /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(f.name || ""));

  async function addImages(files) {
    files = imageFiles(files);
    if (!files.length) return;
    const room = QC.MAX_ENDS - p.ends.length;
    if (room <= 0) { toast("A cable has 6 ends at most. Remove one first.", "warn"); return; }
    if (files.length > room) toast("Only " + room + " more fit. The first " + room + " were added.", "warn");
    const loaded = [];
    for (const f of files.slice(0, room)) {
      try { loaded.push(await importImage(f)); } catch (e) { toast("Could not read " + (f.name || "image"), "err"); }
    }
    if (!loaded.length) return;
    const before = p.ends.length;
    pushUndo();
    loaded.forEach(im => {
      const key = "i" + QC.uid();
      imgs[key] = im;
      p.ends.push(QC.newEnd(p.ends, { img: key }));
    });
    if (p.dims.every(d => !d.val.trim() && !d.tol.trim())) autoLengths(true);
    sel = "end:" + p.ends[p.ends.length - 1].id;
    changed();
    if (!before) fit();
    toast(loaded.length === 1 ? "Connector " + p.ends[p.ends.length - 1].letter + " added" : loaded.length + " connectors added");
  }
  async function replaceImage(e, file) {
    try {
      const im = await importImage(file), key = "i" + QC.uid();
      imgs[key] = im;
      pushUndo();
      e.img = key; e.rot = 0; e.flip = false;
      changed();
    } catch (err) { toast("Could not read that image", "err"); }
  }

  // ---------- auto layout ----------
  function autoLengths(silent) {
    const s = QC.scene(p, { pics: getPics() });
    p.dims = QC.autoDims(p, s.L);
    if (!silent) toast(p.dims.length ? "Length dimensions placed" : "Add two connectors first");
  }

  // ---------- render ----------
  const stage = $("stage"), svg = $("sheetSvg");
  function render() {
    sc = QC.scene(p, { pics: getPics(), logo });
    $("paper").innerHTML = QC.out.svgInner(sc, true);
    drawOverlay();
    $("empty").hidden = p.ends.length > 0;
  }
  function changed(keepInsp) {
    render();
    renderSide();
    if (!keepInsp) renderInspector();
    stats();
    paintUndo();
    scheduleSave();
  }
  function stats() {
    const n = p.ends.length;
    $("stats").textContent = n + (n === 1 ? " end" : " ends") + " · " + p.dims.length + " lengths · " + p.labels.length + " labels · " + ((QC.SHEETS[p.meta.size] || {}).name || "");
  }
  const groupOf = id => sc && sc.groups.find(g => g.id === id);
  function drawOverlay(extra) {
    const o = [];
    const s = 1 / view.s;
    if (sel) {
      const g = groupOf(sel);
      if (g && g.box) {
        const pad = 3 * s;
        o.push('<rect class="ovl-sel" x="' + (g.box.x - pad) + '" y="' + (g.box.y - pad) + '" width="' + (g.box.w + 2 * pad) + '" height="' + (g.box.h + 2 * pad) + '" rx="' + 2 * s + '" style="stroke-width:' + 1.2 * s + 'px"/>');
      }
      const k = kindOf(sel);
      if (k === "dim" && g && g.geom) {
        [["a", g.geom.a], ["b", g.geom.b]].forEach(([h, q]) => o.push(handle(h, q.x, q.y)));
      }
      if (k === "lbl") {
        const l = lblById(idOf(sel));
        if (l && l.lx != null) o.push(handle("tip", l.lx, l.ly));
      }
      if (k === "hub" && sc.L.hub) o.push(handle("hubh", sc.L.hub.x, sc.L.hub.y));
    }
    if (tool === "dim" || (drag && drag.t === "dimh")) {
      sc.anchors.forEach(a => o.push('<circle class="snap' + (hot && hot.at === a.at ? " hot" : "") + '" cx="' + a.x + '" cy="' + a.y + '" r="' + 4 * s + '" style="stroke-width:' + 1.2 * s + 'px"/>'));
    }
    if (extra) o.push(extra);
    $("ovl").innerHTML = o.join("");
  }
  const handle = (h, x, y) => '<circle class="handle" data-h="' + h + '" cx="' + x + '" cy="' + y + '" r="' + 4.5 / view.s + '" style="stroke-width:' + 1 / view.s + 'px"/>';

  // ---------- view ----------
  function setViewBox() {
    const r = stage.getBoundingClientRect();
    if (!r.width) return;
    svg.setAttribute("viewBox", view.x + " " + view.y + " " + r.width / view.s + " " + r.height / view.s);
    $("zoomLbl").textContent = Math.round(view.s * 100) + "%";
    if (sc) drawOverlay();
  }
  function fit() {
    const r = stage.getBoundingClientRect(), S = QC.SHEETS[p.meta.size] || QC.SHEETS.B;
    if (!r.width) return;
    view.s = Math.min((r.width - 40) / S.w, (r.height - 40) / S.h);
    view.x = -(r.width / view.s - S.w) / 2; view.y = -(r.height / view.s - S.h) / 2;
    setViewBox();
  }
  function zoomAt(f, cx, cy) {
    const r = stage.getBoundingClientRect();
    if (cx == null) { cx = r.width / 2; cy = r.height / 2; }
    const ns = Math.max(0.12, Math.min(8, view.s * f));
    const sx = view.x + cx / view.s, sy = view.y + cy / view.s;
    view.s = ns; view.x = sx - cx / ns; view.y = sy - cy / ns;
    setViewBox();
  }
  function toSheet(e) {
    const r = stage.getBoundingClientRect();
    return { x: view.x + (e.clientX - r.left) / view.s, y: view.y + (e.clientY - r.top) / view.s };
  }
  new ResizeObserver(() => setViewBox()).observe(stage);
  stage.addEventListener("wheel", e => {
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    zoomAt(Math.exp(-e.deltaY * 0.0016), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  $("zoomIn").addEventListener("click", () => zoomAt(1.25));
  $("zoomOut").addEventListener("click", () => zoomAt(0.8));
  $("zoomLbl").addEventListener("click", fit);

  // ---------- tools ----------
  const TIPS = {
    dim: "Click the start point, then the end point · Esc to stop",
    dim2: "Click the end point · Esc to cancel",
    text: "Click where the text goes",
    callout: "Press on the point, drag to where the text goes",
    balloon: "Press on the point, drag to where the balloon goes"
  };
  let dimStart = null, hot = null;
  function setTool(t) {
    tool = t; dimStart = null; hot = null;
    document.querySelectorAll("[data-tool]").forEach(b => b.setAttribute("aria-pressed", b.dataset.tool === t ? "true" : "false"));
    stage.classList.toggle("placing", t !== "select");
    tipBar(TIPS[t]);
    if (sc) drawOverlay();
  }
  function tipBar(s) { $("tipBar").hidden = !s; $("tipBar").textContent = s || ""; }
  document.querySelectorAll("[data-tool]").forEach(b => b.addEventListener("click", () => setTool(b.dataset.tool)));
  function snapAt(q) {
    let best = null, lim = 12 / view.s;
    (sc ? sc.anchors : []).forEach(a => { const d = Math.hypot(a.x - q.x, a.y - q.y); if (d < lim) { lim = d; best = a; } });
    return best ? { ref: { at: best.at }, x: best.x, y: best.y, at: best.at } : { ref: { x: Math.round(q.x), y: Math.round(q.y) }, x: Math.round(q.x), y: Math.round(q.y), at: null };
  }
  const nextBalloon = () => String(p.labels.filter(l => l.kind === "balloon").reduce((m, l) => Math.max(m, parseInt(l.text, 10) || 0), 0) + 1);

  // ---------- pointer ----------
  let drag = null, spaceDown = false;
  stage.addEventListener("pointerdown", e => {
    if (e.target.closest(".empty-card")) return;
    if (e.button === 1 || (e.button === 0 && spaceDown)) { startPan(e); return; }
    if (e.button !== 0) return;
    const q = toSheet(e);
    if (tool !== "select") e.preventDefault();   // keep focus where focusField puts it
    if (tool === "dim") {
      const s = snapAt(q);
      if (!dimStart) { dimStart = s; tipBar(TIPS.dim2); return; }
      if (Math.hypot(s.x - dimStart.x, s.y - dimStart.y) < 3) return;
      const dx = Math.abs(s.x - dimStart.x), dy = Math.abs(s.y - dimStart.y);
      const dir = dx >= dy ? "h" : "v";
      const off = dir === "h" ? Math.min(dimStart.y, s.y) - 24 - (dimStart.y + s.y) / 2 : Math.max(dimStart.x, s.x) + 24 - (dimStart.x + s.x) / 2;
      pushUndo();
      const d = { id: QC.uid(), a: dimStart.ref, b: s.ref, dir, off, val: "", tol: "", ref: false };
      p.dims.push(d);
      sel = "dim:" + d.id;
      setTool("select");
      changed();
      focusField("[data-d=val]");
      return;
    }
    if (tool === "text") {
      pushUndo();
      const l = { id: QC.uid(), kind: "text", text: "TEXT", x: Math.round(q.x), y: Math.round(q.y), lx: null, ly: null, size: "m", bold: false, box: false };
      p.labels.push(l); sel = "lbl:" + l.id;
      setTool("select"); changed(); focusField("[data-l=text]", true);
      return;
    }
    if (tool === "callout" || tool === "balloon") {
      drag = { t: "place", kind: tool, tip: { x: Math.round(q.x), y: Math.round(q.y) }, cur: q };
      stage.setPointerCapture(e.pointerId);
      return;
    }
    const hd = e.target.closest(".handle");
    if (hd && sel) {
      const h = hd.dataset.h;
      if (h === "a" || h === "b") drag = { t: "dimh", h, d: dimById(idOf(sel)) };
      else if (h === "tip") drag = { t: "tip", l: lblById(idOf(sel)) };
      else if (h === "hubh") drag = { t: "hub", start: Object.assign({}, sc.L.hub), q0: q };
      if (drag) { drag.moved = false; drag.q0 = drag.q0 || q; stage.setPointerCapture(e.pointerId); }
      return;
    }
    const g = e.target.closest("[data-id]");
    const id = g && g.dataset.id;
    if (!id || ["frame", "rev", "tb"].includes(id)) { if (sel) { sel = null; renderInspector(); drawOverlay(); renderSide(); } startPan(e); return; }
    if (sel !== id) { sel = id; renderInspector(); renderSide(); drawOverlay(); }
    const k = kindOf(id), gb = groupOf(id);
    drag = { t: "move", id, k, q0: q, moved: false };
    if (k === "end") drag.start = Object.assign({}, sc.L.ends[idOf(id)].exit);
    else if (k === "det") { const s = sc.R.det.slots.find(x => x.id === idOf(id)); drag.start = { x: s.cx, y: s.top }; }
    else if (k === "hub") drag.start = Object.assign({}, sc.L.hub);
    else if (k === "notes") drag.start = { x: gb.box.x + 4, y: gb.box.y + 2 };
    else if (k === "lbl") { const l = lblById(idOf(id)); drag.start = { x: l.x, y: l.y }; }
    else if (k === "dim") { const d = dimById(idOf(id)); drag.start = { off: d.off }; drag.n = gb.geom.n; }
    else drag = null;
    if (drag) stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener("pointermove", e => {
    const q = toSheet(e);
    if (tool === "dim" && !drag) {
      const s = snapAt(q), prev = hot && hot.at;
      hot = s.at ? s : null;
      if (dimStart) drawOverlay('<line class="ghost" x1="' + dimStart.x + '" y1="' + dimStart.y + '" x2="' + s.x + '" y2="' + s.y + '" style="stroke-width:' + 1.2 / view.s + 'px"/>');
      else if (prev !== (hot && hot.at)) drawOverlay();
      return;
    }
    if (!drag) return;
    if (drag.t === "pan") {
      view.x = drag.vx - (e.clientX - drag.cx) / view.s; view.y = drag.vy - (e.clientY - drag.cy) / view.s;
      setViewBox(); return;
    }
    if (drag.t === "place") {
      drag.cur = q;
      drawOverlay('<line class="ghost" x1="' + drag.tip.x + '" y1="' + drag.tip.y + '" x2="' + q.x + '" y2="' + q.y + '" style="stroke-width:' + 1.2 / view.s + 'px"/>');
      return;
    }
    const dx = q.x - drag.q0.x, dy = q.y - drag.q0.y;
    if (!drag.moved) { if (Math.hypot(dx, dy) * view.s < 3) return; pushUndo(); drag.moved = true; }
    const r1 = v => Math.round(v);
    if (drag.t === "dimh") {
      const s = snapAt(q); hot = s.at ? s : null;
      drag.d[drag.h] = s.ref;
    } else if (drag.t === "tip") { drag.l.lx = r1(q.x); drag.l.ly = r1(q.y); }
    else if (drag.t === "hub") p.hub = { x: r1(drag.start.x + dx), y: r1(drag.start.y + dy) };
    else if (drag.t === "move") {
      const id = idOf(drag.id), at = { x: r1(drag.start.x + dx), y: r1(drag.start.y + dy) };
      if (drag.k === "end") {
        const e2 = endById(id);
        if (!e.shiftKey) {   // snap level with the breakout or another end
          const ys = [sc.L.hub && sc.L.hub.y].concat(p.ends.filter(x => x !== e2).map(x => sc.L.ends[x.id].exit.y)).filter(v => v != null);
          ys.forEach(y => { if (Math.abs(at.y - y) < 5 / view.s) at.y = y; });
        }
        e2.pos = at;
      }
      else if (drag.k === "det") endById(id).dpos = at;
      else if (drag.k === "hub") p.hub = at;
      else if (drag.k === "notes") p.notesPos = at;
      else if (drag.k === "lbl") { const l = lblById(id); l.x = at.x; l.y = at.y; }
      else if (drag.k === "dim") {
        const d = dimById(id);
        d.off = r1(drag.start.off + (d.dir === "h" ? dy : d.dir === "v" ? dx : dx * drag.n.x + dy * drag.n.y));
      }
    }
    render();
  });
  const endDrag = e => {
    if (!drag) return;
    const d = drag; drag = null; hot = null;
    try { stage.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
    stage.classList.remove("panning");
    if (d.t === "place") {
      const q = d.cur, far = Math.hypot(q.x - d.tip.x, q.y - d.tip.y) * view.s > 12;
      const at = far ? { x: Math.round(q.x), y: Math.round(q.y) } : { x: d.tip.x + 30, y: d.tip.y - 40 };
      pushUndo();
      const l = { id: QC.uid(), kind: d.kind, text: d.kind === "balloon" ? nextBalloon() : "CALLOUT", x: at.x, y: at.y, lx: d.tip.x, ly: d.tip.y, size: "m", bold: false, box: true };
      if (d.kind === "callout" && at.x < d.tip.x) { const b = QC.labelBox(l); l.x = Math.round(at.x - b.w); }
      p.labels.push(l); sel = "lbl:" + l.id;
      setTool("select"); changed();
      if (d.kind === "callout") focusField("[data-l=text]", true);
      return;
    }
    if (d.moved) changed(); else drawOverlay();
  };
  stage.addEventListener("pointerup", endDrag);
  stage.addEventListener("pointercancel", endDrag);
  function startPan(e) {
    drag = { t: "pan", cx: e.clientX, cy: e.clientY, vx: view.x, vy: view.y };
    stage.classList.add("panning");
    stage.setPointerCapture(e.pointerId);
  }
  stage.addEventListener("dblclick", e => {
    const g = e.target.closest("[data-id]");
    if (g && /^(lbl|dim|end|det):/.test(g.dataset.id)) focusField(kindOf(g.dataset.id) === "dim" ? "[data-d=val]" : kindOf(g.dataset.id) === "lbl" ? "[data-l=text]" : "[data-e=name]", true);
  });
  function focusField(q, selectAll) {
    const go = () => { const f = $("inspBody").querySelector(q); if (f && document.activeElement !== f) { f.focus(); if (selectAll && f.select) f.select(); } };
    go(); requestAnimationFrame(go);
  }

  // ---------- side panel ----------
  function renderSide() {
    const n = p.ends.length;
    $("endCount").textContent = n + " / " + QC.MAX_ENDS;
    const pics = getPics();
    $("ends").innerHTML = p.ends.map(e => {
      const pic = pics[e.id], on = sel === "end:" + e.id || sel === "det:" + e.id;
      const sub = [e.name, e.type].filter(Boolean).join(" - ") || "No name yet";
      return '<div class="end-row' + (on ? " on" : "") + '" data-end="' + e.id + '"><span class="lt">' + esc(e.letter) + "</span>" +
        (pic ? '<img alt="" src="' + esc(pic.data) + '">' : '<span class="noimg">NONE</span>') +
        '<div class="cap"><b>Detail ' + esc(e.letter) + "</b><span>" + esc(sub) + "</span></div></div>";
    }).join("");
    $("addImgs").hidden = n >= QC.MAX_ENDS;
    const c = p.cable;
    document.querySelectorAll("#styleSeg button").forEach(b => b.setAttribute("aria-pressed", b.dataset.v === c.style ? "true" : "false"));
    $("cableW").value = c.w; $("cableWOut").textContent = c.w + " pt";
    $("wRow").hidden = c.style === "line";
    $("brkChk").checked = c.brk;
    $("bootRow").hidden = p.ends.length < 3;
    $("bootChk").checked = c.boot;
    $("bootL").value = c.bootL; $("bootLOut").textContent = c.bootL + " pt";
    $("bootLRow").hidden = !c.boot || p.ends.length < 3;
    $("sheetSel").value = p.meta.size;
    $("footerChk").checked = p.meta.footer;
    ["dwgNo", "dwgTitle", "dwgRev"].forEach((id, i) => { const k = ["dwgNo", "title", "rev"][i]; if (document.activeElement !== $(id)) $(id).value = p.meta[k]; });
    if (!$("notes").contains(document.activeElement)) {
      $("notes").innerHTML = p.notes.map((nt, i) => '<div class="note-row"><span>' + (i + 1) + '</span><textarea data-note="' + i + '" rows="1" placeholder="Note text">' + esc(nt.text) + '</textarea><button class="icon-btn" data-delnote="' + i + '" title="Remove note">✕</button></div>').join("") ||
        '<div class="hint">No notes.</div>';
    }
  }
  $("ends").addEventListener("click", e => {
    const r = e.target.closest("[data-end]");
    if (!r) return;
    sel = "end:" + r.dataset.end; renderSide(); renderInspector(); drawOverlay();
  });
  $("addImgs").addEventListener("click", () => $("imgFile").click());
  $("addImgs").addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("imgFile").click(); } });
  $("emptyAdd").addEventListener("click", () => $("imgFile").click());
  $("emptyOpen").addEventListener("click", () => $("projFile").click());
  $("imgFile").addEventListener("change", e => { const f = Array.from(e.target.files); e.target.value = ""; addImages(f); });
  $("oneImgFile").addEventListener("change", e => { const f = e.target.files[0], en = selEnd(); e.target.value = ""; if (f && en) replaceImage(en, f); });
  $("styleSeg").addEventListener("click", e => { const b = e.target.closest("button"); if (!b || p.cable.style === b.dataset.v) return; pushUndo(); p.cable.style = b.dataset.v; changed(); });
  $("cableW").addEventListener("input", e => { pushUndo("cw"); p.cable.w = +e.target.value; $("cableWOut").textContent = p.cable.w + " pt"; render(); scheduleSave(); });
  $("brkChk").addEventListener("change", e => { pushUndo(); p.cable.brk = e.target.checked; changed(); });
  $("bootChk").addEventListener("change", e => { pushUndo(); p.cable.boot = e.target.checked; changed(); });
  $("bootL").addEventListener("input", e => { pushUndo("bl"); p.cable.bootL = +e.target.value; $("bootLOut").textContent = p.cable.bootL + " pt"; render(); scheduleSave(); });
  $("autoBtn").addEventListener("click", () => {
    pushUndo();
    p.ends.forEach(e => { e.pos = null; e.dpos = null; });
    p.hub = null; p.notesPos = null;
    changed();
  });
  $("autoDimBtn").addEventListener("click", () => {
    if (p.ends.length < 2) { toast("Add two connectors first", "warn"); return; }
    pushUndo(); autoLengths(); changed();
  });
  $("addNote").addEventListener("click", () => {
    pushUndo(); p.notes.push({ text: "" }); changed();
    const t = $("notes").querySelectorAll("textarea"); if (t.length) t[t.length - 1].focus();
  });
  $("notes").addEventListener("input", e => {
    const t = e.target.closest("[data-note]");
    if (!t) return;
    pushUndo("note" + t.dataset.note); p.notes[+t.dataset.note].text = t.value; render(); scheduleSave();
  });
  $("notes").addEventListener("click", e => {
    const b = e.target.closest("[data-delnote]");
    if (!b) return;
    pushUndo(); p.notes.splice(+b.dataset.delnote, 1); $("notes").innerHTML = ""; changed();
  });
  $("sheetSel").innerHTML = Object.keys(QC.SHEETS).map(k => '<option value="' + k + '">' + esc(QC.SHEETS[k].name) + "</option>").join("");
  $("sheetSel").addEventListener("change", e => { pushUndo(); p.meta.size = e.target.value; p.ends.forEach(x => { x.pos = null; x.dpos = null; }); p.hub = null; p.notesPos = null; changed(); fit(); });
  $("footerChk").addEventListener("change", e => { pushUndo(); p.meta.footer = e.target.checked; changed(); });
  [["dwgNo", "dwgNo"], ["dwgTitle", "title"], ["dwgRev", "rev"]].forEach(([id, k]) => $(id).addEventListener("input", e => { pushUndo("m" + k); p.meta[k] = e.target.value; render(); scheduleSave(); }));

  // ---------- inspector ----------
  const fld = (label, inner, cls) => '<div class="field' + (cls ? " " + cls : "") + '"><label>' + label + "</label>" + inner + "</div>";
  const inp = (attr, v, ph, extra) => '<input ' + attr + ' value="' + esc(v) + '"' + (ph ? ' placeholder="' + esc(ph) + '"' : "") + (extra || "") + ' autocomplete="off">';
  const seg = (attr, cur, opts) => '<div class="seg">' + opts.map(([v, t]) => '<button ' + attr + ' data-v="' + v + '" aria-pressed="' + (cur === v) + '">' + t + "</button>").join("") + "</div>";
  const rng = (attr, v, min, max) => '<div class="rng"><input type="range" ' + attr + ' min="' + min + '" max="' + max + '" step="5" value="' + Math.round(v * 100) + '"><output>' + Math.round(v * 100) + "%</output></div>";
  function renderInspector() {
    const k = kindOf(sel), body = $("inspBody");
    $("inspDel").hidden = !(k === "end" || k === "det" || k === "dim" || k === "lbl");
    let title = "Drawing", h = "";
    const e = selEnd();
    if (e) {
      title = "Connector <b>" + esc(e.letter) + "</b>";
      const pic = getPics()[e.id], i = p.ends.indexOf(e);
      h += pic ? '<img class="thumb" alt="" src="' + esc(pic.data) + '">' : '<div class="hint">No image.</div>';
      h += '<div class="btn-row"><button class="btn btn-xs" data-act="replace">Replace image</button><button class="btn btn-xs" data-act="rot" title="Turn 90° clockwise">Rotate ↻</button><button class="btn btn-xs" data-act="flip" title="Mirror left to right">Flip ⇋</button></div>';
      h += '<div class="r3" style="grid-template-columns:62px 1fr 1fr">' + fld("Detail", inp('data-e="letter" maxlength="2"', e.letter)) + fld("Name", inp('data-e="name"', e.name, "Input")) + fld("Connector type", inp('data-e="type"', e.type, "M12 8-pin")) + "</div>";
      h += '<div class="cap-prev" id="capPrev">' + esc(QC.caption(e)) + "</div>";
      h += '<div class="sec"><div class="sec-h">Size</div>' + fld("On the cable", rng('data-e="k"', e.k, 30, 300)) + fld("Detail view", rng('data-e="dk"', e.dk, 30, 300)) + "</div>";
      h += '<div class="sec"><div class="sec-h">Place</div><div class="btn-row">' +
        '<button class="btn btn-xs" data-act="up"' + (i ? "" : " disabled") + ">Move up</button>" +
        '<button class="btn btn-xs" data-act="down"' + (i < p.ends.length - 1 ? "" : " disabled") + ">Move down</button>" +
        '<button class="btn btn-xs" data-act="autoplace"' + (e.pos || e.dpos ? "" : " disabled") + ">Auto place</button></div></div>";
    } else if (k === "dim") {
      const d = dimById(idOf(sel));
      title = "Length";
      const anc = sc ? sc.anchors : [];
      const opts = (ref) => anc.map(a => '<option value="' + a.at + '"' + (ref.at === a.at ? " selected" : "") + ">" + esc(a.name) + "</option>").join("") + (ref.at ? "" : '<option value="" selected>Free point</option>');
      h += '<div class="r2">' + fld("Length", inp('data-d="val"', d.val, p.meta.units === "mm" ? "e.g. 1500" : "e.g. 36.00")) + fld("Tolerance ±", inp('data-d="tol"', d.tol, "General")) + "</div>";
      h += '<label class="chk"><input type="checkbox" data-d="ref"' + (d.ref ? " checked" : "") + '>Reference (REF)</label>';
      h += '<label class="chk"><input type="checkbox" data-m="showUnit"' + (p.meta.showUnit ? " checked" : "") + ">Show unit on all lengths</label>";
      h += fld("Direction", seg('data-d="dir"', d.dir, [["h", "Horizontal"], ["v", "Vertical"], ["a", "Aligned"]]));
      h += '<div class="sec"><div class="sec-h">Measured from / to</div>' + fld("From", '<select data-d="a">' + opts(d.a) + "</select>") + fld("To", '<select data-d="b">' + opts(d.b) + "</select>") + "</div>";
    } else if (k === "lbl") {
      const l = lblById(idOf(sel));
      title = { text: "Text label", callout: "Callout", balloon: "Balloon" }[l.kind];
      h += l.kind === "balloon" ? fld("Number or text", inp('data-l="text" maxlength="6"', l.text)) : fld("Text", '<textarea data-l="text" rows="3">' + esc(l.text) + "</textarea>");
      if (l.kind === "callout") h += '<div class="chips">' + QC.CALLOUT_PRESETS.map(t => '<button data-preset="' + esc(t) + '">' + esc(t) + "</button>").join("") + "</div>";
      h += fld("Text size", seg('data-l="size"', l.size, [["s", "Small"], ["m", "Medium"], ["l", "Large"]]));
      if (l.kind !== "balloon") h += '<div class="row"><label class="chk"><input type="checkbox" data-l="bold"' + (l.bold ? " checked" : "") + '>Bold</label><label class="chk"><input type="checkbox" data-l="box"' + (l.box ? " checked" : "") + ">Box</label></div>";
      if (l.kind !== "text") h += '<label class="chk"><input type="checkbox" data-l="leader"' + (l.lx != null ? " checked" : "") + ">Leader arrow</label>";
    } else if (k === "hub") {
      title = "Breakout";
      h += '<div class="btn-row"><button class="btn btn-xs" data-act="hubauto"' + (p.hub ? "" : " disabled") + ">Auto place</button></div>";
    } else if (k === "cable") {
      title = "Cable";
      h += fld("Style", seg('data-c="style"', p.cable.style, [["tube", "Tube"], ["line", "Line"]]));
      if (p.cable.style !== "line") h += fld("Thickness", '<div class="rng"><input type="range" data-c="w" min="3" max="18" step="1" value="' + p.cable.w + '"><output>' + p.cable.w + " pt</output></div>");
      h += '<label class="chk"><input type="checkbox" data-c="brk"' + (p.cable.brk ? " checked" : "") + ">Break mark</label>";
      if (p.ends.length > 2) {
        h += '<label class="chk"><input type="checkbox" data-c="boot"' + (p.cable.boot ? " checked" : "") + ">Y boot at the breakout</label>";
        if (p.cable.boot) h += fld("Boot size", '<div class="rng"><input type="range" data-c="bootL" min="16" max="120" step="2" value="' + p.cable.bootL + '"><output>' + p.cable.bootL + " pt</output></div>");
      }
    } else if (k === "notes") {
      title = "Notes";
      h += '<div class="btn-row"><button class="btn btn-xs" data-act="notesauto"' + (p.notesPos ? "" : " disabled") + ">Auto place</button></div>";
    } else {
      const n = p.ends.length;
      h += '<div class="stat"><span>Sheet</span><b>' + esc((QC.SHEETS[p.meta.size] || {}).name || "") + "</b><span>Ends</span><b>" + n + "</b><span>Lengths</span><b>" + p.dims.length + "</b><span>Labels</span><b>" + p.labels.length + "</b><span>Footer</span><b>" + (p.meta.footer ? "On" : "Off") + "</b></div>";
      h += '<div class="btn-row"><button class="btn btn-sm" data-act="drawing">Title block and footer…</button></div>';
      h += '<div class="sec"><div class="sec-h">Keys</div><div class="keys">' +
        [["V L T C B", "Tools"], ["Del", "Delete"], ["Ctrl+Z / Y", "Undo / redo"], ["Shift+drag", "Move an end freely"], ["Space+drag", "Pan"], ["F", "Fit sheet"], ["Ctrl+V", "Paste an image"]].map(r => "<kbd>" + r[0] + "</kbd><span>" + r[1] + "</span>").join("") + "</div></div>";
    }
    $("inspTitle").innerHTML = title;
    body.innerHTML = h;
  }
  $("inspDel").addEventListener("click", delSel);
  const inspBody = $("inspBody");
  inspBody.addEventListener("input", e => {
    const t = e.target, en = selEnd();
    if (t.dataset.e && en) {
      const k = t.dataset.e;
      pushUndo("e" + en.id + k);
      if (k === "k" || k === "dk") { en[k] = +t.value / 100; t.nextElementSibling.textContent = t.value + "%"; }
      else en[k] = t.value;
      const cp = $("capPrev"); if (cp) cp.textContent = QC.caption(en);
      render(); renderSide(); scheduleSave();
    } else if (t.dataset.d && (t.dataset.d === "val" || t.dataset.d === "tol")) {
      const d = dimById(idOf(sel)); pushUndo("d" + d.id + t.dataset.d); d[t.dataset.d] = t.value; render(); scheduleSave();
    } else if (t.dataset.l === "text") {
      const l = lblById(idOf(sel)); pushUndo("l" + l.id); l.text = t.value; render(); stats(); scheduleSave();
    } else if (t.dataset.c === "bootL") {
      pushUndo("bl"); p.cable.bootL = +t.value; t.nextElementSibling.textContent = t.value + " pt"; render(); renderSide(); scheduleSave();
    } else if (t.dataset.c === "w") {
      pushUndo("cw"); p.cable.w = +t.value; t.nextElementSibling.textContent = t.value + " pt"; render(); renderSide(); scheduleSave();
    }
  });
  inspBody.addEventListener("change", e => {
    const t = e.target;
    if (t.dataset.d === "ref") { pushUndo(); dimById(idOf(sel)).ref = t.checked; changed(); }
    else if (t.dataset.d === "a" || t.dataset.d === "b") {
      const d = dimById(idOf(sel));
      if (!t.value) return;
      pushUndo(); d[t.dataset.d] = { at: t.value }; changed();
    }
    else if (t.dataset.m === "showUnit") { pushUndo(); p.meta.showUnit = t.checked; changed(); }
    else if (t.dataset.l === "bold" || t.dataset.l === "box") { pushUndo(); lblById(idOf(sel))[t.dataset.l] = t.checked; changed(); }
    else if (t.dataset.l === "leader") {
      const l = lblById(idOf(sel)), b = QC.labelBox(l);
      pushUndo();
      if (t.checked) { l.lx = Math.round(b.x - 30); l.ly = Math.round(b.y + b.h + 30); } else { l.lx = null; l.ly = null; }
      changed();
    }
    else if (t.dataset.c === "brk") { pushUndo(); p.cable.brk = t.checked; changed(); }
    else if (t.dataset.c === "boot") { pushUndo(); p.cable.boot = t.checked; changed(); }
  });
  inspBody.addEventListener("click", e => {
    const b = e.target.closest("button");
    if (!b) return;
    const en = selEnd();
    if (b.dataset.preset) {
      const l = lblById(idOf(sel));
      pushUndo(); l.text = b.dataset.preset; changed(); focusField("[data-l=text]", true);
      return;
    }
    if (b.dataset.d === "dir") { const d = dimById(idOf(sel)); if (d.dir !== b.dataset.v) { pushUndo(); d.dir = b.dataset.v; d.off = d.dir === "a" ? -24 : d.off; changed(); } return; }
    if (b.dataset.l === "size") { const l = lblById(idOf(sel)); if (l.size !== b.dataset.v) { pushUndo(); l.size = b.dataset.v; changed(); } return; }
    if (b.dataset.c === "style") { if (p.cable.style !== b.dataset.v) { pushUndo(); p.cable.style = b.dataset.v; changed(); } return; }
    const act = b.dataset.act;
    if (act === "replace") $("oneImgFile").click();
    else if (act === "rot" && en) { pushUndo(); en.rot = (en.rot + 90) % 360; changed(); }
    else if (act === "flip" && en) { pushUndo(); en.flip = !en.flip; changed(); }
    else if ((act === "up" || act === "down") && en) {
      const i = p.ends.indexOf(en), j = act === "up" ? i - 1 : i + 1;
      if (j < 0 || j >= p.ends.length) return;
      pushUndo(); p.ends.splice(i, 1); p.ends.splice(j, 0, en);
      p.ends.forEach(x => { x.pos = null; x.dpos = null; });
      changed();
    }
    else if (act === "autoplace" && en) { pushUndo(); en.pos = null; en.dpos = null; changed(); }
    else if (act === "hubauto") { pushUndo(); p.hub = null; changed(); }
    else if (act === "notesauto") { pushUndo(); p.notesPos = null; changed(); }
    else if (act === "drawing") drawingDialog();
  });

  function delSel() {
    const k = kindOf(sel), id = idOf(sel);
    if (k === "end" || k === "det") {
      const e = endById(id);
      if (!e) return;
      pushUndo();
      p.ends = p.ends.filter(x => x !== e);
      p.dims = p.dims.filter(d => ![d.a, d.b].some(r => r.at && (r.at.endsWith(":" + id) || (r.at === "hub" && p.ends.length < 3))));
      if (p.dims.every(d => !d.val.trim() && !d.tol.trim())) autoLengths(true);
      toast("Connector " + e.letter + " removed");
    } else if (k === "dim") { pushUndo(); p.dims = p.dims.filter(d => d.id !== id); }
    else if (k === "lbl") { pushUndo(); p.labels = p.labels.filter(l => l.id !== id); }
    else return;
    sel = null;
    changed();
  }

  // ---------- modal ----------
  let modalClose = null;
  function openModal(title, bodyHtml, buttons, onClose) {
    $("modalTitle").textContent = title;
    $("modalBody").innerHTML = bodyHtml;
    $("modalFoot").innerHTML = "";
    (buttons || []).forEach(b => {
      const el = document.createElement("button");
      el.className = "btn " + (b.cls || ""); el.textContent = b.label;
      el.addEventListener("click", () => { if (b.fn && b.fn() === false) return; closeModal(); });
      $("modalFoot").appendChild(el);
    });
    modalClose = onClose || null;
    dlg.input = dlg.change = dlg.click = null;
    $("overlay").classList.add("open");
  }
  function closeModal() {
    $("overlay").classList.remove("open");
    if (modalClose) { const f = modalClose; modalClose = null; f(); }
  }
  const dlg = {};   // handlers of the open dialog (bound once below)
  ["input", "change", "click"].forEach(ev => $("modalBody").addEventListener(ev, e => { if (dlg[ev]) dlg[ev](e); }));
  $("modalX").addEventListener("click", closeModal);
  $("overlay").addEventListener("mousedown", e => { if (e.target === $("overlay")) closeModal(); });
  function confirmModal(title, text, okLabel, fn) {
    openModal(title, "<p>" + esc(text) + "</p>", [{ label: "Cancel" }, { label: okLabel, cls: "btn-primary", fn }]);
  }
  function toast(msg, kind) {
    const t = document.createElement("div");
    t.className = "toast" + (kind ? " " + kind : ""); t.textContent = msg;
    $("toasts").appendChild(t);
    setTimeout(() => t.remove(), kind === "err" ? 7000 : 3600);
  }

  // ---------- drawing dialog: title block, footer, revisions ----------
  function drawingDialog() {
    const m = p.meta;
    const f = (k, label, ph) => fld(label, inp('data-m="' + k + '"', m[k], ph));
    const chk = (k, label) => '<label class="chk"><input type="checkbox" data-m="' + k + '"' + (m[k] ? " checked" : "") + ">" + label + "</label>";
    const histRows = () => p.history.map((r, i) => "<tr>" + ["rev", "eco", "desc", "date", "by"].map(k => "<td>" + inp('data-h="' + i + "|" + k + '"', r[k]) + "</td>").join("") + '<td><button class="icon-btn" data-delh="' + i + '">✕</button></td></tr>').join("");
    const body =
      "<h4>Show</h4><div class=\"row\" style=\"gap:18px\">" + chk("footer", "Title block (footer)") + chk("revBlock", "Revision block") + chk("details", "Detail views") + chk("tags", "Detail tags on the cable") + "</div>" +
      "<h4>Sheet</h4><div class=\"r4\">" +
      fld("Size", '<select data-m="size">' + Object.keys(QC.SHEETS).map(k => '<option value="' + k + '"' + (m.size === k ? " selected" : "") + ">" + esc(QC.SHEETS[k].name) + "</option>").join("") + "</select>") +
      fld("Units", '<select data-m="units"><option value="in"' + (m.units === "in" ? " selected" : "") + '>Inches</option><option value="mm"' + (m.units === "mm" ? " selected" : "") + ">Millimetres</option></select>") +
      f("tol", "Length tolerance ±", m.units === "mm" ? "e.g. 5" : "e.g. 0.25") + f("scale", "Scale", "NTS") + "</div>" +
      "<h4>Title block</h4><div class=\"r4\">" + f("company", "Company name", "Example Co.") + f("ws", "IPC/WHMA-A-620 class", "e.g. 2") +
      fld("Logo", '<div class="row">' + (logo ? '<img class="logo-prev" alt="" src="' + esc(logo.data) + '"><button class="btn btn-xs" data-act="logoDel">Remove</button>' : '<button class="btn btn-xs" data-act="logo">Load logo…</button>') + "</div>") + "<div></div>" +
      f("drawn", "Drawn") + f("drawnDate", "Date") + f("checked", "Checked") + f("checkedDate", "Date") + f("approved", "Approved") + f("approvedDate", "Date") + "</div>" +
      fld("Notice", '<textarea data-m="notice" rows="2" placeholder="Optional line above the title block">' + esc(m.notice) + "</textarea>") +
      "<h4>Revisions</h4><table class=\"hist-tbl\"><thead><tr><th style=\"width:60px\">Rev</th><th style=\"width:90px\">ECO</th><th>Description</th><th style=\"width:100px\">Date</th><th style=\"width:90px\">By</th><th></th></tr></thead><tbody id=\"histBody\">" + histRows() + "</tbody></table>" +
      '<div><button class="btn btn-xs" data-act="addh">+ Revision</button></div>';
    openModal("Drawing", body, [{ label: "Done", cls: "btn-primary" }]);
    const on = (ev, fn) => { dlg[ev] = fn; };
    on("input", e => {
      const t = e.target;
      if (t.dataset.m && t.type !== "checkbox" && t.tagName !== "SELECT") { pushUndo("m" + t.dataset.m); p.meta[t.dataset.m] = t.value; changed(true); }
      else if (t.dataset.h) { const [i, k] = t.dataset.h.split("|"); pushUndo("h" + i + k); p.history[+i][k] = t.value; changed(true); }
    });
    on("change", e => {
      const t = e.target;
      if (!t.dataset.m) return;
      if (t.type === "checkbox") { pushUndo(); p.meta[t.dataset.m] = t.checked; changed(); }
      else if (t.tagName === "SELECT") {
        pushUndo(); p.meta[t.dataset.m] = t.value;
        if (t.dataset.m === "size") { p.ends.forEach(x => { x.pos = null; x.dpos = null; }); p.hub = null; p.notesPos = null; changed(); fit(); }
        else changed();
      }
    });
    on("click", e => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.act === "addh") {
        pushUndo(); p.history.push({ rev: p.meta.rev || "", eco: "", desc: "", date: new Date().toISOString().slice(0, 10), by: "" });
        $("histBody").innerHTML = histRows(); changed(true);
      } else if (b.dataset.delh) { pushUndo(); p.history.splice(+b.dataset.delh, 1); $("histBody").innerHTML = histRows(); changed(true); }
      else if (b.dataset.act === "logo") $("logoFile").click();
      else if (b.dataset.act === "logoDel") { logo = null; idb.del("logo").catch(() => {}); render(); drawingDialog(); }
    });
  }
  $("drawingBtn").addEventListener("click", drawingDialog);
  $("logoFile").addEventListener("change", async e => {
    const f = e.target.files[0]; e.target.value = "";
    if (!f) return;
    try {
      logo = await importImage(f, 800);
      idb.set("logo", logo).catch(() => toast("Logo shown, but this browser could not keep it", "warn"));
      render();
      if ($("overlay").classList.contains("open")) drawingDialog();
    } catch (err) { toast("Could not read that logo", "err"); }
  });

  // ---------- files ----------
  function baseName() {
    const m = p.meta;
    const s = [m.dwgNo, m.rev ? "Rev" + m.rev : "", m.title].filter(x => String(x || "").trim()).join("_");
    return (s.replace(/[\\/:*?"<>|#%,;]+/g, "-").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 90)) || "quick-cable";
  }
  function download(name, blob) {
    const url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  async function saveFile(name, build, desc, mime, ext) {
    let handle = null;
    if (window.showSaveFilePicker) {
      try { handle = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: desc, accept: { [mime]: [ext] } }] }); }
      catch (e) { if (e && e.name === "AbortError") return false; handle = null; }
    }
    const blob = await build();
    if (handle) { const w = await handle.createWritable(); await w.write(blob); await w.close(); }
    else download(name, blob);
    return true;
  }
  function usedImages() {
    const out = {};
    p.ends.forEach(e => { if (e.img && imgs[e.img]) out[e.img] = imgs[e.img]; });
    return out;
  }
  function projectJson() { return JSON.stringify(Object.assign({}, p, { app: "Quick Cable", saved: new Date().toISOString(), images: usedImages() })); }
  async function saveProject() {
    try {
      const ok = await saveFile(baseName() + ".qcable", async () => new Blob([projectJson()], { type: "application/json" }), "Quick Cable project", "application/json", ".qcable");
      if (ok) toast("Project saved");
    } catch (e) { toast("Save failed: " + e.message, "err"); }
  }
  function loadProject(d) {
    if (!d || d.format !== QC.FORMAT) throw new Error("Not a Quick Cable project");
    const im = {};
    Object.keys(d.images || {}).forEach(k => {
      const v = d.images[k];
      if (v && /^data:image\/(png|jpeg);base64,/.test(v.data) && v.w > 0 && v.h > 0) im[k] = { data: v.data, w: +v.w, h: +v.h };
    });
    p = QC.normalize(d);
    p.ends.forEach(e => { if (e.img && !im[e.img]) e.img = null; });
    imgs = im; baked.clear();
    undoStack = []; redoStack = []; sel = null;
    changed(); fit();
  }
  async function openProjectFile(f) {
    try { loadProject(JSON.parse(await f.text())); toast("Opened " + f.name); }
    catch (e) { toast("Could not open " + f.name + ": " + e.message, "err"); }
  }
  $("projFile").addEventListener("change", e => { const f = e.target.files[0]; e.target.value = ""; if (f) openProjectFile(f); });

  async function exportAs(kind) {
    try {
      await readyPics();
      const s = QC.scene(p, { pics: getPics(), logo });
      if (kind === "pdf") { if (await saveFile(baseName() + ".pdf", async () => QC.out.pdf(p, s), "PDF drawing", "application/pdf", ".pdf")) toast("PDF saved"); }
      else if (kind === "png") { if (await saveFile(baseName() + ".qcable.png", () => QC.out.png(s, 200), "PNG image", "image/png", ".png")) toast("PNG saved"); }
      else if (kind === "svg") { if (await saveFile(baseName() + ".qcable.svg", async () => new Blob([QC.out.svgDoc(s)], { type: "image/svg+xml" }), "SVG drawing", "image/svg+xml", ".svg")) toast("SVG saved"); }
    } catch (e) { toast("Export failed: " + e.message, "err"); console.error(e); }
  }

  // ---------- menus ----------
  function menu(btnId, menuId, handler) {
    const b = $(btnId), m = $(menuId);
    b.addEventListener("click", e => { e.stopPropagation(); const open = m.hidden; closeMenus(); m.hidden = !open; b.setAttribute("aria-expanded", open); });
    m.addEventListener("click", e => { const it = e.target.closest("button[data-act]"); if (!it) return; closeMenus(); handler(it.dataset.act); });
  }
  function closeMenus() { ["projMenu", "expMenu"].forEach(id => { $(id).hidden = true; }); ["projBtn", "expBtn"].forEach(id => $(id).setAttribute("aria-expanded", "false")); }
  document.addEventListener("click", e => { if (!e.target.closest(".menu-wrap")) closeMenus(); });
  menu("projBtn", "projMenu", act => {
    if (act === "save") saveProject();
    else if (act === "open") $("projFile").click();
    else if (act === "new") confirmModal("New cable", "Clear the drawing in this browser? Save a project file first if you want to keep it.", "Clear", () => {
      p = QC.blank(); imgs = {}; baked.clear(); undoStack = []; redoStack = []; sel = null; changed(); fit();
    });
  });
  menu("expBtn", "expMenu", exportAs);

  // ---------- keyboard, paste, drop ----------
  const typing = t => t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
  document.addEventListener("keydown", e => {
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (mod && k === "s") { e.preventDefault(); saveProject(); return; }
    if (mod && k === "o") { e.preventDefault(); $("projFile").click(); return; }
    if (mod && k === "p") { e.preventDefault(); exportAs("pdf"); return; }
    if ($("overlay").classList.contains("open")) { if (e.key === "Escape") closeModal(); return; }
    if (typing(e.target)) return;
    if (mod && k === "z") { e.preventDefault(); undo(e.shiftKey); return; }
    if (mod && k === "y") { e.preventDefault(); undo(true); return; }
    if (mod) return;
    if (e.key === " ") { spaceDown = true; e.preventDefault(); return; }
    if (e.key === "Escape") { if (tool !== "select") setTool("select"); else if (sel) { sel = null; renderInspector(); renderSide(); drawOverlay(); } return; }
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); delSel(); return; }
    const tools = { v: "select", l: "dim", t: "text", c: "callout", b: "balloon" };
    if (tools[k]) { setTool(tools[k]); return; }
    if (k === "f") { fit(); return; }
    if (e.key.startsWith("Arrow") && sel) {
      const st = e.shiftKey ? 10 : 1, dx = e.key === "ArrowLeft" ? -st : e.key === "ArrowRight" ? st : 0, dy = e.key === "ArrowUp" ? -st : e.key === "ArrowDown" ? st : 0;
      const kk = kindOf(sel), id = idOf(sel);
      e.preventDefault();
      pushUndo("nudge" + sel);
      if (kk === "lbl") { const l = lblById(id); l.x += dx; l.y += dy; }
      else if (kk === "end") { const x = sc.L.ends[id].exit; endById(id).pos = { x: x.x + dx, y: x.y + dy }; }
      else if (kk === "det") { const s = sc.R.det.slots.find(z => z.id === id); endById(id).dpos = { x: s.cx + dx, y: s.top + dy }; }
      else if (kk === "hub") p.hub = { x: sc.L.hub.x + dx, y: sc.L.hub.y + dy };
      else return;
      changed(true);
    }
  });
  document.addEventListener("keyup", e => { if (e.key === " ") spaceDown = false; });
  document.addEventListener("paste", e => {
    const files = imageFiles(Array.from((e.clipboardData && e.clipboardData.files) || []));
    if (!files.length) return;
    e.preventDefault();
    const en = selEnd();
    if (en && files.length === 1) { replaceImage(en, files[0]); toast("Image of connector " + en.letter + " replaced"); }
    else addImages(files);
  });
  let dragDepth = 0;
  document.addEventListener("dragenter", e => { if (e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files")) { dragDepth++; document.body.classList.add("drag"); } });
  document.addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove("drag"); } });
  document.addEventListener("dragover", e => e.preventDefault());
  document.addEventListener("drop", e => {
    e.preventDefault(); dragDepth = 0; document.body.classList.remove("drag");
    const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
    const proj = files.find(f => /\.(qcable|json)$/i.test(f.name));
    if (proj) openProjectFile(proj); else addImages(files);
  });

  // ---------- autosave ----------
  let saveT = null;
  function scheduleSave() {
    clearTimeout(saveT);
    saveT = setTimeout(async () => {
      if (!storageOk) return;
      try { await idb.set("doc", { p: JSON.parse(JSON.stringify(p)), images: usedImages() }); setSaveStat("Saved in this browser"); }
      catch (e) { setSaveStat("Browser storage full or blocked — save a project file", true); }
    }, 700);
  }
  function setSaveStat(s, warn) { const el = $("saveStat"); el.textContent = s; el.classList.toggle("warn", !!warn); }

  // ---------- theme ----------
  function applyTheme() { document.documentElement.dataset.theme = ui.theme || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"); }
  $("themeBtn").addEventListener("click", () => { ui.theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark"; saveUi(); applyTheme(); });
  $("undoBtn").addEventListener("click", () => undo(false));
  $("redoBtn").addEventListener("click", () => undo(true));

  // ---------- boot ----------
  (() => {
    const im = new Image();
    im.onload = () => document.documentElement.classList.add("has-wm");   // page header only, never the drawing
    im.src = "../../assets/brand/wordmark.png";
  })();
  applyTheme();
  $("rev").textContent = "Quick Cable · " + REV;
  console.log("Quick Cable — " + REV);
  setTool("select");
  changed();
  requestAnimationFrame(fit);
  (async () => {
    try {
      const lg = await idb.get("logo");
      if (lg && lg.data) { logo = lg; render(); }
      const saved = await idb.get("doc");
      if (saved && saved.p && saved.p.format === QC.FORMAT) {
        imgs = saved.images || {};
        p = QC.normalize(saved.p);
        changed(); fit();
        if (p.ends.length) setSaveStat("Restored from this browser");
      }
    } catch (e) {
      storageOk = false;
      setSaveStat("Browser storage unavailable — save a project file", true);
    }
  })();
  window.QC_APP = { get p() { return p; }, get sc() { return sc; }, addImages, loadProject, exportAs, projectJson };
})();
