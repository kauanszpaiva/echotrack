const _jwtSecret = process.env.JWT_SECRET;
if (!_jwtSecret) {
  throw new Error("Missing JWT_SECRET environment variable. Please configure it.");
}
if (_jwtSecret === "REPLACE_WITH_RANDOM_HEX_64" || _jwtSecret.length < 32) {
  throw new Error("JWT_SECRET must be a strong secret of at least 32 characters.");
}
export const JWT_SECRET: string = _jwtSecret;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "Missing DATABASE_URL environment variable. Set the Supabase pooled connection string (port 6543, ?pgbouncer=true). See SUPABASE_SETUP.md."
  );
}
