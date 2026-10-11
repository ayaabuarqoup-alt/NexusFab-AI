import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useListStaff, getListStaffQueryKey, useUpdateIssueEscalation, getListIssuesQueryKey, type Issue } from "@workspace/api-client-react";
import { useI18n, errorMessage } from "@/lib/i18n";
import { inputCls, useFmt, useRole, useProtected, ErrorState } from "@/components/common";

function localDate(value?: string | null) {
  if (!value) return "";
  const d = new Date(value);
  return new Date(+d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function EscalationEditor({ issue, close }: { issue: Issue; close: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const staff = useListStaff({ query: { queryKey: getListStaffQueryKey(), ...useProtected() } });
  const [assignedTo, setAssignedTo] = useState(issue.assignedTo ?? "");
  const [deadline, setDeadline] = useState(localDate(issue.escalationDeadline));
  const mutation = useUpdateIssueEscalation({ mutation: { onSuccess: () => {
    qc.invalidateQueries({ queryKey: getListIssuesQueryKey() }); close();
  } } });
  return <form className="mt-3 grid gap-2" onSubmit={e => {
    e.preventDefault();
    mutation.mutate({ id: issue.id, data: { assignedTo: assignedTo || null,
      escalationDeadline: deadline ? new Date(deadline).toISOString() : null } });
  }}>
    <label className="grid gap-1 text-xs">{t("assignedStaff")}
      <select className={inputCls} value={assignedTo} onChange={e => setAssignedTo(e.target.value)} data-testid={`select-assignee-${issue.id}`}>
        <option value="">{t("unassigned")}</option>
        {issue.assignedTo && !staff.data?.some(s => s.id === issue.assignedTo && s.active && s.activated) &&
          <option value={issue.assignedTo}>{issue.assignedToName}</option>}
        {staff.data?.filter(s => s.active && s.activated).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
    </label>
    {["high", "critical"].includes(issue.severity) && <label className="grid gap-1 text-xs">{t("escalationDeadline")}
      <input type="datetime-local" className={inputCls} value={deadline} onChange={e => setDeadline(e.target.value)} data-testid={`input-deadline-${issue.id}`} />
      <button type="button" className="text-start underline" onClick={() => setDeadline("")}>{t("escalationClear")}</button>
    </label>}
    <p className="text-xs text-muted-foreground">{t("escalationHelp")}</p>
    {staff.isError && <ErrorState error={staff.error} onRetry={() => staff.refetch()} />}
    {mutation.isError && <p role="alert" className="text-xs text-destructive">{errorMessage(mutation.error, t)}</p>}
    <div className="flex flex-wrap gap-2">
      <button disabled={mutation.isPending || !staff.data} className="rounded-md bg-primary px-3 py-2 text-xs text-primary-foreground disabled:opacity-50" data-testid={`button-save-escalation-${issue.id}`}>{t("escalationSave")}</button>
      <button type="button" disabled={mutation.isPending} className="rounded-md border px-3 py-2 text-xs" onClick={close}>{t("cancel")}</button>
    </div>
  </form>;
}
export function IssueEscalation({ issue }: { issue: Issue }) {
  const { t } = useI18n();
  const fmt = useFmt();
  const { isOwner } = useRole();
  const [editing, setEditing] = useState(false);
  const overdue = issue.status === "open" && issue.escalationDeadline && Date.parse(issue.escalationDeadline) <= Date.now();
  return <section className="mt-3 border-t pt-3" aria-label={t("escalationTitle")}>
    <p className="text-xs">{t("assignedStaff")}: <strong>{issue.assignedToName || t("unassigned")}</strong></p>
    <p className={`mt-1 text-xs ${overdue ? "text-destructive" : "text-muted-foreground"}`}>
      {issue.escalationDeadline ? `${t("escalationDeadline")}: ${fmt(issue.escalationDeadline)}` : t("escalationDisabled")}
      {overdue && ` · ${t("escalationOverdue")}`}
    </p>
    {isOwner && issue.status === "open" && (editing
      ? <EscalationEditor issue={issue} close={() => setEditing(false)} />
      : <button className="mt-2 rounded-md border px-3 py-1.5 text-xs" onClick={() => setEditing(true)} data-testid={`button-escalation-${issue.id}`}>{t("escalationEdit")}</button>)}
  </section>;
}
