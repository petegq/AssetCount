import { Prisma, PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '../lib/prisma';
import { AuditAction } from '../lib/types';

// ── Typed payloads ─────────────────────────────────────────────────────────────

const auditInclude = {
  asset: { select: { id: true, name: true } },
} satisfies Prisma.AuditLogInclude;

export type AuditLogRow = Prisma.AuditLogGetPayload<{ include: typeof auditInclude }>;

// ── Input types ────────────────────────────────────────────────────────────────

export interface AppendAuditInput {
  action: AuditAction;
  slackUserId: string;
  assetId?: string;
  sessionId?: string;
  /** Snapshot of state before the change — will be JSON-serialised */
  before?: unknown;
  /** Snapshot of state after the change — will be JSON-serialised */
  after?: unknown;
  note?: string;
}

// ── Repository ─────────────────────────────────────────────────────────────────

export class AuditRepository {
  constructor(private readonly db: PrismaClient = defaultPrisma) {}

  async append(input: AppendAuditInput): Promise<void> {
    await this.db.auditLog.create({
      data: {
        action: input.action,
        slackUserId: input.slackUserId,
        assetId: input.assetId ?? null,
        sessionId: input.sessionId ?? null,
        before: input.before !== undefined ? JSON.stringify(input.before) : null,
        after: input.after !== undefined ? JSON.stringify(input.after) : null,
        note: input.note ?? null,
      },
    });
  }

  /** Recent audit entries for an asset, newest-first. */
  async findByAsset(assetId: string, limit = 20): Promise<AuditLogRow[]> {
    return this.db.auditLog.findMany({
      where: { assetId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: auditInclude,
    });
  }

  /** All audit entries for a session, oldest-first. */
  async findBySession(sessionId: string): Promise<AuditLogRow[]> {
    return this.db.auditLog.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
      include: auditInclude,
    });
  }

  /**
   * Parse the JSON stored in a `before` or `after` field.
   * Returns null if the value is absent or not valid JSON.
   */
  static parseSnapshot(raw: string | null): Record<string, unknown> | null {
    if (!raw) return null;
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

export const auditRepository = new AuditRepository();
