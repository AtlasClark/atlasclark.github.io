/* Pet rules: the seeded daily roll, drowning past the cap, take-backs on undo,
   equipping, the full-pen reward and the one that is not in the pen.
   The RNG arithmetic must stay plain IEEE doubles, exactly as in R55, so the web
   page and the HTA reach the same pet for the same person on the same day. */

import * as C from "./config.js";
import { S, metGoal, personalGoal, findParticipant, totalOn, pastCap, isActive } from "./model.js";
import { saveParticipant, petKindFor } from "./store.js";
import { todayKey, has, bus } from "./util.js";

export { petKindFor };

export const isGrave = (p, k) => has(p.graves, k);
export const graveEquipped = p => { const k = petKindFor(p); return k >= 0 && isGrave(p, k); };
export const ownsEquipped = p => { const k = petKindFor(p); return k >= 0 && has(p.pets, k); };
export const gravesOf = p => p.graves ? Object.keys(p.graves).length : 0;
export const petsOwned = p => p.pets ? Object.keys(p.pets).length : 0;
export const graveLine = k => C.GRAVE_LINES[k % C.GRAVE_LINES.length];
export const petLabel = k => k === C.JOKE_KIND ? "..." : C.PET_NAMES[k];
export function petName(k) {
  if (k === C.PET_NO_PET || k === undefined || k === null || !(k >= 0)) return "nothing";
  return k === C.JOKE_KIND ? "..." : (C.PET_NAMES[k] || "?");
}

export function hashHue(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

export function petHueFor(p) {
  const k = petKindFor(p);
  if (k < 0) return 0;
  if (has(p.pets, k)) return Number(p.pets[String(k)]);
  if (has(p.graves, k)) return Number(p.graves[String(k)]);
  return hashHue(p.name + k);
}

export function petRarityOf(kind) {
  for (const b of C.PET_BINS) if (b.kinds.includes(kind)) return b;
  return C.PET_BINS[0];
}
export function petBinIndex(kind) {
  const i = C.PET_BINS.findIndex(b => b.kinds.includes(kind));
  return i < 0 ? 0 : i;
}
export function petGridOrder() {
  const order = [];
  for (const b of C.PET_BINS) order.push(...b.kinds);
  return order;
}

/* Every one of the 25 accounted for; a grave counts as found. */
export function penComplete(p) {
  for (let k = 0; k < C.PET_COUNT; k++) if (!has(p.pets, k) && !isGrave(p, k)) return false;
  return true;
}
export function penFound(p) {
  let n = 0;
  for (let k = 0; k < C.PET_COUNT; k++) if (has(p.pets, k) || isGrave(p, k)) n++;
  return n;
}

export function grantHomunculus(p) {
  if (!penComplete(p) || has(p.pets, C.HOMUNCULUS_KIND)) return false;
  if (!p.pets) p.pets = {};
  p.pets[String(C.HOMUNCULUS_KIND)] = 210;
  if (petKindFor(p) !== C.MYSTERY_KIND) p.equippedPet = C.HOMUNCULUS_KIND;
  return true;
}

/* What a bin can still give: never a grave, preferring species not yet owned. */
export function binPool(b, p) {
  const live = [], fresh = [];
  for (const k of b.kinds) {
    if (p && isGrave(p, k)) continue;
    live.push(k);
    if (!(p && has(p.pets, k))) fresh.push(k);
  }
  return fresh.length ? fresh : live;
}

function dropLast(pool, last) {
  if (last === undefined || last === null || last < 0 || pool.length < 2) return pool;
  const out = pool.filter(k => k !== last);
  return out.length ? out : pool;
}

/* Seeded on person and date: the same pet comes up however often the goal is
   crossed, undone and crossed again, and on every machine. */
export function dayRng(name, key) {
  let h = 5381;
  const str = String(name) + "|" + String(key) + "|pet";
  for (let i = 0; i < str.length; i++) h = (h * 33 + str.charCodeAt(i)) % 2147483647;
  return function () {
    h = (h * 1103515245 + 12345) % 2147483647;
    return h / 2147483647;
  };
}

function rollPetKind(p, rnd) {
  const avail = [];
  let totalW = 0;
  const last = (p && p.lastRoll !== undefined && p.lastRoll !== null) ? Number(p.lastRoll) : C.PET_NO_PET;
  for (const b of C.PET_BINS) {
    const pool = binPool(b, p);
    if (pool.length) { avail.push({ w: b.weight, pool }); totalW += b.weight; }
  }
  if (!avail.length) return C.PET_NO_PET;
  let r = rnd() * totalW;
  for (const a of avail) {
    if (r < a.w) { const pool = dropLast(a.pool, last); return pool[Math.floor(rnd() * pool.length)]; }
    r -= a.w;
  }
  return dropLast(avail[avail.length - 1].pool, last)[0];
}

/* The day's roll is seeded on the date; once someone pays for a reroll, the
   day's pet is the rerolled one, so a later undo-and-redo gives it back. */
export function rollSeed(p, key) { return p.rerollDay === key ? key + "#reroll" : key; }

/* Read-only preview of today's roll; consumes draws in the same order. */
export function todaysPet(p) {
  const rnd = dayRng(p.name, rollSeed(p, todayKey()));
  if (rnd() < C.MYSTERY_CHANCE) return C.MYSTERY_KIND;
  return rollPetKind(p, rnd);
}

function petsList(p) {
  return Object.keys(p.pets || {}).map(Number).sort((a, b) => a - b);
}
const drownable = k => k >= 0 && k < C.PET_COUNT;

/* Same victim on every machine: a hash of name and date, not Math.random. */
export function pickVictim(p) {
  const list = petsList(p).filter(drownable);
  if (!list.length) return C.PET_NO_PET;
  const str = p.name + "|" + todayKey();
  let seed = 0;
  for (let i = 0; i < str.length; i++) seed = (seed * 31 + str.charCodeAt(i)) % 100003;
  return list[seed % list.length];
}

/* ---- events (each one saves; callers run inside serial()) --------------- */
async function undoRoll(p) {
  const k = Number(p.rollKind), wasNew = !!p.rollWasNew;
  let drop = null;
  if (p.petRollDay !== todayKey()) return false;
  if (!(k >= 0)) return false;                 /* stamped by an older build: leave alone */
  if (wasNew && has(p.pets, k)) {
    delete p.pets[String(k)];
    drop = [String(k)];
    if (petKindFor(p) === k) p.equippedPet = C.PET_NO_PET;
  }
  p.petRollDay = "";
  p.rollKind = C.PET_NO_PET;
  p.rollWasNew = false;
  p.lastRoll = (p.prevRoll === undefined) ? C.PET_NO_PET : p.prevRoll;
  logDay(p, "rollLog", todayKey(), { k: C.PET_NO_PET, n: 0 });
  if (!(await saveParticipant(p, null, drop, null, true))) return false;
  bus.msg(p.name + " dropped back under the goal. Roll reset.", false);
  return true;
}

async function revivePet(p) {
  const k = Number(p.deadKind);
  if (p.graveDay !== todayKey() || !(k >= 0) || !has(p.graves, k)) return false;
  const hue = Number(p.graves[String(k)]);
  delete p.graves[String(k)];
  if (!p.pets) p.pets = {};
  p.pets[String(k)] = hue;
  p.graveDay = "";
  p.deadKind = C.PET_NO_PET;
  if (petKindFor(p) === k || petKindFor(p) === C.PET_NO_PET) p.equippedPet = k;
  logDay(p, "graveLog", todayKey(), C.PET_NO_PET);
  if (!(await saveParticipant(p, null, null, [String(k)]))) return false;
  bus.msg(p.name + " is back under the cap. The " + petLabel(k) + " made it after all.", true);
  return true;
}

/* Per-day logs (format 22 only; dropped at 21). They let the recap name each
   day's roll and drowning after newer days have replaced petRollDay and graveDay. */
export function logDay(p, log, key, value) {
  if (!p[log] || typeof p[log] !== "object") p[log] = {};
  p[log][key] = value;
}

/* One roll, applied to p in memory: the draws, in R55's order, from rnd. Shared by
   the daily roll and the paid reroll. Returns what happened, for announce(). */
export function applyRoll(p, rnd, key) {
  if (!p.pets) p.pets = {};
  if (rnd() < C.MYSTERY_CHANCE) {
    p.pets[String(C.MYSTERY_KIND)] = 0;
    p.equippedPet = C.MYSTERY_KIND;
    p.prevRoll = (p.lastRoll === undefined) ? C.PET_NO_PET : p.lastRoll;
    p.rollKind = C.MYSTERY_KIND;
    p.rollWasNew = true;
    p.petRollDay = key;
    logDay(p, "rollLog", key, { k: C.MYSTERY_KIND, n: 1 });
    return { kind: C.MYSTERY_KIND, hue: 0, fresh: true, mystery: true };
  }
  const k = rollPetKind(p, rnd);
  if (k === C.PET_NO_PET) { p.petRollDay = key; return { kind: C.PET_NO_PET }; }
  const hue = (k === C.JOKE_KIND) ? 28 : Math.floor(rnd() * 360);
  const dup = has(p.pets, k);
  if (!dup) p.pets[String(k)] = hue;
  if (petKindFor(p) !== C.MYSTERY_KIND) p.equippedPet = k;   /* never throw off a worn dragon */
  p.prevRoll = (p.lastRoll === undefined) ? C.PET_NO_PET : p.lastRoll;
  p.lastRoll = k;
  p.rollKind = k;
  p.rollWasNew = !dup;
  p.petRollDay = key;
  logDay(p, "rollLog", key, { k, n: dup ? 0 : 1 });
  return { kind: k, hue: Number(p.pets[String(k)]), fresh: !dup, homunculus: grantHomunculus(p) };
}

/* Status line and unlock card for a roll that has been saved. */
export function announce(p, res, how) {
  const k = res.kind, verb = how || "";
  if (k === C.PET_NO_PET) {
    bus.msg(p.name + " has buried every pet there is. There is nothing left to find.", false);
  } else if (res.mystery) {
    bus.msg(p.name + verb + " found something that does not live in the pen. Keep it on -- it will not wait around.", true);
    bus.unlock({ name: p.name, kind: C.MYSTERY_KIND, hue: 0, fresh: true, equipped: true });
  } else if (res.homunculus) {
    bus.msg(p.name + " has found all " + C.PET_COUNT + ". The pen has produced something none of them are on their own.", true);
    bus.unlock({ name: p.name, kind: C.HOMUNCULUS_KIND, hue: 210, fresh: true, rolled: k,
                 equipped: petKindFor(p) === C.HOMUNCULUS_KIND });
  } else {
    bus.unlock({ name: p.name, kind: k, hue: res.hue, fresh: res.fresh, equipped: petKindFor(p) === k });
    bus.msg(p.name + verb + (res.fresh ? " unlocked the " : " rolled another ") + petLabel(k) +
            " (" + petRarityOf(k).name + ")" + (res.fresh ? "!" : ", which they already had."), true);
  }
}

async function maybeRollPet(p) {
  const key = todayKey();
  if (p.petRollDay === key) return false;
  const res = applyRoll(p, dayRng(p.name, rollSeed(p, key)), key);
  if (await saveParticipant(p, null)) announce(p, res);
  return true;
}

function releaseMystery(p) {
  if (has(p.pets, C.MYSTERY_KIND)) { delete p.pets[String(C.MYSTERY_KIND)]; return [String(C.MYSTERY_KIND)]; }
  return null;
}

/* One drowning a day. R55 only blocked a second one when deadKind was set, so a
   drowned dragon (deadKind -1) let another machine drown a second pet; any
   drowning today now blocks the next. */
async function killPet(p) {
  if (p.graveDay === todayKey()) return null;
  let k = petKindFor(p), byLot = false;
  if (k < 0 || !has(p.pets, k)) { k = pickVictim(p); byLot = true; }
  if (k < 0 || !has(p.pets, k)) return null;
  const hue = Number(p.pets[String(k)]);
  delete p.pets[String(k)];
  logDay(p, "graveLog", todayKey(), k);
  if (k === C.MYSTERY_KIND) {
    p.graveDay = todayKey();
    p.deadKind = C.PET_NO_PET;
    if (!(await saveParticipant(p, null, [String(k)]))) return null;
    bus.msg(p.name + " lost what they had found. It was never really theirs.", false);
    return { kind: k, hue };
  }
  if (!p.graves) p.graves = {};
  p.graves[String(k)] = hue;
  p.graveDay = todayKey();
  p.deadKind = k;
  if (!(await saveParticipant(p, null, [String(k)]))) return null;
  bus.msg(p.name + " drowned " + (byLot ? "a " : "their ") + petLabel(k) +
          (byLot ? ", picked out of the collection." : ". Gone for good."), false);
  return { kind: k, hue };
}

/* Today's pet events are a function of today's totals, not a ratchet. Runs for
   every active person after each load and each action. */
export async function reconcilePets() {
  if (!C.EGG_ENABLED) return;
  const key = todayKey();
  for (const p of S.participants) {
    if (!isActive(p)) continue;
    const total = totalOn(p, key), goal = personalGoal(p, key);
    const met = metGoal(total, goal), danger = pastCap(total, p, key);
    if (met) await maybeRollPet(p);
    if (p.graveDay === key && Number(p.deadKind) >= 0 && !danger) {
      if (await revivePet(p)) bus.petReset(p.name);
    }
    if (p.petRollDay === key && Number(p.rollKind) >= 0 && !metGoal(totalOn(p, key), personalGoal(p, key))) {
      if (await undoRoll(p)) bus.petReset(p.name);
    }
    if (danger && p.graveDay !== key) {
      const dead = await killPet(p);
      if (dead) bus.drown(p.name, dead.kind, dead.hue);
    }
  }
}

/* Click a pet to wear it; click it again to take it off. */
export async function equipPet(name, kind) {
  const p = findParticipant(name);
  if (!p) return;
  const buried = isGrave(p, kind), label = petLabel(kind);
  if (!buried && !has(p.pets, kind)) { bus.msg("That one is still locked for " + p.name + ".", false); return; }
  if (petKindFor(p) === kind) {
    p.equippedPet = C.PET_NO_PET;
    const drop = kind === C.MYSTERY_KIND ? releaseMystery(p) : null;
    if (!(await saveParticipant(p, null, drop))) { bus.msg("Could not save the change.", false); return; }
    bus.msg(p.name + " put the " + label + " away.", true);
    return;
  }
  const drop = petKindFor(p) === C.MYSTERY_KIND ? releaseMystery(p) : null;   /* swapping away loses it */
  p.equippedPet = kind;
  if (!(await saveParticipant(p, null, drop))) { bus.msg("Could not save the change.", false); return; }
  bus.msg(buried ? p.name + " is carrying the " + label + "'s headstone around. Grim."
                 : p.name + " equipped the " + label + ".", true);
}

/* Rarity text for the activity feed. The reward and the one outside the pen have
   no bin (R55 showed them as Common). */
export function rarityLabel(k) {
  if (k === C.HOMUNCULUS_KIND) return "reward";
  if (k === C.MYSTERY_KIND) return "not in the pen";
  return petRarityOf(k).name;
}

/* What taking one of today's pours away would do to the pets, for the undo
   prompt. Mirrors reconcilePets: a revive when the total drops back under the
   cap, a take-back when it drops under the goal. */
export function undoEffect(p, eid) {
  const key = todayKey(), e = p.entries.find(x => x.eid === eid);
  if (!e || e.date !== key) return "";
  const total = totalOn(p, key), after = total - Number(e.oz), goal = personalGoal(p, key), bits = [];
  if (p.graveDay === key && Number(p.deadKind) >= 0 && pastCap(total, p, key) && !pastCap(after, p, key)) {
    bits.push("the " + petLabel(Number(p.deadKind)) + " comes back to life");
  }
  if (p.petRollDay === key && Number(p.rollKind) >= 0 && metGoal(total, goal) && !metGoal(after, goal)) {
    bits.push(p.rollWasNew ? "the " + petLabel(Number(p.rollKind)) + " goes back" : "today's roll is taken back");
  }
  return bits.join(", and ");
}
