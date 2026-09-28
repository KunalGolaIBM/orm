import type { GeneratedValueSpec } from '@internal/contract/types';
import { timestampNowRuntimeGenerator } from '@internal/family-sql/runtime';
import type { RuntimeAdapterInstance } from '@internal/framework-components/execution';
import type { RuntimeMutationDefaultGenerator } from '@internal/framework-components/runtime';
import { builtinGeneratorIds } from '@internal/ids';
import { generateId } from '@internal/ids/runtime';
import type { SqlRuntimeAdapterDescriptor } from '@internal/sql-runtime';
import { db2RawCodecInferer, db2ScalarCodecs } from './codec-lookup';
import { db2AdapterDescriptorMeta } from './descriptor-meta';
import { renderDb2Identifier, renderLoweredDb2Sql } from './sql-renderer';

export interface Db2RuntimeAdapterInstance extends RuntimeAdapterInstance<'sql', 'db2'> {
  renderSql(sql: string, options?: { limit?: number; offset?: number }): string;
  quoteIdentifier(name: string): string;
}

export function createDb2Adapter(): Db2RuntimeAdapterInstance {
  return {
    familyId: 'sql' as const,
    targetId: 'db2' as const,
    renderSql: renderLoweredDb2Sql,
    quoteIdentifier: renderDb2Identifier,
  };
}

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
  rawCodecInferer: db2RawCodecInferer,
  create(_stack): Db2RuntimeAdapterInstance {
    return createDb2Adapter();
  },
};

export default db2RuntimeAdapterDescriptor;
