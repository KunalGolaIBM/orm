import type { RuntimeDriverInstance } from '@internal/framework-components/execution';
import type {
  SqlConnection,
  SqlDriver,
  SqlDriverState,
  SqlExecuteRequest,
  SqlExplainResult,
  SqlQueryable,
  SqlStatementStats,
  SqlTransaction,
} from '@internal/sql-relational-core/ast';
import { blindCast } from '@internal/utils/casts';
import { InternalError } from '@internal/utils/internal-error';
import {
  IbmDbClientWrapper,
  type NativeIbmDbConnection,
  type NativeIbmDbModule,
} from './ibm-db-wrapper';
import { normalizeDb2Error } from './normalize-error';

export type Db2Binding =
  | {
      readonly kind: 'connectionString';
      readonly connectionString: string;
      readonly nativeModule?: NativeIbmDbModule;
    }
  | { readonly kind: 'client'; readonly client: Db2ClientLike }
  | { readonly kind: 'nativeConnection'; readonly connection: NativeIbmDbConnection };

export interface Db2ClientLike {
  query(sql: string, params?: readonly unknown[]): Promise<ReadonlyArray<Record<string, unknown>>>;
  execute(sql: string, params?: readonly unknown[]): Promise<{ count: number }>;
  close(): Promise<void>;
  beginTransaction?(): Promise<void>;
  commitTransaction?(): Promise<void>;
  rollbackTransaction?(): Promise<void>;
}

export type Db2RuntimeDriver = RuntimeDriverInstance<'sql', 'db2'> & SqlDriver<Db2Binding>;

interface DriverRuntimeError extends Error {
  readonly code: 'DRIVER.NOT_CONNECTED' | 'DRIVER.ALREADY_CONNECTED';
  readonly category: 'DRIVER';
  readonly severity: 'error';
  readonly details?: Record<string, unknown>;
}

function driverError(
  code: DriverRuntimeError['code'],
  message: string,
  details?: Record<string, unknown>,
): DriverRuntimeError {
  const error = blindCast<DriverRuntimeError, 'Construct structured DriverRuntimeError'>(
    new Error(message),
  );
  Object.defineProperty(error, 'name', {
    value: 'RuntimeError',
    configurable: true,
  });
  return Object.assign(error, {
    code,
    category: 'DRIVER' as const,
    severity: 'error' as const,
    message,
    details,
  });
}

const NOT_CONNECTED_MESSAGE =
  'Db2 driver not connected. Call connect(binding) before acquireConnection or execute.';
const ALREADY_CONNECTED_MESSAGE =
  'Db2 driver already connected. Call close() before reconnecting with a new binding.';

abstract class Db2Queryable implements SqlQueryable {
  protected readonly client: Db2ClientLike;

  constructor(client: Db2ClientLike) {
    this.client = client;
  }

  async *query<Row = Record<string, unknown>>(request: SqlExecuteRequest): AsyncIterable<Row> {
    try {
      const rows = await this.client.query(request.sql, request.params);
      for (const row of rows) {
        yield blindCast<Row, 'Db2 query returns records conforming to requested row schema'>(row);
      }
    } catch (error) {
      throw normalizeDb2Error(error);
    }
  }

  async execute(request: SqlExecuteRequest): Promise<SqlStatementStats> {
    try {
      const res = await this.client.execute(request.sql, request.params);
      return { affectedRows: res.count };
    } catch (error) {
      throw normalizeDb2Error(error);
    }
  }

  async explain(request: SqlExecuteRequest): Promise<SqlExplainResult> {
    try {
      const rows = await this.client.query(`EXPLAIN ALL FOR ${request.sql}`, request.params);
      return {
        queryPlan: JSON.stringify(rows),
      };
    } catch (error) {
      throw normalizeDb2Error(error);
    }
  }
}

class Db2Connection extends Db2Queryable implements SqlConnection {
  async release(): Promise<void> {
    // Release connection handle
  }
}

class Db2Transaction extends Db2Queryable implements SqlTransaction {
  async commit(): Promise<void> {
    if (this.client.commitTransaction) {
      await this.client.commitTransaction();
    }
  }

  async rollback(): Promise<void> {
    if (this.client.rollbackTransaction) {
      await this.client.rollbackTransaction();
    }
  }
}

export class Db2Driver implements Db2RuntimeDriver {
  readonly familyId = 'sql' as const;
  readonly targetId = 'db2' as const;

  private client: Db2ClientLike | undefined;

  async connect(binding: Db2Binding): Promise<void> {
    if (this.client) {
      throw driverError('DRIVER.ALREADY_CONNECTED', ALREADY_CONNECTED_MESSAGE);
    }
    if (binding.kind === 'client') {
      this.client = binding.client;
    } else if (binding.kind === 'nativeConnection') {
      this.client = new IbmDbClientWrapper(binding.connection);
    } else if (binding.kind === 'connectionString') {
      if (binding.nativeModule) {
        const conn = await new Promise<NativeIbmDbConnection>((resolve, reject) => {
          binding.nativeModule?.open(binding.connectionString, (err, connection) => {
            if (err) {
              reject(normalizeDb2Error(err));
            } else {
              resolve(connection);
            }
          });
        });
        this.client = new IbmDbClientWrapper(conn);
      } else {
        throw new InternalError(
          'Native connectionString binding requires ibm_db binary runtime module.',
        );
      }
    }
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = undefined;
    }
  }

  state(): SqlDriverState {
    return this.client ? 'connected' : 'unconnected';
  }

  async acquireConnection(): Promise<SqlConnection> {
    const client = this.requireClient();
    return new Db2Connection(client);
  }

  async transaction(): Promise<SqlTransaction> {
    const client = this.requireClient();
    if (client.beginTransaction) {
      await client.beginTransaction();
    }
    return new Db2Transaction(client);
  }

  async *query<Row = Record<string, unknown>>(request: SqlExecuteRequest): AsyncIterable<Row> {
    const client = this.requireClient();
    const queryable = new Db2Connection(client);
    for await (const row of queryable.query<Row>(request)) {
      yield row;
    }
  }

  async execute(request: SqlExecuteRequest): Promise<SqlStatementStats> {
    const client = this.requireClient();
    const queryable = new Db2Connection(client);
    return queryable.execute(request);
  }

  async explain(request: SqlExecuteRequest): Promise<SqlExplainResult> {
    const client = this.requireClient();
    const queryable = new Db2Connection(client);
    return queryable.explain(request);
  }

  private requireClient(): Db2ClientLike {
    if (!this.client) {
      throw driverError('DRIVER.NOT_CONNECTED', NOT_CONNECTED_MESSAGE);
    }
    return this.client;
  }
}
