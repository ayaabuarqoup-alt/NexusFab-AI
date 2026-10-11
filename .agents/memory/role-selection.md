---
name: Required role selection
description: Owner-approved grants versus the active role chosen after login.
---

Every user must explicitly choose a role after login, including users with only one approved role. A user may choose only among roles granted by a factory owner. A fresh factory owner initially has the Owner grant.

**Why:** The user explicitly chose “Choose among multiple owner-approved roles” rather than confirming one assigned role.

**How to apply:** Do not auto-select the only role or treat all grants as simultaneous permissions. Preserve existing accounts' access without adding grants. Revoke sessions when grants change, and keep selection shared across tabs within the same authenticated session.
