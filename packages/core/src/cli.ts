#!/usr/bin/env node

/**
 * QuestTail CLI — M1: Steam 라이브러리를 Markdown으로 추출
 *
 * 사용법:
 *   questail import steam <steamId>
 *
 * 환경변수:
 *   STEAM_API_KEY — Steam Web API 키
 */

import { fetchOwnedGames, type SteamConfig } from './connectors/steam.js';
import { normalizeSteamGame } from './normalize/index.js';
import { serializeGameNote, formatNote } from './storage/index.js';

function getSteamConfig(): SteamConfig {
  const apiKey = process.env.STEAM_API_KEY;
  if (!apiKey) {
    console.error('Error: STEAM_API_KEY 환경변수가 설정되지 않았습니다.');
    console.error('  export STEAM_API_KEY=<your_steam_web_api_key>');
    process.exit(1);
  }

  const steamId = process.argv[3];
  if (!steamId) {
    console.error('사용법: questail import steam <steamId>');
    process.exit(1);
  }

  return { apiKey, steamId };
}

async function cmdImportSteam() {
  const config = getSteamConfig();
  console.error(`SteamID ${config.steamId}의 게임 목록을 가져오는 중...`);

  const data = await fetchOwnedGames(config);
  const games = data.response.games.map(g => normalizeSteamGame(g));

  console.error(`\n총 ${games.length}개 게임 가져옴\n`);

  for (const game of games) {
    const note = serializeGameNote(game);
    console.log(formatNote(note));
    console.log('---\n');
  }
}

async function main() {
  const cmd = process.argv[2];

  switch (cmd) {
    case 'import':
      const subcmd = process.argv[3];
      if (subcmd === 'steam') {
        await cmdImportSteam();
      } else {
        console.error('사용법: questail import steam <steamId>');
        process.exit(1);
      }
      break;
    default:
      console.error('사용법:');
      console.error('  questail import steam <steamId>   — Steam 라이브러리를 md로 출력');
      process.exit(1);
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
