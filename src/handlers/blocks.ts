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

/** Searchable dropdown that calls back to the bot for options. */
export const externalSelect = (opts: {
  blockId: string;
  actionId: string;
  label: string;
  placeholder?: string;
  minQueryLength?: number;
  initialOption?: { text: { type: 'plain_text'; text: string }; value: string };
}): KnownBlock => ({
  type: 'input',
  block_id: opts.blockId,
  label: { type: 'plain_text', text: opts.label },
  element: {
    type: 'external_select',
    action_id: opts.actionId,
    placeholder: opts.placeholder ? { type: 'plain_text', text: opts.placeholder } : undefined,
    min_query_length: opts.minQueryLength ?? 0,
    ...(opts.initialOption ? { initial_option: opts.initialOption } : {}),
  },
});

/** Row of increment buttons for quick quantity entry. */
export const quickAddButtons = (
  blockId: string,
  increments: number[],
  actionIdPrefix: string,
): KnownBlock => ({
  type: 'actions',
  block_id: blockId,
  elements: increments.map((n) => ({
    type: 'button' as const,
    text: { type: 'plain_text' as const, text: `+${n}`, emoji: true },
    action_id: `${actionIdPrefix}_${n}`,
    value: String(n),
  })),
});

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
  initialValue?: string;
  hint?: string;
}): KnownBlock => ({
  type: 'input',
  block_id: opts.blockId,
  optional: opts.optional ?? false,
  hint: opts.hint ? { type: 'plain_text', text: opts.hint } : undefined,
  label: { type: 'plain_text', text: opts.label },
  element: {
    type: 'number_input',
    action_id: opts.actionId,
    is_decimal_allowed: opts.isDecimalAllowed ?? true,
    placeholder: opts.placeholder
      ? { type: 'plain_text', text: opts.placeholder }
      : undefined,
    initial_value: opts.initialValue,
  },
});

export const staticSelect = (opts: {
  blockId: string;
  actionId: string;
  label: string;
  placeholder?: string;
  options: { label: string; value: string }[];
  initialValue?: string;
  optional?: boolean;
}): KnownBlock => ({
  type: 'input',
  block_id: opts.blockId,
  optional: opts.optional ?? false,
  label: { type: 'plain_text', text: opts.label },
  element: {
    type: 'static_select',
    action_id: opts.actionId,
    placeholder: opts.placeholder ? { type: 'plain_text', text: opts.placeholder } : undefined,
    options: opts.options.map((o) => ({
      text: { type: 'plain_text' as const, text: o.label },
      value: o.value,
    })),
    ...(opts.initialValue
      ? {
          initial_option: {
            text: { type: 'plain_text' as const, text: opts.options.find((o) => o.value === opts.initialValue)?.label ?? opts.initialValue },
            value: opts.initialValue,
          },
        }
      : {}),
  },
});

/** Build a type badge string for use in section text. */
export const typeBadge = (type: string) =>
  type === 'DERIVED' ? '`DERIVED`' : '`COUNTABLE`';
