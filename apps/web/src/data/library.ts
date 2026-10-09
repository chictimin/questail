import type Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import {
  achievementStates,
  achievements,
  games,
  gameGenres,
  gameUserTags,
  hiddenGames,
  ownershipSpans,
  playtimeSnapshots,
  preferences,
  ratingEvents,
  ratings,
  tagSources,
  wishlistSpans,
} from '../db/schema.js';
import type { GameKey } from './ratings.js';
import type { GameFacts } from '@questail/core';

export type { GameFacts };

function keyOf(platform: string, externalId: string): string {
  return JSON.stringify([platform, externalId]);
}

/** 집합 조회 1건을 게임 키별로 묶는다. 그룹 안 순서는 행 삽입 순(rowid)을 유지한다. */
function groupByKey<T extends { platform: string; externalId: string }>(rows: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const k = keyOf(row.platform, row.externalId);
    const list = out.get(k);
    if (list) list.push(row);
    else out.set(k, [row]);
  }
  return out;
}

interface GameGroups {
  genreRows: (typeof gameGenres.$inferSelect)[];
  ownRows: (typeof ownershipSpans.$inferSelect)[];
  wishRows: (typeof wishlistSpans.$inferSelect)[];
  snapRows: (typeof playtimeSnapshots.$inferSelect)[];
  tagRows: (typeof gameUserTags.$inferSelect)[];
  tagSource: typeof tagSources.$inferSelect | undefined;
  achRows: (typeof achievements.$inferSelect)[];
  achState: typeof achievementStates.$inferSelect | undefined;
  rating: typeof ratings.$inferSelect | undefined;
  ratingEventRows: (typeof ratingEvents.$inferSelect)[];
  isHidden: boolean;
}

function toOrigin(value: string): 'observed' | 'baseline' | 'imported' {
  return value === 'baseline' || value === 'imported' ? value : 'observed';
}

function toTagStatus(value: string | undefined): GameFacts['tagStatus'] {
  return value === 'ready' || value === 'empty' || value === 'failed' ? value : 'not_collected';
}

function toAchievementState(value: string | undefined): Exclude<GameFacts['achievementState'], 'disabled'> {
  return value === 'ready' || value === 'empty' || value === 'failed' ? value : 'not_collected';
}

function gapDays(days: string[]): string[] {
  if (days.length < 2) return [];
  const seen = new Set(days);
  const [first, last] = [days[0], days[days.length - 1]];
  const out: string[] = [];
  const cursor = new Date(`${first}T00:00:00Z`);
  const end = new Date(`${last}T00:00:00Z`);
  for (;;) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (cursor > end) break;
    const day = cursor.toISOString().slice(0, 10);
    if (day !== last && !seen.has(day)) out.push(day);
  }
  return out;
}

function buildFacts(
  game: typeof games.$inferSelect,
  g: GameGroups,
  achievementOff: boolean,
): GameFacts {
  const key: GameKey = { platform: game.platform, externalId: game.externalId };

  const genreRows = [...g.genreRows].sort((a, b) => a.position - b.position);
  const ownRows = g.ownRows;
  const wishRows = g.wishRows;
  const snapRows = [...g.snapRows].sort((a, b) => a.observedAt - b.observedAt);
  const tagRows = [...g.tagRows].sort((a, b) => a.rank - b.rank);
  const tagSource = g.tagSource;
  const achRows = g.achRows;
  const achState = g.achState;
  const rating = g.rating;
  const ratingEventRows = g.ratingEventRows;
  const isHidden = g.isHidden;

  const snapshots = snapRows.map((row, index) => {
    const prev = index === 0 ? null : snapRows[index - 1];
    return {
      observedAt: row.observedAt,
      observedDay: row.observedDay,
      totalMinutes: row.totalMinutes,
      deltaMinutes: prev ? row.totalMinutes - prev.totalMinutes : null,
      elapsedSeconds: prev ? row.observedAt - prev.observedAt : null,
      isReview: row.isReview === 1,
    };
  });
  const baselineTotal = snapRows.length > 0 ? snapRows[0].totalMinutes : 0;
  const deltas = snapshots
    .filter((s) => !s.isReview && s.deltaMinutes !== null && s.elapsedSeconds !== null)
    .map((s) => ({
      observedAt: s.observedAt,
      deltaMinutes: Math.max(0, s.deltaMinutes as number),
      elapsedSeconds: s.elapsedSeconds as number,
    }));
  const confirmedMinutes =
    baselineTotal + deltas.reduce((sum, d) => sum + d.deltaMinutes, 0);

  const days = snapRows.map((row) => row.observedDay).sort();
  const ownership = ownRows.map((row) => ({
    origin: toOrigin(row.origin),
    startedAt: row.startedAt,
    ended: row.ended === 1,
    endedAt: row.endedAt,
    isBaseline: row.isBaseline === 1,
    syncRunId: row.syncRunId,
  }));
  const openSpan = ownRows.find((row) => row.ended === 0);
  const fallbackSpan = [...ownRows].sort((a, b) => (b.startedAt ?? -1) - (a.startedAt ?? -1))[0];
  const addedSpan = openSpan ?? fallbackSpan;
  const libraryAddedAt =
    !addedSpan || addedSpan.startedAt === null || addedSpan.origin !== 'observed'
      ? null
      : addedSpan.startedAt;

  const syncRunRefs = new Set<number>();
  for (const row of [...ownRows, ...wishRows, ...snapRows, ...ratingEventRows]) {
    if (row.syncRunId !== null && row.syncRunId !== undefined) syncRunRefs.add(row.syncRunId);
  }

  return {
    key,
    name: game.name,
    titleKo: game.titleKo,
    developerRaw: game.developerRaw,
    releaseDate: game.releaseDate,
    releaseDateText: game.releaseDateText,
    genres: genreRows.map((row) => ({
      genreId: row.genreId,
      nameEn: row.genreNameEn,
      nameKo: row.genreNameKo,
    })),
    coverUrl: game.coverUrl,
    hidden: isHidden,
    libraryAddedAt,
    confirmedMinutes,
    lastPlayed: snapRows.length > 0 ? snapRows[snapRows.length - 1].lastPlayed : null,
    snapshots,
    deltas,
    coverage: {
      firstObservedAt: snapRows.length > 0 ? snapRows[0].observedAt : null,
      lastObservedAt: snapRows.length > 0 ? snapRows[snapRows.length - 1].observedAt : null,
      gapDays: gapDays(days),
      isBaseline: ownRows.some((row) => row.isBaseline === 1),
    },
    ownership,
    wishlist: wishRows.map((row) => ({
      dateAdded: row.dateAdded,
      firstObservedAt: row.firstObservedAt,
      priority: row.priority,
      observedAt: row.observedAt,
      ended: row.ended === 1,
      syncRunId: row.syncRunId,
    })),
    tags: tagRows.map((row) => ({ tag: row.tag, votes: row.votes, rank: row.rank })),
    tagStatus: toTagStatus(tagSource?.tagStatus),
    achievements: achRows.map((row) => ({
      apiname: row.apiname,
      achieved: row.achieved === 1,
      unlockedAt: row.unlockedAt,
    })),
    achievementState: achievementOff ? 'disabled' : toAchievementState(achState?.state),
    latestScore: rating ? rating.score : null,
    ratingEvents: ratingEventRows.map((row) => ({
      id: row.id,
      before: row.beforeScore,
      after: row.afterScore,
      at: row.createdAt,
    })),
    syncRunRefs: [...syncRunRefs].sort((a, b) => a - b),
  };
}

/**
 * 라이브러리 목록. 정렬하지 않는다(I-1). C-1 필드를 전부 싣는다.
 * includeEnded 거짓이면 열린 보유 구간 게임만, 참이면 보유 구간 있는 게임 전부.
 */
export function listLibrary(
  db: Database.Database,
  opts: { includeEnded: boolean },
): GameFacts[] {
  const orm = drizzle(db);
  const allGames = orm.select().from(games).all();
  const spansByKey = groupByKey(orm.select().from(ownershipSpans).all());
  const included = allGames.filter((game) => {
    const spans = spansByKey.get(keyOf(game.platform, game.externalId)) ?? [];
    if (spans.length === 0) return false;
    if (!opts.includeEnded && !spans.some((row) => row.ended === 0)) return false;
    return true;
  });
  const keep = new Set(included.map((game) => keyOf(game.platform, game.externalId)));
  const scoped = <T extends { platform: string; externalId: string }>(rows: T[]): Map<string, T[]> => {
    const out = new Map<string, T[]>();
    for (const row of rows) {
      const k = keyOf(row.platform, row.externalId);
      if (!keep.has(k)) continue;
      const list = out.get(k);
      if (list) list.push(row);
      else out.set(k, [row]);
    }
    return out;
  };
  const genresByKey = scoped(orm.select().from(gameGenres).all());
  const wishByKey = scoped(orm.select().from(wishlistSpans).all());
  const snapsByKey = scoped(orm.select().from(playtimeSnapshots).all());
  const tagsByKey = scoped(orm.select().from(gameUserTags).all());
  const tagSourcesByKey = scoped(orm.select().from(tagSources).all());
  const achByKey = scoped(orm.select().from(achievements).all());
  const achStatesByKey = scoped(orm.select().from(achievementStates).all());
  const ratingsByKey = scoped(orm.select().from(ratings).all());
  const ratingEventsByKey = scoped(orm.select().from(ratingEvents).all());
  const hiddenByKey = scoped(orm.select().from(hiddenGames).all());
  const achievementOff =
    orm
      .select({ value: preferences.value })
      .from(preferences)
      .where(eq(preferences.key, 'achievement_enabled'))
      .get()?.value !== '1';
  const empty: never[] = [];
  return included.map((game) => {
    const k = keyOf(game.platform, game.externalId);
    const at = <T>(m: Map<string, T[]>): T[] => m.get(k) ?? (empty as T[]);
    const first = <T>(m: Map<string, T[]>): T | undefined => m.get(k)?.[0];
    return buildFacts(
      game,
      {
        genreRows: at(genresByKey),
        ownRows: spansByKey.get(k) ?? [],
        wishRows: at(wishByKey),
        snapRows: at(snapsByKey),
        tagRows: at(tagsByKey),
        tagSource: first(tagSourcesByKey),
        achRows: at(achByKey),
        achState: first(achStatesByKey),
        rating: first(ratingsByKey),
        ratingEventRows: at(ratingEventsByKey),
        isHidden: (hiddenByKey.get(k)?.length ?? 0) > 0,
      },
      achievementOff,
    );
  });
}
