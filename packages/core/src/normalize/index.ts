/**
 * 표준 스키마 — 모든 플랫폼의 게임 데이터를 이 구조로 정규화한다.
 *
 * 객관 데이터 (source: auto) — API가 긁어오는 사실
 * 주관 데이터 (source: manual) — 사용자 수기 입력, 별점 등
 */

export type GameSource = 'auto' | 'manual';
export type Platform = 'steam' | 'psn' | 'xbox' | 'manual';

export interface NormalizedGame {
  /** 플랫폼 내 식별자 (e.g. Steam appId) */
  id: string;
  /** 플랫폼 식별자 */
  platform: Platform;
  /** 게임 제목 */
  title: string;
  /** 데이터 출처 */
  source: GameSource;
  /** 총 플레이타임 (분) */
  playtimeMinutes: number;
  /** 업적 달성률 (0–100) */
  achievementPercent?: number;
  /** 마지막 플레이 일시 (Unix timestamp) */
  lastPlayedAt?: number;
  /** 게임 커버 이미지 URL */
  imageUrl?: string;
  /** 장르 태그 목록 */
  genres?: string[];
}

import type { SteamApiGame } from '../connectors/steam.js';

/**
 * Steam API 응답을 표준 스키마로 변환
 */
export function normalizeSteamGame(game: SteamApiGame, achievements?: { achieved: number; unlocktime: number }[]): NormalizedGame {
  const totalAchievements = achievements?.length ?? 0;
  const achievedCount = achievements?.filter(a => a.achieved === 1).length ?? 0;
  const achievementPercent = totalAchievements > 0 ? Math.round((achievedCount / totalAchievements) * 100) : undefined;

  return {
    id: String(game.appid),
    platform: 'steam',
    title: game.name,
    source: 'auto',
    playtimeMinutes: game.playtime_forever ?? 0,
    lastPlayedAt: game.rtime_last_played || undefined,
    achievementPercent,
  };
}
