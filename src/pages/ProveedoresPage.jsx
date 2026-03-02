import { useEffect, useMemo, useState } from "react";
import { db } from "../firebase/config";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import AppLayout from "../components/AppLayout";

function ProveedoresPage() {
  const [proveedores, setProveedores] = useState([]);
  const [busqueda, setBusqueda] = useState("");
  const [openForm, setOpenForm] = useState(false);

  const [nombre, setNombre] = useState("");
  const [nombreColaborador, setNombreColaborador] = useState("");
  const [telefono, setTelefono] = useState("");
  const [rutaCatalogo, setRutaCatalogo] = useState("");
  const [activo, setActivo] = useState(true);
  const [editingProveedor, setEditingProveedor] = useState(null);

  const loadProveedores = async () => {
    const snapshot = await getDocs(collection(db, "proveedores"));
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

    try {
      if (editingProveedor) {
        await updateDoc(doc(db, "proveedores", editingProveedor.id), {
          nombre,
          nombreColaborador,
          telefono,
          rutaCatalogo,
          activo,
          updatedAt: serverTimestamp(),
        });
      } else {
        await addDoc(collection(db, "proveedores"), {
          nombre,
          nombreColaborador,
          telefono,
          rutaCatalogo,
          activo,
          createdAt: serverTimestamp(),
        });
      }

      alert("Proveedor guardado correctamente");
      resetForm();
      setOpenForm(false);
      const data = await loadProveedores();
      setProveedores(data);
    } catch (error) {
      console.error(error);
      alert("Error creando proveedor");
    }
  };

  const handleEdit = (proveedor) => {
    setEditingProveedor(proveedor);
    setNombre(proveedor.nombre || "");
    setNombreColaborador(proveedor.nombreColaborador || "");
    setTelefono(proveedor.telefono || "");
    setRutaCatalogo(proveedor.rutaCatalogo || "");
    setActivo(proveedor.activo !== false);
    setOpenForm(true);
  };

  const handleDelete = async (id) => {
    const confirmDelete = window.confirm("Seguro que deseas eliminar este proveedor?");
    if (!confirmDelete) return;

    try {
      await deleteDoc(doc(db, "proveedores", id));
      alert("Proveedor eliminado correctamente");

      if (editingProveedor?.id === id) {
        resetForm();
        setOpenForm(false);
      }

      const data = await loadProveedores();
      setProveedores(data);
    } catch (error) {
      console.error(error);
      alert("Error eliminando proveedor");
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

      <div className="proveedores-list">
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
            <p>Ruta: {prov.rutaCatalogo || "-"}</p>

            <div className="history-actions">
              <button type="button" className="btn-secondary" onClick={() => handleEdit(prov)}>
                Editar
              </button>
              <button type="button" className="btn-primary" onClick={() => handleDelete(prov.id)}>
                Eliminar
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
                <button type="submit" className="btn-primary">
                  Guardar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppLayout>
  );
}

export default ProveedoresPage;
