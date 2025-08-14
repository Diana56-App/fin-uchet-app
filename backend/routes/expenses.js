const express = require('express');
const router = express.Router();

let expenses = []; // временное хранилище расходов

// Получить все расходы с фильтрами и сортировкой
router.get('/', (req, res) => {
  let result = expenses;
  const { project, account, contractor, category, dateFrom, dateTo, sort } = req.query;

  if (project) result = result.filter(e => e.project === project);
  if (account) result = result.filter(e => e.account === account);
  if (contractor) result = result.filter(e => e.contractor === contractor);
  if (category) result = result.filter(e => e.category === category);

  if (dateFrom && dateTo) {
    result = result.filter(e =>
      new Date(e.date) >= new Date(dateFrom) &&
      new Date(e.date) <= new Date(dateTo)
    );
  }

  if (sort === 'date') {
    result = result.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  }

  res.json(result);
});

// Добавить новый расход
router.post('/', (req, res) => {
  const expense = { ...req.body, id: Date.now() };
  expenses.push(expense);
  res.status(201).json(expense);
});

// Аналитика — баланс по расходам
router.get('/balance', (req, res) => {
  const balance = expenses.reduce((sum, e) => sum - Number(e.amount), 0);
  res.json({ balance });
});

module.exports = router;

