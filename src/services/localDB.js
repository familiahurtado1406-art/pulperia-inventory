import { openDB } from "idb";

const DB_NAME = "pulperia-db";
const DB_VERSION = 2;

export const LOCAL_STORES = {
  products: "products",
  pendingSales: "pending_sales",
  operations: "operations",
  logs: "logs",
  movements: "movements",
  providers: "providers",
  counts: "counts",
};

export const dbPromise = openDB(DB_NAME, DB_VERSION, {
  upgrade(db) {
    if (!db.objectStoreNames.contains(LOCAL_STORES.products)) {
      db.createObjectStore(LOCAL_STORES.products, { keyPath: "id" });
    }

    if (!db.objectStoreNames.contains(LOCAL_STORES.pendingSales)) {
      const pendingSalesStore = db.createObjectStore(LOCAL_STORES.pendingSales, {
        keyPath: "id",
      });
      pendingSalesStore.createIndex("byCreatedAt", "createdAt");
    }

    if (!db.objectStoreNames.contains(LOCAL_STORES.operations)) {
      const operationsStore = db.createObjectStore(LOCAL_STORES.operations, { keyPath: "id" });
      operationsStore.createIndex("byStatus", "status");
      operationsStore.createIndex("byCreatedAt", "createdAt");
    }

    if (!db.objectStoreNames.contains(LOCAL_STORES.logs)) {
      const logsStore = db.createObjectStore(LOCAL_STORES.logs, { keyPath: "id" });
      logsStore.createIndex("byCreatedAt", "createdAt");
    }

    if (!db.objectStoreNames.contains(LOCAL_STORES.movements)) {
      db.createObjectStore(LOCAL_STORES.movements, { keyPath: "id" });
    }

    if (!db.objectStoreNames.contains(LOCAL_STORES.providers)) {
      db.createObjectStore(LOCAL_STORES.providers, { keyPath: "id" });
    }

    if (!db.objectStoreNames.contains(LOCAL_STORES.counts)) {
      db.createObjectStore(LOCAL_STORES.counts, { keyPath: "id" });
    }
  },
});

export const replaceStoreItems = async (storeName, items) => {
  const db = await dbPromise;
  const tx = db.transaction(storeName, "readwrite");
  await tx.store.clear();
  for (const item of items) {
    await tx.store.put(item);
  }
  await tx.done;
};

export const getAllStoreItems = async (storeName) => {
  const db = await dbPromise;
  return db.getAll(storeName);
};

export const putStoreItem = async (storeName, item) => {
  const db = await dbPromise;
  return db.put(storeName, item);
};

export const deleteStoreItem = async (storeName, key) => {
  const db = await dbPromise;
  return db.delete(storeName, key);
};
