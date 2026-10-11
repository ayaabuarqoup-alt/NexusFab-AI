import { Info } from "lucide-react";
import { useGetSummary, getGetSummaryQueryKey, type Machine } from "@workspace/api-client-react";
import { useI18n } from "@/lib/i18n";
import { ErrorState, PageHeader, Panel, Pill, Sk, useProtected } from "@/components/common";
import { cn } from "@/lib/utils";
import { MachineStateCard, useMachineStates } from "@/components/machine-status";
import { FlagIssueButton } from "@/components/issue-form";

const tone = { stable: "ok", caution: "warn", high: "bad" } as const;
const bar = { stable: "bg-[hsl(var(--ok))]", caution: "bg-[hsl(var(--warn))]", high: "bg-destructive" };

export function MachineCard({ m, compact }: { m: Machine; compact?: boolean }) {
  const { t, nf } = useI18n();
  const score = Math.min(100, Math.max(0, m.fatigueScore));
  return (
    <div className="rise rounded-md border bg-card p-4 shadow-sm" data-testid={`card-machine-${m.id}`}>
      <div className="flex items-start justify-between gap-2">
        <div><div className="num text-[11px] text-muted-foreground">{m.id.toUpperCase()}</div><div className="font-medium">{m.name}</div></div>
        <Pill tone={tone[m.risk]} testId={`status-risk-${m.id}`}>{t(`risk_${m.risk}`)}</Pill>
      </div>
      <div className="mt-4 flex items-baseline justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("fatigue")}</span>
        <span className="num text-2xl font-semibold">{nf(score, 1)}%</span>
      </div>
      <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-secondary">
        <div className={cn("h-full origin-left rounded-full transition-transform duration-700 rtl:origin-right", bar[m.risk])} style={{ transform: `scaleX(${score / 100})` }} />
        <span className="absolute inset-y-0 w-px bg-foreground/30" style={{ insetInlineStart: "35%" }} />
        <span className="absolute inset-y-0 w-px bg-foreground/30" style={{ insetInlineStart: "70%" }} />
      </div>
      {!compact && <p className="mt-3 text-xs text-muted-foreground">{t(`rec_${m.risk}`)}</p>}
      <div className="mt-3 grid grid-cols-2 gap-2 border-t pt-3 text-xs">
        <div><div className="text-muted-foreground">{t("downtime")}</div><div className="num font-medium">{nf(m.downtimeMinutes)} {t("minutes")}</div></div>
        <div><div className="text-muted-foreground">{t("rejects")}</div><div className="num font-medium">{nf(m.rejects)}</div></div>
      </div>
    </div>
  );
}

export default function Machines() {
  const { t } = useI18n();
  const q = useGetSummary({ query: { queryKey: getGetSummaryQueryKey(), ...useProtected() } });
  const ms = useMachineStates();
  return (
    <div className="space-y-6">
      <PageHeader title={t("machinesTitle")} sub={t("machinesSub")} action={<FlagIssueButton testId="button-flag-machine" />} />
      <Panel title={t("liveTitle")}>
        <p className="mb-3 text-xs text-muted-foreground">{t("liveExplain")}</p>
        {ms.isError ? <ErrorState error={ms.error} onRetry={() => ms.refetch()} /> : !ms.data ? (
          <div className="grid gap-4 md:grid-cols-3"><Sk className="h-48" /><Sk className="h-48" /><Sk className="h-48" /></div>
        ) : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{ms.data.map((m) => <MachineStateCard key={`${m.id}-${m.updatedAt}`} m={m} />)}</div>}
      </Panel>
      <h2 className="rise pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t("heuristicTitle")}</h2>
      <div className="rise flex gap-3 rounded-md border border-primary/20 bg-primary/5 p-4 text-sm">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><p data-testid="text-fatigue-note">{t("fatigueNote")}</p>
      </div>
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data ? (
        <div className="grid gap-4 md:grid-cols-3"><Sk className="h-56" /><Sk className="h-56" /><Sk className="h-56" /></div>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">{q.data.machines.map((m) => <MachineCard key={m.id} m={m} />)}</div>
      )}
    </div>
  );
}
