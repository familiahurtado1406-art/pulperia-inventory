import { doc, increment, serverTimestamp, writeBatch } from "firebase/firestore";
import { db } from "../firebase/config";
import { getStockBaseValue, registerInventoryChange } from "./inventoryHistoryService";
import { syncProductMetrics } from "./productMetricsService";
import { userCollection, userDoc } from "./userScopedFirestore";

export const commitQueuedSale = async (salePayload) => {
  const {
    cart,
    saleItems,
    totalSale,
    paymentMethod,
    receivedCash,
    changeAmount,
    emitTicket,
    productSnapshots = [],
  } = salePayload;

  const productById = productSnapshots.reduce((acc, product) => {
    if (product?.id) {
      acc[product.id] = product;
    }
    return acc;
  }, {});

  const batch = writeBatch(db);
  const saleRef = doc(userCollection("sales"));
  batch.set(saleRef, {
    date: serverTimestamp(),
    total: Number(totalSale || 0),
    paymentMethod,
    cartId: cart?.id || null,
    cartLabel: cart?.label || null,
    receivedCash: paymentMethod === "cash" ? Number(receivedCash || 0) : null,
    change: paymentMethod === "cash" ? Number(changeAmount || 0) : null,
    emitTicket: Boolean(emitTicket),
    items: saleItems,
  });

  const movementItems = [];
  const historyTasks = [];
  for (const item of saleItems) {
    const product = productById[item.productId];
    const stockAnterior = Number(getStockBaseValue(product) || 0);
    const stockNuevo = Number((stockAnterior - Number(item.unidades || 0)).toFixed(4));

    batch.update(userDoc("products", item.productId), {
      stockBase: increment(-Number(item.unidades || 0)),
      stockActual: increment(-Number(item.unidades || 0)),
      ultimaActualizacion: serverTimestamp(),
    });

    if (product) {
      historyTasks.push(
        registerInventoryChange({
          product,
          tipoMovimiento: "venta_pos",
          stockAnterior,
          stockNuevo,
          referenciaId: saleRef.id,
        })
      );
    }

    movementItems.push({
      productDocId: item.productId,
      productoId: item.productoId,
      nombre: item.nombre,
      variant: item.variant,
      qty: item.qty,
      unidades: item.unidades,
      cantidadBase: item.cantidadBase,
      medidaBase: item.medidaBase,
      priceUnit: item.priceUnit,
      total: item.total,
    });

    const inventoryMovementRef = doc(userCollection("inventory_movements"));
    batch.set(inventoryMovementRef, {
      productId: item.productId,
      productoId: item.productoId,
      type: "salida",
      tipoMovimiento: "salida_venta",
      cantidadBase: Number(item.cantidadBase || 0),
      unidades: Number(item.unidades || 0),
      medidaBase: item.medidaBase,
      referenceId: saleRef.id,
      source: "pos",
      priceUnit: Number(item.priceUnit || 0),
      total: Number(item.total || 0),
      variant: item.variant || null,
      createdAt: serverTimestamp(),
    });
  }

  const movimientoRef = doc(userCollection("movimientos"));
  batch.set(movimientoRef, {
    type: "salida",
    createdAt: serverTimestamp(),
    saleId: saleRef.id,
    cartId: cart?.id || null,
    cartLabel: cart?.label || null,
    paymentMethod,
    total: Number(totalSale || 0),
    items: movementItems,
  });
  await batch.commit();

  const productIdsToSync = [
    ...new Set(saleItems.map((item) => String(item.productId || "")).filter(Boolean)),
  ];
  Promise.allSettled([
    ...historyTasks,
    syncProductMetrics({ productIds: productIdsToSync }),
  ]).then((historyResults) => {
    const hasHistoryErrors = historyResults.some((result) => result.status === "rejected");
    if (hasHistoryErrors) {
      console.error("Errores en historial de cambios de POS", { historyResults });
    }
  });

  return { saleId: saleRef.id };
};
