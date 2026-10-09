import type Database from 'better-sqlite3';
import { and, eq } from 'drizzle-orm';
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

/** C-4 GameFacts 후속 port 원천. 필요한 분까지만 둔다. */
export interface GameFacts {
  key: GameKey;
  name: string | null;
  titleKo: string | null;
  developerRaw: string | null;
  releaseDate: number | null;
  releaseDateText: string | null;
  genres: { genreId: string; nameEn: string; nameKo: string | null }[];
  coverUrl: string | null;
  hidden: boolean;
  libraryAddedAt: number | null;
  confirmedMinutes: number;
  lastPlayed: number | null;
  snapshots: {
    observedAt: number;
    observedDay: string;
    totalMinutes: number;
    deltaMinutes: number | null;
    elapsedSeconds: number | null;
    isReview: boolean;
  }[];
  deltas: { observedAt: number; deltaMinutes: number; elapsedSeconds: number }[];
  coverage: {
    firstObservedAt: number | null;
    lastObservedAt: number | null;
    gapDays: string[];
    isBaseline: boolean;
  };
  ownership: {
    origin: 'observed' | 'baseline' | 'imported';
    startedAt: number | null;
    ended: boolean;
    endedAt: number | null;
    isBaseline: boolean;
    syncRunId: number | null;
  }[];
  wishlist: {
    dateAdded: number | null;
    firstObservedAt: number;
    priority: number | null;
    observedAt: number | null;
    ended: boolean;
    syncRunId: number | null;
  }[];
  tags: { tag: string; votes: number; rank: number }[];
  tagStatus: 'ready' | 'empty' | 'failed' | 'not_collected';
  achievements: { apiname: string; achieved: boolean; unlockedAt: number | null }[];
  achievementState: 'disabled' | 'failed' | 'not_collected' | 'empty' | 'ready';
  latestScore: number | null;
  ratingEvents: { id: number; before: number | null; after: number | null; at: number }[];
  syncRunRefs: number[];
}

type Db = ReturnType<typeof drizzle>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KeyedTable = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  platform: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  externalId: any;
};

function rowsByKey<T>(db: Db, table: KeyedTable, key: GameKey): T[] {
  return db
    .select()
    .from(table as never)
    .where(and(eq(table.platform, key.platform), eq(table.externalId, key.externalId)))
    .all() as T[];
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

function buildFacts(db: Database.Database, game: typeof games.$inferSelect): GameFacts {
  const key: GameKey = { platform: game.platform, externalId: game.externalId };
  const orm = drizzle(db);
  const byKey = <T>(table: KeyedTable): T[] => rowsByKey<T>(orm, table, key);

  const genreRows = (byKey(gameGenres) as typeof gameGenres.$inferSelect[]).sort(
    (a, b) => a.position - b.position,
  );
  const ownRows = byKey(ownershipSpans) as typeof ownershipSpans.$inferSelect[];
  const wishRows = byKey(wishlistSpans) as typeof wishlistSpans.$inferSelect[];
  const snapRows = (byKey(playtimeSnapshots) as typeof playtimeSnapshots.$inferSelect[]).sort(
    (a, b) => a.observedAt - b.observedAt,
  );
  const tagRows = (byKey(gameUserTags) as typeof gameUserTags.$inferSelect[]).sort(
    (a, b) => a.rank - b.rank,
  );
  const tagSource = (byKey(tagSources) as typeof tagSources.$inferSelect[])[0];
  const achRows = byKey(achievements) as typeof achievements.$inferSelect[];
  const achState = (byKey(achievementStates) as typeof achievementStates.$inferSelect[])[0];
  const rating = (
    byKey(ratings) as typeof ratings.$inferSelect[]
  )[0];
  const ratingEventRows = byKey(ratingEvents) as typeof ratingEvents.$inferSelect[];
  const isHidden =
    (byKey(hiddenGames) as typeof hiddenGames.$inferSelect[]).length > 0;
  const achievementOff =
    orm
      .select({ value: preferences.value })
      .from(preferences)
      .where(eq(preferences.key, 'achievement_enabled'))
      .get()?.value !== '1';

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
  const out: GameFacts[] = [];
  for (const game of allGames) {
    const spans = orm
      .select({ ended: ownershipSpans.ended })
      .from(ownershipSpans)
      .where(
        and(
          eq(ownershipSpans.platform, game.platform),
          eq(ownershipSpans.externalId, game.externalId),
        ),
      )
      .all();
    if (spans.length === 0) continue;
    if (!opts.includeEnded && !spans.some((row) => row.ended === 0)) continue;
    out.push(buildFacts(db, game));
  }
  return out;
}
