import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  LIBRARY_PATH,
  PREFS_PATH,
  createApp,
} from '../../src/server/app.js';

/** W7 ① 4라우트 테스트. 합성 DB로 확인한다. */
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function freshDb(): Database.Database {
  const dir = mkdtempSync(join(tmpdir(), 'questail-w7route-'));
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

function seedGame(
  db: Database.Database,
  externalId: string,
  ended: number,
): void {
  db.prepare(
    'INSERT INTO games (platform, external_id, name) VALUES (?, ?, ?)',
  ).run('steam', externalId, `game-${externalId}`);
  db.prepare(
    'INSERT INTO ownership_spans (platform, external_id, origin, started_at, ended, is_baseline) VALUES (?, ?, ?, ?, ?, ?)',
  ).run('steam', externalId, 'observed', 1700000000, ended, 0);
}

function seedLibrary(db: Database.Database): void {
  seedGame(db, '100', 0);
  seedGame(db, '200', 0);
  seedGame(db, '300', 1);
}

describe('GET /api/library', () => {
  it('기본은 열린 보유만', async () => {
    const db = freshDb();
    try {
      seedLibrary(db);
      const app = createApp({ db, exportDir: join(tmpdir(), 'questail-w7unused') });
      const response = await app.request(LIBRARY_PATH);
      expect(response.status).toBe(200);
      const games = (await response.json()) as { key: object }[];
      expect(games).toHaveLength(2);
    } finally {
      db.close();
    }
  });

  it('?includeEnded=true면 닫힌 구간 포함', async () => {
    const db = freshDb();
    try {
      seedLibrary(db);
      const app = createApp({ db, exportDir: join(tmpdir(), 'questail-w7unused') });
      const response = await app.request(`${LIBRARY_PATH}?includeEnded=true`);
      expect(response.status).toBe(200);
      expect((await response.json()) as unknown[]).toHaveLength(3);
    } finally {
      db.close();
    }
  });

  it('?includeEnded=false면 열린 보유만', async () => {
    const db = freshDb();
    try {
      seedLibrary(db);
      const app = createApp({ db, exportDir: join(tmpdir(), 'questail-w7unused') });
      const response = await app.request(`${LIBRARY_PATH}?includeEnded=false`);
      expect(response.status).toBe(200);
      expect((await response.json()) as unknown[]).toHaveLength(2);
    } finally {
      db.close();
    }
  });

  it('name null 행도 그대로 (P-4, 표시 fallback은 화면 몫)', async () => {
    const db = freshDb();
    try {
      db.prepare(
        'INSERT INTO games (platform, external_id, name) VALUES (?, ?, ?)',
      ).run('steam', '900', null);
      db.prepare(
        'INSERT INTO ownership_spans (platform, external_id, origin, started_at, ended, is_baseline) VALUES (?, ?, ?, ?, ?, ?)',
      ).run('steam', '900', 'observed', 1700000000, 0, 0);
      const app = createApp({ db, exportDir: join(tmpdir(), 'questail-w7unused') });
      const response = await app.request(LIBRARY_PATH);
      expect(response.status).toBe(200);
      const games = (await response.json()) as { key: { externalId: string }; name: string | null }[];
      expect(games).toHaveLength(1);
      expect(games[0].name).toBeNull();
    } finally {
      db.close();
    }
  });

  it('?includeEnded 이상값 → 400 INVALID_BODY', async () => {
    const db = freshDb();
    try {
      seedLibrary(db);
      const app = createApp({ db, exportDir: join(tmpdir(), 'questail-w7unused') });
      const response = await app.request(`${LIBRARY_PATH}?includeEnded=yes`);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        code: 'INVALID_BODY',
        params: { reason: 'includeEnded' },
      });
    } finally {
      db.close();
    }
  });
});

describe('PUT /api/ratings/:platform/:externalId', () => {
  async function put(
    app: ReturnType<typeof createApp>,
    externalId: string,
    body: unknown,
  ): Promise<Response> {
    return await app.request(`/api/ratings/steam/${externalId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('입력·같은 값 no-op·취소', async () => {
    const db = freshDb();
    try {
      seedLibrary(db);
      const app = createApp({ db, exportDir: join(tmpdir(), 'questail-w7unused') });
      const first = await put(app, '100', { score: 8 });
      expect(first.status).toBe(200);
      const firstBody = (await first.json()) as { changed: boolean; eventId: number | null };
      expect(firstBody.changed).toBe(true);
      expect(typeof firstBody.eventId).toBe('number');
      const noop = await put(app, '100', { score: 8 });
      expect(await noop.json()).toEqual({ changed: false, eventId: null });
      const cancel = await put(app, '100', { score: null });
      expect((await cancel.json()) as { changed: boolean }).toEqual({
        changed: true,
        eventId: expect.any(Number),
      });
    } finally {
      db.close();
    }
  });

  it('이상값 → 400 INVALID_BODY', async () => {
    const db = freshDb();
    try {
      seedLibrary(db);
      const app = createApp({ db, exportDir: join(tmpdir(), 'questail-w7unused') });
      for (const body of [{ score: 5.5 }, { score: 11 }, { score: 0 }, {}]) {
        const response = await put(app, '100', body);
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          code: 'INVALID_BODY',
          params: { reason: 'score' },
        });
      }
    } finally {
      db.close();
    }
  });

  it('없는 게임 키 → 404 GAME_NOT_FOUND', async () => {
    const db = freshDb();
    try {
      seedLibrary(db);
      const app = createApp({ db, exportDir: join(tmpdir(), 'questail-w7unused') });
      const response = await put(app, '999', { score: 8 });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ code: 'GAME_NOT_FOUND', params: {} });
    } finally {
      db.close();
    }
  });
});

describe('GET /api/prefs', () => {
  it('fallback 누락·이상값 → 400 INVALID_BODY', async () => {
    const db = freshDb();
    try {
      const app = createApp({ db, exportDir: join(tmpdir(), 'questail-w7unused') });
      const missing = await app.request(PREFS_PATH);
      expect(missing.status).toBe(400);
      const bad = await app.request(`${PREFS_PATH}?fallback=de`);
      expect(bad.status).toBe(400);
      expect(await bad.json()).toEqual({
        code: 'INVALID_BODY',
        params: { reason: 'fallback' },
      });
    } finally {
      db.close();
    }
  });

  it('미저장 로케일은 fallback 그대로', async () => {
    const db = freshDb();
    try {
      const app = createApp({ db, exportDir: join(tmpdir(), 'questail-w7unused') });
      const response = await app.request(`${PREFS_PATH}?fallback=ko`);
      expect(response.status).toBe(200);
      expect(((await response.json()) as { locale: string }).locale).toBe('ko');
    } finally {
      db.close();
    }
  });
});

describe('PUT /api/prefs', () => {
  async function putPrefs(
    app: ReturnType<typeof createApp>,
    query: string,
    body: unknown,
  ): Promise<Response> {
    return await app.request(`${PREFS_PATH}${query}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('부분 갱신 후 Prefs 전체 반환', async () => {
    const db = freshDb();
    try {
      const app = createApp({ db, exportDir: join(tmpdir(), 'questail-w7unused') });
      const response = await putPrefs(app, '?fallback=ko', { locale: 'en' });
      expect(response.status).toBe(200);
      expect(((await response.json()) as { locale: string }).locale).toBe('en');
    } finally {
      db.close();
    }
  });

  it('fallback 누락·본문 이상값 → 400', async () => {
    const db = freshDb();
    try {
      const app = createApp({ db, exportDir: join(tmpdir(), 'questail-w7unused') });
      expect((await putPrefs(app, '', { locale: 'en' })).status).toBe(400);
      const bad = await putPrefs(app, '?fallback=ko', { locale: 'de' });
      expect(bad.status).toBe(400);
      expect(await bad.json()).toEqual({
        code: 'INVALID_BODY',
        params: { reason: 'locale' },
      });
    } finally {
      db.close();
    }
  });

  it('숨김 집합 교체가 GET에 반영', async () => {
    const db = freshDb();
    try {
      seedLibrary(db);
      const app = createApp({ db, exportDir: join(tmpdir(), 'questail-w7unused') });
      const putResponse = await putPrefs(app, '?fallback=ko', {
        hidden: [{ platform: 'steam', externalId: '100' }],
      });
      expect(putResponse.status).toBe(200);
      const getResponse = await app.request(`${PREFS_PATH}?fallback=ko`);
      expect(((await getResponse.json()) as { hidden: object[] }).hidden).toEqual([
        { platform: 'steam', externalId: '100' },
      ]);
    } finally {
      db.close();
    }
  });
});
