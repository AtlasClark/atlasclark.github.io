/* Blackjack (rev 1.52.0): totals, the dealer's rule, payouts, the deal / finish records, the
   daily limit, the casino tallies, and the return over many hands. Fake people only. */

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { web, loadWeb } from "./lib/bridge.mjs";

const JS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../tools/water-challenge/js/");
const shop = await import(pathToFileURL(path.join(JS, "shop.js")));
const bj = await import(pathToFileURL(path.join(JS, "blackjack.js")));
const { C, model } = web;

/* Cards by rank (suit spades): A = 0, 2..10 = 1..9, J = 10, Q = 11, K = 12. */
const A = 0, K = 12, card = r => r - 1;
/* A draw that deals these cards in turn. */
const deck = (...cards) => { let i = 0; return () => (cards[i++ % cards.length] + 0.5) / 52; };

async function player() {
  const { S } = await loadWeb([]);
  const days = Array.from({ length: 10 }, (_, i) => "2026-11-" + String(2 + i).padStart(2, "0"));
  const p = { name: "Card Test", color: "#60a5fa", created: "2026-11-01", away: [], pets: {}, graves: {}, spends: [],
              entries: days.map((d, i) => ({ eid: "e" + i, ts: d + "T10:00:00", date: d, oz: 20, by: "test" })) };
  S.participants = [p]; model.dataChanged();
  return p;
}

test("totals: aces count 11 while they fit, and say so", () => {
  assert.deepEqual(bj.total([A, card(6)]), { t: 17, soft: true });
  assert.deepEqual(bj.total([A, card(6), K]), { t: 17, soft: false });
  assert.deepEqual(bj.total([A, A, card(9)]), { t: 21, soft: true });
  assert.ok(bj.natural([A, K]) && !bj.natural([card(7), card(7), card(7)]));
  for (let c = 0; c < 52; c++) assert.equal(bj.draw(() => (c + 0.5) / 52), c);
  assert.equal(bj.draw(() => 0.99999999), 51);
});

test("the dealer draws to 17 and stands on every 17, soft ones too", () => {
  assert.equal(bj.dealerPlay([A, card(6)], deck(K)).length, 2, "soft 17 stands");
  assert.deepEqual(bj.dealerPlay([card(10), card(6)], deck(card(5), K)), [card(10), card(6), card(5)]);
});

test("payouts: blackjack 3 to 2 rounded down, a win doubles the stake, a push returns it", () => {
  assert.deepEqual(bj.settle([A, K], [card(9), card(8)], 5, false), { res: "bj", won: 12 });
  assert.deepEqual(bj.settle([A, K], [card(9), card(8)], 2, false), { res: "bj", won: 5 });
  assert.deepEqual(bj.settle([A, K], [A, K], 10, false), { res: "push", won: 10 });
  assert.deepEqual(bj.settle([K, card(9)], [A, K], 10, false), { res: "lose", won: 0 });
  assert.deepEqual(bj.settle([K, card(9)], [K, card(8)], 5, false), { res: "win", won: 10 });
  assert.deepEqual(bj.settle([K, card(5), card(6)], [K, card(8)], 5, true), { res: "win", won: 20 }, "a double pays on twice the stake");
  assert.deepEqual(bj.settle([K, card(8)], [K, card(8)], 5, false), { res: "push", won: 5 });
  assert.deepEqual(bj.settle([K, card(6), card(9)], [K, card(6), K], 5, false), { res: "bust", won: 0 }, "a bust loses even if the dealer busts");
});

test("a deal takes the stake at once; stand saves the result; a double takes the stake again", async () => {
  const p = await player();
  assert.equal(shop.shellBalance(p), 40);
  assert.equal(shop.bjBlock(p, 3), "Pick 2, 5, 10 shells.");
  const h = await shop.bjDeal(p, 5, deck(K, card(9), card(10), card(7)));      /* you 19, dealer 17 */
  assert.ok(h && !h.end);
  assert.equal(shop.shellBalance(p), 35, "the stake is gone at the deal");
  assert.deepEqual([p.spends.at(-1).role, p.spends.at(-1).bet, p.spends.at(-1).cost], ["deal", 5, 0]);
  await shop.bjFinish(p, h, "stand");
  assert.deepEqual([h.end.res, h.end.won], ["win", 10]);
  const e = p.spends.at(-1);
  assert.deepEqual([e.role, e.hand, e.bet, e.won, e.pc, e.dc], ["end", h.id, 0, 10, [K, card(9)], [card(10), card(7)]]);
  assert.equal(shop.shellBalance(p), 45);

  const d = await shop.bjDeal(p, 10, deck(card(6), card(5), card(10), card(6), card(9), K));   /* you 11, dealer 16 */
  await shop.bjFinish(p, d, "double");
  assert.deepEqual([d.p.length, d.dbl, d.end.res, d.end.won], [3, true, "win", 40], "11 + 9 = 20; the dealer draws a K and busts");
  assert.equal(p.spends.at(-1).bet, 10, "the double's extra stake is on the end record");
  assert.equal(shop.shellBalance(p), 45 - 20 + 40);
  assert.equal(shop.balance(p), 0, "tokens untouched");
  const c = shop.casinoOn(p);
  assert.deepEqual([c.hands, c.handWins, c.shellIn, c.shellBack], [2, 2, 25, 50]);
});

test("a blackjack on the deal ends the hand at once; a hand left unfinished keeps its stake", async () => {
  const p = await player();
  const h = await shop.bjDeal(p, 10, deck(A, K, card(9), card(8)));
  assert.deepEqual([h.end.res, h.end.won], ["bj", 25]);
  assert.equal(shop.shellBalance(p), 40 - 10 + 25);
  await shop.bjDeal(p, 5, deck(K, card(5), card(10), card(7)));               /* dealt, never finished */
  assert.equal(shop.shellBalance(p), 55 - 5);
  assert.equal(await shop.bjFinish(p, h, "stand"), h, "a finished hand is not finished twice");
  assert.equal(p.spends.filter(s => s.role === "end").length, 1);
});

test("the daily limit: BJ.perDay hands, then blocked", async () => {
  const p = await player();
  for (let i = 0; i < C.BJ.perDay; i++) {
    p.spends.push({ id: "s:d" + i, at: (await import(pathToFileURL(path.join(JS, "util.js")))).localStamp(new Date()), kind: C.BJ.kind, cost: 0, role: "deal", bet: 0 });
  }
  assert.equal(shop.bjHandsOn(p), C.BJ.perDay);
  assert.match(shop.bjBlock(p, 2), /hands today/);
});

test("over many hands with simple play, the house keeps a small edge", () => {
  let x = 987654321;
  const rnd = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
  let staked = 0, back = 0;
  for (let i = 0; i < 40000; i++) {
    const hand = { bet: 10, p: [bj.draw(rnd), bj.draw(rnd)], d: [bj.draw(rnd), bj.draw(rnd)], dbl: false };
    const up = bj.total([hand.d[0]]).t;
    if (!bj.natural(hand.p) && !bj.natural(hand.d)) {
      const t0 = bj.total(hand.p).t;
      if ((t0 === 10 || t0 === 11) && up < 10) { hand.dbl = true; hand.p.push(bj.draw(rnd)); }
      else while (bj.total(hand.p).t < (up >= 7 ? 17 : 12)) hand.p.push(bj.draw(rnd));
    }
    const r = bj.closeHand(hand, rnd);
    staked += hand.bet * (hand.dbl ? 2 : 1); back += r.won;
  }
  const ret = back / staked;
  assert.ok(ret > 0.93 && ret < 1.0, "return " + (ret * 100).toFixed(1) + "%");
});
