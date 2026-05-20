import { App } from '@slack/bolt';
import Decimal from 'decimal.js';
import { withErrorHandling } from '../middleware';
import { header, section, divider, context } from '../blocks';
import { config } from '../../lib/config';
import { assetRepository } from '../../repositories/AssetRepository';
import { assetEvaluationService, AssetValueResult } from '../../services/AssetEvaluationService';
import { unitConversionService } from '../../services/UnitConversionService';

export function registerSheetOutputCommand(app: App): void {
  app.command('/sheet-output', async ({ command, ack, respond }) => {
    await ack();

    void command; // channel_id not needed — response is always ephemeral
    await withErrorHandling(respond, '/sheet-output', async () => {
      const order = parseOrder(config.SPREADSHEET_OUTPUT_ORDER);

      if (order.length === 0) {
        await respond({
          text: 'Spreadsheet output is not configured.',
          blocks: [
            header('Spreadsheet Output'),
            section(
              ':gear: *Not configured.*\n\nSet `SPREADSHEET_OUTPUT_ORDER` in your `.env` file to a comma-separated list of asset names (in the order you want them in your spreadsheet).\n\nExample:\n```SPREADSHEET_OUTPUT_ORDER=DT Emergency Buffer,Duplicate DTs,Total Operational DTs```',
            ),
          ],
          response_type: 'ephemeral',
        });
        return;
      }

      // Resolve every name/ID in order, collect results
      const allAssets = await assetRepository.findMany({ includeArchived: false });
      const resultMap = await assetEvaluationService.evaluateAll(allAssets);

      const rows: OutputRow[] = [];
      for (const nameOrId of order) {
        const asset = await assetRepository.resolve(nameOrId);
        if (!asset) {
          rows.push({ label: nameOrId, value: null, warning: 'asset not found' });
          continue;
        }
        const result = resultMap.get(asset.id);
        rows.push(resolveRow(asset, result));
      }

      const warnings = rows.filter((r) => r.warning);
      const unit = config.SPREADSHEET_OUTPUT_UNIT;

      // ── Verification table ────────────────────────────────────────────────
      const tableLines = rows.map((r) => {
        const valStr = r.value !== null ? r.value.toString() : '0';
        const warn = r.warning ? ` ⚠ _${r.warning}_` : '';
        return `*${r.label}*  →  \`${valStr}\`${warn}`;
      });

      // ── Values-only block for pasting ─────────────────────────────────────
      const valueLines = rows.map((r) => (r.value !== null ? r.value.toString() : '0'));
      const copyBlock = `\`\`\`\n${valueLines.join('\n')}\n\`\`\``;

      const blocks = [
        header('Spreadsheet Output'),
        context(`Unit: *${unit.toUpperCase()}* · ${order.length} asset(s) · copy the block below and paste into your column`),
        divider(),
        section(tableLines.join('\n')),
        divider(),
        section(`*Values only — paste into spreadsheet column:*\n${copyBlock}`),
      ];

      if (warnings.length > 0) {
        blocks.push(
          divider(),
          context(
            `:warning: ${warnings.length} asset(s) could not be resolved and output as \`0\`. ` +
              `Check \`SPREADSHEET_OUTPUT_ORDER\` in your .env: ${warnings.map((w) => `_${w.label}_`).join(', ')}`,
          ),
        );
      }

      // Ephemeral so it only shows to the requester — avoids channel noise
      await respond({
        text: `Spreadsheet output (${order.length} rows)`,
        blocks,
        response_type: 'ephemeral',
      });
    });
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

interface OutputRow {
  label: string;
  value: Decimal | null;
  warning?: string;
}

function parseOrder(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function resolveRow(
  asset: Awaited<ReturnType<typeof assetRepository.resolve>> & object,
  result: AssetValueResult | undefined,
): OutputRow {
  const factor = new Decimal(asset.conversionFactor.toString());
  const unit = config.SPREADSHEET_OUTPUT_UNIT;

  if (!result || result.kind === 'never-counted') {
    return { label: asset.name, value: new Decimal(0), warning: 'never counted — using 0' };
  }

  if (result.kind === 'countable') {
    const value = unit === 'uoo'
      ? unitConversionService.toUoO(result.quantityUoM, factor)
      : result.quantityUoM;
    return { label: asset.name, value };
  }

  if (result.kind === 'derived-ok') {
    const value = unit === 'uoo'
      ? unitConversionService.toUoO(result.value, factor)
      : result.value;
    return { label: asset.name, value };
  }

  // derived-error
  const warningText =
    result.error === 'DIVISION_BY_ZERO' ? 'division by zero — using 0' : `eval error — using 0`;
  return { label: asset.name, value: new Decimal(0), warning: warningText };
}
