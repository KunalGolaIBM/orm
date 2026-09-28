import { errorRuntime } from '@internal/errors/execution';
import type { ControlDriverDescriptor } from '@internal/framework-components/control';
import type { SqlControlDriverInstance } from '@internal/sql-contract/types';
import { blindCast } from '@internal/utils/casts';
import type { Db2ClientLike } from '../db2-driver';
import { normalizeDb2Error } from '../normalize-error';
import { db2DriverDescriptorMeta } from './descriptor-meta';

export class Db2ControlDriver implements SqlControlDriverInstance<'db2'> {
  readonly familyId = 'sql' as const;
  readonly targetId = 'db2' as const;

  constructor(
    private readonly client: Db2ClientLike,
    private readonly dbName: string,
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
    return this.dbName;
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

export type Db2ControlDriverOptions = {
  readonly client: Db2ClientLike;
  readonly databaseName: string;
};

const db2ControlDriverDescriptor: ControlDriverDescriptor<
  'sql',
  'db2',
  Db2ControlDriverOptions,
  Db2ControlDriver
> = {
  ...db2DriverDescriptorMeta,
  create(options): Db2ControlDriver {
    if (!options) {
      throw errorRuntime(
        'DRIVER.NOT_CONNECTED',
        'Db2 control driver requires options with a client and databaseName',
      );
    }
    return new Db2ControlDriver(options.client, options.databaseName);
  },
};

export default db2ControlDriverDescriptor;
