#!/usr/bin/env node

/**
 * QuestTail CLI
 *
 * 사용법:
 *   questail import steam <steamId> [--output <dir>]
 *   questail config set steam-api-key <key>
 *   questail config get steam-api-key
 *   questail config delete steam-api-key
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { fetchOwnedGames, type SteamConfig } from './connectors/steam.js';
import { normalizeSteamGame } from './normalize/index.js';
import { writeGameNote } from './storage/index.js';

// ─── Config (전역 설정) ──────────────────────────────────────

const CONFIG_DIR = resolve(homedir(), '.config', 'questail');
const CONFIG_FILE = join(CONFIG_DIR, '.env');

/** .env 파일을 읽어 process.env에 로드 (이미 있는 값은 유지) */
function loadEnvFile(filepath: string): void {
  if (!existsSync(filepath)) return;
  const content = readFileSync(filepath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    // config key → 환경변수명 매핑
    const envKey = ({ 'steam-api-key': 'STEAM_API_KEY', 'steam-id': 'STEAM_ID' } satisfies Record<string, string>)[key] ?? key;
    if (!process.env[envKey]) {
      process.env[envKey] = val;
    }
  }
}

/** ~/.config/questail/.env 에 키-값 저장 */
async function saveConfig(key: string, value: string): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });

  let lines: string[] = [];
  if (existsSync(CONFIG_FILE)) {
    lines = (await readFile(CONFIG_FILE, 'utf-8')).split('\n');
  }

  const existingIdx = lines.findIndex(l => l.trim().startsWith(`${key}=`));
  const entry = `${key}=${value}`;

  if (existingIdx !== -1) {
    lines[existingIdx] = entry;
  } else {
    // 빈 줄로 끝나면 그 위에, 아니면 추가
    if (lines.length > 0 && lines[lines.length - 1].trim() === '') {
      lines[lines.length - 1] = entry;
    } else {
      lines.push(entry);
    }
  }

  await writeFile(CONFIG_FILE, lines.join('\n').trimEnd() + '\n', 'utf-8');
}

/** ~/.config/questail/.env 에서 키 삭제 */
async function deleteConfig(key: string): Promise<boolean> {
  if (!existsSync(CONFIG_FILE)) return false;

  const lines = (await readFile(CONFIG_FILE, 'utf-8')).split('\n');
  const filtered = lines.filter(l => !l.trim().startsWith(`${key}=`));

  if (filtered.length === lines.length) return false;

  await writeFile(CONFIG_FILE, filtered.join('\n').trimEnd() + '\n', 'utf-8');
  return true;
}

/** ~/.config/questail/.env 에서 키 조회 */
function getConfig(key: string): string | undefined {
  if (!existsSync(CONFIG_FILE)) return undefined;
  const content = readFileSync(CONFIG_FILE, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith(`${key}=`)) {
      return trimmed.slice(key.length + 1);
    }
  }
  return undefined;
}

// ─── Config commands ─────────────────────────────────────────

function cmdConfigGet(key: string): void {
  const value = getConfig(key);
  if (value === undefined) {
    console.error(`설정되지 않음: ${key}`);
    process.exit(1);
  }
  // 키가 설정돼있으면 마스킹해서 출력
  const masked = value.length > 8
    ? value.slice(0, 4) + '*'.repeat(value.length - 8) + value.slice(-4)
    : '*'.repeat(value.length);
  console.log(`${key}=${masked}`);
}

async function cmdConfigSet(key: string, value: string): Promise<void> {
  await saveConfig(key, value);
  console.error(`✅ ${key} 저장 완료 (${CONFIG_FILE})`);
}

async function cmdConfigDelete(key: string): Promise<void> {
  const removed = await deleteConfig(key);
  if (removed) {
    console.error(`✅ ${key} 삭제 완료`);
  } else {
    console.error(`설정되지 않음: ${key}`);
  }
}

async function cmdConfig(): Promise<void> {
  const sub = process.argv[3];
  const key = process.argv[4];
  const value = process.argv[5];

  switch (sub) {
    case 'get':
      if (!key) { console.error('사용법: questail config get <key>'); process.exit(1); }
      cmdConfigGet(key);
      break;
    case 'set':
      if (!key || !value) { console.error('사용법: questail config set <key> <value>'); process.exit(1); }
      await cmdConfigSet(key, value);
      break;
    case 'delete':
      if (!key) { console.error('사용법: questail config delete <key>'); process.exit(1); }
      await cmdConfigDelete(key);
      break;
    default:
      console.error('사용법:');
      console.error('  questail config get <key>');
      console.error('  questail config set <key> <value>');
      console.error('  questail config delete <key>');
      process.exit(1);
  }
}

// ─── Import commands ─────────────────────────────────────────

function getSteamConfig(): Required<SteamConfig> {
  const apiKey = process.env.STEAM_API_KEY;
  if (!apiKey) {
    console.error('Steam API 키가 설정되지 않았습니다.');
    console.error('');
    console.error('  questail config set steam-api-key <발급받은_키>');
    console.error('');
    console.error('키 발급: https://steamcommunity.com/dev/apikey');
    process.exit(1);
  }

  const argSteamId = process.argv[4];
  const steamId = (argSteamId && !argSteamId.startsWith('-')) ? argSteamId : process.env.STEAM_ID;
  if (!steamId) {
    console.error('SteamID가 설정되지 않았습니다.');
    console.error('');
    console.error('  questail config set steam-id <SteamID64>');
    console.error('  또는: questail import steam <SteamID64>');
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

// ─── Main ────────────────────────────────────────────────────

function main(): void {
  loadEnvFile(CONFIG_FILE);       // 전역 설정 (~/.config/questail/.env)
  loadEnvFile(resolve('.env'));   // 로컬 .env (우선순위 높음)

  const cmd = process.argv[2];

  switch (cmd) {
    case 'import':
      if (process.argv[3] === 'steam') {
        awaitHandler(cmdImportSteam());
      } else {
        console.error('사용법: questail import steam [<steamId>] [--output <dir>]');
        process.exit(1);
      }
      break;
    case 'config':
      awaitHandler(cmdConfig());
      break;
    default:
      console.error('사용법:');
      console.error('  questail import steam [<steamId>] [--output <dir>]');
      console.error('  questail config set steam-api-key <key>');
      console.error('  questail config set steam-id <SteamID64>');
      console.error('  questail config get <key>');
      console.error('  questail config delete <key>');
      process.exit(1);
  }
}

function awaitHandler(p: Promise<unknown>): void {
  p.catch(err => {
    console.error('오류:', err.message);
    process.exit(1);
  });
}

main();
