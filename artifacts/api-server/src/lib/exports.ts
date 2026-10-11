import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import path from "node:path";
import type { Vault } from "./vault";
import { calculateKpis, reportRange } from "./kpis";
import { OperationError } from "../routes/operations";

type Cell = string | number | null;
interface Section { title: string; columns: string[]; rows: Cell[][] }
export type ExportKind = "reports" | "plans" | "audit";
function sectionsFor(v: Vault, kind: ExportKind): Section[] {
  if (kind === "audit") return [{ title: "Master audit log", columns: ["Timestamp (UTC)", "Actor", "Action", "Target", "Details"],
    rows: (v.audit ?? []).map(a => [a.at, a.actorName, a.action, a.targetId, a.detail]) }];
  if (kind === "plans") return [
    { title: "Production plans", columns: ["Plan ID", "Name", "Period", "Start date (UTC)", "End date (UTC)", "Status", "Notes", "Updated by", "Updated at"],
      rows: (v.plans ?? []).map(p => [p.id, p.name, p.period, p.startDate, p.endDate, p.status, p.notes ?? "", p.updatedBy, p.updatedAt]) },
    { title: "Resource assignments", columns: ["Plan", "Work order", "Machine", "Operator ID", "Start (UTC)", "End (UTC)"],
      rows: (v.plans ?? []).flatMap(p => p.assignments.map(a => [p.name, v.jobs.find(j => j.id === a.jobId)?.name ?? a.jobId, a.machineId, a.operatorId, a.startAt, a.endAt])) },
  ];
  const range = reportRange(), kpis = calculateKpis(v, range.from, range.to);
  return [
    { title: `Daily KPIs (${range.from} to ${range.to})`, columns: ["Date (UTC)", "Good units", "Rejected units", "Reported downtime (min)", "Unit pass rate (%)", "Unit fail rate (%)"],
      rows: kpis.daily.map(d => [d.date, d.goodQty, d.rejects, d.reportedDowntimeMinutes, d.passRate, d.failRate]) },
    { title: "OEE (latest 7 days)", columns: ["Machine", "Planned min", "Running min", "Stopped min", "Maintenance min", "Unknown min", "Availability (%)", "Performance (%)", "Quality (%)", "OEE (%)", "Data status"],
      rows: kpis.machines.map(m => [m.machineId, m.plannedMinutes, m.runningMinutes, m.stoppedMinutes, m.maintenanceMinutes, m.unknownMinutes, m.availability, m.performance, m.quality, m.oee, m.reason]) },
    { title: "OEE configuration", columns: ["Machine", "Shift starts (UTC)", "Shift ends (UTC)", "Ideal cycle seconds"],
      rows: (v.oeeSettings ?? []).map(s => [s.machineId, s.shiftStart, s.shiftEnd, s.idealCycleSeconds]) },
    { title: "All work orders", columns: ["ID", "Name", "Machine", "Target", "Good units", "Rejects", "Start date", "Due date", "Status", "Shipping"],
      rows: v.jobs.map(j => [j.id, j.name, j.machineId, j.target, j.goodQty, j.rejects, j.startDate, j.dueDate, j.status, j.shippingStatus ?? "pending"]) },
    { title: "All production logs", columns: ["Date (UTC)", "Time (UTC)", "Work order", "Machine", "Operator", "Good units", "Rejects", "Downtime (min)", "Reason", "QC status", "QC note"],
      rows: v.logs.map(l => [l.date, l.time, v.jobs.find(j => j.id === l.jobId)?.name ?? l.jobId, l.machineId, l.staff, l.goodQty, l.rejects, l.downtimeMinutes, l.reason, l.qcStatus, l.qcNote]) },
  ];
}
const notes = "Factory-private snapshot. All schedules use UTC. KPI pass/fail is reported unit yield, not QC approval. OEE uses recorded status intervals and logged output within the current configured daily shift; settings apply to the entire reporting range. Missing coverage is unavailable, not zero. Exports include all records; charts cover the latest 7 days.";
const format = (value: Cell) => value === null ? "Unavailable" : typeof value === "number" ? Number(value.toFixed(3)).toString() : value;
export async function buildExport(v: Vault, kind: ExportKind, formatName: "pdf" | "xlsx", factory: string): Promise<Buffer> {
  const sections = sectionsFor(v, kind);
  const rowCount = sections.reduce((n, s) => n + s.rows.length, 0);
  const values = sections.flatMap(s => s.rows.flat());
  if (rowCount > (formatName === "pdf" ? 1500 : 10000) || values.some(c => typeof c === "string" && c.length > 30000) ||
    Buffer.byteLength(JSON.stringify(sections)) > 2_000_000) throw new OperationError("EXPORT_TOO_LARGE", 413);
  const generated = new Date().toISOString();
  if (formatName === "xlsx") {
    const book = new ExcelJS.Workbook();
    book.creator = "NexusFab AI"; book.created = new Date();
    const info = book.addWorksheet("Report information");
    info.columns = [{ width: 25 }, { width: 110 }];
    info.addRows([["NexusFab AI", `${kind} export`], ["Factory", factory], ["Generated (UTC)", generated], ["Scope & interpretation", notes]]);
    info.getRow(4).height = 65; info.getCell("B4").alignment = { wrapText: true, vertical: "top" };
    for (const section of sections) {
      const sheet = book.addWorksheet(section.title.slice(0, 31), {
        views: [{ state: "frozen", ySplit: 1 }],
        pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "1:1" },
      });
      sheet.columns = section.columns.map(header => ({ header, width: Math.min(42, Math.max(18, header.length + 3)) }));
      // ExcelJS string values are literal cells, never formula objects, even for =/+/@ prefixes.
      for (const row of section.rows) sheet.addRow(row.map(c => c === null ? "Unavailable" : c));
      sheet.autoFilter = { from: "A1", to: { row: Math.max(1, sheet.rowCount), column: section.columns.length } };
      sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
      sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF14244B" } };
      sheet.eachRow(row => { row.alignment = { vertical: "top", wrapText: true }; });
      sheet.headerFooter.oddFooter = `NexusFab AI | Page &P of &N`;
    }
    return Buffer.from(await book.xlsx.writeBuffer());
  }
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margins: { top: 48, bottom: 48, left: 44, right: 44 },
      info: { Title: `NexusFab AI — ${kind}`, Author: "NexusFab AI" } });
    const chunks: Buffer[] = [];
    doc.on("data", b => chunks.push(b)); doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject);
    doc.font(path.resolve(process.cwd(), "assets/ReportSans.ttf"));
    doc.fillColor("#14244B").fontSize(21).text("NexusFab AI");
    doc.fontSize(15).text(kind.toUpperCase());
    doc.markContent("Span", { actual: factory });
    doc.text(factory, { features: ["liga", "rlig", "calt"], align: /[\u0600-\u06ff]/.test(factory) ? "right" : "left" });
    doc.endMarkedContent();
    doc.fontSize(9).fillColor("#475569").text(`Generated ${generated} · UTC`);
    doc.moveDown().text(notes, { lineGap: 3 }).moveDown();
    for (const section of sections) {
      if (doc.y > 650) doc.addPage();
      doc.fontSize(14).fillColor("#14244B").text(section.title).moveDown(0.4);
      if (!section.rows.length) doc.fontSize(10).fillColor("#475569").text("No records in this section.").moveDown();
      section.rows.forEach((row, index) => {
        if (doc.y > 680) doc.addPage();
        doc.fontSize(10).fillColor("#14244B").text(`Record ${index + 1}`).moveDown(0.2);
        row.forEach((value, i) => {
          const text = format(value);
          doc.fontSize(9).fillColor("#475569");
          if (/[\u0600-\u06ff]/.test(text)) {
            // Shape the entire Arabic line rather than PDFKit's per-word cache.
            // Keep the Latin label out of the RTL shaping run.
            doc.text(`${section.columns[i]}:`, { lineGap: 2 });
            doc.markContent("Span", { actual: text });
            doc.text(text, { lineGap: 2, align: "right", features: ["liga", "rlig", "calt"] });
            doc.endMarkedContent();
          } else doc.text(`${section.columns[i]}: ${text}`, { lineGap: 2 });
        });
        doc.moveDown(0.8);
      });
      doc.moveDown();
    }
    doc.end();
  });
}
