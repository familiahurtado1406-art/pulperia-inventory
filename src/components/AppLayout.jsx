import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { FaHome } from "react-icons/fa";
import { Link, useNavigate } from "react-router-dom";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth } from "../firebase/config";

export default function AppLayout({ title, children, onAdd, onRefresh }) {
  const navigate = useNavigate();
  const [openDrawer, setOpenDrawer] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [user, setUser] = useState(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setShowLogoutConfirm(false);
      setOpenDrawer(false);
      navigate("/login", { replace: true });
    } catch (error) {
      toast.error(error.message);
    }
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <button
          type="button"
          className="menu-btn"
          aria-label="Menu"
          onClick={() => setOpenDrawer(true)}
        >
          =
        </button>
        <h1>{title}</h1>
        <div className="header-actions">
          <button
            type="button"
            className="refresh-btn"
            onClick={() => navigate("/pos")}
            aria-label="Ir a inicio"
            title="Ir a inicio"
            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}
          >
            <FaHome size={16} />
          </button>
          {onRefresh && (
            <button type="button" className="refresh-btn" onClick={onRefresh}>
              Refresh
            </button>
          )}
        </div>
      </header>

      <div
        className={`drawer-overlay ${openDrawer ? "open" : ""}`}
        onClick={() => setOpenDrawer(false)}
      >
        <aside className="drawer" onClick={(e) => e.stopPropagation()}>
          <div className="user-info">
            <strong>👤 {user?.displayName || "Usuario"}</strong>
            <small>{user?.email || "-"}</small>
          </div>
          <h3>Menu</h3>
          <Link to="/dashboard" onClick={() => setOpenDrawer(false)}>
            Dashboard
          </Link>
          <Link to="/dashboard/insights/top" onClick={() => setOpenDrawer(false)}>
            Analisis Inventario
          </Link>
          <Link to="/productos" onClick={() => setOpenDrawer(false)}>
            Productos
          </Link>
          <Link to="/proveedores" onClick={() => setOpenDrawer(false)}>
            Proveedores
          </Link>
          <Link to="/conteo" onClick={() => setOpenDrawer(false)}>
            Conteo
          </Link>
          <Link to="/recibir-pedido" onClick={() => setOpenDrawer(false)}>
            Recibir Pedido
          </Link>
          <Link to="/pedido" onClick={() => setOpenDrawer(false)}>
            Realizar Pedido
          </Link>
          <Link to="/pos" onClick={() => setOpenDrawer(false)}>
            POS
          </Link>
          <Link to="/historial-pedidos" onClick={() => setOpenDrawer(false)}>
            Historial Pedidos
          </Link>
          <Link to="/historial-cambios" onClick={() => setOpenDrawer(false)}>
            Historial Cambios
          </Link>
          <hr className="menu-divider" />
          <button type="button" className="menu-item logout" onClick={() => setShowLogoutConfirm(true)}>
            🚪 Cerrar sesion
          </button>
        </aside>
      </div>

      <main className="app-content">{children}</main>

      {onAdd && (
        <button type="button" className="fab" onClick={onAdd} aria-label="Agregar">
          +
        </button>
      )}

      {showLogoutConfirm && (
        <div className="modal-overlay" onClick={() => setShowLogoutConfirm(false)}>
          <div className="modal modal-compact" onClick={(e) => e.stopPropagation()}>
            <h3>Cerrar sesion</h3>
            <p>Tu sesion actual se cerrara.</p>
            <div className="modal-buttons">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowLogoutConfirm(false)}
              >
                Cancelar
              </button>
              <button type="button" className="btn-danger" onClick={handleLogout}>
                Si, cerrar sesion
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
