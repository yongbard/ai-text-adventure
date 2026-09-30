const $ = (id) => document.getElementById(id);
const STAT = { str: ['💪', '힘'], dex: ['🏃', '민첩'], int: ['🧠', '지능'] };
const GRADE = {
  critical: ['🌟', '대성공!', 'crit'],
  success: ['✅', '성공!', 'ok'],
  failure: ['❌', '실패', 'fail'],
  fumble: ['💀', '대실패!', 'fumble'],
  impossible: ['🚫', '불가능', 'fail'],
};
const CODE_GRADE = { critical: 'CRIT', success: 'PASS', failure: 'FAIL', fumble: 'FATAL', impossible: 'SKIP' };
const ENDING = { victory: ['🏆', '승리'], death: ['💀', '사망'], timeout: ['⌛', '시간 초과'] };
const TONE = { light: '빛의 결말', gray: '회색의 결말', shadow: '그림자의 결말' };
const FATE = { boon: ['🌱', '은혜'], bane: ['🔥', '재앙'], twist: ['🎭', '반전'] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sign = (n) => (n > 0 ? `+${n}` : `${n}`);
// 을/를: 마지막 글자 받침 유무
function objectJosa(word) {
  const code = word.trim().slice(-1).charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return '을(를)';
  return code % 28 ? '을' : '를';
}

// ---------- 테마 ----------
const THEMES = {
  dark: { plain: false, tabs: ['상태', '소지품·지식', '인물·실타래', '기록'], placeholder: '무엇을 하시겠습니까?', button: '실행', head: '' },
  light: { plain: false, tabs: ['상태', '소지품·지식', '인물·실타래', '기록'], placeholder: '무엇을 하시겠습니까?', button: '실행', head: '' },
  code: { plain: true, tabs: ['status.ts', 'inventory.ts', 'people.ts', 'history.log'], placeholder: '', button: 'Run', head: 'story.ts' },
  agent: { plain: true, tabs: ['상태', '소지품', '인물', '기록'], placeholder: '메시지를 입력하세요…', button: '전송', head: 'API 응답 캐싱 적용' },
};
let theme = 'dark';
const plain = () => THEMES[theme].plain;
const ic = (emoji) => (plain() ? '' : `${emoji} `);

function loadTheme() {
  try {
    const saved = localStorage.getItem('adventure-theme');
    if (THEMES[saved]) return saved;
  } catch {
    // 저장소를 못 쓰면 기본값
  }
  return 'dark';
}

function applyTheme(name) {
  theme = name;
  document.documentElement.dataset.theme = name;
  try {
    localStorage.setItem('adventure-theme', name);
  } catch {
    // 기억 못 해도 동작에는 문제없음
  }
  const t = THEMES[name];
  document.querySelectorAll('.theme-choice').forEach((b) => b.classList.toggle('active', b.dataset.themeChoice === name));
  document.querySelectorAll('.tabs button').forEach((b, i) => { b.textContent = t.tabs[i]; });
  $('action-input').placeholder = t.placeholder;
  $('action-btn').textContent = t.button;
  $('head-alt').textContent = t.head;
}

// 테마별 문구
function fmt() {
  if (theme === 'code') {
    return {
      player: (input) => `await act("${input}");`,
      intro: (text) => `// ${text}`,
      thinking: '// running...',
      rollHead: (r) => `check("${STAT[r.stat][1]}", { need: ${r.required}, have: ${r.statValue} }); // ${r.chance}%`,
      rolling: (n) => `→ ${n}`,
      rollResult: (r) => `→ ${r.roll}  ${CODE_GRADE[r.grade]}  // need <= ${r.chance}`,
      simple: (r) => (r.kind === 'impossible' ? `// SKIP: ${r.reason}` : '// ok'),
      bloom: (s) => `// TODO(${s.turn}턴): “${s.text}” 되돌아옴`,
      event: '// WARN: 예상치 못한 변경',
      world: (parts) => `// + ${parts.join(', ')}`,
    };
  }
  if (theme === 'agent') {
    return {
      player: (input) => input,
      intro: (text) => text,
      thinking: '생각하는 중…',
      rollHead: (r) => `● Roll(${STAT[r.stat][1]} 필요 ${r.required} · 현재 ${r.statValue}, ${r.chance}%)`,
      rolling: (n) => `⎿  ${n}…`,
      rollResult: (r) => `⎿  주사위 ${r.roll} → ${GRADE[r.grade][1]} (${r.chance} 이하가 나와야 성공)`,
      simple: (r) => (r.kind === 'impossible' ? `● Check\n  ⎿  불가능: ${r.reason}` : '● Check\n  ⎿  자동 성공'),
      bloom: (s) => `● Recall(${s.turn}턴)\n  ⎿  “${s.text}”`,
      event: '● Event\n  ⎿  새로운 전개',
      world: (parts) => `  ⎿  추가됨: ${parts.join(', ')}`,
    };
  }
  return {
    player: (input) => `▶ ${input}`,
    intro: (text) => text,
    thinking: '🤔 판정관이 행동을 살피는 중...',
    rollHead: (r) => `${difficulty(r.chance)} · 성공 확률 ${r.chance}%`,
    rolling: (n) => `🎲 ${n}`,
    rollResult: (r) => `${GRADE[r.grade][0]} ${GRADE[r.grade][1]} · 주사위 ${r.roll} (${r.chance} 이하가 나와야 성공)`,
    simple: (r) => (r.kind === 'impossible' ? `${GRADE.impossible[0]} 불가능 — ${r.reason}` : '✔ 자동 성공'),
    bloom: (s) => `🦋 나비효과 — ${s.turn}턴의 “${s.text}”`,
    event: '🦋 무언가가 움직이기 시작합니다…',
    world: (parts) => parts.join(' · '),
  };
}

let prevInventory = [];
let prevHp = null;
let prevCounts = null;
let ended = false;
let lastTurn = 0;
let activeTab = 'status';

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

// ---------- 보스 키 ----------
let focusBeforeBoss = null;
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const boss = $('boss');
  if (boss.hidden) {
    focusBeforeBoss = document.activeElement;
    tip.hidden = true;
    boss.hidden = false;
  } else {
    boss.hidden = true;
    focusBeforeBoss?.focus?.();
  }
});

// ---------- 툴팁 ----------
const tip = $('tip');

function moveTip(e) {
  const pad = 14;
  let x = e.clientX + pad;
  let y = e.clientY + pad;
  if (x + tip.offsetWidth > innerWidth - 8) x = e.clientX - tip.offsetWidth - pad;
  if (y + tip.offsetHeight > innerHeight - 8) y = e.clientY - tip.offsetHeight - pad;
  tip.style.left = `${Math.max(8, x)}px`;
  tip.style.top = `${Math.max(8, y)}px`;
}

document.addEventListener('mouseover', (e) => {
  const target = e.target.closest('[data-tip]');
  if (!target) return;
  tip.textContent = target.dataset.tip;
  tip.hidden = false;
  moveTip(e);
});
document.addEventListener('mousemove', (e) => {
  if (!tip.hidden) moveTip(e);
});
document.addEventListener('mouseout', (e) => {
  const from = e.target.closest('[data-tip]');
  if (from && from !== e.relatedTarget?.closest?.('[data-tip]')) tip.hidden = true;
});

function withTip(node, text) {
  if (text) node.dataset.tip = text;
  return node;
}

// ---------- 탭 ----------
function selectTab(name) {
  activeTab = name;
  document.querySelectorAll('.tabs button').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === name);
    if (b.dataset.tab === name) b.classList.remove('dot');
  });
  document.querySelectorAll('.tab').forEach((t) => { t.hidden = t.id !== `tab-${name}`; });
}

function markTab(name) {
  if (name !== activeTab) document.querySelector(`.tabs button[data-tab="${name}"]`).classList.add('dot');
}

document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => selectTab(b.dataset.tab)));

// ---------- 출처 ----------
function origin(src) {
  if (!src) return '';
  if (src.turn === 0) return '시작부터 함께함';
  if (src.turn == null) return src.how || '';
  return `${src.turn}턴: “${src.input}” → ${src.how}`;
}

// ---------- 주사위 ----------
function difficulty(chance) {
  if (chance >= 80) return '쉬움';
  if (chance >= 50) return '보통';
  if (chance >= 25) return '어려움';
  if (chance >= 10) return '매우 어려움';
  return '거의 불가능';
}

function rollDetail(r) {
  const stat = STAT[r.stat][1];
  const mods = (r.statusMods ?? []).map((m) => `${m.name} ${sign(m.delta)}`).join(', ');
  const parts = [`필요 ${stat} ${r.required} · 내 ${stat} ${r.statValue}${mods ? ` (${mods})` : ''}`];
  if (r.itemBonus) parts.push(`아이템 +${r.itemBonus}%`);
  for (const t of r.traitsApplied ?? []) parts.push(`${t.name} ${sign(t.value)}%`);
  if (r.allyBonus) parts.push(`동료 +${r.allyBonus}%`);
  if (r.pityBonus) parts.push(`오기 +${r.pityBonus}%`);
  const text = parts.join(' · ');
  return theme === 'code' ? `// ${text}` : text;
}

// v1.2 이전 결과 표시
function legacyRollText(r) {
  const [icon, label] = GRADE[r.grade];
  return `${ic('🎲')}성공 확률 ${r.chance}% → 주사위 ${r.roll} (${r.chance} 이하 성공) → ${ic(icon)}${label}`;
}

function barTrack(r) {
  const track = el('div', 'bar-track');
  const seg = (cls, from, to, name) => {
    const s = withTip(el('div', `seg ${cls}`), `${name}: ${from + 1}~${to}`);
    s.style.width = `${Math.max(0, to - from)}%`;
    track.append(s);
  };
  seg('crit', 0, r.critMax, '대성공');
  seg('ok', r.critMax, r.chance, '성공');
  seg('fail', r.chance, r.fumbleFrom - 1, '실패');
  seg('fumble', r.fumbleFrom - 1, 100, '대실패');
  const marker = el('div', 'marker');
  track.append(marker);
  return { track, marker };
}

async function showRoll(r, animate) {
  const f = fmt();
  const cls = GRADE[r.grade][2];
  if (r.kind !== 'roll' || r.required === undefined) {
    const line = addBlock(`roll ${cls}`, r.kind === 'roll' ? legacyRollText(r) : f.simple(r));
    if (r.changes.length) line.append(el('div', 'changes', r.changes.join(' · ')));
    return;
  }
  const box = addBlock('roll dice');
  box.append(el('div', 'roll-head', f.rollHead(r)));
  const { track, marker } = barTrack(r);
  box.append(track);
  const res = el('div', 'roll-result', f.rolling('…'));
  box.append(res);
  if (animate && !plain()) {
    for (let i = 0; i < 14; i++) {
      const n = Math.floor(Math.random() * 100) + 1;
      marker.style.left = `${n - 0.5}%`;
      res.textContent = f.rolling(n);
      await sleep(70);
    }
  }
  marker.style.left = `${r.roll - 0.5}%`;
  box.classList.add(cls);
  res.textContent = f.rollResult(r);
  box.append(el('div', 'roll-detail', rollDetail(r)));
  if (r.reason) box.append(el('div', 'reason', theme === 'code' ? `// ${r.reason}` : r.reason));
  if (r.changes.length) box.append(el('div', 'changes', theme === 'code' ? `// ${r.changes.join(', ')}` : r.changes.join(' · ')));
  scrollStory();
}

function showBloom(bloom) {
  if (!bloom) return;
  const f = fmt();
  if (bloom.kind === 'event') {
    addBlock('butterfly', f.event);
    return;
  }
  for (const s of bloom.seeds) addBlock('butterfly', f.bloom(s));
}

function showWorld(added) {
  const tag = (emoji, word) => (plain() ? `${word} ` : `${emoji} `);
  const parts = [
    ...added.seeds.map((t) => `${tag('🌱', '씨앗')}${t}`),
    ...added.people.map((n) => `${tag('🧑', '인물')}${n}`),
    ...added.allies.map((n) => `${tag('🤝', '동료')}${n}`),
    ...added.items.map((n) => `${tag('🎒', '물건')}${n}`),
    ...added.places.map((n) => `${tag('🗺', '장소')}${n}`),
    ...added.enemies.map((n) => `${tag('👹', '적')}${n}`),
    ...added.knowledge.map((t) => `${tag('🧠', '정보')}${t}`),
    ...(added.statuses ?? []).map((t) => `${tag('✨', '상태')}${t}`),
  ];
  if (parts.length) addBlock('world', fmt().world(parts));
}

// ---------- 상태창 ----------
function listOrEmpty(ul, items, emptyText) {
  ul.replaceChildren(...(items.length ? items : [el('li', 'empty', emptyText)]));
}

function renderStatus(s) {
  $('title').textContent = s.title;
  $('turn').textContent = `${s.turn}/${s.maxTurns}턴`;
  $('hp-text').textContent = `${s.hp}/${s.maxHp}`;
  $('hp-bar').style.width = `${(s.hp / s.maxHp) * 100}%`;
  $('hp-bar').className = s.hp <= 3 ? 'low' : '';
  if (prevHp !== null && s.hp !== prevHp && !plain()) {
    $('hp-block').classList.remove('flash');
    void $('hp-block').offsetWidth;
    $('hp-block').classList.add('flash');
  }
  prevHp = s.hp;
  $('statusbar').textContent = `⑂ main    ⊗ 0  ⚠ ${s.maxHp - s.hp}    Ln ${s.turn + 1}, Col 1    UTF-8    TypeScript`;
  $('stats').replaceChildren(...Object.entries(s.stats).map(([k, v]) => {
    const diff = s.baseStats ? v - s.baseStats[k] : 0;
    return el('span', diff ? (diff > 0 ? 'buffed' : 'debuffed') : '', `${ic(STAT[k][0])}${STAT[k][1]} ${v}${diff ? ` (${sign(diff)})` : ''}`);
  }));
  const statuses = s.statuses ?? [];
  $('statuses-block').hidden = !statuses.length;
  $('statuses').replaceChildren(...statuses.map((st) => el('li', '', `${st.name} · ${st.summary} (${st.turns}턴 남음)`)));
  const here = s.here ?? { items: [], enemies: [], people: [] };
  listOrEmpty($('here'), [
    ...here.enemies.map((e) => el('li', 'enemy-line', `${plain() ? '적' : '⚔'} ${e.name} — ${e.condition}`)),
    ...here.people.map((n) => el('li', '', `${plain() ? '인물' : '🧑'} ${n}`)),
    ...here.items.map((i) => {
      const li = withTip(el('li', 'pick', `${plain() ? '물건' : '🎒'} ${i.name}`), `${i.description}\n클릭하면 줍기 명령을 입력합니다`);
      li.addEventListener('click', () => {
        $('action-input').value = `${i.name}${objectJosa(i.name)} 줍는다`;
        $('action-input').focus();
      });
      return li;
    }),
  ], '특별히 보이는 것 없음');
  $('job').textContent = s.job?.name ?? '없음';
  $('specialty').textContent = s.job?.specialty ? `특기: ${s.job.specialty}` : '';
  $('traits').replaceChildren(...s.traits.map((t) => {
    const li = withTip(el('li', t.good ? 'good' : 'bad', `${t.good ? '＋' : '－'} ${t.name}`), t.description);
    li.append(el('span', 'sub-line', t.summary));
    return li;
  }));
  $('goal').textContent = s.goal;
  $('location').textContent = s.location.name;
  $('exits').textContent = `출구: ${s.location.exits.map((x) => x.name + (x.locked ? (plain() ? ' (잠김)' : ' 🔒') : '')).join(' / ') || '없음'}`;
  $('visited').replaceChildren(...s.visited.flatMap((v, i) => {
    const span = withTip(el('span', '', v.name), v.turn === 0 ? '시작 장소' : v.turn ? `${v.turn}턴에 처음 방문` : '');
    return i ? [document.createTextNode(' · '), span] : [span];
  }));
}

function renderItems(s) {
  listOrEmpty($('inventory'), s.inventory.map((i) => withTip(
    el('li', prevInventory.includes(i.name) ? '' : 'new', i.name),
    [i.description, origin(i.acquired)].filter(Boolean).join('\n'),
  )), '비어 있음');
  prevInventory = s.inventory.map((i) => i.name);
  listOrEmpty($('knowledge'), s.knowledge.map((k) => withTip(el('li', '', k.text), origin({ ...k, how: '알게 됨' }))), '아직 없음');
}

function renderWorld(s) {
  listOrEmpty($('people'), s.people.map((p) => {
    const allyMark = p.ally ? (plain() ? '(동료) ' : '🤝 ') : '';
    const li = el('li', p.ally ? 'ally' : '', `${allyMark}${p.name}${p.remote ? ' (원격)' : p.here ? ' (여기)' : ''}`);
    return withTip(li, [p.description, origin(p.met)].filter(Boolean).join('\n'));
  }), '아직 없음');
  listOrEmpty($('seeds'), s.seeds.map((sd) => {
    const bloomed = sd.status === 'bloomed';
    const mark = plain() ? (bloomed ? '✓' : '·') : (bloomed ? '🦋' : '🧵');
    const li = el('li', bloomed ? 'bloomed' : '', `${mark} ${sd.text}`);
    const lines = [`${sd.turn}턴: “${sd.input}”`];
    if (bloomed) lines.push(`${sd.bloomTurn}턴에 되돌아옴${sd.outcome ? ` → ${sd.outcome}` : ''}`);
    else lines.push('언젠가 되돌아올지도…');
    if (sd.fate) lines.push(`운명: ${ic(FATE[sd.fate][0])}${FATE[sd.fate][1]}`);
    return withTip(li, lines.join('\n'));
  }), '아직 없음');
}

function renderHistory(s) {
  listOrEmpty($('history'), s.history.map((h) => {
    const mark = plain() ? CODE_GRADE[h.result.grade] ?? '' : GRADE[h.result.grade]?.[0] ?? '';
    const li = withTip(el('li', '', `${h.turn}턴 ${mark} ${h.input}`), h.narration.slice(0, 300));
    li.addEventListener('click', () => {
      document.querySelector(`.player[data-turn="${h.turn}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return li;
  }).reverse(), '아직 없음');
}

function markChangedTabs(s) {
  const counts = {
    items: s.inventory.length + s.knowledge.length,
    world: s.people.length + s.seeds.length + s.seeds.filter((x) => x.status === 'bloomed').length,
  };
  if (prevCounts) {
    if (counts.items > prevCounts.items) markTab('items');
    if (counts.world > prevCounts.world) markTab('world');
  }
  prevCounts = counts;
}

function renderState(s) {
  lastTurn = s.turn;
  renderStatus(s);
  renderItems(s);
  renderWorld(s);
  renderHistory(s);
  markChangedTabs(s);
  if (s.ending) showEnding(s);
}

function showEnding(s) {
  ended = true;
  setBusy(true);
  const box = addBlock('ending');
  const [icon, label] = ENDING[s.ending];
  const tone = s.endingTone ? ` — ${TONE[s.endingTone.tone]}` : '';
  box.append(el('h3', '', `${ic(icon)}${label}${tone}`));
  if (s.endingTone?.title) box.append(el('p', '', `『${s.endingTone.title}』`));
  if (s.seeds.length) {
    box.append(el('div', 'label', '뿌린 씨앗들'));
    const ul = el('ul', 'list');
    for (const sd of s.seeds) {
      const result = sd.status === 'bloomed' ? (sd.outcome || '되돌아왔다') : '끝내 돌아오지 않았다';
      const fate = FATE[sd.fate] ? `${ic(FATE[sd.fate][0])}${FATE[sd.fate][1]} ` : '';
      ul.append(el('li', '', `${fate}${sd.turn}턴 “${sd.text}” — ${result}`));
    }
    box.append(ul);
  }
  if (s.truth) {
    box.append(el('div', 'label', '숨겨진 진실'));
    box.append(el('p', '', s.truth));
  }
  box.append(el('p', 'small', `${s.turn}턴 · 주사위 ${s.dice.rolls}회 · 대성공 ${s.dice.crits} · 대실패 ${s.dice.fumbles}`));
  const again = el('button', '', '새 게임');
  again.onclick = () => location.reload();
  box.append(again);
}

function addPlayerBlock(input, turn) {
  const block = addBlock('player', fmt().player(input));
  block.dataset.turn = turn;
  return block;
}

function enterGame(s) {
  $('start').hidden = true;
  $('game').hidden = false;
  $('story').replaceChildren();
  ended = false;
  prevInventory = s.inventory.map((i) => i.name);
  prevHp = s.hp;
  prevCounts = null;
  const f = fmt();
  addBlock('intro', f.intro(s.premise));
  if (s.job) addBlock('intro', f.intro(`${ic('🧑')}직업: ${s.job.name}${s.job.description ? ` — ${s.job.description}` : ''}`));
  if (s.traits.length) {
    const names = (good) => s.traits.filter((t) => t.good === good).map((t) => t.name).join(', ');
    addBlock('intro', f.intro(`${ic('🎭')}성격: ${names(true)} / ${names(false)}`));
  }
  if (!s.history.length) addBlock('narration', s.location.description);
  for (const h of s.history) {
    addPlayerBlock(h.input, h.turn);
    showRoll(h.result, false);
    showBloom(h.result.bloom);
    addBlock('narration', h.narration);
  }
  if (s.epilogue) addBlock('epilogue', s.epilogue);
  renderState(s);
  setBusy(false);
}

async function playTurn(input) {
  setBusy(true);
  addPlayerBlock(input, lastTurn + 1);
  const thinking = addBlock('thinking', fmt().thinking);
  let queue = Promise.resolve();
  let textEl = null;
  let epilogueEl = null;
  const handle = async (ev) => {
    thinking.remove();
    if (ev.type === 'roll') {
      await showRoll(ev.result, true);
      showBloom(ev.result.bloom);
    } else if (ev.type === 'text') {
      textEl ??= addBlock('narration', '');
      textEl.textContent += ev.text;
      scrollStory();
    } else if (ev.type === 'epilogue') {
      epilogueEl ??= addBlock('epilogue', '');
      epilogueEl.textContent += ev.text;
      scrollStory();
    } else if (ev.type === 'replace') {
      const target = ev.target === 'epilogue' ? (epilogueEl ??= addBlock('epilogue', '')) : (textEl ??= addBlock('narration', ''));
      target.textContent = ev.text;
      scrollStory();
    } else if (ev.type === 'world') {
      showWorld(ev.added);
    } else if (ev.type === 'state') {
      renderState(ev.state);
    } else if (ev.type === 'error') {
      addBlock('error', `${ic('⚠')}${ev.message}`);
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
    addBlock('error', `${ic('⚠')}${err.message}`);
  }
  setBusy(false);
}

function setStartDisabled(disabled) {
  document.querySelectorAll('#start button, #start input').forEach((e) => { e.disabled = disabled; });
}

async function startGame(genre) {
  setStartDisabled(true);
  $('loading').textContent = `${ic('🌍')}AI가 세계를 만드는 중... (첫 실행은 모델을 깨우느라 1~2분 걸릴 수 있어요)`;
  $('loading').hidden = false;
  try {
    enterGame(await api('/api/new', { genre, job: $('job-input').value.trim() }));
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

document.querySelectorAll('.theme-choice').forEach((b) => b.addEventListener('click', () => applyTheme(b.dataset.themeChoice)));
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

applyTheme(loadTheme());
init();
