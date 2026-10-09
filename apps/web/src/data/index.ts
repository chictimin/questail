/** 데이터 서비스 재수출 (D-05). 연결·수집 함수는 범위 밖이라 두지 않는다. */
export { KEY_FILE_NAME, createSteamRequest, getConnection, isKeyShapeValid, saveConnection } from './connection.js';
export type { FetchLike, KeyedRequestResult, SaveResult } from './connection.js';
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
