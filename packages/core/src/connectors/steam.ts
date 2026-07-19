/**
 * Steam 커넥터 — Steam Web API로 보유 게임, 플레이타임, 업적을 임포트
 *
 * 이전 세션 검증 완료 (browser fetch로 성공 확인).
 * M1 목표: SteamID → 보유 게임 목록 + 플레이타임을 표준 스키마로 변환.
 */

export interface SteamConfig {
  apiKey: string;
  steamId: string;
}

export interface SteamGame {
  appId: number;
  name: string;
  playtimeForever: number;
  playtimeWindows: number;
  playtimeMac: number;
  playtimeLinux: number;
  rtimeLastPlayed: number;
  hasCommunityVisibleStats: boolean;
  imgIconUrl?: string;
  imgLogoUrl?: string;
}

export interface OwnedGamesResponse {
  response: {
    game_count: number;
    games: SteamGame[];
  };
}

export interface PlayerAchievementsResponse {
  playerstats: {
    steamID: string;
    gameName: string;
    achievements: Array<{
      apiname: string;
      achieved: number;
      unlocktime: number;
      name: string;
      description: string;
    }>;
    success: boolean;
  };
}

const STEAM_API_BASE = 'https://api.steampowered.com';

export class SteamApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly endpoint: string,
  ) {
    super(message);
    this.name = 'SteamApiError';
  }
}

/**
 * Steam Web API 호출 — 공통 fetch 래퍼
 */
async function steamFetch<T>(url: string, endpoint: string): Promise<T> {
  const res = await fetch(url);

  if (res.status === 401 || res.status === 403) {
    throw new SteamApiError(
      'Steam API 인증 실패. STEAM_API_KEY가 유효한지 확인하세요.',
      res.status,
      endpoint,
    );
  }
  if (res.status === 429) {
    throw new SteamApiError(
      'Steam API rate limit 초과. 잠시 후 다시 시도하세요.',
      res.status,
      endpoint,
    );
  }
  if (!res.ok) {
    throw new SteamApiError(
      `Steam API 오류: ${res.status} ${res.statusText}`,
      res.status,
      endpoint,
    );
  }

  return res.json() as Promise<T>;
}

/**
 * 보유 게임 목록 조회
 */
export async function fetchOwnedGames(config: SteamConfig): Promise<OwnedGamesResponse> {
  const url = `${STEAM_API_BASE}/IPlayerService/GetOwnedGames/v0001/`
    + `?key=${config.apiKey}&steamid=${config.steamId}`
    + `&format=json&include_appinfo=true&include_played_free_games=true`;

  return steamFetch<OwnedGamesResponse>(url, 'GetOwnedGames');
}

/**
 * 특정 게임의 업적 조회
 */
export async function fetchPlayerAchievements(
  config: SteamConfig,
  appId: number,
): Promise<PlayerAchievementsResponse> {
  const url = `${STEAM_API_BASE}/ISteamUserStats/GetPlayerAchievements/v0001/`
    + `?key=${config.apiKey}&steamid=${config.steamId}&appid=${appId}&format=json`;

  return steamFetch<PlayerAchievementsResponse>(url, 'GetPlayerAchievements');
}
