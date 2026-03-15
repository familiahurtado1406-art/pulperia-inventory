import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import toast from "react-hot-toast";
import {
  addDoc,
  serverTimestamp,
} from "firebase/firestore";
import {
  getStockBaseValue,
  getWeeklyRotationByProduct,
} from "../services/inventoryHistoryService";
import { getProviderProductLinksByProvider } from "../services/providerProductService";
import {
  fetchActiveProducts,
  subscribeActiveProducts,
  subscribeUserCollection,
} from "../services/realtimeFirestoreService";
import { userCollection } from "../services/userScopedFirestore";

const getTomorrowIsoDate = () => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.toISOString().slice(0, 10);
};

function RealizarPedido() {
  const location = useLocation();
  const [proveedores, setProveedores] = useState([]);
  const [historialPedidos, setHistorialPedidos] = useState([]);
  const [proveedorSeleccionado, setProveedorSeleccionado] = useState("");
  const [proveedorSearch, setProveedorSearch] = useState("");
  const [showProveedorSuggestions, setShowProveedorSuggestions] = useState(false);
  const [fechaEntrega, setFechaEntrega] = useState(getTomorrowIsoDate);
  const [productos, setProductos] = useState([]);
  const [pedido, setPedido] = useState({});
  const [rotacionPorProducto, setRotacionPorProducto] = useState({});
  const [providerLinkByProductId, setProviderLinkByProductId] = useState({});
    const [isSavingPedido, setIsSavingPedido] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [sortBy, setSortBy] = useState("name");
  const [statusFilter, setStatusFilter] = useState("all");
  const [draftProductSearch, setDraftProductSearch] = useState("");
  const [draftSortBy, setDraftSortBy] = useState("name");
  const [draftStatusFilter, setDraftStatusFilter] = useState("all");

  const proveedoresMap = useMemo(() => {
    const map = {};
    proveedores.forEach((p) => {
      map[p.id] = p.nombre || p.id;
    });
    return map;
  }, [proveedores]);

  const proveedorSeleccionadoNombre = useMemo(
    () => proveedoresMap[proveedorSeleccionado] || "",
    [proveedorSeleccionado, proveedoresMap]
  );

  const proveedoresFiltrados = useMemo(() => {
    const term = proveedorSearch.trim().toLowerCase();
    if (!term) return proveedores.slice(0, 12);
    return proveedores
      .filter((proveedor) =>
        String(proveedor.nombre || proveedor.id || "").toLowerCase().includes(term)
      )
      .slice(0, 12);
  }, [proveedorSearch, proveedores]);

  const getStockBase = useCallback((producto) => getStockBaseValue(producto), []);

  const calcularRecomendadoStock = useCallback(
    (producto) => {
      const faltante = Number(producto.stockObjetivo || 0) - getStockBase(producto);
      return faltante > 0 ? faltante : 0;
    },
    [getStockBase]
  );

  const diasHastaEntrega = useMemo(() => {
    if (!fechaEntrega) return 0;
    const hoy = new Date();
    const entrega = new Date(fechaEntrega);
    const diferencia = (entrega - hoy) / (1000 * 60 * 60 * 24);
    return Number.isFinite(diferencia) ? Math.max(0, diferencia) : 0;
  }, [fechaEntrega]);

  const getProductoId = useCallback((producto) => String(producto.productoId || producto.id), []);

  const getRecomendacionRotacion = useCallback(
    (producto) => {
      const productoId = getProductoId(producto);
      const rotacionDiaria = Number(rotacionPorProducto[productoId] || 0);
      return rotacionDiaria * diasHastaEntrega;
    },
    [diasHastaEntrega, getProductoId, rotacionPorProducto]
  );

  const calcularRecomendadoFinal = useCallback(
    (producto) => {
      const stockObjetivo = Number(calcularRecomendadoStock(producto) || 0);
      const rotacionExtra = Number(getRecomendacionRotacion(producto) || 0);
      return stockObjetivo + rotacionExtra;
    },
    [calcularRecomendadoStock, getRecomendacionRotacion]
  );

  const getPedidoCalculado = useCallback((producto, rowState = {}) => {
    const unidadesPorInterna = Number(producto.unidadesPorInterna ?? producto.unidadesPorPack ?? 0);
    const medidaPedido = rowState.medidaPedido || (unidadesPorInterna > 0 ? "interna" : "base");
    const cantidadPedidoRaw = rowState.cantidadPedido ?? "";
    const adicionalesBaseRaw = rowState.adicionalesBase ?? "";
    const cantidadPedido = Number(cantidadPedidoRaw || 0);
    const adicionalesBase = Number(adicionalesBaseRaw || 0);

    const totalBase =
      medidaPedido === "interna" && unidadesPorInterna > 0
        ? cantidadPedido * unidadesPorInterna + adicionalesBase
        : cantidadPedido + adicionalesBase;

    return {
      medidaPedido,
      cantidadPedidoRaw,
      cantidadPedido,
      adicionalesBaseRaw,
      adicionalesBase,
      totalBase: Number(totalBase.toFixed(2)),
      unidadesPorInterna,
      equivalenteInterno:
        unidadesPorInterna > 0 ? Number((totalBase / unidadesPorInterna).toFixed(2)) : null,
    };
  }, []);

  const mejorProveedorPorProducto = useMemo(() => {
    const map = {};

    historialPedidos.forEach((pedidoHistorial) => {
      const productosPedido = Array.isArray(pedidoHistorial.productos)
        ? pedidoHistorial.productos
        : [];

      productosPedido.forEach((prod) => {
        const productoId = prod.productoId;
        const costoUnitarioBase = Number(prod.costoUnitarioBase ?? prod.costoUnitario ?? 0);
        if (!productoId || costoUnitarioBase <= 0) return;

        const proveedorId = pedidoHistorial.proveedorId || "";
        const proveedorNombre =
          pedidoHistorial.proveedorNombre || proveedoresMap[proveedorId] || proveedorId;

        if (!map[productoId] || costoUnitarioBase < map[productoId].costoUnitarioBase) {
          map[productoId] = {
            proveedorId,
            proveedorNombre,
            costoUnitarioBase,
          };
        }
      });
    });

    return map;
  }, [historialPedidos, proveedoresMap]);

  useEffect(() => {
    const unsubscribeProveedores = subscribeUserCollection("proveedores", setProveedores);
    const unsubscribePedidos = subscribeUserCollection("pedidos", setHistorialPedidos);

    getWeeklyRotationByProduct(7).then(setRotacionPorProducto).catch((error) => {
      console.error("No se pudo cargar la rotacion semanal", error);
    });

    return () => {
      unsubscribeProveedores();
      unsubscribePedidos();
    };
  }, []);

  useEffect(() => {
    const preselectedProveedorId = String(location.state?.proveedorId || "");
    if (!preselectedProveedorId) return;
    setProveedorSeleccionado((prev) => prev || preselectedProveedorId);
  }, [location.state]);

  useEffect(() => {
    if (!proveedorSeleccionado) return;
    setProveedorSearch(proveedoresMap[proveedorSeleccionado] || proveedorSeleccionado);
  }, [proveedorSeleccionado, proveedoresMap]);

  useEffect(() => {
    let unsubscribe = () => {};

    const fetchProductosProveedor = async () => {
      if (!proveedorSeleccionado) {
        setProductos([]);
        setProviderLinkByProductId({});
        return;
      }

      const [loadedProducts, links] = await Promise.all([
        fetchActiveProducts(),
        getProviderProductLinksByProvider(proveedorSeleccionado),
      ]);
      const providerMap = links.reduce((acc, link) => {
        const key = String(link.productDocId || link.productoId || "");
        if (!key) return acc;
        acc[key] = link;
        return acc;
      }, {});
      setProviderLinkByProductId(providerMap);
      const productIds = new Set(
        links.map((link) => String(link.productDocId || link.productoId || ""))
      );
      const data = loadedProducts.filter((product) => productIds.has(String(product.id)));

      setProductos(data);

      const pedidoInicial = {};
      data.forEach((p) => {
        const sugerido = Number(calcularRecomendadoFinal(p).toFixed(2));
        const unidadesPorInterna = Number(p.unidadesPorInterna ?? p.unidadesPorPack ?? 0);
        pedidoInicial[p.id] = {
          sugeridoBase: sugerido,
          pedidoBase: sugerido,
          incluir: sugerido > 0,
          medidaPedido: unidadesPorInterna > 0 ? "interna" : "base",
          cantidadPedido: "",
          adicionalesBase: "",
        };
      });
      setPedido(pedidoInicial);

      unsubscribe = subscribeActiveProducts((activeProducts) => {
        const nextProducts = activeProducts.filter((product) => productIds.has(String(product.id)));
        setProductos(nextProducts);
      });
    };

    fetchProductosProveedor();
    return () => unsubscribe();
  }, [proveedorSeleccionado, calcularRecomendadoFinal]);


  const openFiltersModal = () => {
    setDraftProductSearch(productSearch);
    setDraftSortBy(sortBy);
    setDraftStatusFilter(statusFilter);
    setShowFilters(true);
  };

  const applyFilters = () => {
    setProductSearch(draftProductSearch);
    setSortBy(draftSortBy);
    setStatusFilter(draftStatusFilter);
    setShowFilters(false);
  };

  const clearDraftFilters = () => {
    setDraftProductSearch("");
    setDraftSortBy("name");
    setDraftStatusFilter("all");
  };

  const visibleProducts = useMemo(() => {
    const term = productSearch.trim().toLowerCase();

    const filtered = productos.filter((producto) => {
      const rowState = pedido[producto.id] || {};
      const incluir = rowState.incluir !== false;
      const recomendadoFinal = calcularRecomendadoFinal(producto);

      if (term && !String(producto.nombre || "").toLowerCase().includes(term)) {
        return false;
      }

      if (statusFilter === "included" && !incluir) return false;
      if (statusFilter === "excluded" && incluir) return false;
      if (statusFilter === "recommended" && recomendadoFinal <= 0) return false;

      return true;
    });

    return [...filtered].sort((a, b) => {
      if (sortBy === "stock") {
        return Number(getStockBase(b) || 0) - Number(getStockBase(a) || 0);
      }

      if (sortBy === "recommended") {
        return calcularRecomendadoFinal(b) - calcularRecomendadoFinal(a);
      }

      return String(a.nombre || "").localeCompare(String(b.nombre || ""));
    });
  }, [
    calcularRecomendadoFinal,
    getStockBase,
    pedido,
    productSearch,
    productos,
    sortBy,
    statusFilter,
  ]);
  const generarPedido = async () => {
    if (!proveedorSeleccionado) {
      toast.error("Seleccione un proveedor");
      return;
    }
    setIsSavingPedido(true);

    const productosPedido = productos
      .filter((p) => {
        const item = pedido[p.id] || {};
        const { totalBase } = getPedidoCalculado(p, item);
        return item.incluir !== false && Number(totalBase || 0) > 0;
      })
      .map((p) => {
        const item = pedido[p.id] || {};
        const { totalBase, medidaPedido, cantidadPedido, adicionalesBase } = getPedidoCalculado(p, item);
        const cantidadBase = Number(totalBase || 0);
        const relationCost = Number(providerLinkByProductId[p.id]?.costoUnitario || 0);
        const costoUnitarioBase =
          relationCost > 0 ? relationCost : Number(p.costoUnitarioBase ?? p.costoUnitario ?? 0);
        const costoTotal = Number((cantidadBase * costoUnitarioBase).toFixed(2));
        const sugeridoBase = Number(item.sugeridoBase || 0);
        const unidadesPorInterna = Number(p.unidadesPorInterna ?? p.unidadesPorPack ?? 0);
        const sugeridoPack =
          unidadesPorInterna > 0 ? Number((sugeridoBase / unidadesPorInterna).toFixed(2)) : null;
        const pedidoPack =
          unidadesPorInterna > 0 ? Number((cantidadBase / unidadesPorInterna).toFixed(2)) : null;

        return {
          productoId: p.productoId || p.id,
          nombre: p.nombre,
          cantidadBase,
          sugeridoBase,
          pedidoBase: cantidadBase,
          incluido: item.incluir !== false,
          medidaPedido,
          cantidadPedido,
          adicionalesBase,
          sugeridoPack,
          pedidoPack,
          medidaBase: p.medidaBase || "UN",
          medidaInterna: p.medidaInterna || null,
          unidadesPorInterna: unidadesPorInterna > 0 ? unidadesPorInterna : null,
          unidadesPorPack: unidadesPorInterna > 0 ? unidadesPorInterna : null,
          costoUnitarioBase,
          costoTotal,
        };
      });

    if (productosPedido.length === 0) {
      toast.error("No hay productos para pedir");
      setIsSavingPedido(false);
      return;
    }

    const totalCosto = Number(
      productosPedido.reduce((acc, item) => acc + Number(item.costoTotal || 0), 0).toFixed(2)
    );

    try {
      await addDoc(userCollection("pedidos"), {
        proveedorId: proveedorSeleccionado,
        proveedorNombre: proveedorSeleccionadoNombre,
        fechaCreacion: serverTimestamp(),
        fechaEntregaEstimada: fechaEntrega || getTomorrowIsoDate(),
        fechaRecibido: null,
        totalCosto,
        estado: "pendiente",
        productos: productosPedido,
      });
      toast.success("Pedido generado correctamente");
    } catch (error) {
      console.error(error);
      toast.error("Error generando pedido");
    } finally {
      setIsSavingPedido(false);
    }
  };

  return (
    <div className="pedido-container">
      <div className="proveedor-select">
        <label>Proveedor</label>
        <div style={{ position: "relative" }}>
          <input
            className="input-modern"
            placeholder="Buscar proveedor..."
            value={proveedorSearch}
            onChange={(e) => {
              setProveedorSearch(e.target.value);
              setShowProveedorSuggestions(true);
              setProveedorSeleccionado("");
              setProductos([]);
              setProviderLinkByProductId({});
            }}
            onFocus={() => setShowProveedorSuggestions(true)}
            onClick={(e) => e.target.select()}
            onBlur={() => {
              setTimeout(() => setShowProveedorSuggestions(false), 150);
            }}
          />
          {showProveedorSuggestions && (
            <div className="suggestions-box" style={{ maxHeight: "220px", overflowY: "auto" }}>
              {proveedoresFiltrados.length > 0 ? (
                proveedoresFiltrados.map((proveedor) => (
                  <button
                    key={proveedor.id}
                    type="button"
                    className="suggestion-item"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setProveedorSeleccionado(proveedor.id);
                      setProveedorSearch(proveedor.nombre || proveedor.id);
                      setShowProveedorSuggestions(false);
                    }}
                  >
                    {proveedor.nombre || proveedor.id}
                  </button>
                ))
              ) : (
                <div className="suggestion-item">No se encontraron proveedores.</div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="input-group">
        <label>Fecha estimada de entrega</label>
        <input
          type="date"
          className="input-modern"
          value={fechaEntrega}
          onChange={(e) => setFechaEntrega(e.target.value)}
        />
      </div>
      <div className="spacer" />
      <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn-secondary"
          onClick={openFiltersModal}
        >
          Filter
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() =>
            setPedido((prev) => {
              const next = { ...prev };
              visibleProducts.forEach((p) => {
                const actual = prev[p.id] || {};
                const sugerido = Number(actual.sugeridoBase || 0);
                const unidadesPorInterna = Number(p.unidadesPorInterna ?? p.unidadesPorPack ?? 0);
                const internos = unidadesPorInterna > 0 ? Math.floor(sugerido / unidadesPorInterna) : 0;
                const adicionales = unidadesPorInterna > 0
                  ? Number((sugerido - internos * unidadesPorInterna).toFixed(2))
                  : 0;
                next[p.id] = {
                  ...actual,
                  incluir: sugerido > 0,
                  pedidoBase: sugerido,
                  medidaPedido: unidadesPorInterna > 0 ? "interna" : "base",
                  cantidadPedido: unidadesPorInterna > 0 ? internos : sugerido,
                  adicionalesBase: unidadesPorInterna > 0 ? adicionales : 0,
                };
              });
              return next;
            })
          }
        >
          Aplicar sugerencias
        </button>
      </div>
      {(productSearch || statusFilter !== "all" || sortBy !== "name") && (
        <p style={{ marginTop: "12px", color: "#5f6c7b" }}>
          Mostrando <strong>{visibleProducts.length}</strong> de <strong>{productos.length}</strong> productos
        </p>
      )}

      <div className="pedido-list">
        <div className="table-scroll">
          <table className="table-modern">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Stock actual</th>
                <th>Stock objetivo</th>
                <th>Extra rotacion</th>
                <th>Pedido recomendado</th>
                <th>Unidades a pedir</th>
              </tr>
            </thead>
            <tbody>
              {visibleProducts.map((p) => {
                const recomendadoStock = calcularRecomendadoStock(p);
                const recomendadoRotacion = getRecomendacionRotacion(p);
                const recomendadoFinal = recomendadoStock + recomendadoRotacion;
                const rowState = pedido[p.id] || {};
                const pedidoCalculado = getPedidoCalculado(p, rowState);
                const incluir = rowState.incluir !== false;
                return (
                  <tr key={`${p.id}-table`}>
                    <td>{p.nombre}</td>
                    <td>
                      {getStockBase(p).toFixed(2)} {p.medidaBase || "UN"}
                    </td>
                    <td>
                      {recomendadoStock.toFixed(2)} {p.medidaBase || "UN"}
                    </td>
                    <td>
                      {recomendadoRotacion.toFixed(2)} {p.medidaBase || "UN"}
                    </td>
                    <td>
                      {recomendadoFinal.toFixed(2)} {p.medidaBase || "UN"}
                    </td>
                    <td>
                      <input
                        type="number"
                        className="input-modern"
                        value={Number(pedidoCalculado.totalBase || 0)}
                        readOnly
                        disabled={!incluir}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {visibleProducts.map((p) => {
          const recomendadoStock = calcularRecomendadoStock(p);
          const recomendadoRotacion = getRecomendacionRotacion(p);
          const recomendado = recomendadoStock + recomendadoRotacion;
          const unidadesPorInterna = Number(p.unidadesPorInterna ?? p.unidadesPorPack ?? 0);
          const stateItem = pedido[p.id] || {};
          const sugeridoBase = Number(stateItem.sugeridoBase ?? recomendado ?? 0);
          const pedidoCalculado = getPedidoCalculado(p, stateItem);
          const pedidoBase = Number(pedidoCalculado.totalBase ?? recomendado ?? 0);
          const incluir = stateItem.incluir !== false;
          const sugeridoPack = unidadesPorInterna > 0 ? sugeridoBase / unidadesPorInterna : null;
          const pedidoPack = unidadesPorInterna > 0 ? pedidoBase / unidadesPorInterna : null;
          const pedidoComercialPack =
            unidadesPorInterna > 0 ? Math.ceil(sugeridoBase / unidadesPorInterna) : null;
          const productoId = p.productoId || p.id;
          const mejor = mejorProveedorPorProducto[productoId];
          const proveedorNoEsElMejor =
            !!mejor &&
            !!proveedorSeleccionado &&
            !!mejor.proveedorId &&
            mejor.proveedorId !== proveedorSeleccionado;

          return (
            <div key={p.id} className="pedido-card">
              <div className="pedido-header">
                <h4>{p.nombre}</h4>
              </div>

              <div className="pedido-info">
                <p>
                  Inventario actual:{" "}
                  <strong>
                    {unidadesPorInterna > 0
                      ? `${(getStockBase(p) / unidadesPorInterna).toFixed(2)} ${p.medidaInterna || "PACK"} (${getStockBase(p).toFixed(2)} ${p.medidaBase || "UN"})`
                      : `${getStockBase(p).toFixed(2)} ${p.medidaBase || "UN"}`}
                  </strong>
                </p>
                <p className="recomendado">
                  Stock objetivo:{" "}
                  <strong>
                    {recomendadoStock.toFixed(2)} {p.medidaBase || "UN"}
                  </strong>
                </p>
                <p className="recomendado">
                  Extra por rotacion:{" "}
                  <strong>
                    +{recomendadoRotacion.toFixed(2)} {p.medidaBase || "UN"}
                  </strong>
                </p>
                <p className="recomendado">
                  Pedido sugerido:{" "}
                  <strong>
                    {sugeridoBase.toFixed(2)} {p.medidaBase || "UN"}
                    {sugeridoPack !== null &&
                      ` (${sugeridoPack.toFixed(2)} ${p.medidaInterna || "PACK"})`}
                  </strong>
                </p>
                {pedidoComercialPack !== null && (
                  <p>
                    Pedido comercial:{" "}
                    <strong>
                      {pedidoComercialPack} {p.medidaInterna || "PACK"}
                    </strong>
                  </p>
                )}
                <p>
                  Pedido usuario:{" "}
                  <strong>
                    {pedidoBase.toFixed(2)} {p.medidaBase || "UN"}
                    {pedidoPack !== null &&
                      ` (${pedidoPack.toFixed(2)} ${p.medidaInterna || "PACK"})`}
                  </strong>
                </p>
                <p>
                  Total pedido:{" "}
                  <strong>
                    {pedidoCalculado.totalBase.toFixed(2)} {p.medidaBase || "UN"}
                  </strong>
                </p>
                {pedidoCalculado.equivalenteInterno !== null && (
                  <p>
                    Equivalente:{" "}
                    <strong>
                      {pedidoCalculado.equivalenteInterno.toFixed(2)} {p.medidaInterna || "PACK"}
                    </strong>
                  </p>
                )}
                {mejor && (
                  <p className="best-provider">
                    Mejor proveedor: <strong>{mejor.proveedorNombre || mejor.proveedorId}</strong>{" "}
                    - C${mejor.costoUnitarioBase.toFixed(2)}
                  </p>
                )}
                {proveedorNoEsElMejor && (
                  <p className="warning-provider">Este proveedor no es el mas barato</p>
                )}
              </div>

              <div className="pedido-input">
                <label>
                  <input
                    type="checkbox"
                    checked={incluir}
                    onChange={(e) =>
                      setPedido((prev) => ({
                        ...prev,
                        [p.id]: {
                          ...(prev[p.id] || {}),
                          incluir: e.target.checked,
                        },
                      }))
                    }
                  />{" "}
                  Incluir en pedido
                </label>
                <label>Medida</label>
                <select
                  className="input-modern"
                  value={pedidoCalculado.medidaPedido}
                  onChange={(e) =>
                    setPedido((prev) => ({
                      ...prev,
                      [p.id]: {
                        ...(prev[p.id] || {}),
                        medidaPedido: e.target.value,
                        cantidadPedido: "",
                        adicionalesBase: "",
                      },
                    }))
                  }
                  disabled={!incluir}
                >
                  <option value="base">{p.medidaBase || "UN"}</option>
                  {unidadesPorInterna > 0 && <option value="interna">{p.medidaInterna || "PACK"}</option>}
                </select>
                <label>Cantidad</label>
                <input
                  type="number"
                  className="input-modern"
                  value={pedidoCalculado.cantidadPedidoRaw}
                  placeholder="0"
                  onChange={(e) =>
                    setPedido((prev) => ({
                      ...prev,
                      [p.id]: {
                        ...(prev[p.id] || {}),
                        cantidadPedido: e.target.value,
                      },
                    }))
                  }
                  disabled={!incluir}
                />
                <label>UN adicionales</label>
                <input
                  type="number"
                  className="input-modern"
                  value={pedidoCalculado.adicionalesBaseRaw}
                  placeholder="0"
                  onChange={(e) =>
                    setPedido((prev) => ({
                      ...prev,
                      [p.id]: {
                        ...(prev[p.id] || {}),
                        adicionalesBase: e.target.value,
                      },
                    }))
                  }
                  disabled={!incluir}
                />
                <div className="pedido-quick-actions">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() =>
                      setPedido((prev) => {
                        const internos = unidadesPorInterna > 0
                          ? Math.floor(sugeridoBase / unidadesPorInterna)
                          : 0;
                        const adicionales = unidadesPorInterna > 0
                          ? Number((sugeridoBase - internos * unidadesPorInterna).toFixed(2))
                          : 0;
                        return {
                          ...prev,
                          [p.id]: {
                            ...(prev[p.id] || {}),
                            medidaPedido: unidadesPorInterna > 0 ? "interna" : "base",
                            cantidadPedido: unidadesPorInterna > 0 ? internos : sugeridoBase,
                            adicionalesBase: unidadesPorInterna > 0 ? adicionales : 0,
                            pedidoBase: sugeridoBase,
                          },
                        };
                      })
                    }
                  >
                    Usar sugerido
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() =>
                      setPedido((prev) => {
                        const currentMedida =
                          prev[p.id]?.medidaPedido || (unidadesPorInterna > 0 ? "interna" : "base");
                        const currentCantidad = Number(prev[p.id]?.cantidadPedido || 0);
                        return {
                          ...prev,
                          [p.id]: {
                            ...(prev[p.id] || {}),
                            cantidadPedido: Math.max(0, currentCantidad - 1),
                            medidaPedido: currentMedida,
                          },
                        };
                      })
                    }
                  >
                    -1 {pedidoCalculado.medidaPedido === "interna" ? p.medidaInterna || "PACK" : p.medidaBase || "UN"}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() =>
                      setPedido((prev) => {
                        const currentMedida =
                          prev[p.id]?.medidaPedido || (unidadesPorInterna > 0 ? "interna" : "base");
                        const currentCantidad = Number(prev[p.id]?.cantidadPedido || 0);
                        return {
                          ...prev,
                          [p.id]: {
                            ...(prev[p.id] || {}),
                            cantidadPedido: currentCantidad + 1,
                            medidaPedido: currentMedida,
                          },
                        };
                      })
                    }
                  >
                    +1 {pedidoCalculado.medidaPedido === "interna" ? p.medidaInterna || "PACK" : p.medidaBase || "UN"}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>


      {showFilters && (
        <div className="modal-overlay" onClick={() => setShowFilters(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Filtros de pedido</h3>

            <div className="input-group">
              <label>Buscar producto</label>
              <input
                className="input-modern"
                placeholder="Buscar producto..."
                value={draftProductSearch}
                onChange={(e) => setDraftProductSearch(e.target.value)}
                onClick={(e) => e.target.select()}
              />
            </div>

            <div className="input-group">
              <label>Ordenar por</label>
              <select
                className="input-modern"
                value={draftSortBy}
                onChange={(e) => setDraftSortBy(e.target.value)}
              >
                <option value="name">Nombre (A - Z)</option>
                <option value="stock">Stock actual</option>
                <option value="recommended">Pedido recomendado</option>
              </select>
            </div>

            <div className="input-group">
              <label>Estado</label>
              <select
                className="input-modern"
                value={draftStatusFilter}
                onChange={(e) => setDraftStatusFilter(e.target.value)}
              >
                <option value="all">Todos</option>
                <option value="included">Incluidos</option>
                <option value="excluded">Excluidos</option>
                <option value="recommended">Con sugerencia</option>
              </select>
            </div>

            <div style={{ display: "flex", gap: "12px", marginTop: "16px" }}>
              <button type="button" className="btn-secondary" onClick={clearDraftFilters}>
                Limpiar filtros
              </button>
              <button type="button" className="btn-primary" onClick={applyFilters}>
                Aplicar
              </button>
            </div>
          </div>
        </div>
      )}      <button
        type="button"
        className="btn-primary btn-full"
        onClick={generarPedido}
        disabled={isSavingPedido}
      >
        {isSavingPedido ? "Generando..." : "Generar Pedido"}
      </button>
    </div>
  );
}

export default RealizarPedido;
