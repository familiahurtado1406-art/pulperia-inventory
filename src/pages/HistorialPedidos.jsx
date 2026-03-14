import { useEffect, useMemo, useState } from "react";
import {
  getDocs,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { FaBoxes, FaChartBar, FaBoxOpen } from "react-icons/fa";
import { userCollection, userDoc } from "../services/userScopedFirestore";

const formatDate = (value) => {
  if (!value) return "-";
  if (typeof value === "string") return value;
  if (value?.toDate) return value.toDate().toLocaleDateString();
  return "-";
};

const getCantidadBase = (prod) =>
  Number(prod.cantidadBase ?? prod.cantidadSolicitada ?? prod.unidades ?? 0);

const getUnidadesPorInterna = (prod) =>
  Number(prod.unidadesPorInterna ?? prod.unidadesPorPack ?? 0);

const formatCantidadPedido = (prod) => {
  const cantidadBase = getCantidadBase(prod);
  const medidaBase = prod.medidaBase || prod.unidad || "UN";
  const medidaInterna = prod.medidaInterna || prod.unidadInterna || null;
  const factorInterna = getUnidadesPorInterna(prod);

  if ((!medidaInterna || factorInterna <= 0) && Number(prod.pedidoPack || 0) > 0) {
    const fallbackInterna = prod.medidaInterna || prod.unidadInterna || "PACK";
    return `${cantidadBase.toFixed(2)} ${medidaBase} (${Number(prod.pedidoPack || 0).toFixed(2)} ${fallbackInterna})`;
  }

  if (!medidaInterna || factorInterna <= 0) {
    return `${cantidadBase.toFixed(2)} ${medidaBase}`;
  }

  const cantidadInterna = cantidadBase / factorInterna;
  const internaEntera = Math.floor(cantidadInterna);
  const restoBase = Number((cantidadBase - internaEntera * factorInterna).toFixed(2));

  if (Math.abs(restoBase) < 0.001) {
    return `${cantidadBase.toFixed(2)} ${medidaBase} (${internaEntera} ${medidaInterna})`;
  }

  if (internaEntera > 0) {
    return `${cantidadBase.toFixed(2)} ${medidaBase} (${internaEntera} ${medidaInterna} + ${restoBase.toFixed(2)} ${medidaBase})`;
  }

  return `${cantidadBase.toFixed(2)} ${medidaBase} (${cantidadInterna.toFixed(2)} ${medidaInterna})`;
};

const getPedidoResumen = (pedido) => {
  const productos = Array.isArray(pedido.productos) ? pedido.productos : [];
  const totalProductos = productos.length;
  const totalUnidades = productos.reduce((acc, prod) => acc + getCantidadBase(prod), 0);
  const totalInternas = productos.reduce((acc, prod) => {
    const factor = getUnidadesPorInterna(prod);
    if (factor <= 0) return acc;
    return acc + getCantidadBase(prod) / factor;
  }, 0);

  return {
    totalProductos,
    totalUnidades,
    totalInternas,
  };
};

function HistorialPedidos() {
  const [pedidos, setPedidos] = useState([]);
  const [providerPhoneById, setProviderPhoneById] = useState({});
  const [search, setSearch] = useState("");
  const [estadoFiltro, setEstadoFiltro] = useState("todos");
  const [expandedPedidoId, setExpandedPedidoId] = useState("");

  useEffect(() => {
    const fetchPedidos = async () => {
      const [pedidosSnapshot, proveedoresSnapshot] = await Promise.all([
        getDocs(userCollection("pedidos")),
        getDocs(userCollection("proveedores")),
      ]);
      const data = pedidosSnapshot.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() }));

      data.sort((a, b) => {
        const aMillis = a.fechaCreacion?.toMillis?.() || 0;
        const bMillis = b.fechaCreacion?.toMillis?.() || 0;
        return bMillis - aMillis;
      });

      setPedidos(data);
      setProviderPhoneById(
        proveedoresSnapshot.docs.reduce((acc, docItem) => {
          const proveedor = docItem.data();
          const rawPhone = String(proveedor.telefono || proveedor.phone || "").replace(/\D/g, "");
          if (rawPhone) {
            acc[docItem.id] = rawPhone;
          }
          return acc;
        }, {})
      );
    };

    fetchPedidos();
  }, []);

  const filteredPedidos = useMemo(() => {
    const term = search.trim().toLowerCase();

    return pedidos.filter((pedido) => {
      const estadoOk = estadoFiltro === "todos" || (pedido.estado || "pendiente") === estadoFiltro;
      if (!estadoOk) return false;
      if (!term) return true;

      return (pedido.productos || []).some((prod) =>
        String(prod.nombre || "").toLowerCase().includes(term)
      );
    });
  }, [pedidos, search, estadoFiltro]);

  const marcarRecibido = async (pedidoId) => {
    await updateDoc(userDoc("pedidos", pedidoId), {
      estado: "recibido",
      fechaRecibido: serverTimestamp(),
    });

    setPedidos((prev) =>
      prev.map((pedido) =>
        pedido.id === pedidoId
          ? {
              ...pedido,
              estado: "recibido",
              fechaRecibido: { toDate: () => new Date() },
            }
          : pedido
      )
    );
  };

  const getPedidoWhatsappText = (pedido) => {
    const resumen = getPedidoResumen(pedido);
    const lineasProductos = (pedido.productos || [])
      .map((prod) => `- ${prod.nombre}\n  ${formatCantidadPedido(prod)}`)
      .join("\n\n");

    return [
      "Pedido - Pulperia Hurtado",
      "",
      `Proveedor: ${pedido.proveedorNombre || pedido.proveedorId || "Proveedor"}`,
      "",
      lineasProductos,
      "",
      `Total productos: ${resumen.totalProductos}`,
      `Total unidades: ${resumen.totalUnidades.toFixed(2)} UN`,
      "",
      "Gracias.",
    ].join("\n");
  };

  const handleSendWhatsapp = (pedido) => {
    const phoneFromPedido = String(pedido.proveedorTelefono || "").replace(/\D/g, "");
    const providerPhone = providerPhoneById[String(pedido.proveedorId || "")] || "";
    const phone = phoneFromPedido || providerPhone;
    const mensaje = getPedidoWhatsappText(pedido);
    const baseUrl = phone ? `https://wa.me/${phone}` : "https://wa.me/";
    const url = `${baseUrl}?text=${encodeURIComponent(mensaje)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="section-card">
      <h3 className="section-title">Historial Pedidos</h3>

      <div className="history-filters">
        <div className="input-group">
          <label>Buscar producto</label>
          <input
            className="input-modern"
            placeholder="Buscar producto..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="input-group">
          <label>Estado</label>
          <select
            className="input-modern"
            value={estadoFiltro}
            onChange={(e) => setEstadoFiltro(e.target.value)}
          >
            <option value="todos">Todos</option>
            <option value="pendiente">Pendiente</option>
            <option value="recibido">Recibido</option>
          </select>
        </div>
      </div>

      {filteredPedidos.length === 0 ? (
        <p>No se encontro en pedidos recientes.</p>
      ) : (
        filteredPedidos.map((pedido) => (
          <div key={pedido.id} className="pedido-history-card">
            <div className="pedido-history-head">
              <h4>{pedido.proveedorNombre || pedido.proveedorId || "Proveedor"}</h4>
              <span className={`badge-estado ${pedido.estado || "pendiente"}`}>
                {pedido.estado || "pendiente"}
              </span>
            </div>
            <p>Total estimado: C${Number(pedido.totalCosto || 0).toFixed(2)}</p>
            <p>Entrega estimada: {formatDate(pedido.fechaEntregaEstimada || pedido.fechaEntrega)}</p>
            <p>Fecha recibido: {formatDate(pedido.fechaRecibido)}</p>

            <div className="history-actions">
              {(pedido.estado || "pendiente") === "pendiente" && (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => marcarRecibido(pedido.id)}
                >
                  Marcar como recibido
                </button>
              )}
              <button
                type="button"
                className="btn-secondary"
                onClick={() => handleSendWhatsapp(pedido)}
              >
                Enviar por WhatsApp
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() =>
                  setExpandedPedidoId((prev) => (prev === pedido.id ? "" : pedido.id))
                }
              >
                {expandedPedidoId === pedido.id ? "Ocultar detalles" : "Ver detalles"}
              </button>
            </div>

            {expandedPedidoId === pedido.id && (
              <div className="pedido-detail-list">
                {(() => {
                  const resumen = getPedidoResumen(pedido);
                  return (
                    <div className="pedido-detail-item">
                      <p style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <FaBoxes color="#2563eb" />
                        <span>Total productos: {resumen.totalProductos}</span>
                      </p>
                      <p style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <FaChartBar color="#16a34a" />
                        <span>Total unidades: {resumen.totalUnidades.toFixed(2)} UN</span>
                      </p>
                      <p style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <FaBoxOpen color="#f59e0b" />
                        <span>Total internas (equivalente): {resumen.totalInternas.toFixed(2)}</span>
                      </p>
                    </div>
                  );
                })()}
                {(pedido.productos || []).map((prod, index) => (
                  <div
                    key={`${pedido.id}-${prod.productoId || index}`}
                    className="pedido-detail-item"
                  >
                    <p>{prod.nombre}</p>
                    <p>
                      Cantidad: {formatCantidadPedido(prod)}
                    </p>
                    <p>
                      Costo unitario: C$
                      {Number(prod.costoUnitarioBase ?? prod.costoUnitario ?? 0).toFixed(2)}
                    </p>
                    <p>Costo total: C${Number(prod.costoTotal || 0).toFixed(2)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

export default HistorialPedidos;
