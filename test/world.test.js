import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialState, pickBlooms, applyChronicle, updateStagnation, migrateState, sanitizeResult,
} from '../src/rules.js';
import { makeScenario } from './fixtures.js';

const start = () => createInitialState(makeScenario());
const seed = (o) => ({
  id: 'S1', text: '씨앗', turn: 1, input: '', fate: 'boon', finale: false, ripen: 5,
  status: 'planted', bloomTurn: null, outcome: '', ...o,
});
const seq = (...values) => () => (values.length ? values.shift() : 0.5);
const empty = { seeds: [], knowledge: [], people: [], allies: [], items: [], places: [], enemies: [] };

test('pickBlooms: the most overdue seed blooms, one per turn', () => {
  const s = start();
  s.turn = 6;
  s.seeds.push(seed({ id: 'S1', ripen: 5 }), seed({ id: 'S2', ripen: 4, fate: 'bane' }), seed({ id: 'S3', ripen: 9 }));
  assert.deepEqual(pickBlooms(s), { kind: 'due', seeds: [{ id: 'S2', text: '씨앗', turn: 1, fate: 'bane' }] });
  assert.deepEqual([s.seeds[1].status, s.seeds[1].bloomTurn], ['bloomed', 6]);
  assert.equal(pickBlooms(s).seeds[0].id, 'S1');
  assert.equal(pickBlooms(s), null);
});

test('pickBlooms: all finale seeds bloom at the goal location', () => {
  const s = start();
  s.turn = 3;
  s.player.location_id = 'altar';
  s.seeds.push(seed({ id: 'S1', finale: true, ripen: null }), seed({ id: 'S2', finale: true, ripen: null, fate: 'twist' }), seed({ id: 'S3', ripen: 2 }));
  const b = pickBlooms(s);
  assert.equal(b.kind, 'finale');
  assert.deepEqual(b.seeds.map((x) => x.id), ['S1', 'S2']);
  assert.equal(s.seeds[2].status, 'planted');
});

test('pickBlooms: stagnation pulls the nearest seed early, or asks for an event', () => {
  const s = start();
  s.turn = 4;
  s.stagnation = 2;
  s.seeds.push(seed({ id: 'S1', ripen: 20 }), seed({ id: 'S2', ripen: 12 }), seed({ id: 'S3', finale: true, ripen: null }));
  assert.equal(pickBlooms(s), null);
  s.stagnation = 3;
  assert.deepEqual(pickBlooms(s).kind, 'stagnation');
  assert.equal(s.seeds[1].status, 'bloomed');
  const bare = start();
  bare.stagnation = 3;
  assert.deepEqual(pickBlooms(bare), { kind: 'event', seeds: [] });
});

test('applyChronicle plants seeds with fate and timing from the rng (morality-blind)', () => {
  const s = start();
  const added = applyChronicle(
    s,
    { new_seeds: ['새끼 늑대를 도왔다', '버튼을 눌렀다', '깡패 두목을 때렸다', '네 번째는 버려짐'] },
    { turn: 2, input: '입력', grade: 'failure', rng: seq(0.1, 0.9, 0.5, 0.5, 0.1, 0.8, 0.95, 0.0) },
  );
  assert.deepEqual(added.seeds, ['새끼 늑대를 도왔다', '버튼을 눌렀다', '깡패 두목을 때렸다']);
  assert.deepEqual(
    s.seeds.map((x) => [x.text, x.fate, x.finale, x.ripen, x.status, x.turn, x.input]),
    [
      ['새끼 늑대를 도왔다', 'boon', false, 9, 'planted', 2, '입력'],
      ['버튼을 눌렀다', 'bane', true, null, 'planted', 2, '입력'],
      ['깡패 두목을 때렸다', 'twist', false, 5, 'planted', 2, '입력'],
    ],
  );
});

test('applyChronicle adds people, allies, items, places, enemies, knowledge with limits', () => {
  const s = start();
  const raw = {
    new_knowledge: ['지하에 통로가 있다', '지하에 통로가 있다', '종이 울리면 쥐가 몰린다'],
    new_people: [
      { name: '회색늑대', description: '채팅 상대', here: false, ally: false },
      { name: '떠돌이 상인', description: '수상한 상인', here: true, ally: true },
      { name: '세 번째', description: '', here: true },
    ],
    new_allies: ['늙은 수도사'],
    new_items: [{ name: '전선 뭉치', description: '구리선', obtained: true }, { name: '낡은 쪽지', description: '글씨', obtained: false }],
    new_places: [{ name: '지하 통로', description: '축축하다' }],
    new_enemies: [{ name: '들개', hp: 9 }],
  };
  const added = applyChronicle(s, raw, { turn: 3, input: '입력', grade: 'success', rng: seq() });
  assert.deepEqual(added.people, ['회색늑대', '떠돌이 상인']);
  assert.deepEqual(added.allies, ['떠돌이 상인', '늙은 수도사']);
  assert.deepEqual(added.knowledge, ['지하에 통로가 있다', '종이 울리면 쥐가 몰린다']);
  const wolf = s.npcs.find((n) => n.name === '회색늑대');
  assert.deepEqual([wolf.remote, wolf.location_id, wolf.met.how, wolf.origin], [true, null, '원격 연결', 'story']);
  assert.equal(s.npcs.find((n) => n.name === '떠돌이 상인').location_id, 'hall');
  assert.equal(s.npcs.find((n) => n.id === 'monk').ally, true);
  const wire = s.items.find((i) => i.name === '전선 뭉치');
  assert.ok(s.player.inventory.includes(wire.id));
  assert.deepEqual([wire.heal, wire.acquired.how], [0, '이야기 중 획득']);
  assert.equal(s.items.find((i) => i.name === '낡은 쪽지').location_id, 'hall');
  const tunnel = s.locations.find((l) => l.name === '지하 통로');
  assert.deepEqual(tunnel.exits, [{ to: 'hall', requires_item_id: null }]);
  assert.ok(s.locations.find((l) => l.id === 'hall').exits.some((x) => x.to === tunnel.id));
  assert.equal(s.player.location_id, 'hall', 'new places are not entered');
  assert.deepEqual(s.enemies.find((e) => e.name === '들개'), { id: s.enemies.at(-1).id, name: '들개', location_id: 'hall', hp: 3, origin: 'story' });
});

test('applyChronicle: items are not obtained on failure; junk and duplicates ignored; empty place described', () => {
  const s = start();
  s.locations[0].description = '';
  const added = applyChronicle(s, {
    new_items: [{ name: '녹슨 단검', obtained: true }, { name: '반짝이는 돌', description: '', obtained: true }, { nope: 1 }],
    new_people: 'not an array',
    current_place_description: '먼지가 가득한 입구.',
  }, { turn: 1, input: '', grade: 'failure', rng: seq() });
  assert.deepEqual(added.items, ['반짝이는 돌']);
  assert.equal(s.items.find((i) => i.name === '반짝이는 돌').location_id, 'hall');
  assert.equal(s.player.inventory.length, 2);
  assert.equal(s.locations[0].description, '먼지가 가득한 입구.');
  assert.deepEqual(applyChronicle(s, undefined, { turn: 1, input: '', grade: 'success', rng: seq() }), empty);
});

test('applyChronicle records outcomes of seeds that bloomed', () => {
  const s = start();
  s.seeds.push(seed({ id: 'S1', status: 'bloomed', bloomTurn: 4 }), seed({ id: 'S2' }));
  applyChronicle(s, { seed_outcomes: [{ id: 'S1', outcome: '늑대 무리가 길을 열어주었다' }, { id: 'S2', outcome: '무시됨' }] },
    { turn: 4, input: '', grade: 'success', rng: seq() });
  assert.deepEqual(s.seeds.map((x) => x.outcome), ['늑대 무리가 길을 열어주었다', '']);
});

test('updateStagnation resets on progress, otherwise counts up', () => {
  const prev = start();
  const same = structuredClone(prev);
  updateStagnation(prev, same, empty);
  assert.equal(same.stagnation, 1);
  const moved = structuredClone(prev);
  moved.visited.push('corridor');
  updateStagnation(prev, moved, empty);
  assert.equal(moved.stagnation, 0);
  const planted = structuredClone({ ...prev, stagnation: 2 });
  updateStagnation({ ...prev, stagnation: 2 }, planted, { ...empty, seeds: ['x'] });
  assert.equal(planted.stagnation, 0);
});

test('migrateState upgrades a v1.2 save', () => {
  const s = start();
  for (const k of ['seeds', 'knowledge', 'seq', 'stagnation', 'visitedTurns', 'endingTone']) delete s[k];
  for (const i of s.items) delete i.acquired;
  s.player.traits = [{ id: 'b25', name: '고소공포증', good: false, group: 'heights', description: '', effects: { action: { move: -10 } } }];
  s.history = [{ input: 'a', result: {}, narration: 'n' }];
  const m = migrateState(s);
  assert.deepEqual([m.seeds, m.knowledge, m.stagnation, m.visitedTurns], [[], [], 0, { hall: null }]);
  assert.deepEqual(m.player.traits[0].effects, {});
  assert.equal(m.player.traits[0].check, 15);
  assert.equal(m.items.find((i) => i.id === 'dagger').acquired.how, '이전 버전에서 획득');
  assert.equal(m.items.find((i) => i.id === 'grail').acquired, null);
  assert.equal(m.history[0].turn, 1);
});

test('sanitizeResult hides seed fates', () => {
  const r = { grade: 'success', bloom: { kind: 'due', seeds: [{ id: 'S1', text: 't', turn: 1, fate: 'bane' }] } };
  assert.deepEqual(sanitizeResult(r).bloom.seeds, [{ id: 'S1', text: 't', turn: 1 }]);
  assert.equal(r.bloom.seeds[0].fate, 'bane', 'original untouched');
  assert.deepEqual(sanitizeResult({ grade: 'success' }), { grade: 'success' });
});
