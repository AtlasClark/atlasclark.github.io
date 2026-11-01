/* Pet Studio importer: every pet, hat and prop is shapes already (pen1art.js, pen2art.js,
   propart.js); this hands the studio editable copies of the built-in drawings. */

import { EYE_INK } from "../js/petdefs.js";
import { PET_MAX, PEN2_FIRST, PEN3_FIRST, PET_COUNT } from "../js/config.js";
import { PEN1_ART, EXTRA_ART } from "../js/pen1art.js";
import { PEN2_ART } from "../js/pen2art.js";
import { PEN3_ART } from "../js/pen3art.js";
import { PROP_ART, HOLIDAY_ART } from "../js/propart.js";
import { CUP_ART, FX_ART } from "../js/styleart.js";

const copy = o => JSON.parse(JSON.stringify(o));

export function basePalette() {
  return { body: { hue: 1, dh: 0, s: 62, l: 58, a: 1 }, light: { hue: 1, dh: 0, s: 62, l: 70, a: 1 },
           dark: { hue: 1, dh: 0, s: 55, l: 42, a: 1 }, ink: { c: EYE_INK }, beak: { c: "#ef8a1b" }, white: { c: "#f4f7f9" } };
}

/* One built-in pet as a Studio pet: every pet is shapes already (pen1art.js, pen2art.js). */
export function importBuiltin(k) {
  const art = k < PET_COUNT ? PEN1_ART[k] : k >= PEN2_FIRST && k < PEN2_FIRST + PET_COUNT ? PEN2_ART[k - PEN2_FIRST]
            : k >= PEN3_FIRST && k < PEN3_FIRST + PET_COUNT ? PEN3_ART[k - PEN3_FIRST] : EXTRA_ART[k];
  const a = copy(art);
  return Object.assign({ crown: a.crown, pal: a.pal, swim: a.swim, portrait: null }, a.zone ? { zone: a.zone } : {});
}

/* A built-in hat or prop ("crown", "jester", "grave", "coin", a holiday hat, a cup item or an effect particle). */
export function importHat(key) {
  const a = copy(PROP_ART[key] || HOLIDAY_ART[key] || CUP_ART[key] || FX_ART[key]);
  return Object.assign({ pal: a.pal, shapes: a.shapes }, a.behind ? { behind: true } : {});
}

export function importAll() {
  const out = {};
  for (let k = 0; k < PET_MAX; k++) out[k] = importBuiltin(k);
  return out;
}
