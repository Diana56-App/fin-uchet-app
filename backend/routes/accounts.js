const express = require('express');
const router = express.Router();

let accounts = []; // { id, name }

router.get('/', (req, res) => res.json(accounts));
router.post('/', (req, res) => {
    const account = { ...req.body, id: Date.now() };
    accounts.push(account);
    res.status(201).json(account);
});
router.put('/:id', (req, res) => {
    const { id } = req.params;
    accounts = accounts.map(a => a.id == id ? { ...a, ...req.body } : a);
    res.json({ status: 'updated' });
});

module.exports = router;
module.exports.getData = () => accounts;
