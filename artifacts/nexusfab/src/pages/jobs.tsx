import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Send } from "lucide-react";
import {
  useListJobs, getListJobsQueryKey, useCreateJob, useDispatchJob, useListLogs, getListLogsQueryKey,
  useGetSummary, getGetSummaryQueryKey, type Job,
} from "@workspace/api-client-react";
import { useI18n, errorMessage } from "@/lib/i18n";
import { Empty, ErrorState, Field, PageHeader, Panel, Pill, Sk, inputCls, useProtected, useRole, PermNote } from "@/components/common";
import { useToast } from "@/hooks/use-toast";
import { EditJobButton, ShippingControl } from "@/components/job-edit";
import { FlagIssueButton } from "@/components/issue-form";

const stTone = { planned: "mute", running: "info", completed: "warn", dispatched: "ok" } as const;
const today = () => new Date().toISOString().slice(0, 10);

function JobForm() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const { toast } = useToast();
  const prot = useProtected();
  const { canCreateJobs: canCreate } = useRole();
  const summary = useGetSummary({ query: { queryKey: getGetSummaryQueryKey(), ...prot } });
  const machines = summary.data?.machines ?? [];
  const [f, setF] = useState({ name: "", machineId: "", target: "", startDate: today(), dueDate: today(), startTime: "08:00" });
  const [err, setErr] = useState("");
  const create = useCreateJob({ mutation: {
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: getListJobsQueryKey() }); qc.invalidateQueries({ queryKey: getGetSummaryQueryKey() });
      setF((p) => ({ ...p, name: "", target: "" })); toast({ title: t("jobCreated") });
    },
  } });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr("");
    const target = Number(f.target);
    if (!f.name.trim() || !f.machineId) return setErr(t("required"));
    if (!Number.isFinite(target) || target < 1) return setErr(t("mustBePositive"));
    create.mutate({ data: { name: f.name.trim(), machineId: f.machineId, target: Math.round(target), startDate: f.startDate, dueDate: f.dueDate, startTime: f.startTime } });
  };
  return (
    <Panel title={t("newJob")}>
      {!canCreate ? <PermNote>{t("permJobs")}</PermNote> : <form onSubmit={submit} className="grid gap-3">
        <Field label={t("jobName")}><input className={inputCls} maxLength={120} value={f.name} onChange={set("name")} data-testid="input-job-name" /></Field>
        <Field label={t("machine")}>
          <select className={inputCls} value={f.machineId} onChange={set("machineId")} data-testid="select-machine">
            <option value="">—</option>
            {machines.map((m) => <option key={m.id} value={m.id}>{m.id.toUpperCase()} · {m.name}</option>)}
          </select>
        </Field>
        <Field label={t("target")}><input type="number" min={1} inputMode="numeric" className={`${inputCls} num`} value={f.target} onChange={set("target")} data-testid="input-target" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("startDate")}><input type="date" lang={lang} className={inputCls} value={f.startDate} onChange={set("startDate")} required data-testid="input-start-date" /></Field>
          <Field label={t("dueDate")}><input type="date" lang={lang} className={inputCls} min={f.startDate} value={f.dueDate} onChange={set("dueDate")} required data-testid="input-due-date" /></Field>
        </div>
        <Field label={t("startTime")}><input type="time" lang={lang} className={inputCls} value={f.startTime} onChange={set("startTime")} required data-testid="input-start-time" /></Field>
        {(err || create.isError) && <p className="text-xs text-destructive" data-testid="text-job-error">{err || errorMessage(create.error, t)}</p>}
        <button disabled={create.isPending} data-testid="button-create-job" className="mt-1 inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary text-sm font-medium text-primary-foreground transition hover:brightness-110 disabled:opacity-70">
          <Plus className="h-4 w-4" />{create.isPending ? t("creating") : t("createJob")}
        </button>
      </form>}
    </Panel>
  );
}

function JobRow({ job, pendingQc, hasLogs }: { job: Job; pendingQc: number; hasLogs: boolean }) {
  const { t, nf } = useI18n();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { canDispatch, canEditJobs } = useRole();
  const dispatch = useDispatchJob({ mutation: {
    onSuccess: () => { qc.invalidateQueries({ queryKey: getListJobsQueryKey() }); qc.invalidateQueries({ queryKey: getGetSummaryQueryKey() }); toast({ title: t("dispatched") }); },
    onError: (e) => toast({ title: t("error"), description: errorMessage(e, t), variant: "destructive" }),
  } });
  const pct = Math.min(100, (job.goodQty / job.target) * 100);
  const targetMet = job.goodQty >= job.target;
  const can = canDispatch && job.status !== "dispatched" && targetMet && pendingQc === 0;
  const blocker = !canDispatch ? t("permDispatch") : !targetMet ? t("dispatchBlockedTarget") : pendingQc > 0 ? `${t("dispatchBlockedQc")} (${nf(pendingQc)})` : "";
  return (
    <div className="grid gap-3 border-b px-4 py-3 last:border-0 md:grid-cols-[1.5fr_0.8fr_1.3fr_auto] lg:grid-cols-[1.5fr_0.8fr_1.3fr_1fr_auto] md:items-center" data-testid={`row-job-${job.id}`}>
      <div className="min-w-0">
        <div className="truncate font-medium">{job.name}</div>
        <div className="num text-[11px] text-muted-foreground">{job.machineId.toUpperCase()} · {job.startDate} {job.startTime} → {t("due")} {job.dueDate}</div>
      </div>
      <div><Pill tone={stTone[job.status]} testId={`status-job-${job.id}`}>{t(`st_${job.status}`)}</Pill></div>
      <div>
        <div className="num flex justify-between text-xs"><span>{nf(job.goodQty)} / {nf(job.target)}</span><span className="text-muted-foreground">{nf(pct, 1)}%</span></div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary"><div className="h-full origin-left bg-primary transition-transform duration-700 rtl:origin-right" style={{ transform: `scaleX(${pct / 100})` }} /></div>
        <div className="num mt-1 text-[11px] text-muted-foreground">{t("rejects")}: {nf(job.rejects)}</div>
      </div>
      <ShippingControl job={job} pendingQc={pendingQc} />
      <div className="flex flex-col items-start gap-1 md:items-end">
        <div className="flex flex-wrap gap-1.5">
          {canEditJobs && <EditJobButton job={job} hasLogs={hasLogs} />}
          <FlagIssueButton seed={{ jobId: job.id, machineId: job.machineId }} testId={`button-flag-job-${job.id}`} />
        </div>
        {job.status === "dispatched" ? <span className="text-xs text-muted-foreground">—</span> : (
          <button onClick={() => dispatch.mutate({ id: job.id })} disabled={!can || dispatch.isPending} title={blocker || undefined} data-testid={`button-dispatch-${job.id}`}
            className="inline-flex items-center gap-1.5 rounded-md border border-primary bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:brightness-110 disabled:border-border disabled:bg-secondary disabled:text-muted-foreground">
            <Send className="h-3.5 w-3.5 rtl:-scale-x-100" />{dispatch.isPending ? t("dispatching") : t("dispatch")}
          </button>
        )}
        {blocker && job.status !== "dispatched" && <span className="text-[11px] text-[hsl(var(--warn))]">{blocker}</span>}
      </div>
    </div>
  );
}

export default function Jobs() {
  const { t } = useI18n();
  const prot = useProtected();
  const jobs = useListJobs({ query: { queryKey: getListJobsQueryKey(), ...prot } });
  const logs = useListLogs({ query: { queryKey: getListLogsQueryKey(), ...prot } });
  const pendingFor = (id: string) => (logs.data ?? []).filter((l) => l.jobId === id && l.qcStatus !== "approved").length;
  return (
    <div className="space-y-6">
      <PageHeader title={t("jobsTitle")} sub={t("jobsSub")} />
      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        <JobForm />
        <Panel title={t("nav_jobs")} right={<span className="text-[11px] text-muted-foreground">{t("dispatchRule")}</span>} className="[&>div]:p-0">
          {jobs.isError ? <div className="p-4"><ErrorState error={jobs.error} onRetry={() => jobs.refetch()} /></div>
            : jobs.isLoading || !jobs.data ? <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Sk key={i} className="h-14" />)}</div>
            : jobs.data.length === 0 ? <div className="p-4"><Empty title={t("noJobs")} sub={t("noJobsSub")} /></div>
            : jobs.data.map((j) => <JobRow key={j.id} job={j} pendingQc={pendingFor(j.id)} hasLogs={(logs.data ?? []).some((l) => l.jobId === j.id)} />)}
        </Panel>
      </div>
    </div>
  );
}
