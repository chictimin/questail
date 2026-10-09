import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { SyncErrorCode } from '@questail/core';
import type { RequestErrorCode } from '../../src/server/request-errors.js';
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

  it('error.* = SyncErrorCode + RequestErrorCode × 2언어', () => {
    // core·서버에 코드가 늘면 아래 satisfies와 누락 검사가 typecheck를 깨뜨린다.
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
    // 요청 오류 코드가 늘면 아래 satisfies와 누락 검사가 typecheck를 깨뜨린다.
    // GAME_NOT_FOUND(W7 추가분)도 여기에 포함한다.
    const REQUEST_CODES = [
      'CONNECT_IN_PROGRESS',
      'EXPORT_FAILED',
      'GAME_NOT_FOUND',
      'INTERNAL',
      'INVALID_BODY',
      'INVALID_HOST',
      'INVALID_ORIGIN',
    ] as const satisfies readonly RequestErrorCode[];
    type RequestMissing = Exclude<
      RequestErrorCode,
      (typeof REQUEST_CODES)[number]
    >;
    const requestMissingCheck: RequestMissing extends never ? true : never =
      true;
    expect(requestMissingCheck).toBe(true);
    const expected = [...ERROR_CODES, ...REQUEST_CODES]
      .map((c) => `error.${c}`)
      .sort();
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
    'library-list', // CSS 클래스 식별자(화면 미노출)
    'ko', // 로케일 코드
    'en', // 로케일 코드
    'nav', // i18n 섹션 식별자
    'error', // i18n 섹션 식별자
    'export', // i18n 섹션 식별자
    'connect', // i18n 섹션 식별자
    'shell', // i18n 섹션 식별자
    'settings', // i18n 섹션 식별자
    '/api/settings/achievements', // API 경로 — 화면 미노출
    'achievements-heading', // aria-labelledby 식별자 — 화면 미노출
    'language-heading', // aria-labelledby 식별자 — 화면 미노출
    'connect-layout', // 2열 후크(화면 미노출)
    '/api/connect', // API 경로
    '/api/export', // API 경로
    '/export', // 라우트 경로
    '/api/library?includeEnded=false', // API 경로
    '/api/connect/status', // API 경로
    'POST', // fetch 메서드
    'password', // input 타입
    'polite', // aria-live 값
    'alert', // role 값
    'CONNECT_IN_PROGRESS', // 서버 코드 분기(화면 미노출)
    'AUTH_INVALID_KEY', // 서버 코드 분기(화면 미노출)
    'AUTH_ID_MISMATCH', // 서버 코드 분기(화면 미노출)
    'KEY_STORE_FAILED', // 서버 코드 분기(화면 미노출)
    'connect-key-error', // 필드 오류 연결
    'connect-steamid-error', // 필드 오류 연결
    'string', // typeof 검사(화면 미노출)
    'sort', // radio name(화면 미노출)
    'radio', // HTML 속성값(화면 미노출)
    'playtime:desc', // 정렬 식별자(화면 미노출)
    'ratedAt:desc', // 정렬 식별자(화면 미노출)
    'filter-text', // 좁은 폭 숨김 후크(화면 미노출)
    'result-line', // 결과 줄 후크(화면 미노출)
    'game-row', // 행 후크(화면 미노출)
    'game-cover', // 커버 후크(화면 미노출)
    'row-action', // 행 액션 후크(화면 미노출)
    'badge-spin', // 뱃지 회전 후크(화면 미노출)
    'var(--qt-orange)', // 토큰 참조(화면 미노출)
    'var(--qt-purple)', // 토큰 참조(화면 미노출)
    'var(--qt-mint)', // 토큰 참조(화면 미노출)
    'number', // typeof 검사(화면 미노출)
    'https://steamcommunity.com/dev/apikey', // Steam 링크 상수(번역 대상 아님)
    'https://steamcommunity.com/dev/apiterms', // Steam 링크 상수(번역 대상 아님)
    'https://help.steampowered.com/en/faqs/view/71D3-35C2-AD96-AA3A', // Steam 링크 상수(번역 대상 아님)
    'library', // i18n 섹션 식별자
    'game', // i18n 섹션 식별자
    'all', // DB 화면 상태 어휘 filter_key(계약 M-7) — 화면 미노출
    'unrated', // DB 화면 상태 어휘 filter_key(계약 M-7) — 화면 미노출
    'byRating', // DB 화면 상태 어휘 filter_key(계약 M-7) — 화면 미노출
    'hidden', // DB 화면 상태 어휘 filter_key(계약 M-7) — 화면 미노출
    'playtime', // DB 화면 상태 어휘 sort_key(계약 M-7) — 화면 미노출
    'lastPlayed', // DB 화면 상태 어휘 sort_key(계약 M-7) — 화면 미노출
    'rating', // DB 화면 상태 어휘 sort_key(계약 M-7) — 화면 미노출
    'ratedAt', // DB 화면 상태 어휘 sort_key(계약 M-7) — 화면 미노출
    'addedAt', // DB 화면 상태 어휘 sort_key(계약 M-7) — 화면 미노출
    'releaseDate', // DB 화면 상태 어휘 sort_key(계약 M-7) — 화면 미노출
    'name', // DB 화면 상태 어휘 sort_key(계약 M-7) — 화면 미노출
    'asc', // DB 화면 상태 어휘 direction(계약 M-7) — 화면 미노출
    'desc', // DB 화면 상태 어휘 direction(계약 M-7) — 화면 미노출
    'numeric', // Intl 옵션 식별자 — 화면 미노출
    'short', // Intl 옵션 식별자 — 화면 미노출
    'auto', // Intl 옵션 식별자 — 화면 미노출
    'second', // Intl 단위 식별자 — 화면 미노출
    'minute', // Intl 단위 식별자 — 화면 미노출
    'hour', // Intl 단위 식별자 — 화면 미노출
    'day', // Intl 단위 식별자 — 화면 미노출
    'button', // HTML 속성값 — 화면 미노출
    'group', // ARIA role — 화면 미노출
    'checkbox', // HTML 속성값 — 화면 미노출
    'slider', // ARIA role — 화면 미노출
    'ArrowLeft', // DOM 키 식별자 — 화면 미노출
    'ArrowRight', // DOM 키 식별자 — 화면 미노출
    'Backspace', // DOM 키 식별자 — 화면 미노출
    'Delete', // DOM 키 식별자 — 화면 미노출
    'Enter', // DOM 키 식별자 — 화면 미노출
    'Escape', // DOM 키 식별자 — 화면 미노출
    'left', // 별 상태 전이 액션 식별자(ui 내부) — 화면 미노출
    'right', // 별 상태 전이 액션 식별자(ui 내부) — 화면 미노출
    'enter', // 별 상태 전이 액션 식별자(ui 내부) — 화면 미노출
    'space', // 별 상태 전이 액션 식별자(ui 내부) — 화면 미노출
    'delete', // 별 상태 전이 액션 식별자(ui 내부) — 화면 미노출
    'backspace', // 별 상태 전이 액션 식별자(ui 내부) — 화면 미노출
    'escape', // 별 상태 전이 액션 식별자(ui 내부) — 화면 미노출
    'blur', // 별 상태 전이 액션 식별자(ui 내부) — 화면 미노출
    'leave', // 별 상태 전이 액션 식별자(ui 내부) — 화면 미노출
    'digit', // 별 상태 전이 액션 식별자(ui 내부) — 화면 미노출
    'hover', // 별 상태 전이 액션 식별자(ui 내부) — 화면 미노출
    'object', // typeof 판정 — 화면 미노출
    'steam', // platform 계약값 — 화면 미노출
    'https://store.steampowered.com/app', // ui 상수 URL(Q5 승인) — 화면 미노출
    'missing', // 행 뱃지 타입 식별자(표시는 문구 키) — 화면 미노출
    'filling', // 행 뱃지 타입 식별자(표시는 문구 키) — 화면 미노출
    'ArrowUp', // DOM 키 식별자 — 화면 미노출
    'ArrowDown', // DOM 키 식별자 — 화면 미노출
    'PUT', // HTTP 메서드 — 화면 미노출
    '[data-game-key]', // DOM 셀렉터 — 화면 미노출
    '[role=', // DOM 셀렉터 조각 — 화면 미노출
    'absolute', // 가상 스크롤 위치 지정 — 화면 미노출
    'relative', // 가상 스크롤 위치 지정 — 화면 미노출
    'alert', // ARIA role — 화면 미노출
    'status', // ARIA role — 화면 미노출
    'application/json', // HTTP 헤더값 — 화면 미노출
    'content-type', // HTTP 헤더명 — 화면 미노출
    'loading', // 로드 상태 식별자(ui 내부) — 화면 미노출
    'ready', // 로드 상태 식별자(ui 내부) — 화면 미노출
    'failed', // 로드 상태 식별자(ui 내부) — 화면 미노출
    'fixed_id', // 계약 params.reason 값(v1.5.4 384행) — 화면 미노출
    'key', // 에러 자리 식별자(ui 내부) — 화면 미노출
    'steamId', // 에러 자리 식별자(ui 내부) — 화면 미노출
    'notice', // 에러 자리 식별자(ui 내부) — 화면 미노출
    'connect-submit', // CSS 클래스 — 화면 미노출
    'connect-submit-label', // CSS 클래스 — 화면 미노출
    'is-busy', // CSS 상태 클래스 — 화면 미노출
    'is-success', // CSS 상태 클래스 — 화면 미노출
    'is-shimmer', // CSS 상태 클래스 — 화면 미노출
    'connect-submit is-success', // CSS 클래스 조합 — 화면 미노출
    'connect-submit is-busy', // CSS 클래스 조합 — 화면 미노출
    'connect-submit-label is-shimmer', // CSS 클래스 조합 — 화면 미노출
    'connect-needs-heading', // aria-labelledby 식별자 — 화면 미노출
    'connect-warn-heading', // aria-labelledby 식별자 — 화면 미노출
    'Questail', // 워드마크 식별자(서체 표시용) — 화면 미노출
    'page', // aria-current 값 — 화면 미노출
    'scroll', // DOM 이벤트명 — 화면 미노출
    'true', // 불리언 속성 직렬화 — 화면 미노출
    'data-preview', // 미리보기 후크 속성 — 화면 미노출
    'wordmark', // CSS 클래스 — 화면 미노출
    'wordmark-q', // CSS 클래스 — 화면 미노출
    'wordmark-rest', // CSS 클래스 — 화면 미노출
    'shell-symbol', // CSS 클래스 — 화면 미노출
    'site-header', // CSS 클래스 — 화면 미노출
    'site-menu', // CSS 클래스 — 화면 미노출
    'site-footer', // CSS 클래스 — 화면 미노출
    'site-footer-link', // CSS 클래스 — 화면 미노출
    'mobile-header', // CSS 클래스 — 화면 미노출
    'mobile-header is-hidden', // CSS 클래스 조합 — 화면 미노출
    'mobile-header-top', // CSS 클래스 — 화면 미노출
    'mobile-menu', // CSS 클래스 — 화면 미노출
    'https://store.steampowered.com/', // Steam 링크 상수(번역 대상 아님)
    'wait', // 수집 pill 상태 식별자(ui 내부) — 화면 노출은 문구 키
    'run', // 수집 pill 상태 식별자(ui 내부) — 화면 노출은 문구 키
    'done', // 수집 pill 상태 식별자(ui 내부) — 화면 노출은 문구 키
    'hold', // 수집 pill 상태 식별자(ui 내부) — 화면 노출은 문구 키
    'fail', // 수집 pill 상태 식별자(ui 내부) — 화면 노출은 문구 키
    'off', // 수집 pill 상태 식별자(ui 내부) — 화면 노출은 문구 키
    'owned', // 수집 소스 식별자(ui 내부) — 화면 노출은 문구 키
    'info', // 수집 소스 식별자(ui 내부) — 화면 노출은 문구 키
    'wish', // 수집 소스 식별자(ui 내부) — 화면 노출은 문구 키
    'tags', // 수집 소스 식별자(ui 내부) — 화면 노출은 문구 키
    'ach', // 수집 소스 식별자(ui 내부) — 화면 노출은 문구 키
    'progress', // 행 본문 형태 식별자(ui 내부) — 화면 미노출
    'cause', // 행 본문 형태 식별자(ui 내부) — 화면 미노출
    'none', // 행 본문 형태 식별자(ui 내부) — 화면 미노출
    'HELD_ZERO', // 서버 코드 분기(화면 미노출)
    'HELD_TIME_ZERO', // 서버 코드 분기(화면 미노출)
    'ACCESS_PRIVATE', // 서버 코드 분기(화면 미노출)
    'RATE_LIMITED', // 서버 코드 분기(화면 미노출)
    'progressbar', // ARIA role — 화면 미노출
    'sync-rows', // CSS 클래스 식별자(화면 미노출)
    'sync-row', // CSS 클래스 식별자(화면 미노출)
    'sync-row-id', // CSS 클래스 식별자(화면 미노출)
    'sync-iconbox', // CSS 클래스 식별자(화면 미노출)
    'sync-row-name', // CSS 클래스 식별자(화면 미노출)
    'sync-row-time', // CSS 클래스 식별자(화면 미노출)
    'sync-row-body', // CSS 클래스 식별자(화면 미노출)
    'sync-bar', // CSS 클래스 식별자(화면 미노출)
    'sync-bar-track', // CSS 클래스 식별자(화면 미노출)
    'sync-bar-fill', // CSS 클래스 식별자(화면 미노출)
    'sync-bar-num', // CSS 클래스 식별자(화면 미노출)
    'sync-cause', // CSS 클래스 식별자(화면 미노출)
    'sync-cause-icon', // CSS 클래스 식별자(화면 미노출)
    'sync-tail', // CSS 클래스 식별자(화면 미노출)
    'sync-pill', // CSS 클래스 식별자(화면 미노출)
    'sync-pill-spin', // CSS 클래스 식별자(화면 미노출)
    'sync-pill-shimmer', // CSS 클래스 식별자(화면 미노출)
    'sync-retry', // CSS 클래스 식별자(화면 미노출)
    'sync-notice', // CSS 클래스 식별자(화면 미노출)
    'sync-notice-icon', // CSS 클래스 식별자(화면 미노출)
    'sync-notice-body', // CSS 클래스 식별자(화면 미노출)
    'sync-notice-word', // CSS 클래스 식별자(화면 미노출)
    'sync-notice-action', // CSS 클래스 식별자(화면 미노출)
    'sync-review-toggle', // CSS 클래스 식별자(화면 미노출)
    'sync-review-toggle-icon', // CSS 클래스 식별자(화면 미노출)
    'sync-review-label', // CSS 클래스 식별자(화면 미노출)
    'sync-review-list', // CSS 클래스 식별자(화면 미노출)
    'sync-review-item', // CSS 클래스 식별자(화면 미노출)
    'sync-review-text', // CSS 클래스 식별자(화면 미노출)
    'sync-review-title', // CSS 클래스 식별자(화면 미노출)
    'sync-review-desc', // CSS 클래스 식별자(화면 미노출)
    'sync-review-empty', // CSS 클래스 식별자(화면 미노출)
    'sync-note', // CSS 클래스 식별자(화면 미노출)
    'sync-foot', // CSS 클래스 식별자(화면 미노출)
    'export-cols', // CSS 클래스 식별자(화면 미노출)
    'export-card', // CSS 클래스 식별자(화면 미노출)
    'export-folder-label', // CSS 클래스 식별자(화면 미노출)
    'export-folder-row', // CSS 클래스 식별자(화면 미노출)
    'export-dir', // CSS 클래스 식별자(화면 미노출)
    'export-copy', // CSS 클래스 식별자(화면 미노출)
    'export-bignum-row', // CSS 클래스 식별자(화면 미노출)
    'export-bignum', // CSS 클래스 식별자(화면 미노출)
    'export-eq', // CSS 클래스 식별자(화면 미노출)
    'export-alert', // CSS 클래스 식별자(화면 미노출)
    'export-alert-icon', // CSS 클래스 식별자(화면 미노출)
    'export-alert-body', // CSS 클래스 식별자(화면 미노출)
    'export-alert-word', // CSS 클래스 식별자(화면 미노출)
    'export-again', // CSS 클래스 식별자(화면 미노출)
    'export-done', // CSS 클래스 식별자(화면 미노출)
    'export-done-icon', // CSS 클래스 식별자(화면 미노출)
    'export-done-body', // CSS 클래스 식별자(화면 미노출)
    'export-done-word', // CSS 클래스 식별자(화면 미노출)
    'export-actions', // CSS 클래스 식별자(화면 미노출)
    'export-go', // CSS 클래스 식별자(화면 미노출)
    'export-go-spin', // CSS 클래스 식별자(화면 미노출)
    'export-go-shimmer', // CSS 클래스 식별자(화면 미노출)
    'export-nokey', // CSS 클래스 식별자(화면 미노출)
    'export-sample-head', // CSS 클래스 식별자(화면 미노출)
    'export-sample-head-icon', // CSS 클래스 식별자(화면 미노출)
    'export-sample-pre', // CSS 클래스 식별자(화면 미노출)
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
