/*
  Work Instructions — export
  Scope: flattens each step to a PNG canvas and builds the outputs: PNG,
  PDF (jsPDF), one-file HTML, Markdown, and a .zip wiki bundle (Markdown +
  HTML + PDF + images/). All in memory; the caller saves the result.
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

  WI.exp = { stepCanvas, toBlob, docHtml, htmlFile, markdown, pdf, zip, imgName, DOC_CSS, blocks };
})();
