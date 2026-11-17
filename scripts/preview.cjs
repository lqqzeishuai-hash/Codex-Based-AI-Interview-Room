const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { InterviewController } = require('../src/core/controller.cjs');
const { NativeSpeech } = require('../src/core/speech.cjs');
const renderer = path.resolve(__dirname, '../src/renderer');
const controller = new InterviewController({ dataDirectory: process.env.AI_INTERVIEW_DATA_DIR || path.join(os.tmpdir(), 'ai-interview-preview') });
const speech = new NativeSpeech();
const clients = new Set();
const broadcast = event => { for (const response of clients) response.write(`data: ${JSON.stringify(event)}\n\n`); };
controller.on('event', broadcast); speech.on('event', event => broadcast({ type: 'speech', event }));
const allowedOrigin = url => !url || url === `http://127.0.0.1:${server.address().port}`;
const server = http.createServer(async (request, response) => {
  if (!allowedOrigin(request.headers.origin) || !/^127\.0\.0\.1(?::\d+)?$/.test(request.headers.host || '')) { response.writeHead(403).end(); return; }
  const url = new URL(request.url, 'http://127.0.0.1');
  if (url.pathname === '/events') {
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    response.write(': connected\n\n'); clients.add(response); request.on('close', () => clients.delete(response)); return;
  }
  if (url.pathname === '/api' && request.method === 'POST') {
    try {
      let body = ''; for await (const chunk of request) { body += chunk; if (body.length > 100000) throw new Error('请求过大。'); }
      const { method, params = {} } = JSON.parse(body);
      let value;
      if (method === 'project/pick') value = null;
      else if (method === 'window/mini') value = { enabled: Boolean(params.enabled), preview: true };
      else if (method === 'speech/capabilities') value = await speech.start();
      else if (method.startsWith('speech/') && ['listen','stop-listening','speak','stop-speaking'].includes(method.slice(7))) value = await speech.command(method.slice(7), params);
      else value = await controller.invoke(method, params);
      response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ value }));
    } catch (error) { response.writeHead(400, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: error.message })); } return;
  }
  const target = path.resolve(renderer, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
  if (!target.startsWith(renderer + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) { response.writeHead(404).end(); return; }
  const contentType = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' }[path.extname(target)] || 'application/octet-stream';
  response.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' }); fs.createReadStream(target).pipe(response);
});
server.listen(Number(process.env.PORT) || 4173, '127.0.0.1', () => console.log(`AI Interview preview: http://127.0.0.1:${server.address().port}`));
process.on('SIGINT', () => { speech.close(); controller.codex.close(); server.close(); process.exit(); });
