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
