import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Fingerprint, KeyRound, Loader2, ShieldCheck, Trash2 } from "lucide-react";
import { startAuthentication, startRegistration, browserSupportsWebAuthn, type PublicKeyCredentialCreationOptionsJSON, type PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import {
  useListPasskeys, getListPasskeysQueryKey, usePasskeyRegistrationOptions, useVerifyPasskeyRegistration, useDeletePasskey,
  usePasskeyLoginOptions, useVerifyPasskeyLogin, getListAuditQueryKey, type WebAuthnPayload,
} from "@workspace/api-client-react";
import { useI18n, errorMessage } from "@/lib/i18n";
import { Empty, ErrorState, Field, Panel, Sk, inputCls, btnCls, ghostCls, updateSession, useAuthed } from "@/components/common";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

function useL() { const { lang } = useI18n(); return (en: string, ar: string) => (lang === "ar" ? ar : en); }
const embedded = () => { try { return window.self !== window.top; } catch { return true; } };

export function passkeySupport(): "" | "insecure" | "unsupported" {
  if (typeof window === "undefined") return "unsupported";
  if (!window.isSecureContext) return "insecure";
  if (!browserSupportsWebAuthn()) return "unsupported";
  return "";
}

type PkErr = { msg: string; openTab: boolean };
function useDescribe() {
  const L = useL();
  const { t } = useI18n();
  return (e: unknown): PkErr => {
    const er = e as { name?: string; code?: string; cause?: { name?: string }; data?: { code?: string } };
    const code = er?.data?.code;
    const map: Record<string, [string, string]> = {
      PASSKEY_INVALID: ["This passkey could not be verified. Try again or use your password.", "تعذر التحقق من مفتاح المرور. حاول مجدداً أو استخدم كلمة المرور."],
      PASSKEY_CHALLENGE_EXPIRED: ["The passkey request expired. Start again.", "انتهت صلاحية طلب مفتاح المرور. ابدأ من جديد."],
      PASSKEY_ORIGIN_REQUIRED: ["This address cannot use passkeys. Passkeys are tied to the exact hostname (development and published apps differ).", "لا يمكن لهذا العنوان استخدام مفاتيح المرور. ترتبط المفاتيح باسم المضيف بالضبط (بيئة التطوير تختلف عن المنشور)."],
      INVALID_CREDENTIALS: ["Current password is incorrect, or this passkey is not recognised here.", "كلمة المرور الحالية غير صحيحة، أو مفتاح المرور غير معروف هنا."],
      PASSKEY_LIMIT: ["Passkey limit reached. Remove one before adding another.", "بلغت الحد الأقصى لمفاتيح المرور. احذف واحداً أولاً."],
      PASSKEY_UNAVAILABLE: ["Passkeys are unavailable for this account right now.", "مفاتيح المرور غير متاحة لهذا الحساب حالياً."],
    };
    if (code && map[code]) return { msg: L(...map[code]), openTab: false };
    const name = er?.cause?.name || er?.name || "";
    if (name === "NotAllowedError" || name === "SecurityError" || name === "AbortError" || er?.code === "ERROR_CEREMONY_ABORTED" || er?.code === "ERROR_INVALID_DOMAIN") {
      const inFrame = embedded();
      return {
        msg: L(
          `The passkey prompt was cancelled, timed out or blocked by the browser.${inFrame ? " Embedded previews often block passkeys — open the app in its own tab and try again." : ""}`,
          `أُلغيت نافذة مفتاح المرور أو انتهت مهلتها أو حظرها المتصفح.${inFrame ? " غالباً تحظر المعاينات المضمنة مفاتيح المرور — افتح التطبيق في علامة تبويب مستقلة وحاول مجدداً." : ""}`),
        openTab: inFrame || name === "SecurityError",
      };
    }
    if (name === "InvalidStateError") return { msg: L("This device already holds a passkey for your account.", "هذا الجهاز يحمل مفتاح مرور لحسابك بالفعل."), openTab: false };
    return { msg: errorMessage(e, t), openTab: false };
  };
}

function OpenTab({ testId }: { testId: string }) {
  const L = useL();
  return <button type="button" onClick={() => window.open(window.location.href, "_blank", "noopener")} className={`${ghostCls} mt-2`} data-testid={testId}><ExternalLink className="h-3.5 w-3.5" />{L("Open app in a new tab", "افتح التطبيق في علامة تبويب جديدة")}</button>;
}

function SupportNote({ reason }: { reason: "insecure" | "unsupported" }) {
  const L = useL();
  return <p className="rounded-md border border-dashed bg-secondary/40 px-3 py-2 text-[11px] text-muted-foreground" data-testid="text-passkey-unsupported">
    {reason === "insecure" ? L("Passkeys need a secure (HTTPS) connection. Use your password here.", "تتطلب مفاتيح المرور اتصالاً آمناً (HTTPS). استخدم كلمة المرور هنا.") : L("This browser does not support passkeys. Use your password.", "هذا المتصفح لا يدعم مفاتيح المرور. استخدم كلمة المرور.")}
  </p>;
}

/** Login: discoverable credential, no username. Role selection still follows via Gate. */
export function PasskeySignIn() {
  const L = useL();
  const qc = useQueryClient();
  const describe = useDescribe();
  const support = passkeySupport();
  const opts = usePasskeyLoginOptions();
  const verify = useVerifyPasskeyLogin();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<PkErr | null>(null);
  const go = async () => {
    setErr(null); setBusy(true);
    try {
      const options = await opts.mutateAsync();
      const response = await startAuthentication({ optionsJSON: options as unknown as PublicKeyCredentialRequestOptionsJSON });
      const session = await verify.mutateAsync({ data: response as unknown as WebAuthnPayload });
      await updateSession(qc, session);
    } catch (e) { setErr(describe(e)); } finally { setBusy(false); }
  };
  return (
    <div className="mt-4 space-y-2" data-testid="panel-passkey-login">
      <div className="flex items-center gap-3 text-[10px] uppercase tracking-wider text-muted-foreground"><span className="h-px flex-1 bg-border" />{L("or", "أو")}<span className="h-px flex-1 bg-border" /></div>
      {support ? <SupportNote reason={support} /> : <>
        <button type="button" onClick={go} disabled={busy} data-testid="button-passkey-login" className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-primary/40 bg-primary/5 text-sm font-medium text-primary transition hover:bg-primary/10 disabled:opacity-60">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Fingerprint className="h-4 w-4" />}{busy ? L("Waiting for your device…", "بانتظار جهازك…") : L("Sign in with passkey", "الدخول بمفتاح المرور")}
        </button>
        <p className="text-[11px] leading-relaxed text-muted-foreground">{L("No username needed. Your device may ask for Face ID, Touch ID, fingerprint or its PIN — that check stays on the device and is never sent to us. Password sign-in above always works.", "لا حاجة لاسم المستخدم. قد يطلب جهازك Face ID أو Touch ID أو البصمة أو رمز PIN — يبقى التحقق على الجهاز ولا يُرسل إلينا. تسجيل الدخول بكلمة المرور أعلاه متاح دائماً.")}</p>
      </>}
      {err && <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive" data-testid="text-passkey-login-error">{err.msg}{err.openTab && <div><OpenTab testId="button-passkey-login-newtab" /></div>}</div>}
    </div>
  );
}

/** Account: list / enroll / remove own passkeys. */
export function PasskeyPanel({ demo }: { demo: boolean }) {
  const L = useL();
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const { toast } = useToast();
  const authed = useAuthed();
  const describe = useDescribe();
  const support = passkeySupport();
  const list = useListPasskeys({ query: { queryKey: getListPasskeysQueryKey(), enabled: authed && !demo } });
  const regOpts = usePasskeyRegistrationOptions();
  const verify = useVerifyPasskeyRegistration();
  const del = useDeletePasskey({ mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getListPasskeysQueryKey() }); qc.invalidateQueries({ queryKey: getListAuditQueryKey() }); toast({ title: L("Passkey removed", "حُذف مفتاح المرور") }); setConfirm(null); } } });
  const [pw, setPw] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<PkErr | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; name: string } | null>(null);
  const fmt = (iso: string | null) => { if (!iso) return L("never", "أبداً"); const d = new Date(iso); return isNaN(d.getTime()) ? iso : d.toLocaleString(lang === "ar" ? "ar-EG" : "en-US", { dateStyle: "medium", timeStyle: "short" }); };

  const enroll = async (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    const nm = name.trim();
    if (!pw || !nm) return setErr({ msg: t("required"), openTab: false });
    const password = pw;
    setPw(""); // clear promptly; only held for this request
    setBusy(true);
    try {
      const payload = await regOpts.mutateAsync({ data: { password, name: nm.slice(0, 80) } });
      const response = await startRegistration({ optionsJSON: payload as unknown as PublicKeyCredentialCreationOptionsJSON });
      await verify.mutateAsync({ data: response as unknown as WebAuthnPayload });
      qc.invalidateQueries({ queryKey: getListPasskeysQueryKey() }); qc.invalidateQueries({ queryKey: getListAuditQueryKey() });
      setName(""); toast({ title: L("Passkey added", "أُضيف مفتاح المرور") });
    } catch (e2) { setErr(describe(e2)); } finally { setBusy(false); }
  };

  return (
    <Panel title={L("Passkeys", "مفاتيح المرور")} right={<ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" />}>
      <p className="mb-3 text-xs text-muted-foreground">{L("Sign in without typing your password. Your device may verify you with Face ID, Touch ID, fingerprint or device PIN; that check never leaves the device. Passkeys work only on this exact hostname — development and published addresses need separate passkeys. Your password stays as a fallback.", "سجّل الدخول دون كتابة كلمة المرور. قد يتحقق جهازك عبر Face ID أو Touch ID أو البصمة أو رمز PIN، ولا يغادر هذا التحقق الجهاز. تعمل المفاتيح على اسم المضيف هذا فقط — عناوين التطوير والنشر تحتاج مفاتيح منفصلة. تبقى كلمة المرور بديلاً.")}</p>
      {demo ? <p className="text-xs text-muted-foreground" data-testid="text-passkey-demo">{t("err_DEMO_ACCOUNT")}</p> : <>
        {list.isError ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : !list.data ? <Sk className="h-14" /> : list.data.length === 0
          ? <Empty title={L("No passkeys yet", "لا مفاتيح مرور بعد")} sub={L("Add one for this device below.", "أضف واحداً لهذا الجهاز أدناه.")} />
          : <ul className="-mx-1 divide-y rounded-md border" data-testid="list-passkeys">{list.data.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-3 py-2.5" data-testid={`row-passkey-${p.id}`}>
              <KeyRound className="h-4 w-4 shrink-0 text-primary" />
              <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{p.name}</div>
                <div className="num text-[10px] text-muted-foreground">{L("added", "أضيف")} {fmt(p.createdAt)} · {L("last used", "آخر استخدام")} {fmt(p.lastUsedAt)} · <span dir="ltr">{p.rpId}</span></div></div>
              <button type="button" onClick={() => setConfirm({ id: p.id, name: p.name })} className={`${ghostCls} text-destructive`} aria-label={L("Remove", "حذف")} data-testid={`button-delete-passkey-${p.id}`}><Trash2 className="h-3.5 w-3.5" /></button>
            </li>))}</ul>}
        <form onSubmit={enroll} className="mt-4 grid gap-3 border-t pt-4" autoComplete="off">
          {support ? <SupportNote reason={support} /> : <fieldset disabled={busy} className="grid gap-3">
            <Field label={L("Passkey name", "اسم المفتاح")}><input className={inputCls} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder={L("e.g. Shift laptop", "مثال: حاسوب الوردية")} data-testid="input-passkey-name" /></Field>
            <Field label={t("currentPw")}><input type="password" autoComplete="current-password" maxLength={256} className={inputCls} value={pw} onChange={(e) => setPw(e.target.value)} data-testid="input-passkey-password" /></Field>
            <button className={btnCls} data-testid="button-add-passkey">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Fingerprint className="h-4 w-4" />}{busy ? L("Follow your device prompt…", "اتبع تعليمات جهازك…") : L("Add passkey on this device", "إضافة مفتاح مرور على هذا الجهاز")}</button>
          </fieldset>}
          {err && <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive" data-testid="text-passkey-error">{err.msg}{err.openTab && <div><OpenTab testId="button-passkey-newtab" /></div>}</div>}
        </form>
      </>}
      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{L("Remove passkey?", "حذف مفتاح المرور؟")}</AlertDialogTitle>
            <AlertDialogDescription>{confirm?.name} — {L("this device will no longer sign you in. Your password still works.", "لن يتمكن هذا الجهاز من تسجيل دخولك. كلمة المرور تبقى صالحة.")}</AlertDialogDescription>
          </AlertDialogHeader>
          {del.isError && <p className="text-xs text-destructive">{errorMessage(del.error, t)}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); if (confirm) del.mutate({ id: confirm.id }); }} disabled={del.isPending} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" data-testid="button-confirm-delete-passkey">{del.isPending ? t("saving") : L("Remove", "حذف")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Panel>
  );
}
