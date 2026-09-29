import type { GeneratedValueSpec } from '@internal/contract/types';
import { timestampNowRuntimeGenerator } from '@internal/family-sql/runtime';
import type { RuntimeMutationDefaultGenerator } from '@internal/framework-components/runtime';
import { builtinGeneratorIds } from '@internal/ids';
import { generateId } from '@internal/ids/runtime';
import type { SqlRuntimeAdapterDescriptor } from '@internal/sql-runtime';
import { Db2AdapterImpl, db2RawCodecInfererImpl } from './adapter';
import { db2RawCodecInferer, db2ScalarCodecs } from './codec-lookup';
import { db2AdapterDescriptorMeta } from './descriptor-meta';

/**
 * `Db2AdapterImpl` already implements `RuntimeAdapterInstance<'sql', 'db2'>`
 * (has `familyId` / `targetId`) and satisfies `Adapter<>`, so its instance type
 * is the concrete `Db2RuntimeAdapterInstance`.
 */
export type Db2RuntimeAdapterInstance = InstanceType<typeof Db2AdapterImpl>;

function createDb2MutationDefaultGenerators(): ReadonlyArray<RuntimeMutationDefaultGenerator> {
  return [
    ...builtinGeneratorIds.map(
      (id): RuntimeMutationDefaultGenerator => ({
        id,
        generate: (params?: Record<string, unknown>) => {
          const spec: GeneratedValueSpec = params ? { id, params } : { id };
          return generateId(spec);
        },
        stability: 'field',
      }),
    ),
    timestampNowRuntimeGenerator(),
  ];
}

const db2RuntimeAdapterDescriptor: SqlRuntimeAdapterDescriptor<'db2', Db2RuntimeAdapterInstance> = {
  ...db2AdapterDescriptorMeta,
  codecs: () => Array.from(db2ScalarCodecs),
  mutationDefaultGenerators: createDb2MutationDefaultGenerators,
  rawCodecInferer: db2RawCodecInfererImpl,
  create(_stack): Db2RuntimeAdapterInstance {
    return new Db2AdapterImpl();
  },
};

export { db2RawCodecInferer, db2RawCodecInfererImpl };
export default db2RuntimeAdapterDescriptor;
