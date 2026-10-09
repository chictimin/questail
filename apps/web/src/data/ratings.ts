import type Database from 'better-sqlite3';
import { and, desc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { ratingEvents, ratings } from '../db/schema.js';

/** 게임 키. C-3 복합 키와 같은 모양이다. */
export interface GameKey {
  platform: string;
  externalId: string;
}

/** 별점 저장값 1~10. 0.5 단위는 ×2 저장한다(I-2). */
export type ScoreValue = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export interface SetRatingResult {
  changed: boolean;
  eventId: number | null;
}

function isScoreValue(value: number): value is ScoreValue {
  return Number.isInteger(value) && value >= 1 && value <= 10;
}

/** 최신 별점 행. 없으면 null이다. */
export function getLatestScore(
  db: Database.Database,
  key: GameKey,
): { score: number; updatedAt: number } | null {
  const row = drizzle(db)
    .select({ score: ratings.score, updatedAt: ratings.updatedAt })
    .from(ratings)
    .where(and(eq(ratings.platform, key.platform), eq(ratings.externalId, key.externalId)))
    .get();
  return row ?? null;
}

/**
 * 별점 지정·취소 (I-2).
 * 실제 변경이 있을 때만 rating_events에 append하고 ratings를 갱신한다.
 * 같은 값 지정·이미 취소 상태의 취소는 no-op이다.
 */
export function setRating(
  db: Database.Database,
  key: GameKey,
  score: ScoreValue | null,
): SetRatingResult {
  if (score !== null && !isScoreValue(score)) {
    throw new RangeError('score는 1~10 정수 또는 null이다');
  }
  const orm = drizzle(db);
  const cond = and(eq(ratings.platform, key.platform), eq(ratings.externalId, key.externalId));
  const current = orm
    .select({ score: ratings.score })
    .from(ratings)
    .where(cond)
    .get();
  const now = Math.floor(Date.now() / 1000);

  if (score === null) {
    if (!current) {
      return { changed: false, eventId: null };
    }
    const [event] = orm
      .insert(ratingEvents)
      .values({
        platform: key.platform,
        externalId: key.externalId,
        beforeScore: current.score,
        afterScore: null,
        createdAt: now,
      })
      .returning({ id: ratingEvents.id })
      .all();
    orm.delete(ratings).where(cond).run();
    return { changed: true, eventId: event.id };
  }

  if (current && current.score === score) {
    return { changed: false, eventId: null };
  }
  const [event] = orm
    .insert(ratingEvents)
    .values({
      platform: key.platform,
      externalId: key.externalId,
      beforeScore: current ? current.score : null,
      afterScore: score,
      createdAt: now,
    })
    .returning({ id: ratingEvents.id })
    .all();
  if (current) {
    orm.update(ratings).set({ score, updatedAt: now }).where(cond).run();
  } else {
    orm
      .insert(ratings)
      .values({ platform: key.platform, externalId: key.externalId, score, updatedAt: now, updatedBy: 'user' })
      .run();
  }
  return { changed: true, eventId: event.id };
}

/** 최신 변경 시각. 평가일 정렬용. 현재 미평가면 null이다(계약 값 없음 맨 뒤). */
export function getLatestRatedAt(db: Database.Database, key: GameKey): number | null {
  const orm = drizzle(db);
  const cond = and(eq(ratings.platform, key.platform), eq(ratings.externalId, key.externalId));
  const current = orm.select({ score: ratings.score }).from(ratings).where(cond).get();
  if (!current) {
    return null;
  }
  const row = orm
    .select({ at: ratingEvents.createdAt })
    .from(ratingEvents)
    .where(and(eq(ratingEvents.platform, key.platform), eq(ratingEvents.externalId, key.externalId)))
    .orderBy(desc(ratingEvents.createdAt))
    .get();
  return row ? row.at : null;
}
