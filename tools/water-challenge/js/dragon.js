/* The dragon (rev 1.53.0): the one pet that is not in a pen. A goal roll brings it now and
   then (MYSTERY_CHANCE). It chooses the player for a while: it stays its first DRAGON.stay
   weekdays (the day it came counts when it is a weekday), then each later weekday it may
   leave (DRAGON.leave). It comes at a random level (DRAGON.lv) with stats raised to match,
   and brings its hoard: tokens and shells, paid once when it comes.
   Everything here is worked out from the person's name and days (seeded draws), so every
   PC agrees and nothing extra is saved: the day it came is its rollLog day. Pure: no page,
   no saving (pets.js sends it away, shop.js pays the hoard, race.js reads its start). */

import * as C from "./config.js";
import { has, shiftKey, parseKey } from "./util.js";

const D = C.DRAGON;
const isWeekday = k => { const d = parseKey(k); return !!d && d.getDay() > 0 && d.getDay() < 6; };

/* Seeded on name and key: FNV-1a then mulberry32. (pets.js dayRng's hash moves by a fixed
   step from one date to the next, so its first draws on a run of days are linked; the
   leave draw needs days that are independent.) */
export function dragonRng(name, key) {
  const str = String(name) + "|" + String(key) + "|dragon";
  let a = 2166136261;
  for (let i = 0; i < str.length; i++) a = Math.imul(a ^ str.charCodeAt(i), 16777619);
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const holdsDragon = p => !!p && has(p.pets, C.MYSTERY_KIND);

/* Days a roll brought the dragon, oldest first. */
export function dragonDays(p) {
  return Object.entries((p && p.rollLog) || {}).filter(([, v]) => v && Number(v.k) === C.MYSTERY_KIND).map(([k]) => k).sort();
}

/* The day the dragon now held came: its newest rollLog day. One held from before these
   rules (no log, or an older day) counts as coming on DRAGON.since. "" when none is held. */
export function dragonArrival(p) {
  if (!holdsDragon(p)) return "";
  const last = dragonDays(p).at(-1) || "";
  return last >= D.since ? last : D.since;
}

/* Its guaranteed weekdays: the last one. */
export function dragonSafeUntil(arrival) {
  let d = arrival, n = 0;
  for (let i = 0; i < 30; i++, d = shiftKey(d, 1)) if (isWeekday(d) && ++n >= D.stay) return d;
  return d;
}

/* The weekday it leaves: the first weekday after the guaranteed ones whose draw comes
   under DRAGON.leave. The same day on every PC. */
export function dragonLeaveDay(name, arrival) {
  let d = shiftKey(dragonSafeUntil(arrival), 1);
  for (let i = 0; i < 2000; i++, d = shiftKey(d, 1)) {
    if (isWeekday(d) && dragonRng(name, d + "|leave")() < D.leave) return d;
  }
  return d;
}

/* What it brings to the races: a level from DRAGON.lv, that level's experience, and
   DRAGON.perLevel stat points for each level above 1, spread at random. */
export function dragonStart(name, arrival) {
  const rnd = dragonRng(name, arrival + "|level"), lv = D.lv[0] + Math.floor(rnd() * (D.lv[1] - D.lv[0] + 1));
  const d = C.RACE_STATS.map(() => 0);
  for (let i = 0; i < (lv - 1) * D.perLevel; i++) d[Math.floor(rnd() * d.length)]++;
  return { level: lv, xp: C.RACE.levelXp * lv * (lv - 1) / 2, d };
}

/* The hoard it brought on day key: whole tokens and shells inside DRAGON.tokens / .shells. */
export function hoardOf(name, key) {
  const rnd = dragonRng(name, key + "|hoard"), [t0, t1] = D.tokens, [s0, s1] = D.shells;
  return { tokens: t0 + Math.floor(rnd() * (t1 - t0 + 1)), shells: s0 + Math.floor(rnd() * (s1 - s0 + 1)) };
}

/* Every hoard p was brought (rolls on DRAGON.since and after). A roll that is undone or
   rerolled leaves the log, and its hoard goes with it. */
export function hoardTotal(p) {
  const out = { tokens: 0, shells: 0 };
  for (const k of dragonDays(p)) if (k >= D.since) { const h = hoardOf(p.name, k); out.tokens += h.tokens; out.shells += h.shells; }
  return out;
}
