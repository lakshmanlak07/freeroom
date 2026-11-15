# Traceability: rules and features → code → tests

Paths are relative to the repo root. "Adversarial" means `services/api/test/adversarial.test.ts`
(P9 release audit: attacks that must fail). "E2E" means `e2e/tests/*.spec.ts` (Playwright
against any deployed URL).

## Business rules (PRD §3)

| Rule | Enforced in (code) | Proven by (tests) |
|---|---|---|
| **BR-1** no reservation over a class | `packages/domain/src/classConflict.ts` (half-open overlap); `services/api/src/routes/reservations.ts` (fresh-cache check + on-demand room refresh); `services/api/src/data/schedule.ts` (class slot LOCKs written by sync); `services/api/src/data/reservations.ts` `createReservation` (class LOCK collision → `CLASS_CONFLICT`) | `packages/domain/test/classConflict.test.ts`; `integration.test.ts` › *BR-1 class conflict* (incl. "class slot LOCKs block the write even if the pre-check is bypassed"); Adversarial › *BR-1* (touching edges, overlap, spanning, malformed/past/beyond-horizon intervals); `scripts/e2e.ts` flow "class conflict rejected" |
| **BR-2** classes ≠ reservations (color **and** pattern/icon) | `packages/shared/src/api.ts` (`kind` discriminator); `apps/web/src/components/TimelineBlock.tsx` (purple stripes + book icon vs blue + person icon; own bookings gold + star; text labels) | `integration.test.ts` › *schedule returns classes and reservations with kind discriminator*; axe on the room timeline (E2E `a11y.spec.ts`) |
| **BR-3** class tooltips (keyboard + screen reader) | `apps/web/src/components/TimelineBlock.tsx` (popover on hover **and** focus; `aria-label` = full description); `services/api/src/views.ts` `classItem` | E2E `a11y.spec.ts` (room timeline, 0 serious violations); Lighthouse a11y 100 on the room page |
| **BR-4** single owner; ownership changes only by approved transfer or admin | `services/api/src/data/claims.ts` `approveClaim` (TRANSFER: version + owner conditions, quota moved); `packages/domain/src/permissions.ts` | `claims.test.ts` › *TRANSFER*; Adversarial › *IDOR* (only the owner may approve; requester can't self-approve) |
| **BR-5** contact only after an APPROVED claim, scoped, expiring | `services/api/src/contact.ts` (KMS envelope encryption + encryption context); `services/api/src/routes/claims.ts` `contactRevealRoutes` (requester + APPROVED + SHARE_CONTACT + reveal not expired, audited); `infra/lib/api.ts` (only RevealFn has `kms:Decrypt`); `services/api/src/logger.ts` (redaction); `packages/domain/src/privacy.ts` (`assertNoPII`) | `contact.test.ts`; `claims.test.ts` › *BR-5 contact reveal* (incl. ciphertext-at-rest table scan); `packages/domain/test/privacy.test.ts`; every API test response runs through `assertNoPII` (`test/helpers.ts`); Adversarial › *BR-5* (pending, denied, TRANSFER, stranger, owner, admin, admin-approve, expiry at end+24h); `infra/test/stack.test.ts` › *RevealFn is the ONLY function role with kms:Decrypt* |
| **BR-6** confirm window, 4 h cutoff, auto-release, no acceptance at/after cutoff | `packages/domain/src/cutoff.ts`; conditional writes with `cutoffAt > :now` (server clock) in `data/reservations.ts` and `data/claims.ts`; `services/api/src/sweeper.ts` (every minute via EventBridge Scheduler) | `packages/domain/test/cutoff.test.ts`; `integration.test.ts` › *BR-6 confirmation*; `claims.test.ts` › *BR-6: no acceptance at or after cutoff*, *sweeper (BR-6)*; Adversarial › *BR-6* (OK at cutoff − 1 ms; confirm/approve/claim all refused at exactly the cutoff) |
| **BR-7** immutable audit events + notifications | `services/api/src/data/reservations.ts` `eventPut` (append-only, `attribute_not_exists`, carries correlation id); `services/api/src/notify/onChange.ts` (stream → notifications, idempotent per event); `infra/lib/async.ts` (DLQ) | `onChange.test.ts`; `claims.test.ts` › *notifications (stream → onChange)*; `observability.test.ts` (correlation id rides the event into onChange logs) |
| **BR-8** no double booking, even concurrently | `services/api/src/data/reservations.ts` `createReservation`: one `TransactWriteItems` with a LOCK item per 15-min slot (`keys.lock`); no read-then-write | `integration.test.ts` › *50 concurrent POSTs → exactly 1 success*; *concurrent duplicates with one key*; Adversarial › *BR-8* (9 different-but-overlapping intervals → 1 winner; 8× same Idempotency-Key → 1 reservation; key reuse with a different body → 400); `scripts/e2e.ts` "double-booking race" |
| **BR-9** 25Live wins → release + 3 alternatives | `services/api/src/sync/syncSchedule.ts` (conflict detection, release in one txn, `alternativesFor`); `packages/domain/src/alternatives.ts` | `packages/domain/test/alternatives.test.ts`; `integration.test.ts` › *BR-9 class wins*; `claims.test.ts` › *inject-conflict releases a reservation via BR-9*; `scripts/e2e.ts` "inject conflict, alternatives, rebook" |
| **BR-10** UTC storage, campus display, 15-min grid | `packages/domain/src/time.ts`, `validation.ts` (`INVALID_SLOT_BOUNDARY`) | `packages/domain/test/time.test.ts`, `validation.test.ts`; Adversarial › off-grid interval rejected |

## §0.2 features

| Feature | Code | Tests |
|---|---|---|
| Search + filter | `services/api/src/routes/rooms.ts`; `apps/web/src/pages/SearchPage.tsx` | `integration.test.ts` › *rooms search filters and reports status*; E2E smoke "search lists rooms" |
| Room timeline (day view) + drag-to-reserve | `apps/web/src/components/Timeline.tsx`, `TimelineBlock.tsx`, `ReserveSheet.tsx` | E2E smoke "reserve a free slot"; axe + Lighthouse on the room page |
| Campus map (Amazon Location) | `apps/web/src/pages/MapPage.tsx`, `apps/web/src/lib/mapStyle.ts`; `infra/lib/web.ts` (Maps API v2 key, no map resource) | E2E smoke *map renders: style 200, tiles 200, canvas painted, building markers*; stack test *Location Maps v2: key limited to basemap reads from our origin; no legacy map resource*; `mapStyle.test.ts` |
| Claims (share contact / transfer) | `services/api/src/data/claims.ts`, `routes/claims.ts`; `apps/web/src/components/ClaimDialog.tsx`, `pages/MyReservationsPage.tsx` | `claims.test.ts`; E2E smoke "claim → approve (share contact) → reveal" |
| My Reservations | `apps/web/src/pages/MyReservationsPage.tsx`; `GET /me/reservations` | E2E smoke (approve + cancel in /me); axe on /me |
| In-app notifications (10 s polling) | `services/api/src/routes/notifications.ts`, `notify/onChange.ts`; `apps/web/src/pages/NotificationsPage.tsx` | `claims.test.ts` › *notifications*; Adversarial › *can't mark someone else's notifications read*; axe on /notifications |
| Landing + registration (University ID → HMAC) | `apps/web/src/pages/LandingPage.tsx`, `LoginPage.tsx`; `services/api/src/routes/users.ts`, `auth.ts` | `auth.test.ts`; `scripts/e2e.ts` "register"; axe on /welcome and /login |
| Admin Demo Controls | `services/api/src/routes/dev.ts`, `demoSeed.ts`; `apps/web/src/pages/DemoPage.tsx` | `claims.test.ts` › *demo controls*; `demoSeed.test.ts`; Adversarial › demo routes refuse non-admins |
| Event-driven (Streams → onChange, DLQ) | `infra/lib/async.ts`; `services/api/src/onChangeLambda.ts` | stack test *stream consumer: batch 10, 2 retries, bisect, SQS DLQ*; `onChange.test.ts` |
| Auth: Cognito + pre-token roles, SAML-ready | `infra/lib/auth.ts`; `services/api/src/preToken.ts` | stack test *Cognito: email sign-in, strong passwords, SRP*; `auth.test.ts` |
| 25Live adapter (real + mock) | `services/api/src/twentyfive/` (rate limit/backoff in `real.ts`, mapping in `mapper.ts`) | `rateLimit.test.ts`, `mapper.test.ts` |
| AWS infra (one stack) + WAF | `infra/lib/*.ts`, `infra/lambda/edge-waf/` | `infra/test/stack.test.ts` (23 tests), cdk-nag on every synth |
| Observability | `services/api/src/metrics.ts`, `correlation.ts`; `infra/lib/observability.ts` | `observability.test.ts`; stack test *alarms → SNS* |
| Abuse protection | WAF (`infra/lambda/edge-waf/spec.mjs`), stage throttling (`infra/lib/api.ts`), quotas (`packages/domain/src/permissions.ts`), origin-verify header (`services/api/src/app.ts`) | stack tests (WAF prod-only, throttling, origin header); `integration.test.ts` › *per-role active quota*; `claims.test.ts` › *max 3 open claims*; `observability.test.ts` › *origin verify*; live check: direct `execute-api` → 403 |
| **Stretch: natural-language search (Bedrock + parser)** | `POST /rooms/search/natural` in `services/api/src/routes/rooms.ts` → `services/api/src/nlsearch/` (`parser.ts` deterministic, always on; `bedrock.ts` Converse + one forced tool whose schema is the filter object, zod-validated, 2 s timeout → parser; `index.ts` 5-min cache); output runs through the same `searchRooms()` as `GET /rooms`. Per-user 10/min (`takeNlSearchToken`, DynamoDB counter); EMF `NLSearchSource` by `Source`. Model `us.anthropic.claude-haiku-4-5-20251001-v1:0` (us cross-region profile from us-east-2) via `-c nlModelId`, on by `-c nlBedrock` (cdk.json); IAM = that profile + its 3 regional model ARNs only (`infra/lib/api.ts`). UI: `apps/web/src/components/SearchChips.tsx` (editable chips, examples, "Understood by AI"/"Smart search") | `services/api/test/nlsearch.test.ts` (21 parser cases incl. tomorrow, DST both ways, unknown words, injection text; Bedrock mocked: valid, 4 malformed, prose, timeout, cache; route: same rooms as GET /rooms, `assertNoPII`, 400/401, rate limit 10→429); stack test *only ApiFn may call Bedrock* (exact 4 ARNs, no `*`); E2E smoke *natural-language search → editable filter chips*. **Live status:** the account must submit Anthropic's one-time use-case form in the Bedrock console; until then every search is served by the parser (`source: "parser"`). |

## Release audit findings (P9)

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | Third-party GitHub Actions pinned by tag, not SHA | Medium | **Fixed**: pinned to commit SHAs |
| 2 | Dev and prod shared one CDK bootstrap, so the dev deploy role could deploy prod | High | **Fixed**: prod has its own bootstrap qualifier (`frprod`); each role can assume only its own stage's roles (stack test) |
| 3 | Playwright traces (which record typed logins) uploaded as CI artifacts | Medium | **Fixed**: traces off in CI, no prod report upload, 3-day retention |
| 4 | Direct `execute-api` URL bypassed the CloudFront WAF | Medium | **Fixed**: CloudFront adds a secret `x-origin-verify` header; the API refuses requests without it (unit test + live check: 403); `ApiUrl` output removed |
| 5 | `POST /me/notifications/read` returned the number of ids *requested* as `updated` | Low (no data exposure: ids are scoped to the caller's partition) | **Fixed**: counts only real updates (Adversarial) |
| 6 | No break found in BR-1, BR-5, BR-6 or BR-8, or IDOR on any `:id` route | — | 11 adversarial tests pass |
| 7 | GitHub OIDC provider creation (and listing) is denied by the AWS account's SCP | Blocks §0.1 #1 | **Open (account policy).** The OIDC role is opt-in (`-c githubOidc=true`); deploys run from a maintainer machine with `aws login`. In an account that allows OIDC, the pipeline is complete as committed. |

## Whole-repo audit (v1.3, 2026-11-15)

Full findings, fixes and deliberate deferrals: [AUDIT.md](AUDIT.md). New regression tests:
`services/api/test/syncResilience.test.ts` (BR-1 crash recovery in the 25Live sync, malformed
payloads, sweeper poison items, ownerId-pinned cancel after a transfer, batch reads that never
drop keys), `services/api/test/logger.test.ts` (substring + free-text PII redaction),
`apps/web/src/lib/time.test.ts` (URL param guards), `infra/test/stack.test.ts`
(Permissions-Policy), `e2e/tests/audit.spec.ts`.

## Feature-flagged additions (features.directions, features.invites)

| Requirement | Code | Tests |
|---|---|---|
| Arrival verdict (free / class soon / busy / yours), 15-min "reserve when I arrive" | `packages/domain/src/arrival.ts`; `apps/web/src/components/directions/format.ts` | `packages/domain/test/arrival.test.ts` (boundaries, back-to-back, DST, rounding); `format.test.ts` |
| Walking route via Amazon Location Routes v2, least-privilege IAM | `services/api/src/directions/router.ts`, `routes/directions.ts`; `infra/lib/api.ts` | `services/api/test/directions.test.ts`; stack test *dev: exactly geo-routes:CalculateRoutes on the AWS-provided routing provider* |
| Location privacy (rounded ~10 m, never stored/logged), 20/min, 2-min cache | `routes/directions.ts`, `logger.ts` | `directions.test.ts` (*coordinates never reach the logs*, rate limit, cache) |
| Directions UI (panel / bottom sheet, route draw-on, fox trot, states) | `components/directions/*`, `BottomSheet.tsx`, `pages/MapPage.tsx`, `fox/FoxCompanion.tsx` | `e2e/tests/directions.spec.ts` (prefill, blocked location, phone sheet, axe light+dark) |
| Invite tokens: hash-only storage, one active link, revoke, 404 parity (BR-5) | `services/api/src/data/invites.ts`, `routes/invites.ts` | `invites.test.ts` (table scan, revoke/replace/expire/unknown → same 404, public preview privacy) |
| Join: active + capacity (owner counts) in one transaction; attendees ≠ owners (BR-4) | `data/invites.ts` `joinReservation` | `invites.test.ts` (20 concurrent joins on capacity 5 → exactly 4; idempotent; owner can't join; attendee can't cancel) |
| Attendee notifications (join/leave; cancel/release/class conflict/transfer) | `data/reservations.ts`, `data/claims.ts`, `notify/onChange.ts` | `invites.test.ts` (notify recipients), `onChange.test.ts` |
| RFC 5545 calendar files + Google/Outlook links | `services/api/src/ics.ts`; `apps/web/src/lib/calendar.ts` | `ics.test.ts` (ical.js parse, escaping, folding, EDT/EST, snapshot); `calendar.test.ts`; e2e .ics parse |
| Invite UI (booked card, QR ticket, public page, My Reservations) | `components/invites/*`, `pages/InvitePage.tsx`, `pages/MyReservationsPage.tsx` | `e2e/tests/invites.spec.ts` (reserve → invite → signed-out join → sign in → joined → owner notified; phone + axe light/dark) |
| Feature flags (dev on, prod off) | `infra/bin/app.ts`, `infra/lib/api.ts`, `infra/lib/web.ts`, `apps/web/src/config.ts` | stack test *prod: flags off → no routing permission, no INVITE# access, no public invite routes* |
