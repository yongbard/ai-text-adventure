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
const TONE = { light: '빛의 결말', gray: '회색의 결말', shadow: '그림자의 결말' };
const FATE = { boon: '🌱 은혜', bane: '🔥 재앙', twist: '🎭 반전' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sign = (n) => (n > 0 ? `+${n}` : `${n}`);

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
  const parts = [`필요 ${stat} ${r.required} · 내 ${stat} ${r.statValue}`];
  if (r.itemBonus) parts.push(`아이템 +${r.itemBonus}%`);
  for (const t of r.traitsApplied ?? []) parts.push(`${t.name} ${sign(t.value)}%`);
  if (r.allyBonus) parts.push(`동료 +${r.allyBonus}%`);
  return parts.join(' · ');
}

// v1.2 이전 결과 표시
function legacyRollText(r) {
  const [icon, label] = GRADE[r.grade];
  return `🎲 성공 확률 ${r.chance}% → 주사위 ${r.roll} (${r.chance} 이하 성공) → ${icon} ${label}`;
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
  const [icon, label, cls] = GRADE[r.grade];
  if (r.kind !== 'roll' || r.required === undefined) {
    const textLine = r.kind === 'impossible' ? `${icon} ${label} — ${r.reason}` : r.kind === 'auto' ? '✔ 자동 성공' : legacyRollText(r);
    const line = addBlock(`roll ${cls}`, textLine);
    if (r.changes.length) line.append(el('div', 'changes', r.changes.join(' · ')));
    return;
  }
  const box = addBlock('roll dice');
  box.append(el('div', 'roll-head', `${difficulty(r.chance)} · 성공 확률 ${r.chance}%`));
  const { track, marker } = barTrack(r);
  box.append(track);
  const res = el('div', 'roll-result', '🎲 굴리는 중...');
  box.append(res);
  if (animate) {
    for (let i = 0; i < 14; i++) {
      const n = Math.floor(Math.random() * 100) + 1;
      marker.style.left = `${n - 0.5}%`;
      res.textContent = `🎲 ${n}`;
      await sleep(70);
    }
  }
  marker.style.left = `${r.roll - 0.5}%`;
  box.classList.add(cls);
  res.textContent = `${icon} ${label} · 주사위 ${r.roll}`;
  box.append(el('div', 'roll-detail', rollDetail(r)));
  if (r.reason) box.append(el('div', 'reason', r.reason));
  if (r.changes.length) box.append(el('div', 'changes', r.changes.join(' · ')));
  scrollStory();
}

function showBloom(bloom) {
  if (!bloom) return;
  if (bloom.kind === 'event') {
    addBlock('butterfly', '🦋 무언가가 움직이기 시작합니다…');
    return;
  }
  for (const s of bloom.seeds) addBlock('butterfly', `🦋 나비효과 — ${s.turn}턴의 “${s.text}”`);
}

function showWorld(added) {
  const parts = [
    ...added.seeds.map((t) => `🌱 ${t}`),
    ...added.people.map((n) => `🧑 ${n}`),
    ...added.allies.map((n) => `🤝 ${n}`),
    ...added.items.map((n) => `🎒 ${n}`),
    ...added.places.map((n) => `🗺 ${n}`),
    ...added.enemies.map((n) => `👹 ${n}`),
    ...added.knowledge.map((t) => `🧠 ${t}`),
  ];
  if (parts.length) addBlock('world', parts.join(' · '));
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
  if (prevHp !== null && s.hp !== prevHp) {
    $('hp-block').classList.remove('flash');
    void $('hp-block').offsetWidth;
    $('hp-block').classList.add('flash');
  }
  prevHp = s.hp;
  $('stats').replaceChildren(...Object.entries(s.stats).map(([k, v]) => el('span', '', `${STAT[k][0]} ${STAT[k][1]} ${v}`)));
  $('job').textContent = s.job?.name ?? '없음';
  $('specialty').textContent = s.job?.specialty ? `특기: ${s.job.specialty}` : '';
  $('traits').replaceChildren(...s.traits.map((t) => {
    const li = withTip(el('li', t.good ? 'good' : 'bad', `${t.good ? '＋' : '－'} ${t.name}`), t.description);
    li.append(el('span', 'sub-line', t.summary));
    return li;
  }));
  $('goal').textContent = s.goal;
  $('location').textContent = s.location.name;
  $('exits').textContent = `출구: ${s.location.exits.map((x) => x.name + (x.locked ? ' 🔒' : '')).join(' / ') || '없음'}`;
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
    const li = el('li', p.ally ? 'ally' : '', `${p.ally ? '🤝 ' : ''}${p.name}${p.remote ? ' (원격)' : p.here ? ' (여기)' : ''}`);
    return withTip(li, [p.description, origin(p.met)].filter(Boolean).join('\n'));
  }), '아직 없음');
  listOrEmpty($('seeds'), s.seeds.map((sd) => {
    const bloomed = sd.status === 'bloomed';
    const li = el('li', bloomed ? 'bloomed' : '', `${bloomed ? '🦋' : '🧵'} ${sd.text}`);
    const lines = [`${sd.turn}턴: “${sd.input}”`];
    if (bloomed) lines.push(`${sd.bloomTurn}턴에 되돌아옴${sd.outcome ? ` → ${sd.outcome}` : ''}`);
    else lines.push('언젠가 되돌아올지도…');
    if (sd.fate) lines.push(`운명: ${FATE[sd.fate]}`);
    return withTip(li, lines.join('\n'));
  }), '아직 없음');
}

function renderHistory(s) {
  listOrEmpty($('history'), s.history.map((h) => {
    const icon = GRADE[h.result.grade]?.[0] ?? '';
    const li = withTip(el('li', '', `${h.turn}턴 ${icon} ${h.input}`), h.narration.slice(0, 300));
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
  const tone = s.endingTone ? ` — ${TONE[s.endingTone.tone]}` : '';
  box.append(el('h3', '', `${ENDING[s.ending]}${tone}`));
  if (s.endingTone?.title) box.append(el('p', '', `『${s.endingTone.title}』`));
  if (s.seeds.length) {
    box.append(el('div', 'label', '뿌린 씨앗들'));
    const ul = el('ul', 'list');
    for (const sd of s.seeds) {
      const result = sd.status === 'bloomed' ? (sd.outcome || '되돌아왔다') : '끝내 돌아오지 않았다';
      ul.append(el('li', '', `${FATE[sd.fate] ?? ''} ${sd.turn}턴 “${sd.text}” — ${result}`));
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
  const block = addBlock('player', `▶ ${input}`);
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
  addBlock('intro', s.premise);
  if (s.job) addBlock('intro', `🧑 직업: ${s.job.name}${s.job.description ? ` — ${s.job.description}` : ''}`);
  if (s.traits.length) {
    const names = (good) => s.traits.filter((t) => t.good === good).map((t) => t.name).join(', ');
    addBlock('intro', `🎭 성격: ${names(true)} / ${names(false)}`);
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
  const thinking = addBlock('thinking', '🤔 판정관이 행동을 살피는 중...');
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
