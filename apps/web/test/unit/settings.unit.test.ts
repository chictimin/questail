import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENTS_PATH,
  createApp,
} from '../../src/server/app.js';

/** W8 ① 업적 2라우트 테스트. 기본 꺼짐·저장·가드·복원을 확인한다. */
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function freshDb(): Database.Database {
  const dir = mkdtempSync(join(tmpdir(), 'questail-w8route-'));
  const journal = JSON.parse(
    readFileSync(join(WEB, 'drizzle', 'meta', '_journal.json'), 'utf8'),
  ) as { entries: { tag: string }[] };
  const setup = new Database(join(dir, 'questail.db'));
  try {
    setup.pragma('journal_mode = WAL');
    for (const entry of journal.entries) {
      setup.exec(
        readFileSync(join(WEB, 'drizzle', `${entry.tag}.sql`), 'utf8'),
      );
    }
  } finally {
    setup.close();
  }
  return new Database(join(dir, 'questail.db'));
}

describe('GET /api/settings/achievements', () => {
  it('기본 꺼짐', async () => {
    const db = freshDb();
    try {
      const app = createApp({ db, exportDir: join(tmpdir(), 'questail-w8unused') });
      const response = await app.request(ACHIEVEMENTS_PATH);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ enabled: false });
    } finally {
      db.close();
    }
  });
});

describe('PUT /api/settings/achievements', () => {
  it('저장 후 GET 복원', async () => {
    const db = freshDb();
    try {
      const app = createApp({ db, exportDir: join(tmpdir(), 'questail-w8unused') });
      const putResponse = await app.request(ACHIEVEMENTS_PATH, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      });
      expect(putResponse.status).toBe(200);
      expect(await putResponse.json()).toEqual({ enabled: true });
      const getResponse = await app.request(ACHIEVEMENTS_PATH);
      expect(await getResponse.json()).toEqual({ enabled: true });
    } finally {
      db.close();
    }
  });

  it('이상값 → 400 INVALID_BODY', async () => {
    const db = freshDb();
    try {
      const app = createApp({ db, exportDir: join(tmpdir(), 'questail-w8unused') });
      for (const body of [{ enabled: 'yes' }, {}, { enabled: 1 }]) {
        const response = await app.request(ACHIEVEMENTS_PATH, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          code: 'INVALID_BODY',
          params: { reason: 'enabled' },
        });
      }
    } finally {
      db.close();
    }
  });
});
