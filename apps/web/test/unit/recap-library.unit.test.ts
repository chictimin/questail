import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app.js';
import { RECAP_RESERVED_PATHS } from '../../src/server/recapReserved.js';

/**
 * R15-9 S1 — GET /api/recap/library 등록 테스트.
 * 기존 recap-reserved.unit.test.ts는 손대지 않는다(그 파일의 404 기대는
 * R1.5 착수 신호로 깨지는 것이 의도됨 — 계약 R15-9 비고).
 */
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function freshDb(): { dir: string; db: Database.Database } {
  const dir = mkdtempSync(join(tmpdir(), 'questail-r15s1-'));
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

describe('S1 GET /api/recap/library', () => {
  it('예약 상수 경로로 200 + LibraryRecap 형태를 낸다', async () => {
    const { dir, db } = freshDb();
    try {
      const app = createApp({ db, exportDir: join(tmpdir(), 'questail-r15s1-unused') });
      const response = await app.request(RECAP_RESERVED_PATHS.library);
      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      // R15-3 LibraryRecap 키 전부
      for (const key of ['basis', 's01', 's02', 's03', 's04', 's05', 's06', 'tbti']) {
        expect(body).toHaveProperty(key);
      }
      // R22 pending 규칙 — 목업은 보류 형태
      const tbti = body['tbti'] as { code: string; pending: boolean; letters: string[] };
      expect(tbti.code).toBe('????');
      expect(tbti.pending).toBe(true);
      expect(tbti.letters).toEqual(['?', '?', '?', '?']);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
