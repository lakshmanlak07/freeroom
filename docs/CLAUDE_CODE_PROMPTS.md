# FreeRoom: Claude Code Build Prompts (Production v1)

9 prompts in two parallel tracks. Scope, release gate, and schedule: **PRD §0**.

**How to run**
1. Run **P1 alone**. It creates the shared contract both tracks depend on.
2. Then make a second copy of the repo with `git worktree add ../FreeRoom-web -b web` and open two Claude Code sessions:
   - Session 1 (`FreeRoom/`, `main`): **P2 → P3 → P4** (backend + infrastructure)
   - Session 2 (`FreeRoom-web/`, `web`): **P5 → P6** (frontend, mocked API)
   - Merge `web` into `main` after P4, then run **P7 → P8 → P9** in one session.
3. Use auto-accept edits (Shift+Tab). Use plan mode for P2 and P8.
4. Commit after every prompt. If a prompt goes sideways: `git reset --hard HEAD` and re-run it.
5. Timebox per PRD §0.4. If a prompt runs over, say: "Stop, commit what works, list what's left."

---

## P1: Scaffold + business rules + tests + CI (≈2h, run alone)

```
Read CLAUDE.md and docs/PRD.md. §0 (production-ready v1 by the hackathon deadline) overrides everything else. Move fast, but the business rules must be correct and tested.

1. Monorepo: pnpm workspaces, TypeScript strict, Node 20, ESM. Packages:
   - packages/domain (pure business rules, Vitest)
   - packages/shared (zod schemas + inferred types for every API request/response in PRD §7 that §0 keeps, plus the ApiError codes)
   - services/api (Hono app, runs on Lambda and locally via @hono/node-server)
   - apps/web (Vite + React + TypeScript + Tailwind + shadcn/ui + TanStack Query + React Router; static SPA build)
   - infra (CDK v2 placeholder)
   Root scripts: dev:api, dev:web, test, lint, typecheck, deploy. docker-compose with DynamoDB Local. ESLint + Prettier.

2. packages/domain (pure; inject `now`; never call Date.now()):
   - time.ts: half-open intervals, overlaps, 15-min slot alignment, enumerateSlots, America/New_York helpers (date-fns-tz)
   - classConflict.ts (BR-1)
   - cutoff.ts (BR-6: cutoffAt = start − 4h; confirmation window [T−24h, cutoff); canConfirm/canSubmitClaim/canApproveClaim; initialStatusOnCreate)
   - stateMachines.ts (reservation + claim transitions as tables, with PRD error codes)
   - permissions.ts (role quotas/max durations per §2.1)
   - validation.ts (validateReservationRequest: boundary, duration, 7-day horizon, past, class conflict)
   - alternatives.ts (top 3 alternative rooms for BR-9)
   - privacy.ts (public projections that cannot contain universityId/uidHash/email/phone)

3. Tests (Vitest + fast-check), ≥ 90% branch coverage on packages/domain:
   - Class conflict: overlap, touching edges (allowed), containment, multiple classes, DST day.
   - 4h cutoff: confirm/approve/claim at cutoff−1ms ✅, at cutoff ❌; created inside 24h → CONFIRMED; inside 4h → not claimable; exactly 4 real hours across DST.
   - Illegal state transitions; permissions per role; privacy projection property test.

4. CI: .github/workflows/ci.yml runs on push/PR (pnpm cache → lint → typecheck → test).

5. git init, commit "P1: scaffold + domain + CI". Run lint, typecheck, and test, and fix until green. Keep the summary short.
```

## P2: Data layer + API + 25Live adapter + reservations (≈4h, Track A)

```
Read CLAUDE.md and docs/PRD.md (§0 overrides; also §6.2, §6.3, §7, §8.1). Plan first, then execute.

1. 25Live: a ScheduleSource interface (listBuildings, listRooms, listEvents(roomIds, from, to)).
   - RealTwentyFiveLiveSource: fetch with timeouts, a token-bucket rate limiter (default 5 rps), exponential backoff with full jitter on 429/5xx (max 5 retries), Retry-After support. All field mapping lives in mapper.ts, with TODOs where field names must be verified against our instance. It's activated when credentials exist in Secrets Manager.
   - MockSource: a deterministic, seeded UMass-like campus: 10 buildings with real-ish coordinates near 42.3868,-72.5301 (LGRT, ILC, CS Building, Du Bois Library, Goessmann, Hasbrouck, Isenberg, Tobin, Morrill, Marcus), ~80 rooms (capacity 8–300, equipment), MWF/TuTh classes for 14 days with realistic course codes, sections, event types, and departments. Expose it at /mock25live/*, plus an injectClass() function for the demo.
   - Unit tests for the mapper, rate limiter, and retry (fake timers).

2. DynamoDB single table per PRD §6.2 (the entities §0 keeps). Key builders live only in keys.ts. Define the table schema once in a shared file used by CDK and by the local/test table creator.

3. Sync: syncSchedule() diffs by sourceHash, writes CLASS items + class slot LOCK items (kind=class), sets lastSyncedAt, records a SyncRun, and implements BR-9: a class colliding with a reservation lock triggers ONE transaction that sets the reservation to RELEASED (reason CLASS_CONFLICT), deletes its locks, writes the class locks, and appends CONFLICTED + RELEASED events carrying 3 alternatives. Callable from a Lambda, a script, and the demo endpoints.

4. API (Hono, zod validation from packages/shared, error shape per PRD §7, correlation ID middleware, JSON logger with redaction):
   - GET /health, GET /buildings (freePct), GET /rooms (filters + status/freeUntil, in-memory catalog cache), GET /rooms/:id, GET /rooms/:id/schedule (classes + reservations, kind discriminator, staleness)
   - POST /reservations: requires Idempotency-Key. Flow: domain validation → stale room/day (>15 min) triggers an on-demand refresh, failing closed per §8.1 → ONE TransactWriteItems: META + one LOCK per 15-min slot with attribute_not_exists + CREATED event + quota check. Map failures → SLOT_TAKEN / CLASS_CONFLICT (with class details) / QUOTA_EXCEEDED.
   - GET /reservations/:id, GET /me/reservations, POST /reservations/:id/confirm (condition cutoffAt > now), DELETE /reservations/:id (remove locks), GET /reservations/:id/events
   - Dev-only auth: an `x-dev-user` header maps to seeded demo users (student1, student2, faculty1, tutor1, admin1), enabled only when NODE_ENV=development.

5. `pnpm dev:api` = DynamoDB Local + seed + sync + API on :3001.

6. Integration tests (DynamoDB Local): 50 concurrent POSTs → exactly 1 success; reservation over a class → 409; back-to-back both succeed; idempotent retry; an injected class releases the reservation and attaches 3 alternatives.

Commit "P2: data + api + reservations". Fix until green.
```

## P3: Auth + claims + KMS + sweeper + notifications (≈3h, Track A)

```
Read CLAUDE.md and docs/PRD.md (§0 overrides; BR-5, BR-6, BR-7, F4, F5, §7 Claims/Notifications, §9).

1. Auth: Cognito JWT verification middleware (aws-jwt-verify).
   - POST /register: HMAC-SHA256 of universityId with a pepper from Secrets Manager (cached). UID#{hash} uniqueness → 409 UID_ALREADY_REGISTERED. The raw ID is never stored, logged, or returned.
   - GET /me, PATCH /me.
   - A pre-token-generation Lambda handler adds `role` and `registered` claims (never PII).
   - Role rules: student/tutor can self-select; faculty requires admin assignment; admin is never self-selectable.

2. Contact privacy: email/phone are KMS envelope-encrypted (GenerateDataKey + AES-256-GCM) into a USER#{id}/PRIVATE item. A ContactService decrypts and is used only by the reveal handler and /me. Structure the code so the reveal route can be deployed as its own Lambda with its own IAM role.

3. Claims:
   - Routes: POST /reservations/:id/claims, GET /me/claims?direction=, POST /claims/:id/approve {mode: SHARE_CONTACT|TRANSFER}, /deny, /withdraw, GET /claims/:id/contact.
   - Approve is a transaction with the condition cutoffAt > :now.
   - TRANSFER: changes the owner (version check), writes a TRANSFERRED event, and denies other pending claims.
   - SHARE_CONTACT: writes a REVEAL item (TTL end+24h).
   - /contact returns contact only to the approved requester before expiry, and audits each access.
   - Limits: 3 open claims per user, 1 per reservation.

4. Sweeper: sweep(now) releases PENDING_CONFIRMATION reservations past cutoff (UNCONFIRMED) and expires PENDING claims past cutoff. It's idempotent via conditional writes.

5. Notifications (event-driven): onChange(streamRecords) maps old/new stream images to domain events and writes NOTIF items for the owner/claimant: claim received/approved/denied/expired, auto-released, transferred, class conflict with alternatives. It sends SES email when SES_FROM is set and is idempotent per event id. In dev, run it in-process so notifications work locally.
   Routes: GET /me/notifications, POST /me/notifications/read.

6. Demo endpoints (admin only, disabled when DEMO_MODE=false):
   - POST /demo/inject-conflict {reservationId}
   - POST /demo/fast-forward {reservationId} (runs the sweeper with now = cutoff)
   - POST /demo/reset

7. Tests:
   - Approve at exactly cutoff → CUTOFF_PASSED; claim after cutoff rejected.
   - TRANSFER moves ownership.
   - Contact is returned only to the approved requester; ciphertext only at rest (scan the table in the test).
   - The sweeper releases unconfirmed reservations; onChange mapping table tests.
   - assertNoPII applied to every response except /me and /claims/:id/contact.

Commit "P3: auth + claims + notifications". Fix until green.
```

## P4: AWS infrastructure + first deploy (≈2h, Track A)

```
Read CLAUDE.md and docs/PRD.md §0 and §5.

CDK app in infra/ with stage context (dev|prod), region us-east-1. Use one stack per stage, split into constructs: Data, Auth, Api, Async, Web, Observability.

- Data: the table from the shared schema (on-demand, Streams NEW_AND_OLD_IMAGES, TTL, PITR, deletion protection in prod); a KMS CMK for PII (rotation on); Secrets Manager secrets for the HMAC pepper (generated) and 25Live credentials (empty placeholder).
- Api: ApiFn (Node 20, esbuild, Hono via hono/aws-lambda) behind an HTTP API with a Cognito JWT authorizer (except /health and public room reads), route throttling, and CORS for the CloudFront domain + localhost:5173. RevealFn is a separate Lambda for /claims/{id}/contact and /me. It is the ONLY function with kms:Decrypt.
- Async:
  - SweeperFn: EventBridge Scheduler, rate(1 minute).
  - SyncFn: rate(10 minutes) between 06:00–23:00 campus time, hourly overnight.
  - OnChangeFn: DynamoDB Streams source (batch 10, retries 2, bisect on error, SQS DLQ on failure).
- Auth: Cognito User Pool (email sign-in, strong password policy), a web client (SRP), the pre-token Lambda, and a script that creates demo users. SAML IdP support is wired behind context `samlMetadataUrl` (skipped when absent).
- Web: private S3 + CloudFront (OAC, SPA fallback, security headers policy: HSTS, CSP for MapLibre/Cognito/API, frame-deny), BucketDeployment of apps/web/dist + a generated config.json (apiUrl, userPoolId, clientId, region, mapName, mapApiKey, demoMode).
- Amazon Location: a map resource + an API key restricted to map actions and our domains.
- IAM: least privilege per function (dynamodb:LeadingKeys where possible). ApiFn may call bedrock:InvokeModel.
- Outputs: web URL, API URL.

`pnpm deploy -- --stage dev` = build web → cdk deploy → seed + first sync + demo users.
Make sure cdk synth passes. Then show me the resource list and estimated monthly cost, and WAIT for me to type "deploy". After deploying, curl /health and /buildings on the live API and print both URLs.

Commit "P4: infra + first deploy".
```

## P5: Web shell + search + room timeline + reserve (≈4h, Track B)

```
Read CLAUDE.md and docs/PRD.md (§0 overrides; §4 F1, F2, BR-2, BR-3, BR-6, §10). If Claude Design exports are in docs/design/, match them closely. Otherwise follow docs/CLAUDE_DESIGN_PROMPT.md: a horizontal brown (#7B3F00) → white gradient, a left nav rail, plum striped classes, blue solid reservations, gold outline for "mine", green for free.

The backend is being built in parallel. Use the packages/shared types and build a typed API client. Use MSW mocks with realistic UMass data while VITE_USE_MOCKS=true. The real base URL comes from config.json → apiUrl (localhost:3001 in dev).

Build in apps/web:
1. App shell:
   - A gradient left nav rail: Search, Map, My Reservations, Notifications (unread badge), Demo (admins only).
   - A top bar with the search input and a "Demo data" badge.
   - A skip link, visible focus rings, and a mobile bottom nav.
   - An error boundary and a 404 page.
2. Auth:
   - Login screen (Cognito SRP via aws-amplify/auth) with "Demo as Student / Faculty / Admin" quick buttons, shown only when demoMode is on.
   - /register onboarding: University ID with a privacy note, role, alias, contact, share channel.
   - A route guard that sends unregistered users to /register.
3. Search (/):
   - Filters: building, capacity, equipment chips, Free now, time range, sort. All synced to the URL.
   - Room cards with a status chip + freeUntil.
   - Skeleton, empty, and error states.
4. Room page (/rooms/:id):
   - A header (name, building, capacity, equipment, status).
   - A custom HORIZONTAL DAY TIMELINE (7:00–23:00) with a now-line and a date picker.
   - Blocks: classes are plum, diagonal-striped, with a book icon. Reservations are blue with a person icon. Mine get a gold outline.
   - Radix popovers on hover AND focus: classes show every 25Live field; reservations show status, owner alias, a cutoff countdown, and "Request this room".
   - Reserving: click or drag on free space (15-min snap; classes, reservations, and the past are blocked) → side sheet → POST /reservations with an Idempotency-Key.
   - Friendly CLASS_CONFLICT / SLOT_TAKEN handling (refetch + explain).
   - Arrow-key navigation, a "Text view" list toggle, and 10s polling.
5. Shared components: StatusChip, RoomCard, TimelineBlock, Toast, EmptyState.

Run typecheck + build. Screenshot search and room pages at 1440px and 390px, review them against the design, and polish. Commit "P5: web search + timeline".
```

## P6: Map + claims + My Reservations + notifications + demo panel (≈3h, Track B)

```
Read CLAUDE.md and docs/PRD.md (§0 overrides; F3, F4, F5, F6, BR-5, BR-9).

1. Map (/map): MapLibre GL + Amazon Location (@aws/amazon-location-utilities-auth-helper with the API key from config.json; a free demo style in mock mode).
   - Building markers colored by freePct, with a legend and accessible marker buttons.
   - A side panel listing the selected building's rooms + status chips, linking to the room pages.
   - "Near me" (opt-in geolocation) and a "Buildings list" toggle.
   - Poll every 15s.
2. Claim modal: message ≤280 with a counter, party size, cutoff countdown. Disabled with an explanation after the cutoff.
3. My Reservations (/me):
   - Upcoming/Past tabs. Rows show a status pill, Confirm (countdown; disabled after the cutoff), and Cancel.
   - Incoming claims: Approve → "Share contact" or "Transfer reservation", or Deny.
   - Outgoing claims: status, plus a revealed contact card once approved.
   - An event history drawer.
4. Notifications (/notifications + bell dropdown):
   - Grouped by day, mark read, 10s polling, a toast on each new one.
   - The class-conflict card shows the class details + 3 alternative rooms with "Rebook here" (opens the room page with the reserve sheet prefilled).
5. Demo panel (/demo, admin + demoMode only): Inject class conflict, Fast-forward to cutoff, and Reset demo data, with a live log.
6. Landing page (logged out): the gradient hero, "Google Maps for empty classrooms", "Try the demo", and 3 feature cards.

Run typecheck + build, screenshot every page at 1440px, review, and polish. Commit "P6: map + claims + notifications + demo".
```

## P7: Integration on the live stack (≈4h, after merging `web` into `main`)

```
Read CLAUDE.md and docs/PRD.md §0.

1. Point the web app at the deployed API (config.json) with mocks off. Redeploy.
2. On the live dev URL, run every flow end-to-end as student1, student2, and admin1: register, search, reserve, class conflict rejected, double-booking race (two browsers), confirm, claim → approve (share contact) → reveal, transfer, auto-release via fast-forward, inject conflict → notification with alternatives → rebook, map. Fix every bug found, write a regression test for each, and redeploy.
3. Seed the demo so it opens rich: a mix of free/occupied rooms right now, a claimable reservation owned by student2, a pending-confirmation reservation near cutoff, and an incoming claim for student1.
4. Report a pass/fail table of the flows.

Commit "P7: integration fixes".
```

## P8: Production hardening + CD pipeline (≈5h)

```
Read CLAUDE.md and docs/PRD.md §0.1 (the release gate), §9, §10. Plan first. Every item in §0.1 must be true when you finish.

1. Security:
   - A WAF WebACL on CloudFront (AWS managed common rules + known bad inputs + a rate-based rule, 300 req/5 min/IP).
   - Re-audit IAM: only RevealFn has kms:Decrypt; no wildcard resources except where AWS requires them.
   - Run cdk-nag (AwsSolutions) and fix or justify every finding.
   - Run `pnpm audit` and fix high/critical issues.
   - Confirm demo endpoints and the dev auth bypass are impossible to enable in prod.
   - Write SECURITY.md (PII handling, threat model in brief).
2. Observability:
   - Correlation IDs flow API → DynamoDB event → onChange logs.
   - Emit custom metrics (EMF): ReservationsCreated, ClassConflictsBlocked, SlotTakenRaces, AutoReleases, ClaimsApproved, SyncSuccess, ScheduleStalenessMinutes, NotificationFailures.
   - A CloudWatch dashboard.
   - Alarms → SNS email (from context): API 5xx > 2%, any Lambda errors, sync failed twice, staleness > 60 min, DLQ depth > 0.
3. CD:
   - A GithubOidc construct (IAM role scoped to this repo).
   - .github/workflows/deploy.yml: on push to main → CI → deploy dev → Playwright smoke against the dev URL. On tag v* → deploy prod behind a manual-approval environment.
   - Validate the workflows with actionlint.
4. E2E: a Playwright smoke suite (login as demo user, search, reserve, claim → approve → reveal, map loads) runs against any URL via BASE_URL. Add an axe check on the main pages (0 serious violations). Run Lighthouse on the home, room, and map pages, with an accessibility target ≥ 95.
5. Docs:
   - DEPLOY.md: first-time setup, secrets, SES identity, switching on real 25Live + SAML.
   - RUNBOOK.md: alarms → what to do, how to force-release, how to rotate secrets, how to restore from PITR.
6. Deploy prod (show me the diff and wait for "deploy"), run the smoke suite against prod, and print a §0.1 checklist with evidence for each item.

Commit "P8: production hardening". Tag v1.0.0.
```

## P9: Bedrock NL search + pitch kit + release audit (≈3h)

```
Read CLAUDE.md and docs/PRD.md (§0, F1 stretch, §14).

1. NL search (skip if P8 isn't fully green):
   - POST /rooms/search/natural {query} → Bedrock Converse (pick a Claude model enabled in us-east-1 on this account; check with `aws bedrock list-foundation-models`), using a tool/JSON schema that outputs ONLY the existing zod room-filter object.
   - Include the current campus date/time and the building list in the prompt.
   - Validate with zod; fall back to keyword parsing.
   - No PII in prompts. Per-user rate limit. 5-minute cache.
   - UI: the top-bar search shows the parsed filters as editable chips, with example chips.
   - Tests with a mocked Bedrock client.
2. README.md:
   - The pitch line, screenshots, a Mermaid architecture diagram.
   - How the hard parts work: slot-lock transactions, class locks, the 4h cutoff sweeper, event-driven notifications, KMS privacy.
   - Local quickstart, tests, deploy, and the roadmap (PRD §0.3).
3. docs/PITCH.md: a 3-minute script following PRD §14 using the demo panel; a 5-slide outline; 10 likely judge questions with crisp answers (scalability, cost, privacy, why DynamoDB, 25Live outage, double-booking, accessibility, adoption path with UMass IT, abuse, what's next).
4. Release audit: build docs/TRACEABILITY.md mapping each BR and §0.2 feature to code + tests. Then try to break BR-1, BR-5, BR-6, and BR-8 with new adversarial tests (including IDOR on every :id route) and fix anything found. Run the full suite + smoke against prod.
5. Final report: what's shipped, known limitations, and the top 3 next steps.

Commit "P9: NL search + pitch + audit". Deploy prod. Tag v1.0.1.
```
