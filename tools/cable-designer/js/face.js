/*
  Cable Designer — face builder
  Scope: dialog to draw a connector's mating face to match the maker's
  drawing: shell (circular, rectangular, D-shaped, none) with size and corner
  radius, keyways / keys / latches by angle, pins placed freely in mm or added
  as rings, centre pins and grids, per-pin diameter and square contacts,
  renumbering by rings or rows, and a pin table.
  Canvas: select (click, Shift / Ctrl+click, box, double-click = whole ring),
  move, nudge, rotate the selection with a handle or by a step about the face
  centre or the selection, mirror, zoom and pan. Own undo / redo history.
  Edits the connector live; Cancel goes back to the state at open.
*/
(function () {
  "use strict";
  const CD = window.CD;
  const NS = "http://www.w3.org/2000/svg";
  const r3 = v => Math.round(v * 1000) / 1000;
  const num = (v, d) => { const n = parseFloat(String(v).replace(",", ".")); return isFinite(n) ? n : d; };
  const ICON = {
    undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
    ccw: '<path d="M3 4v6h6"/><path d="M3.5 10A9 9 0 1 1 6 18.5"/>',
    cw: '<path d="M21 4v6h-6"/><path d="M20.5 10A9 9 0 1 0 18 18.5"/>',
    flipH: '<path d="M12 3v18"/><path d="M9 7L3 17h6zM15 7l6 10h-6z"/>',
    flipV: '<path d="M3 12h18"/><path d="M7 9L17 3v6zM7 15l10 6v-6z"/>',
    del: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    zin: '<path d="M6 12h12M12 6v12"/>', zout: '<path d="M6 12h12"/>'
  };
  const ico = (k, title, act, extra) => '<button class="tool" data-fa="' + act + '" title="' + title + '" aria-label="' + title + '"' + (extra || "") +
    '><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + ICON[k] + "</svg></button>";

  // h: { project(), conn(id), openModal, closeModal, setModalClose(fn), pushUndo, cancelEdit, changed(insp), toast, esc }
  CD.faceBuilder = function (h) {
    const esc = h.esc;
    let cid = null, sel = new Set(), drag = null, view = null, fitS = 1, cursor = null, tab = "shell";
    const opt = { snap: 0.25, step: "15", pivot: "centre" };
    const gen = { ring: { n: 6, r: 6, a: 0, ccw: false, d: 1.3 }, ctr: { d: 1.3 }, grid: { rows: 2, cols: 4, px: 2.54, py: 2.54, order: "rows", d: 1 } };
    const hist = [], fut = [];
    let lastKey = "", lastT = 0;
    const conn = () => h.conn(cid);
    const lay = () => conn().layout;
    const $ = id => document.getElementById(id);

    // ---------- open / close ----------
    function open(id) {
      cid = id; sel = new Set(); hist.length = 0; fut.length = 0; lastKey = ""; view = null; drag = null;
      const c = conn();
      if (!c) return;
      h.pushUndo();
      if (!c.layout) c.layout = CD.layoutFromFace(c);
      c.face = true;
      const L = c.layout;
      opt.pivot = L.shape === "circle" ? "centre" : "selection";
      gen.ring.r = r3(Math.max(1, (L.shape === "circle" ? L.w : Math.min(L.w, L.h)) * 0.32));
      h.openModal("Face builder · " + c.ref,
        '<div class="fb"><div class="fb-main"><div class="fb-bar" id="fbBar"></div><div class="fb-view" id="fbView"><svg id="fbSvg" xmlns="' + NS + '"></svg></div>' +
        '<div class="fb-status" id="fbStatus"></div></div><div class="fb-side"><div class="seg fb-tabs" id="fbTabs"></div><div class="fb-panel" id="fbSide"></div></div></div>', [
          { label: "Back to library face", cls: "btn-danger", onClick: resetFace },
          { label: "Cancel", onClick: cancel },
          { label: "Done", cls: "btn-primary", onClick: done }
        ], "xwide");
      h.setModalClose(cancel, true);   // X cancels; Escape and clicks outside do not
      const svg = $("fbSvg");
      svg.addEventListener("pointerdown", down);
      svg.addEventListener("pointermove", move);
      svg.addEventListener("pointerup", up);
      svg.addEventListener("pointercancel", up);
      svg.addEventListener("pointerleave", () => { cursor = null; renderStatus(); });
      svg.addEventListener("dblclick", dbl);
      svg.addEventListener("wheel", wheel, { passive: false });
      $("fbSide").addEventListener("input", onInput);
      $("fbSide").addEventListener("change", onChange);
      $("fbSide").addEventListener("click", onClick);
      $("fbBar").addEventListener("click", onClick);
      $("fbBar").addEventListener("change", onChange);
      $("fbStatus").addEventListener("change", onChange);
      $("fbTabs").addEventListener("click", e => { const b = e.target.closest("[data-tab]"); if (b) { tab = b.dataset.tab; renderSide(); } });
      document.addEventListener("keydown", onKey, true);
      renderAll();
      requestAnimationFrame(() => { fit(); renderSvg(); });
      h.changed(true);
    }
    function finish() { document.removeEventListener("keydown", onKey, true); h.setModalClose(null); cid = null; }
    function done() { finish(); h.closeModal(); h.changed(true); }
    function cancel() { finish(); h.closeModal(); h.cancelEdit(); }
    function resetFace() {
      const c = conn();
      c.layout = null;
      const lib = CD.libOf(c);
      if (!lib.var && c.pins.length !== lib.pins) { c.pins.length = Math.min(c.pins.length, lib.pins); CD.setPinCount(h.project(), c, lib.pins); }
      h.toast("Back to the library face");
      done();
    }

    // ---------- undo / redo (this dialog only) ----------
    function snapshot() {
      const c = conn(), ends = [];
      h.project().wires.forEach(w => { if ((w.a && w.a.c === cid) || (w.b && w.b.c === cid)) ends.push([w.id, w.a, w.b]); });
      return JSON.stringify({ pins: c.pins, layout: c.layout, ends, sel: [...sel] });
    }
    function restore(s) {
      const o = JSON.parse(s), c = conn(), p = h.project();
      c.pins = o.pins; c.layout = o.layout;
      p.wires.forEach(w => { ["a", "b"].forEach(e => { if (w[e] && w[e].c === cid) w[e] = null; }); });
      o.ends.forEach(([id, a, b]) => { const w = p.wires.find(x => x.id === id); if (w) { w.a = a; w.b = b; } });
      sel = new Set(o.sel.filter(i => i < c.pins.length));
    }
    // Call before a change. Same key within 1.5 s (typing in one field) is one step.
    function mark(key) {
      const now = Date.now();
      if (key && key === lastKey && now - lastT < 1500) { lastT = now; return; }
      hist.push(snapshot()); if (hist.length > 200) hist.shift();
      fut.length = 0; lastKey = key || ""; lastT = now;
    }
    function undo() { if (!hist.length) return; fut.push(snapshot()); restore(hist.pop()); lastKey = ""; edited(true); }
    function redo() { if (!fut.length) return; hist.push(snapshot()); restore(fut.pop()); lastKey = ""; edited(true); }
    function edited(side) { renderSvg(); if (side) renderSide(); renderBar(); renderStatus(); h.changed(!!side); }

    // ---------- selection helpers ----------
    const selPins = () => [...sel].map(i => lay().pins[i]);
    function pivotPt() {
      if (opt.pivot === "centre" || !sel.size) return { x: 0, y: 0 };
      const ps = selPins();
      const xs = ps.map(p => p.x), ys = ps.map(p => p.y);
      return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
    }
    function ringOf(i) {   // pins at the same distance from the face centre
      const L = lay(), r = Math.hypot(L.pins[i].x, L.pins[i].y);
      return L.pins.map((p, k) => k).filter(k => Math.abs(Math.hypot(L.pins[k].x, L.pins[k].y) - r) < 0.15);
    }
    function stepDeg() {
      if (opt.step === "pitch") { const n = sel.size > 1 ? sel.size : 1; return n > 1 ? 360 / n : 15; }
      return +opt.step;
    }
    function rotateSel(deg, from) {   // from: Map of original positions (handle drag)
      const L = lay(), P = pivotPt(), a = deg * Math.PI / 180, cs = Math.cos(a), sn = Math.sin(a);
      sel.forEach(i => {
        const o = from ? from.get(i) : L.pins[i], dx = o.x - P.x, dy = o.y - P.y;
        L.pins[i].x = r3(P.x + dx * cs - dy * sn); L.pins[i].y = r3(P.y + dx * sn + dy * cs);
      });
    }
    function mirrorSel(axis) {
      const L = lay(), P = pivotPt();
      sel.forEach(i => { if (axis === "h") L.pins[i].x = r3(2 * P.x - L.pins[i].x); else L.pins[i].y = r3(2 * P.y - L.pins[i].y); });
    }

    // ---------- view (mm; zoom and pan) ----------
    function viewSize() { const v = $("fbView"); return v ? { w: v.clientWidth || 600, h: v.clientHeight || 500 } : { w: 600, h: 500 }; }
    function fit() {
      const b = CD.layoutBounds(lay()), vs = viewSize();
      const w = Math.max(6, b.x1 - b.x0), hh = Math.max(6, b.y1 - b.y0);
      view = { cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, s: Math.max(w / vs.w, hh / vs.h) * 1.3 };   // s = mm per px
      fitS = view.s;
    }
    function zoomBy(f, at) {
      const vs = viewSize(), ns = Math.min(2, Math.max(0.002, view.s / f));
      if (at) { view.cx = at.x - (at.x - view.cx) * ns / view.s; view.cy = at.y - (at.y - view.cy) * ns / view.s; }
      view.s = ns;
      renderSvg(); renderBar();
    }
    function wheel(e) { e.preventDefault(); zoomBy(Math.exp(-e.deltaY * 0.0016), toMm(e)); }
    function toMm(e) {
      const m = $("fbSvg").getScreenCTM().inverse();
      return { x: m.a * e.clientX + m.c * e.clientY + m.e, y: m.b * e.clientX + m.d * e.clientY + m.f };
    }
    const snapV = (v, free) => free || !opt.snap ? r3(v) : r3(Math.round(v / opt.snap) * opt.snap);

    // ---------- canvas ----------
    function renderSvg() {
      const svg = $("fbSvg");
      if (!svg || !cid) return;
      if (!view) fit();
      const L = lay(), c = conn(), vs = viewSize(), s = view.s;
      const vw = vs.w * s, vh = vs.h * s, vx = view.cx - vw / 2, vy = view.cy - vh / 2;
      svg.setAttribute("viewBox", vx + " " + vy + " " + vw + " " + vh);
      svg.style.setProperty("--px", s);
      const o = [];
      // grid: minor step at least 9 px apart
      const minor = [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 50].find(g => g / s >= 9) || 100, major = minor * 5;
      for (let x = Math.ceil(vx / minor) * minor; x <= vx + vw; x += minor) o.push('<line class="fb-grid' + (Math.abs(x / major - Math.round(x / major)) < 1e-6 ? " major" : "") + '" x1="' + x + '" y1="' + vy + '" x2="' + x + '" y2="' + (vy + vh) + '"/>');
      for (let y = Math.ceil(vy / minor) * minor; y <= vy + vh; y += minor) o.push('<line class="fb-grid' + (Math.abs(y / major - Math.round(y / major)) < 1e-6 ? " major" : "") + '" x1="' + vx + '" y1="' + y + '" x2="' + (vx + vw) + '" y2="' + y + '"/>');
      o.push('<line class="fb-axis" x1="' + vx + '" y1="0" x2="' + (vx + vw) + '" y2="0"/><line class="fb-axis" x1="0" y1="' + vy + '" x2="0" y2="' + (vy + vh) + '"/>');
      CD.layoutGeom(L).forEach(g => {
        if (g.t === "circle") o.push('<circle class="fb-shell" cx="0" cy="0" r="' + g.r + '"/>');
        else if (g.t === "rect") o.push('<rect class="fb-shell" x="' + g.x + '" y="' + g.y + '" width="' + g.w + '" height="' + g.h + '" rx="' + g.r + '"/>');
        else o.push('<polygon class="' + (g.key ? "fb-k fb-k-" + g.key : "fb-shell") + '" points="' + g.pts.join(" ") + '"/>');
      });
      const male = c.gender === "male", fs = 11 * s;
      L.pins.forEach((p, i) => {
        const on = sel.has(i), cls = "fb-pin" + (male ? " male" : "") + (on ? " on" : ""), r = p.d / 2;
        o.push('<circle class="fb-hit" data-i="' + i + '" cx="' + p.x + '" cy="' + p.y + '" r="' + Math.max(r, 7 * s) + '"/>');
        o.push(p.sq ? '<rect class="' + cls + '" data-i="' + i + '" x="' + (p.x - r) + '" y="' + (p.y - r) + '" width="' + p.d + '" height="' + p.d + '"/>'
          : '<circle class="' + cls + '" data-i="' + i + '" cx="' + p.x + '" cy="' + p.y + '" r="' + r + '"/>');
        const inside = p.d > fs * 2.1;
        const tx = inside ? p.x : p.x + r + fs * 0.25, ty = inside ? p.y + fs * 0.36 : p.y - r - fs * 0.1;
        o.push('<text class="fb-lbl' + (inside && male ? " inv" : "") + (on ? " on" : "") + '" x="' + tx + '" y="' + ty + '" font-size="' + fs + '"' + (inside ? ' text-anchor="middle"' : "") + ">" + esc(c.pins[i] ? c.pins[i].n : "") + "</text>");
      });
      // rotate handle: a knob on a circle round the pivot, outside the selection
      if (sel.size && !(drag && (drag.t === "move" || drag.t === "box")) && (opt.pivot === "centre" || sel.size > 1)) {
        const P = pivotPt(), R = Math.max(...selPins().map(q => Math.hypot(q.x - P.x, q.y - P.y) + q.d / 2)) + 16 * s;
        const ang = drag && drag.t === "rot" ? drag.a0 + drag.deg * Math.PI / 180 : -Math.PI / 2;
        const kx = P.x + Math.cos(ang) * R, ky = P.y + Math.sin(ang) * R;
        o.push('<circle class="fb-rring" cx="' + P.x + '" cy="' + P.y + '" r="' + R + '"/>');
        o.push('<path class="fb-pivot" d="M' + (P.x - 5 * s) + " " + P.y + "h" + 10 * s + "M" + P.x + " " + (P.y - 5 * s) + "v" + 10 * s + '"/>');
        o.push('<line class="fb-rline" x1="' + P.x + '" y1="' + P.y + '" x2="' + kx + '" y2="' + ky + '"/>');
        o.push('<circle class="fb-knob" data-h="rot" cx="' + kx + '" cy="' + ky + '" r="' + 7 * s + '"><title>Drag to rotate</title></circle>');
        if (drag && drag.t === "rot") o.push('<text class="fb-angle" x="' + (kx + 10 * s) + '" y="' + (ky - 8 * s) + '" font-size="' + 12 * s + '">' + (drag.deg > 0 ? "+" : "") + r3(drag.deg) + "°</text>");
      }
      if (drag && drag.t === "box") o.push('<rect class="fb-box" x="' + Math.min(drag.x0, drag.x1) + '" y="' + Math.min(drag.y0, drag.y1) + '" width="' + Math.abs(drag.x1 - drag.x0) + '" height="' + Math.abs(drag.y1 - drag.y0) + '"/>');
      svg.innerHTML = o.join("");
    }

    function capture(e) { try { $("fbSvg").setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ } }
    function down(e) {
      const svg = $("fbSvg"), pt = toMm(e);
      if (e.button === 1) { drag = { t: "pan", sx: e.clientX, sy: e.clientY, cx: view.cx, cy: view.cy }; capture(e); return; }
      if (e.button !== 0) return;
      capture(e);
      if (e.target.closest('[data-h="rot"]')) {
        const P = pivotPt();
        drag = { t: "rot", P, a0: Math.atan2(pt.y - P.y, pt.x - P.x), start: Math.atan2(pt.y - P.y, pt.x - P.x), deg: 0, orig: new Map([...sel].map(i => [i, Object.assign({}, lay().pins[i])])), moved: false };
        return;
      }
      const t = e.target.closest("[data-i]");
      if (t) {
        const i = +t.dataset.i, add = e.shiftKey || e.ctrlKey || e.metaKey;
        if (add) { if (sel.has(i)) sel.delete(i); else sel.add(i); }
        else if (!sel.has(i)) sel = new Set([i]);
        const L = lay();
        drag = { t: "move", i, start: pt, orig: new Map([...sel].map(k => [k, { x: L.pins[k].x, y: L.pins[k].y }])), moved: false };
      } else {
        if (!(e.shiftKey || e.ctrlKey)) sel.clear();
        drag = { t: "box", x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y };
      }
      renderSvg(); renderSide(); renderBar(); renderStatus();
    }
    function move(e) {
      const pt = toMm(e);
      cursor = pt;
      if (!drag) { renderStatus(); return; }
      const L = lay();
      if (drag.t === "pan") {
        view.cx = drag.cx - (e.clientX - drag.sx) * view.s; view.cy = drag.cy - (e.clientY - drag.sy) * view.s;
        renderSvg();
      } else if (drag.t === "move") {
        const o = drag.orig.get(drag.i);
        if (!o || !sel.has(drag.i)) return;
        const nx = snapV(o.x + pt.x - drag.start.x, e.altKey), ny = snapV(o.y + pt.y - drag.start.y, e.altKey);
        const dx = nx - o.x, dy = ny - o.y;
        if (!drag.moved && Math.hypot(dx, dy) < 1e-9) return;
        if (!drag.moved) { mark(); drag.moved = true; }
        drag.orig.forEach((q, k) => { L.pins[k].x = r3(q.x + dx); L.pins[k].y = r3(q.y + dy); });
        renderSvg();
      } else if (drag.t === "rot") {
        let deg = (Math.atan2(pt.y - drag.P.y, pt.x - drag.P.x) - drag.start) * 180 / Math.PI;
        deg = ((deg + 540) % 360) - 180;
        if (!e.altKey) { const st = stepDeg(); deg = Math.round(deg / st) * st; }
        if (!drag.moved && !deg) return;
        if (!drag.moved) { mark(); drag.moved = true; }
        drag.deg = deg;
        rotateSel(deg, drag.orig);
        renderSvg();
      } else { drag.x1 = pt.x; drag.y1 = pt.y; renderSvg(); }
      renderStatus();
    }
    function up() {
      if (!drag) return;
      const d = drag; drag = null;
      if (d.t === "box") {
        const x0 = Math.min(d.x0, d.x1), x1 = Math.max(d.x0, d.x1), y0 = Math.min(d.y0, d.y1), y1 = Math.max(d.y0, d.y1);
        lay().pins.forEach((p, i) => { if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) sel.add(i); });
      }
      if ((d.t === "move" || d.t === "rot") && d.moved) edited(true);
      else { renderSvg(); renderSide(); renderBar(); renderStatus(); }
    }
    function dbl(e) {
      const t = e.target.closest("[data-i]");
      if (!t) return;
      const ring = ringOf(+t.dataset.i);
      sel = e.shiftKey ? new Set([...sel, ...ring]) : new Set(ring);
      renderSvg(); renderSide(); renderBar(); renderStatus();
    }

    function onKey(e) {
      if (!cid) return;
      const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
      if (mod && (k === "z" || k === "y") && !inField) { e.preventDefault(); e.stopPropagation(); if (k === "y" || e.shiftKey) redo(); else undo(); return; }
      if (inField) return;
      const L = lay(), stop = () => { e.preventDefault(); e.stopPropagation(); };
      if (mod && k === "a") { stop(); sel = new Set(L.pins.map((p, i) => i)); renderAll(); return; }
      if (e.key === "Escape") { stop(); if (sel.size) { sel.clear(); renderAll(); } return; }
      if ((e.key === "Delete" || e.key === "Backspace") && sel.size) { stop(); removeSel(); return; }
      if ((e.key === "[" || e.key === "]") && sel.size) { stop(); act(e.key === "[" ? "rotCcw" : "rotCw"); return; }
      if (k === "f" && !mod) { stop(); fit(); renderSvg(); renderBar(); return; }
      if (e.key.startsWith("Arrow") && sel.size) {
        stop();
        const d = e.shiftKey ? 1 : 0.1, v = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] }[e.key];
        mark("nudge");
        sel.forEach(i => { L.pins[i].x = r3(L.pins[i].x + v[0]); L.pins[i].y = r3(L.pins[i].y + v[1]); });
        edited(true);
      }
    }

    // ---------- toolbar, status, side panel ----------
    const F = (label, inner, cls) => '<label class="field' + (cls ? " " + cls : "") + '"><span class="lbl">' + label + "</span>" + inner + "</label>";
    const IN = (k, v, a) => '<input data-f="' + k + '" value="' + esc(v) + '"' + (a ? " " + a : "") + ">";
    const SEL = (k, v, opts, a) => '<select data-f="' + k + '"' + (a ? " " + a : "") + ">" + opts.map(o => '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(v) ? " selected" : "") + ">" + esc(o[1]) + "</option>").join("") + "</select>";
    const BTN = (a, label, extra, cls) => '<button class="btn btn-xs ' + (cls || "") + '" data-fa="' + a + '"' + (extra ? " " + extra : "") + ">" + label + "</button>";
    const sec = (t, body, acts) => '<div class="sec"><div class="sec-h"><span class="grp-lbl">' + t + "</span>" + (acts || "") + "</div>" + body + "</div>";
    const STEPS = [["1", "1°"], ["5", "5°"], ["10", "10°"], ["15", "15°"], ["30", "30°"], ["45", "45°"], ["90", "90°"], ["pitch", "Pin pitch"]];

    function renderBar() {
      const bar = $("fbBar");
      if (!bar || !cid) return;
      const none = sel.size ? "" : " disabled";
      bar.innerHTML =
        ico("undo", "Undo (Ctrl+Z)", "undo", hist.length ? "" : " disabled") + ico("redo", "Redo (Ctrl+Y)", "redo", fut.length ? "" : " disabled") +
        '<span class="vsep"></span>' +
        BTN("selAll", "All") + BTN("selRing", "Ring", 'title="Every pin on the same ring as the selection (or double-click a pin)"' + none) + BTN("selNone", "None", none) +
        '<span class="vsep"></span>' +
        ico("ccw", "Rotate counter-clockwise ( [ )", "rotCcw", none) +
        SEL("step", opt.step, STEPS, 'title="Rotate step" class="fb-step"') +
        ico("cw", "Rotate clockwise ( ] )", "rotCw", none) +
        '<div class="seg fb-pivot" title="Rotate and mirror about">' + [["centre", "Centre"], ["selection", "Selection"]].map(([v, l]) => '<button data-fa="pivot" data-v="' + v + '" aria-pressed="' + (opt.pivot === v) + '">' + l + "</button>").join("") + "</div>" +
        ico("flipH", "Mirror left / right", "flipH", none) + ico("flipV", "Mirror up / down", "flipV", none) +
        ico("del", "Remove selected (Del)", "selDel", none) +
        '<span class="spacer"></span>' +
        ico("zout", "Zoom out", "zout") + '<button class="fb-zoom" data-fa="fit" title="Fit (F)">' + (view ? Math.round(fitS / view.s * 100) + "%" : "Fit") + "</button>" + ico("zin", "Zoom in", "zin");
    }
    function renderStatus() {
      const st = $("fbStatus");
      if (!st || !cid) return;
      const n = lay().pins.length;
      const left = n + " pin" + (n !== 1 ? "s" : "") + (sel.size ? " · " + sel.size + " selected" : "") +
        (cursor ? '<span class="fb-xy">x ' + cursor.x.toFixed(2) + "  y " + cursor.y.toFixed(2) + " mm</span>" : "");
      const right = '<span class="fb-face">Mating face</span>' + SEL("snap", opt.snap, [[0, "No snap"], [0.1, "Snap 0.1"], [0.25, "Snap 0.25"], [0.5, "Snap 0.5"], [1, "Snap 1 mm"]]);
      if (!st.querySelector(".fb-l")) st.innerHTML = '<span class="fb-l"></span><span class="fb-r"></span>';
      st.querySelector(".fb-l").innerHTML = left;
      const r = st.querySelector(".fb-r");
      if (!r.contains(document.activeElement)) r.innerHTML = right;
    }
    function renderTabs() {
      const t = $("fbTabs");
      if (!t) return;
      t.innerHTML = [["shell", "Shell"], ["add", "Add pins"], ["pins", "Pins" + (sel.size ? " · " + sel.size : "")]].map(([v, l]) => '<button data-tab="' + v + '" aria-pressed="' + (tab === v) + '">' + l + "</button>").join("");
    }
    function renderSide() {
      renderTabs();
      const side = $("fbSide");
      if (!side || !cid) return;
      const L = lay(), c = conn(), st = side.scrollTop;
      let s = "";
      if (tab === "shell") {
        const circ = L.shape === "circle";
        s += sec("Shell", '<div class="r3">' + F("Shape", SEL("shape", L.shape, CD.SHELLS)) + F(circ ? "Diameter" : "Width", IN("w", L.w, 'inputmode="decimal"')) +
          (circ ? "<span></span>" : F("Height", IN("h", L.h, 'inputmode="decimal"'))) + "</div>" +
          '<div class="r3">' + (L.shape === "rect" ? F("Corner radius", IN("r", L.r, 'inputmode="decimal"')) : "<span></span>") +
          F("On the drawing", SEL("size", L.size, [[1, "Small"], [2, "Medium"], [3, "Large"]])) + "<span></span></div>");
        s += sec("Keys and keyways", (L.keys.length ? '<div class="fb-row fb-row-h"><span>Kind</span><span>Angle °</span><span>Width</span><span></span></div>' : "") +
          L.keys.map((k, i) => '<div class="fb-row">' + SEL("key." + i + ".kind", k.kind, CD.KEY_KINDS) + IN("key." + i + ".ang", k.ang, 'inputmode="decimal" title="0 = top, clockwise"') + IN("key." + i + ".w", k.w, 'inputmode="decimal" title="mm"') +
            '<button class="icon-btn" data-fa="keyDel" data-i="' + i + '" aria-label="Remove key">✕</button></div>').join(""),
          BTN("keyAdd", "＋ Add"));
      } else if (tab === "add") {
        const g = gen;
        s += sec("Ring", '<div class="r3">' + F("Pins", IN("g.ring.n", g.ring.n, 'type="number" min="1" max="100"')) + F("Radius", IN("g.ring.r", g.ring.r, 'inputmode="decimal"')) + F("Pin dia.", IN("g.ring.d", g.ring.d, 'inputmode="decimal"')) + "</div>" +
          '<div class="r3">' + F("First pin at °", IN("g.ring.a", g.ring.a, 'inputmode="decimal" title="0 = top, clockwise"')) + F("Direction", SEL("g.ring.ccw", g.ring.ccw ? "1" : "", [["", "Clockwise"], ["1", "Counter-clockwise"]])) + "<span></span></div>",
          BTN("addRing", "Add ring", "", "btn-primary"));
        s += sec("Centre pin", '<div class="r3">' + F("Pin dia.", IN("g.ctr.d", g.ctr.d, 'inputmode="decimal"')) + "<span></span><span></span></div>", BTN("addCtr", "Add", "", "btn-primary"));
        s += sec("Grid", '<div class="r3">' + F("Rows", IN("g.grid.rows", g.grid.rows, 'type="number" min="1" max="20"')) + F("Columns", IN("g.grid.cols", g.grid.cols, 'type="number" min="1" max="60"')) + F("Pin dia.", IN("g.grid.d", g.grid.d, 'inputmode="decimal"')) + "</div>" +
          '<div class="r3">' + F("Pitch X", IN("g.grid.px", g.grid.px, 'inputmode="decimal"')) + F("Pitch Y", IN("g.grid.py", g.grid.py, 'inputmode="decimal"')) + F("Numbering", SEL("g.grid.order", g.grid.order, [["rows", "Row by row"], ["zigzag", "Odd / even"]])) + "</div>",
          BTN("addGrid", "Add grid", "", "btn-primary"));
      } else {
        const one = sel.size === 1 ? [...sel][0] : -1;
        if (sel.size) {
          const ps = selPins(), same = f => ps.every(p => p[f] === ps[0][f]) ? ps[0][f] : "";
          s += sec(one >= 0 ? "Pin " + esc(c.pins[one].n) : sel.size + " pins",
            (one >= 0 ? '<div class="r3">' + F("Number", IN("pin.n", c.pins[one].n)) + F("X", IN("pin.x", L.pins[one].x, 'inputmode="decimal"')) + F("Y", IN("pin.y", L.pins[one].y, 'inputmode="decimal"')) + "</div>" : "") +
            '<div class="r3">' + F("Pin dia.", IN("sel.d", same("d"), 'inputmode="decimal" placeholder="mixed"')) + F("Contact", SEL("sel.sq", ps.every(p => p.sq) ? "1" : "", [["", "Round"], ["1", "Square"]])) +
            F("Rotate by °", '<div class="fb-inline">' + IN("rot", "", 'inputmode="decimal" placeholder="' + stepDeg() + '"') + BTN("rotBy", "Go") + "</div>") + "</div>",
            BTN("selDel", "Remove", "", "btn-danger"));
        }
        s += sec("Numbering", '<div class="btn-row">' + BTN("numRings", "By rings", 'title="Outer ring first, clockwise from the top, centre last"') + BTN("numRows", "By rows", 'title="Top row first, left to right"') + BTN("numList", "1…n as listed") + "</div>");
        s += sec("All pins (" + L.pins.length + ")", '<table class="fb-tbl"><thead><tr><th>#</th><th>No.</th><th>X</th><th>Y</th><th>Dia.</th><th></th></tr></thead><tbody>' + L.pins.map((p, i) =>
          '<tr data-pi="' + i + '"' + (sel.has(i) ? ' class="on"' : "") + "><td>" + (i + 1) + "</td><td>" + IN("p." + i + ".n", c.pins[i].n) + "</td><td>" + IN("p." + i + ".x", p.x) + "</td><td>" + IN("p." + i + ".y", p.y) + "</td><td>" + IN("p." + i + ".d", p.d) +
          '</td><td><button class="icon-btn" data-fa="pinDel" data-i="' + i + '" aria-label="Remove pin">✕</button></td></tr>').join("") + "</tbody></table>");
      }
      side.innerHTML = s;
      side.scrollTop = st;
    }
    function renderAll() { renderBar(); renderSvg(); renderSide(); renderStatus(); }

    // ---------- edits ----------
    function onInput(e) {
      const el = e.target.closest("[data-f]");
      if (!el || el.tagName === "SELECT") return;
      field(el, false);
    }
    function onChange(e) {
      const el = e.target.closest("[data-f]");
      if (!el || el.tagName !== "SELECT") return;
      field(el, true);
    }
    function field(el, isSelect) {
      const k = el.dataset.f, v = el.value, L = lay(), c = conn(), parts = k.split(".");
      if (k === "snap") { opt.snap = +v; return; }
      if (k === "step") { opt.step = v; renderSide(); return; }
      if (k === "rot") return;
      if (parts[0] === "g") { const o = gen[parts[1]]; o[parts[2]] = parts[2] === "order" ? v : parts[2] === "ccw" ? !!v : num(v, o[parts[2]]); return; }
      mark("f:" + k);
      let side = isSelect;
      if (k === "shape") { L.shape = v; if (v === "circle") L.h = L.w; }
      else if (k === "w" || k === "h" || k === "r") { L[k] = Math.max(k === "r" ? 0 : 0.5, num(v, L[k])); if (k === "w" && L.shape === "circle") L.h = L.w; }
      else if (k === "size") L.size = +v;
      else if (parts[0] === "key") { const kk = L.keys[+parts[1]]; kk[parts[2]] = parts[2] === "kind" ? v : num(v, kk[parts[2]]); }
      else if (k === "pin.n") { c.pins[[...sel][0]].n = v; side = false; }
      else if (k === "pin.x" || k === "pin.y") L.pins[[...sel][0]][k.slice(4)] = num(v, 0);
      else if (k === "sel.d") { const d = num(v, 0); if (d > 0) sel.forEach(i => { L.pins[i].d = d; }); }
      else if (k === "sel.sq") sel.forEach(i => { L.pins[i].sq = !!v; });
      else if (parts[0] === "p") { const i = +parts[1]; if (parts[2] === "n") c.pins[i].n = v; else { const n = num(v, null); if (n != null && (parts[2] !== "d" || n > 0)) L.pins[i][parts[2]] = n; } }
      edited(side);
    }
    function addPins(list) {
      mark();
      const c = conn(), before = c.pins.length;
      CD.addPins(c, list);
      sel = new Set(list.map((x, i) => before + i));
      tab = "pins";
      const b = CD.layoutBounds(lay()), vs = viewSize(), s = view.s;
      if (b.x0 < view.cx - vs.w * s / 2 || b.x1 > view.cx + vs.w * s / 2 || b.y0 < view.cy - vs.h * s / 2 || b.y1 > view.cy + vs.h * s / 2) fit();
      edited(true);
    }
    function removeSel() { mark(); CD.removePins(h.project(), conn(), [...sel]); sel.clear(); edited(true); }
    function renumber(order) {
      mark();
      const c = conn();
      CD.reorderPins(h.project(), c, order);
      c.pins.forEach((x, i) => { x.n = String(i + 1); });
      sel.clear(); edited(true);
    }
    function act(a, b) {
      const L = lay(), g = gen;
      switch (a) {
        case "undo": undo(); break;
        case "redo": redo(); break;
        case "selAll": sel = new Set(L.pins.map((p, i) => i)); renderAll(); break;
        case "selNone": sel.clear(); renderAll(); break;
        case "selRing": { const r = new Set(sel); [...sel].forEach(i => ringOf(i).forEach(k => r.add(k))); sel = r; renderAll(); break; }
        case "rotCw": case "rotCcw": if (sel.size) { mark(); rotateSel(stepDeg() * (a === "rotCw" ? 1 : -1)); edited(true); } break;
        case "rotBy": { const inp = $("fbSide").querySelector('[data-f="rot"]'), d = num(inp && inp.value, stepDeg()); if (sel.size && d) { mark(); rotateSel(d); edited(true); } break; }
        case "flipH": case "flipV": if (sel.size) { mark(); mirrorSel(a === "flipH" ? "h" : "v"); edited(true); } break;
        case "pivot": opt.pivot = b.dataset.v; renderBar(); renderSvg(); break;
        case "fit": fit(); renderSvg(); renderBar(); break;
        case "zin": zoomBy(1.25); break;
        case "zout": zoomBy(0.8); break;
        case "keyAdd": mark(); L.keys.push({ kind: "notch", ang: L.keys.length ? (L.keys[L.keys.length - 1].ang + 72) % 360 : 0, w: L.shape === "circle" ? Math.max(0.8, r3(L.w * 0.1)) : 2 }); edited(true); break;
        case "keyDel": mark(); L.keys.splice(+b.dataset.i, 1); edited(true); break;
        case "addRing": addPins(CD.ringPins(Math.max(1, Math.min(100, Math.round(g.ring.n))), g.ring.r, g.ring.a, g.ring.ccw, g.ring.d)); break;
        case "addCtr": addPins([{ x: 0, y: 0, d: g.ctr.d }]); break;
        case "addGrid": addPins(CD.gridPins(Math.max(1, Math.round(g.grid.rows)), Math.max(1, Math.round(g.grid.cols)), g.grid.px, g.grid.py, g.grid.order, g.grid.d)); break;
        case "selDel": if (sel.size) removeSel(); break;
        case "pinDel": sel = new Set([+b.dataset.i]); removeSel(); break;
        case "numRings": renumber(CD.sortPinOrder(L.pins, "rings")); break;
        case "numRows": renumber(CD.sortPinOrder(L.pins, "rows")); break;
        case "numList": renumber(L.pins.map((p, i) => i)); break;
      }
    }
    function onClick(e) {
      const tr = e.target.closest("tr[data-pi]");
      if (tr && !e.target.closest("input,button")) {
        const i = +tr.dataset.pi;
        if (e.shiftKey || e.ctrlKey) { if (sel.has(i)) sel.delete(i); else sel.add(i); } else sel = new Set([i]);
        renderAll(); return;
      }
      const b = e.target.closest("[data-fa]");
      if (b && !b.disabled) act(b.dataset.fa, b);
    }
    // Enter in "Rotate by" applies it.
    document.addEventListener("keydown", e => {
      if (!cid || e.key !== "Enter" || !e.target.matches || !e.target.matches('[data-f="rot"]')) return;
      e.preventDefault(); act("rotBy");
    });

    return { open };
  };
})();
