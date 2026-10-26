/* The Style shop, inside the Shop tab: a fitting room (a small glass showing your own
   pet with whatever you are looking at), tabs for each cosmetic slot plus Colour, and
   buy / wear / take-off. Data rules live in shop.js, drawing in cosmetics.js. */

import * as C from "./config.js";
import { S, findParticipant } from "./model.js";
import * as store from "./store.js";
import { SLOTS, COSMETICS, itemsIn, PAINT_COST, drawDecor, drawEffect } from "./cosmetics.js";
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

function drawRoom() {
  const cv = $("styleCv"), p = owner && owner();
  if (!cv || !p || ui.tab !== "shop" || document.hidden || $("styleShop").hidden) { running = false; return; }
  requestAnimationFrame(drawRoom);
  const w = cv.clientWidth || 220, hgt = cv.clientHeight || 260, dpr = Math.min(window.devicePixelRatio || 1, 3);
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(hgt * dpr); }
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, hgt);

  /* what to show: your look, with the item being tried in its slot */
  const look = Object.assign({}, lookOf(p)), it = COSMETICS[ui.styleTry];
  if (it) look[it.slot] = it.key;
  const k = petFor(p), kind = k >= 0 ? k : 0;
  const hue = ui.styleTab === "colour" && ui.styleHue !== null && ui.styleHue !== undefined ? ui.styleHue : (k >= 0 ? hueOf(p, k) : 200);

  const t = performance.now() / 1000, gx = w * 0.14, gy = hgt * 0.22, W = w * 0.72, H = hgt * 0.72;
  const level = 0.62, top = gy + H * (1 - level), r = Math.min(W * 0.3, 44);
  const wave = x => Math.sin(x * 0.05 + t * 1.6) * 2.2;
  ctx.fillStyle = "rgba(255,255,255,0.06)"; ctx.strokeStyle = "rgba(160,200,230,0.8)"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect(gx, gy, W, H, [8, 8, 22, 22]); ctx.fill();
  ctx.save(); ctx.beginPath(); ctx.roundRect(gx, gy, W, H, [8, 8, 22, 22]); ctx.clip();
  ctx.beginPath(); ctx.moveTo(gx, gy + H);
  for (let x = 0; x < W; x += 4) ctx.lineTo(gx + x, top + wave(x));
  ctx.lineTo(gx + W, top + wave(W));                                  /* the surface reaches the far wall */
  ctx.lineTo(gx + W, gy + H); ctx.closePath();
  ctx.fillStyle = p.color; ctx.globalAlpha = 0.85; ctx.fill(); ctx.globalAlpha = 1;
  ctx.restore();

  if (look.decor) drawDecor(ctx, look.decor, { x: gx, y: gy, W, H }, x => top + wave(x - gx), t);
  /* the pet swims slowly across and back at its own depth, hopping now and then */
  const sway = Math.sin(t * 0.9), face = Math.cos(t * 0.9) >= 0 ? -1 : 1, z = zoneOf(defs[kind]);
  const px = gx + W / 2 + sway * W * 0.24, hopU = (t % 3.2) / 0.7, hop = hopU < 1 && z !== "middle" ? Math.sin(Math.PI * hopU) * r * (z === "bottom" ? 0.35 : 0.6) : 0;
  const py = anchorY(defs[kind], r, top + wave(px - gx), gy + H - 4) - hop + Math.sin(t * (z === "middle" ? 1.3 : 2.1)) * r * (z === "middle" ? 0.12 : 0.035);
  const spot = fxSpot(defs[kind]), fx = px + spot[0] * r * face, fy = py + spot[1] * r;
  if (look.effect) drawEffect(ctx, look.effect, fx, fy, r, t, hue, "back");
  ctx.save(); ctx.translate(px, py); ctx.scale(face, 1);
  drawCritter(ctx, 0, 0, r, 0, false, false, kind, hue, false, look.finish);
  ctx.restore();
  if (look.effect) drawEffect(ctx, look.effect, fx, fy, r, t, hue, "front");

  /* below the surface takes the water's colour, as in the real glass */
  ctx.save(); ctx.beginPath(); ctx.roundRect(gx, gy, W, H, [8, 8, 22, 22]); ctx.clip();
  ctx.beginPath(); ctx.moveTo(gx, gy + H);
  for (let x = 0; x < W; x += 4) ctx.lineTo(gx + x, top + wave(x));
  ctx.lineTo(gx + W, top + wave(W));                                  /* the surface reaches the far wall */
  ctx.lineTo(gx + W, gy + H); ctx.closePath();
  ctx.fillStyle = p.color; ctx.globalAlpha = 0.28; ctx.fill();
  ctx.restore();
  ctx.strokeStyle = "rgba(160,200,230,0.8)"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect(gx, gy, W, H, [8, 8, 22, 22]); ctx.stroke();
}
