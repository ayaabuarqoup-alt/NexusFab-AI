import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Mail, MailX, RotateCw } from "lucide-react";
import {
  useGetNotificationSettings, getGetNotificationSettingsQueryKey, useUpdateNotificationSettings,
  useListEmailDeliveries, getListEmailDeliveriesQueryKey, useRetryEmailDelivery, useListStaff, getListStaffQueryKey,
} from "@workspace/api-client-react";
import { useI18n, errorMessage, type TKey } from "@/lib/i18n";
import { Empty, ErrorState, PageHeader, Panel, Pill, Sk, btnCls, ghostCls, useFmt, useProtected, useRole } from "@/components/common";
import { NotificationItem, useNotifications } from "@/components/alerts";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const edTone = { pending: "info", sending: "info", sent: "ok", failed: "bad", blocked: "bad", uncertain: "warn", cancelled: "mute" } as const;

function EmailSettings() {
  const { t, nf } = useI18n();
  const qc = useQueryClient();
  const { toast } = useToast();
  const prot = useProtected();
  const st = useGetNotificationSettings({ query: { queryKey: getGetNotificationSettingsQueryKey(), ...prot } });
  const staff = useListStaff({ query: { queryKey: getListStaffQueryKey(), ...prot } });
  const [confirm, setConfirm] = useState(false);
  const upd = useUpdateNotificationSettings({ mutation: {
    onSuccess: (d) => { qc.setQueryData(getGetNotificationSettingsQueryKey(), d); qc.invalidateQueries({ queryKey: getGetNotificationSettingsQueryKey() }); toast({ title: t("settingsSaved") }); setConfirm(false); },
    onError: (e) => toast({ title: t("error"), description: errorMessage(e, t), variant: "destructive" }),
  } });
  const eligible = (staff.data ?? []).filter((m) => m.active && (m.roles?.length ? m.roles : [m.role]).some((r) => r === "owner" || r === "quality_inspector"));
  const withEmail = eligible.filter((m) => m.email?.trim());
  const missing = eligible.filter((m) => !m.email?.trim());
  if (st.isError) return <Panel title={t("emailSettings")}><ErrorState error={st.error} onRetry={() => st.refetch()} /></Panel>;
  if (!st.data) return <Panel title={t("emailSettings")}><Sk className="h-40" /></Panel>;
  const s = st.data;
  return (
    <Panel title={t("emailSettings")} right={s.enabled ? <Mail className="h-3.5 w-3.5 text-[hsl(var(--ok))]" /> : <MailX className="h-3.5 w-3.5 text-muted-foreground" />}>
      <div className="flex flex-wrap items-center gap-2"><Pill tone={s.enabled ? "ok" : "mute"} testId="status-email-enabled">{s.enabled ? t("emailOn") : t("emailOff")}</Pill>
        <span className="num text-sm font-semibold" data-testid="text-ready-recipients">{nf(s.readyRecipients)} / {nf(s.totalRecipients)}</span><span className="text-xs text-muted-foreground">{t("recipientsReady")}</span></div>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{t("emailExplain")}</p>
      {s.readyRecipients < s.totalRecipients && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-[hsl(var(--warn)/0.35)] bg-[hsl(var(--warn)/0.08)] p-2.5 text-xs" data-testid="text-missing-email">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--warn))]" />
          <span><span className="num font-semibold">{nf(s.totalRecipients - s.readyRecipients)}</span> {t("recipientsMissing")}{missing.length > 0 && <> ({missing.map((m) => m.name).join(", ")})</>}</span>
        </div>
      )}
      <div className="mt-4">
        {s.enabled
          ? <button onClick={() => upd.mutate({ data: { enabled: false } })} disabled={upd.isPending} className={ghostCls} data-testid="button-disable-email">{upd.isPending ? t("saving") : t("disableEmail")}</button>
          : <button onClick={() => setConfirm(true)} disabled={upd.isPending} className={btnCls} data-testid="button-enable-email"><Mail className="h-4 w-4" />{t("enableEmail")}</button>}
      </div>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("confirmEnableTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("confirmEnableBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="list-disc space-y-1 ps-5 text-sm"><li>{t("sendsIssue")}</li><li>{t("sendsMachine")}</li></ul>
          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("recipientsList")}</div>
            {!staff.data ? <Sk className="h-16" /> : withEmail.length === 0 ? <p className="text-xs text-destructive" data-testid="text-no-recipients">{t("noRecipients")}</p> : (
              <ul className="max-h-48 divide-y overflow-y-auto rounded-md border text-sm" data-testid="list-recipients">
                {withEmail.map((m) => <li key={m.id} className="flex justify-between gap-3 px-3 py-1.5"><span>{m.name}</span><span dir="ltr" className="num truncate text-xs text-muted-foreground">{m.email}</span></li>)}
              </ul>
            )}
            {missing.length > 0 && <p className="mt-2 text-[11px] text-[hsl(var(--warn))]">{nf(missing.length)} {t("recipientsMissing")}</p>}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-enable">{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); upd.mutate({ data: { enabled: true } }); }} disabled={upd.isPending} data-testid="button-confirm-enable">{upd.isPending ? t("saving") : t("confirmEnable")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Panel>
  );
}

function Deliveries() {
  const { t, nf } = useI18n();
  const fmt = useFmt();
  const qc = useQueryClient();
  const { toast } = useToast();
  const d = useListEmailDeliveries({ query: { queryKey: getListEmailDeliveriesQueryKey(), ...useProtected(), refetchInterval: 60_000 } });
  const retry = useRetryEmailDelivery({ mutation: {
    onSuccess: () => { qc.invalidateQueries({ queryKey: getListEmailDeliveriesQueryKey() }); toast({ title: t("retried") }); },
    onError: (e) => toast({ title: t("error"), description: errorMessage(e, t), variant: "destructive" }),
  } });
  return (
    <Panel title={t("deliveries")} className="[&>div]:p-0">
      {d.isError ? <div className="p-4"><ErrorState error={d.error} onRetry={() => d.refetch()} /></div>
        : !d.data ? <div className="space-y-2 p-4"><Sk className="h-12" /><Sk className="h-12" /></div>
        : d.data.length === 0 ? <div className="p-4"><Empty title={t("noDeliveries")} sub={t("noDeliveriesSub")} /></div>
        : d.data.map((x) => (
          <div key={x.id} className="grid gap-2 border-b px-4 py-3 last:border-0 md:grid-cols-[1.3fr_auto_1.5fr_auto] md:items-center" data-testid={`row-delivery-${x.id}`}>
            <div className="min-w-0"><div className="truncate text-sm font-medium">{x.recipientName}</div><div dir="ltr" className="num truncate text-[11px] text-muted-foreground rtl:text-end">{x.email}</div></div>
            <div className="flex items-center gap-2"><Pill tone={edTone[x.status]} testId={`status-delivery-${x.id}`}>{t(`ed_${x.status}` as TKey)}</Pill><span className="num text-[11px] text-muted-foreground">{t("attempts")}: {nf(x.attempts)}</span></div>
            <div className="min-w-0 text-xs">
              {x.lastError && <div className="break-words text-destructive" data-testid={`text-delivery-error-${x.id}`}>{t("lastError")}: {x.lastError}</div>}
              {x.status === "uncertain" && <div className="text-[hsl(var(--warn))]">{t("uncertainNote")}</div>}
              <div className="num text-[11px] text-muted-foreground">{fmt(x.updatedAt)}</div>
            </div>
            <div>{(x.status === "failed" || x.status === "blocked") && (
              <button onClick={() => retry.mutate({ id: x.id })} disabled={retry.isPending && retry.variables?.id === x.id} className={ghostCls} data-testid={`button-retry-delivery-${x.id}`}><RotateCw className="h-3.5 w-3.5" />{t("retry2")}</button>
            )}</div>
          </div>
        ))}
    </Panel>
  );
}

export default function Notifications() {
  const { t, nf } = useI18n();
  const { isOwner } = useRole();
  const q = useNotifications();
  const unread = (q.data ?? []).filter((n) => !n.read).length;
  return (
    <div className="space-y-6">
      <PageHeader title={t("notifTitle")} sub={t("notifSub")} />
      <div className={isOwner ? "grid gap-4 lg:grid-cols-[1.2fr_1fr]" : ""}>
        <Panel title={`${t("notifCenter")} · ${nf(unread)} ${t("unread")}`} className="[&>div]:p-0">
          {q.isError ? <div className="p-4"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>
            : !q.data ? <div className="space-y-2 p-4"><Sk className="h-16" /><Sk className="h-16" /></div>
            : q.data.length === 0 ? <div className="p-4"><Empty title={t("noNotif")} sub={t("noNotifSub")} /></div>
            : q.data.map((n) => <NotificationItem key={n.id} n={n} />)}
        </Panel>
        {isOwner && <div className="space-y-4"><EmailSettings /><Deliveries /></div>}
      </div>
    </div>
  );
}
