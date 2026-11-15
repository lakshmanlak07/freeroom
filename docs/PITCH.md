# FreeRoom: pitch kit

## Before you go on stage (5 minutes earlier)

1. Open the dev site and sign in as **admin1** (logins in `infra/.demo-users.dev.local.json`).
2. **Demo → Reset demo data.** This gives you:
   - fresh busy and free buildings on the map;
   - a claimable room owned by Early Bird (student2);
   - Night Owl's (student1) pending reservation, about 30 minutes from its cutoff;
   - an incoming claim on Night Owl's other room.
3. Open a second browser profile (or an incognito window) signed in as **student1**. Keep both
   side by side. Leave the fox on in the student window (sidebar → Fox companion).
4. The venue Wi-Fi shares one IP. The prod WAF allows 300 API calls per 5 min per IP, and the
   demo runs on **dev**, which has no WAF.
5. The dev demo also **resets itself every 2 hours**. The Demo panel shows "Last reset". First-time
   visitors get a 4-step guided tour; dismiss it once in each presenter window.
6. Have a phone ready with the dev site open (for the "works on your phone" moment).

## 15-second hook

"25Live knows when every classroom has a class, but nobody can see which rooms are empty *right
now*. FreeRoom is Google Maps for empty classrooms: see a free room, book it in two taps, and a
class can never kick you out by surprise, because the database makes double booking impossible."

## 60-second version

| Time | Say | Show |
|---|---|---|
| 0:00–0:10 | "Every student knows the walk: hallway after hallway, peeking into rooms. 25Live has the schedule, but not what's free *now*." | Landing: "47 of 80 rooms free right now on campus" |
| 0:10–0:25 | "FreeRoom colors every building by how free it is this minute. Tap one, pick a room, drag on its timeline, done." | Map → building → room → reserve |
| 0:25–0:40 | "Two people click the same slot at the same moment: one wins, every time. That's a DynamoDB transaction with a lock per 15-minute slot, tested with 50 parallel requests. And classes always win: if the registrar adds one, you're released and offered three free rooms." | Race in two windows; class-conflict notification |
| 0:40–0:55 | "Contact details are KMS-encrypted and only one Lambda can decrypt them. It works on your phone, in dark mode, and it's fully serverless on AWS for about eight dollars a month." | Phone + dark toggle |
| 0:55–1:00 | "Plug in UMass's 25Live and SSO credentials and it's live. Configuration, not code." | Architecture slide |

## 20-second beat: book → invite → walk (new)

| Time | What you do | What you say |
|---|---|---|
| 0:00–0:05 | Reserve a room → the **You're booked** card pops (confetti, the fox celebrates) | "Booked. Now the part every study group needs." |
| 0:05–0:10 | **Invite your group** → the ticket with its QR → hold your phone to the second screen; it scans and opens the invite | "One link, or one scan. No phone numbers swapped — just aliases." |
| 0:10–0:14 | On the friend's screen: **Join** → sign in → back on the invite, **You're in!** | "They join in one tap, and it goes straight into their calendar." |
| 0:14–0:20 | **Get me there** → the route draws on, the fox trots it, "7 min walk · Free for 1h 23m after you arrive" | "And it walks them there — and tells them the room will still be free when they arrive." |

## 3-minute script (follows PRD §14)

| Time | Beat | What you do | What you say |
|---|---|---|---|
| 0:00–0:20 | **Hook** | Landing page on screen; point at the live count | "It's 2pm. You and four friends need a room for a midterm review. Every classroom on campus shows up in 25Live, but nothing tells you which ones are empty *right now*. This number is live: 47 of 80 rooms are free this minute. Watch." |
| 0:20–0:50 | **Map** | Sign in → **Map**. Point at the colored markers, then tap the red building | "Every building is colored by how many rooms are free this minute: green, amber, red, with the percentage printed on the marker, so it never relies on color alone. Tap one and you get its free rooms with live status: *free until 3:15*." |
| 0:50–1:10 | **Natural-language search** | Type in the top bar: **room for 5 with a whiteboard near the library until 5** → Enter. Point at the chips, tap the capacity chip and type 6, then ✕ one | "Or just say what you need. It's parsed into filters you can see and edit: capacity, whiteboard, Du Bois, now until 5. The parser can only fill in filters; it can't book anything." *(The label reads "Understood by AI" with Bedrock, "Smart search" with the built-in parser.)* |
| 1:10–1:40 | **Timeline** | Open **LGRT 0101** (on a weekend press **›** to Monday). Hover a purple striped block, then drag across free space → **Reserve**. The fox celebrates | "Classes are purple, striped and marked with a book; reservations are blue with a person. Hover a class and you get everything 25Live knows. Drag to reserve: two taps. Our fox approves." |
| 1:40–2:20 | **The hard parts** | (a) Drag over a class → the sheet names the class and **Reserve** stays disabled. (b) Both windows on the same free slot, click **Reserve** together → one "Reserved", the other "already reserved". (c) Student window: **My reservations → Approve… → Share my contact** on Early Bird's request | "Try to book over a class: it names the class and won't let you, and the server enforces the same rule. Two people race for one slot: one wins, every time. That's one DynamoDB transaction with a lock per 15-minute slot, tested with 50 parallel requests. Need a held room? Ask. Only after the holder approves does the requester see the one contact the holder chose, and only one Lambda can decrypt it." |
| 2:20–2:40 | **Resilience** | Admin window: **Demo → Room = Night Owl's room → Day → pick the reservation → Inject class conflict.** Student window: **Notifications** (lands within ~10 s) | "Now the registrar schedules a class in Night Owl's room. 25Live always wins: the reservation is released and Night Owl gets three free alternatives. One tap, rebooked." |
| 2:40–3:00 | **Phone + architecture** | Hold up the phone (bottom sheet, dark mode), then the architecture slide | "It works on your phone and in dark mode. Under the hood it's serverless AWS: DynamoDB transactions, Streams for notifications, a one-minute sweeper enforcing the 4-hour confirm rule on the server clock, WAF, alarms, a runbook, 330 automated tests plus 60 browser tests. Plug in UMass's 25Live and SSO and it's live." |

**Dry runs (automated, `pnpm --filter @freeroom/e2e pitch`, admin1 + student1, on the local stack):**
clicks alone take ~17–28 s; the rest is narration.

**If something breaks:** the inject-conflict and race beats also work in mock mode
(`pnpm --filter @freeroom/web dev:mock`). Record a backup video of the full run beforehand.

## 5 slides

1. **The problem.** "Students wander halls looking for empty rooms; 25Live knows the schedule
   but not what's free *now*." One hallway photo, one number (rooms on campus).
2. **The product.** Map + timeline + phone screenshots. Three verbs: Find, Reserve, Claim.
   "Classes always win."
3. **The hard parts.** Four guarantees, each enforced on the server and backed by a test:
   - no booking over a class: class slot locks (and a sync that repairs itself after a crash);
   - no double booking: one transaction, one lock per 15-minute slot (50 parallel → 1 wins);
   - 4-hour cutoff: server-clock conditional writes + a 1-minute sweeper;
   - private contact: KMS, one decrypting Lambda, HMAC'd University IDs.
4. **Architecture.** `docs/devpost/architecture.png`. Callouts: serverless, event-driven,
   WAF + alarms + runbook, ~$8/month, cdk-nag clean, 330 + 60 tests, Lighthouse accessibility
   100, a self-audit with every High fixed.
5. **Adoption + roadmap.** UMass IT flips two switches (25Live credentials in Secrets Manager,
   SAML metadata). Next: follow a room, week view, WebSockets.

## The 12 hardest judge questions

1. **Why not just use 25Live?** 25Live is the registrar's scheduling system: it answers "when
   is this room booked for classes?", not "which room near me is free right now, for 5 people,
   with a projector?". It has no live free-room view for students and no lightweight student
   holds. FreeRoom reads 25Live (read-only) and never writes to it, so it complements it.
2. **How do you get UMass adoption?** Start student-led: it's labelled informal and
   student-run, so it needs no policy change. Then IT gives read-only 25Live credentials (one
   Secrets Manager value) and SAML metadata (one deploy flag). The adapter is built and
   rate-limited; no code changes. Pitch to IT: fewer "is this room free?" tickets and
   real usage data on study space.
3. **What happens when 25Live is down?** Reads keep working from the cached schedule, and class
   locks from the last good sync still block bookings over known classes. If a room's cache is
   older than 6 hours we **fail closed** (no new bookings there). An alarm fires after 60 minutes
   of staleness. A malformed 25Live response now aborts the sync instead of wiping classes, and
   a sync that dies half-way is repaired by the next run (both tested).
4. **How is double booking impossible?** The database enforces it: each reservation writes one
   lock item per 15-minute slot with `attribute_not_exists`, all in one `TransactWriteItems`
   with the reservation, quota and audit event. If any slot is taken, nothing commits. No
   read-then-write. Proven by a 50-parallel-request test (exactly 1 succeeds), an adversarial
   test with 9 overlapping intervals at once, and idempotency keys for safe retries.
5. **Privacy?** University IDs are never stored, only an HMAC with a secret pepper. Contact
   info is KMS envelope-encrypted (encryption context = the user), and only the reveal Lambda
   has `kms:Decrypt` (an infra test fails otherwise). It's shown only to the requester of an
   approved claim, only the channel the holder chose, until the reservation ends + 24 h, and
   every reveal is audited. Every API test asserts no PII in responses; logs redact PII even
   inside error messages.
6. **Cost at 30k students?** Everything is pay-per-request with nothing idling. Assuming 20%
   daily actives polling for ~10 minutes, that's roughly 15–20M requests a month: on the order of
   $50–80/month for API Gateway, Lambda, DynamoDB and CloudFront, plus ~$8 for the WAF.
   [CHECK: back-of-envelope, not measured.] Known next optimization from our audit: cache the
   public availability reads at CloudFront for a few seconds.
7. **Abuse and no-shows?** Per-role quotas (students: 2 active reservations, 3 open claims).
   Unconfirmed bookings auto-release at start − 4 h, so squatting doesn't stick. WAF managed
   rules and a per-IP rate limit, API throttling, and the API refuses traffic that bypasses
   CloudFront. zod validation on every input and authorization checks on every `:id` route,
   tested against IDOR.
8. **Why AWS serverless?** The load is spiky (class changes, exam weeks) and mostly idle at
   night: pay-per-request fits, and there are no servers to patch. DynamoDB transactions give us
   the core guarantee natively, Streams give us the event bus, EventBridge Scheduler runs the
   sweeper and sync. One CDK stack per stage, cdk-nag clean.
9. **What's the business model?** Free for students. Universities pay a small annual campus
   license (or student government sponsors it) for SSO, 25Live integration and usage analytics
   on study-space demand. Running cost is tens of dollars a month, so margins are high.
10. **Accessibility?** Status is always color + icon + text. The whole timeline works by
    keyboard with tooltips on focus, plus a text view for screen readers. axe finds 0 serious
    violations on every main page in light *and* dark mode; Lighthouse accessibility is 100.
    44 px touch targets, 16 px inputs, reduced-motion respected (the fox stands still).
11. **What would you build next?** Follow a room (notify when it frees up), week view,
    WebSockets instead of 10-second polling, campus SSO + live 25Live as soon as IT says yes,
    and closing pending claims automatically when a booking is cancelled (logged in our audit).
12. **What was hardest?** Making the guarantees hold under failure, not just under the happy
    path: concurrent clicks, a 25Live sync dying half-way, a clock that must be trusted at the
    4-hour cutoff, and an AWS account whose policies blocked us-east-1 and GitHub OIDC (we built
    the WAF through a custom resource and kept the pipeline opt-in). And a map that rendered
    everywhere except production, until we found maplibre's worker was a 403 behind CloudFront
    and moved to Amazon Location Maps API v2.
