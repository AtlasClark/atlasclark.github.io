/* Plinko results are drawn and saved when the token drops (so a closed tab can't
   lose them); the board only shows the fall. Until a ball lands on this page, its
   result stays hidden everywhere: the buy drawer, the glass, the Pets tab, the
   activity list, balances and the Community Chest. A drop seen only in the data
   (made on another PC) is hidden until its live replay lands here, or for HOLD_MS. */

import * as C from "./config.js";
import { S } from "./model.js";
import { petKindFor } from "./store.js";
import { pendingDrops, balance, chestRaw } from "./shop.js";

export const HOLD_MS = C.LIVE_SHOW_MS + 3000;
export const landed = new Set();                  /* drop ids whose ball landed on this page */
let flying = () => [];                            /* set by shopui: events still falling on the board */
export function setFlying(fn) { flying = fn; }

export function pending(p) { return pendingDrops(p, flying(), landed, Date.now(), HOLD_MS); }
export const anyPending = () => S.participants.some(p => pending(p).length);

/* Pen pets won but not yet shown: kind -> was it buried. */
export function hiddenPets(p) {
  const m = new Map();
  for (const d of pending(p)) if (d.fresh && d.pet >= 0) m.set(d.pet, !!d.revived);
  return m;
}

/* The pet worn before the first hidden win. */
export function shownKind(p) {
  const d = pending(p).find(x => x.fresh && x.was !== undefined && x.was !== null);
  return d ? Number(d.was) : petKindFor(p);
}

export function shownBalance(p) {
  return balance(p) - pending(p).reduce((a, d) => a + (d.chest ? Number(d.chest.won) || 0 : 0), 0);
}

export function shownChest() {
  let t = chestRaw();
  for (const p of S.participants) for (const d of pending(p)) if (d.chest) t += (Number(d.chest.won) || 0) - (Number(d.chest.add) || 0);
  return Math.max(0, t);
}

export const hiddenIds = p => new Set(pending(p).map(d => d.id));
