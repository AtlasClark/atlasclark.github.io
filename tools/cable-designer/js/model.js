/*
  Cable Designer — data model
  Scope: project records (connectors, cables, wires, twist groups, shields,
  cable markings, callouts, notes, revision history, title-block data),
  normalize for saved files, conductor order, wire list (from-to), generated
  BOM with find numbers, design checks, CSV text and an example project.
  No DOM access; Node tests load it.
*/
(function (root) {
  "use strict";
  const CD = root.CD = root.CD || {};
  const FORMAT = "atlas-cable", VERSION = 1;

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const pad2 = n => String(n).padStart(2, "0");
  const today = () => { const d = new Date(); return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); };
  const str = v => v == null ? "" : String(v);
  const num = v => { const n = parseFloat(String(v == null ? "" : v).replace(",", ".")); return isFinite(n) ? n : null; };

  // ---------- records ----------
  const blankMeta = () => ({
    dwgNo: "", title: "", rev: "", size: "B", scale: "NTS", units: "in", tol: "", alt: false,
    drawn: "", drawnDate: today(), checked: "", checkedDate: "", approved: "", approvedDate: "",
    company: "", notice: "", ws: "", tables: "1", showWires: true, showBom: true
  });
  const blankProject = () => ({
    format: FORMAT, v: VERSION, meta: blankMeta(),
    pos: { wires: null, bom: null, notes: null },
    blk: { wires: { size: "s", k: 1, wrap: true, colW: 0 }, bom: { size: "s", k: 1, wrap: true, colW: 0 }, notes: { size: "m", k: 1 } },
    history: [], notes: [], conns: [], cables: [], wires: [], callouts: [], ties: [], tables: []
  });

  const REF_PREFIX = { conn: "P", term: "E", flying: "FL", splice: "SP", ground: "GND", board: "A" };
  function nextRef(p, prefix) {
    const used = new Set([...p.conns, ...p.cables].map(o => o.ref));
    for (let i = 1; ; i++) if (!used.has(prefix + i)) return prefix + i;
  }
  const part = o => Object.assign({ mfr: "", mpn: "", ipn: "", desc: "" }, o);

  function newConn(p, libKey, x, y) {
    const lib = CD.LIB[libKey] || CD.LIB.custom;
    const n = lib.pins;
    const pins = [];
    for (let i = 0; i < n; i++) pins.push({ n: lib.labels ? lib.labels[i] : String(i + 1), sig: lib.sig ? lib.sig[i] || "" : "" });
    return {
      id: uid(), ref: nextRef(p, REF_PREFIX[lib.kind] || "P"), lib: lib.key,
      gender: lib.gender ? "female" : "none", pins,
      desc: "", mfr: "", mpn: "", ipn: "",
      term: part(), seal: part(), acc: [],
      face: !!(lib.face && lib.face.t !== "none"), faceFrom: "mate",
      custom: lib.custom ? { rows: 1, order: "rows" } : null, layout: null,
      strip: "", note: "", x: Math.round(x || 0), y: Math.round(y || 0),
      board: lib.kind === "board" ? { w: 150, h: 100, pins: boardPins(n) } : null
    };
  }
  // Junction board pins: half on the left edge, half on the right, evenly spaced (t = 0..1 along the edge).
  function boardPins(n, sides) {
    const out = [], left = sides === "R" ? 0 : sides === "L" ? n : Math.ceil(n / 2), right = n - left;
    for (let i = 0; i < left; i++) out.push({ side: "L", t: (i + 1) / (left + 1) });
    for (let i = 0; i < right; i++) out.push({ side: "R", t: (i + 1) / (right + 1) });
    return out;
  }
  const SIDES = ["L", "R", "T", "B"];
  function normBoard(b, n) {
    if (!b || typeof b !== "object") return null;
    const pins = (Array.isArray(b.pins) ? b.pins : []).map(x => ({ side: SIDES.includes(x && x.side) ? x.side : "L", t: Math.max(0, Math.min(1, num(x && x.t) == null ? 0.5 : num(x.t))) }));
    while (pins.length < n) pins.push({ side: "R", t: 0.5 });
    pins.length = n;
    const im = b.img && typeof b.img.data === "string" && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(b.img.data) && num(b.img.w) > 0 && num(b.img.h) > 0
      ? { data: b.img.data, w: num(b.img.w), h: num(b.img.h) } : null;
    return { w: Math.max(60, num(b.w) || 150), h: Math.max(40, num(b.h) || 100), pins, img: im };
  }
  function setPinCount(p, c, n) {
    const lib = CD.LIB[c.lib] || CD.LIB.custom;
    const v = lib.var || [c.pins.length, c.pins.length];
    n = Math.max(v[0], Math.min(v[1], Math.round(n) || v[0]));
    if (lib.even && n % 2) n++;
    while (c.pins.length < n) c.pins.push({ n: String(c.pins.length + 1), sig: "" });
    c.pins.length = n;
    if (c.layout) c.layout = CD.normLayout(c.layout, n);
    if (c.board) c.board = normBoard(c.board, n);
    p.wires.forEach(w => ["a", "b"].forEach(e => { if (w[e] && w[e].c === c.id && w[e].p >= n) w[e] = null; }));
    p.ties = (p.ties || []).filter(t => !(t.b.t === "pin" && t.b.c === c.id && t.b.p >= n));
    return n;
  }

  // ---------- face builder pin edits (wire ends follow their pin) ----------
  // order: new index → old index. Old pins not in order are removed; their wire ends are cleared.
  function reorderPins(p, c, order) {
    const map = new Map(order.map((old, i) => [old, i]));
    const L = c.layout;
    c.pins = order.map(i => c.pins[i]);
    if (L) L.pins = order.map(i => L.pins[i]);
    if (c.board) c.board.pins = order.map(i => c.board.pins[i]);
    p.wires.forEach(w => ["a", "b"].forEach(e => {
      if (!w[e] || w[e].c !== c.id) return;
      w[e] = map.has(w[e].p) ? { c: c.id, p: map.get(w[e].p) } : null;
    }));
    p.ties = (p.ties || []).filter(t => {
      if (t.b.t !== "pin" || t.b.c !== c.id) return true;
      if (!map.has(t.b.p)) return false;
      t.b.p = map.get(t.b.p);
      return true;
    });
  }
  function removePins(p, c, idxs) {
    const drop = new Set(idxs);
    reorderPins(p, c, c.pins.map((x, i) => i).filter(i => !drop.has(i)));
  }
  // Appends pins numbered after the highest numeric pin number; layout pins in mm.
  function addPins(c, list) {
    let next = c.pins.reduce((m, x) => Math.max(m, parseInt(x.n, 10) || 0), 0);
    list.forEach(lp => {
      c.pins.push({ n: lp && lp.n != null ? String(lp.n) : String(++next), sig: lp && lp.sig || "" });
      if (c.layout) c.layout.pins.push(Object.assign({ x: 0, y: 0, d: 1, sq: false }, lp && { x: lp.x, y: lp.y, d: lp.d, sq: lp.sq }));
      if (c.board) c.board.pins.push({ side: lp && lp.side || "R", t: lp && lp.t != null ? lp.t : 0.5 });
    });
  }
  // Spread a board's pins evenly along each edge, keeping their order.
  function spaceBoardPins(c) {
    if (!c.board) return;
    SIDES.forEach(s => {
      const on = c.board.pins.filter(x => x.side === s).sort((a, b) => a.t - b.t);
      on.forEach((x, i) => { x.t = (i + 1) / (on.length + 1); });
    });
  }

  // ---------- shield ties ----------
  // { id, a: { cable, end }, b: { t: "shield", cable, end } | { t: "pin", c, p } }
  const newTie = (a, b) => ({ id: uid(), a: { cable: a.cable, end: a.end }, b: b.t === "shield" ? { t: "shield", cable: b.cable, end: b.end } : { t: "pin", c: b.c, p: b.p } });
  function tieKey(e) { return e.t === "pin" ? "p:" + e.c + ":" + e.p : "s:" + e.cable + ":" + e.end; }
  // Adds a tie unless the same pair is already tied. Sets the shield end(s) to "tied".
  function addTie(p, a, b) {
    const ka = tieKey(Object.assign({ t: "shield" }, a)), kb = tieKey(b);
    if (ka === kb) return null;
    if (p.ties.some(t => { const x = tieKey(Object.assign({ t: "shield" }, t.a)), y = tieKey(t.b); return (x === ka && y === kb) || (x === kb && y === ka); })) return null;
    const t = newTie(a, b);
    p.ties.push(t);
    const set = e => { const c = byId(p.cables, e.cable); if (c && c.shield.type !== "none") c.shield[e.end] = "tied"; };
    set(a); if (b.t === "shield") set(b);
    return t;
  }
  function shieldText(p, cable, end) { const c = byId(p.cables, cable); return c ? c.ref + " shield " + end.toUpperCase() : "?"; }
  function tieTargetText(p, b) { return b.t === "shield" ? shieldText(p, b.cable, b.end) : endText(p, { c: b.c, p: b.p }); }
  function tiesOf(p, cable, end) {
    return p.ties.filter(t => (t.a.cable === cable && t.a.end === end) || (t.b.t === "shield" && t.b.cable === cable && t.b.end === end));
  }
  // Removes ties that point at a cable, connector or pin that is gone.
  function pruneTies(p) {
    const cab = new Set(p.cables.map(c => c.id));
    p.ties = (p.ties || []).filter(t => cab.has(t.a.cable) && (t.b.t === "shield" ? cab.has(t.b.cable) : (() => { const c = byId(p.conns, t.b.c); return c && t.b.p < c.pins.length; })()));
  }

  // ---------- junction board in a cable ----------
  // Cuts the cable at a new board: the cable's end B lands on the board's left pins, a new cable
  // (copy of this one, length to set) runs from the right pins to the old end B. Shields are tied
  // through "SH" pins. Returns { board, cable }.
  function insertBoard(p, cable) {
    const list = conductors(p, cable), drains = list.filter(isDrain), cond = list.filter(w => !isDrain(w));
    const shielded = cable.shield.type !== "none";
    const n = cond.length, b = newConn(p, "board", cable.x, cable.y);
    b.pins = []; b.board.pins = [];
    cond.forEach((w, i) => { b.pins.push({ n: String(i + 1), sig: sigOf(p, w) }); b.board.pins.push({ side: "L", t: 0 }); });
    if (shielded) { b.pins.push({ n: "SH1", sig: "SHIELD" }); b.board.pins.push({ side: "L", t: 0 }); }
    cond.forEach((w, i) => { b.pins.push({ n: String(n + i + 1), sig: sigOf(p, w) }); b.board.pins.push({ side: "R", t: 0 }); });
    if (shielded) { b.pins.push({ n: "SH2", sig: "SHIELD" }); b.board.pins.push({ side: "R", t: 0 }); }
    b.board.h = Math.max(100, (n + (shielded ? 1 : 0)) * 14 + 40);
    spaceBoardPins(b);
    p.conns.push(b);
    const shL = shielded ? n : -1, shR = shielded ? 2 * n + 1 : -1, rOff = n + (shielded ? 1 : 0);
    const c2 = newCable(p, cable.x, cable.y, JSON.parse(JSON.stringify(Object.assign({}, cable, { id: undefined, ref: undefined, x: undefined, y: undefined }))));
    c2.id = uid(); c2.ref = nextRef(p, "W"); c2.len = ""; c2.marks = []; c2.groups = [];
    p.cables.push(c2);
    const map = {};
    list.forEach(w => {
      const w2 = newWire(p, Object.assign(JSON.parse(JSON.stringify(w)), { id: uid(), ref: "", cable: c2.id, a: null, b: w.b }));
      map[w.id] = w2.id;
      const k = cond.indexOf(w);
      if (k >= 0) { w.b = { c: b.id, p: k }; w2.a = { c: b.id, p: rOff + k }; }
      else if (shielded) { w.b = { c: b.id, p: shL }; w2.a = { c: b.id, p: shR }; }
      else { w.b = null; }
      p.wires.push(w2);
    });
    c2.groups = cable.groups.map(g => newGroup(g.wires.map(id => map[id]).filter(Boolean), { lay: g.lay, shield: g.shield }));
    if (shielded) {
      p.ties.forEach(t => { if (t.a.cable === cable.id && t.a.end === "b") t.a.cable = c2.id; if (t.b.t === "shield" && t.b.cable === cable.id && t.b.end === "b") t.b.cable = c2.id; });
      c2.shield.b = cable.shield.b;
      addTie(p, { cable: cable.id, end: "b" }, { t: "pin", c: b.id, p: shL });
      addTie(p, { cable: c2.id, end: "a" }, { t: "pin", c: b.id, p: shR });
    }
    void drains;
    return { board: b, cable: c2 };
  }

  // ---------- saved parts ("My parts") ----------
  const PART_KEYS = ["lib", "gender", "desc", "mfr", "mpn", "ipn", "term", "seal", "acc", "face", "faceFrom", "custom", "layout", "board", "strip", "note"];
  function partFromConn(c, name) {
    const o = { id: uid(), type: "conn", name: str(name) || c.desc || c.mpn || CD.libOf(c).name };
    PART_KEYS.forEach(k => { o[k] = JSON.parse(JSON.stringify(c[k] == null ? null : c[k])); });
    o.pins = c.pins.map(x => ({ n: x.n }));
    return o;
  }
  function normPart(o) {
    if (o && o.type === "cable") return normCablePart(o);
    if (o && o.type === "wire") return normWirePart(o);
    if (!o || typeof o !== "object" || !Array.isArray(o.pins) || !o.pins.length) return null;
    const tmp = normalize({ conns: [Object.assign({}, o, { id: "x", pins: o.pins.map(x => ({ n: str(x && x.n), sig: "" })) })] }).conns[0];
    const out = { id: str(o.id) || uid(), type: "conn", name: str(o.name) || tmp.desc || CD.libOf(tmp).name };
    PART_KEYS.forEach(k => { out[k] = tmp[k]; });
    out.pins = tmp.pins.map(x => ({ n: x.n }));
    return out;
  }
  // Cable and wire profiles: what defines the cable or wire as bought. Lengths, strip lengths, labels,
  // sleeving, ends, signals, shield terminations and references stay with each drawing.
  const WIRE_KEYS = ["gauge", "gu", "color", "stripe", "insul", "spec", "mfr", "mpn", "ipn"];
  function wireProfile(w) {
    const o = {};
    WIRE_KEYS.forEach(k => { o[k] = str(w && w[k]).slice(0, 80); });
    if (o.gu !== "mm2") o.gu = "AWG";
    if (!CD.COLOR[o.color]) o.color = "BK";
    if (o.stripe && (!CD.COLOR[o.stripe] || CD.COLOR[o.stripe].bare)) o.stripe = "";
    return o;
  }
  const wireName = w => [gaugeText(w), colorText(w), w.insul, w.spec].filter(Boolean).join(" ") || "Wire";
  function partFromWire(w, name) { const wp = wireProfile(w); return { id: uid(), type: "wire", name: str(name) || wireName(wp), wire: wp }; }
  function normWirePart(o) {
    if (!o || typeof o !== "object" || !o.wire || typeof o.wire !== "object") return null;
    const wp = wireProfile(o.wire);
    return { id: str(o.id) || uid(), type: "wire", name: str(o.name) || wireName(wp), wire: wp };
  }
  function applyWirePart(w, part) { Object.assign(w, wireProfile(part.wire)); }

  function partFromCable(p, c, name) {
    const list = conductors(p, c);
    return normCablePart({
      id: uid(), type: "cable", name: str(name) || c.desc || c.mpn || "Cable",
      cable: { kind: c.kind, desc: c.desc, mfr: c.mfr, mpn: c.mpn, ipn: c.ipn, jacket: c.jacket, jcolor: c.jcolor, od: c.od, shield: c.shield.type },
      conductors: list.map(wireProfile),
      groups: c.groups.map(g => ({ wires: g.wires.map(id => list.findIndex(w => w.id === id)), lay: g.lay, shield: g.shield }))
    });
  }
  function normCablePart(o) {
    if (!o || typeof o !== "object") return null;
    const cb = o.cable && typeof o.cable === "object" ? o.cable : {};
    const conds = (Array.isArray(o.conductors) ? o.conductors : []).slice(0, 200).map(wireProfile);
    if (!conds.length) return null;
    const used = new Set();
    const groups = (Array.isArray(o.groups) ? o.groups : []).map(g => ({
      wires: [...new Set((g && Array.isArray(g.wires) ? g.wires : []).filter(i => Number.isInteger(i) && i >= 0 && i < conds.length && !used.has(i)))],
      lay: str(g && g.lay).slice(0, 20), shield: ["foil", "braid"].includes(g && g.shield) ? g.shield : "none"
    })).filter(g => g.wires.length > 1 && (g.wires.forEach(i => used.add(i)), true));
    const s = k => str(cb[k]).slice(0, 200);
    return {
      id: str(o.id) || uid(), type: "cable", name: str(o.name) || s("desc") || "Cable",
      cable: {
        kind: cb.kind === "bundle" ? "bundle" : "cable", desc: s("desc"), mfr: s("mfr"), mpn: s("mpn"), ipn: s("ipn"),
        jacket: s("jacket"), jcolor: CD.COLOR[cb.jcolor] && !CD.COLOR[cb.jcolor].bare ? cb.jcolor : "", od: s("od"),
        shield: CD.SHIELDS.some(x => x[0] === cb.shield) ? cb.shield : "none"
      },
      conductors: conds, groups
    };
  }
  function cableFromPart(p, part, x, y) {
    const P = part.cable;
    const c = newCable(p, x, y, { kind: P.kind, desc: P.desc, mfr: P.mfr, mpn: P.mpn, ipn: P.ipn, jacket: P.jacket, jcolor: P.jcolor, od: P.od, shield: { type: P.shield, a: "none", b: "none" } });
    const ws = part.conductors.map(cd => newWire(p, Object.assign(wireProfile(cd), { cable: c.id })));
    c.groups = part.groups.map(g => newGroup(g.wires.map(i => ws[i].id), { lay: g.lay, shield: g.shield }));
    p.cables.push(c);
    p.wires.push(...ws);
    return c;
  }

  function connFromPart(p, part, x, y) {
    const c = newConn(p, part.lib in CD.LIB ? part.lib : "custom", x, y);
    PART_KEYS.forEach(k => { if (k !== "lib" && part[k] !== undefined) c[k] = JSON.parse(JSON.stringify(part[k])); });
    c.pins = part.pins.map(x => ({ n: x.n, sig: "" }));
    if (c.layout) c.layout = CD.normLayout(c.layout, c.pins.length);
    if (c.board) c.board = normBoard(c.board, c.pins.length);
    return c;
  }

  function newCable(p, x, y, o) {
    return Object.assign({
      id: uid(), ref: nextRef(p, "W"), kind: "cable", desc: "", mfr: "", mpn: "", ipn: "",
      jacket: "PVC", jcolor: "BK", od: "", len: "", tol: "", stripA: "", stripB: "", stripTol: "",
      shield: { type: "none", a: "none", b: "none" }, groups: [], marks: [],
      note: "", x: Math.round(x || 0), y: Math.round(y || 0)
    }, o);
  }
  function newWire(p, o) {
    const loose = !(o && o.cable);
    const w = Object.assign({
      id: uid(), ref: "", gauge: "24", gu: "AWG", color: "BK", stripe: "", insul: "PVC", spec: "",
      len: "", tol: "", cable: null, a: null, b: null, sig: "", mfr: "", mpn: "", ipn: "", note: "", hint: null
    }, o);
    if (loose && !w.ref) w.ref = nextWireNo(p);
    return w;
  }
  function nextWireNo(p) {
    const used = new Set(p.wires.map(w => w.ref));
    for (let i = 1; ; i++) if (!used.has(String(i))) return String(i);
  }
  const newGroup = (wires, o) => Object.assign({ id: uid(), wires: wires.slice(), lay: "", shield: "none" }, o);
  const newMark = o => Object.assign({ id: uid(), kind: "label", end: "both", text: "", mfr: "", mpn: "", ipn: "", desc: "", qty: "", len: "" }, o);
  // Custom table: free text in a grid, on sheet 1 at x, y or flowed onto sheet 2.
  const newTable = (x, y, o) => Object.assign({
    id: uid(), title: "Table", cols: [{ h: "Column 1", align: "left" }, { h: "Column 2", align: "left" }, { h: "Column 3", align: "left" }],
    rows: [["", "", ""], ["", "", ""]], size: "s", k: 1, wrap: true, colW: 0, sheet: 1, x: Math.round(x || 0), y: Math.round(y || 0)
  }, o);
  function normTable(t) {
    const cols = (Array.isArray(t.cols) ? t.cols : []).slice(0, 30).map(c => ({ h: str(c && c.h).slice(0, 200), align: ["left", "center", "right"].includes(c && c.align) ? c.align : "left" }));
    if (!cols.length) cols.push({ h: "", align: "left" });
    const rows = (Array.isArray(t.rows) ? t.rows : []).slice(0, 500).map(r => cols.map((c, i) => str(Array.isArray(r) ? r[i] : "").slice(0, 2000)));
    return { id: str(t.id) || uid(), title: str(t.title).slice(0, 200), cols, rows, size: sizeKey(t.size, "s"), k: scaleK(t.k), wrap: t.wrap !== false, colW: colWOf(t.colW), sheet: t.sheet === 2 ? 2 : 1, x: num(t.x) || 0, y: num(t.y) || 0 };
  }
  // Text pasted from a spreadsheet (tabs) or CSV: rows of cells. Quotes as in CSV.
  function parseGrid(text) {
    const tab = /\t/.test(text), rows = [];
    let row = [], cell = "", q = false;
    const s = String(text).replace(/\r\n?/g, "\n");
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (q) { if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; continue; }
      if (ch === '"' && cell === "") q = true;
      else if (ch === (tab ? "\t" : ",")) { row.push(cell); cell = ""; }
      else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
      else cell += ch;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(c => c.trim() !== ""));
  }
  const newCallout = (x, y, o) => Object.assign({ id: uid(), kind: "text", text: "", size: "m", k: 1, x: Math.round(x), y: Math.round(y), lx: null, ly: null }, o);
  // Text size (Small / Medium / Large) and free scale (corner handle), kept within sensible bounds.
  const sizeKey = (v, def) => ["s", "m", "l"].includes(v) ? v : def;
  const scaleK = v => { const n = num(v); return n == null ? 1 : Math.max(0.3, Math.min(6, Math.round(n * 100) / 100)); };
  const sizeOf = (o, def) => ({ size: sizeKey(o && o.size, def), k: scaleK(o && o.k) });
  // Table text wrapping: wrap (default on) and the width columns wrap at (pt at 100 %; 0 = each column's own limit).
  const colWOf = v => { const n = num(v); return n == null || n <= 0 ? 0 : Math.max(30, Math.min(600, Math.round(n))); };
  const wrapOf = o => ({ wrap: !(o && o.wrap === false), colW: colWOf(o && o.colW) });

  // Cable presets. Colours: DIN 47100 order; Ethernet uses T568B.
  function cablePreset(p, kind, x, y, n) {
    const c = newCable(p, x, y);
    const ws = [];
    const wire = o => { const w = newWire(p, Object.assign({ cable: c.id }, o)); ws.push(w); return w; };
    const din = i => CD.DIN47100[i % CD.DIN47100.length];
    if (kind === "multi") {
      n = Math.max(1, Math.min(60, n || 4));
      for (let i = 0; i < n; i++) wire({ color: din(i) });
      c.desc = n + " conductor cable";
    } else if (kind === "stp") {
      const a = wire({ color: "WH" }), b = wire({ color: "BN" });
      wire({ color: "BARE" });
      c.groups.push(newGroup([a.id, b.id], { lay: "" }));
      c.shield = { type: "foil", a: "pigtail", b: "float" };
      c.desc = "Shielded twisted pair";
    } else if (kind === "pairs") {
      n = Math.max(1, Math.min(30, n || 2));
      for (let i = 0; i < n; i++) {
        const a = wire({ color: din(i * 2) }), b = wire({ color: din(i * 2 + 1) });
        c.groups.push(newGroup([a.id, b.id]));
      }
      wire({ color: "BARE" });
      c.shield = { type: "foil", a: "pigtail", b: "float" };
      c.desc = n + " pair shielded cable";
    } else if (kind === "eth") {
      // Conductors in pair order; hint = T568B pin, so "Connect" lands each on its pin.
      CD.ETH_PAIRS.forEach(pr => {
        const g = pr.map(pin => wire({ color: CD.T568B[pin - 1][0], stripe: CD.T568B[pin - 1][1], hint: pin }));
        c.groups.push(newGroup(g.map(w => w.id)));
      });
      c.desc = "4 pair data cable (T568B colours)";
    } else if (kind === "bundle") {
      const a = wire({ color: "RD" }), b = wire({ color: "BK" });
      c.kind = "bundle"; c.jacket = ""; c.jcolor = "";
      c.groups.push(newGroup([a.id, b.id]));
      c.desc = "Twisted pair, no jacket";
    } else {
      wire({ color: "BK" });
      c.desc = "Cable";
    }
    p.cables.push(c);
    p.wires.push(...ws);
    return c;
  }

  // ---------- normalize (open files, autosave) ----------
  function normalize(d) {
    const p = blankProject();
    if (!d || typeof d !== "object") return p;
    Object.assign(p.meta, d.meta);
    p.pos = Object.assign(p.pos, d.pos);
    const arr = a => Array.isArray(a) ? a : [];
    p.history = arr(d.history).map(r => ({ rev: str(r.rev), date: str(r.date), desc: str(r.desc), by: str(r.by), eco: str(r.eco) }));
    p.notes = arr(d.notes).map(n => ({ id: n.id || uid(), text: str(n.text) }));
    p.conns = arr(d.conns).map(c => {
      const b = newConn(p, c.lib in CD.LIB ? c.lib : "custom", c.x, c.y);
      const o = Object.assign(b, c, { id: c.id || b.id, term: part(c.term), seal: part(c.seal) });
      o.pins = arr(c.pins).map(x => ({ n: str(x.n), sig: str(x.sig) }));
      o.layout = CD.normLayout(c.layout, o.pins.length);
      o.board = CD.libOf(o).kind === "board" ? normBoard(c.board || { pins: boardPins(o.pins.length) }, o.pins.length) : null;
      o.acc = arr(c.acc).map(a => Object.assign(part(), a, { qty: str(a.qty || "1") }));
      return o;
    });
    p.cables = arr(d.cables).map(c => {
      const o = Object.assign(newCable(p), c, { id: c.id });
      o.shield = Object.assign({ type: "none", a: "none", b: "none" }, c.shield);
      o.groups = arr(c.groups).map(g => newGroup(arr(g.wires), g));
      o.marks = arr(c.marks).map(m => newMark(m));
      return o;
    });
    const conn = new Set(p.conns.map(c => c.id)), cab = new Set(p.cables.map(c => c.id));
    const end = e => e && conn.has(e.c) && Number.isInteger(e.p) ? { c: e.c, p: e.p } : null;
    p.wires = arr(d.wires).map(w => Object.assign(newWire(p, { ref: "x" }), w, {
      ref: str(w.ref), cable: cab.has(w.cable) ? w.cable : null, a: end(w.a), b: end(w.b)
    }));
    p.callouts = arr(d.callouts).map(c => Object.assign(newCallout(c.x || 0, c.y || 0, c), sizeOf(c, "m")));
    const bk = d.blk || {};
    p.blk = { wires: Object.assign(sizeOf(bk.wires, "s"), wrapOf(bk.wires)), bom: Object.assign(sizeOf(bk.bom, "s"), wrapOf(bk.bom)), notes: sizeOf(bk.notes, "m") };
    const ends = ["a", "b"];
    p.ties = arr(d.ties).filter(t => t && t.a && t.b && ends.includes(t.a.end)).map(t => ({
      id: str(t.id) || uid(), a: { cable: str(t.a.cable), end: t.a.end },
      b: t.b.t === "shield" ? { t: "shield", cable: str(t.b.cable), end: ends.includes(t.b.end) ? t.b.end : "a" } : { t: "pin", c: str(t.b.c), p: Number.isInteger(t.b.p) ? t.b.p : -1 }
    }));
    pruneTies(p);
    p.tables = arr(d.tables).slice(0, 50).map(normTable);
    p.cables.forEach(c => { c.groups = c.groups.filter(g => (g.wires = g.wires.filter(id => p.wires.some(w => w.id === id && w.cable === c.id))).length > 1); });
    return p;
  }

  // ---------- lookups ----------
  const byId = (list, id) => list.find(o => o.id === id) || null;
  const libOf = c => CD.LIB[c.lib] || CD.LIB.custom;
  const groupOf = (cable, wid) => cable ? cable.groups.find(g => g.wires.includes(wid)) || null : null;

  // Conductors in drawing order: twist-group members stay together.
  function conductors(p, cable) {
    const list = p.wires.filter(w => w.cable === cable.id), out = [], done = new Set();
    list.forEach(w => {
      if (done.has(w.id)) return;
      const g = groupOf(cable, w.id);
      const members = g ? list.filter(x => g.wires.includes(x.id)) : [w];
      members.forEach(x => { done.add(x.id); out.push(x); });
    });
    return out;
  }
  function wireRef(p, w) {
    if (w.ref) return w.ref;
    const c = byId(p.cables, w.cable);
    if (!c) return "?";
    return c.ref + "-" + (conductors(p, c).indexOf(w) + 1);
  }
  function endText(p, e) {
    if (!e) return "";
    const c = byId(p.conns, e.c);
    if (!c) return "";
    const k = libOf(c).kind;
    if (k === "splice" || k === "ground" || k === "term") return c.ref;
    if (k === "board" && !c.pins[e.p]) return c.ref;
    return c.ref + ":" + (c.pins[e.p] ? c.pins[e.p].n : "?");
  }
  const sigOf = (p, w) => {
    if (w.sig) return w.sig;
    for (const e of [w.a, w.b]) { const c = e && byId(p.conns, e.c); const s = c && c.pins[e.p] && c.pins[e.p].sig; if (s) return s; }
    return "";
  };
  const isDrain = w => w.color === "BARE";
  const colorText = w => w.color === "BARE" ? "BARE" : w.stripe ? w.color + "/" + w.stripe : w.color;
  const gaugeText = w => !w.gauge ? "" : w.gu === "mm2" ? w.gauge + " mm²" : w.gauge + " AWG";

  // ---------- lengths ----------
  const UNIT = u => u === "mm" ? "mm" : "in";
  function fmtLen(v, m) {
    const n = num(v);
    if (n == null) return str(v);
    const d = m.units === "mm" ? (n % 1 ? 1 : 0) : 2;
    let s = n.toFixed(d);
    if (m.alt) s += " [" + (m.units === "mm" ? (n / 25.4).toFixed(2) : (n * 25.4).toFixed(n * 25.4 >= 100 ? 0 : 1)) + "]";
    return s;
  }
  const fmtTol = (t, m) => num(t) == null ? "" : " ±" + fmtLen(Math.abs(num(t)), Object.assign({}, m, { alt: false }));
  function wireLen(p, w) {
    if (!w.cable) return w.len;
    const c = byId(p.cables, w.cable);
    return w.len || (c ? c.len : "");
  }

  // ---------- wire list ----------
  const WIRE_COLS = ["Wire", "Cable", "Size", "Color", "Length", "From", "To", "Signal", "Twist / shield", "Note"];
  function wireRows(p) {
    const order = [];
    p.cables.forEach(c => conductors(p, c).forEach(w => order.push(w)));
    p.wires.filter(w => !w.cable).forEach(w => order.push(w));
    return order.map(w => {
      const c = byId(p.cables, w.cable), g = groupOf(c, w.id);
      const tw = [];
      if (g) tw.push("TW" + (c.groups.indexOf(g) + 1) + (g.shield !== "none" ? " (" + g.shield + ")" : ""));
      if (isDrain(w)) tw.push("drain");
      const L = wireLen(p, w);
      return { id: w.id, cells: [wireRef(p, w), c ? c.ref : "", gaugeText(w), colorText(w), L ? fmtLen(L, p.meta) : "", endText(p, w.a), endText(p, w.b), sigOf(p, w), tw.join(", "), w.note] };
    }).concat((p.ties || []).map(t => {
      const c = byId(p.cables, t.a.cable);
      return { id: t.id, tie: true, cells: [(c ? c.ref : "?") + "-SH", c ? c.ref : "", "", "SHIELD", "", shieldText(p, t.a.cable, t.a.end), tieTargetText(p, t.b), "", "shield tie", ""] };
    }));
  }

  // ---------- BOM ----------
  const BOM_COLS = ["Item", "Qty", "Unit", "Part No.", "Mfr", "Mfr Part No.", "Description", "Ref Des"];
  function bom(p) {
    const rows = [], idx = new Map(), find = {};
    const u = UNIT(p.meta.units);
    const put = (key, o, qty, unit, ref, srcId) => {
      let r = idx.get(key);
      if (!r) { r = Object.assign({ qty: 0, unit, refs: [], src: [] }, o); idx.set(key, r); rows.push(r); }
      r.qty += qty;
      if (ref && !r.refs.includes(ref)) r.refs.push(ref);
      if (srcId) r.src.push(srcId);
      return r;
    };
    const keyOf = (kind, o, fallback) => kind + "|" + (o.ipn || o.mpn ? (o.ipn || "") + "|" + (o.mpn || "") : fallback);
    const has = o => !!(o && (o.mpn || o.ipn || o.desc));

    p.conns.forEach(c => {
      const lib = libOf(c);
      if ((lib.kind === "ground" || lib.kind === "flying") && !has(c)) return;
      const g = lib.gender && c.gender !== "none" ? (c.gender === "male" ? ", male" : ", female") : "";
      const desc = c.desc || (lib.kind === "board" ? lib.name : lib.name + (lib.var ? ", " + c.pins.length + " pos" : "") + g);
      put(keyOf("c", c, desc), { mfr: c.mfr, mpn: c.mpn, ipn: c.ipn, desc }, 1, "ea", c.ref, c.id);
    });
    p.conns.forEach(c => {
      const used = new Set();
      p.wires.forEach(w => [w.a, w.b].forEach(e => { if (e && e.c === c.id) used.add(e.p); }));
      [["term", "Contact / terminal"], ["seal", "Wire seal"]].forEach(([k, label]) => {
        const o = c[k];
        if (!has(o) || !used.size) return;
        const desc = o.desc || label;
        put(keyOf(k, o, desc), { mfr: o.mfr, mpn: o.mpn, ipn: o.ipn, desc }, used.size, "ea", c.ref);
      });
      c.acc.forEach(a => {
        if (!has(a)) return;
        put(keyOf("a", a, a.desc), { mfr: a.mfr, mpn: a.mpn, ipn: a.ipn, desc: a.desc || "Accessory" }, num(a.qty) || 1, "ea", c.ref);
      });
    });
    p.cables.forEach(c => {
      if (c.kind === "bundle") return;
      const L = num(c.len);
      const desc = c.desc || "Cable";
      const r = put(keyOf("w", c, desc), { mfr: c.mfr, mpn: c.mpn, ipn: c.ipn, desc }, L == null ? 0 : L, u, c.ref, c.id);
      if (L == null) r.tbd = true;   // a cable with no length yet
    });
    p.wires.forEach(w => {
      const c = byId(p.cables, w.cable);
      if (c && c.kind !== "bundle") return;
      const desc = ["Wire", gaugeText(w), colorText(w), w.insul, w.spec].filter(Boolean).join(", ");
      const L = num(wireLen(p, w));
      put(keyOf("l", w, desc), { mfr: w.mfr, mpn: w.mpn, ipn: w.ipn, desc }, L == null ? 0 : L, u, null, w.id);
    });
    p.cables.forEach(c => c.marks.forEach(m => {
      if (!has(m)) return;
      const kind = (CD.MARKS.find(k => k[0] === m.kind) || ["", "Item"])[1];
      const desc = m.desc || kind;
      const L = num(m.len), per = m.end === "both" ? 2 : 1;
      const r = L != null ? put(keyOf("m", m, desc), { mfr: m.mfr, mpn: m.mpn, ipn: m.ipn, desc }, L * per, u, c.ref, m.id)
        : put(keyOf("m", m, desc), { mfr: m.mfr, mpn: m.mpn, ipn: m.ipn, desc }, (num(m.qty) || 1) * per, "ea", c.ref, m.id);
      return r;
    }));
    rows.forEach((r, i) => {
      r.item = i + 1;
      r.qty = Math.round(r.qty * 100) / 100;
      r.src.forEach(id => { find[id] = r.item; });
    });
    return { rows, find };
  }
  const bomQty = (r, m) => {
    const q = r.unit === "ea" ? String(r.qty) : r.qty ? fmtLen(r.qty, Object.assign({}, m, { alt: false })) : "";
    return r.tbd ? (q ? q + " + TBD" : "TBD") : q;
  };
  const bomCells = (r, m) => [String(r.item), bomQty(r, m), r.unit, r.ipn, r.mfr, r.mpn, r.desc, r.refs.join(", ")];

  // ---------- checks ----------
  function checks(p) {
    const out = [];
    const refs = {};
    [...p.conns, ...p.cables].forEach(o => { refs[o.ref] = (refs[o.ref] || 0) + 1; });
    Object.keys(refs).forEach(r => { if (refs[r] > 1) out.push({ lvl: "err", msg: "Reference " + r + " is used " + refs[r] + " times." }); });
    const wr = {};
    p.wires.forEach(w => { const r = wireRef(p, w); wr[r] = (wr[r] || 0) + 1; });
    Object.keys(wr).forEach(r => { if (wr[r] > 1) out.push({ lvl: "err", msg: "Wire " + r + " is used " + wr[r] + " times." }); });
    const pinUse = {};
    p.wires.forEach(w => [w.a, w.b].forEach(e => { if (e) { const k = e.c + ":" + e.p; pinUse[k] = (pinUse[k] || 0) + 1; } }));
    Object.keys(pinUse).forEach(k => {
      if (pinUse[k] < 2) return;
      const [cid, pi] = k.split(":"), c = byId(p.conns, cid);
      if (c && !["splice", "ground", "term"].includes(libOf(c).kind)) out.push({ lvl: "warn", msg: c.ref + ":" + c.pins[+pi].n + " has " + pinUse[k] + " wires. Check the contact accepts them." });
    });
    p.wires.forEach(w => {
      if (!w.a && !w.b && !w.cable) out.push({ lvl: "warn", msg: "Wire " + wireRef(p, w) + " has no ends." });
      if (!w.cable && num(w.len) == null) out.push({ lvl: "warn", msg: "Wire " + wireRef(p, w) + " has no length." });
      if (w.a && w.b && w.a.c === w.b.c && w.a.p === w.b.p) out.push({ lvl: "err", msg: "Wire " + wireRef(p, w) + " starts and ends on the same pin." });
    });
    p.cables.forEach(c => {
      if (num(c.len) == null) out.push({ lvl: "warn", msg: "Cable " + c.ref + " has no length." });
      if (c.shield.type !== "none") {
        const drains = p.wires.filter(w => w.cable === c.id && isDrain(w));
        if ((c.shield.a === "pigtail" || c.shield.b === "pigtail") && !drains.length) out.push({ lvl: "warn", msg: "Cable " + c.ref + ": pigtail shield end, but no drain (BARE) conductor." });
      }
    });
    p.cables.forEach(c => ["a", "b"].forEach(e => {
      if (c.shield.type !== "none" && c.shield[e] === "tied" && !tiesOf(p, c.id, e).length) out.push({ lvl: "warn", msg: "Cable " + c.ref + ": shield end " + e.toUpperCase() + " is set to tied, but has no tie." });
    }));
    if (!p.meta.dwgNo) out.push({ lvl: "warn", msg: "Drawing number is empty." });
    if (num(p.meta.tol) == null) out.push({ lvl: "warn", msg: "General length tolerance is not set." });
    return out;
  }

  // ---------- CSV ----------
  // Excel reads leading = + - @ as a formula; prefix those cells unless numeric.
  const csvCell = v => {
    let s = str(v);
    if (/^[=+\-@]/.test(s) && !/^[+-]?\d+(\.\d+)?$/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const csv = (head, rows) => "﻿" + [head, ...rows].map(r => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
  const wireCsv = p => csv(WIRE_COLS, wireRows(p).map(r => r.cells));
  const bomCsv = p => csv(BOM_COLS, bom(p).rows.map(r => bomCells(r, p.meta)));

  // ---------- connect a cable to connectors (hint pin, else conductor order) ----------
  function connectCable(p, cable, aId, bId) {
    const A = byId(p.conns, aId), B = byId(p.conns, bId);
    let k = 0;
    conductors(p, cable).forEach(w => {
      if (isDrain(w)) return;
      const pin = (w.hint ? w.hint : k + 1) - 1;
      k++;
      if (A && pin < A.pins.length) w.a = { c: A.id, p: pin };
      if (B && pin < B.pins.length) w.b = { c: B.id, p: pin };
    });
  }

  // ---------- example (fake data only) ----------
  function example() {
    const p = blankProject();
    Object.assign(p.meta, { dwgNo: "CBL-0001", title: "Example sensor cable", rev: "A", tol: "0.50", ws: "2", drawn: "Example" });
    p.history.push({ rev: "A", date: today(), desc: "Initial release", by: "Example", eco: "" });
    p.notes = ["Mark each end with its reference (P1, P2) on heat-shrink labels.", "Test 100 % continuity. No opens, no shorts, no miswires.", "Trim the drain at end B and cover it with heat-shrink."].map(t => ({ id: uid(), text: t }));
    const p1 = newConn(p, "de9", 120, 170);
    Object.assign(p1, { mfr: "Example Co.", mpn: "EX-D9-S", term: part({ mfr: "Example Co.", mpn: "EX-CT-S", desc: "Socket contact, crimp" }) });
    p1.acc.push(Object.assign(part({ mfr: "Example Co.", mpn: "EX-BS-9", desc: "Backshell, metal, DE-9" }), { qty: "1" }));
    ["SHLD", "A", "B", "", "0V", "CHGND", "", "", "+V"].forEach((s, i) => { p1.pins[i].sig = s; });
    p.conns.push(p1);
    const p2 = newConn(p, "m12a5", 640, 170);
    Object.assign(p2, { gender: "male", mfr: "Example Co.", mpn: "EX-M12-5P" });
    ["+V", "A", "0V", "B", ""].forEach((s, i) => { p2.pins[i].sig = s; });
    p.conns.push(p2);
    const w1 = newCable(p, 340, 160, { desc: "2 pair shielded, 24 AWG", mfr: "Example Co.", mpn: "EX-CBL-2P24S", od: "0.22", len: "36.00", tol: "1.00", stripA: "1.50", stripB: "1.00" });
    p.cables.push(w1);
    const mk = o => { const w = newWire(p, Object.assign({ cable: w1.id }, o)); p.wires.push(w); return w; };
    const a = mk({ color: "WH", a: { c: p1.id, p: 1 }, b: { c: p2.id, p: 1 } });
    const b = mk({ color: "BN", a: { c: p1.id, p: 2 }, b: { c: p2.id, p: 3 } });
    const v = mk({ color: "GN", a: { c: p1.id, p: 8 }, b: { c: p2.id, p: 0 } });
    const g = mk({ color: "YE", a: { c: p1.id, p: 4 }, b: { c: p2.id, p: 2 } });
    mk({ color: "BARE", a: { c: p1.id, p: 0 } });
    w1.groups.push(newGroup([a.id, b.id], { lay: "1.00" }), newGroup([v.id, g.id], { lay: "1.50" }));
    w1.shield = { type: "foil", a: "pigtail", b: "float" };
    w1.marks.push(newMark({ kind: "label", end: "both", text: "P1 / P2", mfr: "Example Co.", mpn: "EX-LBL-WHT", desc: "Heat-shrink label, white" }));
    w1.marks.push(newMark({ kind: "heatshrink", end: "B", text: "Over jacket end, 1.00 long", mfr: "Example Co.", mpn: "EX-HS-3/8", desc: "Heat-shrink tubing 3/8 in, black", len: "1.00" }));
    const e1 = newConn(p, "ring", 360, 400);
    Object.assign(e1, { desc: "Ring terminal, #10 stud", mfr: "Example Co.", mpn: "EX-RING-10" });
    p.conns.push(e1);
    p.wires.push(newWire(p, { gauge: "20", color: "GNYE", len: "6.00", a: { c: p1.id, p: 5 }, b: { c: e1.id, p: 0 } }));
    p.callouts.push(newCallout(500, 420, { kind: "flag", text: "3", lx: null }));
    return p;
  }

  Object.assign(CD, {
    FORMAT, VERSION, uid, today, num, str,
    blankProject, normalize, newConn, setPinCount, reorderPins, removePins, addPins, spaceBoardPins, boardPins,
    addTie, tiesOf, pruneTies, newTable, normTable, parseGrid, scaleK, colWOf, shieldText, tieTargetText, insertBoard, partFromConn, normPart, connFromPart, partFromCable, cableFromPart, partFromWire, applyWirePart, wireProfile, newCable, newWire, newGroup, newMark, newCallout, cablePreset, nextWireNo,
    byId, libOf, groupOf, conductors, wireRef, endText, sigOf, isDrain, colorText, gaugeText,
    UNIT, fmtLen, fmtTol, wireLen, WIRE_COLS, wireRows, BOM_COLS, bom, bomCells, checks,
    csvCell, wireCsv, bomCsv, connectCable, example
  });
})(typeof window !== "undefined" ? window : globalThis);
