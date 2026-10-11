import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { enX, arX } from "./i18n-account";
import { enY, arY } from "./i18n-ops";
import { enZ, arZ } from "./i18n-roles";
import { enP, arP } from "./i18n-plan";

export type Lang = "en" | "ar";

const en = {
  ...enX,
  appName: "⚡ NexusFab AI™", tagline: "Manufacturing operating system",
  loginTitle: "Sign in to your factory vault", loginSub: "Each factory operates in an isolated data vault. Your logs and metrics are never visible to another tenant.",
  username: "Staff username", password: "Password", signIn: "Sign in", signingIn: "Verifying credentials",
  demoAccess: "Demo access", demoNote: "Sample factories with seeded sample data. Click to fill.",
  loginPitch: "One reliable view of production, leakage and quality.",
  loginPoint1: "Financial leakage computed from every stoppage and reject",
  loginPoint2: "Quality gate enforced before any dispatch",
  loginPoint3: "Heuristic machine fatigue indicators per asset",
  nav_dashboard: "Overview", nav_jobs: "Jobs & dispatch", nav_production: "Operator logs", nav_quality: "Quality review", nav_machines: "Machine health", nav_copilot: "Analyst copilot",
  signOut: "Sign out", nextRefresh: "Next auto-refresh", minRemaining: "min remaining", refreshNow: "Refresh now", refreshing: "Refreshing", lastSync: "Last sync",
  sampleData: "Sample data", tenant: "Tenant",
  goodQty: "Good Qty", rejects: "Rejects", downtime: "Stoppages", downtimeMin: "Downtime (min)", financialLeak: "Financial leakage", activeJobs: "Active jobs", pendingQuality: "Pending QC", yield: "Yield", units: "Units", minutes: "min",
  leakFormula: "(Downtime min x $5.00) + (Rejects x $1.50)",
  overviewTitle: "Production overview", overviewSub: "Consolidated metrics for the active factory vault.",
  ratioChart: "Good-to-reject volumetric ratio", staffChart: "Downtime duration by staff", dailyChart: "Daily output",
  noData: "No data recorded yet", noDataSub: "Record operator logs to populate this view.",
  machinesTitle: "Machine health", machinesSub: "Heuristic fatigue indicators derived from logged stoppages and reject volatility.",
  fatigue: "Fatigue score", risk_stable: "Stable", risk_caution: "Critical caution", risk_high: "High risk",
  rec_stable: "Continue standard maintenance cadence.", rec_caution: "Schedule an inspection at the next shift change and review reject causes.", rec_high: "Plan a stoppage for inspection; review lubrication, tooling wear and operator reports.",
  fatigueNote: "Heuristic, not validated predictive maintenance: score = downtime hours x 8 + reject-rate standard deviation x 100, capped at 100. Caution at 35, high risk at 70.",
  jobsTitle: "Jobs & dispatch", jobsSub: "Plan jobs per machine and release them once the target is met and every batch is approved.",
  newJob: "New job", jobName: "Job name", machine: "Machine", target: "Target (units)", startDate: "Start date", dueDate: "Due date", startTime: "Start time",
  createJob: "Create job", creating: "Creating", dispatch: "Dispatch", dispatching: "Dispatching", progress: "Progress", status: "Status", due: "Due",
  st_planned: "Planned", st_running: "Running", st_completed: "Completed", st_dispatched: "Dispatched",
  dispatchBlockedTarget: "Target not met", dispatchBlockedQc: "Batches awaiting approval", dispatchRule: "Dispatch requires target met and all batches approved.",
  noJobs: "No jobs yet", noJobsSub: "Create the first job to start logging production.",
  prodTitle: "Operator logs", prodSub: "Record output, rejects and stoppages per shift entry.",
  newLog: "New log entry", job: "Job", staff: "Staff / operator", date: "Date", time: "Time", reason: "Stoppage reason", submitLog: "Submit log", submitting: "Submitting",
  noLogs: "No logs recorded", noLogsSub: "Operator entries will appear here.", selectJob: "Select a job", needJob: "Create a job before logging production.",
  qualityTitle: "Quality review", qualitySub: "Approve or reject each batch. Decisions are final and gate dispatch.",
  pending: "Pending", approved: "Approved", rejected: "Rejected", approve: "Approve", reject: "Reject", note: "Inspector note", notePh: "Required: describe the inspection result",
  qc_pending: "Pending", qc_approved: "Approved", qc_rejected: "Rejected", decided: "Decision recorded", noPending: "No batches awaiting review", noPendingSub: "All logged batches have a decision.", history: "Decision history",
  copilotTitle: "Analyst copilot", copilotSub: "Ask about root causes, leakage and quality in your factory data.",
  simulatedBadge: "Simulated analyst", simulatedNote: "Deterministic local analysis of this factory's records only. Not an external language model; it does not answer beyond your data.",
  askPh: "e.g. What is driving financial leakage this week?", ask: "Ask", thinking: "Analysing records", sources: "records analysed", suggestions: "Suggested questions",
  sq1: "What is driving financial leakage?", sq2: "Which staff member has the most downtime?", sq3: "Which machine is at highest risk?", sq4: "How is our yield trending?",
  emptyChat: "Ask a question to analyse your production records.",
  error: "Something went wrong", retry: "Retry", language: "Language", cancel: "Cancel", required: "Required field", mustBePositive: "Must be a valid number",
  created: "Saved", jobCreated: "Job created", logCreated: "Log recorded", dispatched: "Job dispatched", reviewSaved: "Decision recorded",
  err_INVALID_CREDENTIALS: "Invalid username or password.", err_UNAUTHORIZED: "Your session has expired. Please sign in again.", err_VALIDATION_ERROR: "Some fields are invalid.", err_NOT_FOUND: "Record not found.",
  err_TARGET_NOT_MET: "Target quantity has not been met.", err_QC_PENDING: "All batches must be approved before dispatch.", err_ALREADY_REVIEWED: "This batch already has a decision.", err_ALREADY_DISPATCHED: "This job was already dispatched.", err_NETWORK: "Network error. Check your connection.", err_UNKNOWN: "Unexpected error.", err_INVALID_INPUT: "Some fields are invalid.", err_INVALID_DATE: "Invalid date or time.", err_EMPTY_LOG: "Enter good quantity, rejects or downtime.", err_REASON_REQUIRED: "A stoppage reason is required when downtime is logged.", err_QUALITY_REQUIRED: "Quality decision and note are required.", err_RATE_LIMITED: "Too many attempts. Please wait and try again.", err_FORBIDDEN: "You do not have access to this record.", err_SERVER_ERROR: "Server error. Please try again.", err_ROLE_SELECTION_REQUIRED: "Choose your working role before continuing.", err_ROLE_NOT_GRANTED: "That role has not been approved for your account.", srEyebrow: "Shift check-in", srTitle: "Which role are you working today?", srSub: "Your account holds the roles below, approved by the factory Admin. Pick the one you are working as — the console only acts with that role until you sign in again.", srEnter: "Enter as", srEntering: "Entering…", srNone: "No roles are approved for this account yet. Ask the factory owner to approve one.", srSignedIn: "Signed in", rolesGranted: "Approved roles", rolesRule: "Approve at least one role.", activeRoleLbl: "Active role", role_owner_d: "Reports, staff approvals, dispatch, audit and alerts.", role_operator_d: "Create jobs and log production.", role_quality_inspector_d: "Review batches and record quality decisions.",
  metaDesc: "NexusFab AI: one reliable view of production, financial leakage and quality for your factory.", nav_login: "Sign in",
  notFound: "Page not found", backHome: "Back to overview",
  ...enY,
  ...enZ,
  ...enP,
};
type Dict = typeof en;
const ar: Dict = {
  ...arX,
  appName: "⚡ نكسس فاب AI™", tagline: "نظام تشغيل التصنيع",
  loginTitle: "تسجيل الدخول إلى خزنة المصنع", loginSub: "يعمل كل مصنع في خزنة بيانات معزولة. سجلاتك ومؤشراتك لا تظهر لأي مستأجر آخر.",
  username: "اسم مستخدم الموظف", password: "كلمة المرور", signIn: "تسجيل الدخول", signingIn: "جارٍ التحقق",
  demoAccess: "دخول تجريبي", demoNote: "مصانع نموذجية ببيانات عينة. انقر للتعبئة.",
  loginPitch: "رؤية واحدة موثوقة للإنتاج والتسرب والجودة.",
  loginPoint1: "حساب التسرب المالي من كل توقف ومرفوض", loginPoint2: "بوابة جودة إلزامية قبل أي شحن", loginPoint3: "مؤشرات إجهاد تقديرية لكل آلة",
  nav_dashboard: "نظرة عامة", nav_jobs: "الأوامر والشحن", nav_production: "سجلات المشغلين", nav_quality: "مراجعة الجودة", nav_machines: "صحة الآلات", nav_copilot: "المحلل المساعد",
  signOut: "تسجيل الخروج", nextRefresh: "التحديث التلقائي التالي", minRemaining: "دقيقة متبقية", refreshNow: "تحديث الآن", refreshing: "جارٍ التحديث", lastSync: "آخر مزامنة",
  sampleData: "بيانات عينة", tenant: "المستأجر",
  goodQty: "الكمية السليمة", rejects: "المرفوضات", downtime: "التوقفات", downtimeMin: "التوقف (دقيقة)", financialLeak: "التسرب المالي", activeJobs: "الأوامر النشطة", pendingQuality: "بانتظار الجودة", yield: "العائد", units: "وحدة", minutes: "دقيقة",
  leakFormula: "(دقائق التوقف × 5.00$) + (المرفوضات × 1.50$)",
  overviewTitle: "نظرة عامة على الإنتاج", overviewSub: "مؤشرات موحدة لخزنة المصنع النشطة.",
  ratioChart: "نسبة السليم إلى المرفوض", staffChart: "مدة التوقف حسب الموظف", dailyChart: "الإنتاج اليومي",
  noData: "لا توجد بيانات بعد", noDataSub: "سجّل إدخالات المشغلين لملء هذه الشاشة.",
  machinesTitle: "صحة الآلات", machinesSub: "مؤشرات إجهاد تقديرية مستمدة من التوقفات وتذبذب المرفوضات.",
  fatigue: "درجة الإجهاد", risk_stable: "مستقرة", risk_caution: "تحذير حرج", risk_high: "خطر مرتفع",
  rec_stable: "استمر في جدول الصيانة المعتاد.", rec_caution: "جدول فحصاً عند تبديل الوردية وراجع أسباب الرفض.", rec_high: "خطط لتوقف للفحص؛ راجع التزييت وتآكل الأدوات وتقارير المشغلين.",
  fatigueNote: "تقدير استدلالي وليس صيانة تنبؤية معتمدة: الدرجة = ساعات التوقف × 8 + الانحراف المعياري لنسبة الرفض × 100، بحد أقصى 100. تحذير عند 35، خطر مرتفع عند 70.",
  jobsTitle: "الأوامر والشحن", jobsSub: "خطط الأوامر لكل آلة وأطلقها عند بلوغ الهدف واعتماد كل الدفعات.",
  newJob: "أمر جديد", jobName: "اسم الأمر", machine: "الآلة", target: "الهدف (وحدات)", startDate: "تاريخ البدء", dueDate: "تاريخ الاستحقاق", startTime: "وقت البدء",
  createJob: "إنشاء الأمر", creating: "جارٍ الإنشاء", dispatch: "شحن", dispatching: "جارٍ الشحن", progress: "التقدم", status: "الحالة", due: "الاستحقاق",
  st_planned: "مخطط", st_running: "قيد التشغيل", st_completed: "مكتمل", st_dispatched: "تم الشحن",
  dispatchBlockedTarget: "لم يتحقق الهدف", dispatchBlockedQc: "دفعات بانتظار الاعتماد", dispatchRule: "يتطلب الشحن بلوغ الهدف واعتماد جميع الدفعات.",
  noJobs: "لا توجد أوامر", noJobsSub: "أنشئ أول أمر لبدء تسجيل الإنتاج.",
  prodTitle: "سجلات المشغلين", prodSub: "سجّل الإنتاج والمرفوضات والتوقفات لكل إدخال.",
  newLog: "إدخال جديد", job: "الأمر", staff: "الموظف / المشغل", date: "التاريخ", time: "الوقت", reason: "سبب التوقف", submitLog: "إرسال السجل", submitting: "جارٍ الإرسال",
  noLogs: "لا توجد سجلات", noLogsSub: "ستظهر إدخالات المشغلين هنا.", selectJob: "اختر أمراً", needJob: "أنشئ أمراً قبل تسجيل الإنتاج.",
  qualityTitle: "مراجعة الجودة", qualitySub: "اعتمد أو ارفض كل دفعة. القرارات نهائية وتتحكم في الشحن.",
  pending: "معلّق", approved: "معتمد", rejected: "مرفوض", approve: "اعتماد", reject: "رفض", note: "ملاحظة المفتش", notePh: "مطلوب: صف نتيجة الفحص",
  qc_pending: "معلّق", qc_approved: "معتمد", qc_rejected: "مرفوض", decided: "تم تسجيل القرار", noPending: "لا دفعات بانتظار المراجعة", noPendingSub: "جميع الدفعات لها قرار.", history: "سجل القرارات",
  copilotTitle: "المحلل المساعد", copilotSub: "اسأل عن الأسباب الجذرية والتسرب والجودة في بيانات مصنعك.",
  simulatedBadge: "محلل محاكى", simulatedNote: "تحليل محلي حتمي لسجلات هذا المصنع فقط. ليس نموذجاً لغوياً خارجياً ولا يجيب خارج بياناتك.",
  askPh: "مثال: ما سبب التسرب المالي هذا الأسبوع؟", ask: "اسأل", thinking: "جارٍ تحليل السجلات", sources: "سجلات محللة", suggestions: "أسئلة مقترحة",
  sq1: "ما سبب التسرب المالي؟", sq2: "أي موظف لديه أكبر توقف؟", sq3: "أي آلة في أعلى خطر؟", sq4: "كيف يتجه العائد؟",
  emptyChat: "اطرح سؤالاً لتحليل سجلات الإنتاج.",
  error: "حدث خطأ", retry: "إعادة المحاولة", language: "اللغة", cancel: "إلغاء", required: "حقل مطلوب", mustBePositive: "يجب أن يكون رقماً صالحاً",
  created: "تم الحفظ", jobCreated: "تم إنشاء الأمر", logCreated: "تم تسجيل الإدخال", dispatched: "تم شحن الأمر", reviewSaved: "تم تسجيل القرار",
  err_INVALID_CREDENTIALS: "اسم المستخدم أو كلمة المرور غير صحيحة.", err_UNAUTHORIZED: "انتهت الجلسة. يرجى تسجيل الدخول مجدداً.", err_VALIDATION_ERROR: "بعض الحقول غير صالحة.", err_NOT_FOUND: "السجل غير موجود.",
  err_TARGET_NOT_MET: "لم تتحقق الكمية المستهدفة.", err_QC_PENDING: "يجب اعتماد جميع الدفعات قبل الشحن.", err_ALREADY_REVIEWED: "هذه الدفعة لها قرار بالفعل.", err_ALREADY_DISPATCHED: "تم شحن هذا الأمر مسبقاً.", err_NETWORK: "خطأ في الشبكة. تحقق من الاتصال.", err_UNKNOWN: "خطأ غير متوقع.", err_INVALID_INPUT: "بعض الحقول غير صالحة.", err_INVALID_DATE: "تاريخ أو وقت غير صالح.", err_EMPTY_LOG: "أدخل الكمية السليمة أو المرفوضات أو التوقف.", err_REASON_REQUIRED: "سبب التوقف مطلوب عند تسجيل توقف.", err_QUALITY_REQUIRED: "قرار الجودة والملاحظة مطلوبان.", err_RATE_LIMITED: "محاولات كثيرة. يرجى الانتظار ثم المحاولة.", err_FORBIDDEN: "ليست لديك صلاحية الوصول لهذا السجل.", err_SERVER_ERROR: "خطأ في الخادم. يرجى المحاولة مجدداً.", err_ROLE_SELECTION_REQUIRED: "اختر دور العمل قبل المتابعة.", err_ROLE_NOT_GRANTED: "هذا الدور غير معتمد لحسابك.", srEyebrow: "بدء الوردية", srTitle: "بأي دور تعمل اليوم؟", srSub: "يحمل حسابك الأدوار التالية المعتمدة من مدير المصنع. اختر الدور الذي تعمل به — تعمل المنصة بهذا الدور فقط حتى تسجيل الدخول مجدداً.", srEnter: "الدخول بصفة", srEntering: "جارٍ الدخول…", srNone: "لا توجد أدوار معتمدة لهذا الحساب بعد. اطلب من مدير المصنع اعتماد دور.", srSignedIn: "تم تسجيل الدخول", rolesGranted: "الأدوار المعتمدة", rolesRule: "اعتمد دوراً واحداً على الأقل.", activeRoleLbl: "الدور النشط", role_owner_d: "التقارير واعتماد الموظفين والشحن والتدقيق والتنبيهات.", role_operator_d: "إنشاء الأوامر وتسجيل الإنتاج.", role_quality_inspector_d: "مراجعة الدفعات وتسجيل قرارات الجودة.",
  metaDesc: "نكسس فاب AI: رؤية واحدة موثوقة للإنتاج والتسرب المالي والجودة لمصنعك.", nav_login: "تسجيل الدخول",
  notFound: "الصفحة غير موجودة", backHome: "العودة للنظرة العامة",
  ...arY,
  ...arZ,
  ...arP,
};
export type TKey = keyof Dict;
const dicts = { en, ar };

const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void; t: (k: TKey) => string; nf: (n: number, d?: number) => string; cf: (n: number) => string } | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem("nf-lang") === "ar" ? "ar" : "en"));
  useEffect(() => {
    localStorage.setItem("nf-lang", lang);
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  }, [lang]);
  const loc = lang === "ar" ? "ar-EG" : "en-US";
  const t = (k: TKey) => dicts[lang][k] ?? en[k];
  const nf = (n: number, d = 0) => new Intl.NumberFormat(loc, { maximumFractionDigits: d, minimumFractionDigits: d }).format(n);
  const cf = (n: number) => new Intl.NumberFormat(loc, { style: "currency", currency: "USD" }).format(n);
  return <Ctx.Provider value={{ lang, setLang, t, nf, cf }}>{children}</Ctx.Provider>;
}
export function useI18n() {
  const c = useContext(Ctx);
  if (!c) throw new Error("I18nProvider missing");
  return c;
}

export function errorMessage(err: unknown, t: (k: TKey) => string): string {
  const e = err as { data?: { error?: string; code?: string } | null; status?: number } | null;
  const code = e?.data?.code;
  if (code && (`err_${code}` as TKey) in en) return t(`err_${code}` as TKey);
  if (e?.status === 401) return t("err_UNAUTHORIZED");
  if (e?.status === 429) return t("err_RATE_LIMITED");
  if (e?.status === 403) return t("err_FORBIDDEN");
  if (e?.status && e.status >= 500) return t("err_SERVER_ERROR");
  if (e?.data?.error && t("err_UNKNOWN") === en.err_UNKNOWN) return e.data.error;
  if (err instanceof TypeError) return t("err_NETWORK");
  return t("err_UNKNOWN");
}
