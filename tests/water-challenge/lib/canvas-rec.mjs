/* A canvas stand-in that records every fill and stroke as a flat list of points
   (curves and arcs sampled), with its colour and width. Two drawings that record
   the same are the same picture. */

const N = 16;

export class FlatRec {
  constructor() {
    this.m = [1, 0, 0, 1, 0, 0]; this.stack = []; this.subs = []; this.out = [];
    this.fillStyle = "#000"; this.strokeStyle = "#000"; this.lineWidth = 1; this.lineCap = "butt"; this.lineJoin = "miter";
  }
  save() { this.stack.push({ m: this.m.slice(), fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth, lineCap: this.lineCap, lineJoin: this.lineJoin }); }
  restore() { const s = this.stack.pop(); if (s) Object.assign(this, s); }
  translate(x, y) { const m = this.m; m[4] += m[0] * x + m[2] * y; m[5] += m[1] * x + m[3] * y; }
  scale(x, y) { const m = this.m; m[0] *= x; m[1] *= x; m[2] *= y; m[3] *= y; }
  rotate(a) {
    const m = this.m, c = Math.cos(a), s = Math.sin(a), [a0, b0, c0, d0] = m;
    m[0] = a0 * c + c0 * s; m[1] = b0 * c + d0 * s; m[2] = c0 * c - a0 * s; m[3] = d0 * c - b0 * s;
  }
  pt(x, y) { const m = this.m; return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; }
  get cur() { return this.subs[this.subs.length - 1]; }
  get last() { const c = this.cur; return c && c[c.length - 1]; }
  beginPath() { this.subs = []; }
  moveTo(x, y) { this.subs.push([this.pt(x, y)]); }
  lineTo(x, y) { if (!this.cur) this.subs.push([]); this.cur.push(this.pt(x, y)); }
  quadraticCurveTo(a, b, x, y) {
    const p0 = this.last, c = this.pt(a, b), p = this.pt(x, y);
    for (let i = 1; i <= N; i++) {
      const t = i / N, u = 1 - t;
      this.cur.push([u * u * p0[0] + 2 * u * t * c[0] + t * t * p[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p[1]]);
    }
  }
  bezierCurveTo(a, b, c, d, x, y) {
    const p0 = this.last, c1 = this.pt(a, b), c2 = this.pt(c, d), p = this.pt(x, y);
    for (let i = 1; i <= N; i++) {
      const t = i / N, u = 1 - t, A = u * u * u, B = 3 * u * u * t, C = 3 * u * t * t, D = t * t * t;
      this.cur.push([A * p0[0] + B * c1[0] + C * c2[0] + D * p[0], A * p0[1] + B * c1[1] + C * c2[1] + D * p[1]]);
    }
  }
  ellipse(x, y, rx, ry, rot, a0, a1) {
    const pts = [];
    for (let i = 0; i <= N; i++) {
      const t = a0 + (a1 - a0) * i / N, ex = rx * Math.cos(t), ey = ry * Math.sin(t);
      pts.push(this.pt(x + ex * Math.cos(rot) - ey * Math.sin(rot), y + ex * Math.sin(rot) + ey * Math.cos(rot)));
    }
    if (this.cur) this.cur.push(...pts); else this.subs.push(pts);
  }
  arc(x, y, r, a0, a1) { this.ellipse(x, y, r, r, 0, a0, a1); }
  closePath() { const c = this.cur; if (c && c.length) c.push(c[0].slice()); }
  fillRect(x, y, w, h) {
    const keep = this.subs;
    this.subs = [[this.pt(x, y), this.pt(x + w, y), this.pt(x + w, y + h), this.pt(x, y + h), this.pt(x, y)]];
    this.fill();
    this.subs = keep;
  }
  fill() { this.out.push({ op: "fill", style: this.fillStyle, pts: this.subs.flat() }); }
  stroke() {
    const m = this.m;
    this.out.push({ op: "stroke", style: this.strokeStyle, w: this.lineWidth * Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])),
                    cap: this.lineCap, pts: this.subs.flat() });
  }
  clearRect() { }
  fillText() { }
}

/* "" when the two recordings match, else what differs first. */
export function sameDrawing(a, b, tol) {
  if (a.length !== b.length) return "mark count " + a.length + " vs " + b.length;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    if (x.op !== y.op || x.style !== y.style) return "mark " + i + ": " + x.op + " " + x.style + " vs " + y.op + " " + y.style;
    if (x.op === "stroke" && (Math.abs(x.w - y.w) > tol || x.cap !== y.cap)) return "mark " + i + ": width/cap " + x.w + x.cap + " vs " + y.w + y.cap;
    if (x.pts.length !== y.pts.length) return "mark " + i + ": points " + x.pts.length + " vs " + y.pts.length;
    for (let j = 0; j < x.pts.length; j++) {
      if (Math.abs(x.pts[j][0] - y.pts[j][0]) > tol || Math.abs(x.pts[j][1] - y.pts[j][1]) > tol)
        return "mark " + i + " point " + j + ": " + x.pts[j] + " vs " + y.pts[j];
    }
  }
  return "";
}
