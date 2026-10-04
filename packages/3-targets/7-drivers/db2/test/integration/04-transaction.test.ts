/**
 * Integration: Transaction isolation
 *
 * Verifies commit, rollback, and READ COMMITTED isolation semantics against
 * a real IBM Db2 LUW instance.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db2Connection, Db2Driver } from '../../src/db2-driver';
import { createConnectedDriver, createTestTable, dropTestTable, skipIfNoDb2 } from './helpers';

const TABLE = 'DB2_TEST_TX';

async function countRows(conn: Db2Connection, table: string): Promise<number> {
  let count = 0;
  for await (const row of conn.query({ sql: `SELECT COUNT(*) AS N FROM ${table}` })) {
    count = Number((row as Record<string, unknown>)['N']);
  }
  return count;
}

async function selectById(
  conn: Db2Connection,
  table: string,
  id: number,
): Promise<Array<Record<string, unknown>>> {
  const rows: Array<Record<string, unknown>> = [];
  for await (const row of conn.query({
    sql: `SELECT ID, NAME FROM ${table} WHERE ID = ?`,
    params: [id],
  })) {
    rows.push(row as Record<string, unknown>);
  }
  return rows;
}

describe.skipIf(skipIfNoDb2())('Integration: transactions', () => {
  let driver: Db2Driver;
  let setupConn: Db2Connection;

  beforeAll(async () => {
    driver = await createConnectedDriver();
    setupConn = await driver.acquireConnection();
    await createTestTable(
      setupConn,
      `CREATE TABLE ${TABLE} (ID INTEGER NOT NULL, NAME VARCHAR(100))`,
      TABLE,
    );
    await setupConn.release();
  });

  afterAll(async () => {
    const cleanConn = await driver.acquireConnection();
    await dropTestTable(cleanConn, TABLE);
    await cleanConn.release();
    await driver.close();
  });

  it('ROLLBACK — inserted row is absent after rollback', async () => {
    const conn = await driver.acquireConnection();
    try {
      const tx = await conn.beginTransaction();
      await tx.execute({
        sql: `INSERT INTO ${TABLE} (ID, NAME) VALUES (?, ?)`,
        params: [1001, 'Rollback Test'],
      });
      await tx.rollback();

      // Verify row is not present
      const rows = await selectById(conn, TABLE, 1001);
      expect(rows).toHaveLength(0);
    } finally {
      await conn.release();
    }
  });

  it('COMMIT — inserted row is present after commit', async () => {
    const conn = await driver.acquireConnection();
    try {
      const tx = await conn.beginTransaction();
      await tx.execute({
        sql: `INSERT INTO ${TABLE} (ID, NAME) VALUES (?, ?)`,
        params: [1002, 'Commit Test'],
      });
      await tx.commit();

      // Verify row is present
      const rows = await selectById(conn, TABLE, 1002);
      expect(rows).toHaveLength(1);
      expect(rows[0]!['NAME']).toBe('Commit Test');
    } finally {
      await conn.release();
    }
  });

  it('READ COMMITTED — second connection does not see uncommitted row', async () => {
    const writer = await driver.acquireConnection();
    const reader = await driver.acquireConnection();

    try {
      // writer begins transaction and inserts but does NOT commit yet
      const tx = await writer.beginTransaction();
      await tx.execute({
        sql: `INSERT INTO ${TABLE} (ID, NAME) VALUES (?, ?)`,
        params: [1003, 'Isolation Test'],
      });

      // reader should NOT see the uncommitted row (READ COMMITTED)
      const rows = await selectById(reader, TABLE, 1003);
      expect(rows).toHaveLength(0);

      // now commit
      await tx.commit();

      // reader now sees the row
      const rowsAfterCommit = await selectById(reader, TABLE, 1003);
      expect(rowsAfterCommit).toHaveLength(1);
    } finally {
      await writer.release();
      await reader.release();
    }
  });

  it('two independent connections operate independently', async () => {
    const conn1 = await driver.acquireConnection();
    const conn2 = await driver.acquireConnection();

    try {
      // conn1 inserts and commits
      const tx1 = await conn1.beginTransaction();
      await tx1.execute({
        sql: `INSERT INTO ${TABLE} (ID, NAME) VALUES (?, ?)`,
        params: [2001, 'Conn1 Row'],
      });
      await tx1.commit();

      // conn2 inserts and rolls back
      const tx2 = await conn2.beginTransaction();
      await tx2.execute({
        sql: `INSERT INTO ${TABLE} (ID, NAME) VALUES (?, ?)`,
        params: [2002, 'Conn2 Rollback'],
      });
      await tx2.rollback();

      // verify: conn1 row present, conn2 row absent
      const rows1 = await selectById(conn1, TABLE, 2001);
      const rows2 = await selectById(conn1, TABLE, 2002);
      expect(rows1).toHaveLength(1);
      expect(rows2).toHaveLength(0);
    } finally {
      await conn1.release();
      await conn2.release();
    }
  });

  it('multiple transactions on the same connection work sequentially', async () => {
    const conn = await driver.acquireConnection();
    try {
      // First transaction — commit
      const tx1 = await conn.beginTransaction();
      await tx1.execute({
        sql: `INSERT INTO ${TABLE} (ID, NAME) VALUES (?, ?)`,
        params: [3001, 'Seq Tx 1'],
      });
      await tx1.commit();

      // Second transaction on same connection — rollback
      const tx2 = await conn.beginTransaction();
      await tx2.execute({
        sql: `INSERT INTO ${TABLE} (ID, NAME) VALUES (?, ?)`,
        params: [3002, 'Seq Tx 2 Rollback'],
      });
      await tx2.rollback();

      const rows1 = await selectById(conn, TABLE, 3001);
      const rows2 = await selectById(conn, TABLE, 3002);
      expect(rows1).toHaveLength(1);
      expect(rows2).toHaveLength(0);
    } finally {
      await conn.release();
    }
  });

  it('total committed row count is correct after all tests', async () => {
    const conn = await driver.acquireConnection();
    try {
      // Committed rows: 1002, 1003, 2001, 3001 = 4 rows
      const count = await countRows(conn, TABLE);
      expect(count).toBe(4);
    } finally {
      await conn.release();
    }
  });
});
