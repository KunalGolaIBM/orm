import type {
  AuthoringFieldNamespace,
  AuthoringTypeNamespace,
} from '@internal/framework-components/authoring';
import {
  temporalAuthoringPresets,
  temporalCodecPreset,
} from '@internal/framework-components/authoring';

/**
 * Db2 target authoring type constructors.
 *
 * These are the PSL-visible type constructor names contributed by the
 * `db2` target. They appear in the `@db2.` namespace inside a contract's
 * PSL source (e.g. `@db2.Timestamp`).
 */
export const db2AuthoringTypes = {
  Varchar: {
    kind: 'typeConstructor',
    documentation: 'A Db2 VARCHAR column of the specified length (default 255).',
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
  Char: {
    kind: 'typeConstructor',
    documentation: 'A Db2 CHAR (fixed-length character) column of the specified length.',
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
      nativeType: 'char',
    },
  },
  Smallint: {
    kind: 'typeConstructor',
    documentation: 'A Db2 SMALLINT (16-bit signed integer) column.',
    output: {
      codecId: 'db2/integer@1',
      nativeType: 'smallint',
    },
  },
  Integer: {
    kind: 'typeConstructor',
    documentation: 'A Db2 INTEGER (32-bit signed integer) column.',
    output: {
      codecId: 'db2/integer@1',
      nativeType: 'integer',
    },
  },
  Bigint: {
    kind: 'typeConstructor',
    documentation: 'A Db2 BIGINT (64-bit signed integer) column. Decoded as JavaScript `bigint`.',
    output: {
      codecId: 'db2/bigint@1',
      nativeType: 'bigint',
    },
  },
  Decimal: {
    kind: 'typeConstructor',
    documentation: 'A Db2 DECIMAL(precision, scale) fixed-point column.',
    args: [
      {
        name: 'precision',
        optional: true,
        kind: 'number',
        integer: true,
        minimum: 1,
      },
      {
        name: 'scale',
        optional: true,
        kind: 'number',
        integer: true,
        minimum: 0,
      },
    ],
    output: {
      codecId: 'db2/varchar@1',
      nativeType: 'decimal',
    },
  },
  Real: {
    kind: 'typeConstructor',
    documentation: 'A Db2 REAL (32-bit floating-point) column.',
    output: {
      codecId: 'db2/varchar@1',
      nativeType: 'real',
    },
  },
  Double: {
    kind: 'typeConstructor',
    documentation: 'A Db2 DOUBLE (64-bit floating-point) column.',
    output: {
      codecId: 'db2/varchar@1',
      nativeType: 'double',
    },
  },
  Boolean: {
    kind: 'typeConstructor',
    documentation: 'A Db2 BOOLEAN column (true/false).',
    output: {
      codecId: 'db2/boolean@1',
      nativeType: 'boolean',
    },
  },
  Date: {
    kind: 'typeConstructor',
    documentation: 'A Db2 DATE column (year, month, day).',
    output: {
      codecId: 'db2/varchar@1',
      nativeType: 'date',
    },
  },
  Time: {
    kind: 'typeConstructor',
    documentation: 'A Db2 TIME column (hour, minute, second).',
    output: {
      codecId: 'db2/varchar@1',
      nativeType: 'time',
    },
  },
  Timestamp: {
    kind: 'typeConstructor',
    documentation: 'A Db2 TIMESTAMP column (date + time with microsecond precision).',
    output: {
      codecId: 'db2/varchar@1',
      nativeType: 'timestamp',
    },
  },
  Clob: {
    kind: 'typeConstructor',
    documentation: 'A Db2 CLOB (character large object) column for large text data.',
    output: {
      codecId: 'db2/varchar@1',
      nativeType: 'clob',
    },
  },
  Blob: {
    kind: 'typeConstructor',
    documentation: 'A Db2 BLOB (binary large object) column for large binary data.',
    output: {
      codecId: 'db2/varchar@1',
      nativeType: 'blob',
    },
  },
} as const satisfies AuthoringTypeNamespace;

/**
 * Db2 target authoring field presets.
 *
 * Pre-packaged field configurations for common Db2 column patterns.
 */
export const db2AuthoringFieldPresets = {
  temporal: {
    .../* @__PURE__ */ temporalAuthoringPresets({
      codecId: 'db2/varchar@1',
      nativeType: 'timestamp',
    }),
    timestamp: /* @__PURE__ */ temporalCodecPreset({
      codecId: 'db2/varchar@1',
      nativeType: 'timestamp',
    }),
  },
} as const satisfies AuthoringFieldNamespace;
