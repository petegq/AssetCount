import { App } from '@slack/bolt';
import { withErrorHandling, formatTs } from '../middleware';
import { header, section, fields, divider, context, typeBadge } from '../blocks';
import { assetRepository } from '../../repositories/AssetRepository';
import { assetEvaluationService } from '../../services/AssetEvaluationService';
import { unitConversionService } from '../../services/UnitConversionService';
import { AssetType } from '../../lib/types';
import { msg } from '../../messages';

export function registerInventoryCommand(app: App): void {
  app.command('/inventory', async ({ command, ack, respond }) => {
    await ack();

    await withErrorHandling(respond, '/inventory', async () => {
      const nameOrId = command.text.trim();
      if (!nameOrId) {
        await respond({ text: 'Usage: `/inventory <asset-name-or-id>`', response_type: 'ephemeral' });
        return;
      }

      const asset = await assetRepository.resolve(nameOrId);
      if (!asset) {
        await respond({ text: msg.general.notFound('asset', nameOrId), response_type: 'ephemeral' });
        return;
      }

      const result = await assetEvaluationService.evaluateSingle(asset);
      const blocks = buildInventoryBlocks(asset, result);

      await respond({ text: `Inventory: ${asset.name}`, blocks, response_type: 'ephemeral' });
    });
  });
}

// ── Block builder ─────────────────────────────────────────────────────────────

function buildInventoryBlocks(
  asset: Awaited<ReturnType<typeof assetRepository.resolve>> & object,
  result: Awaited<ReturnType<typeof assetEvaluationService.evaluateSingle>>,
) {
  const badge = typeBadge(asset.type);

  const blocks = [
    header(asset.name),
    section(`${badge}  ·  ${asset.category.name}`),
    divider(),
  ];

  if (asset.type === AssetType.COUNTABLE) {
    if (result.kind === 'countable') {
      blocks.push(
        section(msg.inventory.currentCount(
          unitConversionService.format(result.quantityUoM, asset.uom),
          '',
        ).trim()),
        fields(
          `*In ${asset.uom}:*\n${unitConversionService.format(result.quantityUoM, asset.uom)}`,
          `*In ${asset.uoo}:*\n${unitConversionService.format(result.quantityUoO, asset.uoo)}`,
        ),
        context(msg.inventory.lastCounted(formatTs(result.lastCountedAt))),
      );
    } else {
      blocks.push(
        section(`_${msg.inventory.neverCounted}_`),
        fields(`*UoM:*\n${asset.uom}`, `*UoO:*\n${asset.uoo}`),
      );
    }
  } else {
    // DERIVED
    if (result.kind === 'derived-ok') {
      blocks.push(
        fields(
          `*Computed value (${asset.uom}):*\n*${unitConversionService.format(result.value, asset.uom)}*`,
          `*In ${asset.uoo}:*\n${unitConversionService.format(result.valueUoO, asset.uoo)}`,
        ),
        section(msg.inventory.derivedFormula(asset.formula ?? '—')),
      );

      if (result.inputValues.size > 0) {
        const inputLines = [...result.inputValues.entries()]
          .map(([varName, entry]) =>
            `• \`${varName}\` = *${entry.assetName}*: ${unitConversionService.format(entry.quantityUoM, asset.uom)}`,
          )
          .join('\n');
        blocks.push(section(`*Inputs:*\n${inputLines}`));
      }

      blocks.push(context('_Derived assets are always computed on read — never stored as a stock figure._'));
    } else if (result.kind === 'derived-error') {
      const errorText =
        result.error === 'DIVISION_BY_ZERO'
          ? msg.inventory.divisionByZero
          : `_Error evaluating formula: ${result.detail}_`;
      blocks.push(
        section(errorText),
        section(msg.inventory.derivedFormula(asset.formula ?? '—')),
      );
    } else {
      blocks.push(section(`_No formula set for this derived asset. Use \`/formula set ${asset.name}\` to configure it._`));
    }
  }

  if (asset.archivedAt) {
    blocks.push(divider(), context(`:archive_box: This asset was archived on ${formatTs(asset.archivedAt)}.`));
  }

  return blocks;
}
