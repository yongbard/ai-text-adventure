export function createOllamaClient({ baseUrl = 'http://localhost:11434', model = 'gemma4:12b' } = {}) {
  async function chat(body) {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, think: false, keep_alive: '30m', ...body }),
    });
    if (!res.ok) throw new Error(`Ollama 오류 ${res.status}: ${await res.text()}`);
    return res;
  }

  return {
    model,

    async status() {
      try {
        const res = await fetch(`${baseUrl}/api/tags`);
        const { models = [] } = await res.json();
        return { ollama: true, model: models.some((m) => m.name === model || m.model === model) };
      } catch {
        return { ollama: false, model: false };
      }
    },

    async json(messages, schema, { temperature = 0.3 } = {}) {
      const res = await chat({ messages, stream: false, format: schema, options: { num_ctx: 16384, temperature } });
      const data = await res.json();
      return JSON.parse(data.message.content);
    },

    async *stream(messages, { temperature = 0.8 } = {}) {
      const res = await chat({ messages, stream: true, options: { num_ctx: 16384, temperature } });
      const decoder = new TextDecoder();
      let buf = '';
      for await (const chunk of res.body) {
        buf += decoder.decode(chunk, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const data = JSON.parse(line);
          if (data.error) throw new Error(data.error);
          if (data.message?.content) yield data.message.content;
        }
      }
    },
  };
}
