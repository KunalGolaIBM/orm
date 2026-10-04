#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
/**
 * Test runner wrapper for @internal/driver-db2.
 *
 * 1. Reads `.env` from the package root.
 * 2. Derives DYLD_LIBRARY_PATH / LD_LIBRARY_PATH from IBM_DB_HOME and injects
 *    it into the child process environment before Vitest starts (setting
 *    process.env at runtime in setupFiles is too late — the dynamic linker
 *    reads DYLD_LIBRARY_PATH at process start, not mid-run).
 * 3. On macOS, patches the ibm_db native addon with install_name_tool if it
 *    still references the original build machine's absolute libdb2.dylib path.
 *    The ibm_db@4.0.1 binary shipped on npm embeds /Users/bjha/nodework/...
 *    as an LC_LOAD_DYLIB entry; DYLD_LIBRARY_PATH cannot override absolute
 *    paths, so we rewrite it to point at the local clidriver.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(__dirname, '..');

// ── 1. Parse .env ────────────────────────────────────────────────────────────
const envFile = resolve(pkgRoot, '.env');
/** @type {Record<string, string>} */
const dotenv = {};
if (existsSync(envFile)) {
  const lines = readFileSync(envFile, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    dotenv[key] = val;
  }
}

// ── 2. Build the env for the child process ───────────────────────────────────
const childEnv = { ...process.env, ...dotenv };

// Resolve IBM_DB_HOME to an absolute path (may be relative in .env)
const rawHome = childEnv['IBM_DB_HOME'];
if (rawHome) {
  const absHome = rawHome.startsWith('.') ? resolve(pkgRoot, rawHome) : rawHome;
  childEnv['IBM_DB_HOME'] = absHome;

  const libDir = resolve(absHome, 'lib');
  if (existsSync(libDir)) {
    // macOS
    const existingDyld = childEnv['DYLD_LIBRARY_PATH'] ?? '';
    childEnv['DYLD_LIBRARY_PATH'] = existingDyld ? `${libDir}:${existingDyld}` : libDir;

    // Linux
    const existingLd = childEnv['LD_LIBRARY_PATH'] ?? '';
    childEnv['LD_LIBRARY_PATH'] = existingLd ? `${libDir}:${existingLd}` : libDir;
  }
}

// ── 3. macOS: patch ibm_db native addon if it still has the build-machine path ──
// ibm_db@4.0.1 was compiled on /Users/bjha/... — that absolute LC_LOAD_DYLIB
// entry cannot be overridden by DYLD_LIBRARY_PATH; we must rewrite it once with
// install_name_tool.  We check first to avoid unnecessary writes.
if (process.platform === 'darwin') {
  const _ibmDbNodeModules = resolve(pkgRoot, '..', '..', '..', '..', 'node_modules', '.pnpm');
  // Find the addon via node resolution from pkgRoot
  const addonRelPath =
    'node_modules/.pnpm/ibm_db@4.0.1/node_modules/ibm_db/build/Release/odbc_bindings.node';
  // Walk up to find the monorepo root's node_modules
  let searchDir = pkgRoot;
  let addonPath = null;
  for (let i = 0; i < 8; i++) {
    const candidate = resolve(searchDir, addonRelPath);
    if (existsSync(candidate)) {
      addonPath = candidate;
      break;
    }
    const parent = resolve(searchDir, '..');
    if (parent === searchDir) break;
    searchDir = parent;
  }

  if (addonPath) {
    const otoolResult = spawnSync('otool', ['-L', addonPath], { encoding: 'utf-8' });
    const hardcodedPath = '/Users/bjha/nodework/clidriver/lib/libdb2.dylib';
    if (otoolResult.stdout?.includes(hardcodedPath)) {
      // Find local libdb2.dylib
      const libCandidates = [
        resolve(
          pkgRoot,
          'node_modules',
          '.pnpm',
          'ibm_db@4.0.1',
          'node_modules',
          'ibm_db',
          'installer',
          'clidriver',
          'lib',
          'libdb2.dylib',
        ),
      ];
      // Also search monorepo root
      let searchRoot = pkgRoot;
      for (let i = 0; i < 8; i++) {
        libCandidates.push(
          resolve(
            searchRoot,
            'node_modules',
            '.pnpm',
            'ibm_db@4.0.1',
            'node_modules',
            'ibm_db',
            'installer',
            'clidriver',
            'lib',
            'libdb2.dylib',
          ),
        );
        const parent = resolve(searchRoot, '..');
        if (parent === searchRoot) break;
        searchRoot = parent;
      }
      const localLib = libCandidates.find(existsSync);
      if (localLib) {
        const patchResult = spawnSync(
          'install_name_tool',
          ['-change', hardcodedPath, localLib, addonPath],
          { encoding: 'utf-8' },
        );
        if (patchResult.status === 0) {
          console.error(`[run-tests] patched ibm_db addon: ${hardcodedPath} → ${localLib}`);
        } else {
          console.error(
            `[run-tests] install_name_tool failed (status ${patchResult.status}): ${patchResult.stderr}`,
          );
        }
      }
    }
  }
}

// ── 4. Spawn vitest run ───────────────────────────────────────────────────────
// Walk up from pkgRoot to find node_modules/.bin/vitest
function findVitest(startDir) {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    const candidate = resolve(dir, 'node_modules', '.bin', 'vitest');
    if (existsSync(candidate)) return candidate;
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  return 'vitest'; // fallback: hope it's on PATH
}

const vitestBin = findVitest(pkgRoot);
const result = spawnSync(vitestBin, ['run', ...process.argv.slice(2)], {
  cwd: pkgRoot,
  env: childEnv,
  stdio: 'inherit',
  shell: false,
});

process.exitCode = result.status ?? 1;
