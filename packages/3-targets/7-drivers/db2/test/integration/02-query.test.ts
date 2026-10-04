/**
 * Integration: Basic CRUD queries
 *
 * Verifies INSERT, SELECT (with and without WHERE), and empty-result handling
 * against a real IBM Db2 LUW table.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db2Connection, Db2Driver } from '../../src/db2-driver';
import { createConnectedDriver, createTestTable, dropTestTable, skipIfNoDb2 } from './helpers';

const TABLE = 'DB2_TEST_QUERY';

describe.skipIf(skipIfNoDb2())('Integration: basic CRUD queries', () => {
  let driver: Db2Driver;
  let conn: Db2Connection;

  beforeAll(async () => {
    driver = await createConnectedDriver();
    conn = await driver.acquireConnection();
    await createTestTable(
      conn,
      `CREATE TABLE ${TABLE} (ID INTEGER NOT NULL, NAME VARCHAR(100))`,
      TABLE,
    );
  });

  afterAll(async () => {
    await dropTestTable(conn, TABLE);
    await conn.release();
    await driver.close();
  });

  it('INSERT a row then SELECT it back', async () => {
    await conn.execute({
      sql: `INSERT INTO ${TABLE} (ID, NAME) VALUES (?, ?)`,
      params: [1, 'Alice'],
    });

    const rows: Array<Record<string, unknown>> = [];
    for await (const row of conn.query({
      sql: `SELECT ID, NAME FROM ${TABLE} WHERE ID = ?`,
      params: [1],
    })) {
      rows.push(row as Record<string, unknown>);
    }

    expect(rows).toHaveLength(1);
    expect(rows[0]!['ID']).toBe(1);
    expect(rows[0]!['NAME']).toBe('Alice');
  });

  it('SELECT with WHERE clause returns matching row only', async () => {
    await conn.execute({
      sql: `INSERT INTO ${TABLE} (ID, NAME) VALUES (?, ?)`,
      params: [2, 'Bob'],
    });
    await conn.execute({
      sql: `INSERT INTO ${TABLE} (ID, NAME) VALUES (?, ?)`,
      params: [3, 'Carol'],
    });

    const rows: Array<Record<string, unknown>> = [];
    for await (const row of conn.query({
      sql: `SELECT ID, NAME FROM ${TABLE} WHERE NAME = ?`,
      params: ['Bob'],
    })) {
      rows.push(row as Record<string, unknown>);
    }

    expect(rows).toHaveLength(1);
    expect(rows[0]!['NAME']).toBe('Bob');
  });

  it('SELECT returns empty array when no rows match', async () => {
    const rows: Array<unknown> = [];
    for await (const row of conn.query({
      sql: `SELECT ID FROM ${TABLE} WHERE NAME = ?`,
      params: ['DoesNotExist'],
    })) {
      rows.push(row);
    }
    expect(rows).toHaveLength(0);
  });

  it('multiple sequential SELECTs on the same connection work correctly', async () => {
    for (let i = 0; i < 3; i++) {
      const rows: Array<unknown> = [];
      for await (const row of conn.query({ sql: `SELECT ID FROM ${TABLE}` })) {
        rows.push(row);
      }
      // At least the rows inserted in previous tests exist
      expect(rows.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('execute() returns correct affectedRows for UPDATE', async () => {
    const stats = await conn.execute({
      sql: `UPDATE ${TABLE} SET NAME = ? WHERE ID = ?`,
      params: ['Alice Updated', 1],
    });
    expect(stats.affectedRows).toBe(1);
  });

  it('execute() returns affectedRows = 0 when no rows match UPDATE', async () => {
    const stats = await conn.execute({
      sql: `UPDATE ${TABLE} SET NAME = ? WHERE ID = ?`,
      params: ['Ghost', 9999],
    });
    expect(stats.affectedRows).toBe(0);
  });

  it('DELETE returns correct affectedRows', async () => {
    await conn.execute({
      sql: `INSERT INTO ${TABLE} (ID, NAME) VALUES (?, ?)`,
      params: [99, 'Temp'],
    });
    const stats = await conn.execute({
      sql: `DELETE FROM ${TABLE} WHERE ID = ?`,
      params: [99],
    });
    expect(stats.affectedRows).toBe(1);
  });
});
