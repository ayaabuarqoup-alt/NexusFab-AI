import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Copy, KeyRound, Pencil, RotateCcw, ShieldAlert, UserCircle, UserPlus, X } from "lucide-react";
import { Link } from "wouter";
import {
  useChangePassword, useListStaff, getListStaffQueryKey, useInviteStaff, useUpdateStaff, useResetStaffPassword,
  useUpdateProfile, getListAuditQueryKey, getGetSessionQueryKey, getGetNotificationSettingsQueryKey, type Invitation, type StaffMember, type StaffInputRole, type StaffMemberRolesItem,
} from "@workspace/api-client-react";
import { useI18n, errorMessage, type TKey } from "@/lib/i18n";
import { Empty, ErrorState, Field, PageHeader, Panel, Pill, Sk, inputCls, useAuthed, useRole, broadcastAuth, PermNote } from "@/components/common";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const ROLES: StaffInputRole[] = ["owner", "operator", "quality_inspector"];
type R = StaffMemberRolesItem;
const ordered = (rs: R[]) => ROLES.filter((r) => rs.includes(r));
const grantsOf = (m: StaffMember): R[] => (m.roles?.length ? ordered(m.roles) : [m.role]);

function RolePicker({ value, onChange, testId }: { value: R[]; onChange: (v: R[]) => void; testId: string }) {
  const { t } = useI18n();
  return (
    <div role="group" className="flex flex-wrap gap-1.5" data-testid={testId}>
      {ROLES.map((r) => {
        const on = value.includes(r);
        return (
          <button key={r} type="button" aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== r) : ordered([...value, r]))}
            data-testid={`${testId}-${r}`}
            className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition ${on ? "border-primary bg-primary/10 text-primary" : "bg-card text-muted-foreground hover:border-primary/40"}`}>
            <span className={`grid h-3.5 w-3.5 place-items-center rounded-sm border ${on ? "border-primary bg-primary text-primary-foreground" : "border-input"}`}>{on && <Check className="h-2.5 w-2.5" />}</span>
            {t(`role_${r}` as TKey)}
          </button>
        );
      })}
    </div>
  );
}

function GrantList({ roles }: { roles: R[] }) {
  const { t } = useI18n();
  return <div className="flex flex-wrap gap-1">{roles.map((r) => <span key={r} className="rounded-sm border bg-secondary/60 px-1.5 py-0.5 text-[11px] font-medium">{t(`role_${r}` as TKey)}</span>)}</div>;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function EmailWarn({ testId }: { testId: string }) {
  const { t } = useI18n();
  return <span className="inline-flex items-center gap-1 text-[11px] text-[hsl(var(--warn))]" data-testid={testId}><AlertTriangle className="h-3 w-3 shrink-0" />{t("emailMissing")}</span>;
}

function ProfilePanel() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { session, demo } = useRole();
  const [f, setF] = useState({ name: session?.userName ?? "", email: session?.email ?? "" });
  const [err, setErr] = useState("");
  const upd = useUpdateProfile({ mutation: { onSuccess: (s) => {
    qc.setQueryData(getGetSessionQueryKey(), s); qc.invalidateQueries({ queryKey: getListStaffQueryKey() }); qc.invalidateQueries({ queryKey: getGetNotificationSettingsQueryKey() });
    setF({ name: s.userName ?? f.name, email: s.email ?? "" }); toast({ title: t("profileSaved") });
  } } });
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr("");
    const name = f.name.trim(), email = f.email.trim();
    if (!name) return setErr(t("required"));
    if (email && !EMAIL_RE.test(email)) return setErr(t("emailRule"));
    upd.mutate({ data: { name: name.slice(0, 100), email: email.slice(0, 254) } });
  };
  return (
    <Panel title={t("profileTitle")} right={<UserCircle className="h-3.5 w-3.5 text-muted-foreground" />}>
      <p className="mb-4 text-xs text-muted-foreground">{t("profileSub")}</p>
      <form onSubmit={submit} className="grid gap-3">
        <fieldset disabled={demo || upd.isPending} className="grid gap-3">
          <Field label={t("fullName")}><input className={inputCls} maxLength={100} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="input-profile-name" /></Field>
          <Field label={t("email")}><input type="email" dir="ltr" className={`${inputCls} num`} maxLength={254} placeholder={t("emailPh")} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} data-testid="input-profile-email" /></Field>
          {!f.email.trim() && <EmailWarn testId="text-profile-email-warning" />}
        </fieldset>
        {(err || upd.isError) && <p className="text-xs text-destructive" data-testid="text-profile-error">{err || errorMessage(upd.error, t)}</p>}
        <button disabled={demo || upd.isPending} className={btn} data-testid="button-save-profile">{upd.isPending ? t("saving") : t("saveProfile")}</button>
      </form>
    </Panel>
  );
}

const btn = "inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:brightness-110 disabled:opacity-60";
const ghost = "inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1.5 text-xs font-medium transition hover:bg-secondary disabled:opacity-50";

function useFmt() {
  const { lang } = useI18n();
  return (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? iso : d.toLocaleString(lang === "ar" ? "ar-EG" : "en-US", { dateStyle: "medium", timeStyle: "short" }); };
}

function PasswordPanel({ demo }: { demo: boolean }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [f, setF] = useState({ cur: "", pw: "", pw2: "" });
  const [err, setErr] = useState("");
  const change = useChangePassword({ mutation: { onSuccess: async () => {
    await qc.cancelQueries();
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== getGetSessionQueryKey()[0] });
    try { sessionStorage.setItem("nf-login-notice", "pwChanged"); } catch { /* ignore */ }
    qc.setQueryData(getGetSessionQueryKey(), { authenticated: false, factory: "", factoryName: "" });
    broadcastAuth();
  } } });
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr("");
    if (!f.cur || !f.pw) return setErr(t("required"));
    if (f.pw.length < 12) return setErr(t("pwMin"));
    if (f.pw !== f.pw2) return setErr(t("pwMismatch"));
    change.mutate({ data: { currentPassword: f.cur, password: f.pw } });
  };
  return (
    <Panel title={t("pwTitle")} right={<KeyRound className="h-3.5 w-3.5 text-muted-foreground" />}>
      <p className="mb-4 text-xs text-muted-foreground">{t("pwSub")}</p>
      <form onSubmit={submit} className="grid gap-3">
        <fieldset disabled={demo || change.isPending} className="grid gap-3">
          <Field label={t("currentPw")}><input type="password" autoComplete="current-password" maxLength={256} className={inputCls} value={f.cur} onChange={(e) => setF({ ...f, cur: e.target.value })} data-testid="input-current-password" /></Field>
          <Field label={t("newPw")}><input type="password" autoComplete="new-password" minLength={12} maxLength={256} className={inputCls} value={f.pw} onChange={(e) => setF({ ...f, pw: e.target.value })} data-testid="input-new-password" /></Field>
          <span className="-mt-1.5 text-[11px] text-muted-foreground">{t("pwMin")}</span>
          <Field label={t("confirmPw")}><input type="password" autoComplete="new-password" maxLength={256} className={inputCls} value={f.pw2} onChange={(e) => setF({ ...f, pw2: e.target.value })} data-testid="input-confirm-password" /></Field>
        </fieldset>
        {(err || change.isError) && <p className="text-xs text-destructive" data-testid="text-password-error">{err || errorMessage(change.error, t)}</p>}
        <button disabled={demo || change.isPending} className={btn} data-testid="button-change-password">{change.isPending ? t("pwSaving") : t("pwSave")}</button>
      </form>
    </Panel>
  );
}

function TokenReveal({ inv, who, onClose }: { inv: Invitation; who: string; onClose: () => void }) {
  const { t } = useI18n();
  const fmt = useFmt();
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(inv.token); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* ignore */ } };
  return (
    <div className="rise rounded-md border border-[hsl(32_95%_52%/0.45)] bg-[hsl(32_95%_52%/0.07)] p-4" data-testid="panel-token">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[hsl(32_80%_38%)]">{t("tokenTitle")} · {who}</div>
          <p className="mt-1 text-xs text-muted-foreground">{t("tokenBody")}</p>
        </div>
        <button onClick={onClose} aria-label={t("dismiss")} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
      </div>
      <div className="mt-3 flex items-stretch gap-2">
        <code dir="ltr" className="num flex-1 break-all rounded-md border bg-card px-3 py-2 text-xs" data-testid="text-token">{inv.token}</code>
        <button onClick={copy} className={ghost} data-testid="button-copy-token">{copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{copied ? t("copied") : t("copy")}</button>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs">{t("expires")}: <span className="num font-medium" data-testid="text-token-expiry">{fmt(inv.expiresAt)}</span></span>
        <button onClick={onClose} className={ghost} data-testid="button-dismiss-token">{t("dismiss")}</button>
      </div>
    </div>
  );
}

function InviteForm({ onIssued }: { onIssued: (inv: Invitation, who: string) => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [f, setF] = useState<{ username: string; name: string; email: string; roles: R[] }>({ username: "", name: "", email: "", roles: ["operator"] });
  const [err, setErr] = useState("");
  const invite = useInviteStaff({ mutation: { onSuccess: (inv, v) => {
    qc.invalidateQueries({ queryKey: getListStaffQueryKey() }); qc.invalidateQueries({ queryKey: getListAuditQueryKey() });
    onIssued(inv, v.data.username); setF({ username: "", name: "", email: "", roles: ["operator"] });
  } } });
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr("");
    const username = f.username.trim().toLowerCase();
    if (!username || !f.name.trim()) return setErr(t("required"));
    if (!/^[a-z0-9_.@-]{3,100}$/.test(username)) return setErr(t("usernameRule"));
    if (f.roles.length === 0) return setErr(t("rolesRule"));
    const email = f.email.trim();
    if (email && !EMAIL_RE.test(email)) return setErr(t("emailRule"));
    const roles = ordered(f.roles);
    invite.mutate({ data: { username, name: f.name.trim().slice(0, 100), role: roles[0] as StaffInputRole, roles, email } });
  };
  return (
    <form onSubmit={submit} className="grid gap-3 border-b bg-secondary/30 p-4 md:grid-cols-[1fr_1fr_1.2fr] md:items-end xl:grid-cols-[1fr_1fr_1.2fr_auto_auto]">
      <Field label={t("staffUsername")}><input dir="ltr" className={`${inputCls} num`} value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} placeholder="a.haddad" data-testid="input-invite-username" /></Field>
      <Field label={t("fullName")}><input className={inputCls} maxLength={100} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="input-invite-name" /></Field>
      <Field label={t("email")}><input type="email" dir="ltr" className={`${inputCls} num`} maxLength={254} placeholder={t("emailPh")} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} data-testid="input-invite-email" /></Field>
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("rolesGranted")}</span>
        <RolePicker value={f.roles} onChange={(roles) => setF({ ...f, roles })} testId="picker-invite-roles" />
      </div>
      <button disabled={invite.isPending} className={btn} data-testid="button-invite"><UserPlus className="h-4 w-4" />{invite.isPending ? t("inviting") : t("invite")}</button>
      <span className="text-[11px] text-muted-foreground md:col-span-3 xl:col-span-5">{t("usernameRule")}{!f.email.trim() && <> · <span className="text-[hsl(var(--warn))]">{t("emailMissing")}</span></>}</span>
      {(err || invite.isError) && <p className="text-xs text-destructive md:col-span-3 xl:col-span-5" data-testid="text-invite-error">{err || errorMessage(invite.error, t)}</p>}
    </form>
  );
}

function StaffRow({ m, self, onIssued }: { m: StaffMember; self: boolean; onIssued: (inv: Invitation, who: string) => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [roles, setRoles] = useState<R[]>(grantsOf(m));
  const [rowErr, setRowErr] = useState("");
  const [active, setActive] = useState(m.active);
  const [prof, setProf] = useState({ name: m.name, username: m.username, email: m.email ?? "" });
  const [confirm, setConfirm] = useState(false);
  const refresh = () => { qc.invalidateQueries({ queryKey: getListStaffQueryKey() }); qc.invalidateQueries({ queryKey: getListAuditQueryKey() }); };
  const update = useUpdateStaff({ mutation: { onSuccess: () => { refresh(); setEditing(false); toast({ title: t("staffSaved") }); } } });
  const reset = useResetStaffPassword({ mutation: {
    onSuccess: (inv) => { refresh(); onIssued(inv, m.username); },
    onError: (e) => toast({ title: t("error"), description: errorMessage(e, t), variant: "destructive" }),
  } });
  const initials = m.name.split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
  return (
    <div className="grid gap-3 border-b px-4 py-3 last:border-0 md:grid-cols-[1.5fr_1fr_1.2fr_auto] md:items-center" data-testid={`row-staff-${m.id}`}>
      <div className="flex min-w-0 items-center gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-primary/10 text-xs font-semibold text-primary">{initials || "?"}</div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 truncate font-medium">{m.name}{self && <span className="rounded-sm bg-[hsl(32_95%_52%/0.15)] px-1.5 text-[10px] font-semibold uppercase text-[hsl(32_80%_38%)]">{t("you")}</span>}</div>
          <div dir="ltr" className="num truncate text-[11px] text-muted-foreground rtl:text-end">{m.username}</div>
          {m.email ? <div dir="ltr" className="num truncate text-[11px] text-muted-foreground rtl:text-end" data-testid={`text-email-${m.id}`}>{m.email}</div> : <EmailWarn testId={`text-email-warning-${m.id}`} />}
        </div>
      </div>
      <div>
        {editing ? (
          <div className="grid gap-2">
          <RolePicker value={roles} onChange={(v) => { setRoles(v); setRowErr(""); }} testId={`picker-roles-${m.id}`} />
          <input className={`${inputCls} h-8`} maxLength={100} aria-label={t("fullName")} placeholder={t("fullName")} value={prof.name} onChange={(e) => setProf({ ...prof, name: e.target.value })} data-testid={`input-edit-name-${m.id}`} />
          <input dir="ltr" className={`${inputCls} num h-8`} aria-label={t("usernameLbl")} placeholder={t("usernameLbl")} value={prof.username} onChange={(e) => setProf({ ...prof, username: e.target.value })} data-testid={`input-edit-username-${m.id}`} />
          <input type="email" dir="ltr" className={`${inputCls} num h-8`} maxLength={254} aria-label={t("email")} placeholder={t("emailPh")} value={prof.email} onChange={(e) => setProf({ ...prof, email: e.target.value })} data-testid={`input-edit-email-${m.id}`} />
          </div>
        ) : <GrantList roles={grantsOf(m)} />}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {editing ? (
          <label className="inline-flex items-center gap-2 text-xs"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4 accent-[hsl(var(--primary))]" data-testid={`checkbox-active-${m.id}`} />{t("activeLbl")}</label>
        ) : (
          <>
            <Pill tone={m.active ? "ok" : "mute"}>{m.active ? t("st_active") : t("st_disabled")}</Pill>
            <Pill tone={m.activated ? "info" : "warn"}>{m.activated ? t("st_activated") : t("st_pendingAct")}</Pill>
          </>
        )}
      </div>
      <div className="flex flex-col items-start gap-1 md:items-end">
        {self ? <span className="max-w-[200px] text-[11px] text-muted-foreground md:text-end">{t("selfNote")} {t("ownGrantsNote")}</span> : editing ? (
          <div className="flex gap-1.5">
            <button onClick={() => { setEditing(false); setRoles(grantsOf(m)); setRowErr(""); setActive(m.active); setProf({ name: m.name, username: m.username, email: m.email ?? "" }); update.reset(); }} className={ghost} data-testid={`button-cancel-${m.id}`}>{t("cancel")}</button>
            <button onClick={() => {
              if (!roles.length) return setRowErr(t("rolesRule"));
              const name = prof.name.trim(), username = prof.username.trim().toLowerCase(), email = prof.email.trim();
              if (!name) return setRowErr(t("required"));
              if (!/^[a-z0-9_.@-]{3,100}$/.test(username)) return setRowErr(t("usernameRule"));
              if (email && !EMAIL_RE.test(email)) return setRowErr(t("emailRule"));
              const rs = ordered(roles);
              update.mutate({ id: m.id, data: { role: rs[0], active, roles: rs, email, name: name.slice(0, 100), username } });
            }} disabled={update.isPending} className={`${ghost} border-primary bg-primary text-primary-foreground hover:bg-primary hover:brightness-110`} data-testid={`button-save-${m.id}`}>{update.isPending ? t("saving") : t("save")}</button>
          </div>
        ) : (
          <div className="flex gap-1.5">
            <button onClick={() => { setRoles(grantsOf(m)); setRowErr(""); setActive(m.active); setProf({ name: m.name, username: m.username, email: m.email ?? "" }); setEditing(true); }} className={ghost} data-testid={`button-edit-${m.id}`}><Pencil className="h-3.5 w-3.5" />{t("edit")}</button>
            <button onClick={() => setConfirm(true)} disabled={reset.isPending} className={`${ghost} text-destructive hover:bg-destructive/5`} data-testid={`button-reset-${m.id}`}><RotateCcw className="h-3.5 w-3.5" />{t("resetInv")}</button>
          </div>
        )}
        {(rowErr || update.isError) && <span className="text-[11px] text-destructive" data-testid={`text-row-error-${m.id}`}>{rowErr || errorMessage(update.error, t)}</span>}
      </div>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("resetConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{m.name} ({m.username}). {t("resetConfirmBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => reset.mutate({ id: m.id })} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" data-testid={`button-confirm-reset-${m.id}`}>{t("resetConfirm")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StaffPanel({ selfId }: { selfId?: string }) {
  const { t } = useI18n();
  const authed = useAuthed();
  const staff = useListStaff({ query: { queryKey: getListStaffQueryKey(), enabled: authed, refetchInterval: 30_000 } });
  const [issued, setIssued] = useState<{ inv: Invitation; who: string } | null>(null);
  const onIssued = (inv: Invitation, who: string) => setIssued({ inv, who });
  return (
    <Panel title={t("staffTitle")} className="[&>div]:p-0">
      <p className="px-4 pt-3 text-xs text-muted-foreground">{t("staffSub")}</p>
      {issued && <div className="p-4 pb-0"><TokenReveal inv={issued.inv} who={issued.who} onClose={() => setIssued(null)} /></div>}
      <div className="mt-3"><InviteForm onIssued={onIssued} /></div>
      {staff.isError ? <div className="p-4"><ErrorState error={staff.error} onRetry={() => staff.refetch()} /></div>
        : !staff.data ? <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Sk key={i} className="h-12" />)}</div>
        : staff.data.length === 0 ? <div className="p-4"><Empty title={t("noStaff")} sub={t("noStaffSub")} /></div>
        : staff.data.map((m) => <StaffRow key={`${m.id}-${grantsOf(m).join(",")}-${m.active}-${m.email ?? ""}-${m.name}-${m.username}`} m={m} self={m.id === selfId} onIssued={onIssued} />)}
    </Panel>
  );
}

export default function Account() {
  const { t } = useI18n();
  const { session, role, demo, isOwner } = useRole();
  return (
    <div className="space-y-6">
      <PageHeader title={t("acctTitle")} sub={t("acctSub")} />
      <div className="rise flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border bg-card px-4 py-3 text-sm" data-testid="panel-identity">
        <span><span className="text-[11px] uppercase tracking-wider text-muted-foreground">{t("signedInAs")} </span><span className="font-medium">{session?.userName || session?.factoryName}</span></span>
        <span><span className="text-[11px] uppercase tracking-wider text-muted-foreground">{t("activeRoleLbl")} </span><span className="font-medium" data-testid="text-active-role">{t(role ? (`role_${role}` as TKey) : "role_none")}</span></span>
        {!!session?.availableRoles?.length && <span className="flex items-center gap-2" data-testid="text-granted-roles"><span className="text-[11px] uppercase tracking-wider text-muted-foreground">{t("rolesGranted")}</span><GrantList roles={ordered(session.availableRoles)} /></span>}
        <span><span className="text-[11px] uppercase tracking-wider text-muted-foreground">{t("email")} </span>{session?.email ? <span dir="ltr" className="num" data-testid="text-session-email">{session.email}</span> : <EmailWarn testId="text-session-email-warning" />}</span>
        <span><span className="text-[11px] uppercase tracking-wider text-muted-foreground">{t("userIdLbl")} </span><span dir="ltr" className="num">{session?.userId || "demo"}</span></span>
      </div>
      {demo && (
        <div className="rise flex items-start gap-3 rounded-md border border-[hsl(var(--warn)/0.35)] bg-[hsl(var(--warn)/0.08)] p-4" data-testid="panel-demo-limit">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-[hsl(var(--warn))]" />
          <div><div className="text-sm font-semibold">{t("demoTitle")}</div><p className="mt-1 text-xs text-muted-foreground">{t("demoBody")}</p></div>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        <div className="space-y-4"><ProfilePanel /><PasswordPanel demo={demo} /></div>
        {isOwner && !demo ? <StaffPanel selfId={session?.userId} /> : (
          <Panel title={t("staffTitle")}><PermNote>{demo ? t("err_DEMO_ACCOUNT") : t("ownerOnly")}</PermNote></Panel>
        )}
      </div>
      {isOwner && <Link href="/audit" className="rise inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline" data-testid="link-account-audit">{t("nav_audit")} →</Link>}
    </div>
  );
}
