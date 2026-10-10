/**
 * packages/core/archive/cache-dir.ts — 구 CLI용 캐시 디렉터리 결정 (D-13 보관).
 *
 * QUESTAIL_CACHE_DIR env 판독 사본. src의 resolveAppMetaCacheDir·
 * resolveSteamSpyCacheDir 원본은 D-13에서 삭제됐고, R1 경로는 cacheDir을
 * 명시 주입하므로 이 파일은 archive/cli.ts·archive/tools/recache.ts만 쓴다.
 * 사본 중복 금지 — 이 파일 한 곳에만 둔다.
 */

import { join, resolve } from 'node:path';

/**
 * 캐시 루트 결정. QUESTAIL_CACHE_DIR이 있으면 그 아래 appdetails,
 * 없으면 실행 시점 cwd 아래 .cache/appdetails.
 */
export function resolveAppMetaCacheDir(): string {
  const override = process.env.QUESTAIL_CACHE_DIR?.trim();
  if (override) return join(resolve(override), 'appdetails');
  return join(resolve('.cache'), 'appdetails');
}

/**
 * 캐시 루트 결정.
 * QUESTAIL_CACHE_DIR이 있으면 그 아래 steamspy, 없으면 cwd 아래 .cache/steamspy.
 */
export function resolveSteamSpyCacheDir(): string {
  const override = process.env.QUESTAIL_CACHE_DIR?.trim();
  if (override) return join(resolve(override), 'steamspy');
  return join(resolve('.cache'), 'steamspy');
}
