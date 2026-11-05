/* FrotaCheck — sem rascunhos locais; registros enviados são consultados na nuvem. */
const API_URL = "https://script.google.com/macros/s/AKfycbzZG4ax6WY_8tDxZpjcz_cvRpEoNLMLSPpPX0EywDqAsj_dni5O0UKgNjTtcqsXTuyATQ/exec";
let refreshInFlight = false;
let realtimeTimer = null;
let cloudLoading = false;
const GROUPS = [
  {title:"Externo · visual geral",items:["A lataria está em boas condições, sem avarias visíveis?","Os retrovisores estão em boas condições?","Os vidros e o para-brisa estão íntegros?","O veículo está sem vazamentos aparentes?","As portas estão funcionando corretamente?"]},
  {title:"Pneus",items:["Os pneus estão calibrados e sem danos?","As rodas estão firmes?","O estepe está em boas condições?"]},
  {title:"Luzes",items:["Os faróis alto e baixo estão funcionando?","As setas e o pisca-alerta estão funcionando?","As luzes de freio estão funcionando?","As lanternas estão funcionando?"]},
  {title:"Segurança",items:["Os freios estão funcionando corretamente?","O freio de mão está funcionando?","O extintor está dentro da validade?","Os cintos de segurança estão funcionando?","As saídas de emergência estão desobstruídas?"]},
  {title:"Funcionamento",items:["O painel está sem luzes de alerta acesas?","A buzina está funcionando?","O ar-condicionado e a ventilação estão funcionando?","O veículo está funcionando sem ruídos anormais?"]},
  {title:"Operacional",items:["O veículo tem combustível suficiente?","A documentação obrigatória está no veículo?","O veículo está com a limpeza básica em dia?"]}
];
const OPERATIONAL = [
  "A porta de embarque possui chave?","A trava da porta está funcionando?","Há uma chave para a tampa do tanque?","O tanque de combustível está cheio?","Os pneus estão em boas condições?","O tanque de ARLA está cheio?","Há uma chave para o tanque de ARLA?","O veículo possui estepe?","O veículo possui macaco?","O veículo possui chave de roda?","O veículo possui triângulo?","O tacógrafo está funcionando?","A trava do bagageiro do estepe está funcionando?","O filtro de combustível está em dia?","O filtro de ar está em boas condições?","A placa do veículo está legível?","Os rastreadores estão presentes e funcionando?"
];
let records = [];
let historyHasLoaded = false;
let activeId = null;
let photos = [];
let currentUser = null;
const $ = id => document.getElementById(id);
const views = ["appView","formView","detailView"];
const routePath = decodeURIComponent(location.pathname).replace(/\/index\.html$/i, "").replace(/\/+$/, "").toLowerCase();
/* /Checklist = criar checklists (conferentes). /Conferencia = consulta de todos os checklists (gerência). */
const formType = "Checklist";
const isEntryRoute = routePath.endsWith("/checklist");
function clearLegacyLocalData(){
  // Remove only data left by older versions; the current app never stores records or form drafts locally.
  try{
    ["frotacheck.records.v1","frotacheck.session.v2","frotacheck.draft.v1:checklist"].forEach(key=>localStorage.removeItem(key));
  }catch(error){console.warn("Não foi possível limpar dados antigos do FrotaCheck:",error);}
}
function showView(id){views.forEach(v=>$(v).hidden=v!==id);window.scrollTo({top:0,behavior:"smooth"});}
function uid(){return "chk_"+Date.now().toString(36)+"_"+Math.random().toString(36).slice(2,8);}
function nowLocal(){const d=new Date();d.setMinutes(d.getMinutes()-d.getTimezoneOffset());return d.toISOString().slice(0,16);}
function displayDateTime(value){if(!value)return "Sem data";const raw=String(value);const d=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)?new Date(raw):new Date(raw);return Number.isNaN(d.getTime())?"Sem data":d.toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"});}
function escapeHtml(s=""){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function customConfirm(message,title="Confirmar ação",confirmLabel="Confirmar") { return new Promise(resolve=>{const modal=$("actionConfirmModal");if(!modal){resolve(window.confirm(message));return;}$("actionConfirmTitle").textContent=title;$("actionConfirmMessage").textContent=message;$("actionConfirmYes").textContent=confirmLabel;modal.hidden=false;const finish=value=>{modal.hidden=true;$("actionConfirmYes").onclick=null;$("actionConfirmCancel").onclick=null;resolve(value);};$("actionConfirmYes").onclick=()=>finish(true);$("actionConfirmCancel").onclick=()=>finish(false);});}
function toast(msg){const t=$("toast");t.textContent=msg;t.classList.add("show");clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.classList.remove("show"),2600);}
function setConnection(){const online=navigator.onLine;$("offlineBanner").hidden=online;$("connectionState").classList.toggle("offline",!online);$("connectionState").innerHTML=`<i></i>${online?"Online":"Offline"}`;}
function statusLabel(r){return r.status==="complete"?"Finalizado":r.status==="pending"?"Pendente de envio":"Não enviado";}
function makeChoices(name,value=""){
  return `<div class="item-options" role="radiogroup" aria-label="Avaliação do item">${[["bad","✕","Não conforme"],["na","/","Não se aplica"],["ok","✓","OK"]].map(([v,glyph,label])=>`<label class="choice choice-${v} ${value===v?"is-selected":""}" title="${label}" aria-label="${label}"><input type="radio" name="${name}" value="${v}" ${value===v?"checked":""}><span aria-hidden="true">${glyph}</span></label>`).join("")}</div>`;
}
function sectionHeader(number,title,subtitle=""){
  return `<header class="check-section-head"><span class="section-number">${String(number).padStart(2,"0")}</span><div><h2>${title}</h2>${subtitle?`<p>${subtitle}</p>`:""}</div></header>`;
}
function renderCheckItem(item,key,valueData={}){
  const selected=valueData.value||"";
  const noteVisible=selected==="na"||selected==="ok";
  return `<div class="check-item"><div class="item-name">${escapeHtml(item)}</div>${makeChoices(key,selected)}<div class="item-note" ${noteVisible?"":"hidden"}><input data-note="${key}" value="${escapeHtml(valueData.note||"")}" placeholder="Observação (opcional)" aria-label="Observação para ${escapeHtml(item)}"></div></div>`;
}
function renderCheckSections(data={}){
  $("checklistSections").innerHTML=`<div class="check-groups">${GROUPS.map((g,gi)=>{
    const standardItems=g.items.map((item,ii)=>{const key=`g${gi}_${ii}`,v=data.checks?.[key]||{};return renderCheckItem(item,key,v);}).join("");
    // Os itens operacionais usam as chaves opN para manter compatibilidade com registros já enviados.
    const additionalOperationalItems=gi===5?OPERATIONAL.map((item,i)=>{const key=`op${i}`,v=data.checks?.[key]||{};return renderCheckItem(item,key,v);}).join(""):"";
    return `<section class="check-group">${sectionHeader(gi+2,g.title)}<div class="item-list">${standardItems}${additionalOperationalItems}</div></section>`;
  }).join("")}</div>`;
  document.querySelectorAll('#checklistForm input[type="radio"]').forEach(el=>el.addEventListener("change",()=>{
    const group=document.querySelectorAll(`input[name="${el.name}"]`);
    group.forEach(r=>r.closest(".choice")?.classList.toggle("is-selected",r.checked));
    const item=el.closest(".check-item"),note=item?.querySelector(".item-note"),noteInput=note?.querySelector("input");
    const showNote=el.value==="na"||el.value==="ok";
    if(note)note.hidden=!showNote;
    if(el.value==="bad"&&noteInput)noteInput.value="";
    updateProgress();
  }));
}
function collectChecks(){const checks={};document.querySelectorAll('#checklistForm input[type="radio"]:checked').forEach(el=>{checks[el.name]??={};checks[el.name].value=el.value;});document.querySelectorAll('#checklistForm [data-note]').forEach(el=>{const key=el.dataset.note;checks[key]??={};checks[key].note=el.value;});return checks;}
function completedCount(){const checked=document.querySelectorAll('#checklistForm input[type="radio"]:checked').length;const total=document.querySelectorAll('#checklistForm input[type="radio"][value="ok"]').length;return {checked,total};}
function updateProgress(){const {checked,total}=completedCount();const pct=total?Math.round(checked/total*100):0;$("progressBar").style.width=pct+"%";$("progressText").textContent=pct+"% dos itens avaliados";}
function formData(){return {id:uid(),owner:"público",formType,driver:$("driver").value,vehicle:$("vehicle").value,plate:$("plate")?.value.trim().toUpperCase()||"",vehicleType:$("vehicleType").value,dateTime:$("dateTime").value,odometer:$("odometer").value,origin:$("origin").value,destination:$("destination").value,checks:collectChecks(),damageNotes:$("damageNotes").value,generalNotes:$("generalNotes").value,photos:photos.map(p=>({name:p.name,data:p.data,type:p.type})),status:"complete",updatedAt:new Date().toISOString()};}
function fillForm(r){
  if(r){ openDetail(r.id); return; }
  activeId=null;photos=(r?.photos||[]).slice();
  $("formTitle").textContent="Novo formulário";
  $("dateTime").value=r?.dateTime||nowLocal();$("driver").value=r?.driver||"";$("vehicle").value=r?.vehicle||"";if($("plate"))$("plate").value=r?.plate||"";$("vehicleType").value=r?.vehicleType||"Ônibus";$("odometer").value=r?.odometer||"";$("origin").value=r?.origin||"";$("destination").value=r?.destination||"";$("damageNotes").value=r?.damageNotes||"";$("generalNotes").value=r?.generalNotes||"";
  renderCheckSections(r||{});renderPhotos();updateProgress();if($("saveState")) $("saveState").textContent="";showView("formView");
}
function renderPhotos(){$("photoGallery").innerHTML=photos.map((p,i)=>`<div class="photo-card"><img src="${p.data}" alt="${escapeHtml(p.name||"Foto de avaria "+(i+1))}" data-preview-photo tabindex="0" role="button" aria-label="Ampliar foto ${i+1}"><button type="button" aria-label="Remover foto" data-remove-photo="${i}">×</button></div>`).join("");document.querySelectorAll("[data-remove-photo]").forEach(b=>b.onclick=()=>{photos.splice(Number(b.dataset.removePhoto),1);renderPhotos();});bindPhotoPreviews($("photoGallery"));}
let previewZoom=1, previewX=0, previewY=0, previewDragging=false, previewStartX=0, previewStartY=0, previewOriginX=0, previewOriginY=0;
function bindPhotoPreviews(root=document){
  root.querySelectorAll("img[data-preview-photo]").forEach(img=>{
    if(img.dataset.previewBound==="1")return;
    img.dataset.previewBound="1";
    img.addEventListener("click",()=>openPhotoPreview(img.currentSrc||img.src,img.alt||"Foto de avaria"));
    img.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();openPhotoPreview(img.currentSrc||img.src,img.alt||"Foto de avaria");}});
  });
}
function openPhotoPreview(src,title){
  const modal=$("photoPreviewModal"),img=$("photoPreviewImage");
  img.src=src;img.alt=title; $("photoPreviewTitle").textContent=title;
  modal.hidden=false;document.body.classList.add("preview-open");resetPhotoZoom();
  $("photoPreviewClose").focus();
}
function closePhotoPreview(){
  $("photoPreviewModal").hidden=true;document.body.classList.remove("preview-open");
  $("photoPreviewImage").src="";previewDragging=false;
}
function applyPhotoZoom(){
  const img=$("photoPreviewImage");
  img.style.transform=`translate(${previewX}px, ${previewY}px) scale(${previewZoom})`;
  img.style.cursor=previewZoom>1?"grab":"zoom-in";
  $("photoZoomValue").textContent=Math.round(previewZoom*100)+"%";
  $("photoZoomOut").disabled=previewZoom<=1;
  $("photoZoomIn").disabled=previewZoom>=4;
}
function setPhotoZoom(next){
  const old=previewZoom;previewZoom=Math.max(1,Math.min(4,next));
  if(previewZoom===1){previewX=0;previewY=0;}
  else if(old!==previewZoom){const factor=previewZoom/old;previewX*=factor;previewY*=factor;}
  applyPhotoZoom();
}
function resetPhotoZoom(){previewZoom=1;previewX=0;previewY=0;applyPhotoZoom();}
$("photoPreviewClose").onclick=closePhotoPreview;
$("photoPreviewModal").addEventListener("click",e=>{if(e.target===$("photoPreviewModal")||e.target.classList.contains("photo-preview-backdrop"))closePhotoPreview();});
$("photoZoomIn").onclick=()=>setPhotoZoom(previewZoom+.25);
$("photoZoomOut").onclick=()=>setPhotoZoom(previewZoom-.25);
$("photoZoomReset").onclick=resetPhotoZoom;
$("photoPreviewImage").addEventListener("wheel",e=>{e.preventDefault();setPhotoZoom(previewZoom+(e.deltaY<0?.15:-.15));},{passive:false});
$("photoPreviewImage").addEventListener("pointerdown",e=>{
  if(previewZoom<=1)return;
  previewDragging=true;previewStartX=e.clientX;previewStartY=e.clientY;previewOriginX=previewX;previewOriginY=previewY;
  $("photoPreviewImage").setPointerCapture(e.pointerId);$("photoPreviewImage").style.cursor="grabbing";
});
$("photoPreviewImage").addEventListener("pointermove",e=>{
  if(!previewDragging)return;previewX=previewOriginX+(e.clientX-previewStartX);previewY=previewOriginY+(e.clientY-previewStartY);applyPhotoZoom();
});
$("photoPreviewImage").addEventListener("pointerup",()=>{previewDragging=false;applyPhotoZoom();});
$("photoPreviewImage").addEventListener("pointercancel",()=>{previewDragging=false;applyPhotoZoom();});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!$("photoPreviewModal").hidden)closePhotoPreview();});
async function addPhotos(filesList){for(const file of Array.from(filesList)){if(!file.type.startsWith("image/"))continue;try{const data=await compressImage(file);photos.push({name:file.name||"avaria.jpg",type:"image/jpeg",data});}catch{toast("Não foi possível carregar uma das fotos.");}}renderPhotos();}
function compressImage(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=reject;reader.onload=()=>{const img=new Image();img.onerror=reject;img.onload=()=>{const max=1400,scale=Math.min(1,max/Math.max(img.width,img.height)),canvas=document.createElement("canvas");canvas.width=Math.round(img.width*scale);canvas.height=Math.round(img.height*scale);canvas.getContext("2d").drawImage(img,0,0,canvas.width,canvas.height);resolve(canvas.toDataURL("image/jpeg",.76));};img.src=reader.result;};reader.readAsDataURL(file);});}
async function clearForm(){
  if(!await customConfirm("Todos os campos preenchidos serão apagados. O formulário não será armazenado neste aparelho.","Limpar formulário","Limpar tudo"))return;
  const driver=$("driver").value;
  activeId=null;photos=[];
  $("checklistForm").reset();
  fillForm(null);
  $("driver").value=driver;
  renderPhotos();
  toast("Formulário limpo.");
}
function issuesFor(record){return Object.values(record.checks||{}).filter(item=>item?.value==="bad").length;}
function renderHistory(){
  const search=$("historySearch"),listEl=$("historyList"),emptyEl=$("emptyHistory"),loadingEl=$("historyLoading");
  if(!listEl||!emptyEl)return;
  const query=(search?.value||"").trim().toLowerCase();
  const all=records.slice().sort((a,b)=>(b.updatedAt||"").localeCompare(a.updatedAt||""));
  const clean=all.filter(r=>issuesFor(r)===0);
  const withIssues=all.filter(r=>issuesFor(r)>0);
  if($("statTotal"))$("statTotal").textContent=clean.length;
  if($("statWithIssues"))$("statWithIssues").textContent=withIssues.length;
  if($("statIssues"))$("statIssues").textContent=all.length;
  const statCards=document.querySelectorAll(".stats-grid .stat-card");
  const labels=["Sem pendências","Com Avarias","Total"];
  statCards.forEach((card,index)=>{
    const label=card.querySelector("span");
    const description=card.querySelector("small");
    if(label)label.textContent=labels[index]||"";
    if(description)description.remove();
    card.classList.remove("is-active");
  });
  const visible=all.filter(r=>{
    const haystack=[r.formType,r.vehicle,r.destination,r.origin,r.driver].join(" ").toLowerCase();
    return haystack.includes(query);
  });
  listEl.innerHTML=visible.map(r=>`<article class="history-card"><div class="vehicle-icon" aria-hidden="true">▣</div><div class="history-main"><strong>${escapeHtml(r.vehicle||"Veículo sem prefixo")}</strong><p>${escapeHtml(r.driver||"Conferente")} · ${escapeHtml(r.origin||"Origem não informada")} → ${escapeHtml(r.destination||"")}</p></div><div class="history-meta"><span class="status-pill ${issuesFor(r)>0?"has-issues":escapeHtml(r.status||"complete")}">${issuesFor(r)>0?"Com Avaria":"Finalizado"}</span><small>${displayDateTime(r.dateTime)} · ${Number.isFinite(r.photoCount)?r.photoCount:(r.photos||[]).length} foto(s)</small></div><div class="card-actions"><button class="mini-btn" data-open="${escapeHtml(r.id)}" type="button">Ver detalhes <span aria-hidden="true">→</span></button></div></article>`).join("");
  const hasVisible=visible.length>0;
  listEl.hidden=!hasVisible;
  if(loadingEl)loadingEl.hidden=historyHasLoaded;
  emptyEl.hidden=hasVisible||!historyHasLoaded;
  document.querySelectorAll("[data-open]").forEach(button=>button.onclick=()=>openDetail(button.dataset.open));
}

async function openDetail(id){
  const summary=records.find(x=>String(x.id)===String(id));
  if(!summary){toast("Este checklist não está disponível na lista atual. Atualize a Gerência e tente novamente.");return;}
  activeId=String(id);
  showView("detailView");
  // Os metadados da Gerência já contêm identificação, avaliações e observações.
  // Renderize isso imediatamente; fotos são carregadas separadamente para não travar a tela.
  renderDetail(summary);
  if(Number(summary.photoCount||0)>0) loadDetailPhotos(String(id));
}

async function loadDetailPhotos(id){
  const area=$("detailPhotoArea");
  if(!area)return;
  area.innerHTML='<div class="detail-photo-state">Carregando fotos…</div>';
  try{
    const response=await apiRequest({action:"getPhotos",id});
    if(String(activeId)!==String(id)||$("detailView").hidden)return;
    const photos=Array.isArray(response.photos)?response.photos:[];
    area.innerHTML=photos.length
      ? `<div class="detail-photos">${photos.map((p,i)=>`<img src="${p.data}" alt="${escapeHtml(p.name||"Foto de avaria "+(i+1))}" data-preview-photo tabindex="0" role="button" aria-label="Ampliar foto ${i+1}">`).join("")}</div>`
      : '<div class="detail-photo-state">Nenhuma foto disponível para este checklist.</div>';
    bindPhotoPreviews(area);
  }catch(error){
    console.error("Falha ao carregar fotos do checklist:",error);
    if(String(activeId)===String(id)&&!$("detailView").hidden){
      area.innerHTML='<div class="detail-photo-state is-error">Não foi possível carregar as fotos agora. As informações do checklist estão disponíveis acima.</div>';
    }
  }
}

let busCurrentView = "side";
const BUS_VIEW_TITLES = {front:"Frente",side:"Lateral",rear:"Traseira"};
const BUS_CHECK_MARKS = {
  g0_0:{label:"Lataria",points:{side:[[580,190]],front:[[320,330]],rear:[[320,330]]}},
  g0_1:{label:"Retrovisores",points:{side:[[132,145]],front:[[88,188],[552,188]]}},
  g0_2:{label:"Vidros e para-brisa",points:{side:[[470,128]],front:[[320,144]],rear:[[320,140]]}},
  g0_3:{label:"Vazamento aparente",points:{side:[[535,333]],front:[[320,365]],rear:[[320,365]]}},
  g0_4:{label:"Portas",points:{side:[[420,222]]}},
  g1_0:{label:"Pneus",points:{side:[[295,315],[790,315]]}},
  g1_1:{label:"Rodas",points:{side:[[295,315],[790,315]]}},
  g1_2:{label:"Estepe",points:{rear:[[500,335]]}},
  g2_0:{label:"Faróis",points:{front:[[190,303],[450,303]]}},
  g2_1:{label:"Setas e pisca-alerta",points:{front:[[130,292],[510,292]],rear:[[164,282],[476,282]]}},
  g2_2:{label:"Luzes de freio",points:{rear:[[170,294],[470,294]]}},
  g2_3:{label:"Lanternas",points:{rear:[[165,270],[475,270]]}},
  op1:{label:"Trava da porta",points:{side:[[425,222]]}},
  op4:{label:"Pneus operacionais",points:{side:[[295,315],[790,315]]}},
  op7:{label:"Estepe",points:{rear:[[500,335]]}},
  op15:{label:"Placa",points:{front:[[420,350]],rear:[[420,354]]}}
};
function normalizeMapText(value){return String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();}
function addBusMapMarker(views,view,issue,x,y,approximate=false){
  const existing=views[view].find(marker=>Math.hypot(marker.x-x,marker.y-y)<24);
  if(existing){
    existing.keys=[...new Set([...(existing.keys||[existing.key]),issue.key])];
    existing.issues=[...(existing.issues||[{title:existing.title,description:existing.description}]),{title:issue.title,description:issue.description}];
    existing.title=[...new Set(existing.issues.map(entry=>entry.title))].join(" · ");
    existing.description=existing.issues.map(entry=>entry.title+": "+entry.description).join(" | ");
    existing.approximate=existing.approximate||approximate;
  }else{
    views[view].push({...issue,keys:[issue.key],issues:[{title:issue.title,description:issue.description}],x,y,view,approximate});
  }
}
function collectBusMapData(record){
  const views={front:[],side:[],rear:[]}, allIssues=[], unmapped=[];
  const checks=record.checks||{};
  Object.entries(checks).forEach(([key,item])=>{
    if(!item||item.value!=="bad")return;
    const rule=BUS_CHECK_MARKS[key];
    const groupMatch=key.match(/^g(\d+)_(\d+)$/);
    const label=rule?.label||(groupMatch?GROUPS[Number(groupMatch[1])]?.items[Number(groupMatch[2])] : (key.startsWith("op")?OPERATIONAL[Number(key.slice(2))]:null))||"Item não conforme";
    const issue={key,title:label,description:item.note||"Marcado como Não conforme no checklist."};
    allIssues.push(issue);
    if(!rule){unmapped.push(issue);return;}
    Object.entries(rule.points).forEach(([view,points])=>points.forEach(([x,y])=>addBusMapMarker(views,view,issue,x,y)));
  });
  const damageText=String(record.damageNotes||"").trim();
  if(damageText){
    const normalized=normalizeMapText(damageText), targetViews=[];
    if(/frente|dianteir|parachoque dianteiro|para-choque dianteiro|farol|parabrisa|para-brisa|retrovisor/.test(normalized))targetViews.push("front");
    if(/traseir|parachoque traseiro|para-choque traseiro|lanterna|tampa traseira/.test(normalized))targetViews.push("rear");
    if(/lateral|lado direito|lado esquerdo|porta|pneu|roda|carroceria|lataria/.test(normalized))targetViews.push("side");
    if(!targetViews.length)targetViews.push("side");
    const issue={key:"manual-damage",title:"Avaria descrita",description:damageText};
    allIssues.push(issue);
    const defaultPoints={front:[[320,330]],side:[[585,190]],rear:[[320,330]]};
    [...new Set(targetViews)].forEach(view=>{
      const points=defaultPoints[view]||defaultPoints.side;
      points.forEach(([x,y])=>addBusMapMarker(views,view,issue,x,y,true));
    });
  }
  return {views,allIssues,unmapped,damageText};
}
function renderBusSvg(view,record,markers){
  const prefix=escapeHtml(record.vehicle||"—");
  const plate=escapeHtml(record.plate||"PLACA NÃO INFORMADA");
  const prefixSize=prefix.length>4?29:37;
  const defs=`<defs>
    <linearGradient id="busBody" x1="0" y1="0" x2="0.15" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e7eeeb"/></linearGradient>
    <linearGradient id="busGlass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#334c5b"/><stop offset=".52" stop-color="#142631"/><stop offset="1" stop-color="#0b1720"/></linearGradient>
    <linearGradient id="busNavy" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#153b7e"/><stop offset="1" stop-color="#071d4c"/></linearGradient>
    <linearGradient id="busOrange" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ff7a00"/><stop offset="1" stop-color="#f04a13"/></linearGradient>
    <filter id="busShadow" x="-20%" y="-30%" width="140%" height="180%"><feGaussianBlur stdDeviation="9"/></filter>
  </defs>`;
  let body="";
  if(view==="side"){
    body=`<svg class="bus-svg bus-svg-side" viewBox="0 0 1000 420" role="img" aria-label="Ônibus em vista lateral, prefixo ${prefix}, placa ${plate}">
      ${defs}<ellipse cx="505" cy="365" rx="420" ry="22" fill="#243b34" opacity=".16" filter="url(#busShadow)"/>
      <path d="M93 292 96 157Q99 119 139 104L210 80Q255 66 333 66H838Q903 68 925 126L938 277Q938 309 905 321H118Q89 319 93 292Z" fill="url(#busBody)" stroke="#b9c7c2" stroke-width="3"/>
      <path d="M96 258H931L936 292Q936 316 905 321H118Q91 318 93 292Z" fill="url(#busNavy)"/>
      <path d="M812 76 865 79 922 132 930 162 895 153 851 108Z" fill="url(#busOrange)"/>
      <path d="M124 119Q148 96 212 91L270 88 251 202H104L107 153Q109 132 124 119Z" fill="url(#busGlass)" stroke="#81939a" stroke-width="5"/>
      <path d="M279 88H355V202H265Z" fill="url(#busGlass)" stroke="#81939a" stroke-width="5"/>
      <path d="M365 88H447V202H365Z M457 88H539V202H457Z M549 88H631V202H549Z M641 88H723V202H641Z M733 88H813V202H733Z M822 107H886Q902 123 909 158L913 202H822Z" fill="url(#busGlass)" stroke="#81939a" stroke-width="5"/>
      <g stroke="#dbe4e0" stroke-width="3" opacity=".75"><path d="M293 96 293 191M390 96 390 191M482 96 482 191M574 96 574 191M666 96 666 191M758 96 758 191M846 114 846 191"/></g>
      <path d="M274 211H907" stroke="#aab8b2" stroke-width="3"/>
      <path d="M108 218 254 218 265 257H100Z" fill="#f6f8f7" stroke="#cbd6d1" stroke-width="2"/>
      <path d="M147 222h80" stroke="#153b7e" stroke-width="6" stroke-linecap="round"/>
      <path d="M250 258H323" stroke="#f1a04b" stroke-width="5"/>
      <path d="M164 260H245V303H164Z" fill="#f5f7f5" stroke="#c8d2cd" stroke-width="1.5"/>
      <image href="../icons/vmg-logo.jpg" x="445" y="211" width="170" height="50" preserveAspectRatio="xMidYMid meet" aria-label="Logo Viação Minas Gerais"/>
      <text x="204" y="292" text-anchor="middle" font-family="Arial,sans-serif" font-size="${Math.min(prefixSize,30)}" font-weight="900" fill="#101e31" stroke="#fff" stroke-width=".7" paint-order="stroke">${prefix}</text>
      <text x="130" y="290" font-family="Arial,sans-serif" font-size="12" font-weight="800" fill="#fff">COMIL</text>
      <g><circle cx="295" cy="310" r="49" fill="#101619" stroke="#53616a" stroke-width="5"/><circle cx="295" cy="310" r="28" fill="#9ca9a8" stroke="#dce3e0" stroke-width="5"/><circle cx="295" cy="310" r="10" fill="#47565a"/><path d="M295 284v52M269 310h52M277 292l36 36M313 292l-36 36" stroke="#657477" stroke-width="5"/>
      <circle cx="790" cy="310" r="49" fill="#101619" stroke="#53616a" stroke-width="5"/><circle cx="790" cy="310" r="28" fill="#9ca9a8" stroke="#dce3e0" stroke-width="5"/><circle cx="790" cy="310" r="10" fill="#47565a"/><path d="M790 284v52M764 310h52M772 292l36 36M808 292l-36 36" stroke="#657477" stroke-width="5"/></g>
      <path d="M340 205V286M810 207V286" stroke="#aab7b1" stroke-width="2"/><rect x="405" y="290" width="35" height="18" rx="4" fill="#c9d2cd"/><rect x="650" y="290" width="35" height="18" rx="4" fill="#c9d2cd"/>
      <text x="500" y="402" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" font-weight="800" letter-spacing="2" fill="#71817a">LATERAL · PREFIXO IDENTIFICADO NA CARROCERIA</text>
      ${renderBusMarkers(markers)}
    </svg>`;
  }else if(view==="front"){
    body=`<svg class="bus-svg bus-svg-front" viewBox="0 0 640 420" role="img" aria-label="Ônibus visto de frente, prefixo ${prefix}, placa ${plate}">
      ${defs}<ellipse cx="320" cy="381" rx="205" ry="17" fill="#243b34" opacity=".16" filter="url(#busShadow)"/>
      <path d="M116 353 105 150Q106 96 155 76Q206 55 320 55T485 76Q534 96 535 150L524 353Q520 372 496 378H144Q120 372 116 353Z" fill="url(#busBody)" stroke="#b9c7c2" stroke-width="4"/>
      <path d="M135 139Q146 91 190 85Q320 54 450 85Q494 91 505 139L492 253H148Z" fill="url(#busGlass)" stroke="#82939a" stroke-width="6"/>
      <path d="M320 70V248" stroke="#90a1a6" stroke-width="4"/><path d="M155 224Q320 253 485 224" fill="none" stroke="#b0c0c1" stroke-width="3"/>
      <path d="M320 76 320 236" stroke="#dbe4e2" stroke-width="1.5" opacity=".5"/>
      <path d="M121 255H519L525 329Q522 366 495 376H145Q118 366 115 329Z" fill="url(#busNavy)"/>
      <path d="M143 265Q320 282 497 265" stroke="#f4f7f5" stroke-width="5" opacity=".8"/>
      <path d="M121 284Q142 267 174 278L192 315 129 322Z" fill="#dce9e8" stroke="#8fa09d" stroke-width="4"/><path d="M519 284Q498 267 466 278L448 315 511 322Z" fill="#dce9e8" stroke="#8fa09d" stroke-width="4"/>
      <path d="M138 291h42M460 291h42" stroke="#fff" stroke-width="5" stroke-linecap="round"/>
      <path d="M190 326Q320 340 450 326" stroke="#061532" stroke-width="12" fill="none" stroke-linecap="round"/>
      <rect x="260" y="339" width="120" height="27" rx="4" fill="#f7f8f6" stroke="#b9c5c0" stroke-width="2"/><text x="320" y="357" text-anchor="middle" font-family="Arial,sans-serif" font-size="${plate.length>10?10:13}" font-weight="900" letter-spacing="1" fill="#17332e">${plate}</text>
      <path d="M95 145 68 126Q58 120 55 131L55 188Q58 202 70 196L105 183Z M545 145 572 126Q582 120 585 131L585 188Q582 202 570 196L535 183Z" fill="#182a35" stroke="#8a9b9f" stroke-width="5"/>
      <text x="320" y="48" text-anchor="middle" font-family="Arial,sans-serif" font-size="14" font-weight="900" letter-spacing="3" fill="#65746e">VMG</text>
      <text x="320" y="402" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" font-weight="800" letter-spacing="2" fill="#71817a">FRENTE · PLACA DO VEÍCULO</text>
      ${renderBusMarkers(markers)}
    </svg>`;
  }else{
    body=`<svg class="bus-svg bus-svg-rear" viewBox="0 0 640 420" role="img" aria-label="Ônibus visto por trás, prefixo ${prefix}, placa ${plate}">
      ${defs}<ellipse cx="320" cy="381" rx="205" ry="17" fill="#243b34" opacity=".16" filter="url(#busShadow)"/>
      <path d="M120 350 112 122Q114 84 153 71H487Q526 84 528 122L520 350Q516 373 492 378H148Q124 373 120 350Z" fill="url(#busBody)" stroke="#b9c7c2" stroke-width="4"/>
      <rect x="151" y="91" width="338" height="137" rx="26" fill="url(#busGlass)" stroke="#81939a" stroke-width="6"/>
      <path d="M320 96V221" stroke="#98a8ad" stroke-width="4"/><path d="M164 211H476" stroke="#d4dfdc" stroke-width="2"/>
      <text x="320" y="260" text-anchor="middle" font-family="Arial,sans-serif" font-size="43" font-weight="800" letter-spacing="3" fill="#8d9994">VMG</text>
      <text x="320" y="277" text-anchor="middle" font-family="Arial,sans-serif" font-size="9" font-weight="800" letter-spacing="2" fill="#66746e">VIAÇÃO MINAS GERAIS</text>
      <rect x="118" y="244" width="404" height="112" rx="12" fill="url(#busNavy)"/>
      <rect x="132" y="256" width="29" height="70" rx="8" fill="#d94735" stroke="#f9d6ce" stroke-width="3"/><rect x="479" y="256" width="29" height="70" rx="8" fill="#d94735" stroke="#f9d6ce" stroke-width="3"/>
      <path d="M180 296H460" stroke="#7d91a9" stroke-width="10" stroke-linecap="round"/>
      <rect x="260" y="334" width="120" height="27" rx="4" fill="#f7f8f6" stroke="#b9c5c0" stroke-width="2"/><text x="320" y="352" text-anchor="middle" font-family="Arial,sans-serif" font-size="${plate.length>10?10:13}" font-weight="900" letter-spacing="1" fill="#17332e">${plate}</text>
      <text x="320" y="402" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" font-weight="800" letter-spacing="2" fill="#71817a">TRASEIRA · IDENTIFICAÇÃO DO VEÍCULO</text>
      ${renderBusMarkers(markers)}
    </svg>`;
  }
  return body;
}
function renderBusMarkers(markers){
  return `<g class="bus-hotspots">${markers.map((marker,index)=>`<g class="bus-hotspot" data-bus-hotspot="${index}" tabindex="0" role="button" aria-label="${escapeHtml(marker.title)}: ${escapeHtml(marker.description)}" transform="translate(${marker.x} ${marker.y})"><circle class="bus-hotspot-pulse" r="20" fill="#e12828" opacity=".18"/><circle class="bus-hotspot-core" r="10" fill="#d92323" stroke="#fff" stroke-width="3"/><text class="bus-hotspot-number" fill="#fff" text-anchor="middle" dominant-baseline="central">${index+1}</text><title>${escapeHtml(marker.title)} — ${escapeHtml(marker.description)}</title></g>`).join("")}</g>`;
}
function renderBusMap(record){
  const map=collectBusMapData(record);
  if(!(map.views[busCurrentView]||[]).length){
    const firstView=["side","front","rear"].find(view=>(map.views[view]||[]).length);
    if(firstView)busCurrentView=firstView;
  }
  const count=map.allIssues.length;
  const photoCount=Number(record.photoCount ?? (Array.isArray(record.photos)?record.photos.length:0))||0;
  const label=count===1?"1 apontamento":""+count+" apontamentos";
  return `<section class="bus-map-panel" id="busMapPanel">
    <div class="bus-map-heading"><div><span class="bus-map-kicker">INSPEÇÃO VISUAL DO VEÍCULO</span><h2>Mapa de avarias</h2><p>As marcações vermelhas indicam itens registrados como <strong>Não conforme</strong> ou avarias descritas.</p></div><span class="bus-map-count ${count?"has-damage":photoCount?"has-photos":"is-clear"}">${count?label:photoCount?`${photoCount} foto(s) anexada(s)`:"Sem avarias registradas"}</span></div>
    <div class="bus-view-switch no-print" role="group" aria-label="Escolher vista do ônibus">${Object.entries(BUS_VIEW_TITLES).map(([key,title])=>`<button type="button" data-bus-view="${key}" aria-pressed="${key===busCurrentView}"><span class="bus-view-icon">${key==="front"?"⊙":key==="side"?"▰":"▣"}</span>${title}</button>`).join("")}</div>
    <div class="bus-illustration" id="busIllustration">${renderBusSvg(busCurrentView,record,map.views[busCurrentView])}</div>
    <div class="bus-map-legend"><span><i></i> Região com avaria / não conformidade</span><span class="bus-map-prefix">Prefixo <strong>${escapeHtml(record.vehicle||"—")}</strong> · Placa <strong>${escapeHtml(record.plate||"Não informada")}</strong></span></div>
    <div class="bus-selected-info" id="busSelectedInfo" aria-live="polite">${map.views[busCurrentView].length?"Selecione um marcador vermelho para ver o detalhe.":"Nenhuma região marcada nesta vista."}</div>
    ${count?`<div class="bus-issues-list"><h3>Registros identificados</h3><div>${map.allIssues.map((issue,index)=>{const mapped=Object.values(map.views).some(markers=>markers.some(marker=>(marker.keys||[marker.key]).includes(issue.key)));return `<button type="button" class="bus-issue-chip" data-bus-issue="${index}" ${mapped?"":"disabled title=\"Este item não corresponde a uma região externa específica.\""}><span class="bus-issue-index">${String(index+1).padStart(2,"0")}</span><span><strong>${escapeHtml(issue.title)}</strong><small>${escapeHtml(issue.description)}</small></span><span class="bus-issue-arrow">${mapped?"↗":"—"}</span></button>`;}).join("")}</div></div>`:`<div class="bus-clear-note"><span>✓</span><div><strong>${photoCount?"Nenhuma não conformidade foi marcada":"Nenhuma avaria foi marcada"}</strong><small>${photoCount?`${photoCount} foto(s) anexada(s); a posição não é identificada automaticamente.`:"O mapa está disponível para consulta das três vistas do veículo."}</small></div></div>`}
    ${map.unmapped.length?`<div class="bus-unmapped"><strong>Não aparecem na carroceria</strong><p>${map.unmapped.map(issue=>escapeHtml(issue.title)).join(" · ")}. Esses itens também permanecem registrados no checklist, mas não correspondem a uma região externa específica.</p></div>`:""}
    <p class="bus-map-footnote">As marcações indicam a região do componente avaliado e são aproximadas, não coordenadas exatas. Para apontar um local específico, descreva a posição no campo “Descrição de avarias”. As fotos ficam na galeria abaixo e não são posicionadas automaticamente no desenho.</p>
  </section>`;
}
function bindBusMap(record){
  const panel=$("busMapPanel");if(!panel)return;
  const map=collectBusMapData(record),svgHost=$("busIllustration"),info=$("busSelectedInfo");
  function selectView(view,markerIndex=0){
    if(!BUS_VIEW_TITLES[view])return;
    busCurrentView=view;
    panel.querySelectorAll("[data-bus-view]").forEach(button=>button.setAttribute("aria-pressed",String(button.dataset.busView===view)));
    const markers=map.views[view]||[];
    svgHost.innerHTML=renderBusSvg(view,record,markers);
    const markerNodes=svgHost.querySelectorAll("[data-bus-hotspot]");
    const showMarker=index=>{
      const marker=markers[index];if(!marker)return;
      markerNodes.forEach((node,i)=>node.classList.toggle("is-active",i===index));
      info.innerHTML=`<span class="bus-selected-dot"></span><div><strong>${escapeHtml(marker.title)}</strong><p>${escapeHtml(marker.description)}</p>${marker.approximate?"<small>Localização aproximada a partir da descrição livre.</small>":""}</div>`;
    };
    markerNodes.forEach((node,index)=>{
      node.addEventListener("click",()=>showMarker(index));
      node.addEventListener("keydown",event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();showMarker(index);}});
    });
    if(markers.length)showMarker(Math.max(0,Math.min(markerIndex,markers.length-1)));
    else info.textContent=`Nenhuma região com avaria marcada na vista ${BUS_VIEW_TITLES[view].toLowerCase()}.`;
  }
  panel.querySelectorAll("[data-bus-view]").forEach(button=>button.addEventListener("click",()=>selectView(button.dataset.busView)));
  panel.querySelectorAll("[data-bus-issue]").forEach(button=>button.addEventListener("click",()=>{
    const issue=map.allIssues[Number(button.dataset.busIssue)];if(!issue)return;
    const viewOrder=[busCurrentView,"side","front","rear"];
    const view=viewOrder.find(name=>(map.views[name]||[]).some(marker=>(marker.keys||[marker.key]).includes(issue.key)))||"side";
    const index=(map.views[view]||[]).findIndex(marker=>(marker.keys||[marker.key]).includes(issue.key));
    selectView(view,Math.max(0,index));
    panel.querySelectorAll("[data-bus-issue]").forEach(el=>el.classList.toggle("is-active",el===button));
  }));
  selectView(busCurrentView);
}

function renderDetail(r){
  activeId=String(r.id);
  const hasIssues=issuesFor(r)>0;
  $("detailStatus").className="status-pill "+(hasIssues?"has-issues":(r.status||"complete"));
  $("detailStatus").textContent=hasIssues?"Com Avaria":statusLabel(r);
  const groups=GROUPS.map((g,gi)=>({title:g.title,items:[
    ...g.items.map((name,ii)=>({name,...(r.checks||{})[`g${gi}_${ii}`]})),
    ...(gi===5?OPERATIONAL.map((name,i)=>({name,...(r.checks||{})[`op${i}`]})):[])
  ]}));
  const photoCount=Number(r.photoCount ?? (Array.isArray(r.photos)?r.photos.length:0))||0;
  const photoSection=photoCount>0
    ? `<section class="detail-group"><h3>Fotos anexadas (${photoCount})</h3><div id="detailPhotoArea">${Array.isArray(r.photos)&&r.photos.length?`<div class="detail-photos">${r.photos.map((p,i)=>`<img src="${p.data}" alt="${escapeHtml(p.name||"Foto de avaria "+(i+1))}" data-preview-photo tabindex="0" role="button" aria-label="Ampliar foto ${i+1}">`).join("")}</div>`:'<div class="detail-photo-state">Carregando fotos…</div>'}</div></section>`
    : "";
  $("detailContent").innerHTML=`<div class="detail-hero"><span class="eyebrow" style="color:#a9d6c5">CHECKLIST DE SAÍDA</span><h1>${escapeHtml(r.vehicle||"Veículo")} · ${escapeHtml(r.destination||"Destino")}</h1><p>${escapeHtml(r.driver||"")} · ${r.dateTime?displayDateTime(r.dateTime):"Data não informada"}</p><button id="downloadPdfBtn" class="pdf-button no-print" type="button" aria-label="Baixar PDF" title="Baixar PDF"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11m0 0 4-4m-4 4-4-4M5 17v3h14v-3"/></svg></button></div>${renderBusMap(r)}<div class="detail-grid">${[["Tipo de veículo",r.vehicleType],["Placa",r.plate],["KM inicial",r.odometer],["Origem",r.origin],["Destino",r.destination],["Conferente",r.driver],["Atualizado",r.updatedAt?new Date(r.updatedAt).toLocaleString("pt-BR"):"—"]].map(([k,v])=>`<div class="detail-cell"><small>${k}</small><strong>${escapeHtml(v||"—")}</strong></div>`).join("")}</div>${groups.map(g=>`<section class="detail-group"><h3>${escapeHtml(g.title)}</h3>${g.items.map(it=>`<div class="detail-row"><span>${escapeHtml(it.name)}</span><span style="color:${it.value==="bad"?"#a83232":it.value==="ok"?"#237047":"#879690"}">${it.value==="ok"?"OK":it.value==="bad"?"Não conforme":it.value==="na"?"N/A":"Não avaliado"}${it.note?" · "+escapeHtml(it.note):""}</span></div>`).join("")}</section>`).join("")}<section class="detail-group"><h3>Avarias e observações</h3><div class="detail-row"><span>Descrição</span><span>${escapeHtml(r.damageNotes||"Nenhuma informada")}</span></div><div class="detail-row"><span>Observações</span><span>${escapeHtml(r.generalNotes||"Nenhuma")}</span></div></section>${photoSection}`;
  bindBusMap(r);
  bindPhotoPreviews($("detailContent"));
  const pdfBtn=$("downloadPdfBtn");
  if(pdfBtn)pdfBtn.onclick=()=>{document.body.classList.add("printing-report");window.print();setTimeout(()=>document.body.classList.remove("printing-report"),1500);};
}

async function apiRequest(payload){
  const response = await fetch(API_URL,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify(payload),redirect:"follow",cache:"no-store"});
  if(!response.ok) throw new Error("Não foi possível comunicar com o Apps Script (HTTP "+response.status+").");
  const data = await response.json();
  if(data && data.ok===false) throw new Error(data.error||"A solicitação não foi concluída.");
  return data;
}
async function fetchManagerRecords(){
  let response=await apiRequest({action:"listMeta"});
  const incoming=Array.isArray(response.records)?response.records:[];
  // Compatibilidade com Apps Script ainda não atualizado: o endpoint antigo não traz os campos dos cards.
  if(incoming.length&& !Object.prototype.hasOwnProperty.call(incoming[0],"vehicle")){
    console.warn("A API ainda usa metadados antigos. Atualize o Code.gs para acelerar a Gerência.");
    response=await apiRequest({action:"list"});
  }
  return Array.isArray(response.records)?response.records:[];
}
function mergeRecords(incoming){
  records=(Array.isArray(incoming)?incoming:[]).map(record=>({...record,photoCount:Number.isFinite(Number(record.photoCount))?Number(record.photoCount):(record.photos||[]).length,photos:[]}));
  records.sort((a,b)=>(b.updatedAt||"").localeCompare(a.updatedAt||""));
  if(!$("appView").hidden)renderHistory();
}
async function loadCloudRecords({notify=false}={}){
  if(cloudLoading)return;
  if(!navigator.onLine){historyHasLoaded=true;renderHistory();toast("Sem conexão. A consulta depende dos registros na nuvem.");return;}
  cloudLoading=true;
  const refreshButton=$("refreshListBtn");
  if(refreshButton){refreshButton.disabled=true;refreshButton.textContent="Atualizando…";}
  try{
    const incoming=await fetchManagerRecords();
    mergeRecords(incoming);
    historyHasLoaded=true;
    if(notify&&!$("appView").hidden)toast("Lista atualizada com os registros da nuvem.");
  }catch(err){
    historyHasLoaded=true;
    console.error("Falha ao carregar checklists da nuvem:",err);
    toast("Não foi possível carregar os checklists: "+err.message);
  }finally{
    cloudLoading=false;
    if(refreshButton){refreshButton.disabled=false;refreshButton.textContent="Atualizar lista";}
    renderHistory();
  }
}
async function refreshCloudChanges(force=false){
  if(refreshInFlight||cloudLoading||!navigator.onLine)return;
  if($("formView").hidden===false)return;
  refreshInFlight=true;
  try{
    const meta=await fetchManagerRecords();
    const oldById=new Map(records.map(item=>[String(item.id),item]));
    const metaById=new Map(meta.map(item=>[String(item.id),item]));
    const activeStillExists=activeId&&metaById.has(String(activeId));
    const changed=meta.length!==records.length||meta.some(item=>{
      const old=oldById.get(String(item.id));
      return !old||String(old.updatedAt||"")!==String(item.updatedAt||"")||Number(old.photoCount||0)!==Number(item.photoCount||0)||String(old.status||"")!==String(item.status||"");
    });
    records=meta.map(item=>({...item,photoCount:Number(item.photoCount)||0,photos:[]})).sort((a,b)=>(b.updatedAt||"").localeCompare(a.updatedAt||""));
    if(!$("detailView").hidden&&!activeStillExists){showView("appView");toast("Este checklist não está mais disponível.");}
    else if(!$("detailView").hidden&&activeStillExists){
      const before=oldById.get(String(activeId)),after=metaById.get(String(activeId));
      if(!before||String(before.updatedAt||"")!==String(after.updatedAt||"")){
        renderDetail(after);
        if(Number(after.photoCount||0)>0)loadDetailPhotos(String(activeId));
      }
    }
    historyHasLoaded=true;
    if(changed||force){if(!$("appView").hidden)renderHistory();if(changed&&!$("appView").hidden)toast("Lista atualizada com as alterações da equipe.");}
  }catch(err){console.warn("Atualização da lista:",err);}
  finally{refreshInFlight=false;}
}
function startRealtimeSync(){
  if(realtimeTimer) clearInterval(realtimeTimer);
  realtimeTimer=setInterval(()=>{
    if(document.visibilityState==="visible" && !$("appView").hidden || document.visibilityState==="visible" && !$("detailView").hidden){
      refreshCloudChanges();
    }
  },5000);
}
$("detailBack").onclick=()=>{showView("appView");renderHistory();};

$("finishBtn").onclick=async()=>{if(!await customConfirm("Depois de enviar, este checklist será registrado para consulta da gerência. Confira os dados antes de continuar.","Enviar formulário","Enviar agora"))return;const required=["driver","vehicle","dateTime","odometer","origin","destination"];for(const id of required){if(!$(id).value.trim()){ $(id).focus();toast("Preencha os campos obrigatórios antes de finalizar.");return;}}const missing=document.querySelectorAll('#checklistForm input[type="radio"][value="ok"]').length-document.querySelectorAll('#checklistForm input[type="radio"]:checked').length;if(missing>0&&!await customConfirm(`Ainda há ${missing} item(ns) sem avaliação. Deseja finalizar mesmo assim?`,"Itens sem avaliação","Finalizar mesmo assim"))return;const issues=Object.values(collectChecks()).filter(c=>c.value==="bad").length;if(issues&&!await customConfirm(`Foram marcados ${issues} item(ns) como não conformes. Confirma a finalização e o registro das não conformidades?`,"Itens com pendência","Confirmar envio"))return;const submitted=formData();submitted.status="complete";submitted.completedAt=new Date().toISOString();submitted.updatedAt=new Date().toISOString();const button=$("finishBtn");button.disabled=true;button.innerHTML='<span class="spinner"></span> Enviando formulário…';document.body.classList.add("is-sending");apiRequest({action:"publicSave",record:submitted}).then(()=>{document.body.classList.remove("is-sending");toast("Checklist enviado e registrado na nuvem. Preparando um novo formulário…");const savedDriver=$("driver").value;activeId=null;photos=[];$("checklistForm").reset();fillForm(null);$("driver").value=savedDriver;button.disabled=false;button.innerHTML='Enviar formulário <span>→</span>';window.scrollTo({top:0,behavior:"smooth"});}).catch(err=>{document.body.classList.remove("is-sending");toast("Não foi possível enviar. Verifique a conexão e tente novamente: "+err.message);button.disabled=false;button.innerHTML="Enviar formulário <span>→</span>";});};
$("photoInput").addEventListener("change",e=>{addPhotos(e.target.files);e.target.value="";});
/* Adicionar fotos: no celular pergunta Câmera ou Arquivos; no computador abre direto a escolha de arquivos */
(function(){
  const addBtn=$("addPhotosBtn"),modal=$("photoSourceModal"),camInput=$("photoInputCamera"),fileInput=$("photoInput");
  if(!addBtn||!modal||!camInput||!fileInput)return;
  const isMobile=()=>(window.matchMedia&&window.matchMedia("(pointer: coarse)").matches)||/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent||"");
  const closeSheet=()=>{modal.hidden=true;document.body.classList.remove("photo-source-open");};
  const openSheet=()=>{modal.hidden=false;document.body.classList.add("photo-source-open");$("photoSourceCamera").focus();};
  addBtn.addEventListener("click",()=>{if(isMobile())openSheet();else fileInput.click();});
  $("photoSourceCamera").addEventListener("click",()=>{closeSheet();camInput.click();});
  $("photoSourceFiles").addEventListener("click",()=>{closeSheet();fileInput.click();});
  $("photoSourceCancel").addEventListener("click",closeSheet);
  modal.addEventListener("click",e=>{if(e.target.classList.contains("photo-source-backdrop"))closeSheet();});
  document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!modal.hidden)closeSheet();});
  camInput.addEventListener("change",e=>{addPhotos(e.target.files);e.target.value="";});
})();
if($("plate"))$("plate").addEventListener("input",event=>{event.target.value=event.target.value.toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,8);});
if($("clearFormBtn")) $("clearFormBtn").onclick=clearForm;
if($("refreshListBtn")) $("refreshListBtn").onclick=()=>loadCloudRecords({notify:true});
if($("historySearch"))$("historySearch").addEventListener("input",renderHistory);
$("checklistForm").addEventListener("change",updateProgress);

window.addEventListener("online",async()=>{setConnection();await loadCloudRecords();await refreshCloudChanges(true);});
window.addEventListener("offline",setConnection);
window.addEventListener("focus",()=>{refreshCloudChanges(true);});
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")refreshCloudChanges(true);});
if("serviceWorker" in navigator&&location.protocol.startsWith("http"))navigator.serviceWorker.register("../sw.js").catch(()=>{});
clearLegacyLocalData();setConnection();if(!isEntryRoute)startRealtimeSync();
currentUser={username:"público",name:"Conferente",role:"admin",roleLabel:"Consulta pública"};
if(isEntryRoute){
  $("appView").hidden=true;
  fillForm(null);
  showView("formView");
  document.querySelector(".form-heading .eyebrow").textContent=formType.toUpperCase();
  $("formTitle").textContent="Novo formulário";
}else{
  showView("appView");
  records=[];
  historyHasLoaded=false;
  renderHistory();
  loadCloudRecords();
}
