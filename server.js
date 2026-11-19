'use strict';
const http = require('node:http');
const https = require('node:https');

const UPSTREAM_HOST = 'dentchina-analytics.djfedorov.workers.dev';
const UPSTREAM_ORIGIN = `https://${UPSTREAM_HOST}`;
const PORT = Number(process.env.PORT || 10000);

const forbidden = /^\/api\/amo-oauth-(?:start|page|callback)(?:[/?]|$)/;

const server = http.createServer((req, res) => {
  const path = req.url || '/';
  if (path === '/_health') {
    res.writeHead(200, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'});
    return res.end(JSON.stringify({status:'ok'}));
  }
  if (!path.startsWith('/') || path.startsWith('//')) {
    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({error: 'Invalid path'}));
  }
  if (forbidden.test(path)) {
    res.writeHead(409, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(JSON.stringify({ error: 'Переподключение amoCRM через запасной адрес недоступно; текущая синхронизация остаётся на основном Worker.' }));
  }
  const originalOrigin = `https://${req.headers.host || ''}`;
  const requestOrigin = req.headers.origin;
  if (requestOrigin && requestOrigin !== originalOrigin) {
    res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ error: 'Запрос отклонён: неверный источник' }));
  }
  const headers = { ...req.headers, host: UPSTREAM_HOST, 'accept-encoding': 'identity' };
  delete headers.connection;
  delete headers['proxy-connection'];
  delete headers['x-forwarded-host'];
  if (requestOrigin) headers.origin = UPSTREAM_ORIGIN;
  if (typeof headers.referer === 'string' && headers.referer.startsWith(originalOrigin)) {
    headers.referer = UPSTREAM_ORIGIN + headers.referer.slice(originalOrigin.length);
  }
  const request = https.request({
    hostname: UPSTREAM_HOST,
    port: 443,
    path,
    method: req.method,
    headers,
    timeout: 25000
  }, upstream => {
    const out = { ...upstream.headers, 'cache-control': 'no-store, max-age=0' };
    delete out.connection;
    delete out['transfer-encoding'];
    if (typeof out.location === 'string' && out.location.startsWith(UPSTREAM_ORIGIN)) {
      out.location = originalOrigin + out.location.slice(UPSTREAM_ORIGIN.length);
    }
    res.writeHead(upstream.statusCode || 502, out);
    upstream.pipe(res);
  });
  request.on('timeout', () => request.destroy(new Error('upstream timeout')));
  request.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    }
    if (!res.writableEnded) res.end(JSON.stringify({ error: 'Не удалось связаться с основным сервером аналитики' }));
  });
  req.pipe(request);
}).listen(PORT, '0.0.0.0');
module.exports = server;
