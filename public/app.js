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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let prevInventory = [];
let prevHp = null;
let ended = false;

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

function rollText(r) {
  const [icon, label] = GRADE[r.grade];
  if (r.kind === 'impossible') return `${icon} ${label} — ${r.reason}`;
  if (r.kind === 'auto') return '✔ 자동 성공';
  const parts = [`개연성 ${r.base}%`];
  if (r.statMod) parts.push(`${STAT[r.stat][1]} ${r.statMod > 0 ? '+' : ''}${r.statMod}%`);
  if (r.itemBonus) parts.push(`아이템 +${r.itemBonus}%`);
  if (r.traitBonus) parts.push(`성격 ${r.traitBonus > 0 ? '+' : ''}${r.traitBonus}%`);
  return `🎲 ${parts.join(' ')} = ${r.chance}% → 주사위 ${r.roll} (${r.chance} 이하 성공) → ${icon} ${label}`;
}

function showRoll(r) {
  const line = addBlock(`roll ${GRADE[r.grade][2]}`, rollText(r));
  if (r.kind === 'roll' && r.reason) line.append(el('div', 'reason', r.reason));
  if (r.changes.length) line.append(el('div', 'changes', r.changes.join(' · ')));
}

async function showRollAnimated(r) {
  if (r.kind === 'roll') {
    const line = addBlock('roll');
    for (let i = 0; i < 12; i++) {
      line.textContent = `🎲 주사위 굴리는 중... ${Math.floor(Math.random() * 100) + 1}`;
      await sleep(80);
    }
    line.remove();
  }
  showRoll(r);
}

function showEnding(s) {
  ended = true;
  setBusy(true);
  const box = addBlock('ending');
  box.append(el('h3', '', ENDING[s.ending]));
  if (s.truth) {
    box.append(el('div', 'label', '숨겨진 진실'));
    box.append(el('p', '', s.truth));
  }
  box.append(el('p', 'small', `${s.turn}턴 · 주사위 ${s.dice.rolls}회 · 대성공 ${s.dice.crits} · 대실패 ${s.dice.fumbles}`));
  const again = el('button', '', '새 게임');
  again.onclick = () => location.reload();
  box.append(again);
}

function renderState(s) {
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
    const li = el('li', t.good ? 'good' : 'bad', `${t.good ? '＋' : '－'} ${t.name}`);
    li.title = t.description;
    li.append(el('span', 'trait-summary', t.summary));
    return li;
  }));
  $('goal').textContent = s.goal;
  $('location').textContent = s.location.name;
  $('exits').textContent = `출구: ${s.location.exits.map((x) => x.name + (x.locked ? ' 🔒' : '')).join(' / ') || '없음'}`;
  $('inventory').replaceChildren(...s.inventory.map((i) => {
    const li = el('li', prevInventory.includes(i.name) ? '' : 'new', i.name);
    li.title = i.description;
    return li;
  }));
  prevInventory = s.inventory.map((i) => i.name);
  $('visited').textContent = s.visited.join(' · ');
  if (s.ending) showEnding(s);
}

function enterGame(s) {
  $('start').hidden = true;
  $('game').hidden = false;
  $('story').replaceChildren();
  ended = false;
  prevInventory = s.inventory.map((i) => i.name);
  prevHp = s.hp;
  addBlock('intro', s.premise);
  if (s.job) addBlock('intro', `🧑 직업: ${s.job.name}${s.job.description ? ` — ${s.job.description}` : ''}`);
  if (s.traits.length) {
    const names = (good) => s.traits.filter((t) => t.good === good).map((t) => t.name).join(', ');
    addBlock('intro', `🎭 성격: ${names(true)} / ${names(false)}`);
  }
  if (!s.history.length) addBlock('narration', s.location.description);
  for (const h of s.history) {
    addBlock('player', `▶ ${h.input}`);
    showRoll(h.result);
    addBlock('narration', h.narration);
  }
  if (s.epilogue) addBlock('epilogue', s.epilogue);
  renderState(s);
  setBusy(false);
}

async function playTurn(input) {
  setBusy(true);
  addBlock('player', `▶ ${input}`);
  const thinking = addBlock('thinking', '🤔 판정관이 행동을 살피는 중...');
  let queue = Promise.resolve();
  let textEl = null;
  let epilogueEl = null;
  const handle = async (ev) => {
    thinking.remove();
    if (ev.type === 'roll') {
      await showRollAnimated(ev.result);
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
