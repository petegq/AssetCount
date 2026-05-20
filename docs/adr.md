# Architecture Decision Records

---

## ADR-001: UoM / UoO separation with a scalar conversion factor

**Status:** Accepted

### Context

Assets are counted in one unit (Unit of Measure, UoM) but reported downstream in another (Unit of Output, UoO). For example, stock might be counted in individual items (`each`) but reported as pallets. A clean model is needed that avoids silent unit confusion in formulas and reports.

### Decision

Each asset carries three fields:
- `uom` — how it is counted (e.g. `each`)
- `uoo` — how it is reported (e.g. `pallet`)
- `conversionFactor` — a single `Decimal` such that `valueInUoO = valueInUoM × conversionFactor`

`UnitConversionService` exposes `toUoO`, `toUoM`, `format`, and `formatBoth` using `decimal.js` arithmetic throughout to avoid float drift.

Counts are always **stored in UoM**. Conversion to UoO is performed at read time in every display path. Derived asset formulas also operate in UoM; the `conversionFactor` on the derived asset converts the computed result to UoO for display.

### Consequences

- One multiplication at read time — negligible cost.
- A zero `conversionFactor` is explicitly rejected by `UnitConversionService.toUoM` with a `ValidationError`, preventing silent division-by-zero.
- When `uom === uoo` and `conversionFactor === 1`, display helpers collapse to a single string automatically.
- Bidirectional unit systems (e.g. kg ↔ lbs with separate factors per direction) are out of scope; a single scalar factor is sufficient for the current deployment.

---

## ADR-002: Derived assets computed on read; never stored as stock

**Status:** Accepted

### Context

Some figures (e.g. "Total Operational DTs") cannot be physically counted — they are arithmetic combinations of other assets. Two approaches exist: (a) compute and cache on each count event, or (b) compute on every read from the latest input values.

### Decision

Derived asset values are **never stored as a stock figure**. Every call to `/inventory`, `/inventory-report`, `/sheet-output`, and the daily cron evaluates derived assets fresh from the current input counts.

`AssetEvaluationService.evaluateAll` pre-fetches:
1. All active assets (one query)
2. The latest count per asset (one batch query)

Then resolves derived assets recursively with a shared memo so each asset is evaluated at most once per request. The memo is request-scoped and not cached between requests.

### Consequences

- Values are always consistent with the latest counts — no stale cache.
- Adding/changing input counts is immediately reflected without any additional write step.
- Slightly more computation per read than a cached approach, but negligible at < 200 assets.
- The recursive evaluator includes a depth guard (max depth 20) as a safety net in case a cycle somehow reaches the DB (cycle detection at write time is the primary guard).
- Never-counted inputs are treated as `0` so derived formulas still produce a result; this is shown clearly in the UI.

---

## ADR-003: Formula parser — `expr-eval` with restricted operator/function sets

**Status:** Accepted

### Context

Formulas are user-supplied arithmetic expressions. They must be evaluated safely without allowing arbitrary code execution. Options considered:

| Option | Pros | Cons |
|---|---|---|
| `eval()` / `new Function()` | Zero dependencies | Arbitrary code execution — completely unsafe |
| Custom recursive descent parser | Full control | Significant implementation effort; risk of parser bugs |
| `mathjs` | Feature-rich, safe | Large bundle; more than needed |
| `expr-eval` | Small, pure AST evaluator, TypeScript types | Needs post-construction configuration to restrict built-ins |

### Decision

Use **`expr-eval`** with two post-construction restrictions applied in `FormulaEvaluationService`:

1. `parser.functions` replaced with `{ min, max }` only — removes multi-arg built-ins.
2. `parser.unaryOps` replaced with `{ '-', '+', abs, ceil, floor, round }` only — removes `sqrt`, `sin`, `cos`, `random`, and all other single-arg built-ins.

`expr-eval` is a pure recursive-descent AST evaluator; it never calls `eval` or `new Function`. Post-construction restriction of both registries means any unknown function name either fails to parse (if the parser requires it) or surfaces as an undeclared variable (caught by `validate()`'s `variables()` check).

Validation enforces:
- Syntax (parse must succeed)
- No undeclared variables (every `variables()` result must be in the declared input list)
- No disallowed functions (covered by restricting the registries)

### Consequences

- Formulas are sandboxed: no I/O, no module access, no prototype pollution.
- The allowed function set is narrow but sufficient for warehouse arithmetic.
- The dual-registry restriction is not obvious from `expr-eval`'s public API — it is documented here because a future maintainer upgrading `expr-eval` must re-verify that `unaryOps` still exists and behaves the same way.
- Division by zero at evaluation time returns `Infinity` or `NaN` in JavaScript; `FormulaEvaluationService.evaluate` detects this with `isFinite` / `isNaN` and returns `{ ok: false, error: 'DIVISION_BY_ZERO' }` rather than propagating the value.

---

## ADR-004: Cycle detection — BFS on the dependency graph at write time

**Status:** Accepted

### Context

Derived assets can depend on other derived assets. A circular dependency (A depends on B which depends on A) would cause infinite recursion during evaluation. Detection must happen before bad data reaches the database.

### Decision

Cycle detection runs in `FormulaEvaluationService.detectCycle` **at write time**, called from the `/formula set` modal handler before `assetRepository.setInputs` is called.

Algorithm: **breadth-first search (BFS)** from each proposed new input asset, following the existing dependency graph, looking for a path back to the target asset.

- `getInputAssetIds(id)` is a resolver callback so the function is pure and testable without a database.
- The current asset's edges are excluded from the graph during detection (we pass the graph state *before* the proposed change).
- BFS is chosen over DFS because it returns the **shortest** cycle path, which makes the error message as clear as possible for the user.
- A recursion-depth guard (max 20) in `AssetEvaluationService` provides a secondary safety net in case a cycle somehow reaches the DB (e.g. via direct database edits).

### Consequences

- Cycles are impossible to introduce through the normal UI.
- The BFS graph walk is O(V + E) where V = assets and E = formula inputs — at < 200 assets this is instant.
- Direct database manipulation that introduces a cycle will be caught at evaluation time by the depth guard, returning a `derived-error` result rather than a crash.
- The cycle path is shown in the modal error as human-readable asset names (resolved via an additional batch lookup), not raw IDs.
