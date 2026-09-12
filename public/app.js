const $ = (id) => document.getElementById(id);
let session = { claim: "", context: "", round: 0, answers: [], last: null, route: null, selectedClaimTypes: [] };
let transcriptSession = { transcript: "", extracted: [], filtered: [], page: 1, pageSize: 20, speakers: [], claimTypes: [], summary: "" };
let analysisMode = 'statement';

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
function titleType(t){return ({event_fact:'Event / Fact',feeling:'Feeling',behavior_label:'Behavior Label',interpretation_meaning:'Interpretation / Meaning',intent_motive:'Intent / Motive',cause:'Cause',pattern_frequency:'Pattern / Frequency',prediction:'Prediction',value_rule:'Value / Rule',identity_character:'Identity / Character',request_boundary:'Request / Boundary',repair_status:'Repair Status',temporal_relevance:'Time / Relevance'})[t]||t;}
function show(id,on=true){$(id).classList.toggle('hidden',!on)}
function setBusy(on){$('analyzeBtn').disabled=on;$('continueBtn').disabled=on;if($('qualifyContinueBtn'))$('qualifyContinueBtn').disabled=on;show('loading',on)}
function setRoutingBusy(on){$('analyzeBtn').disabled=on;if($('qualifyContinueBtn'))$('qualifyContinueBtn').disabled=on}
function error(msg){$('errorBox').textContent=msg;show('errorBox',true)}
function clearError(){show('errorBox',false);$('errorBox').textContent=''}


function switchMode(mode){
  analysisMode=mode==='transcript'?'transcript':'statement';
  const statement=analysisMode==='statement';
  show('statementMode',statement);
  show('transcriptMode',!statement);
  $('statementModeBtn').classList.toggle('selected',statement);
  $('transcriptModeBtn').classList.toggle('selected',!statement);
  $('statementModeBtn').setAttribute('aria-selected',String(statement));
  $('transcriptModeBtn').setAttribute('aria-selected',String(!statement));
  if(!statement){
    show('claimQualification',false);show('clarification',false);show('results',false);show('loading',false);clearError();
    setTimeout(()=>$('transcriptText')?.focus(),0);
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
  session={claim:$('claim').value.trim(),context:$('context').value.trim(),round:0,answers:[],last:null,route:null,selectedClaimTypes:[]};
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
    renderResults(d.analysis,d.meta);
    if(d.analysis.status==='needs_clarification' && d.analysis.questions?.length){renderQuestions(d.analysis.questions);show('clarification',true);$('clarification').scrollIntoView({behavior:'smooth',block:'start'});} else {show('clarification',false);$('results').scrollIntoView({behavior:'smooth',block:'start'});}
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

function renderResults(a,meta){
  const parts=(a.claim_parts||[]).map(p=>`<div class="claim-part"><div>${statusBadge(p.status)} <span class="type-badge">${escapeHtml(titleType(p.type))}</span></div><div class="claim-text">“${escapeHtml(p.text)}”</div><div class="muted">${escapeHtml(p.explanation)}</div></div>`).join('');
  const fallacies=(a.likely_fallacies||[]).map((f,i)=>`<div class="fallacy"><div class="fallacy-head"><div><span class="group-badge">${escapeHtml(f.group||'')}</span><h3>${i+1}. ${escapeHtml(f.name||`Trap #${f.fallacy_id}`)}</h3></div><div class="score">${f.match_score}% match</div></div><div class="meter"><span style="width:${Math.max(0,Math.min(100,f.match_score))}%"></span></div><p><strong>Definition:</strong> ${escapeHtml(f.definition||'')}</p><p>${escapeHtml(f.why_it_fits)}</p><div class="result-grid"><div><strong>What supports the match</strong>${list(f.evidence_for_match)}</div><div><strong>What would weaken it</strong>${list(f.what_would_weaken_match)}</div></div><p><strong>AI corrective question:</strong> ${escapeHtml(f.corrective_question)}</p><p><strong>Better move:</strong> ${escapeHtml(f.better_move||'')}</p>${fallacyToolkit(f)}</div>`).join('');
  const bridge=a.reasoning_bridge||{};
  const repair=a.repair_status||{};
  const repairSection=repair.applies?`<section class="card full"><div class="section-kicker">REPAIR STATUS</div><h2>${escapeHtml(humanize(repair.classification||'unclear'))}</h2><div class="result-grid"><div><strong>Original issue</strong><p>${escapeHtml(repair.original_issue||'Not established')}</p></div><div><strong>Repair actions</strong><p>${escapeHtml(repair.repair_actions||'Not established')}</p></div><div><strong>Behavior afterward</strong><p>${escapeHtml(repair.behavior_after||'Unknown')}</p></div><div><strong>What remains unresolved</strong><p>${escapeHtml(repair.what_remains_unresolved||'Unclear')}</p></div></div><div class="quote">${escapeHtml(repair.assessment||'')}</div></section>`:'';
  const cost=meta?.estimated_cost_usd!=null?` • est. API cost $${Number(meta.estimated_cost_usd).toFixed(4)}`:'';
  const routing=meta?.candidate_fallacies_sent!=null?` • local search narrowed 100 → ${meta.candidate_fallacies_sent} candidates`:'';
  const local=meta?.local_keyword_matches!=null?` • ${meta.local_keyword_matches} local signal hits`:'';
  const compact=meta?.compact_retry?' • compact retry used':'';
  $('results').innerHTML=`
    <div class="result-grid">
      <section class="card summary-card full"><div class="section-kicker">CURRENT ANALYSIS</div><h2>${a.status==='needs_clarification'?'Preliminary analysis':'Analysis ready'}</h2><p>${escapeHtml(a.summary)}</p><div class="meta">${escapeHtml(meta?.model||'')}${cost}${routing}${local}${compact}</div></section>
      <section class="card"><div class="section-kicker">CLAIM DECOMPOSITION</div><h2>What is inside the sentence?</h2>${parts||'<div class="muted">No parts returned.</div>'}</section>
      <section class="card"><div class="section-kicker">BURDEN OF PROOF</div><h2>${a.burden_of_proof?.applies?'An external claim needs support':'No special burden issue identified'}</h2><p>${escapeHtml(a.burden_of_proof?.explanation||'')}</p><div class="quote">${escapeHtml(a.burden_of_proof?.next_move||'')}</div></section>
      <section class="card"><div class="section-kicker">TIME / RELEVANCE</div><h2>${a.temporal_relevance?.applies?'How much should the past carry now?':'No historical relevance issue identified'}</h2><p><strong>Time scope:</strong> ${escapeHtml(a.temporal_relevance?.time_scope||'Not established')}</p><p>${escapeHtml(a.temporal_relevance?.assessment||'')}</p><div class="quote">${escapeHtml(a.temporal_relevance?.current_evidence_needed||'')}</div></section>
      ${repairSection}
      <section class="card full"><div class="section-kicker">REASONING BRIDGE</div><h2>Where does the statement move beyond what is known?</h2><div class="bridge"><div class="bridge-box"><strong>Starting point</strong><br>${escapeHtml(bridge.starting_point||'')}</div><div class="bridge-arrow">→</div><div class="bridge-box"><strong>Added inference</strong><br>${escapeHtml(bridge.added_inference||'')}</div><div class="bridge-arrow">→</div><div class="bridge-box"><strong>Conclusion</strong><br>${escapeHtml(bridge.conclusion||'')}</div></div><p><strong>Bridge assessment:</strong> ${escapeHtml(bridge.bridge_assessment||'')}</p></section>
      <section class="card"><div class="section-kicker">ESTABLISHED / SUPPORTED</div><h2>What can be parked?</h2>${list(a.established_points)}</section>
      <section class="card"><div class="section-kicker">UNRESOLVED</div><h2>What still needs support?</h2>${list(a.unresolved_points)}</section>
      <section class="card full"><div class="section-kicker">LIKELY REASONING TRAPS</div><h2>Best matches</h2>${fallacies||'<p class="muted">No strong fallacy match yet. More information may be needed, or the statement may not contain a clear reasoning error.</p>'}</section>
      <section class="card"><div class="section-kicker">MORE PRECISE WORDING</div><h2>Say only what the evidence carries</h2><div class="quote">${escapeHtml(a.better_wording)}</div></section>
      <section class="card"><div class="section-kicker">NATURAL RESPONSE</div><h2>How to answer without a “gotcha”</h2><div class="quote">${escapeHtml(a.suggested_response)}</div></section>
      <section class="card full"><strong>Caution:</strong> ${escapeHtml(a.caution)}</section>
      <section class="card full copy-row"><button class="mini-btn" id="copyBtn">Copy analysis</button><button class="mini-btn" onclick="window.print()">Print / PDF</button></section>
    </div>`;
  show('results',true);
  $('copyBtn')?.addEventListener('click',copyAnalysis);
}

async function copyAnalysis(){
  if(!session.last)return; const a=session.last.analysis;
  const repairLine=a.repair_status?.applies?`Repair status: ${humanize(a.repair_status.classification)} — ${a.repair_status.assessment}`:null;
  const text=[`Claim: ${session.claim}`,`Summary: ${a.summary}`,repairLine,`Better wording: ${a.better_wording}`,`Suggested response: ${a.suggested_response}`,'Likely reasoning traps:',...(a.likely_fallacies||[]).map(f=>`- ${f.name} (${f.match_score}% match): ${f.why_it_fits}`)].filter(Boolean).join('\n\n');
  try{await navigator.clipboard.writeText(text);$('copyBtn').textContent='Copied';setTimeout(()=>$('copyBtn').textContent='Copy analysis',1200);}catch{alert(text);}
}

function reset(){session={claim:'',context:'',round:0,answers:[],last:null,route:null,selectedClaimTypes:[]};$('claim').value='';$('context').value='';$('questionList').innerHTML='';$('claimQuestionList').innerHTML='';$('detectedClaimTypes').innerHTML='';$('results').innerHTML='';show('results',false);show('clarification',false);show('claimQualification',false);clearError();window.scrollTo({top:0,behavior:'smooth'});}

document.addEventListener('DOMContentLoaded',()=>{
  $('statementModeBtn').addEventListener('click',()=>switchMode('statement'));
  $('transcriptModeBtn').addEventListener('click',()=>switchMode('transcript'));
  $('extractClaimsBtn').addEventListener('click',extractTranscriptClaims);
  $('clearTranscriptBtn').addEventListener('click',clearTranscript);
  $('analyzeBtn').addEventListener('click',startQualification);
  $('qualifyContinueBtn').addEventListener('click',continueFromQualification);
  $('continueBtn').addEventListener('click',()=>runAI(true));
  $('resetBtn').addEventListener('click',reset);
  document.querySelectorAll('.example').forEach(b=>b.addEventListener('click',()=>{const field=$('claim');field.value=b.dataset.text||'';field.focus();field.setSelectionRange(field.value.length,field.value.length);}));
});
