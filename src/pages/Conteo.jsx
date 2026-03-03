import { useEffect, useMemo, useState } from "react";
import { getDocs, query, updateDoc, where } from "firebase/firestore";
import { getStockBaseValue, registerInventoryChange } from "../services/inventoryHistoryService";
import { getProviderProductLinksByProvider } from "../services/providerProductService";
import { userCollection, userDoc } from "../services/userScopedFirestore";

function Conteo() {
  const [products, setProducts] = useState([]);
  const [proveedores, setProveedores] = useState([]);
  const [selectedProveedorId, setSelectedProveedorId] = useState("todos");
  const [conteos, setConteos] = useState({});
  const [medidasConteo, setMedidasConteo] = useState({});
  const [productCollectionById, setProductCollectionById] = useState({});

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
        }))
      );
    };

    fetchProveedores();
  }, []);

  useEffect(() => {
    const fetchProducts = async () => {
      const buildQuery = (collectionName) =>
        query(userCollection(collectionName), where("activo", "==", true));

      const primarySnap = await getDocs(buildQuery("products"));
      let primaryData = primarySnap.docs.map((docItem) => ({
        id: docItem.id,
        ...docItem.data(),
        _collection: "products",
      }));

      if (selectedProveedorId !== "todos") {
        const links = await getProviderProductLinksByProvider(selectedProveedorId);
        const ids = new Set(
          links.map((link) => String(link.productDocId || link.productoId || ""))
        );
        primaryData = primaryData.filter((item) => ids.has(String(item.id)));
      }

      if (primaryData.length > 0) {
        setProducts(primaryData);
        setProductCollectionById(
          primaryData.reduce((acc, item) => {
            acc[item.id] = "products";
            return acc;
          }, {})
        );
        return;
      }

      // Compatibility fallback for deployments that still use "productos".
      const fallbackSnap = await getDocs(buildQuery("productos"));
      let fallbackData = fallbackSnap.docs.map((docItem) => ({
        id: docItem.id,
        ...docItem.data(),
        _collection: "productos",
      }));

      if (selectedProveedorId !== "todos") {
        const links = await getProviderProductLinksByProvider(selectedProveedorId);
        const ids = new Set(
          links.map((link) => String(link.productDocId || link.productoId || ""))
        );
        fallbackData = fallbackData.filter((item) => ids.has(String(item.id)));
      }

      setProducts(fallbackData);
      setProductCollectionById(
        fallbackData.reduce((acc, item) => {
          acc[item.id] = "productos";
          return acc;
        }, {})
      );
    };

    fetchProducts();
  }, [selectedProveedorId]);

  const visibleProducts = useMemo(() => products, [products]);

  const selectedProveedor = useMemo(
    () => proveedores.find((p) => p.id === selectedProveedorId),
    [proveedores, selectedProveedorId]
  );

  const calcularRecomendacion = (product, stockBaseActual) => {
    const faltante = Number(product.stockObjetivo || 0) - Number(stockBaseActual || 0);
    return faltante > 0 ? faltante : 0;
  };

  const getStockEstado = (product, cantidadContada) => {
    const actual = Number(cantidadContada || 0);
    const minimo = Number(product.stockMin || 0);

    if (actual <= minimo) return { label: "Bajo minimo", color: "red" };
    if (actual <= minimo * 1.2) return { label: "Cerca del minimo", color: "orange" };
    return { label: "OK", color: "green" };
  };

  const handleSaveCount = async (product) => {
    const cantidadRaw = conteos[product.id];
    if (cantidadRaw === undefined || cantidadRaw === "") {
      alert("Ingresa una cantidad contada");
      return;
    }

    const cantidadContada = Number(cantidadRaw);
    const medidaSeleccionada = medidasConteo[product.id] || "base";
    const unidadesPorInterna = getUnidadesPorInterna(product);

    if (medidaSeleccionada === "interna" && unidadesPorInterna <= 0) {
      alert("Este producto no tiene equivalencia interna configurada");
      return;
    }

    const equivalenteBase =
      medidaSeleccionada === "interna"
        ? cantidadContada * unidadesPorInterna
        : cantidadContada;
    const stockAnterior = getStockBase(product);

    try {
      const targetCollection = productCollectionById[product.id] || "products";
      await updateDoc(userDoc(targetCollection, product.id), {
        stockBase: Number(equivalenteBase),
        stockActual: Number(equivalenteBase),
      });
      await registerInventoryChange({
        product,
        tipoMovimiento: "conteo",
        stockAnterior,
        stockNuevo: Number(equivalenteBase),
      });

      setProducts((prev) =>
        prev.map((p) =>
          p.id === product.id
            ? {
                ...p,
                stockBase: Number(equivalenteBase),
                stockActual: Number(equivalenteBase),
              }
            : p
        )
      );
    } catch (error) {
      alert(error.message);
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
            <option value="todos">Todos los proveedores</option>
            {proveedores.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
        </div>

        {visibleProducts.length === 0 ? (
          <p>
            {selectedProveedorId !== "todos"
              ? `No hay productos para el proveedor seleccionado (${selectedProveedor?.nombre || selectedProveedorId}).`
              : "No hay productos para mostrar"}
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
                    <th>Equivalente base</th>
                    <th>Estado</th>
                    <th>Recomendado</th>
                    <th>Guardar</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleProducts.map((product) => {
                    const medidaSeleccionada = medidasConteo[product.id] || "base";
                    const unidadesPorInterna = getUnidadesPorInterna(product);
                    const cantidadContada = conteos[product.id] ?? String(getStockBase(product));
                    const equivalenteBase =
                      medidaSeleccionada === "interna"
                        ? Number(cantidadContada || 0) * unidadesPorInterna
                        : Number(cantidadContada || 0);
                    const recomendado = calcularRecomendacion(product, equivalenteBase);
                    const estado = getStockEstado(product, equivalenteBase);
                    const recomendadoInterna =
                      unidadesPorInterna > 0 ? recomendado / unidadesPorInterna : null;

                    return (
                      <tr key={product.id}>
                        <td>{product.nombre}</td>
                        <td>
                          <select
                            className="input-modern"
                            value={medidaSeleccionada}
                            onChange={(e) =>
                              setMedidasConteo((prev) => ({ ...prev, [product.id]: e.target.value }))
                            }
                          >
                            <option value="base">{product.medidaBase || "UN"}</option>
                            {product.medidaInterna && (
                              <option value="interna">{product.medidaInterna}</option>
                            )}
                          </select>
                        </td>
                        <td>
                          <input
                            className="input-modern"
                            type="number"
                            step="any"
                            value={cantidadContada}
                            onChange={(e) =>
                              setConteos((prev) => ({ ...prev, [product.id]: e.target.value }))
                            }
                          />
                        </td>
                        <td>{equivalenteBase.toFixed(2)} {product.medidaBase || "UN"}</td>
                        <td style={{ color: estado.color }}>{estado.label}</td>
                        <td>
                          {recomendado > 0
                            ? `Pedir ${recomendado.toFixed(2)} ${product.medidaBase || "UN"}${
                                recomendadoInterna !== null && product.medidaInterna
                                  ? ` (${recomendadoInterna.toFixed(2)} ${product.medidaInterna})`
                                  : ""
                              }`
                            : "Stock suficiente"}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => handleSaveCount(product)}
                          >
                            Guardar
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="conteo-cards">
              {visibleProducts.map((product) => {
                const medidaSeleccionada = medidasConteo[product.id] || "base";
                const unidadesPorInterna = getUnidadesPorInterna(product);
                const cantidadContada = conteos[product.id] ?? String(getStockBase(product));
                const equivalenteBase =
                  medidaSeleccionada === "interna"
                    ? Number(cantidadContada || 0) * unidadesPorInterna
                    : Number(cantidadContada || 0);
                const recomendado = calcularRecomendacion(product, equivalenteBase);
                const estado = getStockEstado(product, equivalenteBase);
                const recomendadoInterna =
                  unidadesPorInterna > 0 ? recomendado / unidadesPorInterna : null;

                return (
                  <div key={`${product.id}-card`} className="conteo-card">
                    <div className="conteo-header">
                      <h4>{product.nombre}</h4>
                      <span className="stock-badge">
                        Stock actual: {getStockBase(product).toFixed(2)} {product.medidaBase || "UN"}
                      </span>
                    </div>

                    <div className="conteo-inputs">
                      <div>
                        <label>Medida</label>
                        <select
                          className="input-modern"
                          value={medidaSeleccionada}
                          onChange={(e) =>
                            setMedidasConteo((prev) => ({ ...prev, [product.id]: e.target.value }))
                          }
                        >
                          <option value="base">{product.medidaBase || "UN"}</option>
                          {product.medidaInterna && (
                            <option value="interna">{product.medidaInterna}</option>
                          )}
                        </select>
                      </div>

                      <div>
                        <label>Cantidad</label>
                        <input
                          className="input-modern"
                          type="number"
                          step="any"
                          value={cantidadContada}
                          onChange={(e) =>
                            setConteos((prev) => ({ ...prev, [product.id]: e.target.value }))
                          }
                        />
                      </div>
                    </div>

                    <div className="conteo-info">
                      <p>Equivalente: {equivalenteBase.toFixed(2)} {product.medidaBase || "UN"}</p>
                      <p className={`estado-${estado.color}`}>{estado.label}</p>
                      <p>
                        {recomendado > 0
                          ? `Pedir ${recomendado.toFixed(2)} ${product.medidaBase || "UN"}${
                              recomendadoInterna !== null && product.medidaInterna
                                ? ` (${recomendadoInterna.toFixed(2)} ${product.medidaInterna})`
                                : ""
                            }`
                          : "Stock suficiente"}
                      </p>
                    </div>

                    <button
                      type="button"
                      className="btn-primary full-width"
                      onClick={() => handleSaveCount(product)}
                    >
                      Guardar
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default Conteo;


