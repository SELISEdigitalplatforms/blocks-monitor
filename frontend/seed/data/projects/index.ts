// Every seeded project, in the order they are written. One module per project (a module may export null while its
// tables are being written).
import type { ProjectPlan } from "../../model";
import { CLIENT_PORTAL } from "./clientPortal";
import { DRIVER_APP } from "./driverApp";
import { EXPENSE_RECEIPTS } from "./expenseReceipts";
import { ORDER_PORTAL } from "./orderPortal";
import { PAYROLL } from "./payrollSelfService";
import { SERVICE_PORTAL } from "./serviceTechPortal";
import { SPARE_PARTS } from "./sparePartsShop";
import { SUPPLIER_ONBOARDING } from "./supplierOnboarding";
import { SUPPLIER_QUALITY } from "./supplierQuality";
import { TRADE_FAIR } from "./tradeFairLeads";

const ALL: (ProjectPlan | null)[] = [
  // Alpine Fresh AG
  ORDER_PORTAL, DRIVER_APP, SUPPLIER_QUALITY,
  // Lindenhof Treuhand AG
  CLIENT_PORTAL, PAYROLL, EXPENSE_RECEIPTS,
  // Talwerk Fluidsysteme GmbH
  SERVICE_PORTAL, SPARE_PARTS, SUPPLIER_ONBOARDING, TRADE_FAIR,
];

export const PROJECTS: ProjectPlan[] = ALL.filter((p): p is ProjectPlan => p !== null);
