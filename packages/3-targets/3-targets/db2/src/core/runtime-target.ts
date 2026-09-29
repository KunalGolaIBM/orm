import type { RuntimeTargetInstance } from '@internal/framework-components/execution';
import type { SqlRuntimeTargetDescriptor } from '@internal/sql-runtime';
import { db2CodecDescriptors } from './codecs';
import { db2TargetDescriptorMetaRuntime } from './descriptor-meta-runtime';

export interface Db2RuntimeTargetInstance extends RuntimeTargetInstance<'sql', 'db2'> {}

const db2RuntimeTargetDescriptor: SqlRuntimeTargetDescriptor<'db2', Db2RuntimeTargetInstance> = {
  ...db2TargetDescriptorMetaRuntime,
  codecs: () => db2CodecDescriptors,
  mutationDefaultGenerators: () => [],
  create(): Db2RuntimeTargetInstance {
    return {
      familyId: 'sql',
      targetId: 'db2',
    };
  },
};

export default db2RuntimeTargetDescriptor;
