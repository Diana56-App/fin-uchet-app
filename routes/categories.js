const express = require('express');
const router = express.Router();

let categories = []; // { id, name, type: 'income'|'expense' }

router.get('/', (req, res) => res.json(categories));
router.post('/', (req, res) => {
    const category = { ...req.body, id: Date.now() };
    categories.push(category);
    res.status(201).json(category);
});
router.put('/:id', (req, res) => {
    const { id } = req.params;
    categories = categories.map(c => c.id == id ? { ...c, ...req.body } : c);
    res.json({ status: 'updated' });
});

module.exports = router;
module.exports.getData = () => categories;
