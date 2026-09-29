import { traitMods, describeEffects } from './traits.js';

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

export function computeChance(base, statValue, itemBonus, traitBonus = 0) {
  return clamp(Math.round(clamp(base, 1, 99) + (statValue - 3) * 5 + clamp(itemBonus, 0, 20) + traitBonus), 1, 99);
}

export function gradeRoll(roll, chance, crit = 0, fumble = 0) {
  const critMax = Math.min(chance, Math.max(0, Math.max(1, Math.floor(chance / 5)) + crit));
  if (roll <= critMax) return 'critical';
  if (roll <= chance) return 'success';
  if (roll >= 96 - fumble) return 'fumble';
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
    effect_hp: Math.round(clamp(num(raw.effect_hp, 0), -5, 5)),
    effect_stat: STATS.includes(raw.effect_stat) ? raw.effect_stat : null,
    effect_stat_delta: STATS.includes(raw.effect_stat) ? Math.round(clamp(num(raw.effect_stat_delta, 0), -2, 2)) : 0,
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
  return {
    ...rest,
    player: {
      job: job ?? null,
      traits: structuredClone(traits),
      stats: finalStats,
      hp: maxHp,
      max_hp: maxHp,
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

function changeStat(state, stat, delta, result) {
  const stats = state.player.stats;
  const next = clamp(stats[stat] + delta, STAT_MIN, STAT_MAX);
  const actual = next - stats[stat];
  stats[stat] = next;
  if (actual) result.changes.push(`${STAT_LABEL[stat]} ${actual > 0 ? '+' : ''}${actual}`);
}

// 회복 아이템을 사용했으면 true (그 턴의 AI effect_hp는 무시)
function applySuccess(state, action, targetId, result, mods) {
  if (!targetId) return false;
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
    const damage = Math.max(1, (result.grade === 'critical' ? 4 : 2) + mods.attack_damage);
    enemy.hp = Math.max(0, enemy.hp - damage);
    result.changes.push(enemy.hp === 0 ? `${enemy.name} 처치` : `${enemy.name}에게 타격`);
  } else if (action === 'use') {
    const item = state.items.find((i) => i.id === targetId);
    if (item.heal > 0) {
      state.player.inventory = state.player.inventory.filter((id) => id !== item.id);
      item.consumed = true;
      result.changes.push(`${item.name} 사용`);
      changeHp(state, Math.max(0, item.heal + mods.heal), result);
      return true;
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
  const mods = traitMods(state.player.traits);
  const feas = checkFeasibility(state, intent);
  const result = {
    action: intent.action, reason: intent.reason, stat: intent.stat,
    kind: 'roll', grade: null, base: intent.base_chance, statMod: 0, itemBonus: 0, traitBonus: 0,
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
    result.traitBonus = (mods.action[intent.action] ?? 0) + (enemiesHere(state).length ? mods.vs_enemy : 0);
    result.chance = computeChance(intent.base_chance, statValue, result.itemBonus, result.traitBonus);
    result.roll = rollD100(rng);
    result.grade = gradeRoll(result.roll, result.chance, mods.crit, mods.fumble);
    state.dice.rolls += 1;
    if (result.grade === 'critical') state.dice.crits += 1;
    if (result.grade === 'fumble') state.dice.fumbles += 1;
  }

  if (result.grade === 'success' || result.grade === 'critical') {
    const usedHeal = applySuccess(state, intent.action, feas.targetId, result, mods);
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
    job: state.player.job ?? null,
    traits: (state.player.traits ?? []).map((t) => ({
      name: t.name, description: t.description, good: t.good, summary: describeEffects(t.effects),
    })),
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
