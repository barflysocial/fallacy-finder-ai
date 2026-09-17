import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import OpenAI from "openai";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;
const MODEL = process.env.OPENAI_MODEL || "gpt-5.6-terra";
const SCREENSHOT_MODEL = process.env.OPENAI_VISION_MODEL || MODEL;
const SCREENSHOT_MAX_IMAGES = 10;
const SCREENSHOT_MAX_DATA_URL_CHARS = 2_600_000;
const CANDIDATE_LIMIT = Math.max(5, Math.min(Number(process.env.CANDIDATE_LIMIT) || 8, 12));
const LEGAL_DISCLAIMER_VERSION = "clearsay-legal-2026-09-13-v2";
const CLEARSAY_DATA_DIR = process.env.CLEARSAY_DATA_DIR || path.join(__dirname, "data");
const COUPLES_STORE_PATH = path.join(CLEARSAY_DATA_DIR, "couples-sessions.json");
const COUPLES_STORE_VERSION = 2;

// v1.8.6 optional paid-access foundation. Payments remain OFF unless explicitly enabled.
const PAYMENTS_ENABLED = /^(1|true|yes)$/i.test(String(process.env.PAYMENTS_ENABLED || "false"));
const PAYMENTS_REQUIRED = PAYMENTS_ENABLED && /^(1|true|yes)$/i.test(String(process.env.PAYMENTS_REQUIRED || "false"));
const STRIPE_SECRET_KEY = String(process.env.STRIPE_SECRET_KEY || "").trim();
const CLEARSAY_PRICE_CENTS = Math.max(0, Math.floor(Number(process.env.CLEARSAY_PRICE_CENTS) || 0));
const CLEARSAY_CURRENCY = String(process.env.CLEARSAY_CURRENCY || "usd").trim().toLowerCase();
const CLEARSAY_ACCESS_HOURS = Math.max(1, Math.min(Math.floor(Number(process.env.CLEARSAY_ACCESS_HOURS) || 24), 24 * 365));
const CLEARSAY_ACCESS_PRODUCT_NAME = String(process.env.CLEARSAY_ACCESS_PRODUCT_NAME || "ClearSay Access Pass").trim().slice(0, 120);
const CLEARSAY_PUBLIC_URL = String(process.env.CLEARSAY_PUBLIC_URL || "").trim().replace(/\/$/, "");
const CLEARSAY_ACCESS_COOKIE = "clearsay_access_v186";
const CLEARSAY_ACCESS_SECRET = String(process.env.CLEARSAY_ACCESS_SECRET || STRIPE_SECRET_KEY || "").trim();
const BILLING_CONFIGURED = Boolean(STRIPE_SECRET_KEY && CLEARSAY_ACCESS_SECRET && CLEARSAY_PRICE_CENTS > 0 && /^[a-z]{3}$/i.test(CLEARSAY_CURRENCY));

const readJSON = (p) => JSON.parse(fs.readFileSync(path.join(__dirname, p), "utf8"));
const fallacies = readJSON("knowledge/fallacies.json");
const claimQualifiers = readJSON("knowledge/claim-qualifiers.json");
const fallacyById = new Map(fallacies.map((f) => [f.id, f]));
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

// Keep the always-sent instructions short. Detailed rules are added only when the claim needs them.
const CORE_INSTRUCTIONS = `You are the Fallacy Finder reasoning engine inside ClearSay.
Your job is to clarify claims and test reasoning, not decide who wins.

Rules:
- Clarify the claim before naming a fallacy.
- Separate event/fact, feeling, behavior label, interpretation/meaning, intent/motive, cause, pattern/frequency, prediction, value/rule, identity/character, request/boundary, and repair status.
- Separate what is known, inferred, disputed, contradicted, unsupported, and unknown. Never invent evidence.
- Evidence quality matters: direct records and observations are different from memory, hearsay, inference, and assumption.
- A reported feeling does not need external proof, but it does not by itself prove cause, intent, or moral fault.
- Impact does not prove intent. Sequence does not prove causation.
- External factual allegations carry an initial burden of support by the person making them. Do not make the other person prove a negative before the allegation has support.
- Match the strength of the conclusion to the evidence and to the speaker's stated certainty.
- Pattern claims need scope, occurrences/opportunities, comparable cases, and exceptions. Frequency and severity are separate.
- Counterexamples can defeat a literal absolute without erasing the underlying concern.
- Distinguish a mutual agreement from a preference, expectation, norm, or moral rule. Verify whether both people accepted substantially the same terms, whether the agreement was temporary or conditional, whether it was fulfilled, and whether any later change was mutual, unilateral, disputed, or simply the expiration of an agreed condition.
- A unilateral change does not retroactively rewrite the original agreement. A later need or request may be valid in the present while remaining separate from whether the original terms were fulfilled. If new requirements are used retroactively to deny fulfillment of previously agreed criteria, flag a possible standard-shift / moving-goalposts issue only after the original agreement and later change are sufficiently established.
- Time does not erase whether an event happened, but it can change its relevance to a present claim.
- Repair actions and continuing emotional resolution are separate. An apology alone does not prove complete repair; continuing pain alone does not prove zero repair.
- On repair-status claims, map each supporting statement by what it actually bears on: current behavior, emotional impact, agreement compliance, repair action, trust, ongoing consequence, or intent interpretation. State what that evidence can establish and what it cannot.
- If current behavior is used to prove repair failed, ask whether it is the same behavior the repair was supposed to change, a closely related behavior, or a different issue.
- Detect definition collisions before judging reasoning: if both people use the same important word (for example repair, support, safety, trust, space, control, priority, equality, or family) with materially different meanings, state each meaning and ask for an operational shared definition. Do not treat a definition difference itself as a fallacy.
- Separate CURRENT BEHAVIOR from HISTORICAL INJURY. A behavior can stop while the injury remains unresolved; an injury can remain unresolved without proving the behavior is still occurring. State which relationship the supplied evidence supports.
- Explicit closure is a mutual agreement, not silence, affection, apology, or merely ending the conversation. A topic is closed only when both participants accept what is resolved, what remains open, and the next step (if any).
- A fallacy match does not prove the conclusion false. No clear fallacy is a valid outcome. Insufficient information is also a valid outcome.
- Check whether conclusions depend on earlier premises; if a premise is weak, say what downstream conclusion becomes less secure.
- Flag contradictions only when two supplied statements genuinely cannot both stand as stated; otherwise call it tension or ambiguity.
- State what evidence or clarification would materially change the result.
- Identify the kind of disagreement that remains when the reasoning itself is sound.
- The server already searched all 100 traps locally. Use only fallacy IDs in the candidate catalog.
- Match scores are reasoning-fit scores, not scientific probabilities.
- Be concise and use plain, natural language.`

const CLAIM_TYPE_RULES = {
  feeling: `FEELING: distinguish pure emotion from a thought/label disguised as a feeling. Validate the emotion separately from external claims about cause or intent.`,
  behavior_label: `BEHAVIOR LABEL: translate loaded shorthand such as ignored, controlled, interrogated, abandoned, or disrespected into the least interpretive concrete action available.`,
  intent_motive: `INTENT: distinguish event, impact, foreseeability, recklessness/indifference to known risk, and intended outcome. Stronger motive claims require stronger support. Allow “I know what happened; I do not know why.”`,
  cause: `CAUSE: sequence is not causation. Consider mechanism, alternative causes, repeated association, and whether several causes may operate together.`,
  pattern_frequency: `PATTERN: define behavior and time window; use occurrences / relevant opportunities when available; examine exceptions and comparable cases; separate frequency from severity and from intent.`,
  prediction: `PREDICTION: distinguish possible, probable, and certain. Treat forecasts as revisable, not present facts.`,
  value_rule: `VALUE/RULE: identify whether a “should” is a preference, norm, moral principle, legal/professional rule, or mutual agreement. If an agreement is claimed, verify mutual assent to the same terms, duration/conditions, fulfillment, and whether any later change was mutual, unilateral, disputed, or an agreed expiration.`,
  identity_character: `IDENTITY: character claims are broader than behavior claims. Translate identity labels back into representative behaviors before judging the whole person.`,
  request_boundary: `REQUEST/BOUNDARY: a request or preference generally does not need proof to exist. Clarify who is being asked to do what and distinguish a boundary about one's own action from control of another person.`,
  repair_status: `REPAIR STATUS: use only when the claim is about whether an injury, broken agreement, or rupture has been adequately addressed. Separate observable repair actions from subjective resolution. Evaluate acknowledgment, appropriate responsibility, concrete correction/restitution, behavior change, agreed repair standards, new agreements, ongoing consequences, and whether resolution is mutual or disputed. When an agreement or repair standard matters, verify what both people actually agreed to, whether the original terms were fulfilled, and whether any later change was mutual or unilateral. A later unilateral requirement can be a valid new request but does not by itself prove the original repair agreement was never fulfilled. If both people had mutually accepted a repair definition, keep that definition active until both people accept a replacement. Treat a one-person redefinition as a proposed change, not as the new shared repair standard, and never apply it retroactively to erase prior fulfillment under the earlier mutually accepted standard. Map every behavioral or feeling premise to the repair conclusion: continuing pain establishes unresolved emotional impact, not automatically zero repair; recurrence of the same behavior the repair was supposed to change is direct evidence against behavioral repair; a different current behavior may be only indirect or irrelevant. An apology alone does not prove complete repair; continuing hurt alone does not prove no repair occurred.`,
  event_fact: `EVENT/FACT: if disputed and important, identify what supports the event. Do not treat confidence, repetition, or popularity as proof.`,
  interpretation_meaning: `INTERPRETATION: separate what happened from what the event is believed to mean. Treat meaning as an inference unless independently supported.`
};

const GROUP_SIGNALS = {
  "Evidence": ["prove", "proof", "evidence", "must be", "everyone agrees", "therapist said", "family says", "because", "therefore", "no proof", "can't prove", "cannot prove", "obviously", "clearly"],
  "Intent": ["wanted to", "meant to", "trying to", "tried to", "deliberately", "on purpose", "you knew", "because you wanted", "real reason", "punish", "control me", "hurt me"],
  "Feeling → Fact": ["i feel", "i felt", "feel like", "unsafe", "unwanted", "abandoned", "controlled", "rejected", "if you loved", "if you cared", "should", "ought"],
  "Memory": ["remember", "i recall", "you said", "i never said", "back then", "from the beginning", "always been", "should have known", "used to", "years ago", "year ago", "long ago", "since then", "at the time"],
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
  if (/\b(repair|repaired|repairing|resolved|resolution|made it right|make it right|fixed it|already addressed|already apologized|apologized so|said sorry so|should be over|move on from this|moved on|nothing has been done|nothing was done|never repaired|not repaired|unrepaired|still unresolved|fully resolved|partially repaired)\b/.test(t)) out.add("repair_status");
  return [...out];
}

function hasAgreementSignal(text = "") {
  const t = normalize(text);
  return /\b(agreed|agreement|we agreed|promised|promise|commitment|committed|deal was|our rule|we decided|understanding was|terms were|repair standard|repair agreement|renegotiated|changed the agreement|changed the terms|new terms|original terms|unilateral|unilaterally|broke(n)? (the )?agreement|kept (the )?agreement|fulfilled (the )?agreement)\b/.test(t);
}


const VALID_CLAIM_TYPES = new Set([
  "event_fact","feeling","behavior_label","interpretation_meaning","intent_motive",
  "cause","pattern_frequency","prediction","value_rule","identity_character",
  "request_boundary","repair_status"
]);

function mergeForcedClaimTypes(detected, forced){
  const merged=new Set(detected);
  for(const t of Array.isArray(forced)?forced:[]){if(VALID_CLAIM_TYPES.has(t)) merged.add(t);}
  return [...merged];
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
    repair_status: [["Evidence", 2], ["Fairness", 2], ["Relevance", 1], ["Openness", 1]],
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
    66:[/\b(not enough|doesn't count|does not count|now you need)\b/, /\b(unilateral|unilaterally|changed the terms|new requirement|new terms|original terms).{0,45}\b(not enough|doesn't count|never repaired|not repaired|failed)\b/],
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


function buildClaimQualifiers(claimTypes, sourceText = "") {
  const priority = [
    "repair_status", "behavior_label", "intent_motive", "pattern_frequency", "cause",
    "feeling", "interpretation_meaning", "identity_character", "prediction",
    "value_rule", "request_boundary", "event_fact"
  ];
  const selected = priority.filter((t) => claimTypes.includes(t));
  const questions = [{ claim_type: "universal", ...claimQualifiers.universal }];
  const isRepairClaim = claimTypes.includes("repair_status");

  // Evidence source and stated certainty are separate from claim type. They are optional,
  // but they let the final analysis match conclusion strength to evidentiary strength.
  for (const q of (claimQualifiers.evidence_quality || []).slice(0, 2)) {
    questions.push({ claim_type: "evidence_quality", ...q });
  }

  // Agreements are a dimension of a claim, not a 13th claim identifier.
  // Repair disputes often depend on an earlier agreed repair standard even when
  // the current sentence does not literally use the word “agreement,” so expose
  // the verification branch for repair claims as well. Conditional questions
  // stay hidden unless the user says an agreement may actually exist.
  if (hasAgreementSignal(sourceText) || isRepairClaim) {
    for (const q of (claimQualifiers.agreement_layer || [])) {
      questions.push({ claim_type: "agreement_layer", ...q });
    }
  }

  // Timing is a separate dimension, not a claim type. On repair-status claims,
  // skip the generic "was it repaired?" time question because the dedicated
  // repair branch asks that with more precision.
  for (const q of (claimQualifiers.temporal_relevance || [])) {
    if (isRepairClaim && /acknowledged, repaired, or otherwise resolved/i.test(q.question || "")) continue;
    questions.push({ claim_type: "temporal_relevance", ...q });
  }

  // Repair claims get their own compact diagnostic because "repaired" is itself
  // a status claim that needs defined elements rather than a binary verdict.
  if (isRepairClaim) {
    const repairBank = claimQualifiers.repair_status || [];
    for (const q of repairBank.slice(0, 5)) {
      questions.push({ claim_type: "repair_status", ...q });
    }
    // Only add the evidence-mapping questions when the wording actually contains
    // the corresponding kind of premise. This keeps repair qualification focused.
    if (claimTypes.includes("behavior_label") || claimTypes.includes("pattern_frequency")) {
      for (const q of repairBank.slice(5, 7)) questions.push({ claim_type: "repair_evidence", ...q });
    }
    if (claimTypes.includes("feeling")) {
      const q = repairBank[7];
      if (q) questions.push({ claim_type: "repair_evidence", ...q });
    }
  }

  // Keep other claim-type questions compact so the pre-AI step does not become an interrogation.
  let slots = isRepairClaim ? 2 : 5;
  for (const type of selected) {
    if (type === "repair_status" || slots <= 0) continue;
    const bank = claimQualifiers[type] || [];
    if (!bank.length) continue;
    const desired = type === "pattern_frequency" ? 3 : ((type === "intent_motive" || selected.length === 1) ? 2 : 1);
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


const screenshotTranscriptSchema = {
  type: "object", additionalProperties: false,
  properties: {
    transcript: { type: "string" },
    warnings: { type: "array", items: { type: "string" } },
    images: { type: "array", items: { type: "object", additionalProperties: false, properties: {
      index: { type: "integer" },
      speaker_attribution: { type: "string", enum: ["clear","partial","unclear"] },
      notes: { type: "string" }
    }, required: ["index","speaker_attribution","notes"] } }
  }, required: ["transcript","warnings","images"]
};
function normalizeScreenshotImages(body){
  const items=Array.isArray(body?.images)?body.images:[];
  if(!items.length)return {error:"Add at least one screenshot first."};
  if(items.length>SCREENSHOT_MAX_IMAGES)return {error:`Please upload no more than ${SCREENSHOT_MAX_IMAGES} screenshots at once.`};
  const out=[];let total=0;
  for(let i=0;i<items.length;i++){
    const dataUrl=String(items[i]?.data_url||"");
    if(!/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=\r\n]+$/.test(dataUrl))return {error:`Screenshot ${i+1} is not a supported image.`};
    if(dataUrl.length>SCREENSHOT_MAX_DATA_URL_CHARS)return {error:`Screenshot ${i+1} is too large after preparation.`};
    total+=dataUrl.length;if(total>14_000_000)return {error:"The screenshot batch is too large. Import fewer screenshots at a time."};
    out.push({index:i+1,name:String(items[i]?.name||`Screenshot ${i+1}`).slice(0,120),data_url:dataUrl});
  }
  return {images:out};
}
async function handleScreenshotTranscript(req,res){
  try{
    if(!openai)return res.status(503).json({error:"OPENAI_API_KEY is not configured on the server."});
    const normalized=normalizeScreenshotImages(req.body);if(normalized.error)return res.status(400).json({error:normalized.error});
    const mineColor=String(req.body?.mine_color||"").toLowerCase();
    const otherColor=String(req.body?.other_color||"").toLowerCase();
    const allowedColors=new Set(["gray","blue","green"]);
    if(!allowedColors.has(mineColor)||!allowedColors.has(otherColor))return res.status(400).json({error:"Choose Gray, Blue, or Green for both participants before reading screenshots."});
    if(mineColor===otherColor)return res.status(400).json({error:"Choose different message colors for you and the other person so speaker assignment is unambiguous."});
    const content=[{type:"input_text",text:`Read these ${normalized.images.length} screenshots as one ordered text-message conversation.\n\nUSER-PROVIDED SPEAKER COLOR MAP:\n- ${mineColor.toUpperCase()} message bubbles = You.\n- ${otherColor.toUpperCase()} message bubbles = Other person.\n- This user-provided color map overrides normal iMessage/SMS conventions and overrides assumptions based only on left/right position. Use bubble color and actual message-bubble shape together; do not classify unrelated UI elements by color.\n- If a bubble's color is genuinely ambiguous because of image quality, tinting, accessibility settings, or theming, label that speaker Unknown speaker and add a warning instead of guessing.\n\nTRANSCRIPTION RULES:\n- Transcribe only visible conversation content. Ignore status bars, battery/time indicators, keyboard chrome, app controls, reaction controls, and decorative UI unless they materially change the message meaning.\n- Preserve screenshot order exactly. If adjacent screenshots visibly overlap, do not duplicate repeated messages.\n- Preserve visible timestamps/date separators when useful.\n- Use a speaker label before every message or coherent consecutive block. Label ${mineColor.toUpperCase()} bubbles as You and ${otherColor.toUpperCase()} bubbles as Other person. If a visible contact name clearly identifies the other participant, you may preserve that name in parentheses after Other person, but do not replace the user-provided color assignment.\n- Preserve spelling, punctuation, emoji, and obvious line breaks as closely as practical. Do not rewrite, summarize, correct grammar, or infer missing words.\n- If text is obscured, cut off, or unreadable, mark [unreadable] rather than guessing.\n- The transcript must be suitable for later reasoning analysis, so keep wording faithful to the screenshots.\n- Add a warning whenever speaker attribution or text legibility is materially uncertain.\n\nReturn one continuous transcript, not commentary.`}];
    for(const img of normalized.images){content.push({type:"input_text",text:`Screenshot ${img.index}: ${img.name}`});content.push({type:"input_image",image_url:img.data_url,detail:"high"});}
    const response=await openai.responses.create({model:SCREENSHOT_MODEL,reasoning:{effort:"low"},instructions:"You are ClearSay's screenshot transcription layer. Faithfully extract visible conversation text. Do not adjudicate, analyze, diagnose, or infer hidden intent. Never invent unreadable or hidden text.",input:[{role:"user",content}],store:false,max_output_tokens:12000,prompt_cache_key:"clearsay-screenshot-transcript-v1",text:{verbosity:"low",format:{type:"json_schema",name:"clearsay_screenshot_transcript",strict:true,schema:screenshotTranscriptSchema}}});
    if(!response.output_text)throw new Error("The screenshot reader returned no transcript.");
    const parsed=JSON.parse(response.output_text);
    return res.json({...parsed,meta:{model:response.model||SCREENSHOT_MODEL,usage:response.usage||null,estimated_cost_usd:estimateCost(response.usage),images_received:normalized.images.length}});
  }catch(err){console.error("Screenshot transcript error:",err);const status=err?.status&&Number.isInteger(err.status)?err.status:500;return res.status(status).json({error:err?.message||"Screenshot transcription failed."});}
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "256kb" }));
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
app.use("/api/session/analyze", limiter);
app.use("/api/transcript/extract", limiter);
app.use("/api/transcript/audit", limiter);

function requestOrigin(req) {
  if (CLEARSAY_PUBLIC_URL) return CLEARSAY_PUBLIC_URL;
  const forwarded = String(req.get("x-forwarded-proto") || "").split(",")[0].trim();
  const proto = forwarded || req.protocol || "https";
  return `${proto}://${req.get("host")}`;
}
function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (!key) continue;
    try { out[key] = decodeURIComponent(value); } catch { out[key] = value; }
  }
  return out;
}
function accessSignature(payload) {
  if (!CLEARSAY_ACCESS_SECRET) return "";
  return createHmac("sha256", CLEARSAY_ACCESS_SECRET).update(payload).digest("base64url");
}
function issueAccessToken(expiresAtMs) {
  const payload = `v1.${Math.floor(expiresAtMs / 1000)}`;
  return `${payload}.${accessSignature(payload)}`;
}
function validateAccessToken(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || parts[0] !== "v1" || !CLEARSAY_ACCESS_SECRET) return null;
  const expiresSec = Number(parts[1]);
  if (!Number.isFinite(expiresSec) || expiresSec * 1000 <= Date.now()) return null;
  const payload = `${parts[0]}.${parts[1]}`;
  const expected = Buffer.from(accessSignature(payload));
  const provided = Buffer.from(parts[2]);
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null;
  return { expiresAt: new Date(expiresSec * 1000).toISOString(), expiresAtMs: expiresSec * 1000 };
}
function currentAccess(req) {
  if (!PAYMENTS_ENABLED || !PAYMENTS_REQUIRED) return { active: true, expiresAt: null };
  const token = parseCookies(req)[CLEARSAY_ACCESS_COOKIE];
  const valid = validateAccessToken(token);
  return valid ? { active: true, expiresAt: valid.expiresAt } : { active: false, expiresAt: null };
}
function setAccessCookie(req, res, expiresAtMs) {
  const maxAge = Math.max(1, Math.floor((expiresAtMs - Date.now()) / 1000));
  const token = encodeURIComponent(issueAccessToken(expiresAtMs));
  const forwarded = String(req.get("x-forwarded-proto") || "").split(",")[0].trim();
  const secure = req.secure || forwarded === "https" || process.env.NODE_ENV === "production";
  res.setHeader("Set-Cookie", `${CLEARSAY_ACCESS_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`);
}
async function stripeRequest(pathname, { method = "GET", form = null } = {}) {
  if (!STRIPE_SECRET_KEY) throw new Error("Stripe is not configured.");
  const options = { method, headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` } };
  if (form) {
    options.headers["Content-Type"] = "application/x-www-form-urlencoded";
    options.body = form.toString();
  }
  const response = await fetch(`https://api.stripe.com${pathname}`, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(data?.error?.message || "Stripe request failed.");
    err.status = response.status;
    throw err;
  }
  return data;
}

app.get("/api/billing/status", (req, res) => {
  const access = currentAccess(req);
  res.json({
    enabled: PAYMENTS_ENABLED,
    required: PAYMENTS_REQUIRED && BILLING_CONFIGURED,
    configured: BILLING_CONFIGURED,
    setup_incomplete: PAYMENTS_ENABLED && !BILLING_CONFIGURED,
    access_active: access.active,
    expires_at: access.expiresAt,
    price_cents: CLEARSAY_PRICE_CENTS,
    currency: CLEARSAY_CURRENCY,
    access_hours: CLEARSAY_ACCESS_HOURS,
    product_name: CLEARSAY_ACCESS_PRODUCT_NAME,
    provider: "stripe_checkout",
    screenshot_upload_import: true,
    screenshot_transcription_model: SCREENSHOT_MODEL,
    screenshot_max_images: SCREENSHOT_MAX_IMAGES,
    apple_pay_ready: BILLING_CONFIGURED
  });
});

app.post("/api/billing/checkout", async (req, res) => {
  try {
    if (!PAYMENTS_ENABLED) return res.status(409).json({ error: "Payments are not enabled." });
    if (!BILLING_CONFIGURED) return res.status(503).json({ error: "Stripe and ClearSay pricing must be configured before checkout can start." });
    const origin = requestOrigin(req);
    const form = new URLSearchParams();
    form.set("mode", "payment");
    form.set("success_url", `${origin}/?payment=success&session_id={CHECKOUT_SESSION_ID}`);
    form.set("cancel_url", `${origin}/?payment=cancelled`);
    form.set("line_items[0][price_data][currency]", CLEARSAY_CURRENCY);
    form.set("line_items[0][price_data][product_data][name]", CLEARSAY_ACCESS_PRODUCT_NAME);
    form.set("line_items[0][price_data][product_data][description]", `${CLEARSAY_ACCESS_HOURS}-hour ClearSay access`);
    form.set("line_items[0][price_data][unit_amount]", String(CLEARSAY_PRICE_CENTS));
    form.set("line_items[0][quantity]", "1");
    form.set("metadata[clearsay_access_hours]", String(CLEARSAY_ACCESS_HOURS));
    form.set("metadata[clearsay_app_version]", "1.8.9");
    const checkout = await stripeRequest("/v1/checkout/sessions", { method: "POST", form });
    res.json({ id: checkout.id, url: checkout.url });
  } catch (err) {
    console.error("Billing checkout error:", err);
    res.status(err?.status && Number.isInteger(err.status) ? err.status : 500).json({ error: err?.message || "Unable to start checkout." });
  }
});

app.get("/api/billing/confirm", async (req, res) => {
  try {
    if (!PAYMENTS_ENABLED || !BILLING_CONFIGURED) return res.status(409).json({ error: "Payments are not configured." });
    const sessionId = String(req.query?.session_id || "").trim();
    if (!/^cs_(test_|live_)[A-Za-z0-9]+/.test(sessionId)) return res.status(400).json({ error: "A valid Stripe Checkout session is required." });
    const checkout = await stripeRequest(`/v1/checkout/sessions/${encodeURIComponent(sessionId)}`);
    if (checkout.mode !== "payment" || checkout.payment_status !== "paid") return res.status(402).json({ error: "Stripe has not marked this checkout as paid." });
    if (Number(checkout.amount_total) !== CLEARSAY_PRICE_CENTS || String(checkout.currency || "").toLowerCase() !== CLEARSAY_CURRENCY) return res.status(409).json({ error: "The completed checkout does not match the configured ClearSay access product." });
    const expiresAtMs = Date.now() + CLEARSAY_ACCESS_HOURS * 60 * 60 * 1000;
    setAccessCookie(req, res, expiresAtMs);
    res.json({ ok: true, access_active: true, expires_at: new Date(expiresAtMs).toISOString() });
  } catch (err) {
    console.error("Billing confirmation error:", err);
    res.status(err?.status && Number.isInteger(err.status) ? err.status : 500).json({ error: err?.message || "Unable to verify payment." });
  }
});

// If paid access is required, enforce it server-side for premium API calls too.
app.use("/api", (req, res, next) => {
  if (!PAYMENTS_ENABLED || !PAYMENTS_REQUIRED || !BILLING_CONFIGURED) return next();
  const path = req.path || "";
  if (path === "/health" || path.startsWith("/billing/")) return next();
  if (currentAccess(req).active) return next();
  return res.status(402).json({ error: "Paid ClearSay access is required for this request.", payment_required: true });
});

// Screenshot batches use a dedicated media JSON content type so the ordinary API body limit stays small.
app.post("/api/transcript/screenshots", limiter, express.json({ type: "application/vnd.clearsay.screenshots", limit: "16mb" }), handleScreenshotTranscript);

const outputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: { type: "string", enum: ["needs_clarification", "analysis_ready"] },
    summary: { type: "string" },
    reasoning_outcome: {
      type: "object", additionalProperties: false,
      properties: {
        verdict: { type: "string", enum: ["sound_or_reasonable","possible_reasoning_issue","fallacy_likely","insufficient_information","not_a_truth_claim"] },
        confidence: { type: "string", enum: ["low","moderate","high"] },
        explanation: { type: "string" },
        no_fallacy_reason: { type: "string" }
      },
      required: ["verdict","confidence","explanation","no_fallacy_reason"]
    },
    claim_status: {
      type: "object", additionalProperties: false,
      properties: {
        classification: { type: "string", enum: ["established","supported","partially_established","disputed","inferred","unsupported","contradicted","unknown","not_applicable"] },
        explanation: { type: "string" }
      },
      required: ["classification","explanation"]
    },
    claim_parts: {
      type: "array", maxItems: 9,
      items: {
        type: "object", additionalProperties: false,
        properties: {
          text: { type: "string" },
          type: { type: "string", enum: ["event_fact","feeling","behavior_label","interpretation_meaning","intent_motive","cause","pattern_frequency","prediction","value_rule","identity_character","request_boundary","repair_status"] },
          status: { type: "string", enum: ["established","supported","partially_established","inferred","disputed","unsupported","contradicted","unknown","not_applicable"] },
          explanation: { type: "string" }
        },
        required: ["text","type","status","explanation"]
      }
    },
    evidence_assessment: {
      type: "object", additionalProperties: false,
      properties: {
        quality: { type: "string", enum: ["strong","moderate","limited","unknown","not_applicable"] },
        strongest_source: { type: "string" },
        assessment: { type: "string" },
        missing_evidence: { type: "string" }
      },
      required: ["quality","strongest_source","assessment","missing_evidence"]
    },
    claim_certainty: {
      type: "object", additionalProperties: false,
      properties: {
        level: { type: "string", enum: ["possible","suspected","probable","strongly_supported","certain","not_stated"] },
        fit: { type: "string" }
      },
      required: ["level","fit"]
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
    claim_dependencies: {
      type: "array", maxItems: 4,
      items: {
        type: "object", additionalProperties: false,
        properties: {
          premise: { type: "string" },
          conclusion: { type: "string" },
          premise_status: { type: "string", enum: ["established","supported","disputed","inferred","unsupported","contradicted","unknown"] },
          effect_if_weak: { type: "string" }
        },
        required: ["premise","conclusion","premise_status","effect_if_weak"]
      }
    },
    contradictions: {
      type: "array", maxItems: 3,
      items: {
        type: "object", additionalProperties: false,
        properties: {
          statement_a: { type: "string" },
          statement_b: { type: "string" },
          kind: { type: "string", enum: ["contradiction","tension","ambiguity"] },
          assessment: { type: "string" }
        },
        required: ["statement_a","statement_b","kind","assessment"]
      }
    },
    counterexample_test: {
      type: "object", additionalProperties: false,
      properties: {
        applies: { type: "boolean" },
        literal_claim: { type: "string" },
        counterexample_effect: { type: "string" },
        underlying_concern: { type: "string" }
      },
      required: ["applies","literal_claim","counterexample_effect","underlying_concern"]
    },
    agreement_status: {
      type: "object", additionalProperties: false,
      properties: {
        applies: { type: "boolean" },
        existence: { type: "string", enum: ["mutually_agreed","existence_disputed","terms_disputed","implied_or_assumed","preference_or_expectation","unclear","not_applicable"] },
        original_terms: { type: "string" },
        mutual_assent: { type: "string", enum: ["both_agreed","one_sided","disputed","implied_or_assumed","unknown","not_applicable"] },
        duration_condition: { type: "string", enum: ["ongoing","temporary","conditional","disputed","unknown","not_applicable"] },
        change_status: { type: "string", enum: ["unchanged","mutually_changed","unilaterally_changed","change_disputed","expired_or_condition_ended","unclear","not_applicable"] },
        changed_terms: { type: "string" },
        later_acceptance: { type: "string", enum: ["accepted","not_accepted","disputed","unclear","not_applicable"] },
        fulfillment_status: { type: "string", enum: ["fulfilled","partially_fulfilled","not_fulfilled","in_progress_or_not_due","disputed","unknown","not_applicable"] },
        retroactive_standard_issue: { type: "boolean" },
        assessment: { type: "string" },
        current_effect: { type: "string" }
      },
      required: ["applies","existence","original_terms","mutual_assent","duration_condition","change_status","changed_terms","later_acceptance","fulfillment_status","retroactive_standard_issue","assessment","current_effect"]
    },
    definition_collision: {
      type: "object", additionalProperties: false,
      properties: {
        applies: { type: "boolean" }, term: { type: "string" }, meaning_a: { type: "string" }, meaning_b: { type: "string" }, shared_overlap: { type: "string" },
        status: { type: "string", enum: ["different_definitions","possible_difference","same_definition","unclear","not_applicable"] }, assessment: { type: "string" }, clarifying_question: { type: "string" }
      },
      required: ["applies","term","meaning_a","meaning_b","shared_overlap","status","assessment","clarifying_question"]
    },
    current_vs_historical: {
      type: "object", additionalProperties: false,
      properties: {
        applies: { type: "boolean" }, historical_injury: { type: "string" }, current_behavior: { type: "string" },
        relationship: { type: "string", enum: ["same_behavior_continues","behavior_changed_injury_remains","behavior_stopped_injury_remains","different_current_issue","mixed_or_disputed","unclear","not_applicable"] }, assessment: { type: "string" }
      },
      required: ["applies","historical_injury","current_behavior","relationship","assessment"]
    },
    severity_frequency: {
      type: "object", additionalProperties: false,
      properties: {
        applies: { type: "boolean" },
        frequency: { type: "string" },
        severity: { type: "string" },
        assessment: { type: "string" }
      },
      required: ["applies","frequency","severity","assessment"]
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
    temporal_relevance: {
      type: "object", additionalProperties: false,
      properties: {
        applies: { type: "boolean" },
        time_scope: { type: "string" },
        role_of_history: { type: "string", enum: ["current_event","historical_context","continuing_pattern","ongoing_consequence","unresolved_repair","historical_event_used_as_current_proof","unclear","not_applicable"] },
        assessment: { type: "string" },
        current_evidence_needed: { type: "string" }
      },
      required: ["applies","time_scope","role_of_history","assessment","current_evidence_needed"]
    },
    repair_status: {
      type: "object", additionalProperties: false,
      properties: {
        applies: { type: "boolean" },
        classification: { type: "string", enum: ["not_addressed","repair_attempted","partially_repaired","behaviorally_repaired","repair_disputed","mutually_resolved","ongoing_violation","irreparable_consequence_with_repair_efforts","unclear","not_applicable"] },
        original_issue: { type: "string" },
        repair_actions: { type: "string" },
        behavior_after: { type: "string" },
        what_remains_unresolved: { type: "string" },
        assessment: { type: "string" }
      },
      required: ["applies","classification","original_issue","repair_actions","behavior_after","what_remains_unresolved","assessment"]
    },
    repair_evidence_mapping: {
      type: "object", additionalProperties: false,
      properties: {
        applies: { type: "boolean" },
        conclusion_support: { type: "string", enum: ["strong","moderate","limited","insufficient","mixed","not_applicable"] },
        behavioral_repair: { type: "string" },
        emotional_resolution: { type: "string" },
        overall_assessment: { type: "string" },
        reasoning_warning: { type: "string" },
        evidence_items: {
          type: "array", maxItems: 7,
          items: {
            type: "object", additionalProperties: false,
            properties: {
              statement: { type: "string" },
              evidence_role: { type: "string", enum: ["behavioral_evidence","emotional_impact","agreement_evidence","repair_action_evidence","trust_evidence","ongoing_consequence","intent_interpretation","other"] },
              status: { type: "string", enum: ["established","supported","partially_established","disputed","inferred","unsupported","contradicted","unknown","not_applicable"] },
              relevance_to_repair: { type: "string", enum: ["direct","indirect","limited","none","unclear"] },
              what_it_establishes: { type: "string" },
              what_it_does_not_establish: { type: "string" }
            },
            required: ["statement","evidence_role","status","relevance_to_repair","what_it_establishes","what_it_does_not_establish"]
          }
        }
      },
      required: ["applies","conclusion_support","behavioral_repair","emotional_resolution","overall_assessment","reasoning_warning","evidence_items"]
    },
    burden_of_proof: {
      type: "object", additionalProperties: false,
      properties: {
        applies: { type: "boolean" },
        holder: { type: "string", enum: ["claimant","respondent","shared","none","unclear"] },
        explanation: { type: "string" },
        next_move: { type: "string" }
      },
      required: ["applies","holder","explanation","next_move"]
    },
    disagreement: {
      type: "object", additionalProperties: false,
      properties: {
        type: { type: "string", enum: ["factual","interpretation","memory","value","preference","boundary","agreement","repair","definition","insufficient_evidence","mixed","none_apparent"] },
        explanation: { type: "string" }
      },
      required: ["type","explanation"]
    },
    what_would_change_result: { type: "array", items: { type: "string" }, maxItems: 4 },
    better_wording: { type: "string" },
    suggested_response: { type: "string" },
    response_options: {
      type: "object", additionalProperties: false,
      properties: {
        clarify: { type: "string" },
        evidence: { type: "string" },
        direct: { type: "string" },
        deescalating: { type: "string" }
      },
      required: ["clarify","evidence","direct","deescalating"]
    },
    therapist_suggested_response: { type: "string" },
    therapist_response_options: {
      type: "object", additionalProperties: false,
      properties: {
        clarify: { type: "string" },
        evidence: { type: "string" },
        direct: { type: "string" },
        deescalating: { type: "string" }
      },
      required: ["clarify","evidence","direct","deescalating"]
    },
    caution: { type: "string" }
  },
  required: ["status","summary","reasoning_outcome","claim_status","claim_parts","evidence_assessment","claim_certainty","reasoning_bridge","claim_dependencies","contradictions","counterexample_test","agreement_status","definition_collision","current_vs_historical","severity_frequency","established_points","unresolved_points","questions","likely_fallacies","temporal_relevance","repair_status","repair_evidence_mapping","burden_of_proof","disagreement","what_would_change_result","better_wording","suggested_response","response_options","therapist_suggested_response","therapist_response_options","caution"]
};

const sessionOverviewSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    scope_warning: { type: "string" },
    main_issue: { type: "string" },
    overall_confidence: { type: "string", enum: ["low","moderate","high"] },
    common_ground: { type: "array", items: { type: "string" }, maxItems: 6 },
    disputed_points: { type: "array", items: { type: "string" }, maxItems: 7 },
    participant_positions: {
      type: "object", additionalProperties: false,
      properties: { A: { type: "string" }, B: { type: "string" } },
      required: ["A","B"]
    },
    claim_evolution: {
      type: "array", maxItems: 6,
      items: {
        type: "object", additionalProperties: false,
        properties: {
          from_claim: { type: "string" },
          to_claim: { type: "string" },
          change: { type: "string" },
          significance: { type: "string" }
        },
        required: ["from_claim","to_claim","change","significance"]
      }
    },
    reasoning_patterns: {
      type: "array", maxItems: 6,
      items: {
        type: "object", additionalProperties: false,
        properties: {
          pattern: { type: "string" },
          assessment: { type: "string" },
          turn_refs: { type: "array", items: { type: "integer" }, maxItems: 10 }
        },
        required: ["pattern","assessment","turn_refs"]
      }
    },
    agreement_overview: {
      type: "object", additionalProperties: false,
      properties: {
        applies: { type: "boolean" },
        original_agreement: { type: "string" },
        mutual_assent: { type: "string" },
        change_status: { type: "string", enum: ["unchanged","mutually_changed","unilaterally_changed","change_disputed","expired_or_condition_ended","unclear","not_applicable"] },
        fulfillment_status: { type: "string" },
        assessment: { type: "string" }
      },
      required: ["applies","original_agreement","mutual_assent","change_status","fulfillment_status","assessment"]
    },
    repair_overview: {
      type: "object", additionalProperties: false,
      properties: {
        applies: { type: "boolean" },
        behavioral_repair: { type: "string" },
        emotional_resolution: { type: "string" },
        assessment: { type: "string" }
      },
      required: ["applies","behavioral_repair","emotional_resolution","assessment"]
    },
    definition_collisions: {
      type: "array", maxItems: 5, items: { type: "object", additionalProperties: false, properties: { term:{type:"string"}, participant_a_meaning:{type:"string"}, participant_b_meaning:{type:"string"}, overlap:{type:"string"}, assessment:{type:"string"}, clarifying_question:{type:"string"} }, required:["term","participant_a_meaning","participant_b_meaning","overlap","assessment","clarifying_question"] }
    },
    current_behavior_vs_historical_injury: {
      type:"object", additionalProperties:false, properties:{ applies:{type:"boolean"}, historical_injury:{type:"string"}, current_behavior:{type:"string"}, relationship:{type:"string",enum:["same_behavior_continues","behavior_changed_injury_remains","behavior_stopped_injury_remains","different_current_issue","mixed_or_disputed","unclear","not_applicable"]}, assessment:{type:"string"} }, required:["applies","historical_injury","current_behavior","relationship","assessment"]
    },
    current_disagreement: {
      type: "object", additionalProperties: false,
      properties: {
        type: { type: "string", enum: ["factual","interpretation","memory","value","preference","boundary","agreement","repair","definition","insufficient_evidence","mixed","none_apparent"] },
        explanation: { type: "string" }
      },
      required: ["type","explanation"]
    },
    next_best_questions: { type: "array", items: { type: "string" }, maxItems: 5 },
    caution: { type: "string" }
  },
  required: ["summary","scope_warning","main_issue","overall_confidence","common_ground","disputed_points","participant_positions","claim_evolution","reasoning_patterns","agreement_overview","repair_overview","definition_collisions","current_behavior_vs_historical_injury","current_disagreement","next_best_questions","caution"]
};


// Transcript Conversation Intelligence (v1.8.1)
// The first pass is intentionally permissive: local extraction finds statements worth checking.
// The audit pass then re-reads every candidate with nearby context and is allowed to retain,
// downgrade, fact-check, mark transcript uncertainty, or remove the initial alert.
const TRANSCRIPT_CONTEXT_AUDIT_VERSION = "clearsay-context-audit-2026-09-13-v2";
const TRANSCRIPT_GLOBAL_AUDIT_VERSION = "clearsay-whole-transcript-audit-2026-09-13-v1";
const TRANSCRIPT_INTELLIGENCE_VERSION = "clearsay-conversation-intelligence-2026-09-14-v2";
const TRANSCRIPT_AUDIT_VERSION = TRANSCRIPT_GLOBAL_AUDIT_VERSION;
const TRANSCRIPT_GLOBAL_CHUNK_MAX_ITEMS = 8;
const TRANSCRIPT_GLOBAL_CHUNK_MAX_CHARS = 24000;
const TRANSCRIPT_AUDIT_CHUNK_MAX_ITEMS = 24;
const TRANSCRIPT_AUDIT_CHUNK_MAX_CHARS = 18000;
const TRANSCRIPT_AUDIT_PATTERN_LABELS = [
  "Overgeneralization / Absolute Language",
  "Mind Reading / Motive Attribution",
  "False Dichotomy / All-or-Nothing Framing",
  "Causal Attribution / Oversimplification",
  "Straw Man / Mischaracterization",
  "False Equivalence / Analogy Mismatch",
  "Identity / Trait Labeling",
  "Hyperbole / Exaggeration",
  "Behavior-to-Label Escalation",
  "False Conditional",
  "Catastrophizing",
  "Semantic Deflection / Compression",
  "Minimization / Recency Discount",
  "Dismissive / Character Attack",
  "Confirmation Bias",
  "Unsupported Factual Claim / Statistic",
  "Loaded Question / Embedded Premise",
  "Future Prediction / Unwarranted Certainty",
  "Self-Sealing Reasoning",
  "Association Inference",
  "False Consensus",
  "Excessive Responsibility Reasoning",
  "Appeal to Common Sense",
  "Dismissive Reframing",
  "Tu Quoque / Whataboutism",
  "Personalization / Non Sequitur",
  "False Inference / Guilt by Association",
  "Other Reasoning Issue"
];

const transcriptGlobalAuditChunkSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    results: {
      type: "array",
      maxItems: TRANSCRIPT_GLOBAL_CHUNK_MAX_ITEMS,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          source_index: { type: "integer", minimum: 1 },
          audit_status: { type: "string", enum: ["retained","candidate","fact_check","transcript_uncertain","removed"] },
          patterns: { type: "array", maxItems: 4, items: { type: "string" } },
          pattern_confidence: { type: "integer", minimum: 0, maximum: 100 },
          claim_confidence: { type: "integer", minimum: 0, maximum: 100 },
          transcript_confidence: { type: "integer", minimum: 0, maximum: 100 },
          underlying_concern: { type: "string", enum: ["supported","partially_supported","unverified","contradicted","not_applicable"] },
          supported_core_summary: { type: "string" },
          reasoning_extension_summary: { type: "string" },
          global_reason: { type: "string" },
          global_evidence_refs: { type: "array", maxItems: 12, items: { type: "integer", minimum: 1 } },
          global_evidence_summary: { type: "string" },
          four_layer: {
            type: "object", additionalProperties: false,
            properties: {
              observation: { type: "string" },
              impact: { type: "string" },
              interpretation: { type: "string" },
              intent_identity: { type: "string" }
            },
            required: ["observation","impact","interpretation","intent_identity"]
          },
          claim_evolution_note: { type: "string" },
          context_changed: { type: "boolean" },
          change_explanation: { type: "string" }
        },
        required: ["source_index","audit_status","patterns","pattern_confidence","claim_confidence","transcript_confidence","underlying_concern","supported_core_summary","reasoning_extension_summary","global_reason","global_evidence_refs","global_evidence_summary","four_layer","claim_evolution_note","context_changed","change_explanation"]
      }
    }
  },
  required: ["results"]
};

const conversationIntelligenceSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    what_is_going_wrong: { type: "string" },
    scope_warning: { type: "string" },
    interaction_cycles: {
      type: "array", maxItems: 6,
      items: {
        type: "object", additionalProperties: false,
        properties: {
          name: { type: "string" },
          sequence: { type: "array", maxItems: 7, items: { type: "string" } },
          explanation: { type: "string" },
          evidence_turn_refs: { type: "array", maxItems: 12, items: { type: "integer", minimum: 1 } },
          confidence: { type: "integer", minimum: 0, maximum: 100 }
        },
        required: ["name","sequence","explanation","evidence_turn_refs","confidence"]
      }
    },
    speaker_patterns: {
      type: "array", maxItems: 8,
      items: {
        type: "object", additionalProperties: false,
        properties: {
          speaker: { type: "string" },
          protective_strategy: { type: "string" },
          what_it_tries_to_accomplish: { type: "string" },
          how_it_backfires: { type: "string" },
          evidence_turn_refs: { type: "array", maxItems: 12, items: { type: "integer", minimum: 1 } },
          confidence: { type: "integer", minimum: 0, maximum: 100 }
        },
        required: ["speaker","protective_strategy","what_it_tries_to_accomplish","how_it_backfires","evidence_turn_refs","confidence"]
      }
    },
    supported_complaints: {
      type: "array", maxItems: 14,
      items: {
        type: "object", additionalProperties: false,
        properties: {
          speaker: { type: "string" },
          complaint: { type: "string" },
          support_level: { type: "string", enum: ["high","moderate","mixed","low"] },
          what_is_supported: { type: "string" },
          what_is_not_established: { type: "string" },
          evidence_turn_refs: { type: "array", maxItems: 12, items: { type: "integer", minimum: 1 } }
        },
        required: ["speaker","complaint","support_level","what_is_supported","what_is_not_established","evidence_turn_refs"]
      }
    },
    claim_evolution: {
      type: "array", maxItems: 12,
      items: {
        type: "object", additionalProperties: false,
        properties: {
          speaker: { type: "string" },
          original_claim: { type: "string" },
          later_clarification: { type: "string" },
          final_audited_formulation: { type: "string" },
          evidence_turn_refs: { type: "array", maxItems: 12, items: { type: "integer", minimum: 1 } }
        },
        required: ["speaker","original_claim","later_clarification","final_audited_formulation","evidence_turn_refs"]
      }
    },
    evidence_graph: {
      type: "array", maxItems: 18,
      items: {
        type: "object", additionalProperties: false,
        properties: {
          claim_a: { type: "string" },
          relation: { type: "string", enum: ["supports","contradicts","narrows","clarifies","concedes","revises"] },
          claim_b: { type: "string" },
          explanation: { type: "string" },
          evidence_turn_refs: { type: "array", maxItems: 12, items: { type: "integer", minimum: 1 } }
        },
        required: ["claim_a","relation","claim_b","explanation","evidence_turn_refs"]
      }
    },
    definition_collisions: {
      type:"array", maxItems:8, items:{ type:"object", additionalProperties:false, properties:{ term:{type:"string"}, speaker_meanings:{type:"array",maxItems:4,items:{type:"string"}}, shared_overlap:{type:"string"}, why_it_matters:{type:"string"}, clarifying_question:{type:"string"}, evidence_turn_refs:{type:"array",maxItems:12,items:{type:"integer",minimum:1}} }, required:["term","speaker_meanings","shared_overlap","why_it_matters","clarifying_question","evidence_turn_refs"] }
    },
    current_vs_historical_patterns: {
      type:"array", maxItems:8, items:{ type:"object", additionalProperties:false, properties:{ issue:{type:"string"}, historical_injury:{type:"string"}, current_behavior:{type:"string"}, relationship:{type:"string",enum:["same_behavior_continues","behavior_changed_injury_remains","behavior_stopped_injury_remains","different_current_issue","mixed_or_disputed","unclear"]}, assessment:{type:"string"}, evidence_turn_refs:{type:"array",maxItems:12,items:{type:"integer",minimum:1}} }, required:["issue","historical_injury","current_behavior","relationship","assessment","evidence_turn_refs"] }
    },
    repair_mismatch: {
      type: "object", additionalProperties: false,
      properties: {
        applies: { type: "boolean" },
        description: { type: "string" },
        speaker_models: { type: "array", maxItems: 6, items: { type: "string" } },
        evidence_turn_refs: { type: "array", maxItems: 12, items: { type: "integer", minimum: 1 } }
      },
      required: ["applies","description","speaker_models","evidence_turn_refs"]
    },
    issue_stacking: {
      type: "object", additionalProperties: false,
      properties: {
        applies: { type: "boolean" },
        explanation: { type: "string" },
        examples: { type: "array", maxItems: 8, items: { type: "string" } },
        evidence_turn_refs: { type: "array", maxItems: 12, items: { type: "integer", minimum: 1 } }
      },
      required: ["applies","explanation","examples","evidence_turn_refs"]
    },
    highest_leverage_changes: { type: "array", maxItems: 7, items: { type: "string" } },
    what_needs_to_change: {
      type: "object", additionalProperties: false,
      properties: {
        for_each_speaker: {
          type: "array", maxItems: 8,
          items: {
            type: "object", additionalProperties: false,
            properties: { speaker: { type: "string" }, changes: { type: "array", maxItems: 6, items: { type: "string" } } },
            required: ["speaker","changes"]
          }
        },
        shared_changes: { type: "array", maxItems: 8, items: { type: "string" } },
        suggested_next_conversation: { type: "array", maxItems: 6, items: { type: "string" } }
      },
      required: ["for_each_speaker","shared_changes","suggested_next_conversation"]
    },
    final_note: { type: "string" }
  },
  required: ["what_is_going_wrong","scope_warning","interaction_cycles","speaker_patterns","supported_complaints","claim_evolution","evidence_graph","definition_collisions","current_vs_historical_patterns","repair_mismatch","issue_stacking","highest_leverage_changes","what_needs_to_change","final_note"]
};

const transcriptAuditChunkSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    results: {
      type: "array",
      maxItems: TRANSCRIPT_AUDIT_CHUNK_MAX_ITEMS,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          source_index: { type: "integer", minimum: 1 },
          audit_status: { type: "string", enum: ["retained","candidate","fact_check","transcript_uncertain","removed"] },
          patterns: { type: "array", maxItems: 4, items: { type: "string" } },
          pattern_confidence: { type: "integer", minimum: 0, maximum: 100 },
          claim_confidence: { type: "integer", minimum: 0, maximum: 100 },
          transcript_confidence: { type: "integer", minimum: 0, maximum: 100 },
          confidence_reason: { type: "string" },
          audit_reason: { type: "string" },
          claim_support: { type: "string" },
          transcript_note: { type: "string" }
        },
        required: ["source_index","audit_status","patterns","pattern_confidence","claim_confidence","transcript_confidence","confidence_reason","audit_reason","claim_support","transcript_note"]
      }
    }
  },
  required: ["results"]
};

// Transcript mode uses a local extractor so browsing a long transcript costs zero AI tokens.
// AI is used only after the user chooses a specific statement to analyze.
const TRANSCRIPT_MAX_CHARS = 100000;
const TRANSCRIPT_CONTEXT_CHARS = 260;

function cleanTranscriptText(text = "") {
  return String(text)
    .replace(/^WEBVTT[^\n]*\n?/i, "")
    .replace(/^\s*\d+\s*$/gm, "")
    .replace(/^\s*\d{1,2}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,.]\d{3}.*$/gm, "")
    .replace(/^\s*\d{1,2}:\d{2}[,.]\d{3}\s*-->\s*\d{1,2}:\d{2}[,.]\d{3}.*$/gm, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseTranscriptTurns(text = "") {
  const cleaned = cleanTranscriptText(text);
  const rawLines = cleaned.split(/\n+/).map(x => x.trim()).filter(Boolean);
  const turns = [];
  let current = null;
  const speakerRe = /^([A-Za-z][A-Za-z0-9 ._'-]{0,38}|Speaker\s+[A-Z0-9]+|Therapist|Client|User|Assistant)\s*:\s*(.+)$/i;

  for (const line of rawLines) {
    const m = line.match(speakerRe);
    if (m) {
      if (current?.text) turns.push(current);
      current = { speaker: m[1].trim(), text: m[2].trim() };
    } else if (current) {
      current.text += ` ${line}`;
    } else {
      turns.push({ speaker: "Transcript", text: line });
    }
  }
  if (current?.text) turns.push(current);

  // If a transcript arrived as one large paragraph, split it into manageable pseudo-turns.
  if (turns.length === 1 && turns[0].text.length > 1200) {
    const pieces = turns[0].text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [turns[0].text];
    return pieces.map(x => ({ speaker: "Transcript", text: x.trim() })).filter(x => x.text);
  }
  return turns;
}

function splitTurnIntoStatements(text = "") {
  const compact = String(text).replace(/\s+/g, " ").trim();
  if (!compact) return [];
  if (compact.length <= 520) return [compact];
  const parts = compact.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [compact];
  const out = [];
  let buf = "";
  for (const raw of parts) {
    const part = raw.trim();
    if (!part) continue;
    if ((buf + " " + part).trim().length <= 520) buf = (buf + " " + part).trim();
    else {
      if (buf) out.push(buf);
      buf = part;
    }
  }
  if (buf) out.push(buf);
  return out;
}

function isFillerStatement(text = "") {
  const t = normalize(text).replace(/[.!?]+$/g, "");
  if (t.length < 4) return true;
  return /^(okay|ok|yes|yeah|yep|no|nope|right|sure|fine|thanks|thank you|hello|hi|hey|uh huh|mm hmm|hmm|i know|i understand|got it|exactly|maybe|probably)$/i.test(t);
}

function claimLikelihood(text = "") {
  const t = normalize(text);
  if (!t || isFillerStatement(t)) return -99;
  let score = 0;
  if (t.length >= 18) score += 1;
  if (t.length >= 45) score += 1;
  if (/\b(i|you|we|he|she|they|my|your|our|his|her|their)\b/.test(t)) score += 1;
  if (/\b(is|are|was|were|did|does|do|has|have|had|will|would|should|could|can|cannot|can't|won't|never|always|because|therefore|means|meant|wanted|feel|felt|think|believe|remember|agreed|promised|lied|ignored|controlled|support|repair|resolved)\b/.test(t)) score += 2;
  if (/\b(always|never|every time|constantly|everyone|nobody|everything|nothing|deliberately|on purpose|because you|if you loved|if you cared|what about|but you|that's different|proves|should be over|repaired|resolved)\b/.test(t)) score += 2;
  if (/\?$/.test(text) && /\b(why|how could|when did you stop|what about|do you mean|are you saying)\b/.test(t)) score += 1;
  if (/^[^.!?]{1,20}\?$/.test(text) && score < 3) score -= 2;
  return score;
}

function inferTranscriptRelation(text = "", index = 0) {
  const t = normalize(text);
  if (/\b(repair|repaired|resolved|apologized|made it right|should be over|move on)\b/.test(t)) return "repair_claim";
  if (/^(but|no[, ]|that's not true|that is not true|what about|actually|however|you did|you do it too)/.test(t)) return "rebuttal";
  if (/\?$/.test(text) && /^(what|when|where|which|how|did|do|does|are|is|can|could|would|why)\b/.test(t)) return "clarification";
  return index === 0 ? "original_claim" : "new_claim";
}

function nearbyTurnContext(turns, turnIndex) {
  const before = turns[turnIndex - 1];
  const after = turns[turnIndex + 1];
  const bits = [];
  if (before?.text) bits.push(`${before.speaker}: ${before.text}`);
  if (after?.text) bits.push(`${after.speaker}: ${after.text}`);
  const joined = bits.join(" | ");
  return joined.length > TRANSCRIPT_CONTEXT_CHARS ? joined.slice(0, TRANSCRIPT_CONTEXT_CHARS - 1) + "…" : joined;
}

function extractTranscriptClaimsLocal(transcript = "") {
  const turns = parseTranscriptTurns(transcript);
  const claims = [];
  const seen = new Set();
  for (let ti = 0; ti < turns.length; ti++) {
    const turn = turns[ti];
    const statements = splitTurnIntoStatements(turn.text);
    for (const statement of statements) {
      const likelihood = claimLikelihood(statement);
      if (likelihood < 2) continue;
      const key = `${normalize(turn.speaker)}|${normalize(statement)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const routing = selectCandidates(statement, 3);
      claims.push({
        speaker: turn.speaker || "Speaker",
        exact_claim: statement,
        nearby_context: nearbyTurnContext(turns, ti),
        relation: inferTranscriptRelation(statement, claims.length),
        why_analyzable: "Contains a statement, inference, feeling, rule, prediction, pattern, or other claim that can be clarified and tested.",
        claim_types: routing.claimTypes,
        local_candidates: routing.candidates.slice(0, 3).map(x => x.f.name),
        turn_index: ti + 1,
        local_claim_score: likelihood
      });
    }
  }
  return { turns, claims };
}

function buildTranscriptAuditChunks(claims = []) {
  const chunks = [];
  let current = [];
  let currentChars = 0;
  for (let i = 0; i < claims.length; i++) {
    const c = claims[i];
    const item = {
      source_index: i + 1,
      speaker: c.speaker || "Speaker",
      exact_claim: c.exact_claim || "",
      nearby_context: c.nearby_context || "",
      claim_types: c.claim_types || [],
      local_candidates: c.local_candidates || [],
      relation: c.relation || ""
    };
    const size = JSON.stringify(item).length;
    if (current.length && (current.length >= TRANSCRIPT_AUDIT_CHUNK_MAX_ITEMS || currentChars + size > TRANSCRIPT_AUDIT_CHUNK_MAX_CHARS)) {
      chunks.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(item);
    currentChars += size;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

function transcriptAuditInstructions() {
  return `You are performing ClearSay's mandatory Context Audit (the first audit stage after local candidate discovery).
The local candidate discovery intentionally over-includes possible reasoning issues. Check the exact statement plus nearby exchange only. A later Whole-Transcript Audit will search the entire conversation for additional support, contradictions, and claim evolution. Your job here is to prevent local false positives without pretending you have full-transcript evidence.

AUDIT RULES:
- Re-check every supplied candidate against its exact wording and nearby context. Never assume the first-pass label is correct.
- A feeling is not a fallacy. A question, analogy, sarcasm, factual disagreement, defensive response, or request for evidence is not automatically a reasoning error.
- Asking for evidence about an external factual claim is appropriate. Demanding proof that a person feels an emotion is a category error.
- Absolute words such as always/never/every time can justify frequency verification without proving the speaker is lying or reasoning badly.
- An analogy is not automatically a false equivalence. Flag analogy mismatch only when the comparison is doing invalid inferential work.
- A factual or memory conflict is not automatically a fallacy. Use fact_check when the main issue is verification rather than reasoning.
- Impact does not prove intent. A motive attribution can be a clear reasoning pattern even if the motive later turns out to be true.
- Preserve hedges such as seems, I think, maybe, largely, typically, or as far as I remember. They lower certainty and may change the classification.
- Use transcript_uncertain when ASR wording, speaker attribution, interruption, or missing context makes the classification unreliable.
- Remove an item when context shows no meaningful reasoning problem or when the original alert depended on an overaggressive interpretation.
- Do not diagnose, assign abuse labels, score fault, or decide who is right.

AUDIT STATUS:
retained = a meaningful reasoning pattern is clearly present after context review.
candidate = a pattern may be present, but another reasonable interpretation remains.
fact_check = the main issue is factual/frequency/memory verification rather than a reasoning error.
transcript_uncertain = the transcript quality or attribution is too uncertain for a dependable classification.
removed = the initial alert should not appear in the final alert count.

THREE CONFIDENCE SCORES (0-100):
Pattern Confidence = how sure ClearSay is that the named reasoning pattern is actually present. This is NOT the probability that the speaker is wrong.
Claim Confidence = how strongly the supplied transcript/context supports the underlying factual, causal, motive, frequency, or other conclusion being asserted. This is NOT independent real-world verification.
Transcript Confidence = how reliable the quoted wording, speaker attribution, and local context appear from the supplied transcript text.

Use only these normalized pattern names when a pattern is retained or remains a candidate:\n${TRANSCRIPT_AUDIT_PATTERN_LABELS.join("\n")}
Return an empty patterns array when no reasoning pattern survives the audit.`;
}

async function runTranscriptAuditChunk(items, retryDepth = 0) {
  const input = `AUDIT THESE INITIAL TRANSCRIPT ALERT CANDIDATES.\nReturn exactly one result for every source_index. Do not rewrite the quote; the server will preserve the original wording.\n\nCANDIDATES:\n${JSON.stringify(items)}`;
  try {
    const response = await openai.responses.create({
      model: MODEL,
      reasoning: { effort: "low" },
      instructions: transcriptAuditInstructions(),
      input,
      store: false,
      max_output_tokens: 6500,
      prompt_cache_key: "clearsay-context-audit-v2",
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "clearsay_context_audit_chunk",
          strict: true,
          schema: transcriptAuditChunkSchema
        }
      }
    });
    if (!response.output_text) throw new Error("The model returned no structured transcript-audit output.");
    const parsed = JSON.parse(response.output_text);
    const byIndex = new Map();
    for (const r of parsed.results || []) {
      if (items.some(x => x.source_index === r.source_index) && !byIndex.has(r.source_index)) byIndex.set(r.source_index, r);
    }
    const missing = items.filter(x => !byIndex.has(x.source_index));
    let extra = [];
    if (missing.length) {
      if (retryDepth >= 2) throw new Error(`Transcript audit omitted ${missing.length} candidate(s) after retry.`);
      const retried = await runTranscriptAuditChunk(missing, retryDepth + 1);
      extra = retried.results;
      return {
        results: [...byIndex.values(), ...extra].sort((a,b)=>a.source_index-b.source_index),
        meta: [{ model: response.model || MODEL, response_id: response.id, usage: response.usage || null, estimated_cost_usd: estimateCost(response.usage) }, ...retried.meta]
      };
    }
    return {
      results: [...byIndex.values()].sort((a,b)=>a.source_index-b.source_index),
      meta: [{ model: response.model || MODEL, response_id: response.id, usage: response.usage || null, estimated_cost_usd: estimateCost(response.usage) }]
    };
  } catch (err) {
    const message = String(err?.message || "");
    const splitNeeded = items.length > 4 && ((err?.status === 429 && /tokens per min|tpm|request too large/i.test(message)) || /too large|max_output|context|omitted/i.test(message));
    if (!splitNeeded) throw err;
    const mid = Math.ceil(items.length / 2);
    const left = await runTranscriptAuditChunk(items.slice(0, mid), retryDepth + 1);
    const right = await runTranscriptAuditChunk(items.slice(mid), retryDepth + 1);
    return { results: [...left.results, ...right.results].sort((a,b)=>a.source_index-b.source_index), meta: [...left.meta, ...right.meta] };
  }
}


const TRANSCRIPT_GLOBAL_STOPWORDS = new Set("the a an and or but if then than to of in on at for from with without into over under is are was were be been being do does did have has had i me my mine you your yours we our ours he him his she her hers they them their this that these those it its as so just very really can could would should will may might not no yes because therefore there here what when where why how who whom which about around after before again also only even still now then more most much many some any all every never always own same other another one two three said says say feel felt feeling think thought believe believed want wanted need needed like".split(/\s+/));

function transcriptKeywords(text = "") {
  const words = normalize(text).replace(/[^a-z0-9' ]/g, " ").split(/\s+/).filter(Boolean);
  const out = new Set();
  for (const w of words) {
    if (w.length < 4 || TRANSCRIPT_GLOBAL_STOPWORDS.has(w)) continue;
    out.add(w);
    if (w.endsWith("ing") && w.length > 6) out.add(w.slice(0,-3));
    if (w.endsWith("ed") && w.length > 5) out.add(w.slice(0,-2));
    if (w.endsWith("s") && w.length > 5) out.add(w.slice(0,-1));
  }
  return out;
}

function globalEvidenceForClaim(claim, turns = [], maxTurns = 12) {
  const key = transcriptKeywords([claim.exact_claim, claim.nearby_context, ...(claim.local_candidates||[])].join(" "));
  const original = Math.max(0, Number(claim.turn_index || 1) - 1);
  const mandatory = new Set();
  for (let i=Math.max(0,original-2); i<=Math.min(turns.length-1,original+2); i++) mandatory.add(i);
  const scored = turns.map((turn,i)=>{
    const tk = transcriptKeywords(turn.text || "");
    let overlap = 0;
    for (const w of key) if (tk.has(w)) overlap++;
    let score = overlap * 4;
    const distance = Math.abs(i-original);
    if (distance <= 2) score += 8 - distance;
    if (normalize(turn.speaker) === normalize(claim.speaker)) score += .5;
    const claimText = normalize(claim.exact_claim);
    const turnText = normalize(turn.text);
    for (const anchor of ["family","father","mother","kids","children","vegas","space","control","clothing","dress","gps","help","repair","apolog","baby","move","moving","school","therapy","friend","maddie","parent"]) {
      if (claimText.includes(anchor) && turnText.includes(anchor)) score += 3;
    }
    return { i, score, overlap };
  }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score || a.i-b.i);
  const selected = [...mandatory];
  for (const row of scored) {
    if (selected.length >= maxTurns) break;
    if (!selected.includes(row.i)) selected.push(row.i);
  }
  return selected.sort((a,b)=>a-b).map(i=>({ turn_ref:i+1, speaker:turns[i]?.speaker||"Speaker", text:String(turns[i]?.text||"").slice(0,900) }));
}

function buildGlobalAuditChunks(claims = [], contextItems = [], turns = []) {
  const bySource = new Map(contextItems.map(x=>[x.source_index,x]));
  const chunks=[]; let current=[]; let chars=0;
  for (let i=0;i<claims.length;i++) {
    const c=claims[i]; const local=bySource.get(i+1);
    if (!local) continue;
    const evidence=globalEvidenceForClaim(c,turns,12);
    const item={
      source_index:i+1,
      speaker:c.speaker||"Speaker",
      exact_claim:c.exact_claim||"",
      nearby_context:c.nearby_context||"",
      turn_index:c.turn_index||i+1,
      claim_types:c.claim_types||[],
      context_audit:{ audit_status:local.audit_status, patterns:local.patterns||[], pattern_confidence:local.pattern_confidence, claim_confidence:local.claim_confidence, transcript_confidence:local.transcript_confidence, audit_reason:local.audit_reason||"", claim_support:local.claim_support||"" },
      whole_transcript_evidence:evidence
    };
    const size=JSON.stringify(item).length;
    if(current.length && (current.length>=TRANSCRIPT_GLOBAL_CHUNK_MAX_ITEMS || chars+size>TRANSCRIPT_GLOBAL_CHUNK_MAX_CHARS)){chunks.push(current);current=[];chars=0;}
    current.push(item);chars+=size;
  }
  if(current.length)chunks.push(current);
  return chunks;
}

function globalAuditInstructions(){
  return `You are performing ClearSay's Whole-Transcript Audit. This happens AFTER a Context Audit.

Your job is to reconsider every supplied item using relevant evidence retrieved from anywhere in the full transcript, not just nearby turns.

WHOLE-TRANSCRIPT RULES:
- The Context Audit is provisional. Change it whenever earlier/later evidence materially strengthens, weakens, narrows, contradicts, clarifies, or removes the initial finding.
- Separate the UNDERLYING COMPLAINT from the REASONING EXTENSION. A complaint can be supported while an absolute, motive, causal, frequency, or identity extension remains weak.
- A supported complaint is not itself a fallacy. If the only remaining content is a supported observation/impact and no meaningful reasoning problem survives, remove the reasoning alert while preserving underlying_concern=supported or partially_supported.
- Feelings/impact are valid as reported experiences; they do not automatically establish cause, motive, intent, frequency, or identity.
- Requests for evidence, factual correction, relevant analogies, and consistency tests are not reasoning errors merely because they are uncomfortable.
- Later concessions and clarifications matter. Track claim evolution rather than freezing the earliest wording.
- Repeated examples across the transcript can legitimately raise Claim Confidence for a pattern claim. They do not automatically prove always/never/every single time.
- Non-intervention or accommodation can support a narrower behavioral conclusion without proving agreement, allegiance, or malicious intent.
- Search the supplied whole-transcript evidence for counterexamples as well as support.
- Do not diagnose, label abuse, assign fault percentages, or decide who is the better partner.

FINAL AUDIT STATUS uses retained/candidate/fact_check/transcript_uncertain/removed exactly as in the Context Audit.
UNDERLYING CONCERN:
supported = transcript gives strong direct or repeated support for the narrower behavioral/factual complaint.
partially_supported = meaningful support exists but scope/cause/frequency remains uncertain.
unverified = transcript does not establish the core complaint.
contradicted = transcript materially contradicts the core complaint.
not_applicable = item is mainly a question, analogy, feeling, or other statement without a separable complaint.

FOUR-LAYER BREAKDOWN:
Observation = least interpretive event/behavior the transcript can support.
Impact = reported emotional/relational effect.
Interpretation = meaning drawn from the event/impact.
Intent/Identity = motive or character conclusion, if any.
Use "Not stated" where a layer is absent.

THREE CONFIDENCE SCORES remain distinct:
Pattern Confidence = is the final reasoning pattern actually present?
Claim Confidence = how strongly this transcript supports the underlying conclusion?
Transcript Confidence = how reliable are wording, speaker attribution, and context?

Use only these normalized pattern names when retaining a pattern:\n${TRANSCRIPT_AUDIT_PATTERN_LABELS.join("\n")}
Set context_changed=true whenever the Whole-Transcript Audit materially changes status, pattern list, or confidence/support interpretation from the Context Audit.`;
}

async function runGlobalAuditChunk(items, retryDepth=0){
  const input=`WHOLE-TRANSCRIPT AUDIT ITEMS. The whole_transcript_evidence field contains relevant turns retrieved from across the entire transcript. Return exactly one result per source_index.\n\n${JSON.stringify(items)}`;
  try{
    const response=await openai.responses.create({
      model:MODEL,reasoning:{effort:"low"},instructions:globalAuditInstructions(),input,store:false,max_output_tokens:8000,prompt_cache_key:"clearsay-whole-transcript-audit-v1",
      text:{verbosity:"low",format:{type:"json_schema",name:"clearsay_whole_transcript_audit_chunk",strict:true,schema:transcriptGlobalAuditChunkSchema}}
    });
    if(!response.output_text)throw new Error("The model returned no structured Whole-Transcript Audit output.");
    const parsed=JSON.parse(response.output_text); const byIndex=new Map();
    for(const r of parsed.results||[])if(items.some(x=>x.source_index===r.source_index)&&!byIndex.has(r.source_index))byIndex.set(r.source_index,r);
    const missing=items.filter(x=>!byIndex.has(x.source_index));
    if(missing.length){if(retryDepth>=2)throw new Error(`Whole-Transcript Audit omitted ${missing.length} item(s) after retry.`);const retried=await runGlobalAuditChunk(missing,retryDepth+1);return{results:[...byIndex.values(),...retried.results].sort((a,b)=>a.source_index-b.source_index),meta:[{model:response.model||MODEL,response_id:response.id,usage:response.usage||null,estimated_cost_usd:estimateCost(response.usage)},...retried.meta]};}
    return{results:[...byIndex.values()].sort((a,b)=>a.source_index-b.source_index),meta:[{model:response.model||MODEL,response_id:response.id,usage:response.usage||null,estimated_cost_usd:estimateCost(response.usage)}]};
  }catch(err){
    const message=String(err?.message||"");
    const splitNeeded=items.length>2&&((err?.status===429&&/tokens per min|tpm|request too large/i.test(message))||/too large|max_output|context|omitted/i.test(message));
    if(!splitNeeded)throw err;
    const mid=Math.ceil(items.length/2);const left=await runGlobalAuditChunk(items.slice(0,mid),retryDepth+1);const right=await runGlobalAuditChunk(items.slice(mid),retryDepth+1);return{results:[...left.results,...right.results].sort((a,b)=>a.source_index-b.source_index),meta:[...left.meta,...right.meta]};
  }
}

function compactFinalAudit(items=[]){
  return items.map(x=>({source_index:x.source_index,speaker:x.speaker,exact_quote:x.exact_quote,audit_status:x.audit_status,patterns:x.patterns,pattern_confidence:x.pattern_confidence,claim_confidence:x.claim_confidence,underlying_concern:x.underlying_concern,supported_core_summary:x.supported_core_summary,reasoning_extension_summary:x.reasoning_extension_summary,global_evidence_refs:x.global_evidence_refs,four_layer:x.four_layer,claim_evolution_note:x.claim_evolution_note}));
}

function conversationIntelligenceInstructions(){
  return `You are ClearSay's Conversation Pattern Analysis layer. You are analyzing a transcript AFTER Context Audit and Whole-Transcript Audit.

Goal: explain what interaction patterns are keeping the conversation stuck without diagnosing either person, assigning fault, or converting alert counts into moral scores.

Rules:
- Ground every pattern in supplied transcript turns and final audited findings.
- Identify reciprocal interaction cycles when the transcript supports them. Describe sequence, not pathology.
- Separate legitimate underlying complaints from reasoning extensions.
- Identify each speaker's apparent conversational/protective strategy only as a transcript pattern (for example pursuing clarification, distancing, broadening from incidents to patterns, safety escalation). Do not infer clinical attachment style or diagnosis.
- Track claim evolution: original wording -> later clarification/concession -> best final formulation.
- Build an evidence graph only for materially important claims and use supports/contradicts/narrows/clarifies/concedes/revises.
- Distinguish behavioral repair from emotional/trust resolution.
- Detect definition collisions when speakers use the same consequential term with different operational meanings. Preserve each meaning; do not decide one definition is inherently correct.
- Separate current behavior from historical injury. State whether the same behavior appears to continue, behavior changed while injury remains, behavior stopped while injury remains, the current behavior is a different issue, or the evidence is mixed/unclear.
- Detect issue stacking when one dispute repeatedly absorbs multiple older/newer disputes.
- Highest-leverage changes must be concrete conversation-process changes, not commands to reconcile, separate, or accept one person's narrative.
- Fill what_needs_to_change with plain-language behavior/process changes for each speaker, shared changes for the conversation, and a small set of suggested next-conversation topics/questions. Phrase these as actionable options, not blame or diagnosis.
- Counts are not fault scores. Do not say one speaker is more at fault based on number of alerts.
- A valid feeling does not prove a motive; a factual correction does not erase emotional impact.
- If evidence is mixed, say so plainly.

Use turn references as 1-indexed transcript turn numbers.`;
}

function numberedTranscript(turns=[]){return turns.map((t,i)=>`[Turn ${i+1}] ${t.speaker}: ${t.text}`).join("\n");}

async function runConversationIntelligence(transcript,turns,finalItems,compactRetry=false){
  const audit=JSON.stringify(compactFinalAudit(finalItems));
  const transcriptText=compactRetry ? finalItems.flatMap(x=>(x.global_evidence||[])).filter((x,i,a)=>a.findIndex(y=>y.turn_ref===x.turn_ref)===i).sort((a,b)=>a.turn_ref-b.turn_ref).map(x=>`[Turn ${x.turn_ref}] ${x.speaker}: ${x.text}`).join("\n") : numberedTranscript(turns);
  const input=`FINAL AUDITED FINDINGS:\n${audit}\n\nTRANSCRIPT${compactRetry?' EVIDENCE DIGEST':''}:\n${transcriptText}`;
  try{
    const response=await openai.responses.create({model:MODEL,reasoning:{effort:"low"},instructions:conversationIntelligenceInstructions(),input,store:false,max_output_tokens:9000,prompt_cache_key:"clearsay-conversation-intelligence-v2",text:{verbosity:"low",format:{type:"json_schema",name:"clearsay_conversation_intelligence",strict:true,schema:conversationIntelligenceSchema}}});
    if(!response.output_text)throw new Error("The model returned no structured conversation intelligence output.");
    return{analysis:JSON.parse(response.output_text),meta:{model:response.model||MODEL,response_id:response.id,usage:response.usage||null,estimated_cost_usd:estimateCost(response.usage),compact_retry:compactRetry}};
  }catch(err){
    const message=String(err?.message||"");
    if(!compactRetry&&((err?.status===429&&/tokens per min|tpm|request too large/i.test(message))||/too large|context/i.test(message)))return runConversationIntelligence(transcript,turns,finalItems,true);
    throw err;
  }
}

function confidenceBand(score = 0) {
  const n = Number(score) || 0;
  if (n >= 90) return "very_high";
  if (n >= 75) return "high";
  if (n >= 60) return "moderate";
  if (n >= 40) return "uncertain_mixed";
  if (n >= 20) return "low";
  return "very_low";
}

function summarizeTranscriptAudit(items = [], rawCount = 0) {
  const speakerMap = new Map();
  const make = (speaker) => ({ speaker, initial_candidates: 0, retained_alerts: 0, stronger_patterns: 0, candidate_context: 0, removed: 0, status_counts: { retained:0, candidate:0, fact_check:0, transcript_uncertain:0, removed:0 }, confidence_bands: { very_high:0, high:0, moderate:0, uncertain_mixed:0, low:0, very_low:0 }, _p:0, _c:0, _t:0 });
  for (const item of items) {
    const speaker = item.speaker || "Speaker";
    if (!speakerMap.has(speaker)) speakerMap.set(speaker, make(speaker));
    const s = speakerMap.get(speaker);
    s.initial_candidates++;
    s.status_counts[item.audit_status] = (s.status_counts[item.audit_status] || 0) + 1;
    if (item.audit_status === "removed") { s.removed++; continue; }
    s.retained_alerts++;
    const strong = item.audit_status === "retained" && Number(item.pattern_confidence) >= 75;
    if (strong) s.stronger_patterns++; else s.candidate_context++;
    s.confidence_bands[confidenceBand(item.pattern_confidence)]++;
    s._p += Number(item.pattern_confidence) || 0;
    s._c += Number(item.claim_confidence) || 0;
    s._t += Number(item.transcript_confidence) || 0;
  }
  const speakers = [...speakerMap.values()].map(s => {
    const n = s.retained_alerts || 1;
    const out = { ...s, average_pattern_confidence: Math.round(s._p/n), average_claim_confidence: Math.round(s._c/n), average_transcript_confidence: Math.round(s._t/n) };
    delete out._p; delete out._c; delete out._t;
    return out;
  }).sort((a,b)=>b.retained_alerts-a.retained_alerts || a.speaker.localeCompare(b.speaker));
  const removed = items.filter(x=>x.audit_status === "removed").length;
  const retained = items.length - removed;
  const stronger = items.filter(x=>x.audit_status === "retained" && Number(x.pattern_confidence) >= 75).length;
  return {
    initial_candidates: rawCount,
    audited_items: items.length,
    retained_alerts: retained,
    stronger_patterns: stronger,
    candidate_context: retained - stronger,
    removed,
    speakers
  };
}


function validateBody(body) {
  const claim = typeof body?.claim === "string" ? body.claim.trim() : "";
  if (!claim) return { error: "Enter a claim or statement first." };
  if (claim.length > 1800) return { error: "Please keep the claim under 1,800 characters." };
  const answers = Array.isArray(body.answers) ? body.answers.slice(0, 40).map(a => ({
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


// -----------------------------------------------------------------------------
// Couples Live
// Two participants text normally. Messages are stored exactly as sent, then
// analyzed after sending. Saved rooms are mirrored to durable disk storage;
// temporary/no-save rooms remain memory-only and expire after inactivity.
// -----------------------------------------------------------------------------
const COUPLES_SESSION_TTL_MS = 6 * 60 * 60 * 1000; // temporary/no-save rooms only
const COUPLES_MAX_MESSAGES = 250;
const COUPLES_ALLOWED_MINUTES = new Set([15, 30, 45, 60]);
const COUPLES_DEFAULT_MINUTES = 30;
const COUPLES_TURN_MS = 60 * 1000;
const couplesSessions = new Map();
let couplesPersistTimer = null;

function durableCouplesSession(s) {
  return String(s?.storageMode || "saved") === "saved";
}

function persistCouplesSessionsNow() {
  try {
    fs.mkdirSync(CLEARSAY_DATA_DIR, { recursive: true });
    const payload = {
      version: COUPLES_STORE_VERSION,
      written_at: new Date().toISOString(),
      sessions: [...couplesSessions.values()].filter(durableCouplesSession)
    };
    const tmp = `${COUPLES_STORE_PATH}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(payload), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tmp, COUPLES_STORE_PATH);
  } catch (err) {
    console.error("ClearSay durable session persistence error:", err);
  }
}

function queuePersistCouplesSessions() {
  if (couplesPersistTimer) clearTimeout(couplesPersistTimer);
  couplesPersistTimer = setTimeout(() => {
    couplesPersistTimer = null;
    persistCouplesSessionsNow();
  }, 120);
  couplesPersistTimer.unref?.();
}

function loadPersistedCouplesSessions() {
  try {
    if (!fs.existsSync(COUPLES_STORE_PATH)) return;
    const parsed = JSON.parse(fs.readFileSync(COUPLES_STORE_PATH, "utf8"));
    for (const session of (Array.isArray(parsed?.sessions) ? parsed.sessions : [])) {
      if (!session?.code) continue;
      session.storageMode = "saved";
      session.expiresAt = null;
      couplesSessions.set(String(session.code).toUpperCase(), session);
    }
    console.log(`ClearSay restored ${couplesSessions.size} saved Couples Live session(s).`);
  } catch (err) {
    console.error("ClearSay could not restore saved Couples Live sessions:", err);
  }
}

loadPersistedCouplesSessions();
process.on("SIGTERM", () => { persistCouplesSessionsNow(); process.exit(0); });
process.on("SIGINT", () => { persistCouplesSessionsNow(); process.exit(0); });

const couplesMessageSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    claim_types: {
      type: "array", maxItems: 6,
      items: { type: "string", enum: ["event_fact","feeling","behavior_label","interpretation_meaning","intent_motive","cause","pattern_frequency","prediction","value_rule","identity_character","request_boundary","repair_status"] }
    },
    claim_status: { type: "string", enum: ["established","supported","partially_established","disputed","inferred","unsupported","contradicted","unknown","not_applicable"] },
    reasoning_outcome: {
      type: "object", additionalProperties: false,
      properties: {
        verdict: { type: "string", enum: ["sound_or_reasonable","possible_reasoning_issue","fallacy_likely","insufficient_information","not_a_truth_claim"] },
        confidence: { type: "string", enum: ["low","moderate","high"] },
        explanation: { type: "string" }
      },
      required: ["verdict","confidence","explanation"]
    },
    evidence_assessment: {
      type: "object", additionalProperties: false,
      properties: {
        quality: { type: "string", enum: ["strong","moderate","limited","unknown","not_applicable"] },
        assessment: { type: "string" }
      },
      required: ["quality","assessment"]
    },
    likely_fallacies: {
      type: "array", maxItems: 3,
      items: {
        type: "object", additionalProperties: false,
        properties: {
          fallacy_id: { type: "integer", minimum: 1, maximum: 100 },
          match_score: { type: "integer", minimum: 0, maximum: 100 },
          why_it_fits: { type: "string" }
        },
        required: ["fallacy_id","match_score","why_it_fits"]
      }
    },
    conversation_effect: {
      type: "object", additionalProperties: false,
      properties: {
        relation: { type: "string", enum: ["new_claim","supports","weakens","contradicts","clarifies","narrows","concedes","changes_standard","no_material_change","unclear"] },
        affected_claim: { type: "string" },
        strength_change: { type: "string", enum: ["stronger","weaker","more_precise","no_change","unclear"] },
        explanation: { type: "string" }
      },
      required: ["relation","affected_claim","strength_change","explanation"]
    },
    topic_relevance: {
      type: "object", additionalProperties: false,
      properties: {
        classification: { type: "string", enum: ["directly_relevant","clarifying","supporting_context","possible_topic_shift","unrelated_issue","unclear"] },
        explanation: { type: "string" },
        parked_issue: { type: "string" }
      },
      required: ["classification","explanation","parked_issue"]
    },
    common_ground_added: { type: "array", items: { type: "string" }, maxItems: 4 },
    disputed_or_unresolved: { type: "array", items: { type: "string" }, maxItems: 5 },
    underlying_issue: { type: "string" },
    agreement_signal: {
      type: "object", additionalProperties: false,
      properties: {
        applies: { type: "boolean" },
        status: { type: "string", enum: ["mutually_agreed","existence_disputed","terms_disputed","fulfilled","partially_fulfilled","not_fulfilled","mutually_changed","unilaterally_changed","change_disputed","unclear","not_applicable"] },
        assessment: { type: "string" }
      },
      required: ["applies","status","assessment"]
    },
    repair_signal: {
      type: "object", additionalProperties: false,
      properties: {
        applies: { type: "boolean" },
        behavioral_repair: { type: "string" },
        emotional_resolution: { type: "string" },
        assessment: { type: "string" }
      },
      required: ["applies","behavioral_repair","emotional_resolution","assessment"]
    },
    definition_collision: {
      type:"object", additionalProperties:false, properties:{ applies:{type:"boolean"}, term:{type:"string"}, participant_a_meaning:{type:"string"}, participant_b_meaning:{type:"string"}, status:{type:"string",enum:["different_definitions","possible_difference","same_definition","unclear","not_applicable"]}, assessment:{type:"string"}, clarifying_question:{type:"string"} }, required:["applies","term","participant_a_meaning","participant_b_meaning","status","assessment","clarifying_question"]
    },
    current_vs_historical: {
      type:"object", additionalProperties:false, properties:{ applies:{type:"boolean"}, historical_injury:{type:"string"}, current_behavior:{type:"string"}, relationship:{type:"string",enum:["same_behavior_continues","behavior_changed_injury_remains","behavior_stopped_injury_remains","different_current_issue","mixed_or_disputed","unclear","not_applicable"]}, assessment:{type:"string"} }, required:["applies","historical_injury","current_behavior","relationship","assessment"]
    },
    claim_updates: {
      type: "array", maxItems: 4,
      items: {
        type: "object", additionalProperties: false,
        properties: {
          claim_text: { type: "string" },
          lifecycle: { type: "string", enum: ["new","supported","weakened","narrowed","clarified","conceded","corrected","withdrawn","unchanged","unclear"] },
          status: { type: "string", enum: ["established","supported","partially_established","disputed","inferred","unsupported","contradicted","unknown","not_applicable"] },
          explanation: { type: "string" }
        },
        required: ["claim_text","lifecycle","status","explanation"]
      }
    },
    useful_next_questions: { type: "array", items: { type: "string" }, maxItems: 3 },
    caution: { type: "string" }
  },
  required: ["summary","claim_types","claim_status","reasoning_outcome","evidence_assessment","likely_fallacies","conversation_effect","topic_relevance","common_ground_added","disputed_or_unresolved","underlying_issue","agreement_signal","repair_signal","definition_collision","current_vs_historical","claim_updates","useful_next_questions","caution"]
};

function cleanParticipantName(value, fallback) {
  const name = String(value || "").replace(/\s+/g, " ").trim().slice(0, 32);
  return name || fallback;
}

function newCouplesCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 20; attempt++) {
    const bytes = randomBytes(6);
    let code = "";
    for (let i = 0; i < 6; i++) code += alphabet[bytes[i] % alphabet.length];
    if (!couplesSessions.has(code)) return code;
  }
  return randomBytes(4).toString("hex").toUpperCase().slice(0, 8);
}

function newCouplesToken() {
  return randomBytes(24).toString("hex");
}

function touchCouplesSession(s) {
  s.updatedAt = new Date().toISOString();
  if (durableCouplesSession(s)) s.expiresAt = null;
  else s.expiresAt = Date.now() + COUPLES_SESSION_TTL_MS;
  s.revision = (s.revision || 0) + 1;
  if (durableCouplesSession(s)) queuePersistCouplesSessions();
}

function getCouplesSession(code) {
  const key = String(code || "").trim().toUpperCase();
  const s = couplesSessions.get(key);
  if (!s) return null;
  if (!durableCouplesSession(s) && Number.isFinite(Number(s.expiresAt)) && Date.now() > Number(s.expiresAt)) {
    couplesSessions.delete(key);
    return null;
  }
  return s;
}

function couplesParticipantFromRequest(s, req) {
  const token = String(req.get("x-session-token") || "").trim();
  if (!token) return null;
  for (const id of ["A", "B"]) {
    if (s.participants[id]?.token === token) return { id, role: "participant", ...s.participants[id] };
  }
  if (s.mediator?.participant?.token === token) return { id: "M", role: "mediator", ...s.mediator.participant };
  return null;
}

const COUPLES_CLOSE_STATUSES = new Set(["resolved","partially_resolved","unresolved_more_evidence","unresolved_value_preference","deferred_mutual"]);

function normalizeTopicText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 280);
}

function normalizeShortText(value, max = 500) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function normalizeCouplesDurationMinutes(value) {
  const n = Number(value);
  return COUPLES_ALLOWED_MINUTES.has(n) ? n : COUPLES_DEFAULT_MINUTES;
}

function isCoupleParticipant(p) {
  return Boolean(p && (p.id === "A" || p.id === "B"));
}

function publicSharedCouplesAnalysis(a) {
  if (!a) return null;
  return {
    summary: a.summary || "",
    conversation_effect: a.conversation_effect || null,
    topic_relevance: a.topic_relevance || null,
    common_ground_added: a.common_ground_added || [],
    disputed_or_unresolved: a.disputed_or_unresolved || [],
    underlying_issue: a.underlying_issue || "",
    agreement_signal: a.agreement_signal || null,
    repair_signal: a.repair_signal || null,
    definition_collision: a.definition_collision || null,
    current_vs_historical: a.current_vs_historical || null,
    claim_updates: a.claim_updates || [],
    caution: a.caution || ""
  };
}

function claimKey(text = "") {
  return String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 180);
}

function updateClaimLedgerFromMessage(s, message) {
  const updates = Array.isArray(message.analysis?.claim_updates) ? message.analysis.claim_updates : [];
  s.claimLedger ||= [];
  for (const u of updates) {
    const text = normalizeShortText(u.claim_text, 420);
    if (!text) continue;
    const key = claimKey(text);
    let item = s.claimLedger.find(x => x.key === key);
    if (!item && message.analysis?.conversation_effect?.affected_claim) {
      const affectedKey = claimKey(message.analysis.conversation_effect.affected_claim);
      item = s.claimLedger.find(x => x.key === affectedKey || x.key.includes(affectedKey) || affectedKey.includes(x.key));
    }
    if (!item) {
      item = { id: `c-${Date.now()}-${randomBytes(3).toString("hex")}`, key, text, status: u.status || "unknown", lifecycle: u.lifecycle || "new", raisedBy: message.senderId, createdAt: message.createdAt, updatedAt: message.createdAt, history: [] };
      s.claimLedger.push(item);
    }
    item.text = text || item.text;
    item.status = u.status || item.status || "unknown";
    item.lifecycle = u.lifecycle || item.lifecycle || "unclear";
    item.updatedAt = message.createdAt;
    item.history.push({ messageId: message.id, senderId: message.senderId, lifecycle: u.lifecycle || "unclear", status: u.status || "unknown", explanation: normalizeShortText(u.explanation, 500), at: message.createdAt });
    if (item.history.length > 30) item.history = item.history.slice(-30);
  }
}

function nextCouplesSpeaker(id) {
  return id === "A" ? "B" : "A";
}

function initializeCouplesFloor(s, reason = "topic_open") {
  const now = new Date().toISOString();
  const activeSpeaker = s.nextFirstSpeaker === "B" ? "B" : "A";
  s.nextFirstSpeaker = nextCouplesSpeaker(activeSpeaker);
  s.turnCounter = Number(s.turnCounter || 0) + 1;
  s.turn = {
    activeSpeaker,
    turnNumber: s.turnCounter,
    startedAt: null,
    endsAt: null,
    status: "waiting_to_start",
    lastReason: reason,
    lastChangedAt: now
  };
  return s.turn;
}

function advanceCouplesFloor(s, reason = "passed") {
  const now = new Date().toISOString();
  const current = s.turn?.activeSpeaker === "B" ? "B" : "A";
  s.turnCounter = Number(s.turnCounter || s.turn?.turnNumber || 0) + 1;
  s.turn = {
    activeSpeaker: nextCouplesSpeaker(current),
    turnNumber: s.turnCounter,
    startedAt: null,
    endsAt: null,
    status: "waiting_to_start",
    lastReason: reason,
    lastChangedAt: now
  };
  return s.turn;
}

function startCouplesTurn(s, participantId) {
  if (!s.turn) initializeCouplesFloor(s, "topic_open");
  if (s.turn.activeSpeaker !== participantId) return false;
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  s.turn.startedAt = now;
  s.turn.endsAt = new Date(nowMs + COUPLES_TURN_MS).toISOString();
  s.turn.status = "active";
  s.turn.lastReason = "started";
  s.turn.lastChangedAt = now;
  if (!s.timerStartedAt) {
    s.timerStartedAt = now;
    s.timerEndsAt = new Date(nowMs + Number(s.maxActiveMs || normalizeCouplesDurationMinutes(s.durationMinutes) * 60 * 1000)).toISOString();
  }
  if (s.topic && !s.topic.startedAt) s.topic.startedAt = now;
  return true;
}

function couplesTurnRemainingMs(s) {
  if (!s.turn?.endsAt || s.turn.status !== "active") return COUPLES_TURN_MS;
  return Math.max(0, new Date(s.turn.endsAt).getTime() - Date.now());
}

function maybeExpireCouplesTurn(s) {
  if (!s.turn?.endsAt || s.turn.status !== "active" || s.sessionEndedAt || s.topic?.status !== "open") return false;
  if (Date.now() < new Date(s.turn.endsAt).getTime()) return false;
  advanceCouplesFloor(s, "turn_expired");
  return true;
}

function couplesTopicEngagement(s) {
  const topicId = s.topic?.id || "";
  const relevantClasses = new Set(["directly_relevant","clarifying","supporting_context"]);
  const offClasses = new Set(["possible_topic_shift","unrelated_issue"]);
  const participants = {};
  const notices = [];
  for (const id of ["A","B"]) {
    const msgs = (s.messages || []).filter(m => m.senderId === id && (!topicId || m.topicId === topicId) && m.analysisStatus === "ready" && m.analysis?.topic_relevance?.classification);
    let relevant = 0, off = 0, unclear = 0;
    for (const m of msgs) {
      const c = m.analysis.topic_relevance.classification;
      if (relevantClasses.has(c)) relevant++;
      else if (offClasses.has(c)) off++;
      else unclear++;
    }
    let consecutiveOff = 0;
    for (const m of [...msgs].reverse()) {
      const c = m.analysis.topic_relevance.classification;
      if (offClasses.has(c)) consecutiveOff++;
      else break;
    }
    const needsFocus = consecutiveOff >= 3 || (msgs.length >= 3 && relevant === 0 && off >= 3);
    participants[id] = {
      analyzed_messages: msgs.length,
      relevant_count: relevant,
      off_topic_count: off,
      unclear_count: unclear,
      consecutive_off_topic: consecutiveOff,
      status: needsFocus ? "needs_focus" : (msgs.length ? "engaged_or_unclear" : "not_enough_data")
    };
    if (needsFocus) {
      notices.push({
        participant_id: id,
        participant_name: s.participants?.[id]?.name || `Person ${id}`,
        message: "Several recent analyzed responses did not directly address the active topic. This describes topic relevance only; it does not establish motive or intent.",
        response_paths: ["Answer the current question", "Disagree with the premise", "Say you do not know", "Explain what information is missing"]
      });
    }
  }
  return {
    current_topic: s.topic?.text || "",
    participants,
    notices,
    unresolved_due_to_nonresponse_possible: notices.length > 0
  };
}

function buildCouplesOutcome(s) {
  const insight = s.insights?.analysis || null;
  const topic = s.topic || null;
  const engagement = couplesTopicEngagement(s);
  const unresolvedLedger = (s.claimLedger || []).filter(x => !["established"].includes(x.status) && !["conceded","withdrawn"].includes(x.lifecycle)).slice(0, 8);
  return {
    topic: topic?.text || "",
    topic_status: topic?.status || "unknown",
    resolution_criteria: topic?.resolutionCriteria || "",
    common_ground: [...(insight?.common_ground || []), ...(topic?.closureAgreement?.status==="agreed" && topic.closureAgreement.resolvedSummary ? [topic.closureAgreement.resolvedSummary] : [])].filter((x,i,a)=>x&&a.indexOf(x)===i),
    still_disputed: [...(insight?.disputed_points || unresolvedLedger.map(x => x.text)), ...(topic?.closureAgreement?.remainsOpen ? [topic.closureAgreement.remainsOpen] : [])].filter((x,i,a)=>x&&a.indexOf(x)===i),
    participant_positions: insight?.participant_positions || { A: "", B: "" },
    agreements_reached: (s.agreements || []).filter(x => x.status === "agreed" && !x.supersededBy).map(x => x.text),
    active_repair_standards: (s.agreements || []).filter(x => x.kind === "repair_standard" && x.status === "agreed" && !x.supersededBy).map(x => x.text),
    pending_repair_changes: (s.agreements || []).filter(x => x.kind === "repair_standard" && x.parentId && ["pending","disputed"].includes(x.status)).map(x => ({ text:x.text, status:x.status, parent_id:x.parentId, version:Number(x.version||1) })),
    closure_agreement: topic?.closureAgreement ? { status:topic.closureAgreement.status, proposed_status:topic.closureAgreement.proposedStatus, resolved_summary:topic.closureAgreement.resolvedSummary||"", remains_open:topic.closureAgreement.remainsOpen||"", next_step:topic.closureAgreement.nextStep||"", repair_completion:topic.closureAgreement.repairCompletion||"unclear" } : null,
    definition_collisions: insight?.definition_collisions || [],
    current_behavior_vs_historical_injury: insight?.current_behavior_vs_historical_injury || { applies:false, historical_injury:"", current_behavior:"", relationship:"not_applicable", assessment:"" },
    evidence_added: (s.evidence || []).map(x => x.description).slice(-8),
    parked_topics: (s.parkingLot || []).map(x => x.text),
    suggested_next_questions: insight?.next_best_questions || [],
    main_issue: insight?.main_issue || "",
    topic_engagement: engagement,
    resolution_obstacle: engagement.notices.length ? "The active question may remain unresolved because several recent analyzed responses did not directly address it. This is a topic-relevance finding, not a conclusion about intent." : "",
    carry_forward_recommended: Boolean(topic && ["partially_resolved","unresolved_more_evidence","unresolved_value_preference","deferred_mutual","time_expired","session_ended_early"].includes(topic.status))
  };
}

function normalizeIssueCarryover(value) {
  if (!value || typeof value !== "object") return null;
  const cleanList = (arr, limit=12, max=700) => Array.isArray(arr) ? arr.map(x => normalizeShortText(x, max)).filter(Boolean).slice(0, limit) : [];
  const evidence = Array.isArray(value.evidence) ? value.evidence.slice(0, 12).map(x => ({
    type: normalizeShortText(x?.type || "other", 40),
    relation: normalizeShortText(x?.relation || "neutral", 40),
    description: normalizeShortText(x?.description || x, 700)
  })).filter(x => x.description) : [];
  return {
    source_type: "unresolved_issue",
    issue_id: normalizeShortText(value.issue_id || value.id || "", 120),
    from_session: normalizeShortText(value.from_session || value.source_session || "", 20),
    previous_topic: normalizeTopicText(value.previous_topic || value.topic || ""),
    previous_status: normalizeShortText(value.previous_status || value.current_status || "", 80),
    prior_context_notice: "Carried from a prior ClearSay unresolved issue. This is historical session context, not newly established fact.",
    participant_positions: {
      A: normalizeShortText(value.participant_positions?.A || "", 900),
      B: normalizeShortText(value.participant_positions?.B || "", 900)
    },
    common_ground: cleanList(value.common_ground || value.agreed_points, 10),
    still_disputed: cleanList(value.still_disputed || value.disputed_points, 12),
    agreements_reached: cleanList(value.agreements_reached || value.agreements, 10),
    evidence,
    missing_evidence: cleanList(value.missing_evidence || value.what_would_resolve, 10),
    suggested_next_questions: cleanList(value.suggested_next_questions, 8)
  };
}

function buildCouplesUnresolvedIssues(s) {
  const issues = [];
  const outcome = buildCouplesOutcome(s);
  const topic = s.topic;
  const openStatuses = new Set(["partially_resolved","unresolved_more_evidence","unresolved_value_preference","deferred_mutual","time_expired","session_ended_early"]);
  if (topic && (openStatuses.has(topic.status) || (s.sessionEndedAt && topic.status !== "resolved"))) {
    issues.push({
      id: `topic:${topic.id}`,
      source_session: s.code,
      source_type: "current_topic",
      topic: topic.text,
      current_status: topic.status,
      resolution_criteria: topic.resolutionCriteria || "",
      summary: outcome.main_issue || topic.text,
      participant_positions: outcome.participant_positions || {A:"",B:""},
      agreed_points: outcome.common_ground || [],
      disputed_points: outcome.still_disputed || [],
      agreements: outcome.agreements_reached || [],
      evidence: (s.evidence || []).slice(-12).map(x => ({ type:x.type, relation:x.relation, description:x.description })),
      missing_evidence: outcome.suggested_next_questions || [],
      suggested_next_questions: outcome.suggested_next_questions || [],
      created_at: topic.createdAt || s.createdAt,
      updated_at: s.updatedAt
    });
  }
  for (const item of (s.parkingLot || [])) {
    issues.push({
      id: `parked:${item.id}`,
      source_session: s.code,
      source_type: "parked_topic",
      topic: item.text,
      current_status: "parked_open",
      resolution_criteria: "",
      summary: "Issue saved for a later conversation.",
      participant_positions: {A:"",B:""},
      agreed_points: [], disputed_points: [item.text], agreements: [], evidence: [], missing_evidence: [], suggested_next_questions: [],
      created_at: item.createdAt || s.createdAt,
      updated_at: s.updatedAt
    });
  }
  return issues;
}

function couplesRemainingMs(s) {
  if (!s.timerEndsAt) return Number(s.maxActiveMs || normalizeCouplesDurationMinutes(s.durationMinutes) * 60 * 1000);
  return Math.max(0, new Date(s.timerEndsAt).getTime() - Date.now());
}

function maybeExpireCouplesSession(s) {
  if (!s.timerEndsAt || s.sessionEndedAt || Date.now() < new Date(s.timerEndsAt).getTime()) return false;
  s.sessionEndedAt = new Date().toISOString();
  s.sessionEndReason = "timer_expired";
  s.turn = null;
  if (s.topic && ["open","awaiting_confirmation"].includes(s.topic.status)) {
    s.topic.status = "time_expired";
    s.topic.closed_at = s.sessionEndedAt;
  }
  s.updatedAt = s.sessionEndedAt;
  s.revision = (s.revision || 0) + 1;
  if (openai && s.messages.length >= 2 && !s.finalInsightsRequested) {
    s.finalInsightsRequested = true;
    void (async () => {
      try {
        const result = await runCouplesOverview(s);
        s.insights = { ...result, created_at: new Date().toISOString(), automatic: true };
      } catch (err) {
        console.error("Couples Live automatic final insights error:", err);
      } finally {
        touchCouplesSession(s);
      }
    })();
  }
  return true;
}

function publicTopic(topic) {
  if (!topic) return null;
  return {
    id: topic.id, text: topic.text, resolution_criteria: topic.resolutionCriteria || "", status: topic.status, created_at: topic.createdAt, started_at: topic.startedAt || null, closed_at: topic.closedAt || topic.closed_at || null,
    confirmations: { A: Boolean(topic.confirmations?.A), B: Boolean(topic.confirmations?.B) },
    closure_votes: {
      A: topic.closureVotes?.A ? { status: topic.closureVotes.A.status, note: topic.closureVotes.A.note || "" } : null,
      B: topic.closureVotes?.B ? { status: topic.closureVotes.B.status, note: topic.closureVotes.B.note || "" } : null
    },
    closure_agreement: topic.closureAgreement ? { id:topic.closureAgreement.id, status:topic.closureAgreement.status, proposed_status:topic.closureAgreement.proposedStatus, resolved_summary:topic.closureAgreement.resolvedSummary||"", remains_open:topic.closureAgreement.remainsOpen||"", next_step:topic.closureAgreement.nextStep||"", repair_completion:topic.closureAgreement.repairCompletion||"unclear", proposed_by:topic.closureAgreement.proposedBy, created_at:topic.closureAgreement.createdAt, agreed_at:topic.closureAgreement.agreedAt||null, responses:{A:topic.closureAgreement.responses?.A||null,B:topic.closureAgreement.responses?.B||null} } : null
  };
}

function publicCouplesState(s, participantId) {
  const participants = {};
  for (const id of ["A","B"]) {
    const p = s.participants[id];
    participants[id] = p ? { id, name: p.name, joined_at: p.joinedAt, consent_at: p.consentAt || null, legal_disclaimer_version: p.legalDisclaimerVersion || null, legal_acknowledged_at: p.legalAcknowledgedAt || null } : null;
  }
  const viewerIsMediator = participantId === "M";
  return {
    code: s.code,
    participant_id: participantId,
    viewer_role: viewerIsMediator ? "mediator" : "participant",
    created_at: s.createdAt,
    updated_at: s.updatedAt,
    revision: s.revision || 0,
    participants,
    legal_notice: { disclaimer_version: LEGAL_DISCLAIMER_VERSION, acknowledgements: Object.fromEntries(["A","B"].map(id => [id, s.participants[id] ? { accepted_at:s.participants[id].legalAcknowledgedAt || null, version:s.participants[id].legalDisclaimerVersion || null } : null])) },
    mediator: s.mediator ? { enabled: Boolean(s.mediator.enabled), consent: { A: Boolean(s.mediator.consent?.A), B: Boolean(s.mediator.consent?.B) }, invite_code: viewerIsMediator ? "" : (s.mediator.enabled ? s.mediator.inviteCode || "" : ""), participant: s.mediator.participant ? { name: s.mediator.participant.name, joined_at: s.mediator.participant.joinedAt } : null } : null,
    messages: s.messages.map(m => ({
      id: m.id,
      sender_id: m.senderId,
      sender_name: m.senderName,
      topic_id: m.topicId || "",
      text: m.text,
      created_at: m.createdAt,
      analysis_status: m.analysisStatus,
      shared_analysis: publicSharedCouplesAnalysis(m.analysis),
      private_analysis: participantId === m.senderId ? (m.analysis || null) : null,
      analysis_error: m.analysisError || ""
    })),
    insights: s.insights || null,
    topic: publicTopic(s.topic),
    topic_history: (s.topicHistory || []).map(publicTopic),
    parking_lot: (s.parkingLot || []).map(x => ({ id: x.id, text: x.text, raised_by: x.raisedBy, source_message_id: x.sourceMessageId, created_at: x.createdAt })),
    claim_ledger: (s.claimLedger || []).map(x => ({ id:x.id, text:x.text, status:x.status, lifecycle:x.lifecycle, raised_by:x.raisedBy, updated_at:x.updatedAt, history:(x.history||[]).slice(-8) })),
    agreements: (s.agreements || []).map(x => ({ id:x.id, text:x.text, kind:x.kind||"general", root_id:x.rootId||x.id, version:Number(x.version||1), parent_id:x.parentId||"", superseded_by:x.supersededBy||"", superseded_at:x.supersededAt||null, status:x.status, proposed_by:x.proposedBy, created_at:x.createdAt, carried_from_agreement:x.carriedFromAgreement||"", responses:{ A:x.responses?.A||null, B:x.responses?.B||null } })),
    evidence: (s.evidence || []).map(x => ({ id:x.id, claim_id:x.claimId||"", type:x.type, relation:x.relation, description:x.description, added_by:x.addedBy, created_at:x.createdAt })),
    carryover: s.carryover || null,
    unresolved_issues: buildCouplesUnresolvedIssues(s),
    outcome: buildCouplesOutcome(s),
    topic_engagement: couplesTopicEngagement(s),
    turn_control: s.turn ? {
      active_speaker: s.turn.activeSpeaker,
      active_name: s.participants?.[s.turn.activeSpeaker]?.name || `Person ${s.turn.activeSpeaker}`,
      turn_number: s.turn.turnNumber || 1,
      status: s.turn.status || "waiting_to_start",
      turn_started_at: s.turn.startedAt || null,
      turn_ends_at: s.turn.endsAt || null,
      turn_remaining_ms: couplesTurnRemainingMs(s),
      turn_seconds: Math.round(COUPLES_TURN_MS / 1000),
      last_reason: s.turn.lastReason || "",
      can_start_turn: participantId === s.turn.activeSpeaker && s.turn.status === "waiting_to_start" && !s.sessionEndedAt && s.topic?.status === "open",
      can_send: participantId === s.turn.activeSpeaker && s.turn.status === "active" && couplesTurnRemainingMs(s) > 0 && !s.sessionEndedAt && s.topic?.status === "open"
    } : null,
    timer_started_at: s.timerStartedAt || null,
    timer_ends_at: s.timerEndsAt || null,
    remaining_ms: couplesRemainingMs(s),
    session_minutes: normalizeCouplesDurationMinutes(s.durationMinutes),
    max_active_ms: Number(s.maxActiveMs || normalizeCouplesDurationMinutes(s.durationMinutes) * 60 * 1000),
    session_ended_at: s.sessionEndedAt || null,
    session_end_reason: s.sessionEndReason || "",
    storage_mode: durableCouplesSession(s) ? "saved" : "temporary",
    durable_storage: durableCouplesSession(s),
    temporary_storage: !durableCouplesSession(s)
  };
}

function couplesContextDigest(s, currentMessageId = "") {
  const prior = s.messages.filter(m => m.id !== currentMessageId).slice(-18);
  const carry = s.carryover ? `CARRYOVER FROM PRIOR SESSION ${s.carryover.from_session || "unknown"}: prior topic=${s.carryover.previous_topic || ""}; Person A prior position=${s.carryover.participant_positions?.A || ""}; Person B prior position=${s.carryover.participant_positions?.B || ""}; common ground=${(s.carryover.common_ground||[]).join(" | ")}; unresolved=${(s.carryover.still_disputed||[]).join(" | ")}; agreements=${(s.carryover.agreements_reached||[]).join(" | ")}; evidence notes=${(s.carryover.evidence||[]).map(x=>x.description).join(" | ")}; IMPORTANT: this is historical prior-session context and is not newly established fact.` : "";
  const current = prior.map((m, i) => {
    const a = m.analysis;
    const effect = a?.conversation_effect?.explanation ? ` | PRIOR ANALYSIS: ${a.conversation_effect.explanation.slice(0, 260)}` : "";
    return `${i+1}. ${m.senderName}: ${m.text.slice(0, 800)}${effect}`;
  }).join("\n");
  return [carry,current].filter(Boolean).join("\n");
}

async function runCouplesMessageAnalysis(s, message) {
  if (!openai) throw new Error("OPENAI_API_KEY is not configured on the server.");
  const contextDigest = couplesContextDigest(s, message.id);
  const routingText = `${message.text}\n${contextDigest}`;
  const routing = selectCandidates(routingText, Math.min(CANDIDATE_LIMIT, 7));
  const candidateCatalog = JSON.stringify(compactCandidateCatalog(routing.candidates));
  const dynamicRules = buildDynamicRules(routing.claimTypes);
  const input = `COUPLES LIVE — POST-SEND ANALYSIS\n\nThe message below has ALREADY been sent in a shared two-person conversation. Do not rewrite, soften, correct, or block it. Analyze it after the fact as a reasoning mirror. Apply exactly the same standards to both participants. Never score who is winning.\n\nCURRENT SESSION TOPIC:\n${s.topic?.text || "No topic supplied."}\nThe active topic does not automatically change just because someone raises another issue. A different issue can be identified for the parking lot, but it cannot replace the current topic until the current topic is formally closed.\n\nCURRENT SHARED AGREEMENT STATE:\nActive mutually accepted agreements:\n${(s.agreements || []).filter(x=>x.status==="agreed"&&!x.supersededBy).map(x=>`- [${x.kind||"general"} v${Number(x.version||1)}] ${x.text}`).join("\\n") || "None recorded."}\nPending/disputed proposed replacements:\n${(s.agreements || []).filter(x=>x.parentId&&["pending","disputed"].includes(x.status)).map(x=>`- [${x.kind||"general"} v${Number(x.version||1)}; ${x.status}] ${x.text}`).join("\\n") || "None."}\nA mutually accepted agreement or repair standard remains active until both people accept a replacement. One participant may propose a new need or standard, but that proposal does not become the shared standard by declaration alone and does not retroactively rewrite whether the earlier standard was fulfilled.\n\nCLAIM-SPECIFIC RULES:\n${dynamicRules || "Use the core rules."}\n\nLOCAL ROUTING HINT:\nClaim types: ${routing.claimTypes.join(", ")}\nCandidate fallacies: ${candidateCatalog}\n\nPRIOR SENT MESSAGES IN THIS ROOM:\n${contextDigest || "No prior messages."}\n\nNEW SENT MESSAGE:\n${message.senderName}: ${message.text}\n\nTASK:\n1. Identify the meaningful claims in this message and how well the supplied conversation supports them. Keep summary, conversation_effect, topic_relevance, common_ground_added, disputed_or_unresolved, underlying_issue, agreement_signal, repair_signal, claim_updates, and caution neutral enough for a SHARED view. Do not name a fallacy in summary or those shared fields; fallacy names belong only in likely_fallacies, which is private to the message author.\n2. Analyze evidence quality. A participant stating something is evidence that they made/admitted that statement; it is not automatically independent proof of an underlying outside event.\n3. Choose 0–3 fallacy IDs only from the candidate catalog. No clear fallacy is a valid result.\n4. Compare this message with the prior room messages. Say whether it creates a new claim, supports, weakens, contradicts, clarifies, narrows, concedes, changes a standard, or does not materially change an earlier claim.\n5. Explicitly state whether the relevant claim becomes stronger, weaker, more precise, unchanged, or remains unclear, and why.\n6. Classify how the message relates to the CURRENT SESSION TOPIC as directly relevant, clarifying, supporting context, possible topic shift, unrelated issue, or unclear. Context can be relevant even when historical. Do not call every new fact a topic shift. A response can still be directly relevant when it disagrees with the premise, says the person does not know, or explains what information is missing. Never infer that an off-topic response was intentional avoidance. If a genuinely different issue is raised, summarize that issue in parked_issue so it can be saved for later without becoming the active topic.\n7. Track common ground and unresolved points when the new message actually changes them.\n8. If agreements are relevant, distinguish mutual terms, fulfillment, and later mutual vs unilateral changes. If a mutually accepted agreement or repair standard exists, keep it active until both people accept a replacement. A unilateral later change is a proposed change request, not the new shared standard, and does not retroactively rewrite whether the earlier agreement was fulfilled.\n9. If repair is relevant, keep behavioral repair separate from emotional/trust resolution. Continuing pain does not by itself prove zero repair; changed behavior does not by itself prove emotional resolution. If the injury came from a unilateral change to a shared agreement, identify that rupture separately from the later question of what both people mutually agree would count as repair.\n10. Detect DEFINITION COLLISIONS before judging either side: when both participants use the same consequential word differently (for example repair, support, safety, trust, space, control, priority, equality, or family), state Person A's apparent meaning and Person B's apparent meaning, identify overlap, and ask for an operational definition. A definition difference is not itself a fallacy.\n11. Separate CURRENT BEHAVIOR from HISTORICAL INJURY. Classify whether the same behavior appears to continue, behavior changed/stopped while the injury remains, the current issue is different, or the evidence is mixed/unclear. Do not use continuing hurt alone as proof that the behavior still occurs; do not use changed behavior alone as proof the injury is resolved.\n12. Identify the underlying issue the conversation appears to be moving toward, while preserving the current topic as the active question until it is formally closed.\n13. Produce claim_updates for the meaningful claims affected by this message. Mark explicit concessions, corrections, or withdrawals so an older claim is not left falsely active. Use lifecycle=new, supported, weakened, narrowed, clarified, conceded, corrected, withdrawn, unchanged, or unclear.\n14. Offer at most three useful questions that could clarify the issue. These are optional analysis notes, not pre-send rewrites.\n15. Do not diagnose either participant, assign personality labels, or infer abuse/intent beyond the evidence supplied.`;

  const response = await openai.responses.create({
    model: MODEL,
    reasoning: { effort: "low" },
    instructions: CORE_INSTRUCTIONS,
    input,
    store: false,
    max_output_tokens: 1800,
    prompt_cache_key: "fallacy-finder-couples-message-v4",
    text: {
      verbosity: "low",
      format: { type: "json_schema", name: "fallacy_finder_couples_message", strict: true, schema: couplesMessageSchema }
    }
  });
  if (!response.output_text) throw new Error("The model returned no structured Couples Live analysis.");
  const analysis = JSON.parse(response.output_text);
  analysis.likely_fallacies = (analysis.likely_fallacies || []).map(item => {
    const official = fallacyById.get(item.fallacy_id);
    return official ? { ...item, name: official.name, group: official.group } : item;
  });
  return {
    analysis,
    meta: {
      model: response.model || MODEL,
      usage: response.usage || null,
      estimated_cost_usd: estimateCost(response.usage),
      candidates_sent: routing.candidates.length
    }
  };
}

async function analyzeCouplesMessageInBackground(s, message) {
  try {
    const result = await runCouplesMessageAnalysis(s, message);
    message.analysis = result.analysis;
    message.analysisMeta = result.meta;
    message.analysisStatus = "ready";
    message.analysisError = "";
    updateClaimLedgerFromMessage(s, message);
    const tr = result.analysis?.topic_relevance;
    if (tr && ["possible_topic_shift","unrelated_issue"].includes(tr.classification) && String(tr.parked_issue || "").trim()) {
      const text = normalizeTopicText(tr.parked_issue);
      const exists = (s.parkingLot || []).some(x => x.text.toLowerCase() === text.toLowerCase());
      if (text && !exists) {
        s.parkingLot.push({ id: `p-${Date.now()}-${randomBytes(3).toString("hex")}`, text, raisedBy: message.senderId, sourceMessageId: message.id, createdAt: new Date().toISOString() });
      }
    }
  } catch (err) {
    console.error("Couples Live message analysis error:", err);
    message.analysisStatus = "failed";
    message.analysisError = err?.status === 429 ? "Analysis is temporarily rate-limited. The message was still sent." : (err?.message || "Analysis failed.");
  }
  s.insights = null;
  touchCouplesSession(s);
}

function buildCouplesOverviewDigest(s) {
  return s.messages.slice(-120).map((m, i) => {
    const a = m.analysis;
    const parts = [`${i+1}. ${m.senderName}: ${m.text.slice(0, 650)}`];
    if (a?.summary) parts.push(`analysis=${a.summary.slice(0, 260)}`);
    if (a?.conversation_effect?.explanation) parts.push(`effect=${a.conversation_effect.explanation.slice(0, 240)}`);
    if (a?.underlying_issue) parts.push(`underlying=${a.underlying_issue.slice(0, 180)}`);
    return parts.join(" | ");
  }).join("\n").slice(0, 30000);
}

async function runCouplesOverview(s) {
  if (!openai) throw new Error("OPENAI_API_KEY is not configured on the server.");
  const names = [s.participants.A?.name, s.participants.B?.name].filter(Boolean).join(" and ");
  const digest = buildCouplesOverviewDigest(s);
  const input = `COUPLES LIVE — SHARED CONVERSATION INSIGHTS\n\nThis is the actual text entered in this in-app room by ${names || "two participants"}. It is a complete record of messages sent THROUGH THIS ROOM, but it is not independent proof of outside events described in those messages. Apply identical reasoning standards to both participants. Do not count fallacies by person or declare a winner.\n\nACTIVE / MOST RECENT TOPIC:\n${s.topic?.text || "No topic supplied."}\nTopic status: ${s.topic?.status || "unknown"}\nResolution criteria: ${s.topic?.resolutionCriteria || "Not specified"}\n\nCURRENT SHARED AGREEMENT STATE:\nActive mutually accepted agreements:\n${(s.agreements || []).filter(x=>x.status==="agreed"&&!x.supersededBy).map(x=>`- [${x.kind||"general"} v${Number(x.version||1)}] ${x.text}`).join("\\n") || "None recorded."}\nPending or disputed proposed replacements:\n${(s.agreements || []).filter(x=>x.parentId&&["pending","disputed"].includes(x.status)).map(x=>`- [${x.kind||"general"} v${Number(x.version||1)}; ${x.status}] ${x.text} (proposed replacement for ${((s.agreements||[]).find(p=>p.id===x.parentId)?.text)||"prior agreement"})`).join("\\n") || "None."}\nRule: a mutually accepted agreement remains the active shared standard until both participants accept a replacement. A one-person proposal is a change request, not a retroactive rewrite.\n\nCURRENT CLOSURE AGREEMENT STATE:\n${s.topic?.closureAgreement ? JSON.stringify(publicTopic(s.topic).closure_agreement) : "No structured closure agreement has been proposed."}\nExplicit closure means both participants accept the same record of what is resolved, what remains open, the next step, and the repair-completion status. Silence, affection, apology, or stopping the conversation alone is not mutual closure.\n\nPARTICIPANT-SUPPLIED EVIDENCE NOTES (not independently verified):\n${(s.evidence || []).map(x=>`- ${x.type}/${x.relation}: ${x.description}`).join("\\n") || "None recorded."}\n\nCLAIM LEDGER:\n${(s.claimLedger || []).map(x=>`- ${x.text} [${x.status}; ${x.lifecycle}]`).join("\\n") || "No ledger entries yet."}\n\nROOM MESSAGES:\n${digest}\n\nTASK:\n1. Identify the central underlying issue and current disagreement, anchored to the active/most recent session topic.\n2. Separate common ground from disputed, inferred, unsupported, or unknown claims.\n3. Show how important claims have strengthened, weakened, narrowed, changed, or been conceded as later messages supplied new information.\n4. Identify recurring reasoning patterns only when supported by multiple messages.\n5. If an agreement is central, verify original mutual terms, fulfillment, and whether later changes were mutual or unilateral. Treat an accepted agreement as active until both people accept a replacement; do not treat a one-person proposal as the new shared standard.\n6. If repair is central, keep behavioral repair separate from emotional/trust resolution. If both people previously accepted a repair definition, judge prior fulfillment under that definition before evaluating later proposed changes.\n7. Identify consequential DEFINITION COLLISIONS: words both people are using with different operational meanings. State each meaning and a neutral question that could create a shared definition.\n8. Separate CURRENT BEHAVIOR from HISTORICAL INJURY. State whether the same behavior continues, behavior changed/stopped while injury remains, the present issue is different, or the evidence is mixed/unclear.\n9. If a structured closure agreement exists, do not call the topic mutually closed unless both people accepted the same closure record.\n10. Offer neutral next questions that could clarify or resolve the remaining issue.\n11. Focus on understanding and repair, not message rewriting, diagnosis, blame, or scoring.
9. Summarize each participant's CURRENT POSITION on the active issue in participant_positions. Treat these as positions expressed in this room, not verified outside facts.`;
  const response = await openai.responses.create({
    model: MODEL,
    reasoning: { effort: "low" },
    instructions: CORE_INSTRUCTIONS,
    input,
    store: false,
    max_output_tokens: 1700,
    prompt_cache_key: "fallacy-finder-couples-overview-v4",
    text: { verbosity: "low", format: { type: "json_schema", name: "fallacy_finder_couples_overview", strict: true, schema: sessionOverviewSchema } }
  });
  if (!response.output_text) throw new Error("The model returned no Couples Live overview.");
  return {
    analysis: JSON.parse(response.output_text),
    meta: { model: response.model || MODEL, usage: response.usage || null, estimated_cost_usd: estimateCost(response.usage) }
  };
}

setInterval(() => {
  const now = Date.now();
  for (const [code, s] of couplesSessions) if (!durableCouplesSession(s) && Number.isFinite(Number(s.expiresAt)) && now > Number(s.expiresAt)) couplesSessions.delete(code);
}, 10 * 60 * 1000).unref?.();

function normalizeLegalAcknowledgement(value) {
  if (!value || value.accepted !== true) return null;
  if (String(value.version || "") !== LEGAL_DISCLAIMER_VERSION) return null;
  const acceptedAt = String(value.accepted_at || value.acceptedAt || "");
  const acceptedMs = Date.parse(acceptedAt);
  if (!Number.isFinite(acceptedMs)) return null;
  return { accepted: true, version: LEGAL_DISCLAIMER_VERSION, acceptedAt: new Date(acceptedMs).toISOString() };
}

function makeCouplesSession({ name, topic, resolutionCriteria = "", carryover = null, durationMinutes = COUPLES_DEFAULT_MINUTES, legalAck, saveSession = true }) {
  const code = newCouplesCode();
  const token = newCouplesToken();
  const now = new Date().toISOString();
  const topicText = normalizeTopicText(topic);
  const normalizedDurationMinutes = normalizeCouplesDurationMinutes(durationMinutes);
  const normalizedLegalAck = normalizeLegalAcknowledgement(legalAck);
  if (!normalizedLegalAck) throw new Error("The current ClearSay legal notice must be acknowledged before creating a session.");
  const creatorName = cleanParticipantName(name, "Person A");
  const session = {
    code, createdAt: now, updatedAt: now, storageMode: saveSession === false ? "temporary" : "saved", expiresAt: saveSession === false ? Date.now() + COUPLES_SESSION_TTL_MS : null, revision: 1,
    durationMinutes: normalizedDurationMinutes, maxActiveMs: normalizedDurationMinutes * 60 * 1000,
    participants: { A: { token, name: creatorName, joinedAt: now, consentAt: now, legalDisclaimerVersion: normalizedLegalAck.version, legalAcknowledgedAt: normalizedLegalAck.acceptedAt }, B: null },
    auditRecords: [
      { sequence: 1, recordType: "legal_acknowledgement", participantId: "A", participantName: creatorName, disclaimerVersion: normalizedLegalAck.version, acceptedAt: normalizedLegalAck.acceptedAt },
      { sequence: 2, recordType: "session_created", participantId: "A", participantName: creatorName, createdAt: now }
    ],
    messages: [], insights: null,
    topic: { id: `t-${Date.now()}`, text: topicText, resolutionCriteria: normalizeShortText(resolutionCriteria, 500), status: "awaiting_confirmation", createdAt: now, startedAt: null, closedAt: null, confirmations: { A: true, B: false }, closureVotes: { A: null, B: null }, closureAgreement: null },
    topicHistory: [], parkingLot: [], claimLedger: [], agreements: [], evidence: [], carryover,
    mediator: { enabled: false, consent: { A:false, B:false }, inviteCode: "", participant: null },
    nextFirstSpeaker: "A", turnCounter: 0, turn: null,
    timerStartedAt: null, timerEndsAt: null, sessionEndedAt: null, sessionEndReason: "", finalInsightsRequested: false
  };
  couplesSessions.set(code, session);
  if (durableCouplesSession(session)) queuePersistCouplesSessions();
  return { session, token };
}

app.post("/api/couples/create", (req, res) => {
  const topicText = normalizeTopicText(req.body?.topic);
  if (!topicText) return res.status(400).json({ error: "Enter one topic or question for this Couples Live session." });
  if (req.body?.consent !== true) return res.status(400).json({ error: "Confirm that messages and shared session analysis may be visible to the other participant and exportable by either participant." });
  const legalAck = normalizeLegalAcknowledgement(req.body?.legal_ack);
  if (!legalAck) return res.status(400).json({ error: "Acknowledge the current ClearSay legal notice before creating a session." });
  const durationMinutes = normalizeCouplesDurationMinutes(req.body?.session_minutes);
  const carryover = normalizeIssueCarryover(req.body?.carryover);
  const { session, token } = makeCouplesSession({ name:req.body?.name, topic:topicText, resolutionCriteria:req.body?.resolution_criteria, durationMinutes, legalAck, carryover, saveSession:req.body?.save_session !== false });
  res.json({ code: session.code, token, participant_id: "A", state: publicCouplesState(session, "A") });
});

app.post("/api/couples/join", (req, res) => {
  if (req.body?.consent !== true) return res.status(400).json({ error: "Confirm that messages and shared session analysis may be visible to the other participant and exportable by either participant." });
  const legalAck = normalizeLegalAcknowledgement(req.body?.legal_ack);
  if (!legalAck) return res.status(400).json({ error: "Acknowledge the current ClearSay legal notice before joining a session." });
  const s = getCouplesSession(req.body?.code);
  if (!s) return res.status(404).json({ error: "That Couples Live session was not found or has expired." });
  if (s.participants.B) return res.status(409).json({ error: "This session already has two participants." });
  const token = newCouplesToken();
  const now = new Date().toISOString();
  const joinName = cleanParticipantName(req.body?.name, "Person B");
  s.participants.B = { token, name: joinName, joinedAt: now, consentAt: now, legalDisclaimerVersion: legalAck.version, legalAcknowledgedAt: legalAck.acceptedAt };
  s.auditRecords ||= [];
  s.auditRecords.push({ sequence: s.auditRecords.length + 1, recordType: "legal_acknowledgement", participantId: "B", participantName: joinName, disclaimerVersion: legalAck.version, acceptedAt: legalAck.acceptedAt });
  s.auditRecords.push({ sequence: s.auditRecords.length + 1, recordType: "participant_joined", participantId: "B", participantName: joinName, createdAt: now });
  touchCouplesSession(s);
  res.json({ code: s.code, token, participant_id: "B", state: publicCouplesState(s, "B") });
});

app.get("/api/couples/:code/state", (req, res) => {
  const s = getCouplesSession(req.params.code);
  if (!s) return res.status(404).json({ error: "This Couples Live session is no longer available." });
  const p = couplesParticipantFromRequest(s, req);
  if (!p) return res.status(401).json({ error: "This browser is not authorized for that session." });
  const sessionExpired = maybeExpireCouplesSession(s);
  const turnExpired = !sessionExpired && maybeExpireCouplesTurn(s);
  if (turnExpired) touchCouplesSession(s);
  // A read keeps only temporary/no-save rooms alive. Saved rooms persist until explicitly deleted.
  if (!durableCouplesSession(s)) s.expiresAt = Date.now() + COUPLES_SESSION_TTL_MS;
  res.json(publicCouplesState(s, p.id));
});

app.post("/api/couples/:code/message", limiter, (req, res) => {
  const s = getCouplesSession(req.params.code);
  if (!s) return res.status(404).json({ error: "This Couples Live session is no longer available." });
  const p = couplesParticipantFromRequest(s, req);
  if (!p) return res.status(401).json({ error: "This browser is not authorized for that session." });
  if (!isCoupleParticipant(p)) return res.status(403).json({ error: "The therapist / mediator role is read-only in Couples Live." });
  maybeExpireCouplesSession(s);
  if (s.sessionEndedAt) return res.status(409).json({ error: `This ${normalizeCouplesDurationMinutes(s.durationMinutes)}-minute Couples Live session has ended. Review or export the session, then start a new one if needed.` });
  if (!s.participants.B) return res.status(409).json({ error: "Wait for Person B to join before starting the conversation." });
  if (!s.topic || s.topic.status !== "open") return res.status(409).json({ error: "Both people must confirm the current topic before messages can be sent." });
  if (maybeExpireCouplesTurn(s)) touchCouplesSession(s);
  if (!s.turn) initializeCouplesFloor(s, "topic_open");
  if (s.turn.activeSpeaker !== p.id) return res.status(409).json({ error: `It is ${s.participants?.[s.turn.activeSpeaker]?.name || `Person ${s.turn.activeSpeaker}`}’s turn. Only the person with the floor can type or send.` });
  if (s.turn.status !== "active" || !s.turn.startedAt) return res.status(409).json({ error: "Start your 1:00 response turn before typing or sending." });
  if (couplesTurnRemainingMs(s) <= 0) { advanceCouplesFloor(s, "turn_expired"); touchCouplesSession(s); return res.status(409).json({ error: "Your 1:00 turn expired. The floor has passed to the other person." }); }
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!text) return res.status(400).json({ error: "Type a message first." });
  if (text.length > 1800) return res.status(400).json({ error: "Please keep one message under 1,800 characters." });
  if (s.messages.length >= COUPLES_MAX_MESSAGES) return res.status(400).json({ error: `This beta room has reached its ${COUPLES_MAX_MESSAGES}-message limit.` });
  const message = {
    id: `m-${Date.now()}-${randomBytes(4).toString("hex")}`,
    senderId: p.id,
    senderName: p.name,
    topicId: s.topic?.id || "",
    text,
    createdAt: new Date().toISOString(),
    analysisStatus: openai ? "pending" : "failed",
    analysis: null,
    analysisError: openai ? "" : "OPENAI_API_KEY is not configured on the server."
  };
  if (!s.timerStartedAt) {
    s.timerStartedAt = message.createdAt;
    s.timerEndsAt = new Date(new Date(message.createdAt).getTime() + Number(s.maxActiveMs || normalizeCouplesDurationMinutes(s.durationMinutes) * 60 * 1000)).toISOString();
  }
  if (!s.topic.startedAt) s.topic.startedAt = message.createdAt;
  s.messages.push(message);
  advanceCouplesFloor(s, "message_sent");
  s.insights = null;
  touchCouplesSession(s);
  res.json({ ok: true, message: publicCouplesState(s, p.id).messages.at(-1), revision: s.revision });
  if (openai) void analyzeCouplesMessageInBackground(s, message);
});

app.post("/api/couples/:code/turn/start", (req, res) => {
  const s = getCouplesSession(req.params.code);
  if (!s) return res.status(404).json({ error: "This Couples Live session is no longer available." });
  const p = couplesParticipantFromRequest(s, req);
  if (!p) return res.status(401).json({ error: "This browser is not authorized for that session." });
  if (!isCoupleParticipant(p)) return res.status(403).json({ error: "The therapist / mediator role is read-only in Couples Live." });
  maybeExpireCouplesSession(s);
  if (s.sessionEndedAt) return res.status(409).json({ error: "This Couples Live session has ended." });
  if (!s.participants.B || s.topic?.status !== "open") return res.status(409).json({ error: "Both people must join and confirm the active topic first." });
  if (maybeExpireCouplesTurn(s)) touchCouplesSession(s);
  if (!s.turn) initializeCouplesFloor(s, "topic_open");
  if (s.turn.activeSpeaker !== p.id) return res.status(409).json({ error: `It is ${s.participants?.[s.turn.activeSpeaker]?.name || `Person ${s.turn.activeSpeaker}`}’s turn.` });
  if (s.turn.status === "active" && couplesTurnRemainingMs(s) > 0) return res.json({ ok:true, state:publicCouplesState(s,p.id) });
  startCouplesTurn(s, p.id);
  touchCouplesSession(s);
  res.json({ ok:true, state:publicCouplesState(s,p.id) });
});

app.post("/api/couples/:code/turn/pass", (req, res) => {
  const s = getCouplesSession(req.params.code);
  if (!s) return res.status(404).json({ error: "This Couples Live session is no longer available." });
  const p = couplesParticipantFromRequest(s, req);
  if (!p) return res.status(401).json({ error: "This browser is not authorized for that session." });
  if (!isCoupleParticipant(p)) return res.status(403).json({ error: "The therapist / mediator role is read-only in Couples Live." });
  maybeExpireCouplesSession(s);
  if (s.sessionEndedAt) return res.status(409).json({ error: "This Couples Live session has ended." });
  if (s.topic?.status !== "open") return res.status(409).json({ error: "The current topic is not open." });
  if (maybeExpireCouplesTurn(s)) {
    touchCouplesSession(s);
    return res.status(409).json({ error: "The previous 1:00 turn already expired and the floor has passed.", state: publicCouplesState(s, p.id) });
  }
  if (!s.turn) initializeCouplesFloor(s, "topic_open");
  if (s.turn.activeSpeaker !== p.id) return res.status(409).json({ error: "Only the person with the floor can pass the turn." });
  advanceCouplesFloor(s, "passed");
  touchCouplesSession(s);
  res.json({ ok:true, state:publicCouplesState(s,p.id) });
});

app.post("/api/couples/:code/topic/confirm", (req, res) => {
  const s = getCouplesSession(req.params.code);
  if (!s) return res.status(404).json({ error: "This Couples Live session is no longer available." });
  const p = couplesParticipantFromRequest(s, req);
  if (!p) return res.status(401).json({ error: "This browser is not authorized for that session." });
  if (!isCoupleParticipant(p)) return res.status(403).json({ error: "Only the two participants can manage topics." });
  maybeExpireCouplesSession(s);
  if (s.sessionEndedAt) return res.status(409).json({ error: "This session has ended." });
  if (!s.topic || s.topic.status !== "awaiting_confirmation") return res.status(409).json({ error: "There is no topic waiting for confirmation." });
  s.topic.confirmations[p.id] = true;
  if (s.topic.confirmations.A && s.topic.confirmations.B) {
    s.topic.status = "open";
    initializeCouplesFloor(s, "topic_open");
  }
  touchCouplesSession(s);
  res.json({ ok: true, state: publicCouplesState(s, p.id) });
});

app.post("/api/couples/:code/topic/close", (req, res) => {
  const s=getCouplesSession(req.params.code); if(!s)return res.status(404).json({error:"This Couples Live session is no longer available."});
  const p=couplesParticipantFromRequest(s,req); if(!p)return res.status(401).json({error:"This browser is not authorized for that session."});
  if(!isCoupleParticipant(p))return res.status(403).json({error:"Only the two participants can manage topics."});
  return res.status(409).json({error:"ClearSay v1.8.5 requires a structured Closure Agreement. Propose what is resolved, what remains open, the next step, and repair completion instead of submitting a status vote."});
});

const COUPLES_REPAIR_COMPLETION = new Set(["complete","partial","not_complete","not_applicable","unclear"]);

app.post("/api/couples/:code/topic/closure/propose", (req, res) => {
  const s=getCouplesSession(req.params.code); if(!s)return res.status(404).json({error:"This Couples Live session is no longer available."});
  const p=couplesParticipantFromRequest(s,req); if(!p)return res.status(401).json({error:"This browser is not authorized for that session."});
  if(!isCoupleParticipant(p))return res.status(403).json({error:"Only the two participants can propose closure."});
  maybeExpireCouplesSession(s); if(s.sessionEndedAt)return res.status(409).json({error:"This session has ended."});
  if(!s.topic||s.topic.status!=="open")return res.status(409).json({error:"The current topic is not open."});
  const proposedStatus=String(req.body?.status||"").trim(); if(!COUPLES_CLOSE_STATUSES.has(proposedStatus))return res.status(400).json({error:"Choose a valid closing status."});
  const resolvedSummary=normalizeShortText(req.body?.resolved_summary,700), remainsOpen=normalizeShortText(req.body?.remains_open,700), nextStep=normalizeShortText(req.body?.next_step,700);
  const repairCompletion=String(req.body?.repair_completion||"unclear"); if(!COUPLES_REPAIR_COMPLETION.has(repairCompletion))return res.status(400).json({error:"Choose a valid repair-completion status."});
  if(proposedStatus==="resolved"&&!resolvedSummary)return res.status(400).json({error:"State what both people would be agreeing is resolved."});
  const now=new Date().toISOString();
  s.topic.closureAgreement={id:`cl-${Date.now()}-${randomBytes(3).toString("hex")}`,status:"pending",proposedStatus,resolvedSummary,remainsOpen,nextStep,repairCompletion,proposedBy:p.id,createdAt:now,agreedAt:null,responses:{A:null,B:null}};
  s.topic.closureAgreement.responses[p.id]={decision:"agree",at:now};
  touchCouplesSession(s); res.json({ok:true,state:publicCouplesState(s,p.id)});
});

app.post("/api/couples/:code/topic/closure/respond", (req, res) => {
  const s=getCouplesSession(req.params.code); if(!s)return res.status(404).json({error:"This Couples Live session is no longer available."});
  const p=couplesParticipantFromRequest(s,req); if(!p)return res.status(401).json({error:"This browser is not authorized for that session."});
  if(!isCoupleParticipant(p))return res.status(403).json({error:"Only the two participants can respond to closure."});
  maybeExpireCouplesSession(s); if(s.sessionEndedAt)return res.status(409).json({error:"This session has ended."});
  if(!s.topic||s.topic.status!=="open"||!s.topic.closureAgreement)return res.status(409).json({error:"There is no pending closure agreement."});
  const decision=String(req.body?.decision||""); if(!["agree","disagree"].includes(decision))return res.status(400).json({error:"Choose agree or disagree."});
  const c=s.topic.closureAgreement; c.responses[p.id]={decision,at:new Date().toISOString()};
  const a=c.responses.A?.decision,b=c.responses.B?.decision;
  if(a==="agree"&&b==="agree"){c.status="agreed";c.agreedAt=new Date().toISOString();s.topic.status=c.proposedStatus;s.topic.closedAt=c.agreedAt;s.topic.closureVotes={A:{status:c.proposedStatus,note:c.remainsOpen,at:c.agreedAt},B:{status:c.proposedStatus,note:c.remainsOpen,at:c.agreedAt}};s.turn=null;}
  else if(a==="disagree"||b==="disagree")c.status="disputed"; else c.status="pending";
  touchCouplesSession(s); res.json({ok:true,state:publicCouplesState(s,p.id),closed:c.status==="agreed"});
});

app.post("/api/couples/:code/topic/new", (req, res) => {
  const s = getCouplesSession(req.params.code);
  if (!s) return res.status(404).json({ error: "This Couples Live session is no longer available." });
  const p = couplesParticipantFromRequest(s, req);
  if (!p) return res.status(401).json({ error: "This browser is not authorized for that session." });
  if (!isCoupleParticipant(p)) return res.status(403).json({ error: "Only the two participants can manage topics." });
  maybeExpireCouplesSession(s);
  if (s.sessionEndedAt) return res.status(409).json({ error: `The ${normalizeCouplesDurationMinutes(s.durationMinutes)}-minute session has ended. Start a new Couples Live session for another topic.` });
  if (!s.topic || ["open","awaiting_confirmation"].includes(s.topic.status)) return res.status(409).json({ error: "Close the current topic before proposing a new one." });
  let topicText = normalizeTopicText(req.body?.topic);
  const parkingId = String(req.body?.parking_id || "").trim();
  if (!topicText && parkingId) topicText = normalizeTopicText((s.parkingLot || []).find(x => x.id === parkingId)?.text || "");
  if (!topicText) return res.status(400).json({ error: "Enter or choose the next topic." });
  s.topicHistory.push({ ...s.topic, confirmations: { ...s.topic.confirmations }, closureVotes: { ...s.topic.closureVotes } });
  const now = new Date().toISOString();
  s.topic = { id: `t-${Date.now()}-${randomBytes(3).toString("hex")}`, text: topicText, resolutionCriteria: normalizeShortText(req.body?.resolution_criteria, 500), status: "awaiting_confirmation", createdAt: now, startedAt: null, closedAt: null, confirmations: { A: false, B: false }, closureVotes: { A: null, B: null }, closureAgreement: null };
  s.turn = null;
  s.topic.confirmations[p.id] = true;
  if (parkingId) s.parkingLot = (s.parkingLot || []).filter(x => x.id !== parkingId);
  s.insights = null;
  touchCouplesSession(s);
  res.json({ ok: true, state: publicCouplesState(s, p.id) });
});


const COUPLES_AGREEMENT_KINDS = new Set(["general","shared_term","repair_standard"]);

app.post("/api/couples/:code/agreement/propose", (req, res) => {
  const s = getCouplesSession(req.params.code); if (!s) return res.status(404).json({ error: "This Couples Live session is no longer available." });
  const p = couplesParticipantFromRequest(s, req); if (!p) return res.status(401).json({ error: "This browser is not authorized for that session." });
  if (!isCoupleParticipant(p)) return res.status(403).json({ error: "Only the two participants can propose an agreement." });
  maybeExpireCouplesSession(s); if (s.sessionEndedAt) return res.status(409).json({ error: "This Couples Live session has ended." });
  const text = normalizeShortText(req.body?.text, 700); if (!text) return res.status(400).json({ error: "Enter the exact proposed agreement." });
  const kind = String(req.body?.kind || "general");
  if (!COUPLES_AGREEMENT_KINDS.has(kind)) return res.status(400).json({ error: "Choose a valid agreement type." });
  s.agreements ||= [];
  const parentId = normalizeShortText(req.body?.parent_id || "", 120);
  let parent = null;
  if (parentId) {
    parent = s.agreements.find(x=>x.id===parentId);
    if (!parent) return res.status(400).json({ error: "The agreement you are trying to replace was not found." });
    if (parent.status !== "agreed" || parent.supersededBy) return res.status(409).json({ error: "Only a currently active mutually accepted agreement can be replaced." });
    if ((parent.kind || "general") !== kind) return res.status(400).json({ error: "A replacement must use the same agreement type as the agreement it replaces." });
  }
  const itemId=`a-${Date.now()}-${randomBytes(3).toString("hex")}`;
  const item = { id:itemId, text, kind, rootId:parent ? (parent.rootId||parent.id) : itemId, version:parent ? Number(parent.version||1)+1 : 1, parentId:parentId||"", supersededBy:"", supersededAt:null, status:"pending", proposedBy:p.id, createdAt:new Date().toISOString(), responses:{A:null,B:null} };
  item.responses[p.id] = { decision:"agree", at:item.createdAt };
  s.agreements.push(item); touchCouplesSession(s); res.json({ ok:true, state:publicCouplesState(s,p.id) });
});

app.post("/api/couples/:code/agreement/:id/respond", (req, res) => {
  const s = getCouplesSession(req.params.code); if (!s) return res.status(404).json({ error: "This Couples Live session is no longer available." });
  const p = couplesParticipantFromRequest(s, req); if (!p) return res.status(401).json({ error: "This browser is not authorized for that session." });
  if (!isCoupleParticipant(p)) return res.status(403).json({ error: "Only the two participants can respond to an agreement." });
  maybeExpireCouplesSession(s); if (s.sessionEndedAt) return res.status(409).json({ error: "This Couples Live session has ended." });
  const item=(s.agreements||[]).find(x=>x.id===req.params.id); if(!item)return res.status(404).json({error:"Agreement proposal not found."});
  const decision=String(req.body?.decision||""); if(!["agree","disagree"].includes(decision))return res.status(400).json({error:"Choose agree or disagree."});
  item.responses[p.id]={decision,at:new Date().toISOString()};
  const a=item.responses.A?.decision,b=item.responses.B?.decision; item.status=(a==="agree"&&b==="agree")?"agreed":((a==="disagree"||b==="disagree")?"disputed":"pending");
  if(item.status==="agreed"&&item.parentId){
    const parent=(s.agreements||[]).find(x=>x.id===item.parentId);
    if(parent&&parent.status==="agreed"&&!parent.supersededBy){parent.supersededBy=item.id;parent.status="superseded";parent.supersededAt=new Date().toISOString();}
  }
  touchCouplesSession(s); res.json({ok:true,state:publicCouplesState(s,p.id)});
});

app.post("/api/couples/:code/evidence", (req, res) => {
  const s = getCouplesSession(req.params.code); if (!s) return res.status(404).json({ error: "This Couples Live session is no longer available." });
  const p = couplesParticipantFromRequest(s, req); if (!p) return res.status(401).json({ error: "This browser is not authorized for that session." });
  if (!isCoupleParticipant(p)) return res.status(403).json({ error: "Only the two participants can add evidence notes." });
  maybeExpireCouplesSession(s); if (s.sessionEndedAt) return res.status(409).json({ error: "This Couples Live session has ended." });
  const description=normalizeShortText(req.body?.description,1000); if(!description)return res.status(400).json({error:"Describe the evidence first."});
  const type=String(req.body?.type||"other"); const relation=String(req.body?.relation||"neutral");
  if(!["direct_record","direct_observation","contemporaneous_record","witness_report","memory","hearsay","inference","other"].includes(type))return res.status(400).json({error:"Choose a valid evidence type."});
  if(!["supports","opposes","neutral"].includes(relation))return res.status(400).json({error:"Choose whether the evidence supports, opposes, or is neutral."});
  const claimId=String(req.body?.claim_id||"");
  if(claimId && !(s.claimLedger||[]).some(x=>x.id===claimId))return res.status(400).json({error:"Selected claim was not found."});
  s.evidence ||= []; s.evidence.push({id:`e-${Date.now()}-${randomBytes(3).toString("hex")}`,claimId,type,relation,description,addedBy:p.id,createdAt:new Date().toISOString()});
  touchCouplesSession(s); res.json({ok:true,state:publicCouplesState(s,p.id)});
});

app.post("/api/couples/:code/mediator/consent", (req, res) => {
  const s=getCouplesSession(req.params.code); if(!s)return res.status(404).json({error:"This Couples Live session is no longer available."});
  const p=couplesParticipantFromRequest(s,req); if(!p)return res.status(401).json({error:"This browser is not authorized for that session."});
  if(!isCoupleParticipant(p))return res.status(403).json({error:"Only the two participants can authorize a therapist / mediator."});
  s.mediator ||= {enabled:false,consent:{A:false,B:false},inviteCode:"",participant:null}; s.mediator.consent[p.id]=Boolean(req.body?.allow);
  if(s.mediator.consent.A && s.mediator.consent.B){s.mediator.enabled=true;if(!s.mediator.inviteCode)s.mediator.inviteCode=newCouplesCode();} else {s.mediator.enabled=false;s.mediator.inviteCode="";s.mediator.participant=null;}
  touchCouplesSession(s); res.json({ok:true,state:publicCouplesState(s,p.id)});
});

app.post("/api/couples/mediator/join", (req, res) => {
  const s=getCouplesSession(req.body?.code); if(!s)return res.status(404).json({error:"That Couples Live session was not found or has expired."});
  if(!s.mediator?.enabled || String(req.body?.mediator_code||"").trim().toUpperCase()!==String(s.mediator.inviteCode||"").toUpperCase())return res.status(403).json({error:"Mediator access has not been mutually authorized or the mediator code is incorrect."});
  const now=new Date().toISOString(); const token=newCouplesToken(); s.mediator.participant={token,name:cleanParticipantName(req.body?.name,"Therapist / Mediator"),joinedAt:now}; touchCouplesSession(s);
  res.json({code:s.code,token,participant_id:"M",state:publicCouplesState(s,"M")});
});

app.post("/api/couples/:code/end", (req, res) => {
  const s=getCouplesSession(req.params.code); if(!s)return res.status(404).json({error:"This Couples Live session is no longer available."});
  const p=couplesParticipantFromRequest(s,req); if(!p)return res.status(401).json({error:"This browser is not authorized for that session."});
  if(!isCoupleParticipant(p))return res.status(403).json({error:"Only the two participants can end the active session."});
  if(s.sessionEndedAt)return res.json({ok:true,state:publicCouplesState(s,p.id)});
  s.sessionEndedAt=new Date().toISOString(); s.sessionEndReason=`ended_early_by_${p.id}`; s.timerEndsAt=s.sessionEndedAt; s.turn=null;
  if(s.topic && ["open","awaiting_confirmation"].includes(s.topic.status)){s.topic.status="session_ended_early";s.topic.closedAt=s.sessionEndedAt;}
  if(openai && s.messages.length>=2 && !s.finalInsightsRequested){s.finalInsightsRequested=true;void(async()=>{try{const result=await runCouplesOverview(s);s.insights={...result,created_at:new Date().toISOString(),automatic:true};}catch(err){console.error("Couples Live early-end insights error:",err);}finally{touchCouplesSession(s);}})();}
  touchCouplesSession(s); res.json({ok:true,state:publicCouplesState(s,p.id)});
});

app.post("/api/couples/:code/continue", (req, res) => {
  const s=getCouplesSession(req.params.code); if(!s)return res.status(404).json({error:"This Couples Live session is no longer available."});
  const p=couplesParticipantFromRequest(s,req); if(!p)return res.status(401).json({error:"This browser is not authorized for that session."});
  if(p.id!=="A")return res.status(403).json({error:"Only the person who created the current room can create the continuation room."});
  maybeExpireCouplesSession(s);
  const topic=s.topic; if(!topic)return res.status(400).json({error:"There is no topic to continue."});
  if(!s.sessionEndedAt && !["partially_resolved","unresolved_more_evidence","unresolved_value_preference","deferred_mutual","time_expired"].includes(topic.status))return res.status(409).json({error:"Close the topic as unresolved/partial/deferred or wait for the session to end before carrying it forward."});
  const outcome=buildCouplesOutcome(s); const carryover=normalizeIssueCarryover({source_session:s.code,id:`topic:${topic.id}`,topic:topic.text,current_status:topic.status,participant_positions:outcome.participant_positions,agreed_points:outcome.common_ground,disputed_points:outcome.still_disputed,agreements:outcome.agreements_reached,evidence:(s.evidence||[]).slice(-12).map(x=>({type:x.type,relation:x.relation,description:x.description})),missing_evidence:outcome.suggested_next_questions,suggested_next_questions:outcome.suggested_next_questions});
  const made=makeCouplesSession({name:p.name,topic:topic.text,resolutionCriteria:topic.resolutionCriteria||"",carryover,durationMinutes:normalizeCouplesDurationMinutes(s.durationMinutes),legalAck:{accepted:true,version:p.legalDisclaimerVersion||LEGAL_DISCLAIMER_VERSION,accepted_at:p.legalAcknowledgedAt||s.createdAt},saveSession:durableCouplesSession(s)});
  const now=new Date().toISOString();
  made.session.agreements=(s.agreements||[]).filter(x=>x.status==="agreed"&&!x.supersededBy).map(x=>{const id=`a-${Date.now()}-${randomBytes(3).toString("hex")}`;return {id,text:x.text,kind:x.kind||"general",rootId:x.rootId||x.id,version:Number(x.version||1),parentId:"",supersededBy:"",supersededAt:null,status:"agreed",proposedBy:"A",createdAt:now,responses:{A:{decision:"agree",at:now},B:{decision:"agree",at:now}},carriedFrom:s.code,carriedFromAgreement:x.id};});
  made.session.claimLedger=(s.claimLedger||[]).filter(x=>!["established"].includes(x.status)&&!["conceded","withdrawn"].includes(x.lifecycle)).map(x=>({...x,id:`c-${Date.now()}-${randomBytes(3).toString("hex")}`,key:claimKey(x.text),createdAt:now,updatedAt:now,history:[{messageId:"",senderId:"",lifecycle:"unclear",status:x.status||"unknown",explanation:`Carried forward from session ${s.code}.`,at:now}]}));
  touchCouplesSession(made.session);
  res.json({code:made.session.code,token:made.token,participant_id:"A",state:publicCouplesState(made.session,"A")});
});

function couplesExportObject(s, viewerId = "") {
  return {
    app: "ClearSay",
    tagline: "Claim. Clarify. Connect.",
    version: "1.9.2",
    session_code: s.code,
    storage_mode: durableCouplesSession(s) ? "saved" : "temporary",
    created_at: s.createdAt,
    session_minutes: normalizeCouplesDurationMinutes(s.durationMinutes),
    max_active_ms: Number(s.maxActiveMs || normalizeCouplesDurationMinutes(s.durationMinutes) * 60 * 1000),
    timer_started_at: s.timerStartedAt,
    timer_ends_at: s.timerEndsAt,
    session_ended_at: s.sessionEndedAt,
    session_end_reason: s.sessionEndReason,
    turn_seconds: Math.round(COUPLES_TURN_MS / 1000),
    turn_control: s.turn ? { active_speaker:s.turn.activeSpeaker, turn_number:s.turn.turnNumber, status:s.turn.status, started_at:s.turn.startedAt, ends_at:s.turn.endsAt, last_reason:s.turn.lastReason } : null,
    topic_engagement: couplesTopicEngagement(s),
    participants: Object.fromEntries(["A","B"].map(id => [id, s.participants[id] ? { name: s.participants[id].name, joined_at: s.participants[id].joinedAt, legal_disclaimer_version:s.participants[id].legalDisclaimerVersion || null, legal_acknowledged_at:s.participants[id].legalAcknowledgedAt || null } : null])),
    legal_notice: { disclaimer_version: LEGAL_DISCLAIMER_VERSION, acknowledgement_records: (s.auditRecords || []).filter(x => x.recordType === "legal_acknowledgement") },
    audit_records: s.auditRecords || [],
    current_topic: publicTopic(s.topic),
    topic_history: (s.topicHistory || []).map(publicTopic),
    parking_lot: s.parkingLot || [],
    claim_ledger: s.claimLedger || [],
    agreements: s.agreements || [],
    evidence: s.evidence || [],
    carryover: s.carryover || null,
    unresolved_issues: buildCouplesUnresolvedIssues(s),
    mediator: s.mediator ? { enabled:s.mediator.enabled, consent:s.mediator.consent, participant:s.mediator.participant ? { name:s.mediator.participant.name, joinedAt:s.mediator.participant.joinedAt } : null } : null,
    outcome: buildCouplesOutcome(s),
    messages: s.messages.map(m => ({ id:m.id, sender_id:m.senderId, sender_name:m.senderName, text:m.text, created_at:m.createdAt, analysis_status:m.analysisStatus, shared_analysis:publicSharedCouplesAnalysis(m.analysis), private_analysis:viewerId===m.senderId ? (m.analysis || null) : null })),
    insights: s.insights || null,
    scope_note: "This export records messages sent through this room and AI analysis of those messages. It does not independently verify outside events described by participants."
  };
}

app.get("/api/couples/:code/export", (req, res) => {
  const s = getCouplesSession(req.params.code);
  if (!s) return res.status(404).json({ error: "This Couples Live session is no longer available." });
  const p = couplesParticipantFromRequest(s, req);
  if (!p) return res.status(401).json({ error: "This browser is not authorized for that session." });
  maybeExpireCouplesSession(s);
  const format = String(req.query?.format || "json").toLowerCase();
  if (format === "txt") {
    const lines = [
      "ClearSay — Couples Live Conversation",
      "Claim. Clarify. Connect.",
      "",
      "LEGAL ACKNOWLEDGMENT RECORDS",
      ...(s.auditRecords || []).filter(x => x.recordType === "legal_acknowledgement").map(x => `[${x.acceptedAt}] ${x.participantName || `Person ${x.participantId}`} acknowledged ${x.disclaimerVersion}.`),
      "",
      `Session: ${s.code}`,
      `Topic: ${s.topic?.text || ""}`,
      `Topic status: ${s.topic?.status || "unknown"}`,
      "",
      "CLOSURE AGREEMENT",
      ...(s.topic?.closureAgreement ? [`Status: ${s.topic.closureAgreement.status}`, `Proposed topic status: ${s.topic.closureAgreement.proposedStatus}`, `Resolved: ${s.topic.closureAgreement.resolvedSummary||""}`, `Still open: ${s.topic.closureAgreement.remainsOpen||""}`, `Next step: ${s.topic.closureAgreement.nextStep||""}`, `Repair completion: ${s.topic.closureAgreement.repairCompletion||"unclear"}`] : ["None proposed."]),
      "",
      "ACTIVE MUTUALLY ACCEPTED AGREEMENTS / REPAIR STANDARDS",
      ...((s.agreements||[]).filter(x=>x.status==="agreed"&&!x.supersededBy).map(x=>`[${x.kind||"general"} v${Number(x.version||1)}] ${x.text}`)),
      ...(((s.agreements||[]).filter(x=>x.status==="agreed"&&!x.supersededBy).length)?[]:["None recorded."]),
      "",
      "PENDING OR DISPUTED REPLACEMENT PROPOSALS",
      ...((s.agreements||[]).filter(x=>x.parentId&&["pending","disputed"].includes(x.status)).map(x=>`[v${Number(x.version||1)} ${x.status}] ${x.text}`)),
      ...(((s.agreements||[]).filter(x=>x.parentId&&["pending","disputed"].includes(x.status)).length)?[]:["None."]),
      "",
      ...s.messages.flatMap(m => [`[${m.createdAt}] ${m.senderName}:`, m.text, ""]),
      "Scope: Messages sent through this room only."
    ];
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="ClearSay_${s.code}_Conversation.txt"`);
    return res.send(lines.join("\n"));
  }
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="ClearSay_${s.code}_Full_Session.json"`);
  res.send(JSON.stringify(couplesExportObject(s, p.id), null, 2));
});

app.post("/api/couples/:code/insights", limiter, async (req, res) => {
  try {
    const s = getCouplesSession(req.params.code);
    if (!s) return res.status(404).json({ error: "This Couples Live session is no longer available." });
    const p = couplesParticipantFromRequest(s, req);
    if (!p) return res.status(401).json({ error: "This browser is not authorized for that session." });
    if (!isCoupleParticipant(p)) return res.status(403).json({ error: "Therapist / mediator access is read-only. Participants can generate Conversation Insights for the shared room." });
    maybeExpireCouplesSession(s);
    if (s.messages.length < 2) return res.status(400).json({ error: "Send at least two messages before building conversation insights." });
    const result = await runCouplesOverview(s);
    s.insights = { ...result, created_at: new Date().toISOString() };
    touchCouplesSession(s);
    res.json(s.insights);
  } catch (err) {
    console.error("Couples Live overview error:", err);
    const status = err?.status && Number.isInteger(err.status) ? err.status : 500;
    res.status(status).json({ error: err?.message || "Unable to build conversation insights." });
  }
});

app.delete("/api/couples/:code", (req, res) => {
  const s = getCouplesSession(req.params.code);
  if (!s) return res.status(404).json({ error: "This Couples Live session is no longer available." });
  const p = couplesParticipantFromRequest(s, req);
  if (!p) return res.status(401).json({ error: "This browser is not authorized for that session." });
  if (p.id !== "A") return res.status(403).json({ error: "Only the person who created the session can end the room." });
  couplesSessions.delete(s.code);
  if (durableCouplesSession(s)) queuePersistCouplesSessions();
  res.json({ ok: true });
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    ai_configured: Boolean(process.env.OPENAI_API_KEY),
    model: MODEL,
    fallacies: fallacies.length,
    claim_identifiers: 12,
    repair_status_branch: true,
    repair_evidence_mapping: true,
    selectable_claim_types: true,
    transcript_option: true,
    transcript_mode: "candidate-discovery-plus-context-audit-plus-whole-transcript-audit-plus-conversation-intelligence",
    transcript_audit_pass: true,
    transcript_audit_version: TRANSCRIPT_AUDIT_VERSION,
    transcript_context_audit: true,
    transcript_context_audit_version: TRANSCRIPT_CONTEXT_AUDIT_VERSION,
    transcript_whole_transcript_audit: true,
    transcript_whole_transcript_audit_version: TRANSCRIPT_GLOBAL_AUDIT_VERSION,
    transcript_supported_complaint_layer: true,
    transcript_four_layer_breakdown: true,
    transcript_claim_evolution: true,
    transcript_evidence_graph: true,
    transcript_conversation_pattern_analysis: true,
    transcript_intelligence_version: TRANSCRIPT_INTELLIGENCE_VERSION,
    transcript_context_change_explanations: true,
    transcript_audit_confidence_scores: ["pattern","claim","transcript"],
    transcript_audit_raw_counts_hidden_from_final_verdict: true,
    reasoning_engine_v2: true,
    evidence_quality: true,
    agreement_layer: true,
    agreement_verification: true,
    unilateral_agreement_change_tracking: true,
    contradiction_check: true,
    analysis_history: "browser-local",
    response_self_check: true,
    quick_live_session: true,
    quick_live_alternative_responses: true,
    response_target_selector: true,
    therapist_directed_responses: true,
    quick_live_clear_session: true,
    quick_live_response_first_ui: true,
    quick_live_collapsed_hierarchy: true,
    quick_live_qualifying_questions_target: "other_person_only",
    quick_live_session_storage: "browser-local",
    couples_live: true,
    couples_live_analysis_timing: "post-send",
    couples_live_session_codes: true,
    couples_live_shared_analysis: true,
    couples_live_topic_lock: true,
    couples_live_topic_confirmation: true,
    couples_live_parking_lot: true,
    couples_live_duration_options_minutes: [15,30,45,60],
    couples_live_default_minutes: COUPLES_DEFAULT_MINUTES,
    couples_live_end_early: true,
    couples_live_export: ["txt","json","print-pdf"],
    couples_live_private_vs_shared_analysis: true,
    couples_live_claim_ledger: true,
    couples_live_mutual_agreements: true,
    couples_live_agreement_lineage: true,
    couples_live_agreement_versioning: true,
    couples_live_closure_agreement: true,
    definition_collision_detection: true,
    current_behavior_historical_injury_split: true,
    couples_live_repair_standard_lock: true,
    couples_live_mutual_replacement_only: true,
    couples_live_no_retroactive_repair_rewrite: true,
    couples_live_evidence_notes: true,
    couples_live_resolution_criteria: true,
    couples_live_continuations: true,
    couples_live_durable_session_storage: true,
    couples_live_saved_sessions_survive_restart: true,
    couples_live_temporary_mode: true,
    couples_live_persistent_store_path: COUPLES_STORE_PATH,
    transcript_browser_autosave: true,
        couples_live_unresolved_issue_hub: true,
    couples_live_start_session_from_unresolved_issue: true,
    couples_live_prior_context_marked_historical: true,
    couples_live_optional_readonly_mediator: true,
    couples_live_participant_consent: true,
    couples_live_text_invites: true,
    couples_live_prefilled_invite_links: true,
    couples_live_combined_invite_copy: true,
    couples_live_turn_lock: true,
    couples_live_turn_seconds: 60,
    couples_live_no_inactive_drafting: true,
    couples_live_repeated_irrelevance_guidance: true,
    couples_live_storage: "saved-persistent-disk-or-temporary-memory",
    brand: "ClearSay",
    tagline: "Claim. Clarify. Connect.",
    legal_acknowledgement_required: true,
    legal_disclaimer_version: LEGAL_DISCLAIMER_VERSION,
    legal_acknowledgement_first_record: true,
    legal_acknowledgement_every_launch: true,
    landing_intro_gate: true,
    landing_how_it_works: true,
    landing_fit_guidance: true,
    terms_page: true,
    light_dark_system_mode: true,
    payments_foundation: true,
    payments_enabled: PAYMENTS_ENABLED,
    payments_required: PAYMENTS_REQUIRED && BILLING_CONFIGURED,
    payments_configured: BILLING_CONFIGURED,
    payment_provider: "stripe_checkout",
    screenshot_upload_import: true,
    screenshot_transcription_model: SCREENSHOT_MODEL,
    screenshot_max_images: SCREENSHOT_MAX_IMAGES,
    apple_pay_ready: BILLING_CONFIGURED,
    session_overview: true,
    app_version: "1.9.2",
    mode: "local-keyword-first-routing",
    candidate_limit: CANDIDATE_LIMIT
  });
});

// Debug/inspection endpoint: searches all 100 traps locally and uses zero AI tokens.
app.post("/api/route", (req, res) => {
  const claim = typeof req.body?.claim === "string" ? req.body.claim.trim().slice(0, 1800) : "";
  const context = typeof req.body?.context === "string" ? req.body.context.trim().slice(0, 2200) : "";
  if (!claim) return res.status(400).json({ error: "Enter a claim first." });
  const forced = Array.isArray(req.body?.forced_claim_types) ? req.body.forced_claim_types : [];
  const routing = selectCandidates(`${claim}\n${context}`, CANDIDATE_LIMIT);
  const detectedClaimTypes = routing.claimTypes;
  const claimTypes = mergeForcedClaimTypes(detectedClaimTypes, forced);
  res.json({
    detected_claim_types: detectedClaimTypes,
    claim_types: claimTypes,
    likely_groups: routing.selectedGroups,
    qualifying_questions: buildClaimQualifiers(claimTypes, `${claim}\n${context}`),
    candidates: routing.candidates.map(({ f, score, matches }) => ({
      id: f.id, name: f.name, group: f.group, local_score: Math.round(score),
      matched_signals: matches, clarify_questions: f.clarify_questions,
      challenge_questions: f.challenge_questions, responses: f.responses
    }))
  });
});

async function runAnalysis(v, candidateLimit = CANDIDATE_LIMIT, maxOutput = 2300) {
  const combinedForRouting = [v.claim, v.context, ...v.answers.map(a => `${a.question} ${a.answer}`)].join("\n");
  const routing = selectCandidates(combinedForRouting, candidateLimit);
  const answerText = v.answers.length
    ? v.answers.map((a, i) => `${i+1}. ${a.question}\nA: ${a.answer}`).join("\n")
    : "None yet.";

  const candidateCatalog = JSON.stringify(compactCandidateCatalog(routing.candidates));
  const dynamicRules = buildDynamicRules(routing.claimTypes);

  const input = `CLAIM-SPECIFIC RULES:
${dynamicRules || "Use the core rules."}

LOCAL ROUTING HINT (not a verdict):
Claim types: ${routing.claimTypes.join(", ")}
Likely groups: ${routing.selectedGroups.join(", ")}

CANDIDATE FALLACIES FOR THIS REQUEST:
${candidateCatalog}

EXACT CLAIM:
${v.claim}

OPTIONAL CONTEXT (not automatically fact):
${v.context || "None."}

CLARIFYING ANSWERS:
${answerText}

ROUND: ${v.round}

TASK:
1. Decompose the claim and assign an overall claim status.
2. Assess evidence quality and whether stated certainty fits the support supplied.
3. Map the reasoning bridge and any premise-to-conclusion dependencies.
4. Test contradictions/tensions, counterexamples, agreements, and frequency vs severity only when applicable. For an agreement claim, separately determine: whether a shared agreement existed, the original terms, whether both people assented to those terms, whether the agreement was temporary/conditional, whether the original terms were fulfilled, and whether any later change was mutual, unilateral, disputed, or simply an agreed expiration. A unilateral change does not retroactively alter the original terms. A later new need can be valid without proving that the original agreement was never fulfilled. Set retroactive_standard_issue=true only when later requirements are being used to redefine the prior agreement after the fact; describe it as a possible standard-shift issue, not automatically a fallacy.
5. If this is a repair-status claim, build repair_evidence_mapping. Treat each behavioral or feeling statement as a premise and state exactly what it supports about repair. A continuing feeling can establish unresolved emotional impact without proving zero repair. Recurrence of the same behavior targeted by repair can directly undermine behavioral repair. A different behavior must not be treated as direct proof unless the connection is explained. If repair was defined by an earlier agreement or repair standard, judge fulfillment under the mutually accepted terms that actually applied at the time, then evaluate any later change separately.
6. If up to 3 answers could materially change the result, ask only those questions and use needs_clarification.
7. Otherwise use analysis_ready. No clear fallacy and insufficient information are both valid outcomes.
8. Choose 0–3 fallacy IDs only from the candidate catalog; never force a match.
9. State who bears the current burden of support and what would materially change the result.
10. Identify what kind of disagreement remains if the reasoning is otherwise sound.
11. For intent, separate impact, foreseeability, recklessness, and intended outcome.
12. Give concise, natural wording and a non-combative best response addressed to the OTHER PERSON who made the claim.
13. Also provide four distinct, short OTHER-PERSON response alternatives: clarify the claim, ask for relevant evidence, state the reasoning distinction directly, and de-escalate while preserving the distinction. These are conversation options, not verdicts.
14. Also produce a THERAPIST-DIRECTED best response plus the same four styles. Therapist-directed wording should ask the therapist/facilitator to structure the discussion fairly: clarify the claim, separate facts/feelings/intent/repair/agreement terms, verify whether later changes were mutual or unilateral, identify relevant evidence, or test the reasoning bridge. It must not ask the therapist to take sides, endorse disputed facts, diagnose either person, or treat the app's assessment as a verdict.`

  const response = await openai.responses.create({
    model: MODEL,
    reasoning: { effort: "low" },
    instructions: CORE_INSTRUCTIONS,
    input,
    store: false,
    max_output_tokens: maxOutput,
    prompt_cache_key: "fallacy-finder-core-v10",
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


function normalizeLiveSessionTurns(rawTurns) {
  if (!Array.isArray(rawTurns)) return [];
  return rawTurns.slice(0, 100).map((t, i) => ({
    index: Math.max(1, Math.min(Number(t?.index) || i + 1, 999)),
    statement: String(t?.statement || "").trim().slice(0, 900),
    response_status: ["used","modified","not_used","pending"].includes(t?.response_status) ? t.response_status : "pending",
    confirmed_response: String(t?.confirmed_response || "").trim().slice(0, 800),
    analysis_summary: String(t?.analysis_summary || "").trim().slice(0, 500),
    verdict: String(t?.verdict || "").trim().slice(0, 80),
    fallacies: Array.isArray(t?.fallacies) ? t.fallacies.slice(0, 3).map(x => String(x).slice(0, 80)) : [],
    repair_status: String(t?.repair_status || "").trim().slice(0, 80),
    agreement_status: String(t?.agreement_status || "").trim().slice(0, 220),
    response_target: ["other_person","therapist"].includes(t?.response_target) ? t.response_target : "other_person"
  })).filter(t => t.statement);
}

function buildLiveSessionDigest(turns) {
  // Keep every entered statement represented. Older/longer sessions are compacted
  // rather than silently dropping early turns.
  const format = (t, statementLimit, summaryLimit, replyLimit) => {
    const parts = [`TURN ${t.index} — THEM: ${t.statement.slice(0, statementLimit)}`];
    if (t.analysis_summary) parts.push(`INDIVIDUAL ANALYSIS: ${t.analysis_summary.slice(0, summaryLimit)}`);
    if (t.verdict) parts.push(`VERDICT: ${t.verdict}`);
    if (t.fallacies.length) parts.push(`REASONING TRAPS CONSIDERED: ${t.fallacies.join(", ")}`);
    if (t.repair_status) parts.push(`REPAIR STATUS: ${t.repair_status}`);
    if (t.agreement_status) parts.push(`AGREEMENT STATUS: ${t.agreement_status}`);
    if ((t.response_status === "used" || t.response_status === "modified") && t.confirmed_response) {
      parts.push(`YOU (${t.response_status === "used" ? "confirmed app response" : "confirmed modified response"}, addressed to ${t.response_target === "therapist" ? "THERAPIST" : "OTHER PERSON"}): ${t.confirmed_response.slice(0, replyLimit)}`);
    } else if (t.response_status === "not_used") {
      parts.push("APP RESPONSE WAS NOT USED.");
    }
    return parts.join(" | ");
  };
  let lines = turns.map(t => format(t, 360, 240, 300));
  let digest = lines.join("\n");
  if (digest.length > 24000) {
    lines = turns.map(t => format(t, 220, 150, 180));
    digest = lines.join("\n");
  }
  if (digest.length > 24000) {
    lines = turns.map(t => `TURN ${t.index} — THEM: ${t.statement.slice(0, 140)}${t.analysis_summary ? ` | ANALYSIS: ${t.analysis_summary.slice(0, 100)}` : ""}${(t.response_status === "used" || t.response_status === "modified") && t.confirmed_response ? ` | YOU TO ${t.response_target === "therapist" ? "THERAPIST" : "OTHER PERSON"}: ${t.confirmed_response.slice(0, 100)}` : ""}`);
    digest = lines.join("\n");
  }
  return digest.slice(0, 30000);
}

app.post("/api/session/analyze", async (req, res) => {
  try {
    if (!openai) return res.status(503).json({ error: "OPENAI_API_KEY is not configured on the server." });
    const turns = normalizeLiveSessionTurns(req.body?.turns);
    if (turns.length < 2) return res.status(400).json({ error: "Analyze at least two statements before requesting a session overview." });
    const contextNote = typeof req.body?.context_note === "string" ? req.body.context_note.trim().slice(0, 1800) : "";
    const digest = buildLiveSessionDigest(turns);
    const input = `QUICK LIVE SESSION — INCOMPLETE CONVERSATION RECORD
This is NOT a complete transcript. The user entered the other person's important statements in real time. The user's side appears only when they explicitly confirmed using an app response or entered a modified response. Missing turns may materially change the analysis.

OPTIONAL USER-SUPPLIED SESSION CONTEXT:
${contextNote || "None."}

ENTERED SESSION SEQUENCE:
${digest}

TASK:
1. Give an overall analysis of how the entered claims relate across the session. Do not score who won or count fallacies by person.
2. Distinguish common ground/support from disputed, inferred, or unknown points.
3. Identify when a later statement narrows, changes, contradicts, concedes, or strengthens an earlier claim.
4. Identify recurring reasoning patterns only when supported by multiple entered turns. A fallacy label from an earlier individual analysis is context, not proof.
5. If an agreement is central, separate the original agreement from any later change. Identify whether both people accepted the original terms, whether those terms were fulfilled, and whether a later change was mutual, unilateral, disputed, or the result of an agreed expiration/condition. Do not retroactively rewrite the original agreement because a later need or standard appeared.
6. If repair is a central issue, keep behavioral repair and emotional resolution separate. Continuing pain does not by itself prove zero repair; a repair effort does not by itself prove complete repair. If repair depended on agreed criteria, evaluate those original criteria separately from later changes.
7. Treat user-entered statements as reported statements, not independently verified facts. Treat confirmed app responses only as what the user reports they actually said.
8. State the current type of disagreement and the best next clarifying questions.
9. Make the scope limitation prominent and calibrate confidence to the incompleteness of the record.`;

    const response = await openai.responses.create({
      model: MODEL,
      reasoning: { effort: "low" },
      instructions: CORE_INSTRUCTIONS,
      input,
      store: false,
      max_output_tokens: 1600,
      prompt_cache_key: "fallacy-finder-live-session-v2",
      text: {
        verbosity: "low",
        format: { type: "json_schema", name: "fallacy_finder_session_overview", strict: true, schema: sessionOverviewSchema }
      }
    });
    if (!response.output_text) throw new Error("The model returned no structured session overview.");
    const analysis = JSON.parse(response.output_text);
    return res.json({
      analysis,
      meta: {
        model: response.model || MODEL,
        usage: response.usage || null,
        estimated_cost_usd: estimateCost(response.usage),
        turns_included: turns.length,
        scope: "entered-statements-and-confirmed-responses-only"
      }
    });
  } catch (err) {
    console.error("Session overview error:", err);
    const status = err?.status && Number.isInteger(err.status) ? err.status : 500;
    let message = err?.message || "Session overview failed.";
    if (status === 429 && /tokens per min|tpm|request too large/i.test(message)) {
      message = "This session overview exceeded the API token-per-minute limit. The individual statement analyses are still available; try the overview again after a short wait.";
    }
    return res.status(status).json({ error: message });
  }
});

app.post("/api/transcript/extract", async (req, res) => {
  try {
    const transcript = typeof req.body?.transcript === "string" ? req.body.transcript.trim() : "";
    if (!transcript) return res.status(400).json({ error: "Paste a transcript first." });
    if (transcript.length > TRANSCRIPT_MAX_CHARS) return res.status(400).json({ error: `Please keep one transcript under ${TRANSCRIPT_MAX_CHARS.toLocaleString()} characters.` });

    const { turns, claims } = extractTranscriptClaimsLocal(transcript);
    const speakers = [...new Set(claims.map(c => c.speaker).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
    const claimTypes = [...new Set(claims.flatMap(c => c.claim_types || []))];
    return res.json({
      summary: `Found ${claims.length} likely analyzable statement${claims.length === 1 ? "" : "s"} across ${turns.length} transcript turn${turns.length === 1 ? "" : "s"}. Browse, search, or filter them, then send only the statement you choose into the full AI analysis.`,
      claims,
      speakers,
      claim_types: claimTypes,
      extraction_mode: "local_all_claims",
      ai_tokens_used_for_extraction: 0
    });
  } catch (err) {
    console.error("Transcript extraction error:", err);
    return res.status(500).json({ error: err?.message || "Transcript extraction failed." });
  }
});

app.post("/api/transcript/audit", async (req, res) => {
  try {
    const transcript = typeof req.body?.transcript === "string" ? req.body.transcript.trim() : "";
    if (!transcript) return res.status(400).json({ error: "Paste a transcript first." });
    if (transcript.length > TRANSCRIPT_MAX_CHARS) return res.status(400).json({ error: `Please keep one transcript under ${TRANSCRIPT_MAX_CHARS.toLocaleString()} characters.` });
    if (!openai) return res.status(503).json({ error: "OPENAI_API_KEY is not configured on the server." });

    const { turns, claims } = extractTranscriptClaimsLocal(transcript);
    if (!claims.length) return res.json({
      audit_version: TRANSCRIPT_GLOBAL_AUDIT_VERSION,
      context_audit_version: TRANSCRIPT_CONTEXT_AUDIT_VERSION,
      intelligence_version: TRANSCRIPT_INTELLIGENCE_VERSION,
      summary: summarizeTranscriptAudit([], 0), items: [], context_items: [], speakers: [], intelligence: null,
      note: "No analyzable statement candidates were found in this transcript.",
      meta: { context_chunks:0, global_chunks:0, turns:turns.length, ai_calls:0, estimated_cost_usd:0 }
    });

    // Stage 1: Context Audit — exact wording + nearby exchange.
    const contextChunks = buildTranscriptAuditChunks(claims);
    const contextRaw=[]; const contextMeta=[];
    for(const chunk of contextChunks){const result=await runTranscriptAuditChunk(chunk);contextRaw.push(...result.results);contextMeta.push(...result.meta);}
    const sourceByIndex=new Map(claims.map((c,i)=>[i+1,c]));
    const contextItems=contextRaw.map(item=>{
      const source=sourceByIndex.get(item.source_index)||{};
      return{...item,speaker:source.speaker||"Speaker",exact_quote:source.exact_claim||"",nearby_context:source.nearby_context||"",turn_index:source.turn_index||item.source_index,claim_types:source.claim_types||[],local_candidates:source.local_candidates||[],relation:source.relation||""};
    }).sort((a,b)=>a.source_index-b.source_index);

    // Stage 2: Whole-Transcript Audit — search the entire conversation for evidence/counterevidence.
    const globalChunks=buildGlobalAuditChunks(claims,contextItems,turns);
    const globalRaw=[]; const globalMeta=[];
    for(const chunk of globalChunks){const result=await runGlobalAuditChunk(chunk);globalRaw.push(...result.results);globalMeta.push(...result.meta);}
    const contextByIndex=new Map(contextItems.map(x=>[x.source_index,x]));
    const finalItems=globalRaw.map(item=>{
      const source=sourceByIndex.get(item.source_index)||{};const local=contextByIndex.get(item.source_index)||{};
      const globalEvidence=globalEvidenceForClaim(source,turns,12);
      return{...item,speaker:source.speaker||"Speaker",exact_quote:source.exact_claim||"",nearby_context:source.nearby_context||"",turn_index:source.turn_index||item.source_index,claim_types:source.claim_types||[],local_candidates:source.local_candidates||[],relation:source.relation||"",context_audit:{audit_status:local.audit_status||"candidate",patterns:local.patterns||[],pattern_confidence:local.pattern_confidence||0,claim_confidence:local.claim_confidence||0,transcript_confidence:local.transcript_confidence||0,audit_reason:local.audit_reason||"",claim_support:local.claim_support||""},global_evidence:globalEvidence,pattern_confidence_band:confidenceBand(item.pattern_confidence),claim_confidence_band:confidenceBand(item.claim_confidence),transcript_confidence_band:confidenceBand(item.transcript_confidence)};
    }).sort((a,b)=>a.source_index-b.source_index);

    // Stage 3: Conversation Pattern Analysis.
    const intelligenceResult=await runConversationIntelligence(transcript,turns,finalItems);
    const summary=summarizeTranscriptAudit(finalItems,claims.length);
    const changedByGlobal=finalItems.filter(x=>x.context_changed).length;
    const supportedConcerns=finalItems.filter(x=>["supported","partially_supported"].includes(x.underlying_concern)).length;
    const allMeta=[...contextMeta,...globalMeta,intelligenceResult.meta];
    const totalCost=allMeta.reduce((sum,m)=>sum+(Number(m?.estimated_cost_usd)||0),0);
    const usage=allMeta.reduce((a,m)=>{const u=m?.usage||{};a.input_tokens+=Number(u.input_tokens)||0;a.output_tokens+=Number(u.output_tokens)||0;a.total_tokens+=Number(u.total_tokens)||0;return a;},{input_tokens:0,output_tokens:0,total_tokens:0});

    return res.json({
      audit_version:TRANSCRIPT_GLOBAL_AUDIT_VERSION,
      context_audit_version:TRANSCRIPT_CONTEXT_AUDIT_VERSION,
      intelligence_version:TRANSCRIPT_INTELLIGENCE_VERSION,
      audit_pipeline:["candidate_discovery","context_audit","whole_transcript_audit","conversation_pattern_analysis"],
      summary:{...summary,changed_by_whole_transcript_audit:changedByGlobal,supported_or_partially_supported_concerns:supportedConcerns},
      context_items:contextItems,
      items:finalItems,
      intelligence:intelligenceResult.analysis,
      speakers:summary.speakers.map(s=>s.speaker),
      note:"Final counts come from the Whole-Transcript Audit. Counts are reasoning alerts, not fault scores. A supported underlying complaint can coexist with an overbroad reasoning extension.",
      confidence_legend:{pattern:"How sure ClearSay is that the final reasoning pattern is actually present.",claim:"How strongly the full transcript supports the underlying conclusion being asserted.",transcript:"How reliable the wording, speaker attribution, and relevant context appear from the transcript text."},
      meta:{context_chunks:contextChunks.length,global_chunks:globalChunks.length,turns:turns.length,ai_calls:allMeta.length,usage,estimated_cost_usd:Number(totalCost.toFixed(6)),intelligence_compact_retry:Boolean(intelligenceResult.meta?.compact_retry)}
    });
  } catch (err) {
    console.error("Transcript conversation-intelligence audit error:", err);
    const status = err?.status && Number.isInteger(err.status) ? err.status : 500;
    let message = err?.message || "Transcript audit failed.";
    if (status === 429 && /tokens per min|tpm|request too large/i.test(message)) message = "The full transcript audit exceeded the current API rate/token limit. ClearSay preserved the local extraction; retry the audit when the API limit allows.";
    return res.status(status).json({ error: message });
  }
});

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
      const result = await runAnalysis(v, 5, 1600);
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
  console.log(`ClearSay running on port ${PORT} with ${MODEL} (Fallacy Finder reasoning engine, efficient routing, max ${CANDIDATE_LIMIT} candidates)`);
});
