import { updateDoc } from "firebase/firestore";
import { registerInventoryChange } from "./inventoryHistoryService";
import { syncProductMetrics } from "./productMetricsService";
import { userDoc } from "./userScopedFirestore";

export const commitQueuedCountBatch = async (batchPayload) => {
  const updatesById = {};

  for (const item of batchPayload.items || []) {
    await updateDoc(userDoc(item.targetCollection || "products", item.productId), {
      stockBase: Number(item.stockNuevo || 0),
      stockActual: Number(item.stockNuevo || 0),
    });

    await registerInventoryChange({
      product: item.product,
      tipoMovimiento: "conteo",
      stockAnterior: Number(item.stockAnterior || 0),
      stockNuevo: Number(item.stockNuevo || 0),
    });

    updatesById[item.productId] = Number(item.stockNuevo || 0);
  }

  const productIdsToSync = Object.keys(updatesById);
  if (productIdsToSync.length > 0) {
    await syncProductMetrics({ productIds: productIdsToSync });
  }
};
