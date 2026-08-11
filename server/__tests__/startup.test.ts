import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

/**
 * A missing Clerk key used to make `clerkMiddleware()` throw on *every* request,
 * so the whole API — health check included — answered 500 with a Clerk stack
 * trace and nothing to diagnose from. These tests pin the fail-closed,
 * diagnosable behaviour instead.
 */
async function loadApp(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete (process.env as any)[key];
    else process.env[key] = value;
  }
  const { Router } = await import('express');
  const router = Router();
  router.get('/protected', (_req, res) => res.json({ ok: true }));
  vi.doMock('../routes.js', () => ({ default: router }));
  return (await import('../app.js')).default;
}

const NO_CLERK = { CLERK_SECRET_KEY: undefined, CLERK_PUBLISHABLE_KEY: undefined };

afterEach(() => {
  delete process.env.CLERK_SECRET_KEY;
  delete process.env.CLERK_PUBLISHABLE_KEY;
});

describe('Clerk misconfiguration', () => {
  it('keeps the health check answerable and flags the misconfiguration', async () => {
    const app = await loadApp({ ...NO_CLERK });
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.auth).toBe('misconfigured');
  });

  it('fails closed with an actionable code instead of a leaked 500', async () => {
    const app = await loadApp({ ...NO_CLERK });
    const res = await request(app).get('/api/protected');
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('AUTH_NOT_CONFIGURED');
    expect(JSON.stringify(res.body)).not.toMatch(/clerk\.com|at .*\.ts:/i);
  });

  it('treats a half-configured Clerk (secret key only) as misconfigured', async () => {
    const app = await loadApp({ ...NO_CLERK, CLERK_SECRET_KEY: 'sk_test_x' });
    const res = await request(app).get('/api/health');
    expect(res.body.auth).toBe('misconfigured');
  });

  it('reports healthy auth when both keys are present', async () => {
    const app = await loadApp({
      CLERK_SECRET_KEY: 'sk_test_x',
      CLERK_PUBLISHABLE_KEY: `pk_test_${Buffer.from('example.clerk.accounts.dev$').toString('base64')}`,
    });
    const res = await request(app).get('/api/health');
    expect(res.body.auth).toBe('configured');
  });
});
