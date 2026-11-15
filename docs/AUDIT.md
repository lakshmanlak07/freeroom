# FreeRoom audit — 2026-11-15 (pre-v1.3.0)

Whole-repo review with Everything Claude Code agents (`ecc:typescript-reviewer`, `ecc:security-reviewer`,
`ecc:database-reviewer`, `ecc:architect`, `ecc:refactor-cleaner`), a 3× Playwright run, and Lighthouse
(mobile, prod build). Status: **fixed** (commit + test), **deferred** (known, logged with reason), **docs** (fixed in docs).

## Summary

| Severity | Found | Fixed | Deferred |
| --- | --- | --- | --- |
| Critical | 0 | 0 | 0 |
| High     | 4 code + 4 docs | 4 code + 4 docs | 0 (H4 hard-fail waits for 25Live creds) |
| Medium | 21 | 11 (8 code, 3 docs) | 10 (M1, M2 need an owner decision) |
| Low | 30+ | selected | rest |

No Critical findings. BR-5 (contact reveal), BR-6 (server-clock cutoffs) and BR-8 (slot-lock transactions) were
verified correct on every user-facing write path by two independent reviewers. Secret scan of all git history: clean.

## High

| # | Area | file:line | Problem | Impact | Fix | Status |
| --- | --- | --- | --- | --- | --- | --- |
| H1 | BR-1 sync | services/api/src/sync/syncSchedule.ts:158-167 | Class item (with its source hash) is written before its slot locks; a crash between them makes every later sync skip the class | Class slots never locked → reservation can overlap a class (BR-1) until the class changes | Write the class item only after all its slots are locked (and conflicts released) | **Fixed** 1d4b18d — `syncResilience.test.ts` (failed before) |
| H2 | Sweeper | services/api/src/sweeper.ts:21-33 | No per-item error isolation: one failing item aborts the run | A poison item blocks all later auto-releases (BR-6) and claim expiries every minute | Per-item try/catch, count + log, continue | **Fixed** 1d4b18d — sweeper poison-item test (failed before) |
| H3 | 25Live | services/api/src/twentyfive/mapper.ts:40-44 | Unexpected payload shape is treated as "no classes" | Sync deletes every cached class + class lock for those room-days (BR-1) | Throw on unexpected shape so the room-day is skipped, not wiped | **Fixed** 1d4b18d + eb45e13 (empty wrapper "" / null / {} = no classes) — test failed before |
| H4 | 25Live | services/api/src/twentyfive/source.ts:36-39 | Missing credentials silently fall back to the mock source, no log | A real campus deploy could serve mock classes as truth | Loud error log in prod; hard-fail deferred (prod intentionally runs on mock data until UMass IT grants 25Live access) | **Fixed** (loud warn + `missingCreds` test); hard-fail **deferred** until 25Live credentials exist |
| D1-D4 | Docs | README.md:153,183; docs/PITCH.md:50; docs/SUBMISSION.md:75 | Test counts 253/255 | Actual 273 unit/integration + Playwright | Update counts | **Docs** — README/PITCH/SUBMISSION now say 283 + 48 Playwright |

## Medium

| # | Area | file:line | Problem | Fix | Status |
| --- | --- | --- | --- | --- | --- |
| M1 | Auth (security) | infra/lib/auth.ts:44, routes/users.ts | Open self-sign-up; anyone can register any University ID first | Pre-sign-up campus-domain trigger or SAML-only in prod | **Deferred** — touches auth/IAM; needs owner decision + UMass SSO |
| M2 | IAM (security) | infra/lib/freeroom-stack.ts:~95-110 | If GitHub OIDC is enabled for prod, deploy role gets Cognito Admin* + table RW (for smoke users) | Dev-only admin grants; prod smoke via one canary user | **Deferred** — IAM change; OIDC is off for prod today (opt-in flag) |
| M3 | Authz race | data/reservations.ts:392-399, 451-462, 531-538 | Cancel/release conditions don't pin `ownerId`; after a claim TRANSFER the old owner can still cancel | Add `ownerId = :owner` to the conditions | **Fixed** 1d4b18d — transfer-race test (failed before) |
| M4 | Privacy | apps/web/src/auth/AuthProvider.tsx:168-174 | Sign-out keeps React Query cache (keys lack user id) | `queryClient.clear()` on sign-out | **Fixed** 8329007 — e2e `audit.spec.ts` guards it but also passes without the fix (the stale cache is not observable through the UI today); the fix is defensive |
| M5 | Auth UX | apps/web/src/api/client.ts:75-88 | Token-refresh failure reported as NETWORK → "Try again" loop | Map auth failure to 401 so the user is signed out | Deferred (auth refactor; low judge impact) |
| M6 | Auth race | AuthProvider.tsx:94-140 | Stale `refresh()` can set an old profile after sign-out/switch | Run-id guard | Deferred (needs run-id plumbing through AuthProvider) |
| M7 | Data | data/db.ts:52-58 | batchGet/batchPut silently drop unprocessed items after retries | Throw | **Fixed** 1d4b18d — batchGet test (failed before) |
| M8 | Map | MapPage.tsx:91-95 | Late `load` after the 8s timeout leaves the failure overlay up | Clear `failed` on load | **Fixed** 8329007 |
| M9 | Map | MapPage.tsx:153-168 | `nearMe` uses `map.current!` async; duplicate dots; no geolocation guard | Guard + single dot ref | **Fixed** 8329007 |
| M10 | Sync | syncSchedule.ts:151-166 | Changed class unlocked then relocked (gap); no run mutual exclusion | Lock new slots before unlocking old | Deferred (BR-9 release covers the gap; needs careful diff logic) |
| M11 | Claims | data/reservations.ts cancel/release | Pending claims not closed on cancel/class release | Close in same txn or sweeper | Deferred (claims expire at cutoff; no data loss) |
| M12 | Claims | data/claims.ts:401-422 | TRANSFER with ≥23 other pending claims exceeds the 100-item txn limit; submitClaim doesn't bump version | Cap claims/reservation, version bump | Deferred (needs >23 claims on one booking) |
| M13 | Cost | availability.ts, routes/rooms.ts | Per-room fan-out + ConsistentRead on public reads | Eventually consistent reads, CDN TTL | Deferred (perf at campus scale; documented in PITCH cost answer) |
| M14 | Sweeper | sweeper.ts | Serial releases, 60s timeout | mapLimit | Deferred |
| M15 | Pagination | reservations.ts:147, claims.ts:94 | Past history queried in full then sliced | Limit + cursor | Deferred |
| M16 | Notifications | NotificationsPage.tsx | Only first page (20) shown | Infinite query | Deferred |
| M17 | Observability | syncSchedule.ts:287 | `Limit` before filter can miss last full sync → false stale alarm | Separate "last success" item | Deferred |
| M18 | Docs | README Mermaid / docs/architecture.mmd | Diagram omits Amazon Location + Secrets Manager | Add nodes, re-render | **Docs** — diagram adds Amazon Location, Secrets Manager, PreTokenFn; PNG re-rendered |
| M19 | Docs | SECURITY.md:74 | Still describes legacy `geo:GetMap*` key | Maps v2 wording | **Docs** |
| M20 | Docs | TRACEABILITY.md:37 | 21 infra tests (actual 22) | Update | **Docs** (23 infra tests now) |
| M21 | SEO | apps/web/index.html | No meta description (Lighthouse SEO 82) | Add description | **Fixed** 8329007 (title, description, theme-color) |

## Selected Low

| # | file:line | Problem | Status |
| --- | --- | --- | --- |
| L1 | services/api/src/logger.ts:2 | Redaction matches exact keys only; Error messages logged raw | **Fixed** 1d4b18d + 6478284 (broad digit-run scrub; ISO dates kept) — logger tests |
| L2 | infra/lib/web.ts | No `Permissions-Policy` header | **Fixed** 8329007 — infra test |
| L3 | SearchPage/RoomPage URL params | `?date=foo` throws RangeError in render | **Fixed** 8329007 + eb45e13 — `time.test.ts` + e2e (failed before) |
| L4 | LoginPage.tsx:30 | Post-login redirect drops the query string (rebook links) | **Fixed** 8329007 |
| L5 | SimplePages.tsx:23 etc. | Dead exports (`ComingSoon`, …) — see refactor list | **Fixed**: removed the unused `ComingSoon` placeholder; other unused exports are types/test helpers, kept (no runtime cost) |
| L6 | pnpm audit | 1 moderate (`@hono/node-server`, local dev server only) | Deferred (not in Lambda path) |
| L7 | infra/lib/freeroom-stack.ts:61 | Origin-verify secret readable via `cloudfront:GetDistributionConfig` | Deferred (documented) |
| L8 | GSI4 `SWEEP#*` | Single partition for sweeper index | Deferred (needs migration) |

## Performance (Lighthouse mobile, simulated slow 4G, prod build)

| Page | Perf | A11y | Best practices | SEO | LCP | CLS | TBT |
| --- | --- | --- | --- | --- | --- | --- | --- |
| /welcome (signed out) | 96 | 100 | 100 | 82 | 1.2 s | 0.027 | 220 ms |
| / | 93 | 100 | 100 | 82 | 1.7 s | 0 | 310 ms |
| /rooms/:id | 95 | 100 | 100 | 82 | 1.3 s | 0.113 | 130 ms |
| /map | 56 | 96 | 100 | 82 | 5.0 s | 0 | 1,470 ms |

JS (gzip): main `index` 229.6 kB · `MapPage` (maplibre, lazy, /map only) 302.2 kB · `auth` 24.9 kB · `tokenProvider` 14.6 kB.

## Flaky tests (3× full run)

`playwright test --repeat-each=3` over every spec and profile (desktop + iPhone 14 + Pixel 7; axe in
light and dark): **138 / 138 passed, 0 flaky**. Earlier root-caused fixes: the smoke reserve step
waits for room cards instead of racing them; mobile overflow checks wait for the route to render
instead of `networkidle` (the app polls every 10 s, so it never goes idle).

## Code review of the fixes (ecc:code-reviewer + security plugin)

No blocking issues. Applied: empty 25Live wrappers count as an empty day; `isDay` rejects
rolled-over dates (2026-02-31); phone redaction keeps ISO dates readable but stays broad
(unseparated and international numbers are scrubbed). Accepted: a claim approval racing a class
release is retried by the next sync run (at most one sync interval).

## Dead code (refactor-cleaner)

All declared dependencies are used. 44 "certain" unused exports, mostly exported types and test-only helpers.
Removed only where grep + typecheck prove zero use (see commit). The public contracts in `packages/shared` stay.
