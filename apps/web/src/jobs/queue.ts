import type Database from 'better-sqlite3';
import { and, desc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { checkpoints, metaStates, ownershipSpans, preferences, syncRuns, tagSources, achievementStates, wishlistSpans } from '../db/schema.js';
import type { CollectSource, Locale } from '../data/sync.js';

/** 항목 키. 게임 키 + 소스별 식별자다. */
export function itemKey(platform: string, externalId: string, kind: string): string {
  return `${platform}:${externalId}:${kind}`;
}

/** 현 세대 완료 집합. */
export function readCheckpoints(
  db: Database.Database,
  generation: number,
  source: CollectSource,
): Set<string> {
  const rows = drizzle(db)
    .select({ itemKey: checkpoints.itemKey })
    .from(checkpoints)
    .where(and(eq(checkpoints.generation, generation), eq(checkpoints.source, source)))
    .all();
  return new Set(rows.map((row) => row.itemKey));
}

/** 항목 완료 기록. 같은 키 재기록은 무시된다. */
export function writeCheckpoint(
  db: Database.Database,
  input: { generation: number; source: CollectSource; itemKey: string; syncRunId: number | null; doneAt: number },
): void {
  const orm = drizzle(db);
  const existing = orm
    .select({ itemKey: checkpoints.itemKey })
    .from(checkpoints)
    .where(
      and(
        eq(checkpoints.generation, input.generation),
        eq(checkpoints.source, input.source),
        eq(checkpoints.itemKey, input.itemKey),
      ),
    )
    .get();
  if (!existing) {
    orm.insert(checkpoints).values(input).run();
  }
}

const LAST_COLLECT_LOCALE_KEY = 'last_collect_locale';

function isLocale(value: string): value is Locale {
  return value === 'ko' || value === 'en';
}

/** cron 마지막 사용자 수집 locale. 없으면 null이다. */
export function readLastCollectLocale(db: Database.Database): Locale | null {
  const row = drizzle(db)
    .select({ value: preferences.value })
    .from(preferences)
    .where(eq(preferences.key, LAST_COLLECT_LOCALE_KEY))
    .get();
  return row && isLocale(row.value) ? row.value : null;
}

/** cron 마지막 사용자 수집 locale 기록. */
export function writeLastCollectLocale(db: Database.Database, locale: Locale): void {
  const orm = drizzle(db);
  const now = Math.floor(Date.now() / 1000);
  const existing = orm
    .select({ key: preferences.key })
    .from(preferences)
    .where(eq(preferences.key, LAST_COLLECT_LOCALE_KEY))
    .get();
  if (existing) {
    orm.update(preferences).set({ value: locale, updatedAt: now }).where(eq(preferences.key, LAST_COLLECT_LOCALE_KEY)).run();
  } else {
    orm.insert(preferences).values({ key: LAST_COLLECT_LOCALE_KEY, value: locale, updatedAt: now }).run();
  }
}

function openGames(
  db: Database.Database,
  table: typeof ownershipSpans | typeof wishlistSpans,
): { platform: string; externalId: string }[] {
  const orm = drizzle(db);
  if (table === ownershipSpans) {
    return orm
      .select({ platform: ownershipSpans.platform, externalId: ownershipSpans.externalId })
      .from(ownershipSpans)
      .where(eq(ownershipSpans.ended, 0))
      .all();
  }
  return orm
    .select({ platform: wishlistSpans.platform, externalId: wishlistSpans.externalId })
    .from(wishlistSpans)
    .where(eq(wishlistSpans.ended, 0))
    .all();
}

/**
 * 보충 큐 (COL-3). 현 세대 미완료 항목만 낸다.
 * owned·wishlist는 응답 단위('*'), meta·steamspy·achievements는 게임 단위다.
 * 소스 최신 run이 failed·held(미복구)면 빈 큐다(재수집 전까지 보충 없음).
 */
export function buildQueue(
  db: Database.Database,
  input: { source: CollectSource; generation: number; mode: 'resume' | 'refresh' },
): string[] {
  const latest = drizzle(db)
    .select({ status: syncRuns.status })
    .from(syncRuns)
    .where(eq(syncRuns.source, input.source))
    .orderBy(desc(syncRuns.id))
    .get();
  if (latest && (latest.status === 'failed' || latest.status === 'held')) return [];
  if (input.mode === 'refresh') {
    if (input.source === 'owned' || input.source === 'wishlist') return ['*'];
    return targetGames(db, input.source).map(
      (game) => itemKey(game.platform, game.externalId, input.source),
    );
  }
  const done = readCheckpoints(db, input.generation, input.source);
  if (input.source === 'owned' || input.source === 'wishlist') {
    return done.has('*') ? [] : ['*'];
  }
  return targetGames(db, input.source)
    .map((game) => itemKey(game.platform, game.externalId, input.source))
    .filter((key) => !done.has(key));
}

/** 열린 구간 합집합. 중복 제거한다. */
function openUnion(
  db: Database.Database,
): { platform: string; externalId: string }[] {
  const seen = new Set<string>();
  const out: { platform: string; externalId: string }[] = [];
  for (const game of [...openGames(db, ownershipSpans), ...openGames(db, wishlistSpans)]) {
    const k = `${game.platform}:${game.externalId}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(game);
  }
  return out;
}

function targetGames(
  db: Database.Database,
  source: CollectSource,
): { platform: string; externalId: string }[] {
  if (source === 'wishlist') return openGames(db, wishlistSpans);
  if (source === 'meta') return openUnion(db);
  if (source === 'steamspy') return openUnion(db);
  if (source === 'achievements') return openGames(db, ownershipSpans);
  if (source === 'owned') return openGames(db, ownershipSpans);
  throw new RangeError(`보충 대상 미정의 소스: ${source}`);
}

/** 그 run에서 이미 failed인 게임 단위 항목 키 집합. recover 제외·remaining 계산용. */
export function failedKeysOfRun(
  db: Database.Database,
  source: CollectSource,
  runId: number,
): Set<string> {
  const orm = drizzle(db);
  const out = new Set<string>();
  if (source === 'meta') {
    const rows = orm
      .select({ platform: metaStates.platform, externalId: metaStates.externalId })
      .from(metaStates)
      .where(and(eq(metaStates.syncRunId, runId), eq(metaStates.state, 'failed')))
      .all();
    for (const row of rows) out.add(itemKey(row.platform, row.externalId, source));
  } else if (source === 'steamspy') {
    const rows = orm
      .select({ platform: tagSources.platform, externalId: tagSources.externalId })
      .from(tagSources)
      .where(and(eq(tagSources.syncRunId, runId), eq(tagSources.tagStatus, 'failed')))
      .all();
    for (const row of rows) out.add(itemKey(row.platform, row.externalId, source));
  } else if (source === 'achievements') {
    const rows = orm
      .select({ platform: achievementStates.platform, externalId: achievementStates.externalId })
      .from(achievementStates)
      .where(and(eq(achievementStates.syncRunId, runId), eq(achievementStates.state, 'failed')))
      .all();
    for (const row of rows) out.add(itemKey(row.platform, row.externalId, source));
  }
  return out;
}

/** meta 직전 결과가 failed인 게임인지. resume 항목별 bypass 판정용. */
export function isMetaFailed(db: Database.Database, platform: string, externalId: string): boolean {
  const row = drizzle(db)
    .select({ state: metaStates.state })
    .from(metaStates)
    .where(and(eq(metaStates.platform, platform), eq(metaStates.externalId, externalId)))
    .get();
  return row?.state === 'failed';
}

/**
 * run 집계 DB 재구성(C12-5·R12-1).
 * succeeded(run) = 그 소스 checkpoints.sync_run_id = runId 수(복사 행은 원본 runId라 제외).
 * failed(run) = 그 run 결과 행 중 failed 수.
 * remaining = 현 세대 미완료 큐 − failed(run) 항목. total = 셋의 합.
 */
export function runAggregates(
  db: Database.Database,
  input: { source: CollectSource; generation: number; mode: 'resume' | 'refresh'; runId: number },
): { succeeded: number; failed: number; remaining: number; total: number } {
  const succeeded = drizzle(db)
    .select({ itemKey: checkpoints.itemKey })
    .from(checkpoints)
    .where(and(eq(checkpoints.source, input.source), eq(checkpoints.syncRunId, input.runId)))
    .all().length;
  const failedKeys = failedKeysOfRun(db, input.source, input.runId);
  // 집계용 미완료 큐는 mode와 무관하게 현 세대 미완료(체크포인트 제외) 기준이다.
  // 실행 큐(buildQueue refresh = 전수)는 호출 측이 job.mode로 그대로 만든다.
  const queue = buildQueue(db, { source: input.source, generation: input.generation, mode: 'resume' });
  const remaining = queue.filter((key) => !failedKeys.has(key)).length;
  return { succeeded, failed: failedKeys.size, remaining, total: succeeded + failedKeys.size + remaining };
}
