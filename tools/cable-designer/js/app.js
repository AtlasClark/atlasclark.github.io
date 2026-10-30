/*
  Cable Designer — page controller
  Scope: project state, undo / redo, autosave to IndexedDB, .cblproj files,
  library panel, outline, sheet view (zoom, pan, move, wire by drag from pin
  to pin or cable conductor), property inspector for connectors, cables,
  wires, callouts and tables, wire-list drawer, drawing dialog (title block,
  notes, revisions), design checks, exports, theme and keyboard shortcuts.
*/
(function () {
  "use strict";
  const CD = window.CD, OUT = CD.out;
  const REV = "rev 1.8.0";
  const LS_UI = "cableDesigner.ui";
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const plural = (n, w) => n + " " + w + (n !== 1 ? "s" : "");
  const pad2 = n => String(n).padStart(2, "0");
  const GRID = 5;
  const snap = (v, free) => free ? Math.round(v) : Math.round(v / GRID) * GRID;

  const ui = { theme: null, drawer: false, ports: false, wire: { gauge: "24", gu: "AWG", insul: "PVC" } };
  try { Object.assign(ui, JSON.parse(localStorage.getItem(LS_UI) || "{}")); } catch (e) { /* defaults */ }
  const saveUi = () => { try { localStorage.setItem(LS_UI, JSON.stringify(ui)); } catch (e) { /* view prefs only */ } };

  // ---------- IndexedDB ----------
  const idb = (() => {
    let dbp = null;
    const open = () => dbp || (dbp = new Promise((res, rej) => {
      const r = indexedDB.open("cable-designer", 1);
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
  let p = CD.blankProject();
  let sel = null;            // scene group id: c:<conn> w:<cable> x:<wire> k:<callout> blk:<table>
  let sheet = 1;
  let sc = null;
  const view = { x: 0, y: 0, s: 1 };
  const images = { logo: null };   // title-block logo: loaded by the user, kept in this browser only
  const condSel = new Set();  // conductors ticked for "Twist selected"
  let storageOk = true;
  const hasContent = () => !!(p.conns.length || p.cables.length || p.wires.length || p.callouts.length || (p.tables || []).length || p.meta.dwgNo || p.meta.title);

  const kindOf = id => id ? id.slice(0, id.indexOf(":")) : null;
  const idOf = id => id ? id.slice(id.indexOf(":") + 1) : null;
  const conn = id => CD.byId(p.conns, id), cable = id => CD.byId(p.cables, id), wire = id => CD.byId(p.wires, id), callout = id => CD.byId(p.callouts, id), ctable = id => CD.byId(p.tables, id);
  function selObj() {
    const k = kindOf(sel), id = idOf(sel);
    return k === "c" ? conn(id) : k === "w" ? cable(id) : k === "x" ? wire(id) : k === "k" ? callout(id) : k === "tbl" ? ctable(id) : null;
  }

  // ---------- undo ----------
  const undo = [], redo = [];
  let lastEdit = "", lastEditT = 0;
  const snapState = () => JSON.stringify({ p, sel });
  function pushUndo() { undo.push(snapState()); if (undo.length > 200) undo.shift(); redo.length = 0; lastEdit = ""; paintUndo(); }
  function editPush(key) {
    const now = Date.now();
    if (key !== lastEdit || now - lastEditT > 1500) { undo.push(snapState()); if (undo.length > 200) undo.shift(); redo.length = 0; paintUndo(); }
    lastEdit = key; lastEditT = now;
  }
  function travel(from, to) {
    const s = from.pop();
    if (!s) return;
    to.push(snapState());
    const o = JSON.parse(s);
    p = CD.normalize(o.p); sel = o.sel;
    lastEdit = "";
    if (sel && !selObj() && kindOf(sel) !== "blk") sel = null;
    refreshAll(); scheduleSave(); paintUndo();
  }
  function paintUndo() { $("undoBtn").disabled = !undo.length; $("redoBtn").disabled = !redo.length; }

  // ---------- autosave ----------
  let saveTimer = 0;
  function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 450); }
  async function saveNow() {
    clearTimeout(saveTimer);
    try {
      await idb.set("doc", JSON.parse(JSON.stringify(p)));
      storageOk = true;
      const d = new Date();
      setSaveStat("Saved in this browser · " + pad2(d.getHours()) + ":" + pad2(d.getMinutes()));
    } catch (e) {
      storageOk = false;
      setSaveStat("Browser storage unavailable — save a project file", true);
    }
  }
  function setSaveStat(t, warn) { const el = $("saveStat"); el.textContent = t; el.classList.toggle("warn", !!warn); }

  // ---------- render ----------
  let rafId = 0;
  const requestRender = () => { if (!rafId) rafId = requestAnimationFrame(() => { rafId = 0; render(); }); };
  function render() {
    sheet = Math.min(sheet, CD.sheetsOf(p));
    sc = CD.scene(p, { sheet, images });
    $("paper").innerHTML = OUT.svgInner(sc, images, true);
    if (sel && !sc.groups.some(g => g.id === sel)) { if (kindOf(sel) === "blk") sel = null; }
    drawOverlay();
    setViewBox();
    $("empty").hidden = hasContent();
  }
  function drawOverlay() {
    const o = [];
    const g = sel && sc.groups.find(x => x.id === sel);
    if (g && (kindOf(sel) === "x" || kindOf(sel) === "t")) {
      const pl = g.prims.find(q => q.t === "poly");
      if (pl) o.push('<polyline class="ovl-selw" points="' + pl.pts.join(" ") + '"/>');
      const w = wire(idOf(sel)), L = w && w.cable && sc.blocks.cable && sc.blocks.cable[w.cable];
      const row = L && L.rows.find(r => r.w === w);
      if (row) o.push('<rect class="ovl-sel" x="' + (L.x - 3) + '" y="' + row.y + '" width="' + (L.w + 6) + '" height="15"/>');
    } else if (g && g.box) {
      const b = g.box;
      o.push('<rect class="ovl-sel" x="' + (b.x - 4) + '" y="' + (b.y - 4) + '" width="' + (b.w + 8) + '" height="' + (b.h + 8) + '" rx="3"/>');
      if (g.leader) o.push('<circle class="handle" data-h="leader" cx="' + g.leader.x + '" cy="' + g.leader.y + '" r="4"/>');
      const BL = kindOf(sel) === "c" && sc.blocks.conn && sc.blocks.conn[idOf(sel)];
      if (BL && BL.board) o.push('<rect class="handle rs" data-h="bsize" x="' + (BL.x + BL.w - 4) + '" y="' + (BL.y + BL.h - 4) + '" width="8" height="8"><title>Drag to resize</title></rect>');
      if (scaleTarget(sel)) o.push('<rect class="handle rs" data-h="scale" x="' + (b.x + b.w - 4) + '" y="' + (b.y + b.h - 4) + '" width="8" height="8"><title>Drag to scale (text scales too)</title></rect>');
    }
    if (sheet === 1) {
      Object.entries(sc.blocks.conn || {}).forEach(([cid, L]) => {
        if (!L.board) return;
        const c = conn(cid);
        c.pins.forEach((pn, i) => { const q = L.pos(i); o.push('<circle class="bpin" data-bc="' + cid + '" data-bp="' + i + '" cx="' + q.x + '" cy="' + q.y + '" r="4.2"><title>Drag along the edge</title></circle>'); });
      });
      sc.ports.forEach(pt => o.push('<circle class="port" data-pc="' + pt.c + '" data-pp="' + pt.p + '" cx="' + pt.x + '" cy="' + pt.y + '" r="3.2"/>'));
      (sc.sports || []).forEach(pt => o.push('<rect class="port sport" data-sc="' + pt.cable + '" data-se="' + pt.end + '" x="' + (pt.x - 3.4) + '" y="' + (pt.y - 3.4) + '" width="6.8" height="6.8" transform="rotate(45 ' + pt.x + " " + pt.y + ')"><title>Shield ' + pt.end.toUpperCase() + ': drag to tie</title></rect>'));
      Object.values(sc.blocks.cable || {}).forEach(L => L.rows.forEach(r => {
        o.push('<circle class="port" data-rw="' + r.w.id + '" data-rend="' + (L.aLeft ? "a" : "b") + '" cx="' + L.x + '" cy="' + r.ly + '" r="3.2"/>');
        o.push('<circle class="port" data-rw="' + r.w.id + '" data-rend="' + (L.aLeft ? "b" : "a") + '" cx="' + (L.x + L.w) + '" cy="' + r.ly + '" r="3.2"/>');
      }));
    }
    $("ovl").innerHTML = o.join("");
  }

  // ---------- view ----------
  const stage = $("stage"), svg = $("sheetSvg");
  function setViewBox() {
    const r = stage.getBoundingClientRect();
    if (!r.width) return;
    svg.setAttribute("viewBox", view.x + " " + view.y + " " + r.width / view.s + " " + r.height / view.s);
    $("zoomLbl").textContent = Math.round(view.s * 100) + "%";
  }
  function fit() {
    const r = stage.getBoundingClientRect(), S = CD.SHEETS[p.meta.size] || CD.SHEETS.B;
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
  function viewCenter() {
    const r = stage.getBoundingClientRect();
    return { x: view.x + r.width / 2 / view.s, y: view.y + r.height / 2 / view.s };
  }
  function reveal(id) {
    const g = sc && sc.groups.find(x => x.id === id);
    if (!g || !g.box) return;
    const r = stage.getBoundingClientRect(), b = g.box;
    const vw = r.width / view.s, vh = r.height / view.s;
    if (b.x > view.x && b.y > view.y && b.x + b.w < view.x + vw && b.y + b.h < view.y + vh) return;
    view.x = b.x + b.w / 2 - vw / 2; view.y = b.y + b.h / 2 - vh / 2;
    setViewBox();
  }
  new ResizeObserver(() => setViewBox()).observe(stage);
  stage.addEventListener("wheel", e => {
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    zoomAt(Math.exp(-e.deltaY * 0.0016), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  // ---------- pointer: select, move, pan, wire by drag ----------
  let drag = null;
  stage.addEventListener("pointerdown", e => {
    if (e.target.closest(".empty-card")) return;
    if (e.button === 1 || (e.button === 0 && spaceDown)) { startPan(e); return; }
    if (e.button !== 0) return;
    const t = e.target;
    const port = t.closest(".port");
    if (port) { startWire(e, port); return; }
    const bp = t.closest(".bpin");
    if (bp) { select("c:" + bp.dataset.bc); drag = { t: "bpin", c: bp.dataset.bc, i: +bp.dataset.bp, moved: false }; stage.setPointerCapture(e.pointerId); return; }
    const hd = t.closest(".handle");
    if (hd && hd.dataset.h === "scale") {
      const g = sc.groups.find(x => x.id === sel), o = scaleTarget(sel);
      if (g && g.box && o) { drag = { t: "scale", o, box: Object.assign({}, g.box), k0: o.k || 1, moved: false }; stage.setPointerCapture(e.pointerId); }
      return;
    }
    if (hd && hd.dataset.h === "bsize") { drag = { t: "bsize", c: idOf(sel), moved: false }; stage.setPointerCapture(e.pointerId); return; }
    if (hd) { startLeader(e); return; }
    const g = t.closest("[data-id]");
    const id = g && g.dataset.id;
    const k = kindOf(id);
    if (id && ["c", "w", "x", "t", "k", "tbl", "blk"].includes(k) && sheet === 1) {
      select(id);
      if (k !== "x" && k !== "t") startMove(e, id);
      return;
    }
    if (id && (k === "blk" || k === "tbl")) { select(id); return; }
    select(null);
    startPan(e);
  });
  function startPan(e) {
    drag = { t: "pan", sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
    stage.classList.add("panning");
    stage.setPointerCapture(e.pointerId);
  }
  function startMove(e, id) {
    const k = kindOf(id), o = selObj();
    let orig;
    if (k === "blk") {
      const key = idOf(id), g = sc.groups.find(x => x.id === id);
      orig = p.pos[key] ? Object.assign({}, p.pos[key]) : key === "notes" ? { x: g.box.x + 4, y: g.box.y + 2 } : { x: g.box.x, y: g.box.y };
    } else orig = { x: o.x, y: o.y };
    drag = { t: "move", id, start: toSheet(e), orig, moved: false };
    stage.setPointerCapture(e.pointerId);
  }
  function startLeader(e) {
    const k = callout(idOf(sel));
    if (!k) return;
    drag = { t: "leader", k, moved: false };
    stage.setPointerCapture(e.pointerId);
  }
  function startWire(e, port) {
    const src = portInfo(port);
    if (!src) return;
    drag = { t: "wire", src, from: { x: +port.getAttribute("cx"), y: +port.getAttribute("cy") }, hot: null };
    svg.classList.add("show-ports");
    stage.setPointerCapture(e.pointerId);
  }
  const portInfo = el => el.dataset.pc ? { t: "pin", c: el.dataset.pc, p: +el.dataset.pp } : el.dataset.rw ? { t: "row", w: el.dataset.rw, end: el.dataset.rend }
    : el.dataset.sc ? { t: "shield", cable: el.dataset.sc, end: el.dataset.se } : null;

  stage.addEventListener("pointermove", e => {
    if (!drag) return;
    if (drag.t === "pan") {
      view.x = drag.vx - (e.clientX - drag.sx) / view.s; view.y = drag.vy - (e.clientY - drag.sy) / view.s;
      setViewBox();
    } else if (drag.t === "move") {
      const pt = toSheet(e), dx = pt.x - drag.start.x, dy = pt.y - drag.start.y;
      if (!drag.moved && Math.hypot(dx, dy) * view.s < 3) return;
      if (!drag.moved) { pushUndo(); drag.moved = true; }
      const nx = snap(drag.orig.x + dx, e.altKey), ny = snap(drag.orig.y + dy, e.altKey);
      const k = kindOf(drag.id);
      if (k === "blk") p.pos[idOf(drag.id)] = { x: nx, y: ny };
      else { const o = selObj(); if (o) { o.x = nx; o.y = ny; } }
      requestRender();
    } else if (drag.t === "scale") {
      // the box's top-left stays put; the corner follows the pointer (both axes averaged)
      const pt = toSheet(e), b = drag.box;
      const r = ((pt.x - b.x) / b.w + (pt.y - b.y) / b.h) / 2;
      let k = drag.k0 * Math.max(0.05, r);
      if (!e.altKey) k = Math.round(k * 20) / 20;
      k = CD.scaleK(k);
      if (k === drag.o.k && !drag.moved) return;
      if (!drag.moved) { pushUndo(); drag.moved = true; }
      drag.o.k = k;
      requestRender();
    } else if (drag.t === "bpin" || drag.t === "bsize") {
      const c = conn(drag.c), L = sc.blocks.conn && sc.blocks.conn[drag.c];
      if (!c || !c.board || !L) return;
      const pt = toSheet(e);
      if (!drag.moved) { pushUndo(); drag.moved = true; }
      if (drag.t === "bsize") {
        c.board.w = Math.max(60, snap(pt.x - c.x, e.altKey)); c.board.h = Math.max(40, snap(pt.y - c.y, e.altKey));
      } else {
        // nearest edge, then the spot along it (5 pt steps)
        const x0 = c.x, y0 = c.y, w = c.board.w, h = c.board.h, HDR = 15;
        const cx = Math.max(x0, Math.min(x0 + w, pt.x)), cy = Math.max(y0 + HDR, Math.min(y0 + h, pt.y));
        const d = { L: Math.hypot(pt.x - x0, pt.y - cy), R: Math.hypot(pt.x - x0 - w, pt.y - cy), T: Math.hypot(pt.x - cx, pt.y - y0), B: Math.hypot(pt.x - cx, pt.y - y0 - h) };
        const side = Object.keys(d).sort((a, b) => d[a] - d[b])[0];
        const len = side === "L" || side === "R" ? h - HDR : w, along = side === "L" || side === "R" ? cy - y0 - HDR : cx - x0;
        const t = Math.max(0, Math.min(1, (e.altKey ? along : Math.round(along / 5) * 5) / len));
        c.board.pins[drag.i] = { side, t: Math.round(t * 1000) / 1000 };
      }
      requestRender();
    } else if (drag.t === "leader") {
      if (!drag.moved) { pushUndo(); drag.moved = true; }
      const pt = toSheet(e);
      drag.k.lx = snap(pt.x, e.altKey); drag.k.ly = snap(pt.y, e.altKey);
      requestRender();
    } else if (drag.t === "wire") {
      const pt = toSheet(e);
      const under = document.elementFromPoint(e.clientX, e.clientY);
      const hot = under && under.closest && under.closest(".port");
      $("ovl").querySelectorAll(".port.hot").forEach(x => x.classList.remove("hot"));
      if (hot) hot.classList.add("hot");
      drag.hot = hot;
      let ln = $("ovl").querySelector(".drag-line");
      if (!ln) { ln = document.createElementNS("http://www.w3.org/2000/svg", "line"); ln.setAttribute("class", "drag-line"); $("ovl").appendChild(ln); }
      ln.setAttribute("x1", drag.from.x); ln.setAttribute("y1", drag.from.y); ln.setAttribute("x2", pt.x); ln.setAttribute("y2", pt.y);
    }
  });
  const endDrag = e => {
    if (!drag) return;
    const d = drag; drag = null;
    stage.classList.remove("panning");
    if (!ui.ports) svg.classList.remove("show-ports");
    if (d.t === "move" && d.moved) { scheduleSave(); refreshPanels(); render(); }
    if (d.t === "leader" && d.moved) { scheduleSave(); render(); }
    if ((d.t === "bpin" || d.t === "bsize" || d.t === "scale") && d.moved) { scheduleSave(); render(); renderInspector(); }
    if (d.t === "wire") {
      const tgt = d.hot && portInfo(d.hot);
      if (tgt) makeWire(d.src, tgt); else render();
    }
  };
  stage.addEventListener("pointerup", endDrag);
  stage.addEventListener("dblclick", e => { const g = e.target.closest("[data-id]"); if (g && /^(frame|rev)$/.test(g.dataset.id)) drawingDialog(); });
  stage.addEventListener("pointercancel", endDrag);

  function makeWire(a, b) {
    if (a.t === "shield" || b.t === "shield") {
      const s1 = a.t === "shield" ? a : b, other = s1 === a ? b : a;
      if (other.t === "row") { toast("Tie a shield to another shield, a pin, a splice or ground.", "warn"); render(); return; }
      pushUndo();
      const t = CD.addTie(p, { cable: s1.cable, end: s1.end }, other);
      if (!t) { undo.pop(); paintUndo(); render(); return; }
      sel = "t:" + t.id;
      changed(true);
      return;
    }
    if (a.t === "row" && b.t === "row") { toast("Drag from a pin to a cable conductor, not conductor to conductor.", "warn"); render(); return; }
    if (a.t === "pin" && b.t === "pin" && a.c === b.c && a.p === b.p) { render(); return; }
    pushUndo();
    if (a.t === "pin" && b.t === "pin") {
      const w = CD.newWire(p, Object.assign({}, ui.wire, { a: { c: a.c, p: a.p }, b: { c: b.c, p: b.p } }));
      p.wires.push(w);
      sel = "x:" + w.id;
      toast("Wire " + w.ref + " added. Set its size, colour and length on the right.");
    } else {
      const row = a.t === "row" ? a : b, pin = a.t === "pin" ? a : b;
      const w = wire(row.w);
      if (!w) return;
      w[row.end] = { c: pin.c, p: pin.p };
      sel = "x:" + w.id;
    }
    changed(true);
  }

  // ---------- selection ----------
  function select(id) {
    if (id === sel) return;
    sel = id; lastEdit = "";
    condSel.clear();
    drawOverlay();
    renderInspector(); renderOutline(); markDrawerSel();
  }

  // ---------- change plumbing ----------
  function changed(insp) {
    render();
    if (insp) renderInspector();
    refreshPanels();
    scheduleSave();
  }
  function refreshPanels() {
    renderOutline();
    const f = document.activeElement;
    if (ui.drawer && !$("drawer").contains(f)) renderDrawer();
    paintStats(); paintChecks(); paintSheets();
  }
  function refreshAll() { render(); renderInspector(); renderOutline(); if (ui.drawer) renderDrawer(); paintStats(); paintChecks(); paintSheets(); paintDocId(); }

  // ---------- field binding ----------
  function resolve(ref) {
    if (!ref) return null;
    const [k, a, b] = ref.split(":");
    switch (k) {
      case "meta": return p.meta;
      case "c": return conn(a);
      case "w": return cable(a);
      case "x": return wire(a);
      case "k": return callout(a);
      case "tb": return ctable(a);
      case "blk": return p.blk && p.blk[a];
      case "pin": { const c = conn(a); return c && c.pins[+b]; }
      case "acc": { const c = conn(a); return c && c.acc[+b]; }
      case "bpin": { const c = conn(a); return c && c.board && c.board.pins[+b]; }
      case "g": { const c = cable(a); return c && c.groups.find(g => g.id === b); }
      case "m": { const c = cable(a); return c && c.marks.find(m => m.id === b); }
      case "h": return p.history[+a];
      case "n": return p.notes[+a];
    }
    return null;
  }
  const setPath = (o, path, v) => { const ks = path.split("."); let t = o; ks.slice(0, -1).forEach(k => { t = t[k] = t[k] || {}; }); t[ks[ks.length - 1]] = v; };
  const getPath = (o, path) => path.split(".").reduce((t, k) => t == null ? t : t[k], o);

  const FX = {
    lib(c, v) {
      const lib = CD.LIB[v]; if (!lib) return;
      const fresh = CD.newConn(p, v, c.x, c.y);
      fresh.pins.forEach((pn, i) => { if (c.pins[i]) pn.sig = c.pins[i].sig || pn.sig; });
      c.pins = fresh.pins; c.face = fresh.face; c.custom = fresh.custom; c.layout = null;
      if (!lib.gender) c.gender = "none"; else if (c.gender === "none") c.gender = "female";
      p.wires.forEach(w => ["a", "b"].forEach(e => { if (w[e] && w[e].c === c.id && w[e].p >= c.pins.length) w[e] = null; }));
      c.board = fresh.board;
      CD.pruneTies(p);
    },
    pins(c, v) { CD.setPinCount(p, c, parseInt(v, 10)); },
    wireProfile(w, v) { const x = parts.find(q => q.id === v && q.type === "wire"); if (x) { CD.applyWirePart(w, x); toast(x.name + " applied"); } },
    pct(o, v) { const n = parseFloat(v); if (isFinite(n)) o.k = CD.scaleK(n / 100); },
    boardSize(c, v, el) { const k = el.dataset.k.split(".")[1], n = parseFloat(v); if (isFinite(n)) c.board[k] = Math.max(k === "w" ? 60 : 40, Math.round(n)); else c.board[k] = k === "w" ? 150 : 100; },
    tblSheet(t, v) { t.sheet = v === "2" ? 2 : 1; sheet = t.sheet; paintSheets(); requestAnimationFrame(fit); },
    tie(c, v, el) {
      if (!v) return;
      const [t, a, b] = v.split(":");
      CD.addTie(p, { cable: c.id, end: el.dataset.end }, t === "s" ? { t: "shield", cable: a, end: b } : { t: "pin", c: a, p: +b });
    },
    endc(w, v, el) {
      const e = el.dataset.end;
      if (!v) { w[e] = null; return; }
      const c = conn(v), old = w[e];
      w[e] = { c: v, p: old && old.c === v ? old.p : 0 };
      if (c && w[e].p >= c.pins.length) w[e].p = 0;
    },
    endp(w, v, el) { const e = el.dataset.end; if (w[e]) w[e].p = parseInt(v, 10) || 0; },
    cable(w, v) {
      const old = cable(w.cable);
      if (old) old.groups.forEach(g => { g.wires = g.wires.filter(id => id !== w.id); });
      if (old) old.groups = old.groups.filter(g => g.wires.length > 1);
      w.cable = v || null;
      if (!w.cable && !w.ref) w.ref = CD.nextWireNo(p);
    },
    shieldType(c, v) { if (v === "none") { c.shield.a = "none"; c.shield.b = "none"; } else { if (c.shield.a === "none") c.shield.a = "pigtail"; if (c.shield.b === "none") c.shield.b = "float"; } },
    wireDefault(w, v, el) { ui.wire[el.dataset.k] = v; saveUi(); },
    meta() { paintDocId(); },
    size() { requestAnimationFrame(fit); }
  };
  function onField(e) {
    const el = e.target.closest("[data-k]");
    if (!el || !el.dataset.o) return;
    if (el.dataset.lazy && e.type !== "change") return;   // e.g. pin count: apply when done typing
    const o = resolve(el.dataset.o);
    if (!o) return;
    const key = el.dataset.k;
    const v = el.type === "checkbox" ? el.checked : el.value;
    editPush(el.dataset.o + "|" + key);
    if (!el.dataset.fx || el.dataset.set !== "0") setPath(o, key, v);
    if (el.dataset.fx) el.dataset.fx.split(" ").forEach(f => FX[f] && FX[f](o, v, el));
    if (el.dataset.o === "meta") paintDocId();
    if (el.dataset.re) {
      changed(true);
      if ($("drawer").contains(el)) renderDrawer();
      if ($("overlay").classList.contains("open") && modalRefresh) modalRefresh();
    }
    else changed(false);
  }
  ["inspBody", "drawerBody", "modal"].forEach(id => {
    $(id).addEventListener("input", onField);
    $(id).addEventListener("change", e => { if (e.target.dataset && e.target.dataset.lazy) onField(e); });
  });

  // ---------- form helpers ----------
  const attrs = a => a ? " " + a : "";
  const I = (o, k, v, a) => '<input data-o="' + o + '" data-k="' + k + '" value="' + esc(v) + '"' + attrs(a) + ">";
  const S = (o, k, v, opts, a) => '<select data-o="' + o + '" data-k="' + k + '"' + attrs(a) + ">" + optHtml(opts, v) + "</select>";
  const optHtml = (opts, v) => opts.map(x => '<option value="' + esc(x[0]) + '"' + (String(x[0]) === String(v == null ? "" : v) ? " selected" : "") + ">" + esc(x[1]) + "</option>").join("");
  const T = (o, k, v, a) => '<textarea data-o="' + o + '" data-k="' + k + '"' + attrs(a) + ">" + esc(v) + "</textarea>";
  const C = (o, k, v, label, a) => '<label class="chk"><input type="checkbox" data-o="' + o + '" data-k="' + k + '"' + (v ? " checked" : "") + attrs(a) + ">" + label + "</label>";
  const F = (label, inner) => '<label class="field"><span class="lbl">' + label + "</span>" + inner + "</label>";
  const B = (a, label, extra, cls) => '<button class="btn btn-xs ' + (cls || "") + '" data-a="' + a + '"' + attrs(extra) + ">" + label + "</button>";
  const IB = (a, label, title, extra) => '<button class="icon-btn" data-a="' + a + '" title="' + title + '" aria-label="' + title + '"' + attrs(extra) + ">" + label + "</button>";
  const sec = (title, body, acts) => '<div class="sec"><div class="sec-h"><span class="grp-lbl">' + title + "</span>" + (acts ? '<div class="btn-row">' + acts + "</div>" : "") + "</div>" + body + "</div>";

  const COLOR_OPTS = CD.COLORS.map(c => [c.code, c.code + "  " + c.name]);
  const STRIPE_OPTS = [["", "No stripe"]].concat(CD.COLORS.filter(c => !c.bare && !c.stripe).map(c => [c.code, c.code + "  " + c.name]));
  const JCOLOR_OPTS = [["", "Not set"]].concat(CD.COLORS.filter(c => !c.bare && !c.stripe).map(c => [c.code, c.code + "  " + c.name]));
  const libSelect = (o, v) => {
    const groups = [];
    CD.LIB_LIST.forEach(l => { let g = groups.find(x => x.name === l.group); if (!g) groups.push(g = { name: l.group, items: [] }); g.items.push(l); });
    return '<select data-o="' + o + '" data-k="lib" data-fx="lib" data-re="1">' + groups.map(g => '<optgroup label="' + esc(g.name) + '">' + g.items.map(l => '<option value="' + l.key + '"' + (l.key === v ? " selected" : "") + ">" + esc(l.name) + "</option>").join("") + "</optgroup>").join("") + "</select>";
  };
  const connOpts = () => [["", "—"]].concat(p.conns.map(c => [c.id, c.ref]));
  const pinOpts = c => c ? c.pins.map((pn, i) => [i, pn.n + (pn.sig ? "  " + pn.sig : "")]) : [];
  const swatch = code => { const c = CD.COLOR[code]; if (!c) return '<span class="sw"></span>'; const st = c.stripe ? CD.COLOR[c.stripe].hex : null; return '<span class="sw" style="background:' + (st ? "linear-gradient(135deg," + c.hex + " 55%," + st + " 55%)" : c.hex) + '"></span>'; };
  const gTol = () => CD.num(p.meta.tol) != null ? "± " + p.meta.tol + " (general)" : "± (general)";

  // ---------- inspector ----------
  function renderInspector() {
    const body = $("inspBody"), k = kindOf(sel), o = selObj();
    let title = "Drawing", acts = "", html = "";
    if (k === "c" && o) { title = (o.board ? "Board" : "Connector") + " <b>" + esc(o.ref) + "</b>"; html = connForm(o); acts = IB("dup", "⧉", "Duplicate (Ctrl+D)") + IB("del", "✕", "Delete (Del)"); }
    else if (k === "w" && o) { title = (o.kind === "bundle" ? "Bundle " : "Cable ") + "<b>" + esc(o.ref) + "</b>"; html = cableForm(o); acts = IB("dup", "⧉", "Duplicate (Ctrl+D)") + IB("del", "✕", "Delete (Del)"); }
    else if (k === "x" && o) { title = "Wire <b>" + esc(CD.wireRef(p, o)) + "</b>"; html = wireForm(o); acts = IB("del", "✕", "Delete (Del)"); }
    else if (k === "t") {
      const t = (p.ties || []).find(x => x.id === idOf(sel));
      if (t) { title = "Shield tie"; html = '<div class="stat"><span>From</span><b>' + esc(CD.shieldText(p, t.a.cable, t.a.end)) + "</b><span>To</span><b>" + esc(CD.tieTargetText(p, t.b)) + "</b></div>"; acts = IB("del", "✕", "Delete (Del)"); }
    }
    else if (k === "tbl" && o) { title = "Table"; html = tableForm(o); acts = IB("dup", "⧉", "Duplicate (Ctrl+D)") + IB("del", "✕", "Delete (Del)"); }
    else if (k === "k" && o) { title = "Callout"; html = calloutForm(o); acts = IB("dup", "⧉", "Duplicate (Ctrl+D)") + IB("del", "✕", "Delete (Del)"); }
    else if (k === "blk") { title = { wires: "Wire list", bom: "Bill of materials", notes: "Notes" }[idOf(sel)] || "Table"; html = blockForm(idOf(sel)); }
    else html = drawingForm();
    $("inspTitle").innerHTML = title;
    $("inspActs").innerHTML = acts;
    // A redraw while typing (fields with data-re) must not drop focus: put it back with the cursor.
    const a = document.activeElement;
    const keep = a && body.contains(a) && a.dataset && a.dataset.k ? { o: a.dataset.o, k: a.dataset.k, s: a.selectionStart, e: a.selectionEnd } : null;
    const st = body.scrollTop;
    body.innerHTML = html;
    body.scrollTop = st;
    if (keep) {
      const el = [...body.querySelectorAll("[data-k]")].find(x => x.dataset.o === keep.o && x.dataset.k === keep.k);
      if (el) {
        el.focus({ preventScroll: true });
        try { if (keep.s != null) el.setSelectionRange(keep.s, keep.e); } catch (e) { /* selects and number fields have no cursor */ }
      }
    }
  }

  function boardForm(c) {
    const o = "c:" + c.id;
    const used = {};
    p.wires.forEach(w => ["a", "b"].forEach(e => { if (w[e] && w[e].c === c.id) (used[w[e].p] = used[w[e].p] || []).push(CD.wireRef(p, w)); }));
    (p.ties || []).forEach(t => { if (t.b.t === "pin" && t.b.c === c.id) (used[t.b.p] = used[t.b.p] || []).push(CD.shieldText(p, t.a.cable, t.a.end)); });
    const SIDES = [["L", "Left"], ["R", "Right"], ["T", "Top"], ["B", "Bottom"]];
    let h = '<div class="r2">' + F("Reference", I(o, "ref", c.ref, 'data-re="1"')) + F("Type", libSelect(o, c.lib)) + "</div>";
    h += F("PCB name", I(o, "desc", c.desc, 'placeholder="e.g. Interface board"'));
    h += '<div class="r3">' + F("Mfr", I(o, "mfr", c.mfr)) + F("Mfr part no.", I(o, "mpn", c.mpn)) + F("Part no.", I(o, "ipn", c.ipn)) + "</div>";
    h += '<div class="r2">' + F("Width", I(o, "board.w", c.board.w, 'inputmode="decimal" data-fx="boardSize" data-set="0"')) + F("Height", I(o, "board.h", c.board.h, 'inputmode="decimal" data-fx="boardSize" data-set="0"')) + "</div>";
    h += sec("Pins (" + c.pins.length + ")", '<table class="pins bpins"><tbody>' + c.pins.map((pn, i) => "<tr><td>" + (i + 1) + "</td><td>" + I("pin:" + c.id + ":" + i, "n", pn.n, 'class="pn"') + "</td><td>" +
      I("pin:" + c.id + ":" + i, "sig", pn.sig, 'placeholder="Signal"') + "</td><td>" + S("bpin:" + c.id + ":" + i, "side", c.board.pins[i].side, SIDES, 'data-re="1"') + "</td><td>" +
      IB("bpinDel", "✕", "Remove pin", 'data-id="' + c.id + '" data-i="' + i + '"') + '</td></tr><tr class="used-row"><td></td><td colspan="4" class="used">' + esc((used[i] || []).join(", ")) + "</td></tr>").join("") + "</tbody></table>",
      B("bpinAdd", "＋ Left", 'data-id="' + c.id + '" data-i="L"') + B("bpinAdd", "＋ Right", 'data-id="' + c.id + '" data-i="R"') + B("bpinSpace", "Space evenly", 'data-id="' + c.id + '"'));
    const im = c.board.img;
    h += sec("Image", (im ? '<img class="bimg-thumb" alt="Board image" src="' + im.data + '"><p class="hint">' + im.w + " × " + im.h + " px</p>" : '<p class="hint">Load, paste or drop a picture of the board.</p>') +
      '<div class="btn-row">' + B("bimgPick", im ? "Replace…" : "Load image…", 'data-id="' + c.id + '"') + (im ? B("bimgFit", "Fit block to image", 'data-id="' + c.id + '"') + B("bimgDel", "Remove", 'data-id="' + c.id + '"', "btn-danger") : "") + "</div>");
    h += F("Note", T(o, "note", c.note, 'rows="2"'));
    h += '<div class="btn-row">' + B("partSave", "Save to My parts…", 'data-id="' + c.id + '"') + "</div>";
    return h;
  }

  function connForm(c) {
    if (c.board) return boardForm(c);
    const o = "c:" + c.id, lib = CD.libOf(c), node = lib.kind === "splice" || lib.kind === "ground";
    const used = {};
    p.wires.forEach(w => ["a", "b"].forEach(e => { if (w[e] && w[e].c === c.id) (used[w[e].p] = used[w[e].p] || []).push(CD.wireRef(p, w)); }));
    let h = '<div class="r2">' + F("Reference", I(o, "ref", c.ref, 'data-re="1"')) + F("Type", libSelect(o, c.lib)) + "</div>";
    if (!node) h += '<div class="r2">' + F("Positions", '<input type="number" min="1" max="200" data-o="' + o + '" data-k="pins" data-fx="pins" data-set="0" data-re="1" data-lazy="1" value="' + c.pins.length + '"' + (lib.var && !c.layout ? "" : ' disabled title="' + (c.layout ? "Add or remove pins in the face builder" : "Fixed by the connector type") + '"') + ">") +
      F("Gender", S(o, "gender", c.gender, CD.GENDERS, lib.gender ? 'data-re="1"' : "disabled")) + "</div>";
    h += F("Description", I(o, "desc", c.desc, 'placeholder="' + esc(lib.name) + '"'));
    h += '<div class="r3">' + F("Mfr", I(o, "mfr", c.mfr)) + F("Mfr part no.", I(o, "mpn", c.mpn)) + F("Part no.", I(o, "ipn", c.ipn)) + "</div>";
    if (lib.face && lib.face.t !== "none") {
      let fh = '<div class="r2">' + C(o, "face", c.face, "Show face view") + S(o, "faceFrom", c.faceFrom, [["mate", "Mating face"], ["rear", "Wire side"]]) + "</div>";
      if (c.custom && !c.layout) fh += '<div class="r2">' + F("Rows", S(o, "custom.rows", c.custom.rows, [[1, "1 row"], [2, "2 rows"], [3, "3 rows"], [4, "4 rows"]])) + F("Numbering", S(o, "custom.order", c.custom.order, [["rows", "Row by row"], ["zigzag", "Across rows (odd / even)"]])) + "</div>";
      if (lib.face.t !== "one") fh += '<div class="btn-row">' + B("faceEdit", c.layout ? "Edit face…" : "Face builder…", 'data-id="' + c.id + '"', "btn-primary") + "</div>";
      fh += '<p class="hint">' + (c.layout ? "Custom face: " + c.layout.pins.length + " pins, drawn to match the maker's drawing." : "Library face, a guide only. Use the face builder to match the maker's drawing (rings, centre pins, contact sizes, keyways).") + "</p>";
      h += sec("Face view", fh);
    }
    if (!node) {
      h += sec("Contact / terminal", '<div class="r3">' + F("Mfr", I(o, "term.mfr", c.term.mfr)) + F("Mfr part no.", I(o, "term.mpn", c.term.mpn)) + F("Part no.", I(o, "term.ipn", c.term.ipn)) + "</div>" +
        F("Description", I(o, "term.desc", c.term.desc, 'placeholder="Contact / terminal"')) + '<p class="hint">BOM quantity is one per wired position.</p>');
      h += sec("Wire seal", '<div class="r3">' + F("Mfr", I(o, "seal.mfr", c.seal.mfr)) + F("Mfr part no.", I(o, "seal.mpn", c.seal.mpn)) + F("Part no.", I(o, "seal.ipn", c.seal.ipn)) + "</div>");
      h += sec("Accessories", c.acc.map((a, i) => {
        const ao = "acc:" + c.id + ":" + i;
        return '<div class="card"><div class="card-h"><span class="grow">' + esc(a.desc || "Accessory " + (i + 1)) + "</span>" + IB("accDel", "✕", "Remove accessory", 'data-id="' + c.id + '" data-i="' + i + '"') + "</div>" +
          F("Description", I(ao, "desc", a.desc, 'placeholder="Backshell, boot, strain relief, cap…"')) +
          '<div class="r3">' + F("Mfr", I(ao, "mfr", a.mfr)) + F("Mfr part no.", I(ao, "mpn", a.mpn)) + F("Part no.", I(ao, "ipn", a.ipn)) + "</div>" +
          '<div class="r3">' + F("Qty", I(ao, "qty", a.qty)) + "</div></div>";
      }).join("") || '<p class="hint">Backshells, boots, strain reliefs, dust caps.</p>', B("accAdd", "＋ Accessory", 'data-id="' + c.id + '"'));
      if (lib.kind === "flying" || lib.kind === "term") h += F("Strip length", I(o, "strip", c.strip, 'placeholder="e.g. 0.25"'));
      h += sec("Pins", '<table class="pins"><tbody>' + c.pins.map((pn, i) => '<tr><td>' + (i + 1) + "</td><td>" + I("pin:" + c.id + ":" + i, "n", pn.n, 'class="pn" title="Pin number as marked on the housing"') + "</td><td>" +
        I("pin:" + c.id + ":" + i, "sig", pn.sig, 'placeholder="Signal"') + '</td><td class="used" title="Wires on this pin">' + esc((used[i] || []).join(", ")) + "</td></tr>").join("") + "</tbody></table>",
        B("pinsPaste", "Paste signals…", 'data-id="' + c.id + '"'));
    }
    h += F("Note", T(o, "note", c.note, 'rows="2"'));
    if (!node) h += '<div class="btn-row">' + B("partSave", "Save to My parts…", 'data-id="' + c.id + '"') + "</div>";
    return h;
  }

  function cableForm(c) {
    const o = "w:" + c.id, list = CD.conductors(p, c);
    let h = '<div class="r2">' + F("Reference", I(o, "ref", c.ref, 'data-re="1"')) + F("Kind", S(o, "kind", c.kind, [["cable", "Jacketed cable"], ["bundle", "Bundle / loose group"]], 'data-re="1"')) + "</div>";
    h += F("Description", I(o, "desc", c.desc, 'placeholder="e.g. 2 pair shielded, 24 AWG"'));
    h += '<div class="r3">' + F("Mfr", I(o, "mfr", c.mfr)) + F("Mfr part no.", I(o, "mpn", c.mpn)) + F("Part no.", I(o, "ipn", c.ipn)) + "</div>";
    if (c.kind !== "bundle") h += '<div class="r3">' + F("Jacket", I(o, "jacket", c.jacket, 'list="dlInsul"')) + F("Jacket colour", S(o, "jcolor", c.jcolor, JCOLOR_OPTS)) + F("OD", I(o, "od", c.od)) + "</div>";
    const u = CD.UNIT(p.meta.units);
    h += sec("Lengths (" + u + ")", '<div class="r2">' + F("Overall length", I(o, "len", c.len, 'inputmode="decimal"')) + F("Tolerance ±", I(o, "tol", c.tol, 'inputmode="decimal" placeholder="' + gTol() + '"')) + "</div>" +
      '<div class="r3">' + F("Strip end A", I(o, "stripA", c.stripA, 'inputmode="decimal" title="Jacket strip / breakout length at end A"')) + F("Strip end B", I(o, "stripB", c.stripB, 'inputmode="decimal"')) + F("Strip tol ±", I(o, "stripTol", c.stripTol, 'inputmode="decimal" placeholder="general"')) + "</div>");
    const sh = c.shield.type !== "none";
    h += sec("Shield", '<div class="r3">' + F("Type", S(o, "shield.type", c.shield.type, CD.SHIELDS, 'data-fx="shieldType" data-re="1"')) +
      F("End A", S(o, "shield.a", c.shield.a, CD.SHIELD_TERMS, sh ? "" : "disabled")) + F("End B", S(o, "shield.b", c.shield.b, CD.SHIELD_TERMS, sh ? "" : "disabled")) + "</div>" +
      (sh ? ["a", "b"].map(e => {
        const ts = CD.tiesOf(p, c.id, e);
        const other = t => t.a.cable === c.id && t.a.end === e ? CD.tieTargetText(p, t.b) : CD.shieldText(p, t.a.cable, t.a.end);
        const opts = [["", "Tie end " + e.toUpperCase() + " to…"]]
          .concat(p.cables.filter(x => x.shield.type !== "none").flatMap(x => ["a", "b"].filter(z => !(x.id === c.id && z === e)).map(z => ["s:" + x.id + ":" + z, x.ref + " shield " + z.toUpperCase()])))
          .concat(p.conns.flatMap(k => CD.libOf(k).kind === "splice" || CD.libOf(k).kind === "ground" ? [["p:" + k.id + ":0", k.ref]] : k.pins.map((pn, i) => ["p:" + k.id + ":" + i, k.ref + ":" + pn.n + (pn.sig ? "  " + pn.sig : "")])));
        return '<div class="tie-end"><span class="lbl">End ' + e.toUpperCase() + " ties</span>" +
          ts.map(t => '<div class="tie-row"><span>' + esc(other(t)) + "</span>" + IB("tieDel", "✕", "Remove tie", 'data-id="' + t.id + '"') + "</div>").join("") +
          '<select data-o="' + o + '" data-k="tieTo" data-fx="tie" data-set="0" data-end="' + e + '" data-re="1">' + optHtml(opts, "") + "</select></div>";
      }).join("") : "") +
      (c.kind !== "bundle" ? '<div class="btn-row">' + B("insertBoard", "Insert junction board", 'data-id="' + c.id + '" title="Cut this cable at a new board"') + "</div>" : ""));
    const rows = list.map((w, i) => {
      const wo = "x:" + w.id, g = CD.groupOf(c, w.id);
      return '<div class="cond-row"><input type="checkbox" data-cs="' + w.id + '"' + (condSel.has(w.id) ? " checked" : "") + ' title="Tick to twist" aria-label="Tick to twist">' +
        I(wo, "ref", w.ref, 'placeholder="' + esc(c.ref + "-" + (i + 1)) + '" title="Wire ID" aria-label="Wire ID"') +
        I(wo, "gauge", w.gauge, 'list="dlAwg" placeholder="Size" title="Size (' + (w.gu === "mm2" ? "mm²" : "AWG") + ')" aria-label="Size"') +
        '<div class="cond-acts">' + IB("condUp", "▲", "Move up", 'data-id="' + w.id + '"' + (i ? "" : " disabled")) + IB("wsel", "↗", "Open wire" + (g ? " (in TW" + (c.groups.indexOf(g) + 1) + ")" : ""), 'data-id="' + w.id + '"') + IB("condDel", "✕", "Remove conductor", 'data-id="' + w.id + '"') + "</div>" +
        '<div class="cond-col">' + swatch(w.color) + S(wo, "color", w.color, COLOR_OPTS, 'data-re="1" aria-label="Colour"') + "</div>" +
        S(wo, "stripe", w.stripe, STRIPE_OPTS, 'data-re="1" class="cond-stripe" aria-label="Stripe"') + "</div>";
    }).join("");
    h += sec("Conductors (" + list.length + ")", (list.length ? '<div class="cond"><div class="cond-row cond-head"><span class="cond-h h1">ID</span><span class="cond-h h2">Size</span><span class="cond-h h3">Colour</span><span class="cond-h h4">Stripe</span></div>' + rows + "</div>" : '<p class="hint">No conductors yet.</p>') +
      '<div class="btn-row">' + B("condAdd", "＋ Conductor", 'data-id="' + c.id + '"') + B("drainAdd", "＋ Drain", 'data-id="' + c.id + '"') + B("twist", "Twist ticked", 'data-id="' + c.id + '"') + B("connect", "Connect ends…", 'data-id="' + c.id + '"') + "</div>");
    h += sec("Twisted groups", c.groups.map((g, gi) => {
      const go = "g:" + c.id + ":" + g.id;
      const names = list.filter(w => g.wires.includes(w.id)).map(w => CD.wireRef(p, w)).join(", ");
      return '<div class="card"><div class="card-h"><span>TW' + (gi + 1) + '</span><span class="grow" style="font-weight:400;color:var(--text-dim)">' + esc(names) + "</span>" + IB("ungroup", "✕", "Untwist", 'data-id="' + c.id + '" data-i="' + g.id + '"') + "</div>" +
        '<div class="r2">' + F("Lay length (" + u + " per twist)", I(go, "lay", g.lay, 'inputmode="decimal"')) + F("Group shield", S(go, "shield", g.shield, [["none", "None"], ["foil", "Foil"], ["braid", "Braid"]])) + "</div></div>";
    }).join("") || '<p class="hint">Tick two or more conductors, then press Twist ticked.</p>');
    h += sec("Labels, heat-shrink, sleeving", c.marks.map(m => {
      const mo = "m:" + c.id + ":" + m.id;
      return '<div class="card"><div class="card-h"><span class="grow">' + esc((CD.MARKS.find(x => x[0] === m.kind) || ["", ""])[1]) + "</span>" + IB("markDel", "✕", "Remove", 'data-id="' + c.id + '" data-i="' + m.id + '"') + "</div>" +
        '<div class="r2">' + F("Kind", S(mo, "kind", m.kind, CD.MARKS, 'data-re="1"')) + F("Where", S(mo, "end", m.end, CD.MARK_ENDS)) + "</div>" +
        F("Text / instruction", I(mo, "text", m.text, 'placeholder="Legend or how to apply"')) +
        F("BOM description", I(mo, "desc", m.desc)) +
        '<div class="r3">' + F("Mfr", I(mo, "mfr", m.mfr)) + F("Mfr part no.", I(mo, "mpn", m.mpn)) + F("Part no.", I(mo, "ipn", m.ipn)) + "</div>" +
        '<div class="r2">' + F("Qty per place", I(mo, "qty", m.qty, 'placeholder="1"')) + F("Cut length", I(mo, "len", m.len, 'placeholder="for tubing"')) + "</div></div>";
    }).join(""), B("markAdd", "＋ Add", 'data-id="' + c.id + '"'));
    h += F("Note", T(o, "note", c.note, 'rows="2"'));
    h += '<div class="btn-row">' + B("partSave", "Save cable to My parts…", 'data-id="' + c.id + '" data-kind="cable"') + "</div>";
    return h;
  }

  function wireForm(w) {
    const o = "x:" + w.id, c = cable(w.cable), u = CD.UNIT(p.meta.units);
    const wps = parts.filter(x => x.type === "wire").sort((a, b) => a.name.localeCompare(b.name));
    let h = wps.length ? F("Wire profile", '<select data-o="' + o + '" data-k="profile" data-fx="wireProfile" data-set="0" data-re="1"><option value="">Use a saved wire…</option>' +
      wps.map(x => '<option value="' + esc(x.id) + '">' + esc(x.name) + "</option>").join("") + "</select>") : "";
    h += '<div class="r2">' + F("Wire ID", I(o, "ref", w.ref, 'data-re="1" placeholder="' + esc(CD.wireRef(p, w)) + '"')) +
      F("In cable", S(o, "cable", w.cable || "", [["", "Loose wire"]].concat(p.cables.map(x => [x.id, x.ref])), 'data-fx="cable" data-set="0" data-re="1"')) + "</div>";
    h += '<div class="r3">' + F("Size", I(o, "gauge", w.gauge, 'list="dlAwg" data-fx="wireDefault"')) + F("Unit", S(o, "gu", w.gu, [["AWG", "AWG"], ["mm2", "mm²"]], 'data-fx="wireDefault"')) + F("Insulation", I(o, "insul", w.insul, 'list="dlInsul" data-fx="wireDefault"')) + "</div>";
    h += '<div class="r2">' + F("Colour " + swatch(w.color), S(o, "color", w.color, COLOR_OPTS, 'data-re="1"')) + F("Stripe", S(o, "stripe", w.stripe, STRIPE_OPTS)) + "</div>";
    h += F("Wire spec", I(o, "spec", w.spec, 'list="dlSpec" placeholder="e.g. UL1007"'));
    h += '<div class="r2">' + F("Length (" + u + ")", I(o, "len", w.len, 'inputmode="decimal"' + (c ? ' placeholder="cable: ' + esc(c.len || "—") + '"' : ""))) + F("Tolerance ±", I(o, "tol", w.tol, 'inputmode="decimal" placeholder="' + gTol() + '"')) + "</div>";
    const end = (e, label) => {
      const ce = w[e] && conn(w[e].c);
      return F(label, '<div class="r2">' + '<select data-o="' + o + '" data-k="' + e + '" data-fx="endc" data-set="0" data-end="' + e + '" data-re="1">' + optHtml(connOpts(), w[e] ? w[e].c : "") + "</select>" +
        (ce && pinOpts(ce).length > 1 ? '<select data-o="' + o + '" data-k="' + e + '.p" data-fx="endp" data-set="0" data-end="' + e + '" data-re="1">' + optHtml(pinOpts(ce), w[e].p) + "</select>" : "<span></span>") + "</div>");
    };
    h += sec("Ends", end("a", c ? "End A (from)" : "From") + end("b", c ? "End B (to)" : "To") + '<div class="btn-row">' + B("swap", "Swap ends", 'data-id="' + w.id + '"') + "</div>");
    h += F("Signal", I(o, "sig", w.sig, 'placeholder="' + esc(CD.sigOf(p, Object.assign({}, w, { sig: "" })) || "from pin names") + '"'));
    if (!c || c.kind === "bundle") h += '<div class="r3">' + F("Mfr", I(o, "mfr", w.mfr)) + F("Mfr part no.", I(o, "mpn", w.mpn)) + F("Part no.", I(o, "ipn", w.ipn)) + "</div>";
    h += F("Note", T(o, "note", w.note, 'rows="2"'));
    h += '<div class="btn-row">' + B("partSave", "Save wire to My parts…", 'data-id="' + w.id + '" data-kind="wire"') + "</div>";
    return h;
  }

  function tableForm(t) {
    const o = "tb:" + t.id, nC = t.cols.length;
    let h = F("Title", I(o, "title", t.title, 'placeholder="No title" data-re="1"'));
    h += sizeCtl(o, t);
    h += F("Sheet", S(o, "sheet", String(t.sheet), [["1", "Sheet 1, where you put it"], ["2", "Sheet 2 (continuation)"]], 'data-fx="tblSheet" data-set="0" data-re="1"'));
    const head = '<tr><th></th>' + t.cols.map((c, j) => "<th>" + I(o, "cols." + j + ".h", c.h, 'class="tg-h" placeholder="Column ' + (j + 1) + '"') +
      '<div class="tg-colbar">' + S(o, "cols." + j + ".align", c.align, [["left", "⇤"], ["center", "↔"], ["right", "⇥"]], 'title="Align"') +
      IB("tblColDel", "✕", "Remove column", 'data-id="' + t.id + '" data-i="' + j + '"' + (nC > 1 ? "" : " disabled")) + "</div></th>").join("") + "<th></th></tr>";
    const body = t.rows.map((r, i) => '<tr><td class="tg-n">' + (i + 1) + "</td>" + r.map((v, j) => "<td>" + I(o, "rows." + i + "." + j, v) + "</td>").join("") +
      '<td class="tg-act">' + IB("tblRowUp", "▲", "Move up", 'data-id="' + t.id + '" data-i="' + i + '"' + (i ? "" : " disabled")) + IB("tblRowDel", "✕", "Remove row", 'data-id="' + t.id + '" data-i="' + i + '"') + "</td></tr>").join("");
    h += sec("Cells", '<div class="tg-wrap"><table class="tg">' + head + body + "</table></div>",
      B("tblRowAdd", "＋ Row", 'data-id="' + t.id + '"') + B("tblColAdd", "＋ Column", 'data-id="' + t.id + '"') + B("tblPaste", "Paste…", 'data-id="' + t.id + '" title="From Excel or a CSV"'));
    return h;
  }
  function pasteTable(t) {
    openModal("Paste into " + (t.title || "table"), '<p>Copy cells in Excel (or CSV text) and paste them here.</p><textarea id="tblText" rows="10" style="width:100%;font-family:var(--mono)"></textarea>' +
      '<label class="chk"><input type="checkbox" id="tblHead" checked>First row is the column headings</label>', [
      { label: "Cancel", onClick: closeModal },
      { label: "Replace table", cls: "btn-primary", onClick: () => {
        const g = CD.parseGrid($("tblText").value);
        if (!g.length) { toast("Nothing to paste.", "warn"); return; }
        pushUndo();
        const n = Math.min(30, Math.max(...g.map(r => r.length)));
        const head = $("tblHead").checked ? g.shift() : null;
        t.cols = Array.from({ length: n }, (x, j) => ({ h: head ? head[j] || "" : "Column " + (j + 1), align: "left" }));
        t.rows = g.slice(0, 500).map(r => Array.from({ length: n }, (x, j) => r[j] || ""));
        closeModal(); changed(true);
      } }]);
  }

  // What the scale handle and size controls act on: a text / flag / balloon, a custom table, or a generated block.
  function scaleTarget(id) {
    const k = kindOf(id);
    if (k === "k") return callout(idOf(id));
    if (k === "tbl") return ctable(idOf(id));
    if (k === "blk" && ["wires", "bom", "notes"].includes(idOf(id))) return p.blk[idOf(id)];
    return null;
  }
  function sizeCtl(o, obj) {
    return '<div class="r2">' + F("Text size", S(o, "size", obj.size, [["s", "Small"], ["m", "Medium"], ["l", "Large"]], 'data-re="1"')) +
      F("Scale %", '<div class="fb-inline"><input type="number" min="30" max="600" step="5" data-o="' + o + '" data-k="k" data-fx="pct" data-set="0" data-lazy="1" data-re="1" value="' + Math.round((obj.k || 1) * 100) + '">' +
        B("scaleReset", "100", 'data-o="' + o + '" title="Back to 100 %"') + "</div>") + "</div>";
  }

  function calloutForm(k) {
    const o = "k:" + k.id;
    let h = F("Kind", S(o, "kind", k.kind, [["text", "Text note"], ["flag", "Flag note (triangle)"], ["balloon", "Balloon (find number)"]], 'data-re="1"'));
    h += sizeCtl(o, k);
    h += k.kind === "text" ? F("Text", T(o, "text", k.text, 'rows="4"')) : F(k.kind === "flag" ? "Note number" : "Item number", I(o, "text", k.text));
    h += '<div class="btn-row">' + B("leader", k.lx != null ? "Remove leader" : "Add leader arrow", 'data-id="' + k.id + '"') + "</div>";
    h += '<p class="hint">Drag the callout to move it. Drag the lime dot to aim the leader. Alt while dragging turns off the 5 pt snap.</p>';
    return h;
  }

  function blockForm(key) {
    let h = '<p class="hint">' + ({ wires: "Generated from all wires and cable conductors.", bom: "Generated from connectors, contacts, seals, accessories, cables, loose wires and cable markings. Items with the same part number add up.", notes: "Edit notes in the Drawing dialog." }[key] || "") + " Drag to move it on the sheet.</p>";
    if (p.blk[key]) h += sizeCtl("blk:" + key, p.blk[key]);
    h += C("meta", "showWires", p.meta.showWires, "Show wire list", 'data-re="1"') + C("meta", "showBom", p.meta.showBom, "Show bill of materials", 'data-re="1"');
    h += F("Tables on", S("meta", "tables", p.meta.tables, [["1", "Sheet 1, beside the drawing"], ["2", "Sheet 2 (continuation sheet)"]], 'data-re="1"'));
    h += '<div class="btn-row">' + B("resetPos", "Reset position", 'data-id="' + key + '"') + (key === "notes" ? B("drawing", "Edit notes…") : "") + "</div>";
    return h;
  }

  function drawingForm() {
    const m = p.meta;
    let h = '<div class="r2">' + F("Sheet size", S("meta", "size", m.size, Object.entries(CD.SHEETS).map(([k, v]) => [k, v.name]), 'data-fx="size" data-re="1"')) + F("Units", S("meta", "units", m.units, [["in", "Inches"], ["mm", "Millimetres"]], 'data-re="1"')) + "</div>";
    h += '<div class="r2">' + F("General tolerance ±", I("meta", "tol", m.tol, 'inputmode="decimal" placeholder="set a value"')) + F("Scale", I("meta", "scale", m.scale)) + "</div>";
    h += C("meta", "alt", m.alt, "Show other unit in [brackets]");
    h += sec("Title block logo", logoHtml());
    h += F("Workmanship", S("meta", "ws", m.ws, [["", "Not set"], ["1", "IPC/WHMA-A-620, Class 1"], ["2", "IPC/WHMA-A-620, Class 2"], ["3", "IPC/WHMA-A-620, Class 3"]]));
    h += sec("Tables", C("meta", "showWires", m.showWires, "Wire list") + C("meta", "showBom", m.showBom, "Bill of materials") +
      F("Tables on", S("meta", "tables", m.tables, [["1", "Sheet 1, beside the drawing"], ["2", "Sheet 2 (continuation sheet)"]], 'data-re="1"')));
    h += '<div class="btn-row">' + B("drawing", "Title block, notes, revisions…", "", "btn-primary") + "</div>";
    const nC = p.conns.length, nW = p.wires.length;
    h += sec("This drawing", '<div class="stat"><span>Connectors and nodes</span><b>' + nC + "</b><span>Cables and bundles</span><b>" + p.cables.length + "</b><span>Wires and conductors</span><b>" + nW + "</b><span>BOM items</span><b>" + CD.bom(p).rows.length + "</b><span>Notes</span><b>" + p.notes.length + "</b><span>Revisions</span><b>" + p.history.length + "</b></div>");
    h += '<p class="hint">Select a block on the sheet to edit it. Drag from a pin (small circle at a row end) to another pin or to a cable conductor to wire it.</p>';
    return h;
  }

  function logoHtml() {
    const L = images.logo;
    return '<p class="hint">' + (L ? "Loaded in this browser (" + L.w + " × " + L.h + " px). " : "None. The title block shows the company text, if any. ") +
      "The logo is not part of the site or the project file.</p>" +
      '<div class="btn-row">' + B("logoPick", L ? "Replace logo…" : "Load logo file…") + (L ? B("logoDel", "Remove", "", "btn-danger") : "") + "</div>";
  }
  async function loadLogo(file) {
    const url = URL.createObjectURL(file);
    try {
      const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("not an image")); i.src = url; });
      const k = Math.min(1, 1200 / im.naturalWidth, 400 / im.naturalHeight);
      const cv = document.createElement("canvas");
      cv.width = Math.max(1, Math.round(im.naturalWidth * k)); cv.height = Math.max(1, Math.round(im.naturalHeight * k));
      cv.getContext("2d").drawImage(im, 0, 0, cv.width, cv.height);
      images.logo = { data: cv.toDataURL("image/png"), w: cv.width, h: cv.height };
      try { await idb.set("logo", images.logo); } catch (e) { toast("Logo shown, but browser storage is unavailable: load it again next time.", "warn"); }
      render(); renderInspector(); if (modalRefresh) modalRefresh();
      toast("Logo loaded in this browser");
    } catch (e) { toast("Could not read " + file.name + " as an image.", "err"); }
    finally { URL.revokeObjectURL(url); }
  }
  $("logoFile").addEventListener("change", e => { const f = e.target.files[0]; e.target.value = ""; if (f) loadLogo(f); });

  // ---------- inspector / drawer / modal actions ----------
  const ACT = {
    dup: () => duplicate(),
    del: () => removeSel(),
    accAdd: d => { const c = conn(d.id); pushUndo(); c.acc.push({ desc: "", mfr: "", mpn: "", ipn: "", qty: "1" }); changed(true); },
    accDel: d => { const c = conn(d.id); pushUndo(); c.acc.splice(+d.i, 1); changed(true); },
    pinsPaste: d => pasteSignals(conn(d.id)),
    condAdd: d => { const c = cable(d.id); pushUndo(); const n = CD.conductors(p, c).length; p.wires.push(CD.newWire(p, { cable: c.id, gauge: ui.wire.gauge, gu: ui.wire.gu, color: CD.DIN47100[n % 10] })); changed(true); },
    drainAdd: d => { const c = cable(d.id); pushUndo(); p.wires.push(CD.newWire(p, { cable: c.id, color: "BARE", gauge: ui.wire.gauge, gu: ui.wire.gu })); if (c.shield.type === "none") { c.shield = { type: "foil", a: "pigtail", b: "float" }; } changed(true); },
    condDel: d => { const w = wire(d.id); pushUndo(); deleteWire(w); changed(true); },
    condUp: d => {
      const w = wire(d.id), c = cable(w.cable), list = CD.conductors(p, c), i = list.indexOf(w);
      if (i < 1) return;
      pushUndo();
      const prev = list[i - 1], ai = p.wires.indexOf(w), bi = p.wires.indexOf(prev);
      p.wires[ai] = prev; p.wires[bi] = w;
      changed(true);
    },
    wsel: d => { select("x:" + d.id); reveal("w:" + wire(d.id).cable); },
    twist: d => {
      const c = cable(d.id), ids = CD.conductors(p, c).filter(w => condSel.has(w.id)).map(w => w.id);
      if (ids.length < 2) { toast("Tick two or more conductors first.", "warn"); return; }
      pushUndo();
      c.groups.forEach(g => { g.wires = g.wires.filter(id => !ids.includes(id)); });
      c.groups = c.groups.filter(g => g.wires.length > 1);
      c.groups.push(CD.newGroup(ids));
      condSel.clear(); changed(true);
    },
    ungroup: d => { const c = cable(d.id); pushUndo(); c.groups = c.groups.filter(g => g.id !== d.i); changed(true); },
    connect: d => connectDialog(cable(d.id)),
    tblRowAdd: d => { const t = ctable(d.id); pushUndo(); t.rows.push(t.cols.map(() => "")); changed(true); },
    tblRowDel: d => { const t = ctable(d.id); pushUndo(); t.rows.splice(+d.i, 1); changed(true); },
    tblRowUp: d => { const t = ctable(d.id), i = +d.i; if (i < 1) return; pushUndo(); [t.rows[i - 1], t.rows[i]] = [t.rows[i], t.rows[i - 1]]; changed(true); },
    tblColAdd: d => { const t = ctable(d.id); if (t.cols.length >= 30) return; pushUndo(); t.cols.push({ h: "Column " + (t.cols.length + 1), align: "left" }); t.rows.forEach(r => r.push("")); changed(true); },
    tblColDel: d => { const t = ctable(d.id); if (t.cols.length < 2) return; pushUndo(); const j = +d.i; t.cols.splice(j, 1); t.rows.forEach(r => r.splice(j, 1)); changed(true); },
    tblPaste: d => pasteTable(ctable(d.id)),
    tieDel: d => { pushUndo(); p.ties = p.ties.filter(t => t.id !== d.id); changed(true); },
    bpinAdd: d => {
      const c = conn(d.id); pushUndo();
      const on = c.board.pins.filter(x => x.side === d.i), maxT = on.length ? Math.max(...on.map(x => x.t)) : 0;
      CD.addPins(c, [{ side: d.i, t: on.length ? Math.min(0.98, (maxT + 1) / 2) : 0.5 }]);
      changed(true);
    },
    bpinDel: d => { const c = conn(d.id); pushUndo(); CD.removePins(p, c, [+d.i]); changed(true); },
    scaleReset: d => { const o = resolve(d.o); if (!o || (o.k || 1) === 1) return; pushUndo(); o.k = 1; changed(true); },
    bimgPick: d => { imgTarget = d.id; $("boardImgFile").click(); },
    bimgDel: d => { const c = conn(d.id); pushUndo(); c.board.img = null; changed(true); },
    bimgFit: d => { const c = conn(d.id), f = CD.boardFit(c); if (!f) return; pushUndo(); c.board.w = f.w; c.board.h = f.h; changed(true); },
    bpinSpace: d => { const c = conn(d.id); pushUndo(); CD.spaceBoardPins(c); changed(true); },
    insertBoard: d => {
      const c = cable(d.id), L = sc.blocks.cable && sc.blocks.cable[c.id];
      if (!c) return;
      pushUndo();
      const r = CD.insertBoard(p, c), cw = L ? L.w : 220;
      r.board.x = snap(c.x + cw + 70); r.board.y = snap(c.y);
      r.cable.x = snap(r.board.x + r.board.board.w + 80); r.cable.y = snap(c.y);
      place("c:" + r.board.id, r.board, { x: r.board.x + r.board.board.w / 2, y: r.board.y + r.board.board.h / 2 });
      place("w:" + r.cable.id, r.cable, { x: r.board.x + r.board.board.w + 80 + cw / 2, y: r.board.y + 60 });
      sel = "c:" + r.board.id;
      changed(true);
      toast(r.cable.ref + " now runs from " + r.board.ref + " to end B. Set its length.");
    },
    markAdd: d => { const c = cable(d.id); pushUndo(); c.marks.push(CD.newMark()); changed(true); },
    markDel: d => { const c = cable(d.id); pushUndo(); c.marks = c.marks.filter(m => m.id !== d.i); changed(true); },
    swap: d => { const w = wire(d.id); pushUndo(); const t = w.a; w.a = w.b; w.b = t; changed(true); },
    leader: d => { const k = callout(d.id); pushUndo(); if (k.lx != null) { k.lx = null; k.ly = null; } else { k.lx = k.x - 40; k.ly = k.y + 40; } changed(true); },
    resetPos: d => { pushUndo(); p.pos[d.id] = null; changed(true); },
    drawing: () => drawingDialog(),
    faceEdit: d => faces.open(d.id),
    partSave: d => savePart(d.kind || "conn", d.kind === "cable" ? cable(d.id) : d.kind === "wire" ? wire(d.id) : conn(d.id)),
    partDel: d => deletePart(d.id),
    partsImport: () => $("partsFile").click(),
    partsExport: () => exportParts(),
    logoPick: () => $("logoFile").click(),
    logoDel: () => { images.logo = null; idb.del("logo").catch(() => {}); render(); renderInspector(); if (modalRefresh) modalRefresh(); toast("Logo removed from this browser"); },
    noteAdd: d => { pushUndo(); p.notes.push({ id: CD.uid(), text: d.text || "" }); changed(false); modalRefresh(); },
    noteDel: d => { pushUndo(); p.notes.splice(+d.i, 1); changed(false); modalRefresh(); },
    noteUp: d => { const i = +d.i; if (i < 1) return; pushUndo(); const t = p.notes[i]; p.notes[i] = p.notes[i - 1]; p.notes[i - 1] = t; changed(false); modalRefresh(); },
    revAdd: () => {
      pushUndo();
      const last = p.history.length ? p.history[p.history.length - 1].rev : "";
      const next = !last ? (p.meta.rev || "A") : /^[A-Y]$/.test(last) ? String.fromCharCode(last.charCodeAt(0) + 1) : "";
      p.history.push({ rev: next, eco: "", date: CD.today(), desc: "", by: p.meta.drawn || "" });
      if (next) p.meta.rev = next;
      paintDocId(); changed(false); modalRefresh();
    },
    revDel: d => { pushUndo(); p.history.splice(+d.i, 1); changed(false); modalRefresh(); },
    wireAdd: () => { pushUndo(); const w = CD.newWire(p, Object.assign({}, ui.wire)); p.wires.push(w); sel = "x:" + w.id; changed(true); renderDrawer(); },
    wdel: d => { pushUndo(); deleteWire(wire(d.id)); if (sel === "x:" + d.id) sel = null; changed(true); renderDrawer(); }
  };
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-a]");
    if (!b || b.disabled) return;
    const f = ACT[b.dataset.a];
    if (f) { e.preventDefault(); f(b.dataset); }
  });
  $("inspBody").addEventListener("change", e => {
    const cb = e.target.closest("[data-cs]");
    if (cb) { if (cb.checked) condSel.add(cb.dataset.cs); else condSel.delete(cb.dataset.cs); }
  });

  // ---------- board images (kept in the drawing as PNG / JPEG data, 1600 px long side at most) ----------
  let imgTarget = null;
  async function boardImage(c, blob) {
    if (!c || !c.board) return;
    const url = URL.createObjectURL(blob);
    try {
      const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("not an image")); i.src = url; });
      const k = Math.min(1, 1600 / Math.max(im.naturalWidth, im.naturalHeight));
      const cv = document.createElement("canvas");
      cv.width = Math.max(1, Math.round(im.naturalWidth * k)); cv.height = Math.max(1, Math.round(im.naturalHeight * k));
      const g = cv.getContext("2d");
      g.drawImage(im, 0, 0, cv.width, cv.height);
      // keep PNG when the picture has see-through parts, else JPEG (smaller files)
      let alpha = false;
      if (!/jpe?g/i.test(blob.type)) { const d = g.getImageData(0, 0, cv.width, cv.height).data; for (let i = 3; i < d.length; i += 4) if (d[i] < 250) { alpha = true; break; } }
      const data = alpha ? cv.toDataURL("image/png") : cv.toDataURL("image/jpeg", 0.86);
      pushUndo();
      c.board.img = { data, w: cv.width, h: cv.height };
      const f = CD.boardFit(c);   // grow to show it, never shrink the user's size
      if (f) { c.board.w = Math.max(c.board.w, Math.min(f.w, 600)); c.board.h = Math.max(c.board.h, Math.min(f.h, 600)); }
      changed(true);
      toast("Image added to " + c.ref);
    } catch (e) { toast("Could not read that image.", "err"); }
    finally { URL.revokeObjectURL(url); }
  }
  $("boardImgFile").addEventListener("change", e => { const f = e.target.files[0]; e.target.value = ""; if (f && imgTarget) boardImage(conn(imgTarget), f); });
  const selBoard = () => { const o = kindOf(sel) === "c" ? selObj() : null; return o && o.board ? o : null; };
  document.addEventListener("paste", e => {
    const t = e.target, b = selBoard();
    if (!b || /^(INPUT|TEXTAREA)$/.test(t.tagName) || $("overlay").classList.contains("open")) return;
    const f = [...(e.clipboardData ? e.clipboardData.files : [])].find(x => /^image\//.test(x.type));
    if (f) { e.preventDefault(); boardImage(b, f); }
  });

  function deleteWire(w) {
    if (!w) return;
    p.wires = p.wires.filter(x => x !== w);
    p.cables.forEach(c => { c.groups.forEach(g => { g.wires = g.wires.filter(id => id !== w.id); }); c.groups = c.groups.filter(g => g.wires.length > 1); });
  }
  function removeSel() {
    const k = kindOf(sel), id = idOf(sel);
    if (!k) return;
    if (k === "blk") { pushUndo(); if (id === "wires") p.meta.showWires = false; else if (id === "bom") p.meta.showBom = false; else { toast("Remove notes in the Drawing dialog.", "warn"); undo.pop(); return; } sel = null; changed(true); toast("Table hidden. Turn it on again under Drawing > Tables."); return; }
    pushUndo();
    if (k === "c") {
      p.conns = p.conns.filter(c => c.id !== id);
      CD.pruneTies(p);
      p.wires.forEach(w => ["a", "b"].forEach(e => { if (w[e] && w[e].c === id) w[e] = null; }));
    } else if (k === "w") {
      p.wires.filter(w => w.cable === id).forEach(deleteWire);
      p.cables = p.cables.filter(c => c.id !== id);
      CD.pruneTies(p);
    } else if (k === "x") deleteWire(wire(id));
    else if (k === "t") p.ties = p.ties.filter(t => t.id !== id);
    else if (k === "k") p.callouts = p.callouts.filter(c => c.id !== id);
    else if (k === "tbl") p.tables = p.tables.filter(t => t.id !== id);
    sel = null;
    changed(true);
  }
  function duplicate() {
    const k = kindOf(sel), o = selObj();
    if (!o || k === "x") return;
    pushUndo();
    const copy = JSON.parse(JSON.stringify(o));
    copy.id = CD.uid(); copy.x = o.x + 30; copy.y = o.y + 30;
    if (k === "c") {
      copy.ref = CD.newConn(p, o.lib, 0, 0).ref;
      p.conns.push(copy);
    } else if (k === "w") {
      copy.ref = CD.newCable(p).ref;
      const map = {};
      CD.conductors(p, o).forEach(w => { const n = Object.assign(JSON.parse(JSON.stringify(w)), { id: CD.uid(), cable: copy.id, a: null, b: null }); if (n.ref) n.ref = ""; map[w.id] = n.id; p.wires.push(n); });
      copy.groups = o.groups.map(g => CD.newGroup(g.wires.map(id => map[id]).filter(Boolean), { lay: g.lay, shield: g.shield }));
      copy.marks = o.marks.map(m => CD.newMark(Object.assign({}, m, { id: CD.uid() })));
      p.cables.push(copy);
    } else if (k === "k") p.callouts.push(copy);
    else if (k === "tbl") p.tables.push(copy);
    sel = k + ":" + copy.id;
    changed(true);
  }

  // ---------- add from library ----------
  // Put a new item in the nearest free space around the view centre.
  function place(gid, item, near) {
    const s0 = CD.scene(p, { sheet: 1 });
    const g = s0.groups.find(x => x.id === gid);
    if (!g || !g.box) return;
    const ox = g.box.x - item.x, oy = g.box.y - item.y, w = g.box.w, h = g.box.h, M = 16, fr = s0.frame;
    const others = s0.groups.filter(x => x.id !== gid && x.box && x.kind !== "wire").map(x => x.box).concat([s0.tb, s0.rev]);
    const inside = (x, y) => x >= fr.L + 8 && y >= fr.T + 8 && x + w <= fr.R - 8 && y + h <= fr.B - 8;
    const overlap = (x, y) => others.reduce((a, b) => a + Math.max(0, Math.min(x + w + M, b.x + b.w) - Math.max(x, b.x - M)) * Math.max(0, Math.min(y + h + M, b.y + b.h) - Math.max(y, b.y - M)), 0);
    const c = near || viewCenter(), x0 = c.x - w / 2, y0 = c.y - h / 2;
    let best = { x: snap(x0), y: snap(y0), a: Infinity };
    for (let r = 0; r < 60; r++) {
      for (let i = -r; i <= r; i++) {
        for (const [dx, dy] of [[i, -r], [i, r], [-r, i], [r, i]]) {
          const x = snap(x0 + dx * 20), y = snap(y0 + dy * 20);
          if (!inside(x, y)) continue;
          const a = overlap(x, y);
          if (!a) { item.x = x - ox; item.y = y - oy; return; }
          if (a < best.a) best = { x, y, a };
        }
      }
    }
    item.x = best.x - ox; item.y = best.y - oy;   // no free space: least overlap
  }
  // ---------- face builder ----------
  const faces = CD.faceBuilder({
    project: () => p, conn, openModal, toast, esc, pushUndo,
    closeModal: () => closeModal(),
    setModalClose: (f, sticky) => { modalClose = f; modalSticky = !!(f && sticky); },
    cancelEdit: () => { travel(undo, redo); redo.pop(); paintUndo(); },
    changed: insp => changed(insp)
  });

  // ---------- My parts (saved connectors, this browser + .cdparts files) ----------
  let parts = [];
  async function storeParts() { try { await idb.set("parts", parts); } catch (e) { toast("Browser storage unavailable: export your parts to a file.", "warn"); } renderParts(); }
  function renderParts() {
    const box = $("myParts");
    if (!box) return;
    const tip = x => x.type === "cable" ? [x.cable.mpn, x.conductors.length + " conductors", x.cable.shield !== "none" ? x.cable.shield + " shield" : ""].filter(Boolean).join(" · ") + ". Click to place."
      : x.type === "wire" ? "Click: apply to the selected wire, or use for new wires."
      : [x.mpn, CD.LIB[x.lib] ? CD.LIB[x.lib].name : "", x.pins.length + " pins"].filter(Boolean).join(" · ");
    const row = x => '<div class="lib-row"><button class="lib-item" data-part="' + esc(x.id) + '" title="' + esc(tip(x)) + '"><span>' + esc(x.name) + '</span><span class="plus">' + (x.type === "wire" ? "↳" : "＋") + "</span></button>" +
      '<button class="icon-btn" data-a="partDel" data-id="' + esc(x.id) + '" title="Delete from My parts" aria-label="Delete ' + esc(x.name) + '">✕</button></div>';
    const group = (t, label) => { const l = parts.filter(x => (x.type || "conn") === t).sort((a, b) => a.name.localeCompare(b.name)); return l.length ? '<div class="lib-sub">' + label + "</div>" + l.map(row).join("") : ""; };
    box.innerHTML = '<details' + (parts.length ? " open" : "") + '><summary>My parts<span>' + parts.length + "</span></summary>" +
      group("conn", "Connectors") + group("cable", "Cables") + group("wire", "Wires") +
      (parts.length ? "" : '<p class="empty-note">Save a connector, cable or wire from its properties.</p>') +
      '<div class="btn-row" style="padding:4px 8px 8px 24px">' + B("partsImport", "Import…") + (parts.length ? B("partsExport", "Export") : "") + "</div></details>";
  }
  function savePart(kind, c) {
    if (!c) return;
    const def = kind === "cable" ? c.desc || c.mpn || c.ref : kind === "wire" ? CD.partFromWire(c).name : c.desc || c.mpn || CD.libOf(c).name;
    const what = {
      conn: "Type, face, pin numbers, part numbers, contact, seal and accessories. Signals stay with this drawing.",
      cable: "The cable itself: description, part numbers, jacket, OD, shield type and every conductor with its twisted pairs. Lengths, labels, sleeving and ends stay with this drawing.",
      wire: "Size, colour, stripe, insulation, spec and part numbers."
    }[kind];
    openModal("Save to My parts", F("Name", '<input id="partName" value="' + esc(def) + '">') + "<p>" + what + "</p>", [
      { label: "Cancel", onClick: closeModal },
      { label: "Save", cls: "btn-primary", onClick: () => {
        const name = $("partName").value.trim() || def;
        const old = parts.find(x => x.name === name && (x.type || "conn") === kind);
        const part = kind === "cable" ? CD.partFromCable(p, c, name) : kind === "wire" ? CD.partFromWire(c, name) : CD.partFromConn(c, name);
        if (old) { part.id = old.id; parts[parts.indexOf(old)] = part; } else parts.push(part);
        closeModal(); storeParts(); toast((old ? "Updated " : "Saved ") + name + " in My parts");
      } }]);
  }
  async function deletePart(id) {
    const x = parts.find(q => q.id === id);
    if (!x || !await confirmBox("Delete part", "<p>Delete <b>" + esc(x.name) + "</b> from My parts? Drawings that use it keep their copy.</p>", "Delete", true)) return;
    parts = parts.filter(q => q !== x); storeParts();
  }
  function addPart(id) {
    const x = parts.find(q => q.id === id);
    if (!x) return;
    if (x.type === "wire") {
      const w = kindOf(sel) === "x" && wire(idOf(sel));
      if (w) { pushUndo(); CD.applyWirePart(w, x); changed(true); toast(x.name + " applied to " + CD.wireRef(p, w)); }
      else { Object.assign(ui.wire, CD.wireProfile(x.wire)); saveUi(); toast("New wires will use " + x.name + "."); }
      return;
    }
    sheet = 1;
    pushUndo();
    if (x.type === "cable") {
      const cb = CD.cableFromPart(p, x, 0, 0);
      place("w:" + cb.id, cb);
      sel = "w:" + cb.id;
      changed(true);
      return;
    }
    const c = CD.connFromPart(p, x, 0, 0);
    p.conns.push(c);
    place("c:" + c.id, c);
    sel = "c:" + c.id;
    changed(true);
  }
  function exportParts() {
    busy("Export", () => saveFile("my-parts.cdparts", async () => new Blob([JSON.stringify({ format: "atlas-cable-parts", v: 1, parts }, null, 1)], { type: "application/json" }), "Cable Designer parts", "application/json", ".cdparts"));
  }
  async function importParts(file) {
    let d;
    try { d = JSON.parse(await file.text()); } catch (e) { toast("Not a parts file: " + file.name, "err"); return; }
    const list = (d && d.format === "atlas-cable-parts" && Array.isArray(d.parts) ? d.parts : []).map(CD.normPart).filter(Boolean);
    if (!list.length) { toast("No parts found in " + file.name, "warn"); return; }
    let added = 0, updated = 0;
    list.forEach(x => { const i = parts.findIndex(q => q.id === x.id || (q.name === x.name && (q.type || "conn") === x.type)); if (i >= 0) { parts[i] = x; updated++; } else { parts.push(x); added++; } });
    storeParts();
    toast("My parts: " + added + " added, " + updated + " updated");
  }
  $("partsFile").addEventListener("change", e => { const f = e.target.files[0]; e.target.value = ""; if (f) importParts(f); });

  function addConn(key) {
    if (sheet !== 1) { sheet = 1; }
    pushUndo();
    const c = CD.newConn(p, key, 0, 0);
    p.conns.push(c);
    place("c:" + c.id, c);
    sel = "c:" + c.id;
    changed(true);
    if (key === "custom") faces.open(c.id);
  }
  async function addCable(kind) {
    let n = 0;
    if (kind === "multi" || kind === "pairs") {
      n = await askNumber(kind === "multi" ? "Conductors" : "Pairs", kind === "multi" ? 4 : 2, kind === "multi" ? 60 : 30);
      if (!n) return;
    }
    sheet = 1;
    pushUndo();
    const c = CD.cablePreset(p, kind, 0, 0, n);
    CD.conductors(p, c).forEach(w => { if (!CD.isDrain(w)) { w.gauge = ui.wire.gauge; w.gu = ui.wire.gu; } else { w.gu = ui.wire.gu; } w.insul = ui.wire.insul || w.insul; });
    place("w:" + c.id, c);
    sel = "w:" + c.id;
    changed(true);
  }
  function addTable() {
    sheet = 1;
    pushUndo();
    const t = CD.newTable(0, 0);
    p.tables.push(t);
    place("tbl:" + t.id, t);
    sel = "tbl:" + t.id;
    changed(true);
  }
  function addCallout(kind) {
    sheet = 1;
    pushUndo();
    const k = CD.newCallout(0, 0, { kind, text: kind === "text" ? "Note" : kind === "flag" ? String(Math.max(1, p.notes.length)) : "1" });
    p.callouts.push(k);
    place("k:" + k.id, k);
    sel = "k:" + k.id;
    changed(true);
  }
  function buildLib() {
    const groups = [];
    CD.LIB_LIST.forEach(l => { let g = groups.find(x => x.name === l.group); if (!g) groups.push(g = { name: l.group, items: [] }); g.items.push(l); });
    const item = (attr, label, title) => '<button class="lib-item" ' + attr + (title ? ' title="' + esc(title) + '"' : "") + "><span>" + esc(label) + '</span><span class="plus">＋</span></button>';
    let h = '<div id="myParts"></div><details open><summary>Cables<span>6</span></summary>' +
      item('data-cab="single"', "Single conductor cable") + item('data-cab="multi"', "Multi-conductor cable…", "DIN 47100 colours") +
      item('data-cab="stp"', "Shielded twisted pair", "Foil shield, drain wire") + item('data-cab="pairs"', "Multi-pair shielded…", "Twisted pairs, overall foil, drain") +
      item('data-cab="eth"', "4 pair data (T568B)", "Pairs twisted; Connect ends lands each on its T568B pin") + item('data-cab="bundle"', "Twisted pair, no jacket") + "</details>";
    groups.forEach((g, i) => { h += "<details" + (i === 0 ? " open" : "") + "><summary>" + esc(g.name) + "<span>" + g.items.length + "</span></summary>" + g.items.map(l => item('data-lib="' + l.key + '"', l.name)).join("") + "</details>"; });
    h += '<details><summary>Annotations<span>4</span></summary>' + item('data-call="text"', "Text note") + item('data-call="flag"', "Flag note △") + item('data-call="balloon"', "Balloon ◯") + item('data-call="table"', "Table ▦") + "</details>";
    $("lib").insertAdjacentHTML("beforeend", h);
    $("lib").addEventListener("click", e => {
      const b = e.target.closest(".lib-item");
      if (!b) return;
      if (b.dataset.part) addPart(b.dataset.part);
      else if (b.dataset.lib) addConn(b.dataset.lib);
      else if (b.dataset.cab) addCable(b.dataset.cab);
      else if (b.dataset.call === "table") addTable();
      else if (b.dataset.call) addCallout(b.dataset.call);
    });
  }

  // ---------- outline ----------
  function renderOutline() {
    const li = (id, ref, txt) => '<li data-sel="' + id + '"' + (id === sel ? ' class="on"' : "") + "><b>" + esc(ref) + "</b><span>" + esc(txt) + "</span></li>";
    let h = "";
    if (p.conns.length) h += '<li class="sub">Connectors</li>' + p.conns.map(c => li("c:" + c.id, c.ref, c.desc || CD.libOf(c).name)).join("");
    if (p.cables.length) h += '<li class="sub">Cables</li>' + p.cables.map(c => li("w:" + c.id, c.ref, c.desc || (c.kind === "bundle" ? "Bundle" : "Cable"))).join("");
    const loose = p.wires.filter(w => !w.cable);
    if (loose.length) h += '<li class="sub">Loose wires</li>' + loose.map(w => li("x:" + w.id, CD.wireRef(p, w), [CD.endText(p, w.a) || "—", CD.endText(p, w.b) || "—"].join(" → "))).join("");
    if ((p.tables || []).length) h += '<li class="sub">Tables</li>' + p.tables.map(t => li("tbl:" + t.id, "▦", (t.title || "Table") + (t.sheet === 2 ? " (sheet 2)" : ""))).join("");
    if (p.callouts.length) h += '<li class="sub">Callouts</li>' + p.callouts.map(k => li("k:" + k.id, k.kind === "text" ? "Note" : k.kind === "flag" ? "△ " + k.text : "◯ " + k.text, k.kind === "text" ? k.text : "")).join("");
    $("outline").innerHTML = h || '<li class="empty-note">Nothing on the sheet yet.</li>';
    $("outlineCount").textContent = (p.conns.length + p.cables.length) ? String(p.conns.length + p.cables.length + loose.length + p.callouts.length) : "";
  }
  $("outline").addEventListener("click", e => {
    const li = e.target.closest("[data-sel]");
    if (!li) return;
    const tt = kindOf(li.dataset.sel) === "tbl" && ctable(idOf(li.dataset.sel)), want = tt && tt.sheet === 2 ? 2 : 1;
    if (sheet !== want) { sheet = want; render(); paintSheets(); }
    select(li.dataset.sel); reveal(li.dataset.sel);
  });

  // ---------- wire drawer ----------
  function renderDrawer() {
    const rows = [];
    p.cables.forEach(c => CD.conductors(p, c).forEach(w => rows.push(w)));
    p.wires.filter(w => !w.cable).forEach(w => rows.push(w));
    $("drawerCount").textContent = plural(rows.length, "wire");
    const end = (w, e) => {
      const o = "x:" + w.id, ce = w[e] && conn(w[e].c);
      return '<td><select class="w-conn" data-o="' + o + '" data-k="' + e + '" data-fx="endc" data-set="0" data-end="' + e + '" data-re="1">' + optHtml(connOpts(), w[e] ? w[e].c : "") + "</select> " +
        (ce && ce.pins.length > 1 ? '<select class="w-pin" data-o="' + o + '" data-k="' + e + '.p" data-fx="endp" data-set="0" data-end="' + e + '" data-re="1">' + optHtml(pinOpts(ce), w[e].p) + "</select>" : "") + "</td>";
    };
    const cabOpts = [["", "Loose"]].concat(p.cables.map(x => [x.id, x.ref]));
    $("drawerBody").innerHTML = '<table class="grid"><thead><tr><th>Wire</th><th>Cable</th><th>From</th><th>To</th><th>Size</th><th>Colour</th><th>Stripe</th><th>Length</th><th>Signal</th><th></th></tr></thead><tbody>' +
      rows.map(w => {
        const o = "x:" + w.id;
        return '<tr data-w="' + w.id + '"' + (sel === o ? ' class="on"' : "") + "><td>" + I(o, "ref", w.ref, 'class="w-ref" placeholder="' + esc(CD.wireRef(p, w)) + '"') + "</td><td>" +
          S(o, "cable", w.cable || "", cabOpts, 'data-fx="cable" data-set="0" data-re="1"') + "</td>" + end(w, "a") + end(w, "b") +
          "<td>" + I(o, "gauge", w.gauge, 'class="w-sz" list="dlAwg"') + "</td><td>" + S(o, "color", w.color, COLOR_OPTS, 'class="w-col"') + "</td><td>" + S(o, "stripe", w.stripe, STRIPE_OPTS, 'class="w-col"') +
          "</td><td>" + I(o, "len", w.len, 'class="w-len" inputmode="decimal" placeholder="' + esc(w.cable ? (cable(w.cable) || {}).len || "" : "") + '"') + "</td><td>" + I(o, "sig", w.sig, 'class="w-sig" placeholder="' + esc(CD.sigOf(p, Object.assign({}, w, { sig: "" }))) + '"') +
          "</td><td>" + IB("wdel", "✕", "Delete wire", 'data-id="' + w.id + '"') + "</td></tr>";
      }).join("") + "</tbody></table>" + (rows.length ? "" : '<p class="empty-note" style="padding:14px">No wires yet. Drag from pin to pin on the sheet, or press ＋ Loose wire.</p>');
  }
  function markDrawerSel() { $("drawerBody").querySelectorAll("tr[data-w]").forEach(tr => tr.classList.toggle("on", sel === "x:" + tr.dataset.w)); }
  $("drawerBody").addEventListener("focusin", e => { const tr = e.target.closest("tr[data-w]"); if (tr && sel !== "x:" + tr.dataset.w) { sel = "x:" + tr.dataset.w; drawOverlay(); renderInspector(); renderOutline(); markDrawerSel(); } });
  function toggleDrawer(on) {
    ui.drawer = on == null ? !ui.drawer : on; saveUi();
    $("drawer").hidden = !ui.drawer;
    $("drawerBtn").setAttribute("aria-pressed", String(ui.drawer));
    if (ui.drawer) renderDrawer();
  }
  $("drawerBtn").addEventListener("click", () => toggleDrawer());
  $("drawerX").addEventListener("click", () => toggleDrawer(false));
  $("addWireBtn").addEventListener("click", () => ACT.wireAdd());

  // ---------- modal / toast ----------
  let modalClose = null, modalRefresh = null, modalSticky = false;
  function openModal(title, bodyHtml, buttons, wide) {
    $("modalTitle").textContent = title;
    $("modalBody").innerHTML = bodyHtml;
    const foot = $("modalFoot"); foot.textContent = "";
    buttons.forEach(b => {
      const el = document.createElement("button");
      el.className = "btn " + (b.cls || ""); el.textContent = b.label;
      el.addEventListener("click", b.onClick);
      foot.appendChild(el);
    });
    $("modal").classList.toggle("wide", wide === true);
    $("modal").classList.toggle("xwide", wide === "xwide");
    $("overlay").classList.add("open");
    const first = $("modalBody").querySelector("input,textarea,select") || foot.querySelector(".btn-primary");
    if (first) setTimeout(() => first.focus(), 30);
  }
  function closeModal() {
    modalRefresh = null;
    if (modalClose) { const f = modalClose; modalClose = null; f(); return; }
    $("overlay").classList.remove("open");
    renderInspector();
  }
  function confirmBox(title, html, okLabel, danger) {
    return new Promise(res => {
      let done = false;
      const finish = v => { if (done) return; done = true; modalClose = null; $("overlay").classList.remove("open"); res(v); };
      openModal(title, html, [{ label: "Cancel", onClick: () => finish(false) }, { label: okLabel || "OK", cls: danger ? "btn-danger" : "btn-primary", onClick: () => finish(true) }]);
      modalClose = () => finish(false);
    });
  }
  function askNumber(label, def, max) {
    return new Promise(res => {
      let done = false;
      const finish = v => { if (done) return; done = true; modalClose = null; $("overlay").classList.remove("open"); res(v); };
      openModal("New cable", F(label, '<input type="number" id="askN" min="1" max="' + max + '" value="' + def + '">'), [
        { label: "Cancel", onClick: () => finish(0) },
        { label: "Add", cls: "btn-primary", onClick: () => finish(Math.max(1, Math.min(max, parseInt($("askN").value, 10) || def))) }]);
      $("askN").addEventListener("keydown", e => { if (e.key === "Enter") finish(Math.max(1, Math.min(max, parseInt($("askN").value, 10) || def))); });
      modalClose = () => finish(0);
    });
  }
  $("modalX").addEventListener("click", closeModal);
  $("overlay").addEventListener("mousedown", e => { if (e.target === $("overlay") && !modalSticky) closeModal(); });
  function toast(msg, kind) {
    const t = document.createElement("div");
    t.className = "toast" + (kind ? " " + kind : ""); t.textContent = msg;
    $("toasts").appendChild(t);
    setTimeout(() => t.remove(), kind === "err" ? 7000 : 3800);
  }

  // ---------- dialogs ----------
  const COMMON_NOTES = [
    "Mark each wire with its wire ID at both ends.",
    "Mark each connector end with its reference on a heat-shrink label.",
    "Test 100 % continuity. No opens, no shorts, no miswires.",
    "Strip, crimp and inspect per the contact maker's instructions.",
    "Twisted pairs: keep the twist to within 1.00 of the contact.",
    "Dimensions are to the end of the connector or terminal.",
    "Do not exceed the minimum bend radius of the cable."
  ];
  function drawingDialog() {
    const body = () => {
      const m = p.meta;
      let h = "<h4>Title block</h4>";
      h += '<div class="r4">' + F("Drawing no.", I("meta", "dwgNo", m.dwgNo)) + F("Revision", I("meta", "rev", m.rev)) + F("Sheet size", S("meta", "size", m.size, Object.entries(CD.SHEETS).map(([k, v]) => [k, k]), 'data-fx="size"')) + F("Scale", I("meta", "scale", m.scale)) + "</div>";
      h += F("Title", I("meta", "title", m.title));
      h += '<div class="r4">' + F("Drawn", I("meta", "drawn", m.drawn)) + F("Date", I("meta", "drawnDate", m.drawnDate, 'type="date"')) + F("Checked", I("meta", "checked", m.checked)) + F("Date", I("meta", "checkedDate", m.checkedDate, 'type="date"')) + "</div>";
      h += '<div class="r4">' + F("Approved", I("meta", "approved", m.approved)) + F("Date", I("meta", "approvedDate", m.approvedDate, 'type="date"')) + F("Units", S("meta", "units", m.units, [["in", "Inches"], ["mm", "Millimetres"]])) + F("General tol ±", I("meta", "tol", m.tol, 'inputmode="decimal"')) + "</div>";
      h += '<div class="r4">' + F("Workmanship", S("meta", "ws", m.ws, [["", "Not set"], ["1", "A-620 Class 1"], ["2", "A-620 Class 2"], ["3", "A-620 Class 3"]])) + "</div>";
      h += '<div class="r2">' + F("Company (shown when no logo is loaded)", I("meta", "company", m.company)) + '<div class="field"><span class="lbl">Logo</span>' + logoHtml() + "</div></div>";
      h += F("Notice (above the title block)", T("meta", "notice", m.notice, 'rows="2" placeholder="Your proprietary / legal text, if any"'));
      h += "<h4>Notes</h4>" + p.notes.map((n, i) => '<div class="note-row"><span>' + (i + 1) + ".</span>" + T("n:" + i, "text", n.text, 'rows="1"') + '<div style="display:flex">' + IB("noteUp", "▲", "Move up", 'data-i="' + i + '"' + (i ? "" : " disabled")) + IB("noteDel", "✕", "Delete note", 'data-i="' + i + '"') + "</div></div>").join("");
      h += '<div class="btn-row">' + B("noteAdd", "＋ Note") + '<select id="commonNote" style="max-width:420px"><option value="">Add a common note…</option>' + COMMON_NOTES.map(t => '<option>' + esc(t) + "</option>").join("") + "</select></div>";
      h += '<h4>Revision history</h4><table class="hist-tbl"><thead><tr><th style="width:60px">Rev</th><th style="width:90px">ECO</th><th style="width:140px">Date</th><th>Description</th><th style="width:110px">By</th><th style="width:30px"></th></tr></thead><tbody>' +
        p.history.map((r, i) => "<tr><td>" + I("h:" + i, "rev", r.rev) + "</td><td>" + I("h:" + i, "eco", r.eco) + "</td><td>" + I("h:" + i, "date", r.date, 'type="date"') + "</td><td>" + I("h:" + i, "desc", r.desc) + "</td><td>" + I("h:" + i, "by", r.by) + "</td><td>" + IB("revDel", "✕", "Delete row", 'data-i="' + i + '"') + "</td></tr>").join("") +
        "</tbody></table>" + '<div class="btn-row">' + B("revAdd", "＋ Revision") + "</div>";
      return h;
    };
    openModal("Drawing: title block, notes, revisions", body(), [{ label: "Done", cls: "btn-primary", onClick: closeModal }], true);
    modalRefresh = () => { const mb = $("modalBody"), st = $("modal").scrollTop; mb.innerHTML = body(); $("modal").scrollTop = st; };
  }
  $("modal").addEventListener("change", e => { if (e.target.id === "commonNote" && e.target.value) ACT.noteAdd({ text: e.target.value }); });
  function pasteSignals(c) {
    if (!c) return;
    openModal("Signals for " + c.ref, '<p>One signal per line, in pin order (line 1 = position 1). Optional: "pin number, TAB, signal" also works.</p><textarea id="sigText" rows="12" style="width:100%;font-family:var(--mono)">' + esc(c.pins.map(x => x.sig).join("\n")) + "</textarea>", [
      { label: "Cancel", onClick: closeModal },
      { label: "Apply", cls: "btn-primary", onClick: () => {
        pushUndo();
        const lines = $("sigText").value.split(/\r?\n/);
        lines.forEach((l, i) => {
          const m = l.split("\t");
          if (m.length > 1) { const k = c.pins.findIndex(x => x.n === m[0].trim()); if (k >= 0) c.pins[k].sig = m.slice(1).join(" ").trim(); }
          else if (c.pins[i]) c.pins[i].sig = l.trim();
        });
        closeModal(); changed(true);
      } }]);
  }
  function connectDialog(c) {
    if (!c) return;
    const opts = connOpts();
    const guess = e => { const ids = {}; p.wires.forEach(w => { if (w.cable === c.id && w[e]) ids[w[e].c] = 1; }); return Object.keys(ids)[0] || ""; };
    openModal("Connect " + c.ref + " ends", '<p>Lands each conductor on the same position at both ends: conductor 1 on pin 1, and so on. The 4 pair data preset uses T568B pins. Drain conductors stay as they are. Existing ends are replaced.</p>' +
      '<div class="r2">' + F("End A connector", '<select id="cnA">' + optHtml(opts, guess("a")) + "</select>") + F("End B connector", '<select id="cnB">' + optHtml(opts, guess("b")) + "</select>") + "</div>", [
      { label: "Cancel", onClick: closeModal },
      { label: "Connect", cls: "btn-primary", onClick: () => { pushUndo(); CD.connectCable(p, c, $("cnA").value, $("cnB").value); closeModal(); changed(true); } }]);
  }
  function checksDialog() {
    const list = CD.checks(p);
    openModal("Design checks", list.length ? '<ul class="checks">' + list.map(c => '<li class="' + c.lvl + '"><b>' + (c.lvl === "err" ? "Error" : "Check") + "</b><span>" + esc(c.msg) + "</span></li>").join("") + "</ul>" : "<p>No problems found.</p>",
      [{ label: "OK", cls: "btn-primary", onClick: closeModal }]);
  }
  function keysDialog() {
    const k = (keys, what) => "<span>" + keys.map(x => "<kbd>" + x + "</kbd>").join("+") + "</span><span>" + what + "</span>";
    openModal("Keyboard and mouse", '<div class="keys-tbl">' + [
      k(["Drag pin"], "To a pin: new loose wire"), k(["Drag pin"], "To a conductor end: land it"),
      k(["Drag block"], "Move (5 pt snap)"), k(["Alt"], "Move without snap"),
      k(["Drag paper"], "Pan"), k(["Wheel"], "Zoom"),
      k(["Del"], "Delete selected"), k(["Ctrl", "D"], "Duplicate"),
      k(["←", "→"], "Nudge (Shift: 20 pt)"), k(["Esc"], "Clear selection"),
      k(["Ctrl", "Z"], "Undo"), k(["Ctrl", "Y"], "Redo"),
      k(["0"], "Fit sheet"), k(["+", "−"], "Zoom"),
      k(["P"], "Show pin ports"), k(["W"], "Wire list"),
      k(["Ctrl", "S"], "Save project"), k(["Ctrl", "O"], "Open project"),
      k(["Ctrl", "P"], "Export PDF"), k(["Space"], "Hold and drag to pan")
    ].join("") + "</div>", [{ label: "OK", cls: "btn-primary", onClick: closeModal }], true);
  }

  // ---------- top bar, stats, checks, sheets ----------
  function paintDocId() {
    const m = p.meta;
    [["dwgNo", m.dwgNo], ["dwgTitle", m.title], ["dwgRev", m.rev]].forEach(([id, v]) => { if (document.activeElement !== $(id)) $(id).value = v || ""; });
    document.title = (m.dwgNo || m.title ? [m.dwgNo, m.title].filter(Boolean).join(" ") + " · " : "") + "Cable Designer";
  }
  [["dwgNo", "dwgNo"], ["dwgTitle", "title"], ["dwgRev", "rev"]].forEach(([id, k]) => $(id).addEventListener("input", e => {
    editPush("meta|" + k); p.meta[k] = e.target.value; paintDocId(); render(); scheduleSave();
    if (!sel) renderInspector();
  }));
  function paintStats() {
    $("stats").textContent = [plural(p.conns.length, "connector"), plural(p.cables.length, "cable"), plural(p.wires.length, "wire"), "Sheet " + p.meta.size + (CD.sheetsOf(p) > 1 ? " ×2" : "")].join(" · ");
  }
  function paintChecks() {
    const list = CD.checks(p), b = $("checksBadge");
    const err = list.some(c => c.lvl === "err");
    b.textContent = list.length ? String(list.length) : "✓";
    b.className = "badge " + (err ? "err" : list.length ? "warn" : "ok");
  }
  function paintSheets() {
    const n = CD.sheetsOf(p), seg = $("sheetSeg");
    seg.hidden = n < 2;
    if (n > 1) seg.innerHTML = [1, 2].map(i => '<button data-sheet="' + i + '" aria-pressed="' + (sheet === i) + '">Sheet ' + i + "</button>").join("");
    const ss = $("sizeSel");
    if (!ss.options.length) ss.innerHTML = optHtml(Object.entries(CD.SHEETS).map(([k, v]) => [k, v.name]), p.meta.size);
    ss.value = p.meta.size;
  }
  $("sheetSeg").addEventListener("click", e => { const b = e.target.closest("[data-sheet]"); if (!b) return; sheet = +b.dataset.sheet; if (sheet !== 1) sel = null; render(); paintSheets(); renderInspector(); });
  $("sizeSel").addEventListener("change", e => { pushUndo(); p.meta.size = e.target.value; changed(true); fit(); });
  $("checksBtn").addEventListener("click", checksDialog);
  $("drawingBtn").addEventListener("click", drawingDialog);
  $("undoBtn").addEventListener("click", () => travel(undo, redo));
  $("redoBtn").addEventListener("click", () => travel(redo, undo));
  $("dupBtn").addEventListener("click", duplicate);
  $("delBtn").addEventListener("click", removeSel);
  $("zoomIn").addEventListener("click", () => zoomAt(1.25));
  $("zoomOut").addEventListener("click", () => zoomAt(0.8));
  $("zoomLbl").addEventListener("click", fit);
  function setPorts(on) { ui.ports = on; saveUi(); svg.classList.toggle("show-ports", on); $("portsBtn").setAttribute("aria-pressed", String(on)); }
  $("portsBtn").addEventListener("click", () => setPorts(!ui.ports));
  $("emptyExample").addEventListener("click", () => loadExample());
  $("emptyOpen").addEventListener("click", () => $("projFile").click());

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
  menu("projBtn", "projMenu", a => ({ save: saveProject, open: () => $("projFile").click(), new: newDrawing, example: loadExample, keys: keysDialog })[a]());
  menu("expBtn", "expMenu", a => ({ pdf: exportPdf, svg: exportSvg, png: exportPng, wcsv: exportWireCsv, bcsv: exportBomCsv })[a]());

  // ---------- files ----------
  function baseName() {
    const m = p.meta;
    const s = [m.dwgNo, m.rev ? "Rev" + m.rev : "", m.title].filter(x => String(x || "").trim()).join("_");
    return (s.replace(/[\\/:*?"<>|#%,;]+/g, "-").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 90)) || "cable-drawing";
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
    if (handle) { const w = await handle.createWritable(); await w.write(blob); await w.close(); toast("Saved " + handle.name); }
    else { download(name, blob); toast("Downloaded " + name); }
    return true;
  }
  const busy = async (label, fn) => {
    setSaveStat(label + "…");
    try { return await fn(); }
    catch (e) { console.error(e); toast(label + " failed: " + (e && e.message || e), "err"); }
    finally { setSaveStat(storageOk ? "Saved in this browser" : "Browser storage unavailable — save a project file", !storageOk); }
  };
  const needContent = () => { if (!hasContent()) { toast("Nothing to export yet.", "warn"); return false; } return true; };
  function exportPdf() { if (needContent()) busy("PDF export", () => saveFile(baseName() + ".pdf", async () => OUT.pdf(p, images), "PDF drawing", "application/pdf", ".pdf")); }
  function exportSvg() { if (needContent()) busy("SVG export", () => saveFile(baseName() + (sheet > 1 ? "_sheet" + sheet : "") + ".cable.svg", async () => new Blob([OUT.svgDoc(CD.scene(p, { sheet, images }), images)], { type: "image/svg+xml" }), "SVG drawing", "image/svg+xml", ".svg")); }
  function exportPng() { if (needContent()) busy("PNG export", () => saveFile(baseName() + (sheet > 1 ? "_sheet" + sheet : "") + ".cable.png", () => OUT.png(CD.scene(p, { sheet, images }), images, 200), "PNG image", "image/png", ".png")); }
  function exportWireCsv() { if (needContent()) busy("CSV export", () => saveFile(baseName() + "_wire-list.csv", async () => new Blob([CD.wireCsv(p)], { type: "text/csv" }), "CSV", "text/csv", ".csv")); }
  function exportBomCsv() { if (needContent()) busy("CSV export", () => saveFile(baseName() + "_bom.csv", async () => new Blob([CD.bomCsv(p)], { type: "text/csv" }), "CSV", "text/csv", ".csv")); }
  function saveProject() {
    busy("Save", () => saveFile(baseName() + ".cblproj", async () => new Blob([JSON.stringify(Object.assign({ app: "Cable Designer", saved: new Date().toISOString() }, p), null, 1)], { type: "application/json" }), "Cable Designer project", "application/json", ".cblproj"));
  }
  async function openProject(file) {
    let d;
    try { d = JSON.parse(await file.text()); } catch (e) { toast("Not a project file: " + file.name, "err"); return; }
    if (!d || d.format !== CD.FORMAT) { toast("Not a Cable Designer project: " + file.name, "err"); return; }
    if (hasContent() && !await confirmBox("Open project", "<p>Replace the drawing in this browser with <b>" + esc(file.name) + "</b>?</p><p>Save a project file first if you need the current one.</p>", "Open")) return;
    replaceProject(CD.normalize(d));
    toast("Opened " + file.name);
  }
  function replaceProject(np) {
    pushUndo();
    p = np; sel = null; sheet = 1;
    refreshAll(); fit(); saveNow();
  }
  async function newDrawing() {
    if (hasContent() && !await confirmBox("New drawing", "<p>Clear the drawing in this browser and start again?</p><p>Save a project file first if you need this one. Undo can bring it back while this page is open.</p>", "Clear and start", true)) return;
    replaceProject(CD.blankProject());
    toast("New drawing");
  }
  async function loadExample() {
    if (hasContent() && !await confirmBox("Load example", "<p>Replace the drawing in this browser with the example?</p>", "Load example")) return;
    replaceProject(CD.example());
    toast("Example loaded. Part numbers are fake.");
  }
  $("projFile").addEventListener("change", e => { const f = e.target.files[0]; e.target.value = ""; if (f) openProject(f); });

  // ---------- keyboard ----------
  let spaceDown = false;
  document.addEventListener("keydown", e => {
    if ($("overlay").classList.contains("open")) { if (e.key === "Escape") closeModal(); return; }
    const t = e.target, inField = /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable;
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (mod && !e.altKey) {
      if (k === "s") { e.preventDefault(); saveProject(); }
      else if (k === "o") { e.preventDefault(); $("projFile").click(); }
      else if (k === "p") { e.preventDefault(); exportPdf(); }
      else if (!inField && k === "d") { e.preventDefault(); duplicate(); }
      else if (!inField && k === "z") { e.preventDefault(); e.shiftKey ? travel(redo, undo) : travel(undo, redo); }
      else if (!inField && k === "y") { e.preventDefault(); travel(redo, undo); }
      return;
    }
    if (inField) return;
    if (e.key === " ") { e.preventDefault(); spaceDown = true; return; }
    if (e.key === "Delete" || e.key === "Backspace") { if (sel) { e.preventDefault(); removeSel(); } return; }
    if (e.key === "Escape") { select(null); return; }
    if (e.key.startsWith("Arrow")) {
      const o = selObj(), kk = kindOf(sel);
      if (!o || kk === "x") return;
      e.preventDefault();
      const d = e.shiftKey ? 20 : GRID;
      const v = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] }[e.key];
      editPush("nudge|" + sel);
      o.x += v[0]; o.y += v[1];
      requestRender(); scheduleSave();
      return;
    }
    if (k === "0") fit();
    else if (k === "+" || k === "=") zoomAt(1.25);
    else if (k === "-") zoomAt(0.8);
    else if (k === "w") toggleDrawer();
    else if (k === "p") setPorts(!ui.ports);
  });
  document.addEventListener("keyup", e => { if (e.key === " ") spaceDown = false; });
  window.addEventListener("blur", () => { spaceDown = false; });

  // ---------- drop a project file ----------
  let dragDepth = 0;
  const hasFiles = e => e.dataTransfer && [...e.dataTransfer.types].includes("Files");
  window.addEventListener("dragenter", e => { if (hasFiles(e)) { dragDepth++; document.body.classList.add("drag"); } });
  window.addEventListener("dragleave", e => { if (hasFiles(e) && --dragDepth <= 0) { dragDepth = 0; document.body.classList.remove("drag"); } });
  window.addEventListener("dragover", e => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener("drop", e => {
    if (!hasFiles(e)) return;
    e.preventDefault(); dragDepth = 0; document.body.classList.remove("drag");
    const f = [...e.dataTransfer.files].find(x => /\.(cblproj|json)$/i.test(x.name));
    const im = [...e.dataTransfer.files].find(x => /^image\//.test(x.type));
    if (f) openProject(f);
    else if (im && selBoard()) boardImage(selBoard(), im);
    else toast(im ? "Select a junction board first, then drop the image." : "Drop a .cblproj project file.", "warn");
  });
  window.addEventListener("beforeunload", e => { if (!storageOk && hasContent()) { e.preventDefault(); e.returnValue = ""; } });

  // ---------- side panel width (drag its left edge) ----------
  const INSP_MIN = 300, INSP_MAX = 720;
  function setInspW(w, save) {
    w = Math.round(Math.max(INSP_MIN, Math.min(INSP_MAX, w)));
    document.documentElement.style.setProperty("--insp-w", w + "px");
    if (save) { ui.inspW = w; saveUi(); }
  }
  (() => {
    const grip = $("inspGrip");
    let start = null;
    grip.addEventListener("pointerdown", e => {
      start = { x: e.clientX, w: $("inspPanel").getBoundingClientRect().width };
      grip.setPointerCapture(e.pointerId); document.body.classList.add("resizing");
    });
    grip.addEventListener("pointermove", e => { if (start) setInspW(start.w + start.x - e.clientX); });
    const end = () => { if (!start) return; start = null; document.body.classList.remove("resizing"); setInspW($("inspPanel").getBoundingClientRect().width, true); setViewBox(); };
    grip.addEventListener("pointerup", end); grip.addEventListener("pointercancel", end);
    grip.addEventListener("dblclick", () => { setInspW(350, true); setViewBox(); });
    grip.addEventListener("keydown", e => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      setInspW($("inspPanel").getBoundingClientRect().width + (e.key === "ArrowLeft" ? 20 : -20), true); setViewBox();
    });
    if (ui.inspW) setInspW(ui.inspW);
  })();

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
    im.onload = () => document.documentElement.classList.add("has-wm");   // page header only, never the drawing
    im.src = "../../assets/brand/wordmark.png";
  })();
  [["dlInsul", CD.INSUL], ["dlSpec", CD.WIRE_SPECS], ["dlAwg", CD.AWG.map(String).concat(CD.MM2)]].forEach(([id, list]) => { $(id).innerHTML = list.map(v => '<option value="' + esc(v) + '">').join(""); });
  applyTheme();
  buildLib();
  renderParts();
  setPorts(!!ui.ports);
  $("rev").textContent = "Cable Designer · " + REV;
  console.log("Cable Designer — " + REV);
  refreshAll(); paintUndo();
  toggleDrawer(!!ui.drawer);
  requestAnimationFrame(fit);

  (async () => {
    try {
      const logo = await idb.get("logo");
      if (logo && logo.data) { images.logo = logo; render(); renderInspector(); }
      const sp = await idb.get("parts");
      if (Array.isArray(sp)) { parts = sp.map(CD.normPart).filter(Boolean); renderParts(); }
      const saved = await idb.get("doc");
      if (saved && saved.format === CD.FORMAT) {
        p = CD.normalize(saved);
        refreshAll(); fit();
        if (hasContent()) setSaveStat("Restored from this browser");
      }
    } catch (e) {
      storageOk = false;
      setSaveStat("Browser storage unavailable — save a project file", true);
    }
  })();
})();
