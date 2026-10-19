/*
  Work Instructions — annotation drawing
  Scope: draws a step (image + annotations) onto a 2D context whose transform
  maps image pixels to canvas pixels. Shared by the editor, thumbnails and every
  export, so what you see is what you export. Also hit tests and bounds.
  Annotation types: arrow, line, rect, ellipse, hl (highlight), pen, text,
  num (numbered callout), blur (pixelate), spot (spotlight).
*/
(function () {
  "use strict";
  const WI = window.WI = window.WI || {};

  const FONT = '"Geist", "Segoe UI", Arial, sans-serif';
  const RECTISH = new Set(["rect", "ellipse", "hl", "blur", "spot"]);

  // Size unit: keeps line widths and text in proportion to the screenshot size.
  const unitOf = (w, h) => Math.max(1, Math.max(w, h) / 1000);

  const norm = o => ({
    x: Math.min(o.x, o.x + o.w), y: Math.min(o.y, o.y + o.h),
    w: Math.abs(o.w), h: Math.abs(o.h)
  });

  function hexRgb(hex) {
    const h = String(hex || "#000").replace("#", "");
    const v = h.length === 3 ? h.split("").map(c => c + c).join("") : h.padEnd(6, "0");
    return [0, 2, 4].map(i => parseInt(v.slice(i, i + 2), 16) || 0);
  }
  const rgba = (hex, a) => "rgba(" + hexRgb(hex).join(",") + "," + a + ")";
  function onColor(hex) {
    const [r, g, b] = hexRgb(hex);
    return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? "#111111" : "#FFFFFF";
  }

  function shadow(ctx, on, u) {
    if (on) { ctx.shadowColor = "rgba(0,0,0,.35)"; ctx.shadowBlur = 4 * u; ctx.shadowOffsetY = 1.2 * u; }
    else { ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0; }
  }

  // ---------- text metrics (shared measuring context) ----------
  const mctx = document.createElement("canvas").getContext("2d");
  function textBox(o) {
    mctx.font = "600 " + o.size + "px " + FONT;
    const lines = String(o.s || "").split("\n");
    const lh = o.size * 1.25;
    const w = Math.max(o.size * 0.5, ...lines.map(l => mctx.measureText(l).width));
    const pad = o.box ? o.size * 0.42 : 0;
    return { x: o.x, y: o.y, w: w + pad * 2, h: (lines.length - 1) * lh + o.size * 1.1 + pad * 2, lines, lh, pad };
  }

  function bounds(o) {
    if (RECTISH.has(o.t)) return norm(o);
    if (o.t === "arrow" || o.t === "line") {
      return { x: Math.min(o.x1, o.x2), y: Math.min(o.y1, o.y2), w: Math.abs(o.x2 - o.x1), h: Math.abs(o.y2 - o.y1) };
    }
    if (o.t === "pen") {
      const xs = o.pts.map(p => p[0]), ys = o.pts.map(p => p[1]);
      const x = Math.min(...xs), y = Math.min(...ys);
      return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
    }
    if (o.t === "text") { const b = textBox(o); return { x: b.x, y: b.y, w: b.w, h: b.h }; }
    if (o.t === "num") return { x: o.x - o.r, y: o.y - o.r, w: o.r * 2, h: o.r * 2 };
    return { x: 0, y: 0, w: 0, h: 0 };
  }

  // ---------- primitives ----------
  function arrow(ctx, o, u) {
    const dx = o.x2 - o.x1, dy = o.y2 - o.y1, len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const L = Math.min(len * 0.6, o.sw * 3.6 + 8 * u), W = L * 0.62;
    const bx = o.x2 - ux * L, by = o.y2 - uy * L;
    ctx.beginPath();
    ctx.moveTo(o.x1, o.y1);
    ctx.lineTo(o.x2 - ux * L * 0.7, o.y2 - uy * L * 0.7);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(o.x2, o.y2);
    ctx.lineTo(bx - uy * W, by + ux * W);
    ctx.lineTo(bx + uy * W, by - ux * W);
    ctx.closePath();
    ctx.fill();
  }

  function pen(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    if (pts.length < 3) { pts.forEach(p => ctx.lineTo(p[0], p[1])); ctx.lineTo(pts[0][0] + 0.01, pts[0][1]); }
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
    }
    if (pts.length >= 3) { const l = pts[pts.length - 1]; ctx.lineTo(l[0], l[1]); }
    ctx.stroke();
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function text(ctx, o, u) {
    const b = textBox(o);
    ctx.font = "600 " + o.size + "px " + FONT;
    ctx.textBaseline = "top";
    if (o.box) {
      shadow(ctx, true, u);
      ctx.fillStyle = o.c;
      roundRect(ctx, b.x, b.y, b.w, b.h, o.size * 0.28);
      ctx.fill();
      shadow(ctx, false, u);
      ctx.fillStyle = onColor(o.c);
      b.lines.forEach((l, i) => ctx.fillText(l, b.x + b.pad, b.y + b.pad + i * b.lh));
    } else {
      ctx.lineJoin = "round";
      ctx.lineWidth = Math.max(2, o.size / 5);
      ctx.strokeStyle = onColor(o.c) === "#111111" ? "rgba(0,0,0,.85)" : "rgba(255,255,255,.92)";
      ctx.fillStyle = o.c;
      b.lines.forEach((l, i) => { ctx.strokeText(l, b.x, b.y + i * b.lh); ctx.fillText(l, b.x, b.y + i * b.lh); });
    }
  }

  function num(ctx, o, u) {
    shadow(ctx, true, u);
    ctx.beginPath();
    ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
    ctx.fillStyle = o.c; ctx.fill();
    shadow(ctx, false, u);
    ctx.lineWidth = Math.max(1.5, o.r * 0.13);
    ctx.strokeStyle = "#FFFFFF"; ctx.stroke();
    const s = String(o.n);
    ctx.font = "700 " + (o.r * (s.length > 2 ? 0.82 : s.length > 1 ? 1.0 : 1.18)) + "px " + FONT;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = onColor(o.c);
    ctx.fillText(s, o.x, o.y + o.r * 0.06);
    ctx.textAlign = "start";
  }

  // Pixelate from the source image only, so it hides what is under it.
  const tmp = document.createElement("canvas"), tctx = tmp.getContext("2d");
  function blur(ctx, o, bmp, u) {
    let r = norm(o);
    const x = Math.max(0, r.x), y = Math.max(0, r.y);
    const w = Math.min(bmp.width, r.x + r.w) - x, h = Math.min(bmp.height, r.y + r.h) - y;
    if (w < 1 || h < 1) return;
    const block = Math.max(8 * u, Math.min(w, h) / 6);
    let cw = w, ch = h;
    tmp.width = Math.ceil(w); tmp.height = Math.ceil(h);
    tctx.imageSmoothingEnabled = true; tctx.imageSmoothingQuality = "high";
    tctx.drawImage(bmp, x, y, w, h, 0, 0, cw, ch);
    // Halve in steps so every source pixel counts toward the block colour.
    const tw = Math.max(1, Math.round(w / block)), th = Math.max(1, Math.round(h / block));
    while (cw / 2 > tw && ch / 2 > th) {
      const nw = Math.max(tw, Math.floor(cw / 2)), nh = Math.max(th, Math.floor(ch / 2));
      tctx.drawImage(tmp, 0, 0, cw, ch, 0, 0, nw, nh);
      cw = nw; ch = nh;
    }
    tctx.drawImage(tmp, 0, 0, cw, ch, 0, 0, tw, th);
    const prev = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tmp, 0, 0, tw, th, x, y, w, h);
    ctx.imageSmoothingEnabled = prev;
  }

  // All spotlights in one pass: dim the view, cut out every spot.
  const sp = document.createElement("canvas"), sctx = sp.getContext("2d");
  function spots(ctx, list, view) {
    if (!list.length) return;
    sp.width = ctx.canvas.width; sp.height = ctx.canvas.height;
    sctx.setTransform(ctx.getTransform());
    sctx.globalCompositeOperation = "source-over";
    sctx.fillStyle = "rgba(10,12,16,.58)";
    sctx.fillRect(view.x, view.y, view.w, view.h);
    sctx.globalCompositeOperation = "destination-out";
    sctx.fillStyle = "#000";
    list.forEach(o => { const r = norm(o); roundRect(sctx, r.x, r.y, r.w, r.h, Math.min(r.w, r.h) * 0.06); sctx.fill(); });
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(sp, 0, 0);
    ctx.restore();
  }

  function one(ctx, o, u) {
    ctx.save();
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.strokeStyle = o.c; ctx.fillStyle = o.c; ctx.lineWidth = o.sw || 1;
    if (o.t === "hl") {
      const r = norm(o);
      ctx.fillStyle = rgba(o.c, 0.36);
      ctx.fillRect(r.x, r.y, r.w, r.h);
    } else if (o.t === "rect") {
      const r = norm(o);
      shadow(ctx, true, u);
      roundRect(ctx, r.x, r.y, r.w, r.h, Math.min(o.sw * 1.2, r.w / 2, r.h / 2));
      if (o.fill) ctx.fill(); else ctx.stroke();
    } else if (o.t === "ellipse") {
      const r = norm(o);
      shadow(ctx, true, u);
      ctx.beginPath();
      ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
      if (o.fill) ctx.fill(); else ctx.stroke();
    } else if (o.t === "line") {
      shadow(ctx, true, u);
      ctx.beginPath(); ctx.moveTo(o.x1, o.y1); ctx.lineTo(o.x2, o.y2); ctx.stroke();
    } else if (o.t === "arrow") {
      shadow(ctx, true, u);
      arrow(ctx, o, u);
    } else if (o.t === "pen") {
      shadow(ctx, true, u);
      pen(ctx, o.pts);
    } else if (o.t === "text") {
      text(ctx, o, u);
    } else if (o.t === "num") {
      num(ctx, o, u);
    }
    ctx.restore();
  }

  /*
    render(ctx, step, bmp, view): ctx transform must map image px to canvas px.
    view = image region on show {x,y,w,h}. Draws the image, then blurs, then
    spotlights, then the other annotations in list order.
  */
  function render(ctx, step, bmp, view) {
    const u = unitOf(bmp.width, bmp.height);
    ctx.save();
    ctx.beginPath(); ctx.rect(view.x, view.y, view.w, view.h); ctx.clip();
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bmp, 0, 0);
    const anns = step.anns || [];
    anns.filter(o => o.t === "blur").forEach(o => blur(ctx, o, bmp, u));
    spots(ctx, anns.filter(o => o.t === "spot"), view);
    anns.forEach(o => { if (o.t !== "blur" && o.t !== "spot") one(ctx, o, u); });
    ctx.restore();
  }

  // ---------- hit testing (image px) ----------
  function segDist(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  function hit(o, x, y, tol) {
    const sw = (o.sw || 0) / 2 + tol;
    if (o.t === "hl" || o.t === "blur" || o.t === "spot" || ((o.t === "rect" || o.t === "ellipse") && o.fill)) {
      const r = norm(o);
      if (o.t === "ellipse") {
        const rx = r.w / 2 + tol, ry = r.h / 2 + tol;
        return ((x - r.x - r.w / 2) ** 2) / (rx * rx) + ((y - r.y - r.h / 2) ** 2) / (ry * ry) <= 1;
      }
      return x >= r.x - tol && x <= r.x + r.w + tol && y >= r.y - tol && y <= r.y + r.h + tol;
    }
    if (o.t === "rect") {
      const r = norm(o);
      const inOuter = x >= r.x - sw && x <= r.x + r.w + sw && y >= r.y - sw && y <= r.y + r.h + sw;
      const inInner = x > r.x + sw && x < r.x + r.w - sw && y > r.y + sw && y < r.y + r.h - sw;
      return inOuter && !inInner;
    }
    if (o.t === "ellipse") {
      const r = norm(o), cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      const a = Math.max(1, r.w / 2), b = Math.max(1, r.h / 2);
      const d = Math.sqrt(((x - cx) ** 2) / (a * a) + ((y - cy) ** 2) / (b * b));
      return Math.abs(d - 1) * Math.min(a, b) <= sw;
    }
    if (o.t === "line" || o.t === "arrow") return segDist(x, y, o.x1, o.y1, o.x2, o.y2) <= sw;
    if (o.t === "pen") {
      for (let i = 1; i < o.pts.length; i++) {
        if (segDist(x, y, o.pts[i - 1][0], o.pts[i - 1][1], o.pts[i][0], o.pts[i][1]) <= sw) return true;
      }
      return o.pts.length === 1 && Math.hypot(x - o.pts[0][0], y - o.pts[0][1]) <= sw;
    }
    if (o.t === "num") return Math.hypot(x - o.x, y - o.y) <= o.r + tol;
    if (o.t === "text") {
      const b = bounds(o);
      return x >= b.x - tol && x <= b.x + b.w + tol && y >= b.y - tol && y <= b.y + b.h + tol;
    }
    return false;
  }

  function move(o, dx, dy) {
    if ("x" in o) { o.x += dx; o.y += dy; }
    if ("x1" in o) { o.x1 += dx; o.y1 += dy; o.x2 += dx; o.y2 += dy; }
    if (o.pts) o.pts = o.pts.map(p => [p[0] + dx, p[1] + dy]);
  }

  WI.draw = { render, bounds, hit, move, norm, unitOf, onColor, rgba, RECTISH, FONT };
})();
