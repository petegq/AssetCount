/**
 * SQLite does not support Prisma enums, so string-literal union types are used
 * throughout the codebase for type safety. These constants mirror what is stored
 * in the DB and are the single source of truth for valid values.
 */

export const AssetType = {
  COUNTABLE: 'COUNTABLE',
  DERIVED: 'DERIVED',
} as const;
export type AssetType = (typeof AssetType)[keyof typeof AssetType];

export const AuditAction = {
  ASSET_CREATE: 'ASSET_CREATE',
  ASSET_UPDATE: 'ASSET_UPDATE',
  ASSET_ARCHIVE: 'ASSET_ARCHIVE',
  COUNT: 'COUNT',
  SESSION_START: 'SESSION_START',
  SESSION_END: 'SESSION_END',
  FORMULA_UPDATE: 'FORMULA_UPDATE',
  EXPECTED_UPDATE: 'EXPECTED_UPDATE',
  CSV_IMPORT: 'CSV_IMPORT',
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

// ── Zod schemas for parsing DB strings back to typed values ──────────────────

import { z } from 'zod';

export const assetTypeSchema = z.enum(['COUNTABLE', 'DERIVED']);
export const auditActionSchema = z.enum([
  'ASSET_CREATE',
  'ASSET_UPDATE',
  'ASSET_ARCHIVE',
  'COUNT',
  'SESSION_START',
  'SESSION_END',
  'FORMULA_UPDATE',
  'EXPECTED_UPDATE',
  'CSV_IMPORT',
]);

// ── Shared domain types ───────────────────────────────────────────────────────

export interface AssetInputDef {
  variableName: string;
  inputAssetId: string;
}

export interface LocationDef {
  zone: string;
  aisle?: string;
  bin?: string;
}

export function formatLocation(loc: LocationDef): string {
  return [loc.zone, loc.aisle, loc.bin].filter(Boolean).join('/');
}
