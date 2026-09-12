# Fallacy Finder AI v1.3.0 — Optional Transcript Browser

The normal **Analyze a statement** workflow remains the default. **Paste transcript** is still an optional second mode for finding a statement inside a longer conversation.

## What changed
- Transcript mode no longer stops at 10 claims.
- The transcript is scanned locally, so claim extraction uses **0 AI tokens**.
- The app returns all likely analyzable statements it can identify from the transcript.
- Long result sets are shown in pages instead of being truncated.
- You can search the extracted statements and filter by speaker or claim type.
- You can choose 10, 20, or 30 results per page.
- AI is only called after you choose **Analyze this statement**.

## Transcript flow
1. Paste a conversation, text exchange, SRT/VTT transcript, or speaker-by-speaker dialogue.
2. Click **Find claims in transcript**.
3. The server locally parses speaker turns and statement-sized passages.
4. The local claim/fallacy router identifies likely claim types and possible reasoning areas.
5. Browse all results using search, speaker filters, claim-type filters, and pagination.
6. Click **Analyze this statement** on the one you want.
7. The app returns to the normal single-statement workflow: Clarify the Claim → targeted AI reasoning → likely fallacy → clarification/challenge/response tools.

Transcript mode intentionally does **not** score an entire person or conversation. It helps locate analyzable statements while preserving nearby context.

## Limits
- Single statement: existing app limits apply.
- Transcript input: up to 100,000 characters in one pass.
- Claim extraction itself uses no OpenAI API call.
- The selected statement is the only part sent into the full AI analysis.

## Deploy
Replace the files in the existing GitHub repository with this package and commit. Your current Render service can redeploy automatically. Keep the existing `OPENAI_API_KEY` environment variable.

## Health check
`/api/health` reports:
- `transcript_option: true`
- `transcript_mode: "local-all-claims-paginated-then-analyze-selected"`
