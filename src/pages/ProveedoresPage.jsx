import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import {
  addDoc,
  deleteDoc,
  getDocs,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import AppLayout from "../components/AppLayout";
import { confirmToast } from "../services/confirmToast";
import { userCollection, userDoc } from "../services/userScopedFirestore";

const DAY_OPTIONS = [
  { value: 1, label: "Lunes" },
  { value: 2, label: "Martes" },
  { value: 3, label: "Miercoles" },
  { value: 4, label: "Jueves" },
  { value: 5, label: "Viernes" },
  { value: 6, label: "Sabado" },
  { value: 7, label: "Domingo" },
];

const DAY_BY_NAME = {
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

const normalizeDay = (value, fallback = 1) => {
  if (value === null || value === undefined || value === "") return fallback;
  const asNumber = Number(value);
  if (Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= 7) return asNumber;
  const fromName = DAY_BY_NAME[String(value).trim().toLowerCase()];
  return fromName || fallback;
};

const normalizeDayList = (value, fallback = 1) => {
  if (Array.isArray(value) && value.length > 0) {
    return [...new Set(value.map((item) => normalizeDay(item, fallback)))].sort((a, b) => a - b);
  }
  return [normalizeDay(value, fallback)];
};

const dayLabels = (values) =>
  normalizeDayList(values, 1)
    .map((value) => DAY_OPTIONS.find((option) => option.value === value)?.label)
    .filter(Boolean)
    .join(", ");

function ProveedoresPage() {
  const [proveedores, setProveedores] = useState([]);
  const [busqueda, setBusqueda] = useState("");
  const [openForm, setOpenForm] = useState(false);

  const [nombre, setNombre] = useState("");
  const [nombreColaborador, setNombreColaborador] = useState("");
  const [telefono, setTelefono] = useState("");
  const [rutaCatalogo, setRutaCatalogo] = useState("");
  const [diasEntrega, setDiasEntrega] = useState([4]);
  const [diasPedido, setDiasPedido] = useState([2]);
  const [frecuenciaEntregaDias, setFrecuenciaEntregaDias] = useState(7);
  const [frecuenciaVisitaDias, setFrecuenciaVisitaDias] = useState(7);
  const [activo, setActivo] = useState(true);
  const [editingProveedor, setEditingProveedor] = useState(null);
  const [detalleProveedor, setDetalleProveedor] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const loadProveedores = async () => {
    const snapshot = await getDocs(userCollection("proveedores"));
    const data = snapshot.docs.map((docItem) => ({
      id: docItem.id,
      ...docItem.data(),
    }));
    return data;
  };

  const resetForm = () => {
    setNombre("");
    setNombreColaborador("");
    setTelefono("");
    setRutaCatalogo("");
    setDiasEntrega([4]);
    setDiasPedido([2]);
    setFrecuenciaEntregaDias(7);
    setFrecuenciaVisitaDias(7);
    setActivo(true);
    setEditingProveedor(null);
  };

  useEffect(() => {
    const fetchOnMount = async () => {
      const data = await loadProveedores();
      setProveedores(data);
    };
    fetchOnMount();
  }, []);

  const proveedoresFiltrados = useMemo(() => {
    const term = busqueda.trim().toLowerCase();
    if (!term) return proveedores;
    return proveedores.filter((p) =>
      String(p.nombre || "").toLowerCase().includes(term)
    );
  }, [proveedores, busqueda]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSaving(true);

    try {
      const diasEntregaValue = normalizeDayList(diasEntrega, 4);
      const diasPedidoValue = normalizeDayList(diasPedido, 2);
      const diaEntregaValue = diasEntregaValue[0] || 4;
      const diaFacturacionValue = diasPedidoValue[0] || 2;

      if (editingProveedor) {
        const frecuenciaEntregaValue = Number(frecuenciaEntregaDias || 7);
        const frecuenciaVisitaValue = Number(frecuenciaVisitaDias || 7);
        await updateDoc(userDoc("proveedores", editingProveedor.id), {
          nombre,
          nombreColaborador,
          telefono,
          rutaCatalogo,
          diaEntrega: diaEntregaValue,
          dia_entrega: diaEntregaValue,
          diasEntrega: diasEntregaValue,
          diaFacturacion: diaFacturacionValue,
          dia_facturacion: diaFacturacionValue,
          diasPedido: diasPedidoValue,
          frecuenciaEntregaDias: frecuenciaEntregaValue,
          frecuencia_entrega_dias: frecuenciaEntregaValue,
          frecuenciaVisitaDias: frecuenciaVisitaValue,
          frecuencia_visita_dias: frecuenciaVisitaValue,
          activo,
          updatedAt: serverTimestamp(),
        });
      } else {
        const frecuenciaEntregaValue = Number(frecuenciaEntregaDias || 7);
        const frecuenciaVisitaValue = Number(frecuenciaVisitaDias || 7);
        await addDoc(userCollection("proveedores"), {
          nombre,
          nombreColaborador,
          telefono,
          rutaCatalogo,
          diaEntrega: diaEntregaValue,
          dia_entrega: diaEntregaValue,
          diasEntrega: diasEntregaValue,
          diaFacturacion: diaFacturacionValue,
          dia_facturacion: diaFacturacionValue,
          diasPedido: diasPedidoValue,
          frecuenciaEntregaDias: frecuenciaEntregaValue,
          frecuencia_entrega_dias: frecuenciaEntregaValue,
          frecuenciaVisitaDias: frecuenciaVisitaValue,
          frecuencia_visita_dias: frecuenciaVisitaValue,
          activo,
          createdAt: serverTimestamp(),
        });
      }

      toast.success("Proveedor guardado correctamente");
      resetForm();
      setOpenForm(false);
      const data = await loadProveedores();
      setProveedores(data);
    } catch (error) {
      console.error(error);
      toast.error("Error guardando proveedor");
    } finally {
      setIsSaving(false);
    }
  };

  const handleEdit = (proveedor) => {
    setEditingProveedor(proveedor);
    setNombre(proveedor.nombre || "");
    setNombreColaborador(proveedor.nombreColaborador || "");
    setTelefono(proveedor.telefono || "");
    setRutaCatalogo(proveedor.rutaCatalogo || "");
    setDiasEntrega(
      normalizeDayList(proveedor.diasEntrega ?? proveedor.diaEntrega ?? proveedor.dia_entrega, 4)
    );
    setDiasPedido(
      normalizeDayList(
        proveedor.diasPedido ?? proveedor.diaFacturacion ?? proveedor.dia_facturacion,
        2
      )
    );
    setFrecuenciaEntregaDias(
      Number(proveedor.frecuenciaEntregaDias ?? proveedor.frecuencia_entrega_dias ?? 7)
    );
    setFrecuenciaVisitaDias(
      Number(proveedor.frecuenciaVisitaDias ?? proveedor.frecuencia_visita_dias ?? 7)
    );
    setActivo(proveedor.activo !== false);
    setOpenForm(true);
  };

  const toggleDay = (dayValue, currentList, setList) => {
    if (currentList.includes(dayValue)) {
      setList(currentList.filter((value) => value !== dayValue));
      return;
    }
    setList([...currentList, dayValue].sort((a, b) => a - b));
  };

  const handleDelete = async (id) => {
    const confirmDelete = await confirmToast({
      title: "Eliminar proveedor",
      description: "Seguro que deseas eliminar este proveedor?",
      confirmLabel: "Eliminar",
      confirmTone: "danger",
    });
    if (!confirmDelete) return;
    setIsDeleting(true);

    try {
      await deleteDoc(userDoc("proveedores", id));
      toast.success("Proveedor eliminado correctamente");

      if (editingProveedor?.id === id) {
        resetForm();
        setOpenForm(false);
      }

      const data = await loadProveedores();
      setProveedores(data);
    } catch (error) {
      console.error(error);
      toast.error("Error eliminando proveedor");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <AppLayout
      title="Proveedores"
      onAdd={() => {
        resetForm();
        setOpenForm(true);
      }}
    >
      <div className="section-card">
        <div className="input-group">
          <label>Buscar proveedor</label>
          <input
            className="input-modern"
            placeholder="Buscar proveedor..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </div>
      </div>

      <div
        className="proveedores-list"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: "12px",
        }}
      >
        {proveedoresFiltrados.map((prov) => (
          <div key={prov.id} className="proveedor-card">
            <div className="prov-header">
              <h4>{prov.nombre}</h4>
              {prov.activo !== false ? (
                <span className="badge-activo">Activo</span>
              ) : (
                <span className="badge-inactivo">Inactivo</span>
              )}
            </div>

            <p>Colaborador: {prov.nombreColaborador || "-"}</p>
            <p>Telefono: {prov.telefono || "-"}</p>
            <p>
              Dias entrega:{" "}
              {dayLabels(prov.diasEntrega ?? prov.diaEntrega ?? prov.dia_entrega) || "-"}
            </p>

            <div className="history-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setDetalleProveedor(prov)}
              >
                Detalles
              </button>
              <button type="button" className="btn-secondary" onClick={() => handleEdit(prov)}>
                Editar
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => handleDelete(prov.id)}
                disabled={isDeleting}
              >
                {isDeleting ? "Eliminando..." : "Eliminar"}
              </button>
            </div>
          </div>
        ))}
      </div>

      {openForm && (
        <div className="modal-overlay" onClick={() => setOpenForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{editingProveedor ? "Editar Proveedor" : "Nuevo Proveedor"}</h3>

            <form onSubmit={handleSubmit}>
              <div className="input-group">
                <label>Nombre proveedor</label>
                <input
                  className="input-modern"
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  required
                />
              </div>

              <div className="input-group">
                <label>Nombre colaborador</label>
                <input
                  className="input-modern"
                  value={nombreColaborador}
                  onChange={(e) => setNombreColaborador(e.target.value)}
                />
              </div>

              <div className="input-group">
                <label>Telefono</label>
                <input
                  className="input-modern"
                  value={telefono}
                  onChange={(e) => setTelefono(e.target.value)}
                />
              </div>

              <div className="input-group">
                <label>Ruta catalogo</label>
                <input
                  className="input-modern"
                  value={rutaCatalogo}
                  onChange={(e) => setRutaCatalogo(e.target.value)}
                />
              </div>

              <div className="form-section">
                <h4>Logistica de proveedor</h4>
                <div className="input-group">
                  <label>Dias de entrega</label>
                  <div className="row" style={{ gap: "8px" }}>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setDiasEntrega(DAY_OPTIONS.map((option) => option.value))}
                    >
                      Seleccionar todos
                    </button>
                    <button type="button" className="btn-secondary" onClick={() => setDiasEntrega([])}>
                      Limpiar
                    </button>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
                    {DAY_OPTIONS.map((option) => (
                      <label key={`entrega-${option.value}`}>
                        <input
                          type="checkbox"
                          checked={diasEntrega.includes(option.value)}
                          onChange={() => toggleDay(option.value, diasEntrega, setDiasEntrega)}
                        />{" "}
                        {option.label}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="input-group">
                  <label>Dias de pedido / facturacion</label>
                  <div className="row" style={{ gap: "8px" }}>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setDiasPedido(DAY_OPTIONS.map((option) => option.value))}
                    >
                      Seleccionar todos
                    </button>
                    <button type="button" className="btn-secondary" onClick={() => setDiasPedido([])}>
                      Limpiar
                    </button>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
                    {DAY_OPTIONS.map((option) => (
                      <label key={`pedido-${option.value}`}>
                        <input
                          type="checkbox"
                          checked={diasPedido.includes(option.value)}
                          onChange={() => toggleDay(option.value, diasPedido, setDiasPedido)}
                        />{" "}
                        {option.label}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="input-group">
                  <label>Frecuencia de entrega (dias)</label>
                  <input
                    className="input-modern"
                    type="number"
                    min="1"
                    value={frecuenciaEntregaDias}
                    onChange={(e) =>
                      setFrecuenciaEntregaDias(Number(e.target.value || 1))
                    }
                  />
                </div>

                <div className="input-group">
                  <label>Frecuencia visita vendedor (dias)</label>
                  <input
                    className="input-modern"
                    type="number"
                    min="1"
                    value={frecuenciaVisitaDias}
                    onChange={(e) =>
                      setFrecuenciaVisitaDias(Number(e.target.value || 1))
                    }
                  />
                </div>
              </div>

              <div className="input-group">
                <label>
                  <input
                    type="checkbox"
                    checked={activo}
                    onChange={(e) => setActivo(e.target.checked)}
                  />{" "}
                  Activo
                </label>
              </div>

              <div className="modal-buttons">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setOpenForm(false);
                    resetForm();
                  }}
                >
                  Cancelar
                </button>
                <button type="submit" className="btn-primary" disabled={isSaving}>
                  {isSaving ? "Guardando..." : "Guardar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {detalleProveedor && (
        <div className="modal-overlay" onClick={() => setDetalleProveedor(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{detalleProveedor.nombre}</h3>

            <div className="input-group">
              <label>Colaborador</label>
              <div className="input-modern">{detalleProveedor.nombreColaborador || "-"}</div>
            </div>

            <div className="input-group">
              <label>Telefono</label>
              <div className="input-modern">{detalleProveedor.telefono || "-"}</div>
            </div>

            <div className="input-group">
              <label>Ruta</label>
              <div className="input-modern">{detalleProveedor.rutaCatalogo || "-"}</div>
            </div>

            <div className="input-group">
              <label>Dias entrega</label>
              <div className="input-modern">
                {dayLabels(
                  detalleProveedor.diasEntrega ??
                    detalleProveedor.diaEntrega ??
                    detalleProveedor.dia_entrega
                ) || "-"}
              </div>
            </div>

            <div className="input-group">
              <label>Dias pedido</label>
              <div className="input-modern">
                {dayLabels(
                  detalleProveedor.diasPedido ??
                    detalleProveedor.diaFacturacion ??
                    detalleProveedor.dia_facturacion
                ) || "-"}
              </div>
            </div>

            <div className="input-group">
              <label>Frecuencia entrega</label>
              <div className="input-modern">
                {Number(
                  detalleProveedor.frecuenciaEntregaDias ??
                    detalleProveedor.frecuencia_entrega_dias ??
                    7
                )}{" "}
                dias
              </div>
            </div>

            <div className="input-group">
              <label>Frecuencia visita</label>
              <div className="input-modern">
                {Number(
                  detalleProveedor.frecuenciaVisitaDias ??
                    detalleProveedor.frecuencia_visita_dias ??
                    7
                )}{" "}
                dias
              </div>
            </div>

            <div className="modal-buttons">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setDetalleProveedor(null)}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}

export default ProveedoresPage;
