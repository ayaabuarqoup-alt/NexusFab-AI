import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Search } from "lucide-react";
import { useResolveIssue, getListIssuesQueryKey, useListJobs, getListJobsQueryKey, type Issue } from "@workspace/api-client-react";
import { useI18n, errorMessage, type TKey } from "@/lib/i18n";
import { Empty, ErrorState, PageHeader, Panel, Pill, Sk, inputCls, sevTone, useFmt, useProtected, useRole, PermNote } from "@/components/common";
import { IssueForm } from "@/components/issue-form";
import { IssueEscalation } from "@/components/issue-escalation";
import { useIssues } from "@/pages/home";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

function IssueCard({ i, jobName }: { i: Issue; jobName?: string }) {
  const { t } = useI18n();
  const fmt = useFmt();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { canReview } = useRole();
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(false);
  const res = useResolveIssue({ mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getListIssuesQueryKey() }); toast({ title: t("issueResolved") }); } } });
  const go = () => { setErr(""); if (!note.trim()) return setErr(t("required")); res.mutate({ id: i.id, data: { note: note.trim().slice(0, 1000) } }); };
  return (
    <article id={i.id} className={cn("rise scroll-mt-24 rounded-md border bg-card p-4 shadow-sm target:ring-2 target:ring-[hsl(32_95%_52%)]", i.status === "resolved" && "opacity-80")} data-testid={`card-issue-${i.id}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Pill tone={sevTone[i.severity]} testId={`status-severity-${i.id}`}>{t(`sev_${i.severity}` as TKey)}</Pill>
        <Pill tone={i.status === "open" ? "warn" : "ok"} testId={`status-issue-${i.id}`}>{t(`is_${i.status}` as TKey)}</Pill>
        <span className="num ms-auto text-[11px] text-muted-foreground">{fmt(i.createdAt)}</span>
      </div>
      <h3 className="mt-2 font-semibold">{i.title}</h3>
      <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{i.description}</p>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 border-t pt-3 text-xs sm:grid-cols-4">
        <div><dt className="text-muted-foreground">{t("machine")}</dt><dd className="num font-medium">{i.machineId.toUpperCase()}</dd></div>
        <div><dt className="text-muted-foreground">{t("linkedJob")}</dt><dd className="truncate font-medium">{i.jobId ? jobName || i.jobId : "—"}</dd></div>
        <div><dt className="text-muted-foreground">{t("linkedLog")}</dt><dd dir="ltr" className="num truncate rtl:text-end">{i.logId || "—"}</dd></div>
        <div><dt className="text-muted-foreground">{t("reportedBy")}</dt><dd className="truncate font-medium">{i.createdByName || i.createdBy}</dd></div>
      </dl>
      <IssueEscalation issue={i} />
      {i.status === "resolved" ? (
        <div className="mt-3 rounded-md bg-[hsl(var(--ok)/0.08)] px-3 py-2 text-xs" data-testid={`text-resolution-${i.id}`}>
          <span className="font-medium">{t("resolvedBy")}: {i.resolvedBy || "—"}</span> · <span className="num">{fmt(i.resolvedAt)}</span>
          {i.resolutionNote && <p className="mt-1 text-muted-foreground">{i.resolutionNote}</p>}
        </div>
      ) : canReview ? (open ? (
        <div className="mt-3 grid gap-2">
          <textarea rows={2} maxLength={1000} placeholder={t("resolutionNote")} aria-label={t("resolutionNote")} value={note} onChange={(e) => setNote(e.target.value)} className={`${inputCls} h-auto py-2`} data-testid={`input-resolve-${i.id}`} />
          {(err || res.isError) && <p className="text-xs text-destructive">{err || errorMessage(res.error, t)}</p>}
          <div className="flex justify-end gap-1.5">
            <button onClick={() => setOpen(false)} className="rounded-md border px-3 py-1.5 text-xs" data-testid={`button-cancel-resolve-${i.id}`}>{t("cancel")}</button>
            <button onClick={go} disabled={res.isPending} className="inline-flex items-center gap-1 rounded-md bg-[hsl(var(--ok))] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60" data-testid={`button-confirm-resolve-${i.id}`}><Check className="h-3.5 w-3.5" />{res.isPending ? t("resolving") : t("resolve")}</button>
          </div>
        </div>
      ) : <button onClick={() => setOpen(true)} className="mt-3 inline-flex items-center gap-1 rounded-md border border-[hsl(var(--ok)/0.4)] px-3 py-1.5 text-xs font-medium text-[hsl(var(--ok))] hover:bg-[hsl(var(--ok)/0.06)]" data-testid={`button-resolve-${i.id}`}><Check className="h-3.5 w-3.5" />{t("resolve")}</button>)
        : <div className="mt-3"><PermNote>{t("permResolve")}</PermNote></div>}
    </article>
  );
}

export default function Issues() {
  const { t, nf } = useI18n();
  const q = useIssues();
  const jobs = useListJobs({ query: { queryKey: getListJobsQueryKey(), ...useProtected() } });
  const jobName = useMemo(() => new Map((jobs.data ?? []).map((j) => [j.id, j.name])), [jobs.data]);
  const [st, setSt] = useState<"" | "open" | "resolved">("open");
  const [sev, setSev] = useState("");
  const [qs, setQs] = useState("");
  useEffect(() => { if (q.data && location.hash) { setSt(""); setTimeout(() => document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: "center" }), 50); } }, [q.data]);
  const list = useMemo(() => {
    const s = qs.trim().toLowerCase();
    return (q.data ?? []).filter((i) => (!st || i.status === st) && (!sev || i.severity === sev) && (!s || [i.title, i.description, i.createdByName, i.machineId, i.jobId, i.logId].some((v) => v?.toLowerCase().includes(s))))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [q.data, st, sev, qs]);
  const openN = (q.data ?? []).filter((i) => i.status === "open").length;
  return (
    <div className="space-y-6">
      <PageHeader title={t("issuesTitle")} sub={t("issuesSub")} />
      <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
        <Panel title={t("newIssue")} className="self-start lg:sticky lg:top-6"><IssueForm /></Panel>
        <div className="space-y-3">
          <div className="rise flex flex-wrap items-center gap-2 rounded-md border bg-card p-2">
            <div className="relative min-w-[180px] flex-1"><Search className="pointer-events-none absolute start-2.5 top-2.5 h-4 w-4 text-muted-foreground" /><input className={`${inputCls} ps-8`} placeholder={t("searchPh")} value={qs} onChange={(e) => setQs(e.target.value)} data-testid="input-issue-search" /></div>
            <select className={`${inputCls} w-auto`} value={st} onChange={(e) => setSt(e.target.value as typeof st)} data-testid="select-issue-status">
              <option value="">{t("allStatuses")}</option><option value="open">{t("is_open")} ({nf(openN)})</option><option value="resolved">{t("is_resolved")}</option>
            </select>
            <select className={`${inputCls} w-auto`} value={sev} onChange={(e) => setSev(e.target.value)} data-testid="select-issue-severity">
              <option value="">{t("allSeverities")}</option>{(["critical", "high", "normal", "low"] as const).map((s) => <option key={s} value={s}>{t(`sev_${s}` as TKey)}</option>)}
            </select>
          </div>
          {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data ? <div className="space-y-3">{[0, 1, 2].map((i) => <Sk key={i} className="h-40" />)}</div>
            : list.length === 0 ? <Empty title={t("noIssues")} sub={t("noIssuesSub")} />
            : <div className="grid gap-3 xl:grid-cols-2">{list.map((i) => <IssueCard key={i.id} i={i} jobName={i.jobId ? jobName.get(i.jobId) : undefined} />)}</div>}
        </div>
      </div>
    </div>
  );
}
