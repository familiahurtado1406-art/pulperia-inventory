import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getDocs } from "firebase/firestore";
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

function EntregasHoyPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [providers, setProviders] = useState([]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const providersSnap = await getDocs(userCollection("proveedores"));
        setProviders(providersSnap.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() })));
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
          provider.diasEntrega,
          provider.diaEntrega ?? provider.dia_entrega
        ).includes(today)
      )
      .map((provider) => {
        const [firstPedidoDay] = normalizeProviderDays(
          provider.diasPedido,
          provider.diaFacturacion ?? provider.dia_facturacion
        );
        return {
          ...provider,
          pedidoLabel: dayLabel(firstPedidoDay),
        };
      });
  }, [providers]);

  if (loading) return <p>Cargando entregas de hoy...</p>;

  if (providersHoy.length === 0) {
    return (
      <div className="section-card">
        <h3 className="section-title">Entregas de hoy</h3>
        <p>No hay proveedores con entrega programada para hoy.</p>
      </div>
    );
  }

  return (
    <div className="section-card">
      <h3 className="section-title">Entregas de hoy</h3>
      <p>Proveedores con entrega programada hoy.</p>
      <div className="pedido-list">
        {providersHoy.map((provider) => (
          <div key={provider.id} className="pedido-card">
            <div className="pedido-card-header">
              <h4>{provider.nombre || provider.id}</h4>
              <span className="badge-rotacion alta">Entrega hoy</span>
            </div>
            <div className="pedido-card-body">
              <p>
                <strong>Pedido:</strong> {provider.pedidoLabel}
              </p>
              <p>
                <strong>Telefono:</strong> {provider.telefono || "-"}
              </p>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn-primary"
                onClick={() => navigate("/proveedores")}
              >
                Ver proveedor
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default EntregasHoyPage;
