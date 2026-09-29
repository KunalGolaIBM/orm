import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { db2AuthoringFieldPresets, db2AuthoringTypes } from '../src/core/authoring';
import { parseDb2Default } from '../src/core/default-normalizer';
import { db2TargetDescriptorMeta } from '../src/core/descriptor-meta';
import { normalizeDb2NativeType } from '../src/core/native-type-normalizer';

describe('normalizeDb2NativeType', () => {
  it('lowercases and trims', () => {
    expect(normalizeDb2NativeType('VARCHAR')).toBe('varchar');
    expect(normalizeDb2NativeType('  TIMESTAMP  ')).toBe('timestamp');
    expect(normalizeDb2NativeType('INTEGER')).toBe('integer');
  });

  it('strips precision annotations', () => {
    expect(normalizeDb2NativeType('VARCHAR(255)')).toBe('varchar');
    expect(normalizeDb2NativeType('DECIMAL(10, 2)')).toBe('decimal');
    expect(normalizeDb2NativeType('CHAR(1)')).toBe('char');
  });

  it('handles already-normalized types', () => {
    expect(normalizeDb2NativeType('bigint')).toBe('bigint');
    expect(normalizeDb2NativeType('boolean')).toBe('boolean');
  });
});

describe('parseDb2Default', () => {
  it('parses NULL', () => {
    expect(parseDb2Default('NULL')).toEqual({ kind: 'literal', value: null });
    expect(parseDb2Default('null')).toEqual({ kind: 'literal', value: null });
  });

  it('parses integer literals', () => {
    expect(parseDb2Default('42')).toEqual({ kind: 'literal', value: 42 });
    expect(parseDb2Default('-1')).toEqual({ kind: 'literal', value: -1 });
    expect(parseDb2Default('0')).toEqual({ kind: 'literal', value: 0 });
  });

  it('parses decimal literals', () => {
    expect(parseDb2Default('3.14')).toEqual({ kind: 'literal', value: 3.14 });
    expect(parseDb2Default('-0.5')).toEqual({ kind: 'literal', value: -0.5 });
  });

  it('parses string literals', () => {
    expect(parseDb2Default("'hello'")).toEqual({ kind: 'literal', value: 'hello' });
    expect(parseDb2Default("'it''s'")).toEqual({ kind: 'literal', value: "it's" });
    expect(parseDb2Default("''")).toEqual({ kind: 'literal', value: '' });
  });

  it('parses CURRENT TIMESTAMP variants as now()', () => {
    expect(parseDb2Default('CURRENT TIMESTAMP')).toEqual({ kind: 'function', expression: 'now()' });
    expect(parseDb2Default('CURRENT_TIMESTAMP')).toEqual({ kind: 'function', expression: 'now()' });
    expect(parseDb2Default('current timestamp')).toEqual({ kind: 'function', expression: 'now()' });
  });

  it('parses CURRENT DATE and CURRENT TIME as now()', () => {
    expect(parseDb2Default('CURRENT DATE')).toEqual({ kind: 'function', expression: 'now()' });
    expect(parseDb2Default('CURRENT TIME')).toEqual({ kind: 'function', expression: 'now()' });
  });

  it('strips outer parens to fixpoint', () => {
    expect(parseDb2Default('(42)')).toEqual({ kind: 'literal', value: 42 });
    expect(parseDb2Default('((42))')).toEqual({ kind: 'literal', value: 42 });
  });

  it('preserves unrecognized expressions as function', () => {
    expect(parseDb2Default('NEXTVAL FOR myseq')).toEqual({
      kind: 'function',
      expression: 'NEXTVAL FOR myseq',
    });
  });
});

describe('db2AuthoringTypes', () => {
  it('exports expected type constructors', () => {
    expect(db2AuthoringTypes.Varchar.kind).toBe('typeConstructor');
    expect(db2AuthoringTypes.Integer.kind).toBe('typeConstructor');
    expect(db2AuthoringTypes.Bigint.kind).toBe('typeConstructor');
    expect(db2AuthoringTypes.Boolean.kind).toBe('typeConstructor');
    expect(db2AuthoringTypes.Timestamp.kind).toBe('typeConstructor');
  });

  it('Integer output maps to db2/integer@1', () => {
    expect(db2AuthoringTypes.Integer.output.codecId).toBe('db2/integer@1');
    expect(db2AuthoringTypes.Integer.output.nativeType).toBe('integer');
  });

  it('Bigint output maps to db2/bigint@1', () => {
    expect(db2AuthoringTypes.Bigint.output.codecId).toBe('db2/bigint@1');
    expect(db2AuthoringTypes.Bigint.output.nativeType).toBe('bigint');
  });
});

describe('db2AuthoringFieldPresets', () => {
  it('exports temporal field presets', () => {
    expect(db2AuthoringFieldPresets.temporal).toBeDefined();
    expect(db2AuthoringFieldPresets.temporal.timestamp).toBeDefined();
  });
});

describe('db2TargetDescriptorMeta', () => {
  it('has correct identity fields', () => {
    expect(db2TargetDescriptorMeta.kind).toBe('target');
    expect(db2TargetDescriptorMeta.familyId).toBe('sql');
    expect(db2TargetDescriptorMeta.targetId).toBe('db2');
    expect(db2TargetDescriptorMeta.id).toBe('db2');
  });

  it('has authoring slot with types and fields', () => {
    expect(db2TargetDescriptorMeta.authoring.type).toBe(db2AuthoringTypes);
    expect(db2TargetDescriptorMeta.authoring.field).toBe(db2AuthoringFieldPresets);
  });

  it('defaultNamespaceId is UNBOUND_NAMESPACE_ID', () => {
    expect(db2TargetDescriptorMeta.defaultNamespaceId).toBe(UNBOUND_NAMESPACE_ID);
  });
});
