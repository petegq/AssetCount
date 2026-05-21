import { App } from '@slack/bolt';
import { registerAssetCommand } from './commands/asset';
import { registerCountCommand } from './commands/count';
import { registerCountSessionCommand } from './commands/countSession';
import { registerInventoryCommand } from './commands/inventory';
import { registerInventoryReportCommand } from './commands/inventoryReport';
import { registerFormulaCommand } from './commands/formula';
import { registerAuditCommand } from './commands/audit';
import { registerSheetOutputCommand } from './commands/sheetOutput';

export function registerHandlers(app: App): void {
  registerAssetCommand(app);
  registerCountCommand(app);
  registerCountSessionCommand(app);
  registerInventoryCommand(app);
  registerInventoryReportCommand(app);
  registerFormulaCommand(app);
  registerAuditCommand(app);
  registerSheetOutputCommand(app);
}
