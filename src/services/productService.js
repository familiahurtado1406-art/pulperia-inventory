import { db } from "../firebase/config";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";

const userCollectionByUid = (uid, collectionName) => collection(db, "users", uid, collectionName);
const userDocByUid = (uid, collectionName, docId) => doc(db, "users", uid, collectionName, docId);

export const addProduct = async (uid, productData) => {
  try {
    const productosRef = userCollectionByUid(uid, "products");

    const docRef = await addDoc(productosRef, {
      ...productData,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    return docRef.id;
  } catch (error) {
    console.error("Error agregando producto:", error);
    throw error;
  }
};

export const deleteProduct = async (uid, productId) => {
  try {
    await deleteDoc(userDocByUid(uid, "products", productId));
  } catch (error) {
    console.error("Error eliminando producto:", error);
    throw error;
  }
};

export const updateInventoryCount = async (
  uid,
  productId,
  cantidadContada,
  factorConversion
) => {
  const productRef = userDocByUid(uid, "products", productId);
  const stockBase = Number(cantidadContada) * Number(factorConversion || 1);

  await updateDoc(productRef, {
    stockBase,
    updatedAt: serverTimestamp(),
  });
};

export const getProviderRouteProductIds = async (uid, proveedorRutaId) => {
  const snapshot = await getDocs(userCollectionByUid(uid, "proveedor_producto"));

  const allRelations = snapshot.docs.map((relDoc) => relDoc.data());

  return allRelations
    .filter((rel) => {
      const relProveedorId = rel.proveedorRutaId || rel.proveedorId;
      const isAvailable = rel.disponible !== false && rel.activo !== false;
      return relProveedorId === proveedorRutaId && isAvailable;
    })
    .map((rel) => rel.productoId || rel.productDocId);
};

export const getProviderRoutes = async (uid) => {
  const routesRef = query(userCollectionByUid(uid, "proveedores"), where("activo", "!=", false));
  const snapshot = await getDocs(routesRef);

  return snapshot.docs.map((routeDoc) => ({
    id: routeDoc.id,
    ...routeDoc.data(),
  }));
};
