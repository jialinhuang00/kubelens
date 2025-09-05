const express = require('express');
const cors = require('cors');
const http = require('http');

const app = express();
const PORT = 3000;

app.use(cors({
  origin: ['http://localhost:4200', 'https://kubevisualize.jialin00.com'],
  credentials: true
}));

app.use((req, res, next) => {
  if (!req.url.startsWith('/api/')) {
    return next();
  }
  const apiPath = req.url.replace('/api', '');
  const options = {
    hostname: 'localhost',
    port: 8090,
    path: apiPath,
    method: req.method,
    headers: req.headers
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.set(proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.log(err)
    console.error('Proxy error:', err.message);
    res.status(500).json({ error: 'Proxy error', details: err.message });
  });

  req.pipe(proxyReq);
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', proxy_target: 'http://localhost:8090' });
});

app.listen(PORT, () => {
  console.log(`🚀 Kubernetes API proxy running on http://localhost:${PORT}`);
  console.log(`📋 Health check: http://localhost:${PORT}/health`);
  console.log(`🔗 Proxying /api/* to http://localhost:8090`);
});