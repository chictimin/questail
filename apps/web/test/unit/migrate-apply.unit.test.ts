import Database from 'better-sqlite3';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { afterEach, describe, expect, it } from 'vitest';
import { OWNER_LOCK_BUSY_MESSAGE } from '../../src/db/ownerLock.js';
import { backupDatabase } from '../../src/db/backup.js';
import { listLibrary } from '../../src/data/library.js';
import {
  runApply,
  schemaMatches,
  type ApplyArgs,
  type ApplyHooks,
} from '../../../../tools/migrate-r1-once.js';
import {
  DAY,
  REPO,
  STEAM_ID_LIKE,
  T0,
  TOOL,
  TSX_CLI,
  TZ,
  defaultExisting,
  defaultHistory,
  dumpAll,
  listBackups,
  makeFixture,
  seoulDay,
  type Fixture,
} from './helpers/d14-fixture.js';

/** D-14 --apply 테스트(계약 「테스트」 2~7). 합성 dataDir·합성 원본만 쓴다. */
const LOCK_CHILD = join(dirname(fileURLToPath(import.meta.url)), 'helpers', 'd14-lock-child.ts');

function argsOf(fx: Fixture, over: Partial<ApplyArgs> = {}): ApplyArgs {
  return {
    dataDir: fx.dataDir,
    history: fx.historyPath,
    cache: fx.cacheDir,
    library: fx.libraryPath,
    tz: TZ,
    out: fx.outPath,
    expectHistorySha: fx.historySha,
    expectRows: fx.rows,
    ...over,
  };
}

function dbPath(fx: Fixture): string {
  return join(fx.dataDir, 'questail.db');
}

function count(fx: Fixture, table: string): number {
  const db = new Database(dbPath(fx), { readonly: true });
  try {
    return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  } finally {
    db.close();
  }
}

/** 실패 경로 공통 단언: 종료 코드 1·DB 변경 0·백업 0 */
async function expectRejected(
  fx: Fixture,
  over: Partial<ApplyArgs> = {},
  hooks?: ApplyHooks,
): Promise<{ stdout: string; stderr: string }> {
  const before = dumpAll(dbPath(fx));
  const backupsBefore = listBackups(fx.dataDir);
  const outcome = await runApply(argsOf(fx, over), hooks);
  expect(outcome.code).toBe(1);
  expect(dumpAll(dbPath(fx))).toEqual(before);
  expect(listBackups(fx.dataDir)).toEqual(backupsBefore);
  return { stdout: outcome.stdout.join('\n'), stderr: outcome.stderr.join('\n') };
}

describe('migrate --apply 성공', () => {
  it('스냅샷·ledger를 쓰고 기존 값은 그대로이며 백업이 INSERT보다 먼저다', async () => {
    const fx = await makeFixture();
    const before = dumpAll(dbPath(fx));
    const events: string[] = [];
    const outcome = await runApply(argsOf(fx), {
      backup: async (dataDir, now) => {
        events.push(`backup@snapshots=${count(fx, 'playtime_snapshots')}`);
        await backupDatabase(dataDir, now);
      },
    });
    expect(outcome.code).toBe(0);
    expect(events).toEqual([`backup@snapshots=${before['playtime_snapshots'].length}`]);
    const after = dumpAll(dbPath(fx));
    // 기존 스냅샷 행 값 동일 + 신규 fx.rows행
    expect(after['playtime_snapshots'].slice(0, before['playtime_snapshots'].length)).toEqual(
      before['playtime_snapshots'],
    );
    expect(after['playtime_snapshots']).toHaveLength(before['playtime_snapshots'].length + fx.rows);
    const added = after['playtime_snapshots'].slice(before['playtime_snapshots'].length) as Record<string, unknown>[];
    expect(added.map((r) => [r['external_id'], r['observed_at'], r['observed_day'], r['total_minutes']])).toEqual([
      ['100', T0, seoulDay(T0), 60],
      ['100', T0 + 3 * DAY, seoulDay(T0 + 3 * DAY), 120],
      ['200', T0 + 3 * DAY, seoulDay(T0 + 3 * DAY), 50],
    ]);
    for (const row of added) {
      expect(row).toMatchObject({
        platform: 'steam',
        timezone: TZ,
        last_played: null,
        playtime_2weeks: null,
        is_review: 0,
        review_reason: null,
        sync_run_id: null,
      });
    }
    // 다른 테이블 불변, ledger 1행
    for (const table of Object.keys(before)) {
      if (table === 'playtime_snapshots' || table === 'import_ledger') continue;
      expect(after[table], table).toEqual(before[table]);
    }
    expect(after['review_observations']).toHaveLength(0);
    const ledger = after['import_ledger'] as Record<string, unknown>[];
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      kind: 'history_jsonl',
      source_ref: 'games/history.jsonl',
      kept_count: fx.rows,
      dropped_count: 1,
      rerun_blocked: 1,
    });
    expect(ledger[0]['first_run_at']).toBe(ledger[0]['last_run_at']);
    expect(Number(ledger[0]['first_run_at'])).toBeLessThan(10_000_000_000);
    // 백업 1개, 적용 전 행 수
    const backups = listBackups(fx.dataDir);
    expect(backups).toHaveLength(1);
    const snap = new Database(join(fx.dataDir, 'backups', backups[0]), { readonly: true });
    expect((snap.prepare('SELECT COUNT(*) AS n FROM playtime_snapshots').get() as { n: number }).n).toBe(
      before['playtime_snapshots'].length,
    );
    expect((snap.prepare('SELECT COUNT(*) AS n FROM import_ledger').get() as { n: number }).n).toBe(0);
    snap.close();
    // 리포트
    const report = JSON.parse(readFileSync(fx.outPath, 'utf8')) as Record<string, unknown>;
    expect(report['backupName']).toBe(backups[0]);
    expect(report['representativeGames']).toBe(2);
    expect(report['observedDays']).toEqual([seoulDay(T0), seoulDay(T0 + 3 * DAY)]);
  });

  it('library.ts 파생: confirmedMinutes 불변, 관측 범위·deltas 시작은 앞당겨지고 보유 구간은 불변', async () => {
    const fx = await makeFixture();
    const read = (): ReturnType<typeof listLibrary> => {
      const db = new Database(dbPath(fx), { readonly: true });
      try {
        return listLibrary(db, { includeEnded: false });
      } finally {
        db.close();
      }
    };
    const before = read();
    expect((await runApply(argsOf(fx))).code).toBe(0);
    const after = read();
    for (const id of ['100', '200', '300']) {
      const b = before.find((g) => g.key.externalId === id)!;
      const a = after.find((g) => g.key.externalId === id)!;
      expect(a.confirmedMinutes, id).toBe(b.confirmedMinutes);
      expect(a.ownership, id).toEqual(b.ownership);
    }
    const b100 = before.find((g) => g.key.externalId === '100')!;
    const a100 = after.find((g) => g.key.externalId === '100')!;
    expect(a100.coverage).not.toEqual(b100.coverage);
    expect(a100.deltas.length).toBeGreaterThan(b100.deltas.length);
    expect(Math.min(...a100.deltas.map((d) => d.observedAt))).toBeLessThan(
      Math.min(...b100.deltas.map((d) => d.observedAt)),
    );
    // 대표 행이 없는 게임 300은 파생 전체 동일
    expect(after.find((g) => g.key.externalId === '300')).toEqual(
      before.find((g) => g.key.externalId === '300'),
    );
  });
});

describe('schemaMatches', () => {
  it('저장소 저널 해시 목록이 drizzle readMigrationFiles와 같은 순서·값이다', async () => {
    const fx = await makeFixture();
    const expected = readMigrationFiles({ migrationsFolder: join(REPO, 'apps', 'web', 'drizzle') }).map(
      (m) => m.hash,
    );
    const db = new Database(dbPath(fx), { readonly: true });
    try {
      const rows = db.prepare('SELECT hash FROM __drizzle_migrations ORDER BY created_at, id').all() as {
        hash: string;
      }[];
      expect(rows.map((r) => r.hash)).toEqual(expected);
      expect(schemaMatches(db)).toBe(true);
    } finally {
      db.close();
    }
  });
});

describe('migrate --apply 사전 검사 실패 → 종료 1·변경 0·백업 0', () => {
  it('DB 없음', async () => {
    const fx = await makeFixture();
    const outcome = await runApply(argsOf(fx, { dataDir: join(fx.root, 'nodb') }));
    expect(outcome.code).toBe(1);
    expect(existsSync(join(fx.root, 'nodb'))).toBe(false);
  });

  it('잠금 BUSY — 별도 자식 프로세스가 잠금 보유 중 도구 자식 실행', { timeout: 60000 }, async () => {
    const fx = await makeFixture();
    const holder = spawn(process.execPath, [TSX_CLI, LOCK_CHILD, fx.dataDir], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    try {
      await waitFor(holder, 'LOCKED');
      const before = dumpAll(dbPath(fx));
      const run = spawnSync(
        process.execPath,
        [
          TSX_CLI,
          TOOL,
          '--apply',
          '--data-dir', fx.dataDir,
          '--history', fx.historyPath,
          '--cache', fx.cacheDir,
          '--library', fx.libraryPath,
          '--tz', TZ,
          '--out', fx.outPath,
          '--expect-history-sha', fx.historySha,
          '--expect-rows', String(fx.rows),
        ],
        { cwd: REPO, encoding: 'utf8' },
      );
      expect(run.status).toBe(1);
      expect(run.stderr + run.stdout).toContain(OWNER_LOCK_BUSY_MESSAGE);
      expect(dumpAll(dbPath(fx))).toEqual(before);
      expect(listBackups(fx.dataDir)).toEqual([]);
    } finally {
      holder.kill('SIGTERM');
    }
  });

  it('스키마 불일치: 해시 변조·미래 마이그레이션 추가', async () => {
    const fx = await makeFixture();
    const mutate = (sql: string): void => {
      const db = new Database(dbPath(fx));
      db.exec(sql);
      db.close();
    };
    mutate("UPDATE __drizzle_migrations SET hash = 'x' || substr(hash, 2) WHERE rowid = 3");
    await expectRejected(fx);
    const fx2 = await makeFixture();
    const db = new Database(dbPath(fx2));
    db.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)').run('f'.repeat(64), 9_999_999_999_999);
    db.close();
    await expectRejected(fx2);
  });

  it('ledger 존재 — rerun_blocked 0과 1 각각', async () => {
    for (const blocked of [0, 1]) {
      const fx = await makeFixture();
      const db = new Database(dbPath(fx));
      db.prepare(
        "INSERT INTO import_ledger (kind, source_ref, kept_count, dropped_count, first_run_at, last_run_at, rerun_blocked) VALUES ('history_jsonl', NULL, 1, 1, 1, 1, ?)",
      ).run(blocked);
      db.close();
      const { stderr } = await expectRejected(fx);
      expect(stderr).toContain('already');
    }
  });

  it('expect sha·expect rows 불일치', async () => {
    const fx = await makeFixture();
    await expectRejected(fx, { expectHistorySha: 'a'.repeat(64) });
    await expectRejected(fx, { expectRows: fx.rows + 1 });
  });

  it('값 형식 위반: 음수 분·비정수·비숫자 ID·잘못된 시각·비 steam', async () => {
    const bad: Record<string, unknown>[] = [
      { ts: T0, gameId: '100', playtimeMinutes: -1 },
      { ts: T0, gameId: '100', playtimeMinutes: 1.5 },
      { ts: T0, gameId: '10x', playtimeMinutes: 1 },
      { ts: -5, gameId: '100', playtimeMinutes: 1 },
      { ts: T0 + 0.5, gameId: '100', playtimeMinutes: 1 },
      { ts: T0, gameId: '100', platform: 'gog', playtimeMinutes: 1 },
    ];
    for (const row of bad) {
      const fx = await makeFixture({ history: [JSON.stringify({ platform: 'steam', ...row })] });
      await expectRejected(fx);
    }
  });

  it('잘못된 tz', async () => {
    const fx = await makeFixture();
    await expectRejected(fx, { tz: 'Not/AZone' });
  });

  it('games에 없는 gameId', async () => {
    const fx = await makeFixture({
      games: ['100', '300'],
      existing: defaultExisting().filter((s) => s.gameId !== '200'),
    });
    const { stderr } = await expectRejected(fx);
    expect(stderr).toContain('200');
  });

  it('기존 스냅샷이 0인 대상 게임', async () => {
    const fx = await makeFixture({ existing: defaultExisting().filter((s) => s.gameId !== '200') });
    const { stderr } = await expectRejected(fx);
    expect(stderr).toContain('200');
  });

  it('같은 날 기존 행', async () => {
    const fx = await makeFixture({
      existing: [...defaultExisting(), { gameId: '100', ts: T0 + 12 * DAY, total: 300, day: seoulDay(T0) }],
    });
    await expectRejected(fx);
  });

  it('기존 timezone 불일치', async () => {
    const fx = await makeFixture({
      existing: [...defaultExisting(), { gameId: '300', ts: T0 + 12 * DAY, total: 9, tz: 'UTC' }],
    });
    await expectRejected(fx);
  });

  it('체인 (a): 기존 최초보다 늦은 대표 행', async () => {
    const fx = await makeFixture({
      history: [...defaultHistory(), { ts: T0 + 10.5 * DAY, gameId: '100', playtimeMinutes: 190 }] as never,
    });
    // 10.5일 행은 기존 최초(10일)보다 늦다. 정수 ts 유지.
    expect(fx.rows).toBe(4);
    await expectRejected(fx);
  });

  it('체인 (b): 대표 → 대표 감소(음수)', async () => {
    const fx = await makeFixture({
      history: [
        { ts: T0, gameId: '100', playtimeMinutes: 100 },
        { ts: T0 + 3 * DAY, gameId: '100', playtimeMinutes: 90 },
      ],
    });
    await expectRejected(fx);
  });

  it('체인 (b): spike — 증가분 > 경과분(분)', async () => {
    // 경과 1일(1440분)에 1441분 증가 → spike
    const fx = await makeFixture({
      history: [
        { ts: T0 + 8 * DAY, gameId: '100', playtimeMinutes: 0 },
        { ts: T0 + 9 * DAY, gameId: '100', playtimeMinutes: 1441 },
      ],
      existing: [{ gameId: '100', ts: T0 + 10 * DAY, total: 1441 }],
      games: ['100'],
    });
    await expectRejected(fx);
  });

  it('체인 (b): 마지막 대표 → 기존 최초 감소', async () => {
    const fx = await makeFixture({
      history: [{ ts: T0, gameId: '100', playtimeMinutes: 500 }],
      existing: [{ gameId: '100', ts: T0 + 10 * DAY, total: 100 }],
      games: ['100'],
    });
    await expectRejected(fx);
  });

  it('체인 (b): 증가분 = 경과분이면 통과(같으면 정상)', async () => {
    const fx = await makeFixture({
      history: [{ ts: T0, gameId: '100', playtimeMinutes: 0 }],
      existing: [{ gameId: '100', ts: T0 + DAY, total: 1440 }],
      games: ['100'],
    });
    expect((await runApply(argsOf(fx))).code).toBe(0);
  });

  it('체인 (c): 기존 최초 행이 검토 대기이면 confirmedMinutes가 달라져 거부', async () => {
    const fx = await makeFixture({
      existing: [
        { gameId: '100', ts: T0 + 10 * DAY, total: 180, isReview: 1 },
        { gameId: '100', ts: T0 + 11 * DAY, total: 200 },
        { gameId: '200', ts: T0 + 10 * DAY, total: 50 },
      ],
    });
    const { stderr } = await expectRejected(fx);
    expect(stderr).toContain('100(confirmed-minutes-changed)');
  });

  it('체인 (c) 임시 트랜잭션은 성공 경로에서도 ROLLBACK — 백업 시점 DB 덤프가 실행 전과 같다', async () => {
    const fx = await makeFixture();
    const before = dumpAll(dbPath(fx));
    let atBackup: Record<string, unknown[]> | null = null;
    const outcome = await runApply(argsOf(fx), {
      backup: async (dir, now) => {
        atBackup = dumpAll(dbPath(fx));
        await backupDatabase(dir, now);
      },
    });
    expect(outcome.code).toBe(0);
    expect(atBackup).toEqual(before);
  });

  it('--out 금지 경로: 원본·DB·-wal·-shm·backups 아래', async () => {
    const fx = await makeFixture();
    for (const out of [
      fx.historyPath,
      fx.libraryPath,
      join(fx.cacheDir, 'new.json'),
      dbPath(fx),
      `${dbPath(fx)}-wal`,
      `${dbPath(fx)}-shm`,
      join(fx.dataDir, 'backups', 'x.json'),
    ]) {
      const historyBefore = readFileSync(fx.historyPath);
      await expectRejected(fx, { out });
      expect(readFileSync(fx.historyPath)).toEqual(historyBefore);
    }
  });
});

describe('migrate --apply 쓰기 실패 주입', () => {
  it('백업 실패 → 쓰기 0', async () => {
    const fx = await makeFixture();
    await expectRejected(fx, {}, {
      backup: async () => {
        throw new Error('backup boom');
      },
    });
  });

  it('240 INSERT 직후 실패 → snapshot·ledger 전건 0(백업은 남는다)', async () => {
    const fx = await makeFixture();
    const before = dumpAll(dbPath(fx));
    const outcome = await runApply(argsOf(fx), {
      afterSnapshotsInsert: () => {
        throw new Error('boom1');
      },
    });
    expect(outcome.code).toBe(1);
    expect(dumpAll(dbPath(fx))).toEqual(before);
  });

  it('ledger INSERT 직후 실패 → 전건 0', async () => {
    const fx = await makeFixture();
    const before = dumpAll(dbPath(fx));
    const outcome = await runApply(argsOf(fx), {
      afterLedgerInsert: () => {
        throw new Error('boom2');
      },
    });
    expect(outcome.code).toBe(1);
    expect(dumpAll(dbPath(fx))).toEqual(before);
  });

  it('FK 위반 주입 → ROLLBACK·변경 0', async () => {
    const fx = await makeFixture();
    const before = dumpAll(dbPath(fx));
    const outcome = await runApply(argsOf(fx), {
      afterLedgerInsert: (db) => {
        db.pragma('defer_foreign_keys = ON');
        db.prepare(
          "INSERT INTO playtime_snapshots (platform, external_id, observed_at, observed_day, timezone, total_minutes, is_review) VALUES ('steam', '999', 1, '1970-01-01', 'Asia/Seoul', 0, 0)",
        ).run();
      },
    });
    expect(outcome.code).toBe(1);
    expect(dumpAll(dbPath(fx))).toEqual(before);
  });

  it('COMMIT 직전 원본 변경 → 쓰기 0', async () => {
    const fx = await makeFixture();
    const before = dumpAll(dbPath(fx));
    const outcome = await runApply(argsOf(fx), {
      beforeCommit: () => writeFileSync(fx.libraryPath, '| title | game_id |\n| --- | --- |\n| g | 101 |\n'),
    });
    expect(outcome.code).toBe(1);
    expect(dumpAll(dbPath(fx))).toEqual(before);
  });

  it('추출 직후 원본 변경 → 쓰기 0·백업 0', async () => {
    const fx = await makeFixture();
    await expectRejected(fx, {}, {
      afterExtract: () => writeFileSync(join(fx.cacheDir, 'late.json'), '{}'),
    });
  });
});

describe('migrate --apply 멱등', () => {
  it('성공 후 2회차 → 종료 1, 행 수·값 불변, 백업 추가 0', async () => {
    const fx = await makeFixture();
    expect((await runApply(argsOf(fx))).code).toBe(0);
    const after = dumpAll(dbPath(fx));
    const backups = listBackups(fx.dataDir);
    const second = await runApply(argsOf(fx));
    expect(second.code).toBe(1);
    expect(dumpAll(dbPath(fx))).toEqual(after);
    expect(listBackups(fx.dataDir)).toEqual(backups);
  });
});

describe('migrate --apply COMMIT 후 실패 → 종료 3', () => {
  it('리포트 쓰기 실패', async () => {
    const fx = await makeFixture();
    const outcome = await runApply(argsOf(fx), {
      writeReport: () => {
        throw new Error('disk full');
      },
    });
    expectApplied(fx, outcome);
  });

  it('COMMIT 후 원본 sha 변경', async () => {
    const fx = await makeFixture();
    const outcome = await runApply(argsOf(fx), {
      afterCommit: () => writeFileSync(fx.libraryPath, 'changed'),
    });
    expectApplied(fx, outcome);
  });
});

function expectApplied(fx: Fixture, outcome: { code: number; stderr: string[]; stdout: string[] }): void {
  expect(outcome.code).toBe(3);
  const err = outcome.stderr.join('\n');
  expect(err).toContain('APPLIED');
  expect(err).toContain('history_jsonl');
  expect(err).toContain(listBackups(fx.dataDir)[0]);
  expect(err).not.toContain(fx.dataDir);
  expect(count(fx, 'import_ledger')).toBe(1);
  expect(count(fx, 'playtime_snapshots')).toBe(defaultExisting().length + fx.rows);
}

describe('출력 비밀 0', () => {
  it('stdout·stderr·리포트에 data 폴더 절대 경로·17자리 숫자 폴더 없음(성공·실패·CLI)', { timeout: 60000 }, async () => {
    const fx = await makeFixture();
    const ok = await runApply(argsOf(fx));
    const bad = await runApply(argsOf(fx)); // 2회차 거부
    const text = [ok.stdout, ok.stderr, bad.stdout, bad.stderr].flat().join('\n') + readFileSync(fx.outPath, 'utf8');
    expect(text).not.toContain(STEAM_ID_LIKE);
    expect(text).not.toContain(fx.dataDir);
    expect(text).not.toMatch(/\d{17}/);
    // 실제 CLI 실패 경로(인자 누락 포함)
    const fx2 = await makeFixture();
    const run = spawnSync(
      process.execPath,
      [TSX_CLI, TOOL, '--apply', '--data-dir', join(fx2.dataDir, 'missing'), '--history', fx2.historyPath],
      { cwd: REPO, encoding: 'utf8' },
    );
    expect(run.status).toBe(1);
    expect(run.stdout + run.stderr).not.toMatch(/\d{17}/);
  });

  it('CLI 성공: 종료 0·적용·출력에 경로 없음', { timeout: 60000 }, async () => {
    const fx = await makeFixture();
    const run = spawnSync(
      process.execPath,
      [
        TSX_CLI, TOOL, '--apply',
        '--data-dir', fx.dataDir, '--history', fx.historyPath, '--cache', fx.cacheDir,
        '--library', fx.libraryPath, '--tz', TZ, '--out', fx.outPath,
        '--expect-history-sha', fx.historySha, '--expect-rows', String(fx.rows),
      ],
      { cwd: REPO, encoding: 'utf8' },
    );
    expect(run.status).toBe(0);
    expect(count(fx, 'import_ledger')).toBe(1);
    expect(run.stdout + run.stderr).not.toMatch(/\d{17}/);
    expect(createHash('sha256').update(readFileSync(fx.historyPath)).digest('hex')).toBe(fx.historySha);
  });
});

describe('기본 모드', () => {
  it('인자가 --apply·--rollback 없으면 dry-run이고 DB를 열지 않는다', { timeout: 60000 }, async () => {
    const fx = await makeFixture();
    const run = spawnSync(
      process.execPath,
      [TSX_CLI, TOOL, '--history', fx.historyPath, '--cache', fx.cacheDir, '--library', fx.libraryPath, '--tz', TZ, '--out', fx.outPath],
      { cwd: REPO, encoding: 'utf8' },
    );
    expect(run.status).toBe(0);
    expect(listBackups(fx.dataDir)).toEqual([]);
    expect(existsSync(join(fx.dataDir, '.owner.lock'))).toBe(false);
  });
});

function waitFor(child: ChildProcess, line: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(new Error(`대기 초과: ${line} / ${out}`)), 30000);
    child.stdout?.on('data', (chunk: Buffer) => {
      out += chunk.toString();
      if (out.includes(line)) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`자식 종료 ${code}: ${out}`));
    });
  });
}

afterEach(() => undefined);
