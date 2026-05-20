import { Parser } from 'expr-eval';
import Decimal from 'decimal.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type FormulaValidationResult =
  | { valid: true }
  | { valid: false; error: string };

export type EvalResult =
  | { ok: true; value: Decimal }
  | { ok: false; error: 'DIVISION_BY_ZERO' | 'EVAL_ERROR'; detail: string };

// ── Safe function sets ────────────────────────────────────────────────────────
// expr-eval has two function registries:
//   - `functions`  — multi-argument function calls: min(a, b), max(a, b)
//   - `unaryOps`   — single-argument prefix ops: abs(x), floor(x), sqrt(x)...
// We replace BOTH with restricted safe sets so disallowed names (sqrt, sin, etc.)
// cause a parse failure or surface as undeclared variables.

const SAFE_MULTI_FUNCTIONS: Record<string, (...args: number[]) => number> = {
  min: (...args) => Math.min(...args),
  max: (...args) => Math.max(...args),
};

const SAFE_UNARY_OPS: Record<string, (v: number) => number> = {
  '-': (v) => -v,
  '+': (v) => +v,
  abs: (v) => Math.abs(v),
  ceil: (v) => Math.ceil(v),
  floor: (v) => Math.floor(v),
  round: (v) => Math.round(v),
};

const SAFE_FUNCTION_NAMES = new Set([
  ...Object.keys(SAFE_MULTI_FUNCTIONS),
  ...Object.keys(SAFE_UNARY_OPS).filter((k) => k !== '-' && k !== '+'),
]);

// ── Service ───────────────────────────────────────────────────────────────────

export class FormulaEvaluationService {
  private readonly parser: Parser;

  constructor() {
    this.parser = new Parser({ allowMemberAccess: false });
    // Replace both registries with the restricted safe sets.
    // expr-eval stores unary functions (sqrt, sin…) in `unaryOps` and
    // multi-arg functions (min, max…) in `functions` — both must be cleared.
    this.parser.functions = { ...SAFE_MULTI_FUNCTIONS };
    this.parser.unaryOps = { ...SAFE_UNARY_OPS };
  }

  /**
   * Parse and validate a formula expression.
   * Checks:
   *   1. Expression is syntactically valid
   *   2. Every variable referenced is in `declaredVarNames`
   *   3. Every function call targets a whitelisted safe function
   */
  validate(formula: string, declaredVarNames: string[]): FormulaValidationResult {
    if (!formula.trim()) {
      return { valid: false, error: 'Formula cannot be empty.' };
    }

    let expr;
    try {
      expr = this.parser.parse(formula);
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      // expr-eval messages are already reasonably user-friendly
      return { valid: false, error: `Syntax error: ${raw}` };
    }

    // variables() returns identifiers that are NOT in parser.functions or parser.consts.
    // Because we restricted parser.functions to SAFE_FUNCTIONS, any unknown function name
    // will appear here and be caught by the undeclared-variable check below.
    const usedVars = expr.variables({ withMembers: false });
    const declaredSet = new Set(declaredVarNames);

    const undeclared = usedVars.filter(
      (v) => !declaredSet.has(v) && !SAFE_FUNCTION_NAMES.has(v),
    );

    if (undeclared.length > 0) {
      const quoted = undeclared.map((v) => `\`${v}\``).join(', ');
      return {
        valid: false,
        error: `Undeclared variable(s): ${quoted}. Declare them as inputs first.`,
      };
    }

    return { valid: true };
  }

  /**
   * Evaluate a formula expression with the given variable bindings.
   * Returns an EvalResult so callers can handle division-by-zero gracefully
   * without try/catch at every call site.
   *
   * Bindings use Decimal values; internally converted to number for expr-eval,
   * then wrapped back in Decimal. Safe for warehouse-scale integer counts.
   */
  evaluate(formula: string, bindings: Record<string, Decimal>): EvalResult {
    let expr;
    try {
      expr = this.parser.parse(formula);
    } catch (e) {
      return {
        ok: false,
        error: 'EVAL_ERROR',
        detail: e instanceof Error ? e.message : String(e),
      };
    }

    const jsBindings: Record<string, number> = {};
    for (const [key, val] of Object.entries(bindings)) {
      jsBindings[key] = val.toNumber();
    }

    // expr-eval's Value type is wider than number; the cast is safe because
    // we only pass numeric bindings and our safe functions always return number.
    const scope = {
      ...SAFE_MULTI_FUNCTIONS,
      ...SAFE_UNARY_OPS,
      ...jsBindings,
    } as Parameters<typeof expr.evaluate>[0];

    let raw: unknown;
    try {
      raw = expr.evaluate(scope);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      // expr-eval surfaces "Division by zero" as a thrown Error
      if (detail.toLowerCase().includes('division by zero')) {
        return { ok: false, error: 'DIVISION_BY_ZERO', detail };
      }
      return { ok: false, error: 'EVAL_ERROR', detail };
    }

    if (typeof raw !== 'number' || !isFinite(raw) || isNaN(raw)) {
      return {
        ok: false,
        error: 'DIVISION_BY_ZERO',
        detail: 'Formula evaluated to a non-finite value.',
      };
    }

    return { ok: true, value: new Decimal(raw) };
  }

  /**
   * Detect whether adding `newInputAssetIds` as inputs to `targetAssetId`
   * would create a cycle in the dependency graph.
   *
   * Uses BFS (breadth-first search) from each proposed input so the returned
   * path is the shortest cycle.
   *
   * @param targetAssetId    The derived asset being created/updated.
   * @param newInputAssetIds The proposed new input asset IDs.
   * @param getInputAssetIds Resolver: given an asset ID, returns its current input IDs.
   *                         Should reflect the state BEFORE the proposed change.
   * @returns Array of asset IDs forming the cycle (starting and ending at
   *          targetAssetId), or null if no cycle.
   */
  detectCycle(
    targetAssetId: string,
    newInputAssetIds: string[],
    getInputAssetIds: (id: string) => string[],
  ): string[] | null {
    // A cycle exists if `targetAssetId` is reachable from any of `newInputAssetIds`
    // through the existing graph.
    for (const startId of newInputAssetIds) {
      const cyclePath = this.bfsFind(
        startId,
        targetAssetId,
        getInputAssetIds,
      );
      if (cyclePath) {
        // Prepend the edge we're about to add: target → start → ... → target
        return [targetAssetId, ...cyclePath];
      }
    }
    return null;
  }

  private bfsFind(
    from: string,
    target: string,
    getChildren: (id: string) => string[],
  ): string[] | null {
    // Direct self-reference
    if (from === target) return [from];

    const visited = new Set<string>([from]);
    // Each queue entry is the path taken to reach the current node
    const queue: string[][] = [[from]];

    while (queue.length > 0) {
      const path = queue.shift()!;
      const current = path[path.length - 1];

      for (const child of getChildren(current)) {
        if (child === target) return [...path, child];
        if (!visited.has(child)) {
          visited.add(child);
          queue.push([...path, child]);
        }
      }
    }

    return null;
  }
}

export const formulaEvaluationService = new FormulaEvaluationService();
