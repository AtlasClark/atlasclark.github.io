/*
  Cable Designer — reference library
  Scope: wire colour codes, conductor sizes, sheet sizes and the connector
  library (families, default pin counts, face-view layouts). No DOM access;
  Node tests load it.

  Sources:
  - Colour codes: IEC 60757 letter codes. "BARE" (drain) is not an IEC code.
  - Colour sequence for multi-conductor cables: DIN 47100 (first 12 colours).
  - T568A / T568B: ANSI/TIA-568 pin-to-colour assignment.
  - AWG to mm²: ASTM B258 diameter formula d = 0.127 mm × 92^((36 − n) / 39).
  - D-sub, RJ45, USB pin numbering: common published pinouts.
  Face views are a guide only. Check each pin position against the maker's drawing.
*/
(function (root) {
  "use strict";
  const CD = root.CD = root.CD || {};

  // ---------- colours ----------
  const COLORS = [
    { code: "BK", name: "Black", hex: "#1B1B1B" },
    { code: "BN", name: "Brown", hex: "#7A4614" },
    { code: "RD", name: "Red", hex: "#D8261C" },
    { code: "OG", name: "Orange", hex: "#F2861E" },
    { code: "YE", name: "Yellow", hex: "#F4D40B" },
    { code: "GN", name: "Green", hex: "#25A244" },
    { code: "BU", name: "Blue", hex: "#1F5FD6" },
    { code: "VT", name: "Violet", hex: "#8B3BCB" },
    { code: "GY", name: "Grey", hex: "#8E8E8E" },
    { code: "WH", name: "White", hex: "#FFFFFF" },
    { code: "PK", name: "Pink", hex: "#F59BC4" },
    { code: "TQ", name: "Turquoise", hex: "#25C1C1" },
    { code: "GD", name: "Gold", hex: "#C9A227" },
    { code: "SR", name: "Silver", hex: "#C3C3C3" },
    { code: "GNYE", name: "Green-yellow", hex: "#25A244", stripe: "YE" },
    { code: "BARE", name: "Bare / tinned drain", hex: "#B9B9B9", bare: true }
  ];
  const COLOR = Object.fromEntries(COLORS.map(c => [c.code, c]));
  const DIN47100 = ["WH", "BN", "GN", "YE", "GY", "PK", "BU", "RD", "BK", "VT"];
  // Pair colours per T568B pin 1..8 and the four pairs as pin pairs.
  const T568B = [["WH", "OG"], ["OG", ""], ["WH", "GN"], ["BU", ""], ["WH", "BU"], ["GN", ""], ["WH", "BN"], ["BN", ""]];
  const T568A = [["WH", "GN"], ["GN", ""], ["WH", "OG"], ["BU", ""], ["WH", "BU"], ["OG", ""], ["WH", "BN"], ["BN", ""]];
  const ETH_PAIRS = [[1, 2], [3, 6], [4, 5], [7, 8]];

  // ---------- conductor sizes ----------
  const AWG = [4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32];
  const awgMm2 = n => { const d = 0.127 * Math.pow(92, (36 - n) / 39); return Math.PI / 4 * d * d; };
  const MM2 = ["0.08", "0.14", "0.25", "0.34", "0.5", "0.75", "1", "1.5", "2.5", "4", "6", "10", "16"];
  const INSUL = ["PVC", "PE", "XLPE", "PTFE", "FEP", "ETFE", "XL-ETFE", "Silicone", "TPE", "PUR", "Polyimide"];
  const WIRE_SPECS = ["UL1007", "UL1015", "UL1061", "UL1569", "UL3265", "M22759/16", "M22759/32", "M16878/4"];

  // ---------- sheets (points, landscape) ----------
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

  // ---------- connector library ----------
  // face: dsub {rows} | circ {ring, center, start} | grid {rows, order} | row | one {icon} | none
  // var: pin count can change (min..max). sig: default signal names.
  const L = [];
  const add = (group, key, name, o) => L.push(Object.assign({ group, key, name, pins: 1, gender: true, kind: "conn" }, o));

  add("D-sub", "de9", "D-sub DE-9", { pins: 9, face: { t: "dsub", rows: [5, 4] } });
  add("D-sub", "da15", "D-sub DA-15", { pins: 15, face: { t: "dsub", rows: [8, 7] } });
  add("D-sub", "db25", "D-sub DB-25", { pins: 25, face: { t: "dsub", rows: [13, 12] } });
  add("D-sub", "dc37", "D-sub DC-37", { pins: 37, face: { t: "dsub", rows: [19, 18] } });
  add("D-sub", "dd50", "D-sub DD-50", { pins: 50, face: { t: "dsub", rows: [17, 16, 17] } });
  add("D-sub", "de15hd", "D-sub DE-15 high density", { pins: 15, face: { t: "dsub", rows: [5, 5, 5] } });

  add("Circular", "m8_3", "M8, 3 pin", { pins: 3, labels: ["1", "3", "4"], face: { t: "circ", ring: 3 } });
  add("Circular", "m8_4", "M8, 4 pin", { pins: 4, face: { t: "circ", ring: 4 } });
  add("Circular", "m12a4", "M12 A-coded, 4 pin", { pins: 4, face: { t: "circ", ring: 4 } });
  add("Circular", "m12a5", "M12 A-coded, 5 pin", { pins: 5, face: { t: "circ", ring: 4, center: true } });
  add("Circular", "m12a8", "M12 A-coded, 8 pin", { pins: 8, face: { t: "circ", ring: 7, center: true } });
  add("Circular", "circ", "Circular, custom", { pins: 6, var: [1, 128], face: { t: "circ" } });

  add("Wire-to-board", "pitch100", "Crimp housing, 1 row, 1.00 mm (JST SH style)", { pins: 4, var: [1, 40], face: { t: "grid", rows: 1, pitch: 1.0 } });
  add("Wire-to-board", "pitch125", "Crimp housing, 1 row, 1.25 mm (JST GH / Molex PicoBlade style)", { pins: 4, var: [1, 40], face: { t: "grid", rows: 1, pitch: 1.25 } });
  add("Wire-to-board", "pitch200", "Crimp housing, 1 row, 2.00 mm (JST PH style)", { pins: 4, var: [1, 40], face: { t: "grid", rows: 1, pitch: 2.0 } });
  add("Wire-to-board", "pitch250", "Crimp housing, 1 row, 2.50 mm (JST XH style)", { pins: 4, var: [1, 40], face: { t: "grid", rows: 1, pitch: 2.5 } });
  add("Wire-to-board", "pitch254", "Crimp housing, 1 row, 2.54 mm (Molex KK 254 style)", { pins: 4, var: [1, 40], face: { t: "grid", rows: 1, pitch: 2.54 } });
  add("Wire-to-board", "pitch300d", "Crimp housing, 2 rows, 3.00 mm (Molex Micro-Fit 3.0 style)", { pins: 6, var: [2, 40], even: true, face: { t: "grid", rows: 2, order: "rows", pitch: 3.0 } });
  add("Wire-to-board", "pitch420d", "Crimp housing, 2 rows, 4.20 mm (Molex Mini-Fit Jr. style)", { pins: 6, var: [2, 40], even: true, face: { t: "grid", rows: 2, order: "rows", pitch: 4.2 } });
  add("Wire-to-board", "idc254", "IDC socket, 2 rows, 2.54 mm", { pins: 10, var: [2, 80], even: true, gender: true, face: { t: "grid", rows: 2, order: "zigzag", pitch: 2.54 } });
  add("Wire-to-board", "tb", "Terminal block (pluggable)", { pins: 4, var: [1, 40], face: { t: "grid", rows: 1, pitch: 5.0 } });

  add("Data", "rj45", "RJ45 8P8C modular plug", { pins: 8, gender: false, face: { t: "grid", rows: 1, pitch: 1.02, modular: true } });
  add("Data", "rj12", "RJ12 6P6C modular plug", { pins: 6, gender: false, face: { t: "grid", rows: 1, pitch: 1.02, modular: true } });
  add("Data", "usba", "USB Type-A", { pins: 4, sig: ["VBUS", "D-", "D+", "GND"], face: { t: "grid", rows: 1, usb: true } });
  add("Data", "usbmicrob", "USB Micro-B", { pins: 5, sig: ["VBUS", "D-", "D+", "ID", "GND"], face: { t: "grid", rows: 1, usb: true } });

  add("Terminals", "ring", "Ring terminal", { gender: false, kind: "term", face: { t: "one", icon: "ring" } });
  add("Terminals", "fork", "Fork (spade) terminal", { gender: false, kind: "term", face: { t: "one", icon: "fork" } });
  add("Terminals", "qd", "Quick-disconnect receptacle", { gender: false, kind: "term", face: { t: "one", icon: "qd" } });
  add("Terminals", "ferrule", "Ferrule", { gender: false, kind: "term", face: { t: "one", icon: "ferrule" } });
  add("Terminals", "flying", "Flying leads (strip and tin)", { pins: 2, var: [1, 64], gender: false, kind: "flying", face: { t: "none" } });

  add("Boards", "board", "Junction board", { pins: 4, var: [1, 200], gender: false, kind: "board", face: { t: "none" } });

  add("Nodes", "splice", "Splice", { gender: false, kind: "splice", face: { t: "none" } });
  add("Nodes", "ground", "Ground (chassis)", { gender: false, kind: "ground", face: { t: "none" } });

  add("Custom", "custom", "Custom connector", { pins: 4, var: [1, 200], face: { t: "grid", rows: 1 }, custom: true });

  const LIB = Object.fromEntries(L.map(e => [e.key, e]));

  const GENDERS = [["male", "Male (pins)"], ["female", "Female (sockets)"], ["none", "Not set"]];
  const SHIELDS = [["none", "None"], ["foil", "Foil"], ["braid", "Braid"], ["foil+braid", "Foil + braid"], ["spiral", "Spiral"]];
  const SHIELD_TERMS = [["pigtail", "Pigtail / drain to pin"], ["360", "360° to shell"], ["tied", "Tied (see shield ties)"], ["float", "Floating (trim, insulate)"], ["none", "Not set"]];
  const MARKS = [["label", "Label / marker"], ["heatshrink", "Heat-shrink"], ["sleeve", "Sleeving"], ["tie", "Cable tie"], ["boot", "Boot / strain relief"], ["tape", "Tape"], ["other", "Other"]];
  // Bought and cut by length (BOM in the drawing's length unit); the other kinds are counted.
  const LEN_MARKS = ["heatshrink", "sleeve", "tape"];
  const MARK_ENDS = [["A", "End A"], ["B", "End B"], ["both", "Both ends"], ["mid", "Middle"], ["all", "Full length"]];

  // ---------- face-view pin positions ----------
  // Returns { shape, w, h, pins: [{x, y}] } in points, origin top-left, viewed from the mating side.
  // Female mating faces are the mirror image of the male.
  function faceLayout(c) {
    if (c.layout) return customFace(c);
    const lib = LIB[c.lib] || LIB.custom;
    const f = Object.assign({}, lib.face, c.custom && lib.custom ? c.custom : null);
    const n = c.pins.length;
    const P = [];
    if (f.t === "dsub") {
      const rows = f.rows, maxN = Math.max(...rows), sp = 9.5, rh = 11;
      const w = maxN * sp + 18, h = rows.length * rh + 12;
      let k = 0;
      rows.forEach((cnt, r) => {
        const off = (maxN - cnt) * sp / 2;
        for (let i = 0; i < cnt; i++) P[k++] = { x: 9 + off + sp / 2 + i * sp, y: 6 + rh / 2 + r * rh };
      });
      return finish({ shape: "dsub", w, h, rowsN: rows.length }, P, c);
    }
    if (f.t === "circ") {
      const ring = f.ring || (f.center ? n - 1 : n), R = Math.max(14, ring * 3.4), w = R * 2 + 18;
      const cx = w / 2, cy = w / 2;
      for (let i = 0; i < ring; i++) {
        const a = (225 + i * 360 / ring) * Math.PI / 180;   // pin 1 upper left, then clockwise
        P[i] = { x: cx + Math.cos(a) * (R - 4), y: cy + Math.sin(a) * (R - 4) };
      }
      if (f.center) P[ring] = { x: cx, y: cy };
      for (let i = P.length; i < n; i++) P[i] = { x: cx, y: cy };
      return finish({ shape: "circ", w, h: w, R, cx, cy }, P, c);
    }
    if (f.t === "grid") {
      const rows = Math.max(1, Math.min(f.rows || 1, n)), cols = Math.ceil(n / rows), sp = 10, rh = 11;
      const w = Math.max(cols * sp + 14, 30), h = rows * rh + 14;
      for (let i = 0; i < n; i++) {
        let r, col;
        if (rows === 1) { r = 0; col = i; }
        else if (f.order === "zigzag") { r = i % rows; col = Math.floor(i / rows); }
        else { r = Math.floor(i / cols); col = i % cols; }
        P[i] = { x: 7 + sp / 2 + col * sp, y: 7 + rh / 2 + r * rh };
      }
      return finish({ shape: f.modular ? "modular" : f.usb ? "usb" : "rect", w, h }, P, c);
    }
    if (f.t === "one") return { shape: "icon", icon: f.icon, w: 46, h: 26, pins: [] };
    return null;
  }
  function finish(g, P, c) {
    if (c.gender === "female") P = P.map(p => p && { x: g.w - p.x, y: p.y });
    if (c.faceFrom === "rear") P = P.map(p => p && { x: g.w - p.x, y: p.y });
    g.pins = P;
    return g;
  }

  // ---------- custom face layouts (face builder) ----------
  // Layout in mm, origin at the face centre, y down, drawn as seen looking into the mating face
  // of this part (no automatic mirror for gender). Pin i belongs to connector pin i.
  // { shape: circle | rect | dsub | none, w, h, r, size: 1-3, keys: [{kind, ang, w}], pins: [{x, y, d, sq}] }
  const SHELLS = [["circle", "Circular"], ["rect", "Rectangular"], ["dsub", "D-shaped (D-sub)"], ["none", "No shell"]];
  const KEY_KINDS = [["notch", "Keyway (notch)"], ["key", "Key (raised)"], ["latch", "Latch / ramp"]];
  const FACE_SIZES = { 1: [90, 70], 2: [130, 100], 3: [190, 150] };
  const fnum = (v, d) => { const n = parseFloat(v); return isFinite(n) ? n : d; };
  function normLayout(l, n) {
    if (!l || typeof l !== "object") return null;
    const shape = SHELLS.some(x => x[0] === l.shape) ? l.shape : "circle";
    const out = {
      shape, w: Math.max(1, fnum(l.w, 20)), h: Math.max(1, fnum(l.h, 20)), r: Math.max(0, fnum(l.r, 1)),
      size: [1, 2, 3].includes(+l.size) ? +l.size : 2,
      keys: (Array.isArray(l.keys) ? l.keys : []).map(k => ({ kind: KEY_KINDS.some(x => x[0] === k.kind) ? k.kind : "notch", ang: fnum(k.ang, 0), w: Math.max(0.2, fnum(k.w, 2)) })),
      pins: (Array.isArray(l.pins) ? l.pins : []).map(p => ({ x: fnum(p.x, 0), y: fnum(p.y, 0), d: Math.max(0.2, fnum(p.d, 1)), sq: !!p.sq }))
    };
    while (out.pins.length < n) out.pins.push({ x: 0, y: 0, d: 1, sq: false });
    out.pins.length = n;
    return out;
  }
  // Edge point of the shell on the ray at angle a (degrees, 0 = top, clockwise), with the outward normal.
  function shellEdge(L, a) {
    const t = a * Math.PI / 180, nx = Math.sin(t), ny = -Math.cos(t);
    if (L.shape === "circle") { const R = L.w / 2; return { x: nx * R, y: ny * R, nx, ny }; }
    const hw = L.w / 2, hh = L.h / 2;
    const k = Math.min(Math.abs(nx) > 1e-9 ? hw / Math.abs(nx) : Infinity, Math.abs(ny) > 1e-9 ? hh / Math.abs(ny) : Infinity);
    const x = nx * k, y = ny * k;
    return Math.abs(Math.abs(x) - hw) < 1e-6 ? { x, y, nx: Math.sign(x), ny: 0 } : { x, y, nx: 0, ny: Math.sign(y) };
  }
  // Shell and key outlines in mm, drawn by both the scene and the face builder.
  function layoutGeom(L) {
    const g = [];
    if (L.shape === "circle") g.push({ t: "circle", cx: 0, cy: 0, r: L.w / 2 });
    else if (L.shape === "rect") g.push({ t: "rect", x: -L.w / 2, y: -L.h / 2, w: L.w, h: L.h, r: Math.min(L.r, L.w / 2, L.h / 2) });
    else if (L.shape === "dsub") { const i = L.h * 0.22, hw = L.w / 2, hh = L.h / 2; g.push({ t: "poly", pts: [-hw, -hh, hw, -hh, hw - i, hh, -hw + i, hh], close: true }); }
    if (L.shape !== "none") L.keys.forEach(k => {
      const e = shellEdge(L, k.ang), tx = -e.ny, ty = e.nx, hw = k.w / 2, d = Math.max(0.6, k.w * 0.55) * (k.kind === "notch" ? -1 : 1);
      g.push({ t: "poly", key: k.kind, close: true, pts: [e.x + tx * hw, e.y + ty * hw, e.x + tx * hw + e.nx * d, e.y + ty * hw + e.ny * d, e.x - tx * hw + e.nx * d, e.y - ty * hw + e.ny * d, e.x - tx * hw, e.y - ty * hw] });
    });
    return g;
  }
  function layoutBounds(L) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const add = (x, y) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); };
    layoutGeom(L).forEach(o => {
      if (o.t === "circle") { add(o.cx - o.r, o.cy - o.r); add(o.cx + o.r, o.cy + o.r); }
      else if (o.t === "rect") { add(o.x, o.y); add(o.x + o.w, o.y + o.h); }
      else for (let i = 0; i < o.pts.length; i += 2) add(o.pts[i], o.pts[i + 1]);
    });
    L.pins.forEach(p => { add(p.x - p.d, p.y - p.d); add(p.x + p.d, p.y + p.d); });
    if (!isFinite(x0)) return { x0: -5, y0: -5, x1: 5, y1: 5 };
    return { x0, y0, x1, y1 };
  }
  function customFace(c) {
    const L = normLayout(c.layout, c.pins.length), b = layoutBounds(L), [mw, mh] = FACE_SIZES[L.size];
    const pad = 5, k = Math.min(mw / Math.max(1, b.x1 - b.x0), mh / Math.max(1, b.y1 - b.y0));
    const w = (b.x1 - b.x0) * k + pad * 2, h = (b.y1 - b.y0) * k + pad * 2;
    const mir = c.faceFrom === "rear" ? -1 : 1;
    const ox = w / 2 - mir * (b.x0 + b.x1) / 2 * k, oy = pad - b.y0 * k;
    const tx = x => ox + mir * x * k, ty = y => oy + y * k;
    return {
      shape: "custom", w, h, k, cx: tx(0), cy: ty(0), L,
      geom: layoutGeom(L).map(o => o.t === "circle" ? Object.assign({}, o, { cx: tx(o.cx), cy: ty(o.cy), r: o.r * k })
        : o.t === "rect" ? Object.assign({}, o, { x: Math.min(tx(o.x), tx(o.x + o.w)), y: ty(o.y), w: o.w * k, h: o.h * k, r: o.r * k })
        : Object.assign({}, o, { pts: o.pts.map((v, i) => i % 2 ? ty(v) : tx(v)) })),
      pins: L.pins.map(p => ({ x: tx(p.x), y: ty(p.y), r: Math.max(1.3, p.d / 2 * k), sq: p.sq }))
    };
  }
  // Start a custom layout from the library face (about 0.3 mm per point), as seen on the mating face.
  function layoutFromFace(c) {
    const f = faceLayout(Object.assign({}, c, { layout: null, faceFrom: "mate" }));
    const MM = 0.3, n = c.pins.length;
    if (!f || f.shape === "icon") return normLayout({ shape: "circle", w: 16, keys: [{ kind: "notch", ang: 0, w: 1.6 }], pins: ringPins(n, 5, 0, false, 1.3) }, n);
    const shape = f.shape === "circ" ? "circle" : f.shape === "dsub" ? "dsub" : "rect";
    const w = shape === "circle" ? f.R * 2 * MM : f.w * MM, h = shape === "circle" ? w : f.h * MM;
    const cx = shape === "circle" ? f.cx : f.w / 2, cy = shape === "circle" ? f.cy : f.h / 2;
    const keys = shape === "circle" ? [{ kind: "notch", ang: 0, w: 1.6 }] : f.shape === "modular" ? [{ kind: "latch", ang: 180, w: 3.6 }] : f.shape === "rect" ? [{ kind: "latch", ang: 0, w: 3 }] : [];
    return normLayout({
      shape, w: +w.toFixed(2), h: +h.toFixed(2), r: shape === "rect" ? 0.5 : 0, keys,
      pins: f.pins.map(p => p ? { x: +((p.x - cx) * MM).toFixed(2), y: +((p.y - cy) * MM).toFixed(2), d: 1.3 } : { x: 0, y: 0, d: 1.3 })
    }, n);
  }
  // Pin generators for the face builder (mm). Angles: 0 = top, clockwise.
  function ringPins(n, r, start, ccw, d) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = (start + (ccw ? -1 : 1) * i * 360 / n) * Math.PI / 180;
      out.push({ x: +(Math.sin(a) * r).toFixed(3), y: +(-Math.cos(a) * r).toFixed(3), d, sq: false });
    }
    return out;
  }
  function gridPins(rows, cols, px, py, order, d) {
    const out = [];
    for (let i = 0; i < rows * cols; i++) {
      const byCol = order === "zigzag" || order === "cols";
      const r = byCol ? i % rows : Math.floor(i / cols), c = byCol ? Math.floor(i / rows) : i % cols;
      out.push({ x: +((c - (cols - 1) / 2) * px).toFixed(3), y: +((r - (rows - 1) / 2) * py).toFixed(3), d, sq: false });
    }
    return out;
  }
  // Pin order for renumbering: rings (outer ring first, clockwise from top, centre last) or rows.
  function sortPinOrder(pins, mode) {
    const idx = pins.map((p, i) => i);
    const ang = p => { let a = Math.atan2(p.x, -p.y); if (a < -1e-9) a += Math.PI * 2; return a; };
    const ring = p => Math.round(Math.hypot(p.x, p.y) * 4);
    if (mode === "rings") idx.sort((a, b) => ring(pins[b]) - ring(pins[a]) || (ring(pins[a]) ? ang(pins[a]) - ang(pins[b]) : 0));
    else idx.sort((a, b) => Math.round(pins[a].y * 4) - Math.round(pins[b].y * 4) || pins[a].x - pins[b].x);
    return idx;
  }

  Object.assign(CD, {
    SHELLS, KEY_KINDS, normLayout, layoutGeom, layoutBounds, layoutFromFace, ringPins, gridPins, sortPinOrder,
    COLORS, COLOR, DIN47100, T568A, T568B, ETH_PAIRS,
    AWG, awgMm2, MM2, INSUL, WIRE_SPECS, SHEETS,
    LIB, LIB_LIST: L, GENDERS, SHIELDS, SHIELD_TERMS, MARKS, LEN_MARKS, MARK_ENDS, faceLayout
  });
})(typeof window !== "undefined" ? window : globalThis);
