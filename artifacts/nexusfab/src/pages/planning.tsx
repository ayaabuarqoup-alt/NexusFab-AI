import { useMemo, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarRange, Clock, Info, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  useListPlans, getListPlansQueryKey, useCreatePlan, useUpdatePlan, useListPlanningOperators, getListPlanningOperatorsQueryKey,
  useListJobs, getListJobsQueryKey, useListLogs, getListLogsQueryKey, getGetSummaryQueryKey,
  type ProductionPlan, type PlanInput, type PlanAssignment, type PlanAssignmentMachineId, type PlanningOperator, type Job,
} from "@workspace/api-client-react";
import { useI18n, errorMessage, type TKey } from "@/lib/i18n";
import { Empty, ErrorState, Field, PageHeader, Panel, Pill, Sk, btnCls, ghostCls, inputCls, useFmt, useProtected, useRole, MACHINE_IDS, PermNote } from "@/components/common";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export const psTone = { draft: "mute", scheduled: "info", completed: "ok" } as const;
const LANE = ["bg-primary/80", "bg-[hsl(32_95%_52%)]", "bg-[hsl(var(--ok))]"];

export function usePlans() {
  return useListPlans({ query: { queryKey: getListPlansQueryKey(), ...useProtected() } });
}
/** Operator directory: Admin + Planner only. */
export function usePlanningOperators(enabled: boolean) {
  const prot = useProtected();
  return useListPlanningOperators({ query: { queryKey: getListPlanningOperatorsQueryKey(), ...prot, enabled: prot.enabled && enabled } });
}

const pad = (n: number) => String(n).padStart(2, "0");
// Plans use UTC calendar days; every planner input/display below is UTC.
const ymd = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const addDays = (s: string, n: number) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
const toLocal = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? "" : `${ymd(d)}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };
const fromLocal = (v: string) => { if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return ""; const d = new Date(`${v}:00Z`); return isNaN(d.getTime()) ? "" : d.toISOString(); };
export function useFmtUtc() {
  const { lang, t } = useI18n();
  return (iso?: string) => { if (!iso) return "—"; const d = new Date(iso); return isNaN(d.getTime()) ? iso : `${d.toLocaleString(lang === "ar" ? "ar-EG" : "en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} ${t("utc")}`; };
}

type Row = { jobId: string; machineId: PlanAssignmentMachineId | ""; operatorId: string; startAt: string; endAt: string };
type Form = { name: string; period: "daily" | "weekly"; startDate: string; status: "draft" | "scheduled" | "completed"; notes: string; rows: Row[] };

export function opLabel(id: string, ops?: PlanningOperator[]) { return ops?.find((o) => o.id === id)?.name ?? id; }

/* ---------- Timeline (machine lanes across plan dates) ---------- */
export function Timeline({ plan, jobs, ops, highlight }: { plan: ProductionPlan; jobs?: Job[]; ops?: PlanningOperator[]; highlight?: string }) {
  const { t, lang } = useI18n();
  const start = new Date(`${plan.startDate}T00:00:00Z`).getTime();
  const end = new Date(`${plan.endDate}T00:00:00Z`).getTime() + 86_400_000;
  const span = end - start;
  const nDays = Math.round(span / 86_400_000);
  const ticks = nDays === 1 ? [0, 6, 12, 18].map((h) => ({ at: h / 24, l: `${pad(h)}:00 ${t("utc")}` })) : Array.from({ length: nDays }, (_, i) => ({ at: i / nDays, l: new Date(start + i * 86_400_000).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-US", { weekday: "short", day: "numeric", timeZone: "UTC" }) }));
  return (
    <div className="space-y-1.5" data-testid={`timeline-${plan.id}`}>
      <div className="relative ms-12 h-4 text-[10px] text-muted-foreground">{ticks.map((k) => <span key={k.l} className="num absolute top-0" style={{ insetInlineStart: `${k.at * 100}%` }}>{k.l}</span>)}</div>
      {MACHINE_IDS.map((m, mi) => {
        const items = plan.assignments.filter((a) => a.machineId === m);
        return (
          <div key={m} className="flex items-center gap-2">
            <span className="num w-10 text-[11px] font-semibold text-muted-foreground">{m.toUpperCase()}</span>
            <div className="relative h-8 flex-1 overflow-hidden rounded-sm border bg-[repeating-linear-gradient(90deg,hsl(var(--secondary))_0,hsl(var(--secondary))_1px,transparent_1px,transparent_calc(100%/var(--d)))]" style={{ ["--d" as string]: String(nDays === 1 ? 4 : nDays) }}>
              {items.map((a, i) => {
                const s = Math.max(0, (new Date(a.startAt).getTime() - start) / span), e = Math.min(1, (new Date(a.endAt).getTime() - start) / span);
                const job = jobs?.find((j) => j.id === a.jobId);
                const mine = highlight && a.operatorId === highlight;
                return (
                  <div key={i} title={`${job?.name ?? a.jobId} · ${opLabel(a.operatorId, ops)}`}
                    className={cn("absolute inset-y-1 truncate rounded-sm px-1.5 text-[10px] font-medium leading-6 text-white", LANE[mi], highlight && !mine && "opacity-35")}
                    style={{ insetInlineStart: `${s * 100}%`, width: `max(${(e - s) * 100}%, 4px)` }}>{job?.name ?? a.jobId}</div>
                );
              })}
            </div>
          </div>
        );
      })}
      {!plan.assignments.length && <p className="ms-12 text-[11px] text-muted-foreground">{t("noAssignments")}</p>}
    </div>
  );
}

function AssignmentList({ plan, jobs, ops, highlight }: { plan: ProductionPlan; jobs?: Job[]; ops?: PlanningOperator[]; highlight?: string }) {
  const { t } = useI18n();
  const fmt = useFmtUtc();
  if (!plan.assignments.length) return null;
  return (
    <ul className="divide-y rounded-md border text-sm">
      {[...plan.assignments].sort((a, b) => a.startAt.localeCompare(b.startAt)).map((a, i) => (
        <li key={i} className={cn("grid gap-1 px-3 py-2 sm:grid-cols-[1.4fr_60px_1fr_1.6fr] sm:items-center", highlight === a.operatorId && "bg-primary/5")} data-testid={`row-assignment-${plan.id}-${i}`}>
          <span className="truncate font-medium">{jobs?.find((j) => j.id === a.jobId)?.name ?? `${t("unknownJob")} · ${a.jobId}`}</span>
          <span className="num text-xs">{a.machineId.toUpperCase()}</span>
          <span className="truncate text-xs">{opLabel(a.operatorId, ops)}</span>
          <span className="num text-[11px] text-muted-foreground">{fmt(a.startAt)} → {fmt(a.endAt)}</span>
        </li>
      ))}
    </ul>
  );
}

/* ---------- Editor ---------- */
function blank(): Form {
  return { name: "", period: "daily", startDate: ymd(new Date()), status: "draft", notes: "", rows: [] };
}
function fromPlan(p: ProductionPlan): Form {
  return { name: p.name, period: p.period, startDate: p.startDate, status: p.status, notes: p.notes ?? "", rows: p.assignments.map((a) => ({ ...a, startAt: toLocal(a.startAt), endAt: toLocal(a.endAt) })) };
}

function PlanEditor({ plan, open, onClose }: { plan: ProductionPlan | null; open: boolean; onClose: () => void }) {
  const { t, nf } = useI18n();
  const qc = useQueryClient();
  const { toast } = useToast();
  const prot = useProtected();
  const jobs = useListJobs({ query: { queryKey: getListJobsQueryKey(), ...prot } });
  const logs = useListLogs({ query: { queryKey: getListLogsQueryKey(), ...prot } });
  const ops = usePlanningOperators(true);
  const [f, setF] = useState<Form>(() => (plan ? fromPlan(plan) : blank()));
  const [err, setErr] = useState("");
  const done = () => {
    qc.invalidateQueries({ queryKey: getListPlansQueryKey() }); qc.invalidateQueries({ queryKey: getListJobsQueryKey() }); qc.invalidateQueries({ queryKey: getGetSummaryQueryKey() });
    toast({ title: t("planSaved") }); onClose();
  };
  const create = useCreatePlan({ mutation: { onSuccess: done } });
  const update = useUpdatePlan({ mutation: { onSuccess: done } });
  const busy = create.isPending || update.isPending;
  const completing = f.status === "completed";
  const endDate = f.period === "weekly" ? addDays(f.startDate, 6) : f.startDate;
  const original = new Set(plan?.assignments.map((a) => a.jobId) ?? []);
  const eligibleJobs = (jobs.data ?? []).filter((j) => (j.status !== "dispatched" && j.shippingStatus !== "shipped" && j.shippingStatus !== "delivered") || original.has(j.id));
  const hasLogs = (id: string) => (logs.data ?? []).some((l) => l.jobId === id);
  const setRow = (i: number, patch: Partial<Row>) => setF({ ...f, rows: f.rows.map((r, k) => (k === i ? { ...r, ...patch } : r)) });
  const addRow = () => setF({ ...f, rows: [...f.rows, { jobId: "", machineId: "", operatorId: "", startAt: `${f.startDate}T08:00`, endAt: `${f.startDate}T16:00` }] });

  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr("");
    if (!f.name.trim()) return setErr(t("v_name"));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.startDate)) return setErr(t("v_dates"));
    if (f.status !== "draft" && f.rows.length === 0) return setErr(t("v_needAssign"));
    const assigns: PlanAssignment[] = [];
    if (completing && plan) { const data: PlanInput = { name: f.name.trim().slice(0, 120), period: f.period, startDate: f.startDate, endDate, status: "completed", notes: f.notes.trim().slice(0, 2000), assignments: plan.assignments }; return update.mutate({ id: plan.id, data }); }
    for (const r of f.rows) {
      if (!r.jobId || !r.machineId || !r.operatorId || !r.startAt || !r.endAt) return setErr(t("v_assignFields"));
      const s = fromLocal(r.startAt), en = fromLocal(r.endAt);
      if (!s || !en || en <= s) return setErr(t("v_order"));
      if (r.startAt.slice(0, 10) < f.startDate || r.endAt.slice(0, 10) > endDate) return setErr(t("v_range"));
      assigns.push({ jobId: r.jobId, machineId: r.machineId, operatorId: r.operatorId, startAt: s, endAt: en });
    }
    if (new Set(assigns.map((a) => a.jobId)).size !== assigns.length) return setErr(t("v_dupJob"));
    for (let i = 0; i < assigns.length; i++) for (let k = i + 1; k < assigns.length; k++) {
      const a = assigns[i], b = assigns[k];
      if ((a.operatorId === b.operatorId || a.machineId === b.machineId) && a.startAt < b.endAt && b.startAt < a.endAt) return setErr(t("v_overlap"));
    }
    const data: PlanInput = { name: f.name.trim().slice(0, 120), period: f.period, startDate: f.startDate, endDate, status: f.status, notes: f.notes.trim().slice(0, 2000), assignments: assigns };
    if (plan) update.mutate({ id: plan.id, data }); else create.mutate({ data });
  };
  const apiErr = create.error ?? update.error;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] max-w-4xl overflow-y-auto">
        <DialogHeader><DialogTitle>{plan ? t("editPlan") : t("newPlan")}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <fieldset disabled={busy} className="grid gap-3 md:grid-cols-[1.6fr_1fr_1fr_1fr]">
            <Field label={t("planName")}><input className={inputCls} maxLength={120} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="input-plan-name" /></Field>
            <Field label={t("period")}>
              <div className="flex rounded-md border p-0.5" role="group">
                {(["daily", "weekly"] as const).map((p) => <button key={p} type="button" onClick={() => setF({ ...f, period: p })} data-testid={`button-period-${p}`}
                  className={cn("h-8 flex-1 rounded text-xs font-medium transition", f.period === p ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>{t(`per_${p}` as TKey)}</button>)}
              </div>
            </Field>
            <Field label={`${t("startDate")} (${t("utc")})`}><input type="date" className={`${inputCls} num`} value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} data-testid="input-plan-start" /></Field>
            <Field label={`${t("endDate")} (${t("utc")})`}><input type="date" className={`${inputCls} num`} value={endDate} disabled readOnly data-testid="input-plan-end" /></Field>
            <Field label={t("status")}>
              <select className={inputCls} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as Form["status"] })} data-testid="select-plan-status">
                {(plan?.status === "scheduled" ? (["draft", "scheduled", "completed"] as const) : (["draft", "scheduled"] as const)).map((s) => <option key={s} value={s}>{t(`ps_${s}` as TKey)}</option>)}
              </select>
            </Field>
            <div className="md:col-span-3"><Field label={t("notes")}><input className={inputCls} maxLength={2000} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} data-testid="input-plan-notes" /></Field></div>
          </fieldset>
          <div className="flex items-start gap-2 rounded-md border bg-secondary/40 px-3 py-2 text-xs text-muted-foreground"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />{completing ? t("completedNote") : t("scheduledNote")} {t("utcNote")}</div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("assignments")} · <span className="num">{nf(f.rows.length)}</span></span>
              <button type="button" onClick={addRow} disabled={busy || completing} className={ghostCls} data-testid="button-add-assignment"><Plus className="h-3.5 w-3.5" />{t("addAssignment")}</button>
            </div>
            {ops.isError && <ErrorState error={ops.error} onRetry={() => ops.refetch()} />}
            {ops.data && ops.data.length === 0 && <PermNote>{t("noOperators")}</PermNote>}
            {f.rows.length === 0 ? <Empty title={t("noAssignments")} sub={t("noAssignmentsSub")} /> : (
              <fieldset disabled={busy || completing} className="space-y-2">
                {f.rows.map((r, i) => {
                  const locked = !!r.jobId && original.has(r.jobId) && hasLogs(r.jobId);
                  return (
                    <div key={i} className="grid gap-2 rounded-md border bg-card p-2.5 md:grid-cols-[1.5fr_80px_1.2fr_1.3fr_1.3fr_auto] md:items-end" data-testid={`row-edit-assignment-${i}`}>
                      <Field label={t("job")}>
                        <select className={inputCls} value={r.jobId} onChange={(e) => { const j = eligibleJobs.find((x) => x.id === e.target.value); setRow(i, { jobId: e.target.value, machineId: (j?.machineId as PlanAssignmentMachineId) || r.machineId }); }} data-testid={`select-assign-job-${i}`}>
                          <option value="">{t("selectJob")}</option>
                          {eligibleJobs.map((j) => <option key={j.id} value={j.id}>{j.name} · {j.machineId.toUpperCase()}</option>)}
                        </select>
                      </Field>
                      <Field label={t("selectMachine")}>
                        <select className={inputCls} value={r.machineId} disabled={locked} title={locked ? t("machineLocked") : undefined} onChange={(e) => setRow(i, { machineId: e.target.value as PlanAssignmentMachineId })} data-testid={`select-assign-machine-${i}`}>
                          <option value="">—</option>{MACHINE_IDS.map((m) => <option key={m} value={m}>{m.toUpperCase()}</option>)}
                        </select>
                      </Field>
                      <Field label={t("operator")}>
                        <select className={inputCls} value={r.operatorId} onChange={(e) => setRow(i, { operatorId: e.target.value })} data-testid={`select-assign-operator-${i}`}>
                          <option value="">{t("selectOperator")}</option>
                          {r.operatorId && !ops.data?.some((o) => o.id === r.operatorId) && <option value={r.operatorId}>{r.operatorId}</option>}
                          {(ops.data ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                        </select>
                      </Field>
                      <Field label={`${t("startAt")} (${t("utc")})`}><input type="datetime-local" className={`${inputCls} num`} value={r.startAt} onChange={(e) => setRow(i, { startAt: e.target.value })} data-testid={`input-assign-start-${i}`} /></Field>
                      <Field label={`${t("endAt")} (${t("utc")})`}><input type="datetime-local" className={`${inputCls} num`} value={r.endAt} onChange={(e) => setRow(i, { endAt: e.target.value })} data-testid={`input-assign-end-${i}`} /></Field>
                      <button type="button" onClick={() => setF({ ...f, rows: f.rows.filter((_, k) => k !== i) })} aria-label={t("remove")} className={cn(ghostCls, "h-9 text-destructive")} data-testid={`button-remove-assignment-${i}`}><Trash2 className="h-3.5 w-3.5" /></button>
                      {locked && <span className="text-[11px] text-muted-foreground md:col-span-6">{t("machineLocked")}</span>}
                    </div>
                  );
                })}
              </fieldset>
            )}
          </div>
          {(err || apiErr) && <p className="text-xs text-destructive" data-testid="text-plan-error">{err || errorMessage(apiErr, t)}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className={ghostCls} data-testid="button-cancel-plan"><X className="h-3.5 w-3.5" />{t("cancel")}</button>
            <button disabled={busy} className={btnCls} data-testid="button-save-plan">{busy ? t("saving") : t("savePlan")}</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Plan board (shared) ---------- */
function PlanBoard({ editable }: { editable: boolean }) {
  const { t, nf } = useI18n();
  const fmt = useFmt();
  const prot = useProtected();
  const { session } = useRole();
  const plans = usePlans();
  const jobs = useListJobs({ query: { queryKey: getListJobsQueryKey(), ...prot } });
  const ops = usePlanningOperators(editable);
  const [filter, setFilter] = useState<"" | ProductionPlan["status"]>("");
  const [editing, setEditing] = useState<{ plan: ProductionPlan | null; n: number } | null>(() => (editable && typeof window !== "undefined" && window.location.hash === "#new" ? { plan: null, n: 0 } : null));
  const list = useMemo(() => [...(plans.data ?? [])].filter((p) => !filter || p.status === filter).sort((a, b) => b.startDate.localeCompare(a.startDate)), [plans.data, filter]);
  const me = editable ? undefined : session?.userId;

  return (
    <div className="space-y-4">
      <div className="rise flex flex-wrap items-center gap-2">
        {(["", "draft", "scheduled", "completed"] as const).map((s) => (
          <button key={s || "all"} onClick={() => setFilter(s)} data-testid={`button-filter-${s || "all"}`}
            className={cn("rounded-md border px-2.5 py-1 text-xs font-medium transition", filter === s ? "border-primary bg-primary/10 text-primary" : "bg-card text-muted-foreground hover:border-primary/40")}>
            {s ? t(`ps_${s}` as TKey) : t("allStatuses")} <span className="num opacity-70">{nf((plans.data ?? []).filter((p) => !s || p.status === s).length)}</span>
          </button>
        ))}
        {editable && <button onClick={() => setEditing({ plan: null, n: Date.now() })} className={cn(btnCls, "ms-auto")} data-testid="button-new-plan"><Plus className="h-4 w-4" />{t("newPlan")}</button>}
      </div>
      {!editable && <PermNote>{t("readOnlyPlans")}</PermNote>}
      {plans.isError ? <ErrorState error={plans.error} onRetry={() => plans.refetch()} />
        : !plans.data ? <div className="space-y-3">{[0, 1].map((i) => <Sk key={i} className="h-48" />)}</div>
        : list.length === 0 ? <Empty title={t("noPlans")} sub={t("noPlansSub")} />
        : list.map((p) => (
          <Panel key={p.id} className="[&>div]:space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3" data-testid={`card-plan-${p.id}`}>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-semibold" data-testid={`text-plan-name-${p.id}`}>{p.name}</h3>
                  <Pill tone={psTone[p.status]} testId={`status-plan-${p.id}`}>{t(`ps_${p.status}` as TKey)}</Pill>
                  <span className="rounded-sm border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t(`per_${p.period}` as TKey)}</span>
                </div>
                <div className="num mt-1 flex flex-wrap items-center gap-x-3 text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><CalendarRange className="h-3 w-3" />{p.startDate}{p.endDate !== p.startDate && ` → ${p.endDate}`}</span>
                  <span>{nf(p.assignments.length)} {t("assignments")}</span>
                  <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{t("updatedBy")} {p.updatedBy} · {fmt(p.updatedAt)}</span>
                </div>
                {p.notes && <p className="mt-1.5 max-w-2xl text-xs text-muted-foreground">{p.notes}</p>}
              </div>
              {editable && <button onClick={() => setEditing({ plan: p, n: Date.now() })} disabled={p.status === "completed"} title={p.status === "completed" ? t("planLocked") : undefined} className={ghostCls} data-testid={`button-edit-plan-${p.id}`}><Pencil className="h-3.5 w-3.5" />{t("edit")}</button>}
            </div>
            <Timeline plan={p} jobs={jobs.data} ops={ops.data} highlight={me} />
            <AssignmentList plan={p} jobs={jobs.data} ops={ops.data} highlight={me} />
          </Panel>
        ))}
      {editable && editing && <PlanEditor key={`${editing.plan?.id ?? "new"}-${editing.n}`} plan={editing.plan} open onClose={() => setEditing(null)} />}
    </div>
  );
}

export function Schedule() {
  const { t } = useI18n();
  return <div className="space-y-6"><PageHeader title={t("schedTitle")} sub={t("schedSub")} /><PlanBoard editable={false} /></div>;
}

export default function Planning() {
  const { t } = useI18n();
  const { canPlan } = useRole();
  return <div className="space-y-6"><PageHeader title={t("planTitle")} sub={t("planSub")} /><PlanBoard editable={canPlan} /></div>;
}
