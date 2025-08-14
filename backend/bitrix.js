// backend/bitrix.js
const dotenv = require('dotenv');
dotenv.config();

const BASE = process.env.BITRIX_WEBHOOK_URL?.trim();
if (!BASE) {
  console.warn('⚠️  BITRIX_WEBHOOK_URL не задан — интеграция с Bitrix24 отключена');
}

// --- утилиты -------------------------------------------------
function normalizeFieldCode(code) {
  if (!code) return null;
  const s = String(code);
  // Принимаем UF_CRM_123… или {UfCrm123…}
  const m1 = s.match(/UF_CRM_\d+/i);
  if (m1) return m1[0].toUpperCase();
  const m2 = s.match(/UfCrm(\d+)/i);
  if (m2) return `UF_CRM_${m2[1]}`;
  return s.toUpperCase();
}

async function call(method, params = {}) {
  if (!BASE) throw new Error('BITRIX_WEBHOOK_URL is not set');
  const url = new URL(`${BASE}${method}.json`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const resp = await fetch(url, { method: 'GET' });
  const json = await resp.json();
  if (!resp.ok || json.error) {
    const msg = json.error_description || json.error || `HTTP ${resp.status}`;
    throw new Error(`Bitrix24 ${method} failed: ${msg}`);
  }
  return json.result;
}

async function safeCall(method, params = {}) { try { return await call(method, params); } catch { return null; } }

// --- базовые методы ------------------------------------------
async function getDeal(dealId)         { return call('crm.deal.get',     { ID: dealId }); }
async function getContact(contactId)   { return call('crm.contact.get',  { ID: contactId }); }
async function getCompany(companyId)   { return call('crm.company.get',  { ID: companyId }); }

// --- воронки (категории) — как раньше, оставляем как запасной вариант ----
let cacheAt = 0, catsLegacy = null, catsUniversal = null;
const fresh = () => (Date.now() - cacheAt) < 10 * 60 * 1000;
const normName = (o) => o?.NAME || o?.name || null;
const normId   = (o) => o?.ID ?? o?.id ?? null;

async function loadLegacyList() {
  const res = await safeCall('crm.dealcategory.list', {});
  if (!Array.isArray(res)) return null;
  const dict = {}; res.forEach(c => { const id = String(normId(c)); if (id) dict[id] = normName(c) || null; });
  return dict;
}
async function loadUniversalList() {
  const res = await safeCall('crm.category.list', { entityTypeId: 2 }); // 2 = сделки
  const arr = Array.isArray(res?.categories) ? res.categories : Array.isArray(res) ? res : [];
  const dict = {}; arr.forEach(c => { const id = String(normId(c)); if (id) dict[id] = normName(c) || null; });
  return dict;
}
async function getByIdLegacy(id)    { const r = await safeCall('crm.dealcategory.get', { ID: id }); return normName(r) || null; }
async function getByIdUniversal(id) { const r = await safeCall('crm.category.get',     { entityTypeId: 2, id }); return normName(r) || null; }

async function getCategoryName(categoryId) {
  if (categoryId === undefined || categoryId === null) return null;
  const key = String(categoryId);
  if (!fresh()) { catsLegacy = await loadLegacyList(); catsUniversal = await loadUniversalList(); cacheAt = Date.now(); }
  if (catsLegacy && catsLegacy[key]) return catsLegacy[key];
  if (catsUniversal && catsUniversal[key]) return catsUniversal[key];
  const n1 = await getByIdLegacy(categoryId);    if (n1) return n1;
  const n2 = await getByIdUniversal(categoryId); if (n2) return n2;
  if (key === '0') return 'Общее';
  return null;
}

// --- чтение КАСТОМНОГО поля сделки (например UF_CRM_1674450284) ----------
const DEAL_PROJECT_FIELD = normalizeFieldCode(process.env.BITRIX_DEAL_PROJECT_FIELD);

async function getDealProjectNameFromUserField(deal) {
  if (!DEAL_PROJECT_FIELD) return null;

  // 1) берём сырое значение из сделки
  let raw = deal?.[DEAL_PROJECT_FIELD];
  if (raw === undefined || raw === null || raw === '') return null;
  if (Array.isArray(raw)) raw = raw[0];

  // Если там уже текст — используем как имя
  if (typeof raw === 'string' && raw.trim() && !/^\d+$/.test(raw.trim())) {
    return raw.trim();
  }

  // 2) пробуем сопоставить с ENUM списком этого поля
  //    crm.deal.userfield.list поддерживает фильтр по коду поля через filter[FIELD_NAME]
  const list = await safeCall('crm.deal.userfield.list', { 'filter[FIELD_NAME]': DEAL_PROJECT_FIELD });
  const field = Array.isArray(list) ? list.find(f => String(f.FIELD_NAME).toUpperCase() === DEAL_PROJECT_FIELD) : null;
  const enums = field?.LIST || field?.ENUM || field?.list || [];
  const rawStr = String(raw);
  const item = (Array.isArray(enums) ? enums : []).find(e => String(e.ID) === rawStr || String(e.VALUE) === rawStr);
  if (item?.VALUE) return String(item.VALUE);

  // 3) иначе — как есть (числовой код)
  return String(rawStr);
}

module.exports = {
  ready: !!BASE,
  getDeal, getContact, getCompany,
  getCategoryName,
  getDealProjectNameFromUserField,
};
