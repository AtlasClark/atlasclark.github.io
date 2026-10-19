/*
  Work Instructions — annotation editor
  Scope: one canvas that shows the current step's image and lets the user add,
  select, move, resize, restyle and delete annotations; crop; zoom and pan.
  Coordinates in step data are image pixels. The app owns the data and undo;
  the editor calls hooks before and after each change.
*/
(function () {
  "use strict";
  const WI = window.WI, D = WI.draw;

  const LV = [2, 3.5, 6, 10];      // stroke width × unit
  const TS = [14, 20, 28, 40];     // text size × unit
  const NR = [11, 15, 20, 28];     // callout radius × unit
  const clone = o => JSON.parse(JSON.stringify(o));
  const CURSOR = { nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize", p1: "move", p2: "move" };

  /*
    hooks: step(), bitmap(step), changed(step), pushUndo(step), dropUndo(),
           select(obj|null), zoom(scale), tool(name)
  */
  WI.createEditor = function (host, hooks) {
    const cv = document.createElement("canvas");
    const ctx = cv.getContext("2d");
    const ta = document.createElement("textarea");
    ta.className = "text-ed"; ta.hidden = true; ta.spellcheck = true;
    host.append(cv, ta);

    const st = { tool: "select", c: "#E5322D", lvl: 1, fill: false };
    const view = { s: 1, ox: 0, oy: 0, fit: true };
    let W = 0, H = 0, dpr = 1;
    let sel = null, hover = null, drag = null, textEdit = null, space = false;

    const cur = () => { const s = hooks.step(); const b = s && hooks.bitmap(s); return b ? { s, b, u: D.unitOf(b.width, b.height) } : null; };
    const full = b => ({ x: 0, y: 0, w: b.width, h: b.height });
    const region = (s, b) => (st.tool === "crop" || !s.crop) ? full(b) : s.crop;

    function fit() {
      const c = cur(); if (!c) return;
      const r = region(c.s, c.b), pad = 28;
      view.s = Math.min((W - pad * 2) / r.w, (H - pad * 2) / r.h, 2);
      if (!(view.s > 0)) view.s = 1;
      view.ox = (W - r.w * view.s) / 2; view.oy = (H - r.h * view.s) / 2;
      view.fit = true;
      hooks.zoom(view.s);
    }

    function toImg(e) {
      const c = cur(), rc = cv.getBoundingClientRect(), r = c ? region(c.s, c.b) : { x: 0, y: 0 };
      return { x: (e.clientX - rc.left - view.ox) / view.s + r.x, y: (e.clientY - rc.top - view.oy) / view.s + r.y };
    }
    function toScreen(x, y) {
      const c = cur(), r = c ? region(c.s, c.b) : { x: 0, y: 0 };
      return { x: view.ox + (x - r.x) * view.s, y: view.oy + (y - r.y) * view.s };
    }

    // ---------- paint ----------
    function handles(o) {
      if (D.RECTISH.has(o.t)) {
        const r = D.norm(o), x2 = r.x + r.w, y2 = r.y + r.h, mx = r.x + r.w / 2, my = r.y + r.h / 2;
        return { nw: [r.x, r.y], n: [mx, r.y], ne: [x2, r.y], e: [x2, my], se: [x2, y2], s: [mx, y2], sw: [r.x, y2], w: [r.x, my] };
      }
      if (o.t === "arrow" || o.t === "line") return { p1: [o.x1, o.y1], p2: [o.x2, o.y2] };
      return {};
    }
    function handleAt(o, p) {
      const tol = 7 / view.s;
      for (const [k, [x, y]] of Object.entries(handles(o))) if (Math.abs(p.x - x) <= tol && Math.abs(p.y - y) <= tol) return k;
      return null;
    }
    function topHit(s, p) {
      const tol = 5 / view.s;
      for (let i = s.anns.length - 1; i >= 0; i--) if (D.hit(s.anns[i], p.x, p.y, tol)) return s.anns[i];
      return null;
    }

    function box(o, color, dash) {
      const b = D.bounds(o), m = 4 / view.s;
      ctx.save();
      ctx.lineWidth = 1.25 / view.s; ctx.strokeStyle = color;
      ctx.setLineDash(dash ? [5 / view.s, 4 / view.s] : []);
      ctx.strokeRect(b.x - m, b.y - m, b.w + m * 2, b.h + m * 2);
      ctx.restore();
    }

    function paint() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cv.width, cv.height);
      const c = cur();
      host.classList.toggle("has-img", !!c);
      if (!c) return;
      const { s, b } = c, r = region(s, b), k = dpr * view.s;
      // frame shadow
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,.28)"; ctx.shadowBlur = 22; ctx.shadowOffsetY = 6;
      ctx.fillStyle = "#808080"; ctx.fillRect(view.ox, view.oy, r.w * view.s, r.h * view.s);
      ctx.restore();
      ctx.setTransform(k, 0, 0, k, dpr * (view.ox - r.x * view.s), dpr * (view.oy - r.y * view.s));
      const shown = textEdit ? Object.assign({}, s, { anns: s.anns.filter(o => o !== textEdit.o) }) : s;
      D.render(ctx, shown, b, r);

      if (st.tool === "crop") {
        const cr = drag && drag.kind === "crop" ? D.norm(drag.r) : s.crop;
        if (cr) {
          ctx.save();
          ctx.fillStyle = "rgba(0,0,0,.55)";
          ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.rect(cr.x, cr.y, cr.w, cr.h); ctx.fill("evenodd");
          ctx.lineWidth = 1.5 / view.s; ctx.strokeStyle = "#D0DD2B"; ctx.setLineDash([6 / view.s, 4 / view.s]);
          ctx.strokeRect(cr.x, cr.y, cr.w, cr.h);
          ctx.restore();
        }
        return;
      }
      if (hover && hover !== sel && s.anns.includes(hover)) box(hover, "rgba(208,221,43,.9)", true);
      if (sel && s.anns.includes(sel)) {
        box(sel, "#D0DD2B", false);
        const hs = 4.5 / view.s;
        ctx.save();
        ctx.lineWidth = 1.25 / view.s; ctx.strokeStyle = "#10110E"; ctx.fillStyle = "#D0DD2B";
        Object.values(handles(sel)).forEach(([x, y]) => { ctx.fillRect(x - hs, y - hs, hs * 2, hs * 2); ctx.strokeRect(x - hs, y - hs, hs * 2, hs * 2); });
        ctx.restore();
      }
    }

    function resize() {
      const rc = host.getBoundingClientRect();
      W = Math.max(1, rc.width); H = Math.max(1, rc.height); dpr = window.devicePixelRatio || 1;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      cv.style.width = W + "px"; cv.style.height = H + "px";
      if (view.fit) fit();
      paint();
    }
    new ResizeObserver(resize).observe(host);

    function setSel(o) {
      if (sel === o) return;
      sel = o; hooks.select(o);
    }

    // ---------- text editing ----------
    function placeText() {
      if (!textEdit) return;
      const o = textEdit.o, p = toScreen(o.x, o.y), pad = o.box ? o.size * 0.42 * view.s : 0;
      Object.assign(ta.style, {
        left: p.x + "px", top: p.y + "px", fontSize: (o.size * view.s) + "px",
        padding: pad + "px", color: o.box ? D.onColor(o.c) : o.c,
        background: o.box ? o.c : "rgba(0,0,0,.18)"
      });
      ta.style.height = "auto"; ta.style.width = "auto";
      ta.style.height = ta.scrollHeight + "px";
      ta.style.width = Math.max(60, ta.scrollWidth + 4) + "px";
    }
    function startText(s, o, isNew) {
      textEdit = { s, o, isNew, before: o.s };
      ta.value = o.s || "";
      ta.hidden = false;
      placeText();
      paint();
      ta.focus(); ta.select();
    }
    function commitText() {
      if (!textEdit) return;
      const { s, o, isNew, before } = textEdit;
      textEdit = null; ta.hidden = true;
      const val = ta.value.replace(/\s+$/, "");
      if (isNew) {
        if (val) { hooks.pushUndo(s); o.s = val; s.anns.push(o); setSel(o); hooks.changed(s); }
      } else if (val !== before) {
        hooks.pushUndo(s);
        if (val) o.s = val; else { s.anns.splice(s.anns.indexOf(o), 1); setSel(null); }
        hooks.changed(s);
      }
      paint();
    }
    ta.addEventListener("input", placeText);
    ta.addEventListener("blur", commitText);
    ta.addEventListener("keydown", e => {
      e.stopPropagation();
      if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) { e.preventDefault(); ta.blur(); }
    });

    // ---------- pointer ----------
    cv.addEventListener("pointerdown", e => {
      if (textEdit) { ta.blur(); return; }
      const c = cur(); if (!c) return;
      const { s, u } = c, p = toImg(e);
      if (e.button === 1 || (e.button === 0 && space)) {
        e.preventDefault();
        cv.setPointerCapture(e.pointerId);
        drag = { kind: "pan", sx: e.clientX, sy: e.clientY, ox: view.ox, oy: view.oy };
        cv.style.cursor = "grabbing";
        return;
      }
      if (e.button !== 0) return;
      cv.setPointerCapture(e.pointerId);

      if (st.tool === "crop") { drag = { kind: "crop", p0: p, r: { x: p.x, y: p.y, w: 0, h: 0 } }; return; }
      if (sel && s.anns.includes(sel)) {
        const h = handleAt(sel, p);
        if (h) { hooks.pushUndo(s); drag = { kind: "handle", h, o0: clone(sel), moved: false }; return; }
      }
      if (st.tool === "select") {
        const o = topHit(s, p);
        setSel(o);
        if (o) { hooks.pushUndo(s); drag = { kind: "move", o0: clone(o), p0: p, moved: false }; }
        paint();
        return;
      }
      if (st.tool === "text") {
        e.preventDefault();   // keep focus in the text box
        const o = topHit(s, p);
        if (o && o.t === "text") { setSel(o); startText(s, o, false); }
        else startText(s, { t: "text", x: p.x, y: p.y, s: "", c: st.c, size: Math.round(TS[st.lvl] * u), box: st.fill }, true);
        return;
      }
      hooks.pushUndo(s);
      const sw = +(LV[st.lvl] * u).toFixed(2);
      let o;
      if (st.tool === "arrow" || st.tool === "line") o = { t: st.tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y, c: st.c, sw };
      else if (st.tool === "rect" || st.tool === "ellipse") o = { t: st.tool, x: p.x, y: p.y, w: 0, h: 0, c: st.c, sw, fill: st.fill };
      else if (st.tool === "hl") o = { t: "hl", x: p.x, y: p.y, w: 0, h: 0, c: st.c };
      else if (st.tool === "blur" || st.tool === "spot") o = { t: st.tool, x: p.x, y: p.y, w: 0, h: 0 };
      else if (st.tool === "pen") o = { t: "pen", pts: [[p.x, p.y]], c: st.c, sw };
      else if (st.tool === "num") {
        const n = s.anns.reduce((m, a) => a.t === "num" ? Math.max(m, +a.n || 0) : m, 0) + 1;
        o = { t: "num", x: p.x, y: p.y, n, c: st.c, r: +(NR[st.lvl] * u).toFixed(2) };
        s.anns.push(o); setSel(o);
        drag = { kind: "move", o0: clone(o), p0: p, moved: true };
        hooks.changed(s); paint();
        return;
      } else { hooks.dropUndo(); return; }
      s.anns.push(o); setSel(o);
      drag = { kind: "create", o, p0: p };
      paint();
    });

    cv.addEventListener("pointermove", e => {
      const c = cur(); if (!c) return;
      const { s, b } = c, p = toImg(e);
      if (!drag) {
        let cursor = space ? "grab" : st.tool === "select" ? "default" : st.tool === "text" ? "text" : "crosshair";
        const h = sel && s.anns.includes(sel) && st.tool !== "crop" ? handleAt(sel, p) : null;
        let hv = null;
        if (h) cursor = CURSOR[h];
        else if (st.tool === "select" && !space) { hv = topHit(s, p); if (hv) cursor = "move"; }
        cv.style.cursor = cursor;
        if (hv !== hover) { hover = hv; paint(); }
        return;
      }
      if (drag.kind === "pan") {
        view.ox = drag.ox + (e.clientX - drag.sx); view.oy = drag.oy + (e.clientY - drag.sy);
        view.fit = false; paint(); return;
      }
      if (drag.kind === "crop") {
        const x = Math.max(0, Math.min(b.width, p.x)), y = Math.max(0, Math.min(b.height, p.y));
        drag.r = { x: drag.p0.x, y: drag.p0.y, w: x - drag.p0.x, h: y - drag.p0.y };
      } else if (drag.kind === "create") {
        const o = drag.o;
        if (o.t === "pen") {
          const l = o.pts[o.pts.length - 1];
          if (Math.hypot(p.x - l[0], p.y - l[1]) > 2 / view.s) o.pts.push([+p.x.toFixed(1), +p.y.toFixed(1)]);
        } else if ("x1" in o) {
          let x = p.x, y = p.y;
          if (e.shiftKey) {
            const a = Math.round(Math.atan2(y - o.y1, x - o.x1) / (Math.PI / 4)) * (Math.PI / 4), d = Math.hypot(x - o.x1, y - o.y1);
            x = o.x1 + Math.cos(a) * d; y = o.y1 + Math.sin(a) * d;
          }
          o.x2 = x; o.y2 = y;
        } else {
          let w = p.x - drag.p0.x, h = p.y - drag.p0.y;
          if (e.shiftKey) { const m = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * m; h = Math.sign(h || 1) * m; }
          o.w = w; o.h = h;
        }
      } else if (drag.kind === "move") {
        Object.assign(sel, clone(drag.o0));
        D.move(sel, p.x - drag.p0.x, p.y - drag.p0.y);
        drag.moved = true;
      } else if (drag.kind === "handle") {
        const o = sel, h = drag.h;
        if (h === "p1") { o.x1 = p.x; o.y1 = p.y; }
        else if (h === "p2") { o.x2 = p.x; o.y2 = p.y; }
        else {
          const r = D.norm(drag.o0);
          let x1 = r.x, y1 = r.y, x2 = r.x + r.w, y2 = r.y + r.h;
          if (h.includes("w")) x1 = p.x; if (h.includes("e")) x2 = p.x;
          if (h.includes("n")) y1 = p.y; if (h.includes("s")) y2 = p.y;
          Object.assign(o, { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) });
        }
        drag.moved = true;
      }
      paint();
    });

    function endDrag() {
      const d = drag; drag = null;
      const c = cur();
      if (!d || !c) { paint(); return; }
      const { s, b } = c;
      if (d.kind === "pan") { cv.style.cursor = space ? "grab" : ""; return; }
      if (d.kind === "create") {
        const o = d.o, bb = D.bounds(o);
        if (o.t !== "pen" && Math.max(bb.w, bb.h) < 4 / view.s) {
          s.anns.splice(s.anns.indexOf(o), 1); setSel(null); hooks.dropUndo();
        } else {
          if (D.RECTISH.has(o.t)) Object.assign(o, D.norm(o));
          hooks.changed(s);
        }
      } else if (d.kind === "move" || d.kind === "handle") {
        if (d.moved) hooks.changed(s); else hooks.dropUndo();
      } else if (d.kind === "crop") {
        const r = D.norm(d.r);
        if (r.w >= 8 && r.h >= 8) {
          hooks.pushUndo(s);
          s.crop = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(Math.min(r.w, b.width - r.x)), h: Math.round(Math.min(r.h, b.height - r.y)) };
          hooks.changed(s);
          setTool("select");
          return;
        }
      }
      paint();
    }
    cv.addEventListener("pointerup", endDrag);
    cv.addEventListener("pointercancel", endDrag);
    cv.addEventListener("pointerleave", () => { if (!drag && hover) { hover = null; paint(); } });
    cv.addEventListener("dblclick", e => {
      const c = cur(); if (!c || st.tool !== "select") return;
      const o = topHit(c.s, toImg(e));
      if (o && o.t === "text") { setSel(o); startText(c.s, o, false); }
    });
    cv.addEventListener("wheel", e => {
      e.preventDefault();
      const rc = cv.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - rc.left, e.clientY - rc.top);
    }, { passive: false });

    function zoomAt(f, sx, sy) {
      if (!cur()) return;
      const ns = Math.max(0.05, Math.min(16, view.s * f));
      view.ox = sx - (sx - view.ox) * (ns / view.s);
      view.oy = sy - (sy - view.oy) * (ns / view.s);
      view.s = ns; view.fit = false;
      hooks.zoom(view.s); placeText(); paint();
    }

    // ---------- commands ----------
    function setTool(t) {
      if (textEdit) ta.blur();
      const was = st.tool;
      st.tool = t;
      // A new tool starts fresh, so colour and size picks apply to new marks only.
      if (t !== "select") { hover = null; setSel(null); }
      if (was === "crop" || t === "crop") fit();
      hooks.tool(t);
      paint();
    }

    function setStyle(patch) {
      Object.assign(st, patch);
      const c = cur();
      if (!c || !sel || !c.s.anns.includes(sel) || sel.t === "blur" || sel.t === "spot") return;
      hooks.pushUndo(c.s);
      const o = sel;
      if ("c" in patch) o.c = patch.c;
      if ("lvl" in patch) {
        if (o.t === "text") o.size = Math.round(TS[st.lvl] * c.u);
        else if (o.t === "num") o.r = +(NR[st.lvl] * c.u).toFixed(2);
        else if ("sw" in o) o.sw = +(LV[st.lvl] * c.u).toFixed(2);
      }
      if ("fill" in patch) {
        if (o.t === "rect" || o.t === "ellipse") o.fill = patch.fill;
        if (o.t === "text") o.box = patch.fill;
      }
      hooks.changed(c.s); paint();
    }

    // Level and fill that match an object, so the toolbar can show them.
    function styleOf(o) {
      const c = cur(); if (!c || !o) return null;
      const near = (arr, v) => arr.reduce((bi, a, i) => Math.abs(a * c.u - v) < Math.abs(arr[bi] * c.u - v) ? i : bi, 0);
      const out = {};
      if (o.c) out.c = o.c;
      if (o.t === "text") { out.lvl = near(TS, o.size); out.fill = !!o.box; }
      else if (o.t === "num") out.lvl = near(NR, o.r);
      else if ("sw" in o) out.lvl = near(LV, o.sw);
      if (o.t === "rect" || o.t === "ellipse") out.fill = !!o.fill;
      return out;
    }

    function deleteSel() {
      const c = cur(); if (!c || !sel || !c.s.anns.includes(sel)) return false;
      hooks.pushUndo(c.s);
      c.s.anns.splice(c.s.anns.indexOf(sel), 1);
      setSel(null); hover = null;
      hooks.changed(c.s); paint();
      return true;
    }
    function nudge(dx, dy) {
      const c = cur(); if (!c || !sel || !c.s.anns.includes(sel)) return false;
      hooks.pushUndo(c.s); D.move(sel, dx, dy); hooks.changed(c.s); paint();
      return true;
    }
    function order(dir) {
      const c = cur(); if (!c || !sel) return;
      const a = c.s.anns, i = a.indexOf(sel); if (i < 0) return;
      hooks.pushUndo(c.s);
      a.splice(i, 1);
      if (dir > 0) a.push(sel); else a.unshift(sel);
      hooks.changed(c.s); paint();
    }
    function resetCrop() {
      const c = cur(); if (!c || !c.s.crop) return;
      hooks.pushUndo(c.s); c.s.crop = null; hooks.changed(c.s); fit(); paint();
    }

    return {
      paint, fit: () => { fit(); paint(); },
      refresh() { if (textEdit) ta.blur(); setSel(null); hover = null; drag = null; fit(); paint(); },
      setTool, tool: () => st.tool, setStyle, style: () => Object.assign({}, st), styleOf,
      adopt: patch => Object.assign(st, patch),
      deleteSel, nudge, order, resetCrop,
      zoomBy: f => zoomAt(f, W / 2, H / 2),
      zoomTo: s => zoomAt(s / view.s, W / 2, H / 2),
      selected: () => sel, clearSel() { setSel(null); paint(); },
      editingText: () => !!textEdit,
      setSpace(on) { space = on; if (!drag) cv.style.cursor = on ? "grab" : ""; }
    };
  };
})();
