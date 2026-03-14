import {
  Timestamp,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "../firebase/config";
import { getStockBaseValue } from "./inventoryHistoryService";
import { userCollection, userDoc } from "./userScopedFirestore";

const LOOKBACK_7_DAYS = 7;
const LOOKBACK_30_DAYS = 30;
const LOOKBACK_60_DAYS = 60;

const toMillis = (value) => {
  if (!value) return 0;
  if (typeof value === "string") {
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (value?.toMillis) return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return 0;
};

const classifyTrend = (currentAvg, previousAvg, totalWindowSales) => {
  if (Number(totalWindowSales || 0) < 5) return "sin_datos";
  if (previousAvg <= 0) return currentAvg > 0 ? "subiendo" : "sin_datos";
  const ratio = currentAvg / previousAvg;
  if (ratio > 1.2) return "subiendo";
  if (ratio < 0.8) return "bajando";
  return "estable";
};

const classifyInventoryProduct = ({ movement7, movement60, productAgeDays }) => {
  if (productAgeDays >= 60 && movement60 === 0) return "muerto";
  if (movement7 < 1) return "lento";
  if (movement7 > 5) return "estrella";
  return "normal";
};

const getCoverageDays = (classification) => {
  if (classification === "estrella") return 7;
  if (classification === "lento") return 21;
  if (classification === "muerto") return 0;
  return 14;
};

const classifyStockAlert = (days) => {
  if (!Number.isFinite(days)) return "sin_ventas";
  if (days >= 15) return "ok";
  if (days >= 7) return "advertencia";
  return "urgente";
};

const getEmptyMovementStats = () => ({
  real7: 0,
  real30: 0,
  inferred7: 0,
  inferred30: 0,
  total7: 0,
  total30: 0,
  total60: 0,
  current7Total: 0,
  previous7Total: 0,
  current7Real: 0,
  previous7Real: 0,
});

const buildMetricsForProduct = (product, movementStats, now) => {
  const createdMillis = toMillis(product.createdAt || product.fechaCreacion || product.fechaAlta);
  const productAgeDays =
    createdMillis > 0
      ? Math.max(1, Math.ceil((now - createdMillis) / (1000 * 60 * 60 * 24)))
      : LOOKBACK_30_DAYS;
  const averageDays = Math.max(1, Math.min(LOOKBACK_30_DAYS, productAgeDays));

  const promedioDiario = Number((movementStats.total30 / averageDays).toFixed(4));
  const ventasSemana = Number((promedioDiario * 7).toFixed(4));
  const clasificacion = classifyInventoryProduct({
    movement7: movementStats.total7,
    movement60: movementStats.total60,
    productAgeDays,
  });
  const diasCobertura = getCoverageDays(clasificacion);
  const stockActual = Number(getStockBaseValue(product) || 0);
  const stockObjetivo = Math.round(promedioDiario * diasCobertura);
  const stockMinimo = Math.round(stockObjetivo * 0.4);
  const pedidoSugerido = Math.max(stockObjetivo - stockActual, 0);
  const diasInventario =
    promedioDiario > 0 ? Number((stockActual / promedioDiario).toFixed(2)) : null;
  const tendencia = classifyTrend(
    Number((movementStats.current7Real / 7).toFixed(4)),
    Number((movementStats.previous7Real / 7).toFixed(4)),
    movementStats.real30
  );
  const gananciaUnidad = Number(product.gananciaUnidad || 0);
  const rentabilidadMensual = Number((movementStats.real30 * gananciaUnidad).toFixed(2));
  const capitalInvertido = Number(
    (
      stockActual *
      Number(product.costoUnitarioBase ?? product.costoUnitario ?? 0)
    ).toFixed(2)
  );

  return {
    productId: product.id,
    productoId: String(product.productoId || product.id),
    nombre: product.nombre || product.id,
    stockBase: stockActual,
    stockActual,
    stockObjetivo,
    stockMin: stockMinimo,
    stockMinimo,
    pedidoSugerido: Number(pedidoSugerido.toFixed(2)),
    promedioDiario: Number(promedioDiario.toFixed(2)),
    ventasSemana: Number(ventasSemana.toFixed(2)),
    ventasReales7dias: Number(movementStats.real7.toFixed(2)),
    ventasReales30dias: Number(movementStats.real30.toFixed(2)),
    salidasInferidas7dias: Number(movementStats.inferred7.toFixed(2)),
    salidasInferidas30dias: Number(movementStats.inferred30.toFixed(2)),
    movimientoTotal7dias: Number(movementStats.total7.toFixed(2)),
    movimientoTotal30dias: Number(movementStats.total30.toFixed(2)),
    ventas30dias: Number(movementStats.total30.toFixed(2)),
    rotacionSemanal: Number(movementStats.total7.toFixed(2)),
    rotacionMensual: Number(movementStats.total30.toFixed(2)),
    promedioSemanaActual: Number((movementStats.current7Total / 7).toFixed(2)),
    promedioSemanaAnterior: Number((movementStats.previous7Total / 7).toFixed(2)),
    promedioSemanaActualReal: Number((movementStats.current7Real / 7).toFixed(2)),
    promedioSemanaAnteriorReal: Number((movementStats.previous7Real / 7).toFixed(2)),
    clasificacion,
    tipoRotacion: clasificacion,
    diasCobertura,
    diasInventario,
    diasStockRestantes: diasInventario,
    nivelStock: classifyStockAlert(diasInventario),
    tendencia,
    stockRecomendado: Number(stockObjetivo.toFixed(2)),
    cantidadComprar: Number(pedidoSugerido.toFixed(2)),
    rentabilidadMensual,
    capitalInvertido,
    updatedAt: serverTimestamp(),
  };
};

const buildOverviewFromMetrics = (metricsDocs) => {
  const productosAnalizados = [...metricsDocs];
  const topRotacion = [...metricsDocs]
    .filter((item) => Number(item.ventasReales7dias || 0) > 0)
    .sort((a, b) => Number(b.ventasReales7dias || 0) - Number(a.ventasReales7dias || 0))
    .slice(0, 10);
  const topRentabilidad = [...metricsDocs]
    .filter((item) => Number(item.ventasReales30dias || 0) > 0)
    .sort((a, b) => Number(b.rentabilidadMensual || 0) - Number(a.rentabilidadMensual || 0))
    .slice(0, 10);
  const tendenciaCreciente = [...metricsDocs]
    .filter((item) => item.tendencia === "subiendo")
    .sort(
      (a, b) =>
        Number(b.promedioSemanaActualReal || 0) - Number(a.promedioSemanaActualReal || 0)
    )
    .slice(0, 10);
  const tendenciaDecreciente = [...metricsDocs]
    .filter((item) => item.tendencia === "bajando")
    .sort(
      (a, b) =>
        Number(b.promedioSemanaAnteriorReal || 0) - Number(a.promedioSemanaAnteriorReal || 0)
    )
    .slice(0, 10);
  const tendenciaEstable = [...metricsDocs]
    .filter((item) => item.tendencia === "estable")
    .sort((a, b) => Number(b.ventasReales7dias || 0) - Number(a.ventasReales7dias || 0))
    .slice(0, 10);
  const bajaRotacion = [...metricsDocs]
    .filter((item) => item.clasificacion === "lento")
    .sort((a, b) => Number(a.movimientoTotal7dias || 0) - Number(b.movimientoTotal7dias || 0))
    .slice(0, 10);
  const inventarioMuerto = [...metricsDocs]
    .filter((item) => item.clasificacion === "muerto")
    .slice(0, 10);
  const stockObjetivoSugerido = [...metricsDocs]
    .filter((item) => Number(item.cantidadComprar || 0) > 0)
    .sort((a, b) => Number(b.cantidadComprar || 0) - Number(a.cantidadComprar || 0))
    .slice(0, 10);

  const inversionInventarioTotal = metricsDocs.reduce(
    (acc, item) => acc + Number(item.capitalInvertido || 0),
    0
  );
  const productosCalientes = metricsDocs.filter((item) => item.clasificacion === "estrella").length;
  const productosSellThroughLento = metricsDocs.filter((item) => item.clasificacion === "lento").length;
  const ventasDiariasTotales = metricsDocs.reduce(
    (acc, item) => acc + Number(item.promedioDiario || 0),
    0
  );
  const stockTotal = metricsDocs.reduce((acc, item) => acc + Number(item.stockBase || 0), 0);
  const diasInventarioPromedio =
    ventasDiariasTotales > 0 ? Number((stockTotal / ventasDiariasTotales).toFixed(2)) : null;

  return {
    productosAnalizados,
    topRotacion,
    bajaRotacion,
    inventarioMuerto,
    topRentabilidad,
    tendenciaCreciente,
    tendenciaDecreciente,
    tendenciaEstable,
    stockObjetivoSugerido,
    rankingProveedoresEntrega: [],
    ventasDiariasPorProducto: {},
    meta: {
      forecastDays: 5,
      daysCoverage: 14,
      lookbackDays: LOOKBACK_30_DAYS,
    },
    stats: {
      inversionInventarioTotal: Number(inversionInventarioTotal.toFixed(2)),
      diasInventarioPromedio,
      productosCalientesCount: productosCalientes,
      productosSellThroughLentoCount: productosSellThroughLento,
      topRotacionCount: topRotacion.length,
      bajaRotacionCount: bajaRotacion.length,
      inventarioMuertoCount: inventarioMuerto.length,
      topRentabilidadCount: topRentabilidad.length,
      tendenciaCrecienteCount: tendenciaCreciente.length,
      stockObjetivoSugeridoCount: stockObjetivoSugerido.length,
      proveedoresLentosCount: 0,
    },
  };
};

export const getProductMetricsOverview = async () => {
  const snapshot = await getDocs(userCollection("product_metrics"));
  const metricsDocs = snapshot.docs.map((docItem) => ({
    id: docItem.id,
    ...docItem.data(),
  }));
  if (metricsDocs.length === 0) return null;
  return buildOverviewFromMetrics(metricsDocs);
};

export const syncProductMetrics = async ({ productIds = null } = {}) => {
  const now = Date.now();
  const last60Date = new Date(now - LOOKBACK_60_DAYS * 24 * 60 * 60 * 1000);
  const productIdSet = Array.isArray(productIds) && productIds.length > 0
    ? new Set(productIds.map((id) => String(id)))
    : null;

  const [productsSnap, movementsSnap, historySnap] = await Promise.all([
    getDocs(userCollection("products")),
    getDocs(
      query(
        userCollection("inventory_movements"),
        where("createdAt", ">=", Timestamp.fromDate(last60Date))
      )
    ),
    getDocs(
      query(
        userCollection("historial_cambios"),
        where("fecha", ">=", Timestamp.fromDate(last60Date))
      )
    ),
  ]);

  const products = productsSnap.docs
    .map((docItem) => ({ id: docItem.id, ...docItem.data() }))
    .filter((product) => product.activo !== false)
    .filter((product) => !productIdSet || productIdSet.has(String(product.id)));

  const movementStatsByProduct = {};
  const ensureStats = (productId) => {
    if (!movementStatsByProduct[productId]) {
      movementStatsByProduct[productId] = getEmptyMovementStats();
    }
    return movementStatsByProduct[productId];
  };

  movementsSnap.docs.forEach((docItem) => {
    const movement = docItem.data();
    if (String(movement.type || "").toLowerCase() !== "salida") return;
    const productId = String(movement.productId || movement.productoId || "");
    if (!productId || (productIdSet && !productIdSet.has(productId))) return;

    const qty = Math.abs(
      Number(
        movement.unidades ??
          movement.cantidadBase ??
          movement.cantidad ??
          movement.qty ??
          0
      )
    );
    if (!Number.isFinite(qty) || qty <= 0) return;
    const movementMillis = toMillis(movement.createdAt || movement.fecha);
    const stats = ensureStats(productId);

    if (movementMillis >= now - LOOKBACK_7_DAYS * 24 * 60 * 60 * 1000) {
      stats.real7 += qty;
      stats.current7Real += qty;
      stats.current7Total += qty;
    } else if (movementMillis >= now - 14 * 24 * 60 * 60 * 1000) {
      stats.previous7Real += qty;
      stats.previous7Total += qty;
    }
    if (movementMillis >= now - LOOKBACK_30_DAYS * 24 * 60 * 60 * 1000) {
      stats.real30 += qty;
      stats.total30 += qty;
    }
    if (movementMillis >= now - LOOKBACK_7_DAYS * 24 * 60 * 60 * 1000) {
      stats.total7 += qty;
    }
    if (movementMillis >= now - LOOKBACK_60_DAYS * 24 * 60 * 60 * 1000) {
      stats.total60 += qty;
    }
  });

  historySnap.docs.forEach((docItem) => {
    const movement = docItem.data();
    if (movement.tipoMovimiento !== "conteo") return;
    const difference = Number(movement.diferencia || 0);
    if (difference >= 0) return;
    const productId = String(movement.productoId || "");
    if (!productId || (productIdSet && !productIdSet.has(productId))) return;

    const qty = Math.abs(difference);
    const movementMillis = toMillis(movement.fecha);
    const stats = ensureStats(productId);

    if (movementMillis >= now - LOOKBACK_7_DAYS * 24 * 60 * 60 * 1000) {
      stats.inferred7 += qty;
      stats.total7 += qty;
      stats.current7Total += qty;
    } else if (movementMillis >= now - 14 * 24 * 60 * 60 * 1000) {
      stats.previous7Total += qty;
    }
    if (movementMillis >= now - LOOKBACK_30_DAYS * 24 * 60 * 60 * 1000) {
      stats.inferred30 += qty;
      stats.total30 += qty;
    }
    if (movementMillis >= now - LOOKBACK_60_DAYS * 24 * 60 * 60 * 1000) {
      stats.total60 += qty;
    }
  });

  const metricsDocs = products.map((product) =>
    buildMetricsForProduct(product, ensureStats(String(product.id)), now)
  );

  for (let start = 0; start < metricsDocs.length; start += 200) {
    const batch = writeBatch(db);
    metricsDocs.slice(start, start + 200).forEach((metrics) => {
      batch.set(userDoc("product_metrics", metrics.productId), metrics);
      batch.update(userDoc("products", metrics.productId), {
        stockObjetivo: metrics.stockObjetivo,
        stockMin: metrics.stockMinimo,
        promedioDiario: metrics.promedioDiario,
        clasificacion: metrics.clasificacion,
        tipoRotacion: metrics.clasificacion,
        pedidoSugerido: metrics.pedidoSugerido,
        ventas30dias: metrics.ventas30dias,
        updatedAt: serverTimestamp(),
      });
    });
    await batch.commit();
  }

  return buildOverviewFromMetrics(metricsDocs);
};
