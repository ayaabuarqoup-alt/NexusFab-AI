import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { useListLogs, getListLogsQueryKey, useReviewQuality, getListJobsQueryKey, getGetSummaryQueryKey, type ProductionLog } from "@workspace/api-client-react";
import { useI18n, errorMessage } from "@/lib/i18n";
import { Empty, ErrorState, PageHeader, Panel, Pill, Sk, inputCls, useProtected, useRole, PermNote } from "@/components/common";
import { qcTone } from "@/pages/production";
import { useToast } from "@/hooks/use-toast";
import { FlagIssueButton } from "@/components/issue-form";

function ReviewCard({ log }: { log: ProductionLog }) {
  const { t, nf } = useI18n();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { canReview } = useRole();
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const review = useReviewQuality({ mutation: { onSuccess: () => {
    [getListLogsQueryKey(), getListJobsQueryKey(), getGetSummaryQueryKey()].forEach((queryKey) => qc.invalidateQueries({ queryKey }));
    toast({ title: t("reviewSaved") });
  } } });
  const go = (status: "approved" | "rejected") => {
    setErr("");
    if (!note.trim()) return setErr(t("required"));
    review.mutate({ id: log.id, data: { status, note: note.trim() } });
  };
  const rate = log.goodQty + log.rejects > 0 ? (log.rejects / (log.goodQty + log.rejects)) * 100 : 0;
  return (
    <div className="rise rounded-md border bg-card p-4 shadow-sm" data-testid={`card-review-${log.id}`}>
      <div className="flex items-start justify-between gap-2">
        <div><div className="font-medium">{log.staff}</div><div className="num text-[11px] text-muted-foreground">{log.machineId.toUpperCase()} · {log.date} {log.time}</div></div>
        <div className="flex items-center gap-1.5"><FlagIssueButton seed={{ logId: log.id, jobId: log.jobId, machineId: log.machineId }} testId={`button-flag-log-${log.id}`} /><Pill tone="warn">{t("qc_pending")}</Pill></div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-px overflow-hidden rounded border bg-border text-center">
        {[[t("goodQty"), nf(log.goodQty)], [t("rejects"), nf(log.rejects)], ["%", nf(rate, 1)]].map(([l, v]) => (
          <div key={l} className="bg-card px-2 py-2"><div className="text-[10px] uppercase tracking-wider text-muted-foreground">{l}</div><div className="num font-semibold">{v}</div></div>
        ))}
      </div>
      {!canReview ? <div className="mt-3"><PermNote>{t("permReview")}</PermNote></div> : <>
      <textarea rows={2} maxLength={500} placeholder={t("notePh")} aria-label={t("note")} value={note} onChange={(e) => setNote(e.target.value)} className={`${inputCls} mt-3 h-auto py-2`} data-testid={`input-note-${log.id}`} />
      {(err || review.isError) && <p className="mt-1 text-xs text-destructive">{err || errorMessage(review.error, t)}</p>}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button onClick={() => go("rejected")} disabled={review.isPending} data-testid={`button-reject-${log.id}`} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-destructive/40 text-sm font-medium text-destructive transition hover:bg-destructive/5 disabled:opacity-60"><X className="h-4 w-4" />{t("reject")}</button>
        <button onClick={() => go("approved")} disabled={review.isPending} data-testid={`button-approve-${log.id}`} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary text-sm font-medium text-primary-foreground transition hover:brightness-110 disabled:opacity-60"><Check className="h-4 w-4" />{t("approve")}</button>
      </div>
      </>}
    </div>
  );
}

export default function Quality() {
  const { t, nf } = useI18n();
  const logs = useListLogs({ query: { queryKey: getListLogsQueryKey(), ...useProtected() } });
  const pending = (logs.data ?? []).filter((l) => l.qcStatus === "pending");
  const decided = (logs.data ?? []).filter((l) => l.qcStatus !== "pending");
  return (
    <div className="space-y-6">
      <PageHeader title={t("qualityTitle")} sub={t("qualitySub")} action={<FlagIssueButton testId="button-flag-quality" />} />
      {logs.isError ? <ErrorState error={logs.error} onRetry={() => logs.refetch()} /> : !logs.data ? (
        <div className="grid gap-4 md:grid-cols-3"><Sk className="h-60" /><Sk className="h-60" /><Sk className="h-60" /></div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 text-xs">
            <Pill tone="warn">{t("pending")}: {nf(pending.length)}</Pill>
            <Pill tone="ok">{t("approved")}: {nf(decided.filter((l) => l.qcStatus === "approved").length)}</Pill>
            <Pill tone="bad">{t("rejected")}: {nf(decided.filter((l) => l.qcStatus === "rejected").length)}</Pill>
          </div>
          {pending.length === 0 ? <Empty title={t("noPending")} sub={t("noPendingSub")} /> : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{pending.map((l) => <ReviewCard key={l.id} log={l} />)}</div>
          )}
          <Panel title={t("history")} className="[&>div]:p-0">
            {decided.length === 0 ? <div className="p-4 text-sm text-muted-foreground">—</div> : decided.map((l) => (
              <div key={l.id} className="flex flex-col gap-1 border-b px-4 py-3 last:border-0 md:flex-row md:items-center md:gap-4" data-testid={`row-decision-${l.id}`}>
                <Pill tone={qcTone[l.qcStatus]}>{t(`qc_${l.qcStatus}`)}</Pill>
                <span className="num text-xs text-muted-foreground">{l.machineId.toUpperCase()} · {l.date} {l.time}</span>
                <span className="text-sm">{l.staff}</span>
                <span className="num text-xs">{nf(l.goodQty)} / {nf(l.rejects)}</span>
                <span className="flex-1 truncate text-xs text-muted-foreground md:text-end">{l.qcNote}</span>
                <FlagIssueButton seed={{ logId: l.id, jobId: l.jobId, machineId: l.machineId }} testId={`button-flag-decided-${l.id}`} />
                {(l.reviewerName || l.reviewedBy) && <span className="text-[11px] text-muted-foreground" data-testid={`text-reviewer-${l.id}`}>{t("reviewedBy")}: <span className="font-medium text-foreground">{l.reviewerName || l.reviewedBy}</span>{l.reviewedAt && <span className="num"> · {new Date(l.reviewedAt).toLocaleString()}</span>}</span>}
              </div>
            ))}
          </Panel>
        </>
      )}
    </div>
  );
}
