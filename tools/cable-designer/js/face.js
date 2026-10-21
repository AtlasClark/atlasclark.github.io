/*
  Cable Designer — face builder
  Scope: dialog to draw a connector's mating face to match the maker's
  drawing: shell (circular, rectangular, D-shaped, none) with size and corner
  radius, keyways / keys / latches by angle, pins placed freely in mm (drag,
  marquee, nudge, rotate) or added as rings, centre pins and grids, with
  per-pin diameter and square contacts, renumbering by rings or rows, and a
  pin table. Edits the connector live; Cancel goes back to the state at open.
*/
(function () {
  "use strict";
  const CD = window.CD;
  const NS = "http://www.w3.org/2000/svg";
  const r3 = v => Math.round(v * 1000) / 1000;
  const num = (v, d) => { const n = parseFloat(String(v).replace(",", ".")); return isFinite(n) ? n : d; };

  // h: { project(), conn(id), openModal, closeModal, setModalClose(fn), pushUndo, cancelEdit, changed(insp), toast, esc }
  CD.faceBuilder = function (h) {
    const esc = h.esc;
    let cid = null, sel = new Set(), vb = null, drag = null, snap = 0.25, frozen = false;
    const gen = { ring: { n: 6, r: 6, a: 0, ccw: false, d: 1.3 }, ctr: { d: 1.3 }, grid: { rows: 2, cols: 4, px: 2.54, py: 2.54, order: "rows", d: 1 } };
    const conn = () => h.conn(cid);
    const lay = () => conn().layout;
    const $ = id => document.getElementById(id);

    function open(id) {
      cid = id; sel = new Set();
      const c = conn();
      if (!c) return;
      h.pushUndo();
      if (!c.layout) c.layout = CD.layoutFromFace(c);
      c.face = true;
      const L = c.layout;
      gen.ring.r = r3(Math.max(1, (L.shape === "circle" ? L.w : Math.min(L.w, L.h)) * 0.32));
      h.openModal("Face builder: " + c.ref, '<div class="fb"><div class="fb-view"><svg id="fbSvg" xmlns="' + NS + '"></svg><div class="fb-tip">Drag pins · Shift+click or drag a box to select more · Arrows nudge 0.1 mm (Shift: 1 mm) · Del removes · Ctrl+A selects all</div></div><div class="fb-side" id="fbSide"></div></div>', [
        { label: "Back to library face", cls: "btn-danger", onClick: resetFace },
        { label: "Cancel", onClick: cancel },
        { label: "Done", cls: "btn-primary", onClick: done }
      ], "xwide");
      h.setModalClose(cancel);
      $("fbSvg").addEventListener("pointerdown", down);
      $("fbSvg").addEventListener("pointermove", move);
      $("fbSvg").addEventListener("pointerup", up);
      $("fbSide").addEventListener("input", onInput);
      $("fbSide").addEventListener("click", onClick);
      document.addEventListener("keydown", onKey, true);
      vb = null;
      renderSide(); renderSvg(); h.changed(true);
    }
    function finish() { document.removeEventListener("keydown", onKey, true); h.setModalClose(null); cid = null; }
    function done() { finish(); h.closeModal(); h.changed(true); }
    function cancel() { finish(); h.closeModal(); h.cancelEdit(); }
    function resetFace() {
      const c = conn();
      c.layout = null;
      const lib = CD.libOf(c);
      if (!lib.var && c.pins.length !== lib.pins) { c.pins.length = Math.min(c.pins.length, lib.pins); CD.setPinCount(h.project(), c, lib.pins); }
      h.toast("Face set back to the library drawing");
      done();
    }

    // ---------- view ----------
    function fitBox() {
      const L = lay(), b = CD.layoutBounds(L);
      const w = Math.max(10, b.x1 - b.x0), hh = Math.max(10, b.y1 - b.y0), m = Math.max(w, hh) * 0.18;
      return { x: b.x0 - m, y: b.y0 - m, w: w + m * 2, h: hh + m * 2 };
    }
    function renderSvg() {
      const svg = $("fbSvg");
      if (!svg) return;
      const L = lay(), c = conn();
      if (!vb || !frozen) vb = fitBox();
      svg.setAttribute("viewBox", vb.x + " " + vb.y + " " + vb.w + " " + vb.h);
      const u = Math.max(vb.w, vb.h) / 100;   // ~1 % of the view
      const o = [];
      const step = vb.w > 80 ? 5 : 1;
      for (let x = Math.ceil(vb.x / step) * step; x <= vb.x + vb.w; x += step) o.push('<line class="fb-grid' + (x % 5 ? "" : " major") + '" x1="' + x + '" y1="' + vb.y + '" x2="' + x + '" y2="' + (vb.y + vb.h) + '"/>');
      for (let y = Math.ceil(vb.y / step) * step; y <= vb.y + vb.h; y += step) o.push('<line class="fb-grid' + (y % 5 ? "" : " major") + '" x1="' + vb.x + '" y1="' + y + '" x2="' + (vb.x + vb.w) + '" y2="' + y + '"/>');
      o.push('<line class="fb-axis" x1="' + vb.x + '" y1="0" x2="' + (vb.x + vb.w) + '" y2="0"/><line class="fb-axis" x1="0" y1="' + vb.y + '" x2="0" y2="' + (vb.y + vb.h) + '"/>');
      CD.layoutGeom(L).forEach(g => {
        if (g.t === "circle") o.push('<circle class="fb-shell" cx="0" cy="0" r="' + g.r + '"/>');
        else if (g.t === "rect") o.push('<rect class="fb-shell" x="' + g.x + '" y="' + g.y + '" width="' + g.w + '" height="' + g.h + '" rx="' + g.r + '"/>');
        else o.push('<polygon class="' + (g.key ? "fb-k fb-k-" + g.key : "fb-shell") + '" points="' + g.pts.join(" ") + '"/>');
      });
      const male = c.gender === "male";
      L.pins.forEach((p, i) => {
        const on = sel.has(i), cls = "fb-pin" + (male ? " male" : "") + (on ? " on" : "");
        const r = p.d / 2;
        o.push(p.sq ? '<rect class="' + cls + '" data-i="' + i + '" x="' + (p.x - r) + '" y="' + (p.y - r) + '" width="' + p.d + '" height="' + p.d + '"/>'
          : '<circle class="' + cls + '" data-i="' + i + '" cx="' + p.x + '" cy="' + p.y + '" r="' + r + '"/>');
        const fs = Math.max(u * 2.4, Math.min(p.d * 0.6, u * 4));
        const inside = p.d > fs * 2.2;
        const tx = inside ? p.x : p.x + r + fs * 0.25, ty = inside ? p.y + fs * 0.35 : p.y - r - fs * 0.15;
        o.push('<text class="fb-lbl' + (inside && male ? " inv" : "") + '" x="' + tx + '" y="' + ty + '" font-size="' + fs + '"' + (inside ? ' text-anchor="middle"' : "") + ">" + esc(c.pins[i] ? c.pins[i].n : "") + "</text>");
      });
      if (drag && drag.t === "box") o.push('<rect class="fb-box" x="' + Math.min(drag.x0, drag.x1) + '" y="' + Math.min(drag.y0, drag.y1) + '" width="' + Math.abs(drag.x1 - drag.x0) + '" height="' + Math.abs(drag.y1 - drag.y0) + '"/>');
      svg.innerHTML = o.join("");
      svg.style.setProperty("--u", u);
    }
    function toMm(e) {
      const m = $("fbSvg").getScreenCTM().inverse();
      return { x: m.a * e.clientX + m.c * e.clientY + m.e, y: m.b * e.clientX + m.d * e.clientY + m.f };
    }
    const snapV = (v, free) => free || !snap ? r3(v) : r3(Math.round(v / snap) * snap);

    function down(e) {
      if (e.button !== 0) return;
      const t = e.target.closest("[data-i]"), pt = toMm(e);
      frozen = true;
      $("fbSvg").setPointerCapture(e.pointerId);
      if (t) {
        const i = +t.dataset.i;
        if (e.shiftKey) { if (sel.has(i)) sel.delete(i); else sel.add(i); }
        else if (!sel.has(i)) sel = new Set([i]);
        const L = lay();
        drag = { t: "move", i, start: pt, orig: new Map([...sel].map(k => [k, { x: L.pins[k].x, y: L.pins[k].y }])), moved: false };
      } else {
        if (!e.shiftKey) sel.clear();
        drag = { t: "box", x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y, add: e.shiftKey };
      }
      renderSvg(); renderSide();
    }
    function move(e) {
      if (!drag) return;
      const pt = toMm(e);
      if (drag.t === "move") {
        const L = lay(), o = drag.orig.get(drag.i);
        if (!o) return;
        const nx = snapV(o.x + pt.x - drag.start.x, e.altKey), ny = snapV(o.y + pt.y - drag.start.y, e.altKey);
        const dx = nx - o.x, dy = ny - o.y;
        if (!drag.moved && Math.hypot(dx, dy) < 1e-9) return;
        drag.moved = true;
        drag.orig.forEach((q, k) => { L.pins[k].x = r3(q.x + dx); L.pins[k].y = r3(q.y + dy); });
        renderSvg();
      } else { drag.x1 = pt.x; drag.y1 = pt.y; renderSvg(); }
    }
    function up() {
      if (!drag) return;
      const d = drag; drag = null; frozen = false;
      if (d.t === "box") {
        const x0 = Math.min(d.x0, d.x1), x1 = Math.max(d.x0, d.x1), y0 = Math.min(d.y0, d.y1), y1 = Math.max(d.y0, d.y1);
        lay().pins.forEach((p, i) => { if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) sel.add(i); });
      }
      renderSvg(); renderSide();
      if (d.t === "move" && d.moved) h.changed(false);
    }
    function onKey(e) {
      if (!cid) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      const L = lay();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") { e.preventDefault(); e.stopPropagation(); sel = new Set(L.pins.map((p, i) => i)); renderSvg(); renderSide(); return; }
      if (e.key === "Delete" || e.key === "Backspace") { if (sel.size) { e.preventDefault(); e.stopPropagation(); removeSel(); } return; }
      if (e.key.startsWith("Arrow") && sel.size) {
        e.preventDefault(); e.stopPropagation();
        const d = e.shiftKey ? 1 : 0.1, v = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] }[e.key];
        sel.forEach(i => { L.pins[i].x = r3(L.pins[i].x + v[0]); L.pins[i].y = r3(L.pins[i].y + v[1]); });
        renderSvg(); renderSide(); h.changed(false);
      }
    }

    // ---------- side panel ----------
    const F = (label, inner, cls) => '<label class="field' + (cls ? " " + cls : "") + '"><span class="lbl">' + label + "</span>" + inner + "</label>";
    const IN = (k, v, a) => '<input data-f="' + k + '" value="' + esc(v) + '"' + (a ? " " + a : "") + ">";
    const SEL = (k, v, opts) => '<select data-f="' + k + '">' + opts.map(o => '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(v) ? " selected" : "") + ">" + esc(o[1]) + "</option>").join("") + "</select>";
    const BTN = (a, label, extra, cls) => '<button class="btn btn-xs ' + (cls || "") + '" data-fa="' + a + '"' + (extra ? " " + extra : "") + ">" + label + "</button>";
    const sec = (t, body) => '<div class="sec"><div class="sec-h"><span class="grp-lbl">' + t + "</span></div>" + body + "</div>";

    function renderSide() {
      const side = $("fbSide");
      if (!side) return;
      const L = lay(), c = conn(), st = side.scrollTop;
      let s = '<p class="hint">Draw the face as seen looking into the mating face of this part (as on the maker\'s drawing). Sizes in mm. Female parts are not mirrored for you.</p>';
      const circ = L.shape === "circle";
      s += sec("Shell", '<div class="r3">' + F("Shape", SEL("shape", L.shape, CD.SHELLS)) + F(circ ? "Diameter" : "Width", IN("w", L.w, 'inputmode="decimal"')) +
        (circ ? "<span></span>" : F("Height", IN("h", L.h, 'inputmode="decimal"'))) + "</div>" +
        '<div class="r3">' + (L.shape === "rect" ? F("Corner radius", IN("r", L.r, 'inputmode="decimal"')) : "<span></span>") +
        F("Size on drawing", SEL("size", L.size, [[1, "Small"], [2, "Medium"], [3, "Large"]])) +
        F("Snap", SEL("snap", snap, [[0, "Off"], [0.1, "0.1 mm"], [0.25, "0.25 mm"], [0.5, "0.5 mm"], [1, "1 mm"]])) + "</div>");
      s += sec("Keys and keyways", L.keys.map((k, i) => '<div class="fb-row">' + SEL("key." + i + ".kind", k.kind, CD.KEY_KINDS) + IN("key." + i + ".ang", k.ang, 'inputmode="decimal" title="Angle in degrees: 0 = top, clockwise"') + IN("key." + i + ".w", k.w, 'inputmode="decimal" title="Width in mm"') +
        '<button class="icon-btn" data-fa="keyDel" data-i="' + i + '" aria-label="Remove key">✕</button></div>').join("") +
        (L.keys.length ? '<p class="hint">Kind · angle (° from top, clockwise) · width (mm).</p>' : "") + '<div class="btn-row">' + BTN("keyAdd", "＋ Key or keyway") + "</div>");
      const g = gen;
      s += sec("Add pins",
        '<div class="card"><div class="card-h">Ring</div><div class="r3">' + F("Pins", IN("g.ring.n", g.ring.n, 'type="number" min="1" max="100"')) + F("Radius", IN("g.ring.r", g.ring.r, 'inputmode="decimal"')) + F("Pin Ø", IN("g.ring.d", g.ring.d, 'inputmode="decimal"')) + "</div>" +
        '<div class="r3">' + F("First pin at °", IN("g.ring.a", g.ring.a, 'inputmode="decimal" title="0 = top, clockwise"')) + F("Direction", SEL("g.ring.ccw", g.ring.ccw ? "1" : "", [["", "Clockwise"], ["1", "Counter-clockwise"]])) + '<div class="field"><span class="lbl">&nbsp;</span>' + BTN("addRing", "Add ring", "", "btn-primary") + "</div></div></div>" +
        '<div class="card"><div class="card-h">Centre pin</div><div class="r3">' + F("Pin Ø", IN("g.ctr.d", g.ctr.d, 'inputmode="decimal"')) + '<div class="field"><span class="lbl">&nbsp;</span>' + BTN("addCtr", "Add centre pin", "", "btn-primary") + "</div></div></div>" +
        '<div class="card"><div class="card-h">Grid</div><div class="r3">' + F("Rows", IN("g.grid.rows", g.grid.rows, 'type="number" min="1" max="20"')) + F("Columns", IN("g.grid.cols", g.grid.cols, 'type="number" min="1" max="60"')) + F("Pin Ø", IN("g.grid.d", g.grid.d, 'inputmode="decimal"')) + "</div>" +
        '<div class="r3">' + F("Pitch X", IN("g.grid.px", g.grid.px, 'inputmode="decimal"')) + F("Pitch Y", IN("g.grid.py", g.grid.py, 'inputmode="decimal"')) + F("Numbering", SEL("g.grid.order", g.grid.order, [["rows", "Row by row"], ["zigzag", "Across rows (odd / even)"]])) + "</div>" +
        '<div class="btn-row">' + BTN("addGrid", "Add grid", "", "btn-primary") + "</div></div>" +
        '<p class="hint">New pins are numbered after the highest pin number and placed on the face centre.</p>');
      const one = sel.size === 1 ? [...sel][0] : -1;
      if (sel.size) {
        const ps = [...sel].map(i => L.pins[i]);
        const same = f => ps.every(p => p[f] === ps[0][f]) ? ps[0][f] : "";
        s += sec(sel.size === 1 ? "Pin " + esc(c.pins[one].n) : sel.size + " pins selected",
          (one >= 0 ? '<div class="r3">' + F("Pin number", IN("pin.n", c.pins[one].n)) + F("X", IN("pin.x", L.pins[one].x, 'inputmode="decimal"')) + F("Y", IN("pin.y", L.pins[one].y, 'inputmode="decimal"')) + "</div>" : "") +
          '<div class="r3">' + F("Pin Ø", IN("sel.d", same("d"), 'inputmode="decimal"')) + F("Contact", SEL("sel.sq", ps.every(p => p.sq) ? "1" : "", [["", "Round"], ["1", "Square"]])) + F("Rotate ° about centre", IN("rot", "", 'inputmode="decimal" placeholder="e.g. 15, then Enter"')) + "</div>" +
          '<div class="btn-row">' + BTN("selDel", "Remove " + (sel.size === 1 ? "pin" : sel.size + " pins"), "", "btn-danger") + BTN("selNone", "Clear selection") + "</div>");
      }
      s += sec("Numbering", '<div class="btn-row">' + BTN("numRings", "Renumber by rings", 'title="Outer ring first, clockwise from the top, centre last"') + BTN("numRows", "Renumber by rows", 'title="Top row first, left to right"') + BTN("numList", "1…n in list order") + "</div>" +
        '<p class="hint">Renumbering reorders the pins; wires stay on their pins.</p>');
      s += sec("Pins (" + L.pins.length + ")", '<table class="fb-tbl"><thead><tr><th>#</th><th>No.</th><th>X</th><th>Y</th><th>Ø</th><th></th></tr></thead><tbody>' + L.pins.map((p, i) =>
        '<tr data-pi="' + i + '"' + (sel.has(i) ? ' class="on"' : "") + "><td>" + (i + 1) + "</td><td>" + IN("p." + i + ".n", c.pins[i].n) + "</td><td>" + IN("p." + i + ".x", p.x) + "</td><td>" + IN("p." + i + ".y", p.y) + "</td><td>" + IN("p." + i + ".d", p.d) + '</td><td><button class="icon-btn" data-fa="pinDel" data-i="' + i + '" aria-label="Remove pin">✕</button></td></tr>').join("") + "</tbody></table>");
      side.innerHTML = s;
      side.scrollTop = st;
    }

    function onInput(e) {
      const el = e.target.closest("[data-f]");
      if (!el) return;
      const k = el.dataset.f, v = el.value, L = lay(), c = conn();
      const parts = k.split(".");
      let side = false;
      if (k === "shape") { L.shape = v; if (v === "circle") L.h = L.w; side = true; }
      else if (k === "w" || k === "h" || k === "r") { L[k] = Math.max(k === "r" ? 0 : 0.5, num(v, L[k])); if (k === "w" && L.shape === "circle") L.h = L.w; }
      else if (k === "size") L.size = +v;
      else if (k === "snap") snap = +v;
      else if (parts[0] === "key") { const kk = L.keys[+parts[1]]; kk[parts[2]] = parts[2] === "kind" ? v : num(v, kk[parts[2]]); }
      else if (parts[0] === "g") { const o = gen[parts[1]]; o[parts[2]] = parts[2] === "order" ? v : parts[2] === "ccw" ? !!v : num(v, o[parts[2]]); return; }
      else if (k === "pin.n") c.pins[[...sel][0]].n = v;
      else if (k === "pin.x" || k === "pin.y") L.pins[[...sel][0]][k.slice(4)] = num(v, 0);
      else if (k === "sel.d") { const d = num(v, 0); if (d > 0) sel.forEach(i => { L.pins[i].d = d; }); }
      else if (k === "sel.sq") sel.forEach(i => { L.pins[i].sq = !!v; });
      else if (k === "rot") return;
      else if (parts[0] === "p") { const i = +parts[1]; if (parts[2] === "n") c.pins[i].n = v; else { const n = num(v, null); if (n != null && (parts[2] !== "d" || n > 0)) L.pins[i][parts[2]] = n; } }
      renderSvg();
      if (side) renderSide();
      h.changed(false);
    }
    function addPins(list) {
      const c = conn(), before = c.pins.length;
      CD.addPins(c, list);
      sel = new Set(list.map((x, i) => before + i));
      vb = null; renderSvg(); renderSide(); h.changed(true);
    }
    function removeSel() { CD.removePins(h.project(), conn(), [...sel]); sel.clear(); vb = null; renderSvg(); renderSide(); h.changed(true); }
    function renumber(order) {
      const c = conn();
      CD.reorderPins(h.project(), c, order);
      c.pins.forEach((x, i) => { x.n = String(i + 1); });
      sel.clear(); renderSvg(); renderSide(); h.changed(true);
    }
    function onClick(e) {
      const tr = e.target.closest("tr[data-pi]");
      if (tr && !e.target.closest("input,button")) { const i = +tr.dataset.pi; sel = e.shiftKey ? new Set([...sel, i]) : new Set([i]); renderSvg(); renderSide(); return; }
      const b = e.target.closest("[data-fa]");
      if (!b) return;
      const L = lay(), g = gen, a = b.dataset.fa;
      if (a === "keyAdd") { L.keys.push({ kind: "notch", ang: L.keys.length ? (L.keys[L.keys.length - 1].ang + 72) % 360 : 0, w: L.shape === "circle" ? Math.max(0.8, r3(L.w * 0.1)) : 2 }); renderSide(); renderSvg(); h.changed(false); }
      else if (a === "keyDel") { L.keys.splice(+b.dataset.i, 1); renderSide(); renderSvg(); h.changed(false); }
      else if (a === "addRing") addPins(CD.ringPins(Math.max(1, Math.min(100, Math.round(g.ring.n))), g.ring.r, g.ring.a, g.ring.ccw, g.ring.d));
      else if (a === "addCtr") addPins([{ x: 0, y: 0, d: g.ctr.d }]);
      else if (a === "addGrid") addPins(CD.gridPins(Math.max(1, Math.round(g.grid.rows)), Math.max(1, Math.round(g.grid.cols)), g.grid.px, g.grid.py, g.grid.order, g.grid.d));
      else if (a === "selDel") removeSel();
      else if (a === "selNone") { sel.clear(); renderSvg(); renderSide(); }
      else if (a === "pinDel") { sel = new Set([+b.dataset.i]); removeSel(); }
      else if (a === "numRings") renumber(CD.sortPinOrder(L.pins, "rings"));
      else if (a === "numRows") renumber(CD.sortPinOrder(L.pins, "rows"));
      else if (a === "numList") renumber(L.pins.map((p, i) => i));
    }
    // Rotate the selection on Enter in the rotate field.
    document.addEventListener("keydown", e => {
      if (!cid || e.key !== "Enter" || !e.target.matches('[data-f="rot"]')) return;
      e.preventDefault();
      const a = num(e.target.value, 0) * Math.PI / 180, L = lay();
      if (!a) return;
      sel.forEach(i => { const p = L.pins[i]; const x = p.x * Math.cos(a) - p.y * Math.sin(a), y = p.x * Math.sin(a) + p.y * Math.cos(a); p.x = r3(x); p.y = r3(y); });
      renderSvg(); renderSide(); h.changed(false);
    });

    return { open };
  };
})();
