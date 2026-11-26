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

  const pick = list => { let sum = 0; for (const x of list) sum += x.w; let r = Math.random() * sum; for (const x of list) { if ((r -= x.w) < 0) return x; } return list[list.length - 1]; };
  const rand = (a, b) => a + Math.random() * (b - a);

  let chars = [], counts = new Map(), recent = [], total = 0;
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
    $('delete-all').addEventListener('click', () => { toggleMenu(false); askDelete(); });
    $('batch-btn').addEventListener('click', chooseBatch);
    try { batch = Math.max(0, Math.min(batchCount() - 1, +(localStorage.getItem(BATCH_KEY) || 0) | 0)); } catch (e) { batch = 0; }
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
    next();
  }

  function marks() {
    for (const b of document.querySelectorAll('#lang button')) b.classList.toggle('on', b.dataset.lang === Lang.current);
    for (const b of document.querySelectorAll('#mode button')) b.classList.toggle('on', b.dataset.mode === mode);
    stats();
  }

  function stats() {
    if (!chars.length) return;
    // the batch: how far it is (GOAL samples of each of its characters), in the bar below the title and in the menu
    const done = batchDone(batch), p = pct(done);
    $('stats').textContent = T(`Batch ${batch + 1} · ${p} % · ${total} ${total === 1 ? 'sample' : 'samples'}`, `Bộ ${batch + 1} · ${p} % · ${total} mẫu`);
    $('goal').firstElementChild.style.width = `${p}%`;
    $('goal').title = T(`Batch ${batch + 1}: ${done[0]} of ${done[1]} (${GOAL} per character)`, `Bộ ${batch + 1}: ${done[0]} / ${done[1]} (${GOAL} mỗi chữ)`);
    const m = $('batch-btn');
    if (m) { m.setAttribute('data-en', `Batch ${batch + 1} (${p} %)…`); m.setAttribute('data-vi', `Bộ ${batch + 1} (${p} %)…`); m.textContent = T(`Batch ${batch + 1} (${p} %)…`, `Bộ ${batch + 1} (${p} %)…`); }
  }

  function toggleMenu(open) {
    const m = $('menu'), on = open ?? m.hidden;
    m.hidden = !on;
    $('menu-btn').setAttribute('aria-expanded', String(on));
  }

  // ---------- the next character ----------
  // #c=<character> in the address: that character first (to practise one, or for a test)
  let asked = (() => { try { const m = /(?:^#|&)c=([^&]+)/.exec(location.hash); return m ? decodeURIComponent(m[1]) : null; } catch (e) { return null; } })();

  // ---------- the batches ----------
  let batch = 0;
  const batchCount = () => Math.ceil(chars.length / BATCH);
  const batchChars = b => chars.slice(b * BATCH, (b + 1) * BATCH);
  // how far a batch is: GOAL samples of each of its characters (more of one do not count) → [got, all]
  function batchDone(b) {
    const list = batchChars(b);
    let got = 0;
    for (const it of list) got += Math.min(counts.get(it.c) || 0, GOAL);
    return [got, list.length * GOAL];
  }
  const pct = ([got, all]) => (all ? Math.floor(got * 1000 / all) / 10 : 0);

  function chooseBatch() {
    toggleMenu(false);
    const rows = [];
    for (let b = 0; b < batchCount(); b++) {
      const p = pct(batchDone(b)), list = batchChars(b);
      rows.push(`<button type="button" class="batch${b === batch ? ' on' : ''}" data-b="${b}"><b>${T('Batch', 'Bộ')} ${b + 1}</b><span class="glyphs" lang="zh-Hant">${list.slice(0, 8).map(x => x.c).join('')}</span>` +
        `<span class="pct">${p} %</span><i style="width:${p}%"></i></button>`);
    }
    card(`<h2>${T('Choose a batch', 'Chọn bộ chữ')}</h2><p>${T(`${BATCH} characters each, the most frequent first; ${GOAL} samples of each character make 100 %.`, `Mỗi bộ ${BATCH} chữ, chữ thường gặp nhất trước; ${GOAL} mẫu mỗi chữ là 100 %.`)}</p>
      <div class="batches">${rows.join('')}</div><div class="row"><button type="button" id="batch-close">${T('Close', 'Đóng')}</button></div>`);
    for (const el of document.querySelectorAll('#card .batch')) el.onclick = () => { setBatch(+el.dataset.b); closeCard(); };
    $('batch-close').onclick = () => closeCard();
  }

  function setBatch(b) {
    batch = Math.max(0, Math.min(batchCount() - 1, b | 0));
    try { localStorage.setItem(BATCH_KEY, String(batch)); } catch (e) { /* no storage */ }
    recent = [];
    stats();
    if (!game) next();
  }

  function choose() {
    if (asked) { const it = chars.find(x => x.c === asked); asked = null; if (it) { recent.push(it.c); return it; } }
    const list = batchChars(batch);
    const avoid = new Set(recent.slice(-Math.max(0, Math.min(RECENT, list.length - 10))));   // a small batch: fewer kept back
    let best = Infinity, pool = [];
    for (const it of list) {
      if (avoid.has(it.c)) continue;
      const n = counts.get(it.c) || 0;
      if (n < best) { best = n; pool = [it]; } else if (n === best) pool.push(it);
    }
    const it = pool[Math.floor(Math.random() * pool.length)] || list[0] || chars[0];
    recent.push(it.c);
    if (recent.length > RECENT) recent.shift();
    return it;
  }

  let reloadSoon = false;
  function next() {
    if (reloadSoon && !game) { location.reload(); return; }
    const item = choose();
    const template = InkShape.template(item.t);
    cur = { item, template, layout: null, strokes: [], t0: 0, pointer: null, light: null };
    $('glyph').textContent = item.c;
    $('reading').textContent = item.r;
    cur.layout = layoutFor('square');
    placeField(cur.layout);
    clearField();
    if (mode === 'calm') thumbs(item.c);
    if (game) startTimer();
  }

  // the field in the stage: its place and size for this character
  function layoutFor(kind) {
    const W = stage.clientWidth, H = stage.clientHeight, m = 10, S = Math.min(W, H);
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
    let id = null;
    try { id = await InkDB.add(sample); } catch (e) { toast(T('Not saved: ', 'Chưa lưu: ') + e.message); return null; }
    if (status === 'ok') { counts.set(sample.c, (counts.get(sample.c) || 0) + 1); total++; stats(); }
    return { id, sample };
  }

  async function onNext(auto) {
    autoStop();
    if (!cur || !cur.strokes.length) return;
    if (game) { if (auto || (cur.light && cur.light.light === 'green')) accept('ok'); else { field.classList.remove('shake'); void field.offsetWidth; field.classList.add('shake'); } return; }
    const kept = await keep('ok');
    if (kept) toast(T('Kept', 'Đã lưu'), kept);
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
    const n = (counts.get(k.sample.c) || 1) - 1;
    if (n > 0) counts.set(k.sample.c, n); else counts.delete(k.sample.c);
    total = Math.max(0, total - 1); stats();
    recent = recent.filter(c => c !== k.sample.c);
    // the character again
    const item = chars.find(it => it.c === k.sample.c);
    if (item) { recent.push(item.c); cur.item = item; cur.template = InkShape.template(item.t); $('glyph').textContent = item.c; $('reading').textContent = item.r; clearField(); thumbs(item.c); }
  }

  // the earlier samples of the character, small
  async function thumbs(c) {
    const box = $('thumbs');
    let list = [];
    try { list = await InkDB.byChar(c, 14); } catch (e) { /* no storage */ }
    if (!cur || cur.item.c !== c) return;
    box.replaceChildren();
    if (!list.length) { const s = document.createElement('span'); s.className = 'none'; say(s, 'Your earlier samples of this character appear here.', 'Các mẫu trước của bạn cho chữ này hiện ở đây.'); box.append(s); return; }
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
  function askDelete() {
    card(`<h2>${T('Delete all samples?', 'Xoá tất cả mẫu?')}</h2>
      <p>${T(`All ${total} samples on this device are deleted. Export them first if you want to keep them.`, `Tất cả ${total} mẫu trên thiết bị này sẽ bị xoá. Hãy xuất chúng trước nếu bạn muốn giữ lại.`)}</p>
      <div class="row"><button type="button" id="del-export">${T('Export', 'Xuất')}</button><button type="button" id="del-no">${T('Cancel', 'Huỷ')}</button><button type="button" class="main" id="del-yes">${T('Delete', 'Xoá')}</button></div>`);
    $('del-export').onclick = () => exportAll();
    $('del-no').onclick = () => closeCard();
    $('del-yes').onclick = async () => {
      try { await InkDB.clear(); } catch (e) { toast(e.message); return; }
      counts = new Map(); total = 0; recent = [];
      closeCard(); stats(); hideToast();
      toast(T('All samples deleted', 'Đã xoá tất cả mẫu'));
      if (mode === 'calm') next();
    };
  }

  // ---------- the modes ----------
  function setMode(m) {
    if (m === mode) return;
    mode = m;
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
