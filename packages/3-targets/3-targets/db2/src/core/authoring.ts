import type {
  AuthoringFieldNamespace,
  AuthoringTypeNamespace,
} from '@internal/framework-components/authoring';

/**
 * Db2 target authoring type constructors.
 *
 * These are the PSL-visible type constructor names contributed by the
 * `db2` target. They appear in the `@db2.` namespace inside a contract's
 * PSL source (e.g. `@db2.Varchar(255)`).
 *
 * **MVP scope**: Only the 4 Db2 native types that have fully implemented codecs
 * are exposed here. Additional types (Decimal, Date, Time, Timestamp, Clob,
 * Blob, Char, Smallint, Real, Double) will be added in a follow-up once their
 * codecs, wire-type mappings, and integration tests are in place.
 */
export const db2AuthoringTypes = {
  Varchar: {
    kind: 'typeConstructor',
    documentation: 'A Db2 VARCHAR(n) column. Decoded as a JavaScript `string`.',
    args: [
      {
        name: 'length',
        optional: true,
        kind: 'number',
        integer: true,
        minimum: 1,
      },
    ],
    output: {
      codecId: 'db2/varchar@1',
      nativeType: 'varchar',
    },
  },
  Integer: {
    kind: 'typeConstructor',
    documentation: 'A Db2 INTEGER column (32-bit signed). Decoded as a JavaScript `number`.',
    output: {
      codecId: 'db2/integer@1',
      nativeType: 'integer',
    },
  },
  Bigint: {
    kind: 'typeConstructor',
    documentation:
      'A Db2 BIGINT column (64-bit signed). Decoded as a JavaScript `bigint`. ' +
      'Large values that exceed `Number.MAX_SAFE_INTEGER` are returned by ibm_db as strings ' +
      'and converted to `bigint` by the codec.',
    output: {
      codecId: 'db2/bigint@1',
      nativeType: 'bigint',
    },
  },
  Boolean: {
    kind: 'typeConstructor',
    documentation: 'A Db2 BOOLEAN column. Decoded as a JavaScript `boolean`.',
    output: {
      codecId: 'db2/boolean@1',
      nativeType: 'boolean',
    },
  },
} as const satisfies AuthoringTypeNamespace;

/**
 * Db2 target authoring field presets.
 *
 * Empty for the MVP — temporal presets require a Timestamp codec with a real
 * wire-type mapping. They will be added alongside `@db2.Timestamp` in a
 * follow-up once the codec and integration tests are in place.
 */
export const db2AuthoringFieldPresets = {} as const satisfies AuthoringFieldNamespace;
