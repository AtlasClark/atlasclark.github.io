/* Shared state and every derived number: goals, scores, the day index, streaks,
   time away, tokens, year targets and season stats. Pure and synchronous; nothing
   here touches the folder. Semantics follow R55 line for line. */

import * as C from "./config.js";
import { todayKey, parseKey, shiftKey, keyDaysBetween, daysBetween, dateKey, has } from "./util.js";

export const S = {
  participants: [],
  settings: defaultSettings(),
  me: "",                 /* identity stamped on entries (the HTA used %USERNAME%) */
  mine: null,             /* the participant this browser belongs to; "" = none, null = not asked yet */
  folderFormat: 21,       /* format the connected folder is at; files are written at it */
  dataVer: 0,             /* bumps on every data change; cheap cache key */
  staleWriters: [], driftWriters: [], peerWriters: [],
  newerRevSeen: false, loadRecovered: 0, loadFailed: 0
};

export function defaultSettings() {
  return { dailyGoalOz: C.GOAL_OZ, goalSetAt: "", annualGoalOz: C.ANNUAL_GOAL_OZ,
           startDate: "", idleSkipDays: C.STREAK_MAX_IDLE_RUN,
           minGoalOz: 40, goalFactor: 0.9, minGoalDays: 3, dropTopDay: true,
           goalWindowDays: 30, legacyFlatUntil: C.LEGACY_FLAT_UNTIL,
           legacyGoalOz: 0, formatRev: C.LEGACY_FORMAT, upgradedAt: "", upgradedBy: "" };
}

let dayIndex = null, goalMemo = {}, dailyMemo = {};

export function dataChanged() {
  dayIndex = null; goalMemo = {}; dailyMemo = {};
  S.dataVer++;
}

/* ---- settings ---------------------------------------------------------- */
export function currentGoal() {
  const g = Number(S.settings.dailyGoalOz);
  return (isFinite(g) && g > 0) ? g : C.GOAL_OZ;
}
export function currentAnnualGoal() {
  const g = Number(S.settings.annualGoalOz);
  return (isFinite(g) && g > 0) ? g : C.ANNUAL_GOAL_OZ;
}
export function currentIdleMax() {
  const v = Number(S.settings.idleSkipDays);
  return (isFinite(v) && v >= 0) ? Math.floor(v) : C.STREAK_MAX_IDLE_RUN;
}
export function goalTunables() {
  const s = S.settings;
  return { minOz:   Number(s.minGoalOz) > 0 ? Number(s.minGoalOz) : 40,
           factor:  Number(s.goalFactor) > 0 ? Number(s.goalFactor) : 0.9,
           minDays: Number(s.minGoalDays) > 0 ? Number(s.minGoalDays) : 3,
           window:  Number(s.goalWindowDays) > 0 ? Number(s.goalWindowDays) : 30,
           dropTop: s.dropTopDay !== false };
}
export function legacyFlat() {
  const d = S.settings.legacyFlatUntil ? String(S.settings.legacyFlatUntil) : "";
  const g = Number(S.settings.legacyGoalOz);
  return { until: (d && parseKey(d)) ? d : "", goal: (isFinite(g) && g > 0) ? g : currentGoal() };
}

/* ---- personal goals ---------------------------------------------------- */
export function dailyTotals(p) {
  if (has(dailyMemo, p.name)) return dailyMemo[p.name];
  const by = {};
  for (const e of p.entries) by[e.date] = (by[e.date] || 0) + Number(e.oz);
  dailyMemo[p.name] = by;
  return by;
}

/* A fraction of the average of qualifying days in the window ending yesterday. */
export function goalForDate(p, key) {
  const t = goalTunables(), mk = p.name + "|" + key;
  if (has(goalMemo, mk)) return goalMemo[mk];
  const by = dailyTotals(p), keep = [];
  for (let i = 1; i <= t.window; i++) {
    const v = by[shiftKey(key, -i)] || 0;
    if (v >= t.minOz - C.GOAL_EPSILON) keep.push(v);
  }
  keep.sort((a, b) => b - a);
  if (t.dropTop && keep.length > 0) keep.shift();
  if (keep.length < t.minDays) { goalMemo[mk] = null; return null; }
  let sum = 0;
  for (const v of keep) sum += v;
  goalMemo[mk] = Math.round((sum / keep.length) * t.factor);
  return goalMemo[mk];
}

/* A finished day keeps the goal stamped for it; today follows live data. */
export function personalGoal(p, key) {
  const k = key || todayKey(), L = legacyFlat();
  if (!p) return currentGoal();
  if (L.until && k <= L.until) return L.goal;
  if (k !== todayKey() && p.dayGoals && has(p.dayGoals, k)) return Number(p.dayGoals[k]);
  if (!p.entries) return currentGoal();
  const g = goalForDate(p, k);
  return g === null ? currentGoal() : g;
}

export function currentGoalFor(p) { return personalGoal(p, todayKey()); }
export function capFor(p, key) { return 2 * personalGoal(p, key); }

export function dayScoreFor(total, p, key) {
  const v = Number(total) || 0;
  if (v <= 0 || !p) return 0;
  if (v >= capFor(p, key) - C.TIE_EPSILON) return C.SCORE_TOP;
  return v / personalGoal(p, key);
}
export function pastCap(total, p, key) { return Number(total) > capFor(p, key) + C.TIE_EPSILON; }
export function atCap(total, p, key)   { return Number(total) >= capFor(p, key) - C.TIE_EPSILON; }
export function metGoal(total, goal)   { return total >= goal - C.GOAL_EPSILON; }

/* Every finished day this person logged on (today is still being played). */
function datesFor(p) {
  const seen = {}, out = [], today = todayKey();
  for (const e of p.entries) {
    const d = e.date;
    if (d && d < today && !seen[d]) { seen[d] = true; out.push(d); }
  }
  return out;
}

export function forceLegacyStamps(map) {
  const L = legacyFlat();
  if (!L.until || !map) return;
  for (const k in map) if (has(map, k) && k <= L.until) map[k] = L.goal;
}

/* Fills in any unstamped finished day. Returns true when something changed. */
export function stampDayGoals(p) {
  const L = legacyFlat();
  let changed = false;
  if (!p.dayGoals) p.dayGoals = {};
  for (const k of datesFor(p)) {
    if (L.until && k <= L.until) {
      if (Number(p.dayGoals[k]) !== L.goal) { p.dayGoals[k] = L.goal; changed = true; }
      continue;
    }
    if (has(p.dayGoals, k)) continue;
    const g = goalForDate(p, k);
    p.dayGoals[k] = g === null ? currentGoal() : g;
    changed = true;
  }
  return changed;
}

/* ---- roster ------------------------------------------------------------- */
export function findParticipant(name) {
  const n = String(name).toLowerCase();
  return S.participants.find(p => p.name.toLowerCase() === n) || null;
}

/* ---- usernames ---------------------------------------------------------- */
/* Every username seen on a pour or a purchase, with how often, A to Z. */
export function knownUsers() {
  const n = {};
  const add = u => {
    const k = String(u || "").trim();
    if (C.NOT_USERS.includes(k.toLowerCase())) return;
    const hit = Object.keys(n).find(x => x.toLowerCase() === k.toLowerCase()) || k;
    n[hit] = (n[hit] || 0) + 1;
  };
  for (const p of S.participants) {
    for (const e of p.entries) add(e.by);
    for (const s of p.spends || []) add(s.by);
  }
  return Object.keys(n).sort((a, b) => a.localeCompare(b)).map(user => ({ user, n: n[user] }));
}

function editDistance(a, b) {
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return d[b.length];
}

/* For a typed name: { same } when it is a known username in other case,
   { near } when it is one or two letters off one, else {}. */
export function matchUser(v) {
  const k = String(v || "").trim().toLowerCase();
  const users = knownUsers().map(x => x.user);
  const same = users.find(u => u.toLowerCase() === k);
  if (same) return { same };
  let near = "", best = 3;
  for (const u of users) {
    const dist = editDistance(k, u.toLowerCase());
    if (dist < best) { best = dist; near = u; }
  }
  return near ? { near } : {};
}

export function duplicateNames() {
  const seen = {}, dup = [];
  for (const p of S.participants) {
    const k = String(p.name).toLowerCase();
    if (seen[k] && !dup.includes(p.name)) dup.push(p.name);
    seen[k] = true;
  }
  return dup;
}

export function totalOn(p, key) {
  let sum = 0;
  for (const e of p.entries) if (e.date === key) sum += Number(e.oz);
  return sum;
}

/* ---- the day index ------------------------------------------------------ */
function buildDayIndex() {
  goalMemo = {}; dailyMemo = {};
  const idx = {};
  for (const p of S.participants) {
    for (const e of p.entries) {
      const rec = idx[e.date] || (idx[e.date] = { max: 0, by: {}, score: {} });
      rec.by[p.name] = (rec.by[p.name] || 0) + Number(e.oz);
    }
  }
  for (const k in idx) {
    const rec = idx[k];
    rec.max = 0;
    for (const nm in rec.by) {
      rec.score[nm] = dayScoreFor(rec.by[nm], findParticipant(nm), k);
      if (rec.score[nm] > rec.max) rec.max = rec.score[nm];
    }
  }
  dayIndex = idx;
  return idx;
}

export function dayRec(key) {
  if (!dayIndex) buildDayIndex();
  return dayIndex[key] || null;
}

export function dayLeaders(key) {
  const rec = dayRec(key), out = [];
  if (!rec || rec.max <= 0) return out;
  for (const nm in rec.by) if (rec.score[nm] >= rec.max - C.RATIO_EPSILON) out.push(nm);
  return out;
}

/* "idle" | "win" | "tie" | "loss" */
export function dayResult(p, key) {
  const rec = dayRec(key);
  if (!rec || rec.max <= 0) return "idle";
  const leaders = dayLeaders(key);
  if (leaders.includes(p.name)) return leaders.length > 1 ? "tie" : "win";
  return "loss";
}

export function wonDay(p, key) {
  const r = dayResult(p, key);
  return r === "win" || (r === "tie" && C.STREAK_TIE_RULE === "win");
}

export function goalDay(p, key) {
  const rec = dayRec(key);
  return metGoal(rec ? (rec.by[p.name] || 0) : 0, personalGoal(p, key));
}

export function satOut(p, key) {
  const rec = dayRec(key);
  return !rec || (rec.by[p.name] || 0) <= 0;
}

/* ---- time away ---------------------------------------------------------- */
export function isAway(p, key) {
  if (!p || !p.away) return false;
  for (const a of p.away) {
    if (a && a[0] && key >= a[0] && (!a[1] || key <= a[1])) return true;
  }
  return false;
}
export function isActive(p) { return !isAway(p, todayKey()); }
export function activeParticipants() { return S.participants.filter(isActive); }

export function awayDaysIn(p, from, to) {
  let n = 0;
  if (!p || !p.away) return 0;
  for (const a of p.away) {
    if (!a || !a[0]) continue;
    const s = a[0] > from ? a[0] : from;
    const e = (a[1] && a[1] < to) ? a[1] : to;
    if (e >= s) n += keyDaysBetween(s, e) + 1;
  }
  return n;
}

export function openAwaySince(p) {
  let since = "";
  for (const a of p.away || []) if (a && !a[1]) since = a[0];
  return since;
}

/* ---- tokens: one per goal day, computed from history -------------------- */
/* Days past the cap since the bonus began; each pays CAP_BONUS on top of goal days. */
export function capBonusDays(p) {
  const by = dailyTotals(p);
  let n = 0;
  for (const k in by) if (k >= C.CAP_BONUS_SINCE && by[k] > 0 && pastCap(by[k], p, k)) n++;
  return n;
}
export const capBonus = p => C.CAP_BONUS * capBonusDays(p);

export function tokensEarned(p) {
  const by = dailyTotals(p);
  let n = 0;
  for (const k in by) if (by[k] > 0 && metGoal(by[k], personalGoal(p, k))) n++;
  return n;
}

/* ---- streaks ------------------------------------------------------------ */
export function streakCount(p, mode) {
  const hit = mode === "goal" ? goalDay : wonDay;
  const d = new Date();
  let n = 0, idleRun = 0;
  if (mode === "wins") d.setDate(d.getDate() - 1);
  else if (!hit(p, dateKey(d))) d.setDate(d.getDate() - 1);   /* a goal banks the moment it is met */

  for (let guard = 0; guard < C.STREAK_MAX_LOOKBACK; guard++) {
    const key = dateKey(d);
    if (p.created && key < p.created) break;
    if (isAway(p, key)) { d.setDate(d.getDate() - 1); continue; }   /* benched: the day does not exist */
    if (hit(p, key)) { n++; idleRun = 0; }
    else if (mode === "wins" && C.STREAK_TIE_RULE === "hold" && dayResult(p, key) === "tie") { idleRun = 0; }
    else if (C.STREAK_SKIP_IDLE_DAYS && satOut(p, key)) {
      idleRun++;
      if (idleRun > currentIdleMax()) break;
    } else break;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

export function streaks(p) {
  const out = { win: 0, goal: 0 };
  if (C.STREAK_MODE !== "goal") out.win = streakCount(p, "wins");
  if (C.STREAK_MODE !== "wins") out.goal = streakCount(p, "goal");
  if (C.STREAK_MODE === "best" && out.win > 0) out.goal = 0;
  return out;
}

/* ---- boards ------------------------------------------------------------- */
export function allDateKeys() {
  const seen = {}, keys = [];
  for (const p of S.participants) {
    for (const e of p.entries) if (!seen[e.date]) { seen[e.date] = true; keys.push(e.date); }
  }
  keys.sort();
  keys.reverse();
  return keys;
}

export function standingsFor(key) {
  const rows = [];
  for (const p of S.participants) {
    if (isAway(p, key)) continue;
    const total = totalOn(p, key);
    rows.push({ name: p.name, color: p.color, goal: personalGoal(p, key), cap: capFor(p, key),
                total, score: dayScoreFor(total, p, key) });
  }
  rows.sort((a, b) => (b.score - a.score) || (b.total - a.total) || (a.name < b.name ? -1 : 1));
  return rows;
}

export function winnerOf(rows) {
  let best = 0;
  if (!rows.length) return "-";
  for (const r of rows) if (r.score > best) best = r.score;
  if (best <= 0) return "-";
  const leaders = rows.filter(r => r.score >= best - C.RATIO_EPSILON).map(r => r.name);
  return leaders.length > 1 ? "Tie" : leaders[0];
}

export function orderedBy(mode) {
  const arr = activeParticipants(), key = todayKey();
  if (mode === "rank") {
    arr.sort((a, b) => (totalOn(b, key) - totalOn(a, key)) || (a.name < b.name ? -1 : 1));
  } else {
    arr.sort((a, b) => a.name < b.name ? -1 : 1);
  }
  return arr;
}

/* ---- the year ----------------------------------------------------------- */
function earliestEntryKey() {
  const keys = allDateKeys();
  return keys.length ? keys[keys.length - 1] : "";
}
export function challengeStart() {
  if (S.settings.startDate && parseKey(S.settings.startDate)) return S.settings.startDate;
  return earliestEntryKey() || todayKey();
}
export function challengeEnd() {
  const d = parseKey(challengeStart());
  if (!d) return todayKey();
  d.setDate(d.getDate() + C.YEAR_DAYS - 1);
  return dateKey(d);
}
export function yearElapsed() {
  const start = parseKey(challengeStart());
  if (!start) return 0;
  let gone = daysBetween(start, new Date()) + 1;
  gone = Math.max(0, Math.min(C.YEAR_DAYS, gone));
  return gone / C.YEAR_DAYS;
}
export function teamYearTotal() {
  const from = challengeStart(), to = challengeEnd();
  let t = 0;
  for (const p of S.participants) {
    for (const e of p.entries) if (e.date >= from && e.date <= to) t += Number(e.oz);
  }
  return t;
}
/* Each person contributes their share of the year for the days they are in it. */
export function yearTargets() {
  const s = challengeStart(), e = challengeEnd(), t = todayKey(), annual = currentAnnualGoal();
  let len = keyDaysBetween(s, e) + 1, target = 0, expected = 0;
  if (len <= 0) len = 365;
  const upto = t < e ? t : e;
  const span = Math.max(0, keyDaysBetween(s, upto) + 1);
  for (const p of S.participants) {
    const inYear = Math.max(0, len - awayDaysIn(p, s, e));
    const sofar = Math.max(0, span - awayDaysIn(p, s, upto));
    target += annual * inYear / len;
    expected += annual * sofar / len;
  }
  return { target, expected };
}

/* ---- season stats: one pass, oldest day first --------------------------- */
export function seasonStats() {
  const keys = allDateKeys().slice().sort();
  const out = { people: {}, order: [], days: 0, totalOz: 0, first: "", last: "" };
  const idleRun = {};
  for (const p of S.participants) {
    out.order.push(p.name);
    out.people[p.name] = { name: p.name, color: p.color, wins: 0, goalDays: 0, capDays: 0, overDays: 0,
                           logged: 0, total: 0, best: 0, bestDay: "", winStreak: 0, bestWinStreak: 0,
                           goalStreak: 0, bestGoalStreak: 0, firstDay: "", lastDay: "" };
    idleRun[p.name] = 0;
  }
  for (const key of keys) {
    const rec = dayRec(key);
    if (!rec) continue;
    out.days++;
    if (!out.first) out.first = key;
    out.last = key;
    const leaders = dayLeaders(key);
    for (const name of out.order) {
      const st = out.people[name], tot = rec.by[name] || 0, pp = findParticipant(name);
      if (tot > 0) {
        st.logged++; st.total += tot; out.totalOz += tot;
        if (!st.firstDay) st.firstDay = key;
        st.lastDay = key;
        if (tot > st.best) { st.best = tot; st.bestDay = key; }
      }
      let won = leaders.includes(name);
      if (won && leaders.length > 1 && C.STREAK_TIE_RULE === "loss") won = false;
      const met = metGoal(tot, personalGoal(pp, key));
      if (won) st.wins++;
      if (met) st.goalDays++;
      if (atCap(tot, pp, key)) st.capDays++;
      if (pastCap(tot, pp, key)) st.overDays++;
      if (tot <= 0) {
        idleRun[name]++;
        if (idleRun[name] > currentIdleMax()) { st.winStreak = 0; st.goalStreak = 0; }
      } else {
        idleRun[name] = 0;
        if (won) { st.winStreak++; st.bestWinStreak = Math.max(st.bestWinStreak, st.winStreak); }
        else if (!(leaders.length > 1 && C.STREAK_TIE_RULE === "hold" && tot >= rec.max - C.TIE_EPSILON)) st.winStreak = 0;
        if (met) { st.goalStreak++; st.bestGoalStreak = Math.max(st.bestGoalStreak, st.goalStreak); }
        else st.goalStreak = 0;
      }
    }
  }
  return out;
}

export function recentDays(count) {
  const keys = allDateKeys().slice().sort();
  return keys.slice(Math.max(0, keys.length - count));
}

export function topOf(stats, field) {
  let best = null;
  for (const n of stats.order) {
    const st = stats.people[n];
    if (st[field] > 0 && (!best || st[field] > best[field])) best = st;
  }
  return best;
}

/* ---- when today's pet events happened ----------------------------------- */
/* The time of the pour that first took the day's running total across a line.
   The files hold no time for a roll or a drowning, but each one happens on the
   pour that crosses the goal or the cap, so the time can be read back from it. */
export function crossingTs(p, key, crossed) {
  const list = p.entries.filter(e => e.date === key)
                        .sort((a, b) => String(a.ts) < String(b.ts) ? -1 : String(a.ts) > String(b.ts) ? 1 : 0);
  let sum = 0;
  for (const e of list) { sum += Number(e.oz); if (crossed(sum)) return e.ts; }
  return "";
}

export function petEventTimes(p, key) {
  return { roll: crossingTs(p, key, t => metGoal(t, personalGoal(p, key))),
           grave: crossingTs(p, key, t => pastCap(t, p, key)) };
}
