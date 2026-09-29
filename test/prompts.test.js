import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, normalizeIntent, resolveTurn } from '../src/rules.js';
import {
  interpretMessages, narrateMessages, epilogueMessages, scenarioMessages, unknownNames, INTERPRET_SCHEMA,
  narrationFacts, epilogueFacts, checkMessages, CHECK_SCHEMA,
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
