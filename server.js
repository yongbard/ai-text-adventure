import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createOllamaClient } from './src/llm.js';
import { createSaveStore } from './src/save.js';
import { createGame } from './src/game.js';

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(import.meta.dirname, 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

const game = createGame({
  llm: createOllamaClient({ model: process.env.MODEL || 'gemma4:12b' }),
  store: createSaveStore(path.join(import.meta.dirname, 'saves')),
});

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(PUBLIC, urlPath === '/' ? 'index.html' : path.normalize(urlPath));
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/api/status') return sendJson(res, 200, await game.status());
    if (req.method === 'GET' && req.url === '/api/load') {
      const state = game.load();
      return state ? sendJson(res, 200, state) : sendJson(res, 404, { error: '저장된 게임이 없습니다' });
    }
    if (req.method === 'POST' && req.url === '/api/new') {
      const { genre } = await readJson(req);
      return sendJson(res, 200, await game.newGame(String(genre || '다크 판타지').slice(0, 100)));
    }
    if (req.method === 'POST' && req.url === '/api/turn') {
      const { input } = await readJson(req);
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8' });
      const emit = (event) => res.write(`${JSON.stringify(event)}\n`);
      try {
        await game.turn(input, emit);
      } catch (err) {
        emit({ type: 'error', message: err.message });
      }
      return res.end();
    }
    if (req.method === 'GET') return serveStatic(req, res);
    sendJson(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
});

server.listen(PORT, '127.0.0.1', () => console.log(`🎲 AI 텍스트 어드벤처: http://localhost:${PORT}`));
