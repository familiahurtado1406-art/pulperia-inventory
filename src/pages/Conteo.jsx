import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { getDocs, query, updateDoc, where } from "firebase/firestore";
import {
  getStockBaseValue,
  registerInventoryChange,
} from "../services/inventoryHistoryService";
import { getProviderProductLinksByProvider } from "../services/providerProductService";
import { userCollection, userDoc } from "../services/userScopedFirestore";

function Conteo() {
  const [products, setProducts] = useState([]);
  const [proveedores, setProveedores] = useState([]);
  const [selectedProveedorId, setSelectedProveedorId] = useState("");
  const [conteos, setConteos] = useState({});
  const [adicionalesConteo, setAdicionalesConteo] = useState({});
  const [medidasConteo, setMedidasConteo] = useState({});
  const [productCollectionById, setProductCollectionById] = useState({});
  const [isSavingAll, setIsSavingAll] = useState(false);

  const getStockBase = (product) => getStockBaseValue(product);
  const getUnidadesPorInterna = (product) =>
    Number(product.unidadesPorInterna ?? product.unidadesPorPack ?? 0);

  useEffect(() => {
    const fetchProveedores = async () => {
      const proveedoresSnap = await getDocs(userCollection("proveedores"));
      setProveedores(
        proveedoresSnap.docs.map((docItem) => ({
          id: docItem.id,
          ...docItem.data(),
        })),
      );
    };

    fetchProveedores();
  }, []);

  useEffect(() => {
    const fetchProducts = async () => {
      if (!selectedProveedorId) {
        setProducts([]);
        setProductCollectionById({});
        return;
      }

      const buildQuery = (collectionName) =>
        query(userCollection(collectionName), where("activo", "==", true));

      const primarySnap = await getDocs(buildQuery("products"));
      let primaryData = primarySnap.docs.map((docItem) => ({
        id: docItem.id,
        ...docItem.data(),
        _collection: "products",
      }));

      const links =
        await getProviderProductLinksByProvider(selectedProveedorId);
      const ids = new Set(
        links.map((link) => String(link.productDocId || link.productoId || "")),
      );
      primaryData = primaryData.filter((item) => ids.has(String(item.id)));

      if (primaryData.length > 0) {
        setProducts(primaryData);
        setProductCollectionById(
          primaryData.reduce((acc, item) => {
            acc[item.id] = "products";
            return acc;
          }, {}),
        );
        return;
      }

      const fallbackSnap = await getDocs(buildQuery("productos"));
      let fallbackData = fallbackSnap.docs.map((docItem) => ({
        id: docItem.id,
        ...docItem.data(),
        _collection: "productos",
      }));

      fallbackData = fallbackData.filter((item) => ids.has(String(item.id)));

      setProducts(fallbackData);
      setProductCollectionById(
        fallbackData.reduce((acc, item) => {
          acc[item.id] = "productos";
          return acc;
        }, {}),
      );
    };

    fetchProducts();
  }, [selectedProveedorId]);

  const visibleProducts = useMemo(() => products, [products]);

  const selectedProveedor = useMemo(
    () => proveedores.find((p) => p.id === selectedProveedorId),
    [proveedores, selectedProveedorId],
  );

  const calcularRecomendacion = (product, stockBaseActual) => {
    const faltante =
      Number(product.stockObjetivo || 0) - Number(stockBaseActual || 0);
    return faltante > 0 ? faltante : 0;
  };

  const getStockEstado = (product, cantidadContada) => {
    const actual = Number(cantidadContada || 0);
    const minimo = Number(product.stockMin || 0);

    if (actual <= minimo) return { label: "Bajo minimo", color: "red" };
    if (actual <= minimo * 1.2)
      return { label: "Cerca del minimo", color: "orange" };
    return { label: "OK", color: "green" };
  };

  const handleMedidaChange = (productId, value) => {
    setMedidasConteo((prev) => ({ ...prev, [productId]: value }));
    setConteos((prev) => ({ ...prev, [productId]: "" }));
    setAdicionalesConteo((prev) => ({ ...prev, [productId]: "" }));
  };

  const getConteoCalculado = (product) => {
    const medidaSeleccionada = medidasConteo[product.id] || "base";
    const unidadesPorInterna = getUnidadesPorInterna(product);
    const cantidadRaw = conteos[product.id] ?? String(getStockBase(product));
    const cantidadContada = Number(cantidadRaw || 0);
    const adicionalesRaw = adicionalesConteo[product.id] ?? "";
    const adicionales = Number(adicionalesRaw || 0);
    const totalBase =
      medidaSeleccionada === "interna"
        ? cantidadContada * unidadesPorInterna + adicionales
        : cantidadContada + adicionales;

    return {
      medidaSeleccionada,
      unidadesPorInterna,
      cantidadRaw,
      adicionalesRaw,
      totalBase,
    };
  };

  const modifiedProducts = visibleProducts.filter((product) => {
    const { totalBase } = getConteoCalculado(product);
    const stockAnterior = Number(getStockBase(product) || 0);
    return Math.abs(Number(totalBase || 0) - stockAnterior) > 0.0001;
  });

  const handleSaveAllCounts = async () => {
    if (modifiedProducts.length === 0) {
      toast("No hay cambios para guardar");
      return;
    }

    for (const product of modifiedProducts) {
      const { medidaSeleccionada, unidadesPorInterna } =
        getConteoCalculado(product);
      if (medidaSeleccionada === "interna" && unidadesPorInterna <= 0) {
        toast.error(
          `"${product.nombre}" no tiene equivalencia interna configurada`,
        );
        return;
      }
    }

    setIsSavingAll(true);
    try {
      const updatesById = {};
      for (const product of modifiedProducts) {
        const { totalBase } = getConteoCalculado(product);
        const equivalenteBase = Number(totalBase || 0);
        const stockAnterior = Number(getStockBase(product) || 0);
        const targetCollection =
          productCollectionById[product.id] || "products";

        await updateDoc(userDoc(targetCollection, product.id), {
          stockBase: equivalenteBase,
          stockActual: equivalenteBase,
        });
        await registerInventoryChange({
          product,
          tipoMovimiento: "conteo",
          stockAnterior,
          stockNuevo: equivalenteBase,
        });
        updatesById[product.id] = equivalenteBase;
      }

      setProducts((prev) =>
        prev.map((product) =>
          updatesById[product.id] === undefined
            ? product
            : {
                ...product,
                stockBase: updatesById[product.id],
                stockActual: updatesById[product.id],
              },
        ),
      );
      toast.success(
        `Conteo guardado: ${modifiedProducts.length} productos actualizados`,
      );
    } catch (error) {
      console.error(error);
      toast.error("Error al guardar conteo");
    } finally {
      setIsSavingAll(false);
    }
  };

  return (
    <div>
      <div className="section-card">
        <h3 className="section-title">Conteo</h3>
        <div className="row">
          <select
            className="input-modern proveedor-select"
            value={selectedProveedorId}
            onChange={(e) => setSelectedProveedorId(e.target.value)}
          >
            <option value="">Seleccione proveedor</option>
            {proveedores.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
        </div>
        {selectedProveedorId && (
          <p>
            Proveedor:{" "}
            <strong>{selectedProveedor?.nombre || selectedProveedorId}</strong>{" "}
            | Productos: <strong>{visibleProducts.length}</strong>
          </p>
        )}
        {selectedProveedorId && (
          <p>
            Productos modificados: <strong>{modifiedProducts.length}</strong>
          </p>
        )}

        {!selectedProveedorId ? (
          <p>Seleccione un proveedor para iniciar el conteo.</p>
        ) : visibleProducts.length === 0 ? (
          <p>
            {`No hay productos para el proveedor seleccionado (${selectedProveedor?.nombre || selectedProveedorId}).`}
          </p>
        ) : (
          <div>
            <div className="table-scroll">
              <table className="table-modern">
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Medida</th>
                    <th>Cantidad</th>
                    <th>UN adicionales</th>
                    <th>Equivalente base</th>
                    <th>Estado</th>
                    <th>Recomendado</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleProducts.map((product) => {
                    const {
                      medidaSeleccionada,
                      unidadesPorInterna,
                      cantidadRaw,
                      adicionalesRaw,
                      totalBase,
                    } = getConteoCalculado(product);
                    const equivalenteBase = Number(totalBase || 0);
                    const recomendado = calcularRecomendacion(
                      product,
                      equivalenteBase,
                    );
                    const estado = getStockEstado(product, equivalenteBase);
                    const recomendadoInterna =
                      unidadesPorInterna > 0
                        ? recomendado / unidadesPorInterna
                        : null;

                    return (
                      <tr key={product.id}>
                        <td>{product.nombre}</td>
                        <td>
                          <select
                            className="input-modern"
                            value={medidaSeleccionada}
                            onChange={(e) =>
                              handleMedidaChange(product.id, e.target.value)
                            }
                          >
                            <option value="base">
                              {product.medidaBase || "UN"}
                            </option>
                            {product.medidaInterna && (
                              <option value="interna">
                                {product.medidaInterna}
                              </option>
                            )}
                          </select>
                        </td>
                        <td>
                          <input
                            className="input-modern"
                            type="number"
                            step="any"
                            value={cantidadRaw}
                            onChange={(e) =>
                              setConteos((prev) => ({
                                ...prev,
                                [product.id]: e.target.value,
                              }))
                            }
                          />
                        </td>
                        <td>
                          <input
                            className="input-modern"
                            type="number"
                            step="any"
                            value={adicionalesRaw}
                            onChange={(e) =>
                              setAdicionalesConteo((prev) => ({
                                ...prev,
                                [product.id]: e.target.value,
                              }))
                            }
                          />
                        </td>
                        <td>
                          {equivalenteBase.toFixed(2)}{" "}
                          {product.medidaBase || "UN"}
                        </td>
                        <td style={{ color: estado.color }}>{estado.label}</td>
                        <td>
                          {recomendado > 0
                            ? `Pedir ${recomendado.toFixed(2)} ${product.medidaBase || "UN"}${
                                recomendadoInterna !== null &&
                                product.medidaInterna
                                  ? ` (${recomendadoInterna.toFixed(2)} ${product.medidaInterna})`
                                  : ""
                              }`
                            : "Stock suficiente"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="conteo-cards">
              {visibleProducts.map((product) => {
                const {
                  medidaSeleccionada,
                  unidadesPorInterna,
                  cantidadRaw,
                  adicionalesRaw,
                  totalBase,
                } = getConteoCalculado(product);
                const equivalenteBase = Number(totalBase || 0);
                const recomendado = calcularRecomendacion(
                  product,
                  equivalenteBase,
                );
                const estado = getStockEstado(product, equivalenteBase);
                const recomendadoInterna =
                  unidadesPorInterna > 0
                    ? recomendado / unidadesPorInterna
                    : null;

                return (
                  <div key={`${product.id}-card`} className="conteo-card">
                    <div className="conteo-header">
                      <h4>{product.nombre}</h4>
                      <span className="stock-badge">
                        Stock actual: {getStockBase(product).toFixed(2)}{" "}
                        {product.medidaBase || "UN"}
                      </span>
                    </div>

                    <div className="conteo-inputs">
                      <div>
                        <label>Medida</label>
                        <select
                          className="input-modern"
                          value={medidaSeleccionada}
                          onChange={(e) =>
                            handleMedidaChange(product.id, e.target.value)
                          }
                        >
                          <option value="base">
                            {product.medidaBase || "UN"}
                          </option>
                          {product.medidaInterna && (
                            <option value="interna">
                              {product.medidaInterna}
                            </option>
                          )}
                        </select>
                      </div>

                      <div>
                        <label>Cantidad</label>
                        <input
                          className="input-modern"
                          type="number"
                          step="any"
                          value={cantidadRaw}
                          onChange={(e) =>
                            setConteos((prev) => ({
                              ...prev,
                              [product.id]: e.target.value,
                            }))
                          }
                        />
                      </div>
                      <div>
                        <label>UN adicionales</label>
                        <input
                          className="input-modern"
                          type="number"
                          step="any"
                          value={adicionalesRaw}
                          onChange={(e) =>
                            setAdicionalesConteo((prev) => ({
                              ...prev,
                              [product.id]: e.target.value,
                            }))
                          }
                        />
                      </div>
                    </div>

                    <div className="conteo-info">
                      <p>
                        Total contado: {equivalenteBase.toFixed(2)}{" "}
                        {product.medidaBase || "UN"}
                        {medidaSeleccionada === "interna" &&
                        unidadesPorInterna > 0
                          ? ` (${(equivalenteBase / unidadesPorInterna).toFixed(2)} ${product.medidaInterna || "INT"})`
                          : ""}
                      </p>
                      <p>
                        Equivalente: {equivalenteBase.toFixed(2)}{" "}
                        {product.medidaBase || "UN"}
                      </p>
                      <p className={`estado-${estado.color}`}>{estado.label}</p>
                      <p>
                        {recomendado > 0
                          ? `Pedir ${recomendado.toFixed(2)} ${product.medidaBase || "UN"}${
                              recomendadoInterna !== null &&
                              product.medidaInterna
                                ? ` (${recomendadoInterna.toFixed(2)} ${product.medidaInterna})`
                                : ""
                            }`
                          : "Stock suficiente"}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="spacer" />
            <button
              type="button"
              className="btn-primary btn-full"
              onClick={handleSaveAllCounts}
              disabled={isSavingAll}
            >
              {isSavingAll ? "Guardando conteo..." : "Guardar conteo"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default Conteo;
