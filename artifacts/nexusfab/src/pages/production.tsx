import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useListJobs, getListJobsQueryKey, useListLogs, getListLogsQueryKey, useCreateLog, getGetSummaryQueryKey } from "@workspace/api-client-react";
import { useI18n, errorMessage } from "@/lib/i18n";
import { Empty, ErrorState, Field, PageHeader, Panel, Pill, Sk, inputCls, useProtected } from "@/components/common";
import { useToast } from "@/hooks/use-toast";

export const qcTone = { pending: "warn", approved: "ok", rejected: "bad" } as const;
const now = () => { const d = new Date(); return { date: d.toISOString().slice(0, 10), time: d.toTimeString().slice(0, 5) }; };

export default function Production() {
  const { t, nf, lang } = useI18n();
  const qc = useQueryClient();
  const { toast } = useToast();
  const prot = useProtected();
  const jobs = useListJobs({ query: { queryKey: getListJobsQueryKey(), ...prot } });
  const logs = useListLogs({ query: { queryKey: getListLogsQueryKey(), ...prot } });
  const open = (jobs.data ?? []).filter((j) => j.status !== "dispatched");
  const [f, setF] = useState({ jobId: "", staff: "", ...now(), goodQty: "", rejects: "0", downtimeMinutes: "0", reason: "" });
  const [err, setErr] = useState("");
  const create = useCreateLog({ mutation: { onSuccess: () => {
    [getListLogsQueryKey(), getListJobsQueryKey(), getGetSummaryQueryKey()].forEach((queryKey) => qc.invalidateQueries({ queryKey }));
    setF((p) => ({ ...p, goodQty: "", rejects: "0", downtimeMinutes: "0", reason: "" })); toast({ title: t("logCreated") });
  } } });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr("");
    const g = Number(f.goodQty), r = Number(f.rejects), d = Number(f.downtimeMinutes);
    if (!f.jobId || !f.staff.trim() || f.goodQty === "") return setErr(t("required"));
    if (![g, r, d].every((n) => Number.isFinite(n) && n >= 0) || d > 1440) return setErr(t("mustBePositive"));
    create.mutate({ data: { jobId: f.jobId, staff: f.staff.trim(), date: f.date, time: f.time, goodQty: Math.round(g), rejects: Math.round(r), downtimeMinutes: Math.round(d), reason: f.reason.trim() } });
  };
  const jobName = (id: string) => jobs.data?.find((j) => j.id === id)?.name ?? id;

  return (
    <div className="space-y-6">
      <PageHeader title={t("prodTitle")} sub={t("prodSub")} />
      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        <Panel title={t("newLog")}>
          {jobs.data && open.length === 0 ? <Empty title={t("noJobs")} sub={t("needJob")} /> : (
            <form onSubmit={submit} className="grid gap-3">
              <Field label={t("job")}>
                <select className={inputCls} value={f.jobId} onChange={set("jobId")} data-testid="select-job">
                  <option value="">{t("selectJob")}</option>
                  {open.map((j) => <option key={j.id} value={j.id}>{j.name} · {j.machineId.toUpperCase()}</option>)}
                </select>
              </Field>
              <Field label={t("staff")}><input className={inputCls} maxLength={80} value={f.staff} onChange={set("staff")} data-testid="input-staff" /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("date")}><input type="date" lang={lang} className={inputCls} value={f.date} onChange={set("date")} required data-testid="input-date" /></Field>
                <Field label={t("time")}><input type="time" lang={lang} className={inputCls} value={f.time} onChange={set("time")} required data-testid="input-time" /></Field>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Field label={t("goodQty")}><input type="number" min={0} className={`${inputCls} num`} value={f.goodQty} onChange={set("goodQty")} data-testid="input-good" /></Field>
                <Field label={t("rejects")}><input type="number" min={0} className={`${inputCls} num`} value={f.rejects} onChange={set("rejects")} data-testid="input-rejects" /></Field>
                <Field label={t("downtimeMin")}><input type="number" min={0} max={1440} className={`${inputCls} num`} value={f.downtimeMinutes} onChange={set("downtimeMinutes")} data-testid="input-downtime" /></Field>
              </div>
              <Field label={t("reason")}><textarea maxLength={500} rows={2} className={`${inputCls} h-auto py-2`} value={f.reason} onChange={set("reason")} data-testid="input-reason" /></Field>
              {(err || create.isError) && <p className="text-xs text-destructive" data-testid="text-log-error">{err || errorMessage(create.error, t)}</p>}
              <button disabled={create.isPending} data-testid="button-submit-log" className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary text-sm font-medium text-primary-foreground transition hover:brightness-110 disabled:opacity-70">
                <Plus className="h-4 w-4" />{create.isPending ? t("submitting") : t("submitLog")}
              </button>
            </form>
          )}
        </Panel>
        <Panel title={t("nav_production")} className="[&>div]:p-0">
          {logs.isError ? <div className="p-4"><ErrorState error={logs.error} onRetry={() => logs.refetch()} /></div>
            : !logs.data ? <div className="space-y-2 p-4">{[0, 1, 2, 3].map((i) => <Sk key={i} className="h-10" />)}</div>
            : logs.data.length === 0 ? <div className="p-4"><Empty title={t("noLogs")} sub={t("noLogsSub")} /></div>
            : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="bg-secondary/50 text-[11px] uppercase tracking-wider text-muted-foreground">
                    <tr>{[t("date"), t("job"), t("staff"), t("goodQty"), t("rejects"), t("downtimeMin"), t("reason"), t("status")].map((h) => <th key={h} className="px-3 py-2 text-start font-semibold">{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {logs.data.map((l) => (
                      <tr key={l.id} className="border-t transition hover:bg-secondary/30" data-testid={`row-log-${l.id}`}>
                        <td className="num whitespace-nowrap px-3 py-2 text-xs">{l.date} {l.time}</td>
                        <td className="px-3 py-2"><div className="max-w-[160px] truncate">{jobName(l.jobId)}</div><div className="num text-[11px] text-muted-foreground">{l.machineId.toUpperCase()}</div></td>
                        <td className="px-3 py-2">{l.staff}</td>
                        <td className="num px-3 py-2">{nf(l.goodQty)}</td>
                        <td className="num px-3 py-2">{nf(l.rejects)}</td>
                        <td className="num px-3 py-2">{nf(l.downtimeMinutes)}</td>
                        <td className="max-w-[180px] truncate px-3 py-2 text-xs text-muted-foreground" title={l.reason}>{l.reason || "—"}</td>
                        <td className="px-3 py-2"><Pill tone={qcTone[l.qcStatus]}>{t(`qc_${l.qcStatus}`)}</Pill></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </Panel>
      </div>
    </div>
  );
}
