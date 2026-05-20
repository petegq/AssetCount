import { App } from '@slack/bolt';
import { registerCountCommand } from './commands/count';
import { registerCountSessionCommand } from './commands/countSession';
import { registerInventoryCommand } from './commands/inventory';
import { registerInventoryReportCommand } from './commands/inventoryReport';
import { registerFormulaCommand } from './commands/formula';
import { registerAuditCommand } from './commands/audit';

export function registerHandlers(app: App): void {
  registerCountCommand(app);
  registerCountSessionCommand(app);
  registerInventoryCommand(app);
  registerInventoryReportCommand(app);
  registerFormulaCommand(app);
  registerAuditCommand(app);
}
