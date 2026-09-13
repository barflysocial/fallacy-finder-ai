# Fallacy Finder AI v1.5.0 — Guided Couples Live

The existing **Analyze a statement**, **Quick live session**, **Paste transcript**, and **Couples live** workflows are preserved. v1.5.0 expands Couples Live into a guided two-person reasoning room while keeping normal texting intact: messages are sent exactly as written, then analyzed afterward.

## New in v1.5.0

### Private vs shared analysis

Each message now produces two views:

- **Shared conversation effect** — neutral information both people can see: how the message relates to the active topic, what claim it affects, whether it strengthens/weakens/narrows the issue, common ground, unresolved points, agreement/repair signals, and the emerging underlying issue.
- **Your private reasoning analysis** — visible only to the person who wrote that message: claim types, evidence quality, reasoning confidence, likely fallacies/reasoning traps, and clarifying questions.

The other participant and an optional mediator do **not** receive the writer's private fallacy/evidence analysis. Full JSON exports include private analysis only for the messages written by the person performing that export.

### Claim ledger and claim evolution

Couples Live maintains a shared **Claim Ledger**. Important claims can be marked as new, supported, weakened, narrowed, clarified, conceded, corrected, withdrawn, unchanged, or unclear. This prevents a corrected or conceded claim from silently remaining active as though nothing changed.

### Resolution criteria

When Person A creates a topic, they can optionally state what would help answer or close it. Person B sees and confirms the same topic and criteria before messaging begins. Later topics can also have their own resolution criteria.

### Mutual agreement capture

Either participant can propose exact agreement wording. The proposal becomes a confirmed shared agreement only when both participants choose **Agree**. A disagreement remains visibly disputed rather than being silently treated as mutual assent.

### Evidence notes

Either participant can add participant-supplied evidence notes and optionally attach the note to a specific claim in the Claim Ledger. Evidence can be labeled as a direct record, direct observation, contemporaneous record, witness report, memory, hearsay, inference, or other, and as supporting/opposing/neutral.

Evidence notes are explicitly labeled **not independently verified**. This version records evidence descriptions; it does not upload the underlying screenshot/document bytes.

### Session outcome

When a topic closes or the 15-minute session ends, **Session Outcome** can show:

- common ground
- unresolved/disputed points
- mutually confirmed agreements
- evidence notes added
- topics parked for later
- useful next questions
- the emerging underlying issue

### Carry unresolved issues forward

If the topic ends partially resolved, unresolved, deferred, times out, or the session is ended early, Person A can create a new 15-minute continuation room. The continuation carries forward the prior session's common ground, unresolved points, confirmed agreements, open claims, evidence summaries, and suggested next questions rather than starting from zero.

### Optional therapist / mediator observer

Both participants must separately approve therapist/mediator access. Only after both approvals does the app create a mediator code. A mediator can then join the room in **read-only** mode and see the shared conversation and shared insights, but not either participant's private message analysis.

### Explicit participant consent

Creating or joining a Couples Live room now requires confirmation that room messages and shared session analysis are visible to the other participant and may be exported by either participant.

### End the session early without deleting it

Either participant can end the active 15-minute session early. Messaging closes, but the room remains available for review, Conversation Insights, continuation, and export. The creator still has a separate **Delete room** control.

## Features preserved from v1.4.1

- 15-minute maximum; timer starts with the first message after both people confirm the topic
- one active topic at a time
- topic-shift detection and **Issues saved for later** parking lot
- formal topic closure requiring matching status from both participants
- conversation TXT export
- privacy-filtered full JSON export
- Print / PDF browser report
- post-send AI analysis; no pre-send rewriting or blocking
- agreement verification and unilateral-change reasoning
- repair evidence mapping and behavioral-vs-emotional repair distinction

## Couples Live philosophy

Couples Live is not a scorecard. It should not show one partner a tally of the other partner's fallacies. The shared view focuses on the structure of the disagreement and how new information changes it. Detailed reasoning/fallacy analysis stays with the author of the message.

The goal is to answer:

1. What exactly is being claimed?
2. What evidence has actually been supplied?
3. What remains inference, disputed, or unknown?
4. Did later messages strengthen, weaken, narrow, correct, or concede the claim?
5. What common ground now exists?
6. What specific question remains unresolved?

## Storage limitation

Couples Live still uses **temporary server-memory storage** in this build. Rooms can disappear if the Render service restarts/redeploys and expire after inactivity. Export important sessions. Durable multi-instance storage still requires a shared database/realtime service and is intentionally not presented as completed in this package.

## Deploy

Replace the files in the existing GitHub repository with this package and commit. The existing Render service can redeploy automatically. Keep the current `OPENAI_API_KEY`. No new environment variables are required for the temporary-memory v1.5.0 build.

## Validation

Static checks validate:

- 100 reasoning traps
- 12 claim identifiers
- Repair Evidence Mapping
- Agreement Verification
- Quick Live and response-target features
- Couples Live topic lock and 15-minute timer
- private/shared analysis split
- Claim Ledger
- mutual agreement capture
- evidence notes
- continuation rooms
- optional read-only mediator access
- participant consent
- export and early session ending
