import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import {
  addDoc,
  getDocs,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";
import {
  getStockBaseValue,
  getWeeklyRotationByProduct,
} from "../services/inventoryHistoryService";
import { getProviderProductLinksByProvider } from "../services/providerProductService";
import { userCollection } from "../services/userScopedFirestore";

const getTomorrowIsoDate = () => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.toISOString().slice(0, 10);
};

function RealizarPedido() {
  const [proveedores, setProveedores] = useState([]);
  const [historialPedidos, setHistorialPedidos] = useState([]);
  const [proveedorSeleccionado, setProveedorSeleccionado] = useState("");
  const [fechaEntrega, setFechaEntrega] = useState(getTomorrowIsoDate);
  const [productos, setProductos] = useState([]);
  const [pedido, setPedido] = useState({});
  const [rotacionPorProducto, setRotacionPorProducto] = useState({});
  const [providerLinkByProductId, setProviderLinkByProductId] = useState({});
  const [isSavingPedido, setIsSavingPedido] = useState(false);

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
    const fetchInitialData = async () => {
      const [proveedoresSnap, pedidosSnap, rotacionSemanal] = await Promise.all([
        getDocs(userCollection("proveedores")),
        getDocs(userCollection("pedidos")),
        getWeeklyRotationByProduct(7),
      ]);

      setProveedores(
        proveedoresSnap.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() }))
      );
      setHistorialPedidos(
        pedidosSnap.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() }))
      );
      setRotacionPorProducto(rotacionSemanal);
    };

    fetchInitialData();
  }, []);

  useEffect(() => {
    const fetchProductosProveedor = async () => {
      if (!proveedorSeleccionado) {
        setProductos([]);
        setProviderLinkByProductId({});
        return;
      }

      const q = query(
        userCollection("products"),
        where("activo", "==", true)
      );
      const [snapshot, links] = await Promise.all([
        getDocs(q),
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
      const data = snapshot.docs
        .map((docItem) => ({ id: docItem.id, ...docItem.data() }))
        .filter((product) => productIds.has(String(product.id)));

      setProductos(data);

      const pedidoInicial = {};
      data.forEach((p) => {
        const sugerido = Number(calcularRecomendadoFinal(p).toFixed(2));
        pedidoInicial[p.id] = {
          sugeridoBase: sugerido,
          pedidoBase: sugerido,
          incluir: sugerido > 0,
        };
      });
      setPedido(pedidoInicial);
    };

    fetchProductosProveedor();
  }, [proveedorSeleccionado, calcularRecomendadoFinal]);

  const generarPedido = async () => {
    if (!proveedorSeleccionado) {
      toast.error("Seleccione un proveedor");
      return;
    }
    setIsSavingPedido(true);

    const productosPedido = productos
      .filter((p) => {
        const item = pedido[p.id] || {};
        return item.incluir !== false && Number(item.pedidoBase || 0) > 0;
      })
      .map((p) => {
        const item = pedido[p.id] || {};
        const cantidadBase = Number(item.pedidoBase || 0);
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
          sugeridoPack,
          pedidoPack,
          medidaBase: p.medidaBase || "UN",
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
        <select
          className="input-modern"
          value={proveedorSeleccionado}
          onChange={(e) => setProveedorSeleccionado(e.target.value)}
        >
          <option value="">Seleccione proveedor</option>
          {proveedores.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre}
            </option>
          ))}
        </select>
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
      <button
        type="button"
        className="btn-secondary"
        onClick={() =>
          setPedido((prev) => {
            const next = { ...prev };
            productos.forEach((p) => {
              const actual = prev[p.id] || {};
              const sugerido = Number(actual.sugeridoBase || 0);
              next[p.id] = {
                ...actual,
                incluir: sugerido > 0,
                pedidoBase: sugerido,
              };
            });
            return next;
          })
        }
      >
        Aplicar sugerencias
      </button>

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
              {productos.map((p) => {
                const recomendadoStock = calcularRecomendadoStock(p);
                const recomendadoRotacion = getRecomendacionRotacion(p);
                const recomendadoFinal = recomendadoStock + recomendadoRotacion;
                const rowState = pedido[p.id] || {};
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
                        value={Number(rowState.pedidoBase || 0)}
                        onChange={(e) =>
                          setPedido((prev) => ({
                            ...prev,
                            [p.id]: {
                              ...(prev[p.id] || {}),
                              pedidoBase: Number(e.target.value || 0),
                            },
                          }))
                        }
                        disabled={!incluir}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {productos.map((p) => {
          const recomendadoStock = calcularRecomendadoStock(p);
          const recomendadoRotacion = getRecomendacionRotacion(p);
          const recomendado = recomendadoStock + recomendadoRotacion;
          const unidadesPorInterna = Number(p.unidadesPorInterna ?? p.unidadesPorPack ?? 0);
          const stateItem = pedido[p.id] || {};
          const sugeridoBase = Number(stateItem.sugeridoBase ?? recomendado ?? 0);
          const pedidoBase = Number(stateItem.pedidoBase ?? recomendado ?? 0);
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
                    {getStockBase(p).toFixed(2)} {p.medidaBase || "UN"}
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
                <label>Unidades a pedir</label>
                <input
                  type="number"
                  className="input-modern"
                  value={pedidoBase}
                  onChange={(e) =>
                    setPedido((prev) => ({
                      ...prev,
                      [p.id]: {
                        ...(prev[p.id] || {}),
                        pedidoBase: Number(e.target.value || 0),
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
                      setPedido((prev) => ({
                        ...prev,
                        [p.id]: {
                          ...(prev[p.id] || {}),
                          pedidoBase: sugeridoBase,
                        },
                      }))
                    }
                  >
                    Usar sugerido
                  </button>
                  {unidadesPorInterna > 0 && (
                    <>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() =>
                          setPedido((prev) => {
                            const current = Number(prev[p.id]?.pedidoBase || 0);
                            return {
                              ...prev,
                              [p.id]: {
                                ...(prev[p.id] || {}),
                                pedidoBase: Math.max(0, current - unidadesPorInterna),
                              },
                            };
                          })
                        }
                      >
                        -1 {p.medidaInterna || "PACK"}
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() =>
                          setPedido((prev) => {
                            const current = Number(prev[p.id]?.pedidoBase || 0);
                            return {
                              ...prev,
                              [p.id]: {
                                ...(prev[p.id] || {}),
                                pedidoBase: current + unidadesPorInterna,
                              },
                            };
                          })
                        }
                      >
                        +1 {p.medidaInterna || "PACK"}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <button
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
