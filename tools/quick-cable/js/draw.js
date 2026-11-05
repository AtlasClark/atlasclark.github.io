/*
  Quick Cable — drawing model and scene
  Scope: project data (connector ends with images, one cable with 2 to 6
  ends, length dimensions, text / callout / balloon labels, notes, title
  block fields) and the scene: drawing primitives in points for one sheet.
  Frame, title block, revision block and tables follow the Cable Designer
  format (copied here; the tools do not share code).
*/
(function (root) {
  "use strict";
  const QC = root.QC = root.QC || {};
  const INK = "#111111", DIM = "#5A5A5A", FAINT = "#9A9A9A", HEAD = "#ECECEC", PAPER = "#FFFFFF";
  const FONT = "Arial, Helvetica, sans-serif";
  const FORMAT = "atlas-quick-cable";
  const MAX_ENDS = 6;

  const SHEETS = {
    A: { w: 792, h: 612, name: "ANSI A (11 × 8.5 in)" },
    Legal: { w: 1008, h: 612, name: "Legal (14 × 8.5 in)", tb: "LEGAL" },
    B: { w: 1224, h: 792, name: "ANSI B (17 × 11 in)" },
    C: { w: 1584, h: 1224, name: "ANSI C (22 × 17 in)" },
    D: { w: 2448, h: 1584, name: "ANSI D (34 × 22 in)" },
    A4: { w: 841.89, h: 595.28, name: "ISO A4 (297 × 210 mm)" },
    A3: { w: 1190.55, h: 841.89, name: "ISO A3 (420 × 297 mm)" },
    A2: { w: 1683.78, h: 1190.55, name: "ISO A2 (594 × 420 mm)" }
  };
  const SIZE_PT = { s: 6, m: 7.5, l: 10 };
  const CALLOUT_PRESETS = ["HEAT-SHRINK LABEL", "WIRE LABEL", "P/N: EX-0000", "SLEEVING", "CABLE TIE", "STRAIN RELIEF"];

  // ---------- helpers ----------
  const str = v => v == null ? "" : String(v);
  const num = v => { const n = parseFloat(str(v).replace(",", ".")); return isFinite(n) ? n : null; };
  const uid = () => Math.random().toString(36).slice(2, 9);
  const nextLetter = ends => { for (let i = 0; i < 26; i++) { const L = String.fromCharCode(65 + i); if (!ends.some(e => e.letter === L)) return L; } return "?"; };

  function blank() {
    return {
      format: FORMAT, v: 1,
      meta: {
        size: "B", title: "", dwgNo: "", rev: "", company: "", scale: "NTS", units: "in", tol: "", ws: "", notice: "",
        drawn: "", drawnDate: "", checked: "", checkedDate: "", approved: "", approvedDate: "",
        footer: true, revBlock: true, details: true, tags: true, showUnit: false
      },
      cable: { style: "tube", w: 7, brk: false, boot: false, bootL: 36 },
      ends: [], hub: null, dims: [], labels: [], notes: [], notesPos: null, history: []
    };
  }
  function newEnd(ends, o) {
    return Object.assign({ id: uid(), letter: nextLetter(ends), name: "", type: "", img: null, rot: 0, flip: false, k: 1, dk: 1, pos: null, dpos: null }, o);
  }
  const pt = v => v && isFinite(v.x) && isFinite(v.y) ? { x: +v.x, y: +v.y } : null;
  const pref = v => v && typeof v.at === "string" ? { at: v.at } : pt(v);
  // Clean any loaded project into the current shape (unknown fields dropped).
  function normalize(d) {
    const p = blank();
    if (!d || typeof d !== "object") return p;
    Object.keys(p.meta).forEach(k => { if (d.meta && d.meta[k] != null) p.meta[k] = typeof p.meta[k] === "boolean" ? !!d.meta[k] : str(d.meta[k]); });
    if (!SHEETS[p.meta.size]) p.meta.size = "B";
    if (p.meta.units !== "mm") p.meta.units = "in";
    if (d.cable) {
      p.cable.style = d.cable.style === "line" ? "line" : "tube";
      p.cable.w = Math.max(2, Math.min(24, num(d.cable.w) || 7));
      p.cable.brk = !!d.cable.brk;
      p.cable.boot = !!d.cable.boot;
      p.cable.bootL = Math.max(16, Math.min(120, num(d.cable.bootL) || 36));
    }
    (Array.isArray(d.ends) ? d.ends : []).slice(0, MAX_ENDS).forEach(e => {
      p.ends.push(newEnd(p.ends, {
        id: str(e.id) || uid(), letter: str(e.letter).slice(0, 2) || nextLetter(p.ends), name: str(e.name), type: str(e.type),
        img: e.img ? str(e.img) : null, rot: [0, 90, 180, 270].includes(+e.rot) ? +e.rot : 0, flip: !!e.flip,
        k: Math.max(0.3, Math.min(4, num(e.k) || 1)), dk: Math.max(0.3, Math.min(4, num(e.dk) || 1)), pos: pt(e.pos), dpos: pt(e.dpos)
      }));
    });
    p.hub = pt(d.hub);
    (Array.isArray(d.dims) ? d.dims : []).forEach(m => {
      const a = pref(m.a), b = pref(m.b);
      if (a && b) p.dims.push({ id: str(m.id) || uid(), a, b, dir: ["h", "v", "a"].includes(m.dir) ? m.dir : "h", off: num(m.off) || 0, val: str(m.val), tol: str(m.tol), ref: !!m.ref });
    });
    (Array.isArray(d.labels) ? d.labels : []).forEach(l => {
      if (!["text", "callout", "balloon"].includes(l.kind) || !isFinite(l.x) || !isFinite(l.y)) return;
      p.labels.push({ id: str(l.id) || uid(), kind: l.kind, text: str(l.text), x: +l.x, y: +l.y,
        lx: isFinite(l.lx) && l.lx !== null ? +l.lx : null, ly: isFinite(l.ly) && l.ly !== null ? +l.ly : null,
        size: SIZE_PT[l.size] ? l.size : "m", bold: !!l.bold, box: l.box !== false && l.kind !== "text" ? true : !!l.box });
    });
    (Array.isArray(d.notes) ? d.notes : []).forEach(n => p.notes.push({ text: str(n && n.text != null ? n.text : n) }));
    p.notesPos = pt(d.notesPos);
    (Array.isArray(d.history) ? d.history : []).forEach(r => p.history.push({ rev: str(r.rev), eco: str(r.eco), desc: str(r.desc), date: str(r.date), by: str(r.by) }));
    return p;
  }

  // ---------- text metrics ----------
  let mctx = null;
  function tw(s, size, bold) {
    s = str(s);
    if (!mctx && typeof document !== "undefined") mctx = document.createElement("canvas").getContext("2d");
    if (!mctx) return s.length * size * 0.56;
    mctx.font = (bold ? "bold " : "") + size + "px " + FONT;
    return mctx.measureText(s).width;
  }
  function wrap(s, width, size, bold) {
    const out = [];
    str(s).split(/\r?\n/).forEach(par => {
      const words = par.split(/\s+/).filter(Boolean);
      if (!words.length) { out.push(""); return; }
      let line = "";
      words.forEach(w => {
        const t = line ? line + " " + w : w;
        if (tw(t, size, bold) <= width || !line) line = t;
        else { out.push(line); line = w; }
        while (tw(line, size, bold) > width && line.length > 1) {
          let k = line.length - 1;
          while (k > 1 && tw(line.slice(0, k), size, bold) > width) k--;
          out.push(line.slice(0, k)); line = line.slice(k);
        }
      });
      out.push(line);
    });
    return out;
  }

  // ---------- primitive pen ----------
  function Pen() { this.groups = []; this.g = null; }
  Pen.prototype = {
    begin(id, kind) { this.g = { id, kind, prims: [], box: null }; this.groups.push(this.g); return this.g; },
    push(o) { this.g.prims.push(o); return o; },
    line(x1, y1, x2, y2, o) { return this.push(Object.assign({ t: "line", x1, y1, x2, y2, s: INK, lw: 0.6 }, o)); },
    poly(pts, o) { return this.push(Object.assign({ t: "poly", pts, s: INK, lw: 0.6, f: null, close: false }, o)); },
    rect(x, y, w, h, o) { return this.push(Object.assign({ t: "rect", x, y, w, h, s: INK, lw: 0.6, f: null, r: 0 }, o)); },
    circle(cx, cy, r, o) { return this.push(Object.assign({ t: "circle", cx, cy, r, s: INK, lw: 0.6, f: null }, o)); },
    text(x, y, s, o) { return this.push(Object.assign({ t: "text", x, y, s: str(s), size: 6.5, bold: false, anchor: "start", c: INK }, o)); },
    img(key, src, x, y, w, h) { return this.push({ t: "img", key, src, x, y, w, h }); }
  };
  function arrow(pen, x, y, ang, size) {
    size = size || 5;
    const a1 = ang + Math.PI - 0.36, a2 = ang + Math.PI + 0.36;
    pen.poly([x, y, x + Math.cos(a1) * size, y + Math.sin(a1) * size, x + Math.cos(a2) * size, y + Math.sin(a2) * size], { s: null, f: INK, close: true });
  }

  // ---------- table (Cable Designer format) ----------
  function table(pen, x, y, title, cols, rows, opt) {
    opt = opt || {};
    const f = opt.f || 1, S = 5.8 * f, HS = 5.2 * f, LH = S + 1.6 * f, PADX = 3 * f;
    const ax = (c, cx, w) => c.align === "center" ? cx + w / 2 : cx + PADX;
    const an = c => c.align === "center" ? "middle" : "start";
    const widths = cols.map((c, i) => {
      let w = tw(c.h.toUpperCase(), HS, true);
      rows.forEach(r => { w = Math.max(w, tw(r[i], S)); });
      return Math.max((c.min || 14) * f, Math.min((c.max || 120) * f, w + PADX * 2));
    });
    const W = widths.reduce((a, b) => a + b, 0);
    const cells = rows.map(r => r.map((v, i) => wrap(v, widths[i] - PADX * 2, S)));
    const rh = cells.map(r => Math.max(1, ...r.map(l => l.length)) * LH + 3 * f);
    const TH = title ? 11 * f : 0, HH = 10 * f;
    const H = TH + HH + rh.reduce((a, b) => a + b, 0);
    pen.rect(x, y, W, H, { f: PAPER, lw: 0.8 });
    let cy = y;
    if (title) {
      pen.text(x + W / 2, cy + 8 * f, title, { size: 7 * f, bold: true, anchor: "middle" });
      cy += TH; pen.line(x, cy, x + W, cy, { lw: 0.6 });
    }
    pen.rect(x, cy, W, HH, { s: null, f: HEAD });
    let cx = x;
    cols.forEach((c, i) => { pen.text(ax(c, cx, widths[i]), cy + 7 * f, c.h.toUpperCase(), { size: HS, bold: true, anchor: an(c) }); cx += widths[i]; });
    cy += HH; pen.line(x, cy, x + W, cy, { lw: 0.6 });
    cells.forEach((r, ri) => {
      cx = x;
      r.forEach((lines, i) => {
        lines.forEach((l, k) => pen.text(ax(cols[i], cx, widths[i]), cy + 2 * f + S + k * LH, l, { size: S, anchor: an(cols[i]) }));
        cx += widths[i];
      });
      cy += rh[ri];
      if (ri < cells.length - 1) pen.line(x, cy, x + W, cy, { lw: 0.3, s: FAINT });
    });
    cx = x;
    widths.slice(0, -1).forEach(w => { cx += w; pen.line(cx, y + TH, cx, y + H, { lw: 0.4 }); });
    return { w: W, h: H };
  }

  // ---------- frame, title block, revisions (Cable Designer format) ----------
  function frame(pen, W, H) {
    const m = W > 1300 ? 24 : 18, z = 10;
    pen.rect(m, m, W - 2 * m, H - 2 * m, { lw: 1.2 });
    pen.rect(m + z, m + z, W - 2 * (m + z), H - 2 * (m + z), { lw: 0.9 });
    const iw = W - 2 * (m + z), ih = H - 2 * (m + z);
    const cols = Math.max(4, Math.round(iw / 180)), rows = Math.max(3, Math.round(ih / 180));
    for (let i = 0; i < cols; i++) {
      const x = m + z + iw * (i + 0.5) / cols;
      [m + z / 2 + 2.3, H - m - z / 2 + 2.3].forEach(y => pen.text(x, y, String(i + 1), { size: 6.5, anchor: "middle", c: DIM }));
      if (i) { const xx = m + z + iw * i / cols; pen.line(xx, m, xx, m + z, { lw: 0.5 }); pen.line(xx, H - m - z, xx, H - m, { lw: 0.5 }); }
    }
    for (let i = 0; i < rows; i++) {
      const y = m + z + ih * (i + 0.5) / rows + 2.3;
      [m + z / 2, W - m - z / 2].forEach(x => pen.text(x, y, String.fromCharCode(65 + i), { size: 6.5, anchor: "middle", c: DIM }));
      if (i) { const yy = m + z + ih * i / rows; pen.line(m, yy, m + z, yy, { lw: 0.5 }); pen.line(W - m - z, yy, W - m, yy, { lw: 0.5 }); }
    }
    return { L: m + z, T: m + z, R: W - m - z, B: H - m - z };
  }
  const TBW = 380;
  function cell(pen, x, y, w, h, label, value, o) {
    o = o || {};
    pen.rect(x, y, w, h, { lw: 0.6 });
    if (label) pen.text(x + 2.5, y + 5.6, label, { size: 4.6, c: DIM });
    if (value != null && value !== "") {
      let size = o.size || 7.5;
      if (o.fit) while (size > 5 && tw(value, size, o.bold) > w - 5) size -= 0.5;
      const lines = o.wrap ? wrap(value, w - 6, size, o.bold).slice(0, o.wrap) : [str(value)];
      const top = label ? y + 6 : y, span = (y + h) - top, lh = size * 1.15;
      const by = top + (span - lines.length * lh) / 2 + size * 0.86;
      lines.forEach((l, i) => pen.text(o.center ? x + w / 2 : x + 4, by + i * lh, l, { size, bold: !!o.bold, anchor: o.center ? "middle" : "start", c: o.c || INK }));
    }
  }
  function titleBlock(pen, p, R, B, logo) {
    const m = p.meta, x = R - TBW, H = 94, y = B - H;
    pen.rect(x, y, TBW, H, { f: PAPER, lw: 1 });
    const lx = x, cw = [46, 70, 54];
    cell(pen, lx, y, cw[0], 10, "", ""); cell(pen, lx + cw[0], y, cw[1], 10, "NAME", ""); cell(pen, lx + cw[0] + cw[1], y, cw[2], 10, "DATE", "");
    [["DRAWN", m.drawn, m.drawnDate], ["CHECKED", m.checked, m.checkedDate], ["APPROVED", m.approved, m.approvedDate]].forEach((r, i) => {
      const ry = y + 10 + i * 14;
      cell(pen, lx, ry, cw[0], 14, "", r[0], { size: 5.6, bold: true });
      cell(pen, lx + cw[0], ry, cw[1], 14, "", r[1], { size: 6.5 });
      cell(pen, lx + cw[0] + cw[1], ry, cw[2], 14, "", r[2], { size: 6.5 });
    });
    const units = m.units === "mm" ? "MILLIMETRES" : "INCHES";
    const t = num(m.tol);
    const tol = t != null ? "LENGTH TOLERANCE ±" + Math.abs(t).toFixed(m.units === "mm" ? (t % 1 ? 1 : 0) : 2) : "LENGTH TOLERANCE: NOT SET";
    pen.rect(lx, y + 52, 170, 26, { lw: 0.6 });
    pen.text(lx + 4, y + 59.5, "UNLESS OTHERWISE SPECIFIED:", { size: 5.2, c: DIM });
    pen.text(lx + 4, y + 67, "DIMENSIONS ARE IN " + units, { size: 5.6, bold: true });
    pen.text(lx + 4, y + 74.5, tol, { size: 5.6, bold: true, c: t != null ? INK : "#B8402F" });
    cell(pen, lx, y + 78, 170, 16, "", m.ws ? "WORKMANSHIP: IPC/WHMA-A-620, CLASS " + m.ws : "WORKMANSHIP: NOT SET", { size: 5.6, bold: true, c: m.ws ? INK : "#B8402F" });
    // No built-in branding: the logo is a file the user loads into their own browser.
    const rx = x + 170, rw = TBW - 170;
    pen.rect(rx, y, rw, 26, { lw: 0.6 });
    if (logo && logo.data) {
      const k = Math.min((rw - 20) / logo.w, 18 / logo.h), lw = logo.w * k, lh = logo.h * k;
      pen.img("logo", logo.data, rx + (rw - lw) / 2, y + (26 - lh) / 2, lw, lh);
    } else if (m.company) pen.text(rx + rw / 2, y + 16.5, m.company, { size: 9, bold: true, anchor: "middle" });
    cell(pen, rx, y + 26, rw, 32, "TITLE", m.title || "", { size: 8.5, bold: true, wrap: 2 });
    cell(pen, rx, y + 58, 34, 22, "SIZE", (SHEETS[m.size] && SHEETS[m.size].tb) || m.size, { size: 9, bold: true, center: true, fit: true });
    cell(pen, rx + 34, y + 58, rw - 34 - 36, 22, "DWG NO.", m.dwgNo, { size: 9, bold: true });
    cell(pen, rx + rw - 36, y + 58, 36, 22, "REV", m.rev, { size: 9, bold: true, center: true });
    cell(pen, rx, y + 80, 80, 14, "SCALE", m.scale, { size: 6.5 });
    cell(pen, rx + 80, y + 80, rw - 80, 14, "SHEET", "1 OF 1", { size: 6.5 });
    let top = y;
    if (m.notice) {
      const lines = wrap(m.notice, TBW - 8, 5.2), nh = lines.length * 6.4 + 5;
      top = y - nh;
      pen.rect(x, top, TBW, nh, { f: PAPER, lw: 0.8 });
      lines.forEach((l, i) => pen.text(x + 4, top + 7.5 + i * 6.4, l, { size: 5.2, c: DIM }));
    }
    return { x, y: top, w: TBW, h: B - top };
  }
  function revBlock(pen, p, R, T) {
    const cols = [{ h: "Rev", min: 28, max: 28 }, { h: "ECO", min: 50, max: 50 }, { h: "Description", min: 172, max: 172 }, { h: "Date", min: 58, max: 58 }, { h: "By", min: 72, max: 72 }];
    const rows = p.history.length ? p.history.map(r => [r.rev, r.eco, r.desc, r.date, r.by]) : [["", "", "", "", ""]];
    return Object.assign({ x: R - TBW, y: T }, table(pen, R - TBW, T, "REVISIONS", cols, rows, {}));
  }

  // ---------- notes ----------
  const NOTES_W = 300;
  function notesLines(p) {
    const lines = [];
    p.notes.forEach((n, i) => wrap(n.text || " ", NOTES_W - 22, 6.6).forEach((l, k) => lines.push({ n: k ? "" : (i + 1) + ".", l })));
    return lines;
  }
  const notesHeight = p => notesLines(p).length * 8.6 + 16;

  // ---------- connector pictures ----------
  // pics: endId -> {key, data, w, h} (already rotated / flipped).
  function picSize(e, pic, bw, bh) {
    if (!pic) return { w: bw * 0.72, h: bh * 0.7 };
    const k = Math.min(bw / pic.w, bh / pic.h);
    return { w: pic.w * k, h: pic.h * k };
  }
  const endSize = (e, pic, R) => picSize(e, pic, R.picW * e.k, R.picH * e.k);

  // ---------- regions ----------
  function regions(p, pics) {
    const m = p.meta, S = SHEETS[m.size] || SHEETS.B;
    const W = S.w, H = S.h, mm = W > 1300 ? 24 : 18, z = 10;
    const fr = { L: mm + z, T: mm + z, R: W - mm - z, B: H - mm - z };
    let tbTop = fr.B, tbX = fr.R;
    if (m.footer) { tbTop = fr.B - 94; tbX = fr.R - TBW; if (m.notice) tbTop -= wrap(m.notice, TBW - 8, 5.2).length * 6.4 + 5; }
    // details band: bottom left (beside the title block)
    const n = p.ends.length;
    const det = { on: !!(m.details && n), slots: [] };
    if (det.on) {
      const x0 = fr.L + 14, x1 = (m.footer ? tbX : fr.R) - 14, gap = 22;
      const maxK = Math.max(...p.ends.map(e => e.dk));
      const DW = W * 0.13, DH = H * 0.14;
      const slotW = Math.min((DW + 30) * maxK, (x1 - x0 - gap * (n - 1)) / n);
      const capH = 22, boxH = DH * maxK;
      det.top = fr.B - 12 - capH - boxH;
      det.boxH = boxH; det.capH = capH;
      p.ends.forEach((e, i) => {
        const bw = Math.min(slotW - 8, DW * e.dk), bh = DH * e.dk, sz = picSize(e, pics[e.id], bw, bh);
        const auto = { x: x0 + slotW / 2 + i * (slotW + gap), y: det.top + (boxH - sz.h) };
        const at = e.dpos || auto;
        det.slots.push({ id: e.id, cx: at.x, top: at.y, w: sz.w, h: sz.h, capW: Math.max(slotW, sz.w + 10) });
      });
    }
    // cable area: between the top band (notes, revisions) and the details
    let top = fr.T + 16;
    if (m.revBlock) top = Math.max(top, fr.T + 30 + Math.max(1, p.history.length) * 9.6 + 12);
    if (p.notes.length && !p.notesPos) top = Math.max(top, fr.T + 12 + notesHeight(p) + 14);
    let bottom = det.on ? det.top - 26 : (m.footer ? tbTop : fr.B) - 16;
    if (bottom - top < 120) top = Math.max(fr.T + 16, bottom - 120);
    const area = { x0: fr.L + 24, y0: top, x1: fr.R - 24, y1: bottom };
    return { W, H, fr, det, area, tbTop, picW: W * 0.11, picH: W * 0.075 };
  }

  // ---------- cable layout ----------
  const LEAD = 36;
  function layout(p, pics, R) {
    const ends = p.ends, n = ends.length, A = R.area, cy = (A.y0 + A.y1) / 2;
    const L = { ends: {}, hub: null, paths: [], n };
    if (!n) return L;
    const sz = ends.map(e => endSize(e, pics[e.id], R));
    const auto = [];
    auto[0] = { x: A.x0 + 18 + sz[0].w, y: cy };
    let hub = null;
    if (n === 2) auto[1] = { x: A.x1 - 18 - sz[1].w, y: cy };
    else if (n > 2) {
      const right = Math.min(...sz.slice(1).map((s, i) => A.x1 - 18 - s.w));
      hub = { x: Math.max(auto[0].x + 70, auto[0].x + (right - auto[0].x) * 0.48), y: cy };
      const m = n - 1, maxH = Math.max(...sz.slice(1).map(s => s.h));
      const room = A.y1 - A.y0 - maxH - 10;
      const gap = m > 1 ? Math.min(Math.max(maxH + 22, 80), room / (m - 1)) : 0;
      for (let i = 1; i < n; i++) auto[i] = { x: A.x1 - 18 - sz[i].w, y: cy + (i - 1 - (m - 1) / 2) * gap };
    }
    const exits = ends.map((e, i) => e.pos || auto[i]);
    if (n > 2) hub = p.hub || hub;
    else if (n === 2) hub = { x: (exits[0].x + exits[1].x) / 2, y: (exits[0].y + exits[1].y) / 2 };
    L.hub = n > 2 ? hub : null;
    ends.forEach((e, i) => {
      const x = exits[i], s = sz[i];
      // face: +1 = cable leaves to the right (picture on the left)
      const f = hub ? (i === 0 ? (x.x <= hub.x ? 1 : -1) : (x.x >= hub.x ? -1 : 1)) : 1;
      const box = { x: f > 0 ? x.x - s.w : x.x, y: x.y - s.h / 2, w: s.w, h: s.h };
      L.ends[e.id] = { exit: { x: x.x, y: x.y }, f, box, tip: { x: f > 0 ? box.x : box.x + box.w, y: x.y }, auto: auto[i] };
    });
    const leadPt = (E, d) => ({ x: E.exit.x + E.f * Math.min(LEAD, d), y: E.exit.y });
    if (n === 1) {   // one end so far: a short stub
      const a = L.ends[ends[0].id];
      L.paths.push([a.exit, { x: a.exit.x + Math.min(220, (A.x1 - a.exit.x) * 0.5), y: a.exit.y }]);
    } else if (n === 2) {
      const a = L.ends[ends[0].id], b = L.ends[ends[1].id], d = Math.abs(a.exit.x - b.exit.x) / 3;
      L.paths.push([a.exit, leadPt(a, d), leadPt(b, d), b.exit]);
    } else if (n > 2) {
      ends.forEach((e, i) => {
        const E = L.ends[e.id], d = Math.abs(E.exit.x - hub.x) * 0.4;
        L.paths.push(i === 0 ? [E.exit, leadPt(E, d), hub] : [hub, leadPt(E, d), E.exit]);
      });
    }
    L.paths = L.paths.map(ps => ps.filter((q, i) => !i || Math.hypot(q.x - ps[i - 1].x, q.y - ps[i - 1].y) > 0.01));
    return L;
  }
  // Snap targets for dimension ends.
  function anchors(p, L) {
    const out = [];
    p.ends.forEach(e => {
      const E = L.ends[e.id];
      if (!E) return;
      out.push({ at: "exit:" + e.id, x: E.exit.x, y: E.exit.y, name: "End " + e.letter + " cable exit" });
      out.push({ at: "tip:" + e.id, x: E.tip.x, y: E.tip.y, name: "End " + e.letter + " connector tip" });
    });
    if (L.hub) out.push({ at: "hub", x: L.hub.x, y: L.hub.y, name: "Breakout" });
    return out;
  }
  function resolve(ref, L) {
    if (!ref) return null;
    if (ref.at) {
      if (ref.at === "hub") return L.hub;
      const [k, id] = ref.at.split(":"), E = L.ends[id];
      return E ? (k === "tip" ? E.tip : E.exit) : null;
    }
    return { x: ref.x, y: ref.y };
  }

  // ---------- cable drawing ----------
  function drawCable(pen, p, L) {
    if (!L.paths.length) return;
    pen.begin("cable", "cable");
    const c = p.cable, tube = c.style !== "line", w = c.w, lw = 0.9;
    const opt = (s, width) => ({ s, lw: width, join: "round" });
    if (tube) {
      L.paths.forEach(ps => pen.poly(flat(ps), opt(INK, w)));
      if (L.hub) pen.circle(L.hub.x, L.hub.y, w / 2, { s: null, f: INK });
      L.paths.forEach(ps => pen.poly(flat(ps), opt(PAPER, w - 2 * lw)));
      if (L.hub) pen.circle(L.hub.x, L.hub.y, w / 2 - lw, { s: null, f: PAPER });
    } else {
      L.paths.forEach(ps => pen.poly(flat(ps), opt(INK, 1.4)));
      if (L.hub) pen.circle(L.hub.x, L.hub.y, 2.2, { s: null, f: INK });
    }
    if (c.brk) {   // break mark on the longest run: not to scale
      let best = null;
      L.paths.forEach((ps, pi) => ps.slice(1).forEach((q, i) => {
        const a = ps[i], d = Math.hypot(q.x - a.x, q.y - a.y);
        if (!best || d > best.d) best = { a, b: q, d };
      }));
      if (best && best.d > 30) {
        const ux = (best.b.x - best.a.x) / best.d, uy = (best.b.y - best.a.y) / best.d, nx = -uy, ny = ux;
        const mx = (best.a.x + best.b.x) / 2, my = (best.a.y + best.b.y) / 2, half = (tube ? w : 3) / 2 + 4, g = 4;
        pen.poly([mx - ux * g + nx * (half + 1), my - uy * g + ny * (half + 1), mx + ux * g + nx * (half + 1), my + uy * g + ny * (half + 1),
          mx + ux * g - nx * (half + 1), my + uy * g - ny * (half + 1), mx - ux * g - nx * (half + 1), my - uy * g - ny * (half + 1)], { s: null, f: PAPER, close: true });
        [-g, g].forEach(o => pen.line(mx + ux * (o - 2) + nx * half, my + uy * (o - 2) + ny * half, mx + ux * (o + 2) - nx * half, my + uy * (o + 2) - ny * half, { lw: 0.9 }));
      }
    }
    if (c.boot && L.hub) drawBoot(pen, p, L);
    // screen-only hit area along the cable
    L.paths.forEach(ps => pen.poly(flat(ps), { s: "transparent", lw: Math.max(10, w + 6), hit: true, join: "round" }));
    const xs = [], ys = [];
    L.paths.forEach(ps => ps.forEach(q => { xs.push(q.x); ys.push(q.y); }));
    pen.g.box = { x: Math.min(...xs), y: Math.min(...ys) - w / 2, w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) + w };
  }
  const flat = ps => ps.reduce((a, q) => { a.push(q.x, q.y); return a; }, []);

  // First `len` of a polyline (walks across its segments).
  function lead(ps, len) {
    const out = [ps[0]];
    let left = len;
    for (let i = 1; i < ps.length && left > 0; i++) {
      const a = ps[i - 1], b = ps[i], d = Math.hypot(b.x - a.x, b.y - a.y);
      if (d >= left) { out.push({ x: a.x + (b.x - a.x) * left / d, y: a.y + (b.y - a.y) * left / d }); left = 0; }
      else { out.push(b); left -= d; }
    }
    return out;
  }
  const pathLen = ps => ps.slice(1).reduce((t, q, i) => t + Math.hypot(q.x - ps[i].x, q.y - ps[i].y), 0);
  // Y boot: a molded breakout over the hub, legs along the trunk and each branch, a stepped
  // strain relief at each leg end. Same two-pass trick as the tube: dark outline, then white.
  function drawBoot(pen, p, L) {
    const c = p.cable, w = c.style === "line" ? 2 : c.w, lw = 0.9;
    const wb = w + Math.max(6, w * 0.9), wr = (w + wb) / 2, step = Math.max(5, wb * 0.6);
    const legs = L.paths.map((ps, i) => {
      const fromHub = i === 0 ? ps.slice().reverse() : ps;
      const len = Math.min(c.bootL * (i === 0 ? 1.25 : 1), pathLen(fromHub) * 0.45);
      return { body: lead(fromHub, len), relief: lead(fromHub, Math.min(len + step, pathLen(fromHub) * 0.6)) };
    });
    // body: hull round the leg roots, so the fork between the legs is filled
    const pts = [];
    legs.forEach(g => {
      const d0 = Math.min(pathLen(g.body) * 0.6, wb * 1.4), q = lead(g.body, d0), e = q[q.length - 1], a = q[q.length - 2] || L.hub;
      const dl = Math.hypot(e.x - a.x, e.y - a.y) || 1, nx = -(e.y - a.y) / dl * wb / 2, ny = (e.x - a.x) / dl * wb / 2;
      pts.push({ x: L.hub.x + nx, y: L.hub.y + ny }, { x: L.hub.x - nx, y: L.hub.y - ny }, { x: e.x + nx, y: e.y + ny }, { x: e.x - nx, y: e.y - ny });
    });
    const body = flat(hull(pts));
    [[INK, 0], [PAPER, 2 * lw]].forEach(([col, cut]) => {
      legs.forEach(g => pen.poly(flat(g.relief), { s: col, lw: wr - cut, join: "round" }));
      legs.forEach(g => pen.poly(flat(g.body), { s: col, lw: wb - cut, join: "round" }));
      pen.poly(body, cut ? { s: null, f: col, close: true } : { s: col, lw: 2 * lw, f: col, close: true, join: "round" });
    });
  }
  function hull(pts) {   // convex hull, monotone chain
    pts = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lo = [], hi = [];
    pts.forEach(q => { while (lo.length > 1 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); });
    pts.slice().reverse().forEach(q => { while (hi.length > 1 && cross(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); });
    return lo.slice(0, -1).concat(hi.slice(0, -1));
  }

  function drawPic(pen, e, pic, box) {
    if (pic) pen.img(pic.key, pic.data, box.x, box.y, box.w, box.h);
    else {
      pen.rect(box.x, box.y, box.w, box.h, { s: FAINT, dash: [3, 2], lw: 0.7 });
      pen.text(box.x + box.w / 2, box.y + box.h / 2 + 3, "NO IMAGE", { size: 6, anchor: "middle", c: FAINT });
    }
  }
  function drawEnds(pen, p, pics, L) {
    p.ends.forEach(e => {
      const E = L.ends[e.id];
      pen.begin("end:" + e.id, "end");
      drawPic(pen, e, pics[e.id], E.box);
      let h = E.box.h;
      if (p.meta.tags && p.meta.details) {   // detail tag under the picture
        const cx = E.box.x + E.box.w / 2, cy = E.box.y + E.box.h + 10;
        pen.circle(cx, cy, 6.5, { f: PAPER, lw: 0.8 });
        pen.text(cx, cy + 2.6, e.letter, { size: 7, bold: true, anchor: "middle" });
        h += 17;
      }
      pen.g.box = { x: E.box.x, y: E.box.y, w: E.box.w, h };
    });
  }
  const caption = e => "Detail " + e.letter + ([e.name, e.type].some(Boolean) ? ": " + [e.name, e.type].filter(Boolean).join(" - ") : "");
  function drawDetails(pen, p, pics, R) {
    if (!R.det.on) return;
    R.det.slots.forEach(s => {
      const e = p.ends.find(x => x.id === s.id);
      pen.begin("det:" + e.id, "detail");
      const box = { x: s.cx - s.w / 2, y: s.top, w: s.w, h: s.h };
      drawPic(pen, e, pics[e.id], box);
      const lines = wrap(caption(e), s.capW, 7, true).slice(0, 2);
      lines.forEach((l, i) => pen.text(s.cx, s.top + s.h + 11 + i * 8.6, l, { size: 7, bold: true, anchor: "middle" }));
      const cw = Math.max(s.w, ...lines.map(l => tw(l, 7, true)));
      pen.g.box = { x: s.cx - cw / 2, y: s.top, w: cw, h: s.h + 13 + lines.length * 8.6 };
    });
  }

  // ---------- dimensions ----------
  function dimText(d, m) {
    let s = d.val.trim() || "TBD";
    if (m.showUnit && d.val.trim() && num(d.val) != null && !/[a-z"]/i.test(d.val)) s += m.units === "mm" ? " mm" : " in";
    if (d.tol.trim()) s += " ±" + d.tol.trim().replace(/^±/, "");
    if (d.ref) s += " REF";
    return s;
  }
  function dimGeom(d, L) {
    const a = resolve(d.a, L), b = resolve(d.b, L);
    if (!a || !b) return null;
    let q1, q2, n;
    if (d.dir === "h") { const y = (a.y + b.y) / 2 + d.off; q1 = { x: a.x, y }; q2 = { x: b.x, y }; n = { x: 0, y: 1 }; }
    else if (d.dir === "v") { const x = (a.x + b.x) / 2 + d.off; q1 = { x, y: a.y }; q2 = { x, y: b.y }; n = { x: 1, y: 0 }; }
    else {
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      n = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
      q1 = { x: a.x + n.x * d.off, y: a.y + n.y * d.off }; q2 = { x: b.x + n.x * d.off, y: b.y + n.y * d.off };
    }
    return { a, b, q1, q2, n };
  }
  function drawDim(pen, d, L, m) {
    const G = dimGeom(d, L);
    if (!G) return;
    pen.begin("dim:" + d.id, "dim");
    const ext = (P, Q) => {
      const dx = Q.x - P.x, dy = Q.y - P.y, len = Math.hypot(dx, dy);
      if (len < 3) return;
      const ux = dx / len, uy = dy / len;
      pen.line(P.x + ux * 3, P.y + uy * 3, Q.x + ux * 4, Q.y + uy * 4, { lw: 0.45 });
    };
    ext(G.a, G.q1); ext(G.b, G.q2);
    const dx = G.q2.x - G.q1.x, dy = G.q2.y - G.q1.y, len = Math.hypot(dx, dy) || 1, ang = Math.atan2(dy, dx);
    pen.line(G.q1.x, G.q1.y, G.q2.x, G.q2.y, { lw: 0.6 });
    arrow(pen, G.q2.x, G.q2.y, ang, 6); arrow(pen, G.q1.x, G.q1.y, ang + Math.PI, 6);
    const s = dimText(d, m), size = 7.5, w = tw(s, size, true) + 6;
    const mx = (G.q1.x + G.q2.x) / 2, my = (G.q1.y + G.q2.y) / 2;
    const inline = len > w + 16;   // text in a break of the line, else above it
    const ty = inline ? my : my - 7;
    pen.rect(mx - w / 2, ty - 5.5, w, 11, { s: null, f: inline ? PAPER : null });
    pen.text(mx, ty + 2.7, s, { size, bold: true, anchor: "middle", c: d.val.trim() ? INK : "#B8402F" });
    pen.line(G.q1.x, G.q1.y, G.q2.x, G.q2.y, { s: "transparent", lw: 9, hit: true });
    const xs = [G.q1.x, G.q2.x, mx - w / 2, mx + w / 2], ys = [G.q1.y, G.q2.y, ty - 6, ty + 6];
    pen.g.box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    pen.g.geom = G;
  }
  // Default dimensions: overall (2 ends) or trunk + each branch (3+ ends).
  function autoDims(p, L) {
    const out = [], ends = p.ends;
    if (ends.length < 2) return out;
    const mk = (a, b, off) => ({ id: uid(), a, b, dir: "h", off, val: "", tol: "", ref: false });
    if (ends.length === 2) out.push(mk({ at: "tip:" + ends[0].id }, { at: "tip:" + ends[1].id }, -(Math.max(L.ends[ends[0].id].box.h, L.ends[ends[1].id].box.h) / 2 + 28)));
    else {
      const A = L.ends[ends[0].id];
      out.push(mk({ at: "exit:" + ends[0].id }, { at: "hub" }, -(A.box.h / 2 + 28)));
      ends.slice(1).forEach(e => {   // aligned with each branch, on its outer side
        const E = L.ends[e.id], up = E.exit.y <= L.hub.y, k = p.cable.w / 2 + 16;
        out.push(Object.assign(mk({ at: "hub" }, { at: "exit:" + e.id }, up ? -k : k), { dir: "a" }));
      });
    }
    return out;
  }

  // ---------- labels ----------
  function labelBox(l) {
    const f = SIZE_PT[l.size] / SIZE_PT.m, size = SIZE_PT[l.size];
    if (l.kind === "balloon") { const r = Math.max(8 * f, tw(l.text || "?", size, true) / 2 + 3.5 * f); return { x: l.x - r, y: l.y - r, w: 2 * r, h: 2 * r, r }; }
    const lines = str(l.text || (l.kind === "callout" ? "CALLOUT" : "Text")).split(/\r?\n/);
    const pad = l.box ? 4 * f : 0, lh = size * 1.25;
    const w = Math.max(...lines.map(s => tw(s, size, l.bold))) + 2 * pad, h = lines.length * lh + 2 * pad - (lh - size) + 2 * f;
    return { x: l.x, y: l.y, w, h, lines, pad, lh, size };
  }
  function drawLabel(pen, l) {
    pen.begin("lbl:" + l.id, "label");
    const b = labelBox(l), size = SIZE_PT[l.size];
    let edge = null;
    if (l.kind === "balloon") {
      pen.circle(l.x, l.y, b.r, { f: PAPER, lw: 0.9 });
      pen.text(l.x, l.y + size * 0.36, l.text || "?", { size, bold: true, anchor: "middle" });
      if (l.lx != null) { const a = Math.atan2(l.ly - l.y, l.lx - l.x); edge = { x: l.x + Math.cos(a) * b.r, y: l.y + Math.sin(a) * b.r }; }
    } else {
      if (l.box) pen.rect(b.x, b.y, b.w, b.h, { f: PAPER, lw: 0.7 });
      else if (l.kind === "callout") pen.rect(b.x, b.y, b.w, b.h, { s: null, f: PAPER });
      b.lines.forEach((s, i) => pen.text(b.x + b.pad, b.y + b.pad + size * 0.9 + 1 + i * b.lh, s, { size, bold: l.bold }));
      if (l.lx != null) {
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
        const sx = l.lx < b.x ? b.x : l.lx > b.x + b.w ? b.x + b.w : cx;
        const sy = sx === cx ? (l.ly < cy ? b.y : b.y + b.h) : cy;
        edge = { x: sx, y: sy };
      }
    }
    if (edge) {
      pen.line(edge.x, edge.y, l.lx, l.ly, { lw: 0.6 });
      arrow(pen, l.lx, l.ly, Math.atan2(l.ly - edge.y, l.lx - edge.x), 5.5);
    }
    pen.g.box = { x: b.x, y: b.y, w: b.w, h: b.h };
  }

  // ---------- scene ----------
  // opt.pics: endId -> picture; opt.logo: title-block logo (this browser only).
  function scene(p, opt) {
    opt = opt || {};
    const pics = opt.pics || {}, m = p.meta;
    const R = regions(p, pics), pen = new Pen();
    const out = { W: R.W, H: R.H, groups: pen.groups, R };
    pen.begin("frame", "frame");
    pen.rect(0, 0, R.W, R.H, { s: null, f: PAPER });
    frame(pen, R.W, R.H);
    if (m.revBlock) { pen.begin("rev", "frame"); revBlock(pen, p, R.fr.R, R.fr.T); }
    if (m.footer) { pen.begin("tb", "frame"); out.tb = titleBlock(pen, p, R.fr.R, R.fr.B, opt.logo); }
    if (p.notes.length) {
      const lines = notesLines(p), h = notesHeight(p), pos = p.notesPos || { x: R.fr.L + 14, y: R.fr.T + 12 };
      pen.begin("notes", "notes");
      pen.rect(pos.x - 4, pos.y - 2, NOTES_W, h + 2, { s: null, f: PAPER });
      pen.text(pos.x, pos.y + 8, "NOTES:", { size: 7.5, bold: true });
      lines.forEach((l, i) => { const y = pos.y + 18 + i * 8.6; pen.text(pos.x + 13, y, l.n, { size: 6.6, anchor: "end" }); pen.text(pos.x + 17, y, l.l, { size: 6.6 }); });
      pen.g.box = { x: pos.x - 4, y: pos.y - 2, w: NOTES_W, h: h + 2 };
    }
    const L = layout(p, pics, R);
    out.L = L;
    drawCable(pen, p, L);
    if (L.hub) { pen.begin("hub", "hub"); pen.circle(L.hub.x, L.hub.y, Math.max(7, p.cable.w), { s: "transparent", f: "transparent", hit: true }); pen.g.box = { x: L.hub.x - 7, y: L.hub.y - 7, w: 14, h: 14 }; }
    drawEnds(pen, p, pics, L);
    drawDetails(pen, p, pics, R);
    p.dims.forEach(d => drawDim(pen, d, L, m));
    p.labels.forEach(l => drawLabel(pen, l));
    out.anchors = anchors(p, L);
    return out;
  }

  Object.assign(QC, {
    FORMAT, MAX_ENDS, SHEETS, SIZE_PT, CALLOUT_PRESETS, FONT,
    blank, newEnd, normalize, uid, num, nextLetter, caption,
    scene, layout, regions, anchors, resolve, autoDims, dimGeom, labelBox, textWidth: tw
  });
})(typeof window !== "undefined" ? window : globalThis);
