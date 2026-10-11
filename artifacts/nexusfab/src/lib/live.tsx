import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { getGetSessionQueryKey, getListNotificationsQueryKey, listNotifications, type Notification } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { useI18n } from "@/lib/i18n";

export type LiveStatus = "connecting" | "live" | "reconnecting" | "offline";
const Ctx = createContext<LiveStatus>("offline");
export const useLiveStatus = () => useContext(Ctx);

export function targetHref(n: Pick<Notification, "kind" | "targetId">) {
  return n.kind === "machine_status" ? "/machines" : `/issues#${n.targetId}`;
}

/** One native EventSource per mounted Shell (Shell is keyed by tenant::user::role, so identity changes remount it). */
export function LiveProvider({ alerts, children }: { alerts: boolean; children: ReactNode }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { t } = useI18n();
  const [, nav] = useLocation();
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const ctx = useRef({ toast, t, nav, alerts });
  ctx.current = { toast, t, nav, alerts };

  useEffect(() => {
    const seen = new Set<string>();
    let opened = false;
    let closed = false;
    const sessionKey = getGetSessionQueryKey()[0];
    const refreshData = () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== sessionKey });
    const es = new EventSource(`${import.meta.env.BASE_URL}api/events`, { withCredentials: true });
    es.onopen = () => {
      if (opened) refreshData(); // reconnect: catch up silently, no backlog toasts
      opened = true;
      setStatus("live");
    };
    es.onerror = () => { if (closed) return; setStatus(es.readyState === EventSource.CLOSED ? "offline" : "reconnecting"); };
    es.onmessage = async (ev) => {
      let msg: { type?: string; notificationId?: string };
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === "refresh") refreshData();
      else if (msg.type === "session") {
        closed = true; es.close(); setStatus("offline");
        qc.invalidateQueries({ queryKey: getGetSessionQueryKey() });
      } else if (msg.type === "alert" && msg.notificationId) {
        const { alerts: canAlert } = ctx.current;
        if (!canAlert) return;
        const id = msg.notificationId;
        if (seen.has(id)) return;
        seen.add(id);
        try {
          await qc.invalidateQueries({ queryKey: getListNotificationsQueryKey() });
          const list = await qc.fetchQuery({ queryKey: getListNotificationsQueryKey(), queryFn: () => listNotifications(), staleTime: 0 });
          const n = list.find((x) => x.id === id);
          if (!n || closed) return;
          const { toast: show, t: tr, nav: go } = ctx.current;
          show({
            title: n.title, description: `${n.message}${n.actorName ? ` · ${n.actorName}` : ""}`,
            variant: n.kind === "machine_status" || /critical/i.test(n.title) ? "destructive" : "default",
            action: <ToastAction altText={tr("openTarget")} onClick={() => go(targetHref(n))} data-testid={`toast-open-${n.id}`}>{tr("openTarget")}</ToastAction>,
          });
        } catch { /* in-app list still refreshes on next fetch */ }
      }
    };
    return () => { closed = true; es.close(); };
  }, [qc]);

  return <Ctx.Provider value={status}>{children}</Ctx.Provider>;
}
