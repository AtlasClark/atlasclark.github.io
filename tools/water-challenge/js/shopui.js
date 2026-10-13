/* The Shop tab: who is shopping, their balance, Plinko (with drops from every open
   shop replayed live), today's reroll, and pets for sale. */

import * as C from "./config.js";
import { S, findParticipant, activeParticipants, tokensEarned, capBonus } from "./model.js";
import * as store from "./store.js";
import { shopOpen, balance, spentTotal, priceOf, rerollBlock, reroll, plinkoBlock, plinkoPlay, plinkoOdds, buyBlock, buy } from "./shop.js";
import { onLive, emit } from "./live.js";
import { petLabel, petGridOrder, rarityLabel, petBinIndex, isGrave, announce } from "./pets.js";
import { PlinkoBoard } from "./plinko.js";
import { $, esc, has, todayKey, prettyTime, localStamp, bus } from "./util.js";
import { setMsg, ensureIcons, ui } from "./ui.js";

let hooks = null;            /* { settle, guard, askConfirm, pollSoon } from app.js */
let board = null;
const feed = [];

export function initShop(h) {
  hooks = h;
  const pct = v => v >= 0.01 ? (v * 100).toFixed(1) + "%" : (v * 100).toFixed(2) + "%";
  $("plinkoOdds").innerHTML = plinkoOdds().map((v, i) =>
    '<span class="rar r' + i + '">' + esc(C.PET_BINS[i].name) + '</span> ' + pct(v)).join(" &middot; ");
  try { ui.shopFor = localStorage.getItem("awc-shop-for") || ""; } catch { }
  $("shopWho").addEventListener("click", e => {
    const b = e.target.closest("[data-who]");
    if (!b) return;
    ui.shopFor = b.dataset.who;
    try { localStorage.setItem("awc-shop-for", ui.shopFor); } catch { }
    renderShop();
  });
  $("plinkoDrop").addEventListener("click", dropToken);
  $("rerollBox").addEventListener("click", e => { if (e.target.closest("#rerollBtn")) doReroll(); });
  $("buyGrid").addEventListener("click", e => {
    const c = e.target.closest("[data-buy]");
    if (c) doBuy(Number(c.dataset.buy));
  });
  window.addEventListener("resize", () => { if (board && ui.tab === "shop") board.resize($("plinkoWrap").clientWidth); });
  /* A drop from another page: joined part-way through if the shop is showing and it
     is still in the air; otherwise straight to the feed. */
  onLive("drop", (ev, late) => {
    if (board && ui.tab === "shop" && late < C.LIVE_SHOW_MS) board.drop(ev, late);
    else addFeed(ev);
    hooks.pollSoon();
  });
}

export function shopFor() {
  let p = ui.shopFor && findParticipant(ui.shopFor);
  if (!p) p = (S.mine && findParticipant(S.mine)) || activeParticipants()[0] || S.participants[0] || null;
  return p;
}

export function openShopFor(name) { ui.shopFor = name; try { localStorage.setItem("awc-shop-for", name); } catch { } }

/* ---- rendering ------------------------------------------------------------ */
export function renderShop() {
  const open = shopOpen();
  $("shopClosed").hidden = open;
  $("shopMain").hidden = !open;
  if (!open) return;
  ensureIcons();
  if (!board) board = new PlinkoBoard($("plinkoCanvas"), landed);
  else if (Math.abs(board.w - Math.min(460, $("plinkoWrap").clientWidth)) > 4) board.resize($("plinkoWrap").clientWidth);
  const p = shopFor();
  if (!p) { $("shopBalance").textContent = "Nobody on the roster yet."; return; }

  $("shopWho").innerHTML = S.participants.map(x =>
    '<button type="button" class="who-chip' + (x === p ? " on" : "") + '" data-who="' + esc(x.name) + '" style="--pc:' + x.color + '">' +
    '<i class="dot" style="background:' + x.color + '"></i>' + esc(x.name) + '<b>' + balance(x) + '</b></button>').join("");
  const bonus = capBonus(p);
  $("shopBalance").innerHTML = '<span class="coin"></span><b>' + balance(p) + '</b> token' + (balance(p) === 1 ? '' : 's') +
    ' <span class="dim">&middot; ' + tokensEarned(p) + ' for goal days' + (bonus ? ' + ' + bonus + ' cap bonus' : '') +
    ' &middot; ' + spentTotal(p) + ' spent</span>';

  const pb = plinkoBlock(p);
  $("plinkoDrop").disabled = !!pb;
  $("plinkoDrop").innerHTML = 'Drop a token for ' + esc(p.name);
  $("plinkoNote").textContent = pb || "";
  $("plinkoDrop").style.setProperty("--pc", p.color);

  const rb = rerollBlock(p), k = Number(p.rollKind), rolledToday = p.petRollDay === todayKey() && k >= 0;
  $("rerollBox").innerHTML =
    (rolledToday
      ? '<div class="reroll-now">' + (k < C.PET_COUNT ? '<i class="pi pi-' + k + '"></i>' : '') +
        '<div><span class="dim">Today\'s roll</span><br><b>' + esc(petLabel(k)) + '</b> <span class="rar">' + esc(rarityLabel(k)) + '</span>' +
        (p.rerollDay === todayKey() ? ' <span class="pill">rerolled</span>' : '') + '</div></div>'
      : '') +
    '<button type="button" id="rerollBtn" class="btn primary"' + (rb ? ' disabled' : '') + '>Reroll &middot; ' + C.REROLL_COST + ' token</button>' +
    (rb ? '<p class="hint">' + esc(rb) + '</p>' : '<p class="hint">Normal odds. Replaces today\'s pet.</p>');

  const h = [];
  for (const kind of petGridOrder()) {
    const owned = has(p.pets, kind), buried = isGrave(p, kind), why = buyBlock(p, kind), price = priceOf(kind);
    const state = owned ? "owned" : why ? "short" : "can";
    h.push('<button type="button" class="buy-cell r' + petBinIndex(kind) + ' ' + state + (buried ? ' buried' : '') + '"' +
           (state === "can" ? ' data-buy="' + kind + '"' : ' disabled') +
           ' title="' + esc(owned || buried ? C.PET_NAMES[kind] : "???") + ' &middot; ' + esc(rarityLabel(kind)) +
           (buried ? ' &middot; buried: buying brings it back' : '') + (why && !owned ? ' &middot; ' + esc(why) : '') + '">' +
           '<i class="pi pi-' + (buried ? "grave" : kind) + '"></i>' +
           '<span class="bn">' + (owned || buried ? esc(C.PET_NAMES[kind]) : "???") + '</span>' +
           '<span class="bp">' + (owned ? "owned" : '<span class="coin sm"></span>' + price + (buried ? ' <small>revive</small>' : '')) + '</span></button>');
  }
  $("buyGrid").innerHTML = h.join("");
  renderFeed();
}

function renderFeed() {
  $("plinkoFeed").innerHTML = feed.length
    ? feed.slice(0, 12).map(f => '<li><span class="t">' + esc(prettyTime(f.ts)) + '</span><i class="dot" style="background:' + f.color + '"></i><strong>' +
        esc(f.name) + '</strong> &rarr; <span class="rar r' + f.bin + '">' + esc(C.PET_BINS[f.bin].name) + '</span> ' +
        (f.kind < 0 ? '<span class="dim">nothing left there, token returned</span>'
                    : esc(petLabel(f.kind)) + (f.revived ? ' <span class="pill good">back from the grave</span>'
                                              : f.fresh ? ' <span class="pill good">new</span>' : ' <span class="dim">(had it)</span>')) + '</li>').join("")
    : '<li class="dim">No drops yet.</li>';
}

function addFeed(ev) {
  if (feed.some(f => f.id === ev.id)) return;
  feed.unshift({ id: ev.id, ts: localStamp(new Date(ev.at)), name: ev.name, color: ev.color, bin: ev.bin, kind: ev.kind,
                 fresh: ev.fresh, revived: ev.revived });
  renderFeed();
}

function landed(ev) {
  addFeed(ev);
  if (ev.mine && ev.kind < 0) {
    setMsg("Nothing left in " + C.PET_BINS[ev.bin].name + ". Token returned.", false);
    renderShop();
  } else if (ev.mine) {
    setMsg(ev.name + " won " + (ev.fresh ? "the " : "another ") + petLabel(ev.kind) + " (" + C.PET_BINS[ev.bin].name + ") on Plinko" +
           (ev.revived ? ", back from the grave!" : ev.fresh ? "!" : ", which they already had."), true);
    if (ev.homunculus) setMsg(ev.name + " has all " + C.PET_COUNT + " alive. The pen made something new.", true);
    renderShop();
  }
}

/* ---- actions -------------------------------------------------------------- */
async function dropToken() {
  if (!hooks.guard()) return;
  const p = shopFor();
  if (!p) return;
  $("plinkoDrop").disabled = true;
  let res = null;
  await store.serial(async () => {
    res = await plinkoPlay(p);
    if (res) await hooks.settle();
  });
  if (!res) { setMsg("Drop failed: " + (plinkoBlock(p) || "couldn't save") + ".", false); renderShop(); return; }
  const ev = emit("drop", Object.assign({}, res, { label: res.kind < 0 ? "nothing left" : (res.fresh ? "+" : "") + petLabel(res.kind) }));
  board.drop(Object.assign({ mine: true }, ev));
  renderShop();                    /* the balance drops at once; the result shows on landing */
}

async function doReroll() {
  if (!hooks.guard()) return;
  const p = shopFor();
  if (!p || rerollBlock(p)) return;
  const ok = await hooks.askConfirm("Reroll " + p.name + "'s pet?", C.REROLL_COST + " token. Rolls again at normal odds" +
    (p.rollWasNew ? "; the " + petLabel(Number(p.rollKind)) + " leaves the collection" : "") + ".", "Reroll");
  if (!ok) return;
  await store.serial(async () => {
    const r = await reroll(p);
    if (!r) { setMsg("Reroll failed.", false); return; }
    announce(p, r.res, " rerolled and");
    await hooks.settle();
  });
  renderShop();
}

async function doBuy(kind) {
  if (!hooks.guard()) return;
  const p = shopFor();
  if (!p || buyBlock(p, kind)) return;
  const ok = await hooks.askConfirm("Buy the " + petLabel(kind) + " for " + p.name + "?",
    priceOf(kind) + " tokens." + (isGrave(p, kind) ? " It comes back from the grave." : "") +
    (store.petKindFor(p) === C.MYSTERY_KIND ? "" : " " + p.name + " will wear it."), "Buy");
  if (!ok) return;
  await store.serial(async () => {
    const r = await buy(p, kind);
    if (!r) { setMsg("Purchase failed.", false); return; }
    setMsg(p.name + (r.revived ? " bought the " + petLabel(kind) + " back from the grave." : " bought the " + petLabel(kind) + "."), true);
    const shown = r.homunculus ? C.HOMUNCULUS_KIND : kind;
    bus.unlock({ name: p.name, kind: shown, hue: r.homunculus ? 210 : r.hue, fresh: true,
                 equipped: store.petKindFor(p) === shown, bought: true });
    await hooks.settle();
  });
  renderShop();
}

/* Keeps the board sized to its column when the tab opens. */
export function shopTabChanged(active) {
  if (active && board) board.resize($("plinkoWrap").clientWidth);
}
