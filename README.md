# FreeRoom

**Google Maps for empty classrooms.** See every free room on campus right now, reserve it in two
taps, and never get kicked out by a class you didn't know about.

25Live is the read-only source of rooms and classes. Reservations, claims and notifications are
FreeRoom's own, on serverless AWS.

> FreeRoom reservations are informal and student-run, not an official university booking. The
> deployed demo runs on seeded UMass campus data until UMass IT grants 25Live and SSO access.
> Switching those on is configuration, not code (DEPLOY.md).

| Campus map: buildings colored by how free they are   | Room timeline: classes (striped, book icon) vs reservations |
| ---------------------------------------------------- | ----------------------------------------------------------- |
| ![Map](docs/screenshots/map.jpg)                     | ![Timeline](docs/screenshots/timeline.jpg)                  |
| **Class conflict → 3 alternatives, one-tap rebook**  | **My reservations: confirm window, incoming claims**        |
| ![Notifications](docs/screenshots/notifications.jpg) | ![My reservations](docs/screenshots/my-reservations.jpg)    |

![Landing](docs/screenshots/landing.jpg)

## Architecture

```mermaid
flowchart LR
  U[Browser<br/>React SPA] -->|HTTPS| CF[CloudFront<br/>+ WAF in prod]
  CF -->|/*| S3[(S3<br/>static site, OAC)]
  CF -->|/api/* + x-origin-verify| GW[API Gateway HTTP API<br/>Cognito JWT authorizer]
  GW --> API[ApiFn<br/>Hono Lambdalith]
  GW --> RV[RevealFn<br/>/me + contact reveal<br/>only kms:Decrypt]
  API --> DDB[(DynamoDB single table<br/>slot LOCKs, PITR)]
  RV --> DDB
  RV --> KMS[KMS CMK<br/>contact envelope keys]
  API -.GenerateDataKey.-> KMS
  DDB -->|Streams: EVT# inserts| OC[OnChangeFn] --> N[(in-app notifications)]
  OC -.failures.-> DLQ[[SQS DLQ]]
  SCH[EventBridge Scheduler] -->|every 1 min| SW[SweeperFn<br/>BR-6 auto-release<br/>+ staleness metric]
  SCH -->|10 min daytime| SY[SyncFn] -->|rate-limited| L25[(25Live<br/>read-only)]
  SY --> DDB
  SW --> DDB
  COG[Cognito<br/>email/password, SAML-ready] -.tokens.-> U
  API & RV & SW & SY & OC --> CW[CloudWatch<br/>JSON logs, EMF metrics,<br/>dashboard, alarms → SNS]
```

One CDK stack per stage (`infra/`). Everything is pay-per-use, about $8/month at demo scale
(mostly the prod WAF).

## How the hard parts work

### No double booking: slot-lock transactions (BR-8)

A reservation `[start, end)` is cut into 15-minute slots. Creating it is **one**
`TransactWriteItems`:

- the reservation item;
- the owner's quota item (optimistic version check);
- an immutable `CREATED` audit event;
- the idempotency record;
- **one `LOCK` item per slot** (`ROOM#<id>#SLOT#<iso>`), each with `attribute_not_exists(PK)`.

If any slot is already locked, the whole transaction is cancelled. The cancellation reason tells
us which lock failed. There's no read-then-write window to race through. A 50-way concurrency
test proves it: 50 parallel requests produce exactly 1 success and 49 `SLOT_TAKEN`. The P9 audit
adds 9 different-but-overlapping intervals at once, and again exactly one wins.

### Classes always win: class locks (BR-1, BR-9)

The 25Live sync writes a **class `LOCK`** (`kind=class`) on every 15-minute slot a class
occupies, using the same keys as reservation locks. So even a request that skipped the
API-level class check couldn't commit over a class: the transaction hits the class lock and
returns `CLASS_CONFLICT` with the class name.

Before writing, the API also checks the freshest cached schedule, refreshing that room and day
from 25Live if the cache is older than 15 minutes.

When a _new_ class appears over an existing reservation, sync releases the reservation
(`CONFLICTED → RELEASED`, reason `CLASS_CONFLICT`) in one transaction and attaches up to **3
alternative rooms**: same building first, enough seats, same time.

### The 4-hour cutoff: server clock and the sweeper (BR-6)

- `cutoff = start − 4h`. Confirming, submitting a claim and approving a claim are conditional
  writes containing `cutoffAt > :now`, and `:now` is the **server's** clock. A late request
  can't win, whatever the client says.
- An **EventBridge Scheduler** rule runs the sweeper **every minute**. It reads a sparse GSI of
  reservations due at their cutoff, releases unconfirmed ones (`RELEASED`, reason
  `UNCONFIRMED`), and expires pending claims. Every write is conditional and idempotent, so
  re-runs are harmless.
- The same sweeper publishes `ScheduleStalenessMinutes`, so a dead 25Live sync raises an alarm
  even though the sync itself has gone quiet.

### Event-driven notifications (BR-7)

Every state change appends an immutable `EVT#` item (`attribute_not_exists`, never updated). It
carries the request's **correlation id**.

DynamoDB Streams, filtered to `EVT#` inserts, feed `OnChangeFn`. It writes in-app notifications
idempotently: the notification key comes from the event id, so retries never duplicate.
Failures retry twice with batch bisection, then land in an SQS DLQ, which triggers an alarm.
The web app polls every 10 seconds and toasts new items.

### Privacy by construction: KMS (BR-5)

- **University IDs** are HMAC-SHA256'd with a pepper from Secrets Manager. Only the hash is
  stored, for uniqueness.
- **Contact info** is envelope-encrypted: a per-record data key from a KMS CMK, AES-GCM, and
  the user id as encryption context.
- **Only `RevealFn` holds `kms:Decrypt`.** It's a separate Lambda behind `/me` and
  `GET /claims/{id}/contact`. It returns the owner's chosen channel only to the requester of an
  APPROVED share-contact claim, until the reservation's end + 24 h, and audits every reveal.
- Every API test asserts that no response contains PII. Logs are redacted by key name.
- The infra test fails if any other role ever gets `kms:Decrypt`.

## Run it locally

```bash
pnpm install
pnpm dev:api        # DynamoDB Local + seed + mock 25Live + API on :3001
pnpm dev:web        # Vite on :5173 (proxies /api → :3001); sign in with any dev id, e.g. student1
pnpm --filter @freeroom/web dev:mock   # UI only, API mocked in the browser (MSW)
```

Requires Node ≥ 22.19 (CI uses 24), pnpm via `corepack enable`, and Docker or Java for DynamoDB Local.

## Tests and quality gates

```bash
pnpm lint && pnpm typecheck
pnpm test                       # 224 tests: domain rules, API integration on DynamoDB Local,
                                # 50-way concurrency, adversarial/IDOR audit, infra assertions
pnpm audit --audit-level high   # CI fails on high/critical
npx --prefix infra cdk synth -c stage=prod   # cdk-nag AwsSolutions: fails on unjustified findings
pnpm --filter @freeroom/api e2e              # 12 end-to-end API flows against a running API
BASE_URL=http://localhost:5173 SMOKE_OWNER=faculty1 SMOKE_CLAIMER=tutor1 pnpm --filter @freeroom/e2e smoke
BASE_URL=http://localhost:5173 SMOKE_OWNER=faculty1 pnpm --filter @freeroom/e2e lighthouse   # a11y ≥ 95
```

To run against a deployed stack, set `BASE_URL` to its URL and `E2E_USERS_FILE` to
`infra/.demo-users.<stage>.local.json` (written by the deploy).

See [docs/TRACEABILITY.md](docs/TRACEABILITY.md) for every rule mapped to its code and tests.

## Deploy

```bash
aws login
pnpm run deploy -- --stage dev  -c alarmEmail=<you@example.com>
pnpm run deploy -- --stage prod -c alarmEmail=<you@example.com>
```

The full guide (first-time bootstrap, the GitHub pipeline, secrets, SES, real 25Live, SAML) is
[DEPLOY.md](DEPLOY.md). Operations: [RUNBOOK.md](RUNBOOK.md). Security model:
[SECURITY.md](SECURITY.md). Pitch: [docs/PITCH.md](docs/PITCH.md).

## Roadmap (v1.1)

From PRD §0.3, plus what v1 deferred:

- **Campus SAML SSO**: config-ready (`-c samlMetadataUrl=…`), needs UMass IT metadata.
- **Live 25Live credentials**: the adapter is built and rate-limited; it needs the secret filled.
- **Natural-language search** with Bedrock: the LLM only produces the existing filter object.
- WebSockets instead of 10-second polling.
- Week view.
- Follow a room (notify when it frees up).
- Email-preference UI and SES email notifications.
- Full admin console (audit search, suspend users).
- Per-reservation reminder schedules.
- X-Ray tracing.
