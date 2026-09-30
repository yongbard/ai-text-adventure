import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, normalizeIntent, resolveTurn } from '../src/rules.js';
import {
  interpretMessages, narrateMessages, epilogueMessages, scenarioMessages, unknownNames, INTERPRET_SCHEMA,
  narrationFacts, epilogueFacts, checkMessages, CHECK_SCHEMA,
  chronicleMessages, CHRONICLE_SCHEMA, endingToneMessages, ENDING_SCHEMA,
} from '../src/prompts.js';
import { makeScenario, fixedRng } from './fixtures.js';

const start = () => createInitialState(makeScenario());
const text = (msgs) => msgs.map((m) => m.content).join('\n');

test('scenarioMessages includes genre and job', () => {
  const msgs = scenarioMessages('좀비 생존', '해커');
  assert.equal(msgs[0].role, 'system');
  assert.match(msgs.at(-1).content, /좀비 생존/);
  assert.match(msgs.at(-1).content, /직업: 해커/);
  assert.match(scenarioMessages('SF').at(-1).content, /장르에 어울리게 정하세요/);
});

test('interpretMessages lists scene facts and hides secrets', () => {
  const all = text(interpretMessages(start(), '회랑으로 간다'));
  assert.match(all, /현재 장소: 성당 입구/);
  assert.match(all, /출구: 무너진 회랑/);
  assert.match(all, /소지품: 녹슨 단검, 횃불/);
  assert.match(all, /이곳의 인물: 늙은 수도사/);
  assert.match(all, /회랑으로 간다/);
  assert.match(all, /직업: 떠돌이 기사 — 주인을 잃은 기사. \(특기: 검술\)/);
  assert.equal(all.includes('능력치: 힘'), false);
  assert.equal(all.includes('리치의 심장'), false);
  assert.equal(all.includes('은빛 열쇠는 창고에'), false);
});

test('narrateMessages puts verdict first and adds npc knowledge only on talk', () => {
  const talk = normalizeIntent({ action: 'talk', target: '수도사', trivial: true });
  const r1 = resolveTurn(start(), talk, fixedRng(50), '수도사에게 말을 건다');
  const user1 = narrateMessages(r1.state, '수도사에게 말을 건다', talk, r1.result).at(-1).content;
  assert.match(user1, /^\[판정 결과\] 자동 성공/);
  assert.match(user1, /은빛 열쇠는 창고에 있다/);

  const look = normalizeIntent({ action: 'examine', trivial: true });
  const r2 = resolveTurn(start(), look, fixedRng(50), '둘러본다');
  assert.equal(narrateMessages(r2.state, '둘러본다', look, r2.result).at(-1).content.includes('은빛 열쇠는 창고에'), false);
});

test('narrateMessages states failure and damage explicitly', () => {
  const jump = normalizeIntent({ action: 'other', base_chance: 20, risk: 'high' });
  const { state, result } = resolveTurn(start(), jump, fixedRng(90), '벽을 뛰어넘는다');
  const user = narrateMessages(state, '벽을 뛰어넘는다', jump, result).at(-1).content;
  assert.match(user, /^\[판정 결과\] 실패/);
  assert.match(user, /체력 -2/);
});

test('narrateMessages adds traits and fail-forward only on failure', () => {
  const talker = { id: 'g7', name: '달변가', good: true, group: 'speech', description: '', effects: { action: { talk: 15 } } };
  const s = createInitialState(makeScenario(), [talker]);
  const jump = normalizeIntent({ action: 'other', base_chance: 20, risk: 'high' });
  const failed = resolveTurn(s, jump, fixedRng(90), '벽을 넘는다');
  const u1 = narrateMessages(failed.state, '벽을 넘는다', jump, failed.result).at(-1).content;
  assert.match(u1, /성격: 달변가/);
  assert.match(u1, /\[연출\]/);
  const look = normalizeIntent({ action: 'examine', trivial: true });
  const ok = resolveTurn(s, look, fixedRng(50), '둘러본다');
  assert.equal(narrateMessages(ok.state, '둘러본다', look, ok.result).at(-1).content.includes('[연출]'), false);
});

test('unknownNames flags entities not given to the model', () => {
  const look = normalizeIntent({ action: 'examine', trivial: true });
  const { state, result } = resolveTurn(start(), look, fixedRng(50), '둘러본다');
  const msgs = narrateMessages(state, '둘러본다', look, result);
  assert.deepEqual(unknownNames('당신은 은빛 열쇠를 떠올린다.', state, msgs), ['은빛 열쇠']);
  assert.deepEqual(unknownNames('녹슨 단검을 쥐고 리치를 생각한다.', state, msgs), []);
  const epi = epilogueMessages({ ...state, ending: 'death' });
  assert.deepEqual(unknownNames('봉인된 성배가 빛난다.', state, epi), []);
});

test('narrateMessages forbids recaps and asks to reveal enemies', () => {
  const look = normalizeIntent({ action: 'examine', trivial: true });
  const { state, result } = resolveTurn(start(), look, fixedRng(50), '둘러본다');
  const system = narrateMessages(state, '둘러본다', look, result)[0].content;
  assert.match(system, /지난 장면을 다시 요약하지 않습니다/);
  assert.match(system, /적이 있으면/);
  assert.match(system, /다른 장소로 들어가는 묘사를 하지 않습니다/);
});

test('interpretMessages gives concrete examples for AI effects', () => {
  const system = interpretMessages(start(), 'x')[0].content;
  assert.match(system, /근력 훈련 → "str\+1"/);
  assert.match(system, /음식을 먹거나 쉬면 \+1~\+3/);
  assert.ok(INTERPRET_SCHEMA.properties.effect_stat.enum.includes('dex-2'));
  assert.equal(INTERPRET_SCHEMA.properties.effect_stat_delta, undefined);
});

const seedOf = (o) => ({
  id: 'S1', text: '새끼 늑대를 도왔다', turn: 2, input: '늑대를 돕는다', fate: 'boon', finale: false, ripen: 6,
  status: 'planted', bloomTurn: null, outcome: '', ...o,
});
const withTrait = () => createInitialState(makeScenario(), [
  { id: 'b25', name: '고소공포증', good: false, group: 'heights', check: 15, description: '높은 곳만 보면 다리가 풀린다.', effects: {} },
]);

test('interpret schema asks for required stat, relevant traits and explore', () => {
  const p = INTERPRET_SCHEMA.properties;
  assert.ok(p.action.enum.includes('explore'));
  assert.equal(p.required.type, 'integer');
  assert.deepEqual(p.traits.items.properties.effect.enum, ['help', 'hinder']);
  assert.equal(p.base_chance, undefined);
});

test('interpretMessages explains required scale and lists traits and remote people', () => {
  const s = withTrait();
  s.npcs.push({ id: 'P1', name: '회색늑대', remote: true, location_id: null, met: { turn: 1 }, description: '채팅 상대' });
  const [system, user] = interpretMessages(s, '옥상으로 올라간다');
  assert.match(system.content, /required/);
  assert.match(system.content, /치킨집 사장/);
  assert.match(system.content, /explore/);
  assert.match(user.content, /성격: 고소공포증\(높은 곳만 보면 다리가 풀린다\.\)/);
  assert.match(user.content, /원격으로 연결된 인물: 회색늑대/);
});

test('narrateMessages allows new things, lists seeds without fate, and forbids nothing new only for boss/goal', () => {
  const s = start();
  s.seeds.push(seedOf());
  const look = normalizeIntent({ action: 'examine', trivial: true });
  const { state, result } = resolveTurn(s, look, fixedRng(50), '둘러본다');
  const [system, user] = narrateMessages(state, '둘러본다', look, result);
  assert.match(system.content, /그럴듯하게 생겨나거나 드러나는/);
  assert.equal(system.content.includes('새로 등장시키지 않습니다'), false);
  assert.match(user.content, /\[심어진 씨앗\]\n- 새끼 늑대를 도왔다/);
  assert.equal(user.content.includes('boon'), false);
  assert.equal(user.content.includes('[나비효과]'), false);
});

test('narrateMessages gives a butterfly directive tied to the goal when a seed blooms', () => {
  const look = normalizeIntent({ action: 'examine', trivial: true });
  const { state, result } = resolveTurn(start(), look, fixedRng(50), '둘러본다');
  result.bloom = { kind: 'due', seeds: [{ id: 'S1', text: '버튼을 눌렀다', turn: 2, fate: 'bane' }] };
  const user = narrateMessages(state, '둘러본다', look, result).at(-1).content;
  assert.match(user, /\[나비효과\].*2턴.*버튼을 눌렀다/s);
  assert.match(user, /이야기에 없던 위기/);
  assert.match(user, /최종 목표/);
  const facts = narrationFacts(state, '둘러본다', result);
  assert.match(facts, /\[나비효과\]/);
  assert.match(facts, /\[배경\] 당신은 버려진 성당에 들어섰다\./);
  result.bloom = { kind: 'event', seeds: [] };
  assert.match(narrateMessages(state, '둘러본다', look, result).at(-1).content, /새로운 사건/);
});

test('checker treats new things and failure explanations as consistent', () => {
  const system = checkMessages('x', 'y')[0].content;
  assert.match(system, /새로운 인물·물건·장소·상황이 등장하는 것 자체는 모순이 아닙니다/);
  assert.match(system, /원인을 어떻게 설명하는지는 평가하지 않습니다/);
});

test('chronicleMessages gives narration, verdict and bloomed seed ids; schema covers the ledger', () => {
  const look = normalizeIntent({ action: 'examine', trivial: true });
  const { state, result } = resolveTurn(start(), look, fixedRng(50), '둘러본다');
  result.bloom = { kind: 'due', seeds: [{ id: 'S3', text: '버튼을 눌렀다', turn: 2, fate: 'bane' }] };
  const [system, user] = chronicleMessages(state, '둘러본다', result, '벽 틈에서 쪽지가 떨어졌다.');
  assert.match(system.content, /씨앗/);
  assert.match(system.content, /사소해 보여도/);
  assert.match(user.content, /벽 틈에서 쪽지가 떨어졌다\./);
  assert.match(user.content, /\[판정 결과\]/);
  assert.match(user.content, /S3: 버튼을 눌렀다/);
  assert.deepEqual(Object.keys(CHRONICLE_SCHEMA.properties), [
    'new_seeds', 'seed_outcomes', 'new_knowledge', 'new_people', 'new_allies', 'new_items', 'new_places', 'new_enemies',
    'current_place_description',
  ]);
});

test('ending tone and epilogue reveal seeds, fates, outcomes and allies', () => {
  const s = start();
  s.ending = 'victory';
  s.seeds.push(seedOf({ status: 'bloomed', bloomTurn: 9, outcome: '늑대 무리가 결전에 합류했다' }), seedOf({ id: 'S2', text: '깡패를 때렸다', fate: 'twist' }));
  s.npcs.push({ id: 'P1', name: '늑대 무리', ally: true, met: { turn: 9 } });
  const tone = endingToneMessages(s);
  assert.deepEqual(ENDING_SCHEMA.properties.tone.enum, ['light', 'gray', 'shadow']);
  assert.match(tone.at(-1).content, /은혜.*늑대 무리가 결전에 합류했다/s);
  assert.match(tone.at(-1).content, /동료: 늑대 무리/);
  s.endingTone = { tone: 'shadow', title: '피로 산 새벽' };
  const epi = epilogueMessages(s);
  assert.match(epi[0].content, /그림자/);
  assert.match(epi.at(-1).content, /피로 산 새벽/);
  assert.match(epi.at(-1).content, /깡패를 때렸다.*반전/s);
  assert.match(epilogueFacts(s), /\[씨앗\]/);
});

test('interpretMessages treats entering another place as move', () => {
  assert.match(interpretMessages(start(), 'x')[0].content, /다른 장소에 들어가는 행동은 .*move/);
});

test('epilogueMessages states final facts so the ending is not invented', () => {
  const s = start();
  s.ending = 'death';
  s.player.location_id = 'corridor';
  const user = epilogueMessages(s).at(-1).content;
  assert.match(user, /마지막 장소: 무너진 회랑/);
  assert.match(user, /목표 아이템\(봉인된 성배\): 얻지 못함/);
  assert.match(user, /보스\(리치\): 살아 있음/);
  assert.match(epilogueMessages(s)[0].content, /사실에 없는 일을 지어내지 않습니다/);

  s.player.inventory.push('grail');
  s.enemies.find((e) => e.id === 'lich').hp = 0;
  const won = epilogueMessages(s).at(-1).content;
  assert.match(won, /목표 아이템\(봉인된 성배\): 가지고 있음/);
  assert.match(won, /보스\(리치\): 쓰러뜨림/);
});

test('narrationFacts carry verdict, scene, defeated enemies and recent narration', () => {
  const s = start();
  s.player.location_id = 'corridor';
  s.history.push({ input: '문을 부순다', result: {}, narration: '당신은 문을 부쉈다.' });
  const hit = normalizeIntent({ action: 'attack', target: '쥐', base_chance: 50, stat: 'str' });
  const { state, result } = resolveTurn(s, hit, fixedRng(20), '쥐를 벤다');
  const facts = narrationFacts(state, '쥐를 벤다', result);
  assert.match(facts, /^\[판정 결과\] 성공/);
  assert.match(facts, /\[쓰러뜨린 적\] 거대 쥐/);
  assert.match(facts, /현재 장소: 무너진 회랑/);
  assert.match(facts, /당신은 문을 부쉈다\./);
  assert.match(facts, /1턴: 쥐를 벤다/);
});

test('epilogueFacts and checkMessages', () => {
  const s = start();
  s.ending = 'death';
  const facts = epilogueFacts(s);
  assert.match(facts, /엔딩: 사망/);
  assert.match(facts, /목표 아이템\(봉인된 성배\): 얻지 못함/);
  const msgs = checkMessages(facts, '당신은 성배를 쥐고 쓰러졌다.');
  assert.match(msgs[0].content, /모순/);
  assert.match(msgs.at(-1).content, /\[확정 사실\]/);
  assert.match(msgs.at(-1).content, /당신은 성배를 쥐고 쓰러졌다\./);
  assert.deepEqual(CHECK_SCHEMA.required, ['consistent', 'problem']);
});

test('epilogueMessages includes ending, truth and log', () => {
  const s = start();
  s.ending = 'victory';
  s.log.push('1턴: 테스트 → 성공');
  const all = text(epilogueMessages(s));
  assert.match(all, /승리/);
  assert.match(all, /리치의 심장/);
  assert.match(all, /1턴: 테스트/);
});
