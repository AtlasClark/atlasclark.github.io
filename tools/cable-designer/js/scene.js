/*
  Cable Designer — drawing scene
  Scope: turns a project into a list of drawing primitives (line, polyline,
  rect, circle, text, image) in points on the sheet: frame with zones, title
  block, revision block, notes, connector blocks (pin table + face view),
  cable blocks (conductors, twist, shield, length dimensions, markings), wire
  routes, callouts, wire table and BOM. The SVG and PDF writers (out.js) draw
  the same primitives, so screen and export match. Text is Helvetica / Arial.
*/
(function (root) {
  "use strict";
  const CD = root.CD;
  const INK = "#111111", DIM = "#5A5A5A", FAINT = "#9A9A9A", HEAD = "#ECECEC", PAPER = "#FFFFFF";
  const FONT = "Arial, Helvetica, sans-serif";

  // ---------- text metrics ----------
  let mctx = null;
  function tw(s, size, bold) {
    s = String(s == null ? "" : s);
    if (!mctx && typeof document !== "undefined") mctx = document.createElement("canvas").getContext("2d");
    if (!mctx) return s.length * size * 0.56;
    mctx.font = (bold ? "bold " : "") + size + "px " + FONT;
    return mctx.measureText(s).width;
  }
  function wrap(s, width, size, bold) {
    const out = [];
    String(s == null ? "" : s).split(/\r?\n/).forEach(par => {
      const words = par.split(/\s+/).filter(Boolean);
      if (!words.length) { out.push(""); return; }
      let line = "";
      words.forEach(w => {
        const t = line ? line + " " + w : w;
        if (tw(t, size, bold) <= width || !line) line = t;
        else { out.push(line); line = w; }
        while (tw(line, size, bold) > width && line.length > 1) {   // break very long words
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
    begin(id, kind, extra) { this.g = Object.assign({ id, kind, prims: [], box: null }, extra); this.groups.push(this.g); return this.g; },
    push(o) { this.g.prims.push(o); return o; },
    line(x1, y1, x2, y2, o) { return this.push(Object.assign({ t: "line", x1, y1, x2, y2, s: INK, lw: 0.6 }, o)); },
    poly(pts, o) { return this.push(Object.assign({ t: "poly", pts, s: INK, lw: 0.6, f: null, close: false }, o)); },
    rect(x, y, w, h, o) { return this.push(Object.assign({ t: "rect", x, y, w, h, s: INK, lw: 0.6, f: null, r: 0 }, o)); },
    circle(cx, cy, r, o) { return this.push(Object.assign({ t: "circle", cx, cy, r, s: INK, lw: 0.6, f: null }, o)); },
    text(x, y, s, o) { return this.push(Object.assign({ t: "text", x, y, s: String(s), size: 6.5, bold: false, anchor: "start", c: INK }, o)); },
    img(key, x, y, w, h) { return this.push({ t: "img", key, x, y, w, h }); }
  };
  function arrow(pen, x, y, ang, size) {
    size = size || 4.5;
    const a1 = ang + Math.PI - 0.38, a2 = ang + Math.PI + 0.38;
    pen.poly([x, y, x + Math.cos(a1) * size, y + Math.sin(a1) * size, x + Math.cos(a2) * size, y + Math.sin(a2) * size], { s: null, f: INK, close: true });
  }
  function balloon(pen, cx, cy, n) {
    pen.circle(cx, cy, 6, { f: PAPER, lw: 0.6 });
    pen.text(cx, cy + 2.2, n, { size: 6.2, bold: true, anchor: "middle" });
  }

  // ---------- table ----------
  // cols: [{h, min, max, align}]; rows: arrays of strings. Returns {w, h}.
  function table(pen, x, y, title, cols, rows, opt) {
    opt = opt || {};
    const S = opt.size || 5.8, HS = Math.max(5.2, S - 0.6), LH = S + 1.6, PADX = 3;
    const ax = (c, cx, w) => c.align === "right" ? cx + w - PADX : c.align === "center" ? cx + w / 2 : cx + PADX;
    const an = c => c.align === "right" ? "end" : c.align === "center" ? "middle" : "start";
    const widths = cols.map((c, i) => {
      let w = tw(c.h.toUpperCase(), HS, true);
      rows.forEach(r => { w = Math.max(w, tw(r[i], S)); });
      return Math.max(c.min || 14, Math.min(c.max || 120, w + PADX * 2));
    });
    const W = widths.reduce((a, b) => a + b, 0);
    const cells = rows.map(r => r.map((v, i) => wrap(v, widths[i] - PADX * 2, S)));
    const rh = cells.map(r => Math.max(1, ...r.map(l => l.length)) * LH + 3);
    const TH = title ? 11 : 0, HH = 10;
    const H = TH + HH + rh.reduce((a, b) => a + b, 0);
    pen.rect(x, y, W, H, { f: PAPER, lw: 0.8 });
    let cy = y;
    if (title) {
      pen.text(x + W / 2, cy + 8, title, { size: 7, bold: true, anchor: "middle" });
      cy += TH; pen.line(x, cy, x + W, cy, { lw: 0.6 });
    }
    pen.rect(x, cy, W, HH, { s: null, f: HEAD });
    let cx = x;
    cols.forEach((c, i) => {
      pen.text(ax(c, cx, widths[i]), cy + 7, c.h.toUpperCase(), { size: HS, bold: true, anchor: an(c) });
      cx += widths[i];
    });
    cy += HH; pen.line(x, cy, x + W, cy, { lw: 0.6 });
    cells.forEach((r, ri) => {
      cx = x;
      r.forEach((lines, i) => {
        lines.forEach((l, k) => pen.text(ax(cols[i], cx, widths[i]), cy + 2 + S + k * LH, l, { size: S, anchor: an(cols[i]), bold: !!cols[i].bold }));
        cx += widths[i];
      });
      cy += rh[ri];
      if (ri < cells.length - 1) pen.line(x, cy, x + W, cy, { lw: 0.3, s: FAINT });
    });
    cx = x;
    widths.slice(0, -1).forEach(w => { cx += w; pen.line(cx, y + TH, cx, y + H, { lw: 0.4 }); });
    return { w: W, h: H };
  }
  function measureTable(title, cols, rows, opt) {
    const p = new Pen(); p.begin("m", "m");
    return table(p, 0, 0, title, cols, rows, opt);
  }

  // ---------- connector layout ----------
  const HDR = 15, LH = 8.6, RH = 11, PAD = 5;
  function connInfo(c, lib) {
    const L = [];
    L.push(c.desc || lib.name + (lib.var && lib.kind !== "flying" ? ", " + c.pins.length + " pos" : ""));
    if (lib.gender && c.gender !== "none") L.push(c.gender === "male" ? "Male (pins)" : "Female (sockets)");
    if (c.mpn) L.push((c.mfr ? c.mfr + " " : "") + c.mpn);
    if (c.ipn) L.push("PN " + c.ipn);
    if (c.term.mpn || c.term.ipn) L.push("Contact: " + (c.term.mpn || c.term.ipn));
    if (c.seal.mpn || c.seal.ipn) L.push("Seal: " + (c.seal.mpn || c.seal.ipn));
    c.acc.forEach(a => { if (a.mpn || a.ipn || a.desc) L.push((a.desc || "Accessory") + (a.mpn ? ": " + a.mpn : "")); });
    if (c.strip) L.push("Strip " + c.strip);
    return L;
  }
  function connLayout(p, c) {
    const lib = CD.libOf(c);
    if (lib.kind === "board") {
      // Junction board: a black box with through-hole pins on its edges; wires land on each pin's lead.
      const B = c.board || { w: 150, h: 100, pins: [] }, x = c.x, y = c.y, w = B.w, h = B.h, LEAD = 9;
      const pos = i => {
        const q = B.pins[i] || { side: "L", t: 0.5 };
        const iy = y + HDR + q.t * (h - HDR), ix = x + q.t * w;
        return q.side === "L" ? { x, y: iy, ox: -1, oy: 0, side: "L" } : q.side === "R" ? { x: x + w, y: iy, ox: 1, oy: 0, side: "R" }
          : q.side === "T" ? { x: ix, y, ox: 0, oy: -1, side: "T" } : { x: ix, y: y + h, ox: 0, oy: 1, side: "B" };
      };
      return {
        board: true, x, y, w, h, LEAD, pos, box: { x: x - LEAD, y: y - LEAD, w: w + LEAD * 2, h: h + LEAD * 2 },
        port(i) { const q = pos(i); return { x: q.x + q.ox * LEAD, y: q.y + q.oy * LEAD, d: q.ox, v: q.oy }; }
      };
    }
    if (lib.kind === "splice" || lib.kind === "ground") {
      const lw = tw(c.ref, 7, true);
      return { node: lib.kind, x: c.x, y: c.y, box: { x: c.x - 9, y: c.y - 14, w: lw + 22, h: lib.kind === "ground" ? 32 : 24 }, port: (i, dirTo) => ({ x: c.x, y: c.y, d: 0 }) };
    }
    const info = connInfo(c, lib);
    const face = c.face ? CD.faceLayout(c) : null;
    const pw = Math.max(16, ...c.pins.map(x => tw(x.n, 6.2, true) + 8));
    const sw = Math.max(34, ...c.pins.map(x => tw(x.sig, 6.2) + 10));
    let w = Math.max(96, pw + sw, tw(c.ref, 8.5, true) + 34, ...info.map(s => tw(s, 6.3) + PAD * 2 + 2));
    if (face) w = Math.max(w, face.w + PAD * 2 + 4);
    w = Math.ceil(w);
    let y = c.y + HDR + info.length * LH + 3;
    let faceBox = null;
    if (face) { faceBox = { x: c.x + (w - face.w) / 2, y: y + 2, w: face.w, h: face.h }; y += face.h + 14; }
    const rowsY = y;
    const h = Math.ceil(y - c.y + c.pins.length * RH + 1);
    return {
      x: c.x, y: c.y, w, h, info, face, faceBox, pw, sw, rowsY,
      box: { x: c.x, y: c.y, w, h },
      port(i, right) { const ry = rowsY + i * RH + RH / 2; return right ? { x: c.x + w, y: ry, d: 1 } : { x: c.x, y: ry, d: -1 }; }
    };
  }

  // ---------- cable layout ----------
  const CRH = 15;
  function cableInfo(p, c) {
    const L = [];
    if (c.mpn) L.push((c.mfr ? c.mfr + " " : "") + c.mpn);
    if (c.ipn) L.push("PN " + c.ipn);
    if (c.kind !== "bundle") {
      const j = [c.jacket, c.jcolor ? "jacket " + c.jcolor : "", c.od ? "OD " + c.od : ""].filter(Boolean).join(", ");
      if (j) L.push(j);
    }
    if (c.shield.type !== "none") {
      const nm = (CD.SHIELDS.find(s => s[0] === c.shield.type) || ["", ""])[1];
      const tn = k => ({ pigtail: "pigtail", "360": "360°", float: "floating", none: "not set" })[k] || k;
      L.push("Shield: " + nm.toLowerCase() + ". End A " + tn(c.shield.a) + ", end B " + tn(c.shield.b) + ".");
    }
    return L;
  }
  function cableLayout(p, c, conns) {
    const list = CD.conductors(p, c);
    const info = cableInfo(p, c);
    const cols = [
      list.map(w => CD.wireRef(p, w)), list.map(w => CD.gaugeText(w)), list.map(w => CD.colorText(w)), list.map(w => CD.sigOf(p, w))
    ];
    const cw = cols.map((col, i) => Math.max(0, ...col.map(s => tw(s, 6.2, i === 0))) + (col.some(Boolean) ? 7 : 0));
    const textW = cw.reduce((a, b) => a + b, 0) + 6;
    const head = c.ref + "  " + (c.desc || "");
    let w = Math.max(210, tw(c.ref, 8.5, true) + tw(c.desc, 7) + 34, ...info.map(s => tw(s, 6.3) + 12), textW + 110);
    w = Math.ceil(w);
    const rowsY = c.y + HDR + info.length * LH + 5;
    const rows = list.map((w2, i) => ({ w: w2, y: rowsY + i * CRH, ly: rowsY + i * CRH + 11.5 }));
    const rowsH = Math.max(1, list.length) * CRH;
    const h = Math.ceil(rowsY - c.y + rowsH + 5);
    // End A faces the side where most "a" connectors sit.
    let sa = 0, n = 0;
    list.forEach(w2 => { const L2 = w2.a && conns[w2.a.c]; if (L2) { sa += L2.box.x + L2.box.w / 2; n++; } });
    const cx = c.x + w / 2;
    const aLeft = n ? sa / n <= cx : true;
    const sport = c.shield.type !== "none" && rows.length ? end => { const left = (end === "a") === aLeft; return { x: left ? c.x : c.x + w, y: rowsY - 2, d: left ? -1 : 1 }; } : null;
    return { x: c.x, y: c.y, w, h, info, rows, rowsY, rowsH, cw, textW, head, aLeft, sport, box: { x: c.x, y: c.y, w, h } };
  }

  // ---------- wire drawing ----------
  function bezier(p0, p3, d0, d3) {
    const dx = Math.max(28, Math.abs(p3.x - p0.x) * 0.45), dy = Math.max(28, Math.abs(p3.y - p0.y) * 0.45);
    const c1 = p0.v ? { x: p0.x, y: p0.y + p0.v * dy } : { x: p0.x + d0 * dx, y: p0.y };
    const c2 = p3.v ? { x: p3.x, y: p3.y + p3.v * dy } : { x: p3.x + d3 * dx, y: p3.y };
    if (!d0 && !p0.v) c1.x = p0.x + (p3.x - p0.x) * 0.3;
    if (!d3 && !p3.v) c2.x = p3.x - (p3.x - p0.x) * 0.3;
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24, u = 1 - t;
      pts.push(u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p3.x,
        u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p3.y);
    }
    return pts;
  }
  function strokeWire(pen, pts, w, thin) {
    const col = CD.COLOR[w.color] || { hex: "#888888" };
    const st = w.stripe ? CD.COLOR[w.stripe] : col.stripe ? CD.COLOR[col.stripe] : null;
    const k = thin ? 0.75 : 1;
    if (col.bare) {
      pen.poly(pts, { s: "#555555", lw: 1.7 * k, join: "round" });
      pen.poly(pts, { s: "#D2D2D2", lw: 0.9 * k, join: "round", dash: [2, 1.5] });
      return;
    }
    pen.poly(pts, { s: "#111111", lw: 3 * k, join: "round" });
    pen.poly(pts, { s: col.hex, lw: 1.9 * k, join: "round" });
    if (st) pen.poly(pts, { s: st.hex, lw: 1.9 * k, join: "round", dash: [3, 3] });
  }
  function endCap(pen, x, y, dir) {   // trimmed, insulated end
    pen.line(x + dir * 14, y - 4, x + dir * 14, y + 4, { lw: 1 });
  }

  // ---------- frame, title block, revisions ----------
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
      const size = o.size || 7.5;
      const lines = o.wrap ? wrap(value, w - 6, size, o.bold).slice(0, o.wrap) : [String(value)];
      const top = label ? y + 6 : y;
      const span = (y + h) - top;
      const lh = size * 1.15;
      const by = top + (span - lines.length * lh) / 2 + size * 0.86;
      lines.forEach((l, i) => pen.text(o.center ? x + w / 2 : x + 4, by + i * lh, l, { size, bold: !!o.bold, anchor: o.center ? "middle" : "start", c: o.c || INK }));
    }
  }
  function titleBlock(pen, p, R, B, sheet, sheets, images) {
    const m = p.meta, x = R - TBW, H = 94, y = B - H;
    pen.rect(x, y, TBW, H, { f: PAPER, lw: 1 });
    // left: names, tolerance, workmanship
    const lx = x, cw = [46, 70, 54];
    cell(pen, lx, y, cw[0], 10, "", ""); cell(pen, lx + cw[0], y, cw[1], 10, "NAME", ""); cell(pen, lx + cw[0] + cw[1], y, cw[2], 10, "DATE", "");
    [["DRAWN", m.drawn, m.drawnDate], ["CHECKED", m.checked, m.checkedDate], ["APPROVED", m.approved, m.approvedDate]].forEach((r, i) => {
      const ry = y + 10 + i * 14;
      cell(pen, lx, ry, cw[0], 14, "", r[0], { size: 5.6, bold: true });
      cell(pen, lx + cw[0], ry, cw[1], 14, "", r[1], { size: 6.5 });
      cell(pen, lx + cw[0] + cw[1], ry, cw[2], 14, "", r[2], { size: 6.5 });
    });
    const units = m.units === "mm" ? "MILLIMETRES" : "INCHES";
    const alt = m.alt ? (m.units === "mm" ? " [INCHES]" : " [MILLIMETRES]") : "";
    const tol = CD.num(m.tol) != null ? "LENGTH TOLERANCE ±" + CD.fmtLen(Math.abs(CD.num(m.tol)), Object.assign({}, m, { alt: false })) : "LENGTH TOLERANCE: NOT SET";
    pen.rect(lx, y + 52, 170, 26, { lw: 0.6 });
    pen.text(lx + 4, y + 59.5, "UNLESS OTHERWISE SPECIFIED:", { size: 5.2, c: DIM });
    pen.text(lx + 4, y + 67, "DIMENSIONS ARE IN " + units + alt, { size: 5.6, bold: true });
    pen.text(lx + 4, y + 74.5, tol, { size: 5.6, bold: true, c: CD.num(m.tol) != null ? INK : "#B8402F" });
    cell(pen, lx, y + 78, 170, 16, "", m.ws ? "WORKMANSHIP: IPC/WHMA-A-620, CLASS " + m.ws : "WORKMANSHIP: NOT SET", { size: 5.6, bold: true, c: m.ws ? INK : "#B8402F" });
    // right: logo or company, title, size / number / rev, scale / sheet
    // No built-in branding: the logo is a file the user loads into their own browser.
    const rx = x + 170, rw = TBW - 170;
    pen.rect(rx, y, rw, 26, { lw: 0.6 });
    const logo = images && images.logo;
    if (logo && logo.data) {
      const k = Math.min((rw - 20) / logo.w, 18 / logo.h), lw = logo.w * k, lh = logo.h * k;
      pen.img("logo", rx + (rw - lw) / 2, y + (26 - lh) / 2, lw, lh);
    } else if (m.company) pen.text(rx + rw / 2, y + 16.5, m.company, { size: 9, bold: true, anchor: "middle" });
    cell(pen, rx, y + 26, rw, 32, "TITLE", m.title || "", { size: 8.5, bold: true, wrap: 2 });
    cell(pen, rx, y + 58, 34, 22, "SIZE", m.size, { size: 9, bold: true, center: true });
    cell(pen, rx + 34, y + 58, rw - 34 - 36, 22, "DWG NO.", m.dwgNo, { size: 9, bold: true });
    cell(pen, rx + rw - 36, y + 58, 36, 22, "REV", m.rev, { size: 9, bold: true, center: true });
    cell(pen, rx, y + 80, 80, 14, "SCALE", m.scale, { size: 6.5 });
    cell(pen, rx + 80, y + 80, rw - 80, 14, "SHEET", sheet + " OF " + sheets, { size: 6.5 });
    let top = y;
    if (m.notice) {
      const lines = wrap(m.notice, TBW - 8, 5.2);
      const nh = lines.length * 6.4 + 5;
      top = y - nh;
      pen.rect(x, top, TBW, nh, { f: PAPER, lw: 0.8 });
      lines.forEach((l, i) => pen.text(x + 4, top + 7.5 + i * 6.4, l, { size: 5.2, c: DIM }));
    }
    return { x, y: top, w: TBW, h: B - top };
  }
  function revBlock(pen, p, R, T) {
    const cols = [{ h: "Rev", min: 28, max: 28 }, { h: "ECO", min: 50, max: 50 }, { h: "Description", min: 172, max: 172 }, { h: "Date", min: 58, max: 58 }, { h: "By", min: 72, max: 72 }];
    const rows = p.history.length ? p.history.map(r => [r.rev, r.eco, r.desc, r.date, r.by]) : [["", "", "", "", ""]];
    return Object.assign({ x: R - TBW, y: T }, table(pen, R - TBW, T, "REVISIONS", cols, rows, { size: 5.8 }));
  }
  function notesBlock(p) {
    const lines = [];
    p.notes.forEach((n, i) => wrap(n.text, 340, 6.4).forEach((l, k) => lines.push({ n: k ? "" : (i + 1) + ".", l })));
    return lines;
  }

  const WIRE_TCOLS = [{ h: "Wire", bold: true, max: 50 }, { h: "Cable", max: 40 }, { h: "Size", max: 50 }, { h: "Color", max: 40 }, { h: "Length", max: 70 }, { h: "From", max: 60 }, { h: "To", max: 60 }, { h: "Signal", max: 80 }, { h: "Twist / shield", max: 70 }, { h: "Note", max: 120 }];
  const BOM_TCOLS = [{ h: "Item", min: 20, max: 24, bold: true }, { h: "Qty", align: "right", max: 50 }, { h: "Unit", max: 26 }, { h: "Part No.", max: 80 }, { h: "Mfr", max: 80 }, { h: "Mfr Part No.", max: 100 }, { h: "Description", max: 170 }, { h: "Ref Des", max: 90 }];
  function dropEmptyCols(cols, rows) {
    const keep = cols.map((c, i) => i === 0 || rows.some(r => r[i]));
    return { cols: cols.filter((c, i) => keep[i]), rows: rows.map(r => r.filter((v, i) => keep[i])) };
  }

  // ---------- connector drawing ----------
  function drawFaceIcon(pen, fb, icon) {
    const cx = fb.x + fb.w / 2, cy = fb.y + fb.h / 2;
    if (icon === "ring") { pen.circle(cx - 8, cy, 8, { lw: 1 }); pen.circle(cx - 8, cy, 3.5, { lw: 0.8 }); pen.rect(cx, cy - 3, 18, 6, { lw: 0.8 }); }
    else if (icon === "fork") { pen.poly([cx + 4, cy - 3, cx - 14, cy - 3, cx - 14, cy - 7, cx - 18, cy - 7], { lw: 0.9 }); pen.poly([cx + 4, cy + 3, cx - 14, cy + 3, cx - 14, cy + 7, cx - 18, cy + 7], { lw: 0.9 }); pen.rect(cx + 4, cy - 3, 14, 6, { lw: 0.8 }); }
    else if (icon === "qd") { pen.rect(cx - 18, cy - 5, 18, 10, { lw: 0.9, r: 1.5 }); pen.rect(cx, cy - 3, 18, 6, { lw: 0.8 }); }
    else { pen.rect(cx - 16, cy - 2, 16, 4, { lw: 0.8, f: "#DDDDDD" }); pen.rect(cx, cy - 4, 18, 8, { lw: 0.9 }); }
  }
  // Face from the face builder: shell, keys (notch cut into the shell, raised key, latch), sized pins.
  function drawCustomFace(pen, f, x, y, male, c) {
    f.geom.forEach(o => {
      if (o.t === "circle") pen.circle(x + o.cx, y + o.cy, o.r, { lw: 1 });
      else if (o.t === "rect") pen.rect(x + o.x, y + o.y, o.w, o.h, { lw: 1, r: o.r });
      else if (!o.key) pen.poly(o.pts.map((v, i) => v + (i % 2 ? y : x)), { close: true, lw: 1 });
    });
    f.geom.filter(o => o.key).forEach(o => {
      const P = o.pts.map((v, i) => v + (i % 2 ? y : x));
      if (o.key === "key") pen.poly(P, { close: true, f: INK, s: INK, lw: 0.5 });
      else if (o.key === "latch") pen.poly(P, { close: true, f: PAPER, lw: 0.8 });
      else {   // keyway: break the shell line across the opening
        const dx = P[0] - P[2], dy = P[1] - P[3], d = Math.hypot(dx, dy) || 1, ex = dx / d * 0.9, ey = dy / d * 0.9;
        pen.poly([P[0] + ex, P[1] + ey, P[2], P[3], P[4], P[5], P[6] + ex, P[7] + ey], { close: true, f: PAPER, s: null });
        pen.poly(P, { lw: 0.8 });
      }
    });
    f.pins.forEach((pt, i) => {
      const px = x + pt.x, py = y + pt.y, st = male ? { f: INK, s: null } : { f: PAPER, lw: 0.7 };
      if (pt.sq) pen.rect(px - pt.r, py - pt.r, pt.r * 2, pt.r * 2, st); else pen.circle(px, py, pt.r, st);
      const lbl = c.pins[i] ? c.pins[i].n : "";
      if (pt.r >= 4.2) { pen.text(px, py + 1.6, lbl, { size: 4.6, anchor: "middle", bold: true, c: male ? PAPER : INK }); return; }
      const dx = pt.x - f.cx, dy = pt.y - f.cy, d = Math.hypot(dx, dy);
      // Pins in a row get the label above; others get it outward from the centre.
      const flat = d < 0.5 || f.pins.some(q => q !== pt && Math.abs(q.y - pt.y) < pt.r && Math.abs(q.x - pt.x) < pt.r * 6);
      const ux = flat ? 0 : dx / d, uy = flat ? -1 : dy / d, off = pt.r + 3.4;
      pen.text(px + ux * off, py + uy * off + 1.6, lbl, { size: 4.6, anchor: "middle", c: DIM });
    });
  }
  function drawFace(pen, L, c) {
    const f = L.face, b = L.faceBox, x = b.x, y = b.y;
    const male = c.gender === "male";
    const pin = (pt, i) => {
      if (!pt) return;
      pen.circle(x + pt.x, y + pt.y, 2.2, male ? { f: INK, s: null } : { f: PAPER, lw: 0.7 });
      const lbl = c.pins[i].n;
      if (f.shape === "circ") {
        const dx = pt.x - f.cx, dy = pt.y - f.cy, d = Math.hypot(dx, dy) || 1;
        const k = d < 2 ? 0 : 1;
        pen.text(x + pt.x + (k ? dx / d * 6.4 : 4.2), y + pt.y + (k ? dy / d * 6.4 : -3) + 1.8, lbl, { size: 4.6, anchor: "middle", c: DIM });
      } else if (f.shape !== "dsub" || f.rowsN < 3 || i < 0) {
        const up = pt.y < f.h / 2;
        pen.text(x + pt.x, y + pt.y + (up ? -3.4 : 6.4), lbl, { size: 4.4, anchor: "middle", c: DIM });
      } else pen.text(x + pt.x + 3, y + pt.y - 2.4, lbl, { size: 3.8, anchor: "start", c: DIM });
    };
    if (f.shape === "custom") {
      drawCustomFace(pen, f, x, y, male, c);
      pen.text(b.x + b.w / 2, b.y + b.h + 9, c.faceFrom === "rear" ? "WIRE SIDE VIEW" : "MATING FACE VIEW", { size: 4.6, anchor: "middle", c: DIM });
      return;
    }
    if (f.shape === "icon") drawFaceIcon(pen, b, f.icon);
    else if (f.shape === "dsub") {
      const i = 6;
      pen.poly([x, y, x + f.w, y, x + f.w - i, y + f.h, x + i, y + f.h], { close: true, lw: 1, r: 2 });
    } else if (f.shape === "circ") {
      pen.circle(x + f.cx, y + f.cy, f.R, { lw: 1 });
      pen.rect(x + f.cx - 2.5, y + f.cy - f.R - 1.5, 5, 4, { lw: 0.8, f: PAPER });   // key
    } else if (f.shape === "modular") {
      pen.rect(x, y, f.w, f.h, { lw: 1, r: 1.5 });
      pen.rect(x + f.w / 2 - 6, y + f.h, 12, 4, { lw: 0.8 });   // latch
    } else if (f.shape === "usb") {
      pen.rect(x, y, f.w, f.h, { lw: 1, r: 1 });
    } else {
      pen.rect(x, y, f.w, f.h, { lw: 1, r: 1.5 });
      pen.rect(x + f.w / 2 - 5, y - 3, 10, 3, { lw: 0.8 });   // latch
    }
    (f.pins || []).forEach(pin);
    pen.text(b.x + b.w / 2, b.y + b.h + 9, c.faceFrom === "rear" ? "WIRE SIDE VIEW" : "MATING FACE VIEW", { size: 4.6, anchor: "middle", c: DIM });
  }
  // Space a board's pin labels and part-number lines take on each side; the image fits inside it.
  function boardMargins(c) {
    const B = c.board, lbl = i => c.pins[i].n + (c.pins[i].sig ? "  " + c.pins[i].sig : "");
    const side = s => B.pins.map((q, i) => q.side === s ? i : -1).filter(i => i >= 0);
    const wid = s => side(s).reduce((m, i) => Math.max(m, tw(lbl(i), 6)), 0);
    const info = [c.mpn ? (c.mfr ? c.mfr + " " : "") + c.mpn : "", c.ipn ? "PN " + c.ipn : ""].filter(Boolean);
    return {
      l: side("L").length ? wid("L") + 12 : 6, r: side("R").length ? wid("R") + 12 : 6,
      t: HDR + (side("T").length ? 14 : 5), b: (side("B").length ? 14 : 5) + (B.img ? info.length * LH : 0), info
    };
  }
  // Block size whose image area matches the image's shape. Keeps the width unless the pins need a
  // taller block (13 pt per pin on the busier side), then widens instead.
  function boardFit(c) {
    const B = c.board;
    if (!B || !B.img) return null;
    const m = boardMargins(c), ar = B.img.h / B.img.w;
    const busy = Math.max(...["L", "R"].map(s => B.pins.filter(q => q.side === s).length), 0);
    const minH = Math.max(40, HDR + 15 + busy * 13);
    let w = B.w, h = Math.round(Math.max(10, w - m.l - m.r) * ar + m.t + m.b);
    if (h < minH) { h = minH; w = Math.round((h - m.t - m.b) / ar + m.l + m.r); }
    return { w: Math.max(60, Math.ceil(w / 5) * 5), h: Math.ceil(h / 5) * 5 };
  }
  function drawBoard(pen, c, L, find) {
    const x = L.x, y = L.y, w = L.w, h = L.h, img = c.board && c.board.img;
    pen.rect(x, y, w, h, { f: PAPER, lw: 1.3, r: 3 });
    pen.rect(x, y, w, HDR, { f: HEAD, s: null, r: 3 });
    pen.line(x, y + HDR, x + w, y + HDR, { lw: 0.6 });
    pen.text(x + PAD, y + 10.6, c.ref, { size: 8.5, bold: true });
    pen.text(x + PAD + tw(c.ref, 8.5, true) + 6, y + 10.6, c.desc || "Junction board", { size: 7, c: c.desc ? INK : DIM });
    if (find[c.id]) balloon(pen, x + w - 9, y + HDR / 2, find[c.id]);
    const M = boardMargins(c), info = M.info;
    if (img) {
      const aw = w - M.l - M.r, ah = h - M.t - M.b;
      if (aw > 8 && ah > 8) {
        const k = Math.min(aw / img.w, ah / img.h), iw = img.w * k, ih = img.h * k;
        pen.push({ t: "img", key: "board:" + c.id, src: img.data, x: x + M.l + (aw - iw) / 2, y: y + M.t + (ah - ih) / 2, w: iw, h: ih });
      }
      info.forEach((s, i) => pen.text(x + w / 2, y + h - 5 - (info.length - 1 - i) * LH, s, { size: 6.3, anchor: "middle", c: DIM }));
    } else info.forEach((s, i) => pen.text(x + w / 2, y + h / 2 + 3 + (i - (info.length - 1) / 2) * LH, s, { size: 6.3, anchor: "middle", c: DIM }));
    c.pins.forEach((pn, i) => {
      const q = L.pos(i), ex = q.x + q.ox * L.LEAD, ey = q.y + q.oy * L.LEAD;
      pen.line(q.x, q.y, ex, ey, { lw: 0.9 });
      pen.circle(q.x, q.y, 2.9, { f: PAPER, lw: 0.9 });
      pen.circle(q.x, q.y, 1.1, { f: INK, s: null });
      const lbl = pn.n + (pn.sig ? "  " + pn.sig : "");
      if (q.side === "L") pen.text(q.x + 6, q.y + 2.2, lbl, { size: 6 });
      else if (q.side === "R") pen.text(q.x - 6, q.y + 2.2, lbl, { size: 6, anchor: "end" });
      else if (q.side === "T") pen.text(q.x, q.y + HDR + 8, lbl, { size: 5.6, anchor: "middle" });
      else pen.text(q.x, q.y - 6, lbl, { size: 5.6, anchor: "middle" });
    });
  }
  function drawConn(pen, p, c, L, find) {
    const lib = CD.libOf(c);
    pen.begin("c:" + c.id, "conn", { box: L.box });
    if (L.node === "splice") {
      pen.circle(c.x, c.y, 3.6, { f: INK, s: null });
      pen.text(c.x + 6, c.y - 6, c.ref, { size: 7, bold: true });
      if (find[c.id]) balloon(pen, c.x + tw(c.ref, 7, true) + 16, c.y - 8, find[c.id]);
      return;
    }
    if (L.board) { drawBoard(pen, c, L, find); return; }
    if (L.node === "ground") {
      pen.line(c.x, c.y, c.x, c.y + 9, { lw: 1 });
      [[14, 9], [9, 12], [4, 15]].forEach(([w, dy]) => pen.line(c.x - w / 2, c.y + dy, c.x + w / 2, c.y + dy, { lw: 1 }));
      pen.circle(c.x, c.y, 1.8, { f: INK, s: null });
      pen.text(c.x + 10, c.y + 13, c.ref, { size: 7, bold: true });
      return;
    }
    const x = c.x, y = c.y, w = L.w, h = L.h;
    pen.rect(x, y, w, h, { f: PAPER, lw: 1 });
    pen.rect(x, y, w, HDR, { f: HEAD, s: null });
    pen.line(x, y + HDR, x + w, y + HDR, { lw: 0.6 });
    pen.text(x + PAD, y + 10.6, c.ref, { size: 8.5, bold: true });
    if (find[c.id]) balloon(pen, x + w - 9, y + HDR / 2, find[c.id]);
    L.info.forEach((s, i) => pen.text(x + PAD, y + HDR + 7.6 + i * LH, s, { size: 6.3, c: i ? DIM : INK }));
    if (L.face) drawFace(pen, L, c);
    pen.line(x, L.rowsY, x + w, L.rowsY, { lw: 0.6 });
    c.pins.forEach((pn, i) => {
      const ry = L.rowsY + i * RH;
      if (i) pen.line(x, ry, x + w, ry, { lw: 0.25, s: FAINT });
      pen.text(x + L.pw / 2, ry + 7.9, pn.n, { size: 6.2, bold: true, anchor: "middle" });
      pen.text(x + L.pw + 4, ry + 7.9, pn.sig, { size: 6.2 });
    });
    pen.line(x + L.pw, L.rowsY, x + L.pw, y + h, { lw: 0.4 });
  }

  // ---------- cable drawing ----------
  function drawCable(pen, p, c, L, find, connL, m) {
    pen.begin("w:" + c.id, "cable", { box: null });
    const x = c.x, y = c.y, w = L.w, h = L.h;
    const bundle = c.kind === "bundle";
    pen.rect(x, y, w, h, { f: PAPER, lw: bundle ? 0.7 : 1.2, r: bundle ? 0 : 4, dash: bundle ? [4, 2] : null });
    pen.text(x + PAD, y + 10.6, c.ref, { size: 8.5, bold: true });
    pen.text(x + PAD + tw(c.ref, 8.5, true) + 7, y + 10.6, c.desc, { size: 7 });
    if (find[c.id]) balloon(pen, x + w - 9, y + HDR / 2, find[c.id]);
    pen.line(x, y + HDR, x + w, y + HDR, { lw: 0.4, s: FAINT });
    L.info.forEach((s, i) => pen.text(x + PAD, y + HDR + 7.6 + i * LH, s, { size: 6.3, c: DIM }));
    const tx0 = x + L.textW + 14, tx1 = x + w - 16;
    // shield enclosures (dashed, IEEE 315 style)
    if (c.shield.type !== "none" && L.rows.length) {
      pen.rect(x + 3, L.rowsY - 2, w - 6, L.rowsH + 3, { dash: [3, 2], lw: 0.8, s: "#444444", r: 3 });
    }
    c.groups.forEach((g, gi) => {
      const rs = L.rows.filter(r => g.wires.includes(r.w.id));
      if (rs.length < 2) return;
      const top = rs[0], bot = rs[rs.length - 1];
      if (g.shield !== "none") pen.rect(tx0 - 6, top.y + 1, tx1 - tx0 + 12, bot.y + CRH - top.y - 1, { dash: [2, 1.5], lw: 0.6, s: "#666666", r: 2 });
      const lbl = "TW" + (gi + 1) + (g.lay ? ", lay " + CD.fmtLen(g.lay, Object.assign({}, m, { alt: false })) : "") + (g.shield !== "none" ? ", " + g.shield : "");
      pen.text((tx0 + tx1) / 2, top.ly - 6, lbl, { size: 5, anchor: "middle", c: DIM });
    });
    // conductors
    L.rows.forEach((r, i) => {
      let cx = x + PAD;
      [CD.wireRef(p, r.w), CD.gaugeText(r.w), CD.colorText(r.w), CD.sigOf(p, r.w)].forEach((s, k) => {
        pen.text(cx, r.y + 7.2, s, { size: 6.2, bold: k === 0, c: k === 3 ? DIM : INK });
        cx += L.cw[k];
      });
      const g = CD.groupOf(c, r.w.id);
      const rs = g ? L.rows.filter(q => g.wires.includes(q.w.id)) : null;
      let pts;
      if (rs && rs.length > 1) {
        const mN = rs.length, k = rs.indexOf(r), step = 7;
        const N = Math.max(mN, Math.floor((tx1 - tx0) / step / mN) * mN);
        pts = [x, r.ly];
        for (let j = 0; j <= N; j++) pts.push(tx0 + j * (tx1 - tx0) / N, rs[(k + j) % mN].ly);
        pts.push(x + w, r.ly);
      } else pts = [x, r.ly, x + w, r.ly];
      strokeWire(pen, pts, r.w, true);
    });
    if (!L.rows.length) pen.text(x + w / 2, L.rowsY + 10, "No conductors", { size: 6, anchor: "middle", c: FAINT });
    // shield end treatment
    if (c.shield.type !== "none" && L.rows.length) {
      const midY = L.rowsY + L.rowsH / 2;
      [["a", L.aLeft], ["b", !L.aLeft]].forEach(([end, left]) => {
        const t = c.shield[end], ex = left ? x + 3 : x + w - 3, dir = left ? -1 : 1;
        if (t === "float") {
          pen.line(ex, L.rowsY + L.rowsH - 4, ex + dir * 9, L.rowsY + L.rowsH - 4, { lw: 0.8, dash: [2, 1.5] });
          pen.line(ex + dir * 9, L.rowsY + L.rowsH - 8, ex + dir * 9, L.rowsY + L.rowsH, { lw: 1 });
          pen.text(ex + dir * 12, L.rowsY + L.rowsH + 6, "FLOAT", { size: 4.8, anchor: left ? "end" : "start", c: DIM });
        } else if (t === "360") {
          const cid = endConn(p, c, end), CL = cid && connL[cid];
          if (CL && !CL.node) {
            const tx = left ? CL.box.x + CL.box.w : CL.box.x, ty = CL.box.y + HDR / 2;
            pen.poly([ex, L.rowsY + 2, ex + dir * 10, L.rowsY + 2, tx - dir * 10, ty, tx, ty], { lw: 0.9, dash: [4, 2], s: "#444444" });
            pen.text((ex + tx) / 2, (L.rowsY + ty) / 2 - 3, "360°", { size: 5.2, anchor: "middle", c: DIM });
          } else pen.text(ex + dir * 4, L.rowsY - 4, "360° TO SHELL", { size: 4.8, anchor: left ? "end" : "start", c: DIM });
        } else if (t === "pigtail") pen.text(ex + dir * 4, L.rowsY - 4, "PIGTAIL", { size: 4.8, anchor: left ? "end" : "start", c: DIM });
      });
    }
    // length dimensions
    let dy = y + h + 12;
    const ext = (xx, y2) => pen.line(xx, y + h + 2, xx, y2 + 3, { lw: 0.4 });
    const dim = (x1, x2, yy, txt) => {
      pen.line(x1, yy, x2, yy, { lw: 0.5 });
      arrow(pen, x1, yy, Math.PI, 4); arrow(pen, x2, yy, 0, 4);
      pen.text((x1 + x2) / 2, yy - 2.5, txt, { size: 6.2, anchor: "middle", bold: true });
    };
    const leftS = L.aLeft ? c.stripA : c.stripB, rightS = L.aLeft ? c.stripB : c.stripA;
    const tolS = CD.fmtTol(c.stripTol, m);
    if (CD.num(leftS) != null || CD.num(rightS) != null) {
      dy += 4;
      if (CD.num(leftS) != null) { const xa = x + w * 0.2; ext(xa, dy); ext(x, dy + 16); dim(x, xa, dy, CD.fmtLen(leftS, m) + tolS); }
      if (CD.num(rightS) != null) { const xb = x + w * 0.8; ext(xb, dy); ext(x + w, dy + 16); dim(xb, x + w, dy, CD.fmtLen(rightS, m) + tolS); }
      dy += 16;
    }
    ext(x, dy); ext(x + w, dy);
    dim(x, x + w, dy, CD.num(c.len) != null ? CD.fmtLen(c.len, m) + CD.fmtTol(c.tol, m) : "LENGTH NOT SET");
    dy += 8;
    // markings (labels, heat-shrink, sleeving ...)
    c.marks.forEach(mk => {
      const kind = (CD.MARKS.find(k => k[0] === mk.kind) || ["", "Item"])[1].toUpperCase();
      const endName = { A: "END A", B: "END B", both: "BOTH ENDS", mid: "MIDDLE", all: "FULL LENGTH" }[mk.end] || "";
      const len = CD.num(mk.len) != null ? ", " + CD.fmtLen(mk.len, m) + " LONG" : "";
      const s = kind + ", " + endName + len + (mk.text ? ": " + mk.text : "");
      dy += 11;
      let tx = x + 2;
      if (find[mk.id]) { balloon(pen, x + 6, dy - 2.2, find[mk.id]); tx = x + 16; }
      pen.text(tx, dy, s, { size: 6.2 });
    });
    pen.g.box = { x, y, w, h: dy + 4 - y };
  }
  function endConn(p, c, end) {
    const ids = {};
    p.wires.forEach(w => { if (w.cable === c.id && w[end]) ids[w[end].c] = (ids[w[end].c] || 0) + 1; });
    let best = null, n = 0;
    Object.keys(ids).forEach(k => { if (ids[k] > n) { n = ids[k]; best = k; } });
    return best;
  }

  // ---------- callouts ----------
  function drawCallout(pen, k) {
    pen.begin("k:" + k.id, "callout");
    let box;
    if (k.kind === "flag") {
      const s = 15;
      pen.poly([k.x, k.y - s * 0.62, k.x + s * 0.58, k.y + s * 0.38, k.x - s * 0.58, k.y + s * 0.38], { close: true, f: PAPER, lw: 0.9 });
      pen.text(k.x, k.y + 3.4, k.text || "?", { size: 6.8, bold: true, anchor: "middle" });
      box = { x: k.x - 10, y: k.y - 11, w: 20, h: 18 };
    } else if (k.kind === "balloon") {
      pen.circle(k.x, k.y, 7.5, { f: PAPER, lw: 0.9 });
      pen.text(k.x, k.y + 2.4, k.text || "?", { size: 6.8, bold: true, anchor: "middle" });
      box = { x: k.x - 9, y: k.y - 9, w: 18, h: 18 };
    } else {
      const lines = wrap(k.text || "Note", 220, 7);
      const w = Math.max(...lines.map(l => tw(l, 7))) + 8;
      lines.forEach((l, i) => pen.text(k.x + 4, k.y + 9 + i * 8.6, l, { size: 7 }));
      box = { x: k.x, y: k.y, w, h: lines.length * 8.6 + 5 };
    }
    if (k.lx != null && k.ly != null) {
      const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
      const sx = k.lx < box.x ? box.x : k.lx > box.x + box.w ? box.x + box.w : cx;
      const sy = sx === cx ? (k.ly < cy ? box.y : box.y + box.h) : cy;
      pen.line(sx, sy, k.lx, k.ly, { lw: 0.6 });
      arrow(pen, k.lx, k.ly, Math.atan2(k.ly - sy, k.lx - sx), 5);
    }
    pen.g.box = box;
    pen.g.leader = k.lx != null ? { x: k.lx, y: k.ly } : null;
  }

  // ---------- scene ----------
  function sheetsOf(p) { return (p.meta.tables === "2" && (p.meta.showWires || p.meta.showBom)) || (p.tables || []).some(t => t.sheet === 2) ? 2 : 1; }
  const customCols = t => t.cols.map(c => ({ h: c.h, align: c.align, max: 220, min: 24 }));
  const customRows = t => t.rows.length ? t.rows : [t.cols.map(() => "")];
  function drawCustomTable(pen, t, x, y) {
    pen.begin("tbl:" + t.id, "table");
    const d = table(pen, x, y, t.title ? t.title.toUpperCase() : "", customCols(t), customRows(t), { size: t.size === "m" ? 7 : 5.8 });
    pen.g.box = { x, y, w: d.w, h: d.h };
    return d;
  }

  function scene(p, opt) {
    opt = opt || {};
    const m = p.meta, S = CD.SHEETS[m.size] || CD.SHEETS.B, W = S.w, H = S.h;
    const sheet = opt.sheet || 1, sheets = sheetsOf(p);
    const pen = new Pen();
    const B = CD.bom(p), find = B.find;
    const out = { W, H, sheet, sheets, groups: pen.groups, ports: [], blocks: {} };

    pen.begin("frame", "frame");
    pen.rect(0, 0, W, H, { s: null, f: PAPER });
    const fr = frame(pen, W, H);
    out.frame = fr;
    const tb = titleBlock(pen, p, fr.R, fr.B, sheet, sheets, opt.images);
    out.tb = tb;

    const wireTbl = () => { const r = CD.wireRows(p).map(x => x.cells); return dropEmptyCols(WIRE_TCOLS, r.length ? r : [WIRE_TCOLS.map(() => "")]); };
    const bomTbl = () => { const r = B.rows.map(x => CD.bomCells(x, m)); return dropEmptyCols(BOM_TCOLS, r.length ? r : [BOM_TCOLS.map(() => "")]); };

    if (sheet === 2) {
      // flow the tables left to right, then down
      let x = fr.L + 12, y = fr.T + 12, rowH = 0;
      const flow = (w, h, draw) => {
        if (x > fr.L + 12 && x + w > fr.R - 12) { x = fr.L + 12; y += rowH + 16; rowH = 0; }
        draw(x, y); x += w + 20; rowH = Math.max(rowH, h);
      };
      if (m.tables === "2" && m.showWires) {
        const t = wireTbl(), d = measureTable("WIRE LIST", t.cols, t.rows);
        flow(d.w, d.h, (xx, yy) => { pen.begin("blk:wires", "table"); table(pen, xx, yy, "WIRE LIST", t.cols, t.rows); pen.g.box = { x: xx, y: yy, w: d.w, h: d.h }; });
      }
      if (m.tables === "2" && m.showBom) {
        const t = bomTbl(), d = measureTable("BILL OF MATERIALS", t.cols, t.rows);
        flow(d.w, d.h, (xx, yy) => { pen.begin("blk:bom", "table"); table(pen, xx, yy, "BILL OF MATERIALS", t.cols, t.rows); pen.g.box = { x: xx, y: yy, w: d.w, h: d.h }; });
      }
      (p.tables || []).filter(t => t.sheet === 2).forEach(t => {
        const d = measureTable(t.title ? t.title.toUpperCase() : "", customCols(t), customRows(t), { size: t.size === "m" ? 7 : 5.8 });
        flow(d.w, d.h, (xx, yy) => drawCustomTable(pen, t, xx, yy));
      });
      return out;
    }

    pen.begin("rev", "rev");
    out.rev = revBlock(pen, p, fr.R, fr.T);

    // layouts
    const connL = {}, cabL = {};
    p.conns.forEach(c => { connL[c.id] = connLayout(p, c); });
    p.cables.forEach(c => { cabL[c.id] = cableLayout(p, c, connL); });
    out.blocks = { conn: connL, cable: cabL };

    // wires (under the blocks)
    const portTo = (e, toward) => {
      const L = e && connL[e.c];
      if (!L) return null;
      if (L.node) return { x: L.x, y: L.y, d: 0 };
      if (L.board) return L.port(e.p);
      const right = toward.x > L.box.x + L.box.w / 2;
      return L.port(e.p, right);
    };
    p.wires.forEach(w => {
      pen.begin("x:" + w.id, "wire");
      const cL = w.cable && cabL[w.cable];
      if (cL) {
        const row = cL.rows.find(r => r.w === w);
        if (!row) return;
        [["a", cL.aLeft], ["b", !cL.aLeft]].forEach(([end, left]) => {
          const cp = { x: left ? cL.x : cL.x + cL.w, y: row.ly, d: left ? -1 : 1 };
          const pp = portTo(w[end], cp);
          if (pp) strokeWire(pen, bezier(pp, cp, pp.d, cp.d), w);
          else if (!(CD.isDrain(w) && p.cables.find(c => c.id === w.cable).shield[end] === "float")) {
            strokeWire(pen, [cp.x, cp.y, cp.x + cp.d * 14, cp.y], w);   // unconnected: trimmed and insulated
            endCap(pen, cp.x, cp.y, cp.d);
          }
        });
      } else {
        const La = w.a && connL[w.a.c], Lb = w.b && connL[w.b.c];
        let pa = null, pb = null;
        if (La && Lb) {
          const ca = { x: La.box.x + La.box.w / 2, y: La.box.y }, cb = { x: Lb.box.x + Lb.box.w / 2, y: Lb.box.y };
          pa = portTo(w.a, cb); pb = portTo(w.b, ca);
        } else if (La) { pa = portTo(w.a, { x: La.box.x + La.box.w + 100 }); pb = { x: pa.x + (pa.d || 1) * 60, y: pa.y, d: -(pa.d || 1), open: true }; }
        else if (Lb) { pb = portTo(w.b, { x: Lb.box.x - 100 }); pa = { x: pb.x + (pb.d || -1) * 60, y: pb.y, d: -(pb.d || -1), open: true }; }
        if (!pa || !pb) return;
        const pts = bezier(pa, pb, pa.d, pb.d);
        strokeWire(pen, pts, w);
        if (pa.open) endCap(pen, pa.x - pa.d * 14, pa.y, pa.d);
        if (pb.open) endCap(pen, pb.x - pb.d * 14, pb.y, pb.d);
        const mid = Math.floor(pts.length / 4) * 2;
        const lbl = [CD.wireRef(p, w), CD.gaugeText(w), CD.colorText(w), CD.num(w.len) != null ? CD.fmtLen(w.len, m) + CD.fmtTol(w.tol, m) : ""].filter(Boolean).join("  ");
        const lw = tw(lbl, 5.8) + 6;
        pen.rect(pts[mid] - lw / 2, pts[mid + 1] - 5, lw, 10, { f: PAPER, lw: 0.5, r: 2 });
        pen.text(pts[mid], pts[mid + 1] + 2.1, lbl, { size: 5.8, anchor: "middle" });
        if (find[w.id]) balloon(pen, pts[mid] + lw / 2 + 8, pts[mid + 1], find[w.id]);
      }
    });

    // shield ties: dashed bond lines from a shield end to a shield end, pin or node
    out.sports = [];
    p.cables.forEach(c => { const L = cabL[c.id]; if (L.sport) ["a", "b"].forEach(e => out.sports.push(Object.assign({ cable: c.id, end: e }, L.sport(e)))); });
    (p.ties || []).forEach(t => {
      const A = cabL[t.a.cable], pa = A && A.sport && A.sport(t.a.end);
      let pb = null;
      if (t.b.t === "shield") { const B = cabL[t.b.cable]; pb = B && B.sport && B.sport(t.b.end); }
      else pb = portTo({ c: t.b.c, p: t.b.p }, pa || { x: 0 });
      if (!pa || !pb) return;
      pen.begin("t:" + t.id, "tie");
      pen.poly(bezier(pa, pb, pa.d, pb.d), { s: "#333333", lw: 1, dash: [4, 2.5], join: "round" });
      pen.circle(pa.x, pa.y, 1.7, { f: INK, s: null });
      pen.circle(pb.x, pb.y, 1.7, { f: INK, s: null });
    });

    p.cables.forEach(c => drawCable(pen, p, c, cabL[c.id], find, connL, m));
    p.conns.forEach(c => drawConn(pen, p, c, connL[c.id], find));
    p.callouts.forEach(k => drawCallout(pen, k));
    (p.tables || []).filter(t => t.sheet !== 2).forEach(t => drawCustomTable(pen, t, t.x, t.y));

    // ports for wiring by drag (screen only)
    p.conns.forEach(c => {
      const L = connL[c.id];
      if (L.node) { out.ports.push({ c: c.id, p: 0, x: L.x, y: L.y }); return; }
      if (L.board) { c.pins.forEach((pn, i) => { const q = L.port(i); out.ports.push({ c: c.id, p: i, x: q.x, y: q.y }); }); return; }
      c.pins.forEach((pn, i) => { const a = L.port(i, false), b = L.port(i, true); out.ports.push({ c: c.id, p: i, x: a.x, y: a.y }, { c: c.id, p: i, x: b.x, y: b.y }); });
    });

    // notes and tables
    if (p.notes.length) {
      const lines = notesBlock(p), h = lines.length * 8.2 + 16;
      const pos = p.pos.notes || { x: fr.L + 10, y: fr.B - h - 10 };
      pen.begin("blk:notes", "table");
      pen.rect(pos.x - 4, pos.y - 2, 368, h + 2, { s: null, f: PAPER });
      pen.text(pos.x, pos.y + 8, "NOTES:", { size: 7.5, bold: true });
      lines.forEach((l, i) => { pen.text(pos.x + 14, pos.y + 18 + i * 8.2, l.n, { size: 6.4, anchor: "end" }); pen.text(pos.x + 18, pos.y + 18 + i * 8.2, l.l, { size: 6.4 }); });
      pen.g.box = { x: pos.x - 4, y: pos.y - 2, w: 368, h: h + 2 };
    }
    if (m.tables !== "2") {
      if (m.showBom) {
        const t = bomTbl(), d = measureTable("BILL OF MATERIALS", t.cols, t.rows);
        const pos = p.pos.bom || { x: fr.R - d.w, y: tb.y - d.h - 10 };
        pen.begin("blk:bom", "table");
        table(pen, pos.x, pos.y, "BILL OF MATERIALS", t.cols, t.rows);
        pen.g.box = { x: pos.x, y: pos.y, w: d.w, h: d.h };
      }
      if (m.showWires) {
        const t = wireTbl(), d = measureTable("WIRE LIST", t.cols, t.rows);
        const pos = p.pos.wires || { x: fr.L + 10, y: fr.T + 10 };
        pen.begin("blk:wires", "table");
        table(pen, pos.x, pos.y, "WIRE LIST", t.cols, t.rows);
        pen.g.box = { x: pos.x, y: pos.y, w: d.w, h: d.h };
      }
    }
    return out;
  }

  // Bounding box of everything the user placed (for fit and auto-placement).
  function contentBox(sc) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    sc.groups.forEach(g => {
      if (!g.box || !/^(conn|cable|callout)$/.test(g.kind)) return;
      x0 = Math.min(x0, g.box.x); y0 = Math.min(y0, g.box.y);
      x1 = Math.max(x1, g.box.x + g.box.w); y1 = Math.max(y1, g.box.y + g.box.h);
    });
    return isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  }

  Object.assign(CD, { boardMargins, boardFit, scene, sheetsOf, contentBox, textWidth: tw, wrapText: wrap, FONT });
})(typeof window !== "undefined" ? window : globalThis);
