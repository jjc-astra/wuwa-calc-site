// A tiny key/value store on IndexedDB, for cached data too big for localStorage (e.g. a full
// calc's evaluated rows). Every failure -- private browsing, blocked storage, a version race --
// resolves to "nothing stored" / a skipped write: callers treat it as a cache, never as the
// only copy of anything.
const DB_NAME = 'wuwa-calc';
const DB_VERSION = 1;
// Every store the app uses, since stores can only be created while opening a new DB version.
const STORES = ['guide-cache'] as const;
type StoreName = typeof STORES[number];

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      STORES.forEach(name => { if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name); });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch(err => {
    dbPromise = null;
    throw err;
  });
  return dbPromise;
}

function request<T>(store: StoreName, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T | undefined> {
  return openDb()
    .then(db => new Promise<T | undefined>((resolve, reject) => {
      const req = run(db.transaction(store, mode).objectStore(store));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
    }))
    .catch(err => {
      console.warn(`[idbStore] ${mode} on "${store}" failed.`, err);
      return undefined;
    });
}

export const idbGet = <T>(store: StoreName, key: string): Promise<T | undefined> =>
  request<T>(store, 'readonly', s => s.get(key));

export const idbPut = (store: StoreName, key: string, value: unknown): Promise<void> =>
  request<void>(store, 'readwrite', s => s.put(value, key)).then(() => undefined);
