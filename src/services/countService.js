import { LOCAL_STORES, putStoreItem } from "./localDB";
import { logAction } from "./logService";
import { addOperation } from "./queueService";

const createCountBatchId = () =>
  `count_batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export const savePendingCountBatch = async (payload) => {
  const record = {
    ...payload,
    id: payload.id || createCountBatchId(),
    synced: false,
    createdAt: payload.createdAt || Date.now(),
  };

  await putStoreItem(LOCAL_STORES.counts, record);
  await addOperation({
    type: "COUNT_BATCH",
    data: record,
  });
  await logAction({
    type: "COUNT_BATCH_QUEUED",
    countBatchId: record.id,
    items: Array.isArray(record.items) ? record.items.length : 0,
  });

  return record;
};
