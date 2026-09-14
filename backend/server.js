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
const inspectionRoutes = require("./routes/inspectionRoutes");
const logisticsRoutes = require("./routes/logisticsRoutes");
const b2bRoutes = require("./routes/b2bRoutes");
const adminRoutes = require("./routes/adminRoutes");
const publicApiRoutes = require("./routes/publicApiRoutes");
const { sweepAutoRelease } = require("./utils/settlement");
const { sweepExpiredOffers } = require("./utils/logistics");

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
      "/api/inspections",
      "/api/logistics",
      "/api/b2b",
      "/api/admin",
      "/api/v1",
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
app.use("/api/inspections", inspectionRoutes);
app.use("/api/logistics", logisticsRoutes);
app.use("/api/b2b", b2bRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/v1", publicApiRoutes);

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

// Timed jobs: release escrow whose confirmation window lapsed, and move
// logistics offers nobody answered on to the next carrier. SWEEP_INTERVAL_MS=0
// turns them off (an admin can still run them from /api/admin/sweeps/run).
function startSweeps() {
  const every = Number(process.env.SWEEP_INTERVAL_MS ?? 60_000);
  if (!Number.isFinite(every) || every <= 0) return;

  let running = false;
  const tick = async () => {
    if (running || mongoose.connection.readyState !== 1) return;
    running = true;
    try {
      const [released, offersMoved] = await Promise.all([sweepAutoRelease(), sweepExpiredOffers()]);
      if (released || offersMoved) {
        console.log(`Sweeps: released ${released} escrow(s), moved ${offersMoved} expired offer(s)`);
      }
    } catch (error) {
      console.error("SWEEP ERROR:", error.message);
    } finally {
      running = false;
    }
  };
  setInterval(tick, every).unref();
}

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("MongoDB connected successfully");
    startSweeps();
  })
  .catch((error) => console.error("MongoDB connection failed:", error.message));

app.listen(PORT, () => {
  console.log(`FarmLink AI server running on http://localhost:${PORT}`);
});
