import { useMemo, useState } from "react";
import { Download, Search } from "lucide-react";
import { useListAudit, getListAuditQueryKey } from "@workspace/api-client-react";
import { useI18n, type TKey } from "@/lib/i18n";
import { ExportBar } from "@/components/exports";
import { Empty, ErrorState, Field, PageHeader, Panel, Sk, inputCls, ghostCls, downloadCsv, useFmt, useProtected } from "@/components/common";

export default function Audit() {
  const { t, nf, lang } = useI18n();
  const fmt = useFmt();
  const audit = useListAudit({ query: { queryKey: getListAuditQueryKey(), ...useProtected(), refetchInterval: 60_000 } });
  const [q, setQ] = useState(""), [from, setFrom] = useState(""), [to, setTo] = useState("");
  const label = (a: string) => { const k = `act_${a.replace(/[.\s-]/g, "_")}` as TKey; const v = t(k); return !v || v === k ? a : v; };
  const day = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? "" : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (audit.data ?? []).filter((e) => {
      const d = day(e.at);
      return (!from || d >= from) && (!to || d <= to) && (!s || [e.actorName, e.actorId, e.action, e.targetId, e.detail, label(e.action)].some((v) => v?.toLowerCase().includes(s)));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audit.data, q, from, to, lang]);
  return (
    <div className="space-y-6">
      <PageHeader title={t("nav_audit")} sub={t("auditPageSub")} action={
        <button className={ghostCls} disabled={!rows.length} onClick={() => downloadCsv(`audit-${new Date().toISOString().slice(0, 10)}.csv`, [["at", "actorName", "actorId", "action", "targetId", "detail"], ...rows.map((e) => [e.at, e.actorName, e.actorId, e.action, e.targetId, e.detail])])} data-testid="button-export-audit"><Download className="h-3.5 w-3.5" />{t("exportAudit")}</button>
      } />
      <ExportBar kinds={["audit"]} compact />
      <div className="rise grid gap-3 rounded-md border bg-card p-3 sm:grid-cols-[1fr_160px_160px_auto] sm:items-end">
        <Field label={t("searchPh")}><div className="relative"><Search className="pointer-events-none absolute start-2.5 top-2.5 h-4 w-4 text-muted-foreground" /><input className={`${inputCls} ps-8`} value={q} onChange={(e) => setQ(e.target.value)} data-testid="input-audit-search" /></div></Field>
        <Field label={t("fromDate")}><input type="date" lang={lang} className={inputCls} value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} data-testid="input-audit-from" /></Field>
        <Field label={t("toDate")}><input type="date" lang={lang} className={inputCls} value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} data-testid="input-audit-to" /></Field>
        <button className={`${ghostCls} h-9`} onClick={() => { setQ(""); setFrom(""); setTo(""); }} data-testid="button-audit-clear">{t("clear")}</button>
      </div>
      <Panel title={`${nf(rows.length)} ${t("results")}`} className="[&>div]:p-0">
        {audit.isError ? <div className="p-4"><ErrorState error={audit.error} onRetry={() => audit.refetch()} /></div>
          : !audit.data ? <div className="space-y-2 p-4">{[0, 1, 2, 3, 4].map((i) => <Sk key={i} className="h-10" />)}</div>
          : rows.length === 0 ? <div className="p-4"><Empty title={t("noAudit")} sub={t("noAuditSub")} /></div>
          : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-secondary/50 text-[11px] uppercase tracking-wider text-muted-foreground"><tr>{["time", "actor", "action", "target"].map((h) => <th key={h} className="px-4 py-2 text-start font-semibold">{t(h as TKey) || h}</th>)}</tr></thead>
                <tbody>{rows.map((e) => (
                  <tr key={e.id} className="border-t align-top hover:bg-secondary/30" data-testid={`row-audit-${e.id}`}>
                    <td className="num whitespace-nowrap px-4 py-2.5 text-xs text-muted-foreground">{fmt(e.at)}</td>
                    <td className="px-4 py-2.5"><div className="font-medium">{e.actorName || "—"}</div><div dir="ltr" className="num text-[11px] text-muted-foreground rtl:text-end">{e.actorId}</div></td>
                    <td className="px-4 py-2.5"><div className="font-medium">{label(e.action)}</div>{e.detail && <div className="max-w-[420px] break-words text-xs text-muted-foreground">{e.detail}</div>}</td>
                    <td dir="ltr" className="num px-4 py-2.5 text-xs rtl:text-end">{e.targetId || "—"}</td>
                  </tr>))}</tbody>
              </table>
            </div>
          )}
      </Panel>
    </div>
  );
}
