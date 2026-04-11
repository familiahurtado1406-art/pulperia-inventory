import { LOCAL_STORES, getAllStoreItems, putStoreItem } from "./localDB";

const createOperationId = () =>
  `op_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export const addOperation = async (operation) => {
  const queuedOperation = {
    id: operation.id || createOperationId(),
    status: "pending",
    retries: 0,
    createdAt: Date.now(),
    ...operation,
  };

  await putStoreItem(LOCAL_STORES.operations, queuedOperation);
  return queuedOperation;
};

export const getOperations = async () => getAllStoreItems(LOCAL_STORES.operations);

export const getPendingOperations = async () => {
  const operations = await getOperations();
  return operations
    .filter((operation) => operation.status === "pending")
    .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
};

export const updateOperation = async (operation) => {
  await putStoreItem(LOCAL_STORES.operations, operation);
  return operation;
};

export const markOperationDone = async (operation) =>
  updateOperation({
    ...operation,
    status: "done",
    syncedAt: Date.now(),
  });

export const markOperationFailed = async (operation, errorMessage) =>
  updateOperation({
    ...operation,
    status: "pending",
    retries: Number(operation.retries || 0) + 1,
    lastError: errorMessage || null,
    lastTriedAt: Date.now(),
  });
