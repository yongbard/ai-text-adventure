import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialState, checkFeasibility, resolveTurn, checkEnding, publicState, normalizeIntent, rollD100,
} from '../src/rules.js';
import { makeScenario, fixedRng } from './fixtures.js';

// 기본: 필요 능력치 6 (dex 5 → 50%)
const intent = (o) => normalizeIntent({ required: 6, ...o });
const start = () => createInitialState(makeScenario());
const at = (state, locId) => {
  state.player.location_id = locId;
  return state;
};
const trait = (effects, { good = true, check = 10, name = '테스트' } = {}) => ({
  id: 't', name, good, group: 't', check, description: '', effects,
});

test('fixedRng yields the requested roll', () => {
  for (let n = 1; n <= 100; n++) assert.equal(rollD100(fixedRng(n)), n);
});

test('initial state: start inventory with provenance, location, visited, npcs met', () => {
  const s = start();
  assert.deepEqual(s.player.inventory, ['dagger', 'torch']);
  assert.deepEqual(s.items.find((i) => i.id === 'dagger').acquired, { turn: 0, input: '', how: '시작 소지품' });
  assert.equal(s.items.find((i) => i.id === 'grail').acquired, null);
  assert.equal(s.player.location_id, 'hall');
  assert.deepEqual(s.visited, ['hall']);
  assert.deepEqual(s.visitedTurns, { hall: 0 });
  assert.deepEqual(s.npcs.find((n) => n.id === 'monk').met, { turn: 0, input: '', how: '만남' });
  assert.equal(s.player.hp, 15);
  assert.equal(s.player.job.name, '떠돌이 기사');
  assert.deepEqual([s.seeds, s.knowledge, s.stagnation], [[], [], 0]);
  assert.deepEqual([s.player.streak, s.player.statuses], [0, []]);
  assert.deepEqual(s.player.stats, { str: 4, dex: 5, int: 3 });
  assert.equal(s.enemies.find((e) => e.id === 'rat').max_hp, 2);
});

test('taking something that is not in the world becomes a search; known items elsewhere are not here', () => {
  const search = checkFeasibility(start(), intent({ action: 'take', target: '주머니' }));
  assert.deepEqual([search.ok, search.search, search.targetId], [true, true, null]);
  assert.equal(checkFeasibility(start(), intent({ action: 'take', target: '은빛 열쇠' })).reason, '은빛 열쇠는 여기에 없다');
});

test('impossible reasons use natural particles', () => {
  const s = start();
  assert.equal(checkFeasibility(s, intent({ action: 'use', items_used: ['레이저총'] })).reason, '레이저총을 가지고 있지 않다');
  assert.equal(checkFeasibility(s, intent({ action: 'move', target: '창고' })).reason, '여기서 창고로 가는 길이 없다');
  assert.equal(checkFeasibility(s, intent({ action: 'attack', target: '용' })).reason, '여기에는 공격할 용이 없다');
  const cor = at(start(), 'corridor');
  assert.equal(checkFeasibility(cor, intent({ action: 'move', target: '제단' })).reason, '제단으로 가는 길은 잠겨 있다 (은빛 열쇠 필요)');
});

test('attacking a person here turns them into an enemy with hp', () => {
  const s = start();
  s.npcs.push({ id: 'P1', name: '좀비', location_id: 'hall', origin: 'story', met: { turn: 1 } });
  const { state, result } = resolveTurn(s, intent({ action: 'attack', target: '좀비', stat: 'str', required: 5 }), fixedRng(20));
  assert.equal(result.grade, 'success');
  const zombie = state.enemies.find((e) => e.name === '좀비');
  assert.deepEqual([zombie.hp, zombie.max_hp, zombie.location_id], [1, 3, 'hall']);
  assert.equal(state.npcs.some((n) => n.name === '좀비'), false);
});

test('consecutive failures add 10% each (max 30%) and a success resets the streak', () => {
  let s = start();
  const act = intent({ action: 'other', required: 7, risk: 'low' });
  for (const expected of [0, 10, 20, 30, 30]) {
    const r = resolveTurn(s, act, fixedRng(90));
    assert.equal(r.result.pityBonus, expected);
    s = r.state;
  }
  assert.equal(s.player.streak, 5);
  assert.equal(resolveTurn(s, act, fixedRng(5)).state.player.streak, 0);
});

test('status effects change the effective stat and expire', () => {
  const s = start();
  s.player.statuses = [{ name: '아드레날린', stat: 'str', delta: 2, turns: 2, turn: 0 }];
  const act = intent({ action: 'other', stat: 'str', required: 5, risk: 'low' });
  const r1 = resolveTurn(s, act, fixedRng(90));
  assert.deepEqual([r1.result.statValue, r1.result.chance, r1.result.statusMods], [6, 70, [{ name: '아드레날린', delta: 2 }]]);
  assert.equal(r1.state.player.statuses[0].turns, 1);
  const r2 = resolveTurn(r1.state, act, fixedRng(90));
  assert.equal(r2.result.statValue, 6);
  assert.deepEqual(r2.state.player.statuses, []);
  assert.equal(resolveTurn(r2.state, act, fixedRng(90)).result.statValue, 4);
});

test('publicState shows what is here, enemy condition, effective stats and statuses', () => {
  const s = at(start(), 'corridor');
  s.enemies.find((e) => e.id === 'rat').hp = 1;
  s.player.statuses = [{ name: '부상', stat: 'dex', delta: -1, turns: 3, turn: 1 }];
  const p = publicState(s);
  assert.deepEqual(p.here, { items: [], enemies: [{ name: '거대 쥐', condition: '상처 입음' }], people: [] });
  assert.deepEqual([p.stats.dex, p.baseStats.dex], [4, 5]);
  assert.deepEqual(p.statuses, [{ name: '부상', summary: '민첩 -1', turns: 3 }]);
  const storage = publicState(at(start(), 'storage'));
  assert.deepEqual(storage.here.items, [{ name: '은빛 열쇠', description: '문장이 새겨져 있다.' }]);
});

test('feasibility: item not in inventory is impossible', () => {
  const r = checkFeasibility(start(), intent({ action: 'attack', items_used: ['레이저총'] }));
  assert.equal(r.ok, false);
  assert.match(r.reason, /레이저총/);
});

test('feasibility: move only through connected exits, locks need keys', () => {
  assert.equal(checkFeasibility(start(), intent({ action: 'move', target: '창고' })).ok, false);
  assert.deepEqual(checkFeasibility(start(), intent({ action: 'move', target: '회랑' })).targetId, 'corridor');
  const s = at(start(), 'corridor');
  const locked = checkFeasibility(s, intent({ action: 'move', target: '제단' }));
  assert.match(locked.reason, /은빛 열쇠/);
  s.player.inventory.push('silver_key');
  assert.equal(checkFeasibility(s, intent({ action: 'move', target: '제단' })).ok, true);
});

test('feasibility: take/attack need target here; unknown held item for use is impossible', () => {
  const s = start();
  assert.equal(checkFeasibility(s, intent({ action: 'take', target: '은빛 열쇠' })).ok, false);
  assert.equal(checkFeasibility(s, intent({ action: 'attack', target: '거대 쥐' })).ok, false);
  assert.equal(checkFeasibility(s, intent({ action: 'use', target: '치유 물약' })).ok, false);
  at(s, 'storage');
  assert.equal(checkFeasibility(s, intent({ action: 'take', target: '은빛 열쇠', items_used: ['은빛 열쇠'] })).ok, true);
});

test('feasibility: explore creates a new place but cannot bypass the map', () => {
  const s = start();
  assert.deepEqual(checkFeasibility(s, intent({ action: 'explore', target: '종탑' })),
    { ok: true, targetId: null, itemIds: [], newPlace: '종탑' });
  assert.equal(checkFeasibility(s, intent({ action: 'explore', target: '회랑' })).targetId, 'corridor', 'known exit acts like move');
  assert.equal(checkFeasibility(s, intent({ action: 'explore', target: '제단' })).ok, false, 'existing far place');
  for (let i = 0; i < 6; i++) s.locations.push({ id: `x${i}`, name: `x${i}`, description: '', exits: [], origin: 'story' });
  assert.equal(checkFeasibility(s, intent({ action: 'explore', target: '다락방' })).ok, false, 'story place cap');
});

test('resolveTurn: impossible costs a turn but no hp', () => {
  const s0 = start();
  const { state, result } = resolveTurn(s0, intent({ action: 'move', target: '제단' }), fixedRng(50), '제단으로 간다');
  assert.equal(result.grade, 'impossible');
  assert.equal(result.roll, null);
  assert.equal(state.turn, 1);
  assert.equal(state.player.hp, 15);
  assert.equal(s0.turn, 0, 'original state untouched');
  assert.match(state.log[0], /^1턴: 제단으로 간다 → 불가능/);
});

test('resolveTurn: trivial move succeeds without roll, records first visit and meets npcs', () => {
  const s = at(start(), 'corridor');
  s.player.inventory.push('silver_key');
  const back = resolveTurn(s, intent({ action: 'move', target: '창고', trivial: true }), fixedRng(99), '창고로');
  assert.deepEqual([back.result.kind, back.result.grade], ['auto', 'success']);
  assert.equal(back.state.player.location_id, 'storage');
  assert.equal(back.state.visitedTurns.storage, 1);
  assert.equal(back.state.dice.rolls, 0);
});

test('resolveTurn: chance from required vs my stat, plus item', () => {
  const s = at(start(), 'corridor');
  const { state, result } = resolveTurn(
    s,
    intent({ action: 'attack', target: '쥐', required: 7, stat: 'dex', items_used: ['녹슨 단검'], item_bonus: 10 }),
    fixedRng(45),
  );
  assert.deepEqual(
    [result.required, result.statValue, result.itemBonus, result.chance, result.roll, result.grade, result.critMax, result.fumbleFrom],
    [7, 5, 10, 50, 45, 'success', 10, 96],
  );
  assert.equal(state.enemies.find((e) => e.id === 'rat').hp, 0);
  assert.ok(result.changes.includes('거대 쥐 처치'));
});

test('resolveTurn: item bonus ignored when no items used', () => {
  const { result } = resolveTurn(start(), intent({ action: 'examine', required: 6, stat: 'int', item_bonus: 20 }), fixedRng(10));
  assert.deepEqual([result.itemBonus, result.chance], [0, 30]);
});

test('resolveTurn: failure damage by risk, +1 with enemy, x2 on fumble', () => {
  const hall = resolveTurn(start(), intent({ action: 'other', risk: 'high', required: 7 }), fixedRng(90));
  assert.equal(hall.state.player.hp, 13);
  const cor = resolveTurn(at(start(), 'corridor'), intent({ action: 'other', risk: 'high', required: 7 }), fixedRng(90));
  assert.equal(cor.state.player.hp, 12);
  const fum = resolveTurn(start(), intent({ action: 'other', risk: 'medium', required: 7 }), fixedRng(97));
  assert.deepEqual([fum.result.grade, fum.state.player.hp, fum.state.dice.fumbles], ['fumble', 13, 1]);
});

test('resolveTurn: critical deals 4 damage and heals 1', () => {
  const s = at(start(), 'altar');
  s.player.hp = 5;
  const { state, result } = resolveTurn(s, intent({ action: 'attack', target: '리치', stat: 'str', required: 5 }), fixedRng(1));
  assert.equal(result.grade, 'critical');
  assert.equal(state.enemies.find((e) => e.id === 'lich').hp, 2);
  assert.equal(state.player.hp, 6);
});

test('resolveTurn: take records provenance; use heals', () => {
  const s = at(start(), 'crypt');
  s.player.hp = 4;
  const took = resolveTurn(s, intent({ action: 'take', target: '물약', trivial: true }), fixedRng(50), '물약을 줍는다');
  assert.deepEqual(took.state.items.find((i) => i.id === 'potion').acquired, { turn: 1, input: '물약을 줍는다', how: '주움' });
  const used = resolveTurn(took.state, intent({ action: 'use', target: '치유 물약', trivial: true }), fixedRng(50));
  assert.equal(used.state.player.hp, 7);
  assert.ok(!used.state.player.inventory.includes('potion'));
});

test('resolveTurn: talking to a scenario npc records their knowledge once', () => {
  const talk = intent({ action: 'talk', target: '수도사', trivial: true });
  const r1 = resolveTurn(start(), talk, fixedRng(50), '수도사와 이야기한다');
  assert.deepEqual(r1.state.knowledge.map((k) => [k.text, k.turn, k.source]), [['늙은 수도사: 은빛 열쇠는 창고에 있다.', 1, 'monk']]);
  const r2 = resolveTurn(r1.state, talk, fixedRng(50), '또 묻는다');
  assert.equal(r2.state.knowledge.length, 1);
});

test('resolveTurn: explore success creates, connects and enters a new place', () => {
  const { state, result } = resolveTurn(start(), intent({ action: 'explore', target: '종탑', trivial: true }), fixedRng(50), '종탑을 찾는다');
  const tower = state.locations.find((l) => l.name === '종탑');
  assert.equal(tower.origin, 'story');
  assert.deepEqual(tower.exits, [{ to: 'hall', requires_item_id: null }]);
  assert.ok(state.locations.find((l) => l.id === 'hall').exits.some((x) => x.to === tower.id));
  assert.equal(state.player.location_id, tower.id);
  assert.equal(state.visitedTurns[tower.id], 1);
  assert.ok(result.changes.includes('종탑으로 이동'));
});

test('relevant traits feed the chance; irrelevant ones do not', () => {
  const s = createInitialState(makeScenario(), [trait({}, { name: '고소공포증', good: false, check: 15 })]);
  const climb = resolveTurn(s, intent({ action: 'other', stat: 'dex', traits: [{ name: '고소공포증', effect: 'hinder' }] }), fixedRng(99));
  assert.deepEqual([climb.result.traitBonus, climb.result.traitsApplied, climb.result.chance], [-15, [{ name: '고소공포증', value: -15 }], 35]);
  const chat = resolveTurn(s, intent({ action: 'other', stat: 'dex' }), fixedRng(99));
  assert.deepEqual([chat.result.traitBonus, chat.result.chance], [0, 50]);
});

test('allies add 10% each (max 30%) at the goal location only', () => {
  const s = at(start(), 'altar');
  s.npcs.push(
    { id: 'w', name: '늑대', ally: true, location_id: null, remote: true, met: { turn: 1 } },
    { id: 'x', name: '건달', ally: true, location_id: null, remote: true, met: { turn: 1 } },
  );
  const boss = resolveTurn(s, intent({ action: 'attack', target: '리치', stat: 'str', required: 5 }), fixedRng(99));
  assert.deepEqual([boss.result.allyBonus, boss.result.chance], [20, 70]);
  const hall = resolveTurn(at(structuredClone(s), 'hall'), intent({ action: 'other', stat: 'str', required: 5 }), fixedRng(99));
  assert.equal(hall.result.allyBonus, 0);
});

test('trait passive crit, fumble and damage_taken modifiers', () => {
  const lucky = createInitialState(makeScenario(), [trait({ crit: 2 })]);
  assert.equal(resolveTurn(lucky, intent({ action: 'other', required: 7 }), fixedRng(10)).result.grade, 'critical');
  const jinx = createInitialState(makeScenario(), [trait({ fumble: 3, damage_taken: 1 }, { good: false })]);
  const bad = resolveTurn(jinx, intent({ action: 'other', required: 7, risk: 'medium' }), fixedRng(93));
  assert.deepEqual([bad.result.grade, bad.state.player.hp], ['fumble', 12]);
  const calm = createInitialState(makeScenario(), [trait({ damage_taken: -1 })]);
  assert.equal(resolveTurn(calm, intent({ action: 'other', required: 7, risk: 'medium' }), fixedRng(90)).state.player.hp, 15);
});

test('attack_damage and heal modifiers; heal item turn ignores effect_hp', () => {
  const strong = at(createInitialState(makeScenario(), [trait({ attack_damage: 1 })]), 'altar');
  const hit = resolveTurn(strong, intent({ action: 'attack', target: '리치', stat: 'str', required: 5 }), fixedRng(50));
  assert.equal(hit.state.enemies.find((e) => e.id === 'lich').hp, 3);
  const healer = at(createInitialState(makeScenario(), [trait({ heal: 1 })]), 'crypt');
  healer.player.hp = 5;
  const took = resolveTurn(healer, intent({ action: 'take', target: '물약', trivial: true }), fixedRng(50));
  const used = resolveTurn(took.state, intent({ action: 'use', target: '치유 물약', trivial: true, effect_hp: 3 }), fixedRng(50));
  assert.equal(used.state.player.hp, 9);
});

test('AI effects apply only on success and are clamped', () => {
  const s = start();
  s.player.hp = 10;
  const ate = resolveTurn(s, intent({ action: 'other', trivial: true, effect_hp: 9, effect_stat: 'str+2' }), fixedRng(50));
  assert.deepEqual([ate.state.player.hp, ate.state.player.stats.str], [15, 6]);
  const fail = resolveTurn(s, intent({ action: 'other', required: 9, risk: 'low', effect_hp: 3, effect_stat: 'int+1' }), fixedRng(90));
  assert.deepEqual([fail.state.player.hp, fail.state.player.stats.int], [10, 3]);
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
  const { state } = resolveTurn(s, intent({ action: 'other', risk: 'deadly', required: 9 }), fixedRng(90));
  assert.deepEqual([state.player.hp, state.ending], [0, 'death']);
});

test('createInitialState applies trait stats and max hp with clamps', () => {
  const s = createInitialState(makeScenario(), [trait({ str: 2, max_hp: 3 }), trait({ dex: 5, int: -5, max_hp: -30 }, { good: false })]);
  assert.deepEqual(s.player.stats, { str: 6, dex: 9, int: 1 });
  assert.deepEqual([s.player.max_hp, s.player.hp], [5, 5]);
});

test('publicState: provenance, knowledge, people, seeds, visited turns; secrets hidden until ending', () => {
  const s = createInitialState(makeScenario(), [trait({ str: 1 }, { check: 15 })]);
  s.seeds.push({ id: 'S1', text: '버튼을 눌렀다', turn: 2, input: '누른다', fate: 'bane', finale: false, ripen: 6, status: 'planted', bloomTurn: null, outcome: '' });
  const p = publicState(s);
  assert.deepEqual(p.inventory[0], { name: '녹슨 단검', description: '날이 무디다.', acquired: { turn: 0, input: '', how: '시작 소지품' } });
  assert.deepEqual(p.people, [{ name: '늙은 수도사', description: '겁이 많다', here: true, remote: false, ally: false, met: { turn: 0, input: '', how: '만남' } }]);
  assert.deepEqual(p.seeds, [{ text: '버튼을 눌렀다', turn: 2, input: '누른다', status: 'planted', bloomTurn: null, outcome: '', fate: null }]);
  assert.deepEqual(p.visited, [{ name: '성당 입구', turn: 0 }]);
  assert.deepEqual(p.traits, [{ name: '테스트', description: '', good: true, summary: '힘 +1, 관련 상황 판정 +15%' }]);
  assert.equal(p.truth, null);
  assert.equal(JSON.stringify(p).includes('은빛 열쇠는 창고에'), false);
  s.ending = 'death';
  const end = publicState(s);
  assert.equal(end.truth, '성배는 사실 리치의 심장이다.');
  assert.equal(end.seeds[0].fate, 'bane');
});
