# Security

FreeRoom holds two kinds of personal data: a University ID (used once, for uniqueness) and the
contact detail a user chooses to share (email or phone). Everything below is enforced in code or
infrastructure and covered by tests unless marked as an accepted risk.

Report a vulnerability privately to the repository owner (GitHub → Security → Report a
vulnerability). Please don't open a public issue.

## PII handling

| Data                  | Where it lives                                  | Protection                                                                                            | Who can read it                                                                                        |
| --------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| University ID         | Never stored. `UID#<hmac>` uniqueness item only | HMAC-SHA256 with a 64-char pepper from Secrets Manager (`freeroom/<stage>/uid-pepper`)                | Nobody; it's one-way                                                                                   |
| Contact (email/phone) | `USER#<id>` / `PRIVATE`, as ciphertext          | KMS envelope encryption, CMK `alias/freeroom-<stage>-pii` (rotation on), encryption context = user id | **Only RevealFn** has `kms:Decrypt` (stack test `RevealFn is the ONLY function role with kms:Decrypt`) |
| Display alias         | `USER#<id>` / `PROFILE`                         | Public by design (shown on bookings)                                                                  | Everyone                                                                                               |

- **BR-5, contact reveal:** `GET /claims/{id}/contact` (RevealFn) returns the owner's chosen
  channel only to the requester of an **APPROVED, share-contact** claim, until the reservation's
  end + 24 h. Every reveal writes an `AUDIT#` item. `/me` (also RevealFn) returns your own
  contact. No other response contains contact data. Every API handler test runs
  `assertNoPII(response)`, and the e2e flow checks the register and approve responses too.
- **Logs:** structured JSON. Keys like `universityId`, `email`, `phone`, `contact`,
  `authorization`, `token`, `password`, `x-dev-user` and anything ending in `Enc` are replaced by
  `[REDACTED]` at any depth (`services/api/src/logger.ts`, unit-tested). Provider errors that
  could echo an address are logged by error name only.
- **Retention (DynamoDB TTL):** notifications 30 days, reveals end + 24 h, audit events 1 year.
- **Tokens:** Cognito ID tokens carry `sub` and the role claim from our DB (pre-token Lambda),
  never the University ID or contact.

## Authentication and authorization

- Cognito email + password (12+ characters with upper, lower, digit and symbol) and SRP. Campus
  SAML is ready as configuration (`-c samlMetadataUrl=…`, see DEPLOY.md).
- API Gateway's JWT authorizer guards every route except the public, PII-free room reads
  (`/health`, `/buildings`, `/rooms…`). Roles come from our table, not the token, and are checked
  in the domain layer (`can(actor, action, resource)`), not only in routes.
- **Dev auth bypass and demo endpoints cannot reach prod.** There are three independent layers:
  1. CDK refuses `stage=prod` with `demoMode=true` (stack test).
  2. No deployed function runs with `NODE_ENV=development`, the only value that enables the
     `x-dev-user` header (stack test).
  3. `createApp` throws at cold start if `STAGE=prod` and any of dev auth, mock 25Live or demo is
     on (API test `refuses dev auth / demo / mock 25Live in prod`).

## Abuse protection

- **WAF on CloudFront (prod):** a 300 requests / 5 min per-IP rate limit on `/api/*`, plus the
  AWS managed Common Rule Set and Known Bad Inputs. The API is served from the same CloudFront
  distribution (`/api/*`), so the WAF covers the API, not just static files.
- **API Gateway throttling:** 50 rps steady, 100 burst (stage default).
- **Per-user quotas**, checked inside the same write transaction: active reservations per role
  (student 2, faculty 5, tutor 3), 3 open claims, 1 claim per reservation.
- **Input validation:** zod on every handler, with shared schemas in `packages/shared`. Free text
  is trimmed, sanitized and length-limited (purpose 140, claim message 280). `Idempotency-Key` is
  required on reservation create.
- **Double booking (BR-8):** one `TransactWriteItems` with a LOCK per 15-minute slot, proven by
  a 50-way concurrency test.

## Transport and browser

- HTTPS only (CloudFront redirects HTTP; `/api/*` is HTTPS-only).
- HSTS (2 years, preload), a strict CSP (`default-src 'self'`, no inline scripts,
  `frame-ancestors 'none'`), `X-Frame-Options: DENY`, `nosniff` and a strict referrer policy.
- The SPA calls the API same-origin, so production has **no CORS**. Dev allows only
  `http://localhost:5173`.
- The Amazon Location API key is restricted to `geo:GetMap*` on our map, from our origin.

## Infrastructure

- One role per function, scoped to the table **with `dynamodb:LeadingKeys`** (key-prefix level).
  Secrets and keys are granted per function. The stack tests assert there is no `Resource: "*"`
  except the two AWS requires (`dynamodb:ListStreams`, and CloudFront invalidation inside CDK's
  BucketDeployment).
- **cdk-nag (AwsSolutions) runs on every `cdk synth`, including CI.** Acknowledged findings, each
  with its reason in `infra/lib/nag.ts`:
  - IAM4: AWSLambdaBasicExecutionRole (logs only).
  - IAM5:
    - GSI ARNs, constrained by LeadingKeys.
    - `fn:*` from grantInvoke.
    - Bedrock models.
    - CDK bootstrap roles for the deploy role.
    - The WAF ACL name pattern.
    - CDK BucketDeployment / Provider internals.
  - L1: CDK-managed handler runtimes. Ours run Node 24.
  - APIG4: the public room-read routes.
  - CFR1: no geo restriction.
  - CFR3: CloudFront access logs (cost).
  - CFR4: default certificate TLS policy.
  - CFR2: no WAF in dev, by owner decision on cost.
  - S1: the site bucket has no access logs.
  - COG2: MFA isn't required; SSO brings MFA.
  - COG8: Cognito Plus (paid).
  - SMG4: secrets without rotation (pepper, 25Live, test users; see RUNBOOK.md).
  - SQS3: the DLQ itself has no DLQ.
- **CI/CD uses GitHub OIDC, with no long-lived AWS keys.**
  - The dev deploy role trusts only `repo:lakshmanlak07/freeroom:ref:refs/heads/main`.
  - The prod deploy role trusts only that repo's `prod` environment.
  - Both roles can only assume the CDK bootstrap roles, plus narrow post-deploy grants (sync
    invoke, test-user secret, LeadingKeys-scoped table access, Cognito admin on our pool).
- The table has PITR on, and deletion protection in prod. Prod keeps the CMK, secrets, logs and
  site bucket on stack deletion.

## Threat model (brief)

| Threat                 | Example                                          | Mitigation                                                                                                                                        |
| ---------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spoofing               | Forged identity / role                           | Cognito JWT verified by API Gateway and again in the Lambda; role read from DB; dev auth impossible in prod                                       |
| Tampering              | Book over a class, double-book, act after cutoff | Server-side BR-1 class locks, BR-8 slot-lock transactions, BR-6 server-clock conditions inside the write                                          |
| Repudiation            | "I didn't approve that"                          | Append-only `EVT#` audit events (`attribute_not_exists`), reveal `AUDIT#` items, correlation IDs across API, event and notifier logs              |
| Information disclosure | Harvest contacts or University IDs               | HMAC-only UID; KMS envelope encryption; one decrypting function; reveal only after an approved claim; `assertNoPII` contract tests; log redaction |
| Denial of service      | Flood the API, exhaust quotas                    | WAF rate rule + managed rules (prod), API Gateway throttling, per-user quotas, Lambda timeouts, on-demand DynamoDB                                |
| Elevation of privilege | Student acts as admin                            | Domain `can()` checks, admin role only via DB, demo routes admin-only and absent in prod                                                          |

## Accepted risks / known gaps

- **Direct `execute-api` URL bypasses the WAF.** Requests still need a valid JWT for anything
  non-public and still hit stage throttling and per-user quotas. _Upgrade path:_ a secret origin
  header set by CloudFront and checked by the API.
- No WAF on the **dev** stage (owner decision on cost: about $8/month). No required MFA. Cognito
  threat protection is off (paid tier).
- CloudFront uses the default `*.cloudfront.net` certificate; set TLS 1.2+ when attaching a
  custom domain.
- `pnpm audit` has no high or critical findings, and CI fails on any. Two **moderate**, dev-only
  advisories remain:
  - `@hono/node-server` (local dev server only; `serveStatic` isn't used).
  - `minimatch` (inside ESLint tooling).
