import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useListMachineStates, getListMachineStatesQueryKey, useUpdateMachineStatus, getListNotificationsQueryKey, type MachineState, type MachineStatusInputStatus } from "@workspace/api-client-react";
import { useI18n, errorMessage, type TKey } from "@/lib/i18n";
import { Pill, inputCls, msTone, useFmt, useProtected, useRole, PermNote } from "@/components/common";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const OPTS: MachineStatusInputStatus[] = ["running", "stopped", "maintenance"];
const rail = { unknown: "bg-border", running: "bg-[hsl(var(--ok))]", stopped: "bg-destructive", maintenance: "bg-[hsl(var(--warn))]" };

export function useMachineStates() {
  return useListMachineStates({ query: { queryKey: getListMachineStatesQueryKey(), ...useProtected() } });
}

export function MachineStateCard({ m, editable = true }: { m: MachineState; editable?: boolean }) {
  const { t } = useI18n();
  const fmt = useFmt();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { canMachine } = useRole();
  const [status, setStatus] = useState<MachineStatusInputStatus>(m.status === "unknown" ? "running" : m.status);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const upd = useUpdateMachineStatus({ mutation: { onSuccess: () => {
    qc.invalidateQueries({ queryKey: getListMachineStatesQueryKey() }); qc.invalidateQueries({ queryKey: getListNotificationsQueryKey() });
    setNote(""); toast({ title: t("statusSaved") });
  } } });
  const save = () => {
    setErr("");
    if (status !== "running" && !note.trim()) return setErr(t("reasonRequired"));
    upd.mutate({ id: m.id, data: { status, note: note.trim().slice(0, 1000) } });
  };
  return (
    <div className="rise relative overflow-hidden rounded-md border bg-card p-4 ps-5 shadow-sm" data-testid={`card-machine-state-${m.id}`}>
      <span className={cn("absolute inset-y-0 start-0 w-1.5", rail[m.status])} />
      <div className="flex items-start justify-between gap-2">
        <div><div className="num text-[11px] text-muted-foreground">{m.id.toUpperCase()}</div><div className="font-medium">{m.name}</div></div>
        <Pill tone={msTone[m.status]} testId={`status-machine-${m.id}`}>{t(`ms_${m.status}` as TKey)}</Pill>
      </div>
      {m.note && <p className="mt-2 rounded bg-secondary/60 px-2 py-1.5 text-xs" data-testid={`text-machine-note-${m.id}`}>{m.note}</p>}
      <div className="mt-2 text-[11px] text-muted-foreground">
        {m.updatedBy ? <>{t("reportedBy")}: <span className="font-medium text-foreground">{m.updatedBy}</span> · <span className="num">{fmt(m.updatedAt)}</span></> : t("neverReported")}
      </div>
      {editable && (canMachine ? (
        <div className="mt-3 grid gap-2 border-t pt-3">
          <div role="radiogroup" className="grid grid-cols-3 gap-1">
            {OPTS.map((o) => (
              <button key={o} type="button" role="radio" aria-checked={status === o} onClick={() => { setStatus(o); setErr(""); }} data-testid={`button-ms-${m.id}-${o}`}
                className={cn("h-8 rounded-md border text-[11px] font-medium transition", status === o ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:border-primary/40")}>{t(`ms_${o}` as TKey)}</button>
            ))}
          </div>
          <input className={inputCls} maxLength={1000} placeholder={t("statusReason")} aria-label={t("statusReason")} value={note} onChange={(e) => setNote(e.target.value)} data-testid={`input-ms-note-${m.id}`} />
          {(err || upd.isError) && <p className="text-xs text-destructive" data-testid={`text-ms-error-${m.id}`}>{err || errorMessage(upd.error, t)}</p>}
          <button onClick={save} disabled={upd.isPending} className="h-8 rounded-md bg-sidebar text-xs font-medium text-white transition hover:brightness-125 disabled:opacity-60" data-testid={`button-ms-save-${m.id}`}>{upd.isPending ? t("saving") : t("setStatus")}</button>
        </div>
      ) : <div className="mt-3"><PermNote>{t("permMachine")}</PermNote></div>)}
    </div>
  );
}
