/* The Style shop, inside the Shop tab: a fitting room (a small glass showing your own
   pet with whatever you are looking at), tabs for each cosmetic slot plus Colour, and
   buy / wear / take-off. Data rules live in shop.js, drawing in cosmetics.js. */

import * as C from "./config.js";
import { S, findParticipant } from "./model.js";
import * as store from "./store.js";
import { SLOTS, COSMETICS, itemsIn, PAINT_COST, drawDecor, drawEffect, decorBehind, decorDry } from "./cosmetics.js";
import { CUP_H } from "./styleart.js";
import { defs, fxSpot, anchorY, zoneOf } from "./petdefs.js";
import { ownsCosmetic, cosmeticBlock, buyCosmetic, wearCosmetic, lookOf, paintBlock, paintPet, shellBalance, shellRun, shellAward, shellsEarned, pouredOn } from "./shop.js";
import { hueOf, petLabel } from "./pets.js";
import { drawCritter } from "./art.js";
import { $, esc, todayKey } from "./util.js";
import { setMsg, ui, setHtml } from "./ui.js";

let hooks = null, owner = null, running = false;
const TABS = [{ key: "colour", name: "Colour", note: "Recolour any pet you have alive. Each recolour costs " + PAINT_COST + " shell" + (PAINT_COST === 1 ? "" : "s") + "." }, ...SLOTS];
const SHELL = '<span class="shellico sm"></span>';

export function initStyle(h, getOwner) {
  hooks = h; owner = getOwner;
  if (!ui.styleTab) ui.styleTab = "finish";
  $("styleTabs").addEventListener("click", e => {
    const b = e.target.closest("[data-tab]");
    if (!b) return;
    ui.styleTab = b.dataset.tab; ui.styleTry = null;
    renderStyle();
  });
  $("styleItems").addEventListener("click", e => {
    const b = e.target.closest("[data-item]");
    if (!b) return;
    ui.styleTry = ui.styleTry === b.dataset.item ? null : b.dataset.item;
    renderStyle();
  });
  $("styleAct").addEventListener("click", e => {
    const b = e.target.closest("[data-do]");
    if (b) act(b.dataset.do, b.dataset.item);
  });
  $("styleAct").addEventListener("input", e => {
    if (e.target.id === "styleHue") { ui.styleHue = Number(e.target.value); $("styleHueVal").style.background = "hsl(" + ui.styleHue + ",62%,58%)"; }
    if (e.target.id === "stylePet") { ui.stylePet = Number(e.target.value); ui.styleHue = null; renderStyle(); }
  });
}

/* The pet being dressed: the worn one if alive, else the first alive. */
function petFor(p) {
  const worn = store.petKindFor(p), alive = Object.keys(p.pets || {}).map(Number).filter(k => k < C.PET_MAX);
  if (ui.styleTab === "colour" && alive.includes(ui.stylePet)) return ui.stylePet;
  return alive.includes(worn) ? worn : alive[0] ?? -1;
}

export function renderStyle() {
  const p = owner && owner();
  $("styleShop").hidden = !p;
  if (!p) return;
  const tab = TABS.find(t => t.key === ui.styleTab) || TABS[1], look = lookOf(p);
  /* the shell purse: balance, the run of days in a row, and what tomorrow brings */
  const run = shellRun(p), today = pouredOn(p), bal = shellBalance(p);
  setHtml("styleBal", '<span class="shellico"></span><b>' + bal + '</b> shell' + (bal === 1 ? '' : 's') +
    ' <span class="dim">&middot; ' + shellsEarned(p) + ' earned</span><span class="run" title="' + run + ' day' + (run === 1 ? '' : 's') + ' in a row">' +
    [1, 2, 3, 4, 5].map(i => '<i' + (i <= Math.min(run, C.SHELL_MAX) ? ' class="on"' : '') + '></i>').join("") + '</span>' +
    '<br><span class="dim">' + (today ? 'Poured today (+' + shellAward(run) + '). Pour tomorrow for +' + shellAward(run + 1) + '.'
                                      : 'Your first pour each day earns shells: +' + shellAward(run + 1) + ' today' +
                                        (run ? ' (' + (run + 1) + ' days in a row)' : '') + ', up to +' + C.SHELL_MAX + ' a day.') + '</span>');
  setHtml("styleTabs", TABS.map(t => {
    const n = t.key === "colour" ? 0 : itemsIn(t.key).filter(i => ownsCosmetic(p, i.id)).length;
    return '<button type="button" class="pen-tab' + (t.key === tab.key ? ' on' : '') + '" data-tab="' + t.key + '">' + esc(t.name) +
           (n ? ' <b>' + n + '</b>' : '') + '</button>';
  }).join(""));
  $("styleNote").textContent = tab.note;

  if (tab.key === "colour") {
    setHtml("styleItems", "");
    const alive = Object.keys(p.pets).map(Number).filter(x => x < C.PET_MAX && x !== C.MYSTERY_KIND).sort((a, b) => a - b);
    let k = petFor(p);
    if (!alive.includes(k)) k = alive.length ? alive[0] : -1;
    ui.stylePet = k;
    if (k < 0) { setHtml("styleAct", '<p class="hint">No pet alive to recolour yet.</p>'); startRoom(); return; }
    if (ui.styleHue === null || ui.styleHue === undefined || ui.stylePetShown !== k) { ui.styleHue = hueOf(p, k); ui.stylePetShown = k; }
    if (document.activeElement && document.activeElement.id === "styleHue") { startRoom(); return; }   /* mid-drag: leave the slider be */
    const why = paintBlock(p, k);
    setHtml("styleAct", '<label class="field-label" for="stylePet">Pet</label><select id="stylePet" class="txt">' +
      alive.map(x => '<option value="' + x + '"' + (x === k ? ' selected' : '') + '>' + esc(petLabel(x)) + '</option>').join("") + '</select>' +
      '<label class="field-label" for="styleHue">New colour</label>' +
      '<div class="style-hue"><input id="styleHue" type="range" min="0" max="359" value="' + Math.round(ui.styleHue) + '">' +
      '<span id="styleHueVal" class="style-swatch" style="background:hsl(' + Math.round(ui.styleHue) + ',62%,58%)"></span></div>' +
      '<button type="button" class="btn primary" data-do="paint"' + (why ? ' disabled' : '') + '>Recolour the ' + esc(petLabel(k)) +
      ' &middot; ' + SHELL + PAINT_COST + '</button>' + (why ? '<p class="hint">' + esc(why) + '</p>' : ''));
    startRoom();
    return;
  }

  const items = itemsIn(tab.key);
  setHtml("styleItems", items.map(it => {
    const owned = ownsCosmetic(p, it.id), worn = look[it.slot] === it.key, sel = ui.styleTry === it.id;
    return '<button type="button" class="style-item' + (sel ? ' on' : '') + (owned ? ' owned' : '') + (worn ? ' worn' : '') + '" data-item="' + it.id + '" title="' + esc(it.blurb) + '">' +
           '<span class="sn">' + esc(it.name) + '</span><span class="sp">' +
           (worn ? 'wearing' : owned ? 'owned' : SHELL + it.price) + '</span></button>';
  }).join(""));
  const it = COSMETICS[ui.styleTry];
  if (!it || it.slot !== tab.key) {
    const on = look[tab.key] && COSMETICS[tab.key + ":" + look[tab.key]];
    setHtml("styleAct", '<p class="hint">' + (on ? 'Wearing <b>' + esc(on.name) + '</b>. ' : '') + 'Pick one to try it on in the glass.</p>' +
      (on ? '<button type="button" class="btn muted" data-do="off" data-item="' + on.id + '">Take off ' + esc(on.name) + '</button>' : ''));
  } else {
    const owned = ownsCosmetic(p, it.id), worn = look[it.slot] === it.key, why = owned ? "" : cosmeticBlock(p, it.id);
    setHtml("styleAct", '<p class="style-name"><b>' + esc(it.name) + '</b> <span class="dim">' + esc(it.blurb) + '</span></p>' +
      (worn ? '<button type="button" class="btn muted" data-do="off" data-item="' + it.id + '">Take it off</button>'
       : owned ? '<button type="button" class="btn primary" data-do="wear" data-item="' + it.id + '">Wear it</button>'
       : '<button type="button" class="btn primary" data-do="buy" data-item="' + it.id + '"' + (why ? ' disabled' : '') + '>Buy &middot; ' + SHELL + it.price + '</button>' +
         (why ? '<p class="hint">' + esc(why) + '</p>' : '<p class="hint">Yours for good; it goes on straight away.</p>')));
  }
  startRoom();
}

async function act(what, id) {
  const p = owner && owner();
  if (!p || !hooks.guard()) return;
  const it = COSMETICS[id];
  if (what === "buy") {
    const ok = await hooks.askConfirm("Buy " + it.name + "?", it.price + " shells. " + it.blurb + " It is yours for good.", "Buy");
    if (!ok) return;
  }
  if (what === "paint") {
    const k = petFor(p);
    const ok = await hooks.askConfirm("Recolour the " + petLabel(k) + "?", PAINT_COST + " shell" + (PAINT_COST === 1 ? "" : "s") + ". You can recolour it again any time.", "Recolour");
    if (!ok) return;
  }
  await store.serial(async () => {
    const q = findParticipant(p.name) || p;          /* a refresh during the dialog replaced the person */
    let ok;
    if (what === "buy") ok = await buyCosmetic(q, id);
    else if (what === "wear") ok = await wearCosmetic(q, id, true);
    else if (what === "off") ok = await wearCosmetic(q, id, false);
    else if (what === "paint") ok = (await paintPet(q, petFor(q), ui.styleHue)) !== null;
    if (!ok) { setMsg("That didn't save. Try again.", false); return; }
    if (what === "buy") { setMsg(p.name + " bought " + it.name + ".", true); ui.styleTry = null; }
    if (what === "paint") setMsg(p.name + " recoloured the " + petLabel(petFor(p)) + ".", true);
    await hooks.settle();
  });
  if (hooks.rerender) hooks.rerender();
}

/* ---- the fitting room ------------------------------------------------------------ */
function startRoom() {
  if (running) return;
  running = true;
  requestAnimationFrame(drawRoom);
}

/* A glass with the page's own shape (inside CUP_H times as tall as wide, the pet sized
   as on a card), drawn in the page's layers: water, a cup item set behind the outline,
   the outline and shine, an item in front of it, then the pet and its effect. Below the
   surface the item and the pet take the water's tint, as on the page; a dry item does not. */
let layerCv = null;
function drawRoom() {
  const cv = $("styleCv"), p = owner && owner();
  if (!cv || !p || ui.tab !== "shop" || document.hidden || $("styleShop").hidden) { running = false; return; }
  requestAnimationFrame(drawRoom);
  const w = cv.clientWidth || 220, hgt = cv.clientHeight || 260, dpr = Math.min(window.devicePixelRatio || 1, 3);
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(hgt * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(hgt * dpr); }
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, hgt);

  /* what to show: your look, with the item being tried in its slot */
  const look = Object.assign({}, lookOf(p)), it = COSMETICS[ui.styleTry];
  if (it) look[it.slot] = it.key;
  const k = petFor(p), kind = k >= 0 ? k : 0;
  const hue = ui.styleTab === "colour" && ui.styleHue !== null && ui.styleHue !== undefined ? ui.styleHue : (k >= 0 ? hueOf(p, k) : 200);

  /* the glass: inside W x H, room above the rim for tall items */
  const t = performance.now() / 1000, pad = 10;
  const W = Math.round(Math.min(w * 0.5, (hgt - 2 * pad) / (CUP_H + 0.42))), H = Math.round(W * CUP_H);
  const gx = Math.round((w - W) / 2), gy = hgt - pad - H, gw = W + 8, rTop = gw * 0.106, rBot = gw * 0.212;
  const top = gy + H - 0.62 * (H - C.SURFACE_BAND), r = Math.min(W * C.PET_R_SHARE, C.PET_R_MAX);
  const wave = x => Math.sin(x * 0.05 + t * 1.6) * 2.2, cs = getComputedStyle(cv);
  const inside = c => { c.beginPath(); c.roundRect(gx, gy, W, H, [rTop - 3, rTop - 3, rBot - 4, rBot - 4]); };
  const water = c => {
    c.beginPath(); c.moveTo(gx, gy + H);
    for (let x = 0; x < W; x += 4) c.lineTo(gx + x, top + wave(x));
    c.lineTo(gx + W, top + wave(W));                                  /* the surface reaches the far wall */
    c.lineTo(gx + W, gy + H); c.closePath();
  };

  /* drawn on a layer of its own, then tinted below the surface and laid on */
  const lay = layerCv || (layerCv = document.createElement("canvas"));
  if (lay.width !== cv.width || lay.height !== cv.height) { lay.width = cv.width; lay.height = cv.height; }
  const L = lay.getContext("2d");
  const layer = (draw, tint) => {
    L.setTransform(1, 0, 0, 1, 0, 0); L.clearRect(0, 0, lay.width, lay.height); L.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(L);
    if (tint && C.UNDERWATER_TINT) {
      L.save(); L.globalCompositeOperation = "source-atop"; L.globalAlpha = C.UNDERWATER_TINT;
      inside(L); L.clip(); water(L); L.fillStyle = p.color; L.fill(); L.restore();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(lay, 0, 0); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  /* glass and water */
  ctx.save(); inside(ctx);
  ctx.fillStyle = cs.getPropertyValue("--glass-fill").trim() || "rgba(255,255,255,0.34)"; ctx.fill();
  ctx.clip(); water(ctx); ctx.fillStyle = p.color; ctx.fill();
  const g = ctx.createLinearGradient(0, top, 0, gy + H);
  g.addColorStop(0, "rgba(255,255,255,0.10)"); g.addColorStop(1, "rgba(0,20,40,0.16)");
  ctx.fillStyle = g; ctx.fill();
  water(ctx); ctx.strokeStyle = "rgba(255,255,255,0.55)"; ctx.lineWidth = 2.5; ctx.stroke();
  ctx.restore();

  const decor = look.decor, box = { x: gx, y: gy, W, H }, surf = x => top + wave(x - gx);
  const drawItem = () => layer(c => drawDecor(c, decor, box, surf, t), !decorDry(decor));
  if (decor && decorBehind(decor)) drawItem();
  /* the outline and its shine, as .glass-edge */
  ctx.strokeStyle = cs.getPropertyValue("--glass-edge").trim() || "rgba(126,191,229,0.8)"; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.roundRect(gx - 2, gy - 1.5, W + 4, H + 3.5, [rTop - 1.5, rTop - 1.5, rBot - 2, rBot - 2]); ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.beginPath(); ctx.roundRect(gx + 8, gy + 7, 9, Math.max(0, H - 33), 4.5); ctx.fill();
  if (decor && !decorBehind(decor)) drawItem();

  /* the pet swims slowly across and back at its own depth, hopping now and then; below
     the rim it shows only inside the glass, as on the page */
  const sway = Math.sin(t * 0.9), face = Math.cos(t * 0.9) >= 0 ? -1 : 1, z = zoneOf(defs[kind]);
  const px = gx + W / 2 + sway * W * 0.24, hopU = (t % 3.2) / 0.7, hop = hopU < 1 && z === "surface" ? Math.sin(Math.PI * hopU) * r * 0.6 : 0;
  const bob = z === "middle" ? Math.sin(t * 1.3) * r * 0.12 : z === "air" ? Math.sin(t * 2 * Math.PI * C.AIR_BOB_HZ) * r * C.AIR_BOB_R : Math.sin(t * 2.1) * r * 0.035;
  const py = anchorY(defs[kind], r, top + wave(px - gx), gy + H - C.FLOOR_GAP) - hop + bob;
  const spot = fxSpot(defs[kind]), fx = px + spot[0] * r * face, fy = py + spot[1] * r;
  layer(c => {
    c.save(); c.beginPath(); c.rect(0, 0, w, gy); c.rect(gx, gy, W, H); c.clip();
    if (look.effect) drawEffect(c, look.effect, fx, fy, r, t, hue, "back");
    c.save(); c.translate(px, py); c.scale(face, 1);
    drawCritter(c, 0, 0, r, 0, false, false, kind, hue, false, look.finish);
    c.restore();
    if (look.effect) drawEffect(c, look.effect, fx, fy, r, t, hue, "front");
    c.restore();
  }, true);
}
