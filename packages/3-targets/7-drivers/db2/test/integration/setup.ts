/**
 * vitest setup: resolve IBM_DB_HOME to an absolute path and set
 * DYLD_LIBRARY_PATH so the ibm_db native addon finds libdb2.dylib on macOS.
 *
 * This file runs before every test file. It is a no-op when IBM_DB_HOME
 * is not set (i.e. when the .env is absent or the variable is missing).
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ibmDbHome = process.env['IBM_DB_HOME'];
if (ibmDbHome) {
  // Resolve relative paths against the package root (where vitest.config.ts lives)
  const absHome = ibmDbHome.startsWith('.')
    ? resolve(import.meta.dirname, '..', ibmDbHome)
    : ibmDbHome;

  const libDir = `${absHome}/lib`;

  if (existsSync(libDir)) {
    // macOS: DYLD_LIBRARY_PATH
    const existing = process.env['DYLD_LIBRARY_PATH'] ?? '';
    process.env['DYLD_LIBRARY_PATH'] = existing ? `${libDir}:${existing}` : libDir;

    // Linux: LD_LIBRARY_PATH
    const existingLd = process.env['LD_LIBRARY_PATH'] ?? '';
    process.env['LD_LIBRARY_PATH'] = existingLd ? `${libDir}:${existingLd}` : libDir;

    // Make IBM_DB_HOME absolute so the native installer can resolve it
    process.env['IBM_DB_HOME'] = absHome;
  }
}
