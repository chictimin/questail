import type Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { hiddenGames, preferences, viewSortState } from '../db/schema.js';

/** 화면 상태. C-4 Prefs와 같은 모양이다. */
export interface Prefs {
  locale: 'ko' | 'en';
  hidden: { platform: string; externalId: string }[];
  sortPerFilter: { filterKey: string; sortKey: string; direction: 'asc' | 'desc' }[];
}

/** 로케일 기본값 제안. 브라우저 판정은 호출 측(B)이 fallback으로 넘긴다. */
export type LocaleFallback = 'ko' | 'en';

function readPref(db: Database.Database, key: string): string | null {
  const row = drizzle(db)
    .select({ value: preferences.value })
    .from(preferences)
    .where(eq(preferences.key, key))
    .get();
  return row ? row.value : null;
}

function writePref(db: Database.Database, key: string, value: string): void {
  const orm = drizzle(db);
  const now = Math.floor(Date.now() / 1000);
  const existing = orm
    .select({ key: preferences.key })
    .from(preferences)
    .where(eq(preferences.key, key))
    .get();
  if (existing) {
    orm.update(preferences).set({ value, updatedAt: now }).where(eq(preferences.key, key)).run();
  } else {
    orm.insert(preferences).values({ key, value, updatedAt: now }).run();
  }
}

/** 화면 상태 읽기. 저장된 값만 읽는다. 미저장 로케일은 호출 측 fallback(B 브라우저 판정)을 그대로 쓴다. */
export function getPrefs(db: Database.Database, fallback: LocaleFallback): Prefs {
  const locale = readPref(db, 'locale');
  const hidden = drizzle(db)
    .select({ platform: hiddenGames.platform, externalId: hiddenGames.externalId })
    .from(hiddenGames)
    .all();
  const sortPerFilter = drizzle(db)
    .select({
      filterKey: viewSortState.filterKey,
      sortKey: viewSortState.sortKey,
      direction: viewSortState.direction,
    })
    .from(viewSortState)
    .all()
    .map((row) => ({
      filterKey: row.filterKey,
      sortKey: row.sortKey,
      direction: row.direction === 'desc' ? ('desc' as const) : ('asc' as const),
    }));
  return {
    locale: locale === 'en' ? 'en' : locale === 'ko' ? 'ko' : fallback,
    hidden,
    sortPerFilter,
  };
}

/**
 * 화면 상태 부분 갱신. 준 필드만 원자 갱신하고 객체 전체 읽기-수정-쓰기를 하지 않는다.
 * 숨김 집합은 전체 교체(호출 측이 최종 집합을 준다).
 */
export function setPrefs(
  db: Database.Database,
  patch: Partial<{
    locale: 'ko' | 'en';
    hidden: { platform: string; externalId: string }[];
    sortPerFilter: { filterKey: string; sortKey: string; direction: 'asc' | 'desc' }[];
  }>,
): void {
  if (patch.locale !== undefined) {
    writePref(db, 'locale', patch.locale);
  }
  if (patch.hidden !== undefined) {
    const orm = drizzle(db);
    orm.delete(hiddenGames).run();
    for (const game of patch.hidden) {
      orm
        .insert(hiddenGames)
        .values({ platform: game.platform, externalId: game.externalId, hiddenAt: Math.floor(Date.now() / 1000) })
        .run();
    }
  }
  if (patch.sortPerFilter !== undefined) {
    const orm = drizzle(db);
    for (const entry of patch.sortPerFilter) {
      const existing = orm
        .select({ filterKey: viewSortState.filterKey })
        .from(viewSortState)
        .where(eq(viewSortState.filterKey, entry.filterKey))
        .get();
      if (existing) {
        orm
          .update(viewSortState)
          .set({ sortKey: entry.sortKey, direction: entry.direction })
          .where(eq(viewSortState.filterKey, entry.filterKey))
          .run();
      } else {
        orm.insert(viewSortState).values(entry).run();
      }
    }
  }
}

/** 업적 수집 옵션 읽기. 행 없음 = OFF. */
export function getAchievementSettings(db: Database.Database): { enabled: boolean } {
  return { enabled: readPref(db, 'achievement_enabled') === '1' };
}

/** 업적 수집 옵션 쓰기. */
export function setAchievementSettings(db: Database.Database, value: { enabled: boolean }): void {
  writePref(db, 'achievement_enabled', value.enabled ? '1' : '0');
}
