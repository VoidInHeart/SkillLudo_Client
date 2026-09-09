import assert from 'node:assert/strict';
import test from 'node:test';
import { PREVIEW_SERVER_URL, resolveServerUrl } from '../assets/scripts/network/ServerEndpoint';

const page = (url: string) => new URL(url);

test('C08: public pages use their own host, port and TLS scheme', () => {
  assert.equal(resolveServerUrl('', page('http://81.70.145.148')), 'ws://81.70.145.148');
  assert.equal(resolveServerUrl('', page('https://game.example.com:8443/play')), 'wss://game.example.com:8443');
  assert.equal(resolveServerUrl('', page('http://[2001:db8::1]:8080')), 'ws://[2001:db8::1]:8080');
});

test('C09: Creator and LAN previews connect to the public test backend', () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]', '192.168.1.10', '10.0.0.2', '172.16.0.3', '172.31.0.3', 'preview.local']) {
    assert.equal(resolveServerUrl('', page(`http://${host}:7456`)), PREVIEW_SERVER_URL, host);
  }
  assert.equal(resolveServerUrl('', page('http://172.32.0.3')), 'ws://172.32.0.3');
});

test('C10: explicit endpoints override automatic selection, including local development', () => {
  assert.equal(resolveServerUrl(' ws://127.0.0.1:3000 ', page('http://81.70.145.148')), 'ws://127.0.0.1:3000');
  assert.equal(resolveServerUrl('wss://game.example.com/ws'), 'wss://game.example.com/ws');
});

test('C11: WeChat and file previews do not require a DOM or URL global', () => {
  assert.equal(resolveServerUrl(), PREVIEW_SERVER_URL);
  assert.equal(resolveServerUrl('  ', { protocol: 'file:', hostname: '', host: '' }), PREVIEW_SERVER_URL);
});
