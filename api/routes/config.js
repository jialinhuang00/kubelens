const express = require('express');
const { loadResources, loadTemplates } = require('../utils/config-loader');

const router = express.Router();

// GET /api/config: resource kinds + per-kind command templates. Frontend reads
// this at startup instead of hardcoding the lists.
router.get('/config', (req, res) => {
  res.json({ resources: loadResources(), templates: loadTemplates() });
});

module.exports = router;
