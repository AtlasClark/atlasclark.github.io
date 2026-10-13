/* The token shop: reroll today's pet, Plinko, and buying a species outright.
   Tokens are earned one per goal day (model.tokensEarned) and spent through a log
   of spends in each person's file, so the shop needs a folder at format 22.
   Every action here saves; callers run them inside store.serial(). */

import * as C from "./config.js";
import { S, tokensEarned } from "./model.js";
import { saveParticipant, petKindFor } from "./store.js";
import { has, todayKey, localStamp } from "./util.js";
import { applyRoll, dayRng, binPool, grantHomunculus, isGrave, petBinIndex } from "./pets.js";

export const shopOpen = () => S.folderFormat >= C.FORMAT_REV;
export const spentTotal = p => (p.spends || []).reduce((a, s) => a + (Number(s.cost) || 0), 0);
export const balance = p => tokensEarned(p) - spentTotal(p);
export const priceOf = kind => C.SHOP_PRICES[petBinIndex(kind)];

function spend(p, kind, cost, extra) {
  const s = Object.assign({ id: "s:" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
                            at: localStamp(new Date()), kind, cost, by: S.me || "" }, extra);
  if (!Array.isArray(p.spends)) p.spends = [];
  p.spends.push(s);
  return s;
}

/* Wear a new pet, unless the dragon is on: it is lost the moment it comes off. */
function wear(p, k) { if (petKindFor(p) !== C.MYSTERY_KIND) p.equippedPet = k; }
const newHue = k => k === C.JOKE_KIND ? 28 : Math.floor(Math.random() * 360);

/* ---- reroll ---------------------------------------------------------------- */
/* "" when allowed, otherwise why not. */
export function rerollBlock(p) {
  const key = todayKey();
  if (!shopOpen()) return "The shop needs the folder at format " + C.FORMAT_REV + " (Settings > Data format).";
  if (p.petRollDay !== key || !(Number(p.rollKind) >= 0)) return "Reach today's goal first: a reroll replaces today's roll.";
  if (p.rerollDay === key) return "Already rerolled today.";
  /* A new pen species today plus the full-pen reward means today's roll completed
     the pen; taking it back would leave the reward unearned. */
  if (p.rollWasNew && Number(p.rollKind) < C.PET_COUNT && has(p.pets, C.HOMUNCULUS_KIND)) {
    return "Today's roll completed the pen; it cannot be rerolled.";
  }
  if (balance(p) < C.REROLL_COST) return "Needs " + C.REROLL_COST + " token.";
  return "";
}

/* Takes back today's roll as an undo would, then rolls again from the day's reroll
   seed with the same odds as any day. Returns { from, res } or null. */
export async function reroll(p) {
  if (rerollBlock(p)) return null;
  const key = todayKey(), from = Number(p.rollKind), drop = [];
  if (p.rollWasNew && has(p.pets, from)) {
    delete p.pets[String(from)];
    drop.push(String(from));
    if (petKindFor(p) === from) p.equippedPet = C.PET_NO_PET;
  }
  p.lastRoll = (p.prevRoll === undefined) ? C.PET_NO_PET : p.prevRoll;
  p.petRollDay = "";
  p.rerollDay = key;
  const res = applyRoll(p, dayRng(p.name, key + "#reroll"), key);
  spend(p, "reroll", C.REROLL_COST, { pet: res.kind, from, fresh: !!res.fresh });
  const removed = drop.filter(k => !has(p.pets, k));             /* it may have come up again */
  if (!(await saveParticipant(p, null, removed, null, true))) return null;
  return { from, res };
}

/* ---- Plinko ---------------------------------------------------------------- */
export function plinkoBlock(p) {
  if (!shopOpen()) return "The shop needs the folder at format " + C.FORMAT_REV + " (Settings > Data format).";
  if (balance(p) < C.PLINKO_COST) return "Needs " + C.PLINKO_COST + " token.";
  if (!C.PET_BINS.some(b => binPool(b, p).length)) return "Every pet is buried. There is nothing left to win.";
  return "";
}

/* Chance of each rarity on the board: the binomial share of its slots. */
export function plinkoOdds() {
  const n = C.PLINKO_ROWS, odds = C.PET_BINS.map(() => 0);
  let c = 1;                                                   /* C(n, k), built up */
  for (let k = 0; k <= n; k++) {
    odds[C.PLINKO_SLOTS[k]] += c / Math.pow(2, n);
    c = c * (n - k) / (k + 1);
  }
  return odds;
}

/* A real drop: a fair 50/50 bounce at every peg, and the slot it ends in decides the
   rarity. Then a species the way a roll picks one: never buried, preferring one not
   owned yet. kind is -1 when every species of that rarity is buried. */
export function plinkoDrop(p, rnd = Math.random) {
  const path = Array.from({ length: C.PLINKO_ROWS }, () => rnd() < 0.5 ? 0 : 1);
  const slot = path.reduce((a, b) => a + b, 0), bin = C.PLINKO_SLOTS[slot];
  const pool = binPool(C.PET_BINS[bin], p);
  return { path, slot, bin, kind: pool.length ? pool[Math.floor(rnd() * pool.length)] : C.PET_NO_PET };
}

/* Spends a token and awards the pet now; the board only shows it. A landing with
   nothing left to give (every species of that rarity buried) costs nothing. */
export async function plinkoPlay(p) {
  if (plinkoBlock(p)) return null;
  const d = plinkoDrop(p), empty = d.kind < 0, fresh = !empty && !has(p.pets, d.kind);
  const hue = empty ? 0 : has(p.pets, d.kind) ? Number(p.pets[String(d.kind)]) : newHue(d.kind);
  if (fresh) { p.pets[String(d.kind)] = hue; wear(p, d.kind); }
  const homunculus = fresh && grantHomunculus(p);
  const s = spend(p, "plinko", empty ? 0 : C.PLINKO_COST, { pet: d.kind, bin: d.bin, slot: d.slot, fresh });
  if (!(await saveParticipant(p, null))) return null;
  return { id: s.id, at: Date.now(), name: p.name, color: p.color, kind: d.kind, bin: d.bin, hue, fresh, empty,
           homunculus, slot: d.slot, path: d.path };
}

/* ---- buying ---------------------------------------------------------------- */
export function buyBlock(p, k) {
  if (!shopOpen()) return "The shop needs the folder at format " + C.FORMAT_REV + " (Settings > Data format).";
  if (!(k >= 0 && k < C.PET_COUNT)) return "Not for sale.";
  if (has(p.pets, k)) return "Already owned.";
  if (isGrave(p, k)) return "Buried: gone for good.";
  if (balance(p) < priceOf(k)) return "Needs " + priceOf(k) + " tokens.";
  return "";
}

export async function buy(p, k) {
  if (buyBlock(p, k)) return null;
  const hue = newHue(k);
  p.pets[String(k)] = hue;
  wear(p, k);
  const homunculus = grantHomunculus(p);
  spend(p, "buy", priceOf(k), { pet: k });
  if (!(await saveParticipant(p, null))) return null;
  return { kind: k, hue, homunculus };
}

/* Today's and a given day's shop events, for the activity feed and the recap. */
export function spendsOn(p, key) { return (p.spends || []).filter(s => String(s.at).slice(0, 10) === key); }
