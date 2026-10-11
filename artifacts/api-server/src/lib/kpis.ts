import type { GetKpisResponse } from "@workspace/api-zod";
import type { Vault, MachineHistory } from "./vault";
import { OperationError } from "../routes/operations";

type Report = ReturnType<typeof GetKpisResponse.parse>;
const DAY = 86400000;
export function validDay(day: string) {
  const n = Date.parse(`${day}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(n) && new Date(n).toISOString().slice(0, 10) === day;
}
export function reportRange(from?: unknown, to?: unknown, now = Date.now()) {
  const end = to ?? new Date(now).toISOString().slice(0, 10);
  const start = from ?? new Date(now - 6 * DAY).toISOString().slice(0, 10);
  if (typeof start !== "string" || typeof end !== "string" || !validDay(start) || !validDay(end) ||
    start > end || Date.parse(end) - Date.parse(start) > 92 * DAY ||
    end > new Date(now).toISOString().slice(0, 10)) throw new OperationError("INVALID_REPORT_RANGE");
  return { from: start, to: end };
}
function historyFor(v: Vault, machineId: string) {
  const events: MachineHistory[] = [...(v.machineHistory ?? []).filter(h => h.machineId === machineId)];
  // Retain real historical evidence from installations predating explicit history.
  for (const entry of v.audit ?? []) {
    if (entry.action !== "machine_status_updated" || entry.targetId !== machineId) continue;
    try {
      const { before, after } = JSON.parse(entry.detail);
      for (const state of [before, after]) if (state?.updatedAt && ["running", "stopped", "maintenance", "unknown"].includes(state.status)) {
        events.push({ machineId, status: state.status, at: state.updatedAt });
      }
    } catch { /* Older unstructured audit entries are not timing evidence. */ }
  }
  const current = v.machineStates?.find(m => m.id === machineId);
  if (current?.updatedAt) events.push({ machineId, at: current.updatedAt, status: current.status });
  // Same timestamp duplicates carry no extra duration.
  return [...new Map(events.filter(h => Number.isFinite(Date.parse(h.at))).map(h => [h.at, h])).values()]
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}
export function calculateKpis(v: Vault, from: string, to: string, now = Date.now()): Report {
  const days: string[] = [];
  for (let d = Date.parse(from); d <= Date.parse(to); d += DAY) days.push(new Date(d).toISOString().slice(0, 10));
  const logs = v.logs.filter(l => l.date >= from && l.date <= to && Date.parse(`${l.date}T${l.time}:00Z`) <= now);
  const daily = days.map(date => {
    const rows = logs.filter(l => l.date === date);
    const goodQty = rows.reduce((sum, l) => sum + l.goodQty, 0), rejects = rows.reduce((sum, l) => sum + l.rejects, 0);
    return { date, goodQty, rejects, reportedDowntimeMinutes: rows.reduce((sum, l) => sum + l.downtimeMinutes, 0),
      passRate: goodQty + rejects ? goodQty / (goodQty + rejects) * 100 : null,
      failRate: goodQty + rejects ? rejects / (goodQty + rejects) * 100 : null };
  });
  const machines: Report["machines"] = ["m1", "m2", "m3"].map(machineId => {
    const result: Report["machines"][number] = { machineId, plannedMinutes: 0, runningMinutes: 0, stoppedMinutes: 0,
      maintenanceMinutes: 0, unknownMinutes: 0, goodQty: 0, rejects: 0, availability: null, performance: null,
      quality: null, oee: null, reason: "not_configured" };
    const config = v.oeeSettings?.find(s => s.machineId === machineId);
    if (!config) return result;
    const history = historyFor(v, machineId);
    for (const day of days) {
      const start = Date.parse(`${day}T${config.shiftStart}:00Z`), end = Math.min(now, Date.parse(`${day}T${config.shiftEnd}:00Z`));
      if (end <= start) continue;
      result.plannedMinutes += (end - start) / 60000;
      let state: string = "unknown", cursor = start;
      const add = (until: number) => {
        const minutes = (until - cursor) / 60000;
        if (state === "running") result.runningMinutes += minutes;
        else if (state === "stopped") result.stoppedMinutes += minutes;
        else if (state === "maintenance") result.maintenanceMinutes += minutes;
        else result.unknownMinutes += minutes;
        cursor = until;
      };
      for (const h of history) {
        const at = Date.parse(h.at);
        if (at <= start) { state = h.status; continue; }
        if (at >= end) break;
        add(at); state = h.status;
      }
      add(end);
      for (const log of logs.filter(l => l.machineId === machineId && l.date === day)) {
        const time = Date.parse(`${log.date}T${log.time}:00Z`);
        if (time >= start && time < end) { result.goodQty += log.goodQty; result.rejects += log.rejects; }
      }
    }
    const total = result.goodQty + result.rejects;
    result.quality = total ? result.goodQty / total * 100 : null;
    if (!result.plannedMinutes) { result.reason = "no_planned_time"; return result; }
    if (result.unknownMinutes > 0.000001) { result.reason = "incomplete_status"; return result; }
    result.availability = result.runningMinutes / result.plannedMinutes * 100;
    if (!result.runningMinutes) { result.reason = "no_runtime"; return result; }
    if (!total) { result.reason = "no_output"; return result; }
    const performance = config.idealCycleSeconds * total / (result.runningMinutes * 60) * 100;
    if (performance > 100 + 0.000001) { result.reason = "invalid_cycle_rate"; return result; }
    result.performance = Math.min(100, performance);
    result.oee = result.availability * result.performance * result.quality! / 10000;
    result.reason = "ready";
    return result;
  });
  return { from, to, asOf: new Date(now).toISOString(), daily, machines };
}
