document.addEventListener('DOMContentLoaded', () => {
  const el = id => document.getElementById(id);
  const tableDiv = el('table');

  async function loadPayments() {
    const res = await fetch('/payments');
    const data = await res.json();

    if (!data.length) {
      tableDiv.innerHTML = '<div style="color:#888;margin-top:8px;">Платежей пока нет</div>';
      return;
    }

    const rows = data.map(p => `
      <tr>
        <td>${p.date || ''}</td>
        <td>${p.amount || ''}</td>
        <td>${p.category || ''}</td>
        <td>${p.project || ''}</td>
        <td>${p.contractor || ''}</td>
      </tr>
    `).join('');

    tableDiv.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Дата</th>
            <th>Сумма</th>
            <th>Категория</th>
            <th>Проект</th>
            <th>Контрагент</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  async function addPayment() {
    const payment = {
      date: el('date').value,
      amount: Number(el('amount').value),
      category: el('category').value,
      project: el('project').value,
      contractor: el('contractor').value,
    };
    if (!payment.date || !payment.amount) return alert('Укажите дату и сумму');

    await fetch('/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payment)
    });

    await loadPayments();
  }

  el('load').addEventListener('click', loadPayments);
  el('add').addEventListener('click', addPayment);
  loadPayments();
});
