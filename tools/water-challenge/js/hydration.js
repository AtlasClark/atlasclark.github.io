/* National Hydration Day (HYD_DAY in config, June 23): the rewards. Worked out from
   the day's pours like everything else, so they merge across PCs and undo with the
   water. Ounces count only up to each person's cap, so nobody is paid to over-drink.
   The banner, background and goal wave are in hydfx.js. */

import * as C from "./config.js";
import { S, totalOn, capFor, personalGoal, metGoal, isAway } from "./model.js";
import { todayKey, parseKey } from "./util.js";

export function isHydrationDay(key = todayKey()) {
  const d = parseKey(key);
  return !!d && d.getMonth() + 1 === C.HYD_DAY.m && d.getDate() === C.HYD_DAY.d;
}

/* The team splash: everyone's pours that day against the sum of everyone's goals
   (people away that day count for neither). */
export function teamSplash(key = todayKey()) {
  let total = 0, goal = 0;
  for (const p of S.participants) {
    if (isAway(p, key) || (p.created && p.created > key)) continue;    /* not playing yet that day */
    total += totalOn(p, key);
    goal += personalGoal(p, key);
  }
  return { total, goal, met: goal > 0 && metGoal(total, goal) };
}

/* One person's Hydration Day earnings, every year from SHELLS_SINCE: { shells, tokens }.
   A shell per OZ_PER_SHELL and a token per OZ_PER_TOKEN up to the cap, GOAL_SHELLS for
   reaching the goal, TEAM_SHELLS when the team splash is met and they poured. */
export function hydrationEarned(p) {
  const H = C.HYD_DAY, out = { shells: 0, tokens: 0 };
  const days = new Set((p.entries || []).filter(e => Number(e.oz) > 0 && e.date >= C.SHELLS_SINCE && isHydrationDay(e.date)).map(e => e.date));
  for (const d of days) {
    const total = totalOn(p, d), counted = Math.min(total, capFor(p, d));
    out.shells += Math.floor(counted / H.ozPerShell + 1e-9);
    out.tokens += Math.floor(counted / H.ozPerToken + 1e-9);
    if (metGoal(total, personalGoal(p, d))) out.shells += H.goalShells;
    if (teamSplash(d).met) out.shells += H.teamShells;
  }
  return out;
}
