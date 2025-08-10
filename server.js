const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Имитация базы платежей (только в памяти!) ---
let payments = [
  {
    date: '2025-08-07',
    amount: 15000,
    category: 'Дизайн',
    project: 'Оформление школы №10',
    contractor: 'ООО "Партнёр"'
  },
  {
    date: '2025-08-04',
    amount: 5900,
    category: 'Печать',
    project: 'Оформление школы №11',
    contractor: 'ИП Ромашкин'
  },
  {
    date: '2025-08-01',
    amount: 2200,
    category: 'Сувениры',
    project: 'Летний лагерь',
    contractor: 'ООО "Сувенирка"'
  }
];

// --- API ПЛАТЕЖЕЙ ---
app.get('/payments', (req, res) => {
  res.json(payments);
});

app.post('/payments', (req, res) => {
  payments.push(req.body);
  res.json({ success: true });
});

// --- ОТДАВАТЬ index.html на ВСЁ (SPA) ---
// Для GET-запросов (любые маршруты, кроме /payments)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Для Bitrix24: POST-запрос на /
app.post('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- Запуск ---
app.listen(PORT, () => {
  console.log(`Server started at http://localhost:${PORT}`);
});
