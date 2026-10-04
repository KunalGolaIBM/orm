import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // Integration tests use real Db2 ODBC connections which can be slow
    testTimeout: 30_000,
    // All tests (unit + integration) are included; integration tests skip
    // automatically when DB2_DSN is not set via describe.skipIf()
    include: ['test/**/*.test.ts'],
    // Resolves IBM_DB_HOME → DYLD_LIBRARY_PATH / LD_LIBRARY_PATH before
    // any test file loads, so the ibm_db native addon finds libdb2.dylib.
    setupFiles: ['./test/integration/setup.ts'],
    // Load .env from this package's directory.
    // .env is gitignored — credentials never committed.
    // Set DB2_DSN (and IBM_DB_HOME on macOS) inside .env to run integration tests.
    env: (() => {
      try {
        // Node 20.6+ built-in env-file loading via synchronous fs read.
        // We parse it manually here so no external package is needed.
        const { readFileSync } = require('node:fs');
        const envPath = resolve(import.meta.dirname, '.env');
        const lines = readFileSync(envPath, 'utf-8').split('\n');
        const result: Record<string, string> = {};
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx === -1) continue;
          const key = trimmed.slice(0, eqIdx).trim();
          const val = trimmed.slice(eqIdx + 1).trim();
          result[key] = val;
        }
        return result;
      } catch {
        // .env absent — integration tests will skip via skipIfNoDb2()
        return {};
      }
    })(),
  },
});
