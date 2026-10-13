/* Pet Studio geometry: shape bounds, affine transforms, path points, and turning
   point lists into smooth curves. All in pet units (r), y down. */

export const TAU = 6.2832;
export const clone = o => JSON.parse(JSON.stringify(o));
const R5 = v => Math.round(v * 1e5) / 1e5;

/* ---- sampling and bounds -------------------------------------------------- */
export function ellPoint(s, t) {
  const x = s.rx * Math.cos(t), y = s.ry * Math.sin(t), c = Math.cos(s.rot || 0), n = Math.sin(s.rot || 0);
  return [s.x + x * c - y * n, s.y + x * n + y * c];
}

function bez(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return [u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
          u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]];
}
function quad(p0, p1, p2, t) {
  const u = 1 - t;
  return [u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]];
}

/* Points along a path, one list per segment: [{ci, pts}] (ci = the command it ends). */
export function pathSegments(s, steps = 12) {
  const out = [];
  let cur = null, start = null;
  s.d.forEach((c, ci) => {
    if (c[0] === "M") { cur = [c[1], c[2]]; start = cur; return; }
    if (!cur) cur = start = [0, 0];
    let pts;
    if (c[0] === "L") pts = [cur, [c[1], c[2]]];
    else if (c[0] === "Q") { pts = []; for (let i = 0; i <= steps; i++) pts.push(quad(cur, [c[1], c[2]], [c[3], c[4]], i / steps)); }
    else if (c[0] === "C") { pts = []; for (let i = 0; i <= steps; i++) pts.push(bez(cur, [c[1], c[2]], [c[3], c[4]], [c[5], c[6]], i / steps)); }
    else { pts = [cur, start]; }
    out.push({ ci, pts });
    cur = pts[pts.length - 1];
  });
  return out;
}

export function shapePoints(s) {
  if (s.t === "eye") { const e = 0.11 * (s.s || 1); return [[s.x - e, s.y - e], [s.x + e, s.y + e]]; }
  if (s.t === "ell") {
    const a0 = s.a0 ?? 0, a1 = s.a1 ?? TAU, pts = [];
    for (let i = 0; i <= 32; i++) pts.push(ellPoint(s, a0 + (a1 - a0) * i / 32));
    return pts;
  }
  const pts = [];
  for (const seg of pathSegments(s)) pts.push(...seg.pts);
  if (s.d[0] && s.d[0][0] === "M") pts.push([s.d[0][1], s.d[0][2]]);
  return pts;
}

export function bounds(shapes) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of shapes) {
    const pad = s.stroke ? (s.w || 0.05) / 2 : 0;
    for (const [x, y] of shapePoints(s)) {
      x0 = Math.min(x0, x - pad); y0 = Math.min(y0, y - pad); x1 = Math.max(x1, x + pad); y1 = Math.max(y1, y + pad);
    }
  }
  return isFinite(x0) ? { x0, y0, x1, y1 } : null;
}

/* ---- affine maps: M = [a, b, c, d, e, f], (x, y) -> (ax + cy + e, bx + dy + f) ---- */
export const apply = (M, x, y) => [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]];
export const translateM = (dx, dy) => [1, 0, 0, 1, dx, dy];
export function aroundM(cx, cy, a, b, c, d) { return [a, b, c, d, cx - a * cx - c * cy, cy - b * cx - d * cy]; }
export const scaleM = (cx, cy, sx, sy) => aroundM(cx, cy, sx, 0, 0, sy);
export const rotateM = (cx, cy, t) => aroundM(cx, cy, Math.cos(t), Math.sin(t), -Math.sin(t), Math.cos(t));

export function mapShape(s, M, scaleWidth = true) {
  const o = clone(s), det = M[0] * M[3] - M[1] * M[2], k = Math.sqrt(Math.abs(det));
  if (s.t === "eye") {
    [o.x, o.y] = apply(M, s.x, s.y).map(R5);
    o.s = R5((s.s || 1) * k);
    return o;
  }
  if (scaleWidth && o.w) o.w = R5(o.w * k);
  if (s.t === "path") {
    o.d = s.d.map(c => {
      const n = [c[0]];
      for (let i = 1; i < c.length; i += 2) n.push(...apply(M, c[i], c[i + 1]).map(R5));
      return n;
    });
    return o;
  }
  /* ellipse: map its two axes; a mirror reverses the arc direction */
  const rc = Math.cos(s.rot || 0), rs = Math.sin(s.rot || 0);
  const u = [M[0] * s.rx * rc + M[2] * s.rx * rs, M[1] * s.rx * rc + M[3] * s.rx * rs];
  const v = [-M[0] * s.ry * rs + M[2] * s.ry * rc, -M[1] * s.ry * rs + M[3] * s.ry * rc];
  [o.x, o.y] = apply(M, s.x, s.y).map(R5);
  o.rx = R5(Math.hypot(u[0], u[1]));
  o.ry = R5(Math.hypot(v[0], v[1]));
  o.rot = R5(Math.atan2(u[1], u[0]));
  if (det < 0) { const a0 = s.a0 ?? 0, a1 = s.a1 ?? TAU; o.a0 = R5(-a1); o.a1 = R5(-a0); }
  return o;
}

/* ---- path points ---------------------------------------------------------- */
/* Every editable point: anchors end a command, controls belong to Q / C. */
export function pathNodes(s) {
  const nodes = [];
  s.d.forEach((c, ci) => {
    if (c[0] === "Z") return;
    if (c[0] === "Q") nodes.push({ ci, xi: 1, ctl: true });
    if (c[0] === "C") { nodes.push({ ci, xi: 1, ctl: true }); nodes.push({ ci, xi: 3, ctl: true }); }
    nodes.push({ ci, xi: c.length - 2, ctl: false });
  });
  return nodes;
}

/* The anchor a command starts from. */
export function prevAnchor(s, ci) {
  for (let i = ci - 1; i >= 0; i--) {
    const c = s.d[i];
    if (c[0] === "Z") { for (let j = i - 1; j >= 0; j--) if (s.d[j][0] === "M") return [s.d[j][1], s.d[j][2]]; return null; }
    return [c[c.length - 2], c[c.length - 1]];
  }
  return null;
}

/* Moves an anchor and the handles that hang off it. */
export function moveAnchor(s, ci, dx, dy) {
  const c = s.d[ci], n = c.length;
  c[n - 2] = R5(c[n - 2] + dx); c[n - 1] = R5(c[n - 1] + dy);
  if (c[0] === "C") { c[3] = R5(c[3] + dx); c[4] = R5(c[4] + dy); }
  const nx = s.d[ci + 1];
  if (nx && nx[0] === "C") { nx[1] = R5(nx[1] + dx); nx[2] = R5(nx[2] + dy); }
}

export function anchorCount(s) { return s.d.filter(c => c[0] !== "Z").length; }

/* Straight <-> curved for the segment that ends at command ci. */
export function toggleCurve(s, ci) {
  const c = s.d[ci], p = prevAnchor(s, ci);
  if (!p || c[0] === "M" || c[0] === "Z") return false;
  const [x, y] = c.slice(-2);
  if (c[0] === "L") s.d[ci] = ["C", R5(p[0] + (x - p[0]) / 3), R5(p[1] + (y - p[1]) / 3), R5(p[0] + 2 * (x - p[0]) / 3), R5(p[1] + 2 * (y - p[1]) / 3), x, y];
  else s.d[ci] = ["L", x, y];
  return true;
}

export function deleteAnchor(s, ci) {
  if (anchorCount(s) <= 2) return false;
  const c = s.d[ci];
  if (c[0] === "M") {
    const nx = s.d[ci + 1];
    if (!nx || nx[0] === "Z" || nx[0] === "M") return false;
    s.d.splice(ci, 2, ["M", nx[nx.length - 2], nx[nx.length - 1]]);
  } else s.d.splice(ci, 1);
  return true;
}

/* Splits the segment ending at ci at t (0..1), adding an anchor there. */
export function splitAt(s, ci, t) {
  const c = s.d[ci], p0 = prevAnchor(s, ci);
  if (!p0 || c[0] === "M" || c[0] === "Z") return false;
  if (c[0] === "L") {
    s.d.splice(ci, 0, ["L", R5(p0[0] + (c[1] - p0[0]) * t), R5(p0[1] + (c[2] - p0[1]) * t)]);
    return true;
  }
  let P1, P2, P3;
  if (c[0] === "Q") {
    const q = [c[1], c[2]]; P3 = [c[3], c[4]];
    P1 = [p0[0] + 2 / 3 * (q[0] - p0[0]), p0[1] + 2 / 3 * (q[1] - p0[1])];
    P2 = [P3[0] + 2 / 3 * (q[0] - P3[0]), P3[1] + 2 / 3 * (q[1] - P3[1])];
  } else { P1 = [c[1], c[2]]; P2 = [c[3], c[4]]; P3 = [c[5], c[6]]; }
  const L = (a, b) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const A = L(p0, P1), B = L(P1, P2), Cc = L(P2, P3), D = L(A, B), E = L(B, Cc), F = L(D, E);
  const r = p => p.map(R5);
  s.d.splice(ci, 1, ["C", ...r(A), ...r(D), ...r(F)], ["C", ...r(E), ...r(Cc), ...r(P3)]);
  return true;
}

/* Nearest point on the path outline: { ci, t, dist }. */
export function nearestOnPath(s, x, y) {
  let best = null;
  for (const seg of pathSegments(s, 24)) {
    const P = seg.pts, n = P.length - 1;
    for (let j = 0; j < n; j++) {                   /* project onto each piece */
      const [ax, ay] = P[j], dx = P[j + 1][0] - ax, dy = P[j + 1][1] - ay, l2 = dx * dx + dy * dy;
      const u = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
      const d = Math.hypot(ax + u * dx - x, ay + u * dy - y);
      if (!best || d < best.dist) best = { ci: seg.ci, t: (j + u) / n, dist: d };
    }
  }
  return best;
}

/* ---- point lists to curves ------------------------------------------------ */
/* Ramer-Douglas-Peucker. */
export function simplify(pts, tol) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let md = 0, mi = -1;
    const [ax, ay] = pts[a], [bx, by] = pts[b], len = Math.hypot(bx - ax, by - ay);
    for (let i = a + 1; i < b; i++) {
      const d = len < 1e-9 ? Math.hypot(pts[i][0] - ax, pts[i][1] - ay)            /* a loop: ends meet */
                           : Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / len;
      if (d > md) { md = d; mi = i; }
    }
    if (md > tol) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/* Catmull-Rom through the points, as cubic curves. */
export function smoothPath(pts, closed) {
  const n = pts.length, at = i => closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))];
  const d = [["M", R5(pts[0][0]), R5(pts[0][1])]];
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    d.push(["C", R5(p1[0] + (p2[0] - p0[0]) / 6), R5(p1[1] + (p2[1] - p0[1]) / 6),
                 R5(p2[0] - (p3[0] - p1[0]) / 6), R5(p2[1] - (p3[1] - p1[1]) / 6), R5(p2[0]), R5(p2[1])]);
  }
  if (closed) d.push(["Z"]);
  return d;
}

/* The anchors of a single-subpath path. */
export function anchorsOf(s) { return s.d.filter(c => c[0] !== "Z").map(c => [c[c.length - 2], c[c.length - 1]]); }
export const isClosed = s => s.t === "path" && s.d.length > 0 && s.d[s.d.length - 1][0] === "Z";

export function smoothAll(s) {
  if (s.d.filter(c => c[0] === "M").length !== 1) return false;
  let pts = anchorsOf(s);
  const closed = isClosed(s);
  if (closed && pts.length > 2 && Math.hypot(pts[0][0] - pts.at(-1)[0], pts[0][1] - pts.at(-1)[1]) < 1e-6) pts = pts.slice(0, -1);
  if (pts.length < 2) return false;
  s.d = smoothPath(pts, closed);
  return true;
}

export function straightenAll(s) {
  s.d = s.d.map(c => (c[0] === "Q" || c[0] === "C") ? ["L", c[c.length - 2], c[c.length - 1]] : c);
}

/* ---- solid outlines: Combine and Cut out ------------------------------------
   Each shape becomes the area it paints (fill, plus its stroke as an outline);
   polygon-clipping (vendor/, MIT) unions or subtracts those areas. Output is
   GeoJSON-style multipolygons: [polygon], polygon = [outer ring, ...holes]. */
const PC = () => {
  if (!globalThis.polygonClipping) throw new Error("vendor/polygon-clipping.umd.js is not loaded");
  return globalThis.polygonClipping;
};

/* A shape's sub-paths as point lists; curves and arcs sampled. */
export function subpaths(s, steps = 16) {
  if (s.t === "ell") {
    const a0 = s.a0 ?? 0, full = (s.a1 ?? TAU) - a0 >= 6.283, a1 = full ? a0 + 2 * Math.PI : s.a1;
    const n = Math.max(24, Math.ceil(Math.abs(a1 - a0) / TAU * 96)), pts = [];
    for (let i = 0; i <= (full ? n - 1 : n); i++) pts.push(ellPoint(s, a0 + (a1 - a0) * i / n));   /* 6.2832 overshoots a turn */
    return [{ pts, closed: full || !!s.chord }];
  }
  const out = [];
  let cur = [0, 0], sub = null;
  for (const c of s.d) {
    if (c[0] === "M") { sub = { pts: [[c[1], c[2]]], closed: false }; out.push(sub); cur = sub.pts[0]; continue; }
    if (c[0] === "Z") { if (sub) { sub.closed = true; cur = sub.pts[0]; } sub = null; continue; }
    if (!sub) { sub = { pts: [cur], closed: false }; out.push(sub); }
    if (c[0] === "L") sub.pts.push([c[1], c[2]]);
    else if (c[0] === "Q") for (let i = 1; i <= steps; i++) sub.pts.push(quad(cur, [c[1], c[2]], [c[3], c[4]], i / steps));
    else if (c[0] === "C") for (let i = 1; i <= steps; i++) sub.pts.push(bez(cur, [c[1], c[2]], [c[3], c[4]], [c[5], c[6]], i / steps));
    cur = sub.pts[sub.pts.length - 1];
  }
  return out.filter(p => p.pts.length > 1);
}

const signedArea = r => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };

/* Canvas fills sub-paths with the non-zero rule: rings wound like the largest add,
   rings wound the other way cut holes. */
function fillArea(rings) {
  if (rings.length === 1) return [[rings[0]]];
  const areas = rings.map(signedArea), big = areas.reduce((m, a, i) => Math.abs(a) > Math.abs(areas[m]) ? i : m, 0);
  const sign = Math.sign(areas[big]) || 1;
  const add = rings.filter((_, i) => Math.sign(areas[i]) !== -sign), cut = rings.filter((_, i) => Math.sign(areas[i]) === -sign);
  const base = PC().union(...add.map(r => [[r]]));
  return cut.length ? PC().difference(base, ...cut.map(r => [[r]])) : base;
}

function disc(c, rad) {
  const ring = [];
  for (let i = 0; i < 16; i++) { const t = i / 16 * TAU; ring.push([c[0] + Math.cos(t) * rad, c[1] + Math.sin(t) * rad]); }
  return [ring];
}

/* A stroke as an area: a band per segment, plus round (or bevelled) joins and ends. */
function strokeArea(subs, w, round) {
  const hw = w / 2, parts = [];
  for (const { pts: raw, closed } of subs) {
    const pts = raw.filter((p, i) => !i || Math.hypot(p[0] - raw[i - 1][0], p[1] - raw[i - 1][1]) > 1e-7);
    const shut = pts.length > 2 && Math.hypot(pts[0][0] - pts.at(-1)[0], pts[0][1] - pts.at(-1)[1]) < 1e-7;
    if (closed && pts.length > 2 && !shut) pts.push(pts[0]);
    if (pts.length < 2) { if (round && pts.length) parts.push(disc(pts[0], hw)); continue; }
    const dirs = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [p, q] = [pts[i], pts[i + 1]], l = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const n = [-(q[1] - p[1]) / l * hw, (q[0] - p[0]) / l * hw];
      dirs.push(n);
      const e = [(q[0] - p[0]) / l * hw * 0.02, (q[1] - p[1]) / l * hw * 0.02];   /* a hair longer, so pieces overlap */
      const back = closed || i > 0 ? 1 : 0, fwd = closed || i < pts.length - 2 ? 1 : 0;   /* free ends stay exact */
      const P = [p[0] - e[0] * back, p[1] - e[1] * back], Q = [q[0] + e[0] * fwd, q[1] + e[1] * fwd];
      parts.push([[[P[0] + n[0], P[1] + n[1]], [Q[0] + n[0], Q[1] + n[1]], [Q[0] - n[0], Q[1] - n[1]], [P[0] - n[0], P[1] - n[1]]]]);
    }
    for (let i = closed ? 0 : 1; i <= pts.length - 2; i++) {     /* vertex i joins segment i-1 to segment i */
      const a = dirs[(i - 1 + dirs.length) % dirs.length], b = dirs[i], v = pts[i];
      const turn = Math.abs(Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]));
      if (turn < 1e-4) continue;                                  /* straight on: the bands meet */
      if (round && turn > 0.3) { parts.push(disc(v, hw)); continue; }
      /* a wedge fills the notch the two bands leave on the outer side of the bend */
      const out = (a[0] * b[1] - a[1] * b[0]) < 0 ? 1 : -1;      /* the side the bend opens on */
      const c = [v[0] - out * (a[0] + b[0]) * 0.15, v[1] - out * (a[1] + b[1]) * 0.15];   /* apex sunk into the bands */
      parts.push([[c, [v[0] + out * a[0], v[1] + out * a[1]], [v[0] + out * b[0], v[1] + out * b[1]]]]);
    }
    if (round && !closed) parts.push(disc(pts[0], hw), disc(pts[pts.length - 1], hw));
  }
  return parts.length ? PC().union(...parts) : [];
}

/* Everything a shape paints. Eyes are left out: they change when a pet drowns. */
export function areaOf(s) {
  if (s.t === "eye") return [];
  const subs = subpaths(s), parts = [];
  if (s.fill) parts.push(fillArea(subs.map(p => p.pts)));
  if (s.stroke) parts.push(strokeArea(subs, s.w || 0.05, s.cap === "round"));
  return parts.length ? PC().union(...parts) : [];
}

export function combine(shapes) { const a = shapes.map(areaOf).filter(m => m.length); return a.length ? PC().union(...a) : []; }
export function cutOut(subject, cutters) {
  const base = areaOf(subject), cuts = cutters.map(areaOf).filter(m => m.length);
  return cuts.length ? PC().difference(base, ...cuts) : base;
}

/* A multipolygon as one path: a closed sub-path per ring, straight edges, thinned. */
export function areaToPath(mp, tol = 0.003) {
  const d = [];
  for (const poly of mp) {
    for (const ring of poly) {
      let pts = simplify(ring, tol);
      if (pts.length > 1 && Math.hypot(pts[0][0] - pts.at(-1)[0], pts[0][1] - pts.at(-1)[1]) < 1e-9) pts = pts.slice(0, -1);
      if (pts.length < 3 || Math.abs(signedArea(pts)) < 1e-6) continue;    /* specks */
      pts.forEach((p, i) => d.push([i ? "L" : "M", R5(p[0]), R5(p[1])]));
      d.push(["Z"]);
    }
  }
  return d.length ? d : null;
}

/* Fewer points on the straight-edged sub-paths: the tolerance grows until about a
   quarter of the points go. Curved sub-paths are left alone. False if nothing changed. */
export function simplifyPath(s) {
  const before = anchorCount(s);
  for (let tol = 0.002; tol < 0.08; tol *= 1.6) {
    const d = [];
    let sub = [], open = null, curved = false;
    const flush = closed => {
      if (!sub.length) return;
      let pts = curved ? null : simplify(closed ? [...sub, sub[0]] : sub, tol);
      if (pts && closed) pts = pts.slice(0, -1);
      if (!pts || pts.length < (closed ? 3 : 2)) d.push(...open);
      else pts.forEach((p, i) => d.push([i ? "L" : "M", R5(p[0]), R5(p[1])]));
      if (closed) d.push(["Z"]);
      sub = []; open = null; curved = false;
    };
    for (const c of s.d) {
      if (c[0] === "M") { flush(false); open = [c]; sub = [[c[1], c[2]]]; continue; }
      if (c[0] === "Z") { if (open) flush(true); else d.push(c); continue; }
      if (!open) { d.push(c); continue; }
      open.push(c);
      if (c[0] !== "L") curved = true;
      sub.push([c[c.length - 2], c[c.length - 1]]);
    }
    flush(false);
    const n = d.filter(c => c[0] !== "Z").length;
    if (n <= before * 0.75 || tol * 1.6 >= 0.08) { if (n >= before) return false; s.d = d; return true; }
  }
  return false;
}

export { R5 };
