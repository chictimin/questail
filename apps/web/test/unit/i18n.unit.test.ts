import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { SyncErrorCode } from '@questail/core';
import { flatKeys } from '../../src/ui/i18n/index.js';

/** i18n 키 전체 — t('...') 인자는 UI 문구가 아니라 검사 제외. */
const KEY_STRINGS = new Set([...flatKeys('ko'), ...flatKeys('en')]);

const UI_DIR = join(
  fileURLToPath(import.meta.url),
  '..',
  '..',
  '..',
  'src',
  'ui',
);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      out.push(...sourceFiles(path));
    } else if (
      (entry.endsWith('.tsx') || entry.endsWith('.ts')) &&
      entry !== 'ko.ts' &&
      entry !== 'en.ts'
    ) {
      out.push(path);
    }
  }
  return out;
}

describe('i18n 키 정합', () => {
  it('ko·en 키 차집합 0', () => {
    expect(flatKeys('ko')).toEqual(flatKeys('en'));
  });

  it('error.* 11키 × 2언어 (동결본 C-3 SyncErrorCode에서 파생)', () => {
    // core에 코드가 늘면 아래 satisfies와 누락 검사가 typecheck를 깨뜨린다.
    const ERROR_CODES = [
      'ACCESS_PRIVATE',
      'AUTH_ID_MISMATCH',
      'AUTH_INVALID_KEY',
      'HELD_DEPENDENCY',
      'HELD_TIME_ZERO',
      'HELD_ZERO',
      'KEY_STORE_FAILED',
      'NETWORK',
      'PAYLOAD_CORRUPT',
      'RATE_LIMITED',
      'TAG_EMPTY',
      'TAG_FAILED',
    ] as const satisfies readonly SyncErrorCode[];
    type Missing = Exclude<SyncErrorCode, (typeof ERROR_CODES)[number]>;
    const missingCheck: Missing extends never ? true : never = true;
    expect(missingCheck).toBe(true);
    const expected = ERROR_CODES.map((c) => `error.${c}`).sort();
    expect(flatKeys('ko').filter((k) => k.startsWith('error.'))).toEqual(
      expected,
    );
    expect(flatKeys('en').filter((k) => k.startsWith('error.'))).toEqual(
      expected,
    );
  });
});

describe('UI 하드코딩 문자열 0', () => {
  /**
   * 예외 목록 — 사용자 노출 문자열이 아니라 검사에서 뺀다(항목별 사유).
   * aria 등 노출 속성은 t() 경유라 예외 없음.
   */
  const EXCEPTIONS = new Set([
    '/connect', // 라우트 경로(URL)
    '/sync', // 라우트 경로(URL)
    '/library', // 라우트 경로(URL)
    '/settings', // 라우트 경로(URL)
    '/', // hc baseUrl·루트 경로
    'connect', // data-route 식별자
    'sync', // data-route 식별자
    'library', // data-route 식별자
    'settings', // data-route 식별자
    'root', // DOM id
    'ko', // 로케일 코드
    'en', // 로케일 코드
    'nav', // i18n 섹션 식별자
    'error', // i18n 섹션 식별자
    'export', // i18n 섹션 식별자
    'useLocale는 LocaleProvider 안에서만 쓴다', // 개발자 전용 예외(화면 미노출)
    'root 요소 없음', // 개발자 전용 예외(화면 미노출)
  ]);

  /** 소스 1건 스캔 → 위반 목록. 행 위치 무관, 태그 사이 텍스트(>…<)를 잡는다. */
  function scanSource(source: string, label: string): string[] {
    const violations: string[] = [];
    source.split('\n').forEach((line, index) => {
      const trimmed = line.trim();
      if (
        trimmed.startsWith('import ') ||
        trimmed.startsWith('//') ||
        trimmed.startsWith('*') ||
        /\bfrom\s+['"]/.test(trimmed)
      ) {
        return;
      }
      // 따옴표 문자열 리터럴(동적 ${} 포함은 제외)
      for (const match of line.matchAll(/['"`]([^'"`]*?)['"`]/g)) {
        const text = match[1] ?? '';
        if (
          text !== '' &&
          !text.includes('${') &&
          !KEY_STRINGS.has(text) &&
          !EXCEPTIONS.has(text) &&
          /[가-힣a-zA-Z]/.test(text)
        ) {
          violations.push(`${label}:${index + 1}: ${text}`);
        }
      }
      // 태그 사이 텍스트(행 위치 무관, 중괄호 표현식 제외)
      for (const match of line.matchAll(/>([^<>{}]+)</g)) {
        if (match[1].trim() !== '') {
          violations.push(`${label}:${index + 1}: JSX text ${match[1].trim()}`);
        }
      }
    });
    return violations;
  }

  it('ui 소스(ts·tsx, 사전 제외)의 정적 문자열은 예외 목록에만', () => {
    const violations = sourceFiles(UI_DIR).flatMap((file) =>
      scanSource(readFileSync(file, 'utf-8'), file),
    );
    expect(violations).toEqual([]);
  });

  it('음성: 인라인 <p> 문구를 잡는다', () => {
    expect(scanSource('<p>하드코딩</p>', 'fixture')).toHaveLength(1);
  });
});
