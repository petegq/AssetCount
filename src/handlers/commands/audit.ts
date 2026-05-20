import { App } from '@slack/bolt';
import { withErrorHandling, formatTs } from '../middleware';
import { header, section, divider, context } from '../blocks';
import { assetRepository } from '../../repositories/AssetRepository';
import { auditRepository, AuditLogRow } from '../../repositories/AuditRepository';
import { msg } from '../../messages';

const AUDIT_LIMIT = 15;

export function registerAuditCommand(app: App): void {
  app.command('/audit', async ({ command, ack, respond }) => {
    await ack();

    await withErrorHandling(respond, '/audit', async () => {
      const nameOrId = command.text.trim();
      if (!nameOrId) {
        await respond({ text: 'Usage: `/audit <asset-name-or-id>`', response_type: 'ephemeral' });
        return;
      }

      const asset = await assetRepository.resolve(nameOrId);
      if (!asset) {
        await respond({ text: msg.general.notFound('asset', nameOrId), response_type: 'ephemeral' });
        return;
      }

      const entries = await auditRepository.findByAsset(asset.id, AUDIT_LIMIT);

      const blocks = buildAuditBlocks(asset.name, entries);
      await respond({ text: `Audit: ${asset.name}`, blocks, response_type: 'ephemeral' });
    });
  });
}

// ── Block builder ─────────────────────────────────────────────────────────────

function buildAuditBlocks(assetName: string, entries: AuditLogRow[]) {
  const blocks = [header(`Audit Log: ${assetName}`), divider()];

  if (entries.length === 0) {
    blocks.push(section(msg.audit.noHistory));
    return blocks;
  }

  for (const entry of entries) {
    const ts = formatTs(entry.createdAt);
    const after = AuditLogRow_parseSnapshot(entry.after);
    const before = AuditLogRow_parseSnapshot(entry.before);

    let description: string;

    switch (entry.action) {
      case 'COUNT':
        description = msg.audit.countEntry(
          entry.slackUserId,
          String(after?.quantity ?? '?'),
          entry.asset?.name ?? assetName,
          ts,
        );
        break;

      case 'FORMULA_UPDATE':
        description = `<@${entry.slackUserId}> updated formula at ${ts}`;
        if (before?.formula !== after?.formula) {
          description += `\n_Before:_ \`${before?.formula ?? '—'}\`\n_After:_ \`${after?.formula ?? '—'}\``;
        }
        break;

      case 'ASSET_CREATE':
        description = `<@${entry.slackUserId}> registered this asset at ${ts}`;
        break;

      case 'ASSET_UPDATE':
        description = `<@${entry.slackUserId}> updated this asset at ${ts}`;
        if (before && after) {
          const changedFields = Object.keys(after).filter(
            (k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]),
          );
          if (changedFields.length > 0) {
            const changes = changedFields
              .map((k) => msg.audit.editEntry(entry.slackUserId, k, String(before[k] ?? '—'), String(after[k] ?? '—'), ''))
              .join('\n');
            description += `\n${changes}`;
          }
        }
        break;

      case 'ASSET_ARCHIVE':
        description = `<@${entry.slackUserId}> archived this asset at ${ts}`;
        break;

      case 'SESSION_START':
        description = `<@${entry.slackUserId}> started a counting session at ${ts}`;
        break;

      case 'SESSION_END':
        description = `<@${entry.slackUserId}> ended a counting session at ${ts}`;
        break;

      default:
        description = `<@${entry.slackUserId}> performed \`${entry.action}\` at ${ts}`;
    }

    blocks.push(section(description));
  }

  if (entries.length === AUDIT_LIMIT) {
    blocks.push(context(`_Showing last ${AUDIT_LIMIT} entries._`));
  }

  return blocks;
}

function AuditLogRow_parseSnapshot(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}
