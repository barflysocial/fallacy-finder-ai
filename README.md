# Fallacy Finder AI

A Render-ready Node 22+/Express app that uses OpenAI as the reasoning engine behind the Fallacy Finder framework.

## What it does

1. Takes the exact claim.
2. Decomposes it into 11 claim identifiers.
3. Separates established/supported material from inference, dispute, and unknowns.
4. Builds an Event/Evidence → Inference → Conclusion reasoning bridge.
5. Asks 2–5 adaptive qualifying questions only when they could materially change the result.
6. Matches against the official 100-trap catalog.
7. Explains burden of proof, what supports/weakens each match, better wording, and a natural response.
8. Uses structured JSON output so the UI is reliable.

## Deploy to Render

### 1. Put this folder on GitHub
Create a repository, then upload every file/folder in this package.

### 2. Create a Render Web Service
- New → Web Service
- Connect the GitHub repository
- Runtime: Node
- Build command: `npm install`
- Start command: `npm start`

Or use the included `render.yaml` as a Render Blueprint.

### 3. Add the API key in Render
Environment variables:
- `OPENAI_API_KEY` = your OpenAI API secret key
- `OPENAI_MODEL` = `gpt-5.6-terra`

Do **not** put the API key in `public/index.html`, `public/app.js`, GitHub, or any browser-side code.

### 4. Deploy
Render will give you a normal HTTPS address. Open it in Safari/Chrome and the AI buttons will work.

## Run locally

```bash
cp .env.example .env
# Put your key in your shell environment (Node does not automatically load .env in this minimal build)
export OPENAI_API_KEY="your-key"
npm install
npm start
```

Open `http://localhost:3000`.

## Model
Default: `gpt-5.6-terra` with medium reasoning effort. Change `OPENAI_MODEL` in Render if desired.

## Privacy
The server sets `store: false` on Responses API calls. The browser does not receive or store the API key. This app itself does not include a database.

## Knowledge files
- `knowledge/rules.md` — the reasoning constitution (claim, feeling, intent, pattern, burden-of-proof rules)
- `knowledge/fallacies.json` — 100 official traps used by this app
- `knowledge/claim-identifiers.json` — 11 claim types
- `knowledge/label-types.json` — label subtypes and handling rules

You can edit these files and redeploy without rewriting the UI.

## Important limitation
This tool identifies reasoning patterns. A fallacy match does not prove a conclusion false, and the app does not determine factual truth, intent, diagnosis, abuse, or legal responsibility.
