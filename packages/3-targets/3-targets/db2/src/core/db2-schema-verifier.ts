import type { Contract } from '@internal/contract/types';
import { SqlSchemaVerifierBase } from '@internal/family-sql/ir';
import type { SchemaDiffIssue, SchemaVerifyOptions } from '@internal/framework-components/control';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { SqlSchemaIR } from '@internal/sql-schema-ir/types';

/**
 * Db2 target `SchemaVerifier` concretion.
 *
 * Mirrors the SQLite / Postgres shape: hooks return the empty list pending
 * the call-site migration that routes the existing verifier behaviour through
 * the SPI. The two overridden hooks are the extension points for target-specific
 * schema checks (e.g. Db2-only column constraints, schema-level checks) that
 * the generic SQL-family verifier does not cover.
 */
export class Db2SchemaVerifier extends SqlSchemaVerifierBase<Contract<SqlStorage>, SqlSchemaIR> {
  protected verifyCommonSqlSchema(
    _options: SchemaVerifyOptions<Contract<SqlStorage>, SqlSchemaIR>,
  ): readonly SchemaDiffIssue[] {
    return [];
  }

  protected verifyTargetExtensions(
    _options: SchemaVerifyOptions<Contract<SqlStorage>, SqlSchemaIR>,
  ): readonly SchemaDiffIssue[] {
    return [];
  }
}
