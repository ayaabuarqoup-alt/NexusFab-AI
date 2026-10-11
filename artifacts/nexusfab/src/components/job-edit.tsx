import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Pencil, Truck } from "lucide-react";
import { useUpdateJob, useUpdateShipping, getListJobsQueryKey, getGetSummaryQueryKey, type Job, type ShippingInputStatus } from "@workspace/api-client-react";
import { useI18n, errorMessage, type TKey } from "@/lib/i18n";
import { Field, inputCls, btnCls, ghostCls, MACHINE_IDS, useRole } from "@/components/common";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const SHIP: ShippingInputStatus[] = ["pending", "ready", "shipped", "delivered"];

export function EditJobButton({ job, hasLogs }: { job: Job; hasLogs: boolean }) {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: job.name, machineId: job.machineId, target: String(job.target), startDate: job.startDate, dueDate: job.dueDate, startTime: job.startTime });
  const [err, setErr] = useState("");
  const upd = useUpdateJob({ mutation: { onSuccess: () => {
    qc.invalidateQueries({ queryKey: getListJobsQueryKey() }); qc.invalidateQueries({ queryKey: getGetSummaryQueryKey() });
    toast({ title: t("jobUpdated") }); setOpen(false);
  } } });
  const locked = job.status === "dispatched";
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const openIt = () => { setF({ name: job.name, machineId: job.machineId, target: String(job.target), startDate: job.startDate, dueDate: job.dueDate, startTime: job.startTime }); setErr(""); upd.reset(); setOpen(true); };
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr("");
    const target = Number(f.target);
    if (!f.name.trim() || !f.machineId) return setErr(t("required"));
    if (!Number.isFinite(target) || target < 1) return setErr(t("mustBePositive"));
    upd.mutate({ id: job.id, data: { name: f.name.trim().slice(0, 120), machineId: f.machineId, target: Math.round(target), startDate: f.startDate, dueDate: f.dueDate, startTime: f.startTime } });
  };
  return (
    <>
      <button onClick={openIt} disabled={locked} title={locked ? t("jobLocked") : undefined} className={ghostCls} data-testid={`button-edit-job-${job.id}`}><Pencil className="h-3.5 w-3.5" />{t("editJob")}</button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-md">
          <DialogHeader><DialogTitle>{t("editJob")}</DialogTitle><DialogDescription className="num">{job.id}</DialogDescription></DialogHeader>
          <form onSubmit={submit} className="grid gap-3">
            <Field label={t("jobName")}><input className={inputCls} maxLength={120} value={f.name} onChange={set("name")} data-testid="input-edit-job-name" /></Field>
            <Field label={t("machine")}>
              <select className={inputCls} value={f.machineId} onChange={set("machineId")} disabled={hasLogs} data-testid="select-edit-machine">
                {MACHINE_IDS.map((m) => <option key={m} value={m}>{m.toUpperCase()}</option>)}
              </select>
            </Field>
            {hasLogs && <span className="-mt-1.5 text-[11px] text-[hsl(var(--warn))]">{t("machineLocked")}</span>}
            <Field label={t("target")}><input type="number" min={1} className={`${inputCls} num`} value={f.target} onChange={set("target")} data-testid="input-edit-target" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("startDate")}><input type="date" lang={lang} className={inputCls} value={f.startDate} onChange={set("startDate")} required data-testid="input-edit-start-date" /></Field>
              <Field label={t("dueDate")}><input type="date" lang={lang} className={inputCls} min={f.startDate} value={f.dueDate} onChange={set("dueDate")} required data-testid="input-edit-due-date" /></Field>
            </div>
            <Field label={t("startTime")}><input type="time" lang={lang} className={inputCls} value={f.startTime} onChange={set("startTime")} required data-testid="input-edit-start-time" /></Field>
            {(err || upd.isError) && <p className="text-xs text-destructive" data-testid="text-edit-job-error">{err || errorMessage(upd.error, t)}</p>}
            <button disabled={upd.isPending} className={btnCls} data-testid="button-save-job">{upd.isPending ? t("saving") : t("saveJob")}</button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ShippingControl({ job, pendingQc }: { job: Job; pendingQc: number }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { canShip } = useRole();
  const cur = job.shippingStatus ?? (job.status === "dispatched" ? "shipped" : "pending");
  const [open, setOpen] = useState(false);
  const [next, setNext] = useState<ShippingInputStatus>(cur);
  const [note, setNote] = useState("");
  const upd = useUpdateShipping({ mutation: { onSuccess: () => {
    qc.invalidateQueries({ queryKey: getListJobsQueryKey() }); toast({ title: t("shippingUpdated") }); setOpen(false); setNote("");
  } } });
  const readyOk = job.goodQty >= job.target && pendingQc === 0;
  const dispatched = job.status === "dispatched";
  const blocked = (s: ShippingInputStatus) => (s === "ready" && !readyOk) || ((s === "shipped" || s === "delivered") && !dispatched);
  const idx = SHIP.indexOf(cur);
  return (
    <div className="flex flex-col items-start gap-1.5 md:items-end">
      <div className="flex items-center gap-1" aria-label={t("shipping")} data-testid={`status-shipping-${job.id}`}>
        {SHIP.map((s, i) => <span key={s} title={t(`ship_${s}` as TKey)} className={cn("h-1.5 w-5 rounded-full", i <= idx ? "bg-[hsl(32_95%_52%)]" : "bg-secondary")} />)}
        <span className="ms-1.5 text-[11px] font-medium">{t(`ship_${cur}` as TKey)}</span>
      </div>
      {canShip && <button onClick={() => { setNext(cur); upd.reset(); setOpen(true); }} className={ghostCls} data-testid={`button-shipping-${job.id}`}><Truck className="h-3.5 w-3.5 rtl:-scale-x-100" />{t("updateShipping")}</button>}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{t("shipping")} · {job.name}</DialogTitle><DialogDescription>{t("shipGateReady")} {t("shipGateDispatch")}</DialogDescription></DialogHeader>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {SHIP.map((s) => (
              <button key={s} type="button" disabled={blocked(s)} onClick={() => setNext(s)} aria-pressed={next === s} data-testid={`button-ship-${s}`}
                className={cn("h-10 rounded-md border text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40", next === s ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:border-primary/40")}>{t(`ship_${s}` as TKey)}</button>
            ))}
          </div>
          {!readyOk && <p className="text-[11px] text-[hsl(var(--warn))]">{t("shipGateReady")}</p>}
          {!dispatched && <p className="text-[11px] text-[hsl(var(--warn))]">{t("shipGateDispatch")}</p>}
          <textarea rows={2} maxLength={1000} placeholder={t("shipNote")} aria-label={t("shipNote")} className={`${inputCls} h-auto py-2`} value={note} onChange={(e) => setNote(e.target.value)} data-testid="input-ship-note" />
          {upd.isError && <p className="text-xs text-destructive" data-testid="text-ship-error">{errorMessage(upd.error, t)}</p>}
          <button onClick={() => upd.mutate({ id: job.id, data: { status: next, ...(note.trim() ? { note: note.trim() } : {}) } })} disabled={upd.isPending || next === cur} className={btnCls} data-testid="button-save-shipping">{upd.isPending ? t("saving") : t("updateShipping")}</button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
