import { useMemo, useState, type FormEvent } from "react";
import { Bot, ChevronDown, Database, Filter, Send, Trash2 } from "lucide-react";
import {
  useAskAnalyst, useListJobs, getListJobsQueryKey, useListLogs, getListLogsQueryKey,
  AnalystInputMachineId, type AnalystAnswer, type AnalystInput,
} from "@workspace/api-client-react";
import { useI18n, errorMessage } from "@/lib/i18n";
import { PageHeader, Panel, Pill, inputCls, useProtected } from "@/components/common";

type Scope = { jobId: string; machineId: string; staff: string; fromDate: string; toDate: string };
type Turn = { q: string; scope: Partial<Scope>; a?: AnalystAnswer; err?: unknown };
const EMPTY: Scope = { jobId: "", machineId: "", staff: "", fromDate: "", toDate: "" };

function Evidence({ a, idx }: { a: AnalystAnswer; idx: number }) {
  const { t, nf } = useI18n();
  const [open, setOpen] = useState(false);
  if (!a.evidence.length) return null;
  return (
    <div className="mt-2 border-t pt-2">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} data-testid={`button-evidence-${idx}`} className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline">
        <ChevronDown className={`h-3.5 w-3.5 transition ${open ? "rotate-180" : ""}`} />{open ? t("hideEvidence") : t("showEvidence")} ({nf(a.evidence.length)})
      </button>
      {open && <div className="mt-2 max-w-full overflow-x-auto rounded-md border bg-card">
        <table className="w-full min-w-[640px] text-xs" data-testid={`table-evidence-${idx}`}>
          <thead className="bg-secondary/70 text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>{[t("sourceId"), t("colJob"), t("colMachine"), t("colOperator"), t("colWhen"), t("colGood"), t("colRej"), t("colDown"), t("colQc"), t("recorded")].map((h) => <th key={h} className="px-2 py-1.5 text-start font-semibold">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y">
            {a.evidence.map((l) => (
              <tr key={l.id} title={l.reason || undefined}>
                <td className="num px-2 py-1.5 text-primary" dir="ltr">{l.id}</td><td className="num px-2 py-1.5" dir="ltr">{l.jobId}</td><td className="num px-2 py-1.5">{l.machineId}</td>
                <td className="px-2 py-1.5">{l.staff}</td><td className="num whitespace-nowrap px-2 py-1.5" dir="ltr">{l.date} {l.time}</td>
                <td className="num px-2 py-1.5">{nf(l.goodQty)}</td><td className="num px-2 py-1.5">{nf(l.rejects)}</td><td className="num px-2 py-1.5">{nf(l.downtimeMinutes)}</td>
                <td className="px-2 py-1.5">{t(`qc_${l.qcStatus}`)}</td><td className="num whitespace-nowrap px-2 py-1.5 text-muted-foreground" dir="ltr">{l.createdAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {a.evidenceTruncated && <div className="border-t px-2 py-1.5 text-[11px] text-[hsl(var(--warn))]" data-testid={`text-truncated-${idx}`}>{t("truncated")}</div>}
      </div>}
    </div>
  );
}

export default function Copilot() {
  const { t, nf, lang } = useI18n();
  const prot = useProtected();
  const jobs = useListJobs({ query: { queryKey: getListJobsQueryKey(), ...prot } }).data ?? [];
  const logs = useListLogs({ query: { queryKey: getListLogsQueryKey(), ...prot } }).data;
  const staffNames = useMemo(() => Array.from(new Set((logs ?? []).map((l) => l.staff))).sort(), [logs]);
  const [q, setQ] = useState("");
  const [scope, setScope] = useState<Scope>(EMPTY);
  const [turns, setTurns] = useState<Turn[]>([]);
  const ask = useAskAnalyst();
  const set = (k: keyof Scope) => (v: string) => setScope((p) => ({ ...p, [k]: v }));

  const send = (question: string) => {
    if (!question.trim() || ask.isPending) return;
    const data: AnalystInput = { question: question.trim(), language: lang };
    const used: Partial<Scope> = {};
    if (scope.jobId) data.jobId = used.jobId = scope.jobId;
    if (scope.machineId) { data.machineId = scope.machineId as AnalystInput["machineId"]; used.machineId = scope.machineId; }
    if (scope.staff.trim()) data.staff = used.staff = scope.staff.trim();
    if (scope.fromDate) data.fromDate = used.fromDate = scope.fromDate;
    if (scope.toDate) data.toDate = used.toDate = scope.toDate;
    const idx = turns.length;
    setTurns((p) => [...p, { q: question, scope: used }]);
    setQ("");
    ask.mutate({ data }, {
      onSuccess: (a) => setTurns((p) => p.map((x, i) => (i === idx ? { ...x, a } : x))),
      onError: (err) => setTurns((p) => p.map((x, i) => (i === idx ? { ...x, err } : x))),
    });
  };
  const submit = (e: FormEvent) => { e.preventDefault(); send(q); };
  const scopeCount = Object.values(scope).filter((v) => v.trim()).length;
  const label = (k: string) => <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{k}</span>;

  return (
    <div className="space-y-6">
      <PageHeader title={t("copilotTitle")} sub={t("copilotSub")} />
      <div className="rise flex gap-3 rounded-md border border-accent/30 bg-accent/5 p-4 text-sm">
        <Database className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
        <div><span className="me-2 rounded-sm bg-accent px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent-foreground" data-testid="badge-simulated">{t("deterministic")}</span>{t("deterministicNote")}</div>
      </div>
      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <Panel className="flex min-h-[520px] min-w-0 flex-col [&>div]:flex [&>div]:min-w-0 [&>div]:flex-1 [&>div]:flex-col" title={t("copilotTitle")}
          right={turns.length > 0 ? <button type="button" onClick={() => setTurns([])} disabled={ask.isPending} data-testid="button-clear-chat" className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"><Trash2 className="h-3 w-3" />{t("clearChat")}</button> : undefined}>
          <div className="min-w-0 max-h-[620px] flex-1 space-y-5 overflow-y-auto break-words pb-4" data-testid="list-chat">
            {turns.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center gap-2 py-16 text-center text-sm text-muted-foreground">
                <Bot className="h-8 w-8 text-primary/60" />{t("emptyChat")}
              </div>
            )}
            {turns.map((x, i) => (
              <div key={i} className="rise space-y-2">
                <div className="ms-auto w-fit max-w-[85%] whitespace-pre-wrap rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground" dir="auto" data-testid={`text-question-${i}`}>{x.q}</div>
                {Object.keys(x.scope).length > 0 && <div className="ms-auto flex w-fit flex-wrap justify-end gap-1">{Object.entries(x.scope).map(([k, v]) => <span key={k} className="num rounded-sm border bg-card px-1.5 py-0.5 text-[10px] text-muted-foreground">{t(({ jobId: "colJob", machineId: "colMachine", staff: "colOperator", fromDate: "fromDate", toDate: "toDate" } as const)[k as keyof Scope])}: {v}</span>)}</div>}
                <div className="min-w-0 w-fit max-w-[95%] rounded-md border bg-secondary/40 px-3 py-2.5 text-sm" dir={lang === "ar" ? "rtl" : "ltr"}>
                  {x.a ? (
                    <>
                      <div className="mb-1.5"><Pill tone={x.a.intent === "unsupported" ? "mute" : "info"} testId={`pill-intent-${i}`}>{t("intent")}: {t(`intent_${x.a.intent}`)}</Pill></div>
                      <p className="whitespace-pre-line leading-relaxed" data-testid={`text-answer-${i}`}>{lang === "ar" ? x.a.answerAr : x.a.answerEn}</p>
                      <div className="num mt-2 border-t pt-1.5 text-[11px] text-muted-foreground">{nf(x.a.sourceCount)} {t("sources")} · {new Date(x.a.generatedAt).toLocaleString(lang === "ar" ? "ar-EG" : "en-US")}</div>
                      <Evidence a={x.a} idx={i} />
                    </>
                  ) : x.err ? <p className="text-destructive" data-testid={`text-error-${i}`}>{errorMessage(x.err, t)}</p> : (
                    <span className="inline-flex items-center gap-2 text-muted-foreground">
                      <span className="flex gap-1">{[0, 1, 2].map((d) => <span key={d} className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" style={{ animationDelay: `${d * 150}ms` }} />)}</span>{t("thinking")}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
          <form onSubmit={submit} className="flex gap-2 border-t pt-4">
            <input className={inputCls} dir="auto" maxLength={1000} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("askPh")} data-testid="input-question" />
            <button disabled={ask.isPending || !q.trim()} data-testid="button-ask" className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:brightness-110 disabled:opacity-60">
              <Send className="h-4 w-4 rtl:-scale-x-100" />{t("ask")}
            </button>
          </form>
        </Panel>
        <div className="min-w-0 space-y-4">
          <Panel title={t("copilotScope")} right={scopeCount > 0 ? <button type="button" onClick={() => setScope(EMPTY)} data-testid="button-reset-scope" className="text-[11px] text-primary hover:underline">{t("resetAll")}</button> : <Filter className="h-3.5 w-3.5 text-muted-foreground" />}>
            <div className="grid gap-3">
              <label className="flex flex-col gap-1">{label(t("jobFilter"))}
                <select className={inputCls} value={scope.jobId} onChange={(e) => set("jobId")(e.target.value)} data-testid="select-scope-job">
                  <option value="">{t("allJobs")}</option>{jobs.map((j) => <option key={j.id} value={j.id}>{j.name} · {j.id}</option>)}
                </select></label>
              <label className="flex flex-col gap-1">{label(t("machineFilter"))}
                <select className={inputCls} value={scope.machineId} onChange={(e) => set("machineId")(e.target.value)} data-testid="select-scope-machine">
                  <option value="">{t("allMachines")}</option>{Object.values(AnalystInputMachineId).map((m) => <option key={m} value={m}>{m}</option>)}
                </select></label>
              <label className="flex flex-col gap-1">{label(t("byStaff"))}
                <input className={inputCls} list="nf-staff" maxLength={100} value={scope.staff} placeholder={t("staffPh")} onChange={(e) => set("staff")(e.target.value)} data-testid="input-scope-staff" />
                <datalist id="nf-staff">{staffNames.map((n) => <option key={n} value={n} />)}</datalist></label>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1">{label(t("fromDate"))}<input type="date" lang={lang} className={`${inputCls} num px-2`} value={scope.fromDate} max={scope.toDate || undefined} onChange={(e) => set("fromDate")(e.target.value)} data-testid="input-scope-from" /></label>
                <label className="flex flex-col gap-1">{label(t("toDate"))}<input type="date" lang={lang} className={`${inputCls} num px-2`} value={scope.toDate} min={scope.fromDate || undefined} onChange={(e) => set("toDate")(e.target.value)} data-testid="input-scope-to" /></label>
              </div>
              <p className="text-[11px] text-muted-foreground">{t("scopeOptional")}</p>
            </div>
          </Panel>
          <Panel title={t("suggestions")}>
            <div className="grid gap-2">
              {(["sugBottleneck", "sugYield", "sugTrend", "sugSummary", "sq1", "sq3"] as const).map((k) => (
                <button key={k} onClick={() => send(t(k))} disabled={ask.isPending} data-testid={`button-suggest-${k}`} className="rounded-md border px-3 py-2 text-start text-sm transition hover:border-primary/40 hover:bg-primary/5 disabled:opacity-60">{t(k)}</button>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
