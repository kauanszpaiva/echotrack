import "dotenv/config";
import app from "../server/app.js";

// Vercel serverless entry point. Vercel wraps the exported Express app as a
// serverless function; all /api/* requests are rewritten here by vercel.json.
export default app;
