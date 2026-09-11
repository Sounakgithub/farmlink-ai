require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const authRoutes = require("./routes/authRoutes");
const productRoutes = require("./routes/productRoutes");
const orderRoutes = require("./routes/orderRoutes");
const conversationRoutes = require("./routes/conversationRoutes");
const routeRoutes = require("./routes/routeRoutes");
const matchingRoutes = require("./routes/matchingRoutes");
const pricingRoutes = require("./routes/pricingRoutes");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    message: "FarmLink AI backend is running 🚜",
    database:
      mongoose.connection.readyState === 1 ? "connected" : "disconnected",
    endpoints: [
      "/api/auth",
      "/api/products",
      "/api/orders",
      "/api/conversations",
      "/api/routes",
      "/api/matching",
      "/api/pricing",
    ],
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/products", productRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/conversations", conversationRoutes);
app.use("/api/routes", routeRoutes);
app.use("/api/matching", matchingRoutes);
app.use("/api/pricing", pricingRoutes);

// Unknown API path -> JSON, never an HTML error page.
app.use("/api", (req, res) => {
  res.status(404).json({ message: `No API route for ${req.method} ${req.originalUrl}` });
});

// Central error handler so a thrown error still returns JSON.
app.use((error, req, res, _next) => {
  console.error("UNHANDLED ERROR:", error);
  res.status(error.status || 500).json({
    message: error.message || "Something went wrong on the server.",
  });
});

const PORT = process.env.PORT || 5000;

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected successfully"))
  .catch((error) => console.error("MongoDB connection failed:", error.message));

app.listen(PORT, () => {
  console.log(`FarmLink AI server running on http://localhost:${PORT}`);
});
