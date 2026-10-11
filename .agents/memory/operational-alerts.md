---
name: Operational dashboards and alerts
description: Role-specific product scope and email delivery safety decisions.
---

The user requires customized Admin, Quality Inspector and Operator dashboards. Admin controls users, approved roles, reports and the master audit log. Inspectors access reviews, error flags and operator logs. Operators view/update daily work orders, shipping and machine status. Operator production flags and stopped/maintenance transitions notify Admins and Inspectors in-app and by email.

**Why:** These are the user's explicit specifications; Admin maps to the existing Owner role rather than granting a new permission.

**How to apply:** Keep notifications factory-local and target active accounts with approved Admin/Inspector/Production Planner grants even when offline. Selected roles still govern in-app access. Preserve QC/Admin dispatch gates when operators update shipping.

Email activation requires an explicit Admin action showing the intended eligible recipients. An authorized Gmail connection was chosen instead of inventing a sender. Do not send real test messages without recipient-specific approval.

**Why:** This app has public factory registration and a shared sender; users must configure addresses and intentionally enable external delivery. A lost provider response may mean the message was already sent.

**How to apply:** Keep in-app alerts independent of email setup, show blocked/failed/uncertain delivery honestly, and reconcile uncertain sends against the provider before any resend. Do not call provider acceptance proof of inbox delivery.

Escalations deliberately use opt-in deadlines and one reminder per day, coalescing missed reminders rather than sending an outage backlog. Escalation recipients are approved Admin/Inspector accounts, not the broader audience for ordinary production alerts.

**Why:** The user requested optional urgent-issue escalation specifically to Admins/Inspectors. Daily, coalesced reminders limit repeated email while keeping unresolved issues visible.

**How to apply:** Preserve the narrower recipient policy and opt-in behavior when extending alert settings. Changing cadence or adding automatic factory-wide deadlines is a separate product choice.

Never hold the factory mutation lock while awaiting external delivery. Serialize validation and starting an attempt, then release the lock; preserve honest in-flight/uncertain outcomes for attempts that began before resolution.

**Why:** Waiting for a provider under the factory lock also blocks issue resolution and unrelated production updates. Already-started attempts cannot be recalled reliably.

**How to apply:** Test with a deliberately stalled provider and require resolution plus unrelated writes to complete before the provider returns. Cancel queued work, not the recorded outcome of in-flight delivery.
