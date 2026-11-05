/*
  Quick Cable — output writers
  Scope: draw scene primitives as SVG (screen and .svg export), as a vector
  PDF with jsPDF, and as PNG (SVG drawn into a canvas). Standard PDF fonts
  cover WinAnsi only, so PDF text is mapped. Adapted from Cable Designer.
*/
(function (root) {
  "use strict";
  const QC = root.QC;
  const r2 = v => Math.round(v * 100) / 100;
  const imgFmt = src => /^data:image\/jpeg/.test(src) ? "JPEG" : "PNG";
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // ---------- SVG ----------
  // Screen only: a data image becomes a cached blob URL, so redraws do not re-parse large data.
  const blobUrls = new Map();
  function screenSrc(src) {
    if (!/^data:/.test(src) || typeof Blob === "undefined") return src;
    let u = blobUrls.get(src);
    if (!u) {
      const [head, b64] = src.split(","), bin = atob(b64), a = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
      u = URL.createObjectURL(new Blob([a], { type: head.slice(5, head.indexOf(";")) }));
      if (blobUrls.size > 60) { const [k, v] = blobUrls.entries().next().value; URL.revokeObjectURL(v); blobUrls.delete(k); }
      blobUrls.set(src, u);
    }
    return u;
  }
  function prim(o, screen) {
    if (o.hit && !screen) return "";
    const st = (s, lw, dash, f, join) => (f ? ' fill="' + f + '"' : ' fill="none"') +
      (s ? ' stroke="' + s + '" stroke-width="' + r2(lw) + '"' + (dash ? ' stroke-dasharray="' + dash.join(" ") + '"' : "") + (join ? ' stroke-linejoin="round"' : "") : "");
    switch (o.t) {
      case "line": return '<line x1="' + r2(o.x1) + '" y1="' + r2(o.y1) + '" x2="' + r2(o.x2) + '" y2="' + r2(o.y2) + '"' + st(o.s, o.lw, o.dash) + "/>";
      case "poly": {
        const pts = [];
        for (let i = 0; i < o.pts.length; i += 2) pts.push(r2(o.pts[i]) + "," + r2(o.pts[i + 1]));
        return "<" + (o.close ? "polygon" : "polyline") + ' points="' + pts.join(" ") + '"' + st(o.s, o.lw, o.dash, o.f, o.join) + "/>";
      }
      case "rect": return '<rect x="' + r2(o.x) + '" y="' + r2(o.y) + '" width="' + r2(o.w) + '" height="' + r2(o.h) + '"' + (o.r ? ' rx="' + o.r + '"' : "") + st(o.s, o.lw, o.dash, o.f) + "/>";
      case "circle": return '<circle cx="' + r2(o.cx) + '" cy="' + r2(o.cy) + '" r="' + r2(o.r) + '"' + st(o.s, o.lw, o.dash, o.f) + "/>";
      case "text": return '<text x="' + r2(o.x) + '" y="' + r2(o.y) + '" font-size="' + r2(o.size) + '"' + (o.bold ? ' font-weight="bold"' : "") +
        (o.anchor !== "start" ? ' text-anchor="' + o.anchor + '"' : "") + (o.c !== "#111111" ? ' fill="' + o.c + '"' : "") + ' xml:space="preserve">' + esc(o.s) + "</text>";
      case "img": return o.src ? '<image preserveAspectRatio="none" href="' + (screen ? screenSrc(o.src) : o.src) + '" x="' + r2(o.x) + '" y="' + r2(o.y) + '" width="' + r2(o.w) + '" height="' + r2(o.h) + '"/>' : "";
    }
    return "";
  }
  function svgInner(sc, screen) {
    return sc.groups.map(g => {
      const body = g.prims.map(o => prim(o, screen)).join("");
      return screen ? '<g data-id="' + g.id + '" class="k-' + g.kind + '">' + body + "</g>" : "<g>" + body + "</g>";
    }).join("");
  }
  function svgDoc(sc) {
    return '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + r2(sc.W) + " " + r2(sc.H) + '" width="' + r2(sc.W) + 'pt" height="' + r2(sc.H) + 'pt" font-family="' + QC.FONT + '" fill="#111111">' +
      svgInner(sc, false) + "</svg>\n";
  }

  // ---------- PNG ----------
  function png(sc, dpi) {
    const k = (dpi || 200) / 72, W = Math.round(sc.W * k), H = Math.round(sc.H * k);
    const svg = svgDoc(sc).replace(/width="[^"]+pt" height="[^"]+pt"/, 'width="' + W + '" height="' + H + '"');
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      const im = new Image();
      im.onload = () => {
        const cv = document.createElement("canvas");
        cv.width = W; cv.height = H;
        const g = cv.getContext("2d");
        g.fillStyle = "#fff"; g.fillRect(0, 0, W, H);
        g.drawImage(im, 0, 0, W, H);
        URL.revokeObjectURL(url);
        cv.toBlob(b => b ? res(b) : rej(new Error("PNG encode failed")), "image/png");
      };
      im.onerror = () => { URL.revokeObjectURL(url); rej(new Error("SVG render failed")); };
      im.src = url;
    });
  }

  // ---------- PDF ----------
  const ansi = s => String(s || "")
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/…/g, "...")
    .replace(/[•·]/g, "-").replace(/→/g, "->").replace(/←/g, "<-").replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "");
  const rgb = h => { const n = parseInt(String(h).replace("#", ""), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

  function pdfDraw(doc, sc) {
    const style = o => o.s && o.f ? "FD" : o.f ? "F" : o.s ? "S" : null;
    sc.groups.forEach(g => g.prims.forEach(o => {
      if (o.hit || o.s === "transparent") return;
      if (o.t === "text") {
        doc.setFont("helvetica", o.bold ? "bold" : "normal"); doc.setFontSize(o.size); doc.setTextColor(...rgb(o.c));
        doc.text(ansi(o.s), o.x, o.y, { align: o.anchor === "middle" ? "center" : o.anchor === "end" ? "right" : "left", baseline: "alphabetic" });
        return;
      }
      if (o.t === "img") { if (o.src) doc.addImage(o.src, imgFmt(o.src), o.x, o.y, o.w, o.h, o.key, "FAST"); return; }
      const stl = style(o);
      if (!stl) return;
      if (o.s) { doc.setDrawColor(...rgb(o.s)); doc.setLineWidth(o.lw); doc.setLineDashPattern(o.dash || [], 0); }
      if (o.f) doc.setFillColor(...rgb(o.f));
      if (o.t === "line") doc.line(o.x1, o.y1, o.x2, o.y2);
      else if (o.t === "rect") { if (o.r) doc.roundedRect(o.x, o.y, o.w, o.h, o.r, o.r, stl); else doc.rect(o.x, o.y, o.w, o.h, stl); }
      else if (o.t === "circle") doc.circle(o.cx, o.cy, o.r, stl);
      else if (o.t === "poly") {
        const d = [];
        for (let i = 2; i < o.pts.length; i += 2) d.push([o.pts[i] - o.pts[i - 2], o.pts[i + 1] - o.pts[i - 1]]);
        doc.setLineJoin(o.join ? "round" : "miter");
        doc.lines(d, o.pts[0], o.pts[1], [1, 1], stl, !!o.close);
        doc.setLineJoin("miter");
      }
      if (o.s) doc.setLineDashPattern([], 0);
    }));
  }
  function pdf(p, sc) {
    const { jsPDF } = window.jspdf;
    const S = QC.SHEETS[p.meta.size] || QC.SHEETS.B;
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: [S.w, S.h], compress: true });
    pdfDraw(doc, sc);
    doc.setProperties({ title: ansi([p.meta.dwgNo, p.meta.title].filter(Boolean).join(" ")), subject: "Cable drawing", creator: "Quick Cable" });
    return doc.output("blob");
  }

  QC.out = { svgInner, svgDoc, png, pdf, ansi };
})(typeof window !== "undefined" ? window : globalThis);
