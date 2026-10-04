/**
 * Integration: Connection lifecycle
 *
 * Verifies that the driver can open a real connection to IBM Db2 LUW,
 * execute the canonical liveness query, and manage driver state transitions.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db2Driver } from '../../src/db2-driver';
import { acquireConnection, createConnectedDriver, getDb2Dsn, skipIfNoDb2 } from './helpers';

describe.skipIf(skipIfNoDb2())('Integration: connect lifecycle', () => {
  let driver: Db2Driver;

  beforeAll(async () => {
    driver = await createConnectedDriver();
  });

  afterAll(async () => {
    await driver.close();
  });

  it('driver reaches connected state after connect()', () => {
    expect(driver.state).toBe('connected');
  });

  it('SELECT 1 FROM sysibm.sysdummy1 returns one row with value 1', async () => {
    const rows: Array<Record<string, unknown>> = [];
    for await (const row of driver.query({ sql: 'SELECT 1 AS V FROM sysibm.sysdummy1' })) {
      rows.push(row as Record<string, unknown>);
    }
    expect(rows).toHaveLength(1);
    // ibm_db returns column names in uppercase; value is number 1
    expect(rows[0]!['V']).toBe(1);
  });

  it('driver state is closed after close()', async () => {
    const localDriver = await createConnectedDriver();
    expect(localDriver.state).toBe('connected');
    await localDriver.close();
    expect(localDriver.state).toBe('closed');
  });

  it('double connect() throws DRIVER.ALREADY_CONNECTED', async () => {
    const ibmdb = await import('ibm_db');
    await expect(
      driver.connect({
        kind: 'connectionString',
        connectionString: getDb2Dsn(),
        nativeModule: ibmdb.default as Parameters<Db2Driver['connect']>[0] extends {
          kind: 'connectionString';
          nativeModule: infer M;
        }
          ? M
          : never,
      }),
    ).rejects.toMatchObject({ code: 'DRIVER.ALREADY_CONNECTED' });
  });

  it('query after close() throws DRIVER.NOT_CONNECTED', async () => {
    const closedDriver = await createConnectedDriver();
    await closedDriver.close();
    await expect(async () => {
      for await (const _ of closedDriver.query({ sql: 'SELECT 1 FROM sysibm.sysdummy1' })) {
        // should not reach here
      }
    }).rejects.toMatchObject({ code: 'DRIVER.NOT_CONNECTED' });
  });

  it('acquireConnection() returns a usable connection', async () => {
    const conn = await acquireConnection(driver);
    try {
      const rows: Array<Record<string, unknown>> = [];
      for await (const row of conn.query({ sql: 'SELECT 1 AS V FROM sysibm.sysdummy1' })) {
        rows.push(row as Record<string, unknown>);
      }
      expect(rows[0]!['V']).toBe(1);
    } finally {
      await conn.release();
    }
  });
});
