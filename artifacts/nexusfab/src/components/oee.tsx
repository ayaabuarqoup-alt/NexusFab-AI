import { useMemo, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Info, RotateCcw, Save, Settings2, X } from "lucide-react";
import {
  useGetKpis, getGetKpisQueryKey, useListOeeSettings, getListOeeSettingsQueryKey, useSaveOeeSetting,
  useListLogs, getListLogsQueryKey, type OeeMachine, type OeeSetting, type OeeSettingMachineId,
} from "@workspace/api-client-react";
import { useI18n, errorMessage, type TKey } from "@/lib/i18n";
import { Empty, ErrorState, Panel, Pill, Plot, Sk, inputCls, ghostCls, btnCls, useProtected, MACHINE_IDS } from "@/components/common";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const NAVY = "#1E3A8A", AMBER = "#D97706", RED = "#B91C1C", SLATE = "#94A3B8", TEAL = "#0F766E";
const MAX_DAYS = 93;
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const span = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000) + 1;

const REASON: Record<OeeMachine["reason"], [string, string]> = {
  ready: ["Computed from timestamped status and logged units.", "محسوب من الحالات المؤرخة والوحدات المسجلة."],
  not_configured: ["Shift window or ideal cycle time not configured for this machine.", "لم تُضبط نافذة الوردية أو زمن الدورة المثالي لهذه الآلة."],
  no_planned_time: ["No planned shift time falls inside the selected range.", "لا يوجد وقت وردية مخطط ضمن النطاق المحدد."],
  incomplete_status: ["Part of the shift window has no recorded machine status, so OEE is not estimated.", "جزء من نافذة الوردية بلا حالة آلة مسجلة، لذلك لا يُقدّر OEE."],
  no_output: ["No units were logged inside the shift windows.", "لم تُسجل وحدات داخل نوافذ الوردية."],
  no_runtime: ["Machine never ran during the shift windows.", "لم تعمل الآلة خلال نوافذ الوردية."],
  invalid_cycle_rate: ["Logged output exceeds the ideal cycle rate (performance > 100%). Check the ideal cycle time or log entries.", "الإنتاج المسجل يتجاوز معدل الدورة المثالي (الأداء > 100%). راجع زمن الدورة أو السجلات."],
};

function useL() { const { lang } = useI18n(); return (en: string, ar: string) => (lang === "ar" ? ar : en); }

type Sel = { kind: "date"; v: string } | null;

export function KpiAnalytics({ canConfigure }: { canConfigure: boolean }) {
  const { t, nf, lang } = useI18n();
  const L = useL();
  const prot = useProtected();
  const max = today();
  const [from, setFrom] = useState(addDays(max, -6));
  const [to, setTo] = useState(max);
  const [machine, setMachine] = useState("");
  const [sel, setSel] = useState<Sel>(null);
  const [downView, setDownView] = useState<"machine" | "day">("machine");
  const [showCfg, setShowCfg] = useState(false);

  const rangeErr = !from || !to ? L("Choose both dates.", "اختر التاريخين.") : from > to ? L("Start must be on or before end.", "يجب أن تسبق البداية النهاية.")
    : to > max ? L("End date cannot be in the future.", "لا يمكن أن يكون تاريخ النهاية مستقبلياً.") : span(from, to) > MAX_DAYS ? L(`Range is limited to ${MAX_DAYS} days.`, `النطاق محدود بـ ${MAX_DAYS} يوماً.`) : "";
  const params = { from, to };
  const kpi = useGetKpis(params, { query: { queryKey: getGetKpisQueryKey(params), ...prot, enabled: prot.enabled && !rangeErr } });
  const settings = useListOeeSettings({ query: { queryKey: getListOeeSettingsQueryKey(), ...prot } });
  const logs = useListLogs({ query: { queryKey: getListLogsQueryKey(), ...prot } });

  const scopedLogs = useMemo(() => (logs.data ?? []).filter((l) => l.date >= from && l.date <= to && (!machine || l.machineId === machine) &&
    Date.parse(`${l.date}T${l.time}:00Z`) <= Date.parse(kpi.data?.asOf ?? new Date().toISOString())), [logs.data, from, to, machine, kpi.data?.asOf]);
  const dates = useMemo(() => { if (rangeErr) return []; const out: string[] = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; }, [from, to, rangeErr]);

  const daily = useMemo(() => {
    if (!machine) {
      const m = new Map((kpi.data?.daily ?? []).map((d) => [d.date, d]));
      return dates.map((d) => { const r = m.get(d); return { date: d, good: r?.goodQty ?? 0, rej: r?.rejects ?? 0, down: r?.reportedDowntimeMinutes ?? 0, pass: r ? r.passRate : null, fail: r ? r.failRate : null }; });
    }
    return dates.map((d) => {
      const ls = scopedLogs.filter((l) => l.date === d);
      const good = ls.reduce((a, l) => a + l.goodQty, 0), rej = ls.reduce((a, l) => a + l.rejects, 0);
      return { date: d, good, rej, down: ls.reduce((a, l) => a + l.downtimeMinutes, 0), pass: good + rej ? (good / (good + rej)) * 100 : null, fail: good + rej ? (rej / (good + rej)) * 100 : null };
    });
  }, [machine, kpi.data, dates, scopedLogs]);

  const qcDaily = useMemo(() => dates.map((d) => {
    const ls = scopedLogs.filter((l) => l.date === d);
    return { date: d, pending: ls.filter((l) => l.qcStatus === "pending").length, approved: ls.filter((l) => l.qcStatus === "approved").length, rejected: ls.filter((l) => l.qcStatus === "rejected").length };
  }), [dates, scopedLogs]);

  const tot = daily.reduce((a, d) => ({ good: a.good + d.good, rej: a.rej + d.rej, down: a.down + d.down }), { good: 0, rej: 0, down: 0 });
  const yieldPct = tot.good + tot.rej ? (tot.good / (tot.good + tot.rej)) * 100 : null;
  const machines = (kpi.data?.machines ?? []).filter((m) => !machine || m.machineId === machine);
  const selDate = sel?.v;
  const dim = (d: string, c: string) => (selDate && selDate !== d ? SLATE : c);
  const toggleDate = (d: string) => setSel((s) => (s?.v === d ? null : { kind: "date", v: d }));

  const unitsLbl = L("units", "وحدة"), minLbl = L("min", "د");
  const outData = useMemo(() => [
    { type: "bar" as const, x: daily.map((d) => d.date), y: daily.map((d) => d.good), name: L("Good units", "وحدات سليمة"), marker: { color: daily.map((d) => dim(d.date, NAVY)) }, hovertemplate: `%{x}<br>%{y} ${unitsLbl}<extra>${L("Good", "سليمة")}</extra>` },
    { type: "bar" as const, x: daily.map((d) => d.date), y: daily.map((d) => d.rej), name: L("Rejected units (scrap)", "وحدات مرفوضة (هالك)"), marker: { color: daily.map((d) => dim(d.date, AMBER)) }, hovertemplate: `%{x}<br>%{y} ${unitsLbl}<extra>${L("Rejects", "مرفوضة")}</extra>` },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [daily, selDate, lang]);
  const yieldData = useMemo(() => [
    { type: "scatter" as const, mode: "lines+markers" as const, connectgaps: false, x: daily.map((d) => d.date), y: daily.map((d) => d.pass), name: L("Pass (good / total units)", "نجاح (سليمة / الإجمالي)"), line: { color: TEAL, width: 2.5 }, hovertemplate: `%{x}<br>%{y:.1f}%<extra>${L("Pass", "نجاح")}</extra>` },
    { type: "scatter" as const, mode: "lines+markers" as const, connectgaps: false, x: daily.map((d) => d.date), y: daily.map((d) => d.fail), name: L("Fail (rejects / total units)", "فشل (مرفوضة / الإجمالي)"), line: { color: AMBER, width: 2, dash: "dot" as const }, hovertemplate: `%{x}<br>%{y:.1f}%<extra>${L("Fail", "فشل")}</extra>` },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [daily, lang]);
  const qcData = useMemo(() => [
    { type: "bar" as const, x: qcDaily.map((d) => d.date), y: qcDaily.map((d) => d.approved), name: t("qc_approved"), marker: { color: NAVY } },
    { type: "bar" as const, x: qcDaily.map((d) => d.date), y: qcDaily.map((d) => d.pending), name: t("qc_pending"), marker: { color: SLATE } },
    { type: "bar" as const, x: qcDaily.map((d) => d.date), y: qcDaily.map((d) => d.rejected), name: t("qc_rejected"), marker: { color: RED } },
  ], [qcDaily, t]);
  const downData = useMemo(() => downView === "machine" ? [
    { type: "bar" as const, x: machines.map((m) => m.machineId.toUpperCase()), y: machines.map((m) => m.stoppedMinutes), name: L("Stopped", "متوقفة"), marker: { color: RED }, hovertemplate: `%{x}: %{y} ${minLbl}<extra>${L("Stopped", "متوقفة")}</extra>` },
    { type: "bar" as const, x: machines.map((m) => m.machineId.toUpperCase()), y: machines.map((m) => m.maintenanceMinutes), name: L("Maintenance", "صيانة"), marker: { color: AMBER }, hovertemplate: `%{x}: %{y} ${minLbl}<extra>${L("Maintenance", "صيانة")}</extra>` },
    { type: "bar" as const, x: machines.map((m) => m.machineId.toUpperCase()), y: machines.map((m) => m.unknownMinutes), name: L("No status recorded", "بلا حالة مسجلة"), marker: { color: SLATE, pattern: { shape: "/" as const } }, hovertemplate: `%{x}: %{y} ${minLbl}<extra>${L("Unknown", "غير معروف")}</extra>` },
  ] : [
    { type: "bar" as const, x: daily.map((d) => d.date), y: daily.map((d) => d.down), name: L("Operator-reported downtime", "توقف أبلغ عنه المشغل"), marker: { color: daily.map((d) => dim(d.date, RED)) }, hovertemplate: `%{x}: %{y} ${minLbl}<extra></extra>` },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [downView, machines, daily, selDate, lang]);

  const stackLayout = useMemo(() => ({ barmode: "stack" as const, xaxis: { type: "category" as const }, yaxis: { gridcolor: "#E2E8F0", rangemode: "tozero" as const }, legend: { orientation: "h" as const, y: -0.25 } }), []);
  const pctLayout = useMemo(() => ({ xaxis: { type: "category" as const }, yaxis: { range: [0, 100] as [number, number], ticksuffix: "%", gridcolor: "#E2E8F0" }, legend: { orientation: "h" as const, y: -0.25 } }), []);

  const drill = selDate ? scopedLogs.filter((l) => l.date === selDate).sort((a, b) => b.time.localeCompare(a.time)) : [];
  const qcTone = { pending: "warn", approved: "ok", rejected: "bad" } as const;
  const reset = () => { setFrom(addDays(max, -6)); setTo(max); setMachine(""); setSel(null); };
  const loading = !rangeErr && (!kpi.data || !logs.data);
  const noOutput = !loading && tot.good + tot.rej === 0;

  return (
    <div className="space-y-4" data-testid="section-kpi-analytics">
      <section className="rise rounded-md border bg-card p-3 shadow-sm" data-testid="panel-kpi-filters">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto_auto] lg:items-end">
          <label className="flex flex-col gap-1"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t("fromDate")} (UTC)</span>
            <input type="date" lang={lang} className={`${inputCls} num`} value={from} min={addDays(max, -(MAX_DAYS - 1))} max={to || max} onChange={(e) => { setFrom(e.target.value); setSel(null); }} data-testid="input-kpi-from" /></label>
          <label className="flex flex-col gap-1"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t("toDate")} (UTC)</span>
            <input type="date" lang={lang} className={`${inputCls} num`} value={to} min={from || undefined} max={max} onChange={(e) => { setTo(e.target.value); setSel(null); }} data-testid="input-kpi-to" /></label>
          <label className="flex flex-col gap-1"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t("machineFilter")}</span>
            <select className={inputCls} value={machine} onChange={(e) => { setMachine(e.target.value); setSel(null); }} data-testid="select-kpi-machine">
              <option value="">{t("allMachines")}</option>{MACHINE_IDS.map((m) => <option key={m} value={m}>{m.toUpperCase()}</option>)}
            </select></label>
          <div className="flex gap-1">{[7, 30, 93].map((n) => (
            <button key={n} type="button" onClick={() => { setTo(max); setFrom(addDays(max, -(n - 1))); setSel(null); }} data-testid={`button-range-${n}`}
              className={cn("num h-9 rounded-md border px-2.5 text-xs font-medium transition", to === max && from === addDays(max, -(n - 1)) ? "border-primary bg-primary text-primary-foreground" : "hover:bg-secondary")}>{n}{L("d", "ي")}</button>))}</div>
          <button type="button" onClick={reset} className={`${ghostCls} h-9 justify-center`} data-testid="button-kpi-reset"><RotateCcw className="h-3.5 w-3.5" />{t("resetAll")}</button>
        </div>
        {rangeErr && <p className="mt-2 text-xs text-destructive" data-testid="text-kpi-range-error">{rangeErr}</p>}
        {machine && <p className="mt-2 flex items-start gap-1.5 text-[11px] text-muted-foreground"><Info className="mt-0.5 h-3 w-3 shrink-0" />{L("Daily charts for a single machine are derived from that machine's production logs.", "المخططات اليومية لآلة واحدة مشتقة من سجلات إنتاج تلك الآلة.")}</p>}
      </section>

      {kpi.isError ? <ErrorState error={kpi.error} onRetry={() => kpi.refetch()} /> : logs.isError ? <ErrorState error={logs.error} onRetry={() => logs.refetch()} /> : rangeErr ? null : loading ? (
        <div className="grid gap-4 lg:grid-cols-2"><Sk className="h-72" /><Sk className="h-72" /><Sk className="h-60" /><Sk className="h-60" /></div>
      ) : (<>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border bg-border md:grid-cols-4">
          {[[L("Good units", "وحدات سليمة"), nf(tot.good), "good"], [L("Rejected units", "وحدات مرفوضة"), nf(tot.rej), "rej"], [L("Unit pass yield", "عائد النجاح"), yieldPct === null ? "—" : `${nf(yieldPct, 1)}%`, "yield"], [L("Reported downtime", "التوقف المُبلغ"), `${nf(tot.down)} ${minLbl}`, "down"]].map(([l, v, id]) => (
            <div key={id} className="bg-card p-4"><div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{l}</div><div className="num mt-1 text-2xl font-semibold" data-testid={`kpi-range-${id}`}>{v}</div></div>
          ))}
        </div>
        {noOutput && <div className="rounded-md border border-dashed bg-secondary/30 px-4 py-3 text-xs text-muted-foreground" data-testid="text-kpi-no-output">{L("No production units were logged in this range. Charts show zero output, and yield is unavailable — not 0%.", "لم تُسجل وحدات إنتاج في هذا النطاق. تُظهر المخططات إنتاجاً صفرياً، والعائد غير متاح وليس 0%.")}</div>}

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title={L("Daily output (units)", "الإنتاج اليومي (وحدات)")}>
            <Plot data={outData} layout={stackLayout} height={260} testId="chart-kpi-output" onClick={(p) => toggleDate(String(p.x))} />
            <p className="mt-1 text-[11px] text-muted-foreground">{L("Click a day to drill into its logs.", "انقر على يوم لعرض سجلاته.")}</p>
          </Panel>
          <Panel title={L("Unit pass / fail yield", "عائد النجاح / الفشل للوحدات")}>
            <Plot data={yieldData} layout={pctLayout} height={260} testId="chart-kpi-yield" onClick={(p) => toggleDate(String(p.x))} />
            <p className="mt-1 text-[11px] text-muted-foreground">{L("Based on logged units: good ÷ (good + rejects). Gaps = no output that day.", "مبني على الوحدات المسجلة: السليمة ÷ (السليمة + المرفوضة). الفجوات = لا إنتاج.")}</p>
          </Panel>
          <Panel title={L("QC review status (log entries)", "حالة مراجعة الجودة (قيود السجل)")}>
            <Plot data={qcData} layout={stackLayout} height={240} testId="chart-kpi-qc" onClick={(p) => toggleDate(String(p.x))} />
            <p className="mt-1 text-[11px] text-muted-foreground">{L("Inspector decisions per log entry — separate from rejected units counted on the line.", "قرارات المفتش لكل قيد — منفصلة عن الوحدات المرفوضة على الخط.")}</p>
          </Panel>
          <Panel title={L("Machine downtime", "توقف الآلات")} right={
            <div className="flex overflow-hidden rounded-md border text-[11px]">{(["machine", "day"] as const).map((v) => (
              <button key={v} type="button" onClick={() => setDownView(v)} aria-pressed={downView === v} data-testid={`button-down-${v}`} className={cn("px-2 py-1 transition", downView === v ? "bg-primary text-primary-foreground" : "hover:bg-secondary")}>{v === "machine" ? L("Status windows", "نوافذ الحالة") : L("Reported / day", "المُبلغ يومياً")}</button>))}</div>}>
            {downView === "machine" && machines.every((m) => m.plannedMinutes === 0) ? <Empty title={L("No configured shift time", "لا يوجد وقت وردية مضبوط")} sub={L("Status-window downtime needs configured shifts.", "يتطلب توقف نوافذ الحالة ورديات مضبوطة.")} />
              : <Plot data={downData} layout={stackLayout} height={240} testId="chart-kpi-downtime" onClick={(p) => downView === "machine" ? (setMachine(String(p.x).toLowerCase()), setSel(null)) : toggleDate(String(p.x))} />}
            <p className="mt-1 text-[11px] text-muted-foreground">{downView === "machine" ? L("Minutes inside configured shift windows. Click a machine to filter.", "دقائق داخل نوافذ الوردية المضبوطة. انقر آلة للتصفية.") : L("Downtime minutes typed by operators in production logs.", "دقائق التوقف التي أدخلها المشغلون في السجلات.")}</p>
          </Panel>
        </div>

        {selDate && <Panel title={`${L("Drilldown", "تفصيل")} · ${selDate}${machine ? ` · ${machine.toUpperCase()}` : ""}`} right={<button type="button" onClick={() => setSel(null)} className={ghostCls} data-testid="button-clear-kpi-sel"><X className="h-3 w-3" />{t("clearPin")}</button>} className="[&>div]:p-0">
          {drill.length === 0 ? <div className="p-4"><Empty title={t("noMatch")} sub={L("No logs on this day.", "لا سجلات في هذا اليوم.")} /></div> : (
            <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-sm" data-testid="table-kpi-drill"><tbody className="divide-y">{drill.map((l) => (
              <tr key={l.id} data-testid={`row-kpi-drill-${l.id}`}><td className="num px-4 py-2 text-xs">{l.time}</td><td className="num px-3 py-2 text-xs">{l.machineId.toUpperCase()}</td><td className="px-3 py-2">{l.staff}</td>
                <td className="num px-3 py-2">{nf(l.goodQty)} / <span className={l.rejects ? "text-[hsl(var(--warn))]" : ""}>{nf(l.rejects)}</span></td><td className="num px-3 py-2 text-xs">{nf(l.downtimeMinutes)} {minLbl}</td>
                <td className="px-3 py-2"><Pill tone={qcTone[l.qcStatus]}>{t(`qc_${l.qcStatus}` as TKey)}</Pill></td></tr>))}</tbody></table></div>)}
        </Panel>}

        <OeePanel machines={machines} settings={settings.data} asOf={kpi.data?.asOf} canConfigure={canConfigure} onConfigure={() => setShowCfg((s) => !s)} cfgOpen={showCfg} />
      </>)}
      {canConfigure && showCfg && <OeeSettingsForm settings={settings.data} loading={!settings.data && !settings.isError} error={settings.isError ? settings.error : null} onRetry={() => settings.refetch()} />}
      {!canConfigure && settings.data && <SettingsReadout settings={settings.data} />}
    </div>
  );
}

function pct(v: number | null, nf: (n: number, d?: number) => string) { return v === null ? "—" : `${nf(v, 1)}%`; }

function OeePanel({ machines, settings, asOf, canConfigure, onConfigure, cfgOpen }: { machines: OeeMachine[]; settings?: OeeSetting[]; asOf?: string; canConfigure: boolean; onConfigure: () => void; cfgOpen: boolean }) {
  const { nf } = useI18n();
  const L = useL();
  return (
    <section className="rise overflow-hidden rounded-md bg-sidebar text-sidebar-foreground shadow-md" data-testid="panel-oee">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-sidebar-border p-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[hsl(32_95%_60%)]">OEE · {L("Availability × Performance × Quality", "التوافر × الأداء × الجودة")}</div>
          <p className="mt-1 max-w-2xl text-xs text-sidebar-foreground/70">{L("Current shift settings are applied to every day of the selected range. Unknown status time is never filled in — if coverage is incomplete, OEE is shown as unavailable with the reason.", "تُطبق إعدادات الوردية الحالية على كل أيام النطاق المحدد. لا يُملأ وقت الحالة المجهول أبداً — إن كانت التغطية ناقصة يظهر OEE غير متاح مع السبب.")}{asOf && <span className="num"> · {L("as of", "حتى")} {new Date(asOf).toISOString().slice(0, 16).replace("T", " ")} UTC</span>}</p>
        </div>
        {canConfigure && <button type="button" onClick={onConfigure} aria-expanded={cfgOpen} className="inline-flex items-center gap-1.5 rounded-md bg-sidebar-accent px-3 py-1.5 text-xs font-medium text-white transition hover:brightness-125" data-testid="button-oee-configure"><Settings2 className="h-3.5 w-3.5" />{cfgOpen ? L("Hide settings", "إخفاء الإعدادات") : L("Shift & cycle settings", "إعدادات الوردية والدورة")}</button>}
      </div>
      {machines.length === 0 ? <div className="p-6 text-sm text-sidebar-foreground/70">{L("No machine data for this range.", "لا بيانات آلات لهذا النطاق.")}</div> : (
        <div className="grid gap-px bg-sidebar-border md:grid-cols-3">
          {machines.map((m) => {
            const s = settings?.find((x) => x.machineId === m.machineId);
            const cov = m.plannedMinutes || 1;
            return (
              <div key={m.machineId} className="bg-sidebar p-4" data-testid={`card-oee-${m.machineId}`}>
                <div className="flex items-center justify-between"><span className="num text-sm font-semibold text-white">{m.machineId.toUpperCase()}</span>
                  <span className="num text-[10px] text-sidebar-foreground/55">{s ? `${s.shiftStart}–${s.shiftEnd} UTC · ${nf(s.idealCycleSeconds)}s` : L("not configured", "غير مضبوط")}</span></div>
                {m.oee !== null ? <div className="num mt-2 text-4xl font-semibold tracking-tight text-white" data-testid={`text-oee-${m.machineId}`}>{nf(m.oee, 1)}<span className="text-xl text-sidebar-foreground/60">%</span></div>
                  : <div className="mt-2" data-testid={`text-oee-${m.machineId}`}><div className="text-lg font-semibold text-[hsl(32_95%_60%)]">{L("OEE unavailable", "OEE غير متاح")}</div><p className="mt-1 text-xs text-sidebar-foreground/70" data-testid={`text-oee-reason-${m.machineId}`}>{L(...REASON[m.reason])}</p></div>}
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  {([[L("Avail.", "التوافر"), m.availability], [L("Perf.", "الأداء"), m.performance], [L("Quality", "الجودة"), m.quality]] as const).map(([l, v]) => (
                    <div key={l} className="rounded-sm bg-white/5 px-1 py-1.5"><div className="text-[9px] uppercase tracking-wider text-sidebar-foreground/55">{l}</div><div className="num text-sm font-semibold text-white">{pct(v, nf)}</div></div>))}
                </div>
                <div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-white/10" title={L("Status coverage of planned time", "تغطية الحالة للوقت المخطط")}>
                  {[[m.runningMinutes, "bg-[hsl(var(--ok))]"], [m.stoppedMinutes, "bg-destructive"], [m.maintenanceMinutes, "bg-[hsl(32_95%_52%)]"], [m.unknownMinutes, "bg-white/25"]].map(([v, c], i) => <div key={i} className={c as string} style={{ width: `${((v as number) / cov) * 100}%` }} />)}
                </div>
                <div className="num mt-1.5 text-[10px] text-sidebar-foreground/55">{L("planned", "مخطط")} {nf(m.plannedMinutes)} · {L("run", "تشغيل")} {nf(m.runningMinutes)} · {L("unknown", "مجهول")} {nf(m.unknownMinutes)} {L("min", "د")} · {nf(m.goodQty)}/{nf(m.rejects)}</div>
              </div>
            );
          })}
        </div>)}
    </section>
  );
}

function SettingsReadout({ settings }: { settings: OeeSetting[] }) {
  const L = useL();
  const { nf } = useI18n();
  return (
    <p className="text-[11px] text-muted-foreground" data-testid="text-oee-settings-readonly">{L("Shift settings (read-only, set by Admin): ", "إعدادات الوردية (للقراءة فقط، يضبطها المسؤول): ")}
      {MACHINE_IDS.map((id) => { const s = settings.find((x) => x.machineId === id); return <span key={id} className="num me-3">{id.toUpperCase()} {s ? `${s.shiftStart}–${s.shiftEnd} UTC · ${nf(s.idealCycleSeconds)}s` : L("not configured", "غير مضبوط")}</span>; })}</p>
  );
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
function SettingRow({ id, s }: { id: OeeSettingMachineId; s?: OeeSetting }) {
  const { t } = useI18n();
  const L = useL();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [f, setF] = useState({ start: s?.shiftStart ?? "", end: s?.shiftEnd ?? "", cycle: s ? String(s.idealCycleSeconds) : "" });
  const [err, setErr] = useState("");
  const save = useSaveOeeSetting({ mutation: { onSuccess: () => {
    qc.invalidateQueries({ queryKey: getListOeeSettingsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetKpisQueryKey() });
    toast({ title: L(`${id.toUpperCase()} settings saved`, `حُفظت إعدادات ${id.toUpperCase()}`) });
  } } });
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr("");
    if (!HHMM.test(f.start) || !HHMM.test(f.end)) return setErr(L("Use HH:MM (UTC).", "استخدم HH:MM (UTC)."));
    if (f.end <= f.start) return setErr(L("End must be after start on the same day.", "يجب أن تكون النهاية بعد البداية في اليوم نفسه."));
    const c = Number(f.cycle);
    if (!Number.isFinite(c) || c <= 0 || c > 86400) return setErr(L("Ideal cycle must be > 0 and ≤ 86400 seconds.", "زمن الدورة يجب أن يكون > 0 و ≤ 86400 ثانية."));
    save.mutate({ data: { machineId: id, shiftStart: f.start, shiftEnd: f.end, idealCycleSeconds: c } });
  };
  return (
    <form onSubmit={submit} className="grid gap-2 border-b px-4 py-3 last:border-0 sm:grid-cols-[60px_1fr_1fr_1fr_auto] sm:items-end" data-testid={`form-oee-${id}`}>
      <div className="num pb-2 text-sm font-semibold">{id.toUpperCase()}{!s && <span className="block text-[10px] font-normal text-[hsl(var(--warn))]">{L("unset", "غير مضبوط")}</span>}</div>
      <label className="flex flex-col gap-1"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{L("Shift start (UTC)", "بداية الوردية (UTC)")}</span><input type="time" dir="ltr" className={`${inputCls} num`} value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} data-testid={`input-oee-start-${id}`} /></label>
      <label className="flex flex-col gap-1"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{L("Shift end (UTC)", "نهاية الوردية (UTC)")}</span><input type="time" dir="ltr" className={`${inputCls} num`} value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} data-testid={`input-oee-end-${id}`} /></label>
      <label className="flex flex-col gap-1"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{L("Ideal cycle (s/unit)", "الدورة المثالية (ث/وحدة)")}</span><input type="number" inputMode="decimal" step="any" min="0" dir="ltr" className={`${inputCls} num`} value={f.cycle} onChange={(e) => setF({ ...f, cycle: e.target.value })} data-testid={`input-oee-cycle-${id}`} /></label>
      <button disabled={save.isPending} className={btnCls} data-testid={`button-save-oee-${id}`}><Save className="h-3.5 w-3.5" />{save.isPending ? t("saving") : t("save")}</button>
      {(err || save.isError) && <p className="text-xs text-destructive sm:col-span-5" data-testid={`text-oee-error-${id}`}>{err || errorMessage(save.error, t)}</p>}
    </form>
  );
}

function OeeSettingsForm({ settings, loading, error, onRetry }: { settings?: OeeSetting[]; loading: boolean; error: unknown; onRetry: () => void }) {
  const L = useL();
  return (
    <Panel title={L("OEE shift & cycle settings", "إعدادات الوردية والدورة لـ OEE")} className="[&>div]:p-0">
      <p className="px-4 pt-3 text-xs text-muted-foreground">{L("One same-day window per machine, in UTC. Saving recalculates analytics for the whole selected range using these values. Blank fields mean not configured — nothing is assumed.", "نافذة واحدة في اليوم نفسه لكل آلة بتوقيت UTC. الحفظ يعيد حساب التحليلات لكامل النطاق بهذه القيم. الحقول الفارغة تعني غير مضبوط — لا يُفترض شيء.")}</p>
      {error ? <div className="p-4"><ErrorState error={error} onRetry={onRetry} /></div> : loading ? <div className="p-4"><Sk className="h-32" /></div>
        : <div className="mt-2">{MACHINE_IDS.map((id) => { const s = settings?.find((x) => x.machineId === id); return <SettingRow key={`${id}-${s?.shiftStart}-${s?.shiftEnd}-${s?.idealCycleSeconds}`} id={id} s={s} />; })}</div>}
    </Panel>
  );
}
