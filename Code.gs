/** FrotaCheck API — Google Apps Script.
 * Configure em Configurações do projeto > Propriedades do script:
 * SPREADSHEET_ID, DRIVE_FOLDER_ID e USERS_JSON.
 * USERS_JSON exemplo: [{"username":"kaltyn","password":"SENHA_FORTE","name":"Kaltyn","active":true}]
 * Não compartilhe este projeto com pessoas que não devam administrar usuários e dados.
 */
const SESSION_TTL_SECONDS = 21600; // 6 horas
const SHEETS = {
  Checklists: ["id","owner","status","dateTime","driver","vehicle","vehicleType","odometer","origin","destination","checksJson","damageNotes","generalNotes","photoIdsJson","updatedAt","completedAt","formType"]
};

function doGet() {
  return json_({ service: "FrotaCheck API", status: "ok", message: "API ativa. Envie solicitações POST autenticadas." });
}

function doPost(e) {
  try {
    const payload = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    const action = String(payload.action || "");
    // API pública conforme solicitado. Leitura pública; gravação somente cria novos registros.
    if (action === "list" || action === "listMeta") {
      const publicUser = { username: "público", role: "admin" };
      return json_({ ok: true, records: action === "list" ? listRecords_(publicUser, true) : listMetadata_(publicUser) });
    }
    if (action === "get") return json_({ ok: true, record: getRecord_({username:"público",role:"admin"}, payload.id) });
    if (action === "publicSave") return json_(publicSave_(payload.record));
    return json_({ ok: false, error: "Ação não reconhecida ou não permitida." });
  } catch (err) {
    return json_({ ok: false, error: err && err.message ? err.message : "Erro interno." });
  }
}

function login_(payload) {
  const username = String(payload.username || "").trim().toLowerCase();
  const password = String(payload.password || "");
  const users = getUsers_();
  const user = users.find(u => String(u.username || "").toLowerCase() === username && u.active !== false);
  if (!user || !constantTimeEqual_(String(user.password || ""), password)) {
    Utilities.sleep(350);
    return { ok: false, error: "Usuário ou senha inválidos." };
  }
  const token = Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, "");
  const role = resolveRole_(user);
  const safeUser = { username: String(user.username).toLowerCase(), name: String(user.name || user.username), role: role, roleLabel: roleLabel_(role) };
  CacheService.getScriptCache().put("sess_" + token, JSON.stringify(safeUser), SESSION_TTL_SECONDS);
  return { ok: true, token: token, user: safeUser, expiresIn: SESSION_TTL_SECONDS };
}

function getUsers_() {
  const raw = PropertiesService.getScriptProperties().getProperty("USERS_JSON");
  if (!raw) throw new Error("Configure a propriedade USERS_JSON nas Propriedades do script.");
  const users = JSON.parse(raw);
  if (!Array.isArray(users)) throw new Error("USERS_JSON precisa ser uma lista JSON de usuários.");
  return users;
}

function requireUser_(token) {
  if (!token) throw new Error("Sessão ausente. Entre novamente.");
  const raw = CacheService.getScriptCache().get("sess_" + token);
  if (!raw) throw new Error("Sua sessão expirou. Entre novamente.");
  return JSON.parse(raw);
}

function resolveRole_(user) {
  const identity = (String(user.username || "") + " " + String(user.name || "")).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  // Regras solicitadas para os usuários principais; outros usuários usam o campo role.
  if (/(^|\s)davi([\s._-]|$)/.test(identity) || identity.startsWith("davi")) return "admin";
  if (identity.includes("katlyn") || identity.includes("kaltyn")) return "operacional";
  const role = String(user.role || "auxiliar").toLowerCase();
  return ["admin", "operacional", "auxiliar"].includes(role) ? role : "auxiliar";
}

function roleLabel_(role) {
  return ({admin:"Administrador", operacional:"Operacional", auxiliar:"Auxiliar"})[role] || "Auxiliar";
}

function isAdmin_(user) { return user && user.role === "admin"; }

function saveRecord_(user, record) {
  if (!record || !record.id) throw new Error("Checklist inválido.");
  const ss = getSpreadsheet_();
  const sh = ensureSheet_(ss, "Checklists", SHEETS.Checklists);
  const last = sh.getLastRow();
  let rowNumber = 0;
  let oldPhotoIds = [];
  let originalOwner = "";
  if (last >= 2) {
    const rows = sh.getRange(2, 1, last - 1, 2).getValues();
    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i][0]) === String(record.id)) {
        rowNumber = i + 2;
        originalOwner = String(rows[i][1] || "");
        throw new Error("Formulários enviados são imutáveis e não podem ser editados.");
      }
    }
  }
  const owner = rowNumber ? originalOwner : String(user.username || "");
  oldPhotoIds.forEach(id => { try { DriveApp.getFileById(id).setTrashed(true); } catch (_) {} });
  const photoIds = [];
  const folder = DriveApp.getFolderById(requiredProperty_("DRIVE_FOLDER_ID"));
  (Array.isArray(record.photos) ? record.photos : []).forEach((photo, index) => {
    const data = String(photo.data || "");
    const match = data.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/);
    if (!match) return;
    const bytes = Utilities.base64Decode(match[2]);
    if (bytes.length > 5 * 1024 * 1024) throw new Error("Cada foto deve ter no máximo 5 MB.");
    const mime = match[1];
    const safeName = String(photo.name || ("foto-" + (index + 1) + ".jpg")).replace(/[\\/:*?"<>|]/g, "_").slice(0, 100);
    const file = folder.createFile(Utilities.newBlob(bytes, mime, safeName));
    file.setDescription("FrotaCheck | checklist=" + record.id + " | owner=" + owner);
    photoIds.push(file.getId());
  });
  const now = new Date().toISOString();
  const values = [String(record.id), owner, String(record.status || "draft"), String(record.dateTime || ""), String(record.driver || ""), String(record.vehicle || ""), String(record.vehicleType || ""), String(record.odometer || ""), String(record.origin || ""), String(record.destination || ""), JSON.stringify(record.checks || {}), String(record.damageNotes || ""), String(record.generalNotes || ""), JSON.stringify(photoIds), String(record.updatedAt || now), String(record.completedAt || ""), String(record.formType || "Checklist")];
  if (rowNumber) sh.getRange(rowNumber, 1, 1, values.length).setValues([values]);
  else sh.appendRow(values);
  return { ok: true, id: record.id, owner: owner, updatedAt: now };
}

function publicSave_(record) {
  if (!record || !record.id) throw new Error("Formulário inválido.");
  const sh = ensureSheet_(getSpreadsheet_(), "Checklists", SHEETS.Checklists);
  const id = String(record.id);
  if (sh.getLastRow() >= 2) {
    const ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getDisplayValues().flat();
    if (ids.includes(id)) throw new Error("Este formulário já foi enviado. Não é permitido editar ou reenviar o mesmo registro.");
  }
  const result = saveRecord_({username:"público", role:"público"}, record);
  return result;
}

function deleteRecord_(user, id) {
  if (!isAdmin_(user)) throw new Error("Somente administradores podem excluir checklists.");
  if (!id) throw new Error("Checklist não informado.");
  const sh = ensureSheet_(getSpreadsheet_(), "Checklists", SHEETS.Checklists);
  if (sh.getLastRow() < 2) throw new Error("Checklist não encontrado.");
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, SHEETS.Checklists.length).getValues();
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0]) === String(id)) {
      let photoIds = [];
      try { photoIds = JSON.parse(rows[i][13] || "[]"); } catch (_) {}
      photoIds.forEach(photoId => { try { DriveApp.getFileById(photoId).setTrashed(true); } catch (_) {} });
      sh.deleteRow(i + 2);
      return { ok: true, id: String(id) };
    }
  }
  throw new Error("Checklist não encontrado.");
}

function listRecords_(user, includePhotos) {
  if (includePhotos === undefined) includePhotos = true;
  const ss = getSpreadsheet_();
  const sh = ensureSheet_(ss, "Checklists", SHEETS.Checklists);
  if (sh.getLastRow() < 2) return [];
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, SHEETS.Checklists.length).getValues();
  return rows.filter(r => canUserViewOwner_(user, r[1])).map(r => rowToRecord_(r, includePhotos))
    .sort((a,b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function listMetadata_(user) {
  const sh = ensureSheet_(getSpreadsheet_(), "Checklists", SHEETS.Checklists);
  if (sh.getLastRow() < 2) return [];
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, SHEETS.Checklists.length).getValues();
  return rows.filter(r => canUserViewOwner_(user, r[1])).map(r => {
    let photoIds = [];
    try { photoIds = JSON.parse(r[13] || "[]"); } catch (_) {}
    return { id:String(r[0]), owner:String(r[1]), status:String(r[2]), updatedAt:String(r[14] || ""), photoCount:photoIds.length };
  }).sort((a,b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function getRecord_(user, id) {
  if (!id) throw new Error("Checklist não informado.");
  const sh = ensureSheet_(getSpreadsheet_(), "Checklists", SHEETS.Checklists);
  if (sh.getLastRow() < 2) throw new Error("Checklist não encontrado.");
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, SHEETS.Checklists.length).getValues();
  const row = rows.find(r => String(r[0]) === String(id));
  if (!row || !canUserViewOwner_(user, row[1])) throw new Error("Checklist não encontrado ou sem permissão.");
  return rowToRecord_(row, true);
}

function canUserViewOwner_(user, owner) {
  return user.role !== "auxiliar" || String(owner) === String(user.username);
}

function rowToRecord_(r, includePhotos) {
  let checks = {}, photoIds = [], photos = [];
  try { checks = JSON.parse(r[10] || "{}"); } catch (_) {}
  try { photoIds = JSON.parse(r[13] || "[]"); } catch (_) {}
  if (includePhotos) {
    photoIds.forEach(id => {
      try {
        const file = DriveApp.getFileById(id);
        const blob = file.getBlob();
        photos.push({ name: file.getName(), type: blob.getContentType(), data: "data:" + blob.getContentType() + ";base64," + Utilities.base64Encode(blob.getBytes()) });
      } catch (_) {}
    });
  }
  return {
    id:String(r[0]), owner:String(r[1]), status:String(r[2]), dateTime:String(r[3] || ""),
    driver:String(r[4] || ""), vehicle:String(r[5] || ""), vehicleType:String(r[6] || ""),
    odometer:String(r[7] || ""), origin:String(r[8] || ""), destination:String(r[9] || ""),
    checks:checks, damageNotes:String(r[11] || ""), generalNotes:String(r[12] || ""),
    photos:photos, photoCount:photoIds.length, updatedAt:String(r[14] || ""), completedAt:String(r[15] || ""), formType:String(r[16] || "Checklist")
  };
}

function getSpreadsheet_() { return SpreadsheetApp.openById(requiredProperty_("SPREADSHEET_ID")); }
function requiredProperty_(key) {
  const value = PropertiesService.getScriptProperties().getProperty(key);
  if (!value) throw new Error("Configure a propriedade " + key + " nas Propriedades do script.");
  return value.trim();
}
function ensureSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) sh.appendRow(headers);
  else if (sh.getLastColumn() < headers.length) {
    const existing = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    sh.getRange(1, 1, 1, headers.length).setValues([[...headers.map((h,i)=>existing[i] || h)]]);
  }
  return sh;
}
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function constantTimeEqual_(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

/** Execute manualmente uma vez para criar a aba Checklists. */
function setupSheets() {
  const ss = getSpreadsheet_();
  ensureSheet_(ss, "Checklists", SHEETS.Checklists);
  return "Aba Checklists pronta.";
}
