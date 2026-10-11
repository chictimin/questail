import type Database from 'better-sqlite3';
import type { AchievementVerdict, NormalizedAchievement } from '@questail/core';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { achievementStates, achievements } from '../db/schema.js';
import type { GameKey } from './ratings.js';

export interface CollectedAchievement {
  apiname: string;
  achieved: boolean;
  unlockedAt: number | null;
}

/** 수집 판정 결과. 403 계정단은 executor 소스 실패가 맡고 게임 저장에 넣지 않는다. */
export type CollectedAchievements =
  | { status: 'ready'; achievements: CollectedAchievement[] }
  | { status: 'empty' }
  | { status: 'failed' };

export interface SaveCollectedAchievementsOptions {
  /** 수집 시각, epoch 초. */
  observedAt: number;
  syncRunId: number | null;
}

/**
 * D-03 판정+정규화 → 저장 입력 순수 변환 (D-11).
 * skipGame은 empty 저장이다(리드 해석: 35행 empty=확인했는데 없음.
 * 저장 0이면 not_collected와 구별 불가). failSource·failGame은 변환 대상이 아니다.
 */
export function toCollectedAchievements(
  verdict: Exclude<AchievementVerdict, { kind: 'failSource' | 'failGame' }>,
  normalized: NormalizedAchievement[],
): CollectedAchievements {
  if (verdict.kind === 'skipGame') return { status: 'empty' };
  if (verdict.kind !== 'ok') {
    throw new RangeError('failSource·failGame is not convertible (executor handles them)');
  }
  if (normalized.length === 0) return { status: 'empty' };
  return {
    status: 'ready',
    achievements: normalized.map((entry) => ({
      apiname: entry.apiname,
      achieved: entry.achieved,
      unlockedAt: entry.unlockedAt,
    })),
  };
}

/**
 * 수집 업적 저장 1건 (D-11). 업적+상태를 한 트랜잭션에 쓴다.
 * ready면 게임 업적 통째 교체(미달성 포함) + ready,
 * empty면 업적행 삭제 + empty,
 * failed면 업적 보존 + failed(observed_at 갱신).
 */
export function saveCollectedAchievements(
  db: Database.Database,
  key: GameKey,
  result: CollectedAchievements,
  opts: SaveCollectedAchievementsOptions,
): { status: 'ready' | 'empty' | 'failed' } {
  const apply = db.transaction((): 'ready' | 'empty' | 'failed' => {
    const orm = drizzle(db);
    const achCond = and(
      eq(achievements.platform, key.platform),
      eq(achievements.externalId, key.externalId),
    );
    if (result.status !== 'failed') {
      orm.delete(achievements).where(achCond).run();
    }
    if (result.status === 'ready') {
      for (const entry of result.achievements) {
        orm
          .insert(achievements)
          .values({
            platform: key.platform,
            externalId: key.externalId,
            apiname: entry.apiname,
            achieved: entry.achieved ? 1 : 0,
            unlockedAt: entry.unlockedAt,
            observedAt: opts.observedAt,
            syncRunId: opts.syncRunId,
          })
          .run();
      }
    }
    const stateCond = and(
      eq(achievementStates.platform, key.platform),
      eq(achievementStates.externalId, key.externalId),
    );
    const existing = orm
      .select({ platform: achievementStates.platform })
      .from(achievementStates)
      .where(stateCond)
      .get();
    if (existing) {
      orm
        .update(achievementStates)
        .set({
          state: result.status,
          observedAt: opts.observedAt,
          syncRunId: opts.syncRunId,
        })
        .where(stateCond)
        .run();
    } else {
      orm
        .insert(achievementStates)
        .values({
          platform: key.platform,
          externalId: key.externalId,
          state: result.status,
          observedAt: opts.observedAt,
          syncRunId: opts.syncRunId,
        })
        .run();
    }
    return result.status;
  });
  return { status: apply() };
}
