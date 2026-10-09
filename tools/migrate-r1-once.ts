/**
 * tools/migrate-r1-once.ts — D-14 캡틴 전용 1회 이관 도구 (워커 A 소유).
 *
 * 이번 범위: dry-run 모드만. 원본 읽기 + 임시 리포트 쓰기만 한다.
 * DB 열기·쓰기 0, 원본 쓰기·이동·삭제·재생성 0.
 * 실제 이관(DB 쓰기·ledger·백업)은 캡틴 승인 후 별도다.
 *
 * 실행:
 *   pnpm tsx tools/migrate-r1-once.ts --history <path> --cache <dir> --library <path> --tz <IANA> --out <path>
 *
 * 리포트는 대표 행 수·제외 행 수·제외 사유별 건수·과거 보유 구간 후보 수·
 * 원본 sha256(실행 전후 동일 확인)만 담는다. 판단하지 않는다.
 */

import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
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
