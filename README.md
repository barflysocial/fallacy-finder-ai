# Fallacy Finder AI v1.3.7 — Response-First Quick Live

The normal **Analyze a statement** workflow remains the default. **Quick live session** and **Paste transcript** remain optional input modes. All reasoning, repair, agreement-verification, transcript, and response-target features from v1.3.6 are preserved.

## New in v1.3.7

### Quick Live is now response-first
After you enter what the other person said, the first visible result is the response you can use next. The full analysis no longer competes with the response during a live conversation.

Quick Live shows:

- **Respond to:** Other person / Therapist
- **Best next response**
- **Recommended / Clarify / Evidence / Direct / De-escalate**
- **Used it / Modified it / Didn't use it**
- **+ What did they say next?**

### Qualifying questions only for the other person
Adaptive qualifying questions are no longer shown as a separate interruption during Quick Live.

When **Other person** is selected, any useful qualifying questions appear in a compact collapsed section inside the response card. If the person answers one, enter that answer as their next statement and the session continues with the new context.

When **Therapist** is selected, that qualifying-question section is hidden. The therapist-directed response itself asks the therapist to structure or clarify the disputed claim fairly.

### Collapsed Quick Live hierarchy
Everything below the immediate response is minimized by default. The order is:

1. **Why this response?** — reasoning summary and confidence
2. **Claim analysis** — claim status, claim parts, possible fallacies
3. **Evidence & agreements** — evidence quality, burden of proof, agreement verification
4. **Repair status** — appears only when repair is relevant
5. **Unresolved questions** — missing information and what would change the result
6. **Common ground & disputed points** — supported points versus the remaining disagreement
7. **Full reasoning details** — reasoning bridge, dependencies, contradictions, counterexamples, timing, severity, full fallacy analysis, response self-check
8. **Session history** — entered statements and confirmed replies

If Repair Status is not relevant, the repair section is omitted and the remaining sections renumber automatically.

### Session overview is minimized too
A saved Session Overview is collapsed when you return to Quick Live. If you explicitly press **View session overview**, it opens for that request.

### Session-history fallback
If a saved Quick Live session is restored before a statement analysis is reopened, a small collapsed Session History remains available. Once a current analysis is open, Session History moves to the bottom of the collapsed analysis hierarchy.

## Existing features preserved

- 100 reasoning traps with local keyword/phrase routing
- 12 selectable claim identifiers, including Repair Status
- Evidence quality, claim certainty, burden of proof, dependencies, contradictions, and counterexamples
- Agreement Verification and unilateral agreement-change tracking
- Repair Evidence Mapping and behavioral repair vs. emotional resolution
- No clear fallacy and insufficient information as valid outcomes
- Paste-transcript mode with all-claim extraction, search, filters, and pagination
- Quick Live running context and Session Overview
- Five response choices
- Response target selector: Other person or Therapist
- Clear Session
- Check My Response
- Browser-local analysis history and Quick Live persistence

## Deploy
Replace the files in the existing GitHub repository with this package and commit. The existing Render service can redeploy automatically. Keep the existing `OPENAI_API_KEY` environment variable.

## Health check
`/api/health` reports `app_version: "1.3.7"` plus flags for the response-first Quick Live UI, collapsed hierarchy, and Other-Person-only qualifying-question display.
