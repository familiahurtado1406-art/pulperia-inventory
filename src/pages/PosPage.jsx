import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  doc,
  getDocs,
  increment,
  query,
  serverTimestamp,
  writeBatch,
  where,
} from "firebase/firestore";
import { db } from "../firebase/config";
import { getStockBaseValue, registerInventoryChange } from "../services/inventoryHistoryService";
import { userCollection, userDoc } from "../services/userScopedFirestore";

const getDefaultVariant = (product) => {
  const basePrice = Number(product.precioVentaBase ?? product.precioVenta ?? 0);
  return {
    id: "base",
    name: product.medidaBase || "UN",
    units: 1,
    price: basePrice,
    barcode: product.codigoBarras || "",
  };
};

const getProductVariants = (product) => {
  const variants = Array.isArray(product.variants)
    ? product.variants.filter((variant) => Number(variant.units || 0) > 0)
    : [];
  return variants.length > 0 ? variants : [getDefaultVariant(product)];
};

function PosPage() {
  const searchInputRef = useRef(null);
  const cashInputRef = useRef(null);
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState([]);
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [receivedCash, setReceivedCash] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      const snapshot = await getDocs(query(userCollection("products"), where("activo", "==", true)));
      setProducts(snapshot.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() })));
    };
    load();
  }, []);

  const visibleProducts = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return [];
    return products
      .filter((product) => String(product.nombre || "").toLowerCase().includes(term))
      .slice(0, 20);
  }, [products, search]);

  const total = useMemo(
    () =>
      cart.reduce((acc, item) => acc + Number(item.price || 0) * Number(item.qty || 0), 0),
    [cart]
  );
  const changeAmount = useMemo(() => {
    if (paymentMethod !== "cash") return 0;
    const cash = Number(receivedCash || 0);
    return Number((cash - Number(total || 0)).toFixed(2));
  }, [paymentMethod, receivedCash, total]);

  useEffect(() => {
    if (!showPaymentModal || paymentMethod !== "cash") return;
    if (cashInputRef.current) cashInputRef.current.focus();
  }, [showPaymentModal, paymentMethod]);

  const addToCart = (product, variant) => {
    const key = `${product.id}__${variant.id || variant.name}`;
    setCart((prev) => {
      const existingIndex = prev.findIndex((item) => item.key === key);
      if (existingIndex >= 0) {
        return prev.map((item, index) =>
          index === existingIndex ? { ...item, qty: Number(item.qty || 0) + 1 } : item
        );
      }
      return [
        ...prev,
        {
          key,
          productId: product.id,
          productoId: product.productoId || product.id,
          name: product.nombre || product.id,
          variantId: variant.id || "",
          variantName: variant.name || product.medidaBase || "UN",
          unitsBase: Number(variant.units || 1),
          price: Number(variant.price || 0),
          qty: 1,
          medidaBase: product.medidaBase || "UN",
        },
      ];
    });
    setSearch("");
    if (searchInputRef.current) {
      searchInputRef.current.focus();
    }
  };

  const updateQty = (key, nextQty) => {
    setCart((prev) =>
      prev
        .map((item) => (item.key === key ? { ...item, qty: Math.max(0, Number(nextQty || 0)) } : item))
        .filter((item) => Number(item.qty || 0) > 0)
    );
  };

  const updatePrice = (key, nextPrice) => {
    setCart((prev) =>
      prev.map((item) =>
        item.key === key ? { ...item, price: Math.max(0, Number(nextPrice || 0)) } : item
      )
    );
  };

  const removeItem = (key) => {
    setCart((prev) => prev.filter((item) => item.key !== key));
  };

  const handleSaveSale = async () => {
    if (cart.length === 0) {
      toast.error("El carrito esta vacio");
      return;
    }
    if (paymentMethod === "cash") {
      const cash = Number(receivedCash || 0);
      if (!Number.isFinite(cash) || cash < Number(total || 0)) {
        toast.error("El dinero recibido es menor al total");
        return;
      }
    }

    const productById = products.reduce((acc, product) => {
      acc[product.id] = product;
      return acc;
    }, {});

    for (const line of cart) {
      const product = productById[line.productId];
      if (!product) {
        toast.error(`Producto no encontrado: ${line.name}`);
        return;
      }
      const stockActual = Number(getStockBaseValue(product) || 0);
      const unitsToDiscount = Number(line.unitsBase || 0) * Number(line.qty || 0);
      if (unitsToDiscount <= 0) {
        toast.error(`Cantidad invalida para ${line.name}`);
        return;
      }
      if (unitsToDiscount > stockActual) {
        toast.error(`Stock insuficiente para ${line.name}`);
        return;
      }
    }

    setIsSaving(true);
    try {
      const batch = writeBatch(db);
      const saleItems = cart.map((line) => {
        const qty = Number(line.qty || 0);
        const unitsTotal = Number(line.unitsBase || 0) * qty;
        const totalLine = Number((Number(line.price || 0) * qty).toFixed(2));
        return {
          productId: line.productId,
          productoId: line.productoId,
          nombre: line.name,
          variantId: line.variantId,
          variant: line.variantName,
          qty,
          unitsBase: Number(line.unitsBase || 0),
          unidades: unitsTotal,
          cantidadBase: unitsTotal,
          medidaBase: line.medidaBase || "UN",
          priceUnit: Number(line.price || 0),
          total: totalLine,
        };
      });

      const totalSale = Number(
        saleItems.reduce((acc, item) => acc + Number(item.total || 0), 0).toFixed(2)
      );

      const saleRef = doc(userCollection("sales"));
      batch.set(saleRef, {
        date: serverTimestamp(),
        total: totalSale,
        paymentMethod,
        receivedCash: paymentMethod === "cash" ? Number(receivedCash || 0) : null,
        change: paymentMethod === "cash" ? changeAmount : null,
        items: saleItems,
      });

      const movementItems = [];
      const historyTasks = [];
      for (const item of saleItems) {
        const product = productById[item.productId];
        const stockAnterior = Number(getStockBaseValue(product) || 0);
        const stockNuevo = Number((stockAnterior - Number(item.unidades || 0)).toFixed(4));

        batch.update(userDoc("products", item.productId), {
          stockBase: increment(-Number(item.unidades || 0)),
          stockActual: increment(-Number(item.unidades || 0)),
          ultimaActualizacion: serverTimestamp(),
        });

        historyTasks.push(registerInventoryChange({
          product,
          tipoMovimiento: "venta_pos",
          stockAnterior,
          stockNuevo,
          referenciaId: saleRef.id,
        }));

        movementItems.push({
          productDocId: item.productId,
          productoId: item.productoId,
          nombre: item.nombre,
          variant: item.variant,
          qty: item.qty,
          unidades: item.unidades,
          cantidadBase: item.cantidadBase,
          medidaBase: item.medidaBase,
          priceUnit: item.priceUnit,
          total: item.total,
        });

        const inventoryMovementRef = doc(userCollection("inventory_movements"));
        batch.set(inventoryMovementRef, {
          productId: item.productId,
          productoId: item.productoId,
          type: "salida",
          tipoMovimiento: "salida_venta",
          cantidadBase: Number(item.cantidadBase || 0),
          unidades: Number(item.unidades || 0),
          medidaBase: item.medidaBase,
          referenceId: saleRef.id,
          source: "pos",
          priceUnit: Number(item.priceUnit || 0),
          total: Number(item.total || 0),
          variant: item.variant || null,
          createdAt: serverTimestamp(),
        });
      }

      const movimientoRef = doc(userCollection("movimientos"));
      batch.set(movimientoRef, {
        type: "salida",
        createdAt: serverTimestamp(),
        saleId: saleRef.id,
        paymentMethod,
        total: totalSale,
        items: movementItems,
      });
      await batch.commit();

      const historyResults = await Promise.allSettled(historyTasks);
      const hasHistoryErrors = historyResults.some((result) => result.status === "rejected");
      if (hasHistoryErrors) {
        console.error("Errores en historial de cambios de POS", { historyResults });
      }

      setProducts((prev) =>
        prev.map((product) => {
          const soldUnits = saleItems
            .filter((item) => item.productId === product.id)
            .reduce((acc, item) => acc + Number(item.unidades || 0), 0);
          if (soldUnits <= 0) return product;
          const current = Number(getStockBaseValue(product) || 0);
          const next = Math.max(0, Number((current - soldUnits).toFixed(4)));
          return {
            ...product,
            stockBase: next,
            stockActual: next,
          };
        })
      );
      setCart([]);
      setReceivedCash("");
      setShowPaymentModal(false);
      toast.success(
        hasHistoryErrors
          ? "Venta guardada (con tareas secundarias pendientes)"
          : "Venta guardada correctamente"
      );
    } catch (error) {
      console.error(error);
      toast.error("Error guardando venta");
    } finally {
      setIsSaving(false);
    }
  };

  const handleOpenPaymentModal = () => {
    if (cart.length === 0) {
      toast.error("El carrito esta vacio");
      return;
    }
    setShowPaymentModal(true);
  };

  return (
    <div className="section-card">
      <h3 className="section-title">POS</h3>
      <div className="row search-container" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <span>🔍</span>
        <input
          ref={searchInputRef}
          className="input-modern buscador search-input"
          style={{ flex: 1, minWidth: "220px", background: "#fff" }}
          placeholder="Buscar producto..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="input-modern"
          value={paymentMethod}
          onChange={(e) => setPaymentMethod(e.target.value)}
        >
          <option value="cash">Efectivo</option>
          <option value="transfer">Transferencia</option>
          <option value="card">Tarjeta</option>
        </select>
      </div>
      <div className="spacer" />
      <h3 className="section-title">Resultados</h3>

      {search.trim() === "" ? (
        <p>Buscar producto o escanear codigo.</p>
      ) : (
        <div className="pedido-list">
          {visibleProducts.map((product) => (
          <div
            key={product.id}
            className="pedido-card"
            role="button"
            tabIndex={0}
            onClick={() => addToCart(product, getDefaultVariant(product))}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                addToCart(product, getDefaultVariant(product));
              }
            }}
            style={{ cursor: "pointer" }}
          >
            <div className="pedido-card-header">
              <h4>{product.nombre}</h4>
              <span className="precio-unitario">
                Stock: {Number(getStockBaseValue(product)).toFixed(2)} {product.medidaBase || "UN"}
              </span>
            </div>
            <div className="pedido-card-body">
              <p>
                Precio base: C$
                {Number(product.precioVentaBase ?? product.precioVenta ?? 0).toFixed(2)}
              </p>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "8px" }}>
              <button
                type="button"
                className="btn-primary"
                onClick={(e) => {
                  e.stopPropagation();
                  addToCart(product, getDefaultVariant(product));
                }}
              >
                +
              </button>
            </div>
            <div className="pedido-quick-actions">
              {getProductVariants(product).map((variant, index) => (
                <button
                  key={`${product.id}-${variant.id || variant.name || index}`}
                  type="button"
                  className="btn-secondary"
                  onClick={(e) => {
                    e.stopPropagation();
                    addToCart(product, variant);
                  }}
                >
                  {variant.name} - C${Number(variant.price || 0).toFixed(2)}
                </button>
              ))}
            </div>
          </div>
          ))}
          {visibleProducts.length === 0 && <p>No se encontraron productos.</p>}
        </div>
      )}

      <div className="spacer" />
      <h3 className="section-title">Carrito</h3>
      {cart.length === 0 ? (
        <p>No hay productos en el carrito.</p>
      ) : (
        <div className="pedido-list">
          {cart.map((item) => {
            const subtotal = Number(item.price || 0) * Number(item.qty || 0);
            return (
              <div key={item.key} className="pedido-card">
                <div className="pedido-card-header">
                  <h4>{item.name}</h4>
                  <span className="precio-unitario">
                    {item.variantName} ({Number(item.unitsBase || 0)} {item.medidaBase || "UN"})
                  </span>
                </div>
                <div
                  className="row"
                  style={{ alignItems: "center", gap: "8px", flexWrap: "nowrap" }}
                >
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => updateQty(item.key, Number(item.qty || 0) - 1)}
                  >
                    -
                  </button>
                  <strong style={{ minWidth: "24px", textAlign: "center" }}>{item.qty}</strong>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => updateQty(item.key, Number(item.qty || 0) + 1)}
                  >
                    +
                  </button>
                  <input
                    className="input-modern"
                    style={{ maxWidth: "110px" }}
                    type="number"
                    value={Number(item.price || 0)}
                    onChange={(e) => updatePrice(item.key, e.target.value)}
                  />
                  <strong style={{ marginLeft: "auto" }}>C${subtotal.toFixed(2)}</strong>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => removeItem(item.key)}
                  >
                    X
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="spacer" />
      <div className="summary-card" style={{ position: "sticky", bottom: 0 }}>
        <p>Total</p>
        <h3>C${Number(total || 0).toFixed(2)}</h3>
      </div>
      <div className="spacer" />
      <button
        type="button"
        className="btn-primary btn-full"
        onClick={handleOpenPaymentModal}
        disabled={isSaving || cart.length === 0}
      >
        {isSaving ? "Guardando venta..." : "Guardar venta"}
      </button>

      {showPaymentModal && (
        <div className="modal-overlay" onClick={() => setShowPaymentModal(false)}>
          <div className="modal modal-compact" onClick={(e) => e.stopPropagation()}>
            <h3>Guardar venta</h3>
            <p>
              Total: <strong>C${Number(total || 0).toFixed(2)}</strong>
            </p>
            <p>Metodo de pago: {paymentMethod === "cash" ? "Efectivo" : paymentMethod}</p>
            {paymentMethod === "cash" && (
              <>
                <div className="input-group">
                  <label>Pago del cliente (C$)</label>
                  <input
                    ref={cashInputRef}
                    className="input-modern"
                    type="number"
                    value={receivedCash}
                    onChange={(e) => setReceivedCash(e.target.value)}
                    placeholder="0"
                  />
                </div>
                <p>
                  Cambio:{" "}
                  <strong style={{ color: changeAmount < 0 ? "#dc2626" : "#16a34a" }}>
                    C${changeAmount.toFixed(2)}
                  </strong>
                </p>
              </>
            )}
            <div className="modal-buttons">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowPaymentModal(false)}
                disabled={isSaving}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={handleSaveSale}
                disabled={isSaving}
              >
                {isSaving ? "Guardando..." : "Confirmar venta"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default PosPage;
