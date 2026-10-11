import { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck, Radio } from "lucide-react";
import { useListNotifications, getListNotificationsQueryKey, useReadNotification, type Notification } from "@workspace/api-client-react";
import { useI18n, errorMessage, type TKey } from "@/lib/i18n";
import { useLiveStatus, targetHref } from "@/lib/live";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Pill, Sk, useAuthed, useFmt, useRole } from "@/components/common";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const emTone = { disabled: "mute", pending: "info", sent: "ok", failed: "bad", blocked: "bad", uncertain: "warn", partial: "warn" } as const;

export function LiveBadge({ dark }: { dark?: boolean }) {
  const { t } = useI18n();
  const s = useLiveStatus();
  const dot = s === "live" ? "bg-[hsl(var(--ok))]" : s === "offline" ? "bg-destructive" : "bg-[hsl(var(--warn))]";
  return (
    <div title={t(`liveHint_${s}` as TKey)} data-testid="status-live" data-state={s}
      className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium", dark ? "border-sidebar-border text-sidebar-foreground/85" : "bg-card")}>
      <span className="relative flex h-2 w-2">
        {s === "live" && <span className={cn("absolute inset-0 animate-ping rounded-full opacity-60", dot)} />}
        <span className={cn("relative h-2 w-2 rounded-full", dot)} />
      </span>
      <Radio className="h-3 w-3 opacity-60" />{t(`live_${s}` as TKey)}
    </div>
  );
}

export function useNotifications() {
  const authed = useAuthed();
  const { canAlerts } = useRole();
  return useListNotifications({ query: { queryKey: getListNotificationsQueryKey(), enabled: authed && canAlerts } });
}

export function NotificationItem({ n, compact, onNavigate }: { n: Notification; compact?: boolean; onNavigate?: () => void }) {
  const { t } = useI18n();
  const fmt = useFmt();
  const qc = useQueryClient();
  const { toast } = useToast();
  const read = useReadNotification({ mutation: {
    onSuccess: () => qc.setQueryData<Notification[]>(getListNotificationsQueryKey(), (old) => old?.map((x) => (x.id === n.id ? { ...x, read: true } : x))),
    onError: (e) => toast({ title: t("error"), description: errorMessage(e, t), variant: "destructive" }),
  } });
  return (
    <div className={cn("relative flex gap-3 border-b px-3 py-3 last:border-0", !n.read && "bg-primary/[0.04]")} data-testid={`row-notification-${n.id}`}>
      <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.read ? "bg-border" : n.kind === "machine_status" ? "bg-destructive" : "bg-[hsl(32_95%_52%)]")} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t(`kind_${n.kind}` as TKey)}</span>
          <Pill tone={emTone[n.emailStatus]} testId={`status-email-${n.id}`}>{t(`em_${n.emailStatus}` as TKey)}</Pill>
        </div>
        <div className={cn("mt-0.5 text-sm", !n.read && "font-semibold")}>{n.title}</div>
        <p className={cn("text-xs text-muted-foreground", compact && "line-clamp-2")}>{n.message}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span className="num">{fmt(n.createdAt)}</span>{n.actorName && <span>{n.actorName}</span>}
          <Link href={targetHref(n)} onClick={() => { if (!n.read) read.mutate({ id: n.id }); onNavigate?.(); }} className="font-medium text-primary hover:underline" data-testid={`link-notification-${n.id}`}>{t("openTarget")}</Link>
          {!n.read && <button onClick={() => read.mutate({ id: n.id })} disabled={read.isPending} className="inline-flex items-center gap-1 font-medium hover:text-foreground" data-testid={`button-read-${n.id}`}><CheckCheck className="h-3 w-3" />{t("markRead")}</button>}
        </div>
      </div>
    </div>
  );
}

export function NotificationBell({ dark }: { dark?: boolean }) {
  const { t, nf } = useI18n();
  const [open, setOpen] = useState(false);
  const q = useNotifications();
  const unread = (q.data ?? []).filter((n) => !n.read).length;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button aria-label={t("notifCenter")} data-testid="button-notifications"
          className={cn("relative grid h-8 w-8 place-items-center rounded-md transition", dark ? "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-white" : "border bg-card hover:bg-secondary")}>
          <Bell className="h-4 w-4" />
          {unread > 0 && <span className="num absolute -end-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-[hsl(32_95%_52%)] px-1 text-[10px] font-bold text-[hsl(222_47%_11%)]" data-testid="text-unread-count">{nf(Math.min(unread, 99))}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,380px)] p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("notifCenter")}</span>
          <span className="text-[11px] text-muted-foreground">{unread ? `${nf(unread)} ${t("unread")}` : t("allRead")}</span>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {q.isError ? <p className="p-4 text-xs text-destructive">{errorMessage(q.error, t)}</p>
            : !q.data ? <div className="space-y-2 p-3"><Sk className="h-12" /><Sk className="h-12" /></div>
            : q.data.length === 0 ? <p className="p-6 text-center text-xs text-muted-foreground">{t("noNotifSub")}</p>
            : q.data.slice(0, 12).map((n) => <NotificationItem key={n.id} n={n} compact onNavigate={() => setOpen(false)} />)}
        </div>
        <Link href="/notifications" onClick={() => setOpen(false)} className="block border-t px-3 py-2 text-center text-xs font-medium text-primary hover:bg-secondary" data-testid="link-all-notifications">{t("viewAll")}</Link>
      </PopoverContent>
    </Popover>
  );
}
