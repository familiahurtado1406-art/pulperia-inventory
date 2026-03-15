import { getDocs, onSnapshot, query, where } from "firebase/firestore";
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

export const subscribeActiveProducts = (callback) =>
  subscribeUserCollection("products", callback, where("activo", "==", true));

export const fetchActiveProducts = async () => {
  const snapshot = await getDocs(query(userCollection("products"), where("activo", "==", true)));
  return mapSnapshotDocs(snapshot);
};
