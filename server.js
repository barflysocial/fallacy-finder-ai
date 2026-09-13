import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import OpenAI from "openai";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;
const MODEL = process.env.OPENAI_MODEL || "gpt-5.6-terra";
const CANDIDATE_LIMIT = Math.max(5, Math.min(Number(process.env.CANDIDATE_LIMIT) || 8, 12));
const LEGAL_DISCLAIMER_VERSION = "clearsay-legal-2026-09-13-v1";

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
  repair_status: `REPAIR STATUS: use only when the claim is about whether an injury, broken agreement, or rupture has been adequately addressed. Separate observable repair actions from subjective resolution. Evaluate acknowledgment, appropriate responsibility, concrete correction/restitution, behavior change, agreed repair standards, new agreements, ongoing consequences, and whether resolution is mutual or disputed. When an agreement or repair standard matters, verify what both people actually agreed to, whether the original terms were fulfilled, and whether any later change was mutual or unilateral. A later unilateral requirement can be a valid new request but does not by itself prove the original repair agreement was never fulfilled. Map every behavioral or feeling premise to the repair conclusion: continuing pain establishes unresolved emotional impact, not automatically zero repair; recurrence of the same behavior the repair was supposed to change is direct evidence against behavioral repair; a different current behavior may be only indirect or irrelevant. An apology alone does not prove complete repair; continuing hurt alone does not prove no repair occurred.`,
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
        type: { type: "string", enum: ["factual","interpretation","memory","value","preference","boundary","agreement","repair","insufficient_evidence","mixed","none_apparent"] },
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
  required: ["status","summary","reasoning_outcome","claim_status","claim_parts","evidence_assessment","claim_certainty","reasoning_bridge","claim_dependencies","contradictions","counterexample_test","agreement_status","severity_frequency","established_points","unresolved_points","questions","likely_fallacies","temporal_relevance","repair_status","repair_evidence_mapping","burden_of_proof","disagreement","what_would_change_result","better_wording","suggested_response","response_options","therapist_suggested_response","therapist_response_options","caution"]
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
    current_disagreement: {
      type: "object", additionalProperties: false,
      properties: {
        type: { type: "string", enum: ["factual","interpretation","memory","value","preference","boundary","agreement","repair","insufficient_evidence","mixed","none_apparent"] },
        explanation: { type: "string" }
      },
      required: ["type","explanation"]
    },
    next_best_questions: { type: "array", items: { type: "string" }, maxItems: 5 },
    caution: { type: "string" }
  },
  required: ["summary","scope_warning","main_issue","overall_confidence","common_ground","disputed_points","claim_evolution","reasoning_patterns","agreement_overview","repair_overview","current_disagreement","next_best_questions","caution"]
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
// Couples Live (v1.5.2)
// Two participants text normally. Messages are stored exactly as sent, then
// analyzed after sending. This beta uses server memory so it needs no new
// database dependency, but rooms are temporary and disappear on server restart.
// -----------------------------------------------------------------------------
const COUPLES_SESSION_TTL_MS = 6 * 60 * 60 * 1000;
const COUPLES_MAX_MESSAGES = 250;
const COUPLES_ALLOWED_MINUTES = new Set([15, 30, 45, 60]);
const COUPLES_DEFAULT_MINUTES = 30;
const COUPLES_TURN_MS = 60 * 1000;
const couplesSessions = new Map();

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
  required: ["summary","claim_types","claim_status","reasoning_outcome","evidence_assessment","likely_fallacies","conversation_effect","topic_relevance","common_ground_added","disputed_or_unresolved","underlying_issue","agreement_signal","repair_signal","claim_updates","useful_next_questions","caution"]
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
  s.expiresAt = Date.now() + COUPLES_SESSION_TTL_MS;
  s.revision = (s.revision || 0) + 1;
}

function getCouplesSession(code) {
  const key = String(code || "").trim().toUpperCase();
  const s = couplesSessions.get(key);
  if (!s) return null;
  if (Date.now() > s.expiresAt) {
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
    common_ground: insight?.common_ground || [],
    still_disputed: insight?.disputed_points || unresolvedLedger.map(x => x.text),
    agreements_reached: (s.agreements || []).filter(x => x.status === "agreed").map(x => x.text),
    evidence_added: (s.evidence || []).map(x => x.description).slice(-8),
    parked_topics: (s.parkingLot || []).map(x => x.text),
    suggested_next_questions: insight?.next_best_questions || [],
    main_issue: insight?.main_issue || "",
    topic_engagement: engagement,
    resolution_obstacle: engagement.notices.length ? "The active question may remain unresolved because several recent analyzed responses did not directly address it. This is a topic-relevance finding, not a conclusion about intent." : "",
    carry_forward_recommended: Boolean(topic && ["partially_resolved","unresolved_more_evidence","unresolved_value_preference","deferred_mutual","time_expired","session_ended_early"].includes(topic.status))
  };
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
    }
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
    agreements: (s.agreements || []).map(x => ({ id:x.id, text:x.text, status:x.status, proposed_by:x.proposedBy, created_at:x.createdAt, responses:{ A:x.responses?.A||null, B:x.responses?.B||null } })),
    evidence: (s.evidence || []).map(x => ({ id:x.id, claim_id:x.claimId||"", type:x.type, relation:x.relation, description:x.description, added_by:x.addedBy, created_at:x.createdAt })),
    carryover: s.carryover || null,
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
    temporary_storage: true
  };
}

function couplesContextDigest(s, currentMessageId = "") {
  const prior = s.messages.filter(m => m.id !== currentMessageId).slice(-18);
  const carry = s.carryover ? `CARRYOVER FROM PRIOR SESSION ${s.carryover.from_session}: common ground=${(s.carryover.common_ground||[]).join(" | ")}; unresolved=${(s.carryover.still_disputed||[]).join(" | ")}; agreements=${(s.carryover.agreements_reached||[]).join(" | ")}; evidence notes=${(s.carryover.evidence||[]).map(x=>x.description).join(" | ")}` : "";
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
  const input = `COUPLES LIVE — POST-SEND ANALYSIS\n\nThe message below has ALREADY been sent in a shared two-person conversation. Do not rewrite, soften, correct, or block it. Analyze it after the fact as a reasoning mirror. Apply exactly the same standards to both participants. Never score who is winning.\n\nCURRENT SESSION TOPIC:\n${s.topic?.text || "No topic supplied."}\nThe active topic does not automatically change just because someone raises another issue. A different issue can be identified for the parking lot, but it cannot replace the current topic until the current topic is formally closed.\n\nCLAIM-SPECIFIC RULES:\n${dynamicRules || "Use the core rules."}\n\nLOCAL ROUTING HINT:\nClaim types: ${routing.claimTypes.join(", ")}\nCandidate fallacies: ${candidateCatalog}\n\nPRIOR SENT MESSAGES IN THIS ROOM:\n${contextDigest || "No prior messages."}\n\nNEW SENT MESSAGE:\n${message.senderName}: ${message.text}\n\nTASK:\n1. Identify the meaningful claims in this message and how well the supplied conversation supports them. Keep summary, conversation_effect, topic_relevance, common_ground_added, disputed_or_unresolved, underlying_issue, agreement_signal, repair_signal, claim_updates, and caution neutral enough for a SHARED view. Do not name a fallacy in summary or those shared fields; fallacy names belong only in likely_fallacies, which is private to the message author.\n2. Analyze evidence quality. A participant stating something is evidence that they made/admitted that statement; it is not automatically independent proof of an underlying outside event.\n3. Choose 0–3 fallacy IDs only from the candidate catalog. No clear fallacy is a valid result.\n4. Compare this message with the prior room messages. Say whether it creates a new claim, supports, weakens, contradicts, clarifies, narrows, concedes, changes a standard, or does not materially change an earlier claim.\n5. Explicitly state whether the relevant claim becomes stronger, weaker, more precise, unchanged, or remains unclear, and why.\n6. Classify how the message relates to the CURRENT SESSION TOPIC as directly relevant, clarifying, supporting context, possible topic shift, unrelated issue, or unclear. Context can be relevant even when historical. Do not call every new fact a topic shift. A response can still be directly relevant when it disagrees with the premise, says the person does not know, or explains what information is missing. Never infer that an off-topic response was intentional avoidance. If a genuinely different issue is raised, summarize that issue in parked_issue so it can be saved for later without becoming the active topic.\n7. Track common ground and unresolved points when the new message actually changes them.\n8. If agreements are relevant, distinguish mutual terms, fulfillment, and later mutual vs unilateral changes. A unilateral later change does not retroactively rewrite an earlier mutual agreement.\n9. If repair is relevant, keep behavioral repair separate from emotional/trust resolution. Continuing pain does not by itself prove zero repair; changed behavior does not by itself prove emotional resolution.\n10. Identify the underlying issue the conversation appears to be moving toward, while preserving the current topic as the active question until it is formally closed.\n11. Produce claim_updates for the meaningful claims affected by this message. Mark explicit concessions, corrections, or withdrawals so an older claim is not left falsely active. Use lifecycle=new, supported, weakened, narrowed, clarified, conceded, corrected, withdrawn, unchanged, or unclear.\n12. Offer at most three useful questions that could clarify the issue. These are optional analysis notes, not pre-send rewrites.\n13. Do not diagnose either participant, assign personality labels, or infer abuse/intent beyond the evidence supplied.`;

  const response = await openai.responses.create({
    model: MODEL,
    reasoning: { effort: "low" },
    instructions: CORE_INSTRUCTIONS,
    input,
    store: false,
    max_output_tokens: 1800,
    prompt_cache_key: "fallacy-finder-couples-message-v3",
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
  const input = `COUPLES LIVE — SHARED CONVERSATION INSIGHTS\n\nThis is the actual text entered in this in-app room by ${names || "two participants"}. It is a complete record of messages sent THROUGH THIS ROOM, but it is not independent proof of outside events described in those messages. Apply identical reasoning standards to both participants. Do not count fallacies by person or declare a winner.\n\nACTIVE / MOST RECENT TOPIC:\n${s.topic?.text || "No topic supplied."}\nTopic status: ${s.topic?.status || "unknown"}\nResolution criteria: ${s.topic?.resolutionCriteria || "Not specified"}\n\nMUTUALLY CONFIRMED AGREEMENTS:\n${(s.agreements || []).filter(x=>x.status==="agreed").map(x=>`- ${x.text}`).join("\\n") || "None recorded."}\n\nPARTICIPANT-SUPPLIED EVIDENCE NOTES (not independently verified):\n${(s.evidence || []).map(x=>`- ${x.type}/${x.relation}: ${x.description}`).join("\\n") || "None recorded."}\n\nCLAIM LEDGER:\n${(s.claimLedger || []).map(x=>`- ${x.text} [${x.status}; ${x.lifecycle}]`).join("\\n") || "No ledger entries yet."}\n\nROOM MESSAGES:\n${digest}\n\nTASK:\n1. Identify the central underlying issue and current disagreement, anchored to the active/most recent session topic.\n2. Separate common ground from disputed, inferred, unsupported, or unknown claims.\n3. Show how important claims have strengthened, weakened, narrowed, changed, or been conceded as later messages supplied new information.\n4. Identify recurring reasoning patterns only when supported by multiple messages.\n5. If an agreement is central, verify original mutual terms, fulfillment, and whether later changes were mutual or unilateral.\n6. If repair is central, keep behavioral repair separate from emotional/trust resolution.\n7. Offer neutral next questions that could clarify or resolve the remaining issue.\n8. Focus on understanding and repair, not message rewriting, diagnosis, blame, or scoring.`;
  const response = await openai.responses.create({
    model: MODEL,
    reasoning: { effort: "low" },
    instructions: CORE_INSTRUCTIONS,
    input,
    store: false,
    max_output_tokens: 1700,
    prompt_cache_key: "fallacy-finder-couples-overview-v3",
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
  for (const [code, s] of couplesSessions) if (now > s.expiresAt) couplesSessions.delete(code);
}, 10 * 60 * 1000).unref?.();

function normalizeLegalAcknowledgement(value) {
  if (!value || value.accepted !== true) return null;
  if (String(value.version || "") !== LEGAL_DISCLAIMER_VERSION) return null;
  const acceptedAt = String(value.accepted_at || value.acceptedAt || "");
  const acceptedMs = Date.parse(acceptedAt);
  if (!Number.isFinite(acceptedMs)) return null;
  return { accepted: true, version: LEGAL_DISCLAIMER_VERSION, acceptedAt: new Date(acceptedMs).toISOString() };
}

function makeCouplesSession({ name, topic, resolutionCriteria = "", carryover = null, durationMinutes = COUPLES_DEFAULT_MINUTES, legalAck }) {
  const code = newCouplesCode();
  const token = newCouplesToken();
  const now = new Date().toISOString();
  const topicText = normalizeTopicText(topic);
  const normalizedDurationMinutes = normalizeCouplesDurationMinutes(durationMinutes);
  const normalizedLegalAck = normalizeLegalAcknowledgement(legalAck);
  if (!normalizedLegalAck) throw new Error("The current ClearSay legal notice must be acknowledged before creating a session.");
  const creatorName = cleanParticipantName(name, "Person A");
  const session = {
    code, createdAt: now, updatedAt: now, expiresAt: Date.now() + COUPLES_SESSION_TTL_MS, revision: 1,
    durationMinutes: normalizedDurationMinutes, maxActiveMs: normalizedDurationMinutes * 60 * 1000,
    participants: { A: { token, name: creatorName, joinedAt: now, consentAt: now, legalDisclaimerVersion: normalizedLegalAck.version, legalAcknowledgedAt: normalizedLegalAck.acceptedAt }, B: null },
    auditRecords: [
      { sequence: 1, recordType: "legal_acknowledgement", participantId: "A", participantName: creatorName, disclaimerVersion: normalizedLegalAck.version, acceptedAt: normalizedLegalAck.acceptedAt },
      { sequence: 2, recordType: "session_created", participantId: "A", participantName: creatorName, createdAt: now }
    ],
    messages: [], insights: null,
    topic: { id: `t-${Date.now()}`, text: topicText, resolutionCriteria: normalizeShortText(resolutionCriteria, 500), status: "awaiting_confirmation", createdAt: now, startedAt: null, closedAt: null, confirmations: { A: true, B: false }, closureVotes: { A: null, B: null } },
    topicHistory: [], parkingLot: [], claimLedger: [], agreements: [], evidence: [], carryover,
    mediator: { enabled: false, consent: { A:false, B:false }, inviteCode: "", participant: null },
    nextFirstSpeaker: "A", turnCounter: 0, turn: null,
    timerStartedAt: null, timerEndsAt: null, sessionEndedAt: null, sessionEndReason: "", finalInsightsRequested: false
  };
  couplesSessions.set(code, session);
  return { session, token };
}

app.post("/api/couples/create", (req, res) => {
  const topicText = normalizeTopicText(req.body?.topic);
  if (!topicText) return res.status(400).json({ error: "Enter one topic or question for this Couples Live session." });
  if (req.body?.consent !== true) return res.status(400).json({ error: "Confirm that messages and shared session analysis may be visible to the other participant and exportable by either participant." });
  const legalAck = normalizeLegalAcknowledgement(req.body?.legal_ack);
  if (!legalAck) return res.status(400).json({ error: "Acknowledge the current ClearSay legal notice before creating a session." });
  const durationMinutes = normalizeCouplesDurationMinutes(req.body?.session_minutes);
  const { session, token } = makeCouplesSession({ name:req.body?.name, topic:topicText, resolutionCriteria:req.body?.resolution_criteria, durationMinutes, legalAck });
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
  // A read keeps the temporary room alive without creating a new revision.
  s.expiresAt = Date.now() + COUPLES_SESSION_TTL_MS;
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
  const s = getCouplesSession(req.params.code);
  if (!s) return res.status(404).json({ error: "This Couples Live session is no longer available." });
  const p = couplesParticipantFromRequest(s, req);
  if (!p) return res.status(401).json({ error: "This browser is not authorized for that session." });
  if (!isCoupleParticipant(p)) return res.status(403).json({ error: "Only the two participants can manage topics." });
  maybeExpireCouplesSession(s);
  if (s.sessionEndedAt) return res.status(409).json({ error: "This session has ended." });
  if (!s.topic || s.topic.status !== "open") return res.status(409).json({ error: "The current topic is not open." });
  const status = String(req.body?.status || "").trim();
  if (!COUPLES_CLOSE_STATUSES.has(status)) return res.status(400).json({ error: "Choose a valid topic-closing status." });
  const note = String(req.body?.note || "").trim().slice(0, 500);
  s.topic.closureVotes[p.id] = { status, note, at: new Date().toISOString() };
  const a = s.topic.closureVotes.A, b = s.topic.closureVotes.B;
  if (a && b && a.status === b.status) {
    s.topic.status = a.status;
    s.topic.closedAt = new Date().toISOString();
    s.turn = null;
  }
  touchCouplesSession(s);
  res.json({ ok: true, state: publicCouplesState(s, p.id), closed: Boolean(a && b && a.status === b.status) });
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
  s.topic = { id: `t-${Date.now()}-${randomBytes(3).toString("hex")}`, text: topicText, resolutionCriteria: normalizeShortText(req.body?.resolution_criteria, 500), status: "awaiting_confirmation", createdAt: now, startedAt: null, closedAt: null, confirmations: { A: false, B: false }, closureVotes: { A: null, B: null } };
  s.turn = null;
  s.topic.confirmations[p.id] = true;
  if (parkingId) s.parkingLot = (s.parkingLot || []).filter(x => x.id !== parkingId);
  s.insights = null;
  touchCouplesSession(s);
  res.json({ ok: true, state: publicCouplesState(s, p.id) });
});


app.post("/api/couples/:code/agreement/propose", (req, res) => {
  const s = getCouplesSession(req.params.code); if (!s) return res.status(404).json({ error: "This Couples Live session is no longer available." });
  const p = couplesParticipantFromRequest(s, req); if (!p) return res.status(401).json({ error: "This browser is not authorized for that session." });
  if (!isCoupleParticipant(p)) return res.status(403).json({ error: "Only the two participants can propose an agreement." });
  maybeExpireCouplesSession(s); if (s.sessionEndedAt) return res.status(409).json({ error: "This Couples Live session has ended." });
  const text = normalizeShortText(req.body?.text, 700); if (!text) return res.status(400).json({ error: "Enter the exact proposed agreement." });
  s.agreements ||= [];
  const item = { id:`a-${Date.now()}-${randomBytes(3).toString("hex")}`, text, status:"pending", proposedBy:p.id, createdAt:new Date().toISOString(), responses:{A:null,B:null} };
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
  const outcome=buildCouplesOutcome(s); const carryover={from_session:s.code,previous_topic:topic.text,previous_status:topic.status,common_ground:outcome.common_ground,still_disputed:outcome.still_disputed,agreements_reached:outcome.agreements_reached,evidence:(s.evidence||[]).slice(-12).map(x=>({type:x.type,relation:x.relation,description:x.description})),suggested_next_questions:outcome.suggested_next_questions};
  const made=makeCouplesSession({name:p.name,topic:topic.text,resolutionCriteria:topic.resolutionCriteria||"",carryover,durationMinutes:normalizeCouplesDurationMinutes(s.durationMinutes),legalAck:{accepted:true,version:p.legalDisclaimerVersion||LEGAL_DISCLAIMER_VERSION,accepted_at:p.legalAcknowledgedAt||s.createdAt}});
  const now=new Date().toISOString();
  made.session.agreements=(s.agreements||[]).filter(x=>x.status==="agreed").map(x=>({id:`a-${Date.now()}-${randomBytes(3).toString("hex")}`,text:x.text,status:"agreed",proposedBy:"A",createdAt:now,responses:{A:{decision:"agree",at:now},B:{decision:"agree",at:now}},carriedFrom:s.code}));
  made.session.claimLedger=(s.claimLedger||[]).filter(x=>!["established"].includes(x.status)&&!["conceded","withdrawn"].includes(x.lifecycle)).map(x=>({...x,id:`c-${Date.now()}-${randomBytes(3).toString("hex")}`,key:claimKey(x.text),createdAt:now,updatedAt:now,history:[{messageId:"",senderId:"",lifecycle:"unclear",status:x.status||"unknown",explanation:`Carried forward from session ${s.code}.`,at:now}]}));
  touchCouplesSession(made.session);
  res.json({code:made.session.code,token:made.token,participant_id:"A",state:publicCouplesState(made.session,"A")});
});

function couplesExportObject(s, viewerId = "") {
  return {
    app: "ClearSay",
    tagline: "Claim. Clarify. Connect.",
    version: "1.7.3",
    session_code: s.code,
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
    transcript_mode: "local-all-claims-paginated-then-analyze-selected",
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
    couples_live_evidence_notes: true,
    couples_live_resolution_criteria: true,
    couples_live_continuations: true,
    couples_live_optional_readonly_mediator: true,
    couples_live_participant_consent: true,
    couples_live_turn_lock: true,
    couples_live_turn_seconds: 60,
    couples_live_no_inactive_drafting: true,
    couples_live_repeated_irrelevance_guidance: true,
    couples_live_storage: "temporary-server-memory",
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
    session_overview: true,
    app_version: "1.7.3",
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
