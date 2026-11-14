# FreeRoom: Claude Design Prompt

Paste everything inside the block into Claude Design. Attach `docs/PRD.md` and the brown→white gradient reference image along with it.

```
SPEED MODE: we ship a production-ready v1 tomorrow. Produce the design system plus the screens below FAST. Prioritize fidelity on screens 1, 3, 4, 6, 8, 9, and 10; screens 2, 7, and 12 can be simpler. Skip the week view and settings.

Design the complete UI for FreeRoom, a campus classroom availability and reservation web app. The attached PRD (docs/PRD.md) is the source of truth: follow its features, business rules, and screen structure exactly. Don't invent features that aren't in it, and don't leave out any that are.

## Format
- Landscape / horizontal desktop frames, 1440 × 900, laid out left-to-right in flow order on one canvas.
- Product pitch: "Google Maps for empty classrooms." It should feel like a funded startup, not a class project: calm, warm, confident, premium.

## Visual style (from the attached reference)
- Signature element: a HORIZONTAL gradient running left → right from deep chocolate brown (#7B3F00) through tan (#B98C66) and sand (#E2CDB8) to white (#FFFFFF). Use it on the landing hero, the left navigation rail, page headers, and the onboarding panel. Content areas sit on the white/cream end (#FFFFFF / #FAF6F1) so text stays highly readable.
- Neutrals: espresso text #2B1A0E, secondary text #6B5444, borders #E8DDD2, surfaces #FFFFFF, subtle surface #FAF6F1.
- Typography: a modern geometric or grotesk sans (e.g., Inter / General Sans) with tabular numbers for times. Large, confident headings.
- Shapes: 12–16px radius cards, soft warm shadows, generous whitespace, thin warm-gray dividers.
- Semantic tokens. These are REQUIRED by the PRD (BR-2), and color must never be the only signal:
  - CLASS (from 25Live): plum #6B3FA0 with diagonal stripes + book icon
  - RESERVATION (FreeRoom): slate blue #2F6FB0, solid + person icon
  - MINE (my reservation): gold #D4A017 2px outline + star
  - FREE: green #2E8B57 dot + "Free until 3:15 PM"
  - CLAIMABLE: blue outline chip "Claimable"
  - CONFLICT / RELEASED: amber #C77700 / muted gray
  Check that each one keeps WCAG AA contrast against the brown→white gradient.

## App shell (on every signed-in screen)
- Left navigation rail on the gradient: FreeRoom logo, then Search, Map, My Reservations, Notifications (bell with unread badge), and Demo (only visible to admins). The user's alias and role chip sit at the bottom.
- A top bar inside the content area with the natural-language search input ("Room for 6 with a projector near the library at 3pm"), the "Demo data" badge, and a stale-schedule banner slot ("Schedule last updated 42 min ago").
- A visible keyboard focus ring style and a "Skip to content" link.

## Screens (one frame each, in this order)
1. **Landing (logged out):** a full-width horizontal gradient hero with the pitch line, a "Sign in" primary button, a "Try the demo" secondary button, and 3 feature cards (Find, Reserve, Claim). A small screenshot of the timeline sits on the white side.
2. **Register / onboarding:** a split layout with the gradient on the left (brand plus the privacy promise: "Your University ID is used once to verify you and is never shown") and a form on the right: University ID, role picker (Student / Faculty-Staff / Tutor), display alias, contact (email/phone), and which channel to share if a claim is approved. Plus a simple sign-in card (email/password) with quick "Demo as Student / Faculty / Admin" buttons.
3. **Search (home):** a filter bar (building dropdown, capacity slider, equipment chips: Projector, Whiteboard, Computers, Outlets, Accessible; "Free now" toggle; time range picker; sort). Results are a grid of room cards: room name, building, capacity, equipment icons, status chip (Free until… / Class in progress / Reserved · Claimable / Reserved). Show the parsed natural-language filters as editable chips above the results.
4. **Room timeline, day view:** a header with the room name, building, capacity, equipment, and a live status chip. The main area is a horizontal timeline from 7:00 to 23:00 with a now-line. Show both layers clearly: striped plum class blocks, solid blue reservation blocks, one gold-outlined "mine" block, back-to-back blocks, and free gaps with a hover "+ Reserve" affordance. Include an open TOOLTIP on a class showing every 25Live field: event name, course code/section, event type, time, department/organizer, room. Include a date picker and a "Text view" toggle.
5. ~~Room timeline, week view~~ (cut for the hackathon)
6. **Reserve side sheet:** the timeline with a drag-selected range snapped to 15 minutes, plus a right-hand sheet with room, date, start–end, party size, an optional purpose, a note on max duration for the role, and a "Reserve" button. Add a small inline error state showing 409 CLASS_CONFLICT ("Overlaps CS 220 Lecture, 2:30–3:45 PM") and SLOT_TAKEN ("Someone just booked this; the timeline was refreshed").
7. **Reservation detail + claim dialog:** a reservation popover with status, owner alias ("Held by a Student"), and a countdown to the claim cutoff ("Claims close in 2h 14m — 4h before start"), plus the "Request this room" modal (message ≤ 280 characters with a counter, party size).
8. **Campus map:** an Amazon Location–style map filling the content area. Building markers are colored by % free (with a legend) and there's a "Near me" button. A right side panel lists the selected building's rooms with status chips. Include a "Buildings list" toggle for screen readers.
9. **My Reservations:** Upcoming/Past tabs. Each row shows the room, time, a status pill (Pending confirmation / Confirmed / Released / Transferred / Cancelled), a "Confirm" button with a cutoff countdown, and Cancel. Below that, an "Incoming claims" section (Approve → choose "Share contact" or "Transfer reservation", or Deny) and an "Outgoing claims" section (Pending / Approved with a revealed contact card / Denied / Expired). Plus an event-history drawer open on one reservation (Created → Confirmed → Claim requested → …).
10. **Notifications:** a list grouped by day (claim received, claim approved with contact, auto-released, confirmation reminder, transferred). Feature a CLASS CONFLICT notification card: "A new class was scheduled in LGRT 201 during your reservation," with the class details and 3 alternative-room cards, each with a "Rebook here" button. Show a toast example in the corner.
11. ~~Settings~~ (cut for the hackathon)
12. **Demo controls panel (admin):** buttons for "Inject class conflict" (pick a reservation), "Fast-forward to cutoff", and "Reset demo data", plus a live event log showing what happened. This is used on stage during the pitch.

## States and details to include
- Empty, loading (skeletons), and error states for Search and Timeline.
- The stale-data banner.
- Make the 4-hour cutoff visible wherever it matters (countdowns, and disabled Approve/Confirm buttons after the cutoff with an explanation).
- Privacy: never show another user's real name, email, phone, or University ID. Use aliases only, except the revealed contact card after an approved claim.
- Accessibility: every status uses color + icon + text, every interactive element is visibly focusable, and the timeline also has a Text view.

## Output
A cohesive design system section (colors, type scale, tokens, components: buttons, chips, status pills, room card, timeline block, tooltip, side sheet, modal, toast, notification card), followed by the landscape screens above (10 screens). Use realistic UMass-style sample data (buildings like LGRT, ILC, CS Building, Du Bois Library; course codes like CS 220, MATH 233).
```
