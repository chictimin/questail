/**
 * tools/migrate-r1-once.ts — D-14 캡틴 전용 1회 이관 도구 (워커 A 소유).
 *
 * 모드 3종.
 *  - 기본(dry-run): 원본 읽기 + 임시 리포트 쓰기만. DB 열기·쓰기 0.
 *  - --apply: 소유 잠금 → 사전 검사 → 백업 → 단일 트랜잭션 → 리포트.
 *  - --rollback: 백업 검증 → 현재 DB 격리 이동 → 백업 복사.
 * 원본(history·library·cache) 쓰기·이동·삭제·재생성은 어느 모드에서도 0.
 *
 * 실행:
 *   pnpm tsx tools/migrate-r1-once.ts --history <path> --cache <dir> --library <path> --tz <IANA> --out <path>
 *   pnpm tsx tools/migrate-r1-once.ts --apply --data-dir <D> --history <path> --cache <dir> --library <path>
 *     --tz <IANA> --out <path> --expect-history-sha <hex64> --expect-rows <N>
 *   pnpm tsx tools/migrate-r1-once.ts --rollback --data-dir <D> --backup <백업 파일 이름>
 *
 * 리포트는 대표 행 수·제외 행 수·제외 사유별 건수·과거 보유 구간 후보 수·
 * 원본 sha256(실행 전후 동일 확인)만 담는다. 판단하지 않는다.
 */

import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BACKUP_DIR_NAME, backupDatabase, backupFileName } from '../apps/web/src/db/backup.js';
import { listLibrary } from '../apps/web/src/data/library.js';
import { DB_FILE_NAME } from '../apps/web/src/db/open.js';
import {
  OWNER_LOCK_BUSY_MESSAGE,
  OWNER_LOCK_UNAVAILABLE_MESSAGE,
  acquireOwnerLock,
  isOwnerLockBusy,
} from '../apps/web/src/db/ownerLock.js';

interface HistoryRow {
  ts: number;
  gameId: string;
  platform: string;
  playtimeMinutes: number;
}

interface Args {
  history: string;
  cache: string;
  library: string;
  tz: string;
  out: string;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string): string => {
    const ix = argv.indexOf(name);
    if (ix < 0 || ix + 1 >= argv.length || argv[ix + 1].startsWith('--')) {
      throw new Error(`필수 인자 없음: ${name}`);
    }
    return argv[ix + 1];
  };
  return {
    history: get('--history'),
    cache: get('--cache'),
    library: get('--library'),
    tz: get('--tz'),
    out: get('--out'),
  };
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function readHistoryLines(path: string): { kept: HistoryRow[]; dropped: { reason: string; count: number }[] } {
  const kept: HistoryRow[] = [];
  const droppedByReason = new Map<string, number>();
  const drop = (reason: string): void => {
    droppedByReason.set(reason, (droppedByReason.get(reason) ?? 0) + 1);
  };
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      drop('malformed-json');
      continue;
    }
    if (typeof parsed !== 'object' || parsed === null) {
      drop('non-object');
      continue;
    }
    const row = parsed as Partial<Record<keyof HistoryRow, unknown>>;
    if (
      typeof row.ts !== 'number' ||
      typeof row.gameId !== 'string' ||
      typeof row.platform !== 'string' ||
      typeof row.playtimeMinutes !== 'number'
    ) {
      drop('missing-field');
      continue;
    }
    // 원본 ts는 밀리초 실측. 10자리를 넘으면 초로 정규화한다.
    const ts = row.ts > 9999999999 ? Math.floor(row.ts / 1000) : row.ts;
    kept.push({ ts, gameId: row.gameId, platform: row.platform, playtimeMinutes: row.playtimeMinutes });
  }
  return {
    kept,
    dropped: [...droppedByReason.entries()].map(([reason, count]) => ({ reason, count })),
  };
}

function localDay(tsSeconds: number, tz: string): string {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    throw new Error(`tz 무효: ${tz}`);
  }
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(new Date(tsSeconds * 1000))) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  const day = `${parts['year']}-${parts['month']}-${parts['day']}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error(`tz 무효: ${tz}`);
  }
  return day;
}

/** (게임, 로컬 관측일)별 첫 관측 1행. 240 목표치에 맞추려 조정하지 않는다. */
export function pickRepresentatives(rows: HistoryRow[], tz: string): HistoryRow[] {
  const seen = new Set<string>();
  const out: HistoryRow[] = [];
  const sorted = [...rows].sort((a, b) => a.ts - b.ts || (a.gameId < b.gameId ? -1 : 1));
  for (const row of sorted) {
    const key = `${row.gameId} ${localDay(row.ts, tz)}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(row);
    }
  }
  return out;
}

function readLibraryGameIds(path: string): Set<string> {
  const ids = new Set<string>();
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.startsWith('| ') || line.startsWith('| title') || line.startsWith('| ---')) continue;
    const cells = line.split('|');
    const gameId = cells[2]?.trim();
    if (gameId && /^\d+$/.test(gameId)) ids.add(gameId);
  }
  return ids;
}

const OWNERSHIP_TRACE_KEYS = ['owned', 'ownership', 'library', 'addedAt', 'dateAdded', 'wishlist'];

/** 과거 보유 후보 64건 근거 플래그. 판단하지 않는다. */
export function gapEvidence(
  cacheDir: string,
  libraryIds: Set<string>,
  history: HistoryRow[],
): { appid: string; inHistory: boolean; historyCount: number; firstTs: number | null; lastTs: number | null; traceKeys: string[] }[] {
  const byGame = new Map<string, HistoryRow[]>();
  for (const row of history) {
    const list = byGame.get(row.gameId) ?? [];
    list.push(row);
    byGame.set(row.gameId, list);
  }
  const out: { appid: string; inHistory: boolean; historyCount: number; firstTs: number | null; lastTs: number | null; traceKeys: string[] }[] = [];
  for (const file of readdirSync(cacheDir).sort()) {
    const appid = file.replace(/\.json$/, '');
    if (libraryIds.has(appid)) continue;
    let traceKeys: string[] = [];
    try {
      const raw = JSON.parse(readFileSync(join(cacheDir, file), 'utf8')) as unknown;
      const keys = new Set<string>();
      const walk = (value: unknown): void => {
        if (typeof value !== 'object' || value === null) return;
        for (const key of Object.keys(value)) {
          keys.add(key);
          walk((value as Record<string, unknown>)[key]);
        }
      };
      walk(raw);
      traceKeys = [...keys].filter((key) => OWNERSHIP_TRACE_KEYS.includes(key)).sort();
    } catch {
      traceKeys = [];
    }
    const rows = (byGame.get(appid) ?? []).map((row) => row.ts).sort((a, b) => a - b);
    out.push({
      appid,
      inHistory: rows.length > 0,
      historyCount: rows.length,
      firstTs: rows.length > 0 ? rows[0] : null,
      lastTs: rows.length > 0 ? rows[rows.length - 1] : null,
      traceKeys,
    });
  }
  return out;
}

export interface DryRunReport {
  historyLines: number;
  keptRows: number;
  dropped: { reason: string; count: number }[];
  representativeRows: number;
  excludedRows: number;
  libraryGames: number;
  cacheFiles: number;
  gapCandidates: ReturnType<typeof gapEvidence>;
  sourceSha256Before: string;
  sourceSha256After: string;
}

export function dryRun(args: Args): DryRunReport {
  const before = sha256File(args.history);
  const { kept, dropped } = readHistoryLines(args.history);
  const representatives = pickRepresentatives(kept, args.tz);
  const libraryIds = readLibraryGameIds(args.library);
  const cacheFiles = readdirSync(args.cache).length;
  const gapCandidates = gapEvidence(args.cache, libraryIds, kept);
  const after = sha256File(args.history);
  return {
    historyLines: kept.length + dropped.reduce((sum, entry) => sum + entry.count, 0),
    keptRows: kept.length,
    dropped,
    representativeRows: representatives.length,
    excludedRows: kept.length - representatives.length,
    libraryGames: libraryIds.size,
    cacheFiles,
    gapCandidates,
    sourceSha256Before: before,
    sourceSha256After: after,
  };
}

// ---------------------------------------------------------------------------
// 공통: 결과 모음·실패 표현·DB 열기
// ---------------------------------------------------------------------------

type Db = ReturnType<typeof acquireOwnerLock>['connection'];

const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'web');

/** 도구 파일은 better-sqlite3를 직접 해석할 수 없어 apps/web 기준으로 로드한다. */
function openSqlite(path: string, readonly: boolean): Db {
  const load = createRequire(join(WEB_DIR, 'package.json'));
  const Ctor = load('better-sqlite3') as new (
    file: string,
    options?: { readonly?: boolean; fileMustExist?: boolean },
  ) => Db;
  return new Ctor(path, { readonly, fileMustExist: true });
}

export interface Outcome {
  code: number;
  stdout: string[];
  stderr: string[];
}

/** 쓰기 전(또는 롤백 전) 실패. 메시지에는 경로를 싣지 않는다. */
class Fail extends Error {}

/** 예상 밖 오류 메시지에서 경로 조각(숫자 17자리 이상 폴더 포함)을 지운다. */
function scrub(message: string, extra: string[] = []): string {
  let out = message;
  for (const text of extra) {
    if (text !== '') out = out.split(text).join('<path>');
  }
  return out.replace(/[^\s'"]*\d{17}[^\s'"]*/g, '<path>');
}

function describeError(error: unknown, extra: string[] = []): string {
  if (error instanceof Fail) return error.message;
  const code = (error as { code?: unknown } | null)?.code;
  const text = error instanceof Error ? error.message : String(error);
  return scrub(typeof code === 'string' ? `${code}: ${text}` : text, extra);
}

function sha256Buffer(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function dirDigest(dir: string): string {
  const hash = createHash('sha256');
  const walk = (current: string, prefix: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        hash.update(`d ${prefix}${entry.name}\n`);
        walk(full, `${prefix}${entry.name}/`);
      } else {
        hash.update(`f ${prefix}${entry.name} ${sha256Buffer(full)}\n`);
      }
    }
  };
  walk(dir, '');
  return hash.digest('hex');
}

interface SourceDigest {
  history: string;
  library: string;
  cache: string;
}

function sourceDigest(args: { history: string; library: string; cache: string }): SourceDigest {
  return {
    history: sha256Buffer(args.history),
    library: sha256Buffer(args.library),
    cache: dirDigest(args.cache),
  };
}

function sameDigest(a: SourceDigest, b: SourceDigest): boolean {
  return a.history === b.history && a.library === b.library && a.cache === b.cache;
}

function utcTag(now: Date): string {
  return now.toISOString().replace(/[:.]/g, '-');
}

// ---------------------------------------------------------------------------
// 스키마 대조 (사전 검사 3) — migrator 판독과 같은 방식(저널 순서·sql 파일 sha256)
// ---------------------------------------------------------------------------

/** 저장소 마이그레이션 해시 목록. drizzle readMigrationFiles와 같은 순서·값이다(테스트가 대조). */
export function repoMigrationHashes(): string[] {
  const journal = JSON.parse(
    readFileSync(join(WEB_DIR, 'drizzle', 'meta', '_journal.json'), 'utf8'),
  ) as { entries: { tag: string }[] };
  return journal.entries.map((entry) =>
    createHash('sha256')
      .update(readFileSync(join(WEB_DIR, 'drizzle', `${entry.tag}.sql`)).toString())
      .digest('hex'),
  );
}

/** DB 기록표 해시 목록이 저장소 목록과 순서·개수까지 같다. */
export function schemaMatches(db: Db): boolean {
  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'")
    .get();
  if (!table) return false;
  const rows = db.prepare('SELECT hash FROM __drizzle_migrations ORDER BY created_at, id').all() as {
    hash: string;
  }[];
  const expected = repoMigrationHashes();
  return rows.length === expected.length && rows.every((row, ix) => row.hash === expected[ix]);
}

// ---------------------------------------------------------------------------
// 체인 검사 (사전 검사 9) — (a)(b)는 도구 판정, (c)는 앱 listLibrary 직접 사용
// ---------------------------------------------------------------------------

interface SnapPoint {
  observedAt: number;
  totalMinutes: number;
  isReview: boolean;
}

/**
 * playtime.ts 판정과 같은 규칙: 감소는 음수, 증가분 > 경과분(초/60)이면 spike. 같으면 정상.
 * 앱에 순수 export가 없어 식을 복제한다 — 테스트가 recordPlaytimeSnapshot 결과와 행마다 대조한다.
 */
export function abnormalStepKind(deltaMinutes: number, elapsedSeconds: number): 'negative_clamped' | 'spike' | null {
  return deltaMinutes < 0 ? 'negative_clamped' : deltaMinutes > elapsedSeconds / 60 ? 'spike' : null;
}

function isAbnormalStep(deltaMinutes: number, elapsedSeconds: number): boolean {
  return abnormalStepKind(deltaMinutes, elapsedSeconds) !== null;
}

interface ChainProblem {
  gameId: string;
  rule: 'a' | 'b' | 'c';
}

function checkChains(
  reps: HistoryRow[],
  existingByGame: Map<string, (SnapPoint & { id: number })[]>,
): ChainProblem[] {
  const problems: ChainProblem[] = [];
  const repsByGame = new Map<string, HistoryRow[]>();
  for (const rep of reps) {
    const list = repsByGame.get(rep.gameId) ?? [];
    list.push(rep);
    repsByGame.set(rep.gameId, list);
  }
  for (const [gameId, list] of [...repsByGame.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const existing = [...(existingByGame.get(gameId) ?? [])].sort(
      (a, b) => a.observedAt - b.observedAt || a.id - b.id,
    );
    const mine = [...list].sort((a, b) => a.ts - b.ts);
    const first = existing[0];
    if (mine.some((rep) => rep.ts >= first.observedAt)) problems.push({ gameId, rule: 'a' });
    const chain = [...mine.map((rep) => ({ ts: rep.ts, total: rep.playtimeMinutes })), { ts: first.observedAt, total: first.totalMinutes }];
    for (let ix = 1; ix < chain.length; ix += 1) {
      if (isAbnormalStep(chain[ix].total - chain[ix - 1].total, chain[ix].ts - chain[ix - 1].ts)) {
        problems.push({ gameId, rule: 'b' });
        break;
      }
    }
  }
  return problems;
}

const INSERT_SNAPSHOT_SQL = `INSERT INTO playtime_snapshots
   (platform, external_id, observed_at, observed_day, timezone, total_minutes,
    last_played, playtime_2weeks, is_review, review_reason, sync_run_id)
 VALUES ('steam', ?, ?, ?, ?, ?, NULL, NULL, 0, NULL, NULL)`;

/** 본 적용과 검사용 임시 트랜잭션이 같이 쓰는 대표 행 INSERT. */
function insertRepresentatives(db: Db, reps: HistoryRow[], days: Map<HistoryRow, string>, tz: string): void {
  const insertSnapshot = db.prepare(INSERT_SNAPSHOT_SQL);
  for (const rep of reps) {
    insertSnapshot.run(rep.gameId, rep.ts, days.get(rep), tz, rep.playtimeMinutes);
  }
}

/** 앱 listLibrary가 계산한 대상 게임별 confirmedMinutes. 목록에 없는 게임은 키가 없다. */
function confirmedFromLibrary(db: Db, gameIds: string[]): Map<string, number> {
  const wanted = new Set(gameIds);
  const out = new Map<string, number>();
  for (const facts of listLibrary(db as unknown as Parameters<typeof listLibrary>[0], { includeEnded: true })) {
    if (facts.key.platform === 'steam' && wanted.has(facts.key.externalId)) {
      out.set(facts.key.externalId, facts.confirmedMinutes);
    }
  }
  return out;
}

/**
 * 사전 검사 9(c): 백업 전 임시 트랜잭션에서 대표 행을 넣어 보고 앱 listLibrary 값이 달라지는지 본다.
 * 무조건 ROLLBACK이며 ledger는 쓰지 않는다. 반환: 적용 전 값, 달라진 게임 ID.
 */
function checkConfirmedMinutes(
  dbFile: string,
  reps: HistoryRow[],
  days: Map<HistoryRow, string>,
  tz: string,
): { before: Map<string, number>; changed: string[] } {
  const targetIds = [...new Set(reps.map((rep) => rep.gameId))].sort();
  const db = openSqlite(dbFile, false);
  try {
    db.pragma('foreign_keys = ON');
    db.exec('BEGIN');
    try {
      const before = confirmedFromLibrary(db, targetIds);
      insertRepresentatives(db, reps, days, tz);
      const after = confirmedFromLibrary(db, targetIds);
      const changed = targetIds.filter((id) => !before.has(id) || before.get(id) !== after.get(id));
      return { before, changed };
    } finally {
      db.exec('ROLLBACK');
    }
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// --apply
// ---------------------------------------------------------------------------

export interface ApplyArgs {
  dataDir: string;
  history: string;
  cache: string;
  library: string;
  tz: string;
  out: string;
  expectHistorySha: string;
  expectRows: number;
}

/** 시험 주입 지점. 제품 경로에서는 전부 비어 있다. */
export interface ApplyHooks {
  backup?: (dataDir: string, now: Date) => Promise<void>;
  afterExtract?: () => void;
  afterSnapshotsInsert?: (db: Db) => void;
  afterLedgerInsert?: (db: Db) => void;
  beforeCommit?: () => void;
  afterCommit?: () => void;
  writeReport?: (path: string, text: string) => void;
}

const LEDGER_KIND = 'history_jsonl';
const LEDGER_SOURCE_REF = 'games/history.jsonl';

/** 쓰기 대상이 아닌 경로가 아직 없을 수 있어 가장 가까운 기존 조상의 realpath에 나머지를 붙인다. */
function realPathLoose(path: string): string {
  const abs = resolve(path);
  const rest: string[] = [];
  let current = abs;
  while (!existsSync(current)) {
    rest.unshift(basename(current));
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return join(realpathSync(current), ...rest);
}

function isSameOrUnder(path: string, root: string): boolean {
  return path === root || path.startsWith(root + sep);
}

function failIf(condition: boolean, message: string): void {
  if (condition) throw new Fail(message);
}

function listIds(ids: string[]): string {
  const sorted = [...ids].sort();
  return sorted.length > 20 ? `${sorted.slice(0, 20).join(',')},... (${sorted.length})` : sorted.join(',');
}

export async function runApply(args: ApplyArgs, hooks: ApplyHooks = {}): Promise<Outcome> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const scrubList = [args.dataDir];
  let committed: { backupName: string; ledgerLine: string } | null = null;
  try {
    // 1. DB 존재 (자동 해석 없음 — 명시 경로만)
    failIf(!existsSync(join(args.dataDir, DB_FILE_NAME)), `no ${DB_FILE_NAME} in the given data folder`);
    const realDir = realpathSync(args.dataDir);
    scrubList.push(realDir);
    const dbFile = join(realDir, DB_FILE_NAME);

    // 2. 소유 잠금 — 프로세스 종료까지 유지
    try {
      acquireOwnerLock(realDir);
    } catch (error) {
      if (isOwnerLockBusy(error)) {
        stderr.push(OWNER_LOCK_BUSY_MESSAGE, 'stop the server on port 4800 first, then retry');
        return { code: 1, stdout, stderr };
      }
      throw new Fail(OWNER_LOCK_UNAVAILABLE_MESSAGE);
    }

    // 11. --out 경로 (시작 시)
    const outReal = realPathLoose(args.out);
    const forbidden = [
      realPathLoose(args.history),
      realPathLoose(args.library),
      realPathLoose(args.cache),
      dbFile,
      `${dbFile}-wal`,
      `${dbFile}-shm`,
      join(realDir, BACKUP_DIR_NAME),
    ];
    failIf(forbidden.some((root) => isSameOrUnder(outReal, root)), '--out points into a protected location');
    failIf(
      !existsSync(dirname(resolve(args.out))) || !statSync(dirname(resolve(args.out))).isDirectory(),
      '--out parent folder does not exist',
    );

    // 10(i) 원본 3종 sha — 읽기 전
    const digestBefore = sourceDigest(args);
    // 5. 승인 입력 고정
    failIf(!/^[0-9a-f]{64}$/i.test(args.expectHistorySha), '--expect-history-sha must be 64 hex chars');
    failIf(digestBefore.history !== args.expectHistorySha.toLowerCase(), 'history sha256 differs from --expect-history-sha');
    const { kept, dropped } = readHistoryLines(args.history);
    let reps: HistoryRow[];
    try {
      reps = pickRepresentatives(kept, args.tz);
    } catch {
      throw new Fail('--tz is invalid or a timestamp is out of range');
    }
    failIf(reps.length !== args.expectRows, `representative rows ${reps.length} differ from --expect-rows ${args.expectRows}`);
    // 10(ii) 대표 추출 직후
    hooks.afterExtract?.();
    failIf(!sameDigest(sourceDigest(args), digestBefore), 'source files changed during extraction');

    // 6. 대표 값 형식
    const days = new Map<HistoryRow, string>();
    let badFormat = 0;
    for (const rep of reps) {
      const day = localDay(rep.ts, args.tz);
      days.set(rep, day);
      const dayOk = (() => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
        const parsed = new Date(`${day}T00:00:00Z`);
        return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day;
      })();
      const ok =
        rep.platform === 'steam' &&
        /^\d+$/.test(rep.gameId) &&
        Number.isInteger(rep.ts) &&
        rep.ts > 0 &&
        Number.isInteger(rep.playtimeMinutes) &&
        rep.playtimeMinutes >= 0 &&
        dayOk;
      if (!ok) badFormat += 1;
    }
    failIf(badFormat > 0, `${badFormat} representative rows have invalid values`);

    // 3·4·7·8·9 — 읽기 전용 연결 (쓰기 전)
    let confirmedBefore: Map<string, number>;
    let snapshotsBefore: number;
    const ro = openSqlite(dbFile, true);
    try {
      failIf(!schemaMatches(ro), 'database schema does not match the repository migrations');
      const ledger = ro.prepare('SELECT 1 AS present FROM import_ledger WHERE kind = ?').get(LEDGER_KIND);
      failIf(ledger !== undefined, 'already migrated (import ledger row exists)');
      const targetIds = [...new Set(reps.map((rep) => rep.gameId))];
      const missingGames = targetIds.filter(
        (id) => ro.prepare("SELECT 1 FROM games WHERE platform = 'steam' AND external_id = ?").get(id) === undefined,
      );
      failIf(missingGames.length > 0, `games missing for ids: ${listIds(missingGames)}`);
      const existingRows = ro
        .prepare(
          `SELECT id, external_id AS gameId, observed_at AS observedAt, observed_day AS observedDay,
                  total_minutes AS totalMinutes, is_review AS isReview
             FROM playtime_snapshots WHERE platform = 'steam' ORDER BY external_id, id`,
        )
        .all() as { id: number; gameId: string; observedAt: number; observedDay: string; totalMinutes: number; isReview: number }[];
      const byGame = new Map<string, (SnapPoint & { id: number })[]>();
      const existingDays = new Set<string>();
      for (const row of existingRows) {
        const list = byGame.get(row.gameId) ?? [];
        list.push({ id: row.id, observedAt: row.observedAt, totalMinutes: row.totalMinutes, isReview: row.isReview === 1 });
        byGame.set(row.gameId, list);
        existingDays.add(`${row.gameId} ${row.observedDay}`);
      }
      const noSnapshots = targetIds.filter((id) => (byGame.get(id)?.length ?? 0) === 0);
      failIf(noSnapshots.length > 0, `games without existing snapshots: ${listIds(noSnapshots)}`);
      const clashes = reps.filter((rep) => existingDays.has(`${rep.gameId} ${days.get(rep)}`));
      failIf(clashes.length > 0, `existing snapshot on the same day for ids: ${listIds(clashes.map((r) => r.gameId))}`);
      const tzMismatch = (
        ro.prepare('SELECT COUNT(*) AS n FROM playtime_snapshots WHERE timezone <> ?').get(args.tz) as { n: number }
      ).n;
      failIf(tzMismatch > 0, `${tzMismatch} existing snapshots have a different timezone than --tz`);
      const problems = checkChains(reps, byGame);
      const names = { a: 'earlier-than-existing', b: 'negative-or-spike', c: 'confirmed-minutes-changed' } as const;
      failIf(
        problems.length > 0,
        `chain check failed: ${problems.map((p) => `${p.gameId}(${names[p.rule]})`).join(', ')}`,
      );
      snapshotsBefore = (ro.prepare('SELECT COUNT(*) AS n FROM playtime_snapshots').get() as { n: number }).n;
    } finally {
      ro.close();
    }

    // 사전 검사 9(c) — 앱 listLibrary로 임시 트랜잭션 확인(무조건 ROLLBACK). 백업보다 먼저.
    const confirmedCheck = checkConfirmedMinutes(dbFile, reps, days, args.tz);
    failIf(
      confirmedCheck.changed.length > 0,
      `chain check failed: ${confirmedCheck.changed.map((id) => `${id}(confirmed-minutes-changed)`).join(', ')}`,
    );
    confirmedBefore = confirmedCheck.before;

    // 백업 — 실패면 쓰기 0
    const now = new Date();
    try {
      await (hooks.backup ?? backupDatabase)(realDir, now);
    } catch (error) {
      throw new Fail(`backup failed: ${describeError(error, scrubList)}`);
    }
    const backupName = backupFileName(now);
    failIf(!existsSync(join(realDir, BACKUP_DIR_NAME, backupName)), 'backup file was not created');

    // 단일 트랜잭션
    const runAtSeconds = Math.floor(now.getTime() / 1000);
    const rw = openSqlite(dbFile, false);
    try {
      rw.pragma('foreign_keys = ON');
      rw.exec('BEGIN IMMEDIATE');
      try {
        insertRepresentatives(rw, reps, days, args.tz);
        hooks.afterSnapshotsInsert?.(rw);
        const droppedCount = kept.length - reps.length;
        rw.prepare(
          `INSERT INTO import_ledger (kind, source_ref, kept_count, dropped_count, first_run_at, last_run_at, rerun_blocked)
           VALUES (?, ?, ?, ?, ?, ?, 1)`,
        ).run(LEDGER_KIND, LEDGER_SOURCE_REF, reps.length, droppedCount, runAtSeconds, runAtSeconds);
        hooks.afterLedgerInsert?.(rw);
        const violations = rw.prepare('SELECT * FROM pragma_foreign_key_check').all();
        failIf(violations.length > 0, `foreign key violations: ${violations.length}`);
        hooks.beforeCommit?.();
        // 10(iii) COMMIT 직전
        failIf(!sameDigest(sourceDigest(args), digestBefore), 'source files changed before commit');
        rw.exec('COMMIT');
        committed = {
          backupName,
          ledgerLine: `ledger kind=${LEDGER_KIND} source_ref=${LEDGER_SOURCE_REF} kept=${reps.length} dropped=${droppedCount} first_run_at=${runAtSeconds} last_run_at=${runAtSeconds} rerun_blocked=1`,
        };
      } catch (error) {
        try {
          rw.exec('ROLLBACK');
        } catch {
          /* 원본 오류를 유지한다 */
        }
        throw error;
      }
    } finally {
      rw.close();
    }

    // COMMIT 이후 — 실패는 종료 코드 3(적용됨·후속 실패)
    try {
      hooks.afterCommit?.();
      const digestAfter = sourceDigest(args);
      failIf(!sameDigest(digestAfter, digestBefore), 'source files changed after commit');
      const verify = openSqlite(dbFile, true);
      let snapshotsAfter: number;
      const confirmedAfter = new Map<string, number>();
      try {
        snapshotsAfter = (verify.prepare('SELECT COUNT(*) AS n FROM playtime_snapshots').get() as { n: number }).n;
        for (const [id, value] of confirmedFromLibrary(verify, [...confirmedBefore.keys()])) confirmedAfter.set(id, value);
      } finally {
        verify.close();
      }
      const report = {
        applied: true,
        backupName,
        representativeRows: reps.length,
        excludedRows: kept.length - reps.length,
        representativeGames: confirmedBefore.size,
        observedDays: [...new Set(days.values())].sort(),
        snapshotsBefore,
        snapshotsAfter,
        games: [...confirmedBefore.entries()]
          .sort((a, b) => (a[0] < b[0] ? -1 : 1))
          .map(([gameId, before]) => ({ gameId, confirmedBefore: before, confirmedAfter: confirmedAfter.get(gameId) ?? null })),
        sourceSha256Before: digestBefore,
        sourceSha256After: digestAfter,
      };
      (hooks.writeReport ?? ((path: string, text: string) => writeFileSync(path, text, 'utf8')))(
        args.out,
        `${JSON.stringify(report)}\n`,
      );
      stdout.push(
        `applied: snapshots ${snapshotsBefore} -> ${snapshotsAfter}, games ${confirmedBefore.size}, days ${report.observedDays.join(',')}`,
        `backup: ${backupName}`,
      );
      return { code: 0, stdout, stderr };
    } catch (error) {
      stderr.push(
        'APPLIED (database committed; a follow-up step failed — decide on rollback)',
        (committed as { ledgerLine: string }).ledgerLine,
        `backup: ${backupName}`,
        `follow-up failure: ${describeError(error, scrubList)}`,
      );
      return { code: 3, stdout, stderr };
    }
  } catch (error) {
    if (committed !== null) {
      const done = committed as { backupName: string; ledgerLine: string };
      stderr.push('APPLIED (database committed; a follow-up step failed — decide on rollback)', done.ledgerLine, `backup: ${done.backupName}`, `failure: ${describeError(error, scrubList)}`);
      return { code: 3, stdout, stderr };
    }
    stderr.push(`not applied: ${describeError(error, scrubList)}`);
    return { code: 1, stdout, stderr };
  }
}

// ---------------------------------------------------------------------------
// --rollback
// ---------------------------------------------------------------------------

export interface RollbackArgs {
  dataDir: string;
  backup: string;
}

export interface RollbackHooks {
  copy?: (source: string, target: string) => void;
}

function integrityOk(db: Db): boolean {
  const rows = db.pragma('integrity_check') as { integrity_check: string }[];
  return rows.length === 1 && rows[0].integrity_check === 'ok';
}

/** 읽기 전용으로 열었다 닫으면서 생긴 보조 파일(-wal·-shm)만 지운다. 열기 전에 없던 것이 대상이다. */
function openReadonlyChecked<T>(file: string, use: (db: Db) => T): T {
  const aux = [`${file}-wal`, `${file}-shm`];
  const had = aux.map((path) => existsSync(path));
  const db = openSqlite(file, true);
  try {
    return use(db);
  } finally {
    db.close();
    aux.forEach((path, ix) => {
      if (!had[ix] && existsSync(path)) rmSync(path, { force: true });
    });
  }
}

export async function runRollback(args: RollbackArgs, hooks: RollbackHooks = {}): Promise<Outcome> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const scrubList = [args.dataDir];
  const moved: { from: string; to: string }[] = [];
  let dbFile = '';
  let phase: 'pre' | 'moved' = 'pre';
  try {
    failIf(!existsSync(args.dataDir), 'data folder does not exist');
    const realDir = realpathSync(args.dataDir);
    scrubList.push(realDir);
    dbFile = join(realDir, DB_FILE_NAME);

    // ① 소유 잠금
    try {
      acquireOwnerLock(realDir);
    } catch (error) {
      if (isOwnerLockBusy(error)) {
        stderr.push(OWNER_LOCK_BUSY_MESSAGE, 'stop the server on port 4800 first, then retry; nothing was moved');
        return { code: 1, stdout, stderr };
      }
      throw new Fail(OWNER_LOCK_UNAVAILABLE_MESSAGE);
    }

    // ② 백업 검증 — 현재 DB는 아직 건드리지 않는다
    failIf(
      args.backup === '' || args.backup === '.' || args.backup === '..' || basename(args.backup) !== args.backup || args.backup.includes('\\'),
      '--backup must be a file name inside the backups folder',
    );
    const backupFile = join(realDir, BACKUP_DIR_NAME, args.backup);
    failIf(!existsSync(backupFile) || !statSync(backupFile).isFile(), 'backup file not found');
    const backupSha = sha256Buffer(backupFile);
    try {
      openReadonlyChecked(backupFile, (db) => {
        failIf(!integrityOk(db), 'backup integrity_check failed');
        failIf(!schemaMatches(db), 'backup schema does not match the repository migrations');
      });
    } catch (error) {
      if (error instanceof Fail) throw error;
      throw new Fail(`backup could not be verified: ${describeError(error, scrubList)}`);
    }
    failIf(sha256Buffer(backupFile) !== backupSha, 'backup file changed while verifying');

    // ③ 현재 DB·-wal·-shm 격리 이동 (삭제 0)
    const isolatedName = `.rollback-d14-${utcTag(new Date())}`;
    const isolatedDir = join(realDir, isolatedName);
    mkdirSync(isolatedDir);
    phase = 'moved';
    for (const suffix of ['', '-wal', '-shm']) {
      const from = `${dbFile}${suffix}`;
      if (existsSync(from)) {
        const to = join(isolatedDir, `${DB_FILE_NAME}${suffix}`);
        renameSync(from, to);
        moved.push({ from, to });
      }
    }

    // ④ 백업 복사 + 검증
    (hooks.copy ?? copyFileSync)(backupFile, dbFile);
    failIf(sha256Buffer(dbFile) !== backupSha, 'restored copy differs from the backup');
    openReadonlyChecked(dbFile, (db) => failIf(!integrityOk(db), 'restored copy integrity_check failed'));
    failIf(sha256Buffer(dbFile) !== backupSha, 'restored copy changed while verifying');

    // ⑥ 성공 — 격리 폴더 보존
    stdout.push(`rolled back from backup: ${args.backup}`, `previous database kept in: ${isolatedName}`);
    return { code: 0, stdout, stderr };
  } catch (error) {
    if (phase === 'moved') {
      // ⑤ 복사본 제거 후 격리 파일 원위치
      const problems: string[] = [];
      for (const suffix of ['', '-wal', '-shm']) {
        try {
          rmSync(`${dbFile}${suffix}`, { force: true });
        } catch {
          problems.push(`could not remove restored ${DB_FILE_NAME}${suffix}`);
        }
      }
      for (const item of moved) {
        try {
          renameSync(item.to, item.from);
        } catch {
          problems.push(`could not move back ${basename(item.to)} (left in the isolation folder)`);
        }
      }
      stderr.push(
        `rollback failed: ${describeError(error, scrubList)}`,
        problems.length === 0 ? 'original files were put back' : `problems: ${problems.join('; ')}`,
        'DO NOT RESTART the server until the data folder state is checked',
      );
      return { code: 1, stdout, stderr };
    }
    stderr.push(`rollback not started: ${describeError(error, scrubList)}`);
    return { code: 1, stdout, stderr };
  }
}

// ---------------------------------------------------------------------------
// 진입점
// ---------------------------------------------------------------------------

function parseNamed(argv: string[], names: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of names) {
    const ix = argv.indexOf(name);
    if (ix < 0 || ix + 1 >= argv.length || argv[ix + 1].startsWith('--')) {
      throw new Error(`필수 인자 없음: ${name}`);
    }
    out[name] = argv[ix + 1];
  }
  return out;
}

function parseApplyArgs(argv: string[]): ApplyArgs {
  const v = parseNamed(argv, [
    '--data-dir', '--history', '--cache', '--library', '--tz', '--out', '--expect-history-sha', '--expect-rows',
  ]);
  if (!/^\d+$/.test(v['--expect-rows'])) throw new Error('--expect-rows must be a non-negative integer');
  return {
    dataDir: v['--data-dir'],
    history: v['--history'],
    cache: v['--cache'],
    library: v['--library'],
    tz: v['--tz'],
    out: v['--out'],
    expectHistorySha: v['--expect-history-sha'],
    expectRows: Number(v['--expect-rows']),
  };
}

function emit(outcome: Outcome): void {
  for (const line of outcome.stdout) console.log(line);
  for (const line of outcome.stderr) console.error(line);
  process.exitCode = outcome.code;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const rollback = argv.includes('--rollback');
  if (apply && rollback) throw new Error('--apply and --rollback cannot be combined');
  if (apply) {
    let parsed: ApplyArgs;
    try {
      parsed = parseApplyArgs(argv);
    } catch (error) {
      console.error(describeError(error));
      process.exitCode = 1;
      return;
    }
    emit(await runApply(parsed));
    return;
  }
  if (rollback) {
    let parsed: RollbackArgs;
    try {
      const v = parseNamed(argv, ['--data-dir', '--backup']);
      parsed = { dataDir: v['--data-dir'], backup: v['--backup'] };
    } catch (error) {
      console.error(describeError(error));
      process.exitCode = 1;
      return;
    }
    emit(await runRollback(parsed));
    return;
  }
  const args = parseArgs(argv);
  const report = dryRun(args);
  writeFileSync(args.out, `${JSON.stringify(report)}\n`, 'utf8');
}

const IS_ENTRY =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith('migrate-r1-once.ts') || process.argv[1].endsWith('migrate-r1-once.js'));

if (IS_ENTRY) {
  try {
    await main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

export function tmpReportDir(): string {
  return mkdtempSync(join(tmpdir(), 'questail-d14-zolu-'));
}
