import { useEffect, useMemo, useState } from "react";
import { getDocs } from "firebase/firestore";
import {
  deactivateProviderProductLink,
  getProviderProductLinksByProduct,
  setPreferredProviderProductLink,
  upsertProviderProductLink,
} from "../services/providerProductService";
import { userCollection } from "../services/userScopedFirestore";

function SeccionDistribuidores({
  producto,
  draftProviders = [],
  onDraftProvidersChange = null,
  medidaBaseOverride = "UN",
  medidaInternaOverride = "PACK",
  unidadesPorInternaOverride = 0,
}) {
  const [relaciones, setRelaciones] = useState([]);
  const [proveedores, setProveedores] = useState([]);
  const [openModal, setOpenModal] = useState(false);
  const [selectedProveedorId, setSelectedProveedorId] = useState("");
  const [costoUnitario, setCostoUnitario] = useState("");
  const [costoPack, setCostoPack] = useState("");
  const isDraftMode = !producto?.id;
  const medidaBase = producto?.medidaBase || medidaBaseOverride || "UN";
  const medidaInterna = producto?.medidaInterna || medidaInternaOverride || "PACK";
  const unidadesPorInterna = Number(
    producto?.unidadesPorInterna ??
      producto?.unidadesPorPack ??
      unidadesPorInternaOverride ??
      0
  );
  const usaCostoUnitarioCalculado = Number(costoPack || 0) > 0 && unidadesPorInterna > 0;
  const costoUnitarioCalculado = useMemo(() => {
    if (!usaCostoUnitarioCalculado) return "";
    return (Number(costoPack || 0) / unidadesPorInterna).toFixed(2);
  }, [costoPack, unidadesPorInterna, usaCostoUnitarioCalculado]);
  const relacionesVisibles = isDraftMode ? draftProviders : relaciones;

  const proveedoresMap = useMemo(() => {
    const map = {};
    proveedores.forEach((p) => {
      map[p.id] = p.nombre || p.id;
    });
    return map;
  }, [proveedores]);

  const mejorCosto = useMemo(() => {
    const withCost = relacionesVisibles.filter((item) => Number(item.costoUnitario || 0) > 0);
    if (withCost.length === 0) return null;
    return [...withCost].sort((a, b) => Number(a.costoUnitario || 0) - Number(b.costoUnitario || 0))[0];
  }, [relacionesVisibles]);
  const entregaMasRapidaDias = useMemo(() => {
    const values = relacionesVisibles
      .map((item) => {
        const provider = proveedores.find((p) => String(p.id) === String(item.proveedorId));
        return Number(
          provider?.frecuenciaEntregaDias ?? provider?.frecuencia_entrega_dias ?? 0
        );
      })
      .filter((value) => Number(value) > 0);
    if (values.length === 0) return null;
    return Math.min(...values);
  }, [relacionesVisibles, proveedores]);

  const loadRelaciones = async () => {
    if (isDraftMode) {
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
    if (isDraftMode) return;
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
  }, [producto?.id, producto?.productoId, isDraftMode]);

  const handleOpenModal = () => {
    const usados = new Set(relacionesVisibles.map((r) => String(r.proveedorId || "")));
    const first = proveedores.find((p) => !usados.has(String(p.id)));
    setSelectedProveedorId(first?.id || "");
    setCostoUnitario("");
    setCostoPack("");
    setOpenModal(true);
  };

  const handleGuardar = async () => {
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

    if (isDraftMode) {
      if (typeof onDraftProvidersChange !== "function") return;

      const providerData = {
        proveedorId: selectedProveedorId,
        proveedorNombre: proveedoresMap[selectedProveedorId] || selectedProveedorId,
        costoUnitario: Number(costoUnitarioFinal),
        costoPack: costoPack === "" ? null : Number(costoPack),
        preferido: false,
        activo: true,
      };
      onDraftProvidersChange((prev) => {
        const current = Array.isArray(prev) ? prev : [];
        const withoutProvider = current.filter(
          (item) => String(item.proveedorId) !== String(selectedProveedorId)
        );
        return [...withoutProvider, providerData];
      });
      setOpenModal(false);
      return;
    }

    await upsertProviderProductLink({
      productDocId: producto.id,
      productoId: producto.productoId || producto.id,
      proveedorId: selectedProveedorId,
      proveedorNombre: proveedoresMap[selectedProveedorId] || selectedProveedorId,
      costoUnitario: costoUnitarioFinal,
      costoPack: costoPack === "" ? null : Number(costoPack),
      activo: true,
    });

    await loadRelaciones();
    setOpenModal(false);
  };

  const handleEliminarRelacion = async (dist) => {
    const providerName =
      dist.proveedorNombre || proveedoresMap[dist.proveedorId] || dist.proveedorId || "Proveedor";
    const confirmDelete = window.confirm(
      `${providerName} ya no vende este producto?\n\nEsta accion desvinculara el distribuidor del producto.`
    );
    if (!confirmDelete) return;

    if (isDraftMode) {
      if (typeof onDraftProvidersChange !== "function") return;
      onDraftProvidersChange((prev) =>
        (Array.isArray(prev) ? prev : []).filter(
          (item) => String(item.proveedorId) !== String(dist.proveedorId)
        )
      );
      return;
    }

    await deactivateProviderProductLink({
      productDocId: producto.id,
      productoId: producto.productoId || producto.id,
      proveedorId: dist.proveedorId,
    });
    await loadRelaciones();
  };

  const handleTogglePreferido = async (dist) => {
    if (isDraftMode) {
      if (typeof onDraftProvidersChange !== "function") return;
      const targetId = String(dist.proveedorId || "");
      const setPreferred = !dist.preferido;
      onDraftProvidersChange((prev) =>
        (Array.isArray(prev) ? prev : []).map((item) => ({
          ...item,
          preferido:
            setPreferred && String(item.proveedorId || "") === targetId,
        }))
      );
      return;
    }

    await setPreferredProviderProductLink({
      productDocId: producto.id,
      productoId: producto.productoId || producto.id,
      proveedorId: String(dist.proveedorId || ""),
    });
    await loadRelaciones();
  };

  return (
    <details className="distributors-panel" open>
      <summary>Distribuidores asociados</summary>
      {relacionesVisibles.length === 0 ? (
        <p>No hay distribuidores asociados.</p>
      ) : (
        <div className="distributors-list">
          {relacionesVisibles.map((dist) => {
            const isBest =
              !!mejorCosto && String(mejorCosto.proveedorId) === String(dist.proveedorId);

            return (
              <div
                key={`${dist.productDocId || producto?.id}-${dist.proveedorId}`}
                className="pedido-detail-item"
              >
                <div className="distributor-row">
                  <p>
                    <strong>
                      {dist.proveedorNombre || proveedoresMap[dist.proveedorId] || dist.proveedorId}
                    </strong>
                  </p>
                  <div className="distributor-actions">
                    <button
                      type="button"
                      className="btn-secondary distributor-delete-btn"
                      onClick={() => handleTogglePreferido(dist)}
                    >
                      {dist.preferido ? "Quitar preferido" : "Preferido"}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary distributor-delete-btn"
                      onClick={() => handleEliminarRelacion(dist)}
                    >
                      Eliminar
                    </button>
                  </div>
                </div>
                <div className="provider-badges">
                  {isBest && <span className="provider-badge cost">Mejor precio</span>}
                  {(() => {
                    const provider = proveedores.find(
                      (p) => String(p.id) === String(dist.proveedorId)
                    );
                    const freq = Number(
                      provider?.frecuenciaEntregaDias ?? provider?.frecuencia_entrega_dias ?? 0
                    );
                    return (
                      entregaMasRapidaDias !== null &&
                      freq > 0 &&
                      freq === entregaMasRapidaDias
                    );
                  })() && <span className="provider-badge speed">Entrega rapida</span>}
                  {!!dist.preferido && <span className="provider-badge preferred">Preferido</span>}
                </div>
                <p>Costo unitario: C${Number(dist.costoUnitario || 0).toFixed(2)}</p>
                {isBest && <p className="best-provider">Mejor costo</p>}
              </div>
            );
          })}
        </div>
      )}
      {relacionesVisibles.length === 0 && (
        <p className="warning-provider">Este producto no tiene distribuidores activos.</p>
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
              {unidadesPorInterna > 0 && (
                <small>
                  1 {medidaInterna} = {unidadesPorInterna} {medidaBase}
                </small>
              )}
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
