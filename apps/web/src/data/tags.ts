import type Database from 'better-sqlite3';
import type { SteamSpyTagsResult } from '@questail/core';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { gameUserTags, tagSources } from '../db/schema.js';
import type { GameKey } from './ratings.js';
export interface SaveCollectedTagsOptions {
  /** 수집 시각, epoch 초. */
  observedAt: number;
  syncRunId: number | null;
}

/**
 * 수집 태그 저장 1건 (D-17b). 태그+상태를 한 트랜잭션에 쓴다.
 * ready면 게임 태그 통째 교체(rank 1~10) + ready,
 * empty면 태그행 삭제 + empty,
 * failed면 태그 보존 + failed(observed_at 갱신).
 * failed면 fail_reason(필수)·fail_status(http일 때만) 기록, ready·empty면 둘 다 NULL. 과거 행은 건드리지 않는다.
 */
export function saveCollectedTags(
  db: Database.Database,
  key: GameKey,
  result: SteamSpyTagsResult,
  opts: SaveCollectedTagsOptions,
): { status: 'ready' | 'empty' | 'failed' } {
  const failReason: string | null =
    result.status === 'failed' ? result.failure.reason : null;
  const failStatus: number | null =
    result.status === 'failed' && result.failure.reason === 'http'
      ? result.failure.status
      : null;
  const apply = db.transaction((): 'ready' | 'empty' | 'failed' => {
    const orm = drizzle(db);
    const tagCond = and(
      eq(gameUserTags.platform, key.platform),
      eq(gameUserTags.externalId, key.externalId),
    );
    if (result.status !== 'failed') {
      orm.delete(gameUserTags).where(tagCond).run();
    }
    if (result.status === 'ready') {
      result.tags.forEach((entry, index) => {
        orm
          .insert(gameUserTags)
          .values({
            platform: key.platform,
            externalId: key.externalId,
            tag: entry.tag,
            votes: entry.votes,
            rank: index + 1,
            observedAt: opts.observedAt,
            syncRunId: opts.syncRunId,
          })
          .run();
      });
    }
    const sourceCond = and(
      eq(tagSources.platform, key.platform),
      eq(tagSources.externalId, key.externalId),
    );
    const existing = orm
      .select({ platform: tagSources.platform })
      .from(tagSources)
      .where(sourceCond)
      .get();
    if (existing) {
      orm
        .update(tagSources)
        .set({
          tagStatus: result.status,
          observedAt: opts.observedAt,
          syncRunId: opts.syncRunId,
          failReason,
          failStatus,
        })
        .where(sourceCond)
        .run();
    } else {
      orm
        .insert(tagSources)
        .values({
          platform: key.platform,
          externalId: key.externalId,
          tagStatus: result.status,
          observedAt: opts.observedAt,
          syncRunId: opts.syncRunId,
          failReason,
          failStatus,
        })
        .run();
    }
    return result.status;
  });
  return { status: apply() };
}
