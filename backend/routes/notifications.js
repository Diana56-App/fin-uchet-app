const express = require('express');
const router = express.Router();

// Храним расходы и платежи в оперативной памяти, импортируем их из require.cache
function getData(moduleName) {
  return require.cache[require.resolve(moduleName)]?.exports?.getData?.() || [];
}

router.get('/', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);

  const allPayments = getData('./payments');
  const allExpenses = getData('./expenses');

  const pendingPayments = allPayments.filter(
    p => p.planDate === today && !p.factDate
  );
  const pendingExpenses = allExpenses.filter(
    e => e.planDate === today && !e.factDate
  );

  res.json({
    payments: pendingPayments,
    expenses: pendingExpenses,
  });
});

module.exports = router;
