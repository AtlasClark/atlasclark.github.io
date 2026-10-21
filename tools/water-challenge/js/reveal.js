/* Plinko results are drawn and saved when the token drops (so a closed tab can't
   lose them); the board only shows the fall. Until a ball lands on this page, its
   result stays hidden everywhere: the buy drawer, the glass, the Pets tab, the
   activity list, balances and the Community Chest. A drop seen only in the data
   (made on another PC) is hidden until its live replay lands here, or for HOLD_MS. */

import * as C from "./config.js";
import { S, petEventTimes } from "./model.js";
import { todayKey } from "./util.js";
import { petKindFor } from "./store.js";
import { pendingDrops, balance, chestRaw } from "./shop.js";

export const HOLD_MS = C.LIVE_SHOW_MS + 3000;
export const landed = new Set();                  /* drop ids whose ball landed on this page */
let flying = () => [];                            /* set by shopui: events still falling on the board */
export function setFlying(fn) { flying = fn; }

export function pending(p) { return pendingDrops(p, flying(), landed, Date.now(), HOLD_MS); }
export const anyPending = () => S.participants.some(p => pending(p).length);

/* Goal rolls work the same way: the roll is saved when the pour crosses the goal, and
   the unlock card reveals it. Until that card closes on this page, the roll stays out
   of the activity list (with the reroll line), the status line, the shop's reroll box
   and the Pets tab. A roll seen only in the data
   (rolled on another PC) waits for its card from the live channel, or HOLD_MS after
   the pour that made it. */
const rollCards = new Map();                      /* name|day -> "waiting" | "shown" */
const rollKey = name => name + "|" + todayKey();
export function rollCardQueued(name) { rollCards.set(rollKey(name), "waiting"); }     /* a reroll hides it again */
export function rollCardDone(name) { rollCards.set(rollKey(name), "shown"); }

/* ms the roll stays hidden: 0 = shown, Infinity = until its card closes. */
export function rollHoldLeft(p, now = Date.now()) {
  const key = todayKey();
  if (p.petRollDay !== key || !(Number(p.rollKind) >= 0)) return 0;
  const st = rollCards.get(rollKey(p.name));
  if (st) return st === "waiting" ? Infinity : 0;
  const at = new Date(petEventTimes(p, key).roll || 0).getTime();
  return at > 0 ? Math.max(0, at + HOLD_MS - now) : 0;
}

/* Pen pets won but not yet shown: kind -> was it buried. */
export function hiddenPets(p) {
  const m = new Map();
  for (const d of pending(p)) if (d.fresh && d.pet >= 0) m.set(d.pet, !!d.revived);
  if (p.rollWasNew && rollHoldLeft(p)) m.set(Number(p.rollKind), false);
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
