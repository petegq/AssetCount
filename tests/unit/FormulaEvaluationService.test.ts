import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { FormulaEvaluationService } from '../../src/services/FormulaEvaluationService';

const svc = new FormulaEvaluationService();
const d = (v: string | number) => new Decimal(v);
const bindings = (obj: Record<string, number>): Record<string, Decimal> =>
  Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, d(v)]));

// ── validate ──────────────────────────────────────────────────────────────────

describe('FormulaEvaluationService.validate', () => {
  it('accepts a simple addition formula', () => {
    expect(svc.validate('a + b', ['a', 'b'])).toEqual({ valid: true });
  });

  it('accepts all arithmetic operators and parentheses', () => {
    expect(svc.validate('(a + b) * c / d - 1', ['a', 'b', 'c', 'd'])).toEqual({
      valid: true,
    });
  });

  it('accepts allowed safe functions', () => {
    expect(svc.validate('max(a, b) + min(c, d)', ['a', 'b', 'c', 'd'])).toEqual({
      valid: true,
    });
    expect(svc.validate('round(abs(a - b))', ['a', 'b'])).toEqual({ valid: true });
    expect(svc.validate('floor(a) + ceil(b)', ['a', 'b'])).toEqual({ valid: true });
  });

  it('rejects an empty formula', () => {
    const result = svc.validate('', ['a']);
    expect(result.valid).toBe(false);
  });

  it('rejects a whitespace-only formula', () => {
    const result = svc.validate('   ', ['a']);
    expect(result.valid).toBe(false);
  });

  it('rejects a syntax error', () => {
    const result = svc.validate('a + * b', ['a', 'b']);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toMatch(/syntax/i);
  });

  it('rejects an undeclared variable', () => {
    const result = svc.validate('a + z', ['a', 'b']);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toMatch(/undeclared/i);
      expect(result.error).toContain('`z`');
    }
  });

  it('rejects multiple undeclared variables, listing all of them', () => {
    const result = svc.validate('x + y + a', ['a']);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain('`x`');
      expect(result.error).toContain('`y`');
    }
  });

  it('rejects a disallowed function (sqrt)', () => {
    const result = svc.validate('sqrt(a)', ['a']);
    expect(result.valid).toBe(false);
  });

  it('allows numeric literals without declaring them', () => {
    expect(svc.validate('a * 2 + 100', ['a'])).toEqual({ valid: true });
  });

  it('passes with extra declared variables that are not used', () => {
    // Having more declared vars than used is fine (inputs may be added before formula)
    expect(svc.validate('a + b', ['a', 'b', 'c'])).toEqual({ valid: true });
  });
});

// ── evaluate ──────────────────────────────────────────────────────────────────

describe('FormulaEvaluationService.evaluate', () => {
  it('evaluates a simple sum', () => {
    const result = svc.evaluate('a + b', bindings({ a: 10, b: 5 }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.toNumber()).toBe(15);
  });

  it('evaluates subtraction', () => {
    const result = svc.evaluate('a - b', bindings({ a: 20, b: 7 }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.toNumber()).toBe(13);
  });

  it('evaluates multiplication', () => {
    const result = svc.evaluate('a * 3', bindings({ a: 4 }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.toNumber()).toBe(12);
  });

  it('evaluates division', () => {
    const result = svc.evaluate('a / b', bindings({ a: 10, b: 4 }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.toNumber()).toBe(2.5);
  });

  it('respects operator precedence', () => {
    // a + b * c = a + (b*c)
    const result = svc.evaluate('a + b * c', bindings({ a: 1, b: 2, c: 3 }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.toNumber()).toBe(7);
  });

  it('respects parentheses', () => {
    const result = svc.evaluate('(a + b) * c', bindings({ a: 1, b: 2, c: 3 }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.toNumber()).toBe(9);
  });

  it('evaluates max()', () => {
    const result = svc.evaluate('max(a, b)', bindings({ a: 3, b: 7 }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.toNumber()).toBe(7);
  });

  it('evaluates min()', () => {
    const result = svc.evaluate('min(a, b)', bindings({ a: 3, b: 7 }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.toNumber()).toBe(3);
  });

  it('evaluates abs() with a negative value', () => {
    const result = svc.evaluate('abs(a)', bindings({ a: -5 }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.toNumber()).toBe(5);
  });

  it('evaluates floor()', () => {
    const result = svc.evaluate('floor(a)', bindings({ a: 3.9 }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.toNumber()).toBe(3);
  });

  it('evaluates ceil()', () => {
    const result = svc.evaluate('ceil(a)', bindings({ a: 3.1 }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.toNumber()).toBe(4);
  });

  it('evaluates round()', () => {
    const result = svc.evaluate('round(a)', bindings({ a: 3.5 }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.toNumber()).toBe(4);
  });

  it('returns DIVISION_BY_ZERO when dividing by zero variable', () => {
    const result = svc.evaluate('a / b', bindings({ a: 10, b: 0 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('DIVISION_BY_ZERO');
  });

  it('returns DIVISION_BY_ZERO when dividing by zero literal', () => {
    const result = svc.evaluate('a / 0', bindings({ a: 5 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('DIVISION_BY_ZERO');
  });

  it('evaluates a nested derived-asset scenario (inputs pre-resolved)', () => {
    // Total = buffer + dupes  where buffer = 20, dupes = 5 → 25
    const result = svc.evaluate('buffer + dupes', bindings({ buffer: 20, dupes: 5 }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.toNumber()).toBe(25);
  });

  it('evaluates a multi-level formula with safe functions', () => {
    // operationalDTs = max(buffer, 0) + max(dupes, 0)
    const result = svc.evaluate(
      'max(buffer, 0) + max(dupes, 0)',
      bindings({ buffer: -2, dupes: 5 }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.toNumber()).toBe(5);
  });
});

// ── detectCycle ───────────────────────────────────────────────────────────────

describe('FormulaEvaluationService.detectCycle', () => {
  // Helper: build a simple adjacency map and return a resolver
  const graph = (edges: Record<string, string[]>) => (id: string) => edges[id] ?? [];

  it('returns null for a simple two-asset chain with no cycle', () => {
    // A → [B], B → []
    const result = svc.detectCycle('A', ['B'], graph({ A: ['B'], B: [] }));
    expect(result).toBeNull();
  });

  it('returns null for a diamond (B→D, C→D) with no cycle', () => {
    // A → [B, C], B → [D], C → [D], D → []
    const result = svc.detectCycle(
      'A',
      ['B', 'C'],
      graph({ A: ['B', 'C'], B: ['D'], C: ['D'], D: [] }),
    );
    expect(result).toBeNull();
  });

  it('detects a direct self-reference (A → A)', () => {
    const result = svc.detectCycle('A', ['A'], graph({}));
    expect(result).not.toBeNull();
    expect(result).toContain('A');
  });

  it('detects a two-node cycle (A → B, B → A)', () => {
    // Existing graph: B already has A as an input
    const result = svc.detectCycle('A', ['B'], graph({ B: ['A'] }));
    expect(result).not.toBeNull();
    // Path should start with A and end at A
    expect(result?.[0]).toBe('A');
    expect(result?.[result!.length - 1]).toBe('A');
  });

  it('detects a three-node cycle (A → B → C → A)', () => {
    // Existing graph: B→C, C→A. We're proposing A→B.
    const result = svc.detectCycle('A', ['B'], graph({ B: ['C'], C: ['A'] }));
    expect(result).not.toBeNull();
    expect(result?.[0]).toBe('A');
    expect(result?.[result!.length - 1]).toBe('A');
    expect(result).toContain('B');
    expect(result).toContain('C');
  });

  it('detects a cycle through only one of multiple proposed inputs', () => {
    // Proposing A → [B, C]. B is safe, C→A creates a cycle.
    const result = svc.detectCycle(
      'A',
      ['B', 'C'],
      graph({ B: ['D'], C: ['A'], D: [] }),
    );
    expect(result).not.toBeNull();
    expect(result).toContain('C');
  });

  it('detects a long transitive cycle', () => {
    // A → B → C → D → E → A  (5-node cycle)
    const result = svc.detectCycle(
      'A',
      ['B'],
      graph({ B: ['C'], C: ['D'], D: ['E'], E: ['A'] }),
    );
    expect(result).not.toBeNull();
    expect(result?.[0]).toBe('A');
    expect(result?.[result!.length - 1]).toBe('A');
  });

  it('returns null when inputs list is empty', () => {
    const result = svc.detectCycle('A', [], graph({}));
    expect(result).toBeNull();
  });
});
