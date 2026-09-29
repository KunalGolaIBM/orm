import type { AnyCodecDescriptor } from '@internal/framework-components/codec';
import type { RawSqlLiteral } from '@internal/sql-relational-core/ast';
import type { RawCodecInferer } from '@internal/sql-relational-core/expression';
import { db2CodecDescriptors } from '@internal/target-db2/codecs';

export const db2ScalarCodecs: ReadonlyArray<AnyCodecDescriptor> = db2CodecDescriptors;

export const db2RawCodecInferer: RawCodecInferer = {
  inferCodec(value: RawSqlLiteral): string {
    if (typeof value === 'number') {
      return Number.isInteger(value) ? 'sql/int@1' : 'sql/float@1';
    }
    if (typeof value === 'boolean') {
      return 'sql/boolean@1';
    }
    if (typeof value === 'bigint') {
      return 'sql/bigint@1';
    }
    return 'sql/text@1';
  },
};
