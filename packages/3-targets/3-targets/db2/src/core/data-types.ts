import { type Cast, type DataType, dataType } from '@internal/framework-components/codec';
import { numeralText } from '@internal/sql-relational-core/ast';

const unchanged: Cast = (value) => value;

export const db2Varchar: DataType = dataType('db2/varchar', {});
export const db2Char: DataType = dataType('db2/char', {});
export const db2Clob: DataType = dataType('db2/clob', {
  casts: { [db2Varchar.id]: unchanged, [db2Char.id]: unchanged },
});

export const db2Smallint: DataType = dataType('db2/smallint', {});
export const db2Integer: DataType = dataType('db2/integer', {
  casts: { [db2Smallint.id]: unchanged },
});
export const db2Bigint: DataType = dataType('db2/bigint', {
  casts: {
    [db2Smallint.id]: (v) => (typeof v === 'number' ? numeralText(v) : v),
    [db2Integer.id]: (v) => (typeof v === 'number' ? numeralText(v) : v),
  },
});

export const db2Decimal: DataType = dataType('db2/decimal', {});
export const db2Real: DataType = dataType('db2/real', {});
export const db2Double: DataType = dataType('db2/double', {});

export const db2Boolean: DataType = dataType('db2/boolean', {});
export const db2Blob: DataType = dataType('db2/blob', {});

export const db2Date: DataType = dataType('db2/date', {});
export const db2Time: DataType = dataType('db2/time', {});
export const db2Timestamp: DataType = dataType('db2/timestamp', {});

export const db2DataTypes: readonly DataType[] = [
  db2Varchar,
  db2Char,
  db2Clob,
  db2Smallint,
  db2Integer,
  db2Bigint,
  db2Decimal,
  db2Real,
  db2Double,
  db2Boolean,
  db2Blob,
  db2Date,
  db2Time,
  db2Timestamp,
];
