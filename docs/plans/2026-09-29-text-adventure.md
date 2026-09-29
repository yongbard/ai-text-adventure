# AI 텍스트 어드벤처 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 로컬 Ollama(gemma4:12b)로 돌아가는 1인용 텍스트 어드벤처. 개연성 → 주사위 → 이야기 구조.

**Architecture:** 외부 의존성 없는 Node.js(ESM) 서버. 규칙(`rules.js`)은 순수 함수로 AI와 분리, AI 호출(`llm.js`)은 주입 가능한 클라이언트, `game.js`가 턴을 조율한다. 브라우저는 NDJSON 스트림으로 주사위·묘사를 받는다.

**Tech Stack:** Node.js 24 (내장 `http`, `fetch`, `node:test`), 바닐라 HTML/CSS/JS, Ollama REST API.

**Spec:** `docs/specs/2026-09-29-text-adventure-design.md`

## Global Constraints

- 외부 npm 패키지 사용 금지 (내장 모듈만)
- 모델: `gemma4:12b`, Ollama `http://localhost:11434`, `num_ctx: 16384`, `keep_alive: "30m"`, `think: false`
- 최대 턴 60, 체력 10, 능력치 각 1~5 합계 12, 최종 확률 1~99, 주사위 1~100
- 모든 게임 텍스트는 한국어
- 서버는 `127.0.0.1:3000`에만 바인딩
- 테스트 실행: `npm test` (= `node --test`)

## File Structure

```
package.json
server.js            HTTP 서버 + API 라우팅 + 정적 파일
src/rules.js         순수 규칙: 확률, 주사위, 판정, 상태 변화, 엔딩, 공개 상태
src/prompts.js       LLM 스키마와 메시지 빌더 (시나리오/해석/묘사/에필로그)
src/scenario.js      시나리오 정규화·검증·생성(재시도)
src/llm.js           Ollama 클라이언트 (json, stream, status)
src/save.js          원자적 자동 저장
src/game.js          턴 오케스트레이션
public/index.html, public/style.css, public/app.js
test/fixtures.js, test/*.test.js
```

---

### Task 1: 프로젝트 셋업 + 규칙 기초 (확률·주사위·의도 정규화)

**Files:**
- Create: `package.json`, `src/rules.js`, `test/rules.test.js`

**Interfaces:**
- Produces: `MAX_TURNS`, `RISK_DAMAGE`, `GRADE_LABEL`, `STAT_LABEL`, `ENDING_LABEL`, `clamp(n,min,max)`, `createRng(seed) → () => number`, `rollD100(rng) → 1..100`, `computeChance(base, statValue, itemBonus) → 1..99`, `gradeRoll(roll, chance) → 'critical'|'success'|'failure'|'fumble'`, `normalizeIntent(raw) → Intent`, `matchEntity(list, query) → entity|null`
- `Intent = { action, target: string|null, items_used: string[], trivial: boolean, base_chance: 1..99, reason: string, stat: 'str'|'dex'|'int', item_bonus: 0..20, risk: 'low'|'medium'|'high'|'deadly' }`

- [ ] **Step 1: package.json 작성**

```json
{
  "name": "ai-text-adventure",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node server.js",
    "test": "node --test"
  }
}
```

- [ ] **Step 2: 실패하는 테스트 작성** — `test/rules.test.js`

```js
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
```

- [ ] **Step 3: 실패 확인** — Run: `npm test` / Expected: FAIL (`Cannot find module ... src/rules.js`)

- [ ] **Step 4: 구현** — `src/rules.js`

```js
export const MAX_TURNS = 60;
export const RISK_DAMAGE = { low: 1, medium: 2, high: 3, deadly: 4 };
export const GRADE_LABEL = {
  critical: '대성공', success: '성공', failure: '실패', fumble: '대실패', impossible: '불가능',
};
export const STAT_LABEL = { str: '힘', dex: '민첩', int: '지능' };
export const ENDING_LABEL = {
  victory: '승리 — 목표를 달성했다',
  death: '사망 — 플레이어가 쓰러졌다',
  timeout: `시간 초과 — ${MAX_TURNS}턴 안에 목표를 이루지 못했다`,
};

const ACTIONS = ['move', 'take', 'use', 'attack', 'talk', 'examine', 'other'];
const STATS = ['str', 'dex', 'int'];
const RISKS = ['low', 'medium', 'high', 'deadly'];

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// mulberry32
export function createRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rollD100(rng) {
  return Math.floor(rng() * 100) + 1;
}

export function computeChance(base, statValue, itemBonus) {
  return clamp(Math.round(clamp(base, 1, 99) + (statValue - 3) * 5 + clamp(itemBonus, 0, 20)), 1, 99);
}

export function gradeRoll(roll, chance) {
  if (roll <= Math.max(1, Math.floor(chance / 5))) return 'critical';
  if (roll <= chance) return 'success';
  if (roll >= 96) return 'fumble';
  return 'failure';
}

export function normalizeIntent(raw = {}) {
  const target = typeof raw.target === 'string' ? raw.target.trim() : '';
  return {
    action: ACTIONS.includes(raw.action) ? raw.action : 'other',
    target: target || null,
    items_used: Array.isArray(raw.items_used)
      ? raw.items_used.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim())
      : [],
    trivial: raw.trivial === true,
    base_chance: Math.round(clamp(num(raw.base_chance, 50), 1, 99)),
    reason: typeof raw.reason === 'string' ? raw.reason : '',
    stat: STATS.includes(raw.stat) ? raw.stat : 'dex',
    item_bonus: Math.round(clamp(num(raw.item_bonus, 0), 0, 20)),
    risk: RISKS.includes(raw.risk) ? raw.risk : 'medium',
  };
}

const norm = (s) => String(s ?? '').replace(/\s+/g, '').toLowerCase();

export function matchEntity(list, query) {
  const q = norm(query);
  if (!q) return null;
  return (
    list.find((e) => norm(e.id) === q || norm(e.name) === q) ||
    list.find((e) => norm(e.name) && (norm(e.name).includes(q) || q.includes(norm(e.name)))) ||
    null
  );
}
```

- [ ] **Step 5: 통과 확인** — Run: `npm test` / Expected: 7 tests PASS

- [ ] **Step 6: 커밋**

```bash
git add package.json src/rules.js test/rules.test.js
git commit -m "feat: add dice, chance and intent rules"
```

---

### Task 2: 규칙 — 게임 상태, 실행 가능 여부, 턴 판정, 엔딩, 공개 상태

**Files:**
- Modify: `src/rules.js` (끝에 추가)
- Create: `test/fixtures.js`, `test/state.test.js`

**Interfaces:**
- Consumes: Task 1의 모든 export
- Produces:
  - `createInitialState(scenario) → State`
  - `currentLocation(state)`, `inventoryItems(state)`, `itemsHere(state)`, `enemiesHere(state)`, `npcsHere(state)`, `exitsOf(state) → [{to, requires_item_id, location}]`, `isLocked(state, exit) → boolean`
  - `checkFeasibility(state, intent) → { ok: true, targetId: string|null, itemIds: string[] } | { ok: false, reason: string }`
  - `resolveTurn(state, intent, rng, input) → { state, result }` (입력 state는 변경하지 않음)
  - `Result = { action, reason, stat, kind: 'impossible'|'auto'|'roll', grade, base, statMod, itemBonus, chance: number|null, roll: number|null, hpDelta, changes: string[] }`
  - `checkEnding(state) → 'death'|'victory'|'timeout'|null`
  - `publicState(state) → PublicState` (§4 스펙의 공개 필드 + `location.description`, `dice`, `epilogue`)
- `State` = 시나리오 필드(stats 제외) + `{ player: { stats, hp, max_hp, inventory: string[], location_id }, visited: string[], turn, log: string[], history: [{input, result, narration}], ending, epilogue, dice: { rolls, crits, fumbles } }`
- `test/fixtures.js`: `makeScenario()` (정규화된 시나리오), `fixedRng(roll)` (항상 그 주사위 값을 내는 rng)

- [ ] **Step 1: 테스트 픽스처 작성** — `test/fixtures.js`

```js
export function makeScenario() {
  return {
    title: '봉인된 성배',
    premise: '당신은 버려진 성당에 들어섰다.',
    truth: '성배는 사실 리치의 심장이다.',
    goal: '성배를 들고 제단의 리치를 쓰러뜨려라.',
    start_location_id: 'hall',
    goal_item_id: 'grail',
    goal_location_id: 'altar',
    boss_enemy_id: 'lich',
    stats: { str: 4, dex: 5, int: 3 },
    locations: [
      { id: 'hall', name: '성당 입구', description: '먼지 쌓인 입구.', exits: [{ to: 'corridor', requires_item_id: null }] },
      {
        id: 'corridor', name: '무너진 회랑', description: '천장이 무너진 회랑.',
        exits: [
          { to: 'hall', requires_item_id: null },
          { to: 'storage', requires_item_id: null },
          { to: 'altar', requires_item_id: 'silver_key' },
        ],
      },
      {
        id: 'storage', name: '창고', description: '낡은 상자들.',
        exits: [{ to: 'corridor', requires_item_id: null }, { to: 'crypt', requires_item_id: null }],
      },
      { id: 'crypt', name: '지하 납골당', description: '뼈가 쌓여 있다.', exits: [{ to: 'storage', requires_item_id: null }] },
      { id: 'altar', name: '제단', description: '검은 제단.', exits: [{ to: 'corridor', requires_item_id: 'silver_key' }] },
    ],
    items: [
      { id: 'dagger', name: '녹슨 단검', description: '날이 무디다.', location_id: null, heal: 0 },
      { id: 'torch', name: '횃불', description: '불이 약하다.', location_id: null, heal: 0 },
      { id: 'silver_key', name: '은빛 열쇠', description: '문장이 새겨져 있다.', location_id: 'storage', heal: 0 },
      { id: 'potion', name: '치유 물약', description: '붉은 액체.', location_id: 'crypt', heal: 3 },
      { id: 'grail', name: '봉인된 성배', description: '차가운 성배.', location_id: 'altar', heal: 0 },
    ],
    enemies: [
      { id: 'rat', name: '거대 쥐', location_id: 'corridor', hp: 2 },
      { id: 'lich', name: '리치', location_id: 'altar', hp: 6 },
    ],
    npcs: [
      { id: 'monk', name: '늙은 수도사', location_id: 'hall', personality: '겁이 많다', knowledge: '은빛 열쇠는 창고에 있다.' },
    ],
  };
}

// rollD100(fixedRng(n)) === n
export const fixedRng = (roll) => () => (roll - 0.5) / 100;
```

- [ ] **Step 2: 실패하는 테스트 작성** — `test/state.test.js`

```js
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
```

- [ ] **Step 3: 실패 확인** — Run: `npm test` / Expected: FAIL (`createInitialState` 등 export 없음)

- [ ] **Step 4: 구현** — `src/rules.js` 끝에 추가

```js
export function createInitialState(scenario) {
  const { stats, ...rest } = structuredClone(scenario);
  return {
    ...rest,
    player: {
      stats,
      hp: 10,
      max_hp: 10,
      inventory: rest.items.filter((i) => i.location_id === null).map((i) => i.id),
      location_id: rest.start_location_id,
    },
    visited: [rest.start_location_id],
    turn: 0,
    log: [],
    history: [],
    ending: null,
    epilogue: null,
    dice: { rolls: 0, crits: 0, fumbles: 0 },
  };
}

export function currentLocation(state) {
  return state.locations.find((l) => l.id === state.player.location_id);
}

export function inventoryItems(state) {
  return state.player.inventory.map((id) => state.items.find((i) => i.id === id)).filter(Boolean);
}

export function itemsHere(state) {
  return state.items.filter((i) => i.location_id === state.player.location_id);
}

export function enemiesHere(state) {
  return state.enemies.filter((e) => e.location_id === state.player.location_id && e.hp > 0);
}

export function npcsHere(state) {
  return state.npcs.filter((n) => n.location_id === state.player.location_id);
}

export function exitsOf(state) {
  return currentLocation(state).exits.map((x) => ({ ...x, location: state.locations.find((l) => l.id === x.to) }));
}

export function isLocked(state, exit) {
  return Boolean(exit.requires_item_id) && !state.player.inventory.includes(exit.requires_item_id);
}

export function checkFeasibility(state, intent) {
  const inv = inventoryItems(state);
  const itemIds = [];
  // "줍는다"에서 줍는 대상을 items_used에 넣는 실수는 무시한다
  const used = intent.action === 'take'
    ? intent.items_used.filter((n) => !matchEntity(itemsHere(state), n))
    : intent.items_used;
  for (const name of used) {
    const item = matchEntity(inv, name);
    if (!item) return { ok: false, reason: `'${name}'을(를) 가지고 있지 않다` };
    itemIds.push(item.id);
  }
  switch (intent.action) {
    case 'move': {
      const exit = exitsOf(state).find((x) => matchEntity([x.location], intent.target));
      if (!exit) return { ok: false, reason: `여기서 '${intent.target ?? '그곳'}'(으)로 가는 길이 없다` };
      if (isLocked(state, exit)) {
        const key = state.items.find((i) => i.id === exit.requires_item_id);
        return { ok: false, reason: `${exit.location.name}(으)로 가는 길은 잠겨 있다 (${key?.name ?? '열쇠'} 필요)` };
      }
      return { ok: true, targetId: exit.to, itemIds };
    }
    case 'take': {
      const item = matchEntity(itemsHere(state), intent.target);
      if (!item) return { ok: false, reason: `여기에는 '${intent.target ?? '그것'}'이(가) 없다` };
      return { ok: true, targetId: item.id, itemIds };
    }
    case 'attack': {
      const enemy = matchEntity(enemiesHere(state), intent.target);
      if (!enemy) return { ok: false, reason: `여기에는 공격할 '${intent.target ?? '대상'}'이(가) 없다` };
      return { ok: true, targetId: enemy.id, itemIds };
    }
    case 'use': {
      if (intent.target) {
        const held = matchEntity(inv, intent.target);
        if (held) return { ok: true, targetId: held.id, itemIds };
        const known = matchEntity(state.items, intent.target);
        if (known) return { ok: false, reason: `'${known.name}'을(를) 가지고 있지 않다` };
      }
      return { ok: true, targetId: itemIds[0] ?? null, itemIds };
    }
    default:
      return { ok: true, targetId: null, itemIds };
  }
}

function changeHp(state, delta, result) {
  const p = state.player;
  const next = clamp(p.hp + delta, 0, p.max_hp);
  const actual = next - p.hp;
  p.hp = next;
  result.hpDelta += actual;
  if (actual) result.changes.push(`체력 ${actual > 0 ? '+' : ''}${actual}`);
}

function applySuccess(state, action, targetId, result) {
  if (!targetId) return;
  if (action === 'move') {
    state.player.location_id = targetId;
    if (!state.visited.includes(targetId)) state.visited.push(targetId);
    result.changes.push(`${state.locations.find((l) => l.id === targetId).name}(으)로 이동`);
  } else if (action === 'take') {
    const item = state.items.find((i) => i.id === targetId);
    item.location_id = null;
    state.player.inventory.push(item.id);
    result.changes.push(`${item.name} 획득`);
  } else if (action === 'attack') {
    const enemy = state.enemies.find((e) => e.id === targetId);
    enemy.hp = Math.max(0, enemy.hp - (result.grade === 'critical' ? 4 : 2));
    result.changes.push(enemy.hp === 0 ? `${enemy.name} 처치` : `${enemy.name}에게 타격`);
  } else if (action === 'use') {
    const item = state.items.find((i) => i.id === targetId);
    if (item.heal > 0) {
      state.player.inventory = state.player.inventory.filter((id) => id !== item.id);
      item.consumed = true;
      result.changes.push(`${item.name} 사용`);
      changeHp(state, item.heal, result);
    }
  }
}

export function checkEnding(state) {
  if (state.player.hp <= 0) return 'death';
  const boss = state.enemies.find((e) => e.id === state.boss_enemy_id);
  if (
    state.player.inventory.includes(state.goal_item_id) &&
    state.player.location_id === state.goal_location_id &&
    (!boss || boss.hp <= 0)
  ) return 'victory';
  if (state.turn >= MAX_TURNS) return 'timeout';
  return null;
}

export function resolveTurn(prev, intent, rng, input = '') {
  const state = structuredClone(prev);
  const feas = checkFeasibility(state, intent);
  const result = {
    action: intent.action, reason: intent.reason, stat: intent.stat,
    kind: 'roll', grade: null, base: intent.base_chance, statMod: 0, itemBonus: 0,
    chance: null, roll: null, hpDelta: 0, changes: [],
  };

  if (!feas.ok) {
    result.kind = 'impossible';
    result.grade = 'impossible';
    result.reason = feas.reason;
  } else if (intent.trivial) {
    result.kind = 'auto';
    result.grade = 'success';
  } else {
    const statValue = state.player.stats[intent.stat];
    result.statMod = (statValue - 3) * 5;
    result.itemBonus = feas.itemIds.length ? intent.item_bonus : 0;
    result.chance = computeChance(intent.base_chance, statValue, result.itemBonus);
    result.roll = rollD100(rng);
    result.grade = gradeRoll(result.roll, result.chance);
    state.dice.rolls += 1;
    if (result.grade === 'critical') state.dice.crits += 1;
    if (result.grade === 'fumble') state.dice.fumbles += 1;
  }

  if (result.grade === 'success' || result.grade === 'critical') {
    applySuccess(state, intent.action, feas.targetId, result);
    if (result.grade === 'critical') changeHp(state, 1, result);
  } else if (result.grade === 'failure' || result.grade === 'fumble') {
    const damage = RISK_DAMAGE[intent.risk] * (result.grade === 'fumble' ? 2 : 1) + (enemiesHere(state).length ? 1 : 0);
    changeHp(state, -damage, result);
  }

  state.turn += 1;
  const changes = result.changes.length ? `, ${result.changes.join(', ')}` : '';
  state.log.push(`${state.turn}턴: ${input.slice(0, 40)} → ${GRADE_LABEL[result.grade]}${changes}`);
  state.ending = checkEnding(state);
  return { state, result };
}

export function publicState(state) {
  const loc = currentLocation(state);
  return {
    title: state.title,
    premise: state.premise,
    goal: state.goal,
    turn: state.turn,
    maxTurns: MAX_TURNS,
    hp: state.player.hp,
    maxHp: state.player.max_hp,
    stats: state.player.stats,
    location: {
      name: loc.name,
      description: loc.description,
      exits: exitsOf(state).map((x) => ({ name: x.location.name, locked: isLocked(state, x) })),
    },
    inventory: inventoryItems(state).map((i) => ({ name: i.name, description: i.description })),
    visited: state.visited.map((id) => state.locations.find((l) => l.id === id).name),
    history: state.history,
    ending: state.ending,
    epilogue: state.epilogue,
    truth: state.ending ? state.truth : null,
    dice: state.dice,
  };
}
```

- [ ] **Step 5: 통과 확인** — Run: `npm test` / Expected: 모든 테스트 PASS

- [ ] **Step 6: 커밋**

```bash
git add src/rules.js test/fixtures.js test/state.test.js
git commit -m "feat: add game state, feasibility, turn resolution and endings"
```

---

### Task 3: LLM 프롬프트와 스키마

**Files:**
- Create: `src/prompts.js`, `test/prompts.test.js`

**Interfaces:**
- Consumes: `rules.js`의 `currentLocation, exitsOf, isLocked, inventoryItems, itemsHere, enemiesHere, npcsHere, matchEntity, GRADE_LABEL, STAT_LABEL, ENDING_LABEL`
- Produces: `SCENARIO_SCHEMA`, `INTERPRET_SCHEMA`, `scenarioMessages(genre)`, `sceneFacts(state) → string`, `interpretMessages(state, input)`, `narrateMessages(state, input, intent, result)`, `epilogueMessages(state)` — 모두 `[{role, content}]` 반환
- 스키마에서 "없음"은 빈 문자열 `""`로 표현 (nullable 타입 미사용)

- [ ] **Step 1: 실패하는 테스트 작성** — `test/prompts.test.js`

```js
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
```

- [ ] **Step 2: 실패 확인** — Run: `npm test` / Expected: FAIL (`src/prompts.js` 없음)

- [ ] **Step 3: 구현** — `src/prompts.js`

```js
import {
  currentLocation, exitsOf, isLocked, inventoryItems, itemsHere, enemiesHere, npcsHere, matchEntity,
  GRADE_LABEL, STAT_LABEL, ENDING_LABEL,
} from './rules.js';

const S = { type: 'string' };
const I = { type: 'integer' };
const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties) });
const arr = (items) => ({ type: 'array', items });

export const SCENARIO_SCHEMA = obj({
  title: S, premise: S, truth: S, goal: S,
  start_location_id: S, goal_item_id: S, goal_location_id: S, boss_enemy_id: S,
  stats: obj({ str: I, dex: I, int: I }),
  locations: arr(obj({ id: S, name: S, description: S, exits: arr(obj({ to: S, requires_item_id: S })) })),
  items: arr(obj({ id: S, name: S, description: S, location_id: S, heal: I })),
  enemies: arr(obj({ id: S, name: S, location_id: S, hp: I })),
  npcs: arr(obj({ id: S, name: S, location_id: S, personality: S, knowledge: S })),
});

export const INTERPRET_SCHEMA = obj({
  action: { type: 'string', enum: ['move', 'take', 'use', 'attack', 'talk', 'examine', 'other'] },
  target: S,
  items_used: arr(S),
  trivial: { type: 'boolean' },
  base_chance: I,
  reason: S,
  stat: { type: 'string', enum: ['str', 'dex', 'int'] },
  item_bonus: I,
  risk: { type: 'string', enum: ['low', 'medium', 'high', 'deadly'] },
});

const SCENARIO_SYSTEM = `당신은 1인용 텍스트 어드벤처의 시나리오 작가입니다. 요청한 장르로 한 판(약 30~60턴) 분량의 시나리오를 JSON으로 만듭니다. 모든 텍스트는 한국어로 씁니다.

규칙:
- locations: 8~12개. id는 영문 소문자와 밑줄(예: "old_hall"). description은 1~2문장.
- exits: 연결된 장소. to에는 장소 id. 잠긴 통로면 requires_item_id에 열쇠 아이템 id, 아니면 "".
- 잠긴 통로의 열쇠는 그 통로를 지나지 않고도 얻을 수 있는 곳에 둡니다.
- items: 6~10개. location_id는 놓인 장소 id, 플레이어의 시작 소지품이면 "". 시작 소지품은 1~2개. heal은 회복 아이템이면 1~5, 아니면 0.
- goal_item_id: 최종 목표 아이템(시작 소지품이면 안 됨). goal_location_id: 목표를 완수하는 장소.
- enemies: 2~4개, hp 1~6. boss_enemy_id의 보스는 반드시 goal_location_id에 배치합니다.
- npcs: 1~2명. knowledge에는 플레이어에게 도움이 될 힌트(열쇠 위치, 보스 약점 등)를 씁니다.
- stats: str(힘), dex(민첩), int(지능) 각 1~5, 합계 12.
- premise: 플레이어에게 보여줄 도입부 3~4문장(2인칭 "당신"). goal: 플레이어가 알아야 할 목표 한 문장.
- truth: 플레이어가 모르는 숨겨진 진실 2~3문장. 엔딩에서 공개됩니다.
- 승리 조건: 목표 아이템을 가지고 목표 장소에서 보스를 쓰러뜨리는 것.`;

export function scenarioMessages(genre) {
  return [
    { role: 'system', content: SCENARIO_SYSTEM },
    { role: 'user', content: `장르: ${genre}` },
  ];
}

const list = (items) => items.join(', ') || '없음';

export function sceneFacts(state) {
  const loc = currentLocation(state);
  const { stats, hp, max_hp: maxHp } = state.player;
  return [
    `현재 장소: ${loc.name} — ${loc.description}`,
    `출구: ${list(exitsOf(state).map((x) => x.location.name + (isLocked(state, x) ? ' (잠김)' : '')))}`,
    `이곳의 아이템: ${list(itemsHere(state).map((i) => i.name))}`,
    `이곳의 적: ${list(enemiesHere(state).map((e) => e.name))}`,
    `이곳의 인물: ${list(npcsHere(state).map((n) => n.name))}`,
    `소지품: ${list(inventoryItems(state).map((i) => i.name))}`,
    `능력치: 힘 ${stats.str}, 민첩 ${stats.dex}, 지능 ${stats.int} / 체력 ${hp}/${maxHp}`,
  ].join('\n');
}

const INTERPRET_SYSTEM = `당신은 텍스트 어드벤처의 판정관입니다. 플레이어의 입력을 해석해 JSON으로만 답합니다. 결과를 정하지 말고, 행동의 종류와 성공 가능성(개연성)만 판단합니다.

필드:
- action: move(다른 장소로 이동), take(이곳의 아이템 줍기), use(소지품 사용), attack(적 공격), talk(인물과 대화), examine(살펴보기), other(그 외)
- target: 대상의 이름. 아래 목록의 이름을 그대로 씁니다. 없으면 "".
- items_used: 이 행동에 쓰는 소지품 이름. 이미 가진 것만. 없으면 [].
- trivial: 둘러보기, 대화, 소지품 확인, 위험 없는 이동처럼 실패할 이유가 없으면 true.
- base_chance: 상황과 개연성을 고려한 성공 확률(1~99). 쉬움 70~90, 보통 40~60, 어려움 15~35, 매우 어려움 5~15, 말도 안 됨 1~3.
- reason: 그 확률을 준 이유 한 문장.
- stat: 가장 관련 있는 능력치. str(힘: 힘쓰기, 근접 전투), dex(민첩: 등반, 은신, 회피), int(지능: 퍼즐, 설득, 마법, 관찰).
- item_bonus: 사용하는 소지품이 행동에 도움이 되는 정도(0~20).
- risk: 실패했을 때의 위험도. low(창피한 정도), medium(가벼운 부상), high(심한 부상), deadly(목숨이 위험).`;

export function interpretMessages(state, input) {
  return [
    { role: 'system', content: INTERPRET_SYSTEM },
    { role: 'user', content: `${sceneFacts(state)}\n\n플레이어 입력: ${input}` },
  ];
}

function describeResult(result) {
  if (result.kind === 'impossible') return `불가능 — ${result.reason}. 행동은 이루어지지 않았습니다.`;
  const head = result.kind === 'auto'
    ? '자동 성공 (당연히 가능한 행동)'
    : `${GRADE_LABEL[result.grade]} (${STAT_LABEL[result.stat]} 판정)`;
  return result.changes.length ? `${head} / 변화: ${result.changes.join(', ')}` : head;
}

export function narrateMessages(state, input, intent, result) {
  const npc = intent.action === 'talk' ? matchEntity(npcsHere(state), intent.target) : null;
  const recent = state.history.slice(-6).map((h) => `플레이어: ${h.input}\n내레이터: ${h.narration}`).join('\n\n');
  const system = `당신은 텍스트 어드벤처 "${state.title}"의 내레이터입니다. 판정 결과는 이미 확정되었습니다. 결과를 바꾸지 말고, 왜 그런 결과가 나왔는지 그럴듯하게 이야기를 이어 쓰세요.

규칙:
- 한국어, 2인칭("당신"), 3~5문장.
- 확률, 주사위, 체력 같은 숫자는 말하지 않습니다.
- 목록에 없는 새 아이템을 플레이어에게 주지 않습니다.
- 숨겨진 진실은 직접 밝히지 않습니다. 인물은 자신이 아는 것만 말합니다.
- 실패는 반드시 실패로, 성공은 반드시 성공으로 묘사합니다.

배경: ${state.premise}
목표: ${state.goal}
숨겨진 진실(분위기 참고용, 공개 금지): ${state.truth}`;
  const user = [
    `[판정 결과] ${describeResult(result)}`,
    `[플레이어 입력] ${input}`,
    `[지금 상황]\n${sceneFacts(state)}`,
    npc ? `[${npc.name}] 성격: ${npc.personality} / 아는 것: ${npc.knowledge}` : null,
    `[지난 사건]\n${state.log.join('\n') || '없음'}`,
    `[최근 이야기]\n${recent || '없음'}`,
  ].filter(Boolean).join('\n\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

export function epilogueMessages(state) {
  const last = state.history.at(-1)?.narration ?? '';
  return [
    {
      role: 'system',
      content: `당신은 텍스트 어드벤처 "${state.title}"의 내레이터입니다. 이야기가 끝났습니다. 엔딩 에필로그를 한국어 2인칭으로 5~7문장 쓰세요. 마지막에 숨겨진 진실을 극적으로 드러내세요. 숫자는 쓰지 않습니다.`,
    },
    {
      role: 'user',
      content: `엔딩: ${ENDING_LABEL[state.ending]}\n목표: ${state.goal}\n숨겨진 진실: ${state.truth}\n\n지나온 사건:\n${state.log.join('\n')}\n\n마지막 장면: ${last}`,
    },
  ];
}
```

- [ ] **Step 4: 통과 확인** — Run: `npm test` / Expected: 모든 테스트 PASS

- [ ] **Step 5: 커밋**

```bash
git add src/prompts.js test/prompts.test.js
git commit -m "feat: add LLM schemas and prompt builders"
```

---

### Task 4: 시나리오 정규화·검증·생성

**Files:**
- Create: `src/scenario.js`, `test/scenario.test.js`

**Interfaces:**
- Consumes: `clamp` (rules.js), `SCENARIO_SCHEMA`, `scenarioMessages` (prompts.js), `llm.json(messages, schema, { temperature })`
- Produces: `normalizeScenario(raw) → Scenario`, `validateScenario(s) → string[]`, `generateScenario(llm, genre, maxAttempts = 3) → Promise<Scenario>` (실패 시 `Error('시나리오 생성 실패: ...')`)

- [ ] **Step 1: 실패하는 테스트 작성** — `test/scenario.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeScenario, validateScenario, generateScenario } from '../src/scenario.js';
import { makeScenario } from './fixtures.js';

// LLM이 내는 형태: null 대신 ""
function makeRaw() {
  const s = makeScenario();
  s.items.forEach((i) => { i.location_id ??= ''; });
  s.locations.forEach((l) => l.exits.forEach((x) => { x.requires_item_id ??= ''; }));
  return s;
}

test('normalizeScenario turns LLM output into the fixture', () => {
  assert.deepEqual(normalizeScenario(makeRaw()), makeScenario());
  assert.deepEqual(validateScenario(normalizeScenario(makeRaw())), []);
});

test('normalizeScenario fixes stats, clamps numbers, handles "null"', () => {
  const raw = makeRaw();
  raw.stats = { str: 9, dex: 0, int: 5 };
  raw.items[0].location_id = 'null';
  raw.items[3].heal = 9;
  raw.enemies[0].hp = 0;
  raw.enemies[1].hp = 2;
  const s = normalizeScenario(raw);
  assert.deepEqual(s.stats, { str: 5, dex: 2, int: 5 });
  assert.equal(s.items[0].location_id, null);
  assert.equal(s.items[3].heal, 5);
  assert.equal(s.enemies[0].hp, 1);
  assert.equal(s.enemies[1].hp, 6, 'boss hp forced to 6');
});

test('normalizeScenario adds missing reverse exits', () => {
  const raw = makeRaw();
  raw.locations.find((l) => l.id === 'altar').exits = [];
  const altar = normalizeScenario(raw).locations.find((l) => l.id === 'altar');
  assert.deepEqual(altar.exits, [{ to: 'corridor', requires_item_id: 'silver_key' }]);
});

test('validateScenario catches unreachable locations', () => {
  const s = makeScenario();
  s.locations.find((l) => l.id === 'storage').exits = [{ to: 'corridor', requires_item_id: null }];
  s.locations.find((l) => l.id === 'crypt').exits = [];
  assert.ok(validateScenario(s).includes('crypt: 도달 불가'));
});

test('validateScenario catches key locked behind its own door', () => {
  const s = makeScenario();
  s.items.find((i) => i.id === 'silver_key').location_id = 'altar';
  assert.ok(validateScenario(s).includes('altar: 도달 불가'));
});

test('validateScenario catches bad references and rules', () => {
  const s = makeScenario();
  s.goal_item_id = 'nope';
  s.enemies.find((e) => e.id === 'lich').location_id = 'hall';
  s.locations[0].exits.push({ to: 'moon', requires_item_id: null });
  const errors = validateScenario(s);
  assert.ok(errors.includes('goal_item_id 잘못됨'));
  assert.ok(errors.includes('보스가 목표 장소에 없음'));
  assert.ok(errors.includes('hall: 출구 대상 moon 없음'));
});

test('validateScenario rejects goal item in start inventory', () => {
  const s = makeScenario();
  s.items.find((i) => i.id === 'grail').location_id = null;
  assert.ok(validateScenario(s).includes('목표 아이템이 시작 소지품임'));
});

function fakeLlm(responses) {
  const calls = [];
  return {
    calls,
    async json(messages, schema, opts) {
      calls.push({ messages, schema, opts });
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

test('generateScenario retries until valid', async () => {
  const bad = makeRaw();
  bad.goal_item_id = 'nope';
  const llm = fakeLlm([new Error('JSON 깨짐'), bad, makeRaw()]);
  const s = await generateScenario(llm, '다크 판타지');
  assert.equal(s.title, '봉인된 성배');
  assert.equal(llm.calls.length, 3);
  assert.match(llm.calls[0].messages.at(-1).content, /다크 판타지/);
});

test('generateScenario gives up after 3 attempts', async () => {
  const bad = () => ({ ...makeRaw(), goal_item_id: 'nope' });
  const llm = fakeLlm([bad(), bad(), bad(), makeRaw()]);
  await assert.rejects(generateScenario(llm, 'SF'), /시나리오 생성 실패/);
  assert.equal(llm.calls.length, 3);
});
```

- [ ] **Step 2: 실패 확인** — Run: `npm test` / Expected: FAIL (`src/scenario.js` 없음)

- [ ] **Step 3: 구현** — `src/scenario.js`

```js
import { clamp } from './rules.js';
import { SCENARIO_SCHEMA, scenarioMessages } from './prompts.js';

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const ref = (v) => {
  const t = str(v);
  return t && t !== 'null' ? t : null;
};
const int = (v, fallback, min, max) => {
  const n = Number(v);
  return Math.round(clamp(Number.isFinite(n) ? n : fallback, min, max));
};

function normalizeStats(raw) {
  const stats = { str: int(raw.str, 3, 1, 5), dex: int(raw.dex, 3, 1, 5), int: int(raw.int, 3, 1, 5) };
  const keys = Object.keys(stats);
  let sum = keys.reduce((a, k) => a + stats[k], 0);
  while (sum > 12) {
    const k = keys.reduce((a, b) => (stats[b] > stats[a] ? b : a));
    stats[k] -= 1;
    sum -= 1;
  }
  while (sum < 12) {
    const k = keys.reduce((a, b) => (stats[b] < stats[a] ? b : a));
    stats[k] += 1;
    sum += 1;
  }
  return stats;
}

function addReverseExits(locations) {
  for (const loc of locations) {
    for (const x of loc.exits) {
      const other = locations.find((l) => l.id === x.to);
      if (other && !other.exits.some((y) => y.to === loc.id)) {
        other.exits.push({ to: loc.id, requires_item_id: x.requires_item_id });
      }
    }
  }
}

export function normalizeScenario(raw) {
  const s = {
    title: str(raw.title),
    premise: str(raw.premise),
    truth: str(raw.truth),
    goal: str(raw.goal),
    start_location_id: str(raw.start_location_id),
    goal_item_id: str(raw.goal_item_id),
    goal_location_id: str(raw.goal_location_id),
    boss_enemy_id: str(raw.boss_enemy_id),
    stats: normalizeStats(raw.stats ?? {}),
    locations: (raw.locations ?? []).map((l) => ({
      id: str(l.id),
      name: str(l.name),
      description: str(l.description),
      exits: (l.exits ?? []).map((x) => ({ to: str(x.to), requires_item_id: ref(x.requires_item_id) })),
    })),
    items: (raw.items ?? []).map((i) => ({
      id: str(i.id),
      name: str(i.name),
      description: str(i.description),
      location_id: ref(i.location_id),
      heal: int(i.heal, 0, 0, 5),
    })),
    enemies: (raw.enemies ?? []).map((e) => ({
      id: str(e.id), name: str(e.name), location_id: str(e.location_id), hp: int(e.hp, 1, 1, 6),
    })),
    npcs: (raw.npcs ?? []).map((n) => ({
      id: str(n.id),
      name: str(n.name),
      location_id: str(n.location_id),
      personality: str(n.personality),
      knowledge: str(n.knowledge),
    })),
  };
  const boss = s.enemies.find((e) => e.id === s.boss_enemy_id);
  if (boss) boss.hp = 6;
  addReverseExits(s.locations);
  return s;
}

function reachableLocations(s) {
  const reached = new Set([s.start_location_id]);
  const keys = new Set(s.items.filter((i) => i.location_id === null).map((i) => i.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const i of s.items) if (i.location_id && reached.has(i.location_id)) keys.add(i.id);
    for (const l of s.locations) {
      if (!reached.has(l.id)) continue;
      for (const x of l.exits) {
        if (!reached.has(x.to) && (!x.requires_item_id || keys.has(x.requires_item_id))) {
          reached.add(x.to);
          changed = true;
        }
      }
    }
  }
  return reached;
}

export function validateScenario(s) {
  const errors = [];
  const ids = (list) => new Set(list.map((x) => x.id));
  const locIds = ids(s.locations);
  const itemIds = ids(s.items);
  const enemyIds = ids(s.enemies);

  for (const [name, list] of [['locations', s.locations], ['items', s.items], ['enemies', s.enemies], ['npcs', s.npcs]]) {
    if (ids(list).size !== list.length) errors.push(`${name}: id 중복`);
    if (list.some((x) => !x.id || !x.name)) errors.push(`${name}: id 또는 name 누락`);
  }
  if (s.locations.length < 5) errors.push('장소가 너무 적음');
  if (!locIds.has(s.start_location_id)) errors.push('start_location_id 잘못됨');
  if (!locIds.has(s.goal_location_id)) errors.push('goal_location_id 잘못됨');
  if (!itemIds.has(s.goal_item_id)) errors.push('goal_item_id 잘못됨');
  if (!enemyIds.has(s.boss_enemy_id)) errors.push('boss_enemy_id 잘못됨');
  for (const l of s.locations) {
    for (const x of l.exits) {
      if (!locIds.has(x.to)) errors.push(`${l.id}: 출구 대상 ${x.to} 없음`);
      if (x.requires_item_id && !itemIds.has(x.requires_item_id)) errors.push(`${l.id}: 열쇠 ${x.requires_item_id} 없음`);
    }
  }
  for (const i of s.items) {
    if (i.location_id !== null && !locIds.has(i.location_id)) errors.push(`아이템 ${i.id}: 위치 잘못됨`);
  }
  for (const e of [...s.enemies, ...s.npcs]) {
    if (!locIds.has(e.location_id)) errors.push(`${e.id}: 위치 잘못됨`);
  }
  const goalItem = s.items.find((i) => i.id === s.goal_item_id);
  if (goalItem && goalItem.location_id === null) errors.push('목표 아이템이 시작 소지품임');
  const boss = s.enemies.find((e) => e.id === s.boss_enemy_id);
  if (boss && boss.location_id !== s.goal_location_id) errors.push('보스가 목표 장소에 없음');
  if (errors.length) return errors;

  const reached = reachableLocations(s);
  for (const l of s.locations) if (!reached.has(l.id)) errors.push(`${l.id}: 도달 불가`);
  return errors;
}

export async function generateScenario(llm, genre, maxAttempts = 3) {
  let lastErrors = [];
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const s = normalizeScenario(await llm.json(scenarioMessages(genre), SCENARIO_SCHEMA, { temperature: 0.9 }));
      lastErrors = validateScenario(s);
      if (!lastErrors.length) return s;
    } catch (err) {
      lastErrors = [err.message];
    }
  }
  throw new Error(`시나리오 생성 실패: ${lastErrors.join('; ')}`);
}
```

- [ ] **Step 4: 통과 확인** — Run: `npm test` / Expected: 모든 테스트 PASS

- [ ] **Step 5: 커밋**

```bash
git add src/scenario.js test/scenario.test.js
git commit -m "feat: add scenario normalization, validation and generation"
```

---

### Task 5: Ollama 클라이언트 + 자동 저장

**Files:**
- Create: `src/llm.js`, `src/save.js`, `test/llm.test.js`, `test/save.test.js`

**Interfaces:**
- Produces:
  - `createOllamaClient({ baseUrl?, model? }) → { model, status() → {ollama, model}, json(messages, schema, {temperature}?) → object, stream(messages, {temperature}?) → AsyncGenerator<string> }`
  - `createSaveStore(dir) → { exists() → boolean, save(state), load() → state|null }`

- [ ] **Step 1: 실패하는 테스트 작성** — `test/llm.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createOllamaClient } from '../src/llm.js';

function fakeOllama() {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    if (req.url === '/api/tags') {
      res.end(JSON.stringify({ models: [{ name: 'gemma4:12b', model: 'gemma4:12b' }] }));
      return;
    }
    const data = JSON.parse(body);
    requests.push(data);
    if (!data.stream) {
      res.end(JSON.stringify({ message: { content: '{"a":1}' } }));
      return;
    }
    // 한글 멀티바이트가 청크 경계에서 잘리도록 쪼개서 보낸다
    const full = Buffer.from('{"message":{"content":"안녕"}}\n{"message":{"content":"하세요"}}\n{"done":true}\n');
    res.write(full.subarray(0, 25));
    setTimeout(() => res.end(full.subarray(25)), 10);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, requests, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

test('json sends schema and options, parses content', async () => {
  const { server, requests, url } = await fakeOllama();
  try {
    const llm = createOllamaClient({ baseUrl: url });
    const out = await llm.json([{ role: 'user', content: 'x' }], { type: 'object' }, { temperature: 0.2 });
    assert.deepEqual(out, { a: 1 });
    const r = requests[0];
    assert.equal(r.model, 'gemma4:12b');
    assert.equal(r.think, false);
    assert.equal(r.keep_alive, '30m');
    assert.equal(r.stream, false);
    assert.deepEqual(r.format, { type: 'object' });
    assert.deepEqual(r.options, { num_ctx: 16384, temperature: 0.2 });
  } finally {
    server.close();
  }
});

test('stream yields content chunks across split bytes', async () => {
  const { server, url } = await fakeOllama();
  try {
    const llm = createOllamaClient({ baseUrl: url });
    const chunks = [];
    for await (const c of llm.stream([{ role: 'user', content: 'x' }])) chunks.push(c);
    assert.deepEqual(chunks, ['안녕', '하세요']);
  } finally {
    server.close();
  }
});

test('status reports ollama and model availability', async () => {
  const { server, url } = await fakeOllama();
  try {
    assert.deepEqual(await createOllamaClient({ baseUrl: url }).status(), { ollama: true, model: true });
    assert.deepEqual(await createOllamaClient({ baseUrl: url, model: 'other' }).status(), { ollama: true, model: false });
  } finally {
    server.close();
  }
  assert.deepEqual(await createOllamaClient({ baseUrl: 'http://127.0.0.1:9' }).status(), { ollama: false, model: false });
});
```

- [ ] **Step 2: 실패하는 테스트 작성** — `test/save.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSaveStore } from '../src/save.js';

test('save store round-trips and survives corruption', () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'adv-')), 'saves');
  const store = createSaveStore(dir);
  assert.equal(store.exists(), false);
  assert.equal(store.load(), null);
  store.save({ turn: 3, title: '테스트' });
  assert.equal(store.exists(), true);
  assert.deepEqual(store.load(), { turn: 3, title: '테스트' });
  store.save({ turn: 4 });
  assert.deepEqual(store.load(), { turn: 4 });
  assert.equal(fs.existsSync(path.join(dir, 'autosave.json.tmp')), false);
  fs.writeFileSync(path.join(dir, 'autosave.json'), '{broken');
  assert.equal(store.load(), null);
});
```

- [ ] **Step 3: 실패 확인** — Run: `npm test` / Expected: FAIL (`src/llm.js`, `src/save.js` 없음)

- [ ] **Step 4: 구현** — `src/llm.js`

```js
export function createOllamaClient({ baseUrl = 'http://localhost:11434', model = 'gemma4:12b' } = {}) {
  async function chat(body) {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, think: false, keep_alive: '30m', ...body }),
    });
    if (!res.ok) throw new Error(`Ollama 오류 ${res.status}: ${await res.text()}`);
    return res;
  }

  return {
    model,

    async status() {
      try {
        const res = await fetch(`${baseUrl}/api/tags`);
        const { models = [] } = await res.json();
        return { ollama: true, model: models.some((m) => m.name === model || m.model === model) };
      } catch {
        return { ollama: false, model: false };
      }
    },

    async json(messages, schema, { temperature = 0.3 } = {}) {
      const res = await chat({ messages, stream: false, format: schema, options: { num_ctx: 16384, temperature } });
      const data = await res.json();
      return JSON.parse(data.message.content);
    },

    async *stream(messages, { temperature = 0.8 } = {}) {
      const res = await chat({ messages, stream: true, options: { num_ctx: 16384, temperature } });
      const decoder = new TextDecoder();
      let buf = '';
      for await (const chunk of res.body) {
        buf += decoder.decode(chunk, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const data = JSON.parse(line);
          if (data.error) throw new Error(data.error);
          if (data.message?.content) yield data.message.content;
        }
      }
    },
  };
}
```

- [ ] **Step 5: 구현** — `src/save.js`

```js
import fs from 'node:fs';
import path from 'node:path';

export function createSaveStore(dir) {
  const file = path.join(dir, 'autosave.json');
  return {
    exists: () => fs.existsSync(file),
    save(state) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(state));
      fs.renameSync(`${file}.tmp`, file);
    },
    load() {
      try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        return null;
      }
    },
  };
}
```

- [ ] **Step 6: 통과 확인** — Run: `npm test` / Expected: 모든 테스트 PASS

- [ ] **Step 7: 커밋**

```bash
git add src/llm.js src/save.js test/llm.test.js test/save.test.js
git commit -m "feat: add Ollama client and atomic autosave"
```

---

### Task 6: 턴 오케스트레이션 (game.js)

**Files:**
- Create: `src/game.js`, `test/game.test.js`

**Interfaces:**
- Consumes: `createInitialState, normalizeIntent, resolveTurn, publicState, GRADE_LABEL` (rules), `generateScenario` (scenario), `interpretMessages, narrateMessages, epilogueMessages, INTERPRET_SCHEMA` (prompts), llm 클라이언트, save store
- Produces: `createGame({ llm, store, rng? }) → { status(), newGame(genre) → PublicState, load() → PublicState|null, turn(input, emit) }`
- `emit` 이벤트: `{type:'roll', result}` → `{type:'text', text}`* → `{type:'epilogue', text}`* → `{type:'state', state}` / 해석 실패 시 `{type:'error', message}`만

- [ ] **Step 1: 실패하는 테스트 작성** — `test/game.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/game.js';
import { createInitialState } from '../src/rules.js';
import { makeScenario, fixedRng } from './fixtures.js';

function makeRaw() {
  const s = makeScenario();
  s.items.forEach((i) => { i.location_id ??= ''; });
  s.locations.forEach((l) => l.exits.forEach((x) => { x.requires_item_id ??= ''; }));
  return s;
}

function fakeLlm({ json = [], stream = [] } = {}) {
  const calls = { json: 0, stream: 0 };
  return {
    model: 'fake',
    calls,
    async status() {
      return { ollama: true, model: true };
    },
    async json() {
      calls.json += 1;
      const next = json.shift();
      if (next instanceof Error) throw next;
      return next;
    },
    async *stream() {
      calls.stream += 1;
      const next = stream.shift();
      if (next instanceof Error) throw next;
      for (const c of next ?? []) yield c;
    },
  };
}

function memoryStore(initial = null) {
  let data = initial;
  return {
    exists: () => data !== null,
    save: (s) => { data = structuredClone(s); },
    load: () => structuredClone(data),
    get data() { return data; },
  };
}

const collect = () => {
  const events = [];
  return { events, emit: (e) => events.push(e), types: () => events.map((e) => e.type) };
};

test('newGame generates scenario, saves, returns public state', async () => {
  const store = memoryStore();
  const game = createGame({ llm: fakeLlm({ json: [makeRaw()] }), store });
  const pub = await game.newGame('다크 판타지');
  assert.equal(pub.title, '봉인된 성배');
  assert.equal(pub.truth, null);
  assert.equal(store.data.turn, 0);
});

test('turn emits roll, text, state in order and saves', async () => {
  const store = memoryStore();
  const llm = fakeLlm({
    json: [makeRaw(), { action: 'move', target: '회랑', trivial: true }],
    stream: [['당신은 ', '회랑으로 간다.']],
  });
  const game = createGame({ llm, store, rng: fixedRng(50) });
  await game.newGame('다크 판타지');
  const c = collect();
  await game.turn('회랑으로 간다', c.emit);
  assert.deepEqual(c.types(), ['roll', 'text', 'text', 'state']);
  assert.equal(store.data.player.location_id, 'corridor');
  assert.equal(store.data.history[0].narration, '당신은 회랑으로 간다.');
  assert.equal(c.events.at(-1).state.location.name, '무너진 회랑');
});

test('interpret retries on bad JSON', async () => {
  const llm = fakeLlm({
    json: [makeRaw(), new Error('bad'), new Error('bad'), { action: 'examine', trivial: true }],
    stream: [['주변을 본다.']],
  });
  const game = createGame({ llm, store: memoryStore(), rng: fixedRng(50) });
  await game.newGame('SF');
  const c = collect();
  await game.turn('둘러본다', c.emit);
  assert.equal(llm.calls.json, 4);
  assert.equal(c.types()[0], 'roll');
});

test('interpret failing 3 times emits error and does not use a turn', async () => {
  const store = memoryStore();
  const llm = fakeLlm({ json: [makeRaw(), new Error('x'), new Error('x'), new Error('x')] });
  const game = createGame({ llm, store, rng: fixedRng(50) });
  await game.newGame('SF');
  const c = collect();
  await game.turn('???', c.emit);
  assert.deepEqual(c.types(), ['error']);
  assert.equal(store.data.turn, 0);
});

test('narration failure falls back to code text', async () => {
  const llm = fakeLlm({
    json: [makeRaw(), { action: 'move', target: '회랑', trivial: true }],
    stream: [new Error('ollama down')],
  });
  const game = createGame({ llm, store: memoryStore(), rng: fixedRng(50) });
  await game.newGame('SF');
  const c = collect();
  await game.turn('회랑으로 간다', c.emit);
  const text = c.events.find((e) => e.type === 'text').text;
  assert.match(text, /성공/);
  assert.match(text, /무너진 회랑\(으\)로 이동/);
});

test('ending streams epilogue and reveals truth', async () => {
  const s = createInitialState(makeScenario());
  s.player.hp = 1;
  const store = memoryStore(s);
  const llm = fakeLlm({
    json: [{ action: 'other', base_chance: 10, risk: 'deadly' }],
    stream: [['당신은 쓰러졌다.'], ['모든 것이 끝났다.']],
  });
  const game = createGame({ llm, store, rng: fixedRng(90) });
  game.load();
  const c = collect();
  await game.turn('절벽에서 뛰어내린다', c.emit);
  assert.deepEqual(c.types(), ['roll', 'text', 'epilogue', 'state']);
  const final = c.events.at(-1).state;
  assert.equal(final.ending, 'death');
  assert.equal(final.epilogue, '모든 것이 끝났다.');
  assert.equal(final.truth, '성배는 사실 리치의 심장이다.');
});

test('turn rejects missing game, empty input, finished game', async () => {
  const game = createGame({ llm: fakeLlm(), store: memoryStore() });
  assert.equal(game.load(), null);
  await assert.rejects(game.turn('x', () => {}), /진행 중인 게임이 없습니다/);
  const s = createInitialState(makeScenario());
  const g2 = createGame({ llm: fakeLlm(), store: memoryStore(s) });
  g2.load();
  await assert.rejects(g2.turn('   ', () => {}), /행동을 입력해 주세요/);
  s.ending = 'death';
  const g3 = createGame({ llm: fakeLlm(), store: memoryStore(s) });
  g3.load();
  await assert.rejects(g3.turn('x', () => {}), /이미 끝난 게임입니다/);
});
```

- [ ] **Step 2: 실패 확인** — Run: `npm test` / Expected: FAIL (`src/game.js` 없음)

- [ ] **Step 3: 구현** — `src/game.js`

```js
import { createInitialState, normalizeIntent, resolveTurn, publicState, GRADE_LABEL } from './rules.js';
import { generateScenario } from './scenario.js';
import { interpretMessages, narrateMessages, epilogueMessages, INTERPRET_SCHEMA } from './prompts.js';

export function createGame({ llm, store, rng = Math.random }) {
  let current = null;
  let busy = false;

  async function exclusive(fn) {
    if (busy) throw new Error('이전 요청을 처리 중입니다');
    busy = true;
    try {
      return await fn();
    } finally {
      busy = false;
    }
  }

  async function interpret(input) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return normalizeIntent(await llm.json(interpretMessages(current, input), INTERPRET_SCHEMA, { temperature: 0.2 }));
      } catch {
        // 재시도
      }
    }
    return null;
  }

  async function streamText(messages, emit, type, fallback) {
    let text = '';
    try {
      for await (const chunk of llm.stream(messages)) {
        text += chunk;
        emit({ type, text: chunk });
      }
    } catch {
      // 아래에서 대체 문장 사용
    }
    if (!text.trim()) {
      text = fallback;
      emit({ type, text });
    }
    return text;
  }

  return {
    async status() {
      return { ...(await llm.status()), model_name: llm.model, hasSave: store.exists() };
    },

    newGame(genre) {
      return exclusive(async () => {
        current = createInitialState(await generateScenario(llm, genre));
        store.save(current);
        return publicState(current);
      });
    },

    load() {
      current = store.load();
      return current ? publicState(current) : null;
    },

    turn(input, emit) {
      return exclusive(async () => {
        if (!current) throw new Error('진행 중인 게임이 없습니다');
        if (current.ending) throw new Error('이미 끝난 게임입니다');
        const text = String(input ?? '').trim().slice(0, 300);
        if (!text) throw new Error('행동을 입력해 주세요');

        const intent = await interpret(text);
        if (!intent) {
          emit({ type: 'error', message: '무슨 행동인지 이해하지 못했어요. 다르게 표현해 주세요.' });
          return;
        }

        const { state, result } = resolveTurn(current, intent, rng, text);
        emit({ type: 'roll', result });

        const fallback = `${GRADE_LABEL[result.grade]} — ${result.changes.join(', ') || result.reason}`;
        const narration = await streamText(narrateMessages(state, text, intent, result), emit, 'text', fallback);
        state.history.push({ input: text, result, narration });

        if (state.ending) {
          state.epilogue = await streamText(epilogueMessages(state), emit, 'epilogue', '이야기는 여기서 끝이 났다.');
        }

        current = state;
        store.save(current);
        emit({ type: 'state', state: publicState(current) });
      });
    },
  };
}
```

- [ ] **Step 4: 통과 확인** — Run: `npm test` / Expected: 모든 테스트 PASS

- [ ] **Step 5: 커밋**

```bash
git add src/game.js test/game.test.js
git commit -m "feat: add turn orchestration with retries and fallbacks"
```

---

### Task 7: HTTP 서버 + 브라우저 화면

**Files:**
- Create: `server.js`, `public/index.html`, `public/style.css`, `public/app.js`, `.claude/launch.json`

**Interfaces:**
- Consumes: `createOllamaClient`, `createSaveStore`, `createGame`
- API: `GET /api/status`, `GET /api/load`, `POST /api/new {genre}`, `POST /api/turn {input}` (NDJSON)

- [ ] **Step 1: 서버 구현** — `server.js`

```js
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createOllamaClient } from './src/llm.js';
import { createSaveStore } from './src/save.js';
import { createGame } from './src/game.js';

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(import.meta.dirname, 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

const game = createGame({
  llm: createOllamaClient({ model: process.env.MODEL || 'gemma4:12b' }),
  store: createSaveStore(path.join(import.meta.dirname, 'saves')),
});

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(PUBLIC, urlPath === '/' ? 'index.html' : path.normalize(urlPath));
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/api/status') return sendJson(res, 200, await game.status());
    if (req.method === 'GET' && req.url === '/api/load') {
      const state = game.load();
      return state ? sendJson(res, 200, state) : sendJson(res, 404, { error: '저장된 게임이 없습니다' });
    }
    if (req.method === 'POST' && req.url === '/api/new') {
      const { genre } = await readJson(req);
      return sendJson(res, 200, await game.newGame(String(genre || '다크 판타지').slice(0, 100)));
    }
    if (req.method === 'POST' && req.url === '/api/turn') {
      const { input } = await readJson(req);
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8' });
      const emit = (event) => res.write(`${JSON.stringify(event)}\n`);
      try {
        await game.turn(input, emit);
      } catch (err) {
        emit({ type: 'error', message: err.message });
      }
      return res.end();
    }
    if (req.method === 'GET') return serveStatic(req, res);
    sendJson(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
});

server.listen(PORT, '127.0.0.1', () => console.log(`🎲 AI 텍스트 어드벤처: http://localhost:${PORT}`));
```

- [ ] **Step 2: 화면** — `public/index.html`

```html
<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AI 텍스트 어드벤처</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <main id="start">
    <h1>🎲 AI 텍스트 어드벤처</h1>
    <p class="sub">자유롭게 행동하세요. 개연성이 확률이 되고, 주사위가 운명을 정합니다.</p>
    <div id="status-msg" class="notice" hidden></div>
    <div class="genres">
      <button class="genre" data-genre="다크 판타지 — 버려진 성당과 저주받은 유물">🕯 다크 판타지</button>
      <button class="genre" data-genre="좀비 아포칼립스 — 현대 한국 도시에서의 생존">🧟 좀비 생존</button>
      <button class="genre" data-genre="SF 미스터리 — 고립된 우주선에서 깨어남">🚀 우주선 SF</button>
    </div>
    <form id="custom-form" class="custom">
      <input id="custom-genre" placeholder="직접 입력 (예: 조선시대 귀신 나오는 한옥)" maxlength="100">
      <button>시작</button>
    </form>
    <button id="continue-btn" class="continue" hidden>▶ 이어하기</button>
    <p id="loading" class="loading" hidden></p>
  </main>

  <div id="game" class="layout" hidden>
    <section class="story-col">
      <header class="story-head">
        <h2 id="title"></h2>
        <span id="turn"></span>
      </header>
      <div id="story" class="story"></div>
      <form id="input-form" class="input-row">
        <input id="action-input" placeholder="무엇을 하시겠습니까?" maxlength="300" autocomplete="off">
        <button id="action-btn">실행</button>
      </form>
    </section>
    <aside class="panel">
      <div class="block" id="hp-block">
        <div class="label">❤ 체력 <span id="hp-text"></span></div>
        <div class="bar"><div id="hp-bar"></div></div>
      </div>
      <div class="block" id="stats"></div>
      <div class="block"><div class="label">🎯 목표</div><div id="goal" class="small"></div></div>
      <div class="block">
        <div class="label">📍 현재 위치</div>
        <div id="location"></div>
        <div id="exits" class="small"></div>
      </div>
      <div class="block"><div class="label">🎒 소지품</div><ul id="inventory"></ul></div>
      <div class="block"><div class="label">🗺 가본 곳</div><div id="visited" class="small"></div></div>
    </aside>
  </div>
  <script type="module" src="app.js"></script>
</body>
</html>
```

- [ ] **Step 3: 스타일** — `public/style.css`

```css
:root {
  --bg: #0f0e13;
  --panel: #17151d;
  --line: #2a2733;
  --text: #e6e1d6;
  --muted: #9a93a6;
  --accent: #c9a45c;
  --ok: #6fbf73;
  --fail: #d06a5f;
  --crit: #f2c14e;
  --fumble: #ff4d4d;
  --hp: #c0392b;
  --serif: 'Noto Serif KR', 'Nanum Myeongjo', Batang, serif;
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body { background: var(--bg); color: var(--text); font-family: 'Pretendard', 'Malgun Gothic', system-ui, sans-serif; }
[hidden] { display: none !important; }
button, input {
  font: inherit; color: var(--text); background: var(--panel);
  border: 1px solid var(--line); border-radius: 8px; padding: 10px 16px;
}
button { cursor: pointer; }
button:hover:not(:disabled) { border-color: var(--accent); }
button:disabled, input:disabled { opacity: .5; cursor: default; }
input:focus { outline: none; border-color: var(--accent); }

#start { max-width: 640px; margin: 0 auto; padding: 12vh 16px; text-align: center; }
#start h1 { font-family: var(--serif); color: var(--accent); }
.sub { color: var(--muted); }
.genres { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 32px 0 16px; }
.genre { padding: 20px 8px; font-size: 1.05rem; }
.custom { display: flex; gap: 8px; }
.custom input { flex: 1; }
.continue { margin-top: 24px; border-color: var(--accent); color: var(--accent); }
.loading { color: var(--accent); animation: pulse 1.5s infinite; }
.notice { background: #3a1f1f; border: 1px solid var(--fail); padding: 12px; border-radius: 8px; margin: 16px 0; }
@keyframes pulse { 50% { opacity: .4; } }

.layout { display: grid; grid-template-columns: 1fr 300px; height: 100vh; }
.story-col { display: flex; flex-direction: column; min-width: 0; border-right: 1px solid var(--line); }
.story-head {
  display: flex; justify-content: space-between; align-items: baseline;
  padding: 16px 24px; border-bottom: 1px solid var(--line);
}
.story-head h2 { margin: 0; font-family: var(--serif); color: var(--accent); font-size: 1.3rem; }
#turn { color: var(--muted); }
.story { flex: 1; overflow-y: auto; padding: 24px; font-family: var(--serif); line-height: 1.85; font-size: 1.05rem; }
.story > div { margin-bottom: 16px; white-space: pre-wrap; }
.intro { color: var(--muted); font-style: italic; }
.player { color: var(--accent); font-family: system-ui, sans-serif; }
.roll {
  font-family: ui-monospace, Consolas, monospace; font-size: .92rem; background: var(--panel);
  border-left: 3px solid var(--line); padding: 8px 12px; border-radius: 4px;
}
.roll.ok { border-color: var(--ok); }
.roll.fail { border-color: var(--fail); }
.roll.crit { border-color: var(--crit); color: var(--crit); }
.roll.fumble { border-color: var(--fumble); color: var(--fumble); }
.roll .reason, .roll .changes { color: var(--muted); font-size: .85rem; margin-top: 4px; }
.thinking { color: var(--muted); animation: pulse 1.5s infinite; }
.error { color: var(--fail); }
.epilogue { border-top: 1px solid var(--accent); padding-top: 16px; }
.ending {
  background: var(--panel); border: 1px solid var(--accent); border-radius: 8px;
  padding: 16px 20px; font-family: system-ui, sans-serif;
}
.ending h3 { margin: 0 0 8px; color: var(--accent); }
.input-row { display: flex; gap: 8px; padding: 16px 24px; border-top: 1px solid var(--line); }
.input-row input { flex: 1; }

.panel { padding: 20px; overflow-y: auto; background: var(--panel); }
.block { margin-bottom: 20px; border-radius: 6px; }
.label { color: var(--muted); font-size: .85rem; margin-bottom: 6px; }
.small { font-size: .9rem; color: var(--muted); }
#location { font-weight: 600; margin-bottom: 4px; }
.bar { height: 10px; background: var(--line); border-radius: 5px; overflow: hidden; }
#hp-bar { height: 100%; background: var(--hp); transition: width .5s; }
#hp-bar.low { background: var(--fumble); }
.flash { animation: flash .8s; }
@keyframes flash { from { background: rgba(201, 164, 92, .35); } to { background: transparent; } }
#stats { display: flex; gap: 12px; flex-wrap: wrap; font-size: .9rem; }
#inventory { list-style: none; margin: 0; padding: 0; }
#inventory li { padding: 3px 0; }
#inventory li.new { color: var(--crit); }
#inventory li.new::after { content: ' ✨'; }
```

- [ ] **Step 4: 클라이언트 로직** — `public/app.js`

```js
const $ = (id) => document.getElementById(id);
const STAT = { str: ['💪', '힘'], dex: ['🏃', '민첩'], int: ['🧠', '지능'] };
const GRADE = {
  critical: ['🌟', '대성공!', 'crit'],
  success: ['✅', '성공!', 'ok'],
  failure: ['❌', '실패', 'fail'],
  fumble: ['💀', '대실패!', 'fumble'],
  impossible: ['🚫', '불가능', 'fail'],
};
const ENDING = { victory: '🏆 승리', death: '💀 사망', timeout: '⌛ 시간 초과' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let prevInventory = [];
let prevHp = null;
let ended = false;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function scrollStory() {
  $('story').scrollTop = $('story').scrollHeight;
}

function addBlock(cls, text) {
  const e = el('div', cls, text);
  $('story').append(e);
  scrollStory();
  return e;
}

function notice(msg) {
  $('status-msg').textContent = msg;
  $('status-msg').hidden = false;
}

async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '요청 실패');
  return data;
}

function setBusy(busy) {
  $('action-input').disabled = busy || ended;
  $('action-btn').disabled = busy || ended;
  if (!busy && !ended) $('action-input').focus();
}

function rollText(r) {
  const [icon, label] = GRADE[r.grade];
  if (r.kind === 'impossible') return `${icon} ${label} — ${r.reason}`;
  if (r.kind === 'auto') return '✔ 자동 성공';
  const parts = [`개연성 ${r.base}%`];
  if (r.statMod) parts.push(`${STAT[r.stat][1]} ${r.statMod > 0 ? '+' : ''}${r.statMod}%`);
  if (r.itemBonus) parts.push(`아이템 +${r.itemBonus}%`);
  return `🎲 ${parts.join(' ')} = ${r.chance}% → 주사위 ${r.roll} → ${icon} ${label}`;
}

function showRoll(r) {
  const line = addBlock(`roll ${GRADE[r.grade][2]}`, rollText(r));
  if (r.kind === 'roll' && r.reason) line.append(el('div', 'reason', r.reason));
  if (r.changes.length) line.append(el('div', 'changes', r.changes.join(' · ')));
}

async function showRollAnimated(r) {
  if (r.kind === 'roll') {
    const line = addBlock('roll');
    for (let i = 0; i < 12; i++) {
      line.textContent = `🎲 주사위 굴리는 중... ${Math.floor(Math.random() * 100) + 1}`;
      await sleep(80);
    }
    line.remove();
  }
  showRoll(r);
}

function showEnding(s) {
  ended = true;
  setBusy(true);
  const box = addBlock('ending');
  box.append(el('h3', '', ENDING[s.ending]));
  if (s.truth) {
    box.append(el('div', 'label', '숨겨진 진실'));
    box.append(el('p', '', s.truth));
  }
  box.append(el('p', 'small', `${s.turn}턴 · 주사위 ${s.dice.rolls}회 · 대성공 ${s.dice.crits} · 대실패 ${s.dice.fumbles}`));
  const again = el('button', '', '새 게임');
  again.onclick = () => location.reload();
  box.append(again);
}

function renderState(s) {
  $('title').textContent = s.title;
  $('turn').textContent = `${s.turn}/${s.maxTurns}턴`;
  $('hp-text').textContent = `${s.hp}/${s.maxHp}`;
  $('hp-bar').style.width = `${(s.hp / s.maxHp) * 100}%`;
  $('hp-bar').className = s.hp <= 3 ? 'low' : '';
  if (prevHp !== null && s.hp !== prevHp) {
    $('hp-block').classList.remove('flash');
    void $('hp-block').offsetWidth;
    $('hp-block').classList.add('flash');
  }
  prevHp = s.hp;
  $('stats').replaceChildren(...Object.entries(s.stats).map(([k, v]) => el('span', '', `${STAT[k][0]} ${STAT[k][1]} ${v}`)));
  $('goal').textContent = s.goal;
  $('location').textContent = s.location.name;
  $('exits').textContent = `출구: ${s.location.exits.map((x) => x.name + (x.locked ? ' 🔒' : '')).join(' / ') || '없음'}`;
  $('inventory').replaceChildren(...s.inventory.map((i) => {
    const li = el('li', prevInventory.includes(i.name) ? '' : 'new', i.name);
    li.title = i.description;
    return li;
  }));
  prevInventory = s.inventory.map((i) => i.name);
  $('visited').textContent = s.visited.join(' · ');
  if (s.ending) showEnding(s);
}

function enterGame(s) {
  $('start').hidden = true;
  $('game').hidden = false;
  $('story').replaceChildren();
  ended = false;
  prevInventory = s.inventory.map((i) => i.name);
  prevHp = s.hp;
  addBlock('intro', s.premise);
  if (!s.history.length) addBlock('narration', s.location.description);
  for (const h of s.history) {
    addBlock('player', `▶ ${h.input}`);
    showRoll(h.result);
    addBlock('narration', h.narration);
  }
  if (s.epilogue) addBlock('epilogue', s.epilogue);
  renderState(s);
  setBusy(false);
}

async function playTurn(input) {
  setBusy(true);
  addBlock('player', `▶ ${input}`);
  const thinking = addBlock('thinking', '🤔 판정관이 행동을 살피는 중...');
  let queue = Promise.resolve();
  let textEl = null;
  let epilogueEl = null;
  const handle = async (ev) => {
    thinking.remove();
    if (ev.type === 'roll') {
      await showRollAnimated(ev.result);
    } else if (ev.type === 'text') {
      textEl ??= addBlock('narration', '');
      textEl.textContent += ev.text;
      scrollStory();
    } else if (ev.type === 'epilogue') {
      epilogueEl ??= addBlock('epilogue', '');
      epilogueEl.textContent += ev.text;
      scrollStory();
    } else if (ev.type === 'state') {
      renderState(ev.state);
    } else if (ev.type === 'error') {
      addBlock('error', `⚠ ${ev.message}`);
    }
  };
  try {
    const res = await fetch('/api/turn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input }),
    });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        const ev = JSON.parse(line);
        queue = queue.then(() => handle(ev));
      }
    }
    await queue;
  } catch (err) {
    thinking.remove();
    addBlock('error', `⚠ ${err.message}`);
  }
  setBusy(false);
}

function setStartDisabled(disabled) {
  document.querySelectorAll('#start button, #start input').forEach((e) => { e.disabled = disabled; });
}

async function startGame(genre) {
  setStartDisabled(true);
  $('loading').textContent = '🌍 AI가 세계를 만드는 중... (첫 실행은 모델을 깨우느라 1~2분 걸릴 수 있어요)';
  $('loading').hidden = false;
  try {
    enterGame(await api('/api/new', { genre }));
  } catch (err) {
    notice(`시작 실패: ${err.message}`);
  } finally {
    $('loading').hidden = true;
    setStartDisabled(false);
  }
}

async function init() {
  try {
    const st = await api('/api/status');
    if (!st.ollama) notice('Ollama가 실행 중이 아니에요. 시작 메뉴에서 Ollama를 실행한 뒤 새로고침하세요.');
    else if (!st.model) notice(`모델(${st.model_name})이 없어요. 터미널에서 ollama pull ${st.model_name} 을 실행하세요.`);
    $('continue-btn').hidden = !st.hasSave;
  } catch {
    notice('게임 서버에 연결할 수 없어요.');
  }
}

document.querySelectorAll('.genre').forEach((b) => b.addEventListener('click', () => startGame(b.dataset.genre)));
$('custom-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const genre = $('custom-genre').value.trim();
  if (genre) startGame(genre);
});
$('continue-btn').addEventListener('click', async () => {
  try {
    enterGame(await api('/api/load'));
  } catch (err) {
    notice(err.message);
  }
});
$('input-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('action-input').value.trim();
  if (!input || ended) return;
  $('action-input').value = '';
  playTurn(input);
});

init();
```

- [ ] **Step 5: 미리보기 설정** — `.claude/launch.json`

```json
{
  "version": "0.0.1",
  "configurations": [
    { "name": "adventure", "runtimeExecutable": "node", "runtimeArgs": ["server.js"], "port": 3000 }
  ]
}
```

- [ ] **Step 6: 확인** — 서버를 띄우고 `GET /api/status`가 `{"ollama":true,"model":true,...}`를 반환하는지, 브라우저에서 시작 화면이 뜨고 콘솔 오류가 없는지 확인. `npm test` 전체 PASS.

- [ ] **Step 7: 커밋**

```bash
git add server.js public .claude/launch.json
git commit -m "feat: add HTTP server and browser UI"
```

---

### Task 8: 실제 모델로 플레이 검증

**Files:** 필요 시 `src/prompts.js` 조정

- [ ] **Step 1:** 브라우저에서 다크 판타지 새 게임 → 시나리오 생성 시간 측정, 생성 실패 여부 확인
- [ ] **Step 2:** 5턴 이상 플레이: 이동, 줍기, 없는 아이템 사용, 무리한 행동, 대화 → 판정·묘사가 일관적인지, 턴당 시간 측정
- [ ] **Step 3:** 새로고침 후 [이어하기]로 복원 확인
- [ ] **Step 4:** 좀비 생존, 우주선 SF로 시나리오 생성만 추가 확인
- [ ] **Step 5:** 발견한 문제는 프롬프트 수정 → `npm test` → 커밋 (`fix: ...`)
