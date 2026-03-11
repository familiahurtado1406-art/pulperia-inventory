import { addDoc, serverTimestamp } from "firebase/firestore";
import { userCollection } from "./userScopedFirestore";

export const createInventoryMovement = async ({
  productId,
  productoId,
  type,
  tipoMovimiento,
  cantidadBase,
  unidades,
  medidaBase,
  providerId = null,
  referenceId = null,
  source = null,
  priceUnit = null,
  total = null,
  variant = null,
}) => {
  return addDoc(userCollection("inventory_movements"), {
    productId: productId || productoId || "",
    productoId: productoId || productId || "",
    type: type || "",
    tipoMovimiento: tipoMovimiento || type || "",
    cantidadBase: Number(cantidadBase ?? unidades ?? 0),
    unidades: Number(unidades ?? cantidadBase ?? 0),
    medidaBase: medidaBase || "UN",
    providerId: providerId || null,
    referenceId: referenceId || null,
    source: source || null,
    priceUnit: priceUnit === null ? null : Number(priceUnit || 0),
    total: total === null ? null : Number(total || 0),
    variant: variant || null,
    createdAt: serverTimestamp(),
  });
};

