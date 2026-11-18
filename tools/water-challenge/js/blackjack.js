/* Blackjack rules (rev 1.52.0), pure: no page and no saving (shop.js saves, bjui.js draws).
   An endless deck: every card is any of the 52 (0..51: rank = c % 13 + 1, suit = c / 13).
   The dealer stands on all 17s. Blackjack pays 3 to 2, rounded down to whole shells. */

export const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
export const SUITS = ["♠", "♥", "♦", "♣"];
export const rankOf = c => (c % 13) + 1;
export const suitOf = c => Math.floor(c / 13) % 4;
export const draw = (rnd = Math.random) => Math.min(51, Math.floor(rnd() * 52));

/* A hand's best total; soft = an ace still counts 11. */
export function total(cards) {
  let t = 0, aces = 0;
  for (const c of cards) { const r = rankOf(c); t += r >= 10 ? 10 : r; if (r === 1) aces++; }
  const soft = aces > 0 && t + 10 <= 21;
  return { t: soft ? t + 10 : t, soft };
}
export const natural = cards => cards.length === 2 && total(cards).t === 21;

/* The dealer draws to 17 or more. */
export function dealerPlay(d, rnd = Math.random) {
  while (total(d).t < 17) d.push(draw(rnd));
  return d;
}

/* What the hand pays back (stake included): res "bj" | "win" | "push" | "lose" | "bust". */
export function settle(pc, dc, bet, dbl) {
  const stake = bet * (dbl ? 2 : 1), pn = natural(pc) && !dbl, dn = natural(dc), pt = total(pc).t, dt = total(dc).t;
  if (pn && dn) return { res: "push", won: stake };
  if (pn) return { res: "bj", won: bet + Math.floor(bet * 1.5) };
  if (pt > 21) return { res: "bust", won: 0 };
  if (dn) return { res: "lose", won: 0 };
  if (dt > 21 || pt > dt) return { res: "win", won: stake * 2 };
  if (pt === dt) return { res: "push", won: stake };
  return { res: "lose", won: 0 };
}

/* Ends a hand: the dealer plays unless the player bust or either side has blackjack. */
export function closeHand(hand, rnd = Math.random) {
  if (!(total(hand.p).t > 21 || natural(hand.p) || natural(hand.d))) dealerPlay(hand.d, rnd);
  return settle(hand.p, hand.d, hand.bet, hand.dbl);
}
