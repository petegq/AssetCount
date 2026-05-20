import { Prisma, PrismaClient } from '@prisma/client';
import Decimal from 'decimal.js';
import { prisma as defaultPrisma } from '../lib/prisma';
import { NotFoundError, ConflictError } from '../lib/errors';
import { AssetType, AssetInputDef } from '../lib/types';

// ── Typed payloads ─────────────────────────────────────────────────────────────

const assetInclude = {
  category: true,
  inputs: { include: { inputAsset: { select: { id: true, name: true, type: true } } } },
  expectedValue: true,
} satisfies Prisma.AssetInclude;

export type AssetRow = Prisma.AssetGetPayload<{ include: typeof assetInclude }>;

// ── Input types ────────────────────────────────────────────────────────────────

export interface CreateAssetInput {
  name: string;
  description?: string;
  type: AssetType;
  categoryId: string;
  uom: string;
  uoo: string;
  conversionFactor?: Decimal;
  formula?: string;
}

export interface UpdateAssetInput {
  name?: string;
  description?: string;
  categoryId?: string;
  uom?: string;
  uoo?: string;
  conversionFactor?: Decimal;
  formula?: string;
}

export interface FindManyOptions {
  type?: AssetType;
  categoryId?: string;
  includeArchived?: boolean;
}

// ── Repository ─────────────────────────────────────────────────────────────────

export class AssetRepository {
  constructor(private readonly db: PrismaClient = defaultPrisma) {}

  async findById(id: string): Promise<AssetRow | null> {
    return this.db.asset.findUnique({ where: { id }, include: assetInclude });
  }

  async findByIdOrThrow(id: string): Promise<AssetRow> {
    const asset = await this.findById(id);
    if (!asset) throw new NotFoundError('asset', id);
    return asset;
  }

  async findByName(name: string): Promise<AssetRow | null> {
    // Try exact match first (uses the unique index on name)
    const exact = await this.db.asset.findUnique({ where: { name }, include: assetInclude });
    if (exact) return exact;

    // Case-insensitive fallback — fine at < 200 asset scale
    const all = await this.db.asset.findMany({
      where: { archivedAt: null },
      include: assetInclude,
    });
    return all.find((a) => a.name.toLowerCase() === name.toLowerCase()) ?? null;
  }

  /**
   * Resolve an asset by ID or name. Tries ID first, then falls back to name.
   * Returns null (not throws) so callers can handle ambiguity themselves.
   */
  async resolve(idOrName: string): Promise<AssetRow | null> {
    const byId = await this.findById(idOrName);
    if (byId) return byId;
    return this.findByName(idOrName);
  }

  async findMany(opts: FindManyOptions = {}): Promise<AssetRow[]> {
    const where: Prisma.AssetWhereInput = {};
    if (!opts.includeArchived) where.archivedAt = null;
    if (opts.type) where.type = opts.type;
    if (opts.categoryId) where.categoryId = opts.categoryId;

    return this.db.asset.findMany({
      where,
      include: assetInclude,
      orderBy: { name: 'asc' },
    });
  }

  async create(input: CreateAssetInput): Promise<AssetRow> {
    try {
      return await this.db.asset.create({
        data: {
          name: input.name,
          description: input.description,
          type: input.type,
          categoryId: input.categoryId,
          uom: input.uom,
          uoo: input.uoo,
          conversionFactor: input.conversionFactor ?? new Decimal(1),
          formula: input.formula,
        },
        include: assetInclude,
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictError(
          `Asset named "${input.name}" already exists`,
          `An asset named *${input.name}* already exists. Choose a different name.`,
        );
      }
      throw err;
    }
  }

  async update(id: string, input: UpdateAssetInput): Promise<AssetRow> {
    try {
      return await this.db.asset.update({
        where: { id },
        data: {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.description !== undefined && { description: input.description }),
          ...(input.categoryId !== undefined && { categoryId: input.categoryId }),
          ...(input.uom !== undefined && { uom: input.uom }),
          ...(input.uoo !== undefined && { uoo: input.uoo }),
          ...(input.conversionFactor !== undefined && {
            conversionFactor: input.conversionFactor,
          }),
          ...(input.formula !== undefined && { formula: input.formula }),
        },
        include: assetInclude,
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2025'
      ) {
        throw new NotFoundError('asset', id);
      }
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictError(
          `Asset name "${input.name ?? ''}" is taken`,
          `An asset named *${input.name ?? ''}* already exists.`,
        );
      }
      throw err;
    }
  }

  async archive(id: string): Promise<AssetRow> {
    try {
      return await this.db.asset.update({
        where: { id },
        data: { archivedAt: new Date() },
        include: assetInclude,
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2025'
      ) {
        throw new NotFoundError('asset', id);
      }
      throw err;
    }
  }

  // ── Derived asset inputs ─────────────────────────────────────────────────────

  /**
   * Replace all inputs for a derived asset in a single transaction.
   * The formula variable names and their linked asset IDs are set atomically.
   */
  async setInputs(assetId: string, inputs: AssetInputDef[]): Promise<void> {
    await this.db.$transaction([
      this.db.assetInput.deleteMany({ where: { assetId } }),
      this.db.assetInput.createMany({
        data: inputs.map((inp) => ({
          assetId,
          variableName: inp.variableName,
          inputAssetId: inp.inputAssetId,
        })),
      }),
    ]);
  }

  async findInputsForAsset(assetId: string) {
    return this.db.assetInput.findMany({
      where: { assetId },
      include: { inputAsset: true },
    });
  }

  /**
   * Find all active derived assets that use `inputAssetId` as an input.
   * Used to warn before archiving an asset that other formulas depend on.
   */
  async findDerivedAssetsUsingAsInput(inputAssetId: string): Promise<AssetRow[]> {
    const rows = await this.db.assetInput.findMany({
      where: { inputAssetId },
      include: {
        asset: { include: assetInclude },
      },
    });
    return rows
      .map((r) => r.asset)
      .filter((a) => a.archivedAt === null) as AssetRow[];
  }

  /**
   * Returns a map of assetId → inputAssetIds for ALL derived assets.
   * Consumed by FormulaEvaluationService.detectCycle() before saving new inputs.
   */
  async getInputAssetIdsMap(): Promise<Map<string, string[]>> {
    const allInputs = await this.db.assetInput.findMany({
      select: { assetId: true, inputAssetId: true },
    });
    const map = new Map<string, string[]>();
    for (const row of allInputs) {
      const existing = map.get(row.assetId) ?? [];
      existing.push(row.inputAssetId);
      map.set(row.assetId, existing);
    }
    return map;
  }

  // ── Expected values ──────────────────────────────────────────────────────────

  async upsertExpectedValue(
    assetId: string,
    quantity: Decimal,
    updatedById: string,
  ): Promise<void> {
    await this.db.expectedValue.upsert({
      where: { assetId },
      create: { assetId, quantity, updatedById },
      update: { quantity, updatedById },
    });
  }

  async findExpectedValue(assetId: string) {
    return this.db.expectedValue.findUnique({ where: { assetId } });
  }

  // ── Categories ───────────────────────────────────────────────────────────────

  async findAllCategories() {
    return this.db.category.findMany({ orderBy: { name: 'asc' } });
  }

  async findOrCreateCategory(name: string) {
    return this.db.category.upsert({
      where: { name },
      create: { name },
      update: {},
    });
  }
}

export const assetRepository = new AssetRepository();
