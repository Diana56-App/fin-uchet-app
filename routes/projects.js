const express = require('express');
const router = express.Router();

let projects = []; // { id, name }

router.get('/', (req, res) => res.json(projects));
router.post('/', (req, res) => {
    const project = { ...req.body, id: Date.now() };
    projects.push(project);
    res.status(201).json(project);
});
router.put('/:id', (req, res) => {
    const { id } = req.params;
    projects = projects.map(p => p.id == id ? { ...p, ...req.body } : p);
    res.json({ status: 'updated' });
});

module.exports = router;
module.exports.getData = () => projects;
