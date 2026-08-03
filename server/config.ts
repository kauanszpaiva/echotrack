// DEPRECATED: authentication is unified on Supabase Auth (see server/auth.ts).
// JWT_SECRET is no longer used to authenticate requests. Kept only so any
// lingering import resolves without crashing the server at startup.
export const JWT_SECRET: string = process.env.JWT_SECRET || "deprecated-unused-secret";
