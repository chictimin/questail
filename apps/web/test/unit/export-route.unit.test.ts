import Database from 'better-sqlite3';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  EXPORT_PATH,
  createApp,
  createServerApp,
} from '../../src/server/app.js';

/** W9 POST /api/export 라우트 테스트. 합성 DB + 임시 출력 디렉터리로 확인한다. */
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function freshDb(): Database.Database {
  const dir = mkdtempSync(join(tmpdir(), 'questail-w9route-'));
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
  platform: string,
  externalId: string,
  ended: number,
): void {
  db.prepare(
    'INSERT INTO games (platform, external_id, name) VALUES (?, ?, ?)',
  ).run(platform, externalId, `game-${externalId}`);
  db.prepare(
    'INSERT INTO ownership_spans (platform, external_id, origin, started_at, ended, is_baseline) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(platform, externalId, 'observed', 1700000000, ended, 0);
}

async function postExport(
  app: ReturnType<typeof createApp>,
  body: unknown,
  headers?: Record<string, string>,
): Promise<Response> {
  return await app.request(EXPORT_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('POST /api/export', () => {
  it('locale 누락 → 400 INVALID_BODY', async () => {
    const response = await postExport(createApp(), {});
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: 'INVALID_BODY',
      params: { reason: 'locale' },
    });
  });

  it('locale 이상값 → 400 INVALID_BODY', async () => {
    const response = await postExport(createApp(), { locale: 'de' });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: 'INVALID_BODY',
      params: { reason: 'locale' },
    });
  });

  it('JSON 파싱 실패 → 400 INVALID_BODY', async () => {
    const response = await postExport(createApp(), '{broken');
    expect(response.status).toBe(400);
    expect((await response.json()) as { code: string }).toEqual({
      code: 'INVALID_BODY',
      params: {},
    });
  });

  it('현 보유만 파일로 쓴다 + { written, dir }', async () => {
    const db = freshDb();
    try {
      seedGame(db, 'steam', '100', 0);
      seedGame(db, 'steam', '200', 0);
      seedGame(db, 'steam', '300', 1);
      const exportDir = join(mkdtempSync(join(tmpdir(), 'questail-w9out-')), 'export');
      const app = createApp({ db, exportDir });
      const response = await postExport(app, { locale: 'en' });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ written: 2, dir: exportDir });
      expect(readdirSync(exportDir).sort()).toEqual([
        'steam-100.md',
        'steam-200.md',
      ]);
      const content = readFileSync(join(exportDir, 'steam-100.md'), 'utf8');
      expect(content).toContain('platform: "steam"');
      expect(content).toContain('- Playtime:');
    } finally {
      db.close();
    }
  });

  it('exportDeps 없음 → 500 EXPORT_FAILED', async () => {
    const response = await postExport(createApp(), { locale: 'ko' });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      code: 'EXPORT_FAILED',
      params: { reason: 'not_configured' },
    });
  });

  it('쓰기 실패(부모 없음) → 500 EXPORT_FAILED + write_failed', async () => {
    const db = freshDb();
    try {
      seedGame(db, 'steam', '100', 0);
      const exportDir = join(tmpdir(), 'questail-no-such-parent', 'export');
      const app = createApp({ db, exportDir });
      const response = await postExport(app, { locale: 'ko' });
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        code: 'EXPORT_FAILED',
        params: { reason: 'write_failed' },
      });
    } finally {
      db.close();
    }
  });

  it('예상 밖 예외 → onError INTERNAL(params {})', async () => {
    const db = freshDb();
    db.close();
    const exportDir = join(mkdtempSync(join(tmpdir(), 'questail-w9out-')), 'export');
    const app = createServerApp({ exportDeps: { db, exportDir } });
    const response = await postExport(app, { locale: 'ko' }, { host: 'localhost' });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ code: 'INTERNAL', params: {} });
  });

  it('createServerApp 경유 배선 — Host 통과 시 200', async () => {
    const db = freshDb();
    try {
      seedGame(db, 'steam', '100', 0);
      const exportDir = join(mkdtempSync(join(tmpdir(), 'questail-w9out-')), 'export');
      const app = createServerApp({ exportDeps: { db, exportDir } });
      const response = await postExport(app, { locale: 'ko' }, { host: 'localhost' });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ written: 1, dir: exportDir });
    } finally {
      db.close();
    }
  });
});
