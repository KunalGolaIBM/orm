import type { RuntimeDriverInstance } from '@internal/framework-components/execution';
import type {
  SqlConnection,
  SqlDriver,
  SqlDriverState,
  SqlExecuteRequest,
  SqlExplainResult,
  SqlQueryable,
  SqlStatementStats,
  SqlTransaction,
} from '@internal/sql-relational-core/ast';
import { blindCast } from '@internal/utils/casts';
import type { IbmDbDatabase, IbmDbModule, IbmDbPool, IbmDbPoolOptions } from './ibm-db-wrapper';
import { normalizeDb2Error } from './normalize-error';

// ---------------------------------------------------------------------------
// Error helpers (mirroring SqliteDriver's driverError pattern)
// ---------------------------------------------------------------------------

interface DriverRuntimeError extends Error {
  readonly code: 'DRIVER.NOT_CONNECTED' | 'DRIVER.ALREADY_CONNECTED';
  readonly category: 'DRIVER';
  readonly severity: 'error';
  readonly details?: Record<string, unknown>;
}

function driverError(
  code: DriverRuntimeError['code'],
  message: string,
  details?: Record<string, unknown>,
): DriverRuntimeError {
  const base = new Error(message);
  Object.defineProperty(base, 'name', {
    value: 'RuntimeError',
    configurable: true,
  });
  return blindCast<DriverRuntimeError, 'Object.assign produces correct shape'>(
    Object.assign(base, {
      code,
      category: 'DRIVER' as const,
      severity: 'error' as const,
      message,
      details,
    }),
  );
}

const NOT_CONNECTED_MESSAGE =
  'Db2 driver not connected. Call connect(binding) before acquireConnection or execute.';
const ALREADY_CONNECTED_MESSAGE =
  'Db2 driver already connected. Call close() before reconnecting with a new binding.';

// ---------------------------------------------------------------------------
// Driver state machine
// ---------------------------------------------------------------------------

interface ConnectedState {
  readonly kind: 'connected';
  readonly connStr: string;
  readonly pool: IbmDbPool;
}

type DriverState = { readonly kind: 'unbound' } | ConnectedState | { readonly kind: 'closed' };

// ---------------------------------------------------------------------------
// Db2Binding
// ---------------------------------------------------------------------------

/**
 * Binding variants accepted by `Db2Driver.connect()`.
 *
 * - `connectionString`: production path — creates a real `ibm_db.Pool`.
 *   The `nativeModule` field must be the `ibm_db` package default export.
 *   This is kept optional so the driver can be instantiated and type-checked
 *   in environments without the native binary; callers must supply it at runtime.
 *
 * - `testPool`: unit-test path — injects a pre-built `IbmDbPool` mock so
 *   tests never touch the native module.
 */
export type Db2Binding =
  | {
      readonly kind: 'connectionString';
      readonly connectionString: string;
      readonly poolOptions?: IbmDbPoolOptions;
      /** The default export of the `ibm_db` package. Must be supplied at runtime. */
      readonly nativeModule: IbmDbModule;
    }
  | {
      readonly kind: 'testPool';
      readonly connStr: string;
      readonly pool: IbmDbPool;
    };

export type Db2RuntimeDriver = RuntimeDriverInstance<'sql', 'db2'> & SqlDriver<Db2Binding>;

// ---------------------------------------------------------------------------
// Db2Queryable — base class for Connection and Transaction
// ---------------------------------------------------------------------------

abstract class Db2Queryable implements SqlQueryable {
  protected abstract readonly db: IbmDbDatabase;

  async *query<Row = Record<string, unknown>>(request: SqlExecuteRequest): AsyncIterable<Row> {
    try {
      const rows = await this.db.query(request.sql, request.params);
      for (const row of rows) {
        yield blindCast<Row, 'ibm_db row matches requested schema'>(row);
      }
    } catch (error) {
      throw normalizeDb2Error(error);
    }
  }

  async execute(request: SqlExecuteRequest): Promise<SqlStatementStats> {
    let stmt: Awaited<ReturnType<IbmDbDatabase['prepare']>> | undefined;
    try {
      stmt = await this.db.prepare(request.sql);
      const result = await stmt.execute(request.params);
      const affectedRows = result.getAffectedRowsSync();
      await result.close();
      return { affectedRows };
    } catch (error) {
      throw normalizeDb2Error(error);
    } finally {
      if (stmt !== undefined) {
        await stmt.close().catch(() => undefined);
      }
    }
  }

  async explain(request: SqlExecuteRequest): Promise<SqlExplainResult> {
    try {
      const rows = await this.db.query(`EXPLAIN ALL FOR ${request.sql}`, request.params);
      return {
        rows: blindCast<ReadonlyArray<Record<string, unknown>>, 'explain result rows are records'>(
          rows,
        ),
      };
    } catch (error) {
      throw normalizeDb2Error(error);
    }
  }
}

// ---------------------------------------------------------------------------
// Db2Transaction
// ---------------------------------------------------------------------------

class Db2Transaction extends Db2Queryable implements SqlTransaction {
  protected readonly db: IbmDbDatabase;

  constructor(db: IbmDbDatabase) {
    super();
    this.db = db;
  }

  async commit(): Promise<void> {
    try {
      await this.db.commitTransaction();
    } catch (error) {
      throw normalizeDb2Error(error);
    }
  }

  async rollback(): Promise<void> {
    try {
      await this.db.rollbackTransaction();
    } catch (error) {
      throw normalizeDb2Error(error);
    }
  }
}

// ---------------------------------------------------------------------------
// Db2Connection
// ---------------------------------------------------------------------------

export class Db2Connection extends Db2Queryable implements SqlConnection {
  protected readonly db: IbmDbDatabase;

  constructor(db: IbmDbDatabase) {
    super();
    this.db = db;
  }

  async beginTransaction(): Promise<SqlTransaction> {
    try {
      await this.db.beginTransaction();
      return new Db2Transaction(this.db);
    } catch (error) {
      throw normalizeDb2Error(error);
    }
  }

  /**
   * Return the connection to the pool. Mirrors `SqliteConnectionImpl.release()`.
   */
  async release(): Promise<void> {
    try {
      await this.db.close();
    } catch (error) {
      throw normalizeDb2Error(error);
    }
  }

  /**
   * Forceful teardown — always attempts close, swallows errors.
   */
  async destroy(_reason?: unknown): Promise<void> {
    try {
      await this.db.close();
    } catch {
      // Destroy is advisory; swallow close errors.
    }
  }
}

// ---------------------------------------------------------------------------
// Db2Driver
// ---------------------------------------------------------------------------

export class Db2Driver implements Db2RuntimeDriver {
  readonly familyId = 'sql' as const;
  readonly targetId = 'db2' as const;

  #state: DriverState = { kind: 'unbound' };

  get state(): SqlDriverState {
    return this.#state.kind;
  }

  #requireConnected(): ConnectedState {
    if (this.#state.kind !== 'connected') {
      throw driverError('DRIVER.NOT_CONNECTED', NOT_CONNECTED_MESSAGE);
    }
    return this.#state;
  }

  async connect(binding: Db2Binding): Promise<void> {
    if (this.#state.kind === 'connected') {
      throw driverError('DRIVER.ALREADY_CONNECTED', ALREADY_CONNECTED_MESSAGE, {
        bindingKind: binding.kind,
      });
    }
    if (binding.kind === 'connectionString') {
      const pool = new binding.nativeModule.Pool(binding.poolOptions);
      this.#state = {
        kind: 'connected',
        connStr: binding.connectionString,
        pool,
      };
    } else {
      // binding.kind === 'testPool'
      this.#state = {
        kind: 'connected',
        connStr: binding.connStr,
        pool: binding.pool,
      };
    }
  }

  /**
   * Acquire an isolated connection from the pool.
   *
   * Each call to `acquireConnection()` opens (or reuses from pool) a distinct
   * `ibm_db.Database` object. Callers must call `connection.release()` when done.
   */
  async acquireConnection(): Promise<Db2Connection> {
    const { connStr, pool } = this.#requireConnected();
    try {
      const db = await pool.open(connStr);
      return new Db2Connection(db);
    } catch (error) {
      throw normalizeDb2Error(error);
    }
  }

  async close(): Promise<void> {
    if (this.#state.kind !== 'connected') return;
    const { pool } = this.#state;
    this.#state = { kind: 'closed' };
    try {
      await pool.close();
    } catch (error) {
      throw normalizeDb2Error(error);
    }
  }

  /**
   * Convenience query using a short-lived acquired connection.
   * Mirrors `SqliteDriver.query()` semantics.
   */
  async *query<Row = Record<string, unknown>>(request: SqlExecuteRequest): AsyncIterable<Row> {
    const conn = await this.acquireConnection();
    try {
      for await (const row of conn.query<Row>(request)) {
        yield row;
      }
    } finally {
      await conn.release().catch(() => undefined);
    }
  }

  async execute(request: SqlExecuteRequest): Promise<SqlStatementStats> {
    const conn = await this.acquireConnection();
    try {
      return await conn.execute(request);
    } finally {
      await conn.release().catch(() => undefined);
    }
  }

  async explain(request: SqlExecuteRequest): Promise<SqlExplainResult> {
    const conn = await this.acquireConnection();
    try {
      return await conn.explain(request);
    } finally {
      await conn.release().catch(() => undefined);
    }
  }
}
