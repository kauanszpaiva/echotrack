import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import apiRoutes from "./routes.js";

const configuredOrigins = new Set(
  (process.env.CORS_ORIGINS || process.env.FRONTEND_URL || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
);

function isAllowedOrigin(origin?: string) {
  if (!origin) return true;
  if (configuredOrigins.has(origin)) return true;

  // Allow the Vercel deployment URL(s) automatically when running there.
  if (/\.vercel\.app$/.test(new URL(origin).hostname)) return true;

  if (process.env.NODE_ENV !== "production") {
    return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  }

  return false;
}

/**
 * Builds the API-only Express app (CORS, JSON, cookies, /api routes).
 * Shared by local dev (server.ts) and the Vercel serverless entry (api/index.ts).
 * Static assets / SPA fallback are handled by Vite in dev and by Vercel in prod.
 */
const app = express();
app.set("trust proxy", 1);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      let allowed = false;
      try {
        allowed = isAllowedOrigin(origin);
      } catch {
        allowed = false;
      }
      callback(null, allowed ? origin : false);
    },
    credentials: true,
  })
);
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// Mount the Prisma/JWT API
app.use("/api", apiRoutes);

// Global error handler for /api to ensure JSON responses
app.use(
  "/api",
  (
    err: any,
    req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error(`[API Error] ${req.method} ${req.path}:`, err);
    res.status(err.status || 500).json({
      error: err.message || "Internal Server Error",
      path: req.path,
    });
  }
);

// API 404 fallback to prevent HTML responses for failed /api requests
app.use("/api", (req, res) => {
  res
    .status(404)
    .json({ error: `API route not found: ${req.method} ${req.originalUrl}` });
});

export default app;
