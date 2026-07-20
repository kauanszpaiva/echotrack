import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import cors from "cors";
import cookieParser from "cookie-parser";
import apiRoutes from "./server/routes.js"; // Note: .js extension for TSX running or import resolution

const app = express();
app.set('trust proxy', 1);

const configuredOrigins = new Set(
  (process.env.CORS_ORIGINS || process.env.FRONTEND_URL || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
);

function isAllowedOrigin(origin?: string) {
  if (!origin) return true;
  if (configuredOrigins.has(origin)) return true;

  if (process.env.NODE_ENV !== "production") {
    return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  }

  return false;
}

async function startServer() {
  const PORT = 3000;

  app.use(cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      callback(null, isAllowedOrigin(origin) ? origin : false);
    },
    credentials: true
  }));
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());

  // API routes FIRST
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", time: new Date().toISOString() });
  });

  // Mount the Prisma/JWT API
  app.use("/api", apiRoutes);

  // Global Error Handler for /api to ensure JSON responses
  app.use("/api", (err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error(`[API Error] ${req.method} ${req.path}:`, err);
    res.status(err.status || 500).json({ 
      error: err.message || "Internal Server Error",
      path: req.path
    });
  });

  // API 404 fallback to prevent HTML response for failed /api requests
  app.use("/api", (req, res) => {
    res.status(404).json({ error: `API route not found: ${req.method} ${req.originalUrl}` });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

export default function handler(req: any, res: any) {
  return (app as any)(req, res);
}

startServer();
