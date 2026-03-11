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
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState([]);
  const [paymentMethod, setPaymentMethod] = useState("cash");
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
    if (!term) return products.slice(0, 20);
    return products
      .filter((product) => String(product.nombre || "").toLowerCase().includes(term))
      .slice(0, 20);
  }, [products, search]);

  const total = useMemo(
    () =>
      cart.reduce((acc, item) => acc + Number(item.price || 0) * Number(item.qty || 0), 0),
    [cart]
  );

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
  };

  const updateQty = (key, nextQty) => {
    setCart((prev) =>
      prev
        .map((item) => (item.key === key ? { ...item, qty: Math.max(0, Number(nextQty || 0)) } : item))
        .filter((item) => Number(item.qty || 0) > 0)
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

      const saleRef = await addDoc(userCollection("sales"), {
        date: serverTimestamp(),
        total: totalSale,
        paymentMethod,
        items: saleItems,
      });

      const movementItems = [];
      for (const item of saleItems) {
        const product = productById[item.productId];
        const stockAnterior = Number(getStockBaseValue(product) || 0);
        const stockNuevo = Number((stockAnterior - Number(item.unidades || 0)).toFixed(4));

        await updateDoc(userDoc("products", item.productId), {
          stockBase: increment(-Number(item.unidades || 0)),
          stockActual: increment(-Number(item.unidades || 0)),
          ultimaActualizacion: serverTimestamp(),
        });

        await registerInventoryChange({
          product,
          tipoMovimiento: "venta_pos",
          stockAnterior,
          stockNuevo,
          referenciaId: saleRef.id,
        });

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
      }

      await addDoc(userCollection("movimientos"), {
        type: "salida",
        createdAt: serverTimestamp(),
        saleId: saleRef.id,
        paymentMethod,
        total: totalSale,
        items: movementItems,
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
      setCart([]);
      toast.success("Venta guardada correctamente");
    } catch (error) {
      console.error(error);
      toast.error("Error guardando venta");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="section-card">
      <h3 className="section-title">POS</h3>
      <div className="row">
        <input
          className="input-modern buscador"
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

      <div className="pedido-list">
        {visibleProducts.map((product) => (
          <div key={product.id} className="pedido-card">
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
                onClick={() => addToCart(product, getDefaultVariant(product))}
              >
                + Agregar
              </button>
            </div>
            <div className="pedido-quick-actions">
              {getProductVariants(product).map((variant, index) => (
                <button
                  key={`${product.id}-${variant.id || variant.name || index}`}
                  type="button"
                  className="btn-secondary"
                  onClick={() => addToCart(product, variant)}
                >
                  {variant.name} - C${Number(variant.price || 0).toFixed(2)}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="spacer" />
      <h3 className="section-title">Carrito</h3>
      {cart.length === 0 ? (
        <p>No hay productos en el carrito.</p>
      ) : (
        <div className="table-scroll">
          <table className="table-modern">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Presentacion</th>
                <th>Cantidad</th>
                <th>Precio</th>
                <th>Subtotal</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {cart.map((item) => {
                const subtotal = Number(item.price || 0) * Number(item.qty || 0);
                return (
                  <tr key={item.key}>
                    <td>{item.name}</td>
                    <td>
                      {item.variantName} ({Number(item.unitsBase || 0)} {item.medidaBase || "UN"})
                    </td>
                    <td>{item.qty}</td>
                    <td>C${Number(item.price || 0).toFixed(2)}</td>
                    <td>C${subtotal.toFixed(2)}</td>
                    <td>
                      <div style={{ display: "flex", gap: "8px" }}>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => updateQty(item.key, Number(item.qty || 0) - 1)}
                        >
                          -1
                        </button>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => updateQty(item.key, Number(item.qty || 0) + 1)}
                        >
                          +1
                        </button>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => removeItem(item.key)}
                        >
                          Eliminar
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
        onClick={handleSaveSale}
        disabled={isSaving || cart.length === 0}
      >
        {isSaving ? "Guardando venta..." : "Guardar venta"}
      </button>
    </div>
  );
}

export default PosPage;
