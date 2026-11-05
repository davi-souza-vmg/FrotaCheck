/* FrotaCheck — sem rascunhos locais; registros enviados são consultados na nuvem. */
const API_URL = "https://script.google.com/macros/s/AKfycbzZG4ax6WY_8tDxZpjcz_cvRpEoNLMLSPpPX0EywDqAsj_dni5O0UKgNjTtcqsXTuyATQ/exec";
let refreshInFlight = false;
let realtimeTimer = null;
let cloudLoading = false;
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
function makeChoices(name,value=""){return `<div class="item-options" role="group" aria-label="Avaliação">${[["bad","✕","Não OK"],["na","/","Não se aplica"],["ok","✓","OK"]].map(([v,glyph,label])=>`<label class="choice choice-${v} ${value===v?"is-selected":""}" title="${label}" aria-label="${label}"><input type="radio" name="${name}" value="${v}" ${value===v?"checked":""}><span>${glyph}</span></label>`).join("")}</div>`;}
function renderCheckSections(data={}){
  $("checklistSections").innerHTML=`<div class="check-groups">${GROUPS.map((g,gi)=>`<section class="check-group"><div class="group-head">${String(gi+1).padStart(2,"0")} · ${g.title}</div><div class="item-list">${g.items.map((item,ii)=>{const key=`g${gi}_${ii}`,v=data.checks?.[key]||{};return `<div class="check-item"><div class="item-name">${item}</div>${makeChoices(key,v.value)}<div class="item-note"><input data-note="${key}" value="${escapeHtml(v.note||"")}" placeholder="Observação (opcional)"></div></div>`}).join("")}</div></section>`).join("")}</div>`;
  $("operationalItems").innerHTML=OPERATIONAL.map((item,i)=>{const key=`op${i}`,v=data.checks?.[key]||{};return `<div class="check-item"><div class="item-name">${item}</div>${makeChoices(key,v.value)}<div class="item-note"><input data-note="${key}" value="${escapeHtml(v.note||"")}" placeholder="${i===4?"Ex.: serão trocados": "Observação (opcional)"}"></div></div>`}).join("");
  document.querySelectorAll('#checklistForm input[type="radio"]').forEach(el=>el.addEventListener("change",()=>{updateProgress();document.querySelectorAll(`input[name="${el.name}"]`).forEach(r=>r.closest(".choice")?.classList.toggle("is-selected",r.checked));}));
}
function collectChecks(){const checks={};document.querySelectorAll('#checklistForm input[type="radio"]:checked').forEach(el=>{checks[el.name]??={};checks[el.name].value=el.value;});document.querySelectorAll('#checklistForm [data-note]').forEach(el=>{const key=el.dataset.note;checks[key]??={};checks[key].note=el.value;});return checks;}
function completedCount(){const checked=document.querySelectorAll('#checklistForm input[type="radio"]:checked').length;const total=document.querySelectorAll('#checklistForm input[type="radio"][value="ok"]').length;return {checked,total};}
function updateProgress(){const {checked,total}=completedCount();const pct=total?Math.round(checked/total*100):0;$("progressBar").style.width=pct+"%";$("progressText").textContent=pct+"% dos itens avaliados";}
function formData(){return {id:uid(),owner:"público",formType,driver:$("driver").value,vehicle:$("vehicle").value,vehicleType:$("vehicleType").value,dateTime:$("dateTime").value,odometer:$("odometer").value,origin:$("origin").value,destination:$("destination").value,checks:collectChecks(),damageNotes:$("damageNotes").value,generalNotes:$("generalNotes").value,photos:photos.map(p=>({name:p.name,data:p.data,type:p.type})),status:"complete",updatedAt:new Date().toISOString()};}
function fillForm(r){
  if(r){ openDetail(r.id); return; }
  activeId=null;photos=(r?.photos||[]).slice();
  $("formTitle").textContent="Novo formulário · "+formType;
  $("dateTime").value=r?.dateTime||nowLocal();$("driver").value=r?.driver||"";$("vehicle").value=r?.vehicle||"";$("vehicleType").value=r?.vehicleType||"Ônibus";$("odometer").value=r?.odometer||"";$("origin").value=r?.origin||"";$("destination").value=r?.destination||"";$("damageNotes").value=r?.damageNotes||"";$("generalNotes").value=r?.generalNotes||"";
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
  const search=$("historySearch"),filterControl=$("historyFilter"),listEl=$("historyList"),emptyEl=$("emptyHistory");
  if(!listEl||!emptyEl)return;
  const query=(search?.value||"").trim().toLowerCase();
  const filter=filterControl?.value||"all";
  const all=records.slice().sort((a,b)=>(b.updatedAt||"").localeCompare(a.updatedAt||""));
  const clean=all.filter(r=>issuesFor(r)===0);
  const withIssues=all.filter(r=>issuesFor(r)>0);
  if($("statTotal"))$("statTotal").textContent=clean.length;
  if($("statWithIssues"))$("statWithIssues").textContent=withIssues.length;
  if($("statIssues"))$("statIssues").textContent=all.length;
  const statCards=document.querySelectorAll(".stats-grid .stat-card");
  if(statCards.length===3){
    statCards[0].querySelector("span").textContent="Sem pendências";
    statCards[0].querySelector("small").textContent="Finalizados sem itens NÃO OK · clique para filtrar";
    statCards[1].querySelector("span").textContent="Com pendências";
    statCards[1].querySelector("small").textContent="Itens marcados como NÃO OK · clique para filtrar";
    statCards[2].querySelector("span").textContent="Total de checklists";
    statCards[2].querySelector("small").textContent="Registros enviados à nuvem";
  }
  const visible=all.filter(r=>{
    const matchesFilter=filter==="all"||(filter==="clean"&&issuesFor(r)===0)||(filter==="issues"&&issuesFor(r)>0);
    const haystack=[r.formType,r.vehicle,r.destination,r.origin,r.driver].join(" ").toLowerCase();
    return matchesFilter&&haystack.includes(query);
  });
  listEl.innerHTML=visible.map(r=>`<article class="history-card"><div class="vehicle-icon">▣</div><div class="history-main"><strong>${escapeHtml(r.formType||"Checklist")} · ${escapeHtml(r.vehicle||"Veículo sem prefixo")} · ${escapeHtml(r.destination||"Destino não informado")}</strong><p>${escapeHtml(r.driver||"Conferente")} · ${escapeHtml(r.origin||"Origem não informada")} → ${escapeHtml(r.destination||"")}</p></div><div class="history-meta"><span class="status-pill ${escapeHtml(r.status||"complete")}">${issuesFor(r)>0?"Com pendências":"Finalizado"}</span><small>${displayDateTime(r.dateTime)} · ${Number.isFinite(r.photoCount)?r.photoCount:(r.photos||[]).length} foto(s)</small></div><div class="card-actions"><button class="mini-btn" data-open="${escapeHtml(r.id)}" type="button">Abrir</button></div></article>`).join("");
  emptyEl.hidden=visible.length>0;
  listEl.hidden=visible.length===0;
  if(search||filterControl){
    document.querySelectorAll("[data-open]").forEach(button=>button.onclick=()=>openDetail(button.dataset.open));
  }
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
  records=(Array.isArray(incoming)?incoming:[]).map(record=>({...record,photoCount:Number.isFinite(record.photoCount)?record.photoCount:(record.photos||[]).length}));
  records.sort((a,b)=>(b.updatedAt||"").localeCompare(a.updatedAt||""));
  if(!$("appView").hidden)renderHistory();
}
async function loadCloudRecords(){
  if(cloudLoading)return;
  if(!navigator.onLine){renderHistory();toast("Sem conexão. A consulta depende dos registros na nuvem.");return;}
  cloudLoading=true;
  const refreshButton=$("refreshListBtn");
  if(refreshButton){refreshButton.disabled=true;refreshButton.textContent="Atualizando…";}
  try{
    const data=await apiRequest({action:"list"});
    mergeRecords(data.records||[]);
    if(!$("appView").hidden)toast("Lista atualizada com os registros da nuvem.");
  }catch(err){
    console.error("Falha ao carregar checklists da nuvem:",err);
    toast("Não foi possível carregar os checklists: "+err.message);
  }finally{
    cloudLoading=false;
    if(refreshButton){refreshButton.disabled=false;refreshButton.textContent="Atualizar lista";}
  }
}
async function refreshCloudChanges(force=false){
  if(refreshInFlight||cloudLoading||!navigator.onLine)return;
  if($("formView").hidden===false)return;
  refreshInFlight=true;
  try{
    const data=await apiRequest({action:"listMeta"});
    const meta=Array.isArray(data.records)?data.records:[];
    const metaById=new Map(meta.map(item=>[String(item.id),item]));
    const localById=new Map(records.map(item=>[String(item.id),item]));
    let changed=false;
    const filtered=records.filter(record=>metaById.has(String(record.id)));
    if(filtered.length!==records.length){records=filtered;changed=true;}
    if(!$("detailView").hidden&&!metaById.has(String(activeId))){
      showView("appView");
      toast("Este checklist não está mais disponível.");
    }
    for(const metaRecord of meta){
      const id=String(metaRecord.id),local=localById.get(id);
      const differs=!local||String(local.updatedAt||"")!==String(metaRecord.updatedAt||"")||Number(local.photoCount??(local.photos||[]).length)!==Number(metaRecord.photoCount||0)||String(local.status||"")!==String(metaRecord.status||"");
      if(!differs)continue;
      const full=await apiRequest({action:"get",id});
      if(full.record){
        full.record.photoCount=Number.isFinite(full.record.photoCount)?full.record.photoCount:(full.record.photos||[]).length;
        const index=records.findIndex(record=>String(record.id)===id);
        if(index>=0)records[index]=full.record;else records.push(full.record);
        changed=true;
      }
    }
    records.sort((a,b)=>(b.updatedAt||"").localeCompare(a.updatedAt||""));
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

$("finishBtn").onclick=async()=>{if(!await customConfirm("Depois de enviar, este checklist será registrado para consulta da gerência. Confira os dados antes de continuar.","Enviar formulário","Enviar agora"))return;const required=["driver","vehicle","dateTime","odometer","origin","destination"];for(const id of required){if(!$(id).value.trim()){ $(id).focus();toast("Preencha os campos obrigatórios antes de finalizar.");return;}}const missing=document.querySelectorAll('#checklistForm input[type="radio"][value="ok"]').length-document.querySelectorAll('#checklistForm input[type="radio"]:checked').length;if(missing>0&&!await customConfirm(`Ainda há ${missing} item(ns) sem avaliação. Deseja finalizar mesmo assim?`,"Itens sem avaliação","Finalizar mesmo assim"))return;const issues=Object.values(collectChecks()).filter(c=>c.value==="bad").length;if(issues&&!await customConfirm(`Foram marcados ${issues} item(ns) como NÃO OK. Confirma a finalização e o registro das não conformidades?`,"Itens com pendência","Confirmar envio"))return;const submitted=formData();submitted.status="complete";submitted.completedAt=new Date().toISOString();submitted.updatedAt=new Date().toISOString();const button=$("finishBtn");button.disabled=true;button.innerHTML='<span class="spinner"></span> Enviando formulário…';document.body.classList.add("is-sending");apiRequest({action:"publicSave",record:submitted}).then(()=>{document.body.classList.remove("is-sending");toast("Checklist enviado e registrado na nuvem. Preparando um novo formulário…");const savedDriver=$("driver").value;activeId=null;photos=[];$("checklistForm").reset();fillForm(null);$("driver").value=savedDriver;button.disabled=false;button.innerHTML='Enviar formulário <span>→</span>';window.scrollTo({top:0,behavior:"smooth"});}).catch(err=>{document.body.classList.remove("is-sending");toast("Não foi possível enviar. Verifique a conexão e tente novamente: "+err.message);button.disabled=false;button.innerHTML="Enviar formulário <span>→</span>";});};
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
if($("clearFormBtn")) $("clearFormBtn").onclick=clearForm;
if($("refreshListBtn")) $("refreshListBtn").onclick=()=>loadCloudRecords();
const statCards=document.querySelectorAll(".stats-grid .stat-card"); if(statCards[0])statCards[0].onclick=()=>{$("historyFilter").value="clean";renderHistory();};if(statCards[1])statCards[1].onclick=()=>{$("historyFilter").value="issues";renderHistory();};if(statCards[2])statCards[2].onclick=()=>{$("historyFilter").value="all";renderHistory();};
if($("historySearch"))$("historySearch").addEventListener("input",renderHistory);if($("historyFilter"))$("historyFilter").addEventListener("change",renderHistory);
$("checklistForm").addEventListener("change",updateProgress);

window.addEventListener("online",async()=>{setConnection();await loadCloudRecords();await refreshCloudChanges(true);});
window.addEventListener("offline",setConnection);
window.addEventListener("focus",()=>{refreshCloudChanges(true);});
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")refreshCloudChanges(true);});
if("serviceWorker" in navigator&&location.protocol.startsWith("http"))navigator.serviceWorker.register("./sw.js").catch(()=>{});
clearLegacyLocalData();setConnection();if(!isEntryRoute)startRealtimeSync();
currentUser={username:"público",name:"Conferente",role:"admin",roleLabel:"Consulta pública"};
if(isEntryRoute){
  $("appView").hidden=true;
  fillForm(null);
  showView("formView");
  document.querySelector(".form-heading .eyebrow").textContent=formType.toUpperCase();
  $("formTitle").textContent="Novo formulário · "+formType;
}else{
  showView("appView");
  records=[];
  renderHistory();
  loadCloudRecords();
}
