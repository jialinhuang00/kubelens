import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';

const app = express();
const server = http.createServer(app);
// Number(), not the raw env string: listen() takes a number, and an unset or
// unparseable PORT falls through to the default the same way `|| 3042` did.
const PORT = Number(process.env.PORT) || 3042;

// Always load snapshot handler — per-request snapshot mode via ?snapshot=true
import './utils/snapshot-handler';
console.log('snapshot-handler loaded — use ?snapshot=true on requests to enable snapshot mode');

app.use(express.json());

// GET /api/debug/memory — server RSS for memory leak testing
app.get('/api/debug/memory', (_req: Request, res: Response) => {
  const m = process.memoryUsage();
  res.json({
    rss:      Math.round(m.rss      / 1024 / 1024),
    heapUsed: Math.round(m.heapUsed / 1024 / 1024),
    heapTotal:Math.round(m.heapTotal/ 1024 / 1024),
  });
});

// Mount routes
import { router as executeRouter, mountWebSocket } from './routes/execute';
import graphRouter from './routes/graph';
import statusRouter from './routes/status';
import registryRouter from './routes/registry';
import snapshotRouter from './routes/snapshot';
import configRouter from './routes/config';
import discoveryRouter from './routes/discovery';

app.use('/api', executeRouter);
app.use('/api', graphRouter);
app.use('/api', statusRouter);
app.use('/api', registryRouter);
app.use('/api', snapshotRouter);
app.use('/api', configRouter);
app.use('/api', discoveryRouter);

// WebSocket streaming for kubectl long-running commands
mountWebSocket(server);

// Production: serve Angular build output (skipped in dev — dist/ doesn't exist)
const distPath = path.join(__dirname, '..', 'dist', 'kubelens', 'browser');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('/{*splat}', (req: Request, res: Response) => {
    // An /api/ path that reached here matched no route. Say so; falling through
    // without a response left the request open until the client gave up.
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: `No such endpoint: ${req.path}` });
    }
    // Filename plus root, not one joined absolute path. sendFile runs the path
    // it is given through send, which refuses any segment starting with a dot —
    // and under npx the package lives in ~/.npm/_npx/<hash>/, so the joined form
    // made every deep link 404 while / kept working.
    res.sendFile('index.html', { root: distPath });
  });
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`kubelens server running on http://localhost:${PORT}`);
  console.log(`Realtime ping: http://localhost:${PORT}/api/realtime/ping`);
  console.log(`Graph endpoint: http://localhost:${PORT}/api/graph`);
  console.log(`WebSocket streaming ready on /api/execute/stream/ws`);
});
