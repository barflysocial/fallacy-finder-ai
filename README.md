# ClearSay v1.9.4 — Official Couples Live Chat Link Preview + Invitee Self-Entry

## v1.9.4 additions

- Couples Live invitations identify themselves as **ClearSay Couples Live Chat**.
- The dedicated `/couples-live` route publishes privacy-safe Open Graph/social-link metadata so supported messaging apps can show the ClearSay logo, title, and description as a rich link preview.
- Preview metadata deliberately excludes participant names, the conversation topic, and the session code.
- The actual invite still contains the session link and session code so the recipient can verify the room.
- **Person A cannot supply Person B's identity information when creating a room.** Person B enters their own display name after opening the invitation and acknowledging the Terms & Conditions.
- The server rejects creator payloads that try to include Person B/invitee name, phone, or email fields.
- The host interface explicitly explains that Person B supplies their own information.

> Rich link previews are rendered by the recipient's messaging app/device. ClearSay provides the preview metadata, but the app, carrier, or platform ultimately decides whether the preview is displayed.

## Previous: v1.9.3 — Couples Live Guest Gate + Footer Positioning

## v1.9.3 additions

- Couples Live invitation links now use a dedicated `/couples-live?code=...&guest=1` entry route.
- Invitees see the **session code first**, then must review/acknowledge the **Terms & Conditions** and shared-session visibility/export notice before joining.
- An invitee enters a **session-only guest experience**: the normal ClearSay workflow tabs, Analyze a Statement, Self-Guided, Transcript / Screenshots, history, and general dashboard are hidden while they are in the invited Couples Live room.
- The host retains normal full ClearSay access.
- Refreshing the guest invite route resumes the same authorized Couples Live participant token when it is still stored on that browser.
- Expired/unavailable invited sessions return the guest to the invitation gate instead of exposing the general ClearSay lobby.
- The app shell now uses a full-height layout so the footer stays at the bottom of short pages. The ClearSay disclaimer language is aligned with **Terms & Conditions** and **System Preferences** instead of floating high on the screen.
- All v1.9.2 and earlier cumulative functionality remains included.

# ClearSay v1.9.2 — Combined Link + Code Copy

## v1.9.2 additions

- Changed **Copy invite link** to **Copy invite** in Couples Live.
- One tap now copies a ready-to-send invitation containing **both the ClearSay session link and the session code**.
- The copied link still opens Couples Live and pre-fills the code automatically.
- **Copy code** remains available as a separate fallback.
- **Text invite** continues to send the same combined link + code invitation through the device messaging app.
- All v1.9.1 and earlier cumulative ClearSay functionality remains included.

# ClearSay v1.9.1 — Couples Live Text Invite

## v1.9.1 additions

- Added a **Text invite** button for the Couples Live room creator while waiting for Person B.
- The text message includes the ClearSay website link and the session code.
- Opening the invite link routes the recipient directly to **Couples Live** and pre-fills the session code.
- Added **Copy invite link** as a desktop/manual sharing fallback.
- Pending invite codes survive the legal/payment gate in the same browser tab and are cleared after a successful join.
- All v1.9.0 System Preferences/footer behavior and prior cumulative ClearSay functionality remain included.

# ClearSay v1.9.0 — Footer System Preferences

This cumulative build preserves every v1.8.5 feature and adds two product-level systems:

- **Light / Dark / System appearance** with a persistent browser preference and automatic system-theme following.
- **Optional Stripe Checkout paid-access foundation** designed to surface Apple Pay automatically on compatible devices once the Stripe account and web domain are configured.



## v1.9.0 additions

- Moved **System Preferences** out of the floating top-right control and into the app footer beside **Terms & Conditions**.
- System Preferences opens a compact footer panel containing the existing **System / Light / Dark** appearance choices.
- The selected appearance remains persistent in the browser, and **System** continues to follow live device/browser theme changes.
- All v1.8.9 screenshot-upload directions and prior cumulative ClearSay functionality remain included.

## v1.8.9 additions

- Added a visible **How to upload your conversation** guide directly above the screenshot speaker-color controls.
- The guide explains color ownership, selecting up to 10 images, keeping screenshots in chronological order, reviewing/removing previews, extracting them into the transcript, and reviewing the extracted text before analysis.
- Added guidance that slight screenshot overlap is acceptable and that users can crop unrelated content before upload.
- All v1.8.8 speaker-color assignment and collapsible Analyze a Statement behavior remains included.

## v1.8.8 additions

- Screenshot import now requires an explicit speaker color map for **Your messages** and **Their messages**. Each side can be marked Gray, Blue, or Green, and the two selected colors must differ before transcription starts.
- The screenshot transcription prompt treats the selected colors as authoritative speaker labels rather than relying on default iMessage/SMS assumptions or left/right position.
- **Analyze a statement** is now collapsible. When routing, clarification, or analysis produces new information, the input card minimizes automatically and displays a clear status badge such as **New questions below**, **More information needed**, or **New analysis below**.
- The Analyze a statement mode tab also shows a small **New / Action** indicator when fresh information is available.
- All prior v1.8.7 functionality remains included: screenshot upload/transcription, Copy Reply, Light/Dark/System appearance, payment-ready Stripe/Apple Pay architecture, durable session recovery, Couples Live, transcript audit, and v1.8.4 closure/definition guardrails.


## Screenshot conversation import (v1.8.7)

- The Transcript workflow now accepts up to **10 PNG, JPG, or WebP screenshots** at a time.
- Screenshots are shown as local previews and can be removed individually before processing.
- Before upload, the browser scales screenshots to a high-resolution analysis copy to reduce transfer size while keeping message text readable.
- ClearSay sends the prepared images to the configured OpenAI vision-capable model, extracts **only visible conversation text**, preserves screenshot order, and avoids intentionally duplicating visibly overlapping messages.
- Visible speaker names are retained when clear. If speaker identity is not clear from the screenshot, ClearSay uses a neutral/uncertain label instead of guessing.
- The extracted wording is placed into the normal transcript box **for user review before analysis**. The existing Context Audit, Whole-Transcript Audit, and Conversation Pattern Analysis then operate on the reviewed transcript.
- Selected screenshot files are not written into ClearSay's browser autosave. They remain local browser objects until removed/cleared/refreshed; only the extracted transcript text can be autosaved under the existing transcript setting.
- Screenshot reading requires `OPENAI_API_KEY`; `OPENAI_VISION_MODEL` is optional and defaults to the existing `OPENAI_MODEL`.

## Appearance

Use **System Preferences** in the footer beside **Terms & Conditions**, then choose System, Light, or Dark. System mode follows the device/browser color scheme and updates live when that system preference changes. The preference is stored only in the current browser.

## Payments / Apple Pay foundation

Payments are **off by default**. No charge is possible until the operator explicitly configures Stripe, a price, and enables payments. The build uses Stripe-hosted Checkout so ClearSay does not collect or store card or Apple Pay credentials.

Required environment variables for a paid launch:

- `PAYMENTS_ENABLED=true`
- `PAYMENTS_REQUIRED=true` to actually gate premium API access
- `STRIPE_SECRET_KEY=...`
- `CLEARSAY_PRICE_CENTS=...` (integer cents; intentionally left at 0 in this build because pricing has not been chosen)
- `CLEARSAY_CURRENCY=usd`
- `CLEARSAY_ACCESS_HOURS=24` (configurable)
- `CLEARSAY_ACCESS_PRODUCT_NAME=ClearSay Access Pass`
- `CLEARSAY_ACCESS_SECRET=...` (stable random secret for the HttpOnly access cookie)
- `CLEARSAY_PUBLIC_URL=https://your-domain.example` (recommended for production)

The payment return is verified server-side against Stripe before an HttpOnly access cookie is issued. When `PAYMENTS_REQUIRED=true`, premium API routes also require that valid access cookie, so the paywall is not only a browser-side visual gate.

### Apple Pay launch requirements

Stripe Checkout can surface Apple Pay automatically on supported devices/browsers. Before live use, enable the relevant payment method in Stripe and register every web domain/subdomain that displays Apple Pay. Use Stripe test mode first.

### Important commercial-launch note

This is a payment foundation, not a finished pricing policy. Before turning required payments on, decide whether ClearSay is sold as a time pass, per-analysis purchase, Couples Live package, subscription, or another model. Also complete business, tax, refund, privacy, and attorney-reviewed Terms/Privacy work appropriate to the launch jurisdiction.

# ClearSay v1.8.5 — Copy Reply for Texting

ClearSay is the rebranded evolution of Fallacy Finder AI. The reasoning engine remains intact, but the product now presents itself as a broader communication and reasoning tool built around four workflows:

- **Analyze a Statement** — inspect one claim deeply.
- **Self-Guided** — one person uses ClearSay during a live conversation.
- **Couples Live** — two participants use a structured, turn-controlled shared conversation.
- **Paste Transcript** — review an existing conversation after the fact.

The internal fallacy-analysis capability remains the **Fallacy Finder reasoning engine** rather than the name of the whole product.



## Copy Reply for Texting (v1.8.5)

- Added a **Copy reply** button directly under the recommended response in Analyze a Statement and Self-Guided modes.
- Self-Guided copies the currently selected wording (Recommended, Clarify, Evidence, Direct, or De-escalate).
- Analyze a Statement also provides a copy button on each alternative response.
- Copying places only the reply text on the clipboard, not the analysis, so it can be pasted directly into Messages, SMS, or another chat app.
- Includes a clipboard fallback for browsers where the modern Clipboard API is unavailable.

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
