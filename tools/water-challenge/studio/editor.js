/* Pet Studio canvas: draws the pet with the page's own renderer over guides
   (waterline, headroom, grid, reference image) and handles the tools. */

import { drawShapes, tracePath, colourOf, fxSpot, medalSpot } from "../js/petdefs.js";
import { critterCrown, drawMedal, wearAt } from "../js/art.js";
import { TALLEST_PET_R, UNDERWATER_TINT, WALL_GAP_R, narrowCup } from "../js/config.js";
import * as G from "./geom.js";

const HANDLE = 5, PICK = 7, SNAP = 0.02;
const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const RANGE_HANDLE_Y = -1.75;              /* where the swim-range handles sit, in r */

export const TOOL_HINTS = {
  select: "Click to select, Shift-click to add, drag to move. Double-click a path to add a point or bend a corner; Alt-click a point to delete it.",
  ellipse: "Drag to draw. Shift for a circle, Alt to draw from the centre.",
  poly: "Click to add points. Click the first point or press Enter to close. Backspace removes the last point.",
  pen: "Click for a corner, drag for a curve. Click the first point to close and fill; Enter keeps it an open line.",
  free: "Drag to draw a stroke. Finish near the start to make a filled shape.",
  line: "Drag to draw a line. Shift snaps to 15 degrees.",
  eye: "Click to place an eye: a dot alive, an X when drowned."
};

function path2d(s, z) {
  const p = new Path2D();
  tracePath({ beginPath() { }, moveTo: (...a) => p.moveTo(...a), lineTo: (...a) => p.lineTo(...a),
              quadraticCurveTo: (...a) => p.quadraticCurveTo(...a), bezierCurveTo: (...a) => p.bezierCurveTo(...a),
              ellipse: (...a) => p.ellipse(...a), closePath: () => p.closePath() }, s, z);
  return p;
}

export class Editor {
  constructor(cv, app) {
    this.cv = cv; this.ctx = cv.getContext("2d"); this.app = app;
    this.layer = document.createElement("canvas"); this.lctx = this.layer.getContext("2d");
    this.hit = document.createElement("canvas").getContext("2d");
    this.view = { ox: 0, oy: 0, z: 150 };
    this.w = 0; this.h = 0; this.dpr = 1;
    this.drag = null; this.draft = null; this.mouse = null; this.space = false; this.queued = false;
    this.imgs = new Map();
    cv.addEventListener("pointerdown", e => this.down(e));
    cv.addEventListener("pointermove", e => this.move(e));
    cv.addEventListener("pointerup", e => this.up(e));
    cv.addEventListener("pointercancel", e => this.up(e));
    cv.addEventListener("dblclick", e => this.dbl(e));
    cv.addEventListener("wheel", e => this.wheel(e), { passive: false });
    cv.addEventListener("contextmenu", e => e.preventDefault());
    cv.addEventListener("pointerleave", () => { this.mouse = null; this.app.coords(null); this.redraw(); });
    new ResizeObserver(() => this.resize()).observe(cv.parentElement);
    this.resize();
  }

  /* ---- view ---------------------------------------------------------------- */
  resize() {
    const r = this.cv.parentElement.getBoundingClientRect(), first = !this.w;
    this.dpr = window.devicePixelRatio || 1;
    this.w = r.width; this.h = r.height;
    for (const c of [this.cv, this.layer]) { c.width = Math.round(r.width * this.dpr); c.height = Math.round(r.height * this.dpr); }
    if (first) this.fit(); else this.redraw();
  }
  fit() {
    const shapes = this.app.shapes || this.app.ghost || [];
    const b = G.bounds(shapes) || { x0: -1, y0: -1.4, x1: 1, y1: 0.6 };
    const x0 = Math.min(b.x0, -0.8), x1 = Math.max(b.x1, 0.8), y1 = Math.max(b.y1, 0.5);
    let y0 = this.app.pose === "swim" ? Math.min(b.y0, -TALLEST_PET_R - 0.1) : Math.min(b.y0, -1.2);   /* headroom in view */
    if (this.app.cupFrame) {                                                /* a cup item: the whole glass in view */
      const f = this.app.cupFrame, hb = G.bounds(shapes) || f;
      return this.fitBox(Math.min(hb.x0, f.x0) - 0.05, Math.min(hb.y0, f.y0) - 0.05, Math.max(hb.x1, f.x1) + 0.05, Math.max(hb.y1, f.y1) + 0.05);
    }
    if (this.app.isHat) {                                                   /* the hat, with some head under it */
      const hb = G.bounds(shapes) || { x0: -0.3, y0: -0.45, x1: 0.3, y1: 0 };
      return this.fitBox(Math.min(hb.x0, -0.45), Math.min(hb.y0, -0.5), Math.max(hb.x1, 0.45), Math.max(hb.y1, 0.35));
    }
    this.fitBox(x0, y0, x1, y1);
  }
  fitBox(x0, y0, x1, y1) {
    const z = Math.min(this.w / ((x1 - x0) * 1.35), this.h / ((y1 - y0) * 1.35));
    this.view.z = Math.max(20, Math.min(900, z));
    this.view.ox = this.w / 2 - (x0 + x1) / 2 * this.view.z;
    this.view.oy = this.h / 2 - (y0 + y1) / 2 * this.view.z;
    this.redraw();
  }
  toWorld(e) {
    const r = this.cv.getBoundingClientRect();
    return [(e.clientX - r.left - this.view.ox) / this.view.z, (e.clientY - r.top - this.view.oy) / this.view.z];
  }
  toScreen(x, y) { return [this.view.ox + x * this.view.z, this.view.oy + y * this.view.z]; }
  snapPt(p, e) {
    if (this.app.snap === !!(e && e.altKey)) return p;
    return [Math.round(p[0] / SNAP) * SNAP, Math.round(p[1] / SNAP) * SNAP];
  }
  wheel(e) {
    e.preventDefault();
    const r = this.cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, v = this.view;
    const k = Math.exp(-e.deltaY * 0.0015), z = Math.max(20, Math.min(1600, v.z * k));
    v.ox = mx - (mx - v.ox) * z / v.z; v.oy = my - (my - v.oy) * z / v.z; v.z = z;
    this.redraw();
  }
  redraw() {
    if (this.queued) return;
    this.queued = true;
    requestAnimationFrame(() => { this.queued = false; this.draw(); });
  }

  /* ---- picking -------------------------------------------------------------- */
  visible(s) { return this.app.dead ? s.show !== "alive" : s.show !== "dead"; }
  hitShape(s, x, y) {
    const z = this.view.z;
    if (s.t === "eye") return Math.hypot(x - s.x, y - s.y) < 0.13 * (s.s || 1) + 4 / z;
    const p = path2d(s, z), h = this.hit;
    if (s.fill && h.isPointInPath(p, x * z, y * z)) return true;
    h.lineWidth = Math.max(1, (s.stroke ? (s.w || 0.05) : 0) * z) + 8;
    return h.isPointInStroke(p, x * z, y * z);
  }
  pick(x, y) {
    const list = this.app.shapes || [];
    for (let i = list.length - 1; i >= 0; i--) if (this.visible(list[i]) && this.hitShape(list[i], x, y)) return i;
    return -1;
  }
  selected() { const l = this.app.shapes || []; return [...this.app.sel].sort((a, b) => a - b).map(i => l[i]).filter(Boolean); }

  handles() {
    const out = [], list = this.app.shapes || [], sel = this.selected();
    if (this.app.crown && this.app.def && this.app.pose === "swim") {
      const [x, y] = this.toScreen(this.app.def.crown[0], this.app.def.crown[1]);
      out.push({ type: "crown", x, y });
    }
    if (this.app.fx && this.app.def && this.app.pose === "swim") {
      const s = fxSpot(this.app.def), [x, y] = this.toScreen(s[0], s[1]);
      out.push({ type: "fx", x, y });
    }
    if (this.app.medal && this.app.def && this.app.pose === "swim") {
      const s = medalSpot(this.app.def), [x, y] = this.toScreen(s[0], s[1]);
      out.push({ type: "medal", x, y });
    }
    if (this.app.def && this.app.pose === "swim" && !this.app.isHat && this.app.tool === "select") {
      const lx = narrowCup().reachFor(this.app.range), [, y] = this.toScreen(0, RANGE_HANDLE_Y);
      for (const s of [-1, 1]) out.push({ type: "range", x: this.toScreen(s * lx, 0)[0], y });
    }
    if (!sel.length || this.app.tool !== "select") return out;
    const one = sel.length === 1 ? sel[0] : null;
    const b = G.bounds(sel);
    if (b) {
      const c = [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]].map(p => this.toScreen(...p));
      if (!(one && one.t === "ell")) c.forEach((p, i) => out.push({ type: "scale", corner: i, x: p[0], y: p[1] }));
      const [tx, ty] = this.toScreen((b.x0 + b.x1) / 2, b.y0);
      out.push({ type: "rot", x: tx, y: ty - 26, bx: tx, by: ty });
    }
    if (one && one.t === "ell") {
      const pr = this.toScreen(...G.ellPoint(one, 0)), pq = this.toScreen(...G.ellPoint(one, Math.PI / 2));
      out.push({ type: "rx", x: pr[0], y: pr[1] }, { type: "ry", x: pq[0], y: pq[1] });
    }
    if (one && one.t === "path" && G.anchorCount(one) <= 90) {       /* denser paths: Simplify first */
      for (const n of G.pathNodes(one)) {
        const c = one.d[n.ci], [x, y] = this.toScreen(c[n.xi], c[n.xi + 1]);
        out.push({ type: "node", node: n, x, y });
      }
    }
    return out;
  }
  handleAt(sx, sy) {
    const hs = this.handles();
    for (let i = hs.length - 1; i >= 0; i--) if (Math.hypot(hs[i].x - sx, hs[i].y - sy) <= PICK) return hs[i];
    return null;
  }

  /* ---- pointer ---------------------------------------------------------------- */
  screenOf(e) { const r = this.cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }

  down(e) {
    this.cv.setPointerCapture(e.pointerId);
    const w = this.toWorld(e), [sx, sy] = this.screenOf(e), app = this.app;
    if (e.button === 1 || e.button === 2 || this.space) {
      this.drag = { type: "pan", sx, sy, ox: this.view.ox, oy: this.view.oy };
      return;
    }
    if (e.button !== 0) return;
    const tool = app.tool;
    if (tool !== "select" && !app.shapes) { app.toast("This pet has no portrait yet. Make one first (above the canvas)."); return; }

    if (tool === "select") {
      const h = this.handleAt(sx, sy);
      if (h) return this.startHandle(h, w, e);
      if (app.refDrag && app.ref) { app.begin(); this.drag = { type: "ref", w, x: app.ref.x, y: app.ref.y }; return; }
      const i = this.pick(...w);
      if (i >= 0) {
        if (e.shiftKey) {
          if (app.sel.has(i)) { app.sel.delete(i); app.selChanged(); return; }
          app.sel.add(i);
        } else if (!app.sel.has(i)) { app.sel.clear(); app.sel.add(i); }
        app.selChanged();
        app.begin();
        this.drag = { type: "move", w, orig: this.cloneSel() };
        return;
      }
      if (!e.shiftKey) { app.sel.clear(); app.selChanged(); }
      this.drag = { type: "marquee", w, cur: w, add: e.shiftKey };
      return;
    }
    const p = this.snapPt(w, e);
    if (tool === "ellipse" || tool === "line") { this.drag = { type: tool, p0: p, p }; this.draftFrom(e); return; }
    if (tool === "free") { this.drag = { type: "free", pts: [w] }; this.draftFrom(e); return; }
    if (tool === "eye") { app.add({ t: "eye", x: G.R5(p[0]), y: G.R5(p[1]) }); return; }
    if (tool === "poly") {
      const d = this.draft && this.draft.kind === "poly" ? this.draft : (this.draft = { kind: "poly", pts: [] });
      if (d.pts.length >= 3 && this.nearFirst(d.pts[0], sx, sy)) { this.finishPoly(); return; }
      d.pts.push(p);
      this.redraw();
      return;
    }
    if (tool === "pen") {
      const d = this.draft && this.draft.kind === "pen" ? this.draft : (this.draft = { kind: "pen", nodes: [] });
      if (d.nodes.length >= 2 && this.nearFirst(d.nodes[0].p, sx, sy)) { this.finishPen(true); return; }
      d.nodes.push({ p, hin: p, hout: p });
      this.drag = { type: "pen" };
      this.redraw();
    }
  }

  nearFirst(p, sx, sy) { const [fx, fy] = this.toScreen(...p); return Math.hypot(fx - sx, fy - sy) <= 9; }

  cloneSel() { const l = this.app.shapes; return [...this.app.sel].map(i => [i, G.clone(l[i])]); }

  startHandle(h, w, e) {
    const app = this.app;
    app.begin();
    if (h.type === "crown") { this.drag = { type: "crown" }; return; }
    if (h.type === "fx") { this.drag = { type: "fx" }; return; }
    if (h.type === "medal") { this.drag = { type: "medal" }; return; }
    if (h.type === "range") { this.drag = { type: "range" }; return; }
    const sel = this.selected(), b = G.bounds(sel);
    if (h.type === "scale") {
      const cs = [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]];
      this.drag = { type: "scale", anchor: cs[(h.corner + 2) % 4], from: cs[h.corner], orig: this.cloneSel() };
    } else if (h.type === "rot") {
      const c = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
      this.drag = { type: "rot", c, a0: Math.atan2(w[1] - c[1], w[0] - c[0]), orig: this.cloneSel() };
    } else if (h.type === "rx" || h.type === "ry") {
      this.drag = { type: h.type, i: [...app.sel][0] };
    } else if (h.type === "node") {
      const i = [...app.sel][0], s = app.shapes[i];
      if (e.altKey && !h.node.ctl) {
        if (G.deleteAnchor(s, h.node.ci)) app.commit(); else app.cancel();
        return;
      }
      this.drag = { type: "node", i, node: h.node, w, orig: G.clone(s) };
    }
  }

  move(e) {
    const w = this.toWorld(e), [sx, sy] = this.screenOf(e), app = this.app, d = this.drag;
    this.mouse = w;
    app.coords(w);
    if (!d) {
      if (this.draft) this.redraw();
      else if (app.tool === "select") {
        const h = this.handleAt(sx, sy);
        this.cv.style.cursor = h ? (h.type === "rot" ? "grab" : h.type === "range" ? "ew-resize" : "pointer") : this.space ? "grab" : this.pick(...w) >= 0 ? "move" : "default";
        this.redraw();
      } else this.cv.style.cursor = "crosshair";
      return;
    }
    const list = app.shapes;
    if (d.type === "pan") { this.view.ox = d.ox + sx - d.sx; this.view.oy = d.oy + sy - d.sy; this.redraw(); return; }
    if (d.type === "move") {
      const [dx, dy] = this.snapPt([w[0] - d.w[0], w[1] - d.w[1]], e);
      for (const [i, s] of d.orig) list[i] = G.mapShape(s, G.translateM(dx, dy));
      app.live();
    } else if (d.type === "scale") {
      const [ax, ay] = d.anchor, p = this.snapPt(w, e);
      let kx = (p[0] - ax) / ((d.from[0] - ax) || 1e-9), ky = (p[1] - ay) / ((d.from[1] - ay) || 1e-9);
      if (e.shiftKey) { const k = Math.max(Math.abs(kx), Math.abs(ky)); kx = Math.sign(kx || 1) * k; ky = Math.sign(ky || 1) * k; }
      const M = G.scaleM(ax, ay, kx, ky);
      for (const [i, s] of d.orig) list[i] = G.mapShape(s, M);
      app.live();
    } else if (d.type === "rot") {
      let a = Math.atan2(w[1] - d.c[1], w[0] - d.c[0]) - d.a0;
      if (e.shiftKey) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
      const M = G.rotateM(d.c[0], d.c[1], a);
      for (const [i, s] of d.orig) list[i] = G.mapShape(s, M, false);
      app.live();
    } else if (d.type === "rx" || d.type === "ry") {
      const s = list[d.i], c = Math.cos(s.rot || 0), n = Math.sin(s.rot || 0);
      const vx = w[0] - s.x, vy = w[1] - s.y;
      const len = d.type === "rx" ? Math.abs(vx * c + vy * n) : Math.abs(-vx * n + vy * c);
      s[d.type] = G.R5(Math.max(0.005, app.snap !== e.altKey ? Math.round(len / SNAP) * SNAP : len));
      app.live();
    } else if (d.type === "node") {
      const s = list[d.i] = G.clone(d.orig), n = d.node;
      if (n.ctl) { const p = this.snapPt(w, e); s.d[n.ci][n.xi] = G.R5(p[0]); s.d[n.ci][n.xi + 1] = G.R5(p[1]); }
      else {
        const c = d.orig.d[n.ci], target = this.snapPt([c[n.xi] + w[0] - d.w[0], c[n.xi + 1] + w[1] - d.w[1]], e);
        G.moveAnchor(s, n.ci, target[0] - c[n.xi], target[1] - c[n.xi + 1]);
      }
      app.live();
    } else if (d.type === "range") {
      const cup = narrowCup(), v = (cup.half - WALL_GAP_R - Math.abs(w[0])) / cup.swim;
      app.def.range = Math.max(0, Math.min(1, Math.round(v * 20) / 20));      /* 5% steps */
      app.live();
    } else if (d.type === "crown") {
      const p = this.snapPt(w, e);
      app.def.crown = [G.R5(p[0]), G.R5(p[1])];
      app.live();
    } else if (d.type === "fx") {
      const p = this.snapPt(w, e);
      app.def.fx = [G.R5(p[0]), G.R5(p[1])];
      app.live();
    } else if (d.type === "medal") {
      const p = this.snapPt(w, e);
      app.def.medal = [G.R5(p[0]), G.R5(p[1])];
      app.live();
    } else if (d.type === "ref") {
      app.ref.x = G.R5(d.x + w[0] - d.w[0]); app.ref.y = G.R5(d.y + w[1] - d.w[1]);
      app.live();
    } else if (d.type === "marquee") { d.cur = w; this.redraw(); }
    else if (d.type === "ellipse" || d.type === "line") { d.p = this.snapPt(w, e); this.draftFrom(e); }
    else if (d.type === "free") {
      const last = d.pts[d.pts.length - 1];
      if (Math.hypot(w[0] - last[0], w[1] - last[1]) * this.view.z > 1.5) d.pts.push(w);
      this.draftFrom(e);
    } else if (d.type === "pen") {
      const nd = this.draft.nodes[this.draft.nodes.length - 1], p = this.snapPt(w, e);
      nd.hout = p; nd.hin = [2 * nd.p[0] - p[0], 2 * nd.p[1] - p[1]];
      this.redraw();
    }
  }

  up(e) {
    const d = this.drag, app = this.app;
    this.drag = null;
    if (!d) return;
    if (["move", "scale", "rot", "rx", "ry", "node", "crown", "fx", "medal", "ref", "range"].includes(d.type)) { app.commit(); return; }
    if (d.type === "marquee") {
      const x0 = Math.min(d.w[0], d.cur[0]), x1 = Math.max(d.w[0], d.cur[0]), y0 = Math.min(d.w[1], d.cur[1]), y1 = Math.max(d.w[1], d.cur[1]);
      if ((x1 - x0) * this.view.z > 3 || (y1 - y0) * this.view.z > 3) {
        (app.shapes || []).forEach((s, i) => {
          const b = G.bounds([s]);
          if (b && this.visible(s) && b.x1 >= x0 && b.x0 <= x1 && b.y1 >= y0 && b.y0 <= y1) app.sel.add(i);
        });
        app.selChanged();
      }
      this.redraw();
      return;
    }
    if (d.type === "ellipse" || d.type === "line" || d.type === "free") {
      const s = this.draft && this.draft.shape;
      this.draft = null;
      if (s && G.bounds([s]) && this.bigEnough(s)) {
        if (d.type === "free") app.add(this.finishFree(d.pts));
        else app.add(s);
      }
      this.redraw();
    }
  }

  bigEnough(s) { const b = G.bounds([s]); return Math.max(b.x1 - b.x0, b.y1 - b.y0) * this.view.z > 4; }

  dbl(e) {
    const app = this.app;
    if (app.tool === "pen" && this.draft) { this.finishPen(false); return; }
    if (app.tool === "poly" && this.draft) { this.finishPoly(); return; }
    if (app.tool !== "select" || app.sel.size !== 1) return;
    const i = [...app.sel][0], s = app.shapes[i];
    if (!s || s.t !== "path") return;
    const [sx, sy] = this.screenOf(e), w = this.toWorld(e);
    const h = this.handleAt(sx, sy);
    app.begin();
    if (h && h.type === "node" && !h.node.ctl) { if (G.toggleCurve(s, h.node.ci)) app.commit(); else app.cancel(); return; }
    const n = G.nearestOnPath(s, ...w);
    if (n && n.dist * this.view.z < 8 && n.t > 0.02 && n.t < 0.98 && G.splitAt(s, n.ci, n.t)) app.commit();
    else app.cancel();
  }

  /* ---- drawing tools -------------------------------------------------------- */
  draftFrom(e) {
    const d = this.drag, app = this.app;
    let s = null;
    if (d.type === "ellipse") {
      let [x0, y0] = d.p0, [x1, y1] = d.p;
      if (e.altKey) { x0 = 2 * d.p0[0] - d.p[0]; y0 = 2 * d.p0[1] - d.p[1]; }
      let rx = Math.abs(x1 - x0) / 2, ry = Math.abs(y1 - y0) / 2;
      if (e.shiftKey) rx = ry = Math.max(rx, ry);
      const cx = e.altKey ? d.p0[0] : (x0 + Math.sign(x1 - x0 || 1) * rx), cy = e.altKey ? d.p0[1] : (y0 + Math.sign(y1 - y0 || 1) * ry);
      s = { t: "ell", x: G.R5(cx), y: G.R5(cy), rx: G.R5(rx), ry: G.R5(ry), rot: 0, a0: 0, a1: G.TAU, fill: app.lastFill };
    } else if (d.type === "line") {
      let [x, y] = d.p;
      if (e.shiftKey) {
        const a = Math.round(Math.atan2(y - d.p0[1], x - d.p0[0]) / (Math.PI / 12)) * (Math.PI / 12), l = Math.hypot(x - d.p0[0], y - d.p0[1]);
        x = d.p0[0] + Math.cos(a) * l; y = d.p0[1] + Math.sin(a) * l;
      }
      s = { t: "path", d: [["M", G.R5(d.p0[0]), G.R5(d.p0[1])], ["L", G.R5(x), G.R5(y)]], stroke: app.lastStroke, w: app.brush, cap: "round" };
    } else if (d.type === "free") {
      s = { t: "path", d: d.pts.map((p, i) => [i ? "L" : "M", p[0], p[1]]), stroke: app.lastStroke, w: app.brush, cap: "round" };
    }
    this.draft = { kind: d.type, shape: s };
    this.redraw();
  }

  finishFree(pts) {
    const app = this.app, tol = Math.max(0.004, 1.2 / this.view.z);
    let simp = G.simplify(pts, tol);
    const closed = simp.length > 3 && Math.hypot(simp[0][0] - simp.at(-1)[0], simp[0][1] - simp.at(-1)[1]) < Math.max(0.06, 10 / this.view.z);
    if (closed) simp = simp.slice(0, -1);
    if (simp.length < 2) simp = [pts[0], pts.at(-1)];
    const d = G.smoothPath(simp, closed);
    return closed ? { t: "path", d, fill: app.lastFill } : { t: "path", d, stroke: app.lastStroke, w: app.brush, cap: "round" };
  }

  finishPoly() {
    const d = this.draft;
    this.draft = null;
    if (!d || d.pts.length < 2) { this.redraw(); return; }
    const closed = d.pts.length >= 3;
    const s = { t: "path", d: d.pts.map((p, i) => [i ? "L" : "M", G.R5(p[0]), G.R5(p[1])]) };
    if (closed) { s.d.push(["Z"]); s.fill = this.app.lastFill; }
    else { s.stroke = this.app.lastStroke; s.w = this.app.brush; s.cap = "round"; }
    this.app.add(s);
  }

  finishPen(closed) {
    const dr = this.draft;
    this.draft = null;
    if (!dr || dr.nodes.length < 2) { this.redraw(); return; }
    const n = dr.nodes, d = [["M", G.R5(n[0].p[0]), G.R5(n[0].p[1])]];
    const seg = (a, b) => {
      const straight = a.hout[0] === a.p[0] && a.hout[1] === a.p[1] && b.hin[0] === b.p[0] && b.hin[1] === b.p[1];
      d.push(straight ? ["L", G.R5(b.p[0]), G.R5(b.p[1])] : ["C", ...[...a.hout, ...b.hin, ...b.p].map(G.R5)]);
    };
    for (let i = 1; i < n.length; i++) seg(n[i - 1], n[i]);
    const s = { t: "path", d };
    if (closed) { seg(n[n.length - 1], n[0]); d.push(["Z"]); s.fill = this.app.lastFill; }
    else { s.stroke = this.app.lastStroke; s.w = this.app.brush; s.cap = "round"; }
    this.app.add(s);
  }

  /* Enter / Escape / Backspace while drawing. True when used. */
  key(e) {
    const d = this.draft;
    if (!d) return false;
    if (e.key === "Enter") { d.kind === "pen" ? this.finishPen(false) : this.finishPoly(); return true; }
    if (e.key === "Escape") { this.draft = null; this.redraw(); return true; }
    if (e.key === "Backspace") {
      if (d.kind === "poly") d.pts.pop(); else if (d.kind === "pen") d.nodes.pop();
      if ((d.pts || d.nodes || []).length === 0) this.draft = null;
      this.redraw();
      return true;
    }
    return false;
  }
  cancelDraft() { this.draft = null; this.drag = null; this.redraw(); }

  /* ---- rendering ---------------------------------------------------------------- */
  draw() {
    const { ctx, view: { ox, oy, z }, w: W, h: H, dpr, app } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = css("--canvas");
    ctx.fillRect(0, 0, W, H);

    /* grid */
    const step = z * 0.1 >= 9 ? 0.1 : z * 0.5 >= 9 ? 0.5 : 1;
    const gx0 = Math.floor(-ox / z / step) * step, gy0 = Math.floor(-oy / z / step) * step;
    ctx.lineWidth = 1;
    for (let x = gx0; x * z + ox < W; x += step) {
      const sx = Math.round(ox + x * z) + 0.5, major = Math.abs(x / 0.5 - Math.round(x / 0.5)) < 1e-6;
      ctx.strokeStyle = major ? css("--grid-2") : css("--grid");
      ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, H); ctx.stroke();
    }
    for (let y = gy0; y * z + oy < H; y += step) {
      const sy = Math.round(oy + y * z) + 0.5, major = Math.abs(y / 0.5 - Math.round(y / 0.5)) < 1e-6;
      ctx.strokeStyle = major ? css("--grid-2") : css("--grid");
      ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(W, sy); ctx.stroke();
    }
    ctx.strokeStyle = css("--grid-2"); ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(Math.round(ox) + 0.5, 0); ctx.lineTo(Math.round(ox) + 0.5, H); ctx.stroke();
    ctx.setLineDash([]);

    const hat = app.isHat, swimPose = app.pose === "swim" && !hat;
    if (app.water && swimPose) { ctx.fillStyle = css("--water"); ctx.fillRect(0, oy, W, H - oy); }

    /* reference image */
    const ref = app.ref;
    if (ref && ref.src) {
      let img = this.imgs.get(ref.src);
      if (!img) { img = new Image(); img.onload = () => this.redraw(); img.src = ref.src; this.imgs.set(ref.src, img); }
      if (img.complete && img.naturalWidth) {
        const wr = ref.w * z, hr = wr * img.naturalHeight / img.naturalWidth;
        ctx.globalAlpha = ref.op;
        ctx.drawImage(img, ox + ref.x * z - wr / 2, oy + ref.y * z - hr / 2, wr, hr);
        ctx.globalAlpha = 1;
      }
    }

    /* the pet, through the page's renderer */
    const L = this.lctx;
    L.setTransform(1, 0, 0, 1, 0, 0);
    L.clearRect(0, 0, this.layer.width, this.layer.height);
    L.setTransform(dpr, 0, 0, dpr, ox * dpr, oy * dpr);
    const def = app.def, shapes = app.shapes;
    if (def && hat && app.tryOn) {                       /* the pet it sits on, faint, crown spot at the origin */
      const t = app.tryOn.def;
      const at = app.tryOn.medal ? medalSpot(t) : t.crown;
      L.save(); L.globalAlpha = 0.28; L.translate(-at[0] * z, -at[1] * z);
      drawShapes(L, t.swim, z, app.hue, t.pal, false);
      L.restore();
    }
    if (def) {
      if (!shapes && app.ghost) { L.globalAlpha = 0.3; drawShapes(L, app.ghost, z, app.hue, def.pal, app.dead); L.globalAlpha = 1; }
      if (shapes) drawShapes(L, shapes, z, app.hue, def.pal, app.dead);
      if (this.draft && this.draft.shape) { L.globalAlpha = 0.75; drawShapes(L, [this.draft.shape], z, app.hue, def.pal, false); L.globalAlpha = 1; }
      if (app.medal && swimPose) { const s = medalSpot(def); wearAt(L, z * s[0], z * s[1], def.medalRot, () => drawMedal(L, 0, 0, z * (def.medalScale || 1))); }
      if (app.crown && swimPose) wearAt(L, z * def.crown[0], z * def.crown[1], def.crownRot, () => critterCrown(L, 0, 0, z * (def.crownScale || 1), false));   /* only the glass wears it */
      if (app.water && swimPose && UNDERWATER_TINT) {
        L.globalCompositeOperation = "source-atop"; L.globalAlpha = UNDERWATER_TINT;
        L.fillStyle = "#3d8fc4"; L.fillRect(-ox, 0, W, H);
        L.globalCompositeOperation = "source-over"; L.globalAlpha = 1;
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.layer, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    /* guides over the pet */
    ctx.font = "11px Segoe UI, system-ui, sans-serif";
    ctx.lineWidth = 1.5; ctx.strokeStyle = css("--waterline");
    if (hat && app.cupFrame) {                                     /* the inside of the glass */
      const f = app.cupFrame, [ax, ay] = this.toScreen(f.x0, f.y0), [bx, by] = this.toScreen(f.x1, f.y1);
      ctx.save(); ctx.setLineDash([6, 5]); ctx.strokeStyle = css("--waterline"); ctx.strokeRect(ax, ay, bx - ax, by - ay); ctx.restore();
    }
    if (hat) {
      ctx.beginPath(); ctx.moveTo(ox - 14, oy); ctx.lineTo(ox + 14, oy); ctx.moveTo(ox, oy - 14); ctx.lineTo(ox, oy + 14); ctx.stroke();
      ctx.fillStyle = css("--waterline"); ctx.fillText(app.origin, ox + 8, oy + 16);
    } else {
      ctx.beginPath(); ctx.moveTo(0, oy); ctx.lineTo(W, oy); ctx.stroke();
      ctx.fillStyle = css("--waterline"); ctx.fillText(swimPose ? "waterline" : "anchor", 8, oy - 5);
    }
    if (swimPose) {
      const hy = oy - TALLEST_PET_R * z;
      ctx.setLineDash([6, 5]); ctx.strokeStyle = css("--headroom"); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, hy); ctx.lineTo(W, hy); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = css("--headroom"); ctx.fillText("headroom: keep the pet below this line", 8, hy - 5);
    }
    if (swimPose) this.cupWalls(shapes || []);
    if (!app.isProp) this.forwardArrow(hat ? oy + 0.5 * z : swimPose ? oy + 0.22 * z : oy + 0.9 * z, hat);

    /* selection */
    const sel = this.selected();
    ctx.save();
    ctx.translate(ox, oy);
    for (const s of sel) {
      ctx.setLineDash(this.visible(s) ? [] : [4, 3]);
      ctx.strokeStyle = css("--sel"); ctx.lineWidth = 1.5;
      if (s.t === "eye") { ctx.beginPath(); ctx.arc(s.x * z, s.y * z, 0.13 * (s.s || 1) * z, 0, G.TAU); ctx.stroke(); }
      else { tracePath(ctx, s, z); ctx.stroke(); }
    }
    ctx.setLineDash([]);
    /* hover */
    if (app.tool === "select" && this.mouse && !this.drag) {
      const i = this.pick(...this.mouse), s = i >= 0 && !app.sel.has(i) ? app.shapes[i] : null;
      if (s && s.t !== "eye") { ctx.strokeStyle = css("--sel"); ctx.globalAlpha = 0.5; ctx.lineWidth = 1; tracePath(ctx, s, z); ctx.stroke(); ctx.globalAlpha = 1; }
    }
    ctx.restore();

    if (sel.length && app.tool === "select") {
      const b = G.bounds(sel);
      if (b && sel.length > 1) {
        const [x0, y0] = this.toScreen(b.x0, b.y0), [x1, y1] = this.toScreen(b.x1, b.y1);
        ctx.setLineDash([3, 3]); ctx.strokeStyle = css("--sel"); ctx.lineWidth = 1;
        ctx.strokeRect(x0, y0, x1 - x0, y1 - y0); ctx.setLineDash([]);
      }
    }
    /* path control lines */
    if (sel.length === 1 && sel[0].t === "path" && app.tool === "select") {
      const s = sel[0];
      ctx.strokeStyle = css("--sel"); ctx.globalAlpha = 0.55; ctx.lineWidth = 1;
      s.d.forEach((c, ci) => {
        const p = G.prevAnchor(s, ci);
        if (c[0] === "C" && p) {
          this.segLine(p, [c[1], c[2]]); this.segLine([c[3], c[4]], [c[5], c[6]]);
        } else if (c[0] === "Q" && p) { this.segLine(p, [c[1], c[2]]); this.segLine([c[1], c[2]], [c[3], c[4]]); }
      });
      ctx.globalAlpha = 1;
    }
    for (const h of this.handles()) {
      ctx.lineWidth = 1.5;
      ctx.fillStyle = h.type === "crown" ? "#f0b429" : h.type === "fx" ? "#ff6fa3" : h.type === "medal" ? "#f2c14e" : css("--handle");
      ctx.strokeStyle = css("--sel");
      ctx.beginPath();
      if (h.type === "rot") {
        ctx.moveTo(h.bx, h.by); ctx.lineTo(h.x, h.y); ctx.stroke();
        ctx.beginPath(); ctx.arc(h.x, h.y, HANDLE, 0, G.TAU);
      } else if (h.type === "node" && h.node.ctl) ctx.arc(h.x, h.y, HANDLE - 1.5, 0, G.TAU);
      else if (h.type === "node") ctx.rect(h.x - HANDLE + 1, h.y - HANDLE + 1, 2 * HANDLE - 2, 2 * HANDLE - 2);
      else if (h.type === "crown") { ctx.moveTo(h.x, h.y - 7); ctx.lineTo(h.x + 7, h.y); ctx.lineTo(h.x, h.y + 7); ctx.lineTo(h.x - 7, h.y); ctx.closePath(); }
      else if (h.type === "fx") {                       /* the spot, and roughly how far effects reach round it */
        ctx.save(); ctx.setLineDash([4, 4]); ctx.strokeStyle = "#ff6fa3"; ctx.beginPath(); ctx.arc(h.x, h.y, this.view.z * 0.9, 0, G.TAU); ctx.stroke(); ctx.restore();
        ctx.beginPath(); ctx.arc(h.x, h.y, 6, 0, G.TAU);
      }
      else if (h.type === "medal") {                    /* the disc, about the size the medal draws */
        ctx.arc(h.x, h.y, 6, 0, G.TAU);
      }
      else ctx.rect(h.x - HANDLE, h.y - HANDLE, 2 * HANDLE, 2 * HANDLE);
      ctx.fill(); ctx.stroke();
    }

    /* drafts and marquee */
    const d = this.draft;
    if (d && (d.kind === "poly" || d.kind === "pen")) {
      const pts = d.kind === "poly" ? d.pts : d.nodes.map(n => n.p);
      ctx.strokeStyle = css("--sel"); ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (d.kind === "pen") {
        const n = d.nodes;
        n.forEach((nd, i) => {
          const [x, y] = this.toScreen(...nd.p);
          if (!i) ctx.moveTo(x, y);
          else ctx.bezierCurveTo(...this.toScreen(...n[i - 1].hout), ...this.toScreen(...nd.hin), x, y);
        });
      } else pts.forEach((p, i) => { const [x, y] = this.toScreen(...p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      if (this.mouse && pts.length && !this.drag) ctx.lineTo(...this.toScreen(...this.mouse));
      ctx.stroke();
      ctx.fillStyle = css("--handle");
      pts.forEach((p, i) => { const [x, y] = this.toScreen(...p); ctx.beginPath(); ctx.arc(x, y, i ? 3.5 : 5, 0, G.TAU); ctx.fill(); ctx.stroke(); });
      if (d.kind === "pen") {
        const nd = d.nodes[d.nodes.length - 1];
        if (nd && (nd.hout[0] !== nd.p[0] || nd.hout[1] !== nd.p[1])) { ctx.globalAlpha = 0.6; this.segLine(nd.hin, nd.hout); ctx.globalAlpha = 1; }
      }
    }
    if (this.drag && this.drag.type === "marquee") {
      const [x0, y0] = this.toScreen(...this.drag.w), [x1, y1] = this.toScreen(...this.drag.cur);
      ctx.fillStyle = css("--accent-soft"); ctx.globalAlpha = 0.4; ctx.fillRect(x0, y0, x1 - x0, y1 - y0); ctx.globalAlpha = 1;
      ctx.strokeStyle = css("--sel"); ctx.lineWidth = 1; ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    }
  }
  /* The narrowest glass, centred on the pet: its walls (solid), and how far the drawing
     can reach and still swim the full range (dashed). Further out it swims less of
     the width; wider than the glass, it stays in the middle. Same rules as glass.js. */
  cupWalls(shapes) {
    const { ctx, view: { ox, oy, z }, h: H } = this, cup = narrowCup(), range = this.app.range;
    const half = cup.half, full = cup.reachFor(range), fit = half - WALL_GAP_R;
    const line = (x, dash, col) => {
      ctx.setLineDash(dash); ctx.strokeStyle = col;
      for (const s of [-1, 1]) { const sx = Math.round(ox + s * x * z) + 0.5; ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, H); ctx.stroke(); }
    };
    ctx.save();
    ctx.lineWidth = 1.5; ctx.globalAlpha = 0.8;
    line(half, [], css("--headroom"));
    ctx.lineWidth = 1; ctx.globalAlpha = 0.7;
    line(full, [5, 5], css("--accent"));
    ctx.globalAlpha = 1;
    ctx.font = "11px Segoe UI, system-ui, sans-serif"; ctx.textAlign = "left";
    ctx.fillStyle = css("--headroom"); ctx.fillText("cup wall", ox + half * z + 5, oy - TALLEST_PET_R * z + 16);
    ctx.fillStyle = css("--accent");
    ctx.fillText((range < 1 ? "swim range " + Math.round(range * 100) + "%" : "full swim") + " \u2194 drag", ox + full * z + 9, oy + RANGE_HANDLE_Y * z + 4);

    const vis = shapes.filter(s => s.show !== "dead");
    const b = G.bounds(vis);
    if (b) {
      const reach = Math.max(-b.x0, b.x1);
      const auto = Math.max(0, Math.min(1, (half - reach - WALL_GAP_R) / cup.swim)), share = Math.min(auto, range);
      const text = reach > fit ? "Reach " + reach.toFixed(2) + " r: wider than the narrowest glass, so it stays in the middle there"
                 : "Reach " + reach.toFixed(2) + " r: swims " + Math.round(share * 100) + "% of the normal range" +
                   (range < 1 && range <= auto ? " (set by the swim range)" : auto < 1 ? " (limited by its size)" : "");
      ctx.fillStyle = reach > fit ? css("--danger") : share < 1 ? css("--headroom") : css("--accent");
      ctx.font = "700 11.5px Segoe UI, system-ui, sans-serif";
      ctx.fillText(text, 10, H - 12);
      if (-b.y0 > TALLEST_PET_R) {
        ctx.fillStyle = css("--danger");
        ctx.fillText("Taller than the headroom line: the top is cut off in the glass", 10, H - 28);
      }
    }
    ctx.restore();
  }

  /* Pets are drawn facing left: that way is forward when they swim, and the glass
     mirrors the drawing when they turn. */
  forwardArrow(y, hat) {
    const { ctx, view: { ox, z } } = this, x0 = ox + 0.15 * z, x1 = ox - Math.min(0.9 * z, ox - 24), hh = 6;
    if (x0 - x1 < 30) return;
    ctx.save();
    ctx.strokeStyle = ctx.fillStyle = css("--accent");
    ctx.globalAlpha = 0.85; ctx.lineWidth = 2; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1 + hh, y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x1 + hh * 1.8, y - hh); ctx.lineTo(x1 + hh * 1.8, y + hh); ctx.closePath(); ctx.fill();
    ctx.font = "700 11px Segoe UI, system-ui, sans-serif"; ctx.textAlign = "left";
    ctx.fillText(hat ? "the pet faces this way" : "forward: the pet swims this way (mirrored when it turns)", x1, y + 16);
    ctx.restore();
  }

  segLine(a, b) {
    const ctx = this.ctx;
    ctx.beginPath(); ctx.moveTo(...this.toScreen(...a)); ctx.lineTo(...this.toScreen(...b)); ctx.stroke();
  }
}
