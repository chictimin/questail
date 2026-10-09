import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  SYNC_PATH,
  SYNC_STATUS_PATH,
  createApp,
} from '../../src/server/app.js';
import { createSyncService, type SyncService } from '../../src/data/service.js';

/** U3b [1] sync 3라우트 테스트. executor 없이 전이만 — fetch 0. */
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function freshDb(): Database.Database {
  const dir = mkdtempSync(join(tmpdir(), 'questail-w13route-'));
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

function syncService(db: Database.Database): SyncService {
  return createSyncService({
    db,
    keyPath: join(tmpdir(), 'questail-w13nokey'),
    cacheDir: join(tmpdir(), 'questail-w13nocache'),
    timeZone: 'UTC',
  });
}

function post(
  app: ReturnType<typeof createApp>,
  path: string,
  body: unknown,
): Promise<Response> {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as Promise<Response>;
}

describe('POST /api/sync', () => {
  it('첫 수집 → 202 {runId}, 두 번째는 409', async () => {
    const db = freshDb();
    try {
      const app = createApp(undefined, undefined, undefined, syncService(db));
      const first = await post(app, SYNC_PATH, { locale: 'ko' });
      expect(first.status).toBe(202);
      const firstBody = (await first.json()) as { runId: unknown };
      expect(typeof firstBody.runId).toBe('number');
      const second = await post(app, SYNC_PATH, { locale: 'ko' });
      expect(second.status).toBe(409);
      const secondBody = (await second.json()) as {
        code: string;
        params: { source: string };
      };
      expect(secondBody.code).toBe('SYNC_IN_PROGRESS');
      expect(typeof secondBody.params.source).toBe('string');
    } finally {
      db.close();
    }
  });

  it('locale 누락·이상값 → 400 INVALID_BODY', async () => {
    const db = freshDb();
    try {
      const app = createApp(undefined, undefined, undefined, syncService(db));
      for (const body of [
        {},
        { locale: 'de' },
        { locale: 'ko', sources: ['nope'] },
        { locale: 'ko', sources: [] },
      ]) {
        const response = await post(app, SYNC_PATH, body);
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          code: 'INVALID_BODY',
          params: expect.objectContaining({ reason: expect.any(String) }),
        });
      }
    } finally {
      db.close();
    }
  });

  it('서비스 없음 → 500 INTERNAL', async () => {
    const response = await post(createApp(), SYNC_PATH, { locale: 'ko' });
    expect(response.status).toBe(500);
  });
});

describe('POST /api/sync/:source/retry', () => {
  it('mode 생략=resume → 202, 두 번째는 409', async () => {
    const db = freshDb();
    try {
      const app = createApp(undefined, undefined, undefined, syncService(db));
      const first = await post(app, `${SYNC_PATH}/owned/retry`, { locale: 'en' });
      expect(first.status).toBe(202);
      const second = await post(app, `${SYNC_PATH}/owned/retry`, {
        locale: 'en',
        mode: 'refresh',
      });
      expect(second.status).toBe(409);
      expect(await second.json()).toEqual({
        code: 'SYNC_IN_PROGRESS',
        params: { source: 'owned' },
      });
    } finally {
      db.close();
    }
  });

  it('mode·locale·source 이상값 → 400', async () => {
    const db = freshDb();
    try {
      const app = createApp(undefined, undefined, undefined, syncService(db));
      const badMode = await post(app, `${SYNC_PATH}/owned/retry`, {
        locale: 'ko',
        mode: 'bogus',
      });
      expect(badMode.status).toBe(400);
      const noLocale = await post(app, `${SYNC_PATH}/owned/retry`, {});
      expect(noLocale.status).toBe(400);
      const badSource = await post(app, `${SYNC_PATH}/nope/retry`, { locale: 'ko' });
      expect(badSource.status).toBe(400);
    } finally {
      db.close();
    }
  });
});

describe('GET /api/sync/status', () => {
  it('5 소스 배열', async () => {
    const db = freshDb();
    try {
      const app = createApp(undefined, undefined, undefined, syncService(db));
      const response = await app.request(SYNC_STATUS_PATH);
      expect(response.status).toBe(200);
      const entries = (await response.json()) as { source: string }[];
      expect(entries.map((entry) => entry.source).sort()).toEqual(
        ['achievements', 'meta', 'owned', 'steamspy', 'wishlist'].sort(),
      );
    } finally {
      db.close();
    }
  });

  it('서비스 없음 → 500 INTERNAL', async () => {
    const response = await createApp().request(SYNC_STATUS_PATH);
    expect(response.status).toBe(500);
  });
});
