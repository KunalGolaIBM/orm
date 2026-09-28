import { blindCast } from '@internal/utils/casts';
import { describe, expect, it } from 'vitest';
import type { Db2ClientLike } from '../src/db2-driver';
import db2RuntimeDriverDescriptor from '../src/exports/runtime';
import type { NativeIbmDbConnection } from '../src/ibm-db-wrapper';

describe('@internal/driver-db2', () => {
  it('connects, queries, executes, and handles transactions cleanly', async () => {
    const memoryData: Array<{ ID: number; NAME: string }> = [
      { ID: 1, NAME: 'Alice' },
      { ID: 2, NAME: 'Bob' },
    ];

    let inTx = false;
    let committed = false;

    const mockClient: Db2ClientLike = {
      async query(_sql: string, params?: readonly unknown[]) {
        if (params && params.length > 0) {
          const id = Number(params[0]);
          return memoryData.filter((row) => row.ID === id);
        }
        return memoryData;
      },
      async execute(_sql: string, _params?: readonly unknown[]) {
        return { count: 1 };
      },
      async close() {},
      async beginTransaction() {
        inTx = true;
      },
      async commitTransaction() {
        committed = true;
        inTx = false;
      },
      async rollbackTransaction() {
        inTx = false;
      },
    };

    const driver = db2RuntimeDriverDescriptor.create();
    expect(driver.state()).toBe('unconnected');

    await driver.connect({ kind: 'client', client: mockClient });
    expect(driver.state()).toBe('connected');

    // Query test
    const results: Array<{ ID: number; NAME: string }> = [];
    for await (const row of driver.query<{ ID: number; NAME: string }>({
      sql: 'SELECT ID, NAME FROM USERS WHERE ID = ?',
      params: [1],
    })) {
      results.push(row);
    }
    expect(results).toEqual([{ ID: 1, NAME: 'Alice' }]);

    // Execute test
    const stats = await driver.execute({
      sql: 'UPDATE USERS SET NAME = ? WHERE ID = ?',
      params: ['Alice Updated', 1],
    });
    expect(stats.affectedRows).toBe(1);

    // Transaction test
    const tx = await driver.transaction();
    expect(inTx).toBe(true);
    await tx.commit();
    expect(committed).toBe(true);

    await driver.close();
    expect(driver.state()).toBe('unconnected');
  });

  it('operates against native ibm_db connection wrapper', async () => {
    let closed = false;
    let inTx = false;
    const mockNativeConn = {
      query(
        _sql: string,
        _params: readonly unknown[],
        cb: (err: unknown, result: unknown[]) => void,
      ) {
        cb(null, [{ C1: 'test', C2: 123 }]);
      },
      prepare(_sql: string, cb: (err: unknown, stmt: unknown) => void) {
        cb(null, {
          execute(_params: readonly unknown[], execCb: (err: unknown, result: unknown) => void) {
            execCb(null, {
              getAffectedRowsSync() {
                return 5;
              },
              closeSync() {},
            });
          },
          close(closeCb?: (err: unknown) => void) {
            closeCb?.(null);
          },
        });
      },
      beginTransaction(cb: (err: unknown) => void) {
        inTx = true;
        cb(null);
      },
      commitTransaction(cb: (err: unknown) => void) {
        inTx = false;
        cb(null);
      },
      rollbackTransaction(cb: (err: unknown) => void) {
        inTx = false;
        cb(null);
      },
      close(cb: (err: unknown) => void) {
        closed = true;
        cb(null);
      },
    };

    const driver = db2RuntimeDriverDescriptor.create();
    await driver.connect({
      kind: 'nativeConnection',
      connection: blindCast<NativeIbmDbConnection, 'Mock native connection'>(mockNativeConn),
    });
    expect(driver.state()).toBe('connected');

    const rows: Array<{ C1: string; C2: number }> = [];
    for await (const row of driver.query<{ C1: string; C2: number }>({
      sql: 'SELECT C1, C2 FROM TAB',
    })) {
      rows.push(row);
    }
    expect(rows).toEqual([{ C1: 'test', C2: 123 }]);

    const stats = await driver.execute({ sql: 'DELETE FROM TAB' });
    expect(stats.affectedRows).toBe(5);

    const tx = await driver.transaction();
    expect(inTx).toBe(true);
    await tx.commit();
    expect(inTx).toBe(false);

    await driver.close();
    expect(closed).toBe(true);
    expect(driver.state()).toBe('unconnected');
  });

  it('normalizes Db2 SQLSTATE errors and connection errors', async () => {
    const errorClient: Db2ClientLike = {
      async query() {
        const err = Object.assign(new Error('Unique constraint violation'), {
          sqlState: '23505',
          sqlcode: -803,
        });
        throw err;
      },
      async execute() {
        const err = Object.assign(new Error('Communication error: connection reset'), {
          sqlState: '08001',
          sqlcode: -30082,
        });
        throw err;
      },
      async close() {},
    };

    const driver = db2RuntimeDriverDescriptor.create();
    await driver.connect({ kind: 'client', client: errorClient });

    await expect(async () => {
      for await (const row of driver.query({ sql: 'SELECT 1' })) {
        void row;
      }
    }).rejects.toThrow('Unique constraint violation');

    await expect(async () => {
      await driver.execute({ sql: 'INSERT INTO T VALUES (1)' });
    }).rejects.toThrow('Communication error');
  });
});
