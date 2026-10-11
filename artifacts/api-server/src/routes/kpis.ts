import { Router } from "express";
import { SaveOeeSettingBody, GetKpisResponse } from "@workspace/api-zod";
import { requireRoles } from "../middlewares/factory-auth";
import { audit, loadVault, mutateVault } from "../lib/vault";
import { calculateKpis, reportRange } from "../lib/kpis";
import { OperationError } from "./operations";

const router = Router();
router.get("/analytics/kpis", requireRoles("owner", "production_planner"), async (req, res) => {
  const { from, to } = reportRange(req.query.from, req.query.to);
  res.json(GetKpisResponse.parse(calculateKpis(await loadVault(res.locals.factory), from, to)));
});
router.get("/analytics/oee-settings", requireRoles("owner", "production_planner"), async (_req, res) => {
  res.json((await loadVault(res.locals.factory)).oeeSettings ?? []);
});
router.put("/analytics/oee-settings", requireRoles("owner"), async (req, res) => {
  const parsed = SaveOeeSettingBody.safeParse(req.body);
  const time = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!parsed.success || !Number.isFinite(parsed.data.idealCycleSeconds) || !time.test(parsed.data.shiftStart) ||
    !time.test(parsed.data.shiftEnd) || parsed.data.shiftStart >= parsed.data.shiftEnd) throw new OperationError("INVALID_OEE_SETTING");
  res.json(await mutateVault(res.locals.factory, v => {
    const before = v.oeeSettings?.find(s => s.machineId === parsed.data.machineId);
    v.oeeSettings = [...(v.oeeSettings ?? []).filter(s => s.machineId !== parsed.data.machineId), parsed.data];
    audit(v, { userId: res.locals.userId, userName: res.locals.userName }, "oee_setting_updated", parsed.data.machineId,
      JSON.stringify({ before, after: parsed.data }));
    return parsed.data;
  }, { userId: res.locals.userId, sessionId: res.locals.sessionId, roles: ["owner"] }));
});
export default router;
