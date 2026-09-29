import fs from 'node:fs';
import path from 'node:path';

export function createSaveStore(dir) {
  const file = path.join(dir, 'autosave.json');
  return {
    exists: () => fs.existsSync(file),
    save(state) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(state));
      fs.renameSync(`${file}.tmp`, file);
    },
    load() {
      try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        return null;
      }
    },
  };
}
