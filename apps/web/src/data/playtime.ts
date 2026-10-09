import type Database from 'better-sqlite3';
import { and, asc, desc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { playtimeSnapshots, reviewObservations } from '../db/schema.js';
import type { GameKey } from './ratings.js';

export interface RecordSnapshotInput {
  /** UTC 관측 시각, epoch 초. */
  observedAt: number;
  /** 로컬 관측일 YYYY-MM-DD. 같은 날은 첫 성공 1행만 둔다(U-3). */
  observedDay: string;
  timezone: string;
  /** Steam 원시 누적, 분. 보존한다. */
  totalMinutes: number;
  lastPlayed: number | null;
  playtime2Weeks?: number | null;
  syncRunId: number | null;
}

export type RecordSnapshotOutcome = 'recorded' | 'review' | 'same_day';

export interface RecordSnapshotResult {
  outcome: RecordSnapshotOutcome;
  id: number;
  kind?: 'negative_clamped' | 'spike';
}

export interface ReviewObservation {
  id: number;
  key: GameKey;
  observedAt: number;
  kind: 'negative_clamped' | 'spike';
  deltaMinutes: number;
  elapsedSeconds: number;
  prevObservedAt: number | null;
  syncRunId: number | null;
}

/**
 * 스냅샷 기록 1건 (D-10). 직전 관측 대비 증감을 계산한다.
 * 음수면 0 절삭 + negative_clamped 관측 + is_review,
 * 증가분 > 경과분(UTC 초/60, 같으면 정상)이면 spike 관측 + is_review.
 * review_observations.delta_minutes는 절삭 전 값이다.
 * 같은 날 기존 행이 있으면 삽입·관측 없이 same_day를 내고 기존 행을 둔다.
 */
export function recordPlaytimeSnapshot(
  db: Database.Database,
  key: GameKey,
  input: RecordSnapshotInput,
): RecordSnapshotResult {
  return db.transaction((): RecordSnapshotResult => {
    const orm = drizzle(db);
    const keyCond = and(
      eq(playtimeSnapshots.platform, key.platform),
      eq(playtimeSnapshots.externalId, key.externalId),
    );
    const sameDay = orm
      .select({ id: playtimeSnapshots.id })
      .from(playtimeSnapshots)
      .where(and(keyCond, eq(playtimeSnapshots.observedDay, input.observedDay)))
      .get();
    if (sameDay) return { outcome: 'same_day', id: sameDay.id };
    const prev = orm
      .select({
        observedAt: playtimeSnapshots.observedAt,
        totalMinutes: playtimeSnapshots.totalMinutes,
      })
      .from(playtimeSnapshots)
      .where(keyCond)
      .orderBy(desc(playtimeSnapshots.observedAt), desc(playtimeSnapshots.id))
      .get();
    const insertSnapshot = (isReview: 0 | 1, reviewReason: 'negative_clamped' | 'spike' | null): number => {
      const inserted = orm
        .insert(playtimeSnapshots)
        .values({
          platform: key.platform,
          externalId: key.externalId,
          observedAt: input.observedAt,
          observedDay: input.observedDay,
          timezone: input.timezone,
          totalMinutes: input.totalMinutes,
          lastPlayed: input.lastPlayed,
          playtime2weeks: input.playtime2Weeks ?? null,
          isReview,
          reviewReason,
          syncRunId: input.syncRunId,
        })
        .returning({ id: playtimeSnapshots.id })
        .get();
      return inserted.id;
    };
    if (!prev) {
      return { outcome: 'recorded', id: insertSnapshot(0, null) };
    }
    const deltaMinutes = input.totalMinutes - prev.totalMinutes;
    const elapsedSeconds = input.observedAt - prev.observedAt;
    const kind =
      deltaMinutes < 0 ? 'negative_clamped' : deltaMinutes > elapsedSeconds / 60 ? 'spike' : null;
    if (kind === null) {
      return { outcome: 'recorded', id: insertSnapshot(0, null) };
    }
    const id = insertSnapshot(1, kind);
    orm
      .insert(reviewObservations)
      .values({
        platform: key.platform,
        externalId: key.externalId,
        observedAt: input.observedAt,
        kind,
        deltaMinutes,
        elapsedSeconds,
        prevObservedAt: prev.observedAt,
        syncRunId: input.syncRunId,
      })
      .run();
    return { outcome: 'review', id, kind };
  })();
}

/** 검토 대기 목록 (F-5: 확인 목록이 아님). 관측 시각·id 순. */
export function listReviewObservations(db: Database.Database): ReviewObservation[] {
  const orm = drizzle(db);
  return orm
    .select()
    .from(reviewObservations)
    .orderBy(asc(reviewObservations.observedAt), asc(reviewObservations.id))
    .all()
    .map((row) => ({
      id: row.id,
      key: { platform: row.platform, externalId: row.externalId },
      observedAt: row.observedAt,
      kind: row.kind as 'negative_clamped' | 'spike',
      deltaMinutes: row.deltaMinutes,
      elapsedSeconds: row.elapsedSeconds,
      prevObservedAt: row.prevObservedAt,
      syncRunId: row.syncRunId,
    }));
}
