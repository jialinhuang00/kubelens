require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

// Always load snapshot handler — per-request snapshot mode via ?snapshot=true
require('./utils/snapshot-handler');
console.log('snapshot-handler loaded — use ?snapshot=true on requests to enable snapshot mode');

app.use(express.json());

// Mount routes
const { router: executeRouter, mountStream } = require('./routes/execute');
const graphRouter = require('./routes/graph');
const statusRouter = require('./routes/status');
const resourceCountsRouter = require('./routes/resource-counts');
const ecrRouter = require('./routes/ecr');
const k8sExportRouter = require('./routes/k8s-export');

// Stream routes need io reference, mount them onto the router before app.use
mountStream(executeRouter, io);

app.use('/api', executeRouter);
app.use('/api', graphRouter);
app.use('/api', statusRouter);
app.use('/api', resourceCountsRouter);
app.use('/api', ecrRouter);
app.use('/api', k8sExportRouter);

// WebSocket connection
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`kubecmds-viz server running on http://localhost:${PORT}`);
  console.log(`Realtime ping: http://localhost:${PORT}/api/realtime/ping`);
  console.log(`Graph endpoint: http://localhost:${PORT}/api/graph`);
  console.log(`WebSocket server ready for streaming`);
});
