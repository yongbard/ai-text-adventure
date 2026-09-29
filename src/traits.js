const G = (id, name, group, description, effects) => ({ id, name, good: true, group, description, effects });
const B = (id, name, group, description, effects) => ({ id, name, good: false, group, description, effects });

export const TRAITS = [
  G('g1', '용감함', 'courage', '위험 앞에서도 물러서지 않는다.', { str: 1 }),
  G('g2', '날렵함', 'agility', '몸놀림이 가볍고 빠르다.', { dex: 1 }),
  G('g3', '명석함', 'intellect', '머리 회전이 빠르다.', { int: 1 }),
  G('g4', '강인함', 'toughness', '웬만한 상처에는 끄떡없다.', { max_hp: 3 }),
  G('g5', '행운아', 'luck', '이상하게 일이 잘 풀린다.', { crit: 2 }),
  G('g6', '침착함', 'temper', '위기에도 호흡이 흐트러지지 않는다.', { damage_taken: -1 }),
  G('g7', '달변가', 'speech', '말 한마디로 사람을 움직인다.', { action: { talk: 15 } }),
  G('g8', '예리한 눈', 'perception', '남들이 놓치는 것을 본다.', { action: { examine: 15 } }),
  G('g9', '손재주', 'craft', '도구를 다루는 데 능숙하다.', { action: { use: 10 } }),
  G('g10', '전투 본능', 'fighting', '싸움의 흐름을 몸이 먼저 안다.', { action: { attack: 10 } }),
  G('g11', '길눈 밝음', 'navigation', '한 번 본 길은 잊지 않는다.', { action: { move: 10 } }),
  G('g12', '눈썰미', 'grabbing', '쓸 만한 물건을 재빨리 알아본다.', { action: { take: 10 } }),
  G('g13', '튼튼한 위장', 'stomach', '무엇을 먹든 회복이 빠르다.', { heal: 1 }),
  G('g14', '강심장', 'nerve', '적을 마주해도 심장이 뛰지 않는다.', { vs_enemy: 10 }),
  G('g15', '괴력', 'might', '보기보다 힘이 무시무시하다.', { attack_damage: 1 }),
  G('g16', '신중함', 'caution', '큰 실수를 하는 법이 없다.', { fumble: -3 }),
  G('g17', '기발함', 'creativity', '생각지 못한 방법을 떠올린다.', { action: { other: 15 } }),
  G('g18', '학구파', 'study', '무엇이든 파고들어 이해한다.', { int: 1, action: { examine: 5 } }),
  G('g19', '운동선수', 'athlete', '몸이 머리보다 먼저 움직인다.', { str: 1, dex: 1, int: -1 }),
  G('g20', '거리의 싸움꾼', 'fighting', '말보다 주먹이 빠르다.', { attack_damage: 1, action: { attack: 10, talk: -10 } }),
  G('g21', '탐험가 기질', 'navigation', '낯선 곳일수록 가슴이 뛴다.', { action: { move: 10, examine: 5 } }),
  G('g22', '사교적', 'speech', '누구와도 금방 친해진다.', { action: { talk: 10, other: 5 } }),
  G('g23', '생존 본능', 'toughness', '끝까지 살아남는 법을 안다.', { max_hp: 2, heal: 1 }),
  G('g24', '끈기', 'grit', '한번 시작한 일은 끝을 본다.', { max_hp: 2, action: { other: 5 } }),
  G('g25', '낙천적', 'optimism', '어떤 상황에서도 웃음을 잃지 않는다.', { crit: 1, heal: 1 }),
  G('g26', '기회주의자', 'grabbing', '기회가 오면 놓치지 않는다.', { crit: 1, action: { take: 10 } }),
  G('g27', '은밀함', 'stealth', '발소리 하나 내지 않고 움직인다.', { dex: 1, action: { move: 5 } }),
  G('g28', '인내심', 'temper', '고통을 묵묵히 견딘다.', { damage_taken: -1, action: { attack: -5 } }),
  G('g29', '집중력', 'focus', '한 가지에 몰두하면 주변이 사라진다.', { action: { use: 5, examine: 5, other: 5 } }),
  G('g30', '야생의 감', 'instinct', '위험의 냄새를 맡는다.', { vs_enemy: 5, action: { move: 5 } }),
  G('g31', '의리', 'loyalty', '한번 맺은 인연은 저버리지 않는다.', { max_hp: 1, action: { talk: 10 } }),
  G('g32', '호기심', 'curiosity', '궁금한 건 참지 못한다.', { fumble: 1, action: { examine: 10 } }),
  G('g33', '대담함', 'courage', '과감하게 승부를 건다.', { crit: 1, vs_enemy: 5, action: { attack: 5 } }),
  G('g34', '차분한 손', 'craft', '손끝이 떨리는 법이 없다.', { fumble: -1, action: { use: 10 } }),
  G('g35', '강골', 'bones', '뼈대가 굵고 단단하다.', { max_hp: 4, dex: -1 }),
  G('g36', '재빠른 판단', 'agility', '순간의 판단이 정확하다.', { dex: 1, action: { other: 5 } }),
  G('g37', '박식함', 'intellect', '온갖 잡지식에 밝다.', { int: 1, action: { talk: 5 } }),
  G('g38', '굳센 체력', 'stamina', '지치는 법을 모른다.', { max_hp: 3, action: { move: 5 } }),
  G('g39', '명사수', 'aim', '노린 곳은 반드시 맞힌다.', { str: -1, attack_damage: 1, action: { attack: 10 } }),
  G('g40', '동물적 감각', 'nerve', '생각보다 본능이 앞선다.', { int: -1, vs_enemy: 15 }),
  G('g41', '회복력', 'stomach', '상처가 금세 아문다.', { heal: 2 }),
  G('g42', '철벽', 'iron', '쉽게 뚫리지 않는다.', { damage_taken: -1, max_hp: 1 }),
  G('g43', '임기응변', 'creativity', '위기 때마다 수를 낸다.', { action: { other: 10, use: 5 } }),
  G('g44', '카리스마', 'charisma', '존재만으로 분위기를 압도한다.', { vs_enemy: 5, action: { talk: 10 } }),
  G('g45', '세심함', 'meticulous', '작은 것 하나 허투루 넘기지 않는다.', { fumble: -2, action: { examine: 10 } }),
  G('g46', '민첩한 손', 'quickhand', '손이 눈보다 빠르다.', { action: { take: 10, use: 5 } }),
  G('g47', '투지', 'spirit', '쓰러져도 다시 일어난다.', { int: -1, damage_taken: -1, action: { attack: 5 } }),
  G('g48', '천운', 'luck', '하늘이 돕는 사람이다.', { crit: 3, fumble: 1 }),
  G('g49', '노련함', 'veteran', '산전수전 다 겪었다.', { crit: 1, fumble: -1, action: { other: 5 } }),
  G('g50', '담력', 'guts', '겁이라는 걸 모른다.', { str: 1, vs_enemy: 5, action: { talk: -5 } }),

  B('b1', '겁 많음', 'courage', '작은 소리에도 움찔한다.', { str: -1 }),
  B('b2', '굼뜸', 'agility', '몸이 생각을 따라가지 못한다.', { dex: -1 }),
  B('b3', '산만함', 'intellect', '생각이 이리저리 흩어진다.', { int: -1 }),
  B('b4', '허약함', 'toughness', '조금만 다쳐도 크게 앓는다.', { max_hp: -3 }),
  B('b5', '불운', 'luck', '되는 일이 없다.', { fumble: 3 }),
  B('b6', '충동적', 'temper', '생각보다 몸이 먼저 나가 다친다.', { damage_taken: 1 }),
  B('b7', '무뚝뚝함', 'speech', '말주변이 없어 오해를 산다.', { action: { talk: -15 } }),
  B('b8', '덤벙거림', 'perception', '중요한 것을 자주 놓친다.', { action: { examine: -15 } }),
  B('b9', '서투른 손', 'craft', '도구만 잡으면 어설퍼진다.', { action: { use: -10 } }),
  B('b10', '평화주의자', 'fighting', '누군가를 해치는 게 내키지 않는다.', { action: { attack: -15 } }),
  B('b11', '길치', 'navigation', '방금 온 길도 헷갈린다.', { action: { move: -10 } }),
  B('b12', '부주의', 'grabbing', '물건을 자주 떨어뜨린다.', { action: { take: -10 } }),
  B('b13', '예민한 체질', 'stomach', '약도 음식도 잘 받지 않는다.', { heal: -1 }),
  B('b14', '공포증', 'nerve', '적 앞에서 몸이 굳는다.', { vs_enemy: -10 }),
  B('b15', '약한 손목', 'might', '힘을 실어 휘두르지 못한다.', { attack_damage: -1 }),
  B('b16', '경솔함', 'caution', '앞뒤 재지 않고 저지른다.', { fumble: 3, action: { other: 5 } }),
  B('b17', '고지식함', 'creativity', '정해진 방법밖에 모른다.', { action: { other: -15 } }),
  B('b18', '다혈질', 'temper', '화를 참지 못한다.', { damage_taken: 1, action: { attack: 5, talk: -10 } }),
  B('b19', '몽상가', 'dreamer', '늘 딴생각에 빠져 있다.', { int: 1, action: { examine: -10, move: -10 } }),
  B('b20', '게으름', 'lazy', '움직이는 게 귀찮다.', { dex: -1, action: { move: -5 } }),
  B('b21', '탐욕', 'grabbing', '가진 게 많을수록 더 갖고 싶다.', { fumble: 1, action: { take: 10, talk: -15 } }),
  B('b22', '비관주의', 'optimism', '늘 최악을 상상한다.', { crit: -1, heal: -1 }),
  B('b23', '소심함', 'courage', '맞서기보다 피하고 싶다.', { vs_enemy: -5, action: { attack: -10 } }),
  B('b24', '건망증', 'forgetful', '방금 한 일도 잊어버린다.', { int: -1, action: { use: -5 } }),
  B('b25', '고소공포증', 'heights', '높은 곳만 보면 다리가 풀린다.', { action: { move: -10, other: -5 } }),
  B('b26', '거만함', 'arrogance', '남의 말을 귀담아듣지 않는다.', { fumble: 1, action: { talk: -10 } }),
  B('b27', '허세', 'bluff', '실력보다 큰소리가 앞선다.', { damage_taken: 1, action: { attack: 5 } }),
  B('b28', '느긋함', 'slow', '서두르는 법이 없다.', { dex: -1, heal: 1 }),
  B('b29', '편식', 'stomach', '입맛이 까다로워 늘 기운이 없다.', { max_hp: -1, heal: -1 }),
  B('b30', '수다쟁이', 'chatty', '입을 다물 줄 모른다.', { action: { talk: 5, move: -10, other: -5 } }),
  B('b31', '겁먹은 눈', 'nerve', '적만 보면 도망칠 길부터 찾는다.', { vs_enemy: -10, action: { move: 5 } }),
  B('b32', '서두름', 'hasty', '늘 급하게 움직인다.', { fumble: 2, action: { move: 5, examine: -10 } }),
  B('b33', '의심병', 'paranoia', '아무도 믿지 않는다.', { action: { talk: -10, examine: 5 } }),
  B('b34', '병약함', 'toughness', '잔병치레가 잦다.', { max_hp: -2, heal: -1 }),
  B('b35', '둔한 감각', 'perception', '위험을 늦게 알아챈다.', { vs_enemy: -5, action: { examine: -10 } }),
  B('b36', '허당', 'klutz', '결정적인 순간에 꼭 실수한다.', { fumble: 2, action: { use: -5 } }),
  B('b37', '무모함', 'reckless', '앞뒤 가리지 않고 뛰어든다.', { damage_taken: 1, fumble: 1, action: { attack: 10 } }),
  B('b38', '우유부단', 'indecisive', '결정을 내리지 못해 기회를 놓친다.', { action: { other: -10, attack: -5 } }),
  B('b39', '근력 부족', 'weak', '무거운 건 들지 못한다.', { str: -1, max_hp: -1 }),
  B('b40', '불면증', 'insomnia', '며칠째 제대로 잠들지 못했다.', { max_hp: -2, action: { examine: -5 } }),
  B('b41', '결벽증', 'neat', '더러운 것은 만지지 못한다.', { action: { take: -10, use: -5 } }),
  B('b42', '외골수', 'stubborn', '한 가지 생각에서 벗어나지 못한다.', { int: 1, action: { talk: -15, other: -5 } }),
  B('b43', '엄살', 'whiny', '작은 상처에도 크게 앓는 소리를 한다.', { damage_taken: 1, action: { talk: 5 } }),
  B('b44', '저주받은 운', 'luck', '불행이 늘 따라다닌다.', { crit: -2, fumble: 1 }),
  B('b45', '방향치', 'navigation', '동서남북을 구분하지 못한다.', { action: { move: -15 } }),
  B('b46', '손떨림', 'craft', '긴장하면 손이 떨린다.', { action: { use: -10, attack: -5 } }),
  B('b47', '저질 체력', 'frail', '몸은 가볍지만 금방 지친다.', { dex: 1, max_hp: -4 }),
  B('b48', '오지랖', 'meddler', '남의 일에 참견하다 일을 그르친다.', { fumble: 1, action: { talk: 5, take: -10 } }),
  B('b49', '폭식가', 'glutton', '먹을 것만 보면 정신을 못 차린다.', { dex: -1, heal: 1 }),
  B('b50', '소음 유발자', 'noisy', '어딜 가든 시끄럽다.', { vs_enemy: -5, action: { move: -5 } }),
];

export function drawTraits(rng) {
  const picked = [];
  for (const good of [true, true, false, false]) {
    const pool = TRAITS.filter((t) => t.good === good && !picked.some((p) => p.group === t.group));
    picked.push(pool[Math.floor(rng() * pool.length)]);
  }
  return picked.map((t) => structuredClone(t));
}

const MOD_KEYS = ['crit', 'fumble', 'damage_taken', 'attack_damage', 'heal', 'vs_enemy'];

export function traitMods(traits = []) {
  const mods = { crit: 0, fumble: 0, damage_taken: 0, attack_damage: 0, heal: 0, vs_enemy: 0, action: {} };
  for (const t of traits) {
    for (const k of MOD_KEYS) mods[k] += t.effects[k] ?? 0;
    for (const [a, v] of Object.entries(t.effects.action ?? {})) mods.action[a] = (mods.action[a] ?? 0) + v;
  }
  return mods;
}

const ACTION_LABEL = {
  move: '이동', take: '줍기', use: '사용', attack: '공격', talk: '대화', examine: '관찰', other: '기타 행동',
};
const sign = (n) => (n > 0 ? `+${n}` : `${n}`);

export function describeEffects(effects) {
  const parts = [];
  for (const [k, label] of [['str', '힘'], ['dex', '민첩'], ['int', '지능'], ['max_hp', '최대 체력'], ['crit', '대성공 범위'],
    ['fumble', '대실패 범위'], ['damage_taken', '받는 피해'], ['attack_damage', '공격 피해'], ['heal', '회복량']]) {
    if (effects[k]) parts.push(`${label} ${sign(effects[k])}`);
  }
  if (effects.vs_enemy) parts.push(`적 앞 판정 ${sign(effects.vs_enemy)}%`);
  for (const [a, v] of Object.entries(effects.action ?? {})) parts.push(`${ACTION_LABEL[a]} 판정 ${sign(v)}%`);
  return parts.join(', ');
}
