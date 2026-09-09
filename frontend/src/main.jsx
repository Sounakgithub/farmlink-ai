import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";
import { AuthProvider } from "./context/AuthContext.jsx";
import { CartProvider } from "./context/CartContext.jsx";
import { ToastProvider } from "./context/ToastContext.jsx";
import { MessagesProvider } from "./context/MessagesContext.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ToastProvider>
      <AuthProvider>
        <MessagesProvider>
          <CartProvider>
            <App />
          </CartProvider>
        </MessagesProvider>
      </AuthProvider>
    </ToastProvider>
  </StrictMode>
);
