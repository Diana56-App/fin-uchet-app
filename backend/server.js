// backend/server.js
// Express-сервер: API + фронт с корня "/" + редиректы Bitrix. API как в ТЗ.
// Добавлено улучшение: /payments/:id/link/bitrix подтягивает deal/company/contact
// и кастомное поле проекта (если задано в .env: BITRIX_DEAL_PROJECT_FIELD).

require('dotenv').config();

const path = require('path');
const fs = require('fs');
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const { Pool } = require('pg');
const axios = require('axios');

const app = express();

// База middlewares
app.set('trust proxy', 1);
app.use(compression());
app.use(morgan('tiny'));
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

const PORT = process.env.PORT || 3001;
const DATABASE_URL = process.env.DATABASE_URL;

const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl: { rejectUnauthorized: false }, // Render Postgres 17
    })
  : null;

// Утилиты для универсальных INSERT/UPDATE
async function getTableColumns(table) {
  const key = `__cols_${table}`;
  if (!pool) return [];
  if (!app.get(key)) {
    const { rows } = await pool.query(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema='public' AND table_name=$1`,
      [table]
    );
    app.set(key, rows.map(r => r.column_name));
  }
  return app.get(key);
}

function buildInsert(table, body, cols) {
  const keys = Object.keys(body).filter(k => cols.includes(k));
  if (keys.length === 0) return null;
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
  const values = keys.map(k => body[k]);
  const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders}) RETURNING *;`;
  return { sql, values };
}

function buildUpdate(table, body, cols, idParamName = 'id', idValue) {
  const keys = Object.keys(body).filter(k => cols.includes(k) && k !== idParamName);
  if (keys.length === 0) return null;
  const set = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  const values = keys.map(k => body[k]);
  values.push(idValue);
  const sql = `UPDATE ${table} SET ${set} WHERE ${idParamName} = $${keys.length + 1} RETURNING *;`;
  return { sql, values };
}

// Тех-маршруты
app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/dbcheck', async (_req, res) => {
  try {
    if (!pool) return res.status(500).json({ ok: false, error: 'No DATABASE_URL' });
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
app.get('/version', (_req, res) => res.json({ version: '0.1.0' }));

// API /payments - как в ТЗ
app.get('/payments', async (_req, res) => {
  try {
    if (!pool) return res.status(500).json({ error: 'DB not configured' });
    const { rows } = await pool.query('SELECT * FROM payments ORDER BY id DESC;');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/payments', async (req, res) => {
  try {
    if (!pool) return res.status(500).json({ error: 'DB not configured' });
    const cols = await getTableColumns('payments');
    const built = buildInsert('payments', req.body, cols);
    if (!built) return res.status(400).json({ error: 'No valid columns in body' });
    const { rows } = await pool.query(built.sql, built.values);
    res.status(201).json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/payments/:id', async (req, res) => {
  try {
    if (!pool) return res.status(500).json({ error: 'DB not configured' });
    const id = req.params.id;
    const cols = await getTableColumns('payments');
    const built = buildUpdate('payments', req.body, cols, 'id', id);
    if (!built) return res.status(400).json({ error: 'No valid columns in body' });
    const { rows } = await pool.query(built.sql, built.values);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/payments/:id', async (req, res) => {
  try {
    if (!pool) return res.status(500).json({ error: 'DB not configured' });
    const id = req.params.id;
    const { rows } = await pool.query('DELETE FROM payments WHERE id = $1 RETURNING *;', [id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true, deleted: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Ручная правка битрикс-полей
app.patch('/payments/:id/link', async (req, res) => {
  try {
    if (!pool) return res.status(500).json({ error: 'DB not configured' });
    const id = req.params.id;
    const cols = await getTableColumns('payments');
    const built = buildUpdate('payments', req.body, cols, 'id', id);
    if (!built) return res.status(400).json({ error: 'No valid columns in body' });
    const { rows } = await pool.query(built.sql, built.values);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Подтяжка из Bitrix (улучшенная)
app.post('/payments/:id/link/bitrix', async (req, res) => {
  const { id } = req.params;
  const { dealId } = req.body || {};
  const hook = process.env.BITRIX_WEBHOOK_URL;
  const projectField = process.env.BITRIX_DEAL_PROJECT_FIELD; // например UF_CRM_XXXX

  try {
    if (!pool) return res.status(500).json({ error: 'DB not configured' });
    if (!hook || !dealId) {
      return res.status(400).json({ error: 'BITRIX_WEBHOOK_URL or dealId missing' });
    }

    // 1) Сделка
    const dealResp = await axios.get(`${hook}/crm.deal.get`, {
      params: { id: dealId },
      timeout: 15000,
    });
    const deal = dealResp?.data?.result || {};

    // 2) Компания
    let companyTitle = '';
    if (deal.COMPANY_ID) {
      try {
        const comp = await axios.get(`${hook}/crm.company.get`, {
          params: { id: deal.COMPANY_ID },
          timeout: 15000,
        });
        companyTitle = comp?.data?.result?.TITLE || '';
      } catch {}
    }

    // 3) Контакт
    let contactTitle = '';
    if (deal.CONTACT_ID) {
      try {
        const cont = await axios.get(`${hook}/crm.contact.get`, {
          params: { id: deal.CONTACT_ID },
          timeout: 15000,
        });
        const c = cont?.data?.result || {};
        contactTitle = [c.LAST_NAME, c.NAME, c.SECOND_NAME].filter(Boolean).join(' ').trim();
      } catch {}
    }

    // 4) Какие поля реально есть в нашей таблице
    const cols = await getTableColumns('payments');

    const patch = {};
    if (cols.includes('bitrix_deal_id')) patch.bitrix_deal_id = dealId;
    if (cols.includes('bitrix_title') && deal.TITLE) patch.bitrix_title = deal.TITLE;
    if (cols.includes('bitrix_stage_id') && deal.STAGE_ID) patch.bitrix_stage_id = deal.STAGE_ID;
    if (cols.includes('bitrix_amount') && deal.OPPORTUNITY) patch.bitrix_amount = deal.OPPORTUNITY;

    // проект из кастомного поля сделки
    if (projectField && cols.includes('project') && deal[projectField]) {
      patch.project = String(deal[projectField]).trim();
    }

    // компания
    if (cols.includes('company_id') && deal.COMPANY_ID) patch.company_id = deal.COMPANY_ID;
    if (cols.includes('company_name') && companyTitle) patch.company_name = companyTitle;

    // контакт
    if (cols.includes('contact_id') && deal.CONTACT_ID) patch.contact_id = deal.CONTACT_ID;
    if (cols.includes('contact_name') && contactTitle) patch.contact_name = contactTitle;

    if (Object.keys(patch).length === 0) {
      // обновлять нечего — вернём сделку, чтобы фронт хотя бы показал "Сделка #id"
      return res.status(200).json({ ok: true, note: 'No matching columns to update', deal });
    }

    const built = buildUpdate('payments', patch, cols, 'id', id);
    const { rows } = await pool.query(built.sql, built.values);
    if (!rows[0]) return res.status(404).json({ error: 'Payment not found' });
    res.json({ ok: true, updated: rows[0], deal });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Раздача фронта: корень "/" + дубликат "/app"
const FRONTEND_DIR = path.join(__dirname, 'frontend');
const INDEX_HTML = path.join(FRONTEND_DIR, 'index.html');

app.use(express.static(FRONTEND_DIR, { index: 'index.html', extensions: ['html'] }));
app.use('/app', express.static(FRONTEND_DIR, { index: 'index.html', extensions: ['html'] }));

// Корень и SPA-фолбэк
app.get('/', (_req, res) => {
  if (fs.existsSync(INDEX_HTML)) return res.sendFile(INDEX_HTML);
  return res.status(500).send('index.html not found in frontend/');
});

// Редиректы Bitrix
app.get('/install', (_req, res) => res.redirect(302, '/'));
app.post('/install', (_req, res) => res.redirect(302, '/'));
app.get('/handler', (_req, res) => res.redirect(302, '/'));

// SPA-фолбэк кроме API
app.get('*', (req, res, next) => {
  const knownApi = [/^\/payments(\/.*)?$/, /^\/health$/, /^\/dbcheck$/, /^\/version$/];
  if (knownApi.some(rx => rx.test(req.path))) return next();
  if (fs.existsSync(INDEX_HTML)) return res.sendFile(INDEX_HTML);
  return res.status(404).send('Not found');
});

app.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});
