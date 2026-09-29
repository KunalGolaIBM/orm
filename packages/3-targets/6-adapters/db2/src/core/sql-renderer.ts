import type { SqlExecuteRequest } from '@internal/sql-relational-core/ast';

export interface RenderSqlOptions {
  readonly limit?: number;
  readonly offset?: number;
}

export function renderDb2Identifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export function renderLoweredDb2Sql(baseSql: string, options?: RenderSqlOptions): string {
  let sql = baseSql;
  if (options?.offset !== undefined && options?.limit !== undefined) {
    sql += ` OFFSET ${options.offset} ROWS FETCH NEXT ${options.limit} ROWS ONLY`;
  } else if (options?.limit !== undefined) {
    sql += ` FETCH FIRST ${options.limit} ROWS ONLY`;
  } else if (options?.offset !== undefined) {
    sql += ` OFFSET ${options.offset} ROWS`;
  }
  return sql;
}

export function buildDb2ExecuteRequest(
  sql: string,
  params: readonly unknown[] = [],
  options?: RenderSqlOptions,
): SqlExecuteRequest {
  return {
    sql: renderLoweredDb2Sql(sql, options),
    params,
  };
}
