# Private factory setup

Never rotate `SESSION_SECRET` without decrypting and migrating all factory vaults.
It remains the existing vault encryption root. Account passwords and invitations do
not change that key. Back up the database and preserve the key before live use.

## Provision a factory

There is no public signup or first-user-claims-owner endpoint. A trusted workspace
administrator runs the following against the intended database environment:

```
pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/cli/provision-factory.ts \
  factory_id "Factory name" owner.username "Owner name" /tmp/private-invitation.txt
```

The command creates an empty encrypted factory and an inactive-until-activated
owner account. Existing factory IDs are rejected, never overwritten. It writes a
24-hour, single-use invitation to a new file with owner-only permissions, not
console output. Share its contents privately with the named owner. They open
“Activate account” on the login page and set a password of at least 12 characters.
Delete the file after secure delivery. Never put invitations or passwords in Git,
URLs, chat, or application logs.

Owners invite individual staff in Account & access, choose a role, and deliver
each one-time token privately. Password reset immediately removes the old
password and sessions and issues a fresh invitation. Disabling or changing roles
revokes sessions and outstanding invitations. After re-enabling pending staff,
issue a reset invitation. Owners cannot disable, demote, or admin-reset themselves;
use the password form, or another owner for recovery. Keep two trusted owners.

For an expired first invitation or sole-owner lockout, a trusted workspace
administrator can run the following. This immediately revokes that owner's
existing password and sessions; verify their identity before doing so.

```
pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/cli/recover-owner.ts \
  factory_id owner.username /tmp/new-private-invitation.txt --revoke-existing-access
```

| Action | Owner | Operator | Quality inspector |
| --- | --- | --- | --- |
| Read factory records / audit | yes | yes | yes |
| Create jobs / production logs | yes | yes | no |
| Review quality | yes | no | yes |
| Dispatch approved jobs | yes | no | no |
| Invite / manage staff | yes | no | no |

Owners may review production they entered. If strict separation of duties is
required, agree that policy before live use. Historic demo records without a
reviewer stay unattributed; do not relabel them as personally approved.

## Live-readiness gate

The additive account schema is applied on API startup. `NODE_ENV=production`
disables both legacy password login and legacy factory-only sessions, even when
demo rows were copied into the database. No public UI displays sample passwords.

Before publishing, provision a real factory against the intended live database,
have the real owner activate and sign in, invite an operator and inspector,
confirm password change/recovery, and verify role boundaries and factory
isolation. Development acceptance does not establish that real live owners have
been provisioned. Do not publish until that operational check is recorded.

No deployment or live credentials are created automatically by development tests.

The repeatable production-mode API regression uses disposable factories and
cleans them up afterward:

```
NODE_ENV=production pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/tests/private-accounts.ts
```
