import { useMemo } from "react";
import { FlaskConical } from "lucide-react";
import { useGetSummary, getGetSummaryQueryKey, useListLogs, getListLogsQueryKey, useListJobs, getListJobsQueryKey } from "@workspace/api-client-react";
import { useI18n, type TKey } from "@/lib/i18n";
import { KpiAnalytics } from "@/components/oee";
import { Empty, ErrorState, PageHeader, Panel, Plot, Sk, useProtected } from "@/components/common";
import { useMachineStates } from "@/components/machine-status";
import { usePlans } from "@/pages/planning";
import Dashboard from "@/pages/dashboard";

// Palette from the chart authoring skill (primary cyan, blue, orange, grey).
const CYAN = "#61A9BD", CYAN_L = "#8CCEDE", BLUE = "#1F74AD", ORANGE = "#E98E2E", GREY = "#979797";

export function forecastFrom(daily: { date: string; good: number }[]) {
  const n = daily.length;
  if (n < 3) return null;
  const mean = daily.reduce((a, d) => a + d.good, 0) / n;
  const sd = Math.sqrt(daily.reduce((a, d) => a + (d.good - mean) ** 2, 0) / (n - 1));
  const dayHalf = 1.96 * sd * Math.sqrt(1 + 1 / n);
  const totHalf = 1.96 * sd * Math.sqrt(7 + 49 / n);
  return { n, mean, sd, dayLo: Math.max(0, mean - dayHalf), dayHi: mean + dayHalf, total: mean * 7, totLo: Math.max(0, mean * 7 - totHalf), totHi: mean * 7 + totHalf, from: daily[0].date, to: daily[n - 1].date };
}

export function useDailyGood() {
  const logs = useListLogs({ query: { queryKey: getListLogsQueryKey(), ...useProtected() } });
  const daily = useMemo(() => {
    const m = new Map<string, { good: number; rejects: number }>();
    (logs.data ?? []).forEach((l) => { const x = m.get(l.date) ?? { good: 0, rejects: 0 }; x.good += l.goodQty; x.rejects += l.rejects; m.set(l.date, x); });
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, v]) => ({ date, ...v }));
  }, [logs.data]);
  return { logs, daily };
}

export default function PlanningAnalytics() {
  const { t, nf } = useI18n();
  const prot = useProtected();
  const s = useGetSummary({ query: { queryKey: getGetSummaryQueryKey(), ...prot } });
  const jobs = useListJobs({ query: { queryKey: getListJobsQueryKey(), ...prot } });
  const ms = useMachineStates();
  const plans = usePlans();
  const { logs, daily } = useDailyGood();
  const fc = useMemo(() => forecastFrom(daily), [daily]);
  const f0 = (v: number) => nf(Math.round(v));

  const dailyData = useMemo<Plotly.Data[]>(() => {
    const x = daily.map((d) => d.date);
    const out: Plotly.Data[] = [
      { type: "bar", name: t("goodLbl"), x, y: daily.map((d) => d.good), marker: { color: CYAN }, hovertemplate: "%{x}<br>%{y:,} " + t("goodLbl") + "<extra></extra>" },
      { type: "scatter", mode: "lines+markers", name: t("rejectsLbl"), x, y: daily.map((d) => d.rejects), line: { color: ORANGE, width: 2 }, marker: { size: 5 }, hovertemplate: "%{x}<br>%{y:,} " + t("rejectsLbl") + "<extra></extra>" },
    ];
    return out;
  }, [daily, t]);

  const fcData = useMemo<Plotly.Data[]>(() => {
    if (!fc) return [];
    const hist = daily.slice(-14);
    const hx = hist.map((d) => d.date);
    const fx = Array.from({ length: 7 }, (_, i) => `${t("recDay")}${i + 1}`);
    return [
      { type: "bar", name: t("historical"), x: hx, y: hist.map((d) => d.good), marker: { color: CYAN }, hovertemplate: "%{x}<br>%{y:,}<extra></extra>" },
      { type: "scatter", mode: "lines", x: [...fx, ...[...fx].reverse()], y: [...fx.map(() => fc.dayHi), ...fx.map(() => fc.dayLo)], fill: "toself", fillcolor: "rgba(140,206,222,0.35)", line: { width: 0, color: CYAN_L }, name: t("fcBand"), hoverinfo: "skip" },
      { type: "scatter", mode: "lines+markers", name: t("estimate"), x: fx, y: fx.map(() => fc.mean), line: { color: BLUE, dash: "dash", width: 2 }, marker: { size: 5 }, hovertemplate: `%{x}<br>${t("estimate")} %{y:,.0f}<br>${t("fcBand")} ${f0(fc.dayLo)}–${f0(fc.dayHi)}<extra></extra>` },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fc, daily, t]);

  const machineData = useMemo<Plotly.Data[]>(() => {
    const ids = ["m1", "m2", "m3"];
    const good = ids.map((id) => (logs.data ?? []).filter((l) => l.machineId === id).reduce((a, l) => a + l.goodQty, 0));
    const rej = ids.map((id) => (logs.data ?? []).filter((l) => l.machineId === id).reduce((a, l) => a + l.rejects, 0));
    const x = ids.map((i) => i.toUpperCase());
    return [
      { type: "bar", name: t("goodLbl"), x, y: good, marker: { color: CYAN } },
      { type: "bar", name: t("rejectsLbl"), x, y: rej, marker: { color: ORANGE } },
    ];
  }, [logs.data, t]);

  const planMix = useMemo<Plotly.Data[]>(() => {
    const ks = ["draft", "scheduled", "completed"] as const;
    return [{ type: "pie", hole: 0.55, labels: ks.map((k) => t(`ps_${k}` as TKey)), values: ks.map((k) => (plans.data ?? []).filter((p) => p.status === k).length), marker: { colors: [GREY, BLUE, CYAN] }, textinfo: "value", sort: false }];
  }, [plans.data, t]);

  const stateCounts = (["running", "stopped", "maintenance", "unknown"] as const).map((k) => ({ k, n: (ms.data ?? []).filter((m) => m.status === k).length }));
  const stat = (label: string, v: string, id: string) => <div className="rounded-md border bg-secondary/30 p-3"><div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div><div className="num mt-1 text-xl font-semibold" data-testid={id}>{v}</div></div>;

  return (
    <div className="space-y-6">
      <PageHeader title={t("anTitle")} sub={t("anSub")} />
      <KpiAnalytics canConfigure={false} />
      <Panel title={t("forecastTitle")} right={<FlaskConical className="h-3.5 w-3.5 text-muted-foreground" />}>
        {logs.isError ? <ErrorState error={logs.error} onRetry={() => logs.refetch()} /> : !logs.data ? <Sk className="h-64" /> : !fc ? <Empty title={t("fcNeedData")} sub={t("fcLimits")} /> : (
          <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
            <Plot data={fcData} height={300} testId="chart-forecast" layout={{ xaxis: { type: "category" }, yaxis: { rangemode: "tozero" }, showlegend: true }} />
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {stat(t("fcMean"), f0(fc.mean), "text-fc-mean")}
                {stat(t("fcTotal"), f0(fc.total), "text-fc-total")}
                {stat(t("fcBand"), `${f0(fc.totLo)}–${f0(fc.totHi)}`, "text-fc-range")}
                {stat(t("fcSample"), `n = ${nf(fc.n)}`, "text-fc-n")}
              </div>
              <div className="text-xs"><span className="text-muted-foreground">{t("fcDates")}: </span><span className="num" data-testid="text-fc-dates">{fc.from} → {fc.to}</span></div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">{t("fcMethod")}</p>
              <p className="rounded-md border border-[hsl(var(--warn)/0.3)] bg-[hsl(var(--warn)/0.07)] p-2.5 text-[11px] leading-relaxed text-[hsl(var(--warn))]" data-testid="text-fc-limits">{t("fcLimits")}</p>
            </div>
          </div>
        )}
      </Panel>
      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <Panel title={t("dailyOutput")}>
          {!logs.data ? <Sk className="h-64" /> : daily.length === 0 ? <Empty title={t("noLogs")} sub={t("noLogsSub")} /> : <Plot data={dailyData} height={280} testId="chart-daily" layout={{ xaxis: { type: "category" }, yaxis: { rangemode: "tozero" } }} />}
        </Panel>
        <Panel title={t("byMachine")}>
          {!logs.data ? <Sk className="h-64" /> : <Plot data={machineData} height={280} testId="chart-machine" layout={{ barmode: "group", yaxis: { rangemode: "tozero" } }} />}
        </Panel>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t("planStatusMix")}>
          {plans.isError ? <ErrorState error={plans.error} onRetry={() => plans.refetch()} /> : !plans.data ? <Sk className="h-56" /> : plans.data.length === 0 ? <Empty title={t("noPlans")} sub={t("noPlansSub")} /> : <Plot data={planMix} height={240} testId="chart-plan-mix" />}
        </Panel>
        <Panel title={t("machineStates")}>
          {ms.isError ? <ErrorState error={ms.error} onRetry={() => ms.refetch()} /> : !ms.data ? <Sk className="h-56" /> : (
            <div className="grid grid-cols-2 gap-2">
              {stateCounts.map(({ k, n }) => <div key={k}>{stat(t(`ms_${k}` as TKey), nf(n), `text-ms-${k}`)}</div>)}
              {stat(t("kpiActiveJobs"), s.data ? nf(s.data.activeJobs) : "—", "text-an-active")}
              {stat(t("openOrders"), jobs.data ? nf(jobs.data.filter((j) => j.status !== "dispatched").length) : "—", "text-an-open")}
            </div>
          )}
        </Panel>
      </div>
      <section className="space-y-3 border-t pt-6">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t("deeper")}</h2>
        <Dashboard />
      </section>
    </div>
  );
}
