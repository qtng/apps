/*
Nôm Ink: a collection of handwriting of Chữ Nôm, kept on this device (js/db.js), exported as JSON (the menu).

A character of chars.json (the characters of dict.csv of chunom.org, built by features/ink/tools/build_chars.py of the private repository) is shown with
its reading in the upper half of the screen; it is written in the lower half, anywhere: the square drawn there (a practice grid: a square with its cross
and diagonals) is only a suggestion. It has another place and size for every character (55–90 % of the shorter side of the stage, left, middle or right,
higher or lower), so that the hand is held a little differently every time (squeezed shapes are
not asked for: they can be made from any sample later). Nothing moves (a dark screen, calm for the eyes). The characters come in batches of BATCH (chars.json is in the order of frequency: batch 1 = the 50 most frequent); the menu chooses the batch
(localStorage nomInkBatch) and shows how far each one is (GOAL samples of each of its characters). Every character is written once, then the next; the characters with the fewest
samples come first, never one of the last RECENT again. Above, the earlier samples of the character (small pictures). The traffic light (js/shape.js)
tells whether enough is written that looks like the character.

Calm: no prompt of the tempo (there were some on the first day; nobody reads them while writing: the tempo is measured). When the light is green and the pen is lifted, a bar runs down (AUTO_MS, a little slower than Gboard; yellow: YELLOW_MS, longer, in yellow: a
character of few strokes or written very freely may never turn green); then the
sample is kept and the next character comes (Undo in the message for a moment); a new stroke stops it. Next does the same at once, Skip goes on without it.
Parts: one part of a character (parts.json, built by features/ink/tools/build_parts.py: the top level of its IDS, from the stroke order data; an
enclosure closed after its inside in two parts, 囗① and 囗②, asked for separately; a part of one stroke is that stroke, key 'stroke:<kind>') is
written alone, in its place: the character is drawn above from its strokes with that part bright, a box in the square shows where the part is (its
extent in the character). The parts of the characters of the batch, the one with the fewest samples first (GOAL each), in a character of the batch
that has it (another one each time, if there are several). The light compares with the strokes of the part only. Such a sample has mode 'parts',
part (its key) and partBox (its extent in the box 200 × 200 of the character); c is the character it was shown in, layout.region the box in pixels of the stage.
Parts starts with the batch of the strokes (parts.json "strokes": the kinds of strokes found in at least 100 characters of the stroke data, 26 (synonyms of the data merged, a stroke that begins where the one before ends joined to it),
each in one of a few characters; every character can be put together from them, the rare kinds from their pieces), then the batches of
characters; each mode keeps its own batch (localStorage nomInkBatch, nomInkPartsBatch: -1 = the strokes). In Parts the square is always as big as the stage allows, in the middle
(the box of the part as big as it can be). The menu deletes the characters of the batch of Calm, or all parts and strokes (they belong to no batch: a part counts wherever it is).
Game: the character falls in its well; it must be written before it lands (the time from its strokes, shorter with every level). When the light is green
and the pen rests for a moment, it is taken; time up without green: game over (that sample is kept as 'timeout'). From EVAL_LEVEL on the samples
are kept with eval: false (only the game: too fast to be handwriting worth learning from).

A sample (v 2): { v, c, mode, prompt (null; 'normal' | 'quick' | 'flowing' | 'slow' in the samples of the first day), level, limitMs, status: 'ok' | 'timeout', eval, layout: { kind, x, y, w, h, stageW, stageH, beside },
(beside: a character in grey left of the square, until 2026-11-26)
strokes: [[[x, y, t, p], …], …] (x, y in CSS pixels of the stage, which does not move: the shape is exactly as written; t ms from the first touch of the
character, p the pressure 0..1 or null), pointer ('touch' | 'pen' | 'mouse'), device: { kind, dpr, w, h }, light: { ink, sim, light } (when it was kept),
created (ISO time) }. layout.x, y, w, h: the square suggested. Samples of the first evening also have layout.drift and .at (the field drifted then);
version 1 (the first day) had the points in pixels of the field and fields of every shape.
*/
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const T = (en, vi) => Lang.t(en, vi);
  // a text that is set by script and follows the language (lang.js translates tags with data-vi; data-en is the English it returns to)
  function say(el, en, vi) { el.setAttribute('data-en', en); el.setAttribute('data-vi', vi); el.textContent = Lang.current === 'vi' ? vi : en; }

  const RECENT = 30;           // a character comes again only after so many others
  const EVAL_LEVEL = 9;        // from this level of the game on, the samples are kept with eval: false
  const PER_LEVEL = 5;         // characters per level of the game
  const BEST = 'nomInkBest';   // localStorage: the best score of the game

  const AUTO_MS = 1500;     // calm: from lifting the pen (light green) to the next character
  const YELLOW_MS = 3500;   // the same with the light yellow (enough ink, the shape not quite): a longer rest
  const GOAL = 10;          // samples per character the collection aims at (the thin bar below the title: of the batch)
  const BATCH = 50;         // characters per batch
  const BATCH_KEY = 'nomInkBatch';
  const PARTS_BATCH_KEY = 'nomInkPartsBatch';   // the batch of Parts (-1: the strokes)
  const MODE_KEY = 'nomInkMode';   // 'parts' when the app was left in that mode (it opens in it again), else calm

  const pick = list => { let sum = 0; for (const x of list) sum += x.w; let r = Math.random() * sum; for (const x of list) { if ((r -= x.w) < 0) return x; } return list[list.length - 1]; };
  const rand = (a, b) => a + Math.random() * (b - a);

  let chars = [], counts = new Map(), recent = [], total = 0;
  let parts = null;      // parts.json: { hosts: { character: { L, parts: [[key, [line, …], box, template], …] } }, keys: { key: label } }
  let mode = 'calm';
  let cur = null;        // { item, template, layout, strokes, t0, pointer, light }
  let drawing = null;    // the stroke being written
  let game = null;       // { level, score, n, start, limit, raf, idle, over, last: [] }

  const canvas = $('canvas'), field = $('field'), stage = $('stage'), ctx = canvas.getContext('2d');

  // ---------- start ----------
  async function init() {
    try { chars = (await (await fetch('chars.json')).json()).chars; } catch (e) { say($('reading'), 'The characters could not be loaded.', 'Không tải được các chữ.'); return; }
    try { counts = await InkDB.counts(); } catch (e) { counts = new Map(); }
    total = 0; for (const n of counts.values()) total += n;
    for (const b of document.querySelectorAll('#lang button')) b.addEventListener('click', () => Lang.set(b.dataset.lang));
    for (const b of document.querySelectorAll('#mode button')) b.addEventListener('click', () => setMode(b.dataset.mode));
    document.addEventListener('langchange', marks);
    $('menu-btn').addEventListener('click', e => { e.stopPropagation(); toggleMenu(); });
    document.addEventListener('click', e => { if (!$('menu').hidden && !$('menu').contains(e.target)) toggleMenu(false); });
    $('export').addEventListener('click', () => { toggleMenu(false); exportAll(); });
    $('delete-chars').addEventListener('click', () => { toggleMenu(false); askDelete('calm'); });
    $('delete-parts').addEventListener('click', () => { toggleMenu(false); askDelete('parts'); });
    $('batch-btn').addEventListener('click', chooseBatch);
    try {
      savedBatch.calm = Math.max(0, Math.min(batchCount() - 1, +(localStorage.getItem(BATCH_KEY) || 0) | 0));
      const pb = localStorage.getItem(PARTS_BATCH_KEY);
      if (pb !== null) savedBatch.parts = Math.max(-1, Math.min(batchCount() - 1, +pb | 0));
    } catch (e) { /* no storage */ }
    batch = savedBatch.calm;
    // a new version of the app (the service worker took over): load it, but not in the middle of a character
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller)
      navigator.serviceWorker.addEventListener('controllerchange', () => { if (!cur || !cur.strokes.length) location.reload(); else reloadSoon = true; });
    $('undo').addEventListener('click', undoStroke);
    $('clear').addEventListener('click', clearField);
    $('skip').addEventListener('click', () => { hideToast(); next(); });
    $('next').addEventListener('click', onNext);
    $('toast-undo').addEventListener('click', undoSaved);
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    addEventListener('resize', () => { if (cur) placeField(cur.layout, true); });
    document.addEventListener('visibilitychange', () => { if (document.hidden && game && !game.over && !game.paused) pause(); });
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
    marks();
    stats();
    let start = null;
    try { start = localStorage.getItem(MODE_KEY); } catch (e) { /* no storage */ }
    if (start === 'parts') setMode('parts'); else next();
  }

  function marks() {
    for (const b of document.querySelectorAll('#lang button')) b.classList.toggle('on', b.dataset.lang === Lang.current);
    for (const b of document.querySelectorAll('#mode button')) b.classList.toggle('on', b.dataset.mode === mode);
    stats();
  }

  function stats() {
    if (!chars.length) return;
    // the batch: how far it is (GOAL samples of each of its characters), in the bar below the title and in the menu
    const done = batchDone(batch), p = pct(done), [en, vi] = batchName(batch);
    const pp = mode === 'parts';
    $('stats').textContent = T(`${en} · ${p} % · ${total} ${total === 1 ? 'sample' : 'samples'}`, `${vi} · ${p} % · ${total} mẫu`);
    $('goal').firstElementChild.style.width = `${p}%`;
    $('goal').title = pp ? T(`${batch < 0 ? en : 'Parts of ' + en.toLowerCase()}: ${done[0]} of ${done[1]} (${GOAL} per part)`, `${batch < 0 ? vi : 'Bộ phận của ' + vi.toLowerCase()}: ${done[0]} / ${done[1]} (${GOAL} mỗi bộ phận)`)
      : T(`${en}: ${done[0]} of ${done[1]} (${GOAL} per character)`, `${vi}: ${done[0]} / ${done[1]} (${GOAL} mỗi chữ)`);
    const m = $('batch-btn');
    if (m) { m.setAttribute('data-en', `${en} (${p} %)…`); m.setAttribute('data-vi', `${vi} (${p} %)…`); m.textContent = T(`${en} (${p} %)…`, `${vi} (${p} %)…`); }
    // the two deletions of the menu: the characters of the batch of Calm, the parts of the batch of Parts
    const [ce, cv] = batchName(savedBatch.calm);
    say($('delete-chars'), `Delete the characters of ${ce.toLowerCase()}…`, `Xoá các chữ của ${cv.toLowerCase()}…`);
  }

  function toggleMenu(open) {
    const m = $('menu'), on = open ?? m.hidden;
    m.hidden = !on;
    $('menu-btn').setAttribute('aria-expanded', String(on));
  }

  // ---------- the next character ----------
  // #c=<character> in the address: that character first (to practise one, or for a test)
  let asked = (() => { try { const m = /(?:^#|&)c=([^&]+)/.exec(location.hash); return m ? decodeURIComponent(m[1]) : null; } catch (e) { return null; } })();
  let askedPart = (() => { try { const m = /&p=([^&]+)/.exec(location.hash); return m ? decodeURIComponent(m[1]) : null; } catch (e) { return null; } })();

  // ---------- the batches ----------
  let batch = 0;                                  // of the mode shown; -1: the strokes (only Parts)
  const savedBatch = { calm: 0, parts: -1 };      // each mode keeps its own batch (Parts starts with the strokes)
  const batchName = b => (b < 0 ? ['Strokes', 'Các nét'] : [`Batch ${b + 1}`, `Bộ ${b + 1}`]);
  const batchCount = () => Math.ceil(chars.length / BATCH);
  const batchChars = b => chars.slice(b * BATCH, (b + 1) * BATCH);
  // how far a batch is: GOAL samples of each of its characters (more of one do not count) → [got, all]
  function batchDone(b) {
    if (mode === 'parts') {   // the parts of its characters
      const keys = batchParts(b);
      let got = 0;
      for (const k of keys.keys()) got += Math.min(counts.get('part:' + k) || 0, GOAL);
      return [got, keys.size * GOAL];
    }
    const list = batchChars(b);
    let got = 0;
    for (const it of list) got += Math.min(counts.get(it.c) || 0, GOAL);
    return [got, list.length * GOAL];
  }
  // the parts of the characters of a batch: Map key → [[character, its part], …]
  function batchParts(b) {
    const m = new Map();
    if (!parts) return m;
    if (b < 0) {   // the strokes: each kind in the characters it is shown in
      const by = new Map(chars.map(x => [x.c, x]));
      for (const [key, shown] of parts.strokes) m.set(key, shown.map(h => [by.get(h[0]) || { c: h[0], r: '' }, [key, h[1], h[2], h[3]]]));
      return m;
    }
    for (const it of batchChars(b)) {
      const h = parts.hosts[it.c];
      if (h) for (const p of h.parts) { if (!m.has(p[0])) m.set(p[0], []); m.get(p[0]).push([it, p]); }
    }
    return m;
  }
  async function loadParts() {
    if (parts) return true;
    try { parts = await (await fetch('parts.json')).json(); return true; } catch (e) { say($('reading'), 'The parts could not be loaded.', 'Không tải được các bộ phận.'); return false; }
  }
  const pct = ([got, all]) => (all ? Math.floor(got * 1000 / all) / 10 : 0);

  function chooseBatch() {
    toggleMenu(false);
    const rows = [];
    for (let b = mode === 'parts' ? -1 : 0; b < batchCount(); b++) {
      const p = pct(batchDone(b)), [en, vi] = batchName(b);
      const glyphs = b < 0 ? parts.strokes.slice(0, 8).map(x => parts.keys[x[0]]).filter(x => x.length === 1) : batchChars(b).slice(0, 8).map(x => x.c);
      rows.push(`<button type="button" class="batch${b === batch ? ' on' : ''}" data-b="${b}"><b>${T(en, vi)}</b><span class="glyphs" lang="zh-Hant">${glyphs.join('')}</span>` +
        `<span class="pct">${p} %</span><i style="width:${p}%"></i></button>`);
    }
    const text = mode === 'parts' ? T(`The strokes first: with them every character can be put together. Then ${BATCH} characters each, the most frequent first; ${GOAL} samples of each of their parts make 100 %.`, `Trước hết là các nét: từ chúng có thể ghép mọi chữ. Sau đó mỗi bộ ${BATCH} chữ, chữ thường gặp nhất trước; ${GOAL} mẫu mỗi bộ phận của chúng là 100 %.`)
      : T(`${BATCH} characters each, the most frequent first; ${GOAL} samples of each character make 100 %.`, `Mỗi bộ ${BATCH} chữ, chữ thường gặp nhất trước; ${GOAL} mẫu mỗi chữ là 100 %.`);
    card(`<h2>${T('Choose a batch', 'Chọn bộ chữ')}</h2><p>${text}</p>
      <div class="batches">${rows.join('')}</div><div class="row"><button type="button" id="batch-close">${T('Close', 'Đóng')}</button></div>`);
    for (const el of document.querySelectorAll('#card .batch')) el.onclick = () => { setBatch(+el.dataset.b); closeCard(); };
    $('batch-close').onclick = () => closeCard();
  }

  function setBatch(b) {
    batch = Math.max(mode === 'parts' ? -1 : 0, Math.min(batchCount() - 1, b | 0));
    savedBatch[mode === 'parts' ? 'parts' : 'calm'] = batch;
    try { localStorage.setItem(mode === 'parts' ? PARTS_BATCH_KEY : BATCH_KEY, String(batch)); } catch (e) { /* no storage */ }
    recent = []; recentParts = [];
    stats();
    if (!game) next();
  }

  // a part: of the batch, the fewest samples first, not one of the last few; in one of its characters of the batch (not the same as last time)
  let recentParts = [], lastHost = new Map();
  function choosePart() {
    const m = batchParts(batch);
    if (asked) {   // #c=<character>&p=<key>: that part of that character first (for a test)
      const h = parts.hosts[asked], k = askedPart; asked = askedPart = null;
      const p = h && (h.parts.find(x => x[0] === k) || h.parts[0]);
      if (p) { const it = chars.find(x => parts.hosts[x.c] === h); recentParts.push(p[0]); return { ...it, part: { key: p[0], label: parts.keys[p[0]] || p[0], lines: p[1], box: p[2], t: p[3] }, L: h.L }; }
    }
    if (!m.size) return null;
    const key = fewest([...m.keys()], k => counts.get('part:' + k) || 0, k => k, recentParts);
    recentParts.push(key);
    if (recentParts.length > RECENT) recentParts.shift();
    // a character (another one than last time, each as likely), then one of its strokes of that kind (a stroke can be in a character more than once)
    const hosts = m.get(key), names = [...new Set(hosts.map(h => h[0].c))], other = names.filter(c => c !== lastHost.get(key));
    const pickFrom = other.length ? other : names, name = pickFrom[Math.floor(Math.random() * pickFrom.length)];
    const mine = hosts.filter(h => h[0].c === name);
    const [it, p] = mine[Math.floor(Math.random() * mine.length)];
    lastHost.set(key, it.c);
    return { ...it, part: { key, label: parts.keys[key] || key, lines: p[1], box: p[2], t: p[3] }, L: parts.hosts[it.c].L };
  }

  // the next one: always among those with the fewest samples (a character or a part that is behind comes first, however recently it was asked for);
  // among them one not asked for lately (the last few are kept back, fewer in a small batch), else the one asked for longest ago
  function fewest(list, count, id, recentList) {
    if (!list.length) return null;
    let best = Infinity;
    for (const x of list) best = Math.min(best, count(x));
    const low = list.filter(x => count(x) === best);
    const avoid = new Set(recentList.slice(-Math.max(0, Math.min(RECENT, list.length - 10))));
    const free = low.filter(x => !avoid.has(id(x)));
    if (free.length) return free[Math.floor(Math.random() * free.length)];
    return low.reduce((a, b) => (recentList.lastIndexOf(id(a)) <= recentList.lastIndexOf(id(b)) ? a : b));
  }

  function choose() {
    if (mode === 'parts') { const it = choosePart(); if (it) return it; }
    if (asked) { const it = chars.find(x => x.c === asked); asked = null; if (it) { recent.push(it.c); return it; } }
    const list = batchChars(batch);
    const it = fewest(list, x => counts.get(x.c) || 0, x => x.c, recent) || chars[0];
    recent.push(it.c);
    if (recent.length > RECENT) recent.shift();
    return it;
  }

  let reloadSoon = false;
  function next() {
    if (reloadSoon && !game) { location.reload(); return; }
    const item = choose();
    const template = InkShape.template(item.part ? item.part.t : item.t);
    cur = { item, template, layout: null, strokes: [], t0: 0, pointer: null, light: null };
    show(item);
    cur.layout = layoutFor('square');
    placeField(cur.layout);
    clearField();
    if (mode !== 'game') thumbs(item);
    if (game) startTimer();
  }

  // the character asked for: as text, or (a part) drawn from its strokes with the part bright, its name and the character below
  function show(item) {
    const g = $('glyph'), r = $('reading');
    if (!item.part) { g.textContent = item.c; r.textContent = item.r; $('region').hidden = true; return; }
    const p = item.part, esc = v => v.replace(/[&<>"]/g, ch => `&#${ch.charCodeAt(0)};`);
    const on = new Set(p.lines), path = mine => item.L.filter((_, k) => on.has(k) === mine).join(' ');
    g.innerHTML = `<svg viewBox="0 0 200 200" role="img" aria-label="${esc(p.label)} · ${esc(item.c)}"><path class="rest" d="${path(false)}"/><path class="part" d="${path(true)}"/></svg>`;
    r.innerHTML = `<span class="han" lang="zh-Hant">${esc(p.label)}</span> · <span class="han" lang="zh-Hant">${esc(item.c)}</span> ${esc(item.r)}`;
  }

  // the box of a part in the square (its extent in the character, a little wider), in pixels of the stage
  function regionFor(l, box) {
    const pad = 8, f = l.w / 200;
    const x0 = Math.max(0, box[0] - pad), y0 = Math.max(0, box[1] - pad), x1 = Math.min(200, box[2] + pad), y1 = Math.min(200, box[3] + pad);
    return { x: Math.round(l.x + x0 * f), y: Math.round(l.y + y0 * f), w: Math.round((x1 - x0) * f), h: Math.round((y1 - y0) * f) };
  }

  // the field in the stage: its place and size for this character
  function layoutFor(kind) {
    const W = stage.clientWidth, H = stage.clientHeight, m = 10, S = Math.min(W, H);
    if (mode === 'parts') {   // Parts: always the whole height (or width), in the middle: the box of the part as big as it can be
      const w = Math.round(Math.max(40, S - 2 * m));
      return { kind, x: Math.round((W - w) / 2), y: Math.round((H - w) / 2), w, h: w, stageW: Math.round(W), stageH: Math.round(H) };
    }
    const room = (side, size) => m + Math.random() * Math.max(0, side - 2 * m - size);
    const w = Math.min(S * rand(.55, .9), W - 2 * m, H - 2 * m);
    const x = room(W, w), y = room(H, w);
    const r = v => Math.round(v);
    return { kind, x: r(x), y: r(y), w: r(w), h: r(w), stageW: r(W), stageH: r(H) };
  }

  // the bar of the time left until the next character (calm: AUTO_MS after the pen was lifted with the light green; the game: its rest)
  let autoTimer = 0;
  function autoStart(ms, then, yellow) {
    autoStop();
    const bar = $('auto').firstElementChild;
    $('auto').classList.toggle('yellow', !!yellow);
    $('auto').hidden = false;                         // shown first: a hidden bar has no width to start the animation from
    bar.style.transition = 'none'; bar.style.width = '100%';
    void bar.offsetWidth;
    bar.style.transition = `width ${ms}ms linear`; bar.style.width = '0%';
    autoTimer = setTimeout(() => { autoStop(); if (!drawing) then(); }, ms);
  }
  function autoStop() {
    clearTimeout(autoTimer); autoTimer = 0;
    $('auto').hidden = true;
  }

  function placeField(l, resized) {
    if (resized) {   // the stage changed its size (rotation): the same kind of place again, the strokes stay (they are in pixels of the stage)
      const kind = l.kind, old = cur.strokes;
      cur.layout = l = layoutFor(kind);
      cur.strokes = old;
    }
    Object.assign(field.style, { left: l.x + 'px', top: l.y + 'px', width: l.w + 'px', height: l.h + 'px' });
    const part = cur.item.part, reg = $('region');
    reg.hidden = !part;
    if (part) {
      l.region = regionFor(l, part.box);
      Object.assign(reg.style, { left: (l.region.x - l.x) + 'px', top: (l.region.y - l.y) + 'px', width: l.region.w + 'px', height: l.region.h + 'px' });
    }
    const dpr = devicePixelRatio || 1;
    canvas.width = Math.round(l.stageW * dpr); canvas.height = Math.round(l.stageH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    redraw();
  }

  // ---------- writing ----------
  function point(e) {
    const r = canvas.getBoundingClientRect();
    return [Math.round((e.clientX - r.left) * 10) / 10, Math.round((e.clientY - r.top) * 10) / 10,
      Math.round(e.timeStamp - cur.t0), e.pressure > 0 && e.pointerType !== 'mouse' ? Math.round(e.pressure * 100) / 100 : null];
  }

  function down(e) {
    if (!cur || (game && (game.over || game.paused))) return;
    if (e.button > 0) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    if (!cur.strokes.length) cur.t0 = e.timeStamp;
    cur.pointer = e.pointerType;
    drawing = { id: e.pointerId, pts: [point(e)] };
    cur.strokes.push(drawing.pts);
    autoStop();
    hideToast();
    redraw();
  }

  function move(e) {
    if (!drawing || e.pointerId !== drawing.id) return;
    const list = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const c of (list.length ? list : [e])) drawing.pts.push(point(c));
    redraw();
  }

  function up(e) {
    if (!drawing || e.pointerId !== drawing.id) return;
    drawing = null;
    judge();
    redraw();
    const light = cur.light && cur.light.light, go = () => (game ? accept('ok', true) : onNext(true));
    if (light === 'green') autoStart(game ? idleMs() : AUTO_MS, go);
    else if (light === 'yellow') autoStart(game ? idleMs() * 2.5 : YELLOW_MS, go, true);   // a longer rest: some characters never turn green
  }

  function judge() {
    const lines = cur.strokes.map(s => s.flatMap(p => [p[0], p[1]]));
    cur.light = InkShape.judge(lines, cur.template);
    $('light').dataset.on = cur.strokes.length ? cur.light.light : '';
    $('next').disabled = !cur.strokes.length;
  }

  function redraw() {
    const l = cur && cur.layout;
    if (!l) return;
    ctx.clearRect(0, 0, l.stageW, l.stageH);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = getComputedStyle(document.body).color;
    ctx.lineWidth = Math.max(3, Math.min(l.w, l.h) / 55);
    for (const s of cur.strokes) {
      ctx.beginPath();
      ctx.moveTo(s[0][0], s[0][1]);
      if (s.length === 1) ctx.lineTo(s[0][0] + .1, s[0][1]);
      for (let i = 1; i < s.length; i++) ctx.lineTo(s[i][0], s[i][1]);
      ctx.stroke();
    }
  }

  function undoStroke() {
    if (!cur || !cur.strokes.length || drawing) return;
    cur.strokes.pop();
    judge(); redraw();
    autoStop();
  }

  function clearField() {
    if (!cur) return;
    cur.strokes = []; drawing = null;
    $('light').dataset.on = '';
    $('next').disabled = true;
    autoStop();
    redraw();
  }

  // ---------- keeping a sample ----------
  const keyOf = s => (s.part ? 'part:' + s.part : s.c);   // the key of a sample in counts

  function device() {
    const touch = matchMedia('(pointer: coarse)').matches, s = Math.min(screen.width, screen.height);
    return { kind: touch ? (s < 600 ? 'phone' : 'tablet') : 'desktop', dpr: devicePixelRatio || 1, w: screen.width, h: screen.height };
  }

  async function keep(status) {
    const l = cur.layout;
    const sample = {
      v: 2, c: cur.item.c, mode, prompt: null, level: game ? game.level : null, limitMs: game ? Math.round(game.limit) : null,
      status, eval: !game || game.level < EVAL_LEVEL,
      layout: { kind: l.kind, x: l.x, y: l.y, w: l.w, h: l.h, stageW: l.stageW, stageH: l.stageH, beside: null },
      strokes: cur.strokes, pointer: cur.pointer, device: device(), light: cur.light, created: new Date().toISOString(),
    };
    if (cur.item.part) { sample.part = cur.item.part.key; sample.partBox = cur.item.part.box; sample.layout.region = l.region; }
    let id = null;
    try { id = await InkDB.add(sample); } catch (e) { toast(T('Not saved: ', 'Chưa lưu: ') + e.message); return null; }
    const k = keyOf(sample);
    if (status === 'ok') { counts.set(k, (counts.get(k) || 0) + 1); total++; stats(); }
    return { id, sample };
  }

  async function onNext(auto) {
    autoStop();
    if (!cur || !cur.strokes.length) return;
    if (game) { if (auto || (cur.light && cur.light.light === 'green')) accept('ok'); else { field.classList.remove('shake'); void field.offsetWidth; field.classList.add('shake'); } return; }
    const kept = await keep('ok');
    if (kept) { kept.item = cur.item; toast(T('Kept', 'Đã lưu'), kept); }
    next();
  }

  // the message after a sample was kept, with Undo (the sample goes and its character comes again)
  let toastTimer = null, lastKept = null;
  function toast(text, kept) {
    $('toast-text').textContent = text;
    $('toast-undo').hidden = !kept;
    lastKept = kept || null;
    $('toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 3500);
  }
  function hideToast() { $('toast').hidden = true; lastKept = null; }
  async function undoSaved() {
    const k = lastKept;
    hideToast();
    if (!k) return;
    try { await InkDB.remove(k.id); } catch (e) { return; }
    const key = keyOf(k.sample), n = (counts.get(key) || 1) - 1;
    if (n > 0) counts.set(key, n); else counts.delete(key);
    total = Math.max(0, total - 1); stats();
    // the character (the part) again, in the place of the one that came after it
    if (k.item.part) recentParts = recentParts.filter(x => x !== k.item.part.key);
    else recent = recent.filter(c => c !== k.sample.c);
    const item = k.item;
    if (item.part) recentParts.push(item.part.key); else recent.push(item.c);
    cur.item = item; cur.template = InkShape.template(item.part ? item.part.t : item.t);
    show(item); placeField(cur.layout); clearField(); thumbs(item);
  }

  // the earlier samples of the character, small
  async function thumbs(item) {
    const box = $('thumbs');
    let list = [];
    try { list = item.part ? await InkDB.byPart(item.part.key, 14) : await InkDB.byChar(item.c, 14); } catch (e) { /* no storage */ }
    if (!cur || cur.item !== item) return;
    box.replaceChildren();
    if (!list.length) {
      const s = document.createElement('span'); s.className = 'none';
      if (item.part) say(s, 'Your earlier samples of this part appear here.', 'Các mẫu trước của bạn cho bộ phận này hiện ở đây.');
      else say(s, 'Your earlier samples of this character appear here.', 'Các mẫu trước của bạn cho chữ này hiện ở đây.');
      box.append(s); return;
    }
    for (const s of list) box.append(picture(s.strokes, 42));
  }

  function picture(strokes, size) {
    const c = document.createElement('canvas'), dpr = devicePixelRatio || 1;
    c.width = c.height = size * dpr;
    const g = c.getContext('2d');
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    for (const s of strokes) for (const p of s) { l = Math.min(l, p[0]); r = Math.max(r, p[0]); t = Math.min(t, p[1]); b = Math.max(b, p[1]); }
    const side = Math.max(r - l, b - t, 1), pad = size * .12, f = (size - 2 * pad) / side;
    const ox = pad + ((size - 2 * pad) - (r - l) * f) / 2, oy = pad + ((size - 2 * pad) - (b - t) * f) / 2;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = 1.6; g.strokeStyle = getComputedStyle(document.body).color;
    for (const s of strokes) {
      g.beginPath();
      g.moveTo(ox + (s[0][0] - l) * f, oy + (s[0][1] - t) * f);
      if (s.length === 1) g.lineTo(ox + (s[0][0] - l) * f + .1, oy + (s[0][1] - t) * f);
      for (const p of s) g.lineTo(ox + (p[0] - l) * f, oy + (p[1] - t) * f);
      g.stroke();
    }
    return c;
  }

  // ---------- export ----------
  async function exportAll() {
    let all = [];
    try { all = await InkDB.all(); } catch (e) { toast(e.message); return; }
    const day = new Date().toISOString().slice(0, 10);
    const text = JSON.stringify({ app: 'nom-ink', version: 1, exported: new Date().toISOString(), samples: all });
    const name = `nom-ink-${day}.json`;
    const file = new File([text], name, { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file); a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    toast(T(`${all.length} samples exported`, `Đã xuất ${all.length} mẫu`));
  }

  // ---------- deleting all samples ----------
  // what the menu deletes: the characters of the batch of Calm (and of the game: by their character), or every part and stroke (of any batch)
  async function batchSamples(which) {
    if (which === 'parts') return (await InkDB.all()).filter(s => !!s.part);
    const set = new Set(batchChars(savedBatch.calm).map(x => x.c));
    return (await InkDB.all()).filter(s => !s.part && set.has(s.c));
  }

  async function askDelete(which) {
    let list;
    try { list = await batchSamples(which); } catch (e) { toast(e.message); return; }
    if (!list) return;
    const [en, vi] = batchName(savedBatch.calm);
    const what = which === 'calm' ? T(`the characters of ${en.toLowerCase()}`, `các chữ của ${vi.toLowerCase()}`) : T('all parts and strokes', 'tất cả bộ phận và nét');
    if (!list.length) { toast(T(`No samples of ${what}`, `Không có mẫu nào của ${what}`)); return; }
    card(`<h2>${T(`Delete ${what}?`, `Xoá ${what}?`)}</h2>
      <p>${T(`${list.length} samples on this device are deleted, the others stay. Export them first if you want to keep them.`, `${list.length} mẫu trên thiết bị này sẽ bị xoá, các mẫu khác vẫn còn. Hãy xuất chúng trước nếu bạn muốn giữ lại.`)}</p>
      <div class="row"><button type="button" id="del-export">${T('Export', 'Xuất')}</button><button type="button" id="del-no">${T('Cancel', 'Huỷ')}</button><button type="button" class="main" id="del-yes">${T('Delete', 'Xoá')}</button></div>`);
    $('del-export').onclick = () => exportAll();
    $('del-no').onclick = () => closeCard();
    $('del-yes').onclick = async () => {
      try { await InkDB.removeMany(list.map(s => s.id)); counts = await InkDB.counts(); } catch (e) { toast(e.message); return; }
      total = 0; for (const n of counts.values()) total += n;
      recent = []; recentParts = [];
      closeCard(); stats(); hideToast();
      toast(T(`${list.length} samples deleted`, `Đã xoá ${list.length} mẫu`));
      if (mode !== 'game') next();
    };
  }


  // ---------- the modes ----------
  async function setMode(m) {
    if (m === mode) return;
    if (m === 'parts' && !(await loadParts())) return;
    mode = m;
    batch = savedBatch[m === 'parts' ? 'parts' : 'calm'];
    recent = []; recentParts = [];
    try { localStorage.setItem(MODE_KEY, m === 'parts' ? 'parts' : 'calm'); } catch (e) { /* no storage */ }
    document.body.dataset.mode = m;
    stopGame();
    marks();
    if (m === 'game') startScreen();
    else { $('game-line').textContent = ''; next(); }
  }

  // ---------- the game ----------
  const strokesOf = c => (c.t ? Math.round(c.t.length * 3 / 4 / 16) : 8);
  const limitFor = (item, level) => (1300 + 900 * strokesOf(item)) * 1.6 * Math.pow(0.88, level - 1);   // ms
  const idleMs = () => Math.max(250, 800 * Math.pow(0.9, (game ? game.level : 1) - 1));

  function card(html) { $('card').innerHTML = html; $('overlay').hidden = false; }
  function closeCard() { $('overlay').hidden = true; }

  function startScreen() {
    const best = +(localStorage.getItem(BEST) || 0);
    card(`<h2>${T('Game', 'Trò chơi')}</h2>
      <p>${T('Write each character before it lands. When the light is green and you lift the pen for a moment, it counts. It gets faster with every level.', 'Viết mỗi chữ trước khi nó chạm đáy. Khi đèn xanh và bạn nhấc bút một chút, chữ được tính. Mỗi cấp nhanh hơn.')}</p>
      ${best ? `<p>${T('Best', 'Kỷ lục')}: <b>${best}</b></p>` : ''}
      <div class="row"><button type="button" id="calm-back">${T('Calm', 'Thong thả')}</button><button type="button" class="main" id="go">${T('Start', 'Bắt đầu')}</button></div>`);
    $('go').onclick = () => { closeCard(); startGame(); };
    $('calm-back').onclick = () => { closeCard(); setMode('calm'); };
  }

  function startGame() {
    game = { level: 1, score: 0, n: 0, start: 0, limit: 0, raf: 0, idle: 0, over: false, paused: false, last: [] };
    recent = recent.slice(-RECENT);
    next();
  }

  function stopGame() {
    if (!game) return;
    cancelAnimationFrame(game.raf); autoStop();
    game = null;
    $('glyph').style.removeProperty('--fall');
    $('timer').firstElementChild.style.width = '0';
    closeCard();
  }

  function gameLine() { $('game-line').textContent = T(`Level ${game.level} · ${game.score} points`, `Cấp ${game.level} · ${game.score} điểm`); }

  function startTimer() {
    cancelAnimationFrame(game.raf);
    game.limit = limitFor(cur.item, game.level);
    game.start = performance.now();
    game.pausedFor = 0;
    gameLine();
    const glyph = $('glyph'), well = $('well'), bar = $('timer').firstElementChild;
    const tick = now => {
      if (!game || game.over) return;
      if (game.paused) { game.raf = requestAnimationFrame(tick); return; }
      const f = Math.min(1, (now - game.start - game.pausedFor) / game.limit);
      glyph.style.setProperty('--fall', `${Math.round(f * (well.clientHeight - glyph.offsetHeight * .9))}px`);
      bar.style.width = `${(1 - f) * 100}%`;
      if (f >= 1) { timeUp(); return; }
      game.raf = requestAnimationFrame(tick);
    };
    game.raf = requestAnimationFrame(tick);
  }

  async function accept(status, auto) {
    if (!game || game.over || !cur.strokes.length) return;
    cancelAnimationFrame(game.raf); autoStop();
    const kept = await keep(status);
    if (kept) game.last.push(kept.sample.strokes);
    if (game.last.length > 8) game.last.shift();
    game.n++;
    game.score += strokesOf(cur.item) * game.level;
    if (game.n % PER_LEVEL === 0) game.level++;
    next();
  }

  async function timeUp() {
    if (cur.light && cur.light.light === 'green') { accept('ok'); return; }
    game.over = true;
    autoStop();
    if (cur.strokes.length) await keep('timeout');
    const best = Math.max(+(localStorage.getItem(BEST) || 0), game.score);
    try { localStorage.setItem(BEST, String(best)); } catch (e) { /* no storage */ }
    card(`<h2>${T('Game over', 'Hết giờ')}</h2>
      <div class="big">${game.score}</div>
      <p>${T(`Level ${game.level} · ${game.n} characters · best ${best}`, `Cấp ${game.level} · ${game.n} chữ · kỷ lục ${best}`)}</p>
      <div class="last" id="last"></div>
      <div class="row"><button type="button" id="calm-back">${T('Calm', 'Thong thả')}</button><button type="button" class="main" id="again">${T('Again', 'Chơi lại')}</button></div>`);
    for (const s of game.last) $('last').append(picture(s, 42));
    $('again').onclick = () => { closeCard(); stopGame(); startGame(); };
    $('calm-back').onclick = () => { closeCard(); setMode('calm'); };
  }

  function pause() {
    game.paused = true; game.pausedAt = performance.now();
    autoStop();
    card(`<h2>${T('Paused', 'Tạm dừng')}</h2><div class="row"><button type="button" class="main" id="resume">${T('Continue', 'Tiếp tục')}</button></div>`);
    $('resume').onclick = () => { closeCard(); game.pausedFor += performance.now() - game.pausedAt; game.paused = false; };
  }

  init();
})();
