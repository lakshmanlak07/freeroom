# FreeRoom: hackathon submission

> Paste-ready. The demo **passwords** are not in git. Run
> `node scripts/submission-logins.mjs` to write `docs/SUBMISSION.local.md`, this file with the dev
> demo logins filled in, and paste that one.

## Links

- **Live demo (sample data, demo accounts):** https://d36vb3bto2ikso.cloudfront.net
- **Production deployment:** https://d14abz6mtvapjq.cloudfront.net (no demo data; it links to the demo)
- **Code:** https://github.com/lakshmanlak07/freeroom
- **Architecture diagram:** `docs/architecture.png`

## Demo logins (dev site only)

On the demo site: **Sign in → "Demo as Student / Faculty / Admin"**. That fills in the email; then
enter the password below. First-time visitors get a 4-step guided tour. The demo resets itself
every 2 hours.

| Role | Email | Password |
|---|---|---|
| Student (Night Owl) | student1@demo.freeroom.test | `<<student1>>` |
| Student (Early Bird) | student2@demo.freeroom.test | `<<student2>>` |
| Faculty (Prof. Maple) | faculty1@demo.freeroom.test | `<<faculty1>>` |
| Admin (Demo panel) | admin1@demo.freeroom.test | `<<admin1>>` |

## Tagline

Google Maps for empty classrooms.

## Inspiration

Every UMass student knows the walk: hallway after hallway, peeking through door windows, looking
for an empty room for a group project or a quiet hour before an exam. The registrar's system,
25Live, knows exactly when every classroom has a class, but nobody can see what's free *right
now*, and nothing stops you from settling into a room that a class needs in twenty minutes. We
wanted the campus equivalent of a live map: open it, see free rooms, grab one, and never get
bumped by a class you didn't know about.

## What it does

- **Find:** a live campus map colors every building by how many rooms are free this minute.
  Search with filters, or just type "room for 6 with a projector near the library at 3pm". It
  becomes editable filter chips.
- **Read the schedule:** each room has a day timeline. 25Live classes are purple, striped and
  marked with a book; student reservations are blue with a person. That's color *and* pattern
  *and* icon, plus a screen-reader text view.
- **Reserve in two taps.** Classes always win: you can't book over one, and if the registrar adds
  a class later, your booking is released and you're instantly offered **three free
  alternatives** with one-tap rebook.
- **No double booking, ever**, even when two people click at the same moment.
- **Confirm or lose it:** reservations must be confirmed between 24 h and 4 h before the start.
  Unconfirmed ones auto-release so rooms don't get squatted.
- **Claim a held room:** ask politely. The holder can share their contact or transfer the booking.
  Contact details are revealed only after the holder approves, and only the one channel they
  chose.
- **Admin demo controls:** inject a surprise class, fast-forward to a cutoff, reset the demo.

## How we built it

Fully serverless on AWS, one CDK stack per stage, TypeScript end to end (strict, ESM).

| Service | Why |
|---|---|
| **Amazon DynamoDB** (single table, Streams, TTL, PITR) | The core guarantee, "no two reservations overlap under concurrency", is one `TransactWriteItems` with a conditional **lock item per 15-minute slot**. Streams give us an event bus for free. Pay per request. |
| **AWS Lambda** (Node 24, ARM) + **API Gateway HTTP API** | One Hono "Lambdalith" for the API, plus a separate **RevealFn**, the *only* function allowed to decrypt contact info. |
| **Amazon CloudFront + S3** (+ **AWS WAF** in prod) | SPA hosting and same-origin `/api/*` routing, so the WAF (rate limit + AWS managed rules) protects the API too. A secret origin header stops anyone from bypassing it. |
| **Amazon EventBridge Scheduler** | The every-minute sweeper (4-hour cutoff, staleness metric), the 25Live sync, and the dev demo's 2-hourly self-reset. |
| **Amazon Cognito** | Email/password with University-ID registration and roles via a pre-token Lambda. SAML-ready for campus SSO. |
| **AWS KMS + Secrets Manager** | Envelope encryption of contact info (encryption context = user); an HMAC pepper so University IDs are never stored. |
| **Amazon Location Service** | The campus map, with an API key restricted to map reads from our origin. |
| **Amazon Bedrock** (Claude Haiku 4.5, cross-region inference profile) | Natural-language search. The model can only fill in the filter object (one forced tool, zod-validated); a deterministic parser takes over on any error. |
| **Amazon CloudWatch + SNS** | JSON logs with correlation IDs that flow from API to DynamoDB event to notifier, EMF business metrics, a dashboard, and alarms emailed via SNS. |

Quality: 255 automated tests (domain rules, integration on DynamoDB Local, a 50-way concurrency
test, adversarial/IDOR tests, infra assertions), Playwright smoke + axe accessibility checks,
Lighthouse accessibility 100, and cdk-nag (AwsSolutions) clean.

## Challenges we ran into

- **Making double booking impossible, not just unlikely.** Read-then-write checks race. We modeled
  every 15-minute slot as its own lock item and write the reservation, its locks, the quota and
  an audit event in a single DynamoDB transaction. The 25Live sync writes *class* locks on the
  same keys, so even a request that skipped our class check can't commit over a class.
- **The 4-hour cutoff with a clock you can trust.** "No approval at or after start − 4h" must hold
  even if a request arrives a millisecond late, so the server's clock is a condition inside the
  write itself, and a one-minute sweeper releases what wasn't confirmed. Tests pin the clock to
  the exact millisecond on both sides of the cutoff.
- **An AWS account that said "no".** Our hackathon account's service control policy only allows
  **us-east-2** and denies CloudFormation in us-east-1, where CloudFront WAF web ACLs must live.
  We create the WebACL through a custom resource in our us-east-2 stack, calling the WAF API
  directly. The same policy denies creating a GitHub OIDC provider, so our complete GitHub
  Actions deploy pipeline is opt-in until it runs in an unrestricted account. Bedrock goes through
  a **us cross-region inference profile** callable from us-east-2.
- **Privacy that's provable.** Every API test asserts no PII in the response, an infra test fails
  if any role other than RevealFn ever gets `kms:Decrypt`, and logs are redacted at the source.

## Accomplishments that we're proud of

- A real, deployed, monitored production system, not a mock-up: WAF, alarms, dashboard, runbook,
  PITR, cdk-nag clean.
- Business rules enforced by the database and proven by tests, including a release audit that
  tried to break them (and fixed what it found).
- Accessibility as a feature: color + pattern + icon + text, full keyboard support, 0 serious axe
  violations, and Lighthouse accessibility 100.

## What we learned

- Push invariants down to the data layer. A transaction with conditional lock items is simpler
  *and* stronger than application-level checks.
- Let the LLM do the one thing it's good at (understanding a messy sentence) and nothing else.
  The output is a typed filter object, never an action.
- Account guardrails are real engineering constraints. Design for them early, document the
  workaround, and keep the "proper" path committed for when the account allows it.

## What's next

- Campus SAML SSO activation and live 25Live credentials (configuration only, waiting on UMass IT).
- WebSockets instead of 10-second polling.
- Week view of a room.
- Follow a room and get notified when it frees up.
- An email-preference UI, and SES email notifications.
- A full admin console (audit search, suspend users).
- Per-reservation reminder schedules.
- X-Ray tracing.

## Built with

`aws` `aws-cdk` `aws-lambda` `amazon-dynamodb` `dynamodb-streams` `amazon-api-gateway`
`amazon-cloudfront` `amazon-s3` `aws-waf` `amazon-cognito` `aws-kms` `aws-secrets-manager`
`amazon-eventbridge-scheduler` `amazon-location-service` `amazon-bedrock` `claude`
`amazon-cloudwatch` `amazon-sns` `typescript` `node.js` `hono` `react` `vite` `tailwindcss`
`tanstack-query` `maplibre` `zod` `vitest` `playwright` `axe-core` `lighthouse` `cdk-nag`
`github-actions`
