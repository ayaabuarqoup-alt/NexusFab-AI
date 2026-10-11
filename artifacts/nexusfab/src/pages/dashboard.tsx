import { useMemo, useState } from "react";
import { Crosshair, Pin, RotateCcw, X } from "lucide-react";
import {
  useGetSummary, getGetSummaryQueryKey, useListLogs, getListLogsQueryKey, useListJobs, getListJobsQueryKey,
  type ProductionLog,
} from "@workspace/api-client-react";
import { useI18n } from "@/lib/i18n";
import { Empty, ErrorState, PageHeader, Panel, Pill, Plot, Sk, inputCls, useProtected, type PlotPoint } from "@/components/common";
import { MachineCard } from "@/pages/machines";

type Sel = { kind: "qc"; v: "good" | "rejects" } | { kind: "staff"; v: string } | { kind: "date"; v: string };
const NAVY = "#1E3A8A", AMBER = "#D97706";
const sameSel = (a: Sel | null, b: Sel | null) => !!a && !!b && a.kind === b.kind && a.v === b.v;
const matches = (l: ProductionLog, s: Sel) =>
  s.kind === "qc" ? (s.v === "good" ? l.goodQty > 0 : l.rejects > 0) : s.kind === "staff" ? l.staff === s.v && l.downtimeMinutes > 0 : l.date === s.v;

export default function Dashboard() {
  const { t, nf, cf, lang } = useI18n();
  const prot = useProtected();
  const q = useGetSummary({ query: { queryKey: getGetSummaryQueryKey(), ...prot } });
  const lq = useListLogs({ query: { queryKey: getListLogsQueryKey(), ...prot } });
  const jq = useListJobs({ query: { queryKey: getListJobsQueryKey(), ...prot } });
  const s = q.data;
  const [jobId, setJob] = useState("");
  const [machineId, setMachine] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [pinned, setPinned] = useState<Sel | null>(null);
  const [hover, setHover] = useState<Sel | null>(null);

  const jobs = jq.data ?? [];
  const jobName = useMemo(() => new Map(jobs.map((j) => [j.id, j.name])), [jobs]);
  const machineName = useMemo(() => new Map((s?.machines ?? []).map((m) => [m.id, `${t("machine")} ${nf(Number(m.id.slice(1)))}`])), [s, t, nf]);
  const machineIds = useMemo(() => Array.from(new Set([...(s?.machines ?? []).map((m) => m.id), ...jobs.map((j) => j.machineId)])), [s, jobs]);

  const scoped = useMemo(() => (lq.data ?? []).filter((l) =>
    (!jobId || l.jobId === jobId) && (!machineId || l.machineId === machineId) && (!from || l.date >= from) && (!to || l.date <= to),
  ).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time)), [lq.data, jobId, machineId, from, to]);

  const agg = useMemo(() => {
    const good = scoped.reduce((a, l) => a + l.goodQty, 0), rej = scoped.reduce((a, l) => a + l.rejects, 0), down = scoped.reduce((a, l) => a + l.downtimeMinutes, 0);
    const staff = new Map<string, number>(), days = new Map<string, { g: number; r: number }>();
    for (const l of scoped) {
      if (l.downtimeMinutes > 0) staff.set(l.staff, (staff.get(l.staff) ?? 0) + l.downtimeMinutes);
      const d = days.get(l.date) ?? { g: 0, r: 0 }; d.g += l.goodQty; d.r += l.rejects; days.set(l.date, d);
    }
    return {
      good, rej, down, leak: down * 5 + rej * 1.5, yieldPct: good + rej ? (good / (good + rej)) * 100 : 0,
      staff: [...staff.entries()].sort((a, b) => b[1] - a[1]),
      days: [...days.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    };
  }, [scoped]);

  const active = hover ?? pinned;
  const rows = useMemo(() => (active ? scoped.filter((l) => matches(l, active)) : scoped), [scoped, active]);
  const filtersOn = !!(jobId || machineId || from || to);
  const resetAll = () => { setJob(""); setMachine(""); setFrom(""); setTo(""); setPinned(null); setHover(null); };
  const toggle = (x: Sel) => setPinned((p) => (sameSel(p, x) ? null : x));

  const pie = useMemo(() => [{
    type: "pie" as const, hole: 0.62, labels: [t("goodQty"), t("rejects")], values: [agg.good, agg.rej], customdata: ["good", "rejects"],
    marker: { colors: [NAVY, AMBER], line: { color: "#F8FAFC", width: 2 } }, textinfo: "percent" as const, sort: false,
    pull: [pinned?.kind === "qc" && pinned.v === "good" ? 0.06 : 0, pinned?.kind === "qc" && pinned.v === "rejects" ? 0.06 : 0],
    hovertemplate: `%{label}: %{value} ${t("units")} (%{percent})<extra></extra>`,
  }], [agg, t, pinned]);
  const bar = useMemo(() => [{
    type: "bar" as const, x: agg.staff.map((d) => d[0]), y: agg.staff.map((d) => d[1]), name: t("downtimeMin"),
    marker: { color: agg.staff.map((d) => (pinned?.kind === "staff" && pinned.v !== d[0] ? "#94A3B8" : NAVY)) },
    hovertemplate: `%{x}: %{y} ${t("minutes")}<extra></extra>`,
  }], [agg, t, pinned]);
  const daily = useMemo(() => [
    { type: "bar" as const, x: agg.days.map((d) => d[0]), y: agg.days.map((d) => d[1].g), name: t("goodQty"), marker: { color: NAVY } },
    { type: "bar" as const, x: agg.days.map((d) => d[0]), y: agg.days.map((d) => d[1].r), name: t("rejects"), marker: { color: AMBER } },
  ], [agg, t]);
  const staffLayout = useMemo(() => ({ yaxis: { title: { text: t("downtimeMin") }, gridcolor: "#E2E8F0" } }), [t]);
  const dailyLayout = useMemo(() => ({ barmode: "stack" as const, yaxis: { gridcolor: "#E2E8F0" }, xaxis: { type: "category" as const } }), []);

  const qcSel = (p: PlotPoint): Sel => ({ kind: "qc", v: p.label === t("rejects") ? "rejects" : "good" });
  const selLabel = (x: Sel) => x.kind === "qc" ? t(x.v === "good" ? "selGood" : "selRejects") : `${t(x.kind === "staff" ? "byStaff" : "byDate")}: ${x.v}`;

  const err = q.isError ? q : lq.isError ? lq : jq.isError ? jq : null;
  if (err) return <><PageHeader title={t("overviewTitle")} sub={t("overviewSub")} /><div className="mt-6"><ErrorState error={err.error} onRetry={() => { q.refetch(); lq.refetch(); jq.refetch(); }} /></div></>;

  const chip = (x: Sel, label: string, key: string) => {
    const on = sameSel(pinned, x);
    return <button key={key} type="button" aria-pressed={on} onClick={() => toggle(x)} onFocus={() => setHover(x)} onBlur={() => setHover(null)}
      onMouseEnter={() => setHover(x)} onMouseLeave={() => setHover(null)} data-testid={`chip-${x.kind}-${key}`}
      className={`num rounded-sm border px-2 py-1 text-[11px] transition ${on ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:border-primary/40 hover:bg-primary/5"}`}>{label}</button>;
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t("overviewTitle")} sub={t("overviewSub")} />
      {!s || !lq.data || !jq.data ? (
        <div className="grid gap-4 md:grid-cols-4"><Sk className="h-14 md:col-span-4" /><Sk className="h-40 md:col-span-2" /><Sk className="h-40" /><Sk className="h-40" /><Sk className="h-72 md:col-span-2" /><Sk className="h-72 md:col-span-2" /></div>
      ) : (
        <>
          <section className="rise rounded-md border bg-card p-3 shadow-sm" data-testid="panel-filters">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_0.8fr_0.8fr_auto] lg:items-end">
              <label className="flex flex-col gap-1"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t("jobFilter")}</span>
                <select className={inputCls} value={jobId} onChange={(e) => { setJob(e.target.value); setPinned(null); }} data-testid="select-job">
                  <option value="">{t("allJobs")}</option>{jobs.map((j) => <option key={j.id} value={j.id}>{j.name} · {j.id}</option>)}
                </select></label>
              <label className="flex flex-col gap-1"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t("machineFilter")}</span>
                <select className={inputCls} value={machineId} onChange={(e) => { setMachine(e.target.value); setPinned(null); }} data-testid="select-machine">
                  <option value="">{t("allMachines")}</option>{machineIds.map((m) => <option key={m} value={m}>{machineName.get(m) ?? m}</option>)}
                </select></label>
              <label className="flex flex-col gap-1"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t("fromDate")}</span>
                <input type="date" lang={lang} className={`${inputCls} num`} value={from} max={to || undefined} onChange={(e) => { setFrom(e.target.value); setPinned(null); }} data-testid="input-from" /></label>
              <label className="flex flex-col gap-1"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t("toDate")}</span>
                <input type="date" lang={lang} className={`${inputCls} num`} value={to} min={from || undefined} onChange={(e) => { setTo(e.target.value); setPinned(null); }} data-testid="input-to" /></label>
              <button type="button" onClick={resetAll} disabled={!filtersOn && !pinned} data-testid="button-reset-filters" className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border px-3 text-sm transition hover:bg-secondary disabled:opacity-50"><RotateCcw className="h-3.5 w-3.5" />{t("resetAll")}</button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-2.5 text-[11px] text-muted-foreground">
              <span className="num font-semibold text-foreground" data-testid="text-scope-count">{nf(scoped.length)}</span>{t("scopeRecords")}
              {filtersOn && <Pill tone="info">{t("filteredScope")}</Pill>}
            </div>
          </section>

          <div className="grid gap-4 lg:grid-cols-[1.3fr_2fr]">
            <section className="rise relative overflow-hidden rounded-md bg-sidebar p-6 text-white shadow-md">
              <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/60">{filtersOn ? t("leakScope") : t("financialLeak")}</div>
              <div className="num mt-3 text-4xl font-semibold tracking-tight md:text-5xl" data-testid="text-leak">{cf(agg.leak)}</div>
              <div className="num mt-3 inline-block rounded-sm bg-white/10 px-2 py-1 text-[11px] text-white/75">{t("leakFormula")}</div>
              <div className="mt-5 grid grid-cols-2 gap-4 border-t border-white/10 pt-4 text-sm">
                <div><div className="text-[10px] uppercase tracking-wider text-white/55">{t("downtime")}</div><div className="num">{nf(agg.down)} {t("minutes")} · {cf(agg.down * 5)}</div></div>
                <div><div className="text-[10px] uppercase tracking-wider text-white/55">{t("rejects")}</div><div className="num">{nf(agg.rej)} · {cf(agg.rej * 1.5)}</div></div>
              </div>
              {filtersOn && <div className="num mt-3 text-[11px] text-white/50" data-testid="text-leak-overall">{t("serverOverall")}: {cf(s.financialLeak)}</div>}
              <div className="absolute -end-6 -top-6 h-28 w-28 rounded-full border-[14px] border-[hsl(32_95%_52%)]/30" />
            </section>
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border bg-border md:grid-cols-3">
              {[
                [t("goodQty"), nf(agg.good), "goodqty", false], [t("rejects"), nf(agg.rej), "rejects", false], [t("yield"), `${nf(agg.yieldPct, 1)}%`, "yield", false],
                [t("downtimeMin"), nf(agg.down), "downtime", false], [t("activeJobs"), nf(s.activeJobs), "jobs", true], [t("pendingQuality"), nf(s.pendingQuality), "pending", true],
              ].map(([l, v, id, overall], i) => (
                <div key={id as string} className={`rise rise-${(i % 4) + 1} bg-card p-4`}>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{l}</div>
                  <div className="num mt-2 text-2xl font-semibold" data-testid={`kpi-${id}`}>{v}</div>
                  {overall && filtersOn && <div className="mt-1 text-[10px] text-muted-foreground">{t("serverOverall")}</div>}
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title={t("ratioChart")}>
              {agg.good + agg.rej === 0 ? <Empty title={t("noData")} sub={t("noDataSub")} /> : <>
                <Plot data={pie} testId="chart-ratio" onClick={(p) => toggle(qcSel(p))} onHover={(p) => setHover(qcSel(p))} onUnhover={() => setHover(null)} />
                <div className="mt-2 flex flex-wrap gap-1.5">{chip({ kind: "qc", v: "good" }, t("selGood"), "good")}{chip({ kind: "qc", v: "rejects" }, t("selRejects"), "rejects")}</div>
              </>}
            </Panel>
            <Panel title={t("staffChart")}>
              {agg.staff.length === 0 ? <Empty title={t("noData")} sub={t("noDataSub")} /> : <>
                <Plot data={bar} layout={staffLayout} testId="chart-staff" onClick={(p) => toggle({ kind: "staff", v: String(p.x) })} onHover={(p) => setHover({ kind: "staff", v: String(p.x) })} onUnhover={() => setHover(null)} />
                <div className="mt-2 flex flex-wrap gap-1.5">{agg.staff.map(([n]) => chip({ kind: "staff", v: n }, n, n))}</div>
              </>}
            </Panel>
          </div>
          {agg.days.length > 0 && <Panel title={t("dailyChart")}>
            <Plot data={daily} height={240} layout={dailyLayout} testId="chart-daily" onClick={(p) => toggle({ kind: "date", v: String(p.x) })} onHover={(p) => setHover({ kind: "date", v: String(p.x) })} onUnhover={() => setHover(null)} />
            <div className="mt-2 flex max-h-20 flex-wrap gap-1.5 overflow-y-auto">{agg.days.map(([d]) => chip({ kind: "date", v: d }, d, d))}</div>
          </Panel>}

          <Panel title={t("explorerTitle")} right={
            <div className="flex items-center gap-2">
              {active && <span className="inline-flex items-center gap-1 rounded-sm bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary" data-testid="text-selection">
                {hover ? <Crosshair className="h-3 w-3" /> : <Pin className="h-3 w-3" />}{hover ? t("preview") : t("pinned")} · {selLabel(active)}</span>}
              {pinned && <button type="button" onClick={() => { setPinned(null); setHover(null); }} data-testid="button-clear-pin" className="inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[11px] hover:bg-secondary"><X className="h-3 w-3" />{t("clearPin")}</button>}
            </div>}>
            <p className="mb-3 text-xs text-muted-foreground">{active ? null : `${t("explorerAll")} · `}{t("explorerHint")}</p>
            {rows.length === 0 ? <Empty title={t("noMatch")} sub={t("noMatchSub")} /> : <RecordTable rows={rows} jobName={jobName} machineName={machineName} />}
          </Panel>

          <div className="grid gap-4 md:grid-cols-3">{s.machines.map((m) => <MachineCard key={m.id} m={m} compact />)}</div>
        </>
      )}
    </div>
  );
}

function RecordTable({ rows, jobName, machineName }: { rows: ProductionLog[]; jobName: Map<string, string>; machineName: Map<string, string> }) {
  const { t, nf, lang } = useI18n();
  const [LIMIT, setLimit] = useState(200);
  const shown = rows.slice(0, LIMIT);
  const tone = { pending: "warn", approved: "ok", rejected: "bad" } as const;
  return (
    <div className="overflow-hidden rounded-md border">
      <div className="max-h-[440px] overflow-auto">
        <table className="w-full min-w-[920px] text-sm" data-testid="table-drilldown">
          <thead className="sticky top-0 z-10 bg-secondary/90 text-[10px] uppercase tracking-wider text-muted-foreground backdrop-blur">
            <tr>{[t("colJob"), t("colMachine"), t("colOperator"), t("colWhen"), t("colGood"), t("colRej"), t("colDown"), t("colReason"), t("colQc")].map((h) => <th key={h} className="px-3 py-2 text-start font-semibold">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y">
            {shown.map((l) => (
              <tr key={l.id} className="align-top transition hover:bg-primary/[0.03]" data-testid={`row-log-${l.id}`}>
                <td className="px-3 py-2"><div className="font-medium">{jobName.get(l.jobId) ?? l.jobId}</div><div className="num text-[10px] text-muted-foreground" dir="ltr">{l.jobId} · {l.id}</div></td>
                <td className="px-3 py-2">{machineName.get(l.machineId) ?? l.machineId}</td>
                <td className="px-3 py-2">{l.staff}</td>
                <td className="num whitespace-nowrap px-3 py-2 text-xs" dir="ltr">{l.date} {l.time}</td>
                <td className="num px-3 py-2">{nf(l.goodQty)}</td>
                <td className={`num px-3 py-2 ${l.rejects ? "text-[hsl(var(--warn))]" : ""}`}>{nf(l.rejects)}</td>
                <td className="num px-3 py-2">{nf(l.downtimeMinutes)} {t("minutes")}</td>
                <td className="max-w-[220px] px-3 py-2 text-xs text-muted-foreground">{l.reason || "—"}</td>
                <td className="px-3 py-2"><Pill tone={tone[l.qcStatus]}>{t(`qc_${l.qcStatus}`)}</Pill>
                  {l.qcNote && <div className="mt-1 max-w-[180px] text-[11px] text-muted-foreground">{l.qcNote}</div>}
                  {l.reviewerName && <div className="text-[10px] text-muted-foreground">{t("reviewedBy")} {l.reviewerName}</div>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > LIMIT && <button type="button" onClick={() => setLimit(n => n + 200)} className="w-full border-t p-2 text-sm text-primary" data-testid="button-more-records">{lang === "ar" ? "عرض المزيد من السجلات" : "Show more records"}</button>}
      <div className="num border-t bg-secondary/30 px-3 py-1.5 text-[11px] text-muted-foreground" data-testid="text-row-count">{t("showingN")} {nf(shown.length)} {t("ofN")} {nf(rows.length)}</div>
    </div>
  );
}
