import { describe, expect, it } from 'vitest';
import db2RuntimeAdapterDescriptor from '../src/exports/adapter';
import {
  buildDb2ExecuteRequest,
  renderDb2Identifier,
  renderLoweredDb2Sql,
} from '../src/exports/sql-renderer';

describe('@internal/adapter-db2', () => {
  it('renders identifiers quoted per Db2 standard', () => {
    expect(renderDb2Identifier('USERS')).toBe('"USERS"');
    expect(renderDb2Identifier('user"table')).toBe('"user""table"');
  });

  it('renders lowered Db2 SQL with pagination (limit and offset)', () => {
    const base = 'SELECT * FROM USERS WHERE ACTIVE = ?';

    // No limit/offset
    expect(renderLoweredDb2Sql(base)).toBe(base);

    // Limit only
    expect(renderLoweredDb2Sql(base, { limit: 10 })).toBe(
      'SELECT * FROM USERS WHERE ACTIVE = ? FETCH FIRST 10 ROWS ONLY',
    );

    // Limit and offset
    expect(renderLoweredDb2Sql(base, { limit: 10, offset: 20 })).toBe(
      'SELECT * FROM USERS WHERE ACTIVE = ? OFFSET 20 ROWS FETCH NEXT 10 ROWS ONLY',
    );
  });

  it('constructs SqlExecuteRequest properly', () => {
    const request = buildDb2ExecuteRequest('SELECT * FROM USERS WHERE ID = ?', [1], { limit: 1 });
    expect(request.sql).toBe('SELECT * FROM USERS WHERE ID = ? FETCH FIRST 1 ROWS ONLY');
    expect(request.params).toEqual([1]);
  });

  it('provides adapter descriptor and creates runtime adapter instance', () => {
    const adapter = db2RuntimeAdapterDescriptor.create();
    expect(adapter.familyId).toBe('sql');
    expect(adapter.targetId).toBe('db2');
    expect(adapter.quoteIdentifier('ITEMS')).toBe('"ITEMS"');
  });
});
