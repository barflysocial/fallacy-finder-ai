import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import OpenAI from "openai";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;
const MODEL = process.env.OPENAI_MODEL || "gpt-5.6-terra";

const readJSON = (p) => JSON.parse(fs.readFileSync(path.join(__dirname, p), "utf8"));
const rules = fs.readFileSync(path.join(__dirname, "knowledge/rules.md"), "utf8");
const fallacies = readJSON("knowledge/fallacies.json");
const identifiers = readJSON("knowledge/claim-identifiers.json");
const labelTypes = readJSON("knowledge/label-types.json");
const fallacyById = new Map(fallacies.map((f) => [f.id, f]));

const compactCatalog = fallacies.map(f => ({
  id:f.id, name:f.name, group:f.group, definition:f.definition,
  better_move:f.better_move, examples:f.examples
}));

const stableInstructions = `${rules}\n\nCLAIM IDENTIFIERS:\n${JSON.stringify(identifiers)}\n\nLABEL TYPES:\n${JSON.stringify(labelTypes)}\n\nOFFICIAL 100-TRAP CATALOG:\n${JSON.stringify(compactCatalog)}`;

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "64kb" }));
app.use(express.static(path.join(__dirname, "public")));
app.set("trust proxy", 1);

const limiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 60,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many analyses from this connection. Please try again later." }
});
app.use("/api/analyze", limiter);

const outputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: { type: "string", enum: ["needs_clarification", "analysis_ready"] },
    summary: { type: "string" },
    claim_parts: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object", additionalProperties: false,
        properties: {
          text: { type: "string" },
          type: { type: "string", enum: ["event_fact","feeling","behavior_label","interpretation_meaning","intent_motive","cause","pattern_frequency","prediction","value_rule","identity_character","request_boundary"] },
          status: { type: "string", enum: ["established","supported","inferred","disputed","unknown","not_applicable"] },
          explanation: { type: "string" }
        },
        required: ["text","type","status","explanation"]
      }
    },
    reasoning_bridge: {
      type: "object", additionalProperties: false,
      properties: {
        starting_point: { type: "string" },
        added_inference: { type: "string" },
        conclusion: { type: "string" },
        bridge_assessment: { type: "string" }
      },
      required: ["starting_point","added_inference","conclusion","bridge_assessment"]
    },
    established_points: { type: "array", items: { type: "string" }, maxItems: 8 },
    unresolved_points: { type: "array", items: { type: "string" }, maxItems: 8 },
    questions: {
      type: "array", maxItems: 5,
      items: {
        type: "object", additionalProperties: false,
        properties: {
          id: { type: "string" },
          question: { type: "string" },
          why_needed: { type: "string" },
          answer_type: { type: "string", enum: ["text","yes_no","number","choice"] },
          options: { type: "array", items: { type: "string" }, maxItems: 6 }
        },
        required: ["id","question","why_needed","answer_type","options"]
      }
    },
    likely_fallacies: {
      type: "array", maxItems: 5,
      items: {
        type: "object", additionalProperties: false,
        properties: {
          fallacy_id: { type: "integer", minimum: 1, maximum: 100 },
          match_score: { type: "integer", minimum: 0, maximum: 100 },
          why_it_fits: { type: "string" },
          evidence_for_match: { type: "array", items: { type: "string" }, maxItems: 5 },
          what_would_weaken_match: { type: "array", items: { type: "string" }, maxItems: 5 },
          corrective_question: { type: "string" }
        },
        required: ["fallacy_id","match_score","why_it_fits","evidence_for_match","what_would_weaken_match","corrective_question"]
      }
    },
    burden_of_proof: {
      type: "object", additionalProperties: false,
      properties: {
        applies: { type: "boolean" },
        explanation: { type: "string" },
        next_move: { type: "string" }
      },
      required: ["applies","explanation","next_move"]
    },
    better_wording: { type: "string" },
    suggested_response: { type: "string" },
    caution: { type: "string" }
  },
  required: ["status","summary","claim_parts","reasoning_bridge","established_points","unresolved_points","questions","likely_fallacies","burden_of_proof","better_wording","suggested_response","caution"]
};

function validateBody(body) {
  const claim = typeof body?.claim === "string" ? body.claim.trim() : "";
  if (!claim) return { error: "Enter a claim or statement first." };
  if (claim.length > 4000) return { error: "Please keep the claim under 4,000 characters." };
  const answers = Array.isArray(body.answers) ? body.answers.slice(0, 15).map(a => ({
    question: String(a?.question || "").slice(0, 1000),
    answer: String(a?.answer || "").slice(0, 2000)
  })) : [];
  const context = typeof body?.context === "string" ? body.context.trim().slice(0, 5000) : "";
  const round = Math.max(0, Math.min(Number(body?.round) || 0, 5));
  return { claim, answers, context, round };
}

function enrich(result) {
  result.likely_fallacies = (result.likely_fallacies || []).map(item => {
    const official = fallacyById.get(item.fallacy_id);
    return official ? {
      ...item,
      name: official.name,
      group: official.group,
      definition: official.definition,
      better_move: official.better_move,
      examples: official.examples
    } : item;
  });
  return result;
}

function estimateCost(usage) {
  if (!usage) return null;
  // Defaults to GPT-5.6 Terra standard rates as of Sep 2026.
  if (MODEL !== "gpt-5.6-terra") return null;
  const input = usage.input_tokens || 0;
  const cached = usage.input_tokens_details?.cached_tokens || 0;
  const uncached = Math.max(0, input - cached);
  const output = usage.output_tokens || 0;
  return Number(((uncached/1e6)*2 + (cached/1e6)*0.20 + (output/1e6)*12).toFixed(6));
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true, ai_configured: Boolean(process.env.OPENAI_API_KEY), model: MODEL, fallacies: fallacies.length });
});

app.post("/api/analyze", async (req, res) => {
  try {
    const v = validateBody(req.body);
    if (v.error) return res.status(400).json({ error: v.error });
    if (!openai) return res.status(503).json({ error: "OPENAI_API_KEY is not configured on the server." });

    const answerText = v.answers.length
      ? v.answers.map((a, i) => `${i+1}. Q: ${a.question}\n   A: ${a.answer}`).join("\n")
      : "No clarifying answers have been supplied yet.";

    const input = `Analyze the following relationship/reasoning claim using the Fallacy Finder rules and official catalog.\n\nEXACT CLAIM:\n${v.claim}\n\nOPTIONAL CONTEXT (context is not automatically fact):\n${v.context || "None supplied."}\n\nCLARIFYING ANSWERS:\n${answerText}\n\nROUND: ${v.round}\n\nInstructions for this run:\n- First decompose the claim.\n- Park genuinely established facts; test what was added to them.\n- If a few answers could materially change the diagnosis, return status needs_clarification and ask 2–5 high-value questions. Do not ask questions merely for completeness.\n- You may include preliminary fallacy matches even when asking questions, but lower confidence appropriately.\n- If enough information exists, return analysis_ready and no unnecessary questions.\n- Use fallacy IDs only from the official catalog.\n- match_score means textual/reasoning fit, not scientific probability.\n- When the claim includes a pattern, use numerator/denominator logic when data exists.\n- When the claim includes intent, distinguish impact, foreseeability, recklessness, and intended outcome.\n- When the claim includes a feeling, honor the feeling while separately evaluating external conclusions.\n- Give a natural suggested response, not therapy jargon.`;

    const response = await openai.responses.create({
      model: MODEL,
      reasoning: { effort: "medium" },
      instructions: stableInstructions,
      input,
      store: false,
      max_output_tokens: 5000,
      prompt_cache_key: "fallacy-finder-rules-v1",
      text: {
        format: {
          type: "json_schema",
          name: "fallacy_finder_analysis",
          strict: true,
          schema: outputSchema
        }
      }
    });

    const text = response.output_text;
    if (!text) throw new Error("The model returned no structured text output.");
    const parsed = enrich(JSON.parse(text));
    res.json({
      analysis: parsed,
      meta: {
        model: response.model || MODEL,
        response_id: response.id,
        usage: response.usage || null,
        estimated_cost_usd: estimateCost(response.usage)
      }
    });
  } catch (err) {
    console.error("Analyze error:", err);
    const status = err?.status && Number.isInteger(err.status) ? err.status : 500;
    res.status(status).json({ error: err?.message || "Analysis failed." });
  }
});

// SPA fallback
app.get(/.*/, (req, res) => res.sendFile(path.join(__dirname, "public/index.html")));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Fallacy Finder AI running on port ${PORT} with ${MODEL}`);
});
