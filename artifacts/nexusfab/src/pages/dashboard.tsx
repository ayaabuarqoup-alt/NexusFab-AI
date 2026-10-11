import { useMemo } from "react";
import { useGetSummary, getGetSummaryQueryKey } from "@workspace/api-client-react";
import { useI18n } from "@/lib/i18n";
import { Empty, ErrorState, PageHeader, Panel, Plot, Sk, useProtected } from "@/components/common";
import { MachineCard } from "@/pages/machines";

export default function Dashboard() {
  const { t, nf, cf } = useI18n();
  const q = useGetSummary({ query: { queryKey: getGetSummaryQueryKey(), ...useProtected() } });
  const s = q.data;

  const pie = useMemo(() => s ? [{
    type: "pie" as const, hole: 0.62, labels: [t("goodQty"), t("rejects")], values: [s.goodQty, s.rejects],
    marker: { colors: ["#1E3A8A", "#D97706"] }, textinfo: "percent" as const, sort: false,
    hovertemplate: `%{label}: %{value} ${t("units")} (%{percent})<extra></extra>`,
  }] : [], [s, t]);
  const bar = useMemo(() => s ? [{
    type: "bar" as const, x: s.staffDowntime.map((d) => d.staff), y: s.staffDowntime.map((d) => d.minutes), name: t("downtimeMin"),
    marker: { color: "#1E3A8A" }, hovertemplate: `%{x}: %{y} ${t("minutes")}<extra></extra>`,
  }] : [], [s, t]);
  const daily = useMemo(() => s ? [
    { type: "bar" as const, x: s.dailyProduction.map((d) => d.date), y: s.dailyProduction.map((d) => d.goodQty), name: t("goodQty"), marker: { color: "#1E3A8A" } },
    { type: "bar" as const, x: s.dailyProduction.map((d) => d.date), y: s.dailyProduction.map((d) => d.rejects), name: t("rejects"), marker: { color: "#D97706" } },
  ] : [], [s, t]);

  if (q.isError) return <><PageHeader title={t("overviewTitle")} sub={t("overviewSub")} /><div className="mt-6"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div></>;

  return (
    <div className="space-y-6">
      <PageHeader title={t("overviewTitle")} sub={t("overviewSub")} />
      {!s ? (
        <div className="grid gap-4 md:grid-cols-4"><Sk className="h-40 md:col-span-2" /><Sk className="h-40" /><Sk className="h-40" /><Sk className="h-72 md:col-span-2" /><Sk className="h-72 md:col-span-2" /></div>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-[1.3fr_2fr]">
            <section className="rise relative overflow-hidden rounded-md bg-sidebar p-6 text-white shadow-md">
              <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/60">{t("financialLeak")}</div>
              <div className="num mt-3 text-4xl font-semibold tracking-tight md:text-5xl" data-testid="text-leak">{cf(s.financialLeak)}</div>
              <div className="num mt-3 inline-block rounded-sm bg-white/10 px-2 py-1 text-[11px] text-white/75">{t("leakFormula")}</div>
              <div className="mt-5 grid grid-cols-2 gap-4 border-t border-white/10 pt-4 text-sm">
                <div><div className="text-[10px] uppercase tracking-wider text-white/55">{t("downtime")}</div><div className="num">{nf(s.downtimeMinutes)} {t("minutes")} · {cf(s.downtimeMinutes * 5)}</div></div>
                <div><div className="text-[10px] uppercase tracking-wider text-white/55">{t("rejects")}</div><div className="num">{nf(s.rejects)} · {cf(s.rejects * 1.5)}</div></div>
              </div>
              <div className="absolute -end-6 -top-6 h-28 w-28 rounded-full border-[14px] border-[hsl(32_95%_52%)]/30" />
            </section>
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border bg-border md:grid-cols-3">
              {[
                [t("goodQty"), nf(s.goodQty), "goodqty"], [t("rejects"), nf(s.rejects), "rejects"], [t("yield"), `${nf(s.yieldPercent, 1)}%`, "yield"],
                [t("downtimeMin"), nf(s.downtimeMinutes), "downtime"], [t("activeJobs"), nf(s.activeJobs), "jobs"], [t("pendingQuality"), nf(s.pendingQuality), "pending"],
              ].map(([l, v, id], i) => (
                <div key={id} className={`rise rise-${(i % 4) + 1} bg-card p-4`}>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{l}</div>
                  <div className="num mt-2 text-2xl font-semibold" data-testid={`kpi-${id}`}>{v}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title={t("ratioChart")}>{s.goodQty + s.rejects === 0 ? <Empty title={t("noData")} sub={t("noDataSub")} /> : <Plot data={pie} testId="chart-ratio" />}</Panel>
            <Panel title={t("staffChart")}>{s.staffDowntime.length === 0 ? <Empty title={t("noData")} sub={t("noDataSub")} /> : <Plot data={bar} layout={{ yaxis: { title: { text: t("downtimeMin") }, gridcolor: "#E2E8F0" } }} testId="chart-staff" />}</Panel>
          </div>
          {s.dailyProduction.length > 0 && <Panel title={t("dailyChart")}><Plot data={daily} height={240} layout={{ barmode: "stack", yaxis: { gridcolor: "#E2E8F0" } }} testId="chart-daily" /></Panel>}
          <div className="grid gap-4 md:grid-cols-3">{s.machines.map((m) => <MachineCard key={m.id} m={m} compact />)}</div>
        </>
      )}
    </div>
  );
}
