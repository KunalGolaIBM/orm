import {
  type CodecCallContext,
  type CodecDescriptor,
  CodecImpl,
  type CodecInstanceContext,
} from '@internal/framework-components/codec';
import {
  DB2_BIGINT_CODEC_ID,
  DB2_BOOLEAN_CODEC_ID,
  DB2_INTEGER_CODEC_ID,
  DB2_VARCHAR_CODEC_ID,
} from './codec-ids';
import { db2Bigint, db2Boolean, db2Integer, db2Varchar } from './data-types';

export class Db2VarcharCodec extends CodecImpl<string, [], string, string> {
  encode(value: string, _ctx: CodecCallContext): string {
    return value;
  }
  decode(value: unknown, _ctx: CodecCallContext): string {
    return String(value);
  }
  encodeJson(value: string, _ctx: CodecCallContext): string {
    return value;
  }
  decodeJson(value: unknown, _ctx: CodecCallContext): string {
    return String(value);
  }
}

export class Db2IntegerCodec extends CodecImpl<string, [], number, number> {
  encode(value: number, _ctx: CodecCallContext): number {
    return value;
  }
  decode(value: unknown, _ctx: CodecCallContext): number {
    return typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  }
  encodeJson(value: number, _ctx: CodecCallContext): number {
    return value;
  }
  decodeJson(value: unknown, _ctx: CodecCallContext): number {
    return typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  }
}

export class Db2BigintCodec extends CodecImpl<string, [], bigint, string> {
  encode(value: bigint, _ctx: CodecCallContext): string {
    return value.toString();
  }
  decode(value: unknown, _ctx: CodecCallContext): bigint {
    return BigInt(String(value));
  }
  encodeJson(value: bigint, _ctx: CodecCallContext): string {
    return value.toString();
  }
  decodeJson(value: unknown, _ctx: CodecCallContext): bigint {
    return BigInt(String(value));
  }
}

export class Db2BooleanCodec extends CodecImpl<string, [], boolean, boolean> {
  encode(value: boolean, _ctx: CodecCallContext): boolean {
    return value;
  }
  decode(value: unknown, _ctx: CodecCallContext): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;
    return String(value) === 'true' || String(value) === '1';
  }
  encodeJson(value: boolean, _ctx: CodecCallContext): boolean {
    return value;
  }
  decodeJson(value: unknown, _ctx: CodecCallContext): boolean {
    return Boolean(value);
  }
}

export const db2CodecDescriptors: ReadonlyArray<CodecDescriptor> = [
  {
    codecId: DB2_VARCHAR_CODEC_ID,
    dataType: db2Varchar.id,
    traits: [],
    targetTypes: ['VARCHAR'],
    isParameterized: false,
    factory: () => (_ctx: CodecInstanceContext) =>
      new Db2VarcharCodec(DB2_VARCHAR_CODEC_ID, [], db2Varchar.id),
  },
  {
    codecId: DB2_INTEGER_CODEC_ID,
    dataType: db2Integer.id,
    traits: [],
    targetTypes: ['INTEGER', 'INT'],
    isParameterized: false,
    factory: () => (_ctx: CodecInstanceContext) =>
      new Db2IntegerCodec(DB2_INTEGER_CODEC_ID, [], db2Integer.id),
  },
  {
    codecId: DB2_BIGINT_CODEC_ID,
    dataType: db2Bigint.id,
    traits: [],
    targetTypes: ['BIGINT'],
    isParameterized: false,
    factory: () => (_ctx: CodecInstanceContext) =>
      new Db2BigintCodec(DB2_BIGINT_CODEC_ID, [], db2Bigint.id),
  },
  {
    codecId: DB2_BOOLEAN_CODEC_ID,
    dataType: db2Boolean.id,
    traits: [],
    targetTypes: ['BOOLEAN'],
    isParameterized: false,
    factory: () => (_ctx: CodecInstanceContext) =>
      new Db2BooleanCodec(DB2_BOOLEAN_CODEC_ID, [], db2Boolean.id),
  },
];
