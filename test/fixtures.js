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
