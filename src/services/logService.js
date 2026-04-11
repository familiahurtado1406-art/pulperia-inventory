import { LOCAL_STORES, getAllStoreItems, putStoreItem } from "./localDB";

const createLogId = () => `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export const logAction = async (action) => {
  const logEntry = {
    id: createLogId(),
    createdAt: Date.now(),
    ...action,
  };

  await putStoreItem(LOCAL_STORES.logs, logEntry);
  return logEntry;
};

export const getLogs = async () => {
  const logs = await getAllStoreItems(LOCAL_STORES.logs);
  return logs.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
};
