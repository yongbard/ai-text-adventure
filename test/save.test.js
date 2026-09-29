import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSaveStore } from '../src/save.js';

test('save store round-trips and survives corruption', () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'adv-')), 'saves');
  const store = createSaveStore(dir);
  assert.equal(store.exists(), false);
  assert.equal(store.load(), null);
  store.save({ turn: 3, title: '테스트' });
  assert.equal(store.exists(), true);
  assert.deepEqual(store.load(), { turn: 3, title: '테스트' });
  store.save({ turn: 4 });
  assert.deepEqual(store.load(), { turn: 4 });
  assert.equal(fs.existsSync(path.join(dir, 'autosave.json.tmp')), false);
  fs.writeFileSync(path.join(dir, 'autosave.json'), '{broken');
  assert.equal(store.load(), null);
});
