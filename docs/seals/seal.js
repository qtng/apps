/*
The seal generator (docs/seals/index.html, chunom.org/apps/seals/): Chữ Nôm characters in a seal, drawn on a canvas in a CJK font of js/fonts.js (qatt.org), with worn edges, downloaded as a PNG.

The characters are typed in the field with js/ime.js (Telex and the Chữ Nôm candidates); only the Han characters of the field go into the seal.
A space between two characters is an empty cell: the field turns it into a full-width space (U+3000) as soon as there are characters on both sides
(not while a word is typed in Latin letters, and not at the ends).
Layout (any number of characters; a character outside the BMP, a surrogate pair, counts as one): n columns, n the largest number with
count > n·(n − 1), and as many rows as needed: a square n × n or one row more (1: 1 × 1, 2: 1 × 2, 3–4: 2 × 2, 5–6: 2 × 3, 7–9: 3 × 3,
10–12: 3 × 4, 13–16: 4 × 4, …). Read from the right, column by column from the top, or row by row from the left.
In two columns an odd number gets the filler 印 (the checkbox next to the field) so that the grid is full; from three columns on there is none and the checkbox is hidden.
Share: a link with the text and every setting in its query (t text, f font, fi filler 1/0, c carving r/w, o reading c/r, i ink without #,
s size, b border, r corners, w wear); opening it restores them (values that are not offered are left at their defaults). The share dialog of the
system where there is one, else the link is copied.
The worn edges come from value noise in the units of the 600 px preview, so the download (drawn at twice the size) looks the same.
*/
(() => {
  const BASE = 600;          // width of the preview in px; every length below is in these units
  const EXPORT_SCALE = 2;    // the PNG is 1200 px wide
  const MARGIN = 24, PAD = 14;

  const $ = id => document.getElementById(id);
  const canvas = $("seal");
  const textInput = $("text");
  const fontSelect = $("font");
  const fillerCheck = $("filler");   // also while its box is out of the page (from three columns on)
  const radioValue = name => document.querySelector(`input[name="${name}"]:checked`).value;
  const sliders = {   // id: [element, output, unit]
    radius: [$("radius"), $("radius-out"), " px"],
    fray: [$("fray"), $("fray-out"), " %"],
    border: [$("border"), $("border-out"), " px"],
    scale: [$("scale"), $("scale-out"), " %"],
  };
  const SEED = 4219;   // the noise of the worn edges: the same for every seal

  // ---- the fonts: the CJK fonts of js/fonts.js (written into the <head> by navigation.js), Migoi first if there
  const fonts = (typeof qattFontsShown === "function" ? qattFontsShown() : QATT_FONTS).filter(f => f.cjk);
  for (const f of fonts) fontSelect.append(new Option(f.label, f.family));
  fontSelect.value = fonts.some(f => f.family === "Migoi") ? "Migoi" : fonts[0].family;

  // ---- the settings of the form
  // the cells of the field: a Han character (with a variation selector that follows it, an IVS) or an empty cell (a full-width space, or a space between
  // two characters); the Latin letters of a word that is still being typed and the spaces at the ends stay out
  const CELL = /[\p{Script=Han}〇][\uFE00-\uFE0F\u{E0100}-\u{E01EF}]?|[\u3000 ]/gu;
  const chars = () => {
    const cells = textInput.value.match(CELL) || [];
    while (cells[0] === " ") cells.shift();
    while (cells[cells.length - 1] === " ") cells.pop();
    return cells.map(c => c === " " || c === "\u3000" ? "" : c);
  };
  // a space between two characters (or full-width spaces) becomes a full-width space in the field; the same length, so the caret stays where it is
  const SPACE = /(?<=[\p{Script=Han}〇\u3000\uFE00-\uFE0F\u{E0100}-\u{E01EF}] *) (?= *[\p{Script=Han}〇\u3000])/gu;
  const widenSpaces = () => {
    const value = textInput.value.replace(SPACE, "\u3000");
    if (value === textInput.value) return;
    const { selectionStart, selectionEnd } = textInput;
    textInput.value = value;
    textInput.setSelectionRange(selectionStart, selectionEnd);
  };
  const settings = () => ({
    chars: chars(),
    font: fontSelect.value,
    filler: fillerCheck.checked ? "印" : "",
    order: radioValue("order"),
    style: radioValue("style"),
    ink: radioValue("ink"),
    radius: +sliders.radius[0].value,
    fray: +sliders.fray[0].value,
    border: +sliders.border[0].value,
    scale: +sliders.scale[0].value,
  });

  // the number of columns for `count` characters: the largest n with count > n·(n − 1)
  const columnsFor = count => { let n = 1; while (count > (n + 1) * n) n++; return n; };

  // the cells of the seal: { cols, rows, cells in row-major order }
  function grid(s) {
    const list = [...s.chars];   // "" = an empty cell
    if (columnsFor(list.length) === 2 && list.length % 2 && s.filler) list.push(s.filler);
    const cols = columnsFor(list.length);
    const rows = Math.max(1, Math.ceil(list.length / cols));
    const cells = new Array(cols * rows).fill("");
    list.forEach((ch, i) => {
      if (s.order === "columns") cells[(i % rows) * cols + cols - 1 - Math.floor(i / rows)] = ch;   // the right column first, top to bottom
      else cells[i] = ch;
    });
    return { cols, rows, cells };
  }

  // ---- noise: a seeded random generator (mulberry32) and smooth 2D value noise in [0, 1)
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function noise2D(seed) {
    const rand = rng(seed);
    const perm = new Uint8Array(512), vals = new Float32Array(256);
    for (let i = 0; i < 256; i++) { perm[i] = i; vals[i] = rand(); }
    for (let i = 255; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
    for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
    const smooth = t => t * t * (3 - 2 * t);
    return (x, y) => {
      const fx = Math.floor(x), fy = Math.floor(y);
      const xi = fx & 255, yi = fy & 255;
      const u = smooth(x - fx), v = smooth(y - fy);
      const a = vals[perm[perm[xi] + yi]], b = vals[perm[perm[xi + 1] + yi]];
      const c = vals[perm[perm[xi] + yi + 1]], d = vals[perm[perm[xi + 1] + yi + 1]];
      const top = a + u * (b - a), bottom = c + u * (d - c);
      return top + v * (bottom - top);
    };
  }

  // ---- the worn edges: every pixel takes the ink of a point shifted by noise, and near an edge of the ink (in any of 8 directions) noise cuts it away;
  // the inside of a stroke or of the border stays solid. Only the alpha of the drawing is read; every pixel is drawn in the ink colour.
  function wear(ctx, w, h, percent, seed, ink, scale, fine) {   // fine: < 1 for small cells (thin strokes), the wear is that much smaller
    if (percent <= 0) return;
    const strength = percent / 100;
    const noise = noise2D(seed);
    const img = ctx.getImageData(0, 0, w, h);
    const px = img.data;
    const alpha = new Uint8Array(w * h);
    for (let i = 0; i < alpha.length; i++) alpha[i] = px[i * 4 + 3];

    // a sum table of "has ink", to skip the pixels far from the ink and those deep inside it without any noise
    const sum = new Uint32Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) {
        row += alpha[y * w + x] > 0 ? 1 : 0;
        sum[(y + 1) * (w + 1) + x + 1] = sum[y * (w + 1) + x + 1] + row;
      }
    }
    const inkIn = (x0, y0, x1, y1) => {   // pixels with ink in [x0, x1) × [y0, y1), clamped
      x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(w, x1); y1 = Math.min(h, y1);
      if (x1 <= x0 || y1 <= y0) return [0, 0];
      const W = w + 1;
      return [sum[y1 * W + x1] - sum[y0 * W + x1] - sum[y1 * W + x0] + sum[y0 * W + x0], (x1 - x0) * (y1 - y0)];
    };
    const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : alpha[y * w + x];

    const depth = Math.max(1, Math.round((2 + strength * 6) * fine)) * scale;   // how far the edge test looks
    const diag = Math.round(depth * 0.7);
    const dirs = [[depth, 0], [-depth, 0], [0, depth], [0, -depth], [diag, diag], [-diag, diag], [diag, -diag], [-diag, -diag]];
    const shift = strength * 4.5 * fine * scale;
    const reach = Math.ceil(shift + depth + 1);
    const [r, g, b] = [1, 3, 5].map(i => parseInt(ink.slice(i, i + 2), 16));

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        const [n, area] = inkIn(x - reach, y - reach, x + reach + 1, y + reach + 1);
        if (n === 0) { px[o + 3] = 0; continue; }
        if (n === area && alpha[y * w + x] >= 250) { px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = 255; continue; }

        const bx = x / scale, by = y / scale;   // noise in preview units
        const dx = ((noise(bx * 0.055, by * 0.085) - 0.5) * 0.65 + (noise(bx * 0.26, by * 0.30) - 0.5) * 0.55) * shift;
        const dy = ((noise(bx * 0.085 + 31, by * 0.055 + 17) - 0.5) * 0.65 + (noise(bx * 0.30 + 73, by * 0.26 + 41) - 0.5) * 0.55) * shift;
        const sx = Math.min(w - 1, Math.max(0, Math.round(x + dx)));
        const sy = Math.min(h - 1, Math.max(0, Math.round(y + dy)));
        const a = at(sx, sy);
        let out = 0;
        if (a > 0) {
          let edge = 0;
          for (const [ox, oy] of dirs) if (at(sx + ox, sy + oy) < 128) edge++;
          edge /= dirs.length;
          if (edge === 0 && a >= 250) out = 255;
          else {
            const cut = edge * (0.35 + strength * 0.55) + strength * 0.14;
            const grain = noise(bx * 0.22 + 11, by * 0.26 + 5) * 0.65 + noise(bx * 0.55, by * 0.65) * 0.35;
            out = grain < cut ? 0 : a > 90 ? 255 : 0;
          }
        }
        px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = out;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // a character centred on its ink (the fonts differ in where they put the ideographs in the em box)
  function drawChar(ctx, ch, cx, cy) {
    const m = ctx.measureText(ch);
    const x = cx - (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2;
    const y = cy + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
    ctx.fillText(ch, x, y);
  }

  // ---- the seal on a canvas, `scale` times the preview size
  // a light ink (white) is shown on a warm dark grey; a very light, transparent shadow keeps it visible on any picture
  const isLight = ink => { const n = parseInt(ink.slice(1), 16); return (n >> 16) + (n >> 8 & 255) + (n & 255) > 690; };
  const DARK_BG = [58, 54, 50], LIGHT_BG = [250, 247, 242];

  function shadow(ctx, w, h, scale) {
    const copy = document.createElement("canvas");
    copy.width = w; copy.height = h;
    copy.getContext("2d").drawImage(ctx.canvas, 0, 0);
    ctx.save();
    ctx.globalCompositeOperation = "destination-over";
    ctx.shadowColor = "rgba(0, 0, 0, .28)";
    ctx.shadowBlur = 7 * scale;
    ctx.shadowOffsetX = w + 50;   // only the shadow is drawn: the copy itself lies outside the canvas
    ctx.shadowOffsetY = 1.5 * scale;
    ctx.drawImage(copy, -(w + 50), 0);
    ctx.restore();
  }

  function draw(target, s, scale) {
    const { cols, rows, cells } = grid(s);
    const bw = s.border * 1.8;
    // the corners: a radius in absolute units, so a big one gives a flattened oval (a circle for a square grid), not a pointed ellipse;
    // the characters keep out of the rounded corners
    const radius = s.radius * 2, inner = Math.max(0, radius - bw);
    const inset = MARGIN + bw + PAD + inner * (1 - Math.SQRT1_2);
    const cell = (BASE - inset * 2) / cols;
    const height = Math.round(inset * 2 + cell * rows);
    target.width = BASE * scale;
    target.height = height * scale;
    const ctx = target.getContext("2d", { willReadFrequently: true });
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, BASE, height);

    const boxW = BASE - MARGIN * 2, boxH = height - MARGIN * 2;
    ctx.fillStyle = ctx.strokeStyle = s.ink;
    if (s.style === "relief") {   // red characters in a red frame
      ctx.lineWidth = bw;
      roundRect(ctx, MARGIN + bw / 2, MARGIN + bw / 2, boxW - bw, boxH - bw, radius - bw / 2);   // the outer corner has the radius
      ctx.stroke();
    } else {                      // white characters cut out of a red block
      roundRect(ctx, MARGIN, MARGIN, boxW, boxH, radius);
      ctx.fill();
      ctx.globalCompositeOperation = "destination-out";
    }

    const size = cell * (cols === 1 ? 0.84 : 1) * s.scale / 100;
    ctx.font = `${size}px "${s.font}", serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    cells.forEach((text, i) => {
      if (!text) return;
      const cx = inset + cell * (i % cols + 0.5), cy = inset + cell * (Math.floor(i / cols) + 0.5);
      drawChar(ctx, text, cx, cy);
    });
    ctx.globalCompositeOperation = "source-over";
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    wear(ctx, target.width, target.height, s.fray, SEED, s.ink, scale, Math.min(1, cell * 2 / (BASE - inset * 2)));   // as in two columns, finer in more
    if (isLight(s.ink)) shadow(ctx, target.width, target.height, scale);
  }

  // ---- drawing on demand: once per frame, and again when the font slices of the characters have come
  let queued = false;
  const render = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const s = settings();
      draw(canvas, s, 1);
      canvas.parentElement.classList.toggle("dark", isLight(s.ink));
    });
  };
  const loadFont = () => {
    const s = settings();
    const text = grid(s).cells.join("");
    if (text && document.fonts) document.fonts.load(`60px "${s.font}"`, text).then(render, () => {});
    render();
  };

  // the checkbox 印 next to the field only where it matters: in two columns (it is taken out of the group, so that the field gets its round corners back)
  const fillerBox = $("filler-box"), textGroup = $("text-group");
  const showFiller = () => {
    const wanted = columnsFor(chars().length) < 3;
    if (wanted && !fillerBox.isConnected) textGroup.append(fillerBox);
    else if (!wanted && fillerBox.isConnected) fillerBox.remove();
  };
  const showSliders = () => {
    for (const [input, out, unit] of Object.values(sliders)) out.textContent = input.value + unit;
  };

  // ---- the field: Telex and the candidates of js/ime.js, in the font of the seal (its Latin first, for the letters being typed)
  const fieldFonts = () => [fontSelect.value + " Latin", fontSelect.value];
  const ime = window.VietIme ? new VietIme(textInput, { defer: true, returnSelect: true, fontList: fieldFonts() }) : null;
  const setFieldFont = () => {
    if (ime) { ime.options.fontList = fieldFonts(); ime.update(); }
    else textInput.style.fontFamily = fieldFonts().map(f => `"${f}"`).join(", ");
  };

  textInput.addEventListener("input", e => { if (!e.isComposing) widenSpaces(); showFiller(); loadFont(); });
  fontSelect.addEventListener("change", () => { setFieldFont(); loadFont(); });
  fillerCheck.addEventListener("change", loadFont);
  // the buttons next to the font list go through the fonts (round)
  const stepFont = d => {
    const i = fonts.findIndex(f => f.family === fontSelect.value);
    fontSelect.value = fonts[(i + d + fonts.length) % fonts.length].family;
    fontSelect.dispatchEvent(new Event("change"));
  };
  $("font-prev").addEventListener("click", () => stepFont(-1));
  $("font-next").addEventListener("click", () => stepFont(1));
  document.querySelectorAll('input[name="order"], input[name="style"], input[name="ink"]').forEach(el => el.addEventListener("change", render));
  for (const [input] of Object.values(sliders)) input.addEventListener("input", () => { showSliders(); render(); });

  // the PNG stays transparent; the chunk bKGD only suggests a background to the viewers that read it
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = bytes => { let c = 0xffffffff; for (const b of bytes) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  async function withBackground(blob, [r, g, b]) {
    try {
      const src = new Uint8Array(await blob.arrayBuffer());
      const at = 8 + 25;   // signature + IHDR (4 length, 4 type, 13 data, 4 crc)
      const chunk = new Uint8Array(12 + 6), view = new DataView(chunk.buffer);
      view.setUint32(0, 6);
      chunk.set([0x62, 0x4b, 0x47, 0x44], 4);   // bKGD
      view.setUint16(8, r); view.setUint16(10, g); view.setUint16(12, b);
      view.setUint32(14, crc32(chunk.subarray(4, 14)));
      const out = new Uint8Array(src.length + chunk.length);
      out.set(src.subarray(0, at)); out.set(chunk, at); out.set(src.subarray(at), at + chunk.length);
      return new Blob([out], { type: "image/png" });
    } catch (e) { return blob; }
  }

  $("download").addEventListener("click", () => {
    const s = settings();
    const out = document.createElement("canvas");
    draw(out, s, EXPORT_SCALE);
    out.toBlob(async raw => {
      const blob = await withBackground(raw, isLight(s.ink) ? DARK_BG : LIGHT_BG);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `seal-${s.chars.filter(Boolean).map(c => c.codePointAt(0).toString(16).toUpperCase()).join("-") || "chunom"}.png`;   // code points: some browsers drop a name with CJK characters
      document.body.append(a);
      a.click();
      setTimeout(() => { a.remove(); URL.revokeObjectURL(a.href); }, 1000);
    }, "image/png");
  });

  // ---- share: the settings as a link, and back
  const RADIO = { c: ["style", { r: "relief", w: "intaglio" }], o: ["order", { c: "columns", r: "rows" }] };
  const RANGE = { s: "scale", b: "border", r: "radius", w: "fray" };
  function shareLink() {
    const s = settings();
    const q = new URLSearchParams({ t: s.chars.map(c => c || "\u3000").join(""), f: s.font, fi: fillerCheck.checked ? 1 : 0 });
    for (const [key, [name, values]] of Object.entries(RADIO)) q.set(key, Object.keys(values).find(k => values[k] === radioValue(name)));
    q.set("i", s.ink.slice(1));
    for (const [key, id] of Object.entries(RANGE)) q.set(key, sliders[id][0].value);
    return location.origin + location.pathname + "?" + q;
  }
  function applyLink() {
    const q = new URLSearchParams(location.search);
    if (q.has("t")) textInput.value = q.get("t");
    if (fonts.some(f => f.family === q.get("f"))) fontSelect.value = q.get("f");
    if (q.has("fi")) fillerCheck.checked = q.get("fi") !== "0";
    const check = (name, value) => { const el = document.querySelector(`input[name="${name}"][value="${CSS.escape(value)}"]`); if (el) el.checked = true; };
    for (const [key, [name, values]] of Object.entries(RADIO)) if (values[q.get(key)]) check(name, values[q.get(key)]);
    if (/^[0-9a-f]{6}$/i.test(q.get("i") || "")) check("ink", "#" + q.get("i").toLowerCase());
    for (const [key, id] of Object.entries(RANGE)) {
      const input = sliders[id][0], v = Number(q.get(key));
      if (q.has(key) && Number.isFinite(v) && v >= +input.min && v <= +input.max) input.value = v;
    }
  }
  const shareBtn = $("share");
  $("share").addEventListener("click", async () => {
    const url = shareLink();
    if (navigator.share) {
      try { await navigator.share({ title: document.title, url }); return; }
      catch (e) { if (e.name === "AbortError") return; }   // cancelled; any other error: copy instead
    }
    try { await navigator.clipboard.writeText(url); }
    catch (e) { prompt(Lang.t("Copy the link:", "Sao chép liên kết:"), url); return; }
    shareBtn.classList.add("done");
    clearTimeout(shareBtn.timer);
    shareBtn.timer = setTimeout(() => shareBtn.classList.remove("done"), 2000);
  });

  if (document.fonts) document.fonts.addEventListener("loadingdone", render);
  applyLink();
  setFieldFont();
  widenSpaces();
  showFiller();
  showSliders();
  loadFont();
})();
