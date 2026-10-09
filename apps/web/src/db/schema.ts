/**
 * apps/web/src/db/schema.ts — R1 Drizzle 스키마 (D-01, 워커 A 소유).
 *
 * 동결본 `.roster/contract-r1-v1.0.md` C-1·C-1e 그대로(sha256 ac49e9bb1e9a).
 * 시각은 전부 UTC epoch(초), 로컬 날짜는 별도 컬럼. 게임 키는 전부
 * (platform, external_id) 복합. 삭제 CASCADE 없음.
 * 복합 FK는 무명 foreignKey 연산자 + `.onDelete('restrict')`로 정의한다.
 * 실제 소스(drizzle-orm 0.45.3 `sqlite-core/foreign-keys.d.ts`) 확인 결과
 * `UpdateDeleteAction`에 'restrict'가 있고 `ForeignKeyBuilder.onDelete`가
 * 있다. 문서 검색만으로 미지원이라 적은 earlier 주석은 정정한다.
 * FK 이름은 붙이지 않는다(drizzle-kit v1 푸시 차분 방지).
 * 부분 유일은 uniqueIndex + where.
 * `sync_generations` 5행 시딩은 범위 밖(D-02·수집).
 */

import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

/** 루트: 게임 정본. 장르 컬럼 없음 — game_genres 별도 */
export const games = sqliteTable(
  'games',
  {
    platform: text().notNull(),
    externalId: text('external_id').notNull(),
    name: text().notNull(),
    titleKo: text('title_ko'),
    developerRaw: text('developer_raw'),
    releaseDateText: text('release_date_text'),
    releaseDate: integer('release_date'),
    coverUrl: text('cover_url'),
  },
  (t) => [primaryKey({ columns: [t.platform, t.externalId] })],
);

/** appdetails 원문 장르 배열 보존. 게임 단위 원자 교체 */
export const gameGenres = sqliteTable(
  'game_genres',
  {
    platform: text().notNull(),
    externalId: text('external_id').notNull(),
    genreId: text('genre_id').notNull(),
    genreNameEn: text('genre_name_en').notNull(),
    genreNameKo: text('genre_name_ko'),
    position: integer().notNull(),
    observedAt: integer('observed_at').notNull(),
    syncRunId: integer('sync_run_id').references(() => syncRuns.id, {
      onDelete: 'restrict',
    }),
  },
  (t) => [
    primaryKey({ columns: [t.platform, t.externalId, t.genreId] }),
    foreignKey({
      columns: [t.platform, t.externalId],
      foreignColumns: [games.platform, games.externalId],
    }).onDelete('restrict'),
  ],
);

/** 보유 구간. started_at NULL = 시작 미상(이관, origin=imported) */
export const ownershipSpans = sqliteTable(
  'ownership_spans',
  {
    id: integer().primaryKey({ autoIncrement: true }),
    platform: text().notNull(),
    externalId: text('external_id').notNull(),
    origin: text().notNull(),
    startedAt: integer('started_at'),
    ended: integer().notNull(),
    endedAt: integer('ended_at'),
    isBaseline: integer('is_baseline').notNull(),
    syncRunId: integer('sync_run_id').references(() => syncRuns.id, {
      onDelete: 'restrict',
    }),
  },
  (t) => [
    unique().on(t.platform, t.externalId, t.startedAt),
    uniqueIndex('ownership_open_one').on(t.platform, t.externalId).where(sql`ended = 0`),
    uniqueIndex('ownership_null_start_one')
      .on(t.platform, t.externalId)
      .where(sql`started_at is null`),
    check('ownership_origin_values', sql`origin IN ('observed', 'baseline', 'imported')`),
    check('ownership_ended_values', sql`ended IN (0, 1)`),
    check('ownership_baseline_values', sql`is_baseline IN (0, 1)`),
    foreignKey({
      columns: [t.platform, t.externalId],
      foreignColumns: [games.platform, games.externalId],
    }).onDelete('restrict'),
  ],
);

/** 찜 구간. priority = 구간 단위 최신값 */
export const wishlistSpans = sqliteTable(
  'wishlist_spans',
  {
    id: integer().primaryKey({ autoIncrement: true }),
    platform: text().notNull(),
    externalId: text('external_id').notNull(),
    dateAdded: integer('date_added'),
    firstObservedAt: integer('first_observed_at').notNull(),
    priority: integer(),
    observedAt: integer('observed_at'),
    ended: integer().notNull(),
    syncRunId: integer('sync_run_id').references(() => syncRuns.id, {
      onDelete: 'restrict',
    }),
  },
  (t) => [
    unique().on(t.platform, t.externalId, t.firstObservedAt),
    uniqueIndex('wishlist_open_one').on(t.platform, t.externalId).where(sql`ended = 0`),
    check('wishlist_ended_values', sql`ended IN (0, 1)`),
    foreignKey({
      columns: [t.platform, t.externalId],
      foreignColumns: [games.platform, games.externalId],
    }).onDelete('restrict'),
  ],
);

/** 관측 스냅샷 append-only. 같은 날 첫 성공 1행(U-3) */
export const playtimeSnapshots = sqliteTable(
  'playtime_snapshots',
  {
    id: integer().primaryKey({ autoIncrement: true }),
    platform: text().notNull(),
    externalId: text('external_id').notNull(),
    observedAt: integer('observed_at').notNull(),
    observedDay: text('observed_day').notNull(),
    timezone: text().notNull(),
    totalMinutes: integer('total_minutes').notNull(),
    lastPlayed: integer('last_played'),
    playtime2weeks: integer('playtime_2weeks'),
    isReview: integer('is_review').notNull(),
    reviewReason: text('review_reason'),
    syncRunId: integer('sync_run_id').references(() => syncRuns.id, {
      onDelete: 'restrict',
    }),
  },
  (t) => [
    unique().on(t.platform, t.externalId, t.observedDay),
    check('snapshots_review_values', sql`is_review IN (0, 1)`),
    foreignKey({
      columns: [t.platform, t.externalId],
      foreignColumns: [games.platform, games.externalId],
    }).onDelete('restrict'),
  ],
);

/** 소스별 수집 실행. 공백 증거라 삭제 금지. 중복 실행 방지는 lock이 정본 */
export const syncRuns = sqliteTable(
  'sync_runs',
  {
    id: integer().primaryKey({ autoIncrement: true }),
    source: text().notNull(),
    status: text().notNull(),
    startedAt: integer('started_at').notNull(),
    finishedAt: integer('finished_at'),
    itemCount: integer('item_count'),
    observedDay: text('observed_day').notNull(),
    isFinalized: integer('is_finalized').notNull(),
    issueCode: text('issue_code'),
    issueParams: text('issue_params'),
  },
  (t) => [
    unique().on(t.source, t.startedAt),
    check('sync_runs_source_values', sql`source IN ('owned', 'wishlist', 'meta', 'achievements', 'steamspy')`),
    check('sync_runs_status_values', sql`status IN ('idle', 'running', 'ok', 'failed', 'held')`),
  ],
);

/** 소스별 현 세대. startSync 전체 수집은 5행 +1, resyncSource는 해당 소스만 +1 */
export const syncGenerations = sqliteTable('sync_generations', {
  source: text().primaryKey(),
  generation: integer().notNull(),
});

/** 최신 별점. 수집이 덮어쓰지 않는다. 행 없음 = 미평가 */
export const ratings = sqliteTable(
  'ratings',
  {
    platform: text().notNull(),
    externalId: text('external_id').notNull(),
    score: integer().notNull(),
    updatedAt: integer('updated_at').notNull(),
    updatedBy: text('updated_by').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.platform, t.externalId] }),
    check('ratings_score_range', sql`score BETWEEN 1 AND 10`),
    foreignKey({
      columns: [t.platform, t.externalId],
      foreignColumns: [games.platform, games.externalId],
    }).onDelete('restrict'),
  ],
);

/** 별점 변경 이력 append-only */
export const ratingEvents = sqliteTable(
  'rating_events',
  {
    id: integer().primaryKey({ autoIncrement: true }),
    platform: text().notNull(),
    externalId: text('external_id').notNull(),
    beforeScore: integer('before_score'),
    afterScore: integer('after_score'),
    createdAt: integer('created_at').notNull(),
    syncRunId: integer('sync_run_id').references(() => syncRuns.id, {
      onDelete: 'restrict',
    }),
  },
  (t) => [
    index('rating_events_game_created').on(t.platform, t.externalId, t.createdAt),
    check(
      'rating_events_before_range',
      sql`before_score IS NULL OR before_score BETWEEN 1 AND 10`,
    ),
    check(
      'rating_events_after_range',
      sql`after_score IS NULL OR after_score BETWEEN 1 AND 10`,
    ),
    foreignKey({
      columns: [t.platform, t.externalId],
      foreignColumns: [games.platform, games.externalId],
    }).onDelete('restrict'),
  ],
);

/** 업적(미달성 포함). 달성 정본 = achieved. 수집·보충 대상은 보유 구간 게임만(N-1) */
export const achievements = sqliteTable(
  'achievements',
  {
    platform: text().notNull(),
    externalId: text('external_id').notNull(),
    apiname: text().notNull(),
    achieved: integer().notNull(),
    unlockedAt: integer('unlocked_at'),
    observedAt: integer('observed_at').notNull(),
    syncRunId: integer('sync_run_id').references(() => syncRuns.id, {
      onDelete: 'restrict',
    }),
  },
  (t) => [
    primaryKey({ columns: [t.platform, t.externalId, t.apiname] }),
    check('achievements_achieved_values', sql`achieved IN (0, 1)`),
    foreignKey({
      columns: [t.platform, t.externalId],
      foreignColumns: [games.platform, games.externalId],
    }).onDelete('restrict'),
  ],
);

/** 게임별 업적 수집 결과. OFF 전역은 preferences */
export const achievementStates = sqliteTable(
  'achievement_states',
  {
    platform: text().notNull(),
    externalId: text('external_id').notNull(),
    state: text().notNull(),
    observedAt: integer('observed_at').notNull(),
    syncRunId: integer('sync_run_id').references(() => syncRuns.id, {
      onDelete: 'restrict',
    }),
  },
  (t) => [
    primaryKey({ columns: [t.platform, t.externalId] }),
    check(
      'achievement_states_values',
      sql`state IN ('ready', 'empty', 'failed', 'not_collected')`,
    ),
    foreignKey({
      columns: [t.platform, t.externalId],
      foreignColumns: [games.platform, games.externalId],
    }).onDelete('restrict'),
  ],
);

/** SteamSpy 태그 상위 10 + 투표 수. 게임 단위 원자 교체 */
export const gameUserTags = sqliteTable(
  'game_user_tags',
  {
    platform: text().notNull(),
    externalId: text('external_id').notNull(),
    tag: text().notNull(),
    votes: integer().notNull(),
    rank: integer().notNull(),
    observedAt: integer('observed_at').notNull(),
    syncRunId: integer('sync_run_id').references(() => syncRuns.id, {
      onDelete: 'restrict',
    }),
  },
  (t) => [
    primaryKey({ columns: [t.platform, t.externalId, t.tag] }),
    foreignKey({
      columns: [t.platform, t.externalId],
      foreignColumns: [games.platform, games.externalId],
    }).onDelete('restrict'),
  ],
);

/** 게임별 태그 수집 상태 */
export const tagSources = sqliteTable(
  'tag_sources',
  {
    platform: text().notNull(),
    externalId: text('external_id').notNull(),
    tagStatus: text('tag_status').notNull(),
    observedAt: integer('observed_at').notNull(),
    syncRunId: integer('sync_run_id').references(() => syncRuns.id, {
      onDelete: 'restrict',
    }),
  },
  (t) => [
    primaryKey({ columns: [t.platform, t.externalId] }),
    check(
      'tag_sources_values',
      sql`tag_status IN ('ready', 'empty', 'failed', 'not_collected')`,
    ),
    foreignKey({
      columns: [t.platform, t.externalId],
      foreignColumns: [games.platform, games.externalId],
    }).onDelete('restrict'),
  ],
);

/** 게임별 메타 수집 상태. 장르·커버 미보충 vs 없음 구분(D-07) */
export const metaStates = sqliteTable(
  'meta_states',
  {
    platform: text().notNull(),
    externalId: text('external_id').notNull(),
    state: text().notNull(),
    observedAt: integer('observed_at').notNull(),
    syncRunId: integer('sync_run_id').references(() => syncRuns.id, {
      onDelete: 'restrict',
    }),
  },
  (t) => [
    primaryKey({ columns: [t.platform, t.externalId] }),
    check(
      'meta_states_values',
      sql`state IN ('ready', 'empty', 'failed', 'not_collected')`,
    ),
    foreignKey({
      columns: [t.platform, t.externalId],
      foreignColumns: [games.platform, games.externalId],
    }).onDelete('restrict'),
  ],
);

/** 화면 상태·설정 키-값. 행 없음 = 기본값 */
export const preferences = sqliteTable('preferences', {
  key: text().primaryKey(),
  value: text().notNull(),
  updatedAt: integer('updated_at').notNull(),
});

/** 숨긴 게임 집합 */
export const hiddenGames = sqliteTable(
  'hidden_games',
  {
    platform: text().notNull(),
    externalId: text('external_id').notNull(),
    hiddenAt: integer('hidden_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.platform, t.externalId] }),
    foreignKey({
      columns: [t.platform, t.externalId],
      foreignColumns: [games.platform, games.externalId],
    }).onDelete('restrict'),
  ],
);

/** 필터별 마지막 정렬 */
export const viewSortState = sqliteTable('view_sort_state', {
  filterKey: text('filter_key').primaryKey(),
  sortKey: text('sort_key').notNull(),
  direction: text().notNull(),
});

/** 계정. id=1 고정 1행. 변경 입력은 거부 */
export const account = sqliteTable(
  'account',
  {
    id: integer().primaryKey(),
    steamId: text('steam_id'),
    createdAt: integer('created_at').notNull(),
  },
  () => [check('account_single_row', sql`id = 1`)],
);

/** 영속 체크포인트. 현 세대 행 = 커밋된 완료(COL-5) */
export const checkpoints = sqliteTable(
  'checkpoints',
  {
    generation: integer().notNull(),
    source: text().notNull(),
    itemKey: text('item_key').notNull(),
    doneAt: integer('done_at').notNull(),
    syncRunId: integer('sync_run_id').references(() => syncRuns.id, {
      onDelete: 'restrict',
    }),
  },
  (t) => [unique().on(t.generation, t.source, t.itemKey)],
);

/** 검토 대기 목록 출력용. 확인 목록(deltas)에 제외 */
export const reviewObservations = sqliteTable(
  'review_observations',
  {
    id: integer().primaryKey({ autoIncrement: true }),
    platform: text().notNull(),
    externalId: text('external_id').notNull(),
    observedAt: integer('observed_at').notNull(),
    kind: text().notNull(),
    deltaMinutes: integer('delta_minutes').notNull(),
    elapsedSeconds: integer('elapsed_seconds').notNull(),
    prevObservedAt: integer('prev_observed_at'),
    syncRunId: integer('sync_run_id').references(() => syncRuns.id, {
      onDelete: 'restrict',
    }),
  },
  (t) => [
    check('review_kind_values', sql`kind IN ('negative_clamped', 'spike')`),
    foreignKey({
      columns: [t.platform, t.externalId],
      foreignColumns: [games.platform, games.externalId],
    }).onDelete('restrict'),
  ],
);

/** D-14 캡틴 전용 1회 이관 원장. 제품 DoD 밖 */
export const importLedger = sqliteTable(
  'import_ledger',
  {
    id: integer().primaryKey({ autoIncrement: true }),
    kind: text().notNull(),
    sourceRef: text('source_ref'),
    keptCount: integer('kept_count').notNull(),
    droppedCount: integer('dropped_count').notNull(),
    firstRunAt: integer('first_run_at').notNull(),
    lastRunAt: integer('last_run_at').notNull(),
    rerunBlocked: integer('rerun_blocked').notNull(),
  },
  (t) => [unique().on(t.kind)],
);
