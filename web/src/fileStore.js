// حفظ ملفات طلبات التصميم في السلة داخل المتصفح (IndexedDB) حتى لا تضيع عند تحديث الصفحة
const DB = 'av-cart-files';
const STORE = 'files';

function open() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function run(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); resolve(req?.result); };
    t.onerror = () => { db.close(); reject(t.error); };
  });
}

/** files: [{ file: File, kind }] */
export async function putFiles(key, files) {
  try { await run('readwrite', (s) => s.put(files, key)); return true; } catch { return false; }
}
export async function getFiles(key) {
  try { return (await run('readonly', (s) => s.get(key))) || []; } catch { return []; }
}
export async function delFiles(key) {
  try { await run('readwrite', (s) => s.delete(key)); } catch { /* ignore */ }
}
