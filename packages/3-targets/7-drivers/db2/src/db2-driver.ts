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
        rows: blindCast<
          ReadonlyArray<Record<string, unknown>>,
          'explain result rows are plain records'
        >(rows),
      };
    } catch (error) {
      throw normalizeDb2Error(error);
    }
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

class Db2Connection extends Db2Queryable implements SqlConnection {
  async beginTransaction(): Promise<SqlTransaction> {
    if (this.client.beginTransaction) {
      await this.client.beginTransaction();
    }
    return new Db2Transaction(this.client);
  }

  async release(): Promise<void> {
    // Connection pool release — no-op for single-connection driver
  }

  async destroy(_reason?: unknown): Promise<void> {
    try {
      await this.client.close();
    } catch {
      // Destroy is advisory; swallow close errors
    }
  }
}

export class Db2Driver implements Db2RuntimeDriver {
  readonly familyId = 'sql' as const;
  readonly targetId = 'db2' as const;

  private _client: Db2ClientLike | undefined;

  get state(): SqlDriverState {
    return this._client !== undefined ? 'connected' : 'unbound';
  }

  async connect(binding: Db2Binding): Promise<void> {
    if (binding.kind === 'client') {
      this._client = binding.client;
    } else if (binding.kind === 'nativeConnection') {
      this._client = new IbmDbClientWrapper(binding.connection);
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
        this._client = new IbmDbClientWrapper(conn);
      } else {
        throw new InternalError(
          'Native connectionString binding requires ibm_db binary runtime module.',
        );
      }
    }
  }

  async close(): Promise<void> {
    if (this._client) {
      await this._client.close();
      this._client = undefined;
    }
  }

  async acquireConnection(): Promise<SqlConnection> {
    const client = this.requireClient();
    return new Db2Connection(client);
  }

  async *query<Row = Record<string, unknown>>(request: SqlExecuteRequest): AsyncIterable<Row> {
    const client = this.requireClient();
    const conn = new Db2Connection(client);
    for await (const row of conn.query<Row>(request)) {
      yield row;
    }
  }

  async execute(request: SqlExecuteRequest): Promise<SqlStatementStats> {
    const client = this.requireClient();
    return new Db2Connection(client).execute(request);
  }

  async explain(request: SqlExecuteRequest): Promise<SqlExplainResult> {
    const client = this.requireClient();
    return new Db2Connection(client).explain(request);
  }

  private requireClient(): Db2ClientLike {
    if (!this._client) {
      throw new InternalError(
        'Db2 driver not connected. Call connect(binding) before acquireConnection or execute.',
      );
    }
    return this._client;
  }
}
