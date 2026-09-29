/**
 * Canonicalizes Db2 native-type tokens for verifier comparison.
 *
 * Db2 reports native types in a variety of cases and with optional whitespace.
 * This normalizer trims and lowercases so that `"VARCHAR"`, `"varchar"`, and
 * `" Varchar "` all compare equal. It also strips redundant length/precision
 * annotations so that `varchar(255)` and `varchar` compare equal when the
 * verifier doesn't care about the precision.
 *
 * Lives target-side (mirroring `normalizeSqliteNativeType`) so the planner,
 * runner, and adapter share the same normalization without crossing the
 * `target-db2` ↔ `adapter-db2` boundary.
 */

const PRECISION_ANNOTATION = /\s*\(.*\)\s*$/;

export function normalizeDb2NativeType(nativeType: string): string {
  return nativeType.trim().toLowerCase().replace(PRECISION_ANNOTATION, '');
}
