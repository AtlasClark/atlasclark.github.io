/* Pet races (rev 1.46.0): the rules, with no page and no saving in them.
   Every pet species has five racing stats baked in (baseStats: a fixed draw per kind,
   more points for rarer pets). A person's pet grows from its own races: each "race"
   spend keeps the experience and the stat changes it gave, so stats are summed from the
   spends and merge across PCs like everything else (statsOf).
   A race is a small simulation (runRace): the same field and seed always run the same
   race, on any screen. Odds are that simulation run many times (raceOdds). */

import * as C from "./config.js";

const R = C.RACE, N_STATS = C.RACE_STATS.length;
export const START = 0, SPEED = 1, STAMINA = 2, BURST = 3, FOCUS = 4;

/* ---- seeded random numbers ---------------------------------------------------- */
export function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function rng(seed) {
  let a = (typeof seed === "string" ? hash(seed) : seed) >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const sum = a => a.reduce((x, y) => x + y, 0);

/* ---- stats -------------------------------------------------------------------- */
/* 0-4 = the rarity of a pen pet, 5 = a full-pen reward, 6 = the dragon. */
export function raceTier(k) {
  if (k === C.MYSTERY_KIND) return 6;
  if (C.PEN_REWARDS.some(r => r && r.kind === k)) return 5;
  for (let pen = 1; pen < C.PEN_STARTS.length; pen++) {
    const i = k - C.PEN_STARTS[pen];
    if (i >= 0 && i < C.PET_COUNT) return Math.max(0, C.PET_BINS.findIndex(b => b.kinds.includes(i)));
  }
  return 0;
}

/* A species' own stats: the same on every PC and for every person. The points to share
   out come from its rarity; how they are shared is a fixed draw for that kind. */
const baseCache = new Map();
export function baseStats(k) {
  let st = baseCache.get(k);
  if (st) return st;
  const r = rng("racestat|" + k), total = R.base[raceTier(k)] * N_STATS;
  const raw = Array.from({ length: N_STATS }, () => 0.55 + r() * 0.9), f = total / sum(raw);
  st = raw.map(v => clamp(Math.round(v * f), 18, 85));
  let off = total - sum(st);                                   /* rounding: the points left over go one at a time */
  for (let i = 0; off !== 0 && i < 40; i++) {
    const j = i % N_STATS, d = Math.sign(off);
    if (st[j] + d >= 18 && st[j] + d <= 85) { st[j] += d; off -= d; }
  }
  baseCache.set(k, Object.freeze(st));
  return st;
}

export const levelOf = xp => clamp(Math.floor((1 + Math.sqrt(1 + 8 * Math.max(0, xp) / R.levelXp)) / 2), 1, R.maxLevel);
export const xpForLevel = lv => R.levelXp * lv * (lv - 1) / 2;
/* How far a stat may move from the species' own value. */
const lowOf = b => b - R.drop, highOf = b => Math.min(R.statMax, b + R.grow);

const isRace = s => s && s.kind === C.RACE_KIND;
/* p's pet of kind k as a racer: stats now, experience, level, races and wins. skip: spend
   ids left out (a race still running on this page). */
export function statsOf(p, k, skip) {
  const base = baseStats(k), d = base.map(() => 0);
  let xp = 0, races = 0, wins = 0;
  for (const s of (p && p.spends) || []) {
    if (!isRace(s) || Number(s.pet) !== k || (skip && skip.has(s.id))) continue;
    races++;
    xp += Number(s.xp) || 0;
    if (Number(s.place) === 1) wins++;
    if (Array.isArray(s.d)) for (let i = 0; i < N_STATS; i++) d[i] += Number(s.d[i]) || 0;
  }
  const level = levelOf(xp);
  return { kind: k, base, st: base.map((b, i) => clamp(b + d[i], lowOf(b), highOf(b))), xp, level, races, wins,
           into: xp - xpForLevel(level), need: level >= R.maxLevel ? 0 : xpForLevel(level + 1) - xpForLevel(level) };
}
export const rating = st => Math.round(sum(st) / N_STATS);
export const racesOn = (p, k, day) => ((p && p.spends) || []).filter(s => isRace(s) && Number(s.pet) === k && String(s.at).slice(0, 10) === day).length;

/* ---- the field ------------------------------------------------------------------ */
/* Five other pets for me = { kind, hue, st } to race, drawn from seed (so a reload shows
   the same field). Each keeps its species' shape of stats, scaled to a total near mine. */
export function makeField(me, seed) {
  const r = rng(seed), mine = sum(me.st), pool = [];
  for (let k = 0; k < C.PET_MAX; k++) if (k !== me.kind) pool.push(k);
  const out = [];
  for (let i = 0; i < R.lanes - 1; i++) {
    const k = pool.splice(Math.floor(r() * pool.length), 1)[0], base = baseStats(k);
    const f = (mine + (r() * 2 - 1) * R.spread) / sum(base);
    out.push({ kind: k, hue: k === C.JOKE_KIND ? 28 : Math.floor(r() * 360),
               st: base.map(b => clamp(Math.round(b * f + (r() - 0.5) * 8), 10, R.statMax)) });
  }
  out.splice(Math.floor(r() * R.lanes), 0, { kind: me.kind, hue: me.hue, st: me.st.slice(), me: true });
  return out;
}

/* ---- the race ------------------------------------------------------------------- */
const DT = 0.05, FRAME = 2;                    /* seconds per step; steps per recorded frame */
export const FRAME_SECS = DT * FRAME;
/* Runs field ([{ st }]) from seed. Returns { place: [1-based, by lane], time: [s], order:
   [lanes, first home first], info: [{ early, mid, bursts, stumbles }], secs } and, with rec,
   frames: [{ x: [0..track], f: [0 swim | 1 burst | 2 stumble] }] every FRAME_SECS. */
export function runRace(field, seed, rec) {
  const r = rng(seed), n = field.length, D = R.track;
  const q = field.map(f => {
    const st = f.st;
    return { vtop: (5.6 + 0.006 * st[SPEED]) * (1 + (r() - 0.5) * 0.1),          /* how it feels today: 5% either way */
             delay: (0.1 + r() * 0.5) * (1.4 - st[START] / 100), acc: 1.2 + 0.05 * st[START],
             fadeAt: D * (0.5 + 0.004 * st[STAMINA]), fadeTo: 0.72 + 0.0026 * st[STAMINA],
             pb: 0.04 + 0.004 * st[BURST], kick: 1.15 + 0.002 * st[BURST],
             ps: Math.max(0.01, 0.14 - 0.0013 * st[FOCUS]), trip: 0.9 - 0.004 * st[FOCUS],
             wf: 0.8 + r() * 1.4, ph: r() * 6.28,
             x: 0, v: 0, burst: 0, cool: 1.5, stum: 0, done: -1, bursts: 0, stumbles: 0, t20: -1, t70: -1 };
  });
  const frames = rec ? [] : null;
  let t = 0, left = n;
  for (let step = 0; left > 0 && step < 2400; step++) {
    if (frames && step % FRAME === 0) frames.push({ x: q.map(a => Math.min(D, a.x)), f: q.map(a => a.done >= 0 ? 0 : a.stum > 0 ? 2 : a.burst > 0 ? 1 : 0) });
    t += DT;
    for (const a of q) {
      if (a.done >= 0 || t < a.delay) continue;
      let target = a.vtop;
      if (a.x > a.fadeAt) target *= 1 - (1 - a.fadeTo) * (a.x - a.fadeAt) / (D - a.fadeAt);
      if (a.stum > 0) { target *= 0.55; a.stum -= DT; }
      else if (a.burst > 0) { target *= a.kick; a.burst -= DT; }
      else {
        a.cool -= DT;
        if (a.cool <= 0 && r() < a.pb * DT) { a.burst = 1.2; a.cool = 2; a.bursts++; }
        else if (a.x > 4 && r() < a.ps * DT) { a.stum = a.trip; a.stumbles++; }
      }
      target *= 1 + 0.025 * Math.sin(t * a.wf + a.ph);
      a.v += clamp(target - a.v, -a.acc * 2 * DT, a.acc * DT);
      a.x += a.v * DT;
      if (a.t20 < 0 && a.x >= D * 0.2) a.t20 = t;
      if (a.t70 < 0 && a.x >= D * 0.7) a.t70 = t;
      if (a.x >= D) { a.done = t - (a.x - D) / Math.max(0.01, a.v); left--; }
    }
  }
  for (const a of q) if (a.done < 0) a.done = 999;                     /* never happens at these speeds; keeps the order whole */
  if (frames) frames.push({ x: q.map(() => D), f: q.map(() => 0) });
  const rank = key => {
    const o = q.map((a, i) => i).sort((i, j) => (q[i][key] - q[j][key]) || (i - j)), out = [];
    o.forEach((lane, at) => { out[lane] = at + 1; });
    return out;
  };
  const place = rank("done"), early = rank("t20"), mid = rank("t70");
  return { place, time: q.map(a => a.done), order: q.map((a, i) => i).sort((i, j) => place[i] - place[j]),
           info: q.map((a, i) => ({ early: early[i], mid: mid[i], bursts: a.bursts, stumbles: a.stumbles })),
           secs: Math.max(...q.map(a => a.done)), frames };
}

/* Each lane's chance to win and to finish in the first three: the race run `runs` times. */
export function raceOdds(field, seed, runs = R.oddsRuns) {
  const n = field.length, win = Array(n).fill(0), top3 = Array(n).fill(0), base = typeof seed === "string" ? hash(seed) : seed >>> 0;
  for (let i = 0; i < runs; i++) {
    const res = runRace(field, (base + Math.imul(i + 1, 2654435761)) >>> 0);
    for (let lane = 0; lane < n; lane++) { if (res.place[lane] === 1) win[lane]++; if (res.place[lane] <= 3) top3[lane]++; }
  }
  return { win: win.map(c => Math.max(c, 1) / runs), top3: top3.map(c => Math.max(c, 1) / runs) };
}

/* What a stake pays if it comes in, 0 when that bet is not offered (it would pay no more
   than the stake, or tokens on a top-three finish). Whole numbers, rounded down. */
export function racePay(cur, type, chance, bet) {
  if (!(chance > 0) || !(bet > 0)) return 0;
  if (cur === "token") {
    if (type !== "win") return 0;
    const m = Math.min(R.tokenMax, Math.floor(R.tokenEdge / chance));
    return m >= 2 ? m * bet : 0;
  }
  const pay = Math.floor(bet * Math.min(R.maxMult, R.edge / chance) + 1e-9);
  return pay > bet ? pay : 0;
}
export const betHit = (type, place) => type === "top3" ? place <= 3 : place === 1;

/* ---- what a race teaches ---------------------------------------------------------- */
const GAINS = [[2, 1], [1, 1], [1], [], [-1], [-1]];
/* The stat changes for finishing in `place` (1-based) with this race's info, drawn from
   rnd: good places add points to what went well, bad ones take a point from what went
   badly; a new level adds one more. Changes stop at the stat's limits. */
export function raceGrowth(st, base, info, place, levelUp, rnd, n = R.lanes) {
  const d = st.map(() => 0);
  const up = [1 + 2 * (n - info.early) / (n - 1), 2, 1 + Math.max(0, info.mid - place), 1 + info.bursts, info.stumbles ? 0.5 : 2.5];
  const down = [1 + 2 * (info.early - 1) / (n - 1), 1.5, 1 + Math.max(0, place - info.mid), info.bursts ? 0.5 : 2.5, 0.5 + 1.5 * info.stumbles];
  const moves = (GAINS[Math.min(place, GAINS.length) - 1] || []).concat(levelUp ? [1] : []);
  for (const m of moves) {
    const w = (m > 0 ? up : down).map((v, i) => {
      const now = st[i] + d[i];
      return (m > 0 ? now + m <= highOf(base[i]) : now + m >= lowOf(base[i])) ? v : 0;
    });
    const total = sum(w);
    if (!(total > 0)) continue;
    let pick = rnd() * total, i = 0;
    while (i < N_STATS - 1 && (pick -= w[i]) >= 0) i++;
    d[i] += m;
  }
  return d;
}
export const raceXp = place => R.xp[Math.min(place, R.xp.length) - 1] || 0;
