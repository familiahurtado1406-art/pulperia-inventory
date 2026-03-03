import { useEffect, useMemo, useState } from "react";
import { getDocs } from "firebase/firestore";
import { userCollection } from "../services/userScopedFirestore";

const MOVEMENT_OPTIONS = [
  { value: "todos", label: "Todos" },
  { value: "conteo", label: "Conteo" },
  { value: "recibir_pedido", label: "Recibir pedido" },
  { value: "venta_estimada", label: "Venta estimada" },
  { value: "ajuste_manual", label: "Ajuste manual" },
];

const formatDateTime = (value) => {
  if (!value) return "-";
  if (value?.toDate) return value.toDate().toLocaleString();
  if (typeof value === "string") return value;
  return "-";
};

function HistorialCambios() {
  const [movimientos, setMovimientos] = useState([]);
  const [search, setSearch] = useState("");
  const [tipoMovimiento, setTipoMovimiento] = useState("todos");
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");

  useEffect(() => {
    const fetchMovimientos = async () => {
      const snapshot = await getDocs(userCollection("historial_cambios"));
      const data = snapshot.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() }));

      data.sort((a, b) => {
        const aMillis = a.fecha?.toMillis?.() || 0;
        const bMillis = b.fecha?.toMillis?.() || 0;
        return bMillis - aMillis;
      });

      setMovimientos(data);
    };

    fetchMovimientos();
  }, []);

  const movimientosFiltrados = useMemo(() => {
    const term = search.trim().toLowerCase();
    const fromMillis = fechaDesde ? new Date(`${fechaDesde}T00:00:00`).getTime() : null;
    const toMillis = fechaHasta ? new Date(`${fechaHasta}T23:59:59`).getTime() : null;

    return movimientos.filter((movimiento) => {
      if (tipoMovimiento !== "todos" && movimiento.tipoMovimiento !== tipoMovimiento) return false;

      if (fromMillis !== null || toMillis !== null) {
        const movementMillis = movimiento.fecha?.toMillis?.() || 0;
        if (fromMillis !== null && movementMillis < fromMillis) return false;
        if (toMillis !== null && movementMillis > toMillis) return false;
      }

      if (!term) return true;

      return (
        String(movimiento.nombreProducto || "").toLowerCase().includes(term) ||
        String(movimiento.productoId || "").toLowerCase().includes(term)
      );
    });
  }, [movimientos, search, tipoMovimiento, fechaDesde, fechaHasta]);

  const movimientosPorProducto = useMemo(() => {
    const grouped = {};

    movimientosFiltrados.forEach((movimiento) => {
      const productId = movimiento.productoId || "sin-id";
      if (!grouped[productId]) {
        grouped[productId] = {
          productoId: productId,
          nombreProducto: movimiento.nombreProducto || productId,
          movimientos: [],
        };
      }
      grouped[productId].movimientos.push(movimiento);
    });

    return Object.values(grouped);
  }, [movimientosFiltrados]);

  return (
    <div className="section-card">
      <h3 className="section-title">Historial de Cambios</h3>

      <div className="history-filters">
        <div className="input-group">
          <label>Buscar producto</label>
          <input
            className="input-modern"
            placeholder="Nombre o ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="input-group">
          <label>Movimiento</label>
          <select
            className="input-modern"
            value={tipoMovimiento}
            onChange={(e) => setTipoMovimiento(e.target.value)}
          >
            {MOVEMENT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="history-filters">
        <div className="input-group">
          <label>Desde</label>
          <input
            type="date"
            className="input-modern"
            value={fechaDesde}
            onChange={(e) => setFechaDesde(e.target.value)}
          />
        </div>
        <div className="input-group">
          <label>Hasta</label>
          <input
            type="date"
            className="input-modern"
            value={fechaHasta}
            onChange={(e) => setFechaHasta(e.target.value)}
          />
        </div>
      </div>

      {movimientosPorProducto.length === 0 ? (
        <p>No hay movimientos para los filtros seleccionados.</p>
      ) : (
        movimientosPorProducto.map((productGroup) => (
          <div key={productGroup.productoId} className="pedido-history-card">
            <div className="pedido-history-head">
              <h4>{productGroup.nombreProducto}</h4>
              <span className="stock-badge">ID: {productGroup.productoId}</span>
            </div>

            <div className="pedido-detail-list">
              {productGroup.movimientos.map((movimiento) => (
                <div key={movimiento.id} className="pedido-detail-item">
                  <p>
                    Tipo:{" "}
                    <strong>
                      {MOVEMENT_OPTIONS.find((option) => option.value === movimiento.tipoMovimiento)
                        ?.label || movimiento.tipoMovimiento}
                    </strong>
                  </p>
                  <p>
                    Stock: {Number(movimiento.stockAnterior || 0).toFixed(2)} {"->"} {Number(movimiento.stockNuevo || 0).toFixed(2)}
                  </p>
                  <p>Diferencia: {Number(movimiento.diferencia || 0).toFixed(2)}</p>
                  <p>Usuario: {movimiento.usuario || "sistema"}</p>
                  <p>Fecha: {formatDateTime(movimiento.fecha)}</p>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

export default HistorialCambios;

