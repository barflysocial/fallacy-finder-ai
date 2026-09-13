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

if(!server.includes('couples_live: true')||!server.includes('couples_live_analysis_timing: "post-send"')) throw new Error('Missing Couples Live health flags');
if(!server.includes('app.post("/api/couples/create"')||!server.includes('app.post("/api/couples/join"')||!server.includes('app.post("/api/couples/:code/message"')) throw new Error('Missing Couples Live session/message endpoints');
if(!server.includes('conversation_effect')||!server.includes('strength_change')) throw new Error('Missing Couples Live claim-strength analysis');

if(!server.includes('couples_live_topic_lock: true')||!server.includes('couples_live_topic_confirmation: true')) throw new Error('Missing Couples Live topic-lock flags');
if(!server.includes('COUPLES_ALLOWED_MINUTES = new Set([15, 30, 45, 60])')||!server.includes('couples_live_duration_options_minutes: [15,30,45,60]')) throw new Error('Missing Couples Live 15/30/45/60 duration selector');
if(!server.includes('topic_relevance')||!server.includes('parking_lot')||!server.includes('couples_live_parking_lot: true')) throw new Error('Missing Couples Live topic relevance / parking lot');
if(!server.includes('app.post("/api/couples/:code/topic/close"')||!server.includes('app.post("/api/couples/:code/topic/new"')) throw new Error('Missing Couples Live topic close/new endpoints');
if(!server.includes('app.get("/api/couples/:code/export"')||!server.includes('couples_live_export')) throw new Error('Missing Couples Live export endpoint');
const appJs=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
if(!appJs.includes('selectLiveResponse')||!appJs.includes('live-response-choice')) throw new Error('Missing selectable Quick Live responses');
if(!appJs.includes('selectLiveResponseTarget')||!appJs.includes('selectGeneralResponseTarget')||!appJs.includes('live-response-target')) throw new Error('Missing therapist/other-person response target selector');
if(!appJs.includes('clearLiveSession')||!html.includes('clearLiveSessionBtn')) throw new Error('Missing Clear Session control');

if(!html.includes('couplesModeBtn')||!html.includes('couplesRoom')||!html.includes('couplesMessage')) throw new Error('Missing Couples Live interface');
if(!appJs.includes('createCouplesSession')||!appJs.includes('joinCouplesSession')||!appJs.includes('sendCouplesMessage')||!appJs.includes('refreshCouplesInsights')) throw new Error('Missing Couples Live browser workflow');
if(!appJs.includes('confirmCouplesTopic')||!appJs.includes('closeCouplesTopic')||!appJs.includes('proposeCouplesTopic')) throw new Error('Missing Couples Live topic workflow');
if(!appJs.includes('exportCouples')||!appJs.includes('printCouplesSession')||!html.includes('couplesTimer')) throw new Error('Missing Couples Live export/timer interface');
if(!server.includes('couples_live_private_vs_shared_analysis: true')||!server.includes('publicSharedCouplesAnalysis')) throw new Error('Missing Couples Live private/shared analysis split');
if(!server.includes('couples_live_claim_ledger: true')||!server.includes('claim_updates')) throw new Error('Missing Couples Live claim ledger/evolution');
if(!server.includes('couples_live_mutual_agreements: true')||!server.includes('/agreement/propose')) throw new Error('Missing mutual agreement capture');
if(!server.includes('couples_live_evidence_notes: true')||!server.includes('/evidence')) throw new Error('Missing Couples Live evidence notes');
if(!server.includes('couples_live_continuations: true')||!server.includes('/continue')) throw new Error('Missing continuation-room support');
if(!server.includes('couples_live_optional_readonly_mediator: true')||!server.includes('/mediator/consent')) throw new Error('Missing optional mediator access');
if(!server.includes('couples_live_participant_consent: true')||!html.includes('couplesCreateConsent')||!html.includes('couplesJoinConsent')) throw new Error('Missing participant consent controls');
if(!server.includes('couples_live_end_early: true')||!html.includes('couplesEndSessionBtn')) throw new Error('Missing early session-end control');
if(!html.includes('couplesClaimLedger')||!html.includes('couplesAgreementText')||!html.includes('couplesEvidenceText')||!html.includes('couplesOutcome')) throw new Error('Missing v1.5.1 Couples Live panels');
if(!html.includes('couplesCreateDuration')||!html.includes('value="15"')||!html.includes('value="30"')||!html.includes('value="45"')||!html.includes('value="60"')) throw new Error('Missing Couples Live duration options in UI');
if(!server.includes('COUPLES_TURN_MS = 60 * 1000')||!server.includes('couples_live_turn_lock: true')||!server.includes('couples_live_turn_seconds: 60')) throw new Error('Missing server-enforced 1:00 Couples Live turn control');
if(!server.includes('/turn/start')||!server.includes('/turn/pass')||!server.includes('couples_live_no_inactive_drafting: true')) throw new Error('Missing Couples Live Start/Pass floor-control workflow');
if(!server.includes('couplesTopicEngagement')||!server.includes('couples_live_repeated_irrelevance_guidance: true')) throw new Error('Missing repeated topic-irrelevance guidance');
if(!html.includes('couplesTurnPanel')||!html.includes('couplesTurnTimer')||!html.includes('couplesStartTurnBtn')||!html.includes('couplesListeningPanel')||!html.includes('couplesRelevanceNotice')) throw new Error('Missing v1.5.2 turn/relevance UI');
if(!appJs.includes('startCouplesTurn')||!appJs.includes('passCouplesTurn')||!appJs.includes('renderCouplesRelevance')||!appJs.includes('couplesTurnRemainingMsClient')) throw new Error('Missing v1.5.2 browser turn/relevance workflow');

if(!html.includes('ClearSay')||!html.includes('Claim. Clarify. Connect.')) throw new Error('Missing ClearSay branding/tagline');
if(!html.includes('legalGate')||!html.includes('legalAckCheck')||!html.includes('legalAcknowledgeBtn')) throw new Error('Missing required legal acknowledgment gate');
if(!appJs.includes("CLEARSAY_RECORDS_KEY='clearSayActivityRecordsV160'")||!appJs.includes("LEGAL_DISCLAIMER_VERSION='clearsay-legal-2026-09-13-v1'")) throw new Error('Missing versioned ClearSay legal record ledger');
if(!appJs.includes("record_type:'legal_acknowledgement'")||!appJs.includes('sequence:1')||!appJs.includes('initializeClearSayApp')) throw new Error('Missing first-record legal acknowledgment behavior');
if(!server.includes('legal_acknowledgement_required: true')||!server.includes('legal_acknowledgement_first_record: true')) throw new Error('Missing server legal acknowledgment health flags');
if(!server.includes('auditRecords')||!server.includes('legal_notice')||!server.includes('LEGAL_DISCLAIMER_VERSION')) throw new Error('Missing Couples Live legal record/export metadata');
if(!server.includes('app: "ClearSay"')||!server.includes('version: "1.6.0"')) throw new Error('Missing ClearSay v1.6.0 export branding');
console.log('Knowledge check passed: ClearSay v1.6.0 branding, required first-record legal acknowledgment, 100 fallacies, 12 claim identifiers, repair/agreement reasoning, transcript mode, Self-Guided, response targets, and Couples Live with 15/30/45/60-minute sessions, 1:00 turn control, no inactive drafting, and repeated topic-focus guidance.');
