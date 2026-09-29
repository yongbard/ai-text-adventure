import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, normalizeIntent, resolveTurn } from '../src/rules.js';
import { interpretMessages, narrateMessages, epilogueMessages, scenarioMessages } from '../src/prompts.js';
import { makeScenario, fixedRng } from './fixtures.js';

const start = () => createInitialState(makeScenario());
const text = (msgs) => msgs.map((m) => m.content).join('\n');

test('scenarioMessages includes genre', () => {
  const msgs = scenarioMessages('좀비 생존');
  assert.equal(msgs[0].role, 'system');
  assert.match(msgs.at(-1).content, /좀비 생존/);
});

test('interpretMessages lists scene facts and hides secrets', () => {
  const all = text(interpretMessages(start(), '회랑으로 간다'));
  assert.match(all, /현재 장소: 성당 입구/);
  assert.match(all, /출구: 무너진 회랑/);
  assert.match(all, /소지품: 녹슨 단검, 횃불/);
  assert.match(all, /이곳의 인물: 늙은 수도사/);
  assert.match(all, /회랑으로 간다/);
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
  assert.match(user, /체력 -3/);
});

test('narrateMessages forbids recaps and asks to reveal enemies', () => {
  const look = normalizeIntent({ action: 'examine', trivial: true });
  const { state, result } = resolveTurn(start(), look, fixedRng(50), '둘러본다');
  const system = narrateMessages(state, '둘러본다', look, result)[0].content;
  assert.match(system, /지난 장면을 다시 요약하지 않습니다/);
  assert.match(system, /적이 있으면/);
  assert.match(system, /다른 장소로 들어가는 묘사를 하지 않습니다/);
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

test('epilogueMessages includes ending, truth and log', () => {
  const s = start();
  s.ending = 'victory';
  s.log.push('1턴: 테스트 → 성공');
  const all = text(epilogueMessages(s));
  assert.match(all, /승리/);
  assert.match(all, /리치의 심장/);
  assert.match(all, /1턴: 테스트/);
});
