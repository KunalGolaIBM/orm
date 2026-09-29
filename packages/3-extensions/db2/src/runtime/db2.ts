import db2Adapter from '@internal/adapter-db2/runtime';
import { buildNamespacedEnums } from '@internal/contract/enum-accessor';
import type { Contract } from '@internal/contract/types';
import type { Db2Binding } from '@internal/driver-db2/runtime';
import db2Driver from '@internal/driver-db2/runtime';
import { instantiateExecutionStack } from '@internal/framework-components/execution';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { createRawLane, sql as sqlBuilder } from '@internal/sql-builder/runtime';
import type { Db, RawLane } from '@internal/sql-builder/types';
import type { ExtractCodecTypes, SqlStorage } from '@internal/sql-contract/types';
import { orm as ormBuilder, type PreparedFrom, prepareQuery } from '@internal/sql-orm-client';
import type { CodecTypesBase } from '@internal/sql-relational-core/expression';
import type { Preparable, SqlQueryPlan } from '@internal/sql-relational-core/plan';
import type {
  BindSiteParams,
  Declaration,
  ExecutionContext,
  ParamsFromDeclaration,
  Runtime,
  SqlExecutionStackWithDriver,
  SqlMiddleware,
  SqlRuntimeExtensionDescriptor,
  TransactionContext,
  VerifyMarkerOption,
} from '@internal/sql-runtime';
import {
  createExecutionContext,
  createSqlExecutionStack,
  SqlRuntimeBase,
  withTransaction,
} from '@internal/sql-runtime';
import db2Target, {
  Db2ContractSerializer as Db2ContractSerializerClass,
} from '@internal/target-db2/runtime';
import { assertDefined } from '@internal/utils/assertions';
import { blindCast, castAs } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import { structuredError } from '@internal/utils/structured-error';

export type Db2TargetId = 'db2';

type OrmClient<TContract extends Contract<SqlStorage>> = ReturnType<typeof ormBuilder<TContract>>;

type UnboundSql<TContract extends Contract<SqlStorage>> =
  Db<TContract>[typeof UNBOUND_NAMESPACE_ID];
type UnboundOrm<TContract extends Contract<SqlStorage>> =
  OrmClient<TContract>[typeof UNBOUND_NAMESPACE_ID];
type UnboundEnums<TContract extends Contract<SqlStorage>> = ReturnType<
  typeof buildNamespacedEnums<TContract>
>[typeof UNBOUND_NAMESPACE_ID];

function unboundOrm<TContract extends Contract<SqlStorage>>(
  orm: OrmClient<TContract>,
): UnboundOrm<TContract> {
  const value = orm[UNBOUND_NAMESPACE_ID];
  assertDefined(value, 'the unbound namespace always exists on a db2 builder output');
  return blindCast<
    UnboundOrm<TContract>,
    'OrmClient<TContract> indexed by a literal key widens NsId to string; Collection is invariant in NsId via row/mutation-input types, so the indexed-access type cannot be proven to match the literal-keyed OrmNamespace without this cast'
  >(value);
}

export interface Db2TransactionContext<TContract extends Contract<SqlStorage>>
  extends TransactionContext {
  readonly sql: UnboundSql<TContract>;
  readonly orm: UnboundOrm<TContract>;
  readonly enums: UnboundEnums<TContract>;
}

export interface Db2Client<TContract extends Contract<SqlStorage>> {
  readonly sql: UnboundSql<TContract>;
  readonly orm: UnboundOrm<TContract>;
  readonly enums: UnboundEnums<TContract>;
  readonly raw: RawLane<TContract>;
  readonly context: ExecutionContext<TContract>;
  readonly contract: TContract;
  readonly stack: SqlExecutionStackWithDriver<Db2TargetId>;
  connect(bindingInput?: { readonly connectionString: string }): Promise<Runtime>;
  runtime(): Runtime;
  prepare<
    D extends Declaration<CT>,
    Q extends SqlQueryPlan | Preparable<unknown, unknown>,
    CT extends CodecTypesBase = ExtractCodecTypes<TContract>,
  >(
    declaration: D,
    callback: (params: BindSiteParams<D>) => Q,
  ): Promise<PreparedFrom<ParamsFromDeclaration<D, CT>, Q>>;
  transaction<R>(fn: (tx: Db2TransactionContext<TContract>) => PromiseLike<R>): Promise<R>;
  close(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}

export interface Db2OptionsBase {
  readonly extensions?: readonly SqlRuntimeExtensionDescriptor<Db2TargetId>[];
  readonly middleware?: readonly SqlMiddleware[];
  readonly verifyMarker?: VerifyMarkerOption;
}

export type Db2OptionsWithContract<TContract extends Contract<SqlStorage>> = {
  readonly connectionString?: string;
} & Db2OptionsBase & {
    readonly contract: TContract;
    readonly contractJson?: never;
  };

export type Db2OptionsWithContractJson<TContract extends Contract<SqlStorage>> = {
  readonly connectionString?: string;
  readonly _contract?: TContract;
} & Db2OptionsBase & {
    readonly contractJson: unknown;
    readonly contract?: never;
  };

export type Db2Options<TContract extends Contract<SqlStorage>> =
  | Db2OptionsWithContract<TContract>
  | Db2OptionsWithContractJson<TContract>;

function resolveContract<TContract extends Contract<SqlStorage>>(
  options: Db2Options<TContract>,
): TContract {
  const serializer = new Db2ContractSerializerClass();
  if ('contractJson' in options && options.contractJson !== undefined) {
    return blindCast<
      TContract,
      'validated contract JSON corresponds to the caller supplied contract type'
    >(serializer.deserializeContract(options.contractJson));
  }
  const contract = options.contract;
  assertDefined(contract, 'a contract or contractJson is required');
  return blindCast<
    TContract,
    'serialized and validated contract retains the authored contract type'
  >(serializer.deserializeContract(serializer.serializeContract(contract)));
}

function resolveOptionalDb2Binding(options: {
  readonly connectionString?: string;
}): Db2Binding | undefined {
  if (options.connectionString === undefined) {
    return undefined;
  }
  return { kind: 'connectionString', connectionString: options.connectionString };
}

function resolveDb2Binding(input: { readonly connectionString: string }): Db2Binding {
  return { kind: 'connectionString', connectionString: input.connectionString };
}

export default function db2<TContract extends Contract<SqlStorage>>(
  options: Db2OptionsWithContract<TContract>,
): Db2Client<TContract>;
export default function db2<TContract extends Contract<SqlStorage>>(
  options: Db2OptionsWithContractJson<TContract>,
): Db2Client<TContract>;
export default function db2<TContract extends Contract<SqlStorage>>(
  options: Db2Options<TContract>,
): Db2Client<TContract> {
  const contract = resolveContract(options);
  let binding = resolveOptionalDb2Binding(options);

  const stack = createSqlExecutionStack({
    target: db2Target,
    adapter: db2Adapter,
    driver: db2Driver,
    extensions: options.extensions ?? [],
  });

  const context = createExecutionContext<TContract, Db2TargetId>({
    contract,
    stack,
    driver: db2Driver,
  });

  const rawCodecInferer = stack.adapter.rawCodecInferer;

  const sqlNamespace = sqlBuilder<TContract>({ context, rawCodecInferer })[UNBOUND_NAMESPACE_ID];
  assertDefined(sqlNamespace, 'the unbound namespace always exists on a db2 builder output');
  const sqlDb: UnboundSql<TContract> = blindCast<
    UnboundSql<TContract>,
    'Db<TContract> indexed by a literal key widens NsId to string; TableProxy is invariant in NsId via insert()/update() parameter positions, so the indexed-access type cannot be proven to match the literal-keyed Namespace without this cast'
  >(sqlNamespace);

  const raw: RawLane<TContract> = createRawLane<TContract>({ context, rawCodecInferer });

  const enumsRoot = Object.freeze(buildNamespacedEnums<TContract>(context.contract.domain));
  const enumsUnbound = enumsRoot[UNBOUND_NAMESPACE_ID];
  assertDefined(enumsUnbound, 'the unbound namespace always exists on a db2 builder output');
  const enums: UnboundEnums<TContract> = enumsUnbound;

  let runtimeInstance: Runtime | undefined;
  let runtimeDriver: { connect(binding: unknown): Promise<void> } | undefined;
  let driverConnected = false;
  let connectPromise: Promise<void> | undefined;
  let closePromise: Promise<void> | undefined;
  let backgroundConnectError: unknown;
  let closed = false;
  let ownedDispose: (() => Promise<void>) | undefined;

  const connectDriver = async (resolvedBinding: Db2Binding): Promise<void> => {
    if (driverConnected) return;
    if (!runtimeDriver) throw new InternalError('Db2 runtime driver missing');
    if (connectPromise) return connectPromise;
    connectPromise = runtimeDriver
      .connect(resolvedBinding)
      .then(() => {
        driverConnected = true;
      })
      .catch((err) => {
        backgroundConnectError = err;
        connectPromise = undefined;
        throw err;
      });
    return connectPromise;
  };

  const getRuntime = (): Runtime => {
    if (closed) {
      throw structuredError('DRIVER.NOT_CONNECTED', 'Db2 client is closed', {
        meta: { extension: 'db2' },
      });
    }

    if (backgroundConnectError !== undefined) {
      throw backgroundConnectError;
    }

    if (runtimeInstance) {
      return runtimeInstance;
    }

    const stackInstance = instantiateExecutionStack(stack);
    const driverDescriptor = stack.driver;
    if (!driverDescriptor) {
      throw new InternalError('Driver descriptor missing from execution stack');
    }

    const driver = driverDescriptor.create();
    ownedDispose = () => driver.close();
    runtimeDriver = driver;
    if (binding !== undefined) {
      void connectDriver(binding).catch(() => undefined);
    }

    runtimeInstance = new Db2RuntimeImpl({
      context,
      adapter: stackInstance.adapter,
      driver,
      ...ifDefined('verifyMarker', options.verifyMarker),
      ...ifDefined('middleware', options.middleware),
    });

    return runtimeInstance;
  };

  const orm: UnboundOrm<TContract> = unboundOrm(
    ormBuilder({
      context,
      runtime: {
        query(plan) {
          return getRuntime().query(plan);
        },
        execute(plan) {
          return getRuntime().execute(plan);
        },
        connection() {
          return getRuntime().connection();
        },
      },
    }),
  );

  function prepare<
    D extends Declaration<CT>,
    Q extends SqlQueryPlan | Preparable<unknown, unknown>,
    CT extends CodecTypesBase = ExtractCodecTypes<TContract>,
  >(
    declaration: D,
    callback: (params: BindSiteParams<D>) => Q,
  ): Promise<PreparedFrom<ParamsFromDeclaration<D, CT>, Q>> {
    return prepareQuery<D, Q, CT>(getRuntime(), declaration, callback);
  }

  return {
    sql: sqlDb,
    orm,
    enums,
    raw,
    context,
    contract,
    stack,
    async connect(bindingInput) {
      if (closed) {
        throw structuredError('DRIVER.NOT_CONNECTED', 'Db2 client is closed', {
          meta: { extension: 'db2' },
        });
      }

      if (driverConnected || connectPromise) {
        throw structuredError('DRIVER.ALREADY_CONNECTED', 'Db2 client already connected', {
          meta: { extension: 'db2' },
        });
      }

      backgroundConnectError = undefined;

      if (bindingInput !== undefined) {
        binding = resolveDb2Binding(bindingInput);
      }

      if (binding === undefined) {
        throw structuredError(
          'RUNTIME.BINDING_MISSING',
          'Db2 binding not configured. Pass connectionString to db2(...) or call db.connect({ connectionString }).',
          { meta: { extension: 'db2' } },
        );
      }

      const runtime = getRuntime();
      if (driverConnected) {
        return runtime;
      }

      await connectDriver(binding);
      return runtime;
    },
    runtime() {
      return getRuntime();
    },
    prepare,

    transaction<R>(fn: (tx: Db2TransactionContext<TContract>) => PromiseLike<R>): Promise<R> {
      let runtime: ReturnType<typeof getRuntime>;
      try {
        runtime = getRuntime();
      } catch (err) {
        return Promise.reject(err);
      }
      return withTransaction(runtime, (txCtx) => {
        const txSqlNamespace = sqlBuilder<TContract>({ context, rawCodecInferer })[
          UNBOUND_NAMESPACE_ID
        ];
        assertDefined(
          txSqlNamespace,
          'the unbound namespace always exists on a db2 builder output',
        );
        const txSql: UnboundSql<TContract> = blindCast<
          UnboundSql<TContract>,
          'Db<TContract> indexed by a literal key widens NsId to string; TableProxy is invariant in NsId via insert()/update() parameter positions, so the indexed-access type cannot be proven to match the literal-keyed Namespace without this cast'
        >(txSqlNamespace);

        const txOrm: UnboundOrm<TContract> = unboundOrm(
          ormBuilder({
            runtime: {
              query(plan) {
                return txCtx.query(plan);
              },
              execute(plan) {
                return txCtx.execute(plan);
              },
            },
            context,
          }),
        );

        // Use `txCtx` as the prototype instead of spreading it so that live
        // accessors (notably the `invalidated` getter, which reads a closure
        // variable in `withTransaction`) remain wired to the original object.
        const tx: Db2TransactionContext<TContract> = Object.assign(
          castAs<TransactionContext>(Object.create(txCtx)),
          { sql: txSql, orm: txOrm, enums },
        );

        return fn(tx);
      });
    },

    close(): Promise<void> {
      if (closePromise) return closePromise;
      closed = true;
      closePromise = (async () => {
        await connectPromise?.catch(() => undefined);
        await ownedDispose?.();
      })();
      return closePromise;
    },

    [Symbol.asyncDispose](): Promise<void> {
      return this.close();
    },
  };
}

// ---------------------------------------------------------------------------
// Db2RuntimeImpl — concrete SqlRuntimeBase subclass for Db2
// ---------------------------------------------------------------------------

class Db2RuntimeImpl<
  TContract extends Contract<SqlStorage> = Contract<SqlStorage>,
> extends SqlRuntimeBase<TContract> {}
