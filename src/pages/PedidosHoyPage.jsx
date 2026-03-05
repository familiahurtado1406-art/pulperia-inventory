import { useEffect, useMemo, useState } from "react";
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

const normalizeProviderDays = (values, fallbackValue) => {
  const source = Array.isArray(values) ? values : [values ?? fallbackValue];
  return source
    .map((value) => normalizeProviderDay(value))
    .filter((value) => Number.isInteger(value) && value >= 1 && value <= 7);
};

const dayLabel = (dayNumber) =>
  (
    {
      1: "Lunes",
      2: "Martes",
      3: "Miercoles",
      4: "Jueves",
      5: "Viernes",
      6: "Sabado",
      7: "Domingo",
    }[dayNumber] || "-"
  );

function PedidosHoyPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [providers, setProviders] = useState([]);
  const [productosAnalizados, setProductosAnalizados] = useState([]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [providersSnap, analytics] = await Promise.all([
          getDocs(userCollection("proveedores")),
          getInventoryMovementAnalytics(30),
        ]);
        setProviders(providersSnap.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() })));
        setProductosAnalizados(analytics.productosAnalizados || []);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  const providersHoy = useMemo(() => {
    const today = toDayNumber(new Date());
    return providers
      .filter((provider) => provider.activo !== false)
      .filter((provider) =>
        normalizeProviderDays(
          provider.diasPedido,
          provider.diaFacturacion ?? provider.dia_facturacion
        ).includes(today)
      )
      .map((provider) => {
        const providerId = String(provider.id);
        const sugeridos = productosAnalizados.filter(
          (product) =>
            String(product.proveedorId || "") === providerId && Number(product.cantidadComprar || 0) > 0
        );
        const [firstDeliveryDay] = normalizeProviderDays(
          provider.diasEntrega,
          provider.diaEntrega ?? provider.dia_entrega
        );
        return {
          ...provider,
          sugeridosCount: sugeridos.length,
          entregaLabel: dayLabel(firstDeliveryDay),
        };
      });
  }, [providers, productosAnalizados]);

  if (loading) return <p>Cargando pedidos de hoy...</p>;

  if (providersHoy.length === 0) {
    return (
      <div className="section-card">
        <h3 className="section-title">Pedidos de hoy</h3>
        <p>No hay proveedores con pedido programado para hoy.</p>
      </div>
    );
  }

  return (
    <div className="section-card">
      <h3 className="section-title">Pedidos de hoy</h3>
      <p>Proveedores con pedido programado hoy.</p>
      <div className="pedido-list">
        {providersHoy.map((provider) => (
          <div key={provider.id} className="pedido-card">
            <div className="pedido-card-header">
              <h4>{provider.nombre || provider.id}</h4>
              <span className="badge-rotacion media">Pedido hoy</span>
            </div>
            <div className="pedido-card-body">
              <p>
                <strong>Entrega:</strong> {provider.entregaLabel}
              </p>
              <p>
                <strong>Productos sugeridos:</strong> {provider.sugeridosCount}
              </p>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn-primary"
                onClick={() => navigate("/pedido", { state: { proveedorId: provider.id } })}
              >
                Ver pedido
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default PedidosHoyPage;
