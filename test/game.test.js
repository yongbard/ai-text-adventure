import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/game.js';
import { createInitialState } from '../src/rules.js';
import { makeScenario, fixedRng } from './fixtures.js';

function makeRaw() {
  const s = makeScenario();
  s.items.forEach((i) => { i.location_id ??= ''; });
  s.locations.forEach((l) => l.exits.forEach((x) => { x.requires_item_id ??= ''; }));
  return s;
}

function fakeLlm({ json = [], stream = [] } = {}) {
  const calls = { json: 0, stream: 0, jsonMessages: [] };
  return {
    model: 'fake',
    calls,
    async status() {
      return { ollama: true, model: true };
    },
    async json(messages) {
      calls.json += 1;
      calls.jsonMessages.push(messages);
      const next = json.shift();
      if (next instanceof Error) throw next;
      return next;
    },
    async *stream() {
      calls.stream += 1;
      const next = stream.shift();
      if (next instanceof Error) throw next;
      for (const c of next ?? []) yield c;
    },
  };
}

function memoryStore(initial = null) {
  let data = initial;
  return {
    exists: () => data !== null,
    save: (s) => { data = structuredClone(s); },
    load: () => structuredClone(data),
    get data() { return data; },
  };
}

const collect = () => {
  const events = [];
  return { events, emit: (e) => events.push(e), types: () => events.map((e) => e.type) };
};

test('newGame generates scenario, saves, returns public state', async () => {
  const store = memoryStore();
  const game = createGame({ llm: fakeLlm({ json: [makeRaw()] }), store });
  const pub = await game.newGame('다크 판타지');
  assert.equal(pub.title, '봉인된 성배');
  assert.equal(pub.truth, null);
  assert.equal(store.data.turn, 0);
});

test('newGame passes job and draws 2 good + 2 bad traits', async () => {
  const llm = fakeLlm({ json: [makeRaw()] });
  const store = memoryStore();
  const pub = await createGame({ llm, store, rng: fixedRng(50) }).newGame('다크 판타지', '퇴마사');
  assert.match(llm.calls.jsonMessages[0].at(-1).content, /직업: 퇴마사/);
  assert.equal(pub.job.name, '떠돌이 기사');
  assert.deepEqual(pub.traits.map((t) => t.good), [true, true, false, false]);
  assert.equal(store.data.player.traits.length, 4);
});

test('narration naming unknown entities is regenerated and replaced', async () => {
  const llm = fakeLlm({
    json: [makeRaw(), { action: 'examine', trivial: true }],
    stream: [['창고의 은빛 열쇠가 떠오른다.'], ['당신은 주위를 둘러본다.']],
  });
  const store = memoryStore();
  const game = createGame({ llm, store, rng: fixedRng(50) });
  await game.newGame('SF');
  const c = collect();
  await game.turn('둘러본다', c.emit);
  assert.deepEqual(c.types(), ['roll', 'text', 'replace', 'state']);
  assert.deepEqual(c.events[2], { type: 'replace', target: 'text', text: '당신은 주위를 둘러본다.' });
  assert.equal(store.data.history[0].narration, '당신은 주위를 둘러본다.');
});

test('turn emits roll, text, state in order and saves', async () => {
  const store = memoryStore();
  const llm = fakeLlm({
    json: [makeRaw(), { action: 'move', target: '회랑', trivial: true }],
    stream: [['당신은 ', '회랑으로 간다.']],
  });
  const game = createGame({ llm, store, rng: fixedRng(50) });
  await game.newGame('다크 판타지');
  const c = collect();
  await game.turn('회랑으로 간다', c.emit);
  assert.deepEqual(c.types(), ['roll', 'text', 'text', 'state']);
  assert.equal(store.data.player.location_id, 'corridor');
  assert.equal(store.data.history[0].narration, '당신은 회랑으로 간다.');
  assert.equal(c.events.at(-1).state.location.name, '무너진 회랑');
});

test('interpret retries on bad JSON', async () => {
  const llm = fakeLlm({
    json: [makeRaw(), new Error('bad'), new Error('bad'), { action: 'examine', trivial: true }],
    stream: [['주변을 본다.']],
  });
  const game = createGame({ llm, store: memoryStore(), rng: fixedRng(50) });
  await game.newGame('SF');
  const c = collect();
  await game.turn('둘러본다', c.emit);
  assert.equal(llm.calls.json, 4);
  assert.equal(c.types()[0], 'roll');
});

test('interpret failing 3 times emits error and does not use a turn', async () => {
  const store = memoryStore();
  const llm = fakeLlm({ json: [makeRaw(), new Error('x'), new Error('x'), new Error('x')] });
  const game = createGame({ llm, store, rng: fixedRng(50) });
  await game.newGame('SF');
  const c = collect();
  await game.turn('???', c.emit);
  assert.deepEqual(c.types(), ['error']);
  assert.equal(store.data.turn, 0);
});

test('narration failure falls back to code text', async () => {
  const llm = fakeLlm({
    json: [makeRaw(), { action: 'move', target: '회랑', trivial: true }],
    stream: [new Error('ollama down')],
  });
  const game = createGame({ llm, store: memoryStore(), rng: fixedRng(50) });
  await game.newGame('SF');
  const c = collect();
  await game.turn('회랑으로 간다', c.emit);
  const text = c.events.find((e) => e.type === 'text').text;
  assert.match(text, /성공/);
  assert.match(text, /무너진 회랑\(으\)로 이동/);
});

test('ending streams epilogue and reveals truth', async () => {
  const s = createInitialState(makeScenario());
  s.player.hp = 1;
  const store = memoryStore(s);
  const llm = fakeLlm({
    json: [{ action: 'other', base_chance: 10, risk: 'deadly' }],
    stream: [['당신은 쓰러졌다.'], ['모든 것이 끝났다.']],
  });
  const game = createGame({ llm, store, rng: fixedRng(90) });
  game.load();
  const c = collect();
  await game.turn('절벽에서 뛰어내린다', c.emit);
  assert.deepEqual(c.types(), ['roll', 'text', 'epilogue', 'state']);
  const final = c.events.at(-1).state;
  assert.equal(final.ending, 'death');
  assert.equal(final.epilogue, '모든 것이 끝났다.');
  assert.equal(final.truth, '성배는 사실 리치의 심장이다.');
});

test('turn rejects missing game, empty input, finished game', async () => {
  const game = createGame({ llm: fakeLlm(), store: memoryStore() });
  assert.equal(game.load(), null);
  await assert.rejects(game.turn('x', () => {}), /진행 중인 게임이 없습니다/);
  const s = createInitialState(makeScenario());
  const g2 = createGame({ llm: fakeLlm(), store: memoryStore(s) });
  g2.load();
  await assert.rejects(g2.turn('   ', () => {}), /행동을 입력해 주세요/);
  s.ending = 'death';
  const g3 = createGame({ llm: fakeLlm(), store: memoryStore(s) });
  g3.load();
  await assert.rejects(g3.turn('x', () => {}), /이미 끝난 게임입니다/);
});
