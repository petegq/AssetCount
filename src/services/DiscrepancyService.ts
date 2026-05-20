import Decimal from 'decimal.js';
import { WebClient } from '@slack/web-api';
import { AssetRow } from '../repositories/AssetRepository';
import { assetRepository } from '../repositories/AssetRepository';
import { config } from '../lib/config';
import { logger } from '../lib/logger';
import { unitConversionService } from './UnitConversionService';
import { msg } from '../messages';

export interface DiscrepancyResult {
  assetName: string;
  expectedUoM: Decimal;
  actualUoM: Decimal;
  varianceFraction: Decimal;
  exceedsThreshold: boolean;
}

export class DiscrepancyService {
  /**
   * Check whether a freshly-counted quantity deviates from the stored
   * expected value beyond the configured threshold.
   *
   * Returns null if no expected value is set for this asset.
   */
  async check(asset: AssetRow, countedQtyUoM: Decimal): Promise<DiscrepancyResult | null> {
    const expected = await assetRepository.findExpectedValue(asset.id);
    if (!expected) return null;

    const expectedQty = new Decimal(expected.quantity.toString());
    if (expectedQty.isZero()) return null;

    const diff = countedQtyUoM.minus(expectedQty).abs();
    const varianceFraction = diff.div(expectedQty);
    const threshold = new Decimal(config.DISCREPANCY_THRESHOLD);

    return {
      assetName: asset.name,
      expectedUoM: expectedQty,
      actualUoM: countedQtyUoM,
      varianceFraction,
      exceedsThreshold: varianceFraction.gt(threshold),
    };
  }

  /**
   * If a discrepancy exceeds the threshold, post an alert to the audit
   * channel. Logs but does not throw on Slack API failure so the count
   * is always recorded regardless.
   */
  async alertIfNeeded(
    asset: AssetRow,
    countedQtyUoM: Decimal,
    countedBySlackUserId: string,
    client: WebClient,
  ): Promise<void> {
    let result: DiscrepancyResult | null;
    try {
      result = await this.check(asset, countedQtyUoM);
    } catch (err) {
      logger.error(err, 'DiscrepancyService.check failed');
      return;
    }

    if (!result?.exceedsThreshold) return;

    const factor = new Decimal(asset.conversionFactor.toString());
    const pct = result.varianceFraction.mul(100).toDecimalPlaces(1).toString();
    const sign = result.actualUoM.gt(result.expectedUoM) ? '+' : '';

    const blocks = [
      { type: 'section', text: { type: 'mrkdwn', text: msg.discrepancy.alertHeader } },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: msg.discrepancy.detail(
            asset.name,
            unitConversionService.format(result.expectedUoM, asset.uom),
            unitConversionService.format(result.actualUoM, asset.uom),
            `${sign}${pct}%`,
            asset.uom,
          ),
        },
        fields: [
          {
            type: 'mrkdwn',
            text: `*In ${asset.uoo}:*\nExpected ${unitConversionService.format(unitConversionService.toUoO(result.expectedUoM, factor), asset.uoo)} · Counted ${unitConversionService.format(unitConversionService.toUoO(result.actualUoM, factor), asset.uoo)}`,
          },
          { type: 'mrkdwn', text: `*Counted by:*\n<@${countedBySlackUserId}>` },
        ],
      },
    ];

    try {
      await client.chat.postMessage({
        channel: config.AUDIT_CHANNEL,
        text: `Discrepancy alert for ${asset.name} (${sign}${pct}%)`,
        blocks,
      });
    } catch (err) {
      logger.error({ err, assetId: asset.id }, 'Failed to post discrepancy alert');
    }
  }
}

export const discrepancyService = new DiscrepancyService();
