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
const CANDIDATE_LIMIT = Math.max(5, Math.min(Number(process.env.CANDIDATE_LIMIT) || 8, 12));

const readJSON = (p) => JSON.parse(fs.readFileSync(path.join(__dirname, p), "utf8"));
const fallacies = readJSON("knowledge/fallacies.json");
const claimQualifiers = readJSON("knowledge/claim-qualifiers.json");
const fallacyById = new Map(fallacies.map((f) => [f.id, f]));
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

// Keep the always-sent instructions short. Detailed rules are added only when the claim needs them.
const CORE_INSTRUCTIONS = `You are the reasoning engine for Fallacy Finder.
Your job is to clarify claims and test reasoning, not decide who is right.

Rules:
- Clarify the claim before naming a fallacy.
- Separate event/fact, feeling, behavior label, interpretation/meaning, intent/motive, cause, pattern/frequency, prediction, value/rule, identity/character, and request/boundary.
- Park genuinely established facts. Test the inference added to them.
- A reported feeling does not need external proof, but it does not by itself prove cause, intent, or moral fault.
- Impact does not prove intent. Sequence does not prove causation.
- External factual allegations carry an initial burden of support by the person making them. Do not require someone to prove a negative before the allegation has support.
- Pattern claims need scope and representative evidence. Absolute terms require especially strong support.
- A fallacy match does not prove the conclusion false.
- If evidence is insufficient, say so and ask only the minimum questions that could materially change the analysis.
- The server has already searched all 100 traps locally using keywords, phrases, claim types, and structural signals. Use only fallacy IDs supplied in the candidate catalog; do not search for additional fallacies.
- Match scores are reasoning-fit scores, not scientific probabilities.
- Be concise and use plain, natural language.`;

const CLAIM_TYPE_RULES = {
  feeling: `FEELING: distinguish pure emotion from a thought/label disguised as a feeling. Validate the emotion separately from external claims about cause or intent.`,
  behavior_label: `BEHAVIOR LABEL: translate loaded shorthand such as ignored, controlled, interrogated, abandoned, or disrespected into the least interpretive concrete action available.`,
  intent_motive: `INTENT: distinguish event, impact, foreseeability, recklessness/indifference to known risk, and intended outcome. Stronger motive claims require stronger support. Allow “I know what happened; I do not know why.”`,
  cause: `CAUSE: sequence is not causation. Consider mechanism, alternative causes, repeated association, and whether several causes may operate together.`,
  pattern_frequency: `PATTERN: define behavior and time window; use occurrences / relevant opportunities when available; examine exceptions and comparable cases; separate frequency from severity and from intent.`,
  prediction: `PREDICTION: distinguish possible, probable, and certain. Treat forecasts as revisable, not present facts.`,
  value_rule: `VALUE/RULE: identify whether a “should” is a preference, norm, moral principle, legal/professional rule, or mutual agreement.`,
  identity_character: `IDENTITY: character claims are broader than behavior claims. Translate identity labels back into representative behaviors before judging the whole person.`,
  request_boundary: `REQUEST/BOUNDARY: a request or preference generally does not need proof to exist. Clarify who is being asked to do what and distinguish a boundary about one's own action from control of another person.`,
  event_fact: `EVENT/FACT: if disputed and important, identify what supports the event. Do not treat confidence, repetition, or popularity as proof.`,
  interpretation_meaning: `INTERPRETATION: separate what happened from what the event is believed to mean. Treat meaning as an inference unless independently supported.`
};

const GROUP_SIGNALS = {
  "Evidence": ["prove", "proof", "evidence", "must be", "everyone agrees", "therapist said", "family says", "because", "therefore", "no proof", "can't prove", "cannot prove", "obviously", "clearly"],
  "Intent": ["wanted to", "meant to", "trying to", "tried to", "deliberately", "on purpose", "you knew", "because you wanted", "real reason", "punish", "control me", "hurt me"],
  "Feeling → Fact": ["i feel", "i felt", "feel like", "unsafe", "unwanted", "abandoned", "controlled", "rejected", "if you loved", "if you cared", "should", "ought"],
  "Memory": ["remember", "i recall", "you said", "i never said", "back then", "from the beginning", "always been", "should have known", "used to"],
  "Scale": ["always", "never", "every time", "constantly", "everything", "nothing", "everyone", "nobody", "completely", "all you do", "every single"],
  "Relevance": ["what about", "but you", "you do it too", "so you're saying", "so you are saying", "that's not the point", "the real issue", "anyway", "before we talk", "why do you always"],
  "Fairness": ["that's different", "that is different", "when i", "when you", "i had to", "no choice", "you made me", "take responsibility", "we're not talking about me", "after everything i've done"],
  "Openness": ["nothing will change", "i just know", "whatever you say", "proves it", "if you deny", "if you admit", "defensive proves", "guilty would say", "no other explanation", "either", "or else"]
};

const GROUP_DEFAULT_IDS = {
  "Evidence": [2, 3, 7, 9, 10, 16, 17, 19],
  "Intent": [20, 21, 22, 23, 24, 28, 29],
  "Feeling → Fact": [31, 34, 35, 36, 37, 38, 39],
  "Memory": [42, 43, 44, 45, 46, 47, 51],
  "Scale": [52, 53, 56, 57, 58, 59, 60],
  "Relevance": [62, 64, 66, 67, 68, 69, 75],
  "Fairness": [76, 77, 78, 79, 80, 81, 83],
  "Openness": [90, 91, 93, 94, 95, 96, 97]
};

function normalize(s = "") {
  return String(s).toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
}

function phraseCount(text, phrase) {
  if (!phrase) return 0;
  let count = 0, start = 0;
  while ((start = text.indexOf(phrase, start)) !== -1) { count++; start += phrase.length; }
  return count;
}

function detectClaimTypes(text) {
  const t = normalize(text);
  const out = new Set(["event_fact"]);
  if (/\b(i feel|i felt|feel like|felt like)\b/.test(t)) out.add("feeling");
  if (/\b(ignore|ignored|control|controlled|interrogate|interrogated|abandon|abandoned|disrespect|disrespected|pressure|pressured|block|blocked|manipulat|dismissive|reject)\w*\b/.test(t)) out.add("behavior_label");
  if (/\b(meant|means|meaning|shows|proves|therefore|so that means|doesn't care|does not care|important to)\b/.test(t)) out.add("interpretation_meaning");
  if (/\b(wanted to|meant to|trying to|tried to|deliberately|on purpose|you knew|real reason|punish|intended)\b/.test(t)) out.add("intent_motive");
  if (/\b(because|caused|causes|made me|led to|resulted in|therefore)\b/.test(t)) out.add("cause");
  if (/\b(always|never|every time|constantly|usually|often|rarely|all the time|keeps? doing|pattern)\b/.test(t)) out.add("pattern_frequency");
  if (/\b(will|going to|gonna|eventually|never going to|always going to|probably will)\b/.test(t)) out.add("prediction");
  if (/\b(should|ought|supposed to|good (husband|wife|partner)|married people|must)\b/.test(t)) out.add("value_rule");
  if (/\b(you are|you're|he is|she is)\s+(selfish|controlling|cold|dishonest|lazy|toxic|cruel|needy|avoidant|narcissistic|uncaring|irresponsible)\b/.test(t)) out.add("identity_character");
  if (/\b(i need|i want|i would like|please|i won't|i will not|i'm not willing|i am not willing|my boundary)\b/.test(t)) out.add("request_boundary");
  return [...out];
}

function scoreGroups(text, claimTypes) {
  const t = normalize(text);
  const scores = Object.fromEntries(Object.keys(GROUP_SIGNALS).map(g => [g, 0]));
  for (const [group, phrases] of Object.entries(GROUP_SIGNALS)) {
    for (const p of phrases) scores[group] += phraseCount(t, p) * 2;
  }
  const typeBoosts = {
    feeling: [["Feeling → Fact", 4]],
    behavior_label: [["Feeling → Fact", 2], ["Intent", 1]],
    interpretation_meaning: [["Evidence", 2], ["Intent", 1], ["Feeling → Fact", 1]],
    intent_motive: [["Intent", 5], ["Evidence", 1]],
    cause: [["Evidence", 4]],
    pattern_frequency: [["Scale", 5], ["Evidence", 2]],
    prediction: [["Feeling → Fact", 2], ["Openness", 1]],
    value_rule: [["Feeling → Fact", 2], ["Fairness", 2]],
    identity_character: [["Feeling → Fact", 2], ["Fairness", 3], ["Scale", 1]],
    request_boundary: [["Fairness", 1], ["Relevance", 1]],
    event_fact: [["Evidence", 1]]
  };
  for (const type of claimTypes) for (const [group, n] of (typeBoosts[type] || [])) scores[group] += n;
  return scores;
}

function structuralBoost(id, text) {
  const t = normalize(text);
  const tests = {
    1: [/\b(can't|cannot) prove\b/, /\bno proof\b/],
    2: [/\bprove (you|that you) (didn't|did not|aren't|are not|weren't|were not)\b/, /\bshow me (i'm|i am) wrong\b/],
    3: [/\bprove (you )?never\b/, /\bguarantee (you'?ll|you will) never\b/],
    4: [/\b(therapist|doctor|expert|lawyer|book|article) (said|says)\b/],
    5: [/\b(everyone|everybody|most people|all my friends) (says|say|agrees|agree|thinks|think)\b/],
    7: [/\b(one|once|one time|one incident).{0,50}\b(always|never|everything|nothing)\b/],
    10:[/\b(ever since|after that).{0,50}\b(because|caused|therefore)\b/, /\bbecause it happened after\b/],
    15:[/\b(i'?ve|i have) told you (for years|many times)\b/, /\bkeep saying\b/],
    17:[/\b(didn't|did not) (say|mention|deny|respond)\b/, /\b(silence|no response).{0,30}\bmeans\b/],
    20:[/\byou (wanted|meant|think|feel|believe)\b/, /\byour real reason\b/, /\byou only did.{0,30}because\b/],
    21:[/\b(must be|obviously means|clearly means|so that means)\b/],
    23:[/\b(on purpose|intentionally|deliberately|purposefully|specifically to)\b/],
    24:[/\b(trying to|wanted to).{0,25}\b(hurt|punish|attack|control|threaten)\b/],
    29:[/\byou should (have )?know(n)?\b/, /\bobvious what i meant\b/],
    31:[/\b(i feel|i felt|feel like).{0,60}\b(therefore|so|means|proves)\b/],
    32:[/\bif you (loved|cared)\b/, /\bafter everything i'?ve done\b/],
    35:[/\beither\b.{0,80}\bor\b/, /\ball or nothing\b/],
    36:[/\b(over|ruined|hopeless|never recover|destroy).{0,40}\b(marriage|relationship|everything|future)?\b/],
    37:[/\b(you are|you're|he is|she is)\s+(a )?(liar|selfish|controlling|needy|toxic|cold|lazy|cruel|dishonest)\b/],
    38:[/\b(should|shouldn't|should not|ought|supposed to)\b/],
    39:[/\b(will always|will never|definitely will|going to|eventually)\b/],
    42:[/\b(lately|recently|last week|last few days)\b/],
    44:[/\bshould have known\b/, /\b(obvious now|knew all along)\b/],
    47:[/\b(i'?ve|i have) always\b/, /\bi never wanted\b/],
    52:[/\b(always|never|every single time|constantly|everything|nothing|everyone|nobody)\b/],
    53:[/\bif\b.{0,60}\bthen\b.{0,80}\bthen\b/],
    56:[/\b(just like|same as|no different from|exactly like)\b/],
    58:[/\b(only|just)\b.{0,25}\b(yelling|text|one time|once)\b/, /\bnot a big deal\b/],
    59:[/\b(any|every) (husband|wife|partner|normal person|reasonable person)\b/, /\beveryone knows\b/],
    60:[/\b(real|true) (husband|wife|partner|spouse)\b/],
    61:[/\b(you're|you are) (crazy|obsessed|impossible|stupid|just emotional)\b/],
    62:[/\bwhy (do|did|are|won't|will) you\b.{0,40}\b(always|keep|deliberately|control|refuse|stop)\b/, /\bwhen did you stop\b/],
    66:[/\b(not enough|doesn't count|does not count|now you need)\b/],
    67:[/\b(change the subject|different issue|side issue|not answering)\b/],
    68:[/\b(what about|but you|well you|and you did)\b/],
    69:[/\b(you do it too|you'?ve done it|you have done it|hypocrite|who are you to)\b/],
    70:[/\bexpect (him|her|them) to (lie|deny)\b/, /\b(can't|cannot) trust anything (he|she|they) says?\b/],
    71:[/\b(ridiculous|laughable|what a joke|how romantic|stupid)\b/],
    72:[/\b(always done it this way|we'?ve always|tradition|how it'?s always been)\b/],
    73:[/\b(new|modern|latest|newer).{0,30}\b(better|evolved|superior)\b/],
    74:[/\b(natural|human nature|biological|instinct).{0,25}\b(right|justified|should|therefore)\b/],
    75:[/\bso (you're|you are) saying\b/, /\bso .{0,30} means nothing\b/],
    77:[/\b(that'?s|that is) different\b/, /\bexception for me\b/],
    78:[/\b(i can|i get to).{0,40}\b(you can't|you cannot|you don't)\b/, /\bdouble standard\b/],
    79:[/\b(we'?re|we are) not talking about me\b/, /\bonly you (need|have) to\b/],
    81:[/\bwhen i do it.{0,80}when you do it\b/, /\bi did it because.{0,80}you did it because\b/],
    83:[/\b(had to|no choice|you made me|forced to)\b/],
    84:[/\b(all these years|already invested|too much time|too much money|come this far)\b/],
    85:[/\bafter all i do\b/, /\bi deserve\b/, /\bi sacrificed so\b/],
    87:[/\bif you win i lose\b/, /\beither your needs or mine\b/],
    90:[/\b(confirms what i believe|see i was right|everything fits my theory|only notice)\b/],
    91:[/\bdoesn'?t matter what evidence\b/, /\beven after evidence\b/, /\bstill believe\b/],
    92:[/\b(the more you explain|evidence|proof|correction).{0,50}\b(more sure|more convinced|proves i'?m right)\b/],
    93:[/\b(i'?m|i am) (objective|just seeing reality)\b/, /\bif you disagree.{0,30}\b(biased|irrational|emotional)\b/],
    94:[/\b(i'?m|i am) not biased\b/, /\byou'?re biased\b/],
    95:[/\b(denial|asking|defensiveness|disagreeing).{0,25}\bproves\b/, /\bif you (deny|disagree).{0,25}\bproves\b/],
    96:[/\beither\b.{0,80}\bor\b/, /\bonly two choices\b/, /\bno middle ground\b/],
    97:[/\bbecause .{0,40}\bbecause\b/, /\btrue because it is true\b/, /\bconclusion proves itself\b/],
    98:[/\b(keep it the same|status quo|why change now|always been this way)\b/],
    99:[/\b(don'?t|do not) tell me what to do\b/, /\bbecause you (asked|told) me not to\b/],
    100:[/\b(my family|my side|our people|people like us|outsider|one of us)\b/]
  };
  let boost = 0;
  for (const r of (tests[id] || [])) if (r.test(t)) boost += 12;
  return boost;
}

function scoreFallacy(f, text, groupScores) {
  const t = normalize(text);
  let score = (groupScores[f.group] || 0) * 0.7;
  const matches = [];

  // Longer phrases are strong routing signals. Single terms are weaker.
  for (const phrase of (f.phrases || [])) {
    const p = normalize(phrase);
    const n = phraseCount(t, p);
    if (n) {
      score += n * (p.length >= 22 ? 13 : 10);
      matches.push(phrase);
    }
  }
  for (const term of (f.single_terms || [])) {
    const k = normalize(term);
    const re = new RegExp(`\\b${k.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(t)) {
      score += 4;
      matches.push(term);
    }
  }
  // Catch any useful signal not classified above.
  for (const kw of (f.keywords || [])) {
    const k = normalize(kw);
    if (k && t.includes(k) && !matches.includes(kw)) {
      score += k.includes(" ") ? 7 : 3;
      matches.push(kw);
    }
  }
  const structural = structuralBoost(f.id, t);
  if (structural) {
    score += structural;
    matches.push("structural match");
  }
  const name = normalize(f.name);
  if (name && t.includes(name)) { score += 15; matches.push(f.name); }
  return { score, matches: [...new Set(matches)].slice(0, 6) };
}

function selectCandidates(text, limit = CANDIDATE_LIMIT) {
  const claimTypes = detectClaimTypes(text);
  const groupScores = scoreGroups(text, claimTypes);
  const rankedGroups = Object.entries(groupScores).sort((a, b) => b[1] - a[1]);
  const anySignal = rankedGroups[0]?.[1] > 1;
  const selectedGroups = anySignal
    ? rankedGroups.slice(0, 3).map(([g]) => g)
    : ["Evidence", "Intent", "Feeling → Fact", "Scale"];

  const scored = fallacies.map(f => {
    const r = scoreFallacy(f, text, groupScores);
    return { f, ...r };
  }).sort((a, b) => b.score - a.score || a.f.id - b.f.id);

  // Local search does the catalog search. AI sees only the best few candidates.
  const chosen = [];
  for (const x of scored) {
    if (chosen.length >= limit) break;
    if (x.score >= 9) chosen.push(x);
  }

  // If the wording is sparse, add a small amount of group coverage rather than the full catalog.
  for (const group of selectedGroups) {
    if (chosen.length >= limit) break;
    const inGroup = scored.filter(x => x.f.group === group && !chosen.some(c => c.f.id === x.f.id));
    for (const x of inGroup.slice(0, 2)) {
      if (chosen.length < limit) chosen.push(x);
    }
  }

  // Final fill is by local score only.
  for (const x of scored) {
    if (chosen.length >= limit) break;
    if (!chosen.some(c => c.f.id === x.f.id)) chosen.push(x);
  }

  return { claimTypes, groupScores, selectedGroups, candidates: chosen.slice(0, limit) };
}


function buildClaimQualifiers(claimTypes) {
  const priority = [
    "behavior_label", "intent_motive", "pattern_frequency", "cause",
    "feeling", "interpretation_meaning", "identity_character", "prediction",
    "value_rule", "request_boundary", "event_fact"
  ];
  const selected = priority.filter((t) => claimTypes.includes(t));
  const questions = [{ claim_type: "universal", ...claimQualifiers.universal }];
  let slots = 6;

  for (const type of selected) {
    if (slots <= 0) break;
    const bank = claimQualifiers[type] || [];
    if (!bank.length) continue;

    // Intent and pattern claims benefit most from a second qualifier.
    // When only one claim type is detected, show two questions so a simple claim
    // can still be clarified before the API call.
    const desired = ((type === "intent_motive" || type === "pattern_frequency") || selected.length === 1) ? 2 : 1;
    const take = Math.min(desired, bank.length, slots);
    for (const q of bank.slice(0, take)) questions.push({ claim_type: type, ...q });
    slots -= take;
  }
  return questions;
}

function buildDynamicRules(claimTypes) {
  return claimTypes.map(t => CLAIM_TYPE_RULES[t]).filter(Boolean).join("\n");
}

function compactCandidateCatalog(candidates) {
  return candidates.map(({ f, score, matches }) => ({
    id: f.id,
    name: f.name,
    group: f.group,
    definition: f.definition,
    local_score: Math.round(score),
    matched_signals: matches
  }));
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "32kb" }));
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
      type: "array", maxItems: 8,
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
    established_points: { type: "array", items: { type: "string" }, maxItems: 5 },
    unresolved_points: { type: "array", items: { type: "string" }, maxItems: 5 },
    questions: {
      type: "array", maxItems: 3,
      items: {
        type: "object", additionalProperties: false,
        properties: {
          id: { type: "string" },
          question: { type: "string" },
          why_needed: { type: "string" },
          answer_type: { type: "string", enum: ["text","yes_no","number","choice"] },
          options: { type: "array", items: { type: "string" }, maxItems: 5 }
        },
        required: ["id","question","why_needed","answer_type","options"]
      }
    },
    likely_fallacies: {
      type: "array", maxItems: 3,
      items: {
        type: "object", additionalProperties: false,
        properties: {
          fallacy_id: { type: "integer", minimum: 1, maximum: 100 },
          match_score: { type: "integer", minimum: 0, maximum: 100 },
          why_it_fits: { type: "string" },
          evidence_for_match: { type: "array", items: { type: "string" }, maxItems: 3 },
          what_would_weaken_match: { type: "array", items: { type: "string" }, maxItems: 3 },
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
  if (claim.length > 1800) return { error: "Please keep the claim under 1,800 characters." };
  const answers = Array.isArray(body.answers) ? body.answers.slice(0, 9).map(a => ({
    question: String(a?.question || "").slice(0, 500),
    answer: String(a?.answer || "").slice(0, 900)
  })) : [];
  const context = typeof body?.context === "string" ? body.context.trim().slice(0, 2200) : "";
  const round = Math.max(0, Math.min(Number(body?.round) || 0, 4));
  return { claim, answers, context, round };
}

function enrich(result, routing) {
  const routingById = new Map((routing?.candidates || []).map(x => [x.f.id, x]));
  result.likely_fallacies = (result.likely_fallacies || []).map(item => {
    const official = fallacyById.get(item.fallacy_id);
    const local = routingById.get(item.fallacy_id);
    return official ? {
      ...item,
      name: official.name,
      group: official.group,
      definition: official.definition,
      better_move: official.better_move,
      examples: official.examples,
      clarify_questions: official.clarify_questions || [],
      challenge_questions: official.challenge_questions || [],
      responses: official.responses || {},
      routing_note: official.routing_note || "",
      local_match_score: local ? Math.round(local.score) : null,
      matched_signals: local?.matches || []
    } : item;
  });
  return result;
}

function estimateCost(usage) {
  if (!usage || MODEL !== "gpt-5.6-terra") return null;
  const input = usage.input_tokens || 0;
  const cached = usage.input_tokens_details?.cached_tokens || 0;
  const uncached = Math.max(0, input - cached);
  const output = usage.output_tokens || 0;
  return Number(((uncached/1e6)*2 + (cached/1e6)*0.20 + (output/1e6)*12).toFixed(6));
}

function approxTokensFromChars(s) {
  return Math.ceil(String(s || "").length / 4);
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    ai_configured: Boolean(process.env.OPENAI_API_KEY),
    model: MODEL,
    fallacies: fallacies.length,
    mode: "local-keyword-first-routing",
    candidate_limit: CANDIDATE_LIMIT
  });
});

// Debug/inspection endpoint: searches all 100 traps locally and uses zero AI tokens.
app.post("/api/route", (req, res) => {
  const claim = typeof req.body?.claim === "string" ? req.body.claim.trim().slice(0, 1800) : "";
  const context = typeof req.body?.context === "string" ? req.body.context.trim().slice(0, 2200) : "";
  if (!claim) return res.status(400).json({ error: "Enter a claim first." });
  const routing = selectCandidates(`${claim}\n${context}`, CANDIDATE_LIMIT);
  res.json({
    claim_types: routing.claimTypes,
    likely_groups: routing.selectedGroups,
    qualifying_questions: buildClaimQualifiers(routing.claimTypes),
    candidates: routing.candidates.map(({ f, score, matches }) => ({
      id: f.id, name: f.name, group: f.group, local_score: Math.round(score),
      matched_signals: matches, clarify_questions: f.clarify_questions,
      challenge_questions: f.challenge_questions, responses: f.responses
    }))
  });
});

async function runAnalysis(v, candidateLimit = CANDIDATE_LIMIT, maxOutput = 1350) {
  const combinedForRouting = [v.claim, v.context, ...v.answers.map(a => `${a.question} ${a.answer}`)].join("\n");
  const routing = selectCandidates(combinedForRouting, candidateLimit);
  const answerText = v.answers.length
    ? v.answers.map((a, i) => `${i+1}. ${a.question}\nA: ${a.answer}`).join("\n")
    : "None yet.";

  const candidateCatalog = JSON.stringify(compactCandidateCatalog(routing.candidates));
  const dynamicRules = buildDynamicRules(routing.claimTypes);

  const input = `CLAIM-SPECIFIC RULES:\n${dynamicRules || "Use the core rules."}\n\nLOCAL ROUTING HINT (not a verdict):\nClaim types: ${routing.claimTypes.join(", ")}\nLikely groups: ${routing.selectedGroups.join(", ")}\n\nCANDIDATE FALLACIES FOR THIS REQUEST:\n${candidateCatalog}\n\nEXACT CLAIM:\n${v.claim}\n\nOPTIONAL CONTEXT (not automatically fact):\n${v.context || "None."}\n\nCLARIFYING ANSWERS:\n${answerText}\n\nROUND: ${v.round}\n\nTASK:\n1. Decompose the claim.\n2. Park established points and identify the reasoning bridge.\n3. If up to 3 answers could materially change the result, ask only those questions and use needs_clarification.\n4. Otherwise use analysis_ready.\n5. Choose at most 3 fallacy IDs only from the candidate catalog.\n6. Keep every explanation concise.\n7. For patterns, use numerator/denominator logic when available.\n8. For intent, separate impact, foreseeability, recklessness, and intended outcome.\n9. Give a natural response, not therapy jargon.`;

  const response = await openai.responses.create({
    model: MODEL,
    reasoning: { effort: "low" },
    instructions: CORE_INSTRUCTIONS,
    input,
    store: false,
    max_output_tokens: maxOutput,
    prompt_cache_key: "fallacy-finder-core-v3",
    text: {
      verbosity: "low",
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
  const parsed = enrich(JSON.parse(text), routing);
  return {
    analysis: parsed,
    meta: {
      model: response.model || MODEL,
      response_id: response.id,
      usage: response.usage || null,
      estimated_cost_usd: estimateCost(response.usage),
      efficient_mode: true,
      routed_groups: routing.selectedGroups,
      candidate_fallacies_sent: routing.candidates.length,
      local_keyword_matches: routing.candidates.reduce((n, x) => n + (x.matches?.length || 0), 0),
      approximate_request_input_tokens_before_schema: approxTokensFromChars(CORE_INSTRUCTIONS + input)
    }
  };
}

app.post("/api/analyze", async (req, res) => {
  try {
    const v = validateBody(req.body);
    if (v.error) return res.status(400).json({ error: v.error });
    if (!openai) return res.status(503).json({ error: "OPENAI_API_KEY is not configured on the server." });

    try {
      const result = await runAnalysis(v);
      return res.json(result);
    } catch (err) {
      // If a low-tier TPM limit is still hit, automatically retry with an even smaller catalog/output budget.
      const message = String(err?.message || "");
      const tokenLimitError = err?.status === 429 && /tokens per min|tpm|request too large/i.test(message);
      if (!tokenLimitError) throw err;
      console.warn("TPM limit hit; retrying in compact mode.");
      const result = await runAnalysis(v, 5, 900);
      result.meta.compact_retry = true;
      return res.json(result);
    }
  } catch (err) {
    console.error("Analyze error:", err);
    const status = err?.status && Number.isInteger(err.status) ? err.status : 500;
    let message = err?.message || "Analysis failed.";
    if (status === 429 && /tokens per min|tpm|request too large/i.test(message)) {
      message = "This analysis still exceeded the API token-per-minute limit. Try a shorter context, then retry. The app is already using compact routing.";
    }
    res.status(status).json({ error: message });
  }
});

app.get(/.*/, (req, res) => res.sendFile(path.join(__dirname, "public/index.html")));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Fallacy Finder AI running on port ${PORT} with ${MODEL} (efficient routing, max ${CANDIDATE_LIMIT} candidates)`);
});
