import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import type { AddressInfo } from 'net';
import WebSocket from 'ws';

import { mountWebSocket, originAllowed } from './execute';

/**
 * A page on another site can open ws://127.0.0.1:3042 from the user's browser;
 * the server must refuse it by Origin, while its own page and non-browser
 * clients still get through.
 */
describe('originAllowed', () => {
  const req = (host: string, origin?: string) => ({ headers: { host, ...(origin ? { origin } : {}) } });

  it('lets clients without an Origin through (curl, wscat)', () => {
    assert.equal(originAllowed(req('127.0.0.1:3042')), true);
  });
  it('accepts its own page and the ng serve proxy', () => {
    assert.equal(originAllowed(req('localhost:3042', 'http://localhost:3042')), true);
    assert.equal(originAllowed(req('localhost:4200', 'http://localhost:4200')), true);
  });
  it('rejects another site, another port, and garbage', () => {
    assert.equal(originAllowed(req('127.0.0.1:3042', 'https://evil.example')), false);
    assert.equal(originAllowed(req('localhost:3042', 'http://localhost:4200')), false);
    assert.equal(originAllowed(req('localhost:3042', '::not a url')), false);
  });
});

describe('WebSocket handshake', () => {
  let server: http.Server;
  let port: number;

  before(async () => {
    server = http.createServer();
    mountWebSocket(server);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });
  after(() => new Promise<void>(resolve => server.close(() => resolve())));

  const dial = (origin: string) => new Promise<number | 'open'>(resolve => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/execute/stream/ws`, { origin });
    ws.on('open', () => { ws.close(); resolve('open'); });
    ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
    ws.on('error', () => {});
  });

  it('refuses a page from another site with 403', async () => {
    assert.equal(await dial('https://evil.example'), 403);
  });
  it('opens for its own page', async () => {
    assert.equal(await dial(`http://127.0.0.1:${port}`), 'open');
  });
});
