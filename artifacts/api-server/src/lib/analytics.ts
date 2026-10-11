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

