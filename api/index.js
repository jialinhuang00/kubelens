require('dotenv').config();
const express = require('express');
const http = require('http');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// Always load snapshot handler — per-request snapshot mode via ?snapshot=true
require('./utils/snapshot-handler');
console.log('snapshot-handler loaded — use ?snapshot=true on requests to enable snapshot mode');

app.use(express.json());

// GET /api/debug/memory — server RSS for memory leak testing
app.get('/api/debug/memory', (_req, res) => {
  const m = process.memoryUsage();
  res.json({
    rss:      Math.round(m.rss      / 1024 / 1024),
    heapUsed: Math.round(m.heapUsed / 1024 / 1024),
    heapTotal:Math.round(m.heapTotal/ 1024 / 1024),
  });
});

// Mount routes
const { router: executeRouter, mountWebSocket } = require('./routes/execute');
const graphRouter = require('./routes/graph');
const statusRouter = require('./routes/status');
const resourceCountsRouter = require('./routes/resource-counts');
const ecrRouter = require('./routes/ecr');
const snapshotRouter = require('./routes/snapshot');

app.use('/api', executeRouter);
app.use('/api', graphRouter);
app.use('/api', statusRouter);
app.use('/api', resourceCountsRouter);
app.use('/api', ecrRouter);
app.use('/api', snapshotRouter);

// WebSocket streaming for kubectl long-running commands
mountWebSocket(server);

server.listen(PORT, () => {
  console.log(`kubecmds-viz server running on http://localhost:${PORT}`);
  console.log(`Realtime ping: http://localhost:${PORT}/api/realtime/ping`);
  console.log(`Graph endpoint: http://localhost:${PORT}/api/graph`);
  console.log(`WebSocket streaming ready on /api/execute/stream/ws`);
});
