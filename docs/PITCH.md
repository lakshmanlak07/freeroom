# FreeRoom: pitch kit

## Before you go on stage (5 minutes earlier)

1. Open the dev site and sign in as **admin1** (logins in `infra/.demo-users.dev.local.json`).
2. **Demo → Reset demo data.** This gives you:
   - fresh busy and free buildings on the map;
   - a claimable room owned by Early Bird (student2);
   - Night Owl's (student1) pending reservation, about 30 minutes from its cutoff;
   - an incoming claim on Night Owl's other room.
3. Open a second browser profile (or an incognito window) signed in as **student1**. Keep both
   side by side.
4. The venue Wi-Fi shares one IP. The prod WAF allows 300 API calls per 5 min per IP, and the
   demo runs on **dev**, which has no WAF.

## 3-minute script (follows PRD §14)

| Time | Beat | What you do | What you say |
|---|---|---|---|
| 0:00–0:20 | **Hook** | Landing page on screen | "It's 2pm. You and four friends need a room for a midterm review. Every classroom on campus shows up in 25Live, but nothing tells you which ones are empty *right now*. Watch." |
| 0:20–0:50 | **Map** | Sign in → **Map**. Point at the colored markers, then tap the red building | "Every building is colored by how many rooms are free this minute: green, amber, red, with the percentage printed on the marker, so it never relies on color alone. Tap one and you get its free rooms with live status: *free until 3:15*." |
| 0:50–1:10 | **Natural-language search** | Type in the top bar: **room for 5 with a whiteboard near the library until 5** → Enter. Point at the chips, then ✕ one | "Or just say what you need. It's parsed into filters you can see and edit: capacity 5, whiteboard, Du Bois, now until 5. The model can only fill in filters; it can't book anything, and the results come from the same live search." *(The label reads "Understood by AI" with Bedrock, "Smart search" with the built-in parser.)* |
| 1:10–1:40 | **Timeline** | Open a room → hover a purple striped block, then drag across free space → **Reserve** | "Classes are purple, striped and marked with a book; reservations are blue with a person. Hover a class and you get everything 25Live knows: course, section, department. Drag to reserve, two taps." |
| 1:40–2:20 | **The hard parts** | (a) Drag over a class → error with the class name. (b) Both windows: same slot, click **Reserve** at the same time → one wins, one gets "already reserved". (c) As student1: **My reservations → Approve… → Share my contact**; in the other window **Show contact** | "Try to book over a class: blocked on the server, with the class name. Two people race for the same slot: one wins, every time. That's a DynamoDB transaction with a lock per 15-minute slot, tested with 50 parallel requests. Need a held room? Ask. The holder approves, and only then do you see the one contact they chose to share. It's encrypted with KMS, and only one Lambda in the whole system can decrypt it." |
| 2:20–2:40 | **Resilience** | Admin window: **Demo → pick Night Owl's room → Inject class conflict.** Student window: the toast appears, then **Notifications** | "Now the registrar schedules a class in Night Owl's room. 25Live always wins: the reservation is released and Night Owl gets a notification right away, with three free alternatives. One tap, rebooked." |
| 2:40–3:00 | **Architecture** | Architecture slide | "It's all serverless AWS and event-driven: DynamoDB transactions, Streams for notifications, and a one-minute sweeper that enforces the 4-hour confirm rule with the server's clock. WAF, alarms, a runbook, about $8 a month. Plug in UMass's 25Live and SSO credentials and it's live. That's configuration, not code." |

**If something breaks:** the inject-conflict and race beats also work in mock mode
(`pnpm --filter @freeroom/web dev:mock`). Record a backup video of the full run beforehand.

## 5 slides

1. **The problem.** "Students wander halls looking for empty rooms; 25Live knows the schedule
   but not what's free *now*." One photo of a hallway, one number (rooms on campus).
2. **The product.** The map + timeline screenshots. Three verbs: Find, Reserve, Claim. "Classes
   always win."
3. **The hard parts.** The four guarantees and how each is enforced:
   - no booking over a class: class slot locks;
   - no double booking: one transaction, one lock per 15-minute slot;
   - 4-hour cutoff: server-clock conditional writes + a 1-minute sweeper;
   - private contact: KMS, one decrypting Lambda.
   Back each with its test ("50 parallel → 1 wins").
4. **Architecture.** The Mermaid diagram from the README. Callouts: serverless, event-driven,
   WAF + alarms + runbook, about $8/month, cdk-nag clean, 253 automated tests + Playwright,
   Lighthouse accessibility 100.
5. **Adoption + roadmap.** UMass IT flips two switches (25Live credentials in Secrets Manager,
   SAML metadata). Next: WebSockets, follow-a-room, week view.

## 10 judge questions

1. **Does it scale?** Every piece scales per request: Lambda, HTTP API, DynamoDB on-demand.
   Locks are keyed by room + slot, so load spreads across partitions; contention only exists
   where it should (two people, one room, one slot). The sync is per room-day, rate-limited
   against 25Live. The real ceiling today is this account's 10-Lambda concurrency quota, which
   is a quota request away.
2. **What does it cost?** About $8/month at demo scale, almost all of it the prod WAF.
   Everything else is pay-per-request and inside the free tier. At campus scale (say 20k users)
   it's tens of dollars a month: there are no servers or databases idling.
3. **How do you protect privacy?**
   - University IDs are never stored, only an HMAC with a secret pepper.
   - Contact info is KMS envelope-encrypted, and only one Lambda can decrypt it.
   - It's revealed only to the requester of an approved claim, only the channel the owner chose,
     and it expires at the reservation's end + 24 h. Every reveal is audited.
   - Tests fail if any other response contains PII, and logs are redacted.
4. **Why DynamoDB and not Postgres?** The core guarantee is "no two reservations overlap, under
   concurrency". With DynamoDB that's one `TransactWriteItems` with a conditional lock per
   15-minute slot: atomic, no read-then-write race, no connection pool. Streams give us the
   event bus for free, it's serverless-native, and it costs nothing idle. Range queries (a room's
   day, a user's bookings) are single-partition key designs.
5. **What if 25Live goes down?** Reads keep working from the cached schedule. Class locks from
   the last good sync still block bookings over known classes. If the cache for a room is older
   than 6 hours, we **fail closed**: no new bookings there rather than risk BR-1. An alarm fires
   after 60 minutes of staleness, and the runbook says what to do.
6. **How do you know double booking is impossible?** It's enforced by the database, not by app
   logic: the transaction fails if any 15-minute slot is already locked. It's proven by a
   50-parallel-request test (exactly 1 succeeds), and an adversarial test fires 9
   different-but-overlapping intervals at once (exactly 1 succeeds). Retries are safe thanks to
   idempotency keys.
7. **Is it accessible?**
   - Status is always color + icon + text, never color alone.
   - The whole timeline works by keyboard, and class tooltips appear on focus.
   - There's a text view for screen readers.
   - axe-core finds 0 serious violations on every main page, and Lighthouse accessibility
     scores 100 on home, room and map.
8. **How would UMass actually adopt it?** v1 already has a production 25Live adapter
   (rate-limited, with backoff) and SAML-ready Cognito. IT gives us read-only 25Live credentials
   (one Secrets Manager value) and IdP metadata (one deploy flag). No code changes. It's clearly
   labelled as informal and student-run, so it complements official room booking instead of
   competing with it.
9. **What stops abuse (squatting, spam, bots)?**
   - Per-role quotas: students can hold 2 active reservations, and 3 open claims.
   - Unconfirmed bookings auto-release at the 4-hour cutoff, so squatting doesn't stick.
   - A WAF with AWS managed rules and a per-IP rate limit, plus API throttling.
   - The API refuses traffic that bypasses CloudFront.
   - zod validation on every input, idempotency keys, and server-side authorization in the
     domain layer (tested against IDOR on every route).
10. **What's next?**
    - WebSockets instead of polling.
    - Follow a room to get notified when it frees up.
    - Campus SSO and live 25Live, as soon as IT says yes.
