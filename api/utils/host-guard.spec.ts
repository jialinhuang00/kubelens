import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { hostAllowed, hostPolicy, hostnameOf } from './host-guard';

describe('hostnameOf', () => {
  it('drops the port and lowercases', () => {
    assert.equal(hostnameOf('LocalHost:3042'), 'localhost');
    assert.equal(hostnameOf('[::1]:3042'), '[::1]');
    assert.equal(hostnameOf(undefined), null);
  });
});

describe('hostAllowed', () => {
  it('default bind takes loopback names only', () => {
    const p = hostPolicy({});
    assert.equal(p.open, false);
    for (const h of ['localhost:3042', '127.0.0.1:3042', '[::1]:3042']) assert.equal(hostAllowed(h, p), true, h);
    assert.equal(hostAllowed('evil.example:3042', p), false, 'DNS rebinding name');
    assert.equal(hostAllowed(undefined, p), false, 'no Host header');
  });

  it('a specific --host address is ours too', () => {
    const p = hostPolicy({ HOST: '192.168.0.10' });
    assert.equal(hostAllowed('192.168.0.10:3042', p), true);
    assert.equal(hostAllowed('evil.example:3042', p), false);
  });

  it('KUBELENS_ALLOWED_HOSTS adds names', () => {
    const p = hostPolicy({ HOST: '0.0.0.0', KUBELENS_ALLOWED_HOSTS: 'kubelens.example.com, 203.0.113.5' });
    assert.equal(p.open, false);
    assert.equal(hostAllowed('kubelens.example.com', p), true);
    assert.equal(hostAllowed('203.0.113.5:8080', p), true);
    assert.equal(hostAllowed('localhost:8080', p), true);
    assert.equal(hostAllowed('evil.example:8080', p), false);
  });

  it('0.0.0.0 without a list leaves the check off', () => {
    const p = hostPolicy({ HOST: '0.0.0.0' });
    assert.equal(p.open, true);
    assert.equal(hostAllowed('anything:8080', p), true);
  });
});
