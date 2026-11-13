/* Shop prices (rev 1.50.1): the built-in prices, and the team's own from Settings >
   Shop prices (_settings.json "prices": { key: whole number }, written only for prices
   that differ from the built-in ones). A price is read when something is bought; every
   spend keeps what it cost, so a change never alters what was paid before.
   Keys: "reroll" (tokens), "paint" (shells), "shard1".."shard3" (shards to bring in a pet,
   by pen), and every Style shop and Hat shop item by its id ("finish:gold", "hat:wizard").
   Combining shards (SHARD_FUSE) is not a price: past combines are counted with it. */

import * as C from "./config.js";
import { COSMETICS, SLOTS } from "./cosmetics.js";

export const PRICE_MAX = 999;
/* What things cost now: read these, never the built-in constants. */
export const live = { reroll: C.REROLL_COST, paint: 1 };
const BASE = { reroll: C.REROLL_COST, paint: 1, shard: C.SHARD_COST.slice() };
for (const it of Object.values(COSMETICS)) it.base = it.price;

/* Every price an admin may set, in the order Settings lists them: { key, name, group, unit, base }. */
export function priceList() {
  const out = [
    { key: "reroll", name: "Reroll", group: "Tokens and shards", unit: "tokens", base: BASE.reroll },
    ...[1, 2, 3].map(pen => ({ key: "shard" + pen, name: "A " + C.PEN_LABELS[pen].toLowerCase() + " pet", group: "Tokens and shards", unit: "shards", base: BASE.shard[pen] })),
    { key: "paint", name: "Recolour", group: "Style shop", unit: "shells", base: BASE.paint }];
  for (const s of SLOTS) for (const it of Object.values(COSMETICS)) {
    if (it.slot === s.key) out.push({ key: it.id, name: it.name, group: s.key === "hat" ? "Hat shop" : "Style shop: " + s.name, unit: "shells", base: it.base });
  }
  return out;
}

/* Only known keys, whole numbers from 1 to PRICE_MAX, and only where they differ from the built-in price. */
export function cleanPrices(o) {
  const out = {};
  if (!o || typeof o !== "object") return out;
  for (const p of priceList()) {
    const v = o[p.key];
    if (Number.isInteger(v) && v >= 1 && v <= PRICE_MAX && v !== p.base) out[p.key] = v;
  }
  return out;
}

/* Puts the team's prices (or the built-in ones, for anything not set) in force. */
export function applyPrices(o) {
  const m = cleanPrices(o);
  live.reroll = m.reroll ?? BASE.reroll;
  live.paint = m.paint ?? BASE.paint;
  for (const pen of [1, 2, 3]) C.SHARD_COST[pen] = m["shard" + pen] ?? BASE.shard[pen];
  for (const it of Object.values(COSMETICS)) it.price = m[it.id] ?? it.base;
}
