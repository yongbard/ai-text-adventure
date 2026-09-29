import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialState, checkFeasibility, resolveTurn, checkEnding, publicState, normalizeIntent, rollD100,
} from '../src/rules.js';
import { makeScenario, fixedRng } from './fixtures.js';

const intent = (o) => normalizeIntent({ base_chance: 50, ...o });
const start = () => createInitialState(makeScenario());
const at = (state, locId) => {
  state.player.location_id = locId;
  return state;
};

test('fixedRng yields the requested roll', () => {
  for (let n = 1; n <= 100; n++) assert.equal(rollD100(fixedRng(n)), n);
});

test('initial state: start inventory, location, visited', () => {
  const s = start();
  assert.deepEqual(s.player.inventory, ['dagger', 'torch']);
  assert.equal(s.player.location_id, 'hall');
  assert.deepEqual(s.visited, ['hall']);
  assert.equal(s.player.hp, 10);
  assert.equal(s.turn, 0);
  assert.deepEqual(s.player.stats, { str: 4, dex: 5, int: 3 });
});

test('feasibility: item not in inventory is impossible', () => {
  const r = checkFeasibility(start(), intent({ action: 'attack', items_used: ['레이저총'] }));
  assert.equal(r.ok, false);
  assert.match(r.reason, /레이저총/);
});

test('feasibility: move only through connected exits', () => {
  assert.equal(checkFeasibility(start(), intent({ action: 'move', target: '창고' })).ok, false);
  const ok = checkFeasibility(start(), intent({ action: 'move', target: '회랑' }));
  assert.deepEqual([ok.ok, ok.targetId], [true, 'corridor']);
});

test('feasibility: locked exit needs key', () => {
  const s = at(start(), 'corridor');
  const locked = checkFeasibility(s, intent({ action: 'move', target: '제단' }));
  assert.equal(locked.ok, false);
  assert.match(locked.reason, /은빛 열쇠/);
  s.player.inventory.push('silver_key');
  assert.equal(checkFeasibility(s, intent({ action: 'move', target: '제단' })).ok, true);
});

test('feasibility: take/attack need target here', () => {
  const s = start();
  assert.equal(checkFeasibility(s, intent({ action: 'take', target: '은빛 열쇠' })).ok, false);
  assert.equal(checkFeasibility(s, intent({ action: 'attack', target: '거대 쥐' })).ok, false);
  at(s, 'storage');
  assert.equal(checkFeasibility(s, intent({ action: 'take', target: '은빛 열쇠', items_used: ['은빛 열쇠'] })).ok, true);
});

test('feasibility: using a known item you do not hold is impossible', () => {
  assert.equal(checkFeasibility(start(), intent({ action: 'use', target: '치유 물약' })).ok, false);
});

test('resolveTurn: impossible costs a turn but no hp', () => {
  const s0 = start();
  const { state, result } = resolveTurn(s0, intent({ action: 'move', target: '제단' }), fixedRng(50), '제단으로 간다');
  assert.equal(result.grade, 'impossible');
  assert.equal(result.roll, null);
  assert.equal(state.turn, 1);
  assert.equal(state.player.hp, 10);
  assert.equal(s0.turn, 0, 'original state untouched');
  assert.match(state.log[0], /^1턴: 제단으로 간다 → 불가능/);
});

test('resolveTurn: trivial move succeeds without roll', () => {
  const { state, result } = resolveTurn(start(), intent({ action: 'move', target: '회랑', trivial: true }), fixedRng(99));
  assert.deepEqual([result.kind, result.grade], ['auto', 'success']);
  assert.equal(state.player.location_id, 'corridor');
  assert.deepEqual(state.visited, ['hall', 'corridor']);
  assert.equal(state.dice.rolls, 0);
});

test('resolveTurn: roll success with stat and item bonus', () => {
  const s = at(start(), 'corridor');
  const { state, result } = resolveTurn(
    s,
    intent({ action: 'attack', target: '쥐', base_chance: 30, stat: 'dex', items_used: ['녹슨 단검'], item_bonus: 10 }),
    fixedRng(45),
  );
  assert.deepEqual([result.statMod, result.itemBonus, result.chance, result.roll, result.grade], [10, 10, 50, 45, 'success']);
  assert.equal(state.enemies.find((e) => e.id === 'rat').hp, 0);
  assert.ok(result.changes.includes('거대 쥐 처치'));
});

test('resolveTurn: item bonus ignored when no items used', () => {
  const { result } = resolveTurn(start(), intent({ action: 'examine', base_chance: 30, stat: 'int', item_bonus: 20 }), fixedRng(10));
  assert.deepEqual([result.itemBonus, result.chance], [0, 30]);
});

test('resolveTurn: failure damage by risk, +1 with enemy, x2 on fumble', () => {
  const hall = resolveTurn(start(), intent({ action: 'other', risk: 'high', base_chance: 30 }), fixedRng(90));
  assert.equal(hall.state.player.hp, 7);
  const cor = resolveTurn(at(start(), 'corridor'), intent({ action: 'other', risk: 'high', base_chance: 30 }), fixedRng(90));
  assert.equal(cor.state.player.hp, 6);
  const fum = resolveTurn(start(), intent({ action: 'other', risk: 'medium', base_chance: 30 }), fixedRng(97));
  assert.deepEqual([fum.result.grade, fum.state.player.hp, fum.state.dice.fumbles], ['fumble', 6, 1]);
});

test('resolveTurn: critical deals 4 damage and heals 1', () => {
  const s = at(start(), 'altar');
  s.player.hp = 5;
  const { state, result } = resolveTurn(s, intent({ action: 'attack', target: '리치', stat: 'str' }), fixedRng(1));
  assert.equal(result.grade, 'critical');
  assert.equal(state.enemies.find((e) => e.id === 'lich').hp, 2);
  assert.equal(state.player.hp, 6);
  assert.equal(state.dice.crits, 1);
});

test('resolveTurn: take and use healing item', () => {
  const s = at(start(), 'crypt');
  s.player.hp = 4;
  const took = resolveTurn(s, intent({ action: 'take', target: '물약', trivial: true }), fixedRng(50));
  assert.ok(took.state.player.inventory.includes('potion'));
  const used = resolveTurn(took.state, intent({ action: 'use', target: '치유 물약', trivial: true }), fixedRng(50));
  assert.equal(used.state.player.hp, 7);
  assert.ok(!used.state.player.inventory.includes('potion'));
});

test('checkEnding: death, victory, timeout', () => {
  const s = start();
  s.player.hp = 0;
  assert.equal(checkEnding(s), 'death');
  s.player.hp = 5;
  at(s, 'altar');
  s.player.inventory.push('grail');
  assert.equal(checkEnding(s), null, 'boss alive');
  s.enemies.find((e) => e.id === 'lich').hp = 0;
  assert.equal(checkEnding(s), 'victory');
  const t = start();
  t.turn = 60;
  assert.equal(checkEnding(t), 'timeout');
});

test('resolveTurn sets ending when hp hits 0', () => {
  const s = start();
  s.player.hp = 2;
  const { state } = resolveTurn(s, intent({ action: 'other', risk: 'deadly', base_chance: 10 }), fixedRng(90));
  assert.equal(state.player.hp, 0);
  assert.equal(state.ending, 'death');
});

test('publicState hides secrets until ending', () => {
  const s = start();
  const p = publicState(s);
  assert.equal(p.truth, null);
  assert.equal(JSON.stringify(p).includes('리치의 심장'), false);
  assert.equal(JSON.stringify(p).includes('은빛 열쇠는 창고에'), false);
  assert.deepEqual(p.location, { name: '성당 입구', description: '먼지 쌓인 입구.', exits: [{ name: '무너진 회랑', locked: false }] });
  assert.deepEqual(p.inventory.map((i) => i.name), ['녹슨 단검', '횃불']);
  s.ending = 'death';
  assert.equal(publicState(s).truth, '성배는 사실 리치의 심장이다.');
});
