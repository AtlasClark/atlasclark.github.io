/*
  Cable Designer — from-to list import
  Scope: read a from-to wire list (CSV, or tabs pasted from a spreadsheet; one row
  per wire, columns found by heading), give each reference a connector type
  (library, My parts or one already in the drawing), group wires into cables (one
  per connector pair, or by a Cable column), splice nets that join 3 or more pins,
  then lay the new items out in columns (connectors, cables between them) and put
  the block in free space on sheet 1. No DOM access; Node tests load it.
*/
(function (root) {
  "use strict";
  const CD = root.CD = root.CD || {};
  const str = v => v == null ? "" : String(v).trim();

  // ---------- columns ----------
  // Headings are matched without case, spaces or punctuation.
  const FIELDS = [
    ["aRef", "From", ["from", "fromref", "fromrefdes", "fromconn", "fromconnector", "fromdevice", "source", "refa", "conna", "enda", "connectora"]],
    ["aPin", "From pin", ["frompin", "frompos", "fromcontact", "fromcavity", "pina", "posa", "cavitya"]],
    ["bRef", "To", ["to", "toref", "torefdes", "toconn", "toconnector", "todevice", "dest", "destination", "target", "refb", "connb", "endb", "connectorb"]],
    ["bPin", "To pin", ["topin", "topos", "tocontact", "tocavity", "pinb", "posb", "cavityb"]],
    ["sig", "Signal", ["signal", "signalname", "sig", "net", "netname", "function", "circuit"]],
    ["wire", "Wire", ["wire", "wireid", "wireno", "wirenumber", "wireref", "id"]],
    ["size", "Size", ["size", "gauge", "awg", "wiresize", "wiregauge", "csa", "mm2"]],
    ["color", "Colour", ["color", "colour", "wirecolor", "wirecolour", "insulationcolor"]],
    ["cable", "Cable", ["cable", "cableid", "cableref", "cableno"]],
    ["len", "Length", ["length", "len", "cutlength", "wirelength"]]
  ];
  const key = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");

  // ---------- values ----------
  const COLOR_WORDS = {
    black: "BK", blk: "BK", brown: "BN", brn: "BN", red: "RD", orange: "OG", orn: "OG", org: "OG", yellow: "YE", yel: "YE", yl: "YE",
    green: "GN", grn: "GN", blue: "BU", blu: "BU", bl: "BU", violet: "VT", vio: "VT", vlt: "VT", purple: "VT", pur: "VT", grey: "GY", gray: "GY", gry: "GY",
    white: "WH", wht: "WH", wt: "WH", pink: "PK", pnk: "PK", turquoise: "TQ", gold: "GD", silver: "SR", bare: "BARE", drain: "BARE", tinned: "BARE",
    greenyellow: "GNYE", grnyel: "GNYE", yellowgreen: "GNYE"
  };
  const colorCode = s => {
    const k = key(s);
    if (!k) return "";
    const up = k.toUpperCase();
    if (CD.COLOR[up]) return up;
    return COLOR_WORDS[k] || null;
  };
  // "WH/BU", "White-Blue", "GN/YE" → { color, stripe }. Unknown → null.
  function parseColor(s) {
    s = str(s);
    if (!s) return { color: "", stripe: "" };
    const whole = colorCode(s);
    if (whole) return { color: whole, stripe: "" };
    const parts = s.split(/[\/\-\s_,]+/).filter(Boolean);
    if (parts.length === 2) {
      const a = colorCode(parts[0]), b = colorCode(parts[1]);
      if (a === "GN" && b === "YE") return { color: "GNYE", stripe: "" };
      if (a && b && a !== "BARE" && b !== "BARE" && b !== "GNYE") return { color: a, stripe: b };
    }
    return null;
  }
  // "24", "24 AWG", "0.5 mm²", "0.5mm2" → { gauge, gu }. Unknown → null.
  function parseSize(s) {
    s = str(s);
    if (!s) return { gauge: "", gu: "" };
    const m = s.replace(",", ".").match(/^(\d+(?:\.\d+)?)\s*(awg|ga|mm2|mm²|mm\^2|sq\s*mm)?$/i);
    if (!m) return null;
    const mm = m[2] ? /mm|sq/i.test(m[2]) : /\./.test(m[1]);
    return { gauge: m[1], gu: mm ? "mm2" : "AWG" };
  }
  // "P1:3", "P1-3", "P1.3" in one cell (when there is no pin column).
  function splitRefPin(s) {
    s = str(s);
    const i = s.indexOf(":");
    if (i > 0) return { ref: s.slice(0, i).trim(), pin: s.slice(i + 1).trim() };
    const m = s.match(/^(.*[A-Za-z].*?)[-.](\w+)$/);
    return m ? { ref: m[1].trim(), pin: m[2] } : { ref: s, pin: "" };
  }
  const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

  // ---------- parse ----------
  // Returns { cols: { field: index }, ignored, rows, warn, refs: [{ ref, pins }] }; throws when From / To are missing.
  function parseFromTo(text) {
    const grid = CD.parseGrid(String(text || "").replace(/^﻿/, ""));
    let hi = grid.findIndex(r => { const ks = r.map(key); return FIELDS.slice(0, 1).concat(FIELDS.slice(2, 3)).every(f => ks.some(k => f[2].includes(k))); });
    if (hi < 0) throw new Error("No From and To columns found in the heading row.");
    const head = grid[hi], cols = {}, ignored = [];
    head.forEach((h, i) => {
      const k = key(h), f = FIELDS.find(x => x[2].includes(k) && cols[x[0]] == null);
      if (f) cols[f[0]] = i; else if (str(h)) ignored.push(str(h));
    });
    const rows = [], warn = [], refs = new Map();
    const cell = (r, f) => cols[f] == null ? "" : str(r[cols[f]]);
    const end = (r, side) => {
      let ref = cell(r, side + "Ref"), pin = cell(r, side + "Pin");
      if (!ref) return null;
      if (cols[side + "Pin"] == null) ({ ref, pin } = splitRefPin(ref));
      if (!refs.has(ref)) refs.set(ref, new Set());
      refs.get(ref).add(pin);
      return { ref, pin };
    };
    const seen = new Set();
    grid.slice(hi + 1).forEach((r, k) => {
      const line = hi + k + 2;
      const a = end(r, "a"), b = end(r, "b");
      if (!a && !b) return;
      const row = { line, a, b, sig: cell(r, "sig"), wire: cell(r, "wire"), cable: cell(r, "cable"), len: cell(r, "len"), gauge: "", gu: "", color: "", stripe: "" };
      if (a && b && a.ref === b.ref && a.pin === b.pin) { warn.push("Row " + line + ": starts and ends on " + a.ref + ":" + a.pin + ". Skipped."); return; }
      const sz = parseSize(cell(r, "size"));
      if (sz) Object.assign(row, sz); else warn.push("Row " + line + ": size \"" + cell(r, "size") + "\" not read. Default used.");
      const co = parseColor(cell(r, "color"));
      if (co) Object.assign(row, co); else warn.push("Row " + line + ": colour \"" + cell(r, "color") + "\" not read. Default used.");
      if (row.len && CD.num(row.len) == null) { warn.push("Row " + line + ": length \"" + row.len + "\" is not a number. Left blank."); row.len = ""; }
      const dup = [a && a.ref + ":" + a.pin, b && b.ref + ":" + b.pin].sort().join("|") + "|" + row.wire + "|" + row.cable;
      if (seen.has(dup)) { warn.push("Row " + line + ": same as an earlier row. Skipped."); return; }
      seen.add(dup);
      rows.push(row);
    });
    if (!rows.length) throw new Error("No wires found under the heading row.");
    return { cols, ignored, rows, warn, refs: [...refs].map(([ref, s]) => ({ ref, pins: [...s].sort(natural) })) };
  }

  // ---------- connectors ----------
  const NODE_KINDS = ["splice", "ground", "term"];
  const isNode = c => NODE_KINDS.includes(CD.libOf(c).kind);
  // target: { t: "lib", key } | { t: "part", part } | { t: "have", id }
  function connFor(p, ref, pins, target) {
    if (target && target.t === "have") return CD.byId(p.conns, target.id);
    let c;
    if (target && target.t === "part" && target.part) c = CD.connFromPart(p, target.part, 0, 0);
    else {
      const lib = CD.LIB[target && target.key] || CD.LIB.custom;
      c = CD.newConn(p, lib.key, 0, 0);
      const named = pins.filter(Boolean);
      const numeric = named.every(x => /^\d+$/.test(x));
      if (lib.var && named.length) {
        if (numeric) { CD.setPinCount(p, c, Math.max(lib.var[0], ...named.map(Number))); if (c.board) c.board.pins = CD.boardPins(c.pins.length); }
        else if (lib.custom || lib.kind === "board") {
          c.pins = named.map(n => ({ n, sig: "" }));
          if (c.layout) c.layout = CD.normLayout(c.layout, c.pins.length);
          if (c.board) { c.board = { w: c.board.w, h: c.board.h, pins: CD.boardPins(c.pins.length) }; }
        }
      }
      if (c.board) c.board.h = Math.max(100, Math.ceil(c.pins.length / 2) * 14 + 40);
    }
    c.ref = ref;
    return c;
  }
  // Index of a pin name on a connector; -1 = not on it.
  function pinIndex(c, name) {
    if (isNode(c)) return 0;
    name = str(name);
    if (!name) return c.pins.length === 1 ? 0 : -1;
    const lo = name.toLowerCase();
    return c.pins.findIndex(x => str(x.n).toLowerCase() === lo);
  }
  // Pins in the file that the chosen type does not have.
  function missingPins(p, ref, pins, target) {
    const tmp = CD.blankProject();
    if (target && target.t === "have") { const c = CD.byId(p.conns, target.id); return c ? pins.filter(x => pinIndex(c, x) < 0) : pins.slice(); }
    const c = connFor(tmp, ref, pins, target);
    return pins.filter(x => pinIndex(c, x) < 0);
  }

  // ---------- plan: splices and cable groups ----------
  // nodes: refs that are splice / ground / terminal types (never spliced again).
  function netPlan(net, opt) {
    opt = opt || {};
    const nodes = new Set(opt.nodes || []);
    const ek = e => e.ref + "\u0000" + e.pin;
    const parent = new Map();
    const find = k => { while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k))); k = parent.get(k); } return k; };
    const add = k => { if (!parent.has(k)) parent.set(k, k); };
    net.rows.forEach(r => {
      [r.a, r.b].forEach(e => e && add(ek(e)));
      if (r.a && r.b) parent.set(find(ek(r.a)), find(ek(r.b)));
    });
    const groups = new Map();
    net.rows.forEach(r => [r.a, r.b].forEach(e => {
      if (!e) return;
      const g = find(ek(e));
      if (!groups.has(g)) groups.set(g, { ends: new Map(), rows: new Set(), node: false });
      const G = groups.get(g);
      if (!G.ends.has(ek(e))) G.ends.set(ek(e), e);
      G.rows.add(r);
      if (nodes.has(e.ref)) G.node = true;
    }));
    const splices = [], spliced = new Set();
    if (opt.splice !== false) groups.forEach(G => {
      if (G.ends.size < 3 || G.node) return;
      const rows = [...G.rows];
      rows.forEach(r => spliced.add(r));
      splices.push({ ends: [...G.ends.values()], rows, sig: (rows.find(r => r.sig) || {}).sig || "" });
    });
    // cable groups: Cable column first, else one per connector pair; the rest are loose wires
    const cables = new Map(), loose = [];
    net.rows.forEach(r => {
      if (spliced.has(r)) return;
      let k = null, label;
      if (r.cable) { k = "c:" + r.cable; label = r.cable; }
      else if (r.a && r.b && r.a.ref !== r.b.ref && !nodes.has(r.a.ref) && !nodes.has(r.b.ref)) {
        const s = [r.a.ref, r.b.ref].sort(natural);
        k = "p:" + s.join("\u0000"); label = s.join(" – ");
      }
      if (!k) { loose.push(r); return; }
      if (!cables.has(k)) cables.set(k, { key: k, label, file: !!r.cable, aRef: r.a ? r.a.ref : r.b.ref, rows: [] });
      cables.get(k).rows.push(r);
    });
    return { splices, cables: [...cables.values()], loose };
  }

  // ---------- build ----------
  // opt: { map: { ref: target }, cables: { key: { t: "new" | "loose" | "part", part } }, splice, wire: defaults }
  // Adds connectors, splices, cables and wires to p. Returns { conns, cables, wires, warn }.
  function buildFromNetlist(p, net, opt) {
    opt = opt || {};
    const map = opt.map || {}, warn = [];
    const def = Object.assign({ gauge: "24", gu: "AWG", insul: "PVC", color: "BK" }, opt.wire);
    const made = { conns: [], cables: [], wires: [], warn };
    const byRef = {};
    net.refs.forEach(r => {
      const t = map[r.ref] || { t: "lib", key: "custom" };
      const c = connFor(p, r.ref, r.pins, t);
      if (!c) { warn.push(r.ref + ": the connector picked is no longer in the drawing."); return; }
      byRef[r.ref] = c;
      if (t.t !== "have") { p.conns.push(c); made.conns.push(c); }
    });
    const nodes = Object.keys(byRef).filter(r => isNode(byRef[r]));
    const plan = netPlan(net, { splice: opt.splice, nodes });
    const endOf = e => {
      if (!e) return null;
      const c = byRef[e.ref];
      if (!c) return null;
      const i = pinIndex(c, e.pin);
      if (i < 0) { warn.push(e.ref + ": no pin \"" + e.pin + "\". Wire end left open."); return null; }
      return { c: c.id, p: i };
    };
    // pin signal from the file; a different one already there goes on the wire instead
    const sigTo = (w, row) => {
      if (!row.sig) return;
      let clash = false;
      [w.a, w.b].forEach(e => {
        const c = e && CD.byId(p.conns, e.c), pn = c && !isNode(c) && c.pins[e.p];
        if (!pn) return;
        if (!pn.sig) pn.sig = row.sig; else if (pn.sig !== row.sig) clash = true;
      });
      if (clash || (!w.a && !w.b)) w.sig = row.sig;
    };
    const props = row => ({
      gauge: row.gauge || def.gauge, gu: row.gauge ? row.gu : def.gu, insul: def.insul,
      color: row.color || def.color, stripe: row.color ? row.stripe : "", len: row.len
    });
    const looseIds = [];
    const addLoose = (row, a, b, ref, extra) => {
      const w = CD.newWire(p, Object.assign(props(row), { ref: "x", a, b }, extra));
      w.ref = ref || "";
      if (!w.ref) looseIds.push(w);
      p.wires.push(w); made.wires.push(w);
      sigTo(w, row);
      return w;
    };

    // cables named in the file first, so their references stay theirs
    const cabOf = {};
    plan.cables.slice().sort((x, y) => (y.file ? 1 : 0) - (x.file ? 1 : 0)).forEach(G => {
      const how = (opt.cables || {})[G.key] || { t: "new" };
      if (how.t === "loose") { G.rows.forEach(r => addLoose(r, endOf(r.a), endOf(r.b), r.wire)); return; }
      let cab, free = [];
      if (how.t === "part" && how.part) {
        cab = CD.cableFromPart(p, how.part, 0, 0);
        free = p.wires.filter(w => w.cable === cab.id && !CD.isDrain(w));
        made.wires.push(...p.wires.filter(w => w.cable === cab.id));
      } else {
        cab = CD.newCable(p, 0, 0, { desc: G.rows.length + " conductor cable" });
        p.cables.push(cab);
      }
      if (G.file) cab.ref = G.label;
      cabOf[G.key] = cab;
      made.cables.push(cab);
      // the most common length is the cable's; other lengths go on their wires
      const lens = {};
      G.rows.forEach(r => { if (r.len) lens[r.len] = (lens[r.len] || 0) + 1; });
      const top = Object.keys(lens).sort((x, y) => lens[y] - lens[x])[0] || "";
      cab.len = top;
      let din = 0, extra = 0;
      G.rows.forEach(r => {
        const flip = r.a ? r.a.ref !== G.aRef : true;
        const ea = endOf(flip ? r.b : r.a), eb = endOf(flip ? r.a : r.b);
        let w;
        if (free.length) {
          const i = r.color ? free.findIndex(x => x.color === r.color && x.stripe === r.stripe) : -1;
          w = free.splice(i < 0 ? 0 : i, 1)[0];
          if (r.color && i < 0) warn.push(cab.ref + ": no free " + CD.colorText(r) + " conductor for row " + r.line + ". Next free one used.");
        } else {
          const pr = props(r);
          if (!r.color) { pr.color = CD.DIN47100[din % CD.DIN47100.length]; din++; }
          w = CD.newWire(p, Object.assign(pr, { cable: cab.id }));
          p.wires.push(w); made.wires.push(w);
          if (how.t === "part") extra++;
        }
        w.a = ea; w.b = eb;
        w.ref = r.wire || "";
        w.len = r.len && r.len !== top ? r.len : "";
        sigTo(w, r);
      });
      if (extra) warn.push(cab.ref + ": the cable picked has too few conductors. " + extra + " added.");
    });

    // splices: one wire from each pin to a new splice
    plan.splices.forEach(S => {
      const sp = CD.newConn(p, "splice", 0, 0);
      p.conns.push(sp); made.conns.push(sp);
      let first = true;
      S.ends.forEach(e => {
        const row = S.rows.find(r => r.a === e || r.b === e || (r.a && r.a.ref === e.ref && r.a.pin === e.pin) || (r.b && r.b.ref === e.ref && r.b.pin === e.pin));
        const w = addLoose(Object.assign({}, row, { len: "" }), endOf(e), { c: sp.id, p: 0 }, first ? row.wire : "");
        if (!w.sig && S.sig && !(w.a && CD.byId(p.conns, w.a.c).pins[w.a.p].sig)) w.sig = S.sig;
        first = false;
      });
      if (S.sig) sp.pins[0].sig = S.sig;
    });
    plan.loose.forEach(r => addLoose(r, endOf(r.a), endOf(r.b), r.wire));
    looseIds.forEach(w => { w.ref = CD.nextWireNo(p); });
    return made;
  }

  // ---------- layout ----------
  const GAP_Y = 36, LEAD = 55, LOOSE_GAP = 150, MARGIN = 14;
  const SMALL = ["splice", "ground"];
  // Places the new items in columns (connectors), with cables in the gaps between them. Splices and
  // grounds take no column: they go in a gap next to the connectors they join.
  // Items already in the drawing stay where they are.
  function layoutNet(p, made) {
    const own = new Set(made.conns.map(c => c.id));
    const small = new Set(made.conns.filter(c => SMALL.includes(CD.libOf(c).kind)).map(c => c.id));
    const s0 = CD.scene(p, { sheet: 1 });
    const boxOf = (gid, it) => { const g = s0.groups.find(x => x.id === gid); return g && g.box ? { w: g.box.w, h: g.box.h, ox: g.box.x - it.x, oy: g.box.y - it.y } : { w: 100, h: 60, ox: 0, oy: 0 }; };
    const cbox = {}, wbox = {};
    made.conns.forEach(c => { cbox[c.id] = boxOf("c:" + c.id, c); });
    made.cables.forEach(c => { wbox[c.id] = boxOf("w:" + c.id, c); });

    // graph: connectors joined by cables (most common end on each side) and loose wires
    const adj = new Map(), edges = [], touch = new Map();   // touch: small node → connectors it joins
    const node = id => { if (!adj.has(id)) adj.set(id, []); };
    const link = (a, b, cable) => {
      if (small.has(a) || small.has(b)) {
        if (small.has(a) && b && !small.has(b)) (touch.get(a) || touch.set(a, []).get(a)).push(b);
        if (small.has(b) && a && !small.has(a)) (touch.get(b) || touch.set(b, []).get(b)).push(a);
        if (cable) edges.push({ a: small.has(a) ? b : a, b: null, cable });
        return;
      }
      if (!b || a === b) { if (a) node(a); if (cable) edges.push({ a, b: null, cable }); return; }
      node(a); node(b);
      edges.push({ a, b, cable });
      adj.get(a).push(b); adj.get(b).push(a);
    };
    const most = list => { const n = {}; list.forEach(x => { if (x) n[x] = (n[x] || 0) + 1; }); return Object.keys(n).sort((x, y) => n[y] - n[x])[0] || null; };
    made.conns.forEach(c => { if (!small.has(c.id)) node(c.id); });
    made.cables.forEach(cb => {
      const ws = p.wires.filter(w => w.cable === cb.id);
      const a = most(ws.map(w => w.a && w.a.c)), b = most(ws.map(w => w.b && w.b.c));
      link(a || b, a ? b : null, cb);
    });
    made.wires.filter(w => !w.cable && w.a && w.b).forEach(w => link(w.a.c, w.b.c, null));

    // columns: breadth-first from one end of the longest path in each part of the graph
    const bfs = start => { const d = new Map([[start, 0]]), order = [start], par = new Map(); for (let i = 0; i < order.length; i++) adj.get(order[i]).forEach(n => { if (!d.has(n)) { d.set(n, d.get(order[i]) + 1); par.set(n, order[i]); order.push(n); } }); return { d, order, par }; };
    const done = new Set(), parts = [];
    [...adj.keys()].forEach(id => {
      if (done.has(id)) return;
      const first = bfs(id);
      const far = first.order.reduce((m, n) => first.d.get(n) > first.d.get(m) ? n : m, id);
      const r = bfs(far);
      r.order.forEach(n => done.add(n));
      parts.push(r);
    });

    const pos = {};   // group id → top-left of its box
    let top = 0;
    parts.forEach(r => {
      const cols = [];
      r.order.forEach(n => { const d = r.d.get(n); (cols[d] = cols[d] || []).push(n); });
      const colW = cols.map(list => Math.max(60, ...list.map(n => own.has(n) ? cbox[n].w : 60)));
      // a cable or small node sits in the gap right of the shallower connector it joins (left of a lone last column)
      const gapOf = ids => { const ds = ids.filter(x => x && r.d.has(x)).map(x => r.d.get(x)); const lo = Math.min(...ds); return ds.some(d => d > lo) || lo < cols.length - 1 || !lo ? lo : lo - 1; };
      const mineE = edges.filter(e => e.cable && (r.d.has(e.a) || r.d.has(e.b)));
      const mineN = [...touch].filter(([, list]) => list.some(x => r.d.has(x)));
      const gapW = cols.map((x, d) => Math.max(LOOSE_GAP, ...mineE.filter(e => gapOf([e.a, e.b]) === d).map(e => wbox[e.cable.id].w + LEAD * 2), ...mineN.filter(([, l]) => gapOf(l) === d).map(([id]) => cbox[id].w + LEAD * 2)));
      const colX = [0];
      cols.forEach((x, d) => { colX[d + 1] = colX[d] + colW[d] + gapW[d]; });
      const colCur = cols.map(() => top), gapCur = cols.map(() => top);
      const placed = new Set();
      const inGap = (gid, b, d, y) => {
        y = Math.max(y == null ? top : y, gapCur[d]);
        pos[gid] = { x: colX[d] + colW[d] + (gapW[d] - b.w) / 2, y };
        gapCur[d] = y + b.h + GAP_Y;
      };
      const placeCable = (e, d, y) => { if (placed.has(e.cable.id)) return; placed.add(e.cable.id); inGap("w:" + e.cable.id, wbox[e.cable.id], d, y); };
      r.order.forEach(n => {
        const d = r.d.get(n), h = own.has(n) ? cbox[n].h : 0;
        const y = d ? Math.max(colCur[d], gapCur[d - 1]) : colCur[d];
        if (own.has(n)) pos["c:" + n] = { x: colX[d] + (colW[d] - cbox[n].w) / 2, y };
        colCur[d] = y + (h ? h + GAP_Y : 0);
        if (!d) return;
        const par = r.par.get(n);
        mineE.filter(e => (e.a === n && e.b === par) || (e.b === n && e.a === par)).forEach(e => placeCable(e, d - 1, y));
        colCur[d] = gapCur[d - 1] = Math.max(colCur[d], gapCur[d - 1]);
      });
      // cables left over (more than one path between two connectors, or one-ended), then splices and grounds
      mineE.filter(e => !placed.has(e.cable.id)).forEach(e => placeCable(e, gapOf([e.a, e.b])));
      mineN.forEach(([id, list]) => {
        const ys = list.filter(x => pos["c:" + x]).map(x => pos["c:" + x].y + cbox[x].h / 2);
        inGap("c:" + id, cbox[id], gapOf(list), ys.length ? Math.min(...ys) - cbox[id].h / 2 : null);
        touch.delete(id);
      });
      top = Math.max(...colCur, ...gapCur) + GAP_Y;
    });
    // items joined to nothing laid out
    made.cables.forEach(cb => { if (!pos["w:" + cb.id]) { pos["w:" + cb.id] = { x: 0, y: top }; top += wbox[cb.id].h + GAP_Y; } });
    made.conns.forEach(c => { if (!pos["c:" + c.id]) { pos["c:" + c.id] = { x: 0, y: top }; top += cbox[c.id].h + GAP_Y; } });

    made.conns.forEach(c => { const q = pos["c:" + c.id], b = cbox[c.id]; c.x = Math.round(q.x - b.ox); c.y = Math.round(q.y - b.oy); });
    made.cables.forEach(c => { const q = pos["w:" + c.id], b = wbox[c.id]; c.x = Math.round(q.x - b.ox); c.y = Math.round(q.y - b.oy); });
  }

  // Moves the new items as one block to the first free space on sheet 1 (top-left first).
  // With no free space: the place with the least overlap, kept on the sheet where it can be.
  // Returns { fits }.
  function placeBlock(p, made) {
    const s0 = CD.scene(p, { sheet: 1 }), fr = s0.frame;
    const mine = new Set(made.conns.map(c => "c:" + c.id).concat(made.cables.map(c => "w:" + c.id)));
    const items = made.conns.concat(made.cables);
    const boxes = s0.groups.filter(g => mine.has(g.id) && g.box).map(g => g.box);
    if (!boxes.length) return { fits: true };
    const x0 = Math.min(...boxes.map(b => b.x)), y0 = Math.min(...boxes.map(b => b.y));
    const w = Math.max(...boxes.map(b => b.x + b.w)) - x0, h = Math.max(...boxes.map(b => b.y + b.h)) - y0;
    const others = s0.groups.filter(g => !mine.has(g.id) && g.box && !["wire", "tie", "frame"].includes(g.kind)).map(g => g.box).concat([s0.tb, s0.rev]).filter(Boolean);
    const overlap = (x, y) => others.reduce((a, b) => a + Math.max(0, Math.min(x + w + MARGIN, b.x + b.w) - Math.max(x, b.x - MARGIN)) * Math.max(0, Math.min(y + h + MARGIN, b.y + b.h) - Math.max(y, b.y - MARGIN)), 0);
    const L = fr.L + 12, T = fr.T + 12, R = Math.max(L, fr.R - 12 - w), B = Math.max(T, fr.B - 12 - h);
    let best = { x: L, y: T, a: Infinity };
    for (let y = T; y <= B && best.a; y += 10) for (let x = L; x <= R; x += 10) { const a = overlap(x, y); if (a < best.a) { best = { x, y, a }; if (!a) break; } }
    const dx = Math.round(best.x - x0), dy = Math.round(best.y - y0);
    items.forEach(it => { it.x += dx; it.y += dy; });
    return { fits: !best.a && w <= fr.R - fr.L - 24 && h <= fr.B - fr.T - 24 };
  }

  Object.assign(CD, { NET_FIELDS: FIELDS, parseFromTo, parseColor, parseSize, netPlan, missingPins, buildFromNetlist, layoutNet, placeBlock, netPinIndex: pinIndex });
})(typeof window !== "undefined" ? window : globalThis);
