import type { CodecDescriptor } from '@internal/framework-components/codec';

import { db2CodecDescriptors } from '@internal/target-db2/codecs';

export const db2ScalarCodecs: ReadonlyArray<CodecDescriptor> = db2CodecDescriptors;

export function db2RawCodecInferer(value: unknown): string {
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
}
