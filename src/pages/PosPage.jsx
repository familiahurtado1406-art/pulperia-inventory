import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  doc,
  increment,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { db } from "../firebase/config";
import useOverlayBack from "../hooks/useOverlayBack";
import useNetworkStatus from "../hooks/useNetworkStatus";
import { getStockBaseValue, registerInventoryChange } from "../services/inventoryHistoryService";
import { readLocalCache, writeLocalCache } from "../services/localCacheService";
import { syncProductMetrics } from "../services/productMetricsService";
import { fetchActiveProducts, subscribeActiveProducts } from "../services/realtimeFirestoreService";
import { userCollection, userDoc } from "../services/userScopedFirestore";

const POS_PRODUCTS_CACHE_KEY = "pos_products_active";
const POS_PRODUCTS_CACHE_TTL = 3 * 60 * 1000;
const QUICK_CASH_AMOUNTS = [1000, 500, 200, 100, 50, 20, 10, 5, 1];
const MAX_ACTIVE_CARTS = 5;

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

const formatCurrency = (value) => `C$ ${Number(value || 0).toFixed(2)}`;

const formatQuarterValue = (numericValue) => {
  const safeValue = Number(numericValue || 0);
  const entero = Math.floor(safeValue);
  const remainder = Number((safeValue - entero).toFixed(2));

  if (Math.abs(remainder) < 0.001) return `${entero}`;
  if (Math.abs(remainder - 0.25) < 0.001) return entero > 0 ? `${entero} 1/4` : "1/4";
  if (Math.abs(remainder - 0.5) < 0.001) return entero > 0 ? `${entero} 1/2` : "1/2";
  if (Math.abs(remainder - 0.75) < 0.001) return entero > 0 ? `${entero} 3/4` : "3/4";
  return `${safeValue}`.replace(/\.0$/, "");
};

const formatPresetLabel = (value, measure = "UN") => {
  const numericValue = Number(value || 0);
  if (["LB", "LT"].includes(measure)) {
    if (numericValue === 0.25) return "Un cuarto";
    if (numericValue === 0.5) return "Media";
  }
  return formatQuantityLabel(value, measure);
};

const formatQuantityLabel = (value, measure = "UN") => {
  const numericValue = Number(value || 0);
  if (measure === "LB") {
    if (numericValue === 0.25) return "Un cuarto";
    if (numericValue === 0.5) return "Media";
    if (numericValue === 1) return "1";
    if (numericValue === 2) return "2";
    if (numericValue === 4) return "4";
  }
  if (measure === "LT") {
    return formatQuarterValue(numericValue);
  }
  return `${numericValue}`.replace(/\.0$/, "");
};

const getQuantityStep = (measure = "UN") => {
  if (["LB", "LT", "YARDA"].includes(measure)) {
    return 0.25;
  }
  return 1;
};

const createCartId = () => `cart_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const createEmptyCart = (index = 1) => ({
  id: createCartId(),
  label: `C${index}`,
  items: [],
});

function PosPage() {
  const searchInputRef = useRef(null);
  const cashInputRef = useRef(null);
  const isOnline = useNetworkStatus();
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState("");
  const [carts, setCarts] = useState([createEmptyCart(1)]);
  const [activeCartId, setActiveCartId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [showQuantityModal, setShowQuantityModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedVariant, setSelectedVariant] = useState(null);
  const [quantityValue, setQuantityValue] = useState(0.5);
  const [receivedCash, setReceivedCash] = useState("");
  const [emitTicket, setEmitTicket] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isRefreshingProducts, setIsRefreshingProducts] = useState(false);
  const closeSearchOverlay = useOverlayBack(showSearchModal, () => setShowSearchModal(false), "pos-search");
  const closeQuantityOverlay = useOverlayBack(
    showQuantityModal,
    () => {
      setShowQuantityModal(false);
      setSelectedProduct(null);
      setSelectedVariant(null);
    },
    "pos-quantity"
  );
  const closePaymentOverlay = useOverlayBack(showPaymentModal, () => setShowPaymentModal(false), "pos-payment");

  useEffect(() => {
    if (!activeCartId && carts.length > 0) {
      setActiveCartId(carts[0].id);
    }
  }, [activeCartId, carts]);

  useEffect(() => {
    const cachedProducts = readLocalCache(POS_PRODUCTS_CACHE_KEY, POS_PRODUCTS_CACHE_TTL);
    if (Array.isArray(cachedProducts) && cachedProducts.length > 0) {
      setProducts(cachedProducts);
    }

    const unsubscribe = subscribeActiveProducts((loadedProducts) => {
      setProducts(loadedProducts);
      writeLocalCache(POS_PRODUCTS_CACHE_KEY, loadedProducts);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!showSearchModal) return;
    setTimeout(() => {
      if (searchInputRef.current) searchInputRef.current.focus();
    }, 0);
  }, [showSearchModal]);

  const handleRefreshProducts = async () => {
    if (!isOnline) {
      toast("Sin conexion. Usando productos guardados localmente.");
      return;
    }
    setIsRefreshingProducts(true);
    try {
      const loadedProducts = await fetchActiveProducts();
      setProducts(loadedProducts);
      writeLocalCache(POS_PRODUCTS_CACHE_KEY, loadedProducts);
      toast.success("Productos actualizados");
    } catch (error) {
      console.error(error);
      toast.error("No se pudieron actualizar productos");
    } finally {
      setIsRefreshingProducts(false);
    }
  };

  const visibleProducts = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return [];
    return products
      .filter((product) => String(product.nombre || "").toLowerCase().includes(term))
      .slice(0, 6);
  }, [products, search]);

  const activeCart = useMemo(
    () => carts.find((cart) => cart.id === activeCartId) || carts[0] || createEmptyCart(1),
    [activeCartId, carts]
  );
  const activeCartItems = useMemo(() => activeCart?.items || [], [activeCart]);

  const total = useMemo(() => {
    return Number(
      activeCartItems.reduce((acc, item) => acc + Number(item.price || 0) * Number(item.qty || 0), 0).toFixed(2)
    );
  }, [activeCartItems]);
  const cartItemsCount = useMemo(
    () => activeCartItems.reduce((acc, item) => acc + Number(item.qty || 0), 0),
    [activeCartItems]
  );
  const changeAmount = useMemo(() => {
    if (paymentMethod !== "cash") return 0;
    const cash = Number(receivedCash || 0);
    return Number((cash - Number(total || 0)).toFixed(2));
  }, [paymentMethod, receivedCash, total]);

  const selectedMeasure = selectedProduct?.medidaBase || "UN";
  const selectedUnitPrice = Number(
    selectedVariant?.price ??
      selectedProduct?.precioVentaBase ??
      selectedProduct?.precioVenta ??
      0
  );
  const quantitySubtotal = Number((selectedUnitPrice * Number(quantityValue || 0)).toFixed(2));

  useEffect(() => {
    if (!showPaymentModal || paymentMethod !== "cash") return;
    if (cashInputRef.current) cashInputRef.current.focus();
  }, [showPaymentModal, paymentMethod]);

  const closeSearchModal = () => {
    closeSearchOverlay();
    setSearch("");
  };

  const addToCart = (product, variant, qtyOverride = 1) => {
    const qty = Number(qtyOverride || 0);
    if (qty <= 0) return;
    const key = `${product.id}__${variant.id || variant.name}`;
    setCarts((prev) =>
      prev.map((cart) => {
        if (cart.id !== activeCartId) return cart;
        const existingIndex = cart.items.findIndex((item) => item.key === key);
        if (existingIndex >= 0) {
          return {
            ...cart,
            items: cart.items.map((item, index) =>
              index === existingIndex ? { ...item, qty: Number(item.qty || 0) + qty } : item
            ),
          };
        }
        return {
          ...cart,
          items: [
            ...cart.items,
            {
              key,
              productId: product.id,
              productoId: product.productoId || product.id,
              name: product.nombre || product.id,
              variantId: variant.id || "",
              variantName: variant.name || product.medidaBase || "UN",
              unitsBase: Number(variant.units || 1),
              price: Number(variant.price || 0),
              qty,
              medidaBase: product.medidaBase || "UN",
            },
          ],
        };
      })
    );
    setSearch("");
    closeSearchOverlay();
    toast.success("Producto agregado");
  };

  const openQuantityModal = (product, variant = null) => {
    setSelectedProduct(product);
    setSelectedVariant(variant || getDefaultVariant(product));
    setQuantityValue(product.medidaBase === "LB" ? 0.5 : 1);
    setShowQuantityModal(true);
  };

  const handleSelectProduct = (product, variant = null) => {
    const defaultVariant = variant || getDefaultVariant(product);
    openQuantityModal(product, defaultVariant);
  };

  const handleConfirmVariableQuantity = () => {
    if (!selectedProduct || !selectedVariant) return;
    addToCart(selectedProduct, selectedVariant, quantityValue);
    closeQuantityOverlay();
  };

  const updateQty = (key, nextQty) => {
    setCarts((prev) =>
      prev.map((cart) =>
        cart.id !== activeCartId
          ? cart
          : {
              ...cart,
              items: cart.items
                .map((item) =>
                  item.key === key ? { ...item, qty: Math.max(0, Number(nextQty || 0)) } : item
                )
                .filter((item) => Number(item.qty || 0) > 0),
            }
      )
    );
  };

  const updatePrice = (key, nextPrice) => {
    setCarts((prev) =>
      prev.map((cart) =>
        cart.id !== activeCartId
          ? cart
          : {
              ...cart,
              items: cart.items.map((item) =>
                item.key === key ? { ...item, price: Math.max(0, Number(nextPrice || 0)) } : item
              ),
            }
      )
    );
  };

  const removeItem = (key) => {
    setCarts((prev) =>
      prev.map((cart) =>
        cart.id !== activeCartId
          ? cart
          : {
              ...cart,
              items: cart.items.filter((item) => item.key !== key),
            }
      )
    );
  };

  const handleCreateCart = () => {
    if (carts.length >= MAX_ACTIVE_CARTS) {
      toast("Maximo 5 carritos activos");
      return;
    }
    const newCart = createEmptyCart(carts.length + 1);
    setCarts((prev) => [...prev, newCart]);
    setActiveCartId(newCart.id);
  };

  const clearActiveCart = () => {
    setCarts((prev) =>
      prev.map((cart) =>
        cart.id === activeCartId
          ? {
              ...cart,
              items: [],
            }
          : cart
      )
    );
  };

  const handleSaveSale = async () => {
    if (activeCartItems.length === 0) {
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

    for (const line of activeCartItems) {
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
      const saleItems = activeCartItems.map((line) => {
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
        cartId: activeCart.id,
        cartLabel: activeCart.label,
        receivedCash: paymentMethod === "cash" ? Number(receivedCash || 0) : null,
        change: paymentMethod === "cash" ? changeAmount : null,
        emitTicket,
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
        cartId: activeCart.id,
        cartLabel: activeCart.label,
        paymentMethod,
        total: totalSale,
        items: movementItems,
      });
      await batch.commit();

      const productIdsToSync = [...new Set(saleItems.map((item) => String(item.productId || "")).filter(Boolean))];
      Promise.allSettled([
        ...historyTasks,
        syncProductMetrics({ productIds: productIdsToSync }),
      ]).then((historyResults) => {
        const hasHistoryErrors = historyResults.some((result) => result.status === "rejected");
        if (hasHistoryErrors) {
          console.error("Errores en historial de cambios de POS", { historyResults });
        }
      });

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
      clearActiveCart();
      setReceivedCash("");
      closePaymentOverlay();
      toast.success(
        isOnline
          ? "Venta guardada correctamente"
          : "Venta guardada offline. Se sincronizara cuando vuelva internet"
      );
    } catch (error) {
      console.error(error);
      toast.error("Error guardando venta");
    } finally {
      setIsSaving(false);
    }
  };

  const handleOpenPaymentModal = () => {
    if (activeCartItems.length === 0) {
      toast.error("El carrito esta vacio");
      return;
    }
    setShowPaymentModal(true);
  };

  return (
    <div
      className="section-card"
      style={{
        minHeight: "calc(100vh - 120px)",
        background: "linear-gradient(180deg, #f8fbff 0%, #f3f6fb 100%)",
        paddingBottom: "140px",
        position: "relative",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "20px",
        }}
        >
        <div>
          <h3 className="section-title" style={{ marginBottom: "4px" }}>
            Caja
          </h3>
          <p style={{ margin: 0, color: "#6b7280" }}>Venta rapida para mostrador</p>
        </div>
        <button
          type="button"
          className="btn-secondary"
          onClick={handleRefreshProducts}
          disabled={isRefreshingProducts}
        >
          {isRefreshingProducts ? "..." : "Refresh"}
        </button>
      </div>

      {!isOnline && (
        <div
          style={{
            background: "#fff7ed",
            border: "1px solid #fed7aa",
            borderRadius: "18px",
            color: "#9a3412",
            marginBottom: "18px",
            padding: "12px 14px",
          }}
        >
          <strong>Modo sin conexion.</strong> Puedes seguir vendiendo. Los cambios se sincronizaran
          cuando vuelva internet.
        </div>
      )}

      <div
        style={{
          display: "flex",
          gap: "10px",
          overflowX: "auto",
          paddingBottom: "8px",
          marginBottom: "18px",
        }}
      >
        {carts.map((cart) => {
          const isActive = cart.id === activeCartId;
          const itemCount = cart.items.reduce((acc, item) => acc + Number(item.qty || 0), 0);
          return (
            <button
              key={cart.id}
              type="button"
              onClick={() => setActiveCartId(cart.id)}
              style={{
                border: isActive ? "1px solid #2563eb" : "1px solid #dbe3ef",
                background: isActive ? "#eaf2ff" : "#fff",
                color: isActive ? "#1d4ed8" : "#334155",
                borderRadius: "16px",
                minWidth: "88px",
                padding: "10px 14px",
                textAlign: "left",
                boxShadow: isActive ? "0 8px 20px rgba(37, 99, 235, 0.12)" : "none",
              }}
            >
              <div style={{ fontWeight: 700 }}>{cart.label}</div>
              <div style={{ fontSize: "12px", opacity: 0.8 }}>{itemCount} prod.</div>
            </button>
          );
        })}
        <button
          type="button"
          onClick={handleCreateCart}
          style={{
            border: "1px dashed #93c5fd",
            background: "#f8fbff",
            color: "#2563eb",
            borderRadius: "16px",
            minWidth: "56px",
            padding: "10px 14px",
            fontSize: "22px",
            fontWeight: 700,
          }}
        >
          +
        </button>
      </div>

      <div style={{ display: "grid", gap: "16px" }}>
        <button
          type="button"
          onClick={() => toast("Escaner pendiente de integrar")}
          style={{
            border: "none",
            borderRadius: "24px",
            padding: "28px 24px",
            background: "linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)",
            color: "#fff",
            textAlign: "center",
            boxShadow: "0 18px 30px rgba(37, 99, 235, 0.22)",
          }}
        >
          <div style={{ fontSize: "34px", marginBottom: "10px" }}>[ ]</div>
          <div style={{ fontSize: "18px", fontWeight: 700, marginBottom: "6px" }}>
            Escanear para cobrar
          </div>
          <div style={{ opacity: 0.92 }}>Apunta al codigo y se agrega al carrito</div>
        </button>

        <button
          type="button"
          onClick={() => setShowSearchModal(true)}
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: "24px",
            padding: "28px 24px",
            background: "#fff",
            textAlign: "center",
            boxShadow: "0 16px 30px rgba(15, 23, 42, 0.08)",
          }}
        >
          <div style={{ fontSize: "36px", color: "#2563eb", marginBottom: "10px" }}>Q</div>
          <div style={{ fontSize: "18px", fontWeight: 700, color: "#111827", marginBottom: "6px" }}>
            Buscar producto
          </div>
          <div style={{ color: "#6b7280" }}>Escribe y toca para agregar</div>
        </button>
      </div>

      {activeCartItems.length > 0 && (
        <div style={{ marginTop: "24px", display: "grid", gap: "12px" }}>
          {activeCartItems.map((item) => {
            const subtotal = Number((Number(item.price || 0) * Number(item.qty || 0)).toFixed(2));
            return (
              <div
                key={item.key}
                style={{
                  background: "#fff",
                  borderRadius: "20px",
                  padding: "16px",
                  boxShadow: "0 12px 25px rgba(15, 23, 42, 0.08)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "12px",
                    marginBottom: "12px",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700, color: "#111827" }}>{item.name}</div>
                    <div style={{ color: "#6b7280", fontSize: "14px" }}>
                      {item.variantName} | {Number(item.unitsBase || 0)} {item.medidaBase || "UN"}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeItem(item.key)}
                    style={{
                      border: "none",
                      background: "#f3f4f6",
                      color: "#6b7280",
                      width: "36px",
                      height: "36px",
                      borderRadius: "18px",
                      fontWeight: 700,
                    }}
                  >
                    X
                  </button>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "auto 1fr auto",
                    gap: "12px",
                    alignItems: "center",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() =>
                        updateQty(item.key, Number(item.qty || 0) - getQuantityStep(item.medidaBase))
                      }
                    >
                      -
                    </button>
                    <input
                      className="input-modern"
                      type="number"
                      min="0"
                      step={getQuantityStep(item.medidaBase)}
                      inputMode="decimal"
                      pattern="[0-9]*[.,]?[0-9]*"
                      value={Number(item.qty || 0)}
                      onChange={(e) => updateQty(item.key, e.target.value)}
                      onFocus={(e) => e.target.select()}
                      onClick={(e) => e.target.select()}
                      style={{ width: "84px", textAlign: "center", minWidth: "84px" }}
                    />
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() =>
                        updateQty(item.key, Number(item.qty || 0) + getQuantityStep(item.medidaBase))
                      }
                    >
                      +
                    </button>
                  </div>

                  <input
                    className="input-modern"
                    type="number"
                    value={Number(item.price || 0)}
                    onChange={(e) => updatePrice(item.key, e.target.value)}
                    style={{ minWidth: 0 }}
                  />

                  <strong style={{ color: "#111827" }}>{formatCurrency(subtotal)}</strong>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          background: "#fff",
          borderTop: "1px solid #e5e7eb",
          boxShadow: "0 -10px 30px rgba(15, 23, 42, 0.08)",
          padding: "16px",
          zIndex: 20,
        }}
      >
        <div
          style={{
            maxWidth: "720px",
            margin: "0 auto",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "16px",
          }}
        >
          <div>
            <div style={{ color: "#6b7280", marginBottom: "4px" }}>
              {activeCartItems.length > 0
                ? `${cartItemsCount} productos en el carrito`
                : `Carrito ${activeCart.label} vacio. Escanea o selecciona productos.`}
            </div>
            <div style={{ fontSize: "18px", fontWeight: 800, color: "#111827" }}>
              Total: {formatCurrency(total)}
            </div>
          </div>

          <button
            type="button"
            className="btn-primary"
            onClick={handleOpenPaymentModal}
            disabled={isSaving || activeCartItems.length === 0}
            style={{
              minWidth: "180px",
              minHeight: "56px",
              borderRadius: "18px",
              fontWeight: 800,
              fontSize: "18px",
            }}
          >
            {isSaving ? "Guardando..." : "COBRAR"}
          </button>
        </div>
      </div>

      {showSearchModal && (
        <div className="modal-overlay" onClick={closeSearchModal}>
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "540px", borderRadius: "28px", padding: "24px" }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "18px",
              }}
            >
              <h3 style={{ margin: 0 }}>Buscar producto</h3>
              <button
                type="button"
                onClick={closeSearchModal}
                style={{
                  border: "none",
                  background: "#f3f4f6",
                  color: "#111827",
                  width: "44px",
                  height: "44px",
                  borderRadius: "22px",
                  fontSize: "20px",
                }}
              >
                X
              </button>
            </div>

            <div style={{ position: "relative", marginBottom: "20px" }}>
              <span
                style={{
                  position: "absolute",
                  left: "14px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "#9ca3af",
                }}
              >
                Q
              </span>
              <input
                ref={searchInputRef}
                className="input-modern"
                placeholder="Escribe para buscar..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ paddingLeft: "38px" }}
              />
            </div>

            {search.trim() === "" ? (
              <p style={{ color: "#6b7280", margin: 0 }}>Escribe para ver productos.</p>
            ) : (
              <>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                    gap: "12px",
                  }}
                >
                  {visibleProducts.map((product) => (
                    <button
                      key={product.id}
                      type="button"
                      onClick={() => handleSelectProduct(product)}
                      style={{
                        border: "1px solid #e5e7eb",
                        borderRadius: "18px",
                        background: "#fff",
                        padding: "16px",
                        textAlign: "left",
                        boxShadow: "0 8px 18px rgba(15, 23, 42, 0.06)",
                      }}
                    >
                      <div style={{ fontWeight: 700, color: "#111827", marginBottom: "18px" }}>
                        {product.nombre}
                      </div>
                      <div style={{ fontSize: "20px", color: "#2563eb", fontWeight: 800 }}>
                        {formatCurrency(product.precioVentaBase ?? product.precioVenta ?? 0)}
                      </div>
                      {getProductVariants(product).length > 1 && (
                        <div style={{ marginTop: "10px", color: "#6b7280", fontSize: "12px" }}>
                          {getProductVariants(product).length} presentaciones
                        </div>
                      )}
                    </button>
                  ))}
                </div>

                {visibleProducts.length === 0 && (
                  <p style={{ color: "#6b7280", marginTop: "10px" }}>No se encontraron productos.</p>
                )}

                <p style={{ textAlign: "center", color: "#6b7280", margin: "16px 0 0" }}>
                  Mostrando hasta 6 productos.
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {showQuantityModal && selectedProduct && (
        <div
          className="modal-overlay"
          onClick={() => {
            closeQuantityOverlay();
          }}
        >
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "560px", borderRadius: "28px", padding: "24px" }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "18px",
              }}
            >
              <h3 style={{ margin: 0 }}>Agregar cantidad</h3>
              <button
                type="button"
                onClick={() => {
                  closeQuantityOverlay();
                }}
                style={{
                  border: "none",
                  background: "#f3f4f6",
                  color: "#111827",
                  width: "44px",
                  height: "44px",
                  borderRadius: "22px",
                  fontSize: "20px",
                }}
              >
                X
              </button>
            </div>

            <div style={{ fontWeight: 800, fontSize: "18px", color: "#111827" }}>
              {selectedProduct.nombre}
            </div>
            <div style={{ color: "#6b7280", margin: "6px 0 20px" }}>
              {formatCurrency(selectedUnitPrice)} por {(selectedProduct.medidaBase || "UN").toLowerCase()}
            </div>

            <div className="input-group">
              <label>Cantidad ({(selectedProduct.medidaBase || "UN").toLowerCase()})</label>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "56px 1fr 56px",
                  gap: "12px",
                  alignItems: "center",
                  background: "#fff",
                  border: "1px solid #e5e7eb",
                  borderRadius: "18px",
                  padding: "14px",
                }}
              >
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() =>
                    setQuantityValue((prev) =>
                      Math.max(0.25, Number((Number(prev || 0) - 0.25).toFixed(2)))
                    )
                  }
                >
                  -
                </button>
                <div style={{ textAlign: "center" }}>
                  <input
                    className="input-modern"
                    type="number"
                    min={selectedMeasure === "LB" ? "0.25" : "1"}
                    step={selectedMeasure === "LB" ? "0.25" : "1"}
                    inputMode="decimal"
                    pattern="[0-9]*[.,]?[0-9]*"
                    value={quantityValue}
                    onChange={(e) => setQuantityValue(e.target.value)}
                    onFocus={(e) => e.target.select()}
                    onClick={(e) => e.target.select()}
                    style={{
                      fontSize: "22px",
                      fontWeight: 800,
                      minWidth: "110px",
                      textAlign: "center",
                    }}
                  />
                  <div style={{ color: "#6b7280", marginTop: "6px" }}>
                    {selectedMeasure.toLowerCase()}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setQuantityValue((prev) => Number((Number(prev || 0) + 0.25).toFixed(2)))}
                >
                  +
                </button>
              </div>
            </div>

            {["LB", "LT"].includes(selectedMeasure) && (
              <>
                <p style={{ color: "#6b7280", marginTop: "0" }}>Minimo granel: Un cuarto</p>
                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "16px" }}>
                  {[0.25, 0.5, 1, 2, 4].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      className="btn-secondary"
                      onClick={() => setQuantityValue(preset)}
                      style={{
                        background: Number(quantityValue || 0) === preset ? "#e8efff" : undefined,
                        color: Number(quantityValue || 0) === preset ? "#1d4ed8" : undefined,
                      }}
                    >
                      {formatPresetLabel(preset, selectedMeasure)}
                    </button>
                  ))}
                </div>
              </>
            )}

            <div
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: "18px",
                padding: "16px",
                background: "#fff",
                marginBottom: "18px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: "10px",
                  color: "#6b7280",
                }}
              >
                <span>Cantidad</span>
                <strong style={{ color: "#111827" }}>
                  {formatQuantityLabel(quantityValue, selectedMeasure)} {selectedMeasure}
                </strong>
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  color: "#6b7280",
                }}
              >
                <span>Subtotal</span>
                <strong style={{ color: "#111827" }}>{formatCurrency(quantitySubtotal)}</strong>
              </div>
            </div>

            <div className="modal-buttons">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  closeQuantityOverlay();
                }}
              >
                Cancelar
              </button>
              <button type="button" className="btn-primary" onClick={handleConfirmVariableQuantity}>
                Agregar
              </button>
            </div>
          </div>
        </div>
      )}

      {showPaymentModal && (
        <div className="modal-overlay" onClick={closePaymentOverlay}>
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "620px", borderRadius: "28px", padding: "24px" }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "16px",
              }}
            >
              <h3 style={{ margin: 0 }}>Confirmar Venta</h3>
              <button
                type="button"
                onClick={closePaymentOverlay}
                style={{
                  border: "none",
                  background: "#f3f4f6",
                  color: "#111827",
                  width: "44px",
                  height: "44px",
                  borderRadius: "22px",
                  fontSize: "20px",
                }}
              >
                X
              </button>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "16px",
                color: "#6b7280",
              }}
            >
              <span>{cartItemsCount} productos en el carrito</span>
              <button type="button" className="btn-secondary" onClick={closePaymentOverlay}>
                Ver articulos
              </button>
            </div>

            <div
              style={{
                background: "#f8fafc",
                borderRadius: "22px",
                padding: "20px",
                marginBottom: "18px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "16px",
                }}
              >
                <span style={{ fontSize: "18px", fontWeight: 800, color: "#2563eb" }}>
                  Total a Pagar
                </span>
                <span style={{ fontSize: "18px", fontWeight: 800, color: "#2563eb" }}>
                  {formatCurrency(total)}
                </span>
              </div>

              {paymentMethod === "cash" && (
                <>
                  <input
                    ref={cashInputRef}
                    className="input-modern"
                    type="number"
                    placeholder="Pago recibido"
                    value={receivedCash}
                    onChange={(e) => setReceivedCash(e.target.value)}
                    style={{ marginBottom: "12px" }}
                  />

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginBottom: "16px",
                      color: "#6b7280",
                    }}
                  >
                    <span>Cambio</span>
                    <strong style={{ color: changeAmount < 0 ? "#dc2626" : "#16a34a" }}>
                      {formatCurrency(changeAmount)}
                    </strong>
                  </div>

                  <div
                    style={{
                      background: "#fff",
                      border: "1px solid #e5e7eb",
                      borderRadius: "18px",
                      padding: "16px",
                      marginBottom: "16px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: "14px",
                      }}
                    >
                      <strong style={{ color: "#6b7280" }}>Montos rapidos (Nicaragua)</strong>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => setReceivedCash(String(total))}
                        style={{ minWidth: "90px" }}
                      >
                        Exacto
                      </button>
                    </div>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(3, 1fr)",
                        gap: "10px",
                      }}
                    >
                      {QUICK_CASH_AMOUNTS.map((amount) => (
                        <button
                          key={amount}
                          type="button"
                          className="btn-secondary"
                          onClick={() => {
                            const current = Number(receivedCash || 0);
                            setReceivedCash(String(Number((current + amount).toFixed(2))));
                          }}
                        >
                          +{formatCurrency(amount)}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              <div
                style={{
                  background: "#fff",
                  border: "1px solid #e5e7eb",
                  borderRadius: "18px",
                  padding: "16px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "12px",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700, color: "#111827", marginBottom: "4px" }}>
                      Emitir ticket en esta venta
                    </div>
                    <div style={{ color: "#6b7280", fontSize: "14px" }}>
                      Tipo configurado: PDF
                    </div>
                    {emitTicket && (
                      <div style={{ color: "#6b7280", fontSize: "14px", marginTop: "6px" }}>
                        Se generara ticket PDF para compartir o imprimir.
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => setEmitTicket((prev) => !prev)}
                    style={{
                      border: "none",
                      width: "84px",
                      height: "44px",
                      borderRadius: "22px",
                      background: emitTicket ? "#2563eb" : "#d1d5db",
                      position: "relative",
                    }}
                  >
                    <span
                      style={{
                        position: "absolute",
                        top: "4px",
                        left: emitTicket ? "44px" : "4px",
                        width: "36px",
                        height: "36px",
                        borderRadius: "18px",
                        background: "#fff",
                      }}
                    />
                  </button>
                </div>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", marginBottom: "18px" }}>
              <button
                type="button"
                onClick={() => setPaymentMethod("cash")}
                style={{
                  border: paymentMethod === "cash" ? "2px solid #3b82f6" : "1px solid #e5e7eb",
                  background: paymentMethod === "cash" ? "#eff6ff" : "#fff",
                  borderRadius: "20px",
                  padding: "18px",
                  fontWeight: 800,
                  color: paymentMethod === "cash" ? "#2563eb" : "#4b5563",
                }}
              >
                Contado
              </button>
              <button
                type="button"
                onClick={() => setPaymentMethod("credit")}
                style={{
                  border: paymentMethod === "credit" ? "2px solid #3b82f6" : "1px solid #e5e7eb",
                  background: paymentMethod === "credit" ? "#eff6ff" : "#fff",
                  borderRadius: "20px",
                  padding: "18px",
                  fontWeight: 800,
                  color: paymentMethod === "credit" ? "#2563eb" : "#4b5563",
                }}
              >
                Fiado
              </button>
            </div>

            <button
              type="button"
              className="btn-primary btn-full"
              onClick={handleSaveSale}
              disabled={isSaving}
              style={{ minHeight: "58px", borderRadius: "18px", fontSize: "18px", fontWeight: 800 }}
            >
              {isSaving ? "Guardando..." : "CONFIRMAR VENTA"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default PosPage;
