/**
 * TEST-HELPER: D-14 합성 픽스처. 마이그레이션 0005까지 적용한 합성 dataDir + 합성 history/library/cache.
 * 캡틴 원본·data/ 접촉 없음. dataDir 경로에 17자리 숫자 폴더를 포함한다.
 */
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrateDatabase } from '../../../src/db/migrate.js';

export const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const REPO = join(WEB, '..', '..');
export const TOOL = join(REPO, 'tools', 'migrate-r1-once.ts');
export const TSX_CLI = join(REPO, 'node_modules', 'tsx', 'dist', 'cli.mjs');
export const STEAM_ID_LIKE = '76561198000000000';
export const TZ = 'Asia/Seoul';

/** 로컬(Asia/Seoul) 날짜. 합성 값 계산용. */
export function seoulDay(ts: number): string {
  return new Date((ts + 9 * 3600) * 1000).toISOString().slice(0, 10);
}

export interface Fixture {
  root: string;
  dataDir: string;
  historyPath: string;
  libraryPath: string;
  cacheDir: string;
  outPath: string;
  historySha: string;
  /** 대표 행 수 */
  rows: number;
  /** 대표 행의 gameId 집합 */
  gameIds: string[];
}

export interface HistoryLine {
  ts: number;
  gameId: string;
  platform?: string;
  playtimeMinutes: number | string;
}

/** 기준 시각: 기존 DB 최초 관측은 DAY0 + 10일, 대표 행은 그보다 앞 */
export const T0 = 1789000000;
export const DAY = 86400;

/**
 * 기본 history: 게임 100은 2일 2행(+같은 날 중복 1행), 게임 200은 1일 1행, 깨진 줄 1.
 * 기존 DB: 게임 100 {T0+10일: 180, T0+11일: 200}, 게임 200 {T0+10일: 50}, 게임 300(대표 없음) {T0+10일: 7}.
 */
export function defaultHistory(): HistoryLine[] {
  return [
    { ts: T0, gameId: '100', playtimeMinutes: 60 },
    { ts: T0 + 3600, gameId: '100', playtimeMinutes: 61 },
    { ts: T0 + 3 * DAY, gameId: '100', playtimeMinutes: 120 },
    { ts: T0 + 3 * DAY, gameId: '200', playtimeMinutes: 50 },
  ];
}

export interface ExistingSnap {
  gameId: string;
  ts: number;
  total: number;
  isReview?: 0 | 1;
  tz?: string;
  day?: string;
}

export function defaultExisting(): ExistingSnap[] {
  return [
    { gameId: '100', ts: T0 + 10 * DAY, total: 180 },
    { gameId: '100', ts: T0 + 11 * DAY, total: 200 },
    { gameId: '200', ts: T0 + 10 * DAY, total: 50 },
    { gameId: '300', ts: T0 + 10 * DAY, total: 7 },
  ];
}

export async function makeFixture(
  opts: {
    history?: (HistoryLine | string)[];
    existing?: ExistingSnap[];
    games?: string[];
    cacheFiles?: Record<string, string>;
  } = {},
): Promise<Fixture> {
  const root = mkdtempSync(join(tmpdir(), 'questail-d14-'));
  const dataDir = join(root, STEAM_ID_LIKE, 'data');
  mkdirSync(dataDir, { recursive: true });
  const handle = await migrateDatabase(dataDir);
  const db = handle.db;
  try {
    const games = opts.games ?? ['100', '200', '300'];
    for (const id of games) {
      db.prepare('INSERT INTO games (platform, external_id, name) VALUES (?, ?, ?)').run(
        'steam',
        id,
        `game-${id}`,
      );
      db.prepare(
        'INSERT INTO ownership_spans (platform, external_id, origin, started_at, ended, is_baseline) VALUES (?, ?, ?, ?, ?, ?)',
      ).run('steam', id, 'observed', T0 + 10 * DAY, 0, 1);
    }
    for (const snap of opts.existing ?? defaultExisting()) {
      db.prepare(
        `INSERT INTO playtime_snapshots (platform, external_id, observed_at, observed_day, timezone, total_minutes, is_review)
         VALUES ('steam', ?, ?, ?, ?, ?, ?)`,
      ).run(snap.gameId, snap.ts, snap.day ?? seoulDay(snap.ts), snap.tz ?? TZ, snap.total, snap.isReview ?? 0);
    }
  } finally {
    await handle.close();
  }
  const sources = join(root, 'sources');
  mkdirSync(sources);
  const historyPath = join(sources, 'history.jsonl');
  const lines = (opts.history ?? defaultHistory()).map((line) =>
    typeof line === 'string' ? line : JSON.stringify({ platform: 'steam', ...line }),
  );
  writeFileSync(historyPath, `${lines.join('\n')}\n`);
  const libraryPath = join(sources, 'library.md');
  writeFileSync(libraryPath, '| title | game_id |\n| --- | --- |\n| g | 100 |\n');
  const cacheDir = join(sources, 'cache');
  mkdirSync(cacheDir);
  for (const [name, body] of Object.entries(opts.cacheFiles ?? { '100.json': '{}' })) {
    writeFileSync(join(cacheDir, name), body);
  }
  const reps = new Set<string>();
  const gameIds = new Set<string>();
  for (const line of lines) {
    try {
      const row = JSON.parse(line) as { ts: number; gameId: string };
      const sec = row.ts > 9999999999 ? Math.floor(row.ts / 1000) : row.ts;
      reps.add(`${row.gameId} ${seoulDay(sec)}`);
      gameIds.add(row.gameId);
    } catch {
      /* 깨진 줄 */
    }
  }
  return {
    root,
    dataDir,
    historyPath,
    libraryPath,
    cacheDir,
    outPath: join(root, 'report.json'),
    historySha: createHash('sha256').update(readFileSync(historyPath)).digest('hex'),
    rows: reps.size,
    gameIds: [...gameIds].sort(),
  };
}

/** 모든 테이블 행 덤프(rowid 순). 비교용. 잠금 파일은 별도 DB라 제외된다. */
export function dumpAll(dbPath: string): Record<string, unknown[]> {
  const db = new Database(dbPath, { readonly: true });
  try {
    const out: Record<string, unknown[]> = {};
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as { name: string }[];
    for (const { name } of tables) {
      out[name] = db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all();
    }
    return out;
  } finally {
    db.close();
  }
}

export function listBackups(dataDir: string): string[] {
  try {
    return readdirSync(join(dataDir, 'backups')).sort();
  } catch {
    return [];
  }
}
