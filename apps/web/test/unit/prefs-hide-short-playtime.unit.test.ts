import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getPrefs, setPrefs } from '../../src/data/viewState.js';
import { PREFS_PATH, createApp } from '../../src/server/app.js';

/**
 * U1 hideShortPlaytime 테스트. 합성 DB(제품 SQL)만 쓴다.
 * 저장 키 hide_short_playtime('0'·'1'), 행 없음 = false.
 */
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function freshDb(): { dir: string; db: Database.Database } {
  const dir = mkdtempSync(join(tmpdir(), 'questail-u1prefs-'));
  const journal = JSON.parse(
    readFileSync(join(WEB, 'drizzle', 'meta', '_journal.json'), 'utf8'),
  ) as { entries: { tag: string }[] };
  const setup = new Database(join(dir, 'questail.db'));
  try {
    for (const entry of journal.entries) {
      setup.exec(readFileSync(join(WEB, 'drizzle', `${entry.tag}.sql`), 'utf8'));
    }
  } finally {
    setup.close();
  }
  return { dir, db: new Database(join(dir, 'questail.db')) };
}

function prefValue(db: Database.Database): string | null {
  const row = db
    .prepare('SELECT value AS v FROM preferences WHERE key = ?')
    .get('hide_short_playtime') as { v: string } | undefined;
  return row ? row.v : null;
}

async function putPrefs(
  app: ReturnType<typeof createApp>,
  body: unknown,
): Promise<Response> {
  return await app.request(`${PREFS_PATH}?fallback=ko`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('hideShortPlaytime 저장', () => {
  it('행 없음 → getPrefs false', () => {
    const { dir, db } = freshDb();
    try {
      expect(getPrefs(db, 'ko').hideShortPlaytime).toBe(false);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('setPrefs true·false가 행에 반영되고 다른 필드를 유지한다', () => {
    const { dir, db } = freshDb();
    try {
      setPrefs(db, { locale: 'en' });
      setPrefs(db, { hideShortPlaytime: true });
      expect(getPrefs(db, 'ko')).toMatchObject({ locale: 'en', hideShortPlaytime: true });
      expect(prefValue(db)).toBe('1');
      setPrefs(db, { hideShortPlaytime: false });
      expect(getPrefs(db, 'ko')).toMatchObject({ locale: 'en', hideShortPlaytime: false });
      expect(prefValue(db)).toBe('0');
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('PUT /api/prefs hideShortPlaytime', () => {
  it('true 저장 후 GET에 반영', async () => {
    const { dir, db } = freshDb();
    try {
      const app = createApp({ db, exportDir: join(tmpdir(), 'questail-u1unused') });
      const response = await putPrefs(app, { hideShortPlaytime: true });
      expect(response.status).toBe(200);
      expect(((await response.json()) as { hideShortPlaytime: boolean }).hideShortPlaytime).toBe(
        true,
      );
      const getResponse = await app.request(`${PREFS_PATH}?fallback=ko`);
      expect(((await getResponse.json()) as { hideShortPlaytime: boolean }).hideShortPlaytime).toBe(
        true,
      );
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('부분 갱신 — locale 유지', async () => {
    const { dir, db } = freshDb();
    try {
      const app = createApp({ db, exportDir: join(tmpdir(), 'questail-u1unused') });
      expect((await putPrefs(app, { locale: 'en' })).status).toBe(200);
      expect((await putPrefs(app, { hideShortPlaytime: true })).status).toBe(200);
      const prefs = (await (
        await app.request(`${PREFS_PATH}?fallback=ko`)
      ).json()) as { locale: string; hideShortPlaytime: boolean };
      expect(prefs).toMatchObject({ locale: 'en', hideShortPlaytime: true });
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('비boolean → 400 INVALID_BODY', async () => {
    const { dir, db } = freshDb();
    try {
      const app = createApp({ db, exportDir: join(tmpdir(), 'questail-u1unused') });
      const response = await putPrefs(app, { hideShortPlaytime: '1' });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        code: 'INVALID_BODY',
        params: { reason: 'hideShortPlaytime' },
      });
      expect(prefValue(db)).toBeNull();
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
