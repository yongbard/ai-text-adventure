import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeChance, gradeRoll, thresholds, rollD100, createRng, normalizeIntent, matchEntity, josa,
} from '../src/rules.js';

test('computeChance: 60% at equal stats, 10% per point', () => {
  assert.equal(computeChance(4, 4), 60);
  assert.equal(computeChance(5, 4), 50);
  assert.equal(computeChance(2, 4), 80);
  assert.equal(computeChance(8, 4), 20, '치킨집 사장의 서버 구축');
  assert.equal(computeChance(15, 4), 1);
});

test('computeChance adds item (max 20) and other bonuses, clamped to 1..99', () => {
  assert.equal(computeChance(5, 4, 10), 60);
  assert.equal(computeChance(5, 5, 50), 80);
  assert.equal(computeChance(5, 5, 0, -15), 45);
  assert.equal(computeChance(1, 9, 20, 30), 99);
});

test('josa picks the particle that fits the last syllable', () => {
  assert.equal(josa('주머니', '이/가'), '가');
  assert.equal(josa('단검', '이/가'), '이');
  assert.equal(josa('물약', '을/를'), '을');
  assert.equal(josa('주머니', '을/를'), '를');
  assert.equal(josa('성배', '은/는'), '는');
  assert.equal(josa('회랑', '(으)로'), '으로');
  assert.equal(josa('창고', '(으)로'), '로');
  assert.equal(josa('지하실', '(으)로'), '로');
  assert.equal(josa('Silent_Watcher', '이/가'), '이(가)');
  assert.equal(josa('Room7', '(으)로'), '(으)로');
});

test('thresholds expose crit and fumble zones', () => {
  assert.deepEqual(thresholds(40), { critMax: 8, fumbleFrom: 96 });
  assert.deepEqual(thresholds(40, 2, 3), { critMax: 10, fumbleFrom: 93 });
  assert.deepEqual(thresholds(99), { critMax: 19, fumbleFrom: 100 });
  assert.deepEqual(thresholds(3, 5), { critMax: 3, fumbleFrom: 96 });
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
  const i = normalizeIntent({
    action: 'fly', required: 150, item_bonus: -5, stat: 'luck', risk: 'x', target: '  ', items_used: ['칼', '', 3],
    traits: [{ name: ' 달변가 ', effect: 'help' }, { name: '고소공포증', effect: 'weird' }, { effect: 'help' }, null],
  });
  assert.deepEqual(i, {
    action: 'other', target: null, items_used: ['칼'], trivial: false, required: 15,
    reason: '', stat: 'dex', item_bonus: 0, risk: 'medium',
    effect_hp: 0, effect_stat: null, effect_stat_delta: 0,
    traits: [{ name: '달변가', effect: 'help' }, { name: '고소공포증', effect: 'help' }],
  });
  assert.equal(normalizeIntent({}).required, 4);
  assert.equal(normalizeIntent({ action: 'explore' }).action, 'explore');
});

test('gradeRoll honors crit and fumble modifiers', () => {
  assert.equal(gradeRoll(10, 40, 2), 'critical');
  assert.equal(gradeRoll(11, 40, 2), 'success');
  assert.equal(gradeRoll(3, 3, 5), 'critical');
  assert.equal(gradeRoll(1, 40, -8), 'success');
  assert.equal(gradeRoll(93, 40, 0, 3), 'fumble');
  assert.equal(gradeRoll(97, 40, 0, -3), 'failure');
  assert.equal(gradeRoll(99, 40, 0, -3), 'fumble');
});

test('normalizeIntent clamps AI effects', () => {
  const i = normalizeIntent({ effect_hp: 9, effect_stat: 'str', effect_stat_delta: -7 });
  assert.deepEqual([i.effect_hp, i.effect_stat, i.effect_stat_delta], [5, 'str', -2]);
  const none = normalizeIntent({ effect_stat: 'none', effect_stat_delta: 2 });
  assert.deepEqual([none.effect_stat, none.effect_stat_delta], [null, 0]);
});

test('normalizeIntent parses combined stat effects like "str+1"', () => {
  const up = normalizeIntent({ effect_stat: 'str+1' });
  assert.deepEqual([up.effect_stat, up.effect_stat_delta], ['str', 1]);
  const down = normalizeIntent({ effect_stat: 'int-2' });
  assert.deepEqual([down.effect_stat, down.effect_stat_delta], ['int', -2]);
  const bad = normalizeIntent({ effect_stat: 'luck+9' });
  assert.deepEqual([bad.effect_stat, bad.effect_stat_delta], [null, 0]);
});

test('matchEntity matches id, exact name, then partial name', () => {
  const list = [{ id: 'hall', name: '성당 입구' }, { id: 'corridor', name: '무너진 회랑' }];
  assert.equal(matchEntity(list, 'hall').id, 'hall');
  assert.equal(matchEntity(list, '성당입구').id, 'hall');
  assert.equal(matchEntity(list, '회랑').id, 'corridor');
  assert.equal(matchEntity(list, '지하실'), null);
  assert.equal(matchEntity(list, null), null);
});
