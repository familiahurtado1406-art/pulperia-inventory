import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getInventoryMovementAnalytics } from "../services/analyticsService";

function Dashboard() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const data = await getInventoryMovementAnalytics(30);
        setMetrics(data);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  if (loading) {
    return (
      <div>
        <div className="skeleton-card" />
        <div className="skeleton-card" />
        <div className="skeleton-card" />
      </div>
    );
  }

  if (!metrics) {
    return <p>No se pudieron cargar metricas.</p>;
  }

  const topRentable = metrics.topRentabilidad[0];
  const proveedorMasLento = metrics.rankingProveedoresEntrega.find(
    (item) => item.estadoEntrega === "lento"
  );

  return (
    <div className="dashboard-container">
      <div className="section-card">
        <h3 className="section-title">Dashboard</h3>
        <div className="analytics-grid">
          <button
            type="button"
            className="analytics-card analytics-action-card"
            onClick={() => navigate("/dashboard/insights/top")}
          >
            <h4>Top Rotacion</h4>
            <p>{metrics.stats.topRotacionCount}</p>
          </button>
          <button
            type="button"
            className="analytics-card analytics-action-card"
            onClick={() => navigate("/dashboard/insights/tendencia")}
          >
            <h4>Tendencia Creciente</h4>
            <p>{metrics.stats.tendenciaCrecienteCount}</p>
          </button>
          <button
            type="button"
            className="analytics-card analytics-action-card"
            onClick={() => navigate("/dashboard/insights/muerto")}
          >
            <h4>Inventario Muerto</h4>
            <p>{metrics.stats.inventarioMuertoCount}</p>
          </button>
          <button
            type="button"
            className="analytics-card analytics-action-card"
            onClick={() => navigate("/dashboard/insights/stock")}
          >
            <h4>Stock Recomendado</h4>
            <p>{metrics.stats.stockObjetivoSugeridoCount}</p>
          </button>
          <button
            type="button"
            className="analytics-card analytics-action-card"
            onClick={() => navigate("/dashboard/insights/proveedores")}
          >
            <h4>Ranking Proveedores</h4>
            <p>{metrics.rankingProveedoresEntrega.length}</p>
          </button>
        </div>
      </div>

      <div className="section-card">
        <h3 className="section-title">Resumen Inteligente</h3>
        <div className="analytics-grid">
          <div className="analytics-card">
            <h4>Producto lider semanal</h4>
            <p>
              {metrics.topRotacion[0]?.nombre || "-"} ({metrics.topRotacion[0]?.rotacionSemanal || 0}{" "}
              UN)
            </p>
          </div>
          <div className="analytics-card">
            <h4>Tendencia al alza</h4>
            <p>
              {metrics.tendenciaCreciente[0]?.nombre || "-"} (
              {metrics.tendenciaCreciente[0]?.promedioSemanaActual || 0} UN/dia)
            </p>
          </div>
          <div className="analytics-card">
            <h4>Inventario muerto</h4>
            <p>{metrics.inventarioMuerto.length} productos</p>
          </div>
          <div className="analytics-card">
            <h4>Mas rentable</h4>
            <p>
              {topRentable?.nombre || "-"} (C${Number(topRentable?.rentabilidadMensual || 0).toFixed(2)}
              )
            </p>
          </div>
        </div>
      </div>

      <div className="section-card">
        <h3 className="section-title">Ranking Proveedores</h3>
        {metrics.rankingProveedoresEntrega.length === 0 ? (
          <p>No hay pedidos recibidos suficientes para calcular tiempos de entrega.</p>
        ) : (
          metrics.rankingProveedoresEntrega.slice(0, 5).map((item) => (
            <div key={item.proveedorId} className="pedido-detail-item">
              <p>
                <strong>{item.proveedorNombre}</strong>
              </p>
              <p>Promedio entrega: {Number(item.promedioEntregaDias || 0).toFixed(2)} dias</p>
              <p>Estado: {item.estadoEntrega}</p>
            </div>
          ))
        )}
        {proveedorMasLento && (
          <div className="analytics-highlight">
            <h4>Proveedor lento detectado</h4>
            <p>{proveedorMasLento.proveedorNombre}</p>
            <p>Promedio entrega: {proveedorMasLento.promedioEntregaDias.toFixed(2)} dias</p>
          </div>
        )}
        <div className="spacer" />
        <button
          type="button"
          className="btn-secondary"
          onClick={() => navigate("/dashboard/insights/proveedores")}
        >
          Ver detalle completo
        </button>
      </div>
    </div>
  );
}

export default Dashboard;
