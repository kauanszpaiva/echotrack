import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import apiRoutes from "./routes.js";
import prisma from "./prisma.js";
import { jwtSecretStatus } from "./config.js";

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

// Health + configuration diagnostics. Reports (without leaking secret values)
// whether the pieces login depends on are present: JWT secret, database URL,
// live DB connectivity, Firebase (social login), and whether any active account
// actually exists to sign in with. This is the first thing to check when
// "login is not working" on a deployment.
app.get("/api/health", async (_req, res) => {
  const isProd = process.env.NODE_ENV === "production";
  const jwt = jwtSecretStatus();

  const checks: Record<string, unknown> = {
    jwtSecret: jwt.ok,
    databaseUrl: Boolean(process.env.DATABASE_URL),
    firebaseServiceAccount: Boolean(
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS
    ),
  };
  if (!jwt.ok && !isProd) checks.jwtSecretReason = jwt.reason;

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = true;
    checks.activeUsers = await prisma.user.count({
      where: { accountStatus: "ACTIVE", isActive: true },
    });
  } catch (e: any) {
    checks.database = false;
    // Avoid leaking connection details (which may include credentials) in prod.
    if (!isProd) checks.databaseError = e?.message || String(e);
  }

  const ok = checks.jwtSecret === true && checks.databaseUrl === true && checks.database === true;
  res.status(ok ? 200 : 503).json({
    status: ok ? "ok" : "degraded",
    time: new Date().toISOString(),
    checks,
  });
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
