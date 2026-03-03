import { Timestamp, getDocs, query, where } from "firebase/firestore";
import { userCollection } from "./userScopedFirestore";

const toMillis = (value) => {
  if (!value) return 0;
  if (typeof value === "string") {
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (value?.toMillis) return value.toMillis();
  return 0;
};

const toDate = (value) => {
  if (!value) return null;
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (value?.toDate) return value.toDate();
  return null;
};

const getStockBase = (product) =>
  Number(product?.stockBase ?? product?.stockUnidades ?? product?.stockActual ?? 0);

const classifyRotation = (rotacionSemanal) => {
  if (rotacionSemanal > 10) return "alta";
  if (rotacionSemanal > 4) return "media";
  return "baja";
};

const classifyTrend = (currentAvg, previousAvg) => {
  if (currentAvg > previousAvg * 1.15) return "creciente";
  if (currentAvg < previousAvg * 0.85) return "decreciente";
  return "estable";
};

const classifyDeliverySpeed = (avgDays) => {
  if (avgDays <= 2) return "excelente";
  if (avgDays <= 5) return "normal";
  return "lento";
};

const analyticsCache = {
  key: "",
  data: null,
  expiresAt: 0,
};

export const getComprasAnalytics = async () => {
  const [pedidosSnap, proveedoresSnap, productsSnap] = await Promise.all([
    getDocs(userCollection("pedidos")),
    getDocs(userCollection("proveedores")),
    getDocs(userCollection("products")),
  ]);

  const pedidos = pedidosSnap.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() }));
  const proveedores = proveedoresSnap.docs.map((docItem) => ({
    id: docItem.id,
    ...docItem.data(),
  }));
  const products = productsSnap.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() }));

  const now = Date.now();
  const monthAgo = now - 30 * 24 * 60 * 60 * 1000;

  const totalInventario = products.reduce(
    (acc, product) => acc + Number(product.stockBase ?? product.stockUnidades ?? 0),
    0
  );
  const productosBajos = products.filter((product) => {
    const stock = Number(product.stockBase ?? product.stockUnidades ?? 0);
    const min = Number(product.stockMin ?? 0);
    return stock <= min;
  }).length;
  const pedidosPendientes = pedidos.filter((pedido) => pedido.estado !== "recibido").length;
  const proveedoresActivos = proveedores.filter((prov) => prov.activo !== false).length;

  const rows = pedidos.flatMap((pedido) =>
    (pedido.productos || []).map((prod) => ({
      pedidoId: pedido.id,
      proveedorId: pedido.proveedorId || "",
      proveedorNombre: pedido.proveedorNombre || pedido.proveedorId || "Proveedor",
      productoId: prod.productoId || "",
      cantidadBase: Number(prod.cantidadBase ?? prod.cantidadSolicitada ?? 0),
      costoUnitarioBase: Number(prod.costoUnitarioBase ?? prod.costoUnitario ?? 0),
      costoTotal: Number(prod.costoTotal ?? 0),
      fechaCreacionMillis: toMillis(pedido.fechaCreacion),
    }))
  );

  const groupedProveedor = rows.reduce((acc, row) => {
    if (!row.proveedorId || row.costoUnitarioBase <= 0) return acc;
    if (!acc[row.proveedorId]) {
      acc[row.proveedorId] = {
        proveedorId: row.proveedorId,
        proveedorNombre: row.proveedorNombre,
        total: 0,
        count: 0,
      };
    }
    acc[row.proveedorId].total += row.costoUnitarioBase;
    acc[row.proveedorId].count += 1;
    return acc;
  }, {});

  const rankingProveedores = Object.values(groupedProveedor)
    .map((item) => ({
      ...item,
      promedio: item.count > 0 ? item.total / item.count : 0,
    }))
    .sort((a, b) => a.promedio - b.promedio);

  const chartComparacionCostos = rankingProveedores.map((item) => ({
    proveedorNombre: item.proveedorNombre,
    costoUnitarioBase: Number(item.promedio.toFixed(2)),
  }));

  const diasEntrega = pedidos
    .filter((pedido) => pedido.fechaCreacion && pedido.fechaRecibido)
    .map((pedido) => {
      const inicio = toDate(pedido.fechaCreacion);
      const fin = toDate(pedido.fechaRecibido);
      if (!inicio || !fin) return null;
      return (fin.getTime() - inicio.getTime()) / (1000 * 60 * 60 * 24);
    })
    .filter((value) => Number.isFinite(value) && value >= 0);

  const promedioEntregaDias =
    diasEntrega.length > 0
      ? diasEntrega.reduce((acc, value) => acc + value, 0) / diasEntrega.length
      : 0;

  const totalInvertidoUltimoMes = rows
    .filter((row) => row.fechaCreacionMillis >= monthAgo)
    .reduce((acc, row) => acc + Number(row.costoTotal || 0), 0);

  const groupedProducto = rows.reduce((acc, row) => {
    if (!row.productoId || row.costoUnitarioBase <= 0) return acc;
    if (!acc[row.productoId]) acc[row.productoId] = [];
    acc[row.productoId].push(row);
    return acc;
  }, {});

  const bestAvgByProduct = {};
  Object.entries(groupedProducto).forEach(([productoId, list]) => {
    const byProv = list.reduce((acc, row) => {
      if (!acc[row.proveedorId]) {
        acc[row.proveedorId] = { total: 0, count: 0 };
      }
      acc[row.proveedorId].total += row.costoUnitarioBase;
      acc[row.proveedorId].count += 1;
      return acc;
    }, {});

    let minAvg = null;
    Object.values(byProv).forEach((provAgg) => {
      const avg = provAgg.total / provAgg.count;
      if (minAvg === null || avg < minAvg) minAvg = avg;
    });
    bestAvgByProduct[productoId] = minAvg;
  });

  const ahorroEstimado = rows
    .filter((row) => row.fechaCreacionMillis >= monthAgo)
    .reduce((acc, row) => {
      const best = bestAvgByProduct[row.productoId];
      if (best === null || best === undefined) return acc;
      const diffUnit = row.costoUnitarioBase - best;
      const saving = diffUnit > 0 ? diffUnit * row.cantidadBase : 0;
      return acc + saving;
    }, 0);

  const recentPedidos = [...pedidos]
    .sort((a, b) => toMillis(b.fechaCreacion) - toMillis(a.fechaCreacion))
    .slice(0, 5)
    .map((pedido) => ({
      id: pedido.id,
      proveedorNombre: pedido.proveedorNombre || pedido.proveedorId || "Proveedor",
      totalCosto: Number(pedido.totalCosto || 0),
      estado: pedido.estado || "pendiente",
      fecha: toDate(pedido.fechaCreacion),
    }));

  const mejorProveedorDelMes = rankingProveedores[0]
    ? {
        proveedorNombre: rankingProveedores[0].proveedorNombre,
        costoPromedio: rankingProveedores[0].promedio,
        entregaPromedioDias: promedioEntregaDias,
      }
    : null;

  return {
    rankingProveedores,
    promedioEntregaDias,
    chartComparacionCostos,
    totalInventario,
    productosBajos,
    pedidosPendientes,
    proveedoresActivos,
    totalInvertidoUltimoMes,
    ahorroEstimado,
    recentPedidos,
    mejorProveedorDelMes,
  };
};

export const getInventoryMovementAnalytics = async (days = 30, options = {}) => {
  const lookbackDays = Number(days || 30);
  const daysCoverage = Number(options.daysCoverage || 10);
  const forecastDays = Number(options.forecastDays || 5);
  const cacheTtlMs = Number(options.cacheTtlMs || 90 * 1000);
  const cacheKey = JSON.stringify({
    lookbackDays,
    daysCoverage,
    forecastDays,
  });

  const now = Date.now();
  if (analyticsCache.data && analyticsCache.key === cacheKey && now < analyticsCache.expiresAt) {
    return analyticsCache.data;
  }

  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const prevWeekAgo = now - 14 * 24 * 60 * 60 * 1000;
  const monthAgo = now - lookbackDays * 24 * 60 * 60 * 1000;
  const monthAgoDate = new Date(monthAgo);

  const [productsSnap, proveedoresSnap, historySnap, pedidosSnap, linksSnapA, linksSnapB] =
    await Promise.all([
      getDocs(userCollection("products")),
      getDocs(userCollection("proveedores")),
      getDocs(
        query(
          userCollection("historial_cambios"),
          where("fecha", ">=", Timestamp.fromDate(monthAgoDate))
        )
      ),
      getDocs(userCollection("pedidos")),
      getDocs(userCollection("proveedor_producto")),
      getDocs(userCollection("proveedorProducto")),
    ]);

  const products = productsSnap.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() }));
  const proveedores = proveedoresSnap.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() }));
  const history = historySnap.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() }));
  const pedidos = pedidosSnap.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() }));
  const links = [...linksSnapA.docs, ...linksSnapB.docs].map((docItem) => docItem.data());

  const proveedorMap = proveedores.reduce((acc, item) => {
    acc[item.id] = item.nombre || item.id;
    return acc;
  }, {});
  const bestProviderByProduct = links.reduce((acc, link) => {
    const providerId = String(link.proveedorId || "");
    const productDocId = String(link.productDocId || "");
    const productoId = String(link.productoId || "");
    const cost = Number(link.costoUnitario || 0);
    if (!providerId || cost <= 0) return acc;

    const applyKey = (key) => {
      if (!key) return;
      if (!acc[key] || cost < acc[key].costoUnitario) {
        acc[key] = {
          proveedorId: providerId,
          proveedorNombre: link.proveedorNombre || proveedorMap[providerId] || providerId,
          costoUnitario: cost,
        };
      }
    };

    applyKey(productDocId);
    applyKey(productoId);
    return acc;
  }, {});

  const rotationByProduct = {};
  const dailySalesByProduct = {};
  history.forEach((movement) => {
    const difference = Number(movement.diferencia || 0);
    if (movement.tipoMovimiento !== "conteo" || difference >= 0) return;

    const productId = String(movement.productoId || "");
    if (!productId) return;

    if (!rotationByProduct[productId]) {
      rotationByProduct[productId] = {
        semanal: 0,
        mensual: 0,
        semanaActual: 0,
        semanaAnterior: 0,
      };
    }
    if (!dailySalesByProduct[productId]) dailySalesByProduct[productId] = {};

    const sold = Math.abs(difference);
    const movementMillis = toMillis(movement.fecha);
    const movementDate = toDate(movement.fecha);
    const dayKey = movementDate ? movementDate.toISOString().slice(0, 10) : "";

    if (movementMillis >= monthAgo) rotationByProduct[productId].mensual += sold;
    if (movementMillis >= weekAgo) rotationByProduct[productId].semanal += sold;
    if (movementMillis >= weekAgo) rotationByProduct[productId].semanaActual += sold;
    if (movementMillis < weekAgo && movementMillis >= prevWeekAgo) {
      rotationByProduct[productId].semanaAnterior += sold;
    }
    if (dayKey) {
      dailySalesByProduct[productId][dayKey] =
        Number(dailySalesByProduct[productId][dayKey] || 0) + sold;
    }
  });

  const rankingBase = products
    .filter((product) => product.activo !== false)
    .map((product) => {
      const productoId = String(product.productoId || product.id);
      const bestProvider =
        bestProviderByProduct[String(product.id)] || bestProviderByProduct[productoId] || null;
      const rotation = rotationByProduct[productoId] || { semanal: 0, mensual: 0 };
      const rotacionSemanal = Number(rotation.semanal || 0);
      const rotacionMensual = Number(rotation.mensual || 0);
      const promedioDiario = Number((rotacionMensual / lookbackDays).toFixed(2));
      const promedioSemanaActual = Number((Number(rotation.semanaActual || 0) / 7).toFixed(2));
      const promedioSemanaAnterior = Number((Number(rotation.semanaAnterior || 0) / 7).toFixed(2));
      const tendencia = classifyTrend(promedioSemanaActual, promedioSemanaAnterior);
      const demandaProximosDias = Number((promedioDiario * forecastDays).toFixed(2));
      const stockBase = getStockBase(product);
      const stockObjetivo = Number(product.stockObjetivo || 0);
      const stockMin = Number(product.stockMin || 0);
      const stockRecomendado = Number((promedioDiario * daysCoverage).toFixed(2));
      const sugerirSubirStockObjetivo = stockRecomendado > stockObjetivo;
      const gananciaUnidad = Number(product.gananciaUnidad || 0);
      const rentabilidad = Number((rotacionMensual * gananciaUnidad).toFixed(2));

      return {
        id: product.id,
        productoId,
        nombre: product.nombre || productoId,
        proveedorId: bestProvider?.proveedorId || "",
        proveedorNombre: bestProvider?.proveedorNombre || "-",
        stockBase,
        stockObjetivo,
        stockMin,
        rotacionSemanal: Number(rotacionSemanal.toFixed(2)),
        rotacionMensual: Number(rotacionMensual.toFixed(2)),
        promedioDiario,
        promedio30: promedioDiario,
        promedioSemanaActual,
        promedioSemanaAnterior,
        tendencia,
        forecastDays,
        demandaProximosDias,
        stockRecomendado,
        sugerirSubirStockObjetivo,
        ventasDiarias: dailySalesByProduct[productoId] || {},
        rotacionTipo: classifyRotation(rotacionSemanal),
        rentabilidadMensual: rentabilidad,
      };
    });

  const rankingMayorRotacion = [...rankingBase].sort(
    (a, b) => b.rotacionSemanal - a.rotacionSemanal
  );
  const rankingMenorRotacion = [...rankingBase].sort(
    (a, b) => a.rotacionSemanal - b.rotacionSemanal
  );
  const rankingRentabilidad = [...rankingBase].sort(
    (a, b) => b.rentabilidadMensual - a.rentabilidadMensual
  );
  const rankingTendenciaCreciente = rankingBase
    .filter((product) => product.tendencia === "creciente")
    .sort((a, b) => b.promedioSemanaActual - a.promedioSemanaActual);
  const rankingTendenciaDecreciente = rankingBase
    .filter((product) => product.tendencia === "decreciente")
    .sort((a, b) => b.promedioSemanaAnterior - a.promedioSemanaAnterior);
  const rankingTendenciaEstable = rankingBase
    .filter((product) => product.tendencia === "estable")
    .sort((a, b) => b.rotacionSemanal - a.rotacionSemanal);
  const stockObjetivoSugerido = rankingBase
    .filter((product) => product.sugerirSubirStockObjetivo)
    .sort((a, b) => b.stockRecomendado - a.stockRecomendado);

  const candidatosEliminar = rankingBase
    .filter(
      (product) =>
        (product.rotacionMensual === 0 && product.stockBase > product.stockMin) ||
        (product.rotacionMensual < 3 && product.stockBase > 20)
    )
    .sort((a, b) => b.stockBase - a.stockBase);

  const deliveryByProveedor = pedidos.reduce((acc, pedido) => {
    const start = toDate(pedido.fechaCreacion);
    const end = toDate(pedido.fechaEntregaReal || pedido.fechaRecibido);
    if (!start || !end) return acc;

    const diffDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
    if (!Number.isFinite(diffDays) || diffDays < 0) return acc;

    const proveedorId = pedido.proveedorId || "sin-proveedor";
    const proveedorNombre = pedido.proveedorNombre || proveedorMap[proveedorId] || proveedorId;

    if (!acc[proveedorId]) {
      acc[proveedorId] = {
        proveedorId,
        proveedorNombre,
        totalDias: 0,
        pedidos: 0,
      };
    }

    acc[proveedorId].totalDias += diffDays;
    acc[proveedorId].pedidos += 1;
    return acc;
  }, {});

  const rankingProveedoresEntrega = Object.values(deliveryByProveedor)
    .map((item) => {
      const promedioEntregaDias = item.pedidos > 0 ? item.totalDias / item.pedidos : 0;
      return {
        proveedorId: item.proveedorId,
        proveedorNombre: item.proveedorNombre,
        pedidos: item.pedidos,
        promedioEntregaDias: Number(promedioEntregaDias.toFixed(2)),
        estadoEntrega: classifyDeliverySpeed(promedioEntregaDias),
      };
    })
    .sort((a, b) => a.promedioEntregaDias - b.promedioEntregaDias);

  const response = {
    topRotacion: rankingMayorRotacion.slice(0, 10),
    bajaRotacion: rankingMenorRotacion.slice(0, 10),
    inventarioMuerto: candidatosEliminar,
    topRentabilidad: rankingRentabilidad.slice(0, 10),
    tendenciaCreciente: rankingTendenciaCreciente.slice(0, 10),
    tendenciaDecreciente: rankingTendenciaDecreciente.slice(0, 10),
    tendenciaEstable: rankingTendenciaEstable.slice(0, 10),
    stockObjetivoSugerido: stockObjetivoSugerido.slice(0, 10),
    rankingProveedoresEntrega,
    ventasDiariasPorProducto: dailySalesByProduct,
    meta: {
      forecastDays,
      daysCoverage,
      lookbackDays,
    },
    stats: {
      topRotacionCount: rankingMayorRotacion.slice(0, 10).length,
      bajaRotacionCount: rankingMenorRotacion.slice(0, 10).length,
      inventarioMuertoCount: candidatosEliminar.length,
      topRentabilidadCount: rankingRentabilidad.slice(0, 10).length,
      tendenciaCrecienteCount: rankingTendenciaCreciente.length,
      stockObjetivoSugeridoCount: stockObjetivoSugerido.length,
      proveedoresLentosCount: rankingProveedoresEntrega.filter(
        (item) => item.estadoEntrega === "lento"
      ).length,
    },
  };

  analyticsCache.key = cacheKey;
  analyticsCache.data = response;
  analyticsCache.expiresAt = now + cacheTtlMs;

  return response;
};
