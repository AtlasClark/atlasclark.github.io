/* Radial pour menu. Opened by right-clicking (or long-pressing) a glass: the preset
   sizes sit on a ring, a custom amount in the middle. Picking closes it straight away,
   so the pour plays in full view. */

import * as C from "./config.js";
import { $, fmt } from "./util.js";

const RING = 86;               /* px from the centre to each preset */
let open = null;               /* { name, onPick } while showing */

export const radialOpen = () => !!open;

/* o: { name, color, total, goal, amount, x, y } in viewport px */
export function openRadial(o, onPick) {
  const el = $("radial"), pad = RING + 40;
  el.style.left = Math.max(pad, Math.min(window.innerWidth - pad, o.x)) + "px";
  el.style.top = Math.max(pad, Math.min(window.innerHeight - pad, o.y)) + "px";
  el.style.setProperty("--pc", o.color);
  const n = C.QUICK_SIZES.length;
  $("radRing").innerHTML = C.QUICK_SIZES.map((oz, i) => {
    const a = -Math.PI / 2 + i * 2 * Math.PI / n;
    const x = (Math.cos(a) * RING).toFixed(1), y = (Math.sin(a) * RING).toFixed(1);
    return '<button type="button" class="rad-item' + (oz === o.amount ? " last" : "") + '" data-oz="' + oz + '"' +
           ' style="left:' + x + 'px;top:' + y + 'px;--x:' + x + 'px;--y:' + y + 'px;--i:' + i + '"' +
           ' aria-label="Add ' + fmt(oz) + ' fl oz">' + fmt(oz) + '</button>';
  }).join("");
  $("radWho").textContent = o.name;
  $("radTotal").textContent = fmt(o.total) + " / " + fmt(o.goal) + " today";
  $("radAmt").value = fmt(o.amount);
  $("radAmt").classList.remove("bad");
  el.classList.remove("closing");
  el.hidden = false;
  open = { name: o.name, onPick };
  requestAnimationFrame(() => { $("radAmt").focus(); $("radAmt").select(); });
}

export function closeRadial() {
  if (!open) return;
  open = null;
  const el = $("radial");
  el.classList.add("closing");
  setTimeout(() => { if (!open) el.hidden = true; }, 140);
}

function pick(oz) {
  if (!open) return;
  const o = open;
  closeRadial();
  o.onPick(o.name, oz);
}

export function wireRadial() {
  $("radRing").addEventListener("click", e => {
    const b = e.target.closest(".rad-item");
    if (b) pick(Number(b.dataset.oz));
  });
  $("radCore").addEventListener("submit", e => {
    e.preventDefault();
    const v = Number($("radAmt").value);
    if (!isFinite(v) || v <= 0 || v > 999) { $("radAmt").classList.add("bad"); $("radAmt").select(); return; }
    pick(v);
  });
  $("radAmt").addEventListener("input", () => $("radAmt").classList.remove("bad"));
  /* Anything outside closes it; a right-click on another glass then reopens it there. */
  document.addEventListener("pointerdown", e => { if (open && !e.target.closest("#radial")) closeRadial(); }, true);
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeRadial(); });
  window.addEventListener("scroll", closeRadial, { passive: true });
  window.addEventListener("resize", closeRadial);
  $("radial").addEventListener("contextmenu", e => e.preventDefault());
}
