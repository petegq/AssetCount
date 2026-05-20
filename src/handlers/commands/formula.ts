import { App } from '@slack/bolt';
import { withErrorHandling } from '../middleware';
import { header, section, divider, context, textInput } from '../blocks';
import { assetRepository } from '../../repositories/AssetRepository';
import { assetEvaluationService } from '../../services/AssetEvaluationService';
import { formulaEvaluationService } from '../../services/FormulaEvaluationService';
import { unitConversionService } from '../../services/UnitConversionService';
import { auditRepository } from '../../repositories/AuditRepository';
import { AssetType, AuditAction, AssetInputDef } from '../../lib/types';
import { msg } from '../../messages';

const FORMULA_MODAL_CALLBACK = 'formula_set_modal_submit';
const BLOCK = { INPUTS: 'formula_inputs_block', FORMULA: 'formula_expr_block' };
const ACTION = { INPUTS: 'formula_inputs_input', FORMULA: 'formula_expr_input' };

export function registerFormulaCommand(app: App): void {
  // ── /formula [set] <asset> ─────────────────────────────────────────────────

  app.command('/formula', async ({ command, ack, respond, client }) => {
    await ack();

    await withErrorHandling(respond, '/formula', async () => {
      const text = command.text.trim();
      if (!text) {
        await respond({ text: 'Usage: `/formula <asset>` or `/formula set <asset>`', response_type: 'ephemeral' });
        return;
      }

      const isSet = text.toLowerCase().startsWith('set ');
      const nameOrId = isSet ? text.slice(4).trim() : text;

      const asset = await assetRepository.resolve(nameOrId);
      if (!asset) {
        await respond({ text: msg.general.notFound('asset', nameOrId), response_type: 'ephemeral' });
        return;
      }
      if (asset.type !== AssetType.DERIVED) {
        await respond({
          text: `:no_entry: *${asset.name}* is a countable asset — formulas only apply to derived assets.`,
          response_type: 'ephemeral',
        });
        return;
      }

      if (isSet) {
        await client.views.open({
          trigger_id: command.trigger_id,
          view: buildFormulaModal(asset),
        });
      } else {
        await showFormula(asset, respond);
      }
    });
  });

  // ── Modal submission ───────────────────────────────────────────────────────

  app.view(FORMULA_MODAL_CALLBACK, async ({ ack, body, view, client }) => {
    const values = view.state.values;
    const inputsRaw = values[BLOCK.INPUTS]?.[ACTION.INPUTS]?.value ?? '';
    const formulaRaw = values[BLOCK.FORMULA]?.[ACTION.FORMULA]?.value ?? '';

    const meta = JSON.parse(view.private_metadata || '{}') as { assetId?: string; channelId?: string };
    const { assetId, channelId } = meta;

    if (!assetId) {
      await ack({ response_action: 'errors', errors: { [BLOCK.FORMULA]: 'Internal error: missing asset ID.' } });
      return;
    }

    // ── Parse inputs text ────────────────────────────────────────────────────
    // Format: one per line — "varName = assetNameOrId"
    const inputDefs: AssetInputDef[] = [];
    const parseErrors: string[] = [];

    if (inputsRaw.trim()) {
      for (const line of inputsRaw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const match = trimmed.match(/^([a-zA-Z_]\w*)\s*=\s*(.+)$/);
        if (!match) {
          parseErrors.push(`Cannot parse line: "${trimmed}". Expected format: \`varName = Asset Name\``);
          continue;
        }
        const [, varName, ref] = match;
        const inputAsset = await assetRepository.resolve(ref.trim());
        if (!inputAsset) {
          parseErrors.push(`Input asset not found: "${ref.trim()}"`);
          continue;
        }
        inputDefs.push({ variableName: varName, inputAssetId: inputAsset.id });
      }
    }

    if (parseErrors.length > 0) {
      await ack({ response_action: 'errors', errors: { [BLOCK.INPUTS]: parseErrors.join('\n') } });
      return;
    }

    // ── Validate formula ──────────────────────────────────────────────────────
    const varNames = inputDefs.map((i) => i.variableName);
    const validation = formulaEvaluationService.validate(formulaRaw, varNames);
    if (!validation.valid) {
      await ack({ response_action: 'errors', errors: { [BLOCK.FORMULA]: validation.error } });
      return;
    }

    // ── Cycle detection ───────────────────────────────────────────────────────
    const graphMap = await assetRepository.getInputAssetIdsMap();
    // Temporarily exclude this asset's current edges from the graph for detection
    graphMap.delete(assetId);
    const cycle = formulaEvaluationService.detectCycle(
      assetId,
      inputDefs.map((i) => i.inputAssetId),
      (id) => graphMap.get(id) ?? [],
    );

    if (cycle) {
      const cyclePath = await Promise.all(
        cycle.map(async (id) => {
          const a = await assetRepository.findById(id);
          return a?.name ?? id;
        }),
      );
      await ack({
        response_action: 'errors',
        errors: { [BLOCK.INPUTS]: msg.formula.cycleDetected(cyclePath) },
      });
      return;
    }

    await ack();

    // ── Persist ────────────────────────────────────────────────────────────────
    try {
      const assetBefore = await assetRepository.findByIdOrThrow(assetId);

      await assetRepository.setInputs(assetId, inputDefs);
      const assetAfter = await assetRepository.update(assetId, { formula: formulaRaw });

      await auditRepository.append({
        action: AuditAction.FORMULA_UPDATE,
        slackUserId: body.user.id,
        assetId,
        before: { formula: assetBefore.formula, inputs: assetBefore.inputs.map((i) => ({ variableName: i.variableName, inputAssetId: i.inputAssetId })) },
        after: { formula: formulaRaw, inputs: inputDefs },
      });

      const target = channelId ?? body.user.id;
      await client.chat.postMessage({
        channel: target,
        text: msg.formula.saved(assetAfter.name),
        blocks: [
          section(msg.formula.saved(assetAfter.name)),
          section(`*Formula:* \`${formulaRaw}\``),
          ...(inputDefs.length > 0
            ? [section(`*Inputs:*\n${inputDefs.map((i) => `• \`${i.variableName}\``).join('\n')}`)]
            : []),
        ],
      });
    } catch (err) {
      const { toAppError } = await import('../../lib/errors');
      const appErr = toAppError(err);
      const target = channelId ?? body.user.id;
      await client.chat.postMessage({ channel: target, text: msg.general.errorWithId(appErr.correlationId) });
    }
  });
}

// ── Show formula ──────────────────────────────────────────────────────────────

async function showFormula(
  asset: Awaited<ReturnType<typeof assetRepository.findByIdOrThrow>>,
  respond: Parameters<typeof withErrorHandling>[0],
) {
  if (!asset.formula) {
    await respond({
      text: `No formula set for *${asset.name}*. Use \`/formula set ${asset.name}\` to configure it.`,
      response_type: 'ephemeral',
    });
    return;
  }

  const blocks = [header(`Formula: ${asset.name}`), section(`\`${asset.formula}\``), divider()];

  if (asset.inputs.length > 0) {
    // Show current input values inline
    const allAssets = await assetRepository.findMany({ includeArchived: false });
    const resultMap = await assetEvaluationService.evaluateAll(allAssets);

    const inputLines = asset.inputs.map((inp) => {
      const inputResult = resultMap.get(inp.inputAssetId);
      let valueStr = '_unknown_';
      if (inputResult?.kind === 'countable') {
        valueStr = unitConversionService.format(inputResult.quantityUoM, inp.inputAsset.uom);
      } else if (inputResult?.kind === 'derived-ok') {
        valueStr = unitConversionService.format(inputResult.value, inp.inputAsset.uom);
      } else if (inputResult?.kind === 'never-counted') {
        valueStr = '_never counted (treated as 0)_';
      }
      return `• \`${inp.variableName}\` → *${inp.inputAsset.name}*: ${valueStr}`;
    });

    blocks.push(section(`*Inputs:*\n${inputLines.join('\n')}`));
  }

  blocks.push(context('Use `/formula set <asset>` to edit the formula and inputs.'));

  await respond({ text: `Formula for ${asset.name}`, blocks, response_type: 'ephemeral' });
}

// ── Modal builder ─────────────────────────────────────────────────────────────

function buildFormulaModal(
  asset: Awaited<ReturnType<typeof assetRepository.findByIdOrThrow>>,
) {
  const existingInputs = asset.inputs
    .map((i) => `${i.variableName} = ${i.inputAsset.name}`)
    .join('\n');

  return {
    type: 'modal' as const,
    callback_id: FORMULA_MODAL_CALLBACK,
    private_metadata: JSON.stringify({ assetId: asset.id }),
    title: { type: 'plain_text' as const, text: 'Set Formula' },
    submit: { type: 'plain_text' as const, text: 'Save' },
    close: { type: 'plain_text' as const, text: 'Cancel' },
    blocks: [
      section(`Setting formula for *${asset.name}*`),
      divider(),
      textInput({
        blockId: BLOCK.INPUTS,
        actionId: ACTION.INPUTS,
        label: 'Inputs',
        placeholder: 'buffer = DT Emergency Buffer\ndupes = Duplicate DTs',
        initialValue: existingInputs || undefined,
        multiline: true,
        optional: true,
        hint: 'One per line: variableName = Asset Name or ID. Variable names must be used in the formula.',
      }),
      textInput({
        blockId: BLOCK.FORMULA,
        actionId: ACTION.FORMULA,
        label: 'Formula expression',
        placeholder: 'buffer + dupes',
        initialValue: asset.formula ?? undefined,
        hint: 'Arithmetic using your variable names. Allowed functions: min, max, round, floor, ceil, abs.',
      }),
    ],
  };
}
