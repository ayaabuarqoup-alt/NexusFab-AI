---
name: Session cache transitions
description: Avoid detached query observers when changing authentication or factory identity.
---

Preserve the active session query when publishing login/logout state. Reset, rather than remove, actively observed protected queries during tenant changes; initial hydration has no previous tenant cache to remove.

**Why:** Browser verification found successful login responses left the sign-in form visible after clearing the entire cache. Removing protected queries during initial authenticated hydration likewise left persisted jobs behind permanent loading skeletons. API-only checks passed both failures.

**How to apply:** Keep signed-in browser coverage for auth transitions and reloads whenever changing cache invalidation. Cancel old in-flight requests before publishing a new identity, and remount tenant-local UI state when the factory changes.
