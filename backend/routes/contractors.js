const express = require('express');
const router = express.Router();

let contractors = []; // { id, name }

router.get('/', (req, res) => res.json(contractors));
router.post('/', (req, res) => {
    const contractor = { ...req.body, id: Date.now() };
    contractors.push(contractor);
    res.status(201).json(contractor);
});
router.put('/:id', (req, res) => {
    const { id } = req.params;
    contractors = contractors.map(c => c.id == id ? { ...c, ...req.body } : c);
    res.json({ status: 'updated' });
});

module.exports = router;
module.exports.getData = () => contractors;
