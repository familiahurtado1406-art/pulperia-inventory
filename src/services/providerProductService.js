import {
  addDoc,
  collection,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "../firebase/config";

const COLLECTIONS = ["proveedor_producto", "proveedorProducto"];

const normalizeLink = (docItem) => ({
  id: docItem.id,
  ...docItem.data(),
});

const mergeLinks = (links) => {
  const map = {};
  links.forEach((link) => {
    const productKey = String(link.productDocId || link.productoId || "");
    const providerKey = String(link.proveedorId || "");
    const key = `${productKey}__${providerKey}`;
    if (!productKey || !providerKey) return;
    map[key] = {
      ...map[key],
      ...link,
    };
  });
  return Object.values(map);
};

export const getProviderProductLinksByProvider = async (proveedorId) => {
  if (!proveedorId) return [];
  const snapshots = await Promise.all(
    COLLECTIONS.map((name) =>
      getDocs(
        query(
          collection(db, name),
          where("proveedorId", "==", proveedorId),
          where("activo", "==", true)
        )
      )
    )
  );

  const links = snapshots.flatMap((snapshot) => snapshot.docs.map(normalizeLink));
  return mergeLinks(links);
};

export const getProviderProductLinksByProduct = async ({ productDocId, productoId }) => {
  const [byDocSnapshots, byProductSnapshots] = await Promise.all([
    productDocId
      ? Promise.all(
          COLLECTIONS.map((name) =>
            getDocs(query(collection(db, name), where("productDocId", "==", productDocId)))
          )
        )
      : Promise.resolve([]),
    productoId
      ? Promise.all(
          COLLECTIONS.map((name) =>
            getDocs(query(collection(db, name), where("productoId", "==", productoId)))
          )
        )
      : Promise.resolve([]),
  ]);

  const links = [...byDocSnapshots.flat(), ...byProductSnapshots.flat()].flatMap((snapshot) =>
    snapshot.docs.map(normalizeLink)
  );

  return mergeLinks(links);
};

export const upsertProviderProductLink = async ({
  productDocId,
  productoId,
  proveedorId,
  proveedorNombre,
  costoUnitario,
  costoPack,
  promedioEntrega = null,
  activo = true,
}) => {
  if (!productDocId || !proveedorId) return;

  const existingSnapshot = await getDocs(
    query(
      collection(db, "proveedor_producto"),
      where("productDocId", "==", productDocId),
      where("proveedorId", "==", proveedorId)
    )
  );

  const payload = {
    productDocId,
    productoId: productoId || productDocId,
    proveedorId,
    proveedorNombre: proveedorNombre || proveedorId,
    costoUnitario: Number(costoUnitario || 0),
    costoPack: costoPack === null || costoPack === undefined ? null : Number(costoPack || 0),
    promedioEntrega:
      promedioEntrega === null || promedioEntrega === undefined
        ? null
        : Number(promedioEntrega || 0),
    activo,
    updatedAt: serverTimestamp(),
  };

  if (!existingSnapshot.empty) {
    await updateDoc(existingSnapshot.docs[0].ref, payload);
    return;
  }

  await addDoc(collection(db, "proveedor_producto"), {
    ...payload,
    createdAt: serverTimestamp(),
  });
};
