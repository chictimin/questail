import type Database from 'better-sqlite3';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { WishlistVerdict } from '@questail/core';
import { games, wishlistSpans } from '../db/schema.js';

export interface ApplyWishlistInput {
  /** D03 판정 결과. ok가 아니면 원장을 보존하고 쓰지 않는다. */
  verdict: WishlistVerdict;
  /** 항목별 이름. 찜 응답에 이름이 없어 호출 측이 appinfo분으로 채운다. */
  names: Record<number, string>;
  observedAt: number;
  syncRunId: number | null;
}

export interface ApplyWishlistResult {
  outcome: 'ok' | 'skipped-verdict';
  spansOpened: number;
  spansClosed: number;
}

/**
 * 찜 차분 적용. 한 트랜잭션에 쓴다.
 * 찜 전용 게임 행도 만든다(이름은 호출 측 제공분 그대로).
 */
export function applyWishlistDiff(
  db: Database.Database,
  input: ApplyWishlistInput,
): ApplyWishlistResult {
  if (input.verdict.kind !== 'ok') {
    return { outcome: 'skipped-verdict', spansOpened: 0, spansClosed: 0 };
  }
  const items = input.verdict.items;
  const apply = db.transaction(() => {
    const orm = drizzle(db);
    const openRows = orm.select().from(wishlistSpans).where(eq(wishlistSpans.ended, 0)).all();
    const openByKey = new Map(openRows.map((row) => [`${row.platform} ${row.externalId}`, row]));
    const seenKeys = new Set<string>();

    let spansOpened = 0;
    let spansClosed = 0;
    for (const item of items) {
      const externalId = String(item.appid);
      const key = `steam ${externalId}`;
      seenKeys.add(key);
      if (!openByKey.has(key)) {
        const existing = orm
          .select({ name: games.name })
          .from(games)
          .where(and(eq(games.platform, 'steam'), eq(games.externalId, externalId)))
          .get();
        if (!existing) {
          const name = input.names[item.appid];
          orm.insert(games).values({ platform: 'steam', externalId, name: name ?? null }).run();
        } else if (existing.name === null) {
          const name = input.names[item.appid];
          if (name !== undefined) {
            orm
              .update(games)
              .set({ name })
              .where(and(eq(games.platform, 'steam'), eq(games.externalId, externalId)))
              .run();
          }
        }
        orm
          .insert(wishlistSpans)
          .values({
            platform: 'steam',
            externalId,
            dateAdded: item.dateAdded,
            firstObservedAt: input.observedAt,
            priority: item.priority,
            observedAt: null,
            ended: 0,
            syncRunId: input.syncRunId,
          })
          .run();
        spansOpened += 1;
      }
    }
    for (const [key, row] of openByKey) {
      if (!seenKeys.has(key)) {
        orm
          .update(wishlistSpans)
          .set({ ended: 1, observedAt: input.observedAt })
          .where(eq(wishlistSpans.id, row.id))
          .run();
        spansClosed += 1;
      }
    }
    return { outcome: 'ok' as const, spansOpened, spansClosed };
  });
  return apply();
}
