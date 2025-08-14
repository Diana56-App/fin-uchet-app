// backend/server.js
const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');
const { pool, init } = require('./db');
const bitrix = require('./bitrix');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Инициализация БД
init()
  .then(() => console.log('DB init OK'))
  .catch((err) => { console.error('DB init error:', err); process.exit(1); });

// ---------- Диагностика ----------
app.get('/health', (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

app.get('/dbcheck', async (req, res) => {
  try {
    const r = await pool.query('SELECT 1 as ok');
    res.json({ db: 'ok', result: r.rows[0] });
  } catch (e) {
    res.status(500).json({ db: 'fail', error: e.message });
  }
});

app.get('/version', (req, res) => {
  res.json({ version: process.env.APP_VERSION || '0.1.0' });
});

// ---------- Основные маршруты ----------
const SELECT_FIELDS = `
  id, date, amount::float8 AS amount, category, project, contractor,
  operation_type, article, cashbox, comment,
  deal_id, contact_id, company_id, project_id,
  deal_name, contact_name, company_name, project_name
`;

// ---------------- GET ----------------
app.get('/payments', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${SELECT_FIELDS} FROM payments ORDER BY date DESC, id DESC`
    );
    res.json(rows);
  } catch (e) {
    console.error('GET /payments error:', e);
    res.status(500).json({ error: 'Failed to fetch payments' });
  }
});

// ---------------- POST ----------------
app.post('/payments', async (req, res) => {
  try {
    const p = req.body;
    if (!p.date || !p.amount || !p.category) {
      return res.status(400).json({ error: 'date, amount, category — обязательны' });
    }

    const sql = `
      INSERT INTO payments (
        date, amount, category, project, contractor,
        operation_type, article, cashbox, comment,
        deal_id, contact_id, company_id, project_id,
        deal_name, contact_name, company_name, project_name
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17
      )
      RETURNING ${SELECT_FIELDS}
    `;
    const v = [
      p.date, p.amount, p.category, p.project || null, p.contractor || null,
      p.operation_type || null, p.article || null, p.cashbox || null, p.comment || null,
      p.deal_id ?? null, p.contact_id ?? null, p.company_id ?? null, p.project_id ?? null,
      p.deal_name ?? null, p.contact_name ?? null, p.company_name ?? null, p.project_name ?? null
    ];
    const { rows } = await pool.query(sql, v);
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error('POST /payments error:', e);
    res.status(500).json({ error: 'Failed to add payment' });
  }
});

// ---------------- PUT (safe merge) ----------------
// Не затираем битрикс-поля, если пришли пустыми: берём из текущей записи.
app.put('/payments/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Bad id' });

    const p = req.body;
    if (!p.date || !p.amount || !p.category) {
      return res.status(400).json({ error: 'date, amount, category — обязательны' });
    }

    // Читаем текущую запись
    const curQ = await pool.query(`SELECT ${SELECT_FIELDS} FROM payments WHERE id=$1`, [id]);
    const cur = curQ.rows[0];
    if (!cur) return res.status(404).json({ error: 'Not found' });

    // Хелпер: если значение не задано (null/undefined/''), оставляем текущее
    const keep = (val, existing) =>
      (val === undefined || val === null || val === '') ? existing : val;

    // Собираем окончательные значения
    const final = {
      date:           p.date,
      amount:         p.amount,
      category:       p.category,
      project:        p.project ?? null,
      contractor:     p.contractor ?? null,
      operation_type: p.operation_type ?? null,
      article:        p.article ?? null,
      cashbox:        p.cashbox ?? null,
      comment:        p.comment ?? null,

      // Битрикс-поля — берём из тела, а если там пусто, то из текущей строки
      deal_id:        keep(p.deal_id,        cur.deal_id),
      contact_id:     keep(p.contact_id,     cur.contact_id),
      company_id:     keep(p.company_id,     cur.company_id),
      project_id:     keep(p.project_id,     cur.project_id),

      deal_name:      keep(p.deal_name,      cur.deal_name),
      contact_name:   keep(p.contact_name,   cur.contact_name),
      company_name:   keep(p.company_name,   cur.company_name),
      project_name:   keep(p.project_name,   cur.project_name),
    };

    const sql = `
      UPDATE payments SET
        date=$1, amount=$2, category=$3, project=$4, contractor=$5,
        operation_type=$6, article=$7, cashbox=$8, comment=$9,
        deal_id=$10, contact_id=$11, company_id=$12, project_id=$13,
        deal_name=$14, contact_name=$15, company_name=$16, project_name=$17
      WHERE id=$18
      RETURNING ${SELECT_FIELDS}
    `;
    const v = [
      final.date, final.amount, final.category, final.project, final.contractor,
      final.operation_type, final.article, final.cashbox, final.comment,
      final.deal_id, final.contact_id, final.company_id, final.project_id,
      final.deal_name, final.contact_name, final.company_name, final.project_name,
      id
    ];

    const { rows } = await pool.query(sql, v);
    res.json(rows[0]);
  } catch (e) {
    console.error('PUT /payments/:id error:', e);
    res.status(500).json({ error: 'Failed to update payment' });
  }
});

// ---------------- DELETE ----------------
app.delete('/payments/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Bad id' });

    const { rowCount } = await pool.query('DELETE FROM payments WHERE id = $1', [id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
  } catch (e) {
    console.error('DELETE /payments/:id error:', e);
    res.status(500).json({ error: 'Failed to delete payment' });
  }
});

// ---------------- PATCH: ручная правка битрикс-полей ----------------
app.patch('/payments/:id/link', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Bad id' });

    const allowed = [
      'deal_id','contact_id','company_id','project_id',
      'deal_name','contact_name','company_name','project_name'
    ];
    const sets = [], values = [];
    for (const k of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body, k)) {
        sets.push(`${k} = $${sets.length + 1}`);
        values.push(req.body[k] ?? null);
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'No fields to update' });

    values.push(id);
    const { rows } = await pool.query(
      `UPDATE payments SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING ${SELECT_FIELDS}`,
      values
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (e) {
    console.error('PATCH /payments/:id/link error:', e);
    res.status(500).json({ error: 'Failed to link Bitrix fields' });
  }
});

// ---------------- POST: автоподтяжка из Bitrix ----------------
app.post('/payments/:id/link/bitrix', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Bad id' });
    if (!bitrix.ready) return res.status(400).json({ error: 'Bitrix webhook not configured' });

    const curQ = await pool.query(`SELECT ${SELECT_FIELDS} FROM payments WHERE id=$1`, [id]);
    const current = curQ.rows[0];
    if (!current) return res.status(404).json({ error: 'Not found' });

    let { deal_id = current.deal_id, contact_id = current.contact_id,
          company_id = current.company_id, project_id = current.project_id } = req.body || {};

    const patch = {};

    if (deal_id) {
      const deal = await bitrix.getDeal(deal_id);
      patch.deal_id = Number(deal_id);
      patch.deal_name = deal.TITLE || null;

      if (!contact_id && deal.CONTACT_ID) contact_id = Number(deal.CONTACT_ID);
      if (!company_id && deal.COMPANY_ID) company_id = Number(deal.COMPANY_ID);

      const ufName = await bitrix.getDealProjectNameFromUserField(deal);
      if (ufName) patch.project_name = ufName;

      if (!patch.project_name && deal.CATEGORY_ID !== undefined && deal.CATEGORY_ID !== null) {
        const catId = Number(deal.CATEGORY_ID);
        patch.project_id = catId;
        patch.project_name = await bitrix.getCategoryName(catId);
      }
    }

    if (contact_id) {
      const c = await bitrix.getContact(contact_id);
      const name = [c.NAME, c.LAST_NAME].filter(Boolean).join(' ').trim();
      patch.contact_id = Number(contact_id);
      patch.contact_name = name || c.HONORIFIC || null;
    }

    if (company_id) {
      const co = await bitrix.getCompany(company_id);
      patch.company_id = Number(company_id);
      patch.company_name = co.TITLE || co.COMPANY_TITLE || null;
    }

    if (project_id && !patch.project_name) {
      const name = await bitrix.getCategoryName(project_id);
      if (name) { patch.project_id = Number(project_id); patch.project_name = name; }
    }

    if (!Object.keys(patch).length) return res.json(current);

    const sets = Object.keys(patch).map((k, i) => `${k} = $${i + 1}`).join(', ');
    const values = Object.keys(patch).map(k => patch[k]); values.push(id);

    const { rows } = await pool.query(
      `UPDATE payments SET ${sets} WHERE id = $${values.length} RETURNING ${SELECT_FIELDS}`,
      values
    );
    res.json(rows[0]);
  } catch (e) {
    console.error('POST /payments/:id/link/bitrix error:', e);
    res.status(500).json({ error: 'Failed to fetch from Bitrix' });
  }
});

app.listen(PORT, () => {
  console.log(`Server started at http://localhost:${PORT}`);
});
