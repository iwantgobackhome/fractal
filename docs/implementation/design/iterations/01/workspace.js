'use strict';

// Local review fixtures only: no hub, account, telemetry, or external network requests.
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths = {
  library:'M4 4h4v16H4zM10 4h4v16h-4zM16 5l4-1 3 15-4 1z',
  home:'m3 10 9-7 9 7M5 9v12h5v-7h4v7h5V9',
  search:'M20 20l-5-5M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0',
  folder:'M3 7V5h7l2 2h9v13H3z',
  clock:'M12 7v5l4 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  bookmark:'M6 3h12v18l-6-4-6 4z',
  download:'M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4',
  plus:'M12 4v16M4 12h16',
  chevron:'m9 5 7 7-7 7',
  down:'m6 9 6 6 6-6',
  left:'m15 5-7 7 7 7',
  arrow:'M4 12h16m-6-6 6 6-6 6',
  close:'m6 6 12 12M6 18 18 6',
  dots:'M5 12h.01M12 12h.01M19 12h.01',
  grid:'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  list:'M8 6h13M8 12h13M8 18h13M3 6h1M3 12h1M3 18h1',
  settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z',
  news:'M5 3h14v18H5zM8 7h8M8 11h8M8 15h4',
  topic:'M12 3v18M3 12h18M5 5l14 14M5 19 19 5',
  check:'m5 12 4 4L19 6',
  pen:'m4 16 12-12 4 4L8 20H4zM14 6l4 4',
  highlighter:'m5 14 9-9 5 5-9 9zM3 21h12',
  text:'M4 5h16M12 5v15M8 20h8',
  eraser:'m3 14 10-11 8 8-10 10H9zM7 18l9-10M11 21h10',
  note:'M4 3h16v13l-5 5H4zM15 21v-5h5M8 8h8M8 12h6',
  undo:'M4 10h10a6 6 0 0 1 0 12M4 10l5-5M4 10l5 5',
  redo:'M20 10H10a6 6 0 0 0 0 12M20 10l-5-5M20 10l-5 5',
  chat:'M3 4h18v13H9l-6 4zM7 9h10M7 13h6',
  link:'M9 15l6-6M7 13l-3 3a3 3 0 0 0 4 4l3-3M13 7l3-3a3 3 0 0 1 4 4l-3 3',
  offline:'m3 3 18 18M3 8a15 15 0 0 1 4-2M11 5a15 15 0 0 1 10 3M6 12a10 10 0 0 1 4-2M15 11l3 1M9 16a5 5 0 0 1 6 0M12 20h.01',
  warning:'m12 3 10 18H2zM12 9v5M12 18h.01',
  sun:'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10M12 1v2M12 21v2M1 12h2M21 12h2M4 4l2 2M18 18l2 2M4 20l2-2M18 6l2-2',
  export:'M12 16V3m-5 5 5-5 5 5M4 13v8h16v-8',
  minus:'M4 12h16',
  sort:'M5 4v16m-3-3 3 3 3-3M12 5h9M12 10h6M12 15h3',
  pin:'M8 3h8l-1 7 4 4H5l4-4zM12 14v8',
};
const icon = (name, extra='') => `<svg class="icon ${extra}" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.folder}"/></svg>`;
const iconButton = (name, label, action, extra='') => `<button class="icon-button ${extra}" aria-label="${label}" title="${label}" data-action="${action}">${icon(name)}</button>`;
const papers = [
  {id:'attention',title:'Attention Is All You Need',ko:'어텐션만으로 충분하다: 순환 구조 없이 시퀀스 변환을 학습하는 트랜스포머',authors:'Vaswani, Shazeer, Parmar 외 5명',source:'NeurIPS · 2017',tags:['Transformer','기초 논문'],pages:15,page:3,percent:23,saved:true,cached:true,folder:'foundation',status:'번역 완료',date:'오늘',reason:'트랜스포머 기초'},
  {id:'rag',title:'Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks',ko:'지식 집약적 자연어 처리 작업을 위한 검색 증강 생성',authors:'Lewis, Perez, Piktus 외 9명',source:'NeurIPS · 2020',tags:['RAG','언어 모델'],pages:19,page:7,percent:38,saved:true,cached:true,folder:'rag-folder',status:'번역 완료',date:'어제',reason:'검색 증강 생성'},
  {id:'lora',title:'LoRA: Low-Rank Adaptation of Large Language Models',ko:'대규모 언어 모델의 저차원 적응',authors:'Hu, Shen, Wallis 외 5명',source:'ICLR · 2022',tags:['효율적 학습','LLM'],pages:26,page:1,percent:0,saved:true,cached:true,folder:'llm',status:'번역 8 / 26쪽',date:'9월 28일',reason:'효율적 학습'},
  {id:'long',title:'긴 문맥을 읽는 언어 모델의 근거 추적과 신뢰도 평가: 검색, 인용, 질문 응답을 함께 살펴보는 연구 노트',ko:'긴 문맥을 읽는 언어 모델의 근거 추적과 신뢰도 평가',authors:'김지우, 이서연, 박민준',source:'연구 노트 · 2026',tags:['긴 문맥','평가'],pages:32,page:12,percent:41,saved:true,cached:false,folder:'llm',status:'원문',date:'9월 26일',reason:'긴 문맥 평가'},
  {id:'diffusion',title:'Denoising Diffusion Probabilistic Models',ko:'노이즈 제거 확산 확률 모델',authors:'Ho, Jain, Abbeel',source:'NeurIPS · 2020',tags:['생성 모델','확산'],pages:16,page:1,percent:0,saved:true,cached:true,folder:'vision',status:'원문',date:'9월 25일',reason:'생성 모델'},
  {id:'clip',title:'Learning Transferable Visual Models From Natural Language Supervision',ko:'자연어 감독으로 전이 가능한 시각 모델 학습하기',authors:'Radford, Kim, Hallacy 외 9명',source:'ICML · 2021',tags:['멀티모달','CLIP'],pages:48,page:1,percent:0,saved:true,cached:false,folder:'vision',status:'원문',date:'9월 24일',reason:'멀티모달'},
  {id:'bert',title:'BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding',ko:'언어 이해를 위한 깊은 양방향 트랜스포머의 사전 학습',authors:'Devlin, Chang, Lee, Toutanova',source:'NAACL · 2019',tags:['사전 학습','기초 논문'],pages:16,page:4,percent:25,saved:false,cached:true,folder:null,status:'원문',date:'어제',reason:'최근 열어본 논문'},
  {id:'flash',title:'FlashAttention: Fast and Memory-Efficient Exact Attention with IO-Awareness',ko:'입출력을 고려한 빠르고 메모리 효율적인 정확한 어텐션',authors:'Dao, Fu, Ermon 외 2명',source:'NeurIPS · 2022',tags:['어텐션','효율'],pages:34,page:1,percent:0,saved:false,cached:false,folder:null,status:'원문',date:'오늘',reason:'Attention Is All You Need와 관련'},
];
papers.forEach(p=>{p.folders=p.folder?[p.folder]:[];});
papers[0].folders.push('seminar');
const folders = [
  {id:'llm',name:'언어 모델',parent:null,open:true},
  {id:'foundation',name:'트랜스포머 기초',parent:'llm',open:false},
  {id:'rag-folder',name:'검색 증강 생성',parent:'llm',open:false},
  {id:'vision',name:'컴퓨터 비전',parent:null,open:false},
  {id:'seminar',name:'10월 세미나',parent:null,open:false},
];
const params = new URLSearchParams(location.search);
const supportedViews = ['desktop-library','desktop-reader','tablet-library','tablet-reader','phone'];
const state = {
  view:supportedViews.includes(params.get('view')) ? params.get('view') : 'desktop-library',
  screen:params.get('screen') || (params.get('view')?.includes('reader') ? 'reader' : 'library'),
  theme:['light','dark','sepia'].includes(params.get('theme')) ? params.get('theme') : 'light',
  status:['ready','empty','loading','error','offline'].includes(params.get('state')) ? params.get('state') : 'ready',
  shelf:'saved',folder:null,query:'',sort:'recent',grid:true,selected:'attention',paper:'attention',
  panel:!params.get('view')?.includes('tablet') && params.get('view') !== 'phone',panelTab:'questions',
  mode:'split',compactPane:'source',page:3,zoom:100,linked:true,tool:'pen',target:'한국어',model:'Codex · 기본 모델',
  draft:'',activeQuestion:'트랜스포머가 순환 신경망 없이 문맥을 이해할 수 있는 이유는 무엇인가요?',
  activeAnswer:true,history:[{id:0,title:'위치 인코딩은 왜 필요한가요?',date:'어제 · 오후 4:20',answer:'어텐션만으로는 토큰 순서를 구분하지 못합니다. 위치 인코딩을 입력 임베딩에 더해 순서 정보를 제공합니다.',page:5}],
  historySelection:null,historyFilter:'all',activeKind:'question',activeContext:null,sessions:{},topic:'전체',newsTranslated:false,annotationPane:'source',notes:[
    {id:'n1',paper:'attention',pane:'source',page:3,x:62,y:48,collapsed:false,text:'Q, K, V의 역할을 구분해서 정리하기. 다음 세미나에서 이 식을 설명해 보자.'},
  ],strokes:{source:[],translation:[]},redo:{source:[],translation:[]},
  positions:{source:0,translation:0},returnScreen:'library',translationPaused:false,
};
if (params.get('chrome') === 'hide') document.body.classList.add('hide-review');
let popoverTrigger = null;
let dialogTrigger = null;
let toastTimer = null;
let scrollSyncing = false;
const compact = () => innerWidth < 840;
const mobile = () => innerWidth < 600;
const isTablet = () => state.view.startsWith('tablet');
const currentPaper = () => papers.find(p=>p.id===state.paper);
const savedCount = () => papers.filter(p=>p.saved).length;
const descendants = (id) => [id,...folders.filter(f=>f.parent===id).flatMap(f=>descendants(f.id))];
let selectedContext=null;
const localKey='fractal-workspace-review-v1';
try {
  const saved=JSON.parse(localStorage.getItem(localKey)||'null');
  if(saved){
    if(Array.isArray(saved.papers))saved.papers.forEach(p=>{const original=papers.find(x=>x.id===p.id);if(original)Object.assign(original,p);});
    if(Array.isArray(saved.folders))folders.splice(0,folders.length,...saved.folders);
    if(saved.state)Object.assign(state,saved.state);
    // Explicit URL fixtures take precedence over persisted review choices.
    ['theme','status'].forEach(k=>{const value=params.get(k==='status'?'state':k);if(value)state[k]=value;});
  }
} catch { /* Direct file review may have storage disabled. */ }
// Positioned annotations are restricted to physical original pages in this review.
state.notes=state.notes.filter(n=>n.pane==='source');
state.strokes.translation=[];
state.redo.translation=[];
function persist(){try{localStorage.setItem(localKey,JSON.stringify({papers,folders,state}));}catch{/* In-memory interactions still work. */}}
function rememberSession(){state.sessions[state.paper]={draft:state.draft,activeQuestion:state.activeQuestion,activeAnswer:state.activeAnswer,activeKind:state.activeKind,activeContext:state.activeContext,history:state.history,strokes:state.strokes,redo:state.redo,positions:state.positions};}

function renderReview(){
  const labels=['데스크톱 · 보관함','데스크톱 · 리더','태블릿 · 보관함','태블릿 · 리더','폰'];
  $('#review').innerHTML=`<strong>FRACTAL</strong><span class="review-label">DESIGN REVIEW · 01</span><span class="divider"></span><nav class="review-nav" aria-label="대표 화면">${supportedViews.map((v,i)=>`<button data-action="preset" data-value="${v}" aria-current="${state.view===v}">${labels[i]}</button>`).join('')}</nav><div class="review-options"><button data-action="theme-menu" aria-haspopup="menu">${icon('sun')} ${state.theme==='light'?'라이트':state.theme==='dark'?'다크':'세피아'}</button><button data-action="state-menu" aria-haspopup="menu">${({ready:'기본',empty:'빈 화면',loading:'로딩',error:'오류',offline:'오프라인'})[state.status]} ${icon('down')}</button></div>`;
}
function nav(action,label,name,count=null,active=false){
  return `<button class="nav-item" data-action="${action}" aria-current="${active}">${icon(name)}<span>${label}</span>${count===null?'':`<span class="count">${count}</span>`}</button>`;
}
function folderTree(parent=null){
  return folders.filter(f=>f.parent===parent).map(f=>`<div class="folder-line"><button class="folder-disclosure" data-action="folder-toggle" data-id="${f.id}" aria-label="${escapeHtml(f.name)} ${f.open?'접기':'펼치기'}" aria-expanded="${f.open}">${icon(f.open?'down':'chevron')}</button><button class="nav-item ${state.folder===f.id?'active':''}" data-action="folder-select" data-id="${f.id}">${icon('folder')}<span class="grow">${escapeHtml(f.name)}</span><span class="count">${papers.filter(p=>p.folders.some(id=>descendants(f.id).includes(id))&&p.saved).length}</span></button><button class="icon-button folder-menu" aria-label="${escapeHtml(f.name)} 폴더 메뉴" data-action="folder-menu" data-id="${f.id}">${icon('dots')}</button></div>${f.open?`<div class="folder-children">${folderTree(f.id)}</div>`:''}`).join('');
}
function sidebar(){
  return `<aside class="sidebar" aria-label="작업 공간 탐색"><div class="brand"><img src="mark.svg" alt=""><div class="brand-words">Fractal<div class="brand-caption">Research workspace</div></div></div><nav class="nav-group" aria-label="기본 탐색">${nav('discover','발견','home',null,state.screen==='discover')}${nav('library','보관함','library',savedCount(),state.screen==='library')}${nav('news','뉴스','news',null,state.screen==='news')}${nav('topics','관심 주제','topic',null,state.screen==='topics')}</nav><div class="folders"><div class="sidebar-label"><span>내 라이브러리</span></div><div class="nav-group">${nav('shelf-recent','최근 열어본','clock',papers.filter(p=>p.percent>0).length,state.shelf==='recent'&&!state.folder)}${nav('shelf-saved','저장한 논문','bookmark',savedCount(),state.shelf==='saved'&&!state.folder)}${nav('shelf-offline','오프라인 저장','download',papers.filter(p=>p.cached).length,state.shelf==='offline'&&!state.folder)}</div><div class="sidebar-label"><span>폴더</span><button class="icon-button" data-action="folder-create" aria-label="폴더 추가">${icon('plus')}</button></div>${folderTree()}</div><div class="sidebar-footer"><div class="connection">${state.status==='offline'?'PC 연결 끊김 · 3분 전 동기화':'PC와 마지막 동기화 · 방금'}</div><button class="row button plain" data-action="settings"><span class="avatar">JW</span><span class="account-text grow" style="text-align:left"><strong class="small">지우의 작업 공간</strong><br><span class="small muted">읽고, 연결하고, 발견하기</span></span>${icon('settings')}</button></div></aside>`;
}
function mobileNav(){return `<nav class="mobile-nav" aria-label="하단 탐색">${['discover','library','news','topics'].map((v,i)=>`<button data-action="${v}" aria-current="${state.screen===v}">${icon(['home','library','news','topic'][i])}<span>${['발견','보관함','뉴스','주제'][i]}</span></button>`).join('')}</nav>`;}
function topbar(){
  const name={library:'보관함',discover:'발견',news:'분야 뉴스',topics:'관심 주제'}[state.screen]||'보관함';
  return `<header class="topbar"><div class="breadcrumb"><img class="phone-mark" style="display:none" src="mark.svg" alt="Fractal"><span class="crumb-parent">지우의 작업 공간</span>${icon('chevron','chevron')}<strong>${name}</strong></div><div class="search-box"><button class="icon-button" style="width:24px;min-height:32px" data-action="search-mobile" aria-label="검색 열기">${icon('search')}</button><input id="library-search" aria-label="논문 제목, 저자, DOI 검색" placeholder="논문, 저자, DOI로 검색" value="${escapeHtml(state.query)}"><kbd>Ctrl K</kbd></div><div class="top-actions">${iconButton('settings','보기 및 연결 설정','settings')}</div></header>`;
}
function banner(){
  if(state.status==='offline')return `<div class="status-banner" role="status"><span>${icon('offline')} PC 연결 끊김 · 저장된 논문과 메모를 계속 읽을 수 있어요.</span><button class="button plain" data-action="retry">다시 연결</button></div>`;
  return '';
}
function thumb(p){return `<div class="paper-thumb" aria-hidden="true"><span class="thumb-title">${escapeHtml(p.title)}</span><div class="thumb-lines"></div><div class="thumb-figure"><i></i><i></i><i></i></div><div class="thumb-columns"><div class="thumb-lines"></div><div class="thumb-lines"></div></div></div>`;}
function resumeCard(p){return `<article class="resume-card">${thumb(p)}<div class="grow"><span class="small muted">${p.id==='attention'?'오늘 오전 10:42':'어제 오후 4:20'} · ${p.saved?'저장한 논문':'최근 열어본'}</span><button class="resume-title" data-action="open-paper" data-id="${p.id}">${escapeHtml(p.title)}</button><span class="small muted">${p.id==='attention'?'3 · Attention':'2 · Related Work'}</span><div class="progress-track"><span style="width:${p.percent}%"></span></div><div class="resume-meta"><span>${p.page} / ${p.pages}쪽 · ${p.percent}% 읽음</span><button data-action="open-paper" data-id="${p.id}" aria-label="${escapeHtml(p.title)} 이어 읽기">이어 읽기 ${icon('arrow')}</button></div></div></article>`;}
function paperCard(p){return `<article class="paper-card" data-paper="${p.id}"><div class="paper-card-head"><span class="source-label">${escapeHtml(p.source)}</span><button class="icon-button" data-action="paper-menu" data-id="${p.id}" aria-label="${escapeHtml(p.title)} 메뉴">${icon('dots')}</button></div><button class="paper-card-title" data-action="${isTablet()&&!mobile()?'select-paper':'open-paper'}" data-id="${p.id}">${escapeHtml(p.title)}</button><p class="paper-card-authors">${escapeHtml(p.authors)}</p><div class="paper-card-tags">${p.tags.map(t=>`<span class="tag">${t}</span>`).join('')}</div><div class="paper-card-bottom"><span>${p.cached?icon('download'):''} ${p.status}</span><button class="card-save" data-action="save-paper" data-id="${p.id}" aria-pressed="${p.saved}" aria-label="${escapeHtml(p.title)} ${p.saved?'저장 해제':'저장'}">${icon(p.saved?'check':'bookmark')} ${p.saved?'저장됨':'저장'}</button></div></article>`;}
function stateView(section='library'){
  if(state.status==='loading')return `<div role="status" class="sr-state" style="grid-column:1/-1"><span class="muted small">${section==='library'?'보관함':'논문'} 불러오는 중…</span></div>${Array.from({length:section==='library'?6:1},()=>`<article class="paper-card skeleton" aria-hidden="true"><div></div><div class="skeleton-big"></div><div></div><div></div></article>`).join('')}`;
  const error=state.status==='error';
  return `<div class="state-view" role="${error?'alert':'status'}">${icon(error?'warning':'library')}<h2>${error?'불러오지 못했어요':'아직 저장한 논문이 없어요'}</h2><p>${error?'이전에 저장한 논문과 메모는 그대로 보관됩니다.':'발견에서 논문을 저장하거나 PDF를 추가해 보세요.'}</p><button class="button primary" data-action="${error?'retry':'discover'}">${error?'다시 시도':'논문 발견하기'} ${icon('arrow')}</button>${error?'':`<button class="button plain" data-action="add-paper">PDF 추가</button>`}</div>`;
}
function filteredPapers(){
  const ids=state.folder?descendants(state.folder):null;
  let items=papers.filter(p=>(ids?p.saved&&p.folders.some(id=>ids.includes(id)):state.shelf==='saved'?p.saved:state.shelf==='recent'?p.percent>0:state.shelf==='offline'?p.cached:true)&&`${p.title} ${p.ko} ${p.authors} ${p.tags.join(' ')}`.toLowerCase().includes(state.query.toLowerCase()));
  if(state.sort==='title')items.sort((a,b)=>a.title.localeCompare(b.title));
  if(state.sort==='progress')items.sort((a,b)=>b.percent-a.percent);
  return items;
}
function attentionFigure(){return `<svg viewBox="0 0 360 210" role="img" aria-label="쿼리와 키의 내적을 정규화한 뒤 값에 가중합을 적용하는 어텐션 구조"><defs><marker id="arrowhead" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0 6 3 0 6" fill="currentColor"/></marker></defs><g fill="none" stroke="currentColor" stroke-width="1.4"><path d="M60 185v-25m120 25v-25m120 25v-60M60 125v-25h80m40 25v-25m0-25V50m0-25V10m0 115v20h65m55-20v20h-25" marker-end="url(#arrowhead)"/><rect x="32" y="125" width="56" height="35" rx="5"/><rect x="152" y="125" width="56" height="35" rx="5"/><rect x="272" y="90" width="56" height="35" rx="5"/><rect x="140" y="75" width="80" height="25" rx="5"/><rect x="140" y="25" width="80" height="25" rx="5"/><rect x="245" y="130" width="30" height="30" rx="5"/></g><g fill="currentColor" font-family="system-ui" font-size="10" text-anchor="middle"><text x="60" y="147">Linear</text><text x="180" y="147">Linear</text><text x="300" y="112">Linear</text><text x="180" y="92">QKᵀ / √dₖ</text><text x="180" y="42">Softmax</text><text x="260" y="150">×</text><text x="60" y="202">Query (Q)</text><text x="180" y="202">Key (K)</text><text x="300" y="202">Value (V)</text></g></svg>`;}
function detailPanel(){
  const p=papers.find(p=>p.id===state.selected)||papers[0];
  return `<aside class="detail-panel" aria-label="선택한 논문 상세"><div class="row between"><span class="pill">논문 상세</span><button class="icon-button" data-action="paper-menu" data-id="${p.id}" aria-label="선택한 논문 메뉴">${icon('dots')}</button></div><h2>${escapeHtml(p.title)}</h2><p class="muted">${escapeHtml(p.authors)}</p><span class="small muted">${p.source} · ${p.pages}쪽</span><div class="detail-figure">${attentionFigure()}</div><h3 class="abstract-label">${p.id==='attention'?'어텐션 기반의 새로운 구조':'함께 읽을 핵심 아이디어'}</h3><p>${p.id==='attention'?'순환과 합성곱을 사용하지 않고 어텐션만으로 시퀀스 변환을 수행합니다. 병렬 학습과 장거리 의존성 모델링을 함께 살펴볼 수 있는 기초 논문입니다.':'모델 구조와 학습 방법을 원문과 함께 살펴보세요. 저장한 논문에 메모를 남기고 관련 연구로 읽기를 이어갈 수 있습니다.'}</p><div class="paper-card-tags">${p.tags.map(t=>`<span class="tag">${t}</span>`).join('')}</div><dl class="detail-meta"><dt>읽은 위치</dt><dd>${p.page} / ${p.pages}쪽</dd><dt>번역</dt><dd>${p.status}</dd><dt>오프라인</dt><dd>${p.cached?'이 기기에 저장됨':'아직 저장하지 않음'}</dd></dl><button class="button primary" data-action="open-paper" data-id="${p.id}">${p.percent>0?'이어 읽기':'논문 읽기'} ${icon('arrow')}</button><button class="button plain" style="margin-top:10px" data-action="cache-paper" data-id="${p.id}">${icon('download')} ${p.cached?'오프라인 저장됨':'오프라인 저장'}</button></aside>`;
}
function library(){
  const name=state.folder?folders.find(f=>f.id===state.folder)?.name:state.shelf==='recent'?'최근 열어본':state.shelf==='offline'?'오프라인 저장':'저장한 논문';
  const list=filteredPapers();
  return `${topbar()}${banner()}<div class="library-layout"><main id="main" class="main-scroll"><div class="page-heading"><div><p class="eyebrow">나의 연구를 이어가는 곳</p><h1>${escapeHtml(name)}</h1><p>${state.shelf==='recent'&&!state.folder?'열어본 기록과 저장한 논문을 따로 관리하세요.':`${list.length}편의 논문 · 읽은 위치와 메모를 함께 보관해요.`}</p></div><button class="button primary" data-action="add-paper">${icon('plus')} 논문 추가</button></div>${state.status==='ready'||state.status==='offline'?`<div class="section-heading"><h2>이어서 읽기</h2><span class="small muted">최근 활동</span></div><section class="recent-grid" aria-label="이어서 읽기">${resumeCard(papers[0])}${resumeCard(papers[1])}</section>`:''}<div class="section-heading"><h2>${state.folder?'폴더의 논문':'나의 논문'}</h2><button style="display:none" class="button plain phone-folder-button" data-action="folders-sheet">${icon('folder')} 폴더</button><span class="small muted">${state.query?`“${escapeHtml(state.query)}” 검색`:'최근 추가한 순'}</span></div><div class="library-controls"><div class="segmented" role="group" aria-label="보관함 보기">${[['saved','저장한 논문'],['recent','최근 열어본'],['offline','오프라인']].map(([id,label])=>`<button data-action="shelf" data-value="${id}" aria-pressed="${!state.folder&&state.shelf===id}">${label}</button>`).join('')}</div><button class="button sort-button" data-action="sort-menu" aria-haspopup="listbox">${icon('sort')} ${state.sort==='title'?'제목순':state.sort==='progress'?'읽은 비율':'최근순'} ${icon('down')}</button><div class="segmented view-switch" role="group" aria-label="논문 표시 방식"><button data-action="grid" data-value="grid" aria-pressed="${state.grid}" aria-label="카드 보기">${icon('grid')}</button><button data-action="grid" data-value="list" aria-pressed="${!state.grid}" aria-label="목록 보기">${icon('list')}</button></div></div><section class="paper-grid ${state.grid?'':'list'}" aria-label="논문 목록">${['empty','loading','error'].includes(state.status)?stateView():list.length?list.map(paperCard).join(''):`<div class="state-view"><h2>일치하는 논문이 없어요</h2><p>다른 검색어를 입력하거나 폴더를 바꿔 보세요.</p><button class="button" data-action="clear-search">검색 초기화</button></div>`}</section></main>${isTablet()&&!mobile()?detailPanel():''}</div>`;
}

function documentPage(pane){
  const p=currentPaper();
  const ko=pane==='translation';
  const page=state.page;
  const title=page===1?(ko?p.ko:p.title):(ko?'3. 어텐션과 트랜스포머의 구조':'3. Model Architecture');
  const notes=state.notes.filter(n=>n.paper===p.id&&n.pane===pane&&n.page===page);
  const abstract=ko?'트랜스포머는 순환이나 합성곱 대신 어텐션을 기반으로 입력과 출력 사이의 전역적인 의존성을 표현합니다. 이 페이지에서는 쿼리, 키, 값이 어떤 역할을 하는지 살펴봅니다.':'This review page summarizes the Transformer architecture. Attention connects representations across a sequence. Queries identify information to retrieve, keys describe available information, and values supply the content of the weighted result.';
  return `<article class="document-page ${ko?'translation':''}" data-pane="${pane}" aria-label="${ko?'번역':'원문'} ${page}쪽"><div class="paper-running"><span>${ko?'한국어 번역 · 원문 3절':'ATTENTION IS ALL YOU NEED'}</span><span>NeurIPS 2017</span></div><h2>${escapeHtml(title)}</h2><p class="paper-authors">${ko?'Ashish Vaswani · Noam Shazeer · Niki Parmar 외':'Ashish Vaswani · Noam Shazeer · Niki Parmar et al.'}</p><p class="paper-abstract" data-block="intro">${abstract}</p><h3>${ko?'3.1 스케일 내적 어텐션':'3.1 Scaled Dot-Product Attention'}</h3><p data-block="attention">${ko?'어텐션은 하나의 <mark>쿼리와 여러 키–값 쌍을 입력받아 출력으로 매핑</mark>합니다. 출력은 값의 가중합이며, 각 가중치는 쿼리와 해당 키 사이의 적합도에 따라 결정됩니다.':'An attention function maps a query and a set of key–value pairs to an output. Each key describes an available item; the matching value holds its content. <mark>The output combines values according to their relevance to the query.</mark>'}</p><p data-block="scale">${ko?'쿼리와 키의 차원이 dₖ일 때, 내적 결과를 √dₖ로 나눈 뒤 softmax를 적용합니다. 이 스케일 조정은 차원이 커질수록 내적의 크기가 증가하여 기울기가 작아지는 현상을 완화합니다.':'For a key dimension dₖ, the query–key dot products are divided by √dₖ before softmax. This scaling moderates the magnitude of the scores and helps avoid very small gradients when the dimensionality grows.'}</p><div class="equation" data-block="equation">Attention(Q, K, V) = softmax(QKᵀ / √dₖ)V</div><figure class="paper-figure" data-block="figure">${attentionFigure()}<figcaption>${ko?'그림 1. 스케일 내적 어텐션의 흐름. 쿼리와 키로 구한 가중치를 값에 적용합니다.':'Figure 1. A simplified attention flow, redrawn for this review. Scores from queries and keys determine the weighted combination of values.'}</figcaption></figure><h3>${ko?'3.2 여러 관점으로 읽는 멀티 헤드 어텐션':'3.2 Multi-Head Attention'}</h3><p data-block="multi">${ko?'여러 어텐션 헤드는 서로 다른 표현 부분공간에서 정보를 모읍니다. 각 헤드의 출력을 연결한 뒤 한 번 더 선형 변환하여 다음 층에 전달합니다. 한 위치에서 여러 관계를 함께 살펴볼 수 있습니다.':'Multiple heads work in different representation subspaces. Their outputs are concatenated and projected into the next layer. This lets a position incorporate several types of relationship instead of relying on a single attention pattern.'}</p><h3>${ko?'읽으면서 생각해 볼 질문':'A question to carry forward'}</h3><p data-block="ending">${ko?'어텐션이 순환 구조를 대신한다면 토큰 순서는 어디에서 전달될까요? 다음 절의 위치 인코딩을 함께 읽으며, 병렬화와 문맥 표현의 관계를 확인해 보세요.':'If attention replaces recurrence, where does sequence order enter the model? Continue to positional encoding and consider how order information interacts with parallel computation.'}</p><span class="page-footer">${page}</span><svg class="ink-canvas" viewBox="0 0 600 1000" preserveAspectRatio="none" data-pane="${pane}" aria-label="${ko?'번역':'원문'} 필기 영역">${(state.strokes[pane]||[]).map(s=>`<path d="${s.d}" style="stroke:${s.color};stroke-width:${s.width};opacity:${s.opacity}"/>`).join('')}</svg>${notes.map(n=>`<aside class="sticky ${n.collapsed?'collapsed':''}" data-note="${n.id}" style="left:${n.x}%;top:${n.y}%" aria-label="${ko?'번역':'원문'} ${page}쪽 메모"><div class="sticky-head"><button class="drag-handle" data-action="drag-note" aria-label="메모 이동, 방향키로 위치 조정" data-id="${n.id}">${icon('pin')} 메모</button><button class="icon-button" data-action="collapse-note" data-id="${n.id}" aria-label="메모 ${n.collapsed?'펼치기':'접기'}">${icon(n.collapsed?'plus':'minus')}</button></div><textarea aria-label="메모 내용" data-note-text="${n.id}">${escapeHtml(n.text)}</textarea></aside>`).join('')}</article>`;
}
function paneContent(pane){
  if(state.status==='loading')return `<div class="pane-empty" role="status"><h2>페이지를 불러오는 중…</h2><p>저장한 논문을 준비하고 있어요.</p><div class="skeleton"><div></div><div></div><div></div></div></div>`;
  if(state.status==='error')return `<div class="pane-empty" role="alert">${icon('warning')}<h2>페이지를 열지 못했어요</h2><p>읽은 위치와 메모는 보관됩니다.</p><button class="button primary" data-action="retry">다시 시도</button></div>`;
  if(state.status==='empty'&&pane==='translation')return `<div class="pane-empty">${icon('text')}<h2>이 페이지의 번역이 없어요</h2><p>원문을 계속 읽거나 한국어 번역을 시작하세요.</p><button class="button primary" data-action="translate">번역 시작</button></div>`;
  if(state.status==='offline'&&!currentPaper().cached)return `<div class="pane-empty">${icon('offline')}<h2>오프라인 저장이 필요해요</h2><p>PC에 다시 연결하면 이 논문을 열 수 있어요.</p><button class="button" data-action="retry">다시 연결</button></div>`;
  return documentPage(pane);
}
function readerPane(pane){
  const ko=pane==='translation';
  const active=compact()?state.compactPane===pane:state.mode==='split'||state.mode===pane;
  return `<section class="reader-pane ${active?'':'inactive'}" ${!compact()&&!active?'style="display:none"':''} aria-label="${ko?'번역':'원문'} 보기"><div class="pane-label"><strong>${ko?'한국어 번역':'원문 PDF'}</strong>${ko?`<button data-action="language-menu" aria-haspopup="listbox">${state.target} ${icon('down')}</button>`:`<span>${state.tool==='text'?'텍스트 선택':'필기'} · ${state.page}쪽</span>`}</div><div class="document-scroll" data-scroll-pane="${pane}" tabindex="0" aria-label="${ko?'번역':'원문'} 페이지 스크롤">${paneContent(pane)}</div></section>`;
}
function penRail(){return `<div class="pen-rail" role="toolbar" aria-label="필기 및 선택 도구">${[['pen','볼펜'],['highlighter','형광펜'],['text','텍스트 선택'],['eraser','지우개']].map(([t,label])=>`<button data-action="tool" data-value="${t}" aria-pressed="${state.tool===t}" aria-label="${label}" title="${label}">${icon(t)}</button>`).join('')}<hr><button data-action="ink-options" aria-label="펜 색과 굵기" title="펜 색과 굵기"><span class="color-swatch"></span></button><button data-action="new-note" aria-label="현재 페이지에 메모 추가" title="메모 추가">${icon('note')}</button><hr><button data-action="undo" aria-label="필기 실행 취소" title="실행 취소">${icon('undo')}</button><button data-action="redo" aria-label="필기 다시 실행" title="다시 실행">${icon('redo')}</button></div>`;}
function reader(){
  const p=currentPaper();
  return `<header class="reader-header">${iconButton('left','보관함으로 돌아가기','reader-back')}<div class="grow"><h1 title="${escapeHtml(p.title)}">${escapeHtml(p.title)}</h1><div class="title-meta"><span>${p.source}</span><span>·</span><span>${state.status==='offline'?'오프라인 저장':'읽은 위치 저장됨'}</span></div></div><button class="button plain reader-save" data-action="save-paper" data-id="${p.id}" aria-pressed="${p.saved}">${icon(p.saved?'check':'bookmark')} ${p.saved?'저장됨':'논문 저장'}</button><button class="icon-button reader-export" data-action="export-menu" aria-label="논문 내보내기">${icon('export')}</button>${iconButton('dots','리더 더 보기','reader-menu')}</header>${banner()}<div class="reader-toolbar" aria-label="읽기 도구"><div class="page-control">${iconButton('left','이전 페이지','prev-page')}<input id="page-number" type="number" min="1" max="${p.pages}" value="${state.page}" aria-label="페이지 번호"><span>/ ${p.pages}</span>${iconButton('chevron','다음 페이지','next-page')}</div><div class="divider"></div><div class="row zoom-controls" style="gap:5px">${iconButton('minus','축소','zoom-out')}<button class="button plain" data-action="zoom-menu" aria-haspopup="listbox">${state.zoom}% ${icon('down')}</button>${iconButton('plus','확대','zoom-in')}</div><div class="divider"></div><button class="button plain provider-select" data-action="model-menu" aria-haspopup="listbox">${state.model} ${icon('down')}</button><button class="button translate-button" data-action="translate">${icon('text')} ${state.translationPaused?'번역 재개':'번역 완료'}</button><div class="segmented" role="group" aria-label="읽기 보기">${[['source','원문'],['split','나란히'],['translation','번역']].map(([m,label])=>`<button class="${m==='split'?'split-toggle':''}" data-action="mode" data-value="${m}" aria-pressed="${compact()?m===state.compactPane:m===state.mode}">${label}</button>`).join('')}</div><button class="button plain" data-action="linked" aria-label="연결 스크롤 ${state.linked?'끄기':'켜기'}" aria-pressed="${state.linked}">${icon('link')}</button><button class="button panel-open ${state.panel?'primary':''}" data-action="panel-toggle">${icon('chat')} 연구 노트</button></div><main id="main" class="reader-body tool-${state.tool}">${penRail()}<div class="reader-canvases">${readerPane('source')}${readerPane('translation')}</div>${state.panel?readerPanel():''}</main>`;
}
function panelQuestions(){return `<div class="row between"><span class="small muted">${state.history.length+Number(state.activeAnswer)}개의 질문</span><button class="button plain" style="font-size:11px;padding:4px 6px;min-height:32px" data-action="new-question">${icon('plus')} 새 질문</button></div>${state.activeAnswer?`<div class="answer-question">${escapeHtml(state.activeQuestion)}</div><div class="answer-label"><img src="mark.svg" alt=""><span>Fractal · 논문에 근거한 답변</span></div><div class="answer"><p>어텐션은 각 단어가 다른 단어와 어떤 관계를 맺는지 직접 비교합니다. 순서대로 상태를 전달하는 대신, 문장 전체의 표현을 함께 살펴볼 수 있어요.<button class="citation" data-action="citation" data-page="3">p.3</button></p><ul><li><strong>문맥은 어텐션으로.</strong> 쿼리와 키의 적합도로 가중치를 정하고, 값의 가중합으로 필요한 정보를 모읍니다.</li><li><strong>순서는 위치 인코딩으로.</strong> 토큰의 순서 정보는 입력 표현에 더해집니다.<button class="citation" data-action="citation" data-page="5">p.5</button></li><li><strong>계산은 병렬로.</strong> 순환 계산 없이 여러 위치의 표현을 동시에 처리할 수 있습니다.</li></ul><p class="muted small">인용된 페이지에서 원문의 근거를 확인하세요.</p></div>`:`<div class="pane-empty" style="padding:40px 0"><h2>다음 질문을 시작하세요</h2><p>이전 질문은 기록에 보관했어요.</p></div>`}`;}
function panelNotes(){
  const notes=state.notes.filter(n=>n.paper===state.paper);
  return `<div class="row between"><span class="small muted">${notes.length}개의 메모</span><button class="button plain" style="font-size:11px" data-action="new-note">${icon('plus')} 메모</button></div><div class="note-list-item"><button data-action="citation" data-page="3">원문 · p.3</button><blockquote>The output combines values according to their relevance to the query.</blockquote><p class="muted">노란색으로 표시한 문장</p></div>${notes.map(n=>`<article class="note-list-item"><div class="row between"><button data-action="jump-note" data-id="${n.id}">${n.pane==='source'?'원문':'번역'} · p.${n.page}</button><span class="pill">위치 메모</span></div><p style="margin-top:10px">${escapeHtml(n.text)}</p><button data-action="jump-note" data-id="${n.id}" style="margin-top:8px">메모 위치로 이동 ${icon('arrow')}</button></article>`).join('')}${!notes.length?'<p class="muted" style="margin:24px 0">표시하거나 메모한 내용이 여기에 모여요.</p>':''}`;
}
function panelHistory(){
  const items=state.history.filter(h=>state.historyFilter==='all'||(h.kind||'question')===state.historyFilter);
  return `<div class="small muted" style="margin-bottom:14px">새 질문을 시작하면 이전 대화를 여기에 보관해요.</div><div class="segmented history-filter" role="group" aria-label="기록 종류">${[['all','전체'],['question','일반 질문'],['explanation','설명']].map(([v,l])=>`<button data-action="history-filter" data-value="${v}" aria-pressed="${state.historyFilter===v}">${l}</button>`).join('')}</div>${items.map(h=>`<button class="history-item" data-action="history-open" data-id="${h.id}"><small>${escapeHtml(h.date)} · ${h.kind==='explanation'?'선택 설명':'일반 질문'}</small><strong>${escapeHtml(h.title)}</strong><small>답변 1개 · p.${h.page} ${icon('chevron')}</small></button>${state.historySelection===h.id?`<div class="history-detail">${h.context?`<blockquote>${escapeHtml(h.context.text)}</blockquote>`:''}${escapeHtml(h.answer)} <button class="citation" data-action="citation" data-page="${h.page}">p.${h.page}</button></div>`:''}`).join('')}${!items.length?'<p class="muted" style="margin-top:20px">이 종류의 기록이 아직 없어요.</p>':''}`;
}
function panelRelated(){return `<p class="muted small" style="margin-bottom:18px">지금 읽는 논문에서 다음 연구로</p>${['비슷한 논문','이 논문을 인용한 연구','참고 문헌'].map((label,i)=>`<h3 class="related-heading">${label}</h3><article class="related-item"><span class="small muted">${['어텐션 · 효율적 계산','사전 학습 · 언어 이해','검색 · 지식 활용'][i]}</span><button class="related-title" data-action="open-paper" data-id="${['flash','bert','rag'][i]}"><h3>${escapeHtml(papers.find(p=>p.id===['flash','bert','rag'][i]).title)}</h3></button><p>${papers.find(p=>p.id===['flash','bert','rag'][i]).source}</p><button class="button" data-action="save-paper" data-id="${['flash','bert','rag'][i]}">${icon('bookmark')} ${papers.find(p=>p.id===['flash','bert','rag'][i]).saved?'저장됨':'보관함에 저장'}</button></article>`).join('')}<span class="small muted">관련 연구 예시 · 실제 관계는 서비스 결과에 따라 달라져요.</span>`;}
function readerPanel(){
  const labels={notes:'노트',questions:'질문',history:'기록',related:'관련'};
  return `<aside class="reader-panel" aria-label="연구 노트"><header class="panel-head"><h2>연구 노트</h2>${iconButton('close','연구 노트 닫기, 내용은 보관됩니다','panel-close')}</header><div class="panel-tabs" role="tablist" aria-label="연구 노트 보기">${Object.entries(labels).map(([id,label])=>`<button role="tab" id="tab-${id}" aria-controls="panel-${id}" aria-selected="${state.panelTab===id}" tabindex="${state.panelTab===id?0:-1}" data-action="panel-tab" data-value="${id}">${label}${id==='notes'?` <span class="small">${state.notes.filter(n=>n.paper===state.paper).length}</span>`:''}</button>`).join('')}</div><div class="panel-content" role="tabpanel" id="panel-${state.panelTab}" aria-labelledby="tab-${state.panelTab}">${({questions:panelQuestions,notes:panelNotes,history:panelHistory,related:panelRelated})[state.panelTab]()}</div>${state.panelTab==='questions'?`<form class="panel-composer" id="question-form"><div class="row between"><span class="small muted">답변 설정</span><button type="button" class="button plain" data-action="model-menu">${state.model} ${icon('down')}</button></div><textarea id="question-draft" aria-label="논문에 질문하기" placeholder="논문에 대해 무엇이 궁금한가요?" ${state.status==='offline'?'disabled':''}>${escapeHtml(state.draft)}</textarea><div class="row between"><button type="button" class="button plain" data-action="language-menu">${state.target} ${icon('down')}</button><button class="button primary" type="submit" ${state.status==='offline'?'disabled':''}>질문 보내기 ${icon('arrow')}</button></div><div class="composer-hint">${state.status==='offline'?'PC 연결 후 질문할 수 있어요. 작성한 내용은 보관됩니다.':'새 질문은 이전 답변을 기록에 보관합니다.'}</div></form>`:''}</aside>`;
}
function topicChips(){return `<div class="topic-chips" role="group" aria-label="관심 분야 필터">${['전체','언어 모델','컴퓨터 비전','검색 증강 생성'].map(t=>`<button data-action="topic-filter" data-value="${t}" aria-pressed="${state.topic===t}">${t}</button>`).join('')}<button data-action="topics">${icon('plus')} 주제 관리</button></div>`;}
function discovery(){return `${topbar()}${banner()}<main id="main" class="main-scroll"><div class="page-heading"><div><p class="eyebrow">10월 1일 목요일</p><h1>오늘, 더 깊이 읽기</h1><p>팔로우한 주제와 읽은 논문에서 다음 연구를 찾아보세요.</p></div><button class="button" data-action="refresh-feed">${icon('clock')} 새로고침</button></div>${topicChips()}<section class="discovery-hero"><div><span class="pill">${state.topic==='전체'?'내 보관함에서 이어지는 연구':state.topic+'에서 읽을 연구'}</span><h2>더 빠른 어텐션,<br>더 긴 문맥을 읽는 방법</h2><p>Attention Is All You Need를 읽었다면, 계산 비용과 메모리 사용을 줄이는 후속 연구를 함께 살펴보세요.</p><button class="button primary" data-action="open-paper" data-id="flash">추천 논문 읽기 ${icon('arrow')}</button></div><div class="discovery-illustration">${attentionFigure()}</div></section><div class="section-heading"><h2>${state.topic==='전체'?'관심 주제에서 발견한 논문':state.topic+' 논문'}</h2><span class="small muted">arXiv · Hugging Face</span></div><section class="paper-grid">${['empty','loading','error'].includes(state.status)?stateView():papers.filter(p=>state.topic==='컴퓨터 비전'?['clip','diffusion'].includes(p.id):state.topic==='검색 증강 생성'?p.id==='rag':['flash','lora','bert'].includes(p.id)).map(paperCard).join('')}</section><div class="section-heading"><h2>오늘의 분야 뉴스</h2><button class="button plain" data-action="news">모두 보기 ${icon('arrow')}</button></div>${newsCards()}</main>`;}
function newsCards(){return `<section class="news-list" aria-label="분야 뉴스"><article class="news-card"><span class="source-label">연구 동향 · 언어 모델</span><h3>${state.newsTranslated?'긴 문맥 평가에서 정확한 인용이 중요한 이유':'Why grounded citations matter in long-context evaluation'}</h3><p>긴 문서를 읽는 모델의 답변을 평가할 때, 정답뿐 아니라 근거를 찾아가는 과정을 함께 살펴봅니다.</p><div class="row between"><span class="small muted">뉴스 예시 · 오늘</span><button class="button plain" data-action="news-translate">${icon('text')} ${state.newsTranslated?'원제 보기':'제목 번역'}</button></div><button class="button plain" data-action="news-read">기사 읽기 ${icon('arrow')}</button></article><article class="news-card"><span class="source-label">이번 주 읽을거리 · 검색 증강 생성</span><h3>검색에서 답변까지: 연구자가 살펴볼 RAG 평가의 네 가지 관점</h3><p>검색 품질, 근거 충실도, 최신성, 답변 유용성으로 연구 흐름을 정리합니다.</p><div class="row between"><span class="small muted">뉴스 예시 · 어제</span><button class="button plain" data-action="news-read">기사 읽기 ${icon('arrow')}</button></div></article></section>`;}
function news(){return `${topbar()}${banner()}<main id="main" class="main-scroll"><div class="page-heading"><div><p class="eyebrow">내 주제의 흐름을 한곳에서</p><h1>분야 뉴스</h1><p>논문과 함께 읽을 연구 동향과 소식을 모았어요.</p></div></div>${topicChips()}${['empty','loading','error'].includes(state.status)?`<section class="paper-grid">${stateView()}</section>`:newsCards()}</main>`;}
function topics(){return `${topbar()}${banner()}<main id="main" class="main-scroll"><div class="page-heading"><div><p class="eyebrow">나만의 발견 기준</p><h1>관심 주제</h1><p>팔로우한 분야의 논문과 뉴스를 발견에서 모아볼 수 있어요.</p></div><button class="button primary" data-action="topic-add">${icon('plus')} 주제 추가</button></div>${['언어 모델','컴퓨터 비전','검색 증강 생성'].map((t,i)=>`<article class="topic-row"><span class="topic-icon">${icon('topic')}</span><div class="grow"><h3>${t}</h3><p>${['cs.CL · 트랜스포머, 긴 문맥','cs.CV · 멀티모달, 생성 모델','개인 주제 · 검색, 근거 추적'][i]}</p></div><button class="button" data-action="topic-follow" aria-pressed="true">${icon('check')} 팔로우 중</button></article>`).join('')}</main>`;}

function render(){
  document.documentElement.dataset.theme=state.theme;
  renderReview();
  $('#app').innerHTML=`<div class="workspace ${isTablet()?'tablet':''} ${state.screen==='reader'?'reader':''}">${sidebar()}<div class="main-shell">${({library,reader,discover:discovery,news,topics})[state.screen]()}${mobileNav()}</div></div>`;
  if(state.screen==='reader')bindReader();
}
function savePositions(){
  $$('[data-scroll-pane]').forEach(el=>{if(el.clientHeight)state.positions[el.dataset.scrollPane]=el.scrollTop/(el.scrollHeight-el.clientHeight||1);});
  if($('#question-draft'))state.draft=$('#question-draft').value;
  rememberSession();
}
function renderReader(){savePositions();render();}
function updateUrl(){
  const q=new URLSearchParams({view:state.view,screen:state.screen,theme:state.theme,state:state.status});
  if(document.body.classList.contains('hide-review'))q.set('chrome','hide');
  history.replaceState(null,'',`${location.pathname}?${q}`);
}
function toast(message){clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').classList.add('show');toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),2600);}
function closeOverlay(restore=true){
  const old=popoverTrigger||dialogTrigger;
  $('#overlay').innerHTML='';
  if(old)old.setAttribute('aria-expanded','false');
  popoverTrigger=null;dialogTrigger=null;
  if(restore&&old&&old.isConnected)old.focus({preventScroll:true});
}
function menu(trigger, title, items, options={}){
  closeOverlay(false);popoverTrigger=trigger;
  trigger.setAttribute('aria-expanded','true');
  const role=options.list?'listbox':'menu';
  const rect=trigger.getBoundingClientRect();
  $('#overlay').innerHTML=`<div class="popover" role="${role}" aria-label="${title}" tabindex="-1"><div class="popover-title">${title}</div>${items.map(item=>item===null?'<hr>':`<button role="${options.list?'option':'menuitem'}" ${options.list?`aria-selected="${!!item.selected}"`:''} data-action="${item.action}" ${item.value!==undefined?`data-value="${escapeHtml(item.value)}"`:''} ${item.id?`data-id="${item.id}"`:''} ${item.selected?'class="selected"':''}><span>${item.label}${item.hint?`<small>${item.hint}</small>`:''}</span>${item.selected?'<span class="check-mark">✓</span>':''}</button>`).join('')}</div>`;
  const el=$('.popover');
  el.style.left=Math.max(12,Math.min(rect.left,innerWidth-el.offsetWidth-12))+'px';
  el.style.top=(rect.bottom+8+el.offsetHeight>innerHeight?Math.max(12,rect.top-el.offsetHeight-8):rect.bottom+8)+'px';
  const focus=el.querySelector('[aria-selected=true]')||el.querySelector('button');
  focus?.focus();
}
function dialog(title,content,actions,trigger=document.activeElement){
  closeOverlay(false);dialogTrigger=trigger;
  $('#overlay').innerHTML=`<div class="scrim"><section class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><h2 id="dialog-title">${title}</h2>${content}<div class="dialog-actions">${actions}</div></section></div>`;
  setTimeout(()=>($('.dialog input')||$('.dialog button'))?.focus(),0);
}
function simpleDialog(title,message){dialog(title,`<p>${message}</p>`,`<button class="button primary" data-action="overlay-close">확인</button>`);}
function archiveQuestion(){
  if(!state.activeAnswer)return;
  state.history.unshift({id:Date.now(),title:state.activeQuestion,date:'오늘 · 방금',kind:state.activeKind,context:state.activeContext,answer:state.activeKind==='explanation'?'그림은 쿼리와 키에서 점수를 계산하고, 정규화한 점수를 값에 적용하는 흐름을 보여줍니다.':'어텐션은 단어 사이의 관계를 직접 비교합니다. 쿼리와 키로 계산한 가중치를 값에 적용하며, 순서는 위치 인코딩으로 전달됩니다.',page:state.page});
  state.activeAnswer=false;
}
function openPaper(id){
  savePositions();state.returnScreen=state.screen==='reader'?state.returnScreen:state.screen;
  if(state.paper!==id){state.paper=id;state.page=papers.find(p=>p.id===id).page;Object.assign(state,state.sessions[id]||{positions:{source:0,translation:0},activeAnswer:false,activeQuestion:'',activeContext:null,activeKind:'question',history:[],draft:'',strokes:{source:[],translation:[]},redo:{source:[],translation:[]}});}
  state.screen='reader';state.panel=!isTablet()&&!mobile();render();updateUrl();
}
function goPage(page){state.page=Math.max(1,Math.min(currentPaper().pages,Number(page)||1));currentPaper().page=state.page;currentPaper().percent=Math.round(state.page/currentPaper().pages*100);state.positions={source:0,translation:0};render();}

function bindReader(){
  $$('[data-scroll-pane]').forEach(el=>{
    el.scrollTop=state.positions[el.dataset.scrollPane]*(el.scrollHeight-el.clientHeight);
    el.addEventListener('scroll',()=>{
      if(scrollSyncing)return;
      const ratio=el.scrollTop/(el.scrollHeight-el.clientHeight||1);
      state.positions[el.dataset.scrollPane]=ratio;
      if(state.linked){state.positions[el.dataset.scrollPane==='source'?'translation':'source']=ratio;
        const other=$(`[data-scroll-pane="${el.dataset.scrollPane==='source'?'translation':'source'}"]`);
        if(other&&other.clientHeight){scrollSyncing=true;other.scrollTop=ratio*(other.scrollHeight-other.clientHeight);requestAnimationFrame(()=>{scrollSyncing=false;});}
      }
    },{passive:true});
  });
  $$('.document-page').forEach(el=>{el.style.zoom=state.zoom/100;});
  $$('[data-action=drag-note]').forEach(handle=>{
    handle.addEventListener('pointerdown',e=>{
      if(e.button!==0)return;
      e.preventDefault();const n=state.notes.find(n=>n.id===handle.dataset.id);const note=handle.closest('.sticky');const page=handle.closest('.document-page');const rect=page.getBoundingClientRect();
      const start={x:e.clientX,y:e.clientY,left:n.x,top:n.y};handle.setPointerCapture(e.pointerId);
      const move=ev=>{n.x=Math.max(0,Math.min(100-note.offsetWidth/rect.width*100,start.left+(ev.clientX-start.x)/rect.width*100));n.y=Math.max(0,Math.min(95,start.top+(ev.clientY-start.y)/rect.height*100));note.style.left=n.x+'%';note.style.top=n.y+'%';};
      const stop=()=>{persist();handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',stop);};handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',stop);
    });
    handle.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();const n=state.notes.find(n=>n.id===handle.dataset.id);n.x=Math.min(65,Math.max(0,n.x+(e.key==='ArrowLeft'?-1:e.key==='ArrowRight'?1:0)));n.y=Math.min(90,Math.max(0,n.y+(e.key==='ArrowUp'?-1:e.key==='ArrowDown'?1:0)));handle.closest('.sticky').style.left=n.x+'%';handle.closest('.sticky').style.top=n.y+'%';});
  });
  $$('.ink-canvas').forEach(canvas=>canvas.addEventListener('pointerdown',e=>{
    if(e.pointerType==='touch'||state.tool==='text')return;
    const pane=canvas.dataset.pane;state.annotationPane=pane;
    if(state.tool==='eraser'){state.redo[pane].push(...state.strokes[pane].slice(-1));state.strokes[pane].pop();renderReader();return;}
    e.preventDefault();canvas.setPointerCapture(e.pointerId);const rect=canvas.getBoundingClientRect();
    const point=ev=>`${((ev.clientX-rect.left)/rect.width*600).toFixed(1)} ${((ev.clientY-rect.top)/rect.height*1000).toFixed(1)}`;
    const stroke={d:'M'+point(e),color:state.tool==='highlighter'?'#d2b832':'var(--accent)',width:state.tool==='highlighter'?15:3,opacity:state.tool==='highlighter'?.45:1};
    const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',stroke.d);path.style.stroke=stroke.color;path.style.strokeWidth=stroke.width;path.style.opacity=stroke.opacity;canvas.append(path);
    const move=ev=>{stroke.d+=' L'+point(ev);path.setAttribute('d',stroke.d);};
    const stop=()=>{state.strokes[pane].push(stroke);state.redo[pane]=[];persist();canvas.removeEventListener('pointermove',move);canvas.removeEventListener('pointerup',stop);};canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerup',stop);
  }));
  if(state.tool==='text')$$('.document-page').forEach(page=>page.addEventListener('mouseup',()=>{
    const selection=window.getSelection();
    if(selection&&selection.toString().trim().length>2){const r=selection.getRangeAt(0).getBoundingClientRect();state.annotationPane=page.dataset.pane;selectedContext={text:selection.toString().trim(),pane:page.dataset.pane,page:state.page,kind:'text'};menu({getBoundingClientRect:()=>r,setAttribute:()=>{},focus:()=>{},isConnected:false},'선택한 문장',[{label:'하이라이트',action:'selection-highlight'},{label:'메모',action:'selection-note'},{label:'질문',action:'selection-question'},{label:'복사',action:'selection-copy'}]);}
  }));
}

document.addEventListener('input',e=>{
  if(e.target.id==='library-search'){state.query=e.target.value;const selection=e.target.selectionStart;const open=e.target.closest('.search-box').classList.contains('search-open');render();if(open)$('.search-box').classList.add('search-open');$('#library-search').focus();$('#library-search').setSelectionRange(selection,selection);}
  if(e.target.id==='question-draft')state.draft=e.target.value;
  if(e.target.dataset.noteText){const n=state.notes.find(n=>n.id===e.target.dataset.noteText);if(n)n.text=e.target.value;}
  persist();
});
document.addEventListener('change',e=>{if(e.target.id==='page-number')goPage(e.target.value);});
document.addEventListener('submit',e=>{
  if(e.target.id!=='question-form')return;e.preventDefault();const q=state.draft.trim();if(!q){$('#question-draft').focus();return;}archiveQuestion();state.activeQuestion=q;state.activeAnswer=true;state.activeKind=selectedContext?'explanation':'question';state.activeContext=selectedContext;selectedContext=null;state.draft='';render();persist();toast('이전 질문을 기록에 보관했어요.');
});
document.addEventListener('pointerdown',e=>{if($('.popover')&&!e.target.closest('.popover')&&!e.target.closest('[aria-expanded=true]'))closeOverlay(false);});
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-action]');if(!b)return;const a=b.dataset.action;const value=b.dataset.value;const id=b.dataset.id;
  queueMicrotask(()=>{rememberSession();persist();});
  const inOverlay=!!b.closest('#overlay');
  if(inOverlay&&!['drag-note'].includes(a))closeOverlay(false);
  if(a==='preset'){
    savePositions();state.view=value;state.screen=value.includes('reader')?'reader':'library';state.panel=value==='desktop-reader';state.mode='split';state.compactPane='source';state.query='';state.folder=null;state.shelf='saved';render();updateUrl();return;
  }
  if(['library','discover','news','topics'].includes(a)){savePositions();state.screen=a;render();updateUrl();return;}
  if(a==='theme-menu'){menu(b,'보기 테마',['light','dark','sepia'].map((v,i)=>({label:['라이트','다크','세피아'][i],action:'theme',value:v,selected:state.theme===v})),{list:true});return;}
  if(a==='theme'){savePositions();state.theme=value;render();updateUrl();return;}
  if(a==='state-menu'){menu(b,'검토할 화면 상태',Object.entries({ready:'기본 화면',empty:'빈 화면 / 번역 없음',loading:'불러오는 중',error:'불러오기 오류',offline:'오프라인'}).map(([v,label])=>({label,action:'state',value:v,selected:state.status===v})),{list:true});return;}
  if(a==='state'){savePositions();state.status=value;render();updateUrl();return;}
  if(a==='retry'){state.status='ready';render();updateUrl();toast('연결과 페이지를 다시 불러왔어요.');return;}
  if(a.startsWith('shelf-')||a==='shelf'){state.shelf=a==='shelf'?value:a.slice(6);state.screen='library';state.folder=null;render();return;}
  if(a==='folder-toggle'){folders.find(f=>f.id===id).open=!folders.find(f=>f.id===id).open;render();return;}
  if(a==='folder-select'){state.folder=id;state.screen='library';render();return;}
  if(a==='folder-menu'){menu(b,'폴더 관리',[{label:'하위 폴더 추가',action:'folder-create',id},{label:'이름 바꾸기',action:'folder-rename',id},{label:'폴더 이동',action:'folder-move',id},null,{label:'폴더 제거',hint:'논문은 보관하고 하위 폴더는 상위로 이동',action:'folder-remove',id}]);return;}
  if(a==='folder-create'||a==='folder-rename'){dialog(a==='folder-create'?'새 폴더':'폴더 이름 바꾸기',`<label for="folder-name">이름</label><input id="folder-name" maxlength="60" value="${a==='folder-rename'?escapeHtml(folders.find(f=>f.id===id).name):''}" placeholder="폴더 이름"><input id="folder-parent" type="hidden" value="${id||''}">`,`<button class="button" data-action="overlay-close">취소</button><button class="button primary" data-action="${a==='folder-create'?'folder-save-new':'folder-save-name'}" ${id?`data-id="${id}"`:''}>${a==='folder-create'?'만들기':'저장'}</button>`,b);return;}
  // Read dialog values before closing through the generic overlay route (see cached input below).
  if(a==='folder-save-new'||a==='folder-save-name'){
    const name=overlayValues['folder-name']?.trim();if(!name){toast('폴더 이름을 입력해 주세요.');return;}
    if(a==='folder-save-name')folders.find(f=>f.id===id).name=name;else{const parent=overlayValues['folder-parent']||null;folders.push({id:'folder-'+Date.now(),name,parent,open:false});if(parent)folders.find(f=>f.id===parent).open=true;}
    render();toast('폴더를 저장했어요.');return;
  }
  if(a==='folder-remove'){const f=folders.find(f=>f.id===id);dialog('“'+escapeHtml(f.name)+'” 폴더를 제거할까요?',`<p>논문은 보관함에 그대로 남습니다. ${folders.filter(f=>f.parent===id).length}개의 하위 폴더는 ${f.parent?'상위 폴더':'보관함 최상위'}로 이동합니다.</p>`,`<button class="button" data-action="overlay-close">취소</button><button class="button danger" data-action="folder-confirm-remove" data-id="${id}">폴더 제거</button>`,b);return;}
  if(a==='folder-confirm-remove'){const f=folders.find(f=>f.id===id);folders.filter(c=>c.parent===id).forEach(c=>c.parent=f.parent);papers.forEach(p=>{p.folders=p.folders.filter(fid=>fid!==id);if(p.folder===id)p.folder=f.parent;});folders.splice(folders.indexOf(f),1);state.folder=null;render();toast('폴더를 제거했어요. 논문과 하위 폴더는 보관됩니다.');return;}
  if(a==='folder-move'){const f=folders.find(f=>f.id===id);const forbidden=descendants(id);menu(b,'이동할 상위 폴더',[{label:'보관함 최상위',action:'folder-move-to',id,value:'root'},...folders.filter(t=>!forbidden.includes(t.id)).map(t=>({label:t.name,action:'folder-move-to',id,value:t.id}))]);return;}
  if(a==='folder-move-to'){folders.find(f=>f.id===id).parent=value==='root'?null:value;render();toast('폴더를 이동했어요.');return;}
  if(a==='folders-sheet'){dialog('폴더',`<div class="command-list"><button data-action="folder-create">${icon('plus')} 새 폴더</button>${folders.map(f=>`<button data-action="folder-select" data-id="${f.id}">${icon('folder')} ${f.parent?'↳ ':''}${escapeHtml(f.name)} <span class="count">${papers.filter(p=>descendants(f.id).includes(p.folder)).length}</span><span data-action="folder-menu" data-id="${f.id}" role="button" tabindex="0" aria-label="${escapeHtml(f.name)} 폴더 메뉴">${icon('dots')}</span></button>`).join('')}</div>`,`<button class="button" data-action="overlay-close">닫기</button>`,b);return;}
  if(a==='sort-menu'){menu(b,'논문 정렬',[{label:'최근 추가한 순',value:'recent'},{label:'제목순',value:'title'},{label:'읽은 비율순',value:'progress'}].map(i=>({...i,action:'sort',selected:state.sort===i.value})),{list:true});return;}
  if(a==='sort'){state.sort=value;render();return;}
  if(a==='grid'){state.grid=value==='grid';render();return;}
  if(a==='clear-search'){state.query='';render();return;}
  if(a==='search-mobile'){$('.search-box').classList.toggle('search-open');$('#library-search').focus();return;}
  if(a==='open-paper'){openPaper(id);return;}
  if(a==='select-paper'){state.selected=id;render();return;}
  if(a==='save-paper'){const p=papers.find(p=>p.id===id);p.saved=!p.saved;if(p.saved&&state.folder&&!p.folders.includes(state.folder))p.folders.push(state.folder);savePositions();render();toast(p.saved?'보관함에 저장했어요.':'저장을 해제했어요. 최근 열어본 기록은 남습니다.');return;}
  if(a==='cache-paper'){const p=papers.find(p=>p.id===id);p.cached=!p.cached;render();toast(p.cached?'이 기기에서 오프라인으로 읽을 수 있어요.':'이 기기의 오프라인 저장을 해제했어요.');return;}
  if(a==='paper-menu'){const p=papers.find(p=>p.id===id);menu(b,'논문 관리',[{label:'논문 읽기',action:'open-paper',id},{label:p.saved?'저장 해제':'보관함에 저장',action:'save-paper',id},{label:p.cached?'오프라인 저장 해제':'오프라인 저장',action:'cache-paper',id},{label:'폴더로 이동',action:'paper-move',id}]);return;}
  if(a==='paper-move'){const p=papers.find(p=>p.id===id);dialog('논문을 담을 폴더',`<p>여러 폴더에 함께 담을 수 있어요.</p><div class="folder-checks">${folders.map(f=>`<label class="row"><input type="checkbox" id="membership-${f.id}" ${p.folders.includes(f.id)?'checked':''}> ${f.parent?'↳ ':''}${escapeHtml(f.name)}</label>`).join('')}</div><label for="paper-tags">태그 · 쉼표로 구분</label><input id="paper-tags" value="${escapeHtml(p.tags.join(', '))}">`,`<button class="button" data-action="overlay-close">취소</button><button class="button primary" data-action="paper-folders-save" data-id="${id}">저장</button>`);return;}
  if(a==='paper-folders-save'){const p=papers.find(p=>p.id===id);p.folders=folders.filter(f=>overlayValues['membership-'+f.id]).map(f=>f.id);p.tags=(overlayValues['paper-tags']||'').split(',').map(t=>t.trim()).filter(Boolean);p.saved=true;render();toast('폴더와 태그를 저장했어요.');return;}
  if(a==='add-paper'){dialog('논문 추가',`<p>논문 링크, arXiv ID, DOI를 입력하거나 PDF를 선택하세요.</p><label for="paper-link">논문 링크 또는 ID</label><input id="paper-link" placeholder="arxiv.org/abs/1706.03762"><label class="button" style="text-align:center;cursor:pointer" for="paper-file">${icon('plus')} 이 기기의 PDF 선택</label><input id="paper-file" type="file" accept="application/pdf" style="display:none">`,`<button class="button" data-action="overlay-close">취소</button><button class="button primary" data-action="paper-add-confirm">추가</button>`,b);return;}
  if(a==='paper-add-confirm'){const link=overlayValues['paper-link']?.trim();if(!link&&!overlayValues['paper-file']){toast('링크를 입력하거나 PDF를 선택해 주세요.');return;}state.status='ready';papers.find(p=>p.id==='flash').saved=true;state.screen='library';render();toast('검토 예시 논문을 보관함에 추가했어요.');return;}
  if(a==='reader-back'){savePositions();state.screen=state.returnScreen;render();updateUrl();return;}
  if(a==='prev-page'||a==='next-page'){goPage(state.page+(a==='prev-page'?-1:1));return;}
  if(a==='mode'){savePositions();if(value!=='split'){state.compactPane=value;state.annotationPane=value;}state.mode=value;render();return;}
  if(a==='linked'){state.linked=!state.linked;renderReader();toast(state.linked?'원문과 번역을 함께 스크롤합니다.':'각 페이지를 따로 스크롤합니다.');return;}
  if(a==='panel-toggle'||a==='panel-close'){savePositions();state.panel=a==='panel-toggle'?!state.panel:false;render();if(!state.panel)$('[data-action=panel-toggle]')?.focus();return;}
  if(a==='panel-tab'){savePositions();state.panelTab=value;render();$(`#tab-${value}`)?.focus();return;}
  if(a==='new-question'){savePositions();archiveQuestion();state.draft='';selectedContext=null;state.historySelection=null;render();$('#question-draft')?.focus();toast('이전 질문을 기록에 보관했어요.');return;}
  if(a==='history-filter'){state.historyFilter=value;renderReader();return;}
  if(a==='history-open'){state.historySelection=state.historySelection===Number(id)?null:Number(id);renderReader();return;}
  if(a==='citation'){state.mode='source';state.compactPane='source';goPage(b.dataset.page);if(mobile())state.panel=false;render();toast('원문의 '+state.page+'쪽으로 이동했어요.');return;}
  if(a==='tool'){state.tool=value;renderReader();return;}
  if(a==='new-note'||a==='selection-note'){savePositions();if(state.mode==='translation'||compact()){state.mode='source';state.compactPane='source';}const n={id:'n'+Date.now(),paper:state.paper,pane:'source',page:state.page,x:mobile()?42:52,y:34,collapsed:false,text:a==='selection-note'?selectedContext?.text||'':''};state.notes.push(n);render();$(`[data-note-text="${n.id}"]`)?.focus();return;}
  if(a==='collapse-note'){const n=state.notes.find(n=>n.id===id);n.collapsed=!n.collapsed;renderReader();$(`[data-id="${id}"][data-action=collapse-note]`)?.focus();return;}
  if(a==='jump-note'){const n=state.notes.find(n=>n.id===id);state.page=n.page;state.compactPane=n.pane;state.mode=n.pane;n.collapsed=false;state.positions[n.pane]=Math.max(0,n.y/100-.2);if(mobile())state.panel=false;render();return;}
  if(a==='undo'||a==='redo'){const pane=state.annotationPane;const from=a==='undo'?state.strokes[pane]:state.redo[pane];const to=a==='undo'?state.redo[pane]:state.strokes[pane];if(from.length)to.push(from.pop());renderReader();return;}
  if(a==='ink-options'){menu(b,'펜 설정',[{label:'볼펜 · 2px',hint:'펜은 바로 필기, 손가락은 스크롤',action:'tool',value:'pen'},{label:'형광펜 · 15px',action:'tool',value:'highlighter'},{label:'텍스트 선택',hint:'글자를 선택하려면 이 도구를 선택',action:'tool',value:'text'}],{list:true});return;}
  if(a==='model-menu'){menu(b,'답변과 번역에 사용할 모델',['Codex · 기본 모델','Claude · 기본 모델'].map(v=>({label:v,action:'model',value:v,selected:state.model===v})),{list:true});return;}
  if(a==='model'){state.model=value;renderReader();return;}
  if(a==='language-menu'){menu(b,'번역 및 답변 언어',['한국어','English','日本語','简体中文'].map(v=>({label:v,action:'language',value:v,selected:state.target===v})),{list:true});return;}
  if(a==='language'){state.target=value;renderReader();toast(value==='한국어'?'저장된 한국어 번역을 표시해요.':'이 검토에서는 한국어 번역 예시를 표시해요.');return;}
  if(a==='translate'){if(state.status==='offline'){toast('PC에 연결하면 번역을 시작할 수 있어요.');return;}state.status='ready';state.translationPaused=!state.translationPaused;renderReader();toast(state.translationPaused?'번역을 일시 정지했어요. 완료한 페이지는 계속 읽을 수 있어요.':'번역을 이어서 진행해요.');return;}
  if(a==='zoom-menu'){menu(b,'페이지 크기',[75,100,125,150].map(v=>({label:v===100?'페이지에 맞춤 · 100%':v+'%',action:'zoom',value:v,selected:state.zoom===v})),{list:true});return;}
  if(a==='zoom'||a==='zoom-in'||a==='zoom-out'){state.zoom=a==='zoom'?Number(value):Math.max(75,Math.min(150,state.zoom+(a==='zoom-in'?25:-25)));renderReader();$$('.document-page').forEach(el=>el.style.zoom=state.zoom/100);return;}
  if(a==='reader-menu'){menu(b,'논문 보기 및 작업',[{label:'원문 보기',action:'mode',value:'source'},{label:'번역 보기',action:'mode',value:'translation'},null,{label:'노트 보기',action:'open-tab',value:'notes'},{label:'질문 기록',action:'open-tab',value:'history'},{label:'관련 논문',action:'open-tab',value:'related'},{label:'내보내기',action:'export-menu'},{label:'보기 테마',action:'theme-menu'}]);return;}
  if(a==='open-tab'){state.panel=true;state.panelTab=value;renderReader();return;}
  if(a==='export-menu'){menu(b,'내보내기',[{label:'번역 PDF',action:'export',value:'translation'},{label:'원문과 번역 · 나란히 PDF',action:'export',value:'split'},{label:'논문 노트 · Markdown',action:'export',value:'notes'},{label:'참고 문헌 · BibTeX',action:'export',value:'bib'}]);return;}
  if(a==='export'){simpleDialog('내보내기',value==='notes'?'노트는 원문과 번역을 구분해 내보냅니다. 이 프로토타입에서는 파일을 생성하지 않습니다.':'내보내기 형식을 선택했어요. 이 프로토타입에서는 PDF와 인용 파일을 생성하지 않습니다.');return;}
  if(a==='selection-highlight'){toast('선택 문장 하이라이트 예시를 표시했어요.');return;}
  if(a==='selection-question'){state.draft='선택한 문장의 의미를 설명해 주세요.';state.panel=true;state.panelTab='questions';render();$('#question-draft').focus();return;}
  if(a==='figure-explain'){savePositions();selectedContext={text:'그림 1 · 스케일 내적 어텐션',pane:'source',page:state.page,kind:'figure'};state.draft='이 그림에서 Q, K, V가 연결되는 과정을 설명해 주세요.';state.panel=true;state.panelTab='questions';render();$('#question-draft').focus();return;}
  if(a==='selection-copy'){navigator.clipboard?.writeText(selectedContext?.text||'').then(()=>toast('선택 문장을 복사했어요.')).catch(()=>toast('이 브라우저에서는 복사 권한이 필요해요.'));return;}
  if(a==='topic-filter'){state.topic=value;render();return;}
  if(a==='topic-follow'){const active=b.getAttribute('aria-pressed')==='true';b.setAttribute('aria-pressed',!active);b.innerHTML=icon(active?'plus':'check')+(active?'팔로우':'팔로우 중');return;}
  if(a==='topic-add'){dialog('관심 주제 추가',`<p>분야 이름이나 읽고 싶은 연구 주제를 검색하세요.</p><label for="topic-search">주제</label><input id="topic-search" placeholder="예: 긴 문맥 평가"><div class="command-list"><button data-action="topic-add-confirm">${icon('plus')} 긴 문맥과 근거 추적</button><button data-action="topic-add-confirm">${icon('plus')} 효율적인 모델 학습</button></div>`,`<button class="button" data-action="overlay-close">닫기</button>`);return;}
  if(a==='topic-add-confirm'){toast('관심 주제를 추가했어요.');return;}
  if(a==='refresh-feed'){toast('관심 주제의 논문과 뉴스를 새로 불러왔어요.');return;}
  if(a==='news-translate'){state.newsTranslated=!state.newsTranslated;render();return;}
  if(a==='news-read'){dialog('긴 문맥 평가에서 근거를 읽는 방법',`<span class="pill">뉴스 읽기</span><p>답변을 평가할 때는 주장과 인용한 문장이 연결되는지 살펴보세요. 긴 문맥에서는 정확한 근거를 찾고, 그 근거가 실제 결론을 뒷받침하는지 확인하는 과정이 중요합니다.</p><p>이 기사는 프로토타입을 위한 예시이며 실제 게시물을 가져오지 않습니다.</p>`,`<button class="button" data-action="news-translate">제목 번역</button><button class="button primary" data-action="overlay-close">닫기</button>`);return;}
  if(a==='settings'){dialog('보기 및 연결',`<p>지우의 PC · 마지막 동기화 방금</p><div class="command-list"><button data-action="theme-menu">${icon('sun')} 테마: ${state.theme==='dark'?'다크':state.theme==='sepia'?'세피아':'라이트'}</button><button data-action="state" data-value="offline">${icon('offline')} 오프라인 상태 검토</button><button data-action="command-palette">${icon('search')} 명령 검색 <kbd>Ctrl K</kbd></button></div>`,`<button class="button primary" data-action="overlay-close">닫기</button>`,b);return;}
  if(a==='command-palette'){dialog('명령 검색',`<label for="command-query">검색</label><input id="command-query" placeholder="화면 이동 또는 작업 검색"><div class="command-list">${[['library','보관함 열기','library'],['discover','논문 발견하기','home'],['add-paper','논문 추가','plus'],['open-tab','질문 기록 보기','clock']].map(([action,label,name])=>`<button data-action="${action}" ${action==='open-tab'?'data-value="history"':''}>${icon(name)} ${label}</button>`).join('')}</div>`,`<button class="button" data-action="overlay-close">닫기</button>`,b);return;}
});
// Capture dialog fields before action bubbling closes its overlay.
let overlayValues={};
document.addEventListener('click',e=>{
    if(e.target.closest('#overlay')){overlayValues={};$$('.dialog input').forEach(el=>overlayValues[el.id]=el.type==='file'?el.files[0]?.name:el.type==='checkbox'?el.checked:el.value);}
},true);
document.addEventListener('keydown',e=>{
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();$('[data-action=command-palette]')?.click()||dialog('명령 검색',`<div class="command-list"><button data-action="library">${icon('library')} 보관함 열기</button><button data-action="discover">${icon('home')} 논문 발견하기</button><button data-action="add-paper">${icon('plus')} 논문 추가</button><button data-action="open-tab" data-value="history">${icon('clock')} 질문 기록 보기</button></div>`,`<button class="button" data-action="overlay-close">닫기</button>`);return;}
  if(e.key==='Escape'){if($('#overlay').innerHTML){closeOverlay();return;}if(state.screen==='reader'&&state.panel){savePositions();state.panel=false;render();$('[data-action=panel-toggle]')?.focus();return;}}
  if($('.dialog')&&e.key==='Tab'){const focusable=$$('button,input:not([type=hidden]),textarea,[tabindex="0"]',$('.dialog')).filter(x=>x.offsetParent!==null);const first=focusable[0];const last=focusable.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}
  if($('.popover')&&['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();const items=$$('button',$('.popover'));const i=items.indexOf(document.activeElement);items[e.key==='Home'?0:e.key==='End'?items.length-1:(i+(e.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();}
  if(document.activeElement?.getAttribute('role')==='tab'&&['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const tabs=$$('[role=tab]');const i=tabs.indexOf(document.activeElement);const next=tabs[e.key==='Home'?0:e.key==='End'?tabs.length-1:(i+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length];next.click();}
});
let lastWidth=innerWidth;
window.addEventListener('resize',()=>{
  if((lastWidth<600)!==(innerWidth<600)||(lastWidth<840)!==(innerWidth<840)){savePositions();render();}
  lastWidth=innerWidth;
});
render();
