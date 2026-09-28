import type { RuntimeDriverDescriptor } from '@internal/framework-components/execution';
import { Db2Driver, type Db2RuntimeDriver } from '../db2-driver';
import { db2DriverDescriptorMeta } from './descriptor-meta';

export type { Db2RuntimeDriver } from '../db2-driver';

const db2RuntimeDriverDescriptor: RuntimeDriverDescriptor<'sql', 'db2', void, Db2RuntimeDriver> = {
  ...db2DriverDescriptorMeta,
  create(): Db2RuntimeDriver {
    return new Db2Driver();
  },
};

export default db2RuntimeDriverDescriptor;
