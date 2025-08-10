const express = require('express');
const router = express.Router();

let transfers = []; // { id, date, fromAccountId, toAccountId, amount, note }

router.get('/', (req, res) => res.json(transfers));
router.post('/', (req, res) => {
    const transfer = { ...req.body, id: Date.now() };
    transfers.push(transfer);
    res.status(201).json(transfer);
});

module.exports = router;
module.exports.getData = () => transfers;
