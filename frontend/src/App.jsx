import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import ProtectedRoute from "./components/ProtectedRoute";
import RoleHome from "./components/RoleHome";

import Login from "./pages/auth/Login";
import Register from "./pages/auth/Register";

import FarmerDashboard from "./pages/farmer/FarmerDashboard";
import FarmerProducts from "./pages/farmer/FarmerProducts";
import FarmerOrders from "./pages/farmer/FarmerOrders";
import BuyerMatches from "./pages/farmer/BuyerMatches";
import AddProduct from "./pages/farmer/AddProduct";

import BuyerDashboard from "./pages/buyer/BuyerDashboard";
import BuyerMarketplace from "./pages/buyer/BuyerMarketplace";
import Cart from "./pages/buyer/Cart";
import Orders from "./pages/buyer/Orders";
import Recommendations from "./pages/buyer/Recommendations";

import DriverDashboard from "./pages/driver/DriverDashboard";
import LogisticsDashboard from "./pages/logistics/LogisticsDashboard";
import AdminConsole from "./pages/admin/AdminConsole";
import Wholesale from "./pages/buyer/Wholesale";

import Insights from "./pages/shared/Insights";
import Profile from "./pages/shared/Profile";
import Messages from "./pages/shared/Messages";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public */}
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />

        {/* Sends each role to its own dashboard */}
        <Route path="/" element={<RoleHome />} />

        {/* Farmer */}
        <Route
          path="/farmer"
          element={
            <ProtectedRoute roles={["farmer"]}>
              <FarmerDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/farmer/products"
          element={
            <ProtectedRoute roles={["farmer"]}>
              <FarmerProducts />
            </ProtectedRoute>
          }
        />
        <Route
          path="/farmer/orders"
          element={
            <ProtectedRoute roles={["farmer"]}>
              <FarmerOrders />
            </ProtectedRoute>
          }
        />
        <Route
          path="/farmer/add-product"
          element={
            <ProtectedRoute roles={["farmer"]}>
              <AddProduct />
            </ProtectedRoute>
          }
        />

        <Route
          path="/farmer/buyer-matches"
          element={
            <ProtectedRoute roles={["farmer"]}>
              <BuyerMatches />
            </ProtectedRoute>
          }
        />

        {/* Farmer-only AI planning tools */}
        <Route
          path="/insights"
          element={
            <ProtectedRoute roles={["farmer"]}>
              <Insights />
            </ProtectedRoute>
          }
        />

        {/* Buyer */}
        <Route
          path="/buyer"
          element={
            <ProtectedRoute roles={["buyer"]}>
              <BuyerDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/cart"
          element={
            <ProtectedRoute roles={["buyer"]}>
              <Cart />
            </ProtectedRoute>
          }
        />
        <Route
          path="/orders"
          element={
            <ProtectedRoute roles={["buyer"]}>
              <Orders />
            </ProtectedRoute>
          }
        />
        <Route
          path="/recommendations"
          element={
            <ProtectedRoute roles={["buyer"]}>
              <Recommendations />
            </ProtectedRoute>
          }
        />

        <Route
          path="/wholesale"
          element={
            <ProtectedRoute roles={["buyer"]}>
              <Wholesale />
            </ProtectedRoute>
          }
        />

        {/* Logistics company */}
        <Route
          path="/logistics"
          element={
            <ProtectedRoute roles={["logistics"]}>
              <LogisticsDashboard />
            </ProtectedRoute>
          }
        />

        {/* Platform admin */}
        <Route
          path="/admin"
          element={
            <ProtectedRoute roles={["admin"]}>
              <AdminConsole />
            </ProtectedRoute>
          }
        />

        {/* Driver */}
        <Route
          path="/driver"
          element={
            <ProtectedRoute roles={["driver"]}>
              <DriverDashboard />
            </ProtectedRoute>
          }
        />

        {/* Marketplace — buyers shop here, farmers can see how their crops compare */}
        <Route
          path="/market"
          element={
            <ProtectedRoute roles={["buyer", "farmer"]}>
              <BuyerMarketplace />
            </ProtectedRoute>
          }
        />

        {/* Messaging — every role */}
        <Route
          path="/messages"
          element={
            <ProtectedRoute>
              <Messages />
            </ProtectedRoute>
          }
        />
        <Route
          path="/messages/:id"
          element={
            <ProtectedRoute>
              <Messages />
            </ProtectedRoute>
          }
        />

        {/* Profile — every role */}
        <Route
          path="/profile"
          element={
            <ProtectedRoute>
              <Profile />
            </ProtectedRoute>
          }
        />

        {/* Anything else */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
