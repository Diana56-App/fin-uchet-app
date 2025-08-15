// backend/server.js
// Express-сервер: API + раздача фронта с КОРНЯ "/"
// Вариант А реализован: фронт из backend/frontend -> "/", дублирование на "/app",
// редиректы /install (GET/POST) и /handler (GET) -> 302 на "/". API не меняется.

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

// --- Базовые настройки ---
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

// --- Утилиты для БД (универсальные апдейты под неизвестную схему "payments") ---
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

// --- Тех. эндпоинты (как были) ---
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

app.get('/version', (_req, res) => {
  // Зафиксируем версию, как в диагностике
  res.json({ version: '0.1.0' });
});

// --- API /payments (пути и семантика сохранены) ---
/**
 * GET /payments — JSON список платежей
 */
app.get('/payments', async (_req, res) => {
  try {
    if (!pool) return res.status(500).json({ error: 'DB not configured' });
    const { rows } = await pool.query('SELECT * FROM payments ORDER BY id DESC;');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /payments — создать запись (универсально по переданным полям)
 */
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

/**
 * PUT /payments/:id — полная замена по id (универсально)
 */
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

/**
 * DELETE /payments/:id — удалить запись
 */
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

/**
 * PATCH /payments/:id/link — ручная правка битрикс-полей (универсально)
 */
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

/**
 * POST /payments/:id/link/bitrix — подтяжка из Bitrix
 * Ожидаем, что в body придут { dealId } или другой идентификатор,
 * либо вы используете BITRIX_* переменные окружения.
 */
app.post('/payments/:id/link/bitrix', async (req, res) => {
  const { id } = req.params;
  const { dealId } = req.body || {};
  const hook = process.env.BITRIX_WEBHOOK_URL;
  try {
    if (!pool) return res.status(500).json({ error: 'DB not configured' });
    if (!hook || !dealId) {
      return res.status(400).json({ error: 'BITRIX_WEBHOOK_URL or dealId missing' });
    }

    // Пример вызова Bitrix Webhook API (адаптируйте под свою схему)
    // Получаем сделку и нужные поля:
    const dealResp = await axios.get(`${hook}/crm.deal.get`, {
      params: { id: dealId },
      timeout: 15000,
    });

    const deal = dealResp?.data?.result || {};
    const cols = await getTableColumns('payments');

    // Маппинг: пытаемся положить поля сделки, если такие колонки есть
    // Например, bitrix_deal_id, bitrix_title, bitrix_contact_id, и т.д.
    const patch = {};
    if (cols.includes('bitrix_deal_id')) patch.bitrix_deal_id = dealId;
    if (cols.includes('bitrix_title') && deal.TITLE) patch.bitrix_title = deal.TITLE;
    if (cols.includes('bitrix_contact_id') && deal.CONTACT_ID) patch.bitrix_contact_id = deal.CONTACT_ID;
    if (cols.includes('bitrix_company_id') && deal.COMPANY_ID) patch.bitrix_company_id = deal.COMPANY_ID;
    if (cols.includes('bitrix_stage_id') && deal.STAGE_ID) patch.bitrix_stage_id = deal.STAGE_ID;
    if (cols.includes('bitrix_amount') && deal.OPPORTUNITY) patch.bitrix_amount = deal.OPPORTUNITY;

    if (Object.keys(patch).length === 0) {
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

// --- Раздача фронта: КОРЕНЬ "/" + дубликат на "/app" ---
const FRONTEND_DIR = path.join(__dirname, 'frontend');
const INDEX_HTML = path.join(FRONTEND_DIR, 'index.html');

// 1) Статика по корню "/"
app.use(express.static(FRONTEND_DIR, { index: 'index.html', extensions: ['html'] }));

// 2) Дублируем на "/app" (для обратной совместимости)
app.use('/app', express.static(FRONTEND_DIR, { index: 'index.html', extensions: ['html'] }));

// 3) Прямые маршруты на корень (гарантированно отдаем index.html)
app.get('/', (_req, res) => {
  if (fs.existsSync(INDEX_HTML)) return res.sendFile(INDEX_HTML);
  return res.status(500).send('index.html not found in frontend/');
});

// 4) Редиректы Bitrix-маршрутов установки/хэндлера на корень
app.get('/install', (_req, res) => res.redirect(302, '/'));
app.post('/install', (_req, res) => res.redirect(302, '/'));
app.get('/handler', (_req, res) => res.redirect(302, '/'));

// 5) Фолбэк для SPA-маршрутов (кроме известных API путей)
app.get('*', (req, res, next) => {
  const knownApi = [
    /^\/payments(\/.*)?$/,
    /^\/health$/,
    /^\/dbcheck$/,
    /^\/version$/,
  ];
  if (knownApi.some(rx => rx.test(req.path))) return next();
  if (fs.existsSync(INDEX_HTML)) return res.sendFile(INDEX_HTML);
  return res.status(404).send('Not found');
});

// --- Запуск ---
app.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});
