/*
  Kit Studio — file readers
  Scope: reads the active sheet of an .xlsx/.xlsm/.xltx workbook into a grid of
  trimmed strings (minimal ZIP + SpreadsheetML reader on the browser's
  DecompressionStream; adapted from the PCB Viewer), and reads CSV/TSV text
  with delimiter detection and a Windows-1252 fallback. Files are read in
  memory only.
*/
(function () {
  "use strict";

  // ---------- ZIP ----------
  async function unzip(buf) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf);
    let eocd = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error("Not an Excel workbook (no ZIP directory found).");
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const files = new Map(), dec = new TextDecoder();
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
      const lho = dv.getUint32(p + 42, true);
      files.set(dec.decode(u8.subarray(p + 46, p + 46 + nl)), { method, csize, lho });
      p += 46 + nl + el + cl;
    }
    return {
      async text(name) {
        const f = files.get(name); if (!f) return null;
        const q = f.lho, start = q + 30 + dv.getUint16(q + 26, true) + dv.getUint16(q + 28, true);
        const raw = u8.subarray(start, start + f.csize);
        if (f.method === 0) return dec.decode(raw);
        if (f.method !== 8) throw new Error("Unsupported ZIP compression in " + name);
        if (typeof DecompressionStream === "undefined") throw new Error("This browser cannot read .xlsx files. Use a current Chrome, Edge or Firefox.");
        const s = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        return await new Response(s).text();
      }
    };
  }

  const xml = t => new DOMParser().parseFromString(t, "application/xml");
  const colIdx = ref => { let n = 0; for (const ch of ref.replace(/\d+/g, "")) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
  const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

  // Active sheet → rows[r][c] (0-based), strings trimmed, gaps as "".
  async function readActiveSheet(buf) {
    const z = await unzip(buf);
    const wb = xml(await z.text("xl/workbook.xml") || "<x/>");
    const rels = xml(await z.text("xl/_rels/workbook.xml.rels") || "<x/>");
    const relMap = new Map();
    for (const r of rels.getElementsByTagName("Relationship")) relMap.set(r.getAttribute("Id"), r.getAttribute("Target"));

    const sheets = [...wb.getElementsByTagName("sheet")];
    if (!sheets.length) throw new Error("The workbook has no sheets.");
    const view = wb.getElementsByTagName("workbookView")[0];
    const active = Math.min(+(view && view.getAttribute("activeTab")) || 0, sheets.length - 1);
    const sh = sheets[active];
    const rid = sh.getAttribute("r:id") || sh.getAttributeNS(REL_NS, "id");
    let target = relMap.get(rid) || "";
    if (!target) throw new Error("Could not locate the active sheet.");
    target = target.startsWith("/") ? target.slice(1) : "xl/" + target.replace(/^\.\//, "");

    const ss = [];
    const sst = await z.text("xl/sharedStrings.xml");
    if (sst) for (const si of xml(sst).getElementsByTagName("si")) {
      let s = ""; for (const t of si.getElementsByTagName("t")) if (t.parentElement.localName !== "rPh") s += t.textContent; ss.push(s);
    }

    const rows = [];
    for (const row of xml(await z.text(target) || "<x/>").getElementsByTagName("row")) {
      const r = [];
      for (const c of row.getElementsByTagName("c")) {
        const ty = c.getAttribute("t"), v = c.getElementsByTagName("v")[0];
        let val = "";
        if (ty === "s") val = ss[+(v && v.textContent)] || "";
        else if (ty === "inlineStr") { const is = c.getElementsByTagName("is")[0]; val = is ? is.textContent : ""; }
        else if (ty === "b") val = v && v.textContent === "1" ? "TRUE" : "FALSE";
        else val = v ? v.textContent : "";
        // Numeric cells: drop float noise ("0.10000000000000001" → "0.1")
        if (!ty && /^-?\d+(\.\d+)?(e[-+]?\d+)?$/i.test(val)) val = String(Number(val));
        r[colIdx(c.getAttribute("r") || "A")] = val;
      }
      rows[(+row.getAttribute("r") || rows.length + 1) - 1] = Array.from(r, x => x == null ? "" : String(x).trim());
    }
    return Array.from(rows, x => x || []);
  }

  // ---------- CSV ----------
  function decodeText(buf) {
    try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); }
    catch (e) { return new TextDecoder("windows-1252").decode(buf); }   // Excel "CSV" (non-UTF-8) export
  }

  function parseCSV(text) {
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
    return rows.filter(r => r.some(c => c !== ""));
  }

  async function readCSVFile(file) { return parseCSV(decodeText(await file.arrayBuffer())); }

  window.KS = window.KS || {};
  Object.assign(window.KS, { readActiveSheet, parseCSV, readCSVFile });
})();
