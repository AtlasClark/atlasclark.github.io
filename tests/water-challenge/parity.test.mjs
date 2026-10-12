/* Rule parity: for every day of the season, the web modules must reach the same
   goals, scores, results, streaks, tokens, standings and year numbers as R55. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { available, skipReason, readDataFiles, backupDay, setToday, loadR55, loadWeb, web, Diff, clone, dayKeys } from "./lib/bridge.mjs";

test("goals, scores, streaks and standings match R55 on every day", { skip: skipReason }, async () => {
  const files = readDataFiles(), last = backupDay(files);
  setToday(last);
  const { ctx } = loadR55(files);
  const { S } = await loadWeb(files);
  const M = web.model, P = web.pets, d = new Diff();
  const start = ctx.challengeStart();
  d.eq("challengeStart", start, M.challengeStart());

  for (const day of dayKeys(start, last)) {
    setToday(day);
    ctx.dataChanged(); M.dataChanged();
    for (const r of ctx.participants) {
      const w = M.findParticipant(r.name), at = day + " " + r.name;
      d.eq(at + " goalForDate", ctx.goalForDate(r, day), M.goalForDate(w, day));
      d.eq(at + " personalGoal", ctx.personalGoal(r, day), M.personalGoal(w, day));
      d.eq(at + " cap", ctx.capFor(r, day), M.capFor(w, day));
      d.eq(at + " total", ctx.totalOn(r, day), M.totalOn(w, day));
      d.eq(at + " score", ctx.dayScoreFor(ctx.totalOn(r, day), r, day), M.dayScoreFor(M.totalOn(w, day), w, day));
      d.eq(at + " result", ctx.dayResult(r, day), M.dayResult(w, day));
      d.eq(at + " goalDay", ctx.goalDay(r, day), M.goalDay(w, day));
      d.eq(at + " away", ctx.isAway(r, day), M.isAway(w, day));
      d.eq(at + " streaks", ctx.streaks(r), M.streaks(w));
      d.eq(at + " tokens", ctx.tokensEarned(r), M.tokensEarned(w));
      d.eq(at + " todaysPet", ctx.todaysPet(r), P.todaysPet(w));
      d.eq(at + " victim", ctx.pickVictim(r), P.pickVictim(w));
      const rc = clone(r), wc = clone(w);
      d.eq(at + " stampDayGoals", [ctx.stampDayGoals(rc), rc.dayGoals], [M.stampDayGoals(wc), wc.dayGoals]);
    }
    d.eq(day + " standings", ctx.standingsFor(day), M.standingsFor(day));
    d.eq(day + " winner", ctx.winnerOf(ctx.standingsFor(day)), M.winnerOf(M.standingsFor(day)));
    d.eq(day + " yearTargets", ctx.yearTargets(), M.yearTargets());
    d.eq(day + " teamYearTotal", ctx.teamYearTotal(), M.teamYearTotal());
    d.eq(day + " challengeEnd", ctx.challengeEnd(), M.challengeEnd());
  }

  setToday(last);
  ctx.dataChanged(); M.dataChanged();
  d.eq("seasonStats", ctx.seasonStats(), M.seasonStats());
  d.eq("recentDays", ctx.recentDays(28), M.recentDays(28));
  d.eq("duplicateNames", ctx.duplicateNames(), M.duplicateNames());
  assert.equal(d.list.length, 0, d.report());
  assert.ok(S.participants.length > 0);
});
