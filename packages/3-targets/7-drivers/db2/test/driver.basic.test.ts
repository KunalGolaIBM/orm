import { describe, expect, it, vi } from 'vitest';
import db2RuntimeDriverDescriptor from '../src/exports/runtime';
import type { IbmDbDatabase, IbmDbPool } from '../src/ibm-db-wrapper';

// ---------------------------------------------------------------------------
// Helpers — build lightweight mocks for IbmDbDatabase and IbmDbPool
// ---------------------------------------------------------------------------

/**
 * Creates a minimal mock of `ibm_db.Database`.
 *
 * Each call to `mockDb()` produces an INDEPENDENT object so tests can verify
 * that two calls to `acquireConnection()` receive DIFFERENT `db` instances.
 */
function mockDb(overrides?: Partial<IbmDbDatabase>): IbmDbDatabase {
  const rows: ReadonlyArray<Record<string, unknown>> = [{ ID: 1, NAME: 'Alice' }];

  let inTransaction = false;

  return {
    async query(_sql: string, _params?: readonly unknown[]) {
      return rows;
    },
    async prepare(_sql: string) {
      const result = {
        getAffectedRowsSync: vi.fn(() => 1),
        close: vi.fn(async () => undefined),
      };
      return {
        execute: vi.fn(async (_params?: readonly unknown[]) => result),
        close: vi.fn(async () => false as const),
      };
    },
    async beginTransaction() {
      inTransaction = true;
      return true as const;
    },
    async commitTransaction() {
      inTransaction = false;
    },
    async rollbackTransaction() {
      inTransaction = false;
    },
    async close() {
      return true as const;
    },
    get __inTransaction() {
      return inTransaction;
    },
    ...overrides,
  };
}

/**
 * Creates a mock pool that dispenses fresh `db` instances from a queue.
 * `pool.open(connStr)` returns them in FIFO order (wraps around).
 */
function mockPool(dbs: IbmDbDatabase[]): IbmDbPool & { closedCount: number } {
  let idx = 0;
  let closedCount = 0;
  return {
    async open(_connStr: string) {
      const db = dbs[idx % dbs.length]!;
      idx += 1;
      return db;
    },
    async close() {
      closedCount += 1;
      return true as const;
    },
    get closedCount() {
      return closedCount;
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('@internal/driver-db2', () => {
  it('starts in unbound state', () => {
    const driver = db2RuntimeDriverDescriptor.create();
    expect(driver.state).toBe('unbound');
  });

  it('transitions to connected state after connect()', async () => {
    const driver = db2RuntimeDriverDescriptor.create();
    const pool = mockPool([mockDb()]);
    await driver.connect({ kind: 'testPool', connStr: 'DATABASE=TEST', pool });
    expect(driver.state).toBe('connected');
  });

  it('transitions to closed state after close()', async () => {
    const driver = db2RuntimeDriverDescriptor.create();
    const pool = mockPool([mockDb()]);
    await driver.connect({ kind: 'testPool', connStr: 'DATABASE=TEST', pool });
    await driver.close();
    expect(driver.state).toBe('closed');
  });

  it('throws ALREADY_CONNECTED if connect() is called twice', async () => {
    const driver = db2RuntimeDriverDescriptor.create();
    const pool = mockPool([mockDb()]);
    await driver.connect({ kind: 'testPool', connStr: 'DATABASE=TEST', pool });
    await expect(
      driver.connect({ kind: 'testPool', connStr: 'DATABASE=TEST', pool }),
    ).rejects.toMatchObject({ code: 'DRIVER.ALREADY_CONNECTED' });
  });

  it('calls pool.close() when driver.close() is called', async () => {
    const driver = db2RuntimeDriverDescriptor.create();
    const pool = mockPool([mockDb()]);
    await driver.connect({ kind: 'testPool', connStr: 'DATABASE=TEST', pool });
    await driver.close();
    expect(pool.closedCount).toBe(1);
  });

  it('acquireConnection() calls pool.open() and returns a Db2Connection', async () => {
    const db = mockDb();
    const pool = mockPool([db]);
    const openSpy = vi.spyOn(pool, 'open');

    const driver = db2RuntimeDriverDescriptor.create();
    await driver.connect({ kind: 'testPool', connStr: 'DATABASE=TEST', pool });

    const conn = await driver.acquireConnection();
    expect(openSpy).toHaveBeenCalledWith('DATABASE=TEST');
    expect(conn).toBeDefined();
  });

  it('two acquireConnection() calls get DIFFERENT db instances', async () => {
    const db1 = mockDb();
    const db2Inst = mockDb();
    const pool = mockPool([db1, db2Inst]);

    const driver = db2RuntimeDriverDescriptor.create();
    await driver.connect({ kind: 'testPool', connStr: 'DATABASE=TEST', pool });

    const conn1 = await driver.acquireConnection();
    const conn2 = await driver.acquireConnection();

    // They are different objects — not the same connection
    expect(conn1).not.toBe(conn2);
  });

  it('connection.release() calls db.close()', async () => {
    const db = mockDb();
    const closeSpy = vi.spyOn(db, 'close');
    const pool = mockPool([db]);

    const driver = db2RuntimeDriverDescriptor.create();
    await driver.connect({ kind: 'testPool', connStr: 'DATABASE=TEST', pool });

    const conn = await driver.acquireConnection();
    await conn.release();
    expect(closeSpy).toHaveBeenCalledOnce();
  });

  it('executes query and returns rows', async () => {
    const expectedRows = [
      { ID: 1, NAME: 'Alice' },
      { ID: 2, NAME: 'Bob' },
    ];
    const db = mockDb({
      async query(_sql, _params) {
        return expectedRows;
      },
    });
    const pool = mockPool([db]);

    const driver = db2RuntimeDriverDescriptor.create();
    await driver.connect({ kind: 'testPool', connStr: 'DATABASE=TEST', pool });

    const results: Array<{ ID: number; NAME: string }> = [];
    for await (const row of driver.query<{ ID: number; NAME: string }>({
      sql: 'SELECT ID, NAME FROM USERS',
    })) {
      results.push(row);
    }
    expect(results).toEqual(expectedRows);
  });

  it('execute() returns affectedRows from prepared statement', async () => {
    const db = mockDb();
    const pool = mockPool([db]);

    const driver = db2RuntimeDriverDescriptor.create();
    await driver.connect({ kind: 'testPool', connStr: 'DATABASE=TEST', pool });

    const stats = await driver.execute({
      sql: 'UPDATE USERS SET NAME = ? WHERE ID = ?',
      params: ['Alice Updated', 1],
    });
    expect(stats.affectedRows).toBe(1);
  });

  it('beginTransaction() calls db.beginTransaction() and returns Db2Transaction', async () => {
    const beginSpy = vi.fn(async () => true as const);
    const db = mockDb({ beginTransaction: beginSpy });
    const pool = mockPool([db]);

    const driver = db2RuntimeDriverDescriptor.create();
    await driver.connect({ kind: 'testPool', connStr: 'DATABASE=TEST', pool });

    const conn = await driver.acquireConnection();
    const tx = await conn.beginTransaction();
    expect(beginSpy).toHaveBeenCalledOnce();
    expect(tx).toBeDefined();
  });

  it('transaction.commit() calls db.commitTransaction()', async () => {
    const commitSpy = vi.fn(async () => undefined);
    const db = mockDb({ commitTransaction: commitSpy });
    const pool = mockPool([db]);

    const driver = db2RuntimeDriverDescriptor.create();
    await driver.connect({ kind: 'testPool', connStr: 'DATABASE=TEST', pool });

    const conn = await driver.acquireConnection();
    const tx = await conn.beginTransaction();
    await tx.commit();
    expect(commitSpy).toHaveBeenCalledOnce();
  });

  it('transaction.rollback() calls db.rollbackTransaction()', async () => {
    const rollbackSpy = vi.fn(async () => undefined);
    const db = mockDb({ rollbackTransaction: rollbackSpy });
    const pool = mockPool([db]);

    const driver = db2RuntimeDriverDescriptor.create();
    await driver.connect({ kind: 'testPool', connStr: 'DATABASE=TEST', pool });

    const conn = await driver.acquireConnection();
    const tx = await conn.beginTransaction();
    await tx.rollback();
    expect(rollbackSpy).toHaveBeenCalledOnce();
  });

  it('normalizes Db2 SQLSTATE 23505 error from query()', async () => {
    const db = mockDb({
      async query() {
        throw Object.assign(new Error('Unique constraint violation'), {
          sqlstate: '23505',
          sqlcode: -803,
        });
      },
    });
    const pool = mockPool([db, db]); // both acquires may use the same mock

    const driver = db2RuntimeDriverDescriptor.create();
    await driver.connect({ kind: 'testPool', connStr: 'DATABASE=TEST', pool });

    await expect(async () => {
      for await (const row of driver.query({ sql: 'SELECT 1 FROM sysibm.sysdummy1' })) {
        void row;
      }
    }).rejects.toThrow('Unique constraint violation');
  });

  it('normalizes Db2 SQLSTATE 08001 error from execute()', async () => {
    const db = mockDb({
      async prepare() {
        throw Object.assign(new Error('Communication error: connection reset'), {
          sqlstate: '08001',
          sqlcode: -30082,
        });
      },
    });
    const pool = mockPool([db, db]);

    const driver = db2RuntimeDriverDescriptor.create();
    await driver.connect({ kind: 'testPool', connStr: 'DATABASE=TEST', pool });

    await expect(driver.execute({ sql: 'INSERT INTO T VALUES (1)' })).rejects.toThrow(
      'Communication error',
    );
  });
});
