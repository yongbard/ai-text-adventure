import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeScenario, validateScenario, generateScenario } from '../src/scenario.js';
import { makeScenario } from './fixtures.js';

// LLM이 내는 형태: null 대신 ""
function makeRaw() {
  const s = makeScenario();
  s.items.forEach((i) => { i.location_id ??= ''; });
  s.locations.forEach((l) => l.exits.forEach((x) => { x.requires_item_id ??= ''; }));
  return s;
}

test('normalizeScenario turns LLM output into the fixture', () => {
  assert.deepEqual(normalizeScenario(makeRaw()), makeScenario());
  assert.deepEqual(validateScenario(normalizeScenario(makeRaw())), []);
});

test('normalizeScenario fixes stats, clamps numbers, handles "null"', () => {
  const raw = makeRaw();
  raw.stats = { str: 9, dex: 0, int: 5 };
  raw.items[0].location_id = 'null';
  raw.items[3].heal = 9;
  raw.enemies[0].hp = 0;
  raw.enemies[1].hp = 2;
  const s = normalizeScenario(raw);
  assert.deepEqual(s.stats, { str: 5, dex: 2, int: 5 });
  assert.equal(s.items[0].location_id, null);
  assert.equal(s.items[3].heal, 5);
  assert.equal(s.enemies[0].hp, 1);
  assert.equal(s.enemies[1].hp, 6, 'boss hp forced to 6');
});

test('normalizeScenario adds missing reverse exits', () => {
  const raw = makeRaw();
  raw.locations.find((l) => l.id === 'altar').exits = [];
  const altar = normalizeScenario(raw).locations.find((l) => l.id === 'altar');
  assert.deepEqual(altar.exits, [{ to: 'corridor', requires_item_id: 'silver_key' }]);
});

test('validateScenario catches unreachable locations', () => {
  const s = makeScenario();
  s.locations.find((l) => l.id === 'storage').exits = [{ to: 'corridor', requires_item_id: null }];
  s.locations.find((l) => l.id === 'crypt').exits = [];
  assert.ok(validateScenario(s).includes('crypt: 도달 불가'));
});

test('validateScenario catches key locked behind its own door', () => {
  const s = makeScenario();
  s.items.find((i) => i.id === 'silver_key').location_id = 'altar';
  assert.ok(validateScenario(s).includes('altar: 도달 불가'));
});

test('validateScenario catches bad references and rules', () => {
  const s = makeScenario();
  s.goal_item_id = 'nope';
  s.enemies.find((e) => e.id === 'lich').location_id = 'hall';
  s.locations[0].exits.push({ to: 'moon', requires_item_id: null });
  const errors = validateScenario(s);
  assert.ok(errors.includes('goal_item_id 잘못됨'));
  assert.ok(errors.includes('보스가 목표 장소에 없음'));
  assert.ok(errors.includes('hall: 출구 대상 moon 없음'));
});

test('validateScenario rejects goal item in start inventory', () => {
  const s = makeScenario();
  s.items.find((i) => i.id === 'grail').location_id = null;
  assert.ok(validateScenario(s).includes('목표 아이템이 시작 소지품임'));
});

function fakeLlm(responses) {
  const calls = [];
  return {
    calls,
    async json(messages, schema, opts) {
      calls.push({ messages, schema, opts });
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

test('generateScenario retries until valid', async () => {
  const bad = makeRaw();
  bad.goal_item_id = 'nope';
  const llm = fakeLlm([new Error('JSON 깨짐'), bad, makeRaw()]);
  const s = await generateScenario(llm, '다크 판타지');
  assert.equal(s.title, '봉인된 성배');
  assert.equal(llm.calls.length, 3);
  assert.match(llm.calls[0].messages.at(-1).content, /다크 판타지/);
});

test('normalizeScenario keeps job and defaults its name', () => {
  assert.equal(normalizeScenario(makeRaw()).job.specialty, '검술');
  const raw = makeRaw();
  delete raw.job;
  assert.deepEqual(normalizeScenario(raw).job, { name: '방랑자', description: '', specialty: '' });
});

test('validateScenario requires minimum counts', () => {
  const s = makeScenario();
  s.items = s.items.filter((i) => i.id !== 'potion');
  s.npcs = [];
  const errors = validateScenario(s);
  assert.ok(errors.includes('아이템이 너무 적음'));
  assert.ok(errors.includes('NPC가 너무 적음'));
});

test('generateScenario passes the requested job', async () => {
  const llm = fakeLlm([makeRaw()]);
  await generateScenario(llm, '다크 판타지', '퇴마사');
  assert.match(llm.calls[0].messages.at(-1).content, /직업: 퇴마사/);
});

test('generateScenario gives up after 3 attempts', async () => {
  const bad = () => ({ ...makeRaw(), goal_item_id: 'nope' });
  const llm = fakeLlm([bad(), bad(), bad(), makeRaw()]);
  await assert.rejects(generateScenario(llm, 'SF'), /시나리오 생성 실패/);
  assert.equal(llm.calls.length, 3);
});
