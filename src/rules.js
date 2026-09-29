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
