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
    job: {
      name: str(raw.job?.name) || '방랑자',
      description: str(raw.job?.description),
      specialty: str(raw.job?.specialty),
    },
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
  if (s.items.length < 5) errors.push('아이템이 너무 적음');
  if (s.enemies.length < 2) errors.push('적이 너무 적음');
  if (s.npcs.length < 1) errors.push('NPC가 너무 적음');
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

export async function generateScenario(llm, genre, job = '', maxAttempts = 3) {
  let lastErrors = [];
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const s = normalizeScenario(await llm.json(scenarioMessages(genre, job), SCENARIO_SCHEMA, { temperature: 0.9 }));
      lastErrors = validateScenario(s);
      if (!lastErrors.length) return s;
    } catch (err) {
      lastErrors = [err.message];
    }
  }
  throw new Error(`시나리오 생성 실패: ${lastErrors.join('; ')}`);
}
