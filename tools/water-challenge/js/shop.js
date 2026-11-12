/* The token shop: reroll today's pet and Plinko; shards (repeats bring in pets); and
   cosmetics (looks for the glass and the worn pet, cosmetics.js).
   Tokens are earned one per goal day (model.tokensEarned) and spent through a log
   of spends in each person's file.
   Every action here saves; callers run them inside store.serial(). */

import * as C from "./config.js";
import { S, tokensEarned, capBonus, dayWinners, findParticipant } from "./model.js";
import { saveParticipant, petKindFor, setSpendCheck } from "./store.js";
import { has, todayKey, localStamp, shiftKey, parseKey, aAn, spendsBy } from "./util.js";
import { applyRoll, dayRng, grantReward, isGrave, petBinIndex, penOf, binsFor, rollPen, pen2Open, pen3Open, pen3Earned, PEN3_CLOSED, hueOf } from "./pets.js";
import { statsOf, racesOn, makeField, raceOdds, runRace, racePay, betHit, raceGrowth, raceXp, levelOf, rng, canRace } from "./race.js";
import { COSMETICS, SLOTS, PAINT_COST } from "./cosmetics.js";
import { hydrationEarned } from "./hydration.js";
import { monsterEarned } from "./monster.js";

const isShell = s => C.SHELL_KINDS.includes(s.kind);
const isShard = s => C.SHARD_KINDS.includes(s.kind);
const isSplinko = s => s.kind === C.SPLINKO_KIND;
const notTokens = s => isShell(s) || isShard(s) || isSplinko(s);
const isRace = s => s.kind === C.RACE_KIND;
/* Games staked in shells, whose spend keeps { bet, won } and costs 0. */
const shellGame = s => isSplinko(s) || (isRace(s) && s.cur === "shell");
const raceWon = (p, cur) => spendsBy(p, C.RACE_KIND).reduce((a, s) => a + (s.cur === cur ? Number(s.won) || 0 : 0), 0);
export const spentTotal = p => (p.spends || []).reduce((a, s) => a + (notTokens(s) ? 0 : Number(s.cost) || 0), 0);
export const chestWinnings = p => (p.spends || []).reduce((a, s) => a + (s.chest ? Number(s.chest.won) || 0 : 0), 0);
/* Tokens won on race bets (a token stake is the spend's cost, so spentTotal has it). */
export const raceTokensWon = p => raceWon(p, "token");
export const earnedTotal = p => tokensEarned(p) + capBonus(p) + chestWinnings(p) + hydrationEarned(p).tokens + monsterEarned(p).tokens + raceTokensWon(p);

/* The Community Chest holds every token put in by a centre landing, less every win.
   It lives in the spend records, so it merges like everything else. Two wins at the
   same moment on two PCs could both pay out; the chest then refills from below zero. */
export function chestRaw() {
  let t = 0;
  for (const p of S.participants) for (const s of spendsBy(p, "plinko")) if (s.chest) t += (Number(s.chest.add) || 0) - (Number(s.chest.won) || 0);
  return t;
}
export const chestTotal = () => Math.max(0, chestRaw());
export const balance = p => earnedTotal(p) - spentTotal(p);

function spend(p, kind, cost, extra) {
  const s = Object.assign({ id: "s:" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
                            at: localStamp(new Date()), kind, cost, by: S.me || "" }, extra);
  if (!Array.isArray(p.spends)) p.spends = [];
  p.spends.push(s);
  return s;
}

/* A shop save that failed (the file stayed busy) takes its changes back out of memory,
   so a later save can't write a spend or a pet the player was told did not happen. */
const copy = p => structuredClone(p);
async function saveOrUndo(p, before, ...args) {
  if (await saveParticipant(p, ...args)) return true;
  for (const k of Object.keys(p)) delete p[k];
  Object.assign(p, before);
  return false;
}

/* Spends this save adds (not yet on disk) must leave what they are paid from at zero or
   more, counted on the merged record: shards of the tier spent, tokens, shells. A debt
   left by an older page (rev 1.32.0 and before could combine twice from one stale count)
   stays where it is and blocks nothing else. */
setSpendCheck((m, disk) => {
  const old = new Set(((disk && disk.spends) || []).map(s => s.id));
  const added = (m.spends || []).filter(s => s && !old.has(s.id));
  if (!added.length) return "";
  const n = shards(m);
  for (const s of added) {
    if ((s.kind === "fuse" || s.kind === "shard") && n[Number(s.tier)] < 0) return "not enough " + (C.PET_BINS[Number(s.tier)] || {}).name + " shards";
  }
  if (added.some(s => !notTokens(s) && Number(s.cost) > 0) && balance(m) < 0) return "not enough tokens";
  if (added.some(s => (isShell(s) && Number(s.cost) > 0) || (shellGame(s) && Number(s.bet) > 0)) && shellBalance(m) < 0) return "not enough shells";
  return "";
});

/* Wear a new pet, unless the dragon is on: it is lost the moment it comes off. */
function wear(p, k) { if (petKindFor(p) !== C.MYSTERY_KIND) p.equippedPet = k; }
const newHue = k => k === C.JOKE_KIND ? 28 : Math.floor(Math.random() * 360);

/* ---- reroll ---------------------------------------------------------------- */
/* "" when allowed, otherwise why not. */
export function rerollBlock(p) {
  const key = todayKey();
  if (p.petRollDay !== key || !(Number(p.rollKind) >= 0)) return "Reach today's goal first.";
  if (p.rerollDay === key) return "Already rerolled today.";
  /* A new pen species today plus that pen's full-pen reward means today's roll completed
     the pen; taking it back would leave the reward unearned. */
  const rw = C.PEN_REWARDS[penOf(Number(p.rollKind))];
  if (p.rollWasNew && rw && has(p.pets, rw.kind)) {
    return "Today's roll completed the pen.";
  }
  const t = tierOf(Number(p.rollKind));                          /* a repeat: its shard goes back */
  if (!p.rollWasNew && t >= 0 && shards(p)[t] < 1) return "Today's " + C.PET_BINS[t].name + " shard is already spent.";
  if (balance(p) < C.REROLL_COST) return "Needs " + C.REROLL_COST + " token.";
  return "";
}

/* Takes back today's roll as an undo would, then rolls again from the day's reroll
   seed with the same odds as any day. Returns { from, res } or null. */
export async function reroll(p) {
  if (rerollBlock(p)) return null;
  const before = copy(p), key = todayKey(), from = Number(p.rollKind), fromFresh = !!p.rollWasNew, drop = [];
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
  if (!(await saveOrUndo(p, before, null, removed, null, true))) return null;
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

/* What a rarity can give on Plinko: any of its species. One not alive joins (a buried
   one comes back); one already alive is a repeat and gives a shard. */
export function plinkoPool(bin, p) {
  return binsFor(rollPen(p))[bin].kinds.slice();
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
  const before = copy(p), d = plinkoDrop(p);
  if (d.chest) return chestPlay(p, d, Math.random, before);
  const empty = d.kind < 0, fresh = !empty && !has(p.pets, d.kind), was = petKindFor(p);
  const revived = fresh && isGrave(p, d.kind);
  const hue = empty ? 0 : has(p.pets, d.kind) ? Number(p.pets[String(d.kind)]) : revived ? Number(p.graves[String(d.kind)]) : newHue(d.kind);
  if (fresh) { give(p, d.kind, hue); wear(p, d.kind); }
  const reward = fresh ? grantReward(p) : null;
  const s = spend(p, "plinko", empty ? 0 : C.PLINKO_COST, { pet: d.kind, bin: d.bin, slot: d.slot, fresh, revived, was });
  if (!(await saveOrUndo(p, before, null, null, revived ? [String(d.kind)] : null))) return null;
  return { id: s.id, at: Date.now(), name: p.name, color: p.color, kind: d.kind, bin: d.bin, hue, fresh, empty, revived,
           reward, was, slot: d.slot, path: d.path };
}

/* ---- shell Plinko: the same drop, paid in shells --------------------------------- */
/* What a cup pays on a stake: the multiplier, rounded up to whole shells. */
export const splinkoPay = (bin, bet) => Math.ceil(bet * C.splinkoMult(bin) - 1e-9);
export function splinkoBlock(p, bet) {
  if (!C.SPLINKO_BETS.includes(bet)) return "Pick " + C.SPLINKO_BETS.join(", ") + " shells.";
  if (shellBalance(p) < bet) return "Needs " + bet + " shells.";
  return "";
}
/* Takes the stake and pays the cup now; the board only shows it. */
export async function splinkoPlay(p, bet, rnd = Math.random) {
  if (splinkoBlock(p, bet)) return null;
  const before = copy(p);
  const path = Array.from({ length: C.PLINKO_ROWS }, () => rnd() < 0.5 ? 0 : 1);
  const slot = path.reduce((a, b) => a + b, 0), bin = C.PLINKO_SLOTS[slot], won = splinkoPay(bin, bet);
  const s = spend(p, C.SPLINKO_KIND, 0, { bet, won, bin, slot });
  if (!(await saveOrUndo(p, before, null))) return null;
  return { id: s.id, at: Date.now(), name: p.name, color: p.color, kind: C.PET_NO_PET, bin, slot, path, shell: { bet, won } };
}

/* ---- pet races (rules in race.js) -------------------------------------------------- */
/* The race p's pet k would run now: the field (five others, drawn for this pet, day and
   race number, so a reload shows the same one), every lane's odds, and the pet's stats. */
const setups = new Map();
export function raceSetup(p, k, day = todayKey()) {
  const house = k === C.RACE_HOUSE, me = house ? null : statsOf(p, k), n = racesOn(p, k, day), hue = house ? 0 : hueOf(p, k);
  const key = [p.name, k, day, n, house ? "" : me.st.join(".")].join("|");
  let s = setups.get(key);
  if (s && s.mine >= 0) s.field[s.mine].hue = hue;                  /* a recolour changes the picture, not the race */
  if (!s) {
    const field = makeField(house ? null : { kind: k, hue, st: me.st }, "race|" + p.name + "|" + k + "|" + day + "|" + n);
    s = { key, field, odds: raceOdds(field, "odds|" + key), me, n, mine: field.findIndex(f => f.me) };
    if (setups.size > 60) setups.clear();
    setups.set(key, s);
  }
  return s;
}
/* What bet = { cur: "shell" | "token", stake, on: lane, type: "win" | "top3" } pays if it comes in. */
export const racePayFor = (s, bet) => racePay(bet.cur, bet.type, ((bet.type === "top3" ? s.odds.top3 : s.odds.win) || [])[bet.on], bet.stake);
export const racesLeft = (p, k, day = todayKey()) => k === C.RACE_HOUSE ? Infinity : Math.max(0, C.RACE.perPet - racesOn(p, k, day));
/* "" when p's pet k may run with this bet, otherwise why not. Every race needs a stake.
   k = RACE_HOUSE is a house race: six strangers, no pet of p's, no daily limit, no experience. */
export function raceBlock(p, k, bet) {
  if (k !== C.RACE_HOUSE) {
    if (!has(p.pets, k)) return "Only a pet you have alive.";
    if (!canRace(k)) return "Pen rewards sit the races out.";
    if (!racesLeft(p, k)) return "Tired. Back tomorrow.";
  }
  if (!bet) return "";
  const token = bet.cur === "token";
  if (token ? bet.stake !== C.RACE.tokenBet : !C.RACE.shellBets.includes(bet.stake)) return "Pick a stake.";
  const s = raceSetup(p, k);
  if (!(bet.on >= 0 && bet.on < s.field.length) || !["win", "top3"].includes(bet.type)) return "Pick a racer.";
  if (!racePayFor(s, bet)) return "No payout on that one.";
  if (token) { if (balance(p) < bet.stake) return "Needs " + bet.stake + " token."; }
  else if (shellBalance(p) < bet.stake) return "Needs " + bet.stake + " shells.";
  return "";
}
/* Takes the stake, runs the race and saves what it gave (winnings, experience, stat
   changes) at once; the track only shows it. Returns what the track needs, or null. */
export async function racePlay(p, k, bet, seed = Math.floor(Math.random() * 4294967296)) {
  if (!bet || raceBlock(p, k, bet)) return null;
  const before = copy(p), s = raceSetup(p, k), res = runRace(s.field, seed);
  const house = !s.me, place = house ? 0 : res.place[s.mine], pay = racePayFor(s, bet), won = betHit(bet.type, res.place[bet.on]) ? pay : 0;
  const xp = house ? 0 : raceXp(place), level = house ? 0 : levelOf(s.me.xp + xp), levelUp = !house && level > s.me.level;
  const d = house ? null : raceGrowth(s.me.st, s.me.base, res.info[s.mine], place, levelUp, rng((seed ^ 0x5bd1e995) >>> 0));
  const sp = spend(p, C.RACE_KIND, bet.cur === "token" ? bet.stake : 0, house
    ? { pet: k, cur: bet.cur, bet: bet.stake, on: s.field[bet.on].kind, type: bet.type, won, place: res.place[bet.on], house: true }
    : { pet: k, cur: bet.cur, bet: bet.stake, on: s.field[bet.on].kind, type: bet.type, won, place, xp, d });
  if (!(await saveOrUndo(p, before, null))) return null;
  return { id: sp.id, at: Date.now(), name: p.name, color: p.color, kind: k, seed, field: s.field, mine: s.mine, bet: Object.assign({}, bet),
           pay, won, place, places: res.place, xp, d, level, levelUp, secs: res.secs };
}

/* ---- live 1v1 races (rev 1.49.0; the records are described at C.DUEL) ------------------ */
const isDuel = s => !!s && s.kind === C.DUEL.kind;
const duelsOf = p => spendsBy(p, C.DUEL.kind);
const answeredBy = (q, id) => duelsOf(q).some(s => (s.role === "take" || s.role === "pass") && s.ask === id);
/* p's challenges still open today: not taken back, not answered, the pet still alive. */
export function asksBy(p, day = todayKey()) {
  const sp = duelsOf(p).filter(s => String(s.at).slice(0, 10) === day);
  if (!sp.length) return sp;
  const shut = new Set(sp.filter(s => s.role === "drop").map(s => s.ask));
  return sp.filter(s => {
    if (s.role !== "ask" || String(s.at).slice(0, 10) !== day || shut.has(s.id) || !has(p.pets, s.pet)) return false;
    const q = findParticipant(s.to);
    return !!q && !answeredBy(q, s.id);
  });
}
/* Open challenges made to `name`, oldest first: [{ ask, from }]. */
export function asksFor(name, day = todayKey()) {
  const out = [];
  for (const p of S.participants) if (p.name !== name) for (const ask of asksBy(p, day)) if (ask.to === name) out.push({ ask, from: p });
  return out.sort((a, b) => String(a.ask.at) < String(b.ask.at) ? -1 : 1);
}
export function duelAskBlock(p, to, k) {
  if (!has(p.pets, k)) return "Only a pet you have alive.";
  if (!canRace(k)) return "Pen rewards sit the races out.";
  const q = findParticipant(to);
  if (!q || q.name === p.name) return "Pick a player.";
  if (asksBy(p).length) return "One challenge at a time.";
  return "";
}
async function duelNote(p, extra) {
  const before = copy(p), s = spend(p, C.DUEL.kind, 0, extra);
  return (await saveOrUndo(p, before, null)) ? s : null;
}
export const duelAsk = async (p, to, k) => duelAskBlock(p, to, k) ? null : duelNote(p, { role: "ask", to, pet: k });
export const duelDrop = (p, askId) => duelNote(p, { role: "drop", ask: askId });
export const duelPass = (p, ask, from) => duelNote(p, { role: "pass", ask: ask.id, from: from.name });
/* p accepts `ask` from `from` with pet k: the race is run and kept in p's file, with both
   pets as they are now, so every page replays the same race. Returns the record or null. */
export async function duelTake(p, from, ask, k, seed = Math.floor(Math.random() * 4294967296)) {
  if (!has(p.pets, k) || !canRace(k) || !asksFor(p.name).some(x => x.ask.id === ask.id)) return null;
  const st = statsOf(p, k).st, vst = statsOf(from, Number(ask.pet)).st, hue = hueOf(p, k), vhue = hueOf(from, Number(ask.pet));
  const res = runRace([{ st: vst }, { st }], seed);
  return duelNote(p, { role: "take", ask: ask.id, from: from.name, pet: k, vs: Number(ask.pet), st, vst, hue, vhue, seed,
                       win: res.place[1] === 1, secs: Math.round(res.secs * 10) / 10, t: Date.now() });
}
/* The two lanes of a "take" record written by `taker`: the challenger first. */
export function duelField(take, taker) {
  const from = findParticipant(take.from);
  return [{ kind: Number(take.vs), hue: Number(take.vhue) || 0, st: (take.vst || []).map(Number), who: take.from, tint: from ? from.color : "#888" },
          { kind: Number(take.pet), hue: Number(take.hue) || 0, st: (take.st || []).map(Number), who: taker.name, tint: taker.color }];
}
const wholeTake = s => isDuel(s) && s.role === "take" && Array.isArray(s.st) && Array.isArray(s.vst) && s.st.length === 5 && s.vst.length === 5 && isFinite(Number(s.t));
/* When a 1v1 race's result may show, in ms. */
export const duelEnds = s => Number(s.t) + (C.DUEL.lead + (Number(s.secs) || 0) / C.RACE.rate) * 1000;
/* 1v1 races not finished yet on the clock: [{ take, p }]. */
export function duelsNow(now = Date.now()) {
  const out = [];
  for (const p of S.participants) for (const s of duelsOf(p)) if (wholeTake(s) && now < duelEnds(s) && now > Number(s.t) - 30000) out.push({ take: s, p });
  return out.sort((a, b) => a.take.t - b.take.t);
}
/* name's pet k in 1v1 races: { won, lost }, from everyone's records. */
export function duelRecord(name, k) {
  let won = 0, lost = 0;
  for (const p of S.participants) for (const s of duelsOf(p)) {
    if (s.role !== "take") continue;
    if (p.name === name && Number(s.pet) === k) { if (s.win) won++; else lost++; }
    else if (s.from === name && Number(s.vs) === k) { if (s.win) lost++; else won++; }
  }
  return { won, lost };
}

/* The centre cup: the token goes into the chest; if the chest held anything, a
   CHEST_CHANCE roll wins all of it, this token included. */
async function chestPlay(p, d, rnd = Math.random, prior = copy(p)) {
  const before = chestTotal(), add = C.PLINKO_COST;
  const won = before > 0 && rnd() < C.CHEST_CHANCE ? before + add : 0;
  const s = spend(p, "plinko", C.PLINKO_COST, { pet: C.PET_NO_PET, bin: C.CHEST, slot: d.slot, chest: { add, won } });
  if (!(await saveOrUndo(p, prior, null))) return null;
  return { id: s.id, at: Date.now(), name: p.name, color: p.color, kind: C.PET_NO_PET, bin: C.CHEST, chest: { add, won },
           pot: before + add - won, slot: d.slot, path: d.path };
}

/* Into the collection; a buried one leaves its grave and keeps its colour. */
function give(p, k, hue) {
  if (isGrave(p, k)) delete p.graves[String(k)];
  p.pets[String(k)] = hue;
}

/* ---- shards: repeats bring in pets --------------------------------------------- */
/* A repeat gives a shard of its rarity: a goal roll or reroll whose day log says
   n: 0, or a Plinko win already alive. "fuse" spends turn SHARD_FUSE of a rarity into
   1 of the next; "shard" spends bring in one pet. All of it comes from the day logs
   and spends, so it merges across PCs and an undone or rerolled roll takes its shard
   back. skip (reveal.js): { roll: leave out today's roll, ids: Plinko spends to leave out }. */
export const tierOf = k => penOf(k) > 0 ? petBinIndex(k) : -1;
export function shards(p, skip = {}) {
  const n = C.PET_BINS.map(() => 0), today = todayKey();
  for (const [key, r] of Object.entries(p.rollLog || {})) {
    if (!r || r.n !== 0 || !(Number(r.k) >= 0) || (skip.roll && key === today)) continue;
    const t = tierOf(Number(r.k));
    if (t >= 0) n[t]++;
  }
  for (const s of p.spends || []) {
    const t = Number(s.tier);
    if (s.kind === "plinko" && !s.chest && !s.fresh && Number(s.pet) >= 0 && !(skip.ids && skip.ids.has(s.id))) {
      const u = tierOf(Number(s.pet));
      if (u >= 0) n[u]++;
    } else if (s.kind === "fuse" && t >= 0 && t < n.length - 1) { n[t] -= C.SHARD_FUSE; n[t + 1]++; }
    else if (s.kind === "shard" && t >= 0 && t < n.length) n[t] -= Number(s.cost) || 1;   /* 1 before rev 1.37.0 */
  }
  return n;
}

export function fuseBlock(p, t) {
  if (!(t >= 0 && t < C.PET_BINS.length - 1)) return "Nothing above " + (C.PET_BINS[t] ? C.PET_BINS[t].name : "that") + ".";
  if (shards(p)[t] < C.SHARD_FUSE) return "Needs " + C.SHARD_FUSE + " " + C.PET_BINS[t].name + " shards.";
  return "";
}
/* SHARD_FUSE shards of rarity t become 1 of t + 1. Returns the new rarity or null. */
export async function fuse(p, t) {
  if (fuseBlock(p, t)) return null;
  const before = copy(p);
  spend(p, "fuse", C.SHARD_FUSE, { tier: t });
  return (await saveOrUndo(p, before, null)) ? t + 1 : null;
}

/* Shards of its rarity a pet costs to bring in: more for the later pens. */
export const shardCost = k => C.SHARD_COST[penOf(k)] || 1;
/* "a Rare shard" / "2 Rare shards" */
export const shardsText = (n, tier) => (n === 1 ? aAn(C.PET_BINS[tier].name) + " shard" : n + " " + C.PET_BINS[tier].name + " shards");
export function pickBlock(p, k) {
  if (penOf(k) === 0) return "Not in the pen.";
  if (penOf(k) === 2 && !pen2Open(p)) return "Opens with the second pen.";
  if (penOf(k) === 3 && !pen3Open(p)) return pen3Earned(p) ? PEN3_CLOSED : "Opens with the third pen.";
  if (has(p.pets, k)) return "Already alive.";
  const t = petBinIndex(k);
  if (shards(p)[t] < shardCost(k)) return "Needs " + shardsText(shardCost(k), t) + ".";
  return "";
}
/* shardCost shards of its rarity bring in a pet not alive; a buried one keeps its colour. */
export async function pickPet(p, k) {
  if (pickBlock(p, k)) return null;
  const before = copy(p), revived = isGrave(p, k), hue = revived ? Number(p.graves[String(k)]) : newHue(k);
  give(p, k, hue);
  wear(p, k);
  const reward = grantReward(p);
  spend(p, "shard", shardCost(k), { pet: k, tier: petBinIndex(k), revived });
  if (!(await saveOrUndo(p, before, null, null, revived ? [String(k)] : null))) return null;
  return { kind: k, hue, reward, revived };
}

/* Plinko drops of p this page must not show yet (wins, repeats and their shards, chest
   drops, shell drops): [{ id, pet, fresh, revived, was, chest, shell }].
   The result is saved before the ball falls, so a drop stays hidden until its ball
   lands here (landed ids), or for holdMs after it when this page never shows the ball. */
export function pendingDrops(p, inFlight, landed, now, holdMs) {
  const out = new Map(), cut = localStamp(new Date(now - holdMs - 60000));      /* older than this by its own stamp: not held, no date to parse */
  for (const s of spendsBy(p, "plinko").concat(spendsBy(p, C.SPLINKO_KIND))) {
    const shell = isSplinko(s);
    if (String(s.at) < cut || landed.has(s.id) || !(shell || s.fresh || s.chest || Number(s.pet) >= 0)) continue;
    const age = now - new Date(s.at).getTime();
    if (age > -5000 && age < holdMs) out.set(s.id, shell ? { id: s.id, pet: C.PET_NO_PET, shell: { bet: s.bet, won: s.won } } : s);   /* a few seconds of clock skew between PCs */
  }
  for (const ev of inFlight) {
    if (ev.name !== p.name || !(ev.fresh || ev.chest || ev.kind >= 0 || ev.shell) || landed.has(ev.id)) continue;
    out.set(ev.id, { id: ev.id, pet: ev.kind, fresh: ev.fresh, revived: ev.revived, was: ev.was, chest: ev.chest, shell: ev.shell });
  }
  return [...out.values()];
}

/* Today's and a given day's shop events, for the activity feed and the recap. */
/* One person's shop day in short, for the recap: what Plinko gave and cost (new pets,
   pets back from the grave, repeats, chest), pets bought (old) or brought in with
   shards, shards combined, the rerolls. */
export function shopDay(p, key) {
  const d = { drops: 0, spent: 0, fresh: [], revived: [], repeats: 0, empty: 0, chestIn: 0, chestWon: 0, buys: [], picks: [], fuses: [], rerolls: [], style: [], sDrops: 0, sBet: 0, sWon: 0, races: [] };
  for (const s of spendsOn(p, key)) {
    if (!notTokens(s)) d.spent += Number(s.cost) || 0;
    if (s.kind === "plinko") {
      d.drops++;
      if (s.chest) { d.chestIn += Number(s.chest.add) || 0; d.chestWon += Number(s.chest.won) || 0; }
      else if (!(Number(s.pet) >= 0)) d.empty++;
      else if (s.revived) d.revived.push(Number(s.pet));
      else if (s.fresh) d.fresh.push(Number(s.pet));
      else d.repeats++;
    } else if (isSplinko(s)) { d.sDrops++; d.sBet += Number(s.bet) || 0; d.sWon += Number(s.won) || 0; }
    else if (isRace(s)) d.races.push(s);
    else if (s.kind === "buy") d.buys.push(s);
    else if (s.kind === "shard") d.picks.push(s);
    else if (s.kind === "fuse") d.fuses.push(s);
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
export const ownsCosmetic = (p, id) => spendsBy(p, "cosmetic").some(s => s.item === id);

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
  const it = COSMETICS[id], before = copy(p);
  spend(p, "cosmetic", it.price, { item: id });
  p.look = Object.assign({}, p.look, { [it.slot]: it.key });
  if (!(await saveOrUndo(p, before, null))) return null;
  return it;
}

/* Put an owned item on, or take its slot off (on = false). */
export async function wearCosmetic(p, id, on) {
  const it = COSMETICS[id];
  if (!it || (on && !ownsCosmetic(p, id))) return false;
  const before = copy(p), look = Object.assign({}, p.look);
  if (on) look[it.slot] = it.key; else if (look[it.slot] === it.key) delete look[it.slot];
  p.look = look;
  return saveOrUndo(p, before, null);
}

/* What p's glass shows: worn and owned only. */
export function lookOf(p) {
  const out = {}, look = (p && p.look) || {};
  for (const { key } of SLOTS) if (look[key] && ownsCosmetic(p, key + ":" + look[key])) out[key] = look[key];
  return out;
}

/* Recolour: a pet you have alive takes a new hue, for PAINT_COST. The latest "paint"
   spend for a kind wins over the hue it was caught with (pets.js hueOf). */
export function paintBlock(p, k) {
  if (!has(p.pets, k)) return "Only a pet you have alive.";
  if (shellBalance(p) < PAINT_COST) return "Needs " + PAINT_COST + " shell" + (PAINT_COST === 1 ? "" : "s") + ".";
  return "";
}
export async function paintPet(p, k, hue) {
  if (paintBlock(p, k)) return null;
  const before = copy(p), h = ((Math.round(Number(hue)) % 360) + 360) % 360;
  spend(p, "paint", PAINT_COST, { pet: k, hue: h });
  if (!(await saveOrUndo(p, before, null))) return null;
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
export function shellsEarned(p) { return Object.values(runs(p)).reduce((a, r) => a + shellAward(r), 0) + hydrationEarned(p).shells + monsterEarned(p).shells + winShells(p) + splinkoWon(p) + raceWon(p, "shell"); }
/* Shells won back on shell Plinko (the stakes are in shellsSpent). */
export const splinkoWon = p => spendsBy(p, C.SPLINKO_KIND).reduce((a, s) => a + (Number(s.won) || 0), 0);
/* Day wins pay WIN_SHELLS, split between that day's winners (model.dayWinners). */
export const winShare = n => n ? Math.ceil(C.WIN_SHELLS / n) : 0;
export function winShells(p) {
  const days = new Set((p.entries || []).filter(e => Number(e.oz) > 0 && e.date >= C.SHELLS_SINCE).map(e => e.date));
  let n = 0;
  for (const d of days) { const w = dayWinners(d); if (w.includes(p.name)) n += winShare(w.length); }
  return n;
}
export const shellsSpent = p => (p.spends || []).reduce((a, s) => a + (isShell(s) ? Number(s.cost) || 0 : shellGame(s) ? Number(s.bet) || 0 : 0), 0);
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
