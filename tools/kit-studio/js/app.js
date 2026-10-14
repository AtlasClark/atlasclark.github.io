/*
  Kit Studio — page controller
  Scope: kit table (BOM group rows + line rows), in-cell editing, selection,
  bulk actions, per-BOM build settings, parts list (CSV) import with column
  mapping, .kitproj load/save, PDF export, theme, drag-and-drop, shortcuts.
  The working kit and the parts list autosave to this browser's IndexedDB.
*/
(function () {
  "use strict";
  const KS = window.KS;
  const REV = "rev 3.0.0";
  const LS_UI = "kitStudio.ui";
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtG = n => String(+(+n).toPrecision(6));
  const plural = (n, w) => n + " " + w + (n !== 1 ? "s" : "");

  // ---------- state ----------
  let boms = [];
  const shut = new WeakSet();          // collapsed BOMs
  let sel = new Set();                 // selected BOM / line objects
  let anchor = null;                   // shift-click range start
  let editing = null;                  // { input, bom, line, k }
  let parts = null;                    // { name, importedAt, headers, records }
  let partsIdx = new Map();
  let storageOk = true;

  const ui = { theme: "dark", bo: "", qty: 1, attr: 5, partsCols: null };
  try { Object.assign(ui, JSON.parse(localStorage.getItem(LS_UI) || "{}")); } catch (e) { /* defaults */ }
  const saveUi = () => { try { localStorage.setItem(LS_UI, JSON.stringify(ui)); } catch (e) { /* view prefs only */ } };

  // ---------- IndexedDB (kit autosave + parts list) ----------
  const idb = (() => {
    let dbp = null;
    const open = () => dbp || (dbp = new Promise((res, rej) => {
      const r = indexedDB.open("kit-studio", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }));
    const run = async (mode, fn) => {
      const db = await open();
      return new Promise((res, rej) => {
        const tx = db.transaction("kv", mode), q = fn(tx.objectStore("kv"));
        tx.oncomplete = () => res(q.result); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error);
      });
    };
    return {
      get: k => run("readonly", s => s.get(k)),
      set: (k, v) => run("readwrite", s => s.put(v, k)),
      del: k => run("readwrite", s => s.delete(k))
    };
  })();

  let saveTimer = 0;
  function changed() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        await idb.set("kit", KS.toSession(boms, defaults()));
        storageOk = true;
        $("saveStat").textContent = "Kit kept in this browser · " + new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      } catch (e) {
        storageOk = false;
        $("saveStat").textContent = "Browser storage unavailable — save a session file";
      }
    }, 400);
  }

  // ---------- defaults (toolbar) ----------
  function defaults() {
    const q = Math.trunc(+$("defQty").value), a = +$("defAttr").value;
    return {
      bo: $("defBo").value.trim(),
      qty: Math.min(100000, Math.max(1, isFinite(q) && q ? q : 1)),
      attr: Math.min(100, Math.max(0, isFinite(a) ? a : 5))
    };
  }
  function setDefaults(d) { $("defBo").value = d.bo || ""; $("defQty").value = d.qty || 1; $("defAttr").value = d.attr != null ? d.attr : 5; }
  for (const id of ["defBo", "defQty", "defAttr"]) $(id).addEventListener("change", () => {
    const d = defaults(); setDefaults(d); Object.assign(ui, d); saveUi();
  });

  // ---------- table ----------
  const COLS = [
    { k: "chk", h: "", c: "c-chk" },
    { k: "item", h: "Item", c: "c-item", ed: 1 },
    { k: "atlas_pn", h: "Atlas PN", c: "c-atlas", ed: 1 },
    { k: "mpn", h: "Mfger PN", c: "c-mpn", ed: 1 },
    { k: "mfr", h: "Manufacturer", c: "c-mfr", ed: 1 },
    { k: "desc", h: "Description", c: "c-desc", ed: 1 },
    { k: "refdes", h: "RefDes", c: "c-ref", ed: 1 },
    { k: "qty_per", h: "Qty/Brd", c: "c-qty", ed: 1 },
    { k: "req", h: "Required", c: "c-req", ed: 1 },
    { k: "on_hand", h: "On Hand", c: "c-oh", ed: 1 },
    { k: "short", h: "Short", c: "c-short" },
    { k: "sub", h: "Substitution", c: "c-sub", ed: 1 }
  ];

  const filterText = () => $("filter").value.trim().toLowerCase();
  const matches = (l, q) => !q || [l.atlas_pn, l.mpn, l.mfr, l.desc, l.refdes, l.sub].join(" ").toLowerCase().includes(q);

  function lineHtml(b, l, bi, li, q) {
    const req = KS.required(l, b.build_qty, b.attrition), sh = KS.shortage(l, b.build_qty, b.attrition);
    const ov = String(l.req_override).trim() !== "";
    const cls = ["line", l.enabled ? "" : "off", l.is_pcb ? "pcb" : "", sel.has(l) ? "sel" : "",
      shut.has(b) || !matches(l, q) ? "hide" : ""].filter(Boolean).join(" ");
    const cell = (k, text, extra) => {
      const c = COLS.find(x => x.k === k);
      return '<td class="' + c.c + (c.ed ? " ed" : "") + (extra ? " " + extra : "") + '" data-k="' + k + '" title="' + esc(text) + '">' + esc(text) + "</td>";
    };
    let ohCls = "";
    if (l.enabled && sh > 0) ohCls = "oh-short"; else if (l.enabled && String(l.on_hand).trim()) ohCls = "oh-ok";
    return '<tr class="' + cls + '" data-b="' + bi + '" data-l="' + li + '">' +
      '<td class="c-chk"><input type="checkbox" data-act="chk"' + (l.enabled ? " checked" : "") + ' aria-label="Include line"></td>' +
      cell("item", l.item) + cell("atlas_pn", l.atlas_pn) + cell("mpn", l.mpn) + cell("mfr", l.mfr) +
      cell("desc", l.desc) + cell("refdes", l.refdes) + cell("qty_per", l.qty_per ? fmtG(l.qty_per) : "") +
      cell("req", req ? (ov ? req + " *" : String(req)) : "", l.enabled && req ? (ov ? "req-ov" : "req-auto") : "") +
      cell("on_hand", l.on_hand, ohCls) +
      cell("short", sh ? String(sh) : "", sh > 0 && l.enabled ? "short" : "") +
      cell("sub", l.sub) + "</tr>";
  }

  function bomHtml(b, bi, q) {
    const n = b.lines.length, en = b.lines.filter(l => l.enabled).length;
    const shorts = b.lines.filter(l => l.enabled && KS.shortage(l, b.build_qty, b.attrition) > 0).length;
    const hide = q && !b.lines.some(l => matches(l, q));
    return '<tr class="bom' + (shut.has(b) ? " shut" : "") + (sel.has(b) ? " sel" : "") + (hide ? " hide" : "") + '" data-b="' + bi + '">' +
      '<td class="c-chk"><input type="checkbox" data-act="bomchk"' + (en === n && n ? " checked" : "") + (en && en < n ? " data-ind" : "") + ' aria-label="Include all lines of this BOM"></td>' +
      '<td colspan="11"><div class="bom-head">' +
      '<button class="caret" data-act="caret" aria-label="Show or hide lines">▶</button>' +
      '<span class="bom-name">' + esc(KS.displayName(b)) + "</span>" +
      '<button class="chipx' + (b.build_order ? "" : " warn") + '" data-act="settings" title="Build settings">B/O ' + esc(b.build_order || "—") + "</button>" +
      '<button class="chipx" data-act="settings" title="Build settings">Qty ' + b.build_qty + " · Attr " + fmtG(b.attrition) + "%</button>" +
      '<span class="bom-desc" title="' + esc(b.assembly_desc || b.source_file) + '">' + esc(b.assembly_desc || b.source_file) + "</span>" +
      (shorts ? '<span class="chipx bad">⚠ ' + shorts + " short</span>" : "") +
      '<span class="bom-count">' + en + "/" + n + " lines</span>" +
      '<button class="icon-btn" data-act="settings" title="Build settings (double-click the row)">⚙</button>' +
      '<button class="icon-btn" data-act="remove" title="Remove this BOM from the kit">✕</button>' +
      "</div></td></tr>";
  }

  const EMPTY = '<div class="empty-state"><div class="big">⬡</div>' +
    "<b>No BOMs in the kit.</b><br>Add one or more Standard BOM Template exports (.xlsx), or drop them here.<br>" +
    "Open a saved .kitproj session to continue a kit.<br>Import a parts list (.csv) to fill blank PNs, manufacturers and descriptions." +
    '<br><button class="btn btn-primary" data-act="add">＋ Add BOMs</button></div>';

  function render() {
    editing = null;
    const wrap = $("gridWrap"), q = filterText();
    if (!boms.length) { wrap.innerHTML = EMPTY; stats(); return; }
    let h = '<table class="kit"><thead><tr>' + COLS.map(c => '<th class="' + c.c + '">' + c.h + "</th>").join("") + "</tr></thead><tbody>";
    boms.forEach((b, bi) => { h += bomHtml(b, bi, q); b.lines.forEach((l, li) => { h += lineHtml(b, l, bi, li, q); }); });
    const top = wrap.scrollTop, left = wrap.scrollLeft;
    wrap.innerHTML = h + "</tbody></table>";
    wrap.scrollTop = top; wrap.scrollLeft = left;
    wrap.querySelectorAll("[data-ind]").forEach(x => { x.indeterminate = true; });
    stats();
  }

  const rowEl = (bi, li) => $("gridWrap").querySelector(li == null ? 'tr.bom[data-b="' + bi + '"]' : 'tr.line[data-b="' + bi + '"][data-l="' + li + '"]');

  function swap(tr, html) {
    const t = document.createElement("tbody"); t.innerHTML = html;
    const n = t.firstElementChild; tr.replaceWith(n);
    n.querySelectorAll("[data-ind]").forEach(x => { x.indeterminate = true; });
    return n;
  }
  function refreshLine(bi, li) {
    const q = filterText(), tr = rowEl(bi, li), btr = rowEl(bi);
    if (tr) swap(tr, lineHtml(boms[bi], boms[bi].lines[li], bi, li, q));
    if (btr) swap(btr, bomHtml(boms[bi], bi, q));
    stats();
  }

  function stats() {
    let n = 0, en = 0, sh = 0;
    for (const b of boms) for (const l of b.lines) {
      n++;
      if (l.enabled) { en++; if (KS.shortage(l, b.build_qty, b.attrition) > 0) sh++; }
    }
    const pages = Math.ceil(en / 10);
    $("stats").textContent = plural(boms.length, "BOM") + "   ·   " + en + "/" + n + " lines enabled   ·   " + plural(pages, "label sheet");
    $("shortStat").textContent = sh ? "⚠ " + sh + " SHORTAGE" + (sh !== 1 ? "S" : "") : "";
  }

  // ---------- selection ----------
  function objOf(tr) {
    const b = boms[+tr.dataset.b];
    return tr.classList.contains("bom") ? b : b.lines[+tr.dataset.l];
  }
  function paintSel() {
    $("gridWrap").querySelectorAll("tr.bom, tr.line").forEach(tr => tr.classList.toggle("sel", sel.has(objOf(tr))));
  }
  function clickSelect(tr, e) {
    const o = objOf(tr);
    if (e.shiftKey && anchor) {
      const rows = [...$("gridWrap").querySelectorAll("tr.bom:not(.hide), tr.line:not(.hide)")];
      const a = rows.findIndex(r => objOf(r) === anchor), z = rows.indexOf(tr);
      if (a >= 0 && z >= 0) {
        if (!(e.ctrlKey || e.metaKey)) sel = new Set();
        for (let i = Math.min(a, z); i <= Math.max(a, z); i++) sel.add(objOf(rows[i]));
      }
    } else if (e.ctrlKey || e.metaKey) {
      if (sel.has(o)) sel.delete(o); else sel.add(o);
      anchor = o;
    } else { sel = new Set([o]); anchor = o; }
    paintSel();
  }

  // ---------- in-cell editing ----------
  function startEdit(td) {
    if (editing) commitEdit(false);
    const tr = td.closest("tr.line"); if (!tr) return;
    const bi = +tr.dataset.b, li = +tr.dataset.l, bom = boms[bi], line = bom.lines[li], k = td.dataset.k;
    let val;
    if (k === "req") { const r = KS.required(line, bom.build_qty, bom.attrition); val = r ? String(r) : ""; }
    else if (k === "qty_per") val = line.qty_per ? fmtG(line.qty_per) : "";
    else val = line[k];
    td.textContent = "";
    const input = document.createElement("input");
    input.className = "cell-ed"; input.spellcheck = false; input.value = val;
    td.appendChild(input);
    editing = { input, bom, line, k };
    input.focus(); input.select();
    input.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); moveEdit(e.shiftKey ? "up" : "down"); }
      else if (e.key === "Tab") { e.preventDefault(); moveEdit(e.shiftKey ? "left" : "right"); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); commitEdit(true); $("gridWrap").focus(); }
    });
    input.addEventListener("blur", () => { if (editing && editing.input === input) commitEdit(false); });
  }

  // Desktop-app rules: REQ edits become a manual override (typing the
  // calculated value or clearing it returns to auto); On Hand takes a
  // non-negative number or blank; bad input keeps the old value.
  function applyEdit(bom, line, k, raw) {
    const txt = String(raw).trim();
    if (k === "qty_per") { if (!txt) line.qty_per = 0; else { const n = KS.num(txt); if (!isNaN(n)) line.qty_per = n; } }
    else if (k === "req") {
      if (!txt) line.req_override = "";
      else if (KS.isQty(txt)) line.req_override = Math.trunc(+txt) === KS.autoRequired(line, bom.build_qty, bom.attrition) ? "" : txt;
    }
    else if (k === "on_hand") { if (!txt || KS.isQty(txt)) line.on_hand = txt; }
    else line[k] = txt;
  }

  function commitEdit(cancel) {
    const e = editing; if (!e) return null;
    editing = null;
    const bi = boms.indexOf(e.bom), li = e.bom.lines.indexOf(e.line);
    if (!cancel && e.input.value !== undefined) applyEdit(e.bom, e.line, e.k, e.input.value);
    if (bi >= 0 && li >= 0) refreshLine(bi, li);
    if (!cancel) changed();
    return { bi, li, k: e.k };
  }

  function moveEdit(dir) {
    const at = commitEdit(false); if (!at || at.bi < 0) return;
    const tr = rowEl(at.bi, at.li); if (!tr) return;
    const eds = COLS.filter(c => c.ed).map(c => c.k);
    let target = null;
    if (dir === "up" || dir === "down") {
      const rows = [...$("gridWrap").querySelectorAll("tr.line:not(.hide)")];
      const nxt = rows[rows.indexOf(tr) + (dir === "down" ? 1 : -1)];
      if (nxt) target = nxt.querySelector('td[data-k="' + at.k + '"]');
    } else {
      const i = eds.indexOf(at.k) + (dir === "right" ? 1 : -1);
      if (i >= 0 && i < eds.length) target = tr.querySelector('td[data-k="' + eds[i] + '"]');
    }
    if (target) { target.scrollIntoView({ block: "nearest" }); startEdit(target); } else $("gridWrap").focus();
  }

  // ---------- grid events ----------
  const grid = $("gridWrap");
  grid.addEventListener("click", e => {
    const act = e.target.closest("[data-act]");
    if (act && act.dataset.act === "add") return $("bomFile").click();
    const tr = e.target.closest("tr.bom, tr.line"); if (!tr) return;
    const bi = +tr.dataset.b, b = boms[bi];
    if (act) {
      const a = act.dataset.act;
      if (a === "chk") { b.lines[+tr.dataset.l].enabled = act.checked; refreshLine(bi, +tr.dataset.l); changed(); }
      else if (a === "bomchk") { const on = !b.lines.every(l => l.enabled); b.lines.forEach(l => { l.enabled = on; }); render(); changed(); }
      else if (a === "caret") { if (shut.has(b)) shut.delete(b); else shut.add(b); render(); }
      else if (a === "settings") bomSettings(b);
      else if (a === "remove") removeBoms([b]);
      return;
    }
    if (e.target.closest("input")) return;
    clickSelect(tr, e);
  });
  grid.addEventListener("dblclick", e => {
    if (e.target.closest("input, button")) return;
    const td = e.target.closest("td.ed");
    if (td) return startEdit(td);
    const tr = e.target.closest("tr.bom");
    if (tr) bomSettings(boms[+tr.dataset.b]);
  });
  grid.addEventListener("keydown", e => {
    if (editing || e.target.closest("input")) return;
    if (e.key === " ") { e.preventDefault(); toggleSelected(); }
    else if (e.key === "Delete") { e.preventDefault(); removeBoms(boms.filter(b => sel.has(b))); }
  });

  function toggleSelected() {
    let n = 0;
    for (const b of boms) for (const l of b.lines) if (sel.has(l)) { l.enabled = !l.enabled; n++; }
    if (n) { render(); changed(); }
  }

  // ---------- modal / toast ----------
  let modalClose = null;
  function openModal(title, bodyHtml, buttons, wide) {
    $("modalTitle").textContent = title;
    $("modalBody").innerHTML = bodyHtml;
    const foot = $("modalFoot"); foot.innerHTML = "";
    for (const bt of buttons) {
      if (bt === "|") { const s = document.createElement("span"); s.className = "spacer"; foot.appendChild(s); continue; }
      const el = document.createElement("button");
      el.className = "btn " + (bt.cls || ""); el.textContent = bt.label;
      if (bt.id) el.id = bt.id;
      el.addEventListener("click", bt.onClick);
      foot.appendChild(el);
    }
    $("modal").classList.toggle("wide", !!wide);
    $("overlay").classList.add("open");
    const first = $("modalBody").querySelector("input, select") || foot.querySelector(".btn-primary");
    if (first) setTimeout(() => first.focus(), 30);
  }
  function closeModal() {
    $("overlay").classList.remove("open");
    const f = modalClose; modalClose = null; if (f) f();
  }
  $("modalX").addEventListener("click", closeModal);

  function ask(title, html, okLabel, danger) {
    return new Promise(res => {
      let done = false;
      const finish = v => { if (done) return; done = true; modalClose = null; closeModal(); res(v); };
      openModal(title, html, [
        { label: "Cancel", onClick: () => finish(false) },
        { label: okLabel || "OK", cls: danger ? "btn-danger" : "btn-primary", onClick: () => finish(true) }
      ]);
      modalClose = () => finish(false);
    });
  }
  const info = (title, html) => openModal(title, html, [{ label: "OK", cls: "btn-primary", onClick: closeModal }]);

  function toast(msg, kind) {
    const t = document.createElement("div");
    t.className = "toast" + (kind ? " " + kind : ""); t.textContent = msg;
    $("toasts").appendChild(t);
    setTimeout(() => t.remove(), kind === "err" ? 7000 : 4000);
  }

  // ---------- BOM add / settings / remove ----------
  async function addBomFiles(files) {
    const d = defaults(), errors = [];
    let added = 0, filled = 0;
    for (const f of files) {
      try {
        const bom = KS.parseBom(await KS.readActiveSheet(await f.arrayBuffer()), f.name);
        Object.assign(bom, { build_order: d.bo, build_qty: d.qty, attrition: d.attr });
        filled += KS.enrichBom(bom, partsIdx);
        boms.push(bom); added++;
      } catch (e) { errors.push([f.name, e.message || String(e)]); }
    }
    if (added) { render(); changed(); toast("Added " + plural(added, "BOM") + (filled ? " · parts list filled " + plural(filled, "line") : "")); }
    if (errors.length) info("Some BOMs failed", "<ul>" + errors.map(([n, m]) => "<li><b>" + esc(n) + "</b>: " + esc(m) + "</li>").join("") + "</ul>");
  }

  function bomSettings(b) {
    openModal("Build settings — " + KS.displayName(b),
      (b.assembly_desc ? "<p>" + esc(b.assembly_desc) + "</p>" : "") +
      '<div class="field"><label for="bsBo">Build order #</label><input id="bsBo" placeholder="BO-XXXXX" autocomplete="off" spellcheck="false" value="' + esc(b.build_order) + '"></div>' +
      '<div class="field-row"><div class="field"><label for="bsQty">Build quantity</label><input id="bsQty" type="number" min="1" max="100000" step="1" value="' + b.build_qty + '"></div>' +
      '<div class="field"><label for="bsAttr">Attrition %</label><input id="bsAttr" type="number" min="0" max="100" step="0.5" value="' + fmtG(b.attrition) + '"></div></div>',
      [{ label: "Cancel", onClick: closeModal }, { label: "Save", cls: "btn-primary", onClick: save }]);
    const onEnter = e => { if (e.key === "Enter") save(); };
    ["bsBo", "bsQty", "bsAttr"].forEach(id => $(id).addEventListener("keydown", onEnter));
    function save() {
      const q = Math.trunc(+$("bsQty").value), a = +$("bsAttr").value;
      b.build_order = $("bsBo").value.trim();
      b.build_qty = Math.min(100000, Math.max(1, isFinite(q) && q ? q : 1));
      b.attrition = Math.min(100, Math.max(0, isFinite(a) ? a : b.attrition));
      closeModal(); render(); changed();
    }
  }

  async function removeBoms(list) {
    if (!list.length) return;
    if (!await ask("Remove BOM", "<p>Remove from the kit:</p><ul>" + list.map(b => "<li>" + esc(KS.displayName(b)) + "</li>").join("") + "</ul>", "Remove", true)) return;
    boms = boms.filter(b => !list.includes(b));
    sel = new Set([...sel].filter(o => boms.includes(o) || boms.some(b => b.lines.includes(o))));
    render(); changed();
  }

  // ---------- bulk actions ----------
  function setAll(on) { for (const b of boms) for (const l of b.lines) l.enabled = on; render(); changed(); }

  async function fillOnHand() {
    if (!boms.length) return;
    if (!await ask("Fill On-Hand", "<p>Set On Hand = Required for every enabled line?</p>", "Fill")) return;
    for (const b of boms) for (const l of b.lines) if (l.enabled) l.on_hand = String(KS.required(l, b.build_qty, b.attrition));
    render(); changed();
  }

  async function disableUnshipped() {
    const cand = [];
    for (const b of boms) for (const l of b.lines) {
      if (!l.enabled) continue;
      const n = KS.num(l.on_hand);
      if (!(n > 0)) cand.push(l);
    }
    if (!cand.length) return toast("All enabled lines have shippable quantity — nothing to disable.");
    if (!await ask("Disable Not-Shipping", "<p>Disable " + plural(cand.length, "line") + " with blank or zero On Hand?</p><p>They will be left out of the label PDF and the shortage counts.</p>", "Disable")) return;
    cand.forEach(l => { l.enabled = false; });
    render(); changed();
    toast("Disabled " + plural(cand.length, "not-shipping line") + ".");
  }

  async function applyAll() {
    if (!boms.length) return;
    const d = defaults();
    if (!await ask("Apply to All", "<p>Set B/O <b>" + esc(d.bo || "—") + "</b>, Qty <b>" + d.qty + "</b>, Attr <b>" + fmtG(d.attr) + "%</b> on all " + plural(boms.length, "BOM") + "?</p>", "Apply")) return;
    for (const b of boms) Object.assign(b, { build_order: d.bo, build_qty: d.qty, attrition: d.attr });
    render(); changed();
  }

  async function newKit() {
    if (boms.length && !await ask("New Kit", "<p>Clear all " + plural(boms.length, "BOM") + " from the kit? Save a session first if you need this kit again.</p>", "Clear kit", true)) return;
    boms = []; sel = new Set(); anchor = null;
    render(); changed();
  }

  // ---------- files ----------
  function download(name, data, type) {
    const blob = data instanceof Blob ? data : new Blob([data], { type });
    const url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  function saveSession() {
    if (!boms.length) return info("Nothing to save", "<p>Add BOMs first.</p>");
    const bos = [...new Set(boms.filter(b => b.build_order).map(b => b.build_order))].sort();
    const tag = String(bos.length === 1 ? bos[0] : bos.length ? "multi" : "session").replace(/[\\/:*?"<>|\s]+/g, "-");
    download("kit_" + tag + ".kitproj", JSON.stringify(KS.toSession(boms, defaults()), null, 1), "application/json");
  }

  async function loadSession(file) {
    let res;
    try { res = KS.fromSession(JSON.parse(await file.text())); }
    catch (e) { return info("Load failed", "<p>Could not load session:</p><ul><li>" + esc(e.message || e) + "</li></ul>"); }
    if (boms.length && !await ask("Load Session", "<p>Replace the current kit (" + plural(boms.length, "BOM") + ") with <b>" + esc(file.name) + "</b>?</p>", "Replace")) return;
    boms = res.boms; sel = new Set(); anchor = null;
    setDefaults(res.defaults); Object.assign(ui, defaults()); saveUi();
    render(); changed();
    toast("Loaded " + file.name);
  }

  async function makePdf(kind) {
    const enabled = boms.some(b => b.lines.some(l => l.enabled));
    if (!enabled) return info("Nothing enabled", "<p>No enabled lines — nothing to " + (kind === "kit" ? "print" : "list") + ".</p>");
    if (kind === "kit") {
      const missing = boms.filter(b => !b.build_order && b.lines.some(l => l.enabled));
      if (missing.length && !await ask("Missing Build Order", "<p>No build order set on:</p><ul>" + missing.map(b => "<li>" + esc(KS.displayName(b)) + "</li>").join("") + "</ul><p>Click a BOM's B/O chip to set it. Generate anyway?</p>", "Generate")) return;
    }
    try {
      const now = new Date();
      const doc = kind === "kit" ? KS.kitPdf(boms) : KS.packingList(boms);
      const name = kind === "kit"
        ? "kit_" + KS.boTag(boms, "labels") + "_" + KS.stamp(now, true) + ".pdf"
        : "packing_list_" + KS.boTag(boms, "list") + "_" + KS.stamp(now, false) + ".pdf";
      doc.setProperties({ title: name.replace(/\.pdf$/, ""), creator: "Kit Studio " + REV });
      download(name, doc.output("blob"));
      toast("Saved " + name);
    } catch (e) { info("PDF error", "<p>Could not generate the PDF:</p><ul><li>" + esc(e.message || e) + "</li></ul>"); }
  }

  // ---------- parts list (CSV) ----------
  const PART_LABELS = { atlas_pn: "Atlas PN", mfr: "Manufacturer", mpn: "Mfger PN (lookup key)", desc: "Description" };

  function paintPartsBtn() {
    const n = parts ? parts.records.length : 0;
    $("partsDot").classList.toggle("on", !!n);
    $("partsLbl").textContent = n ? "Parts · " + n.toLocaleString() : "Parts list";
  }

  function setParts(p) { parts = p; partsIdx = KS.partsIndex(p ? p.records : []); paintPartsBtn(); }

  function fillBlanks() {
    let n = 0;
    for (const b of boms) n += KS.enrichBom(b, partsIdx);
    if (n) { render(); changed(); }
    return n;
  }

  function partsModal() {
    if (!parts) {
      return openModal("Parts list",
        "<p>Import a parts list exported as CSV. Kit Studio looks up each BOM line by manufacturer part number and fills a blank Atlas PN, manufacturer or description. Values already in the BOM stay as they are.</p>" +
        '<p class="note">The file is read in this browser only and kept in this browser\'s storage. It is not uploaded.</p>',
        [{ label: "Close", onClick: closeModal }, { label: "Import CSV…", cls: "btn-primary", onClick: () => $("csvFile").click() }]);
    }
    const d = new Date(parts.importedAt);
    openModal("Parts list",
      '<div class="kv"><span>File</span><b>' + esc(parts.name) + "</b><span>Parts</span><b>" + parts.records.length.toLocaleString() + "</b>" +
      "<span>Imported</span><b>" + esc(d.toLocaleString()) + "</b><span>Columns</span><b>" +
      KS.PART_FIELDS.map(f => esc(PART_LABELS[f].replace(/ \(.*/, "")) + " ← " + esc(parts.headers[f] || "—")).join("<br>") + "</b></div>" +
      '<div class="field"><label for="lkIn">Look up a Mfger PN</label><input id="lkIn" autocomplete="off" spellcheck="false" placeholder="Type a manufacturer part number"></div>' +
      '<div class="hit" id="lkOut"></div>',
      [{ label: "Remove list", cls: "btn-danger", onClick: removeParts }, "|",
        { label: "Fill blanks in kit", onClick: () => { const n = fillBlanks(); toast(n ? "Filled " + plural(n, "line") + " from the parts list" : "No blank fields matched the parts list"); } },
        { label: "Import new CSV…", onClick: () => $("csvFile").click() },
        { label: "Close", cls: "btn-primary", onClick: closeModal }], true);
    $("lkIn").addEventListener("input", e => {
      const k = e.target.value.trim(), out = $("lkOut"), hit = k && partsIdx.get(k.toUpperCase());
      out.className = "hit" + (k ? hit ? " ok" : " miss" : "");
      out.textContent = !k ? "" : hit ? "Atlas PN " + (hit[0] || "—") + "  ·  " + (hit[1] || "—") + "  ·  " + (hit[3] || "—") : "Not in the parts list";
    });
  }

  async function removeParts() {
    if (!await ask("Remove parts list", "<p>Remove the parts list from this browser? Lines already filled stay as they are.</p>", "Remove", true)) return partsModal();
    setParts(null);
    try { await idb.del("parts"); } catch (e) { /* nothing stored */ }
    toast("Parts list removed");
  }

  async function importCsv(file) {
    let rows;
    try { rows = await KS.readCSVFile(file); } catch (e) { return info("Import failed", "<p>" + esc(e.message || e) + "</p>"); }
    if (rows.length < 2) return info("Import failed", "<p><b>" + esc(file.name) + "</b> has no data rows. The first row must hold the column names.</p>");
    const headers = rows[0];
    let map = KS.guessPartsColumns(headers);
    if (ui.partsCols) {                      // reuse the last mapping when the names match
      const m = {};
      for (const f of KS.PART_FIELDS) m[f] = headers.indexOf(ui.partsCols[f]);
      if (m.mpn >= 0) map = m;
    }
    const opts = sel => '<option value="-1">(none)</option>' + headers.map((h, i) => '<option value="' + i + '"' + (i === sel ? " selected" : "") + ">" + esc(h || "Column " + (i + 1)) + "</option>").join("");
    openModal("Import parts list — map columns",
      "<p><b>" + esc(file.name) + "</b> · " + (rows.length - 1).toLocaleString() + " rows. Pick the column for each field. Mfger PN is the lookup key.</p>" +
      '<div class="field-row">' + KS.PART_FIELDS.map(f => '<div class="field"><label for="pm_' + f + '">' + PART_LABELS[f] + '</label><select id="pm_' + f + '">' + opts(map[f]) + "</select></div>").join("") + "</div>" +
      '<div id="pmPrev"></div>' +
      (boms.length ? '<label class="note" style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="pmFill" checked> Fill blank fields in the ' + plural(boms.length, "loaded BOM") + " now</label>" : ""),
      [{ label: "Cancel", onClick: closeModal }, { label: "Use this list", cls: "btn-primary", id: "pmOk", onClick: commit }], true);

    const cur = () => { const m = {}; for (const f of KS.PART_FIELDS) m[f] = +$("pm_" + f).value; return m; };
    const preview = () => {
      const m = cur(), recs = m.mpn >= 0 ? KS.partsFromRows(rows, m) : [];
      $("pmOk").disabled = !recs.length;
      $("pmPrev").innerHTML = m.mpn < 0 ? '<p class="note">Pick the Mfger PN column.</p>'
        : '<table class="preview"><thead><tr>' + KS.PART_FIELDS.map(f => "<th>" + esc(PART_LABELS[f].replace(/ \(.*/, "")) + "</th>").join("") + "</tr></thead><tbody>" +
          recs.slice(0, 5).map(r => "<tr><td>" + [r[0], r[1], r[2], r[3]].map(esc).join("</td><td>") + "</td></tr>").join("") +
          '</tbody></table><p class="note">' + recs.length.toLocaleString() + " parts with a Mfger PN.</p>";
    };
    KS.PART_FIELDS.forEach(f => $("pm_" + f).addEventListener("change", preview));
    preview();

    async function commit() {
      const m = cur(), recs = KS.partsFromRows(rows, m);
      if (!recs.length) return;
      const names = {}; for (const f of KS.PART_FIELDS) names[f] = m[f] >= 0 ? headers[m[f]] : "";
      const fill = $("pmFill") ? $("pmFill").checked : false;
      setParts({ name: file.name, importedAt: new Date().toISOString(), headers: names, records: recs });
      ui.partsCols = names; saveUi();
      closeModal();
      let kept = true;
      try { await idb.set("parts", parts); } catch (e) { kept = false; }
      const n = fill ? fillBlanks() : 0;
      toast("Parts list: " + recs.length.toLocaleString() + " parts" + (n ? " · filled " + plural(n, "line") : "") + (kept ? "" : " (not kept: browser storage unavailable)"), kept ? "" : "warn");
    }
  }

  // ---------- wiring ----------
  const pickOne = (input, fn) => input.addEventListener("change", () => { const f = [...input.files]; input.value = ""; if (f.length) fn(f); });
  pickOne($("bomFile"), addBomFiles);
  pickOne($("sessFile"), f => loadSession(f[0]));
  pickOne($("csvFile"), f => importCsv(f[0]));

  $("addBtn").addEventListener("click", () => $("bomFile").click());
  $("loadBtn").addEventListener("click", () => $("sessFile").click());
  $("saveBtn").addEventListener("click", saveSession);
  $("newBtn").addEventListener("click", newKit);
  $("applyAllBtn").addEventListener("click", applyAll);
  $("enAllBtn").addEventListener("click", () => setAll(true));
  $("disAllBtn").addEventListener("click", () => setAll(false));
  $("fillBtn").addEventListener("click", fillOnHand);
  $("unshipBtn").addEventListener("click", disableUnshipped);
  $("packBtn").addEventListener("click", () => makePdf("pack"));
  $("pdfBtn").addEventListener("click", () => makePdf("kit"));
  $("partsBtn").addEventListener("click", partsModal);
  $("filter").addEventListener("input", render);
  $("themeBtn").addEventListener("click", () => {
    ui.theme = ui.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = ui.theme; saveUi();
  });

  document.addEventListener("keydown", e => {
    if ($("overlay").classList.contains("open")) {
      if (e.key === "Escape") closeModal();
      return;
    }
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === "f") { e.preventDefault(); $("filter").focus(); $("filter").select(); }
    else if (k === "o") { e.preventDefault(); $("bomFile").click(); }
    else if (k === "s") { e.preventDefault(); saveSession(); }
    else if (k === "g") { e.preventDefault(); makePdf("kit"); }
  });

  // Drag and drop: .xlsx → add, .kitproj/.json → load, .csv → parts list
  let dragDepth = 0;
  const hasFiles = e => e.dataTransfer && [...e.dataTransfer.types].includes("Files");
  window.addEventListener("dragenter", e => { if (hasFiles(e)) { dragDepth++; document.body.classList.add("drag"); } });
  window.addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove("drag"); } });
  window.addEventListener("dragover", e => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener("drop", e => {
    if (!hasFiles(e)) return;
    e.preventDefault(); dragDepth = 0; document.body.classList.remove("drag");
    const files = [...e.dataTransfer.files], ext = f => (f.name.split(".").pop() || "").toLowerCase();
    const xl = files.filter(f => ["xlsx", "xlsm", "xltx"].includes(ext(f)));
    const sess = files.find(f => ["kitproj", "json"].includes(ext(f)));
    const csv = files.find(f => ["csv", "tsv", "txt"].includes(ext(f)));
    if (xl.length) addBomFiles(xl);
    else if (sess) loadSession(sess);
    else if (csv) importCsv(csv);
    else toast("Drop .xlsx BOMs, a .kitproj session or a .csv parts list.", "warn");
  });

  window.addEventListener("beforeunload", e => {
    if (editing) commitEdit(false);
    if (!storageOk && boms.length) { e.preventDefault(); e.returnValue = ""; }
  });

  // ---------- boot ----------
  (() => {
    const im = new Image();
    im.onload = () => document.documentElement.classList.add("has-wm");
    im.src = "../../assets/brand/wordmark.png";
  })();
  document.documentElement.dataset.theme = ui.theme === "light" ? "light" : "dark";
  $("rev").textContent = "Kit Studio · " + REV;
  setDefaults(ui);
  paintPartsBtn();
  render();
  console.log("Kit Studio — " + REV);

  (async () => {
    try {
      const [kit, p] = await Promise.all([idb.get("kit"), idb.get("parts")]);
      if (p && Array.isArray(p.records)) setParts(p);
      if (kit && Array.isArray(kit.boms) && kit.boms.length && !boms.length) {
        const res = KS.fromSession(kit);
        boms = res.boms; setDefaults(res.defaults);
        render();
        $("saveStat").textContent = "Kit restored from this browser";
      }
    } catch (e) {
      storageOk = false;
      $("saveStat").textContent = "Browser storage unavailable — save a session file";
    }
  })();
})();
