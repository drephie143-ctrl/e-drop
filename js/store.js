// Projects live on the phone, in IndexedDB. Songs are notes and settings only (parts are
// re-rendered from them), so a whole song is a few kilobytes.
const DB = 'e-drop';
let dbp = null;

function db() {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore('projects', { keyPath: 'id' });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  return dbp;
}

async function run(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction('projects', mode);
    const req = fn(t.objectStore('projects'));
    t.oncomplete = () => res(req ? req.result : undefined);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}

export const saveProject = (p) => run('readwrite', (s) => s.put(p));
export const getProject = (id) => run('readonly', (s) => s.get(id));
export const deleteProject = (id) => run('readwrite', (s) => s.delete(id));
export async function listProjects() {
  const all = (await run('readonly', (s) => s.getAll())) || [];
  return all.sort((a, b) => b.updated - a.updated);
}

export async function askPersistent() {
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch { /* optional */ }
}
