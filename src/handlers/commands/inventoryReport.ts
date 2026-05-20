import { App } from '@slack/bolt';
import Decimal from 'decimal.js';
import { stringify } from 'csv-stringify/sync';
import { withErrorHandling, formatTs } from '../middleware';
import { header, section, divider, context } from '../blocks';
import { assetRepository } from '../../repositories/AssetRepository';
import { assetEvaluationService, AssetValueResult } from '../../services/AssetEvaluationService';
import { unitConversionService } from '../../services/UnitConversionService';
import { AssetType } from '../../lib/types';
import { msg } from '../../messages';
import { logger } from '../../lib/logger';

export function registerInventoryReportCommand(app: App): void {
  app.command('/inventory-report', async ({ command, ack, respond, client }) => {
    await ack();

    await withErrorHandling(respond, '/inventory-report', async () => {
      // Optional category filter
      const categoryFilter = command.text.trim() || undefined;

      await respond({
        text: ':hourglass: Generating inventory report…',
        response_type: 'ephemeral',
      });

      const assets = await assetRepository.findMany({
        categoryId: undefined,
        includeArchived: false,
      });

      const filtered = categoryFilter
        ? assets.filter((a) => a.category.name.toLowerCase() === categoryFilter.toLowerCase())
        : assets;

      if (filtered.length === 0) {
        await respond({
          text: categoryFilter
            ? `No assets found in category *${categoryFilter}*.`
            : 'No active assets found.',
          response_type: 'ephemeral',
        });
        return;
      }

      const resultMap = await assetEvaluationService.evaluateAll(filtered);

      const csvRows = buildCsvRows(filtered, resultMap);
      const csvContent = stringify(csvRows, { header: true });

      const reportTitle = categoryFilter
        ? `Inventory Report — ${categoryFilter}`
        : 'Inventory Report — All Assets';

      const summaryBlocks = buildSummaryBlocks(reportTitle, filtered, resultMap);

      // Post summary message to the channel
      await respond({
        text: reportTitle,
        blocks: summaryBlocks,
        response_type: 'in_channel',
      });

      // Upload CSV
      try {
        await client.files.uploadV2({
          channel_id: command.channel_id,
          content: csvContent,
          filename: `inventory-${new Date().toISOString().slice(0, 10)}.csv`,
          title: reportTitle,
        });
      } catch (err) {
        logger.error(err, 'Failed to upload inventory CSV');
        await respond({
          text: ':warning: Could not upload CSV — the summary above is still accurate.',
          response_type: 'ephemeral',
        });
      }
    });
  });
}

// ── CSV builder ───────────────────────────────────────────────────────────────

interface CsvRow {
  name: string;
  type: string;
  category: string;
  uom: string;
  uoo: string;
  value_uom: string;
  value_uoo: string;
  last_counted_at: string;
  formula: string;
  notes: string;
}

function buildCsvRows(
  assets: Awaited<ReturnType<typeof assetRepository.findMany>>,
  resultMap: Map<string, AssetValueResult>,
): CsvRow[] {
  return assets.map((asset) => {
    const result = resultMap.get(asset.id);
    const factor = new Decimal(asset.conversionFactor.toString());

    let valueUoM = '';
    let valueUoO = '';
    let lastCountedAt = '';
    let notes = '';

    if (!result || result.kind === 'never-counted') {
      notes = 'Never counted';
    } else if (result.kind === 'countable') {
      valueUoM = result.quantityUoM.toString();
      valueUoO = unitConversionService.toUoO(result.quantityUoM, factor).toString();
      lastCountedAt = formatTs(result.lastCountedAt);
    } else if (result.kind === 'derived-ok') {
      valueUoM = result.value.toString();
      valueUoO = result.valueUoO.toString();
      notes = `Computed from: ${[...result.inputValues.entries()].map(([v, e]) => `${v}=${e.assetName}`).join(', ')}`;
    } else {
      notes = `Error: ${result.error} — ${result.detail}`;
    }

    return {
      name: asset.name,
      type: asset.type,
      category: asset.category.name,
      uom: asset.uom,
      uoo: asset.uoo,
      value_uom: valueUoM,
      value_uoo: valueUoO,
      last_counted_at: lastCountedAt,
      formula: asset.formula ?? '',
      notes,
    };
  });
}

// ── Slack summary blocks ──────────────────────────────────────────────────────

function buildSummaryBlocks(
  title: string,
  assets: Awaited<ReturnType<typeof assetRepository.findMany>>,
  resultMap: Map<string, AssetValueResult>,
) {
  const countable = assets.filter((a) => a.type === AssetType.COUNTABLE);
  const derived = assets.filter((a) => a.type === AssetType.DERIVED);
  const neverCounted = assets.filter((a) => resultMap.get(a.id)?.kind === 'never-counted');
  const errors = assets.filter((a) => resultMap.get(a.id)?.kind === 'derived-error');

  const blocks = [
    header(title),
    section(
      `*${assets.length}* assets total · *${countable.length}* countable · *${derived.length}* derived`,
    ),
    divider(),
  ];

  // List derived assets with their computed values inline
  for (const asset of derived.slice(0, 10)) {
    const result = resultMap.get(asset.id);
    const factor = new Decimal(asset.conversionFactor.toString());
    let valueStr: string;
    if (result?.kind === 'derived-ok') {
      valueStr = unitConversionService.formatBoth(result.value, asset.uom, factor, asset.uoo);
    } else if (result?.kind === 'derived-error' && result.error === 'DIVISION_BY_ZERO') {
      valueStr = msg.inventory.divisionByZero;
    } else {
      valueStr = '_not evaluated_';
    }
    blocks.push(section(`\`DERIVED\` *${asset.name}*\n${valueStr}`));
  }

  if (derived.length > 10) {
    blocks.push(section(`_…and ${derived.length - 10} more derived assets (see CSV)_`));
  }

  if (neverCounted.length > 0) {
    blocks.push(
      divider(),
      context(`:warning: ${neverCounted.length} asset(s) have never been counted.`),
    );
  }
  if (errors.length > 0) {
    blocks.push(context(`:x: ${errors.length} derived asset(s) could not be evaluated (see CSV for details).`));
  }

  blocks.push(
    divider(),
    context(`Generated at ${formatTs(new Date())} · _See attached CSV for full data_`),
  );

  return blocks;
}
