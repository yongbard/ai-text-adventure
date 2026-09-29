import { createInitialState, normalizeIntent, resolveTurn, publicState, GRADE_LABEL } from './rules.js';
import { generateScenario } from './scenario.js';
import { drawTraits } from './traits.js';
import { interpretMessages, narrateMessages, epilogueMessages, unknownNames, INTERPRET_SCHEMA } from './prompts.js';

export function createGame({ llm, store, rng = Math.random }) {
  let current = null;
  let busy = false;

  async function exclusive(fn) {
    if (busy) throw new Error('이전 요청을 처리 중입니다');
    busy = true;
    try {
      return await fn();
    } finally {
      busy = false;
    }
  }

  async function interpret(input) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return normalizeIntent(await llm.json(interpretMessages(current, input), INTERPRET_SCHEMA, { temperature: 0.2 }));
      } catch {
        // 재시도
      }
    }
    return null;
  }

  async function streamText(state, messages, emit, type, fallback) {
    let text = '';
    try {
      for await (const chunk of llm.stream(messages)) {
        text += chunk;
        emit({ type, text: chunk });
      }
    } catch {
      // 아래에서 대체 문장 사용
    }
    if (text.trim() && unknownNames(text, state, messages).length) {
      try {
        let retry = '';
        for await (const chunk of llm.stream(messages)) retry += chunk;
        if (retry.trim()) {
          text = retry;
          emit({ type: 'replace', target: type, text });
        }
      } catch {
        // 첫 묘사 유지
      }
    }
    if (!text.trim()) {
      text = fallback;
      emit({ type, text });
    }
    return text;
  }

  return {
    async status() {
      return { ...(await llm.status()), model_name: llm.model, hasSave: store.exists() };
    },

    newGame(genre, job = '') {
      return exclusive(async () => {
        current = createInitialState(await generateScenario(llm, genre, job), drawTraits(rng));
        store.save(current);
        return publicState(current);
      });
    },

    load() {
      current = store.load();
      return current ? publicState(current) : null;
    },

    turn(input, emit) {
      return exclusive(async () => {
        if (!current) throw new Error('진행 중인 게임이 없습니다');
        if (current.ending) throw new Error('이미 끝난 게임입니다');
        const text = String(input ?? '').trim().slice(0, 300);
        if (!text) throw new Error('행동을 입력해 주세요');

        const intent = await interpret(text);
        if (!intent) {
          emit({ type: 'error', message: '무슨 행동인지 이해하지 못했어요. 다르게 표현해 주세요.' });
          return;
        }

        const { state, result } = resolveTurn(current, intent, rng, text);
        emit({ type: 'roll', result });

        const fallback = `${GRADE_LABEL[result.grade]} — ${result.changes.join(', ') || result.reason}`;
        const narration = await streamText(state, narrateMessages(state, text, intent, result), emit, 'text', fallback);
        state.history.push({ input: text, result, narration });

        if (state.ending) {
          state.epilogue = await streamText(state, epilogueMessages(state), emit, 'epilogue', '이야기는 여기서 끝이 났다.');
        }

        current = state;
        store.save(current);
        emit({ type: 'state', state: publicState(current) });
      });
    },
  };
}
