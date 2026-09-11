const $ = (id) => document.getElementById(id);
let session = { claim: "", context: "", round: 0, answers: [], last: null };

function escapeHtml(s="") { return String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function titleType(t){return ({event_fact:'Event / Fact',feeling:'Feeling',behavior_label:'Behavior Label',interpretation_meaning:'Interpretation / Meaning',intent_motive:'Intent / Motive',cause:'Cause',pattern_frequency:'Pattern / Frequency',prediction:'Prediction',value_rule:'Value / Rule',identity_character:'Identity / Character',request_boundary:'Request / Boundary'})[t]||t;}
function show(id,on=true){$(id).classList.toggle('hidden',!on)}
function setBusy(on){$('analyzeBtn').disabled=on;$('continueBtn').disabled=on;show('loading',on)}
function error(msg){$('errorBox').textContent=msg;show('errorBox',true)}
function clearError(){show('errorBox',false);$('errorBox').textContent=''}

async function checkHealth(){try{const r=await fetch('/api/health');const d=await r.json();$('health').textContent=d.ai_configured?`AI connected • ${d.model} • ${d.fallacies} traps`:'Server online • API key not configured';}catch{$('health').textContent='Server connection unavailable';}}

async function analyze(isFollowup=false){
  clearError();
  if(!isFollowup){
    session={claim:$('claim').value.trim(),context:$('context').value.trim(),round:0,answers:[],last:null};
    if(!session.claim){error('Enter a claim or statement first.');return;}
  } else {
    collectAnswers();
    session.round += 1;
  }
  setBusy(true); show('clarification',false);
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

function renderResults(a,meta){
  const parts=(a.claim_parts||[]).map(p=>`<div class="claim-part"><div>${statusBadge(p.status)} <span class="type-badge">${escapeHtml(titleType(p.type))}</span></div><div class="claim-text">“${escapeHtml(p.text)}”</div><div class="muted">${escapeHtml(p.explanation)}</div></div>`).join('');
  const fallacies=(a.likely_fallacies||[]).map((f,i)=>`<div class="fallacy"><div class="fallacy-head"><div><span class="group-badge">${escapeHtml(f.group||'')}</span><h3>${i+1}. ${escapeHtml(f.name||`Trap #${f.fallacy_id}`)}</h3></div><div class="score">${f.match_score}% match</div></div><div class="meter"><span style="width:${Math.max(0,Math.min(100,f.match_score))}%"></span></div><p><strong>Definition:</strong> ${escapeHtml(f.definition||'')}</p><p>${escapeHtml(f.why_it_fits)}</p><div class="result-grid"><div><strong>What supports the match</strong>${list(f.evidence_for_match)}</div><div><strong>What would weaken it</strong>${list(f.what_would_weaken_match)}</div></div><p><strong>Best corrective question:</strong> ${escapeHtml(f.corrective_question)}</p><p><strong>Better move:</strong> ${escapeHtml(f.better_move||'')}</p></div>`).join('');
  const bridge=a.reasoning_bridge||{};
  const cost=meta?.estimated_cost_usd!=null?` • est. API cost $${Number(meta.estimated_cost_usd).toFixed(4)}`:'';
  $('results').innerHTML=`
    <div class="result-grid">
      <section class="card summary-card full"><div class="section-kicker">CURRENT ANALYSIS</div><h2>${a.status==='needs_clarification'?'Preliminary analysis':'Analysis ready'}</h2><p>${escapeHtml(a.summary)}</p><div class="meta">${escapeHtml(meta?.model||'')}${cost}</div></section>
      <section class="card"><div class="section-kicker">CLAIM DECOMPOSITION</div><h2>What is inside the sentence?</h2>${parts||'<div class="muted">No parts returned.</div>'}</section>
      <section class="card"><div class="section-kicker">BURDEN OF PROOF</div><h2>${a.burden_of_proof?.applies?'An external claim needs support':'No special burden issue identified'}</h2><p>${escapeHtml(a.burden_of_proof?.explanation||'')}</p><div class="quote">${escapeHtml(a.burden_of_proof?.next_move||'')}</div></section>
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
  const text=[`Claim: ${session.claim}`,`Summary: ${a.summary}`,`Better wording: ${a.better_wording}`,`Suggested response: ${a.suggested_response}`,'Likely reasoning traps:',...(a.likely_fallacies||[]).map(f=>`- ${f.name} (${f.match_score}% match): ${f.why_it_fits}`)].join('\n\n');
  try{await navigator.clipboard.writeText(text);$('copyBtn').textContent='Copied';setTimeout(()=>$('copyBtn').textContent='Copy analysis',1200);}catch{alert(text);}
}

function reset(){session={claim:'',context:'',round:0,answers:[],last:null};$('claim').value='';$('context').value='';$('questionList').innerHTML='';$('results').innerHTML='';show('results',false);show('clarification',false);clearError();window.scrollTo({top:0,behavior:'smooth'});}

document.addEventListener('DOMContentLoaded',()=>{
  checkHealth();
  $('analyzeBtn').addEventListener('click',()=>analyze(false));
  $('continueBtn').addEventListener('click',()=>analyze(true));
  $('resetBtn').addEventListener('click',reset);
  document.querySelectorAll('.example').forEach(b=>b.addEventListener('click',()=>{$('claim').value=b.dataset.text;}));
});
