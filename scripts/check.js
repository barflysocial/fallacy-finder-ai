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
const styles=fs.readFileSync(new URL('../public/styles.css',import.meta.url),'utf8');
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
if(!html.includes('legalGate')||!html.includes('appShell')||!html.includes('legalAcknowledgeBtn')||!html.includes('HOW CLEARSAY WORKS')||!html.includes('BEST FOR')||!html.includes('NOT FOR')) throw new Error('Missing required premium landing acknowledgment gate');
if(!appJs.includes("CLEARSAY_RECORDS_KEY='clearSayActivityRecordsV160'")||!appJs.includes("LEGAL_DISCLAIMER_VERSION='clearsay-legal-2026-09-13-v2'")) throw new Error('Missing versioned ClearSay legal record ledger');
if(!appJs.includes("record_type:'legal_acknowledgement'")||!appJs.includes('sequence:1')||!appJs.includes('required_on_launch:true')||!appJs.includes('initializeClearSayApp')||!appJs.includes("$('appShell')?.classList.remove('hidden')")) throw new Error('Missing first-record / per-launch landing acknowledgment behavior');
if(!server.includes('legal_acknowledgement_required: true')||!server.includes('legal_acknowledgement_first_record: true')||!server.includes('legal_acknowledgement_every_launch: true')||!server.includes('landing_intro_gate: true')||!server.includes('landing_how_it_works: true')||!server.includes('landing_fit_guidance: true')||!server.includes('terms_page: true')) throw new Error('Missing server legal acknowledgment / landing-page health flags');
if(!server.includes('auditRecords')||!server.includes('legal_notice')||!server.includes('LEGAL_DISCLAIMER_VERSION')) throw new Error('Missing Couples Live legal record/export metadata');
if(!server.includes('app: "ClearSay"')||!server.includes('version: "1.9.4"')) throw new Error('Missing ClearSay v1.9.3 export branding');

if(!server.includes('app.post("/api/transcript/audit"')||!server.includes('TRANSCRIPT_AUDIT_VERSION')||!server.includes('transcript_audit_pass: true')) throw new Error('Missing full Transcript Audit Pass endpoint/health flag');
if(!server.includes('pattern_confidence')||!server.includes('claim_confidence')||!server.includes('transcript_confidence')) throw new Error('Missing three transcript-audit confidence scores');
if(!appJs.includes('runTranscriptAudit')||!appJs.includes('renderTranscriptAudit')||!html.includes('transcriptLoadingText')) throw new Error('Missing Transcript Audit Pass browser workflow');
if(!server.includes('transcript_context_audit: true')||!server.includes('transcript_whole_transcript_audit: true')||!server.includes('TRANSCRIPT_GLOBAL_AUDIT_VERSION')) throw new Error('Missing v1.8 Context + Whole-Transcript audit architecture');
if(!server.includes('transcript_supported_complaint_layer: true')||!server.includes('underlying_concern')||!server.includes('supported_core_summary')) throw new Error('Missing v1.8 supported complaint / reasoning extension layer');
if(!server.includes('transcript_four_layer_breakdown: true')||!server.includes('intent_identity')) throw new Error('Missing v1.8 four-layer claim breakdown');
if(!server.includes('transcript_claim_evolution: true')||!server.includes('transcript_evidence_graph: true')||!server.includes('evidence_graph')) throw new Error('Missing v1.8 claim evolution / evidence graph');
if(!server.includes('transcript_conversation_pattern_analysis: true')||!server.includes('conversationIntelligenceSchema')||!server.includes('interaction_cycles')) throw new Error('Missing v1.8 conversation pattern analysis');
if(!server.includes('transcript_context_change_explanations: true')||!server.includes('context_changed')||!appJs.includes('Context changed this result')) throw new Error('Missing v1.8 context-change transparency');
if(!appJs.includes('renderConversationIntelligence')||!appJs.includes('Supported concerns vs. reasoning extensions')||!appJs.includes('Whole-Transcript Audit')) throw new Error('Missing v1.8 Conversation Intelligence UI');


if(!server.includes('couples_live_unresolved_issue_hub: true')||!server.includes('couples_live_start_session_from_unresolved_issue: true')||!server.includes('normalizeIssueCarryover')||!server.includes('buildCouplesUnresolvedIssues')) throw new Error('Missing v1.8.1 unresolved issue hub / continuation context');
if(!appJs.includes('UNRESOLVED_ISSUES_KEY')||!appJs.includes('selectUnresolvedIssue')||!appJs.includes('Start new session from this issue')||!html.includes('unresolvedIssuesHub')) throw new Error('Missing v1.8.1 unresolved issue browser workflow');
if(!server.includes('participant_positions')||!appJs.includes('historical context')||!appJs.includes('Prior Person A position')) throw new Error('Missing v1.8.1 prior-position carryover / historical-context labeling');
if(!server.includes('what_needs_to_change')||!appJs.includes('WHAT NEEDS TO CHANGE')) throw new Error('Missing v1.8.1 What Needs to Change report');
if(!appJs.includes('Data Analytics')||!appJs.includes('transcript-data-analytics')) throw new Error('Missing v1.8.1 plain-language default / Data Analytics separation');


if(!server.includes('couples_live_agreement_lineage: true')||!server.includes('couples_live_repair_standard_lock: true')||!server.includes('couples_live_mutual_replacement_only: true')||!server.includes('couples_live_no_retroactive_repair_rewrite: true')) throw new Error('Missing v1.8.3 shared agreement / repair-standard guardrails');
if(!server.includes('COUPLES_AGREEMENT_KINDS')||!server.includes('supersededBy')||!server.includes('parentId')) throw new Error('Missing v1.8.3 agreement replacement lineage');
if(!html.includes('couplesAgreementKind')||!html.includes('couplesAgreementParent')||!html.includes('couplesActiveRepairStandard')||!html.includes('Shared-standard rule')) throw new Error('Missing v1.8.3 agreement / repair-standard UI');
if(!appJs.includes('agreementKindLabel')||!appJs.includes('the prior shared agreement remains active until both people agree')) throw new Error('Missing v1.8.3 browser repair-standard guardrail behavior');

if(!server.includes('couples_live_closure_agreement: true')||!server.includes('/topic/closure/propose')||!server.includes('/topic/closure/respond')||!server.includes('closureAgreement')) throw new Error('Missing v1.8.5 structured Closure Agreement workflow');
if(!server.includes('couples_live_agreement_versioning: true')||!server.includes('rootId')||!server.includes('version:parent ? Number(parent.version||1)+1 : 1')) throw new Error('Missing v1.8.5 Agreement Versioning');
if(!server.includes('definition_collision_detection: true')||!server.includes('definition_collision')||!server.includes('definition_collisions')) throw new Error('Missing v1.8.5 Definition Collision detection');
if(!server.includes('current_behavior_historical_injury_split: true')||!server.includes('current_vs_historical')||!server.includes('current_behavior_vs_historical_injury')) throw new Error('Missing v1.8.5 current-behavior / historical-injury split');
if(!html.includes('couplesCloseResolved')||!html.includes('couplesCloseOpen')||!html.includes('couplesCloseRepair')||!html.includes('couplesClosureAgreement')) throw new Error('Missing v1.8.5 Closure Agreement UI');
if(!appJs.includes('respondCouplesClosure')||!appJs.includes('definition-collision-card')||!appJs.includes('history-split-card')||!appJs.includes('v${Number(x.version||1)}')) throw new Error('Missing v1.8.5 browser guardrail UI');
if(!server.includes('couples_live_durable_session_storage: true')||!server.includes('COUPLES_STORE_PATH')||!server.includes('loadPersistedCouplesSessions')) throw new Error('Missing v1.8.2 durable Couples Live persistence');
if(!server.includes('couples_live_temporary_mode: true')||!html.includes('couplesSaveSession')) throw new Error('Missing v1.8.2 temporary/no-save session option');
if(!server.includes('transcript_browser_autosave: true')||!appJs.includes('TRANSCRIPT_SESSION_KEY')||!html.includes('transcriptAutosave')) throw new Error('Missing v1.8.2 transcript browser autosave/recovery');

const termsHtml=fs.readFileSync(new URL('../public/terms.html',import.meta.url),'utf8');
if(!termsHtml.includes('Terms & Conditions')||!termsHtml.includes('ClearSay')) throw new Error('Missing separate Terms & Conditions page');
if(!html.includes('call <strong>911 immediately</strong>')||!html.includes('serious harm, injury, or death')) throw new Error('Missing Emergency 911 safety language on landing acknowledgment');
if(!termsHtml.includes('call <strong>911 immediately</strong>')||!termsHtml.includes('harm to yourself or another person')) throw new Error('Missing Emergency 911 safety language in Terms & Conditions');

if(!html.includes('How to upload your conversation')||!html.includes('Read screenshots into transcript')) throw new Error('Missing v1.8.9 screenshot upload directions');
console.log('Knowledge check passed: ClearSay v1.9.4 premium landing introduction, emergency 911 acknowledgment language, per-launch acknowledgment, separate terms page, stronger button/dashboard contrast, 100 fallacies, 12 claim identifiers, repair/agreement reasoning, transcript mode, Self-Guided, response targets, and Couples Live with 15/30/45/60-minute sessions, 1:00 turn control, no inactive drafting, and repeated topic-focus guidance.');

if(!html.includes('example-drawer')||!html.includes('Need an example?')) throw new Error('Missing collapsed example drawer on Analyze Claim screen');

if(!html.includes('themeSelect')||!appJs.includes("THEME_KEY='clearSayThemeV186'")||!appJs.includes('applyTheme')||!appJs.includes('resolvedTheme')) throw new Error('Missing v1.8.6 Light / Dark / System appearance controls');
if(!html.includes('paymentGate')||!html.includes('checkoutBtn')||!appJs.includes('beginCheckout')||!appJs.includes('/api/billing/status')) throw new Error('Missing v1.8.6 payment gate browser workflow');
if(!server.includes('PAYMENTS_ENABLED')||!server.includes('STRIPE_SECRET_KEY')||!server.includes('app.post("/api/billing/checkout"')||!server.includes('app.get("/api/billing/confirm"')) throw new Error('Missing v1.8.6 Stripe Checkout payment foundation');
if(!server.includes('light_dark_system_mode: true')||!server.includes('payments_foundation: true')||!server.includes('apple_pay_ready')) throw new Error('Missing v1.8.6 theme/payment health flags');

if(!html.includes('screenshotInput')||!html.includes('readScreenshotsBtn')||!html.includes('screenshotPreviewList')) throw new Error('Missing v1.8.7 screenshot upload UI');
if(!appJs.includes('readScreenshotsIntoTranscript')||!appJs.includes('/api/transcript/screenshots')||!appJs.includes('SCREENSHOT_MAX_FILES')) throw new Error('Missing v1.8.7 screenshot browser workflow');
if(!server.includes('handleScreenshotTranscript')||!server.includes('input_image')||!server.includes('screenshot_upload_import: true')) throw new Error('Missing v1.8.7 screenshot transcription endpoint / health flag');
if(!html.includes('screenshotOtherColor')||!html.includes('screenshotMineColor')||!appJs.includes('selectedScreenshotOtherColor')) throw new Error('Missing v1.8.9 two-party screenshot color assignment');
if(!server.includes('USER-PROVIDED SPEAKER COLOR MAP')||!server.includes('other_color')) throw new Error('Missing v1.8.9 server speaker color mapping');
if(!html.includes('statementUpdateBadge')||!appJs.includes('collapseStatementPanelForUpdate')||!styles.includes('statement-update-badge')) throw new Error('Missing v1.8.9 collapsible statement update indicator');

if(!html.includes('couplesTextInviteBtn')||!html.includes('couplesCopyInviteBtn')) throw new Error('Missing v1.9.1 Couples Live invite controls');
if(!appJs.includes('textCouplesInvite')||!appJs.includes('couplesInviteUrl')||!appJs.includes('applyPendingCouplesInvite')) throw new Error('Missing v1.9.1 Couples Live invite logic');

if(!server.includes('couples_live_text_invites: true')||!server.includes('couples_live_prefilled_invite_links: true')||!server.includes('couples_live_combined_invite_copy: true')) throw new Error('Missing v1.9.2 invite health flags');
if(!html.includes('>Copy invite</button>')||!appJs.includes('navigator.clipboard.writeText(invite)')) throw new Error('Missing v1.9.2 combined link + code copy action');
if(!server.includes('couples_live_guest_session_only_invites: true')||!server.includes('couples_live_guest_terms_gate: true')||!server.includes('footer_pinned_to_page_bottom: true')) throw new Error('Missing v1.9.3 guest/footer health flags');
if(!html.includes('id="couplesGuestGate"')||!html.includes('id="couplesGuestTerms"')||!html.includes('Session-only access:')) throw new Error('Missing v1.9.3 guest invitation gate');
if(!appJs.includes("new URL('/couples-live',location.origin)")||!appJs.includes('joinCouplesGuestSession')||!appJs.includes("if(couplesGuestInviteMode)mode='couples'")) throw new Error('Missing v1.9.3 guest-only invite routing');
if(!styles.includes('.app-shell:not(.hidden){min-height:100vh')||!styles.includes('body.couples-guest-session .analysis-mode-switch')) throw new Error('Missing v1.9.3 footer or guest-only CSS');


if(!server.includes('couples_live_rich_link_preview: true')||!server.includes('couples_live_invitee_self_entry_only: true')||!server.includes('couples_live_invite_preview_private_metadata: true')) throw new Error('Missing v1.9.4 Couples Live rich-preview/privacy health flags');
if(!server.includes('app.get("/couples-live"')||!server.includes('og:title')||!server.includes('ClearSay Couples Live Chat')||!server.includes('clearsay-bridge-mark.png')) throw new Error('Missing v1.9.4 Couples Live rich link preview route');
if(!server.includes('hasCreatorSuppliedInviteeInfo')||!server.includes('Person B must enter their own information')) throw new Error('Missing v1.9.4 invitee self-entry server guard');
if(!appJs.includes('ClearSay Couples Live Chat')||!appJs.includes('enter your own display name')) throw new Error('Missing v1.9.4 official Couples Live Chat invite copy');
if(!html.includes("Person A does not enter Person B's name, phone number, or other personal information")) throw new Error('Missing v1.9.4 host invite privacy guidance');
