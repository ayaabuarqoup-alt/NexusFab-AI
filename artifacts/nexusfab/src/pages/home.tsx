import type { ReactNode } from "react";
import { Link } from "wouter";
import { ArrowUpRight, BarChart3, Bell, CalendarPlus, CalendarRange, ClipboardCheck, Gauge, History, LineChart, Users } from "lucide-react";
import {
  useGetSummary, getGetSummaryQueryKey, useListJobs, getListJobsQueryKey, useListLogs, getListLogsQueryKey,
  useListIssues, getListIssuesQueryKey, useListAudit, getListAuditQueryKey, type Issue,
} from "@workspace/api-client-react";
import { useI18n, type TKey } from "@/lib/i18n";
import { Empty, ErrorState, PageHeader, Panel, Pill, Sk, sevTone, useFmt, useProtected, useRole } from "@/components/common";
import { MachineStateCard, useMachineStates } from "@/components/machine-status";
import { FlagIssueButton } from "@/components/issue-form";
import { EditJobButton, ShippingControl } from "@/components/job-edit";
import { useNotifications } from "@/components/alerts";
import { qcTone } from "@/pages/production";
import { cn } from "@/lib/utils";
import { usePlans, usePlanningOperators, Timeline, psTone, useFmtUtc } from "@/pages/planning";

export function useIssues() {
  return useListIssues({ query: { queryKey: getListIssuesQueryKey(), ...useProtected() } });
}

function Kpi({ label, value, tone, href, testId }: { label: string; value?: number; tone?: "bad" | "warn" | "ok"; href?: string; testId: string }) {
  const { nf } = useI18n();
  const body = (
    <div className="rise group h-full rounded-md border bg-card p-4 shadow-sm transition hover:border-primary/40">
      <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}{href && <ArrowUpRight className="h-3.5 w-3.5 opacity-0 transition group-hover:opacity-100 rtl:-scale-x-100" />}</div>
      {value === undefined ? <Sk className="mt-2 h-8 w-16" /> : (
        <div className={cn("num mt-1 text-3xl font-semibold", tone === "bad" && value > 0 && "text-destructive", tone === "warn" && value > 0 && "text-[hsl(var(--warn))]", tone === "ok" && "text-[hsl(var(--ok))]")} data-testid={testId}>{nf(value)}</div>
      )}
    </div>
  );
  return href ? <Link href={href} className="block" data-testid={`link-${testId}`}>{body}</Link> : body;
}

function IssueList({ issues, limit = 6 }: { issues?: Issue[]; limit?: number }) {
  const { t } = useI18n();
  const fmt = useFmt();
  if (!issues) return <div className="space-y-2">{[0, 1, 2].map((i) => <Sk key={i} className="h-12" />)}</div>;
  const open = issues.filter((i) => i.status === "open");
  if (!open.length) return <Empty title={t("noOpenIssues")} sub={t("noOpenIssuesSub")} />;
  return (
    <ul className="-m-4 divide-y">
      {open.slice(0, limit).map((i) => (
        <li key={i.id}><Link href={`/issues#${i.id}`} className="flex items-start gap-3 px-4 py-3 transition hover:bg-secondary/40" data-testid={`link-issue-${i.id}`}>
          <Pill tone={sevTone[i.severity]}>{t(`sev_${i.severity}` as TKey)}</Pill>
          <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{i.title}</div><div className="num text-[11px] text-muted-foreground">{i.machineId.toUpperCase()} · {i.createdByName} · {fmt(i.createdAt)}</div></div>
        </Link></li>
      ))}
    </ul>
  );
}

function LiveMachines({ editable }: { editable: boolean }) {
  const { t } = useI18n();
  const ms = useMachineStates();
  return (
    <Panel title={t("liveMachines")} right={<Link href="/machines" className="text-[11px] font-medium text-primary" data-testid="link-machines-all">{t("viewAll")}</Link>}>
      {ms.isError ? <ErrorState error={ms.error} onRetry={() => ms.refetch()} /> : !ms.data ? <div className="grid gap-3 md:grid-cols-3">{[0, 1, 2].map((i) => <Sk key={i} className="h-28" />)}</div>
        : <div className={cn("grid gap-3", editable ? "md:grid-cols-2 xl:grid-cols-3" : "sm:grid-cols-3")}>{ms.data.map((m) => <MachineStateCard key={`${m.id}-${m.updatedAt}`} m={m} editable={editable} />)}</div>}
    </Panel>
  );
}

function Grid({ children }: { children: ReactNode }) { return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>; }

function AdminHome() {
  const { t } = useI18n();
  const fmt = useFmt();
  const prot = useProtected();
  const s = useGetSummary({ query: { queryKey: getGetSummaryQueryKey(), ...prot } });
  const issues = useIssues();
  const ms = useMachineStates();
  const audit = useListAudit({ query: { queryKey: getListAuditQueryKey(), ...prot } });
  const notif = useNotifications();
  const open = issues.data?.filter((i) => i.status === "open");
  const links = [
    { href: "/reports", k: "ql_reports", d: "ql_reports_d", I: BarChart3 },
    { href: "/account", k: "ql_staff", d: "ql_staff_d", I: Users },
    { href: "/audit", k: "ql_audit", d: "ql_audit_d", I: History },
    { href: "/notifications", k: "ql_alerts", d: "ql_alerts_d", I: Bell },
  ] as const;
  return (
    <div className="space-y-6">
      <PageHeader title={t("homeAdminTitle")} sub={t("homeAdminSub")} />
      <Grid>
        <Kpi label={t("kpiOpenIssues")} value={open?.length} tone="warn" href="/issues" testId="kpi-open-issues" />
        <Kpi label={t("kpiCritical")} value={open?.filter((i) => i.severity === "critical").length} tone="bad" href="/issues" testId="kpi-critical" />
        <Kpi label={t("kpiStopped")} value={ms.data?.filter((m) => m.status === "stopped" || m.status === "maintenance").length} tone="bad" href="/machines" testId="kpi-stopped" />
        <Kpi label={t("kpiUnread")} value={notif.data?.filter((n) => !n.read).length} tone="warn" href="/notifications" testId="kpi-unread" />
      </Grid>
      <section className="rise">
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t("quickLinks")}</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {links.map(({ href, k, d, I }) => (
            <Link key={href} href={href} className="group flex items-start gap-3 rounded-md border bg-sidebar p-4 text-sidebar-foreground transition hover:brightness-125" data-testid={`link-quick-${k}`}>
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-sidebar-accent text-[hsl(32_95%_60%)]"><I className="h-4 w-4" /></span>
              <span className="min-w-0"><span className="flex items-center gap-1 text-sm font-semibold text-white">{t(k)}<ArrowUpRight className="h-3.5 w-3.5 opacity-50 rtl:-scale-x-100" /></span><span className="mt-0.5 block text-xs text-sidebar-foreground/65">{t(d)}</span></span>
            </Link>
          ))}
        </div>
      </section>
      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Panel title={t("recentAudit")} right={<Link href="/audit" className="text-[11px] font-medium text-primary" data-testid="link-audit-all">{t("viewAll")}</Link>}>
          {audit.isError ? <ErrorState error={audit.error} onRetry={() => audit.refetch()} /> : !audit.data ? <div className="space-y-2">{[0, 1, 2].map((i) => <Sk key={i} className="h-10" />)}</div>
            : audit.data.length === 0 ? <Empty title={t("noAudit")} sub={t("noAuditSub")} /> : (
              <ol className="-m-4 divide-y">{audit.data.slice(0, 7).map((e) => (
                <li key={e.id} className="grid gap-0.5 px-4 py-2.5 sm:grid-cols-[150px_1fr]" data-testid={`row-home-audit-${e.id}`}>
                  <span className="num text-[11px] text-muted-foreground">{fmt(e.at)}</span>
                  <span className="min-w-0 truncate text-sm"><span className="font-medium">{e.actorName || e.actorId}</span> <span className="text-muted-foreground">· {e.action}</span></span>
                </li>))}</ol>
            )}
        </Panel>
        <Panel title={t("openIssuesList")} right={<Link href="/issues" className="text-[11px] font-medium text-primary" data-testid="link-issues-all">{t("viewAll")}</Link>}>
          {issues.isError ? <ErrorState error={issues.error} onRetry={() => issues.refetch()} /> : <IssueList issues={issues.data} />}
        </Panel>
      </div>
      <Grid>
        <Kpi label={t("kpiActiveJobs")} value={s.data?.activeJobs} href="/jobs" testId="kpi-active-jobs" />
        <Kpi label={t("kpiPendingQc")} value={s.data?.pendingQuality} tone="warn" href="/quality" testId="kpi-pending-qc" />
        <Kpi label={t("goodQty")} value={s.data?.goodQty} tone="ok" href="/reports" testId="kpi-good" />
        <Kpi label={t("rejects")} value={s.data?.rejects} tone="bad" href="/reports" testId="kpi-rejects" />
      </Grid>
      <LiveMachines editable={false} />
    </div>
  );
}

function InspectorHome() {
  const { t, nf } = useI18n();
  const prot = useProtected();
  const logs = useListLogs({ query: { queryKey: getListLogsQueryKey(), ...prot } });
  const issues = useIssues();
  const notif = useNotifications();
  const pending = logs.data?.filter((l) => l.qcStatus === "pending");
  const recent = [...(logs.data ?? [])].sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time)).slice(0, 10);
  const open = issues.data?.filter((i) => i.status === "open");
  return (
    <div className="space-y-6">
      <PageHeader title={t("homeInspTitle")} sub={t("homeInspSub")} action={<FlagIssueButton testId="button-flag-home" />} />
      <Grid>
        <Kpi label={t("kpiPendingQc")} value={pending?.length} tone="warn" href="/quality" testId="kpi-pending-qc" />
        <Kpi label={t("kpiOpenIssues")} value={open?.length} tone="warn" href="/issues" testId="kpi-open-issues" />
        <Kpi label={t("kpiCritical")} value={open?.filter((i) => i.severity === "critical").length} tone="bad" href="/issues" testId="kpi-critical" />
        <Kpi label={t("kpiUnread")} value={notif.data?.filter((n) => !n.read).length} href="/notifications" testId="kpi-unread" />
      </Grid>
      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <Panel title={t("reviewQueue")} right={<Link href="/quality" className="text-[11px] font-medium text-primary" data-testid="link-quality-all">{t("viewAll")}</Link>}>
          {logs.isError ? <ErrorState error={logs.error} onRetry={() => logs.refetch()} /> : !pending ? <div className="space-y-2">{[0, 1, 2].map((i) => <Sk key={i} className="h-12" />)}</div>
            : pending.length === 0 ? <Empty title={t("noPending")} sub={t("noPendingSub")} /> : (
              <ul className="-m-4 divide-y">{pending.slice(0, 8).map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid={`row-queue-${l.id}`}>
                  <div className="min-w-0 flex-1"><div className="text-sm font-medium">{l.staff}</div><div className="num text-[11px] text-muted-foreground">{l.machineId.toUpperCase()} · {l.date} {l.time} · {nf(l.goodQty)} / {nf(l.rejects)}</div></div>
                  <FlagIssueButton seed={{ logId: l.id, jobId: l.jobId, machineId: l.machineId }} testId={`button-flag-queue-${l.id}`} />
                  <Link href="/quality" className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground" data-testid={`link-review-${l.id}`}><ClipboardCheck className="h-3.5 w-3.5" />{t("review")}</Link>
                </li>))}</ul>
            )}
        </Panel>
        <Panel title={t("openIssuesList")} right={<Link href="/issues" className="text-[11px] font-medium text-primary" data-testid="link-issues-all">{t("viewAll")}</Link>}>
          {issues.isError ? <ErrorState error={issues.error} onRetry={() => issues.refetch()} /> : <IssueList issues={issues.data} />}
        </Panel>
      </div>
      <Panel title={t("operatorLogs")} right={<Link href="/production" className="text-[11px] font-medium text-primary" data-testid="link-logs-all">{t("viewAll")}</Link>} className="[&>div]:p-0">
        {!logs.data ? <div className="space-y-2 p-4"><Sk className="h-10" /><Sk className="h-10" /></div> : recent.length === 0 ? <div className="p-4"><Empty title={t("noLogs")} sub={t("noLogsSub")} /></div> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm"><tbody>
            {recent.map((l) => (
              <tr key={l.id} className="border-t first:border-0" data-testid={`row-oplog-${l.id}`}>
                <td className="num whitespace-nowrap px-4 py-2 text-xs">{l.date} {l.time}</td><td className="px-3 py-2">{l.staff}</td>
                <td className="num px-3 py-2 text-xs">{l.machineId.toUpperCase()}</td><td className="num px-3 py-2">{nf(l.goodQty)} / {nf(l.rejects)}</td>
                <td className="max-w-[200px] truncate px-3 py-2 text-xs text-muted-foreground">{l.reason || "—"}</td>
                <td className="px-3 py-2"><Pill tone={qcTone[l.qcStatus]}>{t(`qc_${l.qcStatus}` as TKey)}</Pill></td>
              </tr>))}
          </tbody></table></div>
        )}
      </Panel>
    </div>
  );
}

function OperatorHome() {
  const { t, nf } = useI18n();
  const prot = useProtected();
  const jobs = useListJobs({ query: { queryKey: getListJobsQueryKey(), ...prot } });
  const logs = useListLogs({ query: { queryKey: getListLogsQueryKey(), ...prot } });
  const issues = useIssues();
  const ms = useMachineStates();
  const open = (jobs.data ?? []).filter((j) => j.status !== "dispatched").sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const pendingFor = (id: string) => (logs.data ?? []).filter((l) => l.jobId === id && l.qcStatus !== "approved").length;
  return (
    <div className="space-y-6">
      <PageHeader title={t("homeOpTitle")} sub={t("homeOpSub")} action={<FlagIssueButton testId="button-flag-home">{t("reportProblem")}</FlagIssueButton>} />
      <Grid>
        <Kpi label={t("openOrders")} value={jobs.data ? open.length : undefined} href="/jobs" testId="kpi-open-orders" />
        <Kpi label={t("kpiReadyShip")} value={jobs.data?.filter((j) => j.shippingStatus === "ready").length} tone="ok" href="/jobs" testId="kpi-ready" />
        <Kpi label={t("kpiStopped")} value={ms.data?.filter((m) => m.status === "stopped" || m.status === "maintenance").length} tone="bad" href="/machines" testId="kpi-stopped" />
        <Kpi label={t("kpiOpenIssues")} value={issues.data?.filter((i) => i.status === "open").length} tone="warn" href="/issues" testId="kpi-open-issues" />
      </Grid>
      <Panel title={t("myOrders")} right={<Link href="/production" className="text-[11px] font-medium text-primary" data-testid="link-log-production">{t("nav_production")}</Link>} className="[&>div]:p-0">
        {jobs.isError ? <div className="p-4"><ErrorState error={jobs.error} onRetry={() => jobs.refetch()} /></div> : !jobs.data ? <div className="space-y-2 p-4"><Sk className="h-14" /><Sk className="h-14" /></div>
          : open.length === 0 ? <div className="p-4"><Empty title={t("noJobs")} sub={t("noJobsSub")} /></div>
          : open.slice(0, 8).map((j) => {
            const pct = Math.min(100, (j.goodQty / j.target) * 100);
            return (
              <div key={j.id} className="grid gap-3 border-b px-4 py-3 last:border-0 md:grid-cols-[1.4fr_1fr_auto] md:items-center" data-testid={`row-today-job-${j.id}`}>
                <div className="min-w-0"><div className="truncate font-medium">{j.name}</div><div className="num text-[11px] text-muted-foreground">{j.machineId.toUpperCase()} · {t("due")} {j.dueDate}</div>
                  <div className="mt-1.5 flex items-center gap-2"><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary"><div className="h-full origin-left bg-primary rtl:origin-right" style={{ transform: `scaleX(${pct / 100})` }} /></div><span className="num text-[11px]">{nf(j.goodQty)}/{nf(j.target)}</span></div>
                </div>
                <ShippingControl job={j} pendingQc={pendingFor(j.id)} />
                <div className="flex flex-wrap gap-1.5 md:justify-end"><EditJobButton job={j} hasLogs={(logs.data ?? []).some((l) => l.jobId === j.id)} /><FlagIssueButton seed={{ jobId: j.id, machineId: j.machineId }} testId={`button-flag-today-${j.id}`} /></div>
              </div>
            );
          })}
      </Panel>
      <MyAssignments />
      <LiveMachines editable />
    </div>
  );
}

function MyAssignments() {
  const { t } = useI18n();
  const fmt = useFmtUtc();
  const { session } = useRole();
  const plans = usePlans();
  const jobs = useListJobs({ query: { queryKey: getListJobsQueryKey(), ...useProtected() } });
  const me = session?.userId ?? "";
  const mine = (plans.data ?? []).filter((p) => p.status === "scheduled").flatMap((p) => p.assignments.filter((a) => a.operatorId === me).map((a) => ({ ...a, plan: p.name, pid: p.id })))
    .filter((a) => a.endAt >= new Date(Date.now() - 86_400_000).toISOString()).sort((a, b) => a.startAt.localeCompare(b.startAt));
  return (
    <Panel title={t("myAssignments")} right={<Link href="/schedule" className="text-[11px] font-medium text-primary" data-testid="link-schedule">{t("viewSchedule")}</Link>} className="[&>div]:p-0">
      {plans.isError ? <div className="p-4"><ErrorState error={plans.error} onRetry={() => plans.refetch()} /></div> : !plans.data ? <div className="space-y-2 p-4"><Sk className="h-12" /></div>
        : mine.length === 0 ? <div className="p-4"><Empty title={t("noMyAssignments")} sub={t("noMyAssignmentsSub")} /></div>
        : <ul className="divide-y">{mine.slice(0, 8).map((a, i) => (
          <li key={`${a.pid}-${i}`} className="grid gap-1 px-4 py-2.5 sm:grid-cols-[1.4fr_60px_1.6fr] sm:items-center" data-testid={`row-my-assignment-${a.pid}-${i}`}>
            <span className="min-w-0"><span className="block truncate text-sm font-medium">{jobs.data?.find((j) => j.id === a.jobId)?.name ?? a.jobId}</span><span className="block truncate text-[11px] text-muted-foreground">{a.plan}</span></span>
            <span className="num text-xs font-semibold">{a.machineId.toUpperCase()}</span>
            <span className="num text-[11px] text-muted-foreground">{fmt(a.startAt)} → {fmt(a.endAt)}</span>
          </li>))}</ul>}
    </Panel>
  );
}

function PlannerHome() {
  const { t, nf } = useI18n();
  const prot = useProtected();
  const plans = usePlans();
  const ops = usePlanningOperators(true);
  const jobs = useListJobs({ query: { queryKey: getListJobsQueryKey(), ...prot } });
  const issues = useIssues();
  const ms = useMachineStates();
  const notif = useNotifications();
  const today = new Date().toISOString().slice(0, 10);
  const planned = new Set((plans.data ?? []).filter((p) => p.status !== "completed").flatMap((p) => p.assignments.map((a) => a.jobId)));
  const openJobs = (jobs.data ?? []).filter((j) => j.status !== "dispatched");
  const unplanned = openJobs.filter((j) => !planned.has(j.id)).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const upcoming = (plans.data ?? []).filter((p) => p.status !== "completed" && p.endDate >= today).sort((a, b) => a.startDate.localeCompare(b.startDate));
  const links = [
    { href: "/planning#new", k: "qlp_new", d: "qlp_new_d", I: CalendarPlus },
    { href: "/planning", k: "qlp_schedule", d: "qlp_schedule_d", I: CalendarRange },
    { href: "/machines", k: "qlp_resources", d: "qlp_resources_d", I: Gauge },
    { href: "/planning-analytics", k: "qlp_analytics", d: "qlp_analytics_d", I: LineChart },
  ] as const;
  return (
    <div className="space-y-6">
      <PageHeader title={t("homePlanTitle")} sub={t("homePlanSub")} />
      <Grid>
        <Kpi label={t("kpiScheduled")} value={plans.data?.filter((p) => p.status === "scheduled").length} href="/planning" testId="kpi-scheduled" />
        <Kpi label={t("kpiDrafts")} value={plans.data?.filter((p) => p.status === "draft").length} tone="warn" href="/planning" testId="kpi-drafts" />
        <Kpi label={t("kpiUnplanned")} value={jobs.data && plans.data ? unplanned.length : undefined} tone="warn" href="/jobs" testId="kpi-unplanned" />
        <Kpi label={t("kpiUnread")} value={notif.data?.filter((n) => !n.read).length} tone="warn" href="/notifications" testId="kpi-unread" />
      </Grid>
      <section className="rise">
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t("quickLinks")}</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {links.map(({ href, k, d, I }) => (
            <Link key={k} href={href} className="group flex items-start gap-3 rounded-md border bg-sidebar p-4 text-sidebar-foreground transition hover:brightness-125" data-testid={`link-quick-${k}`}>
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-sidebar-accent text-[hsl(32_95%_60%)]"><I className="h-4 w-4" /></span>
              <span className="min-w-0"><span className="flex items-center gap-1 text-sm font-semibold text-white">{t(k)}<ArrowUpRight className="h-3.5 w-3.5 opacity-50 rtl:-scale-x-100" /></span><span className="mt-0.5 block text-xs text-sidebar-foreground/65">{t(d)}</span></span>
            </Link>
          ))}
        </div>
      </section>
      <Panel title={t("upcomingPlans")} right={<Link href="/planning" className="text-[11px] font-medium text-primary" data-testid="link-plans-all">{t("viewAll")}</Link>}>
        {plans.isError ? <ErrorState error={plans.error} onRetry={() => plans.refetch()} /> : !plans.data ? <Sk className="h-40" />
          : upcoming.length === 0 ? <Empty title={t("noPlans")} sub={t("noPlansSub")} />
          : <div className="space-y-5">{upcoming.slice(0, 2).map((p) => (
            <div key={p.id} className="space-y-2" data-testid={`home-plan-${p.id}`}>
              <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold">{p.name}</span><Pill tone={psTone[p.status]}>{t(`ps_${p.status}` as TKey)}</Pill><span className="num text-[11px] text-muted-foreground">{p.startDate}{p.endDate !== p.startDate && ` → ${p.endDate}`} · {nf(p.assignments.length)} {t("assignments")}</span></div>
              <Timeline plan={p} jobs={jobs.data} ops={ops.data} />
            </div>))}</div>}
      </Panel>
      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Panel title={t("unplannedJobs")} right={<Link href="/jobs" className="text-[11px] font-medium text-primary" data-testid="link-jobs-all">{t("viewAll")}</Link>} className="[&>div]:p-0">
          {jobs.isError ? <div className="p-4"><ErrorState error={jobs.error} onRetry={() => jobs.refetch()} /></div> : !jobs.data ? <div className="p-4"><Sk className="h-24" /></div>
            : unplanned.length === 0 ? <div className="p-4"><Empty title={t("noJobs")} sub={t("noJobsSub")} /></div>
            : <ul className="divide-y">{unplanned.slice(0, 7).map((j) => (
              <li key={j.id} className="flex items-center gap-3 px-4 py-2.5" data-testid={`row-unplanned-${j.id}`}>
                <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{j.name}</div><div className="num text-[11px] text-muted-foreground">{j.machineId.toUpperCase()} · {t("due")} {j.dueDate} · {nf(j.goodQty)}/{nf(j.target)}</div></div>
              </li>))}</ul>}
        </Panel>
        <Panel title={t("openIssuesList")} right={<Link href="/issues" className="text-[11px] font-medium text-primary" data-testid="link-issues-all">{t("viewAll")}</Link>}>
          {issues.isError ? <ErrorState error={issues.error} onRetry={() => issues.refetch()} /> : <IssueList issues={issues.data} limit={5} />}
        </Panel>
      </div>
      <Grid>
        <Kpi label={t("kpiAssigned")} value={plans.data?.reduce((a, p) => a + (p.status === "scheduled" ? p.assignments.length : 0), 0)} href="/planning" testId="kpi-assigned" />
        <Kpi label={t("openOrders")} value={jobs.data ? openJobs.length : undefined} href="/jobs" testId="kpi-open-orders" />
        <Kpi label={t("kpiStopped")} value={ms.data?.filter((m) => m.status === "stopped" || m.status === "maintenance").length} tone="bad" href="/machines" testId="kpi-stopped" />
        <Kpi label={t("kpiOpenIssues")} value={issues.data?.filter((i) => i.status === "open").length} tone="warn" href="/issues" testId="kpi-open-issues" />
      </Grid>
      <LiveMachines editable={false} />
    </div>
  );
}

export default function Home() {
  const { isOwner, isInspector, isPlanner } = useRole();
  return isOwner ? <AdminHome /> : isPlanner ? <PlannerHome /> : isInspector ? <InspectorHome /> : <OperatorHome />;
}
