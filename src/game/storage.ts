// Where saves live: the browser's IndexedDB, which holds hundreds of
// megabytes (localStorage, used before, only holds about five). Values are
// stored as they are, without turning them into text. If IndexedDB isn't
// available (some private windows), localStorage stands in.

const DB_NAME = 'survivalcrafter';
const STORE = 'saves';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function db(): Promise<IDBDatabase | null> {
  return dbPromise ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function request<T>(d: IDBDatabase, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, mode);
    const req = run(tx.objectStore(STORE));
    // Writes count once the transaction has committed, not just when the request succeeds.
    tx.oncomplete = () => resolve(req.result as T);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function readSave<T>(key: string): Promise<T | undefined> {
  const d = await db();
  if (!d) {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : undefined;
  }
  return request<T | undefined>(d, 'readonly', (s) => s.get(key));
}

export async function writeSave(key: string, value: unknown): Promise<void> {
  const d = await db();
  if (!d) { localStorage.setItem(key, JSON.stringify(value)); return; }
  await request(d, 'readwrite', (s) => s.put(value, key));
}

export async function deleteSave(key: string): Promise<void> {
  const d = await db();
  if (d) await request(d, 'readwrite', (s) => s.delete(key));
  try { localStorage.removeItem(key); } catch { /* unavailable */ }
}

export async function hasSaveAt(key: string): Promise<boolean> {
  const d = await db();
  if (!d) return !!localStorage.getItem(key);
  return (await request<number>(d, 'readonly', (s) => s.count(key))) > 0;
}

/** Move a save left in localStorage by an older version of the game into IndexedDB. */
export async function migrateSave(key: string): Promise<void> {
  let raw: string | null = null;
  try { raw = localStorage.getItem(key); } catch { return; }
  if (!raw) return;
  const d = await db();
  if (!d) return; // nowhere better to put it
  try {
    await writeSave(key, JSON.parse(raw));
    localStorage.removeItem(key);
  } catch (e) {
    console.warn('Could not move the save to IndexedDB; leaving it where it is', e);
  }
}
