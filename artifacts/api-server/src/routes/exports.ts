import { Router } from "express";
import { requireRoles } from "../middlewares/factory-auth";
import { audit, loadVault, mutateVault } from "../lib/vault";
import { buildExport, type ExportKind } from "../lib/exports";
import { OperationError } from "./operations";

const router = Router();
let activeExports = 0;
router.get("/exports/:kind/:format", requireRoles("owner", "production_planner"), async (req, res) => {
  const kind = String(req.params.kind), format = String(req.params.format);
  if (!["reports", "plans", "audit"].includes(kind) || !["pdf", "xlsx"].includes(format)) throw new OperationError("INVALID_INPUT");
  if (kind === "audit" && res.locals.role !== "owner") throw new OperationError("FORBIDDEN", 403);
  if (activeExports >= 2) { res.setHeader("Retry-After", "5"); throw new OperationError("EXPORT_BUSY", 429); }
  activeExports++;
  try {
    const snapshot = await loadVault(res.locals.factory);
    const bytes = await buildExport(snapshot, kind as ExportKind, format as "pdf" | "xlsx", res.locals.factoryName);
    // Recheck grants/session under lock before returning sensitive data.
    await mutateVault(res.locals.factory, v => {
      audit(v, { userId: res.locals.userId, userName: res.locals.userName }, "report_exported", kind, format);
    }, { userId: res.locals.userId, sessionId: res.locals.sessionId, roles: kind === "audit" ? ["owner"] : ["owner", "production_planner"] });
    res.setHeader("Content-Type", format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="nexusfab-${kind}-${new Date().toISOString().slice(0, 10)}.${format}"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(bytes);
  } finally { activeExports--; }
});
export default router;
