/* Gestion des brouillons auto-sauvegardés en IndexedDB */

const Drafts = (() => {
  const DB_NAME = 'muf-ri-editor';
  const STORE = 'drafts';
  const CURRENT_KEY = 'current';
  let db = null;

  function open() {
    return new Promise((resolve, reject) => {
      if (db) return resolve(db);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = e => e.target.result.createObjectStore(STORE);
      req.onsuccess = e => { db = e.target.result; resolve(db); };
      req.onerror = e => reject(e.target.error);
    });
  }

  async function save(data) {
    const store = (await open()).transaction(STORE, 'readwrite').objectStore(STORE);
    return new Promise((res, rej) => {
      const req = store.put({ ...data, savedAt: new Date().toISOString() }, CURRENT_KEY);
      req.onsuccess = () => res();
      req.onerror = e => rej(e.target.error);
    });
  }

  async function load() {
    const store = (await open()).transaction(STORE, 'readonly').objectStore(STORE);
    return new Promise((res, rej) => {
      const req = store.get(CURRENT_KEY);
      req.onsuccess = e => res(e.target.result || null);
      req.onerror = e => rej(e.target.error);
    });
  }

  async function clear() {
    const store = (await open()).transaction(STORE, 'readwrite').objectStore(STORE);
    return new Promise((res, rej) => {
      const req = store.delete(CURRENT_KEY);
      req.onsuccess = () => res();
      req.onerror = e => rej(e.target.error);
    });
  }

  return { save, load, clear };
})();
