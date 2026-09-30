import { TRAITS, traitMods, traitBonus, describeTrait } from './traits.js';

export const MAX_TURNS = 60;
export const BASE_MAX_HP = 15;
export const STAT_MIN = 1;
export const STAT_MAX = 9;
export const RISK_DAMAGE = { low: 0, medium: 1, high: 2, deadly: 3 };
export const GRADE_LABEL = {
  critical: '대성공', success: '성공', failure: '실패', fumble: '대실패', impossible: '불가능',
};
export const STAT_LABEL = { str: '힘', dex: '민첩', int: '지능' };
export const ENDING_LABEL = {
  victory: '승리 — 목표를 달성했다',
  death: '사망 — 플레이어가 쓰러졌다',
  timeout: `시간 초과 — ${MAX_TURNS}턴 안에 목표를 이루지 못했다`,
};
// 기록관이 한 턴/한 판에 새로 만들 수 있는 양
export const LIMITS = {
  seedsPerTurn: 3, seedsPlanted: 12, knowledgePerTurn: 3, peoplePerTurn: 2, people: 10,
  itemsPerTurn: 2, items: 15, placesPerTurn: 1, places: 6, enemiesPerTurn: 1, enemies: 6,
};

const ACTIONS = ['move', 'explore', 'take', 'use', 'attack', 'talk', 'examine', 'other'];
const STATS = ['str', 'dex', 'int'];
const RISKS = ['low', 'medium', 'high', 'deadly'];

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

const text = (v) => (typeof v === 'string' ? v.trim() : '');

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

// 필요 능력치와 같으면 60%, 차이 1당 10%
export function computeChance(required, statValue, itemBonus = 0, bonus = 0) {
  return clamp(Math.round(60 + (statValue - required) * 10 + clamp(itemBonus, 0, 20) + bonus), 1, 99);
}

// 마지막 글자의 받침에 맞는 조사. pair는 '이/가', '을/를', '은/는', '(으)로'
export function josa(word, pair) {
  const code = String(word).trim().slice(-1).charCodeAt(0) - 0xac00;
  const hangul = code >= 0 && code <= 11171;
  if (pair === '(으)로') {
    if (!hangul) return '(으)로';
    const jong = code % 28;
    return jong === 0 || jong === 8 ? '로' : '으로';
  }
  const [withFinal, withoutFinal] = pair.split('/');
  if (!hangul) return `${withFinal}(${withoutFinal})`;
  return code % 28 ? withFinal : withoutFinal;
}

const withJosa = (word, pair) => `${word}${josa(word, pair)}`;

export function thresholds(chance, crit = 0, fumble = 0) {
  return {
    critMax: Math.min(chance, Math.max(0, Math.max(1, Math.floor(chance / 5)) + crit)),
    fumbleFrom: Math.max(chance + 1, 96 - fumble),
  };
}

export function gradeRoll(roll, chance, crit = 0, fumble = 0) {
  const { critMax, fumbleFrom } = thresholds(chance, crit, fumble);
  if (roll <= critMax) return 'critical';
  if (roll <= chance) return 'success';
  if (roll >= fumbleFrom) return 'fumble';
  return 'failure';
}

// AI는 "str+1"처럼 능력치와 변화량을 한 값으로 준다. 테스트 등에서는 effect_stat + effect_stat_delta도 허용
function parseStatEffect(raw) {
  const combined = /^(str|dex|int)([+-][12])$/.exec(String(raw.effect_stat ?? ''));
  if (combined) return { stat: combined[1], delta: Number(combined[2]) };
  if (STATS.includes(raw.effect_stat)) return { stat: raw.effect_stat, delta: Math.round(clamp(num(raw.effect_stat_delta, 0), -2, 2)) };
  return { stat: null, delta: 0 };
}

export function normalizeIntent(raw = {}) {
  const statEffect = parseStatEffect(raw);
  return {
    action: ACTIONS.includes(raw.action) ? raw.action : 'other',
    target: text(raw.target) || null,
    items_used: Array.isArray(raw.items_used) ? raw.items_used.map(text).filter(Boolean) : [],
    trivial: raw.trivial === true,
    required: Math.round(clamp(num(raw.required, 4), 1, 15)),
    reason: typeof raw.reason === 'string' ? raw.reason : '',
    stat: STATS.includes(raw.stat) ? raw.stat : 'dex',
    item_bonus: Math.round(clamp(num(raw.item_bonus, 0), 0, 20)),
    risk: RISKS.includes(raw.risk) ? raw.risk : 'medium',
    effect_hp: Math.round(clamp(num(raw.effect_hp, 0), -5, 5)),
    effect_stat: statEffect.stat,
    effect_stat_delta: statEffect.delta,
    traits: Array.isArray(raw.traits)
      ? raw.traits.filter((t) => text(t?.name)).map((t) => ({ name: text(t.name), effect: t.effect === 'hinder' ? 'hinder' : 'help' }))
      : [],
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

function nextId(state, prefix) {
  state.seq = (state.seq ?? 0) + 1;
  return `${prefix}${state.seq}`;
}

const storyCount = (list) => list.filter((e) => e.origin === 'story').length;

export function createInitialState(scenario, traits = []) {
  const { stats, job, ...rest } = structuredClone(scenario);
  const finalStats = { ...stats };
  let maxHp = BASE_MAX_HP;
  for (const t of traits) {
    for (const k of STATS) finalStats[k] += t.effects[k] ?? 0;
    maxHp += t.effects.max_hp ?? 0;
  }
  for (const k of STATS) finalStats[k] = clamp(finalStats[k], STAT_MIN, STAT_MAX);
  maxHp = Math.max(5, maxHp);
  for (const item of rest.items) {
    item.acquired = item.location_id === null ? { turn: 0, input: '', how: '시작 소지품' } : null;
  }
  for (const enemy of rest.enemies) enemy.max_hp = enemy.hp;
  const state = {
    ...rest,
    player: {
      job: job ?? null,
      traits: structuredClone(traits),
      stats: finalStats,
      statuses: [],
      streak: 0,
      hp: maxHp,
      max_hp: maxHp,
      inventory: rest.items.filter((i) => i.location_id === null).map((i) => i.id),
      location_id: rest.start_location_id,
    },
    visited: [rest.start_location_id],
    visitedTurns: { [rest.start_location_id]: 0 },
    turn: 0,
    log: [],
    history: [],
    seeds: [],
    knowledge: [],
    seq: 0,
    stagnation: 0,
    ending: null,
    endingTone: null,
    epilogue: null,
    dice: { rolls: 0, crits: 0, fumbles: 0 },
  };
  markMet(state, 0, '');
  return state;
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

export function remoteNpcs(state) {
  return state.npcs.filter((n) => n.remote);
}

export function allies(state) {
  return state.npcs.filter((n) => n.ally);
}

export function exitsOf(state) {
  return currentLocation(state).exits.map((x) => ({ ...x, location: state.locations.find((l) => l.id === x.to) }));
}

export function isLocked(state, exit) {
  return Boolean(exit.requires_item_id) && !state.player.inventory.includes(exit.requires_item_id);
}

function markMet(state, turn, input) {
  for (const npc of npcsHere(state)) npc.met ??= { turn, input, how: '만남' };
}

export function enemyCondition(enemy) {
  const ratio = enemy.hp / (enemy.max_hp || enemy.hp || 1);
  if (ratio >= 0.67) return '멀쩡함';
  if (ratio >= 0.34) return '상처 입음';
  return '빈사';
}

// 상태 효과를 반영한 능력치
export function effectiveStat(state, stat) {
  const delta = (state.player.statuses ?? []).filter((s) => s.stat === stat).reduce((sum, s) => sum + s.delta, 0);
  return clamp(state.player.stats[stat] + delta, STAT_MIN, STAT_MAX);
}

// 이곳의 인물을 공격하면 적이 된다 (기록관이 적을 인물로 잘못 올린 경우도 여기서 바로잡힌다)
function turnHostile(state, target) {
  if (matchEntity(enemiesHere(state), target)) return;
  const npc = matchEntity(npcsHere(state), target);
  if (!npc) return;
  state.npcs = state.npcs.filter((n) => n !== npc);
  state.enemies.push({ id: nextId(state, 'E'), name: npc.name, location_id: npc.location_id, hp: 3, max_hp: 3, origin: 'story' });
}

function exitTo(state, target) {
  const exit = exitsOf(state).find((x) => matchEntity([x.location], target));
  if (!exit) return null;
  if (isLocked(state, exit)) {
    const key = state.items.find((i) => i.id === exit.requires_item_id);
    return { ok: false, reason: `${withJosa(exit.location.name, '(으)로')} 가는 길은 잠겨 있다 (${key?.name ?? '열쇠'} 필요)` };
  }
  return { ok: true, targetId: exit.to };
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
    if (!item) return { ok: false, reason: `${withJosa(name, '을/를')} 가지고 있지 않다` };
    itemIds.push(item.id);
  }
  switch (intent.action) {
    case 'move': {
      const exit = exitTo(state, intent.target);
      if (!exit) return { ok: false, reason: `여기서 ${withJosa(intent.target ?? '그곳', '(으)로')} 가는 길이 없다` };
      return exit.ok ? { ...exit, itemIds } : exit;
    }
    case 'explore': {
      const exit = exitTo(state, intent.target);
      if (exit) return exit.ok ? { ...exit, itemIds } : exit;
      const known = matchEntity(state.locations, intent.target);
      if (known) return { ok: false, reason: `여기서 ${withJosa(known.name, '(으)로')} 바로 갈 수는 없다` };
      if (storyCount(state.locations) >= LIMITS.places) return { ok: false, reason: '더 이상 새로운 길을 찾을 수 없다' };
      return { ok: true, targetId: null, itemIds, newPlace: intent.target || '이름 없는 곳' };
    }
    case 'take': {
      const item = matchEntity(itemsHere(state), intent.target);
      if (item) return { ok: true, targetId: item.id, itemIds };
      // 다른 곳에 있는 줄 아는 물건이면 없다, 세상에 없는 물건이면 "뒤져보기" 판정
      const elsewhere = matchEntity(state.items.filter((i) => !state.player.inventory.includes(i.id)), intent.target);
      if (elsewhere) return { ok: false, reason: `${withJosa(elsewhere.name, '은/는')} 여기에 없다` };
      return { ok: true, targetId: null, itemIds, search: true };
    }
    case 'attack': {
      const enemy = matchEntity(enemiesHere(state), intent.target);
      if (!enemy) return { ok: false, reason: `여기에는 공격할 ${withJosa(intent.target ?? '대상', '이/가')} 없다` };
      return { ok: true, targetId: enemy.id, itemIds };
    }
    case 'use': {
      if (intent.target) {
        const held = matchEntity(inv, intent.target);
        if (held) return { ok: true, targetId: held.id, itemIds };
        const known = matchEntity(state.items, intent.target);
        if (known) return { ok: false, reason: `${withJosa(known.name, '을/를')} 가지고 있지 않다` };
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

function changeStat(state, stat, delta, result) {
  const stats = state.player.stats;
  const next = clamp(stats[stat] + delta, STAT_MIN, STAT_MAX);
  const actual = next - stats[stat];
  stats[stat] = next;
  if (actual) result.changes.push(`${STAT_LABEL[stat]} ${actual > 0 ? '+' : ''}${actual}`);
}

function enterLocation(state, id, turn, input, result) {
  state.player.location_id = id;
  if (!state.visited.includes(id)) {
    state.visited.push(id);
    state.visitedTurns[id] = turn;
  }
  markMet(state, turn, input);
  result.changes.push(`${withJosa(state.locations.find((l) => l.id === id).name, '(으)로')} 이동`);
}

function connect(state, fromId, toId) {
  state.locations.find((l) => l.id === fromId).exits.push({ to: toId, requires_item_id: null });
  state.locations.find((l) => l.id === toId).exits.push({ to: fromId, requires_item_id: null });
}

function addPlace(state, name, description) {
  const id = nextId(state, 'L');
  state.locations.push({ id, name, description, exits: [], origin: 'story' });
  connect(state, state.player.location_id, id);
  return id;
}

// 회복 아이템을 사용했으면 true (그 턴의 AI effect_hp는 무시)
function applySuccess(state, intent, feas, result, mods, turn, input) {
  const { action } = intent;
  if (action === 'explore' && feas.newPlace) {
    enterLocation(state, addPlace(state, feas.newPlace, ''), turn, input, result);
  } else if ((action === 'move' || action === 'explore') && feas.targetId) {
    enterLocation(state, feas.targetId, turn, input, result);
  } else if (action === 'take' && feas.targetId) {
    const item = state.items.find((i) => i.id === feas.targetId);
    item.location_id = null;
    item.acquired = { turn, input, how: '주움' };
    state.player.inventory.push(item.id);
    result.changes.push(`${item.name} 획득`);
  } else if (action === 'attack' && feas.targetId) {
    const enemy = state.enemies.find((e) => e.id === feas.targetId);
    const damage = Math.max(1, (result.grade === 'critical' ? 4 : 2) + mods.attack_damage);
    enemy.hp = Math.max(0, enemy.hp - damage);
    result.changes.push(enemy.hp === 0 ? `${enemy.name} 처치` : `${enemy.name}에게 타격`);
  } else if (action === 'use' && feas.targetId) {
    const item = state.items.find((i) => i.id === feas.targetId);
    if (item.heal > 0) {
      state.player.inventory = state.player.inventory.filter((id) => id !== item.id);
      item.consumed = true;
      result.changes.push(`${item.name} 사용`);
      changeHp(state, Math.max(0, item.heal + mods.heal), result);
      return true;
    }
  } else if (action === 'talk') {
    const npc = matchEntity([...npcsHere(state), ...remoteNpcs(state)], intent.target);
    if (npc?.knowledge && !state.knowledge.some((k) => k.source === npc.id)) {
      state.knowledge.push({ id: nextId(state, 'K'), text: `${npc.name}: ${npc.knowledge}`, turn, input, source: npc.id });
      result.changes.push(`${npc.name}에게서 정보를 얻음`);
    }
  }
  return false;
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
  state.player.statuses ??= [];
  state.player.streak ??= 0;
  const turn = state.turn + 1;
  const mods = traitMods(state.player.traits);
  if (intent.action === 'attack') turnHostile(state, intent.target);
  const feas = checkFeasibility(state, intent);
  const result = {
    action: intent.action, reason: intent.reason, stat: intent.stat,
    kind: 'roll', grade: null, required: intent.required, statValue: null, statusMods: [],
    itemBonus: 0, traitBonus: 0, traitsApplied: [], allyBonus: 0, pityBonus: 0,
    chance: null, roll: null, critMax: null, fumbleFrom: null, hpDelta: 0, changes: [],
  };

  if (!feas.ok) {
    result.kind = 'impossible';
    result.grade = 'impossible';
    result.reason = feas.reason;
  } else if (intent.trivial) {
    result.kind = 'auto';
    result.grade = 'success';
  } else {
    const traits = traitBonus(state.player.traits, intent.traits);
    result.statValue = effectiveStat(state, intent.stat);
    result.statusMods = state.player.statuses.filter((s) => s.stat === intent.stat).map((s) => ({ name: s.name, delta: s.delta }));
    result.itemBonus = feas.itemIds.length ? intent.item_bonus : 0;
    result.traitBonus = traits.total;
    result.traitsApplied = traits.applied;
    result.allyBonus = state.player.location_id === state.goal_location_id ? Math.min(30, allies(state).length * 10) : 0;
    result.pityBonus = Math.min(30, state.player.streak * 10);
    result.chance = computeChance(
      intent.required, result.statValue, result.itemBonus, result.traitBonus + result.allyBonus + result.pityBonus,
    );
    Object.assign(result, thresholds(result.chance, mods.crit, mods.fumble));
    result.roll = rollD100(rng);
    result.grade = gradeRoll(result.roll, result.chance, mods.crit, mods.fumble);
    state.dice.rolls += 1;
    if (result.grade === 'critical') state.dice.crits += 1;
    if (result.grade === 'fumble') state.dice.fumbles += 1;
    state.player.streak = result.grade === 'failure' || result.grade === 'fumble' ? state.player.streak + 1 : 0;
  }

  if (result.grade === 'success' || result.grade === 'critical') {
    const usedHeal = applySuccess(state, intent, feas, result, mods, turn, input);
    if (intent.effect_hp && !usedHeal) {
      changeHp(state, intent.effect_hp > 0 ? Math.max(0, intent.effect_hp + mods.heal) : intent.effect_hp, result);
    }
    if (intent.effect_stat && intent.effect_stat_delta) changeStat(state, intent.effect_stat, intent.effect_stat_delta, result);
    if (result.grade === 'critical') changeHp(state, 1, result);
  } else if (result.grade === 'failure' || result.grade === 'fumble') {
    const damage = RISK_DAMAGE[intent.risk] * (result.grade === 'fumble' ? 2 : 1)
      + (enemiesHere(state).length ? 1 : 0) + mods.damage_taken;
    changeHp(state, -Math.max(0, damage), result);
  }

  // 상태 효과는 턴이 지날 때마다 줄어든다
  state.player.statuses = state.player.statuses
    .map((s) => ({ ...s, turns: s.turns - 1 }))
    .filter((s) => s.turns > 0);

  state.turn = turn;
  const changes = result.changes.length ? `, ${result.changes.join(', ')}` : '';
  state.log.push(`${turn}턴: ${input.slice(0, 40)} → ${GRADE_LABEL[result.grade]}${changes}`);
  state.ending = checkEnding(state);
  return { state, result };
}

// 이번 턴에 터질 씨앗. 목표 장소면 결전용 전부, 아니면 때가 된 것 하나, 정체면 가장 가까운 것을 앞당김
export function pickBlooms(state) {
  const planted = state.seeds.filter((s) => s.status === 'planted');
  const bloom = (kind, list) => {
    for (const s of list) {
      s.status = 'bloomed';
      s.bloomTurn = state.turn;
    }
    return { kind, seeds: list.map((s) => ({ id: s.id, text: s.text, turn: s.turn, fate: s.fate, twistAs: s.twistAs ?? null })) };
  };
  if (state.player.location_id === state.goal_location_id) {
    const finale = planted.filter((s) => s.finale);
    if (finale.length) return bloom('finale', finale);
  }
  const waiting = planted.filter((s) => !s.finale).sort((a, b) => a.ripen - b.ripen);
  if (waiting[0] && waiting[0].ripen <= state.turn) return bloom('due', [waiting[0]]);
  if (state.stagnation >= 3) return waiting[0] ? bloom('stagnation', [waiting[0]]) : { kind: 'event', seeds: [] };
  return null;
}

// 화면·저장용 결과에서 씨앗의 운명을 뺀다
export function sanitizeResult(result) {
  if (!result.bloom) return result;
  return { ...result, bloom: { ...result.bloom, seeds: result.bloom.seeds.map(({ fate, twistAs, ...rest }) => rest) } };
}

// 기록관이 준 raw를 한도·중복·판정 규칙에 맞춰 장부에 반영한다
export function applyChronicle(state, raw, { turn, input, grade, rng }) {
  const added = { seeds: [], knowledge: [], people: [], allies: [], items: [], places: [], enemies: [], statuses: [] };
  if (!raw || typeof raw !== 'object') return added;
  const success = grade === 'success' || grade === 'critical';
  const here = state.player.location_id;
  const strings = (v, n) => (Array.isArray(v) ? v : []).map(text).filter(Boolean).slice(0, n);
  const named = (v, n) => (Array.isArray(v) ? v : []).filter((o) => text(o?.name)).slice(0, n);
  const taken = (name) => [...state.items, ...state.npcs, ...state.enemies, ...state.locations].some((e) => e.name === name);

  // 씨앗은 문자열이나 { text, intent: good|bad|neutral }
  const seeds = (Array.isArray(raw.new_seeds) ? raw.new_seeds : [])
    .map((s) => (typeof s === 'string' ? { text: text(s), intent: 'neutral' } : { text: text(s?.text), intent: s?.intent }))
    .filter((s) => s.text)
    .slice(0, LIMITS.seedsPerTurn);
  for (const { text: t, intent: rawIntent } of seeds) {
    if (state.seeds.filter((s) => s.status === 'planted').length >= LIMITS.seedsPlanted) break;
    if (state.seeds.some((s) => s.text === t)) continue;
    const intent = ['good', 'bad'].includes(rawIntent) ? rawIntent : 'neutral';
    const r = rng();
    const fate = r < 0.35 ? 'boon' : r < 0.7 ? 'bane' : 'twist';
    const finale = rng() < 0.3;
    const ripen = finale ? null : turn + 3 + Math.floor(rng() * 8);
    // 반전: 선의는 해로, 악의는 도움으로. 중립은 동전 던지기
    let twistAs = null;
    if (fate === 'twist') twistAs = intent === 'good' ? 'bane' : intent === 'bad' ? 'boon' : rng() < 0.5 ? 'boon' : 'bane';
    state.seeds.push({
      id: nextId(state, 'S'), text: t, turn, input, fate, twistAs, intent, finale, ripen,
      status: 'planted', bloomTurn: null, outcome: '',
    });
    added.seeds.push(t);
  }

  for (const o of Array.isArray(raw.seed_outcomes) ? raw.seed_outcomes : []) {
    const seed = state.seeds.find((s) => s.id === o?.id && s.status === 'bloomed' && !s.outcome);
    if (seed && text(o.outcome)) seed.outcome = text(o.outcome);
  }

  for (const t of strings(raw.new_knowledge, LIMITS.knowledgePerTurn)) {
    if (state.knowledge.some((k) => k.text === t)) continue;
    state.knowledge.push({ id: nextId(state, 'K'), text: t, turn, input, source: 'story' });
    added.knowledge.push(t);
  }

  for (const p of named(raw.new_people, LIMITS.peoplePerTurn)) {
    const name = text(p.name);
    if (taken(name) || storyCount(state.npcs) >= LIMITS.people) continue;
    const isHere = p.here !== false;
    state.npcs.push({
      id: nextId(state, 'P'), name, description: text(p.description), personality: '', knowledge: '',
      location_id: isHere ? here : null, remote: !isHere, origin: 'story', ally: p.ally === true,
      met: { turn, input, how: isHere ? '만남' : '원격 연결' },
    });
    added.people.push(name);
    if (p.ally === true) added.allies.push(name);
  }

  for (const name of strings(raw.new_allies, 3)) {
    const npc = matchEntity(state.npcs.filter((n) => n.met), name);
    if (npc && !npc.ally) {
      npc.ally = true;
      added.allies.push(npc.name);
    }
  }

  for (const it of named(raw.new_items, LIMITS.itemsPerTurn)) {
    const name = text(it.name);
    if (taken(name) || storyCount(state.items) >= LIMITS.items) continue;
    const obtained = it.obtained === true && success;
    const item = {
      id: nextId(state, 'I'), name, description: text(it.description), location_id: obtained ? null : here,
      heal: 0, origin: 'story', acquired: obtained ? { turn, input, how: '이야기 중 획득' } : null,
    };
    state.items.push(item);
    if (obtained) state.player.inventory.push(item.id);
    added.items.push(name);
  }

  for (const pl of named(raw.new_places, LIMITS.placesPerTurn)) {
    const name = text(pl.name);
    if (taken(name) || storyCount(state.locations) >= LIMITS.places) continue;
    addPlace(state, name, text(pl.description));
    added.places.push(name);
  }

  for (const en of named(raw.new_enemies, LIMITS.enemiesPerTurn)) {
    const name = text(en.name);
    if (taken(name) || storyCount(state.enemies) >= LIMITS.enemies) continue;
    const hp = Math.round(clamp(num(en.hp, 2), 1, 3));
    state.enemies.push({ id: nextId(state, 'E'), name, location_id: here, hp, max_hp: hp, origin: 'story' });
    added.enemies.push(name);
  }

  // 일시적 상태 효과: 한 턴에 2개, 동시에 4개까지, 같은 이름은 덮어씀
  state.player.statuses ??= [];
  const statuses = (Array.isArray(raw.new_statuses) ? raw.new_statuses : [])
    .map((s) => ({ name: text(s?.name), effect: /^(str|dex|int)([+-][123])$/.exec(String(s?.effect ?? '')), turns: s?.turns }))
    .filter((s) => s.name && s.effect)
    .slice(0, 2);
  for (const s of statuses) {
    const status = {
      name: s.name, stat: s.effect[1], delta: Number(s.effect[2]), turns: Math.round(clamp(num(s.turns, 3), 1, 5)), turn,
    };
    state.player.statuses = [...state.player.statuses.filter((x) => x.name !== s.name), status].slice(-4);
    added.statuses.push(`${s.name}(${describeStatus(status)}, ${status.turns}턴)`);
  }

  const loc = currentLocation(state);
  if (!loc.description && text(raw.current_place_description)) loc.description = text(raw.current_place_description);
  return added;
}

function describeStatus(status) {
  return `${STAT_LABEL[status.stat]} ${status.delta > 0 ? '+' : ''}${status.delta}`;
}

export function hasAdded(added) {
  return Object.values(added).some((list) => list.length);
}

export function updateStagnation(prev, state, added) {
  const progressed = state.visited.length > prev.visited.length
    || state.player.inventory.length > prev.player.inventory.length
    || state.knowledge.length > (prev.knowledge?.length ?? 0)
    || hasAdded(added);
  state.stagnation = progressed ? 0 : (prev.stagnation ?? 0) + 1;
}

// 이전 버전 저장 파일을 현재 구조로 맞춘다
export function migrateState(state) {
  state.seeds ??= [];
  state.knowledge ??= [];
  state.seq ??= 0;
  state.stagnation ??= 0;
  state.endingTone ??= null;
  state.visitedTurns ??= Object.fromEntries(state.visited.map((id) => [id, null]));
  state.player.job ??= null;
  state.player.streak ??= 0;
  state.player.statuses ??= [];
  for (const enemy of state.enemies) enemy.max_hp ??= Math.max(enemy.hp, 1);
  state.player.traits = (state.player.traits ?? []).map((t) => {
    const def = TRAITS.find((d) => d.id === t.id);
    return def ? structuredClone(def) : { ...t, check: t.check ?? 0 };
  });
  for (const item of state.items) {
    if (item.acquired === undefined) {
      item.acquired = state.player.inventory.includes(item.id) ? { turn: null, input: '', how: '이전 버전에서 획득' } : null;
    }
  }
  state.history.forEach((h, i) => { h.turn ??= i + 1; });
  return state;
}

export function publicState(state) {
  const loc = currentLocation(state);
  const ended = Boolean(state.ending);
  return {
    title: state.title,
    premise: state.premise,
    goal: state.goal,
    turn: state.turn,
    maxTurns: MAX_TURNS,
    hp: state.player.hp,
    maxHp: state.player.max_hp,
    stats: Object.fromEntries(STATS.map((k) => [k, effectiveStat(state, k)])),
    baseStats: state.player.stats,
    statuses: (state.player.statuses ?? []).map((s) => ({ name: s.name, summary: describeStatus(s), turns: s.turns })),
    here: {
      items: itemsHere(state).map((i) => ({ name: i.name, description: i.description })),
      enemies: enemiesHere(state).map((e) => ({ name: e.name, condition: enemyCondition(e) })),
      people: npcsHere(state).map((n) => n.name),
    },
    job: state.player.job ?? null,
    traits: (state.player.traits ?? []).map((t) => ({
      name: t.name, description: t.description, good: t.good, summary: describeTrait(t),
    })),
    location: {
      name: loc.name,
      description: loc.description,
      exits: exitsOf(state).map((x) => ({ name: x.location.name, locked: isLocked(state, x) })),
    },
    inventory: inventoryItems(state).map((i) => ({ name: i.name, description: i.description, acquired: i.acquired ?? null })),
    knowledge: (state.knowledge ?? []).map((k) => ({ text: k.text, turn: k.turn, input: k.input })),
    people: state.npcs.filter((n) => n.met).map((n) => ({
      name: n.name,
      description: n.description ?? n.personality ?? '',
      here: n.location_id === state.player.location_id,
      remote: Boolean(n.remote),
      ally: Boolean(n.ally),
      met: n.met,
    })),
    seeds: (state.seeds ?? []).map((s) => ({
      text: s.text, turn: s.turn, input: s.input, status: s.status, bloomTurn: s.bloomTurn,
      outcome: s.status === 'bloomed' ? s.outcome : '', fate: ended ? s.fate : null,
    })),
    visited: state.visited.map((id) => ({ name: state.locations.find((l) => l.id === id).name, turn: state.visitedTurns?.[id] ?? null })),
    history: state.history,
    ending: state.ending,
    endingTone: state.endingTone ?? null,
    epilogue: state.epilogue,
    truth: ended ? state.truth : null,
    dice: state.dice,
  };
}
