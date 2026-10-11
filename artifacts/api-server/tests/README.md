# Critical-flow regression checks

Run from the workspace root:

```sh
pnpm --filter @workspace/api-server test
pnpm --filter @workspace/api-server test:browser
```

The API suite starts the real Express app on an ephemeral loopback port and uses
the development PostgreSQL database. No HTTP endpoints or vault operations are
mocked. The browser suite uses the running NexusFab and API workflows, defaulting
to the workspace preview domain. Set `E2E_BASE_URL` for a different **development**
preview. Never point this suite at a production deployment.

Both suites need the application's existing database and encryption configuration.
They create randomly named, empty test factories with generated passwords and
delete only those factories and their sessions in teardown. They never reset or
modify demo factories. The runner rejects `NODE_ENV=production`. If the process
is forcibly killed, its isolated `regression_*` fixtures may need cleanup.

API requests use unique synthetic forwarded client addresses, with only their
hashed throttle rows removed in teardown. The sequential cookie test temporarily
sets `NODE_ENV=production` and restores it in `finally`; it uses the same
development pool and disposable accounts, never a production database.

The browser suite uses Playwright Chromium. Install its browser with
`pnpm --filter @workspace/api-server exec playwright install chromium` or set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to a compatible installed Chromium.
In the current Replit environment the verified executable is `/repl/tools/bin/chromium`:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/repl/tools/bin/chromium pnpm --filter @workspace/api-server test:browser
```

It intentionally waits through the real two-minute session polling interval;
allow four minutes for the full suite. A fresh browser context is used on each run.

## Coverage

- Mutation requests reject foreign/malformed Origin and cross-site fetch
  metadata; matching direct/proxy hosts, headerless clients and safe methods pass.
- Login attempts 1–15 pass the throttle; 16 onward return 429 with Retry-After.
  Client buckets are independent and expired windows reset without sleeping.
- Login/logout cookies match on Path, HttpOnly, SameSite=Lax and production-only
  Secure, with a 12-hour lifetime and an expired cookie on logout.
- Every protected route denies signed-out requests.
- A second factory cannot read jobs, logs, summary or analyst source records, or
  mutate a first factory's logs, QC decisions or dispatch state.
- Invalid quantities, impossible dates, invalid times, missing stoppage reasons
  and empty logs leave persisted data unchanged.
- Sixteen simultaneous log writes preserve all records and totals; failed vault
  mutations roll back; ciphertext rejects tampering and the wrong tenant key.
- QC decisions are one-time under concurrent requests. Dispatch requires the
  target and **all** approved logs; pending/rejected logs block it; dispatched
  jobs cannot receive additional logs.
- Expired/logged-out session tokens cannot read or write.
- Real UI job/log/QC mutations survive reload; existing analyst answers switch
  English/Arabic; language survives reload; mobile RTL and menu work.
- Cross-tab logout/login clears or restores the protected interface; expiration
  removes it in both tabs through real session polling.
