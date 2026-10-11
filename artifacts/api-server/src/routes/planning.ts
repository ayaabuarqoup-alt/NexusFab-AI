import { Router } from "express";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { CreatePlanBody } from "@workspace/api-zod";
import { requireFactory, requireRoles } from "../middlewares/factory-auth";
import { audit, loadVault, mutateVault } from "../lib/vault";
import { enqueueAlert } from "../lib/notifications";
import { OperationError } from "./operations";
const router = Router();
router.use(requireFactory);
router.get("/plans", async (_req,res) => { res.json((await loadVault(res.locals.factory)).plans ?? []); });
router.get("/planning/operators",requireRoles("owner","production_planner"),async (_req,res) => {
  const {rows}=await pool.query(`SELECT id,name FROM factory_users WHERE factory_id=$1 AND active AND password_hash IS NOT NULL AND 'operator'=ANY(COALESCE(roles,ARRAY[role])) ORDER BY name`,[res.locals.factory]);
  res.json(rows);
});
const save: import("express").RequestHandler = async (req,res) => {
  const p=CreatePlanBody.safeParse(req.body);
  if(!p.success || !p.data.name.trim()) throw new OperationError("INVALID_INPUT");
  const data=p.data, day=(d:string)=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
  if(!day(data.startDate)||!day(data.endDate)||Date.parse(data.endDate)-Date.parse(data.startDate)!==(data.period==="daily"?0:6*86400000)) throw new OperationError("INVALID_PLAN_DATES");
  if(data.status!=="draft"&&!data.assignments.length) throw new OperationError("PLAN_ASSIGNMENTS_REQUIRED");
  res.json(await mutateVault(res.locals.factory,async(v,client)=>{
    const previous=req.params.id?v.plans?.find(x=>x.id===req.params.id):undefined;
    if(req.params.id&&!previous) throw new OperationError("NOT_FOUND",404);
    if(previous?.status==="completed") throw new OperationError("PLAN_COMPLETED",409);
    if(data.status==="completed"&&previous?.status!=="scheduled") throw new OperationError("PLAN_NOT_SCHEDULED",409);
    if(data.status==="completed"&&JSON.stringify(data.assignments)!==JSON.stringify(previous?.assignments)) throw new OperationError("PLAN_COMPLETION_CHANGED",409);
    const operators=await client.query(`SELECT id FROM factory_users WHERE factory_id=$1 AND active AND password_hash IS NOT NULL AND 'operator'=ANY(COALESCE(roles,ARRAY[role]))`,[res.locals.factory]);
    const eligible=new Set(operators.rows.map(r=>r.id)), seen=new Set<string>();
    for(const a of data.assignments){
      const job=v.jobs.find(j=>j.id===a.jobId);
      if(!job||!eligible.has(a.operatorId)) throw new OperationError("INVALID_RESOURCE",400);
      if(seen.has(a.jobId)) throw new OperationError("DUPLICATE_ASSIGNMENT",409);seen.add(a.jobId);
      const start=Date.parse(a.startAt),end=Date.parse(a.endAt);
      if(!/T.*(Z|[+-]\d\d:\d\d)$/.test(a.startAt)||!/T.*(Z|[+-]\d\d:\d\d)$/.test(a.endAt)||!Number.isFinite(start)||!Number.isFinite(end)||end<=start||start<Date.parse(data.startDate)||end>Date.parse(data.endDate)+86400000) throw new OperationError("INVALID_PLAN_TIME");
      if(data.status!=="completed"&&job.status==="dispatched") throw new OperationError("ALREADY_DISPATCHED",409);
      if(a.machineId!==job.machineId&&v.logs.some(l=>l.jobId===job.id)) throw new OperationError("MACHINE_HAS_LOGS",409);
      if(data.status==="scheduled"){
        const others=[...data.assignments.filter(b=>b!==a),...(v.plans??[]).filter(x=>x.id!==previous?.id&&x.status==="scheduled").flatMap(x=>x.assignments)];
        if(others.some(b=>b.jobId===a.jobId||((b.machineId===a.machineId||b.operatorId===a.operatorId)&&Date.parse(b.startAt)<end&&Date.parse(b.endAt)>start))) throw new OperationError("RESOURCE_CONFLICT",409);
      }
    }
    const plan={...data,name:data.name.trim(),id:previous?.id??randomUUID(),updatedAt:new Date().toISOString(),updatedBy:res.locals.userName};
    if(data.status==="scheduled") for(const a of data.assignments){
      const job=v.jobs.find(j=>j.id===a.jobId)!;const before={...job};
      job.machineId=a.machineId;job.startDate=new Date(a.startAt).toISOString().slice(0,10);
      job.startTime=new Date(a.startAt).toISOString().slice(11,16);job.dueDate=new Date(Date.parse(a.endAt)-1).toISOString().slice(0,10);
      audit(v,{userId:res.locals.userId,userName:res.locals.userName},"job_scheduled",job.id,JSON.stringify({before,after:job,operatorId:a.operatorId,planId:plan.id}));
    }
    v.plans=[plan,...(v.plans??[]).filter(x=>x.id!==plan.id)];
    audit(v,{userId:res.locals.userId,userName:res.locals.userName},previous?"plan_updated":"plan_created",plan.id,JSON.stringify({before:previous,after:plan}));
    await enqueueAlert(v,client,res.locals.factory,{kind:"production_status",title:plan.name,message:`Plan: ${plan.status}`,targetId:plan.assignments[0]?.jobId??plan.id,actorName:res.locals.userName});
    return plan;
  },{userId:res.locals.userId,sessionId:res.locals.sessionId,roles:["owner","production_planner"]}));
};
router.post("/plans",requireRoles("owner","production_planner"),save);
router.patch("/plans/:id",requireRoles("owner","production_planner"),save);
export default router;
