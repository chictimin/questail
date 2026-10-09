import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * W10b perf 시드 — D-16 합성 5,000건 → DB 행 삽입. 결정적(생성기 고정 + 순서 고정).
 * A 소유 생성기(tools/generate-fixtures.ts)는 수정 없이 "실행"만 한다.
 * 출력·시드 매핑 모두 결정적이라 같은 바이트·같은 행을 낸다.
 */
const PERF_DIR = dirname(fileURLToPath(import.meta.url));
const WEB = join(PERF_DIR, '..', '..');
const ROOT = join(WEB, '..', '..');
const LOCAL_DIR = join(WEB, 'test', 'fixtures', 'local');

export const PERF_COUNT = 5000;
export const PERF_FIXTURE_NAME = `owned-synthetic-${PERF_COUNT}.json`;
/** 실행 인자(보고용, 고정): --count 5000 --out-dir apps/web/test/fixtures/local */
const GENERATOR_ARGS = [
  'tsx',
  'tools/generate-fixtures.ts',
  '--count',
  String(PERF_COUNT),
  '--out-dir',
  join('apps', 'web', 'test', 'fixtures', 'local'),
] as const;

interface OwnedGame {
  appid: number;
  playtime_forever: number;
  rtime_last_played: number;
}

/** 픽스처가 없으면 생성기를 실행해 만든다. 있으면 그대로 쓴다. */
export function ensurePerfFixture(): string {
  mkdirSync(LOCAL_DIR, { recursive: true });
  const fixturePath = join(LOCAL_DIR, PERF_FIXTURE_NAME);
  if (!existsSync(fixturePath)) {
    execFileSync('pnpm', [...GENERATOR_ARGS], { cwd: ROOT, stdio: 'inherit' });
  }
  return fixturePath;
}

/**
 * 합성 owned → games·ownership_spans·playtime_snapshots·ratings·rating_events.
 * 이름은 10개 중 1개 NULL(P-4 경로), 별점은 5개 중 3개(1~10 순환).
 */
export function seedPerfDb(db: Database.Database): { games: number } {
  const fixture = JSON.parse(readFileSync(ensurePerfFixture(), 'utf8')) as {
    response: { games: OwnedGame[] };
  };
  const games = fixture.response.games;
  const insertGame = db.prepare(
    'INSERT INTO games (platform, external_id, name) VALUES (?, ?, ?)',
  );
  const insertSpan = db.prepare(
    "INSERT INTO ownership_spans (platform, external_id, origin, started_at, ended, ended_at, is_baseline, sync_run_id) VALUES (?, ?, 'observed', ?, 0, NULL, 0, NULL)",
  );
  const insertSnapshot = db.prepare(
    'INSERT INTO playtime_snapshots (platform, external_id, observed_at, observed_day, timezone, total_minutes, last_played, playtime_2weeks, is_review, review_reason, sync_run_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL)',
  );
  const insertRating = db.prepare(
    "INSERT INTO ratings (platform, external_id, score, updated_at, updated_by) VALUES (?, ?, ?, ?, 'perf')",
  );
  const insertEvent = db.prepare(
    'INSERT INTO rating_events (platform, external_id, before_score, after_score, created_at, sync_run_id) VALUES (?, ?, NULL, ?, ?, NULL)',
  );
  const seedAll = db.transaction(() => {
    games.forEach((game, index) => {
      const externalId = String(game.appid);
      const name = index % 10 === 9 ? null : `합성 게임 ${game.appid}`;
      insertGame.run('steam', externalId, name);
      insertSpan.run('steam', externalId, 1700000000);
      insertSnapshot.run(
        'steam',
        externalId,
        1700000000,
        '2024-01-01',
        'UTC',
        game.playtime_forever,
        game.rtime_last_played,
        0,
      );
      if (index % 5 < 3) {
        const score = 1 + (index % 10);
        insertRating.run('steam', externalId, score, 1700100000);
        insertEvent.run('steam', externalId, score, 1700100000);
      }
    });
  });
  seedAll();
  return { games: games.length };
}

/** drizzle 저널 SQL을 빈 DB에 적용한다(e2e Spec과 같은 방식). */
export function applyJournal(dbPath: string): void {
  const journal = JSON.parse(
    readFileSync(join(WEB, 'drizzle', 'meta', '_journal.json'), 'utf8'),
  ) as { entries: { tag: string }[] };
  const setup = new Database(dbPath);
  try {
    setup.pragma('journal_mode = WAL');
    for (const entry of journal.entries) {
      setup.exec(readFileSync(join(WEB, 'drizzle', `${entry.tag}.sql`), 'utf8'));
    }
  } finally {
    setup.close();
  }
}
