import { errorRuntime } from '@internal/errors/execution';
import type { ControlDriverDescriptor } from '@internal/framework-components/control';
import type { SqlControlDriverInstance } from '@internal/sql-contract/types';
import { blindCast } from '@internal/utils/casts';
import { InternalError } from '@internal/utils/internal-error';
import type { NativeIbmDbConnection } from '../ibm-db-wrapper';
import { normalizeDb2Error } from '../normalize-error';
import { db2DriverDescriptorMeta } from './descriptor-meta';

export interface Db2ControlDriverClient {
  query(sql: string, params?: readonly unknown[]): Promise<ReadonlyArray<Record<string, unknown>>>;
  close(): Promise<void>;
}

export class Db2ControlDriver implements SqlControlDriverInstance<'db2'> {
  readonly familyId = 'sql' as const;
  readonly targetId = 'db2' as const;

  constructor(
    private readonly client: Db2ControlDriverClient,
    private readonly connectionString: string,
  ) {}

  async query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ readonly rows: Row[] }> {
    try {
      const rows = await this.client.query(sql, params);
      return {
        rows: blindCast<Row[], 'Db2 control driver query rows conform to schema'>(rows),
      };
    } catch (error) {
      throw normalizeDb2Error(error);
    }
  }

  async databaseName(): Promise<string | undefined> {
    const match = /DATABASE\s*=\s*([^;]+)/i.exec(this.connectionString);
    return match?.[1]?.trim();
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

const db2ControlDriverDescriptor: ControlDriverDescriptor<'sql', 'db2', Db2ControlDriver, string> =
  {
    ...db2DriverDescriptorMeta,
    async create(connectionString: string): Promise<Db2ControlDriver> {
      try {
        const { IbmDbClientWrapper } = await import('../ibm-db-wrapper');
        // Dynamic import via a variable suppresses TS module-resolution errors
        // for optional native modules that have no bundled type declarations.
        const ibmDbModuleName = 'ibm_db';
        const ibmDbModule = blindCast<
          { open(connStr: string, cb: (err: unknown, conn: unknown) => void): void },
          'ibm_db is a native module without bundled types'
        >(
          await import(ibmDbModuleName).catch(() => {
            throw new InternalError(
              'ibm_db native module not found. Install ibm_db to use the Db2 driver.',
            );
          }),
        );
        const conn = await new Promise<NativeIbmDbConnection>((resolve, reject) => {
          ibmDbModule.open(connectionString, (err: unknown, connection: unknown) => {
            if (err) {
              reject(normalizeDb2Error(err));
            } else {
              resolve(
                blindCast<NativeIbmDbConnection, 'ibm_db open returns NativeIbmDbConnection'>(
                  connection,
                ),
              );
            }
          });
        });
        const client = new IbmDbClientWrapper(conn);
        return new Db2ControlDriver(client, connectionString);
      } catch (error) {
        if (error instanceof Error && error.message.includes('ibm_db')) {
          throw errorRuntime('DRIVER.CONNECTION_FAILED', error.message, { cause: error });
        }
        throw errorRuntime('DRIVER.CONNECTION_FAILED', 'Db2 connection failed', {
          why: error instanceof Error ? error.message : String(error),
          fix: 'Verify the Db2 connection string and that ibm_db is installed',
          meta: { connectionString },
          cause: error,
        });
      }
    },
  };

export default db2ControlDriverDescriptor;
