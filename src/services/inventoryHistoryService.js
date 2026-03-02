import {
  Timestamp,
  addDoc,
  collection,
  getDocs,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { auth, db } from "../firebase/config";

export const getStockBaseValue = (product) =>
  Number(product?.stockBase ?? product?.stockUnidades ?? product?.stockActual ?? 0);

const getProductoId = (product) => product?.productoId || product?.id || "";

const getUsuarioActual = () =>
  auth.currentUser?.displayName || auth.currentUser?.email || auth.currentUser?.uid || "sistema";

export const registerInventoryChange = async ({
  product,
  tipoMovimiento,
  stockAnterior,
  stockNuevo,
  referenciaId = null,
}) => {
  const previous = Number(stockAnterior || 0);
  const next = Number(stockNuevo || 0);

  await addDoc(collection(db, "historial_cambios"), {
    productoId: getProductoId(product),
    nombreProducto: product?.nombre || "",
    tipoMovimiento,
    stockAnterior: previous,
    stockNuevo: next,
    diferencia: Number((next - previous).toFixed(4)),
    usuario: getUsuarioActual(),
    fecha: serverTimestamp(),
    referenciaId,
  });
};

export const getWeeklyRotationByProduct = async (days = 7) => {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - Number(days || 7));

  const historyQuery = query(
    collection(db, "historial_cambios"),
    where("fecha", ">=", Timestamp.fromDate(startDate))
  );
  const snapshot = await getDocs(historyQuery);

  const soldByProduct = {};

  snapshot.forEach((docItem) => {
    const movement = docItem.data();
    if (movement.tipoMovimiento !== "conteo") return;
    const difference = Number(movement.diferencia || 0);
    if (difference >= 0) return;
    const productId = String(movement.productoId || "");
    if (!productId) return;

    soldByProduct[productId] = Number(soldByProduct[productId] || 0) + Math.abs(difference);
  });

  const rotationByProduct = {};
  Object.keys(soldByProduct).forEach((productId) => {
    rotationByProduct[productId] = Number((soldByProduct[productId] / days).toFixed(4));
  });

  return rotationByProduct;
};
