import { LOCAL_STORES, putStoreItem } from "./localDB";
import { logAction } from "./logService";
import { addOperation } from "./queueService";

const createReceiptId = () =>
  `receipt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export const savePendingReceipt = async (payload) => {
  const record = {
    ...payload,
    id: payload.id || createReceiptId(),
    synced: false,
    createdAt: payload.createdAt || Date.now(),
  };

  await putStoreItem(LOCAL_STORES.movements, record);
  await addOperation({
    type: "RECEIVE_ORDER",
    data: record,
  });
  await logAction({
    type: "RECEIPT_QUEUED",
    receiptId: record.id,
    items: Array.isArray(record.receivedItems) ? record.receivedItems.length : 0,
  });

  return record;
};
