import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createOllamaClient } from '../src/llm.js';

function fakeOllama() {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    if (req.url === '/api/tags') {
      res.end(JSON.stringify({ models: [{ name: 'gemma4:12b', model: 'gemma4:12b' }] }));
      return;
    }
    const data = JSON.parse(body);
    requests.push(data);
    if (!data.stream) {
      res.end(JSON.stringify({ message: { content: '{"a":1}' } }));
      return;
    }
    // 한글 멀티바이트가 청크 경계에서 잘리도록 쪼개서 보낸다
    const full = Buffer.from('{"message":{"content":"안녕"}}\n{"message":{"content":"하세요"}}\n{"done":true}\n');
    res.write(full.subarray(0, 25));
    setTimeout(() => res.end(full.subarray(25)), 10);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, requests, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

test('json sends schema and options, parses content', async () => {
  const { server, requests, url } = await fakeOllama();
  try {
    const llm = createOllamaClient({ baseUrl: url });
    const out = await llm.json([{ role: 'user', content: 'x' }], { type: 'object' }, { temperature: 0.2 });
    assert.deepEqual(out, { a: 1 });
    const r = requests[0];
    assert.equal(r.model, 'gemma4:12b');
    assert.equal(r.think, false);
    assert.equal(r.keep_alive, '30m');
    assert.equal(r.stream, false);
    assert.deepEqual(r.format, { type: 'object' });
    assert.deepEqual(r.options, { num_ctx: 16384, temperature: 0.2 });
  } finally {
    server.close();
  }
});

test('stream yields content chunks across split bytes', async () => {
  const { server, requests, url } = await fakeOllama();
  try {
    const llm = createOllamaClient({ baseUrl: url });
    const chunks = [];
    for await (const c of llm.stream([{ role: 'user', content: 'x' }])) chunks.push(c);
    assert.deepEqual(chunks, ['안녕', '하세요']);
    assert.equal(requests[0].options.temperature, 0.6);
  } finally {
    server.close();
  }
});

test('status reports ollama and model availability', async () => {
  const { server, url } = await fakeOllama();
  try {
    assert.deepEqual(await createOllamaClient({ baseUrl: url }).status(), { ollama: true, model: true });
    assert.deepEqual(await createOllamaClient({ baseUrl: url, model: 'other' }).status(), { ollama: true, model: false });
  } finally {
    server.close();
  }
  assert.deepEqual(await createOllamaClient({ baseUrl: 'http://127.0.0.1:9' }).status(), { ollama: false, model: false });
});
