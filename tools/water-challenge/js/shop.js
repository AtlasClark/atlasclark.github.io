/* The token shop: reroll today's pet, Plinko, buying a species outright, and
   cosmetics (looks for the glass and the worn pet, cosmetics.js).
   Tokens are earned one per goal day (model.tokensEarned) and spent through a log
   of spends in each person's file.
   Every action here saves; callers run them inside store.serial(). */

import * as C from "./config.js";
import { S, tokensEarned, capBonus } from "./model.js";
import { saveParticipant, petKindFor } from "./store.js";
import { has, todayKey, localStamp, shiftKey, parseKey } from "./util.js";
import { applyRoll, dayRng, grantHomunculus, isGrave, petBinIndex, penOf, binsFor, rollPen, pen2Open } from "./pets.js";
import { COSMETICS, SLOTS, PAINT_COST } from "./cosmetics.js";
import { hydrationEarned } from "./hydration.js";

const isShell = s => C.SHELL_KINDS.includes(s.kind);
export const spentTotal = p => (p.spends || []).reduce((a, s) => a + (isShell(s) ? 0 : Number(s.cost) || 0), 0);
export const chestWinnings = p => (p.spends || []).reduce((a, s) => a + (s.chest ? Number(s.chest.won) || 0 : 0), 0);
export const earnedTotal = p => tokensEarned(p) + capBonus(p) + chestWinnings(p) + hydrationEarned(p).tokens;

/* The Community Chest holds every token put in by a centre landing, less every win.
   It lives in the spend records, so it merges like everything else. Two wins at the
   same moment on two PCs could both pay out; the chest then refills from below zero. */
export function chestRaw() {
  let t = 0;
  for (const p of S.participants) for (const s of p.spends || []) if (s.chest) t += (Number(s.chest.add) || 0) - (Number(s.chest.won) || 0);
  return t;
}
export const chestTotal = () => Math.max(0, chestRaw());
export const balance = p => earnedTotal(p) - spentTotal(p);
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
  if (p.petRollDay !== key || !(Number(p.rollKind) >= 0)) return "Reach today's goal first.";
  if (p.rerollDay === key) return "Already rerolled today.";
  /* A new pen species today plus the full-pen reward means today's roll completed
     the pen; taking it back would leave the reward unearned. */
  if (p.rollWasNew && penOf(Number(p.rollKind)) === 1 && has(p.pets, C.HOMUNCULUS_KIND)) {
    return "Today's roll completed the pen.";
  }
  if (balance(p) < C.REROLL_COST) return "Needs " + C.REROLL_COST + " token.";
  return "";
}

/* Takes back today's roll as an undo would, then rolls again from the day's reroll
   seed with the same odds as any day. Returns { from, res } or null. */
export async function reroll(p) {
  if (rerollBlock(p)) return null;
  const key = todayKey(), from = Number(p.rollKind), fromFresh = !!p.rollWasNew, drop = [];
  if (p.rollWasNew && has(p.pets, from)) {
    delete p.pets[String(from)];
    drop.push(String(from));
    if (petKindFor(p) === from) p.equippedPet = C.PET_NO_PET;
  }
  p.lastRoll = (p.prevRoll === undefined) ? C.PET_NO_PET : p.prevRoll;
  p.petRollDay = "";
  p.rerollDay = key;
  const res = applyRoll(p, dayRng(p.name, key + "#reroll"), key);
  spend(p, "reroll", C.REROLL_COST, { pet: res.kind, from, fromFresh, fresh: !!res.fresh });
  const removed = drop.filter(k => !has(p.pets, k));             /* it may have come up again */
  if (!(await saveParticipant(p, null, removed, null, true))) return null;
  return { from, res };
}

/* ---- Plinko ---------------------------------------------------------------- */
export function plinkoBlock(p) {
  if (balance(p) < C.PLINKO_COST) return "Needs " + C.PLINKO_COST + " token.";
  return "";
}

/* Chance of each slot kind on the board: the binomial share of its slots.
   plinkoOdds() is per rarity; chestOdds() is the centre cup. */
function slotOdds() {
  const n = C.PLINKO_ROWS, odds = new Map();
  let c = 1;                                                   /* C(n, k), built up */
  for (let k = 0; k <= n; k++) {
    odds.set(C.PLINKO_SLOTS[k], (odds.get(C.PLINKO_SLOTS[k]) || 0) + c / Math.pow(2, n));
    c = c * (n - k) / (k + 1);
  }
  return odds;
}
export const plinkoOdds = () => C.PET_BINS.map((_, i) => slotOdds().get(i) || 0);
export const chestOdds = () => slotOdds().get(C.CHEST) || 0;

/* What a rarity can give on Plinko: species they don't have alive (unowned or
   buried) first; once every one is alive, any of them (a duplicate). */
export function plinkoPool(bin, p) {
  const kinds = binsFor(rollPen(p))[bin].kinds, missing = kinds.filter(k => !has(p.pets, k));
  return missing.length ? missing : kinds.slice();
}

/* A real drop: a fair 50/50 bounce at every peg, and the slot it ends in decides the
   rarity, then a species from plinkoPool. */
export function plinkoDrop(p, rnd = Math.random) {
  const path = Array.from({ length: C.PLINKO_ROWS }, () => rnd() < 0.5 ? 0 : 1);
  const slot = path.reduce((a, b) => a + b, 0), bin = C.PLINKO_SLOTS[slot];
  if (bin === C.CHEST) return { path, slot, bin, chest: true, kind: C.PET_NO_PET };
  const pool = plinkoPool(bin, p);
  return { path, slot, bin, kind: pool.length ? pool[Math.floor(rnd() * pool.length)] : C.PET_NO_PET };
}

/* Spends a token and awards the pet now; the board only shows it. A landing with
   nothing left to give (every species of that rarity buried) costs nothing. */
export async function plinkoPlay(p) {
  if (plinkoBlock(p)) return null;
  const d = plinkoDrop(p);
  if (d.chest) return chestPlay(p, d);
  const empty = d.kind < 0, fresh = !empty && !has(p.pets, d.kind), was = petKindFor(p);
  const revived = fresh && isGrave(p, d.kind);
  const hue = empty ? 0 : has(p.pets, d.kind) ? Number(p.pets[String(d.kind)]) : revived ? Number(p.graves[String(d.kind)]) : newHue(d.kind);
  if (fresh) { give(p, d.kind, hue); wear(p, d.kind); }
  const homunculus = fresh && grantHomunculus(p);
  const s = spend(p, "plinko", empty ? 0 : C.PLINKO_COST, { pet: d.kind, bin: d.bin, slot: d.slot, fresh, revived, was });
  if (!(await saveParticipant(p, null, null, revived ? [String(d.kind)] : null))) return null;
  return { id: s.id, at: Date.now(), name: p.name, color: p.color, kind: d.kind, bin: d.bin, hue, fresh, empty, revived,
           homunculus, was, slot: d.slot, path: d.path };
}

/* The centre cup: the token goes into the chest; if the chest held anything, a
   CHEST_CHANCE roll wins all of it, this token included. */
async function chestPlay(p, d, rnd = Math.random) {
  const before = chestTotal(), add = C.PLINKO_COST;
  const won = before > 0 && rnd() < C.CHEST_CHANCE ? before + add : 0;
  const s = spend(p, "plinko", C.PLINKO_COST, { pet: C.PET_NO_PET, bin: C.CHEST, slot: d.slot, chest: { add, won } });
  if (!(await saveParticipant(p, null))) return null;
  return { id: s.id, at: Date.now(), name: p.name, color: p.color, kind: C.PET_NO_PET, bin: C.CHEST, chest: { add, won },
           pot: before + add - won, slot: d.slot, path: d.path };
}

/* Into the collection; a buried one leaves its grave and keeps its colour. */
function give(p, k, hue) {
  if (isGrave(p, k)) delete p.graves[String(k)];
  p.pets[String(k)] = hue;
}

/* ---- buying ---------------------------------------------------------------- */
export function buyBlock(p, k) {
  if (penOf(k) === 0) return "Not for sale.";
  if (penOf(k) === 2 && !pen2Open(p)) return "Opens with the second pen.";
  if (has(p.pets, k)) return "Already owned.";
  if (balance(p) < priceOf(k)) return "Needs " + priceOf(k) + " tokens.";
  return "";
}

export async function buy(p, k) {
  if (buyBlock(p, k)) return null;
  const revived = isGrave(p, k), hue = revived ? Number(p.graves[String(k)]) : newHue(k);
  give(p, k, hue);
  wear(p, k);
  const homunculus = grantHomunculus(p);
  spend(p, "buy", priceOf(k), { pet: k, revived });
  if (!(await saveParticipant(p, null, null, revived ? [String(k)] : null))) return null;
  return { kind: k, hue, homunculus, revived };
}

/* Plinko drops of p this page must not show yet: [{ id, pet, fresh, revived, was, chest }].
   The result is saved before the ball falls, so a drop stays hidden until its ball
   lands here (landed ids), or for holdMs after it when this page never shows the ball. */
export function pendingDrops(p, inFlight, landed, now, holdMs) {
  const out = new Map();
  for (const s of p.spends || []) {
    if (s.kind !== "plinko" || landed.has(s.id) || !(s.fresh || s.chest)) continue;
    const age = now - new Date(s.at).getTime();
    if (age > -5000 && age < holdMs) out.set(s.id, s);              /* a few seconds of clock skew between PCs */
  }
  for (const ev of inFlight) {
    if (ev.name !== p.name || !(ev.fresh || ev.chest) || landed.has(ev.id)) continue;
    out.set(ev.id, { id: ev.id, pet: ev.kind, fresh: ev.fresh, revived: ev.revived, was: ev.was, chest: ev.chest });
  }
  return [...out.values()];
}

/* Today's and a given day's shop events, for the activity feed and the recap. */
/* One person's shop day in short, for the recap: what Plinko gave and cost (new pets,
   pets back from the grave, repeats, chest), what was bought, the rerolls. */
export function shopDay(p, key) {
  const d = { drops: 0, spent: 0, fresh: [], revived: [], repeats: 0, empty: 0, chestIn: 0, chestWon: 0, buys: [], rerolls: [], style: [] };
  for (const s of spendsOn(p, key)) {
    if (!isShell(s)) d.spent += Number(s.cost) || 0;
    if (s.kind === "plinko") {
      d.drops++;
      if (s.chest) { d.chestIn += Number(s.chest.add) || 0; d.chestWon += Number(s.chest.won) || 0; }
      else if (!(Number(s.pet) >= 0)) d.empty++;
      else if (s.revived) d.revived.push(Number(s.pet));
      else if (s.fresh) d.fresh.push(Number(s.pet));
      else d.repeats++;
    } else if (s.kind === "buy") d.buys.push(s);
    else if (s.kind === "reroll") d.rerolls.push(s);
    else if (s.kind === "cosmetic" || s.kind === "paint") d.style.push(s);
  }
  return d;
}

export function spendsOn(p, key) { return (p.spends || []).filter(s => String(s.at).slice(0, 10) === key); }

/* ---- cosmetics --------------------------------------------------------------- */
/* Owned items are "cosmetic" spends, so they merge like every other spend and can
   never be bought twice by two windows at once without both being counted. What is
   worn is p.look ({ slot: key }), kept only while the item is owned. */
export const ownsCosmetic = (p, id) => (p.spends || []).some(s => s.kind === "cosmetic" && s.item === id);

export function cosmeticBlock(p, id) {
  const it = COSMETICS[id];
  if (!it) return "Not for sale.";
  if (ownsCosmetic(p, id)) return "Owned.";
  if (shellBalance(p) < it.price) return "Needs " + it.price + " shells.";
  return "";
}

/* Bought items go straight on. */
export async function buyCosmetic(p, id) {
  if (cosmeticBlock(p, id)) return null;
  const it = COSMETICS[id];
  spend(p, "cosmetic", it.price, { item: id });
  p.look = Object.assign({}, p.look, { [it.slot]: it.key });
  if (!(await saveParticipant(p, null))) return null;
  return it;
}

/* Put an owned item on, or take its slot off (on = false). */
export async function wearCosmetic(p, id, on) {
  const it = COSMETICS[id];
  if (!it || (on && !ownsCosmetic(p, id))) return false;
  const look = Object.assign({}, p.look);
  if (on) look[it.slot] = it.key; else if (look[it.slot] === it.key) delete look[it.slot];
  p.look = look;
  return saveParticipant(p, null);
}

/* What p's glass shows: worn and owned only. */
export function lookOf(p) {
  const out = {}, look = (p && p.look) || {};
  for (const { key } of SLOTS) if (look[key] && ownsCosmetic(p, key + ":" + look[key])) out[key] = look[key];
  return out;
}

/* Recolour: a pet you have alive takes a new hue, for PAINT_COST. The latest "paint"
   spend for a kind wins over the hue it was caught with (pets.js petHueFor). */
export function paintBlock(p, k) {
  if (!has(p.pets, k)) return "Only a pet you have alive.";
  if (shellBalance(p) < PAINT_COST) return "Needs " + PAINT_COST + " shell" + (PAINT_COST === 1 ? "" : "s") + ".";
  return "";
}
export async function paintPet(p, k, hue) {
  if (paintBlock(p, k)) return null;
  const h = ((Math.round(Number(hue)) % 360) + 360) % 360;
  spend(p, "paint", PAINT_COST, { pet: k, hue: h });
  if (!(await saveParticipant(p, null))) return null;
  return h;
}

/* ---- shells: earned by pouring ----------------------------------------------- */
/* Each day with a pour (from SHELLS_SINCE) pays the length of the run of pour days in
   a row it ends, up to SHELL_MAX: 1, 2, 3, 4, 5, 5, ... A weekday without one starts the
   run again at 1; weekend days (SHELL_FREE_DAYS) without one are passed over. Taken from
   the entries, so it merges and undoes like the water itself. */
const freeDay = k => C.SHELL_FREE_DAYS.includes(parseKey(k).getDay());
/* Every day after a and before b is a free day, so a run on a carries on to b. */
function joins(a, b) {
  for (let k = shiftKey(a, 1); k < b; k = shiftKey(k, 1)) if (!freeDay(k)) return false;
  return true;
}
function runs(p) {
  const days = [...new Set((p.entries || []).filter(e => Number(e.oz) > 0 && e.date >= C.SHELLS_SINCE).map(e => e.date))].sort(), out = {};
  let run = 0, prev = "";
  for (const d of days) { run = prev && joins(prev, d) ? run + 1 : 1; out[d] = run; prev = d; }
  return out;
}
export const shellAward = run => Math.min(C.SHELL_MAX, Math.max(1, run));
export function shellsEarned(p) { return Object.values(runs(p)).reduce((a, r) => a + shellAward(r), 0) + hydrationEarned(p).shells; }
export const shellsSpent = p => (p.spends || []).reduce((a, s) => a + (isShell(s) ? Number(s.cost) || 0 : 0), 0);
export const shellBalance = p => shellsEarned(p) - shellsSpent(p);
/* The run of pour days in a row up to today (or the last pour day before it, across
   any weekend days without a pour, before today's first pour). */
export function shellRun(p, key = todayKey()) {
  const r = runs(p);
  let k = shiftKey(key, -1);
  while (!r[k] && freeDay(k)) k = shiftKey(k, -1);
  return r[key] || r[k] || 0;
}
export const pouredOn = (p, key = todayKey()) => (p.entries || []).some(e => e.date === key && Number(e.oz) > 0);
