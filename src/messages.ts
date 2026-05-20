/**
 * All user-facing strings in one place.
 * Never interpolate raw error messages or stack traces into these.
 */

export const msg = {
  general: {
    errorWithId: (correlationId: string) =>
      `An error occurred (ref: \`${correlationId}\`). Please contact your supervisor if it persists.`,
    notFound: (entity: string, name: string) => `Could not find ${entity}: *${name}*`,
    archived: (name: string) => `*${name}* has been archived and is no longer active.`,
    confirmationRequired: 'Please confirm this action.',
    cancelled: 'Action cancelled.',
  },

  asset: {
    created: (name: string) => `:white_check_mark: Asset *${name}* registered successfully.`,
    updated: (name: string) => `:pencil: Asset *${name}* updated.`,
    archived: (name: string) => `:archive_box: Asset *${name}* has been archived.`,
    archiveBlockedByFormula: (name: string, dependents: string[]) =>
      `:warning: *${name}* is used as an input in: ${dependents.map((d) => `*${d}*`).join(', ')}. ` +
      `Archive those derived assets first, or confirm you want to proceed.`,
    nameTaken: (name: string) => `An asset named *${name}* already exists.`,
    ambiguousName: (name: string, matches: string[]) =>
      `*${name}* matched multiple assets:\n${matches.map((m, i) => `${i + 1}. ${m}`).join('\n')}\nPlease use the asset ID or be more specific.`,
  },

  count: {
    recorded: (name: string, quantity: string, uom: string) =>
      `:package: Count recorded — *${name}*: ${quantity} ${uom}`,
    recordedWithConversion: (
      name: string,
      qtyUoM: string,
      uom: string,
      qtyUoO: string,
      uoo: string,
    ) =>
      `:package: Count recorded — *${name}*: ${qtyUoM} ${uom} (${qtyUoO} ${uoo})`,
    isDerived: (name: string, inputs: string[]) =>
      `:no_entry: *${name}* is a derived figure — its value is computed from: ${inputs.map((i) => `*${i}*`).join(', ')}. Count those assets individually instead.`,
    invalidQuantity: 'Quantity must be a positive number.',
    sessionLocked: (zone: string, user: string) =>
      `:lock: Zone *${zone}* is already locked by <@${user}>. Ask them to end their session first.`,
    noActiveSession: 'You have no active counting session.',
  },

  session: {
    started: (zone: string) =>
      `:clipboard: Counting session started for zone *${zone}*. Use \`/count\` to log quantities.`,
    ended: (zone: string, totalItems: number) =>
      `:white_check_mark: Session for zone *${zone}* closed — ${totalItems} asset(s) counted.`,
    summaryHeader: (zone: string) => `*Inventory Session Summary — Zone ${zone}*`,
  },

  inventory: {
    header: (name: string) => `*Inventory: ${name}*`,
    currentCount: (qty: string, uom: string) => `Current count: *${qty}* ${uom}`,
    computedValue: (qty: string, uoo: string) => `Reported as: *${qty}* ${uoo}`,
    derivedFormula: (formula: string) => `_Derived via formula:_ \`${formula}\``,
    lastCounted: (ts: string) => `Last counted: ${ts}`,
    neverCounted: 'Never counted.',
    divisionByZero: '— _(division by zero in formula)_',
    reportTitle: (zone: string) => `*Inventory Report — Zone ${zone}*`,
  },

  formula: {
    saved: (name: string) => `:gear: Formula for *${name}* saved.`,
    syntaxError: (detail: string) => `:x: Formula syntax error: ${detail}`,
    undeclaredVariable: (varName: string) =>
      `:x: Formula references \`${varName}\` which is not declared as an input.`,
    cycleDetected: (path: string[]) =>
      `:x: Circular dependency detected: ${path.join(' → ')}`,
    noInputs: 'Add at least one input before setting a formula.',
  },

  audit: {
    header: (name: string) => `*Audit log: ${name}*`,
    noHistory: 'No audit history found.',
    countEntry: (user: string, qty: string, uom: string, ts: string) =>
      `<@${user}> counted *${qty}* ${uom} at ${ts}`,
    editEntry: (user: string, field: string, before: string, after: string, ts: string) =>
      `<@${user}> changed *${field}*: \`${before}\` → \`${after}\` at ${ts}`,
  },

  discrepancy: {
    alertHeader: ':rotating_light: *Discrepancy Alert*',
    detail: (
      name: string,
      expected: string,
      actual: string,
      variance: string,
      uom: string,
    ) =>
      `*${name}*: expected ${expected} ${uom}, counted ${actual} ${uom} (${variance} variance)`,
  },

  csv: {
    importSuccess: (inserted: number, updated: number) =>
      `:white_check_mark: CSV import complete — ${inserted} added, ${updated} updated.`,
    importErrors: (count: number) =>
      `:warning: ${count} row(s) had validation errors (see details above).`,
    rowError: (row: number, message: string) => `Row ${row}: ${message}`,
  },
};
