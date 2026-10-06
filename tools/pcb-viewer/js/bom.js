/*
  PCB Viewer — BOM reader
  Scope: reads a BOM from .xlsx (minimal ZIP + SpreadsheetML reader using the
  browser's DecompressionStream) or .csv/.tsv, finds the header row by its
  designator column, maps known columns (Atlas PN, manufacturer, MPN, name,
  description), and expands designators (C1, C2 / R1-R4) to one record per refdes.
*/
(function () {
  "use strict";

  // ---------- ZIP ----------
  async function unzip(buf) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf);
    let eocd = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error("Not a ZIP/XLSX file.");
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const files = new Map(), dec = new TextDecoder();
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
      const lho = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nl));
      files.set(name, { method, csize, lho });
      p += 46 + nl + el + cl;
    }
    return {
      has: n => files.has(n),
      async text(name) {
        const f = files.get(name); if (!f) return null;
        const q = f.lho, start = q + 30 + dv.getUint16(q + 26, true) + dv.getUint16(q + 28, true);
        const raw = u8.subarray(start, start + f.csize);
        if (f.method === 0) return dec.decode(raw);
        if (f.method !== 8) throw new Error("Unsupported ZIP compression in " + name);
        if (typeof DecompressionStream === "undefined") throw new Error("This browser cannot read .xlsx. Save the BOM as .csv.");
        const s = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        return await new Response(s).text();
      }
    };
  }

  const xml = t => new DOMParser().parseFromString(t, "application/xml");
  const colIdx = ref => { let n = 0; for (const ch of ref.replace(/\d+/g, "")) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };

  // ---------- XLSX -> sheets of string rows ----------
  async function readXLSX(buf) {
    const z = await unzip(buf);
    const wb = xml(await z.text("xl/workbook.xml") || "<x/>");
    const rels = xml(await z.text("xl/_rels/workbook.xml.rels") || "<x/>");
    const relMap = new Map();
    for (const r of rels.getElementsByTagName("Relationship")) relMap.set(r.getAttribute("Id"), r.getAttribute("Target"));
    const ss = [];
    const sst = await z.text("xl/sharedStrings.xml");
    if (sst) for (const si of xml(sst).getElementsByTagName("si")) {
      let s = ""; for (const t of si.getElementsByTagName("t")) if (t.parentElement.localName !== "rPh") s += t.textContent; ss.push(s);
    }
    const sheets = [];
    for (const sh of wb.getElementsByTagName("sheet")) {
      const rid = sh.getAttribute("r:id") || sh.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
      let target = relMap.get(rid) || ""; if (!target) continue;
      target = target.startsWith("/") ? target.slice(1) : "xl/" + target.replace(/^\.\//, "");
      const t = await z.text(target); if (!t) continue;
      const rows = [];
      for (const row of xml(t).getElementsByTagName("row")) {
        const r = [];
        for (const c of row.getElementsByTagName("c")) {
          const ty = c.getAttribute("t"), v = c.getElementsByTagName("v")[0];
          let val = "";
          if (ty === "s") val = ss[+(v && v.textContent)] || "";
          else if (ty === "inlineStr") { const is = c.getElementsByTagName("is")[0]; val = is ? is.textContent : ""; }
          else if (ty === "b") val = v && v.textContent === "1" ? "TRUE" : "FALSE";
          else val = v ? v.textContent : "";
          r[colIdx(c.getAttribute("r") || "A")] = val;
        }
        rows[(+row.getAttribute("r") || rows.length + 1) - 1] = Array.from(r, x => x == null ? "" : String(x).trim());
      }
      sheets.push({ name: sh.getAttribute("name"), rows: Array.from(rows, x => x || []) });
    }
    return sheets;
  }

  // ---------- CSV ----------
  function readCSV(text) {
    text = text.replace(/^﻿/, "");
    const first = text.split(/\r?\n/, 1)[0] || "";
    const delim = [",", "\t", ";"].map(d => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
    const rows = []; let row = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
      else if (ch === '"') q = true;
      else if (ch === delim) { row.push(cell.trim()); cell = ""; }
      else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell.trim()); rows.push(row); row = []; cell = ""; }
      else cell += ch;
    }
    if (cell || row.length) { row.push(cell.trim()); rows.push(row); }
    return [{ name: "CSV", rows }];
  }

  // ---------- interpret ----------
  const RX = {
    ref: /^(designators?|ref\.? ?des(ignators?)?|reference( designators?)?|refdes|references?|parts?)$/i,
    atlas: /atlas.*(part|p\/?n|number)|^(internal|company)\s*(part\s*)?(number|p\/?n|#)$|^part ?(number|no\.?|#)$|^p\/?n$/i,
    mpn: /(manufacturer|mfr|mfg|mfgr)\.?\s*(part|p\/?n)|^mpn$/i,
    mfr: /^(manufacturer|mfr|mfg|mfgr)\.?(\s*name)?$/i,
    desc: /^(description|desc\.?|part description|component description)$/i,
    name: /^(name|value|comment|part name|val)$/i,
    qty: /^(qty|quantity|count)$/i,
    mount: /mount|technology|smt|type$/i
  };

  function expandRefs(s) {
    const out = [];
    for (const tok of String(s).split(/[,;\s]+/).filter(Boolean)) {
      const m = tok.match(/^([A-Za-z_]+)(\d+)\s*[-–:]\s*([A-Za-z_]*)(\d+)$/);
      if (m && (!m[3] || m[3] === m[1]) && +m[4] >= +m[2] && +m[4] - +m[2] < 500) for (let i = +m[2]; i <= +m[4]; i++) out.push(m[1] + i);
      else out.push(tok);
    }
    return out;
  }
  const clean = v => (v == null || /^<parameter .* not found>$/i.test(String(v).trim())) ? "" : String(v).trim();

  // Atlas PNs are zero-padded (e.g. 01716); Excel stores them as numbers and drops the zeros.
  const ATLAS_PN_DIGITS = 5;
  const normPN = v => /^\d+$/.test(v) && v.length < ATLAS_PN_DIGITS ? v.padStart(ATLAS_PN_DIGITS, "0") : v;

  function interpret(sheets) {
    let pick = null;
    for (const sh of sheets) {
      const hi = sh.rows.findIndex(r => r.some(c => RX.ref.test(String(c).trim())));
      if (hi >= 0) { pick = { sh, hi }; break; }
    }
    if (!pick) throw new Error("No designator column found in the BOM (looked for a header like “Designator” or “RefDes”).");
    const { sh, hi } = pick;
    const headers = sh.rows[hi].map(h => String(h || "").trim());
    const find = rx => headers.findIndex(h => rx.test(h));
    const cols = { ref: find(RX.ref), mpn: find(RX.mpn), desc: find(RX.desc), name: find(RX.name), qty: find(RX.qty) };
    cols.mfr = headers.findIndex((h, i) => RX.mfr.test(h) && i !== cols.mpn);
    cols.atlas = headers.findIndex(h => /atlas/i.test(h) && RX.atlas.test(h));
    if (cols.atlas < 0) cols.atlas = headers.findIndex((h, i) => RX.atlas.test(h) && i !== cols.mpn);
    cols.mount = headers.findIndex((h, i) => RX.mount.test(h) && !Object.values(cols).includes(i));

    // Key/value pairs above the header row ("Assembly Part Number:", value)
    const meta = [];
    for (let i = 0; i < hi; i++) {
      const r = sh.rows[i] || [];
      for (let j = 0; j < r.length; j++) {
        const k = String(r[j] || "").trim();
        if (k.endsWith(":") && k.length > 1) {
          const v = clean(r.slice(j + 1).find(x => String(x || "").trim() !== ""));
          if (!/^=/.test(v)) meta.push({ k: k.slice(0, -1), v });
        }
      }
    }

    return build({ sheet: sh.name, headers, meta, data: sh.rows.slice(hi + 1), auto: { ...cols } }, cols);
  }

  // (Re)builds BOM lines from a column map. Also used when the operator picks columns by hand.
  function build(bom, cols) {
    const lines = [], byRef = new Map();
    for (const row of bom.data) {
      const r = row || [];
      const refs = expandRefs(r[cols.ref] || "");
      if (!refs.length) continue;
      const get = c => c >= 0 ? clean(r[c]) : "";
      const fields = {};
      bom.headers.forEach((h, j) => { if (h && j !== cols.ref) { const v = clean(r[j]); if (v && !/^=/.test(v)) fields[h] = j === cols.atlas ? normPN(v) : v; } });
      const line = { idx: lines.length, refs, atlas: normPN(get(cols.atlas)), mpn: get(cols.mpn), mfr: get(cols.mfr), desc: get(cols.desc), name: get(cols.name), qty: get(cols.qty), mount: get(cols.mount), fields };
      lines.push(line);
      for (const ref of refs) byRef.set(ref, line);
    }
    return Object.assign(bom, { cols: { ...cols }, lines, byRef, needsMap: cols.atlas < 0 || (cols.desc < 0 && cols.name < 0) });
  }

  async function readBOM(file) {
    const n = file.name.toLowerCase();
    let sheets;
    if (n.endsWith(".xlsx") || n.endsWith(".xlsm")) sheets = await readXLSX(await file.arrayBuffer());
    else if (n.endsWith(".xls")) throw new Error("Legacy .xls is not supported. Save the BOM as .xlsx or .csv.");
    else sheets = readCSV(await file.text());
    return interpret(sheets);
  }

  window.PCBV = window.PCBV || {};
  Object.assign(window.PCBV, { readBOM, expandRefs, bomBuild: build, normPN });
})();
