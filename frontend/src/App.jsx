import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import ProtectedRoute from "./components/ProtectedRoute";
import RoleHome from "./components/RoleHome";

import Login from "./pages/auth/Login";
import Register from "./pages/auth/Register";

import FarmerDashboard from "./pages/farmer/FarmerDashboard";
import FarmerProducts from "./pages/farmer/FarmerProducts";
import FarmerOrders from "./pages/farmer/FarmerOrders";
import AddProduct from "./pages/farmer/AddProduct";

import BuyerDashboard from "./pages/buyer/BuyerDashboard";
import BuyerMarketplace from "./pages/buyer/BuyerMarketplace";
import Cart from "./pages/buyer/Cart";
import Orders from "./pages/buyer/Orders";

import DriverDashboard from "./pages/driver/DriverDashboard";

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
