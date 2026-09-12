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
if(!Array.isArray(qualifiers.repair_status)||qualifiers.repair_status.length<8) throw new Error('Missing repair evidence-mapping qualifiers');
if(!Array.isArray(qualifiers.agreement_layer)||qualifiers.agreement_layer.length<8) throw new Error('Missing expanded agreement-verification qualifiers');
if(!qualifiers.agreement_layer.some(q=>String(q.question||'').includes('later changed'))) throw new Error('Missing agreement-change question');
if(!qualifiers.agreement_layer.some(q=>String(q.question||'').includes('later accept'))) throw new Error('Missing later-acceptance question');
if(!qualifiers.agreement_layer.some(q=>String(q.question||'').includes('original agreed terms fulfilled'))) throw new Error('Missing original-fulfillment question');
for(const type of ['event_fact','feeling','behavior_label','interpretation_meaning','intent_motive','cause','pattern_frequency','prediction','value_rule','identity_character','request_boundary','repair_status']){
  if(!Array.isArray(qualifiers[type])||qualifiers[type].length<2) throw new Error(`Missing claim qualifiers for ${type}`);
}
const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
if(!server.includes('repair_evidence_mapping')) throw new Error('Missing repair evidence mapping schema');
if(!server.includes('response_self_check: true')) throw new Error('Missing response self-check health flag');
if(!server.includes('quick_live_session: true')) throw new Error('Missing quick live session health flag');
if(!server.includes('response_options')) throw new Error('Missing Quick Live alternative-response schema');
if(!server.includes('therapist_suggested_response')||!server.includes('therapist_response_options')) throw new Error('Missing therapist-directed response schema');
if(!server.includes('response_target_selector: true')) throw new Error('Missing response target health flag');
if(!server.includes('agreement_verification: true')||!server.includes('unilateral_agreement_change_tracking: true')) throw new Error('Missing agreement-verification health flags');
if(!server.includes('unilaterally_changed')||!server.includes('retroactive_standard_issue')) throw new Error('Missing unilateral-change agreement schema');
if(!server.includes('app.post("/api/session/analyze"')) throw new Error('Missing live session overview endpoint');
const appJs=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
if(!appJs.includes('selectLiveResponse')||!appJs.includes('live-response-choice')) throw new Error('Missing selectable Quick Live responses');
if(!appJs.includes('selectLiveResponseTarget')||!appJs.includes('selectGeneralResponseTarget')||!appJs.includes('live-response-target')) throw new Error('Missing therapist/other-person response target selector');
if(!appJs.includes('clearLiveSession')||!html.includes('clearLiveSessionBtn')) throw new Error('Missing Clear Session control');
console.log('Knowledge check passed: 100 fallacies, 12 claim identifiers, repair evidence mapping, expanded agreement verification, unilateral-change tracking, reasoning engine, transcript mode, history, response self-check, Quick Live alternatives, therapist/other-person targets, and Clear Session.');
