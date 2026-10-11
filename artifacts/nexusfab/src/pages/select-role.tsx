import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, ClipboardCheck, Factory, LogOut, ShieldCheck, Wrench, type LucideIcon } from "lucide-react";
import { useSelectRole, useLogout, type Session, type SessionAvailableRolesItem } from "@workspace/api-client-react";
import { useI18n, errorMessage, type TKey } from "@/lib/i18n";
import { LangToggle, usePageMeta } from "@/components/shell";
import { updateSession } from "@/components/common";
import { cn } from "@/lib/utils";

const ICONS: Record<SessionAvailableRolesItem, LucideIcon> = { owner: ShieldCheck, operator: Wrench, quality_inspector: ClipboardCheck };

export default function SelectRole({ session }: { session: Session }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  usePageMeta(t("srTitle"));
  const [picked, setPicked] = useState<SessionAvailableRolesItem | null>(null);
  const select = useSelectRole({ mutation: { onSuccess: (s) => updateSession(qc, s) } });
  const logout = useLogout({ mutation: { onSuccess: () => updateSession(qc, { authenticated: false, factory: "", factoryName: "", availableRoles: [], requiresRoleSelection: false }) } });
  const roles = session.availableRoles ?? [];
  const busy = select.isPending || logout.isPending;
  const err = select.isError ? select.error : logout.isError ? logout.error : null;

  return (
    <div className="relative min-h-[100dvh] bg-background">
      <header className="flex items-center justify-between border-b px-5 py-3">
        <div className="flex items-center gap-2.5">
          <div className="grid h-8 w-8 place-items-center rounded-md bg-primary"><Factory className="h-4 w-4 text-primary-foreground" /></div>
          <div>
            <div className="text-sm font-semibold">{t("appName")}</div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{session.factoryName}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <LangToggle />
          <button onClick={() => logout.mutate()} disabled={busy} data-testid="button-role-logout"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-card px-3 text-xs font-medium transition hover:bg-secondary disabled:opacity-60">
            <LogOut className="h-3.5 w-3.5 rtl:rotate-180" />{t("signOut")}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-5 py-12 md:py-20">
        <div className="rise">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">{t("srEyebrow")}</div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl" data-testid="text-select-role-title">{t("srTitle")}</h1>
          <p className="mt-3 max-w-xl text-sm text-muted-foreground">{t("srSub")}</p>
          <div className="mt-4 inline-flex items-center gap-2 rounded-sm border bg-card px-2.5 py-1 text-xs">
            <span className="text-muted-foreground">{t("srSignedIn")}</span>
            <span className="font-medium" data-testid="text-select-role-user">{session.userName || session.factoryName}</span>
          </div>
        </div>

        {roles.length === 0 ? (
          <div className="rise mt-8 rounded-md border border-dashed bg-secondary/30 p-6 text-sm text-muted-foreground" data-testid="text-no-roles">{t("srNone")}</div>
        ) : (
          <ol className="mt-8 grid gap-2" role="radiogroup" aria-label={t("srTitle")}>
            {roles.map((r, i) => {
              const Icon = ICONS[r];
              const on = picked === r;
              return (
                <li key={r} className="rise" style={{ animationDelay: `${60 + i * 60}ms` }}>
                  <button type="button" role="radio" aria-checked={on} disabled={busy} onClick={() => { setPicked(r); select.reset(); }}
                    data-testid={`button-pick-role-${r}`}
                    className={cn("group flex w-full items-center gap-4 rounded-md border bg-card p-4 text-start transition disabled:opacity-60",
                      on ? "border-primary ring-2 ring-primary/20" : "hover:border-primary/50")}>
                    <span className="num w-5 text-xs text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
                    <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-md transition", on ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary")}><Icon className="h-5 w-5" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{t(`role_${r}` as TKey)}</span>
                      <span className="block text-xs text-muted-foreground">{t(`role_${r}_d` as TKey)}</span>
                    </span>
                    <span className={cn("h-4 w-4 shrink-0 rounded-full border-2 transition", on ? "border-primary bg-primary shadow-[inset_0_0_0_2px_hsl(var(--card))]" : "border-input")} />
                  </button>
                </li>
              );
            })}
          </ol>
        )}

        {err && <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive" data-testid="text-select-role-error">{errorMessage(err, t)}</div>}

        {roles.length > 0 && (
          <button disabled={!picked || busy} onClick={() => picked && select.mutate({ data: { role: picked } })} data-testid="button-enter-role"
            className="mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-medium text-primary-foreground shadow-md transition hover:brightness-110 disabled:opacity-50">
            {select.isPending ? t("srEntering") : picked ? `${t("srEnter")} ${t(`role_${picked}` as TKey)}` : t("srEnter")}
            <ArrowRight className="h-4 w-4 rtl:rotate-180" />
          </button>
        )}
      </main>
    </div>
  );
}
