import type Database from 'better-sqlite3';
import { and, asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type {
  CollectSource,
  GameFacts,
  ReviewObservation,
  SourceStatus,
  SyncErrorCode,
  SyncRun,
  WishlistSpanFact,
} from '@questail/core';
import { games, syncRuns, wishlistSpans } from '../db/schema.js';
import { listLibrary } from './library.js';
import { listReviewObservations } from './playtime.js';

/**
 * 읽기 계약 구현 (D-12). 조립은 재사용만 한다.
 * recap·TBTI 집계 대상은 보유 구간 게임(열림+닫힘)이다.
 * 범위 계약 미정의, 리드 지시: 찜 전용 게임은 포함하지 않는다.
 */
export function listGameFacts(db: Database.Database): GameFacts[] {
  return listLibrary(db, { includeEnded: true });
}

export function listArchivedReviewObservations(db: Database.Database): ReviewObservation[] {
  return listReviewObservations(db);
}

/**
 * 찜 구간 낱건 (PM #81872). 모든 게임의 찜 구간을 id 순으로 낸다(호출자가 거름).
 * 정렬 계약 미정의. NULL 의미 유지(observedAt null=찜 유지 중).
 */
export function listWishlistSpans(db: Database.Database): WishlistSpanFact[] {
  const orm = drizzle(db);
  return orm
    .select({
      platform: wishlistSpans.platform,
      externalId: wishlistSpans.externalId,
      name: games.name,
      titleKo: games.titleKo,
      dateAdded: wishlistSpans.dateAdded,
      firstObservedAt: wishlistSpans.firstObservedAt,
      priority: wishlistSpans.priority,
      observedAt: wishlistSpans.observedAt,
      ended: wishlistSpans.ended,
      syncRunId: wishlistSpans.syncRunId,
    })
    .from(wishlistSpans)
    .leftJoin(
      games,
      and(eq(games.platform, wishlistSpans.platform), eq(games.externalId, wishlistSpans.externalId)),
    )
    .orderBy(asc(wishlistSpans.id))
    .all()
    .map((row) => ({
      key: { platform: row.platform, externalId: row.externalId },
      name: row.name,
      titleKo: row.titleKo,
      dateAdded: row.dateAdded,
      firstObservedAt: row.firstObservedAt,
      priority: row.priority,
      observedAt: row.observedAt,
      ended: row.ended === 1,
      syncRunId: row.syncRunId,
    }));
}

/** sync_runs 단건 읽기. 없으면 null이다. */
export function getSyncRun(db: Database.Database, id: number): SyncRun | null {
  const orm = drizzle(db);
  const row = orm.select().from(syncRuns).where(eq(syncRuns.id, id)).get();
  if (!row) return null;
  let issue: SyncRun['issue'] = null;
  if (row.issueCode !== null) {
    let params: Record<string, string | number> = {};
    if (row.issueParams !== null) {
      try {
        const parsed: unknown = JSON.parse(row.issueParams);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          params = parsed as Record<string, string | number>;
        }
      } catch {
        params = {};
      }
    }
    issue = { code: row.issueCode as SyncErrorCode, params };
  }
  return {
    id: row.id,
    source: row.source as CollectSource,
    status: row.status as SourceStatus,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    itemCount: row.itemCount,
    observedDay: row.observedDay,
    isFinalized: row.isFinalized === 1,
    issue,
  };
}
