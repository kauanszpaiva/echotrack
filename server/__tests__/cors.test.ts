import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The allowlist is built once at import time from the environment, so each case
 * sets its env and re-imports the module.
 */
async function loadIsAllowedOrigin(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete (process.env as any)[key];
    else process.env[key] = value;
  }
  const { Router } = await import('express');
  vi.doMock('../routes.js', () => ({ default: Router() }));
  const mod = await import('../app.js');
  return mod.isAllowedOrigin;
}

const CLEAN = {
  NODE_ENV: undefined,
  CORS_ORIGINS: undefined,
  FRONTEND_URL: undefined,
  VERCEL_URL: undefined,
  VERCEL_PROJECT_PRODUCTION_URL: undefined,
};

afterEach(() => {
  for (const key of Object.keys(CLEAN)) delete (process.env as any)[key];
});

describe('CORS allowlist in production', () => {
  it('allows the configured production origin', async () => {
    const isAllowed = await loadIsAllowedOrigin({
      ...CLEAN,
      NODE_ENV: 'production',
      CORS_ORIGINS: 'https://echotrack.vercel.app',
    });
    expect(isAllowed('https://echotrack.vercel.app')).toBe(true);
  });

  it('blocks an arbitrary third-party *.vercel.app site', async () => {
    const isAllowed = await loadIsAllowedOrigin({
      ...CLEAN,
      NODE_ENV: 'production',
      CORS_ORIGINS: 'https://echotrack.vercel.app',
    });
    // Anyone can deploy this; it must not be able to make credentialed calls.
    expect(isAllowed('https://attacker-clone.vercel.app')).toBe(false);
    expect(isAllowed('https://echotrack.vercel.app.evil.com')).toBe(false);
  });

  it('blocks localhost in production', async () => {
    const isAllowed = await loadIsAllowedOrigin({
      ...CLEAN,
      NODE_ENV: 'production',
      CORS_ORIGINS: 'https://echotrack.vercel.app',
    });
    expect(isAllowed('http://localhost:3000')).toBe(false);
  });

  it("allows the deployment's own Vercel URLs without hand-listing them", async () => {
    const isAllowed = await loadIsAllowedOrigin({
      ...CLEAN,
      NODE_ENV: 'production',
      VERCEL_URL: 'echotrack-git-preview-ksp.vercel.app',
      VERCEL_PROJECT_PRODUCTION_URL: 'echotrack.vercel.app',
    });
    expect(isAllowed('https://echotrack-git-preview-ksp.vercel.app')).toBe(true);
    expect(isAllowed('https://echotrack.vercel.app')).toBe(true);
    expect(isAllowed('https://some-other-preview.vercel.app')).toBe(false);
  });

  it('allows same-origin/server-side requests that carry no Origin header', async () => {
    const isAllowed = await loadIsAllowedOrigin({ ...CLEAN, NODE_ENV: 'production' });
    expect(isAllowed(undefined)).toBe(true);
  });
});

describe('CORS allowlist in development', () => {
  it('allows localhost on any port', async () => {
    const isAllowed = await loadIsAllowedOrigin({ ...CLEAN, NODE_ENV: 'development' });
    expect(isAllowed('http://localhost:5173')).toBe(true);
    expect(isAllowed('http://127.0.0.1:3000')).toBe(true);
  });

  it('still blocks unrelated remote origins', async () => {
    const isAllowed = await loadIsAllowedOrigin({ ...CLEAN, NODE_ENV: 'development' });
    expect(isAllowed('https://attacker-clone.vercel.app')).toBe(false);
  });
});
