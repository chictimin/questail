/** 데이터 서비스 재수출 (D-05). 연결·수집 함수는 범위 밖이라 두지 않는다. */
export { KEY_FILE_NAME, createSteamRequest, getConnection, isKeyShapeValid, saveConnection } from './connection.js';
export type { FetchLike, KeyedRequestResult, SaveResult, VerifyFetchFn } from './connection.js';
export { getLatestRatedAt, getLatestScore, setRating } from './ratings.js';
export type { GameKey, ScoreValue, SetRatingResult } from './ratings.js';
export {
  getAchievementSettings,
  getPrefs,
  setAchievementSettings,
  setPrefs,
} from './viewState.js';
export type { LocaleFallback, Prefs } from './viewState.js';
export { listLibrary } from './library.js';
export type { GameFacts } from './library.js';
export { readExportGames } from './export.js';
export { applyOwnedDiff } from './ownership.js';
export type { ApplyOwnedInput, ApplyOwnedResult, OwnedClock } from './ownership.js';
export { applyWishlistDiff } from './wishlist.js';
export type { ApplyWishlistInput, ApplyWishlistResult } from './wishlist.js';
export { finishRun, latestFinalizedRun, startRun } from './syncRuns.js';
export type { CollectSource, FinishRunInput, StartRunInput } from './syncRuns.js';
export {
  ALL_SOURCES,
  finishSyncRun,
  getRunLocale,
  getSyncStatus,
  progressRun,
  rateLimitIssue,
  resetSyncLocksForTest,
  resyncSource,
  startSync,
} from './sync.js';
export type { FinishInput, Locale, ProgressPatch, StartResult, SyncIssue, SyncStatusEntry } from './sync.js';
export { createSyncService } from './service.js';
export type { SyncService, SyncServiceDeps } from './service.js';
