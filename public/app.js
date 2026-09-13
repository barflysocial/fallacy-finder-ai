const $ = (id) => document.getElementById(id);
let session = { claim: "", context: "", round: 0, answers: [], last: null, route: null, selectedClaimTypes: [], source: "statement", liveTurnId: null };
let transcriptSession = { transcript: "", extracted: [], filtered: [], page: 1, pageSize: 20, speakers: [], claimTypes: [], summary: "" };
let liveSession = { id: "", startedAt: "", contextNote: "", turns: [], overview: null };
let couplesSession = { code:'', token:'', participantId:'', name:'', state:null, pollTimer:null, clockTimer:null, lastRevision:-1, lastActiveSpeaker:'', lastTurnNumber:0 };
let analysisMode = 'statement';
let generalResponseTarget = 'other_person';
const HISTORY_KEY='fallacyFinderAnalysisHistoryV133'; // legacy key preserved so existing analyses remain available after the ClearSay rebrand
const LIVE_SESSION_KEY='fallacyFinderQuickLiveV133'; // legacy key preserved for continuity
const COUPLES_SESSION_KEY='fallacyFinderCouplesLiveV152'; // legacy key preserved for room-resume continuity
const CLEARSAY_RECORDS_KEY='clearSayActivityRecordsV160';
const LEGAL_DISCLAIMER_VERSION='clearsay-legal-2026-09-13-v1';
const HISTORY_LIMIT=20;
let clearSayAppInitialized=false;
let legalReviewMode=false;

const CLAIM_TYPE_OPTIONS = [
  ["event_fact","Event / Fact"],
  ["feeling","Feeling"],
  ["behavior_label","Behavior Label"],
  ["interpretation_meaning","Interpretation / Meaning"],
  ["intent_motive","Intent / Motive"],
  ["cause","Cause"],
  ["pattern_frequency","Pattern / Frequency"],
  ["prediction","Prediction"],
  ["value_rule","Value / Rule"],
  ["identity_character","Identity / Character"],
  ["request_boundary","Request / Boundary"],
  ["repair_status","Repair Status"]
];

function escapeHtml(s="") { return String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function titleType(t){return ({event_fact:'Event / Fact',feeling:'Feeling',behavior_label:'Behavior Label',interpretation_meaning:'Interpretation / Meaning',intent_motive:'Intent / Motive',cause:'Cause',pattern_frequency:'Pattern / Frequency',prediction:'Prediction',value_rule:'Value / Rule',identity_character:'Identity / Character',request_boundary:'Request / Boundary',repair_status:'Repair Status',repair_evidence:'Repair Evidence',evidence_quality:'Evidence Quality',agreement_layer:'Agreement Verification',temporal_relevance:'Time / Relevance'})[t]||t;}
function show(id,on=true){$(id).classList.toggle('hidden',!on)}
function setBusy(on){if($('analyzeBtn'))$('analyzeBtn').disabled=on;if($('liveAnalyzeBtn'))$('liveAnalyzeBtn').disabled=on;if($('continueBtn'))$('continueBtn').disabled=on;if($('qualifyContinueBtn'))$('qualifyContinueBtn').disabled=on;show('loading',on)}
function setRoutingBusy(on){if($('analyzeBtn'))$('analyzeBtn').disabled=on;if($('liveAnalyzeBtn'))$('liveAnalyzeBtn').disabled=on;if($('qualifyContinueBtn'))$('qualifyContinueBtn').disabled=on}
function error(msg){$('errorBox').textContent=msg;show('errorBox',true)}
function clearError(){show('errorBox',false);$('errorBox').textContent=''}


function loadClearSayRecords(){
  try{
    const raw=localStorage.getItem(CLEARSAY_RECORDS_KEY);
    const records=raw?JSON.parse(raw):[];
    return Array.isArray(records)?records:[];
  }catch{return [];}
}

function currentLegalAcknowledgement(){
  const records=loadClearSayRecords().filter(r=>r?.record_type==='legal_acknowledgement'&&r?.disclaimer_version===LEGAL_DISCLAIMER_VERSION);
  if(!records.length)return null;
  return records.reduce((latest,row)=>new Date(row.accepted_at).getTime()>new Date(latest.accepted_at).getTime()?row:latest);
}

function legalAckPayload(){
  const ack=currentLegalAcknowledgement();
  return ack?{accepted:true,version:ack.disclaimer_version,accepted_at:ack.accepted_at}:null;
}

function saveLegalAcknowledgement(){
  const existing=loadClearSayRecords();
  const ack={
    sequence:1,
    record_type:'legal_acknowledgement',
    app:'ClearSay',
    disclaimer_version:LEGAL_DISCLAIMER_VERSION,
    accepted_at:new Date().toISOString(),
    acknowledgement:'I have read and understand the ClearSay legal notice and acknowledge its limits.',
    storage_scope:'this_browser',
    required_on_launch:true
  };
  // The first-ever acknowledgment remains record #1.
  // A new acknowledgment is appended on each fresh app launch so the notice is actively re-acknowledged.
  const next=existing.length===0?[ack]:[...existing,ack];
  const records=next.map((r,i)=>({...r,sequence:i+1}));
  try{
    localStorage.setItem(CLEARSAY_RECORDS_KEY,JSON.stringify(records));
    return records[records.length-1];
  }catch{return null;}
}

function setLegalGate(review=false){
  const gate=$('legalGate');if(!gate)return;
  legalReviewMode=Boolean(review);
  gate.classList.remove('hidden');
  $('appShell')?.classList.add('hidden');
  document.body.classList.add('app-locked');
  const ack=currentLegalAcknowledgement();
  if($('legalRecordNote')){
    $('legalRecordNote').textContent=ack?`Last acknowledged ${new Date(ack.accepted_at).toLocaleString()} • record #${ack.sequence||1}. A new acknowledgment is required for this launch.`:'Acknowledgment is required each time ClearSay opens. ClearSay saves a local record of this notice version in this browser.';
    $('legalRecordNote').classList.toggle('accepted',Boolean(ack));
  }
}

function hideLegalGate(){
  $('legalGate')?.classList.add('hidden');
  $('appShell')?.classList.remove('hidden');
  document.body.classList.remove('app-locked');
  legalReviewMode=false;
}

function acknowledgeLegalNotice(){
  const ack=saveLegalAcknowledgement();
  if(!ack){
    if($('legalRecordNote')){$('legalRecordNote').textContent='ClearSay could not save the acknowledgment in this browser. Storage must be available before use.';$('legalRecordNote').classList.remove('accepted');}
    return;
  }
  hideLegalGate();
  initializeClearSayApp();
}


function loadHistory(){
  try{
    const raw=localStorage.getItem(HISTORY_KEY);
    const items=raw?JSON.parse(raw):[];
    return Array.isArray(items)?items:[];
  }catch{return [];}
}

function saveHistoryEntry(){
  if(!session.last?.analysis || session.last.analysis.status!=='analysis_ready')return;
  const item={
    saved_at:new Date().toISOString(),
    claim:session.claim,
    context:session.context,
    answers:session.answers,
    analysis:session.last.analysis,
    meta:session.last.meta||{}
  };
  const items=loadHistory();
  const deduped=items.filter(x=>!(x.claim===item.claim && x.analysis?.summary===item.analysis?.summary));
  deduped.unshift(item);
  try{localStorage.setItem(HISTORY_KEY,JSON.stringify(deduped.slice(0,HISTORY_LIMIT)));}catch{}
  renderHistory();
}

function renderHistory(){
  const panel=$('historyPanel');
  if(!panel)return;
  const items=loadHistory();
  panel.classList.toggle('hidden',items.length===0);
  if($('historyCount'))$('historyCount').textContent=items.length?`(${items.length})`:'';
  if(!$('historyList'))return;
  $('historyList').innerHTML=items.map((x,i)=>{
    const when=x.saved_at?new Date(x.saved_at).toLocaleString():'';
    const repair=x.analysis?.repair_status?.applies?` • ${humanize(x.analysis.repair_status.classification)}`:'';
    const agreement=x.analysis?.agreement_status?.applies?` • agreement: ${humanize(x.analysis.agreement_status.change_status||x.analysis.agreement_status.existence||'checked')}`:'';
    return `<div class="history-item"><div class="history-main"><strong>${escapeHtml((x.claim||'').slice(0,180))}</strong><div class="muted">${escapeHtml(when)}${escapeHtml(repair)}${escapeHtml(agreement)}</div></div><button type="button" class="mini-btn open-history" data-history-index="${i}">Open</button></div>`;
  }).join('');
  document.querySelectorAll('.open-history').forEach(btn=>btn.addEventListener('click',()=>openHistoryItem(Number(btn.dataset.historyIndex))));
}

function openHistoryItem(index){
  const item=loadHistory()[index];
  if(!item)return;
  session={claim:item.claim||'',context:item.context||'',round:0,answers:Array.isArray(item.answers)?item.answers:[],last:{analysis:item.analysis,meta:item.meta||{}},route:null,selectedClaimTypes:[],source:'statement',liveTurnId:null};
  $('claim').value=session.claim;$('context').value=session.context;
  switchMode('statement');
  show('claimQualification',false);show('clarification',false);
  renderResults(item.analysis,item.meta||{});
  $('results').scrollIntoView({behavior:'smooth',block:'start'});
}

function clearHistory(){
  try{localStorage.removeItem(HISTORY_KEY);}catch{}
  renderHistory();
}

function analyzeProposedResponse(){
  const text=($('responseCheckText')?.value||'').trim();
  if(!text){error('Enter the response you want to check first.');return;}
  const originalClaim=session.claim||'';
  const originalSummary=session.last?.analysis?.summary||'';
  $('claim').value=text;
  $('context').value=`This is a proposed response or rebuttal to: “${originalClaim.slice(0,900)}”${originalSummary?` Analysis context: ${originalSummary.slice(0,700)}`:''} Analyze the reasoning in the proposed response itself and whether it directly addresses the original claim. Do not assume either side is true unless supported.`;
  session.source='statement'; session.liveTurnId=null;
  switchMode('statement');
  window.scrollTo({top:0,behavior:'smooth'});
  setTimeout(()=>startQualification(),160);
}


function newLiveSessionState(){
  return { id:`live-${Date.now()}-${Math.random().toString(36).slice(2,7)}`, startedAt:new Date().toISOString(), contextNote:'', responseTarget:'other_person', turns:[], overview:null };
}

function loadLiveSessionState(){
  try{
    const raw=localStorage.getItem(LIVE_SESSION_KEY);
    const parsed=raw?JSON.parse(raw):null;
    if(parsed && Array.isArray(parsed.turns)){
      liveSession={...newLiveSessionState(),...parsed,turns:parsed.turns};
      return;
    }
  }catch{}
  liveSession=newLiveSessionState();
}

function saveLiveSessionState(){
  try{localStorage.setItem(LIVE_SESSION_KEY,JSON.stringify(liveSession));}catch{}
}

function buildLiveContext(currentTurnId){
  const prior=liveSession.turns.filter(t=>t.id!==currentTurnId).slice(-8);
  const lines=prior.map((t,i)=>{
    const target=t.confirmed_response_target==='therapist'?'to therapist':'to other person';
    const response=t.response_status==='used'||t.response_status==='modified'?`\nYou (${t.response_status==='used'?'confirmed app response':'confirmed modified response'}, ${target}): ${t.confirmed_response||''}`:'';
    return `${i+1}. Them: ${t.statement}${response}`;
  });
  const note=(liveSession.contextNote||'').trim();
  return [
    'SELF-GUIDED SESSION CONTEXT: This is not a complete transcript. It contains only statements the user entered and app responses the user explicitly confirmed using. Do not assume omitted conversation supports either side.',
    note?`User-supplied session context: ${note}`:'',
    lines.length?`Recent entered sequence:
${lines.join('\n')}`:'No prior entered statements in this session.'
  ].filter(Boolean).join('\n\n');
}

function liveTurnById(id){return liveSession.turns.find(t=>t.id===id);}

function liveSessionHistoryMarkup(){
  const n=liveSession.turns.length;
  if(!n)return '<div class="live-empty muted">Statements you analyze here will build a running session timeline.</div>';
  return `${liveSession.turns.map((t,i)=>{
    const verdict=t.analysis?.reasoning_outcome?.verdict?`<span class="type-badge">${escapeHtml(humanize(t.analysis.reasoning_outcome.verdict))}</span>`:'';
    const targetLabel=t.confirmed_response_target==='therapist'?'Therapist':'Other person';
    const reply=(t.response_status==='used'||t.response_status==='modified')&&t.confirmed_response?`<div class="live-you"><strong>You • ${t.response_status==='used'?`used ${escapeHtml(t.confirmed_response_label||'app')} response`:'modified response'} → ${targetLabel}</strong><p>${escapeHtml(t.confirmed_response)}</p></div>`:t.response_status==='not_used'?'<div class="live-response-status muted">Suggested response not used.</div>':'';
    const pending=t.analysis && (!t.response_status||t.response_status==='pending')?'<div class="live-response-status">Response use not confirmed yet.</div>':'';
    return `<article class="live-turn-card"><div class="live-turn-head"><span>Statement ${i+1}</span>${verdict}</div><div class="live-them"><strong>Them</strong><p>${escapeHtml(t.statement)}</p></div>${reply}${pending}<div class="live-turn-actions">${t.analysis?`<button type="button" class="mini-btn reopen-live-turn" data-live-id="${escapeHtml(t.id)}">Reopen analysis</button>`:''}</div></article>`;
  }).join('')}`;
}

function bindLiveReopenButtons(){
  document.querySelectorAll('.reopen-live-turn').forEach(btn=>btn.addEventListener('click',()=>reopenLiveTurn(btn.dataset.liveId)));
}

function renderLiveSession(){
  if($('liveContextNote') && document.activeElement!==$('liveContextNote')) $('liveContextNote').value=liveSession.contextNote||'';
  const n=liveSession.turns.length;
  if($('liveTurnCount'))$('liveTurnCount').textContent=`${n} statement${n===1?'':'s'} analyzed`;
  if($('liveOverviewBtn'))$('liveOverviewBtn').disabled=n<2;
  const label=liveSession.startedAt?new Date(liveSession.startedAt).toLocaleString():'';
  if($('liveSessionLabel'))$('liveSessionLabel').textContent=label?`Current session • ${label}`:'Current session';
  const markup=liveSessionHistoryMarkup();
  if($('liveTimeline'))$('liveTimeline').innerHTML=markup;
  if($('liveHistoryInResults'))$('liveHistoryInResults').innerHTML=markup;
  if($('liveHistoryFallback'))$('liveHistoryFallback').classList.toggle('hidden',n===0 || (session.source==='live' && !!session.last?.analysis));
  bindLiveReopenButtons();
}

function reopenLiveTurn(id){
  const turn=liveTurnById(id);if(!turn?.analysis)return;
  turn.response_target=turn.response_target||liveSession.responseTarget||'other_person';
  session={claim:turn.statement,context:turn.context||buildLiveContext(id),round:0,answers:turn.answers||[],last:{analysis:turn.analysis,meta:turn.meta||{}},route:null,selectedClaimTypes:[],source:'live',liveTurnId:id};
  switchMode('live');
  renderResults(turn.analysis,turn.meta||{});
  show('results',true);$('results').scrollIntoView({behavior:'smooth',block:'start'});
}

async function startLiveAnalysis(){
  clearError();
  const statement=($('liveStatement')?.value||'').trim();
  if(!statement){error('Enter what the other person said first.');return;}
  liveSession.contextNote=($('liveContextNote')?.value||'').trim();
  const id=`turn-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
  const turn={id,statement,created_at:new Date().toISOString(),context:'',analysis:null,meta:null,best_response:'',response_options:{},therapist_best_response:'',therapist_response_options:{},response_target:liveSession.responseTarget||'other_person',selected_response_key:'best',response_status:'pending',confirmed_response:'',confirmed_response_label:'',confirmed_response_target:'',answers:[]};
  liveSession.turns.push(turn);
  turn.context=buildLiveContext(id);
  liveSession.overview=null;
  saveLiveSessionState();renderLiveSession();
  session={claim:statement,context:turn.context,round:0,answers:[],last:null,route:null,selectedClaimTypes:[],source:'live',liveTurnId:id};
  $('liveStatement').value='';
  show('results',false);show('clarification',false);show('claimQualification',false);
  await runAI(false);
}

function captureLiveAnalysis(d){
  if(session.source!=='live'||!session.liveTurnId)return;
  const turn=liveTurnById(session.liveTurnId);if(!turn)return;
  turn.analysis=d.analysis;turn.meta=d.meta||{};turn.best_response=d.analysis?.suggested_response||'';turn.response_options=d.analysis?.response_options||{};turn.therapist_best_response=d.analysis?.therapist_suggested_response||'';turn.therapist_response_options=d.analysis?.therapist_response_options||{};turn.response_target=turn.response_target||liveSession.responseTarget||'other_person';turn.selected_response_key=turn.selected_response_key||'best';turn.answers=[...session.answers];
  liveSession.overview=null;saveLiveSessionState();renderLiveSession();
}

function liveResponseText(turn,key,target){
  if(!turn)return '';
  const audience=target||turn.response_target||'other_person';
  const therapist=audience==='therapist';
  const options=therapist?(turn.therapist_response_options||turn.analysis?.therapist_response_options||{}):(turn.response_options||turn.analysis?.response_options||{});
  if(key==='clarify')return options.clarify||'';
  if(key==='evidence')return options.evidence||'';
  if(key==='direct')return options.direct||'';
  if(key==='deescalating')return options.deescalating||'';
  return therapist?(turn.therapist_best_response||turn.analysis?.therapist_suggested_response||''):(turn.best_response||turn.analysis?.suggested_response||'');
}

function responseTargetLabel(target){return target==='therapist'?'Therapist':'Other person';}

function selectLiveResponseTarget(target){
  if(!['other_person','therapist'].includes(target)||session.source!=='live'||!session.liveTurnId)return;
  const turn=liveTurnById(session.liveTurnId);if(!turn)return;
  turn.response_target=target;liveSession.responseTarget=target;
  saveLiveSessionState();
  document.querySelectorAll('.live-response-target').forEach(btn=>btn.classList.toggle('selected',btn.dataset.responseTarget===target));
  const key=turn.selected_response_key||'best';
  if($('liveSelectedResponseTitle'))$('liveSelectedResponseTitle').textContent=`${key==='best'?'Best next response':`Selected response — ${liveResponseLabel(key)}`} to ${responseTargetLabel(target)}`;
  if($('liveSelectedResponseText'))$('liveSelectedResponseText').textContent=liveResponseText(turn,key,target);
  if($('liveQualifyingQuestions'))$('liveQualifyingQuestions').classList.toggle('hidden',target!=='other_person');
  refreshLiveResponseChoices(turn);
}

function refreshLiveResponseChoices(turn){
  if(!turn)return;
  const target=turn.response_target||'other_person';
  document.querySelectorAll('.live-response-choice').forEach(btn=>{
    const key=btn.dataset.liveResponseKey;
    const text=liveResponseText(turn,key,target);
    const span=btn.querySelector('span');if(span)span.textContent=text;
    btn.classList.toggle('selected',(turn.selected_response_key||'best')===key);
    btn.classList.toggle('hidden',!text);
  });
}

function liveResponseLabel(key){
  return ({best:'Recommended',clarify:'Clarify',evidence:'Evidence question',direct:'Direct',deescalating:'De-escalating'})[key]||'Recommended';
}

function selectLiveResponse(key){
  if(session.source!=='live'||!session.liveTurnId)return;
  const turn=liveTurnById(session.liveTurnId);if(!turn)return;
  const text=liveResponseText(turn,key,turn.response_target);if(!text)return;
  turn.selected_response_key=key;
  saveLiveSessionState();
  if($('liveSelectedResponseTitle'))$('liveSelectedResponseTitle').textContent=`${key==='best'?'Best next response':`Selected response — ${liveResponseLabel(key)}`} to ${responseTargetLabel(turn.response_target||'other_person')}`;
  if($('liveSelectedResponseText'))$('liveSelectedResponseText').textContent=text;
  document.querySelectorAll('.live-response-choice').forEach(btn=>btn.classList.toggle('selected',btn.dataset.liveResponseKey===key));
}

function markLiveResponse(status){
  if(session.source!=='live'||!session.liveTurnId)return;
  const turn=liveTurnById(session.liveTurnId);if(!turn)return;
  const selectedKey=turn.selected_response_key||'best';
  const selectedText=liveResponseText(turn,selectedKey,turn.response_target);
  if(status==='modified'){
    show('liveModifiedWrap',true);$('liveModifiedText').value=turn.confirmed_response||selectedText||'';$('liveModifiedText').focus();return;
  }
  turn.response_status=status;
  turn.confirmed_response=status==='used'?selectedText:'';
  turn.confirmed_response_label=status==='used'?liveResponseLabel(selectedKey):'';
  turn.confirmed_response_target=status==='used'?(turn.response_target||'other_person'):'';
  liveSession.overview=null;saveLiveSessionState();renderLiveSession();
  renderLiveResponseStatus(turn);
}

function saveModifiedLiveResponse(){
  const text=($('liveModifiedText')?.value||'').trim();
  if(!text){error('Enter what you actually said, or choose another option.');return;}
  const turn=liveTurnById(session.liveTurnId);if(!turn)return;
  turn.response_status='modified';turn.confirmed_response=text;turn.confirmed_response_label='Modified';turn.confirmed_response_target=turn.response_target||'other_person';liveSession.overview=null;saveLiveSessionState();renderLiveSession();renderLiveResponseStatus(turn);show('liveModifiedWrap',false);
}

function renderLiveResponseStatus(turn){
  const el=$('liveResponseStatus');if(!el||!turn)return;
  if(turn.response_status==='used')el.innerHTML=`<strong>Added to session:</strong> You confirmed using the ${escapeHtml((turn.confirmed_response_label||'selected').toLowerCase())} response to ${escapeHtml(responseTargetLabel(turn.confirmed_response_target||turn.response_target).toLowerCase())}.`;
  else if(turn.response_status==='modified')el.innerHTML=`<strong>Added to session:</strong> Your modified response to ${escapeHtml(responseTargetLabel(turn.confirmed_response_target||turn.response_target).toLowerCase())} is now part of the running context.`;
  else if(turn.response_status==='not_used')el.innerHTML='<strong>Not added:</strong> The suggested response will not be treated as something you said.';
  else el.textContent='';
}

function nextLiveStatement(){
  switchMode('live');show('results',false);show('clarification',false);clearError();
  session.last=null;session.liveTurnId=null;renderLiveSession();
  $('liveStatement').focus();$('liveMode').scrollIntoView({behavior:'smooth',block:'start'});
}

function clearLiveSession(){
  const hasContent=liveSession.turns.length || (liveSession.contextNote||'').trim() || ($('liveStatement')?.value||'').trim();
  if(hasContent && !window.confirm('Clear this Self-Guided session? This will remove all entered statements, confirmed replies, context, overview, and the current live analysis from this browser.'))return;
  try{localStorage.removeItem(LIVE_SESSION_KEY);}catch{}
  liveSession=newLiveSessionState();
  generalResponseTarget='other_person';
  session={claim:'',context:'',round:0,answers:[],last:null,route:null,selectedClaimTypes:[],source:'live',liveTurnId:null};
  if($('liveStatement'))$('liveStatement').value='';
  if($('liveContextNote'))$('liveContextNote').value='';
  if($('liveModifiedText'))$('liveModifiedText').value='';
  if($('questionList'))$('questionList').innerHTML='';
  if($('claimQuestionList'))$('claimQuestionList').innerHTML='';
  if($('detectedClaimTypes'))$('detectedClaimTypes').innerHTML='';
  if($('results'))$('results').innerHTML='';
  if($('liveOverviewResults'))$('liveOverviewResults').innerHTML='';
  show('results',false);show('clarification',false);show('claimQualification',false);show('liveOverviewResults',false);show('liveOverviewLoading',false);
  clearError();saveLiveSessionState();renderLiveSession();
  setTimeout(()=>$('liveStatement')?.focus(),0);
}

function renderLiveOverview(o,meta={},open=false){
  if(!o)return;
  const patterns=(o.reasoning_patterns||[]).map(x=>`<div class="mini-analysis"><strong>${escapeHtml(x.pattern||'Pattern')}</strong><p>${escapeHtml(x.assessment||'')}</p>${x.turn_refs?.length?`<div class="muted">Relevant statements: ${escapeHtml(x.turn_refs.join(', '))}</div>`:''}</div>`).join('');
  const evolution=(o.claim_evolution||[]).map(x=>`<div class="dependency-row"><div><strong>Earlier</strong><p>${escapeHtml(x.from_claim||'')}</p></div><div class="dependency-arrow">→</div><div><strong>Later</strong><p>${escapeHtml(x.to_claim||'')}</p><div class="muted">${escapeHtml(x.change||'')} ${escapeHtml(x.significance||'')}</div></div></div>`).join('');
  const agreement=o.agreement_overview||{};
  const repair=o.repair_overview||{};
  const body=`<div class="live-overview-warning">${escapeHtml(o.scope_warning||'This overview is limited to entered statements and confirmed replies.')}</div><div class="result-grid"><div><strong>Common ground / supported points</strong>${list(o.common_ground)}</div><div><strong>Still disputed or unresolved</strong>${list(o.disputed_points)}</div></div>${evolution?`<h3>How claims changed or narrowed</h3><div class="dependency-list">${evolution}</div>`:''}${patterns?`<h3>Recurring reasoning patterns</h3>${patterns}`:''}${agreement.applies?`<div class="live-overview-agreement"><strong>Agreement picture</strong><p><b>Original agreement:</b> ${escapeHtml(agreement.original_agreement||'Unknown')}</p><p><b>Mutual assent:</b> ${escapeHtml(agreement.mutual_assent||'Unknown')}</p><p><b>Later change:</b> ${escapeHtml(humanize(agreement.change_status||'unclear'))}</p><p><b>Fulfillment:</b> ${escapeHtml(agreement.fulfillment_status||'Unknown')}</p><p>${escapeHtml(agreement.assessment||'')}</p></div>`:''}${repair.applies?`<div class="live-overview-repair"><strong>Repair picture</strong><p><b>Behavioral repair:</b> ${escapeHtml(repair.behavioral_repair||'Unknown')}</p><p><b>Emotional resolution:</b> ${escapeHtml(repair.emotional_resolution||'Unknown')}</p><p>${escapeHtml(repair.assessment||'')}</p></div>`:''}<h3>Current disagreement</h3><p><strong>${escapeHtml(humanize(o.current_disagreement?.type||'mixed'))}</strong> — ${escapeHtml(o.current_disagreement?.explanation||'')}</p><h3>Best next questions</h3>${list(o.next_best_questions)}<div class="quote"><strong>Caution:</strong> ${escapeHtml(o.caution||'')}</div>${meta?.estimated_cost_usd!=null?`<div class="meta">Session overview • est. API cost $${Number(meta.estimated_cost_usd).toFixed(4)}</div>`:''}`;
  $('liveOverviewResults').innerHTML=`<details class="live-overview-details" ${open?'open':''}><summary><span>Session overview</span><span class="detail-hint">${escapeHtml(o.main_issue||'Overall conversation picture')}</span></summary><div class="live-overview-body"><p>${escapeHtml(o.summary||'')}</p>${body}</div></details>`;
  show('liveOverviewResults',true);
}

async function requestLiveOverview(){
  clearError();
  if(liveSession.turns.length<2){error('Analyze at least two statements before building a session overview.');return;}
  $('liveOverviewBtn').disabled=true;show('liveOverviewLoading',true);
  try{
    const turns=liveSession.turns.map((t,i)=>({
      index:i+1,statement:t.statement,response_status:t.response_status||'pending',confirmed_response:t.confirmed_response||'',response_target:t.confirmed_response_target||t.response_target||'other_person',analysis_summary:t.analysis?.summary||'',verdict:t.analysis?.reasoning_outcome?.verdict||'',fallacies:(t.analysis?.likely_fallacies||[]).map(f=>f.name).filter(Boolean),repair_status:t.analysis?.repair_status?.applies?t.analysis.repair_status.classification:'',agreement_status:t.analysis?.agreement_status?.applies?`${humanize(t.analysis.agreement_status.existence||'unclear')}; change=${humanize(t.analysis.agreement_status.change_status||'unclear')}; fulfillment=${humanize(t.analysis.agreement_status.fulfillment_status||'unknown')}`:''
    }));
    const r=await fetch('/api/session/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({turns,context_note:liveSession.contextNote||''})});
    const d=await r.json();if(!r.ok)throw new Error(d.error||'Unable to build the session overview.');
    liveSession.overview={analysis:d.analysis,meta:d.meta||{},created_at:new Date().toISOString()};saveLiveSessionState();renderLiveOverview(d.analysis,d.meta||{},true);$('liveOverviewResults').scrollIntoView({behavior:'smooth',block:'start'});
  }catch(e){error(e.message||String(e));}
  finally{show('liveOverviewLoading',false);$('liveOverviewBtn').disabled=liveSession.turns.length<2;}
}


// -----------------------------------------------------------------------------
// Couples Live v1.5.2 — turn-locked post-send reasoning room with 1:00 response turns
// -----------------------------------------------------------------------------
function loadCouplesResume(){
  try{
    const raw=localStorage.getItem(COUPLES_SESSION_KEY);
    const x=raw?JSON.parse(raw):null;
    if(x?.code && x?.token){
      couplesSession={...couplesSession,code:String(x.code).toUpperCase(),token:String(x.token),participantId:x.participantId||'',name:x.name||''};
    }
  }catch{}
}

function saveCouplesResume(){
  try{
    if(couplesSession.code&&couplesSession.token)localStorage.setItem(COUPLES_SESSION_KEY,JSON.stringify({code:couplesSession.code,token:couplesSession.token,participantId:couplesSession.participantId,name:couplesSession.name}));
  }catch{}
}

function clearCouplesResume(){
  stopCouplesPoll();
  couplesSession={code:'',token:'',participantId:'',name:'',state:null,pollTimer:null,clockTimer:null,lastRevision:-1,lastActiveSpeaker:'',lastTurnNumber:0};
  try{localStorage.removeItem(COUPLES_SESSION_KEY);}catch{}
}

function couplesHeaders(json=false){
  const h={'x-session-token':couplesSession.token};
  if(json)h['Content-Type']='application/json';
  return h;
}

function couplesTime(ts=''){
  try{return new Date(ts).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});}catch{return '';}
}

function renderCouplesAnalysis(shared,status,errorText='',privateAnalysis=null){
  if(status==='pending')return `<div class="couples-analysis-pending"><span class="couples-dot"></span> Analysis running after send…</div>`;
  if(status==='failed')return `<div class="couples-analysis-failed">Analysis unavailable: ${escapeHtml(errorText||'Unable to analyze this message.')}</div>`;
  if(!shared&&!privateAnalysis)return '';
  const a=shared||{};const effect=a.conversation_effect||{};const topicRel=a.topic_relevance||{};
  const common=(a.common_ground_added||[]).length?`<div><strong>Common ground added</strong>${list(a.common_ground_added)}</div>`:'';
  const unresolved=(a.disputed_or_unresolved||[]).length?`<div><strong>Still disputed / unresolved</strong>${list(a.disputed_or_unresolved)}</div>`:'';
  const agreement=a.agreement_signal?.applies?`<div class="couples-signal-card"><strong>Agreement</strong><span class="type-badge">${escapeHtml(humanize(a.agreement_signal.status||'unclear'))}</span><p>${escapeHtml(a.agreement_signal.assessment||'')}</p></div>`:'';
  const repair=a.repair_signal?.applies?`<div class="couples-signal-card"><strong>Repair</strong><p><b>Behavioral:</b> ${escapeHtml(a.repair_signal.behavioral_repair||'Unknown')}</p><p><b>Emotional / trust:</b> ${escapeHtml(a.repair_signal.emotional_resolution||'Unknown')}</p><p>${escapeHtml(a.repair_signal.assessment||'')}</p></div>`:'';
  const topicShift=['possible_topic_shift','unrelated_issue'].includes(topicRel.classification)?`<div class="couples-topic-shift"><strong>${escapeHtml(humanize(topicRel.classification))}</strong><div>${escapeHtml(topicRel.explanation||'')}</div>${topicRel.parked_issue?`<div><b>Saved for later:</b> ${escapeHtml(topicRel.parked_issue)}</div>`:''}</div>`:'';
  let privateBlock='';
  if(privateAnalysis){
    const p=privateAnalysis;const fallacies=p.likely_fallacies||[];const claimTypes=(p.claim_types||[]).map(t=>`<span class="type-badge">${escapeHtml(titleType(t))}</span>`).join('');
    const fallacyBlock=fallacies.length?fallacies.map(f=>`<div class="couples-fallacy"><strong>${escapeHtml(f.name||`Reasoning trap #${f.fallacy_id}`)}</strong><span>${Number(f.match_score||0)}% fit</span><p>${escapeHtml(f.why_it_fits||'')}</p></div>`).join(''):'<p class="muted">No clear fallacy identified in your message.</p>';
    const questions=(p.useful_next_questions||[]).length?`<div class="couples-next-questions"><strong>Questions that could clarify the issue</strong>${list(p.useful_next_questions)}</div>`:'';
    privateBlock=`<details class="couples-private-analysis"><summary>Your private reasoning analysis</summary><div class="couples-analysis-body"><div class="claim-type-row">${claimTypes}</div><div class="couples-mini-grid"><div><strong>Claim status</strong><p>${escapeHtml(humanize(p.claim_status||'unknown'))}</p></div><div><strong>Reasoning confidence</strong><p>${escapeHtml(humanize(p.reasoning_outcome?.confidence||'low'))}</p></div><div><strong>Evidence quality</strong><p>${escapeHtml(humanize(p.evidence_assessment?.quality||'unknown'))}</p></div></div><p>${escapeHtml(p.reasoning_outcome?.explanation||'')}</p>${p.evidence_assessment?.assessment?`<div class="quote"><strong>Evidence:</strong> ${escapeHtml(p.evidence_assessment.assessment)}</div>`:''}<h4>Reasoning traps considered</h4>${fallacyBlock}${questions}${p.caution?`<div class="muted couples-caution"><strong>Caution:</strong> ${escapeHtml(p.caution)}</div>`:''}</div></details>`;
  }
  return `<details class="couples-analysis-details"><summary><span>Shared conversation effect</span><span class="couples-effect-badge effect-${escapeHtml(effect.strength_change||'unclear')}">${escapeHtml(humanize(effect.strength_change||'unclear'))}</span></summary><div class="couples-analysis-body"><p class="couples-analysis-summary">${escapeHtml(a.summary||'')}</p><div class="couples-effect-card"><div class="section-kicker">EFFECT ON THE CONVERSATION</div><p><strong>${escapeHtml(humanize(effect.relation||'unclear'))}</strong>${effect.affected_claim?` — ${escapeHtml(effect.affected_claim)}`:''}</p><p>${escapeHtml(effect.explanation||'')}</p>${topicRel.classification?`<p class="muted"><strong>Topic relevance:</strong> ${escapeHtml(humanize(topicRel.classification))}${topicRel.explanation?` — ${escapeHtml(topicRel.explanation)}`:''}</p>`:''}</div>${topicShift}${agreement}${repair}${(common||unresolved)?`<div class="couples-mini-grid two">${common}${unresolved}</div>`:''}${a.underlying_issue?`<div class="couples-underlying"><strong>Underlying issue</strong><p>${escapeHtml(a.underlying_issue)}</p></div>`:''}${a.caution?`<div class="muted couples-caution"><strong>Scope:</strong> ${escapeHtml(a.caution)}</div>`:''}${privateBlock}</div></details>`;
}

function renderCouplesMessages(state){
  const el=$('couplesChat');if(!el)return;
  const messages=state?.messages||[];
  if(!messages.length){
    const waiting=state?.participants?.B? 'Both people are here. Confirm the topic, then take turns with one 1:00 response window at a time.' : 'Share the session code with the other person. Messaging stays locked until both people join and confirm the topic.';
    el.innerHTML=`<div class="couples-chat-empty"><strong>Room ready</strong><p>${escapeHtml(waiting)}</p><span>Messages are never changed before they are sent.</span></div>`;
    return;
  }
  const previousLast=couplesSession.lastMessageId||'';
  el.innerHTML=messages.map(m=>{
    const mine=m.sender_id===couplesSession.participantId;
    return `<article class="couples-message ${mine?'mine':'theirs'}" data-message-id="${escapeHtml(m.id)}">
      <div class="couples-message-meta"><strong>${escapeHtml(m.sender_name||m.sender_id)}</strong><span>${escapeHtml(couplesTime(m.created_at))}</span></div>
      <div class="couples-message-text">${escapeHtml(m.text)}</div>
      ${renderCouplesAnalysis(m.shared_analysis,m.analysis_status,m.analysis_error,m.private_analysis)}
    </article>`;
  }).join('');
  const lastId=messages.at(-1)?.id||'';
  if(lastId!==previousLast){setTimeout(()=>{el.scrollTop=el.scrollHeight;},0);couplesSession.lastMessageId=lastId;}
}

function renderCouplesInsightsBox(insights){
  const el=$('couplesInsights');if(!el)return;
  const o=insights?.analysis;
  if(!o){el.innerHTML='';show('couplesInsights',false);return;}
  const evolution=(o.claim_evolution||[]).map(x=>`<div class="dependency-row"><div><strong>Earlier</strong><p>${escapeHtml(x.from_claim||'')}</p></div><div class="dependency-arrow">→</div><div><strong>Later</strong><p>${escapeHtml(x.to_claim||'')}</p><div class="muted">${escapeHtml(x.change||'')} ${escapeHtml(x.significance||'')}</div></div></div>`).join('');
  const patterns=(o.reasoning_patterns||[]).map(x=>`<div class="mini-analysis"><strong>${escapeHtml(x.pattern||'Pattern')}</strong><p>${escapeHtml(x.assessment||'')}</p></div>`).join('');
  const agreement=o.agreement_overview||{},repair=o.repair_overview||{};
  el.innerHTML=`<details class="couples-insights-details" open><summary><span>Conversation insights</span><span class="detail-hint">${escapeHtml(o.main_issue||'Underlying issue')}</span></summary><div class="live-overview-body">
    <p>${escapeHtml(o.summary||'')}</p>
    <div class="couples-mini-grid two"><div><strong>Common ground</strong>${list(o.common_ground)}</div><div><strong>Still disputed</strong>${list(o.disputed_points)}</div></div>
    ${evolution?`<h3>How claims changed</h3><div class="dependency-list">${evolution}</div>`:''}
    ${patterns?`<h3>Recurring reasoning patterns</h3>${patterns}`:''}
    ${agreement.applies?`<div class="couples-signal-card"><strong>Agreement picture</strong><p><b>Original:</b> ${escapeHtml(agreement.original_agreement||'Unknown')}</p><p><b>Change:</b> ${escapeHtml(humanize(agreement.change_status||'unclear'))}</p><p><b>Fulfillment:</b> ${escapeHtml(agreement.fulfillment_status||'Unknown')}</p><p>${escapeHtml(agreement.assessment||'')}</p></div>`:''}
    ${repair.applies?`<div class="couples-signal-card"><strong>Repair picture</strong><p><b>Behavioral:</b> ${escapeHtml(repair.behavioral_repair||'Unknown')}</p><p><b>Emotional / trust:</b> ${escapeHtml(repair.emotional_resolution||'Unknown')}</p><p>${escapeHtml(repair.assessment||'')}</p></div>`:''}
    <h3>Current disagreement</h3><p><strong>${escapeHtml(humanize(o.current_disagreement?.type||'mixed'))}</strong> — ${escapeHtml(o.current_disagreement?.explanation||'')}</p>
    <h3>Questions that may move the issue forward</h3>${list(o.next_best_questions)}
    <div class="muted"><strong>Scope:</strong> ${escapeHtml(o.scope_warning||'This analyzes the messages sent through this room, not outside events independently.')}</div>
  </div></details>`;
  show('couplesInsights',true);
}

function couplesRemainingMsClient(state=couplesSession.state){
  if(!state)return 30*60*1000;
  if(state.session_ended_at)return 0;
  if(!state.timer_ends_at)return Number(state.max_active_ms||Number(state.session_minutes||30)*60*1000);
  return Math.max(0,new Date(state.timer_ends_at).getTime()-Date.now());
}

function couplesTurnRemainingMsClient(state=couplesSession.state){
  const turn=state?.turn_control;
  if(!turn)return 60000;
  if(turn.status!=='active'||!turn.turn_ends_at)return Number(turn.turn_seconds||60)*1000;
  return Math.max(0,new Date(turn.turn_ends_at).getTime()-Date.now());
}

function formatCountdown(ms){
  const sec=Math.max(0,Math.ceil(ms/1000));
  const m=Math.floor(sec/60),s=sec%60;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function updateCouplesClock(){
  const el=$('couplesTimer');if(!el)return;
  const state=couplesSession.state;
  const rem=couplesRemainingMsClient(state);
  el.textContent=formatCountdown(rem);
  el.classList.toggle('warn',rem>60000&&rem<=5*60*1000);
  el.classList.toggle('urgent',rem>0&&rem<=60000);
  el.classList.toggle('ended',rem<=0||Boolean(state?.session_ended_at));
  const turnEl=$('couplesTurnTimer');const turn=state?.turn_control;
  if(turnEl){
    const turnRem=couplesTurnRemainingMsClient(state);
    turnEl.textContent=turn?.status==='active'?formatCountdown(turnRem):'01:00';
    turnEl.classList.toggle('urgent',turn?.status==='active'&&turnRem>0&&turnRem<=15000);
    turnEl.classList.toggle('ended',turn?.status==='active'&&turnRem<=0);
    if(turn?.active_speaker===couplesSession.participantId&&turn?.status==='active'&&turnRem<=0){
      if($('couplesMessage')){$('couplesMessage').disabled=true;$('couplesMessage').placeholder='Time is up — passing the floor…';}
      if($('couplesSendBtn'))$('couplesSendBtn').disabled=true;
      if($('couplesPassTurnBtn'))$('couplesPassTurnBtn').disabled=true;
    }
  }
  if(state?.timer_started_at&&!state?.session_ended_at&&rem<=0)setTimeout(()=>fetchCouplesState(true),250);
}

function startCouplesClock(){
  if(couplesSession.clockTimer)clearInterval(couplesSession.clockTimer);
  updateCouplesClock();
  couplesSession.clockTimer=setInterval(updateCouplesClock,1000);
}

function stopCouplesClock(){if(couplesSession.clockTimer){clearInterval(couplesSession.clockTimer);couplesSession.clockTimer=null;}}

function topicStatusLabel(status=''){
  return ({awaiting_confirmation:'Waiting for both people to confirm',open:'Open',resolved:'Resolved',partially_resolved:'Partially resolved',unresolved_more_evidence:'Unresolved — more evidence needed',unresolved_value_preference:'Unresolved — value / preference disagreement',deferred_mutual:'Deferred by mutual agreement',time_expired:'Closed — time expired',session_ended_early:'Closed — session ended early'})[status]||humanize(status||'unknown');
}

function renderCouplesTopic(state){
  const topic=state?.topic||{};const me=couplesSession.participantId;
  $('couplesTopicText').textContent=topic.text||'No topic';
  const criteria=(topic.resolution_criteria||'').trim();
  if($('couplesTopicCriteria')){$('couplesTopicCriteria').innerHTML=criteria?`<strong>What would help close this topic:</strong> ${escapeHtml(criteria)}`:'';show('couplesTopicCriteria',Boolean(criteria));}
  $('couplesTopicStatus').textContent=`Status: ${topicStatusLabel(topic.status)}${state?.timer_started_at?` • ${Number(state.session_minutes||30)}-minute timer is running`:` • session timer starts when the first 1:00 response turn begins`}`;
  const canManageTopic=state?.viewer_role!=='mediator';
  const needsConfirm=canManageTopic&&topic.status==='awaiting_confirmation'&&!topic.confirmations?.[me]&&!state?.session_ended_at;
  show('couplesTopicConfirmWrap',needsConfirm);
  show('couplesCloseTopicDetails',canManageTopic&&topic.status==='open'&&!state?.session_ended_at);
  const closed=topic.status&&!['open','awaiting_confirmation'].includes(topic.status);
  show('couplesNextTopicWrap',canManageTopic&&closed&&!state?.session_ended_at&&couplesRemainingMsClient(state)>0);
  const a=topic.closure_votes?.A,b=topic.closure_votes?.B;
  if($('couplesClosureVotes')){
    const nameA=state?.participants?.A?.name||'Person A',nameB=state?.participants?.B?.name||'Person B';
    $('couplesClosureVotes').innerHTML=[a?`<div class="closure-vote-row"><strong>${escapeHtml(nameA)}:</strong> ${escapeHtml(topicStatusLabel(a.status))}${a.note?` — ${escapeHtml(a.note)}`:''}</div>`:'',b?`<div class="closure-vote-row"><strong>${escapeHtml(nameB)}:</strong> ${escapeHtml(topicStatusLabel(b.status))}${b.note?` — ${escapeHtml(b.note)}`:''}</div>`:''].filter(Boolean).join('')||(topic.status==='open'?'No closing status submitted yet.':'');
  }

  const turn=state?.turn_control;const mediator=state?.viewer_role==='mediator';
  const turnAvailable=Boolean(state?.participants?.B)&&topic.status==='open'&&!state?.session_ended_at&&Boolean(turn);
  show('couplesTurnPanel',turnAvailable||mediator&&Boolean(turn));
  show('couplesTurnReady',false);show('couplesListeningPanel',false);show('couplesComposer',false);
  if($('couplesMessage'))$('couplesMessage').disabled=true;
  if($('couplesSendBtn'))$('couplesSendBtn').disabled=true;
  if($('couplesPassTurnBtn'))$('couplesPassTurnBtn').disabled=true;

  if(turn){
    const activeName=turn.active_name||state?.participants?.[turn.active_speaker]?.name||`Person ${turn.active_speaker||''}`;
    const mine=turn.active_speaker===me;
    $('couplesTurnLabel').textContent=mine?'Your turn':`${activeName}'s turn`;
    if(mediator){
      $('couplesTurnHint').textContent=`Read-only view. ${activeName} currently has the floor.`;
    }else if(mine&&turn.status==='waiting_to_start'){
      $('couplesTurnHint').textContent='Read first. Your message box stays locked until you start your 1:00 response turn.';
      $('couplesTurnReadyText').textContent='Read the other person’s message first. When you are ready to respond, start your 1:00 turn. You can also pass without typing.';
      show('couplesTurnReady',turnAvailable);
      $('couplesStartTurnBtn').disabled=false;$('couplesPassTurnReadyBtn').disabled=false;
    }else if(mine&&turn.status==='active'){
      $('couplesTurnHint').textContent='Your 1:00 response counter is running. Sending passes the floor immediately.';
      show('couplesComposer',turnAvailable);
      $('couplesMessage').disabled=false;$('couplesMessage').placeholder='Type your response…';
      $('couplesSendBtn').disabled=false;$('couplesPassTurnBtn').disabled=false;
    }else{
      $('couplesTurnHint').textContent=`Only ${activeName} can type. Your composer is unavailable while you listen / read.`;
      $('couplesListeningText').textContent=`${activeName} has the floor. Read what they send; your message box will appear only when the floor passes to you.`;
      show('couplesListeningPanel',turnAvailable&&!mediator);
    }
  }else if($('couplesTurnLabel')){
    $('couplesTurnLabel').textContent='Waiting for the floor';
    $('couplesTurnHint').textContent=topic.status==='awaiting_confirmation'?'Both people must confirm the topic first.':'The conversation floor is not active.';
  }
  updateCouplesClock();
}

function renderCouplesParking(state){
  const items=state?.parking_lot||[];
  $('couplesParkingCount').textContent=String(items.length);
  show('couplesParkingDetails',items.length>0);
  if(!items.length){$('couplesParkingList').innerHTML='';return;}
  const canUse=state?.topic&&!['open','awaiting_confirmation'].includes(state.topic.status)&&!state?.session_ended_at&&couplesRemainingMsClient(state)>0;
  $('couplesParkingList').innerHTML=items.map(x=>`<div class="parking-item"><p>${escapeHtml(x.text)}<span class="muted"> — raised by ${escapeHtml(state?.participants?.[x.raised_by]?.name||x.raised_by||'participant')}</span></p>${canUse?`<button class="mini-btn use-parked-topic" type="button" data-parking-id="${escapeHtml(x.id)}">Use as next topic</button>`:''}</div>`).join('');
  document.querySelectorAll('.use-parked-topic').forEach(btn=>btn.addEventListener('click',()=>proposeCouplesTopic('',btn.dataset.parkingId||'')));
}

function renderCouplesRelevance(state){
  const el=$('couplesRelevanceNotice');if(!el)return;
  const e=state?.topic_engagement||{};const notices=e.notices||[];
  if(!notices.length){el.innerHTML='';show('couplesRelevanceNotice',false);return;}
  const current=e.current_topic||state?.topic?.text||'';
  el.innerHTML=`<div class="section-kicker">TOPIC FOCUS</div><strong>Current question remains open</strong>${current?`<p><b>Active topic:</b> ${escapeHtml(current)}</p>`:''}${notices.map(n=>`<div class="relevance-notice-item"><p><strong>${escapeHtml(n.participant_name||'Participant')}:</strong> ${escapeHtml(n.message||'Several recent responses did not directly address the active topic.')}</p><div class="muted">On-topic ways to respond still include:</div>${list(n.response_paths||[])}</div>`).join('')}<div class="muted"><strong>Important:</strong> This does not mean the person is intentionally avoiding the topic. It only describes how recent analyzed messages relate to the question both people agreed to discuss.</div>`;
  show('couplesRelevanceNotice',true);
}

function renderCouplesClaimLedger(state){
  const items=state?.claim_ledger||[];$('couplesClaimLedgerCount').textContent=String(items.length);show('couplesClaimLedgerDetails',items.length>0);
  if(!items.length){$('couplesClaimLedger').innerHTML='';return;}
  $('couplesClaimLedger').innerHTML=items.map(x=>`<div class="ledger-item"><div><strong>${escapeHtml(x.text)}</strong><div class="muted">${escapeHtml(humanize(x.status||'unknown'))} • ${escapeHtml(humanize(x.lifecycle||'unclear'))}</div></div></div>`).join('');
}

function renderCouplesAgreements(state){
  const items=state?.agreements||[];$('couplesAgreementCount').textContent=String(items.length);
  const me=state?.participant_id;const canAct=state?.viewer_role!=='mediator'&&!state?.session_ended_at;
  $('couplesAgreementList').innerHTML=items.length?items.map(x=>{const my=x.responses?.[me];const minePending=canAct&&!my;return `<div class="agreement-item"><div><strong>${escapeHtml(x.text)}</strong><div class="muted">Status: ${escapeHtml(humanize(x.status||'pending'))} • proposed by ${escapeHtml(state?.participants?.[x.proposed_by]?.name||x.proposed_by)}</div></div>${minePending?`<div class="agreement-actions"><button class="mini-btn agreement-response" data-id="${escapeHtml(x.id)}" data-decision="agree">Agree</button><button class="mini-btn agreement-response" data-id="${escapeHtml(x.id)}" data-decision="disagree">Disagree</button></div>`:''}</div>`}).join(''):'<p class="muted">No shared agreement has been proposed yet.</p>';
  show('couplesAgreementComposer',canAct);
  document.querySelectorAll('.agreement-response').forEach(btn=>btn.addEventListener('click',()=>respondCouplesAgreement(btn.dataset.id,btn.dataset.decision)));
}

function renderCouplesEvidence(state){
  const items=state?.evidence||[];$('couplesEvidenceCount').textContent=String(items.length);
  $('couplesEvidenceList').innerHTML=items.length?items.map(x=>`<div class="evidence-item"><strong>${escapeHtml(humanize(x.type||'other'))}</strong> <span class="type-badge">${escapeHtml(humanize(x.relation||'neutral'))}</span><p>${escapeHtml(x.description)}</p><div class="muted">Added by ${escapeHtml(state?.participants?.[x.added_by]?.name||x.added_by||'participant')} • participant-supplied, not independently verified</div></div>`).join(''):'<p class="muted">No evidence notes recorded yet.</p>';
  const select=$('couplesEvidenceClaim');if(select){const current=select.value;select.innerHTML='<option value="">General / topic-level evidence</option>'+((state?.claim_ledger||[]).map(x=>`<option value="${escapeHtml(x.id)}">${escapeHtml(x.text.slice(0,100))}</option>`).join(''));if([...select.options].some(o=>o.value===current))select.value=current;}
  show('couplesEvidenceComposer',state?.viewer_role!=='mediator'&&!state?.session_ended_at);
}

function renderCouplesMediator(state){
  const m=state?.mediator||{};const me=state?.participant_id;
  if(state?.viewer_role==='mediator'){$('couplesMediatorStatus').innerHTML=`<div class="quote"><strong>Read-only mediator view.</strong> You can review the shared conversation and Conversation Insights. Private participant analysis is not shown to you.</div>`;show('couplesMediatorActions',false);return;}
  const a=m.consent?.A,b=m.consent?.B;const code=m.invite_code||'';
  $('couplesMediatorStatus').innerHTML=`<div class="muted">Person A: ${a?'approved':'not approved'} • Person B: ${b?'approved':'not approved'}</div>${code?`<div class="mediator-code"><strong>Mediator code:</strong> ${escapeHtml(code)}</div>`:''}${m.participant?`<div class="muted">Connected: ${escapeHtml(m.participant.name)}</div>`:''}`;
  $('couplesMediatorAllowBtn').textContent=m.consent?.[me]?'Approved':'Allow mediator access';$('couplesMediatorAllowBtn').disabled=Boolean(m.consent?.[me]);show('couplesMediatorActions',true);
}

function renderCouplesOutcome(state){
  const o=state?.outcome||{};const shouldShow=Boolean(state?.session_ended_at)||state?.topic&&!['open','awaiting_confirmation'].includes(state.topic.status);
  show('couplesOutcomeDetails',shouldShow);if(!shouldShow)return;
  $('couplesOutcome').innerHTML=`<div class="outcome-grid"><div><strong>What appears established / common ground</strong>${list(o.common_ground)}</div><div><strong>Still disputed / unresolved</strong>${list(o.still_disputed)}</div></div>${o.resolution_obstacle?`<div class="couples-relevance-summary"><strong>Possible resolution obstacle</strong><p>${escapeHtml(o.resolution_obstacle)}</p></div>`:''}${(o.agreements_reached||[]).length?`<h4>Agreements reached</h4>${list(o.agreements_reached)}`:''}${(o.parked_topics||[]).length?`<h4>Issues saved for later</h4>${list(o.parked_topics)}`:''}${(o.suggested_next_questions||[]).length?`<h4>Questions to carry forward</h4>${list(o.suggested_next_questions)}`:''}${o.main_issue?`<div class="quote"><strong>Underlying issue:</strong> ${escapeHtml(o.main_issue)}</div>`:''}`;
}

async function proposeCouplesAgreement(){
  clearError();const text=($('couplesAgreementText').value||'').trim();if(!text)return;
  try{const r=await fetch(`/api/couples/${encodeURIComponent(couplesSession.code)}/agreement/propose`,{method:'POST',headers:couplesHeaders(true),body:JSON.stringify({text})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Unable to propose the agreement.');$('couplesAgreementText').value='';renderCouplesState(d.state);}catch(e){error(e.message||String(e));}
}

async function respondCouplesAgreement(id,decision){
  clearError();try{const r=await fetch(`/api/couples/${encodeURIComponent(couplesSession.code)}/agreement/${encodeURIComponent(id)}/respond`,{method:'POST',headers:couplesHeaders(true),body:JSON.stringify({decision})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Unable to record your response.');renderCouplesState(d.state);}catch(e){error(e.message||String(e));}
}

async function addCouplesEvidence(){
  clearError();const description=($('couplesEvidenceText').value||'').trim();if(!description)return;
  const body={description,type:$('couplesEvidenceType').value,relation:$('couplesEvidenceRelation').value,claim_id:$('couplesEvidenceClaim').value};
  try{const r=await fetch(`/api/couples/${encodeURIComponent(couplesSession.code)}/evidence`,{method:'POST',headers:couplesHeaders(true),body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw new Error(d.error||'Unable to add the evidence note.');$('couplesEvidenceText').value='';renderCouplesState(d.state);}catch(e){error(e.message||String(e));}
}

async function setCouplesMediatorConsent(allow){
  clearError();try{const r=await fetch(`/api/couples/${encodeURIComponent(couplesSession.code)}/mediator/consent`,{method:'POST',headers:couplesHeaders(true),body:JSON.stringify({allow})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Unable to update mediator access.');renderCouplesState(d.state);}catch(e){error(e.message||String(e));}
}

async function joinCouplesMediator(){
  clearError();const code=($('couplesMediatorRoomCode').value||'').trim().toUpperCase(),mediator_code=($('couplesMediatorCode').value||'').trim().toUpperCase(),name=($('couplesMediatorName').value||'').trim();if(!code||!mediator_code){error('Enter both the session code and mediator code.');return;}
  try{const r=await fetch('/api/couples/mediator/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code,mediator_code,name})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Unable to join as mediator.');couplesSession={...couplesSession,code:d.code,token:d.token,participantId:'M',name:d.state?.mediator?.participant?.name||name,state:d.state,lastRevision:-1};saveCouplesResume();renderCouplesState(d.state);startCouplesPoll();}catch(e){error(e.message||String(e));}
}

async function continueCouplesIssue(){
  clearError();if(!window.confirm(`Start a new ${Number(couplesSession.state?.session_minutes||30)}-minute room carrying this unresolved issue, common ground, agreements, and open questions forward?`))return;
  try{const r=await fetch(`/api/couples/${encodeURIComponent(couplesSession.code)}/continue`,{method:'POST',headers:couplesHeaders(true),body:'{}'});const d=await r.json();if(!r.ok)throw new Error(d.error||'Unable to create a continuation room.');couplesSession={...couplesSession,code:d.code,token:d.token,participantId:'A',name:d.state?.participants?.A?.name||couplesSession.name,state:d.state,lastRevision:-1};saveCouplesResume();renderCouplesState(d.state);startCouplesPoll();}catch(e){error(e.message||String(e));}
}

async function confirmCouplesTopic(){
  clearError();
  try{const r=await fetch(`/api/couples/${encodeURIComponent(couplesSession.code)}/topic/confirm`,{method:'POST',headers:couplesHeaders(true),body:'{}'});const d=await r.json();if(!r.ok)throw new Error(d.error||'Unable to confirm the topic.');renderCouplesState(d.state);}catch(e){error(e.message||String(e));}
}

async function closeCouplesTopic(){
  clearError();
  const status=$('couplesCloseStatus').value;const note=($('couplesCloseNote').value||'').trim();
  try{const r=await fetch(`/api/couples/${encodeURIComponent(couplesSession.code)}/topic/close`,{method:'POST',headers:couplesHeaders(true),body:JSON.stringify({status,note})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Unable to submit the topic status.');$('couplesCloseNote').value='';renderCouplesState(d.state);}catch(e){error(e.message||String(e));}
}

async function proposeCouplesTopic(topic='',parkingId=''){
  clearError();
  const text=(topic||$('couplesNextTopic')?.value||'').trim();
  if(!text&&!parkingId){error('Enter or choose the next topic.');return;}
  const resolutionCriteria=($('couplesNextCriteria')?.value||'').trim();
  try{const r=await fetch(`/api/couples/${encodeURIComponent(couplesSession.code)}/topic/new`,{method:'POST',headers:couplesHeaders(true),body:JSON.stringify({topic:text,parking_id:parkingId,resolution_criteria:resolutionCriteria})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Unable to propose the next topic.');if($('couplesNextTopic'))$('couplesNextTopic').value='';if($('couplesNextCriteria'))$('couplesNextCriteria').value='';renderCouplesState(d.state);}catch(e){error(e.message||String(e));}
}

async function exportCouples(format){
  clearError();
  try{
    const r=await fetch(`/api/couples/${encodeURIComponent(couplesSession.code)}/export?format=${encodeURIComponent(format)}`,{headers:couplesHeaders(false)});
    if(!r.ok){const d=await r.json().catch(()=>({}));throw new Error(d.error||'Unable to export the session.');}
    const blob=await r.blob();const cd=r.headers.get('content-disposition')||'';const match=cd.match(/filename="([^"]+)"/);const filename=match?.[1]||`ClearSay_${couplesSession.code}.${format==='txt'?'txt':'json'}`;
    const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(e){error(e.message||String(e));}
}

function printCouplesSession(){
  const state=couplesSession.state;if(!state)return;
  const msgs=(state.messages||[]).map(m=>`<article><div><strong>${escapeHtml(m.sender_name||m.sender_id)}</strong> <span>${escapeHtml(couplesTime(m.created_at))}</span></div><p>${escapeHtml(m.text).replace(/\n/g,'<br>')}</p>${m.shared_analysis?`<div class="analysis"><b>Shared analysis:</b> ${escapeHtml(m.shared_analysis.summary||'')}<br><b>Effect:</b> ${escapeHtml(m.shared_analysis.conversation_effect?.explanation||'')}<br><b>Topic relevance:</b> ${escapeHtml(humanize(m.shared_analysis.topic_relevance?.classification||'unclear'))} — ${escapeHtml(m.shared_analysis.topic_relevance?.explanation||'')}</div>`:''}</article>`).join('');
  const insight=state.insights?.analysis;const summary=insight?`<section><h2>Conversation Insights</h2><p>${escapeHtml(insight.summary||'')}</p><h3>Common ground</h3>${list(insight.common_ground)}<h3>Still disputed</h3>${list(insight.disputed_points)}</section>`:'';
  const legal=state.legal_notice?.acknowledgements||{};const legalRows=['A','B'].filter(id=>legal[id]?.accepted_at).map(id=>`<li>${escapeHtml(state.participants?.[id]?.name||`Person ${id}`)} — ${escapeHtml(new Date(legal[id].accepted_at).toLocaleString())} — ${escapeHtml(legal[id].version||'')}</li>`).join('');
  const legalBlock=`<section><h2>Legal acknowledgment record</h2><p>ClearSay requires the legal notice to be acknowledged before use.</p><ul>${legalRows||'<li>No acknowledgment metadata available in this temporary room.</li>'}</ul></section>`;
  const w=window.open('','_blank');if(!w){error('Allow pop-ups to print this session.');return;}
  w.document.write(`<!doctype html><html><head><title>ClearSay ${escapeHtml(state.code||'Session')}</title><style>body{font-family:Arial,sans-serif;max-width:850px;margin:32px auto;color:#1f2d33;line-height:1.45}article{border-top:1px solid #ddd;padding:12px 0}.analysis{background:#f5f7f8;padding:8px;margin-top:6px;font-size:.9em}h1,h2,h3{color:#173a49}.scope{margin-top:22px;color:#666;font-size:.85em}@media print{body{margin:0 18mm}}</style></head><body><h1>ClearSay — Couples Live</h1><p><b>Claim. Clarify. Connect.</b></p>${legalBlock}<p><b>Session:</b> ${escapeHtml(state.code||'')}<br><b>Topic:</b> ${escapeHtml(state.topic?.text||'')}<br><b>Status:</b> ${escapeHtml(topicStatusLabel(state.topic?.status||''))}</p>${msgs}${summary}<p class="scope">This report covers messages sent through this room and AI analysis of those messages. It does not independently verify outside events described by participants.</p></body></html>`);w.document.close();w.focus();setTimeout(()=>w.print(),250);
}

function renderCouplesState(state){
  if(!state)return;
  const previousSpeaker=couplesSession.state?.turn_control?.active_speaker||couplesSession.lastActiveSpeaker||'';
  const previousTurnNumber=Number(couplesSession.state?.turn_control?.turn_number||couplesSession.lastTurnNumber||0);
  couplesSession.state=state;
  couplesSession.participantId=state.participant_id||couplesSession.participantId;
  couplesSession.lastRevision=Number(state.revision??couplesSession.lastRevision);
  $('couplesRoomCode').textContent=state.code||couplesSession.code;
  const a=state.participants?.A,b=state.participants?.B;
  const med=state.mediator?.participant?.name?` • ${state.mediator.participant.name} observing`:'';
  $('couplesParticipants').textContent=(b?`${a?.name||'Person A'} and ${b.name}`:`${a?.name||'Person A'} • waiting for Person B to join`)+` • ${Number(state.session_minutes||30)} min session`+med;
  show('couplesLobby',false);show('couplesRoom',true);
  show('couplesEndBtn',couplesSession.participantId==='A');
  show('couplesEndSessionBtn',state.viewer_role!=='mediator'&&!state.session_ended_at);
  show('couplesContinueBtn',couplesSession.participantId==='A'&&Boolean(state.outcome?.carry_forward_recommended));
  const mediatorView=state.viewer_role==='mediator';
  $('couplesRefreshInsightsBtn').disabled=mediatorView||(state.messages||[]).length<2;
  show('couplesExportTxtBtn',!mediatorView);show('couplesExportJsonBtn',!mediatorView);show('couplesPrintBtn',!mediatorView);
  renderCouplesTopic(state);
  renderCouplesParking(state);
  renderCouplesClaimLedger(state);
  renderCouplesAgreements(state);
  renderCouplesEvidence(state);
  renderCouplesMediator(state);
  renderCouplesOutcome(state);
  renderCouplesRelevance(state);
  renderCouplesMessages(state);
  renderCouplesInsightsBox(state.insights);
  const latest=[...(state.messages||[])].reverse().find(m=>m.analysis_status==='ready'&&m.shared_analysis?.underlying_issue);
  if(state.carryover&&$('couplesCurrentInsight')){const c=state.carryover;$('couplesCurrentInsight').innerHTML=`<strong>Continuation from session ${escapeHtml(c.from_session||'')}</strong><div class="muted">Carried forward: ${(c.common_ground||[]).length} common-ground point(s), ${(c.still_disputed||[]).length} unresolved point(s), and ${(c.agreements_reached||[]).length} agreement(s).</div>`;show('couplesCurrentInsight',true);}
  if(latest||state.session_ended_at){
    const effect=latest?.shared_analysis?.conversation_effect||{};
    $('couplesCurrentInsight').innerHTML=`${state.session_ended_at?`<div class="couples-session-ended">${Number(state.session_minutes||30)}-minute session complete. Messaging is closed; review the conversation, build insights, or export the session.</div>`:''}${latest?.shared_analysis?.underlying_issue?`<strong>Current underlying issue:</strong> ${escapeHtml(latest.shared_analysis.underlying_issue)}${effect.explanation?`<div class="muted"><strong>Latest effect:</strong> ${escapeHtml(effect.explanation)}</div>`:''}`:''}`;
    show('couplesCurrentInsight',true);
  }else if(!state.carryover) show('couplesCurrentInsight',false);
  const newSpeaker=state?.turn_control?.active_speaker||'';const newTurnNumber=Number(state?.turn_control?.turn_number||0);
  if((previousSpeaker===couplesSession.participantId&&newSpeaker!==couplesSession.participantId)||(previousTurnNumber&&newTurnNumber!==previousTurnNumber&&newSpeaker!==couplesSession.participantId)){
    if($('couplesMessage'))$('couplesMessage').value='';
  }
  couplesSession.lastActiveSpeaker=newSpeaker;couplesSession.lastTurnNumber=newTurnNumber;
  startCouplesClock();
}

function renderCouplesLobby(){
  stopCouplesClock();
  show('couplesLobby',true);show('couplesRoom',false);show('couplesCurrentInsight',false);show('couplesRelevanceNotice',false);show('couplesInsights',false);show('couplesTurnPanel',false);show('couplesTurnReady',false);show('couplesListeningPanel',false);show('couplesComposer',false);
  if(couplesSession.code&&couplesSession.token){
    $('couplesJoinCode').value=couplesSession.code;
  }
}

async function fetchCouplesState(silent=true){
  if(!couplesSession.code||!couplesSession.token)return;
  try{
    const r=await fetch(`/api/couples/${encodeURIComponent(couplesSession.code)}/state`,{headers:couplesHeaders(false)});
    const d=await r.json();
    if(!r.ok){
      if(r.status===404||r.status===401){clearCouplesResume();renderCouplesLobby();if(!silent)error(d.error||'Couples Live room unavailable.');}
      else if(!silent)error(d.error||'Unable to refresh the room.');
      return;
    }
    saveCouplesResume();
    if(Number(d.revision)!==Number(couplesSession.lastRevision)||!couplesSession.state)renderCouplesState(d);
  }catch(e){if(!silent)error(e.message||String(e));}
}

function startCouplesPoll(){
  stopCouplesPoll();
  if(!couplesSession.code||!couplesSession.token)return;
  if(couplesSession.state)startCouplesClock();
  fetchCouplesState(false);
  couplesSession.pollTimer=setInterval(()=>{if(analysisMode==='couples')fetchCouplesState(true);},1500);
}

function stopCouplesPoll(){
  if(couplesSession.pollTimer){clearInterval(couplesSession.pollTimer);couplesSession.pollTimer=null;}
  stopCouplesClock();
}

async function createCouplesSession(){
  clearError();
  const name=($('couplesCreateName').value||'').trim();
  const topic=($('couplesCreateTopic').value||'').trim();
  const resolutionCriteria=($('couplesCreateCriteria')?.value||'').trim();
  const sessionMinutes=Number($('couplesCreateDuration')?.value||30);
  const consent=Boolean($('couplesCreateConsent')?.checked);
  if(!topic){error('Enter one topic or question for this Couples Live session.');return;}
  if(!consent){error('Confirm the shared-session consent before creating the room.');return;}
  $('couplesCreateBtn').disabled=true;
  try{
    const r=await fetch('/api/couples/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,topic,resolution_criteria:resolutionCriteria,session_minutes:sessionMinutes,consent:true,legal_ack:legalAckPayload()})});
    const d=await r.json();if(!r.ok)throw new Error(d.error||'Unable to create the session.');
    couplesSession={...couplesSession,code:d.code,token:d.token,participantId:d.participant_id,name:d.state?.participants?.[d.participant_id]?.name||name,state:d.state,lastRevision:-1};
    saveCouplesResume();renderCouplesState(d.state);startCouplesPoll();
  }catch(e){error(e.message||String(e));}
  finally{$('couplesCreateBtn').disabled=false;}
}

async function joinCouplesSession(){
  clearError();
  const code=($('couplesJoinCode').value||'').trim().toUpperCase();
  const name=($('couplesJoinName').value||'').trim();
  const consent=Boolean($('couplesJoinConsent')?.checked);
  if(!code){error('Enter the session code first.');return;}
  if(!consent){error('Confirm the shared-session consent before joining the room.');return;}
  $('couplesJoinBtn').disabled=true;
  try{
    const r=await fetch('/api/couples/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code,name,consent:true,legal_ack:legalAckPayload()})});
    const d=await r.json();if(!r.ok)throw new Error(d.error||'Unable to join the session.');
    couplesSession={...couplesSession,code:d.code,token:d.token,participantId:d.participant_id,name:d.state?.participants?.[d.participant_id]?.name||name,state:d.state,lastRevision:-1};
    saveCouplesResume();renderCouplesState(d.state);startCouplesPoll();
  }catch(e){error(e.message||String(e));}
  finally{$('couplesJoinBtn').disabled=false;}
}

async function startCouplesTurn(){
  clearError();
  if(!couplesSession.code||!couplesSession.token)return;
  const btn=$('couplesStartTurnBtn');if(btn)btn.disabled=true;
  try{
    const r=await fetch(`/api/couples/${encodeURIComponent(couplesSession.code)}/turn/start`,{method:'POST',headers:couplesHeaders(true),body:'{}'});
    const d=await r.json();if(!r.ok)throw new Error(d.error||'Unable to start your turn.');
    renderCouplesState(d.state);setTimeout(()=>$('couplesMessage')?.focus(),0);
  }catch(e){error(e.message||String(e));}
  finally{if(btn)btn.disabled=false;}
}

async function passCouplesTurn(){
  clearError();
  if(!couplesSession.code||!couplesSession.token)return;
  try{
    const r=await fetch(`/api/couples/${encodeURIComponent(couplesSession.code)}/turn/pass`,{method:'POST',headers:couplesHeaders(true),body:'{}'});
    const d=await r.json();if(!r.ok)throw new Error(d.error||'Unable to pass the turn.');
    if($('couplesMessage'))$('couplesMessage').value='';
    renderCouplesState(d.state);
  }catch(e){error(e.message||String(e));}
}

async function sendCouplesMessage(){
  clearError();
  const text=($('couplesMessage').value||'').trim();
  if(!text){return;}
  if(!couplesSession.code||!couplesSession.token){error('Create or join a Couples Live session first.');return;}
  if(couplesSession.state?.viewer_role==='mediator'){error('Therapist / mediator access is read-only.');return;}
  if(couplesSession.state?.session_ended_at){error(`This ${Number(couplesSession.state?.session_minutes||30)}-minute session has ended. Review or export it, then start a new session if needed.`);return;}
  if(couplesSession.state?.topic?.status!=='open'){error('Both people must confirm the current topic before messaging.');return;}
  const turn=couplesSession.state?.turn_control;
  if(turn?.active_speaker!==couplesSession.participantId){error('It is not your turn. Read the other person’s message and wait for the floor.');return;}
  if(turn?.status!=='active'){error('Start your 1:00 response turn before typing or sending.');return;}
  if(couplesTurnRemainingMsClient(couplesSession.state)<=0){error('Your 1:00 turn has ended. The floor is passing to the other person.');return;}
  $('couplesSendBtn').disabled=true;
  try{
    const r=await fetch(`/api/couples/${encodeURIComponent(couplesSession.code)}/message`,{method:'POST',headers:couplesHeaders(true),body:JSON.stringify({text})});
    const d=await r.json();if(!r.ok)throw new Error(d.error||'Unable to send the message.');
    $('couplesMessage').value='';
    await fetchCouplesState(false);
  }catch(e){error(e.message||String(e));}
  finally{$('couplesSendBtn').disabled=false;}
}

async function refreshCouplesInsights(){
  clearError();
  if(!couplesSession.code||!couplesSession.token)return;
  const btn=$('couplesRefreshInsightsBtn');const old=btn.textContent;btn.disabled=true;btn.textContent='Building insights…';
  try{
    const r=await fetch(`/api/couples/${encodeURIComponent(couplesSession.code)}/insights`,{method:'POST',headers:couplesHeaders(true),body:'{}'});
    const d=await r.json();if(!r.ok)throw new Error(d.error||'Unable to build conversation insights.');
    renderCouplesInsightsBox(d);await fetchCouplesState(true);
  }catch(e){error(e.message||String(e));}
  finally{btn.textContent=old;btn.disabled=((couplesSession.state?.messages||[]).length<2);}
}

async function copyCouplesCode(){
  const code=couplesSession.code||$('couplesRoomCode').textContent||'';
  try{await navigator.clipboard.writeText(code);$('couplesCopyCodeBtn').textContent='Copied';setTimeout(()=>$('couplesCopyCodeBtn').textContent='Copy code',1200);}catch{alert(code);}
}

function leaveCouplesRoom(){
  if(!window.confirm('Leave this room on this device? You will lose this participant token and may not be able to rejoin the same slot.'))return;
  clearCouplesResume();renderCouplesLobby();
}

async function endCouplesSessionEarly(){
  if(!window.confirm(`End the active ${Number(couplesSession.state?.session_minutes||30)}-minute session now? The conversation will remain available for review and export.`))return;
  try{const r=await fetch(`/api/couples/${encodeURIComponent(couplesSession.code)}/end`,{method:'POST',headers:couplesHeaders(true),body:'{}'});const d=await r.json();if(!r.ok)throw new Error(d.error||'Unable to end the session.');renderCouplesState(d.state);}catch(e){error(e.message||String(e));}
}

async function endCouplesRoom(){
  if(!window.confirm('End this Couples Live room for both people?'))return;
  try{
    const r=await fetch(`/api/couples/${encodeURIComponent(couplesSession.code)}`,{method:'DELETE',headers:couplesHeaders(false)});
    const d=await r.json();if(!r.ok)throw new Error(d.error||'Unable to end the room.');
    clearCouplesResume();renderCouplesLobby();
  }catch(e){error(e.message||String(e));}
}

function switchMode(mode){
  analysisMode=mode==='transcript'?'transcript':mode==='live'?'live':mode==='couples'?'couples':'statement';
  const statement=analysisMode==='statement', live=analysisMode==='live', couples=analysisMode==='couples', transcript=analysisMode==='transcript';
  show('statementMode',statement);show('liveMode',live);show('couplesMode',couples);show('transcriptMode',transcript);
  $('statementModeBtn').classList.toggle('selected',statement);$('liveModeBtn').classList.toggle('selected',live);$('couplesModeBtn').classList.toggle('selected',couples);$('transcriptModeBtn').classList.toggle('selected',transcript);
  $('statementModeBtn').setAttribute('aria-selected',String(statement));$('liveModeBtn').setAttribute('aria-selected',String(live));$('couplesModeBtn').setAttribute('aria-selected',String(couples));$('transcriptModeBtn').setAttribute('aria-selected',String(transcript));
  if(!couples)stopCouplesPoll();
  if(transcript){
    show('claimQualification',false);show('clarification',false);show('results',false);show('loading',false);clearError();
    setTimeout(()=>$('transcriptText')?.focus(),0);
  }else if(couples){
    show('claimQualification',false);show('clarification',false);show('results',false);show('loading',false);clearError();
    if(couplesSession.code&&couplesSession.token){startCouplesPoll();}else{renderCouplesLobby();setTimeout(()=>$('couplesCreateName')?.focus(),0);}
  }else if(live){
    show('claimQualification',false);if(session.source!=='live'){show('results',false);show('clarification',false);}clearError();renderLiveSession();
    if(liveSession.overview?.analysis)renderLiveOverview(liveSession.overview.analysis,liveSession.overview.meta||{});
    setTimeout(()=>$('liveStatement')?.focus(),0);
  }else if(statement && session.source!=='statement'){
    show('results',false);show('clarification',false);show('claimQualification',false);clearError();
  }
}

function transcriptTypeBadges(types=[]){
  return types.map(t=>`<span class="type-badge">${escapeHtml(titleType(t))}</span>`).join('');
}

function filteredTranscriptClaims(){
  const q=($('transcriptSearch')?.value||'').trim().toLowerCase();
  const speaker=$('transcriptSpeakerFilter')?.value||'all';
  const type=$('transcriptTypeFilter')?.value||'all';
  return transcriptSession.extracted.map((c,index)=>({...c,_index:index})).filter(c=>{
    if(speaker!=='all' && c.speaker!==speaker)return false;
    if(type!=='all' && !(c.claim_types||[]).includes(type))return false;
    if(q){
      const hay=[c.exact_claim,c.speaker,c.nearby_context,(c.claim_types||[]).map(titleType).join(' '),(c.local_candidates||[]).join(' ')].join(' ').toLowerCase();
      if(!hay.includes(q))return false;
    }
    return true;
  });
}

function renderTranscriptClaimPage(){
  const filtered=filteredTranscriptClaims();
  transcriptSession.filtered=filtered;
  const pageSize=transcriptSession.pageSize;
  const totalPages=Math.max(1,Math.ceil(filtered.length/pageSize));
  transcriptSession.page=Math.min(Math.max(1,transcriptSession.page),totalPages);
  const start=(transcriptSession.page-1)*pageSize;
  const pageItems=filtered.slice(start,start+pageSize);
  const cards=pageItems.map((c,offset)=>{
    const displayNumber=start+offset+1;
    const fallacyHints=(c.local_candidates||[]).length?`<div class="transcript-hints"><strong>Possible areas to test:</strong> ${c.local_candidates.map(x=>`<span class="signal">${escapeHtml(x)}</span>`).join(' ')}</div>`:'';
    return `<article class="transcript-claim-card">
      <div class="transcript-claim-head"><div><span class="speaker-badge">${escapeHtml(c.speaker||'Speaker')}</span>${c.relation?` <span class="relation-badge">${escapeHtml(humanize(c.relation))}</span>`:''}</div><span class="claim-index">Result ${displayNumber}</span></div>
      <blockquote>“${escapeHtml(c.exact_claim||'')}”</blockquote>
      <div class="claim-type-row">${transcriptTypeBadges(c.claim_types||[])}</div>
      ${c.nearby_context?`<p class="transcript-context"><strong>Nearby context:</strong> ${escapeHtml(c.nearby_context)}</p>`:''}
      ${fallacyHints}
      <button type="button" class="primary analyze-transcript-claim" data-claim-index="${c._index}">Analyze this statement</button>
    </article>`;
  }).join('');

  $('transcriptList').innerHTML=cards||'<p class="muted">No statements match these filters.</p>';
  $('transcriptCount').textContent=`Showing ${filtered.length?start+1:0}–${Math.min(start+pageSize,filtered.length)} of ${filtered.length} matching statements`;
  $('transcriptPageInfo').textContent=`Page ${transcriptSession.page} of ${totalPages}`;
  $('transcriptPrevBtn').disabled=transcriptSession.page<=1;
  $('transcriptNextBtn').disabled=transcriptSession.page>=totalPages;
  document.querySelectorAll('.analyze-transcript-claim').forEach(btn=>btn.addEventListener('click',()=>useTranscriptClaim(Number(btn.dataset.claimIndex))));
}

function renderTranscriptClaims(data){
  const claims=data.claims||[];
  transcriptSession.extracted=claims;
  transcriptSession.speakers=data.speakers||[...new Set(claims.map(c=>c.speaker).filter(Boolean))];
  transcriptSession.claimTypes=data.claim_types||[...new Set(claims.flatMap(c=>c.claim_types||[]))];
  transcriptSession.summary=data.summary||'';
  transcriptSession.page=1;

  const speakerOptions=transcriptSession.speakers.map(s=>`<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
  const typeOptions=transcriptSession.claimTypes.map(t=>`<option value="${escapeHtml(t)}">${escapeHtml(titleType(t))}</option>`).join('');
  $('transcriptResults').innerHTML=`
    <div class="transcript-result-head">
      <div class="section-kicker">CLAIMS FOUND</div>
      <h3>Choose the statement you want to analyze</h3>
      ${transcriptSession.summary?`<p class="muted transcript-summary">${escapeHtml(transcriptSession.summary)}</p>`:''}
    </div>
    <div class="transcript-controls">
      <input id="transcriptSearch" type="search" placeholder="Search statements, speakers, claim types…" aria-label="Search extracted statements">
      <select id="transcriptSpeakerFilter" aria-label="Filter by speaker"><option value="all">All speakers</option>${speakerOptions}</select>
      <select id="transcriptTypeFilter" aria-label="Filter by claim type"><option value="all">All claim types</option>${typeOptions}</select>
      <select id="transcriptPageSize" aria-label="Results per page"><option value="10">10 per page</option><option value="20" selected>20 per page</option><option value="30">30 per page</option></select>
    </div>
    <div class="transcript-browser-meta"><span id="transcriptCount"></span><span class="zero-token-note">Transcript extraction uses 0 AI tokens</span></div>
    <div id="transcriptList"></div>
    <div class="transcript-pagination">
      <button id="transcriptPrevBtn" class="secondary" type="button">Previous</button>
      <span id="transcriptPageInfo" class="muted"></span>
      <button id="transcriptNextBtn" class="secondary" type="button">Next</button>
    </div>`;
  show('transcriptResults',true);

  $('transcriptSearch').addEventListener('input',()=>{transcriptSession.page=1;renderTranscriptClaimPage();});
  $('transcriptSpeakerFilter').addEventListener('change',()=>{transcriptSession.page=1;renderTranscriptClaimPage();});
  $('transcriptTypeFilter').addEventListener('change',()=>{transcriptSession.page=1;renderTranscriptClaimPage();});
  $('transcriptPageSize').addEventListener('change',()=>{transcriptSession.pageSize=Number($('transcriptPageSize').value)||20;transcriptSession.page=1;renderTranscriptClaimPage();});
  $('transcriptPrevBtn').addEventListener('click',()=>{transcriptSession.page=Math.max(1,transcriptSession.page-1);renderTranscriptClaimPage();$('transcriptResults').scrollIntoView({behavior:'smooth',block:'start'});});
  $('transcriptNextBtn').addEventListener('click',()=>{transcriptSession.page+=1;renderTranscriptClaimPage();$('transcriptResults').scrollIntoView({behavior:'smooth',block:'start'});});
  renderTranscriptClaimPage();
}

async function extractTranscriptClaims(){
  clearError();
  const transcript=$('transcriptText').value.trim();
  if(!transcript){error('Paste a transcript first.');return;}
  transcriptSession.transcript=transcript;
  $('extractClaimsBtn').disabled=true;
  show('transcriptLoading',true);show('transcriptResults',false);
  try{
    const r=await fetch('/api/transcript/extract',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({transcript})});
    const d=await r.json();
    if(!r.ok) throw new Error(d.error||'Unable to find claims in the transcript.');
    renderTranscriptClaims(d);
  }catch(e){error(e.message||String(e));}
  finally{$('extractClaimsBtn').disabled=false;show('transcriptLoading',false);}
}

function useTranscriptClaim(index){
  const item=transcriptSession.extracted[index];
  if(!item)return;
  $('claim').value=item.exact_claim||'';
  const contextParts=[];
  if(item.speaker)contextParts.push(`Speaker: ${item.speaker}.`);
  if(item.nearby_context)contextParts.push(`Nearby transcript context: ${item.nearby_context}`);
  $('context').value=contextParts.join(' ');
  session.source='statement'; session.liveTurnId=null;
  switchMode('statement');
  window.scrollTo({top:0,behavior:'smooth'});
  setTimeout(()=>startQualification(),180);
}

function clearTranscript(){
  transcriptSession={transcript:'',extracted:[],filtered:[],page:1,pageSize:20,speakers:[],claimTypes:[],summary:''};
  $('transcriptText').value='';
  $('transcriptResults').innerHTML='';
  show('transcriptResults',false);show('transcriptLoading',false);clearError();
  $('transcriptText').focus();
}

async function startQualification(){
  clearError();
  session={claim:$('claim').value.trim(),context:$('context').value.trim(),round:0,answers:[],last:null,route:null,selectedClaimTypes:[],source:'statement',liveTurnId:null};
  if(!session.claim){error('Enter a claim or statement first.');return;}
  show('clarification',false);show('results',false);show('claimQualification',false);
  setRoutingBusy(true);
  try{
    const r=await fetch('/api/route',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({claim:session.claim,context:session.context,forced_claim_types:session.selectedClaimTypes})});
    const d=await r.json();
    if(!r.ok) throw new Error(d.error||'Unable to clarify the claim.');
    session.route=d;
    renderClaimQualification(d);
    show('claimQualification',true);
    $('claimQualification').scrollIntoView({behavior:'smooth',block:'start'});
  }catch(e){error(e.message||String(e));}
  finally{setRoutingBusy(false);}
}

async function runAI(isFollowup=false){
  clearError();
  if(isFollowup){
    collectAnswers();
    session.round += 1;
  }
  setBusy(true);show('clarification',false);show('claimQualification',false);
  try{
    const r=await fetch('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({claim:session.claim,context:session.context,round:session.round,answers:session.answers})});
    const d=await r.json();
    if(!r.ok) throw new Error(d.error||'Analysis failed.');
    session.last=d;
    captureLiveAnalysis(d);
    renderResults(d.analysis,d.meta);
    saveHistoryEntry();
    if(session.source==='live'){
      // Quick Live is response-first. Adaptive qualifying questions stay inside the
      // live response card and are only surfaced when addressing the other person.
      show('clarification',false);
      $('results').scrollIntoView({behavior:'smooth',block:'start'});
    } else if(d.analysis.status==='needs_clarification' && d.analysis.questions?.length){
      renderQuestions(d.analysis.questions);show('clarification',true);$('clarification').scrollIntoView({behavior:'smooth',block:'start'});
    } else {show('clarification',false);$('results').scrollIntoView({behavior:'smooth',block:'start'});}
  }catch(e){error(e.message||String(e));}
  finally{setBusy(false);}
}

function claimQuestionInput(q,i){
  const id=`cq-${i}`;
  if(q.answer_type==='yes_no') return `<div class="yn claim-yn" data-qid="${id}"><button type="button" data-val="Yes">Yes</button><button type="button" data-val="No">No</button><button type="button" data-val="I don’t know">I don’t know</button></div><input type="hidden" id="${id}" data-question="${escapeHtml(q.question)}">`;
  if(q.answer_type==='choice' && q.options?.length) return `<select id="${id}" data-question="${escapeHtml(q.question)}"><option value="">Choose…</option>${q.options.map(o=>`<option>${escapeHtml(o)}</option>`).join('')}<option>I don’t know</option></select>`;
  if(q.answer_type==='number') return `<input id="${id}" data-question="${escapeHtml(q.question)}" inputmode="numeric" placeholder="Number, range, or ‘I don’t know’">`;
  return `<textarea id="${id}" data-question="${escapeHtml(q.question)}" rows="2" placeholder="Your answer — or leave blank if unknown"></textarea>`;
}

async function refreshQualificationForSelectedTypes(){
  // Preserve answers already entered before rebuilding the local qualification form.
  collectClaimAnswers();
  setRoutingBusy(true);
  try{
    const r=await fetch('/api/route',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({claim:session.claim,context:session.context,forced_claim_types:session.selectedClaimTypes})});
    const d=await r.json();
    if(!r.ok) throw new Error(d.error||'Unable to update claim type.');
    session.route=d;
    renderClaimQualification(d);
    restoreClaimAnswers();
  }catch(e){error(e.message||String(e));}
  finally{setRoutingBusy(false);}
}

function restoreClaimAnswers(){
  for(const a of session.answers){
    const el=[...document.querySelectorAll('#claimQuestionList [data-question]')].find(x=>x.dataset.question===a.question);
    if(!el) continue;
    el.value=a.answer;
    const wrap=el.closest('.claim-qualifier')?.querySelector('.yn');
    if(wrap){wrap.querySelectorAll('button').forEach(b=>b.classList.toggle('selected',b.dataset.val===a.answer));}
  }
  updateClaimQuestionVisibility();
}

function renderClaimTypeChoices(route){
  const detected=new Set(route.detected_claim_types||route.claim_types||[]);
  const selected=new Set(session.selectedClaimTypes);
  $('claimTypeChoices').innerHTML=CLAIM_TYPE_OPTIONS.map(([id,label])=>{
    const on=selected.has(id);
    const detectedMark=detected.has(id)?' • detected':'';
    const repair=id==='repair_status'?' repair':'';
    return `<button type="button" class="claim-type-choice${repair}${on?' selected':''}" data-claim-type="${id}" aria-pressed="${on}">${escapeHtml(label)}${detectedMark}</button>`;
  }).join('');
  document.querySelectorAll('.claim-type-choice').forEach(btn=>btn.addEventListener('click',()=>{
    const id=btn.dataset.claimType;
    const set=new Set(session.selectedClaimTypes);
    if(set.has(id)) set.delete(id); else set.add(id);
    session.selectedClaimTypes=[...set];
    refreshQualificationForSelectedTypes();
  }));
}

function renderClaimQualification(route){
  const types=(route.claim_types||[]);
  renderClaimTypeChoices(route);
  const detected=(route.detected_claim_types||types);
  $('detectedClaimTypes').innerHTML=detected.map(t=>`<span class="type-badge">${escapeHtml(titleType(t))}</span>`).join('');
  const qs=route.qualifying_questions||[];
  $('claimQuestionList').innerHTML=qs.map((q,i)=>{
    const conditional=q.show_if_question?` data-show-if-question="${escapeHtml(q.show_if_question)}" data-show-if-values="${escapeHtml(JSON.stringify(q.show_if_values||[]))}"`:'';
    const label=q.claim_type==='universal'?'Main purpose':escapeHtml(titleType(q.claim_type));
    return `<div class="question claim-qualifier"${conditional}><div class="qualifier-label">${label}</div><strong>${i+1}. ${escapeHtml(q.question)}</strong><div class="why">Why this matters: ${escapeHtml(q.why_needed||'This helps clarify what kind of claim is actually being made.')}</div>${claimQuestionInput(q,i)}</div>`;
  }).join('');
  document.querySelectorAll('.claim-yn button').forEach(b=>b.addEventListener('click',()=>{const wrap=b.closest('.claim-yn');wrap.querySelectorAll('button').forEach(x=>x.classList.remove('selected'));b.classList.add('selected');$(wrap.dataset.qid).value=b.dataset.val;updateClaimQuestionVisibility();}));
  document.querySelectorAll('#claimQuestionList select,#claimQuestionList textarea,#claimQuestionList input').forEach(el=>el.addEventListener('change',updateClaimQuestionVisibility));
  updateClaimQuestionVisibility();
}

function answerForQuestion(question){
  const el=[...document.querySelectorAll('#claimQuestionList [data-question]')].find(x=>x.dataset.question===question);
  return (el?.value||'').trim();
}

function updateClaimQuestionVisibility(){
  document.querySelectorAll('#claimQuestionList .claim-qualifier[data-show-if-question]').forEach(card=>{
    const parentQuestion=card.dataset.showIfQuestion||'';
    let values=[];
    try{values=JSON.parse(card.dataset.showIfValues||'[]');}catch{}
    const answer=answerForQuestion(parentQuestion);
    const visible=values.includes(answer);
    card.classList.toggle('conditional-hidden',!visible);
    if(!visible){
      card.querySelectorAll('[data-question]').forEach(el=>{el.value='';});
      card.querySelectorAll('.yn button').forEach(b=>b.classList.remove('selected'));
    }
  });
}

function collectClaimAnswers(){
  document.querySelectorAll('#claimQuestionList [data-question]').forEach(el=>{
    const card=el.closest('.claim-qualifier');
    if(card?.classList.contains('conditional-hidden'))return;
    const answer=(el.value||'').trim(); if(!answer)return;
    const question=el.dataset.question;
    const prior=session.answers.find(a=>a.question===question); if(prior)prior.answer=answer;else session.answers.push({question,answer});
  });
}

function continueFromQualification(){
  collectClaimAnswers();
  const typeQuestion="User-selected claim type(s)";
  session.answers=session.answers.filter(a=>a.question!==typeQuestion);
  if(session.selectedClaimTypes.length){session.answers.push({question:typeQuestion,answer:session.selectedClaimTypes.map(titleType).join(", ")});}
  show('claimQualification',false);
  runAI(false);
}

function renderQuestions(qs){
  $('questionList').innerHTML=qs.map((q,i)=>{
    const id=`q-${i}`; let input='';
    if(q.answer_type==='yes_no') input=`<div class="yn" data-qid="${id}"><button type="button" data-val="Yes">Yes</button><button type="button" data-val="No">No</button><button type="button" data-val="I don’t know">I don’t know</button></div><input type="hidden" id="${id}" data-question="${escapeHtml(q.question)}">`;
    else if(q.answer_type==='choice' && q.options?.length) input=`<select id="${id}" data-question="${escapeHtml(q.question)}"><option value="">Choose…</option>${q.options.map(o=>`<option>${escapeHtml(o)}</option>`).join('')}<option>I don’t know</option></select>`;
    else if(q.answer_type==='number') input=`<input id="${id}" data-question="${escapeHtml(q.question)}" inputmode="numeric" placeholder="Number, range, or ‘I don’t know’">`;
    else input=`<textarea id="${id}" data-question="${escapeHtml(q.question)}" rows="2" placeholder="Your answer — or ‘I don’t know’"></textarea>`;
    return `<div class="question"><strong>${i+1}. ${escapeHtml(q.question)}</strong><div class="why">Why this matters: ${escapeHtml(q.why_needed)}</div>${input}</div>`;
  }).join('');
  document.querySelectorAll('.yn button').forEach(b=>b.addEventListener('click',()=>{const wrap=b.closest('.yn');wrap.querySelectorAll('button').forEach(x=>x.classList.remove('selected'));b.classList.add('selected');$(wrap.dataset.qid).value=b.dataset.val;}));
}

function collectAnswers(){
  document.querySelectorAll('#questionList [data-question]').forEach(el=>{
    const answer=(el.value||'').trim(); if(!answer)return;
    const question=el.dataset.question;
    const prior=session.answers.find(a=>a.question===question); if(prior)prior.answer=answer;else session.answers.push({question,answer});
  });
}

function statusBadge(status){return `<span class="status-badge status-${escapeHtml(status)}">${escapeHtml(status.replaceAll('_',' '))}</span>`;}
function list(items){return items?.length?`<ul>${items.map(x=>`<li>${escapeHtml(x)}</li>`).join('')}</ul>`:'<div class="muted">None identified.</div>';}
function humanize(s=''){return String(s||'').replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());}


function fallacyToolkit(f){
  const clarify=(f.clarify_questions||[]).length?list(f.clarify_questions):'<div class="muted">No local clarifying questions.</div>';
  const challenge=(f.challenge_questions||[]).length?list(f.challenge_questions):'<div class="muted">No local challenge questions.</div>';
  const r=f.responses||{};
  const signals=(f.matched_signals||[]).length?`<div class="signal-row"><strong>Local signals:</strong> ${f.matched_signals.map(x=>`<span class="signal">${escapeHtml(x)}</span>`).join(' ')}</div>`:'';
  return `<details class="toolkit" open>
    <summary>Clarify it • challenge it • respond</summary>
    ${signals}
    <div class="toolkit-grid">
      <div class="toolbox"><div class="tool-title">1. Clarify before labeling</div>${clarify}</div>
      <div class="toolbox"><div class="tool-title">2. Challenge the reasoning</div>${challenge}</div>
    </div>
    <div class="tool-title response-title">3. Response / rebuttal options</div>
    <div class="responses">
      <div class="response"><strong>Curious</strong><p>${escapeHtml(r.curious||f.corrective_question||'')}</p></div>
      <div class="response"><strong>Direct</strong><p>${escapeHtml(r.direct||f.better_move||'')}</p></div>
      <div class="response"><strong>De-escalating</strong><p>${escapeHtml(r.deescalating||f.better_move||'')}</p></div>
    </div>
    <div class="routing-note">These are prompts to test the reasoning, not proof that the conclusion is false.</div>
  </details>`;
}

function relevanceBadge(r='unclear'){
  const v=String(r||'unclear');
  return `<span class="relevance-badge relevance-${escapeHtml(v)}">${escapeHtml(humanize(v))} relevance</span>`;
}

function renderRepairEvidenceMapping(m){
  if(!m?.applies)return '';
  const items=(m.evidence_items||[]).map(item=>`<div class="repair-evidence-item">
    <div class="repair-evidence-head"><span class="type-badge">${escapeHtml(humanize(item.evidence_role||'other'))}</span>${statusBadge(item.status||'unknown')}${relevanceBadge(item.relevance_to_repair)}</div>
    <div class="claim-text">“${escapeHtml(item.statement||'')}”</div>
    <div class="repair-evidence-grid">
      <div><strong>What it establishes</strong><p>${escapeHtml(item.what_it_establishes||'')}</p></div>
      <div><strong>What it does not establish</strong><p>${escapeHtml(item.what_it_does_not_establish||'')}</p></div>
    </div>
  </div>`).join('');
  return `<section class="card full repair-map-card"><div class="section-kicker">REPAIR EVIDENCE MAPPING</div><h2>What each premise actually proves about repair</h2>
    <div class="result-grid repair-summary-grid">
      <div><strong>Behavioral repair</strong><p>${escapeHtml(m.behavioral_repair||'Unknown')}</p></div>
      <div><strong>Emotional resolution</strong><p>${escapeHtml(m.emotional_resolution||'Unknown')}</p></div>
    </div>
    <p><strong>Support for the repair conclusion:</strong> ${escapeHtml(humanize(m.conclusion_support||'not_applicable'))}</p>
    ${items||'<div class="muted">No repair evidence items were identified.</div>'}
    <div class="quote repair-warning"><strong>Overall assessment:</strong> ${escapeHtml(m.overall_assessment||'')}</div>
    <p class="repair-guardrail"><strong>Reasoning guardrail:</strong> ${escapeHtml(m.reasoning_warning||'Residual pain does not by itself prove zero repair, and repair effort does not by itself prove complete repair.')}</p>
  </section>`;
}

function renderDependencies(items){
  if(!items?.length)return '';
  return `<section class="card full"><div class="section-kicker">CLAIM DEPENDENCIES</div><h2>Which conclusions depend on earlier premises?</h2><div class="dependency-list">${items.map(x=>`<div class="dependency-row"><div><strong>Premise</strong><p>${escapeHtml(x.premise||'')}</p>${statusBadge(x.premise_status||'unknown')}</div><div class="dependency-arrow">→</div><div><strong>Conclusion</strong><p>${escapeHtml(x.conclusion||'')}</p><div class="muted">If the premise is weak: ${escapeHtml(x.effect_if_weak||'')}</div></div></div>`).join('')}</div></section>`;
}

function renderContradictions(items){
  if(!items?.length)return '';
  return `<section class="card"><div class="section-kicker">CONTRADICTIONS / TENSIONS</div><h2>Statements that need reconciliation</h2>${items.map(x=>`<div class="mini-analysis"><span class="type-badge">${escapeHtml(humanize(x.kind||'tension'))}</span><p><strong>A:</strong> ${escapeHtml(x.statement_a||'')}</p><p><strong>B:</strong> ${escapeHtml(x.statement_b||'')}</p><div class="muted">${escapeHtml(x.assessment||'')}</div></div>`).join('')}</section>`;
}


function responseSetForAnalysis(a,target='other_person'){
  const therapist=target==='therapist';
  const options=therapist?(a?.therapist_response_options||{}):(a?.response_options||{});
  return {
    best: therapist?(a?.therapist_suggested_response||''):(a?.suggested_response||''),
    clarify: options.clarify||'', evidence: options.evidence||'', direct: options.direct||'', deescalating: options.deescalating||''
  };
}

function selectGeneralResponseTarget(target){
  if(!['other_person','therapist'].includes(target))return;
  generalResponseTarget=target;
  const a=session.last?.analysis;if(!a)return;
  const set=responseSetForAnalysis(a,target);
  document.querySelectorAll('.general-response-target').forEach(btn=>btn.classList.toggle('selected',btn.dataset.responseTarget===target));
  if($('generalResponseAudience'))$('generalResponseAudience').textContent=responseTargetLabel(target);
  if($('generalResponseQuote'))$('generalResponseQuote').textContent=set.best;
  for(const key of ['clarify','evidence','direct','deescalating']){
    const el=$(`generalResponse-${key}`);if(el)el.textContent=set[key]||'';
  }
}

function renderResults(a,meta){
  const parts=(a.claim_parts||[]).map(p=>`<div class="claim-part"><div>${statusBadge(p.status)} <span class="type-badge">${escapeHtml(titleType(p.type))}</span></div><div class="claim-text">“${escapeHtml(p.text)}”</div><div class="muted">${escapeHtml(p.explanation)}</div></div>`).join('');
  const fallacies=(a.likely_fallacies||[]).map((f,i)=>`<div class="fallacy"><div class="fallacy-head"><div><span class="group-badge">${escapeHtml(f.group||'')}</span><h3>${i+1}. ${escapeHtml(f.name||`Trap #${f.fallacy_id}`)}</h3></div><div class="score">${f.match_score}% match</div></div><div class="meter"><span style="width:${Math.max(0,Math.min(100,f.match_score))}%"></span></div><p><strong>Definition:</strong> ${escapeHtml(f.definition||'')}</p><p>${escapeHtml(f.why_it_fits)}</p><div class="result-grid"><div><strong>What supports the match</strong>${list(f.evidence_for_match)}</div><div><strong>What would weaken it</strong>${list(f.what_would_weaken_match)}</div></div><p><strong>AI corrective question:</strong> ${escapeHtml(f.corrective_question)}</p><p><strong>Better move:</strong> ${escapeHtml(f.better_move||'')}</p>${fallacyToolkit(f)}</div>`).join('');
  const bridge=a.reasoning_bridge||{};
  const repair=a.repair_status||{};
  const outcome=a.reasoning_outcome||{};
  const evidence=a.evidence_assessment||{};
  const certainty=a.claim_certainty||{};
  const repairSection=repair.applies?`<section class="card full"><div class="section-kicker">REPAIR STATUS</div><h2>${escapeHtml(humanize(repair.classification||'unclear'))}</h2><div class="result-grid"><div><strong>Original issue</strong><p>${escapeHtml(repair.original_issue||'Not established')}</p></div><div><strong>Repair actions</strong><p>${escapeHtml(repair.repair_actions||'Not established')}</p></div><div><strong>Behavior afterward</strong><p>${escapeHtml(repair.behavior_after||'Unknown')}</p></div><div><strong>What remains unresolved</strong><p>${escapeHtml(repair.what_remains_unresolved||'Unclear')}</p></div></div><div class="quote">${escapeHtml(repair.assessment||'')}</div></section>`:'';
  const repairEvidenceSection=renderRepairEvidenceMapping(a.repair_evidence_mapping);
  const dependencySection=renderDependencies(a.claim_dependencies);
  const contradictionSection=renderContradictions(a.contradictions);
  const counter=a.counterexample_test||{};
  const counterSection=counter.applies?`<section class="card"><div class="section-kicker">COUNTEREXAMPLE TEST</div><h2>Would an exception change the literal claim?</h2><p><strong>Literal claim:</strong> ${escapeHtml(counter.literal_claim||'')}</p><p>${escapeHtml(counter.counterexample_effect||'')}</p><div class="quote"><strong>Underlying concern:</strong> ${escapeHtml(counter.underlying_concern||'')}</div></section>`:'';
  const agreement=a.agreement_status||{};
  const agreementShift=agreement.retroactive_standard_issue?`<div class="agreement-warning"><strong>Possible standard shift:</strong> Later requirements appear to be used to redefine whether the original agreement was fulfilled. This can resemble Moving the Goalposts, but only if the original terms, fulfillment, and later timing are sufficiently established.</div>`:'';
  const agreementSection=agreement.applies?`<section class="card full agreement-card"><div class="section-kicker">AGREEMENT VERIFICATION</div><h2>${escapeHtml(humanize(agreement.existence||'unclear'))}</h2><div class="agreement-grid"><div><strong>Original terms</strong><p>${escapeHtml(agreement.original_terms||'Not established')}</p></div><div><strong>Mutual assent</strong><p>${escapeHtml(humanize(agreement.mutual_assent||'unknown'))}</p></div><div><strong>Duration / condition</strong><p>${escapeHtml(humanize(agreement.duration_condition||'unknown'))}</p></div><div><strong>Original fulfillment</strong><p>${escapeHtml(humanize(agreement.fulfillment_status||'unknown'))}</p></div><div><strong>Later change</strong><p>${escapeHtml(humanize(agreement.change_status||'unclear'))}</p></div><div><strong>Later acceptance</strong><p>${escapeHtml(humanize(agreement.later_acceptance||'not_applicable'))}</p></div></div>${agreement.changed_terms?`<p><strong>What changed:</strong> ${escapeHtml(agreement.changed_terms)}</p>`:''}<p>${escapeHtml(agreement.assessment||'')}</p>${agreement.current_effect?`<div class="quote"><strong>What this means now:</strong> ${escapeHtml(agreement.current_effect)}</div>`:''}${agreementShift}</section>`:'';
  const severity=a.severity_frequency||{};
  const severitySection=severity.applies?`<section class="card"><div class="section-kicker">FREQUENCY ≠ SEVERITY</div><h2>How often and how serious are separate questions</h2><p><strong>Frequency:</strong> ${escapeHtml(severity.frequency||'Unknown')}</p><p><strong>Severity:</strong> ${escapeHtml(severity.severity||'Unknown')}</p><p>${escapeHtml(severity.assessment||'')}</p></section>`:'';
  const changes=(a.what_would_change_result||[]).length?`<section class="card"><div class="section-kicker">WHAT WOULD CHANGE THE RESULT?</div><h2>Evidence or clarification that matters</h2>${list(a.what_would_change_result)}</section>`:'';
  const disagreement=a.disagreement||{};
  const disagreementSection=`<section class="card"><div class="section-kicker">WHAT KIND OF DISAGREEMENT REMAINS?</div><h2>${escapeHtml(humanize(disagreement.type||'none_apparent'))}</h2><p>${escapeHtml(disagreement.explanation||'')}</p></section>`;
  const cost=meta?.estimated_cost_usd!=null?` • est. API cost $${Number(meta.estimated_cost_usd).toFixed(4)}`:'';
  const routing=meta?.candidate_fallacies_sent!=null?` • local search narrowed 100 → ${meta.candidate_fallacies_sent} candidates`:'';
  const local=meta?.local_keyword_matches!=null?` • ${meta.local_keyword_matches} local signal hits`:'';
  const compact=meta?.compact_retry?' • compact retry used':'';
  const currentLiveTurn=session.source==='live'?liveTurnById(session.liveTurnId):null;
  const selectedLiveKey=currentLiveTurn?.selected_response_key||'best';
  const selectedLiveTarget=currentLiveTurn?.response_target||liveSession.responseTarget||'other_person';
  const liveSet=responseSetForAnalysis(a,selectedLiveTarget);
  const liveResponseTargetSwitch=session.source==='live'?`<div class="response-target-wrap"><div class="live-response-prompt"><strong>Respond to</strong><span class="muted">Choose who you are addressing. This does not rerun the analysis.</span></div><div class="response-target-switch"><button type="button" class="response-target-btn live-response-target ${selectedLiveTarget==='other_person'?'selected':''}" data-response-target="other_person">Other person</button><button type="button" class="response-target-btn live-response-target ${selectedLiveTarget==='therapist'?'selected':''}" data-response-target="therapist">Therapist</button></div></div>`:'';
  const liveResponseChoices=session.source==='live'?`<div class="live-response-alternatives"><div class="live-response-prompt"><strong>Choose the wording that fits the moment</strong><span class="muted">The selected option is what “Used it” will add to the session.</span></div><div class="live-response-choice-grid">${[
    ['best','Recommended',liveSet.best],
    ['clarify','Clarify',liveSet.clarify],
    ['evidence','Evidence',liveSet.evidence],
    ['direct','Direct',liveSet.direct],
    ['deescalating','De-escalate',liveSet.deescalating]
  ].filter(x=>x[2]).map(([key,label,text])=>`<button type="button" class="live-response-choice ${selectedLiveKey===key?'selected':''}" data-live-response-key="${key}"><strong>${label}</strong><span>${escapeHtml(text)}</span></button>`).join('')}</div></div>`:'';
  const liveResponseControls=session.source==='live'?`<div class="live-response-controls"><div class="live-response-prompt"><strong>Did you use the selected response?</strong><span class="muted">Only confirmed responses become your side of the session history.</span></div><div class="actions"><button id="liveUsedResponseBtn" class="primary" type="button">Used it</button><button id="liveModifiedResponseBtn" class="secondary" type="button">Modified it</button><button id="liveDidNotUseResponseBtn" class="secondary" type="button">Didn't use it</button></div><div id="liveModifiedWrap" class="hidden"><label for="liveModifiedText">What did you actually say?</label><textarea id="liveModifiedText" rows="3" maxlength="1800"></textarea><div class="actions"><button id="saveModifiedLiveResponseBtn" class="primary" type="button">Save my response</button></div></div><div id="liveResponseStatus" class="live-response-status"></div><div class="actions"><button id="nextLiveStatementBtn" class="secondary" type="button">+ What did they say next?</button></div></div>`:'';
  const selectedLiveText=currentLiveTurn?liveResponseText(currentLiveTurn,selectedLiveKey,selectedLiveTarget):liveSet.best;
  const liveQuickPanel=session.source==='live'?`<section class="card full live-quick-response-card"><div class="section-kicker">QUICK LIVE RESPONSE</div>${liveResponseTargetSwitch}<h2 id="liveSelectedResponseTitle">${selectedLiveKey==='best'?'Best next response':`Selected response — ${escapeHtml(liveResponseLabel(selectedLiveKey))}`} to ${escapeHtml(responseTargetLabel(selectedLiveTarget))}</h2><div id="liveSelectedResponseText" class="quote">${escapeHtml(selectedLiveText)}</div>${liveResponseChoices}${liveResponseControls}</section>`:'';
  const generalSet=responseSetForAnalysis(a,generalResponseTarget);
  const generalResponsePanel=session.source==='live'?'':`<section class="card full response-panel"><div class="section-kicker">RESPONSE</div><h2>What to say next</h2><div class="response-target-wrap"><div class="live-response-prompt"><strong>Respond to</strong><span class="muted">Switch the audience without rerunning the analysis.</span></div><div class="response-target-switch"><button type="button" class="response-target-btn general-response-target ${generalResponseTarget==='other_person'?'selected':''}" data-response-target="other_person">Other person</button><button type="button" class="response-target-btn general-response-target ${generalResponseTarget==='therapist'?'selected':''}" data-response-target="therapist">Therapist</button></div></div><p class="muted">Recommended wording to <strong id="generalResponseAudience">${escapeHtml(responseTargetLabel(generalResponseTarget))}</strong></p><div id="generalResponseQuote" class="quote">${escapeHtml(generalSet.best)}</div><details class="response-alternatives-details"><summary>Alternative responses</summary><div class="live-response-choice-grid"><div class="response-alt-card"><strong>Clarify</strong><span id="generalResponse-clarify">${escapeHtml(generalSet.clarify)}</span></div><div class="response-alt-card"><strong>Evidence</strong><span id="generalResponse-evidence">${escapeHtml(generalSet.evidence)}</span></div><div class="response-alt-card"><strong>Direct</strong><span id="generalResponse-direct">${escapeHtml(generalSet.direct)}</span></div><div class="response-alt-card"><strong>De-escalate</strong><span id="generalResponse-deescalating">${escapeHtml(generalSet.deescalating)}</span></div></div></details></section>`;

  if(session.source==='live'){
    const liveQuestions=(a.questions||[]);
    const qualifierList=liveQuestions.length?liveQuestions.map((q,i)=>`<div class="live-qualifier-item"><strong>${i+1}. ${escapeHtml(q.question||'')}</strong>${q.why_needed?`<div class="muted">${escapeHtml(q.why_needed)}</div>`:''}</div>`).join(''):'';
    const liveQualifierPanel=liveQuestions.length?`<details id="liveQualifyingQuestions" class="live-qualifying-details ${selectedLiveTarget==='other_person'?'':'hidden'}"><summary>Qualifying questions to ask them <span class="detail-count">${liveQuestions.length}</span></summary><p class="muted">Use these only if you need more information before treating the analysis as settled. If they answer, enter the answer as their next statement.</p>${qualifierList}</details>`:'';
    const preliminary=a.status==='needs_clarification'?'<div class="live-preliminary-note"><strong>Preliminary:</strong> More information could change the analysis, so the response is weighted toward clarification rather than a verdict.</div>':'';
    const liveFallacySummary=(a.likely_fallacies||[]).length?(a.likely_fallacies||[]).map(f=>`<div class="mini-analysis"><div><span class="group-badge">${escapeHtml(f.group||'')}</span> <strong>${escapeHtml(f.name||'Reasoning issue')}</strong> <span class="muted">${Number(f.match_score||0)}% match</span></div><p>${escapeHtml(f.why_it_fits||'')}</p></div>`).join(''):'<p class="muted">No strong fallacy match identified. The statement may need clarification or may not contain a clear reasoning error.</p>';
    const evidenceAgreement=`<div class="live-detail-grid"><div><h3>Evidence quality</h3><p><strong>${escapeHtml(humanize(evidence.quality||'unknown'))}</strong></p><p>${escapeHtml(evidence.assessment||'')}</p><p class="muted"><strong>Strongest source:</strong> ${escapeHtml(evidence.strongest_source||'Not identified')}</p><p class="muted"><strong>Missing:</strong> ${escapeHtml(evidence.missing_evidence||'Nothing specified')}</p></div><div><h3>Burden of proof</h3><p>${escapeHtml(a.burden_of_proof?.explanation||'')}</p>${a.burden_of_proof?.next_move?`<div class="quote">${escapeHtml(a.burden_of_proof.next_move)}</div>`:''}</div></div>${agreementSection||'<p class="muted">No agreement issue identified in this statement.</p>'}`;
    const repairDetail=(repairSection||repairEvidenceSection)?`${repairSection}${repairEvidenceSection}`:'<p class="muted">No repair-status issue identified in this statement.</p>';
    const unresolvedDetail=`<div class="live-detail-grid"><div><h3>Still unresolved</h3>${list(a.unresolved_points)}</div><div><h3>What would change the result?</h3>${list(a.what_would_change_result)}</div></div>`;
    const commonGroundDetail=`<div class="live-detail-grid"><div><h3>Established / supported</h3>${list(a.established_points)}</div><div><h3>Current disagreement</h3><p><strong>${escapeHtml(humanize(disagreement.type||'none_apparent'))}</strong></p><p>${escapeHtml(disagreement.explanation||'')}</p></div></div>`;
    const fullReasoning=`<section class="live-subsection"><div class="section-kicker">REASONING BRIDGE</div><div class="bridge"><div class="bridge-box"><strong>Starting point</strong><br>${escapeHtml(bridge.starting_point||'')}</div><div class="bridge-arrow">→</div><div class="bridge-box"><strong>Added inference</strong><br>${escapeHtml(bridge.added_inference||'')}</div><div class="bridge-arrow">→</div><div class="bridge-box"><strong>Conclusion</strong><br>${escapeHtml(bridge.conclusion||'')}</div></div><p><strong>Bridge assessment:</strong> ${escapeHtml(bridge.bridge_assessment||'')}</p></section>${dependencySection}${contradictionSection}${counterSection}<section class="card"><div class="section-kicker">TIME / RELEVANCE</div><p><strong>Time scope:</strong> ${escapeHtml(a.temporal_relevance?.time_scope||'Not established')}</p><p>${escapeHtml(a.temporal_relevance?.assessment||'')}</p></section>${severitySection}<section class="card full"><div class="section-kicker">LIKELY REASONING TRAPS</div>${fallacies||'<p class="muted">No strong fallacy match yet.</p>'}</section><section class="card"><div class="section-kicker">MORE PRECISE WORDING</div><div class="quote">${escapeHtml(a.better_wording||'')}</div></section><section class="card"><div class="section-kicker">CHECK MY RESPONSE</div><textarea id="responseCheckText" rows="3" maxlength="1800" placeholder="Paste or write a response you want to check."></textarea><div class="actions"><button id="checkResponseBtn" class="primary" type="button">Analyze this response</button></div></section><section class="card"><strong>Caution:</strong> ${escapeHtml(a.caution||'')}</section><div class="copy-row"><button class="mini-btn" id="copyBtn">Copy analysis</button><button class="mini-btn" onclick="window.print()">Print / PDF</button></div>`;
    const liveQuickPanelCompact=`<section class="card live-quick-response-card live-primary-response"><div class="section-kicker">QUICK LIVE RESPONSE</div>${liveResponseTargetSwitch}${preliminary}<h2 id="liveSelectedResponseTitle">${selectedLiveKey==='best'?'Best next response':`Selected response — ${escapeHtml(liveResponseLabel(selectedLiveKey))}`} to ${escapeHtml(responseTargetLabel(selectedLiveTarget))}</h2><div id="liveSelectedResponseText" class="quote live-main-response">${escapeHtml(selectedLiveText)}</div>${liveResponseChoices}${liveQualifierPanel}${liveResponseControls}</section>`;
    const repairDetailsBlock=(repair.applies||a.repair_evidence_mapping?.applies)?`<details class="live-detail-card"><summary><span>4. Repair status</span><span class="detail-hint">Behavioral vs emotional repair</span></summary><div class="live-detail-body">${repairDetail}</div></details>`:'';
    $('results').innerHTML=`
      <div class="live-results-stack">
        ${liveQuickPanelCompact}
        <div class="live-detail-stack" aria-label="Analysis details">
          <details class="live-detail-card"><summary><span>1. Why this response?</span><span class="detail-hint">Reasoning summary</span></summary><div class="live-detail-body"><div class="analysis-verdict"><span class="type-badge">${escapeHtml(humanize(outcome.verdict||'insufficient_information'))}</span><span class="type-badge">${escapeHtml(humanize(outcome.confidence||'low'))} confidence</span></div><p>${escapeHtml(a.summary||'')}</p><p>${escapeHtml(outcome.explanation||'')}</p>${bridge.bridge_assessment?`<div class="quote"><strong>Key reasoning bridge:</strong> ${escapeHtml(bridge.bridge_assessment)}</div>`:''}</div></details>
          <details class="live-detail-card"><summary><span>2. Claim analysis</span><span class="detail-hint">Claim type & possible fallacies</span></summary><div class="live-detail-body"><h3>${escapeHtml(humanize(a.claim_status?.classification||'unknown'))}</h3><p>${escapeHtml(a.claim_status?.explanation||'')}</p>${parts||'<p class="muted">No claim parts returned.</p>'}<h3>Likely reasoning traps</h3>${liveFallacySummary}</div></details>
          <details class="live-detail-card"><summary><span>3. Evidence & agreements</span><span class="detail-hint">Support, burden & terms</span></summary><div class="live-detail-body">${evidenceAgreement}</div></details>
          ${repairDetailsBlock}
          <details class="live-detail-card"><summary><span>${repairDetailsBlock?'5':'4'}. Unresolved questions</span><span class="detail-hint">What is still missing?</span></summary><div class="live-detail-body">${unresolvedDetail}</div></details>
          <details class="live-detail-card"><summary><span>${repairDetailsBlock?'6':'5'}. Common ground & disputed points</span><span class="detail-hint">What can be parked?</span></summary><div class="live-detail-body">${commonGroundDetail}</div></details>
          <details class="live-detail-card"><summary><span>${repairDetailsBlock?'7':'6'}. Full reasoning details</span><span class="detail-hint">Show the complete analysis</span></summary><div class="live-detail-body">${fullReasoning}</div></details>
          <details class="live-detail-card"><summary><span>${repairDetailsBlock?'8':'7'}. Session history</span><span class="detail-hint">${liveSession.turns.length} entered statement${liveSession.turns.length===1?'':'s'}</span></summary><div id="liveHistoryInResults" class="live-detail-body">${liveSessionHistoryMarkup()}</div></details>
        </div>
      </div>`;
    show('results',true);
    if($('liveHistoryFallback'))$('liveHistoryFallback').classList.add('hidden');
    $('copyBtn')?.addEventListener('click',copyAnalysis);
    $('checkResponseBtn')?.addEventListener('click',analyzeProposedResponse);
    document.querySelectorAll('.live-response-target').forEach(btn=>btn.addEventListener('click',()=>selectLiveResponseTarget(btn.dataset.responseTarget)));
    document.querySelectorAll('.live-response-choice').forEach(btn=>btn.addEventListener('click',()=>selectLiveResponse(btn.dataset.liveResponseKey)));
    $('liveUsedResponseBtn')?.addEventListener('click',()=>markLiveResponse('used'));
    $('liveModifiedResponseBtn')?.addEventListener('click',()=>markLiveResponse('modified'));
    $('liveDidNotUseResponseBtn')?.addEventListener('click',()=>markLiveResponse('not_used'));
    $('saveModifiedLiveResponseBtn')?.addEventListener('click',saveModifiedLiveResponse);
    $('nextLiveStatementBtn')?.addEventListener('click',nextLiveStatement);
    if(currentLiveTurn)renderLiveResponseStatus(currentLiveTurn);
    renderLiveSession();
    return;
  }

  $('results').innerHTML=`
    <div class="result-grid">
      <section class="card summary-card full"><div class="section-kicker">CURRENT ANALYSIS</div><h2>${a.status==='needs_clarification'?'Preliminary analysis':'Analysis ready'}</h2><p>${escapeHtml(a.summary)}</p><div class="analysis-verdict"><span class="type-badge">${escapeHtml(humanize(outcome.verdict||'insufficient_information'))}</span><span class="type-badge">${escapeHtml(humanize(outcome.confidence||'low'))} confidence</span></div><p>${escapeHtml(outcome.explanation||'')}</p>${outcome.no_fallacy_reason?`<div class="muted">${escapeHtml(outcome.no_fallacy_reason)}</div>`:''}<div class="meta">${escapeHtml(meta?.model||'')}${cost}${routing}${local}${compact}</div></section>
      ${liveQuickPanel}
      <section class="card"><div class="section-kicker">OVERALL CLAIM STATUS</div><h2>${escapeHtml(humanize(a.claim_status?.classification||'unknown'))}</h2><p>${escapeHtml(a.claim_status?.explanation||'')}</p></section>
      <section class="card"><div class="section-kicker">EVIDENCE QUALITY</div><h2>${escapeHtml(humanize(evidence.quality||'unknown'))}</h2><p><strong>Strongest source:</strong> ${escapeHtml(evidence.strongest_source||'Not identified')}</p><p>${escapeHtml(evidence.assessment||'')}</p><div class="muted"><strong>Missing:</strong> ${escapeHtml(evidence.missing_evidence||'Nothing specified')}</div><p><strong>Claim certainty:</strong> ${escapeHtml(humanize(certainty.level||'not_stated'))}</p><div class="muted">${escapeHtml(certainty.fit||'')}</div></section>
      <section class="card"><div class="section-kicker">CLAIM DECOMPOSITION</div><h2>What is inside the sentence?</h2>${parts||'<div class="muted">No parts returned.</div>'}</section>
      <section class="card"><div class="section-kicker">BURDEN OF PROOF</div><h2>${a.burden_of_proof?.applies?'An external claim needs support':'No special burden issue identified'}</h2><p>${escapeHtml(a.burden_of_proof?.explanation||'')}</p><div class="quote">${escapeHtml(a.burden_of_proof?.next_move||'')}</div></section>
      ${repairSection}
      ${repairEvidenceSection}
      <section class="card"><div class="section-kicker">TIME / RELEVANCE</div><h2>${a.temporal_relevance?.applies?'How much should the past carry now?':'No historical relevance issue identified'}</h2><p><strong>Time scope:</strong> ${escapeHtml(a.temporal_relevance?.time_scope||'Not established')}</p><p>${escapeHtml(a.temporal_relevance?.assessment||'')}</p><div class="quote">${escapeHtml(a.temporal_relevance?.current_evidence_needed||'')}</div></section>
      <section class="card full"><div class="section-kicker">REASONING BRIDGE</div><h2>Where does the statement move beyond what is known?</h2><div class="bridge"><div class="bridge-box"><strong>Starting point</strong><br>${escapeHtml(bridge.starting_point||'')}</div><div class="bridge-arrow">→</div><div class="bridge-box"><strong>Added inference</strong><br>${escapeHtml(bridge.added_inference||'')}</div><div class="bridge-arrow">→</div><div class="bridge-box"><strong>Conclusion</strong><br>${escapeHtml(bridge.conclusion||'')}</div></div><p><strong>Bridge assessment:</strong> ${escapeHtml(bridge.bridge_assessment||'')}</p></section>
      ${dependencySection}
      ${contradictionSection}
      ${counterSection}
      ${agreementSection}
      ${severitySection}
      <section class="card"><div class="section-kicker">ESTABLISHED / SUPPORTED</div><h2>What can be parked?</h2>${list(a.established_points)}</section>
      <section class="card"><div class="section-kicker">UNRESOLVED</div><h2>What still needs support?</h2>${list(a.unresolved_points)}</section>
      ${disagreementSection}
      ${changes}
      <section class="card full"><div class="section-kicker">LIKELY REASONING TRAPS</div><h2>Best matches</h2>${fallacies||'<p class="muted">No strong fallacy match yet. More information may be needed, or the statement may not contain a clear reasoning error.</p>'}</section>
      <section class="card"><div class="section-kicker">MORE PRECISE WORDING</div><h2>Say only what the evidence carries</h2><div class="quote">${escapeHtml(a.better_wording)}</div></section>
      ${generalResponsePanel}
      <section class="card full"><div class="section-kicker">CHECK MY RESPONSE</div><h2>Make sure the rebuttal does not create a new reasoning problem</h2><textarea id="responseCheckText" rows="3" maxlength="1800" placeholder="Paste or write the response you plan to give."></textarea><div class="actions"><button id="checkResponseBtn" class="primary" type="button">Analyze this response</button></div></section>
      <section class="card full"><strong>Caution:</strong> ${escapeHtml(a.caution)}</section>
      <section class="card full copy-row"><button class="mini-btn" id="copyBtn">Copy analysis</button><button class="mini-btn" onclick="window.print()">Print / PDF</button></section>
    </div>`;
  show('results',true);
  $('copyBtn')?.addEventListener('click',copyAnalysis);
  $('checkResponseBtn')?.addEventListener('click',analyzeProposedResponse);
  document.querySelectorAll('.live-response-target').forEach(btn=>btn.addEventListener('click',()=>selectLiveResponseTarget(btn.dataset.responseTarget)));
  document.querySelectorAll('.live-response-choice').forEach(btn=>btn.addEventListener('click',()=>selectLiveResponse(btn.dataset.liveResponseKey)));
  document.querySelectorAll('.general-response-target').forEach(btn=>btn.addEventListener('click',()=>selectGeneralResponseTarget(btn.dataset.responseTarget)));
  $('liveUsedResponseBtn')?.addEventListener('click',()=>markLiveResponse('used'));
  $('liveModifiedResponseBtn')?.addEventListener('click',()=>markLiveResponse('modified'));
  $('liveDidNotUseResponseBtn')?.addEventListener('click',()=>markLiveResponse('not_used'));
  $('saveModifiedLiveResponseBtn')?.addEventListener('click',saveModifiedLiveResponse);
  $('nextLiveStatementBtn')?.addEventListener('click',nextLiveStatement);
  if(currentLiveTurn)renderLiveResponseStatus(currentLiveTurn);
}

async function copyAnalysis(){
  if(!session.last)return; const a=session.last.analysis;
  const repairLine=a.repair_status?.applies?`Repair status: ${humanize(a.repair_status.classification)} — ${a.repair_status.assessment}`:null;
  const repairMap=a.repair_evidence_mapping?.applies?`Repair evidence mapping: ${a.repair_evidence_mapping.overall_assessment}\nBehavioral repair: ${a.repair_evidence_mapping.behavioral_repair}\nEmotional resolution: ${a.repair_evidence_mapping.emotional_resolution}`:null;
  const agreementLine=a.agreement_status?.applies?`Agreement verification: ${humanize(a.agreement_status.existence)}\nOriginal terms: ${a.agreement_status.original_terms||'Not established'}\nMutual assent: ${humanize(a.agreement_status.mutual_assent)}\nOriginal fulfillment: ${humanize(a.agreement_status.fulfillment_status)}\nLater change: ${humanize(a.agreement_status.change_status)}${a.agreement_status.changed_terms?`\nChanged terms: ${a.agreement_status.changed_terms}`:''}\nAssessment: ${a.agreement_status.assessment||''}`:null;
  const text=[`Claim: ${session.claim}`,`Summary: ${a.summary}`,`Claim status: ${humanize(a.claim_status?.classification||'unknown')}`,agreementLine,repairLine,repairMap,`Better wording: ${a.better_wording}`,`Suggested response to other person: ${a.suggested_response}`,`Therapist-directed response: ${a.therapist_suggested_response||''}`,'Likely reasoning traps:',...(a.likely_fallacies||[]).map(f=>`- ${f.name} (${f.match_score}% match): ${f.why_it_fits}`)].filter(Boolean).join('\n\n');
  try{await navigator.clipboard.writeText(text);$('copyBtn').textContent='Copied';setTimeout(()=>$('copyBtn').textContent='Copy analysis',1200);}catch{alert(text);}
}

function reset(){generalResponseTarget='other_person';session={claim:'',context:'',round:0,answers:[],last:null,route:null,selectedClaimTypes:[],source:'statement',liveTurnId:null};$('claim').value='';$('context').value='';$('questionList').innerHTML='';$('claimQuestionList').innerHTML='';$('detectedClaimTypes').innerHTML='';$('results').innerHTML='';show('results',false);show('clarification',false);show('claimQualification',false);clearError();window.scrollTo({top:0,behavior:'smooth'});}

function initializeClearSayApp(){
  if(clearSayAppInitialized)return;
  clearSayAppInitialized=true;
  loadLiveSessionState();loadCouplesResume();renderLiveSession();renderHistory();
  $('clearHistoryBtn')?.addEventListener('click',clearHistory);
  $('statementModeBtn').addEventListener('click',()=>switchMode('statement'));
  $('liveModeBtn').addEventListener('click',()=>switchMode('live'));
  $('couplesModeBtn').addEventListener('click',()=>switchMode('couples'));
  $('transcriptModeBtn').addEventListener('click',()=>switchMode('transcript'));
  $('liveAnalyzeBtn').addEventListener('click',startLiveAnalysis);
  $('liveOverviewBtn').addEventListener('click',requestLiveOverview);
  $('clearLiveSessionBtn').addEventListener('click',clearLiveSession);
  $('liveContextNote').addEventListener('change',()=>{liveSession.contextNote=$('liveContextNote').value.trim();liveSession.overview=null;saveLiveSessionState();});
  $('couplesCreateBtn').addEventListener('click',createCouplesSession);
  $('couplesJoinBtn').addEventListener('click',joinCouplesSession);
  $('couplesMediatorJoinBtn').addEventListener('click',joinCouplesMediator);
  $('couplesCopyCodeBtn').addEventListener('click',copyCouplesCode);
  $('couplesStartTurnBtn').addEventListener('click',startCouplesTurn);
  $('couplesPassTurnReadyBtn').addEventListener('click',passCouplesTurn);
  $('couplesPassTurnBtn').addEventListener('click',passCouplesTurn);
  $('couplesSendBtn').addEventListener('click',sendCouplesMessage);
  $('couplesRefreshInsightsBtn').addEventListener('click',refreshCouplesInsights);
  $('couplesConfirmTopicBtn').addEventListener('click',confirmCouplesTopic);
  $('couplesCloseTopicBtn').addEventListener('click',closeCouplesTopic);
  $('couplesNextTopicBtn').addEventListener('click',()=>proposeCouplesTopic());
  $('couplesAgreementBtn').addEventListener('click',proposeCouplesAgreement);
  $('couplesEvidenceBtn').addEventListener('click',addCouplesEvidence);
  $('couplesMediatorAllowBtn').addEventListener('click',()=>setCouplesMediatorConsent(true));
  $('couplesMediatorRevokeBtn').addEventListener('click',()=>setCouplesMediatorConsent(false));
  $('couplesContinueBtn').addEventListener('click',continueCouplesIssue);
  $('couplesExportTxtBtn').addEventListener('click',()=>exportCouples('txt'));
  $('couplesExportJsonBtn').addEventListener('click',()=>exportCouples('json'));
  $('couplesPrintBtn').addEventListener('click',printCouplesSession);
  $('couplesEndSessionBtn').addEventListener('click',endCouplesSessionEarly);
  $('couplesLeaveBtn').addEventListener('click',leaveCouplesRoom);
  $('couplesEndBtn').addEventListener('click',endCouplesRoom);
  $('couplesJoinCode').addEventListener('input',()=>{$('couplesJoinCode').value=$('couplesJoinCode').value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8);});
  $('couplesMediatorRoomCode').addEventListener('input',()=>{$('couplesMediatorRoomCode').value=$('couplesMediatorRoomCode').value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8);});
  $('couplesMediatorCode').addEventListener('input',()=>{$('couplesMediatorCode').value=$('couplesMediatorCode').value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8);});
  $('couplesMessage').addEventListener('keydown',(e)=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendCouplesMessage();}});
  $('extractClaimsBtn').addEventListener('click',extractTranscriptClaims);
  $('clearTranscriptBtn').addEventListener('click',clearTranscript);
  $('analyzeBtn').addEventListener('click',startQualification);
  $('qualifyContinueBtn').addEventListener('click',continueFromQualification);
  $('continueBtn').addEventListener('click',()=>runAI(true));
  $('resetBtn').addEventListener('click',reset);
  document.querySelectorAll('.example').forEach(b=>b.addEventListener('click',()=>{const field=$('claim');field.value=b.dataset.text||'';field.focus();field.setSelectionRange(field.value.length,field.value.length);}));
}

document.addEventListener('DOMContentLoaded',()=>{
  $('legalAcknowledgeBtn')?.addEventListener('click',acknowledgeLegalNotice);
  setLegalGate(false);
});
