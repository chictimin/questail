import type Database from 'better-sqlite3';
import { type GameFacts, listLibrary } from './library.js';

/**
 * 내보내기용 게임 목록. 현 보유만 내보내는 기본이다.
 * ended 포함 확대는 임의로 하지 않는다(필요 시 별도 합의, C-5).
 * 파일 쓰기는 호출 측(B)이 맡는다.
 */
export function readExportGames(db: Database.Database): GameFacts[] {
  return listLibrary(db, { includeEnded: false });
}
