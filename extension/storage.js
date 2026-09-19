let connection;
export function database() {
  return connection ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('clair-local-session', 1);
    request.onupgradeneeded = () => {
      for (const name of ['session', 'segments', 'clips', 'chunks']) request.result.createObjectStore(name);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function transaction(store, mode, action) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = action(tx.objectStore(store));
    tx.oncomplete = () => resolve(request?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Stockage interrompu.'));
  });
}
export const put = (store, key, value) => transaction(store, 'readwrite', object => object.put(value, key));
export const get = (store, key) => transaction(store, 'readonly', object => object.get(key));
export const all = store => transaction(store, 'readonly', object => object.getAll());
export const remove = (store, key) => transaction(store, 'readwrite', object => object.delete(key));
export async function clearSession() {
  const db = await database();
  await new Promise((resolve, reject) => {
    const stores = ['session', 'segments', 'clips', 'chunks'];
    const tx = db.transaction(stores, 'readwrite');
    stores.forEach(name => tx.objectStore(name).clear());
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
