import { RespondFn } from '@slack/bolt';
import { logger } from '../lib/logger';
import { toAppError } from '../lib/errors';
import { msg } from '../messages';

/**
 * Wrap async handler work that happens after `ack()`.
 * Catches any thrown error, logs it with a correlation ID, and sends a
 * user-friendly message back via `respond()` so Slack always gets a reply.
 */
export async function withErrorHandling(
  respond: RespondFn,
  context: string,
  fn: () => Promise<void>,
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    const appErr = toAppError(err);
    logger.error(
      { err, correlationId: appErr.correlationId, context },
      'Unhandled error in Slack handler',
    );
    try {
      await respond({
        text: msg.general.errorWithId(appErr.correlationId),
        response_type: 'ephemeral',
      });
    } catch (respondErr) {
      logger.error(respondErr, 'Failed to send error response to Slack');
    }
  }
}

/**
 * Format a Date for display in Slack messages.
 */
export function formatTs(date: Date): string {
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  });
}

/**
 * Parse the standard `<assetNameOrId> <quantity> [unit]` command text.
 * Returns null if the quantity cannot be found.
 */
export function parseCountArgs(text: string): {
  nameOrId: string;
  quantity: string;
  unit?: string;
} | null {
  const tokens = text.trim().split(/\s+/);
  if (tokens.length < 2) return null;

  // Work from the right: if the last token is non-numeric it's the unit,
  // the token before it must be the quantity; otherwise the last token is the quantity.
  const last = tokens[tokens.length - 1];
  const isNumber = (s: string) => /^\d+\.?\d*$/.test(s);

  if (isNumber(last)) {
    return {
      nameOrId: tokens.slice(0, -1).join(' '),
      quantity: last,
    };
  }

  if (tokens.length >= 3 && isNumber(tokens[tokens.length - 2])) {
    return {
      nameOrId: tokens.slice(0, -2).join(' '),
      quantity: tokens[tokens.length - 2],
      unit: last,
    };
  }

  return null;
}
