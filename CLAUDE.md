# CLAUDE.md: FreeRoom

The product spec is **docs/PRD.md**. Read it before any task. **PRD §0 (production-ready v1 by the hackathon deadline, Sun 2026-11-15) overrides the rest of the PRD.** Build only what §0.2 keeps, and treat the §0.1 release gate as non-negotiable. The build prompts are in docs/CLAUDE_CODE_PROMPTS.md. Never compromise BR-1, BR-5, BR-6, or BR-8.

## Project
FreeRoom is a campus classroom availability and reservation web app. 25Live is the read-only source for rooms and classes. Reservations are ours (DynamoDB). Everything runs on AWS (serverless, CDK, TypeScript).

## Non-negotiable invariants (see PRD §3)
- BR-1: never allow a reservation that overlaps a 25Live class. Enforce on the server at write time.
- BR-6: nothing can be confirmed or approved at or after `start − 4h`. Use the server clock inside conditional writes.
- BR-8: double-booking prevention = TransactWriteItems with one slot LOCK per 15-min slot. Never use read-then-write.
- BR-5: contact info only via the contact-reveal path after an APPROVED claim. University IDs are stored only as HMAC.

## Conventions
- TypeScript strict, ESM, Node 20. pnpm workspaces. API = one Hono app (Lambdalith) on Lambda + HTTP API. Web = Vite + React SPA on S3/CloudFront. Infra = ONE CDK stack.
- Business logic lives in `packages/domain` as pure functions. Inject `now: Date`, and never call `Date.now()` there.
- API contracts are zod schemas in `packages/shared`, the single source of truth for web and api.
- DynamoDB key strings are built only in `services/api/src/data/keys.ts`. Real-time = polling (10s), not WebSockets.
- Times are stored in UTC ISO-8601 and displayed in America/New_York. Intervals are half-open `[start, end)`.
- Error codes match PRD §7 exactly.
- Every API handler test calls `assertNoPII(response)`.
- Logs are structured JSON with correlation IDs and redact universityId/email/phone/tokens.
- Contact info is KMS-encrypted at rest. Only the reveal Lambda has kms:Decrypt.
- Class vs reservation must be visually distinct by color AND pattern/icon.

## Commands
- `pnpm dev:api` starts DynamoDB Local + seed + sync + API on :3001 (mock 25Live is served at /mock25live)
- `pnpm dev:web` runs the Vite app on :5173 (VITE_USE_MOCKS=true for MSW mocks)
- `pnpm test` · `pnpm lint` · `pnpm typecheck` · `pnpm deploy -- --stage dev|prod`

## Workflow rules
- Finish a milestone with all checks green before starting the next. Commit per milestone.
- Write the tests for business rules first.
- Timebox: if a task balloons, commit what works and list what's left.
- Never enable demo endpoints or the dev auth bypass in prod.
- Ask before: deploying to a real AWS account, deleting resources, sending real emails, or changing the PRD.
- When unsure about a 25Live field name, keep it inside the 25Live `mapper.ts` with a TODO. Don't scatter assumptions.
