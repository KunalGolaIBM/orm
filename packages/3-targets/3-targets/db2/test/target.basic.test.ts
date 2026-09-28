import { describe, expect, it } from 'vitest';
import { db2CodecDescriptors } from '../src/exports/codecs';
import { db2DataTypes } from '../src/exports/data-types';

describe('@internal/target-db2', () => {
  it('exports core Db2 data types and codecs', () => {
    expect(db2DataTypes.length).toBeGreaterThan(0);
    expect(db2CodecDescriptors.length).toBeGreaterThan(0);
    const varcharCodec = db2CodecDescriptors.find((c) => c.codecId === 'db2/varchar@1');
    expect(varcharCodec).toBeDefined();
  });
});
