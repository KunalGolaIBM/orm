import type { JsonValue } from '@internal/contract/types';
import {
  type AnyCodecDescriptor,
  type CodecCallContext,
  type CodecDescriptorTemplate,
  CodecImpl,
  type CodecInstanceContext,
  type DataTypeId,
} from '@internal/framework-components/codec';
import {
  DB2_BIGINT_CODEC_ID,
  DB2_BOOLEAN_CODEC_ID,
  DB2_INTEGER_CODEC_ID,
  DB2_VARCHAR_CODEC_ID,
} from './codec-ids';
import { db2Bigint, db2Boolean, db2Integer, db2Varchar } from './data-types';

export class Db2VarcharCodec extends CodecImpl<
  typeof DB2_VARCHAR_CODEC_ID,
  readonly [],
  string,
  string
> {
  async encode(value: string, _ctx: CodecCallContext): Promise<string> {
    return value;
  }
  async decode(wire: string, _ctx: CodecCallContext): Promise<string> {
    return String(wire);
  }
  encodeJson(value: string): JsonValue {
    return value;
  }
  decodeJson(json: JsonValue): string {
    return String(json);
  }
}

export class Db2IntegerCodec extends CodecImpl<
  typeof DB2_INTEGER_CODEC_ID,
  readonly [],
  number,
  number
> {
  async encode(value: number, _ctx: CodecCallContext): Promise<number> {
    return value;
  }
  async decode(wire: number, _ctx: CodecCallContext): Promise<number> {
    return typeof wire === 'number' ? wire : Number.parseInt(String(wire), 10);
  }
  encodeJson(value: number): JsonValue {
    return value;
  }
  decodeJson(json: JsonValue): number {
    return typeof json === 'number' ? json : Number.parseInt(String(json), 10);
  }
}

export class Db2BigintCodec extends CodecImpl<
  typeof DB2_BIGINT_CODEC_ID,
  readonly [],
  string,
  bigint
> {
  async encode(value: bigint, _ctx: CodecCallContext): Promise<string> {
    return value.toString();
  }
  async decode(wire: string, _ctx: CodecCallContext): Promise<bigint> {
    return BigInt(String(wire));
  }
  encodeJson(value: bigint): JsonValue {
    return value.toString();
  }
  decodeJson(json: JsonValue): bigint {
    return BigInt(String(json));
  }
}

export class Db2BooleanCodec extends CodecImpl<
  typeof DB2_BOOLEAN_CODEC_ID,
  readonly [],
  boolean,
  boolean
> {
  async encode(value: boolean, _ctx: CodecCallContext): Promise<boolean> {
    return value;
  }
  async decode(wire: boolean, _ctx: CodecCallContext): Promise<boolean> {
    if (typeof wire === 'boolean') return wire;
    if (typeof wire === 'number') return wire === 1;
    return String(wire) === 'true' || String(wire) === '1';
  }
  encodeJson(value: boolean): JsonValue {
    return value;
  }
  decodeJson(json: JsonValue): boolean {
    return Boolean(json);
  }
}

function makeDescriptor<TCodec extends CodecImpl<string, readonly [], unknown, unknown>>(
  codecId: string,
  dataType: DataTypeId,
  targetTypes: readonly string[],
  makeCodec: (descriptor: CodecDescriptorTemplate) => TCodec,
): AnyCodecDescriptor {
  const descriptor: AnyCodecDescriptor = {
    codecId,
    dataType,
    traits: [],
    targetTypes,
    isParameterized: false,
    paramsSchema: undefined,
    factory: () => (_ctx: CodecInstanceContext) => makeCodec(descriptor),
  };
  return descriptor;
}

const db2VarcharDescriptor = makeDescriptor(
  DB2_VARCHAR_CODEC_ID,
  db2Varchar.id,
  ['VARCHAR', 'CHAR', 'CHARACTER VARYING'],
  (d) => new Db2VarcharCodec(d),
);

const db2IntegerDescriptor = makeDescriptor(
  DB2_INTEGER_CODEC_ID,
  db2Integer.id,
  ['INTEGER', 'INT', 'SMALLINT'],
  (d) => new Db2IntegerCodec(d),
);

const db2BigintDescriptor = makeDescriptor(
  DB2_BIGINT_CODEC_ID,
  db2Bigint.id,
  ['BIGINT'],
  (d) => new Db2BigintCodec(d),
);

const db2BooleanDescriptor = makeDescriptor(
  DB2_BOOLEAN_CODEC_ID,
  db2Boolean.id,
  ['BOOLEAN'],
  (d) => new Db2BooleanCodec(d),
);

export const db2CodecDescriptors: ReadonlyArray<AnyCodecDescriptor> = [
  db2VarcharDescriptor,
  db2IntegerDescriptor,
  db2BigintDescriptor,
  db2BooleanDescriptor,
];
