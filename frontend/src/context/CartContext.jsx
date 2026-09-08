import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useAuth } from "./AuthContext";

const CartContext = createContext(null);

const storageKey = (userId) => `farmlink_cart_${userId || "guest"}`;

function readCart(userId) {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function CartProvider({ children }) {
  const { user } = useAuth();
  const userId = user?.id;

  const [cart, setCart] = useState(() => readCart(userId));

  // Swap to this user's cart when the signed-in user changes (incl. logout).
  // Done during render so the very first paint already shows the right cart.
  const [cartOwner, setCartOwner] = useState(userId);
  if (cartOwner !== userId) {
    setCartOwner(userId);
    setCart(readCart(userId));
  }

  // Persist on every change.
  useEffect(() => {
    try {
      localStorage.setItem(storageKey(userId), JSON.stringify(cart));
    } catch {
      /* storage blocked - cart just won't persist */
    }
  }, [cart, userId]);

  const addToCart = useCallback((product, quantity = 1) => {
    setCart((current) => {
      const existing = current.find((item) => item._id === product._id);
      const stock = product.quantity ?? Infinity;

      if (existing) {
        return current.map((item) =>
          item._id === product._id
            ? {
                ...item,
                cartQuantity: Math.min(stock, item.cartQuantity + quantity),
              }
            : item
        );
      }

      return [
        ...current,
        {
          _id: product._id,
          cropName: product.cropName,
          farmerName: product.farmerName,
          farmerId: product.farmerId,
          location: product.location,
          pricePerKg: product.pricePerKg,
          unit: product.unit,
          stock,
          cartQuantity: Math.min(stock, quantity),
        },
      ];
    });
  }, []);

  const setQuantity = useCallback((productId, quantity) => {
    setCart((current) =>
      current.flatMap((item) => {
        if (item._id !== productId) return [item];
        const next = Math.max(0, Math.min(item.stock ?? Infinity, quantity));
        return next === 0 ? [] : [{ ...item, cartQuantity: next }];
      })
    );
  }, []);

  const removeFromCart = useCallback((productId) => {
    setCart((current) => current.filter((item) => item._id !== productId));
  }, []);

  const clearCart = useCallback(() => setCart([]), []);

  const value = useMemo(() => {
    const itemCount = cart.reduce((sum, item) => sum + item.cartQuantity, 0);
    const totalPrice = cart.reduce(
      (sum, item) => sum + item.pricePerKg * item.cartQuantity,
      0
    );

    return {
      cart,
      itemCount,
      totalPrice,
      addToCart,
      setQuantity,
      removeFromCart,
      clearCart,
      isInCart: (id) => cart.some((item) => item._id === id),
    };
  }, [cart, addToCart, setQuantity, removeFromCart, clearCart]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error("useCart must be used inside a <CartProvider>");
  return context;
}
