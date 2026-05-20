import { randomBytes } from 'crypto';

export function makeCorrelationId(): string {
  return randomBytes(4).toString('hex'); // e.g. "a3f2c1d0"
}

/**
 * Base error class for all application errors.
 * `userMessage` is safe to show in Slack; `message` is for server logs only.
 */
export class AppError extends Error {
  public readonly correlationId: string;
  public readonly userMessage: string;

  constructor(message: string, userMessage?: string, correlationId?: string) {
    super(message);
    this.name = 'AppError';
    this.correlationId = correlationId ?? makeCorrelationId();
    this.userMessage = userMessage ?? 'Something went wrong. Please try again.';
    Error.captureStackTrace(this, AppError);
  }
}

export class NotFoundError extends AppError {
  constructor(entity: string, identifier: string) {
    super(
      `${entity} not found: ${identifier}`,
      `Could not find ${entity}: *${identifier}*`,
    );
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string, userMessage?: string) {
    super(message, userMessage ?? message);
    this.name = 'ValidationError';
  }
}

export class ConflictError extends AppError {
  constructor(message: string, userMessage?: string) {
    super(message, userMessage ?? message);
    this.name = 'ConflictError';
  }
}

/**
 * Converts any thrown value into an AppError, assigning a correlation ID.
 * Use at Slack handler boundaries before calling respond() or postMessage().
 */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof Error) {
    return new AppError(err.message, undefined, makeCorrelationId());
  }
  return new AppError(String(err), undefined, makeCorrelationId());
}
