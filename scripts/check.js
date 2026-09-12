import fs from "node:fs";
const fallacies=JSON.parse(fs.readFileSync(new URL('../knowledge/fallacies.json',import.meta.url),'utf8'));
const ids=new Set(fallacies.map(f=>f.id));
if(fallacies.length!==100) throw new Error(`Expected 100 fallacies, got ${fallacies.length}`);
for(let i=1;i<=100;i++) if(!ids.has(i)) throw new Error(`Missing fallacy ${i}`);
for(const f of fallacies){
  if(!Array.isArray(f.keywords)||f.keywords.length<3) throw new Error(`Fallacy ${f.id} missing keyword bank`);
  if(!Array.isArray(f.clarify_questions)||f.clarify_questions.length<2) throw new Error(`Fallacy ${f.id} missing clarifying questions`);
  if(!Array.isArray(f.challenge_questions)||f.challenge_questions.length<1) throw new Error(`Fallacy ${f.id} missing challenge questions`);
  if(!f.responses?.curious||!f.responses?.direct||!f.responses?.deescalating) throw new Error(`Fallacy ${f.id} missing response toolkit`);
}
const claims=JSON.parse(fs.readFileSync(new URL('../knowledge/claim-identifiers.json',import.meta.url),'utf8'));
if(claims.length!==12) throw new Error(`Expected 12 claim identifiers, got ${claims.length}`);
const qualifiers=JSON.parse(fs.readFileSync(new URL('../knowledge/claim-qualifiers.json',import.meta.url),'utf8'));
if(!qualifiers.universal) throw new Error('Missing universal claim qualifier');
if(!Array.isArray(qualifiers.temporal_relevance)||qualifiers.temporal_relevance.length<4) throw new Error('Missing temporal relevance qualifiers');
for(const type of ['event_fact','feeling','behavior_label','interpretation_meaning','intent_motive','cause','pattern_frequency','prediction','value_rule','identity_character','request_boundary','repair_status']){
  if(!Array.isArray(qualifiers[type])||qualifiers[type].length<2) throw new Error(`Missing claim qualifiers for ${type}`);
}
console.log('Knowledge check passed: 100 fallacies, 100 keyword banks/toolkits, 12 claim identifiers, 12 claim-qualifier banks, temporal relevance bank.');
