/* Pet, crown and gold-pile drawing. The shapes are extracted unchanged from R55
   (drawCritter, drawPortrait, drawHeadstone, drawGoldPile), so every pet looks
   the same on the web as it does in the HTA. A pet redrawn in the Pet Studio
   (petdefs.js) is drawn from its shapes instead. */

import { PET_MAX, HOMUNCULUS_STYLE } from "./config.js";
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

/* Each pet is a small function drawing at the waterline anchor. They share
   the eye, the crown, and the palette, so most are a dozen shapes. */
var PET_CROWN = [
  [-0.42,-1.24],[0,-0.80],[0.10,-0.60],[-0.05,-0.52],[0,-0.74],[0,-1.02],
  [-0.15,-0.62],[0,-0.72],[0.18,-0.92],[0,-1.10],[0,-0.86],
  [-0.52,-1.26],[0,-0.78],[0,-0.88],[0,-0.72],[0,-0.72],
  [0.05,-0.94],[-0.60,-0.56],[-0.30,-1.30],[0.10,-0.52],[-0.48,-0.84],
  [0.05,-0.64],[0,-0.80],[-0.55,-1.18],[0,-0.98],
  [-0.40,-1.84],[-0.52,-1.70]
];

function drawCritter(ctx, x, y, r, ang, crowned, dead, kind, hue, jester) {
  var def = defs[kind];
  if (def) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    drawShapes(ctx, def.swim, r, hue, def.pal, dead);
    if (crowned) critterCrown(ctx, r * def.crown[0], r * def.crown[1], r, jester);
    ctx.restore();
    return;
  }
  var body = hsl(hue, 62, 58), lite = hsl(hue, 62, 70), dark = hsl(hue, 55, 42);
  /* PET_MAX, not PET_COUNT: the pen holds 25, but the reward and the dragon
     live outside it. Clamping to the pen drew both of them as ducks. */
  var k = (kind >= 0 && kind < PET_MAX) ? kind : 0, i, ax;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);

  function oval(cx, cy, rx, ryScale, fill) {
    ctx.save(); ctx.scale(1, ryScale);
    ctx.beginPath(); ctx.arc(cx, cy / ryScale, rx, 0, 6.2832);
    ctx.fillStyle = fill; ctx.fill(); ctx.restore();
  }
  function ball(cx, cy, rr, fill) {
    ctx.beginPath(); ctx.arc(cx, cy, rr, 0, 6.2832);
    ctx.fillStyle = fill; ctx.fill();
  }
  function dome(cx, cy, rr, fill) {
    ctx.beginPath(); ctx.arc(cx, cy, rr, 3.1416, 6.2832); ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
  }
  function tri(x1, y1, x2, y2, x3, y3, fill) {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3);
    ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
  }
  function line(x1, y1, x2, y2, w, col) {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, w); ctx.stroke();
  }

  if (k === 0) {                       /* duck */
    oval(0, -r * 0.30, r * 0.52, 0.8, body);
    ball(-r * 0.42, -r * 0.92, r * 0.33, lite);
    tri(-r * 0.70, -r * 0.94, -r * 1.18, -r * 0.80, -r * 0.70, -r * 0.70, "#ef8a1b");
    critterEye(ctx, -r * 0.50, -r * 1.03, r, dead);
  } else if (k === 1) {                /* frog */
    oval(0, -r * 0.10, r * 0.60, 0.72, body);
    ball(-r * 0.30, -r * 0.52, r * 0.24, lite);
    ball(r * 0.30, -r * 0.52, r * 0.24, lite);
    critterEye(ctx, -r * 0.30, -r * 0.56, r, dead);
    critterEye(ctx, r * 0.30, -r * 0.56, r, dead);
  } else if (k === 2) {                /* turtle */
    dome(r * 0.10, -r * 0.02, r * 0.55, dark);
    dome(r * 0.10, -r * 0.02, r * 0.38, body);
    ball(-r * 0.62, -r * 0.22, r * 0.20, lite);
    critterEye(ctx, -r * 0.68, -r * 0.28, r, dead);
  } else if (k === 3) {                /* whale */
    oval(0, -r * 0.08, r * 0.62, 0.68, body);
    tri(r * 0.58, -r * 0.10, r * 0.95, -r * 0.48, r * 0.72, r * 0.10, dark);
    if (!dead) {
      ball(-r * 0.18, -r * 0.66, r * 0.06, "rgba(180,220,255,0.9)");
      ball(-r * 0.10, -r * 0.84, r * 0.08, "rgba(180,220,255,0.9)");
      ball(-r * 0.24, -r * 0.88, r * 0.07, "rgba(180,220,255,0.9)");
    }
    critterEye(ctx, -r * 0.46, -r * 0.20, r, dead);
  } else if (k === 4) {                /* octopus */
    ball(0, -r * 0.30, r * 0.42, body);
    for (ax = -2; ax <= 2; ax++) { dome(ax * r * 0.30, r * 0.02, r * 0.12, dark); }
    critterEye(ctx, -r * 0.14, -r * 0.34, r, dead);
    critterEye(ctx, r * 0.14, -r * 0.34, r, dead);
  } else if (k === 5) {                /* you were warned */
    var b1 = "#8a5a2b", b2 = "#9c6a35", b3 = "#7a4c22";
    oval(0, -r * 0.06, r * 0.55, 0.87, b1);
    oval(0, -r * 0.40, r * 0.40, 0.9, b2);
    ball(0, -r * 0.68, r * 0.24, b1);
    ball(r * 0.10, -r * 0.88, r * 0.11, b3);
    if (dead) {
      critterEye(ctx, -r * 0.15, -r * 0.32, r, true);
      critterEye(ctx, r * 0.15, -r * 0.32, r, true);
    } else {
      ball(-r * 0.15, -r * 0.34, r * 0.12, "#ffffff");
      ball(r * 0.15, -r * 0.34, r * 0.12, "#ffffff");
      ball(-r * 0.12, -r * 0.31, r * 0.055, "#2a2118");
      ball(r * 0.18, -r * 0.31, r * 0.055, "#2a2118");
      ctx.beginPath(); ctx.arc(0, -r * 0.20, r * 0.10, 0.3, 2.84);
      ctx.strokeStyle = "#3a2313"; ctx.lineWidth = Math.max(1, r * 0.05); ctx.stroke();
    }
  } else if (k === 6) {                /* goldfish */
    oval(-r * 0.08, -r * 0.18, r * 0.42, 0.78, body);
    tri(r * 0.28, -r * 0.18, r * 0.72, -r * 0.46, r * 0.72, r * 0.06, dark);
    tri(-r * 0.10, -r * 0.48, r * 0.10, -r * 0.72, r * 0.22, -r * 0.44, dark);
    critterEye(ctx, -r * 0.36, -r * 0.26, r, dead);
  } else if (k === 7) {                /* crab */
    oval(0, -r * 0.14, r * 0.44, 0.7, body);
    ball(-r * 0.56, -r * 0.46, r * 0.16, dark);
    ball(r * 0.56, -r * 0.46, r * 0.16, dark);
    line(-r * 0.42, -r * 0.26, -r * 0.52, -r * 0.40, r * 0.08, dark);
    line(r * 0.42, -r * 0.26, r * 0.52, -r * 0.40, r * 0.08, dark);
    line(-r * 0.12, -r * 0.38, -r * 0.16, -r * 0.56, r * 0.05, dark);
    line(r * 0.12, -r * 0.38, r * 0.16, -r * 0.56, r * 0.05, dark);
    critterEye(ctx, -r * 0.16, -r * 0.58, r, dead);
    critterEye(ctx, r * 0.16, -r * 0.58, r, dead);
  } else if (k === 8) {                /* snail */
    ball(r * 0.16, -r * 0.34, r * 0.36, dark);
    ball(r * 0.24, -r * 0.40, r * 0.20, body);
    oval(-r * 0.30, -r * 0.06, r * 0.42, 0.42, lite);
    line(-r * 0.52, -r * 0.22, -r * 0.60, -r * 0.52, r * 0.05, lite);
    line(-r * 0.36, -r * 0.22, -r * 0.32, -r * 0.54, r * 0.05, lite);
    critterEye(ctx, -r * 0.60, -r * 0.58, r, dead);
    critterEye(ctx, -r * 0.32, -r * 0.60, r, dead);
  } else if (k === 9) {                /* penguin */
    oval(0, -r * 0.42, r * 0.38, 1.3, dark);
    oval(r * 0.04, -r * 0.34, r * 0.24, 1.25, "#f4f7f9");
    tri(-r * 0.10, -r * 0.88, -r * 0.38, -r * 0.80, -r * 0.10, -r * 0.74, "#ef8a1b");
    critterEye(ctx, -r * 0.06, -r * 0.94, r, dead);
  } else if (k === 10) {               /* seal */
    oval(0, -r * 0.24, r * 0.46, 0.85, body);
    ball(-r * 0.34, -r * 0.52, r * 0.14, lite);
    ball(-r * 0.42, -r * 0.56, r * 0.05, "#2a2118");
    line(-r * 0.30, -r * 0.50, -r * 0.06, -r * 0.46, r * 0.03, dark);
    line(-r * 0.30, -r * 0.54, -r * 0.06, -r * 0.56, r * 0.03, dark);
    critterEye(ctx, -r * 0.18, -r * 0.62, r, dead);
  } else if (k === 11) {               /* swan */
    oval(r * 0.10, -r * 0.22, r * 0.46, 0.75, body);
    ctx.beginPath();
    ctx.moveTo(-r * 0.20, -r * 0.34);
    ctx.quadraticCurveTo(-r * 0.66, -r * 0.60, -r * 0.52, -r * 1.06);
    ctx.strokeStyle = body; ctx.lineWidth = Math.max(2, r * 0.16); ctx.stroke();
    ball(-r * 0.52, -r * 1.10, r * 0.15, lite);
    tri(-r * 0.64, -r * 1.14, -r * 0.86, -r * 1.06, -r * 0.64, -r * 1.02, "#ef8a1b");
    critterEye(ctx, -r * 0.55, -r * 1.16, r, dead);
  } else if (k === 12) {               /* jellyfish */
    dome(0, -r * 0.10, r * 0.46, body);
    for (ax = -1; ax <= 1; ax++) { line(ax * r * 0.24, -r * 0.02, ax * r * 0.28, r * 0.28, r * 0.06, lite); }
    critterEye(ctx, -r * 0.16, -r * 0.30, r, dead);
    critterEye(ctx, r * 0.16, -r * 0.30, r, dead);
  } else if (k === 13) {               /* beaver */
    oval(r * 0.34, -r * 0.02, r * 0.34, 0.4, dark);
    ball(-r * 0.10, -r * 0.34, r * 0.36, body);
    ball(-r * 0.34, -r * 0.66, r * 0.10, body);
    ball(r * 0.12, -r * 0.66, r * 0.10, body);
    ball(-r * 0.34, -r * 0.34, r * 0.07, "#2a2118");
    ctx.fillStyle = "#f4f7f9";
    ctx.fillRect(-r * 0.26, -r * 0.24, r * 0.10, r * 0.14);
    ctx.fillRect(-r * 0.14, -r * 0.24, r * 0.10, r * 0.14);
    critterEye(ctx, -r * 0.16, -r * 0.46, r, dead);
  } else if (k === 14) {               /* hippo */
    oval(0, -r * 0.16, r * 0.55, 0.62, body);
    ball(-r * 0.30, -r * 0.52, r * 0.10, lite);
    ball(r * 0.30, -r * 0.52, r * 0.10, lite);
    ball(-r * 0.38, -r * 0.30, r * 0.06, dark);
    ball(-r * 0.22, -r * 0.30, r * 0.06, dark);
    critterEye(ctx, -r * 0.06, -r * 0.44, r, dead);
    critterEye(ctx, r * 0.22, -r * 0.44, r, dead);
  } else if (k === 15) {               /* pufferfish */
    for (i = 0; i < 8; i++) {
      ax = i * 0.7854;
      line(Math.cos(ax) * r * 0.34, -r * 0.28 + Math.sin(ax) * r * 0.34,
           Math.cos(ax) * r * 0.52, -r * 0.28 + Math.sin(ax) * r * 0.52, r * 0.05, dark);
    }
    ball(0, -r * 0.28, r * 0.38, body);
    ball(-r * 0.42, -r * 0.28, r * 0.09, lite);
    critterEye(ctx, -r * 0.14, -r * 0.38, r, dead);
    critterEye(ctx, r * 0.14, -r * 0.38, r, dead);
  } else if (k === 16) {               /* shark: mostly rumour */
    oval(r * 0.05, r * 0.02, r * 0.60, 0.35, dark);
    tri(-r * 0.05, -r * 0.14, r * 0.14, -r * 0.86, r * 0.30, -r * 0.14, body);
    tri(r * 0.52, -r * 0.06, r * 0.74, -r * 0.44, r * 0.70, -r * 0.02, body);
    critterEye(ctx, -r * 0.44, -r * 0.10, r, dead);
  } else if (k === 17) {               /* alligator */
    oval(0, -r * 0.06, r * 0.66, 0.32, body);
    ball(-r * 0.60, -r * 0.44, r * 0.13, lite);
    ball(-r * 0.16, -r * 0.44, r * 0.13, lite);
    ball(-r * 0.72, -r * 0.16, r * 0.06, dark);
    critterEye(ctx, -r * 0.60, -r * 0.48, r, dead);
    critterEye(ctx, -r * 0.16, -r * 0.48, r, dead);
  } else if (k === 18) {               /* flamingo */
    oval(r * 0.14, -r * 0.30, r * 0.36, 0.8, body);
    ctx.beginPath();
    ctx.moveTo(-r * 0.10, -r * 0.44);
    ctx.quadraticCurveTo(-r * 0.56, -r * 0.70, -r * 0.34, -r * 1.10);
    ctx.strokeStyle = body; ctx.lineWidth = Math.max(2, r * 0.13); ctx.stroke();
    ball(-r * 0.32, -r * 1.14, r * 0.14, lite);
    tri(-r * 0.44, -r * 1.18, -r * 0.64, -r * 1.08, -r * 0.44, -r * 1.06, "#2a2118");
    critterEye(ctx, -r * 0.34, -r * 1.20, r, dead);
  } else if (k === 19) {               /* platypus */
    oval(r * 0.08, -r * 0.16, r * 0.44, 0.6, body);
    oval(-r * 0.52, -r * 0.16, r * 0.24, 0.4, "#c98a3b");
    oval(r * 0.58, -r * 0.08, r * 0.22, 0.35, dark);
    critterEye(ctx, -r * 0.26, -r * 0.34, r, dead);
  } else if (k === 20) {               /* otter, floating on its back */
    oval(r * 0.10, -r * 0.12, r * 0.48, 0.55, body);
    oval(r * 0.10, -r * 0.18, r * 0.30, 0.5, lite);
    ball(-r * 0.48, -r * 0.36, r * 0.22, body);
    ball(-r * 0.62, -r * 0.54, r * 0.07, body);
    ball(-r * 0.34, -r * 0.54, r * 0.07, body);
    ball(-r * 0.02, -r * 0.42, r * 0.08, dark);
    ball(r * 0.26, -r * 0.42, r * 0.08, dark);
    critterEye(ctx, -r * 0.52, -r * 0.42, r, dead);
  } else if (k === 21) {               /* narwhal */
    oval(r * 0.06, -r * 0.10, r * 0.55, 0.68, body);
    tri(r * 0.58, -r * 0.10, r * 0.90, -r * 0.44, r * 0.72, r * 0.08, dark);
    line(-r * 0.40, -r * 0.34, -r * 0.86, -r * 1.02, r * 0.07, "#e8ddc8");
    critterEye(ctx, -r * 0.34, -r * 0.22, r, dead);
  } else if (k === 22) {               /* axolotl */
    oval(r * 0.10, -r * 0.16, r * 0.44, 0.62, body);
    ball(-r * 0.34, -r * 0.34, r * 0.28, lite);
    for (ax = 0; ax < 3; ax++) {
      line(-r * 0.52, -r * (0.28 + ax * 0.12), -r * (0.72 + ax * 0.04), -r * (0.30 + ax * 0.16), r * 0.06, dark);
    }
    if (!dead) {
      ctx.beginPath(); ctx.arc(-r * 0.34, -r * 0.26, r * 0.09, 0.4, 2.74);
      ctx.strokeStyle = "#3a2313"; ctx.lineWidth = Math.max(1, r * 0.04); ctx.stroke();
    }
    critterEye(ctx, -r * 0.44, -r * 0.42, r, dead);
    critterEye(ctx, -r * 0.20, -r * 0.42, r, dead);
  } else if (k === 23) {               /* nessie */
    dome(r * 0.20, r * 0.02, r * 0.26, body);
    dome(r * 0.62, r * 0.02, r * 0.20, body);
    ctx.beginPath();
    ctx.moveTo(-r * 0.24, r * 0.02);
    ctx.quadraticCurveTo(-r * 0.62, -r * 0.44, -r * 0.46, -r * 0.96);
    ctx.strokeStyle = body; ctx.lineWidth = Math.max(2, r * 0.15); ctx.stroke();
    oval(-r * 0.50, -r * 1.02, r * 0.16, 0.7, lite);
    critterEye(ctx, -r * 0.56, -r * 1.06, r, dead);
  } else if (k === 25 && HOMUNCULUS_STYLE === "ball") {   /* ---- all of them, fused ---- */
    /* Twenty-five creatures mashed into one lump: overlapping bodies, limbs
       of every sort radiating out, and rather too many eyes. */
    var bc = [hsl(hue, 58, 56), hsl((hue + 120) % 360, 55, 54), hsl((hue + 240) % 360, 56, 60),
              hsl((hue + 60) % 360, 50, 48), hsl((hue + 180) % 360, 52, 58)];
    var bD = hsl(hue, 40, 34);
    var limbs = [["t",150],["t",170],["t",195],["t",215],["c",35],["c",145],
                 ["f",300],["f",250],["w",15],["h",270],["h",285],["e",255],["e",300],
                 ["p",120],["p",60]];
    var aa, col, bx, by, ex, ey, mx, my, kind2;

    for (i = 0; i < limbs.length; i++) {
      kind2 = limbs[i][0];
      aa = limbs[i][1] * 0.0174533;
      col = bc[i % bc.length];
      bx = Math.cos(aa) * r * 0.52; by = Math.sin(aa) * r * 0.52;
      ex = Math.cos(aa) * r * 1.02; ey = Math.sin(aa) * r * 1.02;
      mx = Math.cos(aa + 0.5) * r * 0.86; my = Math.sin(aa + 0.5) * r * 0.86;
      if (kind2 === "t") {                                  /* tentacle */
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.quadraticCurveTo(mx, my, ex, ey);
        ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, r * 0.11);
        ctx.lineCap = "round"; ctx.stroke(); ctx.lineCap = "butt";
      } else if (kind2 === "c") {                           /* claw */
        line(bx, by, ex, ey, r * 0.10, col);
        tri(ex, ey, ex + Math.cos(aa - 0.35) * r * 0.30, ey + Math.sin(aa - 0.35) * r * 0.30,
            ex + Math.cos(aa + 0.1) * r * 0.16, ey + Math.sin(aa + 0.1) * r * 0.16, col);
        tri(ex, ey, ex + Math.cos(aa + 0.45) * r * 0.28, ey + Math.sin(aa + 0.45) * r * 0.28,
            ex + Math.cos(aa + 0.05) * r * 0.14, ey + Math.sin(aa + 0.05) * r * 0.14, col);
      } else if (kind2 === "f") {                           /* fin */
        tri(bx, by, ex + Math.cos(aa - 0.3) * r * 0.22, ey + Math.sin(aa - 0.3) * r * 0.22,
            ex + Math.cos(aa + 0.3) * r * 0.22, ey + Math.sin(aa + 0.3) * r * 0.22, col);
      } else if (kind2 === "w") {                           /* fluke */
        line(bx, by, ex, ey, r * 0.09, col);
        tri(ex, ey, ex + Math.cos(aa - 0.7) * r * 0.34, ey + Math.sin(aa - 0.7) * r * 0.34,
            ex + Math.cos(aa + 0.7) * r * 0.34, ey + Math.sin(aa + 0.7) * r * 0.34, col);
      } else if (kind2 === "h") {                           /* tusk */
        tri(bx, by, ex, ey, bx + Math.cos(aa + 1.4) * r * 0.16,
            by + Math.sin(aa + 1.4) * r * 0.16, "#e8ddc8");
      } else if (kind2 === "e") {                           /* ear */
        tri(bx, by, ex, ey, bx + Math.cos(aa - 1.3) * r * 0.20,
            by + Math.sin(aa - 1.3) * r * 0.20, col);
      } else {                                              /* flipper */
        ctx.save();
        ctx.translate((bx + ex) / 2, (by + ey) / 2);
        ctx.rotate(aa);
        ctx.scale(1, 0.45);
        ctx.beginPath(); ctx.arc(0, 0, r * 0.20, 0, 6.2832);
        ctx.fillStyle = col; ctx.fill();
        ctx.restore();
      }
    }

    ball(0, -r * 0.02, r * 0.56, bc[0]);                    /* the fused mass */
    ball(-r * 0.22, -r * 0.20, r * 0.32, bc[1]);
    ball(r * 0.24, -r * 0.14, r * 0.30, bc[2]);
    ball(r * 0.02, r * 0.20, r * 0.28, bc[3]);
    ball(-r * 0.24, r * 0.16, r * 0.24, bc[4]);
    dome(r * 0.06, -r * 0.30, r * 0.30, bD);                /* a shell on top */
    tri(-r * 0.52, -r * 0.12, -r * 0.92, -r * 0.02, -r * 0.52, r * 0.08, "#ef8a1b");

    var eyeSpots = [[-0.30, -0.34, 0.15], [0.16, -0.40, 0.13], [0.34, 0.02, 0.11],
                    [-0.34, 0.10, 0.10], [0.00, 0.14, 0.09]];
    for (i = 0; i < eyeSpots.length; i++) {
      ball(r * eyeSpots[i][0], r * eyeSpots[i][1], r * eyeSpots[i][2], "#fafaf8");
      critterEye(ctx, r * eyeSpots[i][0] + r * 0.02, r * eyeSpots[i][1],
                 r * eyeSpots[i][2] * 6.5, dead);
    }

  } else if (k === 25) {               /* ---- the homunculus ---- */
    /* Every one of them wearing each other: turtle shell, octopus legs, crab
       claws, whale flukes, shark fin, swan neck, duck bill, frog eyes, cat
       ears, narwhal tusk. Three hues so it reads as assembled, not lumpy. */
    var hA = hsl(hue, 58, 56), hB = hsl((hue + 130) % 360, 55, 54),
        hC = hsl((hue + 240) % 360, 56, 60), hD = hsl(hue, 45, 36), sd;

    function arc2(x1, y1, cx1, cy1, x2, y2, w, col, round) {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.quadraticCurveTo(cx1, cy1, x2, y2);
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(1, w);
      ctx.lineCap = round ? "round" : "butt";
      ctx.stroke();
      ctx.lineCap = "butt";
    }

    arc2(r * 0.44, -r * 0.10, r * 0.78, -r * 0.26, r * 0.96, -r * 0.52, r * 0.10, hD, false);
    tri(r * 0.96, -r * 0.44, r * 1.22, -r * 0.74, r * 0.80, -r * 0.72, hD);   /* whale flukes */
    tri(r * 0.96, -r * 0.44, r * 1.20, -r * 0.30, r * 0.84, -r * 0.26, hD);

    for (i = 0; i < 4; i++) {                                                 /* octopus legs */
      ax = (i < 2) ? -1 : 1;
      var lg = (i % 2) + 1;
      arc2(ax * r * 0.14 * lg, -r * 0.06,
           ax * r * (0.16 + 0.16 * lg), r * 0.30,
           ax * r * (0.34 + 0.20 * lg), r * 0.56,
           r * 0.095, (lg % 2) ? hC : hB, true);
    }

    for (i = 0; i < 2; i++) {                                                 /* crab claws */
      sd = i ? 1 : -1;
      arc2(sd * r * 0.34, -r * 0.22, sd * r * 0.72, -r * 0.34,
           sd * r * 0.80, -r * 0.66, r * 0.09, hB, true);
      tri(sd * r * 0.80, -r * 0.60, sd * r * 1.02, -r * 0.92, sd * r * 0.62, -r * 0.80, hB);
      tri(sd * r * 0.80, -r * 0.60, sd * r * 0.98, -r * 0.56, sd * r * 0.66, -r * 0.44, hB);
    }

    dome(0, -r * 0.02, r * 0.58, hD);                                         /* turtle shell */
    dome(0, -r * 0.02, r * 0.46, hA);
    for (i = -1; i <= 1; i++) {
      line(i * r * 0.22, -r * 0.04, i * r * 0.30, -r * 0.40, r * 0.045, hD);
    }
    tri(r * 0.06, -r * 0.44, r * 0.40, -r * 0.96, r * 0.44, -r * 0.40, hD);   /* shark fin */

    arc2(-r * 0.20, -r * 0.30, -r * 0.66, -r * 0.56, -r * 0.48, -r * 1.02,    /* swan neck */
         r * 0.16, hC, true);
    oval(-r * 0.48, -r * 1.12, r * 0.26, 0.86, hC);                           /* head */
    tri(-r * 0.66, -r * 1.14, -r * 1.10, -r * 1.02, -r * 0.66, -r * 0.92, "#ef8a1b");
    line(-r * 0.34, -r * 1.28, -r * 0.06, -r * 1.76, r * 0.055, "#e8ddc8");   /* narwhal tusk */
    tri(-r * 0.66, -r * 1.28, -r * 0.54, -r * 1.62, -r * 0.40, -r * 1.26, hC); /* cat ears */
    tri(-r * 0.38, -r * 1.28, -r * 0.26, -r * 1.58, -r * 0.14, -r * 1.22, hC);
    ball(-r * 0.58, -r * 1.30, r * 0.14, hsl(hue, 62, 80));                   /* frog eyes */
    ball(-r * 0.30, -r * 1.30, r * 0.14, hsl(hue, 62, 80));
    critterEye(ctx, -r * 0.58, -r * 1.32, r, dead);
    critterEye(ctx, -r * 0.30, -r * 1.32, r, dead);

  } else if (k === 26) {               /* ---- the one that is not in the pen ---- */
    /* A sea serpent: coils breaking the surface, a thick neck rising to a
       fanged head, dorsal frill, swept horns, broad tail fluke. Fixed
       colours -- it is never a random hue. */
    var dB = "#2e8c80", dL = "#6ec8b6", dD = "#16504e", dF = "#d67e38",
        dT = "#f8fafc", dM = "#601c24", nk, ti, tg;

    function darc(x1, y1, c1x, c1y, c2x, c2y, x2, y2, w, col) {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.bezierCurveTo(c1x, c1y, c2x, c2y, x2, y2);
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(1, w);
      ctx.lineCap = "round";
      ctx.stroke();
      ctx.lineCap = "butt";
    }
    function bez(t, p0, p1, p2, p3) {
      var u = 1 - t;
      return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
    }

    ctx.beginPath();                                          /* tail */
    ctx.moveTo(r * 1.02, r * 0.04);
    ctx.quadraticCurveTo(r * 1.34, -r * 0.24, r * 1.08, -r * 0.62);
    ctx.strokeStyle = dB; ctx.lineWidth = Math.max(1, r * 0.15);
    ctx.lineCap = "round"; ctx.stroke(); ctx.lineCap = "butt";
    tri(r * 1.08, -r * 0.54, r * 1.44, -r * 0.92, r * 0.90, -r * 0.82, dF);
    tri(r * 1.08, -r * 0.54, r * 0.84, -r * 0.88, r * 0.84, -r * 0.46, dF);

    dome(r * 0.82, r * 0.04, r * 0.30, dD);                   /* coils */
    dome(r * 0.40, r * 0.04, r * 0.42, dB);
    for (i = 0; i < 4; i++) {
      line(r * (0.12 + i * 0.19), r * 0.02, r * (0.12 + i * 0.19), -r * 0.30, r * 0.07, dL);
    }

    darc(r * 0.20, -r * 0.10, -r * 0.34, -r * 0.34, r * 0.10, -r * 1.02,
         -r * 0.28, -r * 1.34, r * 0.30, dB);                 /* thick S neck */

    for (i = 0; i < 5; i++) {                                 /* dorsal frill */
      tg = 0.16 + i * 0.13;
      nk = [bez(tg, r * 0.20, -r * 0.34, r * 0.10, -r * 0.28),
            bez(tg, -r * 0.10, -r * 0.34, -r * 1.02, -r * 1.34)];
      ti = r * (0.13 + i * 0.02);
      tri(nk[0], nk[1], nk[0] + ti * 1.35, nk[1] - ti * 1.1, nk[0] + r * 0.05, nk[1] + r * 0.10, dF);
    }

    tri(-r * 0.18, -r * 1.42, r * 0.34, -r * 1.72, r * 0.02, -r * 1.24, dF);   /* head fins */
    tri(-r * 0.16, -r * 1.54, r * 0.20, -r * 2.00, -r * 0.06, -r * 1.40, dF);

    tri(-r * 0.62, -r * 1.44, -r * 1.30, -r * 1.42, -r * 1.16, -r * 1.08, dM); /* open mouth */
    ctx.save();
    ctx.translate(-r * 0.46, -r * 1.44); ctx.rotate(-0.21); ctx.scale(1, 0.58);
    ctx.beginPath(); ctx.arc(0, 0, r * 0.38, 0, 6.2832); ctx.fillStyle = dB; ctx.fill();
    ctx.restore();
    tri(-r * 0.66, -r * 1.60, -r * 1.36, -r * 1.50, -r * 0.64, -r * 1.40, dB); /* upper jaw */
    tri(-r * 0.64, -r * 1.26, -r * 1.22, -r * 1.02, -r * 0.60, -r * 1.14, dL); /* lower jaw */
    for (i = 0; i < 4; i++) {
      tri(-r * (0.74 + i * 0.15), -r * 1.475, -r * (0.69 + i * 0.15), -r * 1.475,
          -r * (0.715 + i * 0.15), -r * 1.36, dT);
    }
    for (i = 0; i < 3; i++) {
      tri(-r * (0.78 + i * 0.14), -r * 1.205, -r * (0.73 + i * 0.14), -r * 1.215,
          -r * (0.755 + i * 0.14), -r * 1.31, dT);
    }
    tri(-r * 0.30, -r * 1.62, -r * 0.02, -r * 2.06, -r * 0.10, -r * 1.52, dF); /* horns */
    tri(-r * 0.40, -r * 1.64, -r * 0.32, -r * 2.08, -r * 0.18, -r * 1.56, dF);
    if (!dead) {
      ball(-r * 0.60, -r * 1.54, r * 0.14, "#fcd648");
      ball(-r * 0.595, -r * 1.54, r * 0.07, "#121212");
    } else {
      critterEye(ctx, -r * 0.60, -r * 1.54, r, true);
    }

  } else {                             /* cat in a ring */
    ctx.beginPath();
    ctx.arc(0, -r * 0.06, r * 0.46, 0, 6.2832);
    ctx.strokeStyle = lite; ctx.lineWidth = Math.max(3, r * 0.22); ctx.stroke();
    ball(0, -r * 0.34, r * 0.26, body);
    tri(-r * 0.22, -r * 0.50, -r * 0.14, -r * 0.72, -r * 0.02, -r * 0.54, body);
    tri(r * 0.22, -r * 0.50, r * 0.14, -r * 0.72, r * 0.02, -r * 0.54, body);
    line(-r * 0.30, -r * 0.30, -r * 0.52, -r * 0.26, r * 0.03, dark);
    line(r * 0.30, -r * 0.30, r * 0.52, -r * 0.26, r * 0.03, dark);
    critterEye(ctx, -r * 0.10, -r * 0.38, r, dead);
    critterEye(ctx, r * 0.10, -r * 0.38, r, dead);
  }

  if (crowned) { critterCrown(ctx, r * PET_CROWN[k][0], r * PET_CROWN[k][1], r, jester); }
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
  /* Full-body versions for the Pets tab grid. In the glass, several critters
     are drawn half in the water -- eyes above the surface, the rest hidden.
     Out of the water they should read whole, so the eight that were only ever
     partly visible get proper bodies here. Everything else defers to the same
     drawing the glass uses. This function is icons-only and never touches the
     live animation. */
  var body = hsl(hue, 62, 58), lite = hsl(hue, 62, 70), dark = hsl(hue, 55, 42);
  var full = { "1": 1, "3": 1, "4": 1, "14": 1, "16": 1, "17": 1, "21": 1, "23": 1 };
  var i, tx, ty, def = defs[kind];

  if (def) {
    ctx.save();
    ctx.translate(x, y);
    drawShapes(ctx, def.portrait || def.swim, r, hue, def.pal, false);
    ctx.restore();
    return;
  }

  if (!full[String(kind)]) {
    drawCritter(ctx, x, y, r, 0, false, false, kind, hue);
    return;
  }

  ctx.save();
  ctx.translate(x, y);

  function oval(cx, cy, rx, ry, fill) {
    ctx.save(); ctx.scale(1, ry);
    ctx.beginPath(); ctx.arc(cx, cy / ry, rx, 0, 6.2832);
    ctx.fillStyle = fill; ctx.fill(); ctx.restore();
  }
  function ball(cx, cy, rr, fill) {
    ctx.beginPath(); ctx.arc(cx, cy, rr, 0, 6.2832);
    ctx.fillStyle = fill; ctx.fill();
  }
  function tri(x1, y1, x2, y2, x3, y3, fill) {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3);
    ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
  }
  function line(x1, y1, x2, y2, w, col) {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, w); ctx.stroke();
  }
  function curve(x1, y1, cx, cy, x2, y2, w, col) {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo(cx, cy, x2, y2);
    ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, w); ctx.stroke();
  }
  function smile(cx, cy, rr, w, col) {
    ctx.beginPath(); ctx.arc(cx, cy, rr, 0.15, 3.0);
    ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, w); ctx.stroke();
  }

  if (kind === 1) {                       /* frog, sitting up on its haunches */
    oval(-r * 0.60, r * 0.30, r * 0.26, 0.7, dark);
    oval(r * 0.60, r * 0.30, r * 0.26, 0.7, dark);
    oval(0, r * 0.02, r * 0.64, 0.9, body);
    ball(-r * 0.50, r * 0.48, r * 0.15, lite);
    ball(r * 0.50, r * 0.48, r * 0.15, lite);
    ball(-r * 0.30, -r * 0.55, r * 0.26, lite);
    ball(r * 0.30, -r * 0.55, r * 0.26, lite);
    critterEye(ctx, -r * 0.30, -r * 0.58, r, false);
    critterEye(ctx, r * 0.30, -r * 0.58, r, false);
    smile(0, -r * 0.10, r * 0.34, r * 0.06, dark);

  } else if (kind === 3) {                /* whale, whole, side on */
    oval(-r * 0.05, 0, r * 0.74, 0.6, body);
    oval(-r * 0.15, r * 0.20, r * 0.52, 0.36, lite);
    tri(r * 0.60, -r * 0.05, r * 0.99, -r * 0.42, r * 0.99, r * 0.30, dark);
    tri(-r * 0.10, r * 0.24, r * 0.22, r * 0.22, r * 0.02, r * 0.52, dark);
    curve(-r * 0.80, r * 0.06, -r * 0.82, r * 0.26, -r * 0.48, r * 0.30, r * 0.05, dark);
    ball(-r * 0.30, -r * 0.62, r * 0.06, "rgba(150,205,235,0.85)");   /* a jaunty spout */
    ball(-r * 0.22, -r * 0.80, r * 0.08, "rgba(150,205,235,0.85)");
    ball(-r * 0.36, -r * 0.82, r * 0.07, "rgba(150,205,235,0.85)");
    critterEye(ctx, -r * 0.52, -r * 0.06, r, false);

  } else if (kind === 4) {                /* octopus, tentacles hanging down */
    for (i = -3; i <= 3; i++) {
      curve(i * r * 0.16, r * 0.05, i * r * 0.36, r * 0.5, i * r * 0.52, r * 0.64,
            r * 0.09, (i % 2 === 0) ? dark : body);
    }
    ball(0, -r * 0.30, r * 0.50, body);
    ball(-r * 0.19, -r * 0.36, r * 0.15, lite);
    ball(r * 0.19, -r * 0.36, r * 0.15, lite);
    critterEye(ctx, -r * 0.19, -r * 0.36, r, false);
    critterEye(ctx, r * 0.19, -r * 0.36, r, false);

  } else if (kind === 14) {               /* hippo, whole, side on */
    oval(r * 0.18, r * 0.04, r * 0.60, 0.62, body);
    line(0, r * 0.5, 0, r * 0.72, r * 0.16, dark);
    line(r * 0.42, r * 0.5, r * 0.42, r * 0.72, r * 0.16, dark);
    ball(-r * 0.52, -r * 0.02, r * 0.42, body);
    oval(-r * 0.80, r * 0.12, r * 0.30, 0.68, body);
    ball(-r * 0.94, r * 0.08, r * 0.06, dark);
    ball(-r * 0.70, r * 0.16, r * 0.06, dark);
    tri(-r * 0.52, -r * 0.44, -r * 0.36, -r * 0.44, -r * 0.44, -r * 0.24, lite);
    critterEye(ctx, -r * 0.50, -r * 0.18, r, false);

  } else if (kind === 16) {               /* shark, whole, side on */
    oval(-r * 0.05, 0, r * 0.78, 0.44, body);
    oval(-r * 0.05, r * 0.16, r * 0.60, 0.26, lite);
    tri(0, -r * 0.16, r * 0.16, -r * 0.80, r * 0.34, -r * 0.16, body);
    tri(-r * 0.10, r * 0.16, r * 0.16, r * 0.16, -r * 0.06, r * 0.54, dark);
    tri(r * 0.62, -r * 0.02, r * 0.99, -r * 0.42, r * 0.86, r * 0.02, body);
    tri(r * 0.62, r * 0.02, r * 0.93, r * 0.34, r * 0.86, 0, dark);
    line(-r * 0.52, -r * 0.12, -r * 0.46, r * 0.14, r * 0.03, dark);
    line(-r * 0.44, -r * 0.14, -r * 0.38, r * 0.14, r * 0.03, dark);
    line(-r * 0.80, r * 0.12, -r * 0.50, r * 0.16, r * 0.03, dark);
    critterEye(ctx, -r * 0.58, -r * 0.04, r, false);

  } else if (kind === 17) {               /* alligator, whole, side on */
    oval(r * 0.12, r * 0.06, r * 0.64, 0.4, body);
    tri(r * 0.62, r * 0.02, r * 1.06, -r * 0.16, r * 0.96, r * 0.26, dark);
    oval(-r * 0.66, r * 0.08, r * 0.44, 0.32, body);
    for (i = 0; i < 5; i++) {
      tx = -r * (0.98 - i * 0.16);
      tri(tx, r * 0.18, tx + r * 0.07, r * 0.18, tx + r * 0.035, r * 0.28, "#f4f7f9");
    }
    for (i = 0; i < 4; i++) {
      tx = -r * (0.06 - i * 0.20);
      tri(tx, -r * 0.28, tx + r * 0.16, -r * 0.28, tx + r * 0.08, -r * 0.50, dark);
    }
    line(-r * 0.20, r * 0.42, -r * 0.20, r * 0.62, r * 0.10, dark);
    line(r * 0.40, r * 0.42, r * 0.40, r * 0.62, r * 0.10, dark);
    ball(-r * 0.52, -r * 0.28, r * 0.12, lite);
    critterEye(ctx, -r * 0.52, -r * 0.30, r, false);

  } else if (kind === 21) {               /* narwhal, whole, with the tusk */
    oval(r * 0.05, 0, r * 0.64, 0.52, body);
    oval(0, r * 0.18, r * 0.48, 0.3, lite);
    tri(r * 0.56, -r * 0.04, r * 0.95, -r * 0.40, r * 0.90, r * 0.24, dark);
    line(-r * 0.56, -r * 0.06, -r * 1.16, -r * 0.50, r * 0.06, "#e8ddc8");
    for (i = 1; i <= 4; i++) {
      tx = -r * (0.56 + i * 0.14); ty = -r * (0.06 + i * 0.104);
      line(tx - r * 0.03, ty - r * 0.05, tx + r * 0.03, ty + r * 0.05, r * 0.02, "#c9bfa6");
    }
    critterEye(ctx, -r * 0.42, -r * 0.06, r, false);

  } else {                                /* nessie, a whole plesiosaur */
    oval(0, r * 0.06, r * 0.50, 0.72, body);
    tri(-r * 0.54, -r * 0.16, -r * 0.34, r * 0.12, -r * 0.72, r * 0.22, dark);
    tri(r * 0.48, r * 0.12, r * 0.72, -r * 0.04, r * 0.66, r * 0.36, dark);
    curve(r * 0.40, r * 0.02, r * 0.92, r * 0.12, r * 1.06, -r * 0.40, r * 0.14, body);
    curve(-r * 0.24, -r * 0.18, -r * 0.56, -r * 0.70, -r * 0.30, -r * 1.04, r * 0.16, body);
    ball(-r * 0.28, -r * 1.10, r * 0.16, lite);
    critterEye(ctx, -r * 0.34, -r * 1.12, r, false);
  }

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

export { jesterSvg, hatSvg, crownSvg, critterEye, critterCrown, drawCritter, drawHeadstone, drawPortrait, drawGoldPile, PET_CROWN };
