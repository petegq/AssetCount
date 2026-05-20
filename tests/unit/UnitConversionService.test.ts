import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { UnitConversionService } from '../../src/services/UnitConversionService';
import { ValidationError } from '../../src/lib/errors';

const svc = new UnitConversionService();
const d = (v: string | number) => new Decimal(v);

describe('UnitConversionService', () => {
  // ── toUoO ──────────────────────────────────────────────────────────────────

  describe('toUoO', () => {
    it('returns the same value when factor is 1', () => {
      expect(svc.toUoO(d(10), d(1)).toNumber()).toBe(10);
    });

    it('multiplies by the conversion factor', () => {
      // 3 pallets × 48 each/pallet = 144 each
      expect(svc.toUoO(d(3), d(48)).toNumber()).toBe(144);
    });

    it('handles fractional factors without float drift', () => {
      // 1.1 kg × 2.2 factor — Decimal avoids the classic 1.1 * 2.2 float bug
      const result = svc.toUoO(d('1.1'), d('2.2'));
      expect(result.toString()).toBe('2.42');
    });

    it('handles zero quantity', () => {
      expect(svc.toUoO(d(0), d(48)).toNumber()).toBe(0);
    });

    it('handles large numbers', () => {
      expect(svc.toUoO(d('999999'), d('1000')).toString()).toBe('999999000');
    });

    it('handles sub-1 factor (downsizing)', () => {
      // 100 each × 0.025 (1 tote = 40 each, so 1 each = 0.025 tote)
      expect(svc.toUoO(d(100), d('0.025')).toString()).toBe('2.5');
    });
  });

  // ── toUoM ──────────────────────────────────────────────────────────────────

  describe('toUoM', () => {
    it('divides by the conversion factor', () => {
      // 144 each ÷ 48 = 3 pallets
      expect(svc.toUoM(d(144), d(48)).toNumber()).toBe(3);
    });

    it('handles factor of 1 (identity)', () => {
      expect(svc.toUoM(d(7), d(1)).toNumber()).toBe(7);
    });

    it('throws ValidationError when factor is zero', () => {
      expect(() => svc.toUoM(d(10), d(0))).toThrow(ValidationError);
    });

    it('round-trips through toUoO and back', () => {
      const factor = d('12.5');
      const original = d('8');
      const converted = svc.toUoO(original, factor);
      const restored = svc.toUoM(converted, factor);
      expect(restored.toString()).toBe(original.toString());
    });
  });

  // ── convert ────────────────────────────────────────────────────────────────

  describe('convert', () => {
    it('returns both uom and uoo values', () => {
      const result = svc.convert(d(5), d(48));
      expect(result.uom.toNumber()).toBe(5);
      expect(result.uoo.toNumber()).toBe(240);
    });
  });

  // ── format ─────────────────────────────────────────────────────────────────

  describe('format', () => {
    it('formats a whole number without decimal point', () => {
      expect(svc.format(d('12.00'), 'each')).toBe('12 each');
    });

    it('formats a decimal by stripping trailing zeros', () => {
      expect(svc.format(d('12.50'), 'tote')).toBe('12.5 tote');
    });

    it('preserves significant decimal places', () => {
      expect(svc.format(d('12.345'), 'kg')).toBe('12.345 kg');
    });

    it('rounds to the specified max decimal places', () => {
      expect(svc.format(d('12.56789'), 'kg', 2)).toBe('12.57 kg');
    });

    it('formats zero cleanly', () => {
      expect(svc.format(d(0), 'pallet')).toBe('0 pallet');
    });
  });

  // ── formatBoth ─────────────────────────────────────────────────────────────

  describe('formatBoth', () => {
    it('returns a single string when uom === uoo and factor is 1', () => {
      const result = svc.formatBoth(d(5), 'each', d(1), 'each');
      expect(result).toBe('5 each');
    });

    it('returns both values when units differ', () => {
      // 3 pallets, factor 48, uoo = each
      const result = svc.formatBoth(d(3), 'pallet', d(48), 'each');
      expect(result).toBe('3 pallet (144 each)');
    });

    it('returns both values when units are the same but factor differs', () => {
      // Unusual but valid: same label, different scale
      const result = svc.formatBoth(d(2), 'unit', d('0.5'), 'unit');
      expect(result).toBe('2 unit (1 unit)');
    });
  });
});
