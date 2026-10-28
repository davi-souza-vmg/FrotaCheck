/* FrotaCheck — interface com rascunhos locais e sincronização via Google Apps Script. */
const STORAGE_KEY = "frotacheck.records.v1";
const SESSION_KEY = "frotacheck.session.v2";
const DRAFT_KEY = "frotacheck.draft.v1";
let draftSaveTimer = null;
const API_URL = "https://script.google.com/macros/s/AKfycbzZG4ax6WY_8tDxZpjcz_cvRpEoNLMLSPpPX0EywDqAsj_dni5O0UKgNjTtcqsXTuyATQ/exec";
let authToken = null;
let syncQueue = Promise.resolve();
let refreshInFlight = false;
let realtimeTimer = null;
const GROUPS = [
  {title:"Externo (visual geral)",items:["Sem avarias visíveis na lataria","Retrovisores em boas condições","Vidros e para-brisa íntegros","Sem vazamento no chão","Portas funcionando"]},
  {title:"Pneus",items:["Pneus calibrados e sem danos","Rodas firmes","Estepe em boas condições"]},
  {title:"Luzes",items:["Farol alto/baixo","Setas e pisca-alerta","Luz de freio","Lanternas"]},
  {title:"Segurança",items:["Freios funcionando","Freio de mão funcionando","Extintor válido","Cintos de segurança","Saídas de emergência"]},
  {title:"Funcionamento",items:["Sem luz de alerta no painel","Buzina funcionando","Ar-condicionado/ventilação","Sem ruídos anormais"]},
  {title:"Operacional",items:["Combustível suficiente","Documentação no veículo","Limpeza básica do veículo"]}
];
const OPERATIONAL = [
  "Porta de embarque possui chave?","Tranca da porta está funcionando?","Possui chave da tampa do tanque?","Tanque de combustível está cheio?","Condições dos pneus estão boas?","Tanque do ARLA está cheio?","Possui chave do tanque do ARLA?","Veículo possui estepe?","Veículo possui macaco?","Veículo possui chave de roda?","Veículo possui triângulo?","Tacógrafo está funcionando?","Tranca do bagageiro do estepe?","Filtro de combustível em dia?","Filtro de ar em bom estado?","Placa do veículo está legível?","Rastreadores presentes/funcionando?"
];
let records = [];
let activeId = null;
let photos = [];
let currentUser = null;
const $ = id => document.getElementById(id);
const views = ["appView","formView","detailView"];
const routePath = decodeURIComponent(location.pathname).replace(/\/+$/, "").toLowerCase();
const formType = routePath.endsWith("/conferencia") ? "Conferência" : "Checklist";
const isEntryRoute = routePath.endsWith("/checklist") || routePath.endsWith("/conferencia");
function showView(id){views.forEach(v=>$(v).hidden=v!==id);window.scrollTo({top:0,behavior:"smooth"});}
function uid(){return "chk_"+Date.now().toString(36)+"_"+Math.random().toString(36).slice(2,8);}
function nowLocal(){const d=new Date();d.setMinutes(d.getMinutes()-d.getTimezoneOffset());return d.toISOString().slice(0,16);}
function displayDateTime(value){if(!value)return "Sem data";const raw=String(value);const d=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)?new Date(raw):new Date(raw);return Number.isNaN(d.getTime())?"Sem data":d.toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"});}
function escapeHtml(s=""){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function loadRecords(){try{records=JSON.parse(localStorage.getItem(STORAGE_KEY)||"[]");}catch{records=[];}}
function persist(){localStorage.setItem(STORAGE_KEY,JSON.stringify(records));if($("lastSaved")) $("lastSaved").textContent="Salvo neste aparelho às "+new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"});}
function customConfirm(message,title="Confirmar ação",confirmLabel="Confirmar") { return new Promise(resolve=>{const modal=$("actionConfirmModal");if(!modal){resolve(window.confirm(message));return;}$("actionConfirmTitle").textContent=title;$("actionConfirmMessage").textContent=message;$("actionConfirmYes").textContent=confirmLabel;modal.hidden=false;const finish=value=>{modal.hidden=true;$("actionConfirmYes").onclick=null;$("actionConfirmCancel").onclick=null;resolve(value);};$("actionConfirmYes").onclick=()=>finish(true);$("actionConfirmCancel").onclick=()=>finish(false);});}
function toast(msg){const t=$("toast");t.textContent=msg;t.classList.add("show");clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.classList.remove("show"),2600);}
function setConnection(){const online=navigator.onLine;$("offlineBanner").hidden=online;$("connectionState").classList.toggle("offline",!online);$("connectionState").innerHTML=`<i></i>${online?"Online":"Offline"}`;}
function statusLabel(r){return r.status==="complete"?"Finalizado":r.status==="pending"?"Pendente de envio":"Rascunho";}
function makeChoices(name,value=""){return `<div class="item-options">${[["ok","OK"],["bad","Não OK"],["na","N/A"]].map(([v,label])=>`<label class="choice ${v==="bad"?"bad":""}"><input type="radio" name="${name}" value="${v}" ${value===v?"checked":""}><span>${label}</span></label>`).join("")}</div>`;}
function renderCheckSections(data={}){
  $("checklistSections").innerHTML=`<div class="check-groups">${GROUPS.map((g,gi)=>`<section class="check-group"><div class="group-head">${String(gi+1).padStart(2,"0")} · ${g.title}</div><div class="item-list">${g.items.map((item,ii)=>{const key=`g${gi}_${ii}`,v=data.checks?.[key]||{};return `<div class="check-item"><div class="item-name">${item}</div>${makeChoices(key,v.value)}<div class="item-note"><input data-note="${key}" value="${escapeHtml(v.note||"")}" placeholder="Observação (opcional)"></div></div>`}).join("")}</div></section>`).join("")}</div>`;
  $("operationalItems").innerHTML=OPERATIONAL.map((item,i)=>{const key=`op${i}`,v=data.checks?.[key]||{};return `<div class="check-item"><div class="item-name">${item}</div>${makeChoices(key,v.value)}<div class="item-note"><input data-note="${key}" value="${escapeHtml(v.note||"")}" placeholder="${i===4?"Ex.: serão trocados": "Observação (opcional)"}"></div></div>`}).join("");
  document.querySelectorAll('#checklistForm input[type="radio"]').forEach(el=>el.addEventListener("change",updateProgress));
}
function collectChecks(){const checks={};document.querySelectorAll('#checklistForm input[type="radio"]:checked').forEach(el=>{checks[el.name]??={};checks[el.name].value=el.value;});document.querySelectorAll('#checklistForm [data-note]').forEach(el=>{const key=el.dataset.note;checks[key]??={};checks[key].note=el.value;});return checks;}
function completedCount(){const checked=document.querySelectorAll('#checklistForm input[type="radio"]:checked').length;const total=document.querySelectorAll('#checklistForm input[type="radio"][value="ok"]').length;return {checked,total};}
function updateProgress(){const {checked,total}=completedCount();const pct=total?Math.round(checked/total*100):0;$("progressBar").style.width=pct+"%";$("progressText").textContent=pct+"% dos itens avaliados";}
function formData(){const existing=records.find(x=>x.id===(activeId||""));return {id:activeId||uid(),owner:existing?.owner||"público",formType,driver:$("driver").value,vehicle:$("vehicle").value,vehicleType:$("vehicleType").value,dateTime:$("dateTime").value,odometer:$("odometer").value,origin:$("origin").value,destination:$("destination").value,checks:collectChecks(),damageNotes:$("damageNotes").value,generalNotes:$("generalNotes").value,photos:photos.map(p=>({name:p.name,data:p.data,type:p.type})),status:"draft",updatedAt:new Date().toISOString()};}
function fillForm(r){
  if(r){ openDetail(r.id); return; }
  activeId=null;photos=(r?.photos||[]).slice();
  $("formTitle").textContent="Novo formulário · "+formType;
  $("dateTime").value=r?.dateTime||nowLocal();$("driver").value=r?.driver||"";$("vehicle").value=r?.vehicle||"";$("vehicleType").value=r?.vehicleType||"Ônibus";$("odometer").value=r?.odometer||"";$("origin").value=r?.origin||"";$("destination").value=r?.destination||"";$("damageNotes").value=r?.damageNotes||"";$("generalNotes").value=r?.generalNotes||"";
  renderCheckSections(r||{});renderPhotos();updateProgress();if($("saveState")) $("saveState").textContent="";showView("formView");
}
function renderPhotos(){$("photoGallery").innerHTML=photos.map((p,i)=>`<div class="photo-card"><img src="${p.data}" alt="${escapeHtml(p.name||"Foto de avaria "+(i+1))}" data-preview-photo tabindex="0" role="button" aria-label="Ampliar foto ${i+1}"><button type="button" aria-label="Remover foto" data-remove-photo="${i}">×</button></div>`).join("");document.querySelectorAll("[data-remove-photo]").forEach(b=>b.onclick=()=>{photos.splice(Number(b.dataset.removePhoto),1);renderPhotos();autoSaveDraft();});bindPhotoPreviews($("photoGallery"));}
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
async function addPhotos(filesList){for(const file of Array.from(filesList)){if(!file.type.startsWith("image/"))continue;try{const data=await compressImage(file);photos.push({name:file.name||"avaria.jpg",type:"image/jpeg",data});}catch{toast("Não foi possível carregar uma das fotos.");}}renderPhotos();autoSaveDraft();}
function compressImage(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=reject;reader.onload=()=>{const img=new Image();img.onerror=reject;img.onload=()=>{const max=1400,scale=Math.min(1,max/Math.max(img.width,img.height)),canvas=document.createElement("canvas");canvas.width=Math.round(img.width*scale);canvas.height=Math.round(img.height*scale);canvas.getContext("2d").drawImage(img,0,0,canvas.width,canvas.height);resolve(canvas.toDataURL("image/jpeg",.76));};img.src=reader.result;};reader.readAsDataURL(file);});}
function saveRecord(status){const r=formData();r.status=status;r.updatedAt=new Date().toISOString();if(status==="complete")r.completedAt=new Date().toISOString();const i=records.findIndex(x=>x.id===r.id);if(i>=0)records[i]=r;else records.unshift(r);activeId=r.id;persist();renderHistory();$("saveState").textContent=status==="complete"?"Finalizado neste aparelho":"Rascunho salvo neste aparelho";toast(navigator.onLine?"Salvo neste aparelho; sincronizando…":"Salvo neste aparelho. Será sincronizado quando houver conexão.");r.cloudSynced=false;const savedIndex=records.findIndex(x=>x.id===r.id);if(savedIndex>=0)records[savedIndex].cloudSynced=false;persist();if(navigator.onLine)syncRecord(r);return r;}
function autoSaveDraft(){
  if($("formView").hidden || isEntryRoute===false) return;
  clearTimeout(draftSaveTimer);
  draftSaveTimer=setTimeout(()=>{try{const r=formData();r.status="draft";r.id="local-draft-"+formType.toLowerCase();localStorage.setItem(DRAFT_KEY+":"+formType.toLowerCase(),JSON.stringify(r));}catch(e){console.warn("Não foi possível salvar o rascunho local",e);}},150);
}
function clearLocalDraft(){try{localStorage.removeItem(DRAFT_KEY+":"+formType.toLowerCase());}catch{}}
async function clearForm(){if(!await customConfirm("Isso vai apagar todos os campos preenchidos e excluir o rascunho salvo neste aparelho. Esta ação não pode ser desfeita.","Limpar formulário","Limpar tudo"))return;const driver=$("driver").value;clearLocalDraft();activeId=null;photos=[];$("checklistForm").reset();fillForm(null);$("driver").value=driver;renderPhotos();toast("Formulário e rascunho limpos.");}
function canViewRecord(r){ return true; }
function renderHistory(){
  const query=$("historySearch").value.trim().toLowerCase(),filter=$("historyFilter").value;
  const visible=records.filter(canViewRecord);
  const mine=visible.filter(r=>r.owner===(currentUser?.username||""));
  const issuesFor=r=>Object.values(r.checks||{}).filter(c=>c.value==="bad").length;
  const withIssues=visible.filter(r=>issuesFor(r)>0), good=visible.filter(r=>r.status==="complete"&&issuesFor(r)===0);
  $("statTotal").textContent=good.length;$("statDrafts").textContent=withIssues.length;$("statIssues").textContent=visible.length;
  const statCards=document.querySelectorAll(".stats-grid .stat-card"); if(statCards.length===3){statCards[0].querySelector("span").textContent="Tudo certo";statCards[0].querySelector("small").textContent="Finalizados sem pendências · clique para filtrar";statCards[1].querySelector("span").textContent="Com pendências";statCards[1].querySelector("small").textContent="Itens marcados como NÃO OK · clique para filtrar";statCards[2].querySelector("span").textContent="Total de checklists";statCards[2].querySelector("small").textContent="Todos os registros recebidos";}
  const list=visible.filter(r=>(filter==="all"||(filter==="draft"&&r.status==="complete"&&issuesFor(r)===0)||(filter==="pending"&&issuesFor(r)>0)||(filter==="complete"&&r.status==="complete"))&&(`${r.vehicle} ${r.destination} ${r.origin} ${r.driver}`.toLowerCase().includes(query))).sort((a,b)=>(b.updatedAt||"").localeCompare(a.updatedAt||""));
  const allMode=true;
  document.querySelector(".content-heading h2").textContent=allMode?"Todos os checklists":"Meus checklists";
  document.querySelector(".content-heading .muted").textContent=allMode?"Consulte os registros de toda a frota. A lista se atualiza automaticamente.":"Registros criados por você. A lista se atualiza automaticamente.";
  document.querySelector(".stats-grid .stat-card:first-child span").textContent="Sem pendências";
  document.querySelector(".stats-grid .stat-card:first-child small").textContent="Finalizados sem pendências · clique para filtrar";
  $("historyList").innerHTML=list.map(r=>`<article class="history-card"><div class="vehicle-icon">▣</div><div class="history-main"><strong>${escapeHtml(r.formType||"Checklist")} · ${escapeHtml(r.vehicle||"Veículo sem prefixo")} · ${escapeHtml(r.destination||"Destino não informado")}</strong><p>${escapeHtml(r.driver||"Motorista")} · ${escapeHtml(r.origin||"Origem não informada")} → ${escapeHtml(r.destination||"")}</p></div><div class="history-meta"><span class="status-pill ${r.status}">${statusLabel(r)}</span><small>${displayDateTime(r.dateTime)} · ${Number.isFinite(r.photoCount)?r.photoCount:(r.photos||[]).length} foto(s)</small></div><div class="card-actions"><button class="mini-btn" data-open="${escapeHtml(r.id)}">Abrir</button></div></article>`).join("");
  $("emptyHistory").hidden=list.length>0;$("historyList").hidden=list.length===0;
  document.querySelectorAll("[data-open]").forEach(b=>b.onclick=()=>openDetail(b.dataset.open));
}

function openDetail(id){const r=records.find(x=>x.id===id);if(!r)return;activeId=id;$("detailStatus").className="status-pill "+r.status;$("detailStatus").textContent=statusLabel(r);
  const groups=GROUPS.map((g,gi)=>({title:g.title,items:g.items.map((name,ii)=>({name,...(r.checks||{})[`g${gi}_${ii}`]}))}));
  groups.push({title:"Itens operacionais",items:OPERATIONAL.map((name,i)=>({name,...(r.checks||{})[`op${i}`]}))});
  $("detailContent").innerHTML=`<div class="detail-hero"><span class="eyebrow" style="color:#a9d6c5">CHECKLIST DE SAÍDA</span><h1>${escapeHtml(r.vehicle||"Veículo")} · ${escapeHtml(r.destination||"Destino")}</h1><p>${escapeHtml(r.driver||"")} · ${r.dateTime?displayDateTime(r.dateTime):"Data não informada"}</p><button id="downloadPdfBtn" class="pdf-button no-print" type="button" aria-label="Baixar PDF" title="Baixar PDF"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11m0 0 4-4m-4 4-4-4M5 17v3h14v-3"/></svg></button></div><div class="detail-grid">${[["Tipo de veículo",r.vehicleType],["KM inicial",r.odometer],["Origem",r.origin],["Destino",r.destination],["Conferente",r.driver],["Atualizado",r.updatedAt?new Date(r.updatedAt).toLocaleString("pt-BR"):"—"]].map(([k,v])=>`<div class="detail-cell"><small>${k}</small><strong>${escapeHtml(v||"—")}</strong></div>`).join("")}</div>${groups.map(g=>`<section class="detail-group"><h3>${g.title}</h3>${g.items.map(it=>`<div class="detail-row"><span>${escapeHtml(it.name)}</span><span style="color:${it.value==="bad"?"#a83232":it.value==="ok"?"#237047":"#879690"}">${it.value==="ok"?"OK":it.value==="bad"?"NÃO OK":it.value==="na"?"N/A":"Não avaliado"}${it.note?" · "+escapeHtml(it.note):""}</span></div>`).join("")}</section>`).join("")}<section class="detail-group"><h3>Avarias e observações</h3><div class="detail-row"><span>Descrição</span><span>${escapeHtml(r.damageNotes||"Nenhuma informada")}</span></div><div class="detail-row"><span>Observações</span><span>${escapeHtml(r.generalNotes||"Nenhuma")}</span></div>${r.photos?.length?`<div class="detail-photos">${r.photos.map((p,i)=>`<img src="${p.data}" alt="${escapeHtml(p.name||"Foto de avaria "+(i+1))}" data-preview-photo tabindex="0" role="button" aria-label="Ampliar foto ${i+1}">`).join("")}</div>`:""}</section>`;
  bindPhotoPreviews($("detailContent"));
  const pdfBtn=$("downloadPdfBtn"); if(pdfBtn) pdfBtn.onclick=()=>{document.body.classList.add("printing-report");window.print();setTimeout(()=>document.body.classList.remove("printing-report"),1500);};
  showView("detailView");
}
async function apiRequest(payload){
  const response = await fetch(API_URL,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify(payload),redirect:"follow"});
  if(!response.ok) throw new Error("Não foi possível comunicar com o Apps Script (HTTP "+response.status+").");
  const data = await response.json();
  if(data && data.ok===false) throw new Error(data.error||"A solicitação não foi concluída.");
  return data;
}
function mergeRecords(incoming){
  const previous = new Map(records.map(r=>[String(r.id),r]));
  const next = new Map();
  (incoming||[]).forEach(cloud=>{
    const id=String(cloud.id), local=previous.get(id);
    if(local && local.cloudSynced===false && (local.updatedAt||"")>(cloud.updatedAt||"")){
      next.set(id,local);
    }else{
      cloud.cloudSynced=true;
      cloud.photoCount=Number.isFinite(cloud.photoCount)?cloud.photoCount:(cloud.photos||[]).length;
      next.set(id,cloud);
    }
  });
  // Preserve only genuinely local, unsynchronized drafts. Records already on the server
  // are authoritative, so deleted records disappear from every device.
  previous.forEach((local,id)=>{
    if(!next.has(id) && local.cloudSynced===false && local.owner===currentUser?.username) next.set(id,local);
  });
  records=Array.from(next.values()).sort((a,b)=>(b.updatedAt||"").localeCompare(a.updatedAt||""));
  persist();
  if(!$("appView").hidden) renderHistory();
}
async function syncPendingRecords(){
  if(!navigator.onLine)return;
  const pending=records.filter(r=>r.cloudSynced===false).sort((a,b)=>(a.updatedAt||"").localeCompare(b.updatedAt||""));
  for(const record of pending) await syncRecord(record);
}
async function loadCloudRecords(){
  if(!navigator.onLine)return;
  try{
    const data=await apiRequest({action:"list"});
    mergeRecords(data.records||[]);
    if(!$("appView").hidden) toast("Dados sincronizados com a nuvem.");
  }catch(err){toast("Não foi possível sincronizar: "+err.message);}
}
async function refreshCloudChanges(force=false){
  if(refreshInFlight||!navigator.onLine)return;
  if(!$("formView").hidden)return; // Never overwrite a form while someone is editing it.
  refreshInFlight=true;
  try{
    const data=await apiRequest({action:"listMeta"});
    const meta=Array.isArray(data.records)?data.records:[];
    const metaById=new Map(meta.map(r=>[String(r.id),r]));
    const localById=new Map(records.map(r=>[String(r.id),r]));
    let changed=false;
    // Remove cloud records that no longer exist, while preserving local unsent drafts.
    const countBeforeFilter=records.length;
    records=records.filter(r=>metaById.has(String(r.id)) || (r.cloudSynced===false && r.owner===currentUser?.username));
    if(records.length!==countBeforeFilter) changed=true;
    if(!$("detailView").hidden && !metaById.has(String(activeId))){
      showView("appView");
      toast("Este checklist foi removido por outro administrador.");
    }
    for(const m of meta){
      const local=localById.get(String(m.id));
      const differs=!local ||
        String(local.updatedAt||"")!==String(m.updatedAt||"") ||
        Number(local.photoCount ?? (local.photos||[]).length)!==Number(m.photoCount||0) ||
        String(local.status||"")!==String(m.status||"");
      if(!differs) continue;
      if(local && local.cloudSynced===false && (local.updatedAt||"")>(m.updatedAt||"")) continue;
      const full=await apiRequest({action:"get",id:m.id});
      if(full.record){
        full.record.cloudSynced=true;
        full.record.photoCount=Number.isFinite(full.record.photoCount)?full.record.photoCount:(full.record.photos||[]).length;
        const idx=records.findIndex(r=>String(r.id)===String(m.id));
        if(idx>=0) records[idx]=full.record; else records.push(full.record);
        changed=true;
      }
    }
    records.sort((a,b)=>(b.updatedAt||"").localeCompare(a.updatedAt||""));
    if(changed || force){
      persist();
      if(!$("appView").hidden) renderHistory();
      if(changed && !$("appView").hidden) toast("Checklist atualizado com as alterações da equipe.");
    }
  }catch(err){
    console.warn("Sincronização automática:",err);
  }finally{refreshInFlight=false;}
}
function startRealtimeSync(){
  if(realtimeTimer) clearInterval(realtimeTimer);
  realtimeTimer=setInterval(()=>{
    if(document.visibilityState==="visible" && !$("appView").hidden || document.visibilityState==="visible" && !$("detailView").hidden){
      refreshCloudChanges();
    }
  },5000);
}
function syncRecord(record){
  if(!navigator.onLine)return Promise.resolve();
  syncQueue=syncQueue.then(()=>syncRecordNow(record)).catch(err=>{console.error("Fila de sincronização:",err);});
  return syncQueue;
}
async function syncRecordNow(record){
  if(!navigator.onLine)return;
  try{
    const data=await apiRequest({action:"publicSave",record:record});
    if(data.ok){
      const idx=records.findIndex(r=>r.id===record.id);
      if(idx>=0){
        const current=records[idx];
        if((current.updatedAt||"")<=(record.updatedAt||"")){
          current.status=record.status;
          current.cloudSynced=true;
          current.updatedAt=record.updatedAt;
          current.photoCount=(record.photos||[]).length;
        }else{
          current.cloudSynced=false; // A newer local edit still needs to be sent.
        }
        persist();
      }
      $("saveState").textContent=record.status==="complete"?"Finalizado e sincronizado":"Rascunho sincronizado";
      toast("Checklist sincronizado com a planilha.");
      setTimeout(()=>refreshCloudChanges(true),300);
    }
  }catch(err){
    console.error(err);
    toast("Salvo localmente; sincronização pendente: "+err.message);
  }
}


$("detailBack").onclick=()=>{showView("appView");renderHistory();};

$("finishBtn").onclick=async()=>{if(!await customConfirm("Depois de enviar, este checklist será registrado para consulta da gerência. Confira os dados antes de continuar.","Enviar formulário","Enviar agora"))return;const required=["driver","vehicle","dateTime","odometer","origin","destination"];for(const id of required){if(!$(id).value.trim()){ $(id).focus();toast("Preencha os campos obrigatórios antes de finalizar.");return;}}const missing=document.querySelectorAll('#checklistForm input[type="radio"][value="ok"]').length-document.querySelectorAll('#checklistForm input[type="radio"]:checked').length;if(missing>0&&!await customConfirm(`Ainda há ${missing} item(ns) sem avaliação. Deseja finalizar mesmo assim?`,"Itens sem avaliação","Finalizar mesmo assim"))return;const issues=Object.values(collectChecks()).filter(c=>c.value==="bad").length;if(issues&&!await customConfirm(`Foram marcados ${issues} item(ns) como NÃO OK. Confirma a finalização e o registro das não conformidades?`,"Itens com pendência","Confirmar envio"))return;const submitted=formData();submitted.status="complete";submitted.completedAt=new Date().toISOString();submitted.updatedAt=new Date().toISOString();const button=$("finishBtn");button.disabled=true;button.innerHTML='<span class="spinner"></span> Enviando formulário…';document.body.classList.add("is-sending");apiRequest({action:"publicSave",record:submitted}).then(()=>{document.body.classList.remove("is-sending");toast("Formulário enviado! Preparando um novo formulário…");const savedDriver=$("driver").value;clearLocalDraft();activeId=null;photos=[];$("checklistForm").reset();fillForm(null);$("driver").value=savedDriver;button.disabled=false;button.innerHTML='Enviar formulário <span>→</span>';window.scrollTo({top:0,behavior:"smooth"});}).catch(err=>{document.body.classList.remove("is-sending");toast("Não foi possível enviar: "+err.message);button.disabled=false;button.innerHTML="Enviar formulário <span>→</span>";});};
$("photoInput").addEventListener("change",e=>{addPhotos(e.target.files);e.target.value="";});
if($("clearFormBtn")) $("clearFormBtn").onclick=clearForm;
if($("refreshListBtn")) $("refreshListBtn").onclick=()=>loadCloudRecords();
const statCards=document.querySelectorAll(".stats-grid .stat-card"); if(statCards[0])statCards[0].onclick=()=>{$("historyFilter").value="draft";renderHistory();};if(statCards[1])statCards[1].onclick=()=>{$("historyFilter").value="pending";renderHistory();};if(statCards[2])statCards[2].onclick=()=>{$("historyFilter").value="all";renderHistory();};
$("historySearch").addEventListener("input",renderHistory);$("historyFilter").addEventListener("change",renderHistory);
$("checklistForm").addEventListener("change",()=>{updateProgress();autoSaveDraft();});
$("checklistForm").addEventListener("input",autoSaveDraft);

window.addEventListener("online",async()=>{setConnection();await syncPendingRecords();await loadCloudRecords();await refreshCloudChanges(true);});
window.addEventListener("offline",setConnection);
window.addEventListener("focus",()=>{refreshCloudChanges(true);});
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")refreshCloudChanges(true);});
if("serviceWorker" in navigator&&location.protocol.startsWith("http"))navigator.serviceWorker.register("./sw.js").catch(()=>{});
loadRecords();setConnection();startRealtimeSync();
currentUser={username:"público",name:"Motorista",role:"admin",roleLabel:"Consulta pública"};
if(isEntryRoute){
  $("appView").hidden=true;
  let savedDraft=null;try{savedDraft=JSON.parse(localStorage.getItem(DRAFT_KEY+":"+formType.toLowerCase())||"null");}catch{}
  fillForm(savedDraft);
  document.querySelector(".form-heading .eyebrow").textContent=formType.toUpperCase();
  $("formTitle").textContent="Novo formulário · "+formType;
}else{
  showView("appView");
  renderHistory(); // Mostra imediatamente os últimos registros em cache.
  loadCloudRecords();
}
