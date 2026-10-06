/*
  PCB Viewer — IPC-2581 parser (rev A / B / C)
  Scope: reads an IPC-2581 XML string in the browser and returns a flat board
  model: layers, board profile, copper/silk geometry per net, pads with pin refs,
  drill holes, components (with placed outlines and pins), nets, and CAD BOM data.
  All arcs are flattened to polylines. Coordinates stay in file units.
*/
(function () {
  "use strict";

  const UNIT_MM = { INCH: 25.4, MILLIMETER: 1, MM: 1, MICRON: 0.001, MIL: 0.0254 };
  const ARC_STEP = Math.PI / 36;   // 5 deg max segment angle

  // ---------- small helpers ----------
  const num = (el, a, d = 0) => { const v = el.getAttribute(a); return v == null || v === "" ? d : +v; };
  const kids = (el, tag) => { const o = []; for (let c = el.firstElementChild; c; c = c.nextElementSibling) if (!tag || c.localName === tag) o.push(c); return o; };
  const kid = (el, tag) => { for (let c = el.firstElementChild; c; c = c.nextElementSibling) if (c.localName === tag) return c; return null; };
  const all = (el, tag) => Array.from(el.getElementsByTagName(tag));
  const netName = n => (!n || /^no ?net$/i.test(n) || n === "$NONE$") ? null : n;

  // 2D affine matrix [a,b,c,d,e,f]: x' = a*x + c*y + e, y' = b*x + d*y + f
  const I = [1, 0, 0, 1, 0, 0];
  const mul = (m, n) => [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  const T = (x, y) => [1, 0, 0, 1, x, y];
  const R = deg => { const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); return [c, s, -s, c, 0, 0]; };
  const apply = (m, pts) => { const o = new Array(pts.length); for (let i = 0; i < pts.length; i += 2) { const x = pts[i], y = pts[i + 1]; o[i] = m[0] * x + m[2] * y + m[4]; o[i + 1] = m[1] * x + m[3] * y + m[5]; } return o; };
  const scaleOf = m => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));

  // Xform: scale -> mirror (x) -> rotate (CCW) -> offset
  function xformM(xf) {
    if (!xf) return I;
    const s = num(xf, "scale", 1), mir = xf.getAttribute("mirror") === "true";
    let m = [s * (mir ? -1 : 1), 0, 0, s, 0, 0];
    m = mul(R(num(xf, "rotation", 0)), m);
    return mul(T(num(xf, "xOffset", 0), num(xf, "yOffset", 0)), m);
  }
  // Location + Xform children of an element -> placement matrix
  function placeM(el) {
    const loc = kid(el, "Location"), xf = kid(el, "Xform");
    return mul(loc ? T(num(loc, "x"), num(loc, "y")) : I, xformM(xf));
  }

  // ---------- arc / polygon flattening ----------
  function arcTo(out, sx, sy, ex, ey, cx, cy, cw) {
    const r = Math.hypot(sx - cx, sy - cy);
    const a0 = Math.atan2(sy - cy, sx - cx);
    let a1 = Math.atan2(ey - cy, ex - cx);
    let sw = cw ? a0 - a1 : a1 - a0;
    while (sw <= 1e-9) sw += 2 * Math.PI;
    if (Math.hypot(ex - sx, ey - sy) < 1e-7) sw = 2 * Math.PI;
    const n = Math.max(1, Math.ceil(sw / ARC_STEP)), d = (cw ? -sw : sw) / n;
    for (let i = 1; i <= n; i++) out.push(cx + r * Math.cos(a0 + d * i), cy + r * Math.sin(a0 + d * i));
    out[out.length - 2] = ex; out[out.length - 1] = ey;
  }
  // PolyBegin / PolyStepSegment / PolyStepCurve children -> flat point list
  function polyPts(el) {
    const o = [];
    for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
      const t = c.localName;
      if (t === "PolyBegin" || t === "PolyStepSegment") o.push(num(c, "x"), num(c, "y"));
      else if (t === "PolyStepCurve" && o.length) arcTo(o, o[o.length - 2], o[o.length - 1], num(c, "x"), num(c, "y"), num(c, "centerX"), num(c, "centerY"), c.getAttribute("clockwise") === "true");
    }
    return o;
  }
  const circle = (cx, cy, r, n = 36) => { const o = []; for (let i = 0; i < n; i++) { const a = i / n * 2 * Math.PI; o.push(cx + r * Math.cos(a), cy + r * Math.sin(a)); } return o; };
  function stadium(w, h) {           // oval / obround centred on origin
    const o = [];
    if (w >= h) { const r = h / 2, dx = w / 2 - r;
      o.push(dx, -r); arcTo(o, dx, -r, dx, r, dx, 0, false); o.push(-dx, r); arcTo(o, -dx, r, -dx, -r, -dx, 0, false); }
    else { const r = w / 2, dy = h / 2 - r;
      o.push(r, -dy); o.push(r, dy); arcTo(o, r, dy, -r, dy, 0, dy, false); o.push(-r, -dy); arcTo(o, -r, -dy, r, -dy, 0, -dy, false); }
    return o;
  }
  function roundRect(w, h, r, corners) {   // corners: [ur, ul, ll, lr] booleans
    const x = w / 2, y = h / 2, o = []; r = Math.min(r, x, y);
    const cs = [[x, y, 0], [-x, y, 90], [-x, -y, 180], [x, -y, 270]];
    cs.forEach(([cx, cy, a], i) => {
      if (corners && !corners[i] || r <= 0) { o.push(cx, cy); return; }
      const ox = cx - Math.sign(cx) * r, oy = cy - Math.sign(cy) * r;
      for (let k = 0; k <= 6; k++) { const t = (a + k * 15) * Math.PI / 180; o.push(ox + r * Math.cos(t), oy + r * Math.sin(t)); }
    });
    return o;
  }
  function chamRect(w, h, c, corners) {
    const x = w / 2, y = h / 2, o = [];
    const cs = [[x, y], [-x, y], [-x, -y], [x, -y]];
    cs.forEach(([cx, cy], i) => {
      if (corners && !corners[i] || c <= 0) { o.push(cx, cy); return; }
      const sx = Math.sign(cx), sy = Math.sign(cy);
      // walk CCW: arrive along the previous edge, leave along the next
      if (i % 2 === 0) o.push(cx, cy - sy * c, cx - sx * c, cy); else o.push(cx - sx * c, cy, cx, cy - sy * c);
    });
    return o;
  }
  const regular = (d, n, rot = 0) => { const o = [], r = d / 2; for (let i = 0; i < n; i++) { const a = rot + i / n * 2 * Math.PI; o.push(r * Math.cos(a), r * Math.sin(a)); } return o; };
  const corners = el => ["upperRight", "upperLeft", "lowerLeft", "lowerRight"].map(k => el.getAttribute(k) !== "false");

  // ---------- parser ----------
  function parse(xmlText) {
    const doc = new DOMParser().parseFromString(xmlText, "application/xml");
    const err = doc.getElementsByTagName("parsererror")[0];
    if (err) throw new Error("XML parse error: " + err.textContent.slice(0, 160));
    const root = doc.documentElement;
    if (root.localName !== "IPC-2581") throw new Error("Not an IPC-2581 file (root is <" + root.localName + ">).");

    const out = {
      rev: root.getAttribute("revision") || "?",
      units: "INCH", toMM: 25.4, stepName: "",
      layers: [], layerByName: new Map(),
      profile: [],             // rings (flat pts); first = outer
      items: [],               // {layer, net, kind:'stroke'|'fill', pts | rings, w, cap, bb}
      pads: [],                // {layer, net, comp, pin, x, y, rings, bb}
      holes: [],               // {x, y, d, plated, net, name}
      comps: [], compByRef: new Map(),
      nets: new Map(),         // name -> {name, pins:[{comp,pin}], comps:Set}
      cadBom: new Map(),       // refdes -> {oem, desc, ipn, libPN, libDesc, chars:{}}
      bounds: null, warnings: []
    };

    // ---- units ----
    const cadHdr = doc.getElementsByTagName("CadHeader")[0];
    const u = (cadHdr && cadHdr.getAttribute("units")) || "INCH";
    out.units = u.toUpperCase(); out.toMM = UNIT_MM[out.units] || 25.4;

    // ---- layers ----
    for (const L of all(doc, "Layer")) {
      if (!L.parentElement || L.parentElement.localName !== "CadData") continue;
      const func = (L.getAttribute("layerFunction") || "").toUpperCase(), side = (L.getAttribute("side") || "").toUpperCase();
      let kind = "doc";
      if (/SIGNAL|PLANE|CONDUCTOR|MIXED|POWER|GROUND|CONDFILM|CONDFOIL/.test(func)) kind = "copper";
      else if (/LEGEND|SILK/.test(func)) kind = "silk";
      else if (/SOLDERMASK/.test(func)) kind = "mask";
      else if (/PASTE/.test(func)) kind = "paste";
      else if (/DRILL|ROUT/.test(func)) kind = "drill";
      else if (/BOARD_OUTLINE|PROFILE/.test(func)) kind = "outline";
      const lay = { name: L.getAttribute("name"), func, side, kind, order: out.layers.length };
      out.layers.push(lay); out.layerByName.set(lay.name, lay);
    }
    const layerOf = n => out.layerByName.get(n) || (n && { name: n, kind: /top/i.test(n) ? "copper" : "doc", side: /bot/i.test(n) ? "BOTTOM" : "TOP" });
    const isCopper = n => (layerOf(n) || {}).kind === "copper";

    // ---- dictionaries ----
    const stdDict = new Map(), userDict = new Map(), lineDict = new Map(), fillDict = new Map();
    for (const e of all(doc, "EntryStandard")) stdDict.set(e.getAttribute("id"), e.firstElementChild);
    for (const e of all(doc, "EntryUser")) userDict.set(e.getAttribute("id"), e.firstElementChild);
    for (const e of all(doc, "EntryLineDesc")) lineDict.set(e.getAttribute("id"), kid(e, "LineDesc"));
    for (const e of all(doc, "EntryFillDesc")) fillDict.set(e.getAttribute("id"), kid(e, "FillDesc"));

    function lineDesc(el) {
      let ld = kid(el, "LineDesc");
      if (!ld) { const r = kid(el, "LineDescRef"); if (r) ld = lineDict.get(r.getAttribute("id")); }
      if (!ld) return { w: 0, cap: "round" };
      const end = (ld.getAttribute("lineEnd") || "ROUND").toUpperCase();
      return { w: num(ld, "lineWidth", 0), cap: end === "SQUARE" ? "square" : end === "NONE" ? "butt" : "round" };
    }
    function hollow(el) {
      let fd = kid(el, "FillDesc");
      if (!fd) { const r = kid(el, "FillDescRef"); if (r) fd = fillDict.get(r.getAttribute("id")); }
      return fd && /HOLLOW/i.test(fd.getAttribute("fillProperty") || "");
    }

    // Standard primitive -> local rings
    function stdRings(p) {
      if (!p) return null;
      switch (p.localName) {
        case "Circle": return [circle(0, 0, num(p, "diameter") / 2)];
        case "RectCenter": { const w = num(p, "width") / 2, h = num(p, "height") / 2; return [[-w, -h, w, -h, w, h, -w, h]]; }
        case "RectCorner": { const x0 = num(p, "lowerLeftX"), y0 = num(p, "lowerLeftY"), x1 = num(p, "upperRightX"), y1 = num(p, "upperRightY"); return [[x0, y0, x1, y0, x1, y1, x0, y1]]; }
        case "Oval": return [stadium(num(p, "width"), num(p, "height"))];
        case "RectRound": return [roundRect(num(p, "width"), num(p, "height"), num(p, "radius"), corners(p))];
        case "RectCham": return [chamRect(num(p, "width"), num(p, "height"), num(p, "chamfer"), corners(p))];
        case "Ellipse": { const a = num(p, "width") / 2, b = num(p, "height") / 2, o = []; for (let i = 0; i < 48; i++) { const t = i / 48 * 2 * Math.PI; o.push(a * Math.cos(t), b * Math.sin(t)); } return [o]; }
        case "Diamond": { const w = num(p, "width") / 2, h = num(p, "height") / 2; return [[w, 0, 0, h, -w, 0, 0, -h]]; }
        case "Hexagon": return [regular(num(p, "length"), 6)];
        case "Octagon": return [regular(num(p, "length"), 8, Math.PI / 8)];
        case "Triangle": { const b = num(p, "base") / 2, h = num(p, "height") / 2; return [[-b, -h, b, -h, 0, h]]; }
        case "Donut": case "Thermal": case "Moire": {
          const od = num(p, "outerDiameter", num(p, "diameter")), id = num(p, "innerDiameter", 0);
          return id > 0 ? [circle(0, 0, od / 2), circle(0, 0, id / 2)] : [circle(0, 0, od / 2)];
        }
        case "Butterfly": return [circle(0, 0, num(p, "diameter", num(p, "side")) / 2)];
        case "Contour": return contourRings(p);
        case "Polygon": return [polyPts(p)];
        default: return null;
      }
    }
    function contourRings(c) {
      const rings = [];
      for (const k of kids(c)) if (k.localName === "Polygon" || k.localName === "Cutout") rings.push(polyPts(k));
      return rings;
    }

    // ---- feature walker ----
    // ctx: {layer, net, m, comp, pin}
    function addStroke(ctx, pts, ld) {
      if (pts.length < 4) return;
      const P = apply(ctx.m, pts);
      out.items.push({ layer: ctx.layer, net: ctx.net, kind: "stroke", pts: P, w: Math.max(ld.w * scaleOf(ctx.m), 0), cap: ld.cap, bb: bbox([P]) });
    }
    function addFill(ctx, rings) {
      if (!rings || !rings.length) return;
      const R2 = rings.map(r => apply(ctx.m, r));
      out.items.push({ layer: ctx.layer, net: ctx.net, kind: "fill", rings: R2, bb: bbox(R2) });
    }
    function addPrimitive(ctx, prim, holder) {
      // prim: a standard primitive element or UserSpecial
      if (!prim) return;
      if (prim.localName === "UserSpecial") { walkChildren(prim, ctx); return; }
      const rings = stdRings(prim);
      if (!rings) return;
      if (hollow(prim) || (holder && hollow(holder))) { const ld = lineDesc(prim); rings.forEach(r => addStroke(ctx, r.concat(r.slice(0, 2)), ld)); }
      else addFill(ctx, rings);
    }
    function primOf(el) {
      const sr = kid(el, "StandardPrimitiveRef"); if (sr) return stdDict.get(sr.getAttribute("id"));
      const ur = kid(el, "UserPrimitiveRef"); if (ur) return userDict.get(ur.getAttribute("id"));
      for (const c of kids(el)) if (/^(Circle|RectCenter|RectCorner|Oval|RectRound|RectCham|Ellipse|Diamond|Hexagon|Octagon|Triangle|Donut|Thermal|Butterfly|Contour|UserSpecial)$/.test(c.localName)) return c;
      return null;
    }
    function addPad(ctx, el, net, pinRefs) {
      const m = mul(ctx.m, placeM(el));
      const prim = primOf(el);
      let rings = prim && prim.localName !== "UserSpecial" ? stdRings(prim) : null;
      if (!rings && prim) {                     // user primitive: collect its fills
        const before = out.items.length;
        walkChildren(prim, { ...ctx, m, net });
        rings = []; for (const it of out.items.splice(before)) if (it.kind === "fill") rings.push(...it.rings.map(r => apply(invert(m), r)));
      }
      if (!rings || !rings.length) rings = [circle(0, 0, 0.01)];
      const R2 = rings.map(r => apply(m, r));
      const refs = pinRefs.length ? pinRefs : [null];
      const ref = refs[0];
      const pad = { layer: ctx.layer, net, comp: ref ? ref.comp : null, pin: ref ? ref.pin : null, x: m[4], y: m[5], rings: R2, bb: bbox(R2) };
      out.pads.push(pad);
      for (const r of refs) if (r) noteNetPin(net, r.comp, r.pin);
    }
    function pinRefsOf(el) {
      return kids(el, "PinRef").map(p => ({ comp: p.getAttribute("componentRef"), pin: p.getAttribute("pin") })).filter(p => p.comp);
    }
    function walkChildren(el, ctx) { for (const c of kids(el)) walk(c, ctx); }
    function walk(el, ctx) {
      switch (el.localName) {
        case "Set": {
          const n = el.getAttribute("net");
          walkChildren(el, n != null ? { ...ctx, net: netName(n) } : ctx);
          break;
        }
        case "Features": {
          const m = mul(ctx.m, placeM(el));
          for (const c of kids(el)) {
            if (c.localName === "Location" || c.localName === "Xform") continue;
            if (/^(StandardPrimitiveRef|UserPrimitiveRef)$/.test(c.localName)) addPrimitive({ ...ctx, m }, c.localName === "StandardPrimitiveRef" ? stdDict.get(c.getAttribute("id")) : userDict.get(c.getAttribute("id")), el);
            else walk(c, { ...ctx, m });
          }
          break;
        }
        case "UserSpecial": walkChildren(el, ctx); break;
        case "Line": addStroke(ctx, [num(el, "startX"), num(el, "startY"), num(el, "endX"), num(el, "endY")], lineDesc(el)); break;
        case "Arc": {
          const p = [num(el, "startX"), num(el, "startY")];
          arcTo(p, p[0], p[1], num(el, "endX"), num(el, "endY"), num(el, "centerX"), num(el, "centerY"), el.getAttribute("clockwise") === "true");
          addStroke(ctx, p, lineDesc(el)); break;
        }
        case "Polyline": addStroke(ctx, polyPts(el), lineDesc(el)); break;
        case "Contour": addFill(ctx, contourRings(el)); break;
        case "Polygon": {
          const pts = polyPts(el);
          if (hollow(el) || kid(el, "LineDesc") && !kid(el, "FillDesc")) addStroke(ctx, pts, lineDesc(el)); else addFill(ctx, [pts]);
          break;
        }
        case "Pad": addPad(ctx, el, ctx.net, pinRefsOf(el)); break;
        case "Hole": case "SlotCavity":
          out.holes.push({ x: num(el, "x"), y: num(el, "y"), d: num(el, "diameter", Math.min(num(el, "width"), num(el, "height")) || 0), plated: !/NONPLATED|UNPLATED/i.test(el.getAttribute("platingStatus") || ""), net: ctx.net, name: el.getAttribute("name") || "" });
          break;
        default:
          if (/^(Circle|RectCenter|RectCorner|Oval|RectRound|RectCham|Ellipse|Diamond|Hexagon|Octagon|Triangle|Donut|Thermal|Butterfly)$/.test(el.localName)) addPrimitive(ctx, el);
      }
    }

    function noteNetPin(net, comp, pin) {
      if (!net || !comp) return;
      let n = out.nets.get(net);
      if (!n) { n = { name: net, pins: [], comps: new Set(), _k: new Set() }; out.nets.set(net, n); }
      const k = comp + "\u0000" + pin;
      if (!n._k.has(k)) { n._k.add(k); n.pins.push({ comp, pin }); n.comps.add(comp); }
    }

    // ---- step ----
    const step = doc.getElementsByTagName("Step")[0];
    if (!step) throw new Error("No <Step> found in the IPC-2581 file.");
    out.stepName = step.getAttribute("name") || "Board";

    // Profile
    const prof = kid(step, "Profile");
    if (prof) for (const k of kids(prof)) if (k.localName === "Polygon" || k.localName === "Cutout") out.profile.push(polyPts(k));
    out.profile = out.profile.filter(r => r.length >= 6);

    // Pad stacks (Altium style: absolute pads grouped by net)
    for (const ps of kids(step, "PadStack")) {
      const net = netName(ps.getAttribute("net"));
      for (const c of kids(ps)) {
        if (c.localName === "LayerHole") out.holes.push({ x: num(c, "x"), y: num(c, "y"), d: num(c, "diameter"), plated: !/NONPLATED|UNPLATED/i.test(c.getAttribute("platingStatus") || ""), via: /VIA/i.test(c.getAttribute("platingStatus") || ""), net, name: c.getAttribute("name") || "" });
        else if (c.localName === "LayerPad") addPad({ layer: c.getAttribute("layerRef"), net, m: I }, c, net, pinRefsOf(c));
      }
    }

    // Layer features
    for (const lf of kids(step, "LayerFeature")) {
      const ln = lf.getAttribute("layerRef");
      walkChildren(lf, { layer: ln, net: null, m: I });
    }

    // Logical nets (connectivity even when pads carry no net)
    for (const ln of all(doc, "LogicalNet")) {
      const n = netName(ln.getAttribute("name"));
      for (const p of kids(ln, "PinRef")) noteNetPin(n, p.getAttribute("componentRef"), p.getAttribute("pin"));
    }

    // ---- packages ----
    const pkgs = new Map();
    for (const P of kids(step, "Package")) {
      const pk = { name: P.getAttribute("name"), outline: [], pins: new Map(), height: num(P, "height", 0) };
      const ol = kid(P, "Outline") || (kid(P, "AssemblyDrawing") && kid(kid(P, "AssemblyDrawing"), "Outline")) || (kid(P, "SilkScreen") && kid(kid(P, "SilkScreen"), "Outline"));
      if (ol) for (const k of kids(ol)) {
        if (k.localName === "Polygon") pk.outline.push(polyPts(k));
        else if (k.localName === "Contour") pk.outline.push(...contourRings(k));
        else if (k.localName === "Polyline") pk.outline.push(polyPts(k));
      }
      for (const pin of kids(P, "Pin")) {
        const loc = kid(pin, "Location");
        pk.pins.set(pin.getAttribute("number"), { num: pin.getAttribute("number"), name: pin.getAttribute("name") || pin.getAttribute("number"), x: loc ? num(loc, "x") : 0, y: loc ? num(loc, "y") : 0 });
      }
      pkgs.set(pk.name, pk);
    }

    // Absolute pin positions from pads (prefer copper)
    const padPins = new Map();   // comp -> Map(pin -> {x,y,n,net,cu})
    for (const p of out.pads) {
      if (!p.comp) continue;
      let m = padPins.get(p.comp); if (!m) padPins.set(p.comp, m = new Map());
      const cu = isCopper(p.layer);
      const e = m.get(p.pin);
      if (!e || (cu && !e.cu)) m.set(p.pin, { x: p.x, y: p.y, net: p.net, cu, layers: new Set([p.layer]) });
      else e.layers.add(p.layer);
    }

    // ---- components ----
    for (const C of kids(step, "Component")) {
      const ref = C.getAttribute("refDes");
      const lname = C.getAttribute("layerRef") || "";
      const xf = kid(C, "Xform"), loc = kid(C, "Location");
      const mir = xf && xf.getAttribute("mirror") === "true";
      const lay = layerOf(lname);
      const side = mir || (lay && lay.side === "BOTTOM") || /bot/i.test(lname) ? "BOTTOM" : "TOP";
      const pk = pkgs.get(C.getAttribute("packageRef")) || { name: C.getAttribute("packageRef") || "", outline: [], pins: new Map() };
      const cx = loc ? num(loc, "x") : 0, cy = loc ? num(loc, "y") : 0, rot = xf ? num(xf, "rotation", 0) : 0;
      let m = mul(T(cx, cy), xformM(xf));
      if (side === "BOTTOM" && !mir) m = mul(m, [-1, 0, 0, 1, 0, 0]);

      // Fit placement to real pad positions when 2+ pins are known (handles exporter rotation conventions).
      const abs = padPins.get(ref);
      const pairs = [];
      if (abs) for (const [k, v] of abs) { const pp = pk.pins.get(k); if (pp) pairs.push([pp.x, pp.y, v.x, v.y]); }
      if (pairs.length >= 2) {
        const fit = fitRigid(pairs, side === "BOTTOM");
        if (fit && fit.err < 0.02 * Math.max(1e-3, fit.span)) m = fit.m;
      }

      const outline = pk.outline.map(r => apply(m, r));
      const pins = [];
      const pinNums = new Set([...pk.pins.keys(), ...(abs ? abs.keys() : [])]);
      for (const k of pinNums) {
        const pp = pk.pins.get(k), a = abs && abs.get(k);
        const [x, y] = a ? [a.x, a.y] : apply(m, [pp.x, pp.y]);
        pins.push({ num: k, name: pp ? pp.name : k, x, y, net: a ? a.net : null, layers: a ? [...a.layers] : [] });
      }
      pins.sort((a, b) => natCmp(a.num, b.num));
      if (!outline.length) {          // fallback box around pins
        const b = pins.length ? bbox([pins.flatMap(p => [p.x, p.y])]) : { x0: cx - 0.02, y0: cy - 0.02, x1: cx + 0.02, y1: cy + 0.02 };
        const pad = Math.max(0.02 * (UNIT_MM.INCH / out.toMM), 0.15 * Math.max(b.x1 - b.x0, b.y1 - b.y0));
        outline.push([b.x0 - pad, b.y0 - pad, b.x1 + pad, b.y0 - pad, b.x1 + pad, b.y1 + pad, b.x0 - pad, b.y1 + pad]);
      }
      const bb = bbox(outline.concat(pins.length ? [pins.flatMap(p => [p.x, p.y])] : []));
      const ob = bbox(outline);
      const comp = {
        ref, pkg: pk.name, part: C.getAttribute("part") || "", layer: lname, side, x: cx, y: cy, rot, height: num(C, "height", pk.height || 0),
        outline, pins, bb, area: Math.max(1e-9, (ob.x1 - ob.x0) * (ob.y1 - ob.y0)), m,
        center: [(ob.x0 + ob.x1) / 2, (ob.y0 + ob.y1) / 2]
      };
      out.comps.push(comp); out.compByRef.set(ref, comp);
    }
    // Net names on pins from net map when pads had none
    for (const n of out.nets.values()) for (const p of n.pins) {
      const c = out.compByRef.get(p.comp); if (!c) continue;
      const pin = c.pins.find(q => q.num === p.pin); if (pin && !pin.net) pin.net = n.name;
    }
    for (const n of out.nets.values()) delete n._k;

    // ---- CAD BOM ----
    for (const bi of all(doc, "BomItem")) {
      const oem = bi.getAttribute("OEMDesignNumberRef") || "";
      // Library ref form "Lib.PcbLib:[01234]DESCRIPTION" (Altium DBLib style)
      const mm = oem.match(/\[([^\]]+)\]\s*(.*)$/);
      const chars = {};
      for (const t of all(bi, "Textual")) {
        const k = t.getAttribute("textualCharacteristicName") || t.getAttribute("definitionSource");
        if (k) chars[k] = t.getAttribute("textualCharacteristicValue") || "";
      }
      const rec = {
        oem, desc: bi.getAttribute("description") || "", ipn: bi.getAttribute("internalPartNumber") || "",
        libPN: mm ? mm[1].trim() : "", libDesc: mm ? mm[2].trim() : "", chars
      };
      for (const r of kids(bi, "RefDes")) out.cadBom.set(r.getAttribute("name"), rec);
    }

    // ---- bounds ----
    let b = out.profile.length ? bbox(out.profile) : null;
    if (!b) {
      const rs = [];
      for (const it of out.items) rs.push([it.bb.x0, it.bb.y0, it.bb.x1, it.bb.y1]);
      for (const c of out.comps) rs.push([c.bb.x0, c.bb.y0, c.bb.x1, c.bb.y1]);
      b = rs.length ? bbox(rs) : { x0: 0, y0: 0, x1: 1, y1: 1 };
      out.warnings.push("No board profile found; extents come from geometry.");
    }
    out.bounds = b;
    if (!out.comps.length) out.warnings.push("No components found in the file.");
    return out;
  }

  // Least-squares rigid fit (rotation + translation, optional X-mirror) package pins -> board pins
  function fitRigid(pairs, preferMirror) {
    let best = null;
    for (const mir of preferMirror ? [true, false] : [false, true]) {
      const s = mir ? -1 : 1, n = pairs.length;
      let px = 0, py = 0, qx = 0, qy = 0;
      for (const [x, y, X, Y] of pairs) { px += s * x; py += y; qx += X; qy += Y; }
      px /= n; py /= n; qx /= n; qy /= n;
      let sxx = 0, sxy = 0, span = 0;
      for (const [x, y, X, Y] of pairs) {
        const ax = s * x - px, ay = y - py, bx = X - qx, by = Y - qy;
        sxx += ax * bx + ay * by; sxy += ax * by - ay * bx; span = Math.max(span, Math.hypot(ax, ay));
      }
      const th = Math.atan2(sxy, sxx), c = Math.cos(th), si = Math.sin(th);
      const m = [c * s, si * s, -si, c, qx - (c * px - si * py), qy - (si * px + c * py)];
      let err = 0;
      for (const [x, y, X, Y] of pairs) err = Math.max(err, Math.hypot(m[0] * x + m[2] * y + m[4] - X, m[1] * x + m[3] * y + m[5] - Y));
      if (!best || err < best.err - 1e-6) best = { m, err, span, mir };
    }
    return best;
  }

  function invert(m) {
    const d = m[0] * m[3] - m[1] * m[2] || 1e-12;
    return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d];
  }
  function bbox(rings) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of rings) for (let i = 0; i < r.length; i += 2) {
      const x = r[i], y = r[i + 1];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    return { x0, y0, x1, y1 };
  }
  function natCmp(a, b) { return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" }); }

  window.PCBV = window.PCBV || {};
  Object.assign(window.PCBV, { parseIPC2581: parse, bbox, natCmp, invert });
})();
