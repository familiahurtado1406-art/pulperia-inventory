import { useEffect, useMemo, useState } from "react";
import { getDocs } from "firebase/firestore";
import {
  getProviderProductLinksByProduct,
  upsertProviderProductLink,
} from "../services/providerProductService";
import { userCollection } from "../services/userScopedFirestore";

function SeccionDistribuidores({ producto }) {
  const [relaciones, setRelaciones] = useState([]);
  const [proveedores, setProveedores] = useState([]);
  const [openModal, setOpenModal] = useState(false);
  const [selectedProveedorId, setSelectedProveedorId] = useState("");
  const [costoUnitario, setCostoUnitario] = useState("");
  const [costoPack, setCostoPack] = useState("");
  const [promedioEntrega, setPromedioEntrega] = useState("");
  const unidadesPorInterna = Number(producto?.unidadesPorInterna ?? producto?.unidadesPorPack ?? 0);
  const usaCostoUnitarioCalculado = Number(costoPack || 0) > 0 && unidadesPorInterna > 0;
  const costoUnitarioCalculado = useMemo(() => {
    if (!usaCostoUnitarioCalculado) return "";
    return (Number(costoPack || 0) / unidadesPorInterna).toFixed(2);
  }, [costoPack, unidadesPorInterna, usaCostoUnitarioCalculado]);

  const proveedoresMap = useMemo(() => {
    const map = {};
    proveedores.forEach((p) => {
      map[p.id] = p.nombre || p.id;
    });
    return map;
  }, [proveedores]);

  const mejorCosto = useMemo(() => {
    const withCost = relaciones.filter((item) => Number(item.costoUnitario || 0) > 0);
    if (withCost.length === 0) return null;
    return [...withCost].sort((a, b) => Number(a.costoUnitario || 0) - Number(b.costoUnitario || 0))[0];
  }, [relaciones]);

  const loadRelaciones = async () => {
    if (!producto?.id) {
      setRelaciones([]);
      return;
    }

    const links = await getProviderProductLinksByProduct({
      productDocId: producto.id,
      productoId: producto.productoId || producto.id,
    });
    setRelaciones(links);
  };

  useEffect(() => {
    const fetchProveedores = async () => {
      const snap = await getDocs(userCollection("proveedores"));
      setProveedores(snap.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() })));
    };
    fetchProveedores();
  }, []);

  useEffect(() => {
    if (!producto?.id) return;
    let cancelled = false;

    const load = async () => {
      const links = await getProviderProductLinksByProduct({
        productDocId: producto.id,
        productoId: producto.productoId || producto.id,
      });
      if (!cancelled) {
        setRelaciones(links);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [producto?.id, producto?.productoId]);

  const handleOpenModal = () => {
    const usados = new Set(relaciones.map((r) => String(r.proveedorId || "")));
    const first = proveedores.find((p) => !usados.has(String(p.id)));
    setSelectedProveedorId(first?.id || "");
    setCostoUnitario("");
    setCostoPack("");
    setPromedioEntrega("");
    setOpenModal(true);
  };

  const handleGuardar = async () => {
    if (!producto?.id) return;
    if (!selectedProveedorId) {
      alert("Selecciona un distribuidor");
      return;
    }
    const costoUnitarioFinal = Number(
      usaCostoUnitarioCalculado ? costoUnitarioCalculado : costoUnitario
    );
    if (costoUnitarioFinal <= 0) {
      alert("Ingresa un costo unitario valido");
      return;
    }

    await upsertProviderProductLink({
      productDocId: producto.id,
      productoId: producto.productoId || producto.id,
      proveedorId: selectedProveedorId,
      proveedorNombre: proveedoresMap[selectedProveedorId] || selectedProveedorId,
      costoUnitario: costoUnitarioFinal,
      costoPack: costoPack === "" ? null : Number(costoPack),
      promedioEntrega: promedioEntrega === "" ? null : Number(promedioEntrega),
      activo: true,
    });

    await loadRelaciones();
    setOpenModal(false);
  };

  return (
    <details className="distributors-panel" open>
      <summary>Distribuidores asociados</summary>
      {relaciones.length === 0 ? (
        <p>No hay distribuidores asociados.</p>
      ) : (
        <div className="distributors-list">
          {relaciones.map((dist) => {
            const isBest =
              !!mejorCosto && String(mejorCosto.proveedorId) === String(dist.proveedorId);

            return (
              <div
                key={`${dist.productDocId || producto?.id}-${dist.proveedorId}`}
                className="pedido-detail-item"
              >
                <p>
                  <strong>
                    {dist.proveedorNombre || proveedoresMap[dist.proveedorId] || dist.proveedorId}
                  </strong>
                </p>
                <p>Costo unitario: C${Number(dist.costoUnitario || 0).toFixed(2)}</p>
                <p>Promedio entrega: {Number(dist.promedioEntrega || 0).toFixed(2)} dias</p>
                {isBest && <p className="best-provider">Mejor costo</p>}
              </div>
            );
          })}
        </div>
      )}
      <button type="button" className="btn-secondary" onClick={handleOpenModal}>
        + Agregar distribuidor
      </button>

      {openModal && (
        <div className="modal-overlay" onClick={() => setOpenModal(false)}>
          <div className="modal modal-compact" onClick={(e) => e.stopPropagation()}>
            <h3>Agregar distribuidor</h3>

            <div className="input-group">
              <label>Seleccionar proveedor</label>
              <select
                className="input-modern"
                value={selectedProveedorId}
                onChange={(e) => setSelectedProveedorId(e.target.value)}
              >
                <option value="">Seleccionar proveedor</option>
                {proveedores.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.nombre}
                  </option>
                ))}
              </select>
            </div>

            <div className="input-group">
              <label>Costo unitario</label>
              <input
                className="input-modern"
                type="number"
                value={usaCostoUnitarioCalculado ? costoUnitarioCalculado : costoUnitario}
                onChange={(e) => setCostoUnitario(e.target.value)}
                readOnly={usaCostoUnitarioCalculado}
              />
              {usaCostoUnitarioCalculado && (
                <small>Calculado automaticamente segun pack.</small>
              )}
            </div>

            <div className="input-group">
              <label>Costo pack</label>
              <input
                className="input-modern"
                type="number"
                value={costoPack}
                onChange={(e) => setCostoPack(e.target.value)}
              />
            </div>

            <div className="input-group">
              <label>Promedio entrega (dias)</label>
              <input
                className="input-modern"
                type="number"
                value={promedioEntrega}
                onChange={(e) => setPromedioEntrega(e.target.value)}
              />
            </div>

            <div className="modal-buttons">
              <button type="button" className="btn-secondary" onClick={() => setOpenModal(false)}>
                Cancelar
              </button>
              <button type="button" className="btn-primary" onClick={handleGuardar}>
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </details>
  );
}

export default SeccionDistribuidores;
