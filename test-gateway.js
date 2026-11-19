'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const http = require('node:http');
const https = require('node:https');
const { PassThrough } = require('node:stream');

// Stub upstream before loading server. Local-only tests; no network call to Cloudflare.
const calls = [];
const original = https.request;
https.request = (opts, callback) => {
  const request = new PassThrough();
  request.on('finish', () => {
    calls.push(opts);
    const reply = new PassThrough();
    reply.statusCode = 200;
    reply.headers = { 'content-type': 'application/json; charset=utf-8', 'set-cookie': ['sid=123; HttpOnly; Secure; Path=/'] };
    callback(reply);
    reply.end(JSON.stringify({ route: opts.path, forwardedOrigin: opts.headers.origin || null }));
  });
  request.setTimeout = () => {};
  request.destroy = PassThrough.prototype.destroy.bind(request);
  return request;
};
process.env.PORT = '0';
const server = require('./server.js');
async function get(path, headers={}) {
  const addr = server.address();
  const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, {headers});
  return { status:res.status, body:await res.text(), headers:res.headers };
}
test('health path works without upstream', async () => {
 const r = await get('/_health');
 assert.equal(r.status,200);
 assert.equal(JSON.parse(r.body).status,'ok');
});
test('requests preserve path and upstream authority', async () => {
 const r = await get('/api/me?x=1');
 assert.equal(r.status,200);
 assert.equal(JSON.parse(r.body).route,'/api/me?x=1');
 assert.equal(calls.at(-1).headers.host,'dentchina-analytics.djfedorov.workers.dev');
});
test('oauth reconnection is blocked', async () => {
 const r = await get('/api/amo-oauth-start');
 assert.equal(r.status,409);
});
test('cross site origin is rejected', async () => {
 const r = await get('/api/me',{origin:'https://attacker.example'});
 assert.equal(r.status,403);
});
test('invalid path is rejected', async () => {
 const r = await get('//another-site.example/path');
 assert.equal(r.status,400);
});
test('client origin rewritten for upstream Worker', async () => {
 const addr = server.address();
 const r = await get('/api/me',{ origin:`https://127.0.0.1:${addr.port}`, host:`127.0.0.1:${addr.port}` });
 assert.equal(r.status,200);
 assert.equal(JSON.parse(r.body).forwardedOrigin,'https://dentchina-analytics.djfedorov.workers.dev');
});
test.after(() => {server.close(); https.request=original;});
