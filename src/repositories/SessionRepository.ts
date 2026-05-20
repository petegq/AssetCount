import { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '../lib/prisma';
import { NotFoundError } from '../lib/errors';

export type SessionRow = Awaited<ReturnType<SessionRepository['findById']>> & object;

export class SessionRepository {
  constructor(private readonly db: PrismaClient = defaultPrisma) {}

  async create(input: { zone: string; slackUserId: string }) {
    return this.db.session.create({
      data: { zone: input.zone, slackUserId: input.slackUserId },
    });
  }

  async findById(id: string) {
    return this.db.session.findUnique({ where: { id } });
  }

  async findByIdOrThrow(id: string) {
    const session = await this.findById(id);
    if (!session) throw new NotFoundError('session', id);
    return session;
  }

  /** Returns the open (not yet ended) session for a zone, or null. */
  async findActiveByZone(zone: string) {
    return this.db.session.findFirst({
      where: { zone, endedAt: null },
    });
  }

  /** Returns the open session started by a specific Slack user, or null. */
  async findActiveByUser(slackUserId: string) {
    return this.db.session.findFirst({
      where: { slackUserId, endedAt: null },
    });
  }

  async end(id: string) {
    try {
      return await this.db.session.update({
        where: { id },
        data: { endedAt: new Date() },
      });
    } catch {
      throw new NotFoundError('session', id);
    }
  }
}

export const sessionRepository = new SessionRepository();
