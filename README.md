# Fallacy Finder AI v1.3.6 — Agreement Verification

The normal **Analyze a statement** workflow remains the default. **Quick live session** and **Paste transcript** remain optional input modes. All features from v1.3.5 are preserved.

## New in v1.3.6

### Agreement Verification
When a statement involves an agreement, promise, shared rule, or repair standard, the app now separates several questions that were previously compressed into one agreement check:

1. **Did an agreement actually exist?**
   - both explicitly agreed
   - existence disputed
   - agreement exists but terms are disputed
   - implied / assumed
   - preference or expectation rather than a shared agreement
2. **What were the original terms?**
3. **Did both people assent to the same terms?**
4. **Was the agreement ongoing, temporary, or conditional?**
5. **Was it later changed?**
6. **Was the later change mutual, unilateral, disputed, or simply an agreed expiration/condition ending?**
7. **If one person introduced new terms, did the other person later accept them?**
8. **Were the original terms fulfilled before the later change?**

Conditional follow-up questions stay hidden unless an agreement may actually exist, so the clarification screen does not show every agreement question for an ordinary claim.

### Unilateral Agreement Changes
The reasoning engine now explicitly distinguishes:

- **unchanged agreement**
- **mutually changed agreement**
- **unilaterally changed agreement**
- **disputed change**
- **agreement expired / condition ended**
- **unclear**

A unilateral change does **not** automatically rewrite the original agreement. If the other person later accepts the new terms, the app can treat that as a possible new agreement from that point forward rather than pretending the term existed from the beginning.

### Original Fulfillment vs. Later Requirements
The app now evaluates whether the **original agreed terms were fulfilled** separately from whether someone later asks for additional repair, reassurance, behavior, or conditions.

Core rule:

> A later need can be valid without proving that the original agreement was never fulfilled.

If previously agreed criteria appear to have been fulfilled and a later unilateral requirement is being used retroactively to say the original agreement was never fulfilled, the app can flag a **possible standard-shift / Moving the Goalposts issue**. It is not labeled automatically; the original terms, fulfillment, and timing of the later requirement first have to be sufficiently established.

### Repair Claims Now Check Agreement Standards
Repair Status automatically exposes the Agreement Verification branch because repair disputes often depend on questions such as:

- What repair was actually agreed to?
- Did both people agree that those actions were the repair standard?
- Were those actions completed?
- Did the harmful behavior change?
- Was a new requirement introduced later?
- Was that later requirement mutually accepted or unilateral?

This keeps **behavioral repair**, **emotional resolution**, **agreement fulfillment**, and **later needs** as separate questions.

### Richer Agreement Result Card
The final analysis can now show:

- agreement existence
- original terms
- mutual assent
- duration / conditions
- original fulfillment status
- later change status
- changed terms
- whether the later terms were accepted
- whether a retroactive-standard issue is present
- what the agreement means for the current dispute

### Quick Live Session Overview
Quick Live Session now carries agreement status into the cumulative session overview. The overview can identify whether an agreement is central, what appears to have been mutually accepted, whether it was fulfilled, and whether later terms were mutually changed or introduced unilaterally.

## Existing features preserved

- 100 reasoning traps with local keyword/phrase routing
- 12 selectable claim identifiers, including Repair Status
- Evidence quality and claim certainty
- Claim dependencies, contradictions, counterexamples, frequency vs. severity
- Repair Evidence Mapping
- Behavioral repair separated from emotional resolution
- No clear fallacy and insufficient information as valid outcomes
- Paste-transcript mode with local extraction, search, filters, and pagination
- Quick Live running context and Session Overview
- Five Quick Live response choices: Recommended, Clarify, Evidence, Direct, De-escalate
- Response target selector: Other person or Therapist
- Clear Session
- Check My Response
- Browser-local analysis history and Quick Live persistence
- AI receives only a small locally selected fallacy candidate set for individual analyses

## Deploy
Replace the files in the existing GitHub repository with this package and commit. The existing Render service can redeploy automatically. Keep the existing `OPENAI_API_KEY` environment variable.

## Health check
`/api/health` reports `app_version: "1.3.6"`, `agreement_verification: true`, `unilateral_agreement_change_tracking: true`, plus the existing repair, transcript, Quick Live, response-target, and session-overview features.
