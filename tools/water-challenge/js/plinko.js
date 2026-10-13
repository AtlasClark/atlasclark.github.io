/* The Plinko board. Draws pegs and rarity slots and animates any number of balls,
   each along a given left/right path. A ball can start part-way through (offsetMs),
   which is how a drop made on another machine is joined late. Timing is wall-clock,
   so a hidden tab catches up instead of falling behind. */

import * as C from "./config.js";

const SLOT_LABEL = ["Com", "Unc", "Rare", "Epic", "???"];
const FALL_IN = 0.3, INTO_SLOT = 0.38;                 /* seconds before the first peg / after the last */

export class PlinkoBoard {
  constructor(canvas, onLand) {
    this.cv = canvas;
    this.onLand = onLand;
    this.balls = [];
    this.hits = [];       /* peg flashes */
    this.wins = [];       /* labels over slots */
    this.running = false;
    this.resize(canvas.parentElement.clientWidth || 360);
  }

  resize(width) {
    const w = Math.max(260, Math.min(460, Math.floor(width)));
    const h = Math.round(w * 1.02), dpr = Math.min(window.devicePixelRatio || 1, 3);
    const rows = C.PLINKO_ROWS, n = rows + 1;
    this.w = w; this.h = h;
    this.s = w / (n + 0.4);                              /* slot and peg spacing */
    this.cx = w / 2;
    this.top = 46;
    this.slotH = 46;
    this.rowH = (h - this.top - this.slotH - 26) / rows;
    this.pegR = Math.max(2.5, this.s * 0.09);
    this.ballR = Math.max(5, this.s * 0.2);
    this.cv.width = Math.round(w * dpr); this.cv.height = Math.round(h * dpr);
    this.cv.style.width = w + "px"; this.cv.style.height = h + "px";
    this.ctx = this.cv.getContext("2d");
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw(performance.now());
  }

  /* Where a ball sits on row i (before bouncing off its peg), given rights so far. */
  pegX(i, rights) { return this.cx + (rights - i / 2) * this.s; }
  pegY(i) { return this.top + i * this.rowH; }
  slotX(j) { return this.cx + (j - C.PLINKO_ROWS / 2) * this.s; }
  get slotTop() { return this.h - this.slotH - 8; }

  duration() { return FALL_IN + C.PLINKO_ROWS * C.PLINKO_ROW_SECS + INTO_SLOT; }

  /* ev: { id, name, color, path:[0|1...], slot, bin, kind, label } */
  drop(ev, offsetMs = 0) {
    this.balls.push({ ev, t0: performance.now() - Math.max(0, offsetMs), hit: -1, landed: false });
    this.start();
  }

  /* Events whose ball is still falling. */
  inFlight() { return this.balls.filter(b => !b.landed).map(b => b.ev); }

  start() {
    if (this.running) return;
    this.running = true;
    const loop = now => {
      this.draw(now);
      if (this.balls.length || this.hits.length || this.wins.length) requestAnimationFrame(loop);
      else this.running = false;
    };
    requestAnimationFrame(loop);
  }

  /* Ball position at t seconds into its drop. */
  pos(ball, t) {
    const path = ball.ev.path, rows = path.length, R = this.ballR;
    if (t < FALL_IN) {
      const u = t / FALL_IN;
      return { x: this.cx, y: this.top - this.rowH * 1.1 + (this.rowH * 1.1 - R - this.pegR) * u * u, row: -1 };
    }
    let rights = 0;
    const tr = t - FALL_IN, i = Math.floor(tr / C.PLINKO_ROW_SECS);
    for (let k = 0; k < Math.min(i, rows); k++) rights += path[k];
    if (i < rows) {
      const u = (tr - i * C.PLINKO_ROW_SECS) / C.PLINKO_ROW_SECS;
      const x0 = this.pegX(i, rights), x1 = this.pegX(i + 1, rights + path[i]);
      const y0 = this.pegY(i) - R - this.pegR, y1 = this.pegY(i + 1) - R - this.pegR;
      /* off the peg: a small hop sideways, then down to the next row */
      return { x: x0 + (x1 - x0) * u, y: y0 + (y1 - y0) * u * u - this.rowH * 0.32 * Math.sin(Math.PI * u), row: i };
    }
    const u = Math.min(1, (tr - rows * C.PLINKO_ROW_SECS) / INTO_SLOT);
    const y0 = this.pegY(rows) - R - this.pegR, y1 = this.slotTop + this.slotH - R - 4;
    return { x: this.slotX(ball.ev.slot), y: y0 + (y1 - y0) * u * u, row: rows, done: u >= 1 };
  }

  colors() {
    const cs = getComputedStyle(this.cv);
    return { r: [0, 1, 2, 3, 4].map(i => cs.getPropertyValue("--r" + i).trim() || "#cfe0ec"),
             peg: cs.getPropertyValue("--faint").trim() || "#7793a8",
             ink: cs.getPropertyValue("--ink-2").trim() || "#264f6d",
             panel: cs.getPropertyValue("--solid-2").trim() || "#f1f6f9" };
  }

  draw(now) {
    const ctx = this.ctx, col = this.colors(), rows = C.PLINKO_ROWS;
    ctx.clearRect(0, 0, this.w, this.h);

    /* slots */
    for (let j = 0; j <= rows; j++) {
      const bin = C.PLINKO_SLOTS[j], x = this.slotX(j) - this.s / 2 + 1.5, w = this.s - 3, y = this.slotTop;
      const glow = this.wins.find(z => z.slot === j);
      ctx.fillStyle = col.r[bin];
      ctx.globalAlpha = glow ? 1 : 0.78;
      roundRect(ctx, x, y, w, this.slotH, 7);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#17324d";
      ctx.font = "800 " + Math.max(8, Math.min(11, this.s * 0.3)) + "px 'Segoe UI', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(SLOT_LABEL[bin], x + w / 2, y + this.slotH / 2 + 4);
    }

    /* pegs */
    this.hits = this.hits.filter(hh => now - hh.at < 260);
    for (let i = 0; i < rows; i++) {
      for (let m = 0; m <= i; m++) {
        const x = this.pegX(i, m), y = this.pegY(i), lit = this.hits.find(hh => hh.i === i && hh.m === m);
        ctx.beginPath();
        ctx.arc(x, y, this.pegR * (lit ? 1.6 : 1), 0, 6.2832);
        ctx.fillStyle = lit ? lit.color : col.peg;
        ctx.fill();
      }
    }

    /* balls */
    const keep = [];
    for (const b of this.balls) {
      const t = (now - b.t0) / 1000, p = this.pos(b, t);
      if (p.row >= 0 && p.row < rows && p.row !== b.hit) {
        let rights = 0;
        for (let k = 0; k < p.row; k++) rights += b.ev.path[k];
        this.hits.push({ i: p.row, m: rights, at: now, color: b.ev.color });
        b.hit = p.row;
      }
      ctx.beginPath();
      ctx.arc(p.x, p.y, this.ballR, 0, 6.2832);
      ctx.fillStyle = b.ev.color || "#60a5fa";
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "rgba(255,255,255,.9)";
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(p.x - this.ballR * 0.3, p.y - this.ballR * 0.35, this.ballR * 0.3, 0, 6.2832);
      ctx.fillStyle = "rgba(255,255,255,.7)";
      ctx.fill();
      ctx.fillStyle = col.ink;
      ctx.font = "700 10px 'Segoe UI', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(b.ev.name, p.x, p.y - this.ballR - 4);
      if (p.done && !b.landed) {
        b.landed = true;
        this.wins.push({ slot: b.ev.slot, at: now, text: b.ev.label || "", color: b.ev.color });
        if (this.onLand) this.onLand(b.ev);
      }
      if (!b.landed || now - b.t0 < this.duration() * 1000 + 400) keep.push(b);
    }
    this.balls = keep;

    /* what each landing won, floating up out of its slot */
    this.wins = this.wins.filter(z => now - z.at < 2600);
    for (const z of this.wins) {
      const u = (now - z.at) / 2600, x = this.slotX(z.slot), y = this.slotTop - 8 - u * 34;
      ctx.globalAlpha = Math.min(1, (1 - u) * 2);
      ctx.font = "800 12px 'Segoe UI', sans-serif";
      ctx.textAlign = "center";
      const tw = ctx.measureText(z.text).width + 14;
      ctx.fillStyle = z.color || "#1688d4";
      roundRect(ctx, Math.max(2, Math.min(this.w - tw - 2, x - tw / 2)), y - 15, tw, 20, 10);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.fillText(z.text, Math.max(2 + tw / 2, Math.min(this.w - tw / 2 - 2, x)), y - 1);
      ctx.globalAlpha = 1;
    }
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
