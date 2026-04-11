import { LOCAL_STORES, deleteStoreItem, getAllStoreItems, putStoreItem } from "./localDB";
import { logAction } from "./logService";
import { addOperation } from "./queueService";

const createPendingSaleId = () =>
  `pending_sale_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export const savePendingSale = async (sale) => {
  const pendingSale = {
    ...sale,
    id: sale.id || createPendingSaleId(),
    synced: false,
    createdAt: sale.createdAt || Date.now(),
  };

  await putStoreItem(LOCAL_STORES.pendingSales, pendingSale);
  await addOperation({
    type: "CREATE_SALE",
    data: pendingSale,
  });
  await logAction({
    type: "SALE_QUEUED",
    saleId: pendingSale.id,
    total: pendingSale.totalSale,
  });
  return pendingSale;
};

export const getPendingSales = async () => {
  const sales = await getAllStoreItems(LOCAL_STORES.pendingSales);
  return sales.sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
};

export const removePendingSale = async (saleId) => {
  await deleteStoreItem(LOCAL_STORES.pendingSales, saleId);
};
