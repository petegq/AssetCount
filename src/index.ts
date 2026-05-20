import cron from 'node-cron';
import Decimal from 'decimal.js';
import { app } from './lib/slack';
import { config } from './lib/config';
import { logger } from './lib/logger';
import { registerHandlers } from './handlers';
import { assetRepository } from './repositories/AssetRepository';
import { assetEvaluationService } from './services/AssetEvaluationService';
import { unitConversionService } from './services/UnitConversionService';
import { AssetType } from './lib/types';
import { msg } from './messages';

registerHandlers(app);

// ── Daily summary cron ────────────────────────────────────────────────────────

cron.schedule(config.DAILY_SUMMARY_CRON, () => {
  void postDailySummary();
});

async function postDailySummary(): Promise<void> {
  logger.info('Posting daily inventory summary');
  try {
    const assets = await assetRepository.findMany({ includeArchived: false });
    if (assets.length === 0) return;

    const resultMap = await assetEvaluationService.evaluateAll(assets);
    const ts = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

    const lines: string[] = [];

    // Derived assets first (the key KPIs), then countable
    const derived = assets.filter((a) => a.type === AssetType.DERIVED);
    const countable = assets.filter((a) => a.type === AssetType.COUNTABLE);

    if (derived.length > 0) {
      lines.push('*Derived figures:*');
      for (const asset of derived) {
        const result = resultMap.get(asset.id);
        const factor = new Decimal(asset.conversionFactor.toString());
        if (result?.kind === 'derived-ok') {
          lines.push(`  • ${asset.name}: ${unitConversionService.formatBoth(result.value, asset.uom, factor, asset.uoo)}`);
        } else if (result?.kind === 'derived-error' && result.error === 'DIVISION_BY_ZERO') {
          lines.push(`  • ${asset.name}: ${msg.inventory.divisionByZero}`);
        } else {
          lines.push(`  • ${asset.name}: _not available_`);
        }
      }
    }

    if (countable.length > 0) {
      lines.push('*Countable assets:*');
      for (const asset of countable) {
        const result = resultMap.get(asset.id);
        const factor = new Decimal(asset.conversionFactor.toString());
        if (result?.kind === 'countable') {
          lines.push(`  • ${asset.name}: ${unitConversionService.formatBoth(result.quantityUoM, asset.uom, factor, asset.uoo)}`);
        } else {
          lines.push(`  • ${asset.name}: _never counted_`);
        }
      }
    }

    const neverCounted = assets.filter((a) => resultMap.get(a.id)?.kind === 'never-counted').length;

    const summaryBlocks = [
      { type: 'header', text: { type: 'plain_text', text: `Daily Inventory Summary — ${ts}`, emoji: true } },
      { type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') || '_No data available._' } },
    ];
    if (neverCounted > 0) {
      summaryBlocks.push({ type: 'section', text: { type: 'mrkdwn', text: `:warning: ${neverCounted} asset(s) have never been counted.` } });
    }
    await app.client.chat.postMessage({
      channel: config.DAILY_SUMMARY_CHANNEL,
      text: `Daily Inventory Summary — ${ts}`,
      blocks: summaryBlocks,
    });
  } catch (err) {
    logger.error(err, 'Failed to post daily summary');
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────

async function main() {
  await app.start();
  logger.info(
    { socketMode: config.SOCKET_MODE, port: config.SOCKET_MODE ? null : config.PORT, nodeEnv: config.NODE_ENV },
    'Asset Count Bot started',
  );
}

main().catch((err: unknown) => {
  logger.error(err, 'Fatal error during startup');
  process.exit(1);
});
