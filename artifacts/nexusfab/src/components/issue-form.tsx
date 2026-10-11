import { useState, type FormEvent, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Flag } from "lucide-react";
import {
  useCreateIssue, getListIssuesQueryKey, getListNotificationsQueryKey, useListJobs, getListJobsQueryKey, useListLogs, getListLogsQueryKey,
  type IssueInputMachineId, type IssueInputSeverity,
} from "@workspace/api-client-react";
import { useI18n, errorMessage, type TKey } from "@/lib/i18n";
import { Field, inputCls, btnCls, useProtected, MACHINE_IDS } from "@/components/common";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const SEV: IssueInputSeverity[] = ["low", "normal", "high", "critical"];
export type IssueSeed = { machineId?: string; jobId?: string; logId?: string; title?: string };

export function IssueForm({ seed, onDone }: { seed?: IssueSeed; onDone?: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { toast } = useToast();
  const prot = useProtected();
  const jobs = useListJobs({ query: { queryKey: getListJobsQueryKey(), ...prot } });
  const logs = useListLogs({ query: { queryKey: getListLogsQueryKey(), ...prot } });
  const [f, setF] = useState({ machineId: seed?.machineId ?? "", jobId: seed?.jobId ?? "", logId: seed?.logId ?? "", title: seed?.title ?? "", description: "", severity: "normal" as IssueInputSeverity });
  const [err, setErr] = useState("");
  const create = useCreateIssue({ mutation: { onSuccess: () => {
    qc.invalidateQueries({ queryKey: getListIssuesQueryKey() }); qc.invalidateQueries({ queryKey: getListNotificationsQueryKey() });
    toast({ title: t("issueCreated") }); setF((p) => ({ ...p, title: "", description: "" })); onDone?.();
  } } });
  const pickLog = (id: string) => {
    const l = (logs.data ?? []).find((x) => x.id === id);
    setF((p) => ({ ...p, logId: id, ...(l ? { jobId: l.jobId, machineId: l.machineId } : {}) }));
  };
  const pickJob = (id: string) => {
    const j = (jobs.data ?? []).find((x) => x.id === id);
    setF((p) => ({ ...p, jobId: id, logId: p.logId && (logs.data ?? []).find((l) => l.id === p.logId)?.jobId !== id ? "" : p.logId, ...(j ? { machineId: j.machineId } : {}) }));
  };
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr("");
    if (!f.machineId || !f.title.trim() || !f.description.trim()) return setErr(t("required"));
    create.mutate({ data: { machineId: f.machineId as IssueInputMachineId, title: f.title.trim().slice(0, 160), description: f.description.trim().slice(0, 2000), severity: f.severity, ...(f.jobId ? { jobId: f.jobId } : {}), ...(f.logId ? { logId: f.logId } : {}) } });
  };
  const logOpts = (logs.data ?? []).filter((l) => !f.jobId || l.jobId === f.jobId).slice(0, 80);
  return (
    <form onSubmit={submit} className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("linkedJob")}>
          <select className={inputCls} value={f.jobId} onChange={(e) => pickJob(e.target.value)} data-testid="select-issue-job">
            <option value="">{t("none")}</option>
            {(jobs.data ?? []).map((j) => <option key={j.id} value={j.id}>{j.name} · {j.machineId.toUpperCase()}</option>)}
          </select>
        </Field>
        <Field label={t("linkedLog")}>
          <select className={inputCls} value={f.logId} onChange={(e) => pickLog(e.target.value)} data-testid="select-issue-log">
            <option value="">{t("none")}</option>
            {logOpts.map((l) => <option key={l.id} value={l.id}>{l.date} {l.time} · {l.staff} · {l.machineId.toUpperCase()}</option>)}
          </select>
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr]">
        <Field label={t("machine")}>
          <select className={inputCls} value={f.machineId} onChange={(e) => setF({ ...f, machineId: e.target.value })} disabled={!!f.jobId} data-testid="select-issue-machine">
            <option value="">—</option>
            {MACHINE_IDS.map((m) => <option key={m} value={m}>{m.toUpperCase()}</option>)}
          </select>
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("severity")}</span>
          <div role="radiogroup" className="grid grid-cols-4 gap-1">
            {SEV.map((s) => (
              <button type="button" key={s} role="radio" aria-checked={f.severity === s} onClick={() => setF({ ...f, severity: s })} data-testid={`button-severity-${s}`}
                className={cn("h-9 rounded-md border text-xs font-medium transition", f.severity === s ? (s === "critical" ? "border-destructive bg-destructive text-destructive-foreground" : s === "high" ? "border-[hsl(var(--warn))] bg-[hsl(var(--warn))] text-white" : "border-primary bg-primary text-primary-foreground") : "bg-card text-muted-foreground hover:border-primary/40")}>
                {t(`sev_${s}` as TKey)}
              </button>
            ))}
          </div>
        </div>
      </div>
      <Field label={t("issueTitle")}><input className={inputCls} maxLength={160} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} data-testid="input-issue-title" /></Field>
      <Field label={t("issueDesc")}><textarea rows={3} maxLength={2000} className={`${inputCls} h-auto py-2`} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} data-testid="input-issue-description" /></Field>
      {(err || create.isError) && <p className="text-xs text-destructive" data-testid="text-issue-error">{err || errorMessage(create.error, t)}</p>}
      <button disabled={create.isPending} className={btnCls} data-testid="button-submit-issue"><Flag className="h-4 w-4" />{create.isPending ? t("creatingIssue") : t("createIssue")}</button>
    </form>
  );
}

export function FlagIssueButton({ seed, children, className, testId }: { seed?: IssueSeed; children?: ReactNode; className?: string; testId?: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} data-testid={testId ?? "button-flag-issue"}
        className={className ?? "inline-flex items-center gap-1.5 rounded-md border border-[hsl(32_95%_52%/0.5)] bg-[hsl(32_95%_52%/0.08)] px-2.5 py-1.5 text-xs font-medium text-[hsl(32_80%_34%)] transition hover:bg-[hsl(32_95%_52%/0.16)]"}>
        <Flag className="h-3.5 w-3.5" />{children ?? t("flagIssue")}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader><DialogTitle>{t("flagIssue")}</DialogTitle><DialogDescription>{t("issuesSub")}</DialogDescription></DialogHeader>
          {open && <IssueForm seed={seed} onDone={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}
