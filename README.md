# ClearSay v1.6.0 — Claim. Clarify. Connect.

ClearSay is the rebranded evolution of Fallacy Finder AI. The reasoning engine remains intact, but the product now presents itself as a broader communication and reasoning tool built around four workflows:

- **Analyze a Statement** — inspect one claim deeply.
- **Self-Guided** — one person uses ClearSay during a live conversation.
- **Couples Live** — two participants use a structured, turn-controlled shared conversation.
- **Paste Transcript** — review an existing conversation after the fact.

The internal fallacy-analysis capability remains the **Fallacy Finder reasoning engine** rather than the name of the whole product.

## Brand

- Product: **ClearSay**
- Tagline: **Claim. Clarify. Connect.**
- Logo direction: **Bridge Mark**, the selected connected C/S concept.
- Palette: deep blue, teal, aqua, charcoal, and off-white.

The package includes the selected Bridge Mark artwork as `public/clearsay-bridge-mark.png` and applies the ClearSay visual system to the main interface.

## Required legal acknowledgment

v1.6.0 adds a blocking legal-notice gate before any app workflow can be initialized.

A user must check the acknowledgment box and choose **I acknowledge and continue** before ClearSay loads prior Self-Guided state, analysis history, Couples Live resume state, or mode controls.

The notice explains that ClearSay:

- is a reasoning and communication aid, not therapy, legal advice, medical advice, crisis support, professional mediation, or factual adjudication;
- can produce inaccurate or incomplete AI output;
- does not establish truth, intent, abuse, enforceability, liability, or who is right;
- should not be the sole basis for legal, medical, financial, custody, safety, or emergency decisions;
- does not create therapist-client, attorney-client, doctor-patient, mediator-client, or similar professional privilege;
- may expose Couples Live messages/shared analysis to the other participant and to exports;
- does not guarantee resolution, reconciliation, accuracy, or outcomes.

### First-record rule

The acknowledgment is intentionally written as **record #1** in a new browser-local ClearSay activity ledger (`clearSayActivityRecordsV160`). No other ClearSay activity record is written before it.

For Couples Live, the creator's legal acknowledgment is also saved as **audit record #1** in the temporary server-side room record, before `session_created`. Person B's legal acknowledgment is recorded when they join. The legal acknowledgment metadata is included in:

- Couples Live public room state;
- full JSON export;
- conversation TXT export;
- Print / Save as PDF output.

The current disclaimer identifier is:

`clearsay-legal-2026-09-13-v1`

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

## Storage limitation

Couples Live still uses **temporary server-memory storage**. Rooms can disappear after a Render restart/redeploy or after expiration. Durable realtime persistence remains a future infrastructure step.

Browser-local analysis history and Self-Guided state remain local to the browser as in prior builds.

## Deploy

Replace the contents of the existing GitHub repository with the contents of this ZIP and commit. The Render service can redeploy normally.

The included `render.yaml` uses the service name `clearsay-ai`. If you are updating an existing Render service rather than creating a new Blueprint service, you can keep the existing Render service itself and rename it separately when convenient.

Keep your existing `OPENAI_API_KEY`. No new environment variable is required for v1.6.0.

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
