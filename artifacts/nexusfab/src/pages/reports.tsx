import { useMemo } from "react";
import { Download } from "lucide-react";
import { useGetSummary, getGetSummaryQueryKey, useListJobs, getListJobsQueryKey, useListLogs, getListLogsQueryKey } from "@workspace/api-client-react";
import { useI18n, type TKey } from "@/lib/i18n";
import { ErrorState, Panel, Pill, Sk, ghostCls, downloadCsv, msTone, useProtected } from "@/components/common";
import { useMachineStates } from "@/components/machine-status";
import { useIssues } from "@/pages/home";
import { ExportBar } from "@/components/exports";
import Dashboard from "@/pages/dashboard";

export default function Reports() {
  const { t, nf } = useI18n();
  const prot = useProtected();
  const s = useGetSummary({ query: { queryKey: getGetSummaryQueryKey(), ...prot } });
  const jobs = useListJobs({ query: { queryKey: getListJobsQueryKey(), ...prot } });
  const logs = useListLogs({ query: { queryKey: getListLogsQueryKey(), ...prot } });
  const issues = useIssues();
  const ms = useMachineStates();
  const m = useMemo(() => {
    const all = issues.data ?? [];
    const resolved = all.filter((i) => i.status === "resolved" && i.resolvedAt);
    const avgH = resolved.length ? resolved.reduce((a, i) => a + (new Date(i.resolvedAt!).getTime() - new Date(i.createdAt).getTime()), 0) / resolved.length / 3_600_000 : null;
    const ids = Array.from(new Set([...(s.data?.machines ?? []).map((x) => x.id), ...(ms.data ?? []).map((x) => x.id)]));
    const perMachine = ids.map((id) => ({
      id, fat: s.data?.machines.find((x) => x.id === id), live: ms.data?.find((x) => x.id === id),
      open: all.filter((i) => i.machineId === id && i.status === "open").length, total: all.filter((i) => i.machineId === id).length,
    }));
    return { total: all.length, open: all.length - all.filter((i) => i.status === "resolved").length, resolved: all.filter((i) => i.status === "resolved").length, critical: all.filter((i) => i.severity === "critical" && i.status === "open").length, avgH, perMachine };
  }, [issues.data, s.data, ms.data]);
  const exportAll = () => {
    const rows: (string | number | undefined)[][] = [["section", "id", "name", "machine", "status", "target_or_good", "rejects", "downtime_min", "date", "note"]];
    (jobs.data ?? []).forEach((j) => rows.push(["job", j.id, j.name, j.machineId, `${j.status}/${j.shippingStatus ?? "pending"}`, `${j.goodQty}/${j.target}`, j.rejects, "", j.dueDate, ""]));
    (logs.data ?? []).forEach((l) => rows.push(["log", l.id, l.staff, l.machineId, l.qcStatus, l.goodQty, l.rejects, l.downtimeMinutes, `${l.date} ${l.time}`, l.reason]));
    (issues.data ?? []).forEach((i) => rows.push(["issue", i.id, i.title, i.machineId, `${i.status}/${i.severity}`, "", "", "", i.createdAt, i.resolutionNote]));
    m.perMachine.forEach((x) => rows.push(["machine", x.id, x.live?.name ?? x.fat?.name, x.id, x.live?.status ?? "unknown", "", x.fat?.rejects, x.fat?.downtimeMinutes, x.live?.updatedAt, x.live?.note]));
    downloadCsv(`nexusfab-report-${new Date().toISOString().slice(0, 10)}.csv`, rows);
  };
  const ready = !!(jobs.data && logs.data && issues.data);
  const card = (label: string, v: string, id: string) => <div className="rounded-md border bg-secondary/30 p-3"><div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div><div className="num mt-1 text-2xl font-semibold" data-testid={id}>{v}</div></div>;
  return (
    <div className="space-y-6">
      <ExportBar kinds={["reports"]} compact />
      <Dashboard />
      <div className="rise flex flex-wrap items-center justify-between gap-3 border-t pt-6">
        <div><h2 className="text-xl font-semibold tracking-tight">{t("reportsTitle")}</h2><p className="text-sm text-muted-foreground">{t("reportsSub")}</p></div>
        <button className={ghostCls} onClick={exportAll} disabled={!ready} data-testid="button-export-report"><Download className="h-3.5 w-3.5" />{t("exportCsv")}</button>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <Panel title={t("issueMetrics")}>
          {issues.isError ? <ErrorState error={issues.error} onRetry={() => issues.refetch()} /> : !issues.data ? <Sk className="h-40" /> : (
            <div className="grid grid-cols-2 gap-3">
              {card(t("totalIssues"), nf(m.total), "metric-total-issues")}
              {card(t("kpiOpenIssues"), nf(m.open), "metric-open-issues")}
              {card(t("kpiCritical"), nf(m.critical), "metric-critical")}
              {card(t("avgResolve"), m.avgH === null ? "—" : `${nf(m.avgH, 1)} ${t("hours")}`, "metric-avg-resolve")}
            </div>
          )}
        </Panel>
        <Panel title={t("machineMetrics")} className="[&>div]:p-0">
          {!s.data || !ms.data || !issues.data ? <div className="p-4"><Sk className="h-40" /></div> : (
            <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-sm">
              <thead className="bg-secondary/50 text-[11px] uppercase tracking-wider text-muted-foreground"><tr>{[t("machine"), t("liveStatus"), t("fatigue"), t("downtime"), t("rejects"), t("openCol"), t("totalCol")].map((h) => <th key={h} className="px-3 py-2 text-start font-semibold">{h}</th>)}</tr></thead>
              <tbody>{m.perMachine.map((x) => (
                <tr key={x.id} className="border-t" data-testid={`row-machine-metric-${x.id}`}>
                  <td className="px-3 py-2"><div className="num text-xs font-semibold">{x.id.toUpperCase()}</div><div className="text-[11px] text-muted-foreground">{x.live?.name ?? x.fat?.name}</div></td>
                  <td className="px-3 py-2"><Pill tone={msTone[x.live?.status ?? "unknown"]}>{t(`ms_${x.live?.status ?? "unknown"}` as TKey)}</Pill></td>
                  <td className="num px-3 py-2">{x.fat ? `${nf(x.fat.fatigueScore, 1)}%` : "—"}</td>
                  <td className="num px-3 py-2">{x.fat ? nf(x.fat.downtimeMinutes) : "—"}</td>
                  <td className="num px-3 py-2">{x.fat ? nf(x.fat.rejects) : "—"}</td>
                  <td className="num px-3 py-2">{nf(x.open)}</td><td className="num px-3 py-2">{nf(x.total)}</td>
                </tr>))}</tbody>
            </table></div>
          )}
        </Panel>
      </div>
    </div>
  );
}
