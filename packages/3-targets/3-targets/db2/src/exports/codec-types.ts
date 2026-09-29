/**
 * Codec type definitions for the Db2 target.
 *
 * Defining `CodecTypes` here (rather than re-exporting from `core/codecs`)
 * keeps the tsdown DTS bundler from emitting a private chunk path in
 * downstream `.d.mts` files: consumers see `CodecTypes` resolved via this
 * public entry point rather than via a hash-named internal chunk (TML-2357).
 */

/**
 * Phantom codec type map for the Db2 target.
 *
 * Manually declared here because the Db2 MVP uses `AnyCodecDescriptor` (typed
 * return from `makeDescriptor`) for its codec descriptors, which would widen
 * `codecId` to `string` when passed through `ExtractCodecTypes`. Explicit
 * declaration preserves the literal codec-id → (input, output, json, traits)
 * mapping that the contract type pipeline depends on.
 */
export type CodecTypes = {
  readonly 'db2/varchar@1': {
    readonly input: string;
    readonly output: string;
    readonly json: string;
    readonly traits: never;
  };
  readonly 'db2/integer@1': {
    readonly input: number;
    readonly output: number;
    readonly json: number;
    readonly traits: never;
  };
  readonly 'db2/bigint@1': {
    readonly input: bigint;
    readonly output: string;
    readonly json: string;
    readonly traits: never;
  };
  readonly 'db2/boolean@1': {
    readonly input: boolean;
    readonly output: boolean;
    readonly json: boolean;
    readonly traits: never;
  };
};
