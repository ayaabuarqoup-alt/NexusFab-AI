---
name: Premium analytics and passkeys
description: Scope and interpretation decisions for OEE, downloadable exports and device authentication.
---

OEE uses actual status intervals intersected with an Admin-configured same-day UTC shift and ideal cycle time. Current shift/cycle settings apply across the selected report period. Unknown historical intervals are not running time; incomplete coverage or impossible performance makes OEE unavailable.

**Why:** Machine snapshots alone cannot establish historical availability, and machine status alone cannot establish ideal throughput. The user requested basic OEE without undermining existing stability or honest analytics.

**How to apply:** Keep availability, performance and quality separately visible. Distinguish reported unit yield from QC approval rates, and operator-entered downtime from timed machine-state downtime.

Exports preserve existing permissions: Admin can export the master audit; Planner cannot. Full-factory exports are not represented as filtered-chart exports.

**Why:** Adding download buttons must not expand access to private audit records or silently change report scope.

**How to apply:** Enforce permissions server-side immediately before returning files, audit exports, and reject oversized output explicitly rather than silently truncating.

Passkeys complement passwords and still require explicit selection of an approved role. Passkeys belong to the exact hostname; development and published addresses require separate enrollment. Device verification may use biometrics or a PIN; biometric data never reaches the app.

**Why:** Standard WebAuthn binds credentials to a relying-party domain and delegates verification to the operating system. Embedded preview permissions may block ceremonies.

**How to apply:** Preserve password fallback and the new-tab option. Confirm the password before enrollment; Admin-initiated credential recovery must revoke existing passkeys as well as sessions.
