# 90-second demo video: shot list

Raw footage: `docs/demo.webm`, a 1440×900 recording of the student window running the PITCH.md
happy path. Re-record with:

```bash
BASE_URL=http://localhost:5174 RECORD=../docs/demo.webm pnpm --filter @freeroom/e2e pitch
```

That's local; for the live dev site add `E2E_USERS_FILE=../infra/.demo-users.dev.local.json`.
Cut it to the beats below, slow the clicks down to readable speed (about 0.7×), and record the
voice-over separately. Before recording on the live site, run **Demo → Reset demo data** for a
fresh map.

| # | Time | On screen | Voice-over |
|---|---|---|---|
| 1 | 0:00–0:08 | Landing page: "Google Maps for empty classrooms." | "Need a room for your study group right now? 25Live knows every class on campus, but not what's empty this minute." |
| 2 | 0:08–0:20 | Map: buildings colored green/amber/red with the percentage on each marker; tap the reddest one, and the room list slides in | "FreeRoom shows every building by how free it is right now, then the rooms inside with live status." |
| 3 | 0:20–0:32 | Type "room for 5 with a whiteboard near the library until 5" → chips appear: Capacity ≥ 5 · Whiteboard · Du Bois · now–5:00 PM; remove one chip | "Or just say what you need. It becomes filters you can see and edit. The AI can only fill in filters, never book anything." |
| 4 | 0:32–0:46 | LGRT 0101 on a weekday: purple striped class blocks with book icons; hover one for the course tooltip; drag across free space → Reserve → "Reserved" toast | "Classes are purple and striped; reservations are blue. Hover for everything 25Live knows. Drag to reserve: two taps." |
| 5 | 0:46–0:56 | Drag over a class: the sheet names it and Reserve stays disabled. Cut to two windows racing for the same slot: one "Reserved", one "already reserved" | "You can't book over a class: the server enforces it too. And two people can never get the same slot. That's a DynamoDB transaction with a lock per 15 minutes." |
| 6 | 0:56–1:06 | My reservations: Early Bird's request → Approve… → Share my contact → "Approved" | "Need a held room? Ask. Contact info is shared only when the holder says yes. It's encrypted with KMS, and only one Lambda can read it." |
| 7 | 1:06–1:20 | Admin window: Demo → Inject class conflict. Student: notification "A class now needs your room" with 3 alternative rooms → Rebook here | "When the registrar adds a class, 25Live wins. The booking is released and you instantly get three free alternatives." |
| 8 | 1:20–1:30 | `docs/architecture.png`, then the live site URL | "Serverless AWS: DynamoDB transactions, event-driven notifications, WAF, alarms, about eight dollars a month. Try it at the link below." |

**On-screen captions (optional):** "No double booking (50 parallel requests → 1 winner)" ·
"4-hour confirm cutoff, enforced on the server" · "Contact shared only after approval" ·
"Accessibility: color + pattern + icon + text, Lighthouse 100".
