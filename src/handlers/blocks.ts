/**
 * Lightweight Block Kit constructors.
 * All functions return typed `KnownBlock` objects — no raw object literals in handlers.
 */
import { KnownBlock } from '@slack/bolt';

export const header = (text: string): KnownBlock => ({
  type: 'header',
  text: { type: 'plain_text', text, emoji: true },
});

export const section = (text: string): KnownBlock => ({
  type: 'section',
  text: { type: 'mrkdwn', text },
});

export const fields = (...items: string[]): KnownBlock => ({
  type: 'section',
  fields: items.map((t) => ({ type: 'mrkdwn' as const, text: t })),
});

export const context = (...elements: string[]): KnownBlock => ({
  type: 'context',
  elements: elements.map((t) => ({ type: 'mrkdwn' as const, text: t })),
});

export const divider = (): KnownBlock => ({ type: 'divider' });

/** Shorthand for a modal input block with a plain-text input element. */
export const textInput = (opts: {
  blockId: string;
  actionId: string;
  label: string;
  placeholder?: string;
  initialValue?: string;
  multiline?: boolean;
  optional?: boolean;
  hint?: string;
}): KnownBlock => ({
  type: 'input',
  block_id: opts.blockId,
  optional: opts.optional ?? false,
  hint: opts.hint ? { type: 'plain_text', text: opts.hint } : undefined,
  label: { type: 'plain_text', text: opts.label },
  element: {
    type: 'plain_text_input',
    action_id: opts.actionId,
    placeholder: opts.placeholder ? { type: 'plain_text', text: opts.placeholder } : undefined,
    initial_value: opts.initialValue,
    multiline: opts.multiline ?? false,
  },
});

export const numberInput = (opts: {
  blockId: string;
  actionId: string;
  label: string;
  placeholder?: string;
  isDecimalAllowed?: boolean;
  optional?: boolean;
}): KnownBlock => ({
  type: 'input',
  block_id: opts.blockId,
  optional: opts.optional ?? false,
  label: { type: 'plain_text', text: opts.label },
  element: {
    type: 'number_input',
    action_id: opts.actionId,
    is_decimal_allowed: opts.isDecimalAllowed ?? true,
    placeholder: opts.placeholder
      ? { type: 'plain_text', text: opts.placeholder }
      : undefined,
  },
});

/** Build a type badge string for use in section text. */
export const typeBadge = (type: string) =>
  type === 'DERIVED' ? '`DERIVED`' : '`COUNTABLE`';
