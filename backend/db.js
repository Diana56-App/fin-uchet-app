// backend/db.js
const { Pool } = require('pg');
const dotenv = require('dotenv');

dotenv.config();

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL не задан. Проверь .env локально и переменные окружения на Render.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('render') ? { rejectUnauthorized: false } : false,
});

async function init() {
  // Базовая таблица (если ещё не создана)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,
      date DATE NOT NULL,
      amount NUMERIC(12,2) NOT NULL,
      category TEXT NOT NULL,
      comment TEXT
    );
  `);

  // Текущие поля интерфейса
  await pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS project TEXT;`);
  await pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS contractor TEXT;`);
  await pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS operation_type TEXT;`); // 'income' | 'expense'
  await pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS article TEXT;`);
  await pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS cashbox TEXT;`);        // 'cash' | 'card' | 'bank' | 'robokassa'

  // Крючки под Битрикс24: ID + кеш-имена (чтобы быстро показывать без запроса к CRM)
  await pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS deal_id BIGINT;`);
  await pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS contact_id BIGINT;`);
  await pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS company_id BIGINT;`);
  await pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS project_id BIGINT;`);

  await pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS deal_name TEXT;`);
  await pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS contact_name TEXT;`);
  await pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS company_name TEXT;`);
  await pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS project_name TEXT;`);
}

module.exports = { pool, init };
