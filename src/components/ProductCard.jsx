import { useRef } from "react";

export default function ProductCard({ producto, onEdit, onDelete, onDetails }) {
  const touchStartX = useRef(null);

  const stockBase = Number(
    producto.stockBase ?? producto.stockUnidades ?? producto.stockActual ?? 0
  );
  const stockMin = Number(producto.stockMin || 0);
  const bajoStock = stockBase <= stockMin;

  const handleTouchStart = (event) => {
    touchStartX.current = event.changedTouches[0]?.clientX ?? null;
  };

  const handleTouchEnd = (event) => {
    if (!onDelete || touchStartX.current === null) return;
    const endX = event.changedTouches[0]?.clientX ?? touchStartX.current;
    const deltaX = endX - touchStartX.current;
    touchStartX.current = null;

    if (deltaX < -70) {
      onDelete(producto.id);
    }
  };

  return (
    <div
      className="product-card"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
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
