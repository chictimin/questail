import type Database from 'better-sqlite3';
import type { GameMeta, MetaFetchResult } from '@questail/core';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { gameGenres, games, metaStates } from '../db/schema.js';
import type { GameKey } from './ratings.js';

export interface SaveCollectedMetaOptions {
  /** 수집 표시 locale. titleKo·장르 언어 칸 갱신 기준(P-9) */
  locale: 'ko' | 'en';
  /** 수집 시각, epoch 초. */
  observedAt: number;
  syncRunId: number | null;
}

type Orm = ReturnType<typeof drizzle>;

/** ISO(YYYY-MM-DD) → UTC 자정 epoch 초. 파싱 불가면 null이다. */
function isoToUtcDayEpoch(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(ms)) return null;
  return Math.floor(ms / 1000);
}

/**
 * 수집 메타 저장 1건. 한 게임 = 한 트랜잭션에 쓴다.
 * failed면 games·game_genres 보존 + meta_states만 기록한다.
 * empty면 games 보존 + 장르행 삭제 + empty를 기록한다.
 * 응답에 없는 필드는 기존값을 보존하고, 있던 필드(빈 배열 포함)는 반영한다.
 */
export function saveCollectedMeta(
  db: Database.Database,
  key: GameKey,
  result: MetaFetchResult,
  opts: SaveCollectedMetaOptions,
): void {
  const apply = db.transaction(() => {
    const orm = drizzle(db);
    const gameCond = and(eq(games.platform, key.platform), eq(games.externalId, key.externalId));
    const existing = orm.select().from(games).where(gameCond).get();
    if (!existing) {
      throw new Error('saveCollectedMeta: games 행 없음 — 숨은 생성 금지');
    }
    upsertMetaState(orm, key, result.state, opts);
    if (result.state === 'failed') return;
    applyGameFields(orm, key, result.meta, opts);
    applyGenres(orm, key, result, opts);
  });
  apply();
}

function upsertMetaState(
  orm: Orm,
  key: GameKey,
  state: MetaFetchResult['state'],
  opts: SaveCollectedMetaOptions,
): void {
  const cond = and(eq(metaStates.platform, key.platform), eq(metaStates.externalId, key.externalId));
  const prev = orm.select({ platform: metaStates.platform }).from(metaStates).where(cond).get();
  if (prev) {
    orm
      .update(metaStates)
      .set({ state, observedAt: opts.observedAt, syncRunId: opts.syncRunId })
      .where(cond)
      .run();
  } else {
    orm
      .insert(metaStates)
      .values({
        platform: key.platform,
        externalId: key.externalId,
        state,
        observedAt: opts.observedAt,
        syncRunId: opts.syncRunId,
      })
      .run();
  }
}

function applyGameFields(
  orm: Orm,
  key: GameKey,
  meta: GameMeta,
  opts: SaveCollectedMetaOptions,
): void {
  const gameCond = and(eq(games.platform, key.platform), eq(games.externalId, key.externalId));
  const patch: Partial<typeof games.$inferInsert> = {};
  // name은 en 응답일 때만 갱신한다. ko 응답 이름(현지화 가능)은
  // titleKo로만 쓰고 owned 영문 정본을 덮지 않는다(PM #85427).
  if (opts.locale === 'en' && meta.name !== undefined) patch.name = meta.name;
  if (opts.locale === 'ko' && meta.nameKo !== undefined) patch.titleKo = meta.nameKo;
  if (meta.headerImage !== undefined) patch.coverUrl = meta.headerImage;
  if (meta.developers !== undefined) patch.developerRaw = JSON.stringify(meta.developers);
  if (meta.releaseDateRaw !== undefined) patch.releaseDateText = meta.releaseDateRaw;
  if (meta.releaseDate !== undefined) {
    const epoch = isoToUtcDayEpoch(meta.releaseDate);
    if (epoch !== null) patch.releaseDate = epoch;
  }
  if (Object.keys(patch).length > 0) {
    orm.update(games).set(patch).where(gameCond).run();
  }
}

function genreCond(key: GameKey): ReturnType<typeof and> {
  return and(eq(gameGenres.platform, key.platform), eq(gameGenres.externalId, key.externalId));
}

function applyGenres(
  orm: Orm,
  key: GameKey,
  result: MetaFetchResult,
  opts: SaveCollectedMetaOptions,
): void {
  const cond = genreCond(key);
  if (result.state === 'empty') {
    orm.delete(gameGenres).where(cond).run();
    return;
  }
  const rows = orm.select().from(gameGenres).where(cond).all();
  const byId = new Map(rows.map((row) => [row.genreId, row]));
  const seen = new Set<string>();
  const list = result.meta.genres ?? [];
  list.forEach((genre, index) => {
    seen.add(genre.id);
    const prev = byId.get(genre.id);
    if (opts.locale === 'en') {
      const values = {
        platform: key.platform,
        externalId: key.externalId,
        genreId: genre.id,
        genreNameEn: genre.name,
        genreNameKo: prev?.genreNameKo ?? null,
        position: index,
        observedAt: opts.observedAt,
        syncRunId: opts.syncRunId,
      };
      if (prev) {
        orm
          .update(gameGenres)
          .set(values)
          .where(and(cond, eq(gameGenres.genreId, genre.id)))
          .run();
      } else {
        orm.insert(gameGenres).values(values).run();
      }
    } else {
      // ko: 받은 언어 칸(nameKo)만 갱신, en 칸은 기존값 보존.
      // 첫 수집(en 없음) 행은 genre_name_en NULL로 만든다 — 0003 nullable 전제(C 선행).
      // ko 응답에 한국어값이 없으면(nameKo null) 기존 ko값 보존(P-9).
      const values = {
        platform: key.platform,
        externalId: key.externalId,
        genreId: genre.id,
        genreNameEn: prev?.genreNameEn ?? null,
        genreNameKo: genre.nameKo ?? prev?.genreNameKo ?? null,
        position: index,
        observedAt: opts.observedAt,
        syncRunId: opts.syncRunId,
      };
      if (prev) {
        orm
          .update(gameGenres)
          .set(values)
          .where(and(cond, eq(gameGenres.genreId, genre.id)))
          .run();
      } else {
        orm.insert(gameGenres).values(values).run();
      }
    }
  });
  for (const row of rows) {
    if (!seen.has(row.genreId)) {
      orm
        .delete(gameGenres)
        .where(and(cond, eq(gameGenres.genreId, row.genreId)))
        .run();
    }
  }
}
