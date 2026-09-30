import {
  currentLocation, exitsOf, isLocked, inventoryItems, itemsHere, enemiesHere, npcsHere, remoteNpcs, allies, matchEntity,
  enemyCondition, GRADE_LABEL, STAT_LABEL, ENDING_LABEL,
} from './rules.js';

const S = { type: 'string' };
const I = { type: 'integer' };
const B = { type: 'boolean' };
const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties) });
const arr = (items) => ({ type: 'array', items });
const oneOf = (...values) => ({ type: 'string', enum: values });

export const SCENARIO_SCHEMA = obj({
  title: S, premise: S, truth: S, goal: S,
  job: obj({ name: S, description: S, specialty: S }),
  start_location_id: S, goal_item_id: S, goal_location_id: S, boss_enemy_id: S,
  stats: obj({ str: I, dex: I, int: I }),
  locations: arr(obj({ id: S, name: S, description: S, exits: arr(obj({ to: S, requires_item_id: S })) })),
  items: arr(obj({ id: S, name: S, description: S, location_id: S, heal: I })),
  enemies: arr(obj({ id: S, name: S, location_id: S, hp: I })),
  npcs: arr(obj({ id: S, name: S, location_id: S, personality: S, knowledge: S })),
});

export const INTERPRET_SCHEMA = obj({
  action: oneOf('move', 'explore', 'take', 'use', 'attack', 'talk', 'examine', 'other'),
  target: S,
  items_used: arr(S),
  trivial: B,
  required: I,
  reason: S,
  stat: oneOf('str', 'dex', 'int'),
  item_bonus: I,
  risk: oneOf('low', 'medium', 'high', 'deadly'),
  traits: arr(obj({ name: S, effect: oneOf('help', 'hinder') })),
  effect_hp: I,
  effect_stat: oneOf('none', ...['str', 'dex', 'int'].flatMap((s) => ['+1', '+2', '-1', '-2'].map((d) => s + d))),
});

const SCENARIO_SYSTEM = `당신은 1인용 텍스트 어드벤처의 시나리오 작가입니다. 요청한 장르로 한 판(약 30~60턴) 분량의 시나리오를 JSON으로 만듭니다. 모든 텍스트는 한국어로 씁니다.

규칙:
- locations: 8~12개. id는 영문 소문자와 밑줄(예: "old_hall"). description은 1~2문장.
- exits: 연결된 장소. to에는 장소 id. 잠긴 통로면 requires_item_id에 열쇠 아이템 id, 아니면 "".
- 잠긴 통로의 열쇠는 그 통로를 지나지 않고도 얻을 수 있는 곳에 둡니다.
- items: 6~10개. location_id는 놓인 장소 id, 플레이어의 시작 소지품이면 "". 시작 소지품은 1~2개이고 그중 1개는 직업을 나타내는 아이템입니다. heal은 회복 아이템이면 1~5, 아니면 0.
- job: 플레이어의 직업. 요청한 직업이 있으면 그 직업을 쓰고, 없으면 장르에 어울리는 직업을 정합니다. description은 한 문장, specialty는 직업의 특기 한 줄.
- goal_item_id: 최종 목표 아이템(시작 소지품이면 안 됨). goal_location_id: 목표를 완수하는 장소.
- enemies: 2~4개, hp 1~6. boss_enemy_id의 보스는 반드시 goal_location_id에 배치합니다.
- npcs: 1~2명. knowledge에는 플레이어에게 도움이 될 힌트(열쇠 위치, 보스 약점 등)를 씁니다.
- stats: str(힘), dex(민첩), int(지능) 각 1~5, 합계 12. 직업에 어울리게 배분합니다.
- premise: 플레이어에게 보여줄 도입부 3~4문장(2인칭 "당신"). goal: 플레이어가 알아야 할 목표 한 문장.
- truth: 플레이어가 모르는 숨겨진 진실 2~3문장. 엔딩에서 공개됩니다.
- 승리 조건: 목표 아이템을 가지고 목표 장소에서 보스를 쓰러뜨리는 것.`;

export function scenarioMessages(genre, job = '') {
  return [
    { role: 'system', content: SCENARIO_SYSTEM },
    { role: 'user', content: `장르: ${genre}\n직업: ${job || '(장르에 어울리게 정하세요)'}` },
  ];
}

const list = (items) => items.join(', ') || '없음';

export function jobLine(state) {
  const job = state.player.job;
  if (!job) return '직업: 없음';
  return `직업: ${job.name}${job.description ? ` — ${job.description}` : ''}${job.specialty ? ` (특기: ${job.specialty})` : ''}`;
}

function traitsLine(state) {
  return `성격: ${list((state.player.traits ?? []).map((t) => `${t.name}(${t.description})`))}`;
}

export function sceneFacts(state) {
  const loc = currentLocation(state);
  return [
    `현재 장소: ${loc.name} — ${loc.description || '(아직 묘사되지 않은 곳)'}`,
    `출구: ${list(exitsOf(state).map((x) => x.location.name + (isLocked(state, x) ? ' (잠김)' : '')))}`,
    `이곳의 아이템: ${list(itemsHere(state).map((i) => i.name))}`,
    `이곳의 적: ${list(enemiesHere(state).map((e) => `${e.name}(${enemyCondition(e)})`))}`,
    `이곳의 인물: ${list(npcsHere(state).map((n) => n.name))}`,
    `원격으로 연결된 인물: ${list(remoteNpcs(state).map((n) => n.name))}`,
    `소지품: ${list(inventoryItems(state).map((i) => i.name))}`,
  ].join('\n');
}

const INTERPRET_SYSTEM = `당신은 텍스트 어드벤처의 판정관입니다. 플레이어의 입력을 해석해 JSON으로만 답합니다. 결과를 정하지 말고, 행동의 종류와 난이도만 판단합니다.

필드:
- action: move(출구 목록에 있는 장소로 이동), explore(출구 목록에 없는 새로운 곳을 찾아 들어가기: 옥상, 지하, 뒷골목 등), take(이곳의 아이템 줍기), use(소지품 사용), attack(적 공격), talk(이곳의 인물 또는 원격으로 연결된 인물과 대화), examine(살펴보기), other(그 외)
  다른 장소에 들어가는 행동은 "살펴본다"는 말이 있어도 move입니다(예: "창고를 살펴본다"에서 창고가 출구 목록에 있으면 move).
- target: 대상의 이름. 목록에 있으면 그 이름을 그대로 씁니다. explore면 찾아갈 곳의 이름. 없으면 "".
- items_used: 이 행동에 쓰는 소지품 이름. 이미 가진 것만. 없으면 [].
- trivial: 둘러보기, 대화, 소지품 확인, 위험 없는 이동, 직업 전문 분야의 일상적인 일(예: 프로게이머가 컴퓨터를 켜고 프로그램을 여는 일)처럼 실패할 이유가 없으면 true.
- required: 이 캐릭터가 이 행동을 해내는 데 필요한 능력치 수준(1~15). 캐릭터의 능력치는 보통 2~5입니다.
  기준: 쉬움 1~2, 보통 3~4, 어려움 5~6, 전문가만 가능한 일 7~8, 초인적인 일 10~15.
  대부분의 평범한 행동은 보통(3~4)입니다. 직업·특기·배경에 맞으면 낮추고, 전혀 모르는 분야면 높입니다.
  예: 서버 구축 — 프로게이머 3, 치킨집 사장 8. 맨몸으로 하늘 날기 — 누구든 15.
  플레이어의 실제 능력치 수치와 성격은 고려하지 않습니다(코드가 따로 반영합니다).
- reason: 이 행동이 쉽거나 어려운 이유를 이야기 속 상황으로 한 문장(예: "빛이 들지 않는 창고라 구석까지 살피기 어렵다"). 능력치·성격·직업 이름이나 "~이 필요합니다" 같은 규칙 표현은 쓰지 않습니다.
- stat: 가장 관련 있는 능력치. str(힘: 힘쓰기, 근접 전투), dex(민첩: 등반, 은신, 회피), int(지능: 퍼즐, 설득, 기술, 관찰).
- item_bonus: 사용하는 소지품이 행동에 도움이 되는 정도(0~20).
- risk: 실패했을 때의 위험도. low(창피한 정도), medium(가벼운 부상), high(심한 부상), deadly(목숨이 위험).
- traits: 플레이어의 성격 중 이 행동에 직접 관련된 것만 [{"name", "effect"}]. effect는 도움이면 "help", 방해면 "hinder".
  대부분의 행동은 []입니다. 예: 고소공포증은 높은 곳을 오를 때만, 달변가는 설득할 때만, 거리의 싸움꾼은 싸울 때 help·협상할 때 hinder.
- effect_hp: 이 행동이 성공하면 플레이어의 몸에 직접 생기는 체력 변화(-5~5).
  예: 음식을 먹거나 쉬면 +1~+3, 상처를 치료하면 +2~+4, 독이나 상한 것을 먹으면 -1~-3, 저주나 자해는 -2~-5.
  전투 피해, 실패 피해, 소지품 회복 아이템(heal) 효과는 코드가 처리하므로 그런 경우에만 0.
- effect_stat: 이 행동이 성공하면 영구히 바뀌는 능력치와 변화량(예: "str+1", "int-2"). 바뀌지 않으면 "none".
  예: 근력 훈련 → "str+1", 곡예·몸풀기 연습 → "dex+1", 공부·명상·책 읽기로 깨달음 → "int+1", 큰 결심·각성 → 관련 능력치 "+1",
  저주·독·큰 부상·트라우마 → 해당 능력치 "-1"~"-2". (일시적인 기세나 부상은 기록관이 따로 처리하므로 여기엔 넣지 않습니다.)`;

export function interpretMessages(state, input) {
  return [
    { role: 'system', content: INTERPRET_SYSTEM },
    { role: 'user', content: `${jobLine(state)}\n${traitsLine(state)}\n${sceneFacts(state)}\n\n플레이어 입력: ${input}` },
  ];
}

function describeResult(result) {
  if (result.kind === 'impossible') return `불가능 — ${result.reason}. 행동은 이루어지지 않았습니다.`;
  const head = result.kind === 'auto'
    ? '자동 성공 (당연히 가능한 행동)'
    : `${GRADE_LABEL[result.grade]} (${STAT_LABEL[result.stat]} 판정)`;
  return result.changes.length ? `${head} / 변화: ${result.changes.join(', ')}` : head;
}

const FATE_DIRECTION = {
  boon: '플레이어에게 뜻밖의 도움이 되는 쪽. 반드시 이번 장면에서 눈에 보이는 이득이 생겨야 합니다: 누군가 나타나 돕거나, 쓸 만한 물건을 얻거나, 막혀 있던 길이 열리는 등. 생각이나 깨달음만으로 끝내지 마세요.',
  bane: '이야기에 없던 위기를 부르는 쪽. 반드시 이번 장면에서 분명한 불이익(새로운 위협, 추격, 손실, 배신 등)이 시작되어야 합니다.',
};

// 반전은 코드가 정한 방향(twistAs)으로 구체화한다
const TWIST_DIRECTION = {
  bane: '기대와 정반대로, 선의로 한 일이 해가 되어 돌아오는 쪽 (예: 구조 요청에 응답한 자가 사실은 약탈자였다). 반드시 이번 장면에서 분명한 불이익이 시작되어야 합니다.',
  boon: '기대와 정반대로, 이기적이거나 해로운 일이 뜻밖의 도움이 되어 돌아오는 쪽 (예: 때려눕힌 깡패들이 오히려 당신을 우두머리로 따르기 시작한다). 반드시 이번 장면에서 눈에 보이는 이득이 생겨야 합니다.',
};

const seedDirection = (s) => (s.fate === 'twist' ? TWIST_DIRECTION[s.twistAs ?? 'bane'] : FATE_DIRECTION[s.fate]);

function bloomDirective(state, bloom) {
  if (!bloom) return null;
  if (bloom.kind === 'event') {
    return '[전개] 한동안 이야기가 제자리였습니다. 이번 턴에 이야기에 없던 새로운 사건을 하나 일으키되, 최종 목표로 가는 길과 연결하세요.';
  }
  const lines = bloom.seeds.map((s) => `- ${s.turn}턴에 있었던 일 "${s.text}" → ${seedDirection(s)}`);
  const head = bloom.kind === 'finale'
    ? '[나비효과: 최종 결전] 결전 직전, 과거의 일들이 한꺼번에 되돌아옵니다. 모두 이번 장면에 등장시키고 결전의 판도에 영향을 주게 하세요.'
    : '[나비효과] 과거의 일이 지금 되돌아옵니다.';
  return `${head}\n${lines.join('\n')}\n이 결과가 최종 목표(${state.goal})로 가는 길을 어떻게 바꾸는지 연결하세요. 목표 자체를 바꾸거나 없애지 마세요.`;
}

export function narrateMessages(state, input, intent, result) {
  const npc = intent.action === 'talk' ? matchEntity([...npcsHere(state), ...remoteNpcs(state)], intent.target) : null;
  const recent = state.history.slice(-6).map((h) => `플레이어: ${h.input}\n내레이터: ${h.narration}`).join('\n\n');
  const planted = state.seeds.filter((s) => s.status === 'planted').map((s) => `- ${s.text}`);
  const system = `당신은 텍스트 어드벤처 "${state.title}"의 내레이터입니다. 판정 결과는 이미 확정되었습니다. 결과를 바꾸지 말고, 왜 그런 결과가 나왔는지 그럴듯하게 이야기를 이어 쓰세요.

규칙:
- 한국어, 2인칭("당신"), 3~5문장. [나비효과]가 있으면 5~7문장까지.
- 이번 행동과 그 결과만 묘사합니다. 지난 장면을 다시 요약하지 않습니다.
- 이곳에 적이 있으면 그 존재를 분명히 드러냅니다.
- 플레이어는 [지금 상황]의 현재 장소에 있습니다. 판정에 이동이 없으면 다른 장소로 들어가는 묘사를 하지 않습니다.
- 확률, 주사위, 체력 같은 숫자는 말하지 않습니다.
- [나비효과], [연출], [전개] 같은 지시 표시는 본문에 쓰지 않고, 이야기 속 사건으로만 보여줍니다.
- 플레이어의 행동으로 그럴듯하게 생겨나거나 드러나는 인물·물건·장소·상황은 등장시켜도 됩니다. 이름과 특징을 구체적으로 묘사해 이후 이야기에서 이어질 수 있게 합니다.
- 단, 보스와 목표 아이템은 [지금 상황]에 없으면 등장시키지 않고, 잠긴 길의 열쇠나 목표를 대신하는 물건은 만들지 않습니다.
- 플레이어의 직업과 성격을 행동 묘사에 자연스럽게 녹입니다.
- 숨겨진 진실은 직접 밝히지 않습니다. 인물은 자신이 아는 것만 말합니다.
- 실패는 반드시 실패로, 성공은 반드시 성공으로 묘사합니다.

배경: ${state.premise}
목표: ${state.goal}
숨겨진 진실(분위기 참고용, 공개 금지): ${state.truth}`;
  const failed = ['failure', 'fumble', 'impossible'].includes(result.grade);
  const traits = (state.player.traits ?? []).map((t) => t.name).join(', ') || '없음';
  const statuses = (state.player.statuses ?? []).map((s) => s.name).join(', ') || '없음';
  const user = [
    `[판정 결과] ${describeResult(result)}`,
    bloomDirective(state, result.bloom),
    failed
      ? '[연출] 판정이 실패했습니다. 정답이나 해결책을 알려주지는 말되, 상황이 조금 변하거나 새로운 무언가가 눈에 띄는 등 이야기가 한 걸음 움직이도록 마무리하세요.'
      : null,
    `[플레이어 입력] ${input}`,
    `[플레이어] ${jobLine(state)} / 성격: ${traits} / 상태: ${statuses}`,
    `[지금 상황]\n${sceneFacts(state)}`,
    allies(state).length ? `[동료] ${allies(state).map((a) => a.name).join(', ')}` : null,
    npc ? `[${npc.name}] ${npc.personality || npc.description || ''} / 아는 것: ${npc.knowledge || '특별히 없음'}` : null,
    planted.length ? `[심어진 씨앗]\n${planted.join('\n')}` : null,
    `[지난 사건]\n${state.log.join('\n') || '없음'}`,
    `[최근 이야기]\n${recent || '없음'}`,
  ].filter(Boolean).join('\n\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

// 묘사에 나왔지만 AI에게 알려준 적 없는 시나리오 이름 (시스템 메시지의 숨겨진 진실은 알려준 것으로 치지 않음)
export function unknownNames(text, state, messages) {
  const context = messages.map((m) => (m.role === 'system' ? m.content.replace(state.truth, '') : m.content)).join('\n');
  const names = [...state.items, ...state.enemies, ...state.npcs].map((e) => e.name).filter((n) => n && n.length >= 2);
  return [...new Set(names.filter((n) => text.includes(n) && !context.includes(n)))];
}

function finalFacts(state) {
  const goalItem = state.items.find((i) => i.id === state.goal_item_id);
  const boss = state.enemies.find((e) => e.id === state.boss_enemy_id);
  return [
    `마지막 장소: ${currentLocation(state).name}`,
    `목표 아이템(${goalItem?.name}): ${state.player.inventory.includes(state.goal_item_id) ? '가지고 있음' : '얻지 못함'}`,
    `보스(${boss?.name}): ${boss && boss.hp <= 0 ? '쓰러뜨림' : '살아 있음'}`,
  ].join('\n');
}

const FATE_LABEL = { boon: '은혜', bane: '재앙', twist: '반전' };
const TONE_LABEL = { light: '빛', gray: '회색', shadow: '그림자' };

function seedsSummary(state) {
  return state.seeds.map((s) => {
    const how = s.status === 'bloomed' ? `: ${s.outcome || '결과 기록 없음'}` : ' (아직 돌아오지 않음)';
    return `- ${s.turn}턴 "${s.text}" → ${FATE_LABEL[s.fate]}${how}`;
  }).join('\n') || '없음';
}

export const CHECK_SCHEMA = obj({ consistent: B, problem: S });

const CHECK_SYSTEM = `당신은 텍스트 어드벤처의 검수자입니다. [확정 사실]과 [검수할 묘사]를 비교해, 묘사가 사실과 모순되는지만 판단해 JSON으로 답합니다. 문체나 분위기는 평가하지 않습니다.

모순은 다음처럼 판정 결과를 뒤집거나 [확정 사실]과 정면으로 충돌하는 경우만입니다:
- 판정이 실패인데 성공처럼, 또는 성공인데 실패처럼 묘사함
- 가지지 않은 소지품을 가진 것처럼 씀
- 현재 장소가 아닌 곳에 있는 것처럼 씀
- 쓰러뜨린 적이 다시 움직임, [지난 사건]이나 직전 묘사와 정면으로 어긋남
- [나비효과] 지시의 방향과 반대로 씀 (위기여야 하는데 이득만 생김, 도움이어야 하는데 불이익만 생김, 반전이어야 하는데 뒤집히지 않음)
- [나비효과] 같은 지시 표시를 본문에 그대로 씀

모순이 아닌 것:
- 새로운 인물·물건·장소·상황이 등장하는 것 자체는 모순이 아닙니다.
- 성공이나 실패의 원인을 어떻게 설명하는지는 평가하지 않습니다.
- [배경]에 나온 내용, [나비효과]·[전개] 지시에 따른 사건.
- 사소한 분위기 묘사(바람, 냄새, 소리, 빛, 감정).

consistent: 모순이 없으면 true. problem: 모순이 있으면 무엇이 틀렸는지 한 문장, 없으면 "".`;

export function narrationFacts(state, input, result) {
  const defeated = state.enemies.filter((e) => e.hp <= 0).map((e) => e.name);
  const recent = state.history.slice(-2).map((h) => h.narration).join('\n') || '없음';
  return [
    `[판정 결과] ${describeResult(result)}`,
    `[배경] ${state.premise}`,
    bloomDirective(state, result.bloom),
    `[플레이어 입력] ${input}`,
    `[지금 상황]\n${sceneFacts(state)}`,
    `[쓰러뜨린 적] ${list(defeated)}`,
    `[지난 사건]\n${state.log.join('\n') || '없음'}`,
    `[직전 묘사]\n${recent}`,
  ].filter(Boolean).join('\n\n');
}

export function epilogueFacts(state) {
  return [
    `엔딩: ${ENDING_LABEL[state.ending]}`,
    `[최종 사실]\n${finalFacts(state)}`,
    `[씨앗]\n${seedsSummary(state)}`,
    `[지난 사건]\n${state.log.join('\n') || '없음'}`,
  ].join('\n\n');
}

export function checkMessages(facts, text) {
  return [
    { role: 'system', content: CHECK_SYSTEM },
    { role: 'user', content: `[확정 사실]\n${facts}\n\n[검수할 묘사]\n${text}` },
  ];
}

export const CHRONICLE_SCHEMA = obj({
  new_seeds: arr(obj({ text: S, intent: oneOf('good', 'bad', 'neutral') })),
  seed_outcomes: arr(obj({ id: S, outcome: S })),
  new_knowledge: arr(S),
  new_people: arr(obj({ name: S, description: S, here: B, ally: B })),
  new_allies: arr(S),
  new_items: arr(obj({ name: S, description: S, obtained: B })),
  new_places: arr(obj({ name: S, description: S })),
  new_enemies: arr(obj({ name: S, hp: I })),
  new_statuses: arr(obj({
    name: S,
    effect: oneOf(...['str', 'dex', 'int'].flatMap((s) => ['+1', '+2', '+3', '-1', '-2', '-3'].map((d) => s + d))),
    turns: I,
  })),
  current_place_description: S,
});

const CHRONICLE_SYSTEM = `당신은 텍스트 어드벤처의 기록관입니다. 방금 [묘사]에서 새로 생겨나거나 드러난 것을 JSON으로 장부에 기록합니다. 묘사에 실제로 나온 것만 기록하고, 추측해서 만들지 않습니다. 이미 [지금 상황]이나 [알고 있는 인물]에 있는 것은 다시 기록하지 않습니다.

- new_seeds: 나중에 이야기로 되돌아올 수 있도록 세상이나 다른 존재에게 흔적을 남긴 플레이어의 행동(씨앗). 누군가를 돕거나 해친 일, 장치를 누르거나 부수거나 켠 일, 약속, 거짓말, 훔친 것, 누군가에게 신호를 보낸 일 등. 사소해 보여도 흔적이 남으면 기록합니다. "~했다" 형태의 한 문장.
  단순한 시도, 실패해서 아무 흔적도 남지 않은 행동, 이동, 둘러보기는 씨앗이 아닙니다. 대부분의 턴은 0~1개, 최대 3개.
  intent: 남을 돕거나 선의로 한 일이면 "good", 해치거나 이기적·악의적인 일이면 "bad", 그 외는 "neutral".
- seed_outcomes: [이번에 돌아온 씨앗]이 이번 묘사에서 어떤 결과를 낳았는지 {id, outcome} 한 문장씩.
- new_knowledge: 앞으로 쓸모 있을 새 단서나 사실(장소, 약점, 비밀, 누군가의 사정 등). 방금 묘사한 행동을 되풀이한 문장은 제외합니다. 대부분의 턴은 0~1개, 최대 3개.
- 적대적인 존재(좀비, 괴물, 덤벼드는 사람·짐승)는 반드시 new_enemies에 넣고 new_people에는 넣지 않습니다.
- new_people: 새로 등장한 적대적이지 않은 인물이나 동물. here는 같은 장소에 있으면 true, 채팅·무전·전화처럼 원격이면 false. ally는 그 인물이 플레이어를 돕겠다고 분명히 약속하거나 행동으로 보였을 때만 true(대답하거나 나타난 것만으로는 false). 최대 2명.
- new_allies: [알고 있는 인물] 중 이번에 플레이어를 돕겠다고 분명히 약속하거나 행동으로 보인 이름.
- new_items: 새로 등장한 물건. obtained는 플레이어가 손에 넣었으면 true. 플레이어가 무언가를 찾거나 챙기려 했고 판정이 성공했다면, 찾아낸 물건은 손에 넣은 것(true)으로 봅니다. 최대 2개.
- new_places: 새로 발견했지만 아직 들어가지 않은 장소. 최대 1개.
- new_enemies: 새로 나타난 적대적 존재. hp 1~3. 최대 1개.
- new_statuses: 묘사에서 플레이어에게 생긴 일시적인 몸·마음 상태. {name, effect, turns}. effect는 "str+2", "dex-1"처럼 능력치와 변화량(±1~3), turns는 지속 턴(1~5).
  예: 용기를 끌어올림 → 아드레날린 "str+2" 3턴, 다리를 다침 → 부상 "dex-1" 4턴, 겁에 질림 → 공포 "int-1" 2턴, 정신을 가다듬음 → 집중 "int+1" 3턴.
  대성공·대실패처럼 극적인 결과이거나 플레이어가 마음가짐을 바꾸는 행동이면 특히 기록합니다. 해당 없으면 [], 최대 2개.
- current_place_description: 현재 장소가 "(아직 묘사되지 않은 곳)"이면 묘사를 바탕으로 1~2문장, 아니면 "".
해당 없는 항목은 빈 배열이나 ""로 둡니다.`;

export function chronicleMessages(state, input, result, narration) {
  const known = state.npcs.filter((n) => n.met).map((n) => n.name);
  const bloomed = (result.bloom?.seeds ?? []).map((s) => `${s.id}: ${s.text}`);
  return [
    { role: 'system', content: CHRONICLE_SYSTEM },
    {
      role: 'user',
      content: [
        `[판정 결과] ${describeResult(result)}`,
        `[플레이어 입력] ${input}`,
        `[지금 상황]\n${sceneFacts(state)}`,
        `[알고 있는 인물] ${list(known)}`,
        `[이번에 돌아온 씨앗]\n${bloomed.join('\n') || '없음'}`,
        `[묘사]\n${narration}`,
      ].join('\n\n'),
    },
  ];
}

export const ENDING_SCHEMA = obj({ tone: oneOf('light', 'gray', 'shadow'), title: S });

export function endingToneMessages(state) {
  return [
    {
      role: 'system',
      content: `텍스트 어드벤처 "${state.title}"가 끝났습니다. 플레이어가 걸어온 길을 보고 결말의 색깔을 정해 JSON으로 답합니다.
- light(빛): 대가가 적고 떳떳한 결말
- gray(회색): 얻은 것과 잃은 것이 뒤섞인 결말
- shadow(그림자): 목표를 이뤘더라도 어두운 수단이나 큰 희생이 따른 결말, 또는 비참한 패배
승패와 색깔은 별개입니다. title은 결말의 제목(10자 안팎).`,
    },
    {
      role: 'user',
      content: `엔딩: ${ENDING_LABEL[state.ending]}\n목표: ${state.goal}\n동료: ${list(allies(state).map((a) => a.name))}\n\n[씨앗]\n${seedsSummary(state)}\n\n[지나온 사건]\n${state.log.join('\n')}`,
    },
  ];
}

export function epilogueMessages(state) {
  const last = state.history.at(-1)?.narration ?? '';
  const tone = state.endingTone;
  const toneLine = tone ? ` 결말의 색깔은 "${TONE_LABEL[tone.tone]}"입니다.` : '';
  return [
    {
      role: 'system',
      content: `당신은 텍스트 어드벤처 "${state.title}"의 내레이터입니다. 이야기가 끝났습니다. 엔딩 에필로그를 한국어 2인칭으로 6~9문장 쓰세요.${toneLine} 과거의 씨앗들이 어떻게 되었는지 자연스럽게 드러내고, 동료가 있으면 반드시 등장시키세요. 마지막에 숨겨진 진실을 극적으로 드러내세요. 숫자는 쓰지 않습니다. 아래 [최종 사실]과 지나온 사건을 따르고, 사실에 없는 일을 지어내지 않습니다.`,
    },
    {
      role: 'user',
      content: [
        `엔딩: ${ENDING_LABEL[state.ending]}${tone?.title ? `\n결말 제목: ${tone.title}` : ''}`,
        `목표: ${state.goal}\n숨겨진 진실: ${state.truth}`,
        `[최종 사실]\n${finalFacts(state)}`,
        `동료: ${list(allies(state).map((a) => a.name))}`,
        `[씨앗]\n${seedsSummary(state)}`,
        `지나온 사건:\n${state.log.join('\n')}`,
        `마지막 장면: ${last}`,
      ].join('\n\n'),
    },
  ];
}
