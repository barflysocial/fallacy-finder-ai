# Fallacy Finder AI v1.4.1 — Focused Couples Live

The existing **Analyze a statement**, **Quick live session**, **Paste transcript**, and **Couples live** workflows are preserved. v1.4.1 makes Couples Live a focused, time-limited conversation around one active topic at a time.

## New in v1.4.1

### 15-minute maximum

- The room can be created and joined before the clock starts.
- Person A creates the room with one topic/question.
- Person B must confirm that topic before messaging begins.
- The 15:00 timer starts when both people have confirmed the topic and the first message is sent.
- The timer does not reset when a later topic is proposed.
- At 0:00, new messages are disabled. The existing conversation remains available for review and export.
- If AI is configured and at least two messages exist, the server automatically requests final Conversation Insights when the timer expires.

### One active topic at a time

Every sent message is analyzed after send for relevance to the current topic:

- directly relevant
- clarifying
- supporting context
- possible topic shift
- unrelated issue
- unclear

A topic shift does **not** automatically replace the current topic. A genuinely different issue can be placed in the **Issues saved for later** parking lot. The same rule is applied to both participants.

### Formal topic closure

A new topic cannot become active while the current topic is open. Each participant independently submits a closing status. The topic closes only when both choose the same status:

- Resolved
- Partially resolved
- Unresolved — more evidence needed
- Unresolved — value / preference disagreement
- Deferred by mutual agreement

If the two people choose different statuses, the topic remains open and both selections stay visible. Once a topic is formally closed, either person can propose the next topic (including an item from the parking lot). The other participant must confirm it before messaging resumes.

### Conversation export

Either participant can export while the temporary room still exists:

- **Export conversation** — plain-text conversation
- **Export full data** — JSON with topics, topic history, messages, per-message analysis, parking lot, timer state, and Conversation Insights
- **Print / PDF** — opens a clean printable session report that can be printed or saved as PDF in the browser

The export distinguishes participant messages from AI analysis and includes a scope notice that outside events are not independently verified.

## Couples Live reasoning behavior

Messages are sent exactly as written. The app does not rewrite, correct, soften, or block messages before send. After each message is sent, Fallacy Finder can track:

- claim types and claim status
- evidence quality
- reasoning confidence
- likely reasoning traps, including No clear fallacy
- whether an earlier claim became stronger, weaker, more precise, unchanged, or unclear
- common ground and unresolved points
- agreement status and unilateral changes
- behavioral repair vs emotional/trust resolution
- topic relevance and possible topic shifts
- underlying issue
- questions that may clarify the current topic

Fallacy labels are not scores and do not automatically make the underlying conclusion false.

## Conversation Insights

After at least two messages, either participant can request **Conversation insights**. The overview remains anchored to the active or most recent topic and focuses on common ground, disputed points, claim evolution, recurring reasoning patterns, agreement status, repair status, and neutral questions that may help close the topic.

## Beta storage limitation

Couples Live still uses temporary server-memory storage in this build. Rooms can disappear if the Render service restarts or redeploys and expire after inactivity. Export before ending a room if the conversation needs to be kept. Durable multi-instance Couples Live should later move to a shared realtime database.

## Existing features preserved

- 100 reasoning traps with local keyword/phrase routing
- 12 selectable claim identifiers including Repair Status
- Evidence Quality, claim status, burden of proof, dependencies, contradictions, and counterexamples
- Agreement Verification and unilateral agreement-change tracking
- Repair Evidence Mapping
- Quick Live with response-first hierarchy, five response styles, therapist/other-person target, and Clear Session
- Paste Transcript with local all-claim extraction and pagination
- browser-local analysis history and Quick Live persistence

## Deploy

Replace the files in the existing GitHub repository with this package and commit. The existing Render service can redeploy automatically. Keep the current `OPENAI_API_KEY`. No new environment variable is required for this temporary-memory Couples Live beta.

## Health check

`/api/health` reports `app_version: "1.4.1"` plus Couples Live capability flags for topic locking, confirmation, parking lot, 15-minute maximum, export, post-send analysis, and temporary server-memory storage.
