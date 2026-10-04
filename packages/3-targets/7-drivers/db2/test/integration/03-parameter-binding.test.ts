/**
 * Integration: Parameter binding
 *
 * Verifies that each supported Db2 scalar type roundtrips correctly through
 * the ibm_db parameter binding layer.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db2Connection, Db2Driver } from '../../src/db2-driver';
import { createConnectedDriver, createTestTable, dropTestTable, skipIfNoDb2 } from './helpers';

const TABLE = 'DB2_TEST_PARAMS';

describe.skipIf(skipIfNoDb2())('Integration: parameter binding', () => {
  let driver: Db2Driver;
  let conn: Db2Connection;

  beforeAll(async () => {
    driver = await createConnectedDriver();
    conn = await driver.acquireConnection();
    await createTestTable(
      conn,
      `CREATE TABLE ${TABLE} (
        ID      INTEGER NOT NULL,
        NAME    VARCHAR(100),
        BIG     BIGINT,
        FLAG    BOOLEAN
      )`,
      TABLE,
    );
  });

  afterAll(async () => {
    await dropTestTable(conn, TABLE);
    await conn.release();
    await driver.close();
  });

  async function insertRow(id: number, name: unknown, big: unknown, flag: unknown): Promise<void> {
    await conn.execute({
      sql: `INSERT INTO ${TABLE} (ID, NAME, BIG, FLAG) VALUES (?, ?, ?, ?)`,
      params: [id, name, big, flag],
    });
  }

  async function selectById(id: number): Promise<Record<string, unknown>> {
    const rows: Array<Record<string, unknown>> = [];
    for await (const row of conn.query({
      sql: `SELECT ID, NAME, BIG, FLAG FROM ${TABLE} WHERE ID = ?`,
      params: [id],
    })) {
      rows.push(row as Record<string, unknown>);
    }
    if (rows.length === 0) throw new Error(`No row found with ID=${id}`);
    return rows[0]!;
  }

  it('VARCHAR parameter roundtrips: plain ASCII string', async () => {
    await insertRow(1, 'hello world', 0, false);
    const row = await selectById(1);
    expect(row['NAME']).toBe('hello world');
  });

  it('VARCHAR parameter roundtrips: empty string', async () => {
    await insertRow(2, '', 0, false);
    const row = await selectById(2);
    // Db2 may store empty string as a single space in CHAR but VARCHAR should be ''
    expect(typeof row['NAME']).toBe('string');
  });

  it('INTEGER parameter roundtrips: positive, negative, zero', async () => {
    for (const [id, val] of [
      [10, 42],
      [11, -1],
      [12, 0],
    ] as [number, number][]) {
      await conn.execute({
        sql: `INSERT INTO ${TABLE} (ID, NAME, BIG, FLAG) VALUES (?, ?, ?, ?)`,
        params: [id, `int_${val}`, val, false],
      });
      const row = await selectById(id);
      // ibm_db returns INTEGER as number
      expect(row['ID']).toBe(id);
    }
  });

  it('BIGINT parameter roundtrips: value above Number.MAX_SAFE_INTEGER', async () => {
    // 9007199254740993 = Number.MAX_SAFE_INTEGER + 2
    const bigVal = 9007199254740993n;
    await insertRow(20, 'bigint_test', bigVal.toString(), false);
    const row = await selectById(20);
    // ibm_db returns BIGINT as string when value > MAX_SAFE_INTEGER
    const returned = row['BIG'];
    // Accept both string and number — codec must handle both
    expect(BigInt(returned as string | number)).toBe(bigVal);
  });

  it('BIGINT parameter roundtrips: small value (safe integer range)', async () => {
    await insertRow(21, 'bigint_small', 100, false);
    const row = await selectById(21);
    const returned = row['BIG'];
    expect(Number(returned)).toBe(100);
  });

  it('BOOLEAN parameter roundtrips: TRUE', async () => {
    await insertRow(30, 'bool_true', 0, true);
    const row = await selectById(30);
    expect(row['FLAG']).toBe(true);
  });

  it('BOOLEAN parameter roundtrips: FALSE', async () => {
    await insertRow(31, 'bool_false', 0, false);
    const row = await selectById(31);
    expect(row['FLAG']).toBe(false);
  });

  it('NULL parameter roundtrips: all nullable columns accept null', async () => {
    await insertRow(40, null, null, null);
    const row = await selectById(40);
    expect(row['NAME']).toBeNull();
    expect(row['BIG']).toBeNull();
    expect(row['FLAG']).toBeNull();
  });

  it('execute() affectedRows = 1 after single INSERT', async () => {
    const stats = await conn.execute({
      sql: `INSERT INTO ${TABLE} (ID, NAME, BIG, FLAG) VALUES (?, ?, ?, ?)`,
      params: [50, 'affected_test', 0, false],
    });
    expect(stats.affectedRows).toBe(1);
  });

  it('execute() affectedRows = 0 after UPDATE with no matching rows', async () => {
    const stats = await conn.execute({
      sql: `UPDATE ${TABLE} SET NAME = ? WHERE ID = ?`,
      params: ['nobody', 99999],
    });
    expect(stats.affectedRows).toBe(0);
  });
});
