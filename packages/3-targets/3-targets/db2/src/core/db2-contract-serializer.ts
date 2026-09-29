import type { Contract } from '@internal/contract/types';
import { SqlContractSerializerBase } from '@internal/family-sql/ir';
import type { Namespace } from '@internal/framework-components/ir';
import {
  freezeNode,
  hydrateNamespaceEntities,
  UNBOUND_NAMESPACE_ID,
} from '@internal/framework-components/ir';
import { tableEntityKind } from '@internal/sql-contract/entity-kinds';
import {
  SqlNamespaceBase,
  type SqlNamespaceEntries,
  type SqlNamespaceInput,
  type SqlStorage,
  type StorageTable,
} from '@internal/sql-contract/types';
import { blindCast } from '@internal/utils/casts';
import type { JsonObject } from '@internal/utils/json';

const DB2_NAMESPACE_KIND = 'db2-namespace' as const;

export type Db2SchemaInput = {
  readonly id: string;
  readonly entries: SqlNamespaceEntries;
};

/**
 * Db2 namespace concretion. Db2 uses uppercase schema-qualified identifiers:
 * `"SCHEMA"."TABLE"`. For the unbound namespace (no explicit schema declaration),
 * the qualifier is omitted and only the table name is double-quoted.
 */
export class Db2Schema extends SqlNamespaceBase {
  declare readonly kind: string;

  readonly id: string;
  readonly entries: SqlNamespaceEntries;

  constructor(input: Db2SchemaInput) {
    super();
    this.id = input.id;

    const dispatched = hydrateNamespaceEntities(
      input.entries,
      new Map([['table', tableEntityKind]]),
      'carry',
    );

    this.entries = Object.freeze(
      blindCast<
        SqlNamespaceEntries,
        "Db2's table-only descriptor map hydrates table→StorageTable and carries every other kind raw"
      >(dispatched),
    );
    Object.defineProperty(this, 'kind', {
      value: DB2_NAMESPACE_KIND,
      writable: false,
      enumerable: false,
      configurable: true,
    });
    freezeNode(this);
  }

  get table(): Readonly<Record<string, StorageTable>> {
    return this.entries.table ?? Object.freeze({});
  }

  qualifier(): string {
    return '';
  }

  qualifyTable(tableName: string): string {
    return `"${tableName}"`;
  }
}

/**
 * Singleton for the unbound namespace slot (no explicit schema declaration).
 */
export class Db2UnboundSchema extends Db2Schema {
  static readonly instance: Db2UnboundSchema = new Db2UnboundSchema();

  private constructor() {
    super({ id: UNBOUND_NAMESPACE_ID, entries: { table: {} } });
  }
}

export function buildDb2Namespace(input: SqlNamespaceInput): Db2Schema | Db2UnboundSchema {
  const tableKind = input.entries['table'];
  const tableCount = tableKind !== undefined ? Object.keys(tableKind).length : 0;
  const hasUnknownKinds = Object.keys(input.entries).some((kind) => kind !== 'table');

  if (input.id === UNBOUND_NAMESPACE_ID && tableCount === 0 && !hasUnknownKinds) {
    return Db2UnboundSchema.instance;
  }
  return new Db2Schema({ id: input.id, entries: input.entries });
}

/**
 * Db2 `ContractSerializer` — inherits the full SQL-family deserialization
 * pipeline and materialises namespace entries as Db2 schema concretions.
 */
export class Db2ContractSerializer extends SqlContractSerializerBase<Contract<SqlStorage>> {
  constructor() {
    super(new Map());
  }

  protected override hydrateSqlNamespaceEntry(
    nsId: string,
    raw: Record<string, unknown>,
  ): Namespace | SqlNamespaceInput {
    const hydrated = blindCast<
      SqlNamespaceInput,
      'raw is always plain JSON, so super.hydrateSqlNamespaceEntry returns SqlNamespaceInput'
    >(super.hydrateSqlNamespaceEntry(nsId, raw));
    return buildDb2Namespace(hydrated);
  }

  override serializeContract(contract: Contract<SqlStorage>): JsonObject {
    const { storage, ...rest } = contract;
    const namespacesJson: Record<string, JsonObject> = {};
    for (const [nsId, ns] of Object.entries(storage.namespaces)) {
      namespacesJson[nsId] = {
        id: ns.id,
        entries: this.serializeNamespaceEntries(ns.entries),
      };
    }
    return blindCast<
      JsonObject,
      'rest + storage are serialized plain values; spread preserves JSON-clean contract envelope'
    >({
      ...rest,
      storage: {
        storageHash: String(storage.storageHash),
        namespaces: namespacesJson,
        ...(storage.types !== undefined ? { types: this.serializeJsonObject(storage.types) } : {}),
      },
    });
  }
}
