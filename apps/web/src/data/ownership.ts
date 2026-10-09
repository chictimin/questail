import type Database from 'better-sqlite3';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { NormalizedOwnedGame, OwnedVerdict } from '@questail/core';
import { games, ownershipSpans, playtimeSnapshots } from '../db/schema.js';

/** 관측값 주입. 시계는 호출 측이 준다. */
export interface OwnedClock {
  observedAt: number;
  observedDay: string;
  timezone: string;
}

export interface OwnedGameInput extends NormalizedOwnedGame {
  /** appinfo 제공 이름. 없으면 null 저장한다(P-4, v1.3). */
  name?: string;
}

export interface ApplyOwnedInput {
  /** D03 판정 결과. ok가 아니면 원장을 보존하고 쓰지 않는다. */
  verdict: OwnedVerdict;
  /** D03 정규화 결과. 이름은 appinfo 제공분 그대로 쓴다. */
  games: OwnedGameInput[];
  clock: OwnedClock;
  syncRunId: number | null;
  isFirstCollection: boolean;
}

export interface ApplyOwnedResult {
  outcome: 'ok' | 'held-time-zero' | 'skipped-verdict';
  spansOpened: number;
  spansClosed: number;
}

function gameKey(platform: string, externalId: string): string {
  return `${platform} ${externalId}`;
}

/**
 * 보유 차분 적용. 구간·스냅샷·검토를 한 트랜잭션에 쓴다.
 * 별점·화면상태는 수집이 덮어쓰지 않는다.
 */
export function applyOwnedDiff(db: Database.Database, input: ApplyOwnedInput): ApplyOwnedResult {
  if (input.verdict.kind !== 'ok') {
    return { outcome: 'skipped-verdict', spansOpened: 0, spansClosed: 0 };
  }
  const apply = db.transaction(() => {
    const orm = drizzle(db);
    const openRows = orm.select().from(ownershipSpans).where(eq(ownershipSpans.ended, 0)).all();
    const openByKey = new Map(openRows.map((row) => [gameKey(row.platform, row.externalId), row]));
    const seenKeys = new Set<string>();

    let spansOpened = 0;
    let spansClosed = 0;
    for (const game of input.games) {
      const externalId = String(game.appid);
      const key = gameKey('steam', externalId);
      seenKeys.add(key);
      if (!openByKey.has(key)) {
        ensureGameRow(orm, externalId, game.name);
        orm
          .insert(ownershipSpans)
          .values({
            platform: 'steam',
            externalId,
            origin: input.isFirstCollection ? 'baseline' : 'observed',
            startedAt: input.clock.observedAt,
            ended: 0,
            endedAt: null,
            isBaseline: input.isFirstCollection ? 1 : 0,
            syncRunId: input.syncRunId,
          })
          .run();
        spansOpened += 1;
      }
    }
    for (const [key, row] of openByKey) {
      if (!seenKeys.has(key)) {
        orm
          .update(ownershipSpans)
          .set({ ended: 1, endedAt: input.clock.observedAt })
          .where(eq(ownershipSpans.id, row.id))
          .run();
        spansClosed += 1;
      }
    }

    const timeHeld = isTimeZeroHold(orm, input.games);
    return {
      outcome: timeHeld ? ('held-time-zero' as const) : ('ok' as const),
      spansOpened,
      spansClosed,
    };
  });
  return apply();
}

type Orm = ReturnType<typeof drizzle>;

/**
 * 게임 행 보장. 이름은 제공분 그대로 쓰고, 없으면 null이다(P-4, v1.3).
 * 후속 실이름 수신 시 원문으로 덮어쓴다. 자리 표시자·대체 문자열 없음.
 */
function ensureGameRow(orm: Orm, externalId: string, name: string | undefined): void {
  const existing = orm
    .select({ name: games.name })
    .from(games)
    .where(and(eq(games.platform, 'steam'), eq(games.externalId, externalId)))
    .get();
  if (!existing) {
    orm.insert(games).values({ platform: 'steam', externalId, name: name ?? null }).run();
  } else if (existing.name === null && name !== undefined) {
    orm
      .update(games)
      .set({ name })
      .where(and(eq(games.platform, 'steam'), eq(games.externalId, externalId)))
      .run();
  }
}

/** 전건 시간 0 판정. 응답 전부가 0인데 직전 확인 누적 >0인 게임이 있으면 시간만 보류한다. */
function isTimeZeroHold(orm: Orm, responseGames: NormalizedOwnedGame[]): boolean {
  if (!responseGames.every((game) => game.playtimeForever === 0)) {
    return false;
  }
  const rows = orm
    .select({
      externalId: playtimeSnapshots.externalId,
      total: playtimeSnapshots.totalMinutes,
      at: playtimeSnapshots.observedAt,
    })
    .from(playtimeSnapshots)
    .where(eq(playtimeSnapshots.platform, 'steam'))
    .all();
  const latestByGame = new Map<string, { total: number; at: number }>();
  for (const row of rows) {
    const prev = latestByGame.get(row.externalId);
    if (!prev || row.at >= prev.at) {
      latestByGame.set(row.externalId, { total: row.total, at: row.at });
    }
  }
  return responseGames.some((game) => (latestByGame.get(String(game.appid))?.total ?? 0) > 0);
}

