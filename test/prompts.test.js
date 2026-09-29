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

test('epilogueMessages includes ending, truth and log', () => {
  const s = start();
  s.ending = 'victory';
  s.log.push('1턴: 테스트 → 성공');
  const all = text(epilogueMessages(s));
  assert.match(all, /승리/);
  assert.match(all, /리치의 심장/);
  assert.match(all, /1턴: 테스트/);
});
