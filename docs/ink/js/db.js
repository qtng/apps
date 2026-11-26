/*
The samples of Nôm Ink, kept in this browser (IndexedDB "nom-ink", store "samples", key id; index "c": the character).
A sample: { id, c, mode: 'calm' | 'game', prompt, level, limitMs, status: 'ok' | 'timeout', eval, layout, strokes, pointer, device, light, created }
(see app.js). Nothing leaves the device but by the export.

  await InkDB.add(sample)        → its id
  await InkDB.byChar(c, n)       the last n samples of a character, newest first
  await InkDB.counts()           Map character → number of samples (status 'ok')
  await InkDB.all()              every sample (the export)
  await InkDB.remove(id)         one sample (Undo of the last one)
  await InkDB.clear()            all of them (the menu, after a question)
*/
window.InkDB = (() => {
  let db = null;
  function open() {
    if (db) return db;
    db = new Promise((ok, fail) => {
      const req = indexedDB.open('nom-ink', 1);
      req.onupgradeneeded = () => {
        const s = req.result.createObjectStore('samples', { keyPath: 'id', autoIncrement: true });
        s.createIndex('c', 'c');
      };
      req.onsuccess = () => ok(req.result);
      req.onerror = () => fail(req.error);
    });
    return db;
  }
  const done = req => new Promise((ok, fail) => { req.onsuccess = () => ok(req.result); req.onerror = () => fail(req.error); });
  async function store(mode) { return (await open()).transaction('samples', mode).objectStore('samples'); }

  return {
    async add(sample) { return done((await store('readwrite')).add(sample)); },
    async remove(id) { return done((await store('readwrite')).delete(id)); },
    async clear() { return done((await store('readwrite')).clear()); },
    async all() { return done((await store('readonly')).getAll()); },
    async byChar(c, n = 12) {
      const s = await store('readonly');
      return new Promise((ok, fail) => {
        const out = [];
        const req = s.index('c').openCursor(IDBKeyRange.only(c), 'prev');
        req.onsuccess = () => { const cur = req.result; if (!cur || out.length >= n) { ok(out); return; } if (cur.value.status === 'ok') out.push(cur.value); cur.continue(); };
        req.onerror = () => fail(req.error);
      });
    },
    async counts() {
      const s = await store('readonly');
      return new Promise((ok, fail) => {
        const m = new Map();
        const req = s.openCursor();
        req.onsuccess = () => { const cur = req.result; if (!cur) { ok(m); return; } const v = cur.value; if (v.status === 'ok') m.set(v.c, (m.get(v.c) || 0) + 1); cur.continue(); };
        req.onerror = () => fail(req.error);
      });
    },
  };
})();
