// backend/public/payments.js
document.addEventListener('DOMContentLoaded', () => {
  const el = id => document.getElementById(id);

  // --- DOM ---
  const tableDiv    = el('table');
  const addForm     = el('addForm');
  const totalsDiv   = el('totals');
  const fType       = el('f_operation_type');
  const fCash       = el('f_cashbox');
  const fReset      = el('f_reset');
  const btnToggle   = el('toggleAdd');
  const btnSave     = el('save');
  const btnCancel   = el('cancel');

  // --- state ---
  let allPayments = [];
  let mode = 'create';    // 'create' | 'edit'
  let editingId = null;

  // --- helpers: форматирование ---
  function formatDateRu(value) {
    try {
      if (!value) return '';
      const d = new Date(value);
      if (isNaN(d.getTime())) return String(value);
      return d.toLocaleDateString('ru-RU');
    } catch { return String(value ?? ''); }
  }

  function toDateInputValue(val) {
    if (!val) return '';
    if (/^\d{4}-\d{2}-\d{2}/.test(val)) return val.slice(0, 10);
    try {
      const d = new Date(val);
      if (isNaN(d.getTime())) return '';
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    } catch { return ''; }
  }

  function inferType(p) {
    if (p.operation_type) return p.operation_type;
    if (p.category === 'Выручка') return 'income';
    if (p.category === 'Расход')   return 'expense';
    return '';
  }

  function formatCurrencyWithSign(amount, type) {
    const num = Number(amount);
    if (Number.isNaN(num)) return String(amount ?? '');
    const sign = type === 'income' ? '+' : type === 'expense' ? '-' : '';
    const formatted = num.toLocaleString('ru-RU');
    return `${sign} ${formatted} ₽`.trim();
  }

  function formatMoney(num) {
    const n = Number(num) || 0;
    return n.toLocaleString('ru-RU');
  }

  // --- кассы: код <-> отображение и нормализация ---
  const CASHBOX_LABEL = {
    cash:      'Наличные',
    card:      'Карта',
    bank:      'Расчетный счет',
    robokassa: 'Робокасса',
  };

  function labelFromCode(code) {
    return CASHBOX_LABEL[code] ?? code ?? '';
  }

  // Нормализуем любые значения (и русские, и коды) к коду: 'cash'|'card'|'bank'|'robokassa'|''.
  function normalizeCashbox(v) {
    const s = String(v ?? '').toLowerCase().trim();
    switch (s) {
      case 'cash':
      case 'наличные':       return 'cash';
      case 'card':
      case 'карта':          return 'card';
      case 'bank':
      case 'расчетный счет':
      case 'расчётный счет':
      case 'р/с':
      case 'р/счет':
      case 'р/счет.':
      case 'р/счёт':         return 'bank';
      case 'robokassa':
      case 'робокасса':      return 'robokassa';
      default:               return '';
    }
  }

  function todayISO() {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  }

  function showForm() {
    addForm.classList.remove('hidden');
    if (!el('date').value) el('date').value = todayISO();
    el('amount')?.focus();
  }

  function hideForm() {
    addForm.classList.add('hidden');
    ['date','amount','operation_type','cashbox','article','project','contractor']
      .forEach(id => { const n = el(id); if (n) n.value = ''; });
    mode = 'create';
    editingId = null;
    if (btnSave) btnSave.textContent = 'Сохранить';
    if (btnToggle) btnToggle.disabled = false;
  }

  // --- фильтры и итоги ---
  function getFilters() {
    return { type: fType?.value || '', cash: fCash?.value || '' };
  }

  function applyFilters(data) {
    const { type, cash } = getFilters();
    return data.filter(p => {
      const t = inferType(p);
      if (type && t !== type) return false;
      if (cash && normalizeCashbox(p.cashbox) !== cash) return false;
      return true;
    });
  }

  function calcTotals(data) {
    let income = 0, expense = 0;
    for (const p of data) {
      const t = inferType(p);
      const amt = Number(p.amount) || 0;
      if (t === 'income') income += amt;
      else if (t === 'expense') expense += amt;
    }
    const balance = income - expense;
    totalsDiv.innerHTML =
      `Доход: <span class="pos">${formatMoney(income)} ₽</span> • ` +
      `Расход: <span class="neg">${formatMoney(expense)} ₽</span> • ` +
      `Баланс: <span class="bal">${formatMoney(balance)} ₽</span>`;
  }

  // --- рендер таблицы ---
  function renderTable(data) {
    if (!Array.isArray(data) || data.length === 0) {
      tableDiv.innerHTML = '<div style="color:#888;margin-top:8px;">Платежей пока нет</div>';
      calcTotals([]);
      return;
    }

    const rows = data.map(p => {
      const type = inferType(p);
      const sum = formatCurrencyWithSign(p.amount, type);
      const color = type === 'income' ? '#2e9f47' : (type === 'expense' ? '#c0392b' : '#333');
      const article = p.article ?? p.category ?? '';
      const dealDisplay    = p.deal_name ?? (p.deal_id ? `#${p.deal_id}` : '');
      const projectDisplay = p.project_name ?? p.project ?? '';
      const cpDisplay      = p.contact_name ?? p.company_name ?? p.contractor ?? '';

      const normalized = normalizeCashbox(p.cashbox);
      const cashLabel = normalized ? labelFromCode(normalized) : (p.cashbox || '');

      return `
        <tr data-id="${p.id}">
          <td>${formatDateRu(p.date)}</td>
          <td><span style="color:${color};font-weight:600">${sum}</span></td>
          <td>${article}</td>
          <td>${dealDisplay}</td>
          <td>${projectDisplay}</td>
          <td>${cpDisplay}</td>
          <td>${cashLabel}</td>
          <td>
            <button class="tbtn link" data-id="${p.id}" title="Привязать к Битрикс" style="padding:6px 10px;font-size:12px;border:1px solid #ddd;border-radius:8px;background:#fff;cursor:pointer;">🔗</button>
            <button class="tbtn edit" data-id="${p.id}" title="Редактировать" style="padding:6px 10px;font-size:12px;border:1px solid #ddd;border-radius:8px;background:#fff;cursor:pointer;margin-left:6px;">✏️</button>
            <button class="tbtn del"  data-id="${p.id}" title="Удалить"        style="padding:6px 10px;font-size:12px;border:1px solid #ddd;border-radius:8px;background:#fff;cursor:pointer;margin-left:6px;">🗑️</button>
          </td>
        </tr>
      `;
    }).join('');

    tableDiv.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Дата</th>
            <th>Операция</th>
            <th>Статья/Описание</th>
            <th>Сделка</th>
            <th>Проект</th>
            <th>Контрагент</th>
            <th>Счет/кассы</th>
            <th style="width:168px">Действия</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
    calcTotals(data);
  }

  function renderWithFilters() {
    renderTable(applyFilters(allPayments));
  }

  // --- загрузка ---
  async function loadPayments() {
    try {
      const res = await fetch('/payments');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      allPayments = await res.json();
      renderWithFilters();
    } catch (e) {
      console.error('loadPayments error:', e);
      tableDiv.innerHTML = '<div style="color:#c00;margin-top:8px;">Ошибка загрузки платежей</div>';
      calcTotals([]);
    }
  }

  // --- форма: заполнение/сбор ---
  function fillFormFromPayment(p) {
    el('date').value = toDateInputValue(p.date);
    el('amount').value = p.amount ?? '';
    el('operation_type').value = inferType(p) || '';
    el('cashbox').value = normalizeCashbox(p.cashbox);   // ключевой фикс
    el('article').value = p.article ?? (p.category ?? '');
    el('project').value = p.project ?? '';
    el('contractor').value = p.contractor ?? '';
  }

  function collectPaymentFromForm() {
    const op = el('operation_type').value;
    return {
      date: el('date').value,
      amount: Number(el('amount').value),
      category: op === 'income' ? 'Выручка' : op === 'expense' ? 'Расход' : '',
      project: el('project').value,
      contractor: el('contractor').value,
      operation_type: op,
      article: el('article').value,
      cashbox: el('cashbox').value                // код из селекта
    };
  }

  // Возвращает битрикс-поля текущей записи (чтобы не обнулять при обновлении)
  function getExistingBitrixFields(id) {
    const p = allPayments.find(x => x.id === id) || {};
    return {
      deal_id:      p.deal_id ?? null,
      contact_id:   p.contact_id ?? null,
      company_id:   p.company_id ?? null,
      project_id:   p.project_id ?? null,
      deal_name:    p.deal_name ?? null,
      contact_name: p.contact_name ?? null,
      company_name: p.company_name ?? null,
      project_name: p.project_name ?? null
    };
  }

  // --- add / update / delete ---
  async function addPayment() {
    const payment = collectPaymentFromForm();
    if (!payment.date || !payment.amount) { alert('Укажите дату и сумму'); return; }
    if (!payment.category) { alert('Выберите тип операции (Доход или Расход)'); return; }
    try {
      const res = await fetch('/payments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payment)
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      hideForm(); await loadPayments();
    } catch (e) {
      console.error('addPayment error:', e);
      alert('Не удалось добавить платёж');
    }
  }

  async function updatePayment(id) {
    const base = collectPaymentFromForm();
    // ВАЖНО: добавляем текущие битрикс-поля, чтобы не обнулять
    const bitrixFields = getExistingBitrixFields(id);
    const payload = { ...base, ...bitrixFields };

    if (!payload.date || !payload.amount) { alert('Укажите дату и сумму'); return; }
    if (!payload.category) { alert('Выберите тип операции (Доход или Расход)'); return; }

    try {
      const res = await fetch(`/payments/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      hideForm(); await loadPayments();
    } catch (e) {
      console.error('updatePayment error:', e);
      alert('Не удалось обновить платёж');
    }
  }

  async function deletePayment(id) {
    if (!confirm('Удалить платёж?')) return;
    try {
      const res = await fetch(`/payments/${id}`, { method: 'DELETE' });
      if (res.status !== 204) throw new Error('HTTP ' + res.status);
      await loadPayments();
    } catch (e) {
      console.error('deletePayment error:', e);
      alert('Не удалось удалить платёж');
    }
  }

  // --- привязка к Битрикс ---
  function toNullableInt(v) {
    const s = String(v ?? '').trim();
    if (s === '') return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  function toNullableStr(v) {
    const s = String(v ?? '').trim();
    return s === '' ? null : s;
  }

  async function linkPayment(id) {
    const p = allPayments.find(x => x.id === id);
    if (!p) return;

    const deal_id    = prompt('ID сделки (Bitrix24). Оставьте поле пустым, если не нужно.', p.deal_id ?? '') ?? '';
    const contact_id = prompt('ID контакта (если есть). Пусто — не трогаем.',      p.contact_id ?? '') ?? '';
    const company_id = prompt('ID компании (если есть). Пусто — не трогаем.',      p.company_id ?? '') ?? '';
    const project_id = prompt('ID направления/категории сделки (если знаете).',    p.project_id ?? '') ?? '';

    const deal_name    = prompt('Название сделки (пусто — подтянуть из Bitrix)',   p.deal_name ?? '') ?? '';
    const contact_name = prompt('Имя контакта (пусто — подтянуть из Bitrix)',      p.contact_name ?? '') ?? '';
    const company_name = prompt('Название компании (пусто — подтянуть из Bitrix)', p.company_name ?? '') ?? '';
    const project_name = prompt('Название направления/проекта (пусто — подтянуть)', p.project_name ?? p.project ?? '') ?? '';

    const ids = {
      deal_id:    toNullableInt(deal_id),
      contact_id: toNullableInt(contact_id),
      company_id: toNullableInt(company_id),
      project_id: toNullableInt(project_id)
    };
    const names = {
      deal_name:    toNullableStr(deal_name),
      contact_name: toNullableStr(contact_name),
      company_name: toNullableStr(company_name),
      project_name: toNullableStr(project_name)
    };

    const haveAnyId     = Object.values(ids).some(v => v !== null);
    const anyNameFilled = Object.values(names).some(v => v !== null);

    try {
      let updated;
      if (haveAnyId && !anyNameFilled) {
        const res = await fetch(`/payments/${id}/link/bitrix`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(ids)
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        updated = await res.json();
      } else {
        const payload = { ...ids, ...names };
        const res = await fetch(`/payments/${id}/link`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        updated = await res.json();
      }
      const idx = allPayments.findIndex(x => x.id === id);
      if (idx >= 0) allPayments[idx] = updated;
      renderWithFilters();
    } catch (e) {
      console.error('linkPayment error:', e);
      alert('Не удалось выполнить привязку');
    }
  }

  // --- table actions (delegation) ---
  tableDiv.addEventListener('click', (e) => {
    const btn = e.target.closest('button.tbtn');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    if (!id) return;

    if (btn.classList.contains('link'))  linkPayment(id);
    if (btn.classList.contains('edit')) {
      const payment = allPayments.find(p => p.id === id);
      if (!payment) return;
      mode = 'edit'; editingId = id;
      if (btnSave)   btnSave.textContent = 'Обновить';
      if (btnToggle) btnToggle.disabled  = true;
      showForm(); fillFormFromPayment(payment);
    }
    if (btn.classList.contains('del'))   deletePayment(id);
  });

  // --- listeners ---
  btnToggle?.addEventListener('click', () => {
    mode = 'create'; editingId = null;
    if (btnSave) btnSave.textContent = 'Сохранить';
    showForm();
  });
  btnCancel?.addEventListener('click', hideForm);
  btnSave?.addEventListener('click', () => {
    if (mode === 'edit' && editingId) return updatePayment(editingId);
    return addPayment();
  });

  el('load')?.addEventListener('click', loadPayments);

  fType?.addEventListener('change', renderWithFilters);
  fCash?.addEventListener('change', renderWithFilters);
  fReset?.addEventListener('click', () => {
    if (fType) fType.value = '';
    if (fCash) fCash.value = '';
    renderWithFilters();
  });

  // первичная загрузка
  loadPayments();
});
