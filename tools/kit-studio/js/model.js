/*
  Kit Studio — data model
  Scope: BOM and line records, the Standard BOM Template parser (header block +
  "Item #" column row), required/shortage math, parts-list (CSV) lookup and
  backfill, and the .kitproj session format (same JSON keys as the desktop
  app, so older session files still load). No DOM access; Node tests load it.
*/
(function (root) {
  "use strict";

  const SESSION_APP = "Kit Studio";
  const SESSION_VERSION = "3.0";

  // ---------- records ----------
  function newLine(o = {}) {
    return Object.assign({
      item: "", atlas_pn: "", qty_per: 0, refdes: "", desc: "", mount: "", mfr: "", mpn: "",
      enabled: true, on_hand: "", sub: "", req_override: "", is_pcb: false
    }, o);
  }

  function newBom(o = {}) {
    return Object.assign({
      source_file: "", assembly_desc: "", assembly_pn: "", assembly_rev: "",
      pcb_desc: "", pcb_pn: "", pcb_rev: "", created: "",
      build_order: "", build_qty: 1, attrition: 5.0, lines: []
    }, o);
  }

  const baseName = p => String(p || "").split(/[\\/]/).pop();

  function displayName(bom) {
    const pn = bom.assembly_pn || baseName(bom.source_file);
    return pn + (bom.assembly_rev ? " Rev " + bom.assembly_rev : "");
  }

  // ---------- math ----------
  // Python float() / int() semantics: whole string must be numeric.
  const num = s => { const t = String(s == null ? "" : s).trim(); if (!t) return NaN; const n = Number(t); return Number.isFinite(n) ? n : NaN; };
  // Non-negative number typed by hand: "12", "12.5", ".5", "3."
  const isQty = s => /^(\d+\.?\d*|\.\d+)$/.test(String(s).trim());

  // ceil(qty × build × (1 + attr%)). The 1e-9 guard stops float noise
  // (1 × 100 × 1.10 = 110.00000000000001) from adding a part.
  function autoRequired(line, buildQty, attritionPct) {
    if (!(line.qty_per > 0)) return 0;
    return Math.ceil(line.qty_per * buildQty * (1 + attritionPct / 100) - 1e-9);
  }

  function required(line, buildQty, attritionPct) {
    const ov = String(line.req_override || "").trim();
    if (ov) { const n = num(ov); if (!isNaN(n)) return Math.trunc(n); }
    return autoRequired(line, buildQty, attritionPct);
  }

  function shortage(line, buildQty, attritionPct) {
    const oh = num(line.on_hand);
    if (isNaN(oh)) return 0;              // blank or invalid = not counted
    return Math.max(0, required(line, buildQty, attritionPct) - Math.trunc(oh));
  }

  // ---------- BOM template parser ----------
  const HEADER_FIELD_MAP = {
    "assembly description": "assembly_desc", "assembly part number": "assembly_pn", "assembly revision": "assembly_rev",
    "pcb description": "pcb_desc", "pcb part number": "pcb_pn", "pcb revision": "pcb_rev", "bom created": "created"
  };
  const DATA_COL_MAP = {
    "item #": "item", "atlas part number": "atlas_pn", "quantity": "qty_per", "designator": "refdes",
    "comment": "desc", "mounting technology": "mount", "manufacturer": "mfr", "manufacturer part number": "mpn"
  };
  const REQUIRED_COLS = ["item", "atlas_pn", "qty_per", "mpn"];

  // Template placeholders like "Field=VariantName" read as blank
  const clean = v => { const s = v == null ? "" : String(v).trim(); return s.startsWith("Field=") ? "" : s; };

  // rows: grid from KS.readActiveSheet (0-based). fileName: name only, no path.
  function parseBom(rows, fileName) {
    const bom = newBom({ source_file: baseName(fileName) });

    // Header block: "Label:" cell, value in the next column; stops at the "Item #" row
    let headerRow = -1;
    for (let r = 0; r < Math.min(rows.length, 15) && headerRow < 0; r++) {
      const row = rows[r] || [];
      for (let c = 0; c < row.length; c++) {
        const v = clean(row[c]); if (!v) continue;
        const key = v.replace(/:+$/, "").trim().toLowerCase();
        if (HEADER_FIELD_MAP[key]) bom[HEADER_FIELD_MAP[key]] = clean(row[c + 1]);
        if (key === "item #") headerRow = r;
      }
    }
    if (headerRow < 0) throw new Error("Could not find the 'Item #' column header row. Is this a Standard BOM Template export?");

    const col = {};
    (rows[headerRow] || []).forEach((cell, i) => {
      let v = clean(cell);
      if (v.startsWith("Column=")) v = v.slice(7);
      const f = DATA_COL_MAP[v.trim().toLowerCase()];
      if (f) col[f] = i;
    });
    const missing = REQUIRED_COLS.filter(f => !(f in col));
    if (missing.length) throw new Error("BOM is missing required column(s): " + missing.sort().join(", "));

    for (let r = headerRow + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      if (!row.some(v => v != null && String(v).trim())) continue;
      const cell = f => (col[f] == null || col[f] >= row.length) ? "" : clean(row[col[f]]);
      const item = cell("item"), mpn = cell("mpn"), atlas = cell("atlas_pn");
      if (!(item || mpn || atlas)) continue;
      const q = num(cell("qty_per") || "0");
      bom.lines.push(newLine({
        item, atlas_pn: atlas, qty_per: isNaN(q) ? 0 : q,
        refdes: cell("refdes"), desc: cell("desc"), mount: cell("mount"), mfr: cell("mfr"), mpn
      }));
    }

    // Bare PCB as an optional first line
    if (bom.pcb_pn) {
      bom.lines.unshift(newLine({
        item: "PCB", atlas_pn: bom.pcb_pn, qty_per: 1, refdes: "—",
        desc: (bom.pcb_desc || "Bare PCB") + (bom.pcb_rev ? "  Rev " + bom.pcb_rev : ""),
        mpn: bom.pcb_pn, is_pcb: true
      }));
    }
    return bom;
  }

  // ---------- parts list (CSV) ----------
  const PART_FIELDS = ["atlas_pn", "mfr", "mpn", "desc"];
  const PART_GUESS = {
    mpn: /(manufacturer|mfr|mfg|mfgr|mfger)\.?\s*(part|p\/?n)|^mpn$/i,
    atlas_pn: /atlas.*(part|p\/?n|number)|^(internal|company)\s*(part\s*)?(number|p\/?n|#)$|^part\s*(number|no\.?|#)$|^p\/?n$|^partnumber$/i,
    mfr: /^(manufacturer|mfr|mfg|mfgr|mfger)\.?(\s*name)?$/i,
    desc: /^(description|desc\.?|part description|component description)$/i
  };

  // headers → { field: column index or -1 }; MPN claims its column first
  function guessPartsColumns(headers) {
    const h = headers.map(x => String(x || "").trim()), map = {}, used = new Set();
    for (const f of ["mpn", "atlas_pn", "mfr", "desc"]) {
      let i = h.findIndex((x, j) => !used.has(j) && f === "atlas_pn" && /atlas/i.test(x) && PART_GUESS[f].test(x));
      if (i < 0) i = h.findIndex((x, j) => !used.has(j) && PART_GUESS[f].test(x));
      map[f] = i; if (i >= 0) used.add(i);
    }
    return map;
  }

  // rows (header first) + column map → compact records [atlas_pn, mfr, mpn, desc]
  function partsFromRows(rows, map) {
    const out = [], get = (r, f) => map[f] >= 0 ? String(r[map[f]] || "").trim() : "";
    for (const r of rows.slice(1)) {
      const rec = PART_FIELDS.map(f => get(r, f));
      if (rec[2]) out.push(rec);
    }
    return out;
  }

  // MPN (case-insensitive) → first record, like the old Access lookup
  function partsIndex(records) {
    const idx = new Map();
    for (const rec of records || []) { const k = rec[2].toUpperCase(); if (!idx.has(k)) idx.set(k, rec); }
    return idx;
  }

  // Backfill blank desc / mfr / Atlas PN from the parts list. Returns lines changed.
  function enrichBom(bom, idx) {
    if (!idx || !idx.size) return 0;
    let n = 0;
    for (const line of bom.lines) {
      if (line.is_pcb || (line.desc && line.mfr && line.atlas_pn)) continue;
      const hit = idx.get(String(line.mpn || "").trim().toUpperCase());
      if (!hit) continue;
      const before = line.desc + "\u0000" + line.mfr + "\u0000" + line.atlas_pn;
      if (!line.desc) line.desc = hit[3];
      if (!line.mfr) line.mfr = hit[1];
      if (!line.atlas_pn) line.atlas_pn = hit[0];
      if (before !== line.desc + "\u0000" + line.mfr + "\u0000" + line.atlas_pn) n++;
    }
    return n;
  }

  // ---------- session (.kitproj) ----------
  function toSession(boms, defaults) {
    return {
      app: SESSION_APP, version: SESSION_VERSION, saved: new Date().toISOString(),
      default_bo: defaults.bo, default_qty: defaults.qty, default_attr: defaults.attr,
      boms: boms.map(b => Object.assign({}, b, { lines: b.lines.map(l => Object.assign({}, l)) }))
    };
  }

  function pick(src, proto) {
    const o = {};
    for (const k of Object.keys(proto)) if (k !== "lines" && src[k] !== undefined) o[k] = src[k];
    return o;
  }

  function fromSession(data) {
    if (!data || !Array.isArray(data.boms)) throw new Error("Not a Kit Studio session file.");
    const L = newLine(), B = newBom();
    const boms = data.boms.map(bd => {
      const bom = newBom(pick(bd, B));
      bom.source_file = baseName(bom.source_file);     // older files carry a full path
      bom.build_qty = Math.max(1, Math.trunc(num(bom.build_qty)) || 1);
      bom.attrition = isNaN(num(bom.attrition)) ? 5 : num(bom.attrition);
      bom.lines = (bd.lines || []).map(ld => {
        const l = newLine(pick(ld, L));
        l.qty_per = isNaN(num(l.qty_per)) ? 0 : num(l.qty_per);
        for (const k of ["item", "atlas_pn", "refdes", "desc", "mount", "mfr", "mpn", "on_hand", "sub", "req_override"]) l[k] = l[k] == null ? "" : String(l[k]);
        l.enabled = l.enabled !== false; l.is_pcb = !!l.is_pcb;
        return l;
      });
      return bom;
    });
    // v2.0 files kept one global build order / qty / attrition
    if ("build_order" in data) for (const b of boms) if (!b.build_order) {
      b.build_order = String(data.build_order || "");
      b.build_qty = Math.max(1, Math.trunc(num(data.build_qty)) || 1);
      b.attrition = isNaN(num(data.attrition)) ? 5 : num(data.attrition);
    }
    const defaults = {
      bo: String(data.default_bo != null ? data.default_bo : (data.build_order || "")),
      qty: Math.max(1, Math.trunc(num(data.default_qty != null ? data.default_qty : data.build_qty)) || 1),
      attr: (n => isNaN(n) ? 5 : n)(num(data.default_attr != null ? data.default_attr : data.attrition))
    };
    return { boms, defaults };
  }

  // ---------- file names ----------
  const safeTag = s => String(s).replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "") || "kit";
  function boTag(boms, fallback) {
    const bos = [...new Set(boms.filter(b => b.build_order && b.lines.some(l => l.enabled)).map(b => b.build_order))].sort();
    return safeTag(bos.length === 1 ? bos[0] : bos.length ? "multi" : fallback);
  }
  const stamp = (d, withTime) => {
    const p = n => String(n).padStart(2, "0");
    const s = d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate());
    return withTime ? s + "_" + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) : s;
  };

  root.KS = root.KS || {};
  Object.assign(root.KS, {
    SESSION_APP, SESSION_VERSION, newLine, newBom, displayName, baseName, num, isQty,
    autoRequired, required, shortage, parseBom,
    PART_FIELDS, guessPartsColumns, partsFromRows, partsIndex, enrichBom,
    toSession, fromSession, boTag, stamp
  });
})(typeof window !== "undefined" ? window : globalThis);
