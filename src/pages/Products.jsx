import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { useNavigate } from "react-router-dom";
import {
  addDoc,
  deleteDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import AppLayout from "../components/AppLayout";
import ProductCard from "../components/ProductCard";
import SeccionDistribuidores from "../components/SeccionDistribuidores";
import SkeletonCard from "../components/SkeletonCard";
import { upsertProviderProductLink } from "../services/providerProductService";
import { userCollection, userDoc } from "../services/userScopedFirestore";
import {
  FaBalanceScale,
  FaBoxOpen,
  FaQuestionCircle,
  FaWarehouse,
} from "react-icons/fa";

function Products() {
  const navigate = useNavigate();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  const [nombre, setNombre] = useState("");
  const [medidaBase, setMedidaBase] = useState("UN");
  const [medidaInterna, setMedidaInterna] = useState("PACK");
  const [unidadesPorInterna, setUnidadesPorInterna] = useState("");
  const [stockBase, setStockBase] = useState("");
  const [stockMin, setStockMin] = useState("");
  const [stockObjetivo, setStockObjetivo] = useState("");
  const [tipoRotacion, setTipoRotacion] = useState("media");
  const [codigoBarras, setCodigoBarras] = useState("");
  const [activo, setActivo] = useState(true);

  const [costoUnitario, setCostoUnitario] = useState("");
  const [costoPack, setCostoPack] = useState("");
  const [margen, setMargen] = useState("20");
  const [precioVentaManual, setPrecioVentaManual] = useState("");

  const [editingProduct, setEditingProduct] = useState(null);
  const [openForm, setOpenForm] = useState(false);
  const [listSearch, setListSearch] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [providersTemp, setProvidersTemp] = useState([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeletingId, setIsDeletingId] = useState("");

  const precioVentaCalculado = useMemo(() => {
    const costo = Number(costoUnitario);
    const margenNum = Number(margen);
    if (costo <= 0) return 0;
    return Number((costo * (1 + margenNum / 100)).toFixed(2));
  }, [costoUnitario, margen]);

  const precioVenta =
    precioVentaManual === "" ? precioVentaCalculado : Number(precioVentaManual);

  const fetchProducts = async () => {
    const snapshot = await getDocs(userCollection("products"));
    setProducts(
      snapshot.docs.map((docItem) => ({
        id: docItem.id,
        ...docItem.data(),
      }))
    );
  };

  useEffect(() => {
    const initProducts = async () => {
      setLoading(true);
      try {
        await fetchProducts();
      } finally {
        setLoading(false);
      }
    };
    initProducts();
  }, []);

  useEffect(() => {
    if (searchTerm.trim().length < 2) return;

    const q = query(
      userCollection("products"),
      where("nombre", ">=", searchTerm),
      where("nombre", "<=", `${searchTerm}\uf8ff`)
    );

    const fetchSuggestions = async () => {
      const snapshot = await getDocs(q);
      setSuggestions(
        snapshot.docs.map((docItem) => ({
          id: docItem.id,
          ...docItem.data(),
        }))
      );
    };
    fetchSuggestions();
  }, [searchTerm]);

  const visibleSuggestions = useMemo(
    () => (searchTerm.trim().length < 2 ? [] : suggestions),
    [searchTerm, suggestions]
  );
  const visibleProducts = useMemo(() => {
    if (!listSearch.trim()) return products;
    const term = listSearch.trim().toLowerCase();
    return products.filter((p) => (p.nombre || "").toLowerCase().includes(term));
  }, [products, listSearch]);

  const generateProductId = (name, existingProducts) => {
    const clean = (name || "").trim();
    const prefix = clean.slice(0, 3).toUpperCase().padEnd(3, "X");
    const count = existingProducts.length + 1;
    return `${prefix}${String(count).padStart(4, "0")}`;
  };

  const handlePrecioVentaChange = (value) => {
    setPrecioVentaManual(value);

    if (Number(costoUnitario) > 0 && value !== "") {
      const priceNum = Number(value);
      const newMargen = ((priceNum - Number(costoUnitario)) / Number(costoUnitario)) * 100;
      setMargen(newMargen.toFixed(2));
    }
  };

  const handleMargenLibreChange = (value) => {
    const nuevoMargen = Number(value || 0);
    if (nuevoMargen < 0 || nuevoMargen > 500) return;

    setMargen(String(nuevoMargen));

    const costoBase = Number(costoUnitario || 0);
    if (costoBase > 0) {
      const nuevoPrecio = costoBase * (1 + nuevoMargen / 100);
      setPrecioVentaManual(nuevoPrecio.toFixed(2));
    } else {
      setPrecioVentaManual("");
    }
  };

  useEffect(() => {
    const pack = Number(costoPack || 0);
    const unidades = Number(unidadesPorInterna || 0);
    if (pack <= 0 || unidades <= 0) return;

    const unitarioCalculado = pack / unidades;
    setCostoUnitario(unitarioCalculado.toFixed(2));
  }, [costoPack, unidadesPorInterna]);

  const clearForm = () => {
    setNombre("");
    setMedidaBase("UN");
    setMedidaInterna("PACK");
    setUnidadesPorInterna("");
    setStockBase("");
    setStockMin("");
    setStockObjetivo("");
    setTipoRotacion("media");
    setCodigoBarras("");
    setActivo(true);
    setCostoUnitario("");
    setCostoPack("");
    setMargen("20");
    setPrecioVentaManual("");
    setSearchTerm("");
    setSuggestions([]);
    setProvidersTemp([]);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSaving(true);

    try {
      if (editingProduct) {
        await updateDoc(userDoc("products", editingProduct.id), {
          nombre: nombre.trim(),
          medidaBase,
          medidaInterna,
          unidadesPorInterna:
            Number(unidadesPorInterna || 0) > 0 ? Number(unidadesPorInterna) : null,
          stockBase: Number(stockBase || 0),
          stockMin: Number(stockMin || 0),
          stockObjetivo: Number(stockObjetivo || 0),
          tipoRotacion,
          codigoBarras: codigoBarras || null,
          activo,
          costoUnitarioBase: Number(costoUnitario || 0),
          costoPack: costoPack === "" ? null : Number(costoPack),
          margen: Number(margen || 0),
          precioVentaBase: Number(precioVenta || 0),
          costoUnitario: Number(costoUnitario || 0),
          precioVenta: Number(precioVenta || 0),
          ultimaActualizacion: serverTimestamp(),
        });

        setEditingProduct(null);
      } else {
        const q = query(
          userCollection("products"),
          where("nombre", "==", nombre.trim())
        );

        const snapshot = await getDocs(q);
        if (!snapshot.empty) {
          toast.error("Este producto ya existe");
          setIsSaving(false);
          return;
        }

        const newProductoId = generateProductId(nombre, products);
        const newProductRef = await addDoc(userCollection("products"), {
          productoId: newProductoId,
          nombre: nombre.trim(),
          medidaBase,
          medidaInterna,
          unidadesPorInterna:
            Number(unidadesPorInterna || 0) > 0 ? Number(unidadesPorInterna) : null,
          stockBase: Number(stockBase || 0),
          stockMin: Number(stockMin || 0),
          stockObjetivo: Number(stockObjetivo || 0),
          tipoRotacion,
          codigoBarras: codigoBarras || null,
          activo,
          costoUnitarioBase: Number(costoUnitario || 0),
          costoPack: costoPack === "" ? null : Number(costoPack),
          margen: Number(margen || 0),
          precioVentaBase: Number(precioVenta || 0),
          costoUnitario: Number(costoUnitario || 0),
          precioVenta: Number(precioVenta || 0),
          ultimaActualizacion: serverTimestamp(),
          createdAt: serverTimestamp(),
        });

        for (const provider of providersTemp) {
          await upsertProviderProductLink({
            productDocId: newProductRef.id,
            productoId: newProductoId,
            proveedorId: provider.proveedorId,
            proveedorNombre: provider.proveedorNombre || provider.proveedorId,
            costoUnitario: Number(provider.costoUnitario || 0),
            costoPack:
              provider.costoPack === null || provider.costoPack === undefined
                ? null
                : Number(provider.costoPack || 0),
            activo: true,
          });
        }
      }

      await fetchProducts();
      clearForm();
      setOpenForm(false);
      toast.success(editingProduct ? "Producto actualizado" : "Producto creado");
    } catch (error) {
      console.error(error);
      toast.error("Error guardando producto");
    } finally {
      setIsSaving(false);
    }
  };

  const handleEdit = (product) => {
    const equivalenciaInterna = product.unidadesPorInterna ?? product.unidadesPorPack;
    setEditingProduct(product);
    setNombre(product.nombre || "");
    setMedidaBase(product.medidaBase || "UN");
    setMedidaInterna(product.medidaInterna || "PACK");
    setUnidadesPorInterna(
      equivalenciaInterna === null || equivalenciaInterna === undefined
        ? ""
        : String(equivalenciaInterna)
    );
    setStockBase(String(product.stockBase ?? product.stockUnidades ?? product.stockActual ?? 0));
    setStockMin(String(product.stockMin ?? 0));
    setStockObjetivo(String(product.stockObjetivo ?? 0));
    setTipoRotacion(product.tipoRotacion || "media");
    setCodigoBarras(product.codigoBarras || "");
    setActivo(product.activo !== false);
    setCostoUnitario(String(product.costoUnitarioBase ?? product.costoUnitario ?? ""));
    setCostoPack(product.costoPack === null || product.costoPack === undefined ? "" : String(product.costoPack));
    setMargen(String(product.margen ?? 20));
    setPrecioVentaManual(String(product.precioVentaBase ?? product.precioVenta ?? ""));
    setProvidersTemp([]);
    setOpenForm(true);
  };

  const handleDelete = async (id) => {
    const confirmDelete = window.confirm(
      "Seguro que deseas eliminar este producto?"
    );
    if (!confirmDelete) return;
    setIsDeletingId(id);

    try {
      await deleteDoc(userDoc("products", id));
      setProducts((prev) => prev.filter((p) => p.id !== id));
      if (editingProduct?.id === id) {
        setEditingProduct(null);
        clearForm();
      }
      toast.success("Producto eliminado correctamente");
    } catch (error) {
      console.error(error);
      toast.error("Error eliminando producto");
    } finally {
      setIsDeletingId("");
    }
  };

  const handleRefresh = async () => {
    setLoading(true);
    try {
      await fetchProducts();
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppLayout
      title="My Inventory"
      onRefresh={handleRefresh}
      onAdd={() => {
        setEditingProduct(null);
        clearForm();
        setOpenForm(true);
      }}
    >
      <div className="list-toolbar">
        <input
          type="text"
          placeholder="Buscar producto..."
          value={listSearch}
          onChange={(e) => setListSearch(e.target.value)}
        />
      </div>

      {loading ? (
        Array.from({ length: 5 }).map((_, index) => <SkeletonCard key={index} />)
      ) : visibleProducts.length === 0 ? (
        <p>No hay productos para mostrar</p>
      ) : (
        visibleProducts.map((p) => (
          <ProductCard
            key={p.id}
            producto={p}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onDetails={(product) => navigate(`/producto/${product.id}`)}
          />
        ))
      )}

      {openForm && (
        <div className="modal-overlay" onClick={() => setOpenForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingProduct ? "Editar producto" : "Nuevo producto"}</h3>
                    <button
                type="button"
                className="modal-close"
                onClick={() => setOpenForm(false)}
              >
                Cerrar
              </button>
            </div>
            <form onSubmit={handleSubmit} className="app-form">
              <div className="form-section">
                <h4>
                  <FaBoxOpen className="section-icon" />
                  Informacion General
                </h4>
                <div className="input-group">
                  <label>Nombre del producto</label>
                  <input
                    type="text"
                    className="input-modern"
                    value={nombre}
                    onChange={(e) => {
                      setNombre(e.target.value);
                      setSearchTerm(e.target.value);
                    }}
                    required
                  />
                </div>
                {visibleSuggestions.length > 0 && (
                  <div className="suggestions-box">
                    {visibleSuggestions.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        className="suggestion-item"
                        onClick={() => {
                          setNombre(s.nombre || "");
                          setSearchTerm(s.nombre || "");
                          setSuggestions([]);
                        }}
                      >
                        {s.nombre}
                      </button>
                    ))}
                  </div>
                )}

                <SeccionDistribuidores
                  producto={editingProduct}
                  draftProviders={providersTemp}
                  onDraftProvidersChange={setProvidersTemp}
                  medidaBaseOverride={medidaBase}
                  medidaInternaOverride={medidaInterna}
                  unidadesPorInternaOverride={unidadesPorInterna}
                />
              </div>

              <div className="form-section">
                <h4>
                  <FaBalanceScale className="section-icon" />
                  Unidad y Conversion
                </h4>
                <div className="input-group">
                  <label>
                    Medida base
                    <span className="tooltip-wrapper">
                      <FaQuestionCircle className="tooltip-icon" />
                      <span className="tooltip-text">
                        Unidad real donde vive el stock. Ej: UN, LB, LT.
                      </span>
                    </span>
                  </label>
                  <select
                    className="input-modern"
                    value={medidaBase}
                    onChange={(e) => setMedidaBase(e.target.value)}
                    required
                  >
                    <option value="UN">UN</option>
                    <option value="LB">LB</option>
                    <option value="LT">LT</option>
                    <option value="PACK">PACK</option>
                    <option value="CAJA">CAJA</option>
                    <option value="BOLSON">BOLSON</option>
                  </select>
                  <small>Unidad real donde vive el stock.</small>
                </div>

                <div className="input-group">
                  <label>
                    Medida interna
                    <span className="tooltip-wrapper">
                      <FaQuestionCircle className="tooltip-icon" />
                      <span className="tooltip-text">
                        Unidad comercial para operar. Ej: PACK, CAJA, QQ.
                      </span>
                    </span>
                  </label>
                  <select
                    className="input-modern"
                    value={medidaInterna}
                    onChange={(e) => setMedidaInterna(e.target.value)}
                    required
                  >
                    <option value="PACK">PACK</option>
                    <option value="BOLSON">BOLSON</option>
                    <option value="CAJA">CAJA</option>
                    <option value="QQ">QQ</option>
                    <option value="1/2QQ">1/2 QQ</option>
                    <option value="@">@</option>
                  </select>
                  <small>Unidad comercial usada para compra/operacion.</small>
                </div>

                <div className="input-group">
                  <label>
                    Unidades por interna
                    <span className="tooltip-wrapper">
                      <FaQuestionCircle className="tooltip-icon" />
                      <span className="tooltip-text">
                        Cuantas unidades base contiene 1 unidad interna.
                      </span>
                    </span>
                  </label>
                  <input
                    type="number"
                    className="input-modern"
                    value={unidadesPorInterna}
                    onChange={(e) => setUnidadesPorInterna(e.target.value)}
                  />
                  <small>Ejemplo: 12 si 1 PACK = 12 UN.</small>
                  {Number(unidadesPorInterna || 0) > 0 && (
                    <small>
                      Equivalencia actual: 1 {medidaInterna} = {unidadesPorInterna} {medidaBase}
                    </small>
                  )}
                </div>
              </div>

              <div className="form-section">
                <h4>
                  <FaWarehouse className="section-icon" />
                  Control de Inventario
                </h4>
                <div className="input-group">
                  <label>Stock actual (base)</label>
                  <input
                    type="number"
                    className="input-modern"
                    value={stockBase}
                    onChange={(e) => setStockBase(e.target.value)}
                    required
                  />
                </div>

                <div className="input-group">
                  <label>Stock minimo</label>
                  <input
                    type="number"
                    className="input-modern"
                    value={stockMin}
                    onChange={(e) => setStockMin(e.target.value)}
                    required
                  />
                  <small>Cuando baja de este valor, aparece alerta.</small>
                </div>

                <div className="input-group">
                  <label>
                    Stock objetivo
                    <span className="tooltip-wrapper">
                      <FaQuestionCircle className="tooltip-icon" />
                      <span className="tooltip-text">
                        Nivel ideal de inventario para recomendaciones de compra.
                      </span>
                    </span>
                  </label>
                  <input
                    type="number"
                    className="input-modern"
                    value={stockObjetivo}
                    onChange={(e) => setStockObjetivo(e.target.value)}
                    required
                  />
                  <small>Nivel ideal de inventario.</small>
                </div>
              </div>

              <div className="form-section">
                <h4>Costos y Precio</h4>
                <div className="input-group">
                  <label>Costo unitario base</label>
                  <input
                    type="number"
                    className="input-modern"
                    value={costoUnitario}
                    onChange={(e) => setCostoUnitario(e.target.value)}
                    readOnly={Number(costoPack || 0) > 0 && Number(unidadesPorInterna || 0) > 0}
                    required
                  />
                  {Number(costoPack || 0) > 0 && Number(unidadesPorInterna || 0) > 0 && (
                    <small>Calculado automaticamente segun pack.</small>
                  )}
                </div>

                <div className="input-group">
                  <label>Costo pack</label>
                  <input
                    type="number"
                    className="input-modern"
                    value={costoPack}
                    onChange={(e) => setCostoPack(e.target.value)}
                  />
                </div>

                <div className="input-group">
                  <label>Margen (%)</label>
                  <div className="input-percent">
                    <input
                      className="input-modern"
                      type="number"
                      min="0"
                      step="0.01"
                      value={margen}
                      onChange={(e) => handleMargenLibreChange(e.target.value)}
                    />
                    <span>%</span>
                  </div>
                  <small>Margen libre y sincronizado con el precio.</small>
                </div>

                <div className="input-group">
                  <label>Precio de venta base</label>
                  <input
                    type="number"
                    className="input-modern"
                    value={precioVenta}
                    onChange={(e) => handlePrecioVentaChange(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="form-section">
                <h4>Configuracion Adicional</h4>
                <div className="input-group">
                  <label>Tipo de rotacion</label>
                  <select
                    className="input-modern"
                    value={tipoRotacion}
                    onChange={(e) => setTipoRotacion(e.target.value)}
                    required
                  >
                    <option value="alta">alta</option>
                    <option value="media">media</option>
                    <option value="baja">baja</option>
                  </select>
                </div>

                <div className="input-group">
                  <label>Codigo de barras</label>
                  <input
                    type="text"
                    className="input-modern"
                    value={codigoBarras}
                    onChange={(e) => setCodigoBarras(e.target.value)}
                  />
                  <small>Opcional.</small>
                </div>

                <label className="checkbox-row">
                  Activo:
                  <input
                    type="checkbox"
                    checked={activo}
                    onChange={(e) => setActivo(e.target.checked)}
                  />
                </label>
              </div>

              <div className="form-actions">
                <button type="submit" disabled={isSaving}>
                  {isSaving
                    ? editingProduct
                      ? "Actualizando..."
                      : "Guardando..."
                    : editingProduct
                      ? "Actualizar Producto"
                      : "Agregar Producto"}
                </button>
                {editingProduct && (
                  <button
                    type="button"
                    onClick={() => handleDelete(editingProduct.id)}
                    disabled={isDeletingId === editingProduct.id}
                  >
                    {isDeletingId === editingProduct.id ? "Eliminando..." : "Eliminar"}
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}

    </AppLayout>
  );
}

export default Products;





