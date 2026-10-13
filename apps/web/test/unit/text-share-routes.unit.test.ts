import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { setPrefs } from '../../src/data/viewState.js';
import {
  RECAP_TEXT_PATH,
  TBTI_SHARE_TEXT_PATH,
  createServerApp,
} from '../../src/server/app.js';

/**
 * 계약 v1.0.3 통로 2종 — 상태와 text 키를 본다.
 * locale은 현재 Prefs.locale(행 없음 = ko).
 */
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOST = { headers: { host: '127.0.0.1:4747' } };

function freshDb(): { dir: string; db: Database.Database } {
  const dir = mkdtempSync(join(tmpdir(), 'questail-r15text-'));
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

function seedGame(db: Database.Database): void {
  db.prepare("INSERT INTO games (platform, external_id, name) VALUES ('steam', '1', 'Seed Game')").run();
  db.prepare(
    "INSERT INTO ownership_spans (platform, external_id, origin, started_at, ended, is_baseline) VALUES ('steam', '1', 'observed', 1700000000, 0, 0)",
  ).run();
  db.prepare(
    "INSERT INTO playtime_snapshots (platform, external_id, observed_at, observed_day, timezone, total_minutes, is_review) VALUES ('steam', '1', 1700000000, '2024-01-01', 'UTC', 60, 0)",
  ).run();
}

function appFor(dir: string, db: Database.Database): ReturnType<typeof createServerApp> {
  return createServerApp({
    exportDeps: { db, exportDir: join(tmpdir(), 'questail-r15text-unused') },
    settingsDeps: { dataDir: dir, version: '0.0.0-test' },
  });
}

describe('GET /api/recap/library/text', () => {
  it('200 + { text } 리캡 복사 텍스트(ko 기본)', async () => {
    const { dir, db } = freshDb();
    try {
      seedGame(db);
      const response = await appFor(dir, db).request(RECAP_TEXT_PATH, HOST);
      expect(response.status).toBe(200);
      const body = (await response.json()) as { text: unknown };
      expect(typeof body.text).toBe('string');
      expect(body.text as string).toContain('questail recap');
      expect(body.text as string).toContain('Seed Game');
      expect(body.text as string).toContain('- TBTI: ????');
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('GET /api/tbti/share-text', () => {
  it('200 + { text } 공유 텍스트(ko 기본)', async () => {
    const { dir, db } = freshDb();
    try {
      const response = await appFor(dir, db).request(TBTI_SHARE_TEXT_PATH, HOST);
      expect(response.status).toBe(200);
      const body = (await response.json()) as { text: unknown };
      expect(typeof body.text).toBe('string');
      expect(body.text as string).toContain('내 TBTI는 ????');
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('Prefs.locale en이면 영어 공유 텍스트', async () => {
    const { dir, db } = freshDb();
    try {
      setPrefs(db, { locale: 'en' });
      const response = await appFor(dir, db).request(TBTI_SHARE_TEXT_PATH, HOST);
      expect(response.status).toBe(200);
      const body = (await response.json()) as { text: string };
      expect(body.text).toContain('My TBTI is ????');
      expect(body.text).not.toMatch(/[가-힣]/);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
