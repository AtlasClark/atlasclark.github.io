/* Pet, crown and gold-pile drawing. Every pet is drawn from shapes (petdefs.js:
   pen1art.js, pen2art.js, then pets.json); the hats, the headstone and the gold pile
   are still the R55 code drawings. */

import { hsl } from "./util.js";
import { defs, hats, drawShapes, drawHat, hatSvgFrom } from "./petdefs.js";

/* tricolour, so it never reads as a crown with balls on it */
var JESTER_L = "#d9434e";
var JESTER_C = "#4f8fd9";
var JESTER_R = "#4aa86b";
function jesterSvg(w, h, cls) {
  if (hats.jester) return hatSvgFrom(hats.jester, w, h, cls);
  /* Worn instead of the crown when you were the only one who turned up. Same
     viewBox as the crown so it drops into every place the crown goes. */
  return '<svg class="' + cls + '" width="' + w + '" height="' + h + '" ' +
         'viewBox="0 0 26 17" aria-hidden="true">' +
         /* Three lobes that rise off the band, hook over, and hang back down
            with a bell on each drooping end. Centre drawn first so it sits
            behind; the band goes on last to cover every base. */
         '<path d="M12.6 14Q12 4.6 17.4 4" stroke="' + JESTER_C + '" stroke-width="4.6" ' +
         'fill="none" stroke-linecap="round"/>' +
         '<path d="M11.4 14Q4 6.2 2.6 9.8" stroke="' + JESTER_L + '" stroke-width="4.6" ' +
         'fill="none" stroke-linecap="round"/>' +
         '<path d="M14.6 14Q22 6.2 23.4 9.8" stroke="' + JESTER_R + '" stroke-width="4.6" ' +
         'fill="none" stroke-linecap="round"/>' +
         '<circle cx="17.4" cy="4" r="2.3" fill="#f7d038" stroke="#c08f1c" stroke-width=".9"/>' +
         '<circle cx="2.6" cy="9.8" r="2.3" fill="#f7d038" stroke="#c08f1c" stroke-width=".9"/>' +
         '<circle cx="23.4" cy="9.8" r="2.3" fill="#f7d038" stroke="#c08f1c" stroke-width=".9"/>' +
         '<rect x="4.2" y="13.4" width="17.6" height="3" rx="1.4" ' +
         'fill="#f0b429" stroke="#c08f1c" stroke-width="1.1"/></svg>';
}
function hatSvg(w, h, cls, underGoal) {
  /* Leading is not the same as winning. Out in front but still short of your
     own goal is a hollow sort of lead, so it earns the hat rather than the
     crown. The crown needs the goal actually met. */
  return underGoal ? jesterSvg(w, h, cls) : crownSvg(w, h, cls);
}
function crownSvg(w, h, cls) {
  if (hats.crown) return hatSvgFrom(hats.crown, w, h, cls);
  /* Inline SVG: lucide-react is not an option here and IE renders no emoji
     crown worth looking at, but SVG 1.1 paths are solid. */
  /* Silver: the crown marks the day's leader, which is a leaderboard result.
     Gold stays reserved for reaching your own goal. */
  return '<svg class="' + cls + '" width="' + w + '" height="' + h + '" ' +
         'viewBox="0 0 26 17" aria-hidden="true">' +
         '<path d="M2.4 14.6h21.2l-1.5-9.9-5.4 3.7L13 1.8 9.3 8.4 3.9 4.7z" ' +
         'fill="#ccd6de" stroke="#7f8f9c" stroke-width="1.2" ' +
         'stroke-linejoin="round" stroke-linecap="round"/>' +
         '<rect x="2.4" y="14.6" width="21.2" height="1.9" rx=".9" ' +
         'fill="#b8c4ce" stroke="#7f8f9c" stroke-width="1.1"/></svg>';
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

function critterCrown(ctx, cx, cy, r, jester) {
  var cw = r * 0.52, ch = r * 0.36, i, hat = hats[jester ? "jester" : "crown"];
  if (hat) { drawHat(ctx, hat, cx, cy, r); return; }
  if (jester) {
    /* three floppy points and their bells */
    /* Same hooked lobes as the svg, in canvas units. Centre first so it sits
       behind the two side hooks. */
    var lobes = [
      { sx: -0.016, cxo: -0.032, cyo: -0.382, ex:  0.135, ey: -0.404, col: JESTER_C },
      { sx: -0.048, cxo: -0.289, cyo: -0.334, ex: -0.334, ey: -0.218, col: JESTER_L },
      { sx:  0.048, cxo:  0.289, cyo: -0.334, ex:  0.334, ey: -0.218, col: JESTER_R }
    ];
    ctx.lineCap = "round";
    for (i = 0; i < lobes.length; i++) {
      ctx.beginPath();
      ctx.moveTo(cx + r * lobes[i].sx, cy);
      ctx.quadraticCurveTo(cx + r * lobes[i].cxo, cy + r * lobes[i].cyo,
                           cx + r * lobes[i].ex,  cy + r * lobes[i].ey);
      ctx.strokeStyle = lobes[i].col;
      ctx.lineWidth = Math.max(2, r * 0.140);
      ctx.stroke();
    }
    for (i = 0; i < lobes.length; i++) {          /* the bells, on top */
      ctx.beginPath();
      ctx.arc(cx + r * lobes[i].ex, cy + r * lobes[i].ey, r * 0.073, 0, 6.2832);
      ctx.fillStyle = "#f7d038";
      ctx.fill();
    }
    ctx.lineCap = "butt";
    ctx.beginPath();                              /* band last, over the bases */
    ctx.moveTo(cx - r * 0.28, cy);
    ctx.lineTo(cx + r * 0.28, cy);
    ctx.strokeStyle = "#f0b429";
    ctx.lineWidth = Math.max(2, r * 0.095);
    ctx.stroke();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(cx - cw / 2, cy);
  ctx.lineTo(cx - cw / 2, cy - ch * 0.55);
  ctx.lineTo(cx - cw / 6, cy - ch * 0.30);
  ctx.lineTo(cx,          cy - ch);
  ctx.lineTo(cx + cw / 6, cy - ch * 0.30);
  ctx.lineTo(cx + cw / 2, cy - ch * 0.55);
  ctx.lineTo(cx + cw / 2, cy);
  ctx.closePath();
  ctx.fillStyle = "#ccd6de";
  ctx.fill();
  ctx.strokeStyle = "#7f8f9c";
  ctx.lineWidth = Math.max(1, r * 0.05);
  ctx.stroke();
}

function drawCritter(ctx, x, y, r, ang, crowned, dead, kind, hue, jester) {
  /* Every pet is drawn from shapes (petdefs.js); an unknown kind draws as the duck. */
  var def = defs[kind] || defs[0];
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  drawShapes(ctx, def.swim, r, hue, def.pal, dead);
  if (crowned) critterCrown(ctx, r * def.crown[0], r * def.crown[1], r, jester);
  ctx.restore();
}

function drawHeadstone(ctx, x, y, r, hue) {
  var w = r * 0.82, h = r * 0.92, tint = hsl(hue, 30, 62);

  ctx.save();
  ctx.translate(x, y);

  ctx.beginPath();                                  /* mound */
  ctx.arc(0, 0, w * 0.86, 3.1416, 6.2832);
  ctx.closePath();
  ctx.fillStyle = "rgba(120,140,150,0.45)";
  ctx.fill();

  ctx.beginPath();                                  /* slab, round-topped */
  ctx.moveTo(-w / 2, 0);
  ctx.lineTo(-w / 2, -h * 0.52);
  ctx.quadraticCurveTo(-w / 2, -h, 0, -h);
  ctx.quadraticCurveTo(w / 2, -h, w / 2, -h * 0.52);
  ctx.lineTo(w / 2, 0);
  ctx.closePath();
  ctx.fillStyle = tint;
  ctx.fill();
  ctx.strokeStyle = hsl(hue, 25, 44);
  ctx.lineWidth = Math.max(1, r * 0.05);
  ctx.stroke();

  ctx.beginPath();                                  /* cross */
  ctx.moveTo(0, -h * 0.76); ctx.lineTo(0, -h * 0.30);
  ctx.moveTo(-w * 0.17, -h * 0.60); ctx.lineTo(w * 0.17, -h * 0.60);
  ctx.strokeStyle = hsl(hue, 22, 34);
  ctx.lineWidth = Math.max(1, r * 0.07);
  ctx.stroke();

  ctx.restore();
}

function drawPortrait(ctx, x, y, r, kind, hue) {
  /* The Pets-tab icon: a drawn pet's portrait (or its swim drawing), else the glass drawing. */
  var def = defs[kind];
  if (def) {
    ctx.save();
    ctx.translate(x, y);
    drawShapes(ctx, def.portrait || def.swim, r, hue, def.pal, false);
    ctx.restore();
    return;
  }
  drawCritter(ctx, x, y, r, 0, false, false, kind, hue);
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
      ctx.save(); ctx.translate(x, y + jit() * 2.0); ctx.scale(1, ch / cw);
      ctx.beginPath(); ctx.arc(0, 0, cw / 2, 0, 6.2832);
      ctx.fillStyle = "#c9951f"; ctx.fill();                                /* rim */
      ctx.beginPath(); ctx.arc(0, -1.3, cw / 2 - 1.6, 0, 6.2832);
      ctx.fillStyle = ((j * 3 + i) % 4 === 0) ? "#ffe07a" : "#f6c945"; ctx.fill();
      ctx.restore();
    }
  }
  ctx.fillStyle = "rgba(255,255,255,0.85)";                                 /* a glint */
  ctx.beginPath(); ctx.arc(cx - 3, base - (i - 1) * step - 2, 1.7, 0, 6.2832); ctx.fill();
}

export { jesterSvg, hatSvg, crownSvg, critterEye, critterCrown, drawCritter, drawHeadstone, drawPortrait, drawGoldPile };
