const express = require('express');
const router = express.Router();

let payments = [
  // Сюда можно добавить тестовые платежи, если хочешь, но можешь оставить пусто
];

// Получить все платежи
router.get('/', (req, res) => {
  res.json(payments);
});

// Добавить новый платёж
router.post('/', (req, res) => {
  const payment = req.body;
  payments.unshift(payment); // добавляем в начало массива
  res.status(201).json({success: true});
});

module.exports = router;
