import { useState, type FormEvent } from "react";
import { Bot, Database, Send } from "lucide-react";
import { useAskAnalyst, type AnalystAnswer } from "@workspace/api-client-react";
import { useI18n, errorMessage } from "@/lib/i18n";
import { PageHeader, Panel, inputCls } from "@/components/common";

type Turn = { q: string; a?: AnalystAnswer; err?: unknown };

export default function Copilot() {
  const { t, nf, lang } = useI18n();
  const [q, setQ] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const ask = useAskAnalyst();
  const send = (question: string) => {
    const text = question.trim();
    if (!text || ask.isPending) return;
    const idx = turns.length;
    setTurns((p) => [...p, { q: text }]);
    setQ("");
    ask.mutate({ data: { question: text, language: lang } }, {
      onSuccess: (a) => setTurns((p) => p.map((x, i) => (i === idx ? { ...x, a } : x))),
      onError: (err) => setTurns((p) => p.map((x, i) => (i === idx ? { ...x, err } : x))),
    });
  };
  const submit = (e: FormEvent) => { e.preventDefault(); send(q); };

  return (
    <div className="space-y-6">
      <PageHeader title={t("copilotTitle")} sub={t("copilotSub")} />
      <div className="rise flex gap-3 rounded-md border border-accent/30 bg-accent/5 p-4 text-sm">
        <Database className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
        <div><span className="me-2 rounded-sm bg-accent px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent-foreground" data-testid="badge-simulated">{t("simulatedBadge")}</span>{t("simulatedNote")}</div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <Panel className="flex min-h-[460px] flex-col [&>div]:flex [&>div]:flex-1 [&>div]:flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto pb-4" data-testid="list-chat">
            {turns.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center gap-2 py-16 text-center text-sm text-muted-foreground">
                <Bot className="h-8 w-8 text-primary/60" />{t("emptyChat")}
              </div>
            )}
            {turns.map((x, i) => (
              <div key={i} className="rise space-y-2">
                <div className="ms-auto w-fit max-w-[85%] rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground">{x.q}</div>
                <div className="w-fit max-w-[92%] rounded-md border bg-secondary/40 px-3 py-2.5 text-sm" dir={lang === "ar" ? "rtl" : "ltr"}>
                  {x.a ? (
                    <>
                      <p className="whitespace-pre-line leading-relaxed" data-testid={`text-answer-${i}`}>{lang === "ar" ? x.a.answerAr : x.a.answerEn}</p>
                      <div className="num mt-2 border-t pt-1.5 text-[11px] text-muted-foreground">{nf(x.a.sourceCount)} {t("sources")} · {new Date(x.a.generatedAt).toLocaleTimeString(lang === "ar" ? "ar-EG" : "en-US")}</div>
                    </>
                  ) : x.err ? <p className="text-destructive">{errorMessage(x.err, t)}</p> : (
                    <span className="inline-flex items-center gap-2 text-muted-foreground">
                      <span className="flex gap-1">{[0, 1, 2].map((d) => <span key={d} className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" style={{ animationDelay: `${d * 150}ms` }} />)}</span>{t("thinking")}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
          <form onSubmit={submit} className="flex gap-2 border-t pt-4">
            <input className={inputCls} maxLength={1000} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("askPh")} data-testid="input-question" />
            <button disabled={ask.isPending || !q.trim()} data-testid="button-ask" className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:brightness-110 disabled:opacity-60">
              <Send className="h-4 w-4 rtl:-scale-x-100" />{t("ask")}
            </button>
          </form>
        </Panel>
        <Panel title={t("suggestions")}>
          <div className="grid gap-2">
            {(["sq1", "sq2", "sq3", "sq4"] as const).map((k) => (
              <button key={k} onClick={() => send(t(k))} disabled={ask.isPending} data-testid={`button-suggest-${k}`} className="rounded-md border px-3 py-2 text-start text-sm transition hover:border-primary/40 hover:bg-primary/5 disabled:opacity-60">{t(k)}</button>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
