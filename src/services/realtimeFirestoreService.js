import { getDocs, onSnapshot, query, where } from "firebase/firestore";
import { LOCAL_STORES, getAllStoreItems, replaceStoreItems } from "./localDB";
import { userCollection } from "./userScopedFirestore";

const mapSnapshotDocs = (snapshot) =>
  snapshot.docs.map((docItem) => ({
    id: docItem.id,
    ...docItem.data(),
  }));

export const subscribeUserCollection = (collectionName, callback, ...constraints) => {
  const ref =
    constraints.length > 0
      ? query(userCollection(collectionName), ...constraints)
      : userCollection(collectionName);

  return onSnapshot(ref, (snapshot) => {
    callback(mapSnapshotDocs(snapshot));
  });
};

export const subscribeProviders = (callback) =>
  subscribeUserCollection("proveedores", async (providers) => {
    await replaceStoreItems(LOCAL_STORES.providers, providers);
    callback(providers);
  });

export const subscribeActiveProducts = (callback) =>
  subscribeUserCollection("products", async (products) => {
    await replaceStoreItems(LOCAL_STORES.products, products);
    callback(products);
  }, where("activo", "==", true));

export const fetchActiveProducts = async () => {
  try {
    const snapshot = await getDocs(query(userCollection("products"), where("activo", "==", true)));
    const products = mapSnapshotDocs(snapshot);
    await replaceStoreItems(LOCAL_STORES.products, products);
    return products;
  } catch (error) {
    const cachedProducts = await getAllStoreItems(LOCAL_STORES.products);
    if (cachedProducts.length > 0) {
      return cachedProducts;
    }
    throw error;
  }
};

export const getCachedActiveProducts = async () => getAllStoreItems(LOCAL_STORES.products);

export const getCachedProviders = async () => getAllStoreItems(LOCAL_STORES.providers);
