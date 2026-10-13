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
    'SYNC_IN_PROGRESS',
    'NOT_CONNECTED',
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
    'undefined', // typeof 판정 — 화면 미노출
    '(max-width: 768px)', // matchMedia 쿼리 — 화면 미노출
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
    '/api/sync/status', // API 경로 — 화면 미노출
    'achievements', // 수집 소스 계약값 — 화면 미노출
    'ok', // 수집 상태 계약값 — 화면 미노출
    'running', // 수집 상태 계약값 — 화면 미노출
    'source', // 수집 상태 필드명 — 화면 미노출
    'https://steamcommunity.com/my/edit/settings', // 공개 설정 링크 상수 — 화면 미노출
    '/api/sync', // API 경로 — 화면 미노출
    '_blank', // 링크 타깃 — 화면 미노출
    'noopener noreferrer', // 링크 rel — 화면 미노출
    'fixed_id', // 계약 params.reason 값(v1.5.4 384행) — 화면 미노출
    'attach', // 계약 params.reason 값(KEY_STORE_FAILED, v1.5.13 790-804) — 화면 미노출
    'shutdown', // 계약 params.reason 값(KEY_STORE_FAILED, v1.5.13 790-804) — 화면 미노출
    'dir_conflict', // 계약 params.reason 값(KEY_STORE_FAILED, v1.5.13 790-804) — 화면 미노출
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
    'QUESTAIL_DATA_DIR', // 환경변수 고유명(고정 문자열)
    'meta', // 수집 소스 식별자(화면 미노출)
    'sync-summary', // 요약 pill 후크(화면 미노출)
    'var(--qt-red)', // 토큰 참조(화면 미노출)
    'var(--qt-purple)', // 토큰 참조(화면 미노출)
    'var(--qt-mint)', // 토큰 참조(화면 미노출)
    'settings-backup-item', // 백업 항목 후크(화면 미노출)
    'settings-backup-date', // 백업 날짜 후크(화면 미노출)
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
    '/api/settings/info', // API 경로
    '/api/settings/backups', // API 경로
    'settings-data-heading', // aria 연결 식별자(화면 미노출)
    'settings-about-heading', // aria-labelledby 식별자 — 화면 미노출
    'settings-conn-heading', // aria-labelledby 식별자 — 화면 미노출
    'settings-conn-dialog-title', // aria-labelledby 식별자 — 화면 미노출
    'switch', // ARIA role — 화면 미노출
    'alertdialog', // ARIA role — 화면 미노출
    'Tab', // DOM 키 식별자 — 화면 미노출
    'settings-row', // CSS 클래스 식별자(화면 미노출)
    'settings-label', // CSS 클래스 식별자(화면 미노출)
    'settings-body', // CSS 클래스 식별자(화면 미노출)
    'settings-saved', // CSS 클래스 식별자(화면 미노출)
    'settings-dialog', // CSS 클래스 식별자(화면 미노출)
    'settings-switch', // CSS 클래스 식별자(화면 미노출)
    'settings-switch-knob', // CSS 클래스 식별자(화면 미노출)
    'settings-lang-seg', // CSS 클래스 식별자(화면 미노출)
    'settings-lang-on', // CSS 클래스 식별자(화면 미노출)
    'settings-lang-off', // CSS 클래스 식별자(화면 미노출)
    'useLocale는 LocaleProvider 안에서만 쓴다', // 개발자 전용 예외(화면 미노출)
    'useSyncStatus는 SyncStatusProvider 안에서만 쓴다', // 개발자 전용 예외(화면 미노출)
    'root 요소 없음', // 개발자 전용 예외(화면 미노출)
    'game-row-main', // CSS 클래스 식별자(화면 미노출)
    'game-row-title', // CSS 클래스 식별자(화면 미노출)
    'game-row-meta', // CSS 클래스 식별자(화면 미노출)
    'game-row-sub', // CSS 클래스 식별자(화면 미노출)
    'game-row-hours', // CSS 클래스 식별자(화면 미노출)
    'game-row-last', // CSS 클래스 식별자(화면 미노출)
    'game-row-rate', // CSS 클래스 식별자(화면 미노출)
    'game-row-num', // CSS 클래스 식별자(화면 미노출)
    'game-row-actions', // CSS 클래스 식별자(화면 미노출)
    'game-just-note', // CSS 클래스 식별자(화면 미노출)
    ' is-frost', // CSS 클래스 식별자(화면 미노출)
    ' is-hidden', // CSS 클래스 식별자(화면 미노출)
    '(max-width: 639.98px)', // matchMedia 쿼리 — 화면 미노출
    'connect-acc', // CSS 클래스 식별자(화면 미노출)
    'connect-acc-body', // CSS 클래스 식별자(화면 미노출)
    'connect-acc-down', // CSS 클래스 식별자(화면 미노출)
    'connect-acc-up', // CSS 클래스 식별자(화면 미노출)
    'connect-actions', // CSS 클래스 식별자(화면 미노출)
    'connect-alert-text', // CSS 클래스 식별자(화면 미노출)
    'connect-body', // CSS 클래스 식별자(화면 미노출)
    'connect-error', // CSS 클래스 식별자(화면 미노출)
    'connect-examples', // CSS 클래스 식별자(화면 미노출)
    'connect-examples-title', // CSS 클래스 식별자(화면 미노출)
    'connect-field', // CSS 클래스 식별자(화면 미노출)
    'connect-field is-locked', // CSS 클래스 식별자(화면 미노출)
    'connect-form', // CSS 클래스 식별자(화면 미노출)
    'connect-formwrap', // CSS 클래스 식별자(화면 미노출)
    'connect-golist', // CSS 클래스 식별자(화면 미노출)
    'connect-guide', // CSS 클래스 식별자(화면 미노출)
    'connect-head', // CSS 클래스 식별자(화면 미노출)
    'connect-hint', // CSS 클래스 식별자(화면 미노출)
    'connect-key', // id·aria 연결 식별자 — 화면 미노출
    'connect-key-hint', // id·aria 연결 식별자 — 화면 미노출
    'connect-need', // CSS 클래스 식별자(화면 미노출)
    'connect-needs', // CSS 클래스 식별자(화면 미노출)
    'connect-needs-title', // CSS 클래스 식별자(화면 미노출)
    'connect-steamid', // id·aria 연결 식별자 — 화면 미노출
    'connect-steamid-hint', // id·aria 연결 식별자 — 화면 미노출
    'connect-steps', // CSS 클래스 식별자(화면 미노출)
    'dialog', // ARIA role — 화면 미노출
    'game-badge game-badge--filling', // CSS 클래스 식별자(화면 미노출)
    'game-badge game-badge--just', // CSS 클래스 식별자(화면 미노출)
    'game-badge game-badge--missing', // CSS 클래스 식별자(화면 미노출)
    'game-cover game-cover--empty', // CSS 클래스 식별자(화면 미노출)
    'img', // ARIA role — 화면 미노출
    'lib-empty', // CSS 클래스 식별자(화면 미노출)
    'lib-empty-action', // CSS 클래스 식별자(화면 미노출)
    'lib-empty-desc', // CSS 클래스 식별자(화면 미노출)
    'lib-empty-icon', // CSS 클래스 식별자(화면 미노출)
    'lib-empty-logo', // CSS 클래스 식별자(화면 미노출)
    'lib-empty-title', // CSS 클래스 식별자(화면 미노출)
    'lib-fail', // CSS 클래스 식별자(화면 미노출)
    'lib-fail-btn', // CSS 클래스 식별자(화면 미노출)
    'lib-fail-text', // CSS 클래스 식별자(화면 미노출)
    'lib-filter', // CSS 클래스 식별자(화면 미노출)
    'lib-filter-badge', // CSS 클래스 식별자(화면 미노출)
    'lib-filter-btn', // CSS 클래스 식별자(화면 미노출)
    'lib-head', // CSS 클래스 식별자(화면 미노출)
    'lib-more', // CSS 클래스 식별자(화면 미노출)
    'lib-popover', // CSS 클래스 식별자(화면 미노출)
    'lib-popover-divider', // CSS 클래스 식별자(화면 미노출)
    'lib-popover-heading', // CSS 클래스 식별자(화면 미노출)
    'lib-popover-sortrow', // CSS 클래스 식별자(화면 미노출)
    'lib-popover-toggles', // CSS 클래스 식별자(화면 미노출)
    'lib-popover-switch', // CSS 클래스 식별자(화면 미노출)
    'lib-popover-switch-label', // CSS 클래스 식별자(화면 미노출)
    'lib-sort-dir', // CSS 클래스 식별자(화면 미노출)
    'lib-sort-select', // CSS 클래스 식별자(화면 미노출)
    'lib-skel', // CSS 클래스 식별자(화면 미노출)
    'lib-skel-cover', // CSS 클래스 식별자(화면 미노출)
    'lib-skel-line', // CSS 클래스 식별자(화면 미노출)
    'lib-skel-lines', // CSS 클래스 식별자(화면 미노출)
    'lib-skel-row', // CSS 클래스 식별자(화면 미노출)
    'lib-skel-star', // CSS 클래스 식별자(화면 미노출)
    'lib-skel-sub', // CSS 클래스 식별자(화면 미노출)
    'lib-switch', // CSS 클래스 식별자(화면 미노출)
    'lib-tab', // CSS 클래스 식별자(화면 미노출)
    'lib-tab lib-tab--active', // CSS 클래스 식별자(화면 미노출)
    'lib-tabs', // CSS 클래스 식별자(화면 미노출)
    'lib-title', // CSS 클래스 식별자(화면 미노출)
    'lib-toast', // CSS 클래스 식별자(화면 미노출)
    'lib-toast-btn', // CSS 클래스 식별자(화면 미노출)
    'lib-toast-text', // CSS 클래스 식별자(화면 미노출)
    'lib-toolbar', // CSS 클래스 식별자(화면 미노출)
    'lib-toolbar-row', // CSS 클래스 식별자(화면 미노출)
    'lib-total', // CSS 클래스 식별자(화면 미노출)
    'lib-virtual', // CSS 클래스 식별자(화면 미노출)
    'mobile-header-center', // CSS 클래스 식별자(화면 미노출)
    'qt-alert connect-alert', // CSS 클래스 식별자(화면 미노출)
    'qt-btn connect-acc-head', // CSS 클래스 식별자(화면 미노출)
    'qt-btn qt-btn--primary connect-submit', // CSS 클래스 식별자(화면 미노출)
    'qt-btn qt-btn--primary connect-submit is-busy', // CSS 클래스 식별자(화면 미노출)
    'qt-btn qt-btn--primary connect-submit is-success', // CSS 클래스 식별자(화면 미노출)
    'qt-btn qt-btn--secondary', // CSS 클래스 식별자(화면 미노출)
    'qt-btn qt-icon-btn row-action', // CSS 클래스 식별자(화면 미노출)
    'qt-card connect-done', // CSS 클래스 식별자(화면 미노출)
    'connect-done-title', // CSS 클래스 식별자(화면 미노출)
    'connect-done-body', // CSS 클래스 식별자(화면 미노출)
    'connect-done-actions', // CSS 클래스 식별자(화면 미노출)
    'qt-btn qt-btn--primary connect-done-go', // CSS 클래스 식별자(화면 미노출)
    'qt-field', // CSS 클래스 식별자(화면 미노출)
    'qt-icon-btn row-action', // CSS 클래스 식별자(화면 미노출)
    'qt-input', // CSS 클래스 식별자(화면 미노출)
    'qt-notice--warn connect-warn', // CSS 클래스 식별자(화면 미노출)
    'qt-shell qt-shell--app', // CSS 클래스 식별자(화면 미노출)
    'qt-shell qt-shell--guest', // CSS 클래스 식별자(화면 미노출)
    'qt-spin', // CSS 클래스 식별자(화면 미노출)
    'result-count', // CSS 클래스 식별자(화면 미노출)
    'result-sort', // CSS 클래스 식별자(화면 미노출)
    'site-footer-notice', // CSS 클래스 식별자(화면 미노출)
    'site-header site-header--app', // CSS 클래스 식별자(화면 미노출)
    'site-header site-header--guest', // CSS 클래스 식별자(화면 미노출)
    'site-header-spacer', // CSS 클래스 식별자(화면 미노출)
    'star-bg', // CSS 클래스 식별자(화면 미노출)
    'star-fill', // CSS 클래스 식별자(화면 미노출)
    'star-filter', // CSS 클래스 식별자(화면 미노출)
    'star-filter-clear', // CSS 클래스 식별자(화면 미노출)
    'star-filter-label', // CSS 클래스 식별자(화면 미노출)
    'star-filter-spacer', // CSS 클래스 식별자(화면 미노출)
    'star-hit star-hit--left', // CSS 클래스 식별자(화면 미노출)
    'star-hit star-hit--right', // CSS 클래스 식별자(화면 미노출)
    'star-unit', // CSS 클래스 식별자(화면 미노출)
    'stars', // CSS 클래스 식별자(화면 미노출)
    'stars-num', // CSS 클래스 식별자(화면 미노출)
    'stars-row', // CSS 클래스 식별자(화면 미노출)
    'sync-summary sync-summary--narrow', // CSS 클래스 식별자(화면 미노출)
    'tab', // ARIA role — 화면 미노출
    'tablist', // ARIA role — 화면 미노출
    'fill', // Phosphor 아이콘 weight prop 값(화면 미노출)
    'game-badge game-badge--hidden', // CSS 클래스 조합(화면 미노출)
    'edit', // 쿼리 키(화면 미노출)
    'text', // input 타입값(화면 미노출)
    'qt-btn qt-icon-btn', // CSS 클래스 조합(화면 미노출)
    '/connect?edit=1', // 라우트/쿼리 경로(화면 미노출)
    'NETWORK', // 서버 오류 코드(화면 미노출)
    'PAYLOAD_CORRUPT', // 서버 오류 코드(화면 미노출)
    'HELD_DEPENDENCY', // 서버 오류 코드(화면 미노출)
    'TAG_FAILED', // 서버 오류 코드(화면 미노출)
    'TAG_EMPTY', // 서버 오류 코드(화면 미노출)
    'steamspy', // 소스 계약값(화면 미노출)
    'visible', // visibilityState 값(화면 미노출)
    'visibilitychange', // DOM 이벤트명(화면 미노출)
    'wheel', // DOM 이벤트명(화면 미노출)
    'touchmove', // DOM 이벤트명(화면 미노출)
    'touchstart', // DOM 이벤트명(화면 미노출)
    'pointerdown', // DOM 이벤트명(화면 미노출)
    'focusin', // DOM 이벤트명(화면 미노출)
    'resize', // DOM 이벤트명(화면 미노출)
    '[data-chrome-scroll]', // DOM 셀렉터(화면 미노출)
    '[data-chrome-ignore]', // DOM 셀렉터(화면 미노출)
    'focus', // DOM 이벤트명(화면 미노출)
    'connect-ach', // CSS 클래스 식별자(화면 미노출)
    'connect-ach-row', // CSS 클래스 식별자(화면 미노출)
    'qt-toggle', // CSS 클래스 식별자(화면 미노출)
    'game-ach', // CSS 클래스 식별자(화면 미노출)
    'game-ach game-ach--complete', // CSS 클래스 식별자(화면 미노출)
    '/home', // 라우트 경로(URL) — 화면 미노출
    '/recap', // 라우트 경로(URL) — 화면 미노출
    '/tbti', // 라우트 경로(URL) — 화면 미노출
    'home', // data-route 식별자 — 화면 미노출
    'recap', // data-route 식별자 — 화면 미노출
    'tbti', // data-route 식별자 — 화면 미노출
    'mobile-menu-sep', // 메뉴 구분선 CSS 클래스(aria-hidden) — 화면 미노출
    'site-menu-sep', // 메뉴 구분선 CSS 클래스(aria-hidden) — 화면 미노출
    'share', // i18n 섹션 식별자
    '/api/recap/library', // API 경로 — 화면 미노출
    '/api/tbti', // API 경로 — 화면 미노출
    '/api/library?includeEnded=true', // API 경로 — 화면 미노출
    'I', // 축 이름은 i18n 키, 글자 기호는 언어 중립이라 데이터 경유 원문 렌더
    'N', // 축 이름은 i18n 키, 글자 기호는 언어 중립이라 데이터 경유 원문 렌더
    'O', // 축 이름은 i18n 키, 글자 기호는 언어 중립이라 데이터 경유 원문 렌더
    'C', // 축 이름은 i18n 키, 글자 기호는 언어 중립이라 데이터 경유 원문 렌더
    'H', // 축 이름은 i18n 키, 글자 기호는 언어 중립이라 데이터 경유 원문 렌더
    '__unknown', // 장르 미확인 genreId(계약 R15-3, 화면 노출은 미확인 줄 문구 키)
    'a', // createElement 태그명 — 화면 미노출
    'similar', // 칩 코드(계약, 화면 노출은 칩 문구 키)
    'both_strong', // 칩 코드(계약, 화면 노출은 칩 문구 키)
    'ach_not_reflected', // 칩 코드(계약, 화면 노출은 칩 문구 키)
    'ach_partial', // 칩 코드(계약, 화면 노출은 칩 문구 키)
    'interval_cross', // held 사유 키(화면 노출은 사유 문구 키)
    'observation_days', // caveat 코드 조회(화면 노출은 caveat 문구 키)
    'release_unknown', // caveat 코드 조회(화면 노출은 caveat 문구 키)
    'axis', // 타입·필드 식별자 — 화면 미노출
    'code', // 타입·필드 식별자 — 화면 미노출
    'count', // 타입·필드 식별자 — 화면 미노출
    'platform', // 타입·필드 식별자 — 화면 미노출
    'externalId', // 타입·필드 식별자 — 화면 미노출
    'hours', // metric 단위 식별자(화면 노출은 단위 문구 키)
    'percent', // metric 단위 식별자(화면 노출은 단위 문구 키)
    'representativeGame', // 카드 본문 필드명 — 화면 미노출
    'slip', // 카드 본문 필드명 — 화면 미노출
    'empathy', // 카드 본문 필드명 — 화면 미노출
    'ensemble', // 카드 본문 필드명 — 화면 미노출
    'false', // aria-hidden 값 — 화면 미노출
    'keydown', // DOM 이벤트명 — 화면 미노출
    'long', // Intl 옵션 식별자 — 화면 미노출
    'meter', // ARIA role — 화면 미노출
    'new', // 구간 코드(화면 노출은 구간 문구 키)
    'text/markdown', // 내려받기 MIME — 화면 미노출
    'home-head', // CSS 클래스 식별자(화면 미노출)
    'home-title', // CSS 클래스 식별자(화면 미노출)
    'home-basis', // CSS 클래스 식별자(화면 미노출)
    'home-cols', // CSS 클래스 식별자(화면 미노출)
    'home-play', // CSS 클래스 식별자(화면 미노출)
    'home-play-lead', // CSS 클래스 식별자(화면 미노출)
    'home-bignum', // CSS 클래스 식별자(화면 미노출)
    'home-bignum-num', // CSS 클래스 식별자(화면 미노출)
    'home-bignum-unit', // CSS 클래스 식별자(화면 미노출)
    'home-play-sub', // CSS 클래스 식별자(화면 미노출)
    'home-top', // CSS 클래스 식별자(화면 미노출)
    'home-top-row', // CSS 클래스 식별자(화면 미노출)
    'home-top-rank', // CSS 클래스 식별자(화면 미노출)
    'home-top-name', // CSS 클래스 식별자(화면 미노출)
    'home-top-track', // CSS 클래스 식별자(화면 미노출)
    'home-top-fill', // CSS 클래스 식별자(화면 미노출)
    'home-top-hours', // CSS 클래스 식별자(화면 미노출)
    'home-more', // CSS 클래스 식별자(화면 미노출)
    'home-tbti', // CSS 클래스 식별자(화면 미노출)
    'home-tbti home-tbti--pending', // CSS 클래스 식별자(화면 미노출)
    'home-tbti--pending', // CSS 클래스 식별자(화면 미노출)
    'home-tbti-top', // CSS 클래스 식별자(화면 미노출)
    'home-tbti-lead', // CSS 클래스 식별자(화면 미노출)
    'home-tbti-code', // CSS 클래스 식별자(화면 미노출)
    'home-tbti-symbol', // CSS 클래스 식별자(화면 미노출)
    'home-tbti-name', // CSS 클래스 식별자(화면 미노출)
    'home-tbti-def', // CSS 클래스 식별자(화면 미노출)
    'home-tbti-pend', // CSS 클래스 식별자(화면 미노출)
    'home-tbti-prog', // CSS 클래스 식별자(화면 미노출)
    'home-tbti-track', // CSS 클래스 식별자(화면 미노출)
    'home-tbti-fill', // CSS 클래스 식별자(화면 미노출)
    'home-tbti-go', // CSS 클래스 식별자(화면 미노출)
    'home-trio', // CSS 클래스 식별자(화면 미노출)
    'home-cell', // CSS 클래스 식별자(화면 미노출)
    'home-cell-label', // CSS 클래스 식별자(화면 미노출)
    'home-cell-num', // CSS 클래스 식별자(화면 미노출)
    'recap-head', // CSS 클래스 식별자(화면 미노출)
    'recap-title', // CSS 클래스 식별자(화면 미노출)
    'recap-band', // CSS 클래스 식별자(화면 미노출)
    'recap-band-text', // CSS 클래스 식별자(화면 미노출)
    'recap-band-wide', // CSS 클래스 식별자(화면 미노출)
    'recap-band-narrow', // CSS 클래스 식별자(화면 미노출)
    'recap-body', // CSS 클래스 식별자(화면 미노출)
    'recap-sec', // CSS 클래스 식별자(화면 미노출)
    'recap-secnum', // CSS 클래스 식별자(화면 미노출)
    'recap-note', // CSS 클래스 식별자(화면 미노출)
    'recap-empty', // CSS 클래스 식별자(화면 미노출)
    'recap-go', // CSS 클래스 식별자(화면 미노출)
    'recap-source', // CSS 클래스 식별자(화면 미노출)
    'recap-source-btn', // CSS 클래스 식별자(화면 미노출)
    'recap-caveats', // CSS 클래스 식별자(화면 미노출)
    'recap-caveat', // CSS 클래스 식별자(화면 미노출)
    'recap-caveat-num', // CSS 클래스 식별자(화면 미노출)
    'recap-tbti', // CSS 클래스 식별자(화면 미노출)
    'recap-tbti-main', // CSS 클래스 식별자(화면 미노출)
    'recap-tbti-name', // CSS 클래스 식별자(화면 미노출)
    'recap-tbti-code', // CSS 클래스 식별자(화면 미노출)
    'recap-tbti-def', // CSS 클래스 식별자(화면 미노출)
    'recap-tbti-go', // CSS 클래스 식별자(화면 미노출)
    'recap-tbti-minis', // CSS 클래스 식별자(화면 미노출)
    'recap-tbti-mini', // CSS 클래스 식별자(화면 미노출)
    'recap-tbti-minifill', // CSS 클래스 식별자(화면 미노출)
    'recap-tbti-minifill recap-tbti-minifill--unknown', // CSS 클래스 식별자(화면 미노출)
    'recap-top', // CSS 클래스 식별자(화면 미노출)
    'recap-top-row', // CSS 클래스 식별자(화면 미노출)
    'recap-top-rank', // CSS 클래스 식별자(화면 미노출)
    'recap-top-name', // CSS 클래스 식별자(화면 미노출)
    'recap-top-track', // CSS 클래스 식별자(화면 미노출)
    'recap-top-fill', // CSS 클래스 식별자(화면 미노출)
    'recap-top-hours', // CSS 클래스 식별자(화면 미노출)
    'recap-top-share', // CSS 클래스 식별자(화면 미노출)
    'recap-bars', // CSS 클래스 식별자(화면 미노출)
    'recap-bar-row', // CSS 클래스 식별자(화면 미노출)
    'recap-bar-name', // CSS 클래스 식별자(화면 미노출)
    'recap-bar-track', // CSS 클래스 식별자(화면 미노출)
    'recap-bar-fill', // CSS 클래스 식별자(화면 미노출)
    'recap-bar-fill recap-bar-fill--unknown', // CSS 클래스 식별자(화면 미노출)
    'recap-bar-num', // CSS 클래스 식별자(화면 미노출)
    'recap-bignum', // CSS 클래스 식별자(화면 미노출)
    'recap-bignum-num', // CSS 클래스 식별자(화면 미노출)
    'recap-cols', // CSS 클래스 식별자(화면 미노출)
    'recap-col', // CSS 클래스 식별자(화면 미노출)
    'recap-col-track', // CSS 클래스 식별자(화면 미노출)
    'recap-col-fill', // CSS 클래스 식별자(화면 미노출)
    'recap-col-fill recap-col-fill--top', // CSS 클래스 식별자(화면 미노출)
    'recap-col-num', // CSS 클래스 식별자(화면 미노출)
    'recap-split', // CSS 클래스 식별자(화면 미노출)
    'recap-stack', // CSS 클래스 식별자(화면 미노출)
    'recap-stack-seg', // CSS 클래스 식별자(화면 미노출)
    'recap-stack-seg recap-stack-seg--new', // CSS 클래스 식별자(화면 미노출)
    'recap-panel', // CSS 클래스 식별자(화면 미노출)
    'recap-panel-btn', // CSS 클래스 식별자(화면 미노출)
    'recap-chips', // CSS 클래스 식별자(화면 미노출)
    'recap-chip', // CSS 클래스 식별자(화면 미노출)
    'recap-missing', // CSS 클래스 식별자(화면 미노출)
    'recap-mean', // CSS 클래스 식별자(화면 미노출)
    'recap-deviants', // CSS 클래스 식별자(화면 미노출)
    'recap-deviant', // CSS 클래스 식별자(화면 미노출)
    'recap-deviant-label', // CSS 클래스 식별자(화면 미노출)
    'recap-deviant-rows', // CSS 클래스 식별자(화면 미노출)
    'recap-deviant-row', // CSS 클래스 식별자(화면 미노출)
    'recap-cover', // CSS 클래스 식별자(화면 미노출)
    'recap-deviant-name', // CSS 클래스 식별자(화면 미노출)
    'recap-deviant-score', // CSS 클래스 식별자(화면 미노출)
    'recap-deviant-dev', // CSS 클래스 식별자(화면 미노출)
    'recap-dist', // CSS 클래스 식별자(화면 미노출)
    'recap-dist-col', // CSS 클래스 식별자(화면 미노출)
    'recap-dist-track', // CSS 클래스 식별자(화면 미노출)
    'recap-dist-fill', // CSS 클래스 식별자(화면 미노출)
    'recap-eras', // CSS 클래스 식별자(화면 미노출)
    'recap-era', // CSS 클래스 식별자(화면 미노출)
    'recap-era-name', // CSS 클래스 식별자(화면 미노출)
    'recap-era-range', // CSS 클래스 식별자(화면 미노출)
    'recap-era-num', // CSS 클래스 식별자(화면 미노출)
    'recap-years', // CSS 클래스 식별자(화면 미노출)
    'recap-year', // CSS 클래스 식별자(화면 미노출)
    'recap-year-track', // CSS 클래스 식별자(화면 미노출)
    'recap-year-fill', // CSS 클래스 식별자(화면 미노출)
    'recap-year-fill recap-year-fill--peak', // CSS 클래스 식별자(화면 미노출)
    'recap-year-label', // CSS 클래스 식별자(화면 미노출)
    'recap-bar', // CSS 클래스 식별자(화면 미노출)
    'recap-bar-lead', // CSS 클래스 식별자(화면 미노출)
    'recap-bar-actions', // CSS 클래스 식별자(화면 미노출)
    'recap-bar-secondary', // CSS 클래스 식별자(화면 미노출)
    'recap-bar-primary', // CSS 클래스 식별자(화면 미노출)
    'tbti-front', // CSS 클래스 식별자(화면 미노출)
    'tbti-code', // CSS 클래스 식별자(화면 미노출)
    'tbti-axisline', // CSS 클래스 식별자(화면 미노출)
    'tbti-symbol', // CSS 클래스 식별자(화면 미노출)
    'tbti-name', // CSS 클래스 식별자(화면 미노출)
    'tbti-def', // CSS 클래스 식별자(화면 미노출)
    'tbti-note', // CSS 클래스 식별자(화면 미노출)
    'tbti-axes', // CSS 클래스 식별자(화면 미노출)
    'tbti-axis', // CSS 클래스 식별자(화면 미노출)
    'tbti-axis-head', // CSS 클래스 식별자(화면 미노출)
    'tbti-axis-name', // CSS 클래스 식별자(화면 미노출)
    'tbti-axis-score', // CSS 클래스 식별자(화면 미노출)
    'tbti-chips', // CSS 클래스 식별자(화면 미노출)
    'tbti-chip', // CSS 클래스 식별자(화면 미노출)
    'tbti-meter', // CSS 클래스 식별자(화면 미노출)
    'tbti-meter-track', // CSS 클래스 식별자(화면 미노출)
    'tbti-meter-left', // CSS 클래스 식별자(화면 미노출)
    'tbti-meter-left tbti-meter-left--strong', // CSS 클래스 식별자(화면 미노출)
    'tbti-meter-mid', // CSS 클래스 식별자(화면 미노출)
    'tbti-meter-right', // CSS 클래스 식별자(화면 미노출)
    'tbti-meter-right tbti-meter-right--strong', // CSS 클래스 식별자(화면 미노출)
    'tbti-meter-held', // CSS 클래스 식별자(화면 미노출)
    'tbti-held', // CSS 클래스 식별자(화면 미노출)
    'tbti-sub', // CSS 클래스 식별자(화면 미노출)
    'tbti-why', // CSS 클래스 식별자(화면 미노출)
    'tbti-evidence', // CSS 클래스 식별자(화면 미노출)
    'tbti-ach', // CSS 클래스 식별자(화면 미노출)
    'tbti-ach-text', // CSS 클래스 식별자(화면 미노출)
    'tbti-ach-go', // CSS 클래스 식별자(화면 미노출)
    'tbti-metric', // CSS 클래스 식별자(화면 미노출)
    'tbti-baseline', // CSS 클래스 식별자(화면 미노출)
    'tbti-rows', // CSS 클래스 식별자(화면 미노출)
    'tbti-row', // CSS 클래스 식별자(화면 미노출)
    'tbti-cover', // CSS 클래스 식별자(화면 미노출)
    'tbti-row-main', // CSS 클래스 식별자(화면 미노출)
    'tbti-row-name', // CSS 클래스 식별자(화면 미노출)
    'tbti-row-reason', // CSS 클래스 식별자(화면 미노출)
    'tbti-row-metric', // CSS 클래스 식별자(화면 미노출)
    'tbti-excluded', // CSS 클래스 식별자(화면 미노출)
    'tbti-caveats', // CSS 클래스 식별자(화면 미노출)
    'tbti-caveat', // CSS 클래스 식별자(화면 미노출)
    'tbti-caveat-num', // CSS 클래스 식별자(화면 미노출)
    'tbti-body', // CSS 클래스 식별자(화면 미노출)
    'tbti-acc', // CSS 클래스 식별자(화면 미노출)
    'tbti-acc-btn', // CSS 클래스 식별자(화면 미노출)
    'tbti-acc-text', // CSS 클래스 식별자(화면 미노출)
    'tbti-acc-text tbti-acc-pending', // CSS 클래스 식별자(화면 미노출)
    'tbti-foot', // CSS 클래스 식별자(화면 미노출)
    'tbti-share-btn', // CSS 클래스 식별자(화면 미노출)
    'tbti-source', // CSS 클래스 식별자(화면 미노출)
    'tbti-source-btn', // CSS 클래스 식별자(화면 미노출)
    'tbti-pending', // CSS 클래스 식별자(화면 미노출)
    'tbti-pending-symbol', // CSS 클래스 식별자(화면 미노출)
    'tbti-pending-code', // CSS 클래스 식별자(화면 미노출)
    'tbti-pending-lead', // CSS 클래스 식별자(화면 미노출)
    'tbti-pending-sub', // CSS 클래스 식별자(화면 미노출)
    'tbti-pending-prog', // CSS 클래스 식별자(화면 미노출)
    'tbti-pending-track', // CSS 클래스 식별자(화면 미노출)
    'tbti-pending-fill', // CSS 클래스 식별자(화면 미노출)
    'tbti-pending-go', // CSS 클래스 식별자(화면 미노출)
    'share-scrim', // CSS 클래스 식별자(화면 미노출)
    'share-sheet', // CSS 클래스 식별자(화면 미노출)
    'share-head', // CSS 클래스 식별자(화면 미노출)
    'share-title', // CSS 클래스 식별자(화면 미노출)
    'share-close', // CSS 클래스 식별자(화면 미노출)
    'share-preview', // CSS 클래스 식별자(화면 미노출)
    'share-foot', // CSS 클래스 식별자(화면 미노출)
    'share-note', // CSS 클래스 식별자(화면 미노출)
    'share-actions', // CSS 클래스 식별자(화면 미노출)
    'share-secondary', // CSS 클래스 식별자(화면 미노출)
    'share-primary', // CSS 클래스 식별자(화면 미노출)
    'tbti.baseline.imc2016', // 서버 계약 키→i18n 키 매핑(화면 노출은 번역 문구)
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
