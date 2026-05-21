import { App } from '@slack/bolt';
import Decimal from 'decimal.js';
import { withErrorHandling } from '../middleware';
import { header, section, fields, divider, context, textInput, numberInput, staticSelect, typeBadge } from '../blocks';
import { assetRepository } from '../../repositories/AssetRepository';
import { auditRepository } from '../../repositories/AuditRepository';
import { AssetType, AuditAction } from '../../lib/types';
import { msg } from '../../messages';

const REGISTER_MODAL_CALLBACK = 'asset_register_modal_submit';

const BLOCK = {
  NAME: 'asset_name_block',
  CATEGORY: 'asset_category_block',
  TYPE: 'asset_type_block',
  UOM: 'asset_uom_block',
  UOO: 'asset_uoo_block',
  FACTOR: 'asset_factor_block',
};
const ACTION = {
  NAME: 'asset_name_input',
  CATEGORY: 'asset_category_input',
  TYPE: 'asset_type_input',
  UOM: 'asset_uom_input',
  UOO: 'asset_uoo_input',
  FACTOR: 'asset_factor_input',
};

const TYPE_OPTIONS = [
  { label: 'Countable — physically counted on the floor', value: AssetType.COUNTABLE },
  { label: 'Derived — computed from a formula', value: AssetType.DERIVED },
];

export function registerAssetCommand(app: App): void {
  // ── /asset [register | list [category] | archive <name>] ─────────────────

  app.command('/asset', async ({ command, ack, respond, client }) => {
    await ack();

    const text = command.text.trim();
    const lower = text.toLowerCase();

    if (!text || lower === 'register') {
      await client.views.open({
        trigger_id: command.trigger_id,
        view: buildRegisterModal(command.channel_id),
      });
      return;
    }

    if (lower.startsWith('list')) {
      const categoryFilter = text.slice(4).trim() || undefined;
      await withErrorHandling(respond, '/asset list', async () => {
        await listAssets(respond, categoryFilter);
      });
      return;
    }

    if (lower.startsWith('archive ')) {
      const nameOrId = text.slice(8).trim();
      await withErrorHandling(respond, '/asset archive', async () => {
        await archiveAsset(nameOrId, command.user_id, respond);
      });
      return;
    }

    await respond({
      text: 'Usage:\n• `/asset` or `/asset register` — register a new asset\n• `/asset list [category]` — list all assets\n• `/asset archive <name>` — archive an asset',
      response_type: 'ephemeral',
    });
  });

  // ── Modal submission ──────────────────────────────────────────────────────

  app.view(REGISTER_MODAL_CALLBACK, async ({ ack, body, view, client }) => {
    const values = view.state.values;

    const name = values[BLOCK.NAME]?.[ACTION.NAME]?.value?.trim() ?? '';
    const categoryName = values[BLOCK.CATEGORY]?.[ACTION.CATEGORY]?.value?.trim() ?? '';
    const type = (values[BLOCK.TYPE]?.[ACTION.TYPE]?.selected_option?.value ?? '') as AssetType;
    const uom = values[BLOCK.UOM]?.[ACTION.UOM]?.value?.trim() ?? '';
    const uooRaw = values[BLOCK.UOO]?.[ACTION.UOO]?.value?.trim() ?? '';
    const factorRaw = values[BLOCK.FACTOR]?.[ACTION.FACTOR]?.value?.trim() ?? '';

    if (!name) {
      await ack({ response_action: 'errors', errors: { [BLOCK.NAME]: 'Asset name is required.' } });
      return;
    }
    if (!categoryName) {
      await ack({ response_action: 'errors', errors: { [BLOCK.CATEGORY]: 'Category is required.' } });
      return;
    }
    if (!type || !Object.values(AssetType).includes(type)) {
      await ack({ response_action: 'errors', errors: { [BLOCK.TYPE]: 'Please select an asset type.' } });
      return;
    }
    if (!uom) {
      await ack({ response_action: 'errors', errors: { [BLOCK.UOM]: 'Unit of Measure is required.' } });
      return;
    }

    let conversionFactor = new Decimal(1);
    if (factorRaw) {
      const parsed = Number(factorRaw);
      if (isNaN(parsed) || parsed <= 0) {
        await ack({ response_action: 'errors', errors: { [BLOCK.FACTOR]: 'Conversion factor must be a positive number.' } });
        return;
      }
      conversionFactor = new Decimal(factorRaw);
    }

    await ack();

    const meta = JSON.parse(view.private_metadata || '{}') as { channelId?: string };
    const channelId = meta.channelId ?? body.user.id;

    try {
      const category = await assetRepository.findOrCreateCategory(categoryName);
      const uoo = uooRaw || uom;

      const asset = await assetRepository.create({
        name,
        type,
        categoryId: category.id,
        uom,
        uoo,
        conversionFactor,
      });

      await auditRepository.append({
        action: AuditAction.ASSET_CREATE,
        slackUserId: body.user.id,
        assetId: asset.id,
        after: { name, type, category: categoryName, uom, uoo, conversionFactor: conversionFactor.toString() },
      });

      const isDerived = type === AssetType.DERIVED;
      await client.chat.postMessage({
        channel: channelId,
        text: msg.asset.created(name),
        blocks: [
          section(msg.asset.created(name)),
          fields(
            `*Type:*\n${typeBadge(type)}`,
            `*Category:*\n${category.name}`,
            `*UoM:*\n${uom}`,
            `*UoO:*\n${uoo}`,
            ...(conversionFactor.equals(1) ? [] : [`*Conversion factor:*\n${conversionFactor.toString()}`]),
          ),
          ...(isDerived
            ? [
                divider(),
                context(`:bulb: Use \`/formula set ${name}\` to configure this asset's formula.`),
              ]
            : []),
        ],
      });
    } catch (err) {
      const { toAppError } = await import('../../lib/errors');
      const appErr = toAppError(err);
      await client.chat.postMessage({ channel: channelId, text: msg.general.errorWithId(appErr.correlationId) });
    }
  });
}

// ── List ──────────────────────────────────────────────────────────────────────

async function listAssets(
  respond: Parameters<typeof withErrorHandling>[0],
  categoryFilter?: string,
) {
  const assets = await assetRepository.findMany({ includeArchived: false });

  const filtered = categoryFilter
    ? assets.filter((a) => a.category.name.toLowerCase().includes(categoryFilter.toLowerCase()))
    : assets;

  if (filtered.length === 0) {
    const msg2 = categoryFilter
      ? `No assets found in category matching *${categoryFilter}*.`
      : 'No assets registered yet. Use `/asset register` to add one.';
    await respond({ text: msg2, response_type: 'ephemeral' });
    return;
  }

  // Group by category
  const byCategory = new Map<string, typeof filtered>();
  for (const a of filtered) {
    const key = a.category.name;
    const existing = byCategory.get(key) ?? [];
    existing.push(a);
    byCategory.set(key, existing);
  }

  const blocks = [header(`Assets${categoryFilter ? ` — ${categoryFilter}` : ''} (${filtered.length})`)];

  for (const [catName, catAssets] of byCategory) {
    blocks.push(section(`*${catName}*`));
    for (const a of catAssets) {
      const unitStr = a.uom === a.uoo ? a.uom : `${a.uom} → ${a.uoo}`;
      blocks.push(section(`${typeBadge(a.type)}  *${a.name}*  _${unitStr}_`));
    }
    blocks.push(divider());
  }

  // Slack caps blocks at 50 — warn if truncated
  const BLOCK_LIMIT = 49;
  const truncated = blocks.length > BLOCK_LIMIT;
  const displayBlocks = truncated ? blocks.slice(0, BLOCK_LIMIT) : blocks;
  if (truncated) {
    displayBlocks.push(context(`Showing first ${BLOCK_LIMIT} blocks — use \`/asset list <category>\` to filter.`));
  }

  await respond({ text: `Assets (${filtered.length})`, blocks: displayBlocks, response_type: 'ephemeral' });
}

// ── Archive ───────────────────────────────────────────────────────────────────

async function archiveAsset(
  nameOrId: string,
  slackUserId: string,
  respond: Parameters<typeof withErrorHandling>[0],
) {
  const asset = await assetRepository.resolve(nameOrId);
  if (!asset) {
    await respond({ text: msg.general.notFound('asset', nameOrId), response_type: 'ephemeral' });
    return;
  }
  if (asset.archivedAt) {
    await respond({ text: `*${asset.name}* is already archived.`, response_type: 'ephemeral' });
    return;
  }

  // Warn if other derived assets reference this one
  const dependents = await assetRepository.findDerivedAssetsUsingAsInput(asset.id);
  if (dependents.length > 0) {
    await respond({
      text: msg.asset.archiveBlockedByFormula(asset.name, dependents.map((d) => d.name)),
      response_type: 'ephemeral',
    });
    return;
  }

  await assetRepository.archive(asset.id);
  await auditRepository.append({
    action: AuditAction.ASSET_ARCHIVE,
    slackUserId,
    assetId: asset.id,
    before: { name: asset.name },
  });

  await respond({ text: msg.asset.archived(asset.name), response_type: 'ephemeral' });
}

// ── Modal builder ─────────────────────────────────────────────────────────────

function buildRegisterModal(channelId: string) {
  return {
    type: 'modal' as const,
    callback_id: REGISTER_MODAL_CALLBACK,
    private_metadata: JSON.stringify({ channelId }),
    title: { type: 'plain_text' as const, text: 'Register Asset' },
    submit: { type: 'plain_text' as const, text: 'Register' },
    close: { type: 'plain_text' as const, text: 'Cancel' },
    blocks: [
      textInput({
        blockId: BLOCK.NAME,
        actionId: ACTION.NAME,
        label: 'Asset name',
        placeholder: 'e.g. DT Emergency Buffer',
      }),
      textInput({
        blockId: BLOCK.CATEGORY,
        actionId: ACTION.CATEGORY,
        label: 'Category',
        placeholder: 'e.g. Warehouse, Production',
        hint: 'Groups assets in reports. Created automatically if it does not exist.',
      }),
      staticSelect({
        blockId: BLOCK.TYPE,
        actionId: ACTION.TYPE,
        label: 'Asset type',
        placeholder: 'Select type…',
        options: TYPE_OPTIONS,
      }),
      textInput({
        blockId: BLOCK.UOM,
        actionId: ACTION.UOM,
        label: 'Unit of Measure (UoM)',
        placeholder: 'e.g. pallets, boxes, units',
        hint: 'The unit used when counting on the floor.',
      }),
      textInput({
        blockId: BLOCK.UOO,
        actionId: ACTION.UOO,
        label: 'Unit of Output (UoO)',
        placeholder: 'Leave blank to use the same as UoM',
        optional: true,
        hint: 'The unit used in reports and sheet output. Defaults to UoM if blank.',
      }),
      numberInput({
        blockId: BLOCK.FACTOR,
        actionId: ACTION.FACTOR,
        label: 'Conversion factor (UoM → UoO)',
        placeholder: 'Leave blank for 1',
        isDecimalAllowed: true,
        optional: true,
        hint: 'Multiplier applied when converting UoM to UoO. Leave blank if units are the same.',
      }),
    ],
  };
}
