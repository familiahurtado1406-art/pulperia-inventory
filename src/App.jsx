import { Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import Dashboard from "./pages/Dashboard";
import Products from "./pages/Products";
import ProveedoresPage from "./pages/ProveedoresPage";
import Conteo from "./pages/Conteo";
import RealizarPedido from "./pages/RealizarPedido";
import RecibirPedidoPage from "./pages/RecibirPedidoPage";
import AppLayout from "./components/AppLayout";
import HistorialPedidos from "./pages/HistorialPedidos";
import HistorialCambios from "./pages/HistorialCambios";
import InventoryInsightsPage from "./pages/InventoryInsightsPage";
import ProductoDetalles from "./pages/ProductoDetalles";
import PedidosHoyPage from "./pages/PedidosHoyPage";
import PosPage from "./pages/PosPage";
import Login from "./pages/Login";
import ProtectedRoute from "./components/ProtectedRoute";

function App() {
  return (
    <div className="app-shell">
      <Toaster position="top-center" />
      <div className="page-body">
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <AppLayout title="Dashboard">
                  <Dashboard />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <AppLayout title="Dashboard">
                  <Dashboard />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/dashboard/insights/:type"
            element={
              <ProtectedRoute>
                <AppLayout title="Analisis Inventario">
                  <InventoryInsightsPage />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/productos"
            element={
              <ProtectedRoute>
                <Products />
              </ProtectedRoute>
            }
          />
          <Route
            path="/producto/:id"
            element={
              <ProtectedRoute>
                <AppLayout title="Detalle Producto">
                  <ProductoDetalles />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/proveedores"
            element={
              <ProtectedRoute>
                <ProveedoresPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/conteo"
            element={
              <ProtectedRoute>
                <AppLayout title="Conteo">
                  <Conteo />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/pedido"
            element={
              <ProtectedRoute>
                <AppLayout title="Realizar Pedido">
                  <RealizarPedido />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/pedidos-hoy"
            element={
              <ProtectedRoute>
                <AppLayout title="Pedidos de hoy">
                  <PedidosHoyPage />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/historial-pedidos"
            element={
              <ProtectedRoute>
                <AppLayout title="Historial Pedidos">
                  <HistorialPedidos />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/historial-cambios"
            element={
              <ProtectedRoute>
                <AppLayout title="Historial de Cambios">
                  <HistorialCambios />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/recibir-pedido"
            element={
              <ProtectedRoute>
                <AppLayout title="Recibir Pedido">
                  <RecibirPedidoPage />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/pos"
            element={
              <ProtectedRoute>
                <AppLayout title="POS">
                  <PosPage />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </div>
    </div>
  );
}

export default App;
