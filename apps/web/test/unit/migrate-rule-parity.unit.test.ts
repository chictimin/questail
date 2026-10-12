import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { recordPlaytimeSnapshot } from '../../src/data/playtime.js';
import { migrateDatabase } from '../../src/db/migrate.js';
import { abnormalStepKind } from '../../../../tools/migrate-r1-once.js';

/** D-14 사전 검사 9(b): 도구 판정 == 앱 recordPlaytimeSnapshot 판정 (같은 입력, 행마다 비교). */
const CASES: { name: string; delta: number; elapsedSeconds: number }[] = [
  { name: '증가분 = 경과분/60 정확히 같음', delta: 24, elapsedSeconds: 1440 },
  { name: '경과분/60 + 1분', delta: 25, elapsedSeconds: 1440 },
  { name: '증가분 0', delta: 0, elapsedSeconds: 3600 },
  { name: '음수', delta: -1, elapsedSeconds: 3600 },
  { name: '큰 음수', delta: -500, elapsedSeconds: 86400 },
  { name: '경과분 분수(90초 → 1.5분) 안에서 1분 증가', delta: 1, elapsedSeconds: 90 },
  { name: '경과분 분수(90초 → 1.5분) 초과 2분 증가', delta: 2, elapsedSeconds: 90 },
  { name: '경과 0초에 증가 0', delta: 0, elapsedSeconds: 0 },
  { name: '경과 0초에 증가 1', delta: 1, elapsedSeconds: 0 },
];

describe('migrate 도구 spike·음수 판정 == 앱 recordPlaytimeSnapshot', () => {
  it('경계 포함 입력 표를 합성 DB에서 앱 함수로 기록한 review_reason과 행마다 같다', async () => {
    const dataDir = join(mkdtempSync(join(tmpdir(), 'questail-d14-parity-')), 'data');
    mkdirSync(dataDir, { recursive: true });
    const handle = await migrateDatabase(dataDir);
    try {
      const db = handle.db;
      const base = 1_789_000_000;
      CASES.forEach((row, ix) => {
        const id = String(900 + ix);
        db.prepare('INSERT INTO games (platform, external_id, name) VALUES (?, ?, ?)').run('steam', id, id);
        const key = { platform: 'steam', externalId: id } as const;
        const first = { timezone: 'UTC', lastPlayed: null, syncRunId: null };
        recordPlaytimeSnapshot(db, key, { ...first, observedAt: base, observedDay: 'day-a', totalMinutes: 1000 });
        const result = recordPlaytimeSnapshot(db, key, {
          ...first,
          observedAt: base + row.elapsedSeconds,
          observedDay: 'day-b',
          totalMinutes: 1000 + row.delta,
        });
        expect(result.outcome === 'review' ? result.kind : null, row.name).toBe(
          abnormalStepKind(row.delta, row.elapsedSeconds),
        );
      });
    } finally {
      await handle.close();
    }
  });
});
