/*
  Work Instructions — export
  Scope: flattens each step to a PNG canvas and builds the outputs: PNG,
  PDF (jsPDF), Word .docx (Confluence Cloud import), one-file HTML, Markdown,
  and a .zip wiki bundle (Markdown + HTML + PDF + .docx + images/). All in
  memory; the caller saves the result.
*/
(function () {
  "use strict";
  const WI = window.WI, D = WI.draw;

  const NOTE = { note: "Note", tip: "Tip", caution: "Caution", warning: "Warning" };
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pad2 = n => String(n).padStart(2, "0");
  const imgName = i => "step-" + pad2(i + 1) + ".png";

  // ---------- flatten ----------
  function stepCanvas(step, bmp, maxDim) {
    const r = step.crop || { x: 0, y: 0, w: bmp.width, h: bmp.height };
    const k = maxDim ? Math.min(1, maxDim / Math.max(r.w, r.h)) : 1;
    const cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(r.w * k)); cv.height = Math.max(1, Math.round(r.h * k));
    const ctx = cv.getContext("2d");
    ctx.setTransform(k, 0, 0, k, -r.x * k, -r.y * k);
    D.render(ctx, step, bmp, r);
    return cv;
  }
  const toBlob = cv => new Promise((res, rej) => cv.toBlob(b => b ? res(b) : rej(new Error("PNG encode failed")), "image/png"));

  // ---------- text blocks: paragraphs, "- " bullets, "1. " numbers ----------
  function blocks(text) {
    const out = [];
    String(text || "").replace(/\r/g, "").split("\n").forEach(raw => {
      const l = raw.trimEnd();
      const b = /^\s*[-*•]\s+(.*)$/.exec(l), n = /^\s*\d+[.)]\s+(.*)$/.exec(l);
      const last = out[out.length - 1];
      if (b || n) {
        const kind = b ? "ul" : "ol";
        if (last && last.kind === kind) last.items.push((b || n)[1]);
        else out.push({ kind, items: [(b || n)[1]] });
      } else if (!l.trim()) out.push({ kind: "gap" });
      else if (last && last.kind === "p") last.lines.push(l);
      else out.push({ kind: "p", lines: [l] });
    });
    return out.filter(x => x.kind !== "gap");
  }

  function metaRows(m) {
    return [["Document", m.docNo], ["Revision", m.rev], ["Product / area", m.product], ["Author", m.author], ["Date", m.date]].filter(r => String(r[1] || "").trim());
  }
  const sections = m => [["Purpose and scope", m.purpose], ["Tools and materials", m.tools], ["Safety and PPE", m.safety]].filter(r => String(r[1] || "").trim());

  // ---------- HTML (preview + export) ----------
  const DOC_CSS = `
.wi-doc{--ink:#16171a;--dim:#5b5e66;--line:#dfe1e6;--acc:#5F6A00;font:15px/1.55 "Segoe UI",system-ui,-apple-system,Arial,sans-serif;color:var(--ink);background:#fff;max-width:900px;margin:0 auto;padding:40px 44px 56px}
.wi-doc h1{font-size:28px;line-height:1.15;margin:0 0 14px;letter-spacing:-.01em}
.wi-doc h2{font-size:18px;margin:30px 0 10px;padding-bottom:6px;border-bottom:1px solid var(--line)}
.wi-doc h3{font-size:16px;margin:0 0 8px;display:flex;gap:10px;align-items:baseline}
.wi-doc h3 .n{flex:none;display:inline-grid;place-items:center;min-width:28px;height:28px;padding:0 6px;border-radius:8px;background:#16171a;color:#D0DD2B;font-size:13px;font-weight:700}
.wi-doc .meta{border-collapse:collapse;margin:0 0 6px;font-size:13.5px}
.wi-doc .meta th{text-align:left;font-weight:600;color:var(--dim);padding:4px 18px 4px 0;white-space:nowrap}
.wi-doc .meta td{padding:4px 0}
.wi-doc p{margin:0 0 8px}
.wi-doc ul,.wi-doc ol{margin:0 0 8px;padding-left:24px}
.wi-doc .step{margin:22px 0 30px;break-inside:avoid-page}
.wi-doc .note{margin:10px 0;padding:10px 14px;border-left:4px solid #5b7bd5;background:#eef2fb;border-radius:6px}
.wi-doc .note.tip{border-color:#2f9e5b;background:#ebf7f0}
.wi-doc .note.caution{border-color:#d49a00;background:#fdf5df}
.wi-doc .note.warning{border-color:#cc3b2b;background:#fcebe8}
.wi-doc .note b{margin-right:6px}
.wi-doc figure{margin:12px 0 0}
.wi-doc figure img{display:block;max-width:100%;height:auto;border:1px solid var(--line);border-radius:6px}
.wi-doc .hist{border-collapse:collapse;width:100%;font-size:13.5px}
.wi-doc .hist th,.wi-doc .hist td{text-align:left;padding:6px 10px;border-bottom:1px solid var(--line);vertical-align:top}
.wi-doc .hist th{color:var(--dim);font-weight:600}
@media print{.wi-doc{padding:0}}`;

  function textHtml(text) {
    return blocks(text).map(b => b.kind === "p" ? "<p>" + b.lines.map(esc).join("<br>") + "</p>"
      : "<" + b.kind + ">" + b.items.map(i => "<li>" + esc(i) + "</li>").join("") + "</" + b.kind + ">").join("");
  }

  // imgSrc(step, i) → src string or null
  function docHtml(doc, imgSrc) {
    const m = doc.meta, h = [];
    h.push('<article class="wi-doc">');
    h.push("<h1>" + esc(m.title || "Untitled work instruction") + "</h1>");
    const rows = metaRows(m);
    if (rows.length) h.push('<table class="meta">' + rows.map(r => "<tr><th>" + esc(r[0]) + "</th><td>" + esc(r[1]) + "</td></tr>").join("") + "</table>");
    sections(m).forEach(([k, v]) => h.push("<h2>" + esc(k) + "</h2>" + textHtml(v)));
    if (doc.steps.length) h.push("<h2>Procedure</h2>");
    doc.steps.forEach((s, i) => {
      h.push('<section class="step"><h3><span class="n">' + (i + 1) + "</span><span>" + esc(s.title || "Step " + (i + 1)) + "</span></h3>");
      h.push(textHtml(s.text));
      if (s.noteKind && NOTE[s.noteKind] && s.note.trim()) h.push('<div class="note ' + s.noteKind + '"><b>' + NOTE[s.noteKind] + ":</b>" + textHtml(s.note).replace(/^<p>/, "").replace(/<\/p>$/, "") + "</div>");
      const src = imgSrc(s, i);
      if (src) h.push('<figure><img src="' + esc(src) + '" alt="Step ' + (i + 1) + (s.title ? ": " + esc(s.title) : "") + '"></figure>');
      h.push("</section>");
    });
    const hist = (doc.history || []).filter(r => Object.values(r).some(v => String(v || "").trim()));
    if (hist.length) {
      h.push('<h2>Revision history</h2><table class="hist"><tr><th>Rev</th><th>Date</th><th>By</th><th>Change</th></tr>');
      hist.forEach(r => h.push("<tr><td>" + esc(r.rev) + "</td><td>" + esc(r.date) + "</td><td>" + esc(r.by) + "</td><td>" + esc(r.change) + "</td></tr>"));
      h.push("</table>");
    }
    h.push("</article>");
    return h.join("\n");
  }

  function htmlFile(doc, imgSrc) {
    return "<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">" +
      "<title>" + esc(doc.meta.title || "Work instruction") + "</title><style>body{margin:0;background:#f3f4f6}" + DOC_CSS + "</style></head><body>\n" +
      docHtml(doc, imgSrc) + "\n</body></html>\n";
  }

  // ---------- Markdown ----------
  const mdEsc = s => String(s || "").replace(/\|/g, "\\|").replace(/\n/g, " ");
  function mdText(text) {
    return blocks(text).map(b => b.kind === "p" ? b.lines.join("  \n")
      : b.items.map((it, i) => (b.kind === "ul" ? "- " : (i + 1) + ". ") + it).join("\n")).join("\n\n");
  }
  function markdown(doc, imgPath) {
    const m = doc.meta, o = [];
    o.push("# " + (m.title || "Untitled work instruction"), "");
    const rows = metaRows(m);
    if (rows.length) {
      o.push("| " + rows.map(r => r[0]).join(" | ") + " |", "|" + rows.map(() => "---").join("|") + "|", "| " + rows.map(r => mdEsc(r[1])).join(" | ") + " |", "");
    }
    sections(m).forEach(([k, v]) => o.push("## " + k, "", mdText(v), ""));
    if (doc.steps.length) o.push("## Procedure", "");
    doc.steps.forEach((s, i) => {
      o.push("### Step " + (i + 1) + (s.title ? ": " + s.title : ""), "");
      if (s.text.trim()) o.push(mdText(s.text), "");
      if (s.noteKind && NOTE[s.noteKind] && s.note.trim()) o.push(mdText(s.note).split("\n").map((l, j) => "> " + (j ? "" : "**" + NOTE[s.noteKind] + ":** ") + l).join("\n"), "");
      const p = imgPath(s, i);
      if (p) o.push("![Step " + (i + 1) + "](" + p + ")", "");
    });
    const hist = (doc.history || []).filter(r => Object.values(r).some(v => String(v || "").trim()));
    if (hist.length) {
      o.push("## Revision history", "", "| Rev | Date | By | Change |", "|---|---|---|---|");
      hist.forEach(r => o.push("| " + [r.rev, r.date, r.by, r.change].map(mdEsc).join(" | ") + " |"));
      o.push("");
    }
    return o.join("\n");
  }

  // ---------- PDF ----------
  // Standard PDF fonts cover WinAnsi only; map common symbols, drop the rest.
  const ascii = s => String(s || "")
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/…/g, "...")
    .replace(/[•·]/g, "-").replace(/→/g, "->").replace(/←/g, "<-").replace(/×/g, "x").replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "");

  function pdf(doc, canvases) {
    const { jsPDF } = window.jspdf;
    const m = doc.meta;
    const p = new jsPDF({ unit: "pt", format: m.page === "a4" ? "a4" : "letter", compress: true });
    const PW = p.internal.pageSize.getWidth(), PH = p.internal.pageSize.getHeight();
    const M = 48, CW = PW - M * 2, BOTTOM = PH - 54;
    let y = M;
    const INK = [22, 23, 26], DIM = [91, 94, 102], LINE = [223, 225, 230];
    const newPage = () => { p.addPage(); y = M; };
    const need = h => { if (y + h > BOTTOM) newPage(); };
    const font = (style, size, color) => { p.setFont("helvetica", style); p.setFontSize(size); p.setTextColor(...(color || INK)); };

    function para(text, size, x, w, color) {
      const lh = size * 1.4;
      blocks(ascii(text)).forEach(b => {
        if (b.kind === "p") {
          const lines = p.splitTextToSize(b.lines.join("\n"), w);
          lines.forEach(l => { need(lh); font("normal", size, color); p.text(l, x, y + size); y += lh; });
        } else {
          b.items.forEach((it, i) => {
            const mark = b.kind === "ul" ? "-" : (i + 1) + ".";
            const lines = p.splitTextToSize(it, w - 16);
            lines.forEach((l, j) => {
              need(lh); font("normal", size, color);
              if (!j) p.text(mark, x + 2, y + size);
              p.text(l, x + 16, y + size); y += lh;
            });
          });
        }
        y += size * 0.45;
      });
    }
    const textH = (text, size, w) => blocks(ascii(text)).reduce((h, b) => h + size * 0.45 + size * 1.4 *
      (b.kind === "p" ? p.splitTextToSize(b.lines.join("\n"), w).length : b.items.reduce((n, it) => n + p.splitTextToSize(it, w - 16).length, 0)), 0);
    function h2(t) {
      need(40); y += 10;
      font("bold", 13); p.text(ascii(t), M, y + 13); y += 20;
      p.setDrawColor(...LINE); p.setLineWidth(0.8); p.line(M, y, M + CW, y); y += 10;
    }

    // Title block
    font("bold", 21);
    p.splitTextToSize(ascii(m.title || "Untitled work instruction"), CW).forEach(l => { p.text(l, M, y + 21); y += 26; });
    p.setFillColor(208, 221, 43); p.rect(M, y + 2, 36, 3.2, "F"); y += 16;
    const rows = metaRows(m);
    if (rows.length) {
      const cols = Math.min(rows.length, 5), cw = CW / cols;
      rows.forEach((r, i) => {
        const cx = M + (i % cols) * cw, cy = y + Math.floor(i / cols) * 34;
        font("bold", 7.5, DIM); p.text(ascii(r[0]).toUpperCase(), cx, cy + 8);
        font("normal", 10.5); p.text(p.splitTextToSize(ascii(r[1]), cw - 8)[0] || "", cx, cy + 22);
      });
      y += Math.ceil(rows.length / cols) * 34 + 4;
    }
    sections(m).forEach(([k, v]) => { h2(k); para(v, 10.5, M, CW); });

    if (doc.steps.length) h2("Procedure");
    const NOTE_RGB = { note: [91, 123, 213], tip: [47, 158, 91], caution: [212, 154, 0], warning: [204, 59, 43] };
    const NOTE_BG = { note: [238, 242, 251], tip: [235, 247, 240], caution: [253, 245, 223], warning: [252, 235, 232] };
    doc.steps.forEach((s, i) => {
      const cv = canvases[i];
      const title = ascii(s.title || "Step " + (i + 1));
      const titleLines = p.splitTextToSize(title, CW - 40);
      const hasNote = s.noteKind && NOTE[s.noteKind] && s.note.trim();
      const noteText = hasNote ? NOTE[s.noteKind] + ": " + s.note : "";
      const noteH = hasNote ? textH(noteText, 10, CW - 26) + 14 : 0;
      let iw = 0, ih = 0;
      if (cv) {
        iw = Math.min(CW, cv.width * 0.75);
        ih = cv.height * (iw / cv.width);
        const maxH = (BOTTOM - M) * 0.55;
        if (ih > maxH) { ih = maxH; iw = cv.width * (ih / cv.height); }
      }
      const head = titleLines.length * 17 + 8;
      const body = textH(s.text, 10.5, CW) + noteH;
      // Shrink the image (to 65 % at most) before a step moves to a new page.
      const room = BOTTOM - y - head - body - 34;
      if (ih && ih > room && room >= ih * 0.65) { iw *= room / ih; ih = room; }
      // Keep the heading with its text, and the text with its image when it fits.
      const total = head + body + (ih ? ih + 10 : 0) + 18;
      if (y + total > BOTTOM && total <= BOTTOM - M) newPage();
      else need(head + 40);
      y += 6;
      p.setFillColor(22, 23, 26); p.roundedRect(M, y, 24, 20, 4, 4, "F");
      font("bold", 10.5, [208, 221, 43]); p.text(String(i + 1), M + 12, y + 14, { align: "center" });
      font("bold", 12.5);
      titleLines.forEach((l, j) => p.text(l, M + 34, y + 14 + j * 17));
      y += head;
      para(s.text, 10.5, M, CW);
      if (hasNote) {
        const h = noteH;
        need(h);
        p.setFillColor(...NOTE_BG[s.noteKind]); p.rect(M, y, CW, h - 4, "F");
        p.setFillColor(...NOTE_RGB[s.noteKind]); p.rect(M, y, 3.5, h - 4, "F");
        y += 7;
        para(noteText, 10, M + 14, CW - 26);
        y += 3;
      }
      if (cv) {
        need(ih + 8);
        y += 4;
        p.addImage(cv, "PNG", M, y, iw, ih, undefined, "FAST");
        p.setDrawColor(...LINE); p.setLineWidth(0.6); p.rect(M, y, iw, ih);
        y += ih + 8;
      }
      y += 14;
    });

    const hist = (doc.history || []).filter(r => Object.values(r).some(v => String(v || "").trim()));
    if (hist.length) {
      h2("Revision history");
      const cx = [M, M + 50, M + 135, M + 225], ws = [44, 80, 84, CW - 225];
      font("bold", 8.5, DIM);
      ["REV", "DATE", "BY", "CHANGE"].forEach((t, i) => p.text(t, cx[i], y + 9));
      y += 16;
      hist.forEach(r => {
        const cells = [r.rev, r.date, r.by, r.change].map((v, i) => p.splitTextToSize(ascii(v), ws[i]));
        const h = Math.max(...cells.map(c => c.length)) * 13 + 6;
        need(h);
        font("normal", 9.5);
        cells.forEach((c, i) => c.forEach((l, j) => p.text(l, cx[i], y + 10 + j * 13)));
        y += h;
        p.setDrawColor(...LINE); p.setLineWidth(0.5); p.line(M, y - 2, M + CW, y - 2);
      });
    }

    // Footer on every page
    const n = p.getNumberOfPages();
    const left = ascii([m.docNo, m.rev ? "Rev " + m.rev : ""].filter(Boolean).join("  |  "));
    for (let i = 1; i <= n; i++) {
      p.setPage(i);
      p.setDrawColor(...LINE); p.setLineWidth(0.6); p.line(M, PH - 38, PW - M, PH - 38);
      font("normal", 8, DIM);
      if (left) p.text(left, M, PH - 26);
      const t = p.splitTextToSize(ascii(m.title || ""), CW * 0.5)[0] || "";
      if (t) p.text(t, PW / 2, PH - 26, { align: "center" });
      p.text("Page " + i + " of " + n, PW - M, PH - 26, { align: "right" });
    }
    p.setProperties({ title: ascii(m.title || "Work instruction"), subject: ascii(m.docNo || ""), author: ascii(m.author || ""), creator: "Atlas Work Instructions" });
    return p;
  }

  // ---------- ZIP (store only; PNG and PDF are already compressed) ----------
  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

  // files: [{ name, data: Uint8Array }]
  function zip(files) {
    const enc = new TextEncoder(), parts = [], central = [];
    const d = new Date();
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    let off = 0, cdSize = 0;
    files.forEach(f => {
      const name = enc.encode(f.name), data = f.data, crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint16(8, 0, true); lh.setUint16(10, time, true); lh.setUint16(12, date, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
      lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(lh, name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
      ch.setUint16(10, 0, true); ch.setUint16(12, time, true); ch.setUint16(14, date, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
      ch.setUint16(28, name.length, true); ch.setUint32(42, off, true);
      central.push(ch, name);
      off += 30 + name.length + data.length;
      cdSize += 46 + name.length;
    });
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, off, true);
    return new Blob([...parts, ...central, end], { type: "application/zip" });
  }

  // ---------- Word .docx ----------
  // For Confluence Cloud: Create > More actions > Templates and import > Import > Word document.
  // Headings use built-in styles (heading 1-3) so they import as page headings. Callouts are
  // one-cell tables with a bold label, so the meaning stays if the shading is dropped.
  const xe = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]))
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F￾￿]/g, "");
  const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const NOTE_HEX = { note: ["5B7BD5", "EEF2FB"], tip: ["2F9E5B", "EBF7F0"], caution: ["D49A00", "FDF5DF"], warning: ["CC3B2B", "FCEBE8"] };
  const CONTENT_TW = 9360;      // 6.5 in between 1 in margins
  const EMU_PX = 9525, MAX_W = 5943600, MAX_H = 6858000;

  function wRun(text, o) {
    o = o || {};
    const rp = (o.b ? "<w:b/>" : "") + (o.color ? '<w:color w:val="' + o.color + '"/>' : "");
    return "<w:r>" + (rp ? "<w:rPr>" + rp + "</w:rPr>" : "") + '<w:t xml:space="preserve">' + xe(text) + "</w:t></w:r>";
  }
  const wLines = (arr, o) => arr.map((l, i) => (i ? "<w:r><w:br/></w:r>" : "") + wRun(l, o)).join("");
  const wPara = (inner, ppr) => "<w:p>" + (ppr ? "<w:pPr>" + ppr + "</w:pPr>" : "") + inner + "</w:p>";
  const wHead = (lvl, text) => wPara(wRun(text), '<w:pStyle w:val="Heading' + lvl + '"/>');

  // prefix: runs put before the first paragraph (callout label)
  function wText(text, ctx, prefix) {
    const bl = blocks(text), out = [];
    if (prefix && (!bl.length || bl[0].kind !== "p")) out.push(wPara(prefix));
    bl.forEach((b, i) => {
      if (b.kind === "p") { out.push(wPara((i === 0 && prefix ? prefix : "") + wLines(b.lines))); return; }
      const id = b.kind === "ul" ? 1 : ctx.newList();
      b.items.forEach(it => out.push(wPara(wRun(it), '<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="' + id + '"/></w:numPr>')));
    });
    return out.join("");
  }

  // rows: [[cellXml…]…]; o.header bolds and repeats row 1; o.fill / o.edge colour a callout
  function wTable(rows, widths, o) {
    o = o || {};
    const sum = widths.reduce((a, b) => a + b, 0);
    const tc = (c, w) => '<w:tc><w:tcPr><w:tcW w:w="' + w + '" w:type="dxa"/>' +
      (o.edge ? '<w:tcBorders><w:left w:val="single" w:sz="24" w:space="0" w:color="' + o.edge + '"/></w:tcBorders>' : "") +
      (o.fill ? '<w:shd w:val="clear" w:color="auto" w:fill="' + o.fill + '"/>' : "") + "</w:tcPr>" + (c || "<w:p/>") + "</w:tc>";
    return '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="' + sum + '" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>' +
      "<w:tblGrid>" + widths.map(w => '<w:gridCol w:w="' + w + '"/>').join("") + "</w:tblGrid>" +
      rows.map((r, ri) => "<w:tr>" + (o.header && !ri ? "<w:trPr><w:tblHeader/></w:trPr>" : "") + r.map((c, ci) => tc(c, widths[ci])).join("") + "</w:tr>").join("") +
      "</w:tbl>";
  }

  function wImage(rid, id, px, alt) {
    let cx = px.w * EMU_PX, cy = px.h * EMU_PX;
    const k = Math.min(1, MAX_W / cx, MAX_H / cy);
    cx = Math.round(cx * k); cy = Math.round(cy * k);
    return wPara('<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="' + cx + '" cy="' + cy + '"/>' +
      '<wp:docPr id="' + id + '" name="Picture ' + id + '" descr="' + xe(alt) + '"/>' +
      '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
      '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>' +
      '<pic:nvPicPr><pic:cNvPr id="' + id + '" name="image' + id + '.png"/><pic:cNvPicPr/></pic:nvPicPr>' +
      '<pic:blipFill><a:blip r:embed="' + rid + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
      '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
      "</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>", '<w:spacing w:before="120" w:after="240"/>');
  }

  // pngs[i]: { data: Uint8Array, w, h } or null
  function docx(doc, pngs) {
    const m = doc.meta, body = [], rels = [], media = [];
    let lists = 0;
    const ctx = { newList: () => 2 + lists++ };
    body.push(wHead(1, m.title || "Untitled work instruction"));
    const rows = metaRows(m);
    if (rows.length) body.push(wTable(rows.map(r => [wPara(wRun(r[0], { b: true })), wPara(wRun(r[1]))]), [2400, CONTENT_TW - 2400]));
    sections(m).forEach(([k, v]) => body.push(wHead(2, k), wText(v, ctx)));
    if (doc.steps.length) body.push(wHead(2, "Procedure"));
    doc.steps.forEach((s, i) => {
      body.push(wHead(3, "Step " + (i + 1) + (s.title ? ": " + s.title : "")));
      body.push(wText(s.text, ctx));
      if (s.noteKind && NOTE[s.noteKind] && s.note.trim()) {
        const [edge, fill] = NOTE_HEX[s.noteKind];
        body.push(wTable([[wText(s.note, ctx, wRun(NOTE[s.noteKind] + ": ", { b: true, color: edge }))]], [CONTENT_TW], { fill, edge }));
      }
      if (pngs[i]) {
        const n = media.length + 1, rid = "rIdImg" + n;
        media.push({ name: "word/media/image" + n + ".png", data: pngs[i].data });
        rels.push('<Relationship Id="' + rid + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image' + n + '.png"/>');
        body.push(wImage(rid, n, pngs[i], "Step " + (i + 1) + (s.title ? ": " + s.title : "")));
      } else body.push(wPara(""));
    });
    const hist = (doc.history || []).filter(r => Object.values(r).some(v => String(v || "").trim()));
    if (hist.length) {
      const b = t => wPara(wRun(t, { b: true }));
      body.push(wHead(2, "Revision history"), wTable([[b("Rev"), b("Date"), b("By"), b("Change")]]
        .concat(hist.map(r => [r.rev, r.date, r.by, r.change].map(v => wPara(wRun(v))))), [1000, 1500, 1500, CONTENT_TW - 4000], { header: true }));
    }
    body.push(wPara(""));
    const pg = m.page === "a4" ? '<w:pgSz w:w="11906" w:h="16838"/>' : '<w:pgSz w:w="12240" w:h="15840"/>';
    const document = XML + '<w:document ' + W_NS + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"' +
      ' xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"' +
      ' xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>' + body.join("") +
      "<w:sectPr>" + pg + '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>';

    const border = s => "<w:" + s + ' w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>';
    const hStyle = (n, sz) => '<w:style w:type="paragraph" w:styleId="Heading' + n + '"><w:name w:val="heading ' + n + '"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>' +
      '<w:pPr><w:keepNext/><w:spacing w:before="' + (n === 1 ? 0 : 280) + '" w:after="120"/><w:outlineLvl w:val="' + (n - 1) + '"/></w:pPr><w:rPr><w:b/><w:sz w:val="' + sz + '"/></w:rPr></w:style>';
    const styles = XML + "<w:styles " + W_NS + ">" +
      '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault>' +
      '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
      hStyle(1, 40) + hStyle(2, 30) + hStyle(3, 26) +
      '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="40"/><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>' +
      '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders>' + ["top", "left", "bottom", "right", "insideH", "insideV"].map(border).join("") +
      '</w:tblBorders><w:tblCellMar><w:top w:w="80" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>' +
      "</w:styles>";
    const lvl = (fmt, text) => '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="' + fmt + '"/><w:lvlText w:val="' + text + '"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>';
    let nums = '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>';
    for (let k = 0; k < lists; k++) nums += '<w:num w:numId="' + (k + 2) + '"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>';
    const numbering = XML + "<w:numbering " + W_NS + ">" +
      '<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/>' + lvl("bullet", "•") + "</w:abstractNum>" +
      '<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="singleLevel"/>' + lvl("decimal", "%1.") + "</w:abstractNum>" +
      nums + "</w:numbering>";
    const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    const core = XML + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"' +
      ' xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      "<dc:title>" + xe(m.title || "Work instruction") + "</dc:title><dc:creator>" + xe(m.author || "") + "</dc:creator>" +
      '<dcterms:created xsi:type="dcterms:W3CDTF">' + now + '</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">' + now + "</dcterms:modified></cp:coreProperties>";
    const OD = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/";
    const parts = {
      "[Content_Types].xml": XML + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>',
      "_rels/.rels": XML + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="' + OD + 'officeDocument" Target="word/document.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>',
      "word/_rels/document.xml.rels": XML + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rIdStyles" Type="' + OD + 'styles" Target="styles.xml"/><Relationship Id="rIdNum" Type="' + OD + 'numbering" Target="numbering.xml"/>' +
        rels.join("") + "</Relationships>",
      "word/document.xml": document, "word/styles.xml": styles, "word/numbering.xml": numbering, "docProps/core.xml": core
    };
    const enc = new TextEncoder();
    const files = Object.entries(parts).map(([name, s]) => ({ name, data: enc.encode(s) })).concat(media);
    return new Blob([zip(files)], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  }

  WI.exp = { stepCanvas, toBlob, docHtml, htmlFile, markdown, pdf, docx, zip, imgName, DOC_CSS, blocks };
})();
