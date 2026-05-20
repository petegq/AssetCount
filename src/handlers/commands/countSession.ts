import { App } from '@slack/bolt';
import Decimal from 'decimal.js';
import { withErrorHandling, formatTs } from '../middleware';
import { header, section, fields, divider, context } from '../blocks';
import { sessionRepository } from '../../repositories/SessionRepository';
import { countRepository } from '../../repositories/CountRepository';
import { auditRepository } from '../../repositories/AuditRepository';
import { unitConversionService } from '../../services/UnitConversionService';
import { AuditAction } from '../../lib/types';
import { msg } from '../../messages';

export function registerCountSessionCommand(app: App): void {
  app.command('/count-session', async ({ command, ack, respond }) => {
    await ack();

    await withErrorHandling(respond, '/count-session', async () => {
      const parts = command.text.trim().split(/\s+/);
      const subcommand = parts[0]?.toLowerCase();

      if (subcommand === 'start') {
        await handleStart(parts.slice(1).join(' '), command.user_id, respond);
      } else if (subcommand === 'end') {
        await handleEnd(command.user_id, respond);
      } else {
        await respond({
          text: 'Usage: `/count-session start <zone>` or `/count-session end`',
          response_type: 'ephemeral',
        });
      }
    });
  });
}

// ── Start ─────────────────────────────────────────────────────────────────────

async function handleStart(zone: string, slackUserId: string, respond: Parameters<typeof withErrorHandling>[0]) {
  if (!zone) {
    await respond({ text: 'Please provide a zone name. Usage: `/count-session start <zone>`', response_type: 'ephemeral' });
    return;
  }

  // Check if this user already has an active session
  const userSession = await sessionRepository.findActiveByUser(slackUserId);
  if (userSession) {
    await respond({
      text: `:warning: You already have an active session for zone *${userSession.zone}*. Run \`/count-session end\` first.`,
      response_type: 'ephemeral',
    });
    return;
  }

  // Check if the zone is locked by someone else
  const zoneSession = await sessionRepository.findActiveByZone(zone);
  if (zoneSession) {
    await respond({
      text: msg.count.sessionLocked(zone, zoneSession.slackUserId),
      response_type: 'ephemeral',
    });
    return;
  }

  const session = await sessionRepository.create({ zone, slackUserId });

  await auditRepository.append({
    action: AuditAction.SESSION_START,
    slackUserId,
    sessionId: session.id,
    after: { zone, sessionId: session.id },
  });

  await respond({
    text: msg.session.started(zone),
    blocks: [
      header(`Counting Session Started`),
      section(msg.session.started(zone)),
      fields(`*Zone:*\n${zone}`, `*Session ID:*\n\`${session.id}\``),
      context('Use `/count <asset> <quantity>` to log counts. Run `/count-session end` when finished.'),
    ],
    response_type: 'in_channel',
  });
}

// ── End ───────────────────────────────────────────────────────────────────────

async function handleEnd(slackUserId: string, respond: Parameters<typeof withErrorHandling>[0]) {
  const session = await sessionRepository.findActiveByUser(slackUserId);
  if (!session) {
    await respond({ text: msg.count.noActiveSession, response_type: 'ephemeral' });
    return;
  }

  const counts = await countRepository.findBySession(session.id);
  await sessionRepository.end(session.id);

  await auditRepository.append({
    action: AuditAction.SESSION_END,
    slackUserId,
    sessionId: session.id,
    after: { zone: session.zone, countCount: counts.length, endedAt: new Date().toISOString() },
  });

  const blocks = buildSessionSummaryBlocks(session.zone, counts, slackUserId);

  await respond({
    text: msg.session.ended(session.zone, counts.length),
    blocks,
    response_type: 'in_channel',
  });
}

// ── Block builder ─────────────────────────────────────────────────────────────

function buildSessionSummaryBlocks(
  zone: string,
  counts: Awaited<ReturnType<typeof countRepository.findBySession>>,
  slackUserId: string,
) {
  const blocks = [
    header(`Session Summary — Zone ${zone}`),
    section(`:white_check_mark: Session closed by <@${slackUserId}> · ${counts.length} asset(s) counted`),
    divider(),
  ];

  if (counts.length === 0) {
    blocks.push(section('_No counts were recorded in this session._'));
    return blocks;
  }

  // Group counts by asset (last count per asset wins)
  const lastCountByAsset = new Map<string, (typeof counts)[0]>();
  for (const c of counts) lastCountByAsset.set(c.assetId, c);

  for (const count of lastCountByAsset.values()) {
    const qty = new Decimal(count.quantity.toString());
    const asset = count.asset;
    const factor = new Decimal(asset.conversionFactor.toString());
    const qtyStr = unitConversionService.formatBoth(qty, asset.uom, factor, asset.uoo);
    blocks.push(
      section(`*${asset.name}*\n${qtyStr}`),
      context(`Counted at ${formatTs(count.countedAt)}`),
    );
  }

  return blocks;
}
