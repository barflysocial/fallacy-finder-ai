# ClearSay v1.8.4 — Closure & Definition Guardrails

ClearSay is the rebranded evolution of Fallacy Finder AI. The reasoning engine remains intact, but the product now presents itself as a broader communication and reasoning tool built around four workflows:

- **Analyze a Statement** — inspect one claim deeply.
- **Self-Guided** — one person uses ClearSay during a live conversation.
- **Couples Live** — two participants use a structured, turn-controlled shared conversation.
- **Paste Transcript** — review an existing conversation after the fact.

The internal fallacy-analysis capability remains the **Fallacy Finder reasoning engine** rather than the name of the whole product.


## Closure & Definition Guardrails (v1.8.4)

v1.8.4 turns the strongest findings from the longitudinal communication audit into product behavior rather than another fault score.

### Closure Agreement

- Couples Live no longer treats matching status votes, silence, affection, an apology, or simply stopping the conversation as sufficient proof of closure.
- One participant proposes a structured **Closure Agreement** containing: topic status, what is resolved, what remains open, the next step, and whether repair is complete, partial, incomplete, not applicable, or unclear.
- The other participant must agree to the same closure record before the topic is formally closed. A disagreement leaves the topic open.
- The agreed closure record is preserved in room state, JSON/TXT export, and Session Outcome.

### Agreement Versioning

- Every shared agreement now has a root lineage and explicit version number.
- New agreements start at **v1**. A mutually proposed replacement becomes **v2, v3, ...** in the same lineage.
- The prior version remains active while a replacement is pending or disputed. When both accept the replacement, the prior version is marked superseded.
- Version metadata is preserved in continuation rooms and exports.

### Definition Collision detection

- The reasoning engine now checks whether both participants are using a consequential shared word with materially different meanings before treating the conflict as a reasoning error.
- Typical terms include **repair, support, safety, trust, space, control, priority, equality, and family**.
- ClearSay records each apparent meaning, any overlap, and a neutral question for creating an operational shared definition. A definition difference is not itself labeled a fallacy.
- Definition collisions are surfaced in statement analysis, Couples Live message analysis, Conversation Insights, and transcript Conversation Intelligence.

### Current Behavior vs. Historical Injury

- ClearSay now keeps two separate questions visible: **Is the behavior happening now?** and **Is the older injury emotionally/trust-wise resolved?**
- The engine can classify: same behavior continues; behavior changed while injury remains; behavior stopped while injury remains; a different current issue; mixed/disputed; or unclear.
- Continuing hurt does not by itself prove the behavior is still occurring. Changed behavior does not by itself prove the historical injury is repaired.
- This split is surfaced in statement analysis, Couples Live, Session Outcome, and transcript Conversation Intelligence.

## Durable session recovery (preserved from v1.8.2)

- Couples Live rooms are saved by default to `CLEARSAY_DATA_DIR` and restored when the Node process restarts.
- The included Render Blueprint mounts a 1 GB persistent disk at `/var/data`; saved room state is written below `/var/data/clearsay`.
- Users can uncheck **Save this session for recovery** to create a temporary room. Temporary rooms keep the legacy six-hour inactivity expiration.
- Transcript / Conversation Intelligence work autosaves on the current browser using local storage and is restored after refresh or browser reopen. Users can disable transcript autosave or clear the transcript to remove that browser copy.
- Saved Couples Live rooms remain until the room owner explicitly deletes the room. The active 15/30/45/60 minute conversation timer still ends messaging; it does not delete the saved record.
- Cross-device recovery still requires the participant's existing session token. v1.8.4 does not add accounts or password-based recovery.

## Shared Agreement & Repair Standard Guardrail (v1.8.3)

Couples Live now distinguishes an **active mutually accepted agreement** from a one-person proposal to change it.

- Agreement proposals can be labeled **General shared agreement**, **Shared relationship term**, or **Repair standard**.
- A participant can explicitly propose that new wording **replace** an existing active agreement.
- The existing agreement remains active while the replacement is pending or disputed.
- A replacement becomes active only after **both participants agree**. At that point the prior version is marked superseded and the lineage remains visible.
- A new need or repair requirement can be valid as a request without being treated as if it had always been the agreed standard.
- ClearSay's AI prompts now explicitly prevent a unilateral repair redefinition from being applied retroactively to erase prior fulfillment under an earlier mutual standard.
- Session outcomes and TXT/JSON exports include active repair standards and pending/disputed replacement proposals.
- Continuation rooms carry only the currently active mutually accepted agreements forward.

This implements the rule: **changing your mind is an individual right; changing a shared agreement requires a new agreement.** Repair can also evolve, but a shared definition of repair cannot be unilaterally replaced and then applied backward as if it had always governed.

## Brand asset cleanup (v1.8.3)

- Replaced the Bridge Mark artwork with the cleaned transparent asset.
- Removed the stray horizontal artifacts previously visible beneath the circular mark.
- The app asset is square, transparent, and saved with 300-DPI metadata so it scales cleanly without clipping.


## Brand

- Product: **ClearSay**
- Tagline: **Claim. Clarify. Connect.**
- Logo direction: **Bridge Mark**, the selected connected C/S concept.
- Palette: deep blue, teal, aqua, charcoal, and off-white.

The package includes the selected Bridge Mark artwork as `public/clearsay-bridge-mark.png` and applies the ClearSay visual system to the main interface.

## Required legal acknowledgment

v1.8.3 keeps a blocking legal-notice gate before any app workflow can be initialized and now requires acknowledgment on every fresh app launch.

A user must check the acknowledgment box and choose **I acknowledge and continue** before ClearSay loads prior Self-Guided state, analysis history, Couples Live resume state, or mode controls. If the app is opened again later, the notice appears again and must be re-acknowledged for that fresh launch.

The notice explains that ClearSay:

- is a reasoning and communication aid, not therapy, legal advice, medical advice, crisis support, professional mediation, or factual adjudication;
- can produce inaccurate or incomplete AI output;
- does not establish truth, intent, abuse, enforceability, liability, or who is right;
- should not be the sole basis for legal, medical, financial, custody, safety, or emergency decisions;
- does not create therapist-client, attorney-client, doctor-patient, mediator-client, or similar professional privilege;
- may expose Couples Live messages/shared analysis to the other participant and to exports;
- does not guarantee resolution, reconciliation, accuracy, or outcomes.

### First-record rule + per-launch re-acknowledgment

The first-ever acknowledgment is intentionally written as **record #1** in a new browser-local ClearSay activity ledger (`clearSayActivityRecordsV160`). No other ClearSay activity record is written before it. Later fresh launches append new legal-acknowledgment records for the same disclaimer version so the notice is actively acknowledged each time ClearSay opens.

For Couples Live, the creator's legal acknowledgment is also saved as **audit record #1** in the saved or temporary server-side room record, before `session_created`. Person B's legal acknowledgment is recorded when they join. The legal acknowledgment metadata is included in:

- Couples Live public room state;
- full JSON export;
- conversation TXT export;
- Print / Save as PDF output.

The current disclaimer identifier is:

`clearsay-legal-2026-09-13-v2`

If the disclaimer version changes in a future release, the browser can require acknowledgment of the new version while retaining the original first record.

> **Launch note:** this product notice is a technical/product safeguard, not a substitute for attorney-reviewed Terms of Use and Privacy Policy. Have qualified counsel review the wording, consent flow, retention rules, jurisdictional requirements, and commercial deployment before a public paid launch.

## Couples Live preserved features

- 15 / 30 / 45 / 60-minute session selector
- 30-minute default
- one active topic at a time
- both participants confirm the topic
- true floor control: only one person can type
- 1:00 server-enforced response turn
- no inactive-person drafting
- Start Turn and Pass Turn
- post-send AI analysis only
- neutral repeated topic-irrelevance guidance
- new issues parked for later
- formal current-topic closure before a new topic becomes active
- private vs shared analysis
- Claim Ledger and claim evolution
- mutual agreement capture
- evidence notes
- behavioral repair vs emotional/trust resolution
- Session Outcome
- continuation rooms for unresolved issues
- optional mutually approved read-only therapist/mediator access
- Couples Live participant consent
- early session ending
- TXT / JSON / Print-PDF exports

## Storage and recovery

Couples Live rooms are **saved by default** to the configured durable data directory. With the included Render persistent disk configuration, saved rooms survive service restarts and redeploys until the creator explicitly deletes the room. Users can opt out per room and create a temporary/no-save room; temporary rooms remain memory-only and expire after six hours of inactivity.

Transcript / Conversation Intelligence work autosaves on the current browser when enabled. Browser-local analysis history, Self-Guided state, and Unresolved Issues remain local to that browser.

## Deploy

Replace the contents of the existing GitHub repository with the contents of this ZIP and commit. The Render service can redeploy normally.

The included `render.yaml` uses the service name `clearsay-ai`. If you are updating an existing Render service rather than creating a new Blueprint service, you can keep the existing Render service itself and rename it separately when convenient.

Keep your existing `OPENAI_API_KEY`. The included `render.yaml` also sets `CLEARSAY_DATA_DIR=/var/data/clearsay` and attaches a 1 GB persistent disk at `/var/data`. If your existing Render service is not managed by this Blueprint, attach a persistent disk at `/var/data` in Render before relying on restart-safe room storage.

## Validation

Static validation checks:

- 100 reasoning traps
- 12 claim identifiers
- Repair Evidence Mapping
- Agreement Verification
- Self-Guided workflow and response targets
- Transcript workflow
- Couples Live 15/30/45/60-minute session selector
- 1:00 turn control and no inactive drafting
- repeated topic-focus guidance
- private/shared analysis split
- Claim Ledger
- mutual agreements
- agreement lineage and mutual replacement guardrail
- active repair-standard lock / no retroactive unilateral rewrite
- evidence notes
- continuation rooms
- optional mediator access
- participant consent
- early session ending and exports
- ClearSay product branding and tagline
- required legal gate
- versioned legal acknowledgment
- first-record activity ledger behavior
- Couples Live legal acknowledgment export/audit fields

Static validation does not equal a production legal review or a full live integration test.


## UI refinements in v1.7.5

- centered brand header: Bridge Mark, ClearSay wordmark, and tagline
- corrected Bridge Mark asset so the right-side teal curve is no longer clipped
- stronger dashboard contrast for mode selection and major workflow cards
- preserved ClearSay branding, Self-Guided, Couples Live, and transcript workflows

- new landing-page introduction before the dashboard
- acknowledgment handled as a bottom-page action button instead of a checkbox gate
- separate `terms.html` page for Terms & Conditions and legal notice review
- dashboard stays hidden until the launch acknowledgment is completed


## Landing page refinements in v1.7.5

- added a three-step **How ClearSay Works** section: Claim → Clarify → Connect
- added **Best For / Not For** guidance before entry
- upgraded the landing-page headline and explanatory copy
- added a dedicated acknowledgment call-to-action panel at the bottom
- kept Terms & Conditions on their own page
- dashboard still remains hidden until the per-launch acknowledgment is completed


## Landing page cleanup in v1.7.5

- moved the Bridge Mark icon to the top of the landing page by itself
- styled the wordmark so **Clear** uses the blue brand color and **Say** uses the teal brand color
- placed **CLAIM. CLARIFY. CONNECT.** directly underneath the wordmark
- removed redundant welcome/header copy and the bottom last-acknowledgment message from the landing page


## Larger landing brand in v1.7.5

- increased the landing-page Bridge Mark icon for a stronger first impression
- increased the ClearSay wordmark size to feel more like a splash/header moment
- slightly increased the landing-page top spacing and tagline presence


## Analyze Claim simplification in v1.7.5

- moved the eight example claim categories behind a collapsible **Need an example?** drawer
- kept the main Analyze Claim screen focused on exact claim, optional context, and Analyze with AI
- preserved all example buttons for users who want guidance without crowding the default screen


## Emergency safety acknowledgment in v1.7.5

- added a prominent emergency-safety notice directly above the landing-page acknowledgment action
- instructs users to call 911 immediately if they or anyone else is in immediate danger or at risk of serious harm, injury, or death, including harm to self or another person
- provides local-emergency-number language for users outside the United States
- added the same safety language to the separate Terms & Conditions page
- bumped the legal disclaimer identifier to `clearsay-legal-2026-09-13-v2` so the changed legal language is versioned separately


## Transcript Audit Pass in v1.7.6

Paste Transcript now automatically performs a required full second-pass audit after the zero-token local first pass.

- The first pass remains intentionally broad and finds statements worth checking.
- After initial extraction, the **Full Audit Pass runs automatically** and re-checks every candidate against the original wording and nearby transcript context; the user can also re-run it.
- The audit can retain, downgrade to candidate, route to fact/frequency verification, mark transcript uncertainty, or remove a first-pass alert.
- Final audited items preserve the source quote and show normalized reasoning-pattern labels.
- Every audited item shows three labeled 0–100 confidence scores:
  - **Pattern Confidence** — confidence that the reasoning pattern is actually present.
  - **Claim Confidence** — how strongly the supplied transcript supports the underlying conclusion; this is not independent real-world verification.
  - **Transcript Confidence** — reliability of wording, speaker attribution, and nearby context in the transcript text.
- Speaker summaries distinguish retained alerts, higher-confidence patterns, candidate/context items, and removed first-pass alerts.
- Audit counts are explicitly not fault scores, and a high Pattern Confidence does not mean the speaker is probably wrong.
- Print / Save PDF is available from the audited report.
- Long transcripts are processed in bounded chunks; the server automatically splits a chunk further if token/rate constraints require it.

The Audit Pass uses the existing `OPENAI_API_KEY`; no new environment variable is required.


## Conversation Intelligence in v1.8.0

The real-world transcript audit exposed a core limitation of sentence-level reasoning tools: a statement can look weak in its nearby exchange and become substantially better supported after later context is connected. v1.8.0 therefore makes transcript analysis a four-stage pipeline:

`Candidate Discovery → Context Audit → Whole-Transcript Audit → Conversation Pattern Analysis`

### Context Audit
- Re-checks the exact statement and nearby exchange.
- Removes local false positives caused by sarcasm, questions, analogies, factual disagreements, feelings, or ASR ambiguity.
- Produces provisional Pattern / Claim / Transcript confidence scores.

### Whole-Transcript Audit
- Searches the full parsed conversation for earlier/later evidence relevant to every candidate.
- Can strengthen, weaken, remove, or reclassify the Context Audit result.
- Keeps the narrower supported complaint separate from any reasoning extension.
- Shows when global context changed a result and explains why.
- Tracks relevant claim evolution and transcript-turn evidence references.

### Supported complaint vs. reasoning extension
A complaint can be supported while a stronger conclusion remains weak. For example, repeated comments may support “this behavior happens,” while “you always do this because you need control” separately raises frequency, motive, and identity questions. v1.8.0 shows both layers instead of forcing one yes/no fallacy label.

### Four-layer claim breakdown
Important audited statements are separated into:
1. Observation
2. Impact
3. Interpretation
4. Intent / Identity

This preserves emotional impact while showing exactly where inference begins.

### Conversation Pattern Analysis
After the final audit, ClearSay produces a transcript-level report covering:
- recurring interaction cycles;
- each speaker's recurring conversational/protective strategy and how it may backfire;
- supported complaints and what remains unestablished;
- claim evolution;
- evidence-graph links (supports, contradicts, narrows, clarifies, concedes, revises);
- behavioral-repair vs. emotional/trust-resolution mismatch;
- issue stacking;
- highest-leverage process changes.

The pattern report is not a diagnosis, abuse determination, or fault score. Raw alert counts remain secondary to context, confidence, support, and recurring interaction structure.


## v1.8.1 — Unresolved Issues + plain-language default

- The default transcript report now prioritizes plain-language Conversation Insights. Numeric counts, confidence percentages, speaker averages, and similar metrics are moved under **Data Analytics** disclosures.
- Conversation Intelligence adds a prominent **What Needs to Change** section with behavior-level changes for each speaker, shared conversation changes, and a suggested next conversation.
- Couples Live now exposes a browser-persistent **Unresolved Issues** hub. Open or deferred topics and parked issues are saved locally when a participant views them.
- Selecting an unresolved issue preloads it as the claim/topic for a new Couples Live session. The user can refine the wording before creating the room.
- Prior positions, common ground, disputed points, agreements, evidence notes, and missing evidence can be carried forward. They are explicitly labeled as **historical prior-session context**, not newly established fact.
- The source issue remains open until a user explicitly marks it resolved; creating a continuation does not silently declare resolution.

In v1.8.2, saved Couples Live rooms persist on the server-side durable store, while the unresolved-issue hub also remains browser-local for quick continuation. Temporary/no-save rooms still expire after inactivity.
