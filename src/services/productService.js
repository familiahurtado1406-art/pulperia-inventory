import { db } from "../firebase/config";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";

export const addProduct = async (uid, productData) => {
  try {
    const productosRef = collection(db, "negocios", uid, "productos");

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
    await deleteDoc(doc(db, "negocios", uid, "productos", productId));
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
  const productRef = doc(db, "negocios", uid, "productos", productId);
  const stockBase = Number(cantidadContada) * Number(factorConversion || 1);

  await updateDoc(productRef, {
    stockBase,
    updatedAt: serverTimestamp(),
  });
};

export const getProviderRouteProductIds = async (uid, proveedorRutaId) => {
  const [businessSnapshot, rootSnapshot] = await Promise.all([
    getDocs(collection(db, "negocios", uid, "proveedorProducto")),
    getDocs(collection(db, "proveedorProducto")),
  ]);

  const allRelations = [...businessSnapshot.docs, ...rootSnapshot.docs].map(
    (relDoc) => relDoc.data()
  );

  return allRelations
    .filter((rel) => {
      const relProveedorId = rel.proveedorRutaId || rel.proveedorId;
      const isAvailable = rel.disponible !== false;
      return relProveedorId === proveedorRutaId && isAvailable;
    })
    .map((rel) => rel.productoId);
};

export const getProviderRoutes = async () => {
  const routesRef = collection(db, "proveedores");
  const snapshot = await getDocs(routesRef);

  return snapshot.docs.map((routeDoc) => ({
    id: routeDoc.id,
    ...routeDoc.data(),
  })).filter((route) => route.activo !== false);
};
