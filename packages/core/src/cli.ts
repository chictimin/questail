#!/usr/bin/env node

/**
 * QuestTail CLI
 *
 *   questail sniff                      Register API key & SteamID
 *   questail gather steam [<id>] [-o <dir>]
 *   questail config set/get/delete <key> [value]
 *
 * Config stored in: ~/.config/questail/.env
 * Local .env also loaded (higher priority)
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fetchOwnedGames, fetchPlayerAchievements, resolveToSteamId, toAchievementInputs, type SteamConfig } from './connectors/steam.js';
import { normalizeSteamGame } from './normalize/index.js';
import { appendHistoryLog, buildHistoryRecords, HISTORY_FILENAME, writeGameNote, writeLibraryIndex } from './storage/index.js';
import { fetchAppMetaBatch } from './metadata/index.js';
import { detectLocale, t, type Locale } from './i18n.js';
import type { GameMeta, NormalizedGame } from './types.js';
import {
  QUESTAIL_LLM_API_KEY,
  QUESTAIL_LLM_BASE_URL,
  QUESTAIL_LLM_MODEL,
  getLlmOptions,
} from './config/index.js';
import {
  LLM_DEFAULT_BASE_URL,
  LLM_DEFAULT_LOCAL_BASE_URL,
  LLM_DEFAULT_LOCAL_MODEL,
  LLM_DEFAULT_MODEL,
  isLocalhostUrl,
} from './llm/index.js';

// ─── Config Paths ────────────────────────────────────────────

const CONFIG_DIR = resolve(homedir(), '.config', 'questail');
const CONFIG_FILE = join(CONFIG_DIR, '.env');

// ─── I18n ────────────────────────────────────────────────────

let locale: Locale = 'ko';

function detectLanguage(): void {
  const fromConfig = process.env.LANGUAGE as Locale | undefined;
  if (fromConfig === 'en' || fromConfig === 'ko') {
    locale = fromConfig;
    return;
  }
  locale = detectLocale();
}

function _(key: string, ...args: string[]): string {
  return t(locale, key, ...args);
}

// ─── Env Loader ──────────────────────────────────────────────

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
    const envKey = ({ 'steam-api-key': 'STEAM_API_KEY', 'steam-id': 'STEAM_ID', 'language': 'LANGUAGE' } satisfies Record<string, string>)[key] ?? key;
    if (!process.env[envKey]) {
      process.env[envKey] = val;
    }
  }
}

function initEnv(): void {
  loadEnvFile(CONFIG_FILE);
  loadEnvFile(resolve('.env'));
  detectLanguage();
}

// ─── Config File Operations ──────────────────────────────────

async function saveConfig(key: string, value: string): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  let lines: string[] = [];
  if (existsSync(CONFIG_FILE)) {
    lines = (await readFile(CONFIG_FILE, 'utf-8')).split('\n');
  }
  const entry = `${key}=${value}`;
  const idx = lines.findIndex(l => l.trim().startsWith(`${key}=`));
  if (idx !== -1) {
    lines[idx] = entry;
  } else {
    const last = lines.at(-1)?.trim() ?? '';
    if (last === '' || lines.length === 0) {
      lines.push(entry);
    } else {
      lines[lines.length - 1] = entry;
    }
  }
  await writeFile(CONFIG_FILE, lines.join('\n').trimEnd() + '\n', 'utf-8');
  process.env[key.toUpperCase().replace(/-/g, '_')] = value;
}

async function deleteConfigFromFile(key: string): Promise<boolean> {
  if (!existsSync(CONFIG_FILE)) return false;
  const lines = (await readFile(CONFIG_FILE, 'utf-8')).split('\n');
  const filtered = lines.filter(l => !l.trim().startsWith(`${key}=`));
  if (filtered.length === lines.length) return false;
  await writeFile(CONFIG_FILE, filtered.join('\n').trimEnd() + '\n', 'utf-8');
  const envKey = key.toUpperCase().replace(/-/g, '_');
  delete process.env[envKey];
  return true;
}

// ─── Helpers ─────────────────────────────────────────────────

function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function maskValue(value: string): string {
  if (value.length <= 4) return value.slice(0, 1) + '*'.repeat(value.length - 1);
  const keep = Math.min(4, Math.floor(value.length / 3));
  const masked = Math.max(0, value.length - keep * 2);
  return value.slice(0, keep) + '*'.repeat(masked) + value.slice(-keep);
}

/** Resolve SteamID input to numeric 17-digit ID */
async function resolveSteamId(input: string, apiKey: string): Promise<string> {
  if (/^\d{17}$/.test(input)) return input;
  const resolved = await resolveToSteamId(input, apiKey);
  console.error(_('import_steam_id_resolved', input, resolved));
  return resolved;
}

// ─── Login ───────────────────────────────────────────────────

async function cmdSniff(): Promise<void> {
  console.log(_('login_title'));
  process.stdout.write('\n');
  console.log(_('login_api_key_needed'));
  console.log(_('login_api_key_url'));
  process.stdout.write('\n');

  let apiKey = process.env.STEAM_API_KEY;
  if (apiKey) {
    console.log(_('login_current_key', maskValue(apiKey)));
    const reuse = await ask(_('login_ask_reuse_key'));
    if (reuse.toLowerCase().startsWith('n')) apiKey = '';
  }
  if (!apiKey) {
    const input = await ask(_('login_ask_new_key'));
    if (!input) { console.error(_('login_key_required')); process.exit(1); }
    apiKey = input;
    await saveConfig('steam-api-key', apiKey);
  }

  process.stdout.write('\n');
  console.log(_('login_id_needed'));
  console.log(_('login_id_help1'));
  console.log(_('login_id_help2'));
  process.stdout.write('\n');

  let steamId = process.env.STEAM_ID;
  if (steamId) {
    console.log(_('login_current_key', maskValue(steamId)));
    const reuse = await ask(_('login_ask_reuse_id'));
    if (reuse.toLowerCase().startsWith('n')) steamId = '';
  }
  if (!steamId) {
    const apiKeyVal = process.env.STEAM_API_KEY!;
    const input = await ask(_('login_ask_new_id'));
    if (!input) { console.error(_('login_id_required')); process.exit(1); }
    console.error(_('login_resolving'));
    try { steamId = await resolveToSteamId(input, apiKeyVal); }
    catch (e: any) { console.error(_('login_resolve_fail', e.message)); process.exit(1); }
    await saveConfig('steam-id', steamId);
  }

  await setupLlmInSniff();

  console.error(_('login_done', CONFIG_FILE));
  const run = await ask(_('login_ask_import_now'));
  if (!run.toLowerCase().startsWith('n')) await cmdGatherSteam();
}

// ─── LLM Setup (sniff 3지선다 — postie sniff.ts 승격) ────────
// 기존 Steam 설정 흐름 뒤에 이어 붙는다. i18n.ts는 타 영역이라
// 이 섹션 문구만 cli.ts 내 locale 분기로 처리한다.

function llmText(ko: string, en: string): string {
  return locale === 'ko' ? ko : en;
}

async function setupLlmInSniff(): Promise<void> {
  process.stdout.write('\n');
  console.log(llmText('LLM 설정 (AI 해석용, 선택 사항)', 'LLM setup (for AI analysis, optional)'));

  const current = getLlmOptions();
  if (current.baseUrl || current.model) {
    console.log(llmText(
      `현재 설정: ${current.baseUrl ?? '(baseUrl 미설정)'} / ${current.model ?? '(모델 미설정)'}${current.apiKey ? ` / 키 ${maskValue(current.apiKey)}` : ''}`,
      `Current: ${current.baseUrl ?? '(no baseUrl)'} / ${current.model ?? '(no model)'}${current.apiKey ? ` / key ${maskValue(current.apiKey)}` : ''}`,
    ));
  }

  console.log('  1. OpenAI');
  console.log(llmText('  2. 로컬 호환 (Ollama·LM Studio)', '  2. Local OpenAI-compatible (Ollama·LM Studio)'));
  console.log(llmText('  3. 건너뛰기 (해석 없는 정량 리포트)', '  3. Skip (quantitative report without analysis)'));
  const pick = (await ask(llmText('선택 (1-3) [3]: ', 'Choice (1-3) [3]: '))).trim() || '3';

  if (pick === '1') {
    let apiKey = current.apiKey ?? '';
    if (apiKey) {
      console.log(llmText(`현재 저장된 키: ${maskValue(apiKey)}`, `Current key: ${maskValue(apiKey)}`));
      const reuse = await ask(llmText('이 키를 사용할까요? (Y/n): ', 'Use this key? (Y/n): '));
      if (reuse.toLowerCase().startsWith('n')) apiKey = '';
    }
    if (!apiKey) {
      apiKey = (await ask(llmText('OpenAI API 키를 입력하세요 (Enter=건너뛰기): ', 'Enter OpenAI API key (Enter=skip): '))).trim();
    }
    const defModel = current.model || LLM_DEFAULT_MODEL;
    const model = (await ask(llmText(`모델명 [${defModel}]: `, `Model [${defModel}]: `))).trim() || defModel;
    await saveConfig(QUESTAIL_LLM_BASE_URL, LLM_DEFAULT_BASE_URL);
    if (apiKey) await saveConfig(QUESTAIL_LLM_API_KEY, apiKey);
    await saveConfig(QUESTAIL_LLM_MODEL, model);
    console.error(llmText(
      apiKey ? 'LLM 설정 저장 완료 (OpenAI).' : '키 없이 저장했습니다. 원격 호출은 키가 필요합니다.',
      apiKey ? 'LLM settings saved (OpenAI).' : 'Saved without a key. Remote calls need a key.',
    ));
  } else if (pick === '2') {
    const localDefault = current.baseUrl && isLocalhostUrl(current.baseUrl)
      ? current.baseUrl
      : LLM_DEFAULT_LOCAL_BASE_URL;
    const baseUrl = (await ask(`Base URL [${localDefault}]: `)).trim() || localDefault;
    const keyInput = (await ask(llmText('API 키 (없으면 Enter): ', 'API key (Enter if none): '))).trim();
    const defModel = current.model || LLM_DEFAULT_LOCAL_MODEL;
    const model = (await ask(llmText(`모델명 [${defModel}]: `, `Model [${defModel}]: `))).trim() || defModel;
    await saveConfig(QUESTAIL_LLM_BASE_URL, baseUrl);
    if (keyInput) await saveConfig(QUESTAIL_LLM_API_KEY, keyInput);
    await saveConfig(QUESTAIL_LLM_MODEL, model);
    console.error(llmText('LLM 설정 저장 완료 (로컬 호환).', 'LLM settings saved (local).'));
  } else {
    console.log(llmText(
      'LLM 설정을 건너뜁니다. 해석 없는 정량 리포트로 동작합니다.',
      'Skipping LLM setup. Will run quantitative-only reports.',
    ));
  }
}

async function promptSteamId(): Promise<string> {
  console.log(_('login_id_help1'));
  console.log(_('login_id_help2'));
  const input = await ask(`\n${_('login_ask_new_id')}`);
  if (!input) { console.error(_('login_id_required')); process.exit(1); }
  console.error(_('login_resolving'));
  let steamId: string;
  try { steamId = await resolveToSteamId(input, process.env.STEAM_API_KEY!); }
  catch (e: any) { console.error(_('login_resolve_fail', e.message)); process.exit(1); }
  const save = await ask(_('login_ask_save'));
  if (!save.toLowerCase().startsWith('n')) {
    await saveConfig('steam-id', steamId);
    console.error(_('login_saved', 'steam-id'));
  }
  return steamId;
}

// ─── Config Subcommand ───────────────────────────────────────

async function cmdConfig(): Promise<void> {
  const sub = process.argv[3];
  const key = process.argv[4];
  const value = process.argv[5];

  switch (sub) {
    case 'get': {
      if (!key) { console.error(_('config_get_usage')); process.exit(1); }
      const envKey = key.toUpperCase().replace(/-/g, '_');
      const v = process.env[envKey];
      if (!v) { console.error(_('config_not_set', key)); process.exit(1); }
      console.log(`${key}=${maskValue(v)}`);
      break;
    }
    case 'set': {
      if (!key || !value) { console.error(_('config_set_usage')); process.exit(1); }
      const saveValue = (key === 'steam-id' && process.env.STEAM_API_KEY)
        ? await resolveSteamId(value, process.env.STEAM_API_KEY)
        : value;
      await saveConfig(key, saveValue);
      if (key === 'language') detectLanguage();
      console.error(_('config_saved', key, CONFIG_FILE));
      break;
    }
    case 'delete': {
      if (!key) { console.error(_('config_delete_usage')); process.exit(1); }
      const removed = await deleteConfigFromFile(key);
      console.error(removed ? _('config_deleted', key) : _('config_not_set', key));
      break;
    }
    default:
      console.error(_('config_get_usage'));
      console.error(_('config_set_usage'));
      console.error(_('config_delete_usage'));
      process.exit(1);
  }
}

// ─── Import Subcommand ───────────────────────────────────────

async function getSteamConfig(): Promise<Required<SteamConfig>> {
  const apiKey = process.env.STEAM_API_KEY;
  if (!apiKey) { console.error(_('error_api_key_missing')); process.exit(1); }

  const argSteamId = process.argv[4];
  if (argSteamId && !argSteamId.startsWith('-')) {
    return { apiKey, steamId: await resolveSteamId(argSteamId, apiKey) };
  }
  if (process.env.STEAM_ID) {
    return { apiKey, steamId: await resolveSteamId(process.env.STEAM_ID, apiKey) };
  }
  return { apiKey, steamId: await promptSteamId() };
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

async function cmdGatherSteam(): Promise<void> {
  const config = await getSteamConfig();
  const outputDir = parseOutputFlag();

  console.error(_('import_fetching', config.steamId));
  const data = await fetchOwnedGames(config);

  // 메타: appdetails 배치 조회 후 appid로 매핑해 normalize 세 번째 인자로 전달.
  // 쿨다운(AppMetaRateLimitedError) 포함 배치 실패 시 메타 없이 계속 — gather 전체가 죽지 않는다.
  const metaByAppId = new Map<string, GameMeta>();
  try {
    const metas = await fetchAppMetaBatch(
      data.response.games.map(g => String(g.appid)),
      (done, total, appId) => console.error(llmText(
        `메타 수집 중 ${done}/${total} (app ${appId})`,
        `Fetching metadata ${done}/${total} (app ${appId})`,
      )),
    );
    for (const m of metas) metaByAppId.set(m.appId, m);
  } catch (e) {
    console.error(_('error', e instanceof Error ? e.message : String(e)));
  }

  // 업적: 게임당 1호출, 순차 조회(자연 스로틀). 비공개 프로필·미지원 게임은
  // SteamApiError를 던지므로 게임별 try/catch 후 업적 없이 normalize 폴백.
  let withAchievements = 0;
  const games: NormalizedGame[] = [];
  for (const g of data.response.games) {
    const meta = metaByAppId.get(String(g.appid));
    try {
      const res = await fetchPlayerAchievements(config, g.appid);
      withAchievements++;
      games.push(normalizeSteamGame(g, toAchievementInputs(res), meta));
    } catch {
      games.push(normalizeSteamGame(g, undefined, meta));
    }
  }
  games.sort((a, b) => b.playtimeMinutes - a.playtimeMinutes);

  console.error(_('import_summary', String(games.length), outputDir));
  process.stdout.write('\n');

  let count = 0;
  for (const game of games) {
    const fp = await writeGameNote(outputDir, game);
    const h = (game.playtimeMinutes / 60).toFixed(1);
    console.error(_('import_item', game.title, h, fp));
    count++;
  }

  const libraryPath = await writeLibraryIndex(outputDir, games);
  await appendHistoryLog(join(outputDir, HISTORY_FILENAME), buildHistoryRecords(games));
  console.error(llmText(
    `업적 ${withAchievements}/${games.length}개 게임에 반영 · 정본: ${libraryPath}`,
    `Achievements applied to ${withAchievements}/${games.length} games · index: ${libraryPath}`,
  ));

  console.error(_('import_done', String(count), outputDir));
}

// ─── Main ────────────────────────────────────────────────────

function printUsage(): void {
  console.error(_('usage_header'));
  console.error(_('usage_login'));
  console.error(_('usage_import'));
  console.error(_('usage_config_set'));
  console.error(_('usage_config_get'));
  console.error(_('usage_config_delete'));
}

function main(): void {
  initEnv();
  const cmd = process.argv[2];

  switch (cmd) {
    case 'sniff':
      void cmdSniff().catch(e => { console.error(_('error', e.message)); process.exit(1); });
      break;
    case 'gather':
      if (process.argv[3] === 'steam') {
        void cmdGatherSteam().catch(e => { console.error(_('error', e.message)); process.exit(1); });
      } else {
        console.error(_('usage_import'));
        process.exit(1);
      }
      break;
    case 'config':
      void cmdConfig().catch(e => { console.error(_('error', e.message)); process.exit(1); });
      break;
    default:
      if (cmd === '--help' || cmd === '-h' || !cmd) {
        printUsage();
      } else {
        console.error(_('unknown_cmd'));
        printUsage();
        process.exit(1);
      }
  }
}

main();
