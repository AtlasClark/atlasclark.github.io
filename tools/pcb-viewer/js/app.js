/*
  PCB Viewer — application
  Scope: file intake (folder / drag-drop / picker), canvas rendering of the parsed
  IPC-2581 board (top and mirrored bottom views), pan/zoom, part and net picking,
  photo underlay with auto-fit and manual alignment, search, and the side panel
  (Inspect / Parts / Nets / Project). No network use; state lives in memory.
  Bump REV on each change.
*/
(function () {
  "use strict";
  const REV = "rev 1.1.0";
  const P = window.PCBV;
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ---------- local prefs (per-viewer conveniences only; no project data) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
  };

  // ---------- state ----------
  const S = {
    board: null, bom: null, bomErr: "",
    files: { ipc: null, ipcRev: "", ipcAlt: [], bom: null, TOP: null, BOTTOM: null },
    imgs: { TOP: null, BOTTOM: null },          // {bmp, w, h}
    align: { TOP: null, BOTTOM: null },         // {x, y, s, how, score}
    side: "TOP", mode: "cad",
    show: Object.assign({ copper: true, far: true, silk: true, outlines: true, labels: true, drills: true, mech: false }, store.get("pcbv.show", {})),
    photoAlpha: 1,
    cam: { x: 0, y: 0, z: 1 }, fitZ: 1,
    sel: null, hist: [], hover: null,
    query: "", matches: null, netMatches: null,
    units: store.get("pcbv.units", "mm"), aligning: null, tab: "inspect", groupParts: false
  };
  let G = null;     // render caches for the loaded board
  let C = {};       // canvas colors from CSS tokens

  const cv = $("#cv"), ctx = cv.getContext("2d"), stage = $("#stage");
  let W = 0, H = 0, DPR = 1;

  // ======================================================================
  // File intake
  // ======================================================================
  const RX_IPC = /\.(cvg|xml)$/i, RX_BOM = /\.(xlsx|xlsm|xls|csv|tsv)$/i, RX_IMG = /\.(png|jpe?g|webp|bmp)$/i;
  const sideOfName = n => {
    const b = n.replace(/\.[^.]+$/, "");
    if (/(^|[^a-z])(bot|bottom|btm|back|rear)([^a-z]|$)/i.test(b)) return "BOTTOM";
    if (/(^|[^a-z])(top|front)([^a-z]|$)/i.test(b)) return "TOP";
    return null;
  };

  async function loadFiles(list) {
    const files = Array.from(list).filter(f => !/^[.~]/.test(f.name));
    const ipcs = files.filter(f => RX_IPC.test(f.name));
    const boms = files.filter(f => RX_BOM.test(f.name));
    const imgs = files.filter(f => RX_IMG.test(f.name));
    if (!ipcs.length && !boms.length && !imgs.length) { toast("No usable files. Expected IPC-2581 (.cvg), BOM (.xlsx/.csv), and board images.", true); return; }
    busy("Reading files…");
    const notes = [];
    let askMap = false;
    try {
      // ---- IPC-2581: newest revision wins ----
      if (ipcs.length) {
        const cands = [];
        for (const f of ipcs) {
          const head = await f.slice(0, 4096).text();
          if (!/IPC-2581/.test(head)) continue;
          const m = head.match(/<IPC-2581[^>]*\brevision="([A-Za-z])"/);
          cands.push({ f, rev: m ? m[1].toUpperCase() : "?" });
        }
        if (!cands.length) throw new Error("None of the .cvg/.xml files is an IPC-2581 file.");
        cands.sort((a, b) => b.rev.localeCompare(a.rev));
        busy("Parsing " + cands[0].f.name + "…");
        await frame();
        const board = P.parseIPC2581(await cands[0].f.text());
        // New board = new project: drop parts of the old one not in this batch
        S.board = board; S.sel = null; S.hist = []; S.hover = null;
        S.files.ipc = cands[0].f; S.files.ipcRev = board.rev; S.files.ipcAlt = cands.slice(1).map(c => c.f.name + " (rev " + c.rev + ")");
        if (!boms.length) { S.bom = null; S.files.bom = null; S.bomErr = ""; }
        if (!imgs.length) { S.imgs = { TOP: null, BOTTOM: null }; S.files.TOP = S.files.BOTTOM = null; }
        S.align = { TOP: null, BOTTOM: null };
        S.side = "TOP";
        buildCaches();
      }
      // ---- BOM ----
      if (boms.length) {
        const f = boms.find(b => /bom/i.test(b.name)) || boms[0];
        try { S.bom = await P.readBOM(f); S.files.bom = f; S.bomErr = ""; applySavedCols(); askMap = S.bom.needsMap; }
        catch (e) { S.bom = null; S.files.bom = f; S.bomErr = e.message; notes.push("BOM: " + e.message); }
      }
      // ---- images ----
      const unk = [];
      for (const f of imgs) { const sd = sideOfName(f.name); if (sd) await setImage(sd, f); else unk.push(f); }
      for (const f of unk) {
        const sd = !S.imgs.TOP ? "TOP" : !S.imgs.BOTTOM ? "BOTTOM" : null;
        if (sd) { await setImage(sd, f); notes.push(`“${f.name}” has no TOP/BOT in its name; used as ${sd.toLowerCase()} image.`); }
      }
      // ---- align photos to board ----
      if (S.board) for (const sd of ["TOP", "BOTTOM"]) if (S.imgs[sd] && !S.align[sd]) initAlign(sd);
    } catch (e) {
      console.error(e);
      toast(e.message || String(e), true);
    } finally { busy(false); }

    if (!S.board && (S.bom || S.imgs.TOP || S.imgs.BOTTOM)) notes.push("Now open the IPC-2581 (.cvg) file for this board.");
    notes.forEach(n => toast(n, /BOM:/.test(n)));
    afterLoad(!!ipcs.length);
    if (askMap) openColMap(missingCols());
  }

  async function setImage(side, f) {
    try {
      const bmp = await createImageBitmap(f);
      S.imgs[side] = { bmp: cutout(bmp), w: bmp.width, h: bmp.height };
      S.files[side] = f; S.align[side] = null;
    } catch { toast("Could not read image “" + f.name + "”.", true); }
  }

  // Clears the light, neutral render background: flood fill from the image border.
  function cutout(bmp) {
    const w = bmp.width, h = bmp.height, c = document.createElement("canvas");
    c.width = w; c.height = h;
    const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(bmp, 0, 0);
    let img; try { img = g.getImageData(0, 0, w, h); } catch { return bmp; }
    const d = img.data, seen = new Uint8Array(w * h), q = new Int32Array(w * h);
    const isBg = i => { const r = d[i * 4], gg = d[i * 4 + 1], b = d[i * 4 + 2], a = d[i * 4 + 3]; const mx = Math.max(r, gg, b); return a < 128 || (mx - Math.min(r, gg, b) < 24 && mx > 180); };
    let qh = 0, qt = 0;
    const push = i => { if (!seen[i] && isBg(i)) { seen[i] = 1; q[qt++] = i; } };
    for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
    while (qh < qt) {
      const i = q[qh++], x = i % w;
      d[i * 4 + 3] = 0;
      if (x > 0) push(i - 1); if (x < w - 1) push(i + 1); if (i >= w) push(i - w); if (i < w * (h - 1)) push(i + w);
    }
    if (qt < w * h * 0.02) return bmp;          // no clear background; keep as-is
    g.putImageData(img, 0, 0);
    return c;
  }

  function afterLoad(newBoard) {
    const has = !!S.board;
    $("#drop").hidden = has;
    $("#hud").hidden = $("#zoomHud").hidden = !has;
    $("#q").disabled = !has;
    $("#projName").textContent = has ? S.board.stepName : "";
    document.title = has ? S.board.stepName + " · PCB Viewer" : "PCB Viewer";
    if (has && newBoard) { resize(); fit(false); }
    if (has && newBoard) S.mode = S.imgs[S.side] ? "blend" : "cad";
    if (S.mode !== "cad" && !S.imgs[S.side]) S.mode = "cad";
    syncHud(); runSearch(); renderPanel(); renderStatus(); redraw();
  }

  // Folder drag-and-drop (walks directories)
  async function filesFromDrop(dt) {
    const entries = Array.from(dt.items || []).map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
    if (!entries.length) return Array.from(dt.files || []);
    const out = [];
    const walk = async (e, depth) => {
      if (e.isFile) { try { out.push(await new Promise((res, rej) => e.file(res, rej))); } catch {} }
      else if (e.isDirectory && depth < 3) {
        const r = e.createReader(); let batch;
        do { batch = await new Promise((res, rej) => r.readEntries(res, rej)); for (const c of batch) await walk(c, depth + 1); } while (batch.length);
      }
    };
    for (const e of entries) await walk(e, 0);
    return out;
  }

  // ======================================================================
  // Render caches
  // ======================================================================
  function ringArea(r) { let a = 0; for (let i = 0, n = r.length; i < n; i += 2) { const j = (i + 2) % n; a += r[i] * r[j + 1] - r[j] * r[i + 1]; } return a / 2; }
  function addRings(path, rings) {
    rings.forEach((r, k) => {
      if (r.length < 6) return;
      const ccw = ringArea(r) > 0, want = k === 0;           // outer CCW, cutouts CW -> nonzero fill
      const n = r.length;
      if (ccw === want) { path.moveTo(r[0], r[1]); for (let i = 2; i < n; i += 2) path.lineTo(r[i], r[i + 1]); }
      else { path.moveTo(r[n - 2], r[n - 1]); for (let i = n - 4; i >= 0; i -= 2) path.lineTo(r[i], r[i + 1]); }
      path.closePath();
    });
  }
  function addLine(path, pts) { path.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) path.lineTo(pts[i], pts[i + 1]); }
  const polyLen = p => { let s = 0; for (let i = 2; i < p.length; i += 2) s += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]); return s; };
  const grow = (a, b) => a ? { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) } : { ...b };

  function buildCaches() {
    const b = S.board;
    const L = n => b.layerByName.get(n) || { kind: "doc", side: "" };
    const groups = new Map(), netInfo = new Map();
    const ni = n => { let e = netInfo.get(n); if (!e) netInfo.set(n, e = { len: 0, layers: new Set(), bb: null }); return e; };
    const group = (key, base) => { let g = groups.get(key); if (!g) groups.set(key, g = Object.assign({ path: new Path2D() }, base)); return g; };

    for (const it of b.items) {
      const l = L(it.layer);
      const key = it.layer + "|" + (it.net || "") + "|" + it.kind + (it.kind === "stroke" ? "|" + it.w.toFixed(6) + it.cap : "");
      const g = group(key, { layer: it.layer, lk: l.kind, side: l.side, net: it.net, kind: it.kind, w: it.w, cap: it.cap });
      if (it.kind === "stroke") addLine(g.path, it.pts); else addRings(g.path, it.rings);
      if (it.net && l.kind === "copper") { const e = ni(it.net); e.layers.add(it.layer); e.bb = grow(e.bb, it.bb); if (it.kind === "stroke") e.len += polyLen(it.pts); }
    }
    const compPads = new Map();
    for (const p of b.pads) {
      const l = L(p.layer);
      const g = group(p.layer + "|" + (p.net || "") + "|pad", { layer: p.layer, lk: l.kind, side: l.side, net: p.net, kind: "fill", pad: true });
      addRings(g.path, p.rings);
      if (p.net && l.kind === "copper") { const e = ni(p.net); e.layers.add(p.layer); e.bb = grow(e.bb, p.bb); }
      if (p.comp && l.kind === "copper") {
        let m = compPads.get(p.comp); if (!m) compPads.set(p.comp, m = {});
        const sd = l.side === "BOTTOM" ? "BOTTOM" : l.side === "TOP" ? "TOP" : "IN";
        (m[sd] || (m[sd] = new Path2D())).addPath(ringsPath(p.rings));
      }
    }
    for (const c of b.comps) for (const pin of c.pins) if (pin.net) { const e = ni(pin.net); e.bb = grow(e.bb, { x0: pin.x, y0: pin.y, x1: pin.x, y1: pin.y }); }

    const holePath = new Path2D();
    for (const h of b.holes) if (h.d > 0) { holePath.moveTo(h.x + h.d / 2, h.y); holePath.arc(h.x, h.y, h.d / 2, 0, Math.PI * 2); }

    const profilePath = new Path2D();
    if (b.profile.length) addRings(profilePath, b.profile);
    else { const r = b.bounds; profilePath.rect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0); }

    const compPath = new Map();
    for (const c of b.comps) compPath.set(c.ref, ringsPath(c.outline));

    G = { groups: Array.from(groups.values()), netInfo, compPads, holePath, profilePath, compPath };
  }
  function ringsPath(rings) { const p = new Path2D(); addRings(p, rings); return p; }

  // ======================================================================
  // Camera
  // ======================================================================
  const mirror = () => S.side === "BOTTOM" ? -1 : 1;
  function viewBounds() {
    const b = S.board.bounds;
    return mirror() === 1 ? b : { x0: -b.x1, x1: -b.x0, y0: b.y0, y1: b.y1 };
  }
  function toBoard(sx, sy) { const z = S.cam.z; return [mirror() * ((sx - W / 2) / z + S.cam.x), S.cam.y - (sy - H / 2) / z]; }
  function toScreen(x, y) { const z = S.cam.z; return [(mirror() * x - S.cam.x) * z + W / 2, -(y - S.cam.y) * z + H / 2]; }
  function fit(animate = true) {
    if (!S.board || !W) return;
    const v = viewBounds(), bw = Math.max(v.x1 - v.x0, 1e-6), bh = Math.max(v.y1 - v.y0, 1e-6);
    const z = Math.min(W / bw, H / bh) * 0.86;
    S.fitZ = z;
    moveCam((v.x0 + v.x1) / 2, (v.y0 + v.y1) / 2, z, animate);
  }
  let anim = 0;
  function moveCam(x, y, z, animate = true) {
    cancelAnimationFrame(anim);
    if (!animate || matchMedia("(prefers-reduced-motion: reduce)").matches) { Object.assign(S.cam, { x, y, z }); redraw(); return; }
    const a = { ...S.cam }, t0 = performance.now(), D = 240;
    const step = t => {
      const k = Math.min(1, (t - t0) / D), e = 1 - Math.pow(1 - k, 3);
      S.cam.x = a.x + (x - a.x) * e; S.cam.y = a.y + (y - a.y) * e; S.cam.z = Math.exp(Math.log(a.z) + (Math.log(z) - Math.log(a.z)) * e);
      draw(); if (k < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  }
  function zoomAt(sx, sy, f) {
    const z0 = S.cam.z, z1 = clamp(z0 * f, S.fitZ * 0.25, S.fitZ * 400);
    const vx = (sx - W / 2) / z0 + S.cam.x, vy = S.cam.y - (sy - H / 2) / z0;
    S.cam.z = z1; S.cam.x = vx - (sx - W / 2) / z1; S.cam.y = vy + (sy - H / 2) / z1;
    redraw();
  }
  // Bring a board-space box into view (only moves when needed)
  function focusBB(bb, forceZoom) {
    if (!bb || !W) return;
    const m = mirror(), v = m === 1 ? bb : { x0: -bb.x1, x1: -bb.x0, y0: bb.y0, y1: bb.y1 };
    const bw = Math.max(v.x1 - v.x0, 1e-4), bh = Math.max(v.y1 - v.y0, 1e-4);
    const cx = (v.x0 + v.x1) / 2, cy = (v.y0 + v.y1) / 2, z = S.cam.z;
    const fitz = clamp(Math.min(W * 0.4 / bw, H * 0.4 / bh), S.fitZ, S.fitZ * 12);
    const sx0 = (v.x0 - S.cam.x) * z + W / 2, sx1 = (v.x1 - S.cam.x) * z + W / 2;
    const sy0 = -(v.y1 - S.cam.y) * z + H / 2, sy1 = -(v.y0 - S.cam.y) * z + H / 2;
    const inView = sx0 > 40 && sy0 > 60 && sx1 < W - 40 && sy1 < H - 40;
    const tooSmall = Math.max(bw, bh) * z < 36, tooBig = bw * z > W * 0.9 || bh * z > H * 0.9;
    if (forceZoom || tooSmall || tooBig) moveCam(cx, cy, Math.max(forceZoom ? fitz : 0, tooBig ? Math.min(fitz, z) : Math.max(fitz, z)));
    else if (!inView) moveCam(cx, cy, z);
  }
  function setSide(sd) {
    if (S.side === sd || !S.board) return;
    S.side = sd; S.cam.x = -S.cam.x;
    if (S.mode !== "cad" && !S.imgs[sd]) S.mode = "cad";
    syncHud(); redraw();
  }

  // ======================================================================
  // Drawing
  // ======================================================================
  function readColors() {
    const cs = getComputedStyle(document.documentElement), v = n => cs.getPropertyValue(n).trim();
    C = {
      bg: v("--cv-bg"), board: v("--cv-board"), edge: v("--cv-board-edge"), cu: v("--cv-cu"), far: v("--cv-cu-far"), inner: v("--cv-cu-in"),
      silk: v("--cv-silk"), hole: v("--cv-hole"), outline: v("--cv-outline"), sel: v("--cv-sel"), hover: v("--cv-hover"), match: v("--cv-match"),
      label: v("--cv-label"), halo: v("--cv-label-halo"), mono: v("--mono")
    };
  }
  let pending = false;
  function redraw() { if (!pending) { pending = true; requestAnimationFrame(() => { pending = false; draw(); }); } }

  function resize() {
    const r = stage.getBoundingClientRect();
    DPR = Math.min(window.devicePixelRatio || 1, 2.5);
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    if (S.board) { const v = viewBounds(); S.fitZ = Math.min(W / Math.max(v.x1 - v.x0, 1e-6), H / Math.max(v.y1 - v.y0, 1e-6)) * 0.86; }
    draw();
  }
  function boardXf() { const z = S.cam.z, m = mirror(); ctx.setTransform(DPR * m * z, 0, 0, -DPR * z, DPR * (W / 2 - S.cam.x * z), DPR * (H / 2 + S.cam.y * z)); }
  function screenXf() { ctx.setTransform(DPR, 0, 0, DPR, 0, 0); }

  function effMode() { return S.aligning ? "align" : (S.imgs[S.side] && S.align[S.side] ? S.mode : "cad"); }

  function pass(filter, color, alpha) {
    const px = 1 / S.cam.z;
    ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineJoin = "round";
    for (const g of G.groups) {
      if (!filter(g)) continue;
      if (g.kind === "stroke") { ctx.lineWidth = Math.max(g.w, px); ctx.lineCap = g.cap || "round"; ctx.stroke(g.path); }
      else ctx.fill(g.path);
    }
    ctx.globalAlpha = 1;
  }

  function draw() {
    screenXf();
    ctx.globalAlpha = 1; ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    if (!S.board || !G) return;
    const side = S.side, far = side === "TOP" ? "BOTTOM" : "TOP", mode = effMode(), px = 1 / S.cam.z;
    const netSel = S.sel && S.sel.type === "net" ? S.sel.name : null;
    const selRefs = selectedRefs(), netRefs = netSel ? new Set((S.board.nets.get(netSel) || { comps: [] }).comps) : null;

    // photo underlay
    if (mode !== "cad") drawPhoto(side, mode === "align" ? 1 : S.photoAlpha * (netSel ? 0.6 : 1));

    boardXf();
    // substrate
    if (mode === "cad") {
      ctx.save(); screenShadow(); ctx.fillStyle = C.board; ctx.fill(G.profilePath, "evenodd"); ctx.restore();
    }
    if (mode === "cad" || mode === "blend") {
      const a = mode === "blend" ? 0.6 : 1, dim = netSel ? 0.3 : 1;
      if (S.show.far) {
        pass(g => g.lk === "copper" && g.side !== side && g.side !== far, C.inner, 0.45 * a * dim);
        pass(g => g.lk === "copper" && g.side === far, C.far, 0.5 * a * dim);
      }
      if (S.show.copper) pass(g => g.lk === "copper" && g.side === side, C.cu, 0.92 * a * dim);
      if (S.show.drills) { ctx.globalAlpha = mode === "blend" ? 0.75 : 1; ctx.fillStyle = C.hole; ctx.fill(G.holePath); ctx.globalAlpha = 1; }
      if (S.show.silk) pass(g => g.lk === "silk" && g.side === side, C.silk, mode === "blend" ? 0.75 : 0.9);
      if (S.show.mech) pass(g => g.lk === "doc" || g.lk === "outline" || g.lk === "drill", C.outline, 0.7);
    }
    // board edge
    ctx.lineWidth = (mode === "align" ? 2 : 1.25) * px; ctx.strokeStyle = mode === "align" ? C.sel : C.edge; ctx.stroke(G.profilePath);

    if (mode === "align") {         // reference geometry for alignment
      ctx.globalAlpha = 0.95; ctx.strokeStyle = C.sel; ctx.lineWidth = 1 * px;
      for (const g of G.groups) if (g.lk === "copper" && g.side === side && g.kind === "fill") ctx.stroke(g.path);
      ctx.stroke(G.holePath); ctx.globalAlpha = 1;
      screenXf(); return;
    }

    // net highlight
    if (netSel) {
      const pour = g => g.kind === "fill" && !g.pad;      // keep large pours lighter than tracks
      pass(g => g.net === netSel && g.lk === "copper" && g.side !== side, C.sel, 0.3);
      pass(g => g.net === netSel && g.lk === "copper" && g.side === side && pour(g), C.sel, 0.5);
      pass(g => g.net === netSel && g.lk === "copper" && g.side === side && !pour(g), C.sel, 1);
      if (S.show.drills) { ctx.fillStyle = C.hole; ctx.globalAlpha = 0.9; ctx.fill(G.holePath); ctx.globalAlpha = 1; }
    }

    // component outlines
    const showOl = S.show.outlines;
    ctx.lineJoin = "round";
    for (const c of S.board.comps) {
      const path = G.compPath.get(c.ref), near = c.side === side;
      const isSel = selRefs.has(c.ref), isNet = netRefs && netRefs.has(c.ref), isMatch = S.matches && S.matches.has(c.ref);
      const isHov = S.hover && S.hover.comp === c.ref;
      if (!near && !isSel && !isNet && !isMatch) continue;
      ctx.setLineDash(near ? [] : [4 * px, 3 * px]);
      if (isSel) {
        ctx.globalAlpha = near ? 0.26 : 0.12; ctx.fillStyle = C.sel; ctx.fill(path);
        ctx.globalAlpha = 1; ctx.strokeStyle = C.sel; ctx.lineWidth = 2 * px; ctx.stroke(path);
        const pads = G.compPads.get(c.ref);
        if (pads) { ctx.fillStyle = C.sel; for (const k of Object.keys(pads)) { ctx.globalAlpha = k === side ? 0.95 : 0.4; ctx.fill(pads[k]); } ctx.globalAlpha = 1; }
      } else if (isNet) {
        ctx.globalAlpha = near ? 0.13 : 0.07; ctx.fillStyle = C.sel; ctx.fill(path);
        ctx.globalAlpha = 0.95; ctx.strokeStyle = C.sel; ctx.lineWidth = 1.4 * px; ctx.stroke(path);
      } else if (isMatch) {
        ctx.globalAlpha = 0.14; ctx.fillStyle = C.match; ctx.fill(path);
        ctx.globalAlpha = 1; ctx.strokeStyle = C.match; ctx.lineWidth = 1.6 * px; ctx.stroke(path);
      } else if (showOl) {
        ctx.globalAlpha = mode === "photo" ? 0.55 : 1; ctx.strokeStyle = C.outline; ctx.lineWidth = 1 * px; ctx.stroke(path);
      }
      if (isHov && !isSel) { ctx.globalAlpha = 0.9; ctx.setLineDash([]); ctx.strokeStyle = C.hover; ctx.lineWidth = 1.6 * px; ctx.stroke(path); }
      ctx.globalAlpha = 1;
    }
    ctx.setLineDash([]);

    // selected pin ring
    if (S.sel && S.sel.type === "comp" && S.sel.pin != null) {
      const c = S.board.compByRef.get(S.sel.ref), pin = c && c.pins.find(p => p.num === S.sel.pin);
      if (pin) { screenXf(); const [x, y] = toScreen(pin.x, pin.y); ctx.strokeStyle = C.sel; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 11, 0, 7); ctx.stroke(); }
    }

    // labels (screen space so text never mirrors)
    screenXf();
    drawLabels(selRefs, netRefs);
  }

  function screenShadow() { ctx.shadowColor = "rgba(0,0,0,.35)"; ctx.shadowBlur = 24 * DPR; ctx.shadowOffsetY = 6 * DPR; }

  function drawPhoto(side, alpha) {
    const im = S.imgs[side], a = S.align[side]; if (!im || !a) return;
    const z = S.cam.z;
    ctx.setTransform(DPR * a.s * z, 0, 0, DPR * a.s * z, DPR * ((a.x - S.cam.x) * z + W / 2), DPR * ((S.cam.y - a.y) * z + H / 2));
    ctx.globalAlpha = alpha; ctx.imageSmoothingQuality = "high";
    ctx.drawImage(im.bmp, 0, 0);
    ctx.globalAlpha = 1;
  }

  function drawLabels(selRefs, netRefs) {
    if (!S.show.labels && !selRefs.size && !netRefs && !S.matches) return;
    const z = S.cam.z, side = S.side;
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.lineJoin = "round";
    for (const c of S.board.comps) {
      const hot = selRefs.has(c.ref) || (netRefs && netRefs.has(c.ref)) || (S.matches && S.matches.has(c.ref));
      if (!hot && (c.side !== side || !S.show.labels)) continue;
      const bb = P.bbox(c.outline), bw = (bb.x1 - bb.x0) * z, bh = (bb.y1 - bb.y0) * z;
      let fs = Math.min(15, Math.min(bw, bh) * 0.5, bw / (c.ref.length * 0.66));
      if (hot) fs = Math.max(fs, 11); else if (fs < 7.5) continue;
      const [x, y] = toScreen((bb.x0 + bb.x1) / 2, (bb.y0 + bb.y1) / 2);
      if (x < -40 || y < -20 || x > W + 40 || y > H + 20) continue;
      ctx.font = `500 ${fs.toFixed(1)}px ${C.mono}`;
      ctx.strokeStyle = C.halo; ctx.lineWidth = Math.max(2.5, fs * 0.28); ctx.strokeText(c.ref, x, y);
      ctx.fillStyle = hot ? C.sel : C.label; ctx.fillText(c.ref, x, y);
    }
    // pin numbers for the selected part when zoomed in
    if (S.sel && S.sel.type === "comp") {
      const c = S.board.compByRef.get(S.sel.ref);
      if (c && c.pins.length > 1) {
        let minD = Infinity;
        for (let i = 0; i < c.pins.length; i++) for (let j = i + 1; j < c.pins.length && j < i + 8; j++) minD = Math.min(minD, Math.hypot(c.pins[i].x - c.pins[j].x, c.pins[i].y - c.pins[j].y));
        const fs = Math.min(12, minD * z * 0.42);
        if (fs >= 7) {
          ctx.font = `600 ${fs.toFixed(1)}px ${C.mono}`;
          for (const p of c.pins) {
            const [x, y] = toScreen(p.x, p.y);
            ctx.strokeStyle = "rgba(0,0,0,.8)"; ctx.lineWidth = 3; ctx.strokeText(p.num, x, y);
            ctx.fillStyle = "#fff"; ctx.fillText(p.num, x, y);
          }
        }
      }
    }
  }

  // ======================================================================
  // Hit testing
  // ======================================================================
  function inRings(rings, x, y) {
    let inside = false;
    for (const r of rings) for (let i = 0, n = r.length, j = n - 2; i < n; j = i, i += 2) {
      const yi = r[i + 1], yj = r[j + 1];
      if ((yi > y) !== (yj > y) && x < (r[j] - r[i]) * (y - yi) / (yj - yi) + r[i]) inside = !inside;
    }
    return inside;
  }
  function segDist(px, py, x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0, L = dx * dx + dy * dy;
    const t = L ? clamp(((px - x0) * dx + (py - y0) * dy) / L, 0, 1) : 0;
    return Math.hypot(px - x0 - t * dx, py - y0 - t * dy);
  }
  const inBB = (bb, x, y, t) => x >= bb.x0 - t && x <= bb.x1 + t && y >= bb.y0 - t && y <= bb.y1 + t;

  function hit(bx, by, withCopper) {
    const b = S.board, side = S.side, tol = 3 / S.cam.z;
    const L = n => b.layerByName.get(n) || {};
    // 1) pads of parts on this side's copper
    for (const p of b.pads) {
      if (!p.comp || L(p.layer).kind !== "copper" || L(p.layer).side !== side) continue;
      if (inBB(p.bb, bx, by, 0) && inRings(p.rings, bx, by)) return { comp: p.comp, pin: p.pin, net: p.net };
    }
    // 2) part bodies on this side (smallest wins)
    let best = null;
    for (const c of b.comps) {
      if (c.side !== side || !inBB(c.bb, bx, by, 0)) continue;
      if (inRings(c.outline, bx, by) && (!best || c.area < best.area)) best = c;
    }
    if (best) return { comp: best.ref };
    if (!withCopper) return null;
    // 3) copper (this side first, then far side)
    for (const want of [side, side === "TOP" ? "BOTTOM" : "TOP"]) {
      let found = null;
      for (const it of b.items) {
        if (!it.net) continue;
        const l = L(it.layer); if (l.kind !== "copper" || l.side !== want) continue;
        const w = it.kind === "stroke" ? it.w / 2 + tol : 0;
        if (!inBB(it.bb, bx, by, w)) continue;
        if (it.kind === "stroke") { for (let i = 2; i < it.pts.length; i += 2) if (segDist(bx, by, it.pts[i - 2], it.pts[i - 1], it.pts[i], it.pts[i + 1]) <= w) { found = it; break; } }
        else if (inRings(it.rings, bx, by)) found = it;
        if (found && found.kind === "stroke") break;   // traces win over pours
      }
      if (!found) for (const p of b.pads) if (p.net && L(p.layer).kind === "copper" && L(p.layer).side === want && inBB(p.bb, bx, by, 0) && inRings(p.rings, bx, by)) { found = p; break; }
      if (found) return { net: found.net };
    }
    return null;
  }

  // ======================================================================
  // Photo alignment
  // ======================================================================
  const alignKey = sd => `pcbv.align.${S.board.stepName}.${sd}.${S.imgs[sd].w}x${S.imgs[sd].h}`;
  function initAlign(sd) {
    const saved = store.get(alignKey(sd), null);
    if (saved && isFinite(saved.s)) { S.align[sd] = Object.assign(saved, { how: "saved" }); return; }
    S.align[sd] = autoFit(sd);
    if (S.align[sd] && S.align[sd].score < 0.55) toast(`Auto-fit of the ${sd.toLowerCase()} photo is uncertain. Check it in Project → Align.`);
  }

  // Fits the image to the board profile: board-colored pixel mask vs. profile shape.
  function autoFit(sd) {
    const im = S.imgs[sd], b = S.board; if (!im || !b) return null;
    const k = Math.min(1, 360 / Math.max(im.w, im.h)), w = Math.max(8, Math.round(im.w * k)), h = Math.max(8, Math.round(im.h * k));
    const oc = document.createElement("canvas"); oc.width = w; oc.height = h;
    const c2 = oc.getContext("2d", { willReadFrequently: true }); c2.drawImage(im.bmp, 0, 0, w, h);
    const d = c2.getImageData(0, 0, w, h).data;
    const fg = new Uint8Array(w * h), hue = new Float32Array(w * h).fill(-1), bins = new Float64Array(36);
    let nfg = 0;
    for (let i = 0; i < w * h; i++) {
      const r = d[i * 4], g = d[i * 4 + 1], bl = d[i * 4 + 2], a = d[i * 4 + 3];
      const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl);
      if (a < 128 || (mx - mn < 24 && mx > 180)) continue;        // light neutral background
      fg[i] = 1; nfg++;
      if (mx > 40 && (mx - mn) / mx > 0.2) {
        let hh = mx === r ? (g - bl) / (mx - mn) : mx === g ? 2 + (bl - r) / (mx - mn) : 4 + (r - g) / (mx - mn);
        hh = (hh * 60 + 360) % 360; hue[i] = hh; bins[Math.floor(hh / 10) % 36]++;
      }
    }
    if (nfg < 50) return null;
    let pk = 0; for (let i = 1; i < 36; i++) if (bins[i] > bins[pk]) pk = i;
    let win = 0; for (let j = -2; j <= 2; j++) win += bins[(pk + j + 36) % 36];
    let mask = fg;
    if (win > 0.35 * nfg) {          // board has a dominant soldermask hue -> use it
      const hc = pk * 10 + 5; mask = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) if (hue[i] >= 0) { const dh = Math.abs(((hue[i] - hc) + 540) % 360 - 180); if (dh <= 28) mask[i] = 1; }
    }
    // robust mask extents (1%..99%)
    const cols = new Float64Array(w), rows = new Float64Array(h); let nm = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) { cols[x]++; rows[y]++; nm++; }
    if (nm < 50) return null;
    const pct = (arr, q) => { let s = 0; for (let i = 0; i < arr.length; i++) { s += arr[i]; if (s >= q * nm) return i; } return arr.length - 1; };
    const mx0 = pct(cols, 0.01), mx1 = pct(cols, 0.99) + 1, my0 = pct(rows, 0.01), my1 = pct(rows, 0.99) + 1;

    const m = sd === "TOP" ? 1 : -1;
    const rings = (b.profile.length ? b.profile : [[b.bounds.x0, b.bounds.y0, b.bounds.x1, b.bounds.y0, b.bounds.x1, b.bounds.y1, b.bounds.x0, b.bounds.y1]])
      .map(r => r.map((v, i) => i % 2 ? v : v * m));
    const vb = P.bbox(rings), bw = vb.x1 - vb.x0, bh = vb.y1 - vb.y0, span = Math.max(bw, bh), mg = 0.12 * span;
    let seed = 1234567; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const ins = [], outs = [];
    for (let t = 0; t < 40000 && ins.length < 2400; t++) { const x = vb.x0 + rnd() * bw, y = vb.y0 + rnd() * bh; if (inRings(rings, x, y)) ins.push(x, y); }
    for (let t = 0; t < 40000 && outs.length < 2400; t++) { const x = vb.x0 - mg + rnd() * (bw + 2 * mg), y = vb.y0 - mg + rnd() * (bh + 2 * mg); if (!inRings(rings, x, y)) outs.push(x, y); }
    const cx = (vb.x0 + vb.x1) / 2, cy = (vb.y0 + vb.y1) / 2, mu = (mx0 + mx1) / 2, mv = (my0 + my1) / 2;
    const place = p => { const s = Math.exp(p.ls); return { s, ix: cx + p.tx - mu * s, iy: cy + p.ty + mv * s }; };
    const frac = (pts, q) => {
      let n = 0;
      for (let j = 0; j < pts.length; j += 2) {
        const u = (pts[j] - q.ix) / q.s, v = (q.iy - pts[j + 1]) / q.s;
        if (u >= 0 && v >= 0 && u < w && v < h && mask[(v | 0) * w + (u | 0)]) n++;
      }
      return n / Math.max(1, pts.length / 2);
    };
    const score = p => { const q = place(p); return frac(ins, q) - frac(outs, q); };
    const s0 = (bw / Math.max(1, mx1 - mx0) + bh / Math.max(1, my1 - my0)) / 2;
    let best = { tx: 0, ty: 0, ls: Math.log(s0) }, bs = score(best);
    for (let f = -0.2; f <= 0.2001; f += 0.025) { const p = { ...best, ls: Math.log(s0) + f }, sc = score(p); if (sc > bs) { bs = sc; best = p; } }
    const st = { tx: 0.04 * span, ty: 0.04 * span, ls: 0.04 };
    for (let it = 0; it < 400; it++) {
      let moved = false;
      for (const key of ["tx", "ty", "ls"]) for (const sg of [1, -1]) {
        const p = { ...best, [key]: best[key] + sg * st[key] }, sc = score(p);
        if (sc > bs + 1e-9) { bs = sc; best = p; moved = true; }
      }
      if (!moved) { st.tx /= 2; st.ty /= 2; st.ls /= 2; if (st.ls < 2e-4) break; }
    }
    const q = place(best), kx = w / im.w;
    return { x: q.ix, y: q.iy, s: q.s * kx, how: "auto", score: bs };
  }

  function startAlign(sd) {
    if (!S.imgs[sd] || !S.board) return;
    if (S.side !== sd) setSide(sd);
    if (!S.align[sd]) S.align[sd] = autoFit(sd) || { x: 0, y: 0, s: 0.001, how: "manual" };
    S.aligning = sd; S.sel = null;
    $("#alignBar").hidden = false; $("#alignSide").textContent = sd === "TOP" ? "top" : "bottom";
    cv.classList.add("aligning"); $("#layersPop").hidden = true;
    fit(); renderPanel();
  }
  function endAlign() {
    const sd = S.aligning; if (!sd) return;
    S.aligning = null; $("#alignBar").hidden = true; cv.classList.remove("aligning");
    const a = S.align[sd];
    if (a && a.how === "manual") store.set(alignKey(sd), { x: a.x, y: a.y, s: a.s });
    if (S.mode === "cad") S.mode = "blend";
    syncHud(); renderPanel(); redraw();
  }
  function resetAlign(sd) {
    try { localStorage.removeItem(alignKey(sd)); } catch {}
    S.align[sd] = autoFit(sd); renderPanel(); redraw();
  }

  // ======================================================================
  // Data helpers
  // ======================================================================
  const toMM = v => v * (S.board ? S.board.toMM : 1);
  function fmtLen(v, digits) {
    const mm = toMM(v);
    return S.units === "mm" ? mm.toFixed(digits == null ? 2 : digits) + " mm" : (mm / 25.4).toFixed(digits == null ? 3 : digits + 1) + " in";
  }
  const pnKey = s => String(s || "").trim().replace(/^0+(?=\d)/, "").toUpperCase();

  function partInfo(ref) {
    const line = S.bom && S.bom.byRef.get(ref), cad = S.board.cadBom.get(ref);
    const atlasBom = line ? line.atlas : "", atlasCad = cad ? P.normPN(cad.libPN) : "";
    return lineInfo(line, {
      cad, atlas: atlasBom || atlasCad, atlasSrc: atlasBom ? "bom" : atlasCad ? "cad" : "",
      pnMismatch: !!(atlasBom && atlasCad && pnKey(atlasBom) !== pnKey(atlasCad)), atlasCad,
      cadDesc: cad ? cad.libDesc || cad.desc : ""
    });
  }
  // BOM Description first, then BOM Name; CAD library text only when the BOM has neither.
  // "value" shows Name under the description when the BOM has both.
  function lineInfo(line, o = {}) {
    const bomDesc = line ? line.desc || line.name : "";
    return Object.assign({
      line, atlas: line ? line.atlas : "", mpn: line ? line.mpn : "", mfr: line ? line.mfr : "", mount: line ? line.mount : "",
      value: line && line.desc && line.name ? line.name : ""
    }, o, { desc: bomDesc || o.cadDesc || "", descSrc: bomDesc ? "bom" : o.cadDesc ? "cad" : "" });
  }
  function selectedRefs() {
    const s = S.sel; if (!s) return new Set();
    if (s.type === "comp") return new Set([s.ref]);
    if (s.type === "group") return new Set(s.refs);
    return new Set();
  }
  const natSort = (a, b) => P.natCmp(a, b);

  // ======================================================================
  // Selection
  // ======================================================================
  function select(sel, opts = {}) {
    if (S.sel && sel && opts.push !== false && JSON.stringify(S.sel) !== JSON.stringify(sel)) { S.hist.push(S.sel); if (S.hist.length > 30) S.hist.shift(); }
    if (!sel) S.hist = [];
    S.sel = sel;
    if (sel && opts.focus) {
      if (sel.type === "comp") {
        const c = S.board.compByRef.get(sel.ref);
        if (c) { if (c.side !== S.side) setSide(c.side); focusBB(c.bb); }
      } else if (sel.type === "net") {
        const e = G.netInfo.get(sel.name); if (e && e.bb) focusBB(e.bb);
      } else if (sel.type === "group") {
        const cs = sel.refs.map(r => S.board.compByRef.get(r)).filter(Boolean);
        if (cs.length) {
          const sides = new Set(cs.map(c => c.side)); if (!sides.has(S.side)) setSide(cs[0].side);
          focusBB(cs.reduce((a, c) => grow(a, c.bb), null));
        }
      }
    }
    if (sel) setTab("inspect");
    renderPanel(); redraw();
  }
  function back() { const p = S.hist.pop(); if (p) select(p, { push: false, focus: true }); }

  // ======================================================================
  // Panel
  // ======================================================================
  function setTab(t) {
    S.tab = t;
    $$(".tabs [role=tab]").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === t));
    $$(".tabpane").forEach(p => p.hidden = p.id !== "tab-" + t);
    renderPanel();
  }
  function renderPanel() {
    const b = S.board;
    $("#nParts").textContent = b ? (S.matches ? S.matches.size : b.comps.length) : "";
    $("#nNets").textContent = b ? (S.netMatches ? S.netMatches.length : netList().length) : "";
    if (S.tab === "inspect") $("#tab-inspect").innerHTML = inspectHTML();
    if (S.tab === "parts") $("#tab-parts").innerHTML = partsHTML();
    if (S.tab === "nets") $("#tab-nets").innerHTML = netsHTML();
    if (S.tab === "project") $("#tab-project").innerHTML = projectHTML();
    const issues = b ? checks().filter(c => c.bad).length : 0;
    $("#checkDot").hidden = !issues;
  }
  const copyBtn = v => v ? `<button type="button" class="copy" data-copy="${esc(v)}" title="Copy">Copy</button>` : "";
  const na = t => `<span class="na">${esc(t || "Not in BOM")}</span>`;
  const hl = (s, q) => { s = esc(s); if (!q) return s; const i = s.toLowerCase().indexOf(esc(q).toLowerCase()); return i < 0 ? s : s.slice(0, i) + "<mark>" + s.slice(i, i + esc(q).length) + "</mark>" + s.slice(i + esc(q).length); };
  const backBtn = () => S.hist.length ? `<button type="button" class="linkish mono" data-back style="margin-bottom:12px">← Back to ${esc(label(S.hist[S.hist.length - 1]))}</button>` : "";
  const label = s => s.type === "comp" ? s.ref : s.type === "net" ? s.name : (s.title || "group");

  function inspectHTML() {
    if (!S.board) return `<div class="empty-note"><b>No board loaded</b>Open a project folder to start.</div>`;
    if (S.aligning) return `<div class="empty-note"><b>Aligning the ${S.aligning.toLowerCase()} photo</b>Match the photo to the lime board outline and pads, then press Done.</div>`;
    const s = S.sel;
    if (!s) return `
      <div class="empty-note"><b>Pick a part or a net</b>Click the board, or use search.</div>
      <ul class="hint-list">
        <li><kbd>Click</kbd><span>Part → Atlas PN, Mfr PN, description, pins</span></li>
        <li><kbd>Dbl-click</kbd><span>Pad or trace → highlight the net and every connected part</span></li>
        <li><kbd>/</kbd><span>Search refdes, part number, value, or net</span></li>
        <li><kbd>T</kbd> <kbd>B</kbd><span>Top / bottom side (bottom view is mirrored, as seen from below)</span></li>
        <li><kbd>1 2 3</kbd><span>CAD / Blend / Photo</span></li>
        <li><kbd>F</kbd><span>Fit board · drag to pan · scroll to zoom</span></li>
        <li><kbd>Esc</kbd><span>Clear selection</span></li>
      </ul>`;
    if (s.type === "comp") return backBtn() + compCard(s);
    if (s.type === "net") return backBtn() + netCard(s.name);
    if (s.type === "group") return backBtn() + groupCard(s);
    return "";
  }

  function compCard(s) {
    const c = S.board.compByRef.get(s.ref);
    if (!c) return `<div class="empty-note"><b>${esc(s.ref)}</b>This designator is in the BOM but not on the board.</div>`;
    const I = partInfo(c.ref);
    const same = I.line ? I.line.refs.filter(r => r !== c.ref) : [];
    const chips = [`<span class="chip">${c.side === "TOP" ? "Top" : "Bottom"}</span>`];
    if (I.mount) chips.push(`<span class="chip">${esc(I.mount)}</span>`);
    if (!I.line && S.bom) chips.push(`<span class="chip warn">Not in BOM</span>`);
    const pins = c.pins.map(p => {
      const n = p.net && S.board.nets.get(p.net), others = n ? n.pins.length - 1 : 0, on = s.pin === p.num;
      return `<tr class="row${on ? " on" : ""}" ${p.net ? `data-net="${esc(p.net)}"` : ""}>
        <td class="m">${esc(p.num)}${p.name && p.name !== p.num ? ` <span class="sub">${esc(p.name)}</span>` : ""}</td>
        <td class="m">${p.net ? `<span class="ell">${esc(p.net)}</span>` : `<span class="na">no net</span>`}</td>
        <td class="sub m">${p.net ? others + " other" + (others === 1 ? "" : "s") : ""}</td></tr>`;
    }).join("");
    return `
      <div class="card-head"><div class="ref">${esc(c.ref)}</div><div class="chips">${chips.join("")}</div></div>
      ${I.desc ? `<div class="desc">${esc(I.desc)}${I.descSrc === "cad" ? ` <span class="chip" title="The BOM has no Description or Name for this part; text is from the CAD library">CAD</span>` : ""}</div>` : ""}
      ${I.value ? `<p class="value">${esc(I.value)}</p>` : ""}
      ${I.pnMismatch ? `<div class="warnbox">Atlas PN differs: BOM ${esc(I.line.atlas)}, CAD library ${esc(I.atlasCad)}.</div>` : ""}
      <dl class="kv">
        <dt>Atlas PN</dt><dd class="big">${I.atlas ? esc(I.atlas) + (I.atlasSrc === "cad" ? ` <span class="chip" title="From the CAD library reference in the IPC-2581 file">CAD</span>` : "") + copyBtn(I.atlas) : na()}</dd>
        <dt>Mfr PN</dt><dd class="big">${I.mpn ? esc(I.mpn) + copyBtn(I.mpn) : na(S.bom ? "None listed" : "No BOM loaded")}</dd>
        <dt>Manufacturer</dt><dd>${I.mfr ? esc(I.mfr) : na(S.bom ? "None listed" : "No BOM loaded")}</dd>
        <dt>Footprint</dt><dd class="m">${esc(c.pkg)}</dd>
        <dt>Location</dt><dd>${fmtLen(c.x)}, ${fmtLen(c.y)} · ${+c.rot.toFixed(2)}°</dd>
        ${c.height ? `<dt>Height</dt><dd>${fmtLen(c.height)}</dd>` : ""}
      </dl>
      ${same.length ? `<h3 class="sub"><span>Same part (${same.length + 1} on board)</span><button type="button" class="linkish" data-group="${I.line.idx}">Show all</button></h3>
        <div class="refs">${same.sort(natSort).map(r => `<button type="button" class="linkish" data-ref="${esc(r)}">${esc(r)}</button>`).join("")}</div>` : ""}
      <h3 class="sub"><span>Pins (${c.pins.length})</span><span>Click a net to trace it</span></h3>
      <table class="t"><thead><tr><th>Pin</th><th>Net</th><th></th></tr></thead><tbody>${pins || `<tr><td colspan="3" class="sub">No pins</td></tr>`}</tbody></table>
      ${I.line && Object.keys(I.line.fields).length ? `<h3 class="sub"><span>BOM row</span></h3><dl class="kv">${Object.entries(I.line.fields).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>` : ""}
      ${I.cad && I.cad.oem ? `<h3 class="sub"><span>CAD library ref</span></h3><div class="desc mono" style="font-size:11.5px">${esc(I.cad.oem)}</div>` : ""}`;
  }

  function netCard(name) {
    const n = S.board.nets.get(name), e = G.netInfo.get(name);
    if (!n && !e) return `<div class="empty-note"><b>${esc(name)}</b>No connections found.</div>`;
    const pins = n ? n.pins.slice().sort((a, b) => natSort(a.comp, b.comp) || natSort(a.pin, b.pin)) : [];
    const rows = pins.map(p => {
      const I = S.board.compByRef.get(p.comp) ? partInfo(p.comp) : {};
      return `<tr class="row" data-ref="${esc(p.comp)}" data-pin="${esc(p.pin)}"><td class="m">${esc(p.comp)}</td><td class="m">${esc(p.pin)}</td><td><span class="ell">${esc(I.desc)}</span></td></tr>`;
    }).join("");
    const layers = e ? [...e.layers].sort((a, b) => (S.board.layerByName.get(a) || {}).order - (S.board.layerByName.get(b) || {}).order) : [];
    return `
      <div class="card-head"><div class="ref" style="font-size:24px">${esc(name)}</div><div class="chips"><span class="chip lime">Net</span></div></div>
      <dl class="kv">
        <dt>Parts</dt><dd>${n ? n.comps.size : 0}</dd>
        <dt>Pins</dt><dd>${pins.length}</dd>
        <dt>Layers</dt><dd>${layers.map(esc).join(", ") || "—"}</dd>
        <dt>Trace length</dt><dd>${e && e.len ? "≈ " + fmtLen(e.len, 1) : "—"} <span class="sub muted" style="font-size:12px">(sum of tracks, no pours)</span></dd>
      </dl>
      <h3 class="sub"><span>Connected pins</span><span>Click to open the part</span></h3>
      <table class="t"><thead><tr><th>Ref</th><th>Pin</th><th>Description</th></tr></thead><tbody>${rows || `<tr><td colspan="3" class="sub">No part pins on this net</td></tr>`}</tbody></table>`;
  }

  function groupCard(s) {
    const line = S.bom && S.bom.lines[s.line];
    const refs = s.refs.slice().sort(natSort);
    const first = refs.find(r => S.board.compByRef.get(r));
    const I = first ? partInfo(first) : lineInfo(line);
    const missing = refs.filter(r => !S.board.compByRef.get(r));
    return `
      <div class="card-head"><div class="ref" style="font-size:24px">${esc(I.atlas || I.desc || "BOM line")}</div><div class="chips"><span class="chip lime">${refs.length} placed</span></div></div>
      ${I.desc ? `<div class="desc">${esc(I.desc)}</div>` : ""}
      ${I.value ? `<p class="value">${esc(I.value)}</p>` : ""}
      <dl class="kv">
        <dt>Atlas PN</dt><dd class="big">${I.atlas ? esc(I.atlas) + copyBtn(I.atlas) : na()}</dd>
        <dt>Mfr PN</dt><dd class="big">${I.mpn ? esc(I.mpn) + copyBtn(I.mpn) : na("None listed")}</dd>
        <dt>Manufacturer</dt><dd>${I.mfr ? esc(I.mfr) : na("None listed")}</dd>
      </dl>
      <h3 class="sub"><span>Designators</span></h3>
      <div class="refs">${refs.map(r => `<button type="button" class="linkish" data-ref="${esc(r)}">${esc(r)}</button>`).join("")}</div>
      ${missing.length ? `<div class="warnbox">Not on the board: ${missing.map(esc).join(", ")}</div>` : ""}`;
  }

  function netList() { return S.board ? [...S.board.nets.keys()].sort(natSort) : []; }

  function partsHTML() {
    if (!S.board) return `<div class="empty-note"><b>No board loaded</b></div>`;
    const q = S.query, sel = selectedRefs();
    const head = `<div class="list-head"><span class="mono">${q ? `${S.matches.size} match${S.matches.size === 1 ? "" : "es"} for “${esc(q)}”` : S.board.comps.length + " parts"}</span>
      ${S.bom ? `<label class="toggle"><input type="checkbox" id="grpToggle" ${S.groupParts ? "checked" : ""}> By BOM line</label>` : ""}</div>`;
    if (S.groupParts && S.bom) {
      const lines = S.bom.lines.filter(l => !S.matches || l.refs.some(r => S.matches.has(r)));
      return head + `<table class="t"><thead><tr><th>Atlas PN</th><th>Description</th><th>Qty</th><th>Refs</th></tr></thead><tbody>${lines.map(l =>
        `<tr class="row${S.sel && S.sel.type === "group" && S.sel.line === l.idx ? " on" : ""}" data-group="${l.idx}"><td class="m">${hl(l.atlas, q)}</td><td><span class="ell">${hl(l.desc || l.name, q)}</span></td><td class="m">${l.refs.length}</td><td class="m sub"><span class="ell">${hl(l.refs.join(", "), q)}</span></td></tr>`).join("")}</tbody></table>`;
    }
    const comps = S.board.comps.filter(c => !S.matches || S.matches.has(c.ref)).sort((a, b) => natSort(a.ref, b.ref));
    if (!comps.length) return head + `<div class="empty-note">No parts match.</div>`;
    return head + `<table class="t"><thead><tr><th>Ref</th><th>Description</th><th>Atlas PN</th></tr></thead><tbody>${comps.map(c => {
      const I = partInfo(c.ref);
      return `<tr class="row${sel.has(c.ref) ? " on" : ""}" data-ref="${esc(c.ref)}"><td class="m">${hl(c.ref, q)}${c.side === "BOTTOM" ? ` <span class="sub">B</span>` : ""}</td><td><span class="ell" title="${esc(I.desc)}">${hl(I.desc || c.pkg, q)}</span></td><td class="m">${I.atlas ? hl(I.atlas, q) : `<span class="na">—</span>`}</td></tr>`;
    }).join("")}</tbody></table>`;
  }

  function netsHTML() {
    if (!S.board) return `<div class="empty-note"><b>No board loaded</b></div>`;
    const q = S.query, list = S.netMatches || netList();
    const cur = S.sel && S.sel.type === "net" ? S.sel.name : null;
    const head = `<div class="list-head"><span class="mono">${q ? `${list.length} match${list.length === 1 ? "" : "es"} for “${esc(q)}”` : list.length + " nets"}</span></div>`;
    if (!list.length) return head + `<div class="empty-note">No nets match.</div>`;
    return head + `<table class="t"><thead><tr><th>Net</th><th>Pins</th><th>Parts</th></tr></thead><tbody>${list.map(n => {
      const e = S.board.nets.get(n);
      return `<tr class="row${n === cur ? " on" : ""}" data-net="${esc(n)}"><td class="m"><span class="ell" style="max-width:220px">${hl(n, q)}</span></td><td class="m">${e.pins.length}</td><td class="m">${e.comps.size}</td></tr>`;
    }).join("")}</tbody></table>`;
  }

  function checks() {
    const b = S.board, out = [];
    if (!b) return out;
    b.warnings.forEach(w => out.push({ bad: true, t: w }));
    if (!S.bom) { out.push({ bad: !!S.bomErr, t: S.bomErr ? "BOM could not be read: " + S.bomErr : "No BOM loaded. Atlas PN comes from the CAD library where present; Mfr PN is not available." }); return out; }
    const cadRefs = new Set(b.comps.map(c => c.ref));
    const noBom = [...cadRefs].filter(r => !S.bom.byRef.has(r)).sort(natSort);
    const noCad = [...S.bom.byRef.keys()].filter(r => !cadRefs.has(r)).sort(natSort);
    const mism = b.comps.filter(c => partInfo(c.ref).pnMismatch).map(c => c.ref).sort(natSort);
    out.push(noBom.length ? { bad: true, t: `On board, not in BOM (${noBom.length}): ${noBom.join(", ")}` } : { t: "Every board part is in the BOM." });
    out.push(noCad.length ? { bad: true, t: `In BOM, not on board (${noCad.length}): ${noCad.join(", ")}` } : { t: "Every BOM designator is on the board." });
    if (b.cadBom.size) out.push(mism.length ? { bad: true, t: `Atlas PN differs between BOM and CAD library: ${mism.join(", ")}` } : { t: "Atlas PNs match the CAD library refs." });
    return out;
  }

  function projectHTML() {
    if (!S.board) return `<div class="empty-note"><b>No board loaded</b></div>`;
    const b = S.board, f = S.files, kb = x => x ? (x.size / 1024).toFixed(x.size < 10240 ? 1 : 0) + " KB" : "";
    const file = (kind, x, meta) => `<div class="file${x ? "" : " missing"}"><span class="kind">${kind}</span><span class="nm">${x ? esc(x.name) : "Not loaded"}</span>${x && meta ? `<span class="meta">${meta}</span>` : ""}</div>`;
    const imgRow = sd => {
      const im = S.imgs[sd], a = S.align[sd];
      if (!im) return file(sd === "TOP" ? "Top img" : "Bot img", null);
      const how = !a ? "not aligned" : a.how === "saved" ? "saved alignment" : a.how === "manual" ? "manual alignment" : `auto-fit · ${Math.round(a.score * 100)}% match`;
      return file(sd === "TOP" ? "Top img" : "Bot img", f[sd], `${im.w}×${im.h}px · ${how}`) +
        `<div class="row-actions"><button type="button" class="hud-btn" data-align="${sd}">Align ${sd === "TOP" ? "top" : "bottom"}…</button><button type="button" class="hud-btn" data-refit="${sd}">Auto-fit</button></div>`;
    };
    const bw = b.bounds.x1 - b.bounds.x0, bh = b.bounds.y1 - b.bounds.y0;
    const cu = b.layers.filter(l => l.kind === "copper").length;
    const meta = S.bom ? S.bom.meta.filter(m => m.v) : [];
    return `
      <h3 class="sub" style="margin-top:0"><span>Files</span></h3>
      <div class="files">
        ${file("IPC-2581", f.ipc, `rev ${esc(f.ipcRev)} · ${kb(f.ipc)} · ${esc(b.units.toLowerCase())}${f.ipcAlt.length ? " · also found: " + f.ipcAlt.map(esc).join(", ") : ""}`)}
        ${file("BOM", f.bom, S.bom ? `${S.bom.lines.length} lines · sheet “${esc(S.bom.sheet)}”` : esc(S.bomErr))}
        ${S.bom ? `<div class="row-actions"><button type="button" class="hud-btn" data-mapcols>BOM columns…</button></div>` : ""}
        ${imgRow("TOP")}
        ${imgRow("BOTTOM")}
      </div>
      <h3 class="sub"><span>Board</span></h3>
      <dl class="kv">
        <dt>Name</dt><dd>${esc(b.stepName)}</dd>
        <dt>Size</dt><dd>${fmtLen(bw)} × ${fmtLen(bh)}</dd>
        <dt>Copper</dt><dd>${cu} layer${cu === 1 ? "" : "s"}</dd>
        <dt>Parts</dt><dd>${b.comps.length} (${b.comps.filter(c => c.side === "TOP").length} top, ${b.comps.filter(c => c.side === "BOTTOM").length} bottom)</dd>
        <dt>Nets</dt><dd>${b.nets.size}</dd>
        <dt>Holes</dt><dd>${b.holes.length}</dd>
      </dl>
      ${meta.length ? `<h3 class="sub"><span>BOM header</span></h3><dl class="kv">${meta.map(m => `<dt>${esc(m.k)}</dt><dd>${esc(m.v)}</dd>`).join("")}</dl>` : ""}
      <h3 class="sub"><span>Checks</span></h3>
      <ul class="checks">${checks().map(c => `<li class="${c.bad ? "bad" : "good"}">${esc(c.t)}</li>`).join("")}</ul>
      <p class="privacy mono" style="margin-top:22px"><span class="lock"></span>Files are read in memory in this tab only. Close the tab to clear them. Only view settings and photo alignment are kept in this browser.</p>`;
  }

  // ======================================================================
  // Search
  // ======================================================================
  function runSearch() {
    const q = S.query.trim().toLowerCase();
    if (!q || !S.board) { S.matches = null; S.netMatches = null; return; }
    const m = new Set();
    for (const c of S.board.comps) {
      const I = partInfo(c.ref);
      if ([c.ref, c.pkg, I.atlas, I.mpn, I.mfr, I.value, I.desc].some(v => v && String(v).toLowerCase().includes(q))) m.add(c.ref);
    }
    S.matches = m;
    S.netMatches = netList().filter(n => n.toLowerCase().includes(q));
  }
  function onQuery() {
    S.query = $("#q").value;
    runSearch();
    if (S.query && S.tab !== "parts" && S.tab !== "nets") setTab(S.matches.size || !S.netMatches.length ? "parts" : "nets");
    else renderPanel();
    redraw();
  }
  function searchEnter() {
    if (!S.query || !S.board) return;
    const q = S.query.trim().toLowerCase();
    const exact = S.board.comps.find(c => c.ref.toLowerCase() === q);
    if (exact) return select({ type: "comp", ref: exact.ref }, { focus: true });
    const netExact = S.netMatches.find(n => n.toLowerCase() === q);
    if (netExact) return select({ type: "net", name: netExact }, { focus: true });
    const refs = [...S.matches].sort(natSort);
    if (refs.length === 1) return select({ type: "comp", ref: refs[0] }, { focus: true });
    if (refs.length > 1) {
      // all matches share one BOM line -> show the group
      const lines = new Set(refs.map(r => S.bom && S.bom.byRef.get(r)).filter(Boolean));
      if (lines.size === 1) { const l = [...lines][0]; return select({ type: "group", refs: l.refs.slice(), line: l.idx, title: l.atlas || l.desc || l.name }, { focus: true }); }
      return select({ type: "group", refs, line: -1, title: "“" + S.query + "”" }, { focus: true });
    }
    if (S.netMatches.length) select({ type: "net", name: S.netMatches[0] }, { focus: true });
  }

  // ======================================================================
  // HUD / status
  // ======================================================================
  function syncHud() {
    $$("[data-side]").forEach(b => b.setAttribute("aria-pressed", b.dataset.side === S.side));
    const hasImg = !!(S.imgs[S.side] && S.align[S.side]);
    $$("[data-mode]").forEach(b => {
      if (!b.dataset.t) b.dataset.t = b.title;
      b.setAttribute("aria-pressed", b.dataset.mode === (hasImg ? S.mode : "cad"));
      b.disabled = b.dataset.mode !== "cad" && !hasImg;
      b.title = b.disabled ? "No " + S.side.toLowerCase() + " image loaded" : b.dataset.t;
    });
    $("#alignBtn").disabled = !S.imgs[S.side];
    $$("[data-layer]").forEach(i => i.checked = !!S.show[i.dataset.layer]);
    $("#photoAlpha").value = S.photoAlpha;
    $("#unitBtn").textContent = S.units;
  }
  function renderStatus() {
    const f = S.files, parts = [];
    if (S.board) parts.push(`${S.board.stepName} · IPC-2581${S.files.ipcRev}`);
    if (f.bom) parts.push(S.bom ? "BOM" : "BOM (error)");
    const n = (S.imgs.TOP ? 1 : 0) + (S.imgs.BOTTOM ? 1 : 0); if (n) parts.push(n + " image" + (n > 1 ? "s" : ""));
    $("#statFiles").textContent = parts.join(" · ") || "No project";
    $("#rev").textContent = REV;
  }
  function showCursor(bx, by) {
    if (!S.board) return;
    $("#cursor").textContent = bx == null ? "—" : `X ${fmtLen(bx).replace(/ .*/, "")}  Y ${fmtLen(by)}`;
  }

  // ---------- BOM column mapping (operator prompt) ----------
  const MAP_FIELDS = [["atlas", "Atlas PN"], ["desc", "Description"], ["name", "Name / value"], ["mpn", "Mfr PN"], ["mfr", "Manufacturer"]];
  const colsKey = () => "pcbv.bomcols." + S.bom.headers.join("|");      // headers only, no BOM data
  function applySavedCols() {
    const c = store.get(colsKey(), null);
    if (c && c.ref === S.bom.cols.ref && c.ref >= 0) P.bomBuild(S.bom, c);
  }
  function missingCols() {
    const c = S.bom.cols, m = [];
    if (c.atlas < 0) m.push("Atlas PN");
    if (c.desc < 0 && c.name < 0) m.push("Description or Name");
    return "No column was found for: " + m.join(", ") + ". Pick the column for each field.";
  }
  function openColMap(why) {
    const dlg = $("#mapDlg"), bom = S.bom;
    if (!bom || !dlg || !dlg.showModal) return;
    const sample = bom.data.find(r => r && String(r[bom.cols.ref] || "").trim()) || [];
    const opts = cur => `<option value="-1">— none —</option>` + bom.headers.map((h, i) => h && i !== bom.cols.ref ? `<option value="${i}"${i === cur ? " selected" : ""}>${esc(h)}</option>` : "").join("");
    dlg.innerHTML = `<form method="dialog">
      <h2>Match the BOM columns</h2>
      <p>${esc(why)}</p>
      <div class="map">
        <span class="mono muted">Field</span><span class="mono muted">BOM column</span><span class="mono muted">First row (${esc(sample[bom.cols.ref] || "")})</span>
        ${MAP_FIELDS.map(([k, label]) => `<label for="map-${k}">${label}</label><select id="map-${k}" data-col="${k}">${opts(bom.cols[k])}</select><span class="sample" data-sample="${k}"></span>`).join("")}
      </div>
      <p class="note">The viewer shows Description first, and Name when there is no Description. This choice is kept in this browser for BOMs with the same headers.</p>
      <div class="dlg-actions"><button class="btn" value="cancel">Skip</button><button class="btn primary" value="ok">Apply</button></div>
    </form>`;
    const upd = () => dlg.querySelectorAll("select").forEach(s => {
      const i = +s.value; dlg.querySelector(`[data-sample="${s.dataset.col}"]`).textContent = i >= 0 ? (String(sample[i] || "").trim() || "(empty)") : "";
    });
    dlg.onchange = upd; upd();
    dlg.onclose = () => {
      if (dlg.returnValue !== "ok") return;
      const cols = { ...bom.cols };
      dlg.querySelectorAll("select").forEach(s => { cols[s.dataset.col] = +s.value; });
      P.bomBuild(bom, cols); store.set(colsKey(), cols);
      runSearch(); renderPanel(); redraw();
    };
    dlg.returnValue = "";
    dlg.showModal();
  }

  // ---------- toast / busy ----------
  function toast(msg, bad) {
    let host = $("#toasts");
    if (!host) { host = document.createElement("div"); host.id = "toasts"; host.className = "toasts"; stage.appendChild(host); }
    const el = document.createElement("div"); el.className = "toast" + (bad ? " bad" : ""); el.textContent = msg;
    host.appendChild(el);
    setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 400); }, bad ? 7000 : 4500);
  }
  function busy(t) { $("#busy").hidden = !t; if (t) $("#busyText").textContent = t; }
  const frame = () => new Promise(r => setTimeout(r, 30));     // lets the busy note paint before a long parse

  // ======================================================================
  // Events
  // ======================================================================
  const tip = $("#tip");
  function showTip(h, sx, sy) {
    if (!h || !h.comp) { tip.hidden = true; return; }
    const c = S.board.compByRef.get(h.comp); if (!c) { tip.hidden = true; return; }
    const I = partInfo(c.ref);
    const pin = h.pin != null ? c.pins.find(p => p.num === h.pin) : null;
    tip.innerHTML = `<b>${esc(c.ref)}</b> ${I.atlas ? `<span class="k">${esc(I.atlas)}</span>` : ""}` +
      (I.desc ? `<br><span class="k">${esc(I.desc)}</span>` : "") +
      (pin ? `<br>Pin ${esc(pin.num)} · ${pin.net ? esc(pin.net) : "no net"}` : "");
    tip.hidden = false;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = clamp(sx + 14, 4, W - tw - 4) + "px";
    tip.style.top = (sy + 18 + th > H ? sy - th - 12 : sy + 18) + "px";
  }

  const ptrs = new Map();
  let drag = null, pinch = null;
  cv.addEventListener("pointerdown", e => {
    if (!S.board) return;
    cv.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: S.cam.z }; drag = null; return;
    }
    drag = { x: e.offsetX, y: e.offsetY, cx: S.cam.x, cy: S.cam.y, moved: false, btn: e.button, a0: S.aligning ? { ...S.align[S.aligning] } : null };
  });
  cv.addEventListener("pointermove", e => {
    if (!S.board) return;
    if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    const [bx, by] = toBoard(e.offsetX, e.offsetY); showCursor(bx, by);
    if (pinch && ptrs.size === 2) {
      const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, (pinch.z * d / pinch.d) / S.cam.z); return;
    }
    if (drag) {
      const dx = e.offsetX - drag.x, dy = e.offsetY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) > 4) { drag.moved = true; cv.classList.add("drag"); tip.hidden = true; }
      if (drag.moved) {
        if (S.aligning && drag.btn === 0) { const a = S.align[S.aligning]; a.x = drag.a0.x + dx / S.cam.z; a.y = drag.a0.y - dy / S.cam.z; a.how = "manual"; }
        else { S.cam.x = drag.cx - dx / S.cam.z; S.cam.y = drag.cy + dy / S.cam.z; }
        redraw();
      }
      return;
    }
    if (S.aligning) return;
    const h = hit(bx, by, false);
    const key = h ? h.comp + "|" + h.pin : "";
    if (key !== (S.hover ? S.hover.comp + "|" + S.hover.pin : "")) { S.hover = h; redraw(); }
    cv.classList.toggle("hot", !!h);
    showTip(h, e.offsetX, e.offsetY);
  });
  const endPtr = e => {
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) pinch = null;
    if (drag && !drag.moved && drag.btn === 0 && !S.aligning && e.type === "pointerup") {
      const [bx, by] = toBoard(e.offsetX, e.offsetY), h = hit(bx, by, true);
      if (!h) select(null);
      else if (h.comp) select({ type: "comp", ref: h.comp, pin: h.pin != null ? h.pin : null });
      else if (h.net) select({ type: "net", name: h.net });
    }
    drag = null; cv.classList.remove("drag");
  };
  cv.addEventListener("pointerup", endPtr);
  cv.addEventListener("pointercancel", endPtr);
  cv.addEventListener("pointerleave", () => { if (S.hover) { S.hover = null; redraw(); } tip.hidden = true; showCursor(); });
  cv.addEventListener("dblclick", e => {
    if (!S.board || S.aligning) return;
    const [bx, by] = toBoard(e.offsetX, e.offsetY), h = hit(bx, by, true);
    if (h && h.net) select({ type: "net", name: h.net });
  });
  cv.addEventListener("contextmenu", e => { if (S.aligning) e.preventDefault(); });
  cv.addEventListener("wheel", e => {
    if (!S.board) return;
    e.preventDefault();
    const dy = e.deltaMode ? e.deltaY * 33 : e.deltaY;
    if (S.aligning && !e.ctrlKey) {
      const a = S.align[S.aligning], f = Math.exp(-dy * (e.shiftKey ? 0.00008 : 0.0005));
      const vx = (e.offsetX - W / 2) / S.cam.z + S.cam.x, vy = S.cam.y - (e.offsetY - H / 2) / S.cam.z;
      a.s *= f; a.x = vx - (vx - a.x) * f; a.y = vy - (vy - a.y) * f; a.how = "manual";
      redraw(); return;
    }
    zoomAt(e.offsetX, e.offsetY, Math.exp(-dy * 0.0015));
  }, { passive: false });

  // HUD
  $("#hud").addEventListener("click", e => {
    const sd = e.target.closest("[data-side]"); if (sd) { setSide(sd.dataset.side); return; }
    const md = e.target.closest("[data-mode]"); if (md && !md.disabled) { S.mode = md.dataset.mode; syncHud(); redraw(); }
  });
  $("#layersBtn").addEventListener("click", e => {
    const p = $("#layersPop"); p.hidden = !p.hidden; e.currentTarget.setAttribute("aria-expanded", !p.hidden);
  });
  document.addEventListener("pointerdown", e => { if (!e.target.closest(".pop")) { $("#layersPop").hidden = true; $("#layersBtn").setAttribute("aria-expanded", "false"); } });
  $("#layersPop").addEventListener("change", e => {
    const k = e.target.dataset.layer;
    if (k) { S.show[k] = e.target.checked; store.set("pcbv.show", S.show); redraw(); }
  });
  $("#photoAlpha").addEventListener("input", e => { S.photoAlpha = +e.target.value; redraw(); });
  $("#zoomIn").addEventListener("click", () => zoomAt(W / 2, H / 2, 1.4));
  $("#zoomOut").addEventListener("click", () => zoomAt(W / 2, H / 2, 1 / 1.4));
  $("#fitBtn").addEventListener("click", () => fit());
  $("#alignDone").addEventListener("click", endAlign);
  $("#alignBtn").addEventListener("click", () => startAlign(S.side));
  $("#alignAuto").addEventListener("click", () => { const sd = S.aligning; if (sd) { try { localStorage.removeItem(alignKey(sd)); } catch {} S.align[sd] = autoFit(sd); redraw(); } });
  $("#unitBtn").addEventListener("click", () => { S.units = S.units === "mm" ? "in" : "mm"; store.set("pcbv.units", S.units); syncHud(); renderPanel(); });

  // Tabs + panel delegation
  $(".tabs").addEventListener("click", e => { const t = e.target.closest("[data-tab]"); if (t) setTab(t.dataset.tab); });
  $(".panel").addEventListener("click", e => {
    const t = e.target;
    const cp = t.closest("[data-copy]");
    if (cp) {
      const v = cp.dataset.copy;
      (navigator.clipboard ? navigator.clipboard.writeText(v) : Promise.reject()).then(() => { cp.textContent = "Copied"; cp.classList.add("ok"); setTimeout(() => { cp.textContent = "Copy"; cp.classList.remove("ok"); }, 1200); }).catch(() => toast("Copy failed. Select the text instead.", true));
      return;
    }
    if (t.closest("[data-back]")) { back(); return; }
    const al = t.closest("[data-align]"); if (al) { startAlign(al.dataset.align); return; }
    const rf = t.closest("[data-refit]"); if (rf) { resetAlign(rf.dataset.refit); return; }
    if (t.closest("[data-mapcols]")) { openColMap("Pick the BOM column for each field."); return; }
    if (t.id === "grpToggle") { S.groupParts = t.checked; renderPanel(); return; }
    const gr = t.closest("[data-group]");
    if (gr && S.bom) { const l = S.bom.lines[+gr.dataset.group]; if (l) select({ type: "group", refs: l.refs.slice(), line: l.idx, title: l.atlas || l.desc || l.name }, { focus: true }); return; }
    const nt = t.closest("[data-net]"); if (nt && !t.closest("[data-ref]")) { select({ type: "net", name: nt.dataset.net }, { focus: true }); return; }
    const rf2 = t.closest("[data-ref]");
    if (rf2) select({ type: "comp", ref: rf2.dataset.ref, pin: rf2.dataset.pin || null }, { focus: true });
  });

  // Search
  $("#q").addEventListener("input", onQuery);
  $("#q").addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); searchEnter(); }
    if (e.key === "Escape") { $("#q").value = ""; onQuery(); $("#q").blur(); }
  });

  // Keyboard
  addEventListener("keydown", e => {
    if ((e.target.matches && e.target.matches("input, textarea, select")) || e.ctrlKey || e.metaKey || e.altKey || document.querySelector("dialog[open]")) return;
    if (!S.board) return;
    if (S.aligning) {
      const a = S.align[S.aligning], st = (e.shiftKey ? 10 : 1) / S.cam.z;
      const mv = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, st], ArrowDown: [0, -st] }[e.key];
      if (mv) { e.preventDefault(); a.x += mv[0]; a.y += mv[1]; a.how = "manual"; redraw(); return; }
      if (e.key === "Escape" || e.key === "Enter") { endAlign(); return; }
    }
    const k = e.key.toLowerCase();
    if (k === "/") { e.preventDefault(); $("#q").focus(); $("#q").select(); }
    else if (k === "escape") { if (S.query) { $("#q").value = ""; onQuery(); } else select(null); }
    else if (k === "f") fit();
    else if (k === "t") setSide("TOP");
    else if (k === "b") setSide("BOTTOM");
    else if (k === "v") setSide(S.side === "TOP" ? "BOTTOM" : "TOP");
    else if ("123".includes(k) && k) { const md = ["cad", "blend", "photo"][+k - 1]; if (md === "cad" || (S.imgs[S.side] && S.align[S.side])) { S.mode = md; syncHud(); redraw(); } }
    else if (k === "l") { S.show.labels = !S.show.labels; store.set("pcbv.show", S.show); syncHud(); redraw(); }
    else if (k === "+" || k === "=") zoomAt(W / 2, H / 2, 1.4);
    else if (k === "-" || k === "_") zoomAt(W / 2, H / 2, 1 / 1.4);
    else if (k === "backspace" && S.hist.length) { e.preventDefault(); back(); }
  });

  // File pickers
  const pickFolder = () => $("#folderInput").click(), pickFiles = () => $("#filesInput").click();
  $("#openFolderBtn").addEventListener("click", pickFolder); $("#dropFolderBtn").addEventListener("click", pickFolder);
  $("#openFilesBtn").addEventListener("click", pickFiles); $("#dropFilesBtn").addEventListener("click", pickFiles);
  for (const id of ["#folderInput", "#filesInput"]) $(id).addEventListener("change", e => { const fs = Array.from(e.target.files || []); e.target.value = ""; if (fs.length) loadFiles(fs); });

  // Drag and drop anywhere
  let dragDepth = 0;
  addEventListener("dragenter", e => { if (e.dataTransfer && [...e.dataTransfer.types].includes("Files")) { dragDepth++; $("#dropping").hidden = false; } });
  addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; $("#dropping").hidden = true; } });
  addEventListener("dragover", e => { e.preventDefault(); });
  addEventListener("drop", async e => {
    e.preventDefault(); dragDepth = 0; $("#dropping").hidden = true;
    if (!e.dataTransfer) return;
    const fs = await filesFromDrop(e.dataTransfer);
    if (fs.length) loadFiles(fs);
  });

  // Theme (shared key with the tools hub)
  const root = document.documentElement;
  try { const t = localStorage.getItem("theme"); if (t) root.dataset.theme = t; } catch {}
  const isDark = () => root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  $("#themeBtn").addEventListener("click", () => { const n = isDark() ? "light" : "dark"; root.dataset.theme = n; try { localStorage.setItem("theme", n); } catch {} readColors(); redraw(); });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { readColors(); redraw(); });

  new ResizeObserver(() => resize()).observe(stage);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { readColors(); redraw(); });

  // Debug/test hook (no network; only accepts File objects)
  window.PCBV.app = { loadFiles, state: S };

  readColors(); syncHud(); renderPanel(); renderStatus(); resize();
})();
