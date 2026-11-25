/*
The traffic light of Nôm Ink: does what is written look about like the character asked for? (Not a recognition: only the one character is compared.)
A port of InkShape of the keyboard app (qtng/qatt-chunom-apk, qatt/ink/; "directional element features"): the strokes are put into the box 0..255 by their
extent (the longer side fills it, the shorter one centred), the box is cut into 10 × 10 fields, each field holds how much line runs in it in 4 directions
(—, ╱, |, ╲; a line between two counts for both), blurred into the neighbours, square-rooted, made of length 1; two shapes are compared by their product.

  InkShape.template(base64)          the strokes of a character of chars.json (each 8 points, 0..255 in the box 200 × 200 of GlyphWiki) → [[x, y, …], …]
  InkShape.judge(written, template)  written: [[x, y, x, y, …], …] (any unit, y down) → { ink, sim, light: 'red' | 'yellow' | 'green' }
      ink: the length of the lines written / that of the character (both in the box), sim: the similarity of the shapes (0..1)
      green: ink ≥ GREEN_INK and sim ≥ GREEN_SIM; yellow: ink ≥ YELLOW_INK; without a template only the amount of ink counts.
      Measured: 25 careful samples of the owner (finished ink 0.64–1.02, sim 0.49–0.73; the first half of their strokes ink mostly ≈ 0.5, at most 0.80
      with sim 0.37), then 108 samples of natural writing (strokes joined: sim often 0.33–0.5 although finished, ink 0.74–1.3). With 0.7 / 0.4 95 of
      the 104 natural ones are green (0.6 / 0.5 before: 79) and none of the half written ones
*/
window.InkShape = (() => {
  const ZONES = 10, FINE = 40, CELL = 256 / FINE, DIM = ZONES * ZONES * 4, BLUR = 1.0, SPACING = 12;
  const GREEN_INK = 0.7, GREEN_SIM = 0.4, YELLOW_INK = 0.35;

  function template(b64) {
    if (!b64) return null;
    const bin = atob(b64), strokes = [];
    for (let s = 0; s * 16 < bin.length; s++) {
      const line = [];
      for (let k = 0; k < 16; k++) line.push(bin.charCodeAt(s * 16 + k));
      strokes.push(line);
    }
    return strokes;
  }

  // the strokes put into the box 0..255 by their extent; returns [strokes, length of all lines]
  function normalized(strokes) {
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    for (const s of strokes) for (let k = 0; k < s.length; k += 2) {
      if (s[k] < l) l = s[k]; if (s[k] > r) r = s[k];
      if (s[k + 1] < t) t = s[k + 1]; if (s[k + 1] > b) b = s[k + 1];
    }
    const side = Math.max(r - l, b - t, 1), scale = 255 / side;
    const dx = (255 - (r - l) * scale) / 2, dy = (255 - (b - t) * scale) / 2;
    let len = 0;
    const out = strokes.map(s => {
      const a = new Float32Array(s.length);
      for (let k = 0; k < s.length; k += 2) {
        a[k] = Math.min(255, Math.max(0, (s[k] - l) * scale + dx));
        a[k + 1] = Math.min(255, Math.max(0, (s[k + 1] - t) * scale + dy));
        if (k) len += Math.hypot(a[k] - a[k - 2], a[k + 1] - a[k - 1]);
      }
      return a;
    });
    return [out, len];
  }

  // a line as points SPACING apart (the tremor of a finger must not count as lines in all directions)
  function even(a) {
    const n = a.length / 2;
    if (n < 2) return a;
    let total = 0;
    for (let k = 1; k < n; k++) total += Math.hypot(a[k * 2] - a[k * 2 - 2], a[k * 2 + 1] - a[k * 2 - 1]);
    if (!total) return a;
    const m = Math.min(64, Math.max(2, Math.floor(total / SPACING) + 1)), out = new Float32Array(m * 2);
    let j = 1, done = 0;
    for (let k = 0; k < m; k++) {
      const target = total * k / (m - 1);
      let seg = Math.hypot(a[j * 2] - a[j * 2 - 2], a[j * 2 + 1] - a[j * 2 - 1]);
      while (j < n - 1 && done + seg < target) { done += seg; j++; seg = Math.hypot(a[j * 2] - a[j * 2 - 2], a[j * 2 + 1] - a[j * 2 - 1]); }
      const f = seg ? Math.min(1, Math.max(0, (target - done) / seg)) : 0;
      out[k * 2] = a[j * 2 - 2] + (a[j * 2] - a[j * 2 - 2]) * f;
      out[k * 2 + 1] = a[j * 2 - 1] + (a[j * 2 + 1] - a[j * 2 - 1]) * f;
    }
    return out;
  }

  function line(x0, y0, x1, y1, grid) {
    const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
    if (len < 1e-3) {
      const cx = Math.min(FINE - 1, Math.max(0, Math.floor(x0 / CELL))), cy = Math.min(FINE - 1, Math.max(0, Math.floor(y0 / CELL)));
      for (let d = 0; d < 4; d++) grid[(cy * FINE + cx) * 4 + d] += CELL / 8;
      return;
    }
    let a = Math.atan2(-dy, dx);
    if (a < 0) a += Math.PI;
    if (a >= Math.PI) a -= Math.PI;
    const o = a / (Math.PI / 4), d0 = Math.floor(o) % 4, d1 = (d0 + 1) % 4, w1 = o - Math.floor(o), w0 = 1 - w1;
    const steps = Math.max(1, Math.floor(len / (CELL / 2))), part = len / steps;
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) / steps;
      const cx = Math.min(FINE - 1, Math.max(0, Math.floor((x0 + dx * t) / CELL)));
      const cy = Math.min(FINE - 1, Math.max(0, Math.floor((y0 + dy * t) / CELL)));
      const at = (cy * FINE + cx) * 4;
      grid[at + d0] += part * w0;
      grid[at + d1] += part * w1;
    }
  }

  function features(strokes) {
    const grid = new Float32Array(FINE * FINE * 4), out = new Float32Array(DIM);
    for (const s of strokes) {
      const n = s.length / 2;
      for (let k = 1; k < n; k++) line(s[k * 2 - 2], s[k * 2 - 1], s[k * 2], s[k * 2 + 1], grid);
      if (n === 1) line(s[0], s[1], s[0], s[1], grid);
    }
    const step = FINE / ZONES;
    for (let zy = 0; zy < ZONES; zy++) for (let zx = 0; zx < ZONES; zx++) {
      const cx = zx * step + step / 2 - 0.5, cy = zy * step + step / 2 - 0.5, to = (zy * ZONES + zx) * 4;
      for (let fy = Math.max(0, zy * step - step); fy < Math.min(FINE, zy * step + 2 * step); fy++) {
        const wy = 1 - Math.abs(fy - cy) / (step * BLUR);
        if (wy <= 0) continue;
        for (let fx = Math.max(0, zx * step - step); fx < Math.min(FINE, zx * step + 2 * step); fx++) {
          const wx = 1 - Math.abs(fx - cx) / (step * BLUR);
          if (wx <= 0) continue;
          const w = wx * wy, from = (fy * FINE + fx) * 4;
          for (let d = 0; d < 4; d++) out[to + d] += grid[from + d] * w;
        }
      }
    }
    let sum = 0;
    for (let i = 0; i < DIM; i++) { out[i] = Math.sqrt(out[i]); sum += out[i] * out[i]; }
    if (sum > 0) { const f = 1 / Math.sqrt(sum); for (let i = 0; i < DIM; i++) out[i] *= f; }
    return out;
  }

  const cache = new WeakMap();   // template -> [features, length]
  function judge(written, tmpl) {
    const strokes = written.filter(s => s.length >= 2);
    if (!strokes.length) return { ink: 0, sim: 0, light: 'red' };
    const [w, wl] = normalized(strokes);
    if (!tmpl) {   // no template: only that something sizeable was written
      const light = wl > 400 ? 'green' : wl > 150 ? 'yellow' : 'red';
      return { ink: null, sim: null, light };
    }
    let t = cache.get(tmpl);
    if (!t) { const [n, len] = normalized(tmpl); t = [features(n), len]; cache.set(tmpl, t); }
    const fw = features(w.map(even));
    let sim = 0;
    for (let i = 0; i < DIM; i++) sim += fw[i] * t[0][i];
    const ink = t[1] ? wl / t[1] : 0;
    const light = ink >= GREEN_INK && sim >= GREEN_SIM ? 'green' : ink >= YELLOW_INK ? 'yellow' : 'red';
    return { ink: Math.round(ink * 100) / 100, sim: Math.round(sim * 100) / 100, light };
  }

  return { template, judge, GREEN_INK, GREEN_SIM };
})();
