/* Pet, hat, headstone and gold-pile drawing. Everything is drawn from shapes (petdefs.js:
   pen1art.js, pen2art.js, propart.js, then pets.json); only the gold pile's layout is code. */

import * as C from "./config.js";
import { defs, hats, drawShapes, drawHat, hatSvgFrom, medalSpot, bodyBox } from "./petdefs.js";
import { todayKey, parseKey } from "./util.js";
import { finishFn, finishWrap } from "./cosmetics.js";

/* The holiday around a day, if any: HOLIDAY_SPAN days either side of its date. */
let seen = { key: "", h: null };                 /* asked every frame: once per day is enough */
export function holidayOn(key = todayKey()) {
  if (key === seen.key) return seen.h;
  const d = parseKey(key);
  let found = null;
  if (d) {
    for (const h of C.HOLIDAY_HATS) {
      for (const y of [d.getFullYear() - 1, d.getFullYear(), d.getFullYear() + 1]) {
        if (Math.abs(Math.round((d - new Date(y, h.m - 1, h.d)) / 864e5)) <= (h.span ?? C.HOLIDAY_SPAN)) found = h;
      }
    }
  }
  seen = { key, h: found };
  return found;
}
/* Which hat is worn: a key passed straight in (the studio), else the crown or the
   jester, or the holiday's own in their place. */
export function hatKeyFor(jester, key) {
  if (typeof jester === "string") return jester;
  const h = holidayOn(key);
  return h && hats[jester ? h.jester : h.crown] ? (jester ? h.jester : h.crown) : (jester ? "jester" : "crown");
}

/* The page's hat icons, from the same drawings the pets wear (propart.js or pets.json). */
function crownSvg(w, h, cls) { return hatSvgFrom(hats[hatKeyFor(false)], w, h, cls); }
/* Worn instead of the crown when you led the day but are still under your own goal. */
function jesterSvg(w, h, cls) { return hatSvgFrom(hats[hatKeyFor(true)], w, h, cls); }
function hatSvg(w, h, cls, underGoal) {
  /* Leading is not the same as winning: the crown needs the goal actually met. */
  return underGoal ? jesterSvg(w, h, cls) : crownSvg(w, h, cls);
}

function critterEye(ctx, x, y, r, dead) {
  var e;
  if (dead) {
    e = r * 0.11;
    ctx.beginPath();
    ctx.moveTo(x - e, y - e); ctx.lineTo(x + e, y + e);
    ctx.moveTo(x + e, y - e); ctx.lineTo(x - e, y + e);
    ctx.strokeStyle = "#2a2118";
    ctx.lineWidth = Math.max(1, r * 0.07);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(x, y, r * 0.08, 0, 6.2832);
    ctx.fillStyle = "#2a2118";
    ctx.fill();
  }
}

/* jester: true / false for the day's hat, or a hat key to wear that one. */
function critterCrown(ctx, cx, cy, r, jester) {
  drawHat(ctx, hats[hatKeyFor(jester)], cx, cy, r);
}

/* finish: an optional cosmetic finish key (cosmetics.js) for the pet's own colours. */
function drawCritter(ctx, x, y, r, ang, crowned, dead, kind, hue, jester, finish, medal) {
  /* Every pet is drawn from shapes (petdefs.js); an unknown kind draws as the duck. */
  var def = defs[kind] || defs[0];
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  if (finish) { ctx.save(); finishWrap(finish, ctx, r, hue); }
  drawShapes(ctx, def.swim, r, hue, def.pal, dead, finishFn(finish));
  if (finish) ctx.restore();
  if (medal && !dead) { var ms = medalSpot(def); wearAt(ctx, r * ms[0], r * ms[1], def.medalRot, function () { drawHat(ctx, hats.medal, 0, 0, r * (def.medalScale || 1)); }); }
  if (crowned) wearAt(ctx, r * def.crown[0], r * def.crown[1], def.crownRot, function () { critterCrown(ctx, 0, 0, r * (def.crownScale || 1), jester); });
  ctx.restore();
}

/* Something a pet wears, at x, y in its own frame, tilted by deg (clockwise). */
function wearAt(ctx, x, y, deg, draw) {
  ctx.save();
  ctx.translate(x, y);
  if (deg) ctx.rotate(deg * Math.PI / 180);
  draw();
  ctx.restore();
}

/* The day-win medal on its own, disc centred on x, y (icons). */
function drawMedal(ctx, x, y, r) {
  drawHat(ctx, hats.medal, x, y, r);
}

function drawHeadstone(ctx, x, y, r, hue) {
  drawHat(ctx, hats.grave, x, y, r, hue);
}

/* One token, d across, centred on x, y. */
function drawCoin(ctx, x, y, d) {
  drawHat(ctx, hats.coin, x, y, d);
}

/* The Pets-tab icon: a drawn pet's portrait, or its swim drawing. Centre-locked: the box
   the drawing really covers is centred on the frame's centre (x, 0.6 r above y), wherever
   it was drawn (at the surface, deep, on the floor or flying above the water), and one
   bigger than the frame (2.8 r wide, 2.6 r tall) is shrunk to fit. fresh: the Studio,
   measuring as it draws. */
const portraitCache = new WeakMap();
function drawPortrait(ctx, x, y, r, kind, hue, fresh) {
  var def = defs[kind] || defs[0], shapes = def.portrait || def.swim;
  var holder = portraitCache.get(shapes);
  if (!holder) { holder = { swim: shapes }; portraitCache.set(shapes, holder); }
  var b = bodyBox(holder, false, fresh);
  var k = Math.min(1, 2.8 / Math.max(0.01, b.x1 - b.x0), 2.6 / Math.max(0.01, b.bottom - b.top));
  ctx.save();
  ctx.translate(x - (b.x0 + b.x1) / 2 * r * k, y - 0.6 * r - (b.top + b.bottom) / 2 * r * k);
  ctx.scale(k, k);
  drawShapes(ctx, shapes, r, hue, def.pal, false);
  ctx.restore();
}

function drawGoldPile(ctx, W, H, n) {
  /* A heap that grows with the balance: a rounded mound of coins, each row
     narrower than the one below along a half-ellipse, so it piles up rather
     than stacking into a pyramid. Visual growth tops out once the mound fills
     the dish; the number carries on from there. Jitter is seeded on the count
     so the same balance always draws the same heap. */
  var CAP = 160, shown = n > CAP ? CAP : n, cw = 15, ch = 6.5, cx = W / 2, base = H - 21;
  var sp = cw * 0.80, step = ch * 1.02, R = 1, rows, cap, wmax, hw, i, j, k, x, y, left;
  var seed = n * 7 + 3;
  function jit() { seed = (seed * 1103515245 + 12345) % 2147483647; return (seed / 2147483647) - 0.5; }

  ctx.clearRect(0, 0, W, H);
  ctx.save(); ctx.translate(cx, H - 12); ctx.scale(1, 8.5 / (W * 0.42));   /* the dish, whole */
  ctx.beginPath(); ctx.arc(0, 0, W * 0.42, 0, 6.2832); ctx.restore();
  ctx.fillStyle = "#e9dcb8"; ctx.fill();

  if (shown <= 0) {
    ctx.fillStyle = "#c2ad78";
    ctx.font = "12px Segoe UI, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("nothing yet", cx, base - 4);
    return;
  }

  for (;;) {                                  /* smallest mound that holds them */
    wmax = R * sp * 0.47;
    rows = []; cap = 0;
    for (i = 0; i < R; i++) {
      hw = wmax * Math.sqrt(Math.max(0, 1 - (i / R) * (i / R)));
      k = Math.max(1, Math.floor(2 * hw / sp) + 1);
      rows.push(k); cap += k;
    }
    if (cap >= shown || R > 60) { break; }
    R++;
  }

  left = shown;
  for (i = 0; i < rows.length && left > 0; i++) {
    k = rows[i] < left ? rows[i] : left;
    left -= k;
    y = base - i * step;
    for (j = 0; j < k; j++) {
      x = cx + (j - (k - 1) / 2) * sp + jit() * 3.2;
      ctx.save(); ctx.translate(x, y + jit() * 2.0); ctx.scale(1, ch / cw);   /* lying flat */
      ctx.beginPath(); ctx.arc(0, 1.6 * cw / ch, cw / 2, 0, 6.2832);
      ctx.fillStyle = "#a8780f"; ctx.fill();                                /* its edge */
      drawCoin(ctx, 0, 0, cw);
      if ((j * 3 + i) % 4 === 0) {                                          /* a few catch the light */
        ctx.beginPath(); ctx.arc(0, 0, cw / 2, 0, 6.2832);
        ctx.fillStyle = "rgba(255,240,170,0.3)"; ctx.fill();
      }
      ctx.restore();
    }
  }
  ctx.fillStyle = "rgba(255,255,255,0.85)";                                 /* a glint */
  ctx.beginPath(); ctx.arc(cx - 3, base - (i - 1) * step - 2, 1.7, 0, 6.2832); ctx.fill();
}

export { jesterSvg, hatSvg, crownSvg, critterEye, critterCrown, drawCritter, drawHeadstone, drawPortrait, drawGoldPile, drawCoin, drawMedal, wearAt };
