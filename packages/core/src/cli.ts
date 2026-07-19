#!/usr/bin/env node

/**
 * QuestTail CLI — M1: Steam 라이브러리를 Markdown으로 추출
 *
 * 사용법:
 *   questail import steam <steamId> [options]
 *
 * 옵션:
 *   --output, -o  출력 디렉토리 (기본: ./games)
 *
 * 환경변수:
 *   STEAM_API_KEY — Steam Web API 키
 */

import { fetchOwnedGames, type SteamConfig } from './connectors/steam.js';
import { normalizeSteamGame } from './normalize/index.js';
import { writeGameNote } from './storage/index.js';
import { resolve } from 'node:path';

function getSteamConfig(): Required<SteamConfig> {
  const apiKey = process.env.STEAM_API_KEY;
  if (!apiKey) {
    console.error('Error: STEAM_API_KEY 환경변수가 설정되지 않았습니다.');
    console.error('  export STEAM_API_KEY=<your_steam_web_api_key>');
    process.exit(1);
  }

  const steamId = process.argv[3];
  if (!steamId) {
    console.error('사용법: questail import steam <steamId> [--output <dir>]');
    process.exit(1);
  }

  return { apiKey, steamId };
}

function parseOutputFlag(): string {
  const idx = process.argv.indexOf('--output');
  const idxShort = process.argv.indexOf('-o');
  const targetIdx = idx !== -1 ? idx : idxShort;

  if (targetIdx !== -1 && process.argv[targetIdx + 1]) {
    return resolve(process.argv[targetIdx + 1]);
  }
  return resolve('./games');
}

async function cmdImportSteam() {
  const config = getSteamConfig();
  const outputDir = parseOutputFlag();

  console.error(`SteamID ${config.steamId}의 게임 목록을 가져오는 중...`);
  const data = await fetchOwnedGames(config);
  const games = data.response.games
    .map(g => normalizeSteamGame(g))
    .sort((a, b) => b.playtimeMinutes - a.playtimeMinutes);

  console.error(`\n총 ${games.length}개 게임을 ${outputDir}/ 에 쓰는 중...\n`);

  let count = 0;
  for (const game of games) {
    const filepath = await writeGameNote(outputDir, game);
    const hours = (game.playtimeMinutes / 60).toFixed(1);
    console.error(`  ✓ ${game.title} (${hours}h) → ${filepath}`);
    count++;
  }

  console.error(`\n✅ 완료: ${count}개 게임을 ${outputDir}/ 에 저장했습니다.`);
}

async function main() {
  const cmd = process.argv[2];

  switch (cmd) {
    case 'import':
      if (process.argv[3] === 'steam') {
        await cmdImportSteam();
      } else {
        console.error('사용법: questail import steam <steamId> [--output <dir>]');
        process.exit(1);
      }
      break;
    default:
      console.error('사용법:');
      console.error('  questail import steam <steamId> [--output <dir>]');
      console.error('');
      console.error('옵션:');
      console.error('  --output, -o  출력 디렉토리 (기본: ./games)');
      process.exit(1);
  }
}

main().catch(err => {
  console.error('오류:', err.message);
  process.exit(1);
});
