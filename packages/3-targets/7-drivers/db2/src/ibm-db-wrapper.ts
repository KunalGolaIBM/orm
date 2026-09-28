import { blindCast } from '@internal/utils/casts';
import { normalizeDb2Error } from './normalize-error';

export interface NativeDb2Database {
  query(sql: string, params?: readonly unknown[]): Promise<ReadonlyArray<Record<string, unknown>>>;
  execute(sql: string, params?: readonly unknown[]): Promise<{ count: number }>;
  close(): Promise<void>;
  beginTransaction(): Promise<void>;
  commitTransaction(): Promise<void>;
  rollbackTransaction(): Promise<void>;
}

export interface NativeIbmDbConnection {
  query(
    sql: string,
    params: readonly unknown[],
    cb: (err: unknown, result: unknown[]) => void,
  ): void;
  querySync?(sql: string, params?: readonly unknown[]): unknown[];
  prepare(sql: string, cb: (err: unknown, stmt: NativeIbmDbStatement) => void): void;
  beginTransaction(cb: (err: unknown) => void): void;
  commitTransaction(cb: (err: unknown) => void): void;
  rollbackTransaction(cb: (err: unknown) => void): void;
  close(cb: (err: unknown) => void): void;
}

export interface NativeIbmDbStatement {
  execute(params: readonly unknown[], cb: (err: unknown, result: NativeIbmDbResult) => void): void;
  close(cb?: (err: unknown) => void): void;
}

export interface NativeIbmDbResult {
  fetchAll(cb: (err: unknown, rows: ReadonlyArray<Record<string, unknown>>) => void): void;
  getAffectedRowsSync?(): number;
  closeSync?(): void;
}

export interface NativeIbmDbModule {
  open(connStr: string, cb: (err: unknown, conn: NativeIbmDbConnection) => void): void;
  openSync?(connStr: string): NativeIbmDbConnection;
  Pool?: new () => {
    open(connStr: string, cb: (err: unknown, conn: NativeIbmDbConnection) => void): void;
    close(cb: (err: unknown) => void): void;
  };
}

export class IbmDbClientWrapper implements NativeDb2Database {
  constructor(private readonly conn: NativeIbmDbConnection) {}

  async query(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<ReadonlyArray<Record<string, unknown>>> {
    return new Promise((resolve, reject) => {
      this.conn.query(sql, params, (err, result) => {
        if (err) {
          reject(normalizeDb2Error(err));
        } else {
          resolve(
            blindCast<ReadonlyArray<Record<string, unknown>>, 'Db2 query returns record rows'>(
              result || [],
            ),
          );
        }
      });
    });
  }

  async execute(sql: string, params: readonly unknown[] = []): Promise<{ count: number }> {
    return new Promise((resolve, reject) => {
      this.conn.prepare(sql, (err, stmt) => {
        if (err) {
          return reject(normalizeDb2Error(err));
        }
        stmt.execute(params, (execErr, result) => {
          if (execErr) {
            stmt.close?.();
            return reject(normalizeDb2Error(execErr));
          }
          let count = 0;
          if (result && typeof result.getAffectedRowsSync === 'function') {
            count = result.getAffectedRowsSync();
          }
          result.closeSync?.();
          stmt.close?.();
          resolve({ count });
        });
      });
    });
  }

  async beginTransaction(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.conn.beginTransaction((err) => {
        if (err) {
          reject(normalizeDb2Error(err));
        } else {
          resolve();
        }
      });
    });
  }

  async commitTransaction(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.conn.commitTransaction((err) => {
        if (err) {
          reject(normalizeDb2Error(err));
        } else {
          resolve();
        }
      });
    });
  }

  async rollbackTransaction(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.conn.rollbackTransaction((err) => {
        if (err) {
          reject(normalizeDb2Error(err));
        } else {
          resolve();
        }
      });
    });
  }

  async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.conn.close((err) => {
        if (err) {
          reject(normalizeDb2Error(err));
        } else {
          resolve();
        }
      });
    });
  }
}
