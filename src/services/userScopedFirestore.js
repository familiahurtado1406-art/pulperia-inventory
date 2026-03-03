import { collection, doc } from "firebase/firestore";
import { auth, db } from "../firebase/config";

const requireUid = () => {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Usuario no autenticado");
  return uid;
};

export const userCollection = (collectionName) =>
  collection(db, "users", requireUid(), collectionName);

export const userDoc = (collectionName, docId) =>
  doc(db, "users", requireUid(), collectionName, docId);

export const userSubcollection = (collectionName, docId, subcollectionName) =>
  collection(db, "users", requireUid(), collectionName, docId, subcollectionName);
