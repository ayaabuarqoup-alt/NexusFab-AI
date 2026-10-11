import { useState } from "react";
import { AlertTriangle, FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { getDownloadExportUrl } from "@workspace/api-client-react";
import { useI18n, errorMessage } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export type ExportKind = "reports" | "plans" | "audit";
type Fmt = "pdf" | "xlsx";

function filenameFrom(cd: string | null, fallback: string) {
  if (!cd) return fallback;
  const star = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(cd);
  if (star) { try { return decodeURIComponent(star[1].trim().replace(/^"|"$/g, "")); } catch { /* fall through */ } }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(cd);
  return plain ? plain[1].trim() : fallback;
}

// Native fetch so we can read Content-Disposition (generated downloadExport returns only the Blob).
async function fetchExport(kind: ExportKind, format: Fmt) {
  const res = await fetch(getDownloadExportUrl(kind, format), { credentials: "include", headers: { Accept: format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } });
  if (!res.ok) {
    let data: unknown = null;
    try { data = await res.json(); } catch { /* binary or empty */ }
    throw { status: res.status, data };
  }
  const blob = await res.blob();
  const name = filenameFrom(res.headers.get("content-disposition"), `nexusfab-${kind}-${new Date().toISOString().slice(0, 10)}.${format}`);
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url; a.download = name; a.rel = "noopener";
    document.body.appendChild(a); a.click(); a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
}

const LABEL = {
  reports: ["Production report", "تقرير الإنتاج"],
  plans: ["Production plans", "خطط الإنتاج"],
  audit: ["Audit trail", "سجل التدقيق"],
} as const;

export function ExportBar({ kinds, compact, className }: { kinds: ExportKind[]; compact?: boolean; className?: string }) {
  const { t, lang } = useI18n();
  const ar = lang === "ar";
  const [busy, setBusy] = useState<string>("");
  const [err, setErr] = useState("");
  const run = async (k: ExportKind, f: Fmt) => {
    setErr(""); setBusy(`${k}-${f}`);
    try { await fetchExport(k, f); } catch (e) { setErr(`${ar ? LABEL[k][1] : LABEL[k][0]} · ${f.toUpperCase()}: ${errorMessage(e, t)}`); } finally { setBusy(""); }
  };
  return (
    <section className={cn("rise rounded-md border bg-card shadow-sm", className)} data-testid="panel-exports">
      <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 p-3", !compact && "md:p-4")}>
        <div className="min-w-[180px] flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{ar ? "تصدير كامل بيانات المصنع" : "Full factory export"}</div>
          {!compact && <p className="mt-0.5 text-xs text-muted-foreground">{ar ? "ملفات كاملة لكل بيانات المصنع، وليست مقيّدة بالفلاتر أو المخططات المعروضة. التقارير تتضمن مؤشرات آخر 7 أيام وجميع أوامر العمل والسجلات." : "Complete files for the whole factory dataset, not the filtered charts on screen. Reports include the latest 7-day KPIs plus all work orders and logs."}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {kinds.map((k) => (
            <div key={k} className="flex items-stretch overflow-hidden rounded-md border" data-testid={`group-export-${k}`}>
              <span className="flex items-center bg-secondary/50 px-2.5 text-xs font-medium">{ar ? LABEL[k][1] : LABEL[k][0]}</span>
              {(["pdf", "xlsx"] as const).map((f) => {
                const id = `${k}-${f}`, on = busy === id;
                const I = f === "pdf" ? FileText : FileSpreadsheet;
                return (
                  <button key={f} type="button" disabled={!!busy} onClick={() => run(k, f)} data-testid={`button-export-${k}-${f}`}
                    className="inline-flex h-9 items-center gap-1.5 border-s px-3 text-xs font-semibold transition hover:bg-primary hover:text-primary-foreground disabled:opacity-60">
                    {on ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <I className="h-3.5 w-3.5" />}{f === "pdf" ? "PDF" : "Excel"}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      {busy && <div className="border-t px-3 py-1.5 text-[11px] text-muted-foreground" data-testid="text-export-busy">{ar ? "جارٍ تجهيز الملف…" : "Preparing file…"}</div>}
      {err && <div className="flex items-start gap-2 border-t border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive" data-testid="text-export-error"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{err}</div>}
    </section>
  );
}
