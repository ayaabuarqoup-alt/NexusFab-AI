import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, CheckCircle2, Factory, KeyRound, Lock } from "lucide-react";
import { useLogin, useActivateAccount, getGetSessionQueryKey } from "@workspace/api-client-react";
import { useI18n, errorMessage } from "@/lib/i18n";
import { LangToggle, usePageMeta } from "@/components/shell";
import { Field, inputCls, broadcastAuth } from "@/components/common";

function Activate({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const [token, setToken] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");
  const act = useActivateAccount({ mutation: { onSuccess: () => { setToken(""); setPw(""); setPw2(""); onDone(); } } });
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr("");
    const tk = token.trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(tk)) return setErr(t("tokenRule"));
    if (pw.length < 12) return setErr(t("pwMin"));
    if (pw !== pw2) return setErr(t("pwMismatch"));
    act.mutate({ data: { token: tk, password: pw } });
  };
  return (
    <form onSubmit={submit} className="mt-6 space-y-4" autoComplete="off">
      <Field label={t("token")}><input dir="ltr" className={`${inputCls} num text-xs`} value={token} onChange={(e) => setToken(e.target.value)} spellCheck={false} data-testid="input-token" /></Field>
      <span className="-mt-2 block text-[11px] text-muted-foreground">{t("tokenRule")}</span>
      <Field label={t("newPw")}><input type="password" className={inputCls} minLength={12} maxLength={256} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" data-testid="input-activate-password" /></Field>
      <Field label={t("confirmPw")}><input type="password" className={inputCls} maxLength={256} value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" data-testid="input-activate-confirm" /></Field>
      <span className="-mt-2 block text-[11px] text-muted-foreground">{t("pwMin")}</span>
      {(err || act.isError) && <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive" data-testid="text-activate-error">{err || errorMessage(act.error, t)}</div>}
      <button disabled={act.isPending} data-testid="button-activate" className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-medium text-primary-foreground shadow-md transition hover:brightness-110 disabled:opacity-70">
        {act.isPending ? t("activating") : t("activate")}<ArrowRight className="h-4 w-4 rtl:rotate-180" />
      </button>
    </form>
  );
}

export default function Login() {
  const { t } = useI18n();
  const qc = useQueryClient();
  usePageMeta(t("nav_login"));
  const [username, setU] = useState("");
  const [password, setP] = useState("");
  const [mode, setMode] = useState<"login" | "activate">("login");
  const [notice, setNotice] = useState<"" | "activated" | "pwChanged">(() => {
    try { const n = sessionStorage.getItem("nf-login-notice"); sessionStorage.removeItem("nf-login-notice"); return n === "pwChanged" ? "pwChanged" : ""; } catch { return ""; }
  });
  const login = useLogin({ mutation: { onSuccess: async (s) => {
    await qc.cancelQueries();
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== getGetSessionQueryKey()[0] });
    qc.setQueryData(getGetSessionQueryKey(), s);
    broadcastAuth();
  } } });
  const submit = (e: FormEvent) => { e.preventDefault(); if (username && password) login.mutate({ data: { username: username.trim(), password } }); };

  return (
    <div className="grid min-h-[100dvh] lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden overflow-hidden bg-sidebar p-12 text-sidebar-foreground lg:flex lg:flex-col">
        <div className="absolute inset-0 opacity-[0.08]" style={{ backgroundImage: "linear-gradient(#fff 1px,transparent 1px),linear-gradient(90deg,#fff 1px,transparent 1px)", backgroundSize: "40px 40px" }} />
        <div className="relative flex items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-md bg-sidebar-primary"><Factory className="h-5 w-5 text-white" /></div>
          <span className="text-lg font-semibold text-white">{t("appName")}</span>
        </div>
        <div className="relative mt-auto max-w-lg">
          <div className="rise mb-4 h-0.5 w-12 bg-[hsl(32_95%_52%)]" />
          <h2 className="rise rise-1 text-4xl font-semibold leading-tight tracking-tight text-white">{t("loginPitch")}</h2>
          <ul className="mt-8 space-y-3">
            {(["loginPoint1", "loginPoint2", "loginPoint3"] as const).map((k, i) => (
              <li key={k} className={`rise rise-${i + 2} flex items-start gap-3 text-sm`}>
                <span className="num mt-0.5 text-[11px] text-[hsl(32_95%_60%)]">0{i + 1}</span>{t(k)}
              </li>
            ))}
          </ul>
          <div className="rise rise-4 mt-12 grid grid-cols-3 gap-px overflow-hidden rounded-md border border-sidebar-border bg-sidebar-border">
            {["$5.00 / min", "$1.50 / unit", "900 s"].map((v, i) => (
              <div key={v} className="bg-sidebar px-4 py-3">
                <div className="num text-base font-semibold text-white">{v}</div>
                <div className="text-[10px] uppercase tracking-wider text-sidebar-foreground/55">{[t("downtime"), t("rejects"), t("nextRefresh")][i]}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid-bg flex flex-col bg-background px-5 py-6 md:px-12">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 lg:invisible"><Factory className="h-5 w-5 text-primary" /><span className="font-semibold">{t("appName")}</span></div>
          <LangToggle />
        </div>
        <div className="mx-auto my-auto w-full max-w-sm py-10">
          <div className="rise rounded-lg border bg-card p-7 shadow-lg">
            {mode === "activate" ? (<>
              <button type="button" onClick={() => setMode("login")} data-testid="button-back-login" className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5 rtl:rotate-180" />{t("backToLogin")}</button>
              <div className="mb-5 grid h-10 w-10 place-items-center rounded-md bg-[hsl(32_95%_52%/0.12)] text-[hsl(32_80%_40%)]"><KeyRound className="h-5 w-5" /></div>
              <h1 className="text-xl font-semibold tracking-tight">{t("activateTitle")}</h1>
              <p className="mt-1.5 text-sm text-muted-foreground">{t("activateSub")}</p>
              <Activate onDone={() => { setMode("login"); setNotice("activated"); }} />
            </>) : (<>
            {notice && <div className="mb-5 flex items-start gap-2 rounded-md border border-[hsl(var(--ok)/0.3)] bg-[hsl(var(--ok)/0.08)] px-3 py-2 text-xs text-[hsl(var(--ok))]" data-testid="text-login-notice"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />{t(notice)}</div>}
            <div className="mb-5 grid h-10 w-10 place-items-center rounded-md bg-primary/10 text-primary"><Lock className="h-5 w-5" /></div>
            <h1 className="text-xl font-semibold tracking-tight">{t("loginTitle")}</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">{t("loginSub")}</p>
            <form onSubmit={submit} className="mt-6 space-y-4">
              <Field label={t("username")}><input className={inputCls} value={username} onChange={(e) => setU(e.target.value)} autoComplete="username" required data-testid="input-username" /></Field>
              <Field label={t("password")}><input type="password" className={inputCls} value={password} onChange={(e) => setP(e.target.value)} autoComplete="current-password" required data-testid="input-password" /></Field>
              {login.isError && <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive" data-testid="text-login-error">{errorMessage(login.error, t)}</div>}
              <button disabled={login.isPending} data-testid="button-login" className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-medium text-primary-foreground shadow-md transition hover:brightness-110 disabled:opacity-70">
                {login.isPending ? t("signingIn") : t("signIn")}<ArrowRight className="h-4 w-4 rtl:rotate-180" />
              </button>
            </form>
            </>)}
          </div>
          {mode === "login" && <div className="rise rise-2 mt-5 rounded-md border bg-card/80 p-4">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"><KeyRound className="h-3.5 w-3.5" />{t("haveInvite")}</div>
            <p className="mt-1 text-xs text-muted-foreground">{t("activateSub")}</p>
            <button type="button" onClick={() => { setMode("activate"); setNotice(""); }} data-testid="button-show-activate" className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border text-sm font-medium transition hover:border-primary/40 hover:bg-primary/5">{t("activate")}</button>
          </div>}
        </div>
      </div>
    </div>
  );
}
