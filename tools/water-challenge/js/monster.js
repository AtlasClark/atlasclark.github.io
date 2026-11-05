/* Monster week (rev 1.42.0): the rules. From the first Monday of each month to the
   Sunday after it, one of four monsters (the month picks it, each once every four
   months) fights the team. Worked out from the pours like everything else, so it merges
   across PCs and undoes with the water; nothing is stored. The look is monsterfx.js.
   - Health: everyone's goals for Monday to Friday (people away left out) x MONSTER.hpShare.
   - Damage: every ounce poured that week, counted only up to each person's cap.
   - Twists: kraken regrows MONSTER.regrow of its health each Tuesday to Friday morning
     unless the team splash was met the day before; leviathan takes double on a day
     everyone meets their goal; pirate takes double from each person's first pour of the
     day; the AI takes half from a pour the same size as that person's last one.
   - Drowning a pet that week feeds it (MONSTER.feed of its health back) and leaves you
     soaked: your pours do MONSTER.soak as much for the rest of the week.
   - Beaten: MONSTER.shells shells and MONSTER.tokens tokens for everyone who hit it. */

import * as C from "./config.js";
import { S, personalGoal, capFor, metGoal, totalOn, isAway } from "./model.js";
import { todayKey, parseKey, dateKey, shiftKey } from "./util.js";
import { teamSplash } from "./hydration.js";

const KEYS = ["kraken", "leviathan", "pirate", "ai"];
const EPS = 1e-6;

/* The first Monday of a month, as a day key. */
export function firstMonday(y, m) {
  const d = new Date(y, m, 1);
  return dateKey(new Date(y, m, 1 + (8 - d.getDay()) % 7));
}

/* Which monster a month brings: the four in a shuffled order per block of four months. */
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }
export function monsterOfMonth(m) {
  let a = hash("monster|" + Math.floor(m / 4));
  const rnd = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const order = KEYS.slice();
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  return order[((m % 4) + 4) % 4];
}

/* The event a day falls in: { start, end, key, month }, else null. */
export function eventFor(key = todayKey()) {
  const d = parseKey(key);
  if (!d) return null;
  const start = firstMonday(d.getFullYear(), d.getMonth()), end = shiftKey(start, 6);
  if (key < start || key > end || start < C.MONSTER.since) return null;
  const month = d.getFullYear() * 12 + d.getMonth();
  return { start, end, key: monsterOfMonth(month), month };
}

const playing = (p, d) => !isAway(p, d) && !(p.created && p.created > d);
const workdays = ev => [0, 1, 2, 3, 4].map(i => shiftKey(ev.start, i));

export function maxHp(ev) {
  let sum = 0;
  for (const p of S.participants) for (const d of workdays(ev)) if (playing(p, d)) sum += personalGoal(p, d);
  return Math.max(1, Math.round(sum * C.MONSTER.hpShare));
}

/* Did everyone playing that day meet their goal? (The leviathan's weak spot.) */
function allMet(d) {
  const ps = S.participants.filter(p => playing(p, d));
  return ps.length > 0 && ps.every(p => metGoal(totalOn(p, d), personalGoal(p, d)));
}

/* The fight so far, up to and including day `now`:
   { ev, max, hp, dealt {name: dmg}, today {name: dmg}, soaked [names], beaten {name, ts, day} | null, log }. */
let memo = { ver: "", fights: {} };
export function fight(ev, now = todayKey()) {
  const ver = S.dataVer + "|" + S.participants.length + "|" + todayKey(), mk = ev.start + "|" + now;
  if (memo.ver !== ver) memo = { ver, fights: {} };
  if (memo.fights[mk]) return memo.fights[mk];
  const M = C.MONSTER, max = maxHp(ev), dealt = {}, today = {}, soaked = new Set();
  let hp = max, beaten = null;
  const lastOz = {};
  for (let i = 0; i < 7 && !beaten; i++) {
    const d = shiftKey(ev.start, i);
    if (d > now) break;
    if (ev.key === "kraken" && i >= 1 && i <= 4 && !teamSplash(shiftKey(d, -1)).met) hp = Math.min(max, hp + max * M.regrow);
    const double = ev.key === "leviathan" && allMet(d), hits = [];
    for (const p of S.participants) {
      const cap = capFor(p, d), drowned = p.graveLog && Number(p.graveLog[d]) >= 0;
      let run = 0, first = true;
      const es = (p.entries || []).filter(e => e.date === d).sort((a, b) => String(a.ts) < String(b.ts) ? -1 : 1);
      for (const e of es) {
        const oz = Number(e.oz) || 0, before = run;
        run += oz;
        if (oz <= 0) continue;
        const counted = Math.max(0, Math.min(run, cap) - Math.min(before, cap));
        let mult = double ? 2 : 1;
        if (ev.key === "pirate" && first) mult *= 2;
        if (ev.key === "ai" && lastOz[p.name] === oz) mult *= 0.5;
        if (soaked.has(p.name)) mult *= M.soak;
        first = false; lastOz[p.name] = oz;
        const feed = drowned && before <= cap + EPS && run > cap + EPS;       /* this pour drowned the pet */
        hits.push({ ts: String(e.ts), name: p.name, dmg: counted * mult, feed });
        if (feed) soaked.add(p.name);                                          /* half from the next pour on */
      }
    }
    hits.sort((a, b) => a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0);
    for (const h of hits) {
      if (h.dmg > 0) {
        hp -= h.dmg;
        dealt[h.name] = (dealt[h.name] || 0) + h.dmg;
        if (d === now) today[h.name] = (today[h.name] || 0) + h.dmg;
        if (hp <= EPS) { hp = 0; beaten = { name: h.name, ts: h.ts, day: d }; break; }
      }
      if (h.feed) hp = Math.min(max, hp + max * M.feed);
    }
  }
  const v = { ev, max, hp, dealt, today, soaked: [...soaked], beaten };
  memo.fights[mk] = v;
  return v;
}

/* The fight now, or null outside monster week. */
export function monsterNow(now = todayKey()) {
  const ev = eventFor(now);
  return ev ? fight(ev, now) : null;
}

/* One person's monster rewards, every event from MONSTER.since: { shells, tokens }. */
const wonMemo = { k: "", v: [] };
function wonFights(now) {
  const k = now + "|" + S.dataVer + "|" + S.participants.length;
  if (wonMemo.k === k) return wonMemo.v;
  const out = [], s = parseKey(C.MONSTER.since), n = parseKey(now);
  if (s && n) {
    for (let y = s.getFullYear(), m = s.getMonth(); y * 12 + m <= n.getFullYear() * 12 + n.getMonth(); m++) {
      if (m > 11) { m = 0; y++; }
      const ev = eventFor(firstMonday(y, m));
      if (!ev || ev.start > now) continue;
      const f = fight(ev, ev.end < now ? ev.end : now);
      if (f.beaten) out.push(f);
    }
  }
  wonMemo.k = k; wonMemo.v = out;
  return out;
}
export function monsterEarned(p, now = todayKey()) {
  const out = { shells: 0, tokens: 0 };
  for (const f of wonFights(now)) if ((f.dealt[p.name] || 0) > 0) { out.shells += C.MONSTER.shells; out.tokens += C.MONSTER.tokens; }
  return out;
}
