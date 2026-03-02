import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { getInventoryMovementAnalytics } from "../services/analyticsService";

const PAGE_CONFIG = {
  top: { title: "Top Rotacion", key: "topRotacion" },
  baja: { title: "Baja Rotacion", key: "bajaRotacion" },
  muerto: { title: "Inventario Muerto", key: "inventarioMuerto" },
  rentable: { title: "Top Rentabilidad", key: "topRentabilidad" },
  tendencia: { title: "Tendencia Creciente", key: "tendenciaCreciente" },
  stock: { title: "Stock Recomendado", key: "stockObjetivoSugerido" },
  proveedores: { title: "Ranking Proveedores", key: "rankingProveedoresEntrega" },
};

const rotacionLabel = (tipo) => {
  if (tipo === "alta") return "Alta";
  if (tipo === "media") return "Media";
  return "Baja";
};

function InventoryInsightsPage() {
  const { type } = useParams();
  const [loading, setLoading] = useState(true);
  const [analytics, setAnalytics] = useState(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const data = await getInventoryMovementAnalytics(30);
        setAnalytics(data);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  const config = PAGE_CONFIG[type] || PAGE_CONFIG.top;

  const items = useMemo(() => {
    if (!analytics) return [];
    return analytics[config.key] || [];
  }, [analytics, config.key]);

  if (loading) {
    return (
      <div>
        <div className="skeleton-card" />
        <div className="skeleton-card" />
      </div>
    );
  }

  return (
    <div className="dashboard-container">
      <div className="section-card">
        <h3 className="section-title">{config.title}</h3>
        {items.length === 0 ? (
          <p>No hay datos para este analisis.</p>
        ) : (
          items.map((item) => (
            <div
              key={item.id || item.proveedorId || item.productoId}
              className="pedido-card inventory-insight-card"
            >
              <div className="pedido-card-header">
                <h4>{item.nombre || item.proveedorNombre}</h4>
                {!!item.rotacionTipo && (
                  <span className={`badge-rotacion ${item.rotacionTipo || "baja"}`}>
                    {rotacionLabel(item.rotacionTipo)}
                  </span>
                )}
                {!!item.estadoEntrega && (
                  <span className={`badge-rotacion ${item.estadoEntrega === "lento" ? "baja" : "alta"}`}>
                    {item.estadoEntrega}
                  </span>
                )}
              </div>
              <div className="pedido-card-body">
                {!!item.proveedorNombre && !!item.nombre && (
                  <p>
                    <strong>Proveedor:</strong> {item.proveedorNombre || "-"}
                  </p>
                )}
                {"rotacionSemanal" in item && (
                  <p>
                    <strong>Venta semanal:</strong> {Number(item.rotacionSemanal || 0).toFixed(2)} UN
                  </p>
                )}
                {"rotacionMensual" in item && (
                  <p>
                    <strong>Venta mensual:</strong> {Number(item.rotacionMensual || 0).toFixed(2)} UN
                  </p>
                )}
                {"promedioDiario" in item && (
                  <p>
                    <strong>Promedio diario:</strong> {Number(item.promedioDiario || 0).toFixed(2)} UN
                  </p>
                )}
                {"tendencia" in item && (
                  <p>
                    <strong>Tendencia:</strong> {item.tendencia}
                  </p>
                )}
                {"demandaProximosDias" in item && (
                  <p>
                    <strong>Prediccion ({Number(item.forecastDays || 5)} dias):</strong>{" "}
                    {Number(item.demandaProximosDias || 0).toFixed(2)} UN
                  </p>
                )}
                {"stockRecomendado" in item && (
                  <p>
                    <strong>Stock recomendado:</strong> {Number(item.stockRecomendado || 0).toFixed(2)} UN
                    {"  "}({Number(item.stockObjetivo || 0).toFixed(2)} actual)
                  </p>
                )}
                {"sugerirSubirStockObjetivo" in item && item.sugerirSubirStockObjetivo && (
                  <p>
                    <strong>Sugerencia:</strong> subir stock objetivo a{" "}
                    {Number(item.stockRecomendado || 0).toFixed(0)} UN
                  </p>
                )}
                {"stockBase" in item && (
                  <p>
                    <strong>Stock actual:</strong> {Number(item.stockBase || 0).toFixed(2)} UN
                  </p>
                )}
                {"rentabilidadMensual" in item && (
                  <p>
                    <strong>Rentabilidad mensual:</strong> C$
                    {Number(item.rentabilidadMensual || 0).toFixed(2)}
                  </p>
                )}
                {"promedioEntregaDias" in item && (
                  <p>
                    <strong>Promedio entrega:</strong>{" "}
                    {Number(item.promedioEntregaDias || 0).toFixed(2)} dias
                  </p>
                )}
                {"pedidos" in item && (
                  <p>
                    <strong>Pedidos analizados:</strong> {item.pedidos}
                  </p>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default InventoryInsightsPage;
