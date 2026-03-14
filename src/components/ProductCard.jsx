export default function ProductCard({ producto, onEdit, onDetails }) {
  const stockBase = Number(
    producto.stockBase ?? producto.stockUnidades ?? producto.stockActual ?? 0
  );
  const stockMin = Number(producto.stockMin || 0);
  const bajoStock = stockBase <= stockMin;

  return (
    <div className="product-card">
      <div className="product-left">
        <div className="product-image" aria-hidden>
          BOX
        </div>
        <div>
          <h3>{producto.nombre}</h3>
          <p>
            Stock: {stockBase.toFixed(2)} {producto.medidaBase || "UN"}
          </p>
        </div>
      </div>

      <div className="product-right">
        <p className="price">C${Number(producto.precioVenta || 0).toFixed(2)}</p>
        {bajoStock && <span className="warning">LOW</span>}
        {onEdit && (
          <button type="button" className="card-action" onClick={() => onEdit(producto)}>
            Editar
          </button>
        )}
        {onDetails && (
          <button type="button" className="btn-secondary" onClick={() => onDetails(producto)}>
            Detalles
          </button>
        )}
      </div>
    </div>
  );
}
