import { doc, increment, serverTimestamp, writeBatch } from "firebase/firestore";
import { db } from "../firebase/config";
import { registerInventoryChange } from "./inventoryHistoryService";
import { upsertProviderProductLink } from "./providerProductService";
import { userCollection, userDoc, userSubcollection } from "./userScopedFirestore";

export const commitQueuedReceipt = async (payload) => {
  const {
    selectedSupplier,
    supplierName,
    receivedItems,
    currentStockByProduct = {},
  } = payload;

  const batch = writeBatch(db);
  const movementItems = [];
  const historyTasks = [];
  const providerLinkTasks = [];
  const stockMap = { ...currentStockByProduct };

  for (const item of receivedItems || []) {
    const stockAnterior = Number(stockMap[item.productDocId] || 0);
    const cantidadBase = Number(item.cantidadBase || 0);
    const modoIngreso = item.modoIngresoInventario || "sumar";
    const stockNuevo =
      modoIngreso === "desde_cero" ? cantidadBase : stockAnterior + cantidadBase;

    const updatePayload = {
      unidadesUltimaCompra: Number(item.unidadesUltimaCompra),
      costoUnitarioBase: Number(item.costoUnitario),
      costoUnitario: Number(item.costoUnitario),
      ultimaActualizacion: serverTimestamp(),
    };
    if (modoIngreso === "desde_cero") {
      updatePayload.stockBase = Number(cantidadBase);
      updatePayload.stockActual = Number(cantidadBase);
    } else {
      updatePayload.stockBase = increment(cantidadBase);
      updatePayload.stockActual = increment(cantidadBase);
    }

    if (item.actualizarPrecio) {
      updatePayload.margen = Number(item.margen);
      updatePayload.precioVentaBase = Number(item.precioVentaUnidad);
      updatePayload.precioVentaUnidad = Number(item.precioVentaUnidad);
      updatePayload.gananciaUnidad = Number(item.gananciaUnidad);
      updatePayload.precioVenta = Number(item.precioVentaUnidad);
    }

    batch.update(userDoc("products", item.productDocId), updatePayload);

    const historialPrecioRef = doc(
      userSubcollection("products", item.productDocId, "historialPrecios")
    );
    batch.set(historialPrecioRef, {
      proveedorId: selectedSupplier,
      proveedorNombre: supplierName,
      costoUnitarioBase: Number(item.costoUnitario || 0),
      fecha: serverTimestamp(),
    });

    const priceHistoryRef = doc(userCollection("priceHistory"));
    batch.set(priceHistoryRef, {
      productId: item.productDocId,
      providerId: selectedSupplier,
      fecha: serverTimestamp(),
      costoUnitario: Number(item.costoUnitario || 0),
      cantidad: Number(item.cantidadBase || 0),
      ordenId: null,
    });

    const inventoryMovementRef = doc(userCollection("inventory_movements"));
    batch.set(inventoryMovementRef, {
      productId: item.productDocId,
      productoId: item.productDocId,
      type: "entrada",
      tipoMovimiento: "entrada_compra",
      cantidadBase: Number(item.cantidadBase || 0),
      unidades: Number(item.cantidadBase || 0),
      medidaBase: item.medidaBase || "UN",
      providerId: selectedSupplier,
      referenceId: null,
      source: "recibir_pedido",
      priceUnit: Number(item.costoUnitario || 0),
      total: Number(item.costoConImpuesto ?? item.totalFactura ?? 0),
      variant: null,
      createdAt: serverTimestamp(),
    });

    historyTasks.push(
      registerInventoryChange({
        product: {
          id: item.productDocId,
          productoId: item.productDocId,
          nombre: item.nombre,
        },
        tipoMovimiento: "recibir_pedido",
        stockAnterior,
        stockNuevo,
      })
    );

    providerLinkTasks.push(
      upsertProviderProductLink({
        productDocId: item.productDocId,
        productoId: item.productDocId,
        proveedorId: selectedSupplier,
        proveedorNombre: supplierName,
        costoUnitario: Number(item.costoUnitario || 0),
        costoPack: null,
        activo: true,
      })
    );

    stockMap[item.productDocId] = stockNuevo;
    movementItems.push({
      ...item,
      tipo: "entrada",
      detalle: item.detalleIngreso,
      unidades: cantidadBase,
      modo: modoIngreso,
      stockAnterior,
      stockNuevo,
      costoUnitario: Number(item.costoUnitario || 0),
    });
  }

  const movimientoRef = doc(userCollection("movimientos"));
  batch.set(movimientoRef, {
    type: "entrada",
    supplierId: selectedSupplier,
    items: movementItems,
    createdAt: serverTimestamp(),
  });

  await batch.commit();
  await Promise.allSettled([...historyTasks, ...providerLinkTasks]);
};
