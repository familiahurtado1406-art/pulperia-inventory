import {
  addDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { userCollection } from "./userScopedFirestore";

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
          userCollection(name),
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
            getDocs(
              query(
                userCollection(name),
                where("productDocId", "==", productDocId),
                where("activo", "==", true)
              )
            )
          )
        )
      : Promise.resolve([]),
    productoId
      ? Promise.all(
          COLLECTIONS.map((name) =>
            getDocs(
              query(
                userCollection(name),
                where("productoId", "==", productoId),
                where("activo", "==", true)
              )
            )
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
  preferido,
  activo = true,
}) => {
  if (!productDocId || !proveedorId) return;

  const existingSnapshot = await getDocs(
    query(
      userCollection("proveedor_producto"),
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
    activo,
    updatedAt: serverTimestamp(),
  };
  if (preferido !== undefined) {
    payload.preferido = !!preferido;
  }

  if (!existingSnapshot.empty) {
    await updateDoc(existingSnapshot.docs[0].ref, payload);
    return;
  }

  await addDoc(userCollection("proveedor_producto"), {
    ...payload,
    createdAt: serverTimestamp(),
  });
};

export const deactivateProviderProductLink = async ({
  productDocId,
  productoId,
  proveedorId,
}) => {
  if (!proveedorId || (!productDocId && !productoId)) return;

  const snapshots = await Promise.all(
    COLLECTIONS.map((collectionName) => {
      const filters = [where("proveedorId", "==", proveedorId)];
      if (productDocId) filters.push(where("productDocId", "==", productDocId));
      else filters.push(where("productoId", "==", productoId));
      return getDocs(query(userCollection(collectionName), ...filters));
    })
  );

  const updates = snapshots
    .flatMap((snapshot) => snapshot.docs)
    .map((docItem) =>
      updateDoc(docItem.ref, {
        activo: false,
        updatedAt: serverTimestamp(),
      })
    );

  await Promise.all(updates);
};

export const setPreferredProviderProductLink = async ({
  productDocId,
  productoId,
  proveedorId,
}) => {
  if (!proveedorId || (!productDocId && !productoId)) return;

  const snapshots = await Promise.all(
    COLLECTIONS.map((collectionName) => {
      if (productDocId) {
        return getDocs(
          query(userCollection(collectionName), where("productDocId", "==", productDocId))
        );
      }
      return getDocs(query(userCollection(collectionName), where("productoId", "==", productoId)));
    })
  );

  const updates = snapshots.flatMap((snapshot) =>
    snapshot.docs.map((docItem) =>
      updateDoc(docItem.ref, {
        preferido: String(docItem.data().proveedorId || "") === String(proveedorId),
        updatedAt: serverTimestamp(),
      })
    )
  );

  await Promise.all(updates);
};
