/* Pet Studio preview strip: the pet as the page shows it, drawn by the page's own
   drawCritter / drawPortrait. A swimming glass, a close-up, the drowned pose and
   the Pets-tab icon at four hues. */

import { drawCritter, drawPortrait, drawHeadstone, drawCoin, drawGoldPile } from "../js/art.js";
import { hats, hatSvgFrom } from "../js/petdefs.js";
import { UNDERWATER_TINT, SWIM_RANGE, WALL_GAP_R } from "../js/config.js";
import { bounds } from "./geom.js";

const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export class Preview {
  constructor(cv, app) {
    this.cv = cv; this.ctx = cv.getContext("2d"); this.app = app;
    this.layer = document.createElement("canvas"); this.lctx = this.layer.getContext("2d");
    this.t0 = performance.now(); this.last = 0; this.svgs = new Map();
    new ResizeObserver(() => this.resize()).observe(cv.parentElement);
    this.resize();
    const loop = now => {
      if (!document.hidden && now - this.last > 32) { this.last = now; this.draw((now - this.t0) / 1000); }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
  resize() {
    const r = this.cv.parentElement.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1; this.w = r.width; this.h = r.height;
    for (const c of [this.cv, this.layer]) { c.width = Math.round(r.width * this.dpr); c.height = Math.round(r.height * this.dpr); }
  }

  /* One glass: water to `level`, the pet drawn by fn(ctx, surfaceY), tinted below the surface. */
  glass(x, y, w, h, level, fn, label) {
    const { ctx, lctx: L, dpr } = this;
    const surf = y + h * (1 - level), rad = Math.min(14, w * 0.12);
    ctx.save();
    ctx.beginPath(); ctx.roundRect(x, y, w, h, [rad * 0.5, rad * 0.5, rad, rad]); ctx.clip();
    ctx.fillStyle = css("--panel-2"); ctx.fillRect(x, y, w, h);
    const g = ctx.createLinearGradient(0, surf, 0, y + h);
    g.addColorStop(0, "rgba(96,178,232,.55)"); g.addColorStop(1, "rgba(40,120,190,.75)");
    ctx.fillStyle = g; ctx.fillRect(x, surf, w, y + h - surf);
    ctx.restore();

    L.setTransform(1, 0, 0, 1, 0, 0); L.clearRect(0, 0, this.layer.width, this.layer.height);
    L.setTransform(dpr, 0, 0, dpr, 0, 0);
    L.save(); L.beginPath(); L.rect(x - 40, 0, w + 80, y + h); L.clip();
    fn(L, surf);
    L.restore();
    if (UNDERWATER_TINT) {
      L.save(); L.beginPath(); L.rect(x, surf, w, y + h - surf); L.clip();
      L.globalCompositeOperation = "source-atop"; L.globalAlpha = UNDERWATER_TINT;
      L.fillStyle = "#3d8fc4"; L.fillRect(x, surf, w, y + h - surf);
      L.restore();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(this.layer, 0, 0); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.strokeStyle = css("--line-2"); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, [rad * 0.5, rad * 0.5, rad, rad]); ctx.stroke();
    this.label(label, x + w / 2, y + h + 14);
  }
  /* A hat: worn by a few pets in glasses, then the page's icons at their real sizes. */
  drawHat(t, top, gh) {
    const { ctx, w: W, app } = this, hatKey = app.kind;
    const kinds = [app.tryOn ? app.tryOn.kind : 0, 11, 1, 26].filter((k, i, a) => a.indexOf(k) === i).slice(0, 3);
    const gw = Math.min(104, gh * 0.7), r = Math.min(gw * 0.26, 30);
    let x = 14;
    kinds.forEach((k, i) => {
      this.glass(x, top, gw, gh, 0.5, (L, s) => {
        drawCritter(L, x + gw / 2, s + Math.sin(t * 2.1 + i) * r * 0.05, r, Math.sin(t * 1.3 + i) * 0.06, true, false, k, (app.hue + i * 97) % 360, hatKey);
      }, i ? "" : "on pets");
      x += gw + 12;
    });
    x += 14;
    const svg = hatSvgFrom(hats[hatKey], 26, 17, "x");
    let img = this.svgs.get(svg);
    if (!img) { img = new Image(); img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg.replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ')); this.svgs.clear(); this.svgs.set(svg, img); }
    const sizes = [[78, 51], [26, 17], [20, 13], [15, 10]], cy = top + gh / 2;
    ctx.fillStyle = this.css("--panel-2"); ctx.strokeStyle = this.css("--line");
    const boxW = sizes.reduce((a, s) => a + s[0] + 18, 6);
    if (x + boxW < W) {
      ctx.beginPath(); ctx.roundRect(x, top + 8, boxW, gh - 16, 12); ctx.fill(); ctx.stroke();
      let ix = x + 12;
      for (const [w, h] of sizes) { if (img.complete && img.naturalWidth) ctx.drawImage(img, ix, cy - h / 2, w, h); ix += w + 18; }
      this.label("page icons, real sizes", x + boxW / 2, top + gh + 14);
    }
  }
  /* The headstone in drained glasses and as the Pets-tab mark; the coin in the bank's
     pile and as the small icons. */
  drawProp(top, gh) {
    const { ctx, w: W, app } = this;
    let x = 14;
    if (app.kind === "grave") {
      const gw = Math.min(104, gh * 0.7), r = Math.min(gw * 0.26, 30);
      [0, 120, 240].forEach((dh, i) => {
        this.glass(x, top, gw, gh, 0, L => drawHeadstone(L, x + gw / 2, top + gh - 4, r, (app.hue + dh) % 360), i ? "" : "drained glasses");
        x += gw + 12;
      });
      x += 14;
      const size = Math.min(66, gh - 8), iy = top + (gh - size) / 2;
      ctx.fillStyle = this.css("--panel-2"); ctx.strokeStyle = this.css("--line");
      ctx.beginPath(); ctx.roundRect(x, iy, size, size, 12); ctx.fill(); ctx.stroke();
      ctx.save(); ctx.translate(x, iy); ctx.scale(size / 60, size / 60); drawHeadstone(ctx, 30, 50, 26, 210); ctx.restore();
      this.label("Pets tab", x + size / 2, top + gh + 14);
      return;
    }
    const pile = this.pile || (this.pile = document.createElement("canvas"));
    for (const n of [3, 24, 160]) {
      const pw = Math.min(200, (gh - 6) * 1.6), ph = pw * 150 / 240;
      if (x + pw > W - 8) break;
      pile.width = 480; pile.height = 300;
      const pc = pile.getContext("2d"); pc.setTransform(2, 0, 0, 2, 0, 0);
      drawGoldPile(pc, 240, 150, n);
      ctx.drawImage(pile, x, top + (gh - ph) / 2, pw, ph);
      this.label(n + " tokens", x + pw / 2, top + gh + 14);
      x += pw + 14;
    }
    const cy = top + gh / 2;
    for (const d of [56, 16, 11]) {
      if (x + d > W - 8) break;
      drawCoin(ctx, x + d / 2, cy, d);
      x += d + 16;
    }
    this.label("icons", x - 40, top + gh + 14);
  }
  css(n) { return css(n); }

  label(t, x, y) {
    const ctx = this.ctx;
    ctx.fillStyle = css("--muted"); ctx.font = "11px Segoe UI, system-ui, sans-serif"; ctx.textAlign = "center";
    ctx.fillText(t, x, y); ctx.textAlign = "left";
  }

  draw(t) {
    const { ctx, dpr, w: W, h: H, app } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = css("--panel"); ctx.fillRect(0, 0, W, H);
    const k = app.kind, hue = app.hue, crown = app.crown, top = 10, gh = H - 34;
    if (k == null) return;
    if (app.isProp) { this.drawProp(top, gh); return; }
    if (app.isHat) { this.drawHat(t, top, gh); return; }

    /* swimming, at glass size */
    const gw = Math.min(110, gh * 0.72), r1 = Math.min(gw * 0.26, 30);
    let x = 14;
    /* the page's swim rule: the range set for this pet, narrowed by its reach */
    const sway = Math.sin(t * 0.55), face = Math.cos(t * 0.55) >= 0 ? -1 : 1;
    const b = app.def ? bounds(app.def.swim.filter(q => q.show !== "dead")) : null, reach = b ? Math.max(-b.x0, b.x1) * r1 : r1;
    const amp = Math.max(0, Math.min(gw * SWIM_RANGE * app.range, gw / 2 - reach - r1 * WALL_GAP_R));
    this.glass(x, top, gw, gh, 0.58, (L, s) => {
      const px = x + gw / 2 + sway * amp, py = s + Math.sin(t * 2.1) * r1 * 0.05;
      L.save(); L.translate(px, py); L.scale(face, 1);
      drawCritter(L, 0, 0, r1, Math.sin(t * 1.3) * 0.06, crown, false, k, hue, false);
      L.restore();
    }, "in the glass");
    x += gw + 18;

    /* close-up */
    const cw = Math.min(170, gh * 1.15), r2 = Math.min(gh * 0.26, 34);
    this.glass(x, top, cw, gh, 0.5, (L, s) => {
      drawCritter(L, x + cw / 2, s + Math.sin(t * 2.1) * r2 * 0.04, r2, Math.sin(t * 1.3) * 0.05, crown, false, k, hue, false);
    }, "close-up" + (crown ? ", crowned" : ""));
    x += cw + 18;

    /* drowned: upside down on the bottom, as the glass rests it */
    this.glass(x, top, gw, gh, 0.7, (L) => {
      drawCritter(L, x + gw / 2, top + gh - 4 - r1 * 1.62, r1, Math.PI, false, true, k, hue, false);
    }, "drowned");
    x += gw + 26;

    /* Pets-tab icons */
    const hues = [hue, (hue + 90) % 360, (hue + 180) % 360, (hue + 270) % 360];
    const size = Math.min(66, (gh - 8) / 1.05), iy = top + (gh - size) / 2;
    hues.forEach((h, i) => {
      const ix = x + i * (size + 8);
      if (ix + size > W - 8) return;
      ctx.fillStyle = css("--panel-2"); ctx.strokeStyle = css("--line");
      ctx.beginPath(); ctx.roundRect(ix, iy, size, size, 12); ctx.fill(); ctx.stroke();
      const s = size / 60;
      ctx.save(); ctx.translate(ix, iy); ctx.scale(s, s);
      drawPortrait(ctx, 30, 42, 20, k, h);
      ctx.restore();
    });
    this.label("Pets tab, four hues", x + Math.min(4, Math.floor((W - 8 - x) / (size + 8))) * (size + 8) / 2, top + gh + 14);
  }
}
