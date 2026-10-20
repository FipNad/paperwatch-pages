const $ = (selector) => document.querySelector(selector);
const main = $('#main');
const publicPage = Boolean(window.PAPERWATCH_PAGES);
if(publicPage){$('#workspace-label').textContent='Public frontend';$('#workspace-detail').textContent='Your data stays on your backend';}
let backendUrl = '';
let backendAuth = '';
let connected = false;
let adminMode = !publicPage;
let adminState = null;
let selectedUsername = '';
let state = null;
let page = 'overview';
let scrapers = [];
let catalog = [];
let catalogKind = 'all';
let catalogArea = 'all';
let catalogText = '';
let currentSearchId = null;
let currentSearchData = null;
let searchRenderKey = '';
let includeLocations = new Set();
let hideLocations = new Set();
let detailPaperId = null;
let dirtyForm = false;
let searchFrozen = false;
let libraryData = null;
let libraryOffset = 0;
const trackedPaperJobIds = new Set();
const titles = {overview:'Overview',sources:'Monitored sources',topics:'Interest topics',discover:'Discover papers',library:'Paper library',settings:'Model settings',users:'Users'};
const e = (value='') => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const url = value => /^https?:\/\//i.test(value||'') ? e(value) : '#';
const fmt = value => {if(!value)return 'Not yet';const d=new Date(value);return isNaN(d)?e(value):d.toLocaleString([], {dateStyle:'medium',timeStyle:'short'});};
const days = hours => hours >= 24 ? `${Math.round(hours/24)} day${hours===24?'':'s'}` : `${hours} hour${hours===1?'':'s'}`;
const sourceReady = source => source.adapter==='arxiv'||source.adapter==='feed'||source.adapter==='crossref'||(source.adapter?.startsWith('custom:')&&scrapers.includes(source.adapter.slice(7)));

async function api(path, options={}) {
  const headers = {'Content-Type':'application/json',...(backendAuth?{'Authorization':backendAuth}:{}),...(adminMode&&selectedUsername&&!path.startsWith('/api/admin/')?{'X-Paperwatch-User':selectedUsername}:{}),...(options.headers||{})};
  let res;
  try { res = await fetch((publicPage?backendUrl:'')+path,{...options,headers,cache:'no-store'}); }
  catch { throw new Error('Backend unreachable. Check the HTTPS URL and allowed Pages origin.'); }
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
function showConnect(){
 connected=false;
 $('#job-status').textContent=publicPage?'Open invite':'Admin sign in';
 main.innerHTML=publicPage
  ? head('Invitation','Open your Paperwatch profile','Paste the private invite link from your administrator. Anyone with that link can access this profile.')
    + `<div class="panel connection-panel"><form id="connectForm"><div class="field"><label>Private invite link</label><input type="url" name="invite_url" required placeholder="https://yourname.github.io/paperwatch/#backend=..." autocomplete="off"></div><div class="form-actions"><button class="button" type="submit">Open profile</button></div><p class="hint">The link holds your access token in its fragment. Keep it private. Paperwatch does not store it in browser storage.</p></form></div>`
  : head('Administration','Open the admin portal','Enter the administrator key configured on this backend. It stays in this page until refresh or close.')
    + `<div class="panel connection-panel"><form id="connectForm"><div class="field"><label>Administrator key</label><input name="admin_key" type="password" required minlength="32" autocomplete="off"></div><div class="form-actions"><button class="button" type="submit">Open admin portal</button></div></form></div>`;
}
function connectInvite(link){
 const target=new URL(link,location.href),fragment=new URLSearchParams(target.hash.slice(1));
 const backend=new URL(fragment.get('backend')||'');
 const token=fragment.get('token')||'';
 if(target.origin!==location.origin||target.pathname!==location.pathname||backend.protocol!=='https:'||backend.username||backend.password||backend.pathname!=='/'||backend.search||backend.hash||!/^pwu_[A-Za-z0-9_-]{40,}$/.test(token))throw new Error('Invalid invite link. Ask your administrator for a new one.');
 backendUrl=backend.origin;backendAuth='Bearer '+token;selectedUsername=fragment.get('user')||'';
 if(!/^[a-z][a-z0-9_-]{1,39}$/.test(selectedUsername))throw new Error('Invalid invite username.');
 location.hash=target.hash;
 return api('/api/state').then(profile=>{if(profile.user.username!==selectedUsername)throw new Error('Invite does not match this profile.');connected=true;$('#connection-switch').hidden=false;$('#connection-switch').textContent='Leave profile';return startApp();}).catch(error=>{backendAuth='';location.hash='';throw error;});
}
async function openPdf(id){
 const preview=window.open('', '_blank');
 try {
  const headers={...(backendAuth?{'Authorization':backendAuth}:{}),...(adminMode?{'X-Paperwatch-User':selectedUsername}:{})};
  const response=await fetch((publicPage?backendUrl:'')+`/api/papers/${id}/pdf`,{headers,cache:'no-store'});
  if(!response.ok)throw new Error(`PDF unavailable (${response.status})`);
  const objectUrl=URL.createObjectURL(await response.blob());
  if(preview)preview.location.href=objectUrl;else window.open(objectUrl,'_blank');
  setTimeout(()=>URL.revokeObjectURL(objectUrl),120000);
 }catch(error){if(preview)preview.close();throw error;}
}
function toast(message, error=false){const el=$('#toast');el.textContent=message;el.className=error?'error':'';el.style.display='block';clearTimeout(window.toastTimeout);window.toastTimeout=setTimeout(()=>el.style.display='none',4600);}
async function load(render=true){
  try {
    state=await api('/api/state');
    if(!dirtyForm){catalogKind=state.preferences?.catalog_kind||catalogKind;catalogArea=state.preferences?.catalog_area||catalogArea;includeLocations=new Set(state.preferences?.include_locations||[]);hideLocations=new Set(state.preferences?.hide_locations||[]);}
    $('#job-status').textContent = state.jobs.queued || state.jobs.active.length ? `${state.jobs.queued + state.jobs.active.length} task${state.jobs.queued+state.jobs.active.length===1?'':'s'} running` : 'All caught up';
    if(render) draw();
    else renderTasks();
  } catch(err) {toast(err.message,true);}
}
function navigate(next){if(!connected){showConnect();return;}if((next==='settings'||next==='users')&&!adminMode)return;page=next;dirtyForm=false;document.querySelectorAll('.nav-item').forEach(el=>el.classList.toggle('active',el.dataset.page===page));$('#crumb-page').textContent=titles[page].toUpperCase();draw();if(page==='discover'&&currentSearchId)showSearch(currentSearchId);if(page==='library')refreshLibrary(true);window.scrollTo({top:0,behavior:'smooth'});}
function head(kicker,title,subtitle,action=''){return `<div class="page-head"><div><div class="eyebrow">${e(kicker)}</div><h1>${e(title)}</h1><p class="subtitle">${e(subtitle)}</p></div>${action}</div>`;}
function empty(icon,title,copy,action=''){return `<div class="empty"><div class="empty-icon">${icon}</div><strong>${e(title)}</strong><p>${e(copy)}</p>${action}</div>`;}
function pill(label,type=''){return `<span class="pill ${type}"><span class="dot"></span>${e(label)}</span>`;}
function draw(){if(!state&&page!=='users'&&page!=='settings')return;if(page==='discover')searchRenderKey='';main.innerHTML=({overview:overview,sources:sources,topics:topics,discover:discover,library:library,settings:settings,users:users}[page])();renderTasks();}
function llmNotice(){const missing=Object.entries(state?.llm_status||{}).filter(([,value])=>!value.usable&&!value.optional);return missing.length?`<div class="banner"><div><strong>No usable LLM for ${missing.map(([role])=>e(role)).join(', ')}</strong><p>${missing.map(([role,value])=>`${e(role)}: ${e(value.reason)}`).join(' · ')}. Search and source collection still work.</p></div></div>`:'';}
function taskPanel(){return `<div class="panel" id="task-panel"></div>`;}
function paperStatusPill(p){
 if(p.filter_status==='error')return pill('Model error','error');
 if(p.filter_status==='needs_topics')return pill('Needs topics','warn');
 if(p.filter_status==='prefiltered_out')return pill('Screened out','neutral');
 if(p.relevant&&p.error)return pill('Summary error','error');
 if(p.relevant&&!p.summary)return pill('Summary pending','blue');
 if(p.relevant)return pill('Relevant');
 if(p.filter_status==='done')return pill('Not matched','neutral');
 return pill('Awaiting filter','blue');
}
function runStatusPill(run){
 if(run.error)return pill('Collection error','error');
 if(!run.finished_at)return pill('Running','blue');
 if(run.outstanding)return pill('Processing incomplete','warn');
 if(run.start_date&&run.status!=='complete')return pill('Unverified','warn');
 return pill('Complete');
}
function renderTasks(){const panel=$('#task-panel');if(!panel||!state)return;const all=state.jobs?.items||[];const tasks=all.slice(0,12);panel.innerHTML=`<div class="panel-head"><h2>Tasks</h2><span class="panel-kicker">${tasks.filter(x=>['queued','running','cancel_requested'].includes(x.status)).length} in progress</span></div>${tasks.length?`<div class="list">${tasks.map(job=>`<div class="list-row task-row"><div class="row-main"><div class="row-title">${e(job.label)} · ${e(job.status)}</div><div class="row-sub">${e(job.stage)}${job.total!=null?` · ${job.completed} / ${job.total}`:` · ${job.completed} checked`}${job.message?` · ${e(job.message)}`:''}</div>${['queued','running','cancel_requested'].includes(job.status)?`<progress ${job.total!=null&&job.total>0?`value="${Math.min(job.completed,job.total)}" max="${job.total}"`:''}></progress>`:''}</div>${['queued','running','cancel_requested'].includes(job.status)?`<button class="button danger small" data-action="cancel-job" data-id="${job.id}" ${job.status==='cancel_requested'?'disabled':''}>${job.status==='cancel_requested'?'Stopping…':'Cancel'}</button>`:''}</div>`).join('')}</div>`:'<p class="muted">No recent tasks.</p>'}`;const searchProgress=$('#search-progress');if(searchProgress){const job=all.find(x=>x.target_id===currentSearchId&&['search','search-more'].includes(x.kind));searchProgress.innerHTML=job?`<div class="row-sub">${e(job.stage)} · ${e(job.status)}${job.total!=null?` · ${job.completed} / ${job.total}`:''}</div><progress ${job.total!=null&&job.total>0?`value="${Math.min(job.completed,job.total)}" max="${job.total}"`:''}></progress>`:'';}}

function overview(){
 const sources=state.sources.filter(s=>s.enabled&&s.adapter).length, matched=state.paper_stats?.relevant||0, needs=state.sources.filter(s=>!s.adapter).length;
 const recent=state.papers.slice(0,5);
 const runs=state.runs.slice(0,4);
 const stats=state.paper_stats||{};
 const processing=`${stats.pending||0} awaiting filter · ${stats.needs_topics||0} need topics · ${stats.errors||0} model errors · ${stats.summary_missing||0} missing summaries · ${stats.screened_out||0} screened out`;
 return head('Your research desk',`Welcome, ${state.user.username}`,'One place to monitor trusted sources, surface relevant work, and search beyond your reading list.',`<button class="button" data-page="discover">⌕ &nbsp;Search papers</button>`)
 + llmNotice()
 + `<div class="stats"><div class="stat"><div class="stat-label">Active sources</div><div class="stat-value">${sources}</div><div class="stat-note">${needs?`${needs} need a scraper`:'Monitoring ready'}</div></div><div class="stat"><div class="stat-label">Interest topics</div><div class="stat-value">${state.topics.length}</div><div class="stat-note">Saved research profiles</div></div><div class="stat"><div class="stat-label">Papers found</div><div class="stat-value">${state.paper_stats?.total||0}</div><div class="stat-note">From monitored sources</div></div><div class="stat"><div class="stat-label">Relevant matches</div><div class="stat-value">${matched}</div><div class="stat-note">Ready for your library</div></div></div>`
 + `<div class="panel"><div class="panel-head"><h2>Paper processing</h2><span class="panel-kicker">${stats.retryable||0} eligible for retry</span></div><p class="intro">${processing}. Screened-out papers were rejected by the first pass and are not in the retry queue. A retry of zero eligible papers will start no task.</p></div>`
 + (!state.topics.length || !state.sources.length ? `<div class="banner"><div><strong>Set up your research watch</strong><p>Add an interest topic and a source to start regular discovery.</p></div><button class="button secondary" data-page="${!state.topics.length?'topics':'sources'}">${!state.topics.length?'Add a topic':'Add a source'} →</button></div>`:'')
 + `<div class="grid-two"><div class="panel"><div class="panel-head"><h2>Recently discovered</h2><button class="button tertiary" data-page="library">View library →</button></div>${recent.length?`<div class="list">${recent.map(p=>`<div class="list-row"><div class="row-main"><div class="row-title">${e(p.title)}</div><div class="row-sub">${e(p.published||'Date unknown')} · ${e((state.sources.find(s=>s.id===p.source_id)||{}).name||'Source')}</div>${p.error?`<div class="error-note">${e(p.error)}</div>`:''}</div>${paperStatusPill(p)}</div>`).join('')}</div>`:empty('⌁','No papers yet','Run a source once to populate your research library.','<button class="button secondary small" data-page="sources">Go to sources</button>')}</div><div class="panel"><div class="panel-head"><h2>Latest source runs</h2><span class="panel-kicker">Scheduled & manual</span></div>${runs.length?`<div class="list">${runs.map(r=>`<div class="list-row"><div class="row-main"><div class="row-title">${e((state.sources.find(s=>s.id===r.source_id)||{}).name||'Removed source')}</div><div class="row-sub">${fmt(r.started_at)} · ${r.found} checked · ${r.added} new${r.coverage?` · ${e(r.coverage)}`:''}</div>${r.error?`<div class="error-note">${e(r.error)}</div>`:''}</div>${runStatusPill(r)}</div>`).join('')}</div>`:empty('◷','No runs yet','Your first source run will appear here.')}</div></div>` + taskPanel();
}

function sourceForm(source=null){
 const editing=!!source; const config=source?.adapter_config||{};
 return `<div class="panel" id="source-form"><div class="panel-head"><h2>${editing?'Edit source':'Add a permanent source'}</h2><span class="panel-kicker">Runs while the backend is online</span></div><form id="sourceForm" data-id="${source?.id||''}"><div class="form-grid"><div class="field"><label>Name</label><input name="name" required placeholder="e.g. arXiv cryptography" value="${e(source?.name||'')}"></div><div class="field"><label>Website URL</label><input name="url" type="url" required placeholder="https://..." value="${e(source?.url||'')}"></div><div class="field"><label>Adapter / scraper</label><select name="adapter"><option value="">Needs scraper — inactive</option><option value="arxiv" ${source?.adapter==='arxiv'?'selected':''}>arXiv API</option><option value="feed" ${source?.adapter==='feed'?'selected':''}>Atom / RSS feed</option><option value="crossref" ${source?.adapter==='crossref'?'selected':''}>Crossref journal API</option>${scrapers.map(s=>`<option value="custom:${e(s)}" ${source?.adapter===`custom:${s}`?'selected':''}>Custom: ${e(s)}</option>`).join('')}${source?.adapter?.startsWith('custom:')&&!scrapers.includes(source.adapter.slice(7))?`<option value="${e(source.adapter)}" selected>Missing: ${e(source.adapter.slice(7))}</option>`:''}</select></div><div class="field"><label>Repeat every (hours)</label><input name="interval_hours" type="number" min="1" max="720" value="${source?.interval_hours||24}" required><span class="hint">IACR feeds require at least 24 hours.</span></div><div class="field full"><label>arXiv query or feed URL</label><input name="config_value" placeholder="e.g. cat:cs.CR or https://example.org/feed.xml" value="${e(config.query||config.feed_url||config.value||'')}"><span class="hint">For arXiv, use its query syntax. For feeds, paste the feed URL. Custom scrapers receive the website URL and this value in adapter_config.</span></div><div class="field"><label>Journal ISSN (required for Crossref)</label><input name="issn" placeholder="1099-4300" value="${e(config.issn||'')}"><span class="hint">Crossref uses this ISSN directly; OpenAlex uses it for old feed entries.</span></div><div class="field"><label>OpenAlex source ID (optional)</label><input name="openalex_source_id" placeholder="S123456789" value="${e(config.openalex_source_id||'')}"><span class="hint">Use for repositories without an ISSN.</span></div><div class="field full"><label><input type="checkbox" name="enabled" ${source?.enabled===0?'':'checked'} style="width:auto;margin-right:6px;accent-color:#0b8a7d"> Enable scheduled runs</label></div></div><div class="form-actions"><button class="button" type="submit">${editing?'Save source':'Add source'}</button>${editing?'<button class="button secondary" type="button" data-action="cancel-source">Cancel</button>':''}</div></form></div>`;
}
function sourceCard(s){
 const status=!sourceReady(s)?pill('Needs scraper','warn'):s.last_error?pill('Run error','error'):s.enabled?pill('Active'):pill('Paused','neutral');
 const config=s.adapter_config||{};
 const historyReady=sourceReady(s)&&(s.adapter!=='feed'||config.issn||config.openalex_source_id);
 return `<div class="source-card"><div class="card-top"><div><div class="card-title">${e(s.name)}</div><div class="card-meta"><a href="${url(s.url)}" target="_blank" rel="noopener">${e(s.url)}</a> · ${e(s.adapter||'No adapter')}</div></div>${status}</div><p class="card-description">${s.adapter==='arxiv'?`Query: ${e(config.query||'Not set')}`:s.adapter==='feed'?`Feed: ${e(config.feed_url||s.url)}`:s.adapter==='crossref'?`Crossref ISSN: ${e(config.issn||'Not set')}`:sourceReady(s)?'Site-specific scraper':'This source will not run until you attach a scraper.'}</p>${s.last_error?`<div class="error-note">${e(s.last_error)}</div>`:''}<div class="card-foot"><div class="card-meta">Every ${days(s.interval_hours)} · Last: ${fmt(s.last_checked)} · Next: ${s.next_check?fmt(s.next_check*1000):'On startup'}</div><div class="row-actions"><button class="button secondary small" data-action="edit-source" data-id="${s.id}">Edit</button><button class="button secondary small" data-action="toggle-source" data-id="${s.id}">${s.enabled?'Pause':'Resume'}</button><button class="button small" data-action="run-source" data-id="${s.id}" ${sourceReady(s)?'':'disabled'}>Run now</button><button class="button secondary small" data-action="history-source" data-id="${s.id}" ${historyReady?'':'disabled'}>${s.adapter==='feed'&&!historyReady?'Add venue ID for history':'Search past dates'}</button><button class="button danger small" data-action="delete-source" data-id="${s.id}">Delete</button></div></div></div>`;
}
function coverageDetails(source){
 const history=state.historical_coverage?.[source.id];
 if(!history?.runs?.length)return '';
 const labels={complete:'Fully processed',processing_incomplete:'Processing incomplete',collection_error:'Collection failed',unverified:'Older run: processing unverified',source_changed:'Source settings changed; rerun',running:'Running'};
 const verified=history.complete_intervals||[];
 return `<details class="panel coverage-panel"><summary>Past periods for ${e(source.name)} · ${verified.length} verified interval${verified.length===1?'':'s'}</summary><p class="hint">A period is verified only when collection finished and every encountered paper has a completed screening outcome. A rerun can verify an older period without screening duplicates again.</p>${verified.length?`<div class="coverage-intervals">${verified.map(span=>`<span class="pill">${e(span.start_date)} → ${e(span.end_date)} fully processed</span>`).join('')}</div>`:'<p class="hint">No fully processed period has been verified yet.</p>'}<div class="list">${history.runs.map(run=>`<div class="list-row"><div class="row-main"><div class="row-title">${e(run.start_date)} → ${e(run.end_date)} · ${e(labels[run.status]||run.status)}</div><div class="row-sub">${run.found} checked · ${run.added} new · ${run.linked} linked · ${run.outstanding} need processing${run.finished_at?` · Finished ${fmt(run.finished_at)}`:''}</div>${run.error?`<div class="error-note">${e(run.error)}</div>`:''}</div></div>`).join('')}</div></details>`;
}
function sources(){
 return head('Mode 01','Monitored sources','Check chosen repositories on your schedule. Each site needs an adapter that knows how to read its papers.',adminMode?`<button class="button secondary" data-action="show-scraper">+ Add custom scraper</button>`:'')
 + `<div class="banner"><div><strong>Start with a known source</strong><p>Choose arXiv, IACR ePrint, or a journal feed from the source directory below.</p></div><div class="row-actions"><button class="button secondary small" data-action="preset-arxiv">arXiv</button><button class="button secondary small" data-action="preset-iacr">IACR ePrint</button></div></div>`
 + sourceForm(window.editingSource||null)
 + `<div class="split-controls"><h2>Your sources <span class="muted">(${state.sources.length})</span></h2></div>`
 + (state.sources.length?state.sources.map(s=>sourceCard(s)+coverageDetails(s)).join(''):empty('◎','No sources configured','Add a repository or feed above. Sources without an adapter stay inactive.'))
 + (adminMode?`<div class="panel"><div class="panel-head"><h2>Custom adapters <span class="muted">(${scrapers.length})</span></h2><button class="button secondary small" data-action="show-scraper">Add adapter</button></div><p class="hint">Create or edit Python parsing scripts here, then select one in a source above. Changes take effect on the next run.</p>${scrapers.length?`<div class="list">${scrapers.map(name=>`<div class="list-row"><div class="row-main"><div class="row-title mono">${e(name)}</div><div class="row-sub">${state.sources.filter(s=>s.adapter===`custom:${name}`).length} attached source(s)</div></div><div class="row-actions"><button class="button secondary small" data-action="edit-scraper" data-name="${e(name)}">Edit code</button><button class="button danger small" data-action="delete-scraper" data-name="${e(name)}" ${state.sources.some(s=>s.adapter===`custom:${name}`)?'disabled title="Detach from sources first"':''}>Delete</button></div></div>`).join('')}</div>`:empty('⌘','No custom adapters yet','Use Add adapter to write a parser for a site without an API or feed.')}</div>`:`<div class="panel"><div class="panel-head"><h2>Available custom adapters</h2></div><p class="hint">Your administrator installs parsing scripts. You can attach any listed adapter to your own source.</p><p>${scrapers.length?scrapers.map(e).join(', '):'None installed yet.'}</p></div>`)
 + catalogPanel() + taskPanel();
}

function catalogPanel(){
 const kinds=['all','Repository','Index','Journal','Proceedings','Conference program'];
 const areas=['all','Cryptography','Security','Quantum computing','Quantum communication','QRNG','Quantum information','Mathematics','Statistics','Entropy'];
 return `<div class="panel catalog-panel"><div class="panel-head"><div><h2>Research source directory <span class="muted">(${catalog.length})</span></h2><p class="catalog-intro">Public repositories, indexes, journals, and conference paper lists.</p></div></div><div class="status-guide"><div>${pill('Monitor ready')}<span>Paperwatch can check its API or feed now.</span></div><div>${pill('Needs adapter','warn')}<span>Saved as inactive until you add a feed or scraper.</span></div><div>${pill('Discovery index','blue')}<span>A broad paper search service, not a single publication venue. OpenAlex powers Discover.</span></div></div><div class="catalog-controls"><div class="field"><label>Find a source</label><input id="catalog-search" placeholder="Search names or notes" value="${e(catalogText)}"></div><div class="field"><label>Publication type</label><select id="catalog-kind">${kinds.map(k=>`<option value="${e(k)}" ${k===catalogKind?'selected':''}>${e(k==='all'?'All types':k)}</option>`).join('')}</select></div><div class="field"><label>Field</label><select id="catalog-area">${areas.map(a=>`<option value="${e(a)}" ${a===catalogArea?'selected':''}>${e(a==='all'?'All fields':a)}</option>`).join('')}</select></div></div><div id="catalog-results">${catalogCards()}</div></div>`;
}
function catalogCards(){
 const list=catalog.filter(c=>(catalogKind==='all'||c.kind===catalogKind)&&(catalogArea==='all'||c.areas.includes(catalogArea))&&(!catalogText||(c.name+' '+c.note+' '+c.areas.join(' ')).toLowerCase().includes(catalogText.toLowerCase())));
 return list.length?`<div class="catalog-grid">${list.map(c=>`<div class="catalog-card"><div class="catalog-card-top"><span class="catalog-kind">${e(c.kind)}</span>${c.adapter?pill('Monitor ready'):c.sourceable===false?pill('Discovery index','blue'):pill('Needs adapter','warn')}</div><h3><a href="${url(c.url)}" target="_blank" rel="noopener">${e(c.name)} ↗</a></h3><div class="catalog-areas">${c.areas.map(a=>`<span>${e(a)}</span>`).join('')}</div><p>${e(c.note)}</p><div class="catalog-card-foot"><a href="${url(c.reference)}" target="_blank" rel="noopener">Official details ↗</a>${c.sourceable===false?(c.id==='openalex'?`<button class="button secondary small" data-page="discover">Search OpenAlex</button>`:''):`<button class="button ${c.adapter?'':'secondary'} small" data-action="catalog-use" data-key="${e(c.id)}">${c.adapter?'Use source':'Prepare source'}</button>`}</div></div>`).join('')}</div>`:empty('⌕','No matching sources','Try a different field or search term.');
}
function renderCatalog(){const el=$('#catalog-results');if(el)el.innerHTML=catalogCards();}

function topics(){
 return head('Research interests','Interest topics','Describe what matters to you. The profile model turns each description into a reusable matching brief.')
 + llmNotice()
 + `<div class="grid-two"><div><div class="panel"><div class="panel-head"><h2>Add an interest</h2><span class="panel-kicker">Specific descriptions work best</span></div><form id="topicForm"><div class="field"><label>Topic name</label><input name="name" required placeholder="e.g. Secure multiparty computation"></div><div class="field" style="margin-top:14px"><label>What are you looking for?</label><textarea name="description" required placeholder="Methods, applications, exclusions, or problems you care about..."></textarea></div><div class="form-actions"><button class="button" type="submit">Create topic & profile</button></div></form></div></div><div class="panel"><div class="panel-head"><h2>How matching works</h2></div><p class="intro">A profile model condenses your interest into positive signals, exclusions, and useful search terms. A separate filter model then reads each new paper’s title, abstract, keywords, and available introduction.</p><div class="summary">Profiles and filtering use the shared models configured by your administrator.${adminMode?' Open Model settings to change them.':''}</div></div></div>`
 + `<div class="split-controls"><h2>Saved topics <span class="muted">(${state.topics.length})</span></h2></div>`
 + (state.topics.length?state.topics.map(t=>`<div class="topic-card"><div class="card-top"><div><div class="card-title">${e(t.name)}</div><div class="card-meta">Added ${fmt(t.created_at)} ${t.profile_provider?`· ${e(t.profile_provider)} / ${e(t.profile_model)}`:''}</div></div>${t.profile?pill('Profile ready'):t.profile_error?pill('Profile error','error'):pill('Preparing','blue')}</div><p class="card-description">${e(t.description)}</p>${t.profile?`<div class="summary">${e(t.profile.summary)}</div>`:''}${t.profile_error?`<div class="error-note">${e(t.profile_error)}</div>`:''}<div class="card-foot"><div class="badge-line">${(t.profile?.search_terms||[]).slice(0,5).map(x=>`<span class="pill neutral">${e(x)}</span>`).join('')}</div><div class="row-actions"><button class="button secondary small" data-action="profile-topic" data-id="${t.id}">Regenerate profile</button><button class="button danger small" data-action="delete-topic" data-id="${t.id}">Delete</button></div></div></div>`).join(''):empty('✳','No topics yet','Add your first research interest above.'));
}

function discover(){
 const sources=state.sources.filter(sourceReady);
 return head('Mode 02','Discover papers','Search OpenAlex broadly, optionally query your monitored sources, then choose which publication locations to display.')
 + `<div class="panel"><div class="panel-head"><h2>New paper search</h2><span class="panel-kicker">OpenAlex is always searched</span></div><form id="searchForm"><div class="searchbar"><input class="search-input" name="query" required placeholder="Try “zero knowledge proof systems” or “quantum random number generators”"><button class="button" type="submit">Search papers →</button></div><div class="field" style="margin-top:17px"><label>Quick publication window</label><select name="recent_days"><option value="30">Last 30 days</option><option value="90" selected>Last 90 days</option><option value="365">Last year</option><option value="0">Any time</option></select></div><div class="form-grid" style="margin-top:17px"><div class="field"><label>First published from (optional)</label><input type="date" name="start_date"></div><div class="field"><label>First published through (optional)</label><input type="date" name="end_date"></div></div><p class="hint">Dates override the quick window. Both endpoints are included.</p><div class="field" style="margin-top:17px"><label>Query these monitored sources too (optional)</label><div class="checkboxes">${sources.length?sources.map(s=>`<label class="check"><input type="checkbox" name="source" value="${s.id}">${e(s.name)}</label>`).join(''):'<span class="hint">Add sources in Mode 01 to query them directly.</span>'}</div></div><p class="hint" style="margin:14px 0 0">Search stores titles and abstracts, with no PDF download or LLM calls. Historical source collection for LLM processing is in Monitored sources.</p></form></div>`
 + `<div class="grid-two"><div><div class="panel"><div class="panel-head"><h2>Search results</h2><div class="row-actions"><span id="results-count" class="panel-kicker"></span><button class="button secondary small" data-action="freeze-search">${searchFrozen?'Resume display':'Freeze display'}</button></div></div><p class="hint">Freezing holds these results still while the search continues.</p><div id="search-progress" class="search-progress"></div><div id="search-results">${currentSearchId?'<span class="muted">Loading results…</span>':empty('⌕','Ready to discover','Enter a field or research question to find new papers.')}</div></div></div><div class="panel"><div class="panel-head"><h2>Recent searches</h2></div>${state.searches.length?`<div class="list">${state.searches.map(s=>`<div class="list-row"><div class="row-main"><div class="row-title">${e(s.query)}</div><div class="row-sub">${fmt(s.started_at)}${s.start_date||s.end_date?` · ${e(s.start_date||'Any')} to ${e(s.end_date||'Today')}`:''}</div></div><button class="button secondary small" data-action="view-search" data-id="${s.id}">View</button></div>`).join('')}</div>`:empty('◷','No searches yet','Your searches will appear here.')}</div></div>` + taskPanel();
}

function selectSearch(id){
 if(currentSearchId!==id){includeLocations=new Set();hideLocations=new Set();searchRenderKey='';currentSearchData=null;searchFrozen=false;}
 currentSearchId=id;
}
function placesFor(result){
 return result.locations?.length?result.locations:[{name:result.source==='OpenAlex'?'Location unavailable':result.source,url:result.url}];
}
function locationKey(name){return `location:${String(name||'Location unavailable').trim().toLocaleLowerCase()}`;}
function resultLocationKeys(result){
 const keys=new Set((result.monitored_source_ids||[]).map(id=>`source:${id}`));
 for(const source of state.sources)if(source.name===result.source)keys.add(`source:${source.id}`);
 for(const place of placesFor(result))keys.add(locationKey(place.name));
 return keys;
}
function searchFilterOptions(results){
 const venueCounts=new Map();
 for(const result of results){
  const names=new Set(placesFor(result).map(place=>place.name));
  for(const name of names)venueCounts.set(name,(venueCounts.get(name)||0)+1);
 }
 const monitored=state.sources.map(source=>({key:`source:${source.id}`,label:source.name}));
 const venues=[...venueCounts].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).map(([name,count])=>({key:locationKey(name),label:`${name} (${count})`}));
 return {monitored,venues};
}
function searchFilterCheckboxes(options,mode){
 const chosen=mode==='include'?includeLocations:hideLocations;
 return options.map(option=>`<label class="location-choice"><input type="checkbox" data-location-filter="${mode}" data-key="${e(option.key)}" ${chosen.has(option.key)?'checked':''}><span>${e(option.label)}</span></label>`).join('');
}
function applySearchFilters(){
 if(!currentSearchData||page!=='discover')return;
 let visible=0;
 currentSearchData.results.forEach((result,index)=>{
  const keys=resultLocationKeys(result);
  const included=!includeLocations.size||[...includeLocations].some(key=>keys.has(key));
  const hidden=[...hideLocations].some(key=>keys.has(key));
  const show=included&&!hidden;
  const card=document.querySelector(`[data-result-index="${index}"]`);
  if(card)card.hidden=!show;
  visible+=Number(show);
 });
 const count=$('#results-count');
 if(count)count.textContent=`${visible} of ${currentSearchData.results.length} shown${currentSearchData.search.finished_at?'':' · searching…'}`;
 const emptyState=$('#filter-empty');if(emptyState)emptyState.hidden=visible!==0;
}
async function showSearch(id){
 try{
  if(searchFrozen)return;
  const data=await api(`/api/searches/${id}`);
  if(page!=='discover'||currentSearchId!=id)return;
  const key=JSON.stringify([id,state.openalex_key_available,data.search.finished_at,data.search.errors,data.search.openalex_cursor,data.results.map(r=>[r.id,r.locations,r.monitored_source_ids])]);
  if(key===searchRenderKey&&currentSearchData)return;
  searchRenderKey=key;currentSearchData=data;
  const options=searchFilterOptions(data.results);
  const oldSearch=data.results.length&&data.results.every(r=>r.source==='OpenAlex'&&!r.locations?.length);
  const controls=data.results.length?`<div class="result-filter-panel" id="result-filter-panel"><div class="result-filter-head"><div><strong>Filter visible results by location</strong><p>All returned results are saved. These choices only change the display.</p></div><button class="button tertiary small" data-action="clear-result-filters">Clear filters</button></div>${oldSearch?'<div class="legacy-search-note"><span>This search predates location tracking. Rerun it to identify journals and repositories.</span><button class="button secondary small" data-action="rerun-search">Rerun search</button></div>':''}<div class="result-filter-grid"><div><h3>Show only selected locations</h3><p>Leave everything unchecked to show all.</p>${options.monitored.length?`<div class="filter-group-label">Your saved sources</div><div class="location-list">${searchFilterCheckboxes(options.monitored,'include')}</div><p>An inactive source can still match indexed papers by venue or website.</p>`:''}<div class="filter-group-label">Locations found in results</div><div class="location-list">${searchFilterCheckboxes(options.venues,'include')}</div></div><div><h3>Hide matching locations</h3><p>For example, check Zenodo to remove results listed there.</p><div class="location-list">${searchFilterCheckboxes(options.venues,'hide')}</div></div></div></div>`:'';
  const cards=data.results.map((r,index)=>`<div class="result-card" data-result-index="${index}"><div class="badge-line">${pill(r.is_new?'New paper':'Seen before',r.is_new?'':'neutral')}<span class="pill blue">Found via ${e(r.source)}</span>${placesFor(r).slice(0,2).map(place=>`<span class="pill neutral">${e(place.name)}</span>`).join('')}${placesFor(r).length>2?`<span class="card-meta">+${placesFor(r).length-2} more locations</span>`:''}</div><h3><a href="${url(r.url)}" target="_blank" rel="noopener">${e(r.title)} ↗</a></h3><p>${e(r.abstract||'Abstract not available from this index.')}</p><span class="card-meta">${e(r.published||'Publication date unavailable')}</span></div>`).join('');
  $('#search-results').innerHTML=(data.search.errors||[]).map(x=>`<div class="error-note">${e(x)}</div>`).join('')+controls+cards+(data.results.length?`<div id="filter-empty" hidden>${empty('∅','No results match these locations','Clear or change the location filters to see the other search results.')}</div>`:data.search.finished_at?empty('∅','No papers found','Try a broader phrase or select a different source.'):'<p class="muted">Searching sources…</p>')+(data.search.finished_at&&data.search.openalex_cursor?(state.openalex_key_available?`<div class="form-actions"><button class="button secondary" data-action="more-search" data-id="${id}">Load more OpenAlex results${data.search.openalex_total?` (of ${data.search.openalex_total})`:''}</button></div>`:'<div class="hint">More OpenAlex results require a free API key. Ask your administrator to add it in Model settings → API access.</div>'):'');
  applySearchFilters();
 }catch(err){toast(err.message,true);}
}

function library(){
 const papers=libraryData?.papers||[];
 const prefs=state.preferences||{};
 const groups=state.paper_groups||[];
 const selectedGroup=groups.some(group=>String(group.id)===String(prefs.library_group))?String(prefs.library_group):'';
 const groupStatus=state.llm_status?.group||{};
 return head('Archive','Paper library','Papers discovered by your monitored sources, with matching decisions and saved summaries.',`<div class="row-actions"><button class="button secondary" data-action="refresh-library">Refresh papers</button><button class="button secondary" data-action="retry-pending" ${state.paper_stats?.retryable===0?'disabled title="No papers are eligible for retry"':''}>↻ &nbsp;Retry errors and pending${state.paper_stats?.retryable!=null?` (${state.paper_stats.retryable})`:''}</button></div>`)
 + llmNotice()
 + `<div class="panel"><div class="panel-head"><h2>Similarity groups</h2><span class="panel-kicker">Built on request</span></div><p class="intro">The grouping model organizes papers by topic and method. Rebuilding replaces your previous groups after the task succeeds. New papers are not grouped until you rebuild.</p><form id="groupForm"><div class="form-grid"><div class="field"><label>Papers to group</label><select name="scope"><option value="relevant">Relevant papers (${state.paper_stats?.relevant||0})</option><option value="all">All papers (${state.paper_stats?.total||0})</option></select></div><div class="field"><label>Grouping model</label><div class="hint">${e(groupStatus.usable?`${groupStatus.provider} / ${groupStatus.model}`:groupStatus.reason||'Ask the administrator to set a grouping model.')}</div></div></div><p class="hint">Grouping all papers makes many model requests; watch the task progress and your provider balance.</p><div class="form-actions"><button class="button" type="submit" ${groupStatus.usable?'':'disabled'}>Group papers</button></div></form>${groups.length?`<div class="list" style="margin-top:18px">${groups.map(group=>`<div class="list-row"><div class="row-main"><div class="row-title">${e(group.name)} · ${group.paper_count} papers</div><div class="row-sub">${e(group.description)} · ${e(group.scope)} · ${e(group.model)} · ${fmt(group.created_at)}</div></div><button class="button secondary small" data-action="select-group" data-id="${group.id}">Show papers</button></div>`).join('')}</div>`:'<p class="hint">No similarity groups yet.</p>'}</div>`
 + `<div class="panel"><div class="panel-head"><h2>Filter papers</h2><span id="library-count" class="panel-kicker">${libraryData?`${papers.length} of ${libraryData.total} shown`:'Loading…'}</span></div>
 <div class="form-grid"><div class="field"><label>Matching decision</label><select id="library-filter"><option value="all" ${prefs.library_filter==='all'?'selected':''}>All papers</option><option value="relevant" ${prefs.library_filter==='relevant'?'selected':''}>Relevant only</option><option value="pending" ${prefs.library_filter==='pending'?'selected':''}>Needs review</option></select></div><div class="field"><label>Similarity group</label><select id="library-group"><option value="">All groups</option>${groups.map(group=>`<option value="${group.id}" ${selectedGroup===String(group.id)?'selected':''}>${e(group.name)} (${group.paper_count})</option>`).join('')}</select></div></div>
 <h3 class="library-filter-heading">Publication date</h3><div class="form-grid"><div class="field"><label>Quick publication interval</label><select id="library-published-period"><option value="all">Any date</option><option value="today">Today</option><option value="week">Last 7 days</option><option value="month">This month</option><option value="custom" ${prefs.library_published_from||prefs.library_published_to?'selected':''}>Custom interval</option></select></div><div class="field"><label>Published from</label><input id="library-published-from" type="date" value="${e(prefs.library_published_from||'')}"></div><div class="field"><label>Published through</label><input id="library-published-to" type="date" value="${e(prefs.library_published_to||'')}"></div></div><p class="hint">Both dates are included. Set the same date twice for one day. Papers without a complete publication date are excluded when this filter is active.</p>
 <h3 class="library-filter-heading">Date found by Paperwatch</h3><div class="form-grid"><div class="field"><label>Quick found interval</label><select id="library-period"><option value="all">Any date</option><option value="today">Today</option><option value="week">Last 7 days</option><option value="month">This month</option><option value="custom" ${prefs.library_from||prefs.library_to?'selected':''}>Custom interval</option></select></div><div class="field"><label>Found from (UTC)</label><input id="library-from" type="date" value="${e(prefs.library_from||'')}"></div><div class="field"><label>Found through (UTC)</label><input id="library-to" type="date" value="${e(prefs.library_to||'')}"></div></div></div><div id="paper-list">${libraryData?paperCards(papers):'<p class="muted">Loading papers…</p>'}</div><div class="form-actions" id="library-more" ${!libraryData||papers.length>=libraryData.total?'hidden':''}><button class="button secondary" data-action="more-library">Load more papers</button></div>` + taskPanel();
}
function paperCards(papers){return papers.length?papers.map(p=>`<div class="paper-card"><div class="card-top"><div><div class="badge-line">${paperStatusPill(p)}${p.score!=null?pill(`${p.score}% match`,'blue'):''}</div><div class="card-title" style="font-size:16px;margin-top:10px">${e(p.title)}</div><div class="card-meta">${e((state.sources.find(s=>s.id===p.source_id)||{}).name||'Source')} · Published ${e(p.published||'unknown')} · Found ${e((p.first_seen||'').slice(0,10))} UTC${p.collection_method?` · via ${e(p.collection_method)}`:''}</div></div><button class="button secondary small" data-action="detail-paper" data-id="${p.id}">Details</button></div><p class="card-description">${e((p.abstract||'Abstract unavailable').slice(0,420))}${(p.abstract||'').length>420?'…':''}</p>${p.prefilter_reason?`<div class="summary">First pass: ${e(p.prefilter_reason)}</div>`:''}${p.filter_reason?`<div class="summary">${e(p.filter_reason)}</div>`:''}${p.error?`<div class="error-note">${e(p.error)}</div>`:''}<div class="card-foot"><div class="card-meta">${p.filter_status==='error'?'Filtering failed':p.filter_model?`Filtered with ${e(p.filter_provider)} / ${e(p.filter_model)}`:p.filter_status==='prefiltered_out'?'Full processing skipped':'Awaiting filter'}${p.introduction?' · Introduction extracted':''}</div><div class="row-actions"><a class="button tertiary small" href="${url(p.url)}" target="_blank" rel="noopener">Original ↗</a>${p.pdf_path?`<button class="button secondary small" data-action="open-pdf" data-id="${p.id}">Saved PDF</button>`:''}${p.filter_status==='error'||p.filter_status==='needs_topics'||p.filter_status==='prefiltered_out'||(p.relevant&&!p.summary)?`<button class="button secondary small" data-action="retry-paper" data-id="${p.id}">Retry</button>`:''}</div></div></div>`).join(''):empty('▤','No papers match these filters','Change the publication, found, or matching filters to see more papers.');}

async function refreshLibrary(reset=true){
 if(page!=='library')return;
 const from=$('#library-from')?.value||'',to=$('#library-to')?.value||'',publishedFrom=$('#library-published-from')?.value||'',publishedTo=$('#library-published-to')?.value||'',status=$('#library-filter')?.value||'all',group=$('#library-group')?.value||'';
 if(from&&to&&from>to){toast('Found-from date must be before found-through date.',true);return;}
 if(publishedFrom&&publishedTo&&publishedFrom>publishedTo){toast('Published-from date must be before published-through date.',true);return;}
 const offset=reset?0:libraryOffset;
 try{
  const params=new URLSearchParams({status,offset:String(offset),limit:'50'});
  if(from)params.set('start_date',from);if(to)params.set('end_date',to);
  if(publishedFrom)params.set('published_start_date',publishedFrom);if(publishedTo)params.set('published_end_date',publishedTo);
  if(group)params.set('group_id',group);
  const result=await api('/api/papers?'+params);
  if(page!=='library')return;
  libraryData=reset?result:{...result,papers:[...(libraryData?.papers||[]),...result.papers]};
  libraryOffset=libraryData.papers.length;
  $('#paper-list').innerHTML=paperCards(libraryData.papers);
  $('#library-count').textContent=`${libraryData.papers.length} of ${libraryData.total} shown`;
  $('#library-more').hidden=libraryData.papers.length>=libraryData.total;
  savePreferences({library_filter:status,library_from:from,library_to:to,library_published_from:publishedFrom,library_published_to:publishedTo,library_group:group});
 }catch(err){toast(err.message,true);}
}

function settings(){
 if(!adminMode||!adminState)return '';
 const s=state.settings;
 const roles=[['profile','Topic profile','Turns your topic description into a reusable research brief.'],['prefilter','Cheap first pass (optional)','Runs before Paper filter. Clear its Model ID to skip this step, or choose a low-cost model.'],['filter','Paper filter','Scores candidates against your topic profiles.'],['summary','Paper summary','Summarizes papers that match your interests.'],['group','Similarity groups (optional)','Suggests and assigns topic-based groups when a user requests them. Uses the same shared provider key.']];
 const keyLabels={OPENAI_API_KEY:'OpenAI',OPENROUTER_API_KEY:'OpenRouter',GEMINI_API_KEY:'Google Gemini',OPENALEX_API_KEY:'OpenAlex search and paging'};
 return head('Configuration','Model settings','Choose providers and models, then add their API keys below.')
 + llmNotice()
 + `<form id="settingsForm"><div class="settings-grid">${roles.map(([key,label,copy])=>`<div class="settings-card"><h3>${label}</h3><p>${copy}</p><div class="field"><label>Provider</label><select name="${key}_provider">${['openai','openrouter','gemini','ollama'].map(p=>`<option value="${p}" ${s[key+'_provider']===p?'selected':''}>${p==='openai'?'OpenAI':p==='openrouter'?'OpenRouter':p==='gemini'?'Google Gemini':'Ollama (local, optional)'}</option>`).join('')}</select></div><div class="field"><label>Model ID</label><input name="${key}_model" value="${e(s[key+'_model'])}" placeholder="Exact provider model ID"></div></div>`).join('')}</div><div class="form-actions"><button class="button" type="submit">Save model choices</button></div></form>`
 + `<div class="panel" style="margin-top:25px"><div class="panel-head"><h2>API access</h2><span class="panel-kicker">Add, replace, or remove saved keys</span></div><p class="intro">Saved keys take effect for every profile and are stored on the backend. They are never displayed again. OpenAlex shows the first page without a key; a free key is required to load more pages.</p><div class="credential-grid">${Object.entries(keyLabels).map(([name,label])=>`<form class="credential-card" data-key-name="${name}"><div class="credential-head"><strong>${label}</strong>${pill(adminState.keys[name]==='saved'?'Saved on backend':adminState.keys[name]==='environment'?'Environment variable':'Not set',adminState.keys[name]==='missing'?'warn':'')}</div><label for="key-${name}">API key</label><input id="key-${name}" name="value" type="password" autocomplete="off" placeholder="Paste a new key to ${adminState.keys[name]==='missing'?'add':'replace'}" required><div class="row-actions"><button class="button small" type="submit">${adminState.keys[name]==='missing'?'Save key':'Replace key'}</button>${adminState.keys[name]==='saved'?`<button class="button danger small" type="button" data-action="remove-key" data-name="${name}">Remove saved key</button>`:''}</div></form>`).join('')}</div><p class="hint" style="margin-top:14px">Removing a saved key reveals any environment variable for that provider.</p></div>`;
}

function users(){
 if(!adminMode||!adminState)return '';
 return head('Administration','Users and invites','Create a username, then share its private link. Rotate to invalidate the old link. Select a profile to inspect or edit its data.')
 + `<div class="panel"><div class="panel-head"><h2>Create user</h2></div><form id="userForm"><div class="form-grid"><div class="field"><label>Username</label><input name="username" pattern="[a-z][a-z0-9_-]{1,39}" required placeholder="e.g. researcher"></div></div><div class="form-actions"><button class="button" type="submit">Create and show invite</button></div></form></div>`
 + (!adminState.public_url||!adminState.backend_url?`<div class="banner"><div><strong>Invite URL setup needed</strong><p>Set PAPERWATCH_PUBLIC_URL and PAPERWATCH_BACKEND_URL on the backend, then restart it. Tokens can still be generated, but the app cannot make a complete link yet.</p></div></div>`:'')
 + `<div class="panel"><div class="panel-head"><h2>Profiles</h2></div><div class="list">${adminState.users.map(user=>`<div class="list-row"><div class="row-main"><div class="row-title mono">${e(user.username)} ${selectedUsername===user.username?'· selected':''}</div><div class="row-sub">${user.revoked?'Invite revoked':'Invite active'} · Created ${fmt(user.created_at)}</div></div><div class="row-actions"><button class="button secondary small" data-action="select-user" data-name="${e(user.username)}">Open profile</button><button class="button secondary small" data-action="rotate-user" data-id="${user.id}">New invite</button><button class="button tertiary small" data-action="revoke-user" data-id="${user.id}">Revoke</button>${user.username!=='owner'?`<button class="button danger small" data-action="delete-user" data-id="${user.id}">Delete</button>`:''}</div></div>`).join('')}</div></div>`;
}
function showInvite(result){
 const div=document.createElement('div');div.className='detail-overlay';div.id='detail-overlay';
 div.innerHTML=`<div class="detail" role="dialog" aria-modal="true" aria-label="Private invite"><button class="icon-button detail-close" data-action="close-detail">×</button><div class="eyebrow">PRIVATE INVITE</div><h2>${e(result.username)}</h2><p>Copy this now. The token is shown only once; making a new invite invalidates this one.</p>${result.invite_url?`<div class="field"><label>Invite link</label><textarea id="invite-copy" readonly>${e(result.invite_url)}</textarea></div><div class="form-actions"><button class="button" data-action="copy-invite">Copy link</button></div>`:`<p class="error-note">Set the public and backend URLs on the server before sharing an invite.</p><div class="field"><label>One-time token</label><textarea id="invite-copy" readonly>${e(result.token)}</textarea></div>`}</div>`;
 document.body.append(div);
}

function showHistorySource(id){
 const source=state.sources.find(item=>item.id===id);if(!source)return;
 const div=document.createElement('div');div.className='detail-overlay';div.id='detail-overlay';
 div.innerHTML=`<div class="detail" role="dialog" aria-modal="true" aria-label="Search past papers"><button class="icon-button detail-close" data-action="close-detail">×</button><div class="eyebrow">HISTORICAL COLLECTION</div><h2>${e(source.name)}</h2><p>Collect papers first published in this inclusive interval. New papers enter your library and the first-pass LLM pipeline. arXiv uses its own API; feeds need an ISSN or OpenAlex source ID for an indexed fallback.</p><form id="historyForm" data-id="${id}"><div class="form-grid"><div class="field"><label>From</label><input type="date" name="start_date" required></div><div class="field"><label>Through</label><input type="date" name="end_date" required></div></div><div class="form-actions"><button class="button" type="submit">Collect papers</button></div></form></div>`;
 document.body.append(div);
}

function showPaper(id){
 const p=(libraryData?.papers||[]).find(x=>x.id===id)||state.papers.find(x=>x.id===id);if(!p)return;
 detailPaperId=id;
 const div=document.createElement('div');div.className='detail-overlay';div.id='detail-overlay';
 div.innerHTML=`<div class="detail" role="dialog" aria-modal="true" aria-label="Paper details"><button class="icon-button detail-close" data-action="close-detail">×</button><div class="eyebrow">PAPER DETAILS</div><h2>${e(p.title)}</h2><div class="card-meta">${e((p.authors||[]).join(', '))} · ${e(p.published||'Date unknown')}</div><div class="badge-line" style="margin-top:13px">${paperStatusPill(p)}${p.score!=null?pill(`${p.score}% match`,'blue'):''}</div>${p.error?`<div class="error-note">${e(p.error)}</div>`:''}<section><h3>Abstract</h3><p>${e(p.abstract||'No abstract available.')}</p></section>${p.filter_reason?`<section><h3>Why it matched</h3><p>${e(p.filter_reason)}</p></section>`:''}${p.summary?`<section><h3>Summary</h3><p>${e(p.summary)}</p>${p.contributions?.length?`<h3>Contributions</h3><ul>${p.contributions.map(x=>`<li>${e(x)}</li>`).join('')}</ul>`:''}${p.limitations?.length?`<h3>Limitations</h3><ul>${p.limitations.map(x=>`<li>${e(x)}</li>`).join('')}</ul>`:''}</section>`:''}${p.introduction?`<section><h3>Introduction excerpt</h3><p>${e(p.introduction.slice(0,1600))}${p.introduction.length>1600?'…':''}</p></section>`:''}<section><h3>Provenance</h3><p>Found ${e((p.first_seen||'').slice(0,10)||'—')} UTC · ${e(p.collection_method||'Direct source')}</p>${p.prefilter_reason?`<p>First pass: ${e(p.prefilter_reason)} (${e(p.prefilter_provider||'—')} / ${e(p.prefilter_model||'—')})</p>`:''}<p>${e(p.filter_provider||'—')} / ${e(p.filter_model||'—')} filter · ${e(p.summary_provider||'—')} / ${e(p.summary_model||'—')} summary</p><div class="row-actions" style="justify-content:start"><a class="button" href="${url(p.url)}" target="_blank" rel="noopener">Open original ↗</a>${p.pdf_path?`<button class="button secondary" data-action="open-pdf" data-id="${p.id}">Open saved PDF</button>`:''}<button class="button secondary" data-action="retry-paper" data-id="${p.id}">Reprocess</button></div></section></div>`;
 document.body.append(div);
}
function showScraper(){
 const div=document.createElement('div');div.className='detail-overlay';div.id='detail-overlay';
 div.innerHTML=`<div class="detail" role="dialog" aria-modal="true" aria-label="Add custom scraper"><button class="icon-button detail-close" data-action="close-detail">×</button><div class="eyebrow">SOURCE ADAPTER</div><h2>Add a custom scraper</h2><p>For sites without a feed or API, write a Python adapter. It runs with your backend's permissions; install only code you trust. It must return a list of papers with at least <span class="mono">title</span> and <span class="mono">url</span>. For Search past dates, also implement <span class="mono">fetch_range(source, start_date, end_date, query=None)</span>.</p><form id="scraperForm"><div class="field"><label>Scraper name</label><input name="name" required placeholder="my_repository" pattern="[a-z][a-z0-9_]*"></div><div class="field" style="margin-top:14px"><label>Python code</label><textarea class="code-editor" name="code" spellcheck="false" required>from paperwatch.adapters import request_json\n\ndef fetch(source, query=None):\n    # Adapt this example to the site's public JSON or HTML.\n    data = request_json(source["url"])\n    return [\n        {\n            "title": item["title"],\n            "abstract": item.get("abstract", ""),\n            "url": item["url"],\n            "pdf_url": item.get("pdf_url", ""),\n            "published": item.get("published", ""),\n            "keywords": item.get("keywords", []),\n            "introduction": item.get("introduction", ""),\n        }\n        for item in data.get("papers", [])\n        if not query or query.lower() in (item["title"] + " " + item.get("abstract", "")).lower()\n    ]</textarea></div><div class="form-actions"><button class="button" type="submit">Install scraper</button></div></form></div>`;
 document.body.append(div);
}

async function editScraper(name){
 const scraper=await api(`/api/scrapers/${encodeURIComponent(name)}`);
 showScraper();
 const dialog=$('#detail-overlay');
 dialog.querySelector('h2').textContent=`Edit ${name}`;
 const form=dialog.querySelector('#scraperForm');
 form.dataset.editName=name;
 form.elements.namedItem('name').value=name;
 form.elements.namedItem('name').readOnly=true;
 form.elements.namedItem('code').value=scraper.code;
 form.querySelector('button[type=submit]').textContent='Save changes';
}

document.addEventListener('click', async ev=>{
 const nav=ev.target.closest('[data-page]');if(nav){navigate(nav.dataset.page);return;}
 const btn=ev.target.closest('[data-action]');if(!btn)return;
 const action=btn.dataset.action,id=Number(btn.dataset.id);
 try{
  if(action==='close-detail'){btn.closest('.detail-overlay').remove();return;}
  if(action==='copy-invite'){await navigator.clipboard.writeText($('#invite-copy').value);toast('Invite link copied.');return;}
  if(action==='select-user'){
   selectedUsername=btn.dataset.name;currentSearchId=null;currentSearchData=null;searchRenderKey='';libraryData=null;trackedPaperJobIds.clear();includeLocations.clear();hideLocations.clear();catalogKind='all';catalogArea='all';catalogText='';dirtyForm=false;
   await startApp();navigate('overview');$('#workspace-detail').textContent=`Viewing ${selectedUsername}`;return;
  }
  if(action==='rotate-user'){
   const result=await api(`/api/admin/users/${id}/invite`,{method:'POST'});
   adminState=await api('/api/admin/state');draw();showInvite(result);return;
  }
  if(action==='revoke-user'){
   if(!confirm('Revoke this invite now? The user will lose access until you make a new one.'))return;
   await api(`/api/admin/users/${id}/revoke`,{method:'POST'});adminState=await api('/api/admin/state');draw();return;
  }
  if(action==='delete-user'){
   if(!confirm('Permanently delete this user, their papers, searches, topics, sources, and saved PDFs?'))return;
   await api(`/api/admin/users/${id}`,{method:'DELETE'});adminState=await api('/api/admin/state');
   if(!adminState.users.some(user=>user.username===selectedUsername)){selectedUsername='owner';await startApp();}
   draw();return;
  }
  if(action==='clear-result-filters'){includeLocations.clear();hideLocations.clear();dirtyForm=true;document.querySelectorAll('[data-location-filter]').forEach(el=>el.checked=false);applySearchFilters();savePreferences({include_locations:[],hide_locations:[]});return;}
  if(action==='rerun-search'&&currentSearchData){const f=$('#searchForm');f.elements.namedItem('query').value=currentSearchData.search.query;f.elements.namedItem('recent_days').value=String(currentSearchData.search.recent_days||0);f.elements.namedItem('start_date').value=currentSearchData.search.start_date||'';f.elements.namedItem('end_date').value=currentSearchData.search.end_date||'';f.requestSubmit();return;}
  if(action==='preset-arxiv'){window.editingSource=null;draw();const f=$('#sourceForm');f.elements.namedItem('name').value='arXiv · Computer Security';f.elements.namedItem('url').value='https://arxiv.org';f.elements.namedItem('adapter').value='arxiv';f.elements.namedItem('config_value').value='cat:cs.CR';dirtyForm=true;f.scrollIntoView({behavior:'smooth'});return;}
  if(action==='preset-iacr'){window.editingSource=null;draw();const f=$('#sourceForm');f.elements.namedItem('name').value='IACR ePrint';f.elements.namedItem('url').value='https://eprint.iacr.org';f.elements.namedItem('adapter').value='feed';f.elements.namedItem('config_value').value='https://eprint.iacr.org/rss/atom.xml?order=recent';f.elements.namedItem('interval_hours').value='24';dirtyForm=true;f.scrollIntoView({behavior:'smooth'});return;}
  if(action==='catalog-use'){
   const choice=catalog.find(c=>c.id===btn.dataset.key);if(!choice||choice.sourceable===false)return;
   window.editingSource=null;draw();const f=$('#sourceForm');
   f.elements.namedItem('name').value=choice.name;f.elements.namedItem('url').value=choice.url;
   f.elements.namedItem('adapter').value=choice.adapter||'';f.elements.namedItem('config_value').value=choice.config||'';
   f.elements.namedItem('interval_hours').value=choice.interval_hours||24;
   f.elements.namedItem('issn').value=choice.issn||'';f.elements.namedItem('openalex_source_id').value=choice.openalex_source_id||'';
   dirtyForm=true;f.scrollIntoView({behavior:'smooth'});return;
  }
  if(action==='show-scraper'){showScraper();return;}
  if(action==='edit-scraper'){await editScraper(btn.dataset.name);return;}
  if(action==='delete-scraper'){
   const name=btn.dataset.name;
   if(!confirm(`Delete adapter ${name}?`))return;
   await api(`/api/scrapers/${encodeURIComponent(name)}`,{method:'DELETE'});
   scrapers=(await api('/api/scrapers')).scrapers;toast('Adapter deleted.');await load();return;
  }
  if(action==='remove-key'){
   const name=btn.dataset.name;
   if(!confirm(`Remove the saved ${name} key?`))return;
   await api(`/api/keys/${name}`,{method:'DELETE'});
   toast('Saved key removed.');await load();return;
  }
  if(action==='edit-source'){window.editingSource=state.sources.find(s=>s.id===id);dirtyForm=true;draw();$('#source-form').scrollIntoView({behavior:'smooth'});return;}
  if(action==='cancel-source'){window.editingSource=null;dirtyForm=false;draw();return;}
  if(action==='run-source'){await api(`/api/sources/${id}/run`,{method:'POST'});toast('Source run queued.');await load();return;}
  if(action==='history-source'){showHistorySource(id);return;}
  if(action==='cancel-job'){await api(`/api/jobs/${id}/cancel`,{method:'POST'});toast('Cancellation requested. The current network call may finish first.');await load(false);return;}
  if(action==='freeze-search'){searchFrozen=!searchFrozen;btn.textContent=searchFrozen?'Resume display':'Freeze display';if(!searchFrozen&&currentSearchId)showSearch(currentSearchId);return;}
  if(action==='more-search'){const result=await api(`/api/searches/${id}/more`,{method:'POST'});toast(result.queued?'Loading another page.':'Page already loading.');await load(false);return;}
  if(action==='more-library'){await refreshLibrary(false);return;}
  if(action==='refresh-library'){await load(false);await refreshLibrary(true);return;}
  if(action==='select-group'){$('#library-group').value=String(id);await refreshLibrary(true);return;}
  if(action==='toggle-source'){const s=state.sources.find(x=>x.id===id);await api(`/api/sources/${id}`,{method:'PATCH',body:JSON.stringify({enabled:!s.enabled})});toast(s.enabled?'Source paused.':'Source resumed.');await load();return;}
  if(action==='delete-source'){if(!confirm('Delete this source? Papers already found will stay in the library.'))return;await api(`/api/sources/${id}`,{method:'DELETE'});toast('Source deleted.');await load();return;}
  if(action==='profile-topic'){await api(`/api/topics/${id}/profile`,{method:'POST'});toast('Profile regeneration queued.');await load();return;}
  if(action==='delete-topic'){if(!confirm('Delete this topic? Existing decisions remain.'))return;await api(`/api/topics/${id}`,{method:'DELETE'});toast('Topic deleted.');await load();return;}
  if(action==='retry-paper'){const result=await api(`/api/papers/${id}/retry`,{method:'POST'});if(result.job_id)trackedPaperJobIds.add(result.job_id);toast(result.queued?'Paper reprocessing queued.':'Paper is already queued.');await load(false);return;}
  if(action==='open-pdf'){await openPdf(id);return;}
  if(action==='retry-pending'){const result=await api('/api/papers/retry-pending',{method:'POST'});if(result.job_id)trackedPaperJobIds.add(result.job_id);toast(result.eligible===0?'No papers are eligible for retry.':result.queued?`${result.eligible} papers queued for reprocessing.`:'Batch is already queued.');await load(false);return;}
  if(action==='detail-paper'){showPaper(id);return;}
  if(action==='view-search'){selectSearch(id);navigate('discover');return;}
 }catch(err){toast(err.message,true);}
});
document.addEventListener('submit',async ev=>{
 const f=ev.target;if(!['connectForm','sourceForm','historyForm','topicForm','searchForm','settingsForm','scraperForm','userForm','groupForm'].includes(f.id)&&!f.matches('.credential-card'))return;ev.preventDefault();
 const data=Object.fromEntries(new FormData(f).entries());
 try{
  if(f.id==='connectForm'){
   if(publicPage){await connectInvite(data.invite_url.trim());toast('Profile opened.');return;}
   backendAuth='Bearer '+data.admin_key.trim();
   try{adminState=await api('/api/admin/state');}catch(error){backendAuth='';throw error;}
   selectedUsername=adminState.users.find(user=>user.username==='owner')?.username||adminState.users[0]?.username||'';
   connected=true;$('#connection-switch').hidden=false;$('#connection-switch').textContent='End admin session';$('#workspace-label').textContent='Administrator';$('#workspace-detail').textContent=`Viewing ${selectedUsername}`;
   document.querySelectorAll('.admin-only').forEach(el=>el.hidden=false);
   await startApp();navigate('users');return;
  }
  if(f.id==='userForm'){
   const result=await api('/api/admin/users',{method:'POST',body:JSON.stringify({username:data.username})});
   adminState=await api('/api/admin/state');draw();showInvite(result);return;
  }
  if(f.matches('.credential-card')){
   await api(`/api/keys/${f.dataset.keyName}`,{method:'PUT',body:JSON.stringify({value:data.value})});
   f.reset();dirtyForm=false;adminState=await api('/api/admin/state');toast('API key saved.');await load();return;
  }
  if(f.id==='sourceForm'){
   const adapter=data.adapter||'';const config=adapter==='arxiv'?{query:data.config_value.trim()}:adapter==='feed'?{feed_url:data.config_value.trim()}:adapter==='crossref'?{}:data.config_value?{value:data.config_value.trim()}:{};
   if(data.issn?.trim())config.issn=data.issn.trim();if(data.openalex_source_id?.trim())config.openalex_source_id=data.openalex_source_id.trim();
   const body={name:data.name.trim(),url:data.url.trim(),adapter,adapter_config:config,interval_hours:Number(data.interval_hours),enabled:!!f.elements.namedItem('enabled').checked};
   await api(f.dataset.id?`/api/sources/${f.dataset.id}`:'/api/sources',{method:f.dataset.id?'PATCH':'POST',body:JSON.stringify(body)});
   window.editingSource=null;dirtyForm=false;toast(f.dataset.id?'Source updated.':'Source added.');await load();return;
  }
  if(f.id==='historyForm'){
   if(data.start_date>data.end_date)throw new Error('Start date must be on or before end date.');
   const result=await api(`/api/sources/${f.dataset.id}/history`,{method:'POST',body:JSON.stringify({start_date:data.start_date,end_date:data.end_date})});
   f.closest('.detail-overlay').remove();toast(result.queued?'Historical collection queued. Watch Tasks for progress.':'This source already has a collection running.');await load(false);return;
  }
  if(f.id==='topicForm'){await api('/api/topics',{method:'POST',body:JSON.stringify(data)});dirtyForm=false;toast('Topic saved. Profile generation queued.');await load();return;}
  if(f.id==='groupForm'){
   const result=await api('/api/groups/rebuild',{method:'POST',body:JSON.stringify({scope:data.scope})});
   if(result.job_id)trackedPaperJobIds.add(result.job_id);
   dirtyForm=false;
   toast(result.queued?`Grouping ${result.papers} papers. Watch Tasks for progress.`:'A grouping task is already running.');
   await load(false);return;
  }
  if(f.id==='settingsForm'){await api('/api/settings',{method:'POST',body:JSON.stringify(data)});dirtyForm=false;adminState=await api('/api/admin/state');toast('Model choices saved.');await load();return;}
  if(f.id==='scraperForm'){
   const editing=f.dataset.editName;
   const sourceFormBefore=$('#sourceForm');
   const sourceDraft=sourceFormBefore?{values:Object.fromEntries(new FormData(sourceFormBefore).entries()),enabled:sourceFormBefore.elements.namedItem('enabled').checked}:null;
   await api(editing?`/api/scrapers/${encodeURIComponent(editing)}`:'/api/scrapers',{method:editing?'PATCH':'POST',body:JSON.stringify(data)});
   scrapers=(await api('/api/scrapers')).scrapers;$('#detail-overlay').remove();dirtyForm=false;
   toast(editing?'Adapter updated. It will be used on the next run.':'Adapter saved. Select it for a source.');await load();
   if(sourceDraft&&page==='sources'){
    const sourceFormAfter=$('#sourceForm');
    for(const [key,value] of Object.entries(sourceDraft.values)){const field=sourceFormAfter.elements.namedItem(key);if(field)field.value=value;}
    sourceFormAfter.elements.namedItem('enabled').checked=sourceDraft.enabled;
    if(!editing)sourceFormAfter.elements.namedItem('adapter').value=`custom:${data.name}`;
    dirtyForm=true;
   }
   return;
  }
  if(f.id==='searchForm'){
   const ids=[...f.querySelectorAll('input[name=source]:checked')].map(x=>Number(x.value));
   const result=await api('/api/search',{method:'POST',body:JSON.stringify({query:data.query,source_ids:ids,recent_days:Number(data.recent_days),start_date:data.start_date,end_date:data.end_date})});selectSearch(result.id);dirtyForm=false;toast('Search started.');await load();showSearch(result.id);return;
  }
 }catch(err){toast(err.message,true);}
});
document.addEventListener('input',ev=>{if(ev.target.closest('form'))dirtyForm=true;if(ev.target.id==='catalog-search'){catalogText=ev.target.value;dirtyForm=true;renderCatalog();}});
function savePreferences(patch){if(!connected)return;api('/api/preferences',{method:'PATCH',body:JSON.stringify(patch)}).catch(err=>toast(err.message,true));}
document.addEventListener('change',ev=>{
 if(ev.target.closest('form'))dirtyForm=true;
 if(ev.target.dataset.locationFilter){const group=ev.target.dataset.locationFilter==='include'?includeLocations:hideLocations;ev.target.checked?group.add(ev.target.dataset.key):group.delete(ev.target.dataset.key);dirtyForm=true;applySearchFilters();savePreferences({include_locations:[...includeLocations],hide_locations:[...hideLocations]});}
 if(ev.target.id==='catalog-kind'){catalogKind=ev.target.value;dirtyForm=true;renderCatalog();savePreferences({catalog_kind:catalogKind});}
 if(ev.target.id==='catalog-area'){catalogArea=ev.target.value;dirtyForm=true;renderCatalog();savePreferences({catalog_area:catalogArea});}
 if(['library-period','library-published-period'].includes(ev.target.id)){
  const today=new Date().toISOString().slice(0,10);let from='',to='';
  if(ev.target.value==='today'){from=today;to=today;}
  if(ev.target.value==='week'){const d=new Date(today+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-6);from=d.toISOString().slice(0,10);to=today;}
  if(ev.target.value==='month'){from=today.slice(0,7)+'-01';to=today;}
  if(ev.target.value!=='custom'){
   const prefix=ev.target.id==='library-period'?'library':'library-published';
   $(`#${prefix}-from`).value=from;$(`#${prefix}-to`).value=to;refreshLibrary(true);
  }
 }
 if(['library-filter','library-group','library-from','library-to','library-published-from','library-published-to'].includes(ev.target.id)){
  if(['library-from','library-to'].includes(ev.target.id))$('#library-period').value='custom';
  if(['library-published-from','library-published-to'].includes(ev.target.id))$('#library-published-period').value='custom';
  refreshLibrary(true);
 }
});
$('#refresh').addEventListener('click',async()=>{if(!connected){showConnect();return;}await load();if(page==='library')refreshLibrary(true);if(page==='discover'&&currentSearchId)showSearch(currentSearchId);});
$('#connection-switch').addEventListener('click',()=>{backendAuth='';state=null;adminState=null;connected=false;selectedUsername='';currentSearchId=null;currentSearchData=null;searchRenderKey='';libraryData=null;trackedPaperJobIds.clear();catalogKind='all';catalogArea='all';catalogText='';includeLocations.clear();hideLocations.clear();if(publicPage)location.hash='';document.querySelectorAll('.admin-only').forEach(el=>el.hidden=true);$('#connection-switch').hidden=true;showConnect();});
setInterval(async()=>{if(!connected)return;await load(!dirtyForm&&page!=='discover'&&page!=='library');if(page==='discover'&&currentSearchId&&!searchFrozen)showSearch(currentSearchId);let paperJobFinished=false,groupJobFinished=false;for(const id of trackedPaperJobIds){const job=state?.jobs?.items?.find(item=>item.id===id);if(job&&['completed','failed','cancelled'].includes(job.status)){trackedPaperJobIds.delete(id);paperJobFinished=true;if(job.kind==='groups')groupJobFinished=true;}}if(groupJobFinished&&page==='library')draw();if(paperJobFinished&&page==='library')await refreshLibrary(true);},5000);
async function startApp(){
 try{
  const results=await Promise.all([api('/api/scrapers'),fetch('./catalog.json').then(res=>res.json())]);
  scrapers=results[0].scrapers;catalog=results[1];
 }catch(err){toast(`Source directory unavailable: ${err.message}`,true);}
 await load();
 if(connected){$('#workspace-label').textContent=adminMode?'Administrator':selectedUsername;$('#workspace-detail').textContent=adminMode?`Viewing ${selectedUsername}`:'Private profile';}
}
showConnect();
if(publicPage&&location.hash)connectInvite(location.href).catch(err=>{backendAuth='';toast(err.message,true);showConnect();});
