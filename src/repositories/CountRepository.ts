import { Prisma, PrismaClient } from '@prisma/client';
import Decimal from 'decimal.js';
import { prisma as defaultPrisma } from '../lib/prisma';

// ── Typed payloads ─────────────────────────────────────────────────────────────

const countInclude = {
  asset: { select: { id: true, name: true, uom: true, uoo: true, conversionFactor: true } },
} satisfies Prisma.CountInclude;

export type CountRow = Prisma.CountGetPayload<{ include: typeof countInclude }>;

// ── Input types ────────────────────────────────────────────────────────────────

export interface CreateCountInput {
  assetId: string;
  quantity: Decimal;
  slackUserId: string;
  sessionId?: string;
  note?: string;
}

// ── Repository ─────────────────────────────────────────────────────────────────

export class CountRepository {
  constructor(private readonly db: PrismaClient = defaultPrisma) {}

  async create(input: CreateCountInput): Promise<CountRow> {
    return this.db.count.create({
      data: {
        assetId: input.assetId,
        quantity: input.quantity,
        slackUserId: input.slackUserId,
        sessionId: input.sessionId ?? null,
        note: input.note ?? null,
      },
      include: countInclude,
    });
  }

  /** Most recent count for a single asset, or null if never counted. */
  async findLatestForAsset(assetId: string): Promise<CountRow | null> {
    return this.db.count.findFirst({
      where: { assetId },
      orderBy: { countedAt: 'desc' },
      include: countInclude,
    });
  }

  /**
   * Batch fetch of the latest count for each of the given asset IDs.
   * Returns a map of assetId → CountRow (absent key means never counted).
   *
   * Fetches all counts for the given IDs ordered newest-first, then
   * takes the first hit per asset — sufficient at this scale.
   */
  async findLatestForAssets(assetIds: string[]): Promise<Map<string, CountRow>> {
    if (assetIds.length === 0) return new Map();

    const counts = await this.db.count.findMany({
      where: { assetId: { in: assetIds } },
      orderBy: { countedAt: 'desc' },
      include: countInclude,
    });

    const map = new Map<string, CountRow>();
    for (const count of counts) {
      if (!map.has(count.assetId)) {
        map.set(count.assetId, count);
      }
    }
    return map;
  }

  /** All counts belonging to a session, ordered by countedAt asc. */
  async findBySession(sessionId: string): Promise<CountRow[]> {
    return this.db.count.findMany({
      where: { sessionId },
      orderBy: { countedAt: 'asc' },
      include: countInclude,
    });
  }

  /** Recent count history for an asset, newest-first. */
  async findByAsset(assetId: string, limit = 20): Promise<CountRow[]> {
    return this.db.count.findMany({
      where: { assetId },
      orderBy: { countedAt: 'desc' },
      take: limit,
      include: countInclude,
    });
  }
}

export const countRepository = new CountRepository();
