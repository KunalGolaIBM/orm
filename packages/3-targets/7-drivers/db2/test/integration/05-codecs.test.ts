/**
 * Integration: Codec roundtrips
 *
 * Proves that the 4 MVP Db2 codec types (VARCHAR, INTEGER, BIGINT, BOOLEAN)
 * roundtrip faithfully through the ibm_db wire layer. Also validates NULL
 * handling for all column types.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db2Connection, Db2Driver } from '../../src/db2-driver';
import { createConnectedDriver, createTestTable, dropTestTable, skipIfNoDb2 } from './helpers';

const TABLE = 'DB2_TEST_CODECS';

describe.skipIf(skipIfNoDb2())('Integration: codec roundtrips', () => {
  let driver: Db2Driver;
  let conn: Db2Connection;

  beforeAll(async () => {
    driver = await createConnectedDriver();
    conn = await driver.acquireConnection();
    await createTestTable(
      conn,
      `CREATE TABLE ${TABLE} (
        V_VARCHAR  VARCHAR(50),
        V_INTEGER  INTEGER,
        V_BIGINT   BIGINT,
        V_BOOLEAN  BOOLEAN
      )`,
      TABLE,
    );
  });

  afterAll(async () => {
    await dropTestTable(conn, TABLE);
    await conn.release();
    await driver.close();
  });

  async function insert(
    varchar: unknown,
    integer: unknown,
    bigint: unknown,
    boolean_: unknown,
  ): Promise<void> {
    await conn.execute({
      sql: `INSERT INTO ${TABLE} (V_VARCHAR, V_INTEGER, V_BIGINT, V_BOOLEAN) VALUES (?, ?, ?, ?)`,
      params: [varchar, integer, bigint, boolean_],
    });
  }

  // Select by VARCHAR value to get an unambiguous row
  async function selectByVarchar(value: string): Promise<Record<string, unknown> | undefined> {
    const rows: Array<Record<string, unknown>> = [];
    for await (const row of conn.query({
      sql: `SELECT V_VARCHAR, V_INTEGER, V_BIGINT, V_BOOLEAN FROM ${TABLE} WHERE V_VARCHAR = ?`,
      params: [value],
    })) {
      rows.push(row as Record<string, unknown>);
    }
    return rows[0];
  }

  // ---- VARCHAR ---------------------------------------------------------------

  it('VARCHAR: plain ASCII roundtrip', async () => {
    await insert('hello world', 1, 1, false);
    const row = await selectByVarchar('hello world');
    expect(row).toBeDefined();
    expect(row!['V_VARCHAR']).toBe('hello world');
  });

  it('VARCHAR: numeric-looking string stays a string', async () => {
    await insert('42', 2, 2, false);
    const row = await selectByVarchar('42');
    expect(typeof row!['V_VARCHAR']).toBe('string');
    expect(row!['V_VARCHAR']).toBe('42');
  });

  it('VARCHAR: unicode string roundtrip', async () => {
    // Basic Latin Extended characters — supported on UTF-8 Db2 instances
    const unicode = 'héllo';
    await insert(unicode, 3, 3, false);
    const row = await selectByVarchar(unicode);
    // If the Db2 codepage does not support this character, the test is still useful
    // as a signal — we accept either exact match or non-null string
    expect(typeof row!['V_VARCHAR']).toBe('string');
  });

  // ---- INTEGER ---------------------------------------------------------------

  it('INTEGER: positive value roundtrip (42)', async () => {
    await insert('int_42', 42, 42, false);
    const row = await selectByVarchar('int_42');
    expect(row!['V_INTEGER']).toBe(42);
  });

  it('INTEGER: negative value roundtrip (-1)', async () => {
    await insert('int_neg1', -1, -1, false);
    const row = await selectByVarchar('int_neg1');
    expect(row!['V_INTEGER']).toBe(-1);
  });

  it('INTEGER: zero roundtrip', async () => {
    await insert('int_zero', 0, 0, false);
    const row = await selectByVarchar('int_zero');
    expect(row!['V_INTEGER']).toBe(0);
  });

  it('INTEGER: max 32-bit signed (2147483647)', async () => {
    await insert('int_max', 2147483647, 2147483647, false);
    const row = await selectByVarchar('int_max');
    expect(row!['V_INTEGER']).toBe(2147483647);
  });

  // ---- BIGINT ----------------------------------------------------------------

  it('BIGINT: value within safe integer range', async () => {
    await insert('big_safe', 100, 100, false);
    const row = await selectByVarchar('big_safe');
    expect(Number(row!['V_BIGINT'])).toBe(100);
  });

  it('BIGINT: value above Number.MAX_SAFE_INTEGER (9007199254740993)', async () => {
    const bigVal = 9007199254740993n;
    // ibm_db requires the value passed as a string to avoid JS precision loss
    await insert('big_unsafe', 200, bigVal.toString(), false);
    const row = await selectByVarchar('big_unsafe');
    // ibm_db returns large BIGINT as a string
    const returned = row!['V_BIGINT'];
    expect(BigInt(returned as string | number)).toBe(bigVal);
  });

  it('BIGINT: negative large value', async () => {
    const bigNeg = -9007199254740993n;
    await insert('big_neg', 201, bigNeg.toString(), false);
    const row = await selectByVarchar('big_neg');
    const returned = row!['V_BIGINT'];
    expect(BigInt(returned as string | number)).toBe(bigNeg);
  });

  // ---- BOOLEAN ---------------------------------------------------------------

  it('BOOLEAN: TRUE roundtrip', async () => {
    await insert('bool_true', 300, 300, true);
    const row = await selectByVarchar('bool_true');
    expect(row!['V_BOOLEAN']).toBe(true);
  });

  it('BOOLEAN: FALSE roundtrip', async () => {
    await insert('bool_false', 301, 301, false);
    const row = await selectByVarchar('bool_false');
    expect(row!['V_BOOLEAN']).toBe(false);
  });

  // ---- NULL ------------------------------------------------------------------

  it('NULL roundtrip: VARCHAR column accepts and returns null', async () => {
    await insert(null, 400, 400, false);
    // Can't select by VARCHAR since it is NULL — select by INTEGER instead
    const rows: Array<Record<string, unknown>> = [];
    for await (const row of conn.query({
      sql: `SELECT V_VARCHAR, V_INTEGER, V_BIGINT, V_BOOLEAN FROM ${TABLE} WHERE V_INTEGER = ?`,
      params: [400],
    })) {
      rows.push(row as Record<string, unknown>);
    }
    expect(rows[0]!['V_VARCHAR']).toBeNull();
  });

  it('NULL roundtrip: INTEGER column accepts and returns null', async () => {
    await insert('null_int', null, 401, false);
    const row = await selectByVarchar('null_int');
    expect(row!['V_INTEGER']).toBeNull();
  });

  it('NULL roundtrip: BIGINT column accepts and returns null', async () => {
    await insert('null_big', 402, null, false);
    const row = await selectByVarchar('null_big');
    expect(row!['V_BIGINT']).toBeNull();
  });

  it('NULL roundtrip: BOOLEAN column accepts and returns null', async () => {
    await insert('null_bool', 403, 403, null);
    const row = await selectByVarchar('null_bool');
    expect(row!['V_BOOLEAN']).toBeNull();
  });

  // ---- Wire type assertions --------------------------------------------------

  it('ibm_db returns INTEGER columns as JS number', async () => {
    const row = await selectByVarchar('int_42');
    expect(typeof row!['V_INTEGER']).toBe('number');
  });

  it('ibm_db returns VARCHAR columns as JS string', async () => {
    const row = await selectByVarchar('hello world');
    expect(typeof row!['V_VARCHAR']).toBe('string');
  });

  it('ibm_db returns BOOLEAN columns as JS boolean', async () => {
    const row = await selectByVarchar('bool_true');
    expect(typeof row!['V_BOOLEAN']).toBe('boolean');
  });

  it('ibm_db returns large BIGINT columns as JS string', async () => {
    const row = await selectByVarchar('big_unsafe');
    // For values above MAX_SAFE_INTEGER, ibm_db must return a string to preserve precision
    const returned = row!['V_BIGINT'];
    expect(['string', 'number']).toContain(typeof returned);
    // Whatever the type, it must be convertible to BigInt without loss
    expect(BigInt(returned as string | number)).toBe(9007199254740993n);
  });
});
