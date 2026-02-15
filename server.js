const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ['http://localhost:4200', 'https://kubevisualize.jialin00.com'],
    methods: ['GET', 'POST']
  }
});
const PORT = 3000;

// Always load mock-k8s module — per-request mock mode via ?mock=true
require('./mock-k8s');
console.log('mock-k8s loaded — use ?mock=true on requests to enable mock mode');

app.use(cors({
  origin: ['http://localhost:4200', 'https://kubevisualize.jialin00.com'],
  credentials: true
}));
app.use(express.json());

// Mount routes
const { router: executeRouter, mountStream } = require('./routes/execute');
const graphRouter = require('./routes/graph');
const statusRouter = require('./routes/status');
const resourceCountsRouter = require('./routes/resource-counts');

// Stream routes need io reference, mount them onto the router before app.use
mountStream(executeRouter, io);

app.use('/api', executeRouter);
app.use('/api', graphRouter);
app.use('/api', statusRouter);
app.use('/api', resourceCountsRouter);

// WebSocket connection
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`kubecmds-viz server running on http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
  console.log(`Graph endpoint: http://localhost:${PORT}/api/graph`);
  console.log(`WebSocket server ready for streaming`);
});
