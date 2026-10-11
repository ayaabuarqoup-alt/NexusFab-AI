import type { AskAnalystBody } from "@workspace/api-zod";
import type { Log, Vault } from "./vault";
import { summarize } from "./analytics";

type Input = ReturnType<typeof AskAnalystBody.parse>;
type Intent = "summary" | "bottlenecks" | "operators" | "trends" | "unsupported";
const numericDates = (value: string) => value.replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
function dateValid(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export class AnalystInputError extends Error {}

export function analyzeRecords(v: Vault, input: Input) {
  const question = numericDates(input.question.toLowerCase()).replace(/[\u064B-\u065F\u0670]/g, "");
  let intent: Intent = /operator|staff|efficien|worker|yield|مشغل|موظف|عامل|كفاء|مردود|عائد/.test(question) ? "operators"
    : /trend|pattern|hidden|failure|over time|daily|اتجاه|يتجه|يومي|نمط|أنماط|خفية|أعطال|فشل/.test(question) ? "trends"
    : /bottleneck|root|cause|reason|why|disrupt|عنق|اختناق|سبب|أسباب|لماذا/.test(question) ? "bottlenecks"
    : /loss|leak|cost|reject|quality|downtime|stop|machine|production|summary|total|how many|خسار|تسرب|تكلف|رفض|مرفوض|جود|توقف|آل|إنتاج|ملخص|لخص|إجمالي|كم/.test(question) ? "summary" : "unsupported";
  // Natural-language matching is deliberately narrow and transparent. Explicit
  // controls override inferred scope; ambiguous matches ask for clarification.
  const dates = question.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? [];
  if (dates.some(d => !dateValid(d))) throw new AnalystInputError("INVALID_DATE");
  const fromDate = input.fromDate || dates[0], toDate = input.toDate || dates[1] || (dates[0] && !input.fromDate ? dates[0] : undefined);
  if ((fromDate && !dateValid(fromDate)) || (toDate && !dateValid(toDate)) || (fromDate && toDate && fromDate > toDate)) throw new AnalystInputError("INVALID_DATE");
  const matchedJobs = v.jobs.filter(j => question.includes(j.id.toLowerCase()) || (j.name.trim().length >= 3 && question.includes(j.name.toLowerCase())));
  const names = [...new Set(v.logs.map(l => l.staff))];
  const matchedStaff = names.filter(n => n.trim().length >= 3 && question.includes(n.toLowerCase()));
  const machineMatch = question.match(/(?:machine|الآلة|آلة|الماكينة|ماكينة)\s*0?([1-3])\b/);
  const jobId = input.jobId || (matchedJobs.length === 1 ? matchedJobs[0]!.id : undefined);
  const staff = input.staff || (matchedStaff.length === 1 ? matchedStaff[0] : undefined);
  const machineId = input.machineId || (machineMatch ? `m${machineMatch[1]}` : undefined);
  const ambiguous = (!input.jobId && matchedJobs.length > 1) || (!input.staff && matchedStaff.length > 1) || dates.length > 2;
  if (ambiguous) intent = "unsupported";
  const logs = v.logs.filter(l => (!jobId || l.jobId === jobId) && (!staff || l.staff === staff) &&
    (!machineId || l.machineId === machineId) && (!fromDate || l.date >= fromDate) && (!toDate || l.date <= toDate))
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`) || a.id.localeCompare(b.id));
  const summary = summarize({ jobs: v.jobs.filter(j => !jobId || j.id === jobId), logs });
  const money = (n: number) => `$${n.toFixed(2)}`;
  const pct = (n: number) => `${n.toFixed(2)}%`;
  const cited = new Map<string, Log>();
  const cite = (l: Log) => { cited.set(l.id, l); return `[${l.id}] ${l.date} ${l.time}`; };
  const en: string[] = [], ar: string[] = [];
  const job = v.jobs.find(j => j.id === jobId);
  const scopeEn = [jobId ? `job: ${job?.name ?? "no matching job"}` : "all jobs", machineId ? `machine: ${machineId}` : "", staff ? `operator: ${staff}` : "", fromDate ? `from ${fromDate}` : "", toDate ? `through ${toDate}` : ""].filter(Boolean).join("; ");
  const scopeAr = [jobId ? `الأمر: ${job?.name ?? "لا يوجد أمر مطابق"}` : "جميع الأوامر", machineId ? `الآلة: ${machineId}` : "", staff ? `المشغل: ${staff}` : "", fromDate ? `من ${fromDate}` : "", toDate ? `حتى ${toDate}` : ""].filter(Boolean).join("؛ ");
  en.push(`Scope: your signed-in factory only; ${scopeEn}. ${logs.length} matching production records.`);
  ar.push(`النطاق: المصنع المسجل دخوله فقط؛ ${scopeAr}. عدد سجلات الإنتاج المطابقة: ${logs.length}.`);
  if (intent === "unsupported") {
    en.push(ambiguous ? "Multiple entities or dates matched. Please narrow the question using the scope filters." : "This record-based analyst supports production totals, costs, recorded bottlenecks, operator yield, and historical trends. I cannot answer that question reliably. Rephrase it or use a suggested question.");
    ar.push(ambiguous ? "تطابق السؤال مع عدة أوامر أو مشغلين أو تواريخ. يرجى تحديد النطاق باستخدام المرشحات." : "يدعم هذا المحلل إجماليات الإنتاج والتكاليف والتوقفات المسجلة ومردود المشغلين والاتجاهات التاريخية. لا أستطيع الإجابة عن هذا السؤال بشكل موثوق. أعد صياغته أو اختر سؤالاً مقترحاً.");
  } else if (!logs.length) {
    en.push("No records match this scope. No production totals, causes, efficiency rankings or trends can be inferred.");
    ar.push("لا توجد سجلات مطابقة لهذا النطاق. لا يمكن استنتاج إجماليات إنتاج أو أسباب أو ترتيب كفاءة أو اتجاهات.");
  } else if (intent === "summary") {
    en.push(`Good quantity: ${summary.goodQty}; rejects: ${summary.rejects}; downtime: ${summary.downtimeMinutes} minutes; recorded yield: ${pct(summary.yieldPercent)}.`,
      `Calculated loss: (${summary.downtimeMinutes} minutes × $5.00) + (${summary.rejects} rejects × $1.50) = ${money(summary.financialLeak)}. These are configured cost estimates, not invoiced expenses.`);
    ar.push(`الكمية الجيدة: ${summary.goodQty}؛ المرفوض: ${summary.rejects}؛ التوقف: ${summary.downtimeMinutes} دقيقة؛ المردود المسجل: ${pct(summary.yieldPercent)}.`,
      `الخسارة المحسوبة: (${summary.downtimeMinutes} دقيقة × $5.00) + (${summary.rejects} مرفوض × $1.50) = ${money(summary.financialLeak)}. هذه تقديرات وفق المعدلات المحددة وليست مصروفات موثقة بفواتير.`);
  } else if (intent === "bottlenecks") {
    const ranked = [...logs].filter(l => l.downtimeMinutes > 0).sort((a, b) => b.downtimeMinutes - a.downtimeMinutes).slice(0, 5);
    const byMachine = summary.machines.filter(m => m.downtimeMinutes > 0).sort((a, b) => b.downtimeMinutes - a.downtimeMinutes);
    if (!ranked.length) { en.push("No downtime was recorded in this scope."); ar.push("لم يتم تسجيل توقفات في هذا النطاق."); }
    if (byMachine[0]) {
      en.push(`Largest recorded downtime concentration: ${byMachine[0].id}, ${byMachine[0].downtimeMinutes} minutes across its matching logs.`);
      ar.push(`أعلى إجمالي توقف مسجل: ${byMachine[0].id}، ${byMachine[0].downtimeMinutes} دقيقة عبر سجلاتها المطابقة.`);
    }
    for (const l of ranked) {
      const source = cite(l);
      en.push(`${source} — ${l.machineId}, ${l.staff}: ${l.downtimeMinutes} downtime minutes (${money(l.downtimeMinutes * 5)}). Entered reason (verbatim): “${l.reason || "Not provided"}”.`);
      ar.push(`${source} — ${l.machineId}، ${l.staff}: ${l.downtimeMinutes} دقيقة توقف (${money(l.downtimeMinutes * 5)}). السبب المدخل كما ورد: «${l.reason || "غير محدد"}».`);
    }
    en.push("Recorded reasons are observations, not proof of root cause. Cycle time, planned run time and maintenance diagnostics are not recorded; the actual process bottleneck cannot be established from downtime alone.");
    ar.push("الأسباب المدخلة ملاحظات وليست إثباتاً للسبب الجذري. لا توجد بيانات عن زمن الدورة أو التشغيل المخطط أو تشخيص الصيانة؛ لا يمكن إثبات عنق الاختناق الفعلي من التوقف وحده.");
  } else if (intent === "operators") {
    for (const name of [...new Set(logs.map(l => l.staff))].sort()) {
      const rows = logs.filter(l => l.staff === name);
      const good = rows.reduce((s, l) => s + l.goodQty, 0), rejects = rows.reduce((s, l) => s + l.rejects, 0);
      const down = rows.reduce((s, l) => s + l.downtimeMinutes, 0);
      const yieldValue = good + rejects ? pct(good / (good + rejects) * 100) : null;
      const source = cite(rows[0]!);
      en.push(`${name}: ${rows.length} records, ${good} good units, ${rejects} rejects, ${down} downtime minutes; yield ${yieldValue ?? "not available (no units)"}. Example source: ${source}.`);
      ar.push(`${name}: ${rows.length} سجل، ${good} وحدة جيدة، ${rejects} مرفوض، ${down} دقيقة توقف؛ المردود ${yieldValue ?? "غير متاح (لا توجد وحدات)"}. مثال مصدر: ${source}.`);
    }
    en.push("Yield = good ÷ (good + rejects) × 100. Work hours, shifts, product mix and assigned machine conditions are missing. True efficiency, units/hour and worker responsibility cannot be determined or fairly ranked.");
    ar.push("المردود = الجيد ÷ (الجيد + المرفوض) × 100. ساعات العمل والورديات وتنوع المنتجات وحالة الآلات غير متاحة. لا يمكن تحديد الكفاءة الفعلية أو الوحدات في الساعة أو مسؤولية العامل أو ترتيب العاملين بعدالة.");
  } else {
    const days = summary.dailyProduction;
    if (days.length < 2) { en.push("At least two recorded dates are needed for a historical comparison."); ar.push("تلزم بيانات في تاريخين مختلفين على الأقل لإجراء مقارنة تاريخية."); }
    else {
      for (const day of [days[0]!, days[days.length - 1]!]) {
        const rows = logs.filter(l => l.date === day.date);
        const down = rows.reduce((s, l) => s + l.downtimeMinutes, 0);
        const source = cite(rows[0]!);
        const rate = day.goodQty + day.rejects ? pct(day.rejects / (day.goodQty + day.rejects) * 100) : null;
        en.push(`${day.date}: ${day.goodQty} good units; ${day.rejects} rejects (reject rate ${rate ?? "not available"}); ${down} downtime minutes; estimated loss ${money(down * 5 + day.rejects * 1.5)}. Example source: ${source}.`);
        ar.push(`${day.date}: ${day.goodQty} وحدة جيدة؛ ${day.rejects} مرفوض (نسبة الرفض ${rate ?? "غير متاحة"})؛ ${down} دقيقة توقف؛ خسارة تقديرية ${money(down * 5 + day.rejects * 1.5)}. مثال مصدر: ${source}.`);
      }
    }
    const recurring = new Map<string, Log[]>();
    for (const l of logs.filter(l => l.downtimeMinutes > 0 && l.reason.trim())) {
      const key = `${l.machineId}: ${l.reason.trim()}`;
      recurring.set(key, [...(recurring.get(key) ?? []), l]);
    }
    const repeats = [...recurring].filter(([, rows]) => rows.length > 1).sort((a, b) => b[1].length - a[1].length).slice(0, 3);
    for (const [reason, rows] of repeats) {
      en.push(`Repeated entered reason (verbatim): “${reason}”, ${rows.length} records, ${rows.reduce((s, l) => s + l.downtimeMinutes, 0)} downtime minutes. Example: ${cite(rows[0]!)}.`);
      ar.push(`سبب مدخل متكرر كما ورد: «${reason}»، ${rows.length} سجل، ${rows.reduce((s, l) => s + l.downtimeMinutes, 0)} دقيقة توقف. مثال: ${cite(rows[0]!)}.`);
    }
    if (!repeats.length) { en.push("No exact repeated machine/reason combination is recorded in this scope."); ar.push("لا يوجد تكرار مطابق للآلة والسبب المدخل في هذا النطاق."); }
    en.push("These are recorded-date comparisons; unrecorded days are not zero-output days. Unequal shift coverage can explain differences. The data cannot establish hidden failures or predict breakdowns.");
    ar.push("هذه مقارنة بين تواريخ مسجلة؛ الأيام غير المسجلة ليست أيام إنتاج صفري. قد يفسر اختلاف تغطية الورديات الفروق. لا تثبت البيانات أعطالاً خفية ولا تتنبأ بانهيار الآلات.");
  }
  // Put explicitly cited records first; cap UI payload without changing calculations.
  const evidence = intent === "unsupported" ? [] : [...new Map([...cited, ...logs.map(l => [l.id, l] as const)]).values()].slice(0, 50);
  const answerEn = en.join("\n\n"), answerAr = ar.join("\n\n");
  return { answer: input.language === "ar" ? answerAr : answerEn, answerEn, answerAr, intent,
    sourceCount: intent === "unsupported" ? 0 : logs.length, evidence,
    evidenceTruncated: intent !== "unsupported" && logs.length > evidence.length, generatedAt: new Date().toISOString() };
}
