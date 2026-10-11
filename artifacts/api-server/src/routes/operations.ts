import { Router } from "express";
import { randomUUID } from "node:crypto";
import {
  CreateJobBody, CreateJobResponse, CreateLogBody, CreateLogResponse, ReviewQualityBody,
  ReviewQualityParams, ReviewQualityResponse, DispatchJobParams, DispatchJobResponse,
  ListJobsResponse, ListLogsResponse, GetSummaryResponse, AskAnalystBody, AskAnalystResponse,
} from "@workspace/api-zod";
import { requireFactory, requireRoles } from "../middlewares/factory-auth";
import { audit, loadVault, mutateVault, type Job, type Log } from "../lib/vault";
import { summarize } from "../lib/analytics";
import { analyzeRecords, AnalystInputError } from "../lib/analyst";

export class OperationError extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}
const router = Router();
router.use(requireFactory);
router.get("/audit", async (_req,res) => { res.json((await loadVault(res.locals.factory)).audit ?? []); });
function validDate(s: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
const validTime = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
router.get("/summary", async (_req, res): Promise<void> => {
  res.json(GetSummaryResponse.parse(summarize(await loadVault(res.locals.factory))));
});
router.get("/jobs", async (_req, res): Promise<void> => {
  res.json(ListJobsResponse.parse((await loadVault(res.locals.factory)).jobs));
});
router.get("/logs", async (_req, res): Promise<void> => {
  res.json(ListLogsResponse.parse((await loadVault(res.locals.factory)).logs));
});
router.post("/jobs", requireRoles("owner","operator"), async (req, res): Promise<void> => {
  const parsed = CreateJobBody.safeParse(req.body);
  if (!parsed.success) throw new OperationError("INVALID_INPUT");
  const data = parsed.data;
  if (!data.name.trim() || !["m1", "m2", "m3"].includes(data.machineId) || !Number.isSafeInteger(data.target)) throw new OperationError("INVALID_INPUT");
  if (!validDate(data.startDate) || !validDate(data.dueDate) || !validTime(data.startTime) || data.dueDate < data.startDate) throw new OperationError("INVALID_DATE");
  const result = await mutateVault(res.locals.factory, v => {
    const job: Job = { ...data, name: data.name.trim(), id: randomUUID(), status: "planned", goodQty: 0, rejects: 0 };
    audit(v,{userId:res.locals.userId,userName:res.locals.userName},"job_created",job.id);
    v.jobs.unshift(job); return job;
  }, {userId:res.locals.userId,roles:["owner","operator"]});
  res.json(CreateJobResponse.parse(result));
});
router.post("/logs", requireRoles("owner","operator"), async (req, res): Promise<void> => {
  const parsed = CreateLogBody.safeParse(req.body);
  if (!parsed.success) throw new OperationError("INVALID_INPUT");
  const data = parsed.data;
  if (!data.staff.trim() || !Number.isSafeInteger(data.goodQty) || !Number.isSafeInteger(data.rejects) || !Number.isFinite(data.downtimeMinutes)) throw new OperationError("INVALID_INPUT");
  if (!validDate(data.date) || !validTime(data.time)) throw new OperationError("INVALID_DATE");
  if (data.goodQty + data.rejects === 0 && data.downtimeMinutes === 0) throw new OperationError("EMPTY_LOG");
  if (data.downtimeMinutes > 0 && !data.reason.trim()) throw new OperationError("REASON_REQUIRED");
  const result = await mutateVault(res.locals.factory, v => {
    const job = v.jobs.find(j => j.id === data.jobId);
    if (!job) throw new OperationError("NOT_FOUND", 404);
    if (job.status === "dispatched") throw new OperationError("ALREADY_DISPATCHED", 409);
    if (data.date < job.startDate) throw new OperationError("INVALID_DATE");
    const log: Log = { ...data, staff: res.locals.userName, createdBy: res.locals.userId, id: randomUUID(), machineId: job.machineId, qcStatus: "pending", qcNote: "", createdAt: new Date().toISOString() };
    job.goodQty += data.goodQty; job.rejects += data.rejects;
    if (!Number.isSafeInteger(job.goodQty) || !Number.isSafeInteger(job.rejects)) throw new OperationError("INVALID_INPUT");
    job.status = job.goodQty >= job.target ? "completed" : "running";
    audit(v,{userId:res.locals.userId,userName:res.locals.userName},"log_created",log.id);
    // Validate before committing so a contract mismatch cannot poison the vault.
    CreateLogResponse.parse(log);
    v.logs.unshift(log); return log;
  }, {userId:res.locals.userId,roles:["owner","operator"]});
  res.json(CreateLogResponse.parse(result));
});
router.patch("/logs/:id/quality", requireRoles("owner","quality_inspector"), async (req, res): Promise<void> => {
  const parsed = ReviewQualityBody.safeParse(req.body), params = ReviewQualityParams.safeParse(req.params);
  if (!parsed.success || !params.success || !parsed.data.note.trim()) throw new OperationError("INVALID_INPUT");
  const result = await mutateVault(res.locals.factory, v => {
    const log = v.logs.find(l => l.id === params.data.id);
    if (!log) throw new OperationError("NOT_FOUND", 404);
    if (log.qcStatus !== "pending") throw new OperationError("ALREADY_REVIEWED", 409);
    log.qcStatus = parsed.data.status; log.qcNote = parsed.data.note.trim();
    log.reviewedBy = res.locals.userId; log.reviewerName = res.locals.userName; log.reviewedAt = new Date().toISOString();
    audit(v,{userId:res.locals.userId,userName:res.locals.userName},"quality_reviewed",log.id,`${log.qcStatus}: ${log.qcNote}`);
    return log;
  }, {userId:res.locals.userId,roles:["owner","quality_inspector"]});
  res.json(ReviewQualityResponse.parse(result));
});
router.post("/jobs/:id/dispatch", requireRoles("owner"), async (req, res): Promise<void> => {
  const params = DispatchJobParams.safeParse(req.params);
  if (!params.success) throw new OperationError("INVALID_INPUT");
  const result = await mutateVault(res.locals.factory, v => {
    const job = v.jobs.find(j => j.id === params.data.id);
    if (!job) throw new OperationError("NOT_FOUND", 404);
    if (job.status === "dispatched") throw new OperationError("ALREADY_DISPATCHED", 409);
    const logs = v.logs.filter(l => l.jobId === job.id);
    if (job.goodQty < job.target || !logs.length || logs.some(l => l.qcStatus !== "approved")) throw new OperationError("QUALITY_REQUIRED", 409);
    job.status = "dispatched";
    audit(v,{userId:res.locals.userId,userName:res.locals.userName},"job_dispatched",job.id);
    return job;
  }, {userId:res.locals.userId,roles:["owner"]});
  res.json(DispatchJobResponse.parse(result));
});
router.post("/analyst", async (req, res): Promise<void> => {
  const parsed = AskAnalystBody.safeParse(req.body);
  if (!parsed.success || !parsed.data.question.trim()) throw new OperationError("INVALID_INPUT");
  const vault = await loadVault(res.locals.factory);
  try {
    res.json(AskAnalystResponse.parse(analyzeRecords(vault, parsed.data)));
  } catch (error) {
    if (error instanceof AnalystInputError) throw new OperationError(error.message);
    throw error;
  }
});
export default router;
