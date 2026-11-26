/*
The samples of Nôm Ink, kept in this browser (IndexedDB "nom-ink", store "samples", key id; index "c": the character).
A sample: { id, c, mode: 'calm' | 'game' | 'parts', prompt, level, limitMs, status: 'ok' | 'timeout', eval, layout, strokes, pointer, device, light, created }
(see app.js); a sample of a part (mode 'parts') also has part (its key; index "part", version 2), c is the character it was shown in.
Nothing leaves the device but by the export.

  await InkDB.add(sample)        → its id
  await InkDB.byChar(c, n)       the last n samples of a character, newest first (not those of its parts)
  await InkDB.byPart(key, n)     the same of a part
  await InkDB.counts()           Map character → number of samples (status 'ok'), the parts as 'part:' + key
  await InkDB.all()              every sample (the export)
  await InkDB.remove(id)         one sample (Undo of the last one)
  await InkDB.removeMany(ids)    several (the menu: the samples of a batch, after a question)
  await InkDB.clear()            all of them
*/
window.InkDB = (() => {
  let db = null;
  function open() {
    if (db) return db;
    db = new Promise((ok, fail) => {
      const req = indexedDB.open('nom-ink', 2);
      req.onupgradeneeded = e => {
        const s = e.oldVersion < 1 ? req.result.createObjectStore('samples', { keyPath: 'id', autoIncrement: true }) : req.transaction.objectStore('samples');
        if (e.oldVersion < 1) s.createIndex('c', 'c');
        if (e.oldVersion < 2) s.createIndex('part', 'part');
      };
      req.onsuccess = () => ok(req.result);
      req.onerror = () => fail(req.error);
    });
    return db;
  }
  const done = req => new Promise((ok, fail) => { req.onsuccess = () => ok(req.result); req.onerror = () => fail(req.error); });
  async function store(mode) { return (await open()).transaction('samples', mode).objectStore('samples'); }
  // the last n samples (status 'ok', newest first) of one value of an index
  async function last(index, value, n, keep) {
    const s = await store('readonly');
    return new Promise((ok, fail) => {
      const out = [];
      const req = s.index(index).openCursor(IDBKeyRange.only(value), 'prev');
      req.onsuccess = () => { const cur = req.result; if (!cur || out.length >= n) { ok(out); return; } if (cur.value.status === 'ok' && keep(cur.value)) out.push(cur.value); cur.continue(); };
      req.onerror = () => fail(req.error);
    });
  }

  return {
    async add(sample) { return done((await store('readwrite')).add(sample)); },
    async remove(id) { return done((await store('readwrite')).delete(id)); },
    async removeMany(ids) {
      const s = await store('readwrite');
      await Promise.all(ids.map(id => done(s.delete(id))));
    },
    async clear() { return done((await store('readwrite')).clear()); },
    async all() { return done((await store('readonly')).getAll()); },
    async byChar(c, n = 12) { return last('c', c, n, v => !v.part); },
    async byPart(key, n = 12) { return last('part', key, n, () => true); },
    async counts() {
      const s = await store('readonly');
      return new Promise((ok, fail) => {
        const m = new Map();
        const req = s.openCursor();
        req.onsuccess = () => { const cur = req.result; if (!cur) { ok(m); return; } const v = cur.value; if (v.status === 'ok') { const k = v.part ? 'part:' + v.part : v.c; m.set(k, (m.get(k) || 0) + 1); } cur.continue(); };
        req.onerror = () => fail(req.error);
      });
    },
  };
})();
