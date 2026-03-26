export {
  registerCategory,
  getCategoryDef,
  getAllCategories,
  getCategorySlugs,
} from "./registry";
export type {
  CategoryDefinition,
  ActionPanelProps,
  StatItem,
  DetailFieldDef,
} from "./registry";

/* Register all built-in categories */
import { registerCategory } from "./registry";
import { lendingCategory } from "./definitions/lending";
import { multiplyCategory } from "./definitions/multiply";
import { vaultCategory, earnVaultCategory } from "./definitions/vault";
import { insuranceFundCategory } from "./definitions/insurance-fund";
import { earnCategory } from "./definitions/earn";

registerCategory(lendingCategory);
registerCategory(multiplyCategory);
registerCategory(vaultCategory);
registerCategory(earnVaultCategory);
registerCategory(insuranceFundCategory);
registerCategory(earnCategory);
