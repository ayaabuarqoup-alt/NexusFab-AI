import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Factory, Lock, ShieldCheck } from "lucide-react";
import { useLogin, getGetSessionQueryKey } from "@workspace/api-client-react";
import { useI18n, errorMessage } from "@/lib/i18n";
import { LangToggle, usePageMeta } from "@/components/shell";
import { Field, inputCls, broadcastAuth } from "@/components/common";

const demos = [
  { u: "factory_carton", p: "password123", label: "Carton & Printing" },
  { u: "factory_plastics", p: "secure456", label: "Plastics & Packaging" },
];

export default function Login() {
  const { t } = useI18n();
  const qc = useQueryClient();
  usePageMeta(t("nav_login"));
  const [username, setU] = useState("");
  const [password, setP] = useState("");
  const login = useLogin({ mutation: { onSuccess: (s) => { qc.clear(); qc.setQueryData(getGetSessionQueryKey(), s); broadcastAuth(); } } });
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
          </div>
          <div className="rise rise-2 mt-5 rounded-md border bg-card/80 p-4">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5" />{t("demoAccess")}</div>
            <p className="mt-1 text-xs text-muted-foreground">{t("demoNote")}</p>
            <div className="mt-3 grid gap-2">
              {demos.map((d) => (
                <button key={d.u} type="button" onClick={() => { setU(d.u); setP(d.p); }} data-testid={`button-demo-${d.u}`}
                  className="flex items-center justify-between rounded-md border px-3 py-2 text-start transition hover:border-primary/40 hover:bg-primary/5">
                  <span><span className="num block text-xs font-medium">{d.u}</span><span className="text-[11px] text-muted-foreground">{d.label}</span></span>
                  <span className="num text-[11px] text-muted-foreground">{d.p}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
