import test from 'node:test';
import assert from 'node:assert/strict';
import { computeChance, gradeRoll, rollD100, createRng, normalizeIntent, matchEntity } from '../src/rules.js';

test('computeChance applies stat and item bonus', () => {
  assert.equal(computeChance(30, 5, 0), 40);
  assert.equal(computeChance(30, 3, 15), 45);
  assert.equal(computeChance(50, 1, 0), 40);
});

test('computeChance clamps to 1..99 and item bonus to 20', () => {
  assert.equal(computeChance(95, 5, 20), 99);
  assert.equal(computeChance(1, 1, 0), 1);
  assert.equal(computeChance(30, 3, 50), 50);
});

test('gradeRoll boundaries at 40%', () => {
  assert.equal(gradeRoll(8, 40), 'critical');
  assert.equal(gradeRoll(9, 40), 'success');
  assert.equal(gradeRoll(40, 40), 'success');
  assert.equal(gradeRoll(41, 40), 'failure');
  assert.equal(gradeRoll(95, 40), 'failure');
  assert.equal(gradeRoll(96, 40), 'fumble');
});

test('gradeRoll edge chances', () => {
  assert.equal(gradeRoll(1, 3), 'critical');
  assert.equal(gradeRoll(2, 3), 'success');
  assert.equal(gradeRoll(96, 99), 'success');
  assert.equal(gradeRoll(100, 99), 'fumble');
});

test('rollD100 range and seeded rng is deterministic', () => {
  assert.equal(rollD100(() => 0), 1);
  assert.equal(rollD100(() => 0.9999), 100);
  const a = createRng(42);
  const b = createRng(42);
  const seqA = Array.from({ length: 5 }, () => rollD100(a));
  const seqB = Array.from({ length: 5 }, () => rollD100(b));
  assert.deepEqual(seqA, seqB);
  assert.ok(seqA.every((n) => n >= 1 && n <= 100));
});

test('normalizeIntent fills defaults and clamps', () => {
  const i = normalizeIntent({ action: 'fly', base_chance: 150, item_bonus: -5, stat: 'luck', risk: 'x', target: '  ', items_used: ['칼', '', 3] });
  assert.deepEqual(i, {
    action: 'other', target: null, items_used: ['칼'], trivial: false, base_chance: 99,
    reason: '', stat: 'dex', item_bonus: 0, risk: 'medium',
  });
  assert.equal(normalizeIntent({}).base_chance, 50);
});

test('matchEntity matches id, exact name, then partial name', () => {
  const list = [{ id: 'hall', name: '성당 입구' }, { id: 'corridor', name: '무너진 회랑' }];
  assert.equal(matchEntity(list, 'hall').id, 'hall');
  assert.equal(matchEntity(list, '성당입구').id, 'hall');
  assert.equal(matchEntity(list, '회랑').id, 'corridor');
  assert.equal(matchEntity(list, '지하실'), null);
  assert.equal(matchEntity(list, null), null);
});
