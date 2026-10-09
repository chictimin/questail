import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resyncSource } from '../../src/data/sync.js';
import type { Locale } from '../../src/data/sync.js';
import type { CollectSource } from '../../src/data/syncRuns.js';
import { registerSnapshotCron, runOverdueSnapshot } from '../../src/jobs/scheduler.js';
import { toLocalDay } from '../../src/data/syncRuns.js';

/**
 * D-09 스케줄러 테스트. 합성 DB·가짜 clock/cron만 쓴다. 실호출 없음.
 * 임시 DB는 mkdtemp 고유 경로에만 둔다.
 */
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function freshDb(): { dir: string; db: Database.Database } {
  const dir = mkdtempSync(join(tmpdir(), 'questail-nozi-sched-'));
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

function addRun(db: Database.Database, day: string): void {
  db.prepare(
    "INSERT INTO sync_runs (source, status, started_at, observed_day, is_finalized) VALUES ('owned', 'ok', 1, ?, 1)",
  ).run(day);
}

function setPref(db: Database.Database, key: string, value: string): void {
  db.prepare('INSERT INTO preferences (key, value, updated_at) VALUES (?, ?, ?)').run(key, value, 1);
}

function ownedRunCount(db: Database.Database): number {
  return (
    db.prepare("SELECT COUNT(*) AS n FROM sync_runs WHERE source = 'owned'").get() as { n: number }
  ).n;
}

function baseDeps(
  db: Database.Database,
  extra?: { now?: () => number; timeZone?: string; isConnected?: () => boolean },
) {
  const seen: { locale: Locale | null }[] = [];
  const timeZone = extra?.timeZone ?? 'Asia/Seoul';
  return {
    db,
    now: () => Date.parse('2026-01-02T00:10:00+09:00'),
    timeZone,
    isConnected: () => true,
    service: {
      resyncSource: (
        source: CollectSource,
        opts: { mode?: 'resume' | 'refresh'; locale: Locale },
      ) => {
        seen.push({ locale: opts.locale });
        return resyncSource(db, source, { ...opts, timeZone });
      },
    },
    seen,
    ...extra,
  };
}

describe('runOverdueSnapshot', () => {
  it('오늘 성공 없으면 owned만 resume 트리거한다', async () => {
    const { db } = freshDb();
    try {
      setPref(db, 'last_collect_locale', 'ko');
      const deps = baseDeps(db);
      const out = await runOverdueSnapshot(deps);
      expect(out).toEqual({ triggered: true, reason: 'triggered' });
      expect(deps.seen).toEqual([{ locale: 'ko' }]);
      expect(ownedRunCount(db)).toBe(1);
    } finally {
      db.close();
    }
  });

  it('오늘 성공 있으면 트리거하지 않는다', async () => {
    const { db } = freshDb();
    try {
      setPref(db, 'last_collect_locale', 'ko');
      addRun(db, '2026-01-02');
      const deps = baseDeps(db);
      const out = await runOverdueSnapshot(deps);
      expect(out).toEqual({ triggered: false, reason: 'already-done' });
      expect(deps.seen).toEqual([]);
      expect(ownedRunCount(db)).toBe(1);
    } finally {
      db.close();
    }
  });

  it('재시작 후 밀린 1회·월 경계를 트리거한다', async () => {
    const { db } = freshDb();
    try {
      setPref(db, 'last_collect_locale', 'ko');
      addRun(db, '2026-01-31');
      const deps = baseDeps(db, { now: () => Date.parse('2026-02-01T00:10:00+09:00') });
      const out = await runOverdueSnapshot(deps);
      expect(out).toEqual({ triggered: true, reason: 'triggered' });
    } finally {
      db.close();
    }
  });

  it('DST 전환일 로컬 날짜로 판정한다', async () => {
    const { db } = freshDb();
    try {
      setPref(db, 'last_collect_locale', 'en');
      addRun(db, '2026-03-07');
      const deps = baseDeps(db, {
        now: () => Date.parse('2026-03-08T03:30:00-04:00'),
        timeZone: 'America/New_York',
      });
      const out = await runOverdueSnapshot(deps);
      expect(out).toEqual({ triggered: true, reason: 'triggered' });
      expect(deps.seen).toEqual([{ locale: 'en' }]);
    } finally {
      db.close();
    }
  });

  it('KST 00:30 관측은 같은 로컬 날짜로 보고 재수집 안 한다', async () => {
    const { db } = freshDb();
    try {
      setPref(db, 'last_collect_locale', 'ko');
      addRun(db, '2026-01-02');
      const deps = baseDeps(db, { now: () => Date.parse('2026-01-02T00:30:00+09:00') });
      const out = await runOverdueSnapshot(deps);
      expect(out).toEqual({ triggered: false, reason: 'already-done' });
    } finally {
      db.close();
    }
  });

  it('toLocalDay는 UTC 15:30을 KST 다음 날로 본다', () => {
    expect(toLocalDay(Date.parse('2026-01-01T15:30:00Z'), 'Asia/Seoul')).toBe('2026-01-02');
    expect(toLocalDay(Date.parse('2026-01-01T14:59:00Z'), 'Asia/Seoul')).toBe('2026-01-01');
  });

  it('locale은 수집 키→표시 키 순, 없으면 no-locale skip이다', async () => {
    const { db } = freshDb();
    try {
      setPref(db, 'locale', 'ko');
      const deps = baseDeps(db);
      const out = await runOverdueSnapshot(deps);
      expect(out.triggered).toBe(true);
      expect(deps.seen).toEqual([{ locale: 'ko' }]);
    } finally {
      db.close();
    }
    const { db: db2 } = freshDb();
    try {
      const deps = baseDeps(db2);
      const out = await runOverdueSnapshot(deps);
      expect(out).toEqual({ triggered: false, reason: 'no-locale' });
      expect(deps.seen).toEqual([]);
    } finally {
      db2.close();
    }
  });

  it('실행 중이면 건너뛰고 재시도하지 않는다', async () => {
    const { db } = freshDb();
    try {
      setPref(db, 'last_collect_locale', 'ko');
      resyncSource(db, 'owned', { mode: 'resume', locale: 'ko', timeZone: 'Asia/Seoul' });
      const deps = baseDeps(db);
      const out = await runOverdueSnapshot(deps);
      expect(out).toEqual({ triggered: false, reason: 'in-progress' });
    } finally {
      db.close();
    }
  });

  it('동시 트리거는 1건만 시작한다', async () => {
    const { db } = freshDb();
    try {
      setPref(db, 'last_collect_locale', 'ko');
      const deps = baseDeps(db);
      const [a, b] = await Promise.all([runOverdueSnapshot(deps), runOverdueSnapshot(deps)]);
      const reasons = [a.reason, b.reason].sort();
      expect(reasons).toEqual(['in-progress', 'triggered']);
      expect(ownedRunCount(db)).toBe(1);
    } finally {
      db.close();
    }
  });

  it('미연동이면 호출하지 않는다', async () => {
    const { db } = freshDb();
    try {
      setPref(db, 'last_collect_locale', 'ko');
      const deps = baseDeps(db, { isConnected: () => false });
      const out = await runOverdueSnapshot(deps);
      expect(out).toEqual({ triggered: false, reason: 'disconnected' });
      expect(ownedRunCount(db)).toBe(0);
    } finally {
      db.close();
    }
  });
});

describe('registerSnapshotCron', () => {
  it('tick이 트리거하고 unregister가 stop한다', async () => {
    const { db } = freshDb();
    try {
      setPref(db, 'last_collect_locale', 'ko');
      let task: (() => void) | null = null;
      let stopped = 0;
      const deps = {
        ...baseDeps(db),
        cronExpression: '0 3 * * *',
        scheduleCron: (expression: string, next: () => void) => {
          expect(expression).toBe('0 3 * * *');
          task = next;
          return {
            stop: () => {
              stopped += 1;
            },
          };
        },
      };
      const handle = registerSnapshotCron(deps);
      expect(task).not.toBeNull();
      task!();
      await new Promise((r) => setTimeout(r, 10));
      expect(ownedRunCount(db)).toBe(1);
      handle.unregister();
      expect(stopped).toBe(1);
    } finally {
      db.close();
    }
  });
});
