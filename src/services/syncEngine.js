import { logAction } from "./logService";
import { commitQueuedCountBatch } from "./countSyncService";
import { commitQueuedSale } from "./posSalesSyncService";
import {
  getPendingOperations,
  markOperationDone,
  markOperationFailed,
} from "./queueService";
import { commitQueuedReceipt } from "./receiptSyncService";
import { removePendingSale } from "./salesService";

const runOperation = async (operation) => {
  if (operation.type === "CREATE_SALE") {
    await commitQueuedSale(operation.data);
    await removePendingSale(operation.data?.id);
    return;
  }

  if (operation.type === "COUNT_BATCH") {
    await commitQueuedCountBatch(operation.data);
    return;
  }

  if (operation.type === "RECEIVE_ORDER") {
    await commitQueuedReceipt(operation.data);
    return;
  }

  throw new Error(`Tipo de operacion no soportado: ${operation.type}`);
};

export const runSync = async () => {
  const pendingOperations = await getPendingOperations();

  for (const operation of pendingOperations) {
    try {
      await runOperation(operation);
      await markOperationDone(operation);
      await logAction({
        type: "SYNC_DONE",
        operationType: operation.type,
        operationId: operation.id,
      });
    } catch (error) {
      await markOperationFailed(operation, error?.message || "Error de sincronizacion");
      await logAction({
        type: "SYNC_RETRY",
        operationType: operation.type,
        operationId: operation.id,
        error: error?.message || "Error de sincronizacion",
      });
    }
  }
};
