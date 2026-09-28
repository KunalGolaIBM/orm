import { SqlConnectionError, SqlQueryError } from '@internal/sql-errors';
import { blindCast } from '@internal/utils/casts';

export interface Db2ErrorLike extends Error {
  readonly state?: string;
  readonly sqlState?: string;
  readonly sqlcode?: number;
  readonly message: string;
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
  if (!(error instanceof Error)) {
    return new Error(String(error));
  }

  const db2Err = blindCast<Db2ErrorLike, 'Extract Db2 error state and codes'>(error);
  const sqlState = db2Err.sqlState ?? db2Err.state;

  if (isDb2ConnectionError(error, sqlState)) {
    return new SqlConnectionError(error.message, {
      cause: error,
      transient: isTransientDb2ConnectionError(error, sqlState),
    });
  }

  if (isDb2SqlState(sqlState)) {
    return new SqlQueryError(error.message, {
      cause: error,
      // biome-ignore lint/style/noNonNullAssertion: isDb2SqlState verifies truthy
      sqlState: sqlState!,
    });
  }

  return error;
}
