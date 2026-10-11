import { Router } from "express";
import { randomUUID } from "node:crypto";
import { UpdateJobBody, UpdateShippingBody, UpdateMachineStatusBody, CreateIssueBody, ResolveIssueBody } from "@workspace/api-zod";
import { requireFactory, requireRoles } from "../middlewares/factory-auth";
import { audit, loadVault, mutateVault, type MachineState } from "../lib/vault";
import { enqueueAlert } from "../lib/notifications";
import { OperationError } from "./operations";
const router = Router();
router.use(requireFactory);
const actor = (res: import("express").Response, roles: string[]) => ({ userId: res.locals.userId, sessionId: res.locals.sessionId, roles });
const identity = (res: import("express").Response) => ({ userId: res.locals.userId, userName: res.locals.userName });
function validDate(value: string) {
  const d = new Date(`${value}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(+d) && d.toISOString().slice(0, 10) === value;
}
export function machineStates(v: Awaited<ReturnType<typeof loadVault>>): MachineState[] {
  return ["m1", "m2", "m3"].map((id, i) => v.machineStates?.find(m => m.id === id) ??
    { id: id as MachineState["id"], name: `Machine 0${i + 1}`, status: "unknown", note: "", updatedAt: "", updatedBy: "" });
}
router.patch("/jobs/:id", requireRoles("owner", "operator", "production_planner"), async (req, res) => {
  const p = UpdateJobBody.safeParse(req.body);
  if (!p.success || !p.data.name.trim() || !["m1", "m2", "m3"].includes(p.data.machineId) ||
    !Number.isSafeInteger(p.data.target) || !validDate(p.data.startDate) || !validDate(p.data.dueDate) ||
    p.data.startDate > p.data.dueDate || !/^([01]\d|2[0-3]):[0-5]\d$/.test(p.data.startTime)) throw new OperationError("INVALID_INPUT");
  const result = await mutateVault(res.locals.factory, async (v, client) => {
    const job = v.jobs.find(j => j.id === req.params.id);
    if (!job) throw new OperationError("NOT_FOUND", 404);
    if (job.status === "dispatched") throw new OperationError("ALREADY_DISPATCHED", 409);
    if (p.data.target < job.goodQty) throw new OperationError("TARGET_BELOW_OUTPUT", 409);
    if (p.data.machineId !== job.machineId && v.logs.some(l => l.jobId === job.id)) throw new OperationError("MACHINE_HAS_LOGS", 409);
    const before = { ...job };
    Object.assign(job, p.data, { name: p.data.name.trim() });
    job.status = job.goodQty >= job.target ? "completed" : v.logs.some(l => l.jobId === job.id) ? "running" : "planned";
    if (job.status !== "completed") job.shippingStatus = "pending";
    audit(v, identity(res), "job_updated", job.id, JSON.stringify({ before, after: job }));
    await enqueueAlert(v,client,res.locals.factory,{kind:"production_status",title:job.name,message:`Work order updated: ${job.status}`,targetId:job.id,actorName:res.locals.userName});
    return job;
  }, actor(res, ["owner", "operator", "production_planner"]));
  res.json(result);
});
router.patch("/jobs/:id/shipping", requireRoles("owner", "operator"), async (req, res) => {
  const p = UpdateShippingBody.safeParse(req.body);
  if (!p.success) throw new OperationError("INVALID_INPUT");
  const result = await mutateVault(res.locals.factory, async (v, client) => {
    const job = v.jobs.find(j => j.id === req.params.id);
    if (!job) throw new OperationError("NOT_FOUND", 404);
    const current = job.shippingStatus ?? (job.status === "dispatched" ? "shipped" : "pending");
    if (current === p.data.status) return job;
    const next: Record<string, string[]> = { pending: ["ready"], ready: ["pending", "shipped"], shipped: ["delivered"], delivered: [] };
    if (!next[current].includes(p.data.status)) throw new OperationError("INVALID_SHIPPING_TRANSITION", 409);
    if (["shipped", "delivered"].includes(p.data.status) && job.status !== "dispatched") throw new OperationError("ADMIN_DISPATCH_REQUIRED", 409);
    if (p.data.status === "ready") {
      const logs = v.logs.filter(l => l.jobId === job.id);
      if (job.goodQty < job.target || !logs.length || logs.some(l => l.qcStatus !== "approved")) throw new OperationError("QUALITY_REQUIRED", 409);
    }
    job.shippingStatus = p.data.status;
    audit(v, identity(res), "shipping_updated", job.id, JSON.stringify({ before: current, after: p.data.status, note: p.data.note ?? "" }));
    await enqueueAlert(v,client,res.locals.factory,{kind:"production_status",title:job.name,message:`Shipping: ${p.data.status}`,targetId:job.id,actorName:res.locals.userName});
    return job;
  }, actor(res, ["owner", "operator"]));
  res.json(result);
});
router.get("/machines", async (_req, res) => { res.json(machineStates(await loadVault(res.locals.factory))); });
router.patch("/machines/:id/status", requireRoles("owner", "operator"), async (req, res) => {
  const p = UpdateMachineStatusBody.safeParse(req.body);
  if (!p.success || (p.data.status !== "running" && !p.data.note.trim())) throw new OperationError("INVALID_INPUT");
  if (!["m1", "m2", "m3"].includes(String(req.params.id))) throw new OperationError("NOT_FOUND", 404);
  const result = await mutateVault(res.locals.factory, async (v, client) => {
    const states = machineStates(v), machine = states.find(m => m.id === req.params.id)!;
    const before = { ...machine }, changed = machine.status !== p.data.status;
    if (!changed && machine.note === p.data.note.trim()) return machine;
    Object.assign(machine, { status: p.data.status, note: p.data.note.trim(), updatedAt: new Date().toISOString(), updatedBy: res.locals.userName });
    v.machineStates = states;
    if (changed) {
      const history = (v.machineHistory ??= []);
      if (before.updatedAt && !history.some(h => h.machineId === machine.id)) {
        history.push({ machineId: machine.id, status: before.status, at: before.updatedAt });
      }
      history.push({ machineId: machine.id, status: machine.status, at: machine.updatedAt });
    }
    audit(v, identity(res), "machine_status_updated", machine.id, JSON.stringify({ before, after: machine }));
    if (changed && ["stopped", "maintenance"].includes(machine.status)) {
      await enqueueAlert(v, client, res.locals.factory, { kind: "machine_status", title: `${machine.id}: ${machine.status}`,
        message: machine.note, targetId: machine.id, actorName: res.locals.userName });
    }
    return machine;
  }, actor(res, ["owner", "operator"]));
  res.json(result);
});
router.get("/issues", async (_req, res) => { res.json((await loadVault(res.locals.factory)).issues ?? []); });
router.post("/issues", requireRoles("owner", "operator", "quality_inspector"), async (req, res) => {
  const p = CreateIssueBody.safeParse(req.body);
  if (!p.success || !p.data.title.trim() || !p.data.description.trim()) throw new OperationError("INVALID_INPUT");
  const result = await mutateVault(res.locals.factory, async (v, client) => {
    const log = p.data.logId ? v.logs.find(l => l.id === p.data.logId) : undefined;
    const jobId = p.data.jobId || log?.jobId;
    const job = jobId ? v.jobs.find(j => j.id === jobId) : undefined;
    if ((p.data.logId && !log) || (jobId && !job)) throw new OperationError("NOT_FOUND", 404);
    if ((log && (log.machineId !== p.data.machineId || log.jobId !== jobId)) || (job && job.machineId !== p.data.machineId)) throw new OperationError("INVALID_INPUT");
    const issue = { ...p.data, jobId, title: p.data.title.trim(), description: p.data.description.trim(),
      id: randomUUID(), status: "open" as const, createdBy: res.locals.userId, createdByName: res.locals.userName, createdAt: new Date().toISOString() };
    (v.issues ??= []).unshift(issue);
    audit(v, identity(res), "issue_flagged", issue.id, JSON.stringify(issue));
    await enqueueAlert(v, client, res.locals.factory, { kind: "production_issue", title: issue.title,
      message: issue.description, targetId: issue.id, actorName: res.locals.userName });
    return issue;
  }, actor(res, ["owner", "operator", "quality_inspector"]));
  res.json(result);
});
router.post("/issues/:id/resolve", requireRoles("owner", "quality_inspector"), async (req, res) => {
  const p = ResolveIssueBody.safeParse(req.body);
  if (!p.success || !p.data.note.trim()) throw new OperationError("INVALID_INPUT");
  res.json(await mutateVault(res.locals.factory, v => {
    const issue = v.issues?.find(i => i.id === req.params.id);
    if (!issue) throw new OperationError("NOT_FOUND", 404);
    if (issue.status === "resolved") throw new OperationError("ALREADY_RESOLVED", 409);
    Object.assign(issue, { status: "resolved", resolvedBy: res.locals.userName, resolvedAt: new Date().toISOString(), resolutionNote: p.data.note.trim() });
    audit(v, identity(res), "issue_resolved", issue.id, p.data.note.trim());
    return issue;
  }, actor(res, ["owner", "quality_inspector"])));
});
export default router;
