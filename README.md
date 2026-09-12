# Fallacy Finder AI v1.2.8 — Selectable Claim Types + Repair Status

This build adds an explicit **Claim type** picker to the **Clarify the Claim** stage. All 12 claim identifiers are visible and selectable, including **Repair Status**.

When **Repair Status** is selected, the app opens the repair-specific qualification branch covering the original injury, repair actions, behavior change, mutual/disputed resolution, and what remains unresolved. Selecting a claim type runs locally and uses zero AI tokens; it only changes which qualifying questions are shown and what context is sent into the later AI reasoning step.

## Deploy
Replace the files in the existing GitHub repository with this package and commit. The existing Render service can redeploy automatically. Keep the existing `OPENAI_API_KEY` environment variable.

## Health check
`/api/health` now reports `claim_identifiers: 12`, `repair_status_branch: true`, and `selectable_claim_types: true`.
