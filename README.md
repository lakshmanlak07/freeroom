# FreeRoom

Find an empty classroom on campus right now, reserve it in two taps, and never get bumped by a
class you didn't know about. 25Live is the read-only source of rooms and classes. Reservations,
claims and notifications are FreeRoom's own, on AWS serverless.

> FreeRoom reservations are informal and student-run, not an official university booking. The
> deployed demo runs on seeded campus data until UMass IT grants 25Live and SSO access (see
> DEPLOY.md).

## Core rules (enforced on the server, covered by tests)

| Rule | What it means                                     | How                                                                            |
| ---- | ------------------------------------------------- | ------------------------------------------------------------------------------ |
| BR-1 | No reservation may overlap a 25Live class         | Class slot locks + server check at write time                                  |
| BR-5 | Contact is shared only after an approved claim    | KMS-encrypted; only the reveal Lambda decrypts                                 |
| BR-6 | Nothing confirms or approves at/after start − 4 h | Server clock inside conditional writes; a 1-min sweeper auto-releases          |
| BR-8 | No double booking                                 | One `TransactWriteItems` with a LOCK per 15-min slot (50-way concurrency test) |
| BR-9 | Classes win                                       | Sync detects the conflict → release + notification with 3 alternatives         |

## Architecture

```
Browser ── CloudFront (+WAF in prod) ──┬── S3: React SPA (Vite)
                                       └── /api/* ── HTTP API (JWT) ── ApiFn (Hono)
                                                                   └── RevealFn (/me, contact; only kms:Decrypt)
DynamoDB (single table, PITR) ── Streams ── OnChangeFn ── in-app notifications (DLQ on failure)
EventBridge Scheduler ── SweeperFn (1 min, BR-6 + staleness) · SyncFn (25Live, 10 min daytime)
Cognito (email/password, SAML-ready) · KMS · Secrets Manager · Amazon Location · CloudWatch + SNS
```

The **one CDK stack per stage** (TypeScript) is in `infra/`. CI/CD is GitHub Actions with OIDC.

```
packages/domain   pure business rules (now injected; no Date.now())
packages/shared   zod API contract shared by web + api
services/api      Hono Lambdalith, data layer, 25Live adapter, sweeper/sync/notifier
apps/web          Vite + React SPA (MSW mocks for UI work)
infra             CDK stack, cdk-nag, post-deploy script
e2e               Playwright smoke + axe, Lighthouse
```

## Run it locally

```bash
pnpm install
pnpm dev:api        # DynamoDB Local + seed + mock 25Live + API on :3001
pnpm dev:web        # Vite on :5173 (proxies /api → :3001); sign in with any dev id, e.g. student1
pnpm --filter @freeroom/web dev:mock   # UI only, API mocked in the browser (MSW)
```

## Quality gates

```bash
pnpm lint && pnpm typecheck && pnpm test        # unit + integration (DynamoDB Local) + contract tests
pnpm audit --audit-level high                   # CI fails on high/critical
npx --prefix infra cdk synth -c stage=prod      # cdk-nag AwsSolutions: fails on unjustified findings
BASE_URL=http://localhost:5173 SMOKE_OWNER=faculty1 SMOKE_CLAIMER=tutor1 pnpm --filter @freeroom/e2e smoke
BASE_URL=http://localhost:5173 SMOKE_OWNER=faculty1 pnpm --filter @freeroom/e2e lighthouse   # a11y ≥ 95
```

To run against a deployed stack, set `BASE_URL` to its URL and `E2E_USERS_FILE` (or
`E2E_USERS`) to the stack's test-user logins. The pipeline does this automatically.

## Docs

- [DEPLOY.md](DEPLOY.md): first-time setup, the pipeline, secrets, SES, real 25Live, SAML.
- [RUNBOOK.md](RUNBOOK.md): alarms and what to do, force-release, secret rotation, PITR restore.
- [SECURITY.md](SECURITY.md): PII handling, controls, threat model, accepted risks.
- [docs/PRD.md](docs/PRD.md): product spec (§0 is the v1 release scope).
