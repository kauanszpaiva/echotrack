import express from "express";
import cors from "cors";
import { clerkMiddleware } from "@clerk/express";
import apiRoutes from "./routes.js";

const isProduction = process.env.NODE_ENV === "production";

/**
 * Explicit CORS allowlist.
 *
 * `CORS_ORIGINS` is the source of truth. Vercel's own URLs for *this* project
 * are added automatically (`VERCEL_URL` is the current deployment,
 * `VERCEL_PROJECT_PRODUCTION_URL` the production domain) so a deployment can
 * always talk to its own API without hand-maintaining every preview URL.
 *
 * A blanket `*.vercel.app` rule is deliberately NOT used: anyone can deploy to
 * vercel.app, so it would let arbitrary third-party sites make credentialed
 * cross-origin calls to this API.
 */
function buildAllowedOrigins(): Set<string> {
  const origins = (process.env.CORS_ORIGINS || process.env.FRONTEND_URL || "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean);

  for (const host of [process.env.VERCEL_PROJECT_PRODUCTION_URL, process.env.VERCEL_URL]) {
    if (host) origins.push(`https://${host.replace(/^https?:\/\//, "").replace(/\/$/, "")}`);
  }

  return new Set(origins);
}

const allowedOrigins = buildAllowedOrigins();

export function isAllowedOrigin(origin?: string): boolean {
  // Same-origin browser requests and server-to-server calls send no Origin —
  // CORS is not what protects those; authMiddleware is.
  if (!origin) return true;
  const normalized = origin.replace(/\/$/, "");
  if (allowedOrigins.has(normalized)) return true;

  // Local development only. Never in production, whatever the port.
  if (!isProduction) {
    return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(normalized);
  }

  return false;
}

/**
 * Builds the API-only Express app (CORS, JSON, Clerk context, /api routes).
 * Shared by local dev (server.ts) and the Vercel serverless entry (api/index.ts).
 * Static assets / SPA fallback are handled by Vite in dev and by Vercel in prod.
 */
const app = express();
app.set("trust proxy", 1);

app.use(
  cors({
    origin(origin, callback) {
      let allowed = false;
      try {
        allowed = isAllowedOrigin(origin);
      } catch {
        allowed = false;
      }
      if (!allowed && origin) {
        console.warn(`[cors] blocked origin: ${origin}`);
      }
      callback(null, allowed ? origin || true : false);
    },
    credentials: true,
  })
);
app.use(express.json({ limit: "100kb" }));

/**
 * Clerk needs BOTH keys: the secret to call the API and the publishable key to
 * verify session tokens. Without them `clerkMiddleware()` throws on every
 * request — including the health check — which surfaces as an undiagnosable
 * 500 across the whole API. Detect it once, up front, instead.
 */
const clerkConfigured = Boolean(process.env.CLERK_SECRET_KEY && process.env.CLERK_PUBLISHABLE_KEY);

if (!clerkConfigured) {
  const missing = [
    !process.env.CLERK_SECRET_KEY && "CLERK_SECRET_KEY",
    !process.env.CLERK_PUBLISHABLE_KEY && "CLERK_PUBLISHABLE_KEY",
  ].filter(Boolean).join(", ");
  console.error(
    `[startup] Clerk is not configured (missing: ${missing}). Authentication is disabled ` +
      `and every protected endpoint will return 503. Set the variables in your environment ` +
      `(Vercel → Settings → Environment Variables) and redeploy.`
  );
}

// Health check is mounted BEFORE Clerk so it stays answerable during an auth
// misconfiguration — that is precisely when you need to read it.
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    auth: clerkConfigured ? "configured" : "misconfigured",
    time: new Date().toISOString(),
  });
});

if (clerkConfigured) {
  // Attach Clerk auth context to every request (reads CLERK_SECRET_KEY /
  // CLERK_PUBLISHABLE_KEY from env). Enforcement happens per-route in
  // authMiddleware via getAuth(req).
  app.use(clerkMiddleware());
} else {
  // Fail closed with an actionable code rather than leaking a Clerk stack trace
  // through a generic 500 on every route.
  app.use("/api", (_req, res) => {
    res.status(503).json({
      code: "AUTH_NOT_CONFIGURED",
      error: "Authentication is not configured on this deployment",
    });
  });
}

// Mount the API
app.use("/api", apiRoutes);

// Global error handler for /api. Always JSON; never leaks internals in
// production (stack traces, Prisma/Clerk messages, connection strings).
app.use(
  "/api",
  (
    err: any,
    req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error(`[API Error] ${req.method} ${req.path}:`, err);
    const status = err.status || 500;
    const clientSafe = status < 500 && typeof err.message === "string";
    res.status(status).json({
      error: clientSafe ? err.message : "Internal Server Error",
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
