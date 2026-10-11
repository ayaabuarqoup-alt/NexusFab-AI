import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient, useIsFetching } from "@tanstack/react-query";
import { Activity, Bot, ClipboardCheck, Factory, Gauge, LayoutDashboard, ListChecks, LogOut, Menu, RotateCw, X } from "lucide-react";
import { useGetSession, getGetSessionQueryKey, useGetSummary, getGetSummaryQueryKey, useLogout } from "@workspace/api-client-react";
import { useI18n, type TKey } from "@/lib/i18n";
import { REFRESH_MS, useProtected, sessionQuery, broadcastAuth } from "@/components/common";
import { cn } from "@/lib/utils";

const nav: { href: string; key: TKey; icon: typeof Gauge }[] = [
  { href: "/", key: "nav_dashboard", icon: LayoutDashboard },
  { href: "/jobs", key: "nav_jobs", icon: ListChecks },
  { href: "/production", key: "nav_production", icon: Activity },
  { href: "/quality", key: "nav_quality", icon: ClipboardCheck },
  { href: "/machines", key: "nav_machines", icon: Gauge },
  { href: "/copilot", key: "nav_copilot", icon: Bot },
];

export function usePageMeta(title: string) {
  const { t } = useI18n();
  useEffect(() => {
    document.title = `${title} | ${t("appName")}`;
    let m = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (!m) { m = document.createElement("meta"); m.name = "description"; document.head.appendChild(m); }
    m.content = t("metaDesc");
  }, [title, t]);
}

export function LangToggle({ dark }: { dark?: boolean }) {
  const { lang, setLang, t } = useI18n();
  return (
    <div role="group" aria-label={t("language")} className={cn("inline-flex rounded-md border p-0.5 text-xs", dark ? "border-sidebar-border bg-sidebar-accent" : "bg-card")}>
      {(["en", "ar"] as const).map((l) => (
        <button key={l} onClick={() => setLang(l)} data-testid={`button-lang-${l}`}
          className={cn("rounded px-2.5 py-1 font-medium transition", lang === l ? (dark ? "bg-sidebar-primary text-white" : "bg-primary text-primary-foreground") : dark ? "text-sidebar-foreground/70 hover:text-white" : "text-muted-foreground hover:text-foreground")}>
          {l === "en" ? "English" : "العربية"}
        </button>
      ))}
    </div>
  );
}

function Countdown() {
  const { t, nf, lang } = useI18n();
  const qc = useQueryClient();
  const fetching = useIsFetching() > 0;
  const { dataUpdatedAt } = useGetSummary({ query: { queryKey: getGetSummaryQueryKey(), ...useProtected() } });
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i); }, []);
  const base = dataUpdatedAt || now;
  const left = Math.max(0, REFRESH_MS - (now - base));
  const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
  const pct = (left / REFRESH_MS) * 100;
  return (
    <div className="rounded-md border border-sidebar-border bg-sidebar-accent/60 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/60">{t("nextRefresh")}</div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="num text-xl font-semibold text-white" data-testid="text-countdown">{nf(m).padStart(2, nf(0))}:{nf(s).padStart(2, nf(0))}</span>
        <span className="text-[11px] text-sidebar-foreground/60">{t("minRemaining")}</span>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-sidebar-border">
        <div className="h-full origin-left bg-[hsl(32_95%_52%)] transition-transform duration-1000 ease-linear rtl:origin-right" style={{ transform: `scaleX(${pct / 100})` }} />
      </div>
      <button onClick={() => qc.invalidateQueries()} disabled={fetching} data-testid="button-refresh"
        className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-sidebar-primary px-2 py-1.5 text-xs font-medium text-white transition hover:brightness-110 disabled:opacity-70">
        <RotateCw className={cn("h-3.5 w-3.5", fetching && "animate-spin")} />{fetching ? t("refreshing") : t("refreshNow")}
      </button>
      {dataUpdatedAt > 0 && <div className="mt-2 text-[10px] text-sidebar-foreground/50">{t("lastSync")}: <span className="num">{new Date(dataUpdatedAt).toLocaleTimeString(lang === "ar" ? "ar-EG" : "en-US")}</span></div>}
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [loc] = useLocation();
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const { data: session } = useGetSession({ query: sessionQuery });
  const logout = useLogout({ mutation: { onSettled: () => { qc.clear(); qc.setQueryData(getGetSessionQueryKey(), { authenticated: false, factory: "", factoryName: "" }); broadcastAuth(); } } });
  useEffect(() => setOpen(false), [loc]);
  const navKey = nav.find((n) => n.href === loc)?.key;
  usePageMeta(navKey ? t(navKey) : t("notFound"));

  const side = (
    <div className="flex h-full flex-col gap-5 bg-sidebar p-4 text-sidebar-foreground">
      <div className="flex items-center gap-2.5 px-1">
        <div className="grid h-8 w-8 place-items-center rounded-md bg-sidebar-primary"><Factory className="h-4 w-4 text-white" /></div>
        <div>
          <div className="text-sm font-semibold text-white">{t("appName")}</div>
          <div className="text-[10px] uppercase tracking-wider text-sidebar-foreground/55">{t("tagline")}</div>
        </div>
      </div>
      <div className="rounded-md border border-sidebar-border px-3 py-2">
        <div className="text-[10px] uppercase tracking-wider text-sidebar-foreground/55">{t("tenant")}</div>
        <div className="truncate text-sm font-medium text-white" data-testid="text-factory">{session?.factoryName}</div>
        <div className="num truncate text-[11px] text-sidebar-foreground/55">{session?.factory}</div>
      </div>
      <nav className="flex flex-col gap-0.5">
        {nav.map(({ href, key, icon: I }) => {
          const active = loc === href;
          return (
            <Link key={href} href={href} data-testid={`link-${key}`}
              className={cn("group relative flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition", active ? "bg-sidebar-accent text-white" : "text-sidebar-foreground/75 hover:bg-sidebar-accent/50 hover:text-white")}>
              {active && <span className="absolute inset-y-1.5 start-0 w-0.5 rounded-full bg-[hsl(32_95%_52%)]" />}
              <I className="h-4 w-4" />{t(key)}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto flex flex-col gap-3">
        <Countdown />
        <LangToggle dark />
        <button onClick={() => logout.mutate()} disabled={logout.isPending} data-testid="button-logout"
          className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm text-sidebar-foreground/75 transition hover:bg-sidebar-accent/50 hover:text-white">
          <LogOut className="h-4 w-4 rtl:rotate-180" />{t("signOut")}
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-[100dvh] bg-background">
      <aside className="fixed inset-y-0 start-0 z-30 hidden w-64 overflow-y-auto lg:block">{side}</aside>
      <div className="sticky top-0 z-20 flex items-center justify-between border-b bg-sidebar px-4 py-3 lg:hidden">
        <div className="flex items-center gap-2 text-white"><Factory className="h-4 w-4" /><span className="text-sm font-semibold">{t("appName")}</span></div>
        <button onClick={() => setOpen(true)} data-testid="button-menu" className="text-white"><Menu className="h-5 w-5" /></button>
      </div>
      <div className={cn("fixed inset-0 z-40 lg:hidden", open ? "pointer-events-auto" : "pointer-events-none")}>
        <div onClick={() => setOpen(false)} className={cn("absolute inset-0 bg-[#0F172A]/50 transition-opacity", open ? "opacity-100" : "opacity-0")} />
        <div className={cn("absolute inset-y-0 start-0 w-72 overflow-y-auto transition-transform duration-300", open ? "translate-x-0" : "-translate-x-full rtl:translate-x-full")}>
          <button onClick={() => setOpen(false)} className="absolute end-3 top-4 z-10 text-white" data-testid="button-close-menu"><X className="h-5 w-5" /></button>
          {side}
        </div>
      </div>
      <main className="lg:ps-64">
        <div key={loc} className="mx-auto max-w-[1400px] px-4 py-6 md:px-8 md:py-8">{children}</div>
      </main>
    </div>
  );
}
