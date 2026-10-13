/**
 * R15-6 별칭 파일 로더 — 데이터 폴더 직하 `series-aliases.json` 읽기.
 * 형식 JSON `{ "aliases": { "정규화명": "시리즈ID" } }`(사용자 수정 가능).
 * - 파일 없음 → 계약 부록 A 내장 기본값 + status 'missing'
 * - 깨짐(JSON 파싱 실패·형태 불일치) → 별칭 없이(aliases null) + status 'broken'
 * - 정상 → 파일 값 + status 'ok'
 * 반환형은 core 실타입 `SeriesAliasInput`(`packages/core/src/tbti/types.ts`, T0)과
 * 동형이므로 annotation만 core 타입으로 쓴다. null은 별칭 없음을 뜻한다.
 * 아래 `resolveSeriesAliases`(개념) 호출선에서 core 판정 함수가 정해지면
 * 이 로더의 반환을 그 인자로 넘긴다(교체 지점).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SeriesAliasInput } from '@questail/core';

export const SERIES_ALIASES_FILE_NAME = 'series-aliases.json';

export type SeriesAliasesStatus = 'ok' | 'missing' | 'broken';

export interface SeriesAliasesResult {
  aliases: Record<string, string> | null;
  status: SeriesAliasesStatus;
}

/** 계약 부록 A 내장 기본 별칭 (제안, 소수). 파일이 없을 때만 쓴다. */
export const BUILTIN_SERIES_ALIASES: Record<string, string> = {
  biohazard: 'resident-evil',
  'resident evil': 'resident-evil',
  'monster hunter': 'monster-hunter',
  'dark souls': 'dark-souls',
  'the witcher': 'the-witcher',
  'final fantasy': 'final-fantasy',
};

function isAliasesRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.entries(value).every(
    ([k, v]) => typeof k === 'string' && typeof v === 'string',
  );
}

export function loadSeriesAliases(dataDir: string): SeriesAliasInput {
  let raw: string;
  try {
    raw = readFileSync(join(dataDir, SERIES_ALIASES_FILE_NAME), 'utf8');
  } catch (error) {
    // 없음(ENOENT 포함) — 읽을 수 없으면 내장 기본값으로 판정한다.
    if ((error as { code?: unknown }).code === undefined) {
      return { aliases: { ...BUILTIN_SERIES_ALIASES }, status: 'missing' };
    }
    return { aliases: { ...BUILTIN_SERIES_ALIASES }, status: 'missing' };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'aliases' in parsed &&
      isAliasesRecord((parsed as { aliases: unknown }).aliases)
    ) {
      return {
        aliases: { ...(parsed as { aliases: Record<string, string> }).aliases },
        status: 'ok',
      };
    }
    return { aliases: null, status: 'broken' };
  } catch {
    return { aliases: null, status: 'broken' };
  }
}
