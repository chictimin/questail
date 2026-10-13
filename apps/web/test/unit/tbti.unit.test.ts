import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TBTI_PATH, createApp } from '../../src/server/app.js';

/** R15-9 S2 — GET /api/tbti 신규 테스트. */
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function freshDb(): { dir: string; db: Database.Database } {
  const dir = mkdtempSync(join(tmpdir(), 'questail-r15s2-'));
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

describe('S2 GET /api/tbti', () => {
  it('200 + TbtiResult 형태, R22 pending 규칙과 ②축 similar 없음을 지킨다', async () => {
    const { dir, db } = freshDb();
    try {
      const app = createApp(
        { db, exportDir: join(tmpdir(), 'questail-r15s2-unused') },
        undefined,
        { dataDir: dir, version: '0.0.0-test' },
      );
      const response = await app.request(TBTI_PATH);
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        code: string;
        axes: { axis: number; primary: string; chips: string[] }[];
        pending: boolean;
        pendingHours: { have: number; need: number } | null;
      };
      expect(body.axes).toHaveLength(4);
      // R22: pending이면 code="????", 비보류면 pendingHours=null
      if (body.pending) {
        expect(body.code).toBe('????');
        expect(body.pendingHours).not.toBeNull();
      } else {
        expect(body.pendingHours).toBeNull();
      }
      // ②축은 `similar` 없음
      const axis2 = body.axes.find((a) => a.axis === 2);
      expect(axis2).toBeDefined();
      expect(axis2?.chips).not.toContain('similar');
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
