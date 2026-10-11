---
name: Private onboarding policy
description: Rationale for invitation-only provisioning and the boundary between development acceptance and live readiness.
---

Use trusted-administrator factory provisioning rather than public signup or a
“first visitor becomes owner” setup page. Existing demo data must not become a
real factory's records by default.

**Why:** This product holds private manufacturing records. No trusted external
identity or email-delivery service was configured when private accounts were
introduced; single-use invitations delivered privately avoid exposing a public
owner-claim mechanism or collecting staff passwords through their owner.

**How to apply:** Keep the real-owner activation check separate from disposable
development acceptance. Do not recommend publishing merely because the test
owner can log in. Preserve the existing encryption root; password management is
not permission to rotate the vault key.
