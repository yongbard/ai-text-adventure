import test from 'node:test';
import assert from 'node:assert/strict';
import { TRAITS, drawTraits, traitMods, traitBonus, describeEffects, describeTrait } from '../src/traits.js';
import { createRng } from '../src/rules.js';

const PASSIVE = ['str', 'dex', 'int', 'max_hp', 'crit', 'fumble', 'damage_taken', 'attack_damage', 'heal'];
const passiveScore = (e) =>
  10 * ((e.str ?? 0) + (e.dex ?? 0) + (e.int ?? 0)) + 3 * (e.max_hp ?? 0) + 5 * (e.crit ?? 0) - 3 * (e.fumble ?? 0)
  - 10 * (e.damage_taken ?? 0) + 10 * (e.attack_damage ?? 0) + 5 * (e.heal ?? 0);

test('100 traits, 50 good and 50 bad, unique ids and names', () => {
  assert.equal(TRAITS.length, 100);
  assert.equal(TRAITS.filter((t) => t.good).length, 50);
  assert.equal(new Set(TRAITS.map((t) => t.id)).size, 100);
  assert.equal(new Set(TRAITS.map((t) => t.name)).size, 100);
  assert.ok(TRAITS.every((t) => t.description && t.group));
});

test('traits have only passive effects plus a 5~15 relevance check, balanced by sign', () => {
  for (const t of TRAITS) {
    assert.ok(Object.keys(t.effects).every((k) => PASSIVE.includes(k)), t.name);
    assert.ok(t.check >= 5 && t.check <= 15, `${t.name} check`);
    if (t.good) assert.ok(passiveScore(t.effects) + t.check > 0, `${t.name} should be net positive`);
    else assert.ok(passiveScore(t.effects) - t.check < 0, `${t.name} should be net negative`);
  }
});

test('drawTraits picks 2 good + 2 bad with distinct groups', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const picked = drawTraits(createRng(seed));
    assert.equal(picked.filter((t) => t.good).length, 2);
    assert.equal(picked.filter((t) => !t.good).length, 2);
    assert.equal(new Set(picked.map((t) => t.group)).size, 4);
  }
});

test('drawTraits returns copies', () => {
  const [first] = drawTraits(createRng(1));
  first.effects.str = 99;
  assert.ok(TRAITS.every((t) => t.effects.str !== 99));
});

test('traitMods sums passive modifiers', () => {
  assert.deepEqual(traitMods([{ effects: { crit: 2, heal: 1 } }, { effects: { crit: -1, fumble: 3 } }]),
    { crit: 1, fumble: 3, damage_taken: 0, attack_damage: 0, heal: 1 });
  assert.deepEqual(traitMods(), { crit: 0, fumble: 0, damage_taken: 0, attack_damage: 0, heal: 0 });
});

test('traitBonus applies only the traits the judge marked relevant', () => {
  const traits = [
    { name: '달변가', good: true, check: 15, effects: {} },
    { name: '고소공포증', good: false, check: 15, effects: {} },
  ];
  assert.deepEqual(traitBonus(traits, []), { total: 0, applied: [] });
  assert.deepEqual(traitBonus(traits, [{ name: '고소공포증', effect: 'hinder' }]), {
    total: -15, applied: [{ name: '고소공포증', value: -15 }],
  });
  assert.deepEqual(traitBonus(traits, [
    { name: '달변가', effect: 'help' }, { name: '달변가', effect: 'help' }, { name: '없는성격', effect: 'help' },
  ]), { total: 15, applied: [{ name: '달변가', value: 15 }] });
});

test('describeEffects and describeTrait', () => {
  assert.equal(describeEffects({ str: 1, max_hp: -3 }), '힘 +1, 최대 체력 -3');
  assert.equal(describeEffects({ crit: 2, fumble: 3 }), '대성공 범위 +2, 대실패 범위 +3');
  assert.equal(describeTrait({ good: true, check: 15, effects: {} }), '관련 상황 판정 +15%');
  assert.equal(describeTrait({ good: false, check: 5, effects: { dex: -1 } }), '민첩 -1, 관련 상황 판정 -5%');
});
