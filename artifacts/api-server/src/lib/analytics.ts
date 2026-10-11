import type { Vault } from "./vault";

export function summarize(v: Vault) {
  const goodQty = v.logs.reduce((s, l) => s + l.goodQty, 0);
  const rejects = v.logs.reduce((s, l) => s + l.rejects, 0);
  const downtimeMinutes = v.logs.reduce((s, l) => s + l.downtimeMinutes, 0);
  const staff = new Map<string, number>();
  const days = new Map<string, { date: string; goodQty: number; rejects: number }>();
  for (const l of v.logs) {
    staff.set(l.staff, (staff.get(l.staff) || 0) + l.downtimeMinutes);
    const day = days.get(l.date) || { date: l.date, goodQty: 0, rejects: 0 };
    day.goodQty += l.goodQty; day.rejects += l.rejects; days.set(l.date, day);
  }
  const machines = ["m1", "m2", "m3"].map((id, index) => {
    const logs = v.logs.filter(l => l.machineId === id);
    const downtimeMinutes = logs.reduce((s, l) => s + l.downtimeMinutes, 0);
    const rates = logs.map(l => l.rejects / Math.max(1, l.goodQty + l.rejects));
    const mean = rates.reduce((s, r) => s + r, 0) / Math.max(1, rates.length);
    const volatility = Math.sqrt(rates.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(1, rates.length));
    const fatigueScore = Math.round(Math.min(100, downtimeMinutes / 60 * 8 + volatility * 100));
    return { id, name: `Machine ${String(index + 1).padStart(2, "0")}`, fatigueScore,
      risk: fatigueScore >= 70 ? "high" : fatigueScore >= 35 ? "caution" : "stable",
      downtimeMinutes, rejects: logs.reduce((s, l) => s + l.rejects, 0) };
  });
  return { goodQty, rejects, downtimeMinutes, financialLeak: downtimeMinutes * 5 + rejects * 1.5,
    activeJobs: v.jobs.filter(j => j.status === "running" || j.status === "planned").length,
    pendingQuality: v.logs.filter(l => l.qcStatus === "pending").length,
    yieldPercent: goodQty + rejects ? goodQty / (goodQty + rejects) * 100 : 0,
    machines, staffDowntime: [...staff].map(([staff, minutes]) => ({ staff, minutes })),
    dailyProduction: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)), updatedAt: new Date().toISOString() };
}

export function analyze(v: Vault, question: string, language: "ar" | "en") {
  const s = summarize(v), ar = language === "ar";
  const supported = /loss|leak|cost|reject|quality|downtime|stop|cause|machine|production|summary|trend|خسار|تسرب|تكلف|رفض|جود|توقف|سبب|آل|إنتاج|ملخص|اتجاه/i.test(question);
  let answer: string;
  if (!supported) answer = ar ? "أستطيع تحليل الإنتاج والتوقفات والجودة والخسائر في سجلات مصنعك فقط. يرجى السؤال عن أحد هذه المواضيع." : "I can analyze only production, downtime, quality and losses in your factory records. Please ask about one of these topics.";
  else if (!v.logs.length) answer = ar ? "لا توجد سجلات إنتاج في هذا المصنع بعد. لا يمكنني استنتاج أسباب أو اتجاهات دون بيانات." : "This factory has no production logs yet. I cannot infer causes or trends without records.";
  else {
    const top = [...v.logs].sort((a, b) => b.downtimeMinutes - a.downtimeMinutes)[0]!;
    const byDay = new Map<string, number>();
    for (const log of v.logs) byDay.set(log.date, (byDay.get(log.date) || 0) + log.downtimeMinutes * 5 + log.rejects * 1.5);
    const dayLosses = [...byDay].sort(([a], [b]) => a.localeCompare(b));
    const first = dayLosses[0]!, last = dayLosses[dayLosses.length - 1]!;
    const trend = dayLosses.length < 2
      ? (ar ? "البيانات لا تغطي أياماً كافية لتحديد اتجاه." : "There are not enough recorded days to establish a trend.")
      : (ar ? `الخسارة المسجلة في ${first[0]} هي $${first[1].toFixed(2)}، وفي ${last[0]} هي $${last[1].toFixed(2)}؛ الفرق $${(last[1] - first[1]).toFixed(2)}. هذه مقارنة للإجماليات المسجلة وليست توقعاً.` : `Recorded loss on ${first[0]} was $${first[1].toFixed(2)} versus $${last[1].toFixed(2)} on ${last[0]}, a change of $${(last[1] - first[1]).toFixed(2)}. This compares recorded totals, not normalized rates or a forecast.`);
    answer = ar
      ? `استناداً إلى ${v.logs.length} سجل في مصنعك فقط: الإنتاج الجيد ${s.goodQty} وحدة، والمرفوض ${s.rejects} وحدة. إجمالي التوقف ${s.downtimeMinutes} دقيقة. الخسارة المحسوبة $${s.financialLeak.toFixed(2)} = (${s.downtimeMinutes} × $5) + (${s.rejects} × $1.50). أكبر توقف مسجل ${top.downtimeMinutes} دقيقة؛ السبب المدخل كما ورد: «${top.reason || "غير محدد"}». هذه ملاحظة مسجلة وليست إثباتاً للسبب الجذري. ${trend}`
      : `Based only on your factory's ${v.logs.length} records: ${s.goodQty} good units and ${s.rejects} rejects, with ${s.downtimeMinutes} downtime minutes. Calculated loss is $${s.financialLeak.toFixed(2)} = (${s.downtimeMinutes} × $5) + (${s.rejects} × $1.50). The largest recorded stoppage is ${top.downtimeMinutes} minutes; its entered reason is “${top.reason || "Not specified"}”. This is a recorded observation, not proof of root cause. ${trend}`;
  }
  return { answer, sourceCount: v.logs.length, generatedAt: new Date().toISOString() };
}
