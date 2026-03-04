import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getDocs } from "firebase/firestore";
import { getInventoryMovementAnalytics } from "../services/analyticsService";
import { userCollection } from "../services/userScopedFirestore";

const toDayNumber = (date = new Date()) => {
  const day = date.getDay();
  return day === 0 ? 7 : day;
};

const normalizeProviderDay = (value) => {
  const dayMap = {
    lunes: 1,
    martes: 2,
    miercoles: 3,
    miércoles: 3,
    jueves: 4,
    viernes: 5,
    sabado: 6,
    sábado: 6,
    domingo: 7,
  };
  const asNumber = Number(value);
  if (Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= 7) return asNumber;
  return dayMap[String(value || "").trim().toLowerCase()] || null;
};

const dayDistance = (fromDay, toDay) => {
  if (!fromDay || !toDay) return null;
  const diff = (toDay - fromDay + 7) % 7;
  return diff === 0 ? 7 : diff;
};

function Dashboard() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState(null);
  const [providers, setProviders] = useState([]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [data, providersSnap] = await Promise.all([
          getInventoryMovementAnalytics(30),
          getDocs(userCollection("proveedores")),
        ]);
        setMetrics(data);
        setProviders(providersSnap.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() })));
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
  const topWeekly = metrics.topRotacion[0];
  const topTrend = metrics.tendenciaCreciente[0];
  const productos = metrics.productosAnalizados || [];

  const providerById = providers.reduce((acc, provider) => {
    acc[String(provider.id)] = provider;
    return acc;
  }, {});

  const today = toDayNumber(new Date());
  const providersActivos = providers.filter((provider) => provider.activo !== false);
  const entregasHoy = providersActivos.filter(
    (provider) => normalizeProviderDay(provider.diaEntrega ?? provider.dia_entrega) === today
  );
  const pedidosHoy = providersActivos.filter(
    (provider) =>
      normalizeProviderDay(provider.diaFacturacion ?? provider.dia_facturacion) === today
  );

  const pedidosUrgentes = productos.filter((product) => {
    const provider = providerById[String(product.proveedorId || "")];
    if (!provider) return false;
    const deliveryDay = normalizeProviderDay(provider.diaEntrega ?? provider.dia_entrega);
    const diasHastaEntrega = dayDistance(today, deliveryDay);
    if (diasHastaEntrega === null) return false;
    const diasStock = Number(product.diasStockRestantes);
    if (!Number.isFinite(diasStock)) return false;
    return diasStock < diasHastaEntrega;
  });

  const stockBajo = productos.filter((product) => {
    const dias = Number(product.diasStockRestantes);
    return Number.isFinite(dias) && dias <= 5;
  });
  const inventarioMuerto = productos.filter((product) => Number(product.rotacionMensual || 0) === 0);
  const topVentas = productos.filter((product) => Number(product.promedioDiario || 0) >= 5);
  const productosLentos = productos.filter((product) => Number(product.promedioDiario || 0) < 1);
  const proveedorMasLento = metrics.rankingProveedoresEntrega.find(
    (item) => item.estadoEntrega === "lento"
  );

  const hoyPulperia = [
    pedidosUrgentes[0]
      ? `Comprar ${pedidosUrgentes[0].nombre} hoy`
      : "Sin compras urgentes detectadas",
    entregasHoy[0]
      ? `Llega pedido de ${entregasHoy[0].nombre || entregasHoy[0].id}`
      : "No hay entregas programadas hoy",
    topTrend ? `${topTrend.nombre} subiendo ventas` : "Sin tendencia creciente destacada hoy",
  ];

  return (
    <div className="dashboard-container">
      <div className="section-card">
        <h3 className="section-title">Hoy en tu pulperia</h3>
        <div className="pedido-card-body">
          <p>⚠ {hoyPulperia[0]}</p>
          <p>📦 {hoyPulperia[1]}</p>
          <p>🔥 {hoyPulperia[2]}</p>
        </div>
      </div>

      <div className="section-card">
        <h3 className="section-title">Acciones hoy</h3>
        <div className="dashboard-grid">
          <button type="button" className="dashboard-card" onClick={() => navigate("/dashboard/insights/stock")}>
            <div>⚠ Pedidos urgentes</div>
            <h2>{pedidosUrgentes.length}</h2>
            <span className={`badge-rotacion ${pedidosUrgentes.length > 0 ? "baja" : "alta"}`}>
              {pedidosUrgentes.length > 0 ? "Urgente" : "OK"}
            </span>
          </button>

          <button type="button" className="dashboard-card" onClick={() => navigate("/proveedores")}>
            <div>📦 Entregas hoy</div>
            <h2>{entregasHoy.length}</h2>
            <span className={`badge-rotacion ${entregasHoy.length > 0 ? "alta" : "media"}`}>
              {entregasHoy.length > 0 ? "Programadas" : "Sin entrega"}
            </span>
          </button>

          <button type="button" className="dashboard-card" onClick={() => navigate("/proveedores")}>
            <div>📋 Pedidos por hacer</div>
            <h2>{pedidosHoy.length}</h2>
            <span className={`badge-rotacion ${pedidosHoy.length > 0 ? "media" : "alta"}`}>
              {pedidosHoy.length > 0 ? "Toca pedir" : "Sin pedido"}
            </span>
          </button>

          <div className="dashboard-card">
            <div>💰 Capital inventario</div>
            <h2>C${Number(metrics.stats.inversionInventarioTotal || 0).toFixed(0)}</h2>
            <span className="badge-rotacion media">Negocio</span>
          </div>
        </div>
      </div>

      <div className="section-card">
        <h3 className="section-title">Inventario</h3>
        <div className="dashboard-grid">
          <button type="button" className="dashboard-card" onClick={() => navigate("/dashboard/insights/top")}>
            <div>🔥 Top ventas</div>
            <h2>{topVentas.length}</h2>
            <span className="badge-rotacion alta">Activos</span>
          </button>

          <button type="button" className="dashboard-card" onClick={() => navigate("/dashboard/insights/stock")}>
            <div>📉 Stock bajo</div>
            <h2>{stockBajo.length}</h2>
            <span className={`badge-rotacion ${stockBajo.length > 0 ? "baja" : "alta"}`}>
              {stockBajo.length > 0 ? "Atender" : "Sano"}
            </span>
          </button>

          <button type="button" className="dashboard-card" onClick={() => navigate("/dashboard/insights/muerto")}>
            <div>🐢 Inventario muerto</div>
            <h2>{inventarioMuerto.length}</h2>
            <span className={`badge-rotacion ${inventarioMuerto.length > 0 ? "media" : "alta"}`}>
              {inventarioMuerto.length > 0 ? "Revisar" : "OK"}
            </span>
          </button>

          <button type="button" className="dashboard-card" onClick={() => navigate("/dashboard/insights/baja")}>
            <div>📈 Productos lentos</div>
            <h2>{productosLentos.length}</h2>
            <span className={`badge-rotacion ${productosLentos.length > 0 ? "media" : "alta"}`}>
              {productosLentos.length > 0 ? "Seguimiento" : "OK"}
            </span>
          </button>
        </div>
      </div>

      <div className="section-card">
        <h3 className="section-title">Inteligencia</h3>
        <div className="dashboard-grid">
          <div className="dashboard-card">
            <div>🏆 Producto lider</div>
            <h2>{topWeekly?.nombre || "-"}</h2>
            <span className="badge-rotacion alta">
              {Number(topWeekly?.rotacionSemanal || 0).toFixed(2)} UN/semana
            </span>
          </div>

          <div className="dashboard-card">
            <div>📈 Tendencia al alza</div>
            <h2>{topTrend?.nombre || "-"}</h2>
            <span className="badge-rotacion media">
              {Number(topTrend?.promedioSemanaActual || 0).toFixed(2)} UN/dia
            </span>
          </div>

          <div className="dashboard-card">
            <div>💰 Mas rentable</div>
            <h2>{topRentable?.nombre || "-"}</h2>
            <span className="badge-rotacion alta">
              C${Number(topRentable?.rentabilidadMensual || 0).toFixed(2)}
            </span>
          </div>

          <div className="dashboard-card">
            <div>📅 Dias inventario</div>
            <h2>
              {metrics.stats.diasInventarioPromedio === null
                ? "-"
                : Number(metrics.stats.diasInventarioPromedio || 0).toFixed(1)}
            </h2>
            <span className="badge-rotacion media">
              {metrics.stats.diasInventarioPromedio === null ? "Sin ventas" : "Promedio"}
            </span>
          </div>
        </div>
      </div>

      <div className="section-card">
        <h3 className="section-title">Proveedores</h3>
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
