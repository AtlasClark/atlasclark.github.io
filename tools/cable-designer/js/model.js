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
    history: [], notes: [], conns: [], cables: [], wires: [], callouts: []
  });

  const REF_PREFIX = { conn: "P", term: "E", flying: "FL", splice: "SP", ground: "GND" };
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
      custom: lib.custom ? { rows: 1, order: "rows" } : null,
      strip: "", note: "", x: Math.round(x || 0), y: Math.round(y || 0)
    };
  }
  function setPinCount(p, c, n) {
    const lib = CD.LIB[c.lib] || CD.LIB.custom;
    const v = lib.var || [c.pins.length, c.pins.length];
    n = Math.max(v[0], Math.min(v[1], Math.round(n) || v[0]));
    if (lib.even && n % 2) n++;
    while (c.pins.length < n) c.pins.push({ n: String(c.pins.length + 1), sig: "" });
    c.pins.length = n;
    p.wires.forEach(w => ["a", "b"].forEach(e => { if (w[e] && w[e].c === c.id && w[e].p >= n) w[e] = null; }));
    return n;
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
  const newCallout = (x, y, o) => Object.assign({ id: uid(), kind: "text", text: "", x: Math.round(x), y: Math.round(y), lx: null, ly: null }, o);

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
    p.callouts = arr(d.callouts).map(c => newCallout(c.x || 0, c.y || 0, c));
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
    });
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
      const desc = c.desc || lib.name + (lib.var ? ", " + c.pins.length + " pos" : "") + g;
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
      const r = put(keyOf("w", c, desc), { mfr: c.mfr, mpn: c.mpn, ipn: c.ipn, desc }, L == null ? 1 : L, L == null ? "ea" : u, c.ref, c.id);
      if (L == null && r.unit !== "ea") r.unit = u;
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
  const bomCells = (r, m) => [String(r.item), r.unit === "ea" ? String(r.qty) : fmtLen(r.qty, Object.assign({}, m, { alt: false })), r.unit, r.ipn, r.mfr, r.mpn, r.desc, r.refs.join(", ")];

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
    blankProject, normalize, newConn, setPinCount, newCable, newWire, newGroup, newMark, newCallout, cablePreset, nextWireNo,
    byId, libOf, groupOf, conductors, wireRef, endText, sigOf, isDrain, colorText, gaugeText,
    UNIT, fmtLen, fmtTol, wireLen, WIRE_COLS, wireRows, BOM_COLS, bom, bomCells, checks,
    csvCell, wireCsv, bomCsv, connectCable, example
  });
})(typeof window !== "undefined" ? window : globalThis);
