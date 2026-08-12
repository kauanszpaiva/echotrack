import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Guards the Vercel serverless bundle against a failure that took the entire
 * API down in production.
 *
 * `server/exports.tsx` was imported from routes.ts as `./exports.js`. Vercel's
 * Node builder traces the import graph from `api/index.ts` and compiles the
 * `.ts` files it finds into the lambda — but it does not compile `.tsx`. The
 * file therefore never reached `/var/task`, and Node threw at module load:
 *
 *   Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/var/task/server/exports.js'
 *   imported from /var/task/server/routes.js
 *
 * A module-load crash never reaches Express, so the JSON error handler could not
 * answer it: every route — /api/health and /api/admin/analytics alike — returned
 * Vercel's plain-text FUNCTION_INVOCATION_FAILED page, which the browser
 * reported as "Server returned non-JSON response (500)".
 *
 * `tsc --noEmit` and `vite build` both stayed green throughout, because neither
 * one models Vercel's file-extension rules. Hence this test.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ENTRY = 'api/index.ts';

/** Relative specifiers only — bare package names are resolved by node_modules. */
function relativeImportsOf(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const specifiers: string[] = [];
  // `import x from './y.js'`, `export * from './y.js'`, `import('./y.js')`.
  const pattern = /(?:\bfrom\s*|\bimport\s*\(\s*)['"](\.[^'"]*)['"]/g;
  for (const match of source.matchAll(pattern)) specifiers.push(match[1]);
  return specifiers;
}

/**
 * Mirrors how the bundle resolves a specifier: the code is authored with the
 * ESM-correct `.js` suffix, and the real file on disk is the `.ts` sibling.
 */
function resolve(fromFile: string, specifier: string): string | null {
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = base.endsWith('.js')
    ? [base.replace(/\.js$/, '.ts'), base.replace(/\.js$/, '.tsx'), base]
    : [`${base}.ts`, `${base}.tsx`, base, path.join(base, 'index.ts')];

  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function walkFromEntry() {
  const seen = new Set<string>();
  const queue = [path.join(repoRoot, ENTRY)];
  const unresolved: string[] = [];

  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);

    for (const specifier of relativeImportsOf(file)) {
      const resolved = resolve(file, specifier);
      if (!resolved) {
        unresolved.push(`${path.relative(repoRoot, file)} → ${specifier}`);
        continue;
      }
      queue.push(resolved);
    }
  }

  return { files: [...seen], unresolved };
}

describe('Vercel serverless bundle', () => {
  const { files, unresolved } = walkFromEntry();

  it('reaches the API routes from the entry point', () => {
    // Sanity check on the walker itself: if this ever went to zero, the
    // assertions below would pass vacuously and guard nothing.
    const relative = files.map((file) => path.relative(repoRoot, file));
    expect(relative).toContain('server/app.ts');
    expect(relative).toContain('server/routes.ts');
    expect(relative.length).toBeGreaterThan(3);
  });

  it('resolves every relative import in the graph', () => {
    expect(unresolved).toEqual([]);
  });

  it('contains no .tsx module, which the builder would silently drop', () => {
    const jsx = files
      .filter((file) => file.endsWith('.tsx'))
      .map((file) => path.relative(repoRoot, file));
    expect(jsx).toEqual([]);
  });
});
