import { useEffect, useRef, type ReactNode } from "react";
import Plotly from "plotly.js-dist-min";
import { AlertTriangle, Inbox, RotateCw } from "lucide-react";
import { useGetSession, getGetSessionQueryKey } from "@workspace/api-client-react";
import { useI18n, errorMessage } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export const REFRESH_MS = 900_000;

export const sessionQuery = { queryKey: getGetSessionQueryKey(), staleTime: 60_000, refetchInterval: 120_000, refetchOnWindowFocus: true, retry: false } as const;
const AUTH_KEY = "nf-auth-event";
export function broadcastAuth() {
  try { localStorage.setItem(AUTH_KEY, String(Date.now())); } catch { /* ignore */ }
}
export function onAuthBroadcast(fn: () => void) {
  const h = (e: StorageEvent) => { if (e.key === AUTH_KEY) fn(); };
  window.addEventListener("storage", h);
  return () => window.removeEventListener("storage", h);
}
export function useAuthed() {
  const { data } = useGetSession({ query: sessionQuery });
  return !!data?.authenticated;
}
export function useProtected() {
  const authed = useAuthed();
  return { enabled: authed, refetchInterval: REFRESH_MS, refetchIntervalInBackground: true } as const;
}

export function PageHeader({ title, sub, action }: { title: string; sub: string; action?: ReactNode }) {
  const { t } = useI18n();
  const { demo } = useRole();
  return (
    <div className="rise flex flex-col gap-3 border-b pb-5 md:flex-row md:items-end md:justify-between">
      <div>
        {demo && <div className="mb-1.5 flex items-center gap-2">
          <span className="rounded-sm border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent" data-testid="badge-sample">{t("sampleData")}</span>
        </div>}
        <h1 className="text-2xl font-semibold tracking-tight md:text-[28px]">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{sub}</p>
      </div>
      {action}
    </div>
  );
}

export function Panel({ title, children, className, right }: { title?: string; children: ReactNode; className?: string; right?: ReactNode }) {
  return (
    <section className={cn("rise rounded-md border bg-card shadow-sm", className)}>
      {title && (
        <header className="flex items-center justify-between border-b px-4 py-2.5">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{title}</h2>
          {right}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Empty({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed bg-secondary/30 px-6 py-12 text-center">
      <div className="grid h-10 w-10 place-items-center rounded-md bg-secondary text-primary"><Inbox className="h-5 w-5" /></div>
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-xs text-xs text-muted-foreground">{sub}</p>
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-6 py-10 text-center">
      <AlertTriangle className="h-6 w-6 text-destructive" />
      <p className="text-sm font-medium">{t("error")}</p>
      <p className="text-xs text-muted-foreground">{errorMessage(error, t)}</p>
      <button onClick={onRetry} data-testid="button-retry" className="inline-flex items-center gap-1.5 rounded-md border bg-card px-3 py-1.5 text-xs font-medium hover:bg-secondary">
        <RotateCw className="h-3.5 w-3.5" />{t("retry")}
      </button>
    </div>
  );
}

export function Sk({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-secondary", className)} />;
}

const tones: Record<string, string> = {
  ok: "bg-[hsl(var(--ok)/0.1)] text-[hsl(var(--ok))] border-[hsl(var(--ok)/0.3)]",
  warn: "bg-[hsl(var(--warn)/0.1)] text-[hsl(var(--warn))] border-[hsl(var(--warn)/0.3)]",
  bad: "bg-destructive/10 text-destructive border-destructive/30",
  info: "bg-primary/10 text-primary border-primary/25",
  mute: "bg-secondary text-muted-foreground border-border",
};
export function Pill({ tone, children, testId }: { tone: keyof typeof tones; children: ReactNode; testId?: string }) {
  return (
    <span data-testid={testId} className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm border px-1.5 py-0.5 text-[11px] font-medium", tones[tone])}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />{children}
    </span>
  );
}

export function Field({ label, children, error }: { label: string; children: ReactNode; error?: string }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      {children}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </label>
  );
}
export const inputCls = "h-9 w-full rounded-md border border-input bg-card px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:opacity-60";

export function Plot({ data, layout, height = 280, testId }: { data: Plotly.Data[]; layout?: Partial<Plotly.Layout>; height?: number; testId?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const { lang } = useI18n();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    Plotly.react(el, data, {
      height, autosize: true, margin: { l: 40, r: 16, t: 8, b: 40 },
      paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
      font: { family: lang === "ar" ? "IBM Plex Sans Arabic" : "IBM Plex Sans", size: 12, color: "#0F172A" },
      hoverlabel: { bgcolor: "#0F172A", bordercolor: "#0F172A", font: { color: "#F8FAFC", family: "IBM Plex Sans, IBM Plex Sans Arabic" } },
      legend: { orientation: "h", y: -0.12 },
      ...layout,
    }, { displayModeBar: false, responsive: true });
  }, [data, layout, height, lang]);
  useEffect(() => {
    const el = ref.current;
    return () => { if (el) Plotly.purge(el); };
  }, []);
  return <div ref={ref} data-testid={testId} className="w-full" style={{ minHeight: height }} />;
}

export function useRole() {
  const { data } = useGetSession({ query: sessionQuery });
  const role = data?.role || "";
  const demo = !data?.userId || data.userId === "demo";
  return {
    session: data, role, demo,
    canCreate: role === "owner" || role === "operator",
    canReview: role === "owner" || role === "quality_inspector",
    canDispatch: role === "owner",
    isOwner: role === "owner",
  };
}

export function PermNote({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-[hsl(var(--warn)/0.3)] bg-[hsl(var(--warn)/0.08)] px-3 py-2 text-xs text-[hsl(var(--warn))]" data-testid="text-permission">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>{children}</span>
    </div>
  );
}
