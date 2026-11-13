/* The Shop tab: who is shopping, their balance, today's reroll, and shards (combine,
   bring in a pet); and Plinko, whose panel sits on the Casino tab (rev 1.46.0), with
   drops from every open page replayed live. */

import * as C from "./config.js";
import { S, findParticipant, tokensEarned, capBonus } from "./model.js";
import * as store from "./store.js";
import { balance, spentTotal, rerollBlock, reroll, plinkoBlock, plinkoPlay, plinkoOdds, chestOdds, chestWinnings, splinkoBlock, splinkoPlay,
         fuseBlock, fuse, pickBlock, pickPet, shardCost, shardsText, tierOf } from "./shop.js";
import { landed as landedIds, setFlying, HOLD_MS, hiddenPets, shownBalance, shownChest, anyPending, rollHoldLeft, shownShards, shownShells } from "./reveal.js";
import { onLive, emit } from "./live.js";
import { petLabel, petGridOrder, rarityLabel, petBinIndex, isGrave, announce, penOf, pensOf, penAlive, rewardMsg, rewardPen } from "./pets.js";
import { PlinkoBoard } from "./plinko.js";
import { $, esc, has, todayKey, prettyTime, localStamp, bus } from "./util.js";
import { setMsg, ensureIcons, ui, render, setHtml } from "./ui.js";
import { initStyle, renderStyle } from "./styleui.js";
import { initHats, renderHats } from "./hatui.js";

let hooks = null;            /* { settle, guard, askConfirm, pollSoon } from app.js */
let board = null, holdTimer = 0;
/* What this browser drops on Plinko: tokens (pets) or shells (multipliers), and the shell
   stake. Kept per browser (localStorage awc-plinko {mode, bet}). */
const PLINKO_KEY = "awc-plinko";
const drop = { mode: "token", bet: C.SPLINKO_BETS[1] };
try {
  const o = JSON.parse(localStorage.getItem(PLINKO_KEY)) || {};
  if (o.mode === "shell") drop.mode = "shell";
  if (C.SPLINKO_BETS.includes(o.bet)) drop.bet = o.bet;
} catch { }
const keepDrop = () => { try { localStorage.setItem(PLINKO_KEY, JSON.stringify(drop)); } catch { } };
const feed = [];
setFlying(() => board ? board.inFlight() : []);

export function initShop(h) {
  hooks = h;
  const pct = v => v >= 0.01 ? (v * 100).toFixed(1) + "%" : (v * 100).toFixed(2) + "%";
  $("plinkoOdds").innerHTML = plinkoOdds().map((v, i) =>
    '<span class="rar r' + i + '">' + esc(C.PET_BINS[i].name) + '</span> ' + pct(v)).join(" &middot; ") +
    ' &middot; <span class="rar chest">&#9733; Chest</span> ' + pct(chestOdds());
  $("shopBalance").addEventListener("click", e => { if (e.target.closest("[data-act=whoami]")) hooks.whoAmI(); });
  initStyle(Object.assign({}, h, { rerender: () => renderShop() }), shopFor);
  initHats(Object.assign({}, h, { rerender: () => renderShop() }), shopFor);
  $("plinkoDrop").addEventListener("click", dropToken);
  $("plinkoBets").innerHTML = C.SPLINKO_BETS.map(b => '<button type="button" class="seg" data-bet="' + b + '">' + b + '</button>').join("");
  $("plinkoMode").addEventListener("click", e => {
    const m = e.target.closest("[data-mode]"), b = e.target.closest("[data-bet]");
    if (m) drop.mode = m.dataset.mode === "shell" ? "shell" : "token";
    else if (b) drop.bet = Number(b.dataset.bet);
    else return;
    keepDrop(); renderPlinko();
  });
  $("rerollBox").addEventListener("click", e => { if (e.target.closest("#rerollBtn")) doReroll(); });
  $("buyPens").addEventListener("click", e => {
    const b = e.target.closest("[data-pen]");
    if (b) { ui.shopPen = Number(b.dataset.pen); renderShop(); }
  });
  $("buyGrid").addEventListener("click", e => {
    const c = e.target.closest("[data-buy]");
    if (c) doPick(Number(c.dataset.buy));
  });
  $("shardBar").addEventListener("click", e => {
    const b = e.target.closest("[data-fuse]");
    if (b) doFuse(Number(b.dataset.fuse));
  });
  window.addEventListener("resize", () => { if (board && ui.tab === "casino") board.resize($("plinkoWrap").clientWidth); });
  /* A drop from another page: joined part-way through if the shop is showing and it
     is still in the air; otherwise straight to the feed. */
  onLive("drop", (ev, late) => {
    if (board && ui.tab === "casino" && late < C.LIVE_SHOW_MS) board.drop(ev, late);
    else addFeed(ev);
    hooks.pollSoon();
  });
}

const binName = b => (C.PET_BINS[b] || { name: "?" }).name;      /* a drop from a newer page may name a slot this one lacks */
/* A refresh while a dialog was open has replaced the person: act on the current copy. */
const fresh = p => findParticipant(p.name) || p;

/* A shard of rarity t, drawn in that rarity's colour. */
export const shardIcon = t => '<svg class="shardico t' + t + '" viewBox="0 0 10 13" aria-hidden="true"><path d="M5 .6 9.4 4.8 5 12.4 .6 4.8Z"/></svg>';
const tierName = t => C.PET_BINS[t].name;

/* A browser spends only its own glass's tokens ("your glass", set with the name), so
   nobody spends someone else's by a stray click. The other chips just show balances. */
export function shopFor() {
  return (S.mine && findParticipant(S.mine)) || null;
}

/* ---- rendering ------------------------------------------------------------ */
/* The Shop tab: balances, reroll, shards and the Style shop. */
export function renderShop() {
  ensureIcons();
  const p = shopFor();
  setHtml("shopWho", S.participants.map(x =>
    '<button type="button" class="who-chip' + (x === p ? " on" : "") + '" style="--pc:' + x.color + '"' +
    (x === p ? '' : ' disabled title="Only ' + esc(x.name) + '&rsquo;s own browser can spend these"') + '>' +
    '<i class="dot" style="background:' + x.color + '"></i>' + esc(x.name) + '<b>' + shownBalance(x) + '</b></button>').join(""));
  $("shopGrid").hidden = !p;
  renderStyle();
  renderHats();
  if (!p) {
    setHtml("shopBalance", S.participants.length
      ? 'Set <b>your glass</b> to shop: tokens are spent only from your own. <button type="button" class="btn primary small" data-act="whoami">Pick your glass</button>'
      : "Nobody on the roster yet.");
    return;
  }
  const bonus = capBonus(p), bal = shownBalance(p), fromChest = chestWinnings(p) - (balance(p) - bal);
  setHtml("shopBalance", '<span class="coin"></span><b>' + bal + '</b> token' + (bal === 1 ? '' : 's') +
    ' <span class="dim">&middot; ' + tokensEarned(p) + ' for goal days' + (bonus ? ' + ' + bonus + ' cap bonus' : '') +
    (fromChest ? ' + ' + fromChest + ' from the chest' : '') + ' &middot; ' + spentTotal(p) + ' spent</span>');
  const rb = rerollBlock(p), k = Number(p.rollKind), rolledToday = p.petRollDay === todayKey() && k >= 0, held = rollHoldLeft(p);
  setHtml("rerollBox", (rolledToday
      ? '<div class="reroll-now">' + (penOf(k) > 0 && !held ? '<i class="pi pi-' + k + '"></i>' : '') +
        '<div><span class="dim">Today\'s roll</span><br>' + (held ? '<b>?</b>' : '<b>' + esc(petLabel(k)) + '</b> <span class="rar">' + esc(rarityLabel(k)) + '</span>') +
        (p.rerollDay === todayKey() ? ' <span class="pill">rerolled</span>' : '') + '</div></div>'
      : '') +
    '<button type="button" id="rerollBtn" class="btn primary"' + (rb ? ' disabled' : '') + '>Reroll &middot; ' + C.REROLL_COST + ' token</button>' +
    (rb ? '<p class="hint">' + esc(rb) + '</p>' : '<p class="hint">Normal odds. Replaces today\'s pet' +
          (rolledToday && !p.rollWasNew && tierOf(k) >= 0 ? ' and its shard' : '') + '.</p>'));

  /* A win still falling on the board is shown as it was before the drop. */
  const hidden = hiddenPets(p);
  clearTimeout(holdTimer);
  if (anyPending()) holdTimer = setTimeout(render, HOLD_MS);
  /* shards: a count per rarity with its combine button, then the pets they bring in */
  const sh = shownShards(p), top = C.PET_BINS.length - 1;
  setHtml("shardBar", C.PET_BINS.map((b, t) =>
    '<div class="shard-tier r' + t + '">' + shardIcon(t) + '<b>' + sh[t] + '</b><span class="sn">' + esc(b.name) + '</span>' +
    (t < top ? '<button type="button" class="btn small" data-fuse="' + t + '"' + (sh[t] < C.SHARD_FUSE ? ' disabled' : '') +
               ' title="Combine ' + C.SHARD_FUSE + ' ' + esc(b.name) + ' shards into 1 ' + esc(tierName(t + 1)) + ' shard">' +
               C.SHARD_FUSE + ' &rarr; 1 ' + shardIcon(t + 1) + '</button>'
             : '<span class="dim sx">top</span>') + '</div>').join(""));
  const h = [];
  /* every open pen, one tab each, once there is more than one */
  const pens = pensOf(p), pen = pens.includes(ui.shopPen) ? ui.shopPen : pens.at(-1);
  $("buyPens").hidden = pens.length < 2;
  if (pens.length > 1) setHtml("buyPens", pens.map(x => '<button type="button" class="pen-tab' + (x === pen ? ' on' : '') + '" data-pen="' + x + '">' +
    C.PEN_LABELS[x] + ' <b>' + penAlive(p, x) + '</b></button>').join(""));
  for (const kind of petGridOrder(pen)) {
    const held = hidden.has(kind), owned = has(p.pets, kind) && !held, buried = isGrave(p, kind) || (held && hidden.get(kind));
    const t = petBinIndex(kind), cost = shardCost(kind), why = sh[t] < cost ? "Needs " + shardsText(cost, t) + "." : held ? "" : pickBlock(p, kind);
    const state = owned ? "owned" : why ? "short" : "can";
    h.push('<button type="button" class="buy-cell r' + t + ' ' + state + (buried ? ' buried' : '') + '"' +
           (state === "can" ? ' data-buy="' + kind + '"' : ' disabled') +
           ' title="' + esc(owned || buried ? C.PET_NAMES[kind] : "???") + ' &middot; ' + esc(rarityLabel(kind)) +
           (buried ? ' &middot; buried: shards bring it back' : '') + (why && !owned ? ' &middot; ' + esc(why) : '') + '">' +
           '<i class="pi pi-' + (buried ? "grave" : kind) + '"></i>' +
           '<span class="bn">' + (owned || buried ? esc(C.PET_NAMES[kind]) : "???") + '</span>' +
           '<span class="bp">' + (owned ? "owned" : shardIcon(t) + cost + (buried ? ' <small>revive</small>' : '')) + '</span></button>');
  }
  setHtml("buyGrid", h.join(""));
}

/* The Plinko panel, on the Casino tab (rev 1.49.1: drawn on its own, not with the shop). */
export function renderPlinko() {
  if (!board) board = new PlinkoBoard($("plinkoCanvas"), landed);
  else if ($("plinkoWrap").clientWidth && Math.abs(board.w - Math.min(460, $("plinkoWrap").clientWidth)) > 4) board.resize($("plinkoWrap").clientWidth);
  const p = shopFor();
  if (!p) return;
  const pot = shownChest();
  setHtml("chestPot", '<span class="chest-star">&#9733;</span> Community Chest: <b>' + pot + '</b> token' + (pot === 1 ? '' : 's') +
    ' <span class="dim">&middot; ' + (pot ? Math.round(C.CHEST_CHANCE * 100) + '% chance to win it all from the centre cup' : 'empty: the next centre landing starts it') + '</span>');

  const shell = drop.mode === "shell", pb = shell ? splinkoBlock(p, drop.bet) : plinkoBlock(p);
  board.setMode(drop.mode);
  for (const b of $("plinkoMode").querySelectorAll("[data-mode]")) { const on = b.dataset.mode === drop.mode; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); }
  for (const b of $("plinkoBets").children) { const on = Number(b.dataset.bet) === drop.bet; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); }
  $("plinkoBets").hidden = !shell;
  $("plinkoEyebrow").textContent = shell ? drop.bet + " shells per drop" : "1 token per drop";
  $("plinkoDrop").disabled = !!pb;
  setHtml("plinkoDrop", shell ? 'Drop ' + drop.bet + ' shells for ' + esc(p.name) : 'Drop a token for ' + esc(p.name));
  $("plinkoNote").textContent = pb || (shell ? "You have " + shownShells(p) + " shells." : "");
  $("plinkoDrop").style.setProperty("--pc", p.color);

  clearTimeout(holdTimer);
  if (anyPending()) holdTimer = setTimeout(render, HOLD_MS);
  renderFeed();
}

function renderFeed() {
  setHtml("plinkoFeed", feed.length
    ? feed.slice(0, 12).map(f => '<li><span class="t">' + esc(prettyTime(f.ts)) + '</span><i class="dot" style="background:' + f.color + '"></i><strong>' +
        esc(f.name) + '</strong> &rarr; ' +
        (f.shell ? '<span class="rar mult">&times;' + C.splinkoMult(Number(f.bin)) + '</span> ' + Number(f.shell.bet) + ' &rarr; ' +
                   '<span class="pill' + (f.shell.won > f.shell.bet ? ' good' : '') + '">' + Number(f.shell.won) + ' shell' + (Number(f.shell.won) === 1 ? '' : 's') + '</span>'
         : f.chest ? '<span class="rar chest">&#9733; Chest</span> ' +
                   (f.chest.won ? '<span class="pill good">won ' + f.chest.won + ' tokens</span>' : '<span class="dim">+1 token</span>')
         : '<span class="rar r' + Number(f.bin) + '">' + esc(binName(f.bin)) + '</span> ' +
           (f.kind < 0 ? '<span class="dim">nothing left there, token returned</span>'
                       : esc(petLabel(f.kind)) + (f.revived ? ' <span class="pill good">back from the grave</span>'
                                                 : f.fresh ? ' <span class="pill good">new</span>' : ' <span class="dim">+1 shard</span>'))) + '</li>').join("")
    : '<li class="dim">No drops yet.</li>');
}

function addFeed(ev) {
  if (feed.some(f => f.id === ev.id)) return;
  feed.unshift({ id: ev.id, ts: localStamp(new Date(ev.at)), name: ev.name, color: ev.color, bin: ev.bin, kind: ev.kind,
                 fresh: ev.fresh, revived: ev.revived, chest: ev.chest, shell: ev.shell });
  renderFeed();
}

function landed(ev) {
  landedIds.add(ev.id);
  addFeed(ev);
  render();                                        /* whatever this drop changed shows now */
  if (ev.shell) {
    if (ev.mine) setMsg("\u00d7" + C.splinkoMult(Number(ev.bin)) + ": " + ev.shell.bet + " shells in, " + ev.shell.won + " back.", ev.shell.won >= ev.shell.bet);
    else if (ev.shell.won >= 50) setMsg(ev.name + " hit \u00d7" + C.splinkoMult(Number(ev.bin)) + " on Plinko: " + ev.shell.won + " shells!", true);
  } else if (ev.chest && ev.chest.won) {
    setMsg(ev.name + " won the Community Chest: " + ev.chest.won + " tokens!", true);
  } else if (ev.chest) {
    if (ev.mine) setMsg("Into the Community Chest. It holds " + shownChest() + ".", true);
  } else if (ev.mine && ev.kind < 0) {
    setMsg("Nothing left in " + binName(ev.bin) + ". Token returned.", false);
  } else if (ev.mine) {
    setMsg(ev.name + " won " + (ev.fresh ? "the " : "another ") + petLabel(ev.kind) + " (" + binName(ev.bin) + ") on Plinko" +
           (ev.revived ? ", back from the grave!" : ev.fresh ? "!" : ": +1 " + binName(ev.bin) + " shard."), true);
    if (ev.reward != null) setMsg(rewardMsg(ev.name, ev.reward), true);
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
    const shell = drop.mode === "shell";
    res = shell ? await splinkoPlay(fresh(p), drop.bet) : await plinkoPlay(fresh(p));
    if (!res) return;
    /* the ball is in the air before anything redraws, so the win stays hidden until it lands */
    const label = res.shell ? "\u00d7" + C.splinkoMult(res.bin) + "  +" + res.shell.won
                : res.chest ? (res.chest.won ? "\u2605 +" + res.chest.won + " tokens!" : "\u2605 +1 to the chest")
                : res.kind < 0 ? "nothing left" : (res.fresh ? "+" : "") + petLabel(res.kind);
    const ev = emit("drop", Object.assign({}, res, { label }));
    board.drop(Object.assign({ mine: true }, ev));
    await hooks.settle();
  });
  if (!res) { setMsg("Drop failed: " + ((drop.mode === "shell" ? splinkoBlock(p, drop.bet) : plinkoBlock(p)) || "couldn't save") + ".", false); renderPlinko(); return; }
  renderPlinko();                    /* the balance drops at once; the result shows on landing */
}

async function doReroll() {
  if (!hooks.guard()) return;
  const p = shopFor();
  if (!p || rerollBlock(p)) return;
  const t = tierOf(Number(p.rollKind));
  const ok = await hooks.askConfirm("Reroll " + p.name + "'s pet?", C.REROLL_COST + " token. Rolls again at normal odds" +
    (p.rollWasNew ? "; the " + petLabel(Number(p.rollKind)) + " leaves the collection"
                  : t >= 0 ? "; the " + tierName(t) + " shard from it goes back" : "") + ".", "Reroll");
  if (!ok) return;
  await store.serial(async () => {
    const q = fresh(p);
    if (rerollBlock(q)) { setMsg(rerollBlock(q), false); return; }
    const r = await reroll(q);
    if (!r) { setMsg("Reroll failed.", false); return; }
    announce(q, r.res, " rerolled and");
    await hooks.settle();
  });
  renderShop();
}

async function doPick(kind) {
  if (!hooks.guard()) return;
  const p = shopFor();
  if (!p || pickBlock(p, kind)) return;
  const t = petBinIndex(kind), cost = shardCost(kind), price = shardsText(cost, t);
  const ok = await hooks.askConfirm("Bring in the " + petLabel(kind) + " for " + p.name + "?",
    price.charAt(0).toUpperCase() + price.slice(1) + "." + (isGrave(p, kind) ? " It comes back from the grave." : "") +
    (store.petKindFor(p) === C.MYSTERY_KIND ? "" : " " + p.name + " will wear it."), cost === 1 ? "Use shard" : "Use shards");
  if (!ok) return;
  await store.serial(async () => {
    const q = fresh(p);
    if (pickBlock(q, kind)) { setMsg(pickBlock(q, kind), false); return; }
    const r = await pickPet(q, kind);
    if (!r) { setMsg("That didn't save.", false); return; }
    setMsg(p.name + " used " + price + " on the " + petLabel(kind) + (r.revived ? ", back from the grave." : "."), true);
    const shown = r.reward ?? kind;
    bus.unlock({ name: p.name, kind: shown, hue: r.reward != null ? C.PEN_REWARDS[rewardPen(r.reward)].hue : r.hue, fresh: true,
                 equipped: store.petKindFor(q) === shown, bought: true, title: p.name + " used " + price });
    await hooks.settle();
  });
  renderShop();
}

async function doFuse(t) {
  if (!hooks.guard()) return;
  const p = shopFor();
  if (!p || fuseBlock(p, t)) return;
  const ok = await hooks.askConfirm("Combine " + C.SHARD_FUSE + " " + tierName(t) + " shards?",
    "They become 1 " + tierName(t + 1) + " shard. This can't be split back.", "Combine");
  if (!ok) return;
  await store.serial(async () => {
    const q = fresh(p);
    if (fuseBlock(q, t)) { setMsg(fuseBlock(q, t), false); return; }
    const r = await fuse(q, t);
    if (r === null) { setMsg("That didn't save.", false); return; }
    setMsg(p.name + " combined " + C.SHARD_FUSE + " " + tierName(t) + " shards into 1 " + tierName(r) + " shard.", true);
    await hooks.settle();
  });
  renderShop();
}

/* Keeps the board sized to its column when the Casino tab opens. */
export function shopTabChanged(active) {
  if (active && board) board.resize($("plinkoWrap").clientWidth);
}
