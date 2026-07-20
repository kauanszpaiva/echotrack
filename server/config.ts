// Auth configuration helpers.
//
// The JWT secret is validated *lazily* (at request time) rather than at module
// import. A missing/weak secret used to throw here on import, which crashed the
// entire serverless function on Vercel — every route, including /api/health,
// returned an opaque HTML 500 (surfacing in the UI as "Server returned non-JSON
// response"). Validating lazily keeps the app importable so /api/health can
// report exactly what is misconfigured, while auth routes still fail cleanly.

export function jwtSecretStatus(): { ok: boolean; reason?: string } {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return { ok: false, reason: 'JWT_SECRET environment variable is missing' };
  }
  if (secret === 'REPLACE_WITH_RANDOM_HEX_64' || secret.length < 32) {
    return { ok: false, reason: 'JWT_SECRET must be a strong secret of at least 32 characters' };
  }
  return { ok: true };
}

/**
 * Returns the validated JWT secret, or throws a 500-tagged error whose message
 * explains the misconfiguration. Callers already funnel thrown errors with a
 * `status` into JSON responses, so the admin sees a clear cause instead of a
 * generic crash.
 */
export function getJwtSecret(): string {
  const status = jwtSecretStatus();
  if (!status.ok) {
    const error = new Error(status.reason) as Error & { status: number };
    error.status = 500;
    throw error;
  }
  return process.env.JWT_SECRET as string;
}
