/*
  Kit Studio — PDF output (jsPDF, vendor/)
  Scope: kit PDF (summary cover sheet + Avery 5163 labels, 2 × 5 at 4" × 2",
  one label per enabled line) and the packing list. Layout is a direct port of
  the desktop app's ReportLab code: the drawing helpers below take ReportLab
  coordinates (points, origin bottom-left) and convert them for jsPDF.
  Fonts are the PDF built-in Helvetica / Helvetica-Bold.
*/
(function () {
  "use strict";
  const KS = window.KS;
  const INCH = 72, PAGE_W = 8.5 * INCH, PAGE_H = 11 * INCH;

  // ReportLab-style canvas on top of jsPDF
  function canvas() {
    if (!window.jspdf) throw new Error("PDF library did not load (vendor/jspdf.umd.min.js).");
    const doc = new window.jspdf.jsPDF({ unit: "pt", format: "letter", compress: true });
    const style = f => f === "FB" ? "bold" : "normal";
    const u8 = v => Math.round(v * 255);
    let cur = ["F", 10];
    const c = {
      doc,
      setFont(f, size) { cur = [f, size]; doc.setFont("helvetica", style(f)); doc.setFontSize(size); },
      // ReportLab fills text and shapes with one colour; jsPDF keeps two
      fill(r, g, b) { doc.setFillColor(u8(r), u8(g), u8(b)); doc.setTextColor(u8(r), u8(g), u8(b)); },
      stroke(r, g, b) { doc.setDrawColor(u8(r), u8(g), u8(b)); },
      lineWidth(w) { doc.setLineWidth(w); },
      text(x, y, s) { doc.text(String(s), x, PAGE_H - y, { baseline: "alphabetic" }); },
      right(x, y, s) { doc.text(String(s), x, PAGE_H - y, { baseline: "alphabetic", align: "right" }); },
      centre(x, y, s) { doc.text(String(s), x, PAGE_H - y, { baseline: "alphabetic", align: "center" }); },
      line(x1, y1, x2, y2) { doc.line(x1, PAGE_H - y1, x2, PAGE_H - y2); },
      rect(x, y, w, h, stroke, fill) {
        const st = stroke && fill ? "FD" : fill ? "F" : "S";
        doc.rect(x, PAGE_H - y - h, w, h, st);
      },
      clipRect(x, y, w, h) { doc.saveGraphicsState(); doc.rect(x, PAGE_H - y - h, w, h, null); doc.clip(); doc.discardPath(); },
      restore() { doc.restoreGraphicsState(); },
      showPage() { doc.addPage("letter"); },
      // stringWidth(s, font, size) — measures without changing the current font
      sw(s, f, size) {
        doc.setFont("helvetica", style(f)); doc.setFontSize(size);
        const w = doc.getTextWidth(String(s));
        doc.setFont("helvetica", style(cur[0])); doc.setFontSize(cur[1]);
        return w;
      }
    };
    return c;
  }

  const p2 = n => String(n).padStart(2, "0");
  const usDate = d => p2(d.getMonth() + 1) + "/" + p2(d.getDate()) + "/" + d.getFullYear();
  const fmtG = n => String(+(+n).toPrecision(6));     // Python "{:g}"-like
  const fit = (s, n) => String(s).slice(0, n).padEnd(n);

  function boTitle(active) {
    const bos = [...new Set(active.filter(b => b.build_order).map(b => b.build_order))].sort();
    return { bos, title: bos.length === 1 ? "B/O " + bos[0] : bos.length ? bos.length + " BUILD ORDERS" : "B/O —" };
  }

  function truncTo(c, s, widthPt, font, size) {
    s = String(s);
    if (c.sw(s, font, size) <= widthPt) return s;
    while (s && c.sw(s + "…", font, size) > widthPt) s = s.slice(0, -1);
    return s + "…";
  }

  // ===================== Packing list =====================
  function packingList(boms) {
    const c = canvas(), F = "F", FB = "FB";
    const genDate = usDate(new Date());
    const M = 0.65 * INCH, ROW_H = 15;
    const active = boms.filter(b => b.lines.some(l => l.enabled));
    const { title } = boTitle(active);

    const X_ITEM = M, X_ATLAS = M + 34, X_MPN = M + 108, X_DESC = M + 268;
    const X_REQ = PAGE_W - M - 118, X_SHIP = PAGE_W - M - 62, X_CHK = PAGE_W - M - 14;
    let pageNum = 0;

    function pageHeader() {
      pageNum++;
      let y = PAGE_H - M;
      c.setFont(FB, 16); c.fill(0.07, 0.24, 0.22); c.text(M, y, "PACKING LIST");
      c.fill(0.10, 0.65, 0.58); c.text(M + c.sw("PACKING LIST ", FB, 16), y, title);
      c.setFont(F, 9); c.fill(0.35, 0.35, 0.35);
      c.right(PAGE_W - M, y, "Date: " + genDate + "     Page " + pageNum);
      y -= 8;
      c.stroke(0.10, 0.65, 0.58); c.lineWidth(1.5); c.line(M, y, PAGE_W - M, y);
      return y - 18;
    }
    function tableHeader(y) {
      c.setFont(FB, 7.5); c.fill(0.30, 0.35, 0.34);
      c.text(X_ITEM, y, "ITEM"); c.text(X_ATLAS, y, "ATLAS PN"); c.text(X_MPN, y, "MFGER PN"); c.text(X_DESC, y, "DESCRIPTION");
      c.right(X_REQ, y, "REQ"); c.right(X_SHIP, y, "SHIP"); c.text(X_CHK - 12, y, "CHK");
      y -= 4;
      c.stroke(0.65, 0.68, 0.67); c.lineWidth(0.5); c.line(M, y, PAGE_W - M, y);
      return y - 11;
    }

    let y = pageHeader(), totalShip = 0, totalLines = 0;
    for (const bom of active) {
      const bl = bom.lines.filter(l => l.enabled);
      if (y < M + 120) { c.showPage(); y = pageHeader(); }
      c.fill(0.90, 0.96, 0.95); c.rect(M - 4, y - 4, PAGE_W - 2 * M + 8, 16, false, true);
      c.setFont(FB, 9.5); c.fill(0.04, 0.30, 0.27); c.text(M, y, KS.displayName(bom));
      c.setFont(F, 8.5); c.fill(0.25, 0.30, 0.29);
      if (bom.assembly_desc) c.text(M + 170, y, truncTo(c, bom.assembly_desc, 200, F, 8.5));
      c.setFont(FB, 8.5); c.fill(0.10, 0.55, 0.48);
      c.right(PAGE_W - M, y, "B/O " + (bom.build_order || "—") + "   ·   Build Qty " + bom.build_qty);
      y -= 20;
      y = tableHeader(y);

      for (const line of bl) {
        if (y < M + 60) { c.showPage(); y = pageHeader(); y = tableHeader(y); }
        const req = KS.required(line, bom.build_qty, bom.attrition);
        const ship = String(line.on_hand).trim();
        totalLines++;
        const sn = KS.num(ship); if (!isNaN(sn)) totalShip += Math.trunc(sn);

        c.setFont(F, 8); c.fill(0.15, 0.15, 0.15); c.text(X_ITEM, y, line.item);
        c.setFont(FB, 8); c.fill(0.05, 0.28, 0.14); c.text(X_ATLAS, y, truncTo(c, line.atlas_pn, X_MPN - X_ATLAS - 8, FB, 8));
        c.setFont(F, 8); c.fill(0.05, 0.12, 0.40); c.text(X_MPN, y, truncTo(c, line.mpn, X_DESC - X_MPN - 8, F, 8));
        c.fill(0.25, 0.25, 0.25); c.text(X_DESC, y, truncTo(c, line.desc, X_REQ - X_DESC - 30, F, 8));
        c.fill(0.15, 0.15, 0.15); c.right(X_REQ, y, String(req));
        c.setFont(FB, 8.5);
        if (ship) { c.fill(0.04, 0.32, 0.12); c.right(X_SHIP, y, ship); }
        else { c.fill(0.60, 0.60, 0.60); c.right(X_SHIP, y, "_____"); }
        c.stroke(0.55, 0.58, 0.57); c.lineWidth(0.6); c.rect(X_CHK - 9, y - 1.5, 9, 9, true, false);
        y -= ROW_H;

        if (line.sub) {
          if (y < M + 60) { c.showPage(); y = pageHeader(); y = tableHeader(y); }
          c.setFont(FB, 7.5); c.fill(0.72, 0.42, 0.02); c.text(X_ATLAS, y, "» SUB:");
          c.setFont(F, 7.5); c.fill(0.55, 0.32, 0.02); c.text(X_ATLAS + 34, y, line.sub);
          y -= ROW_H - 3;
        }
      }
      y -= 8;
    }

    // Totals + sign-off
    if (y < M + 100) { c.showPage(); y = pageHeader(); }
    c.stroke(0.10, 0.65, 0.58); c.lineWidth(1); c.line(M, y, PAGE_W - M, y);
    y -= 16;
    c.setFont(FB, 9.5); c.fill(0.07, 0.24, 0.22);
    c.text(M, y, "TOTAL:  " + totalLines + " line item" + (totalLines !== 1 ? "s" : "") + "   ·   " + totalShip + " pieces shipped");
    y -= 40;
    c.setFont(F, 9); c.fill(0.25, 0.25, 0.25);
    const half = (PAGE_W - 2 * M) / 2;
    for (const [label, x0] of [["Packed by:", M], ["Verified by:", M + half]]) {
      c.text(x0, y, label);
      c.lineWidth(0.6); c.stroke(0.4, 0.4, 0.4);
      c.line(x0 + 60, y - 2, x0 + half - 90, y - 2);
      c.text(x0 + half - 80, y, "Date:");
      c.line(x0 + half - 50, y - 2, x0 + half - 20, y - 2);
    }
    return c.doc;
  }

  // ===================== Kit PDF: cover + labels =====================
  function kitPdf(boms) {
    const c = canvas(), F = "F", FB = "FB";
    const genDate = usDate(new Date());
    const enabled = [];
    for (const b of boms) for (const l of b.lines) if (l.enabled) enabled.push([b, l]);
    const activeBoms = boms.filter(b => b.lines.some(l => l.enabled));
    const { bos, title } = boTitle(activeBoms);

    // ---- Cover sheet
    const M = 0.75 * INCH;
    let y = PAGE_H - M;
    c.setFont(FB, 20); c.fill(0.07, 0.24, 0.22); c.text(M, y, "COMPONENT KIT");
    c.fill(0.10, 0.65, 0.58); c.text(M + c.sw("COMPONENT KIT ", FB, 20), y, title);
    y -= 10;
    c.stroke(0.10, 0.65, 0.58); c.lineWidth(2); c.line(M, y, PAGE_W - M, y);
    y -= 24;
    c.setFont(F, 10); c.fill(0.25, 0.25, 0.25);
    c.text(M, y, "Generated: " + genDate);
    c.text(M + 180, y, "Assemblies: " + activeBoms.length);
    c.text(M + 320, y, "Lines: " + enabled.length);
    y -= 28;

    for (const bom of boms) {
      const bl = bom.lines.filter(l => l.enabled);
      if (!bl.length) continue;
      c.setFont(FB, 11); c.fill(0.05, 0.15, 0.14); c.text(M, y, KS.displayName(bom));
      c.setFont(FB, 9); c.fill(0.10, 0.55, 0.48); c.text(M + 175, y, "B/O " + (bom.build_order || "—"));
      c.setFont(F, 9); c.fill(0.35, 0.35, 0.35);
      c.text(M + 285, y, "Qty " + bom.build_qty + "  ·  Attr " + fmtG(bom.attrition) + "%");
      c.right(PAGE_W - M, y, bl.length + " lines");
      y -= 13;
      if (bom.assembly_desc) {
        c.setFont(F, 8); c.fill(0.50, 0.50, 0.50); c.text(M + 12, y, bom.assembly_desc.slice(0, 80));
        y -= 13;
      }
      y -= 4;
      if (y < 2.2 * INCH) break;          // keep the cover to one page
    }

    const shorts = enabled.filter(([b, l]) => KS.shortage(l, b.build_qty, b.attrition) > 0);
    y -= 10;
    if (shorts.length) {
      c.setFont(FB, 11); c.fill(0.75, 0.15, 0.15); c.text(M, y, "SHORTAGES (" + shorts.length + ")");
      y -= 15;
      c.setFont(F, 8.5);
      for (const [bom, line] of shorts) {
        if (y < M + 20) { c.fill(0.5, 0.5, 0.5); c.text(M, y, "… more (see labels)"); break; }
        c.fill(0.45, 0.10, 0.10);
        const short = KS.shortage(line, bom.build_qty, bom.attrition), req = KS.required(line, bom.build_qty, bom.attrition);
        const pfx = bos.length > 1 && bom.build_order ? "[" + bom.build_order + "] " : "";
        c.text(M, y, pfx + fit(line.atlas_pn || line.mpn, 20) + "  " + fit(line.mpn, 24) + "  req " + req +
          "   on-hand " + (line.on_hand || 0) + "   SHORT " + short);
        y -= 12;
      }
    } else {
      c.setFont(FB, 11); c.fill(0.10, 0.55, 0.25); c.text(M, y, "NO SHORTAGES - kit is fully shippable");
    }

    // ---- Labels: Avery 5163
    const LBL_W = 4 * INCH, LBL_H = 2 * INCH, MAR_L = 0.156 * INCH, MAR_T = 0.5 * INCH, COL_GAP = 0.188 * INCH, PAD = 6;

    function wordWrap(text, maxChars) {
      if (!text) return [""];
      const out = []; let cur = "";
      for (const w of String(text).split(/\s+/).filter(Boolean)) {
        const cand = (cur + " " + w).trim();
        if (cand.length <= maxChars) cur = cand; else { if (cur) out.push(cur); cur = w; }
      }
      if (cur) out.push(cur);
      return out.length ? out : [""];
    }
    const trunc = (s, n) => { s = String(s); return s.length <= n ? s : s.slice(0, n - 1) + "…"; };

    function label(lx, ly, bom, line) {
      c.clipRect(lx, ly, LBL_W, LBL_H);
      c.stroke(0.70, 0.70, 0.70); c.lineWidth(0.4); c.rect(lx, ly, LBL_W, LBL_H, true, false);

      // Header band
      const HDR_H = 18;
      c.fill(0.04, 0.18, 0.16); c.rect(lx, ly + LBL_H - HDR_H, LBL_W, HDR_H, false, true);
      c.fill(0.30, 0.85, 0.76); c.setFont(FB, 7.5); c.text(lx + PAD, ly + LBL_H - 13, "B/O  " + (bom.build_order || "—"));
      const asm = trunc(bom.assembly_pn || "", 22);
      if (asm) { c.fill(0.65, 0.92, 0.88); c.setFont(F, 7); c.centre(lx + LBL_W / 2, ly + LBL_H - 13, asm); }
      c.fill(0.55, 0.80, 0.76); c.setFont(F, 6.5); c.right(lx + LBL_W - PAD, ly + LBL_H - 13, genDate);

      // Item zone
      const CT = ly + LBL_H - HDR_H;
      c.fill(0.94, 0.97, 0.96); c.rect(lx, CT - 30, LBL_W, 30, false, true);
      c.setFont(F, 6.5); c.fill(0.35, 0.45, 0.43); c.text(lx + PAD, CT - 10, line.is_pcb ? "BARE" : "ITEM");
      c.setFont(FB, 21); c.fill(0.03, 0.15, 0.13); c.text(lx + PAD + 24, CT - 25, line.item);
      if (line.atlas_pn) {
        c.setFont(FB, 6.5); c.fill(0.08, 0.38, 0.20); c.right(lx + LBL_W - PAD, CT - 9, "ATLAS PN");
        c.setFont(FB, 9.5); c.fill(0.04, 0.30, 0.14); c.right(lx + LBL_W - PAD, CT - 22, line.atlas_pn);
      }
      const D1 = CT - 30;
      c.stroke(0.10, 0.55, 0.48); c.lineWidth(0.8); c.line(lx, D1, lx + LBL_W, D1);

      // RefDes
      let rd = wordWrap(line.refdes, 50);
      if (rd.length > 2) { rd = rd.slice(0, 2); rd[1] = trunc(rd[1], 47) + "…"; }
      c.setFont(FB, 6.5); c.fill(0.42, 0.25, 0.05); c.text(lx + PAD, D1 - 9, "REF DES");
      c.setFont(F, 7.5); c.fill(0.08, 0.08, 0.08);
      rd.forEach((t, j) => c.text(j > 0 ? lx + PAD + 4 : lx + PAD + 38, D1 - 9 - j * 10, t));

      // Description (2 lines, or 1 when a substitution is set)
      const dl = wordWrap(line.desc, 60).slice(0, line.sub ? 1 : 2);
      c.setFont(F, 7.5); c.fill(0.18, 0.18, 0.18);
      dl.forEach((t, j) => c.text(lx + PAD, D1 - 31 - j * 11, t));
      if (line.sub) {
        const SUB_Y = D1 - 44;
        c.setFont(FB, 6.5); c.fill(0.72, 0.42, 0.02); c.text(lx + PAD, SUB_Y, "SUB:");
        c.setFont(FB, 7.5); c.fill(0.52, 0.30, 0.01); c.text(lx + PAD + 25, SUB_Y, trunc(line.sub, 44));
      }

      // Footer: manufacturer, MPN, REQ / SHIP
      const D2 = ly + PAD + 36;
      c.stroke(0.75, 0.78, 0.77); c.lineWidth(0.4); c.line(lx + PAD, D2, lx + LBL_W - PAD, D2);
      const QTY_R = lx + LBL_W - PAD, ROW1_Y = D2 - 12, ROW2_Y = D2 - 25;

      const reqStr = "REQ:  " + KS.required(line, bom.build_qty, bom.attrition);
      const reqW = c.sw(reqStr, FB, 8);
      c.setFont(FB, 8); c.fill(0.12, 0.12, 0.12); c.right(QTY_R, ROW1_Y, reqStr);
      const ship = String(line.on_hand).trim();
      const shipStr = "SHIP: " + (ship || "____");
      const shipW = c.sw(shipStr, FB, 8);
      c.setFont(FB, 8);
      if (ship) c.fill(0.04, 0.32, 0.12); else c.fill(0.55, 0.55, 0.55);
      c.right(QTY_R, ROW2_Y, shipStr);

      const qtyBlock = Math.max(reqW, shipW) + 6;
      const MAX_MFR_W = LBL_W - 2 * PAD - qtyBlock - 55;
      let mfr = line.mfr, mfrW = c.sw(mfr, FB, 7.5);
      if (mfrW > MAX_MFR_W) {
        while (mfr && c.sw(mfr + "…", FB, 7.5) > MAX_MFR_W) mfr = mfr.slice(0, -1);
        mfr = mfr.trimEnd() + "…"; mfrW = c.sw(mfr, FB, 7.5);
      }
      c.setFont(FB, 7.5); c.fill(0.12, 0.12, 0.12); c.text(lx + PAD, ROW1_Y, mfr);

      const MPN_L = lx + PAD + mfrW + 8, MPN_R = QTY_R - qtyBlock;
      if (MPN_R > MPN_L + 20) {
        const avail = MPN_R - MPN_L;
        let mpn = line.mpn;
        while (mpn && c.sw(mpn, FB, 8.5) > avail) mpn = mpn.slice(0, -1);
        if (mpn !== line.mpn) mpn = mpn.replace(/[- ]+$/, "") + "…";
        c.setFont(FB, 8.5); c.fill(0.03, 0.12, 0.45); c.centre((MPN_L + MPN_R) / 2, ROW1_Y, mpn);
      }
      c.restore();
    }

    for (let idx = 0; idx < enabled.length;) {
      c.showPage();
      for (let row = 0; row < 5 && idx < enabled.length; row++)
        for (let col = 0; col < 2 && idx < enabled.length; col++, idx++) {
          const [bom, line] = enabled[idx];
          label(MAR_L + col * (LBL_W + COL_GAP), PAGE_H - MAR_T - (row + 1) * LBL_H, bom, line);
        }
    }
    return c.doc;
  }

  Object.assign(KS, { kitPdf, packingList });
})();
