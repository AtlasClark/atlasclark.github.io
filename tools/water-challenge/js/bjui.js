/* Blackjack table (rev 1.52.0), on the Casino tab. Rules in blackjack.js, saving in shop.js.
   The deal saves the stake; a hit draws here only (leaving the hand loses the stake, so a
   reload can't undo a card); stand, double or a bust saves the result before the dealer's
   cards are shown, and reveal.js keeps the win out of the balances until they are. */

import * as C from "./config.js";
import { findParticipant } from "./model.js";
import * as store from "./store.js";
import { bjBlock, bjDeal, bjFinish, bjHandsOn, shellBalance } from "./shop.js";
import { total, draw, RANKS, SUITS, rankOf, suitOf } from "./blackjack.js";
import { shownShells, raceDone, hiddenIds } from "./reveal.js";
import { shopFor } from "./shopui.js";
import { render, setHtml } from "./ui.js";
import { $, esc, prettyTime, todayKey, spendsBy } from "./util.js";

let hooks = null;                  /* { settle, guard } from app.js */
const KEY = "awc-bj";
let bet = C.BJ.bets[1];
try { const o = JSON.parse(localStorage.getItem(KEY)) || {}; if (C.BJ.bets.includes(o.bet)) bet = o.bet; } catch { }
const keep = () => { try { localStorage.setItem(KEY, JSON.stringify({ bet })); } catch { } };

/* The hand on the table: { id, bet, p, d, dbl, end } (shop.js) plus what is shown:
   phase "play" | "wait" | "reveal" | "done", hole (the dealer's second card face up),
   vis (dealer cards shown), seen { p, d } (cards already dealt in, so they don't fly in again). */
let hand = null, timer = 0;
const RES = { bj: "Blackjack!", win: "You win", push: "Push", lose: "Dealer wins", bust: "Bust" };

export function initBJ(h) {
  hooks = h;
  $("bjStakes").innerHTML = C.BJ.bets.map(b => '<button type="button" class="seg" data-bet="' + b + '">' + b + '</button>').join("");
  $("bjStakes").addEventListener("click", e => {
    const b = e.target.closest("[data-bet]");
    if (!b || live()) return;
    bet = Number(b.dataset.bet); keep(); renderBJ();
  });
  $("bjActs").addEventListener("click", e => {
    const b = e.target.closest("[data-bj]");
    if (!b || b.disabled) return;
    const act = b.dataset.bj;
    if (act === "deal") deal();
    else if (act === "hit") hit();
    else finish(act);
  });
}
const live = () => hand && hand.phase !== "done";
const fresh = p => findParticipant(p.name) || p;

/* ---- the panel ------------------------------------------------------------------ */
export function renderBJ() {
  const p = shopFor();
  if (!p) return;
  for (const b of $("bjStakes").children) { const on = Number(b.dataset.bet) === bet; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); b.disabled = !!live(); }
  const play = hand && hand.phase === "play", block = bjBlock(p, bet);
  const btn = k => $("bjActs").querySelector('[data-bj="' + k + '"]');
  btn("deal").hidden = !!live(); btn("deal").disabled = !!block;
  setHtml("bjDeal", (hand ? "Deal again" : "Deal") + " &middot; " + bet + " shells");
  btn("deal").style.setProperty("--pc", p.color);
  for (const k of ["hit", "stand", "double"]) { btn(k).hidden = !live(); btn(k).disabled = !play; }
  btn("double").disabled = !play || hand.p.length !== 2 || shellBalance(p) < hand.bet;
  const left = C.BJ.perDay - bjHandsOn(p);
  $("bjNote").textContent = live() ? "" : block || left + " of " + C.BJ.perDay + " hands left today. You have " + shownShells(p) + " shells.";
  drawTable();
  renderFeed(p);
}

const cardHtml = (c, i, isNew) => {
  const s = suitOf(c), red = s === 1 || s === 2;
  return '<span class="bj-card' + (red ? ' red' : '') + (isNew ? ' deal' : '') + '" style="--i:' + i + '" aria-label="' + RANKS[rankOf(c) - 1] + SUITS[s] + '">' +
         '<b>' + RANKS[rankOf(c) - 1] + '</b><i>' + SUITS[s] + '</i></span>';
};
const backHtml = (i, isNew) => '<span class="bj-card back' + (isNew ? ' deal' : '') + '" style="--i:' + i + '" aria-label="face down"></span>';
const totText = cards => { const t = total(cards); return t.t + (t.soft && t.t < 21 ? '<small>soft</small>' : ''); };

function drawTable() {
  if (!hand) {
    setHtml("bjDealer", ""); setHtml("bjPlayer", ""); setHtml("bjDTot", ""); setHtml("bjPTot", "");
    setHtml("bjMsg", '<span style="opacity:.7">Place a stake and deal.</span>');
    return;
  }
  const seen = hand.seen, dShow = hand.d.slice(0, hand.vis);
  let n = 0;
  setHtml("bjPlayer", hand.p.map((c, i) => cardHtml(c, i >= seen.p ? n++ : 0, i >= seen.p)).join(""));
  setHtml("bjDealer", dShow.map((c, i) => i === 1 && !hand.hole ? backHtml(i >= seen.d ? n++ : 0, i >= seen.d) : cardHtml(c, i >= seen.d ? n++ : 0, i >= seen.d)).join(""));
  seen.p = hand.p.length; seen.d = dShow.length;
  setHtml("bjPTot", totText(hand.p));
  setHtml("bjDTot", hand.hole ? totText(dShow) : totText(hand.d.slice(0, 1)));
  if (hand.phase === "done" && hand.end) {
    const e = hand.end, stake = hand.bet * (hand.dbl ? 2 : 1), net = e.won - stake;
    const dealerBJ = e.res === "lose" && hand.d.length === 2 && total(hand.d).t === 21;
    setHtml("bjMsg", esc(dealerBJ ? "Dealer has blackjack" : RES[e.res] || "") + ' ' +
      (net > 0 ? '<span class="pill good">+' + net + ' shells</span>' : net === 0 ? '<span class="pill">stake back</span>' : '<span class="pill">&minus;' + stake + '</span>'));
  } else setHtml("bjMsg", hand.dbl ? "Doubled" : "");
}

function renderFeed(p) {
  const day = todayKey(), hid = hiddenIds(p), list = spendsBy(p, C.BJ.kind).filter(s => String(s.at).slice(0, 10) === day && !hid.has(s.id));
  const ends = new Map(list.filter(s => s.role === "end").map(s => [s.hand, s]));
  const rows = list.filter(s => s.role === "deal").slice(-8).reverse().map(d => {
    const e = ends.get(d.id);
    if (!e) return hand && hand.id === d.id ? '' : '<li><span class="t">' + esc(prettyTime(d.at)) + '</span><span class="dim">Left unfinished &middot; &minus;' + (Number(d.bet) || 0) + '</span></li>';
    const stake = (Number(d.bet) || 0) + (Number(e.bet) || 0), net = (Number(e.won) || 0) - stake;
    const pt = Array.isArray(e.pc) ? total(e.pc).t : "?", dt = Array.isArray(e.dc) ? total(e.dc).t : "?";
    return '<li><span class="t">' + esc(prettyTime(e.at)) + '</span><strong>' + esc(RES[e.res] || "?") + '</strong> <span class="dim">&middot; ' + pt + ' vs ' + dt +
           (Number(e.bet) ? ' &middot; doubled' : '') + '</span> ' + (net > 0 ? '<span class="pill good">+' + net + '</span>' : net === 0 ? '<span class="dim">&plusmn;0</span>' : '<span class="dim">&minus;' + stake + '</span>') + '</li>';
  }).filter(Boolean);
  setHtml("bjFeed", rows.length ? rows.join("") : '<li class="dim">No hands today.</li>');
}

/* ---- play ----------------------------------------------------------------------- */
async function deal() {
  if (live() || !hooks.guard()) return;
  const p = shopFor();
  if (!p) return;
  clearTimeout(timer);
  $("bjDeal").disabled = true;
  let h = null;
  await store.serial(async () => {
    h = await bjDeal(fresh(p), bet);
    if (!h) return;
    hand = Object.assign(h, { phase: h.end ? "wait" : "play", hole: false, vis: 2, seen: { p: 0, d: 0 } });
    await hooks.settle();
  });
  if (!h) { renderBJ(); $("bjNote").textContent = "Deal failed: " + (bjBlock(fresh(p), bet) || "couldn't save") + "."; return; }
  renderBJ();
  if (hand.end) timer = setTimeout(reveal, 900);           /* a blackjack on the deal: show it */
}

function hit() {
  if (!hand || hand.phase !== "play") return;
  hand.p.push(draw());
  const t = total(hand.p).t;
  if (t > 21) finish("bust");
  else if (t === 21) finish("stand");
  else renderBJ();
}

async function finish(how) {
  if (!hand || hand.phase !== "play" || !hooks.guard()) return;
  const p = shopFor();
  if (!p) return;
  hand.phase = "wait";
  renderBJ();
  let ok = null;
  await store.serial(async () => {
    ok = await bjFinish(fresh(p), hand, how);
    if (ok) await hooks.settle();
  });
  if (!ok) {                                               /* not saved: the hand is still on */
    hand.phase = "play"; renderBJ();
    $("bjNote").textContent = how === "double" ? "Not enough shells to double." : "Couldn't save. Try again.";
    return;
  }
  renderBJ();
  timer = setTimeout(reveal, how === "double" ? 700 : 350);
}

/* Turns the dealer's card over, then deals the dealer's draws one at a time. */
function reveal() {
  if (!hand || !hand.end) return;
  hand.phase = "reveal";
  if (!hand.hole) { hand.hole = true; hand.seen.d = Math.min(hand.seen.d, 1); renderBJ(); timer = setTimeout(reveal, C.BJ.step * 1000); return; }
  if (hand.vis < hand.d.length) { hand.vis++; renderBJ(); timer = setTimeout(reveal, C.BJ.step * 1000); return; }
  hand.phase = "done";
  raceDone.add(hand.end.id);
  render();                                                /* the win shows everywhere now */
}
