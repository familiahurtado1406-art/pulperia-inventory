import { useEffect, useMemo, useState } from "react";
import {
  getDocs,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { userCollection, userDoc } from "../services/userScopedFirestore";

const formatDate = (value) => {
  if (!value) return "-";
  if (typeof value === "string") return value;
  if (value?.toDate) return value.toDate().toLocaleDateString();
  return "-";
};

function HistorialPedidos() {
  const [pedidos, setPedidos] = useState([]);
  const [search, setSearch] = useState("");
  const [estadoFiltro, setEstadoFiltro] = useState("todos");
  const [expandedPedidoId, setExpandedPedidoId] = useState("");

  useEffect(() => {
    const fetchPedidos = async () => {
      const snapshot = await getDocs(userCollection("pedidos"));
      const data = snapshot.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() }));

      data.sort((a, b) => {
        const aMillis = a.fechaCreacion?.toMillis?.() || 0;
        const bMillis = b.fechaCreacion?.toMillis?.() || 0;
        return bMillis - aMillis;
      });

      setPedidos(data);
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
                onClick={() =>
                  setExpandedPedidoId((prev) => (prev === pedido.id ? "" : pedido.id))
                }
              >
                {expandedPedidoId === pedido.id ? "Ocultar detalles" : "Ver detalles"}
              </button>
            </div>

            {expandedPedidoId === pedido.id && (
              <div className="pedido-detail-list">
                {(pedido.productos || []).map((prod, index) => (
                  <div
                    key={`${pedido.id}-${prod.productoId || index}`}
                    className="pedido-detail-item"
                  >
                    <p>{prod.nombre}</p>
                    <p>
                      Cantidad: {Number(prod.cantidadBase ?? prod.cantidadSolicitada ?? 0).toFixed(2)}{" "}
                      {prod.medidaBase || prod.unidad || "UN"}
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
