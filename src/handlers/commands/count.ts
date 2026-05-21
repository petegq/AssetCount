import { App, BlockAction, ButtonAction } from '@slack/bolt';
import Decimal from 'decimal.js';
import { withErrorHandling, parseCountArgs } from '../middleware';
import { section, fields, divider, numberInput, externalSelect, quickAddButtons } from '../blocks';
import { assetRepository } from '../../repositories/AssetRepository';
import { countRepository } from '../../repositories/CountRepository';
import { sessionRepository } from '../../repositories/SessionRepository';
import { auditRepository } from '../../repositories/AuditRepository';
import { discrepancyService } from '../../services/DiscrepancyService';
import { unitConversionService } from '../../services/UnitConversionService';
import { AssetType, AuditAction } from '../../lib/types';
import { msg } from '../../messages';
import { ValidationError } from '../../lib/errors';

const COUNT_MODAL_CALLBACK = 'count_modal_submit';
const QUICK_ADD_PREFIX = 'quick_add';
const QUICK_ADD_INCREMENTS = [1, 10, 100];

const BLOCK = {
  ASSET: 'asset_block',
  QUANTITY: 'quantity_block',
  QUICK_ADD: 'quick_add_block',
};
const ACTION = {
  ASSET: 'asset_input',
  QUANTITY: 'quantity_input',
};

type InitialOption = { text: { type: 'plain_text'; text: string }; value: string };

export function registerCountCommand(app: App): void {
  // ── Asset search options for external_select ──────────────────────────────

  app.options(ACTION.ASSET, async ({ options, ack }) => {
    const query = (options as { value?: string }).value?.toLowerCase() ?? '';
    const assets = await assetRepository.findMany({ includeArchived: false });
    const countable = assets
      .filter((a) => a.type === AssetType.COUNTABLE)
      .filter((a) => !query || a.name.toLowerCase().includes(query))
      .slice(0, 100);

    await ack({
      options: countable.map((a) => ({
        text: { type: 'plain_text' as const, text: a.name },
        value: a.id,
      })),
    });
  });

  // ── Quick-add button actions ──────────────────────────────────────────────

  app.action(/^quick_add_\d+$/, async ({ ack, body, action, client }) => {
    await ack();

    const b = body as BlockAction;
    if (!b.view) return;

    const increment = Number((action as ButtonAction).value ?? '0');
    const values = b.view.state.values;

    const currentQtyStr = values[BLOCK.QUANTITY]?.[ACTION.QUANTITY]?.value ?? '0';
    const currentQty = isNaN(Number(currentQtyStr)) ? new Decimal(0) : new Decimal(currentQtyStr);
    const newQty = currentQty.plus(increment);

    const selectedOption = values[BLOCK.ASSET]?.[ACTION.ASSET]?.selected_option as InitialOption | null;
    const initialOption = selectedOption
      ? { text: { type: 'plain_text' as const, text: selectedOption.text.text }, value: selectedOption.value }
      : undefined;

    const meta = JSON.parse(b.view.private_metadata || '{}') as { channelId?: string };

    await client.views.update({
      view_id: b.view.id,
      view: buildCountModal(meta.channelId ?? b.user.id, newQty.toString(), initialOption),
    });
  });

  // ── Quick command: /count <asset> <qty> [unit] ────────────────────────────

  app.command('/count', async ({ command, ack, respond, client }) => {
    await ack();

    const text = command.text.trim();

    if (!text) {
      await client.views.open({
        trigger_id: command.trigger_id,
        view: buildCountModal(command.channel_id),
      });
      return;
    }

    await withErrorHandling(respond, '/count', async () => {
      const parsed = parseCountArgs(text);
      if (!parsed) {
        await respond({
          text: 'Usage: `/count <asset-name-or-id> <quantity> [unit]`',
          response_type: 'ephemeral',
        });
        return;
      }

      await processCount({
        nameOrId: parsed.nameOrId,
        quantityStr: parsed.quantity,
        slackUserId: command.user_id,
        respond,
        client,
      });
    });
  });

  // ── Modal submission ──────────────────────────────────────────────────────

  app.view(COUNT_MODAL_CALLBACK, async ({ ack, body, view, client }) => {
    const values = view.state.values;
    const assetId = values[BLOCK.ASSET]?.[ACTION.ASSET]?.selected_option?.value ?? '';
    const quantityStr = values[BLOCK.QUANTITY]?.[ACTION.QUANTITY]?.value ?? '';

    if (!assetId) {
      await ack({ response_action: 'errors', errors: { [BLOCK.ASSET]: 'Please select an asset.' } });
      return;
    }
    if (!quantityStr || isNaN(Number(quantityStr)) || Number(quantityStr) < 0) {
      await ack({ response_action: 'errors', errors: { [BLOCK.QUANTITY]: 'Enter a valid positive number.' } });
      return;
    }

    const asset = await assetRepository.resolve(assetId);
    if (!asset) {
      await ack({ response_action: 'errors', errors: { [BLOCK.ASSET]: 'Asset not found — please try again.' } });
      return;
    }
    if (asset.type === AssetType.DERIVED) {
      const inputNames = asset.inputs.map((i) => i.inputAsset.name);
      await ack({ response_action: 'errors', errors: { [BLOCK.ASSET]: `${asset.name} is derived — count its inputs instead: ${inputNames.join(', ')}` } });
      return;
    }

    await ack();

    const meta = JSON.parse(view.private_metadata || '{}') as { channelId?: string };
    const channelId = meta.channelId ?? body.user.id;

    try {
      const quantity = new Decimal(quantityStr);
      const session = await sessionRepository.findActiveByUser(body.user.id);
      const count = await countRepository.create({ assetId: asset.id, quantity, slackUserId: body.user.id, sessionId: session?.id });
      await auditRepository.append({ action: AuditAction.COUNT, slackUserId: body.user.id, assetId: asset.id, after: { quantity: quantity.toString(), countId: count.id } });
      const factor = new Decimal(asset.conversionFactor.toString());
      await client.chat.postMessage({
        channel: channelId,
        text: unitConversionService.formatBoth(quantity, asset.uom, factor, asset.uoo),
        blocks: buildCountSuccessBlocks(asset.name, quantity, factor, asset.uom, asset.uoo, body.user.id),
      });
      await discrepancyService.alertIfNeeded(asset, quantity, body.user.id, client);
    } catch (err) {
      const { toAppError } = await import('../../lib/errors');
      const appErr = toAppError(err);
      await client.chat.postMessage({ channel: channelId, text: msg.general.errorWithId(appErr.correlationId) });
    }
  });
}

// ── Shared count processor ────────────────────────────────────────────────────

async function processCount(opts: {
  nameOrId: string;
  quantityStr: string;
  slackUserId: string;
  respond: Parameters<typeof withErrorHandling>[0];
  client: App['client'];
}) {
  const { nameOrId, quantityStr, slackUserId, respond, client } = opts;

  const asset = await assetRepository.resolve(nameOrId);

  if (!asset) {
    const all = await assetRepository.findMany({ includeArchived: false });
    const matches = all
      .filter((a) => a.name.toLowerCase().includes(nameOrId.toLowerCase()))
      .slice(0, 5);

    if (matches.length > 0) {
      const list = matches.map((a) => `• \`${a.id}\` — *${a.name}*`).join('\n');
      await respond({ text: `Asset not found. Did you mean one of these?\n${list}`, response_type: 'ephemeral' });
    } else {
      await respond({ text: msg.general.notFound('asset', nameOrId), response_type: 'ephemeral' });
    }
    return;
  }

  if (asset.archivedAt) {
    await respond({ text: msg.general.archived(asset.name), response_type: 'ephemeral' });
    return;
  }

  if (asset.type === AssetType.DERIVED) {
    const inputNames = asset.inputs.map((i) => i.inputAsset.name);
    await respond({ text: msg.count.isDerived(asset.name, inputNames), response_type: 'ephemeral' });
    return;
  }

  if (!/^\d+\.?\d*$/.test(quantityStr)) {
    throw new ValidationError(msg.count.invalidQuantity, msg.count.invalidQuantity);
  }

  const quantity = new Decimal(quantityStr);
  const session = await sessionRepository.findActiveByUser(slackUserId);
  const count = await countRepository.create({ assetId: asset.id, quantity, slackUserId, sessionId: session?.id });

  await auditRepository.append({
    action: AuditAction.COUNT,
    slackUserId,
    assetId: asset.id,
    after: { quantity: quantity.toString(), countId: count.id, sessionId: session?.id },
  });

  const factor = new Decimal(asset.conversionFactor.toString());
  await respond({
    text: unitConversionService.formatBoth(quantity, asset.uom, factor, asset.uoo),
    blocks: buildCountSuccessBlocks(asset.name, quantity, factor, asset.uom, asset.uoo, slackUserId),
    response_type: 'in_channel',
  });

  await discrepancyService.alertIfNeeded(asset, quantity, slackUserId, client);
}

// ── Block builders ────────────────────────────────────────────────────────────

function buildCountSuccessBlocks(
  assetName: string,
  qtyUoM: Decimal,
  factor: Decimal,
  uom: string,
  uoo: string,
  slackUserId: string,
) {
  const qtyStr = unitConversionService.formatBoth(qtyUoM, uom, factor, uoo);
  return [
    section(`:package: Count recorded`),
    fields(`*Asset:*\n${assetName}`, `*Quantity:*\n${qtyStr}`, `*By:*\n<@${slackUserId}>`),
    divider(),
  ];
}

function buildCountModal(
  channelId: string,
  initialQuantity?: string,
  initialOption?: InitialOption,
) {
  return {
    type: 'modal' as const,
    callback_id: COUNT_MODAL_CALLBACK,
    private_metadata: JSON.stringify({ channelId }),
    title: { type: 'plain_text' as const, text: 'Record a Count' },
    submit: { type: 'plain_text' as const, text: 'Record' },
    close: { type: 'plain_text' as const, text: 'Cancel' },
    blocks: [
      externalSelect({
        blockId: BLOCK.ASSET,
        actionId: ACTION.ASSET,
        label: 'Asset',
        placeholder: 'Search for an asset…',
        minQueryLength: 0,
        initialOption,
      }),
      numberInput({
        blockId: BLOCK.QUANTITY,
        actionId: ACTION.QUANTITY,
        label: 'Quantity (in UoM)',
        placeholder: 'e.g. 42',
        isDecimalAllowed: true,
        initialValue: initialQuantity,
      }),
      quickAddButtons(BLOCK.QUICK_ADD, QUICK_ADD_INCREMENTS, QUICK_ADD_PREFIX),
    ],
  };
}
