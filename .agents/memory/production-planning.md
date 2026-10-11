---
name: Production Planner scope
description: Planner role, scheduling semantics and honest production forecasts.
---

The user requires four roles: Admin, Quality Inspector, Operator and Production Planner. Planners create/edit/schedule daily or weekly plans, assign work orders to machines/operators, use analytics/forecasting, and receive production-change/issue alerts. Their changes belong in the Admin master audit log.

**Why:** The user explicitly added this fourth role; it is not a grant of Admin, QC or dispatch authority.

**How to apply:** Preserve explicit owner-approved role selection, factory isolation and active-role permissions. Let operators see their assigned schedules without giving them planning mutation privileges.

Plan calendar days and assignment times use UTC, explicitly labeled in both languages.

**Why:** Factories have no configured IANA time zone; mixing browser-local calendar days with backend UTC validation causes late-shift assignments to fall outside their plans.

**How to apply:** Keep input parsing, timeline boundaries and saved job schedules consistent. If factory-local scheduling is introduced, migrate these semantics explicitly rather than silently reinterpreting existing times.

Production forecasts are illustrative estimates from recorded-day output, not promises or calibrated confidence intervals.

**Why:** Missing days and small samples cannot support reliable labor-efficiency or failure predictions.

**How to apply:** Show sample size/date range, decline estimates with insufficient data, and label variability honestly.
