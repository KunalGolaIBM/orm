/**
 * Full SQL-rendering Adapter implementation for IBM Db2 LUW.
 *
 * Implements `Adapter<AnyQueryAst, Contract<SqlStorage>, LoweredStatement>` so
 * that `SqlRuntimeAdapterInstance<'db2'>` is satisfied for execution-stack
 * composition via `createSqlExecutionStack`.
 *
 * Key Db2 dialect differences from SQLite:
 * - Pagination:  `FETCH FIRST N ROWS ONLY` / `OFFSET N ROWS FETCH NEXT M ROWS ONLY`
 * - No `RETURNING` clause — raise `RUNTIME.AST_UNSUPPORTED`
 * - `MERGE … WHEN NOT MATCHED` for upserts (unsupported at MVP level)
 * - JSON functions: `JSON_OBJECT(KEY … VALUE …)` / `JSON_ARRAYAGG`
 * - Parameter placeholders: positional `?` (same as SQLite)
 * - Double-quoted identifiers (same as Postgres/ANSI)
 * - `IS NOT DISTINCT FROM` / `IS DISTINCT FROM` supported in Db2 11.1+
 */

import type { Contract } from '@internal/contract/types';
import type { RuntimeAdapterInstance } from '@internal/framework-components/execution';
import type { SqlStorage } from '@internal/sql-contract/types';
import type {
  Adapter,
  AdapterProfile,
  AggregateExpr,
  AnyExpression,
  AnyFromSource,
  AnyJsonValueProjection,
  AnyQueryAst,
  BinaryExpr,
  CaseExpr,
  CastExpr,
  ColumnRef,
  DeleteAst,
  FunctionCallExpr,
  InsertAst,
  InsertValue,
  JoinAst,
  JoinOnExpr,
  JsonArrayAggExpr,
  JsonObjectExpr,
  JsonValueProjectionVisitor,
  ListExpression,
  LiteralExpr,
  LoweredParam,
  LoweredStatement,
  LowererContext,
  NullCheckExpr,
  OperationExpr,
  OrderByItem,
  RawExpr,
  RawQueryAst,
  RawSqlLiteral,
  SelectAst,
  SqlQueryable,
  SubqueryExpr,
  TableSource,
  UpdateAst,
  WindowFuncExpr,
} from '@internal/sql-relational-core/ast';
import { isDdlNode } from '@internal/sql-relational-core/ast';
import type { RawCodecInferer } from '@internal/sql-relational-core/expression';
import { assertNever, InternalError } from '@internal/utils/internal-error';
import { structuredError } from '@internal/utils/structured-error';

// ---------------------------------------------------------------------------
// SQL utility helpers
// ---------------------------------------------------------------------------

function quoteIdentifier(name: string): string {
  if (name.length === 0) {
    throw structuredError('CONTRACT.IDENTIFIER_INVALID', 'Identifier cannot be empty', {
      meta: { value: name, context: 'identifier' },
    });
  }
  if (name.includes('\0')) {
    throw structuredError('CONTRACT.IDENTIFIER_INVALID', 'Identifier cannot contain null bytes', {
      meta: { value: name.replace(/\0/g, '\\0'), context: 'identifier' },
    });
  }
  return `"${name.replace(/"/g, '""')}"`;
}

function escapeLiteral(value: string): string {
  if (value.includes('\0')) {
    throw structuredError(
      'CONTRACT.IDENTIFIER_INVALID',
      'Literal value cannot contain null bytes',
      { meta: { value: value.replace(/\0/g, '\\0'), context: 'literal' } },
    );
  }
  return value.replace(/'/g, "''");
}

// ---------------------------------------------------------------------------
// Render context
// ---------------------------------------------------------------------------

interface Db2RenderContext {
  readonly contract: Contract<SqlStorage> | undefined;
}

// ---------------------------------------------------------------------------
// AST node helpers
// ---------------------------------------------------------------------------

function nodeKind(value: unknown): string {
  if (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    typeof value.kind === 'string'
  ) {
    return value.kind;
  }
  return 'unknown';
}

function unreachableKind(value: never): string {
  return nodeKind(value);
}

// ---------------------------------------------------------------------------
// Main renderer
// ---------------------------------------------------------------------------

/**
 * Lower a SQL query AST into a Db2-flavored `{ sql, params }` payload.
 */
export function renderLoweredDb2AstSql(
  ast: AnyQueryAst,
  contract: Contract<SqlStorage> | undefined,
): LoweredStatement {
  const ctx: Db2RenderContext = { contract };
  const collectedParamRefs = ast.collectParamRefs();
  const params: LoweredParam[] = [];
  for (const ref of collectedParamRefs) {
    params.push(
      ref.kind === 'prepared-param-ref'
        ? { kind: 'bind', name: ref.name }
        : { kind: 'literal', value: ref.value },
    );
  }

  let sql: string;

  const node = ast;
  switch (node.kind) {
    case 'select':
      sql = renderSelect(node, ctx);
      break;
    case 'insert':
      sql = renderInsert(node, ctx);
      break;
    case 'update':
      sql = renderUpdate(node, ctx);
      break;
    case 'delete':
      sql = renderDelete(node, ctx);
      break;
    case 'raw-query':
      sql = renderParts(node.parts, ctx);
      break;
    default:
      throw new InternalError(`Unsupported AST node kind: ${nodeKind(node)}`);
  }

  return Object.freeze({ sql, params });
}

function renderLimitOffset(ast: SelectAst, ctx: Db2RenderContext): string {
  const limit = ast.limit;
  const offset = ast.offset;

  if (offset !== undefined && limit !== undefined) {
    const offsetStr = typeof offset === 'number' ? String(offset) : renderExpr(offset, ctx);
    const limitStr = typeof limit === 'number' ? String(limit) : renderExpr(limit, ctx);
    return ` OFFSET ${offsetStr} ROWS FETCH NEXT ${limitStr} ROWS ONLY`;
  }
  if (limit !== undefined) {
    if (typeof limit === 'number' && limit < 0) {
      // Negative limit means no limit in some dialects; Db2 has no equivalent
      // so we omit the clause.
      return '';
    }
    const limitStr = typeof limit === 'number' ? String(limit) : renderExpr(limit, ctx);
    return ` FETCH FIRST ${limitStr} ROWS ONLY`;
  }
  if (offset !== undefined) {
    const offsetStr = typeof offset === 'number' ? String(offset) : renderExpr(offset, ctx);
    return ` OFFSET ${offsetStr} ROWS`;
  }
  return '';
}

function renderSelect(ast: SelectAst, ctx: Db2RenderContext): string {
  const distinctPrefix = ast.distinct ? 'DISTINCT ' : '';
  const selectClause = `SELECT ${distinctPrefix}${renderProjection(ast.projection, ctx)}`;
  const fromClause = ast.from !== undefined ? `FROM ${renderSource(ast.from, ctx)}` : '';

  const joinsClause = ast.joins?.length
    ? ast.joins.map((join) => renderJoin(join, ctx)).join(' ')
    : '';

  const whereClause = ast.where ? `WHERE ${renderExpr(ast.where, ctx)}` : '';
  const groupByClause = ast.groupBy?.length
    ? `GROUP BY ${ast.groupBy.map((expr) => renderExpr(expr, ctx)).join(', ')}`
    : '';
  const havingClause = ast.having ? `HAVING ${renderExpr(ast.having, ctx)}` : '';
  const orderClause = ast.orderBy?.length ? `ORDER BY ${renderOrderByItems(ast.orderBy, ctx)}` : '';
  const paginationClause = renderLimitOffset(ast, ctx);

  return [
    selectClause,
    fromClause,
    joinsClause,
    whereClause,
    groupByClause,
    havingClause,
    orderClause,
  ]
    .filter((part) => part.length > 0)
    .join(' ')
    .concat(paginationClause);
}

function renderProjection(projection: SelectAst['projection'], ctx: Db2RenderContext): string {
  if (projection.length === 0) {
    return '*';
  }
  return projection
    .map((item) => {
      const alias = quoteIdentifier(item.alias);
      if (item.expr.kind === 'column-ref') {
        const rendered = renderColumn(item.expr);
        return item.expr.column === item.alias ? rendered : `${rendered} AS ${alias}`;
      }
      if (item.expr.kind === 'literal') {
        return `${renderLiteral(item.expr)} AS ${alias}`;
      }
      return `${renderExpr(item.expr, ctx)} AS ${alias}`;
    })
    .join(', ');
}

function qualifyTableFromNamespaceCoordinate(table: TableSource, ctx: Db2RenderContext): string {
  if (table.namespaceId === undefined) {
    return quoteIdentifier(table.name);
  }
  const contract = ctx.contract;
  if (contract === undefined) {
    throw new InternalError(
      `Table "${table.name}" carries namespace "${table.namespaceId}" but no contract was supplied to resolve it`,
    );
  }
  const ns = contract.storage.namespaces[table.namespaceId];
  if (ns === undefined) {
    throw new InternalError(
      `Table "${table.name}" references namespace "${table.namespaceId}" which is not present on the contract`,
    );
  }
  return quoteIdentifier(table.name);
}

function renderTableSource(source: TableSource, ctx: Db2RenderContext): string {
  const qualified = qualifyTableFromNamespaceCoordinate(source, ctx);
  const alias = source.alias;
  return alias !== undefined ? `${qualified} AS ${quoteIdentifier(alias)}` : qualified;
}

function renderSource(source: AnyFromSource, ctx: Db2RenderContext): string {
  const node = source;
  switch (node.kind) {
    case 'table-source':
      return renderTableSource(node, ctx);
    case 'derived-table-source':
      return `(${renderSelect(node.query, ctx)}) AS ${quoteIdentifier(node.alias)}`;
    case 'function-source': {
      const args = node.args.map((arg) => renderExpr(arg, ctx)).join(', ');
      const call = `${node.fn}(${args})`;
      return node.alias !== undefined ? `${call} AS ${quoteIdentifier(node.alias)}` : call;
    }
    default:
      return assertNever(node, `Unsupported source node kind: ${unreachableKind(node)}`);
  }
}

function renderExpr(expr: AnyExpression, ctx: Db2RenderContext): string {
  const node = expr;
  switch (node.kind) {
    case 'column-ref':
      return renderColumn(node);
    case 'identifier-ref':
      return quoteIdentifier(node.name);
    case 'operation':
      return renderOperation(node, ctx);
    case 'subquery':
      return renderSubqueryExpr(node, ctx);
    case 'aggregate':
      return renderAggregateExpr(node, ctx);
    case 'window-func':
      return renderWindowFuncExpr(node, ctx);
    case 'function-call':
      return renderFunctionCallExpr(node, ctx);
    case 'cast':
      return renderCastExpr(node, ctx);
    case 'case':
      return renderCaseExpr(node, ctx);
    case 'json-object':
      return renderJsonObjectExpr(node, ctx);
    case 'json-array-agg':
      return renderJsonArrayAggExpr(node, ctx);
    case 'binary':
      return renderBinary(node, ctx);
    case 'and':
      if (node.exprs.length === 0) {
        return 'TRUE';
      }
      return `(${node.exprs.map((part) => renderExpr(part, ctx)).join(' AND ')})`;
    case 'or':
      if (node.exprs.length === 0) {
        return 'FALSE';
      }
      return `(${node.exprs.map((part) => renderExpr(part, ctx)).join(' OR ')})`;
    case 'exists': {
      if (ctx.contract === undefined) {
        throw new InternalError('EXISTS subquery rendering requires a Db2 contract');
      }
      const notKeyword = node.notExists ? 'NOT ' : '';
      const subquery = renderSelect(node.subquery, ctx);
      return `${notKeyword}EXISTS (${subquery})`;
    }
    case 'null-check':
      return renderNullCheck(node, ctx);
    case 'not':
      return `NOT (${renderExpr(node.expr, ctx)})`;
    case 'param-ref':
    case 'prepared-param-ref':
      return '?';
    case 'literal':
      return renderLiteral(node);
    case 'list':
      return renderListLiteral(node, ctx);
    case 'raw-expr':
      return renderRawExpr(node, ctx);
    default:
      return assertNever(node, `Unsupported expression node kind: ${unreachableKind(node)}`);
  }
}

function renderParts(
  parts: RawExpr['parts'] | RawQueryAst['parts'],
  ctx: Db2RenderContext,
): string {
  return parts.map((part) => (typeof part === 'string' ? part : renderExpr(part, ctx))).join('');
}

function renderRawExpr(node: RawExpr, ctx: Db2RenderContext): string {
  return renderParts(node.parts, ctx);
}

// `excluded` is a pseudo-table in ON CONFLICT DO UPDATE that references the row
// proposed for insertion. It is not quoted because it's a keyword.
function renderColumn(ref: ColumnRef): string {
  if (ref.table === 'excluded') {
    return `excluded.${quoteIdentifier(ref.column)}`;
  }
  return `${quoteIdentifier(ref.table)}.${quoteIdentifier(ref.column)}`;
}

function renderLiteral(expr: LiteralExpr): string {
  if (typeof expr.value === 'string') {
    return `'${escapeLiteral(expr.value)}'`;
  }
  if (typeof expr.value === 'number' || typeof expr.value === 'boolean') {
    return String(expr.value);
  }
  if (typeof expr.value === 'bigint') {
    return String(expr.value);
  }
  if (expr.value === null || expr.value === undefined) {
    return 'NULL';
  }
  if (expr.value instanceof Date) {
    return `'${escapeLiteral(expr.value.toISOString())}'`;
  }
  const json = JSON.stringify(expr.value);
  if (json === undefined) {
    return 'NULL';
  }
  return `'${escapeLiteral(json)}'`;
}

function renderOperation(expr: OperationExpr, ctx: Db2RenderContext): string {
  const self = renderExpr(expr.self, ctx);
  const args = expr.args.map((arg) => renderExpr(arg, ctx));

  let result = expr.lowering.template;
  result = result.replace(/\{\{self\}\}/g, self);
  for (let i = 0; i < args.length; i++) {
    result = result.replace(new RegExp(`\\{\\{arg${i}\\}\\}`, 'g'), args[i] ?? '');
  }

  return result;
}

function renderSubqueryExpr(expr: SubqueryExpr, ctx: Db2RenderContext): string {
  if (expr.query.projection.length !== 1) {
    throw structuredError(
      'RUNTIME.AST_INVALID',
      'Subquery expressions must project exactly one column',
      { meta: { node: 'subquery' } },
    );
  }
  if (ctx.contract === undefined) {
    throw new InternalError('Subquery expression rendering requires a Db2 contract');
  }
  return `(${renderSelect(expr.query, ctx)})`;
}

function requiresNullCheckGrouping(kind: AnyExpression['kind']): boolean {
  switch (kind) {
    case 'operation':
    case 'subquery':
      return true;
    case 'column-ref':
    case 'identifier-ref':
    case 'aggregate':
    case 'window-func':
    case 'function-call':
    case 'cast':
    case 'case':
    case 'json-object':
    case 'json-array-agg':
    case 'binary':
    case 'and':
    case 'or':
    case 'exists':
    case 'null-check':
    case 'not':
    case 'param-ref':
    case 'prepared-param-ref':
    case 'literal':
    case 'list':
    case 'raw-expr':
      return false;
  }
}

function renderNullCheck(expr: NullCheckExpr, ctx: Db2RenderContext): string {
  const rendered = renderExpr(expr.expr, ctx);
  const renderedExpr = requiresNullCheckGrouping(expr.expr.kind) ? `(${rendered})` : rendered;
  return expr.isNull ? `${renderedExpr} IS NULL` : `${renderedExpr} IS NOT NULL`;
}

function renderBinary(expr: BinaryExpr, ctx: Db2RenderContext): string {
  if (expr.right.kind === 'list' && expr.right.values.length === 0) {
    if (expr.op === 'in') {
      return 'FALSE';
    }
    if (expr.op === 'notIn') {
      return 'TRUE';
    }
  }

  const leftExpr = expr.left;
  const left = renderExpr(leftExpr, ctx);
  const leftRendered =
    leftExpr.kind === 'operation' || leftExpr.kind === 'subquery' ? `(${left})` : left;

  const rightNode = expr.right;
  let right: string;
  switch (rightNode.kind) {
    case 'list':
      right = renderListLiteral(rightNode, ctx);
      break;
    case 'literal':
      right = renderLiteral(rightNode);
      break;
    case 'column-ref':
      right = renderColumn(rightNode);
      break;
    case 'param-ref':
    case 'prepared-param-ref':
      right = '?';
      break;
    default:
      right = renderExpr(rightNode, ctx);
      break;
  }

  const operatorMap: Record<BinaryExpr['op'], string> = {
    eq: '=',
    neq: '!=',
    isNotDistinctFrom: 'IS NOT DISTINCT FROM',
    isDistinctFrom: 'IS DISTINCT FROM',
    gt: '>',
    lt: '<',
    gte: '>=',
    lte: '<=',
    like: 'LIKE',
    in: 'IN',
    notIn: 'NOT IN',
  };

  return `${leftRendered} ${operatorMap[expr.op]} ${right}`;
}

function renderListLiteral(expr: ListExpression, ctx: Db2RenderContext): string {
  if (expr.values.length === 0) {
    return '(NULL)';
  }
  const values = expr.values
    .map((v) => {
      if (v.kind === 'param-ref' || v.kind === 'prepared-param-ref') return '?';
      if (v.kind === 'literal') return renderLiteral(v);
      return renderExpr(v, ctx);
    })
    .join(', ');
  return `(${values})`;
}

function renderAggregateExpr(expr: AggregateExpr, ctx: Db2RenderContext): string {
  const fn = expr.fn.toUpperCase();
  if (!expr.expr) {
    return `${fn}(*)`;
  }
  return `${fn}(${renderExpr(expr.expr, ctx)})`;
}

function renderWindowFuncExpr(expr: WindowFuncExpr, ctx: Db2RenderContext): string {
  const fn = expr.fn.toUpperCase();
  const args = expr.args.map((arg) => renderExpr(arg, ctx)).join(', ');
  const partitionClause =
    expr.partitionBy && expr.partitionBy.length > 0
      ? `PARTITION BY ${expr.partitionBy.map((e) => renderExpr(e, ctx)).join(', ')}`
      : '';
  const orderClause =
    expr.orderBy && expr.orderBy.length > 0
      ? `ORDER BY ${renderOrderByItems(expr.orderBy, ctx)}`
      : '';
  const over = [partitionClause, orderClause].filter((part) => part.length > 0).join(' ');
  return `${fn}(${args}) OVER (${over})`;
}

function renderFunctionCallExpr(expr: FunctionCallExpr, ctx: Db2RenderContext): string {
  const args = expr.args.map((arg) => renderExpr(arg, ctx)).join(', ');
  return `${expr.fn}(${args})`;
}

function renderCastExpr(expr: CastExpr, ctx: Db2RenderContext): string {
  return `CAST(${renderExpr(expr.expr, ctx)} AS ${expr.targetType})`;
}

function renderCaseExpr(expr: CaseExpr, ctx: Db2RenderContext): string {
  const branches = expr.branches
    .map(
      (branch) => `WHEN ${renderExpr(branch.condition, ctx)} THEN ${renderExpr(branch.value, ctx)}`,
    )
    .join(' ');
  const elseClause = expr.elseExpr === undefined ? '' : ` ELSE ${renderExpr(expr.elseExpr, ctx)}`;
  return `CASE ${branches}${elseClause} END`;
}

function renderJsonValueProjection(
  projection: AnyJsonValueProjection,
  ctx: Db2RenderContext,
): string {
  const visitor: JsonValueProjectionVisitor<string> = {
    codec: ({ value }) => renderExpr(value, ctx),
    native: ({ value }) => renderExpr(value, ctx),
    document: ({ value }) => renderExpr(value, ctx),
  };
  return projection.accept(visitor);
}

/**
 * Db2 JSON_OBJECT syntax: `JSON_OBJECT(KEY 'k1' VALUE v1, KEY 'k2' VALUE v2)`
 * Db2 11.5+ supports this ANSI SQL/JSON syntax.
 */
function renderJsonObjectExpr(expr: JsonObjectExpr, ctx: Db2RenderContext): string {
  const args = expr.entries
    .map((entry) => {
      const key = `'${escapeLiteral(entry.key)}'`;
      const value = renderJsonValueProjection(entry.value, ctx);
      return `KEY ${key} VALUE ${value}`;
    })
    .join(', ');
  return `JSON_OBJECT(${args})`;
}

function renderOrderByItems(items: ReadonlyArray<OrderByItem>, ctx: Db2RenderContext): string {
  return items
    .map(
      (item) =>
        `${renderExpr(item.expr, ctx)}${ORDER_DIRECTION_SQL[item.dir]}${renderNullsPlacement(item)}`,
    )
    .join(', ');
}

const ORDER_DIRECTION_SQL: Readonly<Record<OrderByItem['dir'], string>> = {
  asc: ' ASC',
  desc: ' DESC',
};

const ORDER_NULLS_SQL: Readonly<Record<NonNullable<OrderByItem['nulls']>, string>> = {
  first: ' NULLS FIRST',
  last: ' NULLS LAST',
};

function renderNullsPlacement(item: OrderByItem): string {
  return item.nulls === undefined ? '' : ORDER_NULLS_SQL[item.nulls];
}

/**
 * Db2 JSON_ARRAYAGG syntax (Db2 11.5+).
 */
function renderJsonArrayAggExpr(expr: JsonArrayAggExpr, ctx: Db2RenderContext): string {
  const aggregateOrderBy =
    expr.orderBy && expr.orderBy.length > 0
      ? ` ORDER BY ${renderOrderByItems(expr.orderBy, ctx)}`
      : '';
  const aggregated = `JSON_ARRAYAGG(${renderJsonValueProjection(expr.expr, ctx)}${aggregateOrderBy})`;
  if (expr.onEmpty === 'emptyArray') {
    return `COALESCE(${aggregated}, '[]')`;
  }
  return aggregated;
}

function renderJoin(join: JoinAst, ctx: Db2RenderContext): string {
  if (ctx.contract === undefined) {
    throw new InternalError('JOIN rendering requires a Db2 contract');
  }
  const joinType = join.joinType.toUpperCase();
  const source = renderSource(join.source, ctx);
  const onClause = renderJoinOn(join.on, ctx);
  return `${joinType} JOIN ${source} ON ${onClause}`;
}

function renderJoinOn(on: JoinOnExpr, ctx: Db2RenderContext): string {
  if (on.kind === 'eq-col-join-on') {
    return `${renderColumn(on.left)} = ${renderColumn(on.right)}`;
  }
  return renderExpr(on, ctx);
}

function renderInsertValue(value: InsertValue, ctx: Db2RenderContext): string {
  switch (value.kind) {
    case 'param-ref':
    case 'prepared-param-ref':
      return '?';
    case 'column-ref':
      return renderColumn(value);
    case 'raw-expr':
      return renderExpr(value, ctx);
    case 'default-value':
      return 'DEFAULT';
    default:
      return assertNever(value, `Unsupported value node in INSERT: ${unreachableKind(value)}`);
  }
}

function renderInsert(ast: InsertAst, ctx: Db2RenderContext): string {
  const table = qualifyTableFromNamespaceCoordinate(ast.table, ctx);
  const rows = ast.rows;
  const firstRow = rows[0];
  if (firstRow === undefined) {
    throw structuredError('RUNTIME.AST_INVALID', 'INSERT requires at least one row', {
      meta: { node: 'insert', table: ast.table.name },
    });
  }

  const columnOrder = Object.keys(firstRow);

  let insertClause: string;
  if (columnOrder.length === 0) {
    insertClause = `INSERT INTO ${table} DEFAULT VALUES`;
  } else {
    const columns = columnOrder.map((column) => quoteIdentifier(column));
    const values = rows
      .map((row) => {
        const renderedRow = columnOrder.map((column) => {
          const value = row[column];
          if (value === undefined) {
            throw structuredError(
              'RUNTIME.AST_INVALID',
              `Missing value for column "${column}" in INSERT row`,
              { meta: { node: 'insert', table: ast.table.name, column } },
            );
          }
          return renderInsertValue(value, ctx);
        });
        return `(${renderedRow.join(', ')})`;
      })
      .join(', ');
    insertClause = `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${values}`;
  }

  // Db2 does not support ON CONFLICT. Raise an unsupported error at runtime.
  if (ast.onConflict) {
    throw structuredError(
      'RUNTIME.AST_UNSUPPORTED',
      'Db2 does not support ON CONFLICT / upsert syntax natively. ' +
        'Use MERGE statements or check for duplicate key errors and retry.',
      { meta: { node: 'insert', table: ast.table.name } },
    );
  }

  // Db2 LUW does not support RETURNING. Raise an unsupported error at runtime.
  if (ast.returning?.length) {
    throw structuredError(
      'RUNTIME.AST_UNSUPPORTED',
      'Db2 LUW does not support RETURNING. Use a follow-up SELECT with IDENTITY_VAL_LOCAL() or GENERATED ALWAYS AS IDENTITY.',
      { meta: { node: 'insert', table: ast.table.name } },
    );
  }

  return insertClause;
}

function renderUpdate(ast: UpdateAst, ctx: Db2RenderContext): string {
  const table = qualifyTableFromNamespaceCoordinate(ast.table, ctx);
  const setClauses = Object.entries(ast.set).map(([col, val]) => {
    return `${quoteIdentifier(col)} = ${renderExpr(val, ctx)}`;
  });

  const whereClause = ast.where ? ` WHERE ${renderExpr(ast.where, ctx)}` : '';

  if (ast.returning?.length) {
    throw structuredError(
      'RUNTIME.AST_UNSUPPORTED',
      'Db2 LUW does not support RETURNING on UPDATE.',
      { meta: { node: 'update', table: ast.table.name } },
    );
  }

  return `UPDATE ${table} SET ${setClauses.join(', ')}${whereClause}`;
}

function renderDelete(ast: DeleteAst, ctx: Db2RenderContext): string {
  const table = qualifyTableFromNamespaceCoordinate(ast.table, ctx);
  const whereClause = ast.where ? ` WHERE ${renderExpr(ast.where, ctx)}` : '';

  if (ast.returning?.length) {
    throw structuredError(
      'RUNTIME.AST_UNSUPPORTED',
      'Db2 LUW does not support RETURNING on DELETE.',
      { meta: { node: 'delete', table: ast.table.name } },
    );
  }

  return `DELETE FROM ${table}${whereClause}`;
}

// ---------------------------------------------------------------------------
// AdapterProfile — marker read
// ---------------------------------------------------------------------------

const DB2_MARKER_TABLE = '_prisma_marker';

const defaultCapabilities = Object.freeze({
  sql: {
    orderBy: true,
    limit: true,
    lateral: false,
    jsonAgg: true,
    returning: false,
    enums: false,
    insertOnConflictSkip: false,
    insertOnConflictWithoutTarget: false,
  },
});

async function readDb2Marker(
  queryable: SqlQueryable,
): Promise<import('@internal/sql-relational-core/ast').MarkerReadResult> {
  // For the MVP, probe whether the marker table exists. If not, return 'no-table'.
  // A full marker read implementation requires a dedicated control adapter.
  try {
    const probeRows: Array<Record<string, unknown>> = [];
    for await (const row of queryable.query<Record<string, unknown>>({
      sql: `SELECT 1 FROM SYSCAT.TABLES WHERE TABNAME = '${escapeLiteral(DB2_MARKER_TABLE.toUpperCase())}' AND TABSCHEMA = CURRENT SCHEMA FETCH FIRST 1 ROWS ONLY`,
      params: [],
    })) {
      probeRows.push(row);
    }
    if (probeRows.length === 0) {
      return { kind: 'no-table' };
    }
    // Table exists — return absent for MVP (full control adapter reads the record).
    return { kind: 'absent' };
  } catch {
    return { kind: 'no-table' };
  }
}

// ---------------------------------------------------------------------------
// Db2AdapterImpl — implements Adapter<>
// ---------------------------------------------------------------------------

export class Db2AdapterImpl
  implements
    Adapter<AnyQueryAst, Contract<SqlStorage>, LoweredStatement>,
    RuntimeAdapterInstance<'sql', 'db2'>
{
  readonly familyId = 'sql' as const;
  readonly targetId = 'db2' as const;

  readonly profile: AdapterProfile<'db2'>;

  constructor(profileId?: string) {
    this.profile = Object.freeze({
      id: profileId ?? 'db2/default@1',
      target: 'db2' as const,
      capabilities: defaultCapabilities,
      readMarker: (queryable: SqlQueryable) => readDb2Marker(queryable),
    });
  }

  lower(ast: AnyQueryAst, context: LowererContext<Contract<SqlStorage>>): LoweredStatement {
    if (isDdlNode(ast)) {
      throw structuredError(
        'RUNTIME.DDL_UNSUPPORTED',
        'lower() does not lower DDL on the runtime adapter — DDL lowering is a control-plane concern handled by the control adapter.',
        { meta: { surface: 'runtime-adapter' } },
      );
    }
    return renderLoweredDb2AstSql(ast, context.contract);
  }

  /** Quote a Db2 identifier with double-quotes. */
  quoteIdentifier(name: string): string {
    return quoteIdentifier(name);
  }
}

// ---------------------------------------------------------------------------
// RawCodecInferer for bare-literal interpolations (`fns.raw`)
// ---------------------------------------------------------------------------

export const db2RawCodecInfererImpl: RawCodecInferer = {
  inferCodec(value: RawSqlLiteral): string {
    switch (typeof value) {
      case 'number':
        return Number.isInteger(value) ? 'db2/integer@1' : 'db2/float@1';
      case 'bigint':
        return 'db2/bigint@1';
      case 'boolean':
        return 'db2/boolean@1';
      case 'string':
        return 'db2/varchar@1';
      default:
        throw structuredError(
          'RUNTIME.RAW_CODEC_UNSUPPORTED',
          'unsupported JS value type for raw-SQL interpolation: wrap this value in `param(...)` with an explicit codec',
          { meta: { type: typeof value } },
        );
    }
  },
};

export function createDb2FullAdapter(profileId?: string): Db2AdapterImpl {
  return Object.freeze(new Db2AdapterImpl(profileId));
}
