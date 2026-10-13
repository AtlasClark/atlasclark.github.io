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

export { R5 };
