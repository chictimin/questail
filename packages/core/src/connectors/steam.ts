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
  playtimeForever: number;   // 총 플레이타임 (분)
  playtimeWindows: number;
  playtimeMac: number;
  playtimeLinux: number;
  rtimeLastPlayed: number;
  hasCommunityVisibleStats: boolean;
}

export interface OwnedGamesResponse {
  response: {
    game_count: number;
    games: SteamGame[];
  };
}

const STEAM_API_BASE = 'https://api.steampowered.com';

export async function fetchOwnedGames(config: SteamConfig): Promise<OwnedGamesResponse> {
  const url = `${STEAM_API_BASE}/IPlayerService/GetOwnedGames/v0001/?key=${config.apiKey}&steamid=${config.steamId}&format=json&include_appinfo=true&include_played_free_games=true`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Steam API error: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<OwnedGamesResponse>;
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

export async function fetchPlayerAchievements(config: SteamConfig, appId: number): Promise<PlayerAchievementsResponse> {
  const url = `${STEAM_API_BASE}/ISteamUserStats/GetPlayerAchievements/v0001/?key=${config.apiKey}&steamid=${config.steamId}&appid=${appId}&format=json`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Steam achievements API error: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<PlayerAchievementsResponse>;
}
