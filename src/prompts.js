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
