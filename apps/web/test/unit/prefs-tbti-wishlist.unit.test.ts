import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getPrefs, setPrefs } from '../../src/data/viewState.js';
import { PREFS_PATH, createApp } from '../../src/server/app.js';

/**
 * R15-7 Prefs 확장 — tbtiWishlist(키 tbti_wishlist, 행 없음 = on).
 * 기존 저장 방식(문자 '1'·'0', 부분 갱신 원자성) 실물 추종.
 */
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function freshDb(): { dir: string; db: Database.Database } {
  const dir = mkdtempSync(join(tmpdir(), 'questail-r15prefs-'));
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
    .get('tbti_wishlist') as { v: string } | undefined;
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

describe('tbtiWishlist 저장', () => {
  it('행 없음 → getPrefs true(on)', () => {
    const { dir, db } = freshDb();
    try {
      expect(getPrefs(db, 'ko').tbtiWishlist).toBe(true);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('setPrefs off·on이 행에 반영되고 다른 필드를 유지한다(부분 갱신 원자성)', () => {
    const { dir, db } = freshDb();
    try {
      setPrefs(db, { locale: 'en' });
      setPrefs(db, { tbtiWishlist: false });
      expect(getPrefs(db, 'ko')).toMatchObject({ locale: 'en', tbtiWishlist: false });
      expect(prefValue(db)).toBe('0');
      setPrefs(db, { tbtiWishlist: true });
      expect(getPrefs(db, 'ko')).toMatchObject({ locale: 'en', tbtiWishlist: true });
      expect(prefValue(db)).toBe('1');
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('PUT /api/prefs tbtiWishlist', () => {
  it('false 저장 후 GET에 반영, locale 유지', async () => {
    const { dir, db } = freshDb();
    try {
      const app = createApp({ db, exportDir: join(tmpdir(), 'questail-r15prefs-unused') });
      expect((await putPrefs(app, { locale: 'en' })).status).toBe(200);
      const response = await putPrefs(app, { tbtiWishlist: false });
      expect(response.status).toBe(200);
      expect(
        ((await response.json()) as { tbtiWishlist: boolean }).tbtiWishlist,
      ).toBe(false);
      const prefs = (await (
        await app.request(`${PREFS_PATH}?fallback=ko`)
      ).json()) as { locale: string; tbtiWishlist: boolean };
      expect(prefs).toMatchObject({ locale: 'en', tbtiWishlist: false });
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('기본 GET은 on', async () => {
    const { dir, db } = freshDb();
    try {
      const app = createApp({ db, exportDir: join(tmpdir(), 'questail-r15prefs-unused') });
      const prefs = (await (
        await app.request(`${PREFS_PATH}?fallback=ko`)
      ).json()) as { tbtiWishlist: boolean };
      expect(prefs.tbtiWishlist).toBe(true);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('비boolean → 400 INVALID_BODY, 쓰기 0', async () => {
    const { dir, db } = freshDb();
    try {
      const app = createApp({ db, exportDir: join(tmpdir(), 'questail-r15prefs-unused') });
      const response = await putPrefs(app, { tbtiWishlist: 'off' });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        code: 'INVALID_BODY',
        params: { reason: 'tbtiWishlist' },
      });
      expect(prefValue(db)).toBeNull();
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
