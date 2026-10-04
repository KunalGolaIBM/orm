import { SqlConnectionError, SqlQueryError } from '@internal/sql-errors';
import { blindCast } from '@internal/utils/casts';

export interface Db2ErrorLike extends Error {
  readonly state?: string;
  readonly sqlState?: string;
  // ibm_db spells it sqlstate (lowercase) in its DB2Error interface
  readonly sqlstate?: string;
  readonly sqlcode?: number;
  readonly message: string;
}

/**
 * ibm_db sometimes throws plain objects (not Error instances) with sqlstate/sqlcode.
 * Normalise them into a real Error so downstream code can use instanceof.
 */
function coerceToError(error: unknown): Error {
  if (error instanceof Error) return error;
  // Plain ibm_db error object: { sqlstate, sqlcode, message }
  const obj = blindCast<
    Record<string, unknown>,
    'ibm_db plain error objects are untyped unknown; fields are accessed defensively below'
  >(error);
  const msg =
    typeof obj['message'] === 'string'
      ? obj['message']
      : `[ibm_db error] sqlstate=${String(obj['sqlstate'] ?? obj['state'] ?? 'unknown')} sqlcode=${String(obj['sqlcode'] ?? '?')}`;
  const err = Object.assign(new Error(msg), {
    sqlstate: obj['sqlstate'],
    sqlState: obj['sqlState'] ?? obj['sqlstate'],
    state: obj['state'] ?? obj['sqlstate'],
    sqlcode: obj['sqlcode'],
  });
  return err;
}

function isDb2SqlState(state: string | undefined): boolean {
  if (!state) {
    return false;
  }
  return /^[A-Z0-9]{5}$/.test(state);
}

function isDb2ConnectionError(error: Error, sqlState?: string): boolean {
  if (sqlState) {
    // 08xxx are connection exceptions (08001: unable to connect, 08003: connection does not exist, 08004: rejected, etc.)
    if (sqlState.startsWith('08')) {
      return true;
    }
  }

  const message = error.message.toLowerCase();
  if (
    message.includes('connection closed') ||
    message.includes('connection refused') ||
    message.includes('connection timeout') ||
    message.includes('connection reset') ||
    message.includes('communication error') ||
    message.includes('sql30081n') ||
    message.includes('sql30082n') ||
    message.includes('sql1024n')
  ) {
    return true;
  }

  return false;
}

function isTransientDb2ConnectionError(error: Error, sqlState?: string): boolean {
  if (
    sqlState === '08001' ||
    sqlState === '40001' ||
    sqlState === '57011' ||
    sqlState === '57033'
  ) {
    return true;
  }

  const message = error.message.toLowerCase();
  if (
    message.includes('timeout') ||
    message.includes('deadlock') ||
    message.includes('connection reset')
  ) {
    return true;
  }

  return false;
}

export function normalizeDb2Error(error: unknown): SqlQueryError | SqlConnectionError | Error {
  const coerced = coerceToError(error);
  const db2Err = blindCast<Db2ErrorLike, 'Extract Db2 error state and codes'>(coerced);
  const sqlState = db2Err.sqlState ?? db2Err.sqlstate ?? db2Err.state;

  if (isDb2ConnectionError(coerced, sqlState)) {
    return new SqlConnectionError(coerced.message, {
      cause: coerced,
      transient: isTransientDb2ConnectionError(coerced, sqlState),
    });
  }

  if (isDb2SqlState(sqlState)) {
    return new SqlQueryError(coerced.message, {
      cause: coerced,
      // biome-ignore lint/style/noNonNullAssertion: isDb2SqlState verifies truthy
      sqlState: sqlState!,
    });
  }

  return coerced;
}
