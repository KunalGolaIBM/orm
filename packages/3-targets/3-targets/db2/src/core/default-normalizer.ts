/**
 * Normalizes Db2 stored default expressions back into the
 * `ColumnDefault` shape the verifier compares against.
 *
 * Lives target-side (mirroring `parseSqliteDefault`) so both the control
 * adapter (`Db2ControlAdapter.introspect`) and the planner / runner
 * schema-verify path can consume it without `target-db2` reaching into
 * `adapter-db2`.
 *
 * Db2 default value representations:
 * - NULL defaults: `NULL`
 * - Integer literals: `42`, `-1`
 * - Decimal literals: `3.14`, `-0.5`
 * - String literals: `'hello'` (single-quoted, `''` escapes a single quote)
 * - Current timestamp: `CURRENT TIMESTAMP`, `CURRENT_TIMESTAMP`
 * - Current date: `CURRENT DATE`, `CURRENT_DATE`
 * - Current time: `CURRENT TIME`, `CURRENT_TIME`
 * - Other expressions: preserved as `kind: 'function'`
 */

import type { ColumnDefault } from '@internal/contract/types';

const NULL_PATTERN = /^NULL$/i;
const INTEGER_PATTERN = /^-?\d+$/;
const DECIMAL_PATTERN = /^-?\d+\.\d+(?:[eE][+-]?\d+)?$/;
const STRING_LITERAL_PATTERN = /^'((?:[^']|'')*)'$/;

/**
 * Strips a single matched wrapping pair of outer parens from `s`.
 * Conservative: only strips when the leading `(` is matched by the trailing `)`
 * so `(a) + (b)` is returned unchanged.
 */
export function stripDb2OuterParens(s: string): string {
  if (!s.startsWith('(') || !s.endsWith(')')) return s;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth += 1;
    else if (s[i] === ')') {
      depth -= 1;
      if (depth === 0 && i < s.length - 1) return s;
    }
  }
  return s.slice(1, -1);
}

export function parseDb2Default(
  rawDefault: string,
  _nativeType?: string,
): ColumnDefault | undefined {
  let trimmed = rawDefault.trim();

  // Strip outer parens to fixpoint.
  while (true) {
    const stripped = stripDb2OuterParens(trimmed).trim();
    if (stripped === trimmed) break;
    trimmed = stripped;
  }

  const lower = trimmed.toLowerCase();

  // Db2 current-timestamp equivalents.
  if (
    lower === 'current timestamp' ||
    lower === 'current_timestamp' ||
    lower === 'current_timestamp()' ||
    lower === 'current timestamp with time zone'
  ) {
    return { kind: 'function', expression: 'now()' };
  }

  // Db2 current-date.
  if (lower === 'current date' || lower === 'current_date') {
    return { kind: 'function', expression: 'now()' };
  }

  // Db2 current-time.
  if (lower === 'current time' || lower === 'current_time') {
    return { kind: 'function', expression: 'now()' };
  }

  if (NULL_PATTERN.test(trimmed)) {
    return { kind: 'literal', value: null };
  }

  if (INTEGER_PATTERN.test(trimmed)) {
    const num = Number(trimmed);
    if (!Number.isFinite(num)) return undefined;
    return { kind: 'literal', value: num };
  }

  if (DECIMAL_PATTERN.test(trimmed)) {
    const num = Number(trimmed);
    if (!Number.isFinite(num)) return undefined;
    return { kind: 'literal', value: num };
  }

  const stringMatch = trimmed.match(STRING_LITERAL_PATTERN);
  if (stringMatch?.[1] !== undefined) {
    const unescaped = stringMatch[1].replace(/''/g, "'");
    return { kind: 'literal', value: unescaped };
  }

  // Unrecognized expression — preserve as function.
  return { kind: 'function', expression: trimmed };
}

/**
 * The contract-derived side of verify: an authored function default is read
 * through the same parser as an introspected one. Mirrors `sqliteResolveDefault`.
 */
export function db2ResolveDefault(def: ColumnDefault, resolvedNativeType: string): ColumnDefault {
  if (def.kind !== 'function') {
    return def;
  }
  return parseDb2Default(def.expression, resolvedNativeType) ?? def;
}
