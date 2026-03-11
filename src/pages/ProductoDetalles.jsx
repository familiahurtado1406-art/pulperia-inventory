import { useEffect, useMemo, useState } from "react";
import { Timestamp, getDoc, getDocs, limit, query, where } from "firebase/firestore";
import { useParams } from "react-router-dom";
import { getProviderProductLinksByProduct } from "../services/providerProductService";
import { userCollection, userDoc } from "../services/userScopedFirestore";

const LOOKBACK_DAYS = 30;
const COVERAGE_DAYS = 10;

const toDate = (value) => {
  if (!value) return null;
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (value?.toDate) return value.toDate();
  return null;
};

const toMillis = (value) => {
  const date = toDate(value);
  return date ? date.getTime() : 0;
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

function ProductoDetalles() {
  const { id } = useParams();
  const [loading, setLoading] = useState(true);
  const [product, setProduct] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      const routeId = String(id || "").trim();
      if (!routeId) {
        console.error("[ProductoDetalles] ID recibido vacio o undefined:", id);
        setError("No se recibio un ID de producto valido.");
        setProduct(null);
        setAnalytics(null);
        setLoading(false);
        return;
      }

      console.log("[ProductoDetalles] ID recibido:", routeId);
      setLoading(true);
      setError("");

      try {
        let productSnap = await getDoc(userDoc("products", routeId));
        let currentProduct = null;

        if (productSnap.exists()) {
          currentProduct = { id: productSnap.id, ...productSnap.data() };
        } else {
          const fallbackQuery = query(
            userCollection("products"),
            where("productoId", "==", routeId),
            limit(1)
          );
          const fallbackSnap = await getDocs(fallbackQuery);
          if (!fallbackSnap.empty) {
            const docItem = fallbackSnap.docs[0];
            currentProduct = { id: docItem.id, ...docItem.data() };
            console.warn(
              "[ProductoDetalles] Producto encontrado por productoId (fallback), no por doc id:",
              routeId
            );
          }
        }

        if (!currentProduct) {
          setError(`Producto no encontrado para ID: ${routeId}`);
          setProduct(null);
          setAnalytics(null);
          return;
        }

        setProduct(currentProduct);

        const productoId = String(currentProduct.productoId || currentProduct.id);
        const now = Date.now();
        const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
        const prevWeekAgo = now - 14 * 24 * 60 * 60 * 1000;
        const startDate = new Date(now - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

        // Avoid composite-index dependency in detail view:
        // query by product and filter by date in-memory.
        const historyQuery = query(
          userCollection("historial_cambios"),
          where("productoId", "==", productoId)
        );

        const [historySnap, pedidosSnap, providerLinks] = await Promise.all([
          getDocs(historyQuery),
          getDocs(userCollection("pedidos")),
          getProviderProductLinksByProduct({ productDocId: currentProduct.id, productoId }),
        ]);

        const movements = historySnap.docs
          .map((docItem) => docItem.data())
          .filter((movement) => {
            const movementMillis = toMillis(movement.fecha);
            return movementMillis >= startDate.getTime();
          });
        const pedidos = pedidosSnap.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() }));

        let ventasMensuales = 0;
        let ventasSemanales = 0;
        let ventasSemanaActual = 0;
        let ventasSemanaAnterior = 0;

        movements.forEach((movement) => {
          const diff = Number(movement.diferencia || 0);
          if (movement.tipoMovimiento !== "conteo" || diff >= 0) return;
          const sold = Math.abs(diff);
          const movementMillis = toMillis(movement.fecha);

          ventasMensuales += sold;
          if (movementMillis >= weekAgo) ventasSemanales += sold;
          if (movementMillis >= weekAgo) ventasSemanaActual += sold;
          if (movementMillis < weekAgo && movementMillis >= prevWeekAgo) {
            ventasSemanaAnterior += sold;
          }
        });

        const promedio30 = ventasMensuales / LOOKBACK_DAYS;
        const promedioSemanaActual = ventasSemanaActual / 7;
        const promedioSemanaAnterior = ventasSemanaAnterior / 7;
        const tendencia = classifyTrend(promedioSemanaActual, promedioSemanaAnterior);

        const stockActual = getStockBase(currentProduct);
        const stockMin = Number(currentProduct.stockMin || 0);
        const costoUnitario = Number(
          currentProduct.costoUnitarioBase ?? currentProduct.costoUnitario ?? 0
        );
        const precioVenta = Number(
          currentProduct.precioVentaBase ?? currentProduct.precioVenta ?? 0
        );
        const margen = Number(currentProduct.margen || 0);
        const gananciaUnidad = precioVenta - costoUnitario;
        const gananciaPotencial = gananciaUnidad * stockActual;
        const rentabilidadMensual = gananciaUnidad * ventasMensuales;
        const capitalInvertido = costoUnitario * stockActual;
        const diasCobertura = promedio30 > 0 ? stockActual / promedio30 : 0;
        const stockRecomendado = promedio30 * COVERAGE_DAYS;
        const eficienciaInventario = stockActual > 0 ? ventasMensuales / stockActual : 0;
        const rotacionTipo = classifyRotation(ventasSemanales);

        const providerCostById = {};
        const providerDeliveryById = {};

        pedidos.forEach((pedido) => {
          const providerId = pedido.proveedorId || "sin-proveedor";
          const providerName = pedido.proveedorNombre || providerId;

          (pedido.productos || []).forEach((prod) => {
            if (String(prod.productoId || "") !== productoId) return;
            const costo = Number(prod.costoUnitarioBase ?? prod.costoUnitario ?? 0);
            if (costo <= 0) return;

            if (!providerCostById[providerId]) {
              providerCostById[providerId] = {
                proveedorId: providerId,
                proveedorNombre: providerName,
                total: 0,
                count: 0,
              };
            }
            providerCostById[providerId].total += costo;
            providerCostById[providerId].count += 1;
          });

          const fechaInicio = toDate(pedido.fechaCreacion);
          const fechaFin = toDate(pedido.fechaEntregaReal || pedido.fechaRecibido);
          if (!fechaInicio || !fechaFin) return;

          const diffDays = (fechaFin.getTime() - fechaInicio.getTime()) / (1000 * 60 * 60 * 24);
          if (!Number.isFinite(diffDays) || diffDays < 0) return;

          if (!providerDeliveryById[providerId]) {
            providerDeliveryById[providerId] = {
              proveedorId: providerId,
              proveedorNombre: providerName,
              totalDias: 0,
              pedidos: 0,
            };
          }
          providerDeliveryById[providerId].totalDias += diffDays;
          providerDeliveryById[providerId].pedidos += 1;
        });

        const providerCostRowsFromPedidos = Object.values(providerCostById).map((item) => ({
          proveedorId: item.proveedorId,
          proveedorNombre: item.proveedorNombre,
          costoPromedio: item.count > 0 ? item.total / item.count : 0,
        }));
        const providerCostRowsFromLinks = providerLinks
          .filter((link) => Number(link.costoUnitario || 0) > 0)
          .map((link) => ({
            proveedorId: link.proveedorId,
            proveedorNombre: link.proveedorNombre || link.proveedorId,
            costoPromedio: Number(link.costoUnitario || 0),
          }));
        const providerCostRows =
          providerCostRowsFromLinks.length > 0 ? providerCostRowsFromLinks : providerCostRowsFromPedidos;
        const bestProvider =
          providerCostRows.sort((a, b) => a.costoPromedio - b.costoPromedio)[0] || null;
        const deliveryRows = Object.values(providerDeliveryById).map((item) => ({
          proveedorId: item.proveedorId,
          proveedorNombre: item.proveedorNombre,
          promedioEntregaDias:
            item.pedidos > 0 ? item.totalDias / item.pedidos : 0,
        }));
        const fastestDeliveryDays =
          deliveryRows.length > 0
            ? Math.min(...deliveryRows.map((item) => Number(item.promedioEntregaDias || 0)))
            : null;
        const providerCardRows = providerLinks.map((link) => {
          const providerId = String(link.proveedorId || "");
          const avgCost = Number(link.costoUnitario || 0);
          const delivery = deliveryRows.find(
            (item) => String(item.proveedorId) === providerId
          );
          return {
            proveedorId: providerId,
            proveedorNombre: link.proveedorNombre || providerId,
            costoPromedio: avgCost,
            promedioEntregaDias: Number(delivery?.promedioEntregaDias || 0),
            preferido: !!link.preferido,
            isBestCost:
              !!bestProvider &&
              String(bestProvider.proveedorId || "") === providerId,
            isFastestDelivery:
              fastestDeliveryDays !== null &&
              Number(delivery?.promedioEntregaDias || 0) > 0 &&
              Number(delivery?.promedioEntregaDias || 0) === fastestDeliveryDays,
          };
        });
        const currentProviderId = bestProvider?.proveedorId || providerLinks[0]?.proveedorId || "";
        const currentProviderNombre =
          bestProvider?.proveedorNombre ||
          providerLinks[0]?.proveedorNombre ||
          currentProviderId;
        const currentProviderDelivery = providerDeliveryById[currentProviderId]
          ? {
              ...providerDeliveryById[currentProviderId],
              promedioEntregaDias:
                providerDeliveryById[currentProviderId].pedidos > 0
                  ? providerDeliveryById[currentProviderId].totalDias /
                    providerDeliveryById[currentProviderId].pedidos
                  : 0,
            }
          : null;

        const deliveryStatus = currentProviderDelivery
          ? classifyDeliverySpeed(currentProviderDelivery.promedioEntregaDias)
          : "sin-datos";

        const alerts = [];
        if (stockActual <= stockMin) alerts.push("Stock bajo minimo");
        if (ventasMensuales === 0 && stockActual > stockMin) alerts.push("Rotacion baja / inventario muerto");
        if (margen < 10) alerts.push("Margen bajo (<10%)");
        if (deliveryStatus === "lento") alerts.push("Proveedor lento");
        if (tendencia === "creciente") alerts.push("Alta demanda en tendencia creciente");

        setAnalytics({
          ventasMensuales,
          ventasSemanales,
          promedio30,
          promedioSemanaActual,
          promedioSemanaAnterior,
          tendencia,
          rotacionTipo,
          diasCobertura,
          stockRecomendado,
          gananciaUnidad,
          gananciaPotencial,
          rentabilidadMensual,
          capitalInvertido,
          eficienciaInventario,
          currentProviderId,
          currentProviderNombre,
          bestProvider,
          currentProviderDelivery,
          deliveryStatus,
          currentProviderIsNotBest:
            !!bestProvider && !!currentProviderId && bestProvider.proveedorId !== currentProviderId,
          providerCardRows,
          alerts,
        });
      } catch (err) {
        console.error("[ProductoDetalles] Error cargando producto:", err);
        setError("No se pudo cargar el detalle del producto.");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [id]);

  const precioVenta = useMemo(
    () => Number(product?.precioVentaBase ?? product?.precioVenta ?? 0),
    [product]
  );
  const costoUnitario = useMemo(
    () => Number(product?.costoUnitarioBase ?? product?.costoUnitario ?? 0),
    [product]
  );
  const stockActual = useMemo(() => getStockBase(product), [product]);

  if (loading) return <p>Cargando...</p>;
  if (error) return <p>{error}</p>;
  if (!product || !analytics) return <p>No hay datos disponibles.</p>;

  return (
    <div className="dashboard-container">
      <div className="section-card">
        <h3 className="section-title">{product.nombre}</h3>
        <p>Proveedor recomendado: {analytics.currentProviderNombre || "-"}</p>
        <p>
          Precio venta: C${precioVenta.toFixed(2)} | Costo unitario: C${costoUnitario.toFixed(2)}
        </p>
        <p>Margen: {Number(product.margen || 0).toFixed(2)}%</p>
        {Array.isArray(product.variants) && product.variants.length > 0 && (
          <div className="spacer">
            <h4>Presentaciones</h4>
            {product.variants.map((variant, index) => (
              <p key={variant.id || `${variant.name || "variant"}-${index}`}>
                {String(variant.name || "Presentacion")} - {Number(variant.units || 0)}{" "}
                {product.medidaBase || "UN"} - C${Number(variant.price || 0).toFixed(2)}
              </p>
            ))}
          </div>
        )}
      </div>

      <div className="section-card">
        <h3 className="section-title">Inventario</h3>
        <p>
          Stock actual: {stockActual.toFixed(2)} {product.medidaBase || "UN"}
        </p>
        <p>Stock minimo: {Number(product.stockMin || 0).toFixed(2)}</p>
        <p>Stock objetivo: {Number(product.stockObjetivo || 0).toFixed(2)}</p>
        <p>Dias estimados de cobertura: {analytics.diasCobertura.toFixed(2)}</p>
        <p>
          Stock recomendado ({COVERAGE_DAYS} dias): {analytics.stockRecomendado.toFixed(2)}{" "}
          {product.medidaBase || "UN"}
        </p>
      </div>

      <div className="section-card">
        <h3 className="section-title">Rentabilidad</h3>
        <p>Ganancia por unidad: C${analytics.gananciaUnidad.toFixed(2)}</p>
        <p>Ganancia potencial del stock: C${analytics.gananciaPotencial.toFixed(2)}</p>
        <p>Rentabilidad mensual estimada: C${analytics.rentabilidadMensual.toFixed(2)}</p>
        <p>Capital invertido actual: C${analytics.capitalInvertido.toFixed(2)}</p>
        <p>Indice eficiencia inventario: {analytics.eficienciaInventario.toFixed(3)}</p>
      </div>

      <div className="section-card">
        <h3 className="section-title">Rotacion</h3>
        <p>
          Venta semanal: {analytics.ventasSemanales.toFixed(2)} {product.medidaBase || "UN"}
        </p>
        <p>
          Venta mensual: {analytics.ventasMensuales.toFixed(2)} {product.medidaBase || "UN"}
        </p>
        <p>
          Promedio diario 30 dias: {analytics.promedio30.toFixed(2)} {product.medidaBase || "UN"}
        </p>
        <p>Tendencia: {analytics.tendencia}</p>
        <p>Clasificacion: {analytics.rotacionTipo}</p>
      </div>

      <div className="section-card">
        <h3 className="section-title">Proveedor</h3>
        {analytics.bestProvider ? (
          <>
            <p>
              Mejor proveedor: {analytics.bestProvider.proveedorNombre} - C$
              {analytics.bestProvider.costoPromedio.toFixed(2)}
            </p>
            {analytics.currentProviderIsNotBest && (
              <p className="warning-provider">Existe proveedor mas economico</p>
            )}
          </>
        ) : (
          <p>No hay historial suficiente para comparar proveedores.</p>
        )}

        {analytics.currentProviderDelivery ? (
          <p>
            Entrega proveedor actual: {analytics.currentProviderDelivery.promedioEntregaDias.toFixed(2)}{" "}
            dias ({analytics.deliveryStatus})
          </p>
        ) : (
          <p>Sin datos de entrega para el proveedor actual.</p>
        )}

        {Array.isArray(analytics.providerCardRows) &&
          analytics.providerCardRows.length > 0 && (
            <div className="spacer">
              {analytics.providerCardRows.map((provider) => (
                <div
                  key={`provider-${provider.proveedorId}`}
                  className="pedido-detail-item"
                >
                  <p>
                    <strong>{provider.proveedorNombre}</strong>
                  </p>
                  <div className="provider-badges">
                    {provider.isBestCost && (
                      <span className="provider-badge cost">Mejor precio</span>
                    )}
                    {provider.isFastestDelivery && (
                      <span className="provider-badge speed">Entrega rapida</span>
                    )}
                    {provider.preferido && (
                      <span className="provider-badge preferred">Preferido</span>
                    )}
                  </div>
                  <p>Costo unitario: C${Number(provider.costoPromedio || 0).toFixed(2)}</p>
                </div>
              ))}
            </div>
          )}
      </div>

      {analytics.alerts.length > 0 && (
        <div className="section-card">
          <h3 className="section-title">Alertas</h3>
          {analytics.alerts.map((alert) => (
            <p key={alert} className="warning-provider">
              {alert}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

export default ProductoDetalles;
