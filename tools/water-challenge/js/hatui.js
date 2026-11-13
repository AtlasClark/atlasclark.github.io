/* The Hat shop (rev 1.50.0), under the Style shop on the Shop tab: the hats of the
   "hat" slot (cosmetics.js), a close-up of your pet wearing the one you are looking at
   (sat on the pet's crown spot from the Pet Studio, at its size and tilt), and buy /
   wear / take off. A hat is a "cosmetic" spend like any Style shop item; the worn one
   is p.look.hat. Moving hats move here as on the glass (art.js, propart.js HAT_MOTION). */

import * as C from "./config.js";
import { findParticipant } from "./model.js";
import * as store from "./store.js";
import { COSMETICS, itemsIn } from "./cosmetics.js";
import { defs, hats, hatSvgFrom } from "./petdefs.js";
import { HAT_MOTION } from "./propart.js";
import { ownsCosmetic, cosmeticBlock, buyCosmetic, wearCosmetic, lookOf } from "./shop.js";
import { hueOf, hashHue } from "./pets.js";
import { drawCritter } from "./art.js";
import { shownShells } from "./reveal.js";
import { $, esc } from "./util.js";
import { setMsg, ui, setHtml } from "./ui.js";

const SHELL = '<span class="shellico sm"></span>';
let hooks = null, owner = null, running = false;

export function initHats(h, getOwner) {
  hooks = h; owner = getOwner;
  if (!$("hatGrid")) return;                       /* a page from before 1.50.0 (cached html): no Hat shop */
  $("hatGrid").addEventListener("click", e => {
    const b = e.target.closest("[data-hat]");
    if (b) { ui.hatTry = b.dataset.hat; renderHats(); }
  });
  $("hatAct").addEventListener("click", e => {
    const b = e.target.closest("[data-do]");
    if (b) act(b.dataset.do, b.dataset.item);
  });
}

const wornHat = p => { const k = lookOf(p).hat; return k ? "hat:" + k : ""; };

export function renderHats() {
  const p = owner && owner();
  if (!$("hatShop")) return;
  $("hatShop").hidden = !p;
  if (!p) return;
  const items = itemsIn("hat"), worn = wornHat(p);
  if (!COSMETICS[ui.hatTry] || COSMETICS[ui.hatTry].slot !== "hat") ui.hatTry = worn || items[0].id;
  const bal = shownShells(p);
  setHtml("hatBal", '<span class="shellico"></span><b>' + bal + '</b> shell' + (bal === 1 ? '' : 's'));
  setHtml("hatGrid", items.map(it => {
    const owned = ownsCosmetic(p, it.id), on = worn === it.id, sel = ui.hatTry === it.id, h = hats[it.id];
    return '<button type="button" class="hat-card' + (sel ? ' on' : '') + (owned ? ' owned' : '') + (on ? ' worn' : '') + '" data-hat="' + it.id +
           '" title="' + esc(it.blurb) + '">' + (h ? hatSvgFrom(h, 56, 40, "hat-ico") : '') +
           '<span class="sn">' + esc(it.name) + '</span>' +
           '<span class="sp">' + (on ? 'wearing' : owned ? 'owned' : SHELL + it.price) +
           (HAT_MOTION[it.id] ? '<i class="moves" title="This one moves">&#10022;</i>' : '') + '</span></button>';
  }).join(""));
  const it = COSMETICS[ui.hatTry], owned = ownsCosmetic(p, it.id), on = worn === it.id, why = owned ? "" : cosmeticBlock(p, it.id);
  setHtml("hatAct", '<p class="style-name"><b>' + esc(it.name) + '</b> <span class="dim">' + esc(it.blurb) + '</span></p>' +
    (on ? '<button type="button" class="btn muted" data-do="off" data-item="' + it.id + '">Take it off</button>'
     : owned ? '<button type="button" class="btn primary" data-do="wear" data-item="' + it.id + '">Wear it</button>'
     : '<button type="button" class="btn primary" data-do="buy" data-item="' + it.id + '"' + (why ? ' disabled' : '') + '>Buy &middot; ' + SHELL + it.price + '</button>' +
       (why ? '<p class="hint">' + esc(why) + '</p>' : '')));
  if (!running) { running = true; requestAnimationFrame(drawCloseUp); }
}

async function act(what, id) {
  const p = owner && owner();
  if (!p || !hooks.guard()) return;
  const it = COSMETICS[id];
  if (!it) return;
  if (what === "buy" && !(await hooks.askConfirm("Buy the " + it.name + "?", it.price + " shells. " + it.blurb + " It is yours for good.", "Buy"))) return;
  await store.serial(async () => {
    const q = findParticipant(p.name) || p;          /* a refresh during the dialog replaced the person */
    const ok = what === "buy" ? await buyCosmetic(q, id) : await wearCosmetic(q, id, what === "wear");
    if (!ok) { setMsg(what === "buy" ? (cosmeticBlock(q, id) || "That didn't save.") : "That didn't save. Try again.", false); return; }
    if (what === "buy") setMsg(p.name + " bought the " + it.name + ".", true);
    await hooks.settle();
  });
  if (hooks.rerender) hooks.rerender();
}

/* ---- the close-up ----------------------------------------------------------------- */
/* The pet you wear (or the first one alive, or the duck), big, with its crown spot a
   little below the middle, so the hat sits in the middle of the picture. */
function drawCloseUp() {
  const cv = $("hatCv"), p = owner && owner();
  if (!cv || !p || ui.tab !== "shop" || document.hidden || $("hatShop").hidden) { running = false; return; }
  requestAnimationFrame(drawCloseUp);
  const w = cv.clientWidth || 240, h = cv.clientHeight || 230, dpr = Math.min(window.devicePixelRatio || 1, 3);
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const glow = ctx.createRadialGradient(w / 2, h * 0.5, 4, w / 2, h * 0.5, Math.max(w, h) * 0.55);
  glow.addColorStop(0, "rgba(255,255,255,0.35)"); glow.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);

  const alive = Object.keys(p.pets || {}).map(Number).filter(k => k >= 0 && k < C.PET_MAX), worn = store.petKindFor(p);
  const kind = alive.includes(worn) ? worn : alive.length ? alive[0] : 0;
  const hue = alive.includes(kind) ? hueOf(p, kind) : hashHue(p.name + kind);
  const def = ui.hatTry && hats[ui.hatTry] ? ui.hatTry : "";
  const r = Math.min(w, h) * 0.42, crown = petCrown(kind);
  drawCritter(ctx, w / 2 - crown[0] * r, h * 0.66 - crown[1] * r, r, 0, !!def, false, kind, hue, def || false, lookOf(p).finish);
}

/* The pet's crown spot, in r (the hat's origin). */
function petCrown(kind) { const d = defs[kind] || defs[0]; return (d && d.crown) || [0, -1]; }
