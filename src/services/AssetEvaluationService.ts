import Decimal from 'decimal.js';
import { AssetRow, assetRepository } from '../repositories/AssetRepository';
import { CountRow, countRepository } from '../repositories/CountRepository';
import { formulaEvaluationService } from './FormulaEvaluationService';
import { unitConversionService } from './UnitConversionService';
import { AssetType } from '../lib/types';

// ── Result type ───────────────────────────────────────────────────────────────

export type InputValueEntry = { assetName: string; quantityUoM: Decimal };

export type AssetValueResult =
  | { kind: 'countable'; quantityUoM: Decimal; quantityUoO: Decimal; lastCountedAt: Date }
  | { kind: 'never-counted' }
  | {
      kind: 'derived-ok';
      value: Decimal;
      valueUoO: Decimal;
      /** variableName → resolved value, for formula breakdown display */
      inputValues: Map<string, InputValueEntry>;
    }
  | { kind: 'derived-error'; error: 'DIVISION_BY_ZERO' | 'MISSING_INPUT' | 'EVAL_ERROR'; detail: string };

// ── Service ───────────────────────────────────────────────────────────────────

const MAX_DEPTH = 20;

export class AssetEvaluationService {
  /**
   * Evaluate a single asset. Fetches all assets and latest counts once,
   * then evaluates with memoization.
   */
  async evaluateSingle(asset: AssetRow): Promise<AssetValueResult> {
    const allAssets = await assetRepository.findMany({ includeArchived: false });
    const results = await this.evaluateAll(allAssets);
    return results.get(asset.id) ?? { kind: 'never-counted' };
  }

  /**
   * Evaluate every asset in the provided array.
   * Pre-fetches all latest counts in one query, then resolves derived
   * assets recursively with a shared memo to avoid redundant work.
   */
  async evaluateAll(assets: AssetRow[]): Promise<Map<string, AssetValueResult>> {
    const allAssetsMap = new Map(assets.map((a) => [a.id, a]));
    const assetIds = assets.map((a) => a.id);
    const latestCounts = await countRepository.findLatestForAssets(assetIds);

    const memo = new Map<string, AssetValueResult>();
    for (const asset of assets) {
      if (!memo.has(asset.id)) {
        await this.resolve(asset, allAssetsMap, latestCounts, memo, new Set(), 0);
      }
    }
    return memo;
  }

  // ── Private recursion ──────────────────────────────────────────────────────

  private async resolve(
    asset: AssetRow,
    allAssets: Map<string, AssetRow>,
    latestCounts: Map<string, CountRow>,
    memo: Map<string, AssetValueResult>,
    visiting: Set<string>,
    depth: number,
  ): Promise<AssetValueResult> {
    const cached = memo.get(asset.id);
    if (cached) return cached;

    if (depth > MAX_DEPTH) {
      const r: AssetValueResult = { kind: 'derived-error', error: 'EVAL_ERROR', detail: 'Max recursion depth exceeded.' };
      memo.set(asset.id, r);
      return r;
    }

    if (asset.type === AssetType.COUNTABLE) {
      return this.resolveCountable(asset, latestCounts, memo);
    }
    return this.resolveDerived(asset, allAssets, latestCounts, memo, visiting, depth);
  }

  private resolveCountable(
    asset: AssetRow,
    latestCounts: Map<string, CountRow>,
    memo: Map<string, AssetValueResult>,
  ): AssetValueResult {
    const count = latestCounts.get(asset.id);
    let result: AssetValueResult;

    if (!count) {
      result = { kind: 'never-counted' };
    } else {
      const qtyUoM = new Decimal(count.quantity.toString());
      const factor = new Decimal(asset.conversionFactor.toString());
      result = {
        kind: 'countable',
        quantityUoM: qtyUoM,
        quantityUoO: unitConversionService.toUoO(qtyUoM, factor),
        lastCountedAt: count.countedAt,
      };
    }

    memo.set(asset.id, result);
    return result;
  }

  private async resolveDerived(
    asset: AssetRow,
    allAssets: Map<string, AssetRow>,
    latestCounts: Map<string, CountRow>,
    memo: Map<string, AssetValueResult>,
    visiting: Set<string>,
    depth: number,
  ): Promise<AssetValueResult> {
    if (!asset.formula) {
      const r: AssetValueResult = { kind: 'derived-error', error: 'EVAL_ERROR', detail: 'No formula has been set for this asset.' };
      memo.set(asset.id, r);
      return r;
    }

    visiting.add(asset.id);
    const bindings: Record<string, Decimal> = {};
    const inputValues = new Map<string, InputValueEntry>();

    for (const inp of asset.inputs) {
      const inputAsset = allAssets.get(inp.inputAssetId);
      if (!inputAsset) {
        const r: AssetValueResult = { kind: 'derived-error', error: 'MISSING_INPUT', detail: `Input asset "${inp.inputAssetId}" not found.` };
        visiting.delete(asset.id);
        memo.set(asset.id, r);
        return r;
      }

      const inputResult = await this.resolve(inputAsset, allAssets, latestCounts, memo, visiting, depth + 1);

      // Treat never-counted inputs as zero (shows the formula still evaluates)
      let quantityUoM: Decimal;
      if (inputResult.kind === 'never-counted') {
        quantityUoM = new Decimal(0);
      } else if (inputResult.kind === 'countable') {
        quantityUoM = inputResult.quantityUoM;
      } else if (inputResult.kind === 'derived-ok') {
        quantityUoM = inputResult.value;
      } else {
        // Propagate child error up
        visiting.delete(asset.id);
        memo.set(asset.id, inputResult);
        return inputResult;
      }

      bindings[inp.variableName] = quantityUoM;
      inputValues.set(inp.variableName, { assetName: inputAsset.name, quantityUoM });
    }

    visiting.delete(asset.id);

    const evalResult = formulaEvaluationService.evaluate(asset.formula, bindings);
    let result: AssetValueResult;

    if (!evalResult.ok) {
      result = { kind: 'derived-error', error: evalResult.error, detail: evalResult.detail };
    } else {
      const value = evalResult.value;
      const factor = new Decimal(asset.conversionFactor.toString());
      result = {
        kind: 'derived-ok',
        value,
        valueUoO: unitConversionService.toUoO(value, factor),
        inputValues,
      };
    }

    memo.set(asset.id, result);
    return result;
  }
}

export const assetEvaluationService = new AssetEvaluationService();
