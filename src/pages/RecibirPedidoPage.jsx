import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
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
  const [providerLinkByProductId, setProviderLinkByProductId] = useState({});
  const [search, setSearch] = useState("");
  const [receivedItems, setReceivedItems] = useState([]);
  const [editingItemIndex, setEditingItemIndex] = useState(null);

  const [selectedProduct, setSelectedProduct] = useState(null);
  const [modoIngresoInventario, setModoIngresoInventario] = useState("sumar");
  const [medidaEntrada, setMedidaEntrada] = useState("base");
  const [cantidad, setCantidad] = useState("");
  const [cantidadBaseAdicional, setCantidadBaseAdicional] = useState("");
  const [tipoImpuesto, setTipoImpuesto] = useState("NO_IMPUESTO");
  const [costoTotal, setCostoTotal] = useState("");
  const [margen, setMargen] = useState("20");
  const [precioVentaUnidadManual, setPrecioVentaUnidadManual] = useState("");
  const [precioEditadoManualmente, setPrecioEditadoManualmente] = useState(false);
  const [precioOriginal, setPrecioOriginal] = useState(0);
  const [showPriceConfirmModal, setShowPriceConfirmModal] = useState(false);
  const [pendingItemData, setPendingItemData] = useState(null);
  const [isSavingPedido, setIsSavingPedido] = useState(false);
  const unidadesPorInternaActual = Number(
    selectedProduct?.unidadesPorInterna ?? selectedProduct?.unidadesPorPack ?? 0
  );

  useEffect(() => {
    const init = async () => {
      const snapshot = await getDocs(userCollection("proveedores"));
      setSuppliers(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
    };
    init();
  }, []);

  const cantidadBaseActual = useMemo(() => {
    const cantidadNum = Number(cantidad || 0);
    const adicionalBase = Number(cantidadBaseAdicional || 0);
    if (!selectedProduct) return cantidadNum;

    const unidadesPorInterna = Number(
      selectedProduct.unidadesPorInterna ?? selectedProduct.unidadesPorPack ?? 0
    );

    if (medidaEntrada === "interna" && unidadesPorInterna > 0) {
      return cantidadNum * unidadesPorInterna + adicionalBase;
    }
    return cantidadNum + adicionalBase;
  }, [selectedProduct, cantidad, medidaEntrada, cantidadBaseAdicional]);

  const ivaMonto = useMemo(() => {
    const subtotal = Number(costoTotal || 0);
    if (subtotal <= 0) return 0;
    return tipoImpuesto === "IVA" ? Number((subtotal * 0.15).toFixed(2)) : 0;
  }, [costoTotal, tipoImpuesto]);

  const costoConImpuesto = useMemo(() => {
    const subtotal = Number(costoTotal || 0);
    if (subtotal <= 0) return 0;
    return Number((subtotal + ivaMonto).toFixed(2));
  }, [costoTotal, ivaMonto]);

  const costoUnitario = useMemo(() => {
    const c = Number(cantidadBaseActual || 0);
    const t = Number(costoConImpuesto);
    if (c <= 0 || t <= 0) return 0;
    return Number((t / c).toFixed(2));
  }, [cantidadBaseActual, costoConImpuesto]);

  const precioVentaUnidadCalculado = useMemo(() => {
    if (costoUnitario <= 0) return Number(precioOriginal || 0);
    return Number((costoUnitario * (1 + Number(margen) / 100)).toFixed(2));
  }, [costoUnitario, margen, precioOriginal]);

  const precioVentaUnidad =
    precioEditadoManualmente
      ? Number(precioVentaUnidadManual || 0)
      : precioVentaUnidadCalculado;

  const gananciaUnidad = useMemo(() => {
    return Number((Number(precioVentaUnidad) - Number(costoUnitario)).toFixed(2));
  }, [precioVentaUnidad, costoUnitario]);

  const filteredProducts = useMemo(() => {
    if (!search) return [];
    return supplierProducts.filter((p) =>
      (p.nombre || "").toLowerCase().includes(search.toLowerCase())
    );
  }, [search, supplierProducts]);
  const previewCantidadBase = cantidadBaseActual;
  const stockActualSeleccionado = Number(
    selectedProduct ? getStockBaseValue(selectedProduct) : 0
  );
  const previewStockFinal =
    modoIngresoInventario === "desde_cero"
      ? Number(previewCantidadBase || 0)
      : Number(stockActualSeleccionado || 0) + Number(previewCantidadBase || 0);
  const previewGananciaTotal = useMemo(
    () => Number(gananciaUnidad || 0) * Number(previewCantidadBase || 0),
    [gananciaUnidad, previewCantidadBase]
  );
  const previousProviderCost = useMemo(() => {
    if (!selectedProduct) return 0;
    return Number(providerLinkByProductId[selectedProduct.id]?.costoUnitario || 0);
  }, [selectedProduct, providerLinkByProductId]);
  const priceIncreaseInfo = useMemo(() => {
    const prev = Number(previousProviderCost || 0);
    const next = Number(costoUnitario || 0);
    if (prev <= 0 || next <= 0 || next <= prev) return null;
    const changePercent = Number((((next - prev) / prev) * 100).toFixed(2));
    return {
      prev,
      next,
      changePercent,
    };
  }, [previousProviderCost, costoUnitario]);
  const margenPorRotacionSugerido = useMemo(() => {
    const tipo = String(
      selectedProduct?.tipoRotacion || selectedProduct?.rotacion || ""
    ).toLowerCase();
    if (tipo === "alta" || tipo === "rapido" || tipo === "rápido") return 15;
    if (tipo === "media" || tipo === "medio") return 20;
    if (tipo === "baja" || tipo === "lento") return 30;
    if (tipo === "muerto") return 35;
    return 20;
  }, [selectedProduct]);
  const precioRecomendadoPorRotacion = useMemo(() => {
    if (costoUnitario <= 0) return 0;
    return Number((costoUnitario * (1 + margenPorRotacionSugerido / 100)).toFixed(2));
  }, [costoUnitario, margenPorRotacionSugerido]);

  const totalInvertido = useMemo(
    () =>
      receivedItems.reduce(
        (acc, item) => acc + Number(item.costoConImpuesto ?? item.totalFactura ?? 0),
        0
      ),
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
  const totalIvaPagado = useMemo(
    () => receivedItems.reduce((acc, item) => acc + Number(item.ivaMonto || 0), 0),
    [receivedItems]
  );

  const loadSupplierProducts = async (supplierId) => {
    if (!supplierId) {
      setSupplierProducts([]);
      setProviderLinkByProductId({});
      return;
    }

    const [links, snapshot] = await Promise.all([
      getProviderProductLinksByProvider(supplierId),
      getDocs(query(userCollection("products"), where("activo", "==", true))),
    ]);
    const linksMap = links.reduce((acc, link) => {
      const productId = String(link.productDocId || link.productoId || "");
      if (!productId) return acc;
      acc[productId] = link;
      return acc;
    }, {});
    setProviderLinkByProductId(linksMap);
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
      setPrecioEditadoManualmente(false);
      return;
    }

    setMargen(String(nuevoMargen));
    setPrecioEditadoManualmente(false);
  };

  const handlePrecioVentaUnidadChange = (value) => {
    setPrecioVentaUnidadManual(value);
    setPrecioEditadoManualmente(true);

    if (costoUnitario > 0 && value !== "") {
      const nuevoPrecioUnidad = Number(value);
      const nuevoMargen =
        ((nuevoPrecioUnidad - costoUnitario) / costoUnitario) * 100;
      setMargen(Number(nuevoMargen.toFixed(2)).toString());
    }
  };

  const handleCantidadExtraChange = (value) => {
    let extra = Number(value || 0);
    if (!Number.isFinite(extra) || extra < 0) extra = 0;

    if (medidaEntrada === "interna" && unidadesPorInternaActual > 0) {
      const packsExtra = Math.floor(extra / unidadesPorInternaActual);
      if (packsExtra > 0) {
        setCantidad((prev) => String(Number(prev || 0) + packsExtra));
      }
      extra = extra % unidadesPorInternaActual;
    }

    setCantidadBaseAdicional(String(extra));
  };

  const openProductModal = (product) => {
    const basePrice = Number(product.precioVentaBase ?? product.precioVenta ?? 0);
    setSelectedProduct(product);
    setEditingItemIndex(null);
    setModoIngresoInventario("sumar");
    setMedidaEntrada("base");
    setCantidad("");
    setCantidadBaseAdicional("");
    setTipoImpuesto("NO_IMPUESTO");
    setCostoTotal("");
    setMargen("20");
    setPrecioOriginal(basePrice);
    setPrecioVentaUnidadManual(basePrice > 0 ? basePrice.toFixed(2) : "");
    setPrecioEditadoManualmente(false);
    setShowPriceConfirmModal(false);
    setPendingItemData(null);
  };

  const upsertReceivedItem = (item) => {
    if (editingItemIndex === null) {
      setReceivedItems((prev) => [...prev, item]);
      return;
    }

    setReceivedItems((prev) =>
      prev.map((currentItem, index) => (index === editingItemIndex ? item : currentItem))
    );
  };

  const handleEditItem = (item, index) => {
    const productFromList = supplierProducts.find((product) => product.id === item.productDocId);
    const productToEdit = productFromList || {
      id: item.productDocId,
      nombre: item.nombre,
      medidaBase: item.medidaBase,
      medidaInterna: item.medidaInterna,
      unidadesPorInterna: item.unidadesPorInterna,
      precioVentaBase: item.precioVentaUnidad,
      precioVenta: item.precioVentaUnidad,
      stockBase: 0,
      stockActual: 0,
    };

    setSelectedProduct(productToEdit);
    setEditingItemIndex(index);
    setModoIngresoInventario(item.modoIngresoInventario || "sumar");
    setMedidaEntrada(item.medidaEntrada || "base");
    setCantidad(String(Number(item.cantidadIngresada || 0)));
    setCantidadBaseAdicional(String(Number(item.cantidadBaseAdicional || 0)));
    setTipoImpuesto(item.impuestoTipo || "NO_IMPUESTO");
    setCostoTotal(String(Number(item.costoSinImpuesto ?? item.totalFactura ?? 0)));
    setMargen(String(Number(item.margen || 0)));
    setPrecioOriginal(Number(item.precioVentaUnidad || 0));
    setPrecioVentaUnidadManual(Number(item.precioVentaUnidad || 0).toFixed(2));
    setPrecioEditadoManualmente(false);
    setShowPriceConfirmModal(false);
    setPendingItemData(null);
    setSearch("");
  };

  const handleRemoveItem = (index) => {
    const item = receivedItems[index];
    if (!item) return;
    const confirmed = window.confirm(`Eliminar ${item.nombre} del pedido actual?`);
    if (!confirmed) return;

    setReceivedItems((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
    if (editingItemIndex === index) {
      setEditingItemIndex(null);
      setSelectedProduct(null);
      setPendingItemData(null);
      setShowPriceConfirmModal(false);
    }
  };

  const buildReceivedItem = ({
    product,
    cantidadIngresada,
    cantidadBase,
    finalPrice,
    supplierId,
    modoIngreso,
  }) => {
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
    const medidaBaseLabel = product.medidaBase || "UN";
    const medidaInternaLabel = product.medidaInterna || "PACK";
    const cantidadAdicionalNum = Number(cantidadBaseAdicional || 0);
    const detalleIngreso =
      medidaEntrada === "interna"
        ? `${Number(cantidadIngresada || 0)} ${medidaInternaLabel} + ${cantidadAdicionalNum} ${medidaBaseLabel}`
        : `${Number(cantidadBase || 0)} ${medidaBaseLabel}`;

    return {
      productDocId: product.id,
      nombre: product.nombre,
      medidaBase: product.medidaBase || "UN",
      medidaInterna: product.medidaInterna || null,
      medidaEntrada,
      cantidadIngresada,
      cantidadBaseAdicional: cantidadAdicionalNum,
      cantidadBase,
      unidades: cantidadBase,
      detalleIngreso,
      modoIngresoInventario: modoIngreso,
      unidadesUltimaCompra: cantidadBase,
      unidadesPorInterna: unidadesPorInterna > 0 ? unidadesPorInterna : null,
      costoUnitario: costoUnitarioNum,
      margen: margenFinal,
      precioVentaUnidad: precioFinalNum,
      gananciaUnidad: gananciaUnidadFinal,
      costoSinImpuesto: Number(costoTotal || 0),
      totalFactura: Number(costoConImpuesto || 0),
      impuestoTipo: tipoImpuesto,
      ivaMonto,
      costoConImpuesto,
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
      modoIngreso: pendingItemData.modoIngresoInventario,
    });

    if (!updatePrice) {
      item.actualizarPrecio = false;
    }

    upsertReceivedItem(item);
    setSelectedProduct(null);
    setEditingItemIndex(null);
    setSearch("");
    setShowPriceConfirmModal(false);
    setPendingItemData(null);
  };

  const handleAddItem = () => {
    if (!selectedProduct) return;

    const cantidadNum = Number(cantidad);
    const adicionalBase = Number(cantidadBaseAdicional || 0);
    const costoTotalNum = Number(costoTotal);
    if (previewCantidadBase <= 0 || costoTotalNum <= 0 || costoUnitario <= 0) {
      toast.error("Completa cantidad y costo total validos");
      return;
    }

    const unidadesPorInterna = Number(
      selectedProduct.unidadesPorInterna ?? selectedProduct.unidadesPorPack ?? 0
    );
    if (medidaEntrada === "interna" && unidadesPorInterna <= 0) {
      toast.error("Este producto no tiene equivalencia interna configurada");
      return;
    }
    if (priceIncreaseInfo) {
      const confirmed = window.confirm(
        `El proveedor subio el precio ${priceIncreaseInfo.changePercent}%\nPrecio anterior: C$${priceIncreaseInfo.prev.toFixed(2)}\nPrecio nuevo: C$${priceIncreaseInfo.next.toFixed(2)}\n\nDeseas continuar?`
      );
      if (!confirmed) return;
    }

    const cantidadBase =
      medidaEntrada === "interna"
        ? cantidadNum * unidadesPorInterna + adicionalBase
        : cantidadNum + adicionalBase;
    const proposedPrice = Number(precioVentaUnidad || 0);
    const originalPrice = Number(precioOriginal || 0);

    setPendingItemData({
      product: selectedProduct,
      cantidadIngresada: cantidadNum,
      cantidadBase,
      modoIngresoInventario,
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
      modoIngreso: modoIngresoInventario,
    });
    item.actualizarPrecio = false;
    upsertReceivedItem(item);
    setSelectedProduct(null);
    setEditingItemIndex(null);
    setSearch("");
    setPendingItemData(null);
  };

  const handleSavePedido = async () => {
    if (!selectedSupplier) {
      toast.error("Selecciona un proveedor");
      return;
    }
    if (receivedItems.length === 0) {
      toast.error("No hay productos agregados");
      return;
    }
    setIsSavingPedido(true);

    try {
      const supplierName =
        suppliers.find((supplier) => supplier.id === selectedSupplier)?.nombre ||
        selectedSupplier;
      const currentStockByProduct = supplierProducts.reduce((acc, product) => {
        acc[product.id] = getStockBaseValue(product);
        return acc;
      }, {});
      const movementItems = [];

      for (const item of receivedItems) {
        const stockAnterior = Number(currentStockByProduct[item.productDocId] || 0);
        const cantidadBase = Number(item.cantidadBase || 0);
        const modoIngreso = item.modoIngresoInventario || "sumar";
        const stockNuevo =
          modoIngreso === "desde_cero" ? cantidadBase : stockAnterior + cantidadBase;

        const updatePayload = {
          unidadesUltimaCompra: Number(item.unidadesUltimaCompra),
          costoUnitarioBase: Number(item.costoUnitario),
          costoUnitario: Number(item.costoUnitario),
          ultimaActualizacion: serverTimestamp(),
        };
        if (modoIngreso === "desde_cero") {
          updatePayload.stockBase = Number(cantidadBase);
          updatePayload.stockActual = Number(cantidadBase);
        } else {
          updatePayload.stockBase = increment(cantidadBase);
          updatePayload.stockActual = increment(cantidadBase);
        }

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
        await addDoc(userCollection("priceHistory"), {
          productId: item.productDocId,
          providerId: selectedSupplier,
          fecha: serverTimestamp(),
          costoUnitario: Number(item.costoUnitario || 0),
          cantidad: Number(item.cantidadBase || 0),
          ordenId: null,
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
        movementItems.push({
          ...item,
          tipo: "entrada",
          detalle: item.detalleIngreso,
          unidades: cantidadBase,
          modo: modoIngreso,
          stockAnterior,
          stockNuevo,
          costoUnitario: Number(item.costoUnitario || 0),
        });
      }

      await addDoc(userCollection("movimientos"), {
        type: "entrada",
        supplierId: selectedSupplier,
        items: movementItems,
        createdAt: serverTimestamp(),
      });

      setReceivedItems([]);
      toast.success("Pedido registrado correctamente");
      await loadSupplierProducts(selectedSupplier);
    } catch (error) {
      console.error(error);
      toast.error("Error al registrar pedido");
    } finally {
      setIsSavingPedido(false);
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
          <div className="input-group">
            <label>Tipo de ingreso de inventario</label>
            <div className="row">
              <label>
                <input
                  type="radio"
                  name="modo-ingreso-inventario"
                  value="desde_cero"
                  checked={modoIngresoInventario === "desde_cero"}
                  onChange={(e) => setModoIngresoInventario(e.target.value)}
                />{" "}
                Inventario desde 0
              </label>
              <label>
                <input
                  type="radio"
                  name="modo-ingreso-inventario"
                  value="sumar"
                  checked={modoIngresoInventario === "sumar"}
                  onChange={(e) => setModoIngresoInventario(e.target.value)}
                />{" "}
                Sumar al inventario actual
              </label>
            </div>
            {modoIngresoInventario === "desde_cero" && (
              <small>Esto reemplazara el stock actual.</small>
            )}
          </div>

          <div className="input-group">
            <label htmlFor="unidad-ingreso">Unidad de ingreso</label>
            <select
              id="unidad-ingreso"
              className="input-modern"
              value={medidaEntrada}
              onChange={(e) => setMedidaEntrada(e.target.value)}
            >
              <option value="base">{selectedProduct.medidaBase || "UN"}</option>
              {selectedProduct.medidaInterna && (
                <option value="interna">{selectedProduct.medidaInterna}</option>
              )}
            </select>
          </div>
          <p className="badge-info">
            Unidad seleccionada:{" "}
            <strong>
              {medidaEntrada === "interna"
                ? selectedProduct.medidaInterna || selectedProduct.medidaBase || "UN"
                : selectedProduct.medidaBase || "UN"}
              </strong>
          </p>
          {medidaEntrada === "interna" && unidadesPorInternaActual > 0 && (
            <p className="badge-info">
              1 {selectedProduct.medidaInterna || "PACK"} = {unidadesPorInternaActual}{" "}
              {selectedProduct.medidaBase || "UN"}
            </p>
          )}
          {previewCantidadBase > 0 && (
            <p className="badge-info">
              Equivalente base:{" "}
              {previewCantidadBase.toFixed(2)}{" "}
              {selectedProduct.medidaBase || "UN"}
            </p>
          )}
          {medidaEntrada === "interna" && previewCantidadBase > 0 && (
            <p className="badge-info">
              {Number(cantidad || 0)} {selectedProduct.medidaInterna || "PACK"} +{" "}
              {Number(cantidadBaseAdicional || 0)} {selectedProduct.medidaBase || "UN"} ={" "}
              {previewCantidadBase.toFixed(2)} {selectedProduct.medidaBase || "UN"}
            </p>
          )}
          <div className="receive-form-grid">
            <div className="input-group">
              <label htmlFor="cantidad-recibida">
                {medidaEntrada === "interna"
                  ? `Cantidad en ${selectedProduct.medidaInterna || "PACK"}`
                  : `Cantidad en ${selectedProduct.medidaBase || "UN"}`}
              </label>
              <input
                id="cantidad-recibida"
                className="input-modern"
                type="number"
                value={cantidad}
                onChange={(e) => setCantidad(e.target.value)}
              />
              <small>Ingresa la cantidad en la unidad de ingreso.</small>
            </div>

            <div className="input-group">
              <label htmlFor="cantidad-base-adicional">UN adicionales</label>
              <input
                id="cantidad-base-adicional"
                className="input-modern"
                type="number"
                value={cantidadBaseAdicional}
                min="0"
                step="1"
                onChange={(e) => handleCantidadExtraChange(e.target.value)}
              />
              <small>Opcional. Se suma al equivalente base.</small>
            </div>
            <div className="input-group">
              <label htmlFor="cantidad-recibida-automatica">Cantidad recibida (automatica)</label>
              <input
                id="cantidad-recibida-automatica"
                className="input-modern"
                type="number"
                value={Number(previewCantidadBase || 0)}
                readOnly
              />
              <small>Calculada automaticamente en unidades base.</small>
            </div>

            <div className="input-group">
              <label htmlFor="tipo-impuesto">Impuesto</label>
              <select
                id="tipo-impuesto"
                className="input-modern"
                value={tipoImpuesto}
                onChange={(e) => setTipoImpuesto(e.target.value)}
              >
                <option value="NO_IMPUESTO">NO IMPUESTO</option>
                <option value="IVA">IVA</option>
              </select>
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
              <small>Costo pagado al proveedor (sin impuesto).</small>
            </div>

            <div className="input-group">
              <label htmlFor="costo-con-impuesto">Costo + impuesto</label>
              <input
                id="costo-con-impuesto"
                className="input-modern"
                type="number"
                value={costoConImpuesto}
                readOnly
              />
              <small>
                Calculado automaticamente segun el tipo de impuesto. IVA aplicado: C$
                {ivaMonto.toFixed(2)}
              </small>
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
              <small>
                Recomendado por rotacion: C${precioRecomendadoPorRotacion.toFixed(2)} (
                {margenPorRotacionSugerido}%)
              </small>
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
            {editingItemIndex === null ? "Confirmar" : "Actualizar linea"}
          </button>
          <div className="preview-box">
            <p>Stock actual: {stockActualSeleccionado.toFixed(2)} {selectedProduct.medidaBase || "UN"}</p>
            <p>
              Ingreso:{" "}
              {medidaEntrada === "interna"
                ? `${Number(cantidad || 0)} ${selectedProduct.medidaInterna || "PACK"} + ${Number(cantidadBaseAdicional || 0)} ${selectedProduct.medidaBase || "UN"}`
                : `${Number(cantidad || 0)} ${selectedProduct.medidaBase || "UN"}`}
            </p>
            <p>Equivalente: {previewCantidadBase.toFixed(2)} {selectedProduct.medidaBase || "UN"}</p>
            <p>Stock final: {previewStockFinal.toFixed(2)} {selectedProduct.medidaBase || "UN"}</p>
            <p>Inversion total: C${Number(costoConImpuesto || 0).toFixed(2)}</p>
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
            <small>Incluye IVA. IVA pagado: C${totalIvaPagado.toFixed(2)}</small>
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
                <th>IVA</th>
                <th>Total Factura</th>
                <th>Acciones</th>
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
                    {Number(item.cantidadBaseAdicional || 0) > 0 &&
                      ` + ${Number(item.cantidadBaseAdicional || 0).toFixed(2)} ${item.medidaBase}`}
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
                  <td>{Number(item.ivaMonto || 0).toFixed(2)}</td>
                  <td>{item.totalFactura.toFixed(2)}</td>
                  <td>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => handleEditItem(item, index)}
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        style={{ backgroundColor: "#dc2626", color: "#fff", borderColor: "#dc2626" }}
                        onClick={() => handleRemoveItem(index)}
                      >
                        Eliminar
                      </button>
                    </div>
                  </td>
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
                  {Number(item.cantidadBaseAdicional || 0) > 0 && (
                    <p>
                      <strong>Adicional:</strong> {Number(item.cantidadBaseAdicional || 0).toFixed(2)}{" "}
                      {item.medidaBase}
                    </p>
                  )}
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
                <div
                  className="pedido-card-actions"
                  style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}
                >
                  <button
                    type="button"
                    className="btn-secondary"
                    style={{ backgroundColor: "#16a34a", color: "#fff", borderColor: "#16a34a" }}
                    onClick={() => handleEditItem(item, index)}
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    style={{ backgroundColor: "#dc2626", color: "#fff", borderColor: "#dc2626" }}
                    onClick={() => handleRemoveItem(index)}
                  >
                    Eliminar
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="spacer" />
        <button
          type="button"
          className="btn-primary"
          onClick={handleSavePedido}
          disabled={isSavingPedido}
        >
          {isSavingPedido ? "Guardando..." : "Guardar Pedido"}
        </button>
      </div>
    </div>
  );
}

export default RecibirPedidoPage;


