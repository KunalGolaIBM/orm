/**
 * Integration test helpers for @internal/driver-db2.
 *
 * Tests are guarded by the DB2_DSN environment variable.
 * Format: DATABASE=sample;HOSTNAME=host;PORT=50000;PROTOCOL=TCPIP;UID=user;PWD=pass
 *
 * Set DB2_DSN before running to execute against a live Db2 LUW instance.
 * Without it all integration tests are skipped automatically.
 */

import { type Db2Connection, Db2Driver } from '../../src/db2-driver';
import type { IbmDbModule } from '../../src/ibm-db-wrapper';

// ---------------------------------------------------------------------------
// Environment / skip guard
// ---------------------------------------------------------------------------

const DB2_DSN = process.env['DB2_DSN'];

/**
 * Returns `true` when the Db2 DSN is absent — causes `describe.skipIf` to skip.
 */
export function skipIfNoDb2(): boolean {
  return !DB2_DSN;
}

/**
 * Returns the DB2_DSN string, throwing if it is not set.
 * Call only inside `describe.skipIf(skipIfNoDb2())` blocks.
 */
export function getDb2Dsn(): string {
  if (!DB2_DSN) {
    throw new Error('DB2_DSN not set — integration tests require a live Db2 LUW instance');
  }
  return DB2_DSN;
}

// ---------------------------------------------------------------------------
// Driver lifecycle helpers
// ---------------------------------------------------------------------------

/**
 * Create and connect a `Db2Driver` using the real `ibm_db` module.
 * The caller is responsible for calling `driver.close()` in `afterAll`.
 */
export async function createConnectedDriver(): Promise<Db2Driver> {
  // ibm_db exports Pool on its default export as well as top-level.
  // Cast to IbmDbModule (our minimal interface) to satisfy Db2Driver.connect().
  const ibmdbModule = (await import('ibm_db')) as unknown as IbmDbModule;
  const driver = new Db2Driver();
  await driver.connect({
    kind: 'connectionString',
    connectionString: getDb2Dsn(),
    nativeModule: ibmdbModule,
  });
  return driver;
}

/**
 * Acquire a single connection from a connected driver.
 * Always release in `afterEach` / `afterAll`.
 */
export async function acquireConnection(driver: Db2Driver): Promise<Db2Connection> {
  return driver.acquireConnection();
}

// ---------------------------------------------------------------------------
// Table helpers
// ---------------------------------------------------------------------------

/**
 * Execute a DDL statement on the given connection, swallowing "table not found"
 * errors (SQLSTATE 42704 / 42S02) so DROP TABLE IF NOT EXISTS semantics work.
 *
 * Uses conn.execute() (prepare + executeNonQuery path) which is the correct
 * ibm_db path for DDL — conn.query() is for SELECT and returns rows.
 */
export async function executeDdl(conn: Db2Connection, ddl: string): Promise<void> {
  try {
    await conn.execute({ sql: ddl });
  } catch (err: unknown) {
    // Check both the raw ibm_db error object (before normalisation) and the
    // normalised Error message for the "object not defined" SQLSTATE.
    const raw = err as { sqlstate?: string; message?: string };
    const sqlstate = raw.sqlstate ?? '';
    const msg = raw.message ?? '';
    // 42704 = undefined object (DROP TABLE on non-existent table)
    if (sqlstate === '42704' || sqlstate === '42S02' || msg.includes('42704')) {
      return;
    }
    throw err;
  }
}

/** Drain an async iterable — used inside integration tests for SELECT queries. */
export async function exhaust<T>(iter: AsyncIterable<T>): Promise<void> {
  for await (const _ of iter) {
    // drain
  }
}

/**
 * Create a test table, dropping it first if it already exists.
 */
export async function createTestTable(
  conn: Db2Connection,
  ddl: string,
  tableName: string,
): Promise<void> {
  await executeDdl(conn, `DROP TABLE ${tableName}`);
  await exhaust(conn.query({ sql: ddl }));
}

/**
 * Drop a test table, swallowing not-found errors.
 */
export async function dropTestTable(conn: Db2Connection, tableName: string): Promise<void> {
  await executeDdl(conn, `DROP TABLE ${tableName}`);
}
