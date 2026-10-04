/**
 * ibm-db-wrapper.ts
 *
 * Thin type bridge to the real `ibm_db` Database and Pool APIs.
 * `ibm_db` already ships Promise-based overloads — we do not wrap them.
 *
 * All interfaces below are derived from `node-ibm_db/typescript/`:
 *   - Database.ts
 *   - Pool.ts
 *   - PoolOptions.ts
 *   - ODBCStatement.ts
 *   - ODBCResult.ts
 *
 * Prisma integration uses the Promise form throughout (no callback overloads).
 */

/**
 * Minimal interface matching `ibm_db.Database` methods needed by the driver.
 *
 * We define this locally rather than importing `ibm_db` directly so the
 * package compiles on machines where the native binary is not installed
 * (e.g. in CI, on unsupported platforms). At runtime, the concrete
 * `ibm_db.Database` instance satisfies this interface structurally.
 */
export interface IbmDbDatabase {
  /**
   * Execute a SQL query and return all result rows.
   * Returns `Promise<SQLResults>` where `SQLResults = readonly Record<string,unknown>[]`.
   * For DML (INSERT/UPDATE/DELETE), returns an empty array — use `prepare`+`execute` for counts.
   */
  query(sql: string, params?: readonly unknown[]): Promise<ReadonlyArray<Record<string, unknown>>>;

  /**
   * Compile a SQL statement into an `ODBCStatement` for repeated execution
   * or for retrieving affected-row counts.
   */
  prepare(sql: string): Promise<IbmDbStatement>;

  /** Disable auto-commit and begin a transaction on this connection. */
  beginTransaction(): Promise<true>;

  /** Commit the current transaction and re-enable auto-commit. */
  commitTransaction(): Promise<void>;

  /** Roll back the current transaction and re-enable auto-commit. */
  rollbackTransaction(): Promise<void>;

  /**
   * Return this connection to the pool (if pooled) or close the physical TCP
   * connection. Always call this when done with a connection.
   */
  close(): Promise<true>;
}

/**
 * Minimal interface matching `ibm_db.ODBCStatement`.
 */
export interface IbmDbStatement {
  /**
   * Execute the prepared statement with the supplied parameters and return
   * an `ODBCResult` from which row data and affected-row counts can be read.
   */
  execute(params?: readonly unknown[]): Promise<IbmDbResult>;

  /** Release the statement handle. Always call in a `finally` block. */
  close(): Promise<false>;
}

/**
 * Minimal interface matching `ibm_db.ODBCResult`.
 */
export interface IbmDbResult {
  /**
   * Returns the number of rows affected by the last DML statement.
   * Synchronous for efficiency; always available after a successful `execute`.
   */
  getAffectedRowsSync(): number;

  /** Close the result set and release the associated cursor. */
  close(): Promise<void>;
}

/**
 * Options accepted by `ibm_db.Pool`.
 * Mirrors `node-ibm_db/typescript/PoolOptions.ts`.
 */
export interface IbmDbPoolOptions {
  /** Maximum number of physical connections in the pool. */
  maxPoolSize?: number;
  /** Milliseconds before an idle connection is automatically closed. */
  idleTimeout?: number;
  /** Auto-close idle connections when `idleTimeout` elapses. */
  autoCleanIdle?: boolean;
  /** Milliseconds to wait when establishing a new connection. */
  connectTimeout?: number;
}

/**
 * Minimal interface matching `ibm_db.Pool`.
 */
export interface IbmDbPool {
  /**
   * Acquire a `Database` from the pool (or open a new connection if the pool
   * has capacity). The returned `Database.close()` returns it to the pool.
   */
  open(connStr: string): Promise<IbmDbDatabase>;

  /** Drain all connections from the pool and shut it down. */
  close(): Promise<true>;
}

/**
 * The subset of the `ibm_db` module surface used by `Db2Driver.connect()`.
 *
 * At runtime this is the default export from the `ibm_db` package.
 * In unit tests a plain object satisfying this interface can be injected.
 */
export interface IbmDbModule {
  /**
   * Construct a new connection pool.
   */
  Pool: new (
    options?: IbmDbPoolOptions,
  ) => IbmDbPool;
}
