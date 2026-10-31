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

/**
 * Ask the browser to keep the game's storage even when the disk runs low
 * (by default site data is "best effort" and can be cleared without
 * asking). Chrome decides by itself; Firefox may ask the player.
 */
export async function keepStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

const FILE_FORMAT = 'survivalcrafter-save';

/** Download a save as a file (gzip-compressed where the browser can). */
export async function downloadSave(data: unknown, name: string): Promise<void> {
  const json = JSON.stringify({ format: FILE_FORMAT, exported: new Date().toISOString(), data });
  let blob = new Blob([json], { type: 'application/json' });
  let ext = 'json';
  if (typeof CompressionStream !== 'undefined') {
    blob = await new Response(blob.stream().pipeThrough(new CompressionStream('gzip'))).blob();
    ext = 'json.gz';
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}.${ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

/** Read a save file made by `downloadSave` (compressed or not). Throws if it isn't one. */
export async function readSaveFile(file: File): Promise<unknown> {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  const gzip = head[0] === 0x1f && head[1] === 0x8b;
  const text = gzip ? await new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).text() : await file.text();
  const obj = JSON.parse(text);
  if (obj?.format !== FILE_FORMAT || typeof obj.data !== 'object' || !obj.data?.world || !obj.data?.player) {
    throw new Error('That file is not a Survivalcrafter save.');
  }
  return obj.data;
}
