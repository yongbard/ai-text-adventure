import test from 'node:test';
import assert from 'node:assert/strict';
import { TRAITS, drawTraits, traitMods, describeEffects } from '../src/traits.js';
import { createRng } from '../src/rules.js';

const KEYS = ['str', 'dex', 'int', 'max_hp', 'crit', 'fumble', 'damage_taken', 'attack_damage', 'heal', 'vs_enemy', 'action'];
const ACTIONS = ['move', 'take', 'use', 'attack', 'talk', 'examine', 'other'];
const score = (e) =>
  10 * ((e.str ?? 0) + (e.dex ?? 0) + (e.int ?? 0)) + 3 * (e.max_hp ?? 0) + 5 * (e.crit ?? 0) - 3 * (e.fumble ?? 0)
  - 10 * (e.damage_taken ?? 0) + 10 * (e.attack_damage ?? 0) + 5 * (e.heal ?? 0) + (e.vs_enemy ?? 0)
  + Object.values(e.action ?? {}).reduce((a, b) => a + b, 0);

test('100 traits, 50 good and 50 bad, unique ids and names', () => {
  assert.equal(TRAITS.length, 100);
  assert.equal(TRAITS.filter((t) => t.good).length, 50);
  assert.equal(new Set(TRAITS.map((t) => t.id)).size, 100);
  assert.equal(new Set(TRAITS.map((t) => t.name)).size, 100);
  assert.ok(TRAITS.every((t) => t.description && t.group));
});

test('trait effects use known keys and match good/bad', () => {
  for (const t of TRAITS) {
    assert.ok(Object.keys(t.effects).every((k) => KEYS.includes(k)), t.name);
    assert.ok(Object.keys(t.effects.action ?? {}).every((k) => ACTIONS.includes(k)), t.name);
    if (t.good) assert.ok(score(t.effects) > 0, `${t.name} should be net positive`);
    else assert.ok(score(t.effects) < 0, `${t.name} should be net negative`);
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

test('traitMods sums effects', () => {
  const mods = traitMods([
    { effects: { crit: 2, action: { talk: 15 } } },
    { effects: { crit: -1, fumble: 3, action: { talk: -5, move: -10 } } },
  ]);
  assert.deepEqual(mods, { crit: 1, fumble: 3, damage_taken: 0, attack_damage: 0, heal: 0, vs_enemy: 0, action: { talk: 10, move: -10 } });
  assert.deepEqual(traitMods().action, {});
});

test('describeEffects summarizes in Korean', () => {
  assert.equal(describeEffects({ str: 1, max_hp: -3, action: { talk: 15 } }), '힘 +1, 최대 체력 -3, 대화 판정 +15%');
  assert.equal(describeEffects({ crit: 2, fumble: 3, vs_enemy: -10 }), '대성공 범위 +2, 대실패 범위 +3, 적 앞 판정 -10%');
});
