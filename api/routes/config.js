const express = require('express');
const { loadResources } = require('../utils/config-loader');

const router = express.Router();

// GET /api/config: resource kinds the app knows about. Frontend reads this at
// startup instead of hardcoding the list.
router.get('/config', (req, res) => {
  res.json({ resources: loadResources() });
});

module.exports = router;
