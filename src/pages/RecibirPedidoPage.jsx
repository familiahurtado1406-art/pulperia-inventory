import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  getDocs,
  increment,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import {
  getStockBaseValue,
  registerInventoryChange,
} from "../services/inventoryHistoryService";
import {
  getProviderProductLinksByProvider,
  upsertProviderProductLink,
} from "../services/providerProductService";
import { userCollection, userDoc, userSubcollection } from "../services/userScopedFirestore";

function RecibirPedidoPage() {
  const [suppliers, setSuppliers] = useState([]);
  const [selectedSupplier, setSelectedSupplier] = useState("");
  const [supplierProducts, setSupplierProducts] = useState([]);
  const [search, setSearch] = useState("");
  const [receivedItems, setReceivedItems] = useState([]);

  const [selectedProduct, setSelectedProduct] = useState(null);
  const [medidaEntrada, setMedidaEntrada] = useState("base");
  const [cantidad, setCantidad] = useState("");
  const [costoTotal, setCostoTotal] = useState("");
  const [margen, setMargen] = useState("20");
  const [precioVentaUnidadManual, setPrecioVentaUnidadManual] = useState("");
  const [precioOriginal, setPrecioOriginal] = useState(0);
  const [showPriceConfirmModal, setShowPriceConfirmModal] = useState(false);
  const [pendingItemData, setPendingItemData] = useState(null);

  useEffect(() => {
    const init = async () => {
      const snapshot = await getDocs(userCollection("proveedores"));
      setSuppliers(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
    };
    init();
  }, []);

  const costoUnitario = useMemo(() => {
    const c = Number(cantidad);
    const t = Number(costoTotal);
    if (c <= 0 || t <= 0) return 0;
    return Number((t / c).toFixed(2));
  }, [cantidad, costoTotal]);

  const precioVentaUnidadCalculado = useMemo(() => {
    if (costoUnitario <= 0) return 0;
    return Number((costoUnitario * (1 + Number(margen) / 100)).toFixed(2));
  }, [costoUnitario, margen]);

  const precioVentaUnidad =
    precioVentaUnidadManual === ""
      ? precioVentaUnidadCalculado
      : Number(precioVentaUnidadManual);

  const gananciaUnidad = useMemo(() => {
    return Number((Number(precioVentaUnidad) - Number(costoUnitario)).toFixed(2));
  }, [precioVentaUnidad, costoUnitario]);

  const filteredProducts = useMemo(() => {
    if (!search) return [];
    return supplierProducts.filter((p) =>
      (p.nombre || "").toLowerCase().includes(search.toLowerCase())
    );
  }, [search, supplierProducts]);
  const previewCantidadBase = useMemo(() => {
    if (!selectedProduct) return 0;
    const cantidadNum = Number(cantidad || 0);
    const unidadesPorInterna = Number(
      selectedProduct.unidadesPorInterna ?? selectedProduct.unidadesPorPack ?? 0
    );

    if (medidaEntrada === "interna" && unidadesPorInterna > 0) {
      return cantidadNum * unidadesPorInterna;
    }
    return cantidadNum;
  }, [selectedProduct, cantidad, medidaEntrada]);
  const previewGananciaTotal = useMemo(
    () => Number(gananciaUnidad || 0) * Number(previewCantidadBase || 0),
    [gananciaUnidad, previewCantidadBase]
  );

  const totalInvertido = useMemo(
    () => receivedItems.reduce((acc, item) => acc + Number(item.totalFactura || 0), 0),
    [receivedItems]
  );
  const gananciaTotal = useMemo(
    () =>
      receivedItems.reduce(
        (acc, item) => acc + Number(item.gananciaUnidad || 0) * Number(item.cantidadBase || 0),
        0
      ),
    [receivedItems]
  );
  const margenPromedio = useMemo(() => {
    if (totalInvertido <= 0) return 0;
    return (gananciaTotal / totalInvertido) * 100;
  }, [gananciaTotal, totalInvertido]);

  const loadSupplierProducts = async (supplierId) => {
    if (!supplierId) {
      setSupplierProducts([]);
      return;
    }

    const [links, snapshot] = await Promise.all([
      getProviderProductLinksByProvider(supplierId),
      getDocs(query(userCollection("products"), where("activo", "==", true))),
    ]);
    const ids = new Set(links.map((link) => String(link.productDocId || link.productoId || "")));
    setSupplierProducts(
      snapshot.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((product) => ids.has(String(product.id)))
    );
  };

  const handleSupplierChange = async (supplierId) => {
    setSelectedSupplier(supplierId);
    await loadSupplierProducts(supplierId);
  };

  const handleMargenChange = (nuevoMargen) => {
    if (nuevoMargen === "") {
      setMargen("");
      setPrecioVentaUnidadManual("");
      return;
    }

    const margenNum = Number(nuevoMargen || 0);
    const nuevoPrecioUnidad = costoUnitario * (1 + margenNum / 100);

    setMargen(String(nuevoMargen));
    setPrecioVentaUnidadManual(nuevoPrecioUnidad.toFixed(2));
  };

  const handlePrecioVentaUnidadChange = (value) => {
    setPrecioVentaUnidadManual(value);

    if (costoUnitario > 0 && value !== "") {
      const nuevoPrecioUnidad = Number(value);
      const nuevoMargen =
        ((nuevoPrecioUnidad - costoUnitario) / costoUnitario) * 100;
      setMargen(Number(nuevoMargen.toFixed(2)).toString());
    }
  };

  const openProductModal = (product) => {
    const basePrice = Number(product.precioVentaBase ?? product.precioVenta ?? 0);
    setSelectedProduct(product);
    setMedidaEntrada("base");
    setCantidad("");
    setCostoTotal("");
    setMargen("20");
    setPrecioOriginal(basePrice);
    setPrecioVentaUnidadManual(basePrice > 0 ? basePrice.toFixed(2) : "");
    setShowPriceConfirmModal(false);
    setPendingItemData(null);
  };

  const buildReceivedItem = ({ product, cantidadIngresada, cantidadBase, finalPrice, supplierId }) => {
    const costoUnitarioNum = Number(costoUnitario || 0);
    const precioFinalNum = Number(finalPrice || 0);
    const gananciaUnidadFinal = Number((precioFinalNum - costoUnitarioNum).toFixed(2));
    const margenFinal =
      costoUnitarioNum > 0
        ? Number((((precioFinalNum - costoUnitarioNum) / costoUnitarioNum) * 100).toFixed(2))
        : 0;
    const unidadesPorInterna = Number(
      product.unidadesPorInterna ?? product.unidadesPorPack ?? 0
    );

    return {
      productDocId: product.id,
      nombre: product.nombre,
      medidaBase: product.medidaBase || "UN",
      medidaInterna: product.medidaInterna || null,
      medidaEntrada,
      cantidadIngresada,
      cantidadBase,
      unidadesUltimaCompra: cantidadBase,
      unidadesPorInterna: unidadesPorInterna > 0 ? unidadesPorInterna : null,
      costoUnitario: costoUnitarioNum,
      margen: margenFinal,
      precioVentaUnidad: precioFinalNum,
      gananciaUnidad: gananciaUnidadFinal,
      totalFactura: Number(costoTotal || 0),
      proveedorId: supplierId,
      actualizarPrecio: Math.abs(precioFinalNum - Number(precioOriginal || 0)) > 0.009,
    };
  };

  const finalizeAddItem = ({ updatePrice }) => {
    if (!pendingItemData) return;
    const finalPrice = updatePrice ? pendingItemData.proposedPrice : Number(precioOriginal || 0);
    const item = buildReceivedItem({
      product: pendingItemData.product,
      cantidadIngresada: pendingItemData.cantidadIngresada,
      cantidadBase: pendingItemData.cantidadBase,
      finalPrice,
      supplierId: selectedSupplier,
    });

    if (!updatePrice) {
      item.actualizarPrecio = false;
    }

    setReceivedItems((prev) => [...prev, item]);
    setSelectedProduct(null);
    setSearch("");
    setShowPriceConfirmModal(false);
    setPendingItemData(null);
  };

  const handleAddItem = () => {
    if (!selectedProduct) return;

    const cantidadNum = Number(cantidad);
    const costoTotalNum = Number(costoTotal);
    if (cantidadNum <= 0 || costoTotalNum <= 0 || costoUnitario <= 0) {
      alert("Completa cantidad y costo total validos");
      return;
    }

    const unidadesPorInterna = Number(
      selectedProduct.unidadesPorInterna ?? selectedProduct.unidadesPorPack ?? 0
    );
    if (medidaEntrada === "interna" && unidadesPorInterna <= 0) {
      alert("Este producto no tiene equivalencia interna configurada");
      return;
    }

    const cantidadBase =
      medidaEntrada === "interna" ? cantidadNum * unidadesPorInterna : cantidadNum;
    const proposedPrice = Number(precioVentaUnidad || 0);
    const originalPrice = Number(precioOriginal || 0);

    setPendingItemData({
      product: selectedProduct,
      cantidadIngresada: cantidadNum,
      cantidadBase,
      proposedPrice,
      costoTotalNum,
    });

    if (Math.abs(proposedPrice - originalPrice) > 0.009) {
      setShowPriceConfirmModal(true);
      return;
    }

    const item = buildReceivedItem({
      product: selectedProduct,
      cantidadIngresada: cantidadNum,
      cantidadBase,
      finalPrice: proposedPrice,
      supplierId: selectedSupplier,
    });
    item.actualizarPrecio = false;
    setReceivedItems((prev) => [...prev, item]);
    setSelectedProduct(null);
    setSearch("");
    setPendingItemData(null);
  };

  const handleSavePedido = async () => {
    if (!selectedSupplier) {
      alert("Selecciona un proveedor");
      return;
    }
    if (receivedItems.length === 0) {
      alert("No hay productos agregados");
      return;
    }

    try {
      const supplierName =
        suppliers.find((supplier) => supplier.id === selectedSupplier)?.nombre ||
        selectedSupplier;
      const currentStockByProduct = supplierProducts.reduce((acc, product) => {
        acc[product.id] = getStockBaseValue(product);
        return acc;
      }, {});

      for (const item of receivedItems) {
        const stockAnterior = Number(currentStockByProduct[item.productDocId] || 0);
        const cantidadBase = Number(item.cantidadBase || 0);
        const stockNuevo = stockAnterior + cantidadBase;

        const updatePayload = {
          stockBase: increment(cantidadBase),
          stockActual: increment(cantidadBase),
          unidadesUltimaCompra: Number(item.unidadesUltimaCompra),
          costoUnitarioBase: Number(item.costoUnitario),
          costoUnitario: Number(item.costoUnitario),
          ultimaActualizacion: serverTimestamp(),
        };

        if (item.actualizarPrecio) {
          updatePayload.margen = Number(item.margen);
          updatePayload.precioVentaBase = Number(item.precioVentaUnidad);
          updatePayload.precioVentaUnidad = Number(item.precioVentaUnidad);
          updatePayload.gananciaUnidad = Number(item.gananciaUnidad);
          updatePayload.precioVenta = Number(item.precioVentaUnidad);
        }

        await updateDoc(userDoc("products", item.productDocId), updatePayload);
        await registerInventoryChange({
          product: {
            id: item.productDocId,
            productoId: item.productDocId,
            nombre: item.nombre,
          },
          tipoMovimiento: "recibir_pedido",
          stockAnterior,
          stockNuevo,
        });

        await addDoc(userSubcollection("products", item.productDocId, "historialPrecios"), {
          proveedorId: selectedSupplier,
          proveedorNombre: supplierName,
          costoUnitarioBase: Number(item.costoUnitario || 0),
          fecha: serverTimestamp(),
        });
        await upsertProviderProductLink({
          productDocId: item.productDocId,
          productoId: item.productDocId,
          proveedorId: selectedSupplier,
          proveedorNombre: supplierName,
          costoUnitario: Number(item.costoUnitario || 0),
          costoPack: null,
          activo: true,
        });

        currentStockByProduct[item.productDocId] = stockNuevo;
      }

      await addDoc(userCollection("movimientos"), {
        type: "entrada",
        supplierId: selectedSupplier,
        items: receivedItems,
        createdAt: serverTimestamp(),
      });

      setReceivedItems([]);
      alert("Pedido registrado correctamente");
      await loadSupplierProducts(selectedSupplier);
    } catch (error) {
      console.error(error);
      alert("Error al registrar pedido");
    }
  };

  return (
    <div>
      <div className="section-card">
        <h3 className="section-title">Recibir Pedido</h3>
        <div className="row">
          <select
            className="input-modern proveedor-select"
            value={selectedSupplier}
            onChange={(e) => handleSupplierChange(e.target.value)}
          >
            <option value="">Seleccionar proveedor</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre || s.id}
              </option>
            ))}
          </select>

          <input
            className="input-modern buscador"
            placeholder="Buscar producto..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {search && (
          <div className="suggestions-box">
            {filteredProducts.map((p) => (
              <button
                key={p.id}
                type="button"
                className="suggestion-item"
                onClick={() => openProductModal(p)}
              >
                {p.nombre}
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedProduct && (
        <div className="section-card">
          <h3 className="section-title">{selectedProduct.nombre}</h3>
          <select
            className="input-modern"
            value={medidaEntrada}
            onChange={(e) => setMedidaEntrada(e.target.value)}
          >
            <option value="base">{selectedProduct.medidaBase || "UN"}</option>
            {selectedProduct.medidaInterna && (
              <option value="interna">{selectedProduct.medidaInterna}</option>
            )}
          </select>
          <p className="badge-info">
            Unidad seleccionada:{" "}
            <strong>
              {medidaEntrada === "interna"
                ? selectedProduct.medidaInterna || selectedProduct.medidaBase || "UN"
                : selectedProduct.medidaBase || "UN"}
            </strong>
          </p>
          {Number(selectedProduct.unidadesPorInterna ?? selectedProduct.unidadesPorPack ?? 0) >
            0 &&
            Number(cantidad || 0) > 0 && (
            <p className="badge-info">
              Equivalente base:{" "}
              {(
                (medidaEntrada === "interna"
                  ? Number(cantidad || 0) *
                    Number(
                      selectedProduct.unidadesPorInterna ??
                        selectedProduct.unidadesPorPack ??
                        0
                    )
                  : Number(cantidad || 0))
              ).toFixed(2)}{" "}
              {selectedProduct.medidaBase || "UN"}
            </p>
          )}
          <div className="receive-form-grid">
            <div className="input-group">
              <label htmlFor="cantidad-recibida">Cantidad recibida</label>
              <input
                id="cantidad-recibida"
                className="input-modern"
                type="number"
                value={cantidad}
                onChange={(e) => setCantidad(e.target.value)}
              />
              <small>Ingresa la cantidad en la medida seleccionada.</small>
            </div>

            <div className="input-group">
              <label htmlFor="costo-total">Costo total de la compra</label>
              <input
                id="costo-total"
                className="input-modern"
                type="number"
                value={costoTotal}
                onChange={(e) => setCostoTotal(e.target.value)}
              />
              <small>El sistema calcula el costo por unidad base automaticamente.</small>
            </div>

            <div className="input-group">
              <label htmlFor="costo-unitario-base">Costo por unidad base</label>
              <input
                id="costo-unitario-base"
                className="input-modern"
                type="number"
                value={costoUnitario}
                readOnly
              />
              <small>Calculado automaticamente.</small>
            </div>

            <div className="input-group">
              <label htmlFor="margen-deseado">
                Margen deseado (%)
                <span className="tooltip">?</span>
              </label>
              <input
                id="margen-deseado"
                className="input-modern"
                type="number"
                step="0.01"
                value={margen}
                onChange={(e) => handleMargenChange(e.target.value)}
              />
              <small>Ingresa cualquier porcentaje (ej. 7.5, 13.2, 32.14).</small>
              <small>Margen real: {Number(margen || 0).toFixed(2)}%</small>
            </div>

            <div className="input-group">
              <label htmlFor="precio-venta-sugerido">Precio venta sugerido</label>
              <input
                id="precio-venta-sugerido"
                className="input-modern"
                type="number"
                value={precioVentaUnidad}
                onChange={(e) => handlePrecioVentaUnidadChange(e.target.value)}
              />
              <small>Puedes ajustarlo manualmente y el margen se actualiza.</small>
            </div>

            <div className="input-group">
              <label htmlFor="ganancia-estimada">Ganancia estimada por unidad</label>
              <input
                id="ganancia-estimada"
                className="input-modern"
                type="number"
                value={gananciaUnidad}
                readOnly
              />
              <small>Calculado automaticamente.</small>
            </div>
          </div>
          <div className="spacer" />
          <button type="button" className="btn-primary" onClick={handleAddItem}>
            Confirmar
          </button>
          <div className="preview-box">
            <p>
              Equivalente base: {previewCantidadBase.toFixed(2)}{" "}
              {selectedProduct.medidaBase || "UN"}
            </p>
            <p>Inversion total: C${Number(costoTotal || 0).toFixed(2)}</p>
            <p>Ganancia estimada: C${previewGananciaTotal.toFixed(2)}</p>
          </div>
        </div>
      )}

      {showPriceConfirmModal && pendingItemData && (
        <div className="modal-overlay" onClick={() => setShowPriceConfirmModal(false)}>
          <div className="modal modal-compact" onClick={(e) => e.stopPropagation()}>
            <h3>Actualizar precio</h3>
            <p>
              Precio anterior: <strong>C${Number(precioOriginal || 0).toFixed(2)}</strong>
            </p>
            <p>
              Precio actual: <strong>C${Number(pendingItemData.proposedPrice || 0).toFixed(2)}</strong>
            </p>
            <div className="modal-buttons">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => finalizeAddItem({ updatePrice: false })}
              >
                No actualizar
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => finalizeAddItem({ updatePrice: true })}
              >
                Si actualizar
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="section-card">
        <h3 className="section-title">Detalle de ingreso</h3>
        <div className="pedido-summary">
          <div className="summary-card">
            <p>Total Invertido</p>
            <h3>C${totalInvertido.toFixed(2)}</h3>
          </div>
          <div className="summary-card ganancia">
            <p>Ganancia Estimada</p>
            <h3>C${gananciaTotal.toFixed(2)}</h3>
          </div>
          <div className="summary-card margen">
            <p>Margen Promedio</p>
            <h3>{margenPromedio.toFixed(2)}%</h3>
          </div>
        </div>

        <div className="table-scroll">
          <table className="table-modern">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Cantidad ingresada</th>
                <th>Cantidad Base</th>
                <th>Costo Unitario</th>
                <th>Margen</th>
                <th>Precio Venta Unidad</th>
                <th>Ganancia Unidad</th>
                <th>Ganancia Total</th>
                <th>Total Factura</th>
              </tr>
            </thead>
            <tbody>
              {receivedItems.map((item, index) => (
                <tr key={`${item.productDocId}-${index}`}>
                  <td>{item.nombre}</td>
                  <td>
                    {item.cantidadIngresada}{" "}
                    {item.medidaEntrada === "interna"
                      ? item.medidaInterna || item.medidaBase
                      : item.medidaBase}
                  </td>
                  <td>
                    {item.cantidadBase} {item.medidaBase}
                  </td>
                  <td>{item.costoUnitario.toFixed(2)}</td>
                  <td>{item.margen}%</td>
                  <td>{item.precioVentaUnidad.toFixed(2)}</td>
                  <td>{item.gananciaUnidad.toFixed(2)}</td>
                  <td>
                    {(Number(item.gananciaUnidad || 0) * Number(item.cantidadBase || 0)).toFixed(2)}
                  </td>
                  <td>{item.totalFactura.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="pedido-list">
          {receivedItems.map((item, index) => {
            const equivalenciaInterna =
              item.medidaInterna && Number(item.unidadesPorInterna || 0) > 0
                ? Number(item.cantidadBase || 0) / Number(item.unidadesPorInterna)
                : null;
            const gananciaItem =
              Number(item.gananciaUnidad || 0) * Number(item.cantidadBase || 0);

            return (
              <div key={`${item.productDocId}-${index}-card`} className="pedido-card">
                <div className="pedido-card-header">
                  <h4>{item.nombre}</h4>
                  <span className="precio-unitario">
                    C${Number(item.precioVentaUnidad || 0).toFixed(2)}
                  </span>
                </div>

                <div className="pedido-card-body">
                  <p>
                    <strong>Recibido:</strong> {item.cantidadBase} {item.medidaBase}
                  </p>
                  {equivalenciaInterna !== null && (
                    <p>
                      <strong>Equivalente:</strong> {equivalenciaInterna.toFixed(2)}{" "}
                      {item.medidaInterna}
                    </p>
                  )}
                  <p>
                    <strong>Costo total:</strong> C${Number(item.totalFactura || 0).toFixed(2)}
                  </p>
                  <p>
                    <strong>Ganancia estimada:</strong> C${gananciaItem.toFixed(2)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="spacer" />
        <button type="button" className="btn-primary" onClick={handleSavePedido}>
          Guardar Pedido
        </button>
      </div>
    </div>
  );
}

export default RecibirPedidoPage;


