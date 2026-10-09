import type Database from 'better-sqlite3';
import { and, desc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { checkpoints, ownershipSpans, preferences, syncRuns, wishlistSpans } from '../db/schema.js';
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

function targetGames(
  db: Database.Database,
  source: CollectSource,
): { platform: string; externalId: string }[] {
  if (source === 'wishlist') return openGames(db, wishlistSpans);
  return openGames(db, ownershipSpans);
}
